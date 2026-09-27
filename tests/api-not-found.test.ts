import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiNotFound } from '../server/api-not-found';

/**
 * The single-page fallback is mounted last and answers every unmatched GET with
 * index.html and a 200. These tests pin the ordering that keeps API callers on
 * JSON, which is what turns a frontend/backend version skew into a readable 404
 * instead of an opaque "Unexpected token '<'" inside a client fetch.
 */
function app() {
  const application = express();
  application.get('/api/health', (_request, response) => response.json({ ok: true }));
  application.get('/api/admin/overview', (_request, response) => response.json({ status: {} }));
  application.use('/api', apiNotFound);
  // Mirrors the production SPA catch-all that used to swallow API paths.
  application.get('*splat', (_request, response) => {
    response.status(200).type('html').send('<!doctype html><title>Orbis</title>');
  });
  return application;
}

describe('unmatched API routes', () => {
  it('answers a missing endpoint with JSON 404, not the single-page app', async () => {
    const response = await request(app()).get('/api/admin/view-preferences');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error).toMatch(/does not exist/i);
  });

  it('does not intercept API routes that are actually mounted', async () => {
    const health = await request(app()).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const overview = await request(app()).get('/api/admin/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.status).toEqual({});
  });

  it('still serves index.html for client-side routes outside /api', async () => {
    const response = await request(app()).get('/worlds/some-world');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('Orbis');
  });

  it('tells the caller to reload, because a stale page is the usual cause', async () => {
    const response = await request(app()).get('/api/v1/library/assets/not-a-route/images');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/reload/i);
  });
});
