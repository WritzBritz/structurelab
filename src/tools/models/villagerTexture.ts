/**
 * Villager / zombie villager textures are multi-layer composited in Java.
 * A type sheet (plains.png) or profession sheet alone is mostly transparent —
 * the head looks missing if we use only one overlay PNG.
 *
 * Also used for EyesLayer (enderman purple / spider red): base sheet + sparse
 * emissive overlay. Overlay decode must preserve alpha — a flattened opaque
 * eyes PNG would paint the whole body one colour on convert.
 */
import { decodeImageRgba } from './decodeImage'
import { decodePngRgba } from './decodePngRgba'

async function loadRgba(bytes: Uint8Array): Promise<ImageData | null> {
  // Prefer CPU PNG decode so indexed + tRNS (vanilla eyes) keep real alpha.
  const png = await decodePngRgba(bytes)
  if (png) {
    return new ImageData(new Uint8ClampedArray(png.data), png.width, png.height)
  }
  const image = await decodeImageRgba(bytes)
  if (!image) return null
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
}

function opaqueRatio(image: ImageData): number {
  const data = image.data
  let opaque = 0
  let total = 0
  for (let i = 3; i < data.length; i += 4) {
    total += 1
    if (data[i]! >= 20) opaque += 1
  }
  return total > 0 ? opaque / total : 0
}

function blitOverlay(base: ImageData, overlay: ImageData): void {
  const bw = base.width
  const bh = base.height
  const ow = overlay.width
  const oh = overlay.height
  const bd = base.data
  const od = overlay.data
  // Crop / clamp when EyesLayer sheet size differs from the model atlas.
  const w = Math.min(bw, ow)
  const h = Math.min(bh, oh)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (y * ow + x) * 4
      const di = (y * bw + x) * 4
      const a = od[si + 3]!
      // EyesLayer / type overlays are sparse cutouts — ignore weak alpha.
      if (a < 20) continue
      // Eyes are emissive: replace base (don't blend with black body) so purple
      // survives convert averaging against neighbouring dark head texels.
      if (a >= 200) {
        bd[di] = od[si]!
        bd[di + 1] = od[si + 1]!
        bd[di + 2] = od[si + 2]!
        bd[di + 3] = 255
        continue
      }
      const t = a / 255
      bd[di] = Math.round(od[si]! * t + bd[di]! * (1 - t))
      bd[di + 1] = Math.round(od[si + 1]! * t + bd[di + 1]! * (1 - t))
      bd[di + 2] = Math.round(od[si + 2]! * t + bd[di + 2]! * (1 - t))
      bd[di + 3] = Math.max(bd[di + 3]!, a)
    }
  }
}

/** True when an overlay looks like a destroyed opaque sheet (not a sparse EyesLayer). */
function looksLikeFlattenedWash(image: ImageData): boolean {
  const ratio = opaqueRatio(image)
  if (ratio <= 0.4) return false
  const data = image.data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 20) continue
    r += data[i]!
    g += data[i + 1]!
    b += data[i + 2]!
    n += 1
  }
  if (n < 1) return true
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255
  return lum < 0.2
}

async function canvasFromRgba(image: ImageData): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

/** Composite base + optional type/profession/eyes overlay sheets onto one atlas. */
export async function compositeVillagerTexture(
  layers: Uint8Array[],
  expectedSize: [number, number] = [64, 64],
): Promise<Uint8Array | null> {
  const [ew, eh] = expectedSize
  let base: ImageData | null = null
  for (const bytes of layers) {
    const layer = await loadRgba(bytes)
    if (!layer) continue
    if (layer.width === ew && layer.height === eh) {
      if (!base) {
        base = new ImageData(new Uint8ClampedArray(layer.data), ew, eh)
        continue
      }
      // Sparse overlays only. A flattened opaque near-black sheet (WebView2
      // alpha loss) would stamp the whole body one colour — skip those.
      if (looksLikeFlattenedWash(layer)) continue
      blitOverlay(base, layer)
    } else if (!base && layer.width >= ew && layer.height >= eh) {
      base = new ImageData(new Uint8ClampedArray(ew * eh * 4), ew, eh)
      for (let y = 0; y < eh; y += 1) {
        for (let x = 0; x < ew; x += 1) {
          const si = (y * layer.width + x) * 4
          const di = (y * ew + x) * 4
          base.data[di] = layer.data[si]!
          base.data[di + 1] = layer.data[si + 1]!
          base.data[di + 2] = layer.data[si + 2]!
          base.data[di + 3] = layer.data[si + 3]!
        }
      }
    } else if (base) {
      if (looksLikeFlattenedWash(layer)) continue
      blitOverlay(base, layer)
    }
  }
  if (!base) return layers[0] ?? null
  return canvasFromRgba(base)
}

export type VillagerVariant = {
  id: string
  name: string
  type?: string
  profession?: string
  zombie?: boolean
}

export const VILLAGER_VARIANTS: VillagerVariant[] = [
  { id: 'villager', name: 'Villager (plains)', type: 'plains' },
  { id: 'villager_desert', name: 'Villager (desert)', type: 'desert' },
  { id: 'villager_taiga', name: 'Villager (taiga)', type: 'taiga' },
  { id: 'villager_snow', name: 'Villager (snow)', type: 'snow' },
  { id: 'villager_jungle', name: 'Villager (jungle)', type: 'jungle' },
  { id: 'villager_swamp', name: 'Villager (swamp)', type: 'swamp' },
  { id: 'villager_savanna', name: 'Villager (savanna)', type: 'savanna' },
  { id: 'villager_farmer', name: 'Villager (farmer)', type: 'plains', profession: 'farmer' },
  { id: 'villager_librarian', name: 'Villager (librarian)', type: 'plains', profession: 'librarian' },
  { id: 'villager_armorer', name: 'Villager (armorer)', type: 'plains', profession: 'armorer' },
  { id: 'villager_butcher', name: 'Villager (butcher)', type: 'plains', profession: 'butcher' },
  { id: 'villager_cleric', name: 'Villager (cleric)', type: 'plains', profession: 'cleric' },
  { id: 'villager_fisherman', name: 'Villager (fisherman)', type: 'plains', profession: 'fisherman' },
  { id: 'villager_fletcher', name: 'Villager (fletcher)', type: 'plains', profession: 'fletcher' },
  { id: 'villager_leatherworker', name: 'Villager (leatherworker)', type: 'plains', profession: 'leatherworker' },
  { id: 'villager_mason', name: 'Villager (mason)', type: 'plains', profession: 'mason' },
  { id: 'villager_shepherd', name: 'Villager (shepherd)', type: 'plains', profession: 'shepherd' },
  { id: 'villager_toolsmith', name: 'Villager (toolsmith)', type: 'plains', profession: 'toolsmith' },
  { id: 'villager_weaponsmith', name: 'Villager (weaponsmith)', type: 'plains', profession: 'weaponsmith' },
]

export function villagerTexturePaths(variant: VillagerVariant, baby = false): string[] {
  const root = variant.zombie ? 'zombie_villager' : 'villager'
  const paths: string[] = []
  if (variant.zombie) {
    if (baby) paths.push(`textures/entity/zombie_villager/zombie_villager_baby.png`)
    else paths.push(`textures/entity/zombie_villager/zombie_villager.png`)
  } else if (baby) {
    // 26.1+ dedicated baby atlas — adult villager.png UVs do not match the baby mesh.
    paths.push(`textures/entity/villager/villager_baby.png`)
  } else {
    paths.push(`textures/entity/villager/villager.png`)
  }
  if (variant.type) {
    if (baby) {
      paths.push(`textures/entity/${root}/baby/${variant.type}.png`)
      paths.push(`textures/entity/${root}/type/baby/${variant.type}.png`)
      paths.push(`textures/entity/${root}/baby/type/${variant.type}.png`)
    } else {
      paths.push(`textures/entity/${root}/type/${variant.type}.png`)
    }
  }
  if (variant.profession) {
    if (baby) {
      paths.push(`textures/entity/${root}/profession/baby/${variant.profession}.png`)
    } else {
      paths.push(`textures/entity/${root}/profession/${variant.profession}.png`)
    }
  }
  return paths
}

export function villagerVariantForMobId(id: string): VillagerVariant | null {
  const bare = id.startsWith('baby_') ? id.slice(5) : id
  if (bare === 'zombie_villager') {
    return { id: 'zombie_villager', name: 'Zombie Villager (plains)', type: 'plains', zombie: true }
  }
  if (bare === 'villager') {
    return VILLAGER_VARIANTS.find((v) => v.id === 'villager') ?? null
  }
  return VILLAGER_VARIANTS.find((v) => v.id === bare) ?? null
}
