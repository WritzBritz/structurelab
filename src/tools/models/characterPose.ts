/** Mine-imator character pose extraction + posed human mesh → OBJ. */

import { basename } from './objAssets'
import { parseMiobjectText, type MimodelConversion } from './miobjectAssets'
import { parseSkinAtlas, skinSizeHint } from './skinModel'

type JsonMap = Record<string, unknown>

export type PartPose = {
  pos: [number, number, number]
  rot: [number, number, number]
  bend: [number, number, number]
  scale: [number, number, number]
  /** Timeline VISIBLE — false hides Outline helpers and other studio-only parts. */
  visible?: boolean
}

export type CharacterPose = {
  slimArms: boolean
  /** Root character offset from the miobject (Mine-imator units). */
  root: PartPose
  parts: Record<string, PartPose>
}

/** Modelbench steve/alex.mbtemplate outer inflates (px per side). */
export const MODELBENCH_HAT_INFLATE = 0.5
export const MODELBENCH_LIMB_INFLATE = 0.25

const EMPTY_POSE = (): PartPose => ({
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  bend: [0, 0, 0],
  scale: [1, 1, 1],
})

export const SKIN_POSE_LIMBS = [
  { id: 'root', label: 'Root' },
  { id: 'body', label: 'Body' },
  { id: 'head', label: 'Head' },
  { id: 'left_arm', label: 'Left arm' },
  { id: 'right_arm', label: 'Right arm' },
  { id: 'left_leg', label: 'Left leg' },
  { id: 'right_leg', label: 'Right leg' },
  { id: 'cape', label: 'Cape' },
] as const

export type SkinPoseLimbId = (typeof SKIN_POSE_LIMBS)[number]['id']

/** Limbs with an elbow/knee bend pivot in the skin preview rig. */
export const SKIN_BEND_LIMBS = new Set<SkinPoseLimbId>([
  'body',
  'left_arm',
  'right_arm',
  'left_leg',
  'right_leg',
  'cape',
])

/** Editor-only id suffix: lower arm/leg (elbow/knee) while pose data stays on the base limb. */
export const SKIN_BEND_LIMB_SUFFIX = '__bend'

export function skinPoseLimbBase(id: string): string {
  return id.endsWith(SKIN_BEND_LIMB_SUFFIX)
    ? id.slice(0, -SKIN_BEND_LIMB_SUFFIX.length)
    : id
}

export function skinPoseLimbIsBend(id: string): boolean {
  return id.endsWith(SKIN_BEND_LIMB_SUFFIX)
}

export function skinPoseBendLimbId(baseId: string): string {
  return `${baseId}${SKIN_BEND_LIMB_SUFFIX}`
}

/** Inner name for overlay shells (`right_arm_overlay` → `right_arm`). */
export function skinPoseHostLimbId(id: string): string {
  return id.endsWith('_overlay') ? id.slice(0, -'_overlay'.length) : id
}

/** Arms and legs get an elbow/knee split like player skins. Body uses waist in the menu only. */
export function isSkinLimbBendName(id: string): boolean {
  const host = skinPoseHostLimbId(id)
  return host.endsWith('_arm') || host.endsWith('_leg') || host === 'cape'
}

/** Classic limb list with separate upper (shoulder/hip) and lower (elbow/knee) rows. */
export const SKIN_POSE_LIMBS_SPLIT: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'root', label: 'Root' },
  { id: 'body', label: 'Hips' },
  { id: skinPoseBendLimbId('body'), label: 'Waist' },
  { id: 'head', label: 'Head' },
  { id: 'left_arm', label: 'Left upper arm' },
  { id: skinPoseBendLimbId('left_arm'), label: 'Left forearm' },
  { id: 'right_arm', label: 'Right upper arm' },
  { id: skinPoseBendLimbId('right_arm'), label: 'Right forearm' },
  { id: 'left_leg', label: 'Left thigh' },
  { id: skinPoseBendLimbId('left_leg'), label: 'Left shin' },
  { id: 'right_leg', label: 'Right thigh' },
  { id: skinPoseBendLimbId('right_leg'), label: 'Right shin' },
]

export function partSupportsPoseEditing(part: {
  kind: string
  mimodelBytes?: Uint8Array | null
  bytes?: Uint8Array
  voxBytes?: Uint8Array | null
  sourceLabel?: string | null
  meshRigMode?: string | null
}): boolean {
  if (part.kind === 'skin') return true
  if (part.mimodelBytes && part.mimodelBytes.length > 0) return true
  if (part.kind === 'obj') {
    const voxOnly = Boolean(part.voxBytes?.length) && (!part.bytes?.length || part.bytes.length < 64)
    return !voxOnly
  }
  return false
}

/** Rotate-only limb rows for Minecraft catalog humanoids (one joint per cube). */
export function poseLimbsForCatalogEntity(
  pose: { parts: Record<string, unknown> },
): { id: string; label: string }[] {
  const partIds = Object.keys(pose.parts)
    .filter((id) => !id.endsWith('_overlay'))
    .sort((a, b) => a.localeCompare(b))
  return [
    { id: 'root', label: 'Root (whole model)' },
    ...partIds.map((id) => ({
      id,
      label:
        id === 'body'
          ? 'Hips'
          : id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  ]
}

export function partHasCape(part: { capeBytes?: Uint8Array | null }): boolean {
  return Boolean(part.capeBytes && part.capeBytes.length >= 64)
}

export function poseLimbsForEditor(
  part: { kind: string; mimodelBytes?: Uint8Array | null; capeBytes?: Uint8Array | null },
  pose: { parts: Record<string, unknown> },
): { id: string; label: string }[] {
  if (part.kind === 'skin') {
    const rows = SKIN_POSE_LIMBS_SPLIT.map((entry) => ({ id: entry.id, label: entry.label }))
    if (partHasCape(part)) {
      rows.push({ id: 'cape', label: 'Cape' })
      rows.push({ id: skinPoseBendLimbId('cape'), label: 'Cape fold' })
    }
    return rows
  }
  // Mine-imator / character poses: same upper + lower rows when bend limbs exist.
  const partIds = Object.keys(pose.parts)
    .filter((id) => !id.endsWith('_overlay'))
    .sort((a, b) => a.localeCompare(b))
  if (partIds.some((id) => SKIN_BEND_LIMBS.has(skinPoseHostLimbId(id) as SkinPoseLimbId))) {
    const rows: { id: string; label: string }[] = [{ id: 'root', label: 'Root' }]
    for (const id of partIds) {
      const pretty = id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      if (SKIN_BEND_LIMBS.has(skinPoseHostLimbId(id) as SkinPoseLimbId)) {
        const lower =
          id === 'body' ? 'Waist'
          : id.endsWith('_arm') ? pretty.replace(/arm$/i, 'forearm')
          : id.endsWith('_leg') ? pretty.replace(/leg$/i, 'shin')
          : `${pretty} bend`
        const upper =
          id === 'body' ? 'Hips'
          : id.endsWith('_arm') ? pretty.replace(/arm$/i, 'upper arm')
          : id.endsWith('_leg') ? pretty.replace(/leg$/i, 'thigh')
          : pretty
        rows.push({ id, label: upper })
        rows.push({ id: skinPoseBendLimbId(id), label: lower })
      } else {
        rows.push({ id, label: pretty })
      }
    }
    return rows
  }
  return [
    { id: 'root', label: 'Root' },
    ...partIds.map((id) => ({
      id,
      label: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  ]
}

/** Rest pose for plain PNG skins / pose editor seeding. */
export function createRestSkinPose(slimArms = false): CharacterPose {
  return {
    slimArms,
    root: EMPTY_POSE(),
    parts: {
      body: EMPTY_POSE(),
      head: EMPTY_POSE(),
      left_arm: EMPTY_POSE(),
      right_arm: EMPTY_POSE(),
      left_leg: EMPTY_POSE(),
      right_leg: EMPTY_POSE(),
      cape: EMPTY_POSE(),
    },
  }
}

/**
 * Vanilla zombie / husk / drowned rest: arms pitched forward
 * (`HumanoidModel` xRot ≈ −π / 2.25 ≈ −80°).
 */
export function createZombieArmPose(slimArms = false): CharacterPose {
  const pose = createRestSkinPose(slimArms)
  const arm = { ...EMPTY_POSE(), rot: [-80, 0, 0] as [number, number, number] }
  pose.parts.left_arm = { ...arm }
  pose.parts.right_arm = { ...arm }
  return pose
}

export function emptyPartPose(): PartPose {
  return EMPTY_POSE()
}

function asMap(value: unknown): JsonMap | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonMap)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function mergeValues(target: PartPose, values: JsonMap) {
  target.pos[0] = num(values.POS_X, target.pos[0])
  target.pos[1] = num(values.POS_Y, target.pos[1])
  target.pos[2] = num(values.POS_Z, target.pos[2])
  target.rot[0] = num(values.ROT_X, target.rot[0])
  target.rot[1] = num(values.ROT_Y, target.rot[1])
  target.rot[2] = num(values.ROT_Z, target.rot[2])
  target.bend[0] = num(values.BEND_ANGLE_X ?? values.BEND_X, target.bend[0])
  target.bend[1] = num(values.BEND_ANGLE_Y ?? values.BEND_Y, target.bend[1])
  target.bend[2] = num(values.BEND_ANGLE_Z ?? values.BEND_Z, target.bend[2])
  target.scale[0] = num(values.SCA_X, target.scale[0])
  target.scale[1] = num(values.SCA_Y, target.scale[1])
  target.scale[2] = num(values.SCA_Z, target.scale[2])
  // Mine-imator hides Outline / helper parts via VISIBLE or near-zero ALPHA.
  if (values.VISIBLE === false || values.VISIBLE === 0) {
    target.visible = false
  }
  if (typeof values.ALPHA === 'number' && values.ALPHA < 0.05) {
    target.visible = false
  }
}

/** Prefer frame 0 keyframe, else lowest frame, merged over default_values. */
function valuesForTimeline(tl: JsonMap): JsonMap {
  const defaults = asMap(tl.default_values) ?? {}
  const frames = asMap(tl.keyframes) ?? {}
  const keys = Object.keys(frames)
  let chosen: JsonMap = {}
  if (frames['0']) chosen = asMap(frames['0']) ?? {}
  else if (keys.length > 0) {
    keys.sort((a, b) => Number(a) - Number(b))
    chosen = asMap(frames[keys[0]]) ?? {}
  }
  return { ...defaults, ...chosen }
}

export function extractCharacterPose(miobjectBytes: Uint8Array): CharacterPose {
  const root = parseMiobjectText(new TextDecoder('utf-8', { fatal: false }).decode(miobjectBytes))
  const templates = asArray(root.templates).map(asMap).filter(Boolean) as JsonMap[]
  const charTemplate = templates.find((entry) => asString(entry.type) === 'char')
  const state = asMap(asMap(charTemplate?.model)?.state)
  const slimArms = asString(state?.type)?.toLowerCase() === 'slim'

  const pose: CharacterPose = {
    slimArms,
    root: EMPTY_POSE(),
    parts: {},
  }

  for (const tl of asArray(root.timelines).map(asMap).filter(Boolean) as JsonMap[]) {
    const values = valuesForTimeline(tl)
    const type = asString(tl.type)
    // Root timeline for built-in characters (`char`) or custom models (`model`).
    if (type === 'char' || type === 'model') {
      mergeValues(pose.root, values)
      continue
    }
    if (type !== 'bodypart') continue
    const name = asString(tl.model_part_name)
    if (!name) continue
    const part = EMPTY_POSE()
    mergeValues(part, values)
    pose.parts[name] = part
  }
  return pose
}

type Vec3 = [number, number, number]

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180
}

/** Mine-imator / GameMaker style matrix: rotate ZYX then translate. */
function mulMat(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0]
        + a[1 * 4 + r] * b[c * 4 + 1]
        + a[2 * 4 + r] * b[c * 4 + 2]
        + a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return out
}

function matIdentity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function matTranslate(x: number, y: number, z: number): number[] {
  const m = matIdentity()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

function matScale(x: number, y: number, z: number): number[] {
  const m = matIdentity()
  m[0] = x
  m[5] = y
  m[10] = z
  return m
}

function matRotateEuler(rx: number, ry: number, rz: number): number[] {
  // GameMaker matrix_build: left-handed YXZ (negate angles + Y→X→Z).
  const x = degToRad(-rx)
  const y = degToRad(-ry)
  const z = degToRad(-rz)
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)
  const rxM = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]
  const ryM = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]
  const rzM = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  // YXZ: Rz * Rx * Ry
  return mulMat(rzM, mulMat(rxM, ryM))
}

function transformPoint(m: number[], p: Vec3): Vec3 {
  const x = p[0]
  const y = p[1]
  const z = p[2]
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  const inv = Math.abs(w) > 1e-8 ? 1 / w : 1
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * inv,
  ]
}

type LimbDef = {
  name: string
  /** Joint in body space (pixels). */
  joint: Vec3
  /** Box size. */
  size: Vec3
  /** UV origin on 64×64 skin. */
  uv: [number, number]
  /** Parent part name, or null for body-root. */
  parent: string | null
  /** Bend offset from joint along -Y (pixels). */
  bendOffset: number
  outer?: boolean
}

function limbDefs(slim: boolean): LimbDef[] {
  const armW = slim ? 3 : 4
  // Modelbench default player templates (steve/alex.mbtemplate).
  const hatGrow = MODELBENCH_HAT_INFLATE
  const limbGrow = MODELBENCH_LIMB_INFLATE
  const defs: LimbDef[] = [
    { name: 'body', joint: [0, 24, 0], size: [8, 12, 4], uv: [16, 16], parent: null, bendOffset: 6 },
    { name: 'head', joint: [0, 24, 0], size: [8, 8, 8], uv: [0, 0], parent: 'body', bendOffset: 4 },
    { name: 'hat', joint: [0, 24, 0], size: [8 + hatGrow * 2, 8 + hatGrow * 2, 8 + hatGrow * 2], uv: [32, 0], parent: 'head', bendOffset: 4, outer: true },
    { name: 'jacket', joint: [0, 24, 0], size: [8 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2], uv: [16, 32], parent: null, bendOffset: 6, outer: true },
    {
      name: 'right_arm',
      joint: [-(4 + armW / 2), 24, 0],
      size: [armW, 12, 4],
      uv: [40, 16],
      parent: 'body',
      bendOffset: 6,
    },
    {
      name: 'left_arm',
      joint: [4 + armW / 2, 24, 0],
      size: [armW, 12, 4],
      uv: [32, 48],
      parent: 'body',
      bendOffset: 6,
    },
    {
      name: 'right_sleeve',
      joint: [-(4 + armW / 2), 24, 0],
      size: [armW + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [40, 32],
      parent: 'body',
      bendOffset: 6,
      outer: true,
    },
    {
      name: 'left_sleeve',
      joint: [4 + armW / 2, 24, 0],
      size: [armW + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [48, 48],
      parent: 'body',
      bendOffset: 6,
      outer: true,
    },
    { name: 'right_leg', joint: [-2, 12, 0], size: [4, 12, 4], uv: [0, 16], parent: null, bendOffset: 6 },
    { name: 'left_leg', joint: [2, 12, 0], size: [4, 12, 4], uv: [16, 48], parent: null, bendOffset: 6 },
    {
      name: 'right_pants',
      joint: [-2, 12, 0],
      size: [4 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [0, 32],
      parent: null,
      bendOffset: 6,
      outer: true,
    },
    {
      name: 'left_pants',
      joint: [2, 12, 0],
      size: [4 + limbGrow * 2, 12 + limbGrow * 2, 4 + limbGrow * 2],
      uv: [0, 48],
      parent: null,
      bendOffset: 6,
      outer: true,
    },
  ]
  return defs
}

function poseForLimb(name: string, pose: CharacterPose): PartPose {
  const map: Record<string, string> = {
    jacket: 'body',
    hat: 'hat',
    right_sleeve: 'right_arm',
    left_sleeve: 'left_arm',
    right_pants: 'right_leg',
    left_pants: 'left_leg',
  }
  const key = map[name] ?? name
  return pose.parts[key] ?? EMPTY_POSE()
}

/**
 * Local limb box with joint at origin, extending down -Y.
 * Head extends upward +Y from neck joint.
 */
function localCorners(name: string, size: Vec3): Vec3[] {
  const [w, h, d] = size
  const hw = w / 2
  const hd = d / 2
  if (name === 'head' || name === 'hat') {
    // Neck at y=0, head goes up to +h
    return [
      [-hw, 0, -hd],
      [hw, 0, -hd],
      [hw, h, -hd],
      [-hw, h, -hd],
      [-hw, 0, hd],
      [hw, 0, hd],
      [hw, h, hd],
      [-hw, h, hd],
    ]
  }
  // Arms/legs/body: joint at top y=0, extend to -h
  return [
    [-hw, -h, -hd],
    [hw, -h, -hd],
    [hw, 0, -hd],
    [-hw, 0, -hd],
    [-hw, -h, hd],
    [hw, -h, hd],
    [hw, 0, hd],
    [-hw, 0, hd],
  ]
}

function applyBend(points: Vec3[], bend: Vec3, bendOffset: number, headLike: boolean): Vec3[] {
  if (Math.abs(bend[0]) + Math.abs(bend[1]) + Math.abs(bend[2]) < 1e-4) return points
  const pivotY = headLike ? bendOffset : -bendOffset
  const bendMat = matRotateEuler(bend[0], bend[1], bend[2])
  return points.map((p) => {
    const beyond = headLike ? p[1] > pivotY + 1e-4 : p[1] < pivotY - 1e-4
    if (!beyond) return p
    const local = sub(p, [0, pivotY, 0])
    return add(transformPoint(bendMat, local), [0, pivotY, 0])
  })
}

function partMatrix(part: PartPose, joint: Vec3): number[] {
  return mulMat(
    matTranslate(joint[0] + part.pos[0], joint[1] + part.pos[1], joint[2] + part.pos[2]),
    mulMat(matRotateEuler(part.rot[0], part.rot[1], part.rot[2]), matScale(part.scale[0], part.scale[1], part.scale[2])),
  )
}

type RgbaImage = { width: number; height: number; data: Uint8ClampedArray }

async function decodePng(bytes: Uint8Array): Promise<RgbaImage | null> {
  try {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bitmap, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    bitmap.close()
    return { width: image.width, height: image.height, data: image.data }
  } catch {
    return null
  }
}

function sampleAt(
  image: RgbaImage | null,
  u: number,
  v: number,
): [number, number, number, number] | null {
  if (!image) return [0.72, 0.74, 0.78, 1]
  const scale = parseSkinAtlas(image.width, image.height)?.scale ?? image.width / 64
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(u * scale)))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(v * scale)))
  const i = (y * image.width + x) * 4
  const a = image.data[i + 3] / 255
  if (a < 0.08) return null
  return [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255, a]
}

/** UV corners matching faceIndices winding for each face (pixel space on 64×64). */
function faceUvPixelCorners(
  fi: number,
  rect: { u0: number; v0: number; u1: number; v1: number },
): [number, number][] {
  const u0 = rect.u0
  const u1 = rect.u1
  const v0 = rect.v0
  const v1 = rect.v1
  const tl: [number, number] = [u0, v0]
  const tr: [number, number] = [u1, v0]
  const br: [number, number] = [u1, v1]
  const bl: [number, number] = [u0, v1]
  switch (fi) {
    case 0:
      return [bl, tl, tr, br]
    case 1:
      return [br, bl, tl, tr]
    case 2:
      return [bl, br, tr, tl]
    case 3:
      return [tl, tr, br, bl]
    case 4:
      return [bl, br, tr, tl]
    default:
      return [br, tr, tl, bl]
  }
}

/** Java skin box face UVs: right, left, top, bottom, front, back — matching localCorners index order. */
function faceUvRects(
  uv: [number, number],
  size: Vec3,
): { u0: number; v0: number; u1: number; v1: number }[] {
  const [w, h, d] = size.map((n) => Math.max(1, Math.round(n))) as Vec3
  const [u, v] = uv
  return [
    { u0: u + d + w, v0: v + d, u1: u + d + w + d, v1: v + d + h }, // +X right
    { u0: u, v0: v + d, u1: u + d, v1: v + d + h }, // -X left
    { u0: u + d, v0: v, u1: u + d + w, v1: v + d }, // +Y top
    { u0: u + d + w, v0: v, u1: u + d + w + w, v1: v + d }, // -Y bottom
    { u0: u + d, v0: v + d, u1: u + d + w, v1: v + d + h }, // +Z front
    { u0: u + d + w + d, v0: v + d, u1: u + d + w + d + w, v1: v + d + h }, // -Z back
  ]
}

function averageFaceColor(
  image: RgbaImage | null,
  rect: { u0: number; v0: number; u1: number; v1: number },
): [number, number, number] | null {
  if (!image) return [0.72, 0.74, 0.78]
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let n = 0
  const uSteps = Math.max(2, Math.ceil(Math.abs(rect.u1 - rect.u0)))
  const vSteps = Math.max(2, Math.ceil(Math.abs(rect.v1 - rect.v0)))
  for (let yi = 0; yi <= vSteps; yi += 1) {
    for (let xi = 0; xi <= uSteps; xi += 1) {
      const u = rect.u0 + ((rect.u1 - rect.u0) * xi) / uSteps
      const v = rect.v0 + ((rect.v1 - rect.v0) * yi) / vSteps
      const sampled = sampleAt(image, u, v)
      if (!sampled) continue
      r += sampled[0]
      g += sampled[1]
      b += sampled[2]
      a += sampled[3]
      n += 1
    }
  }
  if (n === 0 || a / n < 0.08) return null
  return [r / n, g / n, b / n]
}

/** UV corner order matching faceIndices winding (OpenGL V-up). */
function faceUvCornersFor(
  fi: number,
  rect: { u0: number; v0: number; u1: number; v1: number },
  layoutH = 64,
): [number, number][] {
  return faceUvPixelCorners(fi, rect).map(([u, v]) => [u / 64, 1 - v / layoutH])
}

/**
 * Build a posed human character mesh (Mine-imator timeline pose at frame 0) as OBJ+MTL.
 * Emits UVs + map_Kd so voxelize samples the real skin texture (not flat face averages).
 */
export async function characterPoseToObj(
  skinBytes: Uint8Array,
  pose: CharacterPose,
  textureFileName: string | null,
  outerLayer = true,
): Promise<MimodelConversion & { poseSummary: string }> {
  const image = await decodePng(skinBytes)
  const atlas = image ? parseSkinAtlas(image.width, image.height) : null
  if (image && !atlas) {
    throw new Error(skinSizeHint(image.width, image.height))
  }
  const layoutH = atlas?.layoutH ?? 64
  const texName = textureFileName ? basename(textureFileName) : 'skin.png'
  const obj: string[] = ['# Posed Mine-imator character', 'mtllib model.mtl']
  const mtl: string[] = [
    '# Posed Mine-imator character',
    'newmtl skin',
    // Neutral Kd — colours come from map_Kd / vertex samples, never plain white fill.
    'Kd 0.8500 0.8500 0.8500',
    `map_Kd ${texName}`,
    '',
    'newmtl skin_overlay',
    'Kd 0.8500 0.8500 0.8500',
    `map_Kd ${texName}`,
    '',
  ]
  let vertexCount = 0
  let texCount = 0
  let shapeCount = 0
  const posedParts: string[] = []

  const bodyPose = pose.parts.body ?? EMPTY_POSE()
  const bodyJoint: Vec3 = [0, 24, 0]

  // Face corner index sets into localCorners order (0..7).
  const faceIndices = [
    [1, 2, 6, 5], // +X
    [0, 4, 7, 3], // -X
    [3, 2, 6, 7], // +Y
    [0, 1, 5, 4], // -Y
    [4, 5, 6, 7], // +Z
    [0, 3, 2, 1], // -Z
  ]

  for (const limb of limbDefs(pose.slimArms)) {
    if (limb.outer && !outerLayer) continue
    const partPose = poseForLimb(limb.name, pose)
    if (
      Math.abs(partPose.rot[0]) + Math.abs(partPose.rot[1]) + Math.abs(partPose.rot[2])
      + Math.abs(partPose.bend[0]) + Math.abs(partPose.bend[1]) + Math.abs(partPose.bend[2])
      > 0.05
    ) {
      posedParts.push(limb.name)
    }

    const headLike = limb.name === 'head' || limb.name === 'hat'
    let corners = localCorners(limb.name, limb.size)
    corners = applyBend(corners, partPose.bend, limb.bendOffset, headLike)

    let localMat = partMatrix(partPose, limb.joint)
    if (limb.parent === 'body' || limb.parent === 'head') {
      const bodyPoseOnly = mulMat(
        matTranslate(bodyJoint[0], bodyJoint[1], bodyJoint[2]),
        mulMat(
          matRotateEuler(bodyPose.rot[0], bodyPose.rot[1], bodyPose.rot[2]),
          matTranslate(-bodyJoint[0], -bodyJoint[1], -bodyJoint[2]),
        ),
      )
      localMat = mulMat(bodyPoseOnly, localMat)
      if (limb.parent === 'head') {
        const headPose = pose.parts.head ?? EMPTY_POSE()
        const headJoint: Vec3 = [0, 24, 0]
        const headOnly = mulMat(
          matTranslate(headJoint[0], headJoint[1], headJoint[2]),
          mulMat(
            matRotateEuler(headPose.rot[0], headPose.rot[1], headPose.rot[2]),
            matTranslate(-headJoint[0], -headJoint[1], -headJoint[2]),
          ),
        )
        localMat = mulMat(bodyPoseOnly, mulMat(headOnly, partMatrix(partPose, limb.joint)))
      }
    } else if (limb.name === 'body' || limb.name === 'jacket') {
      localMat = partMatrix(bodyPose, limb.joint)
    }

    const rootMat = mulMat(
      matTranslate(pose.root.pos[0], pose.root.pos[1], pose.root.pos[2]),
      mulMat(
        matRotateEuler(pose.root.rot[0], pose.root.rot[1], pose.root.rot[2]),
        matScale(pose.root.scale[0], pose.root.scale[1], pose.root.scale[2]),
      ),
    )
    const world = corners.map((c) => transformPoint(rootMat, transformPoint(localMat, c)))
    const uvSize: Vec3 = [
      limb.name.includes('arm') || limb.name.includes('sleeve')
        ? pose.slimArms ? 3 : 4
        : limb.name.includes('leg') || limb.name.includes('pants')
          ? 4
          : 8,
      limb.name === 'head' || limb.name === 'hat' ? 8 : 12,
      limb.name === 'head' || limb.name === 'hat' ? 8 : 4,
    ]
    const rects = faceUvRects(limb.uv, uvSize)

    obj.push(`o ${limb.name}`, `usemtl ${limb.outer ? 'skin_overlay' : 'skin'}`)
    let emittedFaces = 0
    for (let fi = 0; fi < 6; fi += 1) {
      // Skip fully transparent overlay faces (common on unused outer layers).
      if (limb.outer && !averageFaceColor(image, rects[fi])) continue
      const idx = faceIndices[fi]
      const verts = idx.map((corner) => world[corner])
      const uvPix = faceUvPixelCorners(fi, rects[fi])
      const uvs = faceUvCornersFor(fi, rects[fi], layoutH)
      for (let vi = 0; vi < 4; vi += 1) {
        const [x, y, z] = verts[vi]
        const sampled = sampleAt(image, uvPix[vi][0], uvPix[vi][1])
          ?? [0.72, 0.74, 0.78, 1]
        obj.push(
          `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${sampled[0].toFixed(4)} ${sampled[1].toFixed(4)} ${sampled[2].toFixed(4)}`,
        )
      }
      for (const [u, v] of uvs) {
        obj.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`)
      }
      const a = vertexCount + 1
      const b = vertexCount + 2
      const c = vertexCount + 3
      const d = vertexCount + 4
      const ta = texCount + 1
      const tb = texCount + 2
      const tc = texCount + 3
      const td = texCount + 4
      obj.push(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`, `f ${a}/${ta} ${c}/${tc} ${d}/${td}`)
      vertexCount += 4
      texCount += 4
      emittedFaces += 1
    }
    if (emittedFaces > 0) shapeCount += 1
  }

  const uniquePosed = [...new Set(posedParts)]
  return {
    objBytes: new TextEncoder().encode(`${obj.join('\n')}\n`),
    mtlBytes: new TextEncoder().encode(`${mtl.join('\n')}\n`),
    textureFileName: texName,
    shapeCount,
    poseSummary:
      uniquePosed.length > 0
        ? `posed: ${uniquePosed.join(', ')}`
        : 'rest pose',
  }
}

