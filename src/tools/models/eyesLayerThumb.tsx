/**
 * Library thumbs for mobs whose vanilla sheet has white/placeholder eyes and a
 * separate EyesLayer PNG (enderman purple, spider red).
 */
import { useEffect, useState } from 'react'
import { entityTextureCandidates, initMinecraftAssets } from '../../minecraftAssets'
import { catalogEyesOverlayPath } from './entityCatalogFixes'
import {
  expandTexturePaths,
  mobPreviewUrl,
  type MobCatalogEntry,
} from './minecraftCatalog'

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

/** Composite base sheet + EyesLayer into a data-URL for `<img>`. */
export async function renderEyesLayerThumb(
  basePaths: string[],
  eyesPath: string,
): Promise<string | null> {
  await initMinecraftAssets()
  const [base, eyes] = await Promise.all([
    loadFirstImage(textureUrls(basePaths)),
    loadFirstImage(textureUrls([eyesPath])),
  ])
  if (!base) return null
  const w = base.naturalWidth || base.width
  const h = base.naturalHeight || base.height
  if (w < 1 || h < 1) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(base, 0, 0)
  if (eyes) {
    const ew = eyes.naturalWidth || eyes.width
    const eh = eyes.naturalHeight || eyes.height
    if (ew === w && eh === h) ctx.drawImage(eyes, 0, 0)
  }
  return canvas.toDataURL('image/png')
}

/** Catalog grid / selection thumb with EyesLayer glow baked in. */
export function EyesLayerMobThumb({ mob }: { mob: MobCatalogEntry }) {
  const fallback = mobPreviewUrl(mob)
  const [src, setSrc] = useState(fallback)
  const eyesPath = catalogEyesOverlayPath(mob.id)

  useEffect(() => {
    setSrc(fallback)
    if (!eyesPath) return
    let cancelled = false
    void renderEyesLayerThumb(mob.texturePaths, eyesPath).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [mob.id, fallback, eyesPath, mob.texturePaths])

  return <img src={src} alt="" />
}
