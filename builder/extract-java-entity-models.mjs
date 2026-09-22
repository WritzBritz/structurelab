/**
 * Rebuild extra catalog cubes from official Java LayerDefinitions
 * (EntityModelJson vanilla_layers dump of vanilla client models) so UVs match
 * Java entity PNGs. Cow / pig / mooshroom use Mojang's 1.21+ Bedrock geo
 * (Java copied those models when the temperate variants shipped).
 */
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src/tools/models/vanillaExtraEntities.ts')

const EXTRA = [
  'creeper', 'enderman', 'villager', 'wandering_trader', 'witch', 'vindicator', 'pillager', 'evoker',
  'iron_golem', 'snow_golem', 'blaze', 'slime', 'magma_cube', 'spider', 'cave_spider', 'ghast',
  'cow', 'pig', 'sheep', 'chicken', 'wolf', 'hoglin', 'zoglin', 'bee', 'silverfish', 'endermite',
  'guardian', 'phantom', 'vex', 'ravager', 'bat', 'squid', 'wither', 'polar_bear', 'llama',
  'horse', 'donkey', 'rabbit', 'parrot', 'fox', 'panda', 'goat', 'turtle', 'strider', 'mooshroom',
  'cat', 'ocelot', 'dolphin', 'ender_dragon', 'shulker',
]

/** Java 1.21.5+ copied these Bedrock geos; 1.19 LayerDefinitions are the old 64×32 animals. */
const MOJANG_GEO = {
  cow: 'cow.v2.geo.json',
  pig: 'pig.v3.geo.json',
  mooshroom: 'mooshroom.v2.geo.json',
  wolf: 'wolf.geo.json',
  cat: 'cat.geo.json',
  vex: 'vex.geo.json',
  happy_ghast: 'happy_ghast.geo.json',
}

/** 26.1+ dedicated baby meshes (not a 0.5 adult scale). */
const MOJANG_BABY = {
  baby_wolf: 'baby_wolf.geo.json',
  baby_villager: 'baby_villager.geo.json',
  baby_donkey: 'baby_donkey_mule.geo.json',
  baby_cow: 'baby_cow.geo.json',
  baby_mooshroom: 'baby_cow.geo.json',
  baby_pig: 'baby_pig.geo.json',
  baby_chicken: 'baby_chicken.geo.json',
  baby_horse: 'baby_horse.geo.json',
  baby_cat: 'baby_cat.geo.json',
  baby_fox: 'baby_fox.geo.json',
  baby_sheep: 'baby_sheep.geo.json',
  baby_zombie: 'baby_zombie.geo.json',
  baby_husk: 'baby_zombie.geo.json',
  baby_drowned: 'baby_zombie.geo.json',
  baby_zombie_villager: 'baby_zombie_villager.geo.json',
  baby_piglin: 'baby_piglin.geo.json',
  baby_zombified_piglin: 'baby_piglin.geo.json',
  baby_hoglin: 'baby_hoglin.geo.json',
  baby_panda: 'baby_panda.geo.json',
  baby_llama: 'baby_llama.geo.json',
  baby_rabbit: 'baby_rabbit.geo.json',
  baby_turtle: 'baby_turtle.geo.json',
  baby_bee: 'baby_bee.geo.json',
  baby_polar_bear: 'baby_polar_bear.geo.json',
}

/** Horse v3 shared mule/donkey ears + packs; default donkey is unequipped. */
const DONKEY_SKIP = /^(EarL|EarR|ReinsL|ReinsR|Bridle|BitL|BitR|BagL|BagR|Saddle)$/i

/** Adult Java meshes hide unused baby_* bones; dedicated baby geos do not use that name. */
const SKIP_JAVA_BONE = /sleep|sleeping|baby|dead|sit|sitting/i
const SKIP_BONE = /sleep|sleeping|dead|sit|sitting/i

const JAVA_LAYER =
  'https://raw.githubusercontent.com/SizableShrimp/EntityModelJson/1.19.x/vanilla_layers/main'
const MOJANG_GEO_BASE =
  'https://raw.githubusercontent.com/Mojang/bedrock-samples/preview/resource_pack/models/entity'

const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down']

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} → ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    }).on('error', reject)
  })
}

function round(n) {
  if (!Number.isFinite(n)) return 0
  if (Math.abs(n) < 1e-6) return 0
  return Math.round(n * 1000) / 1000
}

function roundVec(v) {
  return [round(v[0]), round(v[1]), round(v[2])]
}

function sanitizeBoneName(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function skipPoseParent(name) {
  return !name || SKIP_BONE.test(name) || /^(world|root)$/i.test(name)
}

function hasAngle(rot) {
  return Array.isArray(rot) && rot.some((value) => Math.abs(Number(value)) > 1e-4)
}

function toDeg(rad) {
  return (Number(rad) * 180) / Math.PI
}

/** Java x/y negated after the Y-up flip; +Z stays. Matches cow body −90°. */
function javaBakerRotation(pose) {
  return [
    round(-toDeg(pose.xRot || 0)),
    round(-toDeg(pose.yRot || 0)),
    round(toDeg(pose.zRot || 0)),
  ]
}

function toBakerRotation(rot) {
  if (!Array.isArray(rot)) return [0, 0, 0]
  return [round(-Number(rot[0] || 0)), round(-Number(rot[1] || 0)), round(-Number(rot[2] || 0))]
}

function packUv(uv) {
  if (Array.isArray(uv) && uv.length >= 2) return [round(uv[0]), round(uv[1])]
  if (!uv || typeof uv !== 'object') return null
  const faces = {}
  for (const name of FACE_NAMES) {
    const face = uv[name]
    if (!face || !Array.isArray(face.uv)) continue
    const size = face.uv_size ?? face.uvSize ?? [0, 0]
    faces[name] = { uv: [round(face.uv[0]), round(face.uv[1])], uvSize: [round(size[0]), round(size[1])] }
  }
  return Object.keys(faces).length ? faces : null
}

function growOf(cube) {
  const grow = cube.grow
  if (typeof grow === 'number') return grow
  if (grow && typeof grow === 'object') return grow.growX ?? grow.growY ?? 0
  return 0
}

function convertJavaLayer(json, id) {
  const root = json.mesh?.root
  if (!root) throw new Error(`no mesh.root in ${id}`)
  const cubes = []

  function walk(partName, part, javaX, javaY, javaZ, parentName, parentSteps) {
    const pose = part.partPose ?? {}
    const px = javaX + (pose.x || 0)
    const py = javaY + (pose.y || 0)
    const pz = javaZ + (pose.z || 0)
    const rot = javaBakerRotation(pose)
    const ownRot = hasAngle(rot)
    const yupPivot = roundVec([px, 24 - py, pz])
    const boneName = sanitizeBoneName(partName)
    const poseParent =
      parentName && !skipPoseParent(parentName) && sanitizeBoneName(parentName) !== boneName
        ? sanitizeBoneName(parentName)
        : undefined
    const mySteps = ownRot ? [...parentSteps, { pivot: yupPivot, rotation: rot }] : parentSteps

    for (const cube of part.cubes ?? []) {
      const size = cube.dimensions
      if (!size) continue
      const tex = cube.texCoord ?? {}
      const origin = roundVec([
        px + cube.origin[0],
        24 - py - cube.origin[1] - size[1],
        pz + cube.origin[2],
      ])
      const entry = {
        origin,
        size: roundVec(size),
        uv: [round(tex.u || 0), round(tex.v || 0)],
      }
      if (boneName && !skipPoseParent(partName)) entry.name = boneName
      if (poseParent) entry.poseParent = poseParent
      if (cube.mirror) entry.mirror = true
      const inflate = growOf(cube)
      if (Math.abs(inflate) >= 0.01) entry.inflate = round(inflate)
      if (ownRot) {
        entry.pivot = yupPivot
        entry.rotation = rot
        if (parentSteps.length) entry.parents = parentSteps
      } else if (parentSteps.length) {
        entry.pivot = yupPivot
        entry.parents = parentSteps
      } else if (!skipPoseParent(partName)) {
        entry.pivot = yupPivot
      }
      cubes.push(entry)
    }

    for (const [childName, child] of Object.entries(part.children ?? {})) {
      if (SKIP_JAVA_BONE.test(childName)) continue
      walk(childName, child, px, py, pz, partName, mySteps)
    }
  }

  for (const [name, child] of Object.entries(root.children ?? {})) {
    if (SKIP_JAVA_BONE.test(name)) continue
    walk(name, child, 0, 0, 0, undefined, [])
  }

  const material = json.material ?? {}
  return {
    id,
    textureSize: [material.xTexSize || 64, material.yTexSize || 32],
    cubes,
  }
}

function ancestorRotations(bone, byName) {
  const steps = []
  let current = bone.parent
  const seen = new Set()
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = byName.get(current)
    if (!parent) break
    const rot = parent.rotation ?? parent.bind_pose_rotation
    if (hasAngle(rot) && Array.isArray(parent.pivot)) {
      steps.unshift({ pivot: roundVec(parent.pivot), rotation: toBakerRotation(rot) })
    }
    current = parent.parent
  }
  return steps
}

/** Flat Bedrock geos omit bone.parent — match Java WolfModel / quadruped LayerDefinitions. */
const BEDROCK_BONE_PARENTS = {
  wolf: {
    head: 'body',
    upperBody: 'body',
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
  baby_wolf: {
    head: 'body',
    upperBody: 'body',
    leg0: 'body',
    leg1: 'body',
    leg2: 'body',
    leg3: 'body',
    tail: 'body',
  },
}

function convertBedrockGeo(json, id, extraSkip) {
  const geom = json['minecraft:geometry']?.[0]
  if (!geom) throw new Error(`no minecraft:geometry in ${id}`)
  const desc = geom.description ?? {}
  const bones = geom.bones ?? []
  const byName = new Map(bones.map((bone) => [bone.name, bone]))
  const cubes = []
  const skipExtra = extraSkip ?? /$^/

  function poseParentOf(bone) {
    let current = bone.parent
    const seen = new Set()
    while (current && !seen.has(current)) {
      seen.add(current)
      if (!skipPoseParent(current) && !skipExtra.test(current)) return sanitizeBoneName(current)
      current = byName.get(current)?.parent
    }
    const mapped = BEDROCK_BONE_PARENTS[id]?.[bone.name]
    if (mapped && !skipPoseParent(mapped)) return sanitizeBoneName(mapped)
    return undefined
  }

  for (const bone of bones) {
    if (SKIP_BONE.test(bone.name ?? '') || skipExtra.test(bone.name ?? '')) continue
    const boneName = sanitizeBoneName(bone.name)
    const skipName = skipPoseParent(bone.name)
    const parentName = poseParentOf(bone)
    const boneRot = bone.rotation ?? bone.bind_pose_rotation
    const ancestors = ancestorRotations(bone, byName)
    for (const cube of bone.cubes ?? []) {
      const uv = packUv(cube.uv)
      if (!uv) continue
      const entry = {
        origin: roundVec(cube.origin),
        size: roundVec(cube.size),
        uv,
      }
      if (boneName && !skipName) entry.name = boneName
      if (parentName && parentName !== boneName) entry.poseParent = parentName
      const inflate = Number(cube.inflate ?? cube.inflate ?? 0)
      if (Math.abs(inflate) >= 0.01) entry.inflate = round(inflate)
      if (cube.mirror || bone.mirror) entry.mirror = true
      const cubeRot = cube.rotation
      const boneStep = hasAngle(boneRot) && Array.isArray(bone.pivot)
        ? [{ pivot: roundVec(bone.pivot), rotation: toBakerRotation(boneRot) }]
        : []
      if (hasAngle(cubeRot)) {
        // Cube rotation without a cube pivot is around the cube centre
        // (Blockbench). Falling back to bone.pivot [0,0,0] orbits pig torsos off the legs.
        const cubePivot = cube.pivot ?? [
          Number(cube.origin?.[0] || 0) + Number(cube.size?.[0] || 0) / 2,
          Number(cube.origin?.[1] || 0) + Number(cube.size?.[1] || 0) / 2,
          Number(cube.origin?.[2] || 0) + Number(cube.size?.[2] || 0) / 2,
        ]
        entry.pivot = roundVec(cubePivot)
        entry.rotation = toBakerRotation(cubeRot)
        const parents = [...ancestors, ...boneStep]
        if (parents.length) entry.parents = parents
      } else if (boneStep.length) {
        entry.pivot = roundVec(bone.pivot)
        entry.rotation = boneStep[0].rotation
        if (ancestors.length) entry.parents = ancestors
      } else if (ancestors.length) {
        entry.pivot = roundVec(bone.pivot ?? [0, 0, 0])
        entry.parents = ancestors
      } else if (Array.isArray(bone.pivot) && !skipName) {
        entry.pivot = roundVec(bone.pivot)
      }
      cubes.push(entry)
    }
  }

  return {
    id,
    textureSize: [desc.texture_width || 64, desc.texture_height || 32],
    cubes,
  }
}

const HEADER = `/** Official vanilla cubes: Java LayerDefinitions (EntityModelJson 1.19 dump)
 * plus Mojang cow.v2 / pig.v3 / mooshroom.v2 geos for the 1.21.5 remodel.
 */
export type ExtraFaceUv = { uv: [number, number]; uvSize: [number, number] }
export type ExtraBoneXform = { pivot: [number, number, number]; rotation: [number, number, number] }
export type ExtraCube = {
  origin: [number, number, number]
  size: [number, number, number]
  uv:
    | [number, number]
    | Partial<Record<'north' | 'south' | 'east' | 'west' | 'up' | 'down', ExtraFaceUv>>
  inflate?: number
  mirror?: boolean
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  parents?: ExtraBoneXform[]
  name?: string
  poseParent?: string
}
export type ExtraEntityDump = {
  id: string
  textureSize: [number, number]
  cubes: ExtraCube[]
}

export const VANILLA_EXTRA_ENTITIES: Record<string, ExtraEntityDump> = `

async function main() {
  const args = process.argv.slice(2)
  const dumpOnly = args.includes('--dump')
  const only = args.filter((arg) => !arg.startsWith('-'))
  const models = {}
  for (const id of EXTRA) {
    if (dumpOnly && only.length && !only.includes(id)) continue
    const url = `${JAVA_LAYER}/${id}.json`
    try {
      const json = JSON.parse(await get(url))
      models[id] = convertJavaLayer(json, id)
      process.stdout.write(`java ${id} ${models[id].cubes.length} cubes ${models[id].textureSize.join('x')}\n`)
    } catch (err) {
      process.stdout.write(`skip java ${id}: ${err.message}\n`)
    }
  }

  if (dumpOnly) {
    const outPath = path.join(ROOT, 'scripts/_dump-entities.json')
    fs.writeFileSync(outPath, JSON.stringify(models, null, 2))
    console.log('dumped', Object.keys(models).join(', '), '→', path.relative(ROOT, outPath))
    return
  }

  for (const [id, file] of Object.entries(MOJANG_GEO)) {
    try {
      const json = JSON.parse(await get(`${MOJANG_GEO_BASE}/${file}`))
      models[id] = convertBedrockGeo(json, id)
      process.stdout.write(`mojang ${id} ${models[id].cubes.length} cubes ${models[id].textureSize.join('x')}\n`)
    } catch (err) {
      process.stdout.write(`keep java ${id}: ${err.message}\n`)
    }
  }

  try {
    const localHorse = path.join(ROOT, 'builder/geo/horse_v3.geo.json')
    const horseJson = fs.existsSync(localHorse)
      ? JSON.parse(fs.readFileSync(localHorse, 'utf8'))
      : JSON.parse(await get(`${MOJANG_GEO_BASE}/horse_v3.geo.json`))
    models.donkey = convertBedrockGeo(horseJson, 'donkey', DONKEY_SKIP)
    process.stdout.write(`mojang donkey ${models.donkey.cubes.length} cubes (no chest/saddle, mule ears)\n`)
  } catch (err) {
    process.stdout.write(`keep java donkey: ${err.message}\n`)
  }

  for (const [id, file] of Object.entries(MOJANG_BABY)) {
    try {
      const json = JSON.parse(await get(`${MOJANG_GEO_BASE}/${file}`))
      models[id] = convertBedrockGeo(json, id)
      process.stdout.write(`baby ${id} ${models[id].cubes.length} cubes ${models[id].textureSize.join('x')}\n`)
    } catch (err) {
      process.stdout.write(`skip baby ${id}: ${err.message}\n`)
    }
  }

  const creeper = models.creeper?.cubes ?? []
  const head = creeper.find((cube) => cube.name === 'head')
  if (!head || head.origin[1] !== 18 || head.size[0] !== 8) {
    throw new Error(`creeper head check failed: ${JSON.stringify(head)}`)
  }
  const fox = models.fox
  if (!fox || fox.textureSize[0] !== 48) {
    throw new Error(`fox textureSize should be 48×32, got ${fox?.textureSize}`)
  }

  fs.writeFileSync(OUT, `${HEADER}${JSON.stringify(models, null, 2)}\n`)
  const counts = Object.entries(models).map(([id, model]) => `${id}:${model.cubes.length}`)
  console.log('wrote', Object.keys(models).length, 'models →', path.relative(ROOT, OUT))
  console.log(counts.join(' '))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
