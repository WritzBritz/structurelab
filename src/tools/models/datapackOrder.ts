import type { DatapackPattern, SceneVoxel } from '../../types'
import { sanitizeDatapackName } from '../../api'

/** Mirror of Rust `hash_name` for Random seed when seed is 0. */
export function hashDatapackName(name: string): bigint {
  let h = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(name)
  for (const b of bytes) {
    h ^= BigInt(b)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h
}

function seededShuffle<T>(items: T[], seed: bigint): void {
  if (items.length <= 1) return
  let state = seed | 1n
  for (let i = items.length - 1; i >= 1; i -= 1) {
    state = (state * 6364136223846793005n + 1n) & 0xffffffffffffffffn
    const j = Number(state >> 33n) % (i + 1)
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
}

type Xyz = { x: number; y: number; z: number }

function occupiedCenter(blocks: Xyz[]): [number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const b of blocks) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    minZ = Math.min(minZ, b.z)
    maxX = Math.max(maxX, b.x)
    maxY = Math.max(maxY, b.y)
    maxZ = Math.max(maxZ, b.z)
  }
  return [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5]
}

function radialKey(b: Xyz, cx: number, cy: number, cz: number): number {
  return Math.round(Math.abs(b.x - cx) + Math.abs(b.y - cy) + Math.abs(b.z - cz))
}

function sphereKey(b: Xyz, cx: number, cy: number, cz: number): number {
  const dx = b.x - cx
  const dy = b.y - cy
  const dz = b.z - cz
  return dx * dx + dy * dy + dz * dz
}

function spiralKey(b: Xyz, cx: number, cz: number): [number, number, number] {
  const dx = b.x - cx
  const dz = b.z - cz
  const ring = Math.round(Math.max(Math.abs(dx), Math.abs(dz)))
  const angle = Math.atan2(dz, dx)
  return [ring, angle, b.y]
}

function goldenKey(b: Xyz, cx: number, cz: number): [number, number, number] {
  const GOLDEN = 2.399963229728653
  const TAU = Math.PI * 2
  const dx = b.x - cx
  const dz = b.z - cz
  const radius = Math.hypot(dx, dz)
  const ring = Math.round(radius)
  const angle = Math.atan2(dz, dx)
  let phase = (angle - GOLDEN * radius) % TAU
  if (phase < 0) phase += TAU
  return [ring, phase, b.y]
}

function cmpTriple(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Order voxels the same way the Rust datapack encoder places blocks.
 * Instant returns a shallow copy (export order unchanged).
 */
export function orderVoxelsForDatapack(
  voxels: SceneVoxel[],
  pattern: DatapackPattern,
  datapackName = 'build',
  randomSeed = 0n,
): SceneVoxel[] {
  const out = voxels.slice()
  switch (pattern) {
    case 'instant':
      return out
    case 'optimal':
      // Chunk columns first (FAWE-style), then bottom → top within each chunk.
      out.sort(
        (a, b) =>
          Math.floor(a.x / 16) - Math.floor(b.x / 16)
          || Math.floor(a.z / 16) - Math.floor(b.z / 16)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    case 'layerYAsc':
      out.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
      return out
    case 'layerYDesc':
      out.sort((a, b) => b.y - a.y || a.x - b.x || a.z - b.z)
      return out
    case 'axisZAsc':
      out.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      return out
    case 'axisXDesc':
      out.sort((a, b) => b.x - a.x || a.y - b.y || a.z - b.z)
      return out
    case 'radialOut': {
      const [cx, cy, cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          radialKey(a, cx, cy, cz) - radialKey(b, cx, cy, cz)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'radialIn': {
      const [cx, cy, cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          radialKey(b, cx, cy, cz) - radialKey(a, cx, cy, cz)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'sphereOut': {
      const [cx, cy, cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          sphereKey(a, cx, cy, cz) - sphereKey(b, cx, cy, cz)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'sphereIn': {
      const [cx, cy, cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          sphereKey(b, cx, cy, cz) - sphereKey(a, cx, cy, cz)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'spiralOut': {
      const [cx, , cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          cmpTriple(spiralKey(a, cx, cz), spiralKey(b, cx, cz))
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'spiralIn': {
      const [cx, , cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          cmpTriple(spiralKey(b, cx, cz), spiralKey(a, cx, cz))
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'layerSpiral': {
      const [cx, , cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          a.y - b.y
          || cmpTriple(spiralKey(a, cx, cz), spiralKey(b, cx, cz))
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'diagonal':
      out.sort(
        (a, b) =>
          a.x + a.y + a.z - (b.x + b.y + b.z)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    case 'checker': {
      const [cx, cy, cz] = occupiedCenter(out)
      out.sort((a, b) => {
        const pa = ((a.x + a.y + a.z) % 2 + 2) % 2
        const pb = ((b.x + b.y + b.z) % 2 + 2) % 2
        return (
          pa - pb
          || radialKey(a, cx, cy, cz) - radialKey(b, cx, cy, cz)
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z
        )
      })
      return out
    }
    case 'goldenSpiral': {
      const [cx, , cz] = occupiedCenter(out)
      out.sort(
        (a, b) =>
          cmpTriple(goldenKey(a, cx, cz), goldenKey(b, cx, cz))
          || a.y - b.y
          || a.x - b.x
          || a.z - b.z,
      )
      return out
    }
    case 'random': {
      const seed =
        randomSeed === 0n
          ? hashDatapackName(sanitizeDatapackName(datapackName))
          : randomSeed
      seededShuffle(out, seed)
      return out
    }
    default:
      return out
  }
}

/** How many blocks should be visible after `tick` game-ticks of animated build. */
export function visibleCountAtTick(
  blockCount: number,
  blocksPerTick: number,
  delayTicks: number,
  tick: number,
): number {
  if (blockCount <= 0) return 0
  if (tick < 0) return 0
  const bpt = Math.max(1, Math.min(65_536, Math.floor(blocksPerTick)))
  const delay = Math.max(0, Math.min(20, Math.floor(delayTicks)))
  const period = delay + 1
  const step = Math.floor(tick / period)
  return Math.min(blockCount, (step + 1) * bpt)
}

/** Total game ticks until the last block is placed. */
export function totalBuildTicks(
  blockCount: number,
  blocksPerTick: number,
  delayTicks: number,
): number {
  if (blockCount <= 0) return 0
  const bpt = Math.max(1, Math.min(65_536, Math.floor(blocksPerTick)))
  const delay = Math.max(0, Math.min(20, Math.floor(delayTicks)))
  const steps = Math.ceil(blockCount / bpt)
  if (steps <= 0) return 0
  return (steps - 1) * (delay + 1)
}

/** Wall-clock ms per game tick — matches Minecraft 20 TPS (exactly 1:1 with in-game). */
export function previewTickMs(
  _blockCount?: number,
  _blocksPerTick?: number,
  _delayTicks?: number,
): number {
  return 50
}

/**
 * Soft cap on column templates per tick (lighting / chunk updates).
 * Dense columns stay low; sparse statues can place more.
 */
function maxSafePiecesPerTick(avgBlocksPerPiece: number, pieceCount: number): number {
  if (avgBlocksPerPiece > 12_000) return 1
  if (avgBlocksPerPiece > 4_000) return 2
  if (avgBlocksPerPiece > 1_500) return 4
  if (pieceCount > 96) return 8
  if (pieceCount > 24) return 12
  return Math.min(pieceCount, 24)
}

export type OptimalPace = {
  blocksPerTick: number
  delayTicks: number
  piecesPerTick: number
  pieceCount: number
  /** Actual in-game seconds at 20 TPS after clamping. */
  seconds: number
}

/** Shared UI default for Optimal + Animate target time (seconds). */
export const DEFAULT_DATAPACK_TARGET_SECONDS = 3

/**
 * Optimal paste pace from a target duration.
 *
 * Uses chunked `/place template` columns. Shorter targets raise columns/tick
 * (capped for low-spec). Longer targets drop to 1 column/tick then add delay.
 */
export function computeOptimalPace(
  blockCount: number,
  size: [number, number, number],
  targetSeconds = DEFAULT_DATAPACK_TARGET_SECONDS,
): OptimalPace {
  const chunksX = Math.max(1, Math.ceil(size[0] / 16))
  const chunksZ = Math.max(1, Math.ceil(size[2] / 16))
  const pieceCount = Math.max(1, chunksX * chunksZ)
  const avgBlocks = blockCount > 0 ? blockCount / pieceCount : 0
  const safeMax = maxSafePiecesPerTick(avgBlocks, pieceCount)
  const targetTicks = Math.max(1, Math.round(Math.max(0.05, targetSeconds) * 20))

  let piecesPerTick = Math.ceil(pieceCount / targetTicks)
  piecesPerTick = Math.max(1, Math.min(pieceCount, safeMax, piecesPerTick))
  let delayTicks = 0

  let steps = Math.max(1, Math.ceil(pieceCount / piecesPerTick))
  let totalTicks = Math.max(0, steps - 1)

  // Can't go slower than 1 column/tick without idle delay between columns.
  if (totalTicks < targetTicks && piecesPerTick <= 1) {
    piecesPerTick = 1
    steps = pieceCount
    const gaps = Math.max(1, steps - 1)
    delayTicks = Math.min(20, Math.max(0, Math.floor(targetTicks / gaps) - 1))
    totalTicks = gaps * (delayTicks + 1)
  }

  const blocksPerTick = Math.max(1, Math.ceil(Math.max(blockCount, 1) / steps))

  return {
    blocksPerTick: Math.min(65_536, blocksPerTick),
    delayTicks,
    piecesPerTick,
    pieceCount,
    seconds: totalTicks / 20,
  }
}

/** Fastest safe Optimal duration at max columns/tick (floor for hints, not the UI default). */
export function suggestOptimalTargetSeconds(
  blockCount: number,
  size: [number, number, number],
): number {
  const chunksX = Math.max(1, Math.ceil(size[0] / 16))
  const chunksZ = Math.max(1, Math.ceil(size[2] / 16))
  const pieceCount = Math.max(1, chunksX * chunksZ)
  const avgBlocks = blockCount > 0 ? blockCount / pieceCount : 0
  const ppt = maxSafePiecesPerTick(avgBlocks, pieceCount)
  const steps = Math.max(1, Math.ceil(pieceCount / ppt))
  return Math.max(0.25, Math.round(((steps - 1) / 20) * 100) / 100)
}

/**
 * Animate mode: pick blocks/step (+ keep delay) so the run lasts ~targetSeconds.
 */
export function computeAnimatePaceFromDuration(
  blockCount: number,
  targetSeconds: number,
  delayTicks = 0,
): { blocksPerTick: number; delayTicks: number; seconds: number } {
  const delay = Math.max(0, Math.min(20, Math.floor(delayTicks)))
  const targetTicks = Math.max(1, Math.round(Math.max(0.05, targetSeconds) * 20))
  const period = delay + 1
  // (steps - 1) * period ≈ targetTicks  →  steps ≈ targetTicks/period + 1
  const steps = Math.max(1, Math.floor(targetTicks / period) + 1)
  const blocksPerTick = Math.max(
    1,
    Math.min(65_536, Math.ceil(Math.max(blockCount, 1) / steps)),
  )
  const actualTicks = Math.max(0, Math.ceil(Math.max(blockCount, 1) / blocksPerTick) - 1) * period
  return {
    blocksPerTick,
    delayTicks: delay,
    seconds: actualTicks / 20,
  }
}
