import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { loseCanvasWebGL } from '../tools/shared/webglRelease'
import {
  applyLightfallUniforms,
  createLightfallScene,
  disposeLightfallScene,
  resizeLightfallScene,
  type LightfallLiveProps,
  type LightfallScene,
  type LightfallWorkerIn,
  type LightfallWorkerOut,
} from './lightfallCore'
import './Lightfall.css'

export type LightfallProps = {
  className?: string
  dpr?: number
  paused?: boolean
  colors?: string[]
  backgroundColor?: string
  speed?: number
  streakCount?: number
  streakWidth?: number
  streakLength?: number
  glow?: number
  density?: number
  twinkle?: number
  zoom?: number
  backgroundGlow?: number
  opacity?: number
  mouseInteraction?: boolean
  mouseStrength?: number
  mouseRadius?: number
  mouseDampening?: number
  mixBlendMode?: string
  /** Print streaks into the background colour instead of adding light. */
  ink?: boolean
  /** Fires once after the first WebGL frame is drawn. */
  onReady?: () => void
}

function canUseOffscreenWorker(): boolean {
  return (
    typeof OffscreenCanvas === 'function'
    && typeof Worker === 'function'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
  )
}

function readSize(container: HTMLElement) {
  const rect = container.getBoundingClientRect()
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  }
}

export default function Lightfall({
  className,
  dpr,
  paused = false,
  colors = ['#A6C8FF', '#5227FF', '#FF9FFC'],
  backgroundColor = '#0A29FF',
  speed = 0.5,
  streakCount = 2,
  streakWidth = 1,
  streakLength = 1,
  glow = 1,
  density = 0.6,
  twinkle = 1,
  zoom = 3,
  backgroundGlow = 0.5,
  opacity = 1,
  mouseInteraction = true,
  mouseStrength = 0.5,
  mouseRadius = 1,
  mouseDampening = 0.15,
  mixBlendMode,
  ink = false,
  onReady,
}: LightfallProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const sceneRef = useRef<LightfallScene | null>(null)
  const rafRef = useRef(0)
  const mouseTargetRef = useRef<[number, number]>([0, 0])
  const lastTimeRef = useRef(0)
  const lastDrawRef = useRef(0)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const readyNotifiedRef = useRef(false)
  const [glEpoch, setGlEpoch] = useState(0)
  const [forceMain, setForceMain] = useState(false)
  const propsRef = useRef<LightfallLiveProps>({
    paused,
    colors,
    backgroundColor,
    speed,
    streakCount,
    streakWidth,
    streakLength,
    glow,
    density,
    twinkle,
    zoom,
    backgroundGlow,
    opacity,
    mouseInteraction,
    mouseStrength,
    mouseRadius,
    mouseDampening,
    ink,
  })

  propsRef.current = {
    paused,
    colors,
    backgroundColor,
    speed,
    streakCount,
    streakWidth,
    streakLength,
    glow,
    density,
    twinkle,
    zoom,
    backgroundGlow,
    opacity,
    mouseInteraction,
    mouseStrength,
    mouseRadius,
    mouseDampening,
    ink,
  }

  // Worker OffscreenCanvas keeps drawing when the UI thread is busy with boot
  // or large imports. Fall back to a main-thread loop if transfer isn't available.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.replaceChildren(canvas)

    const resolvedDpr = dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    const size = readSize(container)
    readyNotifiedRef.current = false
    let cancelled = false
    let usedWorker = false

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const scale = resolvedDpr
      const x = (event.clientX - rect.left) * scale
      const y = (rect.height - (event.clientY - rect.top)) * scale
      mouseTargetRef.current = [x, y]
      workerRef.current?.postMessage({ type: 'mouse', x, y } satisfies LightfallWorkerIn)
    }
    if (propsRef.current.mouseInteraction) {
      canvas.addEventListener('pointermove', onPointerMove)
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      if (cancelled || glEpoch >= 6) return
      setGlEpoch((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    const postResize = () => {
      const next = readSize(container)
      const worker = workerRef.current
      if (worker) {
        worker.postMessage({
          type: 'resize',
          width: next.width,
          height: next.height,
          dpr: resolvedDpr,
        } satisfies LightfallWorkerIn)
        return
      }
      const scene = sceneRef.current
      if (scene) resizeLightfallScene(scene, next.width, next.height)
    }
    const ro = new ResizeObserver(postResize)
    ro.observe(container)

    const useWorker = !forceMain && canUseOffscreenWorker()

    if (useWorker) {
      try {
        const offscreen = canvas.transferControlToOffscreen()
        const worker = new Worker(new URL('./lightfall.worker.ts', import.meta.url), {
          type: 'module',
        })
        usedWorker = true
        workerRef.current = worker
        worker.onmessage = (event: MessageEvent<LightfallWorkerOut>) => {
          if (cancelled) return
          const message = event.data
          if (message.type === 'ready' && !readyNotifiedRef.current) {
            readyNotifiedRef.current = true
            onReadyRef.current?.()
          }
          if (message.type === 'lost' && glEpoch < 6) {
            setGlEpoch((n) => n + 1)
          }
          if (message.type === 'error') {
            console.warn('[lightfall] worker failed, using main thread', message.message)
            setForceMain(true)
            setGlEpoch((n) => n + 1)
          }
        }
        worker.onerror = () => {
          if (cancelled) return
          setForceMain(true)
          setGlEpoch((n) => n + 1)
        }
        worker.postMessage(
          {
            type: 'init',
            canvas: offscreen,
            width: size.width,
            height: size.height,
            dpr: resolvedDpr,
            props: propsRef.current,
          } satisfies LightfallWorkerIn,
          [offscreen],
        )
      } catch (error) {
        console.warn('[lightfall] offscreen transfer failed', error)
        setForceMain(true)
        setGlEpoch((n) => n + 1)
      }
    } else {
      try {
        const scene = createLightfallScene(canvas, propsRef.current, resolvedDpr)
        sceneRef.current = scene
        resizeLightfallScene(scene, size.width, size.height)

        const draw = (t: number) => {
          if (cancelled) return
          if (t - lastDrawRef.current < 8) return
          lastDrawRef.current = t
          const live = propsRef.current
          scene.uniforms.iTime!.value = t * 0.001
          const damp = live.mouseDampening ?? 0.15
          if (damp > 0) {
            if (!lastTimeRef.current) lastTimeRef.current = t
            const dt = (t - lastTimeRef.current) / 1000
            lastTimeRef.current = t
            const tau = Math.max(1e-4, damp)
            let factor = 1 - Math.exp(-dt / tau)
            if (factor > 1) factor = 1
            const target = mouseTargetRef.current
            const cur = scene.uniforms.iMouse!.value as [number, number]
            cur[0] += (target[0] - cur[0]) * factor
            cur[1] += (target[1] - cur[1]) * factor
          } else {
            lastTimeRef.current = t
          }
          if (live.paused) return
          try {
            scene.renderer.render({ scene: scene.mesh })
            if (!readyNotifiedRef.current) {
              readyNotifiedRef.current = true
              onReadyRef.current?.()
            }
          } catch (error) {
            console.error(error)
          }
        }
        const onRaf = (t: number) => {
          rafRef.current = requestAnimationFrame(onRaf)
          draw(t)
        }
        rafRef.current = requestAnimationFrame(onRaf)
      } catch (error) {
        console.error(error)
      }
    }

    return () => {
      cancelled = true
      readyNotifiedRef.current = false
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      const worker = workerRef.current
      workerRef.current = null
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.postMessage({ type: 'dispose' } satisfies LightfallWorkerIn)
        worker.terminate()
      }
      const scene = sceneRef.current
      sceneRef.current = null
      if (scene) disposeLightfallScene(scene)
      else if (!usedWorker) loseCanvasWebGL(canvas)
      canvas.remove()
    }
  }, [glEpoch, forceMain, dpr])

  useLayoutEffect(() => {
    const worker = workerRef.current
    if (worker) {
      worker.postMessage({ type: 'props', props: propsRef.current } satisfies LightfallWorkerIn)
      return
    }
    const scene = sceneRef.current
    if (!scene) return
    applyLightfallUniforms(scene.uniforms, propsRef.current)
  }, [
    colors,
    backgroundColor,
    speed,
    streakCount,
    streakWidth,
    streakLength,
    glow,
    density,
    twinkle,
    zoom,
    backgroundGlow,
    opacity,
    mouseInteraction,
    mouseStrength,
    mouseRadius,
    ink,
    paused,
  ])

  return (
    <div
      ref={containerRef}
      className={`lightfall-container ${className ?? ''}`}
      style={{
        mixBlendMode: (mixBlendMode ?? 'normal') as CSSProperties['mixBlendMode'],
      }}
    />
  )
}
