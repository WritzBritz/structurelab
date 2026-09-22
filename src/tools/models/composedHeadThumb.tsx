/**
 * Catalog thumbs for heads made of more than one cube (pig snout, villager
 * nose, wolf ears). CSS-cropping a single north face drops those extras.
 */
import { useEffect, useState } from 'react'
import { entityTextureCandidates, initMinecraftAssets } from '../../minecraftAssets'
import { decodePngRgba, type PngRgba } from './decodePngRgba'
import { catalogEyesOverlayPath } from './entityCatalogFixes'
import {
  expandTexturePaths,
  loadMobTextureBytes,
  mobPreviewUrl,
  type MobCatalogEntry,
} from './minecraftCatalog'
import { headThumbSpec } from './mobHeadPreview'
import { humanoidModelFor } from './vanillaHumanoids'

function jarEntityRel(relativePath: string): string | null {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/minecraft\//, '')
  if (!clean.startsWith('textures/entity/')) return null
  return clean.slice('textures/entity/'.length)
}

function textureUrls(paths: string[]): string[] {
  const urls: string[] = []
  for (const path of expandTexturePaths(paths)) {
    const rel = jarEntityRel(path)
    if (!rel) continue
    for (const url of entityTextureCandidates(rel)) {
      if (!urls.includes(url)) urls.push(url)
    }
  }
  return urls
}

async function fetchPng(url: string): Promise<PngRgba | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return decodePngRgba(new Uint8Array(await response.arrayBuffer()))
  } catch {
    return null
  }
}

/** Match entityCubesToObj: 2×-tall sheets keep texel coords; otherwise model size. */
function atlasSize(
  modelW: number,
  modelH: number,
  pngW: number,
  pngH: number,
): [number, number] {
  if (pngW === modelW && pngH === modelH * 2) return [pngW, pngH]
  return [modelW, modelH]
}

function stampEyes(base: PngRgba, eyes: PngRgba) {
  if (eyes.width !== base.width || eyes.height !== base.height) return
  const { data } = base
  for (let i = 0; i < data.length; i += 4) {
    const a = eyes.data[i + 3] ?? 0
    if (a < 16) continue
    data[i] = eyes.data[i] ?? 0
    data[i + 1] = eyes.data[i + 1] ?? 0
    data[i + 2] = eyes.data[i + 2] ?? 0
    data[i + 3] = 255
  }
}

async function loadHeadSheet(mob: MobCatalogEntry, sheetW: number, sheetH: number): Promise<PngRgba | null> {
  await initMinecraftAssets()
  const model = humanoidModelFor(mob.id)
  if (model) {
    const bytes = await loadMobTextureBytes(mob, model)
    if (bytes) {
      const decoded = await decodePngRgba(bytes)
      if (decoded && decoded.width > 0) return decoded
    }
  }
  let fallback: PngRgba | null = null
  for (const url of textureUrls(mob.texturePaths)) {
    const decoded = await fetchPng(url)
    if (!decoded || decoded.width < 1 || decoded.height < 1) continue
    const exact = decoded.width === sheetW && decoded.height === sheetH
    const doubled =
      decoded.width === sheetW * 2
      && (decoded.height === sheetH * 2 || decoded.height === sheetH)
    if (exact || doubled) {
      fallback = decoded
      break
    }
    fallback ??= decoded
  }
  if (!fallback) return null
  const eyesPath = catalogEyesOverlayPath(mob.id)
  if (eyesPath) {
    for (const url of textureUrls([eyesPath])) {
      const eyes = await fetchPng(url)
      if (eyes) {
        stampEyes(fallback, eyes)
        break
      }
    }
  }
  return fallback
}

function blitNearest(
  src: PngRgba,
  dest: ImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): number {
  let painted = 0
  const srcW = Math.max(1, Math.min(sw, src.width - sx))
  const srcH = Math.max(1, Math.min(sh, src.height - sy))
  if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) return 0
  for (let y = 0; y < dh; y++) {
    const oy = dy + y
    if (oy < 0 || oy >= dest.height) continue
    const srcY = sy + Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dh))
    for (let x = 0; x < dw; x++) {
      const ox = dx + x
      if (ox < 0 || ox >= dest.width) continue
      const srcX = sx + Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dw))
      const si = (srcY * src.width + srcX) * 4
      const a = src.data[si + 3] ?? 0
      if (a < 16) continue
      const di = (oy * dest.width + ox) * 4
      dest.data[di] = src.data[si] ?? 0
      dest.data[di + 1] = src.data[si + 1] ?? 0
      dest.data[di + 2] = src.data[si + 2] ?? 0
      dest.data[di + 3] = 255
      painted++
    }
  }
  return painted
}

const composeCache = new Map<string, Promise<string | null>>()

/** Front-view composite of the head bone and its snout / nose / ears. */
export async function renderComposedHeadThumb(
  mob: MobCatalogEntry,
  size = 48,
): Promise<string | null> {
  const key = `${mob.id}\0${mob.texturePaths[0] ?? ''}\0${size}`
  const cached = composeCache.get(key)
  if (cached) return cached
  const pending = renderComposedHeadThumbUncached(mob, size)
  composeCache.set(key, pending)
  const url = await pending
  if (!url) composeCache.delete(key)
  return url
}

async function renderComposedHeadThumbUncached(
  mob: MobCatalogEntry,
  size: number,
): Promise<string | null> {
  const spec = headThumbSpec(mob.id)
  const sheet = await loadHeadSheet(mob, spec.sheetW, spec.sheetH)
  if (!sheet) return null

  const [texW, texH] = atlasSize(spec.sheetW, spec.sheetH, sheet.width, sheet.height)
  const uScale = sheet.width / Math.max(texW, 1)
  const vScale = sheet.height / Math.max(texH, 1)

  const span = Math.max(spec.maxX - spec.minX, spec.maxY - spec.minY, 1)
  const pad = 1
  const scale = (size - pad * 2) / span
  const extraX = (span - (spec.maxX - spec.minX)) / 2
  const extraY = (span - (spec.maxY - spec.minY)) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dest = ctx.createImageData(size, size)

  const destRect = (part: { x: number; y: number; w: number; h: number }) => ({
    dx: Math.round(pad + (part.x - spec.minX + extraX) * scale),
    dy: Math.round(pad + (spec.maxY - part.y - part.h + extraY) * scale),
    dw: Math.max(1, Math.round(part.w * scale)),
    dh: Math.max(1, Math.round(part.h * scale)),
  })

  const blitFace = (
    face: { x: number; y: number; w: number; h: number },
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => {
    const sx = Math.max(0, Math.floor(face.x * uScale))
    const sy = Math.max(0, Math.floor(face.y * vScale))
    const sw = Math.max(1, Math.round(face.w * uScale))
    const sh = Math.max(1, Math.round(face.h * vScale))
    return blitNearest(sheet, dest, sx, sy, sw, sh, dx, dy, dw, dh)
  }

  const primary = spec.parts.reduce((best, part) =>
    part.w * part.h >= best.w * best.h ? part : best,
  )
  let painted = 0
  for (const part of spec.parts) {
    if (part !== primary) continue
    const { dx, dy, dw, dh } = destRect(part)
    painted += blitFace(part.face, dx, dy, dw, dh)
  }
  if (primary) {
    const { dx, dy, dw, dh } = destRect(primary)
    for (const overlay of spec.overlays) {
      painted += blitFace(overlay, dx, dy, dw, dh)
    }
  }
  for (const part of spec.parts) {
    if (part === primary) continue
    const { dx, dy, dw, dh } = destRect(part)
    painted += blitFace(part.face, dx, dy, dw, dh)
  }

  if (painted < 8) return null
  ctx.putImageData(dest, 0, 0)
  return canvas.toDataURL('image/png')
}

const PLAYER_INNER = { x: 8, y: 8, w: 8, h: 8 }
const PLAYER_HAT = { x: 40, y: 8, w: 8, h: 8 }
const playerHeadCache = new Map<string, Promise<string | null>>()

async function renderPlayerHeadThumbUncached(src: string, size: number): Promise<string | null> {
  if (!src) return null
  const sheet = await fetchPng(src)
  if (!sheet) return null
  const atlas = sheet.width >= 64 && sheet.height >= 32 ? sheet.width / 64 : 1
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dest = ctx.createImageData(size, size)
  const pad = 1
  const dw = size - pad * 2
  const dh = size - pad * 2
  let painted = 0
  painted += blitNearest(
    sheet,
    dest,
    Math.floor(PLAYER_INNER.x * atlas),
    Math.floor(PLAYER_INNER.y * atlas),
    Math.max(1, Math.round(PLAYER_INNER.w * atlas)),
    Math.max(1, Math.round(PLAYER_INNER.h * atlas)),
    pad,
    pad,
    dw,
    dh,
  )
  if (sheet.height >= 64) {
    painted += blitNearest(
      sheet,
      dest,
      Math.floor(PLAYER_HAT.x * atlas),
      Math.floor(PLAYER_HAT.y * atlas),
      Math.max(1, Math.round(PLAYER_HAT.w * atlas)),
      Math.max(1, Math.round(PLAYER_HAT.h * atlas)),
      pad,
      pad,
      dw,
      dh,
    )
  }
  if (painted < 8) return null
  ctx.putImageData(dest, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function renderPlayerHeadThumb(src: string, size = 48): Promise<string | null> {
  const key = `${src}\0${size}`
  const cached = playerHeadCache.get(key)
  if (cached) return cached
  const pending = renderPlayerHeadThumbUncached(src, size)
  playerHeadCache.set(key, pending)
  const url = await pending
  if (!url) playerHeadCache.delete(key)
  return url
}

export function PlayerHeadThumb({ src }: { src: string }) {
  const [out, setOut] = useState(src)
  const [composed, setComposed] = useState(false)

  useEffect(() => {
    setOut(src)
    setComposed(false)
    if (!src) return
    let cancelled = false
    void renderPlayerHeadThumb(src).then((url) => {
      if (!cancelled && url) {
        setOut(url)
        setComposed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [src])

  return (
    <img
      src={out}
      alt=""
      className={composed ? 'mc-library-composed-thumb' : undefined}
      loading="lazy"
    />
  )
}

export function ComposedHeadThumb({ mob }: { mob: MobCatalogEntry }) {
  const fallback = mobPreviewUrl(mob)
  const [src, setSrc] = useState(fallback)
  const [composed, setComposed] = useState(false)

  useEffect(() => {
    setSrc(fallback)
    setComposed(false)
    let cancelled = false
    void renderComposedHeadThumb(mob).then((url) => {
      if (!cancelled && url) {
        setSrc(url)
        setComposed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [mob.id, fallback, mob.texturePaths])

  return (
    <img
      src={src}
      alt=""
      className={composed ? 'mc-library-composed-thumb' : undefined}
      loading="lazy"
    />
  )
}
