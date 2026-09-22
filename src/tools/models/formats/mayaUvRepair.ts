/**
 * Repair unevaluated Maya UV history leftovers on painted body atlases:
 * - high-span 2D smear islands (few UV corners stretched across the sheet)
 * - compact limb islands sampling lip/cloth/headband paint → skin
 * - mouth band island far from lip paint → translate onto lip cluster
 *
 * Cylindrical wrap seams (U 0–1 on a thin strip) and hair/eye meshes are left
 * alone. Limb/shirt cleanup only runs after true projection smear is found.
 *
 * Always allocates new UV indices (never mutates shared UV ids).
 */
export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Tri = [number, number, number]
export type RgbaTex = { width: number; height: number; data: Uint8ClampedArray }

function aabbOf(positions: Vec3[]) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (const p of positions) {
    minX = Math.min(minX, p[0])
    minY = Math.min(minY, p[1])
    minZ = Math.min(minZ, p[2])
    maxX = Math.max(maxX, p[0])
    maxY = Math.max(maxY, p[1])
    maxZ = Math.max(maxZ, p[2])
  }
  return {
    min: [minX, minY, minZ] as Vec3,
    max: [maxX, maxY, maxZ] as Vec3,
    size: [maxX - minX, maxY - minY, maxZ - minZ] as Vec3,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as Vec3,
  }
}

function triangleUvSpan(uvs: Vec2[], tri: Tri): number {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity
  for (const i of tri) {
    const p = uvs[i]
    if (!p) continue
    minU = Math.min(minU, p[0])
    maxU = Math.max(maxU, p[0])
    minV = Math.min(minV, p[1])
    maxV = Math.max(maxV, p[1])
  }
  if (!Number.isFinite(minU)) return 0
  return Math.max(maxU - minU, maxV - minV)
}

function densestUvClusterCenter(pts: Vec2[], cell: number): Vec2 | null {
  if (pts.length < 4) return null
  const buckets = new Map<string, { n: number; su: number; sv: number }>()
  for (const [u, v] of pts) {
    const key = `${Math.floor(u / cell)},${Math.floor(v / cell)}`
    const b = buckets.get(key) ?? { n: 0, su: 0, sv: 0 }
    b.n += 1
    b.su += u
    b.sv += v
    buckets.set(key, b)
  }
  let best: { n: number; su: number; sv: number } | null = null
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b
  }
  if (!best || best.n < 4) return null
  return [best.su / best.n, best.sv / best.n]
}

function sampleTexRgb(tex: RgbaTex, u: number, v: number): [number, number, number] {
  const uu = ((u % 1) + 1) % 1
  const vv = ((v % 1) + 1) % 1
  const x = Math.min(tex.width - 1, Math.max(0, Math.round(uu * (tex.width - 1))))
  const y = Math.min(tex.height - 1, Math.max(0, Math.round((1 - vv) * (tex.height - 1))))
  const i = (y * tex.width + x) * 4
  return [tex.data[i]!, tex.data[i + 1]!, tex.data[i + 2]!]
}

function isSkinRgb(r: number, g: number, b: number): boolean {
  return r > 195 && g > 150 && b > 130 && r >= g && g >= b - 10
}
function isClothRedRgb(r: number, g: number, b: number): boolean {
  return r > 160 && g < 90 && b < 90 && r > g + 60
}
function isOliveLike(r: number, g: number, b: number): boolean {
  return g > 110 && r < 200 && b < 130 && g >= r - 10 && g > b
}
function isLipFillRgb(r: number, g: number, b: number): boolean {
  return r > 70 && r < 190 && g < 100 && b < 100 && r > g + 25 && r > b + 20
}
function isNearBlackRgb(r: number, g: number, b: number): boolean {
  return r + g + b < 70
}

function triangleUvAabb(uvs: Vec2[], tri: Tri): { spanU: number; spanV: number } | null {
  const a = uvs[tri[0]!]
  const b = uvs[tri[1]!]
  const c = uvs[tri[2]!]
  if (!a || !b || !c) return null
  const minU = Math.min(a[0], b[0], c[0])
  const maxU = Math.max(a[0], b[0], c[0])
  const minV = Math.min(a[1], b[1], c[1])
  const maxV = Math.max(a[1], b[1], c[1])
  return { spanU: maxU - minU, spanV: maxV - minV }
}

/** True when a triangle covers a 2D swath of the atlas, not a thin wrap seam. */
function triangleLooksProjectedSmear(uvs: Vec2[], tri: Tri): boolean {
  if (triangleUvSpan(uvs, tri) <= 0.25) return false
  const box = triangleUvAabb(uvs, tri)
  if (!box) return false
  return Math.min(box.spanU, box.spanV) > 0.18
}

function islandUvBounds(
  island: number[],
  uvs: Vec2[],
  triangleUvs: Tri[],
): { unique: number; spanU: number; spanV: number } | null {
  const used = new Set<number>()
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const ti of island) {
    const tuv = triangleUvs[ti]
    if (!tuv) continue
    for (const vi of tuv) {
      used.add(vi)
      const uv = uvs[vi]
      if (!uv) continue
      minU = Math.min(minU, uv[0])
      maxU = Math.max(maxU, uv[0])
      minV = Math.min(minV, uv[1])
      maxV = Math.max(maxV, uv[1])
    }
  }
  if (!Number.isFinite(minU) || used.size === 0) return null
  return { unique: used.size, spanU: maxU - minU, spanV: maxV - minV }
}

/**
 * Unevaluated cylindrical/planar projections leave a handful of UV corners
 * stretched across the sheet. Authored unwraps often wrap 0–1 on one axis
 * (a thin seam strip) — those must not be remapped onto Hank-style atlas stamps.
 */
function islandUvLooksProjectedSmear(
  island: number[],
  uvs: Vec2[],
  triangleUvs: Tri[],
): boolean {
  const b = islandUvBounds(island, uvs, triangleUvs)
  if (!b) return false
  const minSpan = Math.min(b.spanU, b.spanV)
  const maxSpan = Math.max(b.spanU, b.spanV)
  if (maxSpan <= 0.25) return false
  // Thin cylindrical/planar wrap (one axis ~0–1, the other a strip).
  if (maxSpan > 0.65 && minSpan < 0.28) return false
  // Short wrap strips: a couple of tris spanning 0–1, not a projected island.
  if (island.length < 10 && maxSpan > 0.7) return false
  // Unevaluated projection leftover: many faces sharing a few UV corners
  // stretched across a 2D swath of the sheet.
  if (island.length >= 16 && minSpan > 0.35 && b.unique <= 12) return true
  if (island.length >= 16 && minSpan > 0.5 && b.unique <= 24) return true
  return false
}

const ACCESSORY_MESH_OR_TEXTURE = /hair|wig|lash|brow|hat|cap|glass|spectac/i
function isShirtishRgb(r: number, g: number, b: number): boolean {
  if (isSkinRgb(r, g, b) || isLipFillRgb(r, g, b) || isClothRedRgb(r, g, b)) return false
  const bright = r > 180 && g > 180 && b > 180
  const grey = Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r > 120 && r < 210
  return bright || grey
}
/** Shoe / hair / dark-brown atlas stamps (not skin, not cloth red, not lip). */
function isBrownStampRgb(r: number, g: number, b: number): boolean {
  if (isSkinRgb(r, g, b) || isLipFillRgb(r, g, b) || isClothRedRgb(r, g, b)) return false
  return r > 35 && r < 150 && g > 15 && g < 110 && b < 80 && r >= g - 5 && g >= b - 15 && r + g + b < 300
}

/** Densest red-cloth cluster on the atlas (shorts / shirt blocks). */
function densestClothRedUvTarget(tex: RgbaTex): Vec2 | null {
  const cell = 0.05
  const buckets = new Map<string, { n: number; su: number; sv: number }>()
  const step = Math.max(1, Math.floor(Math.min(tex.width, tex.height) / 128))
  for (let y = 0; y < tex.height; y += step) {
    for (let x = 0; x < tex.width; x += step) {
      const i = (y * tex.width + x) * 4
      const r = tex.data[i]!
      const g = tex.data[i + 1]!
      const b = tex.data[i + 2]!
      if (!isClothRedRgb(r, g, b)) continue
      const u = x / Math.max(1, tex.width - 1)
      const v = 1 - y / Math.max(1, tex.height - 1)
      if (v > 0.92 || v < 0.04) continue
      const key = `${Math.floor(u / cell)},${Math.floor(v / cell)}`
      const bk = buckets.get(key) ?? { n: 0, su: 0, sv: 0 }
      bk.n += 1
      bk.su += u
      bk.sv += v
      buckets.set(key, bk)
    }
  }
  let best: { n: number; su: number; sv: number } | null = null
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b
  }
  if (!best || best.n < 8) return null
  return [best.su / best.n, best.sv / best.n]
}

function densestOliveUvTarget(tex: RgbaTex): Vec2 | null {
  const cell = 0.05
  const buckets = new Map<string, { n: number; su: number; sv: number }>()
  const step = Math.max(1, Math.floor(Math.min(tex.width, tex.height) / 128))
  for (let y = 0; y < tex.height; y += step) {
    for (let x = 0; x < tex.width; x += step) {
      const i = (y * tex.width + x) * 4
      const r = tex.data[i]!
      const g = tex.data[i + 1]!
      const b = tex.data[i + 2]!
      if (!isOliveLike(r, g, b)) continue
      const u = x / Math.max(1, tex.width - 1)
      const v = 1 - y / Math.max(1, tex.height - 1)
      if (v > 0.9 || v < 0.08) continue
      // Prefer mid-atlas crop-top greens, not face-feature strip.
      if (u < 0.2) continue
      const key = `${Math.floor(u / cell)},${Math.floor(v / cell)}`
      const bk = buckets.get(key) ?? { n: 0, su: 0, sv: 0 }
      bk.n += 1
      bk.su += u
      bk.sv += v
      buckets.set(key, bk)
    }
  }
  let best: { n: number; su: number; sv: number } | null = null
  for (const b of buckets.values()) {
    if (!best || b.n > best.n) best = b
  }
  if (!best || best.n < 8) return null
  return [best.su / best.n, best.sv / best.n]
}

function findLipUvCentroid(tex: RgbaTex): Vec2 | null {
  const cell = 16
  const buckets = new Map<string, { n: number; sx: number; sy: number }>()
  const y0 = Math.floor(tex.height * 0.25)
  const y1 = Math.floor(tex.height * 0.85)
  const x1 = Math.floor(tex.width * 0.55)
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < x1; x++) {
      const i = (y * tex.width + x) * 4
      if (!isLipFillRgb(tex.data[i]!, tex.data[i + 1]!, tex.data[i + 2]!)) continue
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`
      const b = buckets.get(key) ?? { n: 0, sx: 0, sy: 0 }
      b.n += 1
      b.sx += x
      b.sy += y
      buckets.set(key, b)
    }
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n)
  if (!ranked[0] || ranked[0].n < 20) return null
  const best = ranked[0]
  return [best.sx / best.n / tex.width, 1 - best.sy / best.n / tex.height]
}

function densestSkinUvTargets(
  tex: RgbaTex,
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  limit = 4,
): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i < triangles.length; i++) {
    if (triangleUvSpan(uvs, triangleUvs[i]!) > 0.08) continue
    const tuv = triangleUvs[i]!
    const u = (uvs[tuv[0]!]![0] + uvs[tuv[1]!]![0] + uvs[tuv[2]!]![0]) / 3
    const v = (uvs[tuv[0]!]![1] + uvs[tuv[1]!]![1] + uvs[tuv[2]!]![1]) / 3
    const [r, g, b] = sampleTexRgb(tex, u, v)
    if (!isSkinRgb(r, g, b)) continue
    if (v > 0.88 || v < 0.12) continue
    // Avoid left face-feature strip (lips / eyes parked on atlas).
    if (u < 0.25 && v > 0.3 && v < 0.6) continue
    pts.push([u, v])
  }
  if (pts.length < 4) return []
  const cell = 0.04
  const buckets = new Map<string, { n: number; su: number; sv: number }>()
  for (const [u, v] of pts) {
    const key = `${Math.floor(u / cell)},${Math.floor(v / cell)}`
    const b = buckets.get(key) ?? { n: 0, su: 0, sv: 0 }
    b.n += 1
    b.su += u
    b.sv += v
    buckets.set(key, b)
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .filter((b) => b.n >= 4)
    .slice(0, limit)
    .map((b) => [b.su / b.n, b.sv / b.n] as Vec2)
}

function buildTriNbrs(triangles: Tri[]): Map<number, number[]> {
  const edgeTris = new Map<string, number[]>()
  const bump = (a: number, b: number, ti: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    const arr = edgeTris.get(k) ?? []
    arr.push(ti)
    edgeTris.set(k, arr)
  }
  for (let ti = 0; ti < triangles.length; ti++) {
    const [a, b, c] = triangles[ti]!
    bump(a, b, ti)
    bump(b, c, ti)
    bump(c, a, ti)
  }
  const triNbrs = new Map<number, number[]>()
  for (const [, tris] of edgeTris) {
    if (tris.length < 2) continue
    for (let i = 0; i < tris.length; i++) {
      for (let j = 0; j < tris.length; j++) {
        if (i === j) continue
        const arr = triNbrs.get(tris[i]!) ?? []
        if (!arr.includes(tris[j]!)) arr.push(tris[j]!)
        triNbrs.set(tris[i]!, arr)
      }
    }
  }
  return triNbrs
}

/** Try several skin targets until the remapped island mostly samples skin. */
function remapIslandOntoSkin(
  positions: Vec3[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  island: number[],
  skinTargets: Vec2[],
  tex: RgbaTex,
  minSkinFrac = 0.35,
  clothingGuard?: {
    tex: RgbaTex
    box: ReturnType<typeof aabbOf>
    ySpan: number
    health: ClothingBandHealth
  },
): { ok: boolean; uvs: Vec2[]; triangleUvs: Tri[] } {
  for (const target of skinTargets) {
    const rem = remapIslandNewUvs(
      positions,
      uvs,
      triangles,
      triangleUvs,
      island,
      target,
      0.035,
      clothingGuard,
    )
    if (!rem.ok) continue
    let skinHits = 0
    let badHits = 0
    let n = 0
    const work = clothingGuard
      ? filterUnprotectedClothingTris(
          island,
          positions,
          uvs,
          triangles,
          triangleUvs,
          clothingGuard.tex,
          clothingGuard.box,
          clothingGuard.ySpan,
          clothingGuard.health,
        )
      : island
    for (const ti of work) {
      for (const uid of rem.triangleUvs[ti]!) {
        const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
        if (isSkinRgb(r, g, b)) skinHits += 1
        if (
          isLipFillRgb(r, g, b) ||
          isClothRedRgb(r, g, b) ||
          isBrownStampRgb(r, g, b) ||
          isNearBlackRgb(r, g, b)
        ) {
          badHits += 1
        }
        n += 1
      }
    }
    if (!n) continue
    const skinFrac = skinHits / n
    // Never accept a placement that is mostly lips / cloth / brown stamps.
    if (badHits / n > 0.35) continue
    if (skinFrac >= Math.max(minSkinFrac, 0.15)) return rem
  }
  return { ok: false, uvs, triangleUvs }
}

function remapIslandNewUvs(
  positions: Vec3[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  island: number[],
  target: Vec2,
  scaleTarget = 0.035,
  clothingGuard?: {
    tex: RgbaTex
    box: ReturnType<typeof aabbOf>
    ySpan: number
    health: ClothingBandHealth
  },
): { ok: boolean; uvs: Vec2[]; triangleUvs: Tri[] } {
  const work = clothingGuard
    ? filterUnprotectedClothingTris(
        island,
        positions,
        uvs,
        triangles,
        triangleUvs,
        clothingGuard.tex,
        clothingGuard.box,
        clothingGuard.ySpan,
        clothingGuard.health,
      )
    : island
  if (work.length < 1) return { ok: false, uvs, triangleUvs }

  const newUvs = uvs.map((p): Vec2 => [p[0], p[1]])
  const newTriUvs = triangleUvs.map((t): Tri => [t[0], t[1], t[2]])

  const vertSet = new Set<number>()
  let cx = 0,
    cy = 0,
    cz = 0,
    cN = 0
  for (const ti of work) {
    for (const vi of triangles[ti]!) {
      vertSet.add(vi)
      const p = positions[vi]
      if (!p) continue
      cx += p[0]
      cy += p[1]
      cz += p[2]
      cN += 1
    }
  }
  if (vertSet.size < 3 || cN < 3) return { ok: false, uvs: newUvs, triangleUvs: newTriUvs }
  cx /= cN
  cy /= cN
  cz /= cN

  const local = new Map<number, Vec2>()
  for (const vi of vertSet) {
    const p = positions[vi]!
    local.set(vi, [Math.atan2(p[0] - cx, p[2] - cz) / Math.PI, p[1] - cy])
  }
  let mu = 0,
    mv = 0,
    n = 0
  for (const p of local.values()) {
    mu += p[0]
    mv += p[1]
    n += 1
  }
  mu /= n
  mv /= n
  let maxD = 0
  for (const p of local.values()) maxD = Math.max(maxD, Math.hypot(p[0] - mu, p[1] - mv))
  const scale = maxD > 1e-8 ? scaleTarget / maxD : 1

  const vertToUv = new Map<number, number>()
  for (const vi of vertSet) {
    const loc = local.get(vi)!
    const idx = newUvs.length
    newUvs.push([(loc[0] - mu) * scale + target[0], (loc[1] - mv) * scale + target[1]])
    vertToUv.set(vi, idx)
  }
  for (const ti of work) {
    const tri = triangles[ti]!
    newTriUvs[ti] = [vertToUv.get(tri[0]!)!, vertToUv.get(tri[1]!)!, vertToUv.get(tri[2]!)!]
  }
  return { ok: true, uvs: newUvs, triangleUvs: newTriUvs }
}

function uvConnectedIslands(seed: number[], triangleUvs: Tri[]): number[][] {
  const uvToTris = new Map<number, number[]>()
  const seedSet = new Set(seed)
  for (const ti of seed) {
    for (const uid of triangleUvs[ti]!) {
      const arr = uvToTris.get(uid) ?? []
      arr.push(ti)
      uvToTris.set(uid, arr)
    }
  }
  const visited = new Set<number>()
  const islands: number[][] = []
  for (const start of seed) {
    if (visited.has(start)) continue
    const stack = [start]
    const island: number[] = []
    visited.add(start)
    while (stack.length) {
      const ti = stack.pop()!
      island.push(ti)
      for (const uid of triangleUvs[ti]!) {
        for (const other of uvToTris.get(uid) ?? []) {
          if (!seedSet.has(other) || visited.has(other)) continue
          visited.add(other)
          stack.push(other)
        }
      }
    }
    islands.push(island)
  }
  return islands
}

type BodyBand = 'shorts' | 'shirt' | 'limb' | 'other'

type ClothingBandHealth = {
  shortsHealthy: boolean
  shirtHealthy: boolean
  shortsSampled: number
  shirtSampled: number
}

function torsoHalfWidth(box: ReturnType<typeof aabbOf>): number {
  return box.size[0] * 0.22
}

function isInShortsPelvisZone(yRel: number, absX: number, box: ReturnType<typeof aabbOf>): boolean {
  return yRel >= 0.26 && yRel <= 0.68 && absX <= box.size[0] * 0.28
}

function classifyBodyBand(yRel: number, absX: number, box: ReturnType<typeof aabbOf>): BodyBand {
  const torsoX = torsoHalfWidth(box)
  if (yRel >= 0.32 && yRel <= 0.66 && absX <= torsoX) return 'shorts'
  if (yRel >= 0.6 && yRel <= 0.76 && absX < box.size[0] * 0.18) return 'shirt'
  if (yRel > 0.06 && yRel < 0.62 && absX > box.size[0] * 0.06) return 'limb'
  return 'other'
}

function bandMaterialMatches(band: BodyBand, r: number, g: number, b: number): boolean {
  if (band === 'shorts') return isClothRedRgb(r, g, b)
  if (band === 'shirt') return isOliveLike(r, g, b) || isShirtishRgb(r, g, b)
  return true
}

/** True when authored shorts/shirt UVs already sample the right atlas paint. */
export function assessClothingBandHealth(
  positions: Vec3[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  tex: RgbaTex,
  box: ReturnType<typeof aabbOf>,
  ySpan: number,
): ClothingBandHealth {
  let shortsOk = 0
  let shortsTotal = 0
  let shirtOk = 0
  let shirtTotal = 0

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i]!
    let x = 0
    let y = 0
    let ok = true
    for (const vi of tri) {
      const p = positions[vi]
      if (!p) {
        ok = false
        break
      }
      x += p[0]
      y += p[1]
    }
    if (!ok) continue
    x /= 3
    y /= 3
    const yRel = (y - box.min[1]) / ySpan
    const band = classifyBodyBand(yRel, Math.abs(x), box)
    if (band !== 'shorts' && band !== 'shirt') continue
    if (triangleUvSpan(uvs, triangleUvs[i]!) > 0.35) continue

    const tuv = triangleUvs[i]!
    const u = (uvs[tuv[0]!]![0] + uvs[tuv[1]!]![0] + uvs[tuv[2]!]![0]) / 3
    const v = (uvs[tuv[0]!]![1] + uvs[tuv[1]!]![1] + uvs[tuv[2]!]![1]) / 3
    const [r, g, b] = sampleTexRgb(tex, u, v)
    const matches = bandMaterialMatches(band, r, g, b)

    if (band === 'shorts') {
      shortsTotal += 1
      if (matches) shortsOk += 1
    } else {
      shirtTotal += 1
      if (matches) shirtOk += 1
    }
  }

  return {
    shortsHealthy: shortsTotal >= 12 && shortsOk / shortsTotal >= 0.55,
    shirtHealthy: shirtTotal >= 12 && shirtOk / shirtTotal >= 0.55,
    shortsSampled: shortsTotal,
    shirtSampled: shirtTotal,
  }
}

function faceSamplesClothingBleed(
  band: BodyBand,
  r: number,
  g: number,
  b: number,
): boolean {
  if (band === 'shorts') {
    return (
      isLipFillRgb(r, g, b) ||
      isOliveLike(r, g, b) ||
      isBrownStampRgb(r, g, b) ||
      isNearBlackRgb(r, g, b) ||
      isShirtishRgb(r, g, b)
    )
  }
  if (band === 'shirt') {
    return (
      isLipFillRgb(r, g, b) ||
      isClothRedRgb(r, g, b) ||
      isBrownStampRgb(r, g, b) ||
      (isNearBlackRgb(r, g, b) && g > 40)
    )
  }
  return false
}

/** Skip remapping when authored clothing UVs already sample the intended atlas paint. */
function isProtectedClothingFace(
  yRel: number,
  absX: number,
  box: ReturnType<typeof aabbOf>,
  health: ClothingBandHealth,
  r: number,
  g: number,
  b: number,
): boolean {
  if (
    health.shortsHealthy &&
    yRel >= 0.26 &&
    yRel <= 0.68 &&
    absX <= box.size[0] * 0.28 &&
    isClothRedRgb(r, g, b)
  ) {
    return true
  }
  if (
    health.shirtHealthy &&
    yRel >= 0.58 &&
    yRel <= 0.78 &&
    absX <= box.size[0] * 0.22 &&
    bandMaterialMatches('shirt', r, g, b)
  ) {
    return true
  }
  const band = classifyBodyBand(yRel, absX, box)
  if (band === 'shorts' && health.shortsHealthy && bandMaterialMatches('shorts', r, g, b)) {
    return true
  }
  if (band === 'shirt' && health.shirtHealthy && bandMaterialMatches('shirt', r, g, b)) {
    return true
  }
  return false
}

function filterUnprotectedClothingTris(
  island: number[],
  positions: Vec3[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  tex: RgbaTex,
  box: ReturnType<typeof aabbOf>,
  ySpan: number,
  health: ClothingBandHealth,
): number[] {
  return island.filter((ti) => {
    const tri = triangles[ti]
    if (!tri) return false
    let x = 0
    let y = 0
    let ok = true
    for (const vi of tri) {
      const p = positions[vi]
      if (!p) {
        ok = false
        break
      }
      x += p[0]
      y += p[1]
    }
    if (!ok) return true
    x /= 3
    y /= 3
    const yRel = (y - box.min[1]) / ySpan
    const tuv = triangleUvs[ti]
    if (!tuv) return true
    const u = (uvs[tuv[0]!]![0] + uvs[tuv[1]!]![0] + uvs[tuv[2]!]![0]) / 3
    const v = (uvs[tuv[0]!]![1] + uvs[tuv[1]!]![1] + uvs[tuv[2]!]![1]) / 3
    const [r, g, b] = sampleTexRgb(tex, u, v)
    return !isProtectedClothingFace(yRel, Math.abs(x), box, health, r, g, b)
  })
}

export type AtlasUvRepairResult = {
  uvs: Vec2[]
  triangleUvs: Tri[]
  smearedTris: number
  limbTris: number
  mouthUvs: number
}

/**
 * When a body atlas PNG is available, rebuild smeared / misplaced UV islands.
 * Skips small accessory meshes (eyes, etc.) — those atlases are not body sheets.
 */
export function repairAtlasUvsFromTexture(
  positions: Vec3[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[] | null,
  tex: RgbaTex,
  meshName = '',
  textureFileName = '',
): AtlasUvRepairResult {
  if (!triangleUvs || triangles.length !== triangleUvs.length || uvs.length < 3 || triangles.length < 32) {
    return { uvs, triangleUvs: triangleUvs ?? [], smearedTris: 0, limbTris: 0, mouthUvs: 0 }
  }
  // Eyes / iris / pupils use tiny atlases — body limb/mouth heuristics misfire.
  if (/eye|pupil|iris|sclera/i.test(meshName) || /eye|pupil|iris|sclera/i.test(textureFileName)) {
    return { uvs, triangleUvs, smearedTris: 0, limbTris: 0, mouthUvs: 0 }
  }
  // Hair / hat / glasses sheets are not Hank-style body atlases; "smear" spans are authored.
  if (ACCESSORY_MESH_OR_TEXTURE.test(meshName) || ACCESSORY_MESH_OR_TEXTURE.test(textureFileName)) {
    return { uvs, triangleUvs, smearedTris: 0, limbTris: 0, mouthUvs: 0 }
  }
  // Only run full atlas repair on substantial body-like meshes.
  if (triangles.length < 200) {
    return { uvs, triangleUvs, smearedTris: 0, limbTris: 0, mouthUvs: 0 }
  }

  const box = aabbOf(positions)
  const ySpan = Math.max(1e-6, box.size[1])
  const initialClothingHealth = assessClothingBandHealth(
    positions,
    uvs,
    triangles,
    triangleUvs,
    tex,
    box,
    ySpan,
  )
  const clothingGuard = { tex, box, ySpan, health: initialClothingHealth }
  let outUvs = uvs.map((p): Vec2 => [p[0], p[1]])
  let outTriUvs = triangleUvs.map((t): Tri => [t[0], t[1], t[2]])
  let smearedTris = 0
  let limbTris = 0
  let mouthUvs = 0

  // Pass 1: high-span smear islands
  {
    const smearedIdx: number[] = []
    for (let i = 0; i < outTriUvs.length; i++) {
      if (triangleLooksProjectedSmear(outUvs, outTriUvs[i]!)) smearedIdx.push(i)
    }
    for (const island of uvConnectedIslands(smearedIdx, outTriUvs)) {
      if (island.length < 2) continue
      if (!islandUvLooksProjectedSmear(island, outUvs, outTriUvs)) continue
      let ySum = 0
      let yN = 0
      for (const ti of island) {
        for (const vi of triangles[ti]!) {
          const p = positions[vi]
          if (!p) continue
          ySum += p[1]
          yN += 1
        }
      }
      if (!yN) continue
      const yMean = ySum / yN
      const yHalf = Math.max(2.5, box.size[1] * 0.12)
      const yRel = (yMean - box.min[1]) / ySpan
      const islandSet = new Set(island)
      const healthy: Vec2[] = []
      for (let i = 0; i < triangles.length; i++) {
        if (islandSet.has(i)) continue
        if (triangleUvSpan(outUvs, outTriUvs[i]!) > 0.08) continue
        const tri = triangles[i]!
        let ty = 0
        let ok = true
        for (const vi of tri) {
          const p = positions[vi]
          if (!p) {
            ok = false
            break
          }
          ty += p[1]
        }
        if (!ok) continue
        ty /= 3
        if (Math.abs(ty - yMean) > yHalf) continue
        const tuv = outTriUvs[i]!
        const hu = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
        const hv = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
        if (yRel < 0.42) {
          const [r, g, b] = sampleTexRgb(tex, hu, hv)
          if (!isSkinRgb(r, g, b)) continue
        } else if (yRel < 0.55) {
          const [r, g, b] = sampleTexRgb(tex, hu, hv)
          if (!(isClothRedRgb(r, g, b) || isSkinRgb(r, g, b))) continue
        } else if (yRel < 0.75) {
          const [r, g, b] = sampleTexRgb(tex, hu, hv)
          if (!(isOliveLike(r, g, b) || isSkinRgb(r, g, b))) continue
        }
        healthy.push([hu, hv])
      }
      if (healthy.length < 6) continue
      const filtered = yRel < 0.42 ? healthy.filter((p) => p[1] < 0.88 && p[1] > 0.35) : healthy
      let target = densestUvClusterCenter(filtered.length >= 6 ? filtered : healthy, 0.04)
      // Clothing bands: land smear islands on shirt olive / shorts cloth, not skin.
      if (yRel >= 0.42 && yRel < 0.55) {
        target = densestClothRedUvTarget(tex) ?? target
      } else if (yRel >= 0.55 && yRel < 0.75) {
        target = densestOliveUvTarget(tex) ?? target
      }
      if (!target) continue
      const rem = remapIslandNewUvs(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        target,
        yRel >= 0.42 && yRel < 0.75 ? 0.12 : 0.04,
        clothingGuard,
      )
      if (!rem.ok) continue
      if (yRel < 0.42) {
        let skinHits = 0
        let n = 0
        for (const ti of island) {
          for (const uid of rem.triangleUvs[ti]!) {
            const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
            if (isSkinRgb(r, g, b)) skinHits += 1
            n += 1
          }
        }
        if (n && skinHits / n < 0.45) continue
      } else if (yRel >= 0.42 && yRel < 0.55) {
        let clothHits = 0
        let n = 0
        for (const ti of island) {
          for (const uid of rem.triangleUvs[ti]!) {
            const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
            if (isClothRedRgb(r, g, b)) clothHits += 1
            n += 1
          }
        }
        if (n && clothHits / n < 0.35) continue
      } else if (yRel >= 0.55 && yRel < 0.75) {
        let oliveHits = 0
        let n = 0
        for (const ti of island) {
          for (const uid of rem.triangleUvs[ti]!) {
            const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
            if (isOliveLike(r, g, b)) oliveHits += 1
            n += 1
          }
        }
        if (n && oliveHits / n < 0.35) continue
      }
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      smearedTris += island.length
    }
  }

  const skinTargets = densestSkinUvTargets(tex, outUvs, triangles, outTriUvs, 5)
  const lipTarget = findLipUvCentroid(tex)
  const triNbrs = buildTriNbrs(triangles)
  // Aggressive limb/shirt cleanup is for scenes with unevaluated projection smear.
  // Clean authored unwraps (Hank/Bobby/Peggy) only get obvious lip/headband bleed fixes.
  const aggressiveLimb = smearedTris >= 24
  const repaintShortsShell = aggressiveLimb && !initialClothingHealth.shortsHealthy
  const repaintShirtShell = aggressiveLimb && !initialClothingHealth.shirtHealthy

  // Precompute mid UV sample class for neighbour votes.
  const faceSample: { u: number; v: number; r: number; g: number; b: number; skin: boolean; cloth: boolean }[] =
    new Array(triangles.length)
  for (let i = 0; i < triangles.length; i++) {
    const tuv = outTriUvs[i]!
    const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
    const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
    const [r, g, b] = sampleTexRgb(tex, u, v)
    faceSample[i] = {
      u,
      v,
      r,
      g,
      b,
      skin: isSkinRgb(r, g, b),
      cloth: isClothRedRgb(r, g, b),
    }
  }

  const badLimb: number[] = []
  const mouthTris: number[] = []
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i]!
    const tuv = outTriUvs[i]!
    let x = 0
    let y = 0
    let z = 0
    let ok = true
    for (const vi of tri) {
      const p = positions[vi]
      if (!p) {
        ok = false
        break
      }
      x += p[0]
      y += p[1]
      z += p[2]
    }
    if (!ok) continue
    x /= 3
    y /= 3
    z /= 3
    const yRel = (y - box.min[1]) / ySpan
    const { u, v, r, g, b, skin } = faceSample[i]!
    const span = triangleUvSpan(outUvs, tuv)
    const absX = Math.abs(x)

    if (isProtectedClothingFace(yRel, absX, box, initialClothingHealth, r, g, b)) continue

    const onLateralLimb =
      yRel > 0.08 && yRel < 0.62 && absX > box.size[0] * 0.06 && span < 0.35

    if (onLateralLimb && !skin) {
      let nbrSkin = 0
      let nbrCloth = 0
      for (const nti of triNbrs.get(i) ?? []) {
        const ns = faceSample[nti]!
        if (ns.skin) nbrSkin += 1
        if (ns.cloth) nbrCloth += 1
      }
      const lipIsland = u < 0.22 && v > 0.35 && v < 0.55
      const headband = v > 0.88
      const faceInk = isNearBlackRgb(r, g, b) || (r + g + b < 90 && u < 0.35)
      // UV location alone is Hank-atlas specific; other characters paint those
      // regions with dress/skin. Only remap when the sample is actually lip/band paint.
      const obvious =
        isLipFillRgb(r, g, b) ||
        (lipIsland && (isLipFillRgb(r, g, b) || isNearBlackRgb(r, g, b))) ||
        (headband && (isNearBlackRgb(r, g, b) || isBrownStampRgb(r, g, b)))
      const inShortsPelvis = isInShortsPelvisZone(yRel, absX, box)
      const aggressive =
        aggressiveLimb &&
        !inShortsPelvis &&
        (obvious ||
          faceInk ||
          (isBrownStampRgb(r, g, b) && yRel < 0.45) ||
          (isClothRedRgb(r, g, b) && yRel < 0.38 && nbrSkin >= 2 && nbrSkin >= nbrCloth))

      if (aggressive) badLimb.push(i)
    }

    if (
      yRel > 0.82 &&
      yRel < 0.9 &&
      Math.abs(x) < box.size[0] * 0.08 &&
      z > box.center[2] + box.size[2] * 0.08 &&
      span < 0.25
    ) {
      mouthTris.push(i)
    }
  }

  if (skinTargets.length > 0 && badLimb.length >= 2) {
    for (const island of uvConnectedIslands(badLimb, outTriUvs)) {
      if (island.length < 1) continue
      const rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.3,
        clothingGuard,
      )
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  // Second pass: leftover wrong-paint limb tris (aggressive meshes only get the
  // force-apply path for stubborn shirt/lip blobs).
  if (skinTargets.length > 0) {
    const leftover: number[] = []
    for (const ti of badLimb) {
      const tuv = outTriUvs[ti]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      if (isSkinRgb(r, g, b)) continue
      if (
        isLipFillRgb(r, g, b) ||
        (u < 0.22 && v > 0.35 && v < 0.55 && (isLipFillRgb(r, g, b) || isNearBlackRgb(r, g, b))) ||
        (v > 0.88 && (isNearBlackRgb(r, g, b) || isBrownStampRgb(r, g, b))) ||
        (aggressiveLimb && (isNearBlackRgb(r, g, b) || isBrownStampRgb(r, g, b)))
      ) {
        leftover.push(ti)
      }
    }
    for (const island of uvConnectedIslands(leftover, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        aggressiveLimb ? 0.2 : 0.35,
        clothingGuard,
      )
      if (!rem.ok && aggressiveLimb) {
        rem = remapIslandOntoSkin(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets,
          tex,
          0.0,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  // Third pass only on smear-damaged meshes (Luanne-style projection leftovers).
  if (aggressiveLimb && skinTargets.length > 0) {
    const stubborn: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      const yRel = (y - box.min[1]) / ySpan
      if (yRel < 0.08 || yRel > 0.62 || Math.abs(x) <= box.size[0] * 0.05) continue
      if (triangleUvSpan(outUvs, outTriUvs[i]!) > 0.35) continue
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      if (isSkinRgb(r, g, b)) continue
      // Preserve clothing (olive shirt / cloth shorts). Only clear face-feature bleed.
      if (isOliveLike(r, g, b) || isClothRedRgb(r, g, b) || isShirtishRgb(r, g, b)) continue
      if (
        !(
          isLipFillRgb(r, g, b) ||
          isBrownStampRgb(r, g, b) ||
          isNearBlackRgb(r, g, b) ||
          v > 0.88 ||
          (u < 0.22 && v > 0.35 && v < 0.55)
        )
      ) {
        continue
      }
      stubborn.push(i)
    }
    for (const island of uvConnectedIslands(stubborn, outTriUvs)) {
      const rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.0,
        clothingGuard,
      )
      if (!rem.ok) continue
      let stillBad = 0
      let n = 0
      for (const ti of island) {
        for (const uid of rem.triangleUvs[ti]!) {
          const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
          if (
            isLipFillRgb(r, g, b) ||
            isClothRedRgb(r, g, b) ||
            isBrownStampRgb(r, g, b) ||
            isNearBlackRgb(r, g, b)
          ) {
            stillBad += 1
          }
          n += 1
        }
      }
      if (n && stillBad / n > 0.35) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  // Fourth pass (smear-damaged only): chest lip scraps → skin; pelvis compact
  // cloth stamps → rebuild onto densest shorts red with a wider UV scale;
  // leftover brown/shoe stamps on thighs → skin.
  if (aggressiveLimb && skinTargets.length > 0) {
    const clothTarget = densestClothRedUvTarget(tex)
    const chestLip: number[] = []
    const shortsStamp: number[] = []
    const brownStamp: number[] = []

    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        z = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
        z += p[2]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      z /= 3
      const yRel = (y - box.min[1]) / ySpan
      const span = triangleUvSpan(outUvs, outTriUvs[i]!)
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)

      // Chest / collarbone lip scraps (above crop top, below true mouth).
      // Keep jaw/chin near-black face ink (yRel > 0.78).
      if (
        yRel > 0.58 &&
        yRel < 0.84 &&
        Math.abs(x) < box.size[0] * 0.28 &&
        z > box.center[2] - box.size[2] * 0.15 &&
        span < 0.2 &&
        (isLipFillRgb(r, g, b) ||
          (isNearBlackRgb(r, g, b) && yRel < 0.78) ||
          (u < 0.22 && v > 0.35 && v < 0.55))
      ) {
        // Keep only the front mouth slit for lip paint.
        const onMouthSlit =
          yRel > 0.82 &&
          Math.abs(x) < box.size[0] * 0.08 &&
          z > box.center[2] + box.size[2] * 0.08
        if (!onMouthSlit) {
          chestLip.push(i)
          continue
        }
      }

      // Compact cloth stamp on pelvis / crotch → rebuild as shorts shell.
      if (
        !initialClothingHealth.shortsHealthy &&
        isClothRedRgb(r, g, b) &&
        span < 0.12 &&
        yRel > 0.32 &&
        yRel < 0.58 &&
        Math.abs(x) < box.size[0] * 0.28
      ) {
        shortsStamp.push(i)
        continue
      }

      // Brown / shoe / dark stamps on thighs.
      if (
        !isInShortsPelvisZone(yRel, Math.abs(x), box) &&
        yRel > 0.12 &&
        yRel < 0.55 &&
        Math.abs(x) > box.size[0] * 0.06 &&
        span < 0.15 &&
        (isBrownStampRgb(r, g, b) ||
          (isNearBlackRgb(r, g, b) && u > 0.15) ||
          (isClothRedRgb(r, g, b) && (u > 0.65 || v < 0.2)))
      ) {
        brownStamp.push(i)
      }
    }

    for (const island of uvConnectedIslands(chestLip, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.15,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.02,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }

    for (const island of uvConnectedIslands(brownStamp, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.2,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.025,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }

    if (clothTarget && shortsStamp.length >= 8) {
      for (const island of uvConnectedIslands(shortsStamp, outTriUvs)) {
        if (island.length < 1) continue
        let minU = Infinity,
          maxU = -Infinity,
          minV = Infinity,
          maxV = -Infinity
        for (const ti of island) {
          const tuv = outTriUvs[ti]!
          for (const uid of tuv) {
            const uv = outUvs[uid]!
            minU = Math.min(minU, uv[0])
            maxU = Math.max(maxU, uv[0])
            minV = Math.min(minV, uv[1])
            maxV = Math.max(maxV, uv[1])
          }
        }
        const uvSpan = Math.max(maxU - minU, maxV - minV)
        let compactFaces = 0
        for (const ti of island) {
          if (triangleUvSpan(outUvs, outTriUvs[ti]!) < 0.12) compactFaces += 1
        }
        const mostlyCompact = compactFaces / island.length >= 0.6
        // Keep shorts as cloth — expand compact stamps onto the red atlas
        // cluster. Never remap clothing to skin.
        const rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          clothTarget,
          mostlyCompact || uvSpan < 0.12 ? 0.28 : 0.38,
          clothingGuard,
        )
        if (!rem.ok) continue
        let clothHits = 0
        let n = 0
        for (const ti of island) {
          for (const uid of rem.triangleUvs[ti]!) {
            const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
            if (isClothRedRgb(r, g, b)) clothHits += 1
            n += 1
          }
        }
        if (n && clothHits / n < 0.35) continue
        outUvs = rem.uvs
        outTriUvs = rem.triangleUvs
        limbTris += island.length
      }
    }

    // Any face sampling the lip atlas island that is NOT on the front mouth band
    // → skin (clears chest scraps, pelvis lips, thigh lips).
    const strayLip: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      const onLipIsland =
        isLipFillRgb(r, g, b) ||
        (u < 0.2 && v > 0.38 && v < 0.52 && (isNearBlackRgb(r, g, b) || r + g + b < 120))
      if (!onLipIsland) continue
      const tri = triangles[i]!
      let y = 0,
        x = 0,
        z = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
        z += p[2]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      z /= 3
      const yRel = (y - box.min[1]) / ySpan
      // Only the front mouth slit keeps lip paint.
      if (
        yRel > 0.82 &&
        yRel < 0.9 &&
        Math.abs(x) < box.size[0] * 0.08 &&
        z > box.center[2] + box.size[2] * 0.08
      ) {
        continue
      }
      strayLip.push(i)
    }
    for (const island of uvConnectedIslands(strayLip, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.2,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        // Force tiny skin stamp — lip paint must not remain on body.
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.02,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }

    // Shirt/shorts atlas paint left on lateral thighs → skin.
    const thighCloth: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      const yRel = (y - box.min[1]) / ySpan
      if (yRel < 0.12 || yRel > 0.52 || Math.abs(x) < box.size[0] * 0.06) continue
      if (isInShortsPelvisZone(yRel, Math.abs(x), box)) continue
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      // Keep cloth red on upper pelvis (shorts). Clear cloth bleed on true thighs.
      if (
        isBrownStampRgb(r, g, b) ||
        isOliveLike(r, g, b) ||
        isShirtishRgb(r, g, b) ||
        (isClothRedRgb(r, g, b) && yRel < 0.4)
      ) {
        thighCloth.push(i)
      }
    }
    for (const island of uvConnectedIslands(thighCloth, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.2,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.025,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  // Mouth fix (smear-damaged only): clear olive/shirt/stacked lip scraps on the
  // face to skin, then place ONE compact lip island on the front mouth slit.
  // Multi-cluster UV translation previously stacked into a hall-of-mirrors mouth.
  if (aggressiveLimb && lipTarget && skinTargets.length > 0) {
    const faceWrong: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        z = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
        z += p[2]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      z /= 3
      const yRel = (y - box.min[1]) / ySpan
      if (yRel < 0.74 || yRel > 0.94) continue
      if (Math.abs(x) > box.size[0] * 0.28) continue
      if (z < box.center[2] - box.size[2] * 0.1) continue
      const span = triangleUvSpan(outUvs, outTriUvs[i]!)
      if (span > 0.35) continue
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      if (isSkinRgb(r, g, b)) continue
      // Keep near-black face ink (nose / brow / chin line art on the atlas).
      // Only strip clothing stamps and lip paint that landed off the mouth slit.
      const onMouthSlit =
        yRel > 0.82 &&
        yRel < 0.9 &&
        Math.abs(x) < box.size[0] * 0.08 &&
        z > box.center[2] + box.size[2] * 0.08
      const wrong =
        isOliveLike(r, g, b) ||
        isShirtishRgb(r, g, b) ||
        isClothRedRgb(r, g, b) ||
        isBrownStampRgb(r, g, b) ||
        (isLipFillRgb(r, g, b) && !onMouthSlit) ||
        (u < 0.28 && v < 0.4 && !isNearBlackRgb(r, g, b) && !isLipFillRgb(r, g, b)) ||
        (u < 0.28 && v > 0.52 && !isNearBlackRgb(r, g, b))
      if (wrong) faceWrong.push(i)
    }

    for (const island of uvConnectedIslands(faceWrong, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.1,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.02,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }

    // Single lip stamp on the front mouth slit only.
    const slit: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        z = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
        z += p[2]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      z /= 3
      const yRel = (y - box.min[1]) / ySpan
      if (
        yRel > 0.84 &&
        yRel < 0.87 &&
        Math.abs(x) < box.size[0] * 0.055 &&
        z > box.center[2] + box.size[2] * 0.12
      ) {
        slit.push(i)
      }
    }
    const slitIslands = uvConnectedIslands(slit, outTriUvs)
      .filter((isl) => isl.length >= 4)
      .sort((a, b) => b.length - a.length)
      .slice(0, 1)
    for (const island of slitIslands) {
      const rem = remapIslandNewUvs(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        lipTarget,
        0.028,
        clothingGuard,
      )
      if (!rem.ok) continue
      let lipHits = 0
      let n = 0
      for (const ti of island) {
        for (const uid of rem.triangleUvs[ti]!) {
          const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
          if (isLipFillRgb(r, g, b)) lipHits += 1
          n += 1
        }
      }
      if (!n || lipHits / n < 0.3) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      mouthUvs += island.length
    }
  }

  // Knee / shin crop-top olive scraps → skin (smear-damaged only).
  if (aggressiveLimb && skinTargets.length > 0) {
    const kneeOlive: number[] = []
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      const yRel = (y - box.min[1]) / ySpan
      if (yRel < 0.1 || yRel > 0.38 || Math.abs(x) < box.size[0] * 0.05) continue
      const span = triangleUvSpan(outUvs, outTriUvs[i]!)
      if (span > 0.2) continue
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      if (isSkinRgb(r, g, b)) continue
      if (isOliveLike(r, g, b) || isShirtishRgb(r, g, b) || (g > r + 15 && g > b + 15 && g > 90)) {
        kneeOlive.push(i)
      }
    }
    for (const island of uvConnectedIslands(kneeOlive, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.15,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.025,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  // Geometry-band clothing shells (smear-damaged only): paint the full shirt /
  // shorts torso shells onto olive / cloth atlas clusters, then clear clothing
  // bleed from midriff + legs. Skip when the mesh already unwraps those bands well.
  if (aggressiveLimb && skinTargets.length > 0 && (repaintShortsShell || repaintShirtShell)) {
    const oliveTarget = densestOliveUvTarget(tex)
    const clothTarget = densestClothRedUvTarget(tex)
    // Torso half-width relative to full T-pose arm span.
    const torsoX = box.size[0] * 0.16
    const shirtFaces: number[] = []
    const shortsFaces: number[] = []
    const clearBleed: number[] = []

    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i]!
      let x = 0,
        y = 0,
        ok = true
      for (const vi of tri) {
        const p = positions[vi]
        if (!p) {
          ok = false
          break
        }
        x += p[0]
        y += p[1]
      }
      if (!ok) continue
      x /= 3
      y /= 3
      const yRel = (y - box.min[1]) / ySpan
      const absX = Math.abs(x)
      const tuv = outTriUvs[i]!
      const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
      const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
      const [r, g, b] = sampleTexRgb(tex, u, v)
      const span = triangleUvSpan(outUvs, tuv)

      // Crop top shell (chest) — exclude T-pose arms; only faces that need repair.
      if (
        repaintShirtShell &&
        oliveTarget &&
        yRel >= 0.63 &&
        yRel <= 0.735 &&
        absX < torsoX &&
        (span > 0.2 || faceSamplesClothingBleed('shirt', r, g, b))
      ) {
        shirtFaces.push(i)
        continue
      }
      // Red shorts shell (hips → mid-thigh); only when unwrap is missing or bleeding.
      if (
        repaintShortsShell &&
        clothTarget &&
        yRel >= 0.4 &&
        yRel <= 0.545 &&
        absX < box.size[0] * 0.2 &&
        (span > 0.2 || faceSamplesClothingBleed('shorts', r, g, b))
      ) {
        shortsFaces.push(i)
        continue
      }

      // Midriff + lower legs must not keep shirt/shorts scraps.
      const midriff = yRel > 0.545 && yRel < 0.63 && absX < torsoX * 1.15
      const lowerLeg = yRel < 0.39 && absX > box.size[0] * 0.05
      const neckBleed =
        yRel > 0.735 && yRel < 0.84 && absX < torsoX * 1.3 && isOliveLike(r, g, b)
      if (
        (midriff && (isOliveLike(r, g, b) || isClothRedRgb(r, g, b))) ||
        (lowerLeg && (isOliveLike(r, g, b) || isClothRedRgb(r, g, b))) ||
        neckBleed
      ) {
        clearBleed.push(i)
      }
    }

    const paintShell = (
      faces: number[],
      target: Vec2,
      scale: number,
      okHit: (r: number, g: number, b: number) => boolean,
      minFrac: number,
    ) => {
      if (faces.length < 12) return
      // Paint as one shell (ignore UV connectivity) so holes fill solidly.
      const rem = remapIslandNewUvs(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        faces,
        target,
        scale,
        clothingGuard,
      )
      if (!rem.ok) return
      let hits = 0
      let n = 0
      for (const ti of faces) {
        for (const uid of rem.triangleUvs[ti]!) {
          const [r, g, b] = sampleTexRgb(tex, rem.uvs[uid]![0], rem.uvs[uid]![1])
          if (okHit(r, g, b)) hits += 1
          n += 1
        }
      }
      if (!n || hits / n < minFrac) return
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += faces.length
    }

    if (oliveTarget) paintShell(shirtFaces, oliveTarget, 0.07, isOliveLike, 0.35)
    if (clothTarget) paintShell(shortsFaces, clothTarget, 0.09, isClothRedRgb, 0.35)

    // Second pass: fill remaining holes inside the shells with a tighter stamp.
    if (oliveTarget) {
      const shirtLeft: number[] = []
      for (const ti of shirtFaces) {
        const tuv = outTriUvs[ti]!
        const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
        const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
        const [r, g, b] = sampleTexRgb(tex, u, v)
        if (!isOliveLike(r, g, b)) shirtLeft.push(ti)
      }
      if (shirtLeft.length >= 4) {
        const rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          shirtLeft,
          oliveTarget,
          0.045,
          clothingGuard,
        )
        if (rem.ok) {
          outUvs = rem.uvs
          outTriUvs = rem.triangleUvs
          limbTris += shirtLeft.length
        }
      }
    }
    if (clothTarget) {
      const shortsLeft: number[] = []
      for (const ti of shortsFaces) {
        const tuv = outTriUvs[ti]!
        const u = (outUvs[tuv[0]!]![0] + outUvs[tuv[1]!]![0] + outUvs[tuv[2]!]![0]) / 3
        const v = (outUvs[tuv[0]!]![1] + outUvs[tuv[1]!]![1] + outUvs[tuv[2]!]![1]) / 3
        const [r, g, b] = sampleTexRgb(tex, u, v)
        if (!isClothRedRgb(r, g, b)) shortsLeft.push(ti)
      }
      if (shortsLeft.length >= 4) {
        const rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          shortsLeft,
          clothTarget,
          0.05,
          clothingGuard,
        )
        if (rem.ok) {
          outUvs = rem.uvs
          outTriUvs = rem.triangleUvs
          limbTris += shortsLeft.length
        }
      }
    }

    for (const island of uvConnectedIslands(clearBleed, outTriUvs)) {
      let rem = remapIslandOntoSkin(
        positions,
        outUvs,
        triangles,
        outTriUvs,
        island,
        skinTargets,
        tex,
        0.15,
        clothingGuard,
      )
      if (!rem.ok && skinTargets[0]) {
        rem = remapIslandNewUvs(
          positions,
          outUvs,
          triangles,
          outTriUvs,
          island,
          skinTargets[0],
          0.03,
          clothingGuard,
        )
      }
      if (!rem.ok) continue
      outUvs = rem.uvs
      outTriUvs = rem.triangleUvs
      limbTris += island.length
    }
  }

  const restored = restoreAuthoringClothingUvs(
    positions,
    uvs,
    triangleUvs,
    outUvs,
    triangles,
    outTriUvs,
    tex,
    box,
    ySpan,
    initialClothingHealth,
  )

  return {
    uvs: restored.uvs,
    triangleUvs: restored.triangleUvs,
    smearedTris,
    limbTris,
    mouthUvs,
  }
}

/** Put back clothing UVs that were correct before repair (safety net after all passes). */
function restoreAuthoringClothingUvs(
  positions: Vec3[],
  originalUvs: Vec2[],
  originalTriUvs: Tri[],
  uvs: Vec2[],
  triangles: Tri[],
  triangleUvs: Tri[],
  tex: RgbaTex,
  box: ReturnType<typeof aabbOf>,
  ySpan: number,
  health: ClothingBandHealth,
): { uvs: Vec2[]; triangleUvs: Tri[] } {
  if (!health.shortsHealthy && !health.shirtHealthy) {
    return { uvs, triangleUvs }
  }
  const outUvs = uvs.map((p): Vec2 => [p[0], p[1]])
  const outTriUvs = triangleUvs.map((t): Tri => [t[0], t[1], t[2]])

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i]!
    const origTuv = originalTriUvs[i]
    if (!origTuv) continue
    let x = 0
    let y = 0
    let ok = true
    for (const vi of tri) {
      const p = positions[vi]
      if (!p) {
        ok = false
        break
      }
      x += p[0]
      y += p[1]
    }
    if (!ok) continue
    x /= 3
    y /= 3
    const yRel = (y - box.min[1]) / ySpan
    const ou =
      (originalUvs[origTuv[0]!]![0] + originalUvs[origTuv[1]!]![0] + originalUvs[origTuv[2]!]![0]) / 3
    const ov =
      (originalUvs[origTuv[0]!]![1] + originalUvs[origTuv[1]!]![1] + originalUvs[origTuv[2]!]![1]) / 3
    const [r, g, b] = sampleTexRgb(tex, ou, ov)
    if (!isProtectedClothingFace(yRel, Math.abs(x), box, health, r, g, b)) continue
    outTriUvs[i] = [origTuv[0], origTuv[1], origTuv[2]]
    for (const uid of origTuv) {
      const src = originalUvs[uid]
      if (src) outUvs[uid] = [src[0], src[1]]
    }
  }

  return { uvs: outUvs, triangleUvs: outTriUvs }
}

/** Decode 8-bit RGB/RGBA PNG (Node zlib or browser DecompressionStream). */
export async function decodePngRgbaForMaya(bytes: Uint8Array): Promise<RgbaTex | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const copy =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes
          : bytes.slice()
      const bitmap = await createImageBitmap(
        new Blob([copy.buffer as ArrayBuffer], { type: 'image/png' }),
      )
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : typeof document !== 'undefined'
            ? document.createElement('canvas')
            : null
      if (canvas) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(bitmap, 0, 0)
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
          bitmap.close()
          return { width: image.width, height: image.height, data: image.data }
        }
      }
      bitmap.close()
    }
  } catch {
    /* fall through */
  }

  try {
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
    let o = 8
    let width = 0
    let height = 0
    let colorType = 6
    const idats: Uint8Array[] = []
    while (o + 8 <= bytes.length) {
      const len = (bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!
      const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!)
      const data = bytes.subarray(o + 8, o + 8 + len)
      o += 12 + len
      if (type === 'IHDR') {
        width = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!
        height = (data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!
        colorType = data[9]!
      } else if (type === 'IDAT') idats.push(data)
      else if (type === 'IEND') break
    }
    if (!width || !height || idats.length === 0) return null
    const joined = new Uint8Array(idats.reduce((n, c) => n + c.length, 0))
    let j = 0
    for (const c of idats) {
      joined.set(c, j)
      j += c.length
    }
    let inflated: Uint8Array
    if (typeof DecompressionStream === 'undefined') return null
    {
      const stream = new Blob([joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength) as ArrayBuffer])
        .stream()
        .pipeThrough(new DecompressionStream('deflate'))
      inflated = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
    if (!bpp) return null
    const stride = width * bpp + 1
    const out = new Uint8ClampedArray(width * height * 4)
    const prev = new Uint8Array(width * bpp)
    const cur = new Uint8Array(width * bpp)
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride
      const filter = inflated[rowStart]!
      const row = inflated.subarray(rowStart + 1, rowStart + 1 + width * bpp)
      for (let i = 0; i < width * bpp; i++) {
        const x = row[i]!
        const a = i >= bpp ? cur[i - bpp]! : 0
        const b = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        let v = x
        if (filter === 1) v = (x + a) & 255
        else if (filter === 2) v = (x + b) & 255
        else if (filter === 3) v = (x + ((a + b) >> 1)) & 255
        else if (filter === 4) v = (x + paeth(a, b, c)) & 255
        cur[i] = v
      }
      for (let x = 0; x < width; x++) {
        const s = x * bpp
        const d = (y * width + x) * 4
        out[d] = cur[s]!
        out[d + 1] = cur[s + 1]!
        out[d + 2] = cur[s + 2]!
        out[d + 3] = bpp === 4 ? cur[s + 3]! : 255
      }
      prev.set(cur)
    }
    return { width, height, data: out }
  } catch {
    return null
  }
}
