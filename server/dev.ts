// Local development server. With no MONGODB_URI it starts a throwaway in-memory database.
import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';

if (!process.env.MONGODB_URI) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  process.env.MONGODB_URI = (await MongoMemoryServer.create()).getUri('mocks');
  console.log('Using an in-memory database (data is lost on restart).');
}
await mongoose.connect(process.env.MONGODB_URI);

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => console.log(`API on http://localhost:${port}`));
