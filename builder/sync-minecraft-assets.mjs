#!/usr/bin/env node
/**
 * Assemble minecraft/{version}/ at repo root (palette + PNGs) for every
 * palette under src-tauri/resources/minecraft/{version}/blocks.json.
 *
 * Textures: resources/{version}/block-textures if present, else public/block-textures.
 * Icons: public/block-icons, limited to block ids referenced by that version’s palette.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebakeIndexedPngs } from './rebake-indexed-pngs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resourcesRoot = join(root, 'src-tauri', 'resources', 'minecraft')
const iconsSrc = join(root, 'public', 'block-icons')
const texturesFallback = join(root, 'public', 'block-textures')
const entitySrc = join(root, 'public', 'entity-textures')

function requirePath(path, label) {
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`)
    process.exit(1)
  }
}

requirePath(resourcesRoot, 'minecraft resources')
requirePath(iconsSrc, 'block-icons')
requirePath(texturesFallback, 'block-textures')

if (existsSync(entitySrc)) {
  const rebakedPublic = rebakeIndexedPngs(entitySrc)
  if (rebakedPublic > 0) {
    console.log(`Rebaked ${rebakedPublic} indexed entity sheets in public/entity-textures (WebView2-safe RGBA).`)
  }
}

const versions = readdirSync(resourcesRoot)
  .filter((name) => {
    const dir = join(resourcesRoot, name)
    return statSync(dir).isDirectory() && existsSync(join(dir, 'blocks.json'))
  })
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

if (versions.length === 0) {
  console.error(`No version palettes found under ${resourcesRoot}`)
  process.exit(1)
}

function baseBlockId(state) {
  return String(state).split('[')[0].replace(/^minecraft:/, '')
}

function paletteBlockIds(blocksJsonPath) {
  const palette = JSON.parse(readFileSync(blocksJsonPath, 'utf8'))
  const ids = new Set()
  for (const color of palette.colors || []) {
    if (color.block) ids.add(baseBlockId(color.block))
    for (const alt of color.alternatives || []) {
      ids.add(baseBlockId(alt))
    }
  }
  return ids
}

function copyPngs(srcDir, destDir, allowStem = null) {
  mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.png')) continue
    const stem = name.slice(0, -4)
    if (allowStem && !allowStem.has(stem)) continue
    cpSync(join(srcDir, name), join(destDir, name))
    count += 1
  }
  return count
}

function countPngsRecursive(dir) {
  let count = 0
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) count += countPngsRecursive(path)
    else if (name.endsWith('.png')) count += 1
  }
  return count
}

function resolveTextures(version) {
  const local = join(resourcesRoot, version, 'block-textures')
  if (existsSync(local) && statSync(local).isDirectory()) {
    const pngs = readdirSync(local).filter((name) => name.endsWith('.png'))
    if (pngs.length > 0) return { dir: local, source: 'version' }
  }
  return { dir: texturesFallback, source: 'public' }
}

for (const version of versions) {
  const blocksSrc = join(resourcesRoot, version, 'blocks.json')
  const dest = join(root, 'minecraft', version)
  const textures = resolveTextures(version)
  const blockIds = paletteBlockIds(blocksSrc)

  rmSync(join(dest, 'block-icons'), { recursive: true, force: true })
  rmSync(join(dest, 'block-textures'), { recursive: true, force: true })
  rmSync(join(dest, 'entity-textures'), { recursive: true, force: true })
  mkdirSync(join(dest, 'block-icons'), { recursive: true })
  mkdirSync(join(dest, 'block-textures'), { recursive: true })

  writeFileSync(join(dest, 'blocks.json'), readFileSync(blocksSrc))
  const iconCount = copyPngs(iconsSrc, join(dest, 'block-icons'), blockIds)
  const texCount = copyPngs(textures.dir, join(dest, 'block-textures'))
  let entityCount = 0
  let rebaked = 0
  if (existsSync(entitySrc)) {
    cpSync(entitySrc, join(dest, 'entity-textures'), { recursive: true })
    rebaked = rebakeIndexedPngs(join(dest, 'entity-textures'))
    entityCount = countPngsRecursive(join(dest, 'entity-textures'))
  }

  writeFileSync(
    join(dest, 'README.txt'),
    `StructureLab Minecraft assets (${version})

  blocks.json       block palette + alternatives
  block-icons/      inventory-style icons for the material browser
  block-textures/   in-world face textures for 3D previews
  entity-textures/  mob/player sheets for Add from Minecraft

Replace PNGs here if needed; restart the app after changes.
`,
    'utf8',
  )

  console.log(
    `Synced minecraft/${version}: blocks.json, ${iconCount} icons, ${texCount} face textures (${textures.source}), ${entityCount} entity sheets (${rebaked} rebaked to RGBA).`,
  )
}
