// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChangelogRouter, readAcknowledgedChangelogVersion } from '../server/changelog';
import { compareChangelogVersions, publicChangelogEntries, unreadChangelogEntries } from '../server/public-changelog';
import type { DatabasePool } from '../server/db';

const repoRoot = join(import.meta.dirname, '..');
const userId = '11111111-1111-4111-8111-111111111111';

function app(pool: unknown, session: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: session, configurable: true });
    next();
  });
  app.use('/api/v1/changelog', createChangelogRouter(pool as DatabasePool));
  return app;
}

/** Pool that behaves like a healthy deployment. */
function workingPool() {
  const writes: unknown[][] = [];
  let acknowledged = '';
  return {
    writes,
    setAcknowledged: (value: string) => { acknowledged = value; },
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM user_changelog_state')) return { rows: [{ acknowledged_version: acknowledged }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO user_changelog_state')) {
        writes.push(values ?? []);
        acknowledged = String(values?.[1] ?? '');
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT adult_access_override FROM users')) return { rows: [{ adult_access_override: false }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

/** Pool whose migration has not been applied yet (rolling deploy). */
function unmigratedPool() {
  return {
    query: async () => {
      const error = new Error('relation "user_changelog_state" does not exist');
      (error as { code?: string }).code = '42P01';
      throw error;
    },
  };
}

/** Pool that fails for an unrelated reason. */
function brokenPool() {
  return { query: async () => { throw new Error('connection terminated unexpectedly'); } };
}

describe('public changelog data', () => {
  it('exposes a stable machine-readable version and ordered entries', () => {
    const latest = publicChangelogEntries[0];
    expect(latest.version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(Number.isNaN(new Date(latest.publishedAt).getTime())).toBe(false);
    for (let index = 1; index < publicChangelogEntries.length; index += 1) {
      expect(compareChangelogVersions(publicChangelogEntries[index - 1].version, publicChangelogEntries[index].version))
        .toBeGreaterThan(0);
    }
  });

  it('orders versions monotonically and treats unknown versions as oldest', () => {
    expect(compareChangelogVersions('2026.09.28.1', '2026.09.28.1')).toBe(0);
    expect(compareChangelogVersions('2026.10.01.1', '2026.09.28.9')).toBeGreaterThan(0);
    expect(compareChangelogVersions('2026.09.28.1', '2026.09.28.2')).toBeLessThan(0);
    expect(compareChangelogVersions('2026.09.28.1', '')).toBeGreaterThan(0);
    expect(compareChangelogVersions('2026.09.28.1', 'not-a-version')).toBeGreaterThan(0);
  });

  it('returns every entry as unread for a member who has never acknowledged', () => {
    expect(unreadChangelogEntries('').map((entry) => entry.version)).toEqual(publicChangelogEntries.map((entry) => entry.version));
  });

  it('only counts entries strictly newer than the acknowledgement', () => {
    expect(unreadChangelogEntries(null)).toHaveLength(publicChangelogEntries.length);
    const latest = publicChangelogEntries[0].version;
    expect(unreadChangelogEntries(latest)).toHaveLength(0);
    // An acknowledgement the account holds from a version that no longer exists
    // must not hide newer entries, or a missed release would be lost.
    expect(unreadChangelogEntries('2020.01.01.1')).toHaveLength(publicChangelogEntries.length);
    if (publicChangelogEntries.length > 1) {
      const second = publicChangelogEntries[1].version;
      expect(unreadChangelogEntries(second).map((entry) => entry.version)).toEqual([latest]);
    }
  });
});

describe('GET /api/v1/changelog', () => {
  it('serves the latest changelog to an anonymous visitor', async () => {
    const response = await request(app(workingPool())).get('/api/v1/changelog').expect(200);
    expect(response.body.latest.version).toBe(publicChangelogEntries[0].version);
    expect(response.body.entries.length).toBeGreaterThan(0);
    // No account means nothing to compare against, so no automatic notice.
    expect(response.body.unreadVersions).toBeNull();
  });

  it('reports unread versions for a signed-in member who has not acknowledged', async () => {
    const response = await request(app(workingPool(), { userId })).get('/api/v1/changelog').expect(200);
    expect(response.body.unreadVersions).toEqual(publicChangelogEntries.map((entry) => entry.version));
  });

  it('reports nothing unread once the account has acknowledged the latest version', async () => {
    const pool = workingPool();
    pool.setAcknowledged(publicChangelogEntries[0].version);
    const response = await request(app(pool, { userId })).get('/api/v1/changelog').expect(200);
    expect(response.body.unreadVersions).toEqual([]);
  });

  it('still serves the public changelog when the acknowledgement store is unavailable', async () => {
    const response = await request(app(unmigratedPool(), { userId })).get('/api/v1/changelog').expect(200);
    expect(response.body.latest.version).toBe(publicChangelogEntries[0].version);
    expect(response.body.unreadVersions).toBeNull();
  });

  it('still serves the public changelog when the database itself fails', async () => {
    const response = await request(app(brokenPool(), { userId })).get('/api/v1/changelog').expect(200);
    expect(response.body.latest.version).toBe(publicChangelogEntries[0].version);
    expect(response.body.unreadVersions).toBeNull();
  });
});

describe('changelog acknowledgement', () => {
  it('requires a session to read or write an acknowledgement', async () => {
    await request(app(workingPool())).get('/api/v1/changelog/acknowledgement').expect(401);
    await request(app(workingPool())).put('/api/v1/changelog/acknowledgement').send({ version: '2026.09.28.1' }).expect(401);
  });

  it('stores the acknowledged version against the account', async () => {
    const pool = workingPool();
    const version = publicChangelogEntries[0].version;
    const response = await request(app(pool, { userId })).put('/api/v1/changelog/acknowledgement').send({ version }).expect(200);
    expect(response.body).toEqual({ version, available: true });
    expect(pool.writes).toHaveLength(1);
    expect(pool.writes[0]).toEqual([userId, version]);
  });

  it('reads back the stored acknowledgement', async () => {
    const pool = workingPool();
    const version = publicChangelogEntries[0].version;
    await request(app(pool, { userId })).put('/api/v1/changelog/acknowledgement').send({ version }).expect(200);
    expect(await readAcknowledgedChangelogVersion(pool as unknown as DatabasePool, userId)).toEqual({ version, available: true });
  });

  it('rejects an unpublished version', async () => {
    const pool = workingPool();
    await request(app(pool, { userId })).put('/api/v1/changelog/acknowledgement').send({ version: '2999.01.01.1' }).expect(400);
    expect(pool.writes).toHaveLength(0);
  });

  it('never moves the marker backwards', async () => {
    const pool = workingPool();
    const version = publicChangelogEntries[0].version;
    await request(app(pool, { userId })).put('/api/v1/changelog/acknowledgement').send({ version }).expect(200);
    pool.writes.length = 0;
    const response = await request(app(pool, { userId })).put('/api/v1/changelog/acknowledgement').send({ version: '2020.01.01.1' }).expect(400);
    expect(response.status).toBe(400);
    expect(pool.writes).toHaveLength(0);
  });

  it('reports unavailability instead of failing when the migration is missing', async () => {
    const response = await request(app(unmigratedPool(), { userId }))
      .put('/api/v1/changelog/acknowledgement').send({ version: publicChangelogEntries[0].version }).expect(503);
    expect(response.body.error).toMatch(/not installed/i);
  });
});

describe('public changelog sanitization', () => {
  const source = readFileSync(join(repoRoot, 'server/public-changelog.ts'), 'utf8');

  it('contains no private, credential, infrastructure or hidden-authority content', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
      ['database connection', /postgres(?:ql)?:\/\//i],
      ['server filesystem path', /\/srv\/|\/var\/www|dist-server|node_modules/i],
      ['secret or token', /\b(?:token|secret|password|api[_-]?key|credential)\b/i],
      ['hidden administrative authority', /super-?admin|site-?owner|bootstrap role|moderation override/i],
      ['recovery or repair mechanics', /recovery access|override access|repair tool|maintenance bypass|restore tool/i],
      ['internal operational vocabulary', /migration|backups?\b|\bdump\b|schema|insert into|select .* from /i],
      ['commit reference', /\bcommit\b|\bsha\b|\b[0-9a-f]{7,40}\b/i],
    ];
    for (const [label, pattern] of forbidden) {
      // The sanitization guidance itself is allowed to name these concepts; only
      // the published entry copy is checked.
      const entryCopy = source.slice(source.indexOf('export const publicChangelogEntries'));
      expect(entryCopy, `public changelog entry copy must not contain ${label}`).not.toMatch(pattern);
    }
  });

  it('never names a specific world in published copy', () => {
    const entryCopy = source.slice(source.indexOf('export const publicChangelogEntries'));
    // Proper nouns and quoted names would indicate a specific world leaking in.
    expect(entryCopy).not.toMatch(/Hollowmere|Bitterroot|Brackenjaw|Whispering Woods|Eirvargr/i);
  });

  it('keeps the published copy free of developer implementation vocabulary', () => {
    const entryCopy = source.slice(source.indexOf('export const publicChangelogEntries'));
    expect(entryCopy).not.toMatch(/origin_world_id|library_assets|worldEntryId|projection|canonical row|embedded array/i);
  });

  it('describes user-visible outcomes in every published section', () => {
    for (const entry of publicChangelogEntries) {
      expect(entry.sections.length).toBeGreaterThan(0);
      for (const section of entry.sections) {
        expect(section.id).toMatch(/^[a-z0-9-]+$/);
        expect(section.items.length).toBeGreaterThan(0);
        for (const item of section.items) {
          expect(item.trim().length).toBeGreaterThan(0);
          expect(item.endsWith('.')).toBe(true);
        }
      }
    }
  });
});
