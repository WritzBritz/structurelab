import type * as THREE from 'three'

/**
 * Tear down a WebGLRenderer so WebView2 actually drops the GPU context.
 * `dispose()` alone often leaves the context alive; the next preview then
 * steals Lightfall's context, and a lost canvas paints opaque white.
 */
export function releaseWebGLRenderer(renderer: THREE.WebGLRenderer | null | undefined) {
  if (!renderer) return
  try {
    renderer.dispose()
  } catch {
    /* already gone */
  }
  try {
    renderer.forceContextLoss()
  } catch {
    /* WEBGL_lose_context missing */
  }
  renderer.domElement.remove()
}

export function loseCanvasWebGL(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return
  const gl =
    canvas.getContext('webgl2')
    ?? canvas.getContext('webgl')
  if (!gl || !('getExtension' in gl)) return
  const ext = gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null
  ext?.loseContext()
}
