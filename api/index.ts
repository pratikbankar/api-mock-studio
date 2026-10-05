// Vercel function entry point. Local development uses server/dev.ts instead.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app.js';
import { connect } from '../server/db.js';

const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await connect();
  } catch (err) {
    console.error(err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'unavailable', message: 'The service is temporarily unavailable' } }));
    return;
  }
  app(req, res);
}
