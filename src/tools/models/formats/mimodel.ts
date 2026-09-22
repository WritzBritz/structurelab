import type { ModelFormat } from './types'
import { isMimodelFileName } from '../miobjectAssets'

export const mimodelFormat: ModelFormat = {
  id: 'mimodel',
  label: 'Mine-imator model',
  role: 'primary',
  extensions: ['mimodel'],
  priority: 100,
  matches: isMimodelFileName,
}

export { isMimodelFileName }
