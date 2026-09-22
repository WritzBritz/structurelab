/**
 * COLLADA (.dae) → StructureLab's canonical OBJ + MTL package.
 *
 * The official Three.js loader handles COLLADA's scene graph, units, axis,
 * profile_COMMON materials and skin controllers. We then bake the scene to OBJ
 * while retaining a native bone rig + its original four skin influences.
 */

import * as THREE from 'three'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { mimeForTextureBytes, resolveTextureSiblings } from '../decodeImage'
import { decodeExportText, repairMojibake } from '../exportText'
import { basename } from '../objAssets'
import { autoLoadSidecarTextures } from '../sidecarTextures'
import { ObjTextWriter } from '../objStream'
import type { MeshBoneDef, MeshBoneRig, MeshBoneWeights } from '../meshBoneRig'

export { daeFormat, isDaeFileName } from './daeMeta'

export type DaeImportOptions = {
  fileName: string
  siblings?: Record<string, Uint8Array>
  onProgress?: (label: string) => void
}

export type DaeNativeSkin = {
  rig: MeshBoneRig
  skin: MeshBoneWeights
}

export type DaeImportResult = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textures: Record<string, Uint8Array>
  meshCount: number
  warnings: string[]
  sourceLabel: string
  expectedTextureNames: string[]
  nativeSkin: DaeNativeSkin | null
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i

function decodeXml(bytes: Uint8Array): string {
  const text = decodeExportText(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function decodeRef(raw: string): string {
  let value = repairMojibake(raw.trim()).replaceAll('\\', '/')
  if (/^file:/i.test(value)) {
    value = value.replace(/^file:\/+/i, '')
    // file:///C:/... becomes C:/...
    if (/^\/?[a-z]:\//i.test(value)) value = value.replace(/^\//, '')
  }
  value = value.split(/[?#]/)[0] ?? value
  try {
    value = decodeURIComponent(value)
  } catch {
    // Keep malformed exporter paths usable as-is.
  }
  return repairMojibake(basename(value)).normalize('NFC')
}

/** External raster files referenced by COLLADA image init_from elements. */
export function collectDaeExternalRefs(bytes: Uint8Array): string[] {
  const text = decodeXml(bytes)
  const refs: string[] = []
  const pattern = /<init_from(?:\s[^>]*)?>([\s\S]*?)<\/init_from>/gi
  for (const match of text.matchAll(pattern)) {
    const raw = (match[1] ?? '').replace(/<[^>]+>/g, '').trim()
    if (!raw || /^(data:|blob:|https?:)/i.test(raw)) continue
    const name = decodeRef(raw)
    if (name && IMAGE_EXT.test(name)) refs.push(name)
  }
  return [...new Set(refs)]
}

function collectDaeImageIds(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of text.matchAll(/<image\b([^>]*)>([\s\S]*?)<\/image>/gi)) {
    const attrs = match[1] ?? ''
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]
    const raw = /<init_from(?:\s[^>]*)?>([\s\S]*?)<\/init_from>/i.exec(match[2] ?? '')?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim()
    if (!raw) continue
    const fileName = decodeRef(raw)
    if (id) out.set(id.toLowerCase(), fileName)
    if (name) out.set(name.toLowerCase(), fileName)
  }
  const aliases = new Map<string, string>()
  for (const match of text.matchAll(/<newparam\b([^>]*)>([\s\S]*?)<\/newparam>/gi)) {
    const sid = /\bsid\s*=\s*["']([^"']+)["']/i.exec(match[1] ?? '')?.[1]
    const source =
      /<surface[\s\S]*?<init_from>([^<]+)<\/init_from>/i.exec(match[2] ?? '')?.[1]
      ?? /<sampler2D[\s\S]*?<source>([^<]+)<\/source>/i.exec(match[2] ?? '')?.[1]
    if (sid && source) aliases.set(sid.toLowerCase(), source.trim().toLowerCase())
  }
  // Resolve sampler → surface → image for exporter-specific texture names.
  for (const [sid, target] of aliases) {
    const imageKey = aliases.get(target) ?? target
    const fileName = out.get(imageKey)
    if (fileName) out.set(sid, fileName)
  }
  return out
}

export async function autoLoadDaeSiblings(
  daeFile: File,
  daeBytes: Uint8Array,
  options?: {
    already?: Record<string, Uint8Array>
    droppedFiles?: File[]
    readDropped?: (file: File) => Promise<Uint8Array>
  },
): Promise<Record<string, Uint8Array>> {
  return autoLoadSidecarTextures({
    sourceFile: daeFile,
    wanted: collectDaeExternalRefs(daeBytes),
    already: options?.already,
    droppedFiles: options?.droppedFiles,
    readDropped: options?.readDropped,
    vacuumCommonFolders: true,
  })
}

function bytesToDataUri(name: string, bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mimeForTextureBytes(name, bytes)};base64,${btoa(binary)}`
}

/** Replace local init_from paths before ColladaLoader hands them to TextureLoader. */
export function embedDaeSiblings(
  bytes: Uint8Array,
  siblings: Record<string, Uint8Array>,
): { text: string; expectedTextureNames: string[] } {
  const expectedTextureNames = collectDaeExternalRefs(bytes)
  let text = decodeXml(bytes)
  text = text.replace(
    /(<init_from(?:\s[^>]*)?>)([\s\S]*?)(<\/init_from>)/gi,
    (whole, open: string, body: string, close: string) => {
      const raw = body.replace(/<[^>]+>/g, '').trim()
      if (!raw || /^(data:|blob:|https?:)/i.test(raw)) return whole
      const name = decodeRef(raw)
      const sibling = siblings[name.toLowerCase()]
      return sibling ? `${open}${bytesToDataUri(name, sibling)}${close}` : whole
    },
  )
  return { text, expectedTextureNames }
}

function safeName(raw: string, fallback: string): string {
  const value = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return value || fallback
}

function displayRgb(material: THREE.Material): [number, number, number] {
  const color = (material as THREE.MeshBasicMaterial).color
  if (!color) return [0.8, 0.8, 0.8]
  const out = color.clone()
  if (THREE.ColorManagement.enabled) out.convertLinearToSRGB()
  return [out.r, out.g, out.b]
}

function textureForMaterial(material: THREE.Material): THREE.Texture | null {
  return (material as THREE.MeshBasicMaterial).map ?? null
}

function textureSibling(
  texture: THREE.Texture | null,
  siblings: Record<string, Uint8Array>,
  dataUriNames?: Map<string, string>,
  imageIds?: Map<string, string>,
): [string, Uint8Array] | null {
  if (!texture) return null
  const candidates: string[] = []
  const add = (raw?: string | null) => {
    if (!raw || raw.startsWith('data:')) return
    const name = decodeRef(raw)
    if (name) candidates.push(name.toLowerCase())
  }
  add(texture.name)
  const image = texture.image as { src?: string; name?: string } | undefined
  if (image?.src?.startsWith('data:')) {
    const name = dataUriNames?.get(image.src)
    if (name && siblings[name.toLowerCase()]) return [name, siblings[name.toLowerCase()]]
  }
  add(image?.name)
  add(image?.src)
  for (const key of candidates) {
    if (siblings[key]) return [key, siblings[key]]
    const referencedName = imageIds?.get(key)
    if (referencedName && siblings[referencedName.toLowerCase()]) {
      return [referencedName, siblings[referencedName.toLowerCase()]]
    }
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
  const min: [number, number, number] = [minX, minY, minZ]
  const max: [number, number, number] = [maxX, maxY, maxZ]
  return {
    min,
    max,
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
      label: bone.name || `Bone ${index + 1}`,
      head: headV.toArray() as [number, number, number],
      tip: tipV.toArray() as [number, number, number],
      hasBend: false,
      bendT: 1,
      radius: Math.max(0.01, headV.distanceTo(tipV) * 0.12),
    }
  })
  return {
    kind: 'native',
    bones: defs,
    indexOf: Object.fromEntries(defs.map((bone, index) => [bone.id, index])),
    bounds: boundsFromPositions(allPositions),
  }
}

type MaterialEntry = {
  name: string
  kd: [number, number, number]
  mapKd: string | null
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

/**
 * Parse and normalize a DAE. Native weights align one-for-one with emitted OBJ
 * vertices, including duplicates introduced while flattening indexed geometry.
 */
export async function importDae(
  bytes: Uint8Array,
  options: DaeImportOptions,
): Promise<DaeImportResult> {
  const onProgress = options.onProgress ?? (() => {})
  const rawSiblings = options.siblings ?? {}
  const prepared = await resolveTextureSiblings(collectDaeExternalRefs(bytes), rawSiblings)
  const siblings = prepared.files
  const warnings: string[] = []
  const embedded = embedDaeSiblings(bytes, siblings)
  const imageIds = collectDaeImageIds(decodeXml(bytes))
  const dataUriNames = new Map<string, string>()
  for (const name of embedded.expectedTextureNames) {
    const sibling = siblings[name.toLowerCase()]
    if (sibling) dataUriNames.set(bytesToDataUri(name, sibling), name)
  }
  onProgress('Parsing COLLADA…')

  const manager = new THREE.LoadingManager()
  const loader = new ColladaLoader(manager)
  let parsed: ReturnType<ColladaLoader['parse']>
  try {
    parsed = loader.parse(embedded.text, '')
  } catch (error) {
    throw new Error(`Could not parse COLLADA: ${String(error)}`)
  }
  if (!parsed?.scene) throw new Error('No visual scene found in COLLADA file')

  const scene = parsed.scene
  scene.updateMatrixWorld(true)
  const allBones: THREE.Bone[] = []
  const boneSeen = new Set<string>()
  scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    for (const bone of mesh.skeleton.bones) {
      if (!boneSeen.has(bone.uuid)) {
        boneSeen.add(bone.uuid)
        allBones.push(bone)
      }
    }
  })
  const globalBoneIndex = new Map(allBones.map((bone, index) => [bone.uuid, index]))

  const writer = new ObjTextWriter()
  writer.line('# Generated from COLLADA')
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

  const objects: THREE.Mesh[] = []
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) objects.push(object as THREE.Mesh)
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
      const material = meshMaterials[group.materialIndex ?? 0] ?? meshMaterials[0]
      if (!material) continue
      let materialEntry = materials.get(material.uuid)
      if (!materialEntry) {
        materialSerial += 1
        const base = safeName(material.name, `material_${materialSerial}`)
        let name = base
        let serial = 2
        while (materialNames.has(name)) name = `${base}_${serial++}`
        materialNames.add(name)
        const sibling = textureSibling(
          textureForMaterial(material),
          siblings,
          dataUriNames,
          imageIds,
        )
        const mapKd = sibling
          ? (prepared.fileNameFor(sibling[0]) ?? sibling[0])
          : null
        if (sibling && mapKd) textures[mapKd.toLowerCase()] = sibling[1]
        materialEntry = {
          name,
          kd: sibling ? [1, 1, 1] : displayRgb(material),
          mapKd,
        }
        materials.set(material.uuid, materialEntry)
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
        for (let i = start; i < end; i += 1) {
          writer.line(`vt ${uv.getX(i)} ${1 - uv.getY(i)}`)
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
    throw new Error('No mesh geometry found in COLLADA file')
  }

  const objBytes = await writer.finish()
  const mtl: string[] = ['# Generated from COLLADA', '']
  for (const material of materials.values()) {
    mtl.push(`newmtl ${material.name}`)
    mtl.push(`Kd ${material.kd.join(' ')}`)
    mtl.push('d 1.0')
    if (material.mapKd) mtl.push(`map_Kd ${material.mapKd}`)
    mtl.push('')
  }

  const missing = embedded.expectedTextureNames.filter((name) => !siblings[name.toLowerCase()])
  if (missing.length) warnings.push(`Missing texture${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`)
  if (scene.animations.length) {
    warnings.push(`${scene.animations.length} animation clip${scene.animations.length === 1 ? '' : 's'} imported at rest pose`)
  }
  if (/<morph(?:\s|>)/i.test(embedded.text)) {
    warnings.push('Morph controllers are not supported by Three.js ColladaLoader')
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
  const label = [`DAE · ${meshCount} mesh${meshCount === 1 ? '' : 'es'}`]
  if (rig) label.push(`${rig.bones.length} native bones`)
  onProgress('Done')
  return {
    objBytes,
    mtlBytes: new TextEncoder().encode(mtl.join('\n')),
    textures,
    meshCount,
    warnings,
    sourceLabel: label.join(' · '),
    expectedTextureNames: embedded.expectedTextureNames,
    nativeSkin,
  }
}
