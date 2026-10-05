import { AppError } from '../errors.js';

const MAX_LENGTH = 200;
const MAX_SEGMENTS = 10;
const LITERAL = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^:[A-Za-z_][A-Za-z0-9_]*$/;

const invalid = (message: string) => new AppError(400, 'invalid_path', message);
const segmentsOf = (path: string) => path.split('/').filter((s, i, all) => !(s === '' && (i === 0 || i === all.length - 1)));

/** Checks a path pattern such as `/users/:id` and returns its canonical form. */
export function validatePattern(input: unknown): string {
  if (typeof input !== 'string') throw invalid('Enter a path such as /users/:id');
  const raw = input.trim();
  if (!raw) throw invalid('Enter a path such as /users/:id');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (path.length > MAX_LENGTH) throw invalid(`A path can be at most ${MAX_LENGTH} characters`);

  const segments = segmentsOf(path);
  if (segments.length > MAX_SEGMENTS) throw invalid(`A path can have at most ${MAX_SEGMENTS} parts`);
  const names = new Set<string>();
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw invalid('A path cannot contain . or .. parts');
    if (PARAM.test(segment)) {
      if (names.has(segment)) throw invalid(`The parameter ${segment} is used twice`);
      names.add(segment);
    } else if (!LITERAL.test(segment)) {
      throw invalid(
        segment === ''
          ? 'A path cannot contain an empty part (two slashes in a row)'
          : `"${segment.slice(0, 30)}" is not allowed. Use letters, digits, . _ ~ - or a parameter like :id`,
      );
    }
  }
  return `/${segments.join('/')}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed percent-encoding: pass it through rather than fail the request
  }
}

/** Returns the bound parameters when `path` matches `pattern`, otherwise null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = segmentsOf(pattern);
  const got = segmentsOf(path);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decode(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

const literalCount = (pattern: string) => segmentsOf(pattern).filter((s) => !s.startsWith(':')).length;

/**
 * Chooses the endpoint for a request. When several match, the one with the most literal
 * parts wins, so `/users/me` beats `/users/:id` no matter which was created first.
 */
export function pickEndpoint<T extends { method: string; path: string }>(
  endpoints: T[],
  method: string,
  path: string,
): { endpoint: T; params: Record<string, string> } | null {
  let best: { endpoint: T; params: Record<string, string>; score: number } | null = null;
  for (const endpoint of endpoints) {
    if (endpoint.method.toUpperCase() !== method.toUpperCase()) continue;
    const params = matchPath(endpoint.path, path);
    if (!params) continue;
    const score = literalCount(endpoint.path);
    if (!best || score > best.score) best = { endpoint, params, score };
  }
  return best && { endpoint: best.endpoint, params: best.params };
}
