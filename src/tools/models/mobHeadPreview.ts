/**
 * Library thumbs crop the entity sheet to the mob's front face.
 * Player skins keep the classic 8×8 at (8,8) on a 64-wide PNG; everything else
 * uses the catalog model's north-face UV (Java box unwrap / per-face).
 */
import type { CSSProperties } from 'react'
import type { EntityCube, FaceUv } from './vanillaHumanoids'
import { humanoidModelFor } from './vanillaHumanoids'

export type HeadFaceRect = {
  x: number
  y: number
  w: number
  h: number
  sheetW: number
  sheetH: number
}

/** Outer gel / crust, or a more readable front than a tiny inner cube. */
const FACE_OVERRIDES: Record<string, Omit<HeadFaceRect, 'sheetW' | 'sheetH'>> = {
  slime: { x: 8, y: 8, w: 8, h: 8 },
  slime_small: { x: 8, y: 8, w: 8, h: 8 },
  slime_large: { x: 8, y: 8, w: 8, h: 8 },
  magma_cube: { x: 8, y: 8, w: 8, h: 8 },
  magma_cube_small: { x: 8, y: 8, w: 8, h: 8 },
  magma_cube_large: { x: 8, y: 8, w: 8, h: 8 },
  // Closed shell front (lid north). The inner 6×6 head is the same on every colour.
  shulker: { x: 16, y: 16, w: 16, h: 12 },
  // Bundled 64×64 rabbit sheets pack the head island at (32,0), not Java (37,5).
  rabbit: { x: 32, y: 1, w: 5, h: 4 },
}

const SKIP_NAME =
  /wool|saddle|bridle|harness|pumpkin|hat|hood|helmet|brim|jacket|collar|mane|bag|chest/

function cubeName(cube: EntityCube) {
  return (cube.name ?? '').toLowerCase()
}

function cubeUvSize(cube: EntityCube): [number, number, number] {
  return cube.uvSize ?? cube.size
}

function perFaceRect(face: FaceUv): { x: number; y: number; w: number; h: number } {
  let [x, y] = face.uv
  let [w, h] = face.uvSize
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  return { x, y, w, h }
}

/** Java ModelPart north face — the front of the cube on the sheet. */
function northFace(cube: EntityCube): { x: number; y: number; w: number; h: number } | null {
  const uv = cube.uv
  if (!Array.isArray(uv)) {
    const face = uv.north ?? uv.south
    return face ? perFaceRect(face) : null
  }
  const [u, v] = uv
  const [w, h, d] = cubeUvSize(cube)
  if (w < 0.5 || h < 0.5) return null
  return { x: u + d, y: v + d, w, h }
}

function nameRank(name: string): number {
  if (name === 'center_head') return 5
  if (name === 'head' || name === 'skull' || name === 'nose' || name === 'snout') return 4
  if (/(^|_)head$/.test(name) || name.startsWith('head')) return 3
  if (name === 'body' || name === 'cube' || name === 'inside_cube') return 2
  return 1
}

function pickPreviewCube(cubes: EntityCube[]): EntityCube | null {
  const usable = cubes.filter((cube) => {
    const name = cubeName(cube)
    if (SKIP_NAME.test(name) && !/(^|_)head$/.test(name) && name !== 'head') return false
    return northFace(cube) != null
  })
  if (usable.length === 0) return null

  const inner = usable.filter((cube) => (cube.inflate ?? 0) <= 0.05)
  const pool = inner.length > 0 ? inner : usable

  const ranked = [...pool].sort((a, b) => {
    const nameDelta = nameRank(cubeName(b)) - nameRank(cubeName(a))
    if (nameDelta) return nameDelta
    const faceA = northFace(a)!
    const faceB = northFace(b)!
    const aHead = cubeName(a) === 'head' && faceA.w >= 4 && faceA.h >= 4 ? 1 : 0
    const bHead = cubeName(b) === 'head' && faceB.w >= 4 && faceB.h >= 4 ? 1 : 0
    return bHead - aHead
  })
  const top = nameRank(cubeName(ranked[0]!))
  const tier = ranked.filter((cube) => nameRank(cubeName(cube)) === top)

  const tall = tier.filter((cube) => {
    const face = northFace(cube)!
    return face.w >= 2 && face.h >= 2
  })
  const scored = (tall.length > 0 ? tall : tier).map((cube) => {
    const face = northFace(cube)!
    const area = face.w * face.h
    const square = Math.min(face.w, face.h) / Math.max(face.w, face.h)
    const vol = Math.abs(cube.size[0] * cube.size[1] * cube.size[2])
    return { cube, score: square * area * 8 + vol * 0.02 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.cube ?? null
}

const FACE_EXTRA_NAME =
  /nose|snout|beak|tusk|ear|horn|muzzle|comb|wattle/
const NOT_FACE_EXTRA =
  /(^|_)(leg|arm|wing|tail|body)s?$|wool|saddle|bridle|harness|pumpkin|hat|hood|helmet|jacket|collar|mane|bag|chest/

function isHeadBone(name: string) {
  return name === 'head' || name === 'skull' || name === 'center_head' || /_head$/.test(name)
}

function headBoneName(cubes: EntityCube[]): string | null {
  const names = cubes.map(cubeName)
  if (names.includes('center_head')) return 'center_head'
  if (names.includes('head')) return 'head'
  if (names.includes('skull')) return 'skull'
  return names.find((name) => isHeadBone(name)) ?? null
}

function sameTriple(
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined,
  eps = 0.25,
) {
  if (!a || !b) return false
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps
}

function cubeVolume(cube: EntityCube) {
  return Math.abs(cube.size[0] * cube.size[1] * cube.size[2])
}

function overlapsHeadFront(cube: EntityCube, head: EntityCube) {
  const pad = 2
  const ax0 = cube.origin[0]
  const ax1 = ax0 + cube.size[0]
  const ay0 = cube.origin[1]
  const ay1 = ay0 + cube.size[1]
  const bx0 = head.origin[0] - pad
  const bx1 = head.origin[0] + head.size[0] + pad
  const by0 = head.origin[1] - pad
  const by1 = head.origin[1] + head.size[1] + pad
  if (ax0 >= bx1 || ax1 <= bx0 || ay0 >= by1 || ay1 <= by0) return false
  // Catalog dumps face −Z; snout / beak sit at a more negative Z than the skull.
  return cube.origin[2] <= head.origin[2] + 0.75
}

function boxUnwrapFace(
  cube: EntityCube,
  which: 'north' | 'east' | 'west',
): { x: number; y: number; w: number; h: number } | null {
  const uv = cube.uv
  if (!Array.isArray(uv)) {
    const face = uv[which] ?? (which === 'north' ? uv.south : undefined)
    return face ? perFaceRect(face) : null
  }
  const [u, v] = uv
  const [w, h, d] = cubeUvSize(cube)
  if (w < 0.5 && which === 'north') return null
  if (h < 0.5) return null
  if (which === 'west') return d < 0.5 ? null : { x: u, y: v + d, w: d, h }
  if (which === 'east') return d < 0.5 ? null : { x: u + d + w, y: v + d, w: d, h }
  return { x: u + d, y: v + d, w, h }
}

export function cubeFrontBox(cube: EntityCube) {
  const [sx, sy, sz] = cube.size
  if (sy < 0.5) return null
  const name = cubeName(cube)
  const rotZ = Math.abs(cube.rotation?.[2] ?? 0)
  // Piglin / wolf ears are 1px slabs rotated toward the camera — north is a line.
  const sideEar = sx < 1.51 && sz >= 2 && (rotZ >= 15 || /ear/.test(name))
  if (sideEar) {
    const left = cube.origin[0] + sx / 2 >= 0
    const face =
      boxUnwrapFace(cube, left ? 'east' : 'west')
      ?? boxUnwrapFace(cube, left ? 'west' : 'east')
    if (!face || face.w < 0.5 || face.h < 0.5) return null
    const w = sz
    const x = left ? cube.origin[0] : cube.origin[0] + sx - w
    return { x, y: cube.origin[1], w, h: sy, z: cube.origin[2], face, cube }
  }
  const face = northFace(cube)
  if (!face || sx < 0.5) return null
  return { x: cube.origin[0], y: cube.origin[1], w: sx, h: sy, z: cube.origin[2], face, cube }
}

function usableHeadCube(cube: EntityCube) {
  const name = cubeName(cube)
  if (SKIP_NAME.test(name) || NOT_FACE_EXTRA.test(name)) return false
  if ((cube.inflate ?? 0) > 0.05) return false
  return cube.size[0] >= 0.5 && cube.size[1] >= 0.5
}

/** Head cube plus snout / nose / ears that sit on that bone. */
export function headAssemblyCubes(catalogId: string): EntityCube[] {
  if (FACE_OVERRIDES[catalogId] || catalogId.startsWith('shulker')) return []
  const model = humanoidModelFor(catalogId)
  if (!model) return []
  const bone = headBoneName(model.cubes)
  if (!bone) return []
  const namedHead = model.cubes.filter((cube) => cubeName(cube) === bone && usableHeadCube(cube))
  const primary = [...namedHead].sort((a, b) => cubeVolume(b) - cubeVolume(a))[0]
  return model.cubes.filter((cube) => {
    if (!usableHeadCube(cube)) return false
    const name = cubeName(cube)
    if (name === bone) return true
    const parent = (cube.poseParent ?? '').toLowerCase()
    if (parent === bone && FACE_EXTRA_NAME.test(name)) return true
    if (!primary) return false
    if (sameTriple(cube.pivot, primary.pivot) && (FACE_EXTRA_NAME.test(name) || cubeVolume(cube) < cubeVolume(primary) * 0.5)) {
      return true
    }
    return FACE_EXTRA_NAME.test(name) && overlapsHeadFront(cube, primary)
  })
}

export function needsComposedHeadThumb(catalogId: string): boolean {
  if (headOverlayFronts(catalogId).length > 0) return true
  return headAssemblyCubes(catalogId).filter((cube) => cubeFrontBox(cube)).length >= 2
}

export function headFrontLayout(catalogId: string) {
  const model = humanoidModelFor(catalogId)
  const parts = headAssemblyCubes(catalogId)
    .map((cube) => cubeFrontBox(cube))
    .filter((part): part is NonNullable<typeof part> => part != null)
    .sort((a, b) => b.z - a.z)
  if (parts.length < 2 || !model) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const part of parts) {
    minX = Math.min(minX, part.x)
    minY = Math.min(minY, part.y)
    maxX = Math.max(maxX, part.x + part.w)
    maxY = Math.max(maxY, part.y + part.h)
  }
  return {
    parts,
    minX,
    minY,
    maxX,
    maxY,
    sheetW: model.textureSize[0],
    sheetH: model.textureSize[1],
  }
}

/** Second-layer hat / hair fronts. 64×32 sheets have no texOffs(32,0) overlay. */
export function headOverlayFronts(
  catalogId: string,
): { x: number; y: number; w: number; h: number }[] {
  const model = humanoidModelFor(catalogId)
  if (!model) return []
  const [sheetW, sheetH] = model.textureSize
  const faces: { x: number; y: number; w: number; h: number }[] = []
  for (const cube of model.cubes) {
    const inflate = cube.inflate ?? 0
    if (inflate <= 0.05) continue
    const name = cubeName(cube)
    if (name !== 'head' && name !== 'hat' && !name.endsWith('_overlay')) continue
    if (Array.isArray(cube.uv)) {
      const [u, v] = cube.uv
      if (sheetH <= 32 && u >= 32 && v < 16) continue
    }
    const face = northFace(cube)
    if (!face || face.w < 0.5 || face.h < 0.5) continue
    if (face.x + face.w > sheetW + 0.1 || face.y + face.h > sheetH + 0.1) continue
    faces.push(face)
  }
  return faces
}

export type HeadThumbPart = {
  x: number
  y: number
  w: number
  h: number
  z: number
  face: { x: number; y: number; w: number; h: number }
}

export function headThumbSpec(catalogId: string) {
  const layout = headFrontLayout(catalogId)
  const overlays = headOverlayFronts(catalogId)
  if (layout) {
    return { ...layout, overlays }
  }
  const face = headPreviewFace(catalogId)
  const parts: HeadThumbPart[] = [
    {
      x: 0,
      y: 0,
      w: face.w,
      h: face.h,
      z: 0,
      face: { x: face.x, y: face.y, w: face.w, h: face.h },
    },
  ]
  return {
    parts,
    minX: 0,
    minY: 0,
    maxX: face.w,
    maxY: face.h,
    sheetW: face.sheetW,
    sheetH: face.sheetH,
    overlays,
  }
}

export function headPreviewFace(catalogId: string): HeadFaceRect {
  const override =
    FACE_OVERRIDES[catalogId]
    ?? (catalogId.startsWith('shulker') ? FACE_OVERRIDES.shulker : undefined)
  const model = humanoidModelFor(catalogId)
  const sheetW = model?.textureSize[0] ?? 64
  const sheetH = model?.textureSize[1] ?? 64
  if (override) return { ...override, sheetW, sheetH }
  if (!model) return { x: 8, y: 8, w: 8, h: 8, sheetW: 64, sheetH: 64 }
  const cube = pickPreviewCube(model.cubes)
  if (!cube) return { x: 8, y: 8, w: 8, h: 8, sheetW, sheetH }
  const face = northFace(cube)
  if (!face || face.w < 0.5 || face.h < 0.5) {
    return { x: 8, y: 8, w: 8, h: 8, sheetW, sheetH }
  }
  return { ...face, sheetW, sheetH }
}

/** CSS custom props for `.mc-library-skin` — crop scales with `--thumb`. */
export function headPreviewVars(catalogId: string): CSSProperties {
  if (!catalogId || catalogId === 'snow_golem_pumpkin') return {}
  const face = headPreviewFace(catalogId)
  const max = Math.max(face.w, face.h, 1)
  return {
    ['--sheet-w' as string]: String(face.sheetW),
    ['--sheet-h' as string]: String(face.sheetH),
    ['--face-x' as string]: String(face.x),
    ['--face-y' as string]: String(face.y),
    ['--face-w' as string]: String(face.w),
    ['--face-h' as string]: String(face.h),
    ['--face-max' as string]: String(max),
  }
}
