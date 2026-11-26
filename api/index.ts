import type { IncomingMessage, ServerResponse } from 'node:http';

type ExpressApp = ReturnType<(typeof import('../server.ts'))['createApp']>;

let cachedApp: ExpressApp | null = null;

async function getServerApp(): Promise<ExpressApp> {
  if (!cachedApp) {
    const { createApp } = await import('../server.ts');
    cachedApp = createApp();
  }
  const [{ ensureCloudHydrated }, { db }] = await Promise.all([
    import('../server/cloudPersistence.ts'),
    import('../server/db.ts'),
  ]);
  await ensureCloudHydrated(db);
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getServerApp();
    return app(req as Parameters<ExpressApp>[0], res as Parameters<ExpressApp>[1]);
  } catch (err) {
    try {
      const { logServerError, sanitizeClientErrorMessage } = await import('../server/security.ts');
      logServerError('vercel.handler', err, {
        method: req.method,
        path: req.url,
        statusCode: 500,
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: sanitizeClientErrorMessage(
              err,
              'NEVUS AI serverless runtime failed to initialize. Check Vercel runtime logs.',
            ),
            code: 'SERVERLESS_RUNTIME_ERROR',
          }),
        );
      }
    } catch (innerErr) {
      console.error(
        '[NEVUS Fatal Handler Error]',
        innerErr instanceof Error ? innerErr.message : String(innerErr),
      );
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: 'Serverless runtime initialization failed.',
            code: 'SERVERLESS_FATAL_ERROR',
          }),
        );
      }
    }
  }
}

