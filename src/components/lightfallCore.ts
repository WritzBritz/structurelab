import { Mesh, Program, Renderer, Triangle } from 'ogl'

const MAX_COLORS = 8

export const hexToRGB = (hex: string): [number, number, number] => {
  const c = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  return [r, g, b]
}

export const prepColors = (input: string[] | undefined) => {
  const base = (input && input.length ? input : ['#A6C8FF', '#5227FF', '#FF9FFC']).slice(0, MAX_COLORS)
  const count = base.length
  const arr: [number, number, number][] = []
  for (let i = 0; i < MAX_COLORS; i++) arr.push(hexToRGB(base[Math.min(i, base.length - 1)]!))
  const avg: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    avg[0] += arr[i]![0]
    avg[1] += arr[i]![1]
    avg[2] += arr[i]![2]
  }
  avg[0] /= count
  avg[1] /= count
  avg[2] /= count
  return { arr, count, avg }
}

export const lightfallVertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export const lightfallFragment = `
precision highp float;

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

uniform vec3  uBgColor;
uniform vec3  uMouseColor;
uniform float uSpeed;
uniform int   uStreakCount;
uniform float uStreakWidth;
uniform float uStreakLength;
uniform float uGlow;
uniform float uDensity;
uniform float uTwinkle;
uniform float uZoom;
uniform float uBgGlow;
uniform float uOpacity;
uniform float uInk;
uniform float uMouseEnabled;
uniform float uMouseStrength;
uniform float uMouseRadius;

varying vec2 vUv;

vec3 palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

vec3 tanhv(vec3 x) {
  vec3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

vec2 sceneC(vec2 frag, vec2 r) {
  vec2 P = (frag + frag - r) / r.x;
  float z = 0.0;
  float d = 1e3;
  vec4 O = vec4(0.0);
  for (int k = 0; k < 39; k++) {
    if (d <= 1e-4) break;
    O = z * normalize(vec4(P, uZoom, 0.0)) - vec4(0.0, 4.0, 1.0, 0.0) / 4.5;
    d = 1.0 - sqrt(length(O * O));
    z += d;
  }
  return vec2(O.x, atan(O.z, O.y));
}

void mainImage(out vec4 o, vec2 C) {
  vec2 r = iResolution.xy;
  vec2 uv0 = (C + C - r) / r.x;
  float T = 0.1 * iTime * uSpeed + 9.0;
  float angRings = max(1.0, floor(6.28318530718 * max(uDensity, 0.05) + 0.5));
  vec2 Y = vec2(5e-3, 6.28318530718 / angRings);

  vec2 c0 = sceneC(C, r);
  vec2 cdx = sceneC(C + vec2(1.0, 0.0), r);
  vec2 cdy = sceneC(C + vec2(0.0, 1.0), r);
  vec2 dCx = cdx - c0;
  vec2 dCy = cdy - c0;
  dCx.y -= 6.28318530718 * floor(dCx.y / 6.28318530718 + 0.5);
  dCy.y -= 6.28318530718 * floor(dCy.y / 6.28318530718 + 0.5);
  vec2 fw = abs(dCx) + abs(dCy);
  C = c0;

  vec2 P = vec2(2.0, 1.0) * uv0 - (r / r.x) * vec2(0.0, 1.0);
  vec4 O = vec4(uBgColor * 90.0 * uBgGlow / (1e3 * dot(P, P) + 6.0), 0.0);

  float mGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mN = (iMouse + iMouse - r) / r.x;
    float md = length(uv0 - mN);
    mGlow = exp(-md * md / max(uMouseRadius * uMouseRadius, 1e-4)) * uMouseStrength;
    O.rgb += uMouseColor * mGlow * 0.25;
  }

  float zr = 5e-4 * uStreakWidth;
  vec2 rr = vec2(max(length(fw), 1e-5));
  float tail = 19.0 / max(uStreakLength, 0.05);

  for (int m = 0; m < 16; m++) {
    if (m >= uStreakCount) break;
    float jf = float(m) + 1.0;
    float ic = fract(sin(dot(vec2(jf, floor(C.x / Y.x + 0.5)), vec2(7.0, 11.0)) * 73.0));
    vec2 Pp = C - (T + T * ic) * vec2(0.0, 1.0);
    Pp -= floor(Pp / Y + 0.5) * Y;
    float h = fract(8663.0 * ic);
    vec3 col = palette(h);
    float weight = mix(1.5, 1.0 + sin(T + 7.0 * h + 4.0), uTwinkle);
    weight *= (1.0 + mGlow * 2.0);
    vec2 inner = vec2(length(max(Pp, vec2(-1.0, 0.0))), length(Pp) - zr) - zr;
    vec2 sm = vec2(1.0) - smoothstep(-rr, rr, inner);
    O.rgb += dot(sm, vec2(exp(tail * Pp.y), 3.0)) * col * weight;
    C.x += Y.x / 8.0;
  }

  vec3 colr = sqrt(tanhv(max(O.rgb * uGlow - vec3(0.04, 0.08, 0.02), 0.0)));
  vec3 printed = uBgColor * (1.0 - colr * 0.9);
  o = vec4(mix(colr, printed, uInk), uOpacity);
}

void main() {
  vec4 color;
  mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`

export type LightfallLiveProps = {
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
  ink?: boolean
}

export type LightfallUniformMap = Record<string, { value: unknown }>

export function applyLightfallUniforms(
  uniforms: LightfallUniformMap,
  props: LightfallLiveProps,
) {
  const { arr, count, avg } = prepColors(props.colors)
  uniforms.uColor0!.value = arr[0]!
  uniforms.uColor1!.value = arr[1]!
  uniforms.uColor2!.value = arr[2]!
  uniforms.uColor3!.value = arr[3]!
  uniforms.uColor4!.value = arr[4]!
  uniforms.uColor5!.value = arr[5]!
  uniforms.uColor6!.value = arr[6]!
  uniforms.uColor7!.value = arr[7]!
  uniforms.uColorCount!.value = count
  uniforms.uBgColor!.value = hexToRGB(props.backgroundColor ?? '#0A29FF')
  uniforms.uMouseColor!.value = avg
  uniforms.uSpeed!.value = props.speed ?? 0.5
  uniforms.uStreakCount!.value = Math.max(1, Math.min(16, Math.round(props.streakCount ?? 2)))
  uniforms.uStreakWidth!.value = props.streakWidth ?? 1
  uniforms.uStreakLength!.value = props.streakLength ?? 1
  uniforms.uGlow!.value = props.glow ?? 1
  uniforms.uDensity!.value = props.density ?? 0.6
  uniforms.uTwinkle!.value = props.twinkle ?? 1
  uniforms.uZoom!.value = props.zoom ?? 3
  uniforms.uBgGlow!.value = props.backgroundGlow ?? 0.5
  uniforms.uOpacity!.value = props.opacity ?? 1
  uniforms.uInk!.value = props.ink ? 1 : 0
  uniforms.uMouseEnabled!.value = props.mouseInteraction ? 1 : 0
  uniforms.uMouseStrength!.value = props.mouseStrength ?? 0.5
  uniforms.uMouseRadius!.value = props.mouseRadius ?? 1
}

export type LightfallScene = {
  renderer: Renderer
  gl: WebGLRenderingContext | WebGL2RenderingContext
  uniforms: LightfallUniformMap
  mesh: Mesh
  program: Program
  geometry: Triangle
}

export function createLightfallScene(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  props: LightfallLiveProps,
  dpr: number,
): LightfallScene {
  const bg = hexToRGB(props.backgroundColor ?? '#04081A')
  const renderer = new Renderer({
    canvas: canvas as HTMLCanvasElement,
    dpr,
    alpha: false,
    antialias: false,
    powerPreference: 'low-power',
    width: 4,
    height: 4,
  })
  const gl = renderer.gl
  if (!gl) {
    throw new Error('unable to create webgl context')
  }
  gl.clearColor(bg[0], bg[1], bg[2], 1)

  const { arr, count, avg } = prepColors(props.colors)
  const uniforms: LightfallUniformMap = {
    iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] as [number, number, number] },
    iMouse: { value: [0, 0] as [number, number] },
    iTime: { value: 0 },
    uColor0: { value: arr[0]! },
    uColor1: { value: arr[1]! },
    uColor2: { value: arr[2]! },
    uColor3: { value: arr[3]! },
    uColor4: { value: arr[4]! },
    uColor5: { value: arr[5]! },
    uColor6: { value: arr[6]! },
    uColor7: { value: arr[7]! },
    uColorCount: { value: count },
    uBgColor: { value: hexToRGB(props.backgroundColor ?? '#0A29FF') },
    uMouseColor: { value: avg },
    uSpeed: { value: props.speed ?? 0.5 },
    uStreakCount: { value: Math.max(1, Math.min(16, Math.round(props.streakCount ?? 2))) },
    uStreakWidth: { value: props.streakWidth ?? 1 },
    uStreakLength: { value: props.streakLength ?? 1 },
    uGlow: { value: props.glow ?? 1 },
    uDensity: { value: props.density ?? 0.6 },
    uTwinkle: { value: props.twinkle ?? 1 },
    uZoom: { value: props.zoom ?? 3 },
    uBgGlow: { value: props.backgroundGlow ?? 0.5 },
    uOpacity: { value: props.opacity ?? 1 },
    uInk: { value: props.ink ? 1 : 0 },
    uMouseEnabled: { value: props.mouseInteraction ? 1 : 0 },
    uMouseStrength: { value: props.mouseStrength ?? 0.5 },
    uMouseRadius: { value: props.mouseRadius ?? 1 },
  }

  const program = new Program(gl, { vertex: lightfallVertex, fragment: lightfallFragment, uniforms })
  const geometry = new Triangle(gl)
  const mesh = new Mesh(gl, { geometry, program })
  return { renderer, gl, uniforms, mesh, program, geometry }
}

export function resizeLightfallScene(
  scene: LightfallScene,
  width: number,
  height: number,
) {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  scene.renderer.setSize(w, h)
  scene.uniforms.iResolution!.value = [
    scene.gl.drawingBufferWidth,
    scene.gl.drawingBufferHeight,
    1,
  ]
}

export function disposeLightfallScene(scene: LightfallScene) {
  const callIfFn = (obj: object | null | undefined, key: string) => {
    if (obj && typeof (obj as Record<string, unknown>)[key] === 'function') {
      ;(obj as Record<string, () => void>)[key]!.call(obj)
    }
  }
  callIfFn(scene.program, 'remove')
  callIfFn(scene.geometry, 'remove')
  callIfFn(scene.mesh, 'remove')
  callIfFn(scene.renderer, 'destroy')
  const canvas = scene.gl.canvas
  const gl = scene.gl
  if ('getExtension' in gl) {
    const ext = gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null
    ext?.loseContext()
  }
  if ('remove' in canvas && typeof canvas.remove === 'function') {
    canvas.remove()
  }
}

export type LightfallWorkerIn =
  | {
      type: 'init'
      canvas: OffscreenCanvas
      width: number
      height: number
      dpr: number
      props: LightfallLiveProps
    }
  | { type: 'resize'; width: number; height: number; dpr?: number }
  | { type: 'props'; props: LightfallLiveProps }
  | { type: 'mouse'; x: number; y: number }
  | { type: 'dispose' }

export type LightfallWorkerOut =
  | { type: 'ready' }
  | { type: 'lost' }
  | { type: 'error'; message: string }
