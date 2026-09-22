/**
 * Best-effort Autodesk Maya `.mb` / `.ma` → Wavefront OBJ importer.
 *
 * Supports Maya Binary FOR4 (≤2013) and FOR8 (2014+), plus Maya ASCII.
 * Reads baked MESH plugs, additive `.pt` tweaks, DAG transforms (pivots +
 * bindPose `bps`), `transformGeometry.txf` history, CWFL/CONN shading, and
 * geometric half-mesh X-mirror when a mesh sits flush on X=0. Not a full DG /
 * skin / constraint / projection evaluator — UVs and materials come from the
 * scene as baked on disk. When a bound body atlas PNG is available, smeared /
 * misplaced UV islands from live projection history are rebuilt onto skin/lip
 * clusters (new UV indices only).
 *
 * References: Autodesk MTransformationMatrix / xform composition;
 * IFF FOR4/FOR8 (maya-scenefile-parser, LOC fdd000605).
 */

import {
  pickHighestQualityTexture,
  resolveTextureSiblings,
} from '../decodeImage'
import { decodeExportBytes, decodeExportText, repairMojibake } from '../exportText'
import { basename } from '../objAssets'
import { autoLoadSidecarTextures } from '../sidecarTextures'
import { ObjTextWriter } from '../objStream'
import type { ModelFormat } from './types'
import type { MeshBoneDef, MeshBoneRig, MeshBoneWeights } from '../meshBoneRig'
import { alignMeshBoneRigToPositions } from '../meshBoneRig'
import { decodePngRgbaForMaya, repairAtlasUvsFromTexture } from './mayaUvRepair'

export const mayaFormat: ModelFormat = {
  id: 'maya',
  label: 'Maya scene',
  role: 'primary',
  extensions: ['mb', 'ma'],
  priority: 100,
  matches: (fileName) => /\.(mb|ma)$/i.test(fileName),
}

export function isMayaFileName(name: string): boolean {
  return mayaFormat.matches(name)
}

export type MayaImportOptions = {
  fileName: string
  /** Lowercase basename → bytes for textures / companions. */
  siblings?: Record<string, Uint8Array>
  onProgress?: (label: string) => void
}

export type MayaNativeSkin = {
  /** The scene's own joints, at their bind pose. */
  rig: MeshBoneRig
  /** Imported weights in baked OBJ vertex order, or null when they can't be mapped. */
  skin: MeshBoneWeights | null
}

export type MayaImportResult = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textures: Record<string, Uint8Array>
  meshCount: number
  warnings: string[]
  sourceLabel: string
  /** Texture basenames referenced by shading (for companion UI). */
  expectedTextureNames: string[]
  /** Skeleton from the scene's skinCluster, when it has one. */
  nativeSkin: MayaNativeSkin | null
}

type Vec3 = [number, number, number]
type Vec2 = [number, number]

type ExtractedMesh = {
  name: string
  positions: Vec3[]
  uvs: Vec2[]
  /** Triangle corner indices into positions. */
  triangles: [number, number, number][]
  /** Parallel UV indices into `uvs` (Maya face-vertex map); null if unavailable. */
  triangleUvs: [number, number, number][] | null
  textureFileName: string | null
  color: Vec3
}

const TEXTURE_EXT = /\.(png|jpe?g|webp|bmp|gif|tif|tiff|tga)$/i

function sanitizeMtlName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

/** Strip Maya DAG path (`|group|node`) to the leaf name. */
function shortNodeName(name: string): string {
  const i = name.lastIndexOf('|')
  return i >= 0 ? name.slice(i + 1) : name
}

/** Highest-resolution same-stem sibling, transcoded to PNG when the winner is TGA/TIFF. */
function lookupPreparedTexture(
  wanted: string,
  prepared: Awaited<ReturnType<typeof resolveTextureSiblings>>,
): { fileName: string; bytes: Uint8Array; substituted: boolean } | null {
  const fileName = prepared.fileNameFor(wanted)
  if (!fileName) return null
  const bytes =
    prepared.files[fileName.toLowerCase()]
    ?? prepared.files[basename(wanted).toLowerCase()]
  if (!bytes?.length) return null
  return {
    fileName,
    bytes,
    substituted: fileName.toLowerCase() !== basename(wanted).toLowerCase(),
  }
}

function readBeU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

function readBeU64(view: DataView, offset: number): number {
  const hi = view.getUint32(offset, false)
  const lo = view.getUint32(offset + 4, false)
  // Keep values in JS-safe integer range; callers also bounds-check against file size.
  if (hi > 0x1fffff) {
    throw new Error('Maya chunk larger than 4GiB is not supported')
  }
  return hi * 0x1_0000_0000 + lo
}

function align(offset: number, alignment: number): number {
  const rem = offset % alignment
  return rem === 0 ? offset : offset + (alignment - rem)
}

function decodeCString(bytes: Uint8Array, start: number): { text: string; next: number } {
  let end = start
  while (end < bytes.length && bytes[end] !== 0) end += 1
  const text = decodeExportBytes(bytes.subarray(start, end))
  return { text, next: end + 1 }
}

function goodVertex(x: number, y: number, z: number): boolean {
  if (![x, y, z].every((v) => Number.isFinite(v))) return false
  if (![x, y, z].every((v) => Math.abs(v) <= 1e5)) return false
  const mag = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  return mag === 0 || mag >= 1e-4
}

/** Detect Maya Binary container version from magic. */
export function detectMayaBinaryVersion(bytes: Uint8Array): 'FOR4' | 'FOR8' | null {
  if (bytes.length < 4) return null
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (magic === 'FOR4' || magic === 'FOR8') return magic
  return null
}

export function isMayaAscii(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 64))
  return head.startsWith('//Maya') || head.includes('requires maya')
}

type LeafChunk = {
  tag: string
  payload: Uint8Array
  depth: number
  formStack: string[]
}

function parseIffLeaves(bytes: Uint8Array): { version: 'FOR4' | 'FOR8'; leaves: LeafChunk[]; mayaVersion: string | null } {
  const version = detectMayaBinaryVersion(bytes)
  if (!version) throw new Error('Not a Maya Binary file (missing FOR4/FOR8 magic)')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // mottosso maya-scenefile-parser MAYA_BINARY_64:
  // header = 4-byte tag + 4-byte pad + 8-byte size (16 bytes).
  // Chunk ends are aligned to 8 relative to the parent form's content start
  // (after the 4-byte form type), not to the file origin — see sansapp maya_iff.md.
  const is64 = version === 'FOR8'
  const headerBytes = is64 ? 16 : 8
  const sizeOffset = is64 ? 8 : 4
  const alignment = is64 ? 8 : 4
  const groupTags = is64 ? new Set(['FOR8', 'LIS8']) : new Set(['FOR4', 'LIS4'])

  const leaves: LeafChunk[] = []
  const stack: { end: number; form: string; alignBase: number }[] = []
  let mayaVersion: string | null = null
  let offset = 0

  const alignFromBase = (pos: number, base: number): number => {
    const rel = pos - base
    if (rel < 0) return align(pos, alignment)
    return base + align(rel, alignment)
  }

  while (offset + headerBytes <= bytes.length) {
    while (stack.length > 0 && offset >= stack[stack.length - 1]!.end) stack.pop()

    const tag = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const size = is64 ? readBeU64(view, offset + sizeOffset) : readBeU32(view, offset + sizeOffset)
    const dataStart = offset + headerBytes

    if (!Number.isFinite(size) || size < 0 || dataStart > bytes.length) break
    if (size > bytes.length) break

    const alignBase = stack.length > 0 ? stack[stack.length - 1]!.alignBase : 0

    if (groupTags.has(tag)) {
      if (dataStart + 4 > bytes.length) break
      const form = String.fromCharCode(
        bytes[dataStart]!,
        bytes[dataStart + 1]!,
        bytes[dataStart + 2]!,
        bytes[dataStart + 3]!,
      )
      const contentStart = dataStart + 4
      const end = alignFromBase(dataStart + size, alignBase || dataStart)
      stack.push({ end, form, alignBase: contentStart })
      offset = contentStart
      continue
    }

    const payloadEnd = Math.min(dataStart + size, bytes.length)
    const payload = bytes.subarray(dataStart, payloadEnd)
    const formStack = stack.map((s) => s.form)
    leaves.push({ tag, payload, depth: stack.length, formStack: [...formStack] })

    if (tag === 'VERS') {
      mayaVersion = new TextDecoder('latin1').decode(payload).replace(/\0+$/g, '')
    }

    offset = alignFromBase(payloadEnd, alignBase)
  }

  return { version, leaves, mayaVersion }
}

function parseAttrPayload(payload: Uint8Array): { name: string; body: Uint8Array } | null {
  if (payload.length < 2) return null
  const { text, next } = decodeCString(payload, 0)
  if (next >= payload.length) return { name: text, body: new Uint8Array() }
  // Flag byte (often 0x20), then attribute body.
  return { name: text, body: payload.subarray(next + 1) }
}

function readBeFloats(body: Uint8Array): number[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const count = Math.floor(body.length / 4)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(view.getFloat32(i * 4, false))
  return out
}

/** Packed Maya mesh ints: big-endian `0x00IIIIFF` → mid index (flags in low byte). */
function topoIndex(beU32: number): number {
  return (beU32 >>> 8) & 0xffff
}

type EdgePair = [number, number]

/** Orient unsigned edge ids into a closed loop using edge endpoints. */
function orientEdgeLoop(edgeIds: number[], edges: EdgePair[]): number[] | null {
  if (edgeIds.length < 3) return null
  for (const firstRev of [false, true]) {
    const id0 = edgeIds[0]!
    const e0 = edges[id0]
    if (!e0) return null
    const signed: number[] = [firstRev ? -(id0 + 1) : id0]
    let start = firstRev ? e0[1] : e0[0]
    let cur = firstRev ? e0[0] : e0[1]
    let ok = true
    for (let k = 1; k < edgeIds.length; k++) {
      const id = edgeIds[k]!
      const e = edges[id]
      if (!e) {
        ok = false
        break
      }
      if (e[0] === cur) {
        signed.push(id)
        cur = e[1]
      } else if (e[1] === cur) {
        signed.push(-(id + 1))
        cur = e[0]
      } else {
        ok = false
        break
      }
    }
    if (ok && cur === start) return signed
  }
  return null
}

function faceVertsFromSignedEdges(signed: number[], edges: EdgePair[]): number[] | null {
  const verts: number[] = []
  for (const s of signed) {
    const rev = s < 0
    const id = rev ? -s - 1 : s
    const e = edges[id]
    if (!e) return null
    verts.push(rev ? e[1] : e[0])
  }
  return verts
}

function scoreTriangles(positions: Vec3[], triangles: [number, number, number][]): number {
  if (triangles.length === 0) return Number.POSITIVE_INFINITY
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const p of positions) {
    minX = Math.min(minX, p[0])
    minY = Math.min(minY, p[1])
    minZ = Math.min(minZ, p[2])
    maxX = Math.max(maxX, p[0])
    maxY = Math.max(maxY, p[1])
    maxZ = Math.max(maxZ, p[2])
  }
  const extent = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
  // Absolute 15 was fine for large meshes; thin frames can span much more.
  const longThresh = Math.max(15, extent * 0.2)
  let long = 0
  for (const [a, b, c] of triangles) {
    const pa = positions[a]!
    const pb = positions[b]!
    const pc = positions[c]!
    const dist = (p: Vec3, q: Vec3) => {
      const dx = p[0] - q[0]
      const dy = p[1] - q[1]
      const dz = p[2] - q[2]
      return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    if (Math.max(dist(pa, pb), dist(pb, pc), dist(pc, pa)) > longThresh) long += 1
  }
  return long / triangles.length
}

function triangulateFace(verts: number[]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let t = 1; t + 1 < verts.length; t++) {
    const a = verts[0]!
    const b = verts[t]!
    const c = verts[t + 1]!
    if (a === b || b === c || a === c) continue
    out.push([a, b, c])
  }
  return out
}

function triangulateFaceWithUvs(
  verts: number[],
  uvs: number[],
): { tris: [number, number, number][]; triUvs: [number, number, number][] } {
  const tris: [number, number, number][] = []
  const triUvs: [number, number, number][] = []
  if (verts.length !== uvs.length) {
    for (const tri of triangulateFace(verts)) tris.push(tri)
    return { tris, triUvs }
  }
  for (let t = 1; t + 1 < verts.length; t++) {
    const a = verts[0]!
    const b = verts[t]!
    const c = verts[t + 1]!
    if (a === b || b === c || a === c) continue
    tris.push([a, b, c])
    triUvs.push([uvs[0]!, uvs[t]!, uvs[t + 1]!])
  }
  return { tris, triUvs }
}

/** Maya stores face-vertex UV ids after the edge face table: [hdr?][nConnects][uvId…]. */
function findUvConnectStream(
  view: DataView,
  byteLength: number,
  nConnects: number,
  maxUvId: number,
  minOffset = 0,
): number[] | null {
  if (nConnects < 3 || maxUvId < 1) return null
  const start = Math.max(0, minOffset)
  // Scan every byte alignment — some UV tables are odd-byte shifted vs verts/edges.
  for (let off = start; off + (2 + nConnects) * 4 <= byteLength; off++) {
    const count = topoIndex(view.getUint32(off, false))
    if (count !== nConnects) continue
    // Optional: previous word is a small header (common in older Maya MESH plugs).
    const stream: number[] = []
    let ok = true
    for (let i = 0; i < nConnects; i++) {
      const id = topoIndex(view.getUint32(off + 4 + i * 4, false))
      if (id > maxUvId) {
        ok = false
        break
      }
      stream.push(id)
    }
    if (!ok) continue
    // Spot-check: not all zeros / not identical to a trivial ramp.
    let nonzero = 0
    for (const id of stream) if (id !== 0) nonzero += 1
    if (nonzero < Math.max(3, Math.floor(nConnects / 10))) continue
    return stream
  }
  return null
}

type ExtractedTopo = {
  positions: Vec3[]
  triangles: [number, number, number][]
  /** Parallel to triangles: source Maya face index (for per-face materials). */
  triangleFaceIds: number[]
  faceLoops: number[][]
  nConnects: number
  afterFaces: number
}

/**
 * Deterministic FOR4 MESH layout (Maya 2011–2016 era binary):
 *   u32 numFloats (= 3·V) | f32[3V] verts
 *   u32 2·E               | u32[2E] edge endpoints (bit31 = hard-edge flag)
 *   u32 nFaceConnects     | u32[n] edge refs:
 *                           bit31 = traverse reversed
 *                           bit30 = last edge of this face
 *                           bits0..28 = edge id
 */
function extractVerticesAndFacesDeterministic(meshBody: Uint8Array): ExtractedTopo | null {
  if (meshBody.length < 64) return null
  const view = new DataView(meshBody.buffer, meshBody.byteOffset, meshBody.byteLength)
  const numFloats = view.getUint32(0, false)
  if (numFloats === 0 || numFloats % 3 !== 0) return null
  const nverts = numFloats / 3
  if (nverts < 3 || nverts > 500_000) return null
  const vertEnd = 4 + numFloats * 4
  if (vertEnd + 4 > meshBody.length) return null
  const twoE = view.getUint32(vertEnd, false)
  if (twoE === 0 || twoE % 2 !== 0) return null
  const nEdges = twoE / 2
  if (nEdges < 3 || nEdges > 400_000) return null
  const edgeEnd = vertEnd + 4 + twoE * 4
  if (edgeEnd + 4 > meshBody.length) return null
  const edges: EdgePair[] = []
  for (let e = 0; e < nEdges; e++) {
    const a = view.getUint32(vertEnd + 4 + e * 8, false) & 0x7fffffff
    const b = view.getUint32(vertEnd + 8 + e * 8, false) & 0x7fffffff
    if (a >= nverts || b >= nverts) return null
    edges.push([a, b])
  }
  const nConnects = view.getUint32(edgeEnd, false)
  const connEnd = edgeEnd + 4 + nConnects * 4
  if (nConnects < 3 || connEnd > meshBody.length) return null

  const REV = 0x80000000
  const END = 0x40000000
  const ID_MASK = 0x1fffffff
  const faceLoops: number[][] = []
  let loop: number[] = []
  let cur = -1
  let broken = 0
  let unclosed = 0
  for (let i = 0; i < nConnects; i++) {
    const w = view.getUint32(edgeEnd + 4 + i * 4, false)
    const id = w & ID_MASK
    const rev = (w & REV) !== 0
    const e = edges[id]
    if (!e) return null
    const from = rev ? e[1]! : e[0]!
    const to = rev ? e[0]! : e[1]!
    if (loop.length === 0) {
      loop = [from]
      cur = to
    } else {
      if (from !== cur) broken += 1
      loop.push(from)
      cur = to
    }
    if (w & END) {
      if (cur !== loop[0]) unclosed += 1
      if (loop.length >= 3) faceLoops.push(loop)
      loop = []
      cur = -1
    }
  }
  if (loop.length > 0 || broken > Math.max(2, Math.floor(nConnects * 0.002)) || unclosed > 0) {
    return null
  }
  if (faceLoops.length < 1) return null

  const positions: Vec3[] = []
  for (let i = 0; i < nverts; i++) {
    const o = 4 + i * 12
    positions.push([
      view.getFloat32(o, false),
      view.getFloat32(o + 4, false),
      view.getFloat32(o + 8, false),
    ])
  }
  const triangles: [number, number, number][] = []
  const triangleFaceIds: number[] = []
  for (let fi = 0; fi < faceLoops.length; fi++) {
    for (const tri of triangulateFace(faceLoops[fi]!)) {
      triangles.push(tri)
      triangleFaceIds.push(fi)
    }
  }
  if (triangles.length < 1) return null
  return { positions, triangles, triangleFaceIds, faceLoops, nConnects, afterFaces: connEnd }
}

/**
 * Decode Maya MESH plug (`outMesh` / `cachedInMesh`):
 * big-endian float3 vertices, then packed edge table + face edge-connects.
 */
function extractVerticesAndFaces(meshBody: Uint8Array): ExtractedTopo | null {
  const deterministic = extractVerticesAndFacesDeterministic(meshBody)
  if (deterministic) return deterministic

  if (meshBody.length < 64) return null
  const view = new DataView(meshBody.buffer, meshBody.byteOffset, meshBody.byteLength)

  // Fallback scanner for atypical / newer layouts the deterministic path rejects.
  const vertOffCandidates: number[] = []
  for (let off = 0; off <= 16; off++) {
    if (off + 36 > meshBody.length) break
    const x = view.getFloat32(off, false)
    const y = view.getFloat32(off + 4, false)
    const z = view.getFloat32(off + 8, false)
    if (!goodVertex(x, y, z)) continue
    // Prefer starts where each component looks like a real coordinate (not header junk).
    // Allow tiny epsilons (Maya sometimes stores 5.96e-8) so axis alignment stays correct.
    const componentsOk =
      [x, y, z].every((v) => Math.abs(v) === 0 || Math.abs(v) >= 1e-8) &&
      Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e-8
    let run = 1
    while (off + (run + 1) * 12 <= meshBody.length && run < 64) {
      const xx = view.getFloat32(off + run * 12, false)
      const yy = view.getFloat32(off + run * 12 + 4, false)
      const zz = view.getFloat32(off + run * 12 + 8, false)
      if (!goodVertex(xx, yy, zz)) break
      run += 1
    }
    if (run >= 8 && componentsOk) vertOffCandidates.push(off)
  }
  if (vertOffCandidates.length === 0) {
    // Fallback: any run of goodVertex triples.
    for (let off = 0; off <= 16; off++) {
      if (off + 36 > meshBody.length) break
      let run = 0
      while (off + (run + 1) * 12 <= meshBody.length && run < 64) {
        const xx = view.getFloat32(off + run * 12, false)
        const yy = view.getFloat32(off + run * 12 + 4, false)
        const zz = view.getFloat32(off + run * 12 + 8, false)
        if (!goodVertex(xx, yy, zz)) break
        run += 1
      }
      if (run >= 8) vertOffCandidates.push(off)
    }
  }
  if (vertOffCandidates.length === 0) return null

  let best: {
    positions: Vec3[]
    triangles: [number, number, number][]
    faceLoops: number[][]
    nConnects: number
    afterFaces: number
    score: number
  } | null = null
  for (const vertOff of vertOffCandidates) {
    // Estimate vertex count by walking BE floats until values stop looking like positions.
    let estimated = 0
    while (vertOff + (estimated + 1) * 12 <= meshBody.length && estimated < 500_000) {
      const x = view.getFloat32(vertOff + estimated * 12, false)
      const y = view.getFloat32(vertOff + estimated * 12 + 4, false)
      const z = view.getFloat32(vertOff + estimated * 12 + 8, false)
      if (!goodVertex(x, y, z)) break
      // Topology words misread as floats are usually huge or denormal-heavy; stop on spikes.
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e4 && estimated > 32) break
      estimated += 1
    }
    const candidate = scanTopoByHeader(view, meshBody.length, vertOff, estimated)
    if (!candidate) continue
    if (!best || candidate.score < best.score) best = candidate
    if (best.score < 0.02) break
  }
  if (!best || best.score > 0.2) return null
  const triangleFaceIds: number[] = []
  {
    let fi = 0
    for (const verts of best.faceLoops) {
      const n = Math.max(0, verts.length - 2)
      for (let k = 0; k < n; k++) triangleFaceIds.push(fi)
      // Actual triangulateFace may skip degenerates — rebuild to stay in sync.
      fi += 1
    }
  }
  // Rebuild face ids from real triangulation so lengths match.
  const syncedIds: number[] = []
  for (let fi = 0; fi < best.faceLoops.length; fi++) {
    for (const _ of triangulateFace(best.faceLoops[fi]!)) syncedIds.push(fi)
  }
  return {
    positions: best.positions,
    triangles: best.triangles,
    triangleFaceIds: syncedIds.length === best.triangles.length ? syncedIds : best.triangles.map((_, i) => i),
    faceLoops: best.faceLoops,
    nConnects: best.nConnects,
    afterFaces: best.afterFaces,
  }
}

/** Locate `2*numEdges` header after BE verts and derive vertex count from the gap. */
function scanTopoByHeader(
  view: DataView,
  byteLength: number,
  vertOff: number,
  estimatedVerts = 0,
): {
  positions: Vec3[]
  triangles: [number, number, number][]
  faceLoops: number[][]
  nConnects: number
  afterFaces: number
  score: number
} | null {
  type MeshCandidate = {
    positions: Vec3[]
    triangles: [number, number, number][]
    faceLoops: number[][]
    nConnects: number
    afterFaces: number
    score: number
  }
  // Mutable box so closure assignments stay visible to control-flow analysis.
  const state: { best: MeshCandidate | null } = { best: null }

  const tryCandidate = (topoOff: number, headerAt: number): boolean => {
    const midAt = (wordIndex: number) => {
      const off = topoOff + wordIndex * 4
      if (off + 4 > byteLength) return -1
      return topoIndex(view.getUint32(off, false))
    }

    const twoE = midAt(headerAt)
    if (twoE < 16 || twoE % 2 !== 0) return false
    const nEdges = twoE / 2
    if (nEdges > 400_000) return false

    for (let delta = -4; delta <= 4; delta++) {
      const vertBytes = topoOff - delta - vertOff
      if (vertBytes < 8 * 12 || vertBytes % 12 !== 0) continue
      const nverts = vertBytes / 12
      // Allow denser edge tables (open meshes / frames ≈ 2E per vert).
      if (nEdges < Math.max(3, Math.floor(nverts / 8)) || nEdges > nverts * 6) continue

      const edgeStart = headerAt + 1
      let spotOk = true
      for (let e = 0; e < Math.min(nEdges, 32); e++) {
        const a = midAt(edgeStart + e * 2)
        const b = midAt(edgeStart + e * 2 + 1)
        if (a < 0 || b < 0 || a >= nverts || b >= nverts) {
          spotOk = false
          break
        }
      }
      if (!spotOk) continue

      const edges: EdgePair[] = []
      let ok = true
      for (let e = 0; e < nEdges; e++) {
        const a = midAt(edgeStart + e * 2)
        const b = midAt(edgeStart + e * 2 + 1)
        if (a < 0 || b < 0 || a >= nverts || b >= nverts) {
          ok = false
          break
        }
        edges.push([a, b])
      }
      if (!ok) continue

      const faceHdrAt = edgeStart + nEdges * 2
      const nConnects = midAt(faceHdrAt)
      if (nConnects < 3 || nConnects > nEdges * 4) continue
      if (topoOff + (faceHdrAt + 1 + nConnects) * 4 > byteLength) continue

      const connects: number[] = []
      for (let i = 0; i < nConnects; i++) {
        const id = midAt(faceHdrAt + 1 + i)
        if (id < 0 || id >= nEdges) {
          ok = false
          break
        }
        connects.push(id)
      }
      if (!ok) continue

      const positions: Vec3[] = []
      for (let i = 0; i < nverts; i++) {
        const o = vertOff + i * 12
        positions.push([
          view.getFloat32(o, false),
          view.getFloat32(o + 4, false),
          view.getFloat32(o + 8, false),
        ])
      }

      const faceLoops: number[][] = []
      let i = 0
      while (i < connects.length) {
        let found: number[] | null = null
        const maxLen = Math.min(64, connects.length - i)
        for (let len = 3; len <= maxLen; len++) {
          const ids = connects.slice(i, i + len)
          const signed = orientEdgeLoop(ids, edges)
          if (!signed) continue
          found = signed
          break
        }
        if (!found) break
        const verts = faceVertsFromSignedEdges(found, edges)
        if (!verts) break
        faceLoops.push(verts)
        i += found.length
      }
      if (i !== connects.length || faceLoops.length < 1) continue

      const tris: [number, number, number][] = []
      for (const verts of faceLoops) {
        for (const tri of triangulateFace(verts)) tris.push(tri)
      }
      if (tris.length === 0) continue

      const afterFaces = topoOff + (faceHdrAt + 1 + nConnects) * 4
      const score = scoreTriangles(positions, tris)
      const prev = state.best
      if (!prev || score < prev.score || (score === prev.score && tris.length > prev.triangles.length)) {
        state.best = {
          positions,
          triangles: tris,
          faceLoops,
          nConnects,
          afterFaces,
          score,
        }
      }
      if (score < 0.05) return true
    }
    return false
  }

  // Probe around the estimated vertex run end first (handles odd topo alignment).
  const guessVerts = new Set<number>()
  if (estimatedVerts >= 8) {
    for (const d of [-2, -1, 0, 1, 2, 3, 4]) {
      const g = estimatedVerts + d
      if (g >= 8) guessVerts.add(g)
    }
  }
  const approxN = Math.floor((byteLength - vertOff) / 44)
  for (const g of [approxN, Math.floor(approxN * 0.9), Math.floor(approxN * 0.8), Math.floor(approxN * 0.7)]) {
    if (g >= 8) guessVerts.add(g)
  }
  for (const nverts of guessVerts) {
    for (let delta = -4; delta <= 4; delta++) {
      const topoOff = vertOff + nverts * 12 + delta
      if (topoOff < 0 || topoOff + 64 >= byteLength) continue
      for (let headerAt = 0; headerAt < 4; headerAt++) {
        if (tryCandidate(topoOff, headerAt)) return state.best
      }
    }
  }

  const start = vertOff + 8 * 12
  for (let topoOff = start; topoOff + 64 < byteLength; topoOff++) {
    const w0 = view.getUint32(topoOff, false)
    const m0 = topoIndex(w0)
    const w1 = topoOff + 4 < byteLength ? topoIndex(view.getUint32(topoOff + 4, false)) : -1
    const looksPromising =
      (m0 >= 16 && m0 % 2 === 0 && m0 < 800_000) ||
      (w1 >= 16 && w1 % 2 === 0 && w1 < 800_000)
    if (!looksPromising) continue

    for (let headerAt = 0; headerAt < 4; headerAt++) {
      if (tryCandidate(topoOff, headerAt)) return state.best
    }
    if (state.best && state.best.score < 0.05) break
    if (topoOff - vertOff > 3_500_000) break
  }
  return state.best
}

function collectTextureHints(leaves: LeafChunk[]): string[] {
  const found = new Set<string>()
  const take = (value: string) => {
    const base = repairMojibake(basename(value.replaceAll('\\', '/'))).normalize('NFC')
    if (base && TEXTURE_EXT.test(base)) found.add(base)
  }
  for (const leaf of leaves) {
    if (leaf.tag !== 'STR ') continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    const bodyText = decodeExportBytes(parsed.body).replace(/\0/g, ' ')
    const combined = `${parsed.name} ${bodyText}`
    for (const match of combined.matchAll(/[^\s"']+\.(?:png|jpe?g|webp|bmp|gif|tif|tiff|tga)/gi)) {
      take(match[0]!)
    }
  }
  for (const leaf of leaves) {
    if (leaf.tag !== 'STR ' && leaf.tag !== 'FINF') continue
    const text = decodeExportBytes(leaf.payload)
    for (const match of text.matchAll(/[^\s"']+\.(?:png|jpe?g|webp|bmp|gif|tif|tiff|tga)/gi)) {
      take(match[0]!)
    }
  }
  return [...found]
}

/** Soft stem overlap between mesh name and texture basename; null if no unique match. */
function pickTextureForMesh(meshName: string, hints: string[]): string | null {
  if (hints.length === 0) return null
  const tokens = meshName
    .toLowerCase()
    .replace(/shape.*$/i, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !/^(mesh|poly|geo|grp|group|orig|node|lambert|phong|blinn)$/i.test(token))
  const stem = meshName
    .toLowerCase()
    .replace(/shape.*$/i, '')
    .replace(/[^a-z0-9]+/g, '')
  const scored = hints.map((hint) => {
    const h = hint.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '')
    let score = 0
    if (stem.length >= 3) {
      const n = Math.min(stem.length, 8)
      if (h.includes(stem.slice(0, n)) || stem.includes(h.slice(0, Math.min(h.length, n)))) score = n
    }
    for (const token of tokens) {
      if (h.includes(token)) score = Math.max(score, token.length + 2)
    }
    return { hint, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score <= 0) return null
  if (scored[1] && scored[1].score === best.score) return null
  return best.hint
}

function mapFaceLoopsToTriangleUvs(
  faceLoops: number[][],
  uvStream: number[],
): { triangles: [number, number, number][]; triangleUvs: [number, number, number][] } | null {
  const triangles: [number, number, number][] = []
  const triangleUvs: [number, number, number][] = []
  let uvAt = 0
  for (const verts of faceLoops) {
    if (uvAt + verts.length > uvStream.length) return null
    const cornerUvs = uvStream.slice(uvAt, uvAt + verts.length)
    uvAt += verts.length
    const mapped = triangulateFaceWithUvs(verts, cornerUvs)
    if (mapped.triUvs.length !== mapped.tris.length) return null
    for (const tri of mapped.tris) triangles.push(tri)
    for (const tu of mapped.triUvs) triangleUvs.push(tu)
  }
  if (uvAt !== uvStream.length) return null
  return { triangles, triangleUvs }
}

type DagNode = {
  name: string
  parent: string
  t: Vec3
  r: Vec3
  s: Vec3
  jo: Vec3
  rp: Vec3
  rpt: Vec3
  sp: Vec3
  ro: number
  bps: number[] | null
}

const MAT_I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function readBeDoubles(body: Uint8Array): number[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const count = Math.floor(body.length / 8)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(view.getFloat64(i * 8, false))
  return out
}

function readDbl3(body: Uint8Array): Vec3 | null {
  if (body.length < 24) return null
  const d = readBeDoubles(body)
  return [d[0]!, d[1]!, d[2]!]
}

function matMul4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k]! * b[k * 4 + c]!
      o[r * 4 + c] = sum
    }
  }
  return o
}

function translationMat(t: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]
}

function scaleMat(s: Vec3): number[] {
  return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]
}

/** Euler radians with Maya rotate-order; matrices are row-major for p' = p·M. */
function eulerRadMat(rx: number, ry: number, rz: number, ro: number): number[] {
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const Rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]
  const Ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]
  const Rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const orders: number[][][] = [
    [Rx, Ry, Rz],
    [Ry, Rz, Rx],
    [Rz, Rx, Ry],
    [Rx, Rz, Ry],
    [Ry, Rx, Rz],
    [Rz, Ry, Rx],
  ]
  const [A, B, C] = orders[(((ro | 0) % 6) + 6) % 6]!
  return matMul4(matMul4(A!, B!), C!)
}

function localMatrix(n: DagNode): number[] {
  // Autodesk MTransformationMatrix / xform (row-vector, p' = p·M, translation in
  // the bottom row). Documented product:
  //   M = Sp⁻¹ · S · Sh · Sp · St · Rp⁻¹ · Ro · R · Rp · Rt · T
  // where Sp/Rp are T(+pivot) and Sp⁻¹/Rp⁻¹ are T(−pivot).
  // (Shear / scale-translate omitted; jo used as rotate orientation.)
  // Angles in binary DBL3 are radians.
  const T = translationMat(n.t)
  const Rt = translationMat(n.rpt)
  const Rp = translationMat(n.rp)
  const RpInv = translationMat([-n.rp[0], -n.rp[1], -n.rp[2]])
  const R = eulerRadMat(n.r[0], n.r[1], n.r[2], n.ro)
  const Ro = eulerRadMat(n.jo[0], n.jo[1], n.jo[2], 0)
  const Sp = translationMat(n.sp)
  const SpInv = translationMat([-n.sp[0], -n.sp[1], -n.sp[2]])
  const S = scaleMat(n.s)
  return matMul4(
    SpInv,
    matMul4(S, matMul4(Sp, matMul4(RpInv, matMul4(Ro, matMul4(R, matMul4(Rp, matMul4(Rt, T))))))),
  )
}

function xformPoint(m: number[], p: Vec3): Vec3 {
  const x = p[0]
  const y = p[1]
  const z = p[2]
  return [
    x * m[0]! + y * m[4]! + z * m[8]! + m[12]!,
    x * m[1]! + y * m[5]! + z * m[9]! + m[13]!,
    x * m[2]! + y * m[6]! + z * m[10]! + m[14]!,
  ]
}

/** Strip Advanced Skeleton / control prefixes to find a bind-pose joint twin. */
function bindPoseTwinName(name: string): string | null {
  let n = name
  for (const prefix of [
    'FKOffset',
    'FKExtra',
    'FKGlobalStatic',
    'FKGlobal',
    'FKX',
    'FK',
    'IKOffset',
    'IKExtra',
    'IK',
    'Drive_',
    'Ctrl_',
    'CTRL_',
    'ctrl_',
  ]) {
    if (n.startsWith(prefix) && n.length > prefix.length) {
      n = n.slice(prefix.length)
      break
    }
  }
  return n !== name ? n : null
}

type ShaderBinding = {
  color: Vec3
  textureFileName: string | null
}

/** Parse connection plugs from CWFL (common) and CONN (Maya binary DG list). */
function parseSceneConnections(leaves: LeafChunk[]): { src: string; dst: string }[] {
  const out: { src: string; dst: string }[] = []
  for (const leaf of leaves) {
    if (leaf.tag === 'CWFL') {
      if (leaf.payload.length < 3) continue
      const src = decodeCString(leaf.payload, 1)
      if (!src.text || src.next >= leaf.payload.length) continue
      const dst = decodeCString(leaf.payload, src.next)
      if (!dst.text) continue
      out.push({ src: src.text, dst: dst.text })
      continue
    }
    if (leaf.tag === 'CONN') {
      // mottosso: skip 9 bytes (FOR4) or 17 (FOR8) then src\\0 dst\\0
      for (const skip of [9, 17, 1, 0]) {
        if (leaf.payload.length < skip + 3) continue
        const src = decodeCString(leaf.payload, skip)
        if (!src.text || src.next >= leaf.payload.length) continue
        const dst = decodeCString(leaf.payload, src.next)
        if (!dst.text) continue
        if (src.text.includes('.') || dst.text.includes('.')) {
          out.push({ src: src.text, dst: dst.text })
          break
        }
      }
    }
  }
  return out
}

function nodeFromPlug(plug: string): string {
  const i = plug.indexOf('.')
  return i >= 0 ? plug.slice(0, i) : plug
}

function attrFromPlug(plug: string): string {
  const i = plug.indexOf('.')
  if (i < 0) return ''
  let attr = plug.slice(i + 1)
  const dot = attr.indexOf('.')
  if (dot >= 0) attr = attr.slice(0, dot)
  const br = attr.indexOf('[')
  if (br >= 0) attr = attr.slice(0, br)
  return attr
}

/** Last component of a compound plug: `a.iog.og[0].gid` → `gid`. */
function leafAttrFromPlug(plug: string): string {
  const i = plug.lastIndexOf('.')
  if (i < 0) return ''
  let attr = plug.slice(i + 1)
  const br = attr.indexOf('[')
  if (br >= 0) attr = attr.slice(0, br)
  return attr
}

function ogIndexFromPlug(plug: string): number | null {
  const m = /\.iog(?:\[\d+\])?\.og\[(\d+)\]/.exec(plug)
  return m ? Number(m[1]) : null
}

/** Decode Maya CMP# face-component ranges (`CMDF`). */
function decodeCompFaceRanges(body: Uint8Array): [number, number][] | null {
  if (body.length < 12) return null
  const tag = new TextDecoder('latin1').decode(body.subarray(4, 8))
  if (tag !== 'CMDF') return null
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const n = view.getUint32(8, false)
  if (n < 1 || 12 + n * 8 > body.length) return null
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    out.push([view.getUint32(12 + i * 8, false), view.getUint32(16 + i * 8, false)])
  }
  return out
}

type FaceMaterialPartition = {
  binding: ShaderBinding
  /** Where the face list came from; groupParts indices can be stale vs baked MESH. */
  rangesFrom?: 'gcl' | 'groupParts'
  /** Inclusive Maya face-index ranges. Empty = all faces. */
  ranges: [number, number][]
}

/**
 * Native per-face shadingEngine assignment via `iog.og[k]` + `CMP#` face lists.
 * Returns partitions for a baked mesh by looking at all shapes under its transform.
 */
function collectFaceMaterialPartitions(
  leaves: LeafChunk[],
  meshName: string,
  parent: string,
  shapesByParent: Map<string, string[]>,
): FaceMaterialPartition[] {
  const colors = new Map<string, Vec3>()
  const ftns = new Map<string, string>()
  const shdgNodes = new Set<string>()
  let cur = ''
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      cur = shortNodeName(decodeCString(leaf.payload, 1).text)
      if (leaf.formStack.includes('SHDG') || leaf.formStack.includes('SGSG')) {
        shdgNodes.add(cur)
      }
      continue
    }
    if (!cur) continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    if (leaf.tag === 'FLT3' && (parsed.name === 'c' || parsed.name === 'color')) {
      const f = readBeFloats(parsed.body)
      if (f.length >= 3) colors.set(cur, [f[0]!, f[1]!, f[2]!])
    } else if (leaf.tag === 'STR ' && parsed.name === 'ftn') {
      const raw = decodeExportBytes(parsed.body)
      const base = basename(raw.replaceAll('\\', '/'))
      if (base && TEXTURE_EXT.test(base)) ftns.set(cur, base)
    }
  }

  const conns = parseSceneConnections(leaves)
  const shaderOfSg = new Map<string, string>()
  const fileOfShader = new Map<string, string>()
  const fileOfInfo = new Map<string, string>()
  const infoOfShader = new Map<string, string>()
  const infoOfSg = new Map<string, string>()
  const sgOfGroupId = new Map<string, string>()
  const ogToSg = new Map<string, string>() // shape#og → SG

  for (const { src, dst } of conns) {
    const sn = shortNodeName(nodeFromPlug(src))
    const dn = shortNodeName(nodeFromPlug(dst))
    const sa = attrFromPlug(src)
    const da = attrFromPlug(dst)
    if (sa === 'oc' && da === 'ss') shaderOfSg.set(dn, sn)
    if (sa === 'oc' && (da === 'c' || da === 'color')) fileOfShader.set(dn, sn)
    if (sa === 'msg' && da === 't') fileOfInfo.set(dn, sn)
    if (sa === 'msg' && da === 'm') infoOfShader.set(sn, dn)
    if (sa === 'msg' && da === 'sg') infoOfSg.set(dn, sn)
    if (sa === 'msg' && da === 'gn') sgOfGroupId.set(sn, dn)
    const ogSrc = ogIndexFromPlug(src)
    if (ogSrc !== null && da === 'dsm') {
      // Only accept real shading engines when we can identify them.
      if (shdgNodes.size === 0 || shdgNodes.has(dn) || /SG$/i.test(dn) || /initialShadingGroup/i.test(dn)) {
        ogToSg.set(`${sn}#${ogSrc}`, dn)
      }
    }
    const ogDst = ogIndexFromPlug(dst)
    if (ogDst !== null && sa === 'msg' && da === 'gid') {
      // groupId → shape.iog.og[k].gid — SG via groupId.msg→gn
    }
  }
  for (const { src, dst } of conns) {
    const sn = shortNodeName(nodeFromPlug(src))
    const ogDst = ogIndexFromPlug(dst)
    if (ogDst !== null && leafAttrFromPlug(dst) === 'gid') {
      const shape = shortNodeName(nodeFromPlug(dst))
      const sg = sgOfGroupId.get(sn)
      if (sg) ogToSg.set(`${shape}#${ogDst}`, sg)
    }
  }

  const textureForShader = (shader: string, sg: string): string | null => {
    const viaFile = fileOfShader.get(shader)
    if (viaFile && ftns.has(viaFile)) return ftns.get(viaFile)!
    const info = infoOfShader.get(shader) ?? infoOfSg.get(sg)
    if (info) {
      const fileNode = fileOfInfo.get(info)
      if (fileNode && ftns.has(fileNode)) return ftns.get(fileNode)!
    }
    return null
  }

  // Face lists: prefer intermediate (baked) shape gcl under same parent.
  const siblings = parent
    ? (shapesByParent.get(parent) ?? [meshName])
    : [meshName]
  const gcl = new Map<string, [number, number][]>() // shape#og → ranges
  cur = ''
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      cur = shortNodeName(decodeCString(leaf.payload, 1).text)
      continue
    }
    if (leaf.tag !== 'CMP#' || !cur) continue
    if (!siblings.includes(cur) && cur !== meshName) continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    const m = /^iog\[\d+\]\.og\[(\d+)\]\.gcl$/.exec(parsed.name)
    if (!m) continue
    const ranges = decodeCompFaceRanges(parsed.body)
    if (ranges) gcl.set(`${cur}#${m[1]}`, ranges)
  }

  // Fallback: groupId → groupParts.ic (CMDF) when the shape has no iog…gcl list.
  const partsComps = new Map<string, [number, number][]>()
  cur = ''
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      cur = shortNodeName(decodeCString(leaf.payload, 1).text)
      continue
    }
    if (leaf.tag !== 'CMP#' || !cur) continue
    if (!/^groupParts/.test(cur)) continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    const ranges = decodeCompFaceRanges(parsed.body)
    if (ranges && ranges.length > 0) partsComps.set(`${cur}.${parsed.name}`, ranges)
  }
  const rangesOfGroupId = new Map<string, [number, number][]>()
  for (const { src: s, dst: d } of conns) {
    if (leafAttrFromPlug(d) !== 'gi') continue
    const partsNode = shortNodeName(nodeFromPlug(d))
    const ranges = partsComps.get(`${partsNode}.ic`)
    if (ranges) rangesOfGroupId.set(shortNodeName(nodeFromPlug(s)), ranges)
  }
  const groupRanges = new Map<string, [number, number][]>()
  for (const { src: s, dst: d } of conns) {
    if (leafAttrFromPlug(d) !== 'gid') continue
    const og = ogIndexFromPlug(d)
    if (og === null) continue
    const ranges = rangesOfGroupId.get(shortNodeName(nodeFromPlug(s)))
    if (ranges) groupRanges.set(`${shortNodeName(nodeFromPlug(d))}#${og}`, ranges)
  }

  const defaultColor: Vec3 = [0.72, 0.74, 0.78]
  const partitions: FaceMaterialPartition[] = []
  const seen = new Set<string>()
  for (const shape of siblings) {
    for (const [key, sg] of ogToSg) {
      if (!key.startsWith(`${shape}#`)) continue
      if (seen.has(key)) continue
      seen.add(key)
      const og = key.slice(key.indexOf('#') + 1)
      const shader = shaderOfSg.get(sg)
      if (!shader && !/initialShadingGroup/i.test(sg)) continue
      const color = (shader ? colors.get(shader) : null) ?? defaultColor
      const textureFileName = shader ? textureForShader(shader, sg) : null
      // Face lists often live on the intermediate bake while SG links hang on the render shape.
      let ranges = gcl.get(key) ?? []
      let rangesFrom: 'gcl' | 'groupParts' = 'gcl'
      if (ranges.length === 0) {
        for (const sib of siblings) {
          const alt = gcl.get(`${sib}#${og}`)
          if (alt && alt.length > 0) {
            ranges = alt
            break
          }
        }
      }
      if (ranges.length === 0) {
        ranges = groupRanges.get(key) ?? []
        if (ranges.length > 0) rangesFrom = 'groupParts'
      }
      if (ranges.length === 0) {
        for (const sib of siblings) {
          const alt = groupRanges.get(`${sib}#${og}`)
          if (alt && alt.length > 0) {
            ranges = alt
            rangesFrom = 'groupParts'
            break
          }
        }
      }
      if (ranges.length === 0 && !textureFileName && !shader) continue
      partitions.push({
        binding: { color: [...color] as Vec3, textureFileName },
        ranges,
        rangesFrom,
      })
    }
  }
  return partitions
}

function faceInRanges(face: number, ranges: [number, number][]): boolean {
  if (ranges.length === 0) return true
  for (const [a, b] of ranges) {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    // Maya uses 0xFFFFFFFF as "from start"
    const start = a === 0xffffffff ? 0 : lo
    if (face >= start && face <= hi) return true
  }
  return false
}

/**
 * Resolve per-mesh color + texture from FLT3 c/color, STR ftn, and CWFL links
 * (oc→ss, iog→dsm, file→materialInfo.t / file.oc→shader.c).
 *
 * Baked geometry usually lives on an intermediateObject (`…Orig`) while the
 * shadingEngine links hang off the sibling render shape under the same
 * transform — resolve materials through that parent, not the MESH node name.
 */
function resolveMeshMaterials(
  leaves: LeafChunk[],
  meshNames: string[],
  meshParents: Map<string, string>,
  shapesByParent: Map<string, string[]>,
  textureHints: string[],
): Map<string, ShaderBinding> {
  const colors = new Map<string, Vec3>()
  const ftns = new Map<string, string>()
  let cur = ''
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      cur = shortNodeName(decodeCString(leaf.payload, 1).text)
      continue
    }
    if (!cur) continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    if (leaf.tag === 'FLT3' && (parsed.name === 'c' || parsed.name === 'color')) {
      const f = readBeFloats(parsed.body)
      if (f.length >= 3) colors.set(cur, [f[0]!, f[1]!, f[2]!])
    } else if (leaf.tag === 'STR ' && parsed.name === 'ftn') {
      const raw = decodeExportBytes(parsed.body)
      const base = basename(raw.replaceAll('\\', '/'))
      if (base && TEXTURE_EXT.test(base)) ftns.set(cur, base)
    }
  }

  const conns = parseSceneConnections(leaves)
  const shaderOfSg = new Map<string, string>()
  const sgsOfMesh = new Map<string, string[]>()
  const fileOfInfo = new Map<string, string>()
  const infoOfShader = new Map<string, string>()
  const infoOfSg = new Map<string, string>()
  const fileOfShader = new Map<string, string>()

  const pushSg = (mesh: string, sg: string) => {
    const key = shortNodeName(mesh)
    const arr = sgsOfMesh.get(key) ?? []
    if (!arr.includes(sg)) arr.push(sg)
    sgsOfMesh.set(key, arr)
  }

  for (const { src, dst } of conns) {
    const sn = shortNodeName(nodeFromPlug(src))
    const dn = shortNodeName(nodeFromPlug(dst))
    const sa = attrFromPlug(src)
    const da = attrFromPlug(dst)
    if (sa === 'oc' && da === 'ss') shaderOfSg.set(dn, sn)
    else if (sa === 'ss' && da === 'oc') shaderOfSg.set(sn, dn)
    if (sa === 'iog' && da === 'dsm') pushSg(sn, dn)
    else if (sa === 'dsm' && da === 'iog') pushSg(dn, sn)
    if (sa === 'msg' && da === 't') fileOfInfo.set(dn, sn)
    else if (sa === 't' && da === 'msg') fileOfInfo.set(sn, dn)
    if (sa === 'msg' && da === 'm') infoOfShader.set(sn, dn)
    else if (sa === 'm' && da === 'msg') infoOfShader.set(dn, sn)
    if (sa === 'msg' && da === 'sg') infoOfSg.set(dn, sn)
    else if (sa === 'sg' && da === 'msg') infoOfSg.set(sn, dn)
    if (sa === 'oc' && (da === 'c' || da === 'color')) fileOfShader.set(dn, sn)
    else if ((sa === 'c' || sa === 'color') && da === 'oc') fileOfShader.set(sn, dn)
  }

  const defaultColor: Vec3 = [0.72, 0.74, 0.78]
  const result = new Map<string, ShaderBinding>()

  const textureForShader = (shader: string, sg: string | null): string | null => {
    const viaFile = fileOfShader.get(shader)
    if (viaFile && ftns.has(viaFile)) return ftns.get(viaFile)!
    const info = infoOfShader.get(shader) ?? (sg ? infoOfSg.get(sg) : undefined)
    if (info) {
      const fileNode = fileOfInfo.get(info)
      if (fileNode && ftns.has(fileNode)) return ftns.get(fileNode)!
    }
    return null
  }

  const bindingFromSgs = (sgs: string[]): ShaderBinding => {
    const textured: ShaderBinding[] = []
    let solid: ShaderBinding = { color: defaultColor, textureFileName: null }
    for (const sg of sgs) {
      const shader = shaderOfSg.get(sg) ?? null
      if (!shader) continue
      const color = colors.get(shader) ?? defaultColor
      const textureFileName = textureForShader(shader, sg)
      if (textureFileName) {
        textured.push({ color, textureFileName })
        continue
      }
      const isDefault =
        Math.abs(color[0] - defaultColor[0]) < 0.02 &&
        Math.abs(color[1] - defaultColor[1]) < 0.02 &&
        Math.abs(color[2] - defaultColor[2]) < 0.02
      if (!isDefault) solid = { color, textureFileName: null }
    }
    if (textured.length === 0) return solid
    // Multiple face materials collapsed to one mesh — keep the first graph-linked
    // textured SG (native order). Per-face splits handle multi-map meshes elsewhere.
    return textured[0]!
  }

  // Graph-reachable textures only — avoids dead pasted file nodes left in scenes.
  const graphTextures = new Set<string>()
  for (const [sg, shader] of shaderOfSg) {
    const t = textureForShader(shader, sg)
    if (t) graphTextures.add(t)
  }
  const safeHints = graphTextures.size > 0 ? [...graphTextures] : textureHints

  for (const mesh of meshNames) {
    const parent = shortNodeName(meshParents.get(mesh) ?? '')
    const siblings = parent ? (shapesByParent.get(parent) ?? [mesh]) : [mesh]
    const ordered = [...siblings].sort((a, b) => {
      const score = (n: string) => (/orig$/i.test(n) ? 1 : 0) + (/intermediate/i.test(n) ? 1 : 0)
      return score(a) - score(b)
    })
    const sgs: string[] = []
    for (const shape of ordered) {
      for (const sg of sgsOfMesh.get(shortNodeName(shape)) ?? []) {
        if (!sgs.includes(sg)) sgs.push(sg)
      }
    }
    // Also try the baked mesh name itself (some files bind directly).
    for (const sg of sgsOfMesh.get(shortNodeName(mesh)) ?? []) {
      if (!sgs.includes(sg)) sgs.push(sg)
    }
    result.set(mesh, bindingFromSgs(sgs))
  }

  // Last resort: name-match a texture when the shadingEngine has no file node,
  // or when it names a 3D-paint copy that is not itself a usable binding.
  for (const mesh of meshNames) {
    const binding = result.get(mesh)!
    if (binding.textureFileName) continue
    binding.textureFileName = pickTextureForMesh(mesh, safeHints)
  }

  return result
}

function parseDagNodes(leaves: LeafChunk[]): Map<string, DagNode> {
  const nodes = new Map<string, DagNode>()
  let cur: DagNode | null = null
  // Only XFRM/JOIN (and similar transform forms) own translate/rotate/pivots.
  // Mesh shapes under DMSH often share the transform's short name and must not
  // overwrite it. transformGeometry (TGEO) is DG history, not a DAG xform.
  const transformForms = new Set(['XFRM', 'JOIN', 'KHDL'])
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      const form = leaf.formStack[leaf.formStack.length - 1] ?? ''
      if (!transformForms.has(form)) {
        cur = null
        continue
      }
      const { text, next } = decodeCString(leaf.payload, 1)
      const parentRaw = next < leaf.payload.length ? decodeCString(leaf.payload, next).text : ''
      const name = shortNodeName(text)
      let parent = shortNodeName(parentRaw)
      // Self-parent (shape path pointing at itself) would recurse forever.
      if (parent === name) parent = ''
      cur = {
        name,
        parent,
        t: [0, 0, 0],
        r: [0, 0, 0],
        s: [1, 1, 1],
        jo: [0, 0, 0],
        rp: [0, 0, 0],
        rpt: [0, 0, 0],
        sp: [0, 0, 0],
        ro: 0,
        bps: null,
      }
      if (name) nodes.set(name, cur)
      continue
    }
    if (!cur) continue
    const parsed = parseAttrPayload(leaf.payload)
    if (!parsed) continue
    if (leaf.tag === 'DBL3') {
      const v = readDbl3(parsed.body)
      if (!v) continue
      if (parsed.name === 't') cur.t = v
      else if (parsed.name === 'r') cur.r = v
      else if (parsed.name === 's') cur.s = v
      else if (parsed.name === 'jo') cur.jo = v
      else if (parsed.name === 'rp') cur.rp = v
      else if (parsed.name === 'rpt') cur.rpt = v
      else if (parsed.name === 'sp') cur.sp = v
    } else if (leaf.tag === 'DBLE' && parsed.name === 'ro') {
      const d = readBeDoubles(parsed.body)
      if (d.length > 0) cur.ro = d[0]!
    } else if (leaf.tag === 'MATR' && parsed.name === 'bps' && parsed.body.length >= 128) {
      cur.bps = readBeDoubles(parsed.body).slice(0, 16)
    }
  }
  return nodes
}

/**
 * Resolve world matrix for a DAG node.
 *
 * Uses bindPose (`bps`) when present. When walking through Advanced Skeleton /
 * FK-IK control parents (`FKHead_M` → `Head_M`), substitutes the skeletal twin
 * that owns a bind matrix so we don't need constraint evaluation.
 */
function worldMatrixFor(
  name: string,
  nodes: Map<string, DagNode>,
  cache: Map<string, number[]>,
  depth = 0,
): number[] {
  if (cache.has(name)) return cache.get(name)!
  if (depth > 256) return [...MAT_I16]
  const node = nodes.get(name) ?? nodes.get(shortNodeName(name))
  if (!node) return [...MAT_I16]
  if (node.bps && node.bps.length === 16) {
    cache.set(name, node.bps)
    return node.bps
  }
  // If this node itself is an FK/IK control with a bind-pose twin, use the twin.
  const selfTwin = bindPoseTwinName(name)
  if (selfTwin && selfTwin !== name) {
    const twinNode = nodes.get(selfTwin)
    if (twinNode?.bps && twinNode.bps.length === 16) {
      cache.set(name, twinNode.bps)
      return twinNode.bps
    }
  }
  let parentName = node.parent
  if (parentName) {
    const twin = bindPoseTwinName(parentName)
    if (twin && nodes.get(twin)?.bps) parentName = twin
  }
  const parentMat = parentName ? worldMatrixFor(parentName, nodes, cache, depth + 1) : [...MAT_I16]
  const world = matMul4(localMatrix(node), parentMat)
  cache.set(name, world)
  return world
}

function nearIdentityMatrix(m: number[], eps = 1e-3): boolean {
  const I = MAT_I16
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i]! - I[i]!) > eps) return false
  }
  return true
}

function aabbOf(positions: Vec3[]): { min: Vec3; max: Vec3; center: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const [x, y, z] of positions) {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ]
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  return { min, max, center, size }
}

function maxExtent(size: Vec3): number {
  return Math.max(size[0], size[1], size[2])
}

function centroidMag(center: Vec3): number {
  return Math.hypot(center[0], center[1], center[2])
}

/** Higher is better: overlap + size agreement − distance, vs primary AABB. */
function aabbOverlapScore(
  placed: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 },
  primary: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 },
): number {
  const ox = Math.max(0, Math.min(placed.max[0], primary.max[0]) - Math.max(placed.min[0], primary.min[0]))
  const oy = Math.max(0, Math.min(placed.max[1], primary.max[1]) - Math.max(placed.min[1], primary.min[1]))
  const oz = Math.max(0, Math.min(placed.max[2], primary.max[2]) - Math.max(placed.min[2], primary.min[2]))
  const overlap = ox * oy * oz
  const pVol = Math.max(1e-8, primary.size[0] * primary.size[1] * primary.size[2])
  const pe = Math.max(maxExtent(primary.size), 1e-3)
  const me = Math.max(maxExtent(placed.size), 1e-3)
  const sizeRatio = me > pe ? pe / me : me / pe
  const dist = Math.hypot(
    placed.center[0] - primary.center[0],
    placed.center[1] - primary.center[1],
    placed.center[2] - primary.center[2],
  )
  return (overlap / pVol) * 4 + sizeRatio * 2 - dist / pe
}

/**
 * Maya mesh.pnts (`.pt`) is an additive per-vertex tweak: evaluated local
 * points are `vrts[i] + pnts[i]` (missing entries count as zero). Dense
 * `pt[a:b]` and sparse `pt[i]` plugs both store deltas, never absolute positions.
 */
function applyPntsTweak(
  positions: Vec3[],
  dense: { start: number; deltas: Vec3[] } | null,
  sparse: { index: number; delta: Vec3 }[],
): Vec3[] {
  if (!dense && sparse.length === 0) return positions
  const out = positions.map((p): Vec3 => [p[0], p[1], p[2]])
  if (dense) {
    for (let i = 0; i < dense.deltas.length; i++) {
      const vi = dense.start + i
      if (vi < 0 || vi >= out.length) continue
      const d = dense.deltas[i]!
      const p = out[vi]!
      out[vi] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
    }
  }
  for (const c of sparse) {
    if (c.index < 0 || c.index >= out.length) continue
    const p = out[c.index]!
    const d = c.delta
    out[c.index] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
  }
  return out
}

/**
 * Drop outlier vertices (and their triangles), then compact the position buffer.
 * Only runs when the cloud looks spiked (one axis dominates) — e.g. history verts
 * left far behind after a cancelled edit. Ordinary small meshes are left alone:
 * dense clusters (lenses, bolts) can look like IQR "outliers" on thin frames.
 */
function scrubOutlierTriangles(
  positions: Vec3[],
  triangles: [number, number, number][],
  triangleUvs: [number, number, number][] | null,
): { positions: Vec3[]; triangles: [number, number, number][]; triangleUvs: [number, number, number][] | null } {
  if (positions.length < 8 || triangles.length < 4) {
    return { positions, triangles, triangleUvs }
  }
  const rough = aabbOf(positions)
  const dims = [...rough.size].sort((a, b) => b - a)
  // Only scrub spiked clouds (e.g. history verts far behind). Never IQR-scrub
  // ordinary small meshes: dense lens/detail clusters can look like outliers.
  const looksSpiky = dims[0]! > Math.max(dims[1]! * 4, dims[2]! * 6, 1e-3)
  if (!looksSpiky) return { positions, triangles, triangleUvs }

  const axisVals = [0, 1, 2].map((ax) => positions.map((p) => p[ax]!).sort((a, b) => a - b))
  const percentile = (arr: number[], p: number) => {
    const i = (arr.length - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    if (lo === hi) return arr[lo]!
    return arr[lo]! * (hi - i) + arr[hi]! * (i - lo)
  }
  const k = 2.2
  const fences = axisVals.map((arr) => {
    const q1 = percentile(arr, 0.25)
    const q3 = percentile(arr, 0.75)
    const iqr = Math.max(q3 - q1, 1e-3)
    return { lo: q1 - k * iqr, hi: q3 + k * iqr }
  })
  const bad = new Uint8Array(positions.length)
  let badCount = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!
    if (
      p[0]! < fences[0]!.lo ||
      p[0]! > fences[0]!.hi ||
      p[1]! < fences[1]!.lo ||
      p[1]! > fences[1]!.hi ||
      p[2]! < fences[2]!.lo ||
      p[2]! > fences[2]!.hi
    ) {
      bad[i] = 1
      badCount += 1
    }
  }
  if (badCount === 0) return { positions, triangles, triangleUvs }

  const keptTris: [number, number, number][] = []
  const keptUvs: [number, number, number][] = []
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i]!
    if (bad[tri[0]] || bad[tri[1]] || bad[tri[2]]) continue
    keptTris.push(tri)
    if (triangleUvs) keptUvs.push(triangleUvs[i]!)
  }
  if (keptTris.length < Math.max(4, Math.floor(triangles.length * 0.2))) {
    return { positions, triangles, triangleUvs }
  }

  const used = new Uint8Array(positions.length)
  for (const [a, b, c] of keptTris) {
    used[a] = 1
    used[b] = 1
    used[c] = 1
  }
  const remap = new Int32Array(positions.length).fill(-1)
  const newPos: Vec3[] = []
  for (let i = 0; i < positions.length; i++) {
    if (!used[i] || bad[i]) continue
    remap[i] = newPos.length
    newPos.push(positions[i]!)
  }
  const remappedTris: [number, number, number][] = []
  const remappedUvs: [number, number, number][] = []
  for (let i = 0; i < keptTris.length; i++) {
    const [a, b, c] = keptTris[i]!
    const na = remap[a]!
    const nb = remap[b]!
    const nc = remap[c]!
    if (na < 0 || nb < 0 || nc < 0) continue
    remappedTris.push([na, nb, nc])
    if (triangleUvs) remappedUvs.push(keptUvs[i]!)
  }
  if (remappedTris.length < Math.max(4, Math.floor(triangles.length * 0.2))) {
    return { positions, triangles, triangleUvs }
  }
  return {
    positions: newPos,
    triangles: remappedTris,
    triangleUvs: triangleUvs ? remappedUvs : null,
  }
}

function applyMatrix(positions: Vec3[], m: number[]): Vec3[] {
  return positions.map((p) => xformPoint(m, p))
}

/** True when the AABB is a half-mesh abutting X=0 (not a prop floating in +X). */
function shouldMirrorDuplicateX(box: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 }): boolean {
  const span = box.size[0]
  if (span < 1e-4) return false
  const eps = Math.max(span * 0.05, 1e-3)
  const allPos = box.min[0] >= -eps
  const allNeg = box.max[0] <= eps
  if (!allPos && !allNeg) return false
  // Half-bodies centered near span/2 from the origin; floating props fail this.
  if (Math.abs(Math.abs(box.center[0]) - span / 2) <= span * 0.28) return true
  // Thin slabs flush to X=0 (half-meshes / mirrored parts).
  const tall = Math.max(box.size[1], box.size[2])
  const isThinSlab = span < tall * 0.55
  const distTo0 = allPos ? box.min[0] : -box.max[0]
  if (isThinSlab && distTo0 <= Math.max(span * 0.9, 1.5) && Math.abs(box.center[0]) < tall * 0.65) {
    return true
  }
  return false
}

/**
 * Duplicate a half-mesh across X=0 when geometry sits entirely on one side of
 * the mirror plane (common Maya symmetry / instance setups we don't evaluate).
 * Welds the X=0 seam afterward so mirrored hair/body halves don't leave a slit.
 */
function mirrorDuplicateX(
  positions: Vec3[],
  triangles: [number, number, number][],
  triangleUvs: [number, number, number][] | null,
): { positions: Vec3[]; triangles: [number, number, number][]; triangleUvs: [number, number, number][] | null } {
  if (positions.length < 3 || triangles.length < 1) {
    return { positions, triangles, triangleUvs }
  }
  const box = aabbOf(positions)
  if (!shouldMirrorDuplicateX(box)) return { positions, triangles, triangleUvs }

  const base = positions.length
  const mirroredPos = positions.map((p): Vec3 => [-p[0], p[1], p[2]])
  const newPos = positions.concat(mirroredPos)
  const newTris: [number, number, number][] = triangles.slice()
  for (const [a, b, c] of triangles) {
    // Flip winding so normals stay outward after the X flip.
    newTris.push([base + a, base + c, base + b])
  }
  let newUvs = triangleUvs
  if (triangleUvs) {
    newUvs = triangleUvs.concat(
      triangleUvs.map((t): [number, number, number] => [t[0], t[2], t[1]]),
    )
  }
  // Seam verts at X≈0 now exist twice — weld so the halves share edges.
  return weldCoincidentVertices(newPos, newTris, newUvs, 1e-4)
}

/**
 * Place mesh verts into world space using the Maya DAG.
 *
 * Default: `worldMatrixFor(parent)` (bind-pose aware). Falls back to alternate
 * parent resolutions only when the default result is pathological vs the primary
 * mesh AABB (including orphaned-pivot keep-transform cases).
 */
function placeMeshInWorld(
  positions: Vec3[],
  parentName: string,
  dag: Map<string, DagNode>,
  worldCache: Map<string, number[]>,
  primary: Vec3[] | null,
): Vec3[] {
  if (!parentName || positions.length === 0) return positions
  const parent = dag.get(parentName) ?? dag.get(shortNodeName(parentName))
  if (!parent) return positions

  const primaryBox = primary && primary.length > 0 ? aabbOf(primary) : null
  const primaryExtent = primaryBox ? maxExtent(primaryBox.size) : 0
  const localBox = aabbOf(positions)
  const localExtent = maxExtent(localBox.size)

  // Verts already authored in world / parent space: parent xform ~ identity and
  // the cloud sits far from the origin relative to its own size (common for
  // history-baked prop meshes under a null transform).
  const parentLocal = localMatrix(parent)
  if (nearIdentityMatrix(parentLocal) && centroidMag(localBox.center) > Math.max(localExtent * 0.35, 1)) {
    return positions
  }

  const candidates: { label: string; m: number[] }[] = []
  candidates.push({ label: 'full', m: worldMatrixFor(parentName, dag, worldCache) })

  const twin =
    bindPoseTwinName(parentName) ??
    (parent.parent ? bindPoseTwinName(parent.parent) : null) ??
    null
  let twinWorld: number[] | null = null
  if (twin && dag.has(twin)) {
    twinWorld = worldMatrixFor(twin, dag, worldCache)
    candidates.push({
      label: 'localOnTwin',
      m: matMul4(localMatrix(parent), twinWorld),
    })
  }
  // Walk up for a bind-pose ancestor (joint.bps) and parent local under it.
  let walk: string | undefined = parent.parent
  for (let i = 0; i < 12 && walk; i++) {
    const n = dag.get(walk)
    if (!n) break
    if (n.bps && n.bps.length === 16) {
      candidates.push({
        label: `localOnBps:${walk}`,
        m: matMul4(localMatrix(parent), n.bps),
      })
      if (!twinWorld) twinWorld = n.bps
      break
    }
    const tw = bindPoseTwinName(walk)
    if (tw && dag.get(tw)?.bps) {
      const twM = worldMatrixFor(tw, dag, worldCache)
      candidates.push({
        label: `localOnTwinWalk:${tw}`,
        m: matMul4(localMatrix(parent), twM),
      })
      if (!twinWorld) twinWorld = twM
      break
    }
    walk = n.parent
  }

  // FK control pivots are often authored for a constrained parent. When the full
  // local stack blows up under a bind-pose substitute, R·T(rp) under the twin is
  // a stable Autodesk-style fallback (rotate about rotatePivot, then parent).
  if (twinWorld) {
    const R = eulerRadMat(parent.r[0], parent.r[1], parent.r[2], parent.ro)
    candidates.push({
      label: 'R_rp_onTwin',
      m: matMul4(matMul4(R, translationMat(parent.rp)), twinWorld),
    })
    candidates.push({
      label: 'rp_onTwin',
      m: matMul4(translationMat(parent.rp), twinWorld),
    })
  }

  const scorePlaced = (placed: Vec3[]): number => {
    const box = aabbOf(placed)
    const ext = maxExtent(box.size)
    const scaleRatio = localExtent > 1e-6 ? ext / localExtent : 1
    if (!primaryBox) {
      const scalePenalty = scaleRatio > 3 || scaleRatio < 0.2 ? -10 : 0
      return centroidMag(box.center) * 0.01 + scalePenalty
    }
    let score = aabbOverlapScore(box, primaryBox)
    const ratio = ext / Math.max(primaryExtent, 1e-3)
    if (ratio > 2) score -= (ratio - 2) * 2
    if (ratio > 5) score -= 20
    if (scaleRatio > 2.5) score -= (scaleRatio - 2.5) * 4
    const dims = [...box.size].sort((a, b) => b - a)
    if (dims[0]! > dims[1]! * 10) score -= 15
    const dist = Math.hypot(
      box.center[0] - primaryBox.center[0],
      box.center[1] - primaryBox.center[1],
      box.center[2] - primaryBox.center[2],
    )
    if (dist > primaryExtent * 3) score -= 8
    return score
  }

  let best = applyMatrix(positions, candidates[0]!.m)
  let bestScore = scorePlaced(best)
  const bestBox = aabbOf(best)
  const scaleBlowup = localExtent > 1e-6 && maxExtent(bestBox.size) / localExtent > 2.5
  const distToPrimary = primaryBox
    ? Math.hypot(
        bestBox.center[0] - primaryBox.center[0],
        bestBox.center[1] - primaryBox.center[1],
        bestBox.center[2] - primaryBox.center[2],
      )
    : 0
  // Keep-transform / pivot orphan: geometry left near the origin while rotatePivot
  // sits on the character. The composed world matrix often cancels to ~I, which is
  // plug-accurate but not where the pivot says the object lives — fall through.
  const orphanedPivot =
    !!primaryBox &&
    centroidMag(parent.rp) > Math.max(localExtent * 1.5, 10) &&
    centroidMag(localBox.center) < Math.max(localExtent * 0.6, 5) &&
    centroidMag(bestBox.center) < Math.max(primaryExtent * 0.2, 5)
  const defaultOk =
    !scaleBlowup &&
    !orphanedPivot &&
    (!primaryBox ||
      (maxExtent(bestBox.size) / Math.max(primaryExtent, 1e-3) < 2.5 &&
        distToPrimary < primaryExtent * 1.15 &&
        bestBox.center[1] <= primaryBox.max[1] + primaryExtent * 0.25 &&
        bestBox.center[1] >= primaryBox.min[1] - primaryExtent * 0.15))

  // Trust the default DAG matrix when it looks sane.
  if (defaultOk) return best

  for (let i = 1; i < candidates.length; i++) {
    const placed = applyMatrix(positions, candidates[i]!.m)
    // Skip candidates that explode local scale — common when FK local stacks
    // are multiplied onto a bind-pose substitute.
    const ext = maxExtent(aabbOf(placed).size)
    if (localExtent > 1e-6 && ext / localExtent > 3) continue
    const score = scorePlaced(placed)
    if (score > bestScore) {
      bestScore = score
      best = placed
    }
  }

  // FK/bind mismatch / orphaned rotate-pivot: keep local shape, move AABB center
  // to the parent's rotate pivot (world-ish or bind-space). Works even without a
  // bind-pose twin — common for props under a plain `geometry` group.
  {
    const box = aabbOf(positions)
    const targets: Vec3[] = []
    if (centroidMag(parent.rp) > 1e-4) targets.push(parent.rp)
    if (twinWorld) targets.push(xformPoint(twinWorld, parent.rp))
    if (centroidMag(parent.t) > Math.max(localExtent, 5)) targets.push(parent.t)
    const shouldTryPivot =
      orphanedPivot ||
      (centroidMag(parent.rp) > Math.max(localExtent * 1.5, 10) &&
        centroidMag(localBox.center) < Math.max(localExtent * 0.6, 5))
    if (shouldTryPivot || twinWorld) {
      const R = eulerRadMat(parent.r[0], parent.r[1], parent.r[2], parent.ro)
      const matrixStillBad =
        localExtent > 1e-6 && maxExtent(aabbOf(best).size) / localExtent > 2.5
      for (const target of targets) {
        const pivoted = positions.map(
          (p): Vec3 => [
            p[0] - box.center[0] + target[0],
            p[1] - box.center[1] + target[1],
            p[2] - box.center[2] + target[2],
          ],
        )
        const rotated = applyMatrix(
          pivoted.map(
            (p): Vec3 => [p[0] - target[0], p[1] - target[1], p[2] - target[2]],
          ),
          R,
        ).map((p): Vec3 => [p[0] + target[0], p[1] + target[1], p[2] + target[2]])
        for (const candidate of [pivoted, rotated]) {
          let score = scorePlaced(candidate)
          if (matrixStillBad || shouldTryPivot) score += 5
          if (score > bestScore) {
            bestScore = score
            best = candidate
          }
        }
      }
    }
  }

  return best
}

/**
 * Merge vertices that share the same position (common on mirrored hair shells
 * authored as two halves). Remaps triangle indices; UV corners are unchanged.
 */
function weldCoincidentVertices(
  positions: Vec3[],
  triangles: [number, number, number][],
  triangleUvs: [number, number, number][] | null,
  eps = 1e-4,
): { positions: Vec3[]; triangles: [number, number, number][]; triangleUvs: [number, number, number][] | null } {
  if (positions.length < 8 || triangles.length < 4) {
    return { positions, triangles, triangleUvs }
  }
  const quant = Math.max(eps, 1e-6)
  const keyOf = (p: Vec3) =>
    `${Math.round(p[0] / quant)}|${Math.round(p[1] / quant)}|${Math.round(p[2] / quant)}`
  const remap = new Int32Array(positions.length).fill(-1)
  const welded: Vec3[] = []
  const buckets = new Map<string, number>()
  let merged = 0
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!
    const key = keyOf(p)
    const existing = buckets.get(key)
    if (existing !== undefined) {
      remap[i] = existing
      merged += 1
      continue
    }
    const ni = welded.length
    buckets.set(key, ni)
    remap[i] = ni
    welded.push([p[0], p[1], p[2]])
  }
  if (merged < 2) return { positions, triangles, triangleUvs }

  const newTris: [number, number, number][] = []
  const newTriUvs: [number, number, number][] | null = triangleUvs ? [] : null
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]!
    const a = remap[t[0]!]!
    const b = remap[t[1]!]!
    const c = remap[t[2]!]!
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue
    newTris.push([a, b, c])
    if (newTriUvs && triangleUvs) newTriUvs.push(triangleUvs[i]!)
  }
  if (newTris.length < 4) return { positions, triangles, triangleUvs }
  return { positions: welded, triangles: newTris, triangleUvs: newTriUvs }
}

/**
 * Fan-fill small open boundary loops. Approximates unevaluated Maya
 * `polyCloseBorder` / `polyAppend` history — leaves large seams (half-meshes)
 * alone so `mirrorDuplicateX` can still run.
 */
function closeSmallOpenBorders(
  positions: Vec3[],
  triangles: [number, number, number][],
  triangleUvs: [number, number, number][] | null,
  uvs?: Vec2[],
): {
  positions: Vec3[]
  triangles: [number, number, number][]
  triangleUvs: [number, number, number][] | null
  uvs?: Vec2[]
} {
  if (positions.length < 8 || triangles.length < 4) {
    return { positions, triangles, triangleUvs, uvs }
  }

  const edgeCount = new Map<string, number>()
  // Directed half-edge → owning triangle + start-corner slot (for winding + UVs).
  const halfEdge = new Map<string, { tri: number; slot: number }>()
  const bump = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
  }
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i]!
    if (a === b || b === c || a === c) continue
    bump(a, b)
    bump(b, c)
    bump(c, a)
    halfEdge.set(`${a}>${b}`, { tri: i, slot: 0 })
    halfEdge.set(`${b}>${c}`, { tri: i, slot: 1 })
    halfEdge.set(`${c}>${a}`, { tri: i, slot: 2 })
  }
  const adj = new Map<number, number[]>()
  for (const [k, n] of edgeCount) {
    if (n !== 1) continue
    const [a, b] = k.split('_').map(Number) as [number, number]
    ;(adj.get(a) ?? (adj.set(a, []), adj.get(a)!)).push(b)
    ;(adj.get(b) ?? (adj.set(b, []), adj.get(b)!)).push(a)
  }
  if (adj.size < 3) return { positions, triangles, triangleUvs, uvs }

  const seen = new Set<number>()
  const loops: number[][] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    // Walk a closed boundary cycle (degree-2 graph).
    const loop: number[] = [start]
    seen.add(start)
    let prev = -1
    let cur = start
    for (;;) {
      const nbrs = adj.get(cur) ?? []
      const next = nbrs.find((n) => n !== prev && (!seen.has(n) || n === start))
      if (next === undefined) break
      if (next === start) {
        loops.push(loop)
        break
      }
      loop.push(next)
      seen.add(next)
      prev = cur
      cur = next
      if (loop.length > 10_000) break
    }
  }

  // Median native UV edge length: caps spanning much more straddle UV shells.
  let uvLimit = Infinity
  if (triangleUvs && uvs && uvs.length > 0) {
    const spans: number[] = []
    const step = Math.max(1, Math.floor(triangles.length / 500))
    for (let i = 0; i < triangles.length; i += step) {
      const t = triangleUvs[i]
      if (!t) continue
      let m = 0
      for (let k = 0; k < 3; k++) {
        const p = uvs[t[k]!]
        const q = uvs[t[(k + 1) % 3]!]
        if (!p || !q) continue
        m = Math.max(m, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]))
      }
      spans.push(m)
    }
    spans.sort((x, y) => x - y)
    uvLimit = Math.max((spans[Math.floor(spans.length / 2)] ?? 0) * 12, 0.05)
  }

  const maxLoop = Math.min(32, Math.max(8, Math.floor(positions.length * 0.008)))
  // Compact holes (scalp caps, hair underside) can exceed the small-loop cap
  // without being half-body mirror seams — allow those when spatially tight.
  const maxCompactLoop = Math.min(160, Math.max(96, Math.floor(positions.length * 0.08)))
  let meshExt = 0
  {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity
    for (const p of positions) {
      minX = Math.min(minX, p[0])
      minY = Math.min(minY, p[1])
      minZ = Math.min(minZ, p[2])
      maxX = Math.max(maxX, p[0])
      maxY = Math.max(maxY, p[1])
      maxZ = Math.max(maxZ, p[2])
    }
    meshExt = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6)
  }
  const newTris: [number, number, number][] = []
  const newUvs: [number, number, number][] = []

  // Compact holes (scalp caps) can exceed the small-loop cap without being
  // half-body mirror seams — allow those when spatially tight / planar.
  // Do NOT fill large non-planar hair shell rims: those wrap the face opening
  // and a centroid membrane caves in the forehead.
  const maybeAccessory =
    positions.length <= 2800 && triangles.length <= 5000 && loops.length >= 1 && loops.length <= 4

  let filled = 0
  for (const raw of loops) {
    if (raw.length < 3 || raw.length > maxCompactLoop) continue
    if (raw.length > maxLoop) {
      let lMinX = Infinity,
        lMinY = Infinity,
        lMinZ = Infinity
      let lMaxX = -Infinity,
        lMaxY = -Infinity,
        lMaxZ = -Infinity
      for (const vi of raw) {
        const p = positions[vi]
        if (!p) continue
        lMinX = Math.min(lMinX, p[0])
        lMinY = Math.min(lMinY, p[1])
        lMinZ = Math.min(lMinZ, p[2])
        lMaxX = Math.max(lMaxX, p[0])
        lMaxY = Math.max(lMaxY, p[1])
        lMaxZ = Math.max(lMaxZ, p[2])
      }
      const sx = lMaxX - lMinX
      const sy = lMaxY - lMinY
      const sz = lMaxZ - lMinZ
      const loopExt = Math.max(sx, sy, sz)
      const thin = Math.min(sx, sy, sz)
      const compact = loopExt <= meshExt * 0.3
      const planarCap =
        maybeAccessory &&
        loopExt <= meshExt * 0.55 &&
        thin <= meshExt * 0.12 &&
        thin / Math.max(loopExt, 1e-6) < 0.22
      if (!compact && !planarCap) continue
    }
    // Boundary face owns the half-edge one way; a consistent cap walks the other.
    let sameDir = 0
    let oppDir = 0
    for (let i = 0; i < raw.length; i++) {
      const u = raw[i]!
      const v = raw[(i + 1) % raw.length]!
      if (halfEdge.has(`${u}>${v}`)) sameDir += 1
      if (halfEdge.has(`${v}>${u}`)) oppDir += 1
    }
    const loop = sameDir > oppDir ? [raw[0]!, ...raw.slice(1).reverse()] : raw

    let luv: number[] = []
    if (triangleUvs) {
      luv = loop.map((v, i) => {
        const w = loop[(i + 1) % loop.length]!
        const owner = halfEdge.get(`${w}>${v}`)
        return owner ? triangleUvs[owner.tri]![(owner.slot + 1) % 3]! : 0
      })
      if (uvs && uvs.length > 0) {
        let minU = Infinity
        let maxU = -Infinity
        let minV = Infinity
        let maxV = -Infinity
        for (const idx of luv) {
          const p = uvs[idx]
          if (!p) continue
          minU = Math.min(minU, p[0])
          maxU = Math.max(maxU, p[0])
          minV = Math.min(minV, p[1])
          maxV = Math.max(maxV, p[1])
        }
        if (maxU - minU > uvLimit || maxV - minV > uvLimit) luv = luv.map(() => luv[0]!)
      }
    }

    // Fan from the loop centroid for large shell rims — a single corner fan folds
    // badly across non-planar hair openings and leaves see-through pockets.
    const useCentroid = loop.length > maxLoop
    let hub = loop[0]!
    let hubUv = luv[0] ?? 0
    if (useCentroid) {
      let cx = 0,
        cy = 0,
        cz = 0,
        n = 0
      for (const vi of loop) {
        const p = positions[vi]
        if (!p) continue
        cx += p[0]
        cy += p[1]
        cz += p[2]
        n += 1
      }
      if (n >= 3) {
        hub = positions.length
        positions.push([cx / n, cy / n, cz / n])
        if (triangleUvs && uvs) {
          let su = 0,
            sv = 0,
            un = 0
          for (const idx of luv) {
            const p = uvs[idx]
            if (!p) continue
            su += p[0]
            sv += p[1]
            un += 1
          }
          hubUv = uvs.length
          uvs.push(un > 0 ? [su / un, sv / un] : [luv[0] !== undefined ? uvs[luv[0]]![0] : 0, 0])
        }
      }
    }

    if (useCentroid && hub === loop[0]) {
      // Centroid failed — fall back to corner fan.
      for (let i = 1; i + 1 < loop.length; i++) {
        const b = loop[i]!
        const c = loop[i + 1]!
        if (hub === b || b === c || hub === c) continue
        newTris.push([hub, b, c])
        if (triangleUvs) newUvs.push([hubUv, luv[i]!, luv[i + 1]!])
        filled += 1
      }
    } else if (useCentroid) {
      for (let i = 0; i < loop.length; i++) {
        const b = loop[i]!
        const c = loop[(i + 1) % loop.length]!
        if (hub === b || b === c || hub === c) continue
        newTris.push([hub, b, c])
        if (triangleUvs) newUvs.push([hubUv, luv[i]!, luv[(i + 1) % loop.length]!])
        filled += 1
      }
    } else {
      const a = loop[0]!
      for (let i = 1; i + 1 < loop.length; i++) {
        const b = loop[i]!
        const c = loop[i + 1]!
        if (a === b || b === c || a === c) continue
        newTris.push([a, b, c])
        if (triangleUvs) newUvs.push([luv[0]!, luv[i]!, luv[i + 1]!])
        filled += 1
      }
    }
  }
  if (filled === 0) return { positions, triangles, triangleUvs, uvs }
  return {
    positions,
    triangles: triangles.concat(newTris),
    triangleUvs: triangleUvs ? triangleUvs.concat(newUvs) : null,
    uvs,
  }
}

function parseTransformGeometry(leaves: LeafChunk[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  let cur: string | null = null
  for (const leaf of leaves) {
    if (leaf.tag === 'CREA') {
      const form = leaf.formStack[leaf.formStack.length - 1] ?? ''
      cur = form === 'TGEO' ? shortNodeName(decodeCString(leaf.payload, 1).text) : null
      continue
    }
    if (!cur || leaf.tag !== 'MATR') continue
    const attr = parseAttrPayload(leaf.payload)
    if (attr?.name === 'txf' && attr.body.length >= 128) {
      out.set(cur, readBeDoubles(attr.body).slice(0, 16))
    }
  }
  return out
}

/**
 * Product of every `transformGeometry.txf` between an intermediate shape and the
 * shape that renders it. Maya bakes these into the geometry stream, so the DAG
 * transform alone leaves such meshes at the wrong place.
 */
function historyGeometryMatrix(
  shape: string,
  txfByNode: Map<string, number[]>,
  connections: { src: string; dst: string }[],
  shapeNames: Set<string>,
): number[] | null {
  if (txfByNode.size === 0) return null
  const outgoing = new Map<string, string[]>()
  for (const { src, dst } of connections) {
    const s = shortNodeName(nodeFromPlug(src))
    const d = shortNodeName(nodeFromPlug(dst))
    if (s === d) continue
    const arr = outgoing.get(s) ?? []
    arr.push(d)
    outgoing.set(s, arr)
  }
  const stack: { node: string; m: number[]; depth: number }[] = [
    { node: shape, m: [...MAT_I16], depth: 0 },
  ]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const { node, m, depth } = stack.pop()!
    if (depth > 24) continue
    for (const next of outgoing.get(node) ?? []) {
      const txf = txfByNode.get(next)
      const acc = txf ? matMul4(m, txf) : m
      if (next !== shape && shapeNames.has(next)) {
        if (!nearIdentityMatrix(acc)) return acc
        continue
      }
      const key = `${next}|${depth}`
      if (seen.has(key)) continue
      seen.add(key)
      stack.push({ node: next, m: acc, depth: depth + 1 })
    }
  }
  return null
}

function extractMeshesFromBinary(bytes: Uint8Array, warnings: string[]): {
  meshes: ExtractedMesh[]
  textureHints: string[]
  mayaVersion: string | null
  container: string
  nativeSkin: MayaNativeSkin | null
} {
  const { version, leaves, mayaVersion } = parseIffLeaves(bytes)
  const textureHints = collectTextureHints(leaves)
  const dag = parseDagNodes(leaves)
  const txfByNode = parseTransformGeometry(leaves)
  const sceneConnections = parseSceneConnections(leaves)
  const worldCache = new Map<string, number[]>()
  const meshes: ExtractedMesh[] = []

  // Group leaves under DMSH forms.
  type NodeAcc = {
    name: string
    parent: string
    leaves: LeafChunk[]
    intermediate: boolean
  }
  const meshNodes: NodeAcc[] = []
  let current: NodeAcc | null = null
  const shapesByParent = new Map<string, string[]>()

  for (const leaf of leaves) {
    const inDmsh = leaf.formStack.includes('DMSH')
    if (!inDmsh) {
      current = null
      continue
    }
    if (leaf.tag === 'CREA') {
      const { text, next } = decodeCString(leaf.payload, 1)
      const parentRaw = next < leaf.payload.length ? decodeCString(leaf.payload, next).text : ''
      const name = shortNodeName(text || `mesh_${meshNodes.length}`)
      const parent = shortNodeName(parentRaw)
      current = { name, parent, leaves: [], intermediate: false }
      meshNodes.push(current)
      if (parent) {
        const arr = shapesByParent.get(parent) ?? []
        if (!arr.includes(name)) arr.push(name)
        shapesByParent.set(parent, arr)
      }
      continue
    }
    if (!current) continue
    if (leaf.tag === 'DBLE') {
      const attr = parseAttrPayload(leaf.payload)
      if (attr?.name === 'io' && attr.body.length >= 8) {
        const v = new DataView(attr.body.buffer, attr.body.byteOffset, attr.body.byteLength)
        current.intermediate = v.getFloat64(0, false) !== 0
      }
    }
    current.leaves.push(leaf)
  }

  type RawMesh = {
    name: string
    parent: string
    intermediate: boolean
    positions: Vec3[]
    uvs: Vec2[]
    triangles: [number, number, number][]
    triangleUvs: [number, number, number][] | null
    /** When set, overrides shading-graph lookup (per-face material split). */
    binding?: ShaderBinding
  }
  const rawMeshes: RawMesh[] = []

  const pushRaw = (
    name: string,
    parent: string,
    intermediate: boolean,
    positions: Vec3[],
    uvs: Vec2[],
    triangles: [number, number, number][],
    triangleUvs: [number, number, number][] | null,
    binding?: ShaderBinding,
  ) => {
    if (triangles.length < 1 || positions.length < 3) return
    rawMeshes.push({ name, parent, intermediate, positions, uvs, triangles, triangleUvs, binding })
  }

  for (const node of meshNodes) {
    const meshLeaf = node.leaves.find((l) => l.tag === 'MESH')
    if (!meshLeaf) continue
    const parsed = parseAttrPayload(meshLeaf.payload)
    if (!parsed) continue
    const extracted = extractVerticesAndFaces(parsed.body)
    if (!extracted || extracted.positions.length < 3) {
      warnings.push(`Skipped ${node.name}: no baked vertex data in MESH plug`)
      continue
    }
    if (extracted.triangles.length < 1) {
      warnings.push(`Skipped ${node.name}: found ${extracted.positions.length} verts but no faces`)
      continue
    }

    let uvs: Vec2[] = []
    let ptDense: { start: number; deltas: Vec3[] } | null = null
    const ptSparse: { index: number; delta: Vec3 }[] = []
    for (const leaf of node.leaves) {
      if (leaf.tag === 'FLT2') {
        const attr = parseAttrPayload(leaf.payload)
        if (!attr || !/uvsp/i.test(attr.name)) continue
        const floats = readBeFloats(attr.body)
        for (let i = 0; i + 1 < floats.length; i += 2) {
          uvs.push([floats[i]!, floats[i + 1]!])
        }
      } else if (leaf.tag === 'FLT3') {
        const attr = parseAttrPayload(leaf.payload)
        if (!attr) continue
        const range = attr.name.match(/^pt\[(\d+):(\d+)\]$/)
        const one = attr.name.match(/^pt\[(\d+)\]$/)
        if (range) {
          const floats = readBeFloats(attr.body)
          const deltas: Vec3[] = []
          for (let i = 0; i + 2 < floats.length; i += 3) {
            deltas.push([floats[i]!, floats[i + 1]!, floats[i + 2]!])
          }
          if (deltas.length > 0) ptDense = { start: Number(range[1]), deltas }
        } else if (one) {
          const floats = readBeFloats(attr.body)
          if (floats.length >= 3) {
            ptSparse.push({
              index: Number(one[1]),
              delta: [floats[0]!, floats[1]!, floats[2]!],
            })
          }
        }
      }
    }

    let evaluated = applyPntsTweak(extracted.positions, ptDense, ptSparse)
    const historyMat = historyGeometryMatrix(
      node.name,
      txfByNode,
      sceneConnections,
      new Set(meshNodes.map((m) => m.name)),
    )
    if (historyMat) evaluated = applyMatrix(evaluated, historyMat)

    let triangles = extracted.triangles
    let triangleFaceIds = extracted.triangleFaceIds
    let triangleUvs: [number, number, number][] | null = null
    if (uvs.length > 0) {
      const view = new DataView(
        parsed.body.buffer,
        parsed.body.byteOffset,
        parsed.body.byteLength,
      )
      const searchFrom = Math.max(0, extracted.afterFaces - 16)
      const uvStream = findUvConnectStream(
        view,
        parsed.body.byteLength,
        extracted.nConnects,
        uvs.length - 1,
        searchFrom,
      )
      if (uvStream) {
        const mapped = mapFaceLoopsToTriangleUvs(extracted.faceLoops, uvStream)
        if (mapped && mapped.triangles.length === extracted.triangles.length) {
          triangles = mapped.triangles
          triangleUvs = mapped.triangleUvs
          // Rebuild face ids from face loops to match remapped triangulation.
          const ids: number[] = []
          for (let fi = 0; fi < extracted.faceLoops.length; fi++) {
            for (const _ of triangulateFace(extracted.faceLoops[fi]!)) ids.push(fi)
          }
          if (ids.length === triangles.length) triangleFaceIds = ids
        }
      }
    }

    let partitions = collectFaceMaterialPartitions(
      leaves,
      node.name,
      node.parent,
      shapesByParent,
    ).filter((p) => p.ranges.length > 0)
    // groupParts face indices are relative to DG topology at that point; trust
    // them only when they exactly partition the baked face list.
    if (partitions.some((p) => p.rangesFrom === 'groupParts')) {
      const faceCount = extracted.faceLoops.length
      const cover = new Map<number, number>()
      let maxIdx = -1
      for (const p of partitions) {
        for (const [a, b] of p.ranges) {
          for (let f = Math.min(a, b); f <= Math.max(a, b); f++) {
            cover.set(f, (cover.get(f) ?? 0) + 1)
            if (f > maxIdx) maxIdx = f
          }
        }
      }
      let ok = maxIdx < faceCount && cover.size === faceCount
      if (ok) {
        for (const [, n] of cover) {
          if (n > 1) {
            ok = false
            break
          }
        }
      }
      if (!ok) {
        warnings.push(
          `${node.name}: ignoring groupParts face assignment (${cover.size} faces indexed up to ${maxIdx} for ${faceCount} baked faces)`,
        )
        partitions = partitions.filter((p) => p.rangesFrom !== 'groupParts')
      }
    }
    // Merge face groups that share the same shader binding.
    const merged = new Map<string, FaceMaterialPartition>()
    for (const p of partitions) {
      const key = `${p.binding.textureFileName ?? ''}|${p.binding.color.map((c) => c.toFixed(4)).join(',')}`
      const existing = merged.get(key)
      if (existing) existing.ranges.push(...p.ranges)
      else merged.set(key, { binding: p.binding, ranges: [...p.ranges], rangesFrom: p.rangesFrom })
    }
    const mergedParts = [...merged.values()]
    if (mergedParts.length >= 2 && triangleFaceIds.length === triangles.length) {
      let partIdx = 0
      for (const part of mergedParts) {
        const keptTri: [number, number, number][] = []
        const keptUv: [number, number, number][] = []
        for (let i = 0; i < triangles.length; i++) {
          if (!faceInRanges(triangleFaceIds[i]!, part.ranges)) continue
          keptTri.push(triangles[i]!)
          if (triangleUvs) keptUv.push(triangleUvs[i]!)
        }
        if (keptTri.length < 1) continue
        partIdx += 1
        const suffix = part.binding.textureFileName
          ? basename(part.binding.textureFileName).replace(/\.[^.]+$/, '')
          : `mat${partIdx}`
        pushRaw(
          `${node.name}_${suffix}`,
          node.parent,
          node.intermediate,
          evaluated,
          uvs,
          keptTri,
          triangleUvs ? keptUv : null,
          part.binding,
        )
      }
      if (partIdx > 0) continue
    }

    pushRaw(
      node.name,
      node.parent,
      node.intermediate,
      evaluated,
      uvs,
      triangles,
      triangleUvs,
    )
  }

  // When both the render shape and intermediateObject carry MESH data under the
  // same transform, keep the non-intermediate. Per-face material splits (explicit
  // binding) always stay — they share a parent on purpose.
  const byParent = new Map<string, RawMesh[]>()
  for (const raw of rawMeshes) {
    const key = raw.parent || raw.name
    const arr = byParent.get(key) ?? []
    arr.push(raw)
    byParent.set(key, arr)
  }
  const deduped: RawMesh[] = []
  for (const group of byParent.values()) {
    const splits = group.filter((g) => g.binding)
    const plain = group.filter((g) => !g.binding)
    if (splits.length > 0) {
      deduped.push(...splits)
      continue
    }
    if (plain.length === 1) {
      deduped.push(plain[0]!)
      continue
    }
    const nonIo = plain.filter((g) => !g.intermediate)
    const pool = nonIo.length > 0 ? nonIo : plain
    pool.sort((a, b) => {
      const ca = centroidMag(aabbOf(a.positions).center)
      const cb = centroidMag(aabbOf(b.positions).center)
      if (Math.abs(ca - cb) > 1) return cb - ca
      return b.triangles.length - a.triangles.length
    })
    deduped.push(pool[0]!)
  }

  // Scrub spike verts after `.pt`. Open-border fill runs AFTER mirrorDuplicateX
  // so half-mesh center seams can weld shut first (hair shells).
  const cleaned = deduped.map((raw) => {
    const scrubbed = scrubOutlierTriangles(raw.positions, raw.triangles, raw.triangleUvs)
    const welded = weldCoincidentVertices(
      scrubbed.positions,
      scrubbed.triangles,
      scrubbed.triangleUvs,
    )
    return {
      ...raw,
      positions: welded.positions,
      triangles: welded.triangles,
      triangleUvs: welded.triangleUvs,
    }
  })

  // Primary = largest mesh (by triangle count, then extent) for placement reference.
  let primaryIdx = -1
  let primaryScore = -Infinity
  for (let i = 0; i < cleaned.length; i++) {
    const raw = cleaned[i]!
    const ext = maxExtent(aabbOf(raw.positions).size)
    const tris = raw.triangles.length
    const score = tris * 10 + ext
    if (score > primaryScore) {
      primaryScore = score
      primaryIdx = i
    }
  }

  let primaryWorld: Vec3[] | null = null
  let primaryTris: [number, number, number][] | null = null
  let primaryTriUvs: [number, number, number][] | null = null
  if (primaryIdx >= 0) {
    const prim = cleaned[primaryIdx]!
    const placed = prim.parent
      ? placeMeshInWorld(prim.positions, prim.parent, dag, worldCache, null)
      : prim.positions
    const mirrored = mirrorDuplicateX(placed, prim.triangles, prim.triangleUvs)
    primaryWorld = mirrored.positions
    primaryTris = mirrored.triangles
    primaryTriUvs = mirrored.triangleUvs
    // Keep cleaned primary in sync so the emit loop uses mirrored topology.
    cleaned[primaryIdx] = {
      ...prim,
      positions: mirrored.positions,
      triangles: mirrored.triangles,
      triangleUvs: mirrored.triangleUvs,
    }
  }

  const meshParents = new Map(cleaned.map((m) => [m.name, m.parent] as const))
  const materials = resolveMeshMaterials(
    leaves,
    cleaned.map((m) => m.name),
    meshParents,
    shapesByParent,
    textureHints,
  )
  // Per-face splits carry their shadingEngine binding already.
  for (const raw of cleaned) {
    if (raw.binding) materials.set(raw.name, raw.binding)
  }
  // If a mesh got only the generic fallback, copy a sibling's explicit SG binding
  // under the same transform (intermediateObject / history shapes).
  for (const raw of cleaned) {
    const binding = materials.get(raw.name)
    if (!binding) continue
    const isGeneric =
      !binding.textureFileName &&
      Math.abs(binding.color[0] - 0.72) < 0.02 &&
      Math.abs(binding.color[1] - 0.74) < 0.02
    if (!isGeneric) continue
    const sibling = cleaned.find(
      (o) => o.parent === raw.parent && o.name !== raw.name && materials.has(o.name),
    )
    if (!sibling) continue
    const sib = materials.get(sibling.name)!
    const sibGeneric =
      !sib.textureFileName &&
      Math.abs(sib.color[0] - 0.72) < 0.02 &&
      Math.abs(sib.color[1] - 0.74) < 0.02
    if (!sibGeneric) materials.set(raw.name, { color: [...sib.color] as Vec3, textureFileName: sib.textureFileName })
  }

  // Place every mesh, using the largest mesh as a placement reference AABB.
  type Placed = {
    name: string
    positions: Vec3[]
    uvs: Vec2[]
    triangles: [number, number, number][]
    triangleUvs: [number, number, number][] | null
  }
  const placedMeshes: Placed[] = []

  const finishMesh = (
    name: string,
    positions: Vec3[],
    triangles: [number, number, number][],
    triangleUvs: [number, number, number][] | null,
    uvs: Vec2[],
  ): Placed => {
    const closed = closeSmallOpenBorders(positions, triangles, triangleUvs, uvs)
    return {
      name,
      positions: closed.positions,
      uvs: closed.uvs ?? uvs,
      triangles: closed.triangles,
      triangleUvs: closed.triangleUvs,
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    const raw = cleaned[i]!
    let positions: Vec3[]
    let triangles = raw.triangles
    let triangleUvs = raw.triangleUvs
    if (i === primaryIdx && primaryWorld) {
      positions = primaryWorld
      triangles = primaryTris ?? triangles
      triangleUvs = primaryTriUvs
    } else {
      positions = placeMeshInWorld(raw.positions, raw.parent, dag, worldCache, primaryWorld)
      const mirrored = mirrorDuplicateX(positions, triangles, triangleUvs)
      positions = mirrored.positions
      triangles = mirrored.triangles
      triangleUvs = mirrored.triangleUvs
    }
    placedMeshes.push(finishMesh(raw.name, positions, triangles, triangleUvs, raw.uvs))
  }

  for (const placed of placedMeshes) {
    const mat = materials.get(placed.name) ?? {
      color: [0.72, 0.74, 0.78] as Vec3,
      textureFileName: null,
    }

    meshes.push({
      name: placed.name,
      positions: placed.positions,
      uvs: placed.uvs,
      triangles: placed.triangles,
      triangleUvs: placed.triangleUvs,
      textureFileName: mat.textureFileName,
      color: mat.color,
    })
  }

  const nativeSkin = extractMayaNativeSkin(
    leaves,
    sceneConnections,
    dag,
    worldCache,
    meshes.filter((mesh) => mesh.triangles.length > 0).flatMap((mesh) => mesh.positions),
    warnings,
  )

  return { meshes, textureHints, mayaVersion, container: version, nativeSkin }
}

function parseMayaAsciiMeshes(text: string, warnings: string[]): {
  meshes: ExtractedMesh[]
  textureHints: string[]
} {
  const meshes: ExtractedMesh[] = []
  const textureHints = new Set<string>()
  const createMesh = /createNode\s+mesh\s+-n\s+"([^"]+)"/g
  const names: string[] = []
  for (const match of text.matchAll(createMesh)) names.push(match[1]!)

  for (const match of text.matchAll(/setAttr\s+".ftn"\s+-type\s+"string"\s+"([^"]+)"/g)) {
    const base = repairMojibake(basename(match[1]!.replaceAll('\\', '/'))).normalize('NFC')
    if (TEXTURE_EXT.test(base)) textureHints.add(base)
  }
  for (const match of text.matchAll(/"([^"]+\.(?:png|jpe?g|webp|bmp|gif))"/gi)) {
    textureHints.add(repairMojibake(basename(match[1]!)).normalize('NFC'))
  }

  // Prefer explicit mesh nodes; fall back to scanning all .vt blocks.
  const vtBlocks = [...text.matchAll(/setAttr\s+"[^"]*\.vt\[0:(\d+)\]"\s+-type\s+"float3"([\s\S]*?)(?=\nsetAttr|\ncreateNode|\nconnectAttr|\n[a-z]|$)/g)]
  if (vtBlocks.length === 0) {
    warnings.push('Maya ASCII: no .vt vertex arrays found')
    return { meshes, textureHints: [...textureHints] }
  }

  for (let bi = 0; bi < vtBlocks.length; bi++) {
    const block = vtBlocks[bi]!
    const lastIndex = Number(block[1])
    const floatBlob = block[2] ?? ''
    const nums = [...floatBlob.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map((m) => Number(m[0]))
    const positions: Vec3[] = []
    for (let i = 0; i + 2 < nums.length && positions.length <= lastIndex; i += 3) {
      positions.push([nums[i]!, nums[i + 1]!, nums[i + 2]!])
    }

    const triangles: [number, number, number][] = []
    // polyFaces blocks near this mesh — best-effort global scan for `f N ...`
    for (const faceMatch of text.matchAll(/\bf\s+(\d+)((?:\s+-?\d+)+)/g)) {
      const count = Number(faceMatch[1])
      const idxs = [...faceMatch[2]!.matchAll(/-?\d+/g)].map((m) => Number(m[0]))
      if (idxs.length < count || count < 3) continue
      // Maya ASCII face lines after `f` are often edge ids; when values look like vertex indices, use them.
      const verts = idxs.slice(0, count)
      if (verts.every((v) => v >= 0 && v < positions.length)) {
        for (let i = 1; i + 1 < verts.length; i++) {
          triangles.push([verts[0]!, verts[i]!, verts[i + 1]!])
        }
      }
    }

    if (positions.length < 3) continue
    if (triangles.length < 1) {
      warnings.push(`Maya ASCII mesh ${names[bi] ?? bi}: vertices found but faces could not be decoded`)
      continue
    }

    meshes.push({
      name: names[bi] ?? `mesh_${bi}`,
      positions,
      uvs: [],
      triangles,
      triangleUvs: null,
      textureFileName: pickTextureForMesh(names[bi] ?? `mesh_${bi}`, [...textureHints]),
      color: [0.72, 0.74, 0.78],
    })
  }

  return { meshes, textureHints: [...textureHints] }
}

async function meshesToObj(
  meshes: ExtractedMesh[],
  textures: Record<string, Uint8Array>,
  sourceLabel: string,
): Promise<MayaImportResult> {
  const warnings: string[] = []
  const obj = new ObjTextWriter()
  const mtlLines: string[] = ['# StructureLab Maya import', '']
  obj.line('# StructureLab Maya import')
  obj.line(`mtllib model.mtl`)

  let vBase = 1
  let vtBase = 1
  let meshCount = 0
  const usedTextures: Record<string, Uint8Array> = {}
  const prepared = await resolveTextureSiblings(
    meshes.map((mesh) => mesh.textureFileName).filter((name): name is string => Boolean(name)),
    textures,
  )

  for (const mesh of meshes) {
    if (mesh.triangles.length === 0) {
      warnings.push(`${mesh.name}: skipped (no triangles)`)
      continue
    }
    meshCount += 1
    const mtlName = sanitizeMtlName(mesh.name, `mesh_${meshCount}`)
    obj.line(`o ${mtlName}`)
    obj.line(`usemtl ${mtlName}`)

    let emitUvs = mesh.uvs
    let emitTriUvs = mesh.triangleUvs

    mtlLines.push(`newmtl ${mtlName}`)
    mtlLines.push(`Kd ${mesh.color[0]} ${mesh.color[1]} ${mesh.color[2]}`)
    let wantedTex = mesh.textureFileName
    let resolved = wantedTex ? lookupPreparedTexture(wantedTex, prepared) : null
    if (!resolved) {
      const guess = pickTextureForMesh(mesh.name, Object.keys(textures))
      if (guess) {
        wantedTex = guess
        resolved = lookupPreparedTexture(guess, prepared)
        if (!resolved) {
          const picked = await pickHighestQualityTexture(guess, textures)
          if (picked) {
            resolved = {
              fileName: picked.fileName,
              bytes: picked.bytes,
              substituted: true,
            }
          }
        }
      }
    }
    if (wantedTex && resolved) {
      usedTextures[resolved.fileName.toLowerCase()] = resolved.bytes
      mtlLines.push(`map_Kd ${resolved.fileName}`)
      if (resolved.substituted) {
        warnings.push(
          `${mesh.name}: using ${resolved.fileName} for shader path ${basename(wantedTex)} (same stem, different extension)`,
        )
      }
      // Texture-guided UV repair for unevaluated projection/tweak history.
      if (/\.png$/i.test(resolved.fileName) && emitTriUvs && emitTriUvs.length === mesh.triangles.length) {
        const img = await decodePngRgbaForMaya(resolved.bytes)
        if (img) {
          const fixed = repairAtlasUvsFromTexture(
            mesh.positions,
            emitUvs,
            mesh.triangles,
            emitTriUvs,
            img,
            mesh.name,
            resolved.fileName,
          )
          if (fixed.smearedTris > 0 || fixed.limbTris > 0 || fixed.mouthUvs > 0) {
            emitUvs = fixed.uvs
            emitTriUvs = fixed.triangleUvs
            const bits: string[] = []
            if (fixed.smearedTris > 0) bits.push(`${fixed.smearedTris} smeared`)
            if (fixed.limbTris > 0) bits.push(`${fixed.limbTris} limb`)
            if (fixed.mouthUvs > 0) bits.push(`${fixed.mouthUvs} mouth`)
            warnings.push(`${mesh.name}: repaired atlas UVs (${bits.join(', ')})`)
          }
        }
      }
    } else if (mesh.textureFileName) {
      warnings.push(`${mesh.name}: texture ${mesh.textureFileName} not found beside the scene`)
    }
    mtlLines.push('')

    for (const [x, y, z] of mesh.positions) {
      obj.line(`v ${x} ${y} ${z}`)
    }
    const hasUv = emitUvs.length > 0
    if (hasUv) {
      for (const [u, v] of emitUvs) obj.line(`vt ${u} ${v}`)
    }

    const faceUvs = emitTriUvs
    const useFaceUvs =
      hasUv && faceUvs !== null && faceUvs.length === mesh.triangles.length
    for (let ti = 0; ti < mesh.triangles.length; ti++) {
      const [a, b, c] = mesh.triangles[ti]!
      const ia = vBase + a
      const ib = vBase + b
      const ic = vBase + c
      if (useFaceUvs) {
        const [ua, ub, uc] = faceUvs[ti]!
        obj.line(`f ${ia}/${vtBase + ua} ${ib}/${vtBase + ub} ${ic}/${vtBase + uc}`)
      } else if (hasUv && a < emitUvs.length && b < emitUvs.length && c < emitUvs.length) {
        // Fallback: 1:1 vert→UV (only correct when counts match).
        obj.line(`f ${ia}/${vtBase + a} ${ib}/${vtBase + b} ${ic}/${vtBase + c}`)
      } else {
        obj.line(`f ${ia} ${ib} ${ic}`)
      }
    }

    vBase += mesh.positions.length
    if (hasUv) vtBase += emitUvs.length
    await obj.flushIfNeeded()
  }

  if (meshCount === 0) {
    throw new Error(
      'No baked polygon meshes found in this Maya scene. Export to OBJ/glTF from Maya, or use a scene with evaluated mesh history.',
    )
  }

  const objBytes = await obj.finish()
  const mtlBytes = new TextEncoder().encode(mtlLines.join('\n'))
  const expectedTextureNames = [
    ...new Set(
      meshes
        .map((m) => (m.textureFileName ? basename(m.textureFileName) : null))
        .filter((n): n is string => Boolean(n)),
    ),
  ]
  return {
    objBytes,
    mtlBytes,
    textures: usedTextures,
    meshCount,
    warnings,
    sourceLabel,
    expectedTextureNames,
    nativeSkin: null,
  }
}

/**
 * Collect texture basenames referenced by a Maya scene (binary or ASCII).
 */
export function collectMayaTextureNames(bytes: Uint8Array): string[] {
  if (isMayaAscii(bytes)) {
    const text = decodeExportText(bytes)
    const found = new Set<string>()
    for (const match of text.matchAll(/[^\s"']+\.(?:png|jpe?g|webp|bmp|gif|tif|tiff|tga)/gi)) {
      found.add(repairMojibake(basename(match[0]!.replaceAll('\\', '/'))).normalize('NFC'))
    }
    return [...found]
  }
  if (detectMayaBinaryVersion(bytes)) {
    try {
      return collectTextureHints(parseIffLeaves(bytes).leaves)
    } catch {
      return []
    }
  }
  return []
}

/** Auto-load textures sitting next to a Maya scene (including a `textures/` subfolder). */
export async function autoLoadMayaSiblings(
  mayaFile: File,
  mayaBytes: Uint8Array,
  options?: {
    already?: Record<string, Uint8Array>
    droppedFiles?: File[]
    readDropped?: (file: File) => Promise<Uint8Array>
  },
): Promise<Record<string, Uint8Array>> {
  return autoLoadSidecarTextures({
    sourceFile: mayaFile,
    wanted: collectMayaTextureNames(mayaBytes),
    already: options?.already,
    droppedFiles: options?.droppedFiles,
    readDropped: options?.readDropped,
    vacuumCommonFolders: true,
  })
}

/* ── Native rig: joints and skin weights from the scene's own skinCluster ── */

type MayaSkinCluster = {
  name: string
  /** Influence slot → joint node, from `joint.worldMatrix → skinCluster.matrix[i]`. */
  jointByInfluence: Map<number, string>
  /** Influence slot → bindPreMatrix: the joint's world matrix at bind, inverted. */
  bindPreByInfluence: Map<number, number[]>
  /** Source vertex → the influences that move it. */
  weightsByVertex: Map<number, { influence: number; weight: number }[]>
  /** One past the highest weighted vertex — the skinned mesh's vertex count. */
  vertexCount: number
}

/** Inverse of a row-vector affine matrix (translation in the bottom row). */
function invertAffine(m: number[]): number[] | null {
  const a = m[0]!, b = m[1]!, c = m[2]!
  const d = m[4]!, e = m[5]!, f = m[6]!
  const g = m[8]!, h = m[9]!, i = m[10]!
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const s = 1 / det
  const out = [
    (e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, 0,
    (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, 0,
    (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s, 0,
    0, 0, 0, 1,
  ]
  const [tx, ty, tz] = [m[12]!, m[13]!, m[14]!]
  out[12] = -(tx * out[0]! + ty * out[4]! + tz * out[8]!)
  out[13] = -(tx * out[1]! + ty * out[5]! + tz * out[9]!)
  out[14] = -(tx * out[2]! + ty * out[6]! + tz * out[10]!)
  return out
}

/**
 * Read every skinCluster in the scene. Maya writes them as `FSCL` forms holding
 * `pm[i]` bind matrices and a sparse `wl[vertex].w[influence]` weight list; the
 * influence slots are wired to joints by connection, not stored inline.
 */
function parseSkinClusters(
  leaves: LeafChunk[],
  connections: { src: string; dst: string }[],
): MayaSkinCluster[] {
  const clusters: MayaSkinCluster[] = []
  const byName = new Map<string, MayaSkinCluster>()
  let cur: MayaSkinCluster | null = null

  for (const leaf of leaves) {
    if (!leaf.formStack.includes('FSCL')) {
      cur = null
      continue
    }
    if (leaf.tag === 'CREA') {
      const name = shortNodeName(decodeCString(leaf.payload, 1).text)
      cur = {
        name,
        jointByInfluence: new Map(),
        bindPreByInfluence: new Map(),
        weightsByVertex: new Map(),
        vertexCount: 0,
      }
      clusters.push(cur)
      if (name) byName.set(name, cur)
      continue
    }
    if (!cur) continue
    const attr = parseAttrPayload(leaf.payload)
    if (!attr) continue
    if (leaf.tag === 'MATR') {
      const slot = /^pm\[(\d+)\]$/.exec(attr.name)
      if (slot && attr.body.length >= 128) {
        cur.bindPreByInfluence.set(Number(slot[1]), readBeDoubles(attr.body).slice(0, 16))
      }
      continue
    }
    if (leaf.tag !== 'DBLE') continue
    // Single weight `wl[7].w[3]`, or a run `wl[7].w[3:5]`.
    const run = /^wl\[(\d+)\]\.w\[(\d+)(?::(\d+))?\]$/.exec(attr.name)
    if (!run) continue
    const vertex = Number(run[1])
    const first = Number(run[2])
    const values = readBeDoubles(attr.body)
    const entries = cur.weightsByVertex.get(vertex) ?? []
    for (let i = 0; i < values.length; i += 1) {
      const weight = values[i]!
      if (!Number.isFinite(weight) || weight <= 0) continue
      entries.push({ influence: first + i, weight })
    }
    if (entries.length > 0) cur.weightsByVertex.set(vertex, entries)
    if (vertex + 1 > cur.vertexCount) cur.vertexCount = vertex + 1
  }

  for (const { src, dst } of connections) {
    const slot = /^(.+)\.ma\[(\d+)\]$/.exec(dst)
    if (!slot) continue
    const cluster = byName.get(shortNodeName(slot[1]!))
    if (!cluster) continue
    const joint = shortNodeName(src.split('.')[0] ?? '')
    if (joint) cluster.jointByInfluence.set(Number(slot[2]), joint)
  }

  return clusters.filter((cluster) => cluster.jointByInfluence.size > 0)
}

/**
 * Turn a skinCluster's influences into a StructureLab skeleton. Joints land at
 * their bind pose (the inverse of the bindPreMatrix Maya stored), and parenting
 * follows the DAG, skipping control nodes that aren't influences themselves.
 */
function buildMayaNativeRig(
  cluster: MayaSkinCluster,
  dag: Map<string, DagNode>,
  worldCache: Map<string, number[]>,
  positions: Vec3[],
): { rig: MeshBoneRig; boneByInfluence: Map<number, number> } | null {
  const slots = [...cluster.jointByInfluence.keys()].sort((a, b) => a - b)
  const headBySlot = new Map<number, Vec3>()
  for (const slot of slots) {
    const joint = cluster.jointByInfluence.get(slot)!
    const bindPre = cluster.bindPreByInfluence.get(slot)
    const world = (bindPre ? invertAffine(bindPre) : null) ?? worldMatrixFor(joint, dag, worldCache)
    const head: Vec3 = [world[12]!, world[13]!, world[14]!]
    if (head.every((n) => Number.isFinite(n))) headBySlot.set(slot, head)
  }
  if (headBySlot.size === 0) return null

  const slotByJoint = new Map<string, number>()
  for (const slot of headBySlot.keys()) {
    slotByJoint.set(cluster.jointByInfluence.get(slot)!, slot)
  }

  // Nearest ancestor that is also an influence — rigs hang joints off control
  // groups and constraint nodes that never deform anything themselves.
  const parentSlot = new Map<number, number | null>()
  for (const slot of headBySlot.keys()) {
    let walk = dag.get(cluster.jointByInfluence.get(slot)!)?.parent ?? ''
    let found: number | null = null
    for (let depth = 0; depth < 256 && walk; depth += 1) {
      const candidate = slotByJoint.get(walk)
      if (candidate != null && candidate !== slot) {
        found = candidate
        break
      }
      walk = dag.get(walk)?.parent ?? ''
    }
    parentSlot.set(slot, found)
  }

  // Parents must precede children: the pose solver walks bones in array order.
  const ordered: number[] = []
  const placed = new Set<number>()
  const visit = (slot: number, depth: number) => {
    if (placed.has(slot) || depth > 256) return
    const parent = parentSlot.get(slot) ?? null
    if (parent != null && !placed.has(parent)) visit(parent, depth + 1)
    if (placed.has(slot)) return
    placed.add(slot)
    ordered.push(slot)
  }
  for (const slot of slots) if (headBySlot.has(slot)) visit(slot, 0)

  const childrenOf = new Map<number, number[]>()
  for (const slot of ordered) {
    const parent = parentSlot.get(slot) ?? null
    if (parent == null) continue
    const list = childrenOf.get(parent) ?? []
    list.push(slot)
    childrenOf.set(parent, list)
  }

  const box = aabbOf(positions)
  const diag = Math.hypot(box.size[0], box.size[1], box.size[2]) || 1
  const idBySlot = new Map<number, string>()
  const usedIds = new Set<string>()
  for (const slot of ordered) {
    const base = sanitizeMtlName(cluster.jointByInfluence.get(slot)!, `joint_${slot}`)
    let id = base
    for (let serial = 2; usedIds.has(id); serial += 1) id = `${base}_${serial}`
    usedIds.add(id)
    idBySlot.set(slot, id)
  }

  const bones: MeshBoneDef[] = ordered.map((slot) => {
    const head = headBySlot.get(slot)!
    const child = childrenOf.get(slot)?.[0]
    let tip: Vec3
    if (child != null) {
      tip = headBySlot.get(child)!
    } else {
      // Leaf joints (fingertips, toes) have no length of their own — carry on in
      // the direction the parent pointed so the bone still has an axis to hinge on.
      const parent = parentSlot.get(slot) ?? null
      const parentHead = parent != null ? headBySlot.get(parent) : undefined
      const dir: Vec3 = parentHead
        ? [head[0] - parentHead[0], head[1] - parentHead[1], head[2] - parentHead[2]]
        : [0, diag * 0.05, 0]
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
      const reach = Math.max(len * 0.4, diag * 0.01)
      tip = [
        head[0] + (dir[0] / len) * reach,
        head[1] + (dir[1] / len) * reach,
        head[2] + (dir[2] / len) * reach,
      ]
    }
    const length = Math.hypot(tip[0] - head[0], tip[1] - head[1], tip[2] - head[2])
    const parent = parentSlot.get(slot) ?? null
    return {
      id: idBySlot.get(slot)!,
      parent: parent != null ? idBySlot.get(parent) ?? null : null,
      label: cluster.jointByInfluence.get(slot)!,
      head: [...head] as [number, number, number],
      tip: [...tip] as [number, number, number],
      hasBend: false,
      bendT: 1,
      radius: Math.max(diag * 0.002, length * 0.12),
    }
  })

  const boneByInfluence = new Map<number, number>()
  ordered.forEach((slot, index) => boneByInfluence.set(slot, index))

  return {
    rig: {
      kind: 'native',
      bones,
      indexOf: Object.fromEntries(bones.map((bone, index) => [bone.id, index])),
      bounds: {
        min: [...box.min] as [number, number, number],
        max: [...box.max] as [number, number, number],
        center: [...box.center] as [number, number, number],
        size: [...box.size] as [number, number, number],
      },
    },
    boneByInfluence,
  }
}

/** Top four influences per vertex, normalized, in baked vertex order. */
function buildMayaNativeWeights(
  cluster: MayaSkinCluster,
  boneByInfluence: Map<number, number>,
  vertexCount: number,
): MeshBoneWeights {
  const indices = new Int16Array(vertexCount * 4).fill(-1)
  const weights = new Float32Array(vertexCount * 4)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const entries = (cluster.weightsByVertex.get(vertex) ?? [])
      .map((entry) => ({ bone: boneByInfluence.get(entry.influence), weight: entry.weight }))
      .filter((entry): entry is { bone: number; weight: number } => entry.bone != null)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
    if (total <= 0) continue
    entries.forEach((entry, slot) => {
      indices[vertex * 4 + slot] = entry.bone
      weights[vertex * 4 + slot] = entry.weight / total
    })
  }
  return { indices, weights, vertexCount }
}

/**
 * Imported weights are only usable if they line up with the mesh we baked. Maya
 * indexes them against the deformed shape, which the importer rebuilds from
 * history, so check that each vertex really does sit near the bone that claims
 * it before trusting them.
 */
function nativeWeightsLookAligned(
  positions: Vec3[],
  rig: MeshBoneRig,
  skin: MeshBoneWeights,
): boolean {
  const diag = Math.hypot(rig.bounds.size[0], rig.bounds.size[1], rig.bounds.size[2]) || 1
  const distances: number[] = []
  const step = Math.max(1, Math.floor(positions.length / 400))
  for (let vertex = 0; vertex < positions.length; vertex += step) {
    const bone = rig.bones[skin.indices[vertex * 4] ?? -1]
    if (!bone) continue
    const [x, y, z] = positions[vertex]!
    const ax = bone.head[0], ay = bone.head[1], az = bone.head[2]
    const bx = bone.tip[0] - ax, by = bone.tip[1] - ay, bz = bone.tip[2] - az
    const lenSq = bx * bx + by * by + bz * bz
    const t = lenSq > 0
      ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / lenSq))
      : 0
    distances.push(Math.hypot(x - (ax + bx * t), y - (ay + by * t), z - (az + bz * t)))
  }
  if (distances.length === 0) return false
  distances.sort((a, b) => a - b)
  return distances[Math.floor(distances.length / 2)]! < diag * 0.2
}

/** Skeleton (and weights when they map cleanly) from the scene's skinCluster. */
function extractMayaNativeSkin(
  leaves: LeafChunk[],
  connections: { src: string; dst: string }[],
  dag: Map<string, DagNode>,
  worldCache: Map<string, number[]>,
  positions: Vec3[],
  warnings: string[],
): MayaNativeSkin | null {
  const clusters = parseSkinClusters(leaves, connections)
  if (clusters.length === 0) return null
  // The cluster driving the most geometry is the character; the rest are props.
  const cluster = clusters.reduce((best, entry) =>
    entry.weightsByVertex.size > best.weightsByVertex.size ? entry : best,
  )
  if (positions.length === 0) return null

  const built = buildMayaNativeRig(cluster, dag, worldCache, positions)
  if (!built) return null
  const boneByInfluence = built.boneByInfluence
  // Bind joints can sit in a different world space than placeMeshInWorld's verts.
  const rig = alignMeshBoneRigToPositions(built.rig, positions)

  let skin: MeshBoneWeights | null = null
  if (cluster.vertexCount === positions.length) {
    const candidate = buildMayaNativeWeights(cluster, boneByInfluence, positions.length)
    if (nativeWeightsLookAligned(positions, rig, candidate)) {
      skin = candidate
    } else {
      warnings.push(
        `${cluster.name}: skin weights did not line up with the rebuilt mesh — bones kept, weights re-solved`,
      )
    }
  } else if (cluster.weightsByVertex.size > 0) {
    warnings.push(
      `${cluster.name}: mesh rebuilt from history (${positions.length} verts vs ${cluster.vertexCount} skinned) — bones kept, weights re-solved`,
    )
  }

  return { rig, skin }
}

/**
 * Read the skeleton a Maya Binary scene was rigged with, independent of geometry
 * extraction. `positions` are the baked vertices imported weights have to match.
 */
export function readMayaNativeSkin(
  bytes: Uint8Array,
  positions: [number, number, number][],
  warnings: string[] = [],
): MayaNativeSkin | null {
  if (!detectMayaBinaryVersion(bytes)) return null
  const { leaves } = parseIffLeaves(bytes)
  return extractMayaNativeSkin(
    leaves,
    parseSceneConnections(leaves),
    parseDagNodes(leaves),
    new Map<string, number[]>(),
    positions,
    warnings,
  )
}

/**
 * Convert Maya `.mb` / `.ma` bytes into OBJ + MTL + textures.
 */
export async function importMaya(
  bytes: Uint8Array,
  options: MayaImportOptions,
): Promise<MayaImportResult> {
  const onProgress = options.onProgress ?? (() => {})
  const warnings: string[] = []
  const siblings = options.siblings ?? {}

  onProgress('Detecting Maya format…')
  let meshes: ExtractedMesh[] = []
  let sourceLabel = 'Maya'
  let nativeSkin: MayaNativeSkin | null = null

  if (isMayaAscii(bytes)) {
    onProgress('Parsing Maya ASCII…')
    const text = decodeExportText(bytes)
    const parsed = parseMayaAsciiMeshes(text, warnings)
    meshes = parsed.meshes
    sourceLabel = 'Maya ASCII'
  } else if (detectMayaBinaryVersion(bytes)) {
    onProgress('Parsing Maya Binary…')
    const parsed = extractMeshesFromBinary(bytes, warnings)
    meshes = parsed.meshes
    nativeSkin = parsed.nativeSkin
    const ver = parsed.mayaVersion ? ` ${parsed.mayaVersion}` : ''
    sourceLabel = `Maya Binary ${parsed.container}${ver}`
  } else {
    throw new Error(`Not a Maya scene: ${options.fileName}`)
  }

  onProgress(`Building OBJ (${meshes.length} mesh node(s))…`)
  const result = await meshesToObj(meshes, siblings, sourceLabel)
  result.nativeSkin = nativeSkin
  const seen = new Set<string>()
  for (const w of warnings) {
    if (seen.has(w)) continue
    seen.add(w)
    result.warnings.push(w)
  }
  return result
}
