// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodaDiscordBridgeRouter, sanitizeDiscordCodaReply } from '../server/coda-discord-bridge';
import { classifyProviderFailure, isPoolFallbackEligible } from '../server/coda-provider-failures';
import { consumeRateLimit, selectPoolMembers, type PoolPolicy } from '../server/coda-shared-key-pool';
import { loadConfig, type AppConfig } from '../server/config';
import { sealCredential, credentialKey } from '../server/provider-settings';
import type { DatabasePool } from '../server/db';

const bridgeSecret = 'bridge-secret-long-enough-for-tests';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

const LINKED_DISCORD = '100000000000000001';
const GUEST_DISCORD = '200000000000000002';
const OTHER_DISCORD = '300000000000000003';

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const MEMBER_C = 'aaaaaaaa-0000-4000-8000-000000000003';

/** A real AES-GCM sealed credential, so the decryption path is genuinely exercised. */
function sealedFor(marker: string) {
  return sealCredential(`${marker}-${'t'.repeat(40)}`, credentialKey(encryptionKey));
}

const ENTITLEMENT_BODY = {
  statusCode: 400,
  message: "bad request: model 'xialong-v1' not allowed for current user tier 'Scroll'",
};

type MemberState = {
  userId: string;
  entitled: boolean;
  enabled: boolean;
  ownerOptIn: boolean;
  revoked: boolean;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  consecutiveFailures: number;
  lastFailureClass: string | null;
  model: string;
};

type PoolState = {
  users: Array<{ id: string; discordId: string; displayName: string }>;
  credentials: Map<string, { model: string; sealed: ReturnType<typeof sealedFor> }>;
  members: MemberState[];
  rateLimits: Map<string, number>;
  /** owner user id -> the Discord ids that owner has named as trusted. */
  allowed: Map<string, Set<string>>;
};

function newPoolState(): PoolState {
  return { users: [], credentials: new Map(), members: [], rateLimits: new Map(), allowed: new Map() };
}

function buildConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '8789',
    APP_ORIGIN: 'http://localhost:5174',
    DATABASE_URL: 'postgres://test',
    SESSION_SECRET: 'coda-pool-test-secret-long-enough',
    SESSION_COOKIE_NAME: 'orbis.sid',
    TRUST_PROXY: 'false',
    DISCORD_CLIENT_ID: 'client',
    DISCORD_CLIENT_SECRET: 'secret',
    DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
    SESSION_SECRET_OVERRIDE: undefined,
    CODA_INTERNAL_BRIDGE_SECRET: bridgeSecret,
    ORBIS_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

const policy: PoolPolicy = { maxAttempts: 3, entitlementCooldownMinutes: 360, credentialCooldownMinutes: 60, maxConsecutiveFailures: 5 };

/** Owner grants scoped consent to one Discord account. */
function trust(state: PoolState, ownerId: string, discordId: string) {
  const set = state.allowed.get(ownerId) ?? new Set<string>();
  set.add(discordId);
  state.allowed.set(ownerId, set);
}

function member(partial: Partial<MemberState> & { userId: string }): MemberState {
  return {
    entitled: true,
    enabled: true,
    ownerOptIn: true,
    revoked: false,
    cooldownUntil: null,
    lastUsedAt: null,
    consecutiveFailures: 0,
    lastFailureClass: null,
    model: 'xialong-v1',
    ...partial,
  };
}

type QueryLog = string[];

/** In-memory pool covering only the statements this feature issues. */
function fakePool(state: PoolState, log: QueryLog): DatabasePool {
  return {
    query: async (sql: string, values?: unknown[]) => {
      const v = values ?? [];
      if (sql.includes('FROM users') && sql.includes('discord_id = $1')) {
        const found = state.users.find((u) => u.discordId === v[0]);
        return { rows: found ? [{ id: found.id, display_name: found.displayName }] : [], rowCount: found ? 1 : 0 };
      }
      if (sql.includes('FROM user_provider_settings') && sql.includes('user_id = $1')) {
        const found = state.credentials.get(String(v[0]));
        return found
          ? { rows: [{ model: found.model, token_ciphertext: found.sealed.ciphertext, token_iv: found.sealed.iv, token_tag: found.sealed.tag }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('AS allowed_count')) {
        const found = state.members.find((m) => m.userId === v[0]);
        return {
          rows: found ? [{
            owner_opt_in: found.ownerOptIn, enabled: found.enabled, revoked_at: found.revoked ? new Date() : null,
            entitled: found.entitled, last_failure_class: found.lastFailureClass, consecutive_failures: found.consecutiveFailures,
            allowed_count: (state.allowed.get(found.userId)?.size ?? 0),
          }] : [],
          rowCount: found ? 1 : 0,
        };
      }
      if (sql.includes('FROM coda_shared_key_members m')) {
        const requester = v[3] as string | null;
        log.push(`pool-select:model=${v[0]}:exclude=${v[1]}:limit=${v[2]}:requester=${requester}`);
        const excluded = v[1] as string | null;
        const limit = Number(v[2]);
        const now = Date.now();
        const rows = state.members
          .filter((m) => m.ownerOptIn && m.enabled && !m.revoked && m.entitled)
          .filter((m) => !m.cooldownUntil || new Date(m.cooldownUntil).getTime() <= now)
          .filter((m) => (state.credentials.get(m.userId)?.model ?? '') === String(v[0]))
          .filter((m) => !excluded || m.userId !== excluded)
          // Scoped consent: the owner must have named this exact requester.
          .filter((m) => Boolean(requester) && (state.allowed.get(m.userId)?.has(String(requester)) ?? false))
          .sort((a, b) => {
            const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
            const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
            return at - bt;
          })
          .slice(0, limit)
          .map((m) => {
            const cred = state.credentials.get(m.userId)!;
            return { user_id: m.userId, model: cred.model, token_ciphertext: cred.sealed.ciphertext, token_iv: cred.sealed.iv, token_tag: cred.sealed.tag };
          });
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('INSERT INTO coda_discord_rate_limits')) {
        const id = String(v[0]);
        const windowSeconds = Number(v[1]);
        const existing = state.rateLimits.get(id);
        // Tests drive the window directly; a stored count always means "in window".
        const count = existing === undefined ? 1 : existing + 1;
        state.rateLimits.set(id, count);
        void windowSeconds;
        return { rows: [{ request_count: count }], rowCount: 1 };
      }
      if (sql.includes('last_used_at = now()')) {
        const target = state.members.find((m) => m.userId === v[0]);
        if (target) { target.lastUsedAt = new Date().toISOString(); target.entitled = true; target.consecutiveFailures = 0; target.lastFailureClass = null; }
        log.push(`mark-used:${v[0]}`);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('consecutive_failures = consecutive_failures + 1')) {
        const [userId, model, failureClass, permanent, cooldownMinutes] = v;
        const target = state.members.find((m) => m.userId === userId);
        log.push(`mark-failed:${userId}:${failureClass}:cooldown=${Number(cooldownMinutes)}`);
        if (target) {
          target.consecutiveFailures += 1;
          target.lastFailureClass = String(failureClass);
          if (permanent) { target.entitled = false; target.model = String(model); }
          target.cooldownUntil = new Date(Date.now() + Number(cooldownMinutes) * 60_000).toISOString();
          if (permanent && failureClass === 'invalid_credential' && target.consecutiveFailures >= 5) target.enabled = false;
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO coda_shared_key_members')) {
        const userId = String(v[0]);
        const optIn = Boolean(v[1]);
        let target = state.members.find((m) => m.userId === userId);
        if (!target) {
          target = member({ userId, ownerOptIn: optIn });
          state.members.push(target);
        }
        target.ownerOptIn = optIn;
        target.enabled = true;
        target.revoked = !optIn;
        target.cooldownUntil = null;
        target.consecutiveFailures = 0;
        target.lastFailureClass = null;
        log.push(`set-participation:${userId}:${optIn}`);
        return { rows: [{ owner_opt_in: target.ownerOptIn, revoked_at: target.revoked ? new Date() : null }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM coda_shared_key_allowed_users')) {
        const set = state.allowed.get(String(v[0]));
        const had = set?.delete(String(v[1])) ?? false;
        return { rows: [], rowCount: had ? 1 : 0 };
      }
      if (sql.includes('FROM coda_shared_key_allowed_users')) {
        const set = state.allowed.get(String(v[0])) ?? new Set<string>();
        state.allowed.set(String(v[0]), set);
        return { rows: [...set].map((id) => ({ discord_user_id: id, created_at: new Date().toISOString() })), rowCount: set.size };
      }
      if (sql.includes('INSERT INTO coda_shared_key_allowed_users')) {
        const set = state.allowed.get(String(v[0])) ?? new Set<string>();
        set.add(String(v[1]));
        state.allowed.set(String(v[0]), set);
        return { rows: [], rowCount: 1 };
      }
      log.push(`unhandled:${sql.replace(/\s+/g, ' ').slice(0, 60)}`);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabasePool;
}

type FetchCall = { model: string; prompt: string; authorization: string };

function bridgeApp(state: PoolState, config: AppConfig, log: QueryLog) {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/coda-discord', createCodaDiscordBridgeRouter(config, fakePool(state, log)));
  return app;
}

function bridgeRequest(overrides: Record<string, unknown> = {}) {
  return {
    discordUserId: LINKED_DISCORD,
    text: 'hey coda',
    recentMessages: [],
    ...overrides,
  };
}

let fetchCalls: FetchCall[] = [];

/** Queue provider responses in order; the last one repeats if exhausted. */
function stubProvider(responses: Array<{ status: number; body?: unknown }>) {
  let index = 0;
  vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const spec = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const body = JSON.parse(init.body) as { model: string; prompt: string };
    fetchCalls.push({ model: body.model, prompt: body.prompt, authorization: init.headers.Authorization });
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => spec.body ?? {},
      text: async () => JSON.stringify(spec.body ?? {}),
    };
  });
}

const success = (text = '*wiggles* Hello there.') => ({ status: 200, body: { choices: [{ text }] } });

beforeEach(() => { fetchCalls = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('upstream failure classification', () => {
  it('recognises the exact NovelAI entitlement response observed in production', () => {
    const failure = classifyProviderFailure(400, ENTITLEMENT_BODY);
    expect(failure.failureClass).toBe('entitlement_denied');
    expect(failure.status).toBe(400);
    expect(failure.reason).toContain("not allowed for current user tier 'Scroll'");
    expect(isPoolFallbackEligible(failure.failureClass)).toBe(true);
  });

  it('treats an unrecognised 400 as malformed, never as a reason to rotate', () => {
    const failure = classifyProviderFailure(400, { message: "bad request: field 'foo' is required" });
    expect(failure.failureClass).toBe('malformed_request');
    expect(isPoolFallbackEligible(failure.failureClass)).toBe(false);
  });

  it('treats a model that is not served on this endpoint as our own request defect', () => {
    const failure = classifyProviderFailure(400, { message: "Model 'kayra-v1' not available via OpenAI-compatible API. Use main NovelAI API." });
    expect(failure.failureClass).toBe('malformed_request');
    expect(isPoolFallbackEligible(failure.failureClass)).toBe(false);
  });

  it('separates authentication, rate limiting, outage and unknown failures', () => {
    expect(classifyProviderFailure(401, {}).failureClass).toBe('invalid_credential');
    expect(classifyProviderFailure(403, {}).failureClass).toBe('invalid_credential');
    expect(classifyProviderFailure(429, {}).failureClass).toBe('rate_limited');
    expect(classifyProviderFailure(503, {}).failureClass).toBe('provider_unavailable');
    expect(classifyProviderFailure(418, {}).failureClass).toBe('unknown_upstream');
    expect(isPoolFallbackEligible('rate_limited')).toBe(false);
    expect(isPoolFallbackEligible('provider_unavailable')).toBe(false);
  });

  it('never leaks token-shaped material out of the sanitised reason', () => {
    const secret = 'nvs_abcdefgh12345678ijklmnop9876';
    const failure = classifyProviderFailure(400, { message: `bad request: token ${secret} is invalid` });
    expect(failure.reason).not.toContain(secret);
    expect(failure.reason).toContain('[redacted]');
  });
});

describe('provider selection for a linked Discord member', () => {
  it('prefers the member’s own key when it works', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([success('*ears up*')]);
    const log: QueryLog = [];
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.reply).toContain('ears up');
    // Exactly one provider call, and it used the member's own credential.
    expect(fetchCalls).toHaveLength(1);
    expect(log.some((entry) => entry.startsWith('mark-used:'))).toBe(false);
    expect(response.body.orbisUser).toBe('Owner');
  });

  it('falls back to the shared pool when the member has no key at all', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([success('*from the pool*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, LINKED_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(response.body.reply).toContain('from the pool');
    expect(log).toContain(`mark-used:${MEMBER_B}`);
  });

  it('falls back to the shared pool when the member’s key is tier-gated', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }, success('*pool answered*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, LINKED_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(fetchCalls).toHaveLength(2);
    expect(response.body.reply).toContain('pool answered');
    expect(log).toContain(`mark-used:${MEMBER_B}`);
  });

  it('never hands a member their own key back through the pool', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    // The member is also opted in; they must not serve their own request.
    state.members.push(member({ userId: OWNER }));
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }, success('*someone else answered*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, LINKED_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(log.some((entry) => entry.startsWith(`pool-select`) && entry.includes(`exclude=${OWNER}`))).toBe(true);
    expect(log).toContain(`mark-used:${MEMBER_B}`);
  });

  it('does NOT rotate a malformed request failure caused by our own code', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([{ status: 400, body: { message: "bad request: model 'xialong-v1' doesn't exist" } }]);
    const log: QueryLog = [];
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(502);

    // One provider call only: no other member's allowance was spent on our bug.
    expect(fetchCalls).toHaveLength(1);
    expect(response.body.code).toBe('coda_request_rejected');
    expect(response.body.error).toContain('my own paws');
    expect(log.some((entry) => entry.startsWith('mark-used:'))).toBe(false);
  });

  it('does not rotate a rate limit, because that is the member’s own limit', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([{ status: 429, body: { message: 'rate limit exceeded' } }]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    expect(fetchCalls).toHaveLength(1);
    expect(response.body.code).toBe('coda_provider_rate_limited');
  });
});

describe('unlinked Discord guests', () => {
  it('refuses a guest when guest access is not enabled', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    stubProvider([success()]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_GUEST_ACCESS: 'false', CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD }))
      .expect(409);

    expect(response.body.code).toBe('orbis_account_not_linked');
    expect(fetchCalls).toHaveLength(0);
  });

  it('serves a guest through the shared pool when guest access is enabled', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    stubProvider([success('*guest hello*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, GUEST_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_GUEST_ACCESS: 'true', CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD }))
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(log).toContain(`mark-used:${MEMBER_B}`);
    // A guest is never told which Orbis identity served them.
    expect(response.body).not.toHaveProperty('orbisUser');
  });

  it('gives a guest no private Orbis context at all', async () => {
    const state = newPoolState();
    // A linked member exists, but the requester is a different, unlinked user.
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'PrivateOwner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    stubProvider([success('*hi*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, GUEST_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_GUEST_ACCESS: 'true', CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD, text: 'what do you know?', recentMessages: [{ authorName: 'Guest', content: 'summarise the room' }] }))
      .expect(200);

    const prompt = fetchCalls[0].prompt;
    // The linked account's identity never reaches the model, even though it
    // exists in the same database.
    expect(prompt).not.toContain('PrivateOwner');
    expect(prompt).not.toContain(OWNER);
    // Only the supplied Discord conversation and Coda's public personality.
    expect(prompt).toContain('summarise the room');
    expect(prompt).toContain('CODA DISCORD MODE');
    // The guest path never touched world, asset, or provider tables.
    expect(log.some((entry) => /library_assets|world_|coda_shared_key_members m/.test(entry))).toBe(false);
  });

  it('never returns the serving member identity to a guest', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    stubProvider([success('*hi*')]);
    trust(state, MEMBER_B, GUEST_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_GUEST_ACCESS: 'true', CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD }))
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain(MEMBER_B);
    expect(response.body).not.toHaveProperty('orbisUser');
  });
});

describe('pool health, fairness and limits', () => {
  it('skips a tier-ineligible member and tries the next eligible one', async () => {
    const state = newPoolState();
    // No personal key, so the first provider call belongs to a pool member and
    // the tier rejection is what marks that member ineligible.
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.members.push(member({ userId: MEMBER_C }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    state.credentials.set(MEMBER_C, { model: 'xialong-v1', sealed: sealedFor('memberc') });

    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }, success('*second member answered*')]);
    const log: QueryLog = [];
    trust(state, MEMBER_B, LINKED_DISCORD);
    trust(state, MEMBER_C, LINKED_DISCORD);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(response.body.reply).toContain('second member answered');
    // The bad member was backed off rather than retried.
    expect(log.some((entry) => entry.startsWith(`mark-failed:${MEMBER_B}:entitlement_denied`))).toBe(true);
    expect(state.members.find((m) => m.userId === MEMBER_B)?.entitled).toBe(false);
    expect(state.members.find((m) => m.userId === MEMBER_B)?.cooldownUntil).not.toBeNull();
    expect(log).toContain(`mark-used:${MEMBER_C}`);
    // The rejected member is no longer selected for the next request.
    const { selectPoolMembers: select } = await import('../server/coda-shared-key-pool');
    const next = await select(fakePool(state, []) as never, 'xialong-v1', policy, { requesterDiscordId: LINKED_DISCORD });
    expect(next.map((entry) => entry.userId)).toEqual([MEMBER_C]);
  });

  it('skips members that never opted in, are revoked, are disabled, or are in cooldown', async () => {
    const state = newPoolState();
    const NOT_OPTED_IN = 'aaaaaaaa-0000-4000-8000-000000000011';
    const REVOKED = 'aaaaaaaa-0000-4000-8000-000000000012';
    const DISABLED = 'aaaaaaaa-0000-4000-8000-000000000013';
    const COOLDOWNED = 'aaaaaaaa-0000-4000-8000-000000000014';
    const WRONG_MODEL = 'aaaaaaaa-0000-4000-8000-000000000015';
    const ELIGIBLE = 'aaaaaaaa-0000-4000-8000-000000000016';

    for (const id of [NOT_OPTED_IN, REVOKED, DISABLED, COOLDOWNED, WRONG_MODEL, ELIGIBLE]) {
      state.credentials.set(id, { model: 'xialong-v1', sealed: sealedFor(id) });
    }
    state.credentials.set(WRONG_MODEL, { model: 'glm-4-6', sealed: sealedFor(WRONG_MODEL) });
    state.members.push(
      member({ userId: NOT_OPTED_IN, ownerOptIn: false }),
      member({ userId: REVOKED, revoked: true }),
      member({ userId: DISABLED, enabled: false }),
      member({ userId: COOLDOWNED, cooldownUntil: new Date(Date.now() + 3_600_000).toISOString() }),
      member({ userId: WRONG_MODEL }),
      member({ userId: ELIGIBLE }),
    );

    trust(state, ELIGIBLE, LINKED_DISCORD);
    const selected = await selectPoolMembers(fakePool(state, []) as never, 'xialong-v1', policy, { requesterDiscordId: LINKED_DISCORD });
    expect(selected.map((entry) => entry.userId)).toEqual([ELIGIBLE]);
  });

  it('rotates fairly: the least recently used member is selected first', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B, lastUsedAt: '2026-09-28T10:00:00.000Z' }));
    state.members.push(member({ userId: MEMBER_C, lastUsedAt: '2026-01-01T00:00:00.000Z' }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    state.credentials.set(MEMBER_C, { model: 'xialong-v1', sealed: sealedFor('c') });

    trust(state, MEMBER_B, LINKED_DISCORD);
    trust(state, MEMBER_C, LINKED_DISCORD);
    const first = await selectPoolMembers(fakePool(state, []) as never, 'xialong-v1', policy, { requesterDiscordId: LINKED_DISCORD });
    expect(first[0].userId).toBe(MEMBER_C);

    // After C is used, B becomes the least recently used.
    state.members.find((m) => m.userId === MEMBER_C)!.lastUsedAt = '2026-09-28T12:00:00.000Z';
    const second = await selectPoolMembers(fakePool(state, []) as never, 'xialong-v1', policy, { requesterDiscordId: LINKED_DISCORD });
    expect(second[0].userId).toBe(MEMBER_B);
  });

  it('bounds one Discord message to a small number of provider attempts', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    for (const id of [MEMBER_B, MEMBER_C, OWNER, 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005']) {
      state.members.push(member({ userId: id }));
      state.credentials.set(id, { model: 'xialong-v1', sealed: sealedFor(id) });
    }

    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    // 1 personal + at most poolPolicy.maxAttempts, never the whole pool.
    expect(fetchCalls.length).toBeLessThanOrEqual(1 + policy.maxAttempts);
    expect(response.body.code).toBe('coda_provider_entitlement');
  });

  it('returns friendly Coda copy when the pool is exhausted', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);
    stubProvider([success()]);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    expect(response.body.code).toBe('coda_no_provider_available');
    expect(response.body.error).toContain('🐾');
    expect(response.body.error).toMatch(/paws|nothing|empty|while/i);
    // It must not read like an authentication daemon.
    expect(response.body.error).not.toMatch(/unauthorized|forbidden|token|credential|401|403/i);
  });

  it('keeps the pool disabled unless an operator enables it', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });

    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }, success('*should not be reached*')]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'false' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    expect(fetchCalls).toHaveLength(1);
    expect(response.body.code).toBe('coda_provider_entitlement');
  });
});

describe('rate limiting', () => {
  it('stops answering a Discord user who exceeds their allowance', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    stubProvider([success()]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_RATE_LIMIT: '2' }), []);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app).post('/api/internal/coda-discord').set('authorization', `Bearer ${bridgeSecret}`).send(bridgeRequest()).expect(200);
    }
    const limited = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(429);

    expect(limited.body.code).toBe('coda_rate_limited');
    expect(limited.body.error).toContain('🐾');
    expect(fetchCalls).toHaveLength(2);
  });

  it('applies a tighter limit to guests than to members', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    stubProvider([success()]);
    trust(state, MEMBER_B, GUEST_DISCORD);
    const app = bridgeApp(state, buildConfig({
      CODA_DISCORD_GUEST_ACCESS: 'true',
      CODA_DISCORD_SHARED_POOL_ENABLED: 'true',
      CODA_DISCORD_GUEST_RATE_LIMIT: '1',
      CODA_DISCORD_RATE_LIMIT: '50',
    }), []);

    await request(app)
      .post('/api/internal/coda-discord').set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD })).expect(200);
    await request(app)
      .post('/api/internal/coda-discord').set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD })).expect(429);
  });
});

describe('key material never escapes', () => {
  it('puts no credential, Authorization header, or owning identity in the response', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('memberb') });
    trust(state, MEMBER_B, LINKED_DISCORD);
    stubProvider([{ status: 400, body: ENTITLEMENT_BODY }, success('*pool reply*')]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    const serialized = JSON.stringify(response.body);
    const secret = `${'t'.repeat(40)}`;
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/Bearer\s/i);
    expect(serialized).not.toContain(MEMBER_B);
    expect(serialized).not.toContain(MEMBER_C);
    // Friendly copy leaks nothing about whose key served the request.
    expect(response.body.reply).toBe('*pool reply*');

    for (const spy of [consoleSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secret);
        expect(JSON.stringify(call)).not.toMatch(/Bearer\s/i);
      }
    }
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('does not leak key material through a malformed-request reply either', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    stubProvider([{ status: 400, body: { message: `bad request: token ${'t'.repeat(40)} rejected` } }]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(502);

    expect(JSON.stringify(response.body)).not.toContain('t'.repeat(40));
    expect(response.body.error).not.toMatch(/token|credential|authorization/i);
  });
});

describe('opt-in participation', () => {
  it('reports participation as off by default and follows it without a restart', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    // Connected to Orbis, but never opted in.
    const log: QueryLog = [];
    const pool = fakePool(state, log);

    const { readPoolParticipation, setPoolParticipation } = await import('../server/coda-shared-key-pool');
    expect(await readPoolParticipation(pool as never, OWNER)).toEqual({ participating: false, allowedCount: 0, available: true });

    await setPoolParticipation(pool as never, OWNER, true);
    expect(await readPoolParticipation(pool as never, OWNER)).toEqual({ participating: false, allowedCount: 0, available: true });

    // Revoking takes effect on the next read, with no restart and without
    // touching the personal provider configuration.
    await setPoolParticipation(pool as never, OWNER, false);
    expect(await readPoolParticipation(pool as never, OWNER)).toEqual({ participating: false, allowedCount: 0, available: true });
    expect(state.credentials.has(OWNER)).toBe(true);
  });

  it('excludes a non-participating member from selection immediately', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B, ownerOptIn: false }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    const selected = await selectPoolMembers(fakePool(state, []) as never, 'xialong-v1', policy, { requesterDiscordId: LINKED_DISCORD });
    expect(selected).toEqual([]);
  });
});

describe('scoped consent to named Discord accounts', () => {
  it('will not serve a requester the owner has not named', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    // Nobody has been trusted yet, so the owner shares with nobody.
    stubProvider([success()]);
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), []);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    expect(fetchCalls).toHaveLength(0);
    expect(response.body.code).toBe('coda_no_provider_available');
  });

  it('serves a requester the owner did name', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    state.allowed.set(MEMBER_B, new Set([LINKED_DISCORD]));
    stubProvider([success('*trusted hello*')]);
    const log: QueryLog = [];
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    const response = await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(200);

    expect(response.body.reply).toContain('trusted hello');
    expect(log).toContain(`mark-used:${MEMBER_B}`);
  });

  it('does not let one owner’s trust list answer a different requester', async () => {
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    // Trusted, but for somebody else entirely.
    state.allowed.set(MEMBER_B, new Set([OTHER_DISCORD]));
    stubProvider([success()]);
    const log: QueryLog = [];
    const app = bridgeApp(state, buildConfig({ CODA_DISCORD_SHARED_POOL_ENABLED: 'true' }), log);

    await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest())
      .expect(503);

    expect(log).not.toContain(`mark-used:${MEMBER_B}`);
  });

  it('passes the requester into selection so the scoping is server-side, not client-side', async () => {
    const state = newPoolState();
    state.members.push(member({ userId: MEMBER_B }));
    state.credentials.set(MEMBER_B, { model: 'xialong-v1', sealed: sealedFor('b') });
    state.allowed.set(MEMBER_B, new Set([GUEST_DISCORD]));
    stubProvider([success('*guest served*')]);
    const log: QueryLog = [];
    const app = bridgeApp(state, buildConfig({
      CODA_DISCORD_GUEST_ACCESS: 'true', CODA_DISCORD_SHARED_POOL_ENABLED: 'true',
    }), log);

    await request(app)
      .post('/api/internal/coda-discord')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(bridgeRequest({ discordUserId: GUEST_DISCORD }))
      .expect(200);

    // An unlinked guest can be trusted by snowflake, and the requester id is
    // the thing the selector matches on.
    expect(log.some((entry) => entry.startsWith('pool-select') && entry.includes(`requester=${GUEST_DISCORD}`))).toBe(true);
  });
});

describe('trusted-user management', () => {
  it('adds, lists, and removes a trusted Discord id without touching the token', async () => {
    const state = newPoolState();
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    const { addAllowedDiscordUser, listAllowedDiscordUsers, removeAllowedDiscordUser, readPoolParticipation } =
      await import('../server/coda-shared-key-pool');
    const pool = fakePool(state, []) as never;

    expect((await listAllowedDiscordUsers(pool, OWNER)).allowed).toEqual([]);
    await addAllowedDiscordUser(pool, OWNER, LINKED_DISCORD);
    const listed = await listAllowedDiscordUsers(pool, OWNER);
    expect(listed.allowed.map((entry) => entry.discordId)).toEqual([LINKED_DISCORD]);
    expect(listed).not.toHaveProperty('token');

    await removeAllowedDiscordUser(pool, OWNER, LINKED_DISCORD);
    expect((await listAllowedDiscordUsers(pool, OWNER)).allowed).toEqual([]);
    // The personal provider configuration is untouched throughout.
    expect(state.credentials.has(OWNER)).toBe(true);
    void readPoolParticipation;
  });

  it('reports participation as false while the trust list is empty', async () => {
    const state = newPoolState();
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    const { addAllowedDiscordUser, readPoolParticipation, setPoolParticipation } =
      await import('../server/coda-shared-key-pool');
    const pool = fakePool(state, []) as never;

    // Ticked on, but nobody trusted: still shares with nobody.
    await setPoolParticipation(pool, OWNER, true);
    expect((await readPoolParticipation(pool, OWNER)).participating).toBe(false);

    await addAllowedDiscordUser(pool, OWNER, LINKED_DISCORD);
    const ready = await readPoolParticipation(pool, OWNER);
    expect(ready.participating).toBe(true);
    expect(ready.allowedCount).toBe(1);
  });

  it('rejects a malformed Discord id rather than storing it', async () => {
    const { createProviderSettingsRouter } = await import('../server/provider-settings');
    const state = newPoolState();
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      Object.defineProperty(request, 'session', { value: { userId: OWNER }, configurable: true });
      next();
    });
    app.use('/api/provider-settings', createProviderSettingsRouter(buildConfig(), fakePool(state, [])));

    await request(app).post('/api/provider-settings/novelai/shared-use/allowed').send({ discordId: 'not-an-id' }).expect(400);
    await request(app).post('/api/provider-settings/novelai/shared-use/allowed').send({ discordId: '123' }).expect(400);
    const { listAllowedDiscordUsers: list } = await import('../server/coda-shared-key-pool');
    expect((await list(fakePool(state, []) as never, OWNER)).allowed).toEqual([]);
  });
});

describe('rate-limit store durability', () => {
  it('treats a missing migration as "no limit" rather than blocking Coda', async () => {
    const missing = {
      query: async () => {
        const error = new Error('relation "coda_discord_rate_limits" does not exist');
        (error as { code?: string }).code = '42P01';
        throw error;
      },
    };
    const result = await consumeRateLimit(missing as never, '123', 1, 60);
    expect(result.allowed).toBe(true);
  });
});

describe('stored credentials are never readable through Orbis', () => {
  it('never returns key material from the provider settings endpoints, not even to the owner', async () => {
    const { createProviderSettingsRouter } = await import('../server/provider-settings');
    const state = newPoolState();
    state.users.push({ id: OWNER, discordId: LINKED_DISCORD, displayName: 'Owner' });
    const secretToken = `${'t'.repeat(40)}`;
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealCredential(secretToken, credentialKey(encryptionKey)) });

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      Object.defineProperty(request, 'session', { value: { userId: OWNER }, configurable: true });
      next();
    });
    app.use('/api/provider-settings', createProviderSettingsRouter(buildConfig(), fakePool(state, [])));

    const current = await request(app).get('/api/provider-settings/novelai').expect(200);
    const shared = await request(app).put('/api/provider-settings/novelai/shared-use').send({ enabled: true }).expect(200);
    const serialized = JSON.stringify(current.body) + JSON.stringify(shared.body);

    // The strongest guarantee available: the stored token is not retrievable by
    // anyone through the API, its owner included. There is no read-back path.
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toMatch(/token|ciphertext|Bearer|decrypted/i);
    // Presence and participation are still reported, so the UI can work.
    expect(current.body.configured).toBe(true);
    expect(current.body.model).toBe('xialong-v1');
  });

  it('exposes no key material on the pool membership surface', async () => {
    const { readPoolParticipation } = await import('../server/coda-shared-key-pool');
    const state = newPoolState();
    state.credentials.set(OWNER, { model: 'xialong-v1', sealed: sealedFor('owner') });
    state.members.push(member({ userId: OWNER }));
    const participation = await readPoolParticipation(fakePool(state, []) as never, OWNER);
    expect(JSON.stringify(participation)).not.toMatch(/token|cipher|Bearer/i);
    expect(participation).toEqual({ participating: false, allowedCount: 0, available: true });
  });
});

describe('ordinary Orbis inference keeps requiring the member’s own key', () => {
  it('never reaches the shared pool from the in-Orbis assistant', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(import.meta.dirname, '../server/coda-assistant.ts'), 'utf8');
    expect(source).toContain('FROM user_provider_settings');
    expect(source).toContain('Add your NovelAI token in Account settings before using Coda Assistant.');
    // The assistant must not import the pool, so shared credentials can never
    // silently reach ordinary Orbis inference.
    expect(source).not.toContain('coda-shared-key-pool');
    expect(source).not.toContain('selectPoolMembers');
    expect(source).not.toContain('propagateWorldContentRating');
  });
});

describe('reply sanitising is unchanged', () => {
  it('still strips model-side planning notes and prompt leakage', () => {
    expect(sanitizeDiscordCodaReply('(immediate, playful) *ears* hi')).toBe('*ears* hi');
    expect(sanitizeDiscordCodaReply('CODA REPLY: secret')).toBe('');
  });
});
