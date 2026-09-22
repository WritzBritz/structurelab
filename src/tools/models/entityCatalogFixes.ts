/**
 * Runtime corrections for catalog entity models: Java render scale, rest-pose
 * bone rotations missing from flat LayerDefinition dumps, FK trees for Bedrock
 * geos, slime size variants, and snow golem pumpkin head.
 */
import type { EntityCube, FaceName, VanillaHumanoid } from './vanillaHumanoids'
import { scaleHumanoid } from './vanillaHumanoids'

/** Java EntityRenderer scale factors (model space ≠ statue blocks). */
export const ENTITY_DISPLAY_SCALE: Record<string, number> = {
  ghast: 4,
  happy_ghast: 1,
  happy_ghastling: 0.5,
  baby_ghast: 0.5,
  cave_spider: 0.7,
  slime_small: 1,
  slime: 2,
  slime_large: 4,
  magma_cube_small: 1,
  magma_cube: 2,
  magma_cube_large: 4,
  // Java EntityRenderer.scale — model pixels are not the in-game size.
  bat: 0.35,
  bee: 0.4,
  endermite: 0.3,
  silverfish: 0.4,
  vex: 0.4,
  guardian: 0.5,
  // ElderGuardianRenderer replaces the 0.5 guardian scale with 2.35.
  elder_guardian: 2.35,
  rabbit: 0.6,
  parrot: 0.9,
}

/** Map catalog id → base geometry id when they share a mesh. */
export const ENTITY_MODEL_ALIASES: Record<string, string> = {
  slime_small: 'slime',
  slime_large: 'slime',
  magma_cube_small: 'magma_cube',
  magma_cube_large: 'magma_cube',
  elder_guardian: 'guardian',
  glow_squid: 'squid',
  happy_ghastling: 'happy_ghast',
  baby_ghast: 'happy_ghast',
  snow_golem_pumpkin: 'snow_golem',
  /** Same mesh; angry pose raises the head while the jaw stays (vanilla creepy). */
  enderman_angry: 'enderman',
  /** 26.1 ocelot cub uses the cat baby geo; ocelot_baby.png is a 32×32 cub sheet. */
  baby_ocelot: 'baby_cat',
  ...Object.fromEntries(
    [
      'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
      'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
    ].map((color) => [`shulker_${color}`, 'shulker']),
  ),
}

/**
 * Java EndermanModel.setupAnim when `angry`/`creepy`: head.y -= 5 after the jaw
 * (`hat`) has copied the head transform — so only the head lifts and the mouth
 * gap opens. Mekanism and the wiki describe this as the raised-head / open-mouth
 * angry look. Our +Y is up, so the catalog pose uses +5 on head.
 */
export const ENDERMAN_ANGRY_HEAD_LIFT = 5

/** Java SpiderModel rest PartPose (deg). Pivots matched by bone name from 1.21 export. */
const SPIDER_LEG_REST_ROT: Record<string, [number, number, number]> = {
  right_front_leg: [0, 45, -45],
  right_hind_leg: [0, 45, 45],
  right_middle_front_leg: [0, -33.3, -33.3],
  right_middle_hind_leg: [0, -33.3, 33.3],
  left_front_leg: [0, -45, 45],
  left_hind_leg: [0, -45, -45],
  left_middle_front_leg: [0, 33.3, 33.3],
  left_middle_hind_leg: [0, 33.3, -33.3],
}

/** FK overrides — legs/tails only; never head/torso siblings (pivot mismatch gaps mesh). */
const CATALOG_FK: Record<string, Record<string, string>> = {
  wolf: {
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
  baby_wolf: {
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
  pig: {
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
  },
  baby_pig: {
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
  },
  ender_dragon: {
    left_wing_tip: 'left_wing',
    right_wing_tip: 'right_wing',
    left_front_leg_tip: 'left_front_leg',
    right_front_leg_tip: 'right_front_leg',
    left_hind_leg_tip: 'left_hind_leg',
    right_hind_leg_tip: 'right_hind_leg',
    left_front_foot: 'left_front_leg_tip',
    right_front_foot: 'right_front_leg_tip',
    left_hind_foot: 'left_hind_leg_tip',
    right_hind_foot: 'right_hind_leg_tip',
  },
  rabbit: {
    nose: 'head',
    left_ear: 'head',
    right_ear: 'head',
    left_haunch: 'body',
    right_haunch: 'body',
    left_hind_foot: 'left_haunch',
    right_hind_foot: 'right_haunch',
    left_front_leg: 'body',
    right_front_leg: 'body',
    tail: 'body',
  },
  llama: {
    left_chest: 'body',
    right_chest: 'body',
  },
}

export function entityDisplayScale(id: string): number {
  return ENTITY_DISPLAY_SCALE[id] ?? 1
}

export function catalogFkParents(modelId: string): Record<string, string> | undefined {
  return CATALOG_FK[modelId]
}

function cloneCube(cube: EntityCube): EntityCube {
  return {
    ...cube,
    origin: [...cube.origin] as [number, number, number],
    size: [...cube.size] as [number, number, number],
    uv: Array.isArray(cube.uv) ? ([...cube.uv] as [number, number]) : { ...cube.uv },
    uvSize: cube.uvSize ? ([...cube.uvSize] as [number, number, number]) : undefined,
    pivot: cube.pivot ? ([...cube.pivot] as [number, number, number]) : undefined,
    rotation: cube.rotation ? ([...cube.rotation] as [number, number, number]) : undefined,
    parents: cube.parents?.map((step) => ({
      pivot: [...step.pivot] as [number, number, number],
      rotation: [...step.rotation] as [number, number, number],
    })),
    poseParent: cube.poseParent,
  }
}

function patchSpiderLegs(cubes: EntityCube[]): EntityCube[] {
  return cubes.map((cube) => {
    const rot = SPIDER_LEG_REST_ROT[cube.name ?? '']
    if (!rot || !cube.pivot) return cube
    const out = cloneCube(cube)
    out.rotation = rot
    return out
  })
}

function patchSlime(cubes: EntityCube[]): EntityCube[] {
  return cubes.map((cube) => {
    const out = cloneCube(cube)
    if (out.name === 'cube') {
      out.name = 'body'
      out.poseParent = undefined
    }
    if (out.name === 'right_eye' || out.name === 'left_eye' || out.name === 'mouth') {
      out.poseParent = 'body'
    }
    return out
  })
}

/**
 * Vanilla Enderman `hat` is the jaw (inset head box, UV 0,16) — not a hat shell.
 * Keep it as a poseable `jaw` bone so convert retains the mouth and angry posing
 * can lift the head independently (Java copies hat from head, then offsets head).
 */
function patchEnderman(model: VanillaHumanoid, angry: boolean): VanillaHumanoid {
  const cubes = model.cubes.map((cube) => {
    const out = cloneCube(cube)
    if (out.name === 'hat') {
      out.name = 'jaw'
      // Jaw stays put when the head lifts (vanilla copies hat, then offsets head).
      out.poseParent = 'body'
    }
    // Bake the creepy/angry head lift into geometry so convert size matches the
    // open mouth (skinPose + Fit was squashing the taller mesh → black wool).
    if (angry && out.name === 'head') {
      out.origin = [out.origin[0], out.origin[1] + ENDERMAN_ANGRY_HEAD_LIFT, out.origin[2]]
      if (out.pivot) {
        out.pivot = [out.pivot[0], out.pivot[1] + ENDERMAN_ANGRY_HEAD_LIFT, out.pivot[2]]
      }
    }
    // Vanilla still overlaps head/jaw by ~3px after the +5 lift. In-game meshes
    // read as an open mouth; at 1:1 voxels that overlap seals the cleft shut and
    // convert looks like one solid head. Keep only the hanging mandible so a
    // clear gap remains under the lifted head.
    if (angry && out.name === 'jaw') {
      const [sx, sy, sz] = out.size
      out.uvSize = out.uvSize ?? [sx, sy, sz]
      const mouthGap = 1
      const hang = Math.max(2, ENDERMAN_ANGRY_HEAD_LIFT - mouthGap)
      out.size = [sx, hang, sz]
    }
    return out
  })
  return { ...model, cubes }
}

function patchSnowGolemPumpkin(model: VanillaHumanoid): VanillaHumanoid {
  // Java 1.21+ SnowGolemHeadLayer (client bytecode):
  //   head.translateAndRotate → translate(0, -0.34375) → scale(0.625, -0.625, -0.625)
  //   → translate(-0.5) → render carved_pumpkin block
  // 16×0.625 = 10px. LivingEntityRenderer scale(-1 Y) means head ModelPart
  // pivot is the visual head *bottom* (our y=20); local −Y is up, so −0.34375
  // lifts the block centre by 5.5px → centre y=25.5 (spans 20.5–30.5).
  const cubes = model.cubes.map(cloneCube)
  cubes.push({
    name: 'pumpkin',
    origin: [-5, 20.5, -5],
    size: [10, 10, 10],
    uv: [0, 0],
    uvSize: [16, 16, 16],
    pivot: [0, 20, 0],
    poseParent: 'head',
  })
  return { ...model, id: 'snow_golem_pumpkin', cubes }
}

/**
 * Java SheepFurLayer — inflated copy of the sheep mesh with sheep_wool.png.
 * Without this, catalog convert is sheared-only.
 */
function patchSheepWool(model: VanillaHumanoid): VanillaHumanoid {
  const wool: EntityCube[] = []
  for (const cube of model.cubes) {
    const base = cube.name
    if (!base || /wool/i.test(base)) continue
    const out = cloneCube(cube)
    out.name = `${base}_wool`
    out.inflate = (cube.inflate ?? 0) + 0.5
    out.poseParent = base
    // Keep adult UV unwrap if the body was scaled (baby sheep).
    out.uvSize = cube.uvSize ?? cube.size
    wool.push(out)
  }
  return { ...model, cubes: [...model.cubes.map(cloneCube), ...wool] }
}

/**
 * Adult pig body cubes store Bedrock `rotation: [90, 0, 0]` with no cube pivot.
 * The dump used the body bone pivot `[0, 0, 0]`, which orbits the torso off the
 * legs. Missing cube pivot is the cube centre (Blockbench default), and the
 * baker sign is already −90 — that lays the 16-long axis between the legs.
 */
function patchPig(cubes: EntityCube[]): EntityCube[] {
  return cubes.map((cube) => {
    if (cube.name !== 'body' || !cube.rotation) return cube
    const pivot = cube.pivot
    if (!pivot || pivot[0] !== 0 || pivot[1] !== 0 || pivot[2] !== 0) return cube
    const out = cloneCube(cube)
    out.pivot = [
      out.origin[0] + out.size[0] / 2,
      out.origin[1] + out.size[1] / 2,
      out.origin[2] + out.size[2] / 2,
    ]
    return out
  })
}

/** Bundled rabbit_*.png is 64×64 with a 6×6 head island at (32,0) instead of
 * the Java 64×32 box unwrap (north at 37,5). Map every head face onto that. */
function patchRabbitHead(model: VanillaHumanoid): VanillaHumanoid {
  return {
    ...model,
    cubes: model.cubes.map((cube) => {
      if ((cube.name ?? '').toLowerCase() !== 'head' || !Array.isArray(cube.uv)) return cube
      if (cube.uv[0] !== 32 || cube.uv[1] !== 0) return cube
      const out = cloneCube(cube)
      out.uv = {
        north: { uv: [32, 1], uvSize: [5, 4] },
        south: { uv: [32, 1], uvSize: [5, 4] },
        east: { uv: [36, 1], uvSize: [1, 4] },
        west: { uv: [32, 1], uvSize: [1, 4] },
        up: { uv: [32, 0], uvSize: [5, 1] },
        down: { uv: [32, 0], uvSize: [5, 1] },
      }
      return out
    }),
  }
}

/**
 * Java 1.21.4 `LavaSlimeModel` (MC-225367) rebuilt magma UVs on a true 64×64
 * sheet. Our dump is still the pre-fix 64×32 LayerDefinition — remap every
 * segment + the core to the current atlas. Size variants only scale the mesh;
 * do not thicken the 1px crust bands (that overlaps slices and looks solid).
 *
 * Segment texOffs from createBodyLayer:
 *   i=0..3 → (0, 9*i); i=4..7 → (32, 9*i - 36); inside → (24, 40)
 */
const MAGMA_CUBE_UV_1_21_4: Record<string, [number, number]> = {
  cube0: [0, 0],
  cube1: [0, 9],
  cube2: [0, 18],
  cube3: [0, 27],
  cube4: [32, 0],
  cube5: [32, 9],
  cube6: [32, 18],
  cube7: [32, 27],
  inside_cube: [24, 40],
}

function patchMagmaCube(model: VanillaHumanoid): VanillaHumanoid {
  const cubes = model.cubes.map((cube) => {
    const out = cloneCube(cube)
    const uv = cube.name ? MAGMA_CUBE_UV_1_21_4[cube.name] : undefined
    if (uv && Array.isArray(out.uv)) out.uv = [...uv]
    // Rest-pose segments should not inherit the dump's y=24 orbit pivot.
    if (out.name?.startsWith('cube') || out.name === 'inside_cube') {
      out.pivot = undefined
      out.rotation = undefined
      out.parents = undefined
      out.poseParent = undefined
    }
    return out
  })
  return { ...model, textureSize: [64, 64], cubes }
}

/**
 * Bedrock `cat.geo.json` stores the torso upright; the game pitches it −90° in
 * animation setup (Java ocelot LayerDefinition bakes that rest pose). Bake the
 * body pitch and push it onto every body-parented cube so limbs/head follow.
 * Baby cat uses `belly` for the same bone.
 */
function patchCat(model: VanillaHumanoid): VanillaHumanoid {
  const cubes = model.cubes.map(cloneCube)
  const body = cubes.find((cube) => cube.name === 'body' || cube.name === 'belly')
  if (!body?.pivot) return model
  if (!body.rotation) body.rotation = [-90, 0, 0]
  const bodyStep = {
    pivot: [...body.pivot] as [number, number, number],
    rotation: [...(body.rotation ?? [-90, 0, 0])] as [number, number, number],
  }
  const bodyName = body.name ?? 'body'
  for (const cube of cubes) {
    if (cube.name === bodyName) continue
    const parent = cube.poseParent
    if (!parent) continue
    // Direct body/belly children + nested tail2 → tail1 → body.
    if (parent !== bodyName && parent !== 'tail1') continue
    const already = cube.parents?.some(
      (step) =>
        Math.abs(step.rotation[0] - bodyStep.rotation[0]) < 1e-3
        && step.pivot[0] === bodyStep.pivot[0]
        && step.pivot[1] === bodyStep.pivot[1]
        && step.pivot[2] === bodyStep.pivot[2],
    )
    if (already) continue
    cube.parents = [bodyStep, ...(cube.parents ?? [])]
    if (!cube.pivot) cube.pivot = [...body.pivot] as [number, number, number]
  }
  return { ...model, cubes }
}

/**
 * Llama chests are body children in Java. Flat dumps leave them unparented while
 * the body is pitched −90°, so the packs sit wrong / detached.
 */
function patchLlama(model: VanillaHumanoid): VanillaHumanoid {
  const cubes = model.cubes.map(cloneCube)
  const body = cubes.find((cube) => cube.name === 'body')
  if (!body?.pivot || !body.rotation) return { ...model, cubes }
  const bodyStep = {
    pivot: [...body.pivot] as [number, number, number],
    rotation: [...body.rotation] as [number, number, number],
  }
  for (const cube of cubes) {
    if (cube.name !== 'left_chest' && cube.name !== 'right_chest') continue
    cube.poseParent = 'body'
    const already = cube.parents?.some(
      (step) =>
        step.pivot[0] === bodyStep.pivot[0]
        && step.pivot[1] === bodyStep.pivot[1]
        && step.pivot[2] === bodyStep.pivot[2],
    )
    if (!already) {
      cube.parents = [bodyStep, ...(cube.parents ?? [])]
    }
  }
  return { ...model, cubes }
}

/**
 * Java goats hide `left_horn` / `right_horn` for babies (same adult mesh +
 * BABY_TRANSFORMER ×0.5). Our earlier filter wrongly dropped the 3×2×1 ears and
 * kept the 2×7×2 horns. Strip horns by bone name; keep ears + goatee plane.
 */
function patchBabyGoat(model: VanillaHumanoid): VanillaHumanoid {
  const cubes = model.cubes
    .filter((cube) => cube.name !== 'left_horn' && cube.name !== 'right_horn')
    .map(cloneCube)
  return { ...model, cubes }
}

/**
 * LayerDefinition stores one neck cube at the origin and no tail. Vanilla
 * ModelDragon.render / EnderDragonModel.setupAnim copies that cube into 5 neck
 * parts and 12 tail parts, then folds the legs. Latency offsets of 0 is the
 * straight flying rest: neck steps 10px toward −Z from (0, 20, −12), tail
 * steps 10px toward +Z from (0, 10, 60) with a 180° yaw so the same cube
 * walks backward. Wings use the raised mid-flight pose from EnderDragonModel
 * (flap π/6 — tips slightly folded, not hanging under the body).
 */
function patchEnderDragon(model: VanillaHumanoid): VanillaHumanoid {
  const cubes = model.cubes.map(cloneCube)
  const neckBits = cubes.filter((cube) => cube.name === 'neck')
  if (neckBits.length === 0) return { ...model, cubes }

  const chain = dragonSegmentChain()
  const placed = chain.flatMap((segment) => {
    if (segment.name === 'head') return []
    return neckBits.map((template) => placeJavaBone(template, segment.pos, segment.rot, segment.name))
  })
  const headDelta = javaBoneDelta(chain.find((segment) => segment.name === 'head')?.pos ?? [0, 0, 0])

  const pivots = new Map<string, [number, number, number]>()
  for (const cube of cubes) {
    if (cube.name && cube.pivot && !pivots.has(cube.name)) pivots.set(cube.name, [...cube.pivot])
  }

  const rest = cubes
    .filter((cube) => cube.name !== 'neck')
    .map((cube) => {
      const named = cube.name ?? ''
      if (named === 'head' || named === 'jaw') return translateCube(cube, headDelta)
      return poseDragonLimb(thickenMembrane(cube), pivots)
    })
  return { ...model, cubes: [...rest, ...placed] }
}

type DragonSegment = {
  name: string
  pos: [number, number, number]
  rot: [number, number, number]
}

/** Java Y-down positions and radians from ModelDragon.render with zero latency. */
function dragonSegmentChain(): DragonSegment[] {
  const out: DragonSegment[] = []
  let y = 20
  let z = -12
  let x = 0
  for (let i = 0; i < 5; i += 1) {
    const xRot = Math.cos(i * 0.45) * 0.15
    out.push({ name: i === 0 ? 'neck' : `neck${i}`, pos: [x, y, z], rot: [xRot, 0, 0] })
    y += Math.sin(xRot) * 10
    z -= Math.cos(xRot) * 10
  }
  out.push({ name: 'head', pos: [x, y, z], rot: [0, 0, 0] })

  y = 10
  z = 60
  x = 0
  let tailPitch = 0
  for (let i = 0; i < 12; i += 1) {
    tailPitch += Math.sin(i * 0.45) * 0.05
    // +180° yaw walks the neck cube toward +Z (same step formula as the neck).
    out.push({ name: `tail${i}`, pos: [x, y, z], rot: [tailPitch, Math.PI, 0] })
    y += Math.sin(tailPitch) * 10
    z -= Math.cos(Math.PI) * Math.cos(tailPitch) * 10
  }
  return out
}

function javaBoneDelta(javaPos: [number, number, number]): [number, number, number] {
  return [javaPos[0], -javaPos[1], javaPos[2]]
}

function catalogFromJavaRot(rot: [number, number, number]): [number, number, number] {
  // Match extract-java-entity-models javaBakerRotation for X/Y, but Z is also
  // negated: Java +zRot raises the right wing (−X), while our rotateAround Z
  // would otherwise drop it.
  const deg = 180 / Math.PI
  return [-rot[0] * deg, -rot[1] * deg, -rot[2] * deg]
}

function placeJavaBone(
  template: EntityCube,
  javaPos: [number, number, number],
  javaRot: [number, number, number],
  name: string,
): EntityCube {
  const out = translateCube(template, javaBoneDelta(javaPos))
  out.name = name
  out.rotation = catalogFromJavaRot(javaRot)
  out.parents = undefined
  out.poseParent = undefined
  return out
}

const DRAGON_LEG_X = {
  front: 1.3,
  frontTip: -0.5,
  frontFoot: 0.75,
  hind: 1.0,
  hindTip: 0.5,
  hindFoot: 0.75,
} as const

function poseDragonLimb(
  cube: EntityCube,
  pivots: Map<string, [number, number, number]>,
): EntityCube {
  const winged = poseDragonWing(cube, pivots)
  if (winged) return winged

  const name = cube.name ?? ''
  const front = name.includes('front_')
  const hind = name.includes('hind_')
  if (!name.startsWith('left_') && !name.startsWith('right_')) return cube
  const kind = name.endsWith('_foot') ? 'foot' : name.endsWith('_leg_tip') ? 'tip' : name.endsWith('_leg') ? 'leg' : null
  if (!kind || (!front && !hind)) return cube

  const prefix = name.startsWith('left_') ? 'left_' : 'right_'
  const legName = `${prefix}${front ? 'front' : 'hind'}_leg`
  const tipName = `${prefix}${front ? 'front' : 'hind'}_leg_tip`
  const legRot = catalogFromJavaRot([front ? DRAGON_LEG_X.front : DRAGON_LEG_X.hind, 0, 0])
  const tipRot = catalogFromJavaRot([front ? DRAGON_LEG_X.frontTip : DRAGON_LEG_X.hindTip, 0, 0])
  const footRot = catalogFromJavaRot([front ? DRAGON_LEG_X.frontFoot : DRAGON_LEG_X.hindFoot, 0, 0])
  const legPivot = pivots.get(legName)
  const tipPivot = pivots.get(tipName)

  const out = cloneCube(cube)
  if (kind === 'leg') {
    out.poseParent = undefined
    out.rotation = legRot
    return out
  }
  if (kind === 'tip') {
    out.poseParent = legName
    out.rotation = tipRot
    if (legPivot) out.parents = [{ pivot: legPivot, rotation: legRot }]
    return out
  }
  out.poseParent = tipName
  out.rotation = footRot
  const parents = []
  if (tipPivot) parents.push({ pivot: tipPivot, rotation: tipRot })
  if (legPivot) parents.push({ pivot: legPivot, rotation: legRot })
  if (parents.length) out.parents = parents
  return out
}

function translateCube(cube: EntityCube, delta: [number, number, number]): EntityCube {
  const out = cloneCube(cube)
  out.origin = [out.origin[0] + delta[0], out.origin[1] + delta[1], out.origin[2] + delta[2]]
  if (out.pivot) {
    out.pivot = [out.pivot[0] + delta[0], out.pivot[1] + delta[1], out.pivot[2] + delta[2]]
  }
  return out
}

function thickenMembrane(cube: EntityCube): EntityCube {
  if (Math.abs(cube.size[1]) > 1e-4) return cube
  const out = cloneCube(cube)
  // Keep the plane unwrap (h=0) so only the skin faces get UVs; thicken in
  // model space so the membrane still stamps after the dragon is scaled to 256.
  out.uvSize = out.uvSize ?? [...cube.size]
  out.origin = [out.origin[0], out.origin[1] - 1, out.origin[2]]
  out.size = [out.size[0], 2, out.size[2]]
  return out
}

/**
 * Modern EnderDragonRenderer / EnderDragonModel.setupAnim (also mirrored in
 * DraconicGuardianRenderer): separate left/right parts, not GL X-scale.
 *
 *   left.xRot  = 0.125 - cos(flap)*0.2
 *   left.yRot  = -0.25
 *   left.zRot  = -(sin(flap)+0.125)*0.8
 *   leftTip.z  = (sin(flap+2)+0.5)*0.75
 *   right.*    = mirror yaw/roll of left
 *
 * Flap π/6 = raised sails with tips still slightly folded — flap-0 hangs the
 * tips under the body; π/2 stands the wings nearly vertical.
 */
function poseDragonWing(
  cube: EntityCube,
  pivots: Map<string, [number, number, number]>,
): EntityCube | null {
  const name = cube.name ?? ''
  const left = name.startsWith('left_wing')
  const right = name.startsWith('right_wing')
  if (!left && !right) return null

  const flap = Math.PI / 6
  const leftX = 0.125 - Math.cos(flap) * 0.2
  const leftY = -0.25
  const leftZ = -(Math.sin(flap) + 0.125) * 0.8
  const leftTipZ = (Math.sin(flap + 2) + 0.5) * 0.75
  const wingJava: [number, number, number] = left
    ? [leftX, leftY, leftZ]
    : [leftX, -leftY, -leftZ]
  const tipJava: [number, number, number] = [0, 0, left ? leftTipZ : -leftTipZ]
  const wingRot = catalogFromJavaRot(wingJava)
  const tipRot = catalogFromJavaRot(tipJava)

  const out = cloneCube(cube)
  // Keep tip → wing FK for the pose UI (rotating a wing must swing the tip).
  // Rest-pose bake uses `parents` / `rotation` below; clearing poseParent broke that.
  if (name === 'left_wing' || name === 'right_wing') {
    out.poseParent = undefined
    out.rotation = wingRot
    out.parents = undefined
    return out
  }
  out.poseParent = left ? 'left_wing' : 'right_wing'
  const shoulder = pivots.get(left ? 'left_wing' : 'right_wing')
  out.rotation = tipRot
  out.parents = shoulder ? [{ pivot: [...shoulder], rotation: [...wingRot] }] : undefined
  return out
}

function applyPoseParentOverrides(cubes: EntityCube[], parents: Record<string, string>): EntityCube[] {
  return cubes.map((cube) => {
    const bone = cube.name
    if (!bone) return cube
    const parent = parents[bone]
    if (!parent) return cube
    const out = cloneCube(cube)
    out.poseParent = parent
    return out
  })
}

function patchModel(model: VanillaHumanoid, catalogId: string): VanillaHumanoid {
  let out: VanillaHumanoid = { ...model, id: catalogId, cubes: model.cubes.map(cloneCube) }

  const baseId = ENTITY_MODEL_ALIASES[catalogId] ?? catalogId

  if (baseId === 'spider' || baseId === 'cave_spider') {
    out.cubes = patchSpiderLegs(out.cubes)
  }
  if (baseId === 'slime') {
    out.cubes = patchSlime(out.cubes)
  }
  if (catalogId === 'snow_golem_pumpkin') {
    out = patchSnowGolemPumpkin(out)
  }
  if (baseId === 'enderman') {
    out = patchEnderman(out, catalogId === 'enderman_angry')
  }
  if (baseId === 'sheep' || baseId === 'baby_sheep') {
    out = patchSheepWool(out)
  }
  if (baseId === 'pig') {
    out.cubes = patchPig(out.cubes)
  }
  if (baseId === 'magma_cube') {
    out = patchMagmaCube(out)
  }
  if (baseId === 'cat' || baseId === 'baby_cat' || catalogId === 'baby_cat' || catalogId === 'baby_ocelot') {
    out = patchCat(out)
  }
  if (baseId === 'llama') {
    out = patchLlama(out)
  }
  if (baseId === 'rabbit') {
    out = patchRabbitHead(out)
  }
  if (catalogId === 'baby_goat') {
    out = patchBabyGoat(out)
  }
  if (baseId === 'ender_dragon') {
    out = patchEnderDragon(out)
  }

  const fk = CATALOG_FK[catalogId] ?? CATALOG_FK[baseId]
  if (fk) {
    out.cubes = applyPoseParentOverrides(out.cubes, fk)
  }

  const scale = entityDisplayScale(catalogId)
  if (scale !== 1) {
    out = scaleHumanoid(out, catalogId, scale)
  }

  return out
}

/** Resolve catalog mob id to a display-ready VanillaHumanoid. */
export function prepareCatalogEntityModel(
  model: VanillaHumanoid,
  catalogId: string,
): VanillaHumanoid {
  const alias = ENTITY_MODEL_ALIASES[catalogId]
  const base = alias && model.id !== catalogId ? { ...model, id: alias } : model
  if (
    catalogId === model.id
    && !alias
    && entityDisplayScale(catalogId) === 1
    && !CATALOG_FK[catalogId]
    && catalogId !== 'snow_golem_pumpkin'
    && catalogId !== 'enderman'
    && catalogId !== 'sheep'
    && catalogId !== 'baby_sheep'
    && catalogId !== 'ender_dragon'
    && catalogId !== 'cat'
    && catalogId !== 'baby_cat'
    && catalogId !== 'baby_ocelot'
    && catalogId !== 'llama'
    && catalogId !== 'baby_llama'
    && catalogId !== 'baby_goat'
    && catalogId !== 'magma_cube'
    && catalogId !== 'magma_cube_small'
    && catalogId !== 'magma_cube_large'
    && catalogId !== 'rabbit'
    && catalogId !== 'baby_rabbit'
  ) {
    return model
  }
  return patchModel(base, catalogId)
}

/**
 * Vanilla orientable block face → PNG (carved_pumpkin.json parent orientable_with_bottom).
 * North is the carved front; after entity Z-flip it faces the preview camera (+Z).
 */
export function catalogBlockFaceTextures(
  catalogId: string,
  boneName: string,
): Partial<Record<FaceName, string>> | null {
  if (catalogId !== 'snow_golem_pumpkin' || boneName !== 'pumpkin') return null
  return {
    north: 'carved_pumpkin.png',
    south: 'pumpkin_side.png',
    east: 'pumpkin_side.png',
    west: 'pumpkin_side.png',
    up: 'pumpkin_top.png',
    down: 'pumpkin_top.png',
  }
}

/**
 * Java EyesLayer emissive overlay paths. Vanilla base sheets keep white (or red)
 * eye placeholders; the purple/red glow lives only on these second textures.
 */
const CATALOG_EYES_OVERLAY: Record<string, string> = {
  enderman: 'textures/entity/enderman/enderman_eyes.png',
  enderman_angry: 'textures/entity/enderman/enderman_eyes.png',
  // Bundled under spider/; flat textures/entity/spider_eyes.png is legacy-only.
  spider: 'textures/entity/spider/spider_eyes.png',
  cave_spider: 'textures/entity/spider/spider_eyes.png',
  phantom: 'textures/entity/phantom/phantom_eyes.png',
  ender_dragon: 'textures/entity/enderdragon/dragon_eyes.png',
}

/** EyesLayer PNG path for catalog mobs that need it composited into the base sheet. */
export function catalogEyesOverlayPath(catalogId: string): string | null {
  const base = ENTITY_MODEL_ALIASES[catalogId] ?? catalogId
  return CATALOG_EYES_OVERLAY[catalogId] ?? CATALOG_EYES_OVERLAY[base] ?? null
}

/**
 * Java outer / clothing layers (drowned moss, stray rags). Composited into the
 * base atlas; convert must also keep `*_overlay` shells so those UVs stamp.
 */
const CATALOG_OUTER_LAYER: Record<string, string> = {
  drowned: 'textures/entity/zombie/drowned_outer_layer.png',
  baby_drowned: 'textures/entity/zombie/drowned_outer_layer_baby.png',
  stray: 'textures/entity/skeleton/stray_overlay.png',
}

export function catalogOuterLayerPath(catalogId: string): string | null {
  return CATALOG_OUTER_LAYER[catalogId] ?? null
}

/** When true, convert keeps inflated second-layer shells (clothing / wool). */
export function catalogKeepConvertOverlays(catalogId: string): boolean {
  if (catalogOuterLayerPath(catalogId)) return true
  const base = ENTITY_MODEL_ALIASES[catalogId] ?? catalogId
  return base === 'sheep'
}

/** MTL slots for extra PNGs keyed by catalogExtraMaterials slot id. */
export function catalogExtraMaterials(catalogId: string): Record<string, string> {
  if (catalogId === 'snow_golem_pumpkin') {
    return {
      pumpkin_face: 'carved_pumpkin.png',
      pumpkin_side: 'pumpkin_side.png',
      pumpkin_top: 'pumpkin_top.png',
    }
  }
  const base = ENTITY_MODEL_ALIASES[catalogId] ?? catalogId
  if (base === 'sheep') {
    return {
      wool: catalogId.startsWith('baby_') ? 'sheep_wool_baby.png' : 'sheep_wool.png',
    }
  }
  return {}
}

/** Per-bone map_Kd override (sheep wool shells). */
export function catalogBoneTextureFile(catalogId: string, boneName: string): string | null {
  const base = ENTITY_MODEL_ALIASES[catalogId] ?? catalogId
  if (base === 'sheep' && /wool/i.test(boneName)) {
    return catalogExtraMaterials(catalogId).wool ?? 'sheep_wool.png'
  }
  return null
}

/** Per-slot PNG atlas size when it differs from the entity sheet (block textures are 16×16). */
export function catalogMaterialTextureSizes(catalogId: string): Record<string, [number, number]> {
  if (catalogId === 'snow_golem_pumpkin') {
    return {
      pumpkin_face: [16, 16],
      pumpkin_side: [16, 16],
      pumpkin_top: [16, 16],
    }
  }
  return {}
}

/** OBJ/MTL material name for a block PNG filename. */
export function blockTextureMaterialName(pngFile: string): string {
  return `block_${pngFile.replace(/\.png$/i, '').toLowerCase()}`
}
