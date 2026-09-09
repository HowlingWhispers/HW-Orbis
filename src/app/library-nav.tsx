import { BookOpenText, Castle, Flag, Footprints, Globe2, Landmark, Package, PawPrint, UsersRound } from 'lucide-react';
import type { AssetType } from '../types/library';

export const libraryNavigation: Array<{
  type: AssetType;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Globe2;
}> = [
  { type: 'world', label: 'Worlds', shortLabel: 'Worlds', description: 'Entire authored realities and their canon.', icon: Globe2 },
  { type: 'character', label: 'Characters', shortLabel: 'Characters', description: 'The people and personalities who live within them.', icon: PawPrint },
  { type: 'place', label: 'Places', shortLabel: 'Places', description: 'Regions, paths, shelters and rooms.', icon: Landmark },
  { type: 'item', label: 'Items', shortLabel: 'Items', description: 'Objects, tools, artifacts and possessions.', icon: Package },
  { type: 'faction', label: 'Factions', shortLabel: 'Factions', description: 'Alliances, clans and organized forces.', icon: Flag },
  { type: 'species', label: 'Species', shortLabel: 'Species', description: 'Peoples, forms and inherited traits.', icon: Footprints },
  { type: 'society', label: 'Societies', shortLabel: 'Societies', description: 'Cultures, customs and communities.', icon: Castle },
  { type: 'family', label: 'Families', shortLabel: 'Families', description: 'Kinship, households and bloodlines.', icon: UsersRound },
  { type: 'memory', label: 'Memories & Events', shortLabel: 'Memories', description: 'Moments that changed a person or world.', icon: BookOpenText },
];

export const findNavigationItem = (type: string | undefined) => libraryNavigation.find((item) => item.type === type);
