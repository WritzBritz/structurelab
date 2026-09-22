import { listLocalDirectory, logDebug, readLocalFileBytes } from '../../api'
import { decodeExportText, repairMojibake } from './exportText'

/** Helpers for Wavefront OBJ companion files (.mtl + textures). */

export type ObjDependencies = {
  mtlFileName: string | null
  textureFileNames: string[]
}

export function scanObjDependencies(objBytes: Uint8Array): ObjDependencies {
  const text = decodeExportText(objBytes)
  let mtlFileName: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.toLowerCase().startsWith('mtllib ')) {
      const name = line.slice(7).trim().replace(/^["']|["']$/g, '').split(/\s+/)[0]
      if (name) {
        mtlFileName = repairMojibake(basename(name)).normalize('NFC')
        break
      }
    }
  }
  return { mtlFileName, textureFileNames: [] }
}

export function scanMtlTextureRefs(mtlBytes: Uint8Array): string[] {
  const text = decodeExportText(mtlBytes)
  const found = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const lower = line.toLowerCase()
    if (
      lower.startsWith('map_kd ')
      || lower.startsWith('map_ka ')
      || lower.startsWith('map_ks ')
      || lower.startsWith('map_d ')
      || lower.startsWith('map_bump ')
      || lower.startsWith('bump ')
    ) {
      const parts = line.split(/\s+/).slice(1)
      // Skip option flags like -o / -s
      const path = (parts.find((part) => !part.startsWith('-') && part.includes('.'))
        ?? parts[parts.length - 1]
        ?? '').replace(/^["']|["']$/g, '')
      if (path) found.add(repairMojibake(basename(path)).normalize('NFC'))
    }
  }
  return [...found]
}

/** Replace map_* basenames so MTL UTF-8 matches the files we actually attached. */
export function rewriteMtlTextureRefs(
  mtlBytes: Uint8Array,
  rename: (baseName: string) => string,
): Uint8Array {
  const text = decodeExportText(mtlBytes)
  const prefixes = ['map_kd ', 'map_ka ', 'map_ks ', 'map_d ', 'map_bump ', 'bump ']
  const next = text.split(/\r?\n/).map((raw) => {
    const trimmed = raw.trim()
    const lower = trimmed.toLowerCase()
    const prefix = prefixes.find((item) => lower.startsWith(item))
    if (!prefix) return raw
    const indent = raw.match(/^\s*/)?.[0] ?? ''
    const keyword = trimmed.slice(0, prefix.length)
    const parts = trimmed.slice(prefix.length).split(/\s+/)
    const idx = parts.findIndex((part) => !part.startsWith('-') && part.includes('.'))
    const pathIdx = idx >= 0 ? idx : parts.length - 1
    const original = (parts[pathIdx] ?? '').replace(/^["']|["']$/g, '')
    if (!original) return raw
    const nextName = rename(repairMojibake(basename(original)).normalize('NFC'))
    if (!nextName) return raw
    parts[pathIdx] = /[\s]/.test(nextName) ? `"${nextName}"` : nextName
    return `${indent}${keyword}${parts.join(' ')}`
  }).join('\n')
  return new TextEncoder().encode(next)
}

export function parseMtlDiffuseColors(mtlBytes: Uint8Array): Map<string, [number, number, number]> {
  const text = decodeExportText(mtlBytes)
  const colors = new Map<string, [number, number, number]>()
  let current: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.toLowerCase().startsWith('newmtl ')) {
      current = repairMojibake(line.slice(7).trim()).normalize('NFC')
      colors.set(current, [0.72, 0.74, 0.78])
    } else if (current && line.toLowerCase().startsWith('kd ')) {
      const parts = line.split(/\s+/)
      colors.set(current, [
        Number(parts[1]) || 0,
        Number(parts[2]) || 0,
        Number(parts[3]) || 0,
      ])
    }
  }
  return colors
}

export function basename(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

/** Tauri file dialog / drag-drop often exposes an absolute path on the File object. */
export function fileSystemPath(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}

/** Attach a real disk path onto a File so sibling auto-load can work. */
export function fileWithPath(bytes: Uint8Array, fileName: string, absolutePath: string): File {
  // Do not copy — File/Blob can reference the same buffer view.
  const file = new File([bytes as BlobPart], basename(fileName) || basename(absolutePath))
  Object.defineProperty(file, 'path', { value: absolutePath, configurable: true })
  return file
}

/** Path-only stub: body is read later via Tauri (avoids double-loading large files). */
export function fileFromPath(absolutePath: string, fileName?: string): File {
  const name = basename(fileName || absolutePath)
  const file = new File([], name)
  Object.defineProperty(file, 'path', { value: absolutePath, configurable: true })
  return file
}

export function siblingPath(filePath: string, siblingName: string): string {
  // Preserve the host/source separator so companions resolve on Windows and Unix.
  const sep = filePath.includes('\\') ? '\\' : '/'
  const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  const dir = cut >= 0 ? filePath.slice(0, cut) : ''
  const stack = dir ? dir.split(sep) : []
  const rootLen =
    sep === '\\' && stack[0] && /^[a-zA-Z]:$/.test(stack[0])
      ? 1
      : stack[0] === ''
        ? 1
        : 0
  // Leading `/textures/foo.png` is a model-root path, not the OS root. Drive
  // prefixes are stripped the same way. `../textures` still walks up from the
  // OBJ folder so nested `models/` + sibling `textures/` layouts resolve.
  let rel = siblingName.replaceAll(/[/\\]+/g, sep).replace(/^[\\/]+/, '')
  rel = rel.replace(/^[a-zA-Z]:[\\/]*/, '')
  let up = 0
  for (const part of rel.split(sep)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > rootLen) stack.pop()
      else if (rootLen === 0) up += 1
      continue
    }
    stack.push(part)
  }
  const parts = [...Array.from({ length: up }, () => '..'), ...stack]
  if (parts.length === 0) return ''
  return parts.join(sep) || sep
}

/** Read a companion sitting next to a dropped/selected file (Tauri only). */
export async function tryReadSiblingBytes(
  sourceFile: File,
  siblingName: string,
): Promise<Uint8Array | null> {
  const sourcePath = fileSystemPath(sourceFile)
  if (!sourcePath) {
    logDebug(
      `[companions] no disk path on File("${sourceFile.name}") — cannot auto-load "${siblingName}". Use Add models (native dialog).`,
    )
    return null
  }
  const full = siblingPath(sourcePath, siblingName)
  try {
    const bytes = await readLocalFileBytes(full)
    logDebug(`[companions] loaded ${full} (${bytes.length} bytes)`)
    return bytes
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    // Trying beside the scene then textures/ is normal; only log unexpected IO.
    if (!/cannot find the file|os error 2|ENOENT|not found/i.test(msg)) {
      logDebug(`[companions] failed to read ${full}:`, error)
    }
    return null
  }
}

/**
 * Resolve companions named inside a .miobject (`resources[].filename`) from the
 * same folder as the .miobject. Returns only files that were found on disk.
 * Also picks up sibling `.png`/`.jpg` skins when a named texture is missing.
 */
export async function tryReadMiobjectCompanions(
  miobjectFile: File,
  fileNames: string[],
): Promise<Record<string, Uint8Array>> {
  const found: Record<string, Uint8Array> = {}
  const unique = [...new Set(fileNames.map((name) => basename(name)).filter(Boolean))]
  logDebug(
    `[companions] resolving for ${miobjectFile.name} path=${fileSystemPath(miobjectFile) ?? '(none)'} wants=[${unique.join(', ')}]`,
  )
  for (const name of unique) {
    const bytes = await tryReadSiblingBytes(miobjectFile, name)
    if (bytes && bytes.length > 0) {
      found[name.toLowerCase()] = bytes
    }
  }

  const sourcePath = fileSystemPath(miobjectFile)
  // Always scan the folder for image siblings. Miobject skins are often a hash
  // PNG; mimodel may still declare a placeholder (e.g. alex.png). Keep every
  // PNG ready so we can prefer the real skin and fall back to the placeholder.
  if (sourcePath) {
    try {
      const cut = Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/'))
      const dir = cut >= 0 ? sourcePath.slice(0, cut) : ''
      if (dir) {
        const names = await listLocalDirectory(dir)
        for (const name of names) {
          if (!/\.(png|jpe?g|webp|bmp)$/i.test(name)) continue
          const key = name.toLowerCase()
          if (found[key]) continue
          const bytes = await tryReadSiblingBytes(miobjectFile, name)
          if (bytes && bytes.length > 0) {
            found[key] = bytes
            logDebug(`[companions] folder skin: ${name}`)
          }
        }
      }
    } catch (error) {
      logDebug('[companions] folder scan failed:', error)
    }
  }

  logDebug(`[companions] found: [${Object.keys(found).join(', ') || '(none)'}]`)
  return found
}

export async function readFileWithProgress(
  file: File,
  onProgress: (ratio: number, label: string) => void,
): Promise<Uint8Array> {
  onProgress(0, `Reading ${file.name}…`)

  // Prefer disk path — avoids re-buffering a File that was already loaded once.
  const diskPath = fileSystemPath(file)
  if (diskPath) {
    const bytes = await readLocalFileBytes(diskPath, (ratio) => {
      onProgress(ratio, `Reading ${file.name}…`)
    })
    onProgress(1, `Loaded ${file.name}`)
    return bytes
  }

  if (!file.stream || file.size <= 0) {
    const buffer = await file.arrayBuffer()
    onProgress(1, `Loaded ${file.name}`)
    return new Uint8Array(buffer)
  }

  const reader = file.stream().getReader()
  const total = file.size
  const out = new Uint8Array(total)
  let received = 0
  const yieldEvery = Math.max(256 * 1024, Math.floor(total / 40))
  let sinceYield = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (received + value.byteLength > out.length) {
      // Rare: reported size was wrong — grow once.
      const grown = new Uint8Array(received + value.byteLength)
      grown.set(out.subarray(0, received), 0)
      grown.set(value, received)
      received += value.byteLength
      const rest: Uint8Array[] = [grown]
      let restLen = received
      while (true) {
        const next = await reader.read()
        if (next.done) break
        rest.push(next.value)
        restLen += next.value.byteLength
        onProgress(Math.min(0.99, restLen / Math.max(total, restLen)), `Reading ${file.name}…`)
      }
      const merged = new Uint8Array(restLen)
      let offset = 0
      for (const chunk of rest) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      onProgress(1, `Loaded ${file.name}`)
      return merged
    }
    out.set(value, received)
    received += value.byteLength
    sinceYield += value.byteLength
    onProgress(Math.min(0.99, received / total), `Reading ${file.name}…`)
    if (sinceYield >= yieldEvery) {
      sinceYield = 0
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
    }
  }

  onProgress(1, `Loaded ${file.name}`)
  return received === out.length ? out : out.subarray(0, received)
}

export function isTextureFileName(name: string): boolean {
  return /\.(png|jpe?g|webp|bmp|gif|tga|tif|tiff)$/i.test(name)
}

/** Java / Bedrock 1.18+ build height (Y −64 … 319). */
export const MC_WORLD_HEIGHT = 384

/** Matches Rust chunk-map axis cap. Air is not stored; only real blocks count. */
export const MAX_VOXEL_AXIS = 4096

/**
 * Keep a W×H×L inside a Minecraft world column. Empty air is not stored, so
 * width/length are not volume-capped.
 */
export function clampVoxelBox(size: {
  width: number
  height: number
  length: number
}): { width: number; height: number; length: number } {
  let width = Math.max(1, Math.round(size.width))
  let height = Math.max(1, Math.round(size.height))
  let length = Math.max(1, Math.round(size.length))
  if (height > MC_WORLD_HEIGHT) {
    const scale = MC_WORLD_HEIGHT / height
    width = Math.max(1, Math.round(width * scale))
    height = MC_WORLD_HEIGHT
    length = Math.max(1, Math.round(length * scale))
  }
  width = Math.min(MAX_VOXEL_AXIS, width)
  height = Math.min(MC_WORLD_HEIGHT, height)
  length = Math.min(MAX_VOXEL_AXIS, length)
  return { width, height, length }
}

/**
 * Axis spans for Auto max sizing.
 * Prefer the connected mesh AABB so extremities (arms, hair, skirts, roofs)
 * get grid room. Only stop at a large gap — studio lights / far ground planes —
 * matching Rust `fit_bounds`.
 */
export function estimateObjRobustSpan(objBytes: Uint8Array): [number, number, number] {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  let fullMin = [Infinity, Infinity, Infinity]
  let fullMax = [-Infinity, -Infinity, -Infinity]
  let seen = 0
  // Stride sample huge meshes — the connected walk stays stable and Auto stays snappy.
  const stride = objBytes.length > 8_000_000 ? 12 : objBytes.length > 2_000_000 ? 4 : 1
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.startsWith('v ')) continue
    const parts = raw.trim().split(/\s+/)
    const x = Number(parts[1])
    const y = Number(parts[2])
    const z = Number(parts[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    fullMin = [Math.min(fullMin[0]!, x), Math.min(fullMin[1]!, y), Math.min(fullMin[2]!, z)]
    fullMax = [Math.max(fullMax[0]!, x), Math.max(fullMax[1]!, y), Math.max(fullMax[2]!, z)]
    seen += 1
    if (seen % stride !== 0) continue
    xs.push(x)
    ys.push(y)
    zs.push(z)
  }
  if (xs.length < 8 || !Number.isFinite(fullMin[0]!)) return [1, 1, 1]
  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  zs.sort((a, b) => a - b)
  return [
    connectedAxisSpan(xs, fullMin[0]!, fullMax[0]!),
    connectedAxisSpan(ys, fullMin[1]!, fullMax[1]!),
    connectedAxisSpan(zs, fullMin[2]!, fullMax[2]!),
  ]
}

/** Grow from the 10th–90th percentile seed; a 3×-core gap is a disconnected prop. */
function expandConnectedAxis(sorted: number[]): [number, number] {
  const n = sorted.length
  if (n === 0) return [0, 1]
  if (n < 32) return [sorted[0]!, sorted[n - 1]!]
  const loI = Math.round((n - 1) * 0.1)
  const hiI = Math.max(loI, Math.round((n - 1) * 0.9))
  const coreSpan = Math.max(sorted[hiI]! - sorted[loI]!, 1e-5)
  const maxGap = coreSpan * 3
  let left = loI
  while (left > 0 && sorted[left]! - sorted[left - 1]! <= maxGap) left -= 1
  let right = hiI
  while (right + 1 < n && sorted[right + 1]! - sorted[right]! <= maxGap) right += 1
  return [sorted[left]!, sorted[right]!]
}

function connectedAxisSpan(sorted: number[], fullMin: number, fullMax: number): number {
  const [walkedMin, walkedMax] = expandConnectedAxis(sorted)
  const span = Math.max(walkedMax - walkedMin, 1e-5)
  const maxGap = span * 3
  const min = walkedMin - fullMin <= maxGap ? fullMin : walkedMin
  const max = fullMax - walkedMax <= maxGap ? fullMax : walkedMax
  return Math.max(max - min, 1e-3)
}

/**
 * Largest voxel box that keeps the mesh proportions and fits in one Minecraft
 * world column (height 384). Empty air is not stored.
 */
export function computeAutoObjBox(span: [number, number, number]): {
  width: number
  height: number
  length: number
} {
  const maxSpan = Math.max(span[0], span[1], span[2], 1e-3)
  return clampVoxelBox({
    width: (MC_WORLD_HEIGHT * span[0]) / maxSpan,
    height: (MC_WORLD_HEIGHT * span[1]) / maxSpan,
    length: (MC_WORLD_HEIGHT * span[2]) / maxSpan,
  })
}
