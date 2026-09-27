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

export function canDiscoverAssetRow(row: AssetRow, userId?: string, isSuperAdmin = false) {
  if (isSuperAdmin) return true;
  const { settings, ownerUserId } = accessContext(row);
  if (userId && ownerUserId === userId) return true;
  return settings.visibility === 'public' && settings.showInLibrary;
}
