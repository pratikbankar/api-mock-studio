import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { Endpoint, RateHit, RequestLog, Workspace } from '../../server/models.js';

let mongo: MongoMemoryServer;
let app: Express;
let roll = 0.99; // what the injected random() returns
const sleep = vi.fn(async (_ms: number) => undefined);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([Workspace.createIndexes(), Endpoint.createIndexes(), RequestLog.createIndexes(), RateHit.createIndexes()]);
  roll = 0.99;
  sleep.mockClear();
  app = createApp({ random: () => roll, sleep });
});

const newWorkspace = async (body: object = {}) => (await request(app).post('/api/workspaces').send(body)).body.workspace;
const addEndpoint = (ws: string, body: object) => request(app).post(`/api/workspaces/${ws}/endpoints`).send(body);
const users = { method: 'GET', path: '/users/:id', status: 200, body: '{"id":"{{params.id}}","name":"Asha"}' };

describe('workspaces', () => {
  it('creates a workspace with an unguessable id', async () => {
    const res = await request(app).post('/api/workspaces').send({ name: 'My API' });
    expect(res.status).toBe(201);
    expect(res.body.workspace._id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.workspace.mockId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.workspace.mockId).not.toBe(res.body.workspace._id);
    expect(res.body.workspace.name).toBe('My API');
    expect(res.body.endpoints).toEqual([]);
    expect((await newWorkspace())._id).not.toBe(res.body.workspace._id);
  });

  it('can start from the users template', async () => {
    const res = await request(app).post('/api/workspaces').send({ template: 'users' });
    expect(res.status).toBe(201);
    expect(res.body.endpoints.map((e: { method: string; path: string }) => `${e.method} ${e.path}`)).toEqual([
      'GET /users', 'GET /users/:id', 'POST /users', 'DELETE /users/:id',
    ]);
  });

  it('rejects an unknown template and an over-long name', async () => {
    expect((await request(app).post('/api/workspaces').send({ template: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/workspaces').send({ name: 'x'.repeat(100) })).status).toBe(400);
  });

  it('returns a workspace with its endpoints, and 404 for unknown or malformed ids', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const res = await request(app).get(`/api/workspaces/${ws._id}`);
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toHaveLength(1);
    expect((await request(app).get('/api/workspaces/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await request(app).get('/api/workspaces/..%2F..')).status).toBe(404);
  });
});

describe('endpoints', () => {
  it('creates, updates and deletes an endpoint', async () => {
    const ws = await newWorkspace();
    const created = await addEndpoint(ws._id, { ...users, delayMs: 100, errorRate: 10 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ method: 'GET', path: '/users/:id', status: 200, delayMs: 100, errorRate: 10 });
    expect(created.body.body).toBe('{\n  "id": "{{params.id}}",\n  "name": "Asha"\n}');

    const id = created.body._id;
    const updated = await request(app).put(`/api/workspaces/${ws._id}/endpoints/${id}`).send({ ...users, status: 201, path: 'people/:id/' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: 201, path: '/people/:id', delayMs: 0, errorRate: 0 });

    expect((await request(app).delete(`/api/workspaces/${ws._id}/endpoints/${id}`)).status).toBe(200);
    expect(await Endpoint.countDocuments()).toBe(0);
  });

  it('applies sensible defaults', async () => {
    const ws = await newWorkspace();
    const res = await addEndpoint(ws._id, { method: 'get', path: '/ping' });
    expect(res.body).toMatchObject({ method: 'GET', status: 200, body: '{}', delayMs: 0, errorRate: 0 });
  });

  it('rejects invalid input with a field name', async () => {
    const ws = await newWorkspace();
    const cases: Array<[object, string]> = [
      [{ ...users, method: 'TRACE' }, 'method'],
      [{ ...users, path: '/a b' }, 'path'],
      [{ ...users, body: '{not json' }, 'body'],
      [{ ...users, status: 99 }, 'status'],
      [{ ...users, status: 204.5 }, 'status'],
      [{ ...users, delayMs: 6000 }, 'delayMs'],
      [{ ...users, errorRate: 101 }, 'errorRate'],
      [{ ...users, extra: true }, 'extra'],
    ];
    for (const [body, field] of cases) {
      const res = await addEndpoint(ws._id, body);
      expect(res.status, field).toBe(400);
      expect(JSON.stringify(res.body.error), field).toContain(field);
    }
    expect(await Endpoint.countDocuments()).toBe(0);
  });

  it('refuses a second endpoint with the same method and path, even when both arrive together', async () => {
    const ws = await newWorkspace();
    const results = await Promise.all([addEndpoint(ws._id, users), addEndpoint(ws._id, users), addEndpoint(ws._id, { ...users, path: 'users/:id/' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('duplicate');
    expect(await Endpoint.countDocuments()).toBe(1);
    // The same path with another method is a different endpoint.
    expect((await addEndpoint(ws._id, { ...users, method: 'DELETE' })).status).toBe(201);
  });

  it('refuses to rename an endpoint onto an existing one', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const other = await addEndpoint(ws._id, { method: 'GET', path: '/other' });
    const res = await request(app).put(`/api/workspaces/${ws._id}/endpoints/${other.body._id}`).send(users);
    expect(res.status).toBe(409);
  });

  it('holds the twenty endpoint limit when many are created at once', async () => {
    const ws = await newWorkspace();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => addEndpoint(ws._id, { method: 'GET', path: `/r${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    expect(results.filter((r) => r.status === 409)).toHaveLength(10);
    expect(await Endpoint.countDocuments({ workspaceId: ws._id })).toBe(20);
  });

  it('frees a slot when an endpoint is deleted or a duplicate is refused', async () => {
    const ws = await newWorkspace();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await addEndpoint(ws._id, { method: 'GET', path: `/r${i}` })).body._id);
    expect((await addEndpoint(ws._id, { method: 'GET', path: '/r0' })).status).toBe(409);
    await request(app).delete(`/api/workspaces/${ws._id}/endpoints/${ids[0]}`);
    expect((await addEndpoint(ws._id, { method: 'GET', path: '/again' })).status).toBe(201);
    expect((await addEndpoint(ws._id, { method: 'GET', path: '/too-many' })).status).toBe(409);
  });

  it('does not let a template push a workspace past the limit', async () => {
    const ws = await newWorkspace();
    for (let i = 0; i < 18; i++) await addEndpoint(ws._id, { method: 'GET', path: `/r${i}` });
    const res = await request(app).post(`/api/workspaces/${ws._id}/templates/users`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('endpoint_limit');
    expect(await Endpoint.countDocuments({ workspaceId: ws._id })).toBe(20);
  });

  it('lets a saved body be saved again unchanged', async () => {
    const ws = await newWorkspace();
    const big = JSON.stringify(Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key${i}`, 'value'])));
    const created = await addEndpoint(ws._id, { method: 'GET', path: '/big', body: big });
    expect(created.status).toBe(201);
    const again = await request(app).put(`/api/workspaces/${ws._id}/endpoints/${created.body._id}`).send({ method: 'GET', path: '/big', body: created.body.body });
    expect(again.status).toBe(200);
  });

  it('stops at twenty endpoints per workspace', async () => {
    const ws = await newWorkspace();
    for (let i = 0; i < 20; i++) expect((await addEndpoint(ws._id, { method: 'GET', path: `/r${i}` })).status).toBe(201);
    const res = await addEndpoint(ws._id, { method: 'GET', path: '/one-more' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('endpoint_limit');
  });

  it('cannot touch an endpoint through another workspace', async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    const ep = await addEndpoint(a._id, users);
    expect((await request(app).put(`/api/workspaces/${b._id}/endpoints/${ep.body._id}`).send(users)).status).toBe(404);
    expect((await request(app).delete(`/api/workspaces/${b._id}/endpoints/${ep.body._id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/workspaces/${a._id}/endpoints/not-an-id`)).status).toBe(404);
    expect(await Endpoint.countDocuments()).toBe(1);
  });

  it('adds a template to an existing workspace without duplicating what is already there', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { method: 'GET', path: '/users' });
    const res = await request(app).post(`/api/workspaces/${ws._id}/templates/users`);
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toHaveLength(4);
    expect((await request(app).post(`/api/workspaces/${ws._id}/templates/nope`)).status).toBe(404);
  });
});

describe('serving mocks', () => {
  it('answers with the configured status and templated JSON', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { ...users, status: 201 });
    const res = await request(app).get(`/m/${ws.mockId}/users/42?verbose=1`);
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toEqual({ id: '42', name: 'Asha' });
  });

  it('does not let the address used for calling mocks open or edit the workspace', async () => {
    const ws = await newWorkspace();
    const ep = await addEndpoint(ws._id, users);
    expect((await request(app).get(`/api/workspaces/${ws.mockId}`)).status).toBe(404);
    expect((await request(app).delete(`/api/workspaces/${ws.mockId}/endpoints/${ep.body._id}`)).status).toBe(404);
    expect((await request(app).get(`/api/workspaces/${ws.mockId}/logs`)).status).toBe(404);
    // And the edit id is not a mock address, and never appears in what a caller receives.
    expect((await request(app).get(`/m/${ws._id}/users/1`)).status).toBe(404);
    const res = await request(app).get(`/m/${ws.mockId}/users/1`);
    expect(JSON.stringify([res.headers, res.body])).not.toContain(ws._id);
    const miss = await request(app).get(`/m/${ws.mockId}/nope`);
    expect(JSON.stringify([miss.headers, miss.body])).not.toContain(ws._id);
  });

  it('lets a browser on another site read which endpoint answered', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const res = await request(app).get(`/m/${ws.mockId}/users/1`).set('Origin', 'https://some-app.example');
    expect(res.headers['x-mock-endpoint']).toBe('GET /users/:id');
    expect(res.headers['access-control-expose-headers']).toContain('X-Mock-Endpoint');
  });

  it('refuses to send a response that a small request has blown up to a huge size', async () => {
    const ws = await newWorkspace();
    const template = JSON.stringify(Array.from({ length: 900 }, () => '{{body.x}}'));
    expect((await addEndpoint(ws._id, { method: 'POST', path: '/echo', body: template })).status).toBe(201);
    const res = await request(app).post(`/m/${ws.mockId}/echo`).send({ x: 'y'.repeat(15000) });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('response_too_large');
    const fine = await request(app).post(`/m/${ws.mockId}/echo`).send({ x: 'ok' });
    expect(fine.status).toBe(200);
  });

  it('can echo the query string and the request body', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { method: 'POST', path: '/users', status: 201, body: '{"name":"{{body.name}}","page":"{{query.page}}","age":"{{body.age}}"}' });
    const res = await request(app).post(`/m/${ws.mockId}/users?page=3`).send({ name: 'Ravi', age: 31 });
    expect(res.body).toEqual({ name: 'Ravi', page: '3', age: 31 });
  });

  it('is callable from any website', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const res = await request(app).get(`/m/${ws.mockId}/users/1`).set('Origin', 'https://some-app.example');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const preflight = await request(app).options(`/m/${ws.mockId}/users/1`).set('Origin', 'https://some-app.example').set('Access-Control-Request-Method', 'DELETE');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('DELETE');
    expect(preflight.headers['access-control-allow-headers']).toBeDefined();
  });

  it('prefers the literal path when two endpoints match', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    await addEndpoint(ws._id, { method: 'GET', path: '/users/me', body: '{"me":true}' });
    expect((await request(app).get(`/m/${ws.mockId}/users/me`)).body).toEqual({ me: true });
    expect((await request(app).get(`/m/${ws.mockId}/users/7`)).body).toEqual({ id: '7', name: 'Asha' });
  });

  it('waits for the configured delay', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { ...users, delayMs: 750 });
    await request(app).get(`/m/${ws.mockId}/users/1`);
    expect(sleep).toHaveBeenCalledWith(750);
  });

  it('fails some requests when a failure rate is set', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { ...users, errorRate: 30 });
    roll = 0.29;
    const failed = await request(app).get(`/m/${ws.mockId}/users/1`);
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('simulated_failure');
    roll = 0.3;
    expect((await request(app).get(`/m/${ws.mockId}/users/1`)).status).toBe(200);
  });

  it('never fails at 0 percent and always fails at 100 percent', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    await addEndpoint(ws._id, { method: 'GET', path: '/down', errorRate: 100 });
    roll = 0;
    expect((await request(app).get(`/m/${ws.mockId}/users/1`)).status).toBe(200);
    roll = 0.999;
    expect((await request(app).get(`/m/${ws.mockId}/down`)).status).toBe(500);
  });

  it('explains an unmatched request and lists what exists', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const res = await request(app).get(`/m/${ws.mockId}/nothing/here`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('no_mock');
    expect(res.body.error.available).toEqual(['GET /users/:id']);
    expect((await request(app).delete(`/m/${ws.mockId}/users/1`)).status).toBe(404);
  });

  it('answers JSON for an unknown workspace, a malformed body and a huge body', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { method: 'POST', path: '/users', body: '{"ok":true}' });
    const unknown = await request(app).get('/m/AAAAAAAAAAAAAAAAAAAAAA/users');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('unknown_workspace');
    expect((await request(app).get('/m/short/users')).status).toBe(404);

    // A mock should accept whatever the caller sends: bad JSON simply means no {{body}} values.
    const badJson = await request(app).post(`/m/${ws.mockId}/users`).set('Content-Type', 'application/json').send('{oops');
    expect(badJson.status).toBe(200);
    expect(badJson.body).toEqual({ ok: true });
    const huge = await request(app).post(`/m/${ws.mockId}/users`).send({ blob: 'x'.repeat(30000) });
    expect(huge.status).toBe(413);
    expect(huge.headers['content-type']).toContain('application/json');
  });

  it('handles encoded and malformed path values without crashing', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    expect((await request(app).get(`/m/${ws.mockId}/users/a%20b`)).body.id).toBe('a b');
    expect((await request(app).get(`/m/${ws.mockId}/users/100%25`)).body.id).toBe('100%');
    expect((await request(app).get(`/m/${ws.mockId}/users/%E0%A4%A`)).status).toBeLessThan(500);
  });

  it('serves the root path of a workspace', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, { method: 'GET', path: '/', body: '{"root":true}' });
    expect((await request(app).get(`/m/${ws.mockId}`)).body).toEqual({ root: true });
    expect((await request(app).get(`/m/${ws.mockId}/`)).body).toEqual({ root: true });
  });
});

describe('request log', () => {
  it('records matched and unmatched calls, newest first', async () => {
    const ws = await newWorkspace();
    const ep = await addEndpoint(ws._id, users);
    await request(app).get(`/m/${ws.mockId}/users/42?x=1`);
    await request(app).get(`/m/${ws.mockId}/missing`);
    const logs = (await request(app).get(`/api/workspaces/${ws._id}/logs`)).body;
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ method: 'GET', path: '/missing', status: 404, endpointId: null });
    expect(logs[1]).toMatchObject({ method: 'GET', path: '/users/42?x=1', status: 200, endpointId: ep.body._id });
  });

  it('keeps only the latest fifty entries', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    for (let i = 0; i < 55; i++) await request(app).get(`/m/${ws.mockId}/users/${i}`);
    const logs = (await request(app).get(`/api/workspaces/${ws._id}/logs`)).body;
    expect(logs).toHaveLength(50);
    expect(logs[0].path).toBe('/users/54');
    expect(logs[49].path).toBe('/users/5');
    expect(await RequestLog.countDocuments()).toBe(1);
  });

  it('keeps the cap when many calls arrive at once', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    await Promise.all(Array.from({ length: 80 }, (_, i) => request(app).get(`/m/${ws.mockId}/users/${i}`)));
    expect((await request(app).get(`/api/workspaces/${ws._id}/logs`)).body).toHaveLength(50);
  });

  it('clears the log', async () => {
    const ws = await newWorkspace();
    await request(app).get(`/m/${ws.mockId}/anything`);
    expect((await request(app).delete(`/api/workspaces/${ws._id}/logs`)).status).toBe(200);
    expect((await request(app).get(`/api/workspaces/${ws._id}/logs`)).body).toEqual([]);
  });

  it('marks the workspace as used, so active workspaces are not expired', async () => {
    const ws = await newWorkspace();
    await Workspace.updateOne({ _id: ws._id }, { $set: { lastUsedAt: new Date('2026-01-01') } });
    await request(app).get(`/m/${ws.mockId}/anything`);
    expect((await Workspace.findById(ws._id))!.lastUsedAt.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
  });
});

describe('cleanup', () => {
  it('keeps the endpoints of a workspace that is in use from expiring, and lets unused ones go', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    const stale = new Date(Date.now() - 20 * 86400000);
    await Workspace.updateOne({ _id: ws._id }, { $set: { lastUsedAt: stale } });
    await Endpoint.updateMany({ workspaceId: ws._id }, { $set: { lastUsedAt: stale } });

    await request(app).get(`/m/${ws.mockId}/users/1`);
    const ep = await Endpoint.findOne({ workspaceId: ws._id });
    expect(ep!.lastUsedAt.getTime()).toBeGreaterThan(Date.now() - 60000);

    const indexes = await Endpoint.collection.indexes();
    expect(indexes.some((i) => i.key.lastUsedAt === 1 && typeof i.expireAfterSeconds === 'number')).toBe(true);
  });
});

describe('limits and errors', () => {
  const limited = (req: request.Test) => req.set('x-test-ratelimit', '1').set('X-Forwarded-For', '203.0.113.9');

  it('allows ten new workspaces per visitor per hour', async () => {
    for (let i = 0; i < 10; i++) expect((await limited(request(app).post('/api/workspaces').send({}))).status).toBe(201);
    const res = await limited(request(app).post('/api/workspaces').send({}));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
  });

  it('answers a throttled mock call with JSON and CORS, so a browser app can read the error', async () => {
    const ws = await newWorkspace();
    await addEndpoint(ws._id, users);
    let last = await limited(request(app).get(`/m/${ws.mockId}/users/1`));
    for (let i = 0; i < 125 && last.status !== 429; i++) last = await limited(request(app).get(`/m/${ws.mockId}/users/1`));
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('rate_limited');
    expect(last.headers['access-control-allow-origin']).toBe('*');
  });

  it('counts new workspaces in the database, so the limit holds across server instances', async () => {
    const other = createApp({ random: () => roll, sleep });
    for (let i = 0; i < 10; i++) expect((await limited(request(i % 2 ? app : other).post('/api/workspaces').send({}))).status).toBe(201);
    expect((await limited(request(other).post('/api/workspaces').send({}))).status).toBe(429);
    // Another visitor is unaffected.
    expect((await request(app).post('/api/workspaces').set('x-test-ratelimit', '1').set('X-Forwarded-For', '198.51.100.7').send({})).status).toBe(201);
  });

  it('answers a malformed address or unsupported encoding with a 4xx, not a 500', async () => {
    expect((await request(app).get('/api/workspaces/%E0%A4%A')).status).toBe(400);
    const res = await request(app).post('/api/workspaces').set('Content-Type', 'application/json; charset=x-unknown-charset').send('{}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('uses one error shape for unknown API routes and bad JSON', async () => {
    const missing = await request(app).get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const bad = await request(app).post('/api/workspaces').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
  });
});
