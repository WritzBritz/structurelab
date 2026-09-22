/** Resolve Minecraft *block face* textures for the 3D statue preview (in-game look). */

import { blockTextureFileCandidates, initMinecraftAssets } from '../../minecraftAssets'

const TEXTURE_ALIASES: Record<string, string> = {
  grass_block: 'grass_block_top',
  podzol: 'podzol_top',
  mycelium: 'mycelium_top',
  dirt_path: 'dirt_path_top',
  crimson_nylium: 'crimson_nylium',
  warped_nylium: 'warped_nylium',
  // 2D / missing-cube fallback only — the 3D cube uses tnt_top / tnt_side / tnt_bottom.
  tnt: 'tnt_side',
  // Prefer still frames that crop cleanly to 16×16 (viewer crops tall sheets).
  water: 'water_still',
  lava: 'lava_still',
  snow: 'snow',
  hay_block: 'hay_block_side',
  bone_block: 'bone_block_side',
  melon: 'melon_side',
  pumpkin: 'pumpkin_side',
  carved_pumpkin: 'carved_pumpkin',
  jack_o_lantern: 'jack_o_lantern',
  quartz_block: 'quartz_block_side',
  dried_kelp_block: 'dried_kelp_side',
  magma_block: 'magma',
  moss_carpet: 'moss_block',
  // Hyphae reuse stem face textures (no separate *_hyphae.png in the jar).
  crimson_hyphae: 'crimson_stem',
  warped_hyphae: 'warped_stem',
  stripped_crimson_hyphae: 'stripped_crimson_stem',
  stripped_warped_hyphae: 'stripped_warped_stem',
  // Froglights ship as *_side / *_top, not bare block ids.
  ochre_froglight: 'ochre_froglight_side',
  verdant_froglight: 'verdant_froglight_side',
  pearlescent_froglight: 'pearlescent_froglight_side',
  bubble_column: 'water_still',
  campfire: 'campfire_log',
  soul_campfire: 'soul_campfire_log_lit',
  bamboo: 'bamboo_block',
  // Smooth cubes reuse another block's all-faces PNG (no smooth_*.png in the jar).
  smooth_quartz: 'quartz_block_bottom',
  smooth_sandstone: 'sandstone_top',
  smooth_red_sandstone: 'red_sandstone_top',
}

/**
 * Minecraft ships these textures greyscale and multiplies a colour in at render
 * time, so drawing the raw PNG gives a grey block (water is the obvious one).
 * Biome-driven blocks use the plains colour; the rest are the game's constants.
 * Blocks whose PNG already carries its colour (lava, cherry/azalea leaves,
 * pale oak leaves, moss, sugar cane) are deliberately absent — tinting those
 * would darken them twice.
 */
const WATER_TINT = [0x3f, 0x76, 0xe4] as const
const GRASS_TINT = [0x91, 0xbd, 0x59] as const
const FOLIAGE_TINT = [0x77, 0xab, 0x2f] as const

const BLOCK_TINTS: Record<string, readonly [number, number, number]> = {
  water: WATER_TINT,
  bubble_column: WATER_TINT,
  water_cauldron: WATER_TINT,
  grass_block: GRASS_TINT,
  short_grass: GRASS_TINT,
  tall_grass: GRASS_TINT,
  fern: GRASS_TINT,
  large_fern: GRASS_TINT,
  potted_fern: GRASS_TINT,
  oak_leaves: FOLIAGE_TINT,
  jungle_leaves: FOLIAGE_TINT,
  acacia_leaves: FOLIAGE_TINT,
  dark_oak_leaves: FOLIAGE_TINT,
  mangrove_leaves: FOLIAGE_TINT,
  vine: FOLIAGE_TINT,
  birch_leaves: [0x80, 0xa7, 0x55],
  spruce_leaves: [0x61, 0x99, 0x61],
  lily_pad: [0x20, 0x80, 0x30],
}

/** Extra PNG stems to try after the primary name (jar naming quirks). */
const TEXTURE_FALLBACKS: Record<string, string[]> = {
  // snow_block uses snow.png in the jar — there is no snow_block.png.
  snow_block: ['snow'],
}

export type BlockFaceImage = HTMLCanvasElement | HTMLImageElement

export type BlockCubeFaces = {
  faces: [
    BlockFaceImage,
    BlockFaceImage,
    BlockFaceImage,
    BlockFaceImage,
    BlockFaceImage,
    BlockFaceImage,
  ]
  distinct: boolean
}

const faceImageCache = new Map<string, Promise<BlockFaceImage | null>>()
const cubeFaceCache = new Map<string, Promise<BlockCubeFaces | null>>()
let cacheReady: Promise<void> | null = null
let cacheEpoch = 0
const cacheListeners = new Set<() => void>()

export function resetTextureCacheForVersion(_versionId: string): void {
  cacheReady = null
  cacheEpoch += 1
  faceImageCache.clear()
  cubeFaceCache.clear()
  for (const listener of cacheListeners) listener()
}

export function baseBlockId(block: string): string {
  return block.split('[')[0].replace(/^minecraft:/, '')
}

/** One warning per block type — ignores property variants like waterlogged. */
export function normalizeTextureCheckBlocks(blocks: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const block of blocks) {
    if (!block) continue
    const id = baseBlockId(block)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function blockTextureWarningLabel(block: string): string {
  return `minecraft:${baseBlockId(block)}`
}

const WOOD_TYPES = new Set([
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'pale_oak',
  'bamboo',
  'crimson',
  'warped',
])

/** Slabs/stairs/walls reuse their parent block's face textures in the jar. */
function textureStemsForMaterialBase(base: string): string[] {
  const stems: string[] = []
  const add = (stem: string) => {
    if (stem && !stems.includes(stem)) stems.push(stem)
  }

  if (base === 'brick') {
    add('bricks')
    return stems
  }
  if (base.endsWith('_brick')) add(`${base}s`)
  if (base.endsWith('_bricks')) add(base)

  if (WOOD_TYPES.has(base)) add(`${base}_planks`)
  if (base === 'bamboo_mosaic') add('bamboo_mosaic')
  if (base === 'petrified_oak') add('oak_planks')

  if (base === 'quartz') add('quartz_block')
  if (base === 'purpur') add('purpur_block')
  if (base === 'prismarine') add('prismarine')
  if (base === 'dark_prismarine') add('dark_prismarine')
  if (base === 'smooth_sandstone') add('sandstone')
  if (base === 'smooth_red_sandstone') add('red_sandstone')
  if (base === 'smooth_quartz') add('quartz_block')

  if (base.endsWith('_tile')) add(`${base}s`)

  if (base.startsWith('waxed_')) add(base.slice('waxed_'.length))

  add(base)
  return stems
}

function parentShapeTextureStems(blockId: string): string[] {
  const match = /^(.*)_(slab|stairs|wall)$/.exec(blockId)
  if (!match) return []
  return textureStemsForMaterialBase(match[1]!)
}

/** Fences, doors, buttons, etc. — parent material textures, not a same-named PNG. */
function relatedBlockTextureStems(blockId: string): string[] {
  const stems: string[] = []
  const add = (stem: string) => {
    if (stem && !stems.includes(stem)) stems.push(stem)
  }
  const addBase = (base: string) => {
    for (const stem of textureStemsForMaterialBase(base)) add(stem)
  }

  let match = /^(.*)_fence_gate$/.exec(blockId)
  if (match) {
    addBase(match[1]!)
    return stems
  }

  match = /^(.*)_fence$/.exec(blockId)
  if (match) {
    addBase(match[1]!)
    return stems
  }

  match = /^(.*)_button$/.exec(blockId)
  if (match) {
    const base = match[1]!
    if (base === 'stone' || base === 'polished_blackstone') add('stone')
    else if (WOOD_TYPES.has(base)) add(`${base}_planks`)
    else add(base)
    return stems
  }

  match = /^(.*)_pressure_plate$/.exec(blockId)
  if (match) {
    const base = match[1]!
    if (base === 'stone' || base === 'polished_blackstone') add('stone')
    else if (base === 'heavy_weighted') add('iron_block')
    else if (base === 'light_weighted') add('gold_block')
    else if (WOOD_TYPES.has(base)) add(`${base}_planks`)
    else add(base)
    return stems
  }

  if (blockId.endsWith('_wall_sign')) {
    add(blockId.replace(/_wall_sign$/, '_sign'))
    return stems
  }

  if (blockId.endsWith('_door')) {
    add(`${blockId}_bottom`)
    add(`${blockId}_top`)
    return stems
  }

  if (blockId.endsWith('_wall_hanging_sign')) {
    add(blockId.replace(/_wall_hanging_sign$/, '_hanging_sign'))
    return stems
  }

  if (blockId.endsWith('_wall_banner')) {
    const color = blockId.replace(/_wall_banner$/, '')
    if (color && color !== 'ominous') add(`${color}_wool`)
    return stems
  }

  if (blockId.endsWith('_banner')) {
    const color = blockId.replace(/_banner$/, '')
    if (color && color !== 'ominous') add(`${color}_wool`)
    return stems
  }

  if (blockId.endsWith('_bed')) {
    const color = blockId.replace(/_bed$/, '')
    if (color) add(`${color}_wool`)
    return stems
  }

  if (blockId.endsWith('_wood')) {
    add(blockId.replace(/_wood$/, '_log'))
    return stems
  }

  return stems
}

export function blockTextureName(blockId: string): string {
  if (TEXTURE_ALIASES[blockId]) return TEXTURE_ALIASES[blockId]!
  // Infested variants reuse the host block's face (no infested_*.png in the jar).
  if (blockId.startsWith('infested_')) {
    return blockTextureName(blockId.slice('infested_'.length))
  }
  // Carpets reuse wool face textures (no separate *_carpet.png in the jar).
  if (blockId.endsWith('_carpet') && blockId !== 'moss_carpet') {
    return blockId.replace(/_carpet$/, '_wool')
  }
  return blockId
}

/** PNG stems to try for a block id (alias + heuristics). */
export function textureStemCandidates(blockId: string): string[] {
  const names: string[] = []
  const add = (name: string | undefined) => {
    if (name && !names.includes(name)) names.push(name)
  }

  add(blockTextureName(blockId))
  const infestedHost = blockId.startsWith('infested_') ? blockId.slice('infested_'.length) : ''
  if (infestedHost) add(infestedHost)
  if (blockId.startsWith('waxed_')) {
    for (const stem of textureStemCandidates(blockId.slice('waxed_'.length))) add(stem)
  }
  for (const extra of TEXTURE_FALLBACKS[blockId] ?? []) add(extra)
  for (const stem of parentShapeTextureStems(blockId)) add(stem)
  for (const stem of relatedBlockTextureStems(blockId)) add(stem)

  if (blockId.endsWith('_carpet') && blockId !== 'moss_carpet') {
    add(blockId.replace(/_carpet$/, '_wool'))
  }

  // Common jar naming: side/top faces instead of bare id.
  if (!blockId.endsWith('_side') && !blockId.endsWith('_top')) {
    add(`${blockId}_side`)
    add(`${blockId}_top`)
  }

  // Hyphae ↔ stem (in case alias table is incomplete).
  if (blockId.includes('_hyphae')) {
    add(blockId.replaceAll('_hyphae', '_stem'))
  }
  if (blockId.includes('_stem')) {
    add(blockId.replaceAll('_stem', '_hyphae'))
  }

  return names
}

/**
 * Prefer flat 16×16 face textures (how cubes look in-world).
 * Do not use `block-icons/` — those are inventory renders, not face textures.
 */
export function blockTextureCandidates(block: string): string[] {
  const blockId = baseBlockId(block)
  const urls: string[] = []
  for (const name of textureStemCandidates(blockId)) {
    urls.push(...blockTextureFileCandidates(name))
  }
  return urls
}

/** The colour Minecraft multiplies into this block's texture, if any. */
export function blockTint(block: string): readonly [number, number, number] | null {
  return BLOCK_TINTS[baseBlockId(block)] ?? null
}

/**
 * A block's face as it looks in-game: first frame of animated sheets, cropped
 * square, with the biome tint already multiplied in. Shared by the 2D map
 * preview and both 3D viewers so they cannot drift apart.
 */
export function loadBlockFaceImage(block: string): Promise<BlockFaceImage | null> {
  const key = `${baseBlockId(block)}|${cacheEpoch}`
  let pending = faceImageCache.get(key)
  if (!pending) {
    pending = loadBlockFace(block)
    faceImageCache.set(key, pending)
  }
  return pending
}

/**
 * Vanilla cube layouts (top / side / bottom, optional front). Three.js
 * BoxGeometry group order is +X, −X, +Y, −Y, +Z, −Z (east, west, up, down,
 * south, north). South (+Z) shows the front of furnaces, pumpkins, etc.
 */
type CubeFaceSpec = {
  top: string
  side: string
  bottom: string
  front?: string
  back?: string
  tintTop?: boolean
  tintSide?: boolean
  /** Untinted side PNG + biome-tinted overlay (grass block). */
  overlaySide?: string
}

function addColumn(
  specs: Record<string, CubeFaceSpec>,
  id: string,
  side = id,
  top = `${id}_top`,
) {
  specs[id] = { top, side, bottom: top }
}

function buildCubeFaceSpecs(): Record<string, CubeFaceSpec> {
  const specs: Record<string, CubeFaceSpec> = {
    grass_block: {
      top: 'grass_block_top',
      side: 'grass_block_side',
      bottom: 'dirt',
      tintTop: true,
      overlaySide: 'grass_block_side_overlay',
    },
    warped_nylium: { top: 'warped_nylium', side: 'warped_nylium_side', bottom: 'netherrack' },
    crimson_nylium: { top: 'crimson_nylium', side: 'crimson_nylium_side', bottom: 'netherrack' },
    podzol: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' },
    mycelium: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' },
    dirt_path: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' },
    farmland: { top: 'farmland', side: 'dirt', bottom: 'dirt' },
    tnt: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' },
    ancient_debris: { top: 'ancient_debris_top', side: 'ancient_debris_side', bottom: 'ancient_debris_top' },
    sandstone: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_bottom' },
    smooth_sandstone: { top: 'sandstone_top', side: 'sandstone_top', bottom: 'sandstone_top' },
    cut_sandstone: { top: 'sandstone_top', side: 'cut_sandstone', bottom: 'sandstone_top' },
    chiseled_sandstone: { top: 'sandstone_top', side: 'chiseled_sandstone', bottom: 'sandstone_top' },
    red_sandstone: { top: 'red_sandstone_top', side: 'red_sandstone', bottom: 'red_sandstone_bottom' },
    smooth_red_sandstone: {
      top: 'red_sandstone_top',
      side: 'red_sandstone_top',
      bottom: 'red_sandstone_top',
    },
    cut_red_sandstone: { top: 'red_sandstone_top', side: 'cut_red_sandstone', bottom: 'red_sandstone_top' },
    chiseled_red_sandstone: {
      top: 'red_sandstone_top',
      side: 'chiseled_red_sandstone',
      bottom: 'red_sandstone_top',
    },
    quartz_block: { top: 'quartz_block_top', side: 'quartz_block_side', bottom: 'quartz_block_bottom' },
    smooth_quartz: {
      top: 'quartz_block_bottom',
      side: 'quartz_block_bottom',
      bottom: 'quartz_block_bottom',
    },
    chiseled_quartz_block: {
      top: 'chiseled_quartz_block_top',
      side: 'chiseled_quartz_block',
      bottom: 'chiseled_quartz_block_top',
    },
    dried_kelp_block: { top: 'dried_kelp_top', side: 'dried_kelp_side', bottom: 'dried_kelp_bottom' },
    melon: { top: 'melon_top', side: 'melon_side', bottom: 'melon_top' },
    pumpkin: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' },
    carved_pumpkin: {
      top: 'pumpkin_top',
      side: 'pumpkin_side',
      bottom: 'pumpkin_top',
      front: 'carved_pumpkin',
    },
    jack_o_lantern: {
      top: 'pumpkin_top',
      side: 'pumpkin_side',
      bottom: 'pumpkin_top',
      front: 'jack_o_lantern',
    },
    crafting_table: {
      top: 'crafting_table_top',
      side: 'crafting_table_side',
      bottom: 'oak_planks',
      front: 'crafting_table_front',
    },
    furnace: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'furnace_front' },
    blast_furnace: {
      top: 'blast_furnace_top',
      side: 'blast_furnace_side',
      bottom: 'blast_furnace_top',
      front: 'blast_furnace_front',
    },
    smoker: { top: 'smoker_top', side: 'smoker_side', bottom: 'smoker_bottom', front: 'smoker_front' },
    dispenser: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'dispenser_front' },
    dropper: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'dropper_front' },
    observer: {
      top: 'observer_top',
      side: 'observer_side',
      bottom: 'observer_top',
      front: 'observer_front',
      back: 'observer_back',
    },
    bookshelf: { top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks' },
    jukebox: { top: 'jukebox_top', side: 'jukebox_side', bottom: 'note_block' },
    lodestone: { top: 'lodestone_top', side: 'lodestone_side', bottom: 'lodestone_top' },
    barrel: { top: 'barrel_top', side: 'barrel_side', bottom: 'barrel_bottom' },
    bee_nest: {
      top: 'bee_nest_top',
      side: 'bee_nest_side',
      bottom: 'bee_nest_bottom',
      front: 'bee_nest_front',
    },
    beehive: {
      top: 'beehive_end',
      side: 'beehive_side',
      bottom: 'beehive_end',
      front: 'beehive_front',
    },
    cactus: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_bottom' },
    reinforced_deepslate: {
      top: 'reinforced_deepslate_top',
      side: 'reinforced_deepslate_side',
      bottom: 'reinforced_deepslate_bottom',
    },
    sculk_catalyst: {
      top: 'sculk_catalyst_top',
      side: 'sculk_catalyst_side',
      bottom: 'sculk_catalyst_bottom',
    },
    target: { top: 'target_top', side: 'target_side', bottom: 'target_top' },
    smithing_table: {
      top: 'smithing_table_top',
      side: 'smithing_table_side',
      bottom: 'smithing_table_bottom',
      front: 'smithing_table_front',
    },
    fletching_table: {
      top: 'fletching_table_top',
      side: 'fletching_table_side',
      bottom: 'fletching_table_top',
      front: 'fletching_table_front',
    },
    cartography_table: {
      top: 'cartography_table_top',
      side: 'cartography_table_side',
      bottom: 'dark_oak_planks',
      front: 'cartography_table_side3',
    },
    loom: { top: 'loom_top', side: 'loom_side', bottom: 'loom_bottom', front: 'loom_front' },
    piston: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' },
    sticky_piston: { top: 'piston_top_sticky', side: 'piston_side', bottom: 'piston_bottom' },
    magma_block: { top: 'magma', side: 'magma', bottom: 'magma' },
  }

  for (const wood of WOOD_TYPES) {
    if (wood === 'bamboo') {
      addColumn(specs, 'bamboo_block')
      addColumn(specs, 'stripped_bamboo_block')
      continue
    }
    if (wood === 'crimson' || wood === 'warped') {
      addColumn(specs, `${wood}_stem`)
      addColumn(specs, `stripped_${wood}_stem`)
      continue
    }
    addColumn(specs, `${wood}_log`)
    addColumn(specs, `stripped_${wood}_log`)
  }
  addColumn(specs, 'hay_block', 'hay_block_side')
  addColumn(specs, 'bone_block', 'bone_block_side')
  addColumn(specs, 'basalt', 'basalt_side')
  addColumn(specs, 'polished_basalt', 'polished_basalt_side')
  addColumn(specs, 'ochre_froglight', 'ochre_froglight_side')
  addColumn(specs, 'verdant_froglight', 'verdant_froglight_side')
  addColumn(specs, 'pearlescent_froglight', 'pearlescent_froglight_side')
  addColumn(specs, 'purpur_pillar')
  addColumn(specs, 'quartz_pillar')
  addColumn(specs, 'creaking_heart')
  return specs
}

const CUBE_FACE_SPECS = buildCubeFaceSpecs()

function cubeLookupId(block: string): string {
  let id = baseBlockId(block)
  if (id.startsWith('infested_')) id = id.slice('infested_'.length)
  if (id.startsWith('waxed_')) id = id.slice('waxed_'.length)
  return id
}

export function loadBlockCubeFaces(block: string): Promise<BlockCubeFaces | null> {
  const key = `cube:${cubeLookupId(block)}|${cacheEpoch}`
  let pending = cubeFaceCache.get(key)
  if (!pending) {
    pending = loadBlockCube(block)
    cubeFaceCache.set(key, pending)
  }
  return pending
}

async function loadStemFace(
  stem: string,
  tint: readonly [number, number, number] | null,
): Promise<BlockFaceImage | null> {
  for (const url of blockTextureFileCandidates(stem)) {
    try {
      const image = await loadImage(url)
      return toFaceImage(image, tint)
    } catch {
      // try next
    }
  }
  return null
}

function assembleCube(
  side: BlockFaceImage,
  top: BlockFaceImage,
  bottom: BlockFaceImage,
  front?: BlockFaceImage | null,
  back?: BlockFaceImage | null,
): BlockCubeFaces {
  const south = front ?? side
  const north = back ?? side
  return { faces: [side, side, top, bottom, south, north], distinct: true }
}

function facePixelSize(image: BlockFaceImage): number {
  if (image instanceof HTMLCanvasElement) return image.width
  return image.naturalWidth || image.width
}

function compositeOver(base: BlockFaceImage, overlay: BlockFaceImage): HTMLCanvasElement {
  const size = Math.min(facePixelSize(base), facePixelSize(overlay))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(base, 0, 0, size, size)
  ctx.drawImage(overlay, 0, 0, size, size)
  return canvas
}

async function loadSideWithOverlay(
  sideStem: string,
  overlayStem: string | undefined,
  tint: readonly [number, number, number] | null,
  tintSide: boolean,
): Promise<BlockFaceImage | null> {
  const side = await loadStemFace(sideStem, overlayStem || !tintSide ? null : tint)
  if (!overlayStem) return side
  const overlay = await loadStemFace(overlayStem, tint)
  if (side && overlay) return compositeOver(side, overlay)
  return overlay ?? side
}

async function loadBlockCube(block: string): Promise<BlockCubeFaces | null> {
  const id = cubeLookupId(block)
  const spec = CUBE_FACE_SPECS[id]
  const tint = blockTint(block)

  if (spec) {
    const [top, side, bottom, front, back] = await Promise.all([
      loadStemFace(spec.top, spec.tintTop ? tint : null),
      loadSideWithOverlay(spec.side, spec.overlaySide, tint, Boolean(spec.tintSide)),
      loadStemFace(spec.bottom, null),
      spec.front ? loadStemFace(spec.front, tint) : Promise.resolve(null),
      spec.back ? loadStemFace(spec.back, tint) : Promise.resolve(null),
    ])
    const fallback = top ?? side ?? bottom ?? (await loadBlockFace(block))
    if (!fallback) return null
    return assembleCube(
      side ?? fallback,
      top ?? fallback,
      bottom ?? fallback,
      front,
      back,
    )
  }

  // Jar convention: foo_side / foo_top / foo_bottom, or logs (foo + foo_top).
  const [bare, side, top, bottom, front] = await Promise.all([
    loadStemFace(id, tint),
    loadStemFace(`${id}_side`, tint),
    loadStemFace(`${id}_top`, tint),
    loadStemFace(`${id}_bottom`, null),
    loadStemFace(`${id}_front`, tint),
  ])
  const sideFace = side ?? bare
  if (sideFace && (top || bottom)) {
    return assembleCube(
      sideFace,
      top ?? sideFace,
      bottom ?? top ?? sideFace,
      front,
      null,
    )
  }

  const one = sideFace ?? top ?? bottom ?? (await loadBlockFace(block))
  if (!one) return null
  return { faces: [one, one, one, one, one, one], distinct: false }
}

async function loadBlockFace(block: string): Promise<BlockFaceImage | null> {
  const tint = blockTint(block)
  for (const url of blockTextureCandidates(block)) {
    try {
      const image = await loadImage(url)
      return toFaceImage(image, tint)
    } catch {
      // try next candidate
    }
  }
  return null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`failed ${url}`))
    image.src = url
  })
}

function toFaceImage(
  image: HTMLImageElement,
  tint: readonly [number, number, number] | null,
): BlockFaceImage {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  // Animated sheets (water, lava) stack frames vertically — keep the first one
  // so a face matches an in-game cube instead of squashing the whole strip.
  const size = Math.min(width, height)
  if (size < 1) return image
  if (width === height && !tint) return image

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: Boolean(tint) })
  if (!ctx) return image
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, 0, 0, size, size, 0, 0, size, size)
  if (tint) applyTint(ctx, size, tint)
  return canvas
}

/** Minecraft's tint is a plain per-channel multiply that leaves alpha alone. */
function applyTint(
  ctx: CanvasRenderingContext2D,
  size: number,
  [tr, tg, tb]: readonly [number, number, number],
) {
  const pixels = ctx.getImageData(0, 0, size, size)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i]! * tr) / 255
    data[i + 1] = (data[i + 1]! * tg) / 255
    data[i + 2] = (data[i + 2]! * tb) / 255
  }
  ctx.putImageData(pixels, 0, 0)
}

function loadImageHead(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`failed ${url}`))
    image.src = url
  })
}

/** Subscribe to cache updates (download / hydrate). Returns unsubscribe. */
export function subscribeTextureCache(listener: () => void): () => void {
  cacheListeners.add(listener)
  return () => {
    cacheListeners.delete(listener)
  }
}

export function getTextureCacheEpoch(): number {
  return cacheEpoch
}

/** Ensure Minecraft asset paths are resolved. Safe to call often. */
export function ensureTextureCacheLoaded(): Promise<void> {
  if (!cacheReady) {
    cacheReady = initMinecraftAssets()
      .then(() => undefined)
      .catch(() => {
        // Preview still works from bundled / CDN textures.
      })
  }
  return cacheReady
}

/** Returns block states whose face textures could not be loaded from any candidate URL. */
export async function findMissingBlockTextures(blocks: string[]): Promise<string[]> {
  await ensureTextureCacheLoaded()
  const unique = normalizeTextureCheckBlocks(blocks)
  const missing: string[] = []
  await Promise.all(
    unique.map(async (blockId) => {
      for (const url of blockTextureCandidates(blockId)) {
        try {
          await loadImageHead(url)
          return
        } catch {
          // try next
        }
      }
      missing.push(blockTextureWarningLabel(blockId))
    }),
  )
  return missing.sort((a, b) => a.localeCompare(b))
}
