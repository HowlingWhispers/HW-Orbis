import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectPgSimple from 'connect-pg-simple';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { createAuthRouter } from './auth.js';
import { createCodaAssistantRouter } from './coda-assistant.js';
import { processDueCodaScheduledMessages } from './coda-discord.js';
import { createArchiveTransferRouter } from './archive-transfer.js';
import { createAdminRouter, requireAdmin } from './admin.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLibraryRouter } from './library.js';
import { createProviderSettingsRouter } from './provider-settings.js';
import { createSaveArchiveRouter } from './save-archive.js';
import { createSimulationSettingsRouter } from './simulation-settings.js';
import { PostgresSettingsStore } from './settings.js';
import { createSpeculusGenerationRouter, createSpeculusLaunchRouter } from './speculus.js';
import { createWorldDeleteRouter } from './world-delete.js';
import { createWorldBrainRouter } from './world-brain.js';
import { canDiscoverAssetRow } from './world-access.js';
import './types.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const settingsStore = new PostgresSettingsStore(pool, config);
const PgStore = connectPgSimple(session);
const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
// Savegame payloads can contain long transcripts. Keep the larger parser scoped to
// Library routes instead of raising the body limit for the whole Orbis API.
app.use('/api/v1/library', express.json({ limit: '16mb' }));
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
    response.json({ ok: true, service: 'orbis-api' });
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

app.get('/sitemap.xml', async (_request, response, next) => {
  try {
    const baseUrl = 'https://lib.thehowlingwhispers.com';
    const assetTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;

    // Sitemap discovery follows the same public-world policy as Orbis browse/search.
    // Child records inherit the visibility of their origin world.
    const result = await pool.query(`
      SELECT a.id, a.type, a.updated_at, a.creator_user_id, a.document,
        origin.document AS origin_world_document,
        origin.creator_user_id AS origin_world_creator_user_id
      FROM library_assets a
      LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
      WHERE a.content_rating = 'sfw'
      ORDER BY a.updated_at DESC
    `);

    const staticUrls = [
      { url: '/', changefreq: 'daily', priority: '1.0', lastmod: '' },
      { url: '/all', changefreq: 'daily', priority: '0.9', lastmod: '' },
      ...assetTypes.map(type => ({ url: `/library/${type}`, changefreq: 'daily', priority: '0.8', lastmod: '' })),
      { url: '/projects/speculus', changefreq: 'weekly', priority: '0.7', lastmod: '' },
    ];

    const assetUrls = result.rows
      .filter((row) => canDiscoverAssetRow(row))
      .map(row => ({
        url: `/asset/${row.id}`,
        lastmod: new Date(row.updated_at).toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: '0.6',
      }));

    const allUrls = [...staticUrls, ...assetUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${baseUrl}${u.url}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    response.set('Content-Type', 'application/xml; charset=utf-8');
    response.set('Cache-Control', 'public, max-age=3600');
    response.send(xml);
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', createAuthRouter(config, pool, settingsStore));
app.use('/api/provider-settings', createProviderSettingsRouter(config, pool));
app.use('/api/coda-assistant', createCodaAssistantRouter(config, pool, settingsStore));
app.use('/api/simulation-settings', createSimulationSettingsRouter(pool));
app.use('/api/admin', requireAdmin(config, pool, settingsStore), createAdminRouter(config, pool, settingsStore));
app.use('/api/v1/library', createSpeculusLaunchRouter(config, pool, settingsStore));
app.use('/api/v1/library', createSaveArchiveRouter(pool));
app.use('/api/v1/library', createWorldDeleteRouter(pool));
app.use('/api/v1/library', createWorldBrainRouter(pool));
app.use('/api/v1/library', createArchiveTransferRouter(config, pool, settingsStore));
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
  response.status(500).json({ error: 'Orbis could not complete that request.' });
});

const server = app.listen(config.PORT, config.isProduction ? '127.0.0.1' : '0.0.0.0', () => console.log(`Orbis API listening on ${config.PORT}`));

let codaSchedulerBusy = false;
const codaScheduler = setInterval(async () => {
  if (codaSchedulerBusy) return;
  codaSchedulerBusy = true;
  try {
    const settings = await settingsStore.getEffective();
    await processDueCodaScheduledMessages(config, pool, settings.guildId);
  } catch (error) {
    console.error('Coda scheduler tick failed.', error);
  } finally {
    codaSchedulerBusy = false;
  }
}, 30_000);
codaScheduler.unref();

const shutdown = () => {
  clearInterval(codaScheduler);
  server.close(() => pool.end().finally(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
