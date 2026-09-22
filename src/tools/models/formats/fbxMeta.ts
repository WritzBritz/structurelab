/** FBX format identity — no three.js (keeps registry / detect lightweight). */

import type { ModelFormat } from './types'

export const fbxFormat: ModelFormat = {
  id: 'fbx',
  label: 'Autodesk FBX',
  role: 'primary',
  extensions: ['fbx'],
  priority: 100,
  matches: (fileName) => /\.fbx$/i.test(fileName),
}

export function isFbxFileName(name: string): boolean {
  return fbxFormat.matches(name)
}
