/**
 * Auto bone rig for Maya/OBJ/glTF meshes.
 *
 * Humanoid meshes get an anatomical template fitted to the AABB; anything else
 * gets a skeleton derived from its own shape. Either way the rig auto-weights
 * verts and CPU-skins them for preview and bake.
 *
 * Minecraft skins and Mine-imator models default to their classic joint pose
 * (`classic`); users can opt into this bone system via Skeleton settings.
 */

import { extractMeshSkeleton, solidTest } from './meshSkeleton'

/** How the rig for a part is chosen. */
export type MeshRigMode = 'classic' | 'native' | 'auto' | 'humanoid' | 'generic'

/** True when `mode` selects the mesh-bone system (not classic limb joints). */
export function isMeshBoneRigMode(mode: string | null | undefined): boolean {
  return mode === 'auto' || mode === 'humanoid' || mode === 'generic' || mode === 'native'
}

/**
 * Skins and Mine-imator parts keep classic posing unless the user picks a
 * skeleton mode (Auto / Body / Shape / Native).
 */
export function partUsesClassicPoseByDefault(part: {
  kind?: string
  mimodelBytes?: Uint8Array | null
  sourceLabel?: string | null
}): boolean {
  return (
    part.kind === 'skin'
    || Boolean(part.mimodelBytes && part.mimodelBytes.length > 0)
    || Boolean(part.sourceLabel?.startsWith('Minecraft'))
  )
}

/**
 * Bone ids are free-form: a humanoid mesh gets the anatomical names below, and
 * anything else gets ids generated from its own shape.
 */
export type MeshBoneId = string

export type HumanoidBoneId =
  | 'root'
  | 'body'
  | 'chest'
  | 'neck'
  | 'head'
  | 'left_shoulder'
  | 'left_arm'
  | 'left_forearm'
  | 'left_hand'
  | 'right_shoulder'
  | 'right_arm'
  | 'right_forearm'
  | 'right_hand'
  | 'left_leg'
  | 'left_shin'
  | 'left_foot'
  | 'right_leg'
  | 'right_shin'
  | 'right_foot'

/** Bones that own an elbow/knee Bend channel (forearm/shin map here via meshBoneBendTargetId). */
export const MESH_BONE_BEND_IDS: ReadonlySet<string> = new Set([
  'left_arm',
  'right_arm',
  'left_leg',
  'right_leg',
])

export const MESH_BONE_LIMBS: ReadonlyArray<{ id: HumanoidBoneId; label: string }> = [
  { id: 'root', label: 'Root' },
  { id: 'body', label: 'Hips' },
  { id: 'chest', label: 'Chest' },
  { id: 'neck', label: 'Neck' },
  { id: 'head', label: 'Head' },
  { id: 'left_shoulder', label: 'Left shoulder' },
  { id: 'left_arm', label: 'Left upper arm' },
  { id: 'left_forearm', label: 'Left forearm' },
  { id: 'left_hand', label: 'Left hand' },
  { id: 'right_shoulder', label: 'Right shoulder' },
  { id: 'right_arm', label: 'Right upper arm' },
  { id: 'right_forearm', label: 'Right forearm' },
  { id: 'right_hand', label: 'Right hand' },
  { id: 'left_leg', label: 'Left thigh' },
  { id: 'left_shin', label: 'Left shin' },
  { id: 'left_foot', label: 'Left foot' },
  { id: 'right_leg', label: 'Right thigh' },
  { id: 'right_shin', label: 'Right shin' },
  { id: 'right_foot', label: 'Right foot' },
]

/**
 * Bend gizmo target: upper arm/leg bend helper, or the bone itself for
 * forearm/shin. Only the anatomical template has mid-bone bends — a rig derived
 * from geometry puts a real joint wherever the shape actually bends.
 */
export function meshBoneBendTargetId(
  id: string,
  rig?: MeshBoneRig | null,
): string {
  if (rig && rig.kind !== 'humanoid') return id
  if (id === 'left_arm' || id === 'left_forearm') return 'left_arm'
  if (id === 'right_arm' || id === 'right_forearm') return 'right_arm'
  if (id === 'left_leg' || id === 'left_shin') return 'left_leg'
  if (id === 'right_leg' || id === 'right_shin') return 'right_leg'
  return id
}

export type MeshBonePartPose = {
  pos: [number, number, number]
  rot: [number, number, number]
  bend: [number, number, number]
}

export type MeshBonePose = {
  root: MeshBonePartPose
  parts: Record<string, MeshBonePartPose>
}

export type MeshBoneDef = {
  id: MeshBoneId
  /** Parent bone id, or null for root. */
  parent: MeshBoneId | null
  /** Name shown in the pose UI. */
  label: string
  /** Joint origin in mesh space (bind). */
  head: [number, number, number]
  /** Bone tip in mesh space (bind). */
  tip: [number, number, number]
  /** True if this bone has a mid bend (elbow/knee). */
  hasBend: boolean
  /** Bend joint along the bone (0–1 from head→tip). */
  bendT: number
  /** Half-thickness of the mesh around this bone, when the fitter measured it. */
  radius?: number
}

/**
 * `humanoid` rigs come from the anatomical template and carry its named joints;
 * `generic` rigs are derived from the model's own shape.
 */
export type MeshRigKind = 'native' | 'humanoid' | 'generic'

export type MeshBoneRig = {
  kind: MeshRigKind
  bones: MeshBoneDef[]
  /** Index of bone id in `bones`. */
  indexOf: Record<string, number>
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
    center: [number, number, number]
    size: [number, number, number]
  }
}

/** Per-vertex skin: up to 4 influences. */
export type MeshBoneWeights = {
  /** Flat: boneIndex0, boneIndex1, … (4 per vert); -1 = unused. */
  indices: Int16Array
  /** Flat weights, 4 per vert, sum ≈ 1. */
  weights: Float32Array
  vertexCount: number
}

const DEG = Math.PI / 180
/** Blend width around a joint, as a fraction of the shorter bone. */
const JOINT_BLEND_BAND = 0.35
/** Floor for that blend width, as a fraction of the model's thinnest axis. */
const JOINT_BLEND_GIRTH = 0.7
/** Below this, a second influence only adds wobble — drop it. */
const MIN_BLEND_WEIGHT = 0.05
/** Half-width of the elbow/knee transition, as a fraction of the bone. */
const BEND_BLEND_BAND = 0.08
/** Share of a limb region averaged into its tip sample. */
const EXTREMITY_FRACTION = 0.15
/**
 * How much linear blend skinning to mix back into the dual quaternion result.
 * Pure DQS bulges on tight elbow/knee bends; a little LBS takes the edge off
 * without bringing back the collapse it exists to prevent.
 */
const LINEAR_SKIN_MIX = 0.25
const EMPTY: MeshBonePartPose = {
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  bend: [0, 0, 0],
}

/** True for plain Maya/OBJ/glTF mesh parts — never skins or mimodel characters. */
export function partUsesMeshBones(part: {
  kind: string
  mimodelBytes?: Uint8Array | null
  bytes?: Uint8Array | null
  meshRigMode?: string | null
  sourceLabel?: string | null
}): boolean {
  if (part.kind === 'skin') {
    return isMeshBoneRigMode(part.meshRigMode)
  }
  if (part.kind !== 'obj') return false
  if (part.mimodelBytes && part.mimodelBytes.length > 0) {
    return isMeshBoneRigMode(part.meshRigMode)
  }
  if (isMeshBoneRigMode(part.meshRigMode)) return true
  // Catalog cubes keep vanilla rest pose unless the user turns a skeleton on.
  if (part.sourceLabel?.startsWith('Minecraft')) return false
  return (part.bytes?.length ?? 0) >= 64
}

export function meshBoneSupportsBend(id: string, rig?: MeshBoneRig | null): boolean {
  if (rig && rig.kind !== 'humanoid') {
    const index = rig.indexOf[id]
    return index != null && (rig.bones[index]?.hasBend ?? false)
  }
  return MESH_BONE_BEND_IDS.has(meshBoneBendTargetId(id, rig))
}

/**
 * Elbows and knees are hinges. Free XYZ bend twists a limb around its own length
 * (candy-wrapper stretch), so pick the world axis most perpendicular to the bone
 * and rotate only about that. X wins ties so limbs swing forward/back.
 */
export function meshBoneHingeAxisIndex(bone: MeshBoneDef): 0 | 1 | 2 {
  const len = boneLength(bone) || 1
  const dir: [number, number, number] = [
    (bone.tip[0] - bone.head[0]) / len,
    (bone.tip[1] - bone.head[1]) / len,
    (bone.tip[2] - bone.head[2]) / len,
  ]
  const perp: [number, number, number] = [
    1 - Math.abs(dir[0]),
    1 - Math.abs(dir[1]),
    1 - Math.abs(dir[2]),
  ]
  if (perp[0] >= 0.5) return 0
  return perp[1] >= perp[2] ? 1 : 2
}

/** Hinge axis for the bone that owns `id`'s bend channel, or null when it has none. */
export function meshBoneHingeAxisFor(
  rig: MeshBoneRig | null | undefined,
  id: string,
): 0 | 1 | 2 | null {
  if (!rig || !meshBoneSupportsBend(id, rig)) return null
  const target = meshBoneBendTargetId(id, rig)
  const index = rig.indexOf[target]
  const bone = index == null ? undefined : rig.bones[index]
  if (!bone) return null
  return meshBoneHingeAxisIndex(bone)
}

/** Drop every bend component that isn't the hinge. */
export function clampBendToHinge(
  bone: MeshBoneDef,
  bend: readonly [number, number, number],
): [number, number, number] {
  const axis = meshBoneHingeAxisIndex(bone)
  const out: [number, number, number] = [0, 0, 0]
  out[axis] = bend[axis] ?? 0
  return out
}

/** Same clamp, addressed by bone id — used by the preview when reading the gizmo. */
export function clampMeshBoneBend(
  rig: MeshBoneRig,
  id: string,
  bend: readonly [number, number, number],
): [number, number, number] {
  const target = meshBoneBendTargetId(id, rig)
  const index = rig.indexOf[target]
  const bone = index == null ? undefined : rig.bones[index]
  if (!bone) return [bend[0] ?? 0, bend[1] ?? 0, bend[2] ?? 0]
  return clampBendToHinge(bone, bend)
}

export function emptyMeshBonePartPose(): MeshBonePartPose {
  return {
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    bend: [0, 0, 0],
  }
}

/** Pose copy with root channels cleared — used by the bone overlay hierarchy. */
export function meshBonePoseWithoutRoot(pose: MeshBonePose): MeshBonePose {
  return {
    root: emptyMeshBonePartPose(),
    parts: pose.parts,
  }
}

/**
 * If a native skeleton sits far from the baked mesh (common when Maya verts were
 * re-parented into a different world matrix than the bind joints), translate the
 * whole rig so bone heads share the mesh's space. Rotation/scale mismatches are
 * left alone — those need a different importer path.
 */
export function alignMeshBoneRigToPositions(
  rig: MeshBoneRig,
  positions: ArrayLike<number> | Array<readonly [number, number, number]>,
): MeshBoneRig {
  const meshBounds =
    Array.isArray(positions) && positions.length > 0 && Array.isArray((positions as unknown[])[0])
      ? (() => {
          const list = positions as Array<readonly [number, number, number]>
          const flat = new Float32Array(list.length * 3)
          for (let i = 0; i < list.length; i += 1) {
            const p = list[i]!
            flat[i * 3] = p[0]
            flat[i * 3 + 1] = p[1]
            flat[i * 3 + 2] = p[2]
          }
          return boundsOf(flat)
        })()
      : boundsOf(positions as ArrayLike<number>)
  if (!meshBounds || rig.bones.length === 0) return rig

  let bx = 0
  let by = 0
  let bz = 0
  for (const bone of rig.bones) {
    bx += bone.head[0]
    by += bone.head[1]
    bz += bone.head[2]
  }
  const n = rig.bones.length
  bx /= n
  by /= n
  bz /= n

  const dx = meshBounds.center[0] - bx
  const dy = meshBounds.center[1] - by
  const dz = meshBounds.center[2] - bz
  const dist = Math.hypot(dx, dy, dz)
  const meshDiag =
    Math.hypot(meshBounds.size[0], meshBounds.size[1], meshBounds.size[2]) || 1
  // Only snap when the skeleton is clearly in a different place than the mesh.
  if (dist < meshDiag * 0.12) return rig

  const bones = rig.bones.map((bone) => ({
    ...bone,
    head: [bone.head[0] + dx, bone.head[1] + dy, bone.head[2] + dz] as [
      number,
      number,
      number,
    ],
    tip: [bone.tip[0] + dx, bone.tip[1] + dy, bone.tip[2] + dz] as [
      number,
      number,
      number,
    ],
  }))
  return {
    ...rig,
    bones,
    bounds: meshBounds,
  }
}

/** Rest pose for a rig's own joints, or the humanoid set when no rig is given. */
export function createRestMeshBonePose(rig?: MeshBoneRig | null): MeshBonePose {
  const parts: Record<string, MeshBonePartPose> = {}
  const ids = rig ? rig.bones.map((bone) => bone.id) : MESH_BONE_LIMBS.map((e) => e.id)
  for (const id of ids) {
    if (id === 'root') continue
    parts[id] = emptyMeshBonePartPose()
  }
  return { root: emptyMeshBonePartPose(), parts }
}

export function ensureMeshBonePose(
  existing?: MeshBonePose | null,
  rig?: MeshBoneRig | null,
): MeshBonePose {
  const rest = createRestMeshBonePose(rig)
  if (!existing) return rest
  const copyPart = (p: MeshBonePartPose | undefined): MeshBonePartPose => ({
    pos: [p?.pos[0] ?? 0, p?.pos[1] ?? 0, p?.pos[2] ?? 0],
    rot: [p?.rot[0] ?? 0, p?.rot[1] ?? 0, p?.rot[2] ?? 0],
    bend: [p?.bend[0] ?? 0, p?.bend[1] ?? 0, p?.bend[2] ?? 0],
  })
  // Keep whatever the saved pose already had: a part may have been posed under a
  // different rig mode, and dropping those keys would silently lose the work.
  const ids = new Set([...Object.keys(rest.parts), ...Object.keys(existing.parts)])
  return {
    root: copyPart(existing.root),
    parts: Object.fromEntries([...ids].map((id) => [id, copyPart(existing.parts[id])])),
  }
}

/**
 * Bind-pose diagonal, in whatever units the file was authored in. A COLLADA
 * character arrives a couple of units tall while a Blockbench export is dozens,
 * so anything that quantises or thresholds an offset has to measure against this
 * instead of a constant.
 */
export function meshBoneRigScale(rig: MeshBoneRig | null | undefined): number {
  if (!rig) return 0
  const diag = Math.hypot(rig.bounds.size[0], rig.bounds.size[1], rig.bounds.size[2])
  return Number.isFinite(diag) && diag > 1e-6 ? diag : 0
}

/** Step an Offset edit snaps to: about 1/400 of the model, on a 1/2/5 tick. */
export function meshBoneOffsetStep(rig: MeshBoneRig | null | undefined): number {
  const scale = meshBoneRigScale(rig)
  if (!scale) return 0.1
  const raw = scale / 400
  const pow = 10 ** Math.floor(Math.log10(raw))
  const mult = raw / pow
  return (mult >= 5 ? 5 : mult >= 2 ? 2 : 1) * pow
}

/** Decimals worth showing for an offset at this rig's step. */
export function meshBoneOffsetDecimals(rig: MeshBoneRig | null | undefined): number {
  const step = meshBoneOffsetStep(rig)
  return Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))))
}

/** Travel an Offset slider allows each way — three quarters of the model. */
export function meshBoneOffsetRange(rig: MeshBoneRig | null | undefined): number {
  const scale = meshBoneRigScale(rig)
  if (!scale) return 64
  const step = meshBoneOffsetStep(rig)
  return Math.max(step * 20, Math.round((scale * 0.75) / step) * step)
}

/** Snap an offset read back off the gizmo to this rig's step. */
export function roundMeshBoneOffset(
  value: number,
  rig: MeshBoneRig | null | undefined,
): number {
  const step = meshBoneOffsetStep(rig)
  const snapped = Math.round(value / step) * step
  return Number(snapped.toFixed(meshBoneOffsetDecimals(rig)))
}

export function meshBonePoseIsActive(
  pose: MeshBonePose | null | undefined,
  rig?: MeshBoneRig | null,
): boolean {
  if (!pose) return false
  // Degrees and model units aren't comparable. A twentieth of a degree is noise on
  // any rig, but "half a unit" is a whole limb on a metre-scale COLLADA character.
  const posEps = (meshBoneRigScale(rig) || 1) * 1e-4
  const moved = (p: MeshBonePartPose) =>
    Math.abs(p.rot[0]) + Math.abs(p.rot[1]) + Math.abs(p.rot[2])
      + Math.abs(p.bend[0]) + Math.abs(p.bend[1]) + Math.abs(p.bend[2]) > 0.05
    || Math.abs(p.pos[0]) + Math.abs(p.pos[1]) + Math.abs(p.pos[2]) > posEps
  if (moved(pose.root)) return true
  return Object.values(pose.parts).some(moved)
}

/**
 * True when a saved pose moves joints that only the anatomical rig has. Switching
 * such a part to a shape-derived rig would quietly drop the posing work, so the
 * auto choice defers to whatever the pose was authored against.
 */
export function meshBonePoseUsesHumanoidJoints(
  pose: MeshBonePose | null | undefined,
): boolean {
  if (!pose) return false
  const humanoidIds = new Set<string>(MESH_BONE_LIMBS.map((entry) => entry.id))
  for (const [id, part] of Object.entries(pose.parts)) {
    if (!humanoidIds.has(id) || id === 'root') continue
    const moved =
      Math.abs(part.rot[0]) + Math.abs(part.rot[1]) + Math.abs(part.rot[2])
      + Math.abs(part.bend[0]) + Math.abs(part.bend[1]) + Math.abs(part.bend[2])
      + Math.abs(part.pos[0]) + Math.abs(part.pos[1]) + Math.abs(part.pos[2])
    if (moved > 0.05) return true
  }
  return false
}

export function meshBoneGroupName(id: string): string {
  return `mesh-bone:${id}`
}

export function meshBoneBendGroupName(id: string): string {
  return `mesh-bone-bend:${id}`
}

/** Fit a humanoid skeleton to mesh AABB (Y-up), refined with extremity samples. */
export function fitHumanoidBones(
  positions: ArrayLike<number>,
): MeshBoneRig | null {
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

  const sizeX = Math.max(maxX - minX, 1e-4)
  const sizeY = Math.max(maxY - minY, 1e-4)
  const sizeZ = Math.max(maxZ - minZ, 1e-4)
  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5
  const cz = (minZ + maxZ) * 0.5

  // Proportions relative to height — kept inward so bones sit inside the mesh.
  const hipY = minY + sizeY * 0.5
  const shoulderY = minY + sizeY * 0.7
  const neckY = minY + sizeY * 0.76
  const headTipY = minY + sizeY * 0.96
  const footY = minY + sizeY * 0.04
  const handY = minY + sizeY * 0.42

  const avg = (
    pred: (x: number, y: number, z: number) => boolean,
  ): [number, number, number] | null => {
    let sx = 0
    let sy = 0
    let sz = 0
    let n = 0
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i]!
      const y = positions[i + 1]!
      const z = positions[i + 2]!
      if (!pred(x, y, z)) continue
      sx += x
      sy += y
      sz += z
      n += 1
    }
    if (n < 4) return null
    return [sx / n, sy / n, sz / n]
  }

  // Extremities are the far end of a region, not its middle — averaging the whole
  // arm puts the hand bone halfway up the forearm and leaves the real hand
  // unbound, which is what makes posed limbs stretch.
  const extremeAvg = (
    pred: (x: number, y: number, z: number) => boolean,
    axis: 0 | 1 | 2,
    sign: 1 | -1,
  ): [number, number, number] | null => {
    let lo = Infinity
    let hi = -Infinity
    let n = 0
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i]!
      const y = positions[i + 1]!
      const z = positions[i + 2]!
      if (!pred(x, y, z)) continue
      const c = axis === 0 ? x : axis === 1 ? y : z
      if (c < lo) lo = c
      if (c > hi) hi = c
      n += 1
    }
    if (n < 4) return null

    // Average the slab at the far end so ties can't skew the sample sideways.
    const extreme = sign > 0 ? hi : lo
    const band = Math.max((hi - lo) * EXTREMITY_FRACTION, 1e-6)
    let sx = 0
    let sy = 0
    let sz = 0
    let taken = 0
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i]!
      const y = positions[i + 1]!
      const z = positions[i + 2]!
      if (!pred(x, y, z)) continue
      const c = axis === 0 ? x : axis === 1 ? y : z
      if (Math.abs(c - extreme) > band) continue
      sx += x
      sy += y
      sz += z
      taken += 1
    }
    if (taken === 0) return null
    return [sx / taken, sy / taken, sz / taken]
  }

  // Sample limb tips from the mesh so bones track the real silhouette.
  const leftHand =
    extremeAvg(
      (x, y) =>
        x > cx + sizeX * 0.22
        && y > minY + sizeY * 0.25
        && y < minY + sizeY * 0.88,
      0,
      1,
    ) ?? [cx + sizeX * 0.38, handY, cz]
  const rightHand =
    extremeAvg(
      (x, y) =>
        x < cx - sizeX * 0.22
        && y > minY + sizeY * 0.25
        && y < minY + sizeY * 0.88,
      0,
      -1,
    ) ?? [cx - sizeX * 0.38, handY, cz]
  const leftFoot =
    extremeAvg(
      (x, y) =>
        x > cx + sizeX * 0.02
        && y < minY + sizeY * 0.28,
      1,
      -1,
    ) ?? [cx + sizeX * 0.1, footY, cz]
  const rightFoot =
    extremeAvg(
      (x, y) =>
        x < cx - sizeX * 0.02
        && y < minY + sizeY * 0.28,
      1,
      -1,
    ) ?? [cx - sizeX * 0.1, footY, cz]
  const headSample =
    extremeAvg(
      (x, y) => y > minY + sizeY * 0.8 && Math.abs(x - cx) < sizeX * 0.25,
      1,
      1,
    ) ?? [cx, headTipY, cz]
  // Core torso — ignore outer limb thirds so a sticking-out arm doesn't shift the spine.
  const torsoSample =
    avg(
      (x, y) =>
        x > minX + sizeX * 0.22
        && x < maxX - sizeX * 0.22
        && y > minY + sizeY * 0.38
        && y < minY + sizeY * 0.72,
    )
    ?? avg(
      (x, y) =>
        Math.abs(x - cx) < sizeX * 0.2
        && y > minY + sizeY * 0.4
        && y < minY + sizeY * 0.7,
    )
    ?? [cx, cy, cz]

  const shoulderInset = sizeX * 0.16
  const leftShoulder: [number, number, number] = [
    cx + shoulderInset,
    shoulderY,
    torsoSample[2],
  ]
  const rightShoulder: [number, number, number] = [
    cx - shoulderInset,
    shoulderY,
    torsoSample[2],
  ]
  const leftHip: [number, number, number] = [
    cx + sizeX * 0.08,
    hipY,
    torsoSample[2],
  ]
  const rightHip: [number, number, number] = [
    cx - sizeX * 0.08,
    hipY,
    torsoSample[2],
  ]

  const midChestY = minY + sizeY * 0.62
  const clavicleY = shoulderY
  const leftClavicle: [number, number, number] = [
    torsoSample[0] + sizeX * 0.05,
    clavicleY,
    torsoSample[2],
  ]
  const rightClavicle: [number, number, number] = [
    torsoSample[0] - sizeX * 0.05,
    clavicleY,
    torsoSample[2],
  ]
  const neckBase: [number, number, number] = [
    headSample[0],
    neckY,
    headSample[2],
  ]
  const leftElbow = lerp3(leftShoulder, leftHand, 0.48)
  const rightElbow = lerp3(rightShoulder, rightHand, 0.48)
  const leftWrist = lerp3(leftElbow, leftHand, 0.85)
  const rightWrist = lerp3(rightElbow, rightHand, 0.85)
  const leftKnee = lerp3(leftHip, leftFoot, 0.5)
  const rightKnee = lerp3(rightHip, rightFoot, 0.5)
  const leftAnkle = lerp3(leftKnee, leftFoot, 0.85)
  const rightAnkle = lerp3(rightKnee, rightFoot, 0.85)

  const shape: Array<Omit<MeshBoneDef, 'label'>> = [
    {
      id: 'root',
      parent: null,
      head: [torsoSample[0], minY, torsoSample[2]],
      tip: [torsoSample[0], hipY, torsoSample[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'body',
      parent: 'root',
      head: [torsoSample[0], hipY, torsoSample[2]],
      tip: [torsoSample[0], midChestY, torsoSample[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'chest',
      parent: 'body',
      head: [torsoSample[0], midChestY, torsoSample[2]],
      tip: [torsoSample[0], shoulderY, torsoSample[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'neck',
      parent: 'chest',
      head: [torsoSample[0], shoulderY, torsoSample[2]],
      tip: neckBase,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'head',
      parent: 'neck',
      head: neckBase,
      tip: [headSample[0], headSample[1], headSample[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'left_shoulder',
      parent: 'chest',
      head: leftClavicle,
      tip: leftShoulder,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'left_arm',
      parent: 'left_shoulder',
      head: leftShoulder,
      tip: leftElbow,
      hasBend: true,
      bendT: 1,
    },
    {
      id: 'left_forearm',
      parent: 'left_arm',
      head: leftElbow,
      tip: leftWrist,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'left_hand',
      parent: 'left_forearm',
      head: leftWrist,
      tip: [leftHand[0], leftHand[1], leftHand[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'right_shoulder',
      parent: 'chest',
      head: rightClavicle,
      tip: rightShoulder,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'right_arm',
      parent: 'right_shoulder',
      head: rightShoulder,
      tip: rightElbow,
      hasBend: true,
      bendT: 1,
    },
    {
      id: 'right_forearm',
      parent: 'right_arm',
      head: rightElbow,
      tip: rightWrist,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'right_hand',
      parent: 'right_forearm',
      head: rightWrist,
      tip: [rightHand[0], rightHand[1], rightHand[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'left_leg',
      parent: 'body',
      head: leftHip,
      tip: leftKnee,
      hasBend: true,
      bendT: 1,
    },
    {
      id: 'left_shin',
      parent: 'left_leg',
      head: leftKnee,
      tip: leftAnkle,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'left_foot',
      parent: 'left_shin',
      head: leftAnkle,
      tip: [leftFoot[0], leftFoot[1], leftFoot[2]],
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'right_leg',
      parent: 'body',
      head: rightHip,
      tip: rightKnee,
      hasBend: true,
      bendT: 1,
    },
    {
      id: 'right_shin',
      parent: 'right_leg',
      head: rightKnee,
      tip: rightAnkle,
      hasBend: false,
      bendT: 0.5,
    },
    {
      id: 'right_foot',
      parent: 'right_shin',
      head: rightAnkle,
      tip: [rightFoot[0], rightFoot[1], rightFoot[2]],
      hasBend: false,
      bendT: 0.5,
    },
  ]

  const labels = new Map<string, string>(
    MESH_BONE_LIMBS.map((entry) => [entry.id, entry.label]),
  )
  const bones: MeshBoneDef[] = shape.map((bone) => ({
    ...bone,
    label: labels.get(bone.id) ?? bone.id,
  }))

  const indexOf: Record<string, number> = {}
  bones.forEach((b, i) => {
    indexOf[b.id] = i
  })

  return {
    kind: 'humanoid',
    bones,
    indexOf,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center: [cx, cy, cz],
      size: [sizeX, sizeY, sizeZ],
    },
  }
}

/** Compass word for a branch heading, used to name bones we know nothing about. */
function headingWord(dir: readonly [number, number, number]): string {
  const ax = Math.abs(dir[0])
  const ay = Math.abs(dir[1])
  const az = Math.abs(dir[2])
  if (ay >= ax && ay >= az) return dir[1] >= 0 ? 'Upper' : 'Lower'
  if (ax >= az) return dir[0] >= 0 ? 'Left' : 'Right'
  return dir[2] >= 0 ? 'Front' : 'Back'
}

/**
 * Build a rig from the model's own shape. Each skeleton branch becomes a chain
 * of bones, so a chair gets legs and a back, a dragon gets a neck and a tail,
 * and nothing is assumed about anatomy.
 */
export function fitGenericBones(positions: ArrayLike<number>): MeshBoneRig | null {
  const rest =
    positions instanceof Float32Array
      ? positions
      : Float32Array.from(positions as ArrayLike<number>)
  const bounds = boundsOf(rest)
  if (!bounds) return null
  const skeleton = extractMeshSkeleton(rest)

  const shape: Array<Omit<MeshBoneDef, 'label'>> = []
  const labels: string[] = []
  const { center, size } = bounds
  const diagonal = Math.hypot(size[0], size[1], size[2])

  if (!skeleton) {
    // No limbs worth speaking of — a crate, a rock. One bone still lets the
    // whole part be rotated and moved as a unit.
    shape.push({
      id: 'root',
      parent: null,
      head: [center[0], bounds.min[1], center[2]],
      tip: [center[0], bounds.max[1], center[2]],
      hasBend: false,
      bendT: 0.5,
      radius: Math.min(size[0], size[2]) * 0.5,
    })
    labels.push('Whole model')
  } else {
    shape.push({
      id: 'root',
      parent: null,
      head: skeleton.root,
      tip: [skeleton.root[0], skeleton.root[1] + diagonal * 0.02, skeleton.root[2]],
      hasBend: false,
      bendT: 0.5,
      radius: skeleton.branches[0]?.radii[0] ?? diagonal * 0.05,
    })
    labels.push('Base')

    // A branch's last bone id is what its child branches hang from.
    const tailOf = new Map<number, string>()
    const usedNames = new Map<string, number>()
    skeleton.branches.forEach((branch, b) => {
      const first = branch.points[0]!
      const last = branch.points[branch.points.length - 1]!
      const len = Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]) || 1
      const word = headingWord([
        (last[0] - first[0]) / len,
        (last[1] - first[1]) / len,
        (last[2] - first[2]) / len,
      ])
      const seen = (usedNames.get(word) ?? 0) + 1
      usedNames.set(word, seen)
      const name = seen === 1 ? `${word} limb` : `${word} limb ${seen}`

      const segments = branch.points.length - 1
      let parentId = branch.parent == null ? 'root' : tailOf.get(branch.parent) ?? 'root'
      for (let s = 0; s < segments; s += 1) {
        const id = `b${b}s${s}`
        shape.push({
          id,
          parent: parentId,
          head: branch.points[s]!,
          tip: branch.points[s + 1]!,
          hasBend: false,
          bendT: 0.5,
          radius: branch.radii[s] ?? diagonal * 0.04,
        })
        labels.push(segments === 1 ? name : `${name} ${s + 1}`)
        parentId = id
      }
      tailOf.set(b, parentId)
    })
  }

  const bones: MeshBoneDef[] = shape.map((bone, i) => ({
    ...bone,
    label: labels[i] ?? bone.id,
  }))
  const indexOf: Record<string, number> = {}
  bones.forEach((b, i) => {
    indexOf[b.id] = i
  })
  return { kind: 'generic', bones, indexOf, bounds }
}

function boundsOf(positions: ArrayLike<number>): MeshBoneRig['bounds'] | null {
  if (positions.length < 9) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxY = Math.max(maxY, positions[i + 1]!)
    minZ = Math.min(minZ, positions[i + 2]!)
    maxZ = Math.max(maxZ, positions[i + 2]!)
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [
      Math.max(maxX - minX, 1e-4),
      Math.max(maxY - minY, 1e-4),
      Math.max(maxZ - minZ, 1e-4),
    ],
  }
}

/**
 * Does the anatomical template actually land inside this mesh? Sampling along
 * every fitted bone catches the cases the proportions were never meant for — a
 * chair's "arms" end up in thin air, a sword has no legs to speak of.
 */
export function meshLooksHumanoid(positions: ArrayLike<number>): boolean {
  const rest =
    positions instanceof Float32Array
      ? positions
      : Float32Array.from(positions as ArrayLike<number>)
  const bounds = boundsOf(rest)
  if (!bounds) return false
  // A person is clearly taller than they are wide or deep.
  if (bounds.size[1] < Math.max(bounds.size[0], bounds.size[2]) * 1.25) return false

  const rig = fitHumanoidBones(rest)
  const inside = solidTest(rest)
  if (!rig || !inside) return false

  let hits = 0
  let total = 0
  for (const bone of rig.bones) {
    if (bone.id === 'root') continue
    for (let s = 1; s <= 6; s += 1) {
      const t = s / 7
      total += 1
      if (
        inside([
          bone.head[0] + (bone.tip[0] - bone.head[0]) * t,
          bone.head[1] + (bone.tip[1] - bone.head[1]) * t,
          bone.head[2] + (bone.tip[2] - bone.head[2]) * t,
        ])
      ) {
        hits += 1
      }
    }
  }
  return total > 0 && hits / total >= 0.8
}

/** Pick the rig that suits the mesh, honouring an explicit override. */
export function fitMeshBones(
  positions: ArrayLike<number>,
  mode: MeshRigMode = 'auto',
): MeshBoneRig | null {
  // Native / classic cannot be reconstructed from flattened OBJ positions.
  if (mode === 'native' || mode === 'classic') return null
  if (mode === 'humanoid') return fitHumanoidBones(positions)
  if (mode === 'generic') return fitGenericBones(positions)
  return meshLooksHumanoid(positions)
    ? fitHumanoidBones(positions)
    : fitGenericBones(positions)
}

/**
 * Fixed humanoid rig in player-skin preview space (Y-up skin pixels × scale).
 * Used when a PNG skin opts into the bone/rig system.
 */
export function playerSkinHumanoidRig(
  slimArms = false,
  scale = 0.1,
): MeshBoneRig {
  const s = (n: number) => n * scale
  const armW = slimArms ? 3 : 4
  const leftShoulderX = 4 + armW / 2
  const rightShoulderX = -(4 + armW / 2)
  const p = (
    id: HumanoidBoneId,
    parent: string | null,
    head: [number, number, number],
    tip: [number, number, number],
    hasBend = false,
  ): MeshBoneDef => ({
    id,
    label: MESH_BONE_LIMBS.find((entry) => entry.id === id)?.label ?? id,
    parent,
    head: [s(head[0]), s(head[1]), s(head[2])],
    tip: [s(tip[0]), s(tip[1]), s(tip[2])],
    hasBend,
    bendT: hasBend ? 1 : 0.5,
  })
  const bones: MeshBoneDef[] = [
    p('root', null, [0, 0, 0], [0, 12, 0]),
    p('body', 'root', [0, 12, 0], [0, 18, 0]),
    p('chest', 'body', [0, 18, 0], [0, 24, 0]),
    p('neck', 'chest', [0, 24, 0], [0, 26, 0]),
    p('head', 'neck', [0, 26, 0], [0, 32, 0]),
    p('left_shoulder', 'chest', [0, 24, 0], [leftShoulderX, 24, 0]),
    p('left_arm', 'left_shoulder', [leftShoulderX, 24, 0], [leftShoulderX, 18, 0], true),
    p('left_forearm', 'left_arm', [leftShoulderX, 18, 0], [leftShoulderX, 12, 0]),
    p('left_hand', 'left_forearm', [leftShoulderX, 12, 0], [leftShoulderX, 10, 0]),
    p('right_shoulder', 'chest', [0, 24, 0], [rightShoulderX, 24, 0]),
    p('right_arm', 'right_shoulder', [rightShoulderX, 24, 0], [rightShoulderX, 18, 0], true),
    p('right_forearm', 'right_arm', [rightShoulderX, 18, 0], [rightShoulderX, 12, 0]),
    p('right_hand', 'right_forearm', [rightShoulderX, 12, 0], [rightShoulderX, 10, 0]),
    p('left_leg', 'body', [2, 12, 0], [2, 6, 0], true),
    p('left_shin', 'left_leg', [2, 6, 0], [2, 0, 0]),
    p('left_foot', 'left_shin', [2, 0, 0], [2, -1, 0]),
    p('right_leg', 'body', [-2, 12, 0], [-2, 6, 0], true),
    p('right_shin', 'right_leg', [-2, 6, 0], [-2, 0, 0]),
    p('right_foot', 'right_shin', [-2, 0, 0], [-2, -1, 0]),
  ]
  const indexOf: Record<string, number> = {}
  for (let i = 0; i < bones.length; i += 1) indexOf[bones[i]!.id] = i
  return {
    kind: 'humanoid',
    bones,
    indexOf,
    bounds: {
      min: [s(-6), s(0), s(-4)],
      max: [s(6), s(32), s(4)],
      center: [s(0), s(16), s(0)],
      size: [s(12), s(32), s(8)],
    },
  }
}

function channelMag(part: {
  pos: readonly number[]
  rot: readonly number[]
  bend: readonly number[]
}): number {
  let sum = 0
  for (const n of part.pos) sum += Math.abs(n)
  for (const n of part.rot) sum += Math.abs(n)
  for (const n of part.bend) sum += Math.abs(n)
  return sum
}

/**
 * Fold a humanoid mesh-bone pose into the classic 7-limb skin pose used by
 * PNG skins (preview joints + Rust `apply_skin_pose`).
 */
export function meshBonePoseToSkinPose(pose: MeshBonePose): {
  root: { pos: [number, number, number]; rot: [number, number, number]; bend: [number, number, number]; scale: [number, number, number] }
  parts: Record<
    string,
    { pos: [number, number, number]; rot: [number, number, number]; bend: [number, number, number]; scale: [number, number, number] }
  >
} {
  const empty = emptyMeshBonePartPose()
  const get = (id: string) => pose.parts[id] ?? empty
  const asLimb = (
    primary: MeshBonePartPose,
    bendSource?: MeshBonePartPose,
  ): {
    pos: [number, number, number]
    rot: [number, number, number]
    bend: [number, number, number]
    scale: [number, number, number]
  } => {
    // Prefer the upper-arm / thigh bend channel (orange elbow/knee balls). Only
    // fall back to forearm/shin rotation when that bend is still at rest — the
    // old check keyed off bendSource.bend (always empty) and wiped real bends.
    const primaryBend = [...(primary.bend ?? [0, 0, 0])] as [number, number, number]
    const fromLower = bendSource
      ? ([...bendSource.rot] as [number, number, number])
      : primaryBend
    const bend =
      channelMag({ pos: [0, 0, 0], rot: [0, 0, 0], bend: primaryBend }) >= 0.05
        ? primaryBend
        : fromLower
    return {
      pos: [...primary.pos] as [number, number, number],
      rot: [...primary.rot] as [number, number, number],
      bend,
      scale: [1, 1, 1],
    }
  }
  const body = get('body')
  const chest = get('chest')
  const head = get('head')
  const neck = get('neck')
  // Fold torso extras into the classic body/head channels.
  const bodyRot: [number, number, number] = [
    body.rot[0] + chest.rot[0],
    body.rot[1] + chest.rot[1],
    body.rot[2] + chest.rot[2],
  ]
  const headRot: [number, number, number] = [
    head.rot[0] + neck.rot[0],
    head.rot[1] + neck.rot[1],
    head.rot[2] + neck.rot[2],
  ]
  return {
    root: {
      pos: [...pose.root.pos] as [number, number, number],
      rot: [...pose.root.rot] as [number, number, number],
      bend: [...pose.root.bend] as [number, number, number],
      scale: [1, 1, 1],
    },
    parts: {
      body: {
        pos: [...body.pos] as [number, number, number],
        rot: bodyRot,
        bend: [...body.bend] as [number, number, number],
        scale: [1, 1, 1],
      },
      head: {
        pos: [...head.pos] as [number, number, number],
        rot: headRot,
        bend: [...head.bend] as [number, number, number],
        scale: [1, 1, 1],
      },
      left_arm: asLimb(get('left_arm'), get('left_forearm')),
      right_arm: asLimb(get('right_arm'), get('right_forearm')),
      left_leg: asLimb(get('left_leg'), get('left_shin')),
      right_leg: asLimb(get('right_leg'), get('right_shin')),
    },
  }
}

function distToSegment(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const apz = p[2] - a[2]
  const abLen2 = abx * abx + aby * aby + abz * abz || 1e-8
  let t = (apx * abx + apy * aby + apz * abz) / abLen2
  t = Math.max(0, Math.min(1, t))
  const qx = a[0] + abx * t
  const qy = a[1] + aby * t
  const qz = a[2] + abz * t
  return Math.hypot(p[0] - qx, p[1] - qy, p[2] - qz)
}

function boneLength(bone: MeshBoneDef): number {
  return Math.hypot(
    bone.tip[0] - bone.head[0],
    bone.tip[1] - bone.head[1],
    bone.tip[2] - bone.head[2],
  )
}

/**
 * Joint shared by a parent/child pair, with the child's direction. Blending is
 * measured along that axis, not as a straight line to the joint: every surface
 * vertex sits a limb-radius off the bone, so a radial measure never reaches them.
 */
function sharedJoint(
  a: MeshBoneDef,
  b: MeshBoneDef,
): { point: [number, number, number]; axis: [number, number, number] } | null {
  const child = a.parent === b.id ? a : b.parent === a.id ? b : null
  if (!child) return null
  const len = boneLength(child)
  if (!(len > 1e-6)) return null
  return {
    point: child.head,
    axis: [
      (child.tip[0] - child.head[0]) / len,
      (child.tip[1] - child.head[1]) / len,
      (child.tip[2] - child.head[2]) / len,
    ],
  }
}

/** Closest bone ignoring region gates — last resort so no vert falls back to the hips. */
function nearestBoneIndex(p: [number, number, number], rig: MeshBoneRig): number {
  let bestIdx = -1
  let bestDist = Infinity
  for (let bi = 0; bi < rig.bones.length; bi += 1) {
    const bone = rig.bones[bi]!
    if (bone.id === 'root' && rig.bones.length > 1) continue
    const d = distToSegment(p, bone.head, bone.tip)
    if (d < bestDist) {
      bestDist = d
      bestIdx = bi
    }
  }
  return bestIdx
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/**
 * Region-aware auto weights: limbs own their side; torso stays on body.
 * Tight distance cutoffs so posing an arm doesn't drag the far torso/other limbs.
 */
export type MeshSkinMode = 'rigid' | 'stretch'

export function meshSkinModeOf(part: { meshSkinMode?: string | null }): MeshSkinMode {
  return part.meshSkinMode === 'stretch' ? 'stretch' : 'rigid'
}

/** Keep only the strongest influence so posing rotates cubes instead of stretching. */
export function hardenMeshBoneWeights(skin: MeshBoneWeights): MeshBoneWeights {
  const { vertexCount, indices, weights } = skin
  const nextIdx = new Int16Array(vertexCount * 4)
  const nextW = new Float32Array(vertexCount * 4)
  nextIdx.fill(-1)
  for (let v = 0; v < vertexCount; v += 1) {
    let best = 0
    let bestW = -1
    for (let i = 0; i < 4; i += 1) {
      const bone = indices[v * 4 + i]!
      const w = weights[v * 4 + i]!
      if (bone >= 0 && w > bestW) {
        bestW = w
        best = i
      }
    }
    const bone = indices[v * 4 + best]!
    nextIdx[v * 4] = bone
    nextW[v * 4] = bone >= 0 ? 1 : 0
  }
  return { indices: nextIdx, weights: nextW, vertexCount }
}

/** Minecraft cubes are one ModelPart: bind a whole small mesh to its majority bone. */
export function unifyRigidGeometryWeights(skin: MeshBoneWeights): MeshBoneWeights {
  const { vertexCount, indices } = skin
  if (vertexCount < 3 || vertexCount > 64) return skin
  const votes = new Map<number, number>()
  for (let v = 0; v < vertexCount; v += 1) {
    const bone = indices[v * 4]!
    if (bone < 0) continue
    votes.set(bone, (votes.get(bone) ?? 0) + 1)
  }
  let winner = -1
  let best = -1
  for (const [bone, count] of votes) {
    if (count > best) {
      best = count
      winner = bone
    }
  }
  if (winner < 0) return skin
  const nextIdx = new Int16Array(vertexCount * 4)
  const nextW = new Float32Array(vertexCount * 4)
  nextIdx.fill(-1)
  for (let v = 0; v < vertexCount; v += 1) {
    nextIdx[v * 4] = winner
    nextW[v * 4] = 1
  }
  return { indices: nextIdx, weights: nextW, vertexCount }
}

export function computeMeshBoneWeights(
  positions: ArrayLike<number>,
  rig: MeshBoneRig,
  deform: MeshSkinMode = 'rigid',
): MeshBoneWeights {
  const vertexCount = Math.floor(positions.length / 3)
  const indices = new Int16Array(vertexCount * 4)
  const weights = new Float32Array(vertexCount * 4)
  indices.fill(-1)

  const { center, size } = rig.bounds
  const thin = Math.min(size[0], size[1], size[2])
  // Anatomical rules only make sense for the anatomical template.
  const humanoid = rig.kind === 'humanoid'
  const bodyIdx = rig.indexOf.body ?? 0
  const chestIdx = rig.indexOf.chest ?? bodyIdx
  const headIdx = rig.indexOf.head ?? -1
  // A shape with no limbs rigs to a single root bone, which then has to be a
  // legal weight target even though posed rigs drive the root globally.
  const rootIsOnlyBone = rig.bones.length === 1

  type Candidate = { boneIndex: number; score: number }

  const isLeftArmChain = (id: string) =>
    id === 'left_shoulder'
    || id === 'left_arm'
    || id === 'left_forearm'
    || id === 'left_hand'
  const isRightArmChain = (id: string) =>
    id === 'right_shoulder'
    || id === 'right_arm'
    || id === 'right_forearm'
    || id === 'right_hand'
  const isLeftLegChain = (id: string) =>
    id === 'left_leg' || id === 'left_shin' || id === 'left_foot'
  const isRightLegChain = (id: string) =>
    id === 'right_leg' || id === 'right_shin' || id === 'right_foot'

  const maxDistFor = (bone: MeshBoneDef): number => {
    const len = Math.hypot(
      bone.tip[0] - bone.head[0],
      bone.tip[1] - bone.head[1],
      bone.tip[2] - bone.head[2],
    )
    if (!humanoid) {
      // The skeleton fitter measured how thick the model is around each bone,
      // which beats any guess derived from the bounding box.
      return Math.max(len * 0.55, (bone.radius ?? thin * 0.4) * 1.9)
    }
    // Limb radii key off limb girth (`thin`), never overall width — arm span
    // inflates size[0] and would let a fingertip bone claim half the forearm.
    if (bone.id === 'left_shoulder' || bone.id === 'right_shoulder') {
      return Math.max(len * 0.75, thin * 0.45)
    }
    if (isLeftArmChain(bone.id) || isRightArmChain(bone.id)) {
      return Math.max(len * 0.8, thin * 0.6)
    }
    if (isLeftLegChain(bone.id) || isRightLegChain(bone.id)) {
      return Math.max(len * 0.7, thin * 0.6)
    }
    if (bone.id === 'head' || bone.id === 'neck') {
      return Math.max(len * 0.7, thin * 0.7)
    }
    if (bone.id === 'chest') {
      return Math.max(size[0] * 0.22, size[2] * 0.35, thin * 0.4)
    }
    // Body / hips: wider so torso verts stay on torso instead of leaking to limbs.
    return Math.max(size[0] * 0.2, size[2] * 0.4, thin * 0.45)
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const p: [number, number, number] = [
      positions[v * 3]!,
      positions[v * 3 + 1]!,
      positions[v * 3 + 2]!,
    ]
    const cands: Candidate[] = []
    let nearestGated = -1
    let nearestGatedDist = Infinity

    for (let bi = 0; bi < rig.bones.length; bi += 1) {
      const bone = rig.bones[bi]!
      if (bone.id === 'root' && !rootIsOnlyBone) continue

      // Hard region gates — other side / wrong height never binds. A rig derived
      // from the model's own shape has no sides or heights to reason about, so
      // proximity alone decides.
      if (humanoid) {
        if (isLeftArmChain(bone.id) && p[0] < center[0] + size[0] * 0.04) continue
        if (isRightArmChain(bone.id) && p[0] > center[0] - size[0] * 0.04) continue
        if (isLeftLegChain(bone.id) && p[0] < center[0] - size[0] * 0.01) continue
        if (isRightLegChain(bone.id) && p[0] > center[0] + size[0] * 0.01) continue
        if (isLeftLegChain(bone.id) || isRightLegChain(bone.id)) {
          if (p[1] > center[1] + size[1] * 0.08) continue
          // Feet/shins shouldn't claim central torso base.
          if (
            (bone.id.endsWith('_foot') || bone.id.endsWith('_shin'))
            && Math.abs(p[0] - center[0]) < size[0] * 0.12
            && p[1] > center[1] - size[1] * 0.28
          ) {
            continue
          }
          // Crotch belongs to the hips — splitting it between thighs tears the pelvis.
          if (
            Math.abs(p[0] - center[0]) < size[0] * 0.05
            && p[1] > center[1] - size[1] * 0.06
          ) {
            continue
          }
        }
        if (isLeftArmChain(bone.id) || isRightArmChain(bone.id)) {
          if (p[1] < center[1] - size[1] * 0.12) continue
        }
        // Head/neck start at their own joint, not at a guessed share of the height.
        if (
          (bone.id === 'head' || bone.id === 'neck')
          && p[1] < bone.head[1] - size[1] * 0.03
        ) {
          continue
        }
        if (bone.id === 'chest') {
          if (p[1] < center[1] - size[1] * 0.02) continue
          if (Math.abs(p[0] - center[0]) > size[0] * 0.28) continue
        }
        // Body shouldn't claim clear limb tips.
        if (bone.id === 'body') {
          if (Math.abs(p[0] - center[0]) > size[0] * 0.3) continue
          if (
            p[1] < center[1] - size[1] * 0.18
            && Math.abs(p[0] - center[0]) > size[0] * 0.1
          ) {
            continue
          }
        }
      }

      const maxD = maxDistFor(bone)
      const d = distToSegment(p, bone.head, bone.tip)
      if (d < nearestGatedDist) {
        nearestGatedDist = d
        nearestGated = bi
      }
      if (d > maxD * 1.05) continue

      const t = Math.min(1, d / maxD)
      let score = Math.exp(-2.8 * t * t)

      if (humanoid) {
        if (bone.id === 'left_shoulder' || bone.id === 'right_shoulder') {
          // The clavicle keeps the collar only. Everything past the shoulder joint
          // is deltoid and has to swing with the upper arm, or the sleeve shears
          // off as a rigid slab when the arm rotates.
          const outward = Math.abs(p[0] - center[0])
          const jointOut = Math.abs(bone.tip[0] - center[0])
          score *= outward > jointOut ? 0.3 : 1.5
        }
        if (isLeftArmChain(bone.id) || isRightArmChain(bone.id)) {
          if (Math.abs(p[0] - center[0]) > size[0] * 0.22) score *= 3
          else if (!bone.id.endsWith('_shoulder')) score *= 0.6
          if (bone.id.endsWith('_hand')) score *= 1.35
          else if (bone.id.endsWith('_forearm')) score *= 1.15
        }
        if (isLeftLegChain(bone.id) || isRightLegChain(bone.id)) {
          if (p[1] < center[1] - size[1] * 0.05) score *= 2.5
          else score *= 0.3
          if (bone.id.endsWith('_foot')) score *= 1.35
          else if (bone.id.endsWith('_shin')) score *= 1.15
        }
        if (bone.id === 'body') score *= 0.55
        if (bone.id === 'chest') score *= 0.7
        if (bone.id === 'neck') score *= 1.2
        if (bone.id === 'head' && p[1] > center[1] + size[1] * 0.28) score *= 2.8
      }

      if (score > 0.015) cands.push({ boneIndex: bi, score })
    }

    if (cands.length === 0) {
      // Out of every radius: bind to the closest bone that survived the region
      // gates, never blanket-fallback to the hips.
      const fallback =
        nearestGated >= 0 ? nearestGated : nearestBoneIndex(p, rig)
      indices[v * 4] = fallback >= 0 ? fallback : bodyIdx
      weights[v * 4] = 1
      continue
    }

    cands.sort((a, b) => b.score - a.score)
    const best = cands[0]!
    const bestBone = rig.bones[best.boneIndex]!

    indices[v * 4] = best.boneIndex
    weights[v * 4] = 1

    // The primary bone owns the vertex outright. The only softening allowed is
    // across a real joint (parent/child) and only within a narrow band around it,
    // so a rotating limb can never drag the torso or the opposite side with it.
    let partner = -1
    let partnerShare = 0
    for (let ci = 1; ci < cands.length; ci += 1) {
      const cand = cands[ci]!
      const bone = rig.bones[cand.boneIndex]!
      const joint = sharedJoint(bestBone, bone)
      if (!joint) continue
      // Soft region scales with limb girth, not bone length — a short clavicle
      // still needs a shoulder-wide falloff or the joint creases.
      const band = Math.max(
        Math.min(boneLength(bestBone), boneLength(bone)) * JOINT_BLEND_BAND,
        thin * JOINT_BLEND_GIRTH,
      )
      if (!(band > 1e-6)) continue
      const jointDist = Math.abs(
        (p[0] - joint.point[0]) * joint.axis[0]
        + (p[1] - joint.point[1]) * joint.axis[1]
        + (p[2] - joint.point[2]) * joint.axis[2],
      )
      if (jointDist >= band) continue
      // Even split at the joint itself, easing to none at the edge of the band.
      const t = 1 - jointDist / band
      const share = 0.5 * t * t * (3 - 2 * t)
      if (share > partnerShare) {
        partnerShare = share
        partner = cand.boneIndex
      }
    }

    if (deform === 'rigid' || partner < 0 || partnerShare < MIN_BLEND_WEIGHT) {
      continue
    }

    weights[v * 4] = 1 - partnerShare
    indices[v * 4 + 1] = partner
    weights[v * 4 + 1] = partnerShare

    // Head crown stays on head.
    if (humanoid && p[1] > center[1] + size[1] * 0.34 && headIdx >= 0) {
      const headW = Math.min(1, (p[1] - (center[1] + size[1] * 0.28)) / (size[1] * 0.18))
      if (headW > 0.35) {
        indices[v * 4] = headIdx
        weights[v * 4] = headW
        indices[v * 4 + 1] = chestIdx
        weights[v * 4 + 1] = 1 - headW
        indices[v * 4 + 2] = -1
        weights[v * 4 + 2] = 0
        indices[v * 4 + 3] = -1
        weights[v * 4 + 3] = 0
      }
    }
  }

  return { indices, weights, vertexCount }
}

type Mat4 = number[] // column-major 4x4

function matIdentity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Column-major identity (for gizmo/root bind). */
export function meshBoneMatIdentity(): Mat4 {
  return matIdentity()
}

function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as number[]
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[0 * 4 + r]! * b[c * 4 + 0]!
        + a[1 * 4 + r]! * b[c * 4 + 1]!
        + a[2 * 4 + r]! * b[c * 4 + 2]!
        + a[3 * 4 + r]! * b[c * 4 + 3]!
    }
  }
  return out
}

function matTranslate(x: number, y: number, z: number): Mat4 {
  const m = matIdentity()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

/** XYZ Euler degrees → matrix (Three.js order: Rz * Ry * Rx). */
function matEulerXyzDeg(rx: number, ry: number, rz: number): Mat4 {
  const x = rx * DEG
  const y = ry * DEG
  const z = rz * DEG
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)
  // R = Rz * Ry * Rx
  return [
    cy * cz,
    cy * sz,
    -sy,
    0,
    sx * sy * cz - cx * sz,
    sx * sy * sz + cx * cz,
    sx * cy,
    0,
    cx * sy * cz + sx * sz,
    cx * sy * sz - sx * cz,
    cx * cy,
    0,
    0,
    0,
    0,
    1,
  ]
}

function matInvert(m: Mat4): Mat4 {
  // Affine inverse for TR matrices.
  const r00 = m[0]!
  const r01 = m[1]!
  const r02 = m[2]!
  const r10 = m[4]!
  const r11 = m[5]!
  const r12 = m[6]!
  const r20 = m[8]!
  const r21 = m[9]!
  const r22 = m[10]!
  const tx = m[12]!
  const ty = m[13]!
  const tz = m[14]!
  // transpose rotation
  const out = matIdentity()
  out[0] = r00
  out[1] = r10
  out[2] = r20
  out[4] = r01
  out[5] = r11
  out[6] = r21
  out[8] = r02
  out[9] = r12
  out[10] = r22
  out[12] = -(out[0]! * tx + out[4]! * ty + out[8]! * tz)
  out[13] = -(out[1]! * tx + out[5]! * ty + out[9]! * tz)
  out[14] = -(out[2]! * tx + out[6]! * ty + out[10]! * tz)
  return out
}

function matTransformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  const x = p[0]
  const y = p[1]
  const z = p[2]
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ]
}

/**
 * Build bind + posed world matrices for each bone (and bend joint as virtual).
 * Skinning uses the limb bone matrix; bend is composed into the distal transform
 * via a per-vertex blend between upper and lower limb matrices.
 */
export type MeshBoneMatrices = {
  /** World matrix per bone in bind pose. */
  bindWorld: Mat4[]
  /** World matrix per bone after pose. */
  poseWorld: Mat4[]
  /** World matrix at bend joint (posed), or null if no bend. */
  bendWorld: Array<Mat4 | null>
  /** Bind matrix at bend joint. */
  bendBind: Array<Mat4 | null>
}

function partPoseOf(pose: MeshBonePose, id: string): MeshBonePartPose {
  if (id === 'root') return pose.root ?? EMPTY
  return pose.parts[id] ?? EMPTY
}

export function computeMeshBoneMatrices(
  rig: MeshBoneRig,
  pose: MeshBonePose,
): MeshBoneMatrices {
  const n = rig.bones.length
  const bindWorld: Mat4[] = new Array(n)
  const poseWorld: Mat4[] = new Array(n)
  const bendWorld: Array<Mat4 | null> = new Array(n).fill(null)
  const bendBind: Array<Mat4 | null> = new Array(n).fill(null)

  for (let i = 0; i < n; i += 1) {
    const bone = rig.bones[i]!
    const pp = bone.id === 'root' ? EMPTY : partPoseOf(pose, bone.id)

    let parentBind = matIdentity()
    let parentPose = matIdentity()
    let localHead: [number, number, number] = [bone.head[0], bone.head[1], bone.head[2]]

    if (bone.parent != null) {
      const parentIdx = rig.indexOf[bone.parent]!
      const parentBone = rig.bones[parentIdx]!
      // Children of a bend bone hang off the elbow/knee so Bend carries forearm/shin/hand/foot.
      if (parentBone.hasBend && bendBind[parentIdx] && bendWorld[parentIdx]) {
        const bendPt = lerp3(parentBone.head, parentBone.tip, parentBone.bendT)
        localHead = [
          bone.head[0] - bendPt[0],
          bone.head[1] - bendPt[1],
          bone.head[2] - bendPt[2],
        ]
        parentBind = bendBind[parentIdx]!
        parentPose = bendWorld[parentIdx]!
      } else {
        localHead = [
          bone.head[0] - parentBone.head[0],
          bone.head[1] - parentBone.head[1],
          bone.head[2] - parentBone.head[2],
        ]
        parentBind = bindWorld[parentIdx]!
        parentPose = poseWorld[parentIdx]!
      }
    }

    const bindLocal = matTranslate(localHead[0], localHead[1], localHead[2])
    bindWorld[i] = matMul(parentBind, bindLocal)

    const poseLocal = matMul(
      matTranslate(
        localHead[0] + pp.pos[0],
        localHead[1] + pp.pos[1],
        localHead[2] + pp.pos[2],
      ),
      matEulerXyzDeg(pp.rot[0], pp.rot[1], pp.rot[2]),
    )
    poseWorld[i] = matMul(parentPose, poseLocal)

    if (bone.hasBend) {
      const bendPt = lerp3(bone.head, bone.tip, bone.bendT)
      const bendLocalBind = matTranslate(
        bendPt[0] - bone.head[0],
        bendPt[1] - bone.head[1],
        bendPt[2] - bone.head[2],
      )
      bendBind[i] = matMul(bindWorld[i]!, bendLocalBind)
      const bendLocalPose = matMul(
        bendLocalBind,
        matEulerXyzDeg(pp.bend[0], pp.bend[1], pp.bend[2]),
      )
      bendWorld[i] = matMul(poseWorld[i]!, bendLocalPose)
    }
  }

  // Root channels: apply as a global transform on every bone.
  const root = partPoseOf(pose, 'root')
  const rootPosEps = (meshBoneRigScale(rig) || 1) * 1e-4
  if (
    Math.abs(root.pos[0]) + Math.abs(root.pos[1]) + Math.abs(root.pos[2]) > rootPosEps
    || Math.abs(root.rot[0]) + Math.abs(root.rot[1]) + Math.abs(root.rot[2]) > 0.05
  ) {
    const rootM = matMul(
      matTranslate(root.pos[0], root.pos[1], root.pos[2]),
      matEulerXyzDeg(root.rot[0], root.rot[1], root.rot[2]),
    )
    for (let i = 0; i < n; i += 1) {
      poseWorld[i] = matMul(rootM, poseWorld[i]!)
      if (bendWorld[i]) bendWorld[i] = matMul(rootM, bendWorld[i]!)
    }
  }

  return { bindWorld, poseWorld, bendWorld, bendBind }
}

/** Parent world matrix used when resolving a bone's local pose (matches skinning). */
export function meshBoneParentPoseWorld(
  rig: MeshBoneRig,
  boneIndex: number,
  matrices: MeshBoneMatrices,
): Mat4 {
  const bone = rig.bones[boneIndex]!
  if (bone.parent == null) return matIdentity()
  const parentIdx = rig.indexOf[bone.parent]!
  const parentBone = rig.bones[parentIdx]!
  if (parentBone.hasBend && matrices.bendWorld[parentIdx]) {
    return matrices.bendWorld[parentIdx]!
  }
  return matrices.poseWorld[parentIdx]!
}

/** Local TR matrix: inv(parentWorld) * world. */
export function mat4LocalFromWorld(parentWorld: Mat4 | null, world: Mat4): Mat4 {
  const parent = parentWorld ?? matIdentity()
  return matMul(matInvert(parent), world)
}

/** Parent bind matrix used when resolving a bone's local bind pose. */
export function meshBoneParentBindWorld(
  rig: MeshBoneRig,
  boneIndex: number,
  matrices: MeshBoneMatrices,
): Mat4 | null {
  const bone = rig.bones[boneIndex]!
  if (bone.parent == null) return null
  const parentIdx = rig.indexOf[bone.parent]!
  const parentBone = rig.bones[parentIdx]!
  if (parentBone.hasBend && matrices.bendBind[parentIdx]) {
    return matrices.bendBind[parentIdx]!
  }
  return matrices.bindWorld[parentIdx]!
}

/** Bind local matrix for a bone joint (parent bind -> bone bind). */
export function meshBoneBindLocalMatrix(
  rig: MeshBoneRig,
  boneIndex: number,
  matrices: MeshBoneMatrices,
): Mat4 {
  const parent = meshBoneParentBindWorld(rig, boneIndex, matrices)
  return mat4LocalFromWorld(parent, matrices.bindWorld[boneIndex]!)
}

/** Bind local matrix for a mid-bone bend handle. */
export function meshBoneBendBindLocalMatrix(
  boneIndex: number,
  matrices: MeshBoneMatrices,
): Mat4 {
  return mat4LocalFromWorld(matrices.bindWorld[boneIndex]!, matrices.bendBind[boneIndex]!)
}

/** Inverse of matEulerXyzDeg — rotation-only, XYZ order (Rz * Ry * Rx). */
export function mat4ToEulerXyzDeg(m: Mat4): [number, number, number] {
  const r00 = m[0]!
  const r10 = m[1]!
  const r20 = m[2]!
  const r11 = m[5]!
  const r21 = m[6]!
  const r22 = m[10]!
  const sy = -r20
  const cy = Math.hypot(r00, r10)
  let x: number
  let y: number
  let z: number
  if (cy > 1e-6) {
    x = Math.atan2(r21, r22)
    y = Math.atan2(sy, cy)
    z = Math.atan2(r10, r00)
  } else {
    x = Math.atan2(-m[6]!, r11)
    y = Math.atan2(sy, cy)
    z = 0
  }
  return [x / DEG, y / DEG, z / DEG]
}

/** Pose rotation (degrees) from a gizmo local matrix vs bind local. */
export function poseRotFromGizmoLocal(bindLocal: Mat4, currentLocal: Mat4): [number, number, number] {
  const delta = matMul(matInvert(bindLocal), currentLocal)
  return mat4ToEulerXyzDeg(delta)
}

/** Pose translation from a gizmo local matrix vs bind local. */
export function posePosFromGizmoLocal(bindLocal: Mat4, currentLocal: Mat4): [number, number, number] {
  const delta = matMul(matInvert(bindLocal), currentLocal)
  return [delta[12]!, delta[13]!, delta[14]!]
}

/** Rigid transform as a unit dual quaternion, laid out [rx,ry,rz,rw, dx,dy,dz,dw]. */
function dualQuatFromMatrix(m: Mat4, out: Float64Array, at: number): void {
  const r00 = m[0]!
  const r10 = m[1]!
  const r20 = m[2]!
  const r01 = m[4]!
  const r11 = m[5]!
  const r21 = m[6]!
  const r02 = m[8]!
  const r12 = m[9]!
  const r22 = m[10]!

  let x: number
  let y: number
  let z: number
  let w: number
  const trace = r00 + r11 + r22
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    w = 0.25 / s
    x = (r21 - r12) * s
    y = (r02 - r20) * s
    z = (r10 - r01) * s
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22)
    w = (r21 - r12) / s
    x = 0.25 * s
    y = (r01 + r10) / s
    z = (r02 + r20) / s
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22)
    w = (r02 - r20) / s
    x = (r01 + r10) / s
    y = 0.25 * s
    z = (r12 + r21) / s
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11)
    w = (r10 - r01) / s
    x = (r02 + r20) / s
    y = (r12 + r21) / s
    z = 0.25 * s
  }

  const tx = m[12]!
  const ty = m[13]!
  const tz = m[14]!
  out[at] = x
  out[at + 1] = y
  out[at + 2] = z
  out[at + 3] = w
  // Dual part = 0.5 * (t as pure quaternion) * rotation.
  out[at + 4] = 0.5 * (tx * w + ty * z - tz * y)
  out[at + 5] = 0.5 * (-tx * z + ty * w + tz * x)
  out[at + 6] = 0.5 * (tx * y - ty * x + tz * w)
  out[at + 7] = -0.5 * (tx * x + ty * y + tz * z)
}

/**
 * Skin rest positions into `out` (same layout).
 *
 * Blending is dual quaternion (Kavan et al. 2007) rather than plain matrix
 * averaging: averaged matrices aren't rotations, so linear blend skinning
 * collapses limbs at joints and flattens them under twist. DQS keeps the blend
 * rigid, at the cost of bulging on tight bends, so the result is mixed back
 * toward the linear solution — the usual production compromise.
 */
export function skinMeshPositions(
  rest: Float32Array,
  out: { setXYZ: (i: number, x: number, y: number, z: number) => void },
  rig: MeshBoneRig,
  skin: MeshBoneWeights,
  matrices: MeshBoneMatrices,
  deform: MeshSkinMode = 'rigid',
): void {
  // Skinning transforms are per bone, not per vertex — build them once.
  const boneCount = matrices.poseWorld.length
  const skinM: Mat4[] = matrices.poseWorld.map((m, i) =>
    matMul(m, matInvert(matrices.bindWorld[i]!)),
  )
  const skinBendM: Array<Mat4 | null> = matrices.bendWorld.map((m, i) => {
    const bind = matrices.bendBind[i]
    return m && bind ? matMul(m, matInvert(bind)) : null
  })
  const dqPose = new Float64Array(boneCount * 8)
  const dqBend = new Float64Array(boneCount * 8)
  for (let i = 0; i < boneCount; i += 1) {
    dualQuatFromMatrix(skinM[i]!, dqPose, i * 8)
    const bend = skinBendM[i]
    if (bend) dualQuatFromMatrix(bend, dqBend, i * 8)
  }

  for (let v = 0; v < skin.vertexCount; v += 1) {
    const px0 = rest[v * 3]!
    const py0 = rest[v * 3 + 1]!
    const pz0 = rest[v * 3 + 2]!

    // Linear blend, plus the dual quaternion accumulator.
    let lx = 0
    let ly = 0
    let lz = 0
    let wSum = 0
    let rx = 0
    let ry = 0
    let rz = 0
    let rw = 0
    let dx = 0
    let dy = 0
    let dz = 0
    let dw = 0
    // Antipodality: quaternions double-cover rotations, so influences have to be
    // signed consistently against the first one or they cancel out.
    let pivotSet = false
    let pvx = 0
    let pvy = 0
    let pvz = 0
    let pvw = 0

    const addInfluence = (dq: Float64Array, at: number, weight: number) => {
      let qx = dq[at]!
      let qy = dq[at + 1]!
      let qz = dq[at + 2]!
      let qw = dq[at + 3]!
      let qdx = dq[at + 4]!
      let qdy = dq[at + 5]!
      let qdz = dq[at + 6]!
      let qdw = dq[at + 7]!
      if (!pivotSet) {
        pivotSet = true
        pvx = qx
        pvy = qy
        pvz = qz
        pvw = qw
      } else if (qx * pvx + qy * pvy + qz * pvz + qw * pvw < 0) {
        qx = -qx
        qy = -qy
        qz = -qz
        qw = -qw
        qdx = -qdx
        qdy = -qdy
        qdz = -qdz
        qdw = -qdw
      }
      rx += qx * weight
      ry += qy * weight
      rz += qz * weight
      rw += qw * weight
      dx += qdx * weight
      dy += qdy * weight
      dz += qdz * weight
      dw += qdw * weight
    }

    for (let k = 0; k < 4; k += 1) {
      const bi = skin.indices[v * 4 + k]!
      const w = skin.weights[v * 4 + k]!
      if (bi < 0 || w <= 1e-6) continue
      const bone = rig.bones[bi]!
      const bendM = skinBendM[bi]

      // Fraction of this vertex driven by the bend joint. A hard switch at the
      // bend plane creases the limb, so ramp across a narrow band.
      let bendMix = 0
      if (bone.hasBend && bendM) {
        const ax = bone.tip[0] - bone.head[0]
        const ay = bone.tip[1] - bone.head[1]
        const az = bone.tip[2] - bone.head[2]
        const axisLen = Math.hypot(ax, ay, az) || 1
        const along =
          ((px0 - bone.head[0]) * ax
            + (py0 - bone.head[1]) * ay
            + (pz0 - bone.head[2]) * az)
          / axisLen
        const half = axisLen * BEND_BLEND_BAND
        const bendAlong = bone.bendT * axisLen
        bendMix =
          deform === 'rigid'
            ? along >= bendAlong ? 1 : 0
            : Math.max(0, Math.min(1, (along - (bendAlong - half)) / (half * 2)))
      }

      const straight = matTransformPoint(skinM[bi]!, [px0, py0, pz0])
      if (bendM && bendMix > 0) {
        const bent = matTransformPoint(bendM, [px0, py0, pz0])
        lx += (straight[0] + (bent[0] - straight[0]) * bendMix) * w
        ly += (straight[1] + (bent[1] - straight[1]) * bendMix) * w
        lz += (straight[2] + (bent[2] - straight[2]) * bendMix) * w
        if (bendMix < 1) addInfluence(dqPose, bi * 8, w * (1 - bendMix))
        addInfluence(dqBend, bi * 8, w * bendMix)
      } else {
        lx += straight[0] * w
        ly += straight[1] * w
        lz += straight[2] * w
        addInfluence(dqPose, bi * 8, w)
      }
      wSum += w
    }

    if (wSum < 1e-6) {
      out.setXYZ(v, px0, py0, pz0)
      continue
    }

    lx /= wSum
    ly /= wSum
    lz /= wSum

    const qLen = Math.hypot(rx, ry, rz, rw)
    if (qLen < 1e-8) {
      out.setXYZ(v, lx, ly, lz)
      continue
    }
    const inv = 1 / qLen
    rx *= inv
    ry *= inv
    rz *= inv
    rw *= inv
    dx *= inv
    dy *= inv
    dz *= inv
    dw *= inv

    // Rotate by the unit quaternion, then add the translation it carries.
    const cx = ry * pz0 - rz * py0
    const cy = rz * px0 - rx * pz0
    const cz = rx * py0 - ry * px0
    const ccx = ry * cz - rz * cy
    const ccy = rz * cx - rx * cz
    const ccz = rx * cy - ry * cx
    const tx = 2 * (-dw * rx + dx * rw - dy * rz + dz * ry)
    const ty = 2 * (-dw * ry + dx * rz + dy * rw - dz * rx)
    const tz = 2 * (-dw * rz - dx * ry + dy * rx + dz * rw)
    const qx = px0 + 2 * (rw * cx + ccx) + tx
    const qy = py0 + 2 * (rw * cy + ccy) + ty
    const qz = pz0 + 2 * (rw * cz + ccz) + tz

    const mix = deform === 'rigid' ? 0 : LINEAR_SKIN_MIX
    out.setXYZ(
      v,
      qx + (lx - qx) * mix,
      qy + (ly - qy) * mix,
      qz + (lz - qz) * mix,
    )
  }
}

export function applyMeshBonePoseToPositions(
  rest: Float32Array,
  out: { setXYZ: (i: number, x: number, y: number, z: number) => void },
  rig: MeshBoneRig,
  skin: MeshBoneWeights,
  pose: MeshBonePose | null | undefined,
  deform: MeshSkinMode = 'rigid',
): void {
  if (!pose || !meshBonePoseIsActive(pose, rig)) {
    const count = Math.floor(rest.length / 3)
    for (let i = 0; i < count; i += 1) {
      out.setXYZ(i, rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]!)
    }
    return
  }
  const matrices = computeMeshBoneMatrices(rig, pose)
  skinMeshPositions(rest, out, rig, skin, matrices, deform)
}

const rigCache = new WeakMap<Uint8Array, Map<MeshRigMode, MeshBoneRig | null>>()

/** Rig for an OBJ, cached per byte buffer — fitting re-parses the whole file. */
export function rigForObjBytes(
  objBytes: Uint8Array,
  mode: MeshRigMode = 'auto',
): MeshBoneRig | null {
  let byMode = rigCache.get(objBytes)
  if (!byMode) {
    byMode = new Map()
    rigCache.set(objBytes, byMode)
  }
  const cached = byMode.get(mode)
  if (cached !== undefined) return cached
  const rig = fitMeshBones(positionsFromObj(objBytes), mode)
  byMode.set(mode, rig)
  return rig
}

/** Bake bone pose into OBJ vertex positions. */
export function bakeMeshBonePose(
  objBytes: Uint8Array,
  pose: MeshBonePose,
  mode: MeshRigMode = 'auto',
  rigOverride?: MeshBoneRig | null,
  weightsOverride?: MeshBoneWeights | null,
  deform: MeshSkinMode = 'rigid',
): Uint8Array {
  if (!meshBonePoseIsActive(pose, rigOverride)) return objBytes

  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const lines = text.split(/\r?\n/)
  const verts: [number, number, number][] = []
  const vertRgb: ([number, number, number] | null)[] = []
  const vertLineIndex: number[] = []

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li]!.trim()
    if (!line.startsWith('v ')) continue
    const parts = line.split(/\s+/)
    verts.push([
      Number(parts[1]) || 0,
      Number(parts[2]) || 0,
      Number(parts[3]) || 0,
    ])
    vertRgb.push(
      parts.length >= 7
        ? [Number(parts[4]) || 0, Number(parts[5]) || 0, Number(parts[6]) || 0]
        : null,
    )
    vertLineIndex.push(li)
  }
  if (verts.length === 0) return objBytes

  const positions = new Float32Array(verts.length * 3)
  for (let i = 0; i < verts.length; i += 1) {
    positions[i * 3] = verts[i]![0]
    positions[i * 3 + 1] = verts[i]![1]
    positions[i * 3 + 2] = verts[i]![2]
  }
  // Same cached rig the preview poses with, so the bake matches what was on screen.
  const rig = rigOverride ?? rigForObjBytes(objBytes, mode)
  if (!rig) return objBytes
  const computed = computeMeshBoneWeights(positions, rig, deform)
  const imported =
    weightsOverride?.vertexCount === verts.length ? weightsOverride : null
  const skin =
    deform === 'rigid'
      ? hardenMeshBoneWeights(imported ?? computed)
      : (imported ?? computed)
  const rest = positions.slice()
  applyMeshBonePoseToPositions(
    rest,
    {
      setXYZ(i, x, y, z) {
        positions[i * 3] = x
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = z
      },
    },
    rig,
    skin,
    pose,
    deform,
  )

  const outLines = lines.slice()
  for (let i = 0; i < vertLineIndex.length; i += 1) {
    const li = vertLineIndex[i]!
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const rgb = vertRgb[i]
    outLines[li] = rgb
      ? `v ${x} ${y} ${z} ${rgb[0]} ${rgb[1]} ${rgb[2]}`
      : `v ${x} ${y} ${z}`
  }
  return new TextEncoder().encode(outLines.join('\n'))
}

/** Collect all positions from an OBJ for rig fitting. */
export function positionsFromObj(objBytes: Uint8Array): Float32Array {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const coords: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('v ')) continue
    const parts = line.split(/\s+/)
    coords.push(Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0)
  }
  return new Float32Array(coords)
}
