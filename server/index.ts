import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectPgSimple from 'connect-pg-simple';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { createAuthRouter } from './auth.js';
import { createAdminRouter, requireAdmin } from './admin.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLibraryRouter } from './library.js';
import { createProviderSettingsRouter } from './provider-settings.js';
import { PostgresSettingsStore } from './settings.js';
import { createSpeculusGenerationRouter, createSpeculusLaunchRouter } from './speculus.js';
import './types.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const settingsStore = new PostgresSettingsStore(pool, config);
const PgStore = connectPgSimple(session);
const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));
app.use(session({
  name: config.SESSION_COOKIE_NAME,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: config.trustProxy,
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
  cookie: { httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' },
}));

// Speculus authenticates this server-to-server route with an opaque generation grant,
// so it intentionally sits outside the browser Origin check below.
app.use('/api/v1/generation', createSpeculusGenerationRouter(config, pool));

app.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const origin = request.get('origin');
  if ((config.isProduction || origin) && origin !== config.APP_ORIGIN) return response.status(403).json({ error: 'Invalid request origin.' });
  next();
});

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, service: 'coda-api' });
  } catch (error) {
    next(error);
  }
});
app.get('/api/config/public', async (_request, response, next) => {
  try {
    const settings = await settingsStore.getEffective();
    response.json({ discordInviteUrl: settings.inviteUrl });
  } catch (error) { next(error); }
});
app.use('/api/auth', createAuthRouter(config, pool, settingsStore));
app.use('/api/provider-settings', createProviderSettingsRouter(config, pool));
app.use('/api/admin', requireAdmin(config, pool, settingsStore), createAdminRouter(config, pool, settingsStore));
app.use('/api/v1/library', createSpeculusLaunchRouter(config, pool, settingsStore));
app.use('/api/v1/library', createLibraryRouter(config, pool, settingsStore));

if (config.isProduction) {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.resolve(currentDirectory, '../dist');
  app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
  app.get('*splat', (_request, response) => response.sendFile(path.join(webRoot, 'index.html')));
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return response.status(400).json({ error: 'Invalid request.', details: error.issues });
  console.error(error);
  response.status(500).json({ error: 'Coda could not complete that request.' });
});

const server = app.listen(config.PORT, () => console.log(`Coda API listening on ${config.PORT}`));

const shutdown = () => server.close(() => pool.end().finally(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
