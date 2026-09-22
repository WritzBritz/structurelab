import type { ScenePartLocal, VoxelFit } from '../../types'
import { nativeSkinSize, nativeSlimSkinSize } from '../../types'
import { clampVoxelBox, computeAutoObjBox, estimateObjRobustSpan, MC_WORLD_HEIGHT } from './objAssets'
import { objGeometryBytes } from './objSceneObjects'

export type WorkflowStep = 'sources' | 'build' | 'export'

export const WORKFLOW_STEPS: { id: WorkflowStep; label: string; detail: string }[] = [
  { id: 'sources', label: 'Sources', detail: 'Add files' },
  { id: 'build', label: 'Build', detail: 'Preview, size & convert' },
  { id: 'export', label: 'Export', detail: 'Save schematic' },
]

export type ObjSizePresetId =
  | 'auto'
  | 'mini'
  | 'small'
  | 'medium'
  | 'large'
  | 'xl'
  | 'statue'
  | 'world'
  | 'custom'

export const OBJ_SIZE_PRESETS: {
  id: ObjSizePresetId
  label: string
  blocks: number | null
  hint: string
}[] = [
  { id: 'auto', label: 'Auto max', blocks: null, hint: 'Fit model to world height' },
  { id: 'mini', label: 'Mini', blocks: 32, hint: 'Tiny props' },
  { id: 'small', label: 'Small', blocks: 48, hint: 'Decor' },
  { id: 'medium', label: 'Medium', blocks: 64, hint: 'Default' },
  { id: 'large', label: 'Large', blocks: 96, hint: 'Builds' },
  { id: 'xl', label: 'XL', blocks: 128, hint: 'Landmarks' },
  { id: 'statue', label: 'Statue', blocks: 160, hint: 'Big detail' },
  { id: 'world', label: 'World', blocks: 384, hint: 'Minecraft height' },
  { id: 'custom', label: 'Custom', blocks: null, hint: 'Your numbers' },
]

export type SkinSizePresetId = '1x' | '2x' | '3x' | '4x' | 'custom'

export const SKIN_SIZE_PRESETS: {
  id: SkinSizePresetId
  label: string
  multiplier: number | null
  hint: string
}[] = [
  { id: '1x', label: '1× native', multiplier: 1, hint: 'Exact skin voxels' },
  { id: '2x', label: '2×', multiplier: 2, hint: 'Player statue' },
  { id: '3x', label: '3×', multiplier: 3, hint: 'Yard statue' },
  { id: '4x', label: '4×', multiplier: 4, hint: 'Giant statue' },
  { id: 'custom', label: 'Custom', multiplier: null, hint: 'Any size' },
]

export function matchObjSizePreset(part: ScenePartLocal): ObjSizePresetId {
  if (part.objSizePreset === 'auto' || part.objSizePreset === 'custom') {
    return part.objSizePreset
  }
  if (part.width === part.height && part.height === part.length) {
    const hit = OBJ_SIZE_PRESETS.find((preset) => preset.blocks === part.width)
    if (hit) return hit.id
  }
  if (
    part.objSizePreset === 'mini'
    || part.objSizePreset === 'small'
    || part.objSizePreset === 'medium'
    || part.objSizePreset === 'large'
    || part.objSizePreset === 'xl'
    || part.objSizePreset === 'statue'
    || part.objSizePreset === 'world'
  ) {
    return part.objSizePreset
  }
  return 'custom'
}

export function applyObjSizePreset(
  part: ScenePartLocal,
  presetId: ObjSizePresetId,
  fit: VoxelFit = 'fit',
): ScenePartLocal {
  if (presetId === 'custom') {
    return { ...part, objSizePreset: 'custom', fit }
  }
  if (presetId === 'auto') {
    return applyObjAutoSize(part)
  }
  const preset = OBJ_SIZE_PRESETS.find((item) => item.id === presetId)
  if (!preset?.blocks) return { ...part, fit, objSizePreset: presetId }
  const box = clampVoxelBox({
    width: preset.blocks,
    height: preset.blocks,
    length: preset.blocks,
  })
  return {
    ...part,
    width: box.width,
    height: box.height,
    length: box.length,
    fit,
    objSizePreset: presetId,
  }
}

export function applyObjAutoSize(part: ScenePartLocal): ScenePartLocal {
  // Measure the model the user actually kept, not the studio scene around it.
  const geometry =
    part.kind === 'obj' && !part.mimodelBytes?.length
      ? objGeometryBytes(part.bytes, part.excludedObjects)
      : part.bytes
  const span = estimateObjRobustSpan(geometry)
  const box = computeAutoObjBox(span)
  return {
    ...part,
    width: box.width,
    height: box.height,
    length: box.length,
    fit: 'fit',
    objSizePreset: 'auto',
  }
}

export function matchSkinSizePreset(part: ScenePartLocal): SkinSizePresetId {
  const native = part.slimArms ? nativeSlimSkinSize : nativeSkinSize
  for (const preset of SKIN_SIZE_PRESETS) {
    if (!preset.multiplier) continue
    if (
      part.width === native.width * preset.multiplier
      && part.height === native.height * preset.multiplier
      && part.length === native.length * preset.multiplier
    ) {
      return preset.id
    }
  }
  return 'custom'
}

/** Keep statue size, overlay limbs, and pose in lockstep with Steve/Alex arms. */
export function applySkinArmStyle(part: ScenePartLocal, slim: boolean): ScenePartLocal {
  const presetId = matchSkinSizePreset(part)
  const from = nativeBoxForSkin(part)
  const next: ScenePartLocal = {
    ...part,
    slimArms: slim,
    skinLimbs: part.skinLimbs === 'skeleton' ? 'skeleton' : slim ? 'slim' : 'classic',
  }
  if (presetId !== 'custom') {
    return applySkinSizePreset(next, presetId)
  }
  if (from.width <= 0) return next
  const to = nativeBoxForSkin(next)
  return {
    ...next,
    width: clampStatueAxis((part.width * to.width) / from.width),
    fit: 'fit',
  }
}

export function applySkinSizePreset(
  part: ScenePartLocal,
  presetId: SkinSizePresetId,
): ScenePartLocal {
  const preset = SKIN_SIZE_PRESETS.find((item) => item.id === presetId)
  if (!preset?.multiplier) return part
  const native = part.slimArms ? nativeSlimSkinSize : nativeSkinSize
  const m = preset.multiplier
  return {
    ...part,
    width: Math.min(MC_WORLD_HEIGHT, native.width * m),
    height: Math.min(MC_WORLD_HEIGHT, native.height * m),
    length: Math.min(MC_WORLD_HEIGHT, native.length * m),
    // Uniform fit — anisotropic stretch warps posed statues.
    fit: 'fit',
  }
}

export function describePartSize(part: ScenePartLocal): string {
  return `${part.width}×${part.height}×${part.length} blocks`
}

export type SkinSizeAxis = 'width' | 'height' | 'length'

function clampStatueAxis(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.round(value))
}

export function nativeBoxForSkin(part: Pick<ScenePartLocal, 'slimArms'>): {
  width: number
  height: number
  length: number
} {
  return part.slimArms ? nativeSlimSkinSize : nativeSkinSize
}

/** Scale W/H/L together from native skin proportions. The edited axis stays exact. */
export function applySkinLinkedAxis(
  part: ScenePartLocal,
  axis: SkinSizeAxis,
  value: number,
): ScenePartLocal {
  const native = nativeBoxForSkin(part)
  const base = native[axis]
  const target = clampStatueAxis(value)
  if (base <= 0) return part
  let width = Math.max(1, Math.round((native.width * target) / base))
  let height = Math.max(1, Math.round((native.height * target) / base))
  let length = Math.max(1, Math.round((native.length * target) / base))
  if (axis === 'width') width = target
  if (axis === 'height') height = target
  if (axis === 'length') length = target
  const box = clampVoxelBox({
    width,
    height,
    length,
  })
  return {
    ...part,
    width: box.width,
    height: box.height,
    length: box.length,
    fit: 'fit',
  }
}
