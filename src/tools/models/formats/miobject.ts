import type { ModelFormat } from './types'
import { isMiobjectFileName } from '../miobjectAssets'

export const miobjectFormat: ModelFormat = {
  id: 'miobject',
  label: 'Mine-imator object',
  role: 'primary',
  extensions: ['miobject'],
  priority: 100,
  matches: isMiobjectFileName,
}

export { isMiobjectFileName }
