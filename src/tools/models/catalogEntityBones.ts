/**
 * Authoritative bone naming + FK for Minecraft catalog entities.
 *
 * Matches Java ModelPart / Mine-imator: one bone id per model part, parent chain
 * from exported poseParent (Java LayerDefinitions) or known Java renderer trees
 * for flat Bedrock geos (wolf, etc.). Preview posing nests THREE groups on this
 * tree instead of spatial heuristics (inferCatalogPoseParents / disambiguateCubeName).
 */

import { catalogFkParents } from './entityCatalogFixes'
import type { EntityCube, VanillaHumanoid } from './vanillaHumanoids'

/** Steve / zombie-style hip pivot — only true humanoids, not villager/snow golem arms. */
const HIP_LINE_BIPED_IDS = new Set([
  'steve',
  'alex',
  'zombie',
  'husk',
  'drowned',
  'zombie_villager',
  'skeleton',
  'stray',
  'wither_skeleton',
  'piglin',
  'piglin_brute',
  'zombified_piglin',
  'baby_zombie',
  'baby_husk',
  'baby_drowned',
  'baby_zombie_villager',
  'baby_piglin',
  'baby_zombified_piglin',
])

export function sanitizeBoneId(raw: string): string {
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return snake || 'part'
}

/** OBJ / pose bone id for a catalog cube (overlays keep a separate shell name). */
export function catalogBoneId(model: VanillaHumanoid, cubeIndex: number): string {
  const cube = model.cubes[cubeIndex]!
  if (!cube.name) return `${sanitizeBoneId(model.id)}_${cubeIndex}`
  const base = sanitizeBoneId(cube.name)
  const inflate = cube.inflate ?? 0
  const innerSameBox = model.cubes.some(
    (other, j) =>
      j !== cubeIndex
      && (other.inflate ?? 0) <= 1e-4
      && similarBox(other, cube),
  )
  // Inset duplicate second layers (player-style). Enderman's jaw keeps its own
  // bone — it must not be stripped on convert or parented as a hat overlay.
  // Sheep fur (`*_wool`) is a real outer shell with its own atlas — not overlay.
  if (inflate <= -0.25 && innerSameBox && base !== 'jaw' && !base.endsWith('_wool')) {
    return `${base}_overlay`
  }
  if (inflate >= 0.45 && !base.endsWith('_wool')) return `${base}_overlay`
  // Hat / jacket second layers share the inner bone name but export as overlay shells.
  // Baby geos often shift the overlay origin by ~0.1px (inflate 0.25) — still a hat.
  const isSecondLayer =
    inflate > 1e-4
    && !base.endsWith('_wool')
    && model.cubes.some(
      (other, j) =>
        j !== cubeIndex
        && sanitizeBoneId(other.name ?? '') === base
        && (other.inflate ?? 0) <= 1e-4
        && similarBox(other, cube),
    )
  if (isSecondLayer) return `${base}_overlay`
  return base
}

function similarBox(a: EntityCube, b: EntityCube, originEps = 0.51): boolean {
  return (
    Math.abs(a.origin[0] - b.origin[0]) < originEps
    && Math.abs(a.origin[1] - b.origin[1]) < originEps
    && Math.abs(a.origin[2] - b.origin[2]) < originEps
    && Math.abs(a.size[0] - b.size[0]) < 0.26
    && Math.abs(a.size[1] - b.size[1]) < 0.26
    && Math.abs(a.size[2] - b.size[2]) < 0.26
  )
}

/** Steve / zombie-style bipeds — body “Hips” pivot sits at the hip line, not the bone pivot. */
export function isBipedHumanoidModel(model: VanillaHumanoid): boolean {
  if (HIP_LINE_BIPED_IDS.has(model.id)) return true
  if (model.id.startsWith('baby_')) {
    const adult = model.id.slice('baby_'.length)
    if (HIP_LINE_BIPED_IDS.has(adult)) return true
  }
  return false
}

function isQuadrupedModel(boneIds: Set<string>): boolean {
  if (boneIds.has('leg0') || boneIds.has('leg1')) return true
  return [...boneIds].some((name) => /_(front|hind)_leg$/.test(name))
}

/**
 * Java renderer parent bones for flat Bedrock geos (no bone.parent in JSON).
 * Matches WolfModel / quadruped LayerDefinitions: torso root, limbs + neck on body.
 */
const VANILLA_BONE_PARENTS: Record<string, Record<string, string>> = {
  wolf: {
    head: 'body',
    upper_body: 'body',
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
  baby_wolf: {
    head: 'body',
    upper_body: 'body',
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
}

function assignParent(
  parents: Record<string, string>,
  present: Set<string>,
  child: string,
  parent: string,
) {
  if (!present.has(child) || !present.has(parent) || child === parent) return
  if (parents[child]) return
  const seen = new Set<string>([child])
  let walk: string | undefined = parent
  while (walk) {
    if (seen.has(walk)) return
    seen.add(walk)
    walk = parents[walk]
  }
  parents[child] = parent
}

/** Collect poseParent authored on catalog cubes (Java walk / Bedrock when present). */
export function authoredCatalogPoseParents(model: VanillaHumanoid): Record<string, string> {
  const parents: Record<string, string> = {}
  for (let i = 0; i < model.cubes.length; i += 1) {
    const child = catalogBoneId(model, i)
    const raw = model.cubes[i]?.poseParent
    if (!raw) continue
    const parent = sanitizeBoneId(raw)
    if (parent && parent !== child) parents[child] = parent
  }
  return parents
}

/**
 * Full FK tree for a catalog entity: authored data + known Java trees + safe defaults.
 * Used instead of inferCatalogPoseParents for entityModelToPart.
 */
export function buildCatalogPoseParents(
  model: VanillaHumanoid,
  objectNames: string[],
): Record<string, string> {
  const present = new Set(
    objectNames.filter((name) => name && !name.endsWith('_overlay')),
  )
  const parents: Record<string, string> = { ...authoredCatalogPoseParents(model) }

  for (const [child, parent] of Object.entries(VANILLA_BONE_PARENTS[model.id] ?? {})) {
    assignParent(parents, present, child, parent)
  }
  for (const [child, parent] of Object.entries(catalogFkParents(model.id) ?? {})) {
    assignParent(parents, present, child, parent)
  }

  assignParent(parents, present, 'hat', 'head')
  // Enderman jaw is independent of the head lift (angry mouth).
  assignParent(parents, present, 'jaw', 'body')

  if (present.has('body')) {
    if (isQuadrupedModel(present)) {
      // Wing tips / leg tips / feet before the broad /wing/ → body rule, or tips
      // get parented to the torso and stop following the limb in the pose UI.
      for (const name of present) {
        const wingTip = name.match(/^(.*_wing)_tip$/)
        if (wingTip?.[1] && present.has(wingTip[1])) {
          assignParent(parents, present, name, wingTip[1])
          continue
        }
        const legTip = name.match(/^(.*_leg)_tip$/)
        if (legTip?.[1] && present.has(legTip[1])) {
          assignParent(parents, present, name, legTip[1])
          continue
        }
        const foot = name.match(/^(.*)_foot$/)
        if (foot?.[1]) {
          const tip = `${foot[1]}_leg_tip`
          const leg = `${foot[1]}_leg`
          if (present.has(tip)) assignParent(parents, present, name, tip)
          else if (present.has(leg)) assignParent(parents, present, name, leg)
        }
      }
      for (const name of present) {
        if (name === 'body') continue
        // Do not parent head — child pivot rarely equals the body attachment point
        // and rest-pose FK gaps the mesh (wolf, cat, pig torsos).
        if (
          name === 'upper_body'
          || /^leg[0-3]$/.test(name)
          || name === 'tail'
          || /^(left|right)_wing$/.test(name)
          || /_(front|hind)_leg$/.test(name)
        ) {
          assignParent(parents, present, name, 'body')
        }
      }
    } else if (isBipedHumanoidModel(model)) {
      for (const name of present) {
        if (name === 'body') continue
        if (
          /^(head|hat|hood|jacket|arms)$/.test(name)
          || /(?:^|_)(arm|wing)(?:_|$)/.test(name)
          || /(^|_)arm$/.test(name)
          || /wing/.test(name)
          || /tail/.test(name)
        ) {
          assignParent(parents, present, name, name === 'hat' && present.has('head') ? 'head' : 'body')
        }
      }
      const bipedArms = [...present].some((name) => /arm/.test(name))
      if (!bipedArms) {
        for (const name of present) {
          if (/leg|paw|foot|hoof/.test(name)) assignParent(parents, present, name, 'body')
        }
      }
    }
  }

  for (const name of present) {
    if (/ear|snout|nose|beak|horn|mole/.test(name)) {
      assignParent(parents, present, name, present.has('head') ? 'head' : 'body')
    }
  }

  // Hat stack / witch nose chain from Java export (poseParent on cubes).
  for (const name of present) {
    if (/^hat[0-9]/.test(name) || name === 'hat_rim' || name === 'hat_overlay') {
      assignParent(parents, present, name, 'head')
    }
  }
  assignParent(parents, present, 'pumpkin', 'head')

  return parents
}

/** Representative cube for pivot lookup when several cubes share one bone. */
export function representativeCubeForBone(
  model: VanillaHumanoid,
  boneId: string,
): EntityCube | null {
  let fallback: EntityCube | null = null
  for (let i = 0; i < model.cubes.length; i += 1) {
    if (catalogBoneId(model, i) !== boneId) continue
    const cube = model.cubes[i]!
    if (cube.pivot) return cube
    fallback ??= cube
  }
  return fallback
}
