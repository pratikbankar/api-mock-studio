import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, ah, errorHandler, notFound } from './errors.js';
import { pickEndpoint, validatePattern } from './lib/paths.js';
import { renderTemplate, validateBody } from './lib/template.js';
import { Endpoint, isWorkspaceId, RequestLog, Workspace } from './models.js';
import { TEMPLATES } from './templates.js';

const MAX_ENDPOINTS = 20;
const MAX_LOGS = 50;
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

async function findWorkspace(id: string) {
  const workspace = isWorkspaceId(id) ? await Workspace.findById(id) : null;
  if (!workspace) throw new AppError(404, 'not_found', 'Workspace not found');
  return workspace;
}

const listEndpoints = (workspaceId: string) => Endpoint.find({ workspaceId }).sort({ createdAt: 1, _id: 1 }).lean();

async function addTemplate(workspaceId: string, name: string) {
  for (const t of TEMPLATES[name]) {
    const fields = { workspaceId, method: t.method, path: t.path };
    // Upsert, so applying a template twice (or over hand-made endpoints) never duplicates.
    await Endpoint.updateOne(fields, { $setOnInsert: { ...fields, status: t.status, body: JSON.stringify(t.body, null, 2) } }, { upsert: true });
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
  mocks.use(express.raw({ type: () => true, limit: '100kb' }), lenientBody);
  mocks.use(
    ah(async (req: Request, res) => {
      const started = Date.now();
      // Parsed by hand from the raw path: Express would reject malformed percent-encoding
      // before the handler runs, and a mock should answer whatever it is sent.
      const [, workspaceId = '', path = '/'] = /^\/([^/]*)(\/.*)?$/.exec(req.path) ?? [];
      if (!isWorkspaceId(workspaceId) || !(await Workspace.exists({ _id: workspaceId }))) {
        throw new AppError(404, 'unknown_workspace', 'There is no mock workspace at this address');
      }

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
          status = endpoint.status;
          payload = renderTemplate(endpoint.body, {
            params, query: req.query as Record<string, unknown>, body: req.body, uuid: randomUUID, now: () => new Date(), random,
          });
        }
      }

      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const entry = await RequestLog.create({
        workspaceId, method: req.method, path: `${path}${query}`.slice(0, 300), endpointId: match?.endpoint._id ?? null,
        status, durationMs: Date.now() - started,
      });
      // Keep only the newest entries, and note that the workspace is in use.
      const oldest = await RequestLog.find({ workspaceId }).sort({ at: -1, _id: -1 }).skip(MAX_LOGS).limit(1).lean();
      await Promise.all([
        oldest[0] ? RequestLog.deleteMany({ workspaceId, at: { $lte: oldest[0].at }, _id: { $ne: entry._id } }) : null,
        Workspace.updateOne({ _id: workspaceId }, { $set: { lastUsedAt: new Date() } }),
      ]);

      res.status(status).json(payload);
    }),
  );
  mocks.use(errorHandler);
  app.use('/m', mocks);

  // ---- Management API: /api/... ----------------------------------------------------------
  app.use(helmet());
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    '/api/workspaces',
    limiter(60 * 60 * 1000, 10, 'You have created several workspaces already. Please try again later.'),
    ah(async (req, res) => {
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
      workspace.lastUsedAt = new Date();
      await workspace.save();
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
      const fields = endpointFields(req.body);
      if ((await Endpoint.countDocuments({ workspaceId: workspace._id })) >= MAX_ENDPOINTS) {
        throw new AppError(409, 'endpoint_limit', `A workspace can have at most ${MAX_ENDPOINTS} endpoints`);
      }
      try {
        res.status(201).json((await Endpoint.create({ ...fields, workspaceId: workspace._id })).toObject());
      } catch (err) {
        throw isDuplicate(err) ? duplicate() : err;
      }
    }),
  );

  const endpointFilter = (req: Request) => {
    if (!isWorkspaceId(req.params.id) || !mongoose.isValidObjectId(req.params.eid) || !/^[a-f0-9]{24}$/.test(req.params.eid)) {
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
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/workspaces/:id/logs',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      res.json(await RequestLog.find({ workspaceId: workspace._id }).sort({ at: -1, _id: -1 }).limit(MAX_LOGS).lean());
    }),
  );

  app.delete(
    '/api/workspaces/:id/logs',
    ah(async (req, res) => {
      const workspace = await findWorkspace(req.params.id);
      await RequestLog.deleteMany({ workspaceId: workspace._id });
      res.json({ ok: true });
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
