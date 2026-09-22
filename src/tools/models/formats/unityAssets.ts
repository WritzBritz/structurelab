/**
 * Resolve textures through a Unity asset database instead of the FBX itself.
 *
 * Unity's ModelImporter stores the real assignment in the FBX's `.meta`:
 *
 *   externalObjects:
 *     first.name  = FBX material name (not the mesh name)
 *     second.guid = the `.mat` asset
 *
 * Then the `.mat` `_MainTex` / `_BaseMap` / `_BaseColorMap` slot points at a
 * texture guid. Prefab renderer lists are outfit overrides and must not be
 * applied to a raw FBX import — they also leak onto unrelated models that
 * happen to share object names (`Body`, `Hair`).
 *
 * A copy of the FBX without its `.meta` (e.g. `FBX_MAYO1.fbx` next to the
 * package) is matched against another `*.fbx.meta` only when distinctive
 * material names line up (Underwear / Kemo / character-specific), not when
 * two avatars share Body / Hair / Face. Generic-only overlap is ignored
 * unless the meta sits in the same folder and the name sets are identical.
 *
 * @see https://docs.unity3d.com/Manual/FBXImporter-Materials.html
 * @see https://docs.unity3d.com/ScriptReference/ModelImporter.SearchAndRemapMaterials.html
 */

import { logDebug, readLocalFileBytes, walkLocalFiles } from '../../../api'
import { basename, fileSystemPath } from '../objAssets'
import {
  RASTER_TEXTURE_EXTENSIONS,
  dirName,
  rememberTextureBytes,
} from '../sidecarTextures'
import { longestCommonSubstring, materialLookupKeys, materialStem, textureStem } from './fbxBindings'

const MAIN_TEXTURE_SLOTS = [
  '_MainTex',
  '_BaseMap',
  '_BaseColorMap',
  '_Albedo',
  '_AlbedoMap',
  '_Diffuse',
  '_DiffuseMap',
]

const GENERIC_MAT = /^(material|lambert|phong|blinn|standard|default|scene)(\.\d+)?$/i
/** Shared avatar slots — too common to identify a character across packages. */
const GENERIC_CROSS_MAT =
  /^(material|lambert|phong|blinn|standard|default|scene|body|face|hair|skin|eye|eyes|head|costume|cloth|clothes|clothing|outfit|shirt|pants|shoes|accessory|accessories|outline|mat)([._-].*)?$/i
const GUID = /^guid:\s*([0-9a-f]{32})/m
const RASTER = new RegExp(`\\.(${RASTER_TEXTURE_EXTENSIONS.join('|')})$`, 'i')
const DUMP_DIR = /^(downloads|desktop|documents|pictures|onedrive|users|[a-z]:|)$/i

export type UnityTextureIndex = {
  /** FBX / Unity material name, lower-cased → absolute texture path. */
  byMaterial: Record<string, string>
}

const decoder = new TextDecoder('utf-8', { fatal: false })

async function readText(path: string, limit = 8 * 1024 * 1024): Promise<string> {
  const bytes = await readLocalFileBytes(path)
  return decoder.decode(bytes.length > limit ? bytes.subarray(0, limit) : bytes)
}

export function unityRootCandidates(sourcePath: string): string[] {
  const roots: string[] = []
  let dir = dirName(sourcePath)
  while (dir && roots.length < 4) {
    roots.push(dir)
    const parent = dirName(dir)
    if (!parent || parent === dir || DUMP_DIR.test(basename(parent))) break
    dir = parent
  }
  return roots
}

function unityName(body: string): string | null {
  return /^\s*m_Name:\s*(.+)$/m.exec(body)?.[1]?.trim() || null
}

function mainTextureGuid(text: string): string | null {
  for (const slot of MAIN_TEXTURE_SLOTS) {
    const block = new RegExp(`- ${slot}:\\s*\\r?\\n\\s*m_Texture:\\s*\\{([^}]*)\\}`).exec(text)?.[1]
    if (!block || /fileID:\s*0\b/.test(block)) continue
    const guid = /guid:\s*([0-9a-f]{32})/.exec(block)?.[1]
    if (guid) return guid
  }
  return null
}

export function parseFbxMetaRemaps(text: string): { name: string; guid: string }[] {
  const out: { name: string; guid: string }[] = []
  const blocks = text.split(/^\s*- first:\s*$/m)
  for (const block of blocks) {
    if (!/type:\s*UnityEngine:Material/i.test(block)) continue
    const name = /^\s*name:\s*(.+)$/m.exec(block)?.[1]?.trim()
    const guid = /second:\s*\{[^}]*guid:\s*([0-9a-f]{32})/i.exec(block)?.[1]
    if (name && guid) out.push({ name, guid })
  }
  return out
}

function lowerNameSet(names: string[]): Set<string> {
  return new Set(names.map((name) => name.toLowerCase()).filter(Boolean))
}

function distinctiveMaterialNames(names: Iterable<string>): string[] {
  return [...names].filter((name) => !GENERIC_CROSS_MAT.test(name))
}

function sameNameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false
  for (const name of a) {
    if (!b.has(name)) return false
  }
  return true
}

function foldSceneStem(filePath: string): string {
  return basename(filePath)
    .toLowerCase()
    .replace(/\.fbx\.meta$/i, '')
    .replace(/\.fbx$/i, '')
}

function metaStemScore(metaPath: string, fbxPath: string): number {
  const metaStem = foldSceneStem(metaPath)
  const fbxStem = foldSceneStem(fbxPath)
  if (!metaStem || !fbxStem) return 0
  if (metaStem === fbxStem) return 50
  const shared = longestCommonSubstring(materialStem(fbxStem), materialStem(metaStem), 4)
  return shared >= 4 ? shared : 0
}

function sameDirectory(a: string, b: string): boolean {
  return dirName(a).replaceAll('\\', '/').toLowerCase() === dirName(b).replaceAll('\\', '/').toLowerCase()
}

/**
 * How well a `.fbx.meta` remap list belongs to this mesh.
 * 0 = do not use. Body/Hair/Face overlap alone never scores.
 */
export function remapFitScore(
  remapNames: string[],
  fbxMaterialNames: string[],
  options?: { metaPath?: string; fbxPath?: string },
): number {
  if (remapNames.length === 0 || fbxMaterialNames.length === 0) return 0
  const remap = lowerNameSet(remapNames)
  const fbx = lowerNameSet(fbxMaterialNames)
  const distinctRemap = distinctiveMaterialNames(remap)
  const distinctFbx = distinctiveMaterialNames(fbx)
  const hits = distinctFbx.filter((name) => distinctRemap.includes(name)).length
  const sameDir = Boolean(
    options?.metaPath && options?.fbxPath && sameDirectory(options.metaPath, options.fbxPath),
  )
  const stem = options?.metaPath && options?.fbxPath
    ? metaStemScore(options.metaPath, options.fbxPath)
    : 0

  if (hits === 0) {
    // Generic-only sets: same-folder identical list of 3+ slots, or the same file stem.
    if (sameNameSet(remap, fbx) && fbx.size >= 3 && (sameDir || stem >= 50)) return 8 + stem
    return 0
  }
  const cover = hits / distinctFbx.length
  const precision = hits / Math.max(distinctRemap.length, 1)
  if (cover < 0.8 || precision < 0.5) return 0
  if (hits === 1 && (distinctFbx.length > 1 || distinctRemap.length > 2)) return 0
  return cover * 20 + precision * 10 + hits + (sameDir ? 8 : 0) + stem
}

export function remapFitsFbx(
  remapNames: string[],
  fbxMaterialNames: string[],
  options?: { metaPath?: string; fbxPath?: string },
): boolean {
  return remapFitScore(remapNames, fbxMaterialNames, options) > 0
}

function guessScore(materialName: string, rasterPath: string): number {
  const file = basename(rasterPath).toLowerCase().replace(/\.[^.]+$/, '')
  let score = longestCommonSubstring(materialStem(materialName), textureStem(rasterPath), 4) * 3
  if (/(^|[_-])(base|basecolor|albedo|diffuse|main|color|colour)([_-]|$)/.test(file)) score += 2
  if (/(nomal|normal|mask|ao|occlusion|rim|emi|emissive|matcap|alpha|line|spec|rough|metal)/.test(file)) {
    score -= 6
  }
  return score
}

function assignUnusedRasters(
  unresolved: { name: string; folder: string }[],
  rasters: string[],
  used: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const remaining = unresolved.filter((item) => !GENERIC_MAT.test(item.name))
  const available = rasters.filter((path) => !used.has(path.replaceAll('\\', '/').toLowerCase()))
  const claimed = new Set<string>()
  const candidates: { mat: string; path: string; score: number }[] = []
  for (const item of remaining) {
    const folder = `${item.folder.replaceAll('\\', '/').toLowerCase()}/`
    for (const raster of available) {
      if (!raster.replaceAll('\\', '/').toLowerCase().startsWith(folder)) continue
      const score = guessScore(item.name, raster)
      if (score < 6) continue
      candidates.push({ mat: item.name.toLowerCase(), path: raster, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  for (const hit of candidates) {
    const pathKey = hit.path.replaceAll('\\', '/').toLowerCase()
    if (out[hit.mat] || claimed.has(pathKey)) continue
    out[hit.mat] = hit.path
    claimed.add(pathKey)
  }
  return out
}

export async function buildUnityIndexFrom(
  files: string[],
  read: (path: string, limit?: number) => Promise<string>,
  options?: {
    fbxPath?: string
    fbxMaterialNames?: string[]
  },
): Promise<UnityTextureIndex | null> {
  const mats = files.filter((file) => file.toLowerCase().endsWith('.mat'))
  if (mats.length === 0) return null
  const rasters = files.filter((file) => RASTER.test(file))
  const metas = files.filter((file) => file.toLowerCase().endsWith('.meta'))
  const fbxNames = options?.fbxMaterialNames ?? []

  const assetOfGuid = new Map<string, string>()
  for (const meta of metas) {
    const asset = meta.slice(0, -'.meta'.length)
    if (!RASTER.test(asset) && !asset.toLowerCase().endsWith('.mat')) continue
    try {
      const guid = GUID.exec(await read(meta, 4096))?.[1]
      if (guid) assetOfGuid.set(guid, asset)
    } catch (error) {
      logDebug('[unity] meta read failed:', meta, error)
    }
  }

  const matByGuid = new Map<string, { name: string; path: string; text: string }>()
  const matByName = new Map<string, { name: string; path: string; text: string }>()
  for (const mat of mats) {
    let text: string
    try {
      text = await read(mat, 2 * 1024 * 1024)
    } catch (error) {
      logDebug('[unity] material read failed:', mat, error)
      continue
    }
    const name = unityName(text) ?? basename(mat).replace(/\.mat$/i, '')
    const record = { name, path: mat, text }
    matByName.set(name.toLowerCase(), record)
    const metaGuid = GUID.exec(await read(`${mat}.meta`, 4096).catch(() => ''))?.[1]
    if (metaGuid) matByGuid.set(metaGuid, record)
  }

  const fbxMetaPath = options?.fbxPath ? `${options.fbxPath}.meta` : ''
  const fbxMetas = files.filter((file) => /\.fbx\.meta$/i.test(file))
  let remaps: { name: string; guid: string }[] = []
  if (fbxMetaPath && fbxMetas.some((file) => file.replaceAll('\\', '/').toLowerCase() === fbxMetaPath.replaceAll('\\', '/').toLowerCase())) {
    try {
      remaps = parseFbxMetaRemaps(await read(fbxMetaPath))
    } catch (error) {
      logDebug('[unity] fbx.meta read failed:', fbxMetaPath, error)
    }
  }
  if (remaps.length === 0) {
    const ownMeta = fbxMetaPath.replaceAll('\\', '/').toLowerCase()
    let best: { remaps: { name: string; guid: string }[]; score: number } | null = null
    let second = 0
    for (const meta of fbxMetas) {
      if (meta.replaceAll('\\', '/').toLowerCase() === ownMeta) continue
      try {
        const parsed = parseFbxMetaRemaps(await read(meta))
        const score = remapFitScore(
          parsed.map((item) => item.name),
          fbxNames,
          { metaPath: meta, fbxPath: options?.fbxPath },
        )
        if (score <= 0) continue
        if (!best || score > best.score) {
          second = best?.score ?? 0
          best = { remaps: parsed, score }
        } else if (score > second) {
          second = score
        }
      } catch (error) {
        logDebug('[unity] fbx.meta read failed:', meta, error)
      }
    }
    // Two similar avatars in one Assets tree: do not guess.
    if (best && !(second > 0 && second >= best.score * 0.85)) {
      remaps = best.remaps
      logDebug('[unity] using overlapping FBX remaps, score', best.score)
    }
  }

  const byMaterial: Record<string, string> = {}
  const usedRasters = new Set<string>()
  const unresolved: { name: string; folder: string }[] = []

  for (const remap of remaps) {
    const record = matByGuid.get(remap.guid) ?? matByName.get(remap.name.toLowerCase())
    if (!record) continue
    const guid = mainTextureGuid(record.text)
    const resolved = guid ? assetOfGuid.get(guid) : null
    if (resolved) {
      byMaterial[remap.name.toLowerCase()] = resolved
      usedRasters.add(resolved.replaceAll('\\', '/').toLowerCase())
      continue
    }
    // fileID 0 / missing slot is an intentional empty map (shadow overlays).
    if (!guid) continue
    unresolved.push({ name: remap.name, folder: dirName(record.path) })
  }

  for (const [name, record] of matByName) {
    if (byMaterial[name]) continue
    if (GENERIC_MAT.test(record.name)) continue
    if (fbxNames.length === 0) continue
    if (!fbxNames.some((item) => materialLookupKeys(item).includes(name))) continue
    const guid = mainTextureGuid(record.text)
    const texture = guid ? assetOfGuid.get(guid) : null
    if (texture) {
      byMaterial[name] = texture
      usedRasters.add(texture.replaceAll('\\', '/').toLowerCase())
      continue
    }
    if (guid) unresolved.push({ name: record.name, folder: dirName(record.path) })
  }

  Object.assign(byMaterial, assignUnusedRasters(unresolved.filter((item) => item.folder), rasters, usedRasters))

  if (Object.keys(byMaterial).length === 0) {
    const withTex: { name: string; path: string }[] = []
    for (const record of matByName.values()) {
      if (GENERIC_MAT.test(record.name)) continue
      const guid = mainTextureGuid(record.text)
      const texture = guid ? assetOfGuid.get(guid) : null
      if (texture) withTex.push({ name: record.name, path: texture })
    }
    if (withTex.length === 1) {
      const only = withTex[0]!
      const keys = new Set<string>([
        only.name.toLowerCase(),
        'material',
        ...fbxNames.map((name) => name.toLowerCase()),
      ])
      for (const key of keys) {
        if (key) byMaterial[key] = only.path
      }
    }
  }

  if (Object.keys(byMaterial).length === 0) return null
  return { byMaterial }
}

async function indexRoot(
  root: string,
  options?: { fbxPath?: string; fbxMaterialNames?: string[] },
): Promise<UnityTextureIndex | null> {
  try {
    const files = await walkLocalFiles(root, {
      extensions: ['mat', 'meta', 'prefab', 'unity', ...RASTER_TEXTURE_EXTENSIONS],
      maxFiles: 6000,
      maxDepth: 10,
    })
    return await buildUnityIndexFrom(files, readText, options)
  } catch (error) {
    logDebug('[unity] index failed:', root, error)
    return null
  }
}

export async function buildUnityTextureIndex(
  sourceFile: File,
  fbxMaterialNames: string[] = [],
): Promise<UnityTextureIndex | null> {
  const sourcePath = fileSystemPath(sourceFile)
  if (!sourcePath) return null
  for (const root of unityRootCandidates(sourcePath)) {
    const index = await indexRoot(root, { fbxPath: sourcePath, fbxMaterialNames })
    if (index) {
      logDebug(
        '[unity] resolved',
        Object.keys(index.byMaterial).length,
        'materials from',
        root,
      )
      return index
    }
  }
  return null
}

export async function loadUnityTextures(
  index: UnityTextureIndex,
  already: Record<string, Uint8Array> = {},
): Promise<{ siblings: Record<string, Uint8Array>; materialTextures: Record<string, string> }> {
  const siblings: Record<string, Uint8Array> = {}
  const materialTextures: Record<string, string> = {}
  const loaded = new Map<string, string>()
  for (const [name, path] of Object.entries(index.byMaterial)) {
    const pathKey = path.replaceAll('\\', '/').toLowerCase()
    let unique = loaded.get(pathKey)
    if (!unique) {
      const existing = already[basename(path).toLowerCase()]
      if (existing?.length) {
        unique = rememberTextureBytes(siblings, path, existing)
      } else {
        try {
          const bytes = await readLocalFileBytes(path)
          if (!bytes.length) continue
          unique = rememberTextureBytes(siblings, path, bytes)
        } catch (error) {
          logDebug('[unity] texture read failed:', path, error)
          continue
        }
      }
      loaded.set(pathKey, unique)
    }
    materialTextures[name] = unique
  }
  return { siblings, materialTextures }
}

/** Flatten an index into `material name → texture file name` after files are loaded. */
export function unityTextureNames(
  index: UnityTextureIndex,
  loadedNames?: Record<string, string>,
): Record<string, string> {
  if (loadedNames) return loadedNames
  const names: Record<string, string> = {}
  for (const [name, path] of Object.entries(index.byMaterial)) names[name] = basename(path)
  return names
}
