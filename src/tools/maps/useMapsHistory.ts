import type { ConvertOptions, DatapackPattern } from '../../types'
import type { MaterialPreset } from '../../materials'
import { useDocumentHistory, type HistoryProgress } from '../../history/useDocumentHistory'

export type MapsHistorySnapshot = {
  options: ConvertOptions
  activePreset: MaterialPreset | 'custom'
  /** Shared immutable reference — do not mutate in place. */
  imageBytes: Uint8Array | null
  fileName: string
  datapackName: string
  datapackPattern: DatapackPattern
  datapackBlocksPerTick: number
  datapackDelayTicks: number
  datapackTargetSeconds: number
  datapackPiecesPerTick: number
}

export type { HistoryProgress }

/** Show progress overlay when restoring more than this many image payload bytes. */
const HEAVY_SNAPSHOT_BYTES = 1_500_000

function cloneOptions(options: ConvertOptions): ConvertOptions {
  return {
    ...options,
    disabledColorIds: [...options.disabledColorIds],
    blockOverrides: { ...options.blockOverrides },
  }
}

export function cloneMapsSnapshot(snapshot: MapsHistorySnapshot): MapsHistorySnapshot {
  return {
    options: cloneOptions(snapshot.options),
    activePreset: snapshot.activePreset,
    imageBytes: snapshot.imageBytes,
    fileName: snapshot.fileName,
    datapackName: snapshot.datapackName,
    datapackPattern: snapshot.datapackPattern,
    datapackBlocksPerTick: snapshot.datapackBlocksPerTick,
    datapackDelayTicks: snapshot.datapackDelayTicks,
    datapackTargetSeconds: snapshot.datapackTargetSeconds,
    datapackPiecesPerTick: snapshot.datapackPiecesPerTick,
  }
}

export function estimateMapsSnapshotBytes(snapshot: MapsHistorySnapshot): number {
  return snapshot.imageBytes?.byteLength ?? 0
}

export function snapshotNeedsProgress(snapshot: MapsHistorySnapshot): boolean {
  return estimateMapsSnapshotBytes(snapshot) >= HEAVY_SNAPSHOT_BYTES
}

export function useMapsHistory(
  getSnapshot: () => MapsHistorySnapshot,
  applySnapshot: (snapshot: MapsHistorySnapshot) => void,
) {
  return useDocumentHistory(getSnapshot, applySnapshot, {
    cloneSnapshot: cloneMapsSnapshot,
    needsProgress: snapshotNeedsProgress,
  })
}

/** Coalesce key for continuous option edits (sliders / size numbers). */
export function mapsCoalesceKey(key: keyof ConvertOptions): string | undefined {
  switch (key) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      return 'tune'
    case 'maxHeight':
      return 'maxHeight'
    case 'mapsX':
    case 'mapsY':
    case 'blocksX':
    case 'blocksZ':
      return 'size'
    default:
      return undefined
  }
}

export function previewUrlFromImageBytes(bytes: Uint8Array | null): string {
  if (!bytes) return ''
  // Copy into a fresh ArrayBuffer-backed view so BlobPart typing accepts it.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return URL.createObjectURL(new Blob([copy], { type: 'image/png' }))
}
