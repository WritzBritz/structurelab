/**
 * FBX ASCII 6.x and 7.x mesh reader.
 *
 * Three.js FBXLoader requires ASCII ≥ 7.0 and crashes when a Texture node has no
 * Video connection (`undefined[0]`). Older ASCII stores Vertices on Model, not
 * Geometry. This reader triangulates control points + PolygonVertexIndex so the
 * mesh still appears when textures are missing (material colour only).
 *
 * ASCII layout (Banex / Autodesk FBX 6.1):
 *   Model: "Model::name", "Mesh" { Vertices, PolygonVertexIndex, LayerElementUV }
 * FBX 7 ASCII:
 *   Geometry: id, "Geometry::name", "Mesh" { Vertices: *N { a: … } }
 *   connected to Model via C: "OO", geometryId, modelId
 */

import { decodeExportText, repairMojibake } from '../exportText'
import { basename } from '../objAssets'
import type { MeshBoneRig, MeshBoneWeights } from '../meshBoneRig'
import { decodeAsciiEmbeddedImage, findTextureBytes } from '../sidecarTextures'
import { ObjTextWriter } from '../objStream'
import {
  bindFbxSurfaces,
  fbxNodeParents,
  fbxLayerIndex,
  materialSlotSampler,
  partitionTriangles,
  pickFbxUvLayer,
  preferredUvSet,
  remapObjUvs,
  resolveAlbedoFile,
  sanitizeFbxTextureUv,
  slotMaterialId,
  type FbxConn,
  type FbxTextureRef,
} from './fbxBindings'
import {
  allClusterBones,
  buildFbxNativeRig,
  clustersForGeometry,
  finishFbxNativeSkin,
  skinFromControlPoints,
  type FbxBoneModel,
  type FbxDeformer,
} from './fbxSkin'

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i

export type FbxAsciiMesh = {
  name: string
  positions: number[]
  uvs: number[] | null
  kd: [number, number, number]
  mapFile: string | null
  /** FBX material name, used to match Unity `.mat` assets when paths are stale. */
  materialName: string | null
  /** 4 influences per vertex from Cluster deformers, when the file has a skin. */
  skin?: { indices: number[]; weights: number[] } | null
}

export type FbxAsciiImport = {
  meshes: FbxAsciiMesh[]
  version: number | null
  warnings: string[]
  expectedTextureNames: string[]
  kind?: 'ascii' | 'binary'
  /** Raster bytes from Video.Content / Texture.Content (Mixamo, embed-media exports). */
  embeddedTextures?: Record<string, Uint8Array>
  nativeSkin?: { rig: MeshBoneRig; skin: MeshBoneWeights } | null
}

/** Rx(-90°): FBX Z-up / Z-tall meshes into Three.js / Minecraft Y-up. */
export function orientFbxMeshesYUp(meshes: FbxAsciiMesh[], declaredZUp: boolean): boolean {
  if (meshes.length === 0) return false
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i + 1]!
      const z = mesh.positions[i + 2]!
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
  }
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  const looksZUp = sizeZ > sizeY * 1.15
  if (!declaredZUp && !looksZUp) return false
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!
      const y = mesh.positions[i + 1]!
      const z = mesh.positions[i + 2]!
      mesh.positions[i] = x
      mesh.positions[i + 1] = z
      mesh.positions[i + 2] = -y
    }
  }
  return true
}

export function fbxAsciiVersion(text: string): number | null {
  const match = /FBXVersion\s*:\s*(\d+)/i.exec(text)
  if (match) {
    const value = Number(match[1])
    if (Number.isFinite(value)) return value
  }
  const header = /;\s*FBX\s+(\d+)\.(\d+)/i.exec(text)
  if (header) {
    const major = Number(header[1])
    const minor = Number(header[2])
    if (!Number.isFinite(major)) return null
    if (major >= 7) return major * 1000 + (Number.isFinite(minor) ? minor * 100 : 0)
    if (major === 6) return 6000 + (Number.isFinite(minor) ? minor * 100 : 0)
    return major
  }
  return null
}

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

function splitProps(header: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const char of header) {
    if (char === '"') {
      quoted = !quoted
      current += char
      continue
    }
    if (char === ',' && !quoted) {
      out.push(unquote(current))
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) out.push(unquote(current))
  return out
}

function findBlock(text: string, start: number): { header: string; body: string; end: number } | null {
  const brace = text.indexOf('{', start)
  if (brace < 0) return null
  let depth = 0
  let quoted = false
  for (let i = brace; i < text.length; i += 1) {
    const char = text[i]!
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return {
          header: text.slice(start, brace).trim(),
          body: text.slice(brace + 1, i),
          end: i + 1,
        }
      }
    }
  }
  return null
}

function forEachBlock(text: string, name: string, visit: (header: string, body: string) => void) {
  const re = new RegExp(`(?:^|[\\n\\r])\\s*${name}\\s*:`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const block = findBlock(text, match.index)
    if (!block) continue
    visit(block.header.replace(new RegExp(`^\\s*${name}\\s*:`, 'i'), '').trim(), block.body)
    re.lastIndex = block.end
  }
}

export function decodeFbxText(bytes: Uint8Array): string {
  if (
    bytes.length >= 16
    && bytes[0] !== 0
    && bytes[1] === 0
    && bytes[2] !== 0
    && bytes[3] === 0
    && bytes[4] !== 0
    && bytes[5] === 0
  ) {
    return new TextDecoder('utf-16le').decode(bytes).normalize('NFC')
  }
  return decodeExportText(bytes)
}

function parseNumberList(source: string): number[] {
  const out: number[] = []
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const value = Number(match[0])
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

function propertyArray(body: string, key: string): number[] {
  const re = new RegExp(`(?:^|[\\n\\r])\\s*${key}\\s*:`, 'i')
  const match = re.exec(body)
  if (!match) return []
  const from = match.index + match[0].length
  const rest = body.slice(from)
  const star = rest.search(/\S/)
  const head = star >= 0 ? rest.slice(star) : rest
  if (head.startsWith('*')) {
    const nested = findBlock(body, from)
    if (nested) {
      const a = /\ba\s*:\s*([\s\S]*)/i.exec(nested.body)
      return parseNumberList(a?.[1] ?? nested.body)
    }
  }
  const nextProp = /(?:^|[\n\r])\s*[A-Za-z_][\w]*\s*:/.exec(rest)
  const chunk = nextProp ? rest.slice(0, nextProp.index) : rest
  return parseNumberList(chunk)
}

function propertyString(body: string, key: string): string | null {
  const match = new RegExp(`${key}\\s*:\\s*"([^"]+)"`, 'i').exec(body)
  return match?.[1] ?? null
}

export function decodePath(raw: string): string {
  let value = repairMojibake(raw.trim()).replaceAll('\\', '/')
  value = value.split(/[?#]/)[0] ?? value
  return basename(value)
}

function layerBody(body: string, layerName: string): string | null {
  const re = new RegExp(`(?:^|[\\n\\r])\\s*${layerName}\\s*:`, 'i')
  const match = re.exec(body)
  if (!match) return null
  return findBlock(body, match.index)?.body ?? null
}

function layerField(body: string, layerName: string, field: string): string | null {
  const layer = layerBody(body, layerName)
  if (!layer) return null
  return propertyString(layer, field)
}

function layerArray(body: string, layerName: string, field: string): number[] {
  const layer = layerBody(body, layerName)
  if (!layer) return []
  return propertyArray(layer, field)
}

function lclVector(body: string, name: 'Translation' | 'Rotation' | 'Scaling'): [number, number, number] | null {
  const fallback = name === 'Scaling' ? ([1, 1, 1] as [number, number, number]) : ([0, 0, 0] as [number, number, number])
  const re = new RegExp(
    `(?:P|Property)\\s*:\\s*"Lcl[ _]${name}"\\s*,[\\s\\S]*?(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)`,
    'i',
  )
  const match = re.exec(body)
  if (!match) return name === 'Scaling' ? fallback : null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function diffuseColor(body: string): [number, number, number] {
  const color = /(?:P|Property)\s*:\s*"Diffuse(?:Color)?"\s*,[\s\S]*?(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(
    body,
  )
  if (color) {
    return [
      Math.min(1, Math.max(0, Number(color[1]))),
      Math.min(1, Math.max(0, Number(color[2]))),
      Math.min(1, Math.max(0, Number(color[3]))),
    ]
  }
  const grey = /(?:P|Property)\s*:\s*"Diffuse"\s*,[\s\S]*?(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i.exec(body)
  if (grey) {
    const value = Math.min(1, Math.max(0, Number(grey[1])))
    return [value, value, value]
  }
  return [0.75, 0.75, 0.75]
}

export type Mat4 = number[]

export function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function matMultiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[row]! * b[col * 4]!
        + a[4 + row]! * b[col * 4 + 1]!
        + a[8 + row]! * b[col * 4 + 2]!
        + a[12 + row]! * b[col * 4 + 3]!
    }
  }
  return out
}

function matTranslate(translation: [number, number, number]): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], translation[2], 1]
}

function matScale3(scale: [number, number, number]): Mat4 {
  return [scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, 0, 0, 0, 1]
}

/** FBX default rotation order XYZ (R = Rz * Ry * Rx). */
export function matEulerXYZ(rotationDeg: [number, number, number]): Mat4 {
  const deg = Math.PI / 180
  const [rx, ry, rz] = [rotationDeg[0] * deg, rotationDeg[1] * deg, rotationDeg[2] * deg]
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const rxm: Mat4 = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]
  const rym: Mat4 = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]
  const rzm: Mat4 = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return matMultiply(rzm, matMultiply(rym, rxm))
}

/** Transpose the linear 3×3 (inverse of a pure rotation). */
function matTranspose3(matrix: Mat4): Mat4 {
  return [
    matrix[0]!, matrix[4]!, matrix[8]!, 0,
    matrix[1]!, matrix[5]!, matrix[9]!, 0,
    matrix[2]!, matrix[6]!, matrix[10]!, 0,
    0, 0, 0, 1,
  ]
}

function nearlyZero3(value?: [number, number, number] | null): boolean {
  if (!value) return true
  return value[0] ** 2 + value[1] ** 2 + value[2] ** 2 < 1e-20
}

/**
 * Maya / FBX SDK local matrix:
 * T * Roff * Rp * Rpre * R * Rpost⁻¹ * Rp⁻¹ * Soff * Sp * S * Sp⁻¹
 */
export function matFbxLocal(parts: {
  translation?: [number, number, number] | null
  rotation?: [number, number, number] | null
  scale?: [number, number, number] | null
  preRotation?: [number, number, number] | null
  postRotation?: [number, number, number] | null
  rotationOffset?: [number, number, number] | null
  rotationPivot?: [number, number, number] | null
  scalingOffset?: [number, number, number] | null
  scalingPivot?: [number, number, number] | null
}): Mat4 {
  const translation = parts.translation ?? [0, 0, 0]
  const rotation = parts.rotation ?? [0, 0, 0]
  const scale = parts.scale ?? [1, 1, 1]
  const chain: Mat4[] = [matTranslate(translation)]
  if (!nearlyZero3(parts.rotationOffset)) chain.push(matTranslate(parts.rotationOffset!))
  const pivot = parts.rotationPivot
  if (!nearlyZero3(pivot)) chain.push(matTranslate(pivot!))
  if (!nearlyZero3(parts.preRotation)) chain.push(matEulerXYZ(parts.preRotation!))
  chain.push(matEulerXYZ(rotation))
  if (!nearlyZero3(parts.postRotation)) chain.push(matTranspose3(matEulerXYZ(parts.postRotation!)))
  if (!nearlyZero3(pivot)) {
    chain.push(matTranslate([-pivot![0], -pivot![1], -pivot![2]]))
  }
  if (!nearlyZero3(parts.scalingOffset)) chain.push(matTranslate(parts.scalingOffset!))
  const scalePivot = parts.scalingPivot
  if (!nearlyZero3(scalePivot)) chain.push(matTranslate(scalePivot!))
  chain.push(matScale3(scale))
  if (!nearlyZero3(scalePivot)) {
    chain.push(matTranslate([-scalePivot![0], -scalePivot![1], -scalePivot![2]]))
  }
  return chain.reduce((a, b) => matMultiply(a, b))
}

export function matCompose(
  translation: [number, number, number],
  rotationDeg: [number, number, number],
  scale: [number, number, number],
): Mat4 {
  return matFbxLocal({ translation, rotation: rotationDeg, scale })
}

export function matInvert(m: Mat4): Mat4 | null {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < 1e-12) return null
  const s = 1 / det
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * s,
    (a02 * b10 - a01 * b11 - a03 * b09) * s,
    (a31 * b05 - a32 * b04 + a33 * b03) * s,
    (a22 * b04 - a21 * b05 - a23 * b03) * s,
    (a12 * b08 - a10 * b11 - a13 * b07) * s,
    (a00 * b11 - a02 * b08 + a03 * b07) * s,
    (a32 * b02 - a30 * b05 - a33 * b01) * s,
    (a20 * b05 - a22 * b02 + a23 * b01) * s,
    (a10 * b10 - a11 * b08 + a13 * b06) * s,
    (a01 * b08 - a00 * b10 - a03 * b06) * s,
    (a30 * b04 - a31 * b02 + a33 * b00) * s,
    (a21 * b02 - a20 * b04 - a23 * b00) * s,
    (a11 * b07 - a10 * b09 - a12 * b06) * s,
    (a00 * b09 - a01 * b07 + a02 * b06) * s,
    (a31 * b01 - a30 * b03 - a32 * b00) * s,
    (a20 * b03 - a21 * b01 + a22 * b00) * s,
  ]
}

export function matTransform(matrix: Mat4, x: number, y: number, z: number): [number, number, number] {
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
  const inv = w !== 0 ? 1 / w : 1
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * inv,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * inv,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * inv,
  ]
}

function propertyVec3(body: string, name: string): [number, number, number] | null {
  const re = new RegExp(
    `(?:P|Property)\\s*:\\s*"${name}"\\s*,[\\s\\S]*?(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)`,
    'i',
  )
  const match = re.exec(body)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function localMatrix(body: string): Mat4 {
  return matFbxLocal({
    translation: lclVector(body, 'Translation'),
    rotation: lclVector(body, 'Rotation'),
    scale: lclVector(body, 'Scaling'),
    preRotation: propertyVec3(body, 'PreRotation'),
    postRotation: propertyVec3(body, 'PostRotation'),
    rotationOffset: propertyVec3(body, 'RotationOffset'),
    rotationPivot: propertyVec3(body, 'RotationPivot'),
    scalingOffset: propertyVec3(body, 'ScalingOffset'),
    scalingPivot: propertyVec3(body, 'ScalingPivot'),
  })
}

function geometricMatrix(body: string): Mat4 {
  return matFbxLocal({
    translation: propertyVec3(body, 'GeometricTranslation'),
    rotation: propertyVec3(body, 'GeometricRotation'),
    scale: propertyVec3(body, 'GeometricScaling'),
  })
}

function parseConnections(text: string): FbxConn[] {
  const out: FbxConn[] = []
  const re =
    /(?:^|[\n\r])\s*(?:C|Connect)\s*:\s*"([^"]+)"\s*,\s*([^,\n]+)\s*,\s*([^,\n]+)(?:\s*,\s*("[^"]*"|[^,\n{]+))?/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const kind = (match[1] ?? '').toUpperCase()
    if (kind !== 'OO' && kind !== 'OP') continue
    out.push({
      from: unquote(match[2] ?? ''),
      to: unquote(match[3] ?? ''),
      prop: unquote((match[4] ?? '').trim()),
    })
  }
  return out
}

function textureUv(body: string): { scale: [number, number]; offset: [number, number]; uvSet?: string } {
  const vec = (key: string, fallback: [number, number]): [number, number] => {
    const re = new RegExp(
      `(?:P|Property)\\s*:\\s*"${key}"\\s*,[\\s\\S]*?(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)`,
      'i',
    )
    const match = re.exec(body)
    if (!match) return fallback
    const x = Number(match[1])
    const y = Number(match[2])
    return [Number.isFinite(x) ? x : fallback[0], Number.isFinite(y) ? y : fallback[1]]
  }
  const rawSet = propertyString(body, 'UVSet') ?? ''
  const uvSet = rawSet && !/^default$/i.test(rawSet) ? rawSet : undefined
  return { ...sanitizeFbxTextureUv(vec('UVScaling', vec('Scaling', [1, 1])), vec('UVTranslation', vec('Translation', [0, 0]))), uvSet }
}

export function triangulate(
  vertices: number[],
  indices: number[],
  uvForCorner: (corner: number, vertex: number, polygon: number) => [number, number] | null,
  materialForPolygon?: (polygon: number) => number,
): { positions: number[]; uvs: number[] | null; materialSlots: number[]; controlPoints: number[] } {
  const positions: number[] = []
  const uvs: number[] = []
  const materialSlots: number[] = []
  const controlPoints: number[] = []
  let hasUv = false
  let polygon = 0
  let corner = 0
  let poly: number[] = []
  let polyCorners: number[] = []

  const flush = () => {
    if (poly.length < 3) {
      poly = []
      polyCorners = []
      polygon += 1
      return
    }
    const slot = materialForPolygon ? materialForPolygon(polygon) : 0
    for (let i = 1; i + 1 < poly.length; i += 1) {
      const tri = [poly[0]!, poly[i]!, poly[i + 1]!]
      const triCorners = [polyCorners[0]!, polyCorners[i]!, polyCorners[i + 1]!]
      for (let t = 0; t < 3; t += 1) {
        const vi = tri[t]!
        const px = vertices[vi * 3]
        const py = vertices[vi * 3 + 1]
        const pz = vertices[vi * 3 + 2]
        if (px == null || py == null || pz == null) continue
        positions.push(px, py, pz)
        controlPoints.push(vi)
        const uv = uvForCorner(triCorners[t]!, vi, polygon)
        if (uv) {
          hasUv = true
          uvs.push(uv[0], uv[1])
        } else {
          uvs.push(0, 0)
        }
      }
      materialSlots.push(slot)
    }
    poly = []
    polyCorners = []
    polygon += 1
  }

  for (const raw of indices) {
    const end = raw < 0
    const index = end ? -raw - 1 : raw
    poly.push(index)
    polyCorners.push(corner)
    corner += 1
    if (end) flush()
  }
  if (poly.length >= 3) flush()
  return { positions, uvs: hasUv ? uvs : null, materialSlots, controlPoints }
}

function uvLayers(body: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const re = /(?:^|[\n\r])\s*LayerElementUV\s*:/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const block = findBlock(body, match.index)
    if (!block) continue
    out.push({ name: propertyString(block.body, 'Name') ?? '', body: block.body })
    re.lastIndex = block.end
  }
  return out
}

function uvSampler(
  body: string,
  uvSet?: string,
): (corner: number, vertex: number, polygon: number) => [number, number] | null {
  const layer = pickFbxUvLayer(
    uvLayers(body),
    (entry) => entry.name,
    uvSet,
    (entry) => propertyArray(entry.body, 'UV').length >= 2,
  )
  const src = layer?.body ?? ''
  const uvs = propertyArray(src, 'UV')
  if (uvs.length < 2) return () => null
  const uvIndex = propertyArray(src, 'UVIndex').map((value) => Math.round(value))
  const mapping = propertyString(src, 'MappingInformationType') ?? 'ByPolygonVertex'
  const reference = (propertyString(src, 'ReferenceInformationType') ?? 'Direct').toLowerCase()

  const pair = (index: number): [number, number] | null => {
    const u = uvs[index * 2]
    const v = uvs[index * 2 + 1]
    if (u == null || v == null) return null
    return [u, v]
  }

  return (corner, vertex, polygon) => {
    const index = fbxLayerIndex(mapping, corner, vertex, polygon)
    if (reference.includes('index')) {
      const mapped = uvIndex[index]
      if (mapped == null) return null
      return pair(mapped)
    }
    return pair(index)
  }
}

type ModelInfo = {
  id: string
  name: string
  type: string
  body: string
  matrix: Mat4
  geometric: Mat4
  parent: string | null
}

function modelKey(props: string[]): string {
  if (props.length >= 2 && /^\d+$/.test(props[0] ?? '')) return props[0]!
  return props[0] ?? ''
}

function modelName(props: string[]): string {
  const named = props.find((prop) => /::/.test(prop)) ?? props[1] ?? props[0] ?? 'mesh'
  return named.replace(/^.*::/, '') || 'mesh'
}

function worldMatrices(models: Map<string, ModelInfo>): void {
  const visiting = new Set<string>()
  const world = new Map<string, Mat4>()
  const resolve = (id: string): Mat4 => {
    const cached = world.get(id)
    if (cached) return cached
    const model = models.get(id)
    if (!model) return matIdentity()
    if (visiting.has(id)) return model.matrix
    visiting.add(id)
    const parent = model.parent ? resolve(model.parent) : matIdentity()
    const next = matMultiply(parent, model.matrix)
    world.set(id, next)
    model.matrix = next
    visiting.delete(id)
    return next
  }
  for (const id of models.keys()) resolve(id)
}

/**
 * Parse an ASCII FBX document into triangulated meshes.
 * Missing textures are ignored — Diffuse colour is used instead.
 */
export function parseFbxAscii(bytes: Uint8Array): FbxAsciiImport {
  const text = decodeFbxText(bytes)
  const warnings: string[] = []
  const version = fbxAsciiVersion(text)
  const connections = parseConnections(text)
  const expectedTextureNames: string[] = []

  const materials = new Map<string, { kd: [number, number, number]; name: string }>()
  const materialIds = new Set<string>()
  forEachBlock(text, 'Material', (header, body) => {
    const props = splitProps(header)
    const id = modelKey(props)
    const name = modelName(props)
    const kd = diffuseColor(body)
    materials.set(id, { kd, name })
    materialIds.add(id)
    if (props[0]) materials.set(unquote(props[0]!), { kd, name })
    if (props[1]) materials.set(unquote(props[1]!), { kd, name })
  })

  const fileOf = new Map<string, FbxTextureRef>()
  const textureIds = new Set<string>()
  const videoIds = new Set<string>()
  const layeredIds = new Set<string>()
  const embeddedTextures: Record<string, Uint8Array> = {}
  const rememberTexture = (id: string, file: string, content: string | null, body: string) => {
    expectedTextureNames.push(file)
    const uv = textureUv(body)
    fileOf.set(id, { file, scale: uv.scale, offset: uv.offset, uvSet: uv.uvSet })
    if (content) {
      const bytes = decodeAsciiEmbeddedImage(content)
      if (bytes) embeddedTextures[file.toLowerCase()] = bytes
    }
  }
  forEachBlock(text, 'Texture', (header, body) => {
    const props = splitProps(header)
    const id = modelKey(props)
    textureIds.add(id)
    const relative = propertyString(body, 'RelativeFilename') ?? propertyString(body, 'FileName') ?? propertyString(body, 'Filename')
    if (!relative) return
    const file = decodePath(relative)
    if (!IMAGE_EXT.test(file)) return
    rememberTexture(id, file, propertyString(body, 'Content'), body)
  })
  forEachBlock(text, 'Video', (header, body) => {
    const props = splitProps(header)
    const id = modelKey(props)
    videoIds.add(id)
    const relative = propertyString(body, 'RelativeFilename') ?? propertyString(body, 'FileName') ?? propertyString(body, 'Filename')
    if (!relative) return
    const file = decodePath(relative)
    if (!IMAGE_EXT.test(file)) return
    rememberTexture(id, file, propertyString(body, 'Content'), body)
  })
  forEachBlock(text, 'LayeredTexture', (header) => {
    layeredIds.add(modelKey(splitProps(header)))
  })

  const bindings = bindFbxSurfaces(connections, {
    materials: materialIds,
    textures: textureIds,
    videos: videoIds,
    layered: layeredIds,
  })
  const deformers = new Map<string, FbxDeformer>()
  forEachBlock(text, 'Deformer', (header, body) => {
    const props = splitProps(header)
    const id = modelKey(props)
    deformers.set(id, {
      id,
      type: props[props.length - 1] ?? '',
      indexes: propertyArray(body, 'Indexes'),
      weights: propertyArray(body, 'Weights'),
      transform: propertyArray(body, 'Transform'),
      transformLink: propertyArray(body, 'TransformLink'),
    })
  })

  const models = new Map<string, ModelInfo>()
  forEachBlock(text, 'Model', (header, body) => {
    const props = splitProps(header)
    const id = modelKey(props)
    const info: ModelInfo = {
      id,
      name: modelName(props),
      type: (props[props.length - 1] ?? '').toLowerCase(),
      body,
      matrix: localMatrix(body),
      geometric: geometricMatrix(body),
      parent: null,
    }
    models.set(id, info)
    if (props[0] && props[0] !== id) models.set(unquote(props[0]!), info)
    if (props[1] && props[1] !== id) models.set(unquote(props[1]!), info)
  })
  const parentOf = fbxNodeParents(connections, new Set(deformers.keys()))
  for (const [id, model] of models) {
    if (model.id !== id) continue
    model.parent = parentOf.get(id)
      ?? parentOf.get(model.name)
      ?? null
  }
  worldMatrices(models)

  const geometries: { id: string; name: string; body: string }[] = []
  forEachBlock(text, 'Geometry', (header, body) => {
    const props = splitProps(header)
    if (!/mesh/i.test(props[props.length - 1] ?? '') && !propertyArray(body, 'Vertices').length) return
    geometries.push({ id: modelKey(props), name: modelName(props), body })
  })

  const meshBodies: {
    name: string
    body: string
    matrix: Mat4
    modelId: string | null
    geometryId: string | null
  }[] = []

  const geometryMeshes = geometries.filter((geo) => {
    const vertices = propertyArray(geo.body, 'Vertices')
    const indices = propertyArray(geo.body, 'PolygonVertexIndex')
    return vertices.length >= 9 && indices.length >= 3
  })

  if (geometryMeshes.length) {
    for (const geo of geometryMeshes) {
      const modelId = parentOf.get(geo.id)
      const model = modelId ? models.get(modelId) : null
      meshBodies.push({
        name: model?.name ?? geo.name,
        body: geo.body,
        matrix: model ? matMultiply(model.matrix, model.geometric) : matIdentity(),
        modelId: modelId ?? null,
        geometryId: geo.id,
      })
    }
  } else {
    for (const [id, model] of models) {
      if (model.id !== id) continue
      const vertices = propertyArray(model.body, 'Vertices')
      const indices = propertyArray(model.body, 'PolygonVertexIndex')
      if (vertices.length < 9 || indices.length < 3) continue
      meshBodies.push({
        name: model.name,
        body: model.body,
        matrix: matMultiply(model.matrix, model.geometric),
        modelId: id,
        geometryId: id,
      })
    }
  }

  const upAxis = /UpAxis\s*:\s*(-?\d+)/i.exec(text)
  const declaredZUp = Number(upAxis?.[1] ?? 1) === 2
  const unit = Number(/UnitScaleFactor\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(text)?.[1] ?? 1)
  const scale = Number.isFinite(unit) && unit > 0 && unit !== 100 ? unit : 1

  const boneModels: FbxBoneModel[] = []
  const seenBones = new Set<string>()
  for (const [id, model] of models) {
    if (model.id !== id || seenBones.has(id)) continue
    seenBones.add(id)
    boneModels.push({
      id,
      name: model.name,
      type: model.type,
      parent: model.parent,
      world: model.matrix,
    })
  }
  const clusterBones = allClusterBones(connections, deformers)
  const skinnedIds = new Set(clusterBones.map((entry) => entry.boneId))
  const nativeDraft = buildFbxNativeRig(boneModels, [0, 0, 0, 1, 1, 1], false, { skinnedIds })

  const meshes: FbxAsciiMesh[] = []
  let skinnedMeshWorld: number[] | null = null
  for (const entry of meshBodies) {
    const vertices = propertyArray(entry.body, 'Vertices')
    const indices = propertyArray(entry.body, 'PolygonVertexIndex')
    const matIndices = layerArray(entry.body, 'LayerElementMaterial', 'Materials')
    const matMapping = layerField(entry.body, 'LayerElementMaterial', 'MappingInformationType') ?? 'AllSame'
    const slots =
      (entry.modelId ? bindings.materialsOf.get(entry.modelId) : undefined)
      ?? []
    const baked = triangulate(
      vertices,
      indices,
      uvSampler(entry.body, preferredUvSet(slots, bindings, fileOf)),
      materialSlotSampler(matIndices, matMapping),
    )
    if (baked.positions.length < 9) continue
    const positions: number[] = []
    for (let i = 0; i < baked.positions.length; i += 3) {
      const [x, y, z] = matTransform(
        entry.matrix,
        baked.positions[i]!,
        baked.positions[i + 1]!,
        baked.positions[i + 2]!,
      )
      positions.push(x * scale, y * scale, z * scale)
    }
    const groups = partitionTriangles(positions, baked.uvs, baked.materialSlots, baked.controlPoints)
    const multi = groups.size > 1
    const clusters = nativeDraft
      ? clustersForGeometry(connections, deformers, entry.geometryId ?? '', [entry.modelId ?? ''])
      : []
    if (clusters.length > 0 && !skinnedMeshWorld) {
      const model = entry.modelId ? models.get(entry.modelId) : null
      skinnedMeshWorld = model?.matrix ?? null
    }
    for (const [slot, group] of groups) {
      const materialId = slotMaterialId(slots, slot)
      const material = materialId ? materials.get(materialId) : null
      const albedo = resolveAlbedoFile(materialId, bindings, fileOf)
      meshes.push({
        name: multi && material?.name ? `${entry.name}_${material.name}` : entry.name,
        positions: group.positions,
        uvs: remapObjUvs(group.uvs, albedo),
        kd: material?.kd ?? [0.75, 0.75, 0.75],
        mapFile: albedo?.file ?? null,
        materialName: material?.name ?? null,
        skin: nativeDraft
          ? skinFromControlPoints(group.controlPoints, clusters, nativeDraft.fbxIdToIndex)
          : null,
      })
    }
  }

  if (meshes.length === 0) {
    warnings.push('ASCII FBX contained no triangulated mesh (Vertices / PolygonVertexIndex)')
  }
  const oriented = orientFbxMeshesYUp(meshes, declaredZUp)
  if (oriented) warnings.push('Converted Z-up FBX into Y-up')
  if (version != null && version < 7000) {
    warnings.push(`FBX ASCII ${version} (6.x) — mesh baked without Three.js`)
  }
  const nativeSkin = finishFbxNativeSkin(boneModels, meshes, {
    yUp: oriented,
    unitScale: scale,
    skinnedIds,
    clusters: clusterBones,
    meshWorld: skinnedMeshWorld
      ?? (() => {
        const id = meshBodies[0]?.modelId
        const model = id ? models.get(id) : null
        return model?.matrix ?? matIdentity()
      })(),
    warnings,
  })
  if (nativeSkin) {
    warnings.push(
      nativeSkin.skin.vertexCount > 0
        ? `Using FBX skeleton (${nativeSkin.rig.bones.length} joints)`
        : `FBX skeleton found (${nativeSkin.rig.bones.length} joints) — skin weights will be solved`,
    )
  }

  return {
    meshes,
    version,
    warnings,
    expectedTextureNames: [...new Set(expectedTextureNames)],
    kind: 'ascii',
    embeddedTextures,
    nativeSkin,
  }
}

export async function fbxAsciiToObj(
  parsed: FbxAsciiImport,
  siblings: Record<string, Uint8Array>,
  fileNameFor: (name: string) => string | undefined,
): Promise<{
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textures: Record<string, Uint8Array>
  meshCount: number
}> {
  const writer = new ObjTextWriter()
  writer.line('# Generated from FBX ASCII')
  writer.line('mtllib model.mtl')
  writer.line('')
  const mtl: string[] = ['# Generated from FBX ASCII', '']
  const textures: Record<string, Uint8Array> = {}
  const usedMtl = new Set<string>()
  let vertexOffset = 0
  let uvOffset = 0

  const mtlName = (raw: string, index: number) => {
    const base = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || `mat_${index}`
    let name = base
    let serial = 2
    while (usedMtl.has(name)) name = `${base}_${serial++}`
    usedMtl.add(name)
    return name
  }

  let index = 0
  for (const mesh of parsed.meshes) {
    index += 1
    const material = mtlName(mesh.name, index)
    let mapKd: string | null = null
    if (mesh.mapFile) {
      const hit = findTextureBytes(siblings, mesh.mapFile)
      if (hit) {
        const key = hit.fileName.toLowerCase()
        mapKd = fileNameFor(hit.fileName) ?? fileNameFor(key) ?? hit.fileName
        textures[mapKd.toLowerCase()] = hit.bytes
      }
    }
    mtl.push(`newmtl ${material}`)
    mtl.push(mapKd ? 'Kd 1 1 1' : `Kd ${mesh.kd.join(' ')}`)
    mtl.push('d 1.0')
    if (mapKd) mtl.push(`map_Kd ${mapKd}`)
    mtl.push('')

    const objectName = mesh.name.replace(/[^\w.-]+/g, '_') || `mesh_${index}`
    writer.line(`o ${objectName}`)
    writer.line(`usemtl ${material}`)
    const count = mesh.positions.length / 3
    for (let i = 0; i < count; i += 1) {
      writer.line(`v ${mesh.positions[i * 3]!} ${mesh.positions[i * 3 + 1]!} ${mesh.positions[i * 3 + 2]!}`)
      if ((i & 4095) === 0) await writer.flushIfNeeded()
    }
    if (mesh.uvs) {
      for (let i = 0; i < count; i += 1) {
        writer.line(`vt ${mesh.uvs[i * 2]!} ${mesh.uvs[i * 2 + 1]!}`)
      }
    }
    for (let i = 0; i + 2 < count; i += 3) {
      const a = vertexOffset + i + 1
      const b = vertexOffset + i + 2
      const c = vertexOffset + i + 3
      if (mesh.uvs) {
        writer.line(`f ${a}/${uvOffset + i + 1} ${b}/${uvOffset + i + 2} ${c}/${uvOffset + i + 3}`)
      } else {
        writer.line(`f ${a} ${b} ${c}`)
      }
    }
    vertexOffset += count
    if (mesh.uvs) uvOffset += count
    writer.line('')
  }

  return {
    objBytes: await writer.finish(),
    mtlBytes: new TextEncoder().encode(mtl.join('\n')),
    textures,
    meshCount: parsed.meshes.length,
  }
}
