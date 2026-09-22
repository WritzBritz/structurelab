/** Central registry of model source / companion formats. */

import { bbmodelFormat } from './bbmodel'
import { daeFormat } from './daeMeta'
import { fbxFormat } from './fbxMeta'
import { gltfFormat } from './gltfMeta'
import { mayaFormat } from './maya'
import { mimodelFormat } from './mimodel'
import { miobjectFormat } from './miobject'
import { objFormat } from './obj'
import { mtlFormat, skinFormat, textureFormat } from './skin'
import { voxFormat } from './vox'
import type { FormatId, FormatRole, ModelFormat } from './types'

/** One module per supported format — add new formats here. */
export const MODEL_FORMATS: readonly ModelFormat[] = [
  objFormat,
  miobjectFormat,
  mimodelFormat,
  bbmodelFormat,
  gltfFormat,
  fbxFormat,
  daeFormat,
  voxFormat,
  mayaFormat,
  skinFormat,
  mtlFormat,
  textureFormat,
]

export function formatById(id: FormatId): ModelFormat | undefined {
  return MODEL_FORMATS.find((format) => format.id === id)
}

/** Highest-priority format that claims this file name. */
export function detectFormat(fileName: string): ModelFormat | null {
  let best: ModelFormat | null = null
  for (const format of MODEL_FORMATS) {
    if (!format.matches(fileName)) continue
    if (!best || format.priority > best.priority) best = format
  }
  return best
}

export function formatsWithRole(role: FormatRole): ModelFormat[] {
  return MODEL_FORMATS.filter((format) => format.role === role)
}

/** Extensions for the native “Add models” dialog (deduped). */
export function primaryDialogExtensions(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const format of MODEL_FORMATS) {
    for (const ext of format.extensions) {
      if (seen.has(ext)) continue
      seen.add(ext)
      out.push(ext)
    }
  }
  return out
}

export function companionDialogExtensions(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const format of formatsWithRole('companion')) {
    for (const ext of format.extensions) {
      if (seen.has(ext)) continue
      seen.add(ext)
      out.push(ext)
    }
  }
  // Mimodel / textures often attach as companions too.
  for (const ext of ['mimodel', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'tif', 'tiff', 'mtl']) {
    if (!seen.has(ext)) {
      seen.add(ext)
      out.push(ext)
    }
  }
  return out
}

export function acceptAttribute(): string {
  return primaryDialogExtensions()
    .map((ext) => `.${ext}`)
    .concat(['model/obj', 'image/*', 'text/plain', 'application/json'])
    .join(',')
}

export function supportedFormatsHint(): string {
  return formatsWithRole('primary')
    .map((format) => `.${format.extensions[0]}`)
    .join(' · ')
}

export type { FormatId, FormatRole, ModelFormat }
export {
  bbmodelFormat,
  daeFormat,
  fbxFormat,
  gltfFormat,
  mayaFormat,
  mimodelFormat,
  miobjectFormat,
  objFormat,
  skinFormat,
  mtlFormat,
  textureFormat,
  voxFormat,
}
