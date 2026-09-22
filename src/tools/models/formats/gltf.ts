/** glTF 2.0 (.gltf / .glb) → Wavefront OBJ + MTL + PNG textures (static meshes). */

import * as THREE from 'three'
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { listLocalDirectory, logDebug } from '../../../api'
import {
  isRasterTextureName,
  isWantedTextureOnDisk,
  mimeForTextureBytes,
  resolveTextureSiblings,
  textureNamesToProbe,
} from '../decodeImage'
import { basename, fileSystemPath, tryReadSiblingBytes } from '../objAssets'
import { decodeExportText, repairMojibake } from '../exportText'
import { ObjTextWriter } from '../objStream'

export { gltfFormat, isGltfFileName } from './gltfMeta'

export type GltfImportOptions = {
  fileName: string
  /** Relative resource path passed to GLTFLoader (usually ''). */
  resourcePath?: string
  /** Lowercase basename → bytes for external .bin / textures. */
  siblings?: Record<string, Uint8Array>
  onProgress?: (label: string) => void
}

export type GltfImportResult = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textures: Record<string, Uint8Array>
  meshCount: number
  skippedSkinned: number
  warnings: string[]
  sourceLabel: string
}

type MtlEntry = {
  name: string
  Kd: [number, number, number]
  mapKd: string | null
  useVertexColors: boolean
}

let sharedDraco: DRACOLoader | null = null

function getDracoLoader(): DRACOLoader {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader()
    sharedDraco.setDecoderPath(DRACO_GLTF_CONFIG)
  }
  return sharedDraco
}

function sanitizeMtlName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * glTF URIs are often percent-encoded (`TV%20Plasma.bin`). Decode to a disk basename
 * so sibling lookup matches real files with spaces / unicode.
 */
export function decodeGltfUriBasename(uri: string): string {
  const clean = uri.split('?')[0] ?? uri
  const base = basename(clean)
  try {
    return repairMojibake(decodeURIComponent(base)).normalize('NFC')
  } catch {
    return repairMojibake(base).normalize('NFC')
  }
}

/** Collect external buffer/image URIs from a JSON .gltf (not GLB). */
export function collectGltfExternalUris(bytes: Uint8Array): string[] {
  if (bytes.length >= 4) {
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    if (magic === 'glTF') return []
  }
  const text = decodeExportText(bytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const out: string[] = []
  const pushUri = (uri: unknown) => {
    if (typeof uri !== 'string' || uri.length === 0) return
    if (/^(data:|blob:|https?:)/i.test(uri)) return
    const name = decodeGltfUriBasename(uri)
    if (name) out.push(name)
  }
  for (const buffer of Array.isArray(root.buffers) ? root.buffers : []) {
    if (buffer && typeof buffer === 'object') pushUri((buffer as { uri?: unknown }).uri)
  }
  for (const image of Array.isArray(root.images) ? root.images : []) {
    if (image && typeof image === 'object') pushUri((image as { uri?: unknown }).uri)
  }
  return [...new Set(out.filter(Boolean))]
}

/**
 * Auto-load .bin / textures named by a .gltf from the same folder (and optional drop).
 * Never throws for missing files — returns whatever was found.
 */
export async function autoLoadGltfSiblings(
  gltfFile: File,
  gltfBytes: Uint8Array,
  options?: {
    already?: Record<string, Uint8Array>
    droppedFiles?: File[]
    readDropped?: (file: File) => Promise<Uint8Array>
  },
): Promise<Record<string, Uint8Array>> {
  const found: Record<string, Uint8Array> = { ...(options?.already ?? {}) }
  const wanted = collectGltfExternalUris(gltfBytes)
  if (wanted.length === 0) return found

  const readDropped = options?.readDropped
  const dropped = options?.droppedFiles ?? []
  const toLoad = new Set<string>()
  for (const name of wanted) {
    for (const alias of textureNamesToProbe(name)) toLoad.add(alias)
  }

  for (const name of toLoad) {
    const key = name.toLowerCase()
    if (found[key]) continue

    const fromDrop = dropped.find((f) => basename(f.name).toLowerCase() === key)
    if (fromDrop && readDropped) {
      found[key] = await readDropped(fromDrop)
      continue
    }

    const fromDisk = await tryReadSiblingBytes(gltfFile, name)
    if (fromDisk && fromDisk.length > 0) {
      found[key] = fromDisk
    }
  }

  // Case-insensitive folder scan for anything still missing (handles encoding / casing).
  const stillMissing = [...toLoad].filter((name) => !found[name.toLowerCase()])
  const sourcePath = fileSystemPath(gltfFile)
  if (stillMissing.length > 0 && sourcePath) {
    const cut = Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/'))
    const dir = cut >= 0 ? sourcePath.slice(0, cut) : ''
    if (dir) {
      try {
        const names = await listLocalDirectory(dir)
        const byLower = new Map(names.map((n) => [n.toLowerCase(), n]))
        for (const want of stillMissing) {
          const key = want.toLowerCase()
          if (found[key]) continue
          const diskName = byLower.get(key)
          if (!diskName) continue
          const bytes = await tryReadSiblingBytes(gltfFile, diskName)
          if (bytes && bytes.length > 0) {
            found[key] = bytes
            logDebug(`[gltf] auto-found sibling ${diskName}`)
          }
        }
        const imageWanted = wanted.filter(isRasterTextureName)
        for (const diskName of names) {
          if (!isRasterTextureName(diskName)) continue
          const key = diskName.toLowerCase()
          if (found[key]) continue
          if (!isWantedTextureOnDisk(diskName, imageWanted)) continue
          const bytes = await tryReadSiblingBytes(gltfFile, diskName)
          if (bytes && bytes.length > 0) {
            found[key] = bytes
            logDebug(`[gltf] auto-found sibling ${diskName}`)
          }
        }
      } catch (error) {
        logDebug('[gltf] folder scan failed:', error)
      }
    }
  }

  const missing = wanted.filter((name) => !found[name.toLowerCase()])
  if (missing.length > 0) {
    logDebug(`[gltf] still missing after auto-find: ${missing.join(', ')}`)
  } else {
    logDebug(`[gltf] auto-loaded companions: [${Object.keys(found).join(', ')}]`)
  }
  return found
}

function mimeForSibling(name: string, bytes?: Uint8Array): string {
  return mimeForTextureBytes(name, bytes)
}

/** 1×1 white PNG — keeps GLTFLoader happy when a texture file is missing. */
const PLACEHOLDER_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export type EmbedGltfResult = {
  bytes: Uint8Array
  /** Revoke blob: URLs created for external buffers/images. */
  revoke: () => void
}

/**
 * Rewrite external buffer/image URIs to blob: URLs (not base64 — avoids ~4/3 RAM blowup).
 * Avoids LoadingManager/fetch issues with file:// paths in some hosts.
 */
export function embedGltfSiblings(
  gltfBytes: Uint8Array,
  siblings: Record<string, Uint8Array>,
): EmbedGltfResult {
  const revokeUrls: string[] = []
  const revoke = () => {
    for (const url of revokeUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // ignore
      }
    }
    revokeUrls.length = 0
  }

  if (gltfBytes.length >= 4) {
    const magic = String.fromCharCode(gltfBytes[0], gltfBytes[1], gltfBytes[2], gltfBytes[3])
    if (magic === 'glTF') return { bytes: gltfBytes, revoke }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeExportText(gltfBytes))
  } catch {
    return { bytes: gltfBytes, revoke }
  }
  if (!parsed || typeof parsed !== 'object') return { bytes: gltfBytes, revoke }
  const root = parsed as Record<string, unknown>

  const rewrite = (uri: unknown, kind: 'buffer' | 'image'): string | unknown => {
    if (typeof uri !== 'string' || uri.length === 0) return uri
    if (/^(data:|blob:|https?:)/i.test(uri)) return uri
    const key = decodeGltfUriBasename(uri).toLowerCase()
    const bytes = siblings[key]
    if (bytes) {
      const mime = kind === 'image' ? mimeForSibling(key, bytes) : 'application/octet-stream'
      // Small payloads: data URI (reliable in tests / LoadingManager).
      // Large payloads: blob URL avoids the ~4/3 base64 RAM blowup that caused OOMs.
      if (bytes.length <= 512 * 1024) {
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        return `data:${mime};base64,${btoa(binary)}`
      }
      const copy = new Uint8Array(bytes)
      const url = URL.createObjectURL(new Blob([copy as BlobPart], { type: mime }))
      revokeUrls.push(url)
      return url
    }
    // Missing image: placeholder so import still works. Missing buffer: leave as-is (loader will error).
    if (kind === 'image') return PLACEHOLDER_PNG_DATA_URI
    return uri
  }

  if (Array.isArray(root.buffers)) {
    for (const buffer of root.buffers) {
      if (buffer && typeof buffer === 'object') {
        const b = buffer as { uri?: unknown }
        b.uri = rewrite(b.uri, 'buffer')
      }
    }
  }
  if (Array.isArray(root.images)) {
    for (const image of root.images) {
      if (image && typeof image === 'object') {
        const img = image as { uri?: unknown }
        img.uri = rewrite(img.uri, 'image')
      }
    }
  }

  return {
    bytes: new TextEncoder().encode(JSON.stringify(root)),
    revoke,
  }
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(null)
          return
        }
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
      },
      'image/png',
    )
  })
}

async function imageSourceToPng(image: unknown): Promise<Uint8Array | null> {
  if (!image) return null

  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return canvasToPngBytes(image)
  }

  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    const blob = await image.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }

  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return canvasToPngBytes(canvas)
  }

  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    if (canvas.width <= 0 || canvas.height <= 0) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image, 0, 0)
    return canvasToPngBytes(canvas)
  }

  // DataTexture / raw pixel buffer
  if (
    typeof image === 'object'
    && image !== null
    && 'data' in image
    && 'width' in image
    && 'height' in image
  ) {
    const src = image as { data: ArrayBufferView; width: number; height: number }
    const w = src.width
    const h = src.height
    if (!(w > 0 && h > 0)) return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const rgba = new Uint8ClampedArray(src.data.buffer, src.data.byteOffset, src.data.byteLength)
    const expected = w * h * 4
    if (rgba.length < expected) return null
    ctx.putImageData(new ImageData(rgba.slice(0, expected), w, h), 0, 0)
    return canvasToPngBytes(canvas)
  }

  return null
}

function materialBaseColor(mat: THREE.Material): [number, number, number] {
  const anyMat = mat as THREE.MeshStandardMaterial & { color?: THREE.Color }
  if (anyMat.color && typeof anyMat.color.r === 'number') {
    return toDisplayRgb(anyMat.color)
  }
  return [0.8, 0.8, 0.8]
}

/** Linear working-space → 0–1 display RGB for MTL Kd / vertex colors. */
function toDisplayRgb(color: THREE.Color): [number, number, number] {
  const out = color.clone()
  if (THREE.ColorManagement?.enabled) {
    out.convertLinearToSRGB()
  }
  return [
    Math.min(1, Math.max(0, out.r)),
    Math.min(1, Math.max(0, out.g)),
    Math.min(1, Math.max(0, out.b)),
  ]
}

function materialBaseMap(mat: THREE.Material): THREE.Texture | null {
  const anyMat = mat as THREE.MeshStandardMaterial
  if (anyMat.map) return anyMat.map
  return null
}

function applyMatrixToGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  geo.applyMatrix4(matrix)
  return geo
}

/**
 * glTF TEXCOORD V=0 is top; mapart OBJ consumers (preview + Rust) assume
 * OpenGL/OBJ V=0 at bottom and sample with `1 - v`. Convert here.
 * Also bake Three texture offset/repeat/rotation when present.
 */
export function gltfUvToObj(u: number, v: number, texture: THREE.Texture | null): [number, number] {
  let uu = u
  let vv = v
  if (texture) {
    texture.updateMatrix()
    const e = texture.matrix.elements
    const x = uu
    const y = vv
    uu = e[0]! * x + e[3]! * y + e[6]!
    vv = e[1]! * x + e[4]! * y + e[7]!
  }
  return [uu, 1 - vv]
}

function nearlyWhite(rgb: [number, number, number], eps = 0.02): boolean {
  return Math.abs(rgb[0] - 1) <= eps && Math.abs(rgb[1] - 1) <= eps && Math.abs(rgb[2] - 1) <= eps
}

function findSiblingTextureBytes(
  siblings: Record<string, Uint8Array>,
  texture: THREE.Texture,
): { fileName: string; bytes: Uint8Array } | null {
  const candidates: string[] = []
  const push = (raw: string | undefined | null) => {
    if (!raw) return
    const base = basename(raw.split('?')[0] ?? raw)
    if (!base) return
    candidates.push(base.toLowerCase())
    if (!/\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i.test(base)) {
      candidates.push(`${base.toLowerCase()}.png`, `${base.toLowerCase()}.jpg`)
    }
  }
  push(texture.name)
  const image = texture.image as { src?: string; name?: string } | undefined
  if (image && typeof image === 'object') {
    push(image.name)
    if (typeof image.src === 'string' && !image.src.startsWith('data:')) {
      push(image.src)
    }
  }
  for (const key of candidates) {
    const hit = siblings[key]
    if (hit && hit.length > 0) return { fileName: key.includes('.') ? key : `${key}.png`, bytes: hit }
  }
  // Single image sibling — common for simple textured props.
  const images = Object.entries(siblings).filter(([name]) =>
    /\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i.test(name)
  )
  if (images.length === 1) {
    const [fileName, bytes] = images[0]!
    return { fileName, bytes }
  }
  return null
}

async function multiplyPngByColor(
  pngBytes: Uint8Array,
  rgb: [number, number, number],
): Promise<Uint8Array | null> {
  if (nearlyWhite(rgb)) return pngBytes
  const bitmap = await createImageBitmap(new Blob([pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength) as ArrayBuffer]))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return pngBytes
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.round((data[i] ?? 0) * rgb[0]))
      data[i + 1] = Math.min(255, Math.round((data[i + 1] ?? 0) * rgb[1]))
      data[i + 2] = Math.min(255, Math.round((data[i + 2] ?? 0) * rgb[2]))
    }
    ctx.putImageData(imageData, 0, 0)
    return (await canvasToPngBytes(canvas)) ?? pngBytes
  } finally {
    bitmap.close()
  }
}

type MeshBake = {
  positions: number[]
  uvs: number[]
  colors: number[]
  hasUv: boolean
  hasColor: boolean
  mtlName: string
  objectName: string
  mirrored: boolean
}

/**
 * Convert a static glTF / GLB buffer into OBJ + MTL + optional PNG textures.
 * Skinned meshes are skipped (v1); throws if no static geometry remains.
 */
export async function importGltf(
  bytes: Uint8Array,
  options: GltfImportOptions,
): Promise<GltfImportResult> {
  const onProgress = options.onProgress ?? (() => {})
  onProgress('Parsing GLTF…')

  const rawSiblings = options.siblings ?? {}
  const imageNames = collectGltfExternalUris(bytes).filter(isRasterTextureName)
  const prepared = await resolveTextureSiblings(imageNames, rawSiblings)
  const siblings = prepared.files
  const embedded = embedGltfSiblings(bytes, siblings)

  const manager = new THREE.LoadingManager()
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(getDracoLoader())

  let gltf: Awaited<ReturnType<typeof loader.parseAsync>>
  try {
    const copy = new Uint8Array(embedded.bytes.byteLength)
    copy.set(embedded.bytes)
    gltf = await loader.parseAsync(copy.buffer, options.resourcePath ?? '')
  } finally {
    // Revoke after parse returns; GLTFLoader has resolved buffer/image URIs by then.
    embedded.revoke()
  }

  onProgress('Building mesh…')
  gltf.scene.updateMatrixWorld(true)

  const warnings: string[] = []
  let skippedSkinned = 0
  const bakes: MeshBake[] = []
  const mtlByUuid = new Map<string, MtlEntry>()
  const mtlNamesUsed = new Set<string>()
  const textures: Record<string, Uint8Array> = {}
  let textureSerial = 0
  let mtlSerial = 0

  const uniqueMtlName = (raw: string, fallback: string): string => {
    let base = sanitizeMtlName(raw, fallback)
    if (!mtlNamesUsed.has(base)) {
      mtlNamesUsed.add(base)
      return base
    }
    let n = 2
    while (mtlNamesUsed.has(`${base}_${n}`)) n += 1
    const named = `${base}_${n}`
    mtlNamesUsed.add(named)
    return named
  }

  const ensureMtl = async (mat: THREE.Material, fallbackName: string): Promise<MtlEntry> => {
    const existing = mtlByUuid.get(mat.uuid)
    if (existing) return existing

    mtlSerial += 1
    const name = uniqueMtlName(mat.name || fallbackName, `mat_${mtlSerial}`)
    const Kd = materialBaseColor(mat)
    const map = materialBaseMap(mat)
    let mapKd: string | null = null

    if (map?.image) {
      const sibling = findSiblingTextureBytes(siblings, map)
      let png: Uint8Array | null = null
      let fileName: string
      if (sibling) {
        fileName = prepared.fileNameFor(sibling.fileName) ?? basename(sibling.fileName)
        png = nearlyWhite(Kd)
          ? sibling.bytes
          : (await multiplyPngByColor(sibling.bytes, Kd)) ?? sibling.bytes
      } else {
        textureSerial += 1
        fileName = `gltf_tex_${textureSerial}.png`
        png = await imageSourceToPng(map.image)
        if (png && !nearlyWhite(Kd)) {
          png = (await multiplyPngByColor(png, Kd)) ?? png
        }
      }
      if (png && png.length > 0) {
        textures[fileName.toLowerCase()] = png
        mapKd = fileName
      }
    }

    const entry: MtlEntry = {
      name,
      // When texture carries the tint, keep Kd white so consumers don't double-tint.
      Kd: mapKd ? [1, 1, 1] : Kd,
      mapKd,
      useVertexColors: !mapKd,
    }
    mtlByUuid.set(mat.uuid, entry)
    return entry
  }

  const meshObjects: THREE.Object3D[] = []
  gltf.scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshObjects.push(obj)
  })

  for (const obj of meshObjects) {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      skippedSkinned += 1
      continue
    }
    const mesh = obj as THREE.Mesh
    if (!mesh.geometry) continue

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const matrix = mesh.matrixWorld
    const mirrored = matrix.determinant() < 0
    const baseGeo = applyMatrixToGeometry(mesh.geometry, matrix)

    const groups =
      baseGeo.groups.length > 0
        ? baseGeo.groups
        : [{ start: 0, count: baseGeo.getAttribute('position')?.count ?? 0, materialIndex: 0 }]

    const posAttr = baseGeo.getAttribute('position')
    if (!posAttr || posAttr.count === 0) {
      baseGeo.dispose()
      continue
    }
    const uvAttr = baseGeo.getAttribute('uv')
    const colorAttr = baseGeo.getAttribute('color')

    for (const group of groups) {
      const matIndex = group.materialIndex ?? 0
      const mat = materials[matIndex] ?? materials[0]
      if (!mat) continue
      const mtl = await ensureMtl(mat, `mat_${mtlSerial + 1}`)
      const map = materialBaseMap(mat)
      const bake: MeshBake = {
        positions: [],
        uvs: [],
        colors: [],
        hasUv: Boolean(uvAttr) && Boolean(mtl.mapKd),
        hasColor: false,
        mtlName: mtl.name,
        objectName: sanitizeMtlName(mesh.name || mtl.name, `mesh_${bakes.length + 1}`),
        mirrored,
      }

      const end = Math.min(group.start + group.count, posAttr.count)
      for (let i = group.start; i < end; i += 1) {
        bake.positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
        if (bake.hasUv && uvAttr) {
          const [u, v] = gltfUvToObj(uvAttr.getX(i), uvAttr.getY(i), map)
          bake.uvs.push(u, v)
        }
        if (colorAttr) {
          const c = new THREE.Color(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i))
          const [r, g, b] = toDisplayRgb(c)
          // Vertex color × base tint when untextured
          if (mtl.useVertexColors && !nearlyWhite(mtl.Kd)) {
            bake.colors.push(r * mtl.Kd[0], g * mtl.Kd[1], b * mtl.Kd[2])
          } else {
            bake.colors.push(r, g, b)
          }
          bake.hasColor = true
        } else if (mtl.useVertexColors) {
          bake.colors.push(mtl.Kd[0], mtl.Kd[1], mtl.Kd[2])
          bake.hasColor = true
        }
      }

      if (bake.positions.length >= 9) bakes.push(bake)
    }

    baseGeo.dispose()
  }

  if (skippedSkinned > 0) {
    warnings.push(`Skipped ${skippedSkinned} skinned mesh${skippedSkinned === 1 ? '' : 'es'} (static meshes only in v1)`)
  }

  if (bakes.length === 0) {
    if (skippedSkinned > 0) {
      throw new Error(
        'This glTF only contains skinned/rigged meshes. Static mesh import is supported in v1 — export a static mesh or bake the pose.',
      )
    }
    throw new Error('No mesh geometry found in glTF / GLB')
  }

  // Emit OBJ in chunks so we never hold a giant string + encoded copy.
  const writer = new ObjTextWriter()
  writer.line('# Generated from glTF')
  writer.line('mtllib model.mtl')
  writer.line('')
  let vOffset = 0
  let vtOffset = 0

  for (const bake of bakes) {
    writer.line(`o ${bake.objectName}`)
    writer.line(`usemtl ${bake.mtlName}`)
    const vertCount = bake.positions.length / 3
    for (let i = 0; i < vertCount; i += 1) {
      const x = bake.positions[i * 3]!
      const y = bake.positions[i * 3 + 1]!
      const z = bake.positions[i * 3 + 2]!
      if (bake.hasColor) {
        const r = bake.colors[i * 3]!
        const g = bake.colors[i * 3 + 1]!
        const b = bake.colors[i * 3 + 2]!
        writer.line(`v ${x} ${y} ${z} ${r} ${g} ${b}`)
      } else {
        writer.line(`v ${x} ${y} ${z}`)
      }
      if ((i & 4095) === 0) await writer.flushIfNeeded()
    }
    if (bake.hasUv) {
      for (let i = 0; i < vertCount; i += 1) {
        writer.line(`vt ${bake.uvs[i * 2]!} ${bake.uvs[i * 2 + 1]!}`)
      }
    }
    for (let i = 0; i + 2 < vertCount; i += 3) {
      let a = vOffset + i + 1
      let b = vOffset + i + 2
      let c = vOffset + i + 3
      let ta = vtOffset + i + 1
      let tb = vtOffset + i + 2
      let tc = vtOffset + i + 3
      // Negative-scale nodes flip winding; restore CCW for correct normals.
      if (bake.mirrored) {
        ;[b, c] = [c, b]
        ;[tb, tc] = [tc, tb]
      }
      if (bake.hasUv) {
        writer.line(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`)
      } else {
        writer.line(`f ${a} ${b} ${c}`)
      }
    }
    vOffset += vertCount
    if (bake.hasUv) vtOffset += vertCount
    writer.line('')
    await writer.flushIfNeeded()
    // Free bake arrays early.
    bake.positions.length = 0
    bake.uvs.length = 0
    bake.colors.length = 0
  }

  const objBytes = await writer.finish()

  const mtlLines: string[] = ['# Generated from glTF', '']
  for (const entry of mtlByUuid.values()) {
    mtlLines.push(`newmtl ${entry.name}`)
    mtlLines.push(`Kd ${entry.Kd[0]} ${entry.Kd[1]} ${entry.Kd[2]}`)
    mtlLines.push('d 1.0')
    if (entry.mapKd) mtlLines.push(`map_Kd ${entry.mapKd}`)
    mtlLines.push('')
  }

  const meshCount = bakes.length
  const labelBits = [`GLTF · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}`]
  if (skippedSkinned > 0) labelBits.push(`${skippedSkinned} skinned skipped`)
  const sourceLabel = labelBits.join(' · ')

  onProgress('Done')
  return {
    objBytes,
    mtlBytes: new TextEncoder().encode(mtlLines.join('\n')),
    textures,
    meshCount,
    skippedSkinned,
    warnings,
    sourceLabel,
  }
}
