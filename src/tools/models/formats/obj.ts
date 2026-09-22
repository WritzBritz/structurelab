import type { ModelFormat } from './types'

export const objFormat: ModelFormat = {
  id: 'obj',
  label: 'Wavefront OBJ',
  role: 'primary',
  extensions: ['obj'],
  priority: 100,
  matches: (fileName) => /\.obj$/i.test(fileName),
}
