import { decodeImageRgba, type RgbaImage } from './decodeImage'

/** Vanilla player-skin UV layout width. HD skins are integer multiples of this. */
export const SKIN_LAYOUT_W = 64
/**
 * Decode / GPU safety rail — not a Minecraft format rule.
 * 8192² RGBA is 256 MB; most GPUs also cap textures at 8192 or 16384.
 */
export const SKIN_MAX_EDGE = 8192

export type SkinAtlas = {
  /** PNG pixels per vanilla UV unit (`width / 64`). */
  scale: number
  width: number
  height: number
  /** 64 for modern sheets, 32 for pre-1.8 2:1 sheets. */
  layoutH: 32 | 64
  legacy: boolean
}

/**
 * Minecraft player skins keep the 64×64 (or legacy 64×32) UV atlas and scale
 * it to any integer multiple (128, 256, 4K, 8K, …).
 */
export function parseSkinLayout(width: number, height: number): SkinAtlas | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < SKIN_LAYOUT_W || width % SKIN_LAYOUT_W !== 0) return null
  const scale = width / SKIN_LAYOUT_W
  if (scale < 1) return null
  if (height === width) {
    return { scale, width, height, layoutH: 64, legacy: false }
  }
  if (height * 2 === width) {
    return { scale, width, height, layoutH: 32, legacy: true }
  }
  return null
}

export function parseSkinAtlas(width: number, height: number): SkinAtlas | null {
  const atlas = parseSkinLayout(width, height)
  if (!atlas) return null
  if (atlas.width > SKIN_MAX_EDGE || atlas.height > SKIN_MAX_EDGE) return null
  return atlas
}

/**
 * Half a PNG texel, expressed in vanilla 64-wide layout units.
 * A 0.5 layout inset on HD sheets crops `scale/2` real pixels off every face
 * (a 256² shirt loses 2px on each edge — the usual “detail cut off” look).
 */
export function skinLayoutTexelInset(scale: number): number {
  return 0.5 / Math.max(1, scale)
}

export function skinSizeHint(width: number, height: number): string {
  const layout = parseSkinLayout(width, height)
  if (layout && (layout.width > SKIN_MAX_EDGE || layout.height > SKIN_MAX_EDGE)) {
    return `${width}×${height} is too large to load. HD player skins can go up to ${SKIN_MAX_EDGE}×${SKIN_MAX_EDGE}.`
  }
  return `${width}×${height} is not a Minecraft player skin (need 64×64, 64×32, or an HD scale of that layout).`
}

export function skinHdNote(atlas: SkinAtlas): string | null {
  return atlas.scale > 1 ? `${atlas.width}×${atlas.height}` : null
}

export async function inspectPlayerSkin(
  bytes: Uint8Array,
  fileName?: string,
): Promise<{ atlas: SkinAtlas; slim: boolean }> {
  const image = await decodeImageRgba(bytes)
  if (!image) throw new Error('Could not decode the skin PNG')
  const atlas = parseSkinAtlas(image.width, image.height)
  if (!atlas) throw new Error(skinSizeHint(image.width, image.height))
  const slim = detectSlimSkin(image) ?? slimHintFromFileName(fileName ?? '') ?? false
  return { atlas, slim }
}

/**
 * Minecraft player arm model (Steve 4px vs Alex 3px).
 *
 * Matches skinview-utils `inferModelType` (used by skinview3d / NameMC-style
 * viewers). Slim right/left arms leave four unused strips on the first layer:
 *   right: (50,16) 2×4 and (54,20) 2×12
 *   left:  (42,48) 2×4 and (46,52) 2×12
 * Classic forbids transparency there. Any non-opaque pixel in those strips
 * (or the strips being solid black / solid white placeholders) ⇒ slim.
 * HD skins use the same layout units × (width/64).
 *
 * Important: do not sample front-face “4th columns” — on slim those texels are
 * part of the inner arm face and are supposed to be painted.
 */
export function detectSlimSkin(image: RgbaImage | null | undefined): boolean | null {
  if (!image) return null
  const atlas = parseSkinAtlas(image.width, image.height)
  if (!atlas) return null
  // Slim (Alex) only exists on 64×64 and HD multiples.
  if (atlas.legacy) return false

  const scale = atlas.scale
  const regions: Array<[number, number, number, number]> = [
    [50, 16, 2, 4],
    [54, 20, 2, 12],
  ]
  if (atlas.layoutH >= 64) {
    regions.push([42, 48, 2, 4], [46, 52, 2, 12])
  }

  const hasGap = regions.some((r) => regionHasTransparency(image, r[0], r[1], r[2], r[3], scale))
  if (hasGap) return true

  const allBlack = regions.every((r) => regionIsSolid(image, r[0], r[1], r[2], r[3], scale, 0, 0, 0))
  if (allBlack) return true

  const allWhite = regions.every((r) =>
    regionIsSolid(image, r[0], r[1], r[2], r[3], scale, 255, 255, 255),
  )
  if (allWhite) return true

  return false
}

/** Filename fallback when the unused arm strip is painted or empty. */
export function slimHintFromFileName(fileName: string): boolean | null {
  const name = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  if (/(^|[^a-z])alex([^a-z]|$)/.test(name) || name.includes('slim')) return true
  if (/(^|[^a-z])steve([^a-z]|$)/.test(name) || /\b(wide|classic)\b/.test(name)) return false
  return null
}

export async function detectSlimSkinBytes(bytes: Uint8Array, fileName?: string): Promise<boolean> {
  const image = await decodeImageRgba(bytes)
  // Pixel detection always returns true/false for valid modern atlases.
  const detected = detectSlimSkin(image)
  if (detected != null) return detected
  return slimHintFromFileName(fileName ?? '') ?? false
}

function rgbaAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const ix = Math.min(image.width - 1, Math.max(0, Math.floor(x)))
  const iy = Math.min(image.height - 1, Math.max(0, Math.floor(y)))
  const i = (iy * image.width + ix) * 4
  return [
    image.data[i] ?? 0,
    image.data[i + 1] ?? 0,
    image.data[i + 2] ?? 0,
    image.data[i + 3] ?? 0,
  ]
}

/** True if any pixel in the layout rect is not fully opaque (skinview-utils). */
function regionHasTransparency(
  image: RgbaImage,
  layoutX: number,
  layoutY: number,
  layoutW: number,
  layoutH: number,
  scale: number,
): boolean {
  const x0 = layoutX * scale
  const y0 = layoutY * scale
  const w = layoutW * scale
  const h = layoutH * scale
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [, , , a] = rgbaAt(image, x0 + x, y0 + y)
      if (a !== 255) return true
    }
  }
  return false
}

function regionIsSolid(
  image: RgbaImage,
  layoutX: number,
  layoutY: number,
  layoutW: number,
  layoutH: number,
  scale: number,
  r: number,
  g: number,
  b: number,
): boolean {
  const x0 = layoutX * scale
  const y0 = layoutY * scale
  const w = layoutW * scale
  const h = layoutH * scale
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [pr, pg, pb, pa] = rgbaAt(image, x0 + x, y0 + y)
      if (pr !== r || pg !== g || pb !== b || pa !== 255) return false
    }
  }
  return true
}
