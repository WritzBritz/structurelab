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
 * Classic right-arm back occupies u=52..55. Slim only uses u=51..53, so
 * columns 54–55 are unused. Default Alex leaves them transparent; Steve paints
 * them. Same idea on the 64×64 left arm (u=46–47).
 *
 * This is how the launcher / NameMC / MineSkin classify a PNG when the file
 * has no Slim metadata.
 */
export function detectSlimSkin(image: RgbaImage | null | undefined): boolean | null {
  if (!image) return null
  const atlas = parseSkinAtlas(image.width, image.height)
  if (!atlas) return null
  // Slim (Alex) only exists on 64×64 and HD multiples.
  if (atlas.legacy) return false

  const sx = atlas.scale
  const sy = atlas.scale
  let transparent = 0
  let samples = 0

  const probe = (u: number, v: number) => {
    samples += 1
    if (alphaAt(image, (u + 0.5) * sx, (v + 0.5) * sy) < 128) transparent += 1
  }

  // Right-arm back, 4th (and leftover) column — classic-only texels.
  for (const u of [54, 55]) {
    for (let v = 20; v < 32; v += 2) probe(u, v)
  }
  // Left arm on 64×64 sheets (same unused strip).
  if (atlas.layoutH >= 64) {
    for (const u of [46, 47]) {
      for (let v = 52; v < 64; v += 2) probe(u, v)
    }
  }

  if (samples === 0) return null
  const ratio = transparent / samples
  if (ratio >= 0.7) return true
  if (ratio <= 0.3) return false
  return null
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
  return detectSlimSkin(image) ?? slimHintFromFileName(fileName ?? '') ?? false
}

function alphaAt(image: RgbaImage, x: number, y: number): number {
  const ix = Math.min(image.width - 1, Math.max(0, Math.floor(x)))
  const iy = Math.min(image.height - 1, Math.max(0, Math.floor(y)))
  return image.data[(iy * image.width + ix) * 4 + 3] ?? 0
}
