/**
 * Legacy Bedrock dump from prismarine-viewer. Extra catalog cubes now come
 * from builder/extract-java-entity-models.mjs (official Java LayerDefinitions).
 */
import https from 'https'
import fs from 'fs'

const EXTRA = [
  'creeper', 'enderman', 'villager', 'wandering_trader', 'witch', 'vindicator', 'pillager', 'evoker',
  'iron_golem', 'snow_golem', 'blaze', 'slime', 'magma_cube', 'spider', 'cave_spider', 'ghast',
  'cow', 'pig', 'sheep', 'chicken', 'wolf', 'hoglin', 'zoglin', 'bee', 'silverfish', 'endermite',
  'guardian', 'phantom', 'vex', 'ravager', 'bat', 'squid', 'wither', 'polar_bear', 'llama',
  'horse', 'donkey', 'rabbit', 'parrot', 'fox', 'panda', 'goat', 'turtle', 'strider', 'mooshroom',
  'cat', 'ocelot', 'dolphin',
]

const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down']
const SKIP_BONE = /sleep|sleeping|baby|dead|sit|sitting/i

function hasAngle(rot) {
  return Array.isArray(rot) && rot.some((value) => Number(value))
}

function addRot(a, b) {
  return [
    (a?.[0] ?? 0) + (b?.[0] ?? 0),
    (a?.[1] ?? 0) + (b?.[1] ?? 0),
    (a?.[2] ?? 0) + (b?.[2] ?? 0),
  ]
}

/** Parse Bedrock rest-pose Molang: `90 - this` → 90, `-this` → 0. */
function parseAnimChannel(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const text = value.trim()
  if (text === '-this' || text === '0 - this') return 0
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*-\s*this$/)
  if (match) return Number(match[1])
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)
  return 0
}

function parseAnimVec(value) {
  if (!Array.isArray(value)) return [0, 0, 0]
  return [parseAnimChannel(value[0]), parseAnimChannel(value[1]), parseAnimChannel(value[2])]
}

function packUv(uv) {
  if (Array.isArray(uv) && uv.length >= 2) return [uv[0], uv[1]]
  if (!uv || typeof uv !== 'object') return null
  const faces = {}
  for (const name of FACE_NAMES) {
    const face = uv[name]
    if (!face || !Array.isArray(face.uv)) continue
    const size = face.uv_size ?? face.uvSize ?? [0, 0]
    faces[name] = { uv: [face.uv[0], face.uv[1]], uvSize: [size[0], size[1]] }
  }
  return Object.keys(faces).length ? faces : null
}

function pickSetupAnimation(entity) {
  const animations = entity.animations ?? {}
  const names = Object.keys(animations)
  const preferred =
    names.find((name) => /(^|_)setup$/i.test(name))
    ?? names.find((name) => /setup/i.test(name))
    ?? names.find((name) => name === 'general')
    ?? names.find((name) => /^idle$/i.test(name))
  return preferred ? animations[preferred] : null
}

function restRotationForBone(bone, setupBones) {
  const bind = bone.bind_pose_rotation ?? [0, 0, 0]
  const local = bone.rotation ?? [0, 0, 0]
  const anim = setupBones[bone.name.toLowerCase()]?.rotation
  const setup = anim ? parseAnimVec(anim) : [0, 0, 0]
  return addRot(addRot(bind, local), setup)
}

/** Prismarine/THREE negates Bedrock Euler so +X pitches a Y-up cube toward −Z. */
function toBakerRotation(rot) {
  if (!Array.isArray(rot)) return rot
  return [-Number(rot[0] || 0), -Number(rot[1] || 0), -Number(rot[2] || 0)]
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

function poseParentName(bone, bonesByName) {
  let current = bone.parent
  const seen = new Set()
  while (current && !seen.has(current)) {
    seen.add(current)
    if (!skipPoseParent(current)) return sanitizeBoneName(current)
    current = bonesByName.get(current)?.parent
  }
  return undefined
}

https.get(
  'https://raw.githubusercontent.com/PrismarineJS/prismarine-viewer/master/viewer/lib/entity/entities.json',
  (res) => {
    let body = ''
    res.on('data', (chunk) => { body += chunk })
    res.on('end', () => {
      const json = JSON.parse(body)
      const models = {}
      for (const id of EXTRA) {
        if (!json[id]) continue
        const entity = json[id]
        const geometry = entity.geometry?.default ?? Object.values(entity.geometry ?? {})[0]
        if (!geometry) continue
        const setupBones = {}
        const setup = pickSetupAnimation(entity)
        for (const [name, boneAnim] of Object.entries(setup?.bones ?? {})) {
          setupBones[name.toLowerCase()] = boneAnim
        }
        const bonesByName = new Map()
        for (const bone of geometry.bones ?? []) {
          if (bone?.name) bonesByName.set(bone.name, bone)
        }
        const cubes = []
        for (const bone of geometry.bones ?? []) {
          if (SKIP_BONE.test(bone.name ?? '')) continue
          const rest = restRotationForBone(bone, setupBones)
          for (const cube of bone.cubes ?? []) {
            const uv = packUv(cube.uv)
            if (!uv) continue
            const entry = { origin: cube.origin, size: cube.size, uv }
            const boneName = sanitizeBoneName(bone.name)
            if (boneName) entry.name = boneName
            if (cube.inflate) entry.inflate = cube.inflate
            if (cube.mirror || bone.mirror) entry.mirror = true
            const parentName = poseParentName(bone, bonesByName)
            if (parentName && parentName !== boneName) entry.poseParent = parentName
            const cubeRot = cube.rotation
            if (hasAngle(cubeRot)) {
              entry.pivot = cube.pivot ?? bone.pivot ?? [0, 0, 0]
              entry.rotation = toBakerRotation(cubeRot)
              if (hasAngle(rest)) {
                entry.parents = [{ pivot: bone.pivot ?? [0, 0, 0], rotation: toBakerRotation(rest) }]
              }
            } else if (hasAngle(rest)) {
              entry.pivot = bone.pivot
              entry.rotation = toBakerRotation(rest)
            } else if (Array.isArray(bone.pivot)) {
              entry.pivot = bone.pivot
            }
            cubes.push(entry)
          }
        }
        models[id] = {
          id,
          textureSize: [geometry.texturewidth || 64, geometry.textureheight || 64],
          cubes,
        }
      }
      const header = `/** Extracted from prismarine-viewer entities.json (vanilla Bedrock/Java cubes). */
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
      fs.writeFileSync(
        'src/tools/models/vanillaExtraEntities.ts',
        `${header}${JSON.stringify(models, null, 2)}\n`,
      )
      const wolf = models.wolf
      const rotated = wolf?.cubes.filter((cube) => cube.rotation).length
      const counts = Object.entries(models).map(([id, model]) => `${id}:${model.cubes.length}`)
      console.log('wrote', Object.keys(models).length, 'models', counts.join(' '))
      console.log('wolf cubes', wolf?.cubes.length, 'with rest rotation', rotated)
    })
  },
)
