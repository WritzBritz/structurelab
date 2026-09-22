/**
 * Audit catalog + player head UVs vs bundled PNGs and imported OBJ fronts.
 * Run: npx tsx scripts/audit-catalog-heads.mts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_MOBS, expandTexturePaths, PLAYER_PRESETS } from '../src/tools/models/minecraftCatalog.ts'
import { catalogBoneId } from '../src/tools/models/catalogEntityBones.ts'
import { decodePngRgba, type PngRgba } from '../src/tools/models/decodePngRgba.ts'
import { entityModelToObj } from '../src/tools/models/entityCubesToObj.ts'
import {
  headAssemblyCubes,
  headOverlayFronts,
  headPreviewFace,
  needsComposedHeadThumb,
} from '../src/tools/models/mobHeadPreview.ts'
import { humanoidModelFor, type EntityCube } from '../src/tools/models/vanillaHumanoids.ts'

const root = join(process.cwd(), 'public', 'entity-textures')

function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24 || bytes[0] !== 0x89) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function localPath(mcPath: string): string | null {
  const rel = mcPath
    .replace(/^textures\/entity\//i, '')
    .replace(/^assets\/minecraft\/textures\/entity\//i, '')
  if (!rel) return null
  const full = join(root, ...rel.split('/'))
  return existsSync(full) ? full : null
}

function findTexture(paths: string[]): string | null {
  for (const p of expandTexturePaths(paths)) {
    const file = localPath(p)
    if (file) return file
  }
  return null
}

function cubeName(cube: EntityCube) {
  return (cube.name ?? '').toLowerCase()
}

function northFace(cube: EntityCube): { x: number; y: number; w: number; h: number } | null {
  const uv = cube.uv
  if (!Array.isArray(uv)) {
    const face = uv.north ?? uv.south
    if (!face) return null
    let [x, y] = face.uv
    let [w, h] = face.uvSize
    if (w < 0) {
      x += w
      w = -w
    }
    if (h < 0) {
      y += h
      h = -h
    }
    return { x, y, w, h }
  }
  const [u, v] = uv
  const [w, h, d] = cube.uvSize ?? cube.size
  if (w < 0.5 || h < 0.5) return null
  return { x: u + d, y: v + d, w, h }
}

function opaqueRatio(img: PngRgba, x: number, y: number, w: number, h: number): number {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(img.width, Math.ceil(x + w))
  const y1 = Math.min(img.height, Math.ceil(y + h))
  if (x1 <= x0 || y1 <= y0) return 0
  let n = 0
  let o = 0
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      n += 1
      if (img.data[(py * img.width + px) * 4 + 3]! >= 20) o += 1
    }
  }
  return n ? o / n : 0
}

function shadeCount(img: PngRgba, x: number, y: number, w: number, h: number): number {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(img.width, Math.ceil(x + w))
  const y1 = Math.min(img.height, Math.ceil(y + h))
  const seen = new Set<string>()
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * img.width + px) * 4
      if (img.data[i + 3]! < 20) continue
      seen.add(`${img.data[i]! >> 4},${img.data[i + 1]! >> 4},${img.data[i + 2]! >> 4}`)
    }
  }
  return seen.size
}

type ObjFace = { zs: number[]; uvs: [number, number][] }

function parseObjFrontUvs(obj: string, objectName: string, texW: number, texH: number) {
  const verts: [number, number, number][] = []
  const uvs: [number, number][] = []
  const faces: ObjFace[] = []
  let current = ''
  for (const raw of obj.split(/\n/)) {
    const line = raw.trim()
    if (line.startsWith('o ') || line.startsWith('g ')) {
      current = line.slice(2).trim()
      continue
    }
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      verts.push([Number(p[1]), Number(p[2]), Number(p[3])])
      continue
    }
    if (line.startsWith('vt ')) {
      const p = line.split(/\s+/)
      uvs.push([Number(p[1]), Number(p[2])])
      continue
    }
    if (!line.startsWith('f ') || current !== objectName) continue
    const zs: number[] = []
    const fuvs: [number, number][] = []
    for (const bit of line.slice(2).split(/\s+/)) {
      const [vi, ti] = bit.split('/').map(Number)
      const v = verts[vi - 1]
      const t = uvs[ti - 1]
      if (v) zs.push(v[2])
      if (t) fuvs.push(t)
    }
    if (zs.length) faces.push({ zs, uvs: fuvs })
  }
  if (!faces.length) return null
  let maxZ = -Infinity
  for (const face of faces) {
    const z = face.zs.reduce((a, b) => a + b, 0) / face.zs.length
    if (z > maxZ) maxZ = z
  }
  const front = faces.filter((face) => {
    const z = face.zs.reduce((a, b) => a + b, 0) / face.zs.length
    return Math.abs(z - maxZ) < 0.2
  })
  const texels = front.flatMap((face) =>
    face.uvs.map(([u, v]) => [u * texW, (1 - v) * texH] as [number, number]),
  )
  const us = texels.map((t) => t[0])
  const vs = texels.map((t) => t[1])
  return {
    u0: Math.min(...us),
    v0: Math.min(...vs),
    u1: Math.max(...us),
    v1: Math.max(...vs),
    maxZ,
  }
}

type Issue = { id: string; severity: 'error' | 'warn'; message: string }
const issues: Issue[] = []

const FOCUS = [
  'zombie',
  'skeleton',
  'creeper',
  'enderman',
  'piglin',
  'villager',
  'pig',
  'cow',
  'wolf',
  'iron_golem',
  'witch',
  'snow_golem',
  'drowned',
  'stray',
  'zombie_villager',
]

for (const mob of ALL_MOBS) {
  const id = mob.id
  const model = humanoidModelFor(id)
  if (!model) {
    issues.push({ id, severity: 'error', message: 'no model' })
    continue
  }
  const file = findTexture(mob.texturePaths)
  if (!file) {
    issues.push({ id, severity: 'error', message: 'missing png' })
    continue
  }
  const bytes = new Uint8Array(readFileSync(file))
  const size = pngSize(bytes)
  const [mw, mh] = model.textureSize
  if (size && (size[0] !== mw || size[1] !== mh)) {
    const padded = size[0] === mw && size[1] === mh * 2
    const scaled = size[0] === mw * 2 && size[1] === mh * 2
    if (!padded && !scaled) {
      issues.push({
        id,
        severity: 'warn',
        message: `png ${size[0]}x${size[1]} vs model ${mw}x${mh} (${file.replace(root + '\\', '')})`,
      })
    }
  }
  const face = headPreviewFace(id)
  if (size && (face.x + face.w > size[0] + 0.1 || face.y + face.h > size[1] + 0.1)) {
    issues.push({
      id,
      severity: 'error',
      message: `head UV (${face.x},${face.y} ${face.w}x${face.h}) outside png ${size[0]}x${size[1]}`,
    })
  }
  const overlays = headOverlayFronts(id)
  for (const overlay of overlays) {
    if (size && (overlay.x + overlay.w > size[0] + 0.1 || overlay.y + overlay.h > size[1] + 0.1)) {
      issues.push({
        id,
        severity: 'error',
        message: `overlay UV (${overlay.x},${overlay.y}) outside png ${size[0]}x${size[1]}`,
      })
    }
  }
  const img = await decodePngRgba(bytes)
  if (img) {
    const uScale = img.width / Math.max(mw, 1)
    const vScale = img.height / Math.max(mh, 1)
    // 2× tall padded sheets keep texel coords in PNG space via uvAtlasSize.
    const atlasH = size && size[0] === mw && size[1] === mh * 2 ? size[1] : mh
    const vs = img.height / Math.max(atlasH === mh ? mh : atlasH, 1)
    const ox = face.x * (img.width / Math.max(face.sheetW, 1))
    const oy = face.y * (img.height / Math.max(face.sheetH === mh ? atlasH : face.sheetH, 1))
    const ow = face.w * (img.width / Math.max(face.sheetW, 1))
    const oh = face.h * (img.height / Math.max(face.sheetH === mh ? atlasH : face.sheetH, 1))
    void uScale
    void vScale
    void vs
    const opaque = opaqueRatio(img, ox, oy, ow, oh)
    const shades = shadeCount(img, ox, oy, ow, oh)
    if (opaque < 0.2) {
      issues.push({
        id,
        severity: 'error',
        message: `head front mostly empty (${(opaque * 100).toFixed(0)}% opaque at ${face.x},${face.y} ${face.w}x${face.h})`,
      })
    } else if (shades < 2 && opaque > 0.8) {
      issues.push({
        id,
        severity: 'warn',
        message: `head front is a flat colour (${shades} shades)`,
      })
    }
    for (const overlay of overlays) {
      const oOpaque = opaqueRatio(
        img,
        overlay.x * (img.width / mw),
        overlay.y * (img.height / Math.max(atlasH === mh ? mh : atlasH, 1)),
        overlay.w * (img.width / mw),
        overlay.h * (img.height / Math.max(atlasH === mh ? mh : atlasH, 1)),
      )
      if (oOpaque < 0.02 && mh <= 32) {
        issues.push({
          id,
          severity: 'warn',
          message: `head overlay empty on short sheet (${(oOpaque * 100).toFixed(0)}% at ${overlay.x},${overlay.y})`,
        })
      }
    }
  }

  const headCubes = model.cubes.filter((cube, i) => {
    const bone = catalogBoneId(model, i)
    return bone === 'head' || bone === 'hat' || bone.endsWith('_overlay') && bone.startsWith('head')
      || cubeName(cube) === 'head' || cubeName(cube) === 'hat'
  })
  if (FOCUS.includes(id) || FOCUS.includes(id.replace(/^baby_/, ''))) {
    const { obj } = entityModelToObj(model, 't.png', size, img)
    const front = parseObjFrontUvs(obj, 'head', face.sheetW, face.sheetH)
    if (front) {
      const cx = (front.u0 + front.u1) / 2
      const cy = (front.v0 + front.v1) / 2
      const onFace =
        cx >= face.x - 1 && cx <= face.x + face.w + 1 && cy >= face.y - 1 && cy <= face.y + face.h + 1
      const onBack = Array.isArray(model.cubes.find((c) => cubeName(c) === 'head')?.uv)
        && Math.abs(cx - (face.x + face.w + (model.cubes.find((c) => cubeName(c) === 'head')!.size[2]))) < 3
      if (!onFace) {
        issues.push({
          id,
          severity: 'error',
          message: `imported +Z head UV ~(${cx.toFixed(1)},${cy.toFixed(1)}) expected face (${face.x},${face.y} ${face.w}x${face.h}) z=${front.maxZ.toFixed(1)}`,
        })
      }
      void onBack
      void headCubes
    }
  }
}

const playerFiles = [
  ['steve', join(root, 'player', 'wide', 'steve.png')],
  ['alex', join(root, 'player', 'slim', 'alex.png')],
  ['ari', join(root, 'player', 'wide', 'ari.png')],
]
for (const [id, file] of playerFiles) {
  if (!existsSync(file)) {
    issues.push({ id, severity: 'error', message: `missing player png ${file}` })
    continue
  }
  const bytes = new Uint8Array(readFileSync(file))
  const img = await decodePngRgba(bytes)
  if (!img) continue
  const inner = opaqueRatio(img, 8, 8, 8, 8)
  const hat = opaqueRatio(img, 40, 8, 8, 8)
  const innerShades = shadeCount(img, 8, 8, 8, 8)
  const hatShades = shadeCount(img, 40, 8, 8, 8)
  if (inner < 0.5) {
    issues.push({ id, severity: 'error', message: `player inner face empty (${(inner * 100).toFixed(0)}%)` })
  }
  if (img.height >= 64 && hat < 0.05) {
    issues.push({ id, severity: 'warn', message: `player hat layer empty (${(hat * 100).toFixed(0)}%) — will look bald without overlay` })
  }
  issues.push({
    id,
    severity: 'warn',
    message: `player face inner ${innerShades} shades / ${(inner * 100).toFixed(0)}% opaque; hat ${hatShades} shades / ${(hat * 100).toFixed(0)}% opaque; png ${img.width}x${img.height}`,
  })
}

const report = [
  `Head audit — ${ALL_MOBS.length} mobs, ${PLAYER_PRESETS.length} player presets`,
  `needsComposed: ${ALL_MOBS.filter((m) => needsComposedHeadThumb(m.id)).length}`,
  '',
  ...issues.filter((i) => i.severity === 'error').map((i) => `ERROR  ${i.id}: ${i.message}`),
  ...issues.filter((i) => i.severity === 'warn').map((i) => `WARN   ${i.id}: ${i.message}`),
  '',
  'FOCUS heads:',
  ...FOCUS.map((id) => {
    const model = humanoidModelFor(id)
    const face = headPreviewFace(id)
    const extras = headAssemblyCubes(id).map((c) => `${c.name}:${c.size.join('x')} uv=${JSON.stringify(c.uv)} inf=${c.inflate ?? 0}`)
    const overlays = headOverlayFronts(id)
    return `${id} sheet=${model?.textureSize.join('x')} face=${face.x},${face.y} ${face.w}x${face.h} overlays=${overlays.length} extras=${extras.length}\n  ${extras.slice(0, 8).join('\n  ')}`
  }),
].join('\n')

writeFileSync('scripts/audit-catalog-heads-report.txt', report)
console.log(report)
const errors = issues.filter((i) => i.severity === 'error')
process.exit(errors.length > 0 ? 1 : 0)
