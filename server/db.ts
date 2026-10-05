import mongoose from 'mongoose';
import { Endpoint, RateHit, RequestLog, Workspace } from './models.js';

let ready: Promise<unknown> | null = null;

/** Connects once and reuses the connection (one per warm function instance on Vercel). */
export function connect(): Promise<unknown> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'));
  ready ??= mongoose
    .connect(uri, { serverSelectionTimeoutMS: 5000 })
    // The unique and expiry indexes do real work here; make sure they exist before serving.
    .then(() => Promise.all([Workspace.init(), Endpoint.init(), RequestLog.init(), RateHit.init()]))
    .catch((err) => {
    ready = null; // let the next request try again
    throw err;
  });
  return ready;
}
