/// <reference lib="webworker" />

/**
 * Lightfall runs here so boot / file / convert work on the UI thread cannot
 * starve requestAnimationFrame and freeze the backdrop.
 */

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

let scene: LightfallScene | null = null
let live: LightfallLiveProps = {}
let mouseTarget: [number, number] = [0, 0]
let lastMouseTime = 0
let lastDraw = 0
let rafId = 0
let watchdogId = 0
let readySent = false
let running = false

const requestFrame: (cb: (time: number) => void) => number =
  typeof ctx.requestAnimationFrame === 'function'
    ? (cb) => ctx.requestAnimationFrame(cb)
    : (cb) => ctx.setTimeout(() => cb(performance.now()), 16) as unknown as number

const cancelFrame = (id: number) => {
  if (typeof ctx.cancelAnimationFrame === 'function') ctx.cancelAnimationFrame(id)
  else ctx.clearTimeout(id)
}

function post(message: LightfallWorkerOut) {
  ctx.postMessage(message)
}

function draw(t: number) {
  if (!scene || !running) return
  if (t - lastDraw < 8) return
  lastDraw = t
  if (live.paused) return

  scene.uniforms.iTime!.value = t * 0.001
  const damp = live.mouseDampening ?? 0.15
  if (damp > 0 && live.mouseInteraction) {
    if (!lastMouseTime) lastMouseTime = t
    const dt = (t - lastMouseTime) / 1000
    lastMouseTime = t
    const tau = Math.max(1e-4, damp)
    let factor = 1 - Math.exp(-dt / tau)
    if (factor > 1) factor = 1
    const cur = scene.uniforms.iMouse!.value as [number, number]
    cur[0] += (mouseTarget[0] - cur[0]) * factor
    cur[1] += (mouseTarget[1] - cur[1]) * factor
  } else {
    lastMouseTime = t
  }

  try {
    scene.renderer.render({ scene: scene.mesh })
    if (!readySent) {
      readySent = true
      post({ type: 'ready' })
    }
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function onRaf(t: number) {
  rafId = requestFrame(onRaf)
  draw(t)
}

function startLoop() {
  if (running) return
  running = true
  lastDraw = 0
  rafId = requestFrame(onRaf)
  // Worker rAF can stall when the UI thread is blocked; this interval does not.
  watchdogId = ctx.setInterval(() => {
    const now = performance.now()
    if (now - lastDraw > 40) draw(now)
  }, 20)
}

function stopLoop() {
  running = false
  if (rafId) cancelFrame(rafId)
  if (watchdogId) ctx.clearInterval(watchdogId)
  rafId = 0
  watchdogId = 0
}

function teardown() {
  stopLoop()
  if (scene) {
    disposeLightfallScene(scene)
    scene = null
  }
}

ctx.onmessage = (event: MessageEvent<LightfallWorkerIn>) => {
  const message = event.data
  if (message.type === 'init') {
    teardown()
    live = message.props
    try {
      scene = createLightfallScene(message.canvas, live, message.dpr)
      resizeLightfallScene(scene, message.width, message.height)
      const canvas = scene.gl.canvas as unknown as {
        addEventListener: (type: string, listener: (event: Event) => void) => void
      }
      canvas.addEventListener('webglcontextlost', (lost) => {
        lost.preventDefault()
        stopLoop()
        post({ type: 'lost' })
      })
      startLoop()
    } catch (error) {
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  if (message.type === 'resize') {
    if (!scene) return
    if (message.dpr && message.dpr !== scene.renderer.dpr) {
      scene.renderer.dpr = message.dpr
    }
    resizeLightfallScene(scene, message.width, message.height)
    return
  }

  if (message.type === 'props') {
    live = message.props
    if (scene) applyLightfallUniforms(scene.uniforms, live)
    return
  }

  if (message.type === 'mouse') {
    mouseTarget = [message.x, message.y]
    const damp = live.mouseDampening ?? 0.15
    if (scene && damp <= 0) {
      scene.uniforms.iMouse!.value = [message.x, message.y]
    }
    return
  }

  if (message.type === 'dispose') {
    teardown()
  }
}
