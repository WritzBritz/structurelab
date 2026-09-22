/// <reference lib="webworker" />

/**
 * Parses OBJ (+ optional MTL / map_Kd textures) off the main thread for a solid preview mesh.
 * Emits one group per material so multi-texture characters keep sharp GPU maps
 * (body + eyes + hair) instead of blotchy per-vertex colour fallbacks.
 */

import { decodePngIndexedRgba, pngColorType } from './decodePngRgba'
import { decodeExportText, foldExportName } from './exportText'

export type PreviewRequest = {
  id: number
  objBytes: ArrayBuffer
  mtlBytes?: ArrayBuffer | null
  /** Lowercased texture basename → image bytes (decoded in worker if needed). */
  textures?: Record<string, ArrayBuffer>
  /** Pre-decoded RGBA (preferred — avoids OffscreenCanvas issues). */
  decodedTextures?: Record<string, { width: number; height: number; data: ArrayBuffer }>
  /** Catalog entity OBJs are clean quads — outlier stripping amputates limbs. */
  skipOutlierFilter?: boolean
}

export type PreviewGroup = {
  objectName: string
  positions: Float32Array
  /** OBJ vertex index for each expanded face vertex. */
  sourceVertexIndices: Int32Array
  colors: Float32Array
  uvs: Float32Array
  mapKd: string | null
  triangleCount: number
}

export type PreviewResponse = {
  id: number
  ok: true
  groups: PreviewGroup[]
  /** @deprecated Prefer groups[0]; kept for older callers. */
  positions: Float32Array
  colors: Float32Array
  uvs: Float32Array
  mapKd: string | null
  triangleCount: number
  filteredOut: number
} | {
  id: number
  ok: false
  error: string
}

type ProgressMessage = {
  id: number
  type: 'progress'
  ratio: number
  label: string
}

type RgbaImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

type MaterialInfo = {
  kd: [number, number, number]
  mapKd: string | null
}

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<PreviewRequest>) => {
  void handleMessage(event.data)
}

async function handleMessage(request: PreviewRequest) {
  const { id, objBytes, mtlBytes, textures, decodedTextures, skipOutlierFilter } = request
  try {
    postProgress(id, 0.05, 'Decoding OBJ…')
    const objText = decodeExportText(new Uint8Array(objBytes))
    const materials = mtlBytes
      ? parseMtl(decodeExportText(new Uint8Array(mtlBytes)))
      : new Map<string, MaterialInfo>()

    postProgress(id, 0.12, 'Loading textures…')
    const images = new Map<string, RgbaImage>()
    if (decodedTextures) {
      for (const [name, entry] of Object.entries(decodedTextures)) {
        images.set(foldExportName(name), {
          width: entry.width,
          height: entry.height,
          data: new Uint8ClampedArray(entry.data),
        })
      }
    }
    if (images.size === 0) {
      const loaded = await loadTextures(textures ?? {})
      for (const [name, image] of loaded) images.set(name, image)
    }

    postProgress(id, 0.2, 'Parsing geometry…')
    const parsed = parseObj(objText, materials, images, (ratio) => {
      postProgress(id, 0.2 + ratio * 0.55, 'Parsing geometry…')
    })

    postProgress(id, 0.78, 'Cleaning studio props…')
    const cleaned = skipOutlierFilter
      ? parsed.groups
      : parsed.groups.map((g) => filterOutliers(g))
    const filteredOut =
      parsed.groups.reduce((n, g) => n + g.triangleCount, 0)
      - cleaned.reduce((n, g) => n + g.triangleCount, 0)
    const groups = cleaned.filter((g) => g.triangleCount > 0)
    const primary = groups[0] ?? {
      positions: new Float32Array(),
      sourceVertexIndices: new Int32Array(),
      colors: new Float32Array(),
      uvs: new Float32Array(),
      mapKd: null,
      triangleCount: 0,
    }

    postProgress(id, 1, 'Preparing meshes…')
    const transfer: Transferable[] = []
    for (const g of groups) {
      transfer.push(g.positions.buffer, g.sourceVertexIndices.buffer, g.colors.buffer, g.uvs.buffer)
    }
    const response: PreviewResponse = {
      id,
      ok: true,
      groups,
      positions: primary.positions,
      colors: primary.colors,
      uvs: primary.uvs,
      mapKd: groups.length === 1 ? primary.mapKd : null,
      triangleCount: groups.reduce((n, g) => n + g.triangleCount, 0),
      filteredOut,
    }
    ctx.postMessage(response, transfer)
  } catch (error) {
    const response: PreviewResponse = {
      id,
      ok: false,
      error: String(error),
    }
    ctx.postMessage(response)
  }
}

function postProgress(id: number, ratio: number, label: string) {
  const message: ProgressMessage = { id, type: 'progress', ratio, label }
  ctx.postMessage(message)
}

function parseMtl(text: string): Map<string, MaterialInfo> {
  const materials = new Map<string, MaterialInfo>()
  let current = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.toLowerCase().startsWith('newmtl ')) {
      current = textureKey(line.slice(7).trim())
      materials.set(current, { kd: [0.72, 0.74, 0.78], mapKd: null })
    } else if (line.toLowerCase().startsWith('kd ') && current) {
      const parts = line.split(/\s+/)
      const mat = materials.get(current)
      if (mat && parts.length >= 4) {
        mat.kd = [clamp01(Number(parts[1])), clamp01(Number(parts[2])), clamp01(Number(parts[3]))]
      }
    } else if (line.toLowerCase().startsWith('map_kd ') && current) {
      const mat = materials.get(current)
      if (mat) mat.mapKd = textureKey(line.slice(7).trim())
    }
  }
  return materials
}

function textureKey(path: string): string {
  const norm = path.replaceAll('\\', '/')
  const base = norm.slice(Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\')) + 1)
  return foldExportName(base)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

async function loadTextures(
  textures: Record<string, ArrayBuffer>,
): Promise<Map<string, RgbaImage>> {
  const images = new Map<string, RgbaImage>()
  for (const [name, buffer] of Object.entries(textures)) {
    const image = await decodePng(buffer)
    if (image) images.set(foldExportName(name), image)
  }
  return images
}

async function decodePng(buffer: ArrayBuffer): Promise<RgbaImage | null> {
  const bytes = new Uint8Array(buffer)
  if (pngColorType(bytes) === 3) {
    return decodePngIndexedRgba(bytes)
  }
  try {
    const bitmap = await createImageBitmap(new Blob([buffer]))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx2d) {
      bitmap.close()
      return null
    }
    ctx2d.imageSmoothingEnabled = false
    ctx2d.drawImage(bitmap, 0, 0)
    const image = ctx2d.getImageData(0, 0, canvas.width, canvas.height)
    bitmap.close()
    return { width: image.width, height: image.height, data: image.data }
  } catch {
    return null
  }
}

/** Clamp-to-edge sampling so u/v == 1 hits the last texel, not wraps to 0. */
function sampleTexture(
  image: RgbaImage,
  u: number,
  v: number,
  honorAlpha: boolean,
): [number, number, number] | null {
  const uu = Math.min(1, Math.max(0, u))
  const vv = 1 - Math.min(1, Math.max(0, v))
  const maxX = Math.max(0, image.width - 1)
  const maxY = Math.max(0, image.height - 1)
  const x = Math.min(maxX, Math.max(0, Math.floor(uu * image.width)))
  const y = Math.min(maxY, Math.max(0, Math.floor(vv * image.height)))
  const tryAt = (sx: number, sy: number): [number, number, number] | null => {
    const cx = Math.min(maxX, Math.max(0, sx))
    const cy = Math.min(maxY, Math.max(0, sy))
    const i = (cy * image.width + cx) * 4
    if (honorAlpha && image.data[i + 3]! < 20) return null
    return [image.data[i]! / 255, image.data[i + 1]! / 255, image.data[i + 2]! / 255]
  }
  const direct = tryAt(x, y)
  if (direct) return direct
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const again = tryAt(x + dx!, y + dy!)
    if (again) return again
  }
  return null
}

/** True when the alpha channel is a real cutout (Minecraft skins), not empty Maya/TGA alpha. */
function imageHonorsAlpha(image: RgbaImage): boolean {
  const stepX = Math.max(1, Math.floor(image.width / 64))
  const stepY = Math.max(1, Math.floor(image.height / 64))
  let opaque = 0
  let samples = 0
  for (let y = 0; y < image.height; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      samples += 1
      if (image.data[(y * image.width + x) * 4 + 3]! >= 20) opaque += 1
    }
  }
  return samples > 0 && opaque / samples >= 0.02
}

type GroupAcc = {
  objectName: string
  pos: number[]
  col: number[]
  uv: number[]
  source: number[]
  mapKd: string | null
  triangles: number
  hasUv: boolean
}

function parseObj(
  text: string,
  materials: Map<string, MaterialInfo>,
  images: Map<string, RgbaImage>,
  onProgress: (ratio: number) => void,
): { groups: PreviewGroup[] } {
  const lines = text.split(/\r?\n/)
  const verts: number[] = []
  const vertColors: ([number, number, number] | null)[] = []
  const texcoords: number[] = []
  let currentMat: MaterialInfo = { kd: [0.72, 0.74, 0.78], mapKd: null }
  let currentObject = 'default'
  const total = Math.max(lines.length, 1)

  const groups = new Map<string, GroupAcc>()
  const groupKey = (objectName: string, mat: MaterialInfo) =>
    `${objectName}\0${mat.mapKd ?? `__kd_${mat.kd.join(',')}`}`
  const honorAlphaByImage = new Map<RgbaImage, boolean>()
  for (const image of images.values()) {
    if (!honorAlphaByImage.has(image)) honorAlphaByImage.set(image, imageHonorsAlpha(image))
  }

  const ensureGroup = (objectName: string, mat: MaterialInfo): GroupAcc => {
    const key = groupKey(objectName, mat)
    let g = groups.get(key)
    if (!g) {
      g = {
        objectName,
        pos: [],
        col: [],
        uv: [],
        source: [],
        // Only bind an atlas when this material actually references one.
        // Never fall back to "the only texture in the scene" — that paints
        // solid-colour props (hats, hair) with a body map.
        mapKd: mat.mapKd,
        triangles: 0,
        hasUv: false,
      }
      groups.set(key, g)
    }
    return g
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (i % 4000 === 0) onProgress(i / total)
    const line = lines[i]!.trim()
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/)
      verts.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
      if (parts.length >= 7) {
        vertColors.push([
          clamp01(Number(parts[4])),
          clamp01(Number(parts[5])),
          clamp01(Number(parts[6])),
        ])
      } else {
        vertColors.push(null)
      }
    } else if (line.startsWith('vt ')) {
      const parts = line.split(/\s+/)
      texcoords.push(Number(parts[1]) || 0, Number(parts[2]) || 0)
    } else if (line.startsWith('o ') || line.startsWith('g ')) {
      currentObject = line.slice(2).trim() || 'default'
    } else if (line.toLowerCase().startsWith('usemtl ')) {
      const name = textureKey(line.slice(7).trim())
      currentMat = materials.get(name) ?? { kd: [0.72, 0.74, 0.78], mapKd: null }
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1)
      const idxs = parts.map((part) => {
        const bits = part.split('/')
        const vi = Number(bits[0])
        const ti = bits[1] ? Number(bits[1]) : 0
        const vertex = vi > 0 ? vi - 1 : verts.length / 3 + vi
        const tex = ti > 0 ? ti - 1 : ti < 0 ? texcoords.length / 2 + ti : -1
        return { vertex, tex }
      }).filter((entry) => Number.isFinite(entry.vertex) && entry.vertex >= 0)

      const image = currentMat.mapKd ? images.get(currentMat.mapKd) : null
      const honorAlpha = image ? (honorAlphaByImage.get(image) ?? true) : true
      const g = ensureGroup(currentObject, currentMat)

      for (let t = 1; t + 1 < idxs.length; t += 1) {
        pushVertex(g.pos, g.col, g.uv, g.source, verts, vertColors, texcoords, idxs[0]!, currentMat.kd, image, honorAlpha)
        pushVertex(g.pos, g.col, g.uv, g.source, verts, vertColors, texcoords, idxs[t]!, currentMat.kd, image, honorAlpha)
        pushVertex(g.pos, g.col, g.uv, g.source, verts, vertColors, texcoords, idxs[t + 1]!, currentMat.kd, image, honorAlpha)
        if (idxs[0]!.tex >= 0 || idxs[t]!.tex >= 0 || idxs[t + 1]!.tex >= 0) g.hasUv = true
        g.triangles += 1
      }
    }
  }

  const out: PreviewGroup[] = []
  for (const g of groups.values()) {
    if (g.triangles < 1) continue
    out.push({
      objectName: g.objectName,
      positions: new Float32Array(g.pos),
      sourceVertexIndices: new Int32Array(g.source),
      colors: new Float32Array(g.col),
      uvs: new Float32Array(g.hasUv ? g.uv : []),
      mapKd: g.mapKd,
      triangleCount: g.triangles,
    })
  }
  return { groups: out }
}

function pushVertex(
  posOut: number[],
  colOut: number[],
  uvOut: number[],
  sourceOut: number[],
  verts: number[],
  vertColors: ([number, number, number] | null)[],
  texcoords: number[],
  index: { vertex: number; tex: number },
  materialColor: [number, number, number],
  image: RgbaImage | null | undefined,
  honorAlpha: boolean,
) {
  sourceOut.push(index.vertex)
  const base = index.vertex * 3
  posOut.push(verts[base] ?? 0, verts[base + 1] ?? 0, verts[base + 2] ?? 0)

  let u = 0
  let v = 0
  if (index.tex >= 0) {
    const t = index.tex * 2
    if (t + 1 < texcoords.length) {
      u = texcoords[t]!
      v = texcoords[t + 1]!
    }
  }
  uvOut.push(u, v)

  let color = vertColors[index.vertex] ?? materialColor
  if (image && index.tex >= 0) {
    const sampled = sampleTexture(image, u, v, honorAlpha)
    if (sampled) color = sampled
  }
  colOut.push(color[0], color[1], color[2])
}

function filterOutliers(mesh: PreviewGroup): PreviewGroup {
  const { objectName, positions, sourceVertexIndices, colors, uvs, mapKd, triangleCount } = mesh
  if (triangleCount < 32) return mesh
  const hasUv = uvs.length >= triangleCount * 6

  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  for (let t = 0; t < triangleCount; t += 1) {
    const i = t * 9
    xs.push(positions[i]!, positions[i + 3]!, positions[i + 6]!)
    ys.push(positions[i + 1]!, positions[i + 4]!, positions[i + 7]!)
    zs.push(positions[i + 2]!, positions[i + 5]!, positions[i + 8]!)
  }
  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  zs.sort((a, b) => a - b)
  const [x0, x1] = expandConnectedAxis(xs)
  const [y0, y1] = expandConnectedAxis(ys)
  const [z0, z1] = expandConnectedAxis(zs)
  const size = [x1 - x0, y1 - y0, z1 - z0]
  const aabbDiag = Math.sqrt(size[0]! * size[0]! + size[1]! * size[1]! + size[2]! * size[2]!) || 1e-3
  const pad = [size[0]! * 0.02, size[1]! * 0.02, size[2]! * 0.02]
  const clipMin = [x0 - pad[0]!, y0 - pad[1]!, z0 - pad[2]!]
  const clipMax = [x1 + pad[0]!, y1 + pad[1]!, z1 + pad[2]!]

  const dist = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const dx = ax - bx
    const dy = ay - by
    const dz = az - bz
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  const inBox = (x: number, y: number, z: number, lo: number[], hi: number[]) =>
    x >= lo[0]! && x <= hi[0]! && y >= lo[1]! && y <= hi[1]! && z >= lo[2]! && z <= hi[2]!

  const posOut: number[] = []
  const colOut: number[] = []
  const uvOut: number[] = []
  const sourceOut: number[] = []
  let kept = 0
  for (let t = 0; t < triangleCount; t += 1) {
    const i = t * 9
    const ax = positions[i]!
    const ay = positions[i + 1]!
    const az = positions[i + 2]!
    const bx = positions[i + 3]!
    const by = positions[i + 4]!
    const bz = positions[i + 5]!
    const cx = positions[i + 6]!
    const cy = positions[i + 7]!
    const cz = positions[i + 8]!
    const inside =
      Number(inBox(ax, ay, az, clipMin, clipMax))
      + Number(inBox(bx, by, bz, clipMin, clipMax))
      + Number(inBox(cx, cy, cz, clipMin, clipMax))
    if (inside === 0) continue
    if (inside < 3) {
      const longest = Math.max(
        dist(ax, ay, az, bx, by, bz),
        dist(bx, by, bz, cx, cy, cz),
        dist(cx, cy, cz, ax, ay, az),
      )
      if (longest > aabbDiag * 1.05) continue
    }
    for (let k = 0; k < 9; k += 1) posOut.push(positions[i + k]!)
    for (let k = 0; k < 9; k += 1) colOut.push(colors[i + k]!)
    const source = t * 3
    for (let k = 0; k < 3; k += 1) sourceOut.push(sourceVertexIndices[source + k]!)
    if (hasUv) {
      const u = t * 6
      for (let k = 0; k < 6; k += 1) uvOut.push(uvs[u + k]!)
    }
    kept += 1
  }

  if (kept < 8) return mesh
  return {
    objectName,
    positions: new Float32Array(posOut),
    sourceVertexIndices: new Int32Array(sourceOut),
    colors: new Float32Array(colOut),
    uvs: new Float32Array(uvOut),
    mapKd,
    triangleCount: kept,
  }
}

function expandConnectedAxis(sorted: number[]): [number, number] {
  const n = sorted.length
  if (n === 0) return [0, 1]
  if (n < 32) return [sorted[0]!, sorted[n - 1]!]
  const loI = Math.round((n - 1) * 0.1)
  const hiI = Math.max(loI, Math.round((n - 1) * 0.9))
  const coreSpan = Math.max(sorted[hiI]! - sorted[loI]!, 1e-5)
  const maxGap = coreSpan * 3
  let left = loI
  while (left > 0 && sorted[left]! - sorted[left - 1]! <= maxGap) left -= 1
  let right = hiI
  while (right + 1 < n && sorted[right + 1]! - sorted[right]! <= maxGap) right += 1
  return [sorted[left]!, sorted[right]!]
}
