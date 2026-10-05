import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, ah, errorHandler, notFound } from './errors.js';
import { pickEndpoint, validatePattern } from './lib/paths.js';
import { renderTemplate, validateBody } from './lib/template.js';
import { Endpoint, isId, RateHit, RequestLog, Workspace } from './models.js';
import { TEMPLATES } from './templates.js';

const MAX_ENDPOINTS = 20;
const MAX_LOGS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORKSPACES_PER_HOUR = 10;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const workspaceBody = z.strictObject({ name: z.string().trim().min(1).max(60).optional(), template: z.string().optional() });
const endpointBody = z.strictObject({
  method: z.string().transform((m) => m.toUpperCase()).pipe(z.enum(METHODS)),
  path: z.unknown(),
  status: z.number().int().min(200).max(599).default(200),
  body: z.string().optional(),
  delayMs: z.number().int().min(0).max(5000).default(0),
  errorRate: z.number().min(0).max(100).default(0),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const fields = details.map((d) => d.path || d.message).join(', ');
  throw new AppError(400, 'validation_error', `Please check: ${fields}`, details);
}

/** Validates an endpoint and returns the fields to store. */
function endpointFields(input: unknown) {
  const data = parse(endpointBody, input);
  return { ...data, path: validatePattern(data.path), body: validateBody(data.body) };
}

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;
const duplicate = () => new AppError(409, 'duplicate', 'This workspace already has an endpoint with that method and path');

const limiter = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests opt in per request so unrelated tests are not throttled.
    skip: (req) => process.env.NODE_ENV === 'test' && !req.headers['x-test-ratelimit'],
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });

const isRace = (err: unknown) => (err as { code?: number }).code === 11000;
const full = () => new AppError(409, 'endpoint_limit', `A workspace can have at most ${MAX_ENDPOINTS} endpoints`);

/** Endpoints carry their own expiry date; refresh it about once a day while the workspace is used. */
async function keepEndpointsAlive(workspaceId: string, previouslyUsed: Date | undefined) {
  if (!previouslyUsed || Date.now() - new Date(previouslyUsed).getTime() > DAY_MS) {
    await Endpoint.updateMany({ workspaceId }, { $set: { lastUsedAt: new Date() } });
  }
}

/** Looks a workspace up by its secret edit id and marks it as used. */
async function findWorkspace(id: string) {
  const workspace = isId(id) ? await Workspace.findById(id) : null;
  if (!workspace) throw new AppError(404, 'not_found', 'Workspace not found');
  const before = workspace.lastUsedAt;
  // Workspaces created before these fields existed get them on first use.
  if (!workspace.get('mockId')) workspace.set('mockId', undefined);
  if (workspace.get('endpointCount') === undefined) workspace.set('endpointCount', await Endpoint.countDocuments({ workspaceId: id }));
  workspace.lastUsedAt = new Date();
  await workspace.save();
  await keepEndpointsAlive(id, before);
  return workspace;
}

/** Reserves one of the workspace's endpoint slots in a single atomic step. */
async function claimSlot(workspaceId: string) {
  const claimed = await Workspace.findOneAndUpdate(
    { _id: workspaceId, endpointCount: { $lt: MAX_ENDPOINTS } },
    { $inc: { endpointCount: 1 } },
  );
  if (!claimed) throw full();
}
const releaseSlot = (workspaceId: string) => Workspace.updateOne({ _id: workspaceId, endpointCount: { $gt: 0 } }, { $inc: { endpointCount: -1 } });

async function createEndpoint(workspaceId: string, fields: Record<string, unknown>) {
  await claimSlot(workspaceId);
  try {
    return (await Endpoint.create({ ...fields, workspaceId })).toObject();
  } catch (err) {
    await releaseSlot(workspaceId);
    throw isDuplicate(err) ? duplicate() : err;
  }
}

/**
 * Counts an action in the database so the limit holds across server instances, which an
 * in-memory counter cannot do on serverless hosting.
 */
async function overLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const update = () =>
    RateHit.findOneAndUpdate(
      { _id: `${key}:${window}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs) } },
      { upsert: true, returnDocument: 'after' },
    );
  const hit = await update().catch((err) => {
    if (!isRace(err)) throw err;
    return update(); // two first requests raced to create the counter; the second attempt finds it
  });
  return (hit?.count ?? 0) > max;
}

const listEndpoints = (workspaceId: string) => Endpoint.find({ workspaceId }).sort({ createdAt: 1, _id: 1 }).lean();

async function addTemplate(workspaceId: string, name: string) {
  for (const t of TEMPLATES[name]) {
    const key = { workspaceId, method: t.method, path: t.path };
    // Skip what is already there, so applying a template twice never duplicates.
    if (await Endpoint.exists(key)) continue;
    await createEndpoint(workspaceId, { ...key, status: t.status, body: JSON.stringify(t.body, null, 2) }).catch((err) => {
      if (!(err instanceof AppError && err.code === 'duplicate')) throw err;
    });
  }
}

export interface AppOptions {
  /** Injected in tests to make failure injection and templating deterministic. */
  random?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

const openCors: RequestHandler = (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Mock-Endpoint, RateLimit, RateLimit-Policy',
    'Access-Control-Max-Age': '600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

/** Mocks accept whatever a caller sends. A body that is not JSON just means no {{body}} values. */
const lenientBody: RequestHandler = (req, _res, next) => {
  const raw = req.body as Buffer | undefined;
  let parsed: unknown;
  if (Buffer.isBuffer(raw) && raw.length > 0) {
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      parsed = undefined;
    }
  }
  req.body = parsed;
  next();
};

export function createApp({ random = Math.random, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ---- Serving mocks: /m/:workspaceId/... ------------------------------------------------
  const mocks = express.Router();
  mocks.use(openCors);
  mocks.use(limiter(60 * 1000, 120, 'Too many requests to this mock. Please slow down.'));
  mocks.use(express.raw({ type: () => true, limit: '20kb' }), lenientBody);
  mocks.use(
    ah(async (req: Request, res) => {
      const started = Date.now();
      // Parsed by hand from the raw path: Express would reject malformed percent-encoding
      // before the handler runs, and a mock should answer whatever it is sent.
      const [, mockId = '', path = '/'] = /^\/([^/]*)(\/.*)?$/.exec(req.path) ?? [];
      // One step both finds the workspace by its public id and notes that it is in use.
      const workspace = isId(mockId)
        ? await Workspace.findOneAndUpdate({ mockId }, { $set: { lastUsedAt: new Date() } }, { projection: { _id: 1, lastUsedAt: 1 } }).lean()
        : null;
      if (!workspace) throw new AppError(404, 'unknown_workspace', 'There is no mock workspace at this address');
      const workspaceId = workspace._id;
      await keepEndpointsAlive(workspaceId, workspace.lastUsedAt);

      const endpoints = await listEndpoints(workspaceId);
      const match = pickEndpoint(endpoints, req.method, path);
      let status = 404;
      let payload: unknown = {
        error: {
          code: 'no_mock',
          message: `No mock endpoint matches ${req.method} ${path}`,
          available: endpoints.map((e) => `${e.method} ${e.path}`),
        },
      };

      if (match) {
        const { endpoint, params } = match;
        if (endpoint.delayMs > 0) await sleep(endpoint.delayMs);
        res.set('X-Mock-Endpoint', `${endpoint.method} ${endpoint.path}`);
        if (random() < endpoint.errorRate / 100) {
          status = 500;
          payload = { error: { code: 'simulated_failure', message: `Simulated failure (${endpoint.errorRate}% failure rate on this endpoint)` } };
        } else {
          try {
            payload = renderTemplate(endpoint.body, {
              params, query: req.query as Record<string, unknown>, body: req.body, uuid: randomUUID, now: () => new Date(), random,
            });
            status = endpoint.status;
          } catch (err) {
            if (!(err instanceof AppError)) throw err;
            status = err.status;
            payload = { error: { code: err.code, message: err.message } };
          }
        }
      }

      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const entry = {
        _id: new mongoose.Types.ObjectId(), at: new Date(), method: req.method, path: `${path}${query}`.slice(0, 300),
        endpointId: match?.endpoint._id ?? null, status, durationMs: Date.now() - started,
      };
      // Appending and trimming to the newest entries is one atomic update, so the cap holds under load.
      const append = () =>
        RequestLog.updateOne(
          { _id: workspaceId },
          { $push: { entries: { $each: [entry], $slice: -MAX_LOGS } }, $set: { updatedAt: new Date() } },
          { upsert: true },
        );
      await append().catch((err) => {
        if (!isRace(err)) throw err;
        return append();
      });

      res.status(status).json(payload);
    }),
  );
  mocks.use(errorHandler);
  app.use('/m', mocks);

  // ---- Management API: /api/... ----------------------------------------------------------
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    '/api/workspaces',
    ah(async (req, res) => {
      const counted = process.env.NODE_ENV !== 'test' || Boolean(req.headers['x-test-ratelimit']);
      if (counted && (await overLimit(`workspaces:${req.ip}`, WORKSPACES_PER_HOUR, 60 * 60 * 1000))) {
        throw new AppError(429, 'rate_limited', 'You have created several workspaces already. Please try again later.');
      }
      const body = parse(workspaceBody, req.body ?? {});
      if (body.template && !Object.hasOwn(TEMPLATES, body.template)) throw new AppError(400, 'validation_error', 'Unknown template');
      const workspace = await Workspace.create({ ...(body.name ? { name: body.name } : {}) });
      if (body.template) await addTemplate(workspace._id, body.template);
      res.status(201).json({ workspace: workspace.toObject(), endpoints: await listEndpoints(workspace._id) });
    }),
  );

  app.get(
    '/api/workspaces/:id',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      res.json({ workspace: workspace.toObject(), endpoints: await listEndpoints(workspace._id) });
    }),
  );

  app.post(
    '/api/workspaces/:id/templates/:name',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      if (!Object.hasOwn(TEMPLATES, req.params.name)) throw new AppError(404, 'not_found', 'Unknown template');
      await addTemplate(workspace._id, req.params.name);
      res.json({ workspace: workspace.toObject(), endpoints: await listEndpoints(workspace._id) });
    }),
  );

  app.post(
    '/api/workspaces/:id/endpoints',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      res.status(201).json(await createEndpoint(workspace._id, endpointFields(req.body)));
    }),
  );

  const endpointFilter = (req: Request) => {
    if (!isId(req.params.id) || !mongoose.isValidObjectId(req.params.eid) || !/^[a-f0-9]{24}$/.test(req.params.eid)) {
      throw new AppError(404, 'not_found', 'Endpoint not found');
    }
    // Always scoped to the workspace in the URL, so one workspace can never reach into another.
    return { _id: req.params.eid, workspaceId: req.params.id };
  };

  app.put(
    '/api/workspaces/:id/endpoints/:eid',
    ah(async (req, res) => {
      const filter = endpointFilter(req);
      const fields = endpointFields(req.body);
      try {
        const updated = await Endpoint.findOneAndUpdate(filter, { $set: fields }, { returnDocument: 'after' }).lean();
        if (!updated) throw new AppError(404, 'not_found', 'Endpoint not found');
        res.json(updated);
      } catch (err) {
        throw isDuplicate(err) ? duplicate() : err;
      }
    }),
  );

  app.delete(
    '/api/workspaces/:id/endpoints/:eid',
    ah(async (req, res) => {
      const removed = await Endpoint.findOneAndDelete(endpointFilter(req)).lean();
      if (!removed) throw new AppError(404, 'not_found', 'Endpoint not found');
      await releaseSlot(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/workspaces/:id/logs',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      const log = await RequestLog.findById(workspace._id).lean();
      res.json([...(log?.entries ?? [])].reverse());
    }),
  );

  app.delete(
    '/api/workspaces/:id/logs',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      await RequestLog.deleteOne({ _id: workspace._id });
      res.json({ ok: true });
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
