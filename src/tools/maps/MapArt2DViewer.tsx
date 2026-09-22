/**
 * Top-down 2D map preview using the actual block face textures
 * (same assets as the 3D viewer), one tile per map pixel.
 */
import { forwardRef, useEffect, useRef } from 'react'
import { loadBlockFaceImage, type BlockFaceImage } from '../models/blockTextures'

type Props = {
  width: number
  length: number
  mapsX: number
  mapsY: number
  zoom: number
  previewSurfacePalette: string[]
  previewSurfaceIndices: string
  /** Solid map-colour PNG used while textures load / as fallback. */
  previewDataUrl: string
}

const TEX = 16
/** Browser / GPU canvas limits — keep internal bitmap under this on each axis. */
const MAX_CANVAS_EDGE = 4096
/** Reserved surface index for skipped transparent pixels. */
const EMPTY_SURFACE = 255
/** Yield to the UI every this many rows while stamping textures. */
const YIELD_ROWS = 64

const MapArt2DViewer = forwardRef<HTMLDivElement, Props>(function MapArt2DViewer(
  {
    width,
    length,
    mapsX,
    mapsY,
    zoom,
    previewSurfacePalette,
    previewSurfaceIndices,
    previewDataUrl,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < 1 || length < 1) return

    let cancelled = false
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    if (!ctx) return

    const cell = Math.max(
      1,
      Math.min(TEX, Math.floor(MAX_CANVAS_EDGE / Math.max(width, length))),
    )
    canvas.width = width * cell
    canvas.height = length * cell
    ctx.imageSmoothingEnabled = false

    // Show the colour preview immediately so the frame never goes blank.
    const colourPreview = new Image()
    colourPreview.onload = () => {
      if (cancelled) return
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(colourPreview, 0, 0, canvas.width, canvas.height)
    }
    colourPreview.src = previewDataUrl

    const run = async () => {
      const indices = decodeIndices(previewSurfaceIndices)
      if (indices.length < width * length || previewSurfacePalette.length === 0) return

      const unique = new Set<number>()
      for (let i = 0; i < indices.length; i += 1) {
        const idx = indices[i]!
        if (idx !== EMPTY_SURFACE) unique.add(idx)
      }

      const textures = new Map<number, ImageData | null>()
      await Promise.all(
        [...unique].map(async (idx) => {
          const block = previewSurfacePalette[idx]
          if (!block) {
            textures.set(idx, null)
            return
          }
          const tile = await loadBlockFaceImage(block)
          if (!tile) {
            textures.set(idx, null)
            return
          }
          textures.set(idx, sampleTexture(tile, cell))
        }),
      )
      if (cancelled) return

      // One ImageData write is far cheaper than millions of drawImage calls.
      const out = ctx.createImageData(canvas.width, canvas.height)
      const dst = out.data
      const outW = canvas.width
      const check = Math.max(4, cell)

      for (let z = 0; z < length; z += 1) {
        if (cancelled) return
        if (z > 0 && z % YIELD_ROWS === 0) {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          })
          if (cancelled) return
        }
        for (let x = 0; x < width; x += 1) {
          const idx = indices[z * width + x] ?? EMPTY_SURFACE
          const dx = x * cell
          const dy = z * cell
          if (idx === EMPTY_SURFACE) {
            const dark = ((Math.floor(dx / check) + Math.floor(dy / check)) & 1) === 0
            if (dark) fillRect(dst, outW, dx, dy, cell, cell, 0x1a, 0x22, 0x2c)
            else fillRect(dst, outW, dx, dy, cell, cell, 0x15, 0x1b, 0x24)
            continue
          }
          const tile = textures.get(idx)
          if (!tile) {
            // Purple/black so missing textures aren't mistaken for grey wool.
            const dark = ((Math.floor(dx / check) + Math.floor(dy / check)) & 1) === 0
            if (dark) fillRect(dst, outW, dx, dy, cell, cell, 0xf8, 0x00, 0xf8)
            else fillRect(dst, outW, dx, dy, cell, cell, 0x00, 0x00, 0x00)
            continue
          }
          blitNearest(dst, outW, tile, dx, dy, cell)
        }
      }

      if (cancelled) return
      ctx.putImageData(out, 0, 0)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [width, length, previewSurfacePalette, previewSurfaceIndices, previewDataUrl])

  return (
    <div
      ref={ref}
      className="map-image-wrap map-textured-wrap"
      style={
        {
          '--maps-x': mapsX,
          '--maps-y': mapsY,
          '--art-width': width,
          '--art-length': length,
          width: `${width * zoom}px`,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className="map-textured-canvas" />
      <div className="map-grid" />
    </div>
  )
})

export default MapArt2DViewer

function fillRect(
  dst: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
) {
  for (let y = 0; y < h; y += 1) {
    let o = ((y0 + y) * stride + x0) * 4
    for (let x = 0; x < w; x += 1) {
      dst[o] = r
      dst[o + 1] = g
      dst[o + 2] = b
      dst[o + 3] = 255
      o += 4
    }
  }
}

/** Stamp `src` (cell×cell ImageData) into `dst` at (dx,dy). */
function blitNearest(
  dst: Uint8ClampedArray,
  stride: number,
  src: ImageData,
  dx: number,
  dy: number,
  cell: number,
) {
  const s = src.data
  for (let y = 0; y < cell; y += 1) {
    let di = ((dy + y) * stride + dx) * 4
    let si = y * cell * 4
    for (let x = 0; x < cell; x += 1) {
      dst[di] = s[si]!
      dst[di + 1] = s[si + 1]!
      dst[di + 2] = s[si + 2]!
      dst[di + 3] = s[si + 3]!
      di += 4
      si += 4
    }
  }
}

/** Scale a face texture to `cell`×`cell` once (nearest neighbour). */
function sampleTexture(tile: BlockFaceImage, cell: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = cell
  canvas.height = cell
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const tw = 'naturalWidth' in tile ? tile.naturalWidth || tile.width : tile.width
  const th = 'naturalHeight' in tile ? tile.naturalHeight || tile.height : tile.height
  ctx.drawImage(tile, 0, 0, tw, th, 0, 0, cell, cell)
  return ctx.getImageData(0, 0, cell, cell)
}

function decodeIndices(b64: string): Uint8Array {
  if (!b64) return new Uint8Array()
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array()
  }
}
