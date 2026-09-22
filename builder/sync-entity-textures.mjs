#!/usr/bin/env node
/**
 * Optional maintainer script: refresh public/entity-textures/ (and related
 * vanilla PNGs) from Mojang's asset index. Not invoked by tauri/dev/portable
 * builds — those only copy files already in the repo. Missing textures at
 * runtime are handled in-app when the user chooses to download them.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const entityDest = join(publicDir, 'entity-textures')
const blockDest = join(publicDir, 'block-textures')
const version = process.argv[2] || '26.2'
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const JAR_PREFIXES = [
  'assets/minecraft/textures/entity',
  'assets/minecraft/textures/block',
]

async function download(url, dest) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
}

function walkPngs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkPngs(path, out)
    else if (name.toLowerCase().endsWith('.png')) out.push(path)
  }
  return out
}

const manifest = await (await fetch(MANIFEST)).json()
const entry = manifest.versions.find((item) => item.id === version)
if (!entry) {
  console.error(`Mojang manifest has no version ${version}`)
  process.exit(1)
}
const meta = await (await fetch(entry.url)).json()
const client = meta.downloads?.client
if (!client?.url) {
  console.error(`No client jar URL for ${version}`)
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'sl-entity-tex-'))
const jarPath = join(scratch, 'client.jar')
console.log(`Downloading ${version} client.jar…`)
await download(client.url, jarPath)
console.log('Extracting vanilla assets…')
execFileSync('tar', ['-xf', jarPath, '-C', scratch, ...JAR_PREFIXES], { stdio: 'inherit' })

const assets = join(scratch, 'assets', 'minecraft')
if (!existsSync(join(assets, 'textures', 'entity'))) {
  console.error('Jar did not contain entity textures')
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

rmSync(entityDest, { recursive: true, force: true })
mkdirSync(entityDest, { recursive: true })
mkdirSync(blockDest, { recursive: true })
cpSync(join(assets, 'textures', 'entity'), entityDest, { recursive: true })
if (existsSync(join(assets, 'textures', 'block'))) {
  for (const png of walkPngs(join(assets, 'textures', 'block'))) {
    cpSync(png, join(blockDest, png.split(/[/\\]/).pop()))
  }
}
const entityCount = walkPngs(entityDest).length
const blockCount = walkPngs(blockDest).length
rmSync(scratch, { recursive: true, force: true })

console.log(
  `Wrote ${entityCount} entity + ${blockCount} block textures to public/ (${version}).`,
)
