import { useEffect, useState } from 'react'
import { initMinecraftAssets } from '../minecraftAssets'
import { renderSnowGolemPumpkinThumb } from '../tools/models/snowGolemPumpkinThumb'

/** Composed carved-pumpkin head (matches other catalog head thumbs). */
export function SnowGolemPumpkinMobThumb() {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void (async () => {
      await initMinecraftAssets()
      const url = await renderSnowGolemPumpkinThumb(48)
      if (cancelled) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      objectUrl = url
      setSrc(url)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  if (!src) {
    return <span className="mc-library-composed-thumb fallback" aria-hidden>…</span>
  }

  return <img src={src} alt="" className="mc-library-composed-thumb" loading="lazy" />
}
