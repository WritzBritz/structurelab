import type { MapColor } from '../types'
import { mapColorRgbHex } from '../materials'

export function MapColorSwatch({
  color,
  size = 32,
  className = '',
}: {
  color: MapColor
  size?: number
  className?: string
}) {
  const hex = mapColorRgbHex(color)
  return (
    <span
      className={`map-color-swatch ${className}`.trim()}
      style={{
        width: size,
        height: size,
        backgroundColor: hex,
      }}
      title={`Map colour ${hex}`}
      aria-hidden="true"
    />
  )
}
