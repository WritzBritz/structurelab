import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import type {
  ConversionResponse,
  ConvertOptions,
  ExportFormat,
  ModelAppearanceCube,
  PaletteFile,
  SceneConversionResponse,
  SceneConvertOptions,
  StatueBlockPack,
} from './types'

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

/** Async base64 so large OBJ payloads don't freeze the UI mid-convert. */
export async function bytesToBase64Async(
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  let binary = ''
  const chunk = 0x8000
  const total = Math.max(bytes.length, 1)
  let steps = 0
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    steps += 1
    if (steps % 24 === 0) {
      onProgress?.(Math.min(0.99, offset / total))
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
    }
  }
  onProgress?.(1)
  return btoa(binary)
}

const STAGE_CHUNK = 256 * 1024

export async function stageBytesBegin(fileName: string): Promise<string> {
  return invoke<string>('stage_bytes_begin', { fileName })
}

export async function stageBytesAppend(path: string, bytes: Uint8Array): Promise<void> {
  const chunkBase64 = bytesToBase64(bytes)
  await invoke('stage_bytes_append', { path, chunkBase64 })
}

/** Copy on disk into the stage folder — zero JS heap for the file body. */
export async function stageCopyFromPath(source: string, fileName: string): Promise<string> {
  return invoke<string>('stage_copy_from_path', { source, fileName })
}

/** Stream bytes to a temp file in small chunks so the window doesn't lock up. */
export async function stageBytesToTemp(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const path = await stageBytesBegin(fileName)
  const total = Math.max(bytes.length, 1)
  for (let offset = 0; offset < bytes.length; offset += STAGE_CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + STAGE_CHUNK, bytes.length))
    await stageBytesAppend(path, slice)
    onProgress?.(Math.min(0.99, (offset + slice.length) / total))
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })
  }
  onProgress?.(1)
  return path
}

export async function localFileSize(path: string): Promise<number> {
  return invoke<number>('local_file_size', { path })
}

export async function readLocalFileChunk(
  path: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const base64 = await invoke<string>('read_local_file_chunk', { path, offset, length })
  return base64ToBytes(base64)
}

export async function cleanupStagedPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await invoke('stage_bytes_cleanup', { paths })
  } catch {
    // best-effort cleanup
  }
}

export async function readLocalFileBytes(
  path: string,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  const size = await localFileSize(path)
  // Always chunk above 8MB so decode never holds a huge base64 string + output.
  if (size <= 8 * 1024 * 1024) {
    onProgress?.(0)
    const base64 = await invoke<string>('read_local_file', { path })
    const bytes = base64ToBytes(base64)
    onProgress?.(1)
    return bytes
  }

  const out = new Uint8Array(size)
  const chunkSize = 2 * 1024 * 1024
  let offset = 0
  while (offset < size) {
    const chunk = await readLocalFileChunk(path, offset, Math.min(chunkSize, size - offset))
    out.set(chunk, offset)
    offset += chunk.length
    onProgress?.(Math.min(0.99, offset / Math.max(size, 1)))
    if (chunk.length === 0) break
  }
  onProgress?.(1)
  return out
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Official cape PNG from textures.minecraft.net via the native host (no CORS). */
export async function fetchCapeTexture(hash: string): Promise<Uint8Array> {
  const encoded = await invoke<string>('fetch_cape_texture', { hash })
  const bytes = base64ToBytes(encoded)
  if (bytes.length < 64) throw new Error('cape download was empty')
  return bytes
}

export type CrashLogInfo = {
  logDir: string
  logFile: string
  reportFile: string
}

export async function crashLogInfo(): Promise<CrashLogInfo> {
  return invoke<CrashLogInfo>('crash_log_info')
}

export async function openLogFolder(): Promise<void> {
  await invoke('open_log_folder')
}

/** Dev logging (browser console; also appended to the StructureLab log file). */
export function logDebug(...parts: unknown[]): void {
  const message = parts.map((part) => {
    if (typeof part === 'string') return part
    try {
      return JSON.stringify(part)
    } catch {
      return String(part)
    }
  }).join(' ')
  console.info(message)
  void invoke('debug_log', { message }).catch(() => {
    // browser / no console bridge
  })
}

/** File names in a folder (non-recursive). */
export async function listLocalDirectory(path: string): Promise<string[]> {
  return invoke<string[]>('list_local_directory', { path })
}

/** Recursive file paths under a folder (or `[path]` when `path` is a file). */
export async function walkLocalFiles(
  path: string,
  options?: {
    extensions?: string[]
    maxFiles?: number
    maxDepth?: number
  },
): Promise<string[]> {
  return invoke<string[]>('walk_local_files', {
    path,
    extensions: options?.extensions ?? null,
    maxFiles: options?.maxFiles ?? null,
    maxDepth: options?.maxDepth ?? null,
  })
}

let palettePromise: Promise<PaletteFile> | null = null

export function resetPaletteCache(): void {
  palettePromise = null
}

/** Shared palette load — boot and tools reuse the same in-flight / cached result. */
export function loadPalette(): Promise<PaletteFile> {
  palettePromise ??= invoke<PaletteFile>('get_palette')
  return palettePromise
}

export function loadModelCubes(pack: StatueBlockPack): Promise<ModelAppearanceCube[]> {
  return invoke<ModelAppearanceCube[]>('get_model_cubes', { pack })
}

/** Clear frontend caches after switching Minecraft version. */
export async function reloadMinecraftSession(): Promise<void> {
  resetPaletteCache()
  const { resetMinecraftAssets } = await import('./minecraftAssets')
  const { resetTextureCacheForVersion } = await import('./tools/models/blockTextures')
  const { resetBootCache } = await import('./boot')
  const { getMinecraftVersion } = await import('./minecraftVersion')
  resetMinecraftAssets()
  resetBootCache()
  const versionId = await getMinecraftVersion()
  resetTextureCacheForVersion(versionId)
  await import('./minecraftAssets').then(({ initMinecraftAssets }) => initMinecraftAssets())
}

let convertGeneration = 0

/** Monotonic id for convert invokes so a slower older request cannot commit last. */
export function nextConvertGeneration(): number {
  convertGeneration += 1
  return convertGeneration
}

export async function convert(
  bytes: Uint8Array,
  options: ConvertOptions,
): Promise<ConversionResponse> {
  const generation = nextConvertGeneration()
  // Large map sources: encode off the critical path so the UI can keep painting.
  const imageBase64 =
    bytes.length > 256 * 1024 ? await bytesToBase64Async(bytes) : bytesToBase64(bytes)
  return invoke<ConversionResponse>('convert_image', {
    imageBase64,
    options,
    generation,
  })
}

export async function convertScene(
  options: SceneConvertOptions,
  generation = nextConvertGeneration(),
): Promise<SceneConversionResponse> {
  return invoke<SceneConversionResponse>('convert_scene', { options, generation })
}

const exportInfo: Record<
  ExportFormat,
  { extension: string; name: string; filter: string }
> = {
  vanillaNbt: { extension: 'nbt', name: 'build.nbt', filter: 'Vanilla structure' },
  vanillaSplit: {
    extension: 'zip',
    name: 'build-vanilla-pieces.zip',
    filter: 'Vanilla structure pieces',
  },
  litematicV6: {
    extension: 'litematic',
    name: 'build-v6.litematic',
    filter: 'Litematica v6',
  },
  litematicV7: {
    extension: 'litematic',
    name: 'build.litematic',
    filter: 'Litematica v7',
  },
  spongeV3: { extension: 'schem', name: 'build.schem', filter: 'Sponge schematic' },
  all: { extension: 'zip', name: 'build-all-formats.zip', filter: 'All formats' },
}

export async function saveExport(
  format: ExportFormat,
  options?: { minecraftVersion?: string; dataVersion?: number },
): Promise<boolean> {
  const info = exportInfo[format]
  let versionId = options?.minecraftVersion?.trim() || ''
  if (!versionId) {
    try {
      const { getMinecraftVersion } = await import('./minecraftVersion')
      versionId = await getMinecraftVersion()
    } catch {
      versionId = ''
    }
  }
  const defaultPath = versionId
    ? info.name.replace(/^build/, `build-${versionId}`)
    : info.name
  const path = await save({
    defaultPath,
    filters: [{ name: info.filter, extensions: [info.extension] }],
  })
  if (!path) return false
  await invoke('export_current', { format, path })
  return true
}
