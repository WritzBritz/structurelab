import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  applyStaticClipPlanes,
  boundsFromBox3,
  createFreeCameraNavigation,
  formatFreeHint,
  formatOrbitHint,
  MAX_FREE_SPEED,
  MIN_FREE_SPEED,
  readStoredFreeSpeed,
  writeStoredFreeSpeed,
  type FreeCameraNavigation,
  type PreviewNavigationBounds,
  type PreviewNavigationMode,
} from '../shared/freeCameraNavigation'
import { releaseWebGLRenderer } from '../shared/webglRelease'
import { OrbitPivotPanel } from '../shared/OrbitPivotPanel'
import { localFileSize, readLocalFileBytes } from '../../api'
import { Button, Slider, Text } from '@radix-ui/themes'
import { compactLabel, fileProgressLabel, Segmented } from '../../ui/kit'
import type { VoxelFit } from '../../types'
import type { PreviewResponse } from './objPreview.worker'
import {
  applySkinPoseToGroup,
  buildPlayerSkinGroup,
  skinBendPoseFromVisual,
  skinBendVisualAngles,
  skinObjectInvertsBend,
  SKIN_PREVIEW_SCALE,
  type CharacterPoseLike,
} from './playerSkinPreview'
import { skinPoseBendLimbId, skinPoseLimbBase } from './characterPose'
import { decodeImageRgba, ensureBrowserTexture, mimeForTextureBytes, sniffImageMime, textureLooksPixelArt } from './decodeImage'
import { exportNamesMatch } from './exportText'
import { buildVoxPreviewMesh } from './formats/vox'
import {
  applyMeshPartPoseToGroup,
  boundsFromPositions,
  buildPoseFollowerMap,
  computeBendSplitFromPositions,
  meshBendGroupName,
  meshPartGroupName,
  meshPoseHostLimbId,
  OBJ_DEFAULT_OBJECT,
  type MeshPartPose,
} from './objPartPose'
import {
  findPoseGizmoTarget,
  poseGizmoChannel,
  poseGizmoHingeAxis,
  poseGizmoHostLimb,
  poseGizmoWriteLimb,
} from './poseGizmo'
import {
  applyMeshBonePoseToPositions,
  clampMeshBoneBend,
  computeMeshBoneMatrices,
  computeMeshBoneWeights,
  hardenMeshBoneWeights,
  meshSkinModeOf,
  unifyRigidGeometryWeights,
  createRestMeshBonePose,
  ensureMeshBonePose,
  fitMeshBones,
  mat4LocalFromWorld,
  meshBoneBendBindLocalMatrix,
  meshBoneBendGroupName,
  meshBoneBendTargetId,
  meshBoneBindLocalMatrix,
  meshBoneGroupName,
  meshBoneMatIdentity,
  meshBoneParentPoseWorld,
  meshBonePoseToSkinPose,
  meshBonePoseWithoutRoot,
  meshBoneSupportsBend,
  playerSkinHumanoidRig,
  posePosFromGizmoLocal,
  poseRotFromGizmoLocal,
  roundMeshBoneOffset,
  type MeshBonePose,
  type MeshBoneRig,
  type MeshBoneWeights,
  type MeshRigMode,
  type MeshSkinMode,
} from './meshBoneRig'

type GizmoMode = 'rotate' | 'translate' | 'bend'

/**
 * Offsets live in the model's own units, so a fixed 0.1 step throws away most of
 * a drag on a metre-scale COLLADA rig (the joint snaps straight back to rest).
 * Bone parts quantize against their rig; everything else keeps the old step.
 */
function quantizeOffset(value: number, rig: MeshBoneRig | null | undefined): number {
  if (!rig) return Math.round(value * 10) / 10
  return roundMeshBoneOffset(value, rig)
}

export type MeshPreviewPart = {
  id: string
  fileName: string
  bytes: Uint8Array
  kind: 'obj' | 'skin'
  /** Objects filtered out of `bytes`; two sets can coincidentally match in size. */
  excludedObjects?: readonly string[]
  sourcePath?: string | null
  sourceLabel?: string | null
  mtlBytes?: Uint8Array | null
  textures?: Record<string, Uint8Array>
  voxBytes?: Uint8Array | null
  slimArms?: boolean
  showOuterLayer?: boolean
  skinOverlay?: 'full' | 'hat' | 'none'
  skinLimbs?: 'classic' | 'slim' | 'skeleton'
  capeBytes?: Uint8Array | null
  capeId?: string | null
  capeFileName?: string | null
  pose?: CharacterPoseLike | null
  jointStyle?: 'mineimator' | 'blockbench'
  positionX: number
  positionY: number
  positionZ: number
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  width: number
  height: number
  length: number
  fit: VoxelFit
  /** Named OBJ `o` groups — enables per-mesh posing (Maya, glTF, bbmodel, etc.). */
  meshObjectNames?: string[]
  /** Auto bones for Maya/OBJ, or optional bone mode for skins / Mine-imator. */
  useMeshBones?: boolean
  /** Which skeleton to fit: classic joints, anatomical template, shape-derived, or auto. */
  rigMode?: MeshRigMode
  /** Source-format skeleton/weights, used when rigMode is `native`. */
  nativeRig?: MeshBoneRig | null
  nativeWeights?: MeshBoneWeights | null
  bonePose?: MeshBonePose | null
  /** Rigid cubes (Minecraft) vs blended stretch skinning. */
  meshSkinMode?: 'rigid' | 'stretch' | null
}

type Props = {
  parts: MeshPreviewPart[]
  selectedId: string | null
  selectedLimbId?: string | null
  onSelectPartId?: (id: string) => void
  onSelectLimbId?: (limb: string) => void
  onLimbPoseChange?: (
    limb: string,
    channel: 'pos' | 'rot' | 'bend',
    values: [number, number, number],
  ) => void
  onPoseEditStart?: () => void
  onPoseEditEnd?: () => void
  /** Click on the mesh sets the rotate/bend joint for that body part. */
  onPosePivotChange?: (limb: string, localPoint: [number, number, number]) => void
  /** Whole-object move/rotate when the part has no limb rig (catalog mobs). */
  onPartPlacementChange?: (
    position: [number, number, number],
    rotation: [number, number, number],
  ) => void
  onProgress?: (ratio: number, label: string) => void
  navigationMode?: PreviewNavigationMode
  /** When off, Bend is a single hinge axis (elbows/knees/waist). */
  freeBend?: boolean
}

/**
 * Raw source preview — shows one or many uploaded meshes/skins before voxelization.
 * OBJ parsing runs in a worker so the UI stays responsive.
 */
export default function MeshPreviewViewer({
  parts,
  selectedId,
  selectedLimbId = null,
  onSelectPartId,
  onSelectLimbId,
  onLimbPoseChange,
  onPoseEditStart,
  onPoseEditEnd,
  onPosePivotChange,
  onPartPlacementChange,
  onProgress,
  navigationMode = 'orbit',
  freeBend = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const navHintRef = useRef<HTMLDivElement>(null)
  const navApiRef = useRef<FreeCameraNavigation | null>(null)
  const navigationModeRef = useRef(navigationMode)
  navigationModeRef.current = navigationMode
  const freeBendRef = useRef(freeBend)
  freeBendRef.current = freeBend
  const freeLockedRef = useRef(false)
  const [freeSpeed, setFreeSpeed] = useState(readStoredFreeSpeed)
  const freeSpeedRef = useRef(freeSpeed)
  freeSpeedRef.current = freeSpeed
  const [orbitOffset, setOrbitOffset] = useState<[number, number, number]>([0, 0, 0])
  const [orbitSpan, setOrbitSpan] = useState(1)
  const setFreeSpeedValue = useCallback((value: number) => {
    const clamped = Math.min(MAX_FREE_SPEED, Math.max(MIN_FREE_SPEED, value))
    freeSpeedRef.current = clamped
    setFreeSpeed(clamped)
    writeStoredFreeSpeed(clamped)
  }, [])
  const [status, setStatus] = useState('Loading preview…')
  const [error, setError] = useState<string | null>(null)
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('rotate')
  // Turning the rig off leaves the bare model, for judging shape and materials.
  const [showRig, setShowRig] = useState(true)
  const groupsRef = useRef<Map<string, THREE.Group>>(new Map())
  const partsRef = useRef(parts)
  partsRef.current = parts
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const selectedLimbRef = useRef(selectedLimbId)
  selectedLimbRef.current = selectedLimbId
  const onSelectRef = useRef(onSelectPartId)
  onSelectRef.current = onSelectPartId
  const onSelectLimbRef = useRef(onSelectLimbId)
  onSelectLimbRef.current = onSelectLimbId
  const onLimbPoseRef = useRef(onLimbPoseChange)
  onLimbPoseRef.current = onLimbPoseChange
  const onPoseEditStartRef = useRef(onPoseEditStart)
  onPoseEditStartRef.current = onPoseEditStart
  const onPoseEditEndRef = useRef(onPoseEditEnd)
  onPoseEditEndRef.current = onPoseEditEnd
  const onPosePivotRef = useRef(onPosePivotChange)
  onPosePivotRef.current = onPosePivotChange
  const onPartPlacementRef = useRef(onPartPlacementChange)
  onPartPlacementRef.current = onPartPlacementChange
  const gizmoModeRef = useRef(gizmoMode)
  gizmoModeRef.current = gizmoMode
  const setGizmoModeRef = useRef(setGizmoMode)
  setGizmoModeRef.current = setGizmoMode
  const showRigRef = useRef(showRig)
  showRigRef.current = showRig
  const sceneApiRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    nav: FreeCameraNavigation
    transform: TransformControls | null
    boxHelper: THREE.BoxHelper | null
    dragging: boolean
    invalidate: () => void
    root: THREE.Group
    navBounds: { current: PreviewNavigationBounds }
  } | null>(null)

  // Pose and statue size update live. Size is not in this key — remounting on
  // every slider tick rebuilt the mesh and refit the camera, so the figure
  // looked unchanged.
  const partsKey = useMemo(
    () =>
      parts
        .map(
          (part) =>
            [
              part.id,
              part.kind,
              part.fileName,
              part.bytes.length,
              [...(part.excludedObjects ?? [])].sort().join(','),
              part.sourcePath ?? '',
              part.voxBytes?.length ?? 0,
              part.mtlBytes?.length ?? 0,
              Object.keys(part.textures ?? {}).sort().join(','),
              part.slimArms ? 1 : 0,
              part.showOuterLayer ? 1 : 0,
              part.skinOverlay ?? '',
              part.skinLimbs ?? '',
              part.capeBytes?.length ?? 0,
              part.capeId ?? '',
              part.capeFileName ?? '',
              part.jointStyle ?? '',
              part.useMeshBones ? 1 : 0,
              part.rigMode ?? '',
              part.meshSkinMode ?? '',
            ].join(':'),
        )
        .join('|'),
    [parts],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (parts.length === 0) {
      setStatus('No sources')
      setError(null)
      host.replaceChildren()
      sceneApiRef.current = null
      return
    }

    let disposed = false
    let frame = 0
    let renderer: THREE.WebGLRenderer | null = null
    let nav: FreeCameraNavigation | null = null
    let transform: TransformControls | null = null
    const clock = new THREE.Clock()
    const objectUrls: string[] = []
    const texturesToDispose: THREE.Texture[] = []
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x151b24)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000)
    const root = new THREE.Group()
    scene.add(root)
    const navBounds = { current: boundsFromBox3(new THREE.Box3()) }
    const ambient = new THREE.AmbientLight(0xffffff, 1.15)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4452, 0.85)
    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(6, 14, 8)
    const fill = new THREE.DirectionalLight(0xd7e7ff, 0.55)
    fill.position.set(-8, 5, -6)
    const rim = new THREE.DirectionalLight(0xffffff, 0.4)
    rim.position.set(0, 8, -10)
    scene.add(ambient, hemi, key, fill, rim)

    setError(null)
    setStatus(parts.length === 1 ? 'Loading preview…' : `Loading ${parts.length} objects…`)
    const report = (ratio: number, label: string) => {
      if (disposed) return
      onProgress?.(ratio, label)
    }
    report(0.02, 'Starting preview…')
    groupsRef.current = new Map()

    const applySelectionHighlight = (id: string | null) => {
      for (const [partId, group] of groupsRef.current) {
        applyPartFade(group, id == null || partId === id)
      }
    }

    const abortBootGl = () => {
      try {
        transform?.dispose()
      } catch {
        /* ignore */
      }
      try {
        nav?.dispose()
      } catch {
        /* ignore */
      }
      releaseWebGLRenderer(renderer)
      transform = null
      nav = null
      renderer = null
      if (sceneApiRef.current?.scene === scene) sceneApiRef.current = null
      navApiRef.current = null
    }

    const boot = async () => {
      if (disposed) return
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          logarithmicDepthBuffer: true,
        })
        renderer.setClearColor(0x151b24, 1)
      } catch (err) {
        if (!disposed) setError(`WebGL failed: ${String(err)}`)
        report(1, 'Preview failed')
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.NoToneMapping
      if (disposed) {
        abortBootGl()
        return
      }
      host.replaceChildren(renderer.domElement)

      // Skip GPU work while idle — still tick for orbit damping / free-cam keys.
      let needsRender = true
      const invalidate = () => {
        needsRender = true
      }

      const setNavHint = (text: string) => {
        if (navHintRef.current) navHintRef.current.textContent = text
      }

      nav = createFreeCameraNavigation({
        camera,
        canvas: renderer.domElement,
        viewerRoot: host.parentElement,
        sceneKey: partsKey,
        getBounds: () => navBounds.current,
        navigationModeRef,
        onHint: setNavHint,
        freeSpeedRef,
        onFreeSpeedChange: setFreeSpeedValue,
        onActivity: invalidate,
        onOrbitTargetChange: (offset, span) => {
          setOrbitOffset(offset)
          setOrbitSpan(span)
        },
      })
      navApiRef.current = nav
      nav.applyMode(navigationModeRef.current)

      // Gizmo is optional — never let it take down skin preview on load.
      let boxHelper: THREE.BoxHelper | null = null
      try {
        transform = new TransformControls(camera, renderer.domElement)
        transform.setSize(0.85)
        transform.setMode(gizmoModeRef.current === 'translate' ? 'translate' : 'rotate')
        transform.setSpace('local')
        const helper = transform.getHelper()
        helper.visible = false
        scene.add(helper)
        boxHelper = new THREE.BoxHelper(new THREE.Object3D(), 0x5b9fd4)
        boxHelper.visible = false
        scene.add(boxHelper)
      } catch (err) {
        console.warn('[preview] TransformControls unavailable', err)
        transform = null
        boxHelper = null
      }

      if (disposed) {
        abortBootGl()
        return
      }

      const api = {
        scene,
        camera,
        nav,
        transform,
        boxHelper,
        dragging: false,
        invalidate,
        root,
        navBounds,
      }
      sceneApiRef.current = api

      if (transform) {
        const gizmo = transform
        const onGizmoDrag = (dragging: boolean) => {
          api.dragging = dragging
          invalidate()
          const orbit = nav?.getOrbit()
          if (orbit) orbit.enabled = !dragging
          if (dragging) {
            onPoseEditStartRef.current?.()
          } else {
            syncLimbFromGizmo()
            onPoseEditEndRef.current?.()
          }
        }
        gizmo.addEventListener('dragging-changed', (event) => {
          if (navigationModeRef.current === 'free') {
            gizmo.enabled = false
            gizmo.detach()
            return
          }
          onGizmoDrag(Boolean((event as { value?: boolean }).value))
        })
        // Three r170+ also fires mouseDown/mouseUp; keep both so a missed
        // dragging-changed cannot leave the joint uncommitted (it then snaps back).
        gizmo.addEventListener('mouseDown', () => {
          if (navigationModeRef.current === 'free') return
          if (!api.dragging) onGizmoDrag(true)
        })
        gizmo.addEventListener('mouseUp', () => {
          if (navigationModeRef.current === 'free') return
          if (api.dragging) onGizmoDrag(false)
        })
        // Live mesh-bone skin + OBJ part morph while the gizmo moves.
        gizmo.addEventListener('objectChange', () => {
          if (navigationModeRef.current === 'free') return
          if (!api.dragging) return
          invalidate()
          const part = partsRef.current.find((entry) => entry.id === selectedIdRef.current)
          const group = part ? groupsRef.current.get(part.id) : undefined
          if (!part || !group) return
          if (part.useMeshBones) {
            const live = liveMeshBonePoseFromGizmo(part)
            if (!live) return
            const preserveRoot =
              selectedLimbRef.current === 'root'
              && transform?.object?.name === 'mesh-bones'
                ? transform.object
                : null
            applyMeshBonePoseToPreview(group, live, {
              preserveObject: preserveRoot,
              deform: meshSkinModeOf(part),
            })
            if (part.kind === 'skin') {
              const player = group.getObjectByName('player-skin')
              if (player) applySkinPoseToGroup(player, meshBonePoseToSkinPose(live))
            }
            return
          }
          if (part.meshObjectNames?.length) {
            const live = liveMeshPartPoseFromGizmo(part)
            if (live) applyMeshPartPoseToGroup(group, live)
          }
        })
      }

      const labels: string[] = []
      try {
        for (let index = 0; index < parts.length; index += 1) {
          if (disposed) {
            abortBootGl()
            return
          }
          const part = parts[index]!
          const base = index / Math.max(parts.length, 1)
          const span = 1 / Math.max(parts.length, 1)
          report(0.04 + base * 0.86, fileProgressLabel('Loading', part.fileName))
          const loaded = await loadPartGroup(part, {
            onProgress: (ratio, label) => {
              if (!disposed) report(0.04 + (base + ratio * span) * 0.86, label)
            },
            trackUrl: (url) => objectUrls.push(url),
            trackTexture: (texture) => texturesToDispose.push(texture),
          })
          if (disposed) {
            abortBootGl()
            return
          }
          if (!loaded) {
            labels.push(`${compactLabel(part.fileName, 28)} (waiting)`)
            continue
          }
          placePartGroup(loaded.group, part)
          loaded.group.userData.partId = part.id
          root.add(loaded.group)
          groupsRef.current.set(part.id, loaded.group)
          labels.push(loaded.label)
        }

        if (disposed) {
          abortBootGl()
          return
        }
        if (groupsRef.current.size === 0) {
          setStatus('Waiting for source data…')
          report(1, 'Waiting')
        } else {
          applySelectionHighlight(selectedIdRef.current)
          root.updateMatrixWorld(true)
          navBounds.current = boundsFromBox3(new THREE.Box3().setFromObject(root))
          nav?.applyMode(navigationModeRef.current)
          if (navigationModeRef.current === 'orbit') {
            nav?.placeOrbitCamera(true)
          }
          const loaded = groupsRef.current.size
          setStatus(
            loaded === 1
              ? labels[0] ?? compactLabel(parts[0]!.fileName, 28)
              : `${loaded} objects together in preview`,
          )
          syncPoseAndPlacement()
          report(0.92, 'Drawing preview…')
          // Defer gizmo attach one frame so matrices are settled (avoids WebView crash).
          requestAnimationFrame(() => {
            if (!disposed) syncLimbGizmo()
          })
        }
      } catch (err) {
        if (!disposed) {
          const message = String(err)
          if (/triangle|pending mimodel|no mesh|empty/i.test(message)) {
            setError(null)
            setStatus('Waiting for companion .mimodel / texture…')
          } else {
            setError(message)
          }
          report(1, 'Preview failed')
        }
        return
      }

      const resize = () => {
        if (!renderer || !host) return
        const width = host.clientWidth
        const height = Math.max(host.clientHeight, 1)
        camera.aspect = width / height
        applyStaticClipPlanes(
          camera,
          navBounds.current.span,
          navigationModeRef.current,
          navBounds.current.maxFreeDist,
        )
        renderer.setSize(width, height, false)
        invalidate()
      }
      resize()
      requestAnimationFrame(() => {
        if (disposed || !renderer || !nav) return
        resize()
        if (groupsRef.current.size > 0) {
          root.updateMatrixWorld(true)
          navBounds.current = boundsFromBox3(new THREE.Box3().setFromObject(root))
          if (navigationModeRef.current === 'orbit') {
            nav.placeOrbitCamera(true)
          }
          renderer.render(scene, camera)
          // Keep the shared overlay up until this frame is actually presented.
          requestAnimationFrame(() => {
            if (!disposed) report(1, 'Preview ready')
          })
        }
      })
      const observer = new ResizeObserver(resize)
      observer.observe(host)

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const onPointerDown = (event: PointerEvent) => {
        if (!renderer || api.dragging) return
        if (transform?.dragging) return
        if (navigationModeRef.current === 'free') return
        const selectedPreview = partsRef.current.find((entry) => entry.id === selectedIdRef.current)
        const placeWhole = isWholePartPlacement(
          selectedPreview,
          selectedLimbRef.current,
        )
        // With the rig hidden the preview is for looking, not posing — except
        // whole-model Move/Rotate on catalog mobs, which has no bone overlay.
        if (!showRigRef.current && !placeWhole) return
        const rect = renderer.domElement.getBoundingClientRect()
        const localX = event.clientX - rect.left
        const localY = event.clientY - rect.top
        if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
          return
        }
        pointer.x = (localX / rect.width) * 2 - 1
        pointer.y = -(localY / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        raycaster.params.Line = { threshold: 0.02 }

        const gizmoHit = closestGizmoHit(transform, raycaster)
        const meshHits = meshLimbHits(
          raycaster,
          groupsRef.current.values(),
          selectedLimbRef.current,
        )
        const meshHit = meshHits[0] ?? null
        const meshPick = meshHit ? parseLimbPick(meshHit) : null

        // Bone joint balls (mesh-bone rigs) — screen-space pick.
        const handle = pickBoneHandleAt(
          groupsRef.current.values(),
          camera,
          localX,
          localY,
          rect.width,
          rect.height,
          gizmoModeRef.current === 'bend' ? 'bend' : 'rot',
          HANDLE_PICK_PADDING_PX,
        )
        if (handle) {
          let handlePartId: string | undefined
          let handleLimbId: string | undefined
          let node: THREE.Object3D | null = handle
          while (node) {
            if (!handleLimbId && typeof node.userData.limbId === 'string') {
              handleLimbId = meshPoseHostLimbId(node.userData.limbId)
            }
            if (!handlePartId && typeof node.userData.partId === 'string') {
              handlePartId = node.userData.partId
            }
            node = node.parent
          }
          if (handleLimbId != null || handlePartId != null) {
            const baseLimb = handleLimbId ? skinPoseLimbBase(handleLimbId) : null
            const nextLimbId = baseLimb ?? handleLimbId
            const sameLimb = nextLimbId != null && nextLimbId === selectedLimbRef.current
            if (!sameLimb || !gizmoShouldCapture(transform, gizmoHit, meshHit, selectedLimbRef.current, meshPick?.limbId ?? null)) {
              if (handlePartId) onSelectRef.current?.(handlePartId)
              if (nextLimbId) onSelectLimbRef.current?.(nextLimbId)
              event.stopPropagation()
            }
            return
          }
        }

        // Gizmo handle in front — pose, do not retarget.
        if (gizmoShouldCapture(transform, gizmoHit, meshHit, selectedLimbRef.current, meshPick?.limbId ?? null)) {
          return
        }

        if (meshPick) {
          const previewPart = partsRef.current.find((entry) => entry.id === meshPick.partId)
          onSelectRef.current?.(meshPick.partId)
          onSelectLimbRef.current?.(meshPick.limbId)
          if (meshPick.skinHandle === 'bend') setGizmoModeRef.current('bend')
          else if (meshPick.skinHandle === 'rot') setGizmoModeRef.current('rotate')
          event.stopPropagation()
          if (
            !previewPart?.sourceLabel?.startsWith('Minecraft')
            && !previewPart?.useMeshBones
            && meshPick.partGroup
            && meshPick.limbId !== 'root'
            && onPosePivotRef.current
            && meshHit
          ) {
            meshPick.partGroup.updateWorldMatrix(true, false)
            const local = meshPick.partGroup.worldToLocal(meshHit.point.clone())
            const restPivot =
              (meshPick.partGroup.userData.restPivot as [number, number, number] | undefined)
              ?? [0, 0, 0]
            onPosePivotRef.current(meshPoseHostLimbId(meshPick.limbId), [
              local.x + restPivot[0],
              local.y + restPivot[1],
              local.z + restPivot[2],
            ])
          }
        }
      }
      // Capture on the host: the gizmo and orbit controls bind to the canvas
      // itself, and this has to get a look at the click before they consume it.
      host.addEventListener('pointerdown', onPointerDown, true)

      // Hover cue, so the generous pick radius is discoverable rather than luck.
      const onPointerMove = (event: PointerEvent) => {
        if (!renderer || api.dragging || event.buttons !== 0) return
        if (navigationModeRef.current === 'free') {
          renderer.domElement.style.cursor = ''
          return
        }
        const hoverPreview = partsRef.current.find((entry) => entry.id === selectedIdRef.current)
        const hoverPlaceWhole = isWholePartPlacement(
          hoverPreview,
          selectedLimbRef.current,
        )
        if (!showRigRef.current && !hoverPlaceWhole) {
          renderer.domElement.style.cursor = ''
          return
        }
        const rect = renderer.domElement.getBoundingClientRect()
        const localX = event.clientX - rect.left
        const localY = event.clientY - rect.top
        const overHandle = pickBoneHandleAt(
          groupsRef.current.values(),
          camera,
          localX,
          localY,
          rect.width,
          rect.height,
          gizmoModeRef.current === 'bend' ? 'bend' : 'rot',
        )
        if (overHandle) {
          renderer.domElement.style.cursor = 'pointer'
          return
        }
        pointer.x = (localX / rect.width) * 2 - 1
        pointer.y = -(localY / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        raycaster.params.Line = { threshold: 0.02 }
        const overMesh = meshLimbHits(
          raycaster,
          groupsRef.current.values(),
          selectedLimbRef.current,
        ).length > 0
        renderer.domElement.style.cursor = overMesh ? 'pointer' : ''
      }
      renderer.domElement.addEventListener('pointermove', onPointerMove)

      const tick = () => {
        if (disposed || !renderer || !nav) return
        frame = requestAnimationFrame(tick)
        const dt = Math.min(clock.getDelta(), 0.05)
        const cameraMoved = nav.updateTick(dt)
        freeLockedRef.current = nav.isFreeLocked()
        if (!cameraMoved && !needsRender && !api.dragging) return
        needsRender = false
        if (boxHelper?.visible) boxHelper.update()
        sizeBoneHandles(
          groupsRef.current.values(),
          camera,
          renderer.domElement.clientHeight,
        )
        renderer.render(scene, camera)
      }
      tick()

      return () => {
        observer.disconnect()
        host.removeEventListener('pointerdown', onPointerDown, true)
        renderer?.domElement.removeEventListener('pointermove', onPointerMove)
      }
    }

    let cleanupExtras: (() => void) | undefined
    void boot().then((cleanup) => {
      cleanupExtras = cleanup
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cleanupExtras?.()
      try {
        transform?.dispose()
      } catch {
        /* ignore */
      }
      try {
        nav?.dispose()
      } catch {
        /* ignore */
      }
      releaseWebGLRenderer(renderer)
      renderer = null
      const disposedMaterials = new Set<THREE.Material>()
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const material of materials) {
            if (disposedMaterials.has(material)) continue
            disposedMaterials.add(material)
            material.dispose()
          }
        }
      })
      for (const url of objectUrls) URL.revokeObjectURL(url)
      for (const texture of texturesToDispose) texture.dispose()
      groupsRef.current = new Map()
      sceneApiRef.current = null
      navApiRef.current = null
      host.replaceChildren()
    }
    // partsKey captures content; parts is read inside for current snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey, onProgress])

  function syncPoseAndPlacement() {
    const api = sceneApiRef.current
    api?.invalidate()
    // Moving the bend joint while TransformControls is attached can yank the
    // parent mesh (looks like the model jumps up on click).
    if (api?.transform && !api.dragging) {
      try {
        api.transform.detach()
      } catch {
        /* ignore */
      }
    }
    let statueBoxChanged = false
    for (const part of partsRef.current) {
      const group = groupsRef.current.get(part.id)
      if (!group) continue
      const bones = group.getObjectByName('mesh-bones')
      if (bones) {
        const selectedId = selectedIdRef.current
        bones.visible =
          showRigRef.current
          && (selectedId == null || part.id === selectedId)
      }
      const nextBox = statueBoxKey(part)
      if (group.userData.statueBoxKey !== nextBox) {
        statueBoxChanged = true
        group.userData.statueBoxKey = nextBox
      }
      const placementKey = placementSyncKey(part)
      // Re-snapping AABB on every pose edit shifts the whole figure — only when
      // placement or the statue box changes. Size stays off partsKey so the
      // source mesh is not rebuilt on every slider tick.
      if (group.userData.placementKey !== placementKey) {
        const meshSize = group.userData.meshSize as { x: number; y: number; z: number } | undefined
        if (meshSize) {
          group.userData.placementScale = placementScaleFromMeshSize(meshSize, part)
        }
        applyPlacement(group, part)
        group.userData.placementKey = placementKey
      }
      if (part.kind === 'skin' && part.useMeshBones) {
        if (api?.dragging) continue
        const player = group.getObjectByName('player-skin')
        const bonePose = part.bonePose ?? ensureMeshBonePose(null, rigOf(part.id))
        applyMeshBonePoseToPreview(group, bonePose, { deform: meshSkinModeOf(part) })
        if (player) applySkinPoseToGroup(player, meshBonePoseToSkinPose(bonePose))
      } else if (part.kind === 'skin') {
        if (api?.dragging) continue
        const player = group.getObjectByName('player-skin')
        if (player) applySkinPoseToGroup(player, part.pose)
      } else if (part.useMeshBones) {
        // Don't fight the live gizmo skin — commit lands on drag end.
        if (api?.dragging) continue
        applyMeshBonePoseToPreview(group, part.bonePose, { deform: meshSkinModeOf(part) })
      } else if (part.meshObjectNames?.length) {
        // Always apply — bend morphs verts; rotate/pos match the gizmo after each commit.
        applyMeshPartPoseToGroup(group, part.pose as MeshPartPose | null | undefined)
      }
    }
    if (statueBoxChanged && api && !api.dragging) {
      api.root.updateMatrixWorld(true)
      const previous = api.navBounds.current
      api.navBounds.current = boundsFromBox3(new THREE.Box3().setFromObject(api.root))
      api.nav.followContent(previous)
    }
  }

  /** Fitted rig for a part, once its geometry has been built. */
  function rigOf(partId: string | undefined | null): MeshBoneRig | null {
    if (!partId) return null
    return (
      (groupsRef.current.get(partId)?.userData.meshBoneRig as MeshBoneRig | undefined)
      ?? null
    )
  }

  /** Hinge mode keeps one swing axis; Free bend keeps authored XYZ. */
  function hingeBendAngles(
    part: MeshPreviewPart | undefined,
    limb: string,
    angles: [number, number, number],
  ): [number, number, number] {
    if (freeBendRef.current) return angles
    if (!part) return angles
    const rig = groupsRef.current.get(part.id)?.userData.meshBoneRig as
      | MeshBoneRig
      | undefined
    if (!rig) {
      return [angles[0], 0, 0]
    }
    return clampMeshBoneBend(rig, limb, angles)
  }

  function eulerDegreesFromObject(object: THREE.Object3D): [number, number, number] {
    object.updateMatrix()
    return [
      THREE.MathUtils.radToDeg(object.rotation.x),
      THREE.MathUtils.radToDeg(object.rotation.y),
      THREE.MathUtils.radToDeg(object.rotation.z),
    ]
  }

  function threeMatrixToMat4(matrix: THREE.Matrix4): number[] {
    return Array.from(matrix.elements)
  }

  /** Read mesh-bone pose channels from gizmo local matrix vs bind (not raw Euler). */
  function meshBoneChannelFromGizmo(
    part: MeshPreviewPart,
    limb: string,
    channel: 'rot' | 'bend' | 'pos',
    object: THREE.Object3D,
  ): [number, number, number] | null {
    const rig = rigOf(part.id)
    if (!rig) return null
    const bindMatrices = computeMeshBoneMatrices(rig, createRestMeshBonePose(rig))
    object.updateWorldMatrix(true, false)
    object.updateMatrix()
    const currentLocal = threeMatrixToMat4(object.matrix)

    if (channel === 'pos') {
      if (limb === 'root') return posePosFromGizmoLocal(meshBoneMatIdentity(), currentLocal)
      const boneIndex = rig.indexOf[limb]
      if (boneIndex == null) return null
      const bindLocal = meshBoneBindLocalMatrix(rig, boneIndex, bindMatrices)
      return posePosFromGizmoLocal(bindLocal, currentLocal)
    }

    if (limb === 'root') {
      return poseRotFromGizmoLocal(meshBoneMatIdentity(), currentLocal)
    }

    const writeLimb = channel === 'bend' ? meshBoneBendTargetId(limb, rig) : limb
    const boneIndex = rig.indexOf[writeLimb]
    if (boneIndex == null) return null

    const bindLocal =
      channel === 'bend' && rig.bones[boneIndex]!.hasBend && bindMatrices.bendBind[boneIndex]
        ? meshBoneBendBindLocalMatrix(boneIndex, bindMatrices)
        : meshBoneBindLocalMatrix(rig, boneIndex, bindMatrices)
    return poseRotFromGizmoLocal(bindLocal, currentLocal)
  }

  function quantizeDegrees(angles: [number, number, number]): [number, number, number] {
    return [
      Math.round(angles[0] * 10) / 10,
      Math.round(angles[1] * 10) / 10,
      Math.round(angles[2] * 10) / 10,
    ]
  }

  function isWholePartPlacement(
    part: MeshPreviewPart | undefined,
    limb: string | null = selectedLimbRef.current,
  ): boolean {
    if (!part || part.kind === 'skin' || part.useMeshBones) return false
    if (!part.meshObjectNames?.length) return true
    return limb === 'root'
  }

  function syncPlacementFromGizmo(part: MeshPreviewPart, group: THREE.Object3D) {
    const start = group.userData.placeDrag as
      | { pos: THREE.Vector3; partPos: [number, number, number] }
      | undefined
    const rotation: [number, number, number] = [
      Math.round(THREE.MathUtils.radToDeg(group.rotation.x) * 10) / 10,
      Math.round(THREE.MathUtils.radToDeg(group.rotation.y) * 10) / 10,
      Math.round(THREE.MathUtils.radToDeg(group.rotation.z) * 10) / 10,
    ]
    const position: [number, number, number] = start
      ? [
          Math.round((start.partPos[0] + group.position.x - start.pos.x) * 10) / 10,
          Math.round((start.partPos[1] + group.position.y - start.pos.y) * 10) / 10,
          Math.round((start.partPos[2] + group.position.z - start.pos.z) * 10) / 10,
        ]
      : [part.positionX, part.positionY, part.positionZ]
    onPartPlacementRef.current?.(position, rotation)
  }

  function syncLimbFromGizmo() {
    const api = sceneApiRef.current
    if (!api?.transform) return
    const object = api.transform.object
    if (!object) return
    const part = partsRef.current.find((entry) => entry.id === selectedIdRef.current)
    if (isWholePartPlacement(part) && part) {
      syncPlacementFromGizmo(part, object)
      return
    }
    if (!onLimbPoseRef.current) return
    const limbRaw = selectedLimbRef.current
    if (!limbRaw) return
    const limb = poseGizmoHostLimb(limbRaw)
    const mode = gizmoModeRef.current
    const isSkin = part?.kind === 'skin'
    const useMeshBones = Boolean(part?.useMeshBones)
    if (mode === 'rotate' || mode === 'bend') {
      const channel = poseGizmoChannel(mode)
      const writeLimb = poseGizmoWriteLimb(mode, limbRaw, useMeshBones, part ? rigOf(part.id) : null)
      if (useMeshBones && part) {
        const raw = meshBoneChannelFromGizmo(part, limb, channel, object)
        if (!raw || !raw.every(Number.isFinite)) return
        let angles = quantizeDegrees(raw)
        if (channel === 'bend') angles = hingeBendAngles(part, writeLimb, angles)
        onLimbPoseRef.current(writeLimb, channel, angles)
        return
      }
      const [rawX, rawY, rawZ] = eulerDegreesFromObject(object)
      if (![rawX, rawY, rawZ].every(Number.isFinite)) return
      let angles = quantizeDegrees([rawX, rawY, rawZ])
      if (isSkin && channel === 'bend') {
        angles = skinBendPoseFromVisual(angles, skinObjectInvertsBend(object))
      }
      onLimbPoseRef.current(writeLimb, channel, angles)
      return
    }
    const base =
      (object.userData.baseLocal as [number, number, number] | undefined)
      ?? (limb === 'root' ? [0, 0, 0] : [object.position.x, object.position.y, object.position.z])
    const posScale = isSkin && !useMeshBones ? SKIN_PREVIEW_SCALE : 1
    const snap = (value: number) => quantizeOffset(value / posScale, useMeshBones ? rigOf(part?.id) : null)
    const pos: [number, number, number] = [
      snap(object.position.x - base[0]),
      snap(object.position.y - base[1]),
      snap(object.position.z - base[2]),
    ]
    if (!pos.every(Number.isFinite)) return
    onLimbPoseRef.current(limb, 'pos', pos)
  }

  /** Pose snapshot with the active gizmo angles applied (for live mesh-bone preview). */
  function liveMeshBonePoseFromGizmo(part: MeshPreviewPart): MeshBonePose | null {
    const api = sceneApiRef.current
    const limb = selectedLimbRef.current
    const object = api?.transform?.object
    if (!api?.transform || !limb || !object || !part.useMeshBones) return null
    const pose = ensureMeshBonePose(part.bonePose)
    const mode = gizmoModeRef.current
    if (mode === 'rotate' || mode === 'bend') {
      const channel = mode === 'bend' ? 'bend' : 'rot'
      const writeLimb =
        channel === 'bend' ? meshBoneBendTargetId(limb, rigOf(part.id)) : limb
      const raw = meshBoneChannelFromGizmo(part, limb, channel, object)
      if (!raw || !raw.every(Number.isFinite)) return pose
      let angles = quantizeDegrees(raw)
      if (channel === 'bend') angles = hingeBendAngles(part, writeLimb, angles)
      if (writeLimb === 'root') {
        return { ...pose, root: { ...pose.root, [channel]: angles } }
      }
      const current = pose.parts[writeLimb] ?? {
        pos: [0, 0, 0] as [number, number, number],
        rot: [0, 0, 0] as [number, number, number],
        bend: [0, 0, 0] as [number, number, number],
      }
      return {
        ...pose,
        parts: {
          ...pose.parts,
          [writeLimb]: { ...current, [channel]: angles },
        },
      }
    }
    const rig = rigOf(part.id)
    const posRaw = meshBoneChannelFromGizmo(part, limb, 'pos', object)
    if (posRaw && posRaw.every(Number.isFinite)) {
      const pos: [number, number, number] = [
        quantizeOffset(posRaw[0], rig),
        quantizeOffset(posRaw[1], rig),
        quantizeOffset(posRaw[2], rig),
      ]
      if (limb === 'root') {
        return { ...pose, root: { ...pose.root, pos } }
      }
      const current = pose.parts[limb] ?? {
        pos: [0, 0, 0] as [number, number, number],
        rot: [0, 0, 0] as [number, number, number],
        bend: [0, 0, 0] as [number, number, number],
      }
      return {
        ...pose,
        parts: { ...pose.parts, [limb]: { ...current, pos } },
      }
    }
    const base =
      (object.userData.baseLocal as [number, number, number] | undefined)
      ?? [object.position.x, object.position.y, object.position.z]
    const posFallback: [number, number, number] = [
      quantizeOffset(object.position.x - base[0], rig),
      quantizeOffset(object.position.y - base[1], rig),
      quantizeOffset(object.position.z - base[2], rig),
    ]
    if (!posFallback.every(Number.isFinite)) return pose
    if (limb === 'root') {
      return { ...pose, root: { ...pose.root, pos: posFallback } }
    }
    const current = pose.parts[limb] ?? {
      pos: [0, 0, 0] as [number, number, number],
      rot: [0, 0, 0] as [number, number, number],
      bend: [0, 0, 0] as [number, number, number],
    }
    return {
      ...pose,
      parts: { ...pose.parts, [limb]: { ...current, pos: posFallback } },
    }
  }

  function liveMeshPartPoseFromGizmo(part: MeshPreviewPart): MeshPartPose | null {
    const api = sceneApiRef.current
    const limbRaw = selectedLimbRef.current ?? ''
    const limb = meshPoseHostLimbId(skinPoseLimbBase(limbRaw))
    const object = api?.transform?.object
    if (!api?.transform || !limb || !object || !part.meshObjectNames?.length) return null
    const source = part.pose as MeshPartPose | null | undefined
    const pose: MeshPartPose = source
      ? {
          root: { ...source.root },
          parts: { ...source.parts },
          pivots: source.pivots,
          strokes: source.strokes,
          rigid: source.rigid,
          poseParents: source.poseParents,
        }
      : {
          root: { pos: [0, 0, 0], rot: [0, 0, 0], bend: [0, 0, 0], scale: [1, 1, 1] },
          parts: {},
        }
    const mode = gizmoModeRef.current
    const empty = {
      pos: [0, 0, 0] as [number, number, number],
      rot: [0, 0, 0] as [number, number, number],
      bend: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }
    if (mode === 'rotate' || mode === 'bend') {
      const [rx, ry, rz] = eulerDegreesFromObject(object)
      if (![rx, ry, rz].every(Number.isFinite)) return pose
      const channel = poseGizmoChannel(mode)
      const angles = quantizeDegrees([rx, ry, rz])
      if (limb === 'root') {
        return { ...pose, root: { ...empty, ...pose.root, [channel]: angles } }
      }
      const current = pose.parts[limb] ?? empty
      return {
        ...pose,
        parts: { ...pose.parts, [limb]: { ...current, [channel]: angles } },
      }
    }
    const base =
      (object.userData.baseLocal as [number, number, number] | undefined)
      ?? [object.position.x, object.position.y, object.position.z]
    const pos: [number, number, number] = [
      quantizeOffset(object.position.x - base[0], null),
      quantizeOffset(object.position.y - base[1], null),
      quantizeOffset(object.position.z - base[2], null),
    ]
    if (!pos.every(Number.isFinite)) return pose
    if (limb === 'root') {
      return { ...pose, root: { ...empty, ...pose.root, pos } }
    }
    const current = pose.parts[limb] ?? empty
    return { ...pose, parts: { ...pose.parts, [limb]: { ...current, pos } } }
  }

  function syncLimbGizmo() {
    const api = sceneApiRef.current
    if (!api?.transform) return
    api.invalidate()
    const { transform, boxHelper } = api
    try {
      if (navigationModeRef.current === 'free') {
        transform.enabled = false
        transform.detach()
        transform.getHelper().visible = false
        if (boxHelper) boxHelper.visible = false
        return
      }
      transform.enabled = true
      const partId = selectedIdRef.current
      const limbRaw = selectedLimbRef.current
      const limb = limbRaw ? skinPoseLimbBase(limbRaw) : null
      const group = partId ? groupsRef.current.get(partId) : undefined
      const part = partsRef.current.find((entry) => entry.id === partId)
      const placeWhole = isWholePartPlacement(part)
      if (!showRigRef.current && !placeWhole) {
        transform.detach()
        transform.getHelper().visible = false
        if (boxHelper) boxHelper.visible = false
        return
      }
      transform.setMode(gizmoModeRef.current === 'translate' ? 'translate' : 'rotate')
      for (const [id, entry] of groupsRef.current) {
        applyBoneSelectionHighlight(
          entry,
          id === partId ? limb : null,
          gizmoModeRef.current,
        )
      }
      const mode = gizmoModeRef.current
      const hingeAxis =
        limb && part
          ? poseGizmoHingeAxis(
              mode,
              limb,
              freeBendRef.current,
              Boolean(part.useMeshBones),
              rigOf(part.id),
            )
          : null
      transform.showX = hingeAxis == null || hingeAxis === 0
      transform.showY = hingeAxis == null || hingeAxis === 1
      transform.showZ = hingeAxis == null || hingeAxis === 2
      let target: THREE.Object3D | null =
        group && part
          ? findPoseGizmoTarget(group, part, limbRaw, mode, rigOf(part.id))
          : null
      if (placeWhole && group && part) {
        target = group
        if (!api.dragging) {
          group.userData.placeDrag = {
            pos: group.position.clone(),
            partPos: [part.positionX, part.positionY, part.positionZ],
          }
        }
      }
      if (target && partId && target.parent) {
        if (!placeWhole && (part?.kind === 'skin' || part?.useMeshBones || part?.meshObjectNames?.length)) {
          // Seed joint helper from the active pose channel so gizmo readback stays clean.
          if (
            part.useMeshBones
            && target.userData.isMeshBone
            && part.bonePose
            && limb
          ) {
            const poseLimb =
              gizmoModeRef.current === 'bend'
                ? meshBoneBendTargetId(limb, rigOf(part.id))
                : limb
            const partPose =
              poseLimb === 'root' ? part.bonePose.root : part.bonePose.parts[poseLimb]
            if (partPose) {
              const rig = rigOf(part.id)
              if (rig && poseLimb !== 'root') {
                const boneIndex = rig.indexOf[poseLimb]
                if (boneIndex != null) {
                  // Same split as applyMeshBonePoseToPreview: hierarchy without
                  // global root channels (those live on mesh-bones).
                  const matrices = computeMeshBoneMatrices(
                    rig,
                    meshBonePoseWithoutRoot(part.bonePose),
                  )
                  if (gizmoModeRef.current === 'bend' && rig.bones[boneIndex]!.hasBend) {
                    const bendWorld = matrices.bendWorld[boneIndex]
                    if (bendWorld) {
                      const local = mat4LocalFromWorld(matrices.poseWorld[boneIndex]!, bendWorld)
                      applyColumnMat4ToObject(local, target)
                    }
                  } else {
                    const parentWorld = meshBoneParentPoseWorld(rig, boneIndex, matrices)
                    const local = mat4LocalFromWorld(parentWorld, matrices.poseWorld[boneIndex]!)
                    applyColumnMat4ToObject(local, target)
                  }
                }
              } else {
                const angles =
                  gizmoModeRef.current === 'bend'
                    ? hingeBendAngles(part, poseLimb, [...partPose.bend])
                    : partPose.rot
                target.rotation.order = 'XYZ'
                target.rotation.set(
                  THREE.MathUtils.degToRad(angles[0] ?? 0),
                  THREE.MathUtils.degToRad(angles[1] ?? 0),
                  THREE.MathUtils.degToRad(angles[2] ?? 0),
                )
              }
            }
          } else if (part.kind === 'skin' && limb) {
            const host = poseGizmoHostLimb(limb)
            const partPose =
              host === 'root'
                ? (part.pose?.root ?? { pos: [0, 0, 0], rot: [0, 0, 0], bend: [0, 0, 0] })
                : part.pose?.parts[host]
            if (partPose) {
              const useBend = gizmoModeRef.current === 'bend'
              const stored = useBend ? (partPose.bend ?? [0, 0, 0]) : partPose.rot
              const angles = useBend
                ? skinBendVisualAngles(stored, skinObjectInvertsBend(target))
                : stored
              target.rotation.order = 'XYZ'
              target.rotation.set(
                THREE.MathUtils.degToRad(angles[0] ?? 0),
                THREE.MathUtils.degToRad(angles[1] ?? 0),
                THREE.MathUtils.degToRad(angles[2] ?? 0),
              )
            }
          } else if (
            part.meshObjectNames?.length
            && !part.useMeshBones
            && part.pose
            && limb
            && limb !== 'root'
            && (target.userData.isJoint || part.pose.rigid)
          ) {
            const partPose =
              part.pose.parts[limb]
              ?? part.pose.parts[meshPoseHostLimbId(limb)]
            if (partPose) {
              const angles =
                gizmoModeRef.current === 'bend' ? partPose.bend : partPose.rot
              target.rotation.order = 'XYZ'
              target.rotation.set(
                THREE.MathUtils.degToRad(angles[0] ?? 0),
                THREE.MathUtils.degToRad(angles[1] ?? 0),
                THREE.MathUtils.degToRad(angles[2] ?? 0),
              )
            }
          }
          target.updateWorldMatrix(true, false)
          transform.attach(target)
          transform.getHelper().visible = true
          if (boxHelper) {
            boxHelper.setFromObject(target)
            boxHelper.visible = true
          }
          return
        }
      }
      transform.detach()
      transform.getHelper().visible = false
      if (boxHelper) boxHelper.visible = false
    } catch (err) {
      console.warn('[preview] gizmo attach failed', err)
      try {
        transform.detach()
        transform.getHelper().visible = false
      } catch {
        /* ignore */
      }
      if (boxHelper) boxHelper.visible = false
    }
  }

  useEffect(() => {
    syncPoseAndPlacement()
    syncLimbGizmo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, selectedId, selectedLimbId, gizmoMode, showRig, navigationMode, freeBend])

  useEffect(() => {
    navApiRef.current?.applyMode(navigationMode)
    syncLimbGizmo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationMode])

  useEffect(() => {
    if (navigationMode !== 'free' || !navHintRef.current) return
    navHintRef.current.textContent = formatFreeHint(freeSpeed, freeLockedRef.current)
  }, [freeSpeed, navigationMode])

  useEffect(() => {
    for (const [partId, group] of groupsRef.current) {
      applyPartFade(group, selectedId == null || partId === selectedId)
    }
  }, [selectedId])

  const selectedPart = parts.find((part) => part.id === selectedId)
  const selectedRig = rigOf(selectedId)
  const showLimbTools = Boolean(
    selectedPart
    && (selectedPart.kind === 'skin'
      || selectedPart.useMeshBones
      || selectedPart.meshObjectNames?.length),
  )
  const catalogRotateOnly = Boolean(
    selectedPart?.sourceLabel?.startsWith('Minecraft')
    && selectedPart.kind === 'obj'
    && !selectedPart.useMeshBones,
  )
  const showPartPlacement = Boolean(
    selectedPart
    && selectedPart.kind !== 'skin'
    && !selectedPart.useMeshBones
    && (!selectedPart.meshObjectNames?.length || selectedLimbId === 'root'),
  )

  // Leaving bone-rig mode must not keep the elbow/knee Bend tool sticky on classic skins.
  const useMeshBonesSelected = Boolean(selectedPart?.useMeshBones)
  const wasMeshBonesRef = useRef(useMeshBonesSelected)
  useEffect(() => {
    if (wasMeshBonesRef.current && !useMeshBonesSelected) {
      setGizmoMode('rotate')
    }
    wasMeshBonesRef.current = useMeshBonesSelected
  }, [useMeshBonesSelected, selectedId])

  // Rotate / Bend are chosen on the toolbar. Clicking upper vs lower arm
  // only changes which limb is selected; it does not flip the tool.

  useEffect(() => {
    if ((showPartPlacement || catalogRotateOnly) && gizmoMode === 'bend') {
      setGizmoMode('rotate')
    }
  }, [showPartPlacement, catalogRotateOnly, gizmoMode])

  return (
    <div className="mesh-preview-host">
      {(showLimbTools || showPartPlacement) && navigationMode !== 'free' ? (
        <div className="mesh-preview-tools" role="toolbar" aria-label="Limb transform">
          <Segmented
            value={gizmoMode}
            onChange={setGizmoMode}
            options={[
              {
                value: 'rotate',
                label: 'Rotate',
                title: 'Rotate (R)',
                disabled: showLimbTools && !showRig && !showPartPlacement,
              },
              {
                value: 'translate',
                label: 'Move',
                title: 'Move (G)',
                disabled: showLimbTools && !showRig && !showPartPlacement,
              },
              ...(showLimbTools && !catalogRotateOnly
                ? [{
                    value: 'bend' as const,
                    label: 'Bend',
                    title: 'Bend this limb at the joint (B)',
                    disabled: !showRig || !selectedLimbId || skinPoseLimbBase(selectedLimbId) === 'root',
                  }]
                : []),
            ]}
          />
          {showLimbTools ? (
          <Button
            type="button"
            size="1"
            variant={showRig ? 'soft' : 'solid'}
            color={showRig ? 'gray' : 'amber'}
            onClick={() => setShowRig((value) => !value)}
            title={
              showRig
                ? 'Hide the bones and gizmo to see the model on its own'
                : 'Show the bones and gizmo again'
            }
            aria-pressed={showRig}
          >
            {showRig ? 'Hide rig' : 'Show rig'}
          </Button>
          ) : null}
          <span className="mesh-preview-tools-hint">
            {showPartPlacement
              ? 'Move / Rotate the whole model in the scene'
              : catalogRotateOnly
                ? 'Click a limb to select it · Root moves the whole model'
              : !showRig
              ? 'Rig hidden — posing is paused, your pose is kept'
              : selectedPart?.useMeshBones
                ? selectedRig?.kind === 'generic'
                  ? 'Click a bone · Rotate the joint · Bones follow this model’s own shape'
                  : 'Click a bone · Rotate the joint · Bend hinges the elbow/knee'
                : 'Click a limb · Rotate the joint · Bend the elbow/knee/waist'}
          </span>
        </div>
      ) : null}
      <div ref={hostRef} className="mesh-preview-canvas" />
      {navigationMode === 'orbit' ? (
        <OrbitPivotPanel
          offset={orbitOffset}
          span={orbitSpan}
          onChange={(next) => {
            setOrbitOffset(next)
            navApiRef.current?.setOrbitOffset(next[0], next[1], next[2])
          }}
          onRecenter={() => {
            setOrbitOffset([0, 0, 0])
            navApiRef.current?.recenterOrbit()
          }}
        />
      ) : null}
      {navigationMode === 'free' && (
        <label className="map-art-3d-speed">
          <Text size="1">Speed {freeSpeed.toFixed(1)}x</Text>
          <Slider
            min={MIN_FREE_SPEED}
            max={MAX_FREE_SPEED}
            step={0.05}
            value={[freeSpeed]}
            onValueChange={(next) => setFreeSpeedValue(next[0] ?? freeSpeed)}
            aria-label="Free movement speed"
          />
        </label>
      )}
      {navigationMode === 'free' ? (
        <div className="map-art-3d-hint" ref={navHintRef} aria-live="polite" />
      ) : (
        <div className="map-art-3d-hint" aria-live="polite">
          {formatOrbitHint()}
        </div>
      )}
      <div className="mesh-preview-caption" title={error ?? status}>
        {error ? <span className="mesh-preview-error">{error}</span> : status}
      </div>
    </div>
  )
}

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function loadPartGroup(
  part: MeshPreviewPart,
  helpers: {
    onProgress: (ratio: number, label: string) => void
    trackUrl: (url: string) => void
    trackTexture: (texture: THREE.Texture) => void
  },
): Promise<{ group: THREE.Group; label: string } | null> {
  const group = new THREE.Group()
  const { onProgress, trackUrl, trackTexture } = helpers

  if (part.kind === 'skin') {
    if (part.bytes.length === 0) return null
    const copy = Uint8Array.from(part.bytes)
    const skinUrl = URL.createObjectURL(
      new Blob([copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)], {
        type: 'image/png',
      }),
    )
    trackUrl(skinUrl)
    const texture = await loadTexture(skinUrl, true)
    trackTexture(texture)
    let capeTexture: THREE.Texture | null = null
    if (part.capeBytes && part.capeBytes.length >= 64) {
      const capeCopy = Uint8Array.from(part.capeBytes)
      const capeUrl = URL.createObjectURL(
        new Blob([capeCopy.buffer.slice(capeCopy.byteOffset, capeCopy.byteOffset + capeCopy.byteLength)], {
          type: 'image/png',
        }),
      )
      trackUrl(capeUrl)
      capeTexture = await loadTexture(capeUrl, true)
      trackTexture(capeTexture)
    }
    const useBones = Boolean(part.useMeshBones)
    const player = buildPlayerSkinGroup(
      texture,
      part.slimArms ?? false,
      useBones ? null : part.pose,
      part.showOuterLayer ?? true,
      part.jointStyle ?? 'mineimator',
      {
        overlay: part.skinOverlay ?? (part.showOuterLayer ? 'full' : 'none'),
        limbs: part.skinLimbs ?? (part.slimArms ? 'slim' : 'classic'),
      },
      capeTexture,
    )
    group.add(player)
    if (useBones) {
      const rig = playerSkinHumanoidRig(part.slimArms ?? false)
      const bonesRoot = buildMeshBoneHelpers(rig)
      group.add(bonesRoot)
      group.userData.meshBoneRig = rig
      group.userData.meshSkinMode = meshSkinModeOf(part)
      const bonePose = part.bonePose ?? ensureMeshBonePose(null, rig)
      applyMeshBonePoseToPreview(group, bonePose, { deform: meshSkinModeOf(part) })
      applySkinPoseToGroup(player, meshBonePoseToSkinPose(bonePose))
    }
    const posed =
      !useBones
      && part.pose
      && Object.keys(part.pose.parts).some((key) => {
        const p = part.pose!.parts[key]
        return (
          Math.abs(p.rot[0])
            + Math.abs(p.rot[1])
            + Math.abs(p.rot[2])
            + Math.abs(p.bend[0])
            + Math.abs(p.bend[1])
            + Math.abs(p.bend[2])
          > 0.05
        )
      })
    return {
      group,
      label: `${compactLabel(part.fileName, 28)} · 3D player${part.slimArms ? ' (slim)' : ''}${
        useBones ? ' · bones' : posed ? ' · posed' : ''
      }`,
    }
  }

  if (part.voxBytes && part.voxBytes.length > 0) {
    onProgress(0.2, 'Building MagicaVoxel preview…')
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0)
    })
    const preview = buildVoxPreviewMesh(part.voxBytes)
    const colorsLinear = srgbVertexColorsToLinear(preview.colors)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(preview.positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsLinear, 3))
    geometry.computeVertexNormals()
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    group.add(new THREE.Mesh(geometry, material))
    return {
      group,
      label: `${compactLabel(part.fileName, 28)} · ${preview.voxelCount.toLocaleString()} voxels`,
    }
  }

  let objBytes = part.bytes
  if (objBytes.length === 0 && part.sourcePath) {
    try {
      onProgress(0.05, 'Loading model for preview…')
      const size = await localFileSize(part.sourcePath)
      if (size <= 0) return null
      objBytes = await readLocalFileBytes(part.sourcePath, (ratio) => {
        onProgress(0.05 + ratio * 0.35, `Loading preview…`)
      })
    } catch {
      return null
    }
  }
  if (objBytes.length === 0) return null

  const pendingText = new TextDecoder('utf-8', { fatal: false }).decode(
    objBytes.subarray(0, Math.min(objBytes.length, 256)),
  )
  if (
    objBytes.length < 64
    || pendingText.includes('pending mimodel')
    || part.fileName.toLowerCase().endsWith('.miobject')
  ) {
    return null
  }

  const result = await parseObjInWorker(
    objBytes,
    part.mtlBytes ?? null,
    part.textures ?? {},
    (ratio, label) => onProgress(0.32 + ratio * 0.4, label),
    {
      skipOutlierFilter: Boolean(part.sourceLabel?.startsWith('Minecraft entity')),
    },
  )
  const groups = result.groups?.length
    ? result.groups
    : [{
        objectName: OBJ_DEFAULT_OBJECT,
        positions: result.positions,
        sourceVertexIndices: Int32Array.from(
          { length: result.positions.length / 3 },
          (_, index) => index,
        ),
        colors: result.colors,
        uvs: result.uvs,
        mapKd: result.mapKd,
        triangleCount: result.triangleCount,
      }]
  if (groups.every((g) => g.positions.length < 9)) return null

  const meshPartsRoot = new THREE.Group()
  meshPartsRoot.name = 'mesh-parts'
  const objectGroups = new Map<string, THREE.Group>()
  const contentGroups = new Map<string, THREE.Group>()
  const objectPositionBuckets = new Map<string, number[]>()

  for (const g of groups) {
    if (g.positions.length < 9) continue
    const objectName = g.objectName ?? OBJ_DEFAULT_OBJECT
    const bucket = objectPositionBuckets.get(objectName) ?? []
    for (let i = 0; i < g.positions.length; i += 1) bucket.push(g.positions[i]!)
    objectPositionBuckets.set(objectName, bucket)
  }

  const boundsList = [...objectPositionBuckets.entries()]
    .map(([name, positions]) => boundsFromPositions(name, positions))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const followerMap = buildPoseFollowerMap(boundsList)

  const ensureHostGroup = (hostName: string): THREE.Group => {
    let objGroup = objectGroups.get(hostName)
    if (objGroup) return objGroup
    objGroup = new THREE.Group()
    objGroup.name = meshPartGroupName(hostName)
    objGroup.userData.limbId = hostName
    const positions = objectPositionBuckets.get(hostName) ?? []
    // Include follower verts so the host AABB / bend covers accessories.
    for (const [child, host] of followerMap) {
      if (host !== hostName) continue
      const childPos = objectPositionBuckets.get(child)
      if (childPos) for (const n of childPos) positions.push(n)
    }
    const split = computeBendSplitFromPositions(positions)
    const authoredPivot = (part.pose as MeshPartPose | null | undefined)?.pivots?.[hostName]
    const restPivot =
      authoredPivot
        ? [authoredPivot[0], authoredPivot[1], authoredPivot[2]] as [number, number, number]
        : split?.center ?? [0, 0, 0] as [number, number, number]
    objGroup.userData.restPivot = restPivot
    objGroup.userData.activePivot = restPivot
    if (split) objGroup.userData.bendSplit = split
    // Match applied rest pose before placement AABB is measured (avoids a jump on first apply).
    objGroup.position.set(restPivot[0], restPivot[1], restPivot[2])

    const content = new THREE.Group()
    content.name = `mesh-content:${hostName}`
    content.position.set(-restPivot[0], -restPivot[1], -restPivot[2])
    objGroup.add(content)
    contentGroups.set(hostName, content)

    const bend = new THREE.Group()
    bend.name = meshBendGroupName(hostName)
    bend.userData.limbId = hostName
    bend.userData.isBend = true
    bend.userData.isJoint = true
    bend.position.set(0, 0, 0)
    objGroup.add(bend)

    objectGroups.set(hostName, objGroup)
    meshPartsRoot.add(objGroup)
    return objGroup
  }

  const workGroups = groups.filter((g) => g.positions.length >= 9)
  let totalTris = 0
  for (let index = 0; index < workGroups.length; index += 1) {
    const g = workGroups[index]!
    onProgress(
      0.74 + (index / Math.max(workGroups.length, 1)) * 0.2,
      workGroups.length > 1
        ? `Building meshes… ${index + 1}/${workGroups.length}`
        : 'Building meshes…',
    )
    if (index === 0 || index % 4 === 0) await yieldToPaint()
    const objectName = g.objectName ?? OBJ_DEFAULT_OBJECT
    const hostName = followerMap.get(objectName) ?? objectName
    ensureHostGroup(hostName)
    const content = contentGroups.get(hostName)!

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(g.positions)
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.userData.restPositions = new Float32Array(g.positions)
    geometry.userData.sourceVertexIndices = g.sourceVertexIndices
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(srgbVertexColorsToLinear(g.colors), 3),
    )
    geometry.computeVertexNormals()

    let material: THREE.Material
    const textures = part.textures ?? {}
    const texEntry =
      (g.mapKd ? pickPreviewTexture(textures, g.mapKd) : null)
      ?? onlyTexture(textures)
    if (texEntry && g.uvs.length >= (g.positions.length / 3) * 2) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2))
      const loaded = await loadTextureFromBytes(texEntry[1])
      trackTexture(loaded.texture)
      if (loaded.url) trackUrl(loaded.url)
      const decoded = loaded.rgba ?? (await decodeImageRgba(texEntry[1]))
      const entity = Boolean(part.sourceLabel?.startsWith('Minecraft entity'))
      const isJaw = hostName === 'jaw' || objectName === 'jaw'
      const overlayShell =
        hostName === 'pumpkin'
        || objectName === 'pumpkin'
        || hostName.endsWith('_overlay')
        || objectName.endsWith('_overlay')
        || /^entity_/.test(g.mapKd ?? '')
      const opaqueEnough = decoded ? rgbaOpaqueRatio(decoded) >= 0.005 : true
      const cutout =
        opaqueEnough
        && (entity
          || (decoded ? rgbaHasCutout(decoded) : textureLooksLikeCutout(loaded.texture)))
      material = new THREE.MeshBasicMaterial({
        map: loaded.texture,
        side: THREE.DoubleSide,
        transparent: false,
        alphaTest: cutout ? 0.1 : 0,
        // Jaw is an inset solid (Enderman mouth), not a translucent hat shell.
        depthWrite: !overlayShell,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: overlayShell ? 1 : isJaw ? -2 : -1,
        polygonOffsetUnits: overlayShell ? 1 : isJaw ? -2 : -1,
      })
    } else {
      material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    }

    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.limbId = hostName
    if (hostName === 'pumpkin' || objectName === 'pumpkin') {
      mesh.renderOrder = 3
    } else if (hostName.endsWith('_overlay') || objectName.endsWith('_overlay')) {
      mesh.renderOrder = 2
    } else if (hostName === 'jaw' || objectName === 'jaw') {
      // Draw after the head so the inset mouth wins z without looking like a shell.
      mesh.renderOrder = 1
    }
    content.add(mesh)
    totalTris += g.triangleCount
  }

  onProgress(0.95, part.useMeshBones ? 'Applying bones…' : 'Placing preview…')
  await yieldToPaint()

  // Catalog cubes (zombie, etc.) stay whole meshes and rotate at their pivots.

  group.add(meshPartsRoot)

  if (part.useMeshBones) {
    const deform = meshSkinModeOf(part)
    group.userData.meshSkinMode = deform
    const allPositions: number[] = []
    meshPartsRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const rest = (mesh.geometry as THREE.BufferGeometry).userData.restPositions as
        | Float32Array
        | undefined
      if (!rest) return
      for (let i = 0; i < rest.length; i += 1) allPositions.push(rest[i]!)
    })
    const useNative = part.rigMode === 'native' && part.nativeRig
    const useImportedWeights = useNative && (part.nativeWeights?.vertexCount ?? 0) > 0
    const rig = useNative
      ? part.nativeRig!
      : fitMeshBones(new Float32Array(allPositions), part.rigMode ?? 'auto')
    if (rig) {
      meshPartsRoot.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const geometry = mesh.geometry as THREE.BufferGeometry
        const rest = geometry.userData.restPositions as Float32Array | undefined
        if (!rest) return
        const vertexCount = Math.floor(rest.length / 3)
        if (useImportedWeights && part.nativeWeights) {
          const sources = geometry.userData.sourceVertexIndices as Int32Array | undefined
          const indices = new Int16Array(vertexCount * 4)
          indices.fill(-1)
          const weights = new Float32Array(vertexCount * 4)
          for (let vertex = 0; vertex < vertexCount; vertex += 1) {
            const source = sources?.[vertex] ?? vertex
            for (let influence = 0; influence < 4; influence += 1) {
              const from = source * 4 + influence
              const to = vertex * 4 + influence
              indices[to] = part.nativeWeights.indices[from] ?? -1
              weights[to] = part.nativeWeights.weights[from] ?? 0
            }
          }
          const imported = {
            indices,
            weights,
            vertexCount,
          } satisfies MeshBoneWeights
          geometry.userData.boneSkin =
            deform === 'rigid' ? unifyRigidGeometryWeights(hardenMeshBoneWeights(imported)) : imported
        } else {
          const computed = computeMeshBoneWeights(rest, rig, deform)
          geometry.userData.boneSkin =
            deform === 'rigid' ? unifyRigidGeometryWeights(computed) : computed
        }
        // Prefer bone selection over object-name limbs.
        mesh.userData.limbId = undefined
      })
      const bonesRoot = buildMeshBoneHelpers(rig)
      meshPartsRoot.add(bonesRoot)
      group.userData.meshBoneRig = rig
      applyMeshBonePoseToPreview(group, part.bonePose, { deform })
    }
  } else if (part.pose) {
    applyMeshPartPoseToGroup(group, part.pose as MeshPartPose)
  }

  return {
    group,
    label: `${compactLabel(part.fileName, 28)} · ${totalTris.toLocaleString()} tris`,
  }
}

function statueBoxKey(part: Pick<MeshPreviewPart, 'width' | 'height' | 'length' | 'fit'>): string {
  return `${part.width}:${part.height}:${part.length}:${part.fit}`
}

function placementSyncKey(part: MeshPreviewPart): string {
  return [
    part.positionX,
    part.positionY,
    part.positionZ,
    part.rotationX ?? 0,
    part.rotationY ?? 0,
    part.rotationZ ?? 0,
    part.width,
    part.height,
    part.length,
    part.fit,
  ].join(':')
}

function placementScaleFromMeshSize(
  size: { x: number; y: number; z: number },
  part: Pick<MeshPreviewPart, 'width' | 'height' | 'length' | 'fit'>,
): { x: number; y: number; z: number } {
  const targetW = Math.max(1, part.width)
  const targetH = Math.max(1, part.height)
  const targetL = Math.max(1, part.length)
  if (size.x <= 1e-6 || size.y <= 1e-6 || size.z <= 1e-6) {
    return { x: 1, y: 1, z: 1 }
  }
  if (part.fit === 'stretch') {
    return { x: targetW / size.x, y: targetH / size.y, z: targetL / size.z }
  }
  const s = Math.min(targetW / size.x, targetH / size.y, targetL / size.z)
  return { x: s, y: s, z: s }
}

/** Fit mesh into the part’s block box, apply scene rotation (YXZ), then move to placement. */
function placePartGroup(group: THREE.Group, part: MeshPreviewPart) {
  if (!group.userData.placementReady) {
    const inner = new THREE.Group()
    while (group.children.length > 0) {
      inner.add(group.children[0]!)
    }
    group.add(inner)
    group.position.set(0, 0, 0)
    group.rotation.set(0, 0, 0)
    group.scale.set(1, 1, 1)
    inner.updateMatrixWorld(true)

    const box0 = new THREE.Box3().setFromObject(inner)
    if (box0.isEmpty()) {
      group.userData.meshSize = { x: 1, y: 1, z: 1 }
      group.userData.placementScale = { x: 1, y: 1, z: 1 }
      group.userData.placementReady = true
      applyPlacement(group, part)
      group.userData.placementKey = placementSyncKey(part)
      group.userData.statueBoxKey = statueBoxKey(part)
      return
    }
    const size = box0.getSize(new THREE.Vector3())
    const center = box0.getCenter(new THREE.Vector3())
    inner.position.set(-center.x, -center.y, -center.z)
    group.userData.meshSize = { x: size.x, y: size.y, z: size.z }
    group.userData.placementScale = placementScaleFromMeshSize(
      { x: size.x, y: size.y, z: size.z },
      part,
    )
    group.userData.placementReady = true
    group.userData.statueBoxKey = statueBoxKey(part)
  }
  applyPlacement(group, part)
  group.userData.placementKey = placementSyncKey(part)
  group.userData.statueBoxKey = statueBoxKey(part)
}

function applyPlacement(group: THREE.Group, part: MeshPreviewPart) {
  const scale = group.userData.placementScale as { x: number; y: number; z: number } | undefined
  if (!scale) return
  group.scale.set(scale.x, scale.y, scale.z)
  group.rotation.order = 'YXZ'
  group.rotation.set(
    THREE.MathUtils.degToRad(part.rotationX ?? 0),
    THREE.MathUtils.degToRad(part.rotationY ?? 0),
    THREE.MathUtils.degToRad(part.rotationZ ?? 0),
  )
  group.position.set(0, 0, 0)
  group.updateMatrixWorld(true)
  const placed = new THREE.Box3().setFromObject(group)
  if (placed.isEmpty()) {
    group.position.set(part.positionX, part.positionY, part.positionZ)
    return
  }
  const size = placed.getSize(new THREE.Vector3())
  const targetW = Math.max(1, part.width)
  const targetH = Math.max(1, part.height)
  const targetL = Math.max(1, part.length)
  // Corner-align stretch. Fit centres leftover XZ; skins keep feet on Y=0 so
  // a classic figure in a slimmer box does not hover.
  const padX = part.fit === 'fit' ? Math.max(0, targetW - size.x) * 0.5 : 0
  const padY =
    part.fit === 'fit' && part.kind !== 'skin'
      ? Math.max(0, targetH - size.y) * 0.5
      : 0
  const padZ = part.fit === 'fit' ? Math.max(0, targetL - size.z) * 0.5 : 0
  group.position.set(
    part.positionX - placed.min.x + padX,
    part.positionY - placed.min.y + padY,
    part.positionZ - placed.min.z + padZ,
  )
}

/** Fade unselected parts without touching the bone overlay materials. */
function applyPartFade(group: THREE.Object3D, active: boolean): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    if (obj.userData.boneOverlay) return
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of materials) {
      if (!('opacity' in material)) continue
      const mat = material as THREE.MeshBasicMaterial
      mat.opacity = active ? 1 : 0.7
      // Cutout (alphaTest) must stay in the opaque queue — fading via
      // `transparent: true` is what hid the bee body behind its wing planes.
      mat.transparent = !active && !(mat.alphaTest > 0)
      mat.depthWrite = true
      mat.needsUpdate = true
    }
  })
}

/** Tint the handle the gizmo is attached to so the active joint reads at a glance. */
function applyBoneSelectionHighlight(
  group: THREE.Object3D,
  limbId: string | null,
  mode: GizmoMode,
): void {
  const bonesRoot = group.getObjectByName('mesh-bones')
  if (!bonesRoot) return
  const bendMode = mode === 'bend' && limbId != null && meshBoneSupportsBend(limbId)
  const activeLimb = bendMode && limbId ? meshBoneBendTargetId(limbId) : limbId
  const activeHandle: 'rot' | 'bend' = bendMode ? 'bend' : 'rot'

  bonesRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const handle = obj.userData.boneHandle as 'rot' | 'bend' | undefined
    if (!handle) return
    const base = (obj.userData.baseColor as number | undefined) ?? BONE_JOINT_COLOR
    const selected =
      activeLimb != null && obj.userData.limbId === activeLimb && handle === activeHandle
    const mat = obj.material as THREE.MeshBasicMaterial
    mat.color.setHex(selected ? BONE_SELECTED_COLOR : base)
    // Scale itself is owned by the per-frame screen-size pass.
    obj.userData.handleBoost = selected ? 1.45 : 1
  })
}

/** Bone handles draw after the body so they stay visible from every angle. */
const BONE_OVERLAY_RENDER_ORDER = 1000
const BONE_JOINT_COLOR = 0x4aa3e0
const BONE_BEND_COLOR = 0xf0a45a
const BONE_ROOT_COLOR = 0x7dcb8a
const BONE_LINE_COLOR = 0x9fd4f5
const BONE_SELECTED_COLOR = 0xffd166

/** Per-handle material — cloned so the selected joint can be recoloured alone. */
function makeBoneJointMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
    toneMapped: false,
  })
}

/**
 * On-screen joint-ball size. Dense native rigs (hair/fingers/skirt) would
 * otherwise paint over the mesh at a fixed ~22px diameter.
 */
function handleScreenSize(jointCount: number): {
  radius: number
  min: number
  max: number
  pickPad: number
  opacity: number
} {
  const t = Math.min(1, Math.max(0, (jointCount - 16) / 100))
  return {
    radius: 8 - t * 4.5,
    min: 6 - t * 3,
    max: 13 - t * 8,
    pickPad: 10 - t * 5,
    opacity: 0.92 - t * 0.28,
  }
}

const HANDLE_PICK_PADDING_PX = 8

/** Prefer gizmo over mesh when depths are within this margin (easier handle grab). */
const GIZMO_DEPTH_SLACK = 0.04

type LimbPick = {
  partId: string
  limbId: string
  skinHandle?: 'rot' | 'bend'
  partGroup: THREE.Object3D | null
  hit: THREE.Intersection
}

/** Raycast visible gizmo handles only — never the invisible 100k drag plane. */
function closestGizmoHit(
  transform: TransformControls | null,
  raycaster: THREE.Raycaster,
): THREE.Intersection | null {
  if (!transform) return null
  const helper = transform.getHelper()
  if (!helper.visible) return null
  const prevLine = raycaster.params.Line?.threshold
  const prevPoints = raycaster.params.Points?.threshold
  raycaster.params.Line = { threshold: 0.14 }
  raycaster.params.Points = { threshold: 0.14 }
  let best: THREE.Intersection | null = null
  for (const child of helper.children) {
    if ((child as { isTransformControlsPlane?: boolean }).isTransformControlsPlane) continue
    const hits = raycaster.intersectObject(child, true)
    if (!hits[0]) continue
    if (!best || hits[0].distance < best.distance) best = hits[0]
  }
  raycaster.params.Line = { threshold: prevLine ?? 1 }
  raycaster.params.Points = { threshold: prevPoints ?? 1 }
  return best
}

function parseLimbPick(hit: THREE.Intersection): Omit<LimbPick, 'hit'> | null {
  let obj: THREE.Object3D | null = hit.object
  let partId: string | undefined
  let limbId: string | undefined
  let skinHandle: 'rot' | 'bend' | undefined
  let partGroup: THREE.Object3D | null = null
  while (obj) {
    if (!limbId && typeof obj.userData.limbId === 'string') {
      limbId = meshPoseHostLimbId(obj.userData.limbId)
    }
    if (
      !skinHandle
      && (obj.userData.skinHandle === 'rot' || obj.userData.skinHandle === 'bend')
    ) {
      skinHandle = obj.userData.skinHandle
    }
    if (!partGroup && obj.name.startsWith('mesh-part:')) {
      partGroup = obj
    }
    if (!partId && typeof obj.userData.partId === 'string') {
      partId = obj.userData.partId
    }
    obj = obj.parent
  }
  if (!partId || !limbId) return null
  const baseLimb = skinPoseLimbBase(limbId)
  const selectLimbId =
    skinHandle === 'bend' && baseLimb
      ? skinPoseBendLimbId(baseLimb)
      : (baseLimb ?? limbId)
  return { partId, limbId: selectLimbId, skinHandle, partGroup }
}

function meshLimbHits(
  raycaster: THREE.Raycaster,
  groups: Iterable<THREE.Object3D>,
  currentLimb: string | null,
): THREE.Intersection[] {
  return pickPreferredLimbHit(
    raycaster
      .intersectObjects([...groups], true)
      .filter((hit) => {
        const obj = hit.object
        if (obj.userData.boneHandle) return false
        if (obj.userData.boneOverlay) return false
        if ((obj as { isTransformControlsPlane?: boolean }).isTransformControlsPlane) {
          return false
        }
        return obj.type !== 'Line'
      }),
    currentLimb,
  )
}

function gizmoShouldCapture(
  transform: TransformControls | null,
  gizmoHit: THREE.Intersection | null,
  meshHit: THREE.Intersection | null,
  selectedLimb: string | null,
  meshLimbId: string | null,
): boolean {
  if (transform?.axis) return true
  if (!gizmoHit) return false
  const meshDist = meshHit?.distance ?? Infinity
  if (gizmoHit.distance > meshDist + GIZMO_DEPTH_SLACK) return false
  if (!meshLimbId || !selectedLimb) return true
  const same =
    skinPoseLimbBase(meshLimbId) === skinPoseLimbBase(selectedLimb)
    || meshLimbId === selectedLimb
  // Different limb behind the gizmo — mesh wins. Same limb or empty — gizmo wins.
  return same || gizmoHit.distance + GIZMO_DEPTH_SLACK < meshDist
}

function limbIdFromObject(obj: THREE.Object3D): string | undefined {
  for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
    if (typeof node.userData.limbId === 'string') return node.userData.limbId
  }
  return undefined
}

/** Prefer arms/legs/head over the torso when the ray nicks two parts at once. */
function pickPreferredLimbHit(
  hits: THREE.Intersection[],
  _currentLimb: string | null = null,
): THREE.Intersection[] {
  if (hits.length === 0) return []
  const first = hits[0]!
  const near = hits.filter((hit) => hit.distance <= first.distance + 0.08)
  const pool = near
  const rank = (hit: THREE.Intersection) => {
    const limb = limbIdFromObject(hit.object)
    if (limb === 'body') return 2
    if (limb === 'head') return 1
    return 0
  }
  let best = pool[0] ?? first
  let bestRank = rank(best)
  for (const hit of pool) {
    const next = rank(hit)
    if (next < bestRank) {
      best = hit
      bestRank = next
    }
  }
  return [best]
}

function visibleInScene(obj: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

function forEachBoneHandle(
  groups: Iterable<THREE.Object3D>,
  visit: (handle: THREE.Mesh) => void,
): void {
  for (const group of groups) {
    const bones = group.getObjectByName('mesh-bones')
    if (bones && visibleInScene(bones)) {
      bones.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData.boneHandle) visit(obj)
      })
    }
    // Only the drawn joint balls. Limb meshes are selected by raycast so
    // neighbouring cubes (body vs arm) don't steal the click via screen-radius.
  }
}

/** Largest axis scale a matrix applies, used to convert model units to world units. */
function maxAxisScale(matrix: THREE.Matrix4): number {
  const e = matrix.elements
  return Math.max(
    Math.hypot(e[0]!, e[1]!, e[2]!),
    Math.hypot(e[4]!, e[5]!, e[6]!),
    Math.hypot(e[8]!, e[9]!, e[10]!),
  )
}

/** World units per CSS pixel at a given depth for this perspective camera. */
function worldUnitsPerPixel(
  camera: THREE.PerspectiveCamera,
  depth: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0
  return (2 * Math.tan(((camera.fov * Math.PI) / 180) / 2) * depth) / viewportHeight
}

/**
 * Hold every handle at a steady on-screen size. Fixed world-space spheres shrink
 * to nothing when you pull the camera back, which is when they're hardest to hit.
 * Min/max are in screen pixels (not bind-space), so a statue-scaled skin still
 * keeps clickable balls instead of clamping them to sub-pixel dots.
 */
function sizeBoneHandles(
  groups: Iterable<THREE.Object3D>,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  if (viewportHeight <= 0) return
  const world = new THREE.Vector3()
  for (const group of groups) {
    const bones = group.getObjectByName('mesh-bones')
    if (!bones || !visibleInScene(bones)) continue
    const screen = handleScreenSize(
      typeof bones.userData.jointCount === 'number' ? bones.userData.jointCount : 16,
    )
    bones.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.userData.boneHandle) return
      const radius = obj.userData.handleRadius as number | undefined
      if (!radius || !(radius > 0)) return
      obj.getWorldPosition(world)
      const worldScale = obj.parent ? maxAxisScale(obj.parent.matrixWorld) : 1
      if (!(worldScale > 1e-9)) return
      const depth = Math.max(world.distanceTo(camera.position), 1e-4)
      const wpp = worldUnitsPerPixel(camera, depth, viewportHeight)
      if (!(wpp > 0)) return
      const boost = (obj.userData.handleBoost as number | undefined) ?? 1
      const wantedModel = (wpp * screen.radius * boost) / worldScale
      const minModel = (wpp * screen.min) / worldScale
      const maxModel = (wpp * screen.max * boost) / worldScale
      const modelRadius = Math.min(Math.max(wantedModel, minModel), maxModel)
      obj.scale.setScalar(modelRadius / radius)
      obj.userData.screenRadiusPx = (modelRadius * worldScale) / wpp
      obj.userData.pickPadPx = screen.pickPad
      const material = obj.material
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = Math.min(0.95, screen.opacity + (boost > 1 ? 0.12 : 0))
      }
    })
  }
}

/**
 * Pick the handle nearest the cursor in screen space rather than raycasting.
 * Handles sit inside the body and under the gizmo, so a depth-ordered ray hits
 * whatever is in front of them; measuring in pixels makes them clickable anyway.
 *
 * `preferKind` breaks ties when an elbow/knee bend ball sits on top of a
 * forearm/shin rot ball (or vice versa).
 */
function pickBoneHandleAt(
  groups: Iterable<THREE.Object3D>,
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  width: number,
  height: number,
  preferKind: 'rot' | 'bend' | null = null,
  paddingPx: number = HANDLE_PICK_PADDING_PX,
): THREE.Mesh | null {
  const hits: Array<{
    handle: THREE.Mesh
    dist: number
    radius: number
    depth: number
    kind: 'rot' | 'bend' | undefined
  }> = []
  const world = new THREE.Vector3()
  forEachBoneHandle(groups, (handle) => {
    if (!visibleInScene(handle)) return
    handle.getWorldPosition(world)
    const depth = world.distanceTo(camera.position)
    world.project(camera)
    // Skip behind the camera / outside the clip volume.
    if (world.z < -1 || world.z > 1) return
    const sx = (world.x * 0.5 + 0.5) * width
    const sy = (-world.y * 0.5 + 0.5) * height
    const dist = Math.hypot(sx - x, sy - y)
    const drawn = (handle.userData.screenRadiusPx as number | undefined) ?? 8
    const pad =
      typeof handle.userData.pickPadPx === 'number'
        ? handle.userData.pickPadPx
        : paddingPx
    const pickRadius = drawn + pad
    if (dist > pickRadius) return
    hits.push({
      handle,
      dist,
      radius: pickRadius,
      depth,
      kind:
        (handle.userData.boneHandle as 'rot' | 'bend' | undefined)
        ?? (handle.userData.skinHandle as 'rot' | 'bend' | undefined),
    })
  })
  if (hits.length === 0) return null
  hits.sort((a, b) => {
    const na = a.dist / Math.max(a.radius, 1e-4)
    const nb = b.dist / Math.max(b.radius, 1e-4)
    if (Math.abs(na - nb) > 0.1) return na - nb
    if (Math.abs(a.depth - b.depth) > 1e-4) return a.depth - b.depth
    if (Math.abs(a.radius - b.radius) > 0.5) return a.radius - b.radius
    const ka = preferKind && a.kind === preferKind ? 0 : 1
    const kb = preferKind && b.kind === preferKind ? 0 : 1
    return ka - kb
  })
  return hits[0]!.handle
}

function buildMeshBoneHelpers(rig: MeshBoneRig): THREE.Group {
  const root = new THREE.Group()
  root.name = 'mesh-bones'
  root.userData.baseLocal = [0, 0, 0]
  root.userData.isMeshBone = true
  root.userData.limbId = 'root'
  root.userData.jointCount = rig.bones.length

  const diag = Math.hypot(rig.bounds.size[0], rig.bounds.size[1], rig.bounds.size[2])
  const compact = rig.kind === 'native' || rig.bones.length > 40
  const handleMin = diag * (compact ? 0.0007 : 0.003)
  const handleMax = diag * (compact ? 0.0045 : 0.018)
  const makeLineMaterial = () =>
    new THREE.LineBasicMaterial({
      color: BONE_LINE_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    })

  const joints = new Map<string, THREE.Group>()
  const bendJoints = new Map<string, THREE.Group>()

  // Logical `root` is part of the skinning parent chain (bind T(root.head)).
  // Keep a matching Three.js node so children of root don't sit at the origin
  // while matrices still subtract root.head (bones floating below the mesh).
  const rootBone = rig.bones.find((b) => b.id === 'root')
  if (rootBone) {
    const joint = new THREE.Group()
    joint.name = meshBoneGroupName('root')
    joint.userData.limbId = 'root'
    joint.userData.isMeshBone = true
    joint.userData.isRootBone = true
    joint.userData.tipLocal = [
      rootBone.tip[0] - rootBone.head[0],
      rootBone.tip[1] - rootBone.head[1],
      rootBone.tip[2] - rootBone.head[2],
    ] as [number, number, number]
    joint.position.set(rootBone.head[0], rootBone.head[1], rootBone.head[2])
    joint.userData.baseLocal = [...rootBone.head] as [number, number, number]

    const rootR = Math.min(Math.max(diag * (compact ? 0.0025 : 0.008), handleMin), handleMax)
    const rootHit = new THREE.Mesh(
      new THREE.SphereGeometry(rootR, 10, 10),
      makeBoneJointMaterial(BONE_ROOT_COLOR),
    )
    rootHit.userData.limbId = 'root'
    rootHit.userData.boneHandle = 'rot'
    rootHit.userData.baseColor = BONE_ROOT_COLOR
    rootHit.userData.handleRadius = rootR
    rootHit.userData.handleMin = handleMin
    rootHit.userData.handleMax = handleMax
    joint.add(rootHit)
    root.add(joint)
    joints.set('root', joint)
  }

  for (const bone of rig.bones) {
    if (bone.id === 'root') continue

    const tipLocal: [number, number, number] = [
      bone.tip[0] - bone.head[0],
      bone.tip[1] - bone.head[1],
      bone.tip[2] - bone.head[2],
    ]
    const len = Math.hypot(tipLocal[0], tipLocal[1], tipLocal[2]) || 0.01
    const hitRadius = Math.min(Math.max(len * (compact ? 0.018 : 0.04), handleMin), handleMax)
    // Draw only to the bend/elbow so the line meets the next bone.
    const lineEndT = bone.hasBend ? bone.bendT : 1
    const lineEnd: [number, number, number] = [
      tipLocal[0] * lineEndT,
      tipLocal[1] * lineEndT,
      tipLocal[2] * lineEndT,
    ]

    const joint = new THREE.Group()
    joint.name = meshBoneGroupName(bone.id)
    joint.userData.limbId = bone.id
    joint.userData.isMeshBone = true
    joint.userData.tipLocal = tipLocal

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(hitRadius, 10, 10),
      makeBoneJointMaterial(BONE_JOINT_COLOR),
    )
    hit.userData.limbId = bone.id
    hit.userData.boneHandle = 'rot'
    hit.userData.baseColor = BONE_JOINT_COLOR
    hit.userData.handleRadius = hitRadius
    hit.userData.handleMin = handleMin
    hit.userData.handleMax = handleMax
    // Forearm / shin / hand / foot heads sit on the parent's elbow/knee tip, so
    // their rot balls would stack on the orange bend ball. Park them mid-shaft
    // so each joint stays separately clickable; the joint group stays at the head.
    if (!bone.hasBend) {
      hit.position.set(tipLocal[0] * 0.45, tipLocal[1] * 0.45, tipLocal[2] * 0.45)
    }
    joint.add(hit)

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lineEnd[0], lineEnd[1], lineEnd[2]),
    ])
    const line = new THREE.Line(lineGeom, makeLineMaterial())
    line.name = `mesh-bone-line:${bone.id}`
    line.userData.limbId = bone.id
    joint.add(line)

    if (bone.hasBend) {
      const bend = new THREE.Group()
      bend.name = meshBoneBendGroupName(bone.id)
      bend.position.set(lineEnd[0], lineEnd[1], lineEnd[2])
      bend.userData.limbId = bone.id
      bend.userData.isMeshBone = true
      bend.userData.isBend = true
      bend.userData.baseLocal = [lineEnd[0], lineEnd[1], lineEnd[2]]
      const bendHit = new THREE.Mesh(
        new THREE.SphereGeometry(hitRadius * 1.05, 10, 10),
        makeBoneJointMaterial(BONE_BEND_COLOR),
      )
      bendHit.userData.limbId = bone.id
      bendHit.userData.boneHandle = 'bend'
      bendHit.userData.baseColor = BONE_BEND_COLOR
      bendHit.userData.handleRadius = hitRadius * 1.05
      bendHit.userData.handleMin = handleMin
      bendHit.userData.handleMax = handleMax
      // Slightly larger on-screen so elbows/knees win over nearby rot balls.
      bendHit.userData.handleBoost = 1.15
      bend.add(bendHit)
      joint.add(bend)
      bendJoints.set(bone.id, bend)
    }

    joints.set(bone.id, joint)
  }

  // Parent joints so elbow/knee bend carries distal bones (matches skinning).
  for (const bone of rig.bones) {
    if (bone.id === 'root') continue
    const joint = joints.get(bone.id)!
    let parentObj: THREE.Object3D = root
    let anchor: [number, number, number] = [0, 0, 0]

    if (bone.parent != null) {
      const parentBone = rig.bones[rig.indexOf[bone.parent]!]!
      if (parentBone.id === 'root') {
        parentObj = joints.get('root') ?? root
        anchor = parentBone.head
      } else if (parentBone.hasBend) {
        const bend = bendJoints.get(parentBone.id)
        if (bend) {
          parentObj = bend
          anchor = [
            parentBone.head[0]
              + (parentBone.tip[0] - parentBone.head[0]) * parentBone.bendT,
            parentBone.head[1]
              + (parentBone.tip[1] - parentBone.head[1]) * parentBone.bendT,
            parentBone.head[2]
              + (parentBone.tip[2] - parentBone.head[2]) * parentBone.bendT,
          ]
        } else {
          parentObj = joints.get(parentBone.id) ?? root
          anchor = parentBone.head
        }
      } else {
        parentObj = joints.get(parentBone.id) ?? root
        anchor = parentBone.head
      }
    }

    const local: [number, number, number] = [
      bone.head[0] - anchor[0],
      bone.head[1] - anchor[1],
      bone.head[2] - anchor[2],
    ]
    joint.position.set(local[0], local[1], local[2])
    joint.userData.baseLocal = local
    parentObj.add(joint)
  }

  // Overlay pass: draw last, ignore depth, and never cull — skinning and placement
  // both move the body under these handles.
  root.traverse((obj) => {
    obj.userData.boneOverlay = true
    obj.renderOrder = BONE_OVERLAY_RENDER_ORDER
    obj.frustumCulled = false
  })

  return root
}

/** Apply a column-major TR matrix to a Three.js object (scale forced to 1). */
const _boneMat = new THREE.Matrix4()
const _bonePos = new THREE.Vector3()
const _boneQuat = new THREE.Quaternion()
const _boneScale = new THREE.Vector3()

function applyColumnMat4ToObject(matrix: number[], object: THREE.Object3D): void {
  _boneMat.fromArray(matrix)
  _boneMat.decompose(_bonePos, _boneQuat, _boneScale)
  object.position.copy(_bonePos)
  object.quaternion.copy(_boneQuat)
  object.scale.set(1, 1, 1)
}

/** Keep stick lines glued from each joint to its bend / first child. */
function syncMeshBoneHelperLines(group: THREE.Object3D, rig: MeshBoneRig): void {
  const bonesRoot = group.getObjectByName('mesh-bones')
  if (!bonesRoot) return
  bonesRoot.updateWorldMatrix(true, true)
  const worldEnd = new THREE.Vector3()
  const localEnd = new THREE.Vector3()

  for (const bone of rig.bones) {
    if (bone.id === 'root') continue
    const joint = group.getObjectByName(meshBoneGroupName(bone.id))
    if (!joint) continue
    const line = joint.getObjectByName(`mesh-bone-line:${bone.id}`) as THREE.Line | null
    if (!line) continue

    if (bone.hasBend) {
      const bend = group.getObjectByName(meshBoneBendGroupName(bone.id))
      if (bend) {
        localEnd.copy(bend.position)
      } else {
        const tip = joint.userData.tipLocal as [number, number, number] | undefined
        localEnd.set(
          (tip?.[0] ?? 0) * bone.bendT,
          (tip?.[1] ?? 0) * bone.bendT,
          (tip?.[2] ?? 0) * bone.bendT,
        )
      }
    } else {
      const child = rig.bones.find((b) => b.parent === bone.id)
      const childJoint = child
        ? group.getObjectByName(meshBoneGroupName(child.id))
        : null
      if (childJoint) {
        childJoint.getWorldPosition(worldEnd)
        joint.worldToLocal(localEnd.copy(worldEnd))
      } else {
        const tip = joint.userData.tipLocal as [number, number, number] | undefined
        localEnd.set(tip?.[0] ?? 0, tip?.[1] ?? 0, tip?.[2] ?? 0)
      }
    }

    const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute
    positions.setXYZ(0, 0, 0, 0)
    positions.setXYZ(1, localEnd.x, localEnd.y, localEnd.z)
    positions.needsUpdate = true
    line.geometry.computeBoundingSphere()
  }
}

function applyMeshBonePoseToPreview(
  group: THREE.Object3D,
  pose: MeshBonePose | null | undefined,
  options?: {
    skinOnly?: boolean
    preserveObject?: THREE.Object3D | null
    deform?: MeshSkinMode
  },
): void {
  const rig = group.userData.meshBoneRig as MeshBoneRig | undefined
  if (!rig) return

  const preserve = options?.preserveObject ?? null

  // Drive bone helpers from the same matrices that skin the mesh (single source of truth).
  // Hierarchy matrices omit global root channels; those live on `mesh-bones` so the
  // Three.js parent chain matches computeMeshBoneMatrices (including logical root).
  if (!options?.skinOnly) {
    const activePose = pose ?? ensureMeshBonePose(null, rig)
    const overlayPose = meshBonePoseWithoutRoot(activePose)
    const matrices = computeMeshBoneMatrices(rig, overlayPose)
    const bonesRoot = group.getObjectByName('mesh-bones')
    if (bonesRoot && bonesRoot !== preserve) {
      const rootPose = activePose.root
      bonesRoot.position.set(rootPose.pos[0], rootPose.pos[1], rootPose.pos[2])
      bonesRoot.rotation.order = 'XYZ'
      bonesRoot.rotation.set(
        THREE.MathUtils.degToRad(rootPose.rot[0]),
        THREE.MathUtils.degToRad(rootPose.rot[1]),
        THREE.MathUtils.degToRad(rootPose.rot[2]),
      )
      bonesRoot.updateMatrixWorld(false)
    }

    for (let i = 0; i < rig.bones.length; i += 1) {
      const bone = rig.bones[i]!
      const joint = group.getObjectByName(meshBoneGroupName(bone.id))
      if (joint && joint !== preserve) {
        const parentWorld = meshBoneParentPoseWorld(rig, i, matrices)
        const local = mat4LocalFromWorld(parentWorld, matrices.poseWorld[i]!)
        applyColumnMat4ToObject(local, joint)
        // Skinning uses poseWorld directly; Three.js needs parent matrixWorld fresh
        // before children render or worldToLocal (rotation desync otherwise).
        joint.updateMatrixWorld(false)
      }
      if (bone.hasBend) {
        const bend = group.getObjectByName(meshBoneBendGroupName(bone.id))
        const bendWorld = matrices.bendWorld[i]
        if (bend && bend !== preserve && bendWorld) {
          const local = mat4LocalFromWorld(matrices.poseWorld[i]!, bendWorld)
          applyColumnMat4ToObject(local, bend)
          bend.updateMatrixWorld(false)
        }
      }
    }

    syncMeshBoneHelperLines(group, rig)
    group.getObjectByName('mesh-bones')?.updateMatrixWorld(true)
  }

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = mesh.geometry as THREE.BufferGeometry
    const rest = geometry.userData.restPositions as Float32Array | undefined
    const boneSkin = geometry.userData.boneSkin as MeshBoneWeights | undefined
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!rest || !boneSkin || !posAttr) return
    applyMeshBonePoseToPositions(
      rest,
      posAttr,
      rig,
      boneSkin,
      pose,
      options?.deform
        ?? (group.userData.meshSkinMode as MeshSkinMode | undefined)
        ?? 'rigid',
    )
    posAttr.needsUpdate = true
    geometry.computeVertexNormals()
    // Posed verts leave the bind bounds — stale spheres cull the body mid-pose.
    geometry.computeBoundingSphere()
  })
}

function rgbaOpaqueRatio(image: { width: number; height: number; data: Uint8ClampedArray }): number {
  const { width, height, data } = image
  if (width < 1 || height < 1) return 0
  const stepX = Math.max(1, Math.floor(width / 64))
  const stepY = Math.max(1, Math.floor(height / 64))
  let opaque = 0
  let total = 0
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      total += 1
      if (data[(y * width + x) * 4 + 3]! >= 20) opaque += 1
    }
  }
  return total > 0 ? opaque / total : 0
}

function rgbaHasCutout(image: { width: number; height: number; data: Uint8ClampedArray }): boolean {
  const ratio = rgbaOpaqueRatio(image)
  return ratio >= 0.02 && ratio <= 0.99
}

/** True when a texture mixes opaque and empty texels (vanilla entity cutout). */
function textureLooksLikeCutout(texture: THREE.Texture): boolean {
  const image = texture.image as CanvasImageSource & { width?: number; height?: number }
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (width < 1 || height < 1) return false
  try {
    const canvas = document.createElement('canvas')
    const w = Math.min(64, width)
    const h = Math.min(64, height)
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(image, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let opaque = 0
    let clear = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! >= 20) opaque += 1
      else clear += 1
    }
    const total = opaque + clear
    return total > 0 && opaque / total >= 0.02 && clear / total >= 0.01
  } catch {
    return false
  }
}

function pickPreviewTexture(
  textures: Record<string, Uint8Array>,
  mapKd: string | null,
): [string, Uint8Array] | null {
  if (!mapKd) return null
  if (textures[mapKd]) return [mapKd, textures[mapKd]!]
  const hit = Object.entries(textures).find(([name]) => exportNamesMatch(name, mapKd))
  return hit ?? null
}

function onlyTexture(
  textures: Record<string, Uint8Array>,
): [string, Uint8Array] | null {
  const entries = Object.entries(textures)
  return entries.length === 1 ? entries[0]! : null
}

function dataTextureFromRgba(image: { width: number; height: number; data: Uint8ClampedArray }): THREE.DataTexture {
  const data = new Uint8Array(image.data)
  const texture = new THREE.DataTexture(data, image.width, image.height, THREE.RGBAFormat)
  texture.flipY = true
  texture.unpackAlignment = 1
  texture.premultiplyAlpha = false
  texture.generateMipmaps = false
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

async function loadTextureFromBytes(
  bytes: Uint8Array,
): Promise<{ texture: THREE.Texture; url: string; rgba?: { width: number; height: number; data: Uint8ClampedArray } }> {
  const decoded = await decodeImageRgba(bytes)
  if (decoded && decoded.width > 0 && decoded.height > 0 && rgbaOpaqueRatio(decoded) >= 0.005) {
    const texture = dataTextureFromRgba(decoded)
    applyTextureSampling(texture, true)
    return { texture, url: '', rgba: decoded }
  }
  let payload = bytes
  const mime = sniffImageMime(bytes)
  if (mime === 'image/x-tga' || mime === 'image/tiff') {
    const ready = await ensureBrowserTexture('tex.tga', bytes)
    if (ready) payload = ready.bytes
  }
  const copy = Uint8Array.from(payload)
  const url = URL.createObjectURL(new Blob([copy], { type: mimeForTextureBytes('tex', copy) }))
  const texture = await loadTexture(url)
  return { texture, url, rgba: decoded ?? undefined }
}

function parseObjInWorker(
  objBytes: Uint8Array,
  mtlBytes: Uint8Array | null,
  textures: Record<string, Uint8Array>,
  onProgress: (ratio: number, label: string) => void,
  options?: { skipOutlierFilter?: boolean },
): Promise<Extract<PreviewResponse, { ok: true }>> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        onProgress(0.08, 'Decoding textures…')
        const decodedTextures: Record<string, { width: number; height: number; data: ArrayBuffer }> = {}
        const transfer: ArrayBuffer[] = []
        for (const [name, bytes] of Object.entries(textures)) {
          const image = await decodeImageRgba(bytes)
          if (!image) continue
          const pixels = new Uint8ClampedArray(image.data)
          const dataCopy = pixels.buffer.slice(
            pixels.byteOffset,
            pixels.byteOffset + pixels.byteLength,
          )
          decodedTextures[name.toLowerCase()] = {
            width: image.width,
            height: image.height,
            data: dataCopy,
          }
          transfer.push(dataCopy)
        }

        const worker = new Worker(new URL('./objPreview.worker.ts', import.meta.url), {
          type: 'module',
        })
        const id = Math.floor(Math.random() * 1_000_000_000)
        const objCopy = objBytes.slice().buffer
        const mtlCopy = mtlBytes ? mtlBytes.slice().buffer : null
        transfer.push(objCopy)
        if (mtlCopy) transfer.push(mtlCopy)
        const textureCopies: Record<string, ArrayBuffer> = {}
        for (const [name, bytes] of Object.entries(textures)) {
          const copy = bytes.slice().buffer
          textureCopies[name] = copy
          transfer.push(copy)
        }

        worker.onmessage = (event: MessageEvent) => {
          const data = event.data
          if (data?.type === 'progress' && data.id === id) {
            onProgress(data.ratio, data.label)
            return
          }
          const response = data as PreviewResponse
          if (response.id !== id) return
          worker.terminate()
          if (!response.ok) {
            reject(new Error(response.error))
            return
          }
          resolve(response)
        }
        worker.onerror = (event) => {
          worker.terminate()
          reject(event.error ?? new Error(event.message || 'Preview worker failed'))
        }
        worker.postMessage(
          {
            id,
            objBytes: objCopy,
            mtlBytes: mtlCopy,
            textures: textureCopies,
            decodedTextures,
            skipOutlierFilter: options?.skipOutlierFilter,
          },
          transfer,
        )
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}

function srgbVertexColorsToLinear(colors: Float32Array): Float32Array {
  if (!THREE.ColorManagement?.enabled) return colors
  const out = new Float32Array(colors.length)
  for (let i = 0; i < colors.length; i += 1) {
    const c = colors[i]!
    out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return out
}

function applyTextureSampling(texture: THREE.Texture, forceNearest: boolean) {
  const image = texture.image as { width?: number; height?: number } | undefined
  const nearest = forceNearest || textureLooksPixelArt(image?.width ?? 0, image?.height ?? 0)
  if (nearest) {
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
  } else {
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
  }
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
}

function loadTexture(url: string, forceNearest = false): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (texture) => {
        applyTextureSampling(texture, forceNearest)
        resolve(texture)
      },
      undefined,
      () => reject(new Error('Could not decode texture')),
    )
  })
}
