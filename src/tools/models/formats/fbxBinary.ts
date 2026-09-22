/**
 * Lightweight binary FBX 7.x mesh reader.
 *
 * Three.js FBXLoader builds the full scene (embedded Video media, skins,
 * animation). Large files freeze the UI then crash on incomplete texture nodes.
 * This walker skips animation, keeps Video rasters and Skin/Cluster deformers,
 * and triangulates Geometry so the mesh still appears with Kd colour when maps
 * are missing. Embedded LimbNode skeletons become the Native pose rig.
 */

import { unzlibSync } from 'fflate'
import {
  decodePath,
  matFbxLocal,
  matIdentity,
  matMultiply,
  matTransform,
  orientFbxMeshesYUp,
  triangulate,
  type FbxAsciiImport,
  type FbxAsciiMesh,
  type Mat4,
} from './fbxAscii'
import { decodeExportBytes } from '../exportText'
import { decodeAsciiEmbeddedImage, embeddedImageFromContent } from '../sidecarTextures'
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

const KEEP_TOP = new Set(['GlobalSettings', 'Objects', 'Connections'])
const KEEP_OBJECT = new Set(['Geometry', 'Model', 'Material', 'Texture', 'Video', 'LayeredTexture', 'Deformer'])
const SKIP_CHILD = new Set([
  'Content',
  'AnimationCurve',
  'AnimationCurveNode',
  'AnimationLayer',
  'AnimationStack',
  'Pose',
  'PoseNode',
  'Constraint',
  'Collection',
  'DisplayLayer',
  'NodeAttribute',
  'LayerElementNormal',
  'LayerElementBinormal',
  'LayerElementTangent',
  'LayerElementSmoothing',
  'LayerElementColor',
  'LayerElementVertexColor',
  'LayerElementVisibility',
  'Edges',
  'Preview',
])

type FbxNode = {
  name: string
  id: string
  attrName: string
  attrType: string
  props: unknown[]
  children: FbxNode[]
  arrays: Record<string, number[]>
  strings: Record<string, string>
  numbers: Record<string, number>
  vec3: Record<string, [number, number, number]>
  content: Uint8Array | null
}

class Reader {
  private view: DataView
  offset = 0

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.view = buffer instanceof Uint8Array
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer)
  }

  size() {
    return this.view.byteLength
  }

  skip(length: number) {
    this.offset += length
  }

  getUint8() {
    const value = this.view.getUint8(this.offset)
    this.offset += 1
    return value
  }

  getInt16() {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  getInt32() {
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  getUint32() {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  getFloat32() {
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  getFloat64() {
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return value
  }

  getUint64() {
    const low = this.getUint32()
    const high = this.getUint32()
    return high * 0x100000000 + low
  }

  getInt64() {
    const low = this.getUint32()
    let high = this.getUint32()
    if (high & 0x80000000) {
      high = ~high & 0xffffffff
      let nextLow = ~low & 0xffffffff
      if (nextLow === 0xffffffff) high = (high + 1) & 0xffffffff
      nextLow = (nextLow + 1) & 0xffffffff
      return -(high * 0x100000000 + nextLow)
    }
    return high * 0x100000000 + low
  }

  getBoolean() {
    return (this.getUint8() & 1) === 1
  }

  getString(length: number) {
    if (!Number.isFinite(length) || length <= 0) return ''
    const remaining = this.size() - this.offset
    const take = Math.min(length, Math.max(0, remaining))
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, take)
    this.offset += take
    return decodeExportBytes(bytes.subarray(0, take))
  }

  getBytes(length: number) {
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
    this.offset += length
    return bytes
  }
}

function inflateArray(reader: Reader, type: string, count: number, encoding: number, compressedLength: number): number[] {
  let source: Reader
  if (encoding === 0) {
    source = reader
  } else {
    const raw = reader.getBytes(compressedLength)
    const inflated = unzlibSync(raw)
    source = new Reader(inflated)
  }
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (type === 'd') out.push(source.getFloat64())
    else if (type === 'f') out.push(source.getFloat32())
    else if (type === 'i') out.push(source.getInt32())
    else if (type === 'l') out.push(source.getInt64())
    else if (type === 'b' || type === 'c') out.push(source.getBoolean() ? 1 : 0)
  }
  return out
}

function parseProperty(reader: Reader): unknown {
  const type = reader.getString(1)
  switch (type) {
    case 'C':
      return reader.getBoolean()
    case 'D':
      return reader.getFloat64()
    case 'F':
      return reader.getFloat32()
    case 'I':
      return reader.getInt32()
    case 'L':
      return reader.getInt64()
    case 'Y':
      return reader.getInt16()
    case 'R': {
      const length = reader.getUint32()
      return reader.getBytes(length)
    }
    case 'S': {
      const length = reader.getUint32()
      return reader.getString(length)
    }
    case 'b':
    case 'c':
    case 'd':
    case 'f':
    case 'i':
    case 'l': {
      const count = reader.getUint32()
      const encoding = reader.getUint32()
      const compressedLength = reader.getUint32()
      return inflateArray(reader, type, count, encoding, compressedLength)
    }
    default:
      throw new Error(`Unknown FBX property type ${type}`)
  }
}

function fbxName(raw: unknown, fallback: string) {
  const value = typeof raw === 'string' ? raw : ''
  const cleaned = (value.split('\0')[0] ?? '').replace(/^.*::/, '').trim()
  return cleaned || fallback
}

function parseNode(reader: Reader, version: number, parent: string): FbxNode | null {
  const wide = version >= 7500
  const endOffset = wide ? reader.getUint64() : reader.getUint32()
  const numProperties = wide ? reader.getUint64() : reader.getUint32()
  if (wide) reader.getUint64()
  else reader.getUint32()
  const nameLen = reader.getUint8()
  const name = reader.getString(nameLen)
  if (endOffset === 0) return null
  if (endOffset < reader.offset || endOffset > reader.size()) {
    reader.offset = Math.min(Math.max(endOffset, reader.offset), reader.size())
    return null
  }

  const skip =
    (SKIP_CHILD.has(name) && !(name === 'Content' && (parent === 'Video' || parent === 'Texture')))
    || (parent === '' && !KEEP_TOP.has(name) && name !== 'FBXHeaderExtension')
    || (parent === 'Objects' && !KEEP_OBJECT.has(name))

  if (skip) {
    reader.offset = endOffset
    return null
  }

  const props: unknown[] = []
  try {
    for (let i = 0; i < numProperties; i += 1) props.push(parseProperty(reader))
  } catch {
    reader.offset = endOffset
    return null
  }

  const node: FbxNode = {
    name,
    id: typeof props[0] === 'number' || typeof props[0] === 'string' ? String(props[0]) : '',
    attrName: fbxName(props[1], ''),
    attrType: fbxName(props[2], typeof props[2] === 'string' ? props[2] : ''),
    props,
    children: [],
    arrays: {},
    strings: {},
    numbers: {},
    vec3: {},
    content: null,
  }

  while (reader.offset < endOffset) {
    const child = parseNode(reader, version, name === 'Objects' ? 'Objects' : name)
    if (!child) continue
    node.children.push(child)
    if (child.name === 'Content') {
      const first = child.props[0]
      if (first instanceof Uint8Array) node.content = first
      else if (typeof first === 'string') node.strings.Content = first
    }
    if (child.props.length === 1 && Array.isArray(child.props[0])) {
      node.arrays[child.name] = (child.props[0] as number[]).map(Number)
    } else if (child.props.length === 1 && typeof child.props[0] === 'string') {
      node.strings[child.name] = child.props[0]
    } else if (child.props.length === 1 && typeof child.props[0] === 'number') {
      node.numbers[child.name] = child.props[0]
    }
    Object.assign(node.arrays, child.arrays)
    Object.assign(node.strings, child.strings)
    Object.assign(node.numbers, child.numbers)
    Object.assign(node.vec3, child.vec3)
  }

  if (name === 'P' && typeof props[0] === 'string') {
    const key = String(props[0]).replaceAll('Lcl ', 'Lcl_')
    const x = Number(props[4])
    const y = Number(props[5])
    const z = Number(props[6])
    if (Number.isFinite(x) && Number.isFinite(y)) {
      node.vec3[key] = [x, y, Number.isFinite(z) ? z : 0]
    } else if (Number.isFinite(x) && props[5] == null) {
      node.numbers[key] = x
    } else if (typeof props[4] === 'string') {
      node.strings[key] = props[4]
    } else if (typeof props[4] === 'number') {
      node.numbers[key] = props[4]
    }
  }

  return node
}

function childArray(node: FbxNode, key: string): number[] {
  if (node.arrays[key]?.length) return node.arrays[key]!
  const child = node.children.find((entry) => entry.name === key)
  if (!child) return []
  if (child.arrays.a?.length) return child.arrays.a
  if (child.arrays[key]?.length) return child.arrays[key]!
  const first = child.props[0]
  return Array.isArray(first) ? (first as number[]).map(Number) : []
}

function childString(node: FbxNode, key: string): string | null {
  if (node.strings[key]) return node.strings[key]!
  const child = node.children.find((entry) => entry.name === key)
  if (!child) return null
  const first = child.props[0]
  return typeof first === 'string' ? first : child.strings[key] ?? null
}

function collectVec3(node: FbxNode): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = { ...node.vec3 }
  for (const child of node.children) Object.assign(out, collectVec3(child))
  return out
}

function collectNumber(node: FbxNode, key: string): number | null {
  if (node.numbers[key] != null) return node.numbers[key]!
  for (const child of node.children) {
    const hit = collectNumber(child, key)
    if (hit != null) return hit
  }
  return null
}

function uvSampler(
  uvs: number[],
  uvIndex: number[],
  mapping: string,
  reference: string,
): (corner: number, vertex: number, polygon: number) => [number, number] | null {
  if (uvs.length < 2) return () => null
  const ref = reference.toLowerCase()
  const pair = (index: number): [number, number] | null => {
    const u = uvs[index * 2]
    const v = uvs[index * 2 + 1]
    if (u == null || v == null) return null
    return [u, v]
  }
  return (corner, vertex, polygon) => {
    const index = fbxLayerIndex(mapping, corner, vertex, polygon)
    if (ref.includes('index')) {
      const mapped = uvIndex[index]
      if (mapped == null) return null
      return pair(mapped)
    }
    return pair(index)
  }
}

function resolveWorld(models: Map<string, { matrix: Mat4; parent: string | null }>) {
  const world = new Map<string, Mat4>()
  const visiting = new Set<string>()
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
 * Parse binary FBX geometry without Three.js. Embedded Video rasters are kept;
 * non-image Content (animation caches) is ignored.
 */
export function parseFbxBinary(bytes: Uint8Array): FbxAsciiImport {
  const reader = new Reader(bytes)
  reader.skip(23)
  const version = reader.getUint32()
  const warnings: string[] = []
  const roots: FbxNode[] = []
  const footerGuard = () => {
    if (reader.size() % 16 === 0) return ((reader.offset + 160 + 16) & ~0xf) >= reader.size()
    return reader.offset + 160 + 16 >= reader.size()
  }
  while (reader.offset < reader.size() && !footerGuard()) {
    const node = parseNode(reader, version, '')
    if (node) roots.push(node)
  }

  const objects = roots.find((node) => node.name === 'Objects')
  const connectionsNode = roots.find((node) => node.name === 'Connections')
  const settings = roots.find((node) => node.name === 'GlobalSettings')

  const connections: { from: string; to: string; prop: string }[] = []
  for (const child of connectionsNode?.children ?? []) {
    if (child.name !== 'C') continue
    const kind = String(child.props[0] ?? '').toUpperCase()
    if (kind !== 'OO' && kind !== 'OP') continue
    connections.push({
      from: String(child.props[1] ?? ''),
      to: String(child.props[2] ?? ''),
      prop: String(child.props[3] ?? ''),
    })
  }
  let parentOf = new Map<string, string>()

  const materials = new Map<string, { kd: [number, number, number]; name: string }>()
  const materialIds = new Set<string>()
  const fileOf = new Map<string, FbxTextureRef>()
  const textureIds = new Set<string>()
  const videoIds = new Set<string>()
  const layeredIds = new Set<string>()
  const expectedTextureNames: string[] = []
  const embeddedTextures: Record<string, Uint8Array> = {}
  const geometries: FbxNode[] = []
  const models = new Map<string, {
    name: string
    matrix: Mat4
    geometric: Mat4
    parent: string | null
    type: string
  }>()
  const deformers = new Map<string, FbxDeformer>()

  const rememberFile = (node: FbxNode, idSet: Set<string>) => {
    idSet.add(node.id)
    const relative =
      childString(node, 'RelativeFilename')
      ?? childString(node, 'FileName')
      ?? childString(node, 'Filename')
    if (!relative) return
    const file = decodePath(relative)
    if (!/\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i.test(file)) return
    expectedTextureNames.push(file)
    const vecs = collectVec3(node)
    const rawSet = node.strings.UVSet ?? childString(node, 'UVSet') ?? ''
    const uv = sanitizeFbxTextureUv(
      (vecs.UVScaling ?? vecs.Scaling ?? [1, 1, 1]).slice(0, 2) as [number, number],
      (vecs.UVTranslation ?? vecs.Translation ?? [0, 0, 0]).slice(0, 2) as [number, number],
    )
    fileOf.set(node.id, {
      file,
      scale: uv.scale,
      offset: uv.offset,
      uvSet: rawSet && !/^default$/i.test(rawSet) ? rawSet : undefined,
    })
    const embedded =
      embeddedImageFromContent(node.content)
      ?? (node.strings.Content ? decodeAsciiEmbeddedImage(node.strings.Content) : null)
    if (embedded) embeddedTextures[file.toLowerCase()] = embedded
  }

  for (const node of objects?.children ?? []) {
    if (node.name === 'Material') {
      const vecs = collectVec3(node)
      const color = vecs.DiffuseColor ?? vecs.Diffuse ?? [0.75, 0.75, 0.75]
      const kd: [number, number, number] = [
        Math.min(1, Math.max(0, color[0])),
        Math.min(1, Math.max(0, color[1])),
        Math.min(1, Math.max(0, color[2])),
      ]
      materials.set(node.id, { kd, name: node.attrName })
      materialIds.add(node.id)
    }
    if (node.name === 'Texture') rememberFile(node, textureIds)
    if (node.name === 'Video') rememberFile(node, videoIds)
    if (node.name === 'LayeredTexture') layeredIds.add(node.id)
    if (node.name === 'Geometry' && /mesh/i.test(node.attrType)) geometries.push(node)
    if (node.name === 'Deformer') {
      deformers.set(node.id, {
        id: node.id,
        type: node.attrType,
        indexes: childArray(node, 'Indexes'),
        weights: childArray(node, 'Weights'),
        transform: childArray(node, 'Transform'),
        transformLink: childArray(node, 'TransformLink'),
      })
    }
    if (node.name === 'Model') {
      const vecs = collectVec3(node)
      models.set(node.id, {
        name: node.attrName || `model_${node.id}`,
        matrix: matFbxLocal({
          translation: vecs.Lcl_Translation,
          rotation: vecs.Lcl_Rotation,
          scale: vecs.Lcl_Scaling,
          preRotation: vecs.PreRotation,
          postRotation: vecs.PostRotation,
          rotationOffset: vecs.RotationOffset,
          rotationPivot: vecs.RotationPivot,
          scalingOffset: vecs.ScalingOffset,
          scalingPivot: vecs.ScalingPivot,
        }),
        geometric: matFbxLocal({
          translation: vecs.GeometricTranslation,
          rotation: vecs.GeometricRotation,
          scale: vecs.GeometricScaling,
        }),
        parent: null,
        type: node.attrType,
      })
    }
  }
  parentOf = fbxNodeParents(connections, new Set(deformers.keys()))
  for (const [id, model] of models) {
    model.parent = parentOf.get(id) ?? null
  }
  resolveWorld(models)

  const bindings = bindFbxSurfaces(connections, {
    materials: materialIds,
    textures: textureIds,
    videos: videoIds,
    layered: layeredIds,
  })

  const upAxis = settings ? collectNumber(settings, 'UpAxis') : null
  const declaredZUp = (upAxis ?? 1) === 2
  const unit = settings ? collectNumber(settings, 'UnitScaleFactor') : null
  const scale = unit != null && Number.isFinite(unit) && unit > 0 && unit !== 100 ? unit : 1

  const boneModels: FbxBoneModel[] = [...models.entries()].map(([id, model]) => ({
    id,
    name: model.name,
    type: model.type,
    parent: model.parent,
    world: model.matrix,
  }))
  const clusterBones = allClusterBones(connections, deformers)
  const skinnedIds = new Set(clusterBones.map((entry) => entry.boneId))
  const nativeDraft = buildFbxNativeRig(boneModels, [0, 0, 0, 1, 1, 1], false, { skinnedIds })

  const meshes: FbxAsciiMesh[] = []
  let skinnedMeshWorld: number[] | null = null
  for (const geo of geometries) {
    const vertices = childArray(geo, 'Vertices')
    const indices = childArray(geo, 'PolygonVertexIndex')
    if (vertices.length < 9 || indices.length < 3) continue
    const modelId = parentOf.get(geo.id)
    const model = modelId ? models.get(modelId) : null
    const uvNodes = geo.children.filter((child) => child.name === 'LayerElementUV')
    const slots =
      (modelId ? bindings.materialsOf.get(modelId) : undefined)
      ?? bindings.materialsOf.get(geo.id)
      ?? []
    const uvNode = pickFbxUvLayer(
      uvNodes,
      (node) => childString(node, 'Name') ?? node.strings.Name ?? node.attrName,
      preferredUvSet(slots, bindings, fileOf),
      (node) => childArray(node, 'UV').length >= 2,
    )
    const uvs = uvNode ? childArray(uvNode, 'UV') : []
    const uvIndex = uvNode ? childArray(uvNode, 'UVIndex').map((value) => Math.round(value)) : []
    const mapping = uvNode ? childString(uvNode, 'MappingInformationType') ?? 'ByPolygonVertex' : ''
    const reference = uvNode ? childString(uvNode, 'ReferenceInformationType') ?? 'Direct' : ''
    const matNode = geo.children.find((child) => child.name === 'LayerElementMaterial')
    const matIndices = matNode ? childArray(matNode, 'Materials') : []
    const matMapping = matNode ? childString(matNode, 'MappingInformationType') ?? 'AllSame' : 'AllSame'
    const baked = triangulate(
      vertices,
      indices,
      uvSampler(uvs, uvIndex, mapping, reference),
      materialSlotSampler(matIndices, matMapping),
    )
    if (baked.positions.length < 9) continue
    const matrix = model ? matMultiply(model.matrix, model.geometric) : matIdentity()
    const positions: number[] = []
    for (let i = 0; i < baked.positions.length; i += 3) {
      const [x, y, z] = matTransform(
        matrix,
        baked.positions[i]!,
        baked.positions[i + 1]!,
        baked.positions[i + 2]!,
      )
      positions.push(x * scale, y * scale, z * scale)
    }
    const groups = partitionTriangles(positions, baked.uvs, baked.materialSlots, baked.controlPoints)
    const meshName = model?.name ?? geo.attrName ?? `mesh_${meshes.length + 1}`
    const multi = groups.size > 1
    const clusters = nativeDraft
      ? clustersForGeometry(connections, deformers, geo.id, [modelId ?? ''])
      : []
    if (clusters.length > 0 && model && !skinnedMeshWorld) skinnedMeshWorld = model.matrix
    for (const [slot, group] of groups) {
      const materialId = slotMaterialId(slots, slot)
      const material = materialId ? materials.get(materialId) : null
      const albedo = resolveAlbedoFile(materialId, bindings, fileOf)
      meshes.push({
        name: multi && material?.name ? `${meshName}_${material.name}` : meshName,
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
    warnings.push('Binary FBX contained no triangulated mesh (Vertices / PolygonVertexIndex)')
  } else {
    warnings.push('Binary FBX mesh baked without Three.js')
  }
  const oriented = orientFbxMeshesYUp(meshes, declaredZUp)
  if (oriented) warnings.push('Converted Z-up FBX into Y-up')
  const nativeSkin = finishFbxNativeSkin(boneModels, meshes, {
    yUp: oriented,
    unitScale: scale,
    skinnedIds,
    clusters: clusterBones,
    meshWorld: skinnedMeshWorld ?? (() => {
      for (const geo of geometries) {
        const modelId = parentOf.get(geo.id)
        const model = modelId ? models.get(modelId) : null
        if (model) return model.matrix
      }
      return matIdentity()
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
    kind: 'binary',
    embeddedTextures,
    nativeSkin,
  }
}
