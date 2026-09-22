/**
 * Vanilla Java humanoid cubes (Java LayerDefinitions) plus extra mobs from
 * official Java models (EntityModelJson) / Mojang 1.21 cow·pig·mooshroom geos.
 * Units: 1 = 1 pixel. Y-up, entity faces +Z. UV is Minecraft texOffs.
 *
 * Humanoids match Java HumanoidModel / SkeletonModel / PiglinModel. Extra mobs
 * are no longer Bedrock prismarine dumps (those used 64-wide UVs on Java PNGs):
 * - zombie/husk: 64×64 sheet, 64×32 texOffs (left limbs mirror the right)
 * - skeleton family: 2×12×2 limbs, 64×32
 * - piglin family: 10-wide head, snout, ears, 64×64
 * - zombie villager: 10-tall head, 6-deep body, robe
 */

import { VANILLA_EXTRA_ENTITIES } from './vanillaExtraEntities'
import { ENTITY_MODEL_ALIASES, prepareCatalogEntityModel } from './entityCatalogFixes'

export type FaceName = 'east' | 'west' | 'up' | 'down' | 'south' | 'north'

export type FaceUv = {
  uv: [number, number]
  uvSize: [number, number]
}

export type BoneXform = {
  pivot: [number, number, number]
  rotation: [number, number, number]
}

export type EntityCube = {
  origin: [number, number, number]
  size: [number, number, number]
  uv: [number, number] | Partial<Record<FaceName, FaceUv>>
  /** Pixel unwrap size (unscaled). Babies keep the adult sheet mapping. */
  uvSize?: [number, number, number]
  inflate?: number
  mirror?: boolean
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  /** Extra rest-pose rotations (bone bind pose / setup animation). */
  parents?: BoneXform[]
  /** Poseable bone id (head, right_arm, …). Overlays share the inner cube’s name. */
  name?: string
  /** Pose FK parent bone (`head` → `body`). */
  poseParent?: string
}

export type VanillaHumanoid = {
  id: string
  textureSize: [number, number]
  cubes: EntityCube[]
}

const ZOMBIE_ARMS: [number, number, number] = [80, 0, 0]
const HEAD_PIVOT: [number, number, number] = [0, 24, 0]
const BODY_PIVOT: [number, number, number] = [0, 24, 0]
const RIGHT_ARM_PIVOT: [number, number, number] = [-5, 22, 0]
const LEFT_ARM_PIVOT: [number, number, number] = [5, 22, 0]
const RIGHT_LEG_PIVOT: [number, number, number] = [-1.9, 12, 0]
const LEFT_LEG_PIVOT: [number, number, number] = [1.9, 12, 0]

function named(name: string, cube: Omit<EntityCube, 'name'>): EntityCube {
  const poseParent =
    cube.poseParent
    ?? (name === 'head' || /(?:^|_)arm$/.test(name) || name === 'arms'
      ? 'body'
      : name === 'hat' || name === 'snout' || name === 'nose' || /tusk|ear/.test(name)
        ? 'head'
        : undefined)
  return { ...cube, name, ...(poseParent ? { poseParent } : {}) }
}

function zombieLike(id: string): VanillaHumanoid {
  return {
    id,
    // Java LayerDefinition is 64×64; texOffs still live in the top 32 rows.
    textureSize: [64, 64],
    cubes: [
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], pivot: HEAD_PIVOT }),
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5, pivot: HEAD_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: BODY_PIVOT }),
      named('right_arm', {
        origin: [-8, 12, -2],
        size: [4, 12, 4],
        uv: [40, 16],
        pivot: RIGHT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('left_arm', {
        origin: [4, 12, -2],
        size: [4, 12, 4],
        uv: [40, 16],
        mirror: true,
        pivot: LEFT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('right_leg', { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16], pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 16], mirror: true, pivot: LEFT_LEG_PIVOT }),
    ],
  }
}

function skeletonLike(id: string): VanillaHumanoid {
  return {
    id,
    textureSize: [64, 32],
    cubes: [
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], pivot: HEAD_PIVOT }),
      // Bundled skeleton sheets are 64×32 (no second layer). A 64×64 hat UV
      // (32,0) would sample empty pixels beside the skull and float a ghost shell.
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: BODY_PIVOT }),
      named('right_arm', { origin: [-6, 12, -1], size: [2, 12, 2], uv: [40, 16], pivot: RIGHT_ARM_PIVOT }),
      named('left_arm', { origin: [4, 12, -1], size: [2, 12, 2], uv: [40, 16], mirror: true, pivot: LEFT_ARM_PIVOT }),
      named('right_leg', { origin: [-3, 0, -1], size: [2, 12, 2], uv: [0, 16], pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [1, 0, -1], size: [2, 12, 2], uv: [0, 16], mirror: true, pivot: LEFT_LEG_PIVOT }),
    ],
  }
}

function playerLike(id: string, slim: boolean): VanillaHumanoid {
  const armW = slim ? 3 : 4
  const rightArmOrigin: [number, number, number] = slim ? [-7, 12, -2] : [-8, 12, -2]
  return {
    id,
    textureSize: [64, 64],
    cubes: [
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], pivot: HEAD_PIVOT }),
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5, pivot: HEAD_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: BODY_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25, pivot: BODY_PIVOT }),
      named('right_arm', { origin: rightArmOrigin, size: [armW, 12, 4], uv: [40, 16], pivot: RIGHT_ARM_PIVOT }),
      named('right_arm', { origin: rightArmOrigin, size: [armW, 12, 4], uv: [40, 32], inflate: 0.25, pivot: RIGHT_ARM_PIVOT }),
      named('left_arm', { origin: [4, 12, -2], size: [armW, 12, 4], uv: [32, 48], pivot: LEFT_ARM_PIVOT }),
      named('left_arm', { origin: [4, 12, -2], size: [armW, 12, 4], uv: [48, 48], inflate: 0.25, pivot: LEFT_ARM_PIVOT }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16], pivot: RIGHT_LEG_PIVOT }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25, pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48], pivot: LEFT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25, pivot: LEFT_LEG_PIVOT }),
    ],
  }
}

function piglinLike(id: string): VanillaHumanoid {
  return {
    id,
    textureSize: [64, 64],
    cubes: [
      named('head', { origin: [-5, 24, -4], size: [10, 8, 8], uv: [0, 0], inflate: -0.02, pivot: HEAD_PIVOT }),
      named('snout', { origin: [-2, 24, -5], size: [4, 4, 1], uv: [31, 1], pivot: HEAD_PIVOT }),
      named('right_tusk', { origin: [2, 24, -5], size: [1, 2, 1], uv: [2, 4], pivot: HEAD_PIVOT }),
      named('left_tusk', { origin: [-3, 24, -5], size: [1, 2, 1], uv: [2, 0], pivot: HEAD_PIVOT }),
      named('right_ear', {
        origin: [4, 25, -2],
        size: [1, 5, 4],
        uv: [51, 6],
        pivot: [5, 30, 0],
        rotation: [0, 0, -30],
      }),
      named('left_ear', {
        origin: [-5, 25, -2],
        size: [1, 5, 4],
        uv: [39, 6],
        pivot: [-5, 30, 0],
        rotation: [0, 0, 30],
      }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: BODY_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25, pivot: BODY_PIVOT }),
      named('right_arm', { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16], pivot: RIGHT_ARM_PIVOT }),
      named('right_arm', { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 32], inflate: 0.25, pivot: RIGHT_ARM_PIVOT }),
      named('left_arm', { origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48], pivot: LEFT_ARM_PIVOT }),
      named('left_arm', { origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25, pivot: LEFT_ARM_PIVOT }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16], pivot: RIGHT_LEG_PIVOT }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25, pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48], pivot: LEFT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25, pivot: LEFT_LEG_PIVOT }),
    ],
  }
}

export const VANILLA_HUMANOIDS: Record<string, VanillaHumanoid> = {
  steve: playerLike('steve', false),
  alex: playerLike('alex', true),
  zombie: zombieLike('zombie'),
  husk: zombieLike('husk'),
  drowned: {
    id: 'drowned',
    textureSize: [64, 64],
    cubes: [
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], pivot: HEAD_PIVOT }),
      named('head', { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5, pivot: HEAD_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: BODY_PIVOT }),
      named('body', { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25, pivot: BODY_PIVOT }),
      named('right_arm', {
        origin: [-8, 12, -2],
        size: [4, 12, 4],
        uv: [40, 16],
        pivot: RIGHT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('right_arm', {
        origin: [-8, 12, -2],
        size: [4, 12, 4],
        uv: [40, 32],
        inflate: 0.25,
        pivot: RIGHT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('left_arm', {
        origin: [4, 12, -2],
        size: [4, 12, 4],
        uv: [32, 48],
        pivot: LEFT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('left_arm', {
        origin: [4, 12, -2],
        size: [4, 12, 4],
        uv: [48, 48],
        inflate: 0.25,
        pivot: LEFT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16], pivot: RIGHT_LEG_PIVOT }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25, pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48], pivot: LEFT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25, pivot: LEFT_LEG_PIVOT }),
    ],
  },
  zombie_villager: {
    id: 'zombie_villager',
    textureSize: [64, 64],
    // Matches Java ZombieVillagerModel / EntityModelJson 1.19+ (arms texOffs 44,22).
    cubes: [
      named('head', { origin: [-4, 24, -4], size: [8, 10, 8], uv: [0, 0], pivot: HEAD_PIVOT }),
      named('nose', { origin: [-1, 23, -6], size: [2, 4, 2], uv: [24, 0], pivot: HEAD_PIVOT }),
      named('hat', { origin: [-4, 24, -4], size: [8, 10, 8], uv: [32, 0], inflate: 0.5, pivot: HEAD_PIVOT }),
      named('body', { origin: [-4, 12, -3], size: [8, 12, 6], uv: [16, 20], pivot: BODY_PIVOT }),
      named('body', { origin: [-4, 12, -3], size: [8, 20, 6], uv: [0, 38], inflate: 0.05, pivot: BODY_PIVOT }),
      named('right_arm', {
        origin: [-8, 12, -2],
        size: [4, 12, 4],
        uv: [44, 22],
        pivot: RIGHT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('left_arm', {
        origin: [4, 12, -2],
        size: [4, 12, 4],
        uv: [44, 22],
        mirror: true,
        pivot: LEFT_ARM_PIVOT,
        rotation: ZOMBIE_ARMS,
      }),
      named('right_leg', { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 22], pivot: RIGHT_LEG_PIVOT }),
      named('left_leg', { origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 22], mirror: true, pivot: LEFT_LEG_PIVOT }),
    ],
  },
  skeleton: skeletonLike('skeleton'),
  stray: skeletonLike('stray'),
  wither_skeleton: skeletonLike('wither_skeleton'),
  piglin: piglinLike('piglin'),
  piglin_brute: piglinLike('piglin_brute'),
  zombified_piglin: piglinLike('zombified_piglin'),
}

export function scaleHumanoid(model: VanillaHumanoid, id: string, scale: number): VanillaHumanoid {
  const s = scale
  return {
    id,
    textureSize: model.textureSize,
    cubes: model.cubes.map((cube) => ({
      ...cube,
      origin: [cube.origin[0] * s, cube.origin[1] * s, cube.origin[2] * s],
      size: [cube.size[0] * s, cube.size[1] * s, cube.size[2] * s],
      uvSize: cube.uvSize ?? cube.size,
      inflate: cube.inflate != null ? cube.inflate * s : undefined,
      pivot: cube.pivot
        ? [cube.pivot[0] * s, cube.pivot[1] * s, cube.pivot[2] * s]
        : undefined,
      parents: cube.parents?.map((step) => ({
        pivot: [step.pivot[0] * s, step.pivot[1] * s, step.pivot[2] * s],
        rotation: step.rotation,
      })),
      poseParent: cube.poseParent,
    })),
  }
}

function extraCubesToEntity(raw: (typeof VANILLA_EXTRA_ENTITIES)[string]): EntityCube[] {
  const cubes = raw.cubes.map((cube) => ({
    origin: cube.origin,
    size: cube.size,
    uv: cube.uv as EntityCube['uv'],
    inflate: cube.inflate,
    mirror: cube.mirror,
    pivot: cube.pivot,
    rotation: cube.rotation,
    parents: cube.parents,
    name: cube.name,
    poseParent: cube.poseParent,
  }))
  const named = cubes.some((cube) => cube.name) ? cubes : inferExtraCubeNames(cubes)
  return refineHeadAccessories(named)
}

function cubeVolumeOf(cube: EntityCube) {
  return Math.abs(cube.size[0] * cube.size[1] * cube.size[2])
}

/** Dumps often label snout / ears / nose as `head`. Split them so overlay
 * detection and thumbs can tell the skull from the extras. */
function refineHeadAccessories(cubes: EntityCube[]): EntityCube[] {
  const heads = cubes
    .map((cube, index) => ({ cube, index }))
    .filter(({ cube }) => (cube.name ?? '').toLowerCase() === 'head')
  if (heads.length < 2) return cubes
  const primary = [...heads].sort((a, b) => cubeVolumeOf(b.cube) - cubeVolumeOf(a.cube))[0]!
  const used = new Set(
    cubes
      .map((cube) => (cube.name ?? '').toLowerCase())
      .filter((name) => name && name !== 'head'),
  )
  const unique = (base: string) => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let n = 2
    while (used.has(`${base}_${n}`)) n += 1
    const id = `${base}_${n}`
    used.add(id)
    return id
  }
  return cubes.map((cube, index) => {
    if (index === primary.index) return cube
    if ((cube.name ?? '').toLowerCase() !== 'head') return cube
    const name = accessoryNameFor(cube, primary.cube)
    if (!name) return cube
    return {
      ...cube,
      name: unique(name),
      poseParent: cube.poseParent ?? 'head',
      pivot: cube.pivot ?? primary.cube.pivot ?? primary.cube.origin,
    }
  })
}

function accessoryNameFor(cube: EntityCube, primary: EntityCube): string | null {
  const [sx, sy, sz] = cube.size
  if ((cube.inflate ?? 0) > 0.05) return null
  if (cubeVolumeOf(cube) >= cubeVolumeOf(primary) * 0.45) return null
  const onTop = cube.origin[1] + sy >= primary.origin[1] + primary.size[1] - 1.25
  const inFront = cube.origin[2] <= primary.origin[2] + 0.75
  const left = cube.origin[0] + sx / 2 < primary.origin[0] + primary.size[0] / 2
  if (onTop && sz <= 1.51 && sy <= 3.5 && sx <= 3.5) return left ? 'left_ear' : 'right_ear'
  if (sx <= 1.51 && sy >= 2 && sz >= 2) return left ? 'left_ear' : 'right_ear'
  if (inFront && sz <= 1.51 && sx >= 1.5 && sy >= 1.5) return 'snout'
  if (inFront && sx <= 2.5 && sz <= 2.5 && sy >= 2) return 'nose'
  if (sx <= 1.5 && sz <= 1.5 && sy >= 2) return left ? 'left_horn' : 'right_horn'
  if (inFront) return 'snout'
  return null
}

/** Name unnamed Bedrock dumps so posing has a body/head/legs/tail tree. */
function inferExtraCubeNames(cubes: EntityCube[]): EntityCube[] {
  const scored = cubes.map((cube, index) => {
    const [sx, sy, sz] = cube.size
    const vol = Math.abs(sx * sy * sz)
    return {
      cube,
      index,
      vol,
      top: cube.origin[1] + sy,
      foot: cube.origin[1],
      sx,
      sy,
      sz,
    }
  })
  if (scored.length === 0) return cubes
  const out = cubes.map((cube) => ({ ...cube }))
  const used = new Set<number>()
  const maxTop = Math.max(...scored.map((entry) => entry.top))
  const head = scored
    .filter((entry) => entry.top >= maxTop - 2)
    .sort((a, b) => b.vol - a.vol)[0]
  if (head) {
    out[head.index] = {
      ...out[head.index]!,
      name: 'head',
      poseParent: 'body',
    }
    used.add(head.index)
    for (const entry of scored) {
      if (used.has(entry.index) || entry.vol >= head.vol * 0.4) continue
      const nearHead =
        Math.abs(entry.cube.origin[1] - head.cube.origin[1]) < 8
        && Math.abs(entry.cube.origin[2] - head.cube.origin[2]) < 8
      if (!nearHead) continue
      out[entry.index] = {
        ...out[entry.index]!,
        name: 'head',
        poseParent: 'body',
        pivot: out[head.index]!.pivot ?? out[head.index]!.origin,
      }
      used.add(entry.index)
    }
  }
  const body = scored
    .filter((entry) => !used.has(entry.index))
    .sort((a, b) => b.vol - a.vol)[0]
  if (body) {
    out[body.index] = { ...out[body.index]!, name: 'body' }
    used.add(body.index)
  }
  const minFoot = Math.min(...scored.map((entry) => entry.foot))
  let legIndex = 0
  for (const entry of scored) {
    if (used.has(entry.index)) continue
    if (entry.foot > minFoot + 1.5) continue
    if (entry.sy < entry.sx * 0.8 || entry.sy < entry.sz * 0.8) continue
    out[entry.index] = {
      ...out[entry.index]!,
      name: `leg_${legIndex}`,
      poseParent: 'body',
    }
    legIndex += 1
    used.add(entry.index)
  }
  for (const entry of scored) {
    if (used.has(entry.index)) continue
    if (!entry.cube.rotation) continue
    out[entry.index] = {
      ...out[entry.index]!,
      name: 'tail',
      poseParent: 'body',
    }
    used.add(entry.index)
  }
  return out
}

function extraToHumanoid(raw: (typeof VANILLA_EXTRA_ENTITIES)[string]): VanillaHumanoid {
  let cubes = extraCubesToEntity(raw)
  if (raw.id === 'donkey' || raw.id === 'horse') {
    cubes = cubes.filter((cube) => !/baby/.test(cube.name ?? ''))
  }
  if (raw.id === 'donkey') {
    cubes = cubes.filter((cube) => !/(^|_)(chest|saddle|bridle|reins|bit)(_|$)/.test(cube.name ?? ''))
  }
  return {
    id: raw.id,
    textureSize: raw.textureSize,
    cubes,
  }
}

export function extraEntityModel(id: string): VanillaHumanoid | null {
  const extra = VANILLA_EXTRA_ENTITIES[id]
  return extra ? extraToHumanoid(extra) : null
}

/** True when `baby_*` has its own geo (not a 0.5× adult mesh). */
export function hasDedicatedBabyMesh(catalogId: string): boolean {
  if (VANILLA_EXTRA_ENTITIES[catalogId]) return true
  if (catalogId.startsWith('baby_villager')) return Boolean(VANILLA_EXTRA_ENTITIES.baby_villager)
  const alias = ENTITY_MODEL_ALIASES[catalogId]
  return Boolean(alias && VANILLA_EXTRA_ENTITIES[alias])
}

export function humanoidModelFor(id: string): VanillaHumanoid | null {
  const baseId = ENTITY_MODEL_ALIASES[id] ?? id
  const model = rawHumanoidModel(baseId)
  if (!model) return null
  return prepareCatalogEntityModel(model, id)
}

function rawHumanoidModel(id: string): VanillaHumanoid | null {
  // Biome / profession catalog ids share the nitwit meshes (adult or 26.1 baby).
  if (id.startsWith('baby_villager')) {
    const extra = VANILLA_EXTRA_ENTITIES.baby_villager
    return extra ? extraToHumanoid(extra) : null
  }
  if (id.startsWith('villager_')) {
    const base = rawHumanoidModel('villager')
    return base
  }
  const local = VANILLA_HUMANOIDS[id]
  if (local) return local
  const extra = VANILLA_EXTRA_ENTITIES[id]
  if (extra) return extraToHumanoid(extra)
  if (id.startsWith('baby_')) {
    const dedicated = VANILLA_EXTRA_ENTITIES[id]
    if (dedicated) return extraToHumanoid(dedicated)
    const adult = rawHumanoidModel(id.slice('baby_'.length))
    return adult ? scaleHumanoid(adult, id, 0.5) : null
  }
  return null
}

export function verifyAllHumanoidModels(ids: string[]): { id: string; cubes: number; ok: boolean }[] {
  return ids.map((id) => {
    const model = VANILLA_HUMANOIDS[id]
    return { id, cubes: model?.cubes.length ?? 0, ok: Boolean(model && model.cubes.length >= 7) }
  })
}
