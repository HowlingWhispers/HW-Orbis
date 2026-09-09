export type ImportedAssetType = 'world' | 'character' | 'place' | 'faction' | 'species' | 'society' | 'family' | 'memory';
export type ImportedVisualTone = 'moon' | 'forest' | 'ember' | 'mist' | 'violet' | 'river';
export const BITTERROOT_OWNER_DISCORD_ID = '1544473372073791602';

type SourceEntity = { id: string; name: string; description?: string; [key: string]: unknown };
type SourceFamily = SourceEntity & { people?: Array<SourceEntity & { characterId?: string }>; relationships?: unknown[] };

export interface BitterrootSourceWorld {
  id: string;
  identity: { name: string; description: string; genre: string; tone: string };
  rules: Record<string, unknown>;
  lore: Record<string, unknown>;
  timeWeather?: Record<string, unknown>;
  species: SourceEntity[];
  locations: SourceEntity[];
  factions: SourceEntity[];
  societies: SourceEntity[];
  families: SourceFamily[];
  memories: Array<SourceEntity & { title?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface BitterrootSeedAsset {
  sourceAssetId: string;
  type: ImportedAssetType;
  name: string;
  summary: string;
  document: Record<string, unknown>;
  tags: string[];
  dependencyCount: number;
  visualTone: ImportedVisualTone;
  createdAt: string;
  updatedAt: string;
}

const title = (value: unknown) => typeof value === 'string' ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
const compactSummary = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= 300) return text;
  const sentence = text.slice(0, 300).match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  return sentence && sentence.length >= 80 ? sentence : `${text.slice(0, 297).trim()}...`;
};
const sourceIdentity = (type: ImportedAssetType, id: string) => `${type}:${id}`;
const documentOf = (entity: SourceEntity) => structuredClone(entity) as Record<string, unknown>;

export function buildBitterrootSeedAssets(world: BitterrootSourceWorld): BitterrootSeedAsset[] {
  const common = { createdAt: world.createdAt, updatedAt: world.updatedAt };
  const worldDocument = {
    sourceId: world.id,
    identity: structuredClone(world.identity),
    rules: structuredClone(world.rules),
    lore: structuredClone(world.lore),
    timeWeather: structuredClone(world.timeWeather ?? {}),
    species: structuredClone(world.species ?? []),
    locations: structuredClone(world.locations ?? []),
    factions: structuredClone(world.factions ?? []),
    societies: structuredClone(world.societies ?? []),
    families: structuredClone(world.families ?? []),
    memories: structuredClone(world.memories ?? []),
  };
  const assets: BitterrootSeedAsset[] = [{
    sourceAssetId: sourceIdentity('world', world.id),
    type: 'world',
    name: world.identity.name,
    summary: compactSummary(world.identity.description),
    document: worldDocument,
    tags: [world.identity.genre, 'Pre-industrial', 'Public canon'].filter(Boolean),
    dependencyCount: world.species.length + world.locations.length + world.factions.length + world.societies.length + world.families.length + world.memories.length + world.families.flatMap((family) => family.people ?? []).length,
    visualTone: 'forest',
    ...common,
  }];

  const addEntities = (type: ImportedAssetType, entities: SourceEntity[], tone: ImportedVisualTone, tagName: string) => {
    for (const entity of entities) {
      const tags = [tagName];
      if (type === 'place') tags.push(title(entity.kind));
      if (type === 'society') tags.push(title(entity.type), title(entity.canonStatus));
      if (type === 'memory') tags.push(title(entity.kind), title(entity.visibility));
      assets.push({
        sourceAssetId: sourceIdentity(type, entity.id), type,
        name: type === 'memory' && typeof entity.title === 'string' ? entity.title : entity.name,
        summary: compactSummary(entity.description), document: documentOf(entity),
        tags: [...new Set(tags.filter(Boolean))],
        dependencyCount: Object.values(entity).filter((value) => Array.isArray(value)).reduce((total, value) => total + value.length, 0),
        visualTone: tone, ...common,
      });
    }
  };

  addEntities('species', world.species, 'violet', 'Species');
  addEntities('place', world.locations, 'mist', 'Bitterroot');
  addEntities('faction', world.factions, 'ember', 'Faction');
  addEntities('society', world.societies, 'forest', 'Society');
  addEntities('family', world.families, 'ember', 'Family');
  addEntities('memory', world.memories.map((memory) => ({ ...memory, name: memory.title ?? memory.name })), 'river', 'World memory');

  for (const family of world.families) {
    for (const person of family.people ?? []) {
      if (!person.characterId) continue;
      const isRagna = person.characterId === 'ragna-holt';
      assets.push({
        sourceAssetId: sourceIdentity('character', person.characterId),
        type: 'character', name: person.name, summary: compactSummary(person.description),
        document: {
          sourceId: person.characterId,
          description: person.description ?? '',
          familySourceId: family.id,
          familyPersonSourceId: person.id,
          speciesSourceId: 'werewolf-upright-feral',
          factionSourceIds: isRagna ? ['boundary-wardens'] : [],
          homeLocationSourceId: 'brackenjaw-enclave',
          canonNote: isRagna ? 'Veteran Boundary Warden and Pip Holt’s mother.' : 'Ragna Holt’s daughter and a would-be Boundary Warden.',
        },
        tags: ['Werewolf', 'Holt family', isRagna ? 'Boundary Warden' : 'Brackenjaw'],
        dependencyCount: isRagna ? 4 : 3, visualTone: 'moon', ...common,
      });
    }
  }

  return assets;
}
