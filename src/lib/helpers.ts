/** Turns a pattern into a path that can be called: `/users/:id` becomes `/users/1`. */
export function examplePath(pattern: string): string {
  return pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '1');
}

/** Returns a short explanation when the text is not valid JSON, otherwise null. */
export function jsonProblem(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return `Not valid JSON: ${err instanceof Error ? err.message : 'check the syntax'}`;
  }
}

export function formatJson(text: string): string {
  if (!text.trim()) return '{}';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

interface SnippetInput {
  method: string;
  url: string;
  body?: string;
}

const hasBody = ({ method, body }: SnippetInput) => Boolean(body?.trim()) && method !== 'GET' && method !== 'DELETE';
/** Single-quote a value for a POSIX shell. */
const sh = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
/** Single-quote a value as a JavaScript string. */
const js = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function curlSnippet(input: SnippetInput): string {
  const lines = [`curl${input.method === 'GET' ? '' : ` -X ${input.method}`} ${sh(input.url)}`];
  if (hasBody(input)) lines.push(`  -H 'Content-Type: application/json'`, `  -d ${sh(input.body!.trim())}`);
  return lines.join(' \\\n');
}

export function fetchSnippet(input: SnippetInput): string {
  const tail = '\nconst data = await res.json();';
  if (!hasBody(input)) {
    const options = input.method === 'GET' ? '' : `, { method: '${input.method}' }`;
    return `const res = await fetch(${js(input.url)}${options});${tail}`;
  }
  const raw = input.body!.trim();
  const body = jsonProblem(raw) ? js(raw) : `JSON.stringify(${raw})`;
  return `const res = await fetch(${js(input.url)}, {\n  method: '${input.method}',\n  headers: { 'Content-Type': 'application/json' },\n  body: ${body},\n});${tail}`;
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export const PLACEHOLDERS = [
  { token: '{{params.id}}', hint: 'A value from the path, such as :id' },
  { token: '{{query.page}}', hint: 'A value from the query string' },
  { token: '{{body.name}}', hint: 'A field from the JSON the caller sent' },
  { token: '{{uuid}}', hint: 'A new random id' },
  { token: '{{now}}', hint: 'The current time' },
  { token: '{{randomInt 1 100}}', hint: 'A random whole number' },
];

const RECENT_KEY = 'mock-studio:recent';
export interface Recent {
  id: string;
  name: string;
}

export function loadRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => typeof r?.id === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberWorkspace(recent: Recent): void {
  try {
    const list = [recent, ...loadRecent().filter((r) => r.id !== recent.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private browsing: the list simply is not remembered.
  }
}

export function forgetWorkspace(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((r) => r.id !== id)));
  } catch {
    // Nothing to forget.
  }
}
