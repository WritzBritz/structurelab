import type { SceneVoxel } from '../../types'

/**
 * Decode map/pixel-art packed preview voxels into SceneVoxel rows for the
 * place-datapack animation preview (same LE layout as MapArt3DViewer).
 */
export function packedPreviewToSceneVoxels(
  b64: string,
  palette: string[],
): SceneVoxel[] {
  if (!b64 || palette.length === 0) return []
  let raw: Uint8Array
  try {
    const bin = atob(b64)
    raw = new Uint8Array(bin.length)
    const chunk = 0x8000
    for (let offset = 0; offset < bin.length; offset += chunk) {
      const end = Math.min(offset + chunk, bin.length)
      for (let i = offset; i < end; i += 1) raw[i] = bin.charCodeAt(i)
    }
  } catch {
    return []
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const fallback = palette[0] ?? 'minecraft:stone'
  const out: SceneVoxel[] = []
  for (let o = 0; o + 7 <= raw.length; o += 7) {
    const x = view.getUint16(o, true)
    const y = view.getUint16(o + 2, true)
    const z = view.getUint16(o + 4, true)
    const idx = raw[o + 6]!
    out.push({
      x,
      y,
      z,
      rgb: [160, 160, 160],
      block: palette[idx] ?? fallback,
      part: 0,
    })
  }
  return out
}
