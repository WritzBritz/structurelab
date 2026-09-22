import { loadPalette } from './api'
import { syncStoredMinecraftVersion } from './minecraftVersion'
import { resetTextureCacheForVersion } from './tools/models/blockTextures'
import { blockChoices } from './materials'
import {
  blockIconCandidates,
  initMinecraftAssets,
  minecraftAssetsDir,
} from './minecraftAssets'
import type { PaletteFile } from './types'

const FADE_MS = 480

export type BootProgress = (ratio: number, label: string) => void

/** One boot sequence per page load (survives React StrictMode remounts). */
let bootPromise: Promise<PaletteFile | null> | null = null
let bootFinished = false
let splashDismissed = false

export function resetBootCache(): void {
  bootPromise = null
  bootFinished = false
}

function setSplash(label: string, progress: number) {
  const clamped = Math.max(0, Math.min(1, progress))
  const pct = Math.round(clamped * 100)
  const labelEl = document.getElementById('boot-splash-label')
  const fillEl = document.getElementById('boot-splash-fill')
  const pctEl = document.getElementById('boot-splash-pct')
  const trackEl = fillEl?.parentElement
  if (labelEl) labelEl.textContent = label
  if (fillEl) fillEl.style.transform = `scaleX(${Math.max(0.02, clamped)})`
  if (pctEl) pctEl.textContent = `${pct}%`
  if (trackEl) trackEl.setAttribute('aria-valuenow', String(pct))
}

function report(onProgress: BootProgress | undefined, ratio: number, label: string) {
  setSplash(label, ratio)
  onProgress?.(ratio, label)
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

/** Give the browser a chance to paint splash updates (not a fake delay). */
async function paintSplash(): Promise<void> {
  await yieldFrame()
  await yieldFrame()
}

function collectIconUrls(palette: PaletteFile): string[] {
  const urls = new Set<string>()
  for (const color of palette.colors) {
    for (const state of [color.block, ...color.alternatives]) {
      const id = state.split('[')[0]!.replace('minecraft:', '')
      if (!id) continue
      for (const url of blockIconCandidates(id)) urls.add(url)
    }
  }
  return [...urls]
}

async function preloadBlockIcons(
  urls: string[],
  onProgress: BootProgress | undefined,
  rangeStart: number,
  rangeEnd: number,
): Promise<void> {
  if (urls.length === 0) return

  let done = 0
  const total = urls.length
  const concurrency = 16

  const loadOne = (url: string) =>
    new Promise<void>((resolve) => {
      const image = new Image()
      const finish = () => {
        done += 1
        if (done === total || done % 8 === 0) {
          const ratio = rangeStart + ((rangeEnd - rangeStart) * done) / total
          report(onProgress, ratio, `Loading block icons (${done}/${total})…`)
        }
        resolve()
      }
      image.onload = finish
      image.onerror = finish
      image.src = url
    })

  for (let i = 0; i < urls.length; i += concurrency) {
    await Promise.all(urls.slice(i, i + concurrency).map(loadOne))
    await yieldFrame()
  }
  report(onProgress, rangeEnd, `Loaded ${total} block icons…`)
}

/**
 * Real startup work: backend palette, material index, block icons.
 * Does not dismiss the splash — call {@link dismissBootSplash} after the UI has painted.
 */
export function runAppBoot(onProgress?: BootProgress): Promise<PaletteFile | null> {
  if (bootFinished && bootPromise) return bootPromise
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    report(onProgress, 0.04, 'Starting…')
    await paintSplash()

    report(onProgress, 0.1, 'Connecting to desktop backend…')
    await paintSplash()

    const versionId = await syncStoredMinecraftVersion()
    resetTextureCacheForVersion(versionId)

    await initMinecraftAssets()
    const assetsRoot = minecraftAssetsDir()
    if (assetsRoot) {
      report(onProgress, 0.14, 'Found external Minecraft assets folder…')
      await paintSplash()
    }

    let palette: PaletteFile
    try {
      palette = await loadPalette()
    } catch (error) {
      report(onProgress, 1, `Backend error: ${String(error)}`)
      bootFinished = true
      return null
    }

    report(
      onProgress,
      0.36,
      `Loaded Minecraft ${palette.minecraftVersion} palette (${palette.colors.length} map colours)…`,
    )
    await paintSplash()

    report(onProgress, 0.42, 'Indexing materials…')
    let choiceCount = 0
    for (let i = 0; i < palette.colors.length; i++) {
      choiceCount += blockChoices(palette.colors[i]!).length
      if (i % 12 === 0) await yieldFrame()
    }
    report(onProgress, 0.5, `Indexed ${choiceCount.toLocaleString()} block options…`)
    await paintSplash()

    const iconUrls = collectIconUrls(palette)
    report(onProgress, 0.54, `Loading ${iconUrls.length} block icons…`)
    await paintSplash()
    await preloadBlockIcons(iconUrls, onProgress, 0.54, 0.96)

    report(onProgress, 1, 'Ready')
    await paintSplash()
    bootFinished = true
    return palette
  })()

  return bootPromise
}

/** Fade the HTML splash out after boot work and the home UI have painted. */
export function dismissBootSplash(): Promise<void> {
  if (splashDismissed) return Promise.resolve()
  splashDismissed = true
  return new Promise((resolve) => {
    const splash = document.getElementById('boot-splash')
    splash?.classList.add('boot-splash-fade')
    splash?.setAttribute('aria-busy', 'false')
    window.setTimeout(() => {
      splash?.classList.add('boot-splash-gone')
      resolve()
    }, FADE_MS)
  })
}

let windowRevealed = false
let backdropReady = false
let resolveBackdropReady: (() => void) | null = null
const backdropReadyPromise = new Promise<void>((resolve) => {
  resolveBackdropReady = resolve
})

/** Signal that the Lightfall backdrop has drawn at least one frame. */
export function markBackdropReady(): void {
  if (backdropReady) return
  backdropReady = true
  resolveBackdropReady?.()
  resolveBackdropReady = null
}

/** Wait until the backdrop is ready, or until `timeoutMs` elapses. */
export function waitForBackdrop(timeoutMs = 2500): Promise<void> {
  if (backdropReady) return Promise.resolve()
  return Promise.race([
    backdropReadyPromise,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    }),
  ])
}

/**
 * Show the native window once (idempotent). Prefer calling this after the
 * Lightfall backdrop has drawn its first frame so the blue scene is already there.
 */
export async function revealAppWindow(): Promise<void> {
  if (windowRevealed) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const windowRef = getCurrentWindow()
    // Always show first — never leave the window stuck invisible.
    await windowRef.show()
    windowRevealed = true
    try {
      await windowRef.center()
    } catch {
      // Missing permission / unsupported — config `center: true` still applies on create.
    }
    try {
      await windowRef.setFocus()
    } catch {
      // Focus is nice-to-have.
    }
  } catch {
    // Browser / non-Tauri preview — nothing to show.
    windowRevealed = true
  }
}
