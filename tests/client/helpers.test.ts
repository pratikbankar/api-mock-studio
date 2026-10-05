import { describe, expect, it } from 'vitest';
import { curlSnippet, examplePath, fetchSnippet, formatJson, jsonProblem } from '../../src/lib/helpers';

describe('examplePath', () => {
  it('fills parameters with sample values so the path can be called straight away', () => {
    expect(examplePath('/users/:id')).toBe('/users/1');
    expect(examplePath('/users/:id/posts/:postId')).toBe('/users/1/posts/1');
    expect(examplePath('/users')).toBe('/users');
    expect(examplePath('/')).toBe('/');
  });
});

describe('jsonProblem and formatJson', () => {
  it('accepts valid JSON and an empty body', () => {
    expect(jsonProblem('{"a":1}')).toBeNull();
    expect(jsonProblem('  ')).toBeNull();
    expect(jsonProblem('[1,2,3]')).toBeNull();
  });
  it('explains what is wrong with invalid JSON', () => {
    expect(jsonProblem('{a:1}')).toMatch(/JSON/);
    expect(jsonProblem("{'a':1}")).toMatch(/JSON/);
  });
  it('formats valid JSON and leaves invalid text untouched', () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(formatJson('{oops')).toBe('{oops');
    expect(formatJson('')).toBe('{}');
  });
});

describe('snippets', () => {
  const url = 'https://mocks.example/m/abc/users/1';

  it('writes a plain GET', () => {
    expect(curlSnippet({ method: 'GET', url })).toBe(`curl '${url}'`);
    expect(fetchSnippet({ method: 'GET', url })).toBe(`const res = await fetch('${url}');\nconst data = await res.json();`);
  });

  it('includes the method, header and body for a POST', () => {
    const body = '{"name":"Asha"}';
    expect(curlSnippet({ method: 'POST', url, body })).toBe(`curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Asha"}'`);
    expect(fetchSnippet({ method: 'POST', url, body })).toContain("method: 'POST'");
    expect(fetchSnippet({ method: 'POST', url, body })).toContain('body: JSON.stringify({"name":"Asha"})');
  });

  it('adds only the method for a DELETE without a body', () => {
    expect(curlSnippet({ method: 'DELETE', url })).toBe(`curl -X DELETE '${url}'`);
    expect(fetchSnippet({ method: 'DELETE', url })).toContain("{ method: 'DELETE' }");
  });

  it('escapes single quotes so the shell command stays one command', () => {
    const snippet = curlSnippet({ method: 'POST', url, body: `{"note":"it's"}` });
    expect(snippet).toContain(`-d '{"note":"it'\\''s"}'`);
  });

  it('keeps the fetch snippet valid when the path contains a quote', () => {
    expect(fetchSnippet({ method: 'GET', url: `${url}/o'brien` })).toContain(`fetch('${url}/o\\'brien')`);
  });

  it('falls back to a string body in the fetch snippet when the body is not JSON', () => {
    expect(fetchSnippet({ method: 'POST', url, body: '{oops' })).toContain("body: '{oops'");
  });
});
