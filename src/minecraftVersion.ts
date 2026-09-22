import { invoke } from '@tauri-apps/api/core'

export interface MinecraftVersionInfo {
  id: string
  label: string
  dataVersion: number
  available: boolean
}

export const MINECRAFT_VERSION_STORAGE_KEY = 'structurelab.minecraftVersion'

const listeners = new Set<(versionId: string) => void>()

export function subscribeMinecraftVersion(listener: (versionId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyMinecraftVersion(versionId: string) {
  for (const listener of listeners) listener(versionId)
}

/**
 * Era bucket for the version picker (e.g. 26.2 → "26.+", 1.21.11 → "1.21.+").
 */
export function versionFamilyId(versionId: string): string {
  const trimmed = versionId.trim()
  // Year.drop scheme: 26.1, 26.2 → 26.+
  const yearDrop = trimmed.match(/^(\d{2})\.\d+/)
  if (yearDrop) return `${yearDrop[1]}.+`
  // Classic minor line: 1.21, 1.21.4, 1.21.11 → 1.21.+
  const classic = trimmed.match(/^(\d+)\.(\d+)/)
  if (classic) return `${classic[1]}.${classic[2]}.+`
  return `${trimmed}.+`
}

export function groupVersionsByFamily(
  versions: MinecraftVersionInfo[],
): { id: string; label: string; versions: MinecraftVersionInfo[] }[] {
  const order: string[] = []
  const map = new Map<string, MinecraftVersionInfo[]>()
  for (const entry of versions) {
    const family = versionFamilyId(entry.id)
    if (!map.has(family)) {
      order.push(family)
      map.set(family, [])
    }
    map.get(family)!.push(entry)
  }
  return order.map((id) => ({
    id,
    label: id,
    versions: map.get(id) ?? [],
  }))
}

export function readStoredMinecraftVersion(): string | null {
  try {
    const value = localStorage.getItem(MINECRAFT_VERSION_STORAGE_KEY)?.trim()
    return value || null
  } catch {
    return null
  }
}

export function storeMinecraftVersion(versionId: string): void {
  try {
    localStorage.setItem(MINECRAFT_VERSION_STORAGE_KEY, versionId)
  } catch {
    // ignore
  }
}

/** Minecraft 1.20.5. Litematica schematic v7 starts here; 1.20.4 and older mods refuse it. */
export const LITEMATIC_V7_MIN_DATA_VERSION = 3837

/** Litematica file `Version`: 6 for 1.18–1.20.4, 7 for 1.20.5+. */
export function litematicSchematicVersion(dataVersion: number): 6 | 7 {
  if (!Number.isFinite(dataVersion) || dataVersion <= 0) return 7
  return dataVersion >= LITEMATIC_V7_MIN_DATA_VERSION ? 7 : 6
}

export function litematicExportFormat(dataVersion: number): 'litematicV6' | 'litematicV7' {
  return litematicSchematicVersion(dataVersion) === 6 ? 'litematicV6' : 'litematicV7'
}

export async function listMinecraftVersions(): Promise<MinecraftVersionInfo[]> {
  return invoke<MinecraftVersionInfo[]>('list_minecraft_versions')
}

export async function getMinecraftVersion(): Promise<string> {
  return invoke<string>('get_minecraft_version')
}

export async function setMinecraftVersion(versionId: string): Promise<void> {
  await invoke('set_minecraft_version', { version: versionId })
  storeMinecraftVersion(versionId)
  // Clear caches before notifying tools so they never reload the previous palette.
  const { reloadMinecraftSession, nextConvertGeneration } = await import('./api')
  await reloadMinecraftSession()
  nextConvertGeneration()
  notifyMinecraftVersion(versionId)
}

/** Boot on the newest available Minecraft version (ignore stale local picks). */
export async function syncStoredMinecraftVersion(): Promise<string> {
  const listed = await listMinecraftVersions()
  const latest = listed.find((entry) => entry.available)
  if (latest) {
    await setMinecraftVersion(latest.id)
    return latest.id
  }
  return getMinecraftVersion()
}
