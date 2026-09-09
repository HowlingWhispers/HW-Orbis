import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const models = ['xialong-v1', 'glm-4-6'] as const;
const settingsSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  model: z.enum(models).default('xialong-v1'),
});

export type SealedCredential = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

export function credentialKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ORBIS_CREDENTIAL_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.');
  return key;
}

export function sealCredential(token: string, key: Buffer): SealedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function openCredential(sealed: SealedCredential, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

export function createProviderSettingsRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();

  router.use((request, response, next) => {
    if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to manage provider settings.' });
    next();
  });

  router.get('/novelai', async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT model, updated_at FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`,
        [request.session.userId],
      );
      response.json(result.rowCount
        ? { configured: true, model: result.rows[0].model, updatedAt: result.rows[0].updated_at }
        : { configured: false, model: 'xialong-v1' });
    } catch (error) { next(error); }
  });

  router.put('/novelai', async (request, response, next) => {
    try {
      const value = settingsSchema.parse(request.body);
      const sealed = sealCredential(value.token, credentialKey(config.ORBIS_CREDENTIAL_ENCRYPTION_KEY));
      const result = await pool.query(
        `INSERT INTO user_provider_settings (user_id, provider, token_ciphertext, token_iv, token_tag, model)
         VALUES ($1, 'novelai', $2, $3, $4, $5)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv,
           token_tag = excluded.token_tag, model = excluded.model, updated_at = now()
         RETURNING model, updated_at`,
        [request.session.userId, sealed.ciphertext, sealed.iv, sealed.tag, value.model],
      );
      response.json({ configured: true, model: result.rows[0].model, updatedAt: result.rows[0].updated_at });
    } catch (error) { next(error); }
  });

  router.delete('/novelai', async (request, response, next) => {
    try {
      await pool.query(`DELETE FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`, [request.session.userId]);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}
