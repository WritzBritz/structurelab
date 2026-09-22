/** Blockbench .bbmodel → OBJ cubes or Minecraft skin statue. */

import { basename } from '../objAssets'
import type { CharacterPose, PartPose } from '../characterPose'
import type { ModelFormat } from './types'

export const bbmodelFormat: ModelFormat = {
  id: 'bbmodel',
  label: 'Blockbench model',
  role: 'primary',
  extensions: ['bbmodel'],
  priority: 100,
  matches: (fileName) => /\.bbmodel$/i.test(fileName),
}

export function isBbmodelFileName(name: string): boolean {
  return bbmodelFormat.matches(name)
}

type JsonMap = Record<string, unknown>

export type BbmodelConversion = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textureFileName: string | null
  shapeCount: number
}

export type BbmodelSkinImport = {
  kind: 'skin'
  textureBytes: Uint8Array
  textureFileName: string
  slimArms: boolean
  pose: CharacterPose
  sourceLabel: string
}

export type BbmodelCubeImport = {
  kind: 'cubes'
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textureFileName: string | null
  textureBytes: Uint8Array | null
  shapeCount: number
  sourceLabel: string
}

export type BbmodelImport = BbmodelSkinImport | BbmodelCubeImport

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

function vec3(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const arr = asArray(value)
  return [
    num(arr[0], fallback[0]),
    num(arr[1], fallback[1]),
    num(arr[2], fallback[2]),
  ]
}

function vec2(value: unknown, fallback: [number, number] = [0, 0]): [number, number] {
  const arr = asArray(value)
  return [num(arr[0], fallback[0]), num(arr[1], fallback[1])]
}

function parseJson(bytes: Uint8Array): JsonMap {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const parsed = JSON.parse(text) as unknown
  const map = asMap(parsed)
  if (!map) throw new Error('Invalid .bbmodel (expected a JSON object)')
  return map
}

function dataUrlToBytes(source: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(source)
  if (!match) return null
  const isBase64 = Boolean(match[2])
  const payload = match[3]
  if (isBase64) {
    const bin = atob(payload)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

type FaceKey = 'north' | 'east' | 'south' | 'west' | 'up' | 'down'

/** Blockbench face → cube corner indices (from/to box, Y-up). */
const FACE_CORNERS: Record<FaceKey, [number, number, number, number]> = {
  north: [1, 0, 3, 2],
  south: [4, 5, 6, 7],
  west: [0, 4, 7, 3],
  east: [5, 1, 2, 6],
  up: [3, 2, 6, 7],
  down: [4, 5, 1, 0],
}

function boxCorners(from: [number, number, number], to: [number, number, number]): [number, number, number][] {
  const x0 = Math.min(from[0], to[0])
  const y0 = Math.min(from[1], to[1])
  const z0 = Math.min(from[2], to[2])
  const x1 = Math.max(from[0], to[0])
  const y1 = Math.max(from[1], to[1])
  const z1 = Math.max(from[2], to[2])
  return [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
}

function rotatePoint(
  p: [number, number, number],
  origin: [number, number, number],
  rotation: [number, number, number],
): [number, number, number] {
  const [rx, ry, rz] = rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]
  let x = p[0] - origin[0]
  let y = p[1] - origin[1]
  let z = p[2] - origin[2]
  if (rx) {
    const c = Math.cos(rx)
    const s = Math.sin(rx)
    const ny = y * c - z * s
    const nz = y * s + z * c
    y = ny
    z = nz
  }
  if (ry) {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    const nx = x * c + z * s
    const nz = -x * s + z * c
    x = nx
    z = nz
  }
  if (rz) {
    const c = Math.cos(rz)
    const s = Math.sin(rz)
    const nx = x * c - y * s
    const ny = x * s + y * c
    x = nx
    y = ny
  }
  return [x + origin[0], y + origin[1], z + origin[2]]
}

function uvCorners(
  uv: [number, number, number, number],
  texW: number,
  texH: number,
  rotation = 0,
): [number, number][] {
  const u0 = uv[0] / texW
  const v0 = 1 - uv[1] / texH
  const u1 = uv[2] / texW
  const v1 = 1 - uv[3] / texH
  let corners: [number, number][] = [
    [u0, v1],
    [u1, v1],
    [u1, v0],
    [u0, v0],
  ]
  const turns = ((Math.round(rotation / 90) % 4) + 4) % 4
  for (let i = 0; i < turns; i += 1) {
    corners = [corners[3], corners[0], corners[1], corners[2]]
  }
  return corners
}

function boxUvFaceRect(
  uvOffset: [number, number],
  size: [number, number, number],
  face: FaceKey,
): [number, number, number, number] {
  const w = Math.max(1e-6, Math.abs(size[0]))
  const h = Math.max(1e-6, Math.abs(size[1]))
  const d = Math.max(1e-6, Math.abs(size[2]))
  const [u, v] = uvOffset
  switch (face) {
    case 'east':
      return [u + d + w, v + d, u + d + w + d, v + d + h]
    case 'west':
      return [u, v + d, u + d, v + d + h]
    case 'up':
      return [u + d, v, u + d + w, v + d]
    case 'down':
      return [u + d + w, v, u + d + w + w, v + d]
    case 'south':
      return [u + d, v + d, u + d + w, v + d + h]
    case 'north':
    default:
      return [u + d + w + d, v + d, u + d + w + d + w, v + d + h]
  }
}

function emptyPartPose(): PartPose {
  return {
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    bend: [0, 0, 0],
    scale: [1, 1, 1],
  }
}

/** Map Blockbench outliner bone names → Mine-imator / statue part keys. */
function poseKeyForGroup(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, string> = {
    head: 'head',
    hat: 'head',
    body: 'body',
    torso: 'body',
    chest: 'body',
    right_arm: 'right_arm',
    rightarm: 'right_arm',
    arm_right: 'right_arm',
    left_arm: 'left_arm',
    leftarm: 'left_arm',
    arm_left: 'left_arm',
    right_leg: 'right_leg',
    rightleg: 'right_leg',
    leg_right: 'right_leg',
    left_leg: 'left_leg',
    leftleg: 'left_leg',
    leg_left: 'left_leg',
    // Waist is only a parent bone in BB skin rigs — skip.
  }
  return aliases[key] ?? null
}

/**
 * Blockbench skin rigs face +Z (character's right on +X). Our statue / Minecraft
 * player space faces −Z (right on −X). Mirror yaw/roll so named limbs keep the
 * authored swing after the X flip.
 */
function mirrorBbRotationForMinecraft(
  rot: [number, number, number],
): [number, number, number] {
  return [rot[0], -rot[1], -rot[2]]
}

function collectOutlinerGroups(nodes: unknown[]): JsonMap[] {
  const groups: JsonMap[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node === 'string') return
    const map = asMap(node)
    if (!map) return
    if (asString(map.name)) groups.push(map)
    for (const child of asArray(map.children)) walk(child)
  }
  for (const node of nodes) walk(node)
  return groups
}

/** Cubes may live in `elements` or be embedded in older outliner trees. */
function collectCubeElements(root: JsonMap): JsonMap[] {
  const byUuid = new Map<string, JsonMap>()
  const push = (el: JsonMap | null) => {
    if (!el) return
    const type = asString(el.type) ?? 'cube'
    if (type !== 'cube' && el.from == null) return
    if (el.from == null || el.to == null) return
    const uuid = asString(el.uuid)
    if (uuid) byUuid.set(uuid, el)
    else byUuid.set(`anon-${byUuid.size}`, el)
  }

  for (const el of asArray(root.elements).map(asMap)) push(el)

  const walk = (node: unknown) => {
    if (!node || typeof node === 'string') return
    const map = asMap(node)
    if (!map) return
    if (map.from != null && map.to != null) push(map)
    for (const child of asArray(map.children)) walk(child)
  }
  for (const node of asArray(root.outliner)) walk(node)

  return [...byUuid.values()]
}

function pickTexture(
  root: JsonMap,
  sidecarTextures: Record<string, Uint8Array>,
): { textureBytes: Uint8Array | null; textureFileName: string } {
  const textures = asArray(root.textures).map(asMap).filter(Boolean) as JsonMap[]
  let textureBytes: Uint8Array | null = null
  let textureFileName: string | null = null
  for (const tex of textures) {
    const name = asString(tex.name) ?? asString(tex.id) ?? 'texture.png'
    const fileName = name.toLowerCase().endsWith('.png') ? name : `${name}.png`
    const source = asString(tex.source)
    if (source?.startsWith('data:')) {
      textureBytes = dataUrlToBytes(source)
      textureFileName = basename(fileName)
      break
    }
    const pathName = basename(asString(tex.path) ?? asString(tex.relative_path) ?? fileName)
    const sidecar = sidecarTextures[pathName.toLowerCase()] ?? sidecarTextures[fileName.toLowerCase()]
    if (sidecar) {
      textureBytes = sidecar
      textureFileName = pathName
      break
    }
    if (!textureFileName) textureFileName = pathName
  }
  return { textureBytes, textureFileName: textureFileName ?? 'texture.png' }
}

function isSkinProject(root: JsonMap, cubeCount: number): boolean {
  const meta = asMap(root.meta)
  const format = (asString(meta?.model_format) ?? asString(root.model_format) ?? '').toLowerCase()
  if (format === 'skin') return true
  if (cubeCount > 0) return false
  // Skin projects omit `elements`; geometry comes from the player template.
  return Boolean(root.skin_model || root.skin_pose || asString(root.skin_model))
}

function poseFromOutliner(root: JsonMap, slimArms: boolean): CharacterPose {
  const pose: CharacterPose = {
    slimArms,
    root: emptyPartPose(),
    parts: {},
  }
  for (const group of collectOutlinerGroups(asArray(root.outliner))) {
    const name = asString(group.name)
    if (!name) continue
    const key = poseKeyForGroup(name)
    if (!key) continue
    const rot = vec3(group.rotation)
    if (Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]) < 1e-6) {
      continue
    }
    const part = emptyPartPose()
    part.rot = mirrorBbRotationForMinecraft(rot)
    pose.parts[key] = part
  }
  return pose
}

function slimFromSkinModel(root: JsonMap): boolean {
  const model = (asString(root.skin_model) ?? '').toLowerCase()
  return model.includes('alex') || model.includes('slim')
}

/**
 * Convert a Blockbench project (.bbmodel) into OBJ + MTL.
 * Embedded texture `source` data-URLs are preferred; otherwise `textureFileName` is returned for sidecar lookup.
 * @deprecated Prefer {@link importBbmodel} which also handles skin projects.
 */
export function bbmodelToObj(
  bbmodelBytes: Uint8Array,
  sidecarTextures: Record<string, Uint8Array> = {},
): BbmodelConversion & { textureBytes: Uint8Array | null } {
  const imported = importBbmodel(bbmodelBytes, sidecarTextures)
  if (imported.kind === 'skin') {
    throw new Error(
      'This Blockbench file is a Minecraft skin project (no cubes). Import it as a skin statue instead.',
    )
  }
  return {
    objBytes: imported.objBytes,
    mtlBytes: imported.mtlBytes,
    textureFileName: imported.textureFileName,
    textureBytes: imported.textureBytes,
    shapeCount: imported.shapeCount,
  }
}

/** Import any supported .bbmodel (cube mesh or Minecraft skin editor project). */
export function importBbmodel(
  bbmodelBytes: Uint8Array,
  sidecarTextures: Record<string, Uint8Array> = {},
): BbmodelImport {
  const root = parseJson(bbmodelBytes)
  const cubes = collectCubeElements(root)
  const { textureBytes, textureFileName } = pickTexture(root, sidecarTextures)

  if (isSkinProject(root, cubes.length)) {
    if (!textureBytes || textureBytes.length === 0) {
      throw new Error(
        'Blockbench skin project has no embedded texture. Drop the skin PNG with the .bbmodel, or re-save with the texture embedded.',
      )
    }
    const slimArms = slimFromSkinModel(root)
    const pose = poseFromOutliner(root, slimArms)
    return {
      kind: 'skin',
      textureBytes,
      textureFileName,
      slimArms,
      pose,
      sourceLabel: `${textureFileName} · Blockbench skin${slimArms ? ' (slim)' : ''}`,
    }
  }

  const resolution = asMap(root.resolution)
  const texW = Math.max(1, num(resolution?.width, 16))
  const texH = Math.max(1, num(resolution?.height, 16))
  const boxUvDefault = Boolean(root.box_uv ?? asMap(root.meta)?.box_uv)

  const obj: string[] = ['# Converted from Blockbench .bbmodel', 'mtllib model.mtl']
  const mtl: string[] = [
    '# Converted from Blockbench .bbmodel',
    'newmtl atlas',
    'Kd 1.0000 1.0000 1.0000',
    `map_Kd ${textureFileName}`,
    '',
  ]

  let vertexCount = 0
  let texCount = 0
  let shapeCount = 0

  for (const el of cubes) {
    const from = vec3(el.from)
    const to = vec3(el.to)
    if (
      Math.abs(to[0] - from[0]) < 1e-8
      && Math.abs(to[1] - from[1]) < 1e-8
      && Math.abs(to[2] - from[2]) < 1e-8
    ) {
      continue
    }
    const origin = vec3(el.origin, [
      (from[0] + to[0]) / 2,
      (from[1] + to[1]) / 2,
      (from[2] + to[2]) / 2,
    ])
    const rotation = vec3(el.rotation)
    const inflate = num(el.inflate, 0)
    const inflatedFrom: [number, number, number] = [
      from[0] - inflate,
      from[1] - inflate,
      from[2] - inflate,
    ]
    const inflatedTo: [number, number, number] = [
      to[0] + inflate,
      to[1] + inflate,
      to[2] + inflate,
    ]
    const corners = boxCorners(inflatedFrom, inflatedTo).map((p) =>
      rotatePoint(p, origin, rotation),
    )
    const size: [number, number, number] = [
      inflatedTo[0] - inflatedFrom[0],
      inflatedTo[1] - inflatedFrom[1],
      inflatedTo[2] - inflatedFrom[2],
    ]
    const useBoxUv = el.box_uv != null ? Boolean(el.box_uv) : boxUvDefault
    const uvOffset = vec2(el.uv_offset)
    const faces = asMap(el.faces) ?? {}
    const name = asString(el.name) ?? `cube_${shapeCount + 1}`

    obj.push(`o ${name}`, 'usemtl atlas')
    let emitted = 0
    for (const face of Object.keys(FACE_CORNERS) as FaceKey[]) {
      const faceData = asMap(faces[face])
      if (faceData && faceData.texture === null) continue
      let uvRect: [number, number, number, number]
      let faceRot = 0
      if (faceData && Array.isArray(faceData.uv) && faceData.uv.length >= 4) {
        const raw = faceData.uv as unknown[]
        uvRect = [num(raw[0]), num(raw[1]), num(raw[2]), num(raw[3])]
        faceRot = num(faceData.rotation, 0)
      } else if (useBoxUv) {
        uvRect = boxUvFaceRect(uvOffset, size, face)
      } else {
        continue
      }
      const idx = FACE_CORNERS[face]
      const verts = idx.map((i) => corners[i])
      const uvs = uvCorners(uvRect, texW, texH, faceRot)
      for (const [x, y, z] of verts) {
        obj.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`)
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
      emitted += 1
    }
    if (emitted > 0) shapeCount += 1
  }

  if (shapeCount === 0) {
    throw new Error(
      'Blockbench model has no cubes to convert. Free/Java models need cube elements; skin projects are imported as statues automatically.',
    )
  }

  return {
    kind: 'cubes',
    objBytes: new TextEncoder().encode(`${obj.join('\n')}\n`),
    mtlBytes: new TextEncoder().encode(`${mtl.join('\n')}\n`),
    textureFileName,
    textureBytes,
    shapeCount,
    sourceLabel: `Blockbench · ${shapeCount} cubes`,
  }
}
