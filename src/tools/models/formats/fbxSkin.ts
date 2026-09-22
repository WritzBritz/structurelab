/**
 * FBX embedded skeleton (LimbNode / Skin / Cluster).
 *
 * Autodesk FbxCluster: Transform = mesh global at bind, TransformLink = bone
 * global at bind. Three.js FBXLoader.parseSkeleton copies TransformLink via
 * Matrix4.fromArray (column-major). Blender force-connects shafts parent→child
 * and uses local +Y for leaf length.
 *
 * Scene parents come only from Model OO links — Cluster connections must not
 * replace them. When the skin graph is missing we leave nativeSkin empty so
 * Auto/Body/Shape can fit.
 */

import {
  type MeshBoneDef,
  type MeshBoneRig,
  type MeshBoneWeights,
} from '../meshBoneRig'
import type { FbxConn } from './fbxBindings'

type Mat4 = number[]

function matFrom16(values: number[]): Mat4 | null {
  if (values.length < 16) return null
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (let i = 0; i < 16; i += 1) {
    const value = values[i]
    if (!Number.isFinite(value)) return null
    matrix[i] = value
  }
  return matrix
}

export type FbxDeformer = {
  id: string
  type: string
  indexes: number[]
  weights: number[]
  transform?: number[]
  transformLink?: number[]
}

export type FbxBoneModel = {
  id: string
  name: string
  type: string
  parent: string | null
  world: Mat4
}

export type FbxMeshSkin = {
  indices: number[]
  weights: number[]
}

const JOINT_TYPE = /^(limbnode|limb)$/i
const HELPER_TYPE = /^(root|null)$/i
const SKIP_TYPE = /^(mesh|camera|light|nurb|nurbs|lodgroup|limbnodeattribute)$/i

export function isFbxBoneType(type: string): boolean {
  const value = type.trim()
  return JOINT_TYPE.test(value) || HELPER_TYPE.test(value)
}

export function deformerKind(type: string): 'skin' | 'cluster' | 'other' {
  const value = type.trim().toLowerCase()
  if (value === 'skin') return 'skin'
  if (value === 'cluster') return 'cluster'
  return 'other'
}

function yUpPoint(point: [number, number, number], yUp: boolean): [number, number, number] {
  if (!yUp) return point
  return [point[0], point[2], -point[1]]
}

function scalePoint(
  point: [number, number, number],
  scale: number,
): [number, number, number] {
  if (scale === 1) return point
  return [point[0] * scale, point[1] * scale, point[2] * scale]
}

function matTransform(matrix: Mat4, x: number, y: number, z: number): [number, number, number] {
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
  const inv = w !== 0 ? 1 / w : 1
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * inv,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * inv,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * inv,
  ]
}

function uniqueBoneId(name: string, fallback: string, taken: Set<string>): string {
  const base = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback
  let id = base
  let serial = 2
  while (taken.has(id)) {
    id = `${base}_${serial}`
    serial += 1
  }
  taken.add(id)
  return id
}

/** mixamorig:LeftArm → Left Arm */
export function fbxBoneLabel(name: string): string {
  const trimmed = name
    .replace(/^.*:/, '')
    .replace(/^mixamorig[_:]?/i, '')
    .replace(/^Armature[_]?/i, '')
  const spaced = trimmed
    .replace(/[._]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d+)$/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
  return spaced || name
}

function topInfluences(
  raw: { bone: number; weight: number }[],
): { indices: [number, number, number, number]; weights: [number, number, number, number] } {
  const sorted = raw
    .filter((entry) => entry.bone >= 0 && entry.weight > 1e-8)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
  let sum = 0
  for (const entry of sorted) sum += entry.weight
  const scale = sum > 1e-8 ? 1 / sum : 0
  const indices: [number, number, number, number] = [-1, -1, -1, -1]
  const weights: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < sorted.length; i += 1) {
    indices[i] = sorted[i]!.bone
    weights[i] = sorted[i]!.weight * scale
  }
  return { indices, weights }
}

function connectedIds(connections: FbxConn[], id: string): string[] {
  const out: string[] = []
  for (const conn of connections) {
    if (conn.from === id) out.push(conn.to)
    else if (conn.to === id) out.push(conn.from)
  }
  return out
}

function clusterBoneId(
  cluster: FbxDeformer,
  connections: FbxConn[],
  deformers: Map<string, FbxDeformer>,
  extraSkip: Set<string>,
): string | null {
  for (const other of connectedIds(connections, cluster.id)) {
    if (deformers.has(other) || extraSkip.has(other)) continue
    return other
  }
  return null
}

/**
 * Cluster → Skin → Geometry, Cluster ↔ LimbNode.
 * FBX files use either direction for the bone link.
 */
export function clustersForGeometry(
  connections: FbxConn[],
  deformers: Map<string, FbxDeformer>,
  geometryId: string,
  extraIds: string[] = [],
): { boneId: string; indexes: number[]; weights: number[] }[] {
  const targets = new Set([geometryId, ...extraIds.filter(Boolean)])
  const skinIds = new Set<string>()
  for (const id of [...targets]) {
    for (const other of connectedIds(connections, id)) {
      const deformer = deformers.get(other)
      if (deformer && deformerKind(deformer.type) === 'skin') skinIds.add(deformer.id)
    }
  }
  if (skinIds.size === 0) {
    for (const deformer of deformers.values()) {
      if (deformerKind(deformer.type) !== 'skin') continue
      const neighbors = connectedIds(connections, deformer.id)
      if (neighbors.some((id) => targets.has(id))) skinIds.add(deformer.id)
    }
  }
  if (skinIds.size === 0) return []

  const out: { boneId: string; indexes: number[]; weights: number[] }[] = []
  for (const deformer of deformers.values()) {
    if (deformerKind(deformer.type) !== 'cluster') continue
    const neighbors = connectedIds(connections, deformer.id)
    if (!neighbors.some((id) => skinIds.has(id))) continue
    const boneId = clusterBoneId(deformer, connections, deformers, targets)
    if (!boneId) continue
    if (deformer.indexes.length === 0 || deformer.indexes.length !== deformer.weights.length) continue
    out.push({ boneId, indexes: deformer.indexes, weights: deformer.weights })
  }
  return out
}

export type FbxClusterBone = {
  boneId: string
  transform?: number[]
  transformLink?: number[]
}

/** Every Cluster → LimbNode link, plus bind-time Transform and TransformLink. */
export function allClusterBones(
  connections: FbxConn[],
  deformers: Map<string, FbxDeformer>,
): FbxClusterBone[] {
  const skinIds = new Set<string>()
  for (const deformer of deformers.values()) {
    if (deformerKind(deformer.type) === 'skin') skinIds.add(deformer.id)
  }
  const out: FbxClusterBone[] = []
  const seen = new Set<string>()
  for (const cluster of deformers.values()) {
    if (deformerKind(cluster.type) !== 'cluster') continue
    const neighbors = connectedIds(connections, cluster.id)
    if (skinIds.size > 0 && !neighbors.some((id) => skinIds.has(id))) continue
    const boneId = clusterBoneId(cluster, connections, deformers, skinIds)
    if (!boneId || seen.has(boneId)) continue
    seen.add(boneId)
    out.push({
      boneId,
      transform: cluster.transform && cluster.transform.length >= 16
        ? cluster.transform
        : undefined,
      transformLink: cluster.transformLink && cluster.transformLink.length >= 16
        ? cluster.transformLink
        : undefined,
    })
  }
  return out
}

function cloneBoneModels(bones: FbxBoneModel[]): FbxBoneModel[] {
  return bones.map((bone) => ({ ...bone, world: bone.world.slice() }))
}

/**
 * Autodesk / Three.js: TransformLink is the bone's global bind matrix
 * (`Matrix4.fromArray`, column-major). That is already the same world the
 * mesh was bound in, so it is the bone head — do not multiply by
 * meshWorld * inverse(Transform); that product is the inverse-bind used
 * for GPU skinning, and applying it here double-transforms the joints.
 */
function bakeBindIntoMeshSpace(
  bones: FbxBoneModel[],
  clusters: FbxClusterBone[],
): void {
  const byId = new Map(clusters.map((entry) => [entry.boneId, entry]))
  for (const bone of bones) {
    const link = byId.get(bone.id)?.transformLink
      ? matFrom16(byId.get(bone.id)!.transformLink!)
      : null
    if (link) bone.world = link
  }
}

function keepSkeletonBones(
  bones: FbxBoneModel[],
  skinnedIds: Set<string>,
): FbxBoneModel[] {
  const byId = new Map(bones.map((bone) => [bone.id, bone]))
  const seed = skinnedIds.size > 0
    ? bones.filter((bone) => skinnedIds.has(bone.id))
    : bones.filter((bone) => JOINT_TYPE.test(bone.type))
  const keep = new Set<string>()
  for (const bone of seed) {
    let current: string | null = bone.id
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const node = byId.get(current)
      if (!node) break
      if (!SKIP_TYPE.test(node.type)) keep.add(node.id)
      current = node.parent
    }
  }
  const chain = bones.filter((bone) => keep.has(bone.id) && !SKIP_TYPE.test(bone.type))
  const visible = chain.filter(
    (bone) => JOINT_TYPE.test(bone.type) || skinnedIds.has(bone.id),
  )
  const chosen = visible.length > 0 ? visible : chain.filter((bone) => JOINT_TYPE.test(bone.type))
  if (chosen.length === 0) return []
  const keepIds = new Set(chosen.map((bone) => bone.id))
  return chosen.map((bone) => {
    let parent = bone.parent
    const seen = new Set<string>()
    while (parent && !keepIds.has(parent) && !seen.has(parent)) {
      seen.add(parent)
      parent = byId.get(parent)?.parent ?? null
    }
    return { ...bone, parent: parent && keepIds.has(parent) ? parent : null }
  })
}

function boneAxis(
  head: [number, number, number],
  matrix: Mat4,
  worldPoint: (m: Mat4, x?: number, y?: number, z?: number) => [number, number, number],
): [number, number, number] {
  // Blender / Autodesk: FBX bones are authored along local +Y.
  const alongY = worldPoint(matrix, 0, 1, 0)
  const y: [number, number, number] = [alongY[0] - head[0], alongY[1] - head[1], alongY[2] - head[2]]
  const len = Math.hypot(y[0], y[1], y[2])
  if (len < 1e-8) return [0, 1, 0]
  return [y[0] / len, y[1] / len, y[2] / len]
}

function stubTip(
  head: [number, number, number],
  axis: [number, number, number],
  length: number,
): [number, number, number] {
  return [head[0] + axis[0] * length, head[1] + axis[1] * length, head[2] + axis[2] * length]
}

const CONTINUE_CHILD = /spine|neck|head|chest|pelvis|hip|tail|torso|abdomen/i

function pickTipChild(
  kids: FbxBoneModel[],
  head: [number, number, number],
  worldPoint: (m: Mat4, x?: number, y?: number, z?: number) => [number, number, number],
): FbxBoneModel | null {
  if (kids.length === 0) return null
  if (kids.length === 1) return kids[0]!
  const named = kids.find((child) => CONTINUE_CHILD.test(child.name))
  if (named) return named
  let best: FbxBoneModel | null = null
  let bestDist = Infinity
  for (const child of kids) {
    const point = worldPoint(child.world)
    const dist = Math.hypot(point[0] - head[0], point[1] - head[1], point[2] - head[2])
    if (dist > 1e-6 && dist < bestDist) {
      best = child
      bestDist = dist
    }
  }
  return best
}

export function skinFromControlPoints(
  controlPoints: number[],
  clusters: { boneId: string; indexes: number[]; weights: number[] }[],
  boneIndexOf: Record<string, number>,
): FbxMeshSkin | null {
  if (controlPoints.length === 0 || clusters.length === 0) return null
  const perCp = new Map<number, { bone: number; weight: number }[]>()
  for (const cluster of clusters) {
    const bone = boneIndexOf[cluster.boneId]
    if (bone == null) continue
    const count = Math.min(cluster.indexes.length, cluster.weights.length)
    for (let i = 0; i < count; i += 1) {
      const cp = Math.round(cluster.indexes[i]!)
      const list = perCp.get(cp) ?? []
      list.push({ bone, weight: cluster.weights[i]! })
      perCp.set(cp, list)
    }
  }
  if (perCp.size === 0) return null
  const indices: number[] = []
  const weights: number[] = []
  let used = 0
  for (const cp of controlPoints) {
    const packed = topInfluences(perCp.get(cp) ?? [])
    if (packed.indices[0] >= 0) used += 1
    indices.push(...packed.indices)
    weights.push(...packed.weights)
  }
  if (used === 0) return null
  return { indices, weights }
}

export function buildFbxNativeRig(
  bones: FbxBoneModel[],
  positions: number[],
  yUp: boolean,
  options?: { skinnedIds?: Set<string>; unitScale?: number },
): { rig: MeshBoneRig; fbxIdToIndex: Record<string, number> } | null {
  const scale = options?.unitScale && options.unitScale > 0 ? options.unitScale : 1
  const joint = keepSkeletonBones(bones, options?.skinnedIds ?? new Set())
  if (joint.length === 0) return null
  const taken = new Set<string>()
  const poseId = new Map<string, string>()
  for (const bone of joint) {
    poseId.set(bone.id, uniqueBoneId(bone.name, `bone_${bone.id}`, taken))
  }
  const jointIds = new Set(joint.map((bone) => bone.id))
  const children = new Map<string, FbxBoneModel[]>()
  for (const bone of joint) {
    if (bone.parent && jointIds.has(bone.parent)) {
      const list = children.get(bone.parent) ?? []
      list.push(bone)
      children.set(bone.parent, list)
    }
  }
  const worldPoint = (matrix: Mat4, x = 0, y = 0, z = 0): [number, number, number] =>
    scalePoint(yUpPoint(matTransform(matrix, x, y, z), yUp), scale)
  const bounds = boundsFromPositions(positions)
  const diag = Math.hypot(bounds.size[0], bounds.size[1], bounds.size[2]) || 1
  const stubLen = Math.max(diag * 0.025, 1e-4)
  const maxShaft = diag * 0.55

  const defs: MeshBoneDef[] = joint.map((bone) => {
    const head = worldPoint(bone.world)
    const kids = children.get(bone.id) ?? []
    const axis = boneAxis(head, bone.world, worldPoint)
    const parent = bone.parent && jointIds.has(bone.parent)
      ? joint.find((entry) => entry.id === bone.parent)
      : undefined
    const parentHead = parent ? worldPoint(parent.world) : null
    const parentLen = parentHead
      ? Math.hypot(head[0] - parentHead[0], head[1] - parentHead[1], head[2] - parentHead[2])
      : stubLen
    const leafLen = Math.min(Math.max(parentLen * 0.28, stubLen * 0.35), stubLen * 1.6)

    let tip: [number, number, number]
    const child = pickTipChild(kids, head, worldPoint)
    if (child) {
      const childHead = worldPoint(child.world)
      const shaft = Math.hypot(
        childHead[0] - head[0],
        childHead[1] - head[1],
        childHead[2] - head[2],
      )
      tip = shaft > 1e-6 && shaft <= maxShaft ? childHead : stubTip(head, axis, leafLen)
    } else if (parentHead && parentLen > 1e-6) {
      tip = stubTip(head, [
        (head[0] - parentHead[0]) / parentLen,
        (head[1] - parentHead[1]) / parentLen,
        (head[2] - parentHead[2]) / parentLen,
      ], leafLen)
    } else {
      tip = stubTip(head, axis, leafLen)
    }
    if ((tip[0] - head[0]) ** 2 + (tip[1] - head[1]) ** 2 + (tip[2] - head[2]) ** 2 < 1e-12) {
      tip = stubTip(head, [0, 1, 0], leafLen)
    }
    const parentId = bone.parent && jointIds.has(bone.parent) ? poseId.get(bone.parent)! : null
    const length = Math.hypot(tip[0] - head[0], tip[1] - head[1], tip[2] - head[2])
    return {
      id: poseId.get(bone.id)!,
      parent: parentId,
      label: fbxBoneLabel(bone.name) || poseId.get(bone.id)!,
      head,
      tip,
      hasBend: false,
      bendT: 1,
      radius: Math.min(Math.max(length * 0.08, diag * 0.004), diag * 0.018),
    }
  })
  const indexOf = Object.fromEntries(defs.map((bone, index) => [bone.id, index]))
  const fbxIdToIndex: Record<string, number> = {}
  for (const bone of joint) {
    const id = poseId.get(bone.id)
    if (id == null) continue
    fbxIdToIndex[bone.id] = indexOf[id]!
  }
  return {
    rig: {
      kind: 'native',
      bones: defs,
      indexOf,
      bounds,
    },
    fbxIdToIndex,
  }
}

export function packNativeWeights(meshes: { skin?: FbxMeshSkin | null; positions: number[] }[]): MeshBoneWeights | null {
  const indices: number[] = []
  const weights: number[] = []
  let vertexCount = 0
  let used = 0
  for (const mesh of meshes) {
    const count = Math.floor(mesh.positions.length / 3)
    const skin = mesh.skin
    if (!skin || skin.indices.length < count * 4) {
      for (let i = 0; i < count; i += 1) {
        indices.push(-1, -1, -1, -1)
        weights.push(0, 0, 0, 0)
      }
    } else {
      for (let i = 0; i < count * 4; i += 1) {
        const bone = skin.indices[i] ?? -1
        if (bone >= 0) used += 1
        indices.push(bone)
        weights.push(skin.weights[i] ?? 0)
      }
    }
    vertexCount += count
  }
  if (vertexCount === 0 || used === 0) return null
  return {
    indices: Int16Array.from(indices),
    weights: Float32Array.from(weights),
    vertexCount,
  }
}

function nativeWeightsLookAligned(
  positions: number[],
  rig: MeshBoneRig,
  skin: MeshBoneWeights,
): boolean {
  const vertexCount = Math.floor(positions.length / 3)
  if (vertexCount === 0 || skin.vertexCount !== vertexCount) return false
  const diag = Math.hypot(rig.bounds.size[0], rig.bounds.size[1], rig.bounds.size[2]) || 1
  const distances: number[] = []
  const step = Math.max(1, Math.floor(vertexCount / 400))
  for (let vertex = 0; vertex < vertexCount; vertex += step) {
    const bone = rig.bones[skin.indices[vertex * 4] ?? -1]
    if (!bone) continue
    const x = positions[vertex * 3]!
    const y = positions[vertex * 3 + 1]!
    const z = positions[vertex * 3 + 2]!
    const ax = bone.head[0]
    const ay = bone.head[1]
    const az = bone.head[2]
    const bx = bone.tip[0] - ax
    const by = bone.tip[1] - ay
    const bz = bone.tip[2] - az
    const lenSq = bx * bx + by * by + bz * bz
    const t = lenSq > 0
      ? Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / lenSq))
      : 0
    distances.push(Math.hypot(x - (ax + bx * t), y - (ay + by * t), z - (az + bz * t)))
  }
  if (distances.length === 0) return false
  distances.sort((a, b) => a - b)
  return distances[Math.floor(distances.length / 2)]! < diag * 0.22
}

export function finishFbxNativeSkin(
  boneModels: FbxBoneModel[],
  meshes: { skin?: FbxMeshSkin | null; positions: number[] }[],
  options: {
    yUp: boolean
    unitScale?: number
    skinnedIds?: Set<string>
    clusters?: FbxClusterBone[]
    meshWorld?: number[]
    warnings?: string[]
  },
): { rig: MeshBoneRig; skin: MeshBoneWeights } | null {
  const allPositions = meshes.flatMap((mesh) => mesh.positions)
  const bones = cloneBoneModels(boneModels)
  if (options.clusters?.length) {
    bakeBindIntoMeshSpace(bones, options.clusters)
  }
  const native = buildFbxNativeRig(bones, allPositions, options.yUp, {
    skinnedIds: options.skinnedIds,
    unitScale: options.unitScale,
  })
  if (!native) return null
  const packed = packNativeWeights(meshes)
  let skin: MeshBoneWeights = packed ?? {
    indices: new Int16Array(0),
    weights: new Float32Array(0),
    vertexCount: 0,
  }
  if (packed && !nativeWeightsLookAligned(allPositions, native.rig, packed)) {
    options.warnings?.push(
      'FBX skin weights did not line up with the mesh — bones kept, weights re-solved',
    )
    skin = {
      indices: new Int16Array(0),
      weights: new Float32Array(0),
      vertexCount: 0,
    }
  }
  return { rig: native.rig, skin }
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
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0
    maxX = maxY = maxZ = 1
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  }
}
