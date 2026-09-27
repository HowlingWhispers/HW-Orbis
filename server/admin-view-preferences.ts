import type { DatabasePool } from './db.js';

/**
 * Super-admin recovery view preferences.
 *
 * These are display filters for one administrator's own browsing session. They
 * never touch ownership, privacy, permissions, publication state or world data;
 * the row is keyed by the viewing user so a preference can only ever narrow or
 * widen what that one administrator sees in their own library views.
 */
export const HIDE_PRIVATE_USER_WORLDS_DEFAULT = true;

export interface AdminViewPreferences {
  hidePrivateUserWorlds: boolean;
}

export interface AdminViewPreferenceStore {
  get(userId: string): Promise<AdminViewPreferences>;
  set(userId: string, input: Partial<AdminViewPreferences>): Promise<AdminViewPreferences>;
}

const CACHE_MAX_AGE_MS = 30_000;

export class PostgresAdminViewPreferenceStore implements AdminViewPreferenceStore {
  private cached = new Map<string, { value: AdminViewPreferences; expiresAt: number }>();

  constructor(private readonly pool: DatabasePool) {}

  async get(userId: string): Promise<AdminViewPreferences> {
    const cached = this.cached.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const result = await this.pool.query('SELECT hide_private_user_worlds FROM admin_view_preferences WHERE user_id = $1', [userId]);
    const value: AdminViewPreferences = {
      // Absent row means the safe default: private worlds owned by other users
      // stay out of the admin's normal Worlds/library view.
      hidePrivateUserWorlds: result.rowCount ? result.rows[0].hide_private_user_worlds !== false : HIDE_PRIVATE_USER_WORLDS_DEFAULT,
    };
    this.cached.set(userId, { value, expiresAt: Date.now() + CACHE_MAX_AGE_MS });
    return value;
  }

  async set(userId: string, input: Partial<AdminViewPreferences>): Promise<AdminViewPreferences> {
    const current = await this.get(userId);
    const next: AdminViewPreferences = {
      hidePrivateUserWorlds: input.hidePrivateUserWorlds ?? current.hidePrivateUserWorlds,
    };
    await this.pool.query(
      `INSERT INTO admin_view_preferences (user_id, hide_private_user_worlds)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET hide_private_user_worlds = excluded.hide_private_user_worlds, updated_at = now()`,
      [userId, next.hidePrivateUserWorlds],
    );
    this.cached.set(userId, { value: next, expiresAt: Date.now() + CACHE_MAX_AGE_MS });
    return next;
  }
}
