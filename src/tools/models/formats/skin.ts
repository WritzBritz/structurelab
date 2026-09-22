import type { ModelFormat } from './types'
import { isTextureFileName } from '../objAssets'

export const skinFormat: ModelFormat = {
  id: 'skin',
  label: 'Minecraft skin',
  role: 'primary',
  extensions: ['png'],
  // Lower than mesh formats so a PNG next to an OBJ is treated as a texture.
  priority: 10,
  matches: (fileName) => /\.png$/i.test(fileName),
}

export const mtlFormat: ModelFormat = {
  id: 'mtl',
  label: 'Wavefront MTL',
  role: 'companion',
  extensions: ['mtl'],
  priority: 50,
  matches: (fileName) => /\.mtl$/i.test(fileName),
}

export const textureFormat: ModelFormat = {
  id: 'texture',
  label: 'Texture image',
  role: 'companion',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'tif', 'tiff'],
  priority: 20,
  matches: isTextureFileName,
}

export { isTextureFileName }
