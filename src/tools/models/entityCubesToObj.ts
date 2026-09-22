/**
 * Bake vanilla entity cubes into a textured OBJ.
 *
 * Pose cubes in vanilla Java/Bedrock space first (rest-pose Euler around
 * pivots), then flip Z so the face looks at the orbit camera. Box UV uses
 * Java north as the front; after the Z-flip that face sits at +Z.
 *
 * Box UV: https://minecraft.wiki/w/Player#Skins — west, down/up, east, north, south.
 * Per-face UV: Bedrock geometry `uv[face] = { uv, uv_size }`.
 */
import { createObjPart, type ScenePartLocal } from '../../types'
import { emptyPartPose } from './characterPose'
import {
  buildCatalogPoseParents,
  catalogBoneId,
  isBipedHumanoidModel,
  representativeCubeForBone,
} from './catalogEntityBones'
import { decodePngRgba, type PngRgba } from './decodePngRgba'
import {
  blockTextureMaterialName,
  catalogBlockFaceTextures,
  catalogBoneTextureFile,
  catalogExtraMaterials,
} from './entityCatalogFixes'
import { clampVoxelBox } from './objPartPose'
import type { EntityCube, FaceName, FaceUv, VanillaHumanoid } from './vanillaHumanoids'

const FACES: FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north']

function isBoxUv(uv: EntityCube['uv']): uv is [number, number] {
  return Array.isArray(uv)
}

/** Face the orbit camera at +Z: Java looks down −Z, so only flip Z after posing. */
function faceCamera(p: [number, number, number]): [number, number, number] {
  return [p[0], p[1], -p[2]]
}

/** Stable OBJ object order — jaw before head so mouth shell cannot wash eyes. */
function objExportOrder(name: string): number {
  if (name === 'jaw') return 0
  if (name === 'head') return 2
  return 1
}

function inflateCube(cube: EntityCube, overlayLayer = false): { from: [number, number, number]; to: [number, number, number] } {
  let i = cube.inflate ?? 0
  // True second-layer shells with negative inflate (rare): nudge outside so the
  // host mesh does not fully occlude them.
  if (overlayLayer && i < 0) i = 0.1
  // Lone negative inflate (snow golem −0.5): keep full-size mesh. Keep the inset
  // for Enderman's jaw — Java uses hat inflate −0.5 so the jaw sits inside the
  // head without z-fighting; stripping it made convert punch holes in the mouth.
  if (!overlayLayer && i < 0) {
    const bone = (cube.name ?? '').toLowerCase()
    if (bone !== 'jaw') i = 0
  }
  const [ox, oy, oz] = cube.origin
  const [sx, sy, sz] = cube.size
  // Vanilla wings/stingers are 0-thick planes. Keep a hair of thickness so
  // the face exists, but skip the degenerate side faces below.
  const padX = sx === 0 ? 0.02 : 0
  const padY = sy === 0 ? 0.02 : 0
  const padZ = sz === 0 ? 0.02 : 0
  return {
    from: [ox - i - padX, oy - i - padY, oz - i - padZ],
    to: [ox + sx + i + padX, oy + sy + i + padY, oz + sz + i + padZ],
  }
}

function faceHasArea(from: [number, number, number], to: [number, number, number], face: FaceName): boolean {
  const [x0, y0, z0] = from
  const [x1, y1, z1] = to
  switch (face) {
    case 'east':
    case 'west':
      return Math.abs(y1 - y0) > 1e-4 && Math.abs(z1 - z0) > 1e-4
    case 'up':
    case 'down':
      return Math.abs(x1 - x0) > 1e-4 && Math.abs(z1 - z0) > 1e-4
    case 'south':
    case 'north':
      return Math.abs(x1 - x0) > 1e-4 && Math.abs(y1 - y0) > 1e-4
  }
}

/** Hat/jacket/sleeve shells — same bone id with `_overlay` suffix from catalogBoneId. */
function isOverlayLayerCube(model: VanillaHumanoid, index: number): boolean {
  return catalogBoneId(model, index).endsWith('_overlay')
}

function inferredCubePivot(cube: EntityCube): [number, number, number] {
  const [x, y, z] = cube.origin
  const [sx, sy, sz] = cube.size
  const key = (cube.name ?? '').toLowerCase()
  if (/head|hat|hood|jaw|snout|ear|nose/.test(key)) {
    return [x + sx / 2, y, z + sz / 2]
  }
  if (/arm|leg|wing|fin|limb/.test(key) || (sy >= sx && sy >= sz && sy > 4)) {
    return [x + sx / 2, y + sy, z + sz / 2]
  }
  return [x + sx / 2, y + sy / 2, z + sz / 2]
}

function cubeWorldPivot(cube: EntityCube): [number, number, number] {
  let point: [number, number, number] = cube.pivot
    ? [cube.pivot[0], cube.pivot[1], cube.pivot[2]]
    : inferredCubePivot(cube)
  for (const step of cube.parents ?? []) {
    point = rotateAround(point, step.pivot, step.rotation)
  }
  return faceCamera(point)
}

/** Pose pivot — biped torso uses hip line; every other bone uses its ModelPart pivot. */
function catalogPosePivot(
  objectName: string,
  cube: EntityCube,
  model: VanillaHumanoid,
): [number, number, number] {
  if (objectName === 'body' && isBipedHumanoidModel(model)) {
    const box = inflateCube(cube)
    let point: [number, number, number] = [
      (box.from[0] + box.to[0]) * 0.5,
      box.from[1],
      (box.from[2] + box.to[2]) * 0.5,
    ]
    for (const step of cube.parents ?? []) {
      point = rotateAround(point, step.pivot, step.rotation)
    }
    return faceCamera(point)
  }
  return cubeWorldPivot(cube)
}

function rotateAround(
  p: [number, number, number],
  origin: [number, number, number],
  deg: [number, number, number],
): [number, number, number] {
  let [x, y, z] = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]
  const rx = (deg[0] * Math.PI) / 180
  const ry = (deg[1] * Math.PI) / 180
  const rz = (deg[2] * Math.PI) / 180
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

/**
 * Vertex order matches three.js BoxGeometry (player-skin `applyMinecraftBoxUVs`):
 * +X, −X, +Y, −Y, +Z, −Z — each face TL, TR, BL, BR.
 */
function corners(from: [number, number, number], to: [number, number, number], face: FaceName): [number, number, number][] {
  const [x0, y0, z0] = from
  const [x1, y1, z1] = to
  switch (face) {
    case 'east':
      return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]]
    case 'west':
      return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]]
    case 'up':
      return [[x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [x1, y1, z0]]
    case 'down':
      return [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1]]
    case 'south':
      return [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]]
    case 'north':
      return [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]]
  }
}

type UvRect = { x: number; y: number; w: number; h: number; flipX: boolean; flipY: boolean }

/**
 * Vanilla Java ModelPart box UV. North (−Z) is the face; after `faceCamera`
 * that geometry sits at +Z toward the orbit camera.
 *
 * `mirror` matches ModelPart.Cube: swap east/west and flip U on every face
 * (including up/down). Skipping the up/down flip made dragon left-wing
 * membranes map the skin backwards.
 */
function boxFaceUv(
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
  face: FaceName,
  mirror: boolean,
): UvRect {
  const eastX = mirror ? u : u + d + w
  const westX = mirror ? u + d + w : u
  switch (face) {
    case 'east':
      return { x: eastX, y: v + d, w: d, h, flipX: mirror, flipY: false }
    case 'west':
      return { x: westX, y: v + d, w: d, h, flipX: !mirror, flipY: false }
    case 'up':
      return { x: u + d, y: v, w, h: d, flipX: mirror, flipY: false }
    case 'down':
      // Java ModelPart DOWN maps v from v+d → v (V inverted); mirror flips U.
      return { x: u + d + w, y: v, w, h: d, flipX: !mirror, flipY: true }
    case 'north':
      return { x: u + d, y: v + d, w, h, flipX: mirror, flipY: false }
    case 'south':
      return { x: u + d * 2 + w, y: v + d, w, h, flipX: mirror, flipY: false }
  }
}

/**
 * FaceBakery UVs for a full 16³ block element (pixel space, V from top).
 * @see net.minecraft.client.renderer.block.model.FaceBakery
 */
function blockTextureFaceUv(face: FaceName): UvRect {
  const x1 = 0
  const y1 = 0
  const z1 = 0
  const x2 = 16
  const y2 = 16
  const z2 = 16
  let u1 = 0
  let v1 = 0
  let u2 = 0
  let v2 = 0
  switch (face) {
    case 'west':
      u1 = z1
      v1 = 16 - y2
      u2 = z2
      v2 = 16 - y1
      break
    case 'east':
      u1 = 16 - z2
      v1 = 16 - y2
      u2 = 16 - z1
      v2 = 16 - y1
      break
    case 'down':
      u1 = x1
      v1 = 16 - z2
      u2 = x2
      v2 = 16 - z1
      break
    case 'up':
      u1 = x1
      v1 = z1
      u2 = x2
      v2 = z2
      break
    case 'north':
      u1 = 16 - x2
      v1 = 16 - y2
      u2 = 16 - x1
      v2 = 16 - y1
      break
    case 'south':
      u1 = x1
      v1 = 16 - y2
      u2 = x2
      v2 = 16 - y1
      break
  }
  return {
    x: Math.min(u1, u2),
    y: Math.min(v1, v2),
    w: Math.abs(u2 - u1),
    h: Math.abs(v2 - v1),
    flipX: u1 > u2,
    flipY: v1 > v2,
  }
}

function perFaceRect(faceUv: FaceUv): UvRect {
  let [x, y] = faceUv.uv
  let [w, h] = faceUv.uvSize
  let flipX = false
  let flipY = false
  if (w < 0) {
    x += w
    w = -w
    flipX = true
  }
  if (h < 0) {
    y += h
    h = -h
    flipY = true
  }
  return { x, y, w, h, flipX, flipY }
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function pngPixelSize(bytes: Uint8Array): [number, number] | null {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
  ) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 1 || height < 1) return null
  return [width, height]
}

/**
 * Minecraft samples UVs as texOffs / model.textureSize, then stretches the
 * image across 0–1. A 64×64 zombie/cow sheet with 64×32 texOffs must use 64×64
 * or the body maps onto the empty lower half. A 2×-resolution sheet (ghast
 * 128×64 vs 64×32) must keep the model size so 0–1 still covers the whole PNG.
 */
function uvAtlasSize(
  modelSize: [number, number],
  pngSize: [number, number] | null,
): [number, number] {
  if (!pngSize) return modelSize
  const [modelW, modelH] = modelSize
  const [pngW, pngH] = pngSize
  if (pngW === modelW && pngH === modelH * 2) return pngSize
  // 2× PNGs (happy ghast 128² on 64² layout, ghast 128×64 on 64×32) keep model texel coords.
  return modelSize
}

export function entityModelToObj(
  model: VanillaHumanoid,
  textureFile: string,
  pixelSize?: [number, number] | null,
  atlas?: PngRgba | null,
  extraAtlases?: Record<string, PngRgba> | null,
): { obj: string; mtl: string; pivots: Record<string, [number, number, number]> } {
  const [texW, texH] = uvAtlasSize(model.textureSize, pixelSize ?? null)
  type Vert = { p: [number, number, number]; rgb: [number, number, number] }
  const positions: Vert[] = []
  const uvs: [number, number][] = []
  type FaceLine = { mat: string; line: string }
  type FaceBucket = { inner: FaceLine[]; overlay: string[] }
  const facesByName = new Map<string, FaceBucket>()
  const pivots: Record<string, [number, number, number]> = {}
  const avgOpaque = atlas ? averageOpaqueRgb(atlas) : ([0.72, 0.74, 0.78] as [number, number, number])

  const addPos = (p: [number, number, number], rgb: [number, number, number]) => {
    positions.push({ p, rgb })
    return positions.length
  }
  const addUv = (uu: number, vv: number) => {
    uvs.push([uu, vv])
    return uvs.length
  }

  for (let index = 0; index < model.cubes.length; index += 1) {
    const cube = model.cubes[index]!
    const objectName = catalogBoneId(model, index)
    if (!pivots[objectName]) {
      const rep = representativeCubeForBone(model, objectName) ?? cube
      pivots[objectName] = catalogPosePivot(objectName, rep, model)
    }
    const overlayLayer = isOverlayLayerCube(model, index)
    const box = inflateCube(cube, overlayLayer)
    const [uw, uh, ud] = cube.uvSize ?? cube.size
    const pivot = cube.pivot
    const rot = cube.rotation
    const blockFaceTextures = catalogBlockFaceTextures(model.id, objectName)
    const boneTexFile = catalogBoneTextureFile(model.id, objectName)
    const boneAtlas =
      boneTexFile && extraAtlases
        ? extraAtlases[boneTexFile.toLowerCase()] ?? null
        : null
    for (const face of FACES) {
      if (!faceHasArea(box.from, box.to, face)) continue
      let uv: UvRect | null
      let faceTexW = texW
      let faceTexH = texH
      let faceMat: string | null = null
      if (blockFaceTextures) {
        const pngFile = blockFaceTextures[face]
        if (!pngFile) continue
        faceMat = blockTextureMaterialName(pngFile)
        faceTexW = 16
        faceTexH = 16
        uv = blockTextureFaceUv(face)
      } else if (boneTexFile) {
        faceMat = blockTextureMaterialName(boneTexFile)
        if (boneAtlas) {
          faceTexW = boneAtlas.width
          faceTexH = boneAtlas.height
        }
        if (isBoxUv(cube.uv)) {
          uv = boxFaceUv(cube.uv[0], cube.uv[1], uw, uh, ud, face, Boolean(cube.mirror))
        } else {
          const faceUv = cube.uv[face]
          if (!faceUv) continue
          uv = perFaceRect(faceUv)
          if (cube.mirror) uv = { ...uv, flipX: !uv.flipX }
        }
      } else if (isBoxUv(cube.uv)) {
        uv = boxFaceUv(cube.uv[0], cube.uv[1], uw, uh, ud, face, Boolean(cube.mirror))
      } else {
        const faceUv = cube.uv[face]
        if (!faceUv) continue
        uv = perFaceRect(faceUv)
        if (cube.mirror) uv = { ...uv, flipX: !uv.flipX }
      }
      if (Math.abs(uv.w) < 1e-4 || Math.abs(uv.h) < 1e-4) continue
      const pts = corners(box.from, box.to, face).map((p) => {
        let point = pivot && rot ? rotateAround(p, pivot, rot) : p
        for (const step of cube.parents ?? []) {
          point = rotateAround(point, step.pivot, step.rotation)
        }
        return faceCamera(point)
      })
      // Half-texel inset so nearest sampling stays inside this face's pixels
      // (0.02 still let round/floor hit the next atlas column on Steve's face).
      const inset = 0.5
      const u0 = (uv.x + inset) / faceTexW
      const u1 = (uv.x + uv.w - inset) / faceTexW
      const v0 = 1 - (uv.y + uv.h - inset) / faceTexH
      const v1 = 1 - (uv.y + inset) / faceTexH
      const left = uv.flipX ? u1 : u0
      const right = uv.flipX ? u0 : u1
      const top = uv.flipY ? v0 : v1
      const bottom = uv.flipY ? v1 : v0
      const uvPts: [number, number][] = [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ]
      // Bake atlas RGB onto vertices so convert still colours the mesh if map_Kd
      // fails to bind (that path used to stamp everything as grey → white wool).
      const sampleAtlas = boneAtlas ?? atlas
      const sampleFallback = boneAtlas
        ? averageOpaqueRgb(boneAtlas)
        : avgOpaque
      const pi = pts.map((point, corner) => {
        const [uu, vv] = uvPts[corner]!
        const rgb = sampleAtlas
          ? sampleAtlasRgb(sampleAtlas, uu, vv, sampleFallback)
          : sampleFallback
        return addPos(point, rgb)
      })
      const ti = uvPts.map(([a, b]) => addUv(a, b))
      // Z-flip reverses winding; emit TL-TR-BR-BL so fronts still face out.
      const faceLine = `f ${pi[0]!}/${ti[0]!} ${pi[1]!}/${ti[1]!} ${pi[3]!}/${ti[3]!} ${pi[2]!}/${ti[2]!}`
      const bucket = facesByName.get(objectName) ?? { inner: [], overlay: [] }
      if ((blockFaceTextures || boneTexFile) && faceMat) {
        bucket.inner.push({ mat: faceMat, line: faceLine })
      } else if (overlayLayer) {
        bucket.overlay.push(faceLine)
      } else {
        bucket.inner.push({ mat: 'entity', line: faceLine })
      }
      facesByName.set(objectName, bucket)
    }
  }

  const blockMats = new Map<string, string>()
  for (const pngFile of new Set(Object.values(catalogExtraMaterials(model.id)))) {
    blockMats.set(blockTextureMaterialName(pngFile), pngFile)
  }

  const kd = `${avgOpaque[0].toFixed(4)} ${avgOpaque[1].toFixed(4)} ${avgOpaque[2].toFixed(4)}`
  const mtlLines = [
    '# entity',
    'newmtl entity',
    `Kd ${kd}`,
    `map_Kd ${textureFile}`,
    '',
    'newmtl entity_overlay',
    `Kd ${kd}`,
    `map_Kd ${textureFile}`,
    '',
  ]
  for (const [matName, file] of blockMats) {
    mtlLines.push(
      `newmtl ${matName}`,
      `Kd ${kd}`,
      `map_Kd ${file}`,
      '',
    )
  }
  const mtl = mtlLines.join('\n')
  const obj = [
    `mtllib entity.mtl`,
    ...positions.map(({ p: [x, y, z], rgb: [r, g, b] }) => `v ${x} ${y} ${z} ${r} ${g} ${b}`),
    ...uvs.map(([u, v]) => `vt ${u} ${v}`),
    ...[...facesByName.entries()]
      // Jaw before head so Enderman eyes stamp after the mouth shell where the
      // inset jaw still overlaps the lower face (angry lift leaves ~3px overlap).
      .sort(([a], [b]) => objExportOrder(a) - objExportOrder(b))
      .flatMap(([name, bucket]) => {
      const lines = [`o ${name}`]
      if (bucket.inner.length > 0) {
        let currentMat = ''
        for (const entry of bucket.inner) {
          if (entry.mat !== currentMat) {
            lines.push(`usemtl ${entry.mat}`)
            currentMat = entry.mat
          }
          lines.push(entry.line)
        }
      }
      if (bucket.overlay.length > 0) {
        lines.push('usemtl entity_overlay', ...bucket.overlay)
      }
      return lines
    }),
    '',
  ].join('\n')
  return { obj, mtl, pivots }
}

/** Sample atlas at OpenGL UV. Transparent texels stay empty (caller fallback).
 *  Nearby-opaque search used to paint 1px cutouts (shulker rims, enderman edges). */
function sampleAtlasRgb(
  atlas: PngRgba,
  u: number,
  v: number,
  fallback: [number, number, number],
): [number, number, number] {
  const w = atlas.width
  const h = atlas.height
  if (w < 1 || h < 1) return fallback
  const wrap = (n: number) => {
    if (n >= -0.02 && n <= 1.02) return Math.min(1, Math.max(0, n))
    const wrapped = n % 1
    return wrapped < 0 ? wrapped + 1 : wrapped
  }
  const uu = wrap(u)
  const vv = 1 - wrap(v)
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(uu * w)))
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(vv * h)))
  const at = (x: number, y: number): [number, number, number, number] | null => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null
    const i = (y * w + x) * 4
    return [atlas.data[i]!, atlas.data[i + 1]!, atlas.data[i + 2]!, atlas.data[i + 3]!]
  }
  const direct = at(x0, y0)
  if (direct && direct[3] >= 20) {
    return [direct[0] / 255, direct[1] / 255, direct[2] / 255]
  }
  return fallback
}

function averageOpaqueRgb(atlas: PngRgba): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const step = Math.max(1, Math.floor(Math.max(atlas.width, atlas.height) / 32))
  for (let y = 0; y < atlas.height; y += step) {
    for (let x = 0; x < atlas.width; x += step) {
      const i = (y * atlas.width + x) * 4
      if (atlas.data[i + 3]! < 20) continue
      r += atlas.data[i]!
      g += atlas.data[i + 1]!
      b += atlas.data[i + 2]!
      n += 1
    }
  }
  if (n < 1) return [0.72, 0.74, 0.78]
  return [r / n / 255, g / n / 255, b / n / 255]
}

function posedCubePoint(cube: EntityCube, p: [number, number, number]): [number, number, number] {
  let point = cube.pivot && cube.rotation ? rotateAround(p, cube.pivot, cube.rotation) : p
  for (const step of cube.parents ?? []) {
    point = rotateAround(point, step.pivot, step.rotation)
  }
  return faceCamera(point)
}

function nativeEntitySize(model: VanillaHumanoid): { width: number; height: number; length: number } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < model.cubes.length; i += 1) {
    const cube = model.cubes[i]!
    // Overlay inflate (hat 0.5 / jacket 0.25) must not grow the statue grid.
    // Convert strips those shells, so a 16×32×8 Steve was landing in 17×33×9
    // and the face sat one block off.
    if (isOverlayLayerCube(model, i)) continue
    const box = inflateCube(cube, false)
    const corners8: [number, number, number][] = [
      [box.from[0], box.from[1], box.from[2]],
      [box.from[0], box.from[1], box.to[2]],
      [box.from[0], box.to[1], box.from[2]],
      [box.from[0], box.to[1], box.to[2]],
      [box.to[0], box.from[1], box.from[2]],
      [box.to[0], box.from[1], box.to[2]],
      [box.to[0], box.to[1], box.from[2]],
      [box.to[0], box.to[1], box.to[2]],
    ]
    for (const corner of corners8) {
      const [x, y, z] = posedCubePoint(cube, corner)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
  }
  if (!Number.isFinite(minX)) {
    return { width: 16, height: 32, length: 8 }
  }
  return clampVoxelBox({
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
    length: Math.max(1, Math.ceil(maxZ - minZ)),
  })
}

function poseParentsForModel(
  model: VanillaHumanoid,
  objectNames: string[],
): Record<string, string> {
  return buildCatalogPoseParents(model, objectNames)
}

export async function entityModelToPart(
  model: VanillaHumanoid,
  textureFile: string,
  textureBytes: Uint8Array,
  displayName: string,
  extraTextures?: Record<string, Uint8Array>,
): Promise<ScenePartLocal> {
  const altMatFiles = catalogExtraMaterials(model.id)
  let atlas = await decodePngRgba(textureBytes)
  if (!atlas) {
    // Canvas-rebaked PNGs / odd filters: fall back to the browser decoder so
    // convert still gets per-vertex colours (otherwise Kd alone → one wool).
    const { decodeImageRgba } = await import('./decodeImage')
    const rgba = await decodeImageRgba(textureBytes)
    if (rgba) atlas = { width: rgba.width, height: rgba.height, data: rgba.data }
  }
  const extraAtlases: Record<string, PngRgba> = {}
  for (const [matKey, matFile] of Object.entries(altMatFiles)) {
    const bytes = extraTextures?.[matKey]
    if (!bytes) continue
    let decoded = await decodePngRgba(bytes)
    if (!decoded) {
      const { decodeImageRgba } = await import('./decodeImage')
      const rgba = await decodeImageRgba(bytes)
      if (rgba) decoded = { width: rgba.width, height: rgba.height, data: rgba.data }
    }
    if (decoded) extraAtlases[matFile.toLowerCase()] = decoded
  }
  const { obj, mtl, pivots } = entityModelToObj(
    model,
    textureFile,
    pngPixelSize(textureBytes) ?? (atlas ? [atlas.width, atlas.height] : null),
    atlas,
    extraAtlases,
  )
  const file = `${model.id}.obj`
  const size = nativeEntitySize(model)
  const poseable = Object.keys(pivots).filter((name) => !name.endsWith('_overlay'))
  const textures: Record<string, Uint8Array> = {
    [textureFile.toLowerCase()]: textureBytes,
  }
  // Alias by model id only when it differs — angry Enderman used to register
  // both enderman.png and enderman_angry.png, which broke Rust's "single
  // sidecar texture" fallback when map_Kd name matching missed (no eyes).
  const idAlias = `${model.id}.png`.toLowerCase()
  if (idAlias !== textureFile.toLowerCase()) {
    textures[idAlias] = textureBytes
  }
  for (const [matKey, matFile] of Object.entries(altMatFiles)) {
    const bytes = extraTextures?.[matKey]
    if (bytes) textures[matFile.toLowerCase()] = bytes
  }
  const parts = Object.fromEntries(poseable.map((name) => [name, emptyPartPose()]))
  // Angry mouth is baked into head geometry (see patchEnderman) — no skinPose lift.
  return {
    ...createObjPart(file, utf8(obj)),
    name: displayName,
    mtlBytes: utf8(mtl),
    mtlFileName: 'entity.mtl',
    expectedMtlFileName: 'entity.mtl',
    textures,
    expectedTextureNames: Object.keys(textures),
    sourceLabel: `Minecraft entity · ${model.id} · ${model.cubes.length} cubes`,
    skinPose: {
      root: emptyPartPose(),
      parts,
      pivots,
      rigid: true,
      poseParents: poseParentsForModel(model, Object.keys(pivots)),
    },
    skinPoseEuler: 'blockbench',
    width: size.width,
    height: size.height,
    length: size.length,
    objSizePreset: 'custom',
    fit: 'stretch',
    meshRigMode: 'classic',
    meshSkinMode: 'rigid',
    // Entity cubes are 6-face shells; solid fill at statue scale floods the grid.
    hollow: true,
  }
}
