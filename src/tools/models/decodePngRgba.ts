/**
 * CPU PNG decode for formats browsers/WebGL often mishandle as GPU textures:
 * indexed (colour type 3) + tRNS. Vanilla entity sheets like bee.png are this.
 */

import { inflateSync, unzlibSync } from 'fflate'

export type PngRgba = {
  width: number
  height: number
  data: Uint8ClampedArray
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  return PNG_SIG.every((b, i) => bytes[i] === b)
}

/** IHDR colour type, or null if not a PNG. 3 = indexed. */
export function pngColorType(bytes: Uint8Array): number | null {
  if (!isPng(bytes) || bytes.length < 26) return null
  return bytes[25] ?? null
}

export async function decodePngIndexedRgba(bytes: Uint8Array): Promise<PngRgba | null> {
  return decodePngRgba(bytes, { indexedOnly: true })
}

/**
 * Decode PNG colour types 2 (RGB), 3 (indexed), and 6 (RGBA) to 8-bit RGBA.
 * Sync-friendly path for baking entity vertex colours before convert.
 */
export async function decodePngRgba(
  bytes: Uint8Array,
  options?: { indexedOnly?: boolean },
): Promise<PngRgba | null> {
  if (!isPng(bytes)) return null
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = -1
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idats: Uint8Array[] = []

  while (offset + 8 <= bytes.length) {
    const len = readU32(bytes, offset)
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    if (offset + 12 + len > bytes.length) break
    const data = bytes.subarray(offset + 8, offset + 8 + len)
    offset += 12 + len
    if (type === 'IHDR') {
      width = readU32(data, 0)
      height = readU32(data, 4)
      bitDepth = data[8] ?? 8
      colorType = data[9] ?? -1
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'tRNS') {
      trns = data
    } else if (type === 'IDAT') {
      idats.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (width < 1 || height < 1 || idats.length === 0) return null
  if (options?.indexedOnly && colorType !== 3) return null
  if (colorType !== 2 && colorType !== 3 && colorType !== 6) return null
  if (colorType === 3 && !palette) return null
  if (bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8) return null

  const inflated = await inflateZlib(concat(idats))
  if (!inflated) return null

  if (colorType === 3) {
    return decodeIndexedRows(inflated, width, height, bitDepth, palette!, trns)
  }

  const channels = colorType === 6 ? 4 : 3
  const bpp = channels * (bitDepth / 8)
  if (bitDepth !== 8) return null
  const rowBytes = width * channels
  const stride = rowBytes + 1
  if (inflated.length < stride * height) return null

  const prev = new Uint8Array(rowBytes)
  const cur = new Uint8Array(rowBytes)
  const out = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride
    const filter = inflated[rowStart]!
    const raw = inflated.subarray(rowStart + 1, rowStart + 1 + rowBytes)
    for (let i = 0; i < rowBytes; i += 1) {
      const x = raw[i]!
      const a = i >= bpp ? cur[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      let v = x
      if (filter === 1) v = (x + a) & 255
      else if (filter === 2) v = (x + b) & 255
      else if (filter === 3) v = (x + ((a + b) >> 1)) & 255
      else if (filter === 4) v = (x + paeth(a, b, c)) & 255
      cur[i] = v
    }
    prev.set(cur)
    for (let x = 0; x < width; x += 1) {
      const si = x * channels
      const di = (y * width + x) * 4
      out[di] = cur[si]!
      out[di + 1] = cur[si + 1]!
      out[di + 2] = cur[si + 2]!
      out[di + 3] = channels === 4 ? cur[si + 3]! : 255
    }
  }

  return { width, height, data: out }
}

function decodeIndexedRows(
  inflated: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  palette: Uint8Array,
  trns: Uint8Array | null,
): PngRgba | null {
  const bpp = 1
  const rowBytes = Math.ceil((width * bitDepth) / 8)
  const stride = rowBytes + 1
  if (inflated.length < stride * height) return null

  const prev = new Uint8Array(rowBytes)
  const cur = new Uint8Array(rowBytes)
  const out = new Uint8ClampedArray(width * height * 4)
  const paletteColors = Math.floor(palette.length / 3)

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride
    const filter = inflated[rowStart]!
    const raw = inflated.subarray(rowStart + 1, rowStart + 1 + rowBytes)
    for (let i = 0; i < rowBytes; i += 1) {
      const x = raw[i]!
      const a = i >= bpp ? cur[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      let v = x
      if (filter === 1) v = (x + a) & 255
      else if (filter === 2) v = (x + b) & 255
      else if (filter === 3) v = (x + ((a + b) >> 1)) & 255
      else if (filter === 4) v = (x + paeth(a, b, c)) & 255
      cur[i] = v
    }
    prev.set(cur)

    for (let x = 0; x < width; x += 1) {
      const index = unpackIndex(cur, x, bitDepth)
      if (index < 0 || index >= paletteColors) continue
      const pi = index * 3
      const di = (y * width + x) * 4
      out[di] = palette[pi]!
      out[di + 1] = palette[pi + 1]!
      out[di + 2] = palette[pi + 2]!
      out[di + 3] = trns && index < trns.length ? trns[index]! : 255
    }
  }

  return { width, height, data: out }
}

function unpackIndex(row: Uint8Array, x: number, bitDepth: number): number {
  if (bitDepth === 8) return row[x] ?? 0
  const pixelsPerByte = 8 / bitDepth
  const byte = row[Math.floor(x / pixelsPerByte)] ?? 0
  const slot = x % pixelsPerByte
  const shift = 8 - bitDepth * (slot + 1)
  return (byte >> shift) & ((1 << bitDepth) - 1)
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
    >>> 0
  )
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const chunk of chunks) {
    out.set(chunk, o)
    o += chunk.length
  }
  return out
}

async function inflateFormat(
  format: CompressionFormat,
  payload: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new DecompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

/** PNG IDAT is zlib (RFC 1950). WebView2 often rejects `deflate` on that wrapper. */
function zlibToRaw(data: Uint8Array): Uint8Array | null {
  if (data.length < 6) return null
  const cmf = data[0]!
  const flg = data[1]!
  if ((cmf & 0x0f) !== 8) return null
  if (((cmf << 8) + flg) % 31 !== 0) return null
  if (flg & 0x20) return null
  return data.subarray(2, data.length - 4)
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array | null> {
  const copy = data instanceof Uint8Array ? data : new Uint8Array(data)
  try {
    return unzlibSync(copy)
  } catch {
    try {
      return inflateSync(copy)
    } catch {
      // WebView2 DecompressionStream is a last resort; it often fails on zlib.
      if (typeof DecompressionStream === 'undefined') return null
      const zlib = await inflateFormat('deflate', copy)
      if (zlib) return zlib
      const raw = zlibToRaw(copy)
      if (raw) {
        const fromZlib = await inflateFormat('deflate-raw', raw)
        if (fromZlib) return fromZlib
      }
      return inflateFormat('deflate-raw', copy)
    }
  }
}
