import type { LibraryAssetCreate } from '../../types/library';

type JsonObject = Record<string, unknown>;

export const WORLD_AUTHORING_FORMAT = 'orbis-authoring';
export const WORLD_AUTHORING_SCHEMA_VERSION = 1;

const tones = new Set(['moon', 'forest', 'ember', 'mist', 'violet', 'river']);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function tagsFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 40));
}

function privateWorldSettings(value: unknown): JsonObject {
  const current = isObject(value) ? value : {};
  return {
    ...current,
    visibility: 'private',
    showInLibrary: false,
    allowForking: false,
  };
}

export function createEmptyWorldDocument(name = 'Untitled World'): JsonObject {
  return {
    identity: {
      name,
      description: '',
      genre: '',
      tone: '',
    },
    lore: {
      history: '',
      cultures: '',
      customs: '',
      importantFacts: [],
    },
    rules: {},
    species: [],
    locations: [],
    factions: [],
    societies: [],
    families: [],
    memories: [],
    timeWeather: {},
    worldSettings: {
      visibility: 'private',
      showInLibrary: false,
      allowForking: false,
    },
  };
}

export function createBlankWorldAsset(name = 'Untitled World'): LibraryAssetCreate {
  return {
    type: 'world',
    name,
    summary: '',
    contentRating: 'sfw',
    tags: [],
    visualTone: 'moon',
    document: createEmptyWorldDocument(name),
  };
}

export function createWorldAuthoringTemplate() {
  return {
    format: WORLD_AUTHORING_FORMAT,
    schemaVersion: WORLD_AUTHORING_SCHEMA_VERSION,
    assetType: 'world',
    name: 'Untitled World',
    summary: '',
    contentRating: 'sfw',
    tags: [],
    visualTone: 'moon',
    data: createEmptyWorldDocument(),
  };
}

export function stringifyWorldAuthoringTemplate() {
  return `${JSON.stringify(createWorldAuthoringTemplate(), null, 2)}\n`;
}

export type WorldJsonFormat = 'orbis-authoring' | 'orbis-world-record' | 'hw-world-backup-v1' | 'raw-world-document';

export interface ParsedWorldJson {
  asset: LibraryAssetCreate;
  format: WorldJsonFormat;
  warning: string;
}

function normalizedAsset(
  nameValue: unknown,
  summaryValue: unknown,
  ratingValue: unknown,
  tagsValue: unknown,
  toneValue: unknown,
  documentValue: unknown,
  format: WorldJsonFormat,
): ParsedWorldJson {
  const document = isObject(documentValue) ? structuredClone(documentValue) : {};
  const identity = isObject(document.identity) ? { ...document.identity } : {};
  const name = (nonEmptyString(nameValue) || nonEmptyString(identity.name) || 'Untitled World').slice(0, 120);
  const description = nonEmptyString(identity.description);
  identity.name = name;
  if (typeof identity.description !== 'string') identity.description = description;

  const normalizedDocument: JsonObject = {
    ...document,
    identity,
    worldSettings: privateWorldSettings(document.worldSettings),
  };

  const documentSize = JSON.stringify(normalizedDocument).length;
  if (documentSize > 128_000) {
    throw new Error(`World document is ${documentSize.toLocaleString()} characters. Orbis currently allows 128,000.`);
  }

  const summary = (nonEmptyString(summaryValue) || description).slice(0, 2000);
  const contentRating = ratingValue === 'adult' ? 'adult' : 'sfw';
  const visualTone = typeof toneValue === 'string' && tones.has(toneValue) ? toneValue as LibraryAssetCreate['visualTone'] : 'moon';

  return {
    format,
    warning: 'Imported worlds are forced to Private until you review World Settings after creation.',
    asset: {
      type: 'world',
      name,
      summary,
      contentRating,
      tags: tagsFrom(tagsValue),
      visualTone,
      document: normalizedDocument,
    },
  };
}

export function parseWorldAuthoringJson(raw: string): ParsedWorldJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON.');
  }

  if (!isObject(parsed)) throw new Error('The JSON root must be an object.');

  if (parsed.format === 'orbis-transfer') {
    throw new Error('This is an Orbis transfer archive. Use Account → Upload archive so linked records and SPC identities are restored safely.');
  }

  if (parsed.format === 'hw-world-backup') {
    if (parsed.version !== 1 || !isObject(parsed.world)) throw new Error('Only hw-world-backup version 1 is supported here.');
    const world = parsed.world;
    const identity = isObject(world.identity) ? world.identity : {};
    const document: JsonObject = {
      sourceId: world.id,
      identity: structuredClone(identity),
      rules: isObject(world.rules) ? structuredClone(world.rules) : {},
      lore: isObject(world.lore) ? structuredClone(world.lore) : {},
      species: Array.isArray(world.species) ? structuredClone(world.species) : [],
      locations: Array.isArray(world.locations) ? structuredClone(world.locations) : [],
      factions: Array.isArray(world.factions) ? structuredClone(world.factions) : [],
      societies: Array.isArray(world.societies) ? structuredClone(world.societies) : [],
      families: Array.isArray(world.families) ? structuredClone(world.families) : [],
      memories: Array.isArray(world.memories) ? structuredClone(world.memories) : [],
      timeWeather: isObject(world.timeWeather) ? structuredClone(world.timeWeather) : {},
    };
    return normalizedAsset(identity.name, identity.description, 'sfw', [identity.genre, 'Imported world'], 'moon', document, 'hw-world-backup-v1');
  }

  if (parsed.format === WORLD_AUTHORING_FORMAT || parsed.assetType === 'world') {
    const schemaVersion = parsed.schemaVersion ?? WORLD_AUTHORING_SCHEMA_VERSION;
    if (schemaVersion !== WORLD_AUTHORING_SCHEMA_VERSION) {
      throw new Error(`Unsupported Orbis authoring schema version: ${String(schemaVersion)}.`);
    }
    const data = isObject(parsed.data) ? parsed.data : isObject(parsed.document) ? parsed.document : undefined;
    if (!data) throw new Error('World authoring JSON needs a data object.');
    return normalizedAsset(parsed.name, parsed.summary, parsed.contentRating, parsed.tags, parsed.visualTone, data, 'orbis-authoring');
  }

  if (parsed.type === 'world' && isObject(parsed.document)) {
    return normalizedAsset(parsed.name, parsed.summary, parsed.contentRating, parsed.tags, parsed.visualTone, parsed.document, 'orbis-world-record');
  }

  if (isObject(parsed.identity)) {
    const identity = parsed.identity;
    return normalizedAsset(identity.name, identity.description, 'sfw', [], 'moon', parsed, 'raw-world-document');
  }

  throw new Error('Orbis could not recognize this as a World JSON file. Use the blank Orbis template or an existing World export as the starting structure.');
}
