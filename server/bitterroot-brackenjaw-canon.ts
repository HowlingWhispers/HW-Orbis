import type { BitterrootSourceWorld } from './bitterroot-import.js';

const BRACKENJAW_CANON_UPDATED_AT = '2026-09-12T07:45:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

const person = (
  id: string,
  name: string,
  age: number,
  description: string,
  homeLocationSourceId: string,
  extras: Record<string, unknown> = {},
) => ({
  id,
  name,
  characterId: id.replace(/-person$/, ''),
  age,
  description,
  speciesSourceId: 'werewolf-upright-feral',
  homeLocationSourceId,
  ...extras,
});

export function applyBrackenjawCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  const brackenjawPlaces = [
    {
      id: 'ashforge-house', name: 'Ashforge House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A soot-dark timber and stone home set close to the forge. Its deep eaves, thick shutters, stone hearth and fenced rear yard are built to tolerate sparks, winter wind and the constant traffic of repaired tools.',
    },
    {
      id: 'ashforge-smithy', name: 'Ashforge Smithy', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'Brackenjaw’s working forge and farrier shed, built around a stone chimney, broad anvil floor, quenching trough and covered shoeing bay. Torren Ashforge repairs tools, axes, fittings, horseshoes, spearheads and Warden or militia equipment here.',
    },
    {
      id: 'thornhide-cottage', name: 'Thornhide Cottage', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A narrow cedar-plank cottage kept unusually orderly, with a small drying porch and an old second chair that Daren has never removed. The house is quiet even when the neighboring workshops are busy.',
    },
    {
      id: 'thornhide-saddlery', name: 'Thornhide Saddlery', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'A warm, pungent leather shop with cutting tables, stitching frames, waxed thread, hide racks and forms for boots, packs, harness, quivers and scabbards. Daren’s work supplies civilians, militia households and Boundary Wardens alike.',
    },
    {
      id: 'timberfall-house', name: 'Timberfall House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A sturdy but plainly furnished house built by Harl himself, recognizable by oversized roof beams, a wide front step and repair marks that never quite match because he is forever testing different joints and woods.',
    },
    {
      id: 'timberfall-yard', name: 'Timberfall Timber Yard', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'An open carpenter’s yard of saw trestles, seasoning racks, wheel forms and covered lumber. Harl builds and repairs carts, gates, palisade sections, roofs, bridges, furniture and defensive timberwork here.',
    },
    {
      id: 'mossvale-house', name: 'Mossvale House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A low, warm house with a ramped threshold for Edda’s injured leg, shelves of labeled jars and a sheltered herb garden behind woven fencing. Neighbors often leave food or medicinal plants at the door without ceremony.',
    },
    {
      id: 'mossvale-infirmary', name: 'Mossvale Infirmary', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'Brackenjaw’s small treatment room and field clinic, with two cots, a heavy worktable, boiled bandages, splints, drying herbs and lockable medicine cupboards. During alarms it becomes the enclave casualty station.',
    },
    {
      id: 'stonepaw-house', name: 'Stonepaw House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A broad family house made crowded by Varek, two children and an elderly dependent. Storage chests line the walls, every shelf is labeled, and the kitchen is always better stocked than Varek claims.',
    },
    {
      id: 'stonepaw-stores', name: 'Stonepaw Stores', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'A reinforced storehouse and trading counter where preserved food, rope, lamp oil, blankets, tools and emergency militia supplies are inventoried. The rear reserve cages are opened only by the quartermaster or enclave authority.',
    },
    {
      id: 'meadowstride-house', name: 'Meadowstride House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A long, low home beside the animal yards, with mud-friendly floors, a broad wash porch and a kitchen door that seems permanently open to injured pups, tired riders and escaped barn animals.',
    },
    {
      id: 'meadowstride-stables', name: 'Meadowstride Stables', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'A timber stable complex with stalls, feed loft, tack room, covered cart bay and small treatment pen. Kael and Brynn keep mounts, pack animals and working stock ready for patrols, trade and emergency evacuation.',
    },
    {
      id: 'hearthmane-house', name: 'Hearthmane House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A noisy family home behind the communal hall, smelling of smoke, bread and malt. Its kitchen table is scarred by years of meals, militia meetings, card games and arguments that carried on long after closing.',
    },
    {
      id: 'hearthmane-hall', name: 'Hearthmane Hall', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'Brackenjaw’s communal kitchen, brewhouse and mess hall rather than a luxury tavern. Garrik and Osa feed Wardens, militia, workers and travelers here, and the hall doubles as an assembly room during alarms or bad weather.',
    },
    {
      id: 'trailscar-house', name: 'Trailscar House', kind: 'residence', parentLocationId: 'brackenjaw-enclave',
      description: 'A weathered house at the edge of the enclave with racks for wet cloaks, a map wall, animal tracks pressed into clay tiles and a porch positioned to watch the outbound trails. Rovan dislikes being far from an exit.',
    },
    {
      id: 'trailscar-lodge', name: 'Trailscar Lodge', kind: 'workshop', parentLocationId: 'brackenjaw-enclave',
      description: 'A hunter and scout workshop with skinning tables, drying racks, trapping gear, trail maps, spare snowshoes and a small smokehouse. Rovan and Elka prepare game and field equipment here while teaching apprentices how to read sign without inventing certainty.',
    },
  ];

  const brackenjawMilitia = {
    id: 'brackenjaw-militia',
    name: 'Brackenjaw Militia',
    description: 'The civilian defense body of Brackenjaw Enclave. Members are residents first: smiths, carpenters, hunters, animal handlers, cooks, healers and other workers who can be called to defend the enclave, reinforce gates, carry messages, move supplies, treat casualties or support Boundary Wardens during credible threats.',
    doctrine: 'The militia protects Brackenjaw and supports local defense. It is not a standing army and does not replace the professional trail, boundary and ranger work of the Boundary Wardens.',
  };

  const families = [
    {
      id: 'ashforge-family', name: 'Ashforge',
      description: 'Torren Ashforge’s household. Torren is Brackenjaw’s blacksmith and farrier and raises his son Jori after separating from Mira, who now lives outside the enclave.',
      homeLocationId: 'ashforge-house', workplaceLocationIds: ['ashforge-smithy'],
      people: [
        person('torren-ashforge-person', 'Torren Ashforge', 39, 'Brackenjaw blacksmith and farrier. Loud, practical, stubborn and more sentimental than he admits. He maintains ordinary tools and settlement ironwork as well as militia and Warden gear. Torren is separated from Mira and raises Jori.', 'ashforge-house', {
          role: 'Blacksmith / farrier', workplaceLocationSourceIds: ['ashforge-smithy'], factionSourceIds: ['brackenjaw-militia'],
          canonNote: 'Brackenjaw’s blacksmith and farrier; a civilian militia reservist and Jori’s father.', tags: ['Blacksmith', 'Farrier', 'Brackenjaw militia'],
        }),
        person('jori-ashforge-person', 'Jori Ashforge', 12, 'Torren’s twelve-year-old son. Curious, practical and mischievous, he already knows basic forge chores and simple hammer work. He is close enough to Pip’s age to be a natural friend, rival or partner in bad ideas.', 'ashforge-house', {
          role: 'Forge child', workplaceLocationSourceIds: ['ashforge-smithy'], canonNote: 'Torren Ashforge’s son and a Brackenjaw child close to Pip Holt’s age.', tags: ['Brackenjaw', 'Child', 'Forge'],
        }),
      ],
      relationships: [
        { id: 'torren-jori-parent', fromPersonId: 'torren-ashforge-person', toPersonId: 'jori-ashforge-person', kind: 'parent', notes: 'Father and son. Torren teaches Jori useful work but tries to keep him away from the most dangerous forge tasks.' },
      ],
    },
    {
      id: 'thornhide-family', name: 'Thornhide',
      description: 'Daren Thornhide and his son Hale. Daren is treated locally as a widower after his mate Sela vanished near the outer approaches of Whispering Woods and was never recovered.',
      homeLocationId: 'thornhide-cottage', workplaceLocationIds: ['thornhide-saddlery'],
      people: [
        person('daren-thornhide-person', 'Daren Thornhide', 42, 'Brackenjaw leatherworker and saddler. Quiet, precise and patient. His mate Sela vanished near Whispering Woods six years ago. Daren says he later heard her voice calling from the trees and chose not to follow it. He will defend Brackenjaw itself but refuses patrol work toward the Woods.', 'thornhide-cottage', {
          role: 'Leatherworker / saddler', workplaceLocationSourceIds: ['thornhide-saddlery'], canonNote: 'Brackenjaw saddler and presumed widower of Sela Thornhide.', tags: ['Leatherworker', 'Saddler', 'Whispering Woods survivor'],
        }),
        person('hale-thornhide-person', 'Hale Thornhide', 14, 'Daren’s fourteen-year-old son. Capable, brooding and old enough to understand that his mother never came home. Hale resents Daren’s refusal to search deeper into Whispering Woods, even while fearing what that search might have found.', 'thornhide-cottage', {
          role: 'Saddlery helper', workplaceLocationSourceIds: ['thornhide-saddlery'], canonNote: 'Daren and Sela Thornhide’s son; his mother’s disappearance shapes his relationship with his father.', tags: ['Brackenjaw', 'Teen', 'Saddlery'],
        }),
      ],
      relationships: [
        { id: 'daren-hale-parent', fromPersonId: 'daren-thornhide-person', toPersonId: 'hale-thornhide-person', kind: 'parent', notes: 'Father and son, loyal to each other but strained by Sela’s disappearance and Hale’s belief that Daren gave up too soon.' },
      ],
    },
    {
      id: 'timberfall-family', name: 'Timberfall',
      description: 'Harl Timberfall’s one-person household. His former mate Fenna left Brackenjaw after years of conflict over his repeated willingness to take dangerous repair work beyond the enclave.',
      homeLocationId: 'timberfall-house', workplaceLocationIds: ['timberfall-yard'],
      people: [
        person('harl-timberfall-person', 'Harl Timberfall', 45, 'Brackenjaw carpenter and wheelwright. Strong, methodical and direct. He builds carts, gates, bridges, roofs and defensive timberwork and is one of the more capable civilian militia defenders.', 'timberfall-house', {
          role: 'Carpenter / wheelwright', workplaceLocationSourceIds: ['timberfall-yard'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw’s carpenter and wheelwright; a dependable militia builder and defender.', tags: ['Carpenter', 'Wheelwright', 'Brackenjaw militia'],
        }),
      ],
      relationships: [],
    },
    {
      id: 'mossvale-family', name: 'Mossvale',
      description: 'Edda Mossvale’s household. Edda is unmated and has no children, but much of Brackenjaw has passed through her care at one time or another.',
      homeLocationId: 'mossvale-house', workplaceLocationIds: ['mossvale-infirmary'],
      people: [
        person('edda-mossvale-person', 'Edda Mossvale', 51, 'Brackenjaw healer, herbalist and field medic. Blunt, observant and difficult to shock. An old hind-leg injury prevents normal militia fighting, so during danger she runs the casualty station. She has treated travelers who returned from the edges of Whispering Woods confused or emotionally altered.', 'mossvale-house', {
          role: 'Healer / herbalist / field medic', workplaceLocationSourceIds: ['mossvale-infirmary'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw healer and militia field medic; experienced with survivors of dangerous wilderness incidents.', tags: ['Healer', 'Herbalist', 'Field medic', 'Brackenjaw militia'],
        }),
      ],
      relationships: [],
    },
    {
      id: 'stonepaw-family', name: 'Stonepaw',
      description: 'Varek Stonepaw’s household. Varek is unmated and raises his sister’s children, Fera and Tobin, after their parents vanished on a route that passed dangerously close to Whispering Woods. An elderly relative also lives with them.',
      homeLocationId: 'stonepaw-house', workplaceLocationIds: ['stonepaw-stores'],
      people: [
        person('varek-stonepaw-person', 'Varek Stonepaw', 44, 'Brackenjaw quartermaster and storekeeper. Methodical, strict about inventories and quietly generous when the settlement is genuinely in need. He raises his missing sister’s children and controls emergency issue of supplies during militia mobilization.', 'stonepaw-house', {
          role: 'Quartermaster / storekeeper', workplaceLocationSourceIds: ['stonepaw-stores'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw quartermaster, militia logistician and guardian of Fera and Tobin.', tags: ['Quartermaster', 'Storekeeper', 'Brackenjaw militia'],
        }),
        person('fera-stonepaw-person', 'Fera Stonepaw', 11, 'Varek’s eleven-year-old niece and ward. Cautious, observant and strongly protective of her younger brother Tobin. The disappearance of their parents made her wary of adults who treat dangerous routes casually.', 'stonepaw-house', {
          role: 'Quartermaster household child', canonNote: 'Varek Stonepaw’s niece and ward; older sister of Tobin.', tags: ['Brackenjaw', 'Child'],
        }),
        person('tobin-stonepaw-person', 'Tobin Stonepaw', 5, 'Varek’s five-year-old nephew and ward. Young enough that his memories of his parents are fragmentary, he follows Fera closely and treats the Stonepaw storehouse as an enormous maze of forbidden treasures.', 'stonepaw-house', {
          role: 'Quartermaster household child', canonNote: 'Varek Stonepaw’s young nephew and ward; younger brother of Fera.', tags: ['Brackenjaw', 'Child'],
        }),
      ],
      relationships: [
        { id: 'varek-fera-guardian', fromPersonId: 'varek-stonepaw-person', toPersonId: 'fera-stonepaw-person', kind: 'guardian', notes: 'Uncle and legal guardian after the disappearance of Fera’s parents.' },
        { id: 'varek-tobin-guardian', fromPersonId: 'varek-stonepaw-person', toPersonId: 'tobin-stonepaw-person', kind: 'guardian', notes: 'Uncle and legal guardian after the disappearance of Tobin’s parents.' },
        { id: 'fera-tobin-siblings', fromPersonId: 'fera-stonepaw-person', toPersonId: 'tobin-stonepaw-person', kind: 'sibling', notes: 'Older sister and younger brother. Fera is fiercely protective of Tobin.' },
      ],
    },
    {
      id: 'meadowstride-family', name: 'Meadowstride',
      description: 'Kael and Brynn Meadowstride’s stable household with their son Rusk. They are one of Brackenjaw’s steadier families and keep the enclave’s working animals ready for ordinary life and emergencies.',
      homeLocationId: 'meadowstride-house', workplaceLocationIds: ['meadowstride-stables'],
      people: [
        person('kael-meadowstride-person', 'Kael Meadowstride', 36, 'Brackenjaw stablekeeper and animal handler. Calm around frightened animals and quicker on horseback than on his feet. In militia service he acts primarily as mounted messenger, transport handler and evacuation support.', 'meadowstride-house', {
          role: 'Stablekeeper / animal handler', workplaceLocationSourceIds: ['meadowstride-stables'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw stablekeeper and militia mounted messenger.', tags: ['Stablekeeper', 'Animal handler', 'Brackenjaw militia'],
        }),
        person('brynn-meadowstride-person', 'Brynn Meadowstride', 35, 'Kael’s mate and a skilled animal keeper in her own right. She manages breeding, feed, difficult animals and basic animal treatment, and keeps the stable ready for evacuation or emergency transport.', 'meadowstride-house', {
          role: 'Animal keeper', workplaceLocationSourceIds: ['meadowstride-stables'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Kael Meadowstride’s mate and Brackenjaw animal keeper.', tags: ['Animal keeper', 'Brackenjaw militia'],
        }),
        person('rusk-meadowstride-person', 'Rusk Meadowstride', 8, 'Kael and Brynn’s eight-year-old son. Enthusiastic, fearless around animals and utterly convinced that Pip Holt is already a real Boundary Warden.', 'meadowstride-house', {
          role: 'Stable child', workplaceLocationSourceIds: ['meadowstride-stables'], canonNote: 'Kael and Brynn Meadowstride’s son; he idolizes Pip Holt.', tags: ['Brackenjaw', 'Child', 'Stable'],
        }),
      ],
      relationships: [
        { id: 'kael-brynn-mates', fromPersonId: 'kael-meadowstride-person', toPersonId: 'brynn-meadowstride-person', kind: 'mate', notes: 'Established mates and working partners.' },
        { id: 'kael-rusk-parent', fromPersonId: 'kael-meadowstride-person', toPersonId: 'rusk-meadowstride-person', kind: 'parent', notes: 'Father and son.' },
        { id: 'brynn-rusk-parent', fromPersonId: 'brynn-meadowstride-person', toPersonId: 'rusk-meadowstride-person', kind: 'parent', notes: 'Mother and son.' },
      ],
    },
    {
      id: 'hearthmane-family', name: 'Hearthmane',
      description: 'Garrik and Osa Hearthmane’s household with their teenager Tavi. Their communal hall is one of Brackenjaw’s social centers and also supports militia meals and assemblies.',
      homeLocationId: 'hearthmane-house', workplaceLocationIds: ['hearthmane-hall'],
      people: [
        person('garrik-hearthmane-person', 'Garrik Hearthmane', 41, 'Brackenjaw cook, brewer and messkeeper. Usually jovial, but an experienced former militia fighter emerges quickly when the enclave is threatened. He runs the communal hall with Osa.', 'hearthmane-house', {
          role: 'Cook / brewer / messkeeper', workplaceLocationSourceIds: ['hearthmane-hall'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw communal hall keeper and militia veteran.', tags: ['Cook', 'Brewer', 'Messkeeper', 'Brackenjaw militia'],
        }),
        person('osa-hearthmane-person', 'Osa Hearthmane', 40, 'Garrik’s mate and co-keeper of Hearthmane Hall. She manages brewing, preserved foods, stores and the practical side of feeding a settlement when normal routines break down.', 'hearthmane-house', {
          role: 'Brewer / provisions keeper', workplaceLocationSourceIds: ['hearthmane-hall'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Garrik Hearthmane’s mate and co-keeper of Brackenjaw’s communal hall.', tags: ['Brewer', 'Provisions', 'Brackenjaw militia'],
        }),
        person('tavi-hearthmane-person', 'Tavi Hearthmane', 15, 'Garrik and Osa’s fifteen-year-old child. Tavi has begun militia training and takes it seriously, sometimes clashing with Pip’s belief that becoming a Boundary Warden is the only service worth admiring.', 'hearthmane-house', {
          role: 'Militia trainee', workplaceLocationSourceIds: ['hearthmane-hall'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Garrik and Osa Hearthmane’s teenager and a beginning militia trainee.', tags: ['Brackenjaw', 'Teen', 'Militia trainee'],
        }),
        person('merrin-hearthmane-apprentice-person', 'Merrin', 16, 'A sixteen-year-old apprentice working under Garrik and Osa in Hearthmane Hall. Merrin belongs to another local family that has not yet been separately authored and sleeps in a small apprentice room above the back kitchen.', 'hearthmane-house', {
          role: 'Kitchen / brewing apprentice', workplaceLocationSourceIds: ['hearthmane-hall'], canonNote: 'Teenage apprentice at Hearthmane Hall; their birth family remains intentionally unauthored.', tags: ['Brackenjaw', 'Teen', 'Apprentice'],
        }),
      ],
      relationships: [
        { id: 'garrik-osa-mates', fromPersonId: 'garrik-hearthmane-person', toPersonId: 'osa-hearthmane-person', kind: 'mate', notes: 'Established mates and co-keepers of Hearthmane Hall.' },
        { id: 'garrik-tavi-parent', fromPersonId: 'garrik-hearthmane-person', toPersonId: 'tavi-hearthmane-person', kind: 'parent', notes: 'Parent and teenager.' },
        { id: 'osa-tavi-parent', fromPersonId: 'osa-hearthmane-person', toPersonId: 'tavi-hearthmane-person', kind: 'parent', notes: 'Parent and teenager.' },
        { id: 'garrik-merrin-master', fromPersonId: 'garrik-hearthmane-person', toPersonId: 'merrin-hearthmane-apprentice-person', kind: 'apprentice', notes: 'Garrik is one of Merrin’s trade instructors.' },
      ],
    },
    {
      id: 'trailscar-family', name: 'Trailscar',
      description: 'Rovan and Elka Trailscar’s hunting household with Tess and Pell. Rovan works closely with the Boundary Wardens without being one himself and carries an unresolved history connected to Whispering Woods.',
      homeLocationId: 'trailscar-house', workplaceLocationIds: ['trailscar-lodge'],
      people: [
        person('rovan-trailscar-person', 'Rovan Trailscar', 38, 'Brackenjaw hunter, tracker and scout. He supports Boundary Wardens with trail reports, spoor, game and field knowledge without formally joining them. Rovan survived an incident near Whispering Woods that he refuses to describe and becomes terse when pressed about it.', 'trailscar-house', {
          role: 'Scout / tracker / hunter', workplaceLocationSourceIds: ['trailscar-lodge'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Brackenjaw scout and militia tracker who has survived an undisclosed Whispering Woods incident.', tags: ['Scout', 'Tracker', 'Hunter', 'Brackenjaw militia', 'Whispering Woods survivor'],
        }),
        person('elka-trailscar-person', 'Elka Trailscar', 37, 'Rovan’s mate and an experienced hunter and trapper. She is more willing than Rovan to discuss ordinary wilderness dangers but does not betray his confidence about what happened near Whispering Woods.', 'trailscar-house', {
          role: 'Hunter / trapper', workplaceLocationSourceIds: ['trailscar-lodge'], factionSourceIds: ['brackenjaw-militia'], canonNote: 'Rovan Trailscar’s mate, hunter, trapper and militia-capable defender.', tags: ['Hunter', 'Trapper', 'Brackenjaw militia'],
        }),
        person('tess-trailscar-person', 'Tess Trailscar', 13, 'Rovan and Elka’s thirteen-year-old daughter. Outdoorsy, observant and already competent at reading ordinary animal sign. She gets along well with Pip but is less impressed by ranger posturing than Pip would like.', 'trailscar-house', {
          role: 'Tracker child', workplaceLocationSourceIds: ['trailscar-lodge'], canonNote: 'Rovan and Elka Trailscar’s daughter and one of Pip Holt’s stronger local peers.', tags: ['Brackenjaw', 'Teen', 'Tracking'],
        }),
        person('pell-trailscar-person', 'Pell Trailscar', 6, 'Rovan and Elka’s six-year-old son. Pell follows older children whenever he can get away with it and collects feathers, stones and tracks that he insists are evidence of enormous beasts.', 'trailscar-house', {
          role: 'Hunter household child', canonNote: 'Rovan and Elka Trailscar’s young son.', tags: ['Brackenjaw', 'Child'],
        }),
        person('senn-trailscar-apprentice-person', 'Senn', 15, 'A fifteen-year-old tracking apprentice taught by Rovan and Elka. Senn’s own family remains intentionally unauthored; the Trailscar household feeds and houses the apprentice during longer training periods.', 'trailscar-house', {
          role: 'Tracking apprentice', workplaceLocationSourceIds: ['trailscar-lodge'], canonNote: 'Teenage apprentice at Trailscar Lodge; their birth family remains intentionally unauthored.', tags: ['Brackenjaw', 'Teen', 'Apprentice', 'Tracking'],
        }),
      ],
      relationships: [
        { id: 'rovan-elka-mates', fromPersonId: 'rovan-trailscar-person', toPersonId: 'elka-trailscar-person', kind: 'mate', notes: 'Established mates and hunting partners.' },
        { id: 'rovan-tess-parent', fromPersonId: 'rovan-trailscar-person', toPersonId: 'tess-trailscar-person', kind: 'parent', notes: 'Father and daughter.' },
        { id: 'elka-tess-parent', fromPersonId: 'elka-trailscar-person', toPersonId: 'tess-trailscar-person', kind: 'parent', notes: 'Mother and daughter.' },
        { id: 'rovan-pell-parent', fromPersonId: 'rovan-trailscar-person', toPersonId: 'pell-trailscar-person', kind: 'parent', notes: 'Father and son.' },
        { id: 'elka-pell-parent', fromPersonId: 'elka-trailscar-person', toPersonId: 'pell-trailscar-person', kind: 'parent', notes: 'Mother and son.' },
        { id: 'rovan-senn-master', fromPersonId: 'rovan-trailscar-person', toPersonId: 'senn-trailscar-apprentice-person', kind: 'apprentice', notes: 'Rovan is Senn’s primary tracking instructor.' },
      ],
    },
  ];

  const memories = [
    {
      id: 'sela-thornhide-disappearance', title: 'When Sela Thornhide Did Not Return', kind: 'event', occurredAt: 'Six years before the present', visibility: 'local',
      description: 'Sela Thornhide disappeared while returning from a gathering trip near the outer approaches of Whispering Woods. No body was recovered. Daren later reported hearing her voice call from the trees and refused to follow it.',
      locationIds: ['whispering-woods', 'brackenjaw-enclave'], factionIds: ['boundary-wardens'], familyIds: ['thornhide-family'], affectedCharacterIds: ['daren-thornhide', 'hale-thornhide'],
      persistentEffects: ['Daren Thornhide refuses voluntary patrols toward Whispering Woods.', 'Hale Thornhide resents that his father did not search deeper.', 'The disappearance remains part of Brackenjaw’s living memory of the Woods.'], createdAt: BRACKENJAW_CANON_UPDATED_AT,
    },
    {
      id: 'stonepaw-parents-disappearance', title: 'The Stonepaw Road Disappearance', kind: 'event', occurredAt: 'Several years before the present', visibility: 'local',
      description: 'Varek Stonepaw’s sister and her mate disappeared while traveling a route that passed dangerously close to Whispering Woods. Their children Fera and Tobin were eventually taken into Varek’s household.',
      locationIds: ['whispering-woods', 'brackenjaw-enclave'], factionIds: ['boundary-wardens'], familyIds: ['stonepaw-family'], affectedCharacterIds: ['varek-stonepaw', 'fera-stonepaw', 'tobin-stonepaw'],
      persistentEffects: ['Varek is the guardian of Fera and Tobin.', 'Fera is especially wary of casual travel near dangerous routes.', 'The family has no confirmed account of what happened to the missing parents.'], createdAt: BRACKENJAW_CANON_UPDATED_AT,
    },
    {
      id: 'rovan-trailscar-woods-incident', title: 'Rovan Trailscar’s Unspoken Patrol', kind: 'event', occurredAt: 'Before the present', visibility: 'private-local',
      description: 'Rovan Trailscar survived an incident near Whispering Woods and returned alive. The exact event is intentionally unresolved canon: Rovan refuses to describe it, Elka protects his confidence, and Ragna knows only that something serious happened.',
      locationIds: ['whispering-woods', 'brackenjaw-enclave'], factionIds: ['boundary-wardens'], familyIds: ['trailscar-family'], affectedCharacterIds: ['rovan-trailscar', 'elka-trailscar', 'ragna-holt'],
      persistentEffects: ['Rovan refuses to discuss the incident.', 'The event must not be filled in by runtime improvisation as settled history.', 'Ragna may know that an incident occurred without knowing its private details.'], createdAt: BRACKENJAW_CANON_UPDATED_AT,
    },
  ];

  const placeIds = new Set(world.locations.map((location) => location.id));
  world.locations.push(...brackenjawPlaces.filter((location) => !placeIds.has(location.id)));

  const factionIds = new Set(world.factions.map((faction) => faction.id));
  if (!factionIds.has(brackenjawMilitia.id)) world.factions.push(brackenjawMilitia);

  const familyIds = new Set(world.families.map((family) => family.id));
  world.families.push(...families.filter((family) => !familyIds.has(family.id)));

  const memoryIds = new Set(world.memories.map((memory) => memory.id));
  world.memories.push(...memories.filter((memory) => !memoryIds.has(memory.id)));

  world.societies = world.societies.map((society) => society.id === 'brackenjaw-enclave-society'
    ? {
        ...society,
        description: 'A civilian frontier community in Splitpine Reach organized around ordinary households, practical trades, local defense and the professional Boundary Wardens. Brackenjaw is militia-oriented rather than a standing military settlement.',
        customs: 'Boundary markers, patrol routines, militia call-ups, shared emergency work, local chores, preparedness and practical responsibility are established parts of life. Most residents have civilian trades; capable residents may support defense according to skill and circumstance.',
        leadershipStructure: 'Local enclave authority supported by professional Boundary Wardens and a civilian militia drawn from the community during credible threats.',
        livelihood: 'Blacksmithing, leatherwork, carpentry, animal keeping, healing, hunting, food production, trade, ranger duties and other pre-industrial settlement work support daily life and local defense.',
        familyIds: uniqueStrings(society.familyIds, families.map((family) => family.id)),
        factionIds: uniqueStrings(society.factionIds, ['boundary-wardens', 'brackenjaw-militia']),
        territoryLocationIds: uniqueStrings(society.territoryLocationIds, brackenjawPlaces.map((place) => place.id)),
      }
    : society);

  world.lore = {
    ...world.lore,
    importantFacts: uniqueStrings(world.lore.importantFacts, [
      'Brackenjaw Enclave is a civilian frontier community with a strong militia tradition, not a standing military settlement.',
      'Boundary Wardens are professional rangers; the Brackenjaw Militia is made up of civilians who support defense according to their ordinary skills.',
      'Brackenjaw contains established family homes and trade workplaces for the Ashforge, Thornhide, Timberfall, Mossvale, Stonepaw, Meadowstride, Hearthmane and Trailscar households.',
      'Several Brackenjaw families have personal histories connected to disappearances or incidents near Whispering Woods, strengthening local caution toward travel there.',
    ]),
  };

  world.updatedAt = BRACKENJAW_CANON_UPDATED_AT;
  return world;
}
