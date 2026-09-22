/**
 * Audit every catalog mob for convert/voxelize readiness.
 * Run: npx tsx scripts/audit-catalog-mobs.mts
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_MOBS, expandTexturePaths } from '../src/tools/models/minecraftCatalog.ts'
import {
  catalogEyesOverlayPath,
  catalogExtraMaterials,
  catalogOuterLayerPath,
  ENDERMAN_ANGRY_HEAD_LIFT,
} from '../src/tools/models/entityCatalogFixes.ts'
import { humanoidModelFor } from '../src/tools/models/vanillaHumanoids.ts'
import { catalogBoneId } from '../src/tools/models/catalogEntityBones.ts'

const root = join(process.cwd(), 'public', 'entity-textures')

function localPath(mcPath: string): string | null {
  const rel = mcPath
    .replace(/^textures\/entity\//i, '')
    .replace(/^assets\/minecraft\/textures\/entity\//i, '')
  if (!rel) return null
  const full = join(root, ...rel.split('/'))
  return existsSync(full) ? full : null
}

function findTexture(paths: string[]): { path: string; file: string } | null {
  for (const p of expandTexturePaths(paths)) {
    const file = localPath(p)
    if (file) return { path: p, file }
  }
  return null
}

type Issue = { id: string; severity: 'error' | 'warn'; message: string }

const issues: Issue[] = []
const ok: string[] = []

for (const mob of ALL_MOBS) {
  const id = mob.id
  const model = humanoidModelFor(id)
  if (!model) {
    issues.push({ id, severity: 'error', message: 'no geometry (humanoidModelFor null)' })
    continue
  }
  if (model.cubes.length < 1) {
    issues.push({ id, severity: 'error', message: 'zero cubes' })
    continue
  }

  const tex = findTexture(mob.texturePaths)
  if (!tex) {
    issues.push({ id, severity: 'error', message: `missing base texture (${mob.texturePaths[0]})` })
    continue
  }

  const eyesPath = catalogEyesOverlayPath(id)
  if (eyesPath && !findTexture([eyesPath])) {
    issues.push({ id, severity: 'error', message: `EyesLayer missing: ${eyesPath}` })
  }

  const outer = catalogOuterLayerPath(id)
  if (outer && !findTexture([outer])) {
    issues.push({ id, severity: 'error', message: `outer layer missing: ${outer}` })
  }

  if (id === 'enderman_angry') {
    const head = model.cubes.find((c) => c.name === 'head')
    const jaw = model.cubes.find((c) => c.name === 'jaw')
    if (!jaw) issues.push({ id, severity: 'error', message: 'missing jaw bone' })
    if (head && jaw) {
      const hi = jaw.inflate ?? 0
      const headBottom = head.origin[1]
      const jawTop = jaw.origin[1] + jaw.size[1] + hi
      if (jawTop > headBottom - 0.5) {
        issues.push({
          id,
          severity: 'error',
          message: `mouth sealed (jawTop=${jawTop} headBottom=${headBottom}, lift=${ENDERMAN_ANGRY_HEAD_LIFT})`,
        })
      }
    }
  }

  if (id === 'sheep' || id === 'baby_sheep') {
    const hasWool = model.cubes.some((c) => /wool/i.test(c.name ?? ''))
    if (!hasWool) {
      issues.push({ id, severity: 'error', message: 'no wool cubes (sheared-only)' })
    }
    const woolName = catalogExtraMaterials(id).wool
    if (woolName && !localPath(`textures/entity/sheep/${woolName}`)) {
      issues.push({ id, severity: 'error', message: `missing ${woolName}` })
    }
  }

  const bones = model.cubes.map((_, i) => catalogBoneId(model, i))
  if (bones.includes('hat') && id.includes('enderman')) {
    issues.push({ id, severity: 'error', message: 'enderman still has hat bone (should be jaw)' })
  }

  if (!issues.some((i) => i.id === id)) ok.push(id)
}

const errors = issues.filter((i) => i.severity === 'error')
const warns = issues.filter((i) => i.severity === 'warn')
const report = [
  `Catalog mob audit — ${ALL_MOBS.length} mobs`,
  `OK: ${ok.length}  WARN: ${warns.length}  ERROR: ${errors.length}`,
  '',
  ...errors.map((i) => `ERROR  ${i.id}: ${i.message}`),
  ...warns.map((i) => `WARN   ${i.id}: ${i.message}`),
  '',
  `OK (${ok.length}): ${ok.join(', ')}`,
].join('\n')

writeFileSync('scripts/audit-catalog-mobs-report.txt', report)
console.log(report)
process.exit(errors.length > 0 ? 1 : 0)
