/**
 * Per-object inspection and filtering for Wavefront OBJ.
 *
 * Models downloaded as "a car" or "a chair" are often a whole render scene: the
 * subject plus a studio backdrop, sun planes and light cards, all exported into
 * one file. Those props dwarf the subject and get voxelised along with it, so
 * this module lists what's actually in a file, guesses which objects are set
 * dressing, and can rewrite the OBJ with them removed.
 */

export type ObjSceneObject = {
  name: string
  /** `v` lines declared while this object was current. */
  vertexCount: number
  /** `f` records belonging to this object — actual surface geometry. */
  faceCount: number
  /** `l` polyline records, which have no surface to voxelise. */
  lineCount: number
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
  /** Bounding box diagonal — a scale-independent "how big is this" number. */
  diagonal: number
  materials: string[]
}

/** Object name used when an OBJ declares no `o` / `g` groups. */
export const OBJ_UNNAMED_OBJECT = 'default'

/**
 * Words that mark an object as lighting or set dressing rather than the model.
 *
 * The lookarounds carry the weight here. A keyword has to start a name or
 * segment, so `headlight`, `Brake_light` and `Sunroof` stay part of the car;
 * `Studio_Lights` is still caught because `studio` matches on its own. It may
 * only run into a separator, never more letters.
 */
const PROP_WORD =
  /(?<![a-z0-9_])(area_?lights?|key_?lights?|fill_?lights?|a?lights?|lamps?|sun|studio|back_?drops?|cyclorama|softbox(?:es)?|reflectors?|hdri|shadow_?catchers?|(?:ground|floor)_?planes?)(?![a-z])/i

/** An object this much bigger than the typical one is probably scenery. */
const PROP_SIZE_RATIO = 6
/** …but only if it holds almost none of the file's actual geometry. */
const PROP_FACE_SHARE = 0.05
/** Share of faces that defines the model proper, for locating the main cluster. */
const CORE_FACE_COVERAGE = 0.9
/** Objects below this share of faces can be judged on position alone. */
const STRAY_FACE_SHARE = 0.005
/** Slack around the main cluster before something counts as detached. */
const STRAY_MARGIN = 0.05

function forEachLine(text: string, fn: (line: string) => void): void {
  let start = 0
  const length = text.length
  while (start < length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = length
    let stop = end
    if (stop > start && text.charCodeAt(stop - 1) === 13) stop -= 1
    fn(text.slice(start, stop))
    start = end + 1
  }
}

function decode(objBytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(objBytes)
}

/** Leading keyword of an OBJ line, or '' for blanks and comments. */
function keyword(line: string): string {
  let i = 0
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1
  if (i >= line.length || line[i] === '#') return ''
  let j = i
  while (j < line.length && line[j] !== ' ' && line[j] !== '\t') j += 1
  return line.slice(i, j)
}

function rest(line: string, after: string): string {
  return line.trim().slice(after.length).trim()
}

/** Resolve an OBJ index, which is 1-based and may count back from the end. */
function resolveIndex(raw: number, declared: number): number {
  if (!Number.isFinite(raw) || raw === 0) return -1
  return raw > 0 ? raw - 1 : declared + raw
}

/**
 * List every `o` / `g` object with its size, geometry share and materials.
 * OBJ requires vertices to be declared before the faces that use them, so a
 * single pass is enough to attribute geometry to the object that owns it.
 */
export function scanObjSceneObjects(objBytes: Uint8Array): ObjSceneObject[] {
  const text = decode(objBytes)
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []

  type Acc = {
    name: string
    vertexCount: number
    faceCount: number
    lineCount: number
    min: [number, number, number]
    max: [number, number, number]
    materials: Set<string>
  }
  const order: Acc[] = []
  const byName = new Map<string, Acc>()

  const open = (name: string): Acc => {
    const existing = byName.get(name)
    if (existing) return existing
    const acc: Acc = {
      name,
      vertexCount: 0,
      faceCount: 0,
      lineCount: 0,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      materials: new Set<string>(),
    }
    byName.set(name, acc)
    order.push(acc)
    return acc
  }

  let current = open(OBJ_UNNAMED_OBJECT)
  const expand = (acc: Acc, index: number) => {
    if (index < 0 || index >= xs.length) return
    const p = [xs[index]!, ys[index]!, zs[index]!]
    for (let a = 0; a < 3; a += 1) {
      if (p[a]! < acc.min[a]!) acc.min[a] = p[a]!
      if (p[a]! > acc.max[a]!) acc.max[a] = p[a]!
    }
  }

  forEachLine(text, (line) => {
    const key = keyword(line)
    if (key === 'o' || key === 'g') {
      current = open(rest(line, key) || OBJ_UNNAMED_OBJECT)
    } else if (key === 'v') {
      const p = line.trim().split(/\s+/)
      xs.push(Number(p[1]) || 0)
      ys.push(Number(p[2]) || 0)
      zs.push(Number(p[3]) || 0)
      current.vertexCount += 1
    } else if (key === 'usemtl') {
      const name = rest(line, key)
      if (name) current.materials.add(name)
    } else if (key === 'f' || key === 'l') {
      if (key === 'f') current.faceCount += 1
      else current.lineCount += 1
      const tokens = line.trim().split(/\s+/)
      for (let t = 1; t < tokens.length; t += 1) {
        const slash = tokens[t]!.indexOf('/')
        const head = slash < 0 ? tokens[t]! : tokens[t]!.slice(0, slash)
        expand(current, resolveIndex(Number(head), xs.length))
      }
    }
  })

  const out: ObjSceneObject[] = []
  for (const acc of order) {
    if (acc.vertexCount === 0 && acc.faceCount === 0 && acc.lineCount === 0) continue
    // An object with no faces (a curve, say) still has its declared vertices.
    const hasBounds = acc.min[0]! <= acc.max[0]!
    const min: [number, number, number] = hasBounds ? acc.min : [0, 0, 0]
    const max: [number, number, number] = hasBounds ? acc.max : [0, 0, 0]
    const size: [number, number, number] = [
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    ]
    out.push({
      name: acc.name,
      vertexCount: acc.vertexCount,
      faceCount: acc.faceCount,
      lineCount: acc.lineCount,
      min,
      max,
      size,
      diagonal: Math.hypot(size[0], size[1], size[2]),
      materials: [...acc.materials],
    })
  }
  return out
}

function looksLikeProp(object: ObjSceneObject): boolean {
  if (PROP_WORD.test(object.name)) return true
  return object.materials.some((material) => PROP_WORD.test(material))
}

/** Bounds of the objects that carry most of the geometry — the model proper. */
function coreBounds(
  objects: ObjSceneObject[],
): { min: number[]; max: number[]; size: number[] } | null {
  const solid = objects
    .filter((o) => o.faceCount > 0)
    .sort((a, b) => b.faceCount - a.faceCount)
  const total = solid.reduce((sum, o) => sum + o.faceCount, 0)
  if (total <= 0) return null

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let covered = 0
  for (const object of solid) {
    if (covered >= total * CORE_FACE_COVERAGE) break
    covered += object.faceCount
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a]!, object.min[a]!)
      max[a] = Math.max(max[a]!, object.max[a]!)
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null
  return { min, max, size: max.map((h, a) => h - min[a]!) }
}

/** True when an object sits clear of the main cluster on some axis. */
function isDetached(
  object: ObjSceneObject,
  core: { min: number[]; max: number[]; size: number[] },
): boolean {
  for (let a = 0; a < 3; a += 1) {
    const margin = Math.max(core.size[a]! * STRAY_MARGIN, 1e-6)
    if (object.max[a]! < core.min[a]! - margin) return true
    if (object.min[a]! > core.max[a]! + margin) return true
  }
  return false
}

/**
 * Guess which objects are scenery rather than the model.
 *
 * Named lights and backdrops are taken at their word. Beyond that an object has
 * to be nearly empty of geometry before it can be flagged at all, and then be
 * either far larger than a typical object, made of curves with no surface, or
 * sitting clear of the main cluster. That combination separates a backdrop
 * wall, a bevel profile and a stray helper cube from a model that simply
 * happens to be big.
 */
export function suggestStudioProps(objects: ObjSceneObject[]): string[] {
  if (objects.length < 2) return []

  const totalFaces = objects.reduce((sum, o) => sum + o.faceCount, 0)
  const diagonals = objects
    .map((o) => o.diagonal)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  const median = diagonals[Math.floor(diagonals.length / 2)] ?? 0
  const core = coreBounds(objects)

  const flagged = objects.filter((object) => {
    if (looksLikeProp(object)) return true
    if (totalFaces <= 0) return false
    // Curves and paths carry no surface, so they voxelise to nothing while
    // still stretching the box the model gets fitted into.
    if (object.faceCount === 0) return true
    const share = object.faceCount / totalFaces
    if (share >= PROP_FACE_SHARE) return false
    if (median > 0 && object.diagonal > median * PROP_SIZE_RATIO) return true
    return share < STRAY_FACE_SHARE && core != null && isDetached(object, core)
  })

  // Refuse to empty the file — if everything looks like a prop, nothing is.
  if (flagged.length >= objects.length) return []
  const keptFaces = objects
    .filter((o) => !flagged.includes(o))
    .reduce((sum, o) => sum + o.faceCount, 0)
  if (keptFaces === 0) return []

  return flagged.map((o) => o.name)
}

/**
 * Rewrite an OBJ without the named objects.
 *
 * Vertex indices are file-global, so dropping objects means dropping the
 * vertices only they referenced and renumbering everything that survives.
 */
export function filterObjObjects(
  objBytes: Uint8Array,
  excluded: readonly string[],
): Uint8Array {
  const drop = new Set(excluded)
  if (drop.size === 0) return objBytes

  const text = decode(objBytes)

  // Pass one: find the vertices, texcoords and normals the survivors still use.
  let vCount = 0
  let vtCount = 0
  let vnCount = 0
  let keeping = !drop.has(OBJ_UNNAMED_OBJECT)
  const usedV: number[] = []
  const usedVt: number[] = []
  const usedVn: number[] = []

  forEachLine(text, (line) => {
    const key = keyword(line)
    if (key === 'o' || key === 'g') {
      keeping = !drop.has(rest(line, key) || OBJ_UNNAMED_OBJECT)
    } else if (key === 'v') {
      vCount += 1
    } else if (key === 'vt') {
      vtCount += 1
    } else if (key === 'vn') {
      vnCount += 1
    } else if (keeping && (key === 'f' || key === 'l')) {
      const tokens = line.trim().split(/\s+/)
      for (let t = 1; t < tokens.length; t += 1) {
        const parts = tokens[t]!.split('/')
        const vi = resolveIndex(Number(parts[0]), vCount)
        if (vi >= 0) usedV.push(vi)
        if (parts[1]) {
          const ti = resolveIndex(Number(parts[1]), vtCount)
          if (ti >= 0) usedVt.push(ti)
        }
        if (parts[2]) {
          const ni = resolveIndex(Number(parts[2]), vnCount)
          if (ni >= 0) usedVn.push(ni)
        }
      }
    }
  })

  const mark = (indices: number[], total: number): Uint8Array => {
    const flags = new Uint8Array(total)
    for (const i of indices) if (i < total) flags[i] = 1
    return flags
  }
  const keepV = mark(usedV, vCount)
  const keepVt = mark(usedVt, vtCount)
  const keepVn = mark(usedVn, vnCount)

  const remapOf = (flags: Uint8Array): Int32Array => {
    const remap = new Int32Array(flags.length).fill(-1)
    let next = 0
    for (let i = 0; i < flags.length; i += 1) if (flags[i]) remap[i] = ++next
    return remap
  }
  const remapV = remapOf(keepV)
  const remapVt = remapOf(keepVt)
  const remapVn = remapOf(keepVn)

  // Pass two: emit the survivors with renumbered references.
  const chunks: string[] = []
  let pending: string[] = []
  const emit = (line: string) => {
    pending.push(line)
    if (pending.length >= 4096) {
      chunks.push(pending.join('\n'))
      pending = []
    }
  }

  let vSeen = 0
  let vtSeen = 0
  let vnSeen = 0
  keeping = !drop.has(OBJ_UNNAMED_OBJECT)

  forEachLine(text, (line) => {
    const key = keyword(line)
    if (key === '') {
      if (keeping) emit(line)
      return
    }
    if (key === 'o' || key === 'g') {
      keeping = !drop.has(rest(line, key) || OBJ_UNNAMED_OBJECT)
      if (keeping) emit(line)
      return
    }
    if (key === 'v' || key === 'vt' || key === 'vn') {
      const index = key === 'v' ? vSeen++ : key === 'vt' ? vtSeen++ : vnSeen++
      const flags = key === 'v' ? keepV : key === 'vt' ? keepVt : keepVn
      if (flags[index]) emit(line)
      return
    }
    if (!keeping) return
    if (key !== 'f' && key !== 'l') {
      emit(line)
      return
    }
    const tokens = line.trim().split(/\s+/)
    const out: string[] = [key]
    for (let t = 1; t < tokens.length; t += 1) {
      const parts = tokens[t]!.split('/')
      const vi = remapV[resolveIndex(Number(parts[0]), vSeen)] ?? -1
      if (vi < 0) return
      if (parts.length === 1) {
        out.push(String(vi))
        continue
      }
      const ti = parts[1] ? remapVt[resolveIndex(Number(parts[1]), vtSeen)] ?? -1 : -1
      const ni = parts[2] ? remapVn[resolveIndex(Number(parts[2]), vnSeen)] ?? -1 : -1
      if (parts.length === 2) out.push(ti > 0 ? `${vi}/${ti}` : String(vi))
      else out.push(`${vi}/${ti > 0 ? ti : ''}/${ni > 0 ? ni : ''}`)
    }
    emit(out.join(' '))
  })

  if (pending.length > 0) chunks.push(pending.join('\n'))
  return new TextEncoder().encode(`${chunks.join('\n')}\n`)
}

const scanCache = new WeakMap<Uint8Array, ObjSceneObject[]>()

/** Cached `scanObjSceneObjects`. */
export function objSceneObjects(objBytes: Uint8Array): ObjSceneObject[] {
  if (objBytes.length < 64) return []
  const cached = scanCache.get(objBytes)
  if (cached) return cached
  const scanned = scanObjSceneObjects(objBytes)
  scanCache.set(objBytes, scanned)
  return scanned
}

const suggestCache = new WeakMap<Uint8Array, string[]>()

/** Cached studio-prop guess for a file. */
export function suggestedStudioProps(objBytes: Uint8Array): string[] {
  if (objBytes.length < 64) return []
  const cached = suggestCache.get(objBytes)
  if (cached) return cached
  const suggested = suggestStudioProps(objSceneObjects(objBytes))
  suggestCache.set(objBytes, suggested)
  return suggested
}

/**
 * Which objects to leave out: the user's explicit choice if they have made one,
 * otherwise the automatic guess.
 */
export function resolveExcludedObjects(
  objBytes: Uint8Array,
  explicit: readonly string[] | null | undefined,
): readonly string[] {
  if (objBytes.length < 64) return []
  return explicit ?? suggestedStudioProps(objBytes)
}

/** The OBJ as the user wants it: source bytes minus any excluded objects. */
export function objGeometryBytes(
  objBytes: Uint8Array,
  explicit: readonly string[] | null | undefined,
): Uint8Array {
  const excluded = resolveExcludedObjects(objBytes, explicit)
  return excluded.length > 0 ? objBytesWithoutObjects(objBytes, excluded) : objBytes
}

const filterCache = new WeakMap<Uint8Array, Map<string, Uint8Array>>()

/** Cached `filterObjObjects` — rewriting a large OBJ is not cheap. */
export function objBytesWithoutObjects(
  objBytes: Uint8Array,
  excluded: readonly string[],
): Uint8Array {
  if (excluded.length === 0) return objBytes
  const signature = [...excluded].sort().join('\u0000')
  let bySignature = filterCache.get(objBytes)
  if (!bySignature) {
    bySignature = new Map()
    filterCache.set(objBytes, bySignature)
  }
  const cached = bySignature.get(signature)
  if (cached) return cached
  const filtered = filterObjObjects(objBytes, excluded)
  bySignature.set(signature, filtered)
  return filtered
}
