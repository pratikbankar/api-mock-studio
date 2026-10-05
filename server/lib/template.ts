import { AppError } from '../errors.js';

export const MAX_BODY_BYTES = 20 * 1024;

const MAX_DEPTH = 32;
const tooBig = () => new AppError(400, 'invalid_body', 'The response body can be at most 20 KB');

function depthOf(root: unknown): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    deepest = Math.max(deepest, depth);
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return deepest;
}

/**
 * Checks that a response body is JSON and returns it neatly formatted. The size limit applies
 * to the formatted text, because that is what gets stored and shown again in the editor:
 * measuring the input instead would let a small, deeply nested body expand to megabytes.
 */
export function validateBody(input: unknown): string {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return '{}';
  if (Buffer.byteLength(text) > 10 * MAX_BODY_BYTES) throw tooBig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message.replace(/^JSON\.parse: /, '') : '';
    throw new AppError(400, 'invalid_body', `The response body must be valid JSON. ${reason}`.trim());
  }
  if (depthOf(parsed) > MAX_DEPTH) throw new AppError(400, 'invalid_body', `The response body is nested too deeply (at most ${MAX_DEPTH} levels)`);
  const formatted = JSON.stringify(parsed, null, 2);
  if (Buffer.byteLength(formatted) > MAX_BODY_BYTES) throw tooBig();
  return formatted;
}

export interface TemplateContext {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  uuid: () => string;
  now: () => Date;
  random: () => number;
}

/** A filled-in response may not exceed this, so a small request cannot be echoed into a huge one. */
export const MAX_RENDERED_BYTES = 256 * 1024;
const MAX_EXPRESSION = 100;
const MISSING = Symbol('missing');

/** Reads `a.b.c` from own properties only, so `constructor` or `__proto__` can never be reached. */
function lookup(root: unknown, keys: string[]): unknown {
  let value = root;
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return MISSING;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function resolve(raw: string, ctx: TemplateContext): unknown {
  const expression = raw.trim();
  if (!expression || expression.length > MAX_EXPRESSION || expression.includes('{') || expression.includes('}')) return MISSING;
  if (expression === 'uuid') return ctx.uuid();
  if (expression === 'now') return ctx.now().toISOString();
  if (expression === 'timestamp') return ctx.now().getTime();

  const int = /^randomInt\s+(-?\d{1,9})\s+(-?\d{1,9})$/.exec(expression);
  if (int) {
    const [lo, hi] = [Number(int[1]), Number(int[2])].sort((a, b) => a - b);
    return lo + Math.floor(ctx.random() * (hi - lo + 1));
  }

  const [source, ...keys] = expression.split('.');
  if (keys.length === 0 || !['params', 'query', 'body'].includes(source)) return MISSING;
  return lookup(ctx[source as 'params' | 'query' | 'body'], keys);
}

interface Budget {
  left: number;
}

function spend(budget: Budget, value: unknown): void {
  budget.left -= typeof value === 'string' ? value.length : (JSON.stringify(value) ?? '').length;
  if (budget.left < 0) throw new AppError(500, 'response_too_large', 'This mock response grew too large after filling in its placeholders');
}

/**
 * Fills the placeholders in one string. Placeholders are found with plain index scans, in one
 * pass and in time proportional to the text, whatever the text contains. Substituted values
 * are appended as they are, so a placeholder arriving inside a value is never read again.
 */
function fill(text: string, ctx: TemplateContext, budget: Budget): unknown {
  if (text.startsWith('{{') && text.endsWith('}}') && text.length >= 4) {
    const value = resolve(text.slice(2, -2), ctx);
    if (value !== MISSING) {
      spend(budget, value);
      return value;
    }
  }

  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const close = text.indexOf('}}', pos);
    if (close < 0) break;
    // The opening braces nearest to this closing pair, so "{{ {{uuid}}" still finds the inner one.
    const open = text.lastIndexOf('{{', close - 2);
    if (open < pos) {
      out += text.slice(pos, close + 2);
      pos = close + 2;
      continue;
    }
    const value = resolve(text.slice(open + 2, close), ctx);
    const replacement = value === MISSING ? text.slice(open, close + 2) : typeof value === 'string' ? value : JSON.stringify(value);
    if (value !== MISSING) spend(budget, replacement);
    out += text.slice(pos, open) + replacement;
    pos = close + 2;
  }
  return out + text.slice(pos);
}

function walk(node: unknown, ctx: TemplateContext, budget: Budget): unknown {
  if (typeof node === 'string') return fill(node, ctx, budget);
  if (Array.isArray(node)) return node.map((item) => walk(item, ctx, budget));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value, ctx, budget)]));
  }
  return node;
}

/**
 * Fills the placeholders in a stored JSON body. Substitution happens on the parsed value,
 * never on the raw text, so nothing a caller sends can break out of a string or add fields.
 */
export function renderTemplate(bodyText: string, ctx: TemplateContext): unknown {
  return walk(JSON.parse(bodyText), ctx, { left: MAX_RENDERED_BYTES });
}
