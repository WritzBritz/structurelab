/**
 * FBX material / texture wiring shared by the ASCII and binary readers.
 *
 * Autodesk FBX SDK (FbxFileTexture, FbxLayerElementMaterial) and the
 * three.js / ufbx / oxideav-fbx importers all agree on this graph:
 *
 *   Video  --(OO)--> Texture --(OP, channel)--> Material --(OO)--> Model
 *                                      \-- LayeredTexture (first layer only)
 *
 * The channel name on the OP connection is the material property
 * (`DiffuseColor`, `Maya|TEX_color_map`, `NormalMap`, …). Only albedo /
 * diffuse channels become `map_Kd`. Last-write-wins across Normal / AO /
 * Alpha is what made one texture show up on every mesh.
 *
 * Materials on a Model are an ordered slot table. `LayerElementMaterial`
 * indices select a slot per polygon (AllSame → slot 0).
 */

export type FbxConn = {
  from: string
  to: string
  /** Property name for `OP` connections (`DiffuseColor`, …); empty for `OO`. */
  prop: string
}

/**
 * Scene-graph parents from OO connections.
 *
 * FBX also connects Cluster/Skin deformers onto LimbNodes. Those must not
 * overwrite Model→Model parents — that left every bone parentless, so Lcl
 * translations were treated as world positions (joints piled at the origin).
 */
export function fbxNodeParents(
  connections: FbxConn[],
  skipIds: Set<string>,
): Map<string, string> {
  const parentOf = new Map<string, string>()
  for (const conn of connections) {
    if (conn.prop) continue
    if (skipIds.has(conn.from) || skipIds.has(conn.to)) continue
    parentOf.set(conn.from, conn.to)
  }
  return parentOf
}

export type FbxTextureRef = {
  file: string
  scale: [number, number]
  offset: [number, number]
  /** Texture.UVSet — matches LayerElementUV.Name when the mesh has several UV layers. */
  uvSet?: string
}

export type FbxSurfaceBindings = {
  /** Model (or geometry) id → material ids in FBX slot order. */
  materialsOf: Map<string, string[]>
  /** Material id → albedo Texture / LayeredTexture id. */
  albedoTextureOf: Map<string, string>
  /** Texture id → backing Video id. */
  videoOfTexture: Map<string, string>
  /** LayeredTexture id → first child Texture id. */
  firstLayerOf: Map<string, string>
}

/**
 * Channels that mean "the colour you actually see" across Lambert/Phong,
 * Maya Stingray PBS, 3ds Max Physical, and Blender's FBX exporter.
 * Anything else (NormalMap, Bump, TransparentColor, Specular, AO, …)
 * must not replace the albedo map.
 */
const ALBEDO_TAILS = new Set([
  'diffusecolor',
  'diffuse',
  'tex_color_map',
  'base_color',
  'basecolor',
  'base_color_map',
  'basecolormap',
  'basecolor_map',
  'albedo',
  'albedomap',
  'albedo_map',
])

const ALBEDO_REJECT =
  /normal|bump|spec|metal|rough|ao\b|occlusion|emiss|transparent|opacity|alpha|shininess|reflection|displace|vector_disp|factor/i

export function albedoChannelRank(prop: string | null | undefined): number {
  const raw = (prop ?? '').trim()
  if (!raw) return 80
  const compact = raw.toLowerCase().replace(/\s+/g, '')
  const tail = compact.split('|').pop() ?? compact
  if (ALBEDO_REJECT.test(tail) && !ALBEDO_TAILS.has(tail)) return -1
  if (tail === 'diffusecolor' || compact === 'diffusecolor') return 0
  if (tail === 'maya|tex_color_map' || tail === 'tex_color_map') return 1
  if (ALBEDO_TAILS.has(tail) || ALBEDO_TAILS.has(compact)) return 2
  if (/color_map|base.?color|albedo|diffuse/.test(compact) && !ALBEDO_REJECT.test(compact)) {
    return 10
  }
  return -1
}

export function isAlbedoTextureChannel(prop: string | null | undefined): boolean {
  return albedoChannelRank(prop) >= 0
}

export function bindFbxSurfaces(
  connections: FbxConn[],
  ids: {
    materials: Set<string>
    textures: Set<string>
    videos: Set<string>
    layered?: Set<string>
  },
): FbxSurfaceBindings {
  const layered = ids.layered ?? new Set<string>()
  const materialsOf = new Map<string, string[]>()
  const albedoTextureOf = new Map<string, string>()
  const albedoRankOf = new Map<string, number>()
  const videoOfTexture = new Map<string, string>()
  const firstLayerOf = new Map<string, string>()
  const layeredChildren = new Map<string, string[]>()

  const pushUnique = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) {
      if (!list.includes(value)) list.push(value)
    } else {
      map.set(key, [value])
    }
  }

  const isTex = (id: string) => ids.textures.has(id) || layered.has(id)

  for (const conn of connections) {
    if (ids.videos.has(conn.from) && ids.textures.has(conn.to)) {
      videoOfTexture.set(conn.to, conn.from)
      continue
    }
    if (ids.textures.has(conn.from) && layered.has(conn.to)) {
      pushUnique(layeredChildren, conn.to, conn.from)
      continue
    }
    if (ids.materials.has(conn.from)) {
      pushUnique(materialsOf, conn.to, conn.from)
      continue
    }
    if (!isTex(conn.from) || !ids.materials.has(conn.to)) continue
    const rank = albedoChannelRank(conn.prop)
    if (rank < 0) continue
    const previous = albedoRankOf.get(conn.to)
    if (previous != null && previous <= rank) continue
    albedoTextureOf.set(conn.to, conn.from)
    albedoRankOf.set(conn.to, rank)
  }

  for (const [layerId, children] of layeredChildren) {
    const first = children[0]
    if (first) firstLayerOf.set(layerId, first)
  }

  return { materialsOf, albedoTextureOf, videoOfTexture, firstLayerOf }
}

export function resolveAlbedoFile(
  materialId: string | null | undefined,
  bindings: FbxSurfaceBindings,
  fileOf: Map<string, FbxTextureRef>,
): FbxTextureRef | null {
  if (!materialId) return null
  let textureId = bindings.albedoTextureOf.get(materialId)
  if (!textureId) return null
  textureId = bindings.firstLayerOf.get(textureId) ?? textureId
  const direct = fileOf.get(textureId)
  const videoId = bindings.videoOfTexture.get(textureId)
  const fromVideo = videoId ? fileOf.get(videoId) : null
  const file = direct?.file || fromVideo?.file
  if (!file) return null
  return {
    file,
    scale: direct?.scale ?? [1, 1],
    offset: direct?.offset ?? [0, 0],
    uvSet: direct?.uvSet ?? fromVideo?.uvSet,
  }
}

/**
 * FBX LayerElement mapping. `ByPolygonVertex` contains the substring `byvert`,
 * so a naive `includes('byvert')` steals control-point UVs from the usual
 * per-corner maps and the texture no longer fits the mesh.
 */
export function fbxLayerIndex(
  mapping: string,
  corner: number,
  vertex: number,
  polygon: number,
): number {
  const map = mapping.toLowerCase().replace(/[\s_]/g, '')
  if (map.includes('allsame') || map.includes('nomapping')) return 0
  if (map.includes('bypolygonvertex') || map.includes('byfacevertex')) return corner
  if (map.includes('byvertice') || map === 'byvert' || map === 'byvertex') return vertex
  if (map.includes('bypolygon') || map.includes('byface')) return polygon
  return corner
}

/** 3ds Max stores 100 = 100%; model-scale leftovers (1000+) are not UV tiling. */
export function sanitizeFbxTextureUv(
  scale: [number, number] | undefined,
  offset: [number, number] | undefined,
): { scale: [number, number]; offset: [number, number] } {
  let sx = scale?.[0] ?? 1
  let sy = scale?.[1] ?? 1
  let ox = offset?.[0] ?? 0
  let oy = offset?.[1] ?? 0
  if (!Number.isFinite(sx) || sx === 0) sx = 1
  if (!Number.isFinite(sy) || sy === 0) sy = 1
  if (sx >= 80 && sx <= 120 && sy >= 80 && sy <= 120) {
    sx /= 100
    sy /= 100
  }
  if (sx < 0.05 || sx > 16) sx = 1
  if (sy < 0.05 || sy > 16) sy = 1
  if (!Number.isFinite(ox) || Math.abs(ox) > 8) ox = 0
  if (!Number.isFinite(oy) || Math.abs(oy) > 8) oy = 0
  return { scale: [sx, sy], offset: [ox, oy] }
}

export function pickFbxUvLayer<T>(
  layers: T[],
  nameOf: (layer: T) => string,
  preferred?: string,
  usable?: (layer: T) => boolean,
): T | undefined {
  const pool = usable ? layers.filter(usable) : layers
  const list = pool.length > 0 ? pool : layers
  if (list.length === 0) return undefined
  const want = (preferred ?? '').toLowerCase().replace(/[\s_]/g, '')
  if (want && want !== 'default') {
    const hit = list.find((layer) => nameOf(layer).toLowerCase().replace(/[\s_]/g, '') === want)
    if (hit) return hit
  }
  return list[0]
}

export function preferredUvSet(
  materialIds: string[],
  bindings: FbxSurfaceBindings,
  fileOf: Map<string, FbxTextureRef>,
): string | undefined {
  for (const materialId of materialIds) {
    const albedo = resolveAlbedoFile(materialId, bindings, fileOf)
    if (albedo?.uvSet) return albedo.uvSet
  }
  return undefined
}

export function applyTextureUv(
  u: number,
  v: number,
  tex: FbxTextureRef | null | undefined,
): [number, number] {
  if (!tex) return [u, v]
  const { scale, offset } = sanitizeFbxTextureUv(tex.scale, tex.offset)
  return [u * scale[0] + offset[0], v * scale[1] + offset[1]]
}

/** FBX and OBJ share OpenGL V (0 at the bottom). Preview / voxelize flip when sampling PNG. */
export function remapObjUvs(uvs: number[] | null, tex: FbxTextureRef | null | undefined): number[] | null {
  if (!uvs || !tex) return uvs
  const { scale, offset } = sanitizeFbxTextureUv(tex.scale, tex.offset)
  if (scale[0] === 1 && scale[1] === 1 && offset[0] === 0 && offset[1] === 0) return uvs
  const out = uvs.slice()
  const uvTex = { ...tex, scale, offset }
  for (let i = 0; i + 1 < out.length; i += 2) {
    const [nu, nv] = applyTextureUv(out[i]!, out[i + 1]!, uvTex)
    out[i] = nu
    out[i + 1] = nv
  }
  return out
}

export function materialSlotSampler(
  indices: number[],
  mapping: string,
): (polygon: number) => number {
  if (indices.length === 0) return () => 0
  const map = mapping.toLowerCase()
  if (map.includes('allsame') || map.includes('nomapping')) {
    const slot = Math.round(indices[0] ?? 0)
    return () => slot
  }
  return (polygon) => Math.round(indices[polygon] ?? indices[0] ?? 0)
}

export function slotMaterialId(
  slots: string[] | undefined,
  index: number,
): string | null {
  if (!slots?.length) return null
  return slots[index] ?? slots[0] ?? null
}

/** Longest common substring length; ignores runs shorter than `min`. */
export function longestCommonSubstring(a: string, b: string, min = 4): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (!left || !right) return 0
  let best = 0
  const table = new Uint16Array(right.length + 1)
  for (let i = 1; i <= left.length; i += 1) {
    let prev = 0
    for (let j = 1; j <= right.length; j += 1) {
      const stored = table[j]!
      table[j] = left[i - 1] === right[j - 1] ? prev + 1 : 0
      if (table[j]! > best) best = table[j]!
      prev = stored
    }
  }
  return best >= min ? best : 0
}

export function materialLookupKeys(name: string): string[] {
  const lower = name.toLowerCase()
  const keys = [lower]
  const stripped = lower.replace(/\.\d+$/, '')
  if (stripped !== lower) keys.push(stripped)
  return keys
}

export function materialStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(mat|fbx)$/i, '')
    .replace(/^[a-z]{2,6}_/, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function textureStem(path: string): string {
  const base = path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Split a triangulated buffer into one group per LayerElementMaterial slot. */
export function partitionTriangles(
  positions: number[],
  uvs: number[] | null,
  slots: number[],
  controlPoints?: number[],
): Map<number, { positions: number[]; uvs: number[] | null; controlPoints: number[] }> {
  const groups = new Map<number, { positions: number[]; uvs: number[] | null; controlPoints: number[] }>()
  const triangles = Math.floor(positions.length / 9)
  for (let t = 0; t < triangles; t += 1) {
    const slot = slots[t] ?? 0
    let group = groups.get(slot)
    if (!group) {
      group = { positions: [], uvs: uvs ? [] : null, controlPoints: [] }
      groups.set(slot, group)
    }
    const start = t * 9
    for (let i = 0; i < 9; i += 1) group.positions.push(positions[start + i]!)
    if (uvs && group.uvs) {
      const uvStart = t * 6
      for (let i = 0; i < 6; i += 1) group.uvs.push(uvs[uvStart + i]!)
    }
    if (controlPoints && controlPoints.length >= (t + 1) * 3) {
      group.controlPoints.push(controlPoints[t * 3]!, controlPoints[t * 3 + 1]!, controlPoints[t * 3 + 2]!)
    }
  }
  return groups
}
