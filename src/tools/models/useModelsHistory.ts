import type { ScenePartLocal } from '../../types'
import type { WorkflowStep } from './modelsPresets'
import { useDocumentHistory, type HistoryProgress } from '../../history/useDocumentHistory'

export type ModelsHistorySnapshot = {
  parts: ScenePartLocal[]
  selectedId: string | null
  shared: {
    disabledColorIds: number[]
    blockOverrides: Record<number, string>
    blockPack?: string
    disabledBlocks?: string[]
    blockSubstitutions?: Record<string, string>
    supportMode: string
    supportBlock: string
    colourMatching: string
    dither: string
    hue: number
    brightness: number
    contrast: number
    saturation: number
  }
  outer3d: boolean
  freeBend: boolean
  smoothJoints: boolean
  skinLimbBend: boolean
  placementDirty: boolean
  step: WorkflowStep
  showSourcePreview: boolean
}

export type { HistoryProgress }

const HEAVY_SNAPSHOT_BYTES = 1_500_000

function cloneVec(values: number[]): number[] {
  return values.slice()
}

function clonePose(
  pose: NonNullable<ScenePartLocal['skinPose']>,
): NonNullable<ScenePartLocal['skinPose']> {
  return {
    root: {
      pos: cloneVec(pose.root.pos),
      rot: cloneVec(pose.root.rot),
      bend: cloneVec(pose.root.bend),
      scale: cloneVec(pose.root.scale),
    },
    parts: Object.fromEntries(
      Object.entries(pose.parts).map(([key, value]) => [
        key,
        {
          pos: cloneVec(value.pos),
          rot: cloneVec(value.rot),
          bend: cloneVec(value.bend),
          scale: cloneVec(value.scale),
        },
      ]),
    ),
    pivots: pose.pivots
      ? Object.fromEntries(
          Object.entries(pose.pivots).map(([key, value]) => [key, cloneVec(value)]),
        )
      : pose.pivots,
    strokes: pose.strokes
      ? pose.strokes.map((stroke) => ({
          objectName: stroke.objectName,
          pivot: cloneVec(stroke.pivot),
          rot: cloneVec(stroke.rot),
          bend: cloneVec(stroke.bend),
          pos: cloneVec(stroke.pos),
        }))
      : pose.strokes,
    rigid: pose.rigid,
    poseParents: pose.poseParents ? { ...pose.poseParents } : pose.poseParents,
  }
}

/**
 * Snapshot parts without copying mesh/source payloads. Those buffers are treated
 * as immutable once loaded — cloning multi‑MB Maya/OBJ data on every undo step
 * was the main source of lag.
 */
export function clonePartsSnapshot(parts: ScenePartLocal[]): ScenePartLocal[] {
  return parts.map((part) => ({
    ...part,
    textures: { ...part.textures },
    uv: part.uv ? { ...part.uv } : part.uv,
    expectedTextureNames: [...part.expectedTextureNames],
    skinPose: part.skinPose ? clonePose(part.skinPose) : part.skinPose,
    meshBonePose: part.meshBonePose
      ? {
          root: {
            pos: cloneVec(part.meshBonePose.root.pos),
            rot: cloneVec(part.meshBonePose.root.rot),
            bend: cloneVec(part.meshBonePose.root.bend),
          },
          parts: Object.fromEntries(
            Object.entries(part.meshBonePose.parts).map(([key, value]) => [
              key,
              {
                pos: cloneVec(value.pos),
                rot: cloneVec(value.rot),
                bend: cloneVec(value.bend),
              },
            ]),
          ),
        }
      : part.meshBonePose,
  }))
}

function cloneShared(shared: ModelsHistorySnapshot['shared']): ModelsHistorySnapshot['shared'] {
  return {
    disabledColorIds: [...shared.disabledColorIds],
    blockOverrides: { ...shared.blockOverrides },
    blockPack: shared.blockPack || 'everything',
    disabledBlocks: [...(shared.disabledBlocks ?? [])],
    blockSubstitutions: { ...(shared.blockSubstitutions ?? {}) },
    supportMode: shared.supportMode,
    supportBlock: shared.supportBlock,
    colourMatching: shared.colourMatching || 'structureLabSmooth',
    dither: shared.dither || 'none',
    hue: shared.hue ?? 0,
    brightness: shared.brightness ?? 0,
    contrast: shared.contrast ?? 0,
    saturation: shared.saturation ?? 0,
  }
}

export function cloneModelsSnapshot(snapshot: ModelsHistorySnapshot): ModelsHistorySnapshot {
  return {
    parts: clonePartsSnapshot(snapshot.parts),
    selectedId: snapshot.selectedId,
    shared: cloneShared(snapshot.shared),
    outer3d: snapshot.outer3d,
    freeBend: snapshot.freeBend,
    smoothJoints: snapshot.smoothJoints,
    skinLimbBend: snapshot.skinLimbBend,
    placementDirty: snapshot.placementDirty,
    step: snapshot.step,
    showSourcePreview: snapshot.showSourcePreview,
  }
}

export function estimateSnapshotBytes(snapshot: ModelsHistorySnapshot): number {
  let total = 0
  for (const part of snapshot.parts) {
    total += part.bytes?.byteLength ?? 0
    total += part.mtlBytes?.byteLength ?? 0
    total += part.miobjectBytes?.byteLength ?? 0
    total += part.mimodelBytes?.byteLength ?? 0
    total += part.mayaBytes?.byteLength ?? 0
    total += part.daeBytes?.byteLength ?? 0
    total += part.fbxBytes?.byteLength ?? 0
    total += part.voxBytes?.byteLength ?? 0
    total += part.capeBytes?.byteLength ?? 0
    total += part.nativeMeshWeights?.indices?.byteLength ?? 0
    total += part.nativeMeshWeights?.weights?.byteLength ?? 0
    for (const bytes of Object.values(part.textures ?? {})) {
      total += bytes?.byteLength ?? 0
    }
  }
  return total
}

export function snapshotNeedsProgress(snapshot: ModelsHistorySnapshot): boolean {
  return (
    snapshot.parts.length >= 3
    || estimateSnapshotBytes(snapshot) >= HEAVY_SNAPSHOT_BYTES
  )
}

export function useModelsHistory(
  getSnapshot: () => ModelsHistorySnapshot,
  applySnapshot: (snapshot: ModelsHistorySnapshot) => void,
) {
  return useDocumentHistory(getSnapshot, applySnapshot, {
    cloneSnapshot: cloneModelsSnapshot,
    needsProgress: snapshotNeedsProgress,
  })
}
