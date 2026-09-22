import { initMinecraftAssets } from '../../minecraftAssets'
import { blockTextureCandidates } from './blockTextures'

async function loadFirstImage(urls: string[]): Promise<HTMLImageElement | null> {
  for (const url of urls) {
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(url))
        img.src = url
      })
      if ((image.naturalWidth || image.width) > 0) return image
    } catch {
      /* try next */
    }
  }
  return null
}

type CanvasRect = { left: number; top: number; w: number; h: number }

function drawBlockFace(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: CanvasRect,
) {
  if (rect.w < 0.5 || rect.h < 0.5) return
  ctx.drawImage(image, 0, 0, 16, 16, rect.left, rect.top, rect.w, rect.h)
}

function drawPumpkinCube(
  ctx: CanvasRenderingContext2D,
  rect: CanvasRect,
  face: HTMLImageElement,
  side: HTMLImageElement | null,
  top: HTMLImageElement | null,
) {
  const sideW = side ? Math.max(1, Math.round(rect.w * 0.14)) : 0
  const topH = top ? Math.max(1, Math.round(rect.h * 0.14)) : 0
  const inner: CanvasRect = {
    left: rect.left + sideW,
    top: rect.top + topH,
    w: Math.max(1, rect.w - sideW * 2),
    h: Math.max(1, rect.h - topH),
  }
  if (top && topH > 0) {
    drawBlockFace(ctx, top, {
      left: inner.left,
      top: rect.top,
      w: inner.w,
      h: topH,
    })
  }
  if (side && sideW > 0) {
    drawBlockFace(ctx, side, {
      left: rect.left,
      top: inner.top,
      w: sideW,
      h: inner.h,
    })
    drawBlockFace(ctx, side, {
      left: rect.left + rect.w - sideW,
      top: inner.top,
      w: sideW,
      h: inner.h,
    })
  }
  drawBlockFace(ctx, face, inner)
}

/** Carved pumpkin only — matches other catalog thumbs (head, not full body). */
export async function renderSnowGolemPumpkinThumb(size = 48): Promise<string | null> {
  await initMinecraftAssets()
  const [pumpkinFace, pumpkinSide, pumpkinTop] = await Promise.all([
    loadFirstImage(blockTextureCandidates('carved_pumpkin')),
    loadFirstImage(blockTextureCandidates('pumpkin_side')),
    loadFirstImage(blockTextureCandidates('pumpkin_top')),
  ])
  if (!pumpkinFace) return null

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, size, size)

  const pad = 1
  const pumpkin = { left: pad, top: pad, w: size - pad * 2, h: size - pad * 2 }
  drawPumpkinCube(ctx, pumpkin, pumpkinFace, pumpkinSide, pumpkinTop)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : null)
    }, 'image/png')
  })
}
