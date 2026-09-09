export type ProjectPhase = 'PLANNING' | 'FOUNDATION' | 'CORE' | 'TESTING' | 'CONCEPT LIVE';

export interface ProjectQuestion {
  question: string;
  answer: string;
}

export interface ProjectDefinition {
  slug: 'speculus' | 'fabula';
  name: string;
  releaseLabel: string;
  targetIso: string;
  targetLabel: string;
  status: string;
  progress: number;
  phase: ProjectPhase;
  nextMilestone: string;
  lastUpdated: string;
  summary: string;
  purpose: string;
  expectedFeatures: string[];
  laterFeatures: string[];
  qa: ProjectQuestion[];
}

export const projects: Record<ProjectDefinition['slug'], ProjectDefinition> = {
  speculus: {
    slug: 'speculus',
    name: 'Speculus',
    releaseLabel: 'Working Concept',
    targetIso: '2026-10-04T12:00:00+02:00',
    targetLabel: '4 October 2026',
    status: 'Concept and architecture defined. Build starts after the current weekly quota reset.',
    progress: 5,
    phase: 'PLANNING',
    nextMilestone: 'Build the fresh retro terminal shell and connect the first one-on-one character session.',
    lastUpdated: '6 September 2026',
    summary: 'A private one-on-one character simulation and testing environment with a retro pre-DOS field-terminal identity.',
    purpose: 'Speculus exists to test a character in isolation before placing that character into a larger living world. It should make character voice, memory, canon, world context and prompt behavior easier to inspect than a normal roleplay chat.',
    expectedFeatures: [
      'One active AI character per session',
      'Character Card V2 loading from Coda',
      'Persona loading',
      'Optional world context from Coda',
      'Private one-on-one roleplay',
      'Memory and context inspection',
      'Prompt and character diagnostics',
      'Provider and model selection',
      'Reroll, reset and session save/resume',
      'Retro 1982 laboratory / rugged field-terminal interface',
    ],
    laterFeatures: [
      'Deeper automated character-consistency checks',
      'Branch and comparison tools for alternative replies',
      'Expanded testing reports and exports',
      'More advanced simulation controls once the core RP loop is stable',
    ],
    qa: [
      { question: 'Is Speculus replacing Coda?', answer: 'No. Coda is the library and creation layer. Speculus is the private simulation and testing layer.' },
      { question: 'Can Speculus use a world?', answer: 'Yes. A character can inherit relevant world context, but the session still focuses on one active character.' },
      { question: 'Is it multiplayer?', answer: 'No. Shared-world presence belongs to Fabula.' },
      { question: 'Why the retro terminal design?', answer: 'Speculus is meant to feel like a personality simulation instrument rather than another modern chat dashboard.' },
      { question: 'What does Working Concept mean?', answer: 'A usable first version that proves the one-on-one RP, character loading, context and diagnostic workflow. It is not the final polished release.' },
      { question: 'Do I have to wait for the countdown to try it?', answer: 'No. Demos, prototypes, test builds and semi-working versions may appear before the target date.' },
      { question: 'Could Speculus release before the countdown ends?', answer: 'Yes. The date is a target, not a forced waiting period. If the working-concept milestone is ready early, it can release early.' },
    ],
  },
  fabula: {
    slug: 'fabula',
    name: 'Fabula',
    releaseLabel: 'Early Concept',
    targetIso: '2026-11-15T12:00:00+01:00',
    targetLabel: '15 November 2026',
    status: 'World and privacy concepts are defined. Development follows the first stable Speculus concept.',
    progress: 2,
    phase: 'PLANNING',
    nextMilestone: 'Define the shared-location runtime contract and reuse the proven Speculus RP foundation.',
    lastUpdated: '6 September 2026',
    summary: 'A living roleplay-world system where AI characters, authored locations, world state and eventually other users can share the same world.',
    purpose: 'Fabula is the larger living-world layer. It combines Coda-authored worlds and characters with persistent locations, world state and user presence while keeping private AI roleplay private.',
    expectedFeatures: [
      'Persistent authored worlds from Coda',
      'Locations and movement between places',
      'Multiple AI characters living inside the same world',
      'World rules, lore, memory and state persistence',
      'Private AI conversations inside shared locations',
      'Visible presence of other users in the same location',
      'Clear privacy boundary so other users cannot read private AI roleplay',
      'Character and world context inherited from Coda',
      'Bitterroot as an initial real-world test bed',
    ],
    laterFeatures: [
      'Richer shared-world events and persistent environmental changes',
      'More advanced social and location-presence systems',
      'Worldbuilder contribution controls',
      'Additional public and private worlds with separate authored rules',
    ],
    qa: [
      { question: 'Is Fabula a normal multiplayer chat?', answer: 'No. It is a shared roleplay world. User presence can be visible without exposing private AI conversations.' },
      { question: 'Can another user read what I write to an AI character?', answer: 'No. Shared presence and private roleplay are separate by design.' },
      { question: 'Does every world use the same rules?', answer: 'No. Each world can have its own authored rules, lore, locations and contribution controls.' },
      { question: 'Will Bitterroot be used in Fabula?', answer: 'Yes. Bitterroot is the natural first real world for testing the living-world architecture.' },
      { question: 'Why is Fabula later than Speculus?', answer: 'Fabula adds shared world state, locations, presence, privacy boundaries and much more persistence. Speculus gives it a proven RP foundation first.' },
      { question: 'Do I have to wait for the countdown to see Fabula?', answer: 'No. Early demonstrations, partial world tests and semi-working builds may be shown before the Early Concept target.' },
      { question: 'Could Fabula finish ahead of schedule?', answer: 'Yes. The countdown is a planning target. If the milestone is ready early, it can be released early.' },
    ],
  },
};

export const projectList = [projects.speculus, projects.fabula];
