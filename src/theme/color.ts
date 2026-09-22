export type Rgb = { r: number; g: number; b: number }
export type Hsv = { h: number; s: number; v: number }

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  const short = /^#?([0-9a-f]{3})$/i.exec(raw)
  if (short) {
    const [r, g, b] = short[1]
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(raw)
  if (!full) return null
  return `#${full[1].toUpperCase()}`
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rn = 0
  let gn = 0
  let bn = 0
  if (h < 60) [rn, gn, bn] = [c, x, 0]
  else if (h < 120) [rn, gn, bn] = [x, c, 0]
  else if (h < 180) [rn, gn, bn] = [0, c, x]
  else if (h < 240) [rn, gn, bn] = [0, x, c]
  else if (h < 300) [rn, gn, bn] = [x, 0, c]
  else [rn, gn, bn] = [c, 0, x]
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  }
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1)
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  }
}

export function relativeLuminance({ r, g, b }: Rgb) {
  const lin = (n: number) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function usableSolid(rgb: Rgb, appearance: 'light' | 'dark'): Rgb {
  const hsv = rgbToHsv(rgb)
  if (appearance === 'dark') {
    return hsvToRgb({
      h: hsv.h,
      s: Math.max(hsv.s, 0.28),
      v: Math.max(hsv.v, 0.52),
    })
  }
  let next = hsvToRgb({
    h: hsv.h,
    s: Math.max(hsv.s, 0.36),
    v: Math.min(hsv.v, 0.92),
  })
  if (relativeLuminance(next) > 0.72) {
    next = hsvToRgb({ ...rgbToHsv(next), v: 0.72 })
  }
  return next
}

export type AccentLook = {
  hex: string
  bg: string
  panel: string
  fall: [string, string, string]
}

export function lookFromHex(hex: string, appearance: 'light' | 'dark'): AccentLook {
  const rgb = hexToRgb(hex) ?? { r: 62, g: 99, b: 221 }
  const solid = usableSolid(rgb, appearance)
  const white = { r: 255, g: 255, b: 255 }
  const ink = { r: 8, g: 12, b: 24 }
  if (appearance === 'dark') {
    return {
      hex: rgbToHex(solid),
      bg: rgbToHex(mixRgb(solid, ink, 0.9)),
      panel: rgbToHex(mixRgb(solid, { r: 24, g: 28, b: 40 }, 0.78)),
      fall: [
        rgbToHex(mixRgb(solid, white, 0.42)),
        rgbToHex(solid),
        rgbToHex(mixRgb(solid, ink, 0.52)),
      ],
    }
  }
  const hsv = rgbToHsv(solid)
  const paper = hsvToRgb({
    h: hsv.h,
    s: clamp(hsv.s * 0.16, 0.05, 0.14),
    v: 0.88,
  })
  const inkA = hsvToRgb({
    h: hsv.h,
    s: clamp(hsv.s * 0.85, 0.38, 0.72),
    v: clamp(hsv.v * 0.46, 0.32, 0.5),
  })
  const inkC = hsvToRgb({
    h: hsv.h,
    s: clamp(hsv.s * 0.38, 0.16, 0.42),
    v: 0.76,
  })
  return {
    hex: rgbToHex(solid),
    bg: rgbToHex(paper),
    panel: rgbToHex(mixRgb(paper, { r: 248, g: 248, b: 246 }, 0.28)),
    fall: [rgbToHex(inkA), rgbToHex(solid), rgbToHex(inkC)],
  }
}

const ACCENT_STYLE_ID = 'structurelab-custom-accent'

const ACCENT_VAR_NAMES = [
  ...Array.from({ length: 12 }, (_, i) => `--accent-${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `--accent-a${i + 1}`),
  '--accent-contrast',
  '--accent-surface',
  '--accent-indicator',
  '--accent-track',
]

function rgba({ r, g, b }: Rgb, a: number) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

function stripInlineAccent(node: Element | null) {
  if (!(node instanceof HTMLElement)) return
  for (const name of ACCENT_VAR_NAMES) node.style.removeProperty(name)
}

/** Drop wheel-accent leftovers from html, body, and every themed surface. */
export function clearAccentHex() {
  document.getElementById(ACCENT_STYLE_ID)?.remove()
  stripInlineAccent(document.documentElement)
  stripInlineAccent(document.body)
  document.querySelectorAll('.radix-themes').forEach((node) => stripInlineAccent(node))
}

export function applyAccentHex(hex: string, appearance: 'light' | 'dark') {
  const rgb = hexToRgb(hex) ?? { r: 62, g: 99, b: 221 }
  const solid = usableSolid(rgb, appearance)
  const bg = appearance === 'dark' ? { r: 10, g: 12, b: 18 } : mixRgb(solid, { r: 220, g: 226, b: 232 }, 0.88)
  const fg = appearance === 'dark' ? { r: 236, g: 240, b: 248 } : { r: 18, g: 22, b: 30 }
  const tints = [0.07, 0.11, 0.17, 0.25, 0.36, 0.5, 0.68, 0.86]
  const scale = [
    ...tints.map((t) => mixRgb(bg, solid, t)),
    solid,
    mixRgb(solid, fg, 0.12),
    mixRgb(solid, fg, appearance === 'dark' ? 0.28 : 0.38),
    mixRgb(solid, fg, 0.55),
  ]
  const alphas = [0.05, 0.08, 0.12, 0.18, 0.24, 0.32, 0.44, 0.6, 0.84, 0.9, 0.95, 1]
  const contrast = relativeLuminance(solid) > 0.55 ? '#11181C' : '#FFFFFF'
  const vars: string[] = [
    `--accent-contrast: ${contrast}`,
    `--accent-surface: ${rgbToHex(scale[1]!)}`,
    `--accent-indicator: ${rgbToHex(solid)}`,
    `--accent-track: ${rgbToHex(solid)}`,
  ]
  scale.forEach((color, index) => {
    vars.push(`--accent-${index + 1}: ${rgbToHex(color)}`)
    vars.push(`--accent-a${index + 1}: ${rgba(color, alphas[index]!)}`)
  })
  clearAccentHex()
  const style = document.createElement('style')
  style.id = ACCENT_STYLE_ID
  // Only while Custom is active, so a leftover sheet cannot paint named themes.
  style.textContent = `html[data-theme-preset='custom'], html[data-theme-preset='custom'] .radix-themes { ${vars.join('; ')} }`
  document.head.appendChild(style)
}
