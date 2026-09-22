/**
 * One Rotate / Bend / Move mapping for skins, catalog cubes, and bone rigs.
 * The toolbar tools always mean the same thing; only the joint object differs.
 */
import type { Object3D } from 'three'
import { skinPoseLimbBase } from './characterPose'
import {
  findSkinBendObject,
  findSkinLimbObject,
  skinLimbSupportsBend,
  type SkinLimbId,
} from './playerSkinPreview'
import {
  meshBoneBendGroupName,
  meshBoneBendTargetId,
  meshBoneGroupName,
  meshBoneHingeAxisFor,
  meshBoneSupportsBend,
  type MeshBoneRig,
} from './meshBoneRig'
import {
  findMeshBendObject,
  meshPartGroupName,
  meshPoseHostLimbId,
} from './objPartPose'

export type PoseGizmoMode = 'rotate' | 'translate' | 'bend'

export type PoseGizmoPart = {
  kind: 'obj' | 'skin'
  useMeshBones?: boolean
  meshObjectNames?: string[]
}

export function poseGizmoChannel(mode: PoseGizmoMode): 'rot' | 'pos' | 'bend' {
  if (mode === 'translate') return 'pos'
  return mode === 'bend' ? 'bend' : 'rot'
}

export function poseGizmoHostLimb(limb: string): string {
  return meshPoseHostLimbId(skinPoseLimbBase(limb))
}

export function poseGizmoWriteLimb(
  mode: PoseGizmoMode,
  limb: string,
  useMeshBones: boolean,
  rig?: MeshBoneRig | null,
): string {
  const host = poseGizmoHostLimb(limb)
  if (useMeshBones && mode === 'bend') return meshBoneBendTargetId(host, rig)
  return host
}

/** Single hinge axis when Free bend is off; null = all axes. */
export function poseGizmoHingeAxis(
  mode: PoseGizmoMode,
  limb: string,
  freeBend: boolean,
  useMeshBones: boolean,
  rig?: MeshBoneRig | null,
): 0 | 1 | 2 | null {
  if (freeBend || mode !== 'bend') return null
  const host = poseGizmoHostLimb(limb)
  if (useMeshBones) return meshBoneHingeAxisFor(rig, host)
  if (skinLimbSupportsBend(host as SkinLimbId)) return 0
  return 0
}

export function findPoseGizmoTarget(
  group: Object3D,
  part: PoseGizmoPart,
  limb: string | null,
  mode: PoseGizmoMode,
  rig: MeshBoneRig | null,
): Object3D | null {
  if (!limb) return null
  const host = poseGizmoHostLimb(limb)

  if (part.useMeshBones) {
    if (host === 'root') return group.getObjectByName('mesh-bones') ?? null
    if (mode === 'bend' && meshBoneSupportsBend(host, rig)) {
      const bendId = meshBoneBendTargetId(host, rig)
      return (
        group.getObjectByName(meshBoneBendGroupName(bendId))
        ?? group.getObjectByName(meshBoneGroupName(bendId))
        ?? null
      )
    }
    return group.getObjectByName(meshBoneGroupName(host)) ?? null
  }

  const player = group.getObjectByName('player-skin')
  if (part.kind === 'skin' && player) {
    const skinLimb = host as SkinLimbId
    if (mode === 'bend') {
      return findSkinBendObject(player, skinLimb) ?? findSkinLimbObject(player, skinLimb)
    }
    return findSkinLimbObject(player, skinLimb)
  }

  if (part.meshObjectNames?.length) {
    if (host === 'root') return group.getObjectByName('mesh-parts') ?? null
    if (mode === 'bend') {
      return findMeshBendObject(group, host) ?? group.getObjectByName(meshPartGroupName(host)) ?? null
    }
    return group.getObjectByName(meshPartGroupName(host)) ?? null
  }

  return null
}
