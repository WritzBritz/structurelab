import { Button, Slider, Text, TextField } from '@radix-ui/themes'
import type { ChangeEvent } from 'react'

type Axis = 0 | 1 | 2

const AXIS: { index: Axis; label: string }[] = [
  { index: 0, label: 'X' },
  { index: 1, label: 'Y' },
  { index: 2, label: 'Z' },
]

function roundAxis(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1000) / 1000
}

export function OrbitPivotPanel({
  offset,
  span,
  onChange,
  onRecenter,
}: {
  offset: [number, number, number]
  span: number
  onChange: (next: [number, number, number]) => void
  onRecenter: () => void
}) {
  const reach = Math.max(span * 0.9, 0.5)
  const step = reach > 8 ? 0.1 : 0.01
  const setAxis = (axis: Axis, raw: number) => {
    if (!Number.isFinite(raw)) return
    const next: [number, number, number] = [offset[0], offset[1], offset[2]]
    next[axis] = roundAxis(raw)
    onChange(next)
  }

  return (
    <div className="orbit-pivot-panel" role="group" aria-label="Orbit pivot — point the camera rotates around">
      <div className="orbit-pivot-heading">
        <Text size="1" weight="medium">
          Orbit pivot
        </Text>
        <span>Point the camera rotates around</span>
      </div>
      {AXIS.map(({ index, label }) => (
        <label key={label} className="orbit-pivot-axis">
          <span>{label}</span>
          <Slider
            min={-reach}
            max={reach}
            step={step}
            value={[Math.min(reach, Math.max(-reach, offset[index]!))]}
            onValueChange={(next) => setAxis(index, next[0] ?? 0)}
            aria-label={`Orbit pivot ${label}`}
          />
          <TextField.Root
            type="number"
            size="1"
            step={String(step)}
            value={String(roundAxis(offset[index]!))}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setAxis(index, Number(event.target.value))
            }}
            aria-label={`Orbit pivot ${label} value`}
          />
        </label>
      ))}
      <Button type="button" size="1" variant="soft" color="gray" onClick={onRecenter}>
        Centre on model
      </Button>
    </div>
  )
}
