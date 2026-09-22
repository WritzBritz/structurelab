import { Text, TextField } from '@radix-ui/themes'
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clamp,
  hexToRgb,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsv,
  type Hsv,
} from './color'

const WHEEL = 168
const VALUE_W = 18

type ColorWheelProps = {
  value: string
  onChange: (hex: string) => void
}

function hsvFromHex(hex: string): Hsv {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsv(rgb) : { h: 226, s: 0.72, v: 0.87 }
}

function drawWheel(ctx: CanvasRenderingContext2D, value: number) {
  const image = ctx.createImageData(WHEEL, WHEEL)
  const cx = WHEEL / 2
  const cy = WHEEL / 2
  const radius = WHEEL / 2 - 1.5
  for (let y = 0; y < WHEEL; y++) {
    for (let x = 0; x < WHEEL; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)
      const i = (y * WHEEL + x) * 4
      if (dist > radius) {
        image.data[i + 3] = 0
        continue
      }
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI
      const rgb = hsvToRgb({
        h: (hue + 360) % 360,
        s: dist / radius,
        v: value,
      })
      image.data[i] = rgb.r
      image.data[i + 1] = rgb.g
      image.data[i + 2] = rgb.b
      image.data[i + 3] = dist > radius - 1 ? Math.round(255 * (radius - dist)) : 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

function drawValue(ctx: CanvasRenderingContext2D, hue: number, sat: number) {
  const image = ctx.createImageData(VALUE_W, WHEEL)
  for (let y = 0; y < WHEEL; y++) {
    const rgb = hsvToRgb({ h: hue, s: sat, v: 1 - y / (WHEEL - 1) })
    for (let x = 0; x < VALUE_W; x++) {
      const i = (y * VALUE_W + x) * 4
      image.data[i] = rgb.r
      image.data[i + 1] = rgb.g
      image.data[i + 2] = rgb.b
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

export function ColorWheel({ value, onChange }: ColorWheelProps) {
  const wheelRef = useRef<HTMLCanvasElement>(null)
  const valueRef = useRef<HTMLCanvasElement>(null)
  const hsvRef = useRef<Hsv>(hsvFromHex(value))
  const [hsv, setHsv] = useState<Hsv>(() => hsvFromHex(value))
  const [hexText, setHexText] = useState(value)
  const labelId = useId()

  useEffect(() => {
    const next = normalizeHex(value)
    if (!next) return
    const current = rgbToHex(hsvToRgb(hsvRef.current))
    if (next === current) {
      setHexText(next)
      return
    }
    const parsed = hsvFromHex(next)
    hsvRef.current = parsed
    setHsv(parsed)
    setHexText(next)
  }, [value])

  useEffect(() => {
    const wheel = wheelRef.current?.getContext('2d')
    const bar = valueRef.current?.getContext('2d')
    if (wheel) drawWheel(wheel, hsv.v)
    if (bar) drawValue(bar, hsv.h, hsv.s)
  }, [hsv.h, hsv.s, hsv.v])

  function commit(next: Hsv) {
    const clamped = {
      h: (next.h + 360) % 360,
      s: clamp(next.s, 0, 1),
      v: clamp(next.v, 0, 1),
    }
    hsvRef.current = clamped
    setHsv(clamped)
    const hex = rgbToHex(hsvToRgb(clamped))
    setHexText(hex)
    onChange(hex)
  }

  function pickWheel(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = wheelRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scale = WHEEL / rect.width
    const dx = (event.clientX - rect.left) * scale - WHEEL / 2
    const dy = (event.clientY - rect.top) * scale - WHEEL / 2
    const radius = WHEEL / 2 - 1.5
    const dist = Math.hypot(dx, dy)
    commit({
      h: (Math.atan2(dy, dx) * 180) / Math.PI,
      s: clamp(dist / radius, 0, 1),
      v: hsvRef.current.v,
    })
  }

  function pickValue(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = valueRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const t = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    commit({ ...hsvRef.current, v: 1 - t })
  }

  function bindPick(
    pick: (event: ReactPointerEvent<HTMLCanvasElement>) => void,
  ) {
    return (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      pick(event)
    }
  }

  const marker = {
    x: WHEEL / 2 + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * (WHEEL / 2 - 1.5),
    y: WHEEL / 2 + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * (WHEEL / 2 - 1.5),
  }

  return (
    <div className="theme-wheel">
      <Text as="p" size="1" weight="medium" id={labelId}>
        Accent
      </Text>
      <div className="theme-wheel-row">
        <div className="theme-wheel-disk">
          <canvas
            ref={wheelRef}
            width={WHEEL}
            height={WHEEL}
            className="theme-wheel-canvas"
            aria-labelledby={labelId}
            aria-label="Hue and saturation"
            onPointerDown={bindPick(pickWheel)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              pickWheel(event)
            }}
          />
          <span
            className="theme-wheel-knob"
            style={{ left: marker.x, top: marker.y, background: hexText }}
            aria-hidden
          />
        </div>
        <div className="theme-wheel-value">
          <canvas
            ref={valueRef}
            width={VALUE_W}
            height={WHEEL}
            className="theme-wheel-canvas"
            aria-label="Brightness"
            onPointerDown={bindPick(pickValue)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              pickValue(event)
            }}
          />
          <span
            className="theme-wheel-value-knob"
            style={{ top: `${(1 - hsv.v) * 100}%` }}
            aria-hidden
          />
        </div>
      </div>
      <TextField.Root
        value={hexText}
        aria-label="Hex colour"
        onChange={(event) => {
          const next = event.target.value.toUpperCase()
          setHexText(next)
          const hex = normalizeHex(next)
          if (!hex) return
          const parsed = hsvFromHex(hex)
          hsvRef.current = parsed
          setHsv(parsed)
          onChange(hex)
        }}
      />
    </div>
  )
}
