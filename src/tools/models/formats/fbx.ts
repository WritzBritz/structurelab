/**
 * Autodesk FBX (.fbx) → StructureLab's canonical OBJ + MTL package.
 *
 * ASCII 6.x / 7.x is read directly (Model.Vertices on 6.x, Geometry on 7.x) so
 * missing textures still yield a mesh with Diffuse/Kd. Three.js FBXLoader covers
 * binary ≥ 6400 (typical Mixamo / Blender / Maya 7.4): skins, morph bases,
 * embedded Video media. We bake to OBJ and keep a native bone rig + four
 * influences, matching COLLADA.
 *
 * FBX SDK / three.js notes:
 * - Mixamo / Blender / Maya FBX almost always ship as binary 7.4+ with a skin.
 * - TGA needs TGALoader registered on the LoadingManager.
 * - parse() is sync for geometry; TextureLoader/TGALoader finish asynchronously.
 * - FBXLoader throws FileVersion below ASCII 7000 / binary 6400, and can crash
 *   on Texture nodes with no Video child (`undefined[0]`). We patch that and
 *   never skip geometry when a material or map is missing.
 */

import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { TGALoader } from 'three/addons/loaders/TGALoader.js'
import { logDebug } from '../../../api'
import {
  isRasterTextureName,
  mimeForTextureBytes,
  resolveTextureSiblings,
} from '../decodeImage'
import { decodeExportBytes, foldExportName } from '../exportText'
import { basename } from '../objAssets'
import { autoLoadSidecarTextures, findTextureBytes, normalizeTextureRef } from '../sidecarTextures'
import { ObjTextWriter } from '../objStream'
import {
  alignMeshBoneRigToPositions,
  type MeshBoneDef,
  type MeshBoneRig,
  type MeshBoneWeights,
} from '../meshBoneRig'
import { decodeFbxText, fbxAsciiToObj, parseFbxAscii, type FbxAsciiImport } from './fbxAscii'
import { parseFbxBinary } from './fbxBinary'
import { materialLookupKeys, sanitizeFbxTextureUv } from './fbxBindings'
import {
  buildUnityTextureIndex,
  loadUnityTextures,
} from './unityAssets'

export { fbxFormat, isFbxFileName } from './fbxMeta'

export type FbxImportOptions = {
  fileName: string
  siblings?: Record<string, Uint8Array>
  /**
   * FBX material name (lower-cased) → texture file name, from a Unity
   * package's ModelImporter remaps. Overrides stale author paths in the
   * FBX Texture nodes. Mesh names are not used — Unity remaps materials.
   */
  materialTextures?: Record<string, string>
  /** Original file, used to locate `.fbx.meta` / `.mat` next to the model. */
  sourceFile?: File
  onProgress?: (label: string) => void
}

export type FbxNativeSkin = {
  rig: MeshBoneRig
  skin: MeshBoneWeights
}

export type FbxImportResult = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textures: Record<string, Uint8Array>
  meshCount: number
  warnings: string[]
  sourceLabel: string
  expectedTextureNames: string[]
  nativeSkin: FbxNativeSkin | null
  materialTextures?: Record<string, string>
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i
const FBX_BINARY_MAGIC = 'Kaydara FBX Binary  \0'

/** 1×1 white PNG so TextureLoader does not 404 on a missing sidecar. */
const PLACEHOLDER_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export function isFbxBinary(bytes: Uint8Array): boolean {
  if (bytes.length < FBX_BINARY_MAGIC.length) return false
  for (let i = 0; i < FBX_BINARY_MAGIC.length; i += 1) {
    if (bytes[i] !== FBX_BINARY_MAGIC.charCodeAt(i)) return false
  }
  return true
}

export function fbxBinaryVersion(bytes: Uint8Array): number | null {
  if (!isFbxBinary(bytes) || bytes.length < 27) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(23, true)
}

function decodeFbxPath(raw: string): string {
  return normalizeTextureRef(raw).base
}

function looksLikeTexturePath(raw: string): boolean {
  const name = decodeFbxPath(raw)
  if (!IMAGE_EXT.test(name)) return false
  if (name.length < 5 || name.length > 240) return false
  const stem = name.replace(/\.[^.]+$/, '')
  return /[\p{L}\p{N}]/u.test(stem)
}

function collectBinaryTextureNames(bytes: Uint8Array): string[] {
  const names = new Set<string>()
  const extensions = ['.png', '.jpg', '.jpeg', '.tga', '.webp', '.bmp', '.tif', '.tiff', '.gif']
  const isPathChar = (value: number) => {
    if (value === 0 || value < 32) return false
    if (value === 34 || value === 39) return false
    if (value >= 128) return true
    const char = String.fromCharCode(value)
    return /[A-Za-z0-9._/\\:+\-@()[\]]/.test(char)
  }
  for (const ext of extensions) {
    const needle = new TextEncoder().encode(ext)
    let from = 0
    while (from < bytes.length) {
      let hit = -1
      search: for (let i = from; i <= bytes.length - needle.length; i += 1) {
        for (let k = 0; k < needle.length; k += 1) {
          const a = bytes[i + k]!
          const b = needle[k]!
          if (a !== b && a !== (b ^ 32)) continue search
        }
        hit = i
        break
      }
      if (hit < 0) break
      let start = hit
      while (start > 0 && isPathChar(bytes[start - 1]!)) start -= 1
      const raw = decodeExportBytes(bytes.subarray(start, hit + needle.length))
      if (looksLikeTexturePath(raw)) {
        const ref = normalizeTextureRef(raw)
        names.add(ref.base)
        if (ref.relative !== ref.base) names.add(ref.relative)
      }
      from = hit + needle.length
    }
  }
  return [...names]
}

/** External (and embedded) raster files named by Video / Texture nodes. */
export function collectFbxTextureNames(bytes: Uint8Array): string[] {
  const names = new Set<string>()
  const push = (raw: string) => {
    if (!looksLikeTexturePath(raw)) return
    const ref = normalizeTextureRef(raw)
    names.add(ref.base)
    if (ref.relative !== ref.base) names.add(ref.relative)
  }

  if (isFbxBinary(bytes)) {
    return collectBinaryTextureNames(bytes)
  }
  const text = decodeFbxText(bytes)
  const quoted = /(?:RelativeFilename|FileName|Filename)\s*:\s*"([^"]+)"/gi
  for (const match of text.matchAll(quoted)) {
    push(match[1] ?? '')
  }
  const loose = /[\w./\\-]+\.(?:png|jpe?g|webp|bmp|gif|tga|tiff?)/gi
  for (const match of text.matchAll(loose)) {
    push(match[0] ?? '')
  }
  return [...names]
}

export type FbxSidecars = {
  siblings: Record<string, Uint8Array>
  /** Empty unless the FBX sits inside a Unity package. */
  materialTextures: Record<string, string>
}

export async function autoLoadFbxSiblings(
  fbxFile: File,
  fbxBytes: Uint8Array,
  options?: {
    already?: Record<string, Uint8Array>
    droppedFiles?: File[]
    readDropped?: (file: File) => Promise<Uint8Array>
  },
): Promise<FbxSidecars> {
  const wanted = collectFbxTextureNames(fbxBytes)
  const siblings = await autoLoadSidecarTextures({
    sourceFile: fbxFile,
    wanted,
    already: options?.already,
    droppedFiles: options?.droppedFiles,
    readDropped: options?.readDropped,
    vacuumCommonFolders: true,
  })
  return { siblings, materialTextures: {} }
}

function lookupSibling(
  siblings: Record<string, Uint8Array>,
  raw: string,
): { fileName: string; bytes: Uint8Array } | null {
  return findTextureBytes(siblings, raw)
}

function bytesToObjectUrl(name: string, bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return URL.createObjectURL(new Blob([copy], { type: mimeForTextureBytes(name, bytes) }))
}

function safeName(raw: string, fallback: string): string {
  const value = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return value || fallback
}

function displayRgb(material: THREE.Material): [number, number, number] {
  const color = (material as THREE.MeshPhongMaterial).color
  if (!color) return [0.8, 0.8, 0.8]
  const out = color.clone()
  if (THREE.ColorManagement.enabled) out.convertLinearToSRGB()
  return [
    Math.min(1, Math.max(0, out.r)),
    Math.min(1, Math.max(0, out.g)),
    Math.min(1, Math.max(0, out.b)),
  ]
}

function textureForMaterial(material: THREE.Material): THREE.Texture | null {
  return (material as THREE.MeshPhongMaterial).map ?? null
}

function objUvFromThree(u: number, v: number, map: THREE.Texture | null): [number, number] {
  if (!map || isPlaceholderMap(map)) return [u, v]
  const { scale, offset } = sanitizeFbxTextureUv(
    [map.repeat.x, map.repeat.y],
    [map.offset.x, map.offset.y],
  )
  return [u * scale[0] + offset[0], v * scale[1] + offset[1]]
}

function isPlaceholderMap(map: THREE.Texture | null): boolean {
  if (!map) return true
  const image = map.image as { src?: string; width?: number; height?: number } | undefined
  if (!image) return true
  if (image.src === PLACEHOLDER_PNG_DATA_URI) return true
  if ((image.width ?? 2) <= 1 && (image.height ?? 2) <= 1) return true
  return false
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(null)
          return
        }
        resolve(new Uint8Array(await blob.arrayBuffer()))
      },
      'image/png',
    )
  })
}

async function imageSourceToPng(image: unknown): Promise<Uint8Array | null> {
  if (!image) return null
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    if (image.width <= 1 && image.height <= 1) return null
    return canvasToPngBytes(image)
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    if (image.width <= 1 && image.height <= 1) return null
    const blob = await image.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    if (image.width <= 1 && image.height <= 1) return null
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return canvasToPngBytes(canvas)
  }
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (width <= 1 || height <= 1) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return canvasToPngBytes(canvas)
  }
  return null
}

function textureSibling(
  texture: THREE.Texture | null,
  siblings: Record<string, Uint8Array>,
): [string, Uint8Array] | null {
  if (!texture) return null
  const candidates: string[] = []
  const add = (raw?: string | null) => {
    if (!raw || /^(data:|blob:)/i.test(raw)) return
    const name = decodeFbxPath(raw)
    if (name) candidates.push(name)
  }
  add(texture.name)
  const image = texture.image as { src?: string; name?: string } | undefined
  add(image?.name)
  add(image?.src)
  for (const key of candidates) {
    const hit = lookupSibling(siblings, key)
    if (hit) return [hit.fileName, hit.bytes]
  }
  const images = Object.entries(siblings).filter(([name]) => IMAGE_EXT.test(name))
  return images.length === 1 ? images[0]! : null
}

function boundsFromPositions(positions: number[]): MeshBoneRig['bounds'] {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    minZ = Math.min(minZ, positions[i + 2]!)
    maxX = Math.max(maxX, positions[i]!)
    maxY = Math.max(maxY, positions[i + 1]!)
    maxZ = Math.max(maxZ, positions[i + 2]!)
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  }
}

function buildNativeRig(
  bones: THREE.Bone[],
  allPositions: number[],
): MeshBoneRig | null {
  if (bones.length === 0) return null
  const boneSet = new Set(bones)
  const idByBone = new Map<THREE.Bone, string>()
  const used = new Set<string>()
  for (let i = 0; i < bones.length; i += 1) {
    const base = safeName(bones[i]!.name, `bone_${i + 1}`)
    let id = base
    let serial = 2
    while (used.has(id)) id = `${base}_${serial++}`
    used.add(id)
    idByBone.set(bones[i]!, id)
  }

  const defs: MeshBoneDef[] = bones.map((bone, index) => {
    const headV = bone.getWorldPosition(new THREE.Vector3())
    const child = bone.children.find((entry): entry is THREE.Bone =>
      (entry as THREE.Bone).isBone && boneSet.has(entry as THREE.Bone)
    )
    let tipV: THREE.Vector3
    if (child) {
      tipV = child.getWorldPosition(new THREE.Vector3())
    } else {
      const parent = bone.parent as THREE.Bone | null
      if (parent?.isBone && boneSet.has(parent)) {
        const parentHead = parent.getWorldPosition(new THREE.Vector3())
        tipV = headV.clone().add(headV.clone().sub(parentHead).normalize())
      } else {
        tipV = headV.clone().add(new THREE.Vector3(0, 1, 0))
      }
    }
    if (tipV.distanceToSquared(headV) < 1e-10) tipV.y += 1
    return {
      id: idByBone.get(bone)!,
      parent: bone.parent && (bone.parent as THREE.Bone).isBone
        ? idByBone.get(bone.parent as THREE.Bone) ?? null
        : null,
      label: bone.name.replace(/^.*:/, '').replace(/[._]+/g, ' ') || `Bone ${index + 1}`,
      head: headV.toArray() as [number, number, number],
      tip: tipV.toArray() as [number, number, number],
      hasBend: false,
      bendT: 1,
      radius: Math.max(0.01, headV.distanceTo(tipV) * 0.12),
    }
  })
  const rig: MeshBoneRig = {
    kind: 'native',
    bones: defs,
    indexOf: Object.fromEntries(defs.map((bone, index) => [bone.id, index])),
    bounds: boundsFromPositions(allPositions),
  }
  return alignMeshBoneRigToPositions(rig, allPositions)
}

function applyImportedSkin(
  mesh: THREE.SkinnedMesh,
  point: THREE.Vector3,
  vertex: number,
  skinIndex: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  skinWeight: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.Vector3 {
  mesh.skeleton.update()
  const boneMatrices = mesh.skeleton.boneMatrices
  if (!boneMatrices) return point
  const base = point.clone().applyMatrix4(mesh.bindMatrix)
  const result = new THREE.Vector3()
  const transformed = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  for (let k = 0; k < 4; k += 1) {
    const weight = skinWeight.getComponent(vertex, k)
    if (weight <= 1e-8) continue
    const boneIndex = Math.round(skinIndex.getComponent(vertex, k))
    matrix.fromArray(boneMatrices, boneIndex * 16)
    transformed.copy(base).applyMatrix4(matrix)
    result.addScaledVector(transformed, weight)
  }
  return point.copy(result).applyMatrix4(mesh.bindMatrixInverse)
}

function friendlyFbxError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    /cannot read propert(?:y|ies) of undefined/i.test(message)
    || /reading ['"]0['"]/.test(message)
    || /is not an object \(evaluating/i.test(message)
    || /\.add is not a function/i.test(message)
  ) {
    return new Error(
      'This FBX has incomplete texture or material links. The mesh should still import without textures — if it did not, re-export as FBX 7.4 or FBX 6/7 ASCII.',
    )
  }
  if (/version not supported|FileVersion/i.test(message)) {
    return new Error(
      'Could not read this FBX with the 7.x loader. StructureLab also reads FBX 6 ASCII meshes (including files with missing textures). If nothing imported, the file has no Vertices / PolygonVertexIndex — re-export as FBX 7.4 binary or ASCII.',
    )
  }
  if (/Unknown format/i.test(message)) {
    return new Error('That file is not a readable FBX (ASCII 6/7 or binary 6400+).')
  }
  return new Error(`Could not parse FBX: ${message}`)
}

/** FBXLoader connection entries are plain `{ parents, children }` — not Object3D / Set / Map. */
function isFbxConnectionEntry(value: unknown): value is { parents: unknown[]; children: unknown[] } {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    isObject3D?: boolean
    add?: unknown
    parents?: unknown
    children?: unknown
    constructor?: { name?: string }
  }
  // Object3D, Group, Bone, Mesh all have `.children` and `.add` — never rewrite those.
  if (record.isObject3D) return false
  if (typeof record.add === 'function') return false
  if (!('parents' in record) || !('children' in record)) return false
  return true
}

function wrapFbxConnList(list: unknown): unknown[] {
  const arr = Array.isArray(list) ? list : []
  return new Proxy(arr, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (
        value == null
        && (prop === '0' || (typeof prop === 'string' && /^\d+$/.test(prop)))
      ) {
        return { ID: -1, relationship: '' }
      }
      return value
    },
  })
}

function wrapFbxConnEntry(entry: { parents?: unknown; children?: unknown }) {
  if (!Array.isArray(entry.parents)) entry.parents = []
  if (!Array.isArray(entry.children)) entry.children = []
  return {
    parents: wrapFbxConnList(entry.parents),
    children: wrapFbxConnList(entry.children),
  }
}

function mapLooksLikeConnections(map: Map<unknown, unknown>): boolean {
  for (const existing of map.values()) {
    return isFbxConnectionEntry(existing)
  }
  return false
}

/**
 * FBXLoader does `connections.get(id).children[0]` when a Texture has no Video
 * link, and `Scaling.value[0]` when a Texture Scaling property has no `.value`.
 * Only soft-fill missing connection keys; never clone Object3Ds (that
 * dropped `.add` and caused `n.add is not a function`).
 */
function withSafeFbxConnections<T>(run: () => T): T {
  const original = Map.prototype.get
  Map.prototype.get = function patchedGet(this: Map<unknown, unknown>, key: unknown) {
    const value = original.call(this, key)
    if (value != null) {
      if (isFbxConnectionEntry(value)) return wrapFbxConnEntry(value)
      return value
    }
    if (mapLooksLikeConnections(this)) {
      const empty = { parents: [] as unknown[], children: [] as unknown[] }
      this.set(key, empty)
      return wrapFbxConnEntry(empty)
    }
    return value
  } as typeof original
  try {
    return run()
  } finally {
    Map.prototype.get = original
  }
}

function revokeTextureBlobs(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const map = textureForMaterial(material)
      const src = (map?.image as { src?: string } | undefined)?.src
      if (src && src.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(src)
        } catch {
          // ignore
        }
      }
    }
  })
}

async function parseFbxScene(
  bytes: Uint8Array,
  siblings: Record<string, Uint8Array>,
): Promise<{ group: THREE.Group; revoke: () => void }> {
  const blobUrls: string[] = []
  const revoke = () => {
    for (const url of blobUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // ignore
      }
    }
    blobUrls.length = 0
  }

  const manager = new THREE.LoadingManager()
  manager.addHandler(/\.tga$/i, new TGALoader(manager))
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/i.test(url)) return url
    const hit = lookupSibling(siblings, url)
    if (hit) {
      const objectUrl = bytesToObjectUrl(hit.fileName, hit.bytes)
      blobUrls.push(objectUrl)
      return objectUrl
    }
    return PLACEHOLDER_PNG_DATA_URI
  })

  let started = 0
  const texturesDone = new Promise<void>((resolve) => {
    manager.onStart = () => {
      started += 1
    }
    manager.onLoad = () => resolve()
    manager.onError = (url) => {
      logDebug(`[fbx] texture load failed: ${url}`)
    }
  })

  const loader = new FBXLoader(manager)
  // Exact slice — some runtimes hand a larger underlying ArrayBuffer.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
  let group: THREE.Group
  try {
    group = withSafeFbxConnections(() => loader.parse(buffer, ''))
  } catch (error) {
    revoke()
    throw friendlyFbxError(error)
  }
  if (started > 0) {
    await Promise.race([
      texturesDone,
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, 20_000)
      }),
    ])
  }
  return { group, revoke }
}

type MaterialEntry = {
  name: string
  kd: [number, number, number]
  mapKd: string | null
}

type PreparedTextures = Awaited<ReturnType<typeof resolveTextureSiblings>>

async function resultFromAscii(
  ascii: FbxAsciiImport,
  siblings: Record<string, Uint8Array>,
  prepared: PreparedTextures,
  referenced: string[],
  onProgress: (label: string) => void,
  materialTextures: Record<string, string> = {},
): Promise<FbxImportResult> {
  onProgress(ascii.kind === 'binary' ? 'Building mesh…' : 'Writing mesh…')
  const packed = await fbxAsciiToObj(ascii, siblings, (name) => prepared.fileNameFor(name) ?? undefined)
  const warnings = [...ascii.warnings]
  const attached = new Set(Object.keys(packed.textures))
  const named = [...new Set([...referenced, ...ascii.expectedTextureNames].map((name) => basename(name)))]
  const missing = named.filter((name) => {
    const fold = foldExportName(name)
    if ([...attached].some((key) => foldExportName(key) === fold)) return false
    if (findTextureBytes(siblings, name)) return false
    const pngName = prepared.fileNameFor(name)
    return !(pngName && [...attached].some((key) => foldExportName(key) === foldExportName(pngName)))
  })
  if (missing.length) {
    warnings.push(
      `Missing texture${missing.length === 1 ? '' : 's'} (${missing.join(', ')}) — mesh uses material colour`,
    )
  }
  const label = [
    `${ascii.kind === 'binary' ? 'FBX binary' : 'FBX ASCII'} · ${packed.meshCount} mesh${packed.meshCount === 1 ? '' : 'es'}`,
  ]
  if (ascii.version != null && ascii.version < 7000) label.push(`v${ascii.version}`)
  if (ascii.nativeSkin) label.push(`${ascii.nativeSkin.rig.bones.length} native bones`)
  onProgress('Done')
  return {
    objBytes: packed.objBytes,
    mtlBytes: packed.mtlBytes,
    textures: packed.textures,
    meshCount: packed.meshCount,
    warnings,
    sourceLabel: label.join(' · '),
    expectedTextureNames: named,
    nativeSkin: ascii.nativeSkin ?? null,
    materialTextures,
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

/**
 * Parse and normalize an FBX. Skinned meshes are baked at bind/rest pose;
 * native weights align one-for-one with emitted OBJ vertices.
 */
export async function importFbx(
  bytes: Uint8Array,
  options: FbxImportOptions,
): Promise<FbxImportResult> {
  const onProgress = options.onProgress ?? (() => {})
  const rawSiblings = options.siblings ?? {}
  let remaps = { ...(options.materialTextures ?? {}) }
  const referenced = collectFbxTextureNames(bytes)
  const prepared = await resolveTextureSiblings(
    [...referenced, ...Object.values(remaps)].filter(isRasterTextureName),
    rawSiblings,
  )
  let siblings = prepared.files
  const retarget = (parsed: FbxAsciiImport | null, maps = remaps) => {
    if (!parsed || Object.keys(maps).length === 0) return parsed
    const unique = [...new Set(Object.values(maps).filter(Boolean))]
    const materialNames = new Set(
      parsed.meshes
        .map((mesh) => (mesh.materialName ?? '').toLowerCase())
        .filter(Boolean),
    )
    for (const mesh of parsed.meshes) {
      const hit = materialLookupKeys(mesh.materialName ?? '').map((key) => maps[key]).find(Boolean)
        ?? maps[mesh.name.toLowerCase()]
      if (hit) {
        mesh.mapFile = hit
        continue
      }
      // One Unity .mat next to a one-material FBX (AFK outfits with empty
      // externalObjects) — apply that albedo even when names don't match.
      if (unique.length === 1 && materialNames.size <= 1) mesh.mapFile = unique[0]
    }
    return parsed
  }
  const applyUnity = async (parsed: FbxAsciiImport | null) => {
    if (!options.sourceFile || Object.keys(remaps).length > 0) return retarget(parsed)
    try {
      const names = [
        ...new Set(
          (parsed?.meshes ?? [])
            .map((mesh) => mesh.materialName)
            .filter((name): name is string => Boolean(name)),
        ),
      ]
      onProgress('Resolving Unity materials…')
      const index = await buildUnityTextureIndex(options.sourceFile, names)
      if (!index) return retarget(parsed)
      const loaded = await loadUnityTextures(index, siblings)
      siblings = { ...siblings, ...loaded.siblings }
      remaps = loaded.materialTextures
      return retarget(parsed)
    } catch (error) {
      logDebug('[fbx] Unity remap failed:', error)
      return retarget(parsed)
    }
  }
  const withEmbedded = (parsed: FbxAsciiImport | null) => {
    if (!parsed?.embeddedTextures || Object.keys(parsed.embeddedTextures).length === 0) {
      return siblings
    }
    return { ...parsed.embeddedTextures, ...siblings }
  }
  const warnings: string[] = []

  let direct: FbxAsciiImport | null = null
  if (isFbxBinary(bytes)) {
    onProgress('Reading FBX geometry…')
    await yieldToUi()
    try {
      direct = parseFbxBinary(bytes)
    } catch (error) {
      logDebug('[fbx] binary mesh reader failed:', error)
    }
    siblings = withEmbedded(direct)
    direct = await applyUnity(direct)
    // Prefer the direct reader whenever it produced a mesh. Three.js FBXLoader
    // still throws `undefined[0]` on Texture Scaling / empty Video links, and
    // it also double-flips UVs relative to the voxelizer.
    if (direct && direct.meshes.length > 0) {
      return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
    }
  } else {
    try {
      direct = parseFbxAscii(bytes)
    } catch (error) {
      logDebug('[fbx] ASCII reader failed:', error)
    }
    siblings = withEmbedded(direct)
    direct = await applyUnity(direct)
    if (direct && direct.meshes.length > 0) {
      onProgress('Parsing FBX ASCII…')
      return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
    }
  }

  const directUsable = Boolean(direct && direct.meshes.length > 0)

  if (isFbxBinary(bytes)) {
    const version = fbxBinaryVersion(bytes)
    if (version != null && version < 6400) {
      if (directUsable && direct) {
        return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
      }
      throw new Error(
        `FBX binary version ${version} is too old for the binary loader. Re-export as FBX 7.4 binary, or as FBX 6/7 ASCII.`,
      )
    }
  }

  onProgress('Parsing FBX…')
  await yieldToUi()
  let parsed: { group: THREE.Group; revoke: () => void }
  try {
    parsed = await parseFbxScene(bytes, siblings)
  } catch (error) {
    if (directUsable && direct) {
      logDebug('[fbx] Three.js parse failed, using direct mesh:', error)
      return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
    }
    throw friendlyFbxError(error)
  }
  const scene = parsed.group
  try {
    scene.updateMatrixWorld(true)
    const allBones: THREE.Bone[] = []
    const boneSeen = new Set<string>()
    let morphMeshes = 0
    scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) {
        for (const bone of mesh.skeleton.bones) {
          if (!boneSeen.has(bone.uuid)) {
            boneSeen.add(bone.uuid)
            allBones.push(bone)
          }
        }
      }
      if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).morphTargetInfluences?.length) {
        morphMeshes += 1
      }
    })
    const globalBoneIndex = new Map(allBones.map((bone, index) => [bone.uuid, index]))

    const writer = new ObjTextWriter()
    writer.line('# Generated from FBX')
    writer.line('mtllib model.mtl')
    writer.line('')
    const materials = new Map<string, MaterialEntry>()
    const materialNames = new Set<string>()
    const textures: Record<string, Uint8Array> = {}
    const allPositions: number[] = []
    const nativeIndices: number[] = []
    const nativeWeights: number[] = []
    let vertexOffset = 0
    let uvOffset = 0
    let meshCount = 0
    let materialSerial = 0
    let textureSerial = 0

    const objects: THREE.Mesh[] = []
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) objects.push(object as THREE.Mesh)
    })

    const fallbackMaterial = new THREE.MeshStandardMaterial({
      name: 'default',
      color: 0xbfbfbf,
    })

    onProgress('Building mesh…')
    for (const mesh of objects) {
      const source = mesh.geometry
      if (!source?.getAttribute('position')) continue
      const geometry = source.index ? source.toNonIndexed() : source.clone()
      const pos = geometry.getAttribute('position')
      const uv = geometry.getAttribute('uv')
      const skinIndex = geometry.getAttribute('skinIndex')
      const skinWeight = geometry.getAttribute('skinWeight')
      const skinned = mesh as THREE.SkinnedMesh
      const isSkinned = Boolean(skinned.isSkinnedMesh && skinIndex && skinWeight)
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: pos.count, materialIndex: 0 }]

      for (const group of groups) {
        const material = meshMaterials[group.materialIndex ?? 0] ?? meshMaterials[0] ?? fallbackMaterial
        const unityTexture =
          materialLookupKeys(material.name).map((key) => remaps[key]).find(Boolean)
          ?? remaps[mesh.name.toLowerCase()]
        // A material shared by meshes can still resolve per-mesh through Unity.
        const materialKey = `${material.uuid}|${unityTexture ?? ''}`
        let materialEntry = materials.get(materialKey)
        if (!materialEntry) {
          materialSerial += 1
          const base = safeName(material.name, `material_${materialSerial}`)
          let name = base
          let serial = 2
          while (materialNames.has(name)) name = `${base}_${serial++}`
          materialNames.add(name)
          const map = textureForMaterial(material)
          const fromUnity = unityTexture ? lookupSibling(siblings, unityTexture) : null
          const sibling: [string, Uint8Array] | null = fromUnity
            ? [fromUnity.fileName, fromUnity.bytes]
            : textureSibling(map, siblings)
          let mapKd: string | null = null
          if (sibling) {
            mapKd = prepared.fileNameFor(sibling[0]) ?? sibling[0]
            textures[mapKd.toLowerCase()] = sibling[1]
          } else if (map && !isPlaceholderMap(map) && map.image) {
            const png = await imageSourceToPng(map.image)
            if (png && png.length > 96) {
              textureSerial += 1
              const fileName = `fbx_tex_${textureSerial}.png`
              textures[fileName] = png
              mapKd = fileName
            }
          }
          materialEntry = {
            name,
            kd: mapKd ? [1, 1, 1] : displayRgb(material),
            mapKd,
          }
          materials.set(materialKey, materialEntry)
        }

        const objectName = safeName(mesh.name, `mesh_${meshCount + 1}`)
        writer.line(`o ${objectName}`)
        writer.line(`usemtl ${materialEntry.name}`)
        const start = Math.max(0, group.start)
        const end = Math.min(pos.count, start + group.count)
        const count = end - start
        const mirrored = mesh.matrixWorld.determinant() < 0

        for (let i = start; i < end; i += 1) {
          const point = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
          if (isSkinned) applyImportedSkin(skinned, point, i, skinIndex, skinWeight)
          point.applyMatrix4(mesh.matrixWorld)
          writer.line(`v ${point.x} ${point.y} ${point.z}`)
          allPositions.push(point.x, point.y, point.z)

          for (let k = 0; k < 4; k += 1) {
            if (isSkinned) {
              const localIndex = Math.round(skinIndex.getComponent(i, k))
              const bone = skinned.skeleton.bones[localIndex]
              nativeIndices.push(bone ? globalBoneIndex.get(bone.uuid) ?? -1 : -1)
              nativeWeights.push(skinWeight.getComponent(i, k))
            } else {
              nativeIndices.push(-1)
              nativeWeights.push(0)
            }
          }
          if ((i & 4095) === 0) await writer.flushIfNeeded()
        }
        if (uv) {
          const map = textureForMaterial(material)
          for (let i = start; i < end; i += 1) {
            const [uu, vv] = objUvFromThree(uv.getX(i), uv.getY(i), map)
            writer.line(`vt ${uu} ${vv}`)
          }
        }
        for (let i = 0; i + 2 < count; i += 3) {
          const ids = mirrored ? [i, i + 2, i + 1] : [i, i + 1, i + 2]
          const refs = ids.map((local) => {
            const vi = vertexOffset + local + 1
            return uv ? `${vi}/${uvOffset + local + 1}` : `${vi}`
          })
          writer.line(`f ${refs.join(' ')}`)
        }
        vertexOffset += count
        if (uv) uvOffset += count
        writer.line('')
        meshCount += 1
      }
      geometry.dispose()
    }

    if (meshCount === 0 || allPositions.length < 9) {
      if (directUsable && direct) {
        return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
      }
      throw new Error('No mesh geometry found in FBX file')
    }

    const objBytes = await writer.finish()
    const mtl: string[] = ['# Generated from FBX', '']
    for (const material of materials.values()) {
      mtl.push(`newmtl ${material.name}`)
      mtl.push(`Kd ${material.kd.join(' ')}`)
      mtl.push('d 1.0')
      if (material.mapKd) mtl.push(`map_Kd ${material.mapKd}`)
      mtl.push('')
    }

    const attached = new Set(Object.keys(textures))
    const named = [...new Set(referenced.map((name) => basename(name)))]
    const missing = named.filter((name) => {
      const fold = foldExportName(name)
      if ([...attached].some((key) => foldExportName(key) === fold)) return false
      if (findTextureBytes(siblings, name)) return false
      const pngName = prepared.fileNameFor(name)
      if (pngName && [...attached].some((key) => foldExportName(key) === foldExportName(pngName))) return false
      return true
    })
    if (missing.length) {
      warnings.push(
        `Missing texture${missing.length === 1 ? '' : 's'} (${missing.join(', ')}) — mesh uses material colour`,
      )
    }
    const clips = scene.animations?.length ?? 0
    if (clips > 0) {
      warnings.push(
        `${clips} animation clip${clips === 1 ? '' : 's'} imported at rest pose`,
      )
    }
    if (morphMeshes > 0) {
      warnings.push(
        `${morphMeshes} morph/blend-shape mesh${morphMeshes === 1 ? '' : 'es'} baked at basis (influences 0)`,
      )
    }

    const rig = buildNativeRig(allBones, allPositions)
    const nativeSkin = rig
      ? {
          rig,
          skin: {
            indices: Int16Array.from(nativeIndices),
            weights: Float32Array.from(nativeWeights),
            vertexCount: allPositions.length / 3,
          },
        }
      : null
    const label = [`FBX · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}`]
    if (rig) label.push(`${rig.bones.length} native bones`)
    onProgress('Done')
    return {
      objBytes,
      mtlBytes: new TextEncoder().encode(mtl.join('\n')),
      textures,
      meshCount,
      warnings,
      sourceLabel: label.join(' · '),
      expectedTextureNames: named,
      nativeSkin,
      materialTextures: remaps,
    }
  } catch (error) {
    if (directUsable && direct) {
      logDebug('[fbx] Three.js bake failed, using direct mesh:', error)
      return resultFromAscii(direct, siblings, prepared, referenced, onProgress, remaps)
    }
    throw friendlyFbxError(error)
  } finally {
    revokeTextureBlobs(scene)
    parsed.revoke()
  }
}
