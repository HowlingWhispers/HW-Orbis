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
  developmentUpdate?: {
    title: string;
    summary: string;
    added: string[];
    planned: string[];
  };
  qa: ProjectQuestion[];
}

export const projects: Record<ProjectDefinition['slug'], ProjectDefinition> = {
  speculus: {
    slug: 'speculus',
    name: 'Speculus',
    releaseLabel: 'Working Concept',
    targetIso: '2026-10-04T12:00:00+02:00',
    targetLabel: '4 October 2026',
    status: 'The working simulator is live in active testing. The current focus is reliable world continuity, physical presence, canon provenance and concise generation control.',
    progress: 72,
    phase: 'TESTING',
    nextMilestone: 'Bind physical entities to persistent place and time state, then verify the upgraded Brain against real Bitterroot sessions.',
    lastUpdated: '11 September 2026',
    summary: 'A private prose simulation instrument that renders Orbis characters, places and worlds through a retro pre-DOS field terminal.',
    purpose: 'Speculus turns Orbis records into controlled prose simulations. It is being built to keep characters, objects, places, physical state and time coherent while exposing the context, rules and provider behavior behind every generated turn.',
    expectedFeatures: [
      'One-time private launches from Orbis records',
      'Character, world, place, item and faction simulation targets',
      'Character Card V2, persona and related world context loading',
      'Brain V2 player-authority and canon restraint rules',
      'Compiled prompt, perception, cast, relationship and provider diagnostics',
      'NovelAI response length and sampling controls',
      'AI influence tags and freeform direction',
      'Reroll, delete, raw export and session resume',
      'Retro 1982 laboratory / rugged field-terminal interface',
    ],
    laterFeatures: [
      'Persistent physical world state bound to place and time',
      'Dedicated protocols for every Orbis record type',
      'Stronger named-character, inventory and place provenance enforcement',
      'Improved active-cast and name detection',
      'Branch and comparison tools for alternative replies',
      'Sanitized research bundles for future Mouseion analysis',
    ],
    developmentUpdate: {
      title: 'Brain V2 restraint and NovelAI controls are now implemented',
      summary: 'Speculus is no longer only a planned terminal shell. The complete Orbis launch bridge and the first Brain V2 runtime are working, but continuity and structured world-state work are still in progress.',
      added: [
        'Response calibration now limits generation before the model call instead of rejecting a reply for being too long.',
        'The left Control Deck now exposes NovelAI randomness, output length, Top-K, nucleus, presence penalty, frequency penalty, sentence completion and stop sequences.',
        'Raw session exports preserve the transcript, diagnostics, settings, relationships, AI influence and any unsent composer draft.',
        'Character and non-character targets use different runtime instructions, and the Brain protects player dialogue, actions and private state.',
      ],
      planned: [
        'Replace prompt-only continuity with structured entities, locations, inventory and physical state.',
        'Bind every physical figure and object to a place and advancing simulation time.',
        'Require canonical Orbis provenance before new formal places, named characters or item types enter persistent state.',
        'Test the complete flow against longer Bitterroot sessions before declaring the working concept stable.',
      ],
    },
    qa: [
      { question: 'Is Speculus replacing Orbis?', answer: 'No. Orbis is the library and creation layer. Speculus is the private simulation and testing layer.' },
      { question: 'Can Speculus use a world?', answer: 'Yes. Speculus can launch characters, worlds, places, items and factions from Orbis. The remaining work is making their physical state and continuity fully structured instead of relying mainly on prompt context.' },
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
    purpose: 'Fabula is the larger living-world layer. It combines Orbis-authored worlds and characters with persistent locations, world state and user presence while keeping private AI roleplay private.',
    expectedFeatures: [
      'Persistent authored worlds from Orbis',
      'Locations and movement between places',
      'Multiple AI characters living inside the same world',
      'World rules, lore, memory and state persistence',
      'Private AI conversations inside shared locations',
      'Visible presence of other users in the same location',
      'Clear privacy boundary so other users cannot read private AI roleplay',
      'Character and world context inherited from Orbis',
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
