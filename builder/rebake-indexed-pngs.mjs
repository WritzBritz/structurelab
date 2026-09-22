/**
 * Rewrite indexed PNG + tRNS (vanilla entity sheets) to 8-bit RGBA PNG.
 * WebView2/WebGL often upload those palette files as gray or empty.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

function walkPngs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkPngs(path, out)
    else if (name.toLowerCase().endsWith('.png')) out.push(path)
  }
  return out
}

function readU32(buf, offset) {
  return buf.readUInt32BE(offset)
}

function crc32(data) {
  let crc = ~0
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]
    for (let b = 0; b < 8; b += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  const crcBuf = Buffer.alloc(4 + data.length)
  crcBuf.write(type, 0, 4, 'ascii')
  data.copy(crcBuf, 4)
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length)
  return out
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function unpackIndex(row, x, bitDepth) {
  if (bitDepth === 8) return row[x] ?? 0
  const perByte = 8 / bitDepth
  const byte = row[Math.floor(x / perByte)] ?? 0
  const slot = x % perByte
  const shift = 8 - bitDepth * (slot + 1)
  return (byte >> shift) & ((1 << bitDepth) - 1)
}

function decodeIndexed(buf) {
  if (buf.length < 26 || buf[0] !== 0x89) return null
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = -1
  let palette = null
  let trns = null
  const idats = []
  while (offset + 8 <= buf.length) {
    const len = readU32(buf, offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (offset + 12 + len > buf.length) break
    const data = buf.subarray(offset + 8, offset + 8 + len)
    offset += 12 + len
    if (type === 'IHDR') {
      width = readU32(data, 0)
      height = readU32(data, 4)
      bitDepth = data[8] ?? 8
      colorType = data[9] ?? -1
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idats.push(data)
    else if (type === 'IEND') break
  }
  if (colorType !== 3 || !palette || width < 1 || height < 1 || idats.length === 0) return null
  if (![1, 2, 4, 8].includes(bitDepth)) return null
  let inflated
  try {
    inflated = inflateSync(Buffer.concat(idats))
  } catch {
    return null
  }
  const rowBytes = Math.ceil((width * bitDepth) / 8)
  const stride = rowBytes + 1
  if (inflated.length < stride * height) return null
  const prev = Buffer.alloc(rowBytes)
  const cur = Buffer.alloc(rowBytes)
  const rgba = Buffer.alloc(width * height * 4)
  const palN = Math.floor(palette.length / 3)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride
    const filter = inflated[rowStart]
    const raw = inflated.subarray(rowStart + 1, rowStart + 1 + rowBytes)
    for (let i = 0; i < rowBytes; i += 1) {
      const x = raw[i]
      const a = i >= 1 ? cur[i - 1] : 0
      const b = prev[i]
      const c = i >= 1 ? prev[i - 1] : 0
      let v = x
      if (filter === 1) v = (x + a) & 255
      else if (filter === 2) v = (x + b) & 255
      else if (filter === 3) v = (x + ((a + b) >> 1)) & 255
      else if (filter === 4) v = (x + paeth(a, b, c)) & 255
      cur[i] = v
    }
    cur.copy(prev)
    for (let x = 0; x < width; x += 1) {
      const index = unpackIndex(cur, x, bitDepth)
      if (index < 0 || index >= palN) continue
      const di = (y * width + x) * 4
      rgba[di] = palette[index * 3]
      rgba[di + 1] = palette[index * 3 + 1]
      rgba[di + 2] = palette[index * 3 + 2]
      rgba[di + 3] = trns && index < trns.length ? trns[index] : 255
    }
  }
  return { width, height, rgba }
}

function encodeRgbaPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1)
    raw[dest] = 0
    rgba.copy(raw, dest + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function rebakeIndexedPngs(dir) {
  if (!dir) return 0
  let count = 0
  for (const path of walkPngs(dir)) {
    const buf = readFileSync(path)
    if (buf.length < 26 || buf[25] !== 3) continue
    const decoded = decodeIndexed(buf)
    if (!decoded) continue
    writeFileSync(path, encodeRgbaPng(decoded.width, decoded.height, decoded.rgba))
    count += 1
  }
  return count
}
