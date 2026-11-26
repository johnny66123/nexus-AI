import { createApp } from '../server.ts';
import { ensureCloudHydrated } from '../server/cloudPersistence.ts';
import { db } from '../server/db.ts';

const app = createApp();

export default async function handler(req: unknown, res: unknown) {
  await ensureCloudHydrated(db);
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
