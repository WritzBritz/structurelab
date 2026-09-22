/**
 * Curve-skeleton extraction for arbitrary meshes.
 *
 * Voxelises the mesh, scores every cell by how deep inside the solid it sits,
 * then traces medial paths from a central root out to each extremity. The paths
 * are merged into a tree and returned as polyline branches, which is enough to
 * hang a bone chain off any shape — a chair, a dragon, a sword — without
 * assuming the model is a person.
 *
 * This is the voxel-thinning family of skeletonisation rather than the
 * Laplacian mesh-contraction family, because the input here is loose triangle
 * soup with no guaranteed connectivity.
 */

/** Cells along the longest axis. Fine enough to separate limbs, cheap to walk. */
const RESOLUTION = 40
/** Branches shorter than this fraction of the bounding diagonal are noise. */
const MIN_BRANCH_FRACTION = 0.1
/**
 * A limb has to be this much longer than the solid is thick where it attaches.
 * Without it, the corners of a plain box read as eight stubby limbs.
 */
const LIMB_SLENDERNESS = 2
/** Upper bound on extremities, so a spiky model doesn't explode into bones. */
const MAX_BRANCHES = 12
/** Bones the UI can reasonably list for one model. */
const MAX_KEPT_BRANCHES = 10
/** Douglas–Peucker tolerance, as a fraction of the bounding diagonal. */
const SIMPLIFY_FRACTION = 0.05
/** A single branch never becomes more than this many bones. */
const MAX_SEGMENTS_PER_BRANCH = 4
/**
 * How strongly path tracing prefers deep cells over short routes. Without this
 * the path hugs the surface and the bones sit in the skin instead of the middle.
 */
const MEDIAL_PENALTY = 6

export type SkeletonBranch = {
  /** Polyline in mesh space, junction end first, extremity last. */
  points: Array<[number, number, number]>
  /** Local half-thickness of the solid at each point. */
  radii: number[]
  /** Index of the parent branch, or null when it hangs off the root. */
  parent: number | null
}

export type MeshSkeleton = {
  branches: SkeletonBranch[]
  /** Deepest interior point — where the bone tree is anchored. */
  root: [number, number, number]
  /** Voxel size used, in mesh units. */
  cell: number
}

type Grid = {
  nx: number
  ny: number
  nz: number
  nxy: number
  cell: number
  origin: [number, number, number]
  occupied: Uint8Array
}

/** Step length for each of the 26 neighbour offsets, indexed (dz+1)*9+(dy+1)*3+(dx+1). */
const STEP_LENGTH = (() => {
  const table = new Float64Array(27)
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        table[(dz + 1) * 9 + (dy + 1) * 3 + (dx + 1)] = Math.hypot(dx, dy, dz)
      }
    }
  }
  return table
})()

function cellCentre(g: Grid, index: number): [number, number, number] {
  const x = index % g.nx
  const y = ((index / g.nx) | 0) % g.ny
  const z = (index / g.nxy) | 0
  return [
    g.origin[0] + (x + 0.5) * g.cell,
    g.origin[1] + (y + 0.5) * g.cell,
    g.origin[2] + (z + 0.5) * g.cell,
  ]
}

/** Mark every cell the surface passes through, sampling triangles when we have them. */
function rasterise(positions: Float32Array, g: Grid): void {
  const mark = (x: number, y: number, z: number) => {
    const cx = ((x - g.origin[0]) / g.cell) | 0
    const cy = ((y - g.origin[1]) / g.cell) | 0
    const cz = ((z - g.origin[2]) / g.cell) | 0
    if (cx < 0 || cy < 0 || cz < 0 || cx >= g.nx || cy >= g.ny || cz >= g.nz) return
    g.occupied[cx + cy * g.nx + cz * g.nxy] = 1
  }

  const vertexCount = Math.floor(positions.length / 3)
  for (let i = 0; i < vertexCount; i += 1) {
    mark(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!)
  }

  // Triangle soup: large faces would otherwise leave their interior empty and
  // break the solid into disconnected corner blobs.
  if (vertexCount % 3 !== 0) return
  for (let t = 0; t < vertexCount; t += 3) {
    const ax = positions[t * 3]!
    const ay = positions[t * 3 + 1]!
    const az = positions[t * 3 + 2]!
    const bx = positions[t * 3 + 3]!
    const by = positions[t * 3 + 4]!
    const bz = positions[t * 3 + 5]!
    const cx = positions[t * 3 + 6]!
    const cy = positions[t * 3 + 7]!
    const cz = positions[t * 3 + 8]!
    const longest = Math.max(
      Math.hypot(bx - ax, by - ay, bz - az),
      Math.hypot(cx - bx, cy - by, cz - bz),
      Math.hypot(ax - cx, ay - cy, az - cz),
    )
    const steps = Math.min(64, Math.ceil((longest / g.cell) * 2))
    if (steps <= 1) continue
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps
        const v = j / steps
        const w = 1 - u - v
        mark(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v)
      }
    }
  }
}

/**
 * Flood the outside air inward, then treat everything it couldn't reach as solid.
 * Open or shelled meshes leak, so the fill is discarded when it swallows the model.
 */
function fillInterior(g: Grid): void {
  const total = g.nx * g.ny * g.nz
  const outside = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  const seed = (x: number, y: number, z: number) => {
    const i = x + y * g.nx + z * g.nxy
    if (g.occupied[i] || outside[i]) return
    outside[i] = 1
    queue[tail++] = i
  }
  for (let z = 0; z < g.nz; z += 1) {
    for (let y = 0; y < g.ny; y += 1) {
      seed(0, y, z)
      seed(g.nx - 1, y, z)
    }
  }
  for (let z = 0; z < g.nz; z += 1) {
    for (let x = 0; x < g.nx; x += 1) {
      seed(x, 0, z)
      seed(x, g.ny - 1, z)
    }
  }
  for (let y = 0; y < g.ny; y += 1) {
    for (let x = 0; x < g.nx; x += 1) {
      seed(x, y, 0)
      seed(x, y, g.nz - 1)
    }
  }

  while (head < tail) {
    const i = queue[head++]!
    const x = i % g.nx
    const y = ((i / g.nx) | 0) % g.ny
    const z = (i / g.nxy) | 0
    const step = (nx: number, ny: number, nz: number) => {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= g.nx || ny >= g.ny || nz >= g.nz) return
      const n = nx + ny * g.nx + nz * g.nxy
      if (g.occupied[n] || outside[n]) return
      outside[n] = 1
      queue[tail++] = n
    }
    step(x - 1, y, z)
    step(x + 1, y, z)
    step(x, y - 1, z)
    step(x, y + 1, z)
    step(x, y, z - 1)
    step(x, y, z + 1)
  }

  let surface = 0
  let interior = 0
  for (let i = 0; i < total; i += 1) {
    if (g.occupied[i]) surface += 1
    else if (!outside[i]) interior += 1
  }
  // A watertight solid gains volume; a leaking shell gains almost nothing.
  if (interior < surface * 0.05) return
  for (let i = 0; i < total; i += 1) {
    if (!g.occupied[i] && !outside[i]) g.occupied[i] = 1
  }
}

/** Re-mark the raw surface, undoing an earlier component cull. */
function restoreAll(g: Grid, positions: Float32Array): void {
  g.occupied.fill(0)
  rasterise(positions, g)
  fillInterior(g)
}

/** Grow the solid by `radius` cells, closing sampling gaps. */
function dilate(g: Grid, radius: number): void {
  for (let pass = 0; pass < radius; pass += 1) {
    const next = g.occupied.slice()
    for (let z = 0; z < g.nz; z += 1) {
      for (let y = 0; y < g.ny; y += 1) {
        for (let x = 0; x < g.nx; x += 1) {
          const i = x + y * g.nx + z * g.nxy
          if (g.occupied[i]) continue
          let touching = false
          for (let dz = -1; dz <= 1 && !touching; dz += 1) {
            const nz = z + dz
            if (nz < 0 || nz >= g.nz) continue
            for (let dy = -1; dy <= 1 && !touching; dy += 1) {
              const ny = y + dy
              if (ny < 0 || ny >= g.ny) continue
              for (let dx = -1; dx <= 1; dx += 1) {
                const nx = x + dx
                if (nx < 0 || nx >= g.nx) continue
                if (g.occupied[nx + ny * g.nx + nz * g.nxy]) {
                  touching = true
                  break
                }
              }
            }
          }
          if (touching) next[i] = 1
        }
      }
    }
    g.occupied = next
  }
}

/** Keep only the biggest blob, so stray floating bits don't anchor branches. */
function keepLargestComponent(g: Grid): number[] {
  const total = g.nx * g.ny * g.nz
  const seen = new Uint8Array(total)
  const stack: number[] = []
  let best: number[] = []

  for (let start = 0; start < total; start += 1) {
    if (!g.occupied[start] || seen[start]) continue
    const component: number[] = []
    seen[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const i = stack.pop()!
      component.push(i)
      const x = i % g.nx
      const y = ((i / g.nx) | 0) % g.ny
      const z = (i / g.nxy) | 0
      for (let dz = -1; dz <= 1; dz += 1) {
        const nz = z + dz
        if (nz < 0 || nz >= g.nz) continue
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy
          if (ny < 0 || ny >= g.ny) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx
            if (nx < 0 || nx >= g.nx) continue
            if (dx === 0 && dy === 0 && dz === 0) continue
            const n = nx + ny * g.nx + nz * g.nxy
            if (!g.occupied[n] || seen[n]) continue
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    if (component.length > best.length) best = component
  }

  if (best.length > 0) {
    const keep = new Uint8Array(total)
    for (const i of best) keep[i] = 1
    for (let i = 0; i < total; i += 1) {
      if (g.occupied[i] && !keep[i]) g.occupied[i] = 0
    }
  }
  return best
}

/** Cell distance to the nearest empty cell — how buried each voxel is. */
function depthField(g: Grid, cells: number[]): Float64Array {
  const total = g.nx * g.ny * g.nz
  const depth = new Float64Array(total).fill(Infinity)
  const queue = new Int32Array(cells.length)
  let head = 0
  let tail = 0

  for (const i of cells) {
    const x = i % g.nx
    const y = ((i / g.nx) | 0) % g.ny
    const z = (i / g.nxy) | 0
    const open = (nx: number, ny: number, nz: number) => {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= g.nx || ny >= g.ny || nz >= g.nz) return true
      return !g.occupied[nx + ny * g.nx + nz * g.nxy]
    }
    if (
      open(x - 1, y, z) || open(x + 1, y, z)
      || open(x, y - 1, z) || open(x, y + 1, z)
      || open(x, y, z - 1) || open(x, y, z + 1)
    ) {
      depth[i] = 1
      queue[tail++] = i
    }
  }

  while (head < tail) {
    const i = queue[head++]!
    const x = i % g.nx
    const y = ((i / g.nx) | 0) % g.ny
    const z = (i / g.nxy) | 0
    const step = (nx: number, ny: number, nz: number) => {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= g.nx || ny >= g.ny || nz >= g.nz) return
      const n = nx + ny * g.nx + nz * g.nxy
      if (!g.occupied[n] || depth[n] !== Infinity) return
      depth[n] = depth[i]! + 1
      queue[tail++] = n
    }
    step(x - 1, y, z)
    step(x + 1, y, z)
    step(x, y - 1, z)
    step(x, y + 1, z)
    step(x, y, z - 1)
    step(x, y, z + 1)
  }
  return depth
}

/**
 * Shortest paths through the solid from `sources`. `weight` scales each step, so
 * the same routine serves plain geodesic distance and medial-biased tracing.
 */
function shortestPaths(
  g: Grid,
  sources: number[],
  weight: ((cell: number) => number) | null,
  prev: Int32Array | null,
): Float64Array {
  const total = g.nx * g.ny * g.nz
  const dist = new Float64Array(total).fill(Infinity)
  const queued = new Uint8Array(total)
  const queue: number[] = []
  for (const s of sources) {
    dist[s] = 0
    queued[s] = 1
    queue.push(s)
  }
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    queued[i] = 0
    const base = dist[i]!
    const x = i % g.nx
    const y = ((i / g.nx) | 0) % g.ny
    const z = (i / g.nxy) | 0
    for (let dz = -1; dz <= 1; dz += 1) {
      const nz = z + dz
      if (nz < 0 || nz >= g.nz) continue
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= g.ny) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= g.nx) continue
          const n = nx + ny * g.nx + nz * g.nxy
          if (!g.occupied[n]) continue
          const step = STEP_LENGTH[(dz + 1) * 9 + (dy + 1) * 3 + (dx + 1)]!
          const next = base + (weight ? step * weight(n) : step)
          if (next < dist[n]! - 1e-9) {
            dist[n] = next
            if (prev) prev[n] = i
            if (!queued[n]) {
              queued[n] = 1
              queue.push(n)
            }
          }
        }
      }
    }
    // Reclaim the processed prefix so long runs don't grow without bound.
    if (head > 1 << 16) {
      queue.splice(0, head)
      head = 0
    }
  }
  return dist
}

function simplify(
  points: Array<[number, number, number]>,
  tolerance: number,
): number[] {
  if (points.length <= 2) return points.map((_, i) => i)
  const keep = new Set<number>([0, points.length - 1])
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop()!
    const a = points[from]!
    const b = points[to]!
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const abz = b[2] - a[2]
    const abLen = Math.hypot(abx, aby, abz) || 1
    let worst = -1
    let worstAt = -1
    for (let i = from + 1; i < to; i += 1) {
      const p = points[i]!
      const apx = p[0] - a[0]
      const apy = p[1] - a[1]
      const apz = p[2] - a[2]
      const cx = aby * apz - abz * apy
      const cy = abz * apx - abx * apz
      const cz = abx * apy - aby * apx
      const d = Math.hypot(cx, cy, cz) / abLen
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }
    if (worstAt > 0 && worst > tolerance) {
      keep.add(worstAt)
      stack.push([from, worstAt], [worstAt, to])
    }
  }
  return [...keep].sort((a, b) => a - b)
}

/** Drop interior joints, straightest first, until the branch fits the bone budget. */
function capSegments(
  points: Array<[number, number, number]>,
  keep: number[],
  limit: number,
): number[] {
  let result = keep
  while (result.length - 1 > limit) {
    let straightest = 1
    let straightestCos = -Infinity
    for (let k = 1; k < result.length - 1; k += 1) {
      const a = points[result[k - 1]!]!
      const b = points[result[k]!]!
      const c = points[result[k + 1]!]!
      const abx = b[0] - a[0]
      const aby = b[1] - a[1]
      const abz = b[2] - a[2]
      const bcx = c[0] - b[0]
      const bcy = c[1] - b[1]
      const bcz = c[2] - b[2]
      const abLen = Math.hypot(abx, aby, abz) || 1
      const bcLen = Math.hypot(bcx, bcy, bcz) || 1
      const cos = (abx * bcx + aby * bcy + abz * bcz) / (abLen * bcLen)
      if (cos > straightestCos) {
        straightestCos = cos
        straightest = k
      }
    }
    result = result.filter((_, k) => k !== straightest)
  }
  return result
}

/**
 * Voxelise the mesh and hand back an "is this point in the solid?" predicate.
 * Used to check whether a template skeleton actually lies inside the model.
 */
export function solidTest(
  positions: Float32Array,
): ((p: readonly [number, number, number]) => boolean) | null {
  const grid = buildGrid(positions)
  if (!grid) return null
  rasterise(positions, grid)
  fillInterior(grid)
  dilate(grid, 1)
  return (p) => {
    const cx = ((p[0] - grid.origin[0]) / grid.cell) | 0
    const cy = ((p[1] - grid.origin[1]) / grid.cell) | 0
    const cz = ((p[2] - grid.origin[2]) / grid.cell) | 0
    if (cx < 0 || cy < 0 || cz < 0 || cx >= grid.nx || cy >= grid.ny || cz >= grid.nz) {
      return false
    }
    return grid.occupied[cx + cy * grid.nx + cz * grid.nxy] === 1
  }
}

function buildGrid(positions: Float32Array): Grid | null {
  const vertexCount = Math.floor(positions.length / 3)
  if (vertexCount < 8) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < vertexCount; i += 1) {
    minX = Math.min(minX, positions[i * 3]!)
    maxX = Math.max(maxX, positions[i * 3]!)
    minY = Math.min(minY, positions[i * 3 + 1]!)
    maxY = Math.max(maxY, positions[i * 3 + 1]!)
    minZ = Math.min(minZ, positions[i * 3 + 2]!)
    maxZ = Math.max(maxZ, positions[i * 3 + 2]!)
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  const longest = Math.max(sizeX, sizeY, sizeZ)
  if (!Number.isFinite(longest) || longest <= 0) return null
  const cell = longest / RESOLUTION
  const nx = Math.ceil(sizeX / cell) + 3
  const ny = Math.ceil(sizeY / cell) + 3
  const nz = Math.ceil(sizeZ / cell) + 3
  return {
    nx,
    ny,
    nz,
    nxy: nx * ny,
    cell,
    // One cell of padding keeps the outside flood able to wrap the model.
    origin: [minX - cell * 1.5, minY - cell * 1.5, minZ - cell * 1.5],
    occupied: new Uint8Array(nx * ny * nz),
  }
}

export function extractMeshSkeleton(positions: Float32Array): MeshSkeleton | null {
  const vertexCount = Math.floor(positions.length / 3)
  if (vertexCount < 8) return null

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < vertexCount; i += 1) {
    minX = Math.min(minX, positions[i * 3]!)
    maxX = Math.max(maxX, positions[i * 3]!)
    minY = Math.min(minY, positions[i * 3 + 1]!)
    maxY = Math.max(maxY, positions[i * 3 + 1]!)
    minZ = Math.min(minZ, positions[i * 3 + 2]!)
    maxZ = Math.max(maxZ, positions[i * 3 + 2]!)
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  const longest = Math.max(sizeX, sizeY, sizeZ)
  if (!Number.isFinite(longest) || longest <= 0) return null
  const diagonal = Math.hypot(sizeX, sizeY, sizeZ)

  const grid = buildGrid(positions)
  if (!grid) return null
  const cell = grid.cell

  rasterise(positions, grid)
  fillInterior(grid)

  // Sparsely sampled input lands in a speckle of cells with sub-cell gaps that
  // 26-connectivity can't bridge, shattering the solid. Close the gaps only when
  // the model actually came apart, so well-formed meshes aren't inflated.
  let cells: number[] = []
  for (let pass = 0; pass < 3; pass += 1) {
    if (pass > 0) {
      restoreAll(grid, positions)
      dilate(grid, pass)
    }
    let occupied = 0
    for (let i = 0; i < grid.occupied.length; i += 1) occupied += grid.occupied[i]!
    cells = keepLargestComponent(grid)
    if (cells.length >= occupied * 0.6) break
  }
  if (cells.length < 8) return null

  const depth = depthField(grid, cells)
  let maxDepth = 0
  for (const i of cells) maxDepth = Math.max(maxDepth, depth[i]!)
  if (maxDepth <= 0) return null

  // Root at the most buried cell — the bulk of the shape, not a spike.
  const centre: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ]
  let root = cells[0]!
  let rootScore = -Infinity
  for (const i of cells) {
    const p = cellCentre(grid, i)
    const toCentre = Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])
    const score = depth[i]! / maxDepth - (toCentre / diagonal) * 0.5
    if (score > rootScore) {
      rootScore = score
      root = i
    }
  }

  // Farthest-point sampling picks one extremity per limb.
  const separation = shortestPaths(grid, [root], null, null)
  const minBranchCells = (MIN_BRANCH_FRACTION * 1.5 * diagonal) / cell
  const tips: number[] = []
  for (let n = 0; n < MAX_BRANCHES; n += 1) {
    let best = -1
    let bestDist = 0
    for (const i of cells) {
      const d = separation[i]!
      if (Number.isFinite(d) && d > bestDist) {
        bestDist = d
        best = i
      }
    }
    if (best < 0 || bestDist < minBranchCells) break
    tips.push(best)
    const fromTip = shortestPaths(grid, [best], null, null)
    for (const i of cells) separation[i] = Math.min(separation[i]!, fromTip[i]!)
  }
  if (tips.length === 0) return null

  // Union of the medial routes from every tip back to the root.
  const prev = new Int32Array(grid.occupied.length).fill(-1)
  shortestPaths(
    grid,
    [root],
    (n) => {
      const shallow = 1 - Math.min(1, depth[n]! / maxDepth)
      return 1 + MEDIAL_PENALTY * shallow * shallow
    },
    prev,
  )

  const parentOf = new Map<number, number>()
  const onSkeleton = new Set<number>([root])
  for (const tip of tips) {
    let c = tip
    let guard = 0
    while (c !== root && guard++ < grid.occupied.length) {
      const p = prev[c]!
      if (p < 0) break
      if (!onSkeleton.has(c)) {
        onSkeleton.add(c)
        parentOf.set(c, p)
      }
      c = p
    }
  }

  const children = new Map<number, number[]>()
  for (const [child, parent] of parentOf) {
    const list = children.get(parent)
    if (list) list.push(child)
    else children.set(parent, [child])
  }

  // Cut the tree into branches: each runs from a fork to the next fork or tip.
  const branches: SkeletonBranch[] = []
  const walk = (fork: number, start: number, parentBranch: number | null): void => {
    const chain = [fork, start]
    let current = start
    for (;;) {
      const next = children.get(current)
      if (!next || next.length !== 1) break
      current = next[0]!
      chain.push(current)
    }
    const index = branches.length
    branches.push({
      points: chain.map((i) => cellCentre(grid, i)),
      radii: chain.map((i) => depth[i]! * cell),
      parent: parentBranch,
    })
    for (const child of children.get(current) ?? []) walk(current, child, index)
  }
  for (const child of children.get(root) ?? []) walk(root, child, null)
  if (branches.length === 0) return null

  pruneAndCollapse(branches, MIN_BRANCH_FRACTION * diagonal)

  const tolerance = SIMPLIFY_FRACTION * diagonal
  for (const branch of branches) {
    const keep = capSegments(
      branch.points,
      simplify(branch.points, tolerance),
      MAX_SEGMENTS_PER_BRANCH,
    )
    branch.points = keep.map((i) => branch.points[i]!)
    branch.radii = keep.map((i) => branch.radii[i]!)
  }

  if (branches.length === 0) return null
  return { branches, root: cellCentre(grid, root), cell }
}

function polylineLength(points: Array<[number, number, number]>): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/**
 * Medial path tracing leaves a spray of stubs wherever routes diverge near a
 * fork. Drop the leaves that aren't really limbs, then fuse any branch that ends
 * up with a single child back into its parent so a straight limb stays one chain.
 */
function pruneAndCollapse(branches: SkeletonBranch[], minLength: number): void {
  const alive = branches.map(() => true)
  const childrenOf = (b: number) =>
    branches.map((x, i) => (alive[i] && x.parent === b ? i : -1)).filter((i) => i >= 0)
  // A limb must clear both an absolute floor and the girth of whatever it grows
  // out of, which is what tells a chair leg apart from the corner of a slab.
  const isLimb = (i: number) => {
    const branch = branches[i]!
    const length = polylineLength(branch.points)
    const base = branch.radii[0] ?? 0
    return length >= minLength && length >= base * LIMB_SLENDERNESS
  }

  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < branches.length; i += 1) {
      if (!alive[i]) continue
      if (childrenOf(i).length > 0) continue
      if (isLimb(i)) continue
      alive[i] = false
      changed = true
    }
  }

  // Two tips inside one limb trace almost the same route and split late, leaving
  // a redundant twin. Siblings heading the same way are the same limb.
  const direction = (i: number): [number, number, number] => {
    const pts = branches[i]!.points
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len]
  }
  const parents = new Set<number | null>(branches.map((b) => b.parent))
  for (const parent of parents) {
    for (;;) {
      const siblings = branches
        .map((b, i) => (alive[i] && b.parent === parent ? i : -1))
        .filter((i) => i >= 0)
      let dropped = false
      for (let a = 0; a < siblings.length && !dropped; a += 1) {
        for (let b = a + 1; b < siblings.length; b += 1) {
          const ia = siblings[a]!
          const ib = siblings[b]!
          const da = direction(ia)
          const db = direction(ib)
          if (da[0] * db[0] + da[1] * db[1] + da[2] * db[2] < 0.77) continue
          const shorter =
            polylineLength(branches[ia]!.points) < polylineLength(branches[ib]!.points)
              ? ia
              : ib
          if (childrenOf(shorter).length > 0) continue
          alive[shorter] = false
          dropped = true
          break
        }
      }
      if (!dropped) break
    }
  }

  // Keep the longest limbs when a busy model still leaves too many.
  const ranked = branches
    .map((b, i) => ({ i, length: polylineLength(b.points) }))
    .filter((entry) => alive[entry.i])
    .sort((a, b) => b.length - a.length)
  for (const entry of ranked.slice(MAX_KEPT_BRANCHES)) {
    if (childrenOf(entry.i).length === 0) alive[entry.i] = false
  }

  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < branches.length; i += 1) {
      if (!alive[i]) continue
      const kids = childrenOf(i)
      if (kids.length !== 1) continue
      const child = branches[kids[0]!]!
      // The child repeats the fork point its parent already ends on.
      branches[i]!.points.push(...child.points.slice(1))
      branches[i]!.radii.push(...child.radii.slice(1))
      for (const grandchild of childrenOf(kids[0]!)) {
        branches[grandchild]!.parent = i
      }
      alive[kids[0]!] = false
      changed = true
    }
  }

  const remap = new Map<number, number>()
  const kept: SkeletonBranch[] = []
  for (let i = 0; i < branches.length; i += 1) {
    if (!alive[i]) continue
    remap.set(i, kept.length)
    kept.push(branches[i]!)
  }
  for (const branch of kept) {
    branch.parent = branch.parent == null ? null : remap.get(branch.parent) ?? null
  }
  branches.length = 0
  branches.push(...kept)
}
