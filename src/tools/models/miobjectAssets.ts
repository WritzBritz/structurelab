/** Mine-imator 2.0.x .miobject / .mimodel helpers. */

import { decodeImageRgba } from './decodeImage'
import { basename } from './objAssets'

export type MiobjectKind = 'char' | 'model' | 'unsupported'

export type MiobjectDependencies = {
  kind: MiobjectKind
  /** Built-in character model name (e.g. human), when kind === 'char'. */
  characterModel: string | null
  slimArms: boolean
  /** Skin / texture PNG basenames referenced by the export. */
  textureFileNames: string[]
  /** Companion .mimodel basenames for custom model templates. */
  modelFileNames: string[]
  label: string
}

type JsonMap = Record<string, unknown>

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

function vec3(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback
  return [
    Number(value[0]) || 0,
    Number(value[1]) || 0,
    Number(value[2]) || 0,
  ]
}

/**
 * Mimodel JSON stores Minecraft-style Y-up [x,y,z].
 * Modelbench/Mine-imator load via point3D(x, z, y) into Z-up engine space.
 * See Modelbench `value_get_point3D`.
 */
function jsonToEngine(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const v = vec3(value, fallback)
  return [v[0], v[2], v[1]]
}

/** Engine Z-up → OBJ/Minecraft Y-up (inverse of jsonToEngine). */
function engineToYUp(p: [number, number, number]): [number, number, number] {
  return [p[0], p[2], p[1]]
}

function vec2(value: unknown, fallback: [number, number] = [0, 0]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback
  return [Number(value[0]) || 0, Number(value[1]) || 0]
}

export function parseMiobjectText(text: string): JsonMap {
  const parsed = JSON.parse(text) as unknown
  const map = asMap(parsed)
  if (!map) throw new Error('Invalid .miobject (expected a JSON object)')
  return map
}

export function scanMiobjectDependencies(miobjectBytes: Uint8Array): MiobjectDependencies {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(miobjectBytes)
  const root = parseMiobjectText(text)
  const templates = asArray(root.templates).map(asMap).filter(Boolean) as JsonMap[]
  const resources = asArray(root.resources).map(asMap).filter(Boolean) as JsonMap[]

  const textureFileNames: string[] = []
  const modelFileNames: string[] = []
  for (const resource of resources) {
    const filename = asString(resource.filename)
    if (!filename) continue
    const type = asString(resource.type)?.toLowerCase() ?? ''
    if (type === 'model' || /\.mimodel$/i.test(filename)) {
      modelFileNames.push(basename(filename))
    } else if (
      type === 'skin'
      || type === 'texture'
      || type === 'downloadable_skin'
      || /\.(png|jpg|jpeg|webp|bmp)$/i.test(filename)
    ) {
      textureFileNames.push(basename(filename))
    }
  }

  const charTemplate = templates.find((entry) => asString(entry.type) === 'char')
  const modelTemplate = templates.find((entry) => asString(entry.type) === 'model')

  if (charTemplate) {
    const model = asMap(charTemplate.model)
    const state = asMap(model?.state)
    const modelName = asString(model?.name) ?? 'human'
    const slimArms = asString(state?.type)?.toLowerCase() === 'slim'
    return {
      kind: 'char',
      characterModel: modelName,
      slimArms,
      textureFileNames: [...new Set(textureFileNames)],
      modelFileNames: [],
      label: `${modelName}${slimArms ? ' (slim)' : ''}`,
    }
  }

  if (modelTemplate || modelFileNames.length > 0) {
    // Template.model may be a resource id — resolve to filename when possible.
    const modelRef = asString(modelTemplate?.model)
    if (modelRef && !/\.mimodel$/i.test(modelRef)) {
      const hit = resources.find((resource) => asString(resource.id) === modelRef)
      const filename = asString(hit?.filename)
      if (filename) modelFileNames.push(basename(filename))
    } else if (modelRef && /\.mimodel$/i.test(modelRef)) {
      modelFileNames.push(basename(modelRef))
    }
    return {
      kind: 'model',
      characterModel: null,
      slimArms: false,
      textureFileNames: [...new Set(textureFileNames)],
      modelFileNames: [...new Set(modelFileNames)],
      label: modelFileNames[0] ?? 'custom model',
    }
  }

  return {
    kind: 'unsupported',
    characterModel: null,
    slimArms: false,
    textureFileNames: [...new Set(textureFileNames)],
    modelFileNames: [...new Set(modelFileNames)],
    label: 'unsupported Mine-imator object',
  }
}

export type MimodelPartPose = {
  pos: [number, number, number]
  rot: [number, number, number]
  bend: [number, number, number]
  scale: [number, number, number]
  /** Timeline VISIBLE — false hides Outline helpers (do not render). */
  visible?: boolean
}

export type MimodelPose = {
  root?: MimodelPartPose
  parts: Record<string, MimodelPartPose>
}

export type MimodelConversion = {
  objBytes: Uint8Array
  mtlBytes: Uint8Array
  textureFileName: string | null
  shapeCount: number
}

type RgbaImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Test/helper: supply a pre-decoded texture to skip canvas PNG decode. */
export type MimodelTextureOverride = {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** Decode PNG/JPEG/WebP/TGA/TIFF for UV sampling (main-thread canvas). */
export async function decodeTextureRgba(bytes: Uint8Array): Promise<RgbaImage | null> {
  return decodeImageRgba(bytes)
}

async function decodePngRgba(bytes: Uint8Array): Promise<RgbaImage | null> {
  return decodeTextureRgba(bytes)
}

function sampleRgba(image: RgbaImage, u: number, v: number): [number, number, number, number] {
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(u)))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(v)))
  const i = (y * image.width + x) * 4
  return [
    image.data[i] / 255,
    image.data[i + 1] / 255,
    image.data[i + 2] / 255,
    image.data[i + 3] / 255,
  ]
}

/** Average opaque texels in a UV rectangle (texture pixels). */
function averageUvRect(
  image: RgbaImage,
  textureSize: [number, number],
  u0: number,
  v0: number,
  uSize: number,
  vSize: number,
): [number, number, number] {
  const tw = textureSize[0] || image.width
  const th = textureSize[1] || image.height
  const x0 = Math.floor((u0 / tw) * image.width)
  const y0 = Math.floor((v0 / th) * image.height)
  const x1 = Math.max(x0 + 1, Math.ceil(((u0 + Math.max(uSize, 1)) / tw) * image.width))
  const y1 = Math.max(y0 + 1, Math.ceil(((v0 + Math.max(vSize, 1)) / th) * image.height))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [pr, pg, pb, pa] = sampleRgba(image, x, y)
      if (pa < 0.08) continue
      r += pr
      g += pg
      b += pb
      n += 1
    }
  }
  if (n === 0) return [0.72, 0.74, 0.78]
  return [r / n, g / n, b / n]
}

function colorForShape(
  shape: JsonMap,
  textureSize: [number, number],
  image: RgbaImage | null,
  uvSize: [number, number, number],
  plane = false,
): [number, number, number] {
  const blend = asString(shape.color_blend)
  if (blend && /^#?[0-9a-fA-F]{6}$/.test(blend)) {
    const hex = blend.replace('#', '')
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ]
  }
  if (!image) return [0.72, 0.74, 0.78]
  const uv = vec2(shape.uv)
  // Engine-space size: [width X, depth Y, height Z]
  const w = Math.max(1, Math.abs(uvSize[0]))
  const h = Math.max(1, Math.abs(uvSize[2]))
  // Modelbench: south (or plane patch) sits at the UV origin — size X×Z.
  void plane
  return averageUvRect(image, textureSize, uv[0], uv[1], w, h)
}

function thinnestAxis(w: number, h: number, d: number): 0 | 1 | 2 {
  if (h <= w && h <= d) return 1
  if (d <= w && d <= h) return 2
  return 0
}

/** Pixel UVs → OBJ 0–1 (V flipped for OpenGL / Modelbench export). */
function texUv(
  textureSize: [number, number],
  px: number,
  py: number,
): [number, number] {
  const tw = Math.max(textureSize[0], 1)
  const th = Math.max(textureSize[1], 1)
  return [px / tw, 1 - py / th]
}

type UvRect = { u0: number; v0: number; u1: number; v1: number }

/**
 * Modelbench box UV layout (see model_shape_generate_block).
 * size = engine extents [width X, depth Y, height Z].
 * Face order: +X east, -X west, +Y south, -Y north, +Z up, -Z down.
 */
function cubeFaceUvRects(uv: [number, number], size: [number, number, number]): UvRect[] {
  // GML keeps true texsize zeros (zero-thickness plates). Face extents use max(1,…)
  // only so side patches stay sampleable; up/down V offset uses raw depth d.
  const w = Math.max(0, Math.round(Math.abs(size[0])))
  const d = Math.max(0, Math.round(Math.abs(size[1])))
  const h = Math.max(0, Math.round(Math.abs(size[2])))
  const wu = Math.max(1, w)
  const du = Math.max(1, d)
  const hu = Math.max(1, h)
  const [u, v] = uv
  return [
    { u0: u + wu, v0: v, u1: u + wu + du, v1: v + hu }, // +X east
    { u0: u - du, v0: v, u1: u, v1: v + hu }, // -X west
    { u0: u, v0: v, u1: u + wu, v1: v + hu }, // +Y south
    { u0: u + wu + du, v0: v, u1: u + wu + du + wu, v1: v + hu }, // -Y north
    { u0: u, v0: v - d, u1: u + wu, v1: v }, // +Z up
    { u0: u + wu, v0: v - d, u1: u + wu + wu, v1: v }, // -Z down
  ]
}

/** Flip a face patch horizontally (Modelbench texture_mirror on one face). */
function mirrorUvRectU(rect: UvRect): UvRect {
  return { u0: rect.u1, v0: rect.v0, u1: rect.u0, v1: rect.v1 }
}

/**
 * Modelbench texture_mirror: swap east/west patches and mirror U on every face.
 */
function mirrorCubeFaceUvRects(rects: UvRect[]): UvRect[] {
  const out = rects.map(mirrorUvRectU)
  const east = out[0]
  out[0] = out[1]
  out[1] = east
  return out
}

/**
 * UV corner order matching cubeFaceIndices + Modelbench generate_block (pixel space).
 * Image V grows downward: "top" = smaller py (face UV origin), "bottom" = larger py.
 * Side faces: geometry +Z (up) must sample the top of the face patch (smaller py).
 * Insets half a texel so samples land inside the face patch (not the next cell).
 */
/** Exported for unit tests — UV corner order vs Modelbench face winding. */
export function faceUvPixelCorners(fi: number, rect: UvRect): [number, number][] {
  const uLo = Math.min(rect.u0, rect.u1)
  const uHi = Math.max(rect.u0, rect.u1)
  const vLo = Math.min(rect.v0, rect.v1)
  const vHi = Math.max(rect.v0, rect.v1)
  const inset = 0.5
  const left = uLo + inset
  const right = Math.max(left, uHi - inset)
  const top = vLo + inset
  const bottom = Math.max(top, vHi - inset)
  const tl: [number, number] = [left, top]
  const tr: [number, number] = [right, top]
  const br: [number, number] = [right, bottom]
  const bl: [number, number] = [left, bottom]
  switch (fi) {
    // Face verts [1,5,6,2] = BN,TN,TS,BS — Modelbench east end is TS,TN,BN,BS with tl,tr,br,bl
    case 0: // +X east
      return [br, tr, tl, bl]
    // Face verts [0,3,7,4] = BN,BS,TS,TN — reverse of Modelbench west TN,TS,BS,BN
    case 1: // -X west
      return [bl, br, tr, tl]
    // Face verts [3,2,6,7] = BL,BR,TR,TL — reverse of Modelbench south TL,TR,BR,BL
    case 2: // +Y south
      return [bl, br, tr, tl]
    // Face verts [0,4,5,1] = BN,TN,TS,BS? 0,4,5,1 = (x0,y0,z0),(x0,y0,z1),(x1,y0,z1),(x1,y0,z0)
    // Modelbench north: TS,TN,BN,BS wait — np3,np4,p4,p3 = 5,4,0,1 with tl,tr,br,bl
    case 3: // -Y north
      return [br, tr, tl, bl]
    // Face verts [4,5,6,7] — Modelbench up: tl,tr,br,bl
    case 4: // +Z up
      return [tl, tr, br, bl]
    // Face verts [0,1,2,3] — Modelbench down winding reverse of p1..p4 with bl,br,tr,tl
    default: // -Z down
      return [tl, tr, br, bl]
  }
}

function samplePixel(
  image: RgbaImage,
  textureSize: [number, number],
  px: number,
  py: number,
): [number, number, number] | null {
  const tw = Math.max(textureSize[0], 1)
  const th = Math.max(textureSize[1], 1)
  // Floor after scaling — px/py are already in texture_size pixel space.
  const x = Math.max(0, Math.min(image.width - 1, Math.floor((px / tw) * image.width)))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor((py / th) * image.height)))
  const i = (y * image.width + x) * 4
  if (image.data[i + 3] / 255 < 0.08) return null
  return [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255]
}

/**
 * Modelbench plane_3d only emits when alpha == 1 (`alpha < 1` → skip).
 * Integer texel coords (no +0.5) match surface_get_alpha_array sampling.
 */
function sampleOpaqueTexel(
  image: RgbaImage,
  textureSize: [number, number],
  texX: number,
  texY: number,
): [number, number, number] | null {
  const tw = Math.max(textureSize[0], 1)
  const th = Math.max(textureSize[1], 1)
  const x = Math.max(0, Math.min(image.width - 1, Math.floor((texX / tw) * image.width)))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor((texY / th) * image.height)))
  const i = (y * image.width + x) * 4
  if (image.data[i + 3] < 255) return null
  return [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255]
}

/** Modelbench alpha[ax, ay] — texture-space index into a flat W×H grid. */
function alphaAt(opaque: boolean[], pixW: number, pixH: number, ax: number, ay: number): boolean {
  if (ax < 0 || ay < 0 || ax >= pixW || ay >= pixH) return false
  return opaque[ax + ay * pixW] === true
}

/** Search nearby texels when the exact sample is transparent (common on UV edges). */
function samplePixelNear(
  image: RgbaImage,
  textureSize: [number, number],
  px: number,
  py: number,
): [number, number, number] | null {
  const hit = samplePixel(image, textureSize, px, py)
  if (hit) return hit
  for (const [dx, dy] of [
    [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as const) {
    const again = samplePixel(image, textureSize, px + dx, py + dy)
    if (again) return again
  }
  return null
}

function averageFaceColor(
  image: RgbaImage | null,
  textureSize: [number, number],
  rect: UvRect,
): [number, number, number] | null {
  if (!image) return [0.72, 0.74, 0.78]
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  // Inclusive texel range for the face patch [u0, u1) × [v0, v1).
  const uLo = Math.floor(Math.min(rect.u0, rect.u1))
  const uHi = Math.ceil(Math.max(rect.u0, rect.u1)) - 1
  const vLo = Math.floor(Math.min(rect.v0, rect.v1))
  const vHi = Math.ceil(Math.max(rect.v0, rect.v1)) - 1
  for (let y = vLo; y <= vHi; y += 1) {
    for (let x = uLo; x <= uHi; x += 1) {
      const sampled = samplePixel(image, textureSize, x + 0.5, y + 0.5)
      if (!sampled) continue
      r += sampled[0]
      g += sampled[1]
      b += sampled[2]
      n += 1
    }
  }
  if (n === 0) return null
  return [r / n, g / n, b / n]
}

function addVec(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function mulVec(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Match GameMaker `matrix_build` used by Mine-imator / Modelbench:
 * left-handed YXZ euler. Docs: order of operation is YXZ.
 * Positive GM angles are opposite typical RH formulas → negate degrees.
 *
 * Shape world transform (Modelbench el_update_shape + generate + render):
 *   local  = (from_noscale ∓ inflate) ⊙ scale     // scale BEFORE rotation
 *   mid    = R_YXZ(shape.rotation) * local         // pivot = shape origin
 *   world  = Parent * (mid + shape.position⊙parentScale)
 * i.e. Parent × T(pos) × R(rot) × local
 *
 * Blockbench mimodel_format.js only EXPORTS (negate X/Z from BB → mimodel).
 * Reading mimodels must follow Modelbench value_get_point3D (Y↔Z), not BB export.
 */
function rotateEulerXyz(
  point: [number, number, number],
  rotDeg: [number, number, number],
): [number, number, number] {
  let [x, y, z] = point
  // Left-handed: negate degrees so the existing RH sin/cos formulas match GM.
  const rx = degToRad(-rotDeg[0])
  const ry = degToRad(-rotDeg[1])
  const rz = degToRad(-rotDeg[2])
  // YXZ order (GM matrix_build): Ry → Rx → Rz
  if (ry !== 0) {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    const nx = x * c + z * s
    const nz = -x * s + z * c
    x = nx
    z = nz
  }
  if (rx !== 0) {
    const c = Math.cos(rx)
    const s = Math.sin(rx)
    const ny = y * c - z * s
    const nz = y * s + z * c
    y = ny
    z = nz
  }
  if (rz !== 0) {
    const c = Math.cos(rz)
    const s = Math.sin(rz)
    const nx = x * c - y * s
    const ny = x * s + y * c
    x = nx
    y = ny
  }
  return [x, y, z]
}

type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

function matIdentity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]
}

/** Column-major: parent * child (apply child first). Matches GM matrix_multiply. */
function matMul(parent: Mat4, child: Mat4): Mat4 {
  const out = matIdentity()
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        parent[0 * 4 + row] * child[col * 4 + 0]
        + parent[1 * 4 + row] * child[col * 4 + 1]
        + parent[2 * 4 + row] * child[col * 4 + 2]
        + parent[3 * 4 + row] * child[col * 4 + 3]
    }
  }
  return out
}

/**
 * Match GameMaker `matrix_build` used by Mine-imator:
 * left-handed YXZ euler, then scale, then translate (uniform scale ⇒ T·R·S ok).
 */
function matTRS(
  pos: [number, number, number],
  rotDeg: [number, number, number],
  scale: [number, number, number],
): Mat4 {
  const [sx, sy, sz] = scale
  // Build rotation by transforming basis (keeps YXZ + LH signs in one place).
  const xAxis = rotateEulerXyz([sx, 0, 0], rotDeg)
  const yAxis = rotateEulerXyz([0, sy, 0], rotDeg)
  const zAxis = rotateEulerXyz([0, 0, sz], rotDeg)
  return [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    zAxis[0], zAxis[1], zAxis[2], 0,
    pos[0], pos[1], pos[2], 1,
  ]
}

function matTransformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  return [x, y, z]
}

type BendInfo = {
  offset: number
  /** Which side of the offset bends: lower = toward -axis from offset. */
  lower: boolean
  /** Engine axis the bend splits along: 0=X, 1=Y, 2=Z. */
  axis: 0 | 1 | 2
  /** Engine-space bend axes enabled (JSON y↔z remapped). */
  axisEnabled: [boolean, boolean, boolean]
  /** Per-axis invert (JSON single invert applies to the remapped axis). */
  invert: [boolean, boolean, boolean]
  directionMin: [number, number, number]
  directionMax: [number, number, number]
}

/**
 * JSON bend axis labels remap like Modelbench model_load_part:
 * "x"→X, "z"→Y, "y"→Z (same Y↔Z swap as positions).
 */
function jsonBendAxisToEngine(label: string): 0 | 1 | 2 | null {
  const a = label.toLowerCase()
  if (a === 'x') return 0
  if (a === 'z') return 1
  if (a === 'y') return 2
  return null
}

function parseBend(part: JsonMap): BendInfo | null {
  const bend = asMap(part.bend)
  if (!bend) return null
  const offset = Number(bend.offset)
  if (!Number.isFinite(offset)) return null
  const which = (asString(bend.part) ?? 'lower').toLowerCase()
  let axis: 0 | 1 | 2 = 2
  if (which === 'left' || which === 'right') axis = 0
  else if (which === 'front' || which === 'back') axis = 1
  else axis = 2 // upper / lower → engine Z

  const axisEnabled: [boolean, boolean, boolean] = [false, false, false]
  const axisOrder: Array<0 | 1 | 2> = []
  const axisRaw = bend.axis
  if (typeof axisRaw === 'string') {
    const eng = jsonBendAxisToEngine(axisRaw)
    if (eng != null) {
      axisEnabled[eng] = true
      axisOrder.push(eng)
    }
  } else if (Array.isArray(axisRaw)) {
    for (const entry of axisRaw) {
      if (typeof entry !== 'string') continue
      const eng = jsonBendAxisToEngine(entry)
      if (eng == null) continue
      axisEnabled[eng] = true
      axisOrder.push(eng)
    }
  }
  if (axisOrder.length === 0) {
    // Default: allow the split-axis rotation (matches common arm/leg "x" bends).
    axisEnabled[0] = true
    axisOrder.push(0)
  }

  const directionMin: [number, number, number] = [-180, -180, -180]
  const directionMax: [number, number, number] = [180, 180, 180]
  const dMin = bend.direction_min
  const dMax = bend.direction_max
  if (typeof dMin === 'number' && axisOrder.length === 1) directionMin[axisOrder[0]] = dMin
  else if (Array.isArray(dMin)) {
    for (let i = 0; i < axisOrder.length && i < dMin.length; i += 1) {
      directionMin[axisOrder[i]] = Number(dMin[i]) || 0
    }
  }
  if (typeof dMax === 'number' && axisOrder.length === 1) directionMax[axisOrder[0]] = dMax
  else if (Array.isArray(dMax)) {
    for (let i = 0; i < axisOrder.length && i < dMax.length; i += 1) {
      directionMax[axisOrder[i]] = Number(dMax[i]) || 0
    }
  }

  const invert: [boolean, boolean, boolean] = [false, false, false]
  if ((typeof bend.invert === 'boolean' || typeof bend.invert === 'number') && axisOrder.length === 1) {
    invert[axisOrder[0]] = Boolean(bend.invert)
  } else if (Array.isArray(bend.invert)) {
    for (let i = 0; i < axisOrder.length && i < bend.invert.length; i += 1) {
      invert[axisOrder[i]] = Boolean(bend.invert[i])
    }
  }

  return {
    offset,
    lower: which === 'lower' || which === 'back' || which === 'left',
    axis,
    axisEnabled,
    invert,
    directionMin,
    directionMax,
  }
}

/** Clamp / invert / zero unused axes — Modelbench model_part_get_bend_matrix. */
function prepareBendAngles(
  info: BendInfo,
  bendDeg: [number, number, number],
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i += 1) {
    if (!info.axisEnabled[i]) continue
    let a = bendDeg[i]
    a = Math.min(info.directionMax[i], Math.max(info.directionMin[i], a))
    if (info.invert[i]) a *= -1
    out[i] = a
  }
  return out
}

/** T(offset) * R(bend) * T(-offset) along the bend split axis. */
function bendMatrix(info: BendInfo, bendDeg: [number, number, number]): Mat4 {
  const angles = prepareBendAngles(info, bendDeg)
  const pos: [number, number, number] = [0, 0, 0]
  pos[info.axis] = info.offset
  const neg: [number, number, number] = [0, 0, 0]
  neg[info.axis] = -info.offset
  return matMul(
    matTRS(pos, [0, 0, 0], [1, 1, 1]),
    matMul(
      matTRS([0, 0, 0], angles, [1, 1, 1]),
      matTRS(neg, [0, 0, 0], [1, 1, 1]),
    ),
  )
}

function bendPoint(
  point: [number, number, number],
  bend: BendInfo,
  bendDeg: [number, number, number],
): [number, number, number] {
  const onBentSide = bend.lower
    ? point[bend.axis] <= bend.offset + 1e-4
    : point[bend.axis] >= bend.offset - 1e-4
  if (!onBentSide) return point
  return matTransformPoint(bendMatrix(bend, bendDeg), point)
}

/**
 * Convert a Modelbench / Mine-imator .mimodel into Wavefront OBJ + MTL.
 * Applies hierarchy position/rotation/scale, optional timeline pose (rot/bend), and skin UVs.
 */
export async function mimodelToObj(
  mimodelBytes: Uint8Array,
  textureBytes: Uint8Array | null,
  textureFileName: string | null,
  pose: MimodelPose | null = null,
  textureOverride: MimodelTextureOverride | null = null,
): Promise<MimodelConversion> {
  const root = parseMiobjectText(new TextDecoder('utf-8', { fatal: false }).decode(mimodelBytes))
  const textureSize = vec2(root.texture_size, [64, 64]) as [number, number]
  const image: RgbaImage | null = textureOverride
    ? {
        width: textureOverride.width,
        height: textureOverride.height,
        data: textureOverride.data instanceof Uint8ClampedArray
          ? textureOverride.data
          : new Uint8ClampedArray(textureOverride.data),
      }
    : textureBytes
      ? await decodePngRgba(textureBytes)
      : null
  const parts = asArray(root.parts).map(asMap).filter(Boolean) as JsonMap[]

  const obj: string[] = ['# Converted from Mine-imator .mimodel', 'mtllib model.mtl']
  const mtl: string[] = ['# Converted from Mine-imator .mimodel']
  const mapKdName = textureFileName ? basename(textureFileName) : null
  if (mapKdName) {
    // Mid-grey Kd so a missing map_Kd never washes the mesh to white.
    // `skin` = first (base) layer; `skin_overlay` = second layer (hat/jacket/sleeves).
    mtl.push(`newmtl skin`, `Kd 0.72 0.74 0.78`, `map_Kd ${mapKdName}`, '')
    mtl.push(`newmtl skin_overlay`, `Kd 0.72 0.74 0.78`, `map_Kd ${mapKdName}`, '')
  }
  let vertexCount = 0
  let texCount = 0
  let shapeCount = 0
  let materialCount = 0
  let skippedFar = 0

  // Engine Z-up face corners into localCorners order (0..7).
  // 0=(x0,y0,z0) 1=(x1,y0,z0) 2=(x1,y1,z0) 3=(x0,y1,z0)
  // 4=(x0,y0,z1) 5=(x1,y0,z1) 6=(x1,y1,z1) 7=(x0,y1,z1)
  const cubeFaceIndices: [number, number, number, number][] = [
    [1, 5, 6, 2], // +X east
    [0, 3, 7, 4], // -X west
    [3, 2, 6, 7], // +Y south
    [0, 4, 5, 1], // -Y north
    [4, 5, 6, 7], // +Z up
    [0, 1, 2, 3], // -Z down
  ]

  const pushFace = (
    corners: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]],
    uvs: [[number, number], [number, number], [number, number], [number, number]] | null,
    vertColors: Array<[number, number, number] | null> | null,
    invert = false,
  ) => {
    // Modelbench vbuffer_add_triangle(invert): swap first two corners + UVs (flip winding).
    const order: [number, number, number, number] = invert ? [0, 3, 2, 1] : [0, 1, 2, 3]
    const qCorners = order.map((i) => corners[i]) as typeof corners
    const qUvs = uvs ? order.map((i) => uvs[i]) as NonNullable<typeof uvs> : null
    const qColors = vertColors ? order.map((i) => vertColors[i]) : null
    const base = vertexCount
    const tBase = texCount
    for (let i = 0; i < 4; i += 1) {
      const [x, y, z] = engineToYUp(qCorners[i])
      const col = qColors?.[i]
      if (col) {
        obj.push(
          `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${col[0].toFixed(4)} ${col[1].toFixed(4)} ${col[2].toFixed(4)}`,
        )
      } else {
        obj.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`)
      }
    }
    vertexCount += 4
    if (qUvs) {
      for (const [u, v] of qUvs) {
        obj.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`)
      }
      texCount += 4
      obj.push(
        `f ${base + 1}/${tBase + 1} ${base + 2}/${tBase + 2} ${base + 3}/${tBase + 3}`,
        `f ${base + 1}/${tBase + 1} ${base + 3}/${tBase + 3} ${base + 4}/${tBase + 4}`,
      )
    } else {
      obj.push(`f ${base + 1} ${base + 2} ${base + 3}`, `f ${base + 1} ${base + 3} ${base + 4}`)
    }
  }

  const emitBox = (
    corners: [number, number, number][],
    color: [number, number, number],
    name: string,
    uvOrigin: [number, number] | null,
    uvSize: [number, number, number],
    /** True paper plane shape (`type: plane`, not 3d): UV patch on thin faces. */
    plane: boolean,
    /**
     * Modelbench `3d`/EXTRUDE plane: geometry is a real box (thickness ≥ 1 unscaled).
     * Emit all six faces with the plane's UV patch (not a Minecraft box unwrap).
     */
    extrude3d = false,
    invert = false,
    textureMirror = false,
  ) => {
    for (const corner of corners) {
      if (
        !Number.isFinite(corner[0])
        || !Number.isFinite(corner[1])
        || !Number.isFinite(corner[2])
        || Math.abs(corner[0]) > 512
        || Math.abs(corner[1]) > 512
        || Math.abs(corner[2]) > 512
      ) {
        skippedFar += 1
        return
      }
    }
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const [x, y, z] of corners) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
    if (maxX - minX < 1e-6 && maxY - minY < 1e-6 && maxZ - minZ < 1e-6) return

    // corners: 0=(x0,y0,z0) 1=(x1,y0,z0) 2=(x1,y1,z0) 3=(x0,y1,z0)
    //          4=(x0,y0,z1) 5=(x1,y0,z1) 6=(x1,y1,z1) 7=(x0,y1,z1)
    const c = corners
    materialCount += 1

    // Second-layer (3d/extrude) shells use skin_overlay so voxelize can keep base
    // skin visible where the overlay atlas is empty.
    const matName = mapKdName ? (extrude3d ? 'skin_overlay' : 'skin') : `shape_${materialCount}`
    if (uvOrigin) {
      obj.push(`o ${name}_${materialCount}`, `usemtl ${matName}`)
      if (!mapKdName) {
        mtl.push(
          `newmtl shape_${materialCount}`,
          `Kd ${color[0].toFixed(4)} ${color[1].toFixed(4)} ${color[2].toFixed(4)}`,
          '',
        )
      }

      const w = Math.max(0.05, Math.abs(uvSize[0]))
      const h = Math.max(0.05, Math.abs(uvSize[1]))
      const d = Math.max(0.05, Math.abs(uvSize[2]))
      const thin = thinnestAxis(w, h, d)
      // Extruded 3d planes are solid shells — never treat as a 2-face sheet.
      const isFlat =
        !extrude3d
        && (plane || (Math.min(w, h, d) <= 1.05 && Math.min(w, h, d) / Math.max(w, h, d) < 0.25))

      const emitTexturedFace = (fi: number, rect: UvRect, idxs: [number, number, number, number]) => {
        const faceColor = averageFaceColor(image, textureSize, rect)
        // Skip fully transparent overlay faces (common on unused outer layers).
        if (image && !faceColor) return
        const fill = faceColor ?? color
        const pix = faceUvPixelCorners(fi, rect)
        const uvs = pix.map(([px, py]) => texUv(textureSize, px, py)) as [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ]
        const vertColors = pix.map((p) => {
          if (!image) return fill
          // Prefer a sample pulled toward the face centre — Minecraft face patches
          // often put hair/outline on UV corners while skin/eyes sit inside.
          const cu = (rect.u0 + rect.u1) * 0.5
          const cv = (rect.v0 + rect.v1) * 0.5
          const inward: [number, number] = [p[0] * 0.35 + cu * 0.65, p[1] * 0.35 + cv * 0.65]
          return (
            samplePixelNear(image, textureSize, inward[0], inward[1])
            ?? samplePixelNear(image, textureSize, p[0], p[1])
            ?? fill
          )
        })
        pushFace(
          [c[idxs[0]], c[idxs[1]], c[idxs[2]], c[idxs[3]]],
          uvs,
          vertColors,
          invert,
        )
      }

      if (extrude3d) {
        // Extruded 3d plane: full box; every face samples the plane UV patch
        // (Modelbench plane_3d uses one texel/patch per pixel box face).
        const nonThin = ([0, 1, 2] as const).filter((axis) => axis !== thin)
        const pw = Math.max(1, Math.round([w, h, d][nonThin[0]]))
        const ph = Math.max(1, Math.round([w, h, d][nonThin[1]]))
        let rect: UvRect = {
          u0: uvOrigin[0],
          v0: uvOrigin[1],
          u1: uvOrigin[0] + pw,
          v1: uvOrigin[1] + ph,
        }
        if (textureMirror) rect = mirrorUvRectU(rect)
        for (let fi = 0; fi < 6; fi += 1) {
          emitTexturedFace(fi, rect, cubeFaceIndices[fi])
        }
      } else if (isFlat && plane) {
        // model_shape_generate_plane: single UV patch on the thin-axis faces
        // (NOT the Minecraft box unwrap — that is only for blocks).
        const nonThin = ([0, 1, 2] as const).filter((axis) => axis !== thin)
        const pw = Math.max(1, Math.round([w, h, d][nonThin[0]]))
        const ph = Math.max(1, Math.round([w, h, d][nonThin[1]]))
        let rect: UvRect = {
          u0: uvOrigin[0],
          v0: uvOrigin[1],
          u1: uvOrigin[0] + pw,
          v1: uvOrigin[1] + ph,
        }
        if (textureMirror) rect = mirrorUvRectU(rect)
        const faceForThin: Record<0 | 1 | 2, [number, number]> = {
          0: [0, 1],
          1: [2, 3],
          2: [4, 5],
        }
        for (const fi of faceForThin[thin]) {
          emitTexturedFace(fi, rect, cubeFaceIndices[fi])
        }
      } else if (isFlat) {
        // Zero-thickness block: Modelbench still uses the Minecraft box unwrap
        // (up/down for a Z-flat plate), not the south patch at uv origin.
        const faceForThin: Record<0 | 1 | 2, [number, number]> = {
          0: [0, 1],
          1: [2, 3],
          2: [4, 5],
        }
        let rects = cubeFaceUvRects(uvOrigin, [
          Math.max(0, Math.round(w)),
          Math.max(0, Math.round(h)),
          Math.max(0, Math.round(d)),
        ])
        if (textureMirror) rects = mirrorCubeFaceUvRects(rects)
        for (const fi of faceForThin[thin]) {
          emitTexturedFace(fi, rects[fi], cubeFaceIndices[fi])
        }
      } else {
        let rects = cubeFaceUvRects(uvOrigin, [
          Math.max(1, Math.round(w)),
          Math.max(1, Math.round(h)),
          Math.max(1, Math.round(d)),
        ])
        if (textureMirror) rects = mirrorCubeFaceUvRects(rects)
        for (let fi = 0; fi < 6; fi += 1) {
          emitTexturedFace(fi, rects[fi], cubeFaceIndices[fi])
        }
      }
    } else {
      const mat = `shape_${materialCount}`
      mtl.push(`newmtl ${mat}`, `Kd ${color[0].toFixed(4)} ${color[1].toFixed(4)} ${color[2].toFixed(4)}`, '')
      obj.push(`o ${name}_${materialCount}`, `usemtl ${mat}`)
      for (const corner of corners) {
        const [x, y, z] = engineToYUp(corner)
        obj.push(
          `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${color[0].toFixed(4)} ${color[1].toFixed(4)} ${color[2].toFixed(4)}`,
        )
      }
      const base = vertexCount
      for (const face of cubeFaceIndices) {
        const a = base + face[0] + 1
        const b = base + face[1] + 1
        const cIdx = base + face[2] + 1
        const dIdx = base + face[3] + 1
        obj.push(`f ${a} ${b} ${cIdx}`, `f ${a} ${cIdx} ${dIdx}`)
      }
      vertexCount += 8
    }
    shapeCount += 1
  }

  /** Modelbench plane_3d: one opaque texel → mini-box; all faces share that texel UV. */
  const emitUniformTexelBox = (
    corners: [number, number, number][],
    color: [number, number, number],
    name: string,
    texX: number,
    texY: number,
    faceMask: boolean[] | null = null,
    invert = false,
  ) => {
    for (const corner of corners) {
      if (
        !Number.isFinite(corner[0])
        || !Number.isFinite(corner[1])
        || !Number.isFinite(corner[2])
        || Math.abs(corner[0]) > 512
        || Math.abs(corner[1]) > 512
        || Math.abs(corner[2]) > 512
      ) {
        skippedFar += 1
        return
      }
    }
    materialCount += 1
    obj.push(
      `o ${name}_${materialCount}`,
      `usemtl ${mapKdName ? 'skin_overlay' : `shape_${materialCount}`}`,
    )
    if (!mapKdName) {
      mtl.push(
        `newmtl shape_${materialCount}`,
        `Kd ${color[0].toFixed(4)} ${color[1].toFixed(4)} ${color[2].toFixed(4)}`,
        '',
      )
    }
    const rect: UvRect = { u0: texX, v0: texY, u1: texX + 1, v1: texY + 1 }
    const pix = faceUvPixelCorners(2, rect)
    const uvs = pix.map(([px, py]) => texUv(textureSize, px, py)) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
    const c = corners
    for (let fi = 0; fi < cubeFaceIndices.length; fi += 1) {
      if (faceMask && !faceMask[fi]) continue
      const idxs = cubeFaceIndices[fi]
      pushFace(
        [c[idxs[0]], c[idxs[1]], c[idxs[2]], c[idxs[3]]],
        uvs,
        [color, color, color, color],
        invert,
      )
    }
    shapeCount += 1
  }

  const walk = (
    nodes: JsonMap[],
    parentMat: Mat4,
    parentScale: [number, number, number],
  ) => {
    for (const part of nodes) {
      if (part.visible === false) continue
      const partName = asString(part.name) ?? 'part'
      const partPose = pose?.parts[partName]
      // Modelbench "[ Outline … ]" parts are editor helpers (often invert:true).
      // Mine-imator hides them via VISIBLE:false — never emit them into the mesh.
      if (/\[\s*outline\b/i.test(partName)) continue
      if (partPose?.visible === false) continue
      // Timeline values are already Modelbench engine-space (Z-up).
      const posePos = partPose?.pos ?? [0, 0, 0]
      const poseRot = partPose?.rot ?? [0, 0, 0]
      const poseBend = partPose?.bend ?? [0, 0, 0]
      const poseScale = partPose?.scale ?? [1, 1, 1]

      // Mimodel JSON → engine Z-up (Y↔Z swap).
      const partPos = mulVec(jsonToEngine(part.position), parentScale)
      const partRot = jsonToEngine(part.rotation)
      const partScaleLocal = mulVec(jsonToEngine(part.scale, [1, 1, 1]), poseScale)
      const partScale = mulVec(parentScale, partScaleLocal)

      // Mine-imator: matrix = timeline_local * (model_rest * parent)
      const restMat = matTRS(partPos, partRot, [1, 1, 1])
      const poseMat = matTRS(mulVec(posePos, parentScale), poseRot, [1, 1, 1])
      const partMat = matMul(parentMat, matMul(restMat, poseMat))

      const bendInfo = parseBend(part)
      if (bendInfo) {
        bendInfo.offset *= partScale[bendInfo.axis]
      }
      const bendAngles: [number, number, number] = [...poseBend]
      const hasBend =
        bendInfo != null
        && prepareBendAngles(bendInfo, bendAngles).some((a) => Math.abs(a) > 1e-4)
      const bendMat = bendInfo && hasBend
        ? bendMatrix(bendInfo, bendAngles)
        : matIdentity()
      for (const rawShape of asArray(part.shapes)) {
        const shape = asMap(rawShape)
        if (!shape) continue
        if (shape.visible === false) continue

        const type = asString(shape.type) ?? 'block'
        const shapeScaleLocal = jsonToEngine(shape.scale, [1, 1, 1])
        // UV helpers sit at ±2000 / ±4000 — skip before they crush AABB / colours.
        let rawFrom = jsonToEngine(shape.from)
        let rawTo = jsonToEngine(shape.to)
        // Modelbench: planes are forced thin on engine Y after the Y↔Z load swap.
        if (type === 'plane') {
          rawTo = [rawTo[0], rawFrom[1], rawTo[2]]
        }
        const far =
          Math.abs(rawFrom[0]) > 256
          || Math.abs(rawFrom[1]) > 256
          || Math.abs(rawFrom[2]) > 256
          || Math.abs(rawTo[0]) > 256
          || Math.abs(rawTo[1]) > 256
          || Math.abs(rawTo[2]) > 256
        // Slim wrists intentionally park faces at ±1e4 with scale 1e-4 so they
        // collapse to paper sheets after scale — do NOT skip those here.
        const shapeScaleLocalEarly = jsonToEngine(shape.scale, [1, 1, 1])
        const tinyScale =
          Math.abs(shapeScaleLocalEarly[0]) < 0.01
          || Math.abs(shapeScaleLocalEarly[1]) < 0.01
          || Math.abs(shapeScaleLocalEarly[2]) < 0.01
        if (far && !tinyScale) {
          skippedFar += 1
          continue
        }

        const shapeScale = mulVec(partScale, shapeScaleLocal)
        const inflate = Number(shape.inflate) || 0
        const inflateVec: [number, number, number] = [inflate, inflate, inflate]

        let fromN = rawFrom
        let toN = rawTo
        const uvSizeUnscaled: [number, number, number] = [
          Math.abs(toN[0] - fromN[0]),
          Math.abs(toN[1] - fromN[1]),
          Math.abs(toN[2] - fromN[2]),
        ]

        // Thicken plane / zero-thickness geometry for voxels — keep UV size intact.
        const zeroAxes = ([0, 1, 2] as const).filter((axis) => uvSizeUnscaled[axis] < 1e-4)
        const treatAsPlane = type === 'plane' || zeroAxes.length === 1
        if (treatAsPlane) {
          let thin: 0 | 1 | 2 = type === 'plane' ? 1 : 0
          if (type !== 'plane') {
            if (zeroAxes.length === 1) thin = zeroAxes[0]
            else if (uvSizeUnscaled[1] <= uvSizeUnscaled[0] && uvSizeUnscaled[1] <= uvSizeUnscaled[2]) thin = 1
            else if (uvSizeUnscaled[2] <= uvSizeUnscaled[0] && uvSizeUnscaled[2] <= uvSizeUnscaled[1]) thin = 2
          }
          const lo = Math.min(fromN[thin], toN[thin])
          fromN = [...fromN] as [number, number, number]
          toN = [...toN] as [number, number, number]
          if (type === 'plane' && shape['3d'] === true) {
            // Modelbench el_update_shape: to_noscale[Y] += 1 (one-sided extrude).
            fromN[thin] = lo
            toN[thin] = lo + 1
          } else if (type === 'plane') {
            // Modelbench generate_plane uses scalef=0.005 against Z-fighting.
            fromN[thin] = lo
            toN[thin] = lo + 0.005
            inflateVec[thin] = 0
          } else {
            // Degenerate block (Slim hand plate): Mine-imator keeps size 0 on that
            // axis — a paper sheet, not a 1-unit box (which sat inside the sleeve).
            fromN[thin] = lo - 0.025
            toN[thin] = lo + 0.025
          }
        }

        const shapeRot = jsonToEngine(shape.rotation)
        const shapePos = mulVec(jsonToEngine(shape.position), partScale)
        const shapeInvert = shape.invert === true
        // Modelbench bend_shape defaults true; `"bend": false` skips part bend.
        const shapeBends = shape.bend !== false
        const toWorld = (corner: [number, number, number]): [number, number, number] => {
          // Parent × T(pos) × R(rot) × local  — Modelbench generate+render
          const rotated = rotateEulerXyz(corner, shapeRot)
          let local = addVec(rotated, shapePos)
          if (hasBend && bendInfo && shapeBends) {
            local = bendPoint(local, bendInfo, bendAngles)
          }
          return matTransformPoint(partMat, local)
        }

        const uvOrigin = shape.uv !== undefined ? vec2(shape.uv) : null
        const extrude3d = type === 'plane' && shape['3d'] === true

        // Modelbench model_shape_generate_plane_3d (non-bent axes: outer=X, inner=Z):
        // sample alpha at UV; only fully opaque texels (alpha==1) become 1×1×thickness boxes;
        // edge faces culled when the neighbour texel is also opaque; front/back = ±engine Y.
        if (extrude3d && image && uvOrigin) {
          const thinAxis: 0 | 1 | 2 = 1 // planes forced thin on engine Y
          const nonThin = ([0, 1, 2] as const).filter((a) => a !== thinAxis)
          // Modelbench shape_update_vbuffer: samplesize = ceil(|to−from| XZ) when texture_size matches image.
          const pixW = Math.max(1, Math.ceil(Math.abs(rawTo[nonThin[0]] - rawFrom[nonThin[0]]) || 1))
          const pixH = Math.max(1, Math.ceil(Math.abs(rawTo[nonThin[1]] - rawFrom[nonThin[1]]) || 1))
          const u0 = Math.floor(uvOrigin[0])
          const v0 = Math.floor(uvOrigin[1])
          const hideFront = shape.hide_front === true
          const hideBack = shape.hide_back === true
          const textureMirror = shape.texture_mirror === true

          // Unscaled AABB with Modelbench 3d extrude: to[Y] = from[Y] + 1, then ±inflate.
          const lo: [number, number, number] = [
            Math.min(rawFrom[0], rawTo[0]),
            Math.min(rawFrom[1], rawTo[1]),
            Math.min(rawFrom[2], rawTo[2]),
          ]
          const hi: [number, number, number] = [
            Math.max(rawFrom[0], rawTo[0]),
            Math.max(rawFrom[1], rawTo[1]),
            Math.max(rawFrom[2], rawTo[2]),
          ]
          lo[thinAxis] = Math.min(rawFrom[thinAxis], rawTo[thinAxis])
          hi[thinAxis] = lo[thinAxis] + 1
          if (inflate) {
            for (let a = 0; a < 3; a += 1) {
              lo[a] -= inflate
              hi[a] += inflate
            }
          }
          const span: [number, number, number] = [
            Math.max(1e-4, hi[0] - lo[0]),
            Math.max(1e-4, hi[1] - lo[1]),
            Math.max(1e-4, hi[2] - lo[2]),
          ]

          const opaque: boolean[] = new Array(pixW * pixH).fill(false)
          const colors: Array<[number, number, number] | null> = new Array(pixW * pixH).fill(null)
          for (let py = 0; py < pixH; py += 1) {
            for (let px = 0; px < pixW; px += 1) {
              // Modelbench (seginner=Z): ax=outer, ay = height-1-inner
              const ax = textureMirror ? pixW - 1 - px : px
              const ay = pixH - 1 - py
              const rgb = sampleOpaqueTexel(image, textureSize, u0 + ax, v0 + ay)
              if (!rgb) continue
              const i = ax + ay * pixW
              opaque[i] = true
              colors[i] = rgb
            }
          }

          const axisFacePos = [0, 2, 4] as const
          const axisFaceNeg = [1, 3, 5] as const
          const thinPos = axisFacePos[thinAxis] // +Y south / front
          const thinNeg = axisFaceNeg[thinAxis] // -Y north / back
          const uPos = axisFacePos[nonThin[0]]
          const uNeg = axisFaceNeg[nonThin[0]]
          const vPos = axisFacePos[nonThin[1]]
          const vNeg = axisFaceNeg[nonThin[1]]

          let emitted = 0
          for (let py = 0; py < pixH; py += 1) {
            for (let px = 0; px < pixW; px += 1) {
              const ax = textureMirror ? pixW - 1 - px : px
              const ay = pixH - 1 - py
              const texIdx = ax + ay * pixW
              if (!opaque[texIdx] || !colors[texIdx]) continue
              const t0 = px / pixW
              const t1 = (px + 1) / pixW
              const s0 = py / pixH
              const s1 = (py + 1) / pixH
              const boxLo: [number, number, number] = [lo[0], lo[1], lo[2]]
              const boxHi: [number, number, number] = [hi[0], hi[1], hi[2]]
              boxLo[nonThin[0]] = lo[nonThin[0]] + span[nonThin[0]] * t0
              boxHi[nonThin[0]] = lo[nonThin[0]] + span[nonThin[0]] * t1
              boxLo[nonThin[1]] = lo[nonThin[1]] + span[nonThin[1]] * s0
              boxHi[nonThin[1]] = lo[nonThin[1]] + span[nonThin[1]] * s1
              // Authoring often sets thin-axis scale to ~0.25 so 3d planes look
              // paper-thin in Modelbench. After scale that is only 0.25u thick and
              // flattens crown / hat / sleeve shells on coarse voxel grids.
              // Widen the *pre-scale* extrusion so post-scale thickness is ~1px
              // (Minecraft outer layer) without changing the shell centre.
              const sThin = Math.abs(shapeScale[thinAxis]) || 1
              if (sThin < 0.95) {
                const mid = (boxLo[thinAxis] + boxHi[thinAxis]) * 0.5
                const half = 0.5 / sThin
                boxLo[thinAxis] = mid - half
                boxHi[thinAxis] = mid + half
              }
              const localCorners: [number, number, number][] = [
                [boxLo[0], boxLo[1], boxLo[2]],
                [boxHi[0], boxLo[1], boxLo[2]],
                [boxHi[0], boxHi[1], boxLo[2]],
                [boxLo[0], boxHi[1], boxLo[2]],
                [boxLo[0], boxLo[1], boxHi[2]],
                [boxHi[0], boxLo[1], boxHi[2]],
                [boxHi[0], boxHi[1], boxHi[2]],
                [boxLo[0], boxHi[1], boxHi[2]],
              ].map((p) => mulVec(p as [number, number, number], shapeScale)) as [
                number,
                number,
                number,
              ][]
              const worldCorners = localCorners.map(toWorld)
              // Modelbench w/e/a/b face visibility from alpha neighbours.
              let wface = ax === 0 || !alphaAt(opaque, pixW, pixH, ax - 1, ay)
              let eface = ax === pixW - 1 || !alphaAt(opaque, pixW, pixH, ax + 1, ay)
              if (textureMirror) {
                const tmp = wface
                wface = eface
                eface = tmp
              }
              const aface = ay === 0 || !alphaAt(opaque, pixW, pixH, ax, ay - 1)
              const bface = ay === pixH - 1 || !alphaAt(opaque, pixW, pixH, ax, ay + 1)
              const faceMask = [false, false, false, false, false, false]
              if (!hideFront) faceMask[thinPos] = true
              if (!hideBack) faceMask[thinNeg] = true
              if (eface) faceMask[uPos] = true
              if (wface) faceMask[uNeg] = true
              // ay=0 → aface → high Z (+Z); ay=max → bface → low Z (−Z)
              if (aface) faceMask[vPos] = true
              if (bface) faceMask[vNeg] = true
              if (!faceMask.some(Boolean)) continue
              emitUniformTexelBox(
                worldCorners,
                colors[texIdx]!,
                partName,
                u0 + ax,
                v0 + ay,
                faceMask,
                shapeInvert,
              )
              emitted += 1
            }
          }
          if (emitted > 0) continue
          // Modelbench: fully transparent 3d plane → empty mesh (no fallback sheet/box).
          continue
        }

        const fromS = mulVec(
          [fromN[0] - inflateVec[0], fromN[1] - inflateVec[1], fromN[2] - inflateVec[2]],
          shapeScale,
        )
        const toS = mulVec(
          [toN[0] + inflateVec[0], toN[1] + inflateVec[1], toN[2] + inflateVec[2]],
          shapeScale,
        )

        const x0 = Math.min(fromS[0], toS[0])
        const y0 = Math.min(fromS[1], toS[1])
        const z0 = Math.min(fromS[2], toS[2])
        const x1 = Math.max(fromS[0], toS[0])
        const y1 = Math.max(fromS[1], toS[1])
        const z1 = Math.max(fromS[2], toS[2])

        const localCorners: [number, number, number][] = [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y1, z0],
          [x0, y1, z0],
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ]

        const worldCorners = localCorners.map(toWorld)
        // After scale, reject helpers that are still absurdly far from the origin.
        if (
          worldCorners.some(
            (c) => Math.abs(c[0]) > 512 || Math.abs(c[1]) > 512 || Math.abs(c[2]) > 512,
          )
        ) {
          skippedFar += 1
          continue
        }
        // Paper plane shapes use a single UV patch; zero-thickness blocks use box unwrap.
        const isPaperPlane = type === 'plane' && !extrude3d
        const color = colorForShape(shape, textureSize, image, uvSizeUnscaled, treatAsPlane)
        const textureMirror = shape.texture_mirror === true
        emitBox(
          worldCorners,
          color,
          partName,
          uvOrigin,
          uvSizeUnscaled,
          isPaperPlane,
          extrude3d,
          shapeInvert,
          textureMirror,
        )
      }

      const children = asArray(part.parts).map(asMap).filter(Boolean) as JsonMap[]
      if (children.length > 0) {
        // lock_bend defaults true — children hang off the bent joint.
        const lockBend = part.lock_bend !== false
        const childMat = hasBend && lockBend ? matMul(partMat, bendMat) : partMat
        walk(children, childMat, partScale)
      }
    }
  }

  let rootMat = matIdentity()
  if (pose?.root) {
    rootMat = matTRS(pose.root.pos, pose.root.rot, pose.root.scale)
  }
  walk(parts, rootMat, [1, 1, 1])
  if (shapeCount === 0) {
    throw new Error(
      skippedFar > 0
        ? 'Mine-imator model produced no usable shapes (helpers filtered out)'
        : 'Mine-imator model has no visible block/plane shapes',
    )
  }

  return {
    objBytes: new TextEncoder().encode(`${obj.join('\n')}\n`),
    mtlBytes: new TextEncoder().encode(`${mtl.join('\n')}\n`),
    textureFileName: textureFileName ? basename(textureFileName) : null,
    shapeCount,
  }
}

export function isMiobjectFileName(name: string): boolean {
  return /\.miobject$/i.test(name)
}

export function isMimodelFileName(name: string): boolean {
  return /\.mimodel$/i.test(name)
}

/** Texture basename declared on a .mimodel root (`texture` / `texture_name`). */
export function mimodelTextureFileName(mimodelBytes: Uint8Array): string | null {
  try {
    const root = parseMiobjectText(new TextDecoder('utf-8', { fatal: false }).decode(mimodelBytes))
    const named = asString(root.texture) ?? asString(root.texture_name)
    return named ? basename(named) : null
  } catch {
    return null
  }
}
