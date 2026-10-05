import { randomBytes } from 'node:crypto';
import { model, Schema } from 'mongoose';

const DAY = 24 * 60 * 60;

/** 128 random bits as 22 URL-safe characters. */
export const newId = () => randomBytes(16).toString('base64url');
export const isId = (id: string) => /^[A-Za-z0-9_-]{22}$/.test(id);

const workspaceSchema = new Schema(
  {
    /** The secret edit id: whoever has it can change the workspace. Never sent to mock callers. */
    _id: { type: String, default: newId },
    /** The public id used in mock URLs. Safe to share: it cannot open or edit the workspace. */
    mockId: { type: String, default: newId, unique: true },
    name: { type: String, default: 'My mock API' },
    /** Kept in step with the endpoints collection so the limit can be enforced atomically. */
    endpointCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
    // Workspaces nobody has opened or called for 30 days are removed by MongoDB itself.
    lastUsedAt: { type: Date, default: () => new Date(), index: { expireAfterSeconds: 30 * DAY } },
  },
  { versionKey: false },
);

const endpointSchema = new Schema(
  {
    workspaceId: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: Number, default: 200 },
    /** JSON text, possibly with {{placeholders}}. */
    body: { type: String, default: '{}' },
    delayMs: { type: Number, default: 0 },
    errorRate: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
    // Refreshed while the workspace is in use, so endpoints expire shortly after their workspace
    // does instead of being left behind forever.
    lastUsedAt: { type: Date, default: () => new Date(), index: { expireAfterSeconds: 32 * DAY } },
  },
  { versionKey: false },
);
// One endpoint per method and path; this index is what settles a race between two saves.
endpointSchema.index({ workspaceId: 1, method: 1, path: 1 }, { unique: true });

const logEntry = new Schema(
  { at: Date, method: String, path: String, endpointId: { type: Schema.Types.ObjectId, default: null }, status: Number, durationMs: Number },
  { versionKey: false },
);

/** One document per workspace holding its latest calls, so the cap is a single atomic update. */
const requestLogSchema = new Schema(
  {
    _id: String, // the workspace id
    entries: { type: [logEntry], default: [] },
    updatedAt: { type: Date, default: () => new Date(), index: { expireAfterSeconds: 7 * DAY } },
  },
  { versionKey: false },
);

/** Counters for limits that must hold across server instances. Each expires with its window. */
const rateHitSchema = new Schema(
  { _id: String, count: { type: Number, default: 0 }, expiresAt: { type: Date, index: { expireAfterSeconds: 0 } } },
  { versionKey: false },
);

export const Workspace = model('Workspace', workspaceSchema);
export const Endpoint = model('Endpoint', endpointSchema);
export const RequestLog = model('RequestLog', requestLogSchema);
export const RateHit = model('RateHit', rateHitSchema);
