/** glTF format identity — no three.js (keeps registry / detect lightweight). */

import type { ModelFormat } from './types'

export const gltfFormat: ModelFormat = {
  id: 'gltf',
  label: 'glTF model',
  role: 'primary',
  extensions: ['gltf', 'glb'],
  priority: 100,
  matches: (fileName) => /\.(gltf|glb)$/i.test(fileName),
}

export function isGltfFileName(name: string): boolean {
  return gltfFormat.matches(name)
}
