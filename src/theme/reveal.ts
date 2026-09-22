import { flushSync } from 'react-dom'

export type RevealOrigin = { x: number; y: number }

const DURATION_MS = 820
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition: () => void
}

let inFlight: ViewTransitionLike | null = null
let generation = 0

export function originFromElement(el: Element | null | undefined): RevealOrigin | undefined {
  if (!el) return undefined
  const box = el.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return undefined
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

function canReveal(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof document.startViewTransition !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function endRadius(x: number, y: number) {
  const { innerWidth: w, innerHeight: h } = window
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y))
}

function cleanupRevealArtifacts() {
  const root = document.documentElement
  root.style.removeProperty('clip-path')
  root.style.removeProperty('-webkit-clip-path')
  try {
    for (const animation of root.getAnimations()) {
      const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ''
      if (pseudo.includes('view-transition')) animation.cancel()
    }
  } catch {
    /* getAnimations / KeyframeEffect not available */
  }
}

export function abortThemeReveal() {
  generation += 1
  if (inFlight) {
    try {
      inFlight.skipTransition()
    } catch {
      /* already finished */
    }
    inFlight = null
  }
  cleanupRevealArtifacts()
}

/** Snap to the new theme, then let it bleed out from the theme control. */
export function runThemeReveal(update: () => void, origin?: RevealOrigin): Promise<void> {
  const token = ++generation
  if (inFlight) {
    try {
      inFlight.skipTransition()
    } catch {
      /* already finished */
    }
    inFlight = null
  }
  cleanupRevealArtifacts()

  if (!canReveal()) {
    update()
    return Promise.resolve()
  }

  const x = origin?.x ?? window.innerWidth - 28
  const y = origin?.y ?? 28
  const radius = Math.max(24, endRadius(x, y))

  let transition: ViewTransitionLike
  try {
    transition = document.startViewTransition(() => {
      flushSync(update)
    }) as ViewTransitionLike
  } catch {
    update()
    return Promise.resolve()
  }

  inFlight = transition

  void transition.ready
    .then(() => {
      if (token !== generation) return
      const animation = document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: DURATION_MS,
          easing: EASING,
          fill: 'none',
          pseudoElement: '::view-transition-new(root)',
        },
      )
      void animation.finished.catch(() => undefined).then(cleanupRevealArtifacts)
    })
    .catch(() => {
      cleanupRevealArtifacts()
    })

  return transition.finished
    .catch(() => undefined)
    .then(() => {
      if (inFlight === transition) inFlight = null
      cleanupRevealArtifacts()
    })
}

export function isThemeRevealRunning() {
  return inFlight != null
}
