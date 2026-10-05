import { AppError } from '../errors.js';

export const MAX_BODY_BYTES = 20 * 1024;

/** Checks that a response body is JSON within the size limit, and returns it neatly formatted. */
export function validateBody(input: unknown): string {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return '{}';
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AppError(400, 'invalid_body', 'The response body can be at most 20 KB');
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (err) {
    const reason = err instanceof Error ? err.message.replace(/^JSON\.parse: /, '') : '';
    throw new AppError(400, 'invalid_body', `The response body must be valid JSON. ${reason}`.trim());
  }
}

export interface TemplateContext {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  uuid: () => string;
  now: () => Date;
  random: () => number;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
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

function resolve(expression: string, ctx: TemplateContext): unknown {
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

function fill(text: string, ctx: TemplateContext): unknown {
  const whole = WHOLE.exec(text);
  if (whole) {
    const value = resolve(whole[1], ctx);
    return value === MISSING ? text : value;
  }
  return text.replace(PLACEHOLDER, (original, expression: string) => {
    const value = resolve(expression, ctx);
    if (value === MISSING) return original;
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function walk(node: unknown, ctx: TemplateContext): unknown {
  if (typeof node === 'string') return fill(node, ctx);
  if (Array.isArray(node)) return node.map((item) => walk(item, ctx));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value, ctx)]));
  }
  return node;
}

/**
 * Fills the placeholders in a stored JSON body. Substitution happens on the parsed value,
 * never on the raw text, so nothing a caller sends can break out of a string or add fields.
 */
export function renderTemplate(bodyText: string, ctx: TemplateContext): unknown {
  return walk(JSON.parse(bodyText), ctx);
}
