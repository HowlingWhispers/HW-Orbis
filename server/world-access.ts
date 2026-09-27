export type WorldVisibility = 'public' | 'unlisted' | 'private';

export interface WorldAccessSettings {
  visibility: WorldVisibility;
  showInLibrary: boolean;
  allowForking: boolean;
}

export interface PersonaAccessSettings extends WorldAccessSettings {
  allowUse: boolean;
}

type AssetRow = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readWorldAccessSettings(document: unknown): WorldAccessSettings {
  const worldSettings = asRecord(asRecord(document).worldSettings);
  const visibility = worldSettings.visibility === 'private' || worldSettings.visibility === 'unlisted'
    ? worldSettings.visibility
    : 'public';
  return {
    visibility,
    showInLibrary: typeof worldSettings.showInLibrary === 'boolean' ? worldSettings.showInLibrary : true,
    allowForking: typeof worldSettings.allowForking === 'boolean' ? worldSettings.allowForking : false,
  };
}

export function readPersonaAccessSettings(document: unknown): PersonaAccessSettings {
  const personaSettings = asRecord(asRecord(document).personaSettings);
  const visibility = personaSettings.visibility === 'public' || personaSettings.visibility === 'unlisted'
    ? personaSettings.visibility
    : 'private';
  return {
    visibility,
    showInLibrary: visibility === 'public' && personaSettings.showInLibrary === true,
    allowUse: personaSettings.allowUse === true,
    allowForking: personaSettings.allowForking === true,
  };
}

function accessContext(row: AssetRow) {
  if (row.type === 'persona') {
    return {
      settings: readPersonaAccessSettings(row.document),
      ownerUserId: typeof row.creator_user_id === 'string' ? row.creator_user_id : undefined,
    };
  }

  const isWorld = row.type === 'world';
  const document = isWorld ? row.document : row.origin_world_document;
  const ownerUserId = isWorld ? row.creator_user_id : row.origin_world_creator_user_id;
  return {
    settings: readWorldAccessSettings(document),
    ownerUserId: typeof ownerUserId === 'string' ? ownerUserId : undefined,
  };
}

export function canDirectViewAssetRow(row: AssetRow, userId?: string, isSuperAdmin = false) {
  if (isSuperAdmin) return true;
  const { settings, ownerUserId } = accessContext(row);
  if (settings.visibility !== 'private') return true;
  return Boolean(userId && ownerUserId === userId);
}

/**
 * Super-admin recovery filter for library discovery.
 *
 * `hidePrivateUserWorlds` is a browsing preference for one administrator's own
 * library views. It narrows discovery to the ordinary owner/public rules while
 * it is on, so private worlds owned by other users disappear from the normal
 * Worlds/library view while the admin's own private worlds stay visible. It
 * never changes ownership, privacy, permissions, publication state or world
 * data, and it does not affect `canDirectViewAssetRow`, so opening a private
 * world by direct link still works with the filter on.
 */
export function canDiscoverAssetRow(
  row: AssetRow,
  userId?: string,
  isSuperAdmin = false,
  options?: { hidePrivateUserWorlds?: boolean },
) {
  if (isSuperAdmin && !options?.hidePrivateUserWorlds) return true;
  const { settings, ownerUserId } = accessContext(row);
  if (userId && ownerUserId === userId) return true;
  return settings.visibility === 'public' && settings.showInLibrary;
}

/**
 * Adult gating for anything that exposes record bytes, including images.
 * Mirrors the `restricted` projection in the library asset query so a media
 * request can never reveal an adult record the asset list would have masked.
 */
export function isAdultRestrictedAssetRow(row: AssetRow, userId?: string, canViewAdult = false) {
  if (row.content_rating !== 'adult') return false;
  if (canViewAdult) return false;
  return !(userId && row.creator_user_id === userId);
}
