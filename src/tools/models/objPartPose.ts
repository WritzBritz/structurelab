/** Named OBJ object groups (`o` / `g`) — rotate / move / bend parts in preview and at convert. */

import type * as THREE from 'three'
import type { VoxelFit } from '../../types'
import type { PartPose } from './characterPose'
import { isSkinLimbBendName, skinPoseBendLimbId } from './characterPose'
import { clampVoxelBox } from './objAssets'

export { clampVoxelBox }

/** One committed regional pose (kept when you click a new joint). */
export type MeshPoseStroke = {
  objectName: string
  pivot: [number, number, number]
  rot: [number, number, number]
  bend: [number, number, number]
  pos: [number, number, number]
}

export type MeshPartPose = {
  root: PartPose
  parts: Record<string, PartPose>
  /**
   * Click-to-pose pivots in original mesh space.
   * Rotate and bend joints move to this point so you can grab an elbow/knee/waist.
   */
  pivots?: Record<string, [number, number, number]>
  /**
   * Prior click-joints on whole-body meshes. Without these, changing the pivot
   * would move the live bend/rotate onto the new click and undo the old one.
   */
  strokes?: MeshPoseStroke[]
  /**
   * Minecraft catalog cubes / Blockbench-style parts: rotate the whole object
   * around its joint instead of a regional mesh morph.
   */
  rigid?: boolean
  /**
   * Child object → parent object. Rotating `body` also moves `head` / arms
   * (and quadruped legs) because those groups nest under the parent.
   */
  poseParents?: Record<string, string>
}

const MESH_PART_PREFIX = 'mesh-part:'

function isMeshPartGroup(obj: { name: string }): boolean {
  return obj.name.startsWith(MESH_PART_PREFIX)
}

function meshPartNameOf(obj: { name: string }): string {
  return obj.name.slice(MESH_PART_PREFIX.length)
}

function ancestorWouldCycle(
  child: { parent: { parent: unknown } | null },
  parent: unknown,
): boolean {
  let current: { parent: unknown } | null | undefined = parent as { parent: unknown } | null
  while (current) {
    if (current === child) return true
    current = (current as { parent: { parent: unknown } | null }).parent
  }
  return false
}

/**
 * Catalog FK: head/arms follow body; quadruped legs follow body; hat follows head.
 */
export function inferCatalogPoseParents(
  objectNames: string[],
  authored?: Record<string, string> | null,
): Record<string, string> {
  const present = new Set(
    objectNames.filter((name) => name && !name.endsWith('_overlay')),
  )
  const parents: Record<string, string> = {}
  const assign = (child: string, parent: string) => {
    if (!present.has(child) || !present.has(parent) || child === parent) return
    if (parents[child]) return
    const seen = new Set<string>([child])
    let walk: string | undefined = parent
    while (walk) {
      if (seen.has(walk)) return
      seen.add(walk)
      walk = parents[walk]
    }
    parents[child] = parent
  }
  if (authored) {
    for (const [child, parent] of Object.entries(authored)) assign(child, parent)
  }
  assign('hat', 'head')
  for (const name of present) {
    if (/^head_/.test(name) && present.has('head')) assign(name, 'head')
  }
  for (const name of present) {
    if (/ear|snout|nose|beak|horn/.test(name)) {
      assign(name, present.has('head') ? 'head' : 'body')
    }
  }
  if (present.has('body')) {
    const quadruped = [...present].some((name) => /^leg[0-3]$/.test(name))
    if (quadruped) {
      for (const name of present) {
        if (name === 'body') continue
        if (
          name === 'head'
          || name === 'upper_body'
          || /^leg[0-3]$/.test(name)
          || name === 'tail'
          || /wing/.test(name)
        ) {
          assign(name, 'body')
        }
      }
      return parents
    }
    for (const name of present) {
      if (name === 'body') continue
      if (
        /^(head|hat|hood|jacket|arms)$/.test(name)
        || /(?:^|_)(arm|wing)(?:_|$)/.test(name)
        || /(^|_)arm$/.test(name)
        || /wing/.test(name)
        || /tail/.test(name)
      ) {
        assign(name, name === 'hat' && present.has('head') ? 'head' : 'body')
      }
    }
    const biped = [...present].some((name) => /arm/.test(name))
    if (!biped) {
      for (const name of present) {
        if (/leg|paw|foot|hoof/.test(name)) assign(name, 'body')
      }
    }
  }
  return parents
}

function poseParentChain(
  name: string,
  parents: Record<string, string> | undefined,
): string[] {
  const chain: string[] = []
  const seen = new Set<string>([name])
  let current = parents?.[name]
  while (current && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = parents?.[current]
  }
  return chain
}

function nestMeshPartParents(
  meshRoot: THREE.Object3D,
  poseParents: Record<string, string> | undefined,
): void {
  if (!poseParents || Object.keys(poseParents).length === 0) return
  const groups = new Map<string, THREE.Object3D>()
  meshRoot.traverse((obj) => {
    if (isMeshPartGroup(obj)) groups.set(meshPartNameOf(obj), obj)
  })
  for (const [child, parent] of Object.entries(poseParents)) {
    const childObj = groups.get(child)
    const parentObj = groups.get(parent)
    if (!childObj || !parentObj || childObj === parentObj) continue
    if (ancestorWouldCycle(childObj, parentObj)) continue
    parentObj.add(childObj)
  }
}

function localRestPosition(
  obj: THREE.Object3D,
  restPivot: [number, number, number],
): [number, number, number] {
  const parent = obj.parent
  const parentRest =
    parent && isMeshPartGroup(parent)
      ? ((parent.userData.restPivot as [number, number, number] | undefined) ?? [0, 0, 0])
      : ([0, 0, 0] as [number, number, number])
  return [
    restPivot[0] - parentRest[0],
    restPivot[1] - parentRest[1],
    restPivot[2] - parentRest[2],
  ]
}

export type MeshObjectBounds = {
  name: string
  min: [number, number, number]
  max: [number, number, number]
  center: [number, number, number]
  volume: number
}

export type MeshBendSplit = {
  /** Longest local axis — limbs usually Y. */
  axis: 0 | 1 | 2
  /** Pivot coordinate along `axis` (mid of AABB or click). */
  pivot: number
  /** Bend joint origin in part space. */
  center: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
}

const DEG = Math.PI / 180

function emptyPose(): PartPose {
  return { pos: [0, 0, 0], rot: [0, 0, 0], bend: [0, 0, 0], scale: [1, 1, 1] }
}

/** Default object name when OBJ has no `o` / `g` groups. */
export const OBJ_DEFAULT_OBJECT = 'default'

export function meshObjectNamesFromObj(objBytes: Uint8Array): string[] {
  const names = scanObjObjectNames(objBytes)
  return names.length > 0 ? names : [OBJ_DEFAULT_OBJECT]
}

/**
 * Drop inflated hat / jacket / sleeve objects so convert is inner cubes only.
 * Preview keeps the second layer; voxelizing those hollow inflate boxes as
 * extra shells is what made cyan sheets and chunky hair float off Steve.
 */
export function stripMinecraftOverlayObjects(objBytes: Uint8Array): Uint8Array {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const out: string[] = []
  let skipObject = false
  let skipMat = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('o ') || trimmed.startsWith('g ')) {
      const name = trimmed.slice(2).trim()
      skipObject = /overlay/i.test(name)
      skipMat = false
    } else if (/^usemtl\s+/i.test(trimmed)) {
      skipMat = /overlay/i.test(trimmed.replace(/^usemtl\s+/i, ''))
    }
    if (skipObject || skipMat) continue
    out.push(line)
  }
  const joined = out.join('\n')
  return new TextEncoder().encode(joined.endsWith('\n') ? joined : `${joined}\n`)
}

/** Integer voxel size of remaining inner cubes (1 mesh unit = 1 pixel). */
export function objAxisAlignedSize(
  objBytes: Uint8Array,
): { width: number; height: number; length: number } | null {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let found = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('v ')) continue
    const bits = line.split(/\s+/)
    const x = Number(bits[1])
    const y = Number(bits[2])
    const z = Number(bits[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    found = true
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  if (!found) return null
  return clampVoxelBox({
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
    length: Math.max(1, Math.round(maxZ - minZ)),
  })
}

/** True when Build size is bigger than the native/posed mesh — size presets, custom scale. */
export function catalogEntityBoxIsEnlarged(
  user: { width: number; height: number; length: number },
  native: { width: number; height: number; length: number },
): boolean {
  if (user.width < 1 || user.height < 1 || user.length < 1) return false
  return (
    user.width > native.width + 1
    || user.height > native.height + 1
    || user.length > native.length + 1
  )
}

/**
 * Voxel grid for a catalog mob. Native convert stays 1px = 1 block (posed AABB +
 * stretch) so angry Enderman height and thin limbs stay intact. A larger Build
 * size — Medium / Fit scale / custom W-H-L — is the convert box instead of the
 * mesh AABB, which used to pin bees and silverfish to a few blocks.
 */
export function catalogEntityVoxelBox(
  user: { width: number; height: number; length: number; fit?: VoxelFit | null },
  posed: { width: number; height: number; length: number },
): { width: number; height: number; length: number; fit: VoxelFit } {
  if (catalogEntityBoxIsEnlarged(user, posed)) {
    return {
      width: user.width,
      height: user.height,
      length: user.length,
      fit: user.fit === 'fit' ? 'fit' : 'stretch',
    }
  }
  return {
    width: posed.width,
    height: posed.height,
    length: posed.length,
    fit: 'stretch',
  }
}

/** List unique `o` / `g` names from Wavefront OBJ (order preserved). */
export function scanObjObjectNames(objBytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const names: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('o ') || line.startsWith('g ')) {
      const name = line.slice(2).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function meshPartGroupName(objectName: string): string {
  return `mesh-part:${objectName}`
}

export function meshBendGroupName(objectName: string): string {
  return `mesh-bend:${objectName}`
}

export function findMeshBendObject(
  root: THREE.Object3D,
  objectName: string,
): THREE.Object3D | null {
  return root.getObjectByName(meshBendGroupName(objectName)) ?? null
}

export function boundsFromPositions(
  name: string,
  positions: ArrayLike<number>,
): MeshObjectBounds | null {
  if (positions.length < 3) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null
  const sizeX = Math.max(0, maxX - minX)
  const sizeY = Math.max(0, maxY - minY)
  const sizeZ = Math.max(0, maxZ - minZ)
  return {
    name,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
    volume: Math.max(sizeX * sizeY * sizeZ, 1e-8),
  }
}

/**
 * Tiny accessory meshes (eyes / glasses / buttons) follow a nearby larger host.
 * Limbs must NOT follow the body — only pieces that are a small fraction of the host.
 */
export function buildPoseFollowerMap(boundsList: MeshObjectBounds[]): Map<string, string> {
  const sorted = [...boundsList].sort((a, b) => b.volume - a.volume)
  const childToHost = new Map<string, string>()
  for (let i = 0; i < sorted.length; i += 1) {
    const child = sorted[i]!
    if (child.name === 'pumpkin') continue
    let best: MeshObjectBounds | null = null
    for (let j = 0; j < i; j += 1) {
      const host = sorted[j]!
      if (!isAccessoryOf(child, host)) continue
      if (!best || host.volume < best.volume) best = host
    }
    if (best) childToHost.set(child.name, best.name)
  }
  // Minecraft second-layer shells (`head_overlay`) must follow the inner limb.
  const listed = new Set(boundsList.map((box) => box.name))
  for (const box of boundsList) {
    if (!box.name.endsWith('_overlay')) continue
    const host = box.name.slice(0, -'_overlay'.length)
    if (host && listed.has(host) && !childToHost.has(box.name)) {
      childToHost.set(box.name, host)
    }
  }
  return childToHost
}

function extentOf(box: MeshObjectBounds): number {
  return Math.max(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
    1e-8,
  )
}

function looksLikeAccessoryName(name: string): boolean {
  return /eye|glass|lens|pupil|iris|brow|lash|tooth|teeth|gum|button|badge|pin|earring|stud|screw|bolt|nail|mole|scar|freckle|stubble|hairline|strap|buckle/i.test(
    name,
  )
}

function isAccessoryOf(child: MeshObjectBounds, host: MeshObjectBounds): boolean {
  // Hard size gate: accessories are tiny vs their host (not arms/legs).
  const volumeRatio = host.volume / Math.max(child.volume, 1e-12)
  const extentRatio = extentOf(host) / extentOf(child)
  const named = looksLikeAccessoryName(child.name)
  if (named) {
    if (volumeRatio < 4 || extentRatio < 1.5) return false
  } else if (volumeRatio < 25 || extentRatio < 3.5) {
    return false
  }
  // Centre must sit well inside the host (limbs stick out past the torso).
  if (!pointInExpandedAabb(child.center, host, named ? 0.2 : 0.02)) return false
  // Most of the child box should overlap the host — rejects outstretched limbs.
  // Named accessories are often flat cards (zero thickness) so skip overlap volume.
  if (!named && overlapVolume(child, host) < child.volume * 0.85) return false
  return true
}

function overlapVolume(a: MeshObjectBounds, b: MeshObjectBounds): number {
  const minX = Math.max(a.min[0], b.min[0])
  const minY = Math.max(a.min[1], b.min[1])
  const minZ = Math.max(a.min[2], b.min[2])
  const maxX = Math.min(a.max[0], b.max[0])
  const maxY = Math.min(a.max[1], b.max[1])
  const maxZ = Math.min(a.max[2], b.max[2])
  if (maxX <= minX || maxY <= minY || maxZ <= minZ) return 0
  return (maxX - minX) * (maxY - minY) * (maxZ - minZ)
}

function pointInExpandedAabb(
  point: [number, number, number],
  box: MeshObjectBounds,
  padFrac: number,
): boolean {
  const padX = (box.max[0] - box.min[0]) * padFrac + 1e-4
  const padY = (box.max[1] - box.min[1]) * padFrac + 1e-4
  const padZ = (box.max[2] - box.min[2]) * padFrac + 1e-4
  return (
    point[0] >= box.min[0] - padX
    && point[0] <= box.max[0] + padX
    && point[1] >= box.min[1] - padY
    && point[1] <= box.max[1] + padY
    && point[2] >= box.min[2] - padZ
    && point[2] <= box.max[2] + padZ
  )
}

/** Host + unparented names — what the pose panel lists. */
export function poseEditableObjectNames(
  objectNames: string[],
  followerMap: Map<string, string>,
): string[] {
  return objectNames.filter((name) => !followerMap.has(name))
}

/** Inner limb for a second-layer shell (`head_overlay` → `head`). */
export function meshPoseHostLimbId(id: string): string {
  return id.endsWith('_overlay') ? id.slice(0, -'_overlay'.length) : id
}

/** Children that should move with a host (one level). */
export function followersOf(
  host: string,
  followerMap: Map<string, string>,
): string[] {
  const out: string[] = []
  for (const [child, parent] of followerMap) {
    if (parent === host) out.push(child)
  }
  return out
}

/** Scan OBJ into per-object bounds for follower detection. */
export function scanObjObjectBounds(objBytes: Uint8Array): MeshObjectBounds[] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const verts: [number, number, number][] = []
  let current = OBJ_DEFAULT_OBJECT
  const byObject = new Map<string, number[]>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('o ') || line.startsWith('g ')) {
      current = line.slice(2).trim() || OBJ_DEFAULT_OBJECT
    } else if (line.startsWith('v ')) {
      const parts = line.split(/\s+/)
      verts.push([
        Number(parts[1]) || 0,
        Number(parts[2]) || 0,
        Number(parts[3]) || 0,
      ])
    } else if (line.startsWith('f ')) {
      const bucket = byObject.get(current) ?? []
      for (const token of line.split(/\s+/).slice(1)) {
        const vi = Number(token.split('/')[0])
        if (!Number.isFinite(vi)) continue
        const index = vi > 0 ? vi - 1 : verts.length + vi
        const v = verts[index]
        if (!v) continue
        bucket.push(v[0], v[1], v[2])
      }
      byObject.set(current, bucket)
    }
  }

  const out: MeshObjectBounds[] = []
  for (const [name, positions] of byObject) {
    const bounds = boundsFromPositions(name, positions)
    if (bounds) out.push(bounds)
  }
  return out
}

/** Infer bend split from triangle-soup positions (9 floats per triangle). */
export function computeBendSplitFromPositions(positions: ArrayLike<number>): MeshBendSplit | null {
  if (positions.length < 9) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null
  return makeBendSplit(
    [minX, minY, minZ],
    [maxX, maxY, maxZ],
  )
}

function makeBendSplit(
  min: [number, number, number],
  max: [number, number, number],
  pivotOverride?: [number, number, number] | null,
): MeshBendSplit | null {
  const size: [number, number, number] = [
    Math.max(0, max[0] - min[0]),
    Math.max(0, max[1] - min[1]),
    Math.max(0, max[2] - min[2]),
  ]
  const extent = Math.max(size[0], size[1], size[2])
  if (extent < 1e-4) return null
  // Prefer the longest axis; ties prefer Y then X (limb-friendly).
  let axis: 0 | 1 | 2 = 1
  if (size[0] >= size[1] && size[0] >= size[2]) axis = 0
  else if (size[2] > size[1] && size[2] > size[0]) axis = 2
  else axis = 1
  const mid: [number, number, number] = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ]
  const center: [number, number, number] = pivotOverride
    ? [pivotOverride[0], pivotOverride[1], pivotOverride[2]]
    : mid
  return {
    axis,
    pivot: center[axis],
    center,
    min,
    max,
  }
}

/** Override the bend/rotate pivot (click point) while keeping AABB axis. */
export function bendSplitWithPivot(
  split: MeshBendSplit,
  pivot: [number, number, number],
): MeshBendSplit {
  return {
    ...split,
    center: [pivot[0], pivot[1], pivot[2]],
    pivot: pivot[split.axis],
  }
}

/** Distal = further from the rotate joint than the split centre (elbow/knee). */
function isDistalFromJoint(
  centroid: [number, number, number],
  joint: [number, number, number],
  split: MeshBendSplit,
): boolean {
  const limb: [number, number, number] = [
    split.center[0] - joint[0],
    split.center[1] - joint[1],
    split.center[2] - joint[2],
  ]
  const limbLen = Math.hypot(limb[0], limb[1], limb[2])
  if (limbLen < 1e-6) {
    const coord = split.axis === 0 ? centroid[0] : split.axis === 1 ? centroid[1] : centroid[2]
    return coord < split.pivot - 1e-6
  }
  const along =
    (centroid[0] - joint[0]) * limb[0]
    + (centroid[1] - joint[1]) * limb[1]
    + (centroid[2] - joint[2]) * limb[2]
  const midAlong = limb[0] * limb[0] + limb[1] * limb[1] + limb[2] * limb[2]
  return along >= midAlong - 1e-6
}

/** Pick upper vs lower joint from a mesh click (catalog humanoids, rotate-only). */
export function catalogClickPoseLimbId(
  limbId: string,
  hitLocal: { x: number; y: number; z: number },
  partGroup: { userData: Record<string, unknown> },
): string {
  if (!isSkinLimbBendName(limbId)) return limbId
  const split = partGroup.userData.bendSplit as MeshBendSplit | undefined
  if (!split) return limbId
  const restPivot =
    (partGroup.userData.restPivot as [number, number, number] | undefined)
    ?? [0, 0, 0]
  const rest: [number, number, number] = [
    hitLocal.x + restPivot[0],
    hitLocal.y + restPivot[1],
    hitLocal.z + restPivot[2],
  ]
  return isDistalFromJoint(rest, restPivot, split)
    ? skinPoseBendLimbId(limbId)
    : limbId
}

/**
 * Split triangle soup into upper (stays on part) and lower (parented under bend joint).
 * Lower positions are relative to the bend pivot so the joint can rotate them.
 */
export function splitMeshForBend(
  positions: Float32Array,
  colors: Float32Array,
  uvs: Float32Array,
  split: MeshBendSplit,
  joint?: [number, number, number],
): {
  upper: { positions: Float32Array; colors: Float32Array; uvs: Float32Array; triangleCount: number }
  lower: { positions: Float32Array; colors: Float32Array; uvs: Float32Array; triangleCount: number }
} {
  const hasUv = uvs.length >= (positions.length / 3) * 2
  const upPos: number[] = []
  const upCol: number[] = []
  const upUv: number[] = []
  const loPos: number[] = []
  const loCol: number[] = []
  const loUv: number[] = []
  const triangleCount = Math.floor(positions.length / 9)
  const { axis, pivot, center } = split
  const pivotPoint: [number, number, number] = [center[0], center[1], center[2]]
  pivotPoint[axis] = pivot

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
    const coords = [ax, ay, az, bx, by, bz, cx, cy, cz]
    const centroid: [number, number, number] = [
      (ax + bx + cx) / 3,
      (ay + by + cy) / 3,
      (az + bz + cz) / 3,
    ]
    const isLower = joint
      ? isDistalFromJoint(centroid, joint, split)
      : (axis === 0 ? centroid[0] : axis === 1 ? centroid[1] : centroid[2]) < pivot - 1e-6
    const destPos = isLower ? loPos : upPos
    const destCol = isLower ? loCol : upCol
    const destUv = isLower ? loUv : upUv
    if (isLower) {
      for (let k = 0; k < 3; k += 1) {
        destPos.push(
          coords[k * 3]! - pivotPoint[0],
          coords[k * 3 + 1]! - pivotPoint[1],
          coords[k * 3 + 2]! - pivotPoint[2],
        )
      }
    } else {
      for (let k = 0; k < 9; k += 1) destPos.push(coords[k]!)
    }
    for (let k = 0; k < 9; k += 1) destCol.push(colors[i + k] ?? 0.7)
    if (hasUv) {
      const u = t * 6
      for (let k = 0; k < 6; k += 1) destUv.push(uvs[u + k] ?? 0)
    }
  }

  return {
    upper: {
      positions: new Float32Array(upPos),
      colors: new Float32Array(upCol),
      uvs: new Float32Array(upUv),
      triangleCount: Math.floor(upPos.length / 9),
    },
    lower: {
      positions: new Float32Array(loPos),
      colors: new Float32Array(loCol),
      uvs: new Float32Array(loUv),
      triangleCount: Math.floor(loPos.length / 9),
    },
  }
}

/** Apply authored pose to nested OBJ object groups in the preview scene. */
export function applyMeshPartPoseToGroup(
  root: THREE.Object3D,
  pose: MeshPartPose | null | undefined,
): void {
  if (!pose) return
  const meshRoot = root.getObjectByName('mesh-parts')
  if (!meshRoot) return

  meshRoot.rotation.order = 'XYZ'
  meshRoot.rotation.set(
    pose.root.rot[0] * DEG,
    pose.root.rot[1] * DEG,
    pose.root.rot[2] * DEG,
  )
  meshRoot.position.set(pose.root.pos[0], pose.root.pos[1], pose.root.pos[2])

  const poseParents =
    pose.poseParents
    ?? (pose.rigid ? inferCatalogPoseParents(Object.keys(pose.parts)) : undefined)
  nestMeshPartParents(meshRoot, poseParents)

  meshRoot.traverse((obj) => {
    if (obj.type !== 'Group') return
    if (obj.name.startsWith('mesh-bend:')) {
      const name = obj.name.slice('mesh-bend:'.length)
      const partPose = pose.parts[name]
      if (!partPose) return
      obj.rotation.order = 'XYZ'
      // Bend gizmo joint — visual only; geometry is morphed below.
      obj.rotation.set(
        partPose.bend[0] * DEG,
        partPose.bend[1] * DEG,
        partPose.bend[2] * DEG,
      )
      return
    }
    if (!obj.name.startsWith('mesh-part:')) return
    const name = obj.name.slice('mesh-part:'.length)
    const partPose =
      pose.parts[name]
      ?? (name.endsWith('_overlay') ? pose.parts[meshPoseHostLimbId(name)] : undefined)
      ?? emptyPose()
    const restPivot =
      (obj.userData.restPivot as [number, number, number] | undefined)
      ?? [0, 0, 0]
    const clickPivot = pose.pivots?.[name]
    const joint: [number, number, number] = clickPivot
      ? [clickPivot[0], clickPivot[1], clickPivot[2]]
      : restPivot
    const rigid = Boolean(pose.rigid)
    const content = obj.getObjectByName(`mesh-content:${name}`)
    // Keep the part origin fixed at the rest centroid so clicks don't yank the mesh.
    if (content) {
      content.position.set(-restPivot[0], -restPivot[1], -restPivot[2])
    }
    const bend = obj.getObjectByName(meshBendGroupName(name))
    const baseSplit = obj.userData.bendSplit as MeshBendSplit | undefined
    const bendParented = Boolean(obj.userData.bendParented)
      || Boolean(bend && bend.children.length > 0)
    if (bend) {
      const elbow = rigid && bendParented && baseSplit
        ? baseSplit.center
        : joint
      bend.position.set(
        elbow[0] - restPivot[0],
        elbow[1] - restPivot[1],
        elbow[2] - restPivot[2],
      )
    }
    const clicked = rigid ? false : Boolean(clickPivot)
    const rotAngles: [number, number, number] = [
      partPose.rot[0],
      partPose.rot[1],
      partPose.rot[2],
    ]
    const bendAngles: [number, number, number] = [
      partPose.bend[0],
      partPose.bend[1],
      partPose.bend[2],
    ]
    const objectStrokes = (pose.strokes ?? []).filter((stroke) => stroke.objectName === name)
    obj.userData.activePivot = joint
    const localRest = localRestPosition(obj, restPivot)
    obj.userData.baseLocal = localRest
    obj.position.set(
      localRest[0] + partPose.pos[0],
      localRest[1] + partPose.pos[1],
      localRest[2] + partPose.pos[2],
    )

    if (rigid) {
      // Catalog cubes: rigid group rotation only — never morph verts (that warps/stretch).
      obj.rotation.order = 'XYZ'
      obj.rotation.set(rotAngles[0] * DEG, rotAngles[1] * DEG, rotAngles[2] * DEG)
      if (bend) {
        bend.rotation.set(0, 0, 0)
      }
      if (content) {
        content.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (!mesh.isMesh) return
          const geometry = mesh.geometry as THREE.BufferGeometry
          const rest = geometry.userData.restPositions as Float32Array | undefined
          const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
          if (!rest || !posAttr) return
          const arr = posAttr.array as Float32Array
          arr.set(rest)
          posAttr.needsUpdate = true
        })
      }
      return
    }

    // Organic meshes: rotation is a regional vertex morph around `joint`,
    // not a whole-group spin (that swung the entire character).
    obj.rotation.set(0, 0, 0)
    if (bend) {
      bend.rotation.order = 'XYZ'
    }
    if (content) {
      content.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        const geometry = mesh.geometry as THREE.BufferGeometry
        const rest = geometry.userData.restPositions as Float32Array | undefined
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
        if (!rest || !posAttr) return
        morphPoseStrokeChain(
          rest,
          posAttr,
          objectStrokes,
          {
            rot: rotAngles,
            bend: bendAngles,
            pos: [0, 0, 0],
            joint,
            clicked,
            rigid,
          },
          restPivot,
          baseSplit,
        )
        posAttr.needsUpdate = true
        geometry.computeVertexNormals()
      })
    }
  })
}

export function partPoseChannelsActive(part: PartPose | null | undefined): boolean {
  if (!part) return false
  return (
    Math.abs(part.rot[0]) + Math.abs(part.rot[1]) + Math.abs(part.rot[2])
    + Math.abs(part.bend[0]) + Math.abs(part.bend[1]) + Math.abs(part.bend[2])
    + Math.abs(part.pos[0]) + Math.abs(part.pos[1]) + Math.abs(part.pos[2])
    > 0.05
  )
}

export function poseIsActive(pose: MeshPartPose | null | undefined): boolean {
  if (!pose) return false
  if (partPoseChannelsActive(pose.root)) return true
  if (Object.values(pose.parts).some((p) => partPoseChannelsActive(p))) return true
  return (pose.strokes?.length ?? 0) > 0
}

export function cloneMeshPoseStrokes(
  strokes: MeshPoseStroke[] | undefined,
): MeshPoseStroke[] | undefined {
  if (!strokes?.length) return strokes
  return strokes.map((stroke) => ({
    objectName: stroke.objectName,
    pivot: [stroke.pivot[0], stroke.pivot[1], stroke.pivot[2]] as [number, number, number],
    rot: [stroke.rot[0], stroke.rot[1], stroke.rot[2]] as [number, number, number],
    bend: [stroke.bend[0], stroke.bend[1], stroke.bend[2]] as [number, number, number],
    pos: [stroke.pos[0], stroke.pos[1], stroke.pos[2]] as [number, number, number],
  }))
}

/**
 * When the user clicks a new joint, stash the live bend/rotate so it stays on
 * the old joint instead of jumping to the new click.
 */
export function commitLivePoseStroke(
  pose: MeshPartPose,
  objectName: string,
  fallbackPivot: [number, number, number],
): MeshPartPose {
  const part = pose.parts[objectName]
  if (!partPoseChannelsActive(part)) return pose
  const pivot = pose.pivots?.[objectName] ?? fallbackPivot
  const stroke: MeshPoseStroke = {
    objectName,
    pivot: [pivot[0], pivot[1], pivot[2]],
    rot: [part!.rot[0], part!.rot[1], part!.rot[2]],
    bend: [part!.bend[0], part!.bend[1], part!.bend[2]],
    pos: [part!.pos[0], part!.pos[1], part!.pos[2]],
  }
  return {
    ...pose,
    strokes: [...(pose.strokes ?? []), stroke],
    parts: {
      ...pose.parts,
      [objectName]: emptyPose(),
    },
  }
}

export function ensureMeshPartPose(
  objectNames: string[],
  existing?: MeshPartPose | null,
): MeshPartPose {
  const parts: Record<string, PartPose> = {}
  for (const name of objectNames) {
    const prev = existing?.parts[name]
    parts[name] = prev
      ? {
          pos: [...prev.pos] as [number, number, number],
          rot: [...prev.rot] as [number, number, number],
          bend: [...prev.bend] as [number, number, number],
          scale: [...prev.scale] as [number, number, number],
        }
      : emptyPose()
  }
  const root = existing?.root
  const pivots = existing?.pivots
    ? Object.fromEntries(
        Object.entries(existing.pivots).map(([key, value]) => [
          key,
          [value[0], value[1], value[2]] as [number, number, number],
        ]),
      )
    : undefined
  return {
    root: root
      ? {
          pos: [...root.pos] as [number, number, number],
          rot: [...root.rot] as [number, number, number],
          bend: [...root.bend] as [number, number, number],
          scale: [...root.scale] as [number, number, number],
        }
      : emptyPose(),
    parts,
    pivots,
    strokes: cloneMeshPoseStrokes(existing?.strokes),
    rigid: existing?.rigid,
    poseParents: existing?.poseParents ? { ...existing.poseParents } : undefined,
  }
}

/** Apply committed strokes then the live joint pose into `out`. */
export function morphPoseStrokeChain(
  rest: Float32Array,
  out: { setXYZ: (i: number, x: number, y: number, z: number) => void },
  strokes: MeshPoseStroke[],
  live: {
    rot: [number, number, number]
    bend: [number, number, number]
    pos: [number, number, number]
    joint: [number, number, number]
    clicked: boolean
    rigid?: boolean
  },
  restCenter: [number, number, number],
  split: MeshBendSplit | undefined,
): void {
  const bendAxis = (split?.axis ?? 1) as 0 | 1 | 2
  const count = Math.floor(rest.length / 3)
  let src = new Float32Array(rest)
  const dest = new Float32Array(rest.length)
  const writer = {
    setXYZ(i: number, x: number, y: number, z: number) {
      dest[i * 3] = x
      dest[i * 3 + 1] = y
      dest[i * 3 + 2] = z
    },
  }

  const run = (
    rot: [number, number, number],
    bend: [number, number, number],
    pos: [number, number, number],
    joint: [number, number, number],
    clicked: boolean,
  ) => {
    const influence = split
      ? limbInfluenceForJoint(split, joint, restCenter, clicked)
      : { along: 1, tube: 0.35, isolateLimb: false }
    morphPosePositions(
      src,
      writer,
      rot,
      bend,
      joint,
      restCenter,
      influence.along,
      bendAxis,
      influence.tube,
      influence.isolateLimb,
      Boolean(live.rigid),
    )
    if (Math.abs(pos[0]) + Math.abs(pos[1]) + Math.abs(pos[2]) > 0.05) {
      for (let i = 0; i < count; i += 1) {
        dest[i * 3]! += pos[0]
        dest[i * 3 + 1]! += pos[1]
        dest[i * 3 + 2]! += pos[2]
      }
    }
    src = new Float32Array(dest)
  }

  for (const stroke of strokes) {
    run(stroke.rot, stroke.bend, stroke.pos, stroke.pivot, true)
  }
  run(live.rot, live.bend, live.pos, live.joint, live.clicked)

  for (let i = 0; i < count; i += 1) {
    out.setXYZ(i, src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!)
  }
}

function rotatePointEulerXyz(
  p: [number, number, number],
  center: [number, number, number],
  rotDeg: [number, number, number],
): [number, number, number] {
  const [rx, ry, rz] = rotDeg.map((d) => d * DEG) as [number, number, number]
  let x = p[0] - center[0]
  let y = p[1] - center[1]
  let z = p[2] - center[2]

  // Three.js XYZ: Rz → Ry → Rx on column vectors.
  if (Math.abs(rz) > 1e-8) {
    const c = Math.cos(rz)
    const s = Math.sin(rz)
    const nx = x * c - y * s
    const ny = x * s + y * c
    x = nx
    y = ny
  }
  if (Math.abs(ry) > 1e-8) {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    const nx = x * c + z * s
    const nz = -x * s + z * c
    x = nx
    z = nz
  }
  if (Math.abs(rx) > 1e-8) {
    const c = Math.cos(rx)
    const s = Math.sin(rx)
    const ny = y * c - z * s
    const nz = y * s + z * c
    y = ny
    z = nz
  }

  return [x + center[0], y + center[1], z + center[2]]
}

function transformRotPos(
  p: [number, number, number],
  center: [number, number, number],
  pose: PartPose,
): [number, number, number] {
  const rot: [number, number, number] = [pose.rot[0], pose.rot[1], pose.rot[2]]
  const rotated = rotatePointEulerXyz(p, center, rot)
  return [
    rotated[0] + pose.pos[0],
    rotated[1] + pose.pos[1],
    rotated[2] + pose.pos[2],
  ]
}

/**
 * Bend/rotate verts around a joint.
 * - `isolateLimb`: thin tube past the joint (whole-body Maya click).
 * - otherwise: whole part sphere; bend still prefers the distal half.
 */
export function morphPosePositions(
  rest: Float32Array,
  out: { setXYZ: (i: number, x: number, y: number, z: number) => void },
  rot: [number, number, number],
  bend: [number, number, number],
  joint: [number, number, number],
  restCenter: [number, number, number],
  influenceRadius: number,
  bendAxis: 0 | 1 | 2,
  tubeRadius?: number,
  isolateLimb = false,
  rigid = false,
): void {
  const rotActive = Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]) > 0.05
  const bendActive = Math.abs(bend[0]) + Math.abs(bend[1]) + Math.abs(bend[2]) > 0.05
  if (!rotActive && !bendActive) {
    const count = Math.floor(rest.length / 3)
    for (let i = 0; i < count; i += 1) {
      out.setXYZ(i, rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!)
    }
    return
  }
  const count = Math.floor(rest.length / 3)
  if (rigid) {
    let away: [number, number, number] = [
      restCenter[0] - joint[0],
      restCenter[1] - joint[1],
      restCenter[2] - joint[2],
    ]
    const awayLen = Math.hypot(away[0], away[1], away[2])
    if (awayLen < 1e-6) {
      away = [0, -1, 0]
      away[bendAxis] = -1
    } else {
      away = [away[0] / awayLen, away[1] / awayLen, away[2] / awayLen]
    }
    // Hard hinge — a blend band interpolates verts and stretches the mesh.
    const blend = 0
    for (let i = 0; i < count; i += 1) {
      const p0: [number, number, number] = [
        rest[i * 3]!,
        rest[i * 3 + 1]!,
        rest[i * 3 + 2]!,
      ]
      let p: [number, number, number] = p0
      if (bendActive) {
        const along =
          (p0[0] - restCenter[0]) * away[0]
          + (p0[1] - restCenter[1]) * away[1]
          + (p0[2] - restCenter[2]) * away[2]
        const side = along >= 0 ? 1 : along > -blend ? (along + blend) / blend : 0
        if (side > 0) {
          const bent = rotatePointEulerXyz(p0, restCenter, bend)
          p = [
            p0[0] + (bent[0] - p0[0]) * side,
            p0[1] + (bent[1] - p0[1]) * side,
            p0[2] + (bent[2] - p0[2]) * side,
          ]
        }
      }
      if (rotActive) p = rotatePointEulerXyz(p, joint, rot)
      out.setXYZ(i, p[0], p[1], p[2])
    }
    return
  }
  const alongMax = Math.max(influenceRadius, 1e-4)
  const away = distalDirection(joint, restCenter, bendAxis, alongMax)
  const estimated = estimateLimbTubeRadius(rest, joint, away, alongMax)
  const cap = tubeRadius ?? Math.max(alongMax * 0.4, 1e-4)
  const tube = Math.min(Math.max(estimated, alongMax * 0.05), cap)
  const blend = Math.min(tube * 0.4, alongMax * 0.1)
  const invAlong = 1 / alongMax

  for (let i = 0; i < count; i += 1) {
    const p0: [number, number, number] = [
      rest[i * 3]!,
      rest[i * 3 + 1]!,
      rest[i * 3 + 2]!,
    ]
    const dx = p0[0] - joint[0]
    const dy = p0[1] - joint[1]
    const dz = p0[2] - joint[2]
    const along = dx * away[0] + dy * away[1] + dz * away[2]
    const dist = Math.hypot(dx, dy, dz)
    const px = dx - away[0] * along
    const py = dy - away[1] * along
    const pz = dz - away[2] * along
    const perp = Math.hypot(px, py, pz)

    let w = 0
    if (isolateLimb) {
      if (along < -blend || along > alongMax * 1.1 || perp > tube) {
        out.setXYZ(i, p0[0], p0[1], p0[2])
        continue
      }
      const side = along >= 0 ? 1 : (along + blend) / blend
      const perpT = perp / tube
      const perpW = (1 - perpT) * (1 - perpT) * (1 + 2 * perpT)
      w = side * perpW
    } else {
      if (dist > alongMax) {
        out.setXYZ(i, p0[0], p0[1], p0[2])
        continue
      }
      const t = dist * invAlong
      const falloff = (1 - t) * (1 - t) * (1 + 2 * t)
      // Rotate the whole part; bend only the distal half.
      if (bendActive && !rotActive) {
        const side = along >= 0 ? 1 : along > -blend ? (along + blend) / blend : 0
        w = falloff * side
      } else if (bendActive && rotActive) {
        const side = along >= 0 ? 1 : along > -blend ? (along + blend) / blend : 0
        w = falloff * Math.max(side, 0.85)
      } else {
        w = falloff
      }
    }
    if (w <= 1e-6) {
      out.setXYZ(i, p0[0], p0[1], p0[2])
      continue
    }

    let p: [number, number, number] = p0
    if (bendActive) {
      const bent = rotatePointEulerXyz(p0, joint, bend)
      const bendW = isolateLimb
        ? w
        : w * (along >= 0 ? 1 : along > -blend ? (along + blend) / blend : 0)
      p = [
        p0[0] + (bent[0] - p0[0]) * bendW,
        p0[1] + (bent[1] - p0[1]) * bendW,
        p0[2] + (bent[2] - p0[2]) * bendW,
      ]
    }
    if (rotActive) {
      const rotated = rotatePointEulerXyz(p, joint, rot)
      p = [
        p[0] + (rotated[0] - p[0]) * w,
        p[1] + (rotated[1] - p[1]) * w,
        p[2] + (rotated[2] - p[2]) * w,
      ]
    }
    out.setXYZ(i, p[0], p[1], p[2])
  }
}

/**
 * Hug the clicked limb: low percentile of perpendicular distances among
 * distal verts, so chunky torsos outside the arm/leg stay still.
 */
function estimateLimbTubeRadius(
  rest: Float32Array,
  joint: [number, number, number],
  away: [number, number, number],
  alongMax: number,
): number {
  const perps: number[] = []
  const count = Math.floor(rest.length / 3)
  const alongLo = alongMax * 0.08
  const alongHi = alongMax * 0.9
  const outlier = alongMax * 0.55
  for (let i = 0; i < count; i += 1) {
    const dx = rest[i * 3]! - joint[0]
    const dy = rest[i * 3 + 1]! - joint[1]
    const dz = rest[i * 3 + 2]! - joint[2]
    const along = dx * away[0] + dy * away[1] + dz * away[2]
    if (along < alongLo || along > alongHi) continue
    const px = dx - away[0] * along
    const py = dy - away[1] * along
    const pz = dz - away[2] * along
    const perp = Math.hypot(px, py, pz)
    if (perp > outlier) continue
    perps.push(perp)
  }
  if (perps.length < 6) return alongMax * 0.22
  perps.sort((a, b) => a - b)
  const pick = perps[Math.floor(perps.length * 0.3)] ?? perps[0]!
  return Math.max(pick * 1.2, alongMax * 0.06)
}

/** Unit vector toward the posed extremity (hand / lower limb). */
function distalDirection(
  joint: [number, number, number],
  restCenter: [number, number, number],
  bendAxis: 0 | 1 | 2,
  sizeHint = 1,
): [number, number, number] {
  const away: [number, number, number] = [
    joint[0] - restCenter[0],
    joint[1] - restCenter[1],
    joint[2] - restCenter[2],
  ]
  const awayLen = Math.hypot(away[0], away[1], away[2])
  // Near the part centre (mid-limb default), bend the lower half. A clear
  // offset means the user clicked a sticking-out limb on a whole-body mesh.
  if (awayLen < Math.max(1e-4, sizeHint * 0.05)) {
    const fallback: [number, number, number] = [0, 0, 0]
    fallback[bendAxis] = -1
    return fallback
  }
  const ax = Math.abs(away[0])
  const ay = Math.abs(away[1])
  const az = Math.abs(away[2])
  // Snap to a cardinal axis when one dominates — diagonal centre→click tubes
  // cut through arms/legs and drag the torso with them.
  if (ax >= ay * 1.12 && ax >= az * 1.12) {
    return [away[0] >= 0 ? 1 : -1, 0, 0]
  }
  if (ay >= ax * 1.12 && ay >= az * 1.12) {
    return [0, away[1] >= 0 ? 1 : -1, 0]
  }
  if (az >= ax * 1.12 && az >= ay * 1.12) {
    return [0, 0, away[2] >= 0 ? 1 : -1]
  }
  return [away[0] / awayLen, away[1] / awayLen, away[2] / awayLen]
}

export function influenceRadiusForPart(split: MeshBendSplit): number {
  const dx = split.max[0] - split.min[0]
  const dy = split.max[1] - split.min[1]
  const dz = split.max[2] - split.min[2]
  const diag = Math.hypot(dx, dy, dz)
  return Math.max(diag * 0.55, Math.max(dx, dy, dz) * 0.65)
}

/** Along-limb reach for a clicked/default joint (used as morph length). */
export function influenceRadiusForJoint(
  split: MeshBendSplit,
  joint: [number, number, number],
  restCenter: [number, number, number],
  clicked: boolean,
): number {
  return limbInfluenceForJoint(split, joint, restCenter, clicked).along
}

/** Along reach + tube radius so torso outside the limb isn't dragged. */
export function limbInfluenceForJoint(
  split: MeshBendSplit,
  joint: [number, number, number],
  restCenter: [number, number, number],
  clicked: boolean,
): { along: number; tube: number; isolateLimb: boolean } {
  const full = influenceRadiusForPart(split)
  const dx = split.max[0] - split.min[0]
  const dy = split.max[1] - split.min[1]
  const dz = split.max[2] - split.min[2]
  const diag = Math.hypot(dx, dy, dz)
  const dims = [dx, dy, dz].sort((a, b) => a - b)
  const thin = dims[0]!
  const mid = dims[1]!
  if (!clicked) {
    return {
      along: full,
      tube: Math.max(thin * 0.65, mid * 0.35, full * 0.25),
      isolateLimb: false,
    }
  }
  const away = distalDirection(joint, restCenter, split.axis, diag)
  const reachFromCenter = Math.hypot(
    joint[0] - restCenter[0],
    joint[1] - restCenter[1],
    joint[2] - restCenter[2],
  )
  const corners: Array<[number, number, number]> = [
    [split.min[0], split.min[1], split.min[2]],
    [split.max[0], split.min[1], split.min[2]],
    [split.min[0], split.max[1], split.min[2]],
    [split.max[0], split.max[1], split.min[2]],
    [split.min[0], split.min[1], split.max[2]],
    [split.max[0], split.min[1], split.max[2]],
    [split.min[0], split.max[1], split.max[2]],
    [split.max[0], split.max[1], split.max[2]],
  ]
  let distal = 0
  for (const c of corners) {
    const along =
      (c[0] - joint[0]) * away[0]
      + (c[1] - joint[1]) * away[1]
      + (c[2] - joint[2]) * away[2]
    if (along > distal) distal = along
  }
  // Whole-body mesh + click out on a limb → thin tube. Separate limb mesh → full part.
  const tentativeAlong = Math.max(distal * 1.05, diag * 0.08)
  const isolateLimb = diag > tentativeAlong * 2 && reachFromCenter > diag * 0.08
  const along = isolateLimb
    ? Math.min(full, tentativeAlong, diag * 0.32)
    : Math.min(full, Math.max(tentativeAlong, diag * 0.25))
  const tube = isolateLimb
    ? Math.min(
      along * 0.3,
      // Flat test meshes have ~0 thickness on one axis — use the mid span instead.
      (thin < mid * 0.05 ? mid * 0.35 : thin) * 0.5,
      mid * 0.16,
      diag * 0.055,
    )
    : Math.max(thin * 0.75, mid * 0.5, along * 0.35)
  return {
    along: Math.max(along, 1e-3),
    tube: Math.max(tube, along * 0.05),
    isolateLimb,
  }
}

/**
 * Bake per-object transforms into OBJ vertex positions (Blockbench-style XYZ).
 * Accessory meshes (eyes/glasses) follow their host. Click pivots move the joint.
 */
export function bakeObjPartPose(objBytes: Uint8Array, pose: MeshPartPose): Uint8Array {
  if (!poseIsActive(pose)) return objBytes

  const lines = new TextDecoder('utf-8', { fatal: false }).decode(objBytes).split(/\r?\n/)
  const verts: [number, number, number][] = []
  /** Optional `v x y z r g b` colours — must survive pose bake or convert washes to wool. */
  const vertRgb: ([number, number, number] | null)[] = []
  let currentObject = 'default'
  const faces: { object: string; indices: number[] }[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('o ') || line.startsWith('g ')) {
      currentObject = line.slice(2).trim() || 'default'
    } else if (line.startsWith('v ')) {
      const parts = line.split(/\s+/)
      verts.push([
        Number(parts[1]) || 0,
        Number(parts[2]) || 0,
        Number(parts[3]) || 0,
      ])
      if (parts.length >= 7) {
        vertRgb.push([
          Number(parts[4]) || 0,
          Number(parts[5]) || 0,
          Number(parts[6]) || 0,
        ])
      } else {
        vertRgb.push(null)
      }
    } else if (line.startsWith('f ')) {
      const idxs = line
        .split(/\s+/)
        .slice(1)
        .map((token) => Number(token.split('/')[0]))
        .filter((n) => Number.isFinite(n))
        .map((n) => (n > 0 ? n - 1 : verts.length + n))
      if (idxs.length >= 3) faces.push({ object: currentObject, indices: idxs })
    }
  }

  const usedByObject = new Map<string, Set<number>>()
  for (const face of faces) {
    const set = usedByObject.get(face.object) ?? new Set<number>()
    for (const i of face.indices) set.add(i)
    usedByObject.set(face.object, set)
  }

  const boundsList: MeshObjectBounds[] = []
  const splits = new Map<string, MeshBendSplit>()
  const centers = new Map<string, [number, number, number]>()
  for (const [objectName, indices] of usedByObject) {
    let sx = 0
    let sy = 0
    let sz = 0
    let n = 0
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const i of indices) {
      const v = verts[i]
      if (!v) continue
      sx += v[0]
      sy += v[1]
      sz += v[2]
      n += 1
      if (v[0] < minX) minX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[2] < minZ) minZ = v[2]
      if (v[0] > maxX) maxX = v[0]
      if (v[1] > maxY) maxY = v[1]
      if (v[2] > maxZ) maxZ = v[2]
    }
    if (n > 0) {
      const click = pose.pivots?.[objectName]
      const mid: [number, number, number] = [sx / n, sy / n, sz / n]
      centers.set(objectName, click ? [click[0], click[1], click[2]] : mid)
      const split = makeBendSplit(
        [minX, minY, minZ],
        [maxX, maxY, maxZ],
        click ?? null,
      )
      if (split) splits.set(objectName, split)
      boundsList.push({
        name: objectName,
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        center: mid,
        volume: Math.max((maxX - minX) * (maxY - minY) * (maxZ - minZ), 1e-8),
      })
    }
  }

  const followerMap = buildPoseFollowerMap(boundsList)

  const rootPose = pose.root
  const rootActive =
    Math.abs(rootPose.rot[0]) + Math.abs(rootPose.rot[1]) + Math.abs(rootPose.rot[2])
    + Math.abs(rootPose.pos[0]) + Math.abs(rootPose.pos[1]) + Math.abs(rootPose.pos[2]) > 0.05

  if (rootActive && verts.length > 0) {
    let sx = 0
    let sy = 0
    let sz = 0
    for (const v of verts) {
      sx += v[0]
      sy += v[1]
      sz += v[2]
    }
    const c: [number, number, number] = [sx / verts.length, sy / verts.length, sz / verts.length]
    for (let i = 0; i < verts.length; i += 1) {
      verts[i] = transformRotPos(verts[i]!, c, rootPose)
    }
  }

  const poseParents =
    pose.poseParents
    ?? (pose.rigid ? inferCatalogPoseParents([...usedByObject.keys()]) : undefined)

  for (const [objectName, indices] of usedByObject) {
    // Accessories are posed with their host — skip independent transforms.
    if (followerMap.has(objectName)) continue
    const partPose = pose.parts[objectName] ?? emptyPose()
    const objectStrokes = (pose.strokes ?? []).filter((stroke) => stroke.objectName === objectName)
    const ancestors = poseParentChain(objectName, poseParents)
    const rotActive =
      Math.abs(partPose.rot[0]) + Math.abs(partPose.rot[1]) + Math.abs(partPose.rot[2])
    const bendActive =
      Math.abs(partPose.bend[0]) + Math.abs(partPose.bend[1]) + Math.abs(partPose.bend[2])
    const posActive =
      Math.abs(partPose.pos[0]) + Math.abs(partPose.pos[1]) + Math.abs(partPose.pos[2])
    const ownActive =
      objectStrokes.length > 0
      || rotActive >= 0.05
      || bendActive >= 0.05
      || posActive >= 0.05
    const ancestorActive = ancestors.some((ancestor) =>
      partPoseChannelsActive(pose.parts[ancestor]),
    )
    if (!ownActive && !ancestorActive) continue

    const affected = new Set<number>(indices)
    for (const child of followersOf(objectName, followerMap)) {
      const childIdx = usedByObject.get(child)
      if (childIdx) for (const i of childIdx) affected.add(i)
    }

    const split = splits.get(objectName)
    const mid = boundsList.find((b) => b.name === objectName)?.center
      ?? centers.get(objectName)
      ?? [0, 0, 0] as [number, number, number]
    const joint = pose.pivots?.[objectName]
      ? [pose.pivots[objectName]![0], pose.pivots[objectName]![1], pose.pivots[objectName]![2]] as [number, number, number]
      : mid

    const indexed = [...affected].filter((i) => verts[i])
    if (indexed.length === 0) continue
    if (ownActive) {
      const rest = new Float32Array(indexed.length * 3)
      for (let k = 0; k < indexed.length; k += 1) {
        const v = verts[indexed[k]!]!
        rest[k * 3] = v[0]
        rest[k * 3 + 1] = v[1]
        rest[k * 3 + 2] = v[2]
      }
      const scratch = {
        setXYZ(i: number, x: number, y: number, z: number) {
          const idx = indexed[i]!
          verts[idx] = [x, y, z]
        },
      }
      morphPoseStrokeChain(
        rest,
        scratch,
        objectStrokes,
        {
          rot: [partPose.rot[0], partPose.rot[1], partPose.rot[2]],
          bend: [partPose.bend[0], partPose.bend[1], partPose.bend[2]],
          pos: [partPose.pos[0], partPose.pos[1], partPose.pos[2]],
          joint,
          clicked: pose.rigid ? false : Boolean(pose.pivots?.[objectName]),
          rigid: pose.rigid,
        },
        split?.center ?? mid,
        split,
      )
    }
    if (ancestorActive) {
      for (const ancestor of ancestors) {
        const ancestorPose = pose.parts[ancestor]
        if (!partPoseChannelsActive(ancestorPose)) continue
        const ancestorJoint = pose.pivots?.[ancestor]
          ?? centers.get(ancestor)
          ?? boundsList.find((b) => b.name === ancestor)?.center
          ?? ([0, 0, 0] as [number, number, number])
        for (const i of indexed) {
          const v = verts[i]
          if (!v) continue
          verts[i] = transformRotPos(v, ancestorJoint, ancestorPose!)
        }
      }
    }
  }

  const out: string[] = []
  let vi = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const v = verts[vi]
      const rgb = vertRgb[vi]
      vi += 1
      if (v && rgb) {
        out.push(`v ${v[0]} ${v[1]} ${v[2]} ${rgb[0]} ${rgb[1]} ${rgb[2]}`)
      } else if (v) {
        out.push(`v ${v[0]} ${v[1]} ${v[2]}`)
      } else {
        out.push(raw)
      }
    } else {
      out.push(raw)
    }
  }
  return new TextEncoder().encode(out.join('\n'))
}
