import { isMimodelFileName } from './formats/mimodel'
import { basename, isTextureFileName } from './objAssets'

export type SourceDropIntent = 'models' | 'skins'

const MESH_PRIMARY_EXT = /\.(obj|fbx|dae|gltf|glb|mb|ma|vox|bbmodel|miobject)$/i

export function isCompanionDropName(name: string): boolean {
  return isTextureFileName(name) || isMimodelFileName(name) || /\.mtl$/i.test(name)
}

function fileStem(name: string): string {
  return basename(name).replace(/\.[^.]+$/, '').toLowerCase()
}

/**
 * PNG is a player skin only when added as a skin, or when no mesh is selected
 * to receive it. Dropping/picking an image onto an OBJ/Maya/DAE/FBX part must
 * attach it as a texture, not spawn a Minecraft skin.
 *
 * Dropping the same model again with a texture folder (Unity package, Blender
 * `.fbm`, Mixamo zip extract) also attaches, instead of importing a duplicate.
 */
export function companionDropShouldAttachToSelection(args: {
  intent: SourceDropIntent
  hasMeshPrimary: boolean
  fileNames: string[]
  selectedKind: 'obj' | 'skin' | null
  selectedName?: string | null
  /** True when a selected skin is still waiting for its PNG. */
  selectedNeedsSkin: boolean
}): boolean {
  if (args.intent === 'skins') return false
  if (args.fileNames.length === 0) return false
  if (args.selectedKind === 'skin' && args.selectedNeedsSkin) {
    return args.fileNames.every(isCompanionDropName)
  }
  if (args.selectedKind !== 'obj') return false
  const companions = args.fileNames.filter(isCompanionDropName)
  if (companions.length === 0) return false
  const meshFiles = args.fileNames.filter((name) => MESH_PRIMARY_EXT.test(name))
  if (meshFiles.length === 0) {
    return args.fileNames.every(isCompanionDropName)
  }
  const selectedStem = fileStem(args.selectedName ?? '')
  if (!selectedStem) return false
  return meshFiles.every((name) => {
    const stem = fileStem(name)
    const full = basename(name).toLowerCase()
    const selectedFull = basename(args.selectedName ?? '').toLowerCase()
    return stem === selectedStem || full === selectedFull
  })
}
