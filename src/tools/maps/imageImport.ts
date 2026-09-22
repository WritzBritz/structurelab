/** Map-art source import: accept and normalize many image formats to PNG bytes. */

const EXT_MIME: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  svg: ['image/svg+xml'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heif', 'image/heic'],
  avif: ['image/avif'],
  bmp: ['image/bmp', 'image/x-bmp', 'image/x-ms-bmp'],
  tiff: ['image/tiff'],
  tif: ['image/tiff'],
  ico: ['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'],
}

export const MAP_IMAGE_EXTENSIONS = Object.keys(EXT_MIME)

export const MAP_IMAGE_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
  '.bmp',
  '.tiff',
  '.tif',
  '.ico',
].join(',')

export const MAP_IMAGE_FORMATS_HINT =
  'PNG · JPEG · WebP · GIF · SVG · HEIC · HEIF · AVIF · BMP · TIFF · ICO'

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() || name
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedMapImage(file: File): boolean {
  const ext = extensionOf(file.name)
  if (ext && EXT_MIME[ext]) return true
  const type = (file.type || '').toLowerCase()
  if (!type || type === 'application/octet-stream') return false
  return Object.values(EXT_MIME).some((mimes) => mimes.includes(type))
}

function isHeicLike(file: File): boolean {
  const ext = extensionOf(file.name)
  if (ext === 'heic' || ext === 'heif') return true
  const type = (file.type || '').toLowerCase()
  return type === 'image/heic' || type === 'image/heif'
}

function isTiffLike(file: File): boolean {
  const ext = extensionOf(file.name)
  if (ext === 'tiff' || ext === 'tif') return true
  return (file.type || '').toLowerCase() === 'image/tiff'
}

async function blobToPngBytes(blob: Blob): Promise<{ bytes: Uint8Array; width: number; height: number; previewUrl: string }> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, bitmap.width)
    canvas.height = Math.max(1, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas for image import')
    ctx.drawImage(bitmap, 0, 0)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('Failed to encode PNG'))),
        'image/png',
      )
    })
    const bytes = new Uint8Array(await pngBlob.arrayBuffer())
    const previewUrl = URL.createObjectURL(pngBlob)
    return { bytes, width: canvas.width, height: canvas.height, previewUrl }
  } finally {
    bitmap.close()
  }
}

async function rasterizeViaElement(blob: Blob): Promise<{ bytes: Uint8Array; width: number; height: number; previewUrl: string }> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Browser could not decode this image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, image.naturalWidth || image.width)
    canvas.height = Math.max(1, image.naturalHeight || image.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas for image import')
    ctx.drawImage(image, 0, 0)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('Failed to encode PNG'))),
        'image/png',
      )
    })
    const bytes = new Uint8Array(await pngBlob.arrayBuffer())
    const previewUrl = URL.createObjectURL(pngBlob)
    return { bytes, width: canvas.width, height: canvas.height, previewUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function rasterizeBrowser(blob: Blob): Promise<{ bytes: Uint8Array; width: number; height: number; previewUrl: string }> {
  try {
    return await blobToPngBytes(blob)
  } catch {
    return rasterizeViaElement(blob)
  }
}

async function rasterizeHeic(file: File): Promise<{ bytes: Uint8Array; width: number; height: number; previewUrl: string }> {
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({
    blob: file,
    toType: 'image/png',
    quality: 1,
  })
  const blob = Array.isArray(converted) ? converted[0] : converted
  if (!(blob instanceof Blob)) throw new Error('HEIC conversion failed')
  return rasterizeBrowser(blob)
}

async function rasterizeTiff(file: File): Promise<{ bytes: Uint8Array; width: number; height: number; previewUrl: string }> {
  const UTIF = await import('utif')
  const buffer = await file.arrayBuffer()
  const ifds = UTIF.decode(buffer)
  if (!ifds.length) throw new Error('TIFF has no image pages')
  const page = ifds[0]!
  UTIF.decodeImage(buffer, page)
  const rgba = UTIF.toRGBA8(page)
  const width = page.width || 0
  const height = page.height || 0
  if (width < 1 || height < 1) throw new Error('Invalid TIFF dimensions')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas for TIFF import')
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height)
  ctx.putImageData(imageData, 0, 0)
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('Failed to encode TIFF as PNG'))),
      'image/png',
    )
  })
  const bytes = new Uint8Array(await pngBlob.arrayBuffer())
  return { bytes, width, height, previewUrl: URL.createObjectURL(pngBlob) }
}

export type ImportedMapImage = {
  bytes: Uint8Array
  previewUrl: string
  width: number
  height: number
  fileName: string
}

/**
 * Load a map source file and normalize to PNG bytes for the converter + preview.
 * GIF uses the first frame; SVG is rasterized at intrinsic size.
 */
export async function importMapImage(file: File): Promise<ImportedMapImage> {
  if (!isAllowedMapImage(file)) {
    throw new Error(`Unsupported image type. Use ${MAP_IMAGE_FORMATS_HINT}`)
  }

  let result: { bytes: Uint8Array; width: number; height: number; previewUrl: string }
  if (isHeicLike(file)) {
    result = await rasterizeHeic(file)
  } else if (isTiffLike(file)) {
    try {
      result = await rasterizeBrowser(file)
    } catch {
      result = await rasterizeTiff(file)
    }
  } else {
    result = await rasterizeBrowser(file)
  }

  return {
    ...result,
    fileName: file.name,
  }
}
