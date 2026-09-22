/**
 * Shared sidecar / folder / embed texture lookup for FBX, COLLADA, Maya, glTF.
 *
 * Exporters do not put rasters next to the scene file:
 * - Blender FBX "Copy" → `Model.fbm/`
 * - Unity / VRoid → `Material/…/Tex`, `Assets/…`, or a sibling `FBX/` folder
 * - Maya → `sourceimages/` or `textures/`
 * - Mixamo / "embed media" → Video.Content inside the FBX (handled by the parser)
 * - Sketchfab / generic → `textures/`, `tex/`, `maps/`, `images/`
 *
 * Matching is by RelativeFilename when we have it, then basename, then same-stem
 * TGA/TIFF/PNG. Dropped folders are expanded recursively. Never keyed to one model.
 */

import { logDebug, readLocalFileBytes, walkLocalFiles } from '../../api'
import { isWantedTextureOnDisk, sniffImageMime, textureNamesToProbe } from './decodeImage'
import {
  exportNameAliases,
  exportNamesMatch,
  foldExportName,
  repairMojibake,
} from './exportText'
import {
  basename,
  fileFromPath,
  fileSystemPath,
  isTextureFileName,
  tryReadSiblingBytes,
} from './objAssets'

export const RASTER_TEXTURE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'bmp',
  'gif',
  'tga',
  'tif',
  'tiff',
]

const SOURCE_WALK_EXTENSIONS = [
  ...RASTER_TEXTURE_EXTENSIONS,
  'fbx',
  'obj',
  'mtl',
  'dae',
  'gltf',
  'glb',
  'mb',
  'ma',
  'vox',
  'bbmodel',
  'miobject',
  'mimodel',
]

const SKIP_DROP_EXTENSIONS = new Set([
  'rar',
  'zip',
  '7z',
  'tar',
  'gz',
  'prefab',
  'meta',
  'unity',
  'asset',
  'controller',
  'anim',
  'psd',
  'html',
  'txt',
  'md',
  'ds_store',
])

/** Folders exporters commonly dump rasters into, relative to the scene file. */
export const TEXTURE_SEARCH_SUBDIRS = [
  'textures',
  'texture',
  'tex',
  'maps',
  'map',
  'sourceimages',
  'sourceimage',
  'images',
  'img',
  'materials',
  'material',
]

export type SidecarLoadOptions = {
  sourceFile: File
  wanted: string[]
  already?: Record<string, Uint8Array>
  droppedFiles?: File[]
  readDropped?: (file: File) => Promise<Uint8Array>
  /**
   * Also pick rasters from `.fbm` / `textures` / `sourceimages` / Unity
   * `Material/Tex` when the scene listed no names, or those names are missing.
   */
  vacuumCommonFolders?: boolean
}

export function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut >= 0 ? path.slice(0, cut) : ''
}

/**
 * When two rasters share a basename (`Face/Tex/Alpha.png` vs `Hair/Tex/Alpha.png`),
 * keep both by prefixing the parent folder instead of letting the second overwrite.
 */
export function uniqueTextureFileName(fullPath: string, taken: Set<string>): string {
  const repairedPath = repairMojibake(fullPath).normalize('NFC')
  const base = basename(repairedPath)
  const has = (name: string) => {
    const fold = foldExportName(name)
    for (const key of taken) {
      if (foldExportName(key) === fold) return true
    }
    return false
  }
  if (!has(base)) return base
  const parts = repairedPath.replaceAll('\\', '/').split('/').filter(Boolean)
  for (let n = 1; n < parts.length; n += 1) {
    const prefix = parts.slice(Math.max(0, parts.length - 1 - n), parts.length - 1).join('_')
    if (!prefix) continue
    const candidate = `${prefix}_${base}`
    if (!has(candidate)) return candidate
  }
  let serial = 2
  let next = `${base.replace(/(\.[^.]+)?$/, `_${serial}$1`)}`
  while (has(next)) {
    serial += 1
    next = `${base.replace(/(\.[^.]+)?$/, `_${serial}$1`)}`
  }
  return next
}

function indexTextureAliases(
  found: Record<string, Uint8Array>,
  name: string,
  bytes: Uint8Array,
) {
  for (const alias of exportNameAliases(name)) {
    const key = alias.toLowerCase()
    if (!found[key]?.length) found[key] = bytes
    const fold = foldExportName(alias)
    if (!found[fold]?.length) found[fold] = bytes
  }
}

export function rememberTextureBytes(
  found: Record<string, Uint8Array>,
  fullPathOrName: string,
  bytes: Uint8Array,
): string {
  const unique = uniqueTextureFileName(fullPathOrName, new Set(Object.keys(found)))
  found[unique.toLowerCase()] = bytes
  indexTextureAliases(found, unique, bytes)
  indexTextureAliases(found, basename(fullPathOrName), bytes)
  const base = basename(fullPathOrName).toLowerCase()
  if (!found[base]?.length) found[base] = bytes
  return unique
}

export function sceneStem(fileName: string): string {
  return basename(fileName).replace(/\.[^.]+$/, '')
}

export function fbmFolderName(fileName: string): string {
  return `${sceneStem(fileName)}.fbm`
}

export function normalizeTextureRef(raw: string): { base: string; relative: string } {
  let value = repairMojibake(raw.trim()).replaceAll('\\', '/')
  if (/^file:/i.test(value)) {
    value = value.replace(/^file:\/+/i, '')
    if (/^\/?[a-z]:\//i.test(value)) value = value.replace(/^\//, '')
  }
  value = value.split(/[?#]/)[0] ?? value
  try {
    value = decodeURIComponent(value)
  } catch {
    // Keep exporter paths usable as-is.
  }
  value = repairMojibake(value).normalize('NFC')
  const base = basename(value)
  const absolute = /^[a-zA-Z]:/.test(value) || value.startsWith('//')
  if (absolute || !value.includes('/')) {
    return { base, relative: base }
  }
  let relative = value.replace(/^\//, '')
  relative = relative.replace(/^assets\//i, '')
  return { base, relative: relative || base }
}

/**
 * Relative paths to try next to the scene file for one FBX/Maya/DAE/glTF ref.
 * Covers Copy-to-.fbm, Maya sourceimages, Unity Material trees, and `../textures`.
 */
export function sidecarSearchRelatives(sceneFileName: string, ref: string): string[] {
  const { base, relative } = normalizeTextureRef(ref)
  const fbm = fbmFolderName(sceneFileName)
  const names = new Set<string>()
  const add = (value: string) => {
    const clean = value.replaceAll(/\\/g, '/').replace(/^\/+/, '')
    if (clean) names.add(clean)
  }
  add(base)
  if (relative !== base) add(relative)
  add(`${fbm}/${base}`)
  for (const folder of [
    'textures',
    'tex',
    'sourceimages',
    'maps',
    'material',
    'materials',
    'images',
    'Material/Tex',
    'material/tex',
  ]) {
    add(`${folder}/${base}`)
    add(`../${folder}/${base}`)
  }
  return [...names]
}

function droppedFileMatches(file: File, wantedRelative: string): boolean {
  const { base, relative } = normalizeTextureRef(wantedRelative)
  const name = basename(file.name)
  if (exportNamesMatch(name, base)) {
    const disk = fileSystemPath(file)?.replaceAll('\\', '/')
    if (disk && relative.includes('/')) {
      const diskFold = foldExportName(disk)
      const relFold = foldExportName(relative)
      const baseFold = foldExportName(base)
      return diskFold.endsWith(`/${relFold}`) || diskFold.endsWith(`/${baseFold}`)
    }
    return true
  }
  const disk = (fileSystemPath(file) ?? file.name).replaceAll('\\', '/')
  const rel = relative.replaceAll('\\', '/')
  const diskFold = foldExportName(disk)
  const relFold = foldExportName(rel)
  return diskFold.endsWith(`/${relFold}`) || diskFold.endsWith(relFold)
}

function pickDroppedFile(dropped: File[], wanted: string): File | undefined {
  const { relative, base } = normalizeTextureRef(wanted)
  const relHit = dropped.find((file) => {
    const disk = fileSystemPath(file)?.replaceAll('\\', '/').toLowerCase()
    if (!disk) return false
    const rel = relative.replaceAll('\\', '/').toLowerCase()
    return rel.includes('/') && (disk.endsWith(`/${rel}`) || disk.endsWith(rel))
  })
  if (relHit) return relHit
  return dropped.find((file) => droppedFileMatches(file, base))
}

function isRasterBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  const mime = sniffImageMime(bytes)
  return mime !== 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50)
}

export function decodeAsciiEmbeddedImage(source: string): Uint8Array | null {
  const cleaned = source.replace(/\s+/g, '')
  if (cleaned.length < 32 || cleaned.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) return null
  try {
    const binary = atob(cleaned)
    if (binary.length < 16) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return isRasterBytes(bytes) ? bytes : null
  } catch {
    return null
  }
}

export function embeddedImageFromContent(bytes: Uint8Array | null | undefined): Uint8Array | null {
  if (!bytes || bytes.length < 16) return null
  return isRasterBytes(bytes) ? bytes : null
}

export async function expandDroppedLocalPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (!path) continue
    let walked: string[] = []
    try {
      walked = await walkLocalFiles(path, {
        extensions: SOURCE_WALK_EXTENSIONS,
        maxFiles: 500,
        maxDepth: 8,
      })
    } catch (error) {
      logDebug('[sidecars] walk failed:', path, error)
      walked = [path]
    }
    if (walked.length === 0) walked = [path]
    for (const full of walked) {
      const ext = basename(full).split('.').pop()?.toLowerCase() ?? ''
      if (SKIP_DROP_EXTENSIONS.has(ext)) continue
      const key = full.replaceAll('/', '\\').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(full)
    }
  }
  return out
}

function inCommonTextureFolder(fullPath: string): boolean {
  const disk = fullPath.replaceAll('\\', '/')
  if (/\.fbm\//i.test(disk)) return true
  const lower = disk.toLowerCase()
  return TEXTURE_SEARCH_SUBDIRS.some((folder) => lower.includes(`/${folder}/`))
}

function albedoScore(fileName: string): number {
  const file = basename(fileName).toLowerCase().replace(/\.[^.]+$/, '')
  let score = 1
  if (/^(base|albedo|diffuse|main|color|colour|col)$/.test(file)) score += 20
  if (/(^|[_-])(base|basecolor|albedo|diffuse|main|color|colour)([_-]|$)/.test(file)) score += 8
  if (/(nomal|normal|mask|ao|occlusion|rim|emi|emissive|matcap|alpha|line|spec|rough|metal|bump)/.test(file)) {
    score -= 10
  }
  return score
}

/** Prefer `Base.png` / albedo over masks and normals when the FBX name is missing on disk. */
export function pickFallbackAlbedo(
  found: Record<string, Uint8Array>,
): { fileName: string; bytes: Uint8Array } | null {
  let best: { fileName: string; bytes: Uint8Array; score: number } | null = null
  const seen = new Set<string>()
  for (const [name, bytes] of Object.entries(found)) {
    if (!bytes?.length || !isTextureFileName(name)) continue
    const key = foldExportName(basename(name))
    if (seen.has(key)) continue
    seen.add(key)
    const score = albedoScore(name)
    if (score < 1) continue
    if (!best || score > best.score) best = { fileName: basename(name), bytes, score }
  }
  return best
}

function pathMatchScore(fullPath: string, wanted: string): number {
  const disk = fullPath.replaceAll('\\', '/')
  const { base, relative } = normalizeTextureRef(wanted)
  const file = basename(fullPath)
  const rel = relative.replaceAll('\\', '/')
  const diskFold = foldExportName(disk)
  const relFold = foldExportName(rel)
  if (rel.includes('/') && (diskFold.endsWith(`/${relFold}`) || diskFold.endsWith(relFold))) return 4
  if (exportNamesMatch(file, base)) return inCommonTextureFolder(fullPath) ? 2 : 1
  return 0
}

export function findTextureBytes(
  siblings: Record<string, Uint8Array>,
  raw: string,
): { fileName: string; bytes: Uint8Array } | null {
  const ref = normalizeTextureRef(raw)
  const parent = ref.relative.includes('/')
    ? (ref.relative.replaceAll('\\', '/').split('/').slice(-2, -1)[0] ?? '')
    : ''
  const keys = [
    ...exportNameAliases(raw),
    ...exportNameAliases(ref.relative),
    ...exportNameAliases(ref.base),
    parent ? `${parent}_${ref.base}` : '',
  ]
  for (const key of keys) {
    if (!key) continue
    const bytes = siblings[key] ?? siblings[key.toLowerCase()] ?? siblings[foldExportName(key)]
    if (bytes?.length) {
      return { fileName: ref.base, bytes }
    }
  }
  for (const [name, bytes] of Object.entries(siblings)) {
    if (!bytes?.length) continue
    if (exportNamesMatch(basename(name), ref.base)) {
      return { fileName: ref.base, bytes }
    }
  }
  for (const alias of textureNamesToProbe(ref.base)) {
    const hit = siblings[alias.toLowerCase()] ?? siblings[foldExportName(alias)]
    if (hit?.length) return { fileName: ref.base, bytes: hit }
  }
  return null
}

export function filesFromLocalPaths(paths: string[]): File[] {
  return paths.map((path) => fileFromPath(path))
}

async function loadFromWalk(
  dir: string,
  wanted: string[],
  found: Record<string, Uint8Array>,
  vacuumCommonFolders: boolean,
): Promise<void> {
  const wantedBases = wanted.map((name) => basename(name))
  let files: string[] = []
  try {
    files = await walkLocalFiles(dir, {
      extensions: RASTER_TEXTURE_EXTENSIONS,
      maxFiles: 400,
      maxDepth: 8,
    })
  } catch (error) {
    logDebug('[sidecars] recursive scan failed:', dir, error)
    return
  }
  for (const full of files) {
    const name = basename(full)
    const inCommonFolder = inCommonTextureFolder(full)
    let bestScore = 0
    let bestWanted: string | undefined
    for (const item of wanted) {
      const score = pathMatchScore(full, item)
      if (score > bestScore) {
        bestScore = score
        bestWanted = item
      }
    }
    if (wantedBases.length > 0) {
      if (bestScore === 0 && !isWantedTextureOnDisk(name, wantedBases)) continue
    } else if (!vacuumCommonFolders || !inCommonFolder) {
      continue
    }
    try {
      const bytes = await readLocalFileBytes(full)
      if (!bytes.length) continue
      rememberTextureBytes(found, full, bytes)
      if (bestWanted && bestScore >= 4) {
        const { relative } = normalizeTextureRef(bestWanted)
        found[relative.toLowerCase()] = bytes
      }
    } catch (error) {
      logDebug('[sidecars] read failed:', full, error)
    }
  }
}

export async function autoLoadSidecarTextures(
  options: SidecarLoadOptions,
): Promise<Record<string, Uint8Array>> {
  const found: Record<string, Uint8Array> = { ...(options.already ?? {}) }
  const dropped = options.droppedFiles ?? []
  const wanted = options.wanted
  const toLoad = new Set<string>()
  for (const name of wanted) {
    toLoad.add(name)
    for (const alias of textureNamesToProbe(basename(name))) toLoad.add(alias)
  }

  for (const name of toLoad) {
    const key = basename(name).toLowerCase()
    const fold = foldExportName(basename(name))
    if (found[key]?.length || found[fold]?.length) continue
    const fromDrop = pickDroppedFile(dropped, name)
    if (fromDrop && options.readDropped) {
      rememberTextureBytes(found, fromDrop.name || name, await options.readDropped(fromDrop))
      continue
    }
    for (const rel of sidecarSearchRelatives(options.sourceFile.name, name)) {
      const bytes = await tryReadSiblingBytes(options.sourceFile, rel)
      if (bytes?.length) {
        rememberTextureBytes(found, name, bytes)
        break
      }
    }
  }

  const sourcePath = fileSystemPath(options.sourceFile)
  const hasLoaded = (name: string) => {
    const base = basename(name)
    return Boolean(found[base.toLowerCase()]?.length || found[foldExportName(base)]?.length)
  }
  const missing = () => [...toLoad].filter((name) => !hasLoaded(name))
  const nestDir = /^(fbx|obj|dae|gltf|glb|models?|meshes?|exports?|geo|geometry)$/i
  const dumpDir = /^(downloads|desktop|documents|pictures|onedrive)$/i
  const roots: string[] = []
  if (sourcePath) {
    const cut = Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/'))
    const dir = cut >= 0 ? sourcePath.slice(0, cut) : ''
    const parentCut = dir ? Math.max(dir.lastIndexOf('\\'), dir.lastIndexOf('/')) : -1
    const parent = parentCut >= 0 ? dir.slice(0, parentCut) : ''
    const sep = sourcePath.includes('\\') ? '\\' : '/'
    const fbm = dir ? `${dir}${sep}${fbmFolderName(options.sourceFile.name)}` : ''
    roots.push(dir, fbm)
    if (
      parent
      && nestDir.test(basename(dir))
      && !dumpDir.test(basename(parent))
    ) {
      roots.push(parent)
    }
  }

  if (sourcePath && (missing().length > 0 || (wanted.length === 0 && options.vacuumCommonFolders))) {
    for (const root of roots.filter(Boolean)) {
      const stillMissing = missing()
      if (wanted.length > 0 && stillMissing.length === 0) break
      await loadFromWalk(root, wanted, found, Boolean(options.vacuumCommonFolders))
    }
  }

  // FBX often stores the original PC path (`…\냥이베이스.png`). This copy's
  // rasters live in Unity `Material/Tex` under another name (`Base.png`).
  if (missing().length > 0) {
    if (sourcePath) {
      for (const root of roots.filter(Boolean)) {
        await loadFromWalk(root, [], found, true)
      }
    }
    if (options.readDropped && dropped.length > 0) {
      const rasters = dropped.filter((file) => isTextureFileName(file.name))
      const take = rasters.filter((file) => {
        if (rasters.length <= 12) return true
        return inCommonTextureFolder(fileSystemPath(file) ?? file.name)
      })
      for (const file of take) {
        const full = fileSystemPath(file) ?? file.name
        if (hasLoaded(file.name)) continue
        rememberTextureBytes(found, full, await options.readDropped(file))
      }
    }
    const albedo = pickFallbackAlbedo(found)
    if (albedo) {
      for (const name of missing()) {
        indexTextureAliases(found, basename(name), albedo.bytes)
        found[basename(name).toLowerCase()] = albedo.bytes
      }
    }
  }

  return found
}

export { isTextureFileName }
