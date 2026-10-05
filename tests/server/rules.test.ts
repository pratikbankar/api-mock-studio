import { describe, expect, it } from 'vitest';
import { matchPath, pickEndpoint, validatePattern } from '../../server/lib/paths.js';
import { renderTemplate, validateBody } from '../../server/lib/template.js';

describe('validatePattern', () => {
  it('accepts literal and parameter segments and tidies the pattern', () => {
    expect(validatePattern('/users')).toBe('/users');
    expect(validatePattern('/users/:id/posts/:postId')).toBe('/users/:id/posts/:postId');
    expect(validatePattern(' /users/ ')).toBe('/users');
    expect(validatePattern('users')).toBe('/users');
    expect(validatePattern('/')).toBe('/');
    expect(validatePattern('/v1.2/my_items/a-b~c')).toBe('/v1.2/my_items/a-b~c');
  });

  it('rejects patterns that could never match or are unsafe', () => {
    const bad = ['', '/users/:', '/users/:id/:id', '/a b', '/users?x=1', '/users#top', '/../etc', '/a//b', '/:1bad',
      '/' + 'a/'.repeat(11), '/' + 'x'.repeat(201), '/users/*', '/<script>'];
    for (const p of bad) expect(() => validatePattern(p), JSON.stringify(p)).toThrow();
    expect(() => validatePattern(42 as unknown as string)).toThrow();
  });
});

describe('matchPath', () => {
  it('matches literal paths, ignoring a trailing slash', () => {
    expect(matchPath('/users', '/users')).toEqual({});
    expect(matchPath('/users', '/users/')).toEqual({});
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/', '')).toEqual({});
    expect(matchPath('/users', '/user')).toBeNull();
    expect(matchPath('/users', '/users/1')).toBeNull();
    expect(matchPath('/users/:id', '/users')).toBeNull();
  });

  it('is case sensitive, like real APIs', () => {
    expect(matchPath('/Users', '/users')).toBeNull();
  });

  it('binds parameters', () => {
    expect(matchPath('/users/:id', '/users/42')).toEqual({ id: '42' });
    expect(matchPath('/users/:id/posts/:postId', '/users/7/posts/abc')).toEqual({ id: '7', postId: 'abc' });
  });

  it('decodes encoded values and survives malformed encoding', () => {
    expect(matchPath('/files/:name', '/files/my%20file.txt')).toEqual({ name: 'my file.txt' });
    expect(matchPath('/files/:name', '/files/a%2Fb')).toEqual({ name: 'a/b' });
    expect(matchPath('/files/:name', '/files/100%')).toEqual({ name: '100%' });
    expect(matchPath('/files/:name', '/files/%E0%A4%A')).toEqual({ name: '%E0%A4%A' });
  });
});

describe('pickEndpoint', () => {
  const list = [
    { method: 'GET', path: '/users/:id' },
    { method: 'GET', path: '/users/me' },
    { method: 'POST', path: '/users' },
    { method: 'GET', path: '/:a/:b' },
  ];

  it('prefers the endpoint with more literal segments, whatever the order', () => {
    expect(pickEndpoint(list, 'GET', '/users/me')?.endpoint.path).toBe('/users/me');
    expect(pickEndpoint([...list].reverse(), 'GET', '/users/me')?.endpoint.path).toBe('/users/me');
    expect(pickEndpoint(list, 'GET', '/users/9')).toEqual({ endpoint: list[0], params: { id: '9' } });
    expect(pickEndpoint(list, 'GET', '/teams/9')?.endpoint.path).toBe('/:a/:b');
  });

  it('requires the method to match', () => {
    expect(pickEndpoint(list, 'DELETE', '/users/9')).toBeNull();
    expect(pickEndpoint(list, 'post', '/users')?.endpoint.path).toBe('/users');
  });

  it('breaks a tie by the earliest literal part, whatever the order', () => {
    const tied = [{ method: 'GET', path: '/:y/b' }, { method: 'GET', path: '/a/:x' }];
    expect(pickEndpoint(tied, 'GET', '/a/b')?.endpoint.path).toBe('/a/:x');
    expect(pickEndpoint([...tied].reverse(), 'GET', '/a/b')?.endpoint.path).toBe('/a/:x');
  });

  it('returns nothing when no endpoint matches', () => {
    expect(pickEndpoint(list, 'GET', '/a/b/c')).toBeNull();
    expect(pickEndpoint([], 'GET', '/')).toBeNull();
  });
});

describe('validateBody', () => {
  it('accepts any JSON value and returns it tidied', () => {
    expect(validateBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(validateBody('[1, 2]')).toBe('[\n  1,\n  2\n]');
    expect(validateBody('"hello"')).toBe('"hello"');
    expect(validateBody('null')).toBe('null');
  });

  it('treats an empty body as an empty object', () => {
    expect(validateBody('   ')).toBe('{}');
  });

  it('rejects text that is not JSON, with the reason', () => {
    expect(() => validateBody('{a: 1}')).toThrow(/valid JSON/);
    expect(() => validateBody('<html>')).toThrow(/valid JSON/);
  });

  it('rejects a body over 20 KB', () => {
    expect(() => validateBody(JSON.stringify({ a: 'x'.repeat(21000) }))).toThrow(/20 KB/);
  });

  it('measures the limit on what is stored, so a saved body can always be saved again', () => {
    // Small when minified, but formatting adds a line and indentation per item.
    const wide = JSON.stringify(Array.from({ length: 3000 }, (_, i) => i));
    expect(Buffer.byteLength(wide)).toBeLessThan(20 * 1024);
    expect(() => validateBody(wide)).toThrow(/20 KB/);
    const ok = validateBody(JSON.stringify(Array.from({ length: 500 }, (_, i) => i)));
    expect(validateBody(ok)).toBe(ok);
  });

  it('rejects deeply nested JSON, which would balloon when formatted', () => {
    expect(() => validateBody('['.repeat(2000) + ']'.repeat(2000))).toThrow(/nested/);
    expect(() => validateBody('['.repeat(40) + ']'.repeat(40))).toThrow(/nested/);
    expect(validateBody('['.repeat(10) + ']'.repeat(10))).toContain('[');
  });
});

describe('renderTemplate', () => {
  const ctx = {
    params: { id: '42' }, query: { page: '2' }, body: { name: 'Asha', nested: { n: 5 }, tags: ['a'] },
    uuid: () => '00000000-0000-4000-8000-000000000000', now: () => new Date('2026-10-05T10:00:00Z'), random: () => 0.5,
  };
  const render = (value: unknown) => renderTemplate(JSON.stringify(value), ctx);

  it('fills in path, query and request body values', () => {
    expect(render({ id: '{{params.id}}', page: '{{query.page}}', hello: 'Hi {{body.name}}!' }))
      .toEqual({ id: '42', page: '2', hello: 'Hi Asha!' });
  });

  it('keeps the type when a string is exactly one placeholder', () => {
    expect(render({ n: '{{body.nested.n}}', tags: '{{body.tags}}', roll: '{{randomInt 1 6}}', ts: '{{timestamp}}' }))
      .toEqual({ n: 5, tags: ['a'], roll: 4, ts: 1791194400000 });
  });

  it('provides ids and times', () => {
    expect(render({ id: '{{uuid}}', at: '{{now}}', label: 'run-{{randomInt 10 10}}' }))
      .toEqual({ id: '00000000-0000-4000-8000-000000000000', at: '2026-10-05T10:00:00.000Z', label: 'run-10' });
  });

  it('works inside arrays and nested objects, and leaves other values alone', () => {
    expect(render({ items: [{ id: '{{params.id}}' }, 7, true, null], deep: { a: { b: '{{query.page}}' } } }))
      .toEqual({ items: [{ id: '42' }, 7, true, null], deep: { a: { b: '2' } } });
  });

  it('always produces valid JSON, whatever the visitor sends', () => {
    const hostile = { ...ctx, params: { id: '"}], "admin": true, "x": ["\n\\' } };
    const out = renderTemplate(JSON.stringify({ id: '{{params.id}}', msg: 'id is {{params.id}}' }), hostile);
    expect(out).toEqual({ id: hostile.params.id, msg: `id is ${hostile.params.id}` });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('leaves unknown or malformed placeholders as written', () => {
    expect(render({ a: '{{nope}}', b: '{{params.missing}}', c: '{{ randomInt x y }}', d: '{{', e: 'a {{params.missing}} b' }))
      .toEqual({ a: '{{nope}}', b: '{{params.missing}}', c: '{{ randomInt x y }}', d: '{{', e: 'a {{params.missing}} b' });
  });

  it('tolerates spaces inside the braces and swapped bounds', () => {
    expect(render({ a: '{{ params.id }}', b: '{{randomInt 6 1}}' })).toEqual({ a: '42', b: 4 });
  });

  it('stays fast on a body built to make placeholder matching slow', () => {
    const started = Date.now();
    const nasty = ['{{' + ' '.repeat(19000), '{{'.repeat(5000), '{{ a' + ' b'.repeat(5000), '{{' + ' '.repeat(9000) + '}' + ' '.repeat(9000)];
    for (const text of nasty) expect(renderTemplate(JSON.stringify({ v: text }), ctx)).toEqual({ v: text });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('does not re-read placeholders that arrive inside a substituted value', () => {
    const sneaky = { ...ctx, body: { name: '{{uuid}}' } };
    expect(renderTemplate('{"a":"{{body.name}}","b":"x {{body.name}}"}', sneaky)).toEqual({ a: '{{uuid}}', b: 'x {{uuid}}' });
  });

  it('never reads inherited properties of the request body', () => {
    expect(render({ a: '{{body.constructor}}', b: '{{body.__proto__}}', c: '{{body.name.length}}' }))
      .toEqual({ a: '{{body.constructor}}', b: '{{body.__proto__}}', c: '{{body.name.length}}' });
  });

  it('handles a body that is not an object', () => {
    expect(renderTemplate('"plain {{params.id}}"', ctx)).toBe('plain 42');
    expect(renderTemplate('[1,2]', { ...ctx, body: 'text' })).toEqual([1, 2]);
  });
});
