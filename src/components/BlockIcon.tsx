import { useEffect, useMemo, useState } from 'react'
import {
  baseBlockId,
  blockTextureCandidates,
  blockTint,
} from '../tools/models/blockTextures'
import { blockIconCandidates } from '../minecraftAssets'

function blockThumbSources(blockId: string): string[] {
  return [...blockIconCandidates(blockId), ...blockTextureCandidates(blockId)]
}

/** Inventory icon → face texture → colour swatch fallback. */
export function BlockIcon({
  block,
  color = [92, 104, 110],
  className = '',
}: {
  block: string
  color?: [number, number, number]
  className?: string
}) {
  const blockId = baseBlockId(block)
  // Inventory renders already carry the biome tint, so they come first and need
  // no colouring; the raw face textures behind them are the greyscale jar PNGs.
  const sources = useMemo(() => blockThumbSources(blockId), [blockId])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => setAttempt(0), [blockId])

  const label = blockId
    .split('_')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  if (attempt >= sources.length) {
    return (
      <span
        className={`block-icon fallback ${className}`.trim()}
        style={{ background: `rgb(${color.join(',')})` }}
        title={block}
      >
        {label}
      </span>
    )
  }

  const tint = attempt > 0 ? blockTint(blockId) : null

  return (
    <span
      className={`block-icon ${tint ? 'tinted' : ''} ${className}`.trim()}
      title={block}
      style={tint ? { background: `rgb(${tint.join(',')})` } : undefined}
    >
      <img
        src={sources[attempt]}
        alt=""
        loading="lazy"
        onError={() => setAttempt((current) => current + 1)}
      />
    </span>
  )
}
