/** Vanilla Minecraft assets used by the Models “Add from Minecraft” catalog. */

import {
  blockTextureFileCandidates,
  entityTextureCandidates,
  entityTextureUrl,
  initMinecraftAssets,
} from '../../minecraftAssets'
import { blockTextureCandidates } from './blockTextures'
import { ensureBrowserTexture, ensureRgbaPngBytes } from './decodeImage'
import { catalogExtraMaterials, catalogEyesOverlayPath, catalogOuterLayerPath } from './entityCatalogFixes'
import { entityModelToPart } from './entityCubesToObj'
import { catalogEntityBoxIsEnlarged } from './objPartPose'
import type { ScenePartLocal } from '../../types'
import { hasDedicatedBabyMesh, humanoidModelFor, type VanillaHumanoid } from './vanillaHumanoids'
import {
  compositeVillagerTexture,
  villagerTexturePaths,
  villagerVariantForMobId,
  VILLAGER_VARIANTS,
} from './villagerTexture'

function jarEntityRel(relativePath: string): string | null {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/minecraft\//, '')
  if (!clean.startsWith('textures/entity/')) return null
  return clean.slice('textures/entity/'.length)
}

/** Local entity PNG (bundled public/ folder, then user-installed pack). */
export function localEntityTextureUrl(relativePath: string): string | null {
  const rel = jarEntityRel(relativePath)
  return rel ? entityTextureUrl(rel) : null
}

/** Texture id (`minecraft:block/stone`) → PNG filename used in MTL / part.textures. */
export function textureFileName(texId: string): string {
  const stem = texId.replace(/^minecraft:/, '').split('/').pop() ?? 'texture'
  return `${stem.toLowerCase()}.png`
}

export function textureAssetPath(texId: string): string {
  const raw = texId.replace(/^minecraft:/, '')
  if (raw.startsWith('block/') || raw.startsWith('item/') || raw.startsWith('entity/')) {
    return `textures/${raw}.png`
  }
  return `textures/block/${raw}.png`
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  )
}

export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (!isPng(bytes)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

const TEXTURE_VARIANT =
  /^(temperate|cold|warm|red|brown|creamy|white|gray|grey|black|gold|salt|pale)_/

/**
 * 26.1+ moved entity sheets into folders and swapped names
 * (`big_sea_turtle` → `turtle`, `temperate_cow` → `cow_temperate`).
 * Expand one catalog path into every known alias so fetch stays version-agnostic.
 */
export function expandTexturePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (path: string) => {
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (seen.has(clean)) return
    seen.add(clean)
    out.push(clean)
  }
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/')
    push(path)
    const nested = path.match(/^textures\/entity\/(.+)\/([^/]+)\.png$/i)
    if (nested) {
      const folderPath = nested[1]!
      const file = nested[2]!
      const dir = `textures/entity/${folderPath}`
      const folder = folderPath.split('/').pop()!
      if (file === 'big_sea_turtle') push(`${dir}/turtle.png`)
      if (file === 'turtle') push(`${dir}/big_sea_turtle.png`)
      const prefix = file.match(TEXTURE_VARIANT)
      if (prefix) {
        push(`${dir}/${file.slice(prefix[0].length)}_${prefix[1]}.png`)
      }
      const suffix = file.match(
        /^(.+)_(temperate|cold|warm|red|brown|creamy|white|gray|grey|black|gold|salt|pale)$/,
      )
      if (suffix) push(`${dir}/${suffix[2]}_${suffix[1]}.png`)
      if (file !== folder && !file.startsWith(`${folder}_`)) {
        push(`${dir}/${folder}_${file}.png`)
      }
      if (file.startsWith(`${folder}_`) && file.length > folder.length + 1) {
        push(`${dir}/${file.slice(folder.length + 1)}.png`)
      }
      continue
    }
    const flat = path.match(/^textures\/entity\/([^/]+)\.png$/i)
    if (flat) {
      const name = flat[1]!
      push(`textures/entity/${name}/${name}.png`)
      // EyesLayer legacy flat names live under the mob folder
      // (spider_eyes.png → spider/spider_eyes.png).
      if (name.endsWith('_eyes')) {
        const host = name.slice(0, -'_eyes'.length)
        if (host) push(`textures/entity/${host}/${name}.png`)
      }
      if (name.endsWith('_overlay')) {
        const host = name.slice(0, -'_overlay'.length)
        if (host) push(`textures/entity/${host}/${name}.png`)
      }
    }
  }
  return out
}

function pngMatchesSize(
  bytes: Uint8Array,
  expectedSize?: [number, number],
): boolean {
  if (!expectedSize) return true
  const size = pngSize(bytes)
  if (!size) return true
  const [ew, eh] = expectedSize
  if (size[0] === ew && size[1] === eh) return true
  // 2× Java sheets (ghast 128×64, magma 64×64 on a 64×32 layout).
  if (size[0] === ew * 2 && (size[1] === eh * 2 || size[1] === eh)) return true
  return false
}

async function fetchPngFromUrl(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return isPng(bytes) ? bytes : null
  } catch {
    return null
  }
}

export async function fetchMcBytes(
  relativePath: string,
  expectedSize?: [number, number],
): Promise<Uint8Array | null> {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const block = clean.match(/^textures\/block\/(.+)\.png$/i)
  if (block) {
    return fetchTexturePng(`block/${block[1]}`)
  }
  let fallback: Uint8Array | null = null
  const take = (bytes: Uint8Array): Uint8Array | 'skip' => {
    if (pngMatchesSize(bytes, expectedSize)) return bytes
    fallback ??= bytes
    return 'skip'
  }
  for (const path of expandTexturePaths([relativePath])) {
    const rel = jarEntityRel(path)
    if (!rel) continue
    for (const url of entityTextureCandidates(rel)) {
      const bytes = await fetchPngFromUrl(url)
      if (!bytes) continue
      const hit = take(bytes)
      if (hit !== 'skip') return hit
    }
  }
  return fallback
}

/**
 * Load a Minecraft texture as PNG bytes (first frame if animated).
 * Local block-textures / entity-textures only.
 */
export async function fetchTexturePng(
  texId: string,
  tint?: readonly [number, number, number] | null,
): Promise<Uint8Array | null> {
  const path = textureAssetPath(texId)
  const stem = textureFileName(texId).replace(/\.png$/i, '')
  const urls = [
    ...blockTextureFileCandidates(stem),
    ...(jarEntityRel(path) ? entityTextureCandidates(jarEntityRel(path)!) : []),
  ]
  const png = await loadPngFromUrls(urls, tint)
  if (png) return gpuSafePng(png)
  const blockStem = texId
    .replace(/^minecraft:/, '')
    .replace(/^textures\//, '')
    .replace(/^block\//, '')
    .replace(/\.png$/i, '')
  if (blockStem) {
    const remote = await fetchPngFromUrl(
      `${MC_ASSETS}/1.21.6/assets/minecraft/textures/block/${blockStem}.png`,
    )
    if (remote) return gpuSafePng(remote)
  }
  console.warn(`[minecraft-catalog] missing texture ${texId}`)
  return null
}

/** Best-effort cube texture for a palette block id (aliases + local cache). */
export async function fetchBlockFacePng(
  blockId: string,
  tint?: readonly [number, number, number] | null,
): Promise<Uint8Array | null> {
  const urls = blockTextureCandidates(blockId)
  const png = await loadPngFromUrls(urls, tint)
  if (png) return png
  return fetchTexturePng(`block/${blockId}`, tint)
}

type CropMode = 'full' | 'first-frame'

async function loadPngFromUrls(
  urls: string[],
  tint?: readonly [number, number, number] | null,
  crop: CropMode = 'first-frame',
): Promise<Uint8Array | null> {
  for (const url of urls) {
    const bytes = await canvasPngBytes(url, tint, crop)
    if (bytes && bytes.length > 32) return bytes
  }
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 32) return bytes
    } catch {
      /* try next */
    }
  }
  return null
}

async function canvasPngBytes(
  url: string,
  tint?: readonly [number, number, number] | null,
  crop: CropMode = 'first-frame',
): Promise<Uint8Array | null> {
  try {
    const image = await loadCorsImage(url)
    const sourceW = image.naturalWidth || image.width
    const sourceH = image.naturalHeight || image.height
    if (sourceW < 1 || sourceH < 1) return null
    const animated = sourceH > sourceW && sourceH % sourceW === 0
    const width = crop === 'full' || !animated ? sourceW : sourceW
    const height = crop === 'full' || !animated ? sourceH : sourceW
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: Boolean(tint) })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, 0, 0, width, height, 0, 0, width, height)
    if (tint) {
      const pixels = ctx.getImageData(0, 0, width, height)
      const data = pixels.data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (data[i]! * tint[0]) / 255
        data[i + 1] = (data[i + 1]! * tint[1]) / 255
        data[i + 2] = (data[i + 2]! * tint[2]) / 255
      }
      ctx.putImageData(pixels, 0, 0)
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return null
  }
}

function loadCorsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(url))
    image.src = url
  })
}

export type CatalogKind = 'players' | 'mobs'

export type PlayerPresetId =
  | 'steve'
  | 'steve_classic'
  | 'alex'
  | 'ari'
  | 'efe'
  | 'kai'
  | 'makena'
  | 'noor'
  | 'sunny'
  | 'zuri'

const MC_ASSETS =
  'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets'

function playerJarUrl(ref: string, folder: 'wide' | 'slim' | 'root', file: string): string {
  if (folder === 'root') {
    return `${MC_ASSETS}/${ref}/assets/minecraft/textures/entity/${file}.png`
  }
  return `${MC_ASSETS}/${ref}/assets/minecraft/textures/entity/player/${folder}/${file}.png`
}

function modernPlayer(
  id: Exclude<PlayerPresetId, 'steve_classic'>,
  name: string,
  slim: boolean,
  hint: string,
): (typeof PLAYER_PRESETS)[number] {
  const folder = slim ? 'slim' : 'wide'
  return {
    id,
    name,
    slim,
    hint,
    texturePaths: [
      `textures/entity/player/${folder}/${id}.png`,
      ...(id === 'steve' || id === 'alex' ? [`textures/entity/${id}.png`] : []),
    ],
    fallbackUrl: playerJarUrl('1.21.11', folder, id),
  }
}

export const PLAYER_PRESETS: {
  id: PlayerPresetId
  name: string
  slim: boolean
  hint: string
  texturePaths: string[]
  fallbackUrl?: string
}[] = [
  modernPlayer('steve', 'Steve', false, 'Wide arms · current default (beard)'),
  {
    id: 'steve_classic',
    name: 'Steve (classic)',
    slim: false,
    hint: 'Wide arms · classic default (beard)',
    texturePaths: [],
    // Flat pre-1.19.3 sheet — the iconic goatee/smile face, not the 2022 refresh.
    fallbackUrl: playerJarUrl('1.19.2', 'root', 'steve'),
  },
  modernPlayer('alex', 'Alex', true, 'Slim arms · current default'),
  modernPlayer('ari', 'Ari', false, 'Wide arms · 1.19.3+ default'),
  modernPlayer('efe', 'Efe', true, 'Slim arms · 1.19.3+ default'),
  modernPlayer('kai', 'Kai', false, 'Wide arms · 1.19.3+ default'),
  modernPlayer('makena', 'Makena', true, 'Slim arms · 1.19.3+ default'),
  modernPlayer('noor', 'Noor', true, 'Slim arms · 1.19.3+ default'),
  modernPlayer('sunny', 'Sunny', false, 'Wide arms · 1.19.3+ default'),
  modernPlayer('zuri', 'Zuri', false, 'Wide arms · 1.19.3+ default'),
]

export type MobCatalogEntry = {
  id: string
  name: string
  slim: boolean
  texturePaths: string[]
  /** Vanilla HumanoidModel hat layer only — not the player jacket/sleeves. */
  overlay: 'hat' | 'none'
  /** Inner boxes: player 4×4, skeleton 2×2. */
  limbs: 'classic' | 'skeleton'
  /** Zombie-family arms pitched forward. */
  pose: 'idle' | 'zombie'
}

/** Vanilla humanoid entities (entity models, not player skins). */
export const HUMANOID_MOBS: MobCatalogEntry[] = [
  {
    id: 'zombie',
    name: 'Zombie',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'zombie',
    texturePaths: ['textures/entity/zombie/zombie.png'],
  },
  {
    id: 'husk',
    name: 'Husk',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'zombie',
    texturePaths: ['textures/entity/zombie/husk.png'],
  },
  {
    id: 'drowned',
    name: 'Drowned',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'zombie',
    texturePaths: ['textures/entity/zombie/drowned.png'],
  },
  {
    id: 'zombie_villager',
    name: 'Zombie villager',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'zombie',
    texturePaths: ['textures/entity/zombie_villager/zombie_villager.png'],
  },
  {
    id: 'skeleton',
    name: 'Skeleton',
    slim: false,
    overlay: 'hat',
    limbs: 'skeleton',
    pose: 'idle',
    texturePaths: ['textures/entity/skeleton/skeleton.png'],
  },
  {
    id: 'stray',
    name: 'Stray',
    slim: false,
    overlay: 'hat',
    limbs: 'skeleton',
    pose: 'idle',
    texturePaths: ['textures/entity/skeleton/stray.png'],
  },
  {
    id: 'wither_skeleton',
    name: 'Wither skeleton',
    slim: false,
    overlay: 'hat',
    limbs: 'skeleton',
    pose: 'idle',
    texturePaths: ['textures/entity/skeleton/wither_skeleton.png'],
  },
  {
    id: 'piglin',
    name: 'Piglin',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'idle',
    texturePaths: ['textures/entity/piglin/piglin.png'],
  },
  {
    id: 'piglin_brute',
    name: 'Piglin brute',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'idle',
    texturePaths: ['textures/entity/piglin/piglin_brute.png'],
  },
  {
    id: 'zombified_piglin',
    name: 'Zombified piglin',
    slim: false,
    overlay: 'hat',
    limbs: 'classic',
    pose: 'zombie',
    texturePaths: [
      'textures/entity/piglin/zombified_piglin.png',
      'textures/entity/zombie_pigman.png',
    ],
  },
]

function extraMob(id: string, name: string, texturePaths: string[]): MobCatalogEntry {
  return {
    id,
    name,
    slim: false,
    overlay: 'none',
    limbs: 'classic',
    pose: 'idle',
    texturePaths,
  }
}

function babyTexturePaths(paths: string[]): string[] {
  const out: string[] = []
  for (const path of paths) {
    const villagerType = path.match(/^textures\/entity\/((?:zombie_)?villager)\/type\/([^/]+)\.png$/i)
    if (villagerType) {
      out.push(`textures/entity/${villagerType[1]}/baby/${villagerType[2]}.png`)
      out.push(`textures/entity/${villagerType[1]}/${villagerType[1]}_baby.png`)
    }
    const nested = path.match(/^(textures\/entity\/.+)\/([^/]+)\.png$/i)
    if (nested && !/_baby$/i.test(nested[2]!)) {
      out.push(`${nested[1]}/${nested[2]}_baby.png`)
    }
  }
  return out
}

function babyMob(entry: MobCatalogEntry): MobCatalogEntry {
  const id = `baby_${entry.id}`
  const babySheets = babyTexturePaths(entry.texturePaths)
  // Scaled adult meshes keep adult UVs — a 32×32 / unique baby sheet maps onto
  // the wrong part of the head. Dedicated baby geos match those baby sheets.
  const texturePaths = hasDedicatedBabyMesh(id)
    ? [...babySheets, ...entry.texturePaths]
    : [...entry.texturePaths, ...babySheets]
  return {
    ...entry,
    id,
    name: `Baby ${entry.name}`,
    texturePaths,
  }
}

const EXTRA_MOBS: MobCatalogEntry[] = [
  extraMob('creeper', 'Creeper', ['textures/entity/creeper/creeper.png']),
  extraMob('enderman', 'Enderman', ['textures/entity/enderman/enderman.png']),
  extraMob('enderman_angry', 'Enderman · angry', [
    'textures/entity/enderman/enderman.png',
  ]),
  extraMob('ender_dragon', 'Ender dragon', [
    'textures/entity/enderdragon/dragon.png',
  ]),
  extraMob('shulker', 'Shulker', [
    'textures/entity/shulker/shulker.png',
  ]),
  ...[
    'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
  ].map((color) =>
    extraMob(`shulker_${color}`, `Shulker · ${color.replace('_', ' ')}`, [
      `textures/entity/shulker/shulker_${color}.png`,
      'textures/entity/shulker/shulker.png',
    ]),
  ),
  ...VILLAGER_VARIANTS.map((variant) =>
    extraMob(variant.id, variant.name, villagerTexturePaths(variant)),
  ),
  extraMob('wandering_trader', 'Wandering trader', [
    'textures/entity/wandering_trader/wandering_trader.png',
    'textures/entity/wandering_trader.png',
    'textures/entity/villager/wandering_trader.png',
  ]),
  extraMob('witch', 'Witch', [
    'textures/entity/witch/witch.png',
    'textures/entity/witch.png',
  ]),
  extraMob('vindicator', 'Vindicator', ['textures/entity/illager/vindicator.png']),
  extraMob('pillager', 'Pillager', ['textures/entity/illager/pillager.png']),
  extraMob('evoker', 'Evoker', ['textures/entity/illager/evoker.png']),
  extraMob('iron_golem', 'Iron golem', ['textures/entity/iron_golem/iron_golem.png']),
  extraMob('snow_golem', 'Snow golem', [
    'textures/entity/snow_golem/snow_golem.png',
    'textures/entity/snow_golem.png',
    'textures/entity/snowman.png',
  ]),
  extraMob('snow_golem_pumpkin', 'Snow golem · pumpkin head', [
    'textures/entity/snow_golem/snow_golem.png',
    'textures/entity/snow_golem.png',
    'textures/entity/snowman.png',
  ]),
  extraMob('blaze', 'Blaze', [
    'textures/entity/blaze/blaze.png',
    'textures/entity/blaze.png',
  ]),
  extraMob('slime', 'Slime (medium)', ['textures/entity/slime/slime.png']),
  extraMob('slime_small', 'Slime (small)', ['textures/entity/slime/slime.png']),
  extraMob('slime_large', 'Slime (large)', ['textures/entity/slime/slime.png']),
  extraMob('magma_cube', 'Magma cube (medium)', [
    'textures/entity/slime/magmacube.png',
    'textures/entity/slime/magma_cube.png',
  ]),
  extraMob('magma_cube_small', 'Magma cube (small)', [
    'textures/entity/slime/magmacube.png',
    'textures/entity/slime/magma_cube.png',
  ]),
  extraMob('magma_cube_large', 'Magma cube (large)', [
    'textures/entity/slime/magmacube.png',
    'textures/entity/slime/magma_cube.png',
  ]),
  extraMob('spider', 'Spider', ['textures/entity/spider/spider.png']),
  extraMob('cave_spider', 'Cave spider', ['textures/entity/spider/cave_spider.png']),
  extraMob('silverfish', 'Silverfish', ['textures/entity/silverfish/silverfish.png']),
  extraMob('endermite', 'Endermite', ['textures/entity/endermite/endermite.png']),
  extraMob('bat', 'Bat', ['textures/entity/bat/bat.png']),
  extraMob('phantom', 'Phantom', ['textures/entity/phantom/phantom.png']),
  extraMob('guardian', 'Guardian', ['textures/entity/guardian/guardian.png']),
  extraMob('elder_guardian', 'Elder guardian', [
    'textures/entity/guardian/guardian_elder.png',
    'textures/entity/guardian/elder_guardian.png',
    'textures/entity/guardian/guardian.png',
  ]),
  extraMob('squid', 'Squid', [
    'textures/entity/squid/squid.png',
    'textures/entity/squid.png',
  ]),
  extraMob('glow_squid', 'Glow squid', [
    'textures/entity/squid/glow_squid.png',
    'textures/entity/glow_squid/glow_squid.png',
  ]),
  extraMob('dolphin', 'Dolphin', ['textures/entity/dolphin/dolphin.png']),
  extraMob('ghast', 'Ghast', ['textures/entity/ghast/ghast.png']),
  extraMob('happy_ghast', 'Happy ghast', [
    'textures/entity/ghast/happy_ghast.png',
    'textures/entity/ghast/ghast.png',
  ]),
  extraMob('happy_ghastling', 'Happy ghastling', [
    'textures/entity/ghast/happy_ghast_baby.png',
    'textures/entity/ghast/happy_ghast.png',
  ]),
  extraMob('baby_ghast', 'Ghastling', [
    'textures/entity/ghast/happy_ghast_baby.png',
    'textures/entity/ghast/happy_ghast.png',
  ]),
  extraMob('wither', 'Wither', [
    'textures/entity/wither/wither.png',
    'textures/entity/wither/wither_invulnerable.png',
  ]),
  extraMob('vex', 'Vex', [
    'textures/entity/illager/vex.png',
    'textures/entity/vex/vex.png',
  ]),
  extraMob('ravager', 'Ravager', [
    'textures/entity/illager/ravager.png',
    'textures/entity/ravager/ravager.png',
  ]),
  extraMob('cow', 'Cow', [
    'textures/entity/cow/cow_temperate.png',
    'textures/entity/cow/temperate_cow.png',
    'textures/entity/cow/cow.png',
  ]),
  extraMob('pig', 'Pig', [
    'textures/entity/pig/pig_temperate.png',
    'textures/entity/pig/temperate_pig.png',
    'textures/entity/pig/pig.png',
  ]),
  extraMob('sheep', 'Sheep', ['textures/entity/sheep/sheep.png']),
  extraMob('chicken', 'Chicken', [
    'textures/entity/chicken/chicken_temperate.png',
    'textures/entity/chicken/temperate_chicken.png',
    'textures/entity/chicken/chicken.png',
    'textures/entity/chicken.png',
  ]),
  extraMob('wolf', 'Wolf', [
    'textures/entity/wolf/wolf.png',
    'textures/entity/wolf/wolf_pale.png',
    'textures/entity/wolf/wolf32.png',
    'textures/entity/wolf.png',
  ]),
  extraMob('cat', 'Cat', [
    'textures/entity/cat/cat_tabby.png',
    'textures/entity/cat/tabby.png',
  ]),
  extraMob('ocelot', 'Ocelot', [
    'textures/entity/cat/ocelot.png',
    'textures/entity/ocelot/ocelot.png',
  ]),
  extraMob('fox', 'Fox', [
    'textures/entity/fox/fox.png',
    'textures/entity/fox/red.png',
  ]),
  extraMob('panda', 'Panda', ['textures/entity/panda/panda.png']),
  extraMob('parrot', 'Parrot', [
    'textures/entity/parrot/parrot_red_blue.png',
    'textures/entity/parrot/red_blue.png',
    'textures/entity/parrot/parrot.png',
  ]),
  extraMob('goat', 'Goat', [
    'textures/entity/goat/goat.png',
    'textures/entity/goat.png',
  ]),
  extraMob('hoglin', 'Hoglin', ['textures/entity/hoglin/hoglin.png']),
  extraMob('zoglin', 'Zoglin', ['textures/entity/hoglin/zoglin.png']),
  extraMob('bee', 'Bee', ['textures/entity/bee/bee.png']),
  extraMob('llama', 'Llama', [
    'textures/entity/llama/llama_creamy.png',
    'textures/entity/llama/creamy.png',
    'textures/entity/llama/llama.png',
    'textures/entity/llama/white.png',
  ]),
  extraMob('horse', 'Horse', [
    'textures/entity/horse/horse_brown.png',
    'textures/entity/horse/horse_chestnut.png',
    'textures/entity/horse/horse_creamy.png',
  ]),
  extraMob('donkey', 'Donkey', [
    'textures/entity/horse/donkey.png',
    'textures/entity/horse/horse_donkey.png',
  ]),
  extraMob('rabbit', 'Rabbit', [
    'textures/entity/rabbit/rabbit_brown.png',
    'textures/entity/rabbit/brown.png',
  ]),
  extraMob('polar_bear', 'Polar bear', [
    'textures/entity/bear/polarbear.png',
    'textures/entity/bear/polar_bear.png',
  ]),
  extraMob('turtle', 'Turtle', [
    'textures/entity/turtle/turtle.png',
    'textures/entity/turtle/big_sea_turtle.png',
  ]),
  extraMob('strider', 'Strider', ['textures/entity/strider/strider.png']),
  extraMob('mooshroom', 'Mooshroom', [
    'textures/entity/cow/mooshroom_red.png',
    'textures/entity/cow/red_mooshroom.png',
    'textures/entity/cow/mooshroom.png',
    'textures/entity/cow/brown_mooshroom.png',
    'textures/entity/cow/mooshroom_brown.png',
  ]),
]

const BABY_SOURCE_IDS = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'piglin', 'zombified_piglin',
  'cow', 'pig', 'sheep', 'chicken', 'wolf', 'cat', 'ocelot', 'fox', 'panda',
  'goat', 'hoglin', 'horse', 'donkey', 'llama', 'rabbit', 'turtle', 'bee',
  'polar_bear', 'mooshroom',
  ...VILLAGER_VARIANTS.map((variant) => variant.id),
])

export const ALL_MOBS: MobCatalogEntry[] = [
  ...HUMANOID_MOBS,
  ...EXTRA_MOBS,
  ...[...HUMANOID_MOBS, ...EXTRA_MOBS]
    .filter((entry) => BABY_SOURCE_IDS.has(entry.id))
    .map(babyMob),
]

async function gpuSafePng(bytes: Uint8Array): Promise<Uint8Array> {
  const ready = await ensureBrowserTexture('tex.png', bytes)
  return ready?.bytes ?? bytes
}

export async function fetchPlayerPresetTexture(
  preset: (typeof PLAYER_PRESETS)[number],
): Promise<Uint8Array | null> {
  if (preset.texturePaths.length > 0) {
    const local = await fetchFirstTexture(preset.texturePaths)
    if (local) return local
  }
  if (preset.fallbackUrl) {
    const remote = await fetchPngFromUrl(preset.fallbackUrl)
    if (remote) return gpuSafePng(remote)
  }
  return null
}

export async function fetchFirstTexture(
  paths: string[],
  expectedSize?: [number, number],
): Promise<Uint8Array | null> {
  let fallback: Uint8Array | null = null
  for (const path of expandTexturePaths(paths)) {
    const bytes = await fetchMcBytes(path, expectedSize)
    if (!bytes) continue
    if (!pngMatchesSize(bytes, expectedSize)) {
      fallback ??= bytes
      continue
    }
    return gpuSafePng(bytes)
  }
  return fallback ? gpuSafePng(fallback) : null
}

/** Dedicated 26.1+ baby mesh + baby sheet when present; otherwise scaled adult. */
export async function loadMobTextureBytes(
  mob: MobCatalogEntry,
  model: VanillaHumanoid,
): Promise<Uint8Array | null> {
  const variant = villagerVariantForMobId(mob.id)
  if (variant) {
    const baby = mob.id.startsWith('baby_')
    const tryPaths = (babyFlag: boolean) =>
      expandTexturePaths(villagerTexturePaths(variant, babyFlag))
    const loadLayers = async (paths: string[]) => {
      const layers: Uint8Array[] = []
      for (const path of paths) {
        const layer = await fetchMcBytes(path, model.textureSize)
        if (layer) layers.push(layer)
      }
      return layers
    }
    let layers = await loadLayers(tryPaths(baby))
    if (layers.length === 0 && baby) layers = await loadLayers(tryPaths(false))
    if (layers.length > 0) {
      const composited = await compositeVillagerTexture(layers, model.textureSize)
      if (composited) return composited
    }
  }
  const base = await fetchFirstTexture(mob.texturePaths, model.textureSize)
  if (!base) return null
  const layers: Uint8Array[] = [base]
  // Outer clothing (drowned / stray) — same atlas layout as second-layer UVs.
  const outerPath = catalogOuterLayerPath(mob.id)
  if (outerPath) {
    const outer = await fetchFirstTexture([outerPath], model.textureSize)
    if (outer) layers.push(outer)
  }
  // EyesLayer (enderman purple / spider red) — bake into the base sheet so
  // preview and convert see the glow without a separate emissive pass.
  const eyesPath = catalogEyesOverlayPath(mob.id)
  if (eyesPath) {
    const eyes = await fetchFirstTexture([eyesPath], model.textureSize)
    if (eyes) layers.push(eyes)
  }
  if (layers.length > 1) {
    const withLayers = await compositeVillagerTexture(layers, model.textureSize)
    // If compositing flattened the sheet to one colour, keep the base body.
    if (withLayers && (await sheetHasColourVariety(withLayers))) return withLayers
  }
  return base
}

/** True when an entity sheet still has multiple opaque shades (not a solid wash). */
async function sheetHasColourVariety(bytes: Uint8Array): Promise<boolean> {
  const { decodePngRgba } = await import('./decodePngRgba')
  const rgba = await decodePngRgba(bytes)
  if (!rgba) return true
  const seen = new Set<string>()
  const step = Math.max(1, Math.floor(Math.max(rgba.width, rgba.height) / 16))
  for (let y = 0; y < rgba.height; y += step) {
    for (let x = 0; x < rgba.width; x += step) {
      const i = (y * rgba.width + x) * 4
      if (rgba.data[i + 3]! < 20) continue
      seen.add(
        `${rgba.data[i]! >> 4},${rgba.data[i + 1]! >> 4},${rgba.data[i + 2]! >> 4}`,
      )
      if (seen.size >= 4) return true
    }
  }
  return seen.size >= 2
}

export async function loadMobVisual(
  mob: MobCatalogEntry,
): Promise<{ model: VanillaHumanoid; bytes: Uint8Array; extraTextures?: Record<string, Uint8Array> } | null> {
  const model = humanoidModelFor(mob.id)
  if (!model) return null
  const bytes = await loadMobTextureBytes(mob, model)
  if (!bytes) return null
  const extraTextures: Record<string, Uint8Array> = {}
  if (mob.id === 'snow_golem_pumpkin') {
    await initMinecraftAssets()
    const loadBlock = async (id: string) =>
      (await fetchBlockFacePng(id)) ?? (await fetchTexturePng(`block/${id}`))
    const face = await loadBlock('carved_pumpkin')
    const side = await loadBlock('pumpkin_side')
    const top = await loadBlock('pumpkin_top')
    if (face) extraTextures.pumpkin_face = face
    if (side) extraTextures.pumpkin_side = side
    if (top) extraTextures.pumpkin_top = top
  }
  const extras = catalogExtraMaterials(mob.id)
  if (extras.wool) {
    const woolPath = mob.id.startsWith('baby_')
      ? 'textures/entity/sheep/sheep_wool_baby.png'
      : 'textures/entity/sheep/sheep_wool.png'
    const wool = await fetchFirstTexture([woolPath], model.textureSize)
    if (wool) extraTextures.wool = wool
  }
  return Object.keys(extraTextures).length > 0
    ? { model, bytes, extraTextures }
    : { model, bytes }
}

export function playerPreviewUrl(preset: (typeof PLAYER_PRESETS)[number]): string {
  const path = expandTexturePaths(preset.texturePaths)[0]
  const local = path ? localEntityTextureUrl(path) : null
  return local || preset.fallbackUrl || ''
}

export function mobPreviewUrl(entry: MobCatalogEntry): string {
  const variant = villagerVariantForMobId(entry.id)
  const paths = variant
    ? villagerTexturePaths(variant, entry.id.startsWith('baby_'))
    : entry.texturePaths
  const path = expandTexturePaths(paths)[0]
  return (path ? localEntityTextureUrl(path) : null) ?? ''
}

/** Basename for map_Kd in catalog entity OBJ/MTL (matches vanilla asset names). */
export function mobEntityTextureFileName(mob: MobCatalogEntry): string {
  const path = expandTexturePaths(mob.texturePaths)[0]
  if (!path) return `${mob.id}.png`
  const base = path.split('/').pop() ?? `${mob.id}.png`
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`
}

function parseMtlMapKdNames(mtlBytes: Uint8Array | null | undefined): string[] {
  if (!mtlBytes?.length) return []
  const text = new TextDecoder().decode(mtlBytes)
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^map_kd\s+(.+)$/i)
    if (match) names.push(match[1].trim().toLowerCase())
  }
  return names
}

/** Reload textures and re-bake entity OBJ (vertex colours) before voxel convert. */
export async function ensureCatalogEntityTextures(part: ScenePartLocal): Promise<ScenePartLocal> {
  if (!part.sourceLabel?.startsWith('Minecraft entity')) return part
  const mobId = part.fileName.replace(/\.obj$/i, '')
  const mob = ALL_MOBS.find((entry) => entry.id === mobId)
  if (!mob) return part

  await initMinecraftAssets()
  const visual = await loadMobVisual(mob)
  if (!visual) return part

  const textureFile = mobEntityTextureFileName(mob)
  const mainBytes = await ensureRgbaPngBytes(visual.bytes)
  const rebuilt = await entityModelToPart(
    visual.model,
    textureFile,
    mainBytes,
    part.name,
    visual.extraTextures,
  )

  const textures = { ...rebuilt.textures }
  for (const [slot, file] of Object.entries(catalogExtraMaterials(mobId))) {
    const key = file.toLowerCase()
    const bytes = visual.extraTextures?.[slot]
    if (bytes) textures[key] = await ensureRgbaPngBytes(bytes)
  }
  for (const name of parseMtlMapKdNames(rebuilt.mtlBytes)) {
    if (!textures[name]) textures[name] = mainBytes
  }

  // Snap back to native when the statue is still catalog-sized (angry Enderman
  // used to be 5 blocks short). Do not use a ±7 slop — that swallowed Medium /
  // custom sizes on bats and bees whose whole AABB is under 8 blocks.
  const nativeW = rebuilt.width ?? part.width
  const nativeH = rebuilt.height ?? part.height
  const nativeL = rebuilt.length ?? part.length
  const keepUserSize = catalogEntityBoxIsEnlarged(part, {
    width: nativeW,
    height: nativeH,
    length: nativeL,
  })

  return {
    ...part,
    bytes: rebuilt.bytes,
    mtlBytes: rebuilt.mtlBytes,
    mtlFileName: rebuilt.mtlFileName,
    expectedMtlFileName: rebuilt.expectedMtlFileName,
    textures,
    expectedTextureNames: [...new Set(Object.keys(textures))],
    width: keepUserSize ? part.width : nativeW,
    height: keepUserSize ? part.height : nativeH,
    length: keepUserSize ? part.length : nativeL,
    skinPose: sanitizeCatalogSkinPose(mobId, part.skinPose ?? rebuilt.skinPose, rebuilt.skinPose),
  }
}

/**
 * Drop stale angry-Enderman head lifts and always refresh pivots from the rebuilt mesh.
 * Older parts stored head pos +5 on top of geometry that now already includes the lift.
 */
function sanitizeCatalogSkinPose(
  mobId: string,
  pose: ScenePartLocal['skinPose'],
  rebuilt: ScenePartLocal['skinPose'],
): ScenePartLocal['skinPose'] {
  // Angry mouth is baked into cubes — never keep a leftover head translation.
  if (mobId === 'enderman_angry') {
    const base = rebuilt ?? pose
    if (!base) return rebuilt
    const parts = { ...base.parts }
    if (parts.head) {
      parts.head = { ...parts.head, pos: [0, 0, 0] }
    }
    // Keep user rotations from the live pose when present.
    if (pose?.parts) {
      for (const [name, partPose] of Object.entries(pose.parts)) {
        if (name === 'head') {
          parts.head = {
            ...(parts.head ?? partPose),
            rot: partPose.rot,
            bend: partPose.bend,
            scale: partPose.scale,
            pos: [0, 0, 0],
          }
          continue
        }
        parts[name] = partPose
      }
    }
    return {
      ...base,
      parts,
      pivots: rebuilt?.pivots ?? base.pivots,
      poseParents: rebuilt?.poseParents ?? base.poseParents,
      rigid: true,
    }
  }
  if (!pose) return rebuilt
  return {
    ...pose,
    pivots: rebuilt?.pivots ?? pose.pivots,
    poseParents: rebuilt?.poseParents ?? pose.poseParents,
  }
}
