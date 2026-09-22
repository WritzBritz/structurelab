/**
 * Decode raster textures used by Maya / COLLADA / FBX / OBJ / glTF, including formats
 * the browser cannot load (TGA, TIFF). Prefer the highest-resolution sibling so
 * a full-res TGA skin is not replaced by a tiny PNG of the same stem.
 */

import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { decodePngIndexedRgba, pngColorType } from './decodePngRgba'
import { exportNameAliases, exportNamesMatch, foldExportName, repairMojibake } from './exportText'

export type RgbaImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type ResolvedTexture = {
  fileName: string
  bytes: Uint8Array
  width: number
  height: number
  substituted: boolean
}

const BROWSER_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i
const RASTER_EXT = /\.(png|jpe?g|webp|bmp|gif|tif|tiff|tga)$/i
const ALT_EXTS = ['.tga', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']

function fileBasename(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

export function textureStem(name: string): string {
  return foldExportName(fileBasename(name).replace(/\.[^.]+$/, ''))
}

export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (
    bytes.length >= 4
    && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a))
  ) {
    return 'image/tiff'
  }
  if (looksLikeTga(bytes)) return 'image/x-tga'
  return 'image/png'
}

function looksLikeTga(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false
  const imageType = bytes[2]!
  const depth = bytes[16]!
  return (
    (imageType === 2 || imageType === 10 || imageType === 3 || imageType === 11 || imageType === 1 || imageType === 9)
    && (depth === 8 || depth === 16 || depth === 24 || depth === 32)
  )
}

function decodeTgaRgba(bytes: Uint8Array): RgbaImage | null {
  try {
    // TGALoader reads the whole ArrayBuffer; copy so a view cannot overrun.
    const copy = bytes.slice()
    const parsed = new TGALoader().parse(copy.buffer)
    const width = parsed.width ?? 0
    const height = parsed.height ?? 0
    if (!parsed?.data || width < 1 || height < 1) return null
    const data = parsed.data instanceof Uint8ClampedArray
      ? parsed.data
      : new Uint8ClampedArray(parsed.data)
    // TGALoader already writes HTML/canvas (top-down) order; flipY is for GPU upload.
    return { width, height, data }
  } catch {
    return null
  }
}

async function decodeTiffRgba(bytes: Uint8Array): Promise<RgbaImage | null> {
  try {
    const UTIF = await import('utif')
    const copy = bytes.slice()
    const ifds = UTIF.decode(copy.buffer)
    if (!ifds.length) return null
    const page = ifds[0]!
    UTIF.decodeImage(copy.buffer, page)
    const rgba = UTIF.toRGBA8(page)
    const width = page.width || 0
    const height = page.height || 0
    if (width < 1 || height < 1) return null
    return { width, height, data: new Uint8ClampedArray(rgba) }
  } catch {
    return null
  }
}

async function decodeBrowserRgba(bytes: Uint8Array, mime: string): Promise<RgbaImage | null> {
  const copy = Uint8Array.from(bytes)
  const blob = new Blob([copy], { type: mime })
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return null
        ctx.drawImage(bitmap, 0, 0)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        return { width: image.width, height: image.height, data: image.data }
      } finally {
        bitmap.close()
      }
    }
  } catch {
    // Fall through to HTMLImageElement.
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    if (canvas.width < 1 || canvas.height < 1) return null
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: image.width, height: image.height, data: image.data }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Decode PNG/JPEG/WebP/BMP/GIF/TGA/TIFF to 8-bit RGBA. */
export async function decodeImageRgba(bytes: Uint8Array): Promise<RgbaImage | null> {
  if (!bytes || bytes.length < 18) return null
  const mime = sniffImageMime(bytes)
  if (mime === 'image/x-tga') return decodeTgaRgba(bytes)
  if (mime === 'image/tiff') return decodeTiffRgba(bytes)
  // Indexed PNG + tRNS (bee.png and other vanilla sheets): WebGL TextureLoader
  // often uploads an all-empty alpha channel, so entity cutout discards the mesh.
  if (mime === 'image/png' && pngColorType(bytes) === 3) {
    const indexed = await decodePngIndexedRgba(bytes)
    // Do not fall through to createImageBitmap: WebView2 often returns a
    // solid gray sheet for indexed + tRNS, which then gets uploaded as-is.
    return indexed
  }
  return decodeBrowserRgba(bytes, mime)
}

/**
 * Vanilla entity sheets are often indexed PNG + tRNS. Preview already rebakes
 * those for WebGL; convert/voxelize must get true RGBA or the mesh is sampled
 * as grey Kd and comes out as wool.
 */
export async function ensureRgbaPngBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const colorType = pngColorType(bytes)
  // Already truecolour RGBA — Rust `image` and our vertex baker both handle this.
  if (colorType === 6) return bytes
  // Indexed / RGB / grayscale: rebake to RGBA PNG so convert never depends on
  // exotic PNG features the sidecar path might mishandle.
  const rgba = await decodeImageRgba(bytes)
  if (!rgba) return bytes
  return (await rgbaToPngBytes(rgba)) ?? bytes
}

export async function rgbaToPngBytes(image: RgbaImage): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const pixels = new Uint8ClampedArray(image.data.length)
  pixels.set(image.data)
  ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((out) => resolve(out), 'image/png')
  })
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

function isBrowserSafeRaster(fileName: string, bytes: Uint8Array): boolean {
  if (!BROWSER_EXT.test(fileName)) return false
  const mime = sniffImageMime(bytes)
  if (mime === 'image/x-tga' || mime === 'image/tiff') return false
  // Indexed PNG + tRNS: WebView2/WebGL often upload gray or empty alpha.
  if (mime === 'image/png' && pngColorType(bytes) === 3) return false
  return true
}

/**
 * Make a texture browser- and MTL-safe. TGA/TIFF and indexed vanilla PNGs
 * become truecolour PNG so WebView2 / Three.js can sample the pixels.
 */
export async function ensureBrowserTexture(
  fileName: string,
  bytes: Uint8Array,
): Promise<{ fileName: string; bytes: Uint8Array; width: number; height: number } | null> {
  const image = await decodeImageRgba(bytes)
  if (!image) return null
  if (isBrowserSafeRaster(fileName, bytes)) {
    return { fileName: fileBasename(fileName), bytes, width: image.width, height: image.height }
  }
  const png = await rgbaToPngBytes(image)
  if (!png) {
    return { fileName: fileBasename(fileName), bytes, width: image.width, height: image.height }
  }
  return {
    fileName: `${fileBasename(fileName).replace(/\.[^.]+$/, '')}.png`,
    bytes: png,
    width: image.width,
    height: image.height,
  }
}

/**
 * Maya 3D Paint / duplicated file nodes append `_1`, `_1_1_2_1`, or `0007_1`
 * onto the original basename. Those copies are the same texture as `foo.png`.
 */
export function unversionedTextureStem(name: string): string {
  let stem = textureStem(name)
  let prev = ''
  while (stem !== prev) {
    prev = stem
    stem = stem.replace(/([_\-]\d+)+$/u, '').replace(/[_\-]+$/u, '')
  }
  return stem.length >= 3 ? stem : textureStem(name)
}

function compactStem(name: string): string {
  return unversionedTextureStem(name).replace(/[^\p{L}\p{N}]+/gu, '')
}

function isPaintVersionSuffix(rest: string): boolean {
  // `_1_1_2_1` or `0007_1` (3d Paint). Bare `0001` stays a distinct map.
  return /^([_\-]\d+)+$/i.test(rest) || /^(\d{3,})([_\-]\d+)+$/i.test(rest)
}

/** True when two names are the same texture, ignoring extension and Maya paint suffixes. */
export function texturesRelatedByStem(a: string, b: string): boolean {
  const sa = textureStem(a)
  const sb = textureStem(b)
  if (sa === sb) return true
  const ca = compactStem(a)
  const cb = compactStem(b)
  if (ca.length >= 4 && ca === cb) return true
  if (sa.startsWith(sb) && isPaintVersionSuffix(sa.slice(sb.length))) return true
  if (sb.startsWith(sa) && isPaintVersionSuffix(sb.slice(sa.length))) return true
  const ua = unversionedTextureStem(a)
  const ub = unversionedTextureStem(b)
  if (ua === ub) return true
  if (sa.startsWith(ub) && isPaintVersionSuffix(sa.slice(ub.length))) return true
  if (sb.startsWith(ua) && isPaintVersionSuffix(sb.slice(ua.length))) return true
  return false
}

export function sameStemTextureNames(wanted: string): string[] {
  const base = fileBasename(wanted)
  const names = new Set<string>(exportNameAliases(base))
  const rawStem = repairStem(base)
  const stems = new Set<string>([rawStem, unversionedTextureStem(base)])
  let stem = rawStem
  while (true) {
    const next = stem.replace(/([_\-]\d+)+$/u, '').replace(/[_\-]+$/u, '')
    if (next === stem || next.length < 3) break
    stem = next
    stems.add(stem)
  }
  for (const s of stems) {
    for (const ext of ALT_EXTS) names.add(s + ext)
  }
  return [...names]
}

function repairStem(name: string): string {
  return fileBasename(name).replace(/\.[^.]+$/, '')
}

export function isRasterTextureName(name: string): boolean {
  return RASTER_EXT.test(name)
}

/** Scene-hinted names plus same-stem TGA/TIFF/PNG variants sitting beside them. */
export function textureNamesToProbe(wanted: string): string[] {
  return isRasterTextureName(wanted) ? sameStemTextureNames(wanted) : [fileBasename(wanted)]
}

export function isWantedTextureOnDisk(diskName: string, wanted: string[]): boolean {
  if (wanted.length === 0) return true
  if (wanted.some((name) => exportNamesMatch(fileBasename(name), diskName))) return true
  return wanted.some((name) => texturesRelatedByStem(diskName, name))
}

function lookup(textures: Record<string, Uint8Array>, name: string): Uint8Array | null {
  const base = fileBasename(name)
  for (const alias of exportNameAliases(base)) {
    const bytes = textures[alias] ?? textures[alias.toLowerCase()] ?? textures[foldExportName(alias)]
    if (bytes?.length) return bytes
  }
  const want = foldExportName(base)
  const hit = Object.entries(textures).find(([n, bytes]) => bytes.length > 0 && foldExportName(n) === want)
  return hit?.[1] ?? null
}

/**
 * Among every same-stem file on disk, keep the one with the most pixels so a
 * full-res Maya TGA is not discarded for a tiny PNG of the same name.
 */
export async function pickHighestQualityTexture(
  wanted: string,
  textures: Record<string, Uint8Array>,
): Promise<ResolvedTexture | null> {
  const candidates: { fileName: string; bytes: Uint8Array }[] = []
  const seen = new Set<string>()
  const consider = (fileName: string, bytes: Uint8Array) => {
    const display = repairMojibake(fileBasename(fileName)).normalize('NFC')
    const key = foldExportName(display)
    if (seen.has(key) || !bytes.length) return
    seen.add(key)
    candidates.push({ fileName: display, bytes })
  }
  for (const name of sameStemTextureNames(wanted)) {
    const bytes = lookup(textures, name)
    if (bytes) consider(name, bytes)
  }
  for (const [name, bytes] of Object.entries(textures)) {
    if (!bytes.length) continue
    if (texturesRelatedByStem(wanted, name)) consider(name, bytes)
  }
  if (candidates.length === 0) {
    const bytes = lookup(textures, wanted)
    if (bytes) consider(wanted, bytes)
  }
  if (candidates.length === 0) return null

  let best: { fileName: string; bytes: Uint8Array; width: number; height: number } | null = null
  let bestPixels = -1
  for (const candidate of candidates) {
    const image = await decodeImageRgba(candidate.bytes)
    if (!image) continue
    const pixels = image.width * image.height
    if (pixels > bestPixels || (pixels === bestPixels && candidate.bytes.length > (best?.bytes.length ?? 0))) {
      bestPixels = pixels
      best = {
        fileName: candidate.fileName,
        bytes: candidate.bytes,
        width: image.width,
        height: image.height,
      }
    }
  }
  if (!best) return null

  const ready = await ensureBrowserTexture(best.fileName, best.bytes)
  if (!ready) return null
  const wantedBase = fileBasename(wanted)
  let fileName = repairMojibake(ready.fileName).normalize('NFC')
  const repairedWanted = repairMojibake(wantedBase).normalize('NFC')
  if (
    textureStem(fileName) === textureStem(repairedWanted)
    && BROWSER_EXT.test(repairedWanted)
    && BROWSER_EXT.test(fileName)
  ) {
    fileName = repairedWanted
  }
  return {
    fileName,
    bytes: ready.bytes,
    width: ready.width,
    height: ready.height,
    substituted: foldExportName(fileName) !== foldExportName(wantedBase),
  }
}

export type PreparedTextures = {
  files: Record<string, Uint8Array>
  fileNameFor: (wanted: string) => string | null
}

/**
 * Rewrite a sibling map so each referenced texture is the highest-resolution
 * same-stem file, transcoded to PNG when the winner is TGA/TIFF.
 */
export async function resolveTextureSiblings(
  wantedNames: string[],
  textures: Record<string, Uint8Array>,
): Promise<PreparedTextures> {
  const byWanted = new Map<string, string>()
  const unique = [...new Set(wantedNames.map((name) => fileBasename(name)).filter(Boolean))]
  const byStem = new Map<string, ResolvedTexture>()
  const pickedFiles: Record<string, Uint8Array> = {}

  for (const wanted of unique) {
    if (!isRasterTextureName(wanted) && !lookup(textures, wanted)) continue
    const stem = unversionedTextureStem(wanted)
    let picked = byStem.get(stem)
    if (!picked) {
      const found = await pickHighestQualityTexture(wanted, textures)
      if (!found) continue
      picked = found
      byStem.set(stem, found)
    }
    const display = repairMojibake(picked.fileName).normalize('NFC')
    pickedFiles[display.toLowerCase()] = picked.bytes
    byWanted.set(wanted.toLowerCase(), display)
    byWanted.set(foldExportName(wanted), display)
    byWanted.set(foldExportName(fileBasename(wanted)), display)
  }

  const files: Record<string, Uint8Array> = {}
  const seen = new Set<string>()
  const take = (name: string, bytes: Uint8Array) => {
    if (!bytes.length) return
    const display = repairMojibake(fileBasename(name)).normalize('NFC')
    const fold = foldExportName(display)
    if (seen.has(fold)) return
    seen.add(fold)
    files[display.toLowerCase()] = bytes
  }
  for (const [name, bytes] of Object.entries(pickedFiles)) take(name, bytes)
  for (const [name, bytes] of Object.entries(textures)) {
    if (pickedFiles[name] || pickedFiles[name.toLowerCase()]) continue
    take(name, bytes)
  }

  return {
    files,
    fileNameFor: (wanted) => {
      const base = fileBasename(wanted)
      return byWanted.get(foldExportName(base))
        ?? byWanted.get(base.toLowerCase())
        ?? null
    },
  }
}

/** MIME for embedding: sniff bytes so a transcoded TGA is served as PNG. */
export function mimeForTextureBytes(fileName: string, bytes?: Uint8Array): string {
  if (bytes && bytes.length >= 18) {
    const sniff = sniffImageMime(bytes)
    if (sniff === 'image/x-tga' || sniff === 'image/tiff') return 'image/png'
    return sniff
  }
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.tga')) return 'image/x-tga'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return 'application/octet-stream'
}

/** Pixel-art sheets stay nearest-neighbour; painted Maya/glTF atlases use filtering. */
export function textureLooksPixelArt(width: number, height: number): boolean {
  return Math.max(width, height) <= 128
}
