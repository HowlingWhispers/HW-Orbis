import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { addAllowedDiscordUser, listAllowedDiscordUsers, readPoolParticipation, removeAllowedDiscordUser, setPoolParticipation } from './coda-shared-key-pool.js';

const migrationMissing = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

const models = ['xialong-v1', 'glm-4-6'] as const;
const settingsSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  model: z.enum(models).default('xialong-v1'),
});
const sharedUseSchema = z.object({ enabled: z.boolean() }).strict();
const snowflake = z.string().trim().regex(/^[0-9]{17,20}$/, 'Use an exact Discord user ID.');
const allowedUserSchema = z.object({ discordId: snowflake }).strict();
const allowedUserPathSchema = z.object({ discordId: snowflake }).strict();

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
      const participation = await readPoolParticipation(pool, request.session.userId!);
      response.json({
        ...(result.rowCount
          ? { configured: true, model: result.rows[0].model, updatedAt: result.rows[0].updated_at }
          : { configured: false, model: 'xialong-v1' }),
        // Always explicit, and reported separately from whether a key exists so
        // the account UI can never imply that connecting a key opts you in.
        sharedUse: participation.participating,
        sharedUseAvailable: participation.available,
      });
    } catch (error) { next(error); }
  });

  /**
   * Explicit opt-in to the Discord Coda shared-provider pool.
   *
   * Connecting a NovelAI key never enrols it here, and revoking leaves the
   * personal provider configuration untouched. Reads are uncached, so a change
   * takes effect on the next request without a restart.
   */
  router.put('/novelai/shared-use', async (request, response, next) => {
    try {
      const { enabled } = sharedUseSchema.parse(request.body);
      const hasCredential = await pool.query(
        `SELECT 1 FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`,
        [request.session.userId],
      );
      if (enabled && !hasCredential.rowCount) {
        return response.status(409).json({
          error: 'Connect a NovelAI key in Orbis before letting it help power Discord Coda.',
        });
      }
      const result = await setPoolParticipation(pool, request.session.userId!, enabled);
      response.json({ sharedUse: result.participating });
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Discord Coda shared use is not installed yet.' });
      next(error);
    }
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

  /**
   * The Discord accounts this owner trusts with their credential.
   *
   * Consent is scoped to named people rather than granted wholesale, so this is
   * the control that actually decides who the owner's allowance may serve. It
   * accepts any Discord snowflake, including an account that has never linked
   * an Orbis user, because the person being helped may be a guest.
   */
  router.get('/novelai/shared-use/allowed', async (request, response, next) => {
    try {
      response.json(await listAllowedDiscordUsers(pool, request.session.userId!));
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Trusted Discord users are not installed yet.', available: false });
      next(error);
    }
  });

  router.post('/novelai/shared-use/allowed', async (request, response, next) => {
    try {
      const parsed = allowedUserSchema.safeParse(request.body);
      // A malformed snowflake is the caller's mistake, not a server failure, and
      // must be refused rather than stored.
      if (!parsed.success) return response.status(400).json({ error: 'Use an exact Discord user ID: 17 to 20 digits.' });
      await addAllowedDiscordUser(pool, request.session.userId!, parsed.data.discordId);
      response.json(await listAllowedDiscordUsers(pool, request.session.userId!));
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Trusted Discord users are not installed yet.', available: false });
      next(error);
    }
  });

  router.delete('/novelai/shared-use/allowed/:discordId', async (request, response, next) => {
    try {
      const parsed = allowedUserPathSchema.safeParse(request.params);
      if (!parsed.success) return response.status(400).json({ error: 'Use an exact Discord user ID: 17 to 20 digits.' });
      await removeAllowedDiscordUser(pool, request.session.userId!, parsed.data.discordId);
      response.json(await listAllowedDiscordUsers(pool, request.session.userId!));
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Trusted Discord users are not installed yet.', available: false });
      next(error);
    }
  });

  router.delete('/novelai', async (request, response, next) => {
    try {
      await pool.query(`DELETE FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`, [request.session.userId]);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}
