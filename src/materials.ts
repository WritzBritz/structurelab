import type { MapColor, PaletteFile, StatueBlockPack } from './types'

export const materialCategories = [
  'all',
  'carpet',
  'wool',
  'concrete',
  'terracotta',
  'wood',
  'stone',
  'natural',
  'metal',
  'glass',
  'other',
] as const

export type MaterialCategory = (typeof materialCategories)[number]
export type MaterialPreset = 'all' | 'carpet' | 'wool' | 'concrete' | 'terracotta'

/** Models / statues — full-block packs (no mapart carpet workflow). */
export type StatueMaterialPreset =
  | 'all'
  | 'everything'
  | 'concrete'
  | 'terracotta'
  | 'wool'
  | 'stone'
  | 'solid'

export const MATERIAL_PRESET_META: {
  id: MaterialPreset
  label: string
  hint: string
}[] = [
  { id: 'all', label: 'Vanilla defaults', hint: 'Each map colour keeps its usual block' },
  { id: 'wool', label: 'Wool', hint: 'Soft coloured wool — great starter' },
  { id: 'concrete', label: 'Concrete', hint: 'Flat solid colours' },
  { id: 'terracotta', label: 'Terracotta', hint: 'Muted earthy tones' },
  { id: 'carpet', label: 'Carpet', hint: '16 dye carpets (1-thick, needs support)' },
]

export const STATUE_MATERIAL_PRESET_META: {
  id: StatueMaterialPreset
  label: string
  hint: string
}[] = [
  { id: 'all', label: 'Common', hint: 'Survival cubes — no chiseled, bricks, or rare variants' },
  { id: 'everything', label: 'Everything', hint: 'Every full cube in this Minecraft version' },
  { id: 'concrete', label: 'Concrete', hint: 'Clean solid statues' },
  { id: 'terracotta', label: 'Terracotta', hint: 'Muted clay tones' },
  { id: 'wool', label: 'Wool', hint: 'Soft coloured wool' },
  { id: 'stone', label: 'Stone & bricks', hint: 'Stone-family cubes, including bricks' },
  { id: 'solid', label: 'Build-safe solid', hint: 'Common cubes — no glass, carpet, or falling blocks' },
]

const QUICK_CATEGORIES = ['wool', 'concrete', 'terracotta', 'carpet'] as const


export interface BlockChoice {
  id: string
  state: string
  name: string
  category: Exclude<MaterialCategory, 'all'>
}

const choiceCache = new WeakMap<MapColor, BlockChoice[]>()

export function baseBlockId(state: string): string {
  return state.split('[')[0]
}

export function friendlyBlockName(state: string): string {
  return baseBlockId(state)
    .replace('minecraft:', '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

/** Internal Minecraft map-colour ids → readable labels for the material browser. */
const MAP_COLOR_LABELS: Record<string, string> = {
  NONE: 'Unused slot',
  GRASS: 'Grass green',
  SAND: 'Sand tan',
  WOOL: 'Wool white',
  FIRE: 'Bright red',
  ICE: 'Ice blue',
  METAL: 'Iron gray',
  PLANT: 'Leaf green',
  SNOW: 'Snow white',
  CLAY: 'Clay gray',
  DIRT: 'Dirt brown',
  STONE: 'Stone gray',
  WATER: 'Water blue',
  WOOD: 'Wood brown',
  QUARTZ: 'Quartz white',
  PODZOL: 'Podzol brown',
  NETHER: 'Nether red',
  GOLD: 'Gold yellow',
  DIAMOND: 'Diamond cyan',
  LAPIS: 'Lapis blue',
  EMERALD: 'Emerald green',
  ORANGE: 'Orange',
  MAGENTA: 'Magenta',
  LIGHT_BLUE: 'Light blue',
  YELLOW: 'Yellow',
  LIGHT_GREEN: 'Light green',
  PINK: 'Pink',
  GRAY: 'Gray',
  LIGHT_GRAY: 'Light gray',
  CYAN: 'Cyan',
  PURPLE: 'Purple',
  BLUE: 'Blue',
  BROWN: 'Brown',
  GREEN: 'Green',
  RED: 'Red',
  BLACK: 'Black',
  GLOW_LICHEN: 'Lichen green',
}

export function friendlyMapColorLabel(color: MapColor): string {
  const mapped = MAP_COLOR_LABELS[color.name]
  if (mapped) return mapped
  if (color.name.startsWith('TERRACOTTA_')) {
    const shade = color.name.slice('TERRACOTTA_'.length).replaceAll('_', ' ').toLowerCase()
    return `${shade.charAt(0).toUpperCase()}${shade.slice(1)} terracotta`
  }
  return color.name
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function mapColorRgbHex(color: MapColor): string {
  const [r, g, b] = color.rgb
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function mapColorMatchesSearch(color: MapColor, search: string): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  const haystack = [
    friendlyMapColorLabel(color),
    color.name,
    friendlyBlockName(color.block),
    mapColorRgbHex(color),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

export function materialCategoryLabel(category: MaterialCategory): string {
  if (category === 'all') return 'All block types'
  const labels: Record<Exclude<MaterialCategory, 'all'>, string> = {
    carpet: 'Carpet',
    wool: 'Wool',
    concrete: 'Concrete',
    terracotta: 'Terracotta',
    wood: 'Wood',
    stone: 'Stone & bricks',
    natural: 'Natural blocks',
    metal: 'Metal & ore',
    glass: 'Glass',
    other: 'Other',
  }
  return labels[category]
}

export function blockProperties(state: string): string {
  const properties = state.match(/\[(.+)]$/)?.[1]
  return properties?.replaceAll(',', ' · ').replaceAll('=', ': ') ?? ''
}

export function materialCategory(state: string): Exclude<MaterialCategory, 'all'> {
  const id = baseBlockId(state).replace('minecraft:', '')
  if (id.endsWith('_carpet') || id === 'moss_carpet') return 'carpet'
  if (id.endsWith('_wool')) return 'wool'
  if (id.includes('concrete')) return 'concrete'
  if (id.includes('terracotta')) return 'terracotta'
  if (/(glass|pane)/.test(id)) return 'glass'
  if (/(iron|gold|copper|netherite|lapis|diamond|emerald|redstone|coal)_block/.test(id)) {
    return 'metal'
  }
  if (/(planks|_log|_wood|_stem|hyphae|bamboo|bookshelf)/.test(id)) return 'wood'
  if (
    /(stone|cobble|deepslate|tuff|blackstone|basalt|quartz|prismarine|brick|andesite|diorite|granite|calcite|netherrack|end_stone)/
      .test(id)
  ) {
    return 'stone'
  }
  if (/(dirt|grass|sand|gravel|clay|mud|snow|ice|moss|leaves|cactus|hay|sponge|lichen)/.test(id)) {
    return 'natural'
  }
  return 'other'
}

function stateScore(state: string): number {
  if (!state.includes('[')) return 0
  let score = 10
  if (state.includes('waterlogged=true')) score += 100
  if (state.includes('powered=true') || state.includes('open=true')) score += 30
  if (state.includes('half=top')) score += 10
  if (state.includes('axis=y')) score -= 2
  return score
}

/**
 * Blocks that only exist attached to / hanging from / growing on a host block.
 * They share a MapColor in the registry, but cannot be the freestanding colour
 * pixel for map art (or statue voxels). Verified against Minecraft multiface /
 * vine / wall-mount / plant placement rules.
 */
const HOST_ATTACHED_BLOCK_IDS = new Set([
  // MultifaceBlock — cover faces of a solid host
  'glow_lichen',
  'sculk_vein',
  'resin_clump',
  // Vines & hanging growth
  'vine',
  'cave_vines',
  'cave_vines_plant',
  'weeping_vines',
  'weeping_vines_plant',
  'twisting_vines',
  'twisting_vines_plant',
  'pale_hanging_moss',
  'hanging_roots',
  'spore_blossom',
  // Non-block coral (needs a solid substrate; fans are wall/floor mounts)
  'tube_coral',
  'brain_coral',
  'bubble_coral',
  'fire_coral',
  'horn_coral',
  'dead_tube_coral',
  'dead_brain_coral',
  'dead_bubble_coral',
  'dead_fire_coral',
  'dead_horn_coral',
  // Ground / crop plants (pop off without soil / farmland)
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'bush',
  'firefly_bush',
  'short_dry_grass',
  'tall_dry_grass',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
  'sea_pickle',
  'sugar_cane',
  'bamboo',
  'bamboo_sapling',
  'cactus',
  'cactus_flower',
  'chorus_plant',
  'chorus_flower',
  'big_dripleaf',
  'big_dripleaf_stem',
  'small_dripleaf',
  'wheat',
  'carrots',
  'potatoes',
  'beetroots',
  'melon_stem',
  'pumpkin_stem',
  'attached_melon_stem',
  'attached_pumpkin_stem',
  'sweet_berry_bush',
  'cocoa',
  'nether_wart',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'torchflower',
  'torchflower_crop',
  'pitcher_plant',
  'pitcher_crop',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'closed_eyeblossom',
  'open_eyeblossom',
  'wildflowers',
  'pink_petals',
  'leaf_litter',
  'golden_dandelion',
  'brown_mushroom',
  'red_mushroom',
  'crimson_fungus',
  'warped_fungus',
  'crimson_roots',
  'warped_roots',
  'nether_sprouts',
  'mangrove_propagule',
  'lily_pad',
  'frogspawn',
  // Crystal / spike mounts
  'pointed_dripstone',
  'amethyst_cluster',
  'small_amethyst_bud',
  'medium_amethyst_bud',
  'large_amethyst_bud',
  'end_rod',
  'sulfur_spike',
  // Thin redstone / climbables that aren't map-art surface blocks
  'ladder',
  'lever',
  'tripwire',
  'tripwire_hook',
  'rail',
  'activator_rail',
  'detector_rail',
  'powered_rail',
  'scaffolding',
])

const HOST_ATTACHED_SUFFIXES = [
  '_coral_fan',
  '_coral_wall_fan',
  '_wall_torch',
  '_wall_sign',
  '_wall_hanging_sign',
  '_wall_banner',
  '_button',
  '_sapling',
] as const

/**
 * True for blocks that only make sense attached to a host (glow lichen, vines,
 * coral fans, flowers, etc.). Carpets / snow layers / pressure plates are kept
 * — those are intentional thin map-art layers.
 */
/**
 * Liquids and the blocks you sink into. They need a source block per pixel,
 * flow off the build, and read as the wrong shade until they settle, so nothing
 * picks them automatically — you can still choose one per colour by hand.
 */
const FLUID_BLOCK_IDS = new Set([
  'water',
  'flowing_water',
  'bubble_column',
  'water_cauldron',
  'lava',
  'flowing_lava',
  'lava_cauldron',
  'powder_snow',
  'powder_snow_cauldron',
])

export function isFluidBlock(state: string): boolean {
  return FLUID_BLOCK_IDS.has(baseBlockId(state).replace('minecraft:', ''))
}

/** Map shades that can only be built out of a liquid — off unless asked for. */
export function fluidColorIds(palette: PaletteFile): number[] {
  return palette.colors
    .filter((color) => color.fluid || isFluidBlock(color.block))
    .map((color) => color.id)
}

export function isHostAttachedColourBlock(state: string): boolean {
  const id = baseBlockId(state).replace('minecraft:', '')
  if (HOST_ATTACHED_BLOCK_IDS.has(id)) return true
  if (id.startsWith('potted_')) return true
  if (id.endsWith('_torch') || id === 'soul_torch' || id === 'redstone_torch') return true
  if (HOST_ATTACHED_SUFFIXES.some((suffix) => id.endsWith(suffix))) return true
  return false
}

export function blockChoices(color: MapColor): BlockChoice[] {
  const cached = choiceCache.get(color)
  if (cached) return cached
  const bestById = new Map<string, string>()
  for (const state of [color.block, ...color.alternatives]) {
    if (isHostAttachedColourBlock(state) || isInfestedBlock(state)) continue
    const id = baseBlockId(state)
    const current = bestById.get(id)
    if (!current || stateScore(state) < stateScore(current)) bestById.set(id, state)
  }
  const choices = [...bestById.entries()]
    .map(([id, state]) => ({
      id,
      state,
      name: friendlyBlockName(id),
      category: materialCategory(id),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  choiceCache.set(color, choices)
  return choices
}

export function matchesMaterialSearch(choice: BlockChoice, search: string): boolean {
  const query = search.trim().toLowerCase()
  return !query || choice.name.toLowerCase().includes(query) || choice.id.includes(query)
}

/** Wool / concrete / terracotta / carpet for this map colour — starters for quick swaps. */
export function quickPicksForColor(color: MapColor): BlockChoice[] {
  const choices = blockChoices(color)
  const picks: BlockChoice[] = []
  for (const category of QUICK_CATEGORIES) {
    const hit = choices.find((entry) => entry.category === category)
    if (hit) picks.push(hit)
  }
  return picks
}

/** Other solid options sorted with the current selection’s category first. */
export function advancedChoicesForColor(
  color: MapColor,
  selectedState: string,
  category: MaterialCategory,
  search: string,
): BlockChoice[] {
  const selectedCategory = materialCategory(selectedState)
  return blockChoices(color)
    .filter((choice) => category === 'all' || choice.category === category)
    .filter((choice) => matchesMaterialSearch(choice, search))
    .sort((left, right) => {
      const leftSame = left.category === selectedCategory ? 0 : 1
      const rightSame = right.category === selectedCategory ? 0 : 1
      if (leftSame !== rightSame) return leftSame - rightSame
      return left.name.localeCompare(right.name)
    })
}

export function applyMaterialPreset(
  palette: PaletteFile,
  preset: MaterialPreset,
): { disabledColorIds: number[]; blockOverrides: Record<number, string> } {
  if (preset === 'all') return { disabledColorIds: fluidColorIds(palette), blockOverrides: {} }
  const disabledColorIds: number[] = []
  const blockOverrides: Record<number, string> = {}
  for (const color of palette.colors.filter((entry) => !entry.transparent)) {
    const choice = blockChoices(color).find(
      (entry) => entry.category === preset && !isFluidBlock(entry.state),
    )
    if (choice) blockOverrides[color.id] = choice.state
    else disabledColorIds.push(color.id)
  }
  return { disabledColorIds, blockOverrides }
}

/**
 * Map colour comes from looking down. These blocks' colour/texture is a unique
 * top (or stem end) while the sides are a different hue — Warped Nylium is the
 * textbook case (cyan top, netherrack sides). Fine for maps and floor art;
 * wrong for statues and wall pixel art.
 */
export function isTopFaceColourBlock(state: string): boolean {
  const id = baseBlockId(state).replace('minecraft:', '')
  return (
    id === 'grass_block'
    || id === 'podzol'
    || id === 'mycelium'
    || id === 'dirt_path'
    || id === 'farmland'
    || id === 'hay_block'
    || id === 'bone_block'
    || id === 'quartz_pillar'
    || id === 'purpur_pillar'
    || id.endsWith('_nylium')
    || ((id.endsWith('_stem') || id.endsWith('_log') || id.endsWith('_hyphae'))
      && !id.includes('mushroom')
      && !id.includes('chorus')
      && !id.includes('attached')
      && !id.includes('pumpkin'))
  )
}

const TOP_FACE_FALLBACKS: Record<string, string> = {
  warped_nylium: 'minecraft:oxidized_copper',
  crimson_nylium: 'minecraft:nether_wart_block',
  grass_block: 'minecraft:lime_concrete',
  mycelium: 'minecraft:light_gray_concrete',
  podzol: 'minecraft:brown_concrete',
  dirt_path: 'minecraft:packed_mud',
  farmland: 'minecraft:dirt',
  crimson_stem: 'minecraft:crimson_planks',
  warped_stem: 'minecraft:warped_planks',
}

/** Block that still looks like this map colour when sides are visible. */
export function omniDefaultBlock(color: MapColor): string {
  if (
    !isTopFaceColourBlock(color.block)
    && !isHostAttachedColourBlock(color.block)
    && !isUnsafeStatueBlock(color.block)
  ) {
    return color.block
  }
  const preferred = ['wool', 'concrete', 'terracotta', 'wood', 'metal', 'natural', 'other'] as const
  const choices = blockChoices(color).filter(
    (entry) => !isFluidBlock(entry.state) && !isTopFaceColourBlock(entry.state) && !isUnsafeStatueBlock(entry.state),
  )
  for (const category of preferred) {
    const hit = choices.find((entry) => entry.category === category)
    if (hit) return hit.state
  }
  const fallback = TOP_FACE_FALLBACKS[baseBlockId(color.block).replace('minecraft:', '')]
  return fallback ?? color.block
}

/**
 * Blocks that exist in the map-colour registry but are a poor statue voxel:
 * not a full cube, technical/unobtainable, furniture, or attached plants.
 * Maps still lists them (carpets, slabs). Models hides them from pickers.
 *
 * Heavy Core: Minecraft Wiki — Transparent, waterloggable, 1.21 ominous-vault
 * drop used to craft a mace. Collision is a small core, not a 1×1×1 cube.
 */
const STATUE_UNSAFE_IDS = new Set([
  'heavy_core',
  'lightning_rod',
  'end_rod',
  'bell',
  'conduit',
  'decorated_pot',
  'flower_pot',
  'copper_golem_statue',
  'exposed_copper_golem_statue',
  'weathered_copper_golem_statue',
  'oxidized_copper_golem_statue',
  'waxed_copper_golem_statue',
  'waxed_exposed_copper_golem_statue',
  'waxed_weathered_copper_golem_statue',
  'waxed_oxidized_copper_golem_statue',
  'dried_ghast',
  'barrier',
  'light',
  'structure_void',
  'structure_block',
  'jigsaw',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'test_block',
  'test_instance_block',
  'bedrock',
  'spawner',
  'trial_spawner',
  'vault',
  'ominous_vault',
  'end_portal',
  'end_portal_frame',
  'end_gateway',
  'nether_portal',
  'moving_piston',
  'piston_head',
  'piston',
  'sticky_piston',
  'fire',
  'soul_fire',
  'dispenser',
  'dropper',
  'observer',
  'frosted_ice',
  'chest',
  'trapped_chest',
  'ender_chest',
  'hopper',
  'lectern',
  'furnace',
  'smoker',
  'blast_furnace',
  'brewing_stand',
  'enchanting_table',
  'stonecutter',
  'grindstone',
  'composter',
  'beacon',
  'cake',
  'crafter',
  'chiseled_bookshelf',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'dragon_egg',
  'budding_amethyst',
  'sculk_sensor',
  'calibrated_sculk_sensor',
  'sculk_shrieker',
  'sniffer_egg',
  'turtle_egg',
  'frogspawn',
  'pointed_dripstone',
  'amethyst_cluster',
  'small_amethyst_bud',
  'medium_amethyst_bud',
  'large_amethyst_bud',
  'creaking_heart',
  'lantern',
  'soul_lantern',
  'campfire',
  'soul_campfire',
  'lever',
  'ladder',
  'scaffolding',
  'tripwire',
  'tripwire_hook',
  'barrel',
  'cauldron',
  'candle',
])

const STATUE_UNSAFE_SUFFIXES = [
  '_slab',
  '_stairs',
  '_wall',
  '_fence',
  '_fence_gate',
  '_door',
  '_trapdoor',
  '_pane',
  '_carpet',
  '_sign',
  '_hanging_sign',
  '_banner',
  '_bed',
  '_button',
  '_pressure_plate',
  '_head',
  '_skull',
  '_candle',
  '_sapling',
  '_chest',
  '_shulker_box',
  '_cauldron',
] as const

export function isPoorStatueBlock(state: string): boolean {
  if (isUnsafeStatueBlock(state) || isFluidBlock(state) || isInfestedBlock(state)) return true
  const id = baseBlockId(state).replace('minecraft:', '')
  return id.includes('hyphae')
}

/** Map colours that have no omnidirectional cube — skip them for statues. */
export function poorModelColorIds(palette: PaletteFile): number[] {
  return palette.colors
    .filter((color) => !color.transparent && isPoorStatueBlock(omniDefaultBlock(color)))
    .map((color) => color.id)
}

export function isInfestedBlock(state: string): boolean {
  return baseBlockId(state).replace('minecraft:', '').startsWith('infested_')
}

export function isUnsafeStatueBlock(state: string, allowAnisotropic = false): boolean {
  if (isHostAttachedColourBlock(state) || isFluidBlock(state)) return true
  const id = baseBlockId(state).replace('minecraft:', '')
  // Path and farmland are not full cubes. Logs, grass, and nylium are.
  if (id === 'dirt_path' || id === 'farmland') return true
  if (!allowAnisotropic && isTopFaceColourBlock(state)) return true
  if (id.endsWith('_leaves') || id.endsWith('_coral_block') || id.endsWith('_wart_block')) {
    return STATUE_UNSAFE_SUFFIXES.some((suffix) => id.endsWith(suffix))
  }
  if (STATUE_UNSAFE_IDS.has(id)) return true
  if (id.includes('golem_statue') || id.includes('campfire') || id.includes('lightning_rod')) return true
  if (id.includes('brewing_stand') || id.includes('enchanting_table') || id.includes('end_rod')) return true
  if (id.includes('decorated_pot') || id.includes('flower_pot') || id.includes('hopper')) return true
  if (id.includes('grindstone') || id.includes('stonecutter') || id.includes('lectern')) return true
  if (id.includes('crafter') || id.includes('vault') || id.includes('spawner')) return true
  if (id === 'bell' || id === 'conduit' || id === 'lever' || id === 'ladder' || id === 'iron_bars') return true
  if (id === 'chain' || id.endsWith('_chain') || id.endsWith('_egg')) return true
  if (id === 'fire' || id === 'soul_fire') return true
  if (
    id.includes('bush')
    || id.includes('flower')
    || id.includes('petals')
    || id.includes('blossom')
    || id.includes('sapling')
    || id.includes('seagrass')
    || id.includes('dripleaf')
    || id.includes('dandelion')
    || id.endsWith('_tulip')
    || id.endsWith('_fungus')
    || id.endsWith('_crop')
    || id.endsWith('_coral')
    || (id.includes('azalea') && !id.includes('leaves'))
  ) {
    return true
  }
  if (
    id === 'poppy'
    || id === 'allium'
    || id === 'azure_bluet'
    || id === 'oxeye_daisy'
    || id === 'lily_of_the_valley'
    || id === 'wither_rose'
    || id === 'lilac'
    || id === 'peony'
    || id === 'blue_orchid'
    || id === 'cornflower'
    || id === 'sunflower'
    || id === 'torchflower'
    || id === 'pitcher_plant'
    || id === 'wildflowers'
    || id === 'fern'
    || id === 'large_fern'
    || id === 'short_grass'
    || id === 'tall_grass'
    || id === 'short_dry_grass'
    || id === 'tall_dry_grass'
    || id === 'bamboo'
    || id === 'cactus'
    || id === 'sugar_cane'
    || id === 'kelp'
    || id === 'kelp_plant'
    || id === 'sea_pickle'
    || id === 'brown_mushroom'
    || id === 'red_mushroom'
    || id === 'crimson_roots'
    || id === 'warped_roots'
    || id === 'nether_sprouts'
    || id === 'hanging_roots'
    || id === 'mangrove_propagule'
    || id === 'leaf_litter'
    || id === 'lily_pad'
    || id === 'cobweb'
    || id === 'powder_snow'
    || id === 'snow'
    || id === 'daylight_detector'
  ) {
    return true
  }
  if (id === 'dispenser' || id === 'dropper' || id === 'observer' || id === 'frosted_ice') return true
  if (id.startsWith('potted_')) return true
  if (id.includes('shulker')) return true
  if (id.endsWith('_lantern') && id !== 'sea_lantern' && id !== 'jack_o_lantern') return true
  if (id.endsWith('_shelf')) return true
  if (STATUE_UNSAFE_SUFFIXES.some((suffix) => id.endsWith(suffix))) return true
  if (id.endsWith('_powder') || id === 'sand' || id === 'red_sand' || id === 'gravel') return true
  if (id === 'suspicious_sand' || id === 'suspicious_gravel') return true
  if (id === 'moss_carpet' || id === 'pale_moss_carpet') return true
  if (isInfestedBlock(id)) return true
  return false
}

/** Same-colour options that still look like a 1×1×1 statue voxel. */
export function statueBlockChoices(color: MapColor): BlockChoice[] {
  return blockChoices(color).filter((choice) => !isUnsafeStatueBlock(choice.state))
}

export function statuePresetToPack(preset: StatueMaterialPreset): StatueBlockPack {
  if (preset === 'all') return 'common'
  return preset
}

/** Block packs for Models / statues (full cubes, not mapart carpet). */
export function applyStatueMaterialPreset(
  palette: PaletteFile,
  preset: StatueMaterialPreset,
): {
  disabledColorIds: number[]
  blockOverrides: Record<number, string>
  blockPack: StatueBlockPack
  disabledBlocks: string[]
  blockSubstitutions: Record<string, string>
} {
  return {
    disabledColorIds:
      preset === 'everything'
        ? [...fluidColorIds(palette)]
        : [...fluidColorIds(palette), ...poorModelColorIds(palette)],
    blockOverrides: {},
    blockPack: statuePresetToPack(preset),
    disabledBlocks: [],
    blockSubstitutions: {},
  }
}

export function cubeId(state: string): string {
  return baseBlockId(state).replace('minecraft:', '')
}

export function cubeIsDisabled(state: string, disabled: string[]): boolean {
  const id = cubeId(state)
  return disabled.some((entry) => cubeId(entry) === id)
}

export function recommendedStatueCubes(
  from: { block: string; rgb: [number, number, number] },
  cubes: { block: string; rgb: [number, number, number] }[],
  limit = 16,
): BlockChoice[] {
  const fromId = cubeId(from.block)
  return cubes
    .filter((cube) => cubeId(cube.block) !== fromId)
    .map((cube) => ({
      cube,
      dist: rgbDistance(from.rgb, cube.rgb),
    }))
    .sort((left, right) => left.dist - right.dist)
    .slice(0, limit)
    .map(({ cube }) => ({
      id: cube.block,
      state: cube.block,
      name: friendlyBlockName(cube.block),
      category: materialCategory(cube.block),
    }))
}

/** Palette cubes that can sit as a control row or under carpets. Furniture stays out. */
export function staircaseSupportChoices(palette: PaletteFile): BlockChoice[] {
  return allPaletteBlocks(palette).filter((choice) => !isUnsafeStatueBlock(choice.state, true))
}

export function formatStacks(stacks: number, remainder: number): string {
  if (!stacks) return `${remainder} blocks`
  if (!remainder) return `${stacks} ${stacks === 1 ? 'stack' : 'stacks'}`
  return `${stacks} ${stacks === 1 ? 'stack' : 'stacks'} + ${remainder}`
}

/** Every unique build block across the palette (for unrestricted overrides). */
export function allPaletteBlocks(palette: PaletteFile, statueSafe = false): BlockChoice[] {
  const byId = new Map<string, BlockChoice>()
  for (const color of palette.colors) {
    if (color.transparent) continue
    const list = statueSafe ? statueBlockChoices(color) : blockChoices(color)
    for (const choice of list) {
      if (!byId.has(choice.id)) byId.set(choice.id, choice)
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return dr * dr + dg * dg + db * db
}

/**
 * Suggested replacements: same-colour quick picks, then default blocks from
 * nearby map colours (RGB), then remaining same-colour options.
 */
export function recommendedReplacements(
  color: MapColor,
  palette: PaletteFile,
  limit = 10,
  statueSafe = false,
): BlockChoice[] {
  const seen = new Set<string>()
  const out: BlockChoice[] = []
  const shadeChoices = statueSafe ? statueBlockChoices(color) : blockChoices(color)
  const push = (choice: BlockChoice | undefined) => {
    if (!choice || seen.has(choice.id) || out.length >= limit) return
    if (statueSafe && isUnsafeStatueBlock(choice.state)) return
    seen.add(choice.id)
    out.push(choice)
  }

  for (const pick of quickPicksForColor(color)) push(pick)
  const defaultChoice = shadeChoices.find(
    (entry) => entry.state === color.block || entry.id === baseBlockId(color.block),
  )
  push(defaultChoice ?? shadeChoices[0])

  const neighbours = palette.colors
    .filter((entry) => !entry.transparent && entry.id !== color.id)
    .map((entry) => ({ entry, dist: rgbDistance(color.rgb, entry.rgb) }))
    .sort((left, right) => left.dist - right.dist)

  for (const { entry } of neighbours) {
    if (out.length >= limit) break
    const shade = statueSafe ? statueBlockChoices(entry) : blockChoices(entry)
    const picks = quickPicksForColor(entry).filter(
      (choice) => !statueSafe || !isUnsafeStatueBlock(choice.state),
    )
    push(picks[0] ?? shade[0])
  }

  for (const choice of shadeChoices) {
    if (out.length >= limit) break
    push(choice)
  }

  return out
}

/** Keep overrides that still exist in the new palette; drop the rest. */
export function scrubBlockOverrides(
  palette: PaletteFile,
  overrides: Record<number, string>,
): Record<number, string> {
  const known = new Set<string>()
  for (const color of palette.colors) {
    if (color.transparent) continue
    known.add(baseBlockId(color.block))
    for (const alt of color.alternatives) known.add(baseBlockId(alt))
  }
  const next: Record<number, string> = {}
  for (const [key, state] of Object.entries(overrides)) {
    const colorId = Number(key)
    if (!Number.isFinite(colorId)) continue
    const color = palette.colors.find((entry) => entry.id === colorId)
    if (!color) continue
    const wanted = baseBlockId(state)
    const match = blockChoices(color).find(
      (choice) => choice.state === state || choice.id === wanted,
    )
    if (match) next[colorId] = match.state
    else if (known.has(wanted) && !isUnsafeStatueBlock(state) && !isHostAttachedColourBlock(state)) {
      next[colorId] = wanted.includes(':') ? wanted : `minecraft:${wanted}`
    }
  }
  return next
}

/** Keep cube replacements whose source and target still exist in the new palette. */
export function scrubBlockSubstitutions(
  palette: PaletteFile,
  substitutions: Record<string, string>,
): Record<string, string> {
  const known = new Set<string>()
  for (const color of palette.colors) {
    known.add(cubeId(color.block))
    for (const alt of color.alternatives) known.add(cubeId(alt))
  }
  const next: Record<string, string> = {}
  for (const [from, to] of Object.entries(substitutions)) {
    if (known.has(cubeId(from)) && known.has(cubeId(to))) next[from] = to
  }
  return next
}

/** Prefer the current support block if it still exists; otherwise a palette default. */
export function scrubSupportBlock(palette: PaletteFile, supportBlock: string): string {
  const choices = staircaseSupportChoices(palette)
  if (choices.some((choice) => choice.state === supportBlock || choice.id === baseBlockId(supportBlock))) {
    return supportBlock
  }
  return choices[0]?.state ?? 'minecraft:cobblestone'
}

export function clampIntegerDraft(
  draft: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(draft)
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, Math.round(parsed)))
    : fallback
}
