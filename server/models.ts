import { randomBytes } from 'node:crypto';
import { model, Schema } from 'mongoose';

const DAY = 24 * 60 * 60;

/** 128 random bits as 22 URL-safe characters. The workspace link is the only credential. */
export const newWorkspaceId = () => randomBytes(16).toString('base64url');
export const isWorkspaceId = (id: string) => /^[A-Za-z0-9_-]{22}$/.test(id);

const workspaceSchema = new Schema(
  {
    _id: { type: String, default: newWorkspaceId },
    name: { type: String, default: 'My mock API' },
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
  },
  { versionKey: false },
);
// One endpoint per method and path; this index is what settles a race between two saves.
endpointSchema.index({ workspaceId: 1, method: 1, path: 1 }, { unique: true });

const requestLogSchema = new Schema(
  {
    workspaceId: { type: String, required: true },
    at: { type: Date, default: () => new Date(), index: { expireAfterSeconds: 7 * DAY } },
    method: String,
    path: String,
    endpointId: { type: Schema.Types.ObjectId, default: null },
    status: Number,
    durationMs: Number,
  },
  { versionKey: false },
);
requestLogSchema.index({ workspaceId: 1, at: -1 });

export const Workspace = model('Workspace', workspaceSchema);
export const Endpoint = model('Endpoint', endpointSchema);
export const RequestLog = model('RequestLog', requestLogSchema);
