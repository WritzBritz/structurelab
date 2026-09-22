import { convertFileSrc, invoke } from '@tauri-apps/api/core'

type MinecraftAssetsInfo = {
  dir: string
  icons: string[]
  textures: string[]
  entityTextures?: string[]
  entityCatalogDir?: string | null
  blockTextureOverlayDir?: string | null
  overlayTextures?: string[]
}

let assetsDir: string | null = null
let entityCatalogDir: string | null = null
let overlayDir: string | null = null
let iconSet = new Set<string>()
let textureSet = new Set<string>()
let overlayTextureSet = new Set<string>()
let entityTextureSet = new Set<string>()
let initPromise: Promise<string | null> | null = null

function assetSrc(absolutePath: string): string {
  return convertFileSrc(absolutePath.replace(/\\/g, '/'))
}

/** Load the external `minecraft/26.2` folder path from the desktop backend. */
export async function initMinecraftAssets(): Promise<string | null> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const info = await invoke<MinecraftAssetsInfo | null>('get_minecraft_assets')
      assetsDir = info?.dir ?? null
      entityCatalogDir = info?.entityCatalogDir ?? null
      overlayDir = info?.blockTextureOverlayDir ?? null
      iconSet = new Set(info?.icons ?? [])
      textureSet = new Set(info?.textures ?? [])
      overlayTextureSet = new Set(info?.overlayTextures ?? [])
      entityTextureSet = new Set(
        (info?.entityTextures ?? []).map((name) => name.replace(/\\/g, '/').toLowerCase()),
      )
    } catch {
      assetsDir = null
      entityCatalogDir = null
      overlayDir = null
      iconSet = new Set()
      textureSet = new Set()
      overlayTextureSet = new Set()
      entityTextureSet = new Set()
    }
    return assetsDir
  })()
  return initPromise
}

export function resetMinecraftAssets(): void {
  initPromise = null
  assetsDir = null
  entityCatalogDir = null
  overlayDir = null
  iconSet = new Set()
  textureSet = new Set()
  overlayTextureSet = new Set()
  entityTextureSet = new Set()
}

export function minecraftAssetsDir(): string | null {
  return assetsDir
}

/** Absolute file URL for an asset under `minecraft/26.2` (block-icons/foo.png, etc.). */
export function minecraftAssetUrl(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const iconMatch = /^block-icons\/(.+)\.png$/i.exec(normalized)
  if (iconMatch) {
    if (!assetsDir || !iconSet.has(iconMatch[1]!)) return null
    return assetSrc(`${assetsDir}/${normalized}`)
  }
  const texMatch = /^block-textures\/(.+)\.png$/i.exec(normalized)
  if (texMatch) {
    const stem = texMatch[1]!
    if (overlayDir && overlayTextureSet.has(stem)) {
      return assetSrc(`${overlayDir}/block-textures/${stem}.png`)
    }
    if (!assetsDir || !textureSet.has(stem)) return null
    return assetSrc(`${assetsDir}/${normalized}`)
  }
  if (!assetsDir) return null
  const entityMatch = /^entity-textures\/(.+)$/i.exec(normalized)
  if (entityMatch) {
    const rel = entityMatch[1]!.replace(/\\/g, '/').toLowerCase()
    // Same as icons/block textures: only return a file URL when the PNG is
    // actually listed. An empty set used to skip this check and shadow the
    // bundled `public/entity-textures/` files with a 404 under minecraft/.
    if (!entityTextureSet.has(rel)) return null
  }
  return assetSrc(`${assetsDir}/${normalized}`)
}

/** Bundled catalog sheets first — mob import is not tied to the export version. */
export function entityTextureCandidates(relPath: string): string[] {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const urls: string[] = []
  urls.push(`./entity-textures/${rel}`, `/entity-textures/${rel}`)
  const base = import.meta.env.BASE_URL
  if (base && base !== '/' && base !== './') {
    const prefix = base.endsWith('/') ? base : `${base}/`
    const bundled = `${prefix}entity-textures/${rel}`
    if (!urls.includes(bundled)) urls.push(bundled)
  }
  if (entityCatalogDir) {
    const catalog = assetSrc(`${entityCatalogDir}/entity-textures/${rel}`)
    if (!urls.includes(catalog)) urls.push(catalog)
  }
  // Older export-version packs are last — they often omit newer mobs.
  const external = minecraftAssetUrl(`entity-textures/${rel}`)
  if (external && !urls.includes(external)) urls.push(external)
  return urls
}

/** First candidate for `<img src>` (bundled base, then user-installed). */
export function entityTextureUrl(relPath: string): string | null {
  return entityTextureCandidates(relPath)[0] ?? null
}

export type VanillaTextureInstall = {
  dir: string
  entityCount: number
  blockCount: number
}

function refreshAfterInstall<T>(result: T): Promise<T> {
  resetMinecraftAssets()
  return initMinecraftAssets().then(() => result)
}

/** Download every entity/block PNG from Mojang's asset index (not a client jar). */
export async function installVanillaTextures(): Promise<VanillaTextureInstall> {
  const result = await invoke<VanillaTextureInstall>('install_vanilla_textures')
  return refreshAfterInstall(result)
}

/** Catalog / jar path → Mojang asset-index key. */
export function toMojangAssetKey(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '')
  if (clean.startsWith('minecraft/')) return clean
  if (clean.startsWith('textures/')) return `minecraft/${clean}`
  return `minecraft/textures/${clean}`
}

/** Download only the given asset-index keys (`minecraft/textures/…`). */
export async function downloadVanillaTextureObjects(
  keys: string[],
): Promise<VanillaTextureInstall> {
  const result = await invoke<VanillaTextureInstall>('download_vanilla_texture_objects', {
    keys,
  })
  return refreshAfterInstall(result)
}

export function blockIconCandidates(blockId: string): string[] {
  const urls: string[] = []
  const external = minecraftAssetUrl(`block-icons/${blockId}.png`)
  if (external) urls.push(external)
  urls.push(`./block-icons/${blockId}.png`)
  return urls
}

export function blockTextureFileCandidates(stem: string): string[] {
  const urls: string[] = []
  const external = minecraftAssetUrl(`block-textures/${stem}.png`)
  if (external) urls.push(external)
  urls.push(`./block-textures/${stem}.png`)
  return urls
}
