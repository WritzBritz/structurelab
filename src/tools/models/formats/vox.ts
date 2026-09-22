/**
 * MagicaVoxel `.vox` → Wavefront OBJ (unit cubes, vertex colours).
 *
 * Format refs:
 * - https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 * - https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox-extension.txt
 * Chunk layout + scene graph handling follows three.js VOXLoader.
 */

import { ObjTextWriter } from '../objStream'
import type { ModelFormat } from './types'

export const voxFormat: ModelFormat = {
  id: 'vox',
  label: 'MagicaVoxel',
  role: 'primary',
  extensions: ['vox'],
  priority: 100,
  matches: (fileName) => /\.vox$/i.test(fileName),
}

export function isVoxFileName(name: string): boolean {
  return voxFormat.matches(name)
}

export type VoxImportResult = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  voxelCount: number
  modelCount: number
  /** Suggested scene size (Y-up), matching voxel extents. */
  size: { width: number; height: number; length: number }
  sourceLabel: string
  warnings: string[]
}

type Rgba = { r: number; g: number; b: number; a: number }

type VoxModel = {
  sizeX: number
  sizeY: number
  sizeZ: number
  /** Packed (x,y,z,colorIndex) × N */
  voxels: Uint8Array
}

type Vec3 = [number, number, number]
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]]

type FrameXform = {
  rotation: Mat3 | null
  translation: Vec3 | null
}

type SceneNode =
  | {
      type: 'transform'
      childId: number
      frames: FrameXform[]
      name: string | null
    }
  | { type: 'group'; childIds: number[]; name: string | null }
  | { type: 'shape'; modelIds: number[]; name: string | null }

/** Default palette as MagicaVoxel stores it: little-endian 0xAABBGGRR uint32s. */
const DEFAULT_PALETTE_ABGR = new Uint32Array([
  0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff,
  0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
  0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
  0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
  0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc,
  0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
  0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc,
  0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
  0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
  0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
  0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999,
  0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
  0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099,
  0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
  0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
  0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
  0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366,
  0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
  0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33,
  0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
  0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
  0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
  0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00,
  0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
  0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900, 0xffff6600,
  0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300, 0xffcc3300, 0xff993300,
  0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000,
  0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055, 0xff000044,
  0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700,
  0xff005500, 0xff004400, 0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
  0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd,
  0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111,
])

function abgrToRgba(abgr: number): Rgba {
  // MagicaVoxel / three.js: low byte = R, then G, B, A
  return {
    r: (abgr & 0xff) / 255,
    g: ((abgr >>> 8) & 0xff) / 255,
    b: ((abgr >>> 16) & 0xff) / 255,
    a: ((abgr >>> 24) & 0xff) / 255,
  }
}

function defaultPalette(): Rgba[] {
  const palette: Rgba[] = new Array(256)
  for (let i = 0; i < 256; i += 1) palette[i] = abgrToRgba(DEFAULT_PALETTE_ABGR[i]!)
  return palette
}

function identity3(): Mat3 {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
}

/** Decode MagicaVoxel packed rotation byte → row-major 3×3 (VOX space). */
function decodeRotation(byte: number): Mat3 {
  const index1 = byte & 0x3
  const index2 = (byte >> 2) & 0x3
  const sign1 = (byte >> 4) & 0x1 ? -1 : 1
  const sign2 = (byte >> 5) & 0x1 ? -1 : 1
  const sign3 = (byte >> 6) & 0x1 ? -1 : 1
  const index3 = 3 - index1 - index2
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  r[0]![index1]! = sign1
  r[1]![index2]! = sign2
  r[2]![index3]! = sign3
  return r
}

function mulMatVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ]
}

function mulMat(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r]![c] = a[r]![0]! * b[0]![c]! + a[r]![1]! * b[1]![c]! + a[r]![2]! * b[2]![c]!
    }
  }
  return out
}

/** VOX (Z-up) → OBJ/Three (Y-up): (x,y,z) → (x, z, -y) */
function voxToObj(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]]
}

function readString(view: DataView, offset: number): { value: string; size: number } {
  const size = view.getUint32(offset, true)
  let str = ''
  for (let i = 0; i < size; i += 1) {
    str += String.fromCharCode(view.getUint8(offset + 4 + i))
  }
  return { value: str, size: 4 + size }
}

function readDict(view: DataView, offset: number): { value: Record<string, string>; size: number } {
  const count = view.getUint32(offset, true)
  let o = offset + 4
  let total = 4
  const dict: Record<string, string> = {}
  for (let i = 0; i < count; i += 1) {
    const key = readString(view, o)
    o += key.size
    total += key.size
    const value = readString(view, o)
    o += value.size
    total += value.size
    dict[key.value] = value.value
  }
  return { value: dict, size: total }
}

/**
 * Flat RIFF walk (as in three.js VOXLoader). Ignores nesting; childrenSize is skipped.
 */
export function parseVox(bytes: Uint8Array): {
  models: VoxModel[]
  palette: Rgba[]
  nodes: Record<number, SceneNode>
  warnings: string[]
} {
  const warnings: string[] = []
  if (bytes.length < 8) throw new Error('Not a MagicaVoxel .vox file (too short)')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  // 'VOX ' little-endian
  if (magic !== 0x20584f56) {
    throw new Error('Not a MagicaVoxel .vox file (missing VOX header)')
  }
  const version = view.getUint32(4, true)
  if (version !== 150 && version !== 200) {
    warnings.push(`Unusual .vox version ${version} (expected 150 or 200)`)
  }

  let palette = defaultPalette()
  const models: VoxModel[] = []
  let pendingSize: { x: number; y: number; z: number } | null = null
  const nodes: Record<number, SceneNode> = {}

  let i = 8
  while (i + 12 <= bytes.length) {
    const id =
      String.fromCharCode(bytes[i]!)
      + String.fromCharCode(bytes[i + 1]!)
      + String.fromCharCode(bytes[i + 2]!)
      + String.fromCharCode(bytes[i + 3]!)
    i += 4
    const chunkSize = view.getUint32(i, true)
    i += 4
    i += 4 // childrenSize — flat walk ignores hierarchy
    const contentStart = i

    if (id === 'SIZE' && chunkSize >= 12) {
      pendingSize = {
        x: view.getInt32(i, true),
        y: view.getInt32(i + 4, true),
        z: view.getInt32(i + 8, true),
      }
      i += chunkSize
    } else if (id === 'XYZI' && chunkSize >= 4) {
      const numVoxels = view.getUint32(i, true)
      const need = 4 + numVoxels * 4
      const size = pendingSize ?? { x: 1, y: 1, z: 1 }
      pendingSize = null
      if (chunkSize < need) {
        warnings.push('Truncated XYZI chunk — skipped a model')
        i = contentStart + chunkSize
      } else {
        models.push({
          sizeX: Math.max(1, size.x),
          sizeY: Math.max(1, size.y),
          sizeZ: Math.max(1, size.z),
          voxels: bytes.slice(i + 4, i + need),
        })
        i = contentStart + chunkSize
      }
    } else if (id === 'RGBA' && chunkSize >= 1024) {
      // File colours [0..254] → palette indices [1..255] (spec). Also store [255]→[256%256].
      for (let j = 0; j < 256; j += 1) {
        const abgr = view.getUint32(i + j * 4, true)
        palette[(j + 1) & 0xff] = abgrToRgba(abgr)
      }
      // Index 0 stays unused / empty
      palette[0] = { r: 0, g: 0, b: 0, a: 0 }
      i = contentStart + chunkSize
    } else if (id === 'nTRN') {
      let o = i
      const nodeId = view.getUint32(o, true)
      o += 4
      const attributes = readDict(view, o)
      o += attributes.size
      const childId = view.getUint32(o, true)
      o += 4
      o += 4 // reserved
      o += 4 // layer id
      const numFrames = view.getUint32(o, true)
      o += 4
      const frames: FrameXform[] = []
      for (let f = 0; f < numFrames; f += 1) {
        const frameDict = readDict(view, o)
        o += frameDict.size
        let rotation: Mat3 | null = null
        let translation: Vec3 | null = null
        if (frameDict.value._r !== undefined) {
          rotation = decodeRotation(Number.parseInt(frameDict.value._r, 10))
        }
        if (frameDict.value._t !== undefined) {
          const parts = frameDict.value._t.split(/\s+/).map(Number)
          translation = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
        }
        frames.push({ rotation, translation })
      }
      nodes[nodeId] = {
        type: 'transform',
        childId,
        frames,
        name: attributes.value._name ?? null,
      }
      i = contentStart + chunkSize
    } else if (id === 'nGRP') {
      let o = i
      const nodeId = view.getUint32(o, true)
      o += 4
      const attributes = readDict(view, o)
      o += attributes.size
      const numChildren = view.getUint32(o, true)
      o += 4
      const childIds: number[] = []
      for (let c = 0; c < numChildren; c += 1) {
        childIds.push(view.getUint32(o, true))
        o += 4
      }
      nodes[nodeId] = {
        type: 'group',
        childIds,
        name: attributes.value._name ?? null,
      }
      i = contentStart + chunkSize
    } else if (id === 'nSHP') {
      let o = i
      const nodeId = view.getUint32(o, true)
      o += 4
      const attributes = readDict(view, o)
      o += attributes.size
      const numModels = view.getUint32(o, true)
      o += 4
      const modelIds: number[] = []
      for (let m = 0; m < numModels; m += 1) {
        modelIds.push(view.getUint32(o, true))
        o += 4
        const modelAttr = readDict(view, o)
        o += modelAttr.size
      }
      nodes[nodeId] = {
        type: 'shape',
        modelIds,
        name: attributes.value._name ?? null,
      }
      i = contentStart + chunkSize
    } else {
      i = contentStart + chunkSize
    }
  }

  if (models.length === 0) {
    throw new Error('No voxel models found in .vox (missing SIZE/XYZI chunks)')
  }

  return { models, palette, nodes, warnings }
}

function fmt(n: number): string {
  const r = Math.round(n * 10000) / 10000
  return Number.isInteger(r) ? String(r) : r.toFixed(4)
}

/** Full solid unit cube — used for convert so interiors stay filled. */
async function emitSolidCube(
  writer: ObjTextWriter,
  x0: number,
  y0: number,
  z0: number,
  r: number,
  g: number,
  b: number,
  vBase: number,
): Promise<number> {
  const x1 = x0 + 1
  const y1 = y0 + 1
  const z1 = z0 + 1
  const corners: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
  for (const [x, y, z] of corners) {
    writer.line(`v ${fmt(x)} ${fmt(y)} ${fmt(z)} ${fmt(r)} ${fmt(g)} ${fmt(b)}`)
  }
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ]
  for (const face of faces) {
    const a = vBase + face[0]!
    const b = vBase + face[1]!
    const c = vBase + face[2]!
    const d = vBase + face[3]!
    writer.line(`f ${a} ${b} ${c}`)
    writer.line(`f ${a} ${c} ${d}`)
  }
  await writer.flushIfNeeded()
  return vBase + 8
}

function buildModelOccupancy(model: VoxModel, palette: Rgba[]): Set<string> {
  const occ = new Set<string>()
  const num = model.voxels.length / 4
  for (let n = 0; n < num; n += 1) {
    const o = n * 4
    const ci = model.voxels[o + 3]!
    if (ci === 0) continue
    const color = palette[ci] ?? palette[1]!
    if (color.a < 0.01) continue
    occ.add(`${model.voxels[o]!},${model.voxels[o + 1]!},${model.voxels[o + 2]!}`)
  }
  return occ
}

function hasVoxel(occ: Set<string>, x: number, y: number, z: number): boolean {
  return occ.has(`${x},${y},${z}`)
}

type Instance = {
  modelId: number
  rotation: Mat3
  translation: Vec3
}

function collectInstances(
  nodeId: number,
  nodes: Record<number, SceneNode>,
  parentRot: Mat3,
  parentTrans: Vec3,
  out: Instance[],
) {
  const node = nodes[nodeId]
  if (!node) return

  if (node.type === 'transform') {
    const frame = node.frames[0]
    const localRot = frame?.rotation ?? identity3()
    const localTrans = frame?.translation ?? ([0, 0, 0] as Vec3)
    const rot = mulMat(parentRot, localRot)
    const translated = mulMatVec(parentRot, localTrans)
    const trans: Vec3 = [
      parentTrans[0] + translated[0],
      parentTrans[1] + translated[1],
      parentTrans[2] + translated[2],
    ]
    collectInstances(node.childId, nodes, rot, trans, out)
    return
  }

  if (node.type === 'group') {
    for (const childId of node.childIds) {
      collectInstances(childId, nodes, parentRot, parentTrans, out)
    }
    return
  }

  for (const modelId of node.modelIds) {
    out.push({
      modelId,
      rotation: parentRot,
      translation: parentTrans,
    })
  }
}

/**
 * Convert MagicaVoxel bytes into an OBJ of unit cubes for preview + voxelize.
 */
export async function importVox(
  bytes: Uint8Array,
  onProgress?: (ratio: number, label: string) => void,
): Promise<VoxImportResult> {
  onProgress?.(0.02, 'Reading MagicaVoxel…')
  const { models, palette, nodes, warnings } = parseVox(bytes)
  onProgress?.(0.08, 'Building scene…')

  const instances: Instance[] = []
  if (nodes[0]) {
    collectInstances(0, nodes, identity3(), [0, 0, 0], instances)
  }
  if (instances.length === 0) {
    // No scene graph (classic single-model files): one instance per model, side by side.
    let cursor = 0
    for (let m = 0; m < models.length; m += 1) {
      instances.push({
        modelId: m,
        rotation: identity3(),
        translation: [cursor, 0, 0],
      })
      cursor += models[m]!.sizeX + 2
    }
  }

  let plannedVoxels = 0
  for (const inst of instances) {
    const model = models[inst.modelId]
    if (model) plannedVoxels += model.voxels.length / 4
  }
  plannedVoxels = Math.max(plannedVoxels, 1)

  const writer = new ObjTextWriter()
  writer.line('# Generated from MagicaVoxel .vox')
  writer.line('mtllib model.mtl')
  writer.line('usemtl vox')
  writer.line('')

  let vBase = 1
  let voxelCount = 0
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  /** Place a solid unit cube whose centre is `world` in MagicaVoxel (Z-up) space. */
  const emitAtVoxCenter = async (world: Vec3, ci: number) => {
    if (ci === 0) return
    const color = palette[ci] ?? palette[1]!
    if (color.a < 0.01) return
    const [ox, oy, oz] = voxToObj(world)
    const x0 = ox - 0.5
    const y0 = oy - 0.5
    const z0 = oz - 0.5
    vBase = await emitSolidCube(writer, x0, y0, z0, color.r, color.g, color.b, vBase)
    voxelCount += 1
    if (x0 < minX) minX = x0
    if (y0 < minY) minY = y0
    if (z0 < minZ) minZ = z0
    if (x0 + 1 > maxX) maxX = x0 + 1
    if (y0 + 1 > maxY) maxY = y0 + 1
    if (z0 + 1 > maxZ) maxZ = z0 + 1
  }

  for (const inst of instances) {
    const model = models[inst.modelId]
    if (!model) {
      warnings.push(`Scene references missing model id ${inst.modelId}`)
      continue
    }
    const hx = model.sizeX / 2
    const hy = model.sizeY / 2
    const hz = model.sizeZ / 2
    const num = model.voxels.length / 4
    for (let n = 0; n < num; n += 1) {
      const o = n * 4
      const vx = model.voxels[o]!
      const vy = model.voxels[o + 1]!
      const vz = model.voxels[o + 2]!
      const ci = model.voxels[o + 3]!
      const local: Vec3 = [vx + 0.5 - hx, vy + 0.5 - hy, vz + 0.5 - hz]
      const rotated = mulMatVec(inst.rotation, local)
      const world: Vec3 = [
        rotated[0] + inst.translation[0],
        rotated[1] + inst.translation[1],
        rotated[2] + inst.translation[2],
      ]
      await emitAtVoxCenter(world, ci)
      if (onProgress && voxelCount % 4096 === 0) {
        onProgress(
          Math.min(0.98, 0.1 + (voxelCount / plannedVoxels) * 0.85),
          `Building mesh… ${voxelCount.toLocaleString()} voxels`,
        )
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 0)
        })
      }
    }
  }

  if (voxelCount === 0) {
    throw new Error('No solid voxels found in .vox')
  }

  onProgress?.(0.97, 'Writing OBJ…')

  const objBytes = await writer.finish()
  // Mid-grey Kd fallback only — colours come from per-vertex RGB on the OBJ.
  const mtlBytes = new TextEncoder().encode(
    '# Generated from MagicaVoxel .vox\nnewmtl vox\nKd 0.72 0.74 0.78\nd 1.0\n',
  )

  const width = Math.min(256, Math.max(1, Math.ceil(maxX - minX)))
  const height = Math.min(256, Math.max(1, Math.ceil(maxY - minY)))
  const length = Math.min(256, Math.max(1, Math.ceil(maxZ - minZ)))

  return {
    objBytes,
    mtlBytes,
    voxelCount,
    modelCount: models.length,
    size: { width, height, length },
    sourceLabel: `MagicaVoxel · ${voxelCount.toLocaleString()} voxels · ${models.length} model${models.length === 1 ? '' : 's'}`,
    warnings,
  }
}

export type VoxPreviewMesh = {
  positions: Float32Array
  colors: Float32Array
  triangleCount: number
  voxelCount: number
}

/**
 * Preview mesh: only faces next to empty space (union surface).
 * No overlapping neighbour faces → no colour Z-fighting, no hollow gaps from open cubes.
 */
export function buildVoxPreviewMesh(bytes: Uint8Array): VoxPreviewMesh {
  const { models, palette, nodes } = parseVox(bytes)
  const instances: Instance[] = []
  if (nodes[0]) {
    collectInstances(0, nodes, identity3(), [0, 0, 0], instances)
  }
  if (instances.length === 0) {
    let cursor = 0
    for (let m = 0; m < models.length; m += 1) {
      instances.push({
        modelId: m,
        rotation: identity3(),
        translation: [cursor, 0, 0],
      })
      cursor += models[m]!.sizeX + 2
    }
  }

  const positions: number[] = []
  const colors: number[] = []
  let voxelCount = 0

  const pushTri = (
    a: Vec3,
    b: Vec3,
    c: Vec3,
    r: number,
    g: number,
    bl: number,
  ) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    colors.push(r, g, bl, r, g, bl, r, g, bl)
  }

  const pushQuad = (
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    r: number,
    g: number,
    bl: number,
  ) => {
    pushTri(a, b, c, r, g, bl)
    pushTri(a, c, d, r, g, bl)
  }

  for (const inst of instances) {
    const model = models[inst.modelId]
    if (!model) continue
    const occ = buildModelOccupancy(model, palette)
    const hx = model.sizeX / 2
    const hy = model.sizeY / 2
    const hz = model.sizeZ / 2

    const toObj = (px: number, py: number, pz: number): Vec3 => {
      const local: Vec3 = [px - hx, py - hy, pz - hz]
      const rotated = mulMatVec(inst.rotation, local)
      return voxToObj([
        rotated[0] + inst.translation[0],
        rotated[1] + inst.translation[1],
        rotated[2] + inst.translation[2],
      ])
    }

    const num = model.voxels.length / 4
    for (let n = 0; n < num; n += 1) {
      const o = n * 4
      const vx = model.voxels[o]!
      const vy = model.voxels[o + 1]!
      const vz = model.voxels[o + 2]!
      const ci = model.voxels[o + 3]!
      if (ci === 0) continue
      const color = palette[ci] ?? palette[1]!
      if (color.a < 0.01) continue
      voxelCount += 1
      const { r, g, b } = color
      const x0 = vx
      const y0 = vy
      const z0 = vz
      const x1 = vx + 1
      const y1 = vy + 1
      const z1 = vz + 1

      // Faces in MagicaVoxel space, then transformed to OBJ. Only emit when the
      // neighbour cell is empty so shared walls never double-draw.
      if (!hasVoxel(occ, vx - 1, vy, vz)) {
        pushQuad(
          toObj(x0, y0, z0),
          toObj(x0, y0, z1),
          toObj(x0, y1, z1),
          toObj(x0, y1, z0),
          r,
          g,
          b,
        )
      }
      if (!hasVoxel(occ, vx + 1, vy, vz)) {
        pushQuad(
          toObj(x1, y0, z0),
          toObj(x1, y1, z0),
          toObj(x1, y1, z1),
          toObj(x1, y0, z1),
          r,
          g,
          b,
        )
      }
      if (!hasVoxel(occ, vx, vy - 1, vz)) {
        pushQuad(
          toObj(x0, y0, z0),
          toObj(x1, y0, z0),
          toObj(x1, y0, z1),
          toObj(x0, y0, z1),
          r,
          g,
          b,
        )
      }
      if (!hasVoxel(occ, vx, vy + 1, vz)) {
        pushQuad(
          toObj(x0, y1, z0),
          toObj(x0, y1, z1),
          toObj(x1, y1, z1),
          toObj(x1, y1, z0),
          r,
          g,
          b,
        )
      }
      if (!hasVoxel(occ, vx, vy, vz - 1)) {
        pushQuad(
          toObj(x0, y0, z0),
          toObj(x0, y1, z0),
          toObj(x1, y1, z0),
          toObj(x1, y0, z0),
          r,
          g,
          b,
        )
      }
      if (!hasVoxel(occ, vx, vy, vz + 1)) {
        pushQuad(
          toObj(x0, y0, z1),
          toObj(x1, y0, z1),
          toObj(x1, y1, z1),
          toObj(x0, y1, z1),
          r,
          g,
          b,
        )
      }
    }
  }

  if (voxelCount === 0) {
    throw new Error('No solid voxels found in .vox')
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    triangleCount: positions.length / 9,
    voxelCount,
  }
}
