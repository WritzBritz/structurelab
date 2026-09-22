import * as THREE from 'three'
import { parseSkinAtlas, skinLayoutTexelInset, SKIN_LAYOUT_W } from './skinModel'
import { parseCapeAtlas, CAPE_LAYOUT_W } from './capeModel'

/** Minecraft Java skin UV box (origin at top-left of the 2D layout for that cube). */
type SkinBox = {
  name: string
  /** Position of box centre in player space (Y-up, units = skin pixels). */
  center: [number, number, number]
  size: [number, number, number]
  /** UV origin of the cube layout on the 64×64 sheet. */
  uv: [number, number]
  /** Vanilla `.mirror()` — swap east/west UVs (legacy 64×32 left limbs). */
  mirror?: boolean
  /** UV box size when geometry is inflated (hat) or thinner (skeleton). */
  uvSize?: [number, number, number]
  /**
   * Slice of the original cube height mapped onto this mesh (0 = sole, 1 = hip).
   * Used when a limb is split at the knee/elbow so each half keeps its 6px of the 12px UV.
   */
  uvSliceY?: [number, number]
  hideTop?: boolean
  hideBottom?: boolean
}

export type CharacterPoseLike = {
  root?: {
    pos: [number, number, number]
    rot: [number, number, number]
    bend?: [number, number, number]
  }
  parts: Record<
    string,
    {
      pos: [number, number, number]
      rot: [number, number, number]
      bend: [number, number, number]
    }
  >
  pivots?: Record<string, [number, number, number]>
  /** Whole-cube posing for Minecraft catalog OBJ parts. */
  rigid?: boolean
}

export type SkinJointStyle = 'mineimator' | 'blockbench'

/** World units per skin pixel in the 3D preview figure. */
export const SKIN_PREVIEW_SCALE = 0.1

export type SkinLimbId =
  | 'root'
  | 'body'
  | 'head'
  | 'left_arm'
  | 'right_arm'
  | 'left_leg'
  | 'right_leg'
  | 'cape'

const LIMB_OBJECT_NAMES: Record<Exclude<SkinLimbId, 'root'>, string> = {
  body: 'body_pivot',
  head: 'head_joint',
  left_arm: 'left_arm_joint',
  right_arm: 'right_arm_joint',
  left_leg: 'left_leg_joint',
  right_leg: 'right_leg_joint',
  cape: 'cape_joint',
}

function tagLimb(obj: THREE.Object3D, limbId: SkinLimbId) {
  obj.userData.limbId = limbId
  obj.traverse((child) => {
    child.userData.limbId = limbId
  })
}

/** Resolve the pivot Object3D for a limb inside a `player-skin` group. */
export function findSkinLimbObject(
  playerGroup: THREE.Object3D,
  limbId: SkinLimbId,
): THREE.Object3D | null {
  if (limbId === 'root') return playerGroup
  const name = LIMB_OBJECT_NAMES[limbId]
  return playerGroup.getObjectByName(name) ?? null
}

/** Elbow / knee bend pivot — Blockbench-style secondary rotation. */
export function findSkinBendObject(
  playerGroup: THREE.Object3D,
  limbId: SkinLimbId,
): THREE.Object3D | null {
  if (limbId === 'root' || limbId === 'head') return null
  return playerGroup.getObjectByName(`${limbId}_bend`) ?? null
}

export function skinLimbSupportsBend(limbId: SkinLimbId): boolean {
  return limbId === 'body'
    || limbId === 'left_arm'
    || limbId === 'right_arm'
    || limbId === 'left_leg'
    || limbId === 'right_leg'
    || limbId === 'cape'
}

/**
 * Push pose channels onto an existing player-skin group (no remesh).
 * Used so slider / gizmo edits update the live preview without remounting.
 */
export function applySkinPoseToGroup(
  playerGroup: THREE.Object3D,
  pose: CharacterPoseLike | null | undefined,
  scale = SKIN_PREVIEW_SCALE,
) {
  const root = pose?.root
  playerGroup.position.set(
    ((root?.pos?.[0] ?? 0) * scale),
    ((root?.pos?.[1] ?? 0) * scale),
    ((root?.pos?.[2] ?? 0) * scale),
  )
  // Root rot is stored euler (same as export) — no preview-only facing offset.
  playerGroup.rotation.set(
    deg(root?.rot?.[0] ?? 0),
    deg(root?.rot?.[1] ?? 0),
    deg(root?.rot?.[2] ?? 0),
  )

  const bodyPivot = playerGroup.getObjectByName('body_pivot')
  if (bodyPivot) {
    const base = (bodyPivot.userData.baseLocal as [number, number, number] | undefined) ?? [
      0,
      12 * scale,
      0,
    ]
    const body = pose?.parts.body
    bodyPivot.position.set(
      base[0] + (body?.pos[0] ?? 0) * scale,
      base[1] + (body?.pos[1] ?? 0) * scale,
      base[2] + (body?.pos[2] ?? 0) * scale,
    )
    bodyPivot.rotation.order = 'XYZ'
    bodyPivot.rotation.set(
      deg(body?.rot[0] ?? 0),
      deg(body?.rot[1] ?? 0),
      deg(body?.rot[2] ?? 0),
    )
    const waist = bodyPivot.getObjectByName('body_bend')
    if (waist) {
      const [bx, by, bz] = skinBendVisualAngles(body?.bend, false)
      waist.rotation.order = 'XYZ'
      waist.rotation.set(deg(bx), deg(by), deg(bz))
    }
  }

  const head = playerGroup.getObjectByName('head_joint')
  if (head) {
    const base = (head.userData.baseLocal as [number, number, number] | undefined) ?? [
      0,
      12 * scale,
      0,
    ]
    const part = pose?.parts.head
    head.position.set(
      base[0] + (part?.pos[0] ?? 0) * scale,
      base[1] + (part?.pos[1] ?? 0) * scale,
      base[2] + (part?.pos[2] ?? 0) * scale,
    )
    head.rotation.order = 'XYZ'
    head.rotation.set(deg(part?.rot[0] ?? 0), deg(part?.rot[1] ?? 0), deg(part?.rot[2] ?? 0))
  }

  for (const poseKey of ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'cape'] as const) {
    const joint = playerGroup.getObjectByName(`${poseKey}_joint`)
    if (!joint) continue
    const base = (joint.userData.baseLocal as [number, number, number] | undefined) ?? [
      joint.position.x,
      joint.position.y,
      joint.position.z,
    ]
    const part = pose?.parts[poseKey]
    joint.position.set(
      base[0] + (part?.pos[0] ?? 0) * scale,
      base[1] + (part?.pos[1] ?? 0) * scale,
      base[2] + (part?.pos[2] ?? 0) * scale,
    )
    joint.rotation.order = 'XYZ'
    joint.rotation.set(deg(part?.rot[0] ?? 0), deg(part?.rot[1] ?? 0), deg(part?.rot[2] ?? 0))
    const bendJoint = joint.getObjectByName(`${poseKey}_bend`) as THREE.Object3D | undefined
    if (bendJoint) {
      const invert = Boolean(joint.userData.invertBend)
      const [bx, by, bz] = skinBendVisualAngles(part?.bend, invert)
      bendJoint.rotation.order = 'XYZ'
      bendJoint.rotation.set(deg(bx), deg(by), deg(bz))
    }
  }
}

function classicParts(
  slim: boolean,
  limbs: 'classic' | 'slim' | 'skeleton' = slim ? 'slim' : 'classic',
  layoutH = 64,
): SkinBox[] {
  const skeleton = limbs === 'skeleton'
  const armW = skeleton ? 2 : slim ? 3 : 4
  const armD = skeleton ? 2 : 4
  const legW = skeleton ? 2 : 4
  const legD = skeleton ? 2 : 4
  const legacyLeft = layoutH <= 32 || skeleton
  return [
    { name: 'head', center: [0, 28, 0], size: [8, 8, 8], uv: [0, 0], uvSize: [8, 8, 8] },
    { name: 'body', center: [0, 18, 0], size: [8, 12, 4], uv: [16, 16], uvSize: [8, 12, 4] },
    {
      name: 'right_arm',
      center: [-(4 + armW / 2), 18, 0],
      size: [armW, 12, armD],
      uv: [40, 16],
      uvSize: [armW, 12, armD],
    },
    {
      name: 'left_arm',
      center: [4 + armW / 2, 18, 0],
      size: [armW, 12, armD],
      uv: legacyLeft ? [40, 16] : [32, 48],
      mirror: legacyLeft,
      uvSize: [armW, 12, armD],
    },
    {
      name: 'right_leg',
      center: [-legW / 2, 6, 0],
      size: [legW, 12, legD],
      uv: [0, 16],
      uvSize: [legW, 12, legD],
    },
    {
      name: 'left_leg',
      center: [legW / 2, 6, 0],
      size: [legW, 12, legD],
      uv: legacyLeft ? [0, 16] : [16, 48],
      mirror: legacyLeft,
      uvSize: [legW, 12, legD],
    },
  ]
}

import { MODELBENCH_HAT_INFLATE, MODELBENCH_LIMB_INFLATE } from './characterPose'

function outerParts(
  slim: boolean,
  overlay: 'full' | 'hat' | 'none' = 'full',
  limbs: 'classic' | 'slim' | 'skeleton' = slim ? 'slim' : 'classic',
): SkinBox[] {
  if (overlay === 'none') return []
  const skeleton = limbs === 'skeleton'
  const armW = skeleton ? 2 : slim ? 3 : 4
  // Modelbench steve/alex.mbtemplate: hat inflate 0.5, body/limb overlays 0.25.
  const hatGrow = MODELBENCH_HAT_INFLATE
  const limbGrow = MODELBENCH_LIMB_INFLATE
  const hat: SkinBox = {
    name: 'hat',
    center: [0, 28, 0],
    size: [8 + hatGrow * 2, 8 + hatGrow * 2, 8 + hatGrow * 2],
    uv: [32, 0],
    uvSize: [8, 8, 8],
  }
  if (overlay === 'hat') return [hat]
  return [
    hat,
    { name: 'jacket', center: [0, 18, 0], size: [8 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2], uv: [16, 32] },
    {
      name: 'right_sleeve',
      center: [-(4 + armW / 2), 18, 0],
      size: [armW + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [40, 32],
    },
    {
      name: 'left_sleeve',
      center: [4 + armW / 2, 18, 0],
      size: [armW + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [48, 48],
    },
    {
      name: 'right_pants',
      center: [-2, 6, 0],
      size: [4 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [0, 32],
    },
    {
      name: 'left_pants',
      center: [2, 6, 0],
      size: [4 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [0, 48],
    },
  ]
}

/**
 * Remap BoxGeometry UVs to a Minecraft skin cube layout.
 * `layoutW`/`layoutH` are the vanilla atlas (64×64 or 64×32), not the PNG pixel size.
 * Three.js face order: +X, -X, +Y, -Y, +Z, -Z (right, left, top, bottom, front, back).
 */
function applyMinecraftBoxUVs(
  geometry: THREE.BufferGeometry,
  u: number,
  v: number,
  boxW: number,
  boxH: number,
  boxD: number,
  layoutW = SKIN_LAYOUT_W,
  layoutH = 64,
  mirror = false,
  y0 = 0,
  y1 = 1,
  pixelScale = 1,
) {
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute
  const setFace = (faceIndex: number, x: number, y: number, w: number, h: number, flipX = false) => {
    const i = faceIndex * 4
    // Half a PNG texel in layout space. 0.5 layout units on HD crops scale/2 pixels
    // off each shirt/face edge (NearestFilter bleed guard must not grow with HD).
    const inset = skinLayoutTexelInset(pixelScale)
    const u0 = (x + inset) / layoutW
    const u1 = (x + w - inset) / layoutW
    const v0 = 1 - (y + h - inset) / layoutH
    const v1 = 1 - (y + inset) / layoutH
    const left = flipX ? u1 : u0
    const right = flipX ? u0 : u1
    uvAttr.setXY(i + 0, left, v1)
    uvAttr.setXY(i + 1, right, v1)
    uvAttr.setXY(i + 2, left, v0)
    uvAttr.setXY(i + 3, right, v0)
  }

  const lo = Math.min(1, Math.max(0, y0))
  const hi = Math.min(1, Math.max(lo + 1e-4, y1))
  // Cube top is at the top of the side strip (smaller V).
  const sideV = v + boxD + (1 - hi) * boxH
  const sideH = (hi - lo) * boxH

  // Vanilla cube: east = u+d+w, west = u. `.mirror()` swaps those two faces.
  const eastU = mirror ? u : u + boxD + boxW
  const westU = mirror ? u + boxD + boxW : u
  setFace(0, eastU, sideV, boxD, sideH, mirror)
  // Same flip as +X. `!mirror` on −X reversed the right cheek / ear (one head
  // side looked mirrored). BoxGeometry already runs U opposite on −X vs +X.
  setFace(1, westU, sideV, boxD, sideH, mirror)
  setFace(2, u + boxD, v, boxW, boxD)
  setFace(3, u + boxD + boxW, v, boxW, boxD, true)
  setFace(4, u + boxD, sideV, boxW, sideH, mirror)
  setFace(5, u + boxD * 2 + boxW, sideV, boxW, sideH, mirror)
  uvAttr.needsUpdate = true
}

/** BoxGeometry face order: +X −X +Y −Y +Z −Z, 4 verts each. */
function omitBoxFaces(geometry: THREE.BufferGeometry, hideTop: boolean, hideBottom: boolean) {
  if (!hideTop && !hideBottom) return
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const nor = geometry.getAttribute('normal')
  if (!pos || !uv) return
  const keep: number[] = []
  for (let face = 0; face < 6; face += 1) {
    if (face === 2 && hideTop) continue
    if (face === 3 && hideBottom) continue
    for (let v = 0; v < 4; v += 1) keep.push(face * 4 + v)
  }
  const n = keep.length
  const p2 = new Float32Array(n * 3)
  const u2 = new Float32Array(n * 2)
  const n2 = new Float32Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    const s = keep[i]!
    p2[i * 3] = pos.getX(s)
    p2[i * 3 + 1] = pos.getY(s)
    p2[i * 3 + 2] = pos.getZ(s)
    u2[i * 2] = uv.getX(s)
    u2[i * 2 + 1] = uv.getY(s)
    if (nor) {
      n2[i * 3] = nor.getX(s)
      n2[i * 3 + 1] = nor.getY(s)
      n2[i * 3 + 2] = nor.getZ(s)
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(p2, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(u2, 2))
  if (nor) geometry.setAttribute('normal', new THREE.BufferAttribute(n2, 3))
  geometry.computeVertexNormals()
}

/** Cape sits behind the body: vanilla north (the design) must face −Z. */
function swapBoxFrontBackUvs(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv || uv.count < 24) return
  for (let v = 0; v < 4; v += 1) {
    const a = 16 + v
    const b = 20 + v
    const ua = uv.getX(a)
    const va = uv.getY(a)
    uv.setXY(a, uv.getX(b), uv.getY(b))
    uv.setXY(b, ua, va)
  }
  uv.needsUpdate = true
}

function inferSkinUvSize(box: SkinBox): [number, number, number] {
  const [sx, , sz] = box.size
  const name = box.name.replace(/_[ul]$/, '')
  if (name === 'head' || name === 'hat') return [8, 8, 8]
  if (name.includes('arm') || name.includes('sleeve')) {
    const w = sx <= 2.5 ? 2 : sx < 4.5 ? 3 : 4
    return [w, 12, Math.round(sz) || 4]
  }
  if (name.includes('leg') || name.includes('pants')) return [4, 12, 4]
  return [8, 12, 4]
}

function makeBoxMesh(
  material: THREE.MeshLambertMaterial,
  box: SkinBox,
  scale: number,
  layoutW = SKIN_LAYOUT_W,
  layoutH = 64,
  pixelScale = 1,
): THREE.Mesh {
  const [sx, sy, sz] = box.size
  const geometry = new THREE.BoxGeometry(sx * scale, sy * scale, sz * scale)
  const [uvW, uvH, uvD] = box.uvSize ?? [
    box.name === 'head' || box.name === 'hat'
      ? 8
      : box.name.includes('arm') || box.name.includes('sleeve')
        ? sx <= 2.5
          ? 2
          : sx < 4.5
            ? 3
            : 4
        : box.name.includes('leg') || box.name.includes('pants')
          ? 4
          : 8,
    box.name === 'head' || box.name === 'hat' ? 8 : 12,
    box.name === 'head' || box.name === 'hat' ? 8 : box.name.includes('arm') || box.name.includes('leg') ? Math.round(sz) : 4,
  ]
  const [y0, y1] = box.uvSliceY ?? [0, 1]
  applyMinecraftBoxUVs(
    geometry,
    box.uv[0],
    box.uv[1],
    uvW,
    uvH,
    uvD,
    layoutW,
    layoutH,
    box.mirror,
    y0,
    y1,
    pixelScale,
  )
  omitBoxFaces(geometry, Boolean(box.hideTop), Boolean(box.hideBottom))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = box.name
  return mesh
}

function deg(n: number): number {
  return THREE.MathUtils.degToRad(n)
}

function negateBend(
  bend: readonly [number, number, number],
): [number, number, number] {
  const flip = (n: number) => (n === 0 ? 0 : -n)
  return [flip(bend[0]), flip(bend[1]), flip(bend[2])]
}

/**
 * Preview rotation for a stored bend channel.
 * Mine-imator arm joints invert the authored angles; Blockbench / the gizmo do not.
 * Do not clamp here — a [0,180] X limit made gizmo drags snap back to rest.
 */
export function skinBendVisualAngles(
  bend: readonly [number, number, number] | undefined,
  invert: boolean,
): [number, number, number] {
  const angles: [number, number, number] = [
    bend?.[0] ?? 0,
    bend?.[1] ?? 0,
    bend?.[2] ?? 0,
  ]
  return invert ? negateBend(angles) : angles
}

/** Inverse of `skinBendVisualAngles` — gizmo Euler back to the pose channel. */
export function skinBendPoseFromVisual(
  visual: readonly [number, number, number],
  invert: boolean,
): [number, number, number] {
  const angles: [number, number, number] = [visual[0], visual[1], visual[2]]
  return invert ? negateBend(angles) : angles
}

export function skinObjectInvertsBend(object: THREE.Object3D | null | undefined): boolean {
  for (let node: THREE.Object3D | null | undefined = object; node; node = node.parent) {
    if (node.userData.invertBend) return true
  }
  return false
}

/**
 * Hanging limb with MI joints: shoulder/hip ROT+POS, then elbow/knee BEND on the lower half.
 * Matches voxel `skin_pose` so preview ≈ convert.
 */
function addBentLimb(
  parent: THREE.Object3D,
  name: string,
  /** World-space joint (Y-up skin pixels). */
  jointAbs: [number, number, number],
  /** Joint in parent-local space. */
  jointLocal: [number, number, number],
  boxes: { box: SkinBox; material: THREE.MeshLambertMaterial }[],
  scale: number,
  pose: CharacterPoseLike | null | undefined,
  poseKey: string,
  bendOffset: number,
  invertBend: boolean,
  layoutW = SKIN_LAYOUT_W,
  layoutH = 64,
  /** Body waist: the half further from the hip sits on the bend joint. */
  distalAbove = false,
  pixelScale = 1,
) {
  const part = pose?.parts[poseKey]
  const shoulder = new THREE.Group()
  shoulder.name = `${name}_joint`
  const baseLocal: [number, number, number] = [
    jointLocal[0] * scale,
    jointLocal[1] * scale,
    jointLocal[2] * scale,
  ]
  shoulder.userData.baseLocal = baseLocal
  shoulder.userData.invertBend = invertBend
  shoulder.position.set(baseLocal[0], baseLocal[1], baseLocal[2])
  shoulder.rotation.order = 'XYZ'
  if (part) {
    shoulder.position.x += part.pos[0] * scale
    shoulder.position.y += part.pos[1] * scale
    shoulder.position.z += part.pos[2] * scale
    shoulder.rotation.set(deg(part.rot[0]), deg(part.rot[1]), deg(part.rot[2]))
  }

  const elbow = new THREE.Group()
  elbow.name = `${name}_bend`
  elbow.userData.invertBend = invertBend
  elbow.position.set(0, bendOffset * scale, 0)
  elbow.rotation.order = 'XYZ'
  if (part) {
    const [bx, by, bz] = skinBendVisualAngles(part.bend, invertBend)
    elbow.rotation.set(deg(bx), deg(by), deg(bz))
  }

  // Split each box into upper (above elbow) and lower (below elbow) halves.
  for (const { box, material } of boxes) {
    const [bw, bh, bd] = box.size
    const jointY = jointAbs[1]
    const elbowY = jointY + bendOffset
    const top = box.center[1] + bh / 2
    const bot = box.center[1] - bh / 2

    if (top > elbowY + 0.01) {
      const uTop = top
      const uBot = Math.max(elbowY, bot)
      const uH = uTop - uBot
      if (uH > 0.05) {
        const upperBox: SkinBox = {
          ...box,
          name: `${box.name}_u`,
          center: [box.center[0], (uTop + uBot) / 2, box.center[2]],
          size: [bw, uH, bd],
          uvSize: box.uvSize ?? inferSkinUvSize(box),
          uvSliceY: [bh <= 1e-4 ? 0 : (uBot - bot) / bh, bh <= 1e-4 ? 1 : (uTop - bot) / bh],
          hideBottom: true,
        }
        const mesh = makeBoxMesh(material, upperBox, scale, layoutW, layoutH, pixelScale)
        const originY = distalAbove ? elbowY : jointAbs[1]
        mesh.position.set(
          (upperBox.center[0] - jointAbs[0]) * scale,
          (upperBox.center[1] - originY) * scale,
          (upperBox.center[2] - jointAbs[2]) * scale,
        )
        ;(distalAbove ? elbow : shoulder).add(mesh)
      }
    }

    if (bot < elbowY - 0.01) {
      const lTop = Math.min(elbowY, top)
      const lBot = bot
      const lH = lTop - lBot
      if (lH > 0.05) {
        const lowerBox: SkinBox = {
          ...box,
          name: `${box.name}_l`,
          center: [box.center[0], (lTop + lBot) / 2, box.center[2]],
          size: [bw, lH, bd],
          uvSize: box.uvSize ?? inferSkinUvSize(box),
          uvSliceY: [bh <= 1e-4 ? 0 : (lBot - bot) / bh, bh <= 1e-4 ? 1 : (lTop - bot) / bh],
          hideTop: true,
        }
        const mesh = makeBoxMesh(material, lowerBox, scale, layoutW, layoutH, pixelScale)
        const originY = distalAbove ? jointAbs[1] : elbowY
        mesh.position.set(
          (lowerBox.center[0] - jointAbs[0]) * scale,
          (lowerBox.center[1] - originY) * scale,
          (lowerBox.center[2] - jointAbs[2]) * scale,
        )
        ;(distalAbove ? shoulder : elbow).add(mesh)
      }
    }
  }

  shoulder.add(elbow)
  tagLimb(shoulder, poseKey as SkinLimbId)
  // Upper half drives shoulder/hip Rotate; lower half (under the bend pivot)
  // drives Bend — tag so classic clicks pick the right gizmo channel.
  shoulder.userData.skinHandle = 'rot'
  shoulder.traverse((child) => {
    if (child === shoulder) return
    let underBend = false
    for (let node: THREE.Object3D | null = child; node && node !== shoulder; node = node.parent) {
      if (node === elbow) {
        underBend = true
        break
      }
    }
    child.userData.skinHandle = underBend ? 'bend' : 'rot'
  })
  elbow.userData.skinHandle = 'bend'
  parent.add(shoulder)
}

function addHead(
  parent: THREE.Object3D,
  boxes: { box: SkinBox; material: THREE.MeshLambertMaterial }[],
  scale: number,
  pose: CharacterPoseLike | null | undefined,
  layoutW = SKIN_LAYOUT_W,
  layoutH = 64,
  /** Parent-local Y of the neck, in skin pixels (12 from hips, 6 from waist). */
  neckLocalY = 12,
  pixelScale = 1,
) {
  const jointAbs: [number, number, number] = [0, 24, 0]
  const pivot = new THREE.Group()
  pivot.name = 'head_joint'
  const baseLocal: [number, number, number] = [0, neckLocalY * scale, 0]
  pivot.userData.baseLocal = baseLocal
  pivot.position.set(baseLocal[0], baseLocal[1], baseLocal[2])
  pivot.rotation.order = 'XYZ'
  const part = pose?.parts.head
  if (part) {
    pivot.position.x += part.pos[0] * scale
    pivot.position.y += part.pos[1] * scale
    pivot.position.z += part.pos[2] * scale
    pivot.rotation.set(deg(part.rot[0]), deg(part.rot[1]), deg(part.rot[2]))
  }
  for (const { box, material } of boxes) {
    const mesh = makeBoxMesh(material, box, scale, layoutW, layoutH, pixelScale)
    mesh.position.set(
      (box.center[0] - jointAbs[0]) * scale,
      (box.center[1] - jointAbs[1]) * scale,
      (box.center[2] - jointAbs[2]) * scale,
    )
    pivot.add(mesh)
  }
  tagLimb(pivot, 'head')
  parent.add(pivot)
}

function addCape(
  parent: THREE.Object3D,
  texture: THREE.Texture,
  scale: number,
  pose: CharacterPoseLike | null | undefined,
) {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  const img = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined
  const texW = img?.naturalWidth || img?.width || 64
  const texH = img?.naturalHeight || img?.height || 32
  const atlas = parseCapeAtlas(texW, texH)
  const layoutH = atlas?.layoutH ?? (texH * 2 === texW ? 32 : 64)
  const pixelScale = atlas?.scale ?? Math.max(1, texW / CAPE_LAYOUT_W)
  const mat = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  // Hang from the neck, flush behind the body (10×16×1). Pivot at the collar
  // so rotate/bend don't swing the top into the torso.
  const box: SkinBox = {
    name: 'cape',
    center: [0, 16, -2.5],
    size: [10, 16, 1],
    uv: [0, 0],
    uvSize: [10, 16, 1],
  }
  addBentLimb(
    parent,
    'cape',
    [0, 24, -2.5],
    [0, 6, -2.5],
    [{ box, material: mat }],
    scale,
    pose,
    'cape',
    -8,
    false,
    CAPE_LAYOUT_W,
    layoutH,
    false,
    pixelScale,
  )
  const capeJoint = parent.getObjectByName('cape_joint')
  capeJoint?.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) swapBoxFrontBackUvs(mesh.geometry)
  })
}

/**
 * Build a Y-up Minecraft player figure textured with a 64×64, 64×32, or HD-scaled skin.
 * Pose uses Mine-imator joints (arms at y=22, separate elbow/knee bend) to match convert.
 */
export type HumanoidPreview = {
  overlay?: 'full' | 'hat' | 'none'
  limbs?: 'classic' | 'slim' | 'skeleton'
}

export function buildPlayerSkinGroup(
  texture: THREE.Texture,
  slimArms: boolean,
  pose?: CharacterPoseLike | null,
  showOuterLayer = true,
  jointStyle: SkinJointStyle = 'mineimator',
  humanoid?: HumanoidPreview,
  capeTexture?: THREE.Texture | null,
): THREE.Group {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true

  const scale = SKIN_PREVIEW_SCALE
  const group = new THREE.Group()
  group.name = 'player-skin'
  group.userData.limbId = 'root'
  group.userData.baseLocal = [0, 0, 0]

  const innerMat = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: false,
    side: THREE.FrontSide,
  })
  const outerMat = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })

  const root = pose?.root
  group.position.set(
    ((root?.pos?.[0] ?? 0) * scale),
    ((root?.pos?.[1] ?? 0) * scale),
    ((root?.pos?.[2] ?? 0) * scale),
  )

  const img = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined
  const texW = img?.naturalWidth || img?.width || 64
  const texH = img?.naturalHeight || img?.height || 64
  const atlas = parseSkinAtlas(texW, texH)
  const layoutW = SKIN_LAYOUT_W
  const layoutH = atlas?.layoutH ?? (texH * 2 === texW ? 32 : 64)
  const pixelScale = atlas?.scale ?? Math.max(1, texW / layoutW)
  const limbs = humanoid?.limbs ?? (slimArms ? 'slim' : 'classic')
  const overlay = humanoid?.overlay ?? (showOuterLayer ? 'full' : 'none')
  const classic = classicParts(slimArms, limbs, layoutH)
  const outer = outerParts(slimArms, overlay, limbs)
  const byName = (name: string) => classic.find((b) => b.name === name)!
  const outerByName = (name: string) => outer.find((b) => b.name === name)
  const armW = limbs === 'skeleton' ? 2 : slimArms ? 3 : 4
  // Blockbench skin bones pivot on the body edge; Mine-imator uses arm centres.
  const armX =
    jointStyle === 'blockbench' ? (slimArms ? 5 : 6) : 4 + armW / 2
  const legX = jointStyle === 'blockbench' ? 1.9 : limbs === 'skeleton' ? 1 : 2
  const layer = (name: string) => {
    const found = outerByName(name)
    return found ? [{ box: found, material: outerMat }] : []
  }

  addBentLimb(
    group,
    'body',
    [0, 12, 0],
    [0, 12, 0],
    [
      { box: byName('body'), material: innerMat },
      ...layer('jacket'),
    ],
    scale,
    pose,
    'body',
    6,
    false,
    layoutW,
    layoutH,
    true,
    pixelScale,
  )
  const bodyPivot = group.getObjectByName('body_joint')
  if (bodyPivot) bodyPivot.name = 'body_pivot'
  const waist = bodyPivot?.getObjectByName('body_bend') ?? bodyPivot ?? group
  if (capeTexture) addCape(waist, capeTexture, scale, pose)

  addHead(
    waist,
    [
      { box: byName('head'), material: innerMat },
      ...(outerByName('hat') ? [{ box: outerByName('hat')!, material: outerMat }] : []),
    ],
    scale,
    pose,
    layoutW,
    layoutH,
    6,
    pixelScale,
  )

  // Arms hang from the waist so a hip/waist lean takes them with the torso.
  addBentLimb(
    waist,
    'left_arm',
    [armX, 22, 0],
    [armX, 4, 0],
    [
      { box: byName('left_arm'), material: innerMat },
      ...layer('left_sleeve'),
    ],
    scale,
    pose,
    'left_arm',
    -4,
    jointStyle === 'mineimator',
    layoutW,
    layoutH,
    false,
    pixelScale,
  )
  addBentLimb(
    waist,
    'right_arm',
    [-armX, 22, 0],
    [-armX, 4, 0],
    [
      { box: byName('right_arm'), material: innerMat },
      ...layer('right_sleeve'),
    ],
    scale,
    pose,
    'right_arm',
    -4,
    jointStyle === 'mineimator',
    layoutW,
    layoutH,
    false,
    pixelScale,
  )

  // Legs stay on the character root so a hip/waist pose does not swing the whole figure.
  const legParent = group
  const legLocalY = 12
  addBentLimb(
    legParent,
    'left_leg',
    [legX, 12, 0],
    [legX, legLocalY, 0],
    [
      { box: byName('left_leg'), material: innerMat },
      ...layer('left_pants'),
    ],
    scale,
    pose,
    'left_leg',
    -6,
    false,
    layoutW,
    layoutH,
    false,
    pixelScale,
  )
  addBentLimb(
    legParent,
    'right_leg',
    [-legX, 12, 0],
    [-legX, legLocalY, 0],
    [
      { box: byName('right_leg'), material: innerMat },
      ...layer('right_pants'),
    ],
    scale,
    pose,
    'right_leg',
    -6,
    false,
    layoutW,
    layoutH,
    false,
    pixelScale,
  )

  group.rotation.set(
    deg(root?.rot?.[0] ?? 0),
    deg(root?.rot?.[1] ?? 0),
    deg(root?.rot?.[2] ?? 0),
  )
  return group
}
