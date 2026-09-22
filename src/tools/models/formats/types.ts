/** Shared types for per-format model importers. */

export type FormatId =
  | 'obj'
  | 'miobject'
  | 'mimodel'
  | 'bbmodel'
  | 'gltf'
  | 'fbx'
  | 'dae'
  | 'vox'
  | 'maya'
  | 'skin'
  | 'mtl'
  | 'texture'

/** Primary sources become scene parts; companions attach to an existing part. */
export type FormatRole = 'primary' | 'companion'

export type ModelFormat = {
  id: FormatId
  /** Short UI label */
  label: string
  role: FormatRole
  /** File extensions without dot, lower-case */
  extensions: string[]
  /** Higher wins when several formats could claim a file (e.g. mesh before loose PNG). */
  priority: number
  matches(fileName: string): boolean
}

export function extensionOf(fileName: string): string {
  const base = fileName.replaceAll('\\', '/').split('/').pop() ?? fileName
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}
