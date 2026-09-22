/** COLLADA format identity — kept free of three.js for the lightweight registry. */

import type { ModelFormat } from './types'

export const daeFormat: ModelFormat = {
  id: 'dae',
  label: 'COLLADA model',
  role: 'primary',
  extensions: ['dae'],
  priority: 100,
  matches: (fileName) => /\.dae$/i.test(fileName),
}

export function isDaeFileName(name: string): boolean {
  return daeFormat.matches(name)
}
