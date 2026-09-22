import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { bytesToBase64, bytesToBase64Async, cleanupStagedPaths, convertScene, loadModelCubes, loadPalette, logDebug, localFileSize, nextConvertGeneration, readLocalFileBytes, readLocalFileChunk, saveExport, stageBytesToTemp } from '../../api'
import {
  applyStatueMaterialPreset,
  baseBlockId,
  cubeId,
  cubeIsDisabled,
  fluidColorIds,
  formatStacks,
  friendlyBlockName,
  poorModelColorIds,
  materialCategory,
  materialCategoryLabel,
  scrubBlockOverrides,
  scrubBlockSubstitutions,
  scrubSupportBlock,
  STATUE_MATERIAL_PRESET_META,
  staircaseSupportChoices,
  type StatueMaterialPreset,
} from '../../materials'
import { litematicExportFormat, litematicSchematicVersion, subscribeMinecraftVersion } from '../../minecraftVersion'
import { BlockIcon } from '../../components/BlockIcon'
import { BlockReplaceDialog, type BlockReplaceTarget } from '../../components/BlockReplaceDialog'
import { LightfallToggle } from '../../components/LightfallPreference'
import { ThemeToggle } from '../../theme/AppTheme'
import { CapeField, CapePickerDialog, type CapeSelection } from './CapePickerDialog'
import { officialCapeById } from './capeModel'
import { MinecraftAddDialog } from './MinecraftAddDialog'
import { ensureCatalogEntityTextures } from './minecraftCatalog'
import { catalogKeepConvertOverlays } from './entityCatalogFixes'
import MinecraftVersionSelect from '../../components/MinecraftVersionSelect'
import { MissingTextureWarnings } from '../../components/MissingTextureWarnings'
import { CopyableNotice, TopbarStatus } from '../../components/AppErrorHost'
import { statusFromError } from '../../appError'
import {
  AppDialog,
  AxisSlider,
  CheckRow,
  ChipButton,
  DropZone,
  ExportButton,
  NumberField,
  PanelTitle,
  PresetCards,
  RangeField,
  SearchField,
  Segmented,
  SelectField,
  SwitchRow,
  LoadOverlay,
  compactLabel,
  fileProgressLabel,
  overlayFromProgress,
} from '../../ui/kit'
import { Button, Checkbox, Text } from '@radix-ui/themes'
import {
  createObjPart,
  createSkinPart,
  defaultModelOptions,
  nativeSkinSize,
  nativeSlimSkinSize,
  resolveModelColourMatching,
  resolveModelUv,
  skinAtlasSizeMultiplier,
  type ExportFormat,
  type GravitySupportMode,
  type ModelAppearanceCube,
  type PaletteFile,
  type SceneConversionResponse,
  type ScenePartLocal,
  type ColourMatching,
  type DitherMode,
  type ModelUvOptions,
  type StatueBlockPack,
  type UvWrap,
  type VoxelFit,
  type VoxelPreviewStyle,
} from '../../types'
import type { MeshPreviewPart } from './MeshPreviewViewer'
import {
  applyObjAutoSize,
  applyObjSizePreset,
  applySkinArmStyle,
  applySkinLinkedAxis,
  applySkinSizePreset,
  describePartSize,
  matchObjSizePreset,
  matchSkinSizePreset,
  nativeBoxForSkin,
  OBJ_SIZE_PRESETS,
  SKIN_SIZE_PRESETS,
  WORKFLOW_STEPS,
  type ObjSizePresetId,
  type SkinSizePresetId,
  type WorkflowStep,
} from './modelsPresets'
import {
  blockTextureWarningLabel,
  ensureTextureCacheLoaded,
  findMissingBlockTextures,
  getTextureCacheEpoch,
  subscribeTextureCache,
} from './blockTextures'
import { extractCharacterPose, createRestSkinPose, emptyPartPose, partHasCape, partSupportsPoseEditing, poseLimbsForCatalogEntity, poseLimbsForEditor, skinPoseLimbBase, skinPoseLimbIsBend, SKIN_BEND_LIMBS, type CharacterPose, type SkinPoseLimbId } from './characterPose'
import {
  bakeObjPartPose,
  buildPoseFollowerMap,
  cloneMeshPoseStrokes,
  commitLivePoseStroke,
  ensureMeshPartPose,
  meshObjectNamesFromObj,
  meshPoseHostLimbId,
  poseEditableObjectNames,
  poseIsActive,
  objAxisAlignedSize,
  catalogEntityVoxelBox,
  scanObjObjectBounds,
  stripMinecraftOverlayObjects,
  type MeshPartPose,
} from './objPartPose'
import {
  bakeMeshBonePose,
  createRestMeshBonePose,
  emptyMeshBonePartPose,
  ensureMeshBonePose,
  isMeshBoneRigMode,
  meshBoneBendTargetId,
  meshBoneHingeAxisFor,
  meshBoneOffsetDecimals,
  meshBoneOffsetRange,
  meshBoneOffsetStep,
  meshBonePoseIsActive,
  meshBonePoseToSkinPose,
  meshBonePoseUsesHumanoidJoints,
  meshBoneSupportsBend,
  meshSkinModeOf,
  partUsesClassicPoseByDefault,
  partUsesMeshBones,
  playerSkinHumanoidRig,
  type MeshSkinMode,
  rigForObjBytes,
  type MeshBonePose,
  type MeshBoneRig,
  type MeshRigMode,
} from './meshBoneRig'
import {
  acceptAttribute,
  autoLoadMayaSiblings,
  companionDialogExtensions,
  detectFormat,
  importBbmodel,
  importMaya,
  importVox,
  isMimodelFileName,
  isTextureFileName,
  primaryDialogExtensions,
  supportedFormatsHint,
} from './formats'
import {
  basename,
  fileFromPath,
  fileSystemPath,
  fileWithPath,
  readFileWithProgress,
  scanMtlTextureRefs,
  rewriteMtlTextureRefs,
  scanObjDependencies,
  tryReadMiobjectCompanions,
  tryReadSiblingBytes,
  clampVoxelBox,
  MC_WORLD_HEIGHT,
} from './objAssets'
import { expandDroppedLocalPaths } from './sidecarTextures'
import { IN_MEMORY_OBJ_MAX, OBJ_FULL_LOAD_MAX } from './objStream'
import {
  objGeometryBytes,
  objSceneObjects,
  resolveExcludedObjects,
  suggestedStudioProps,
  type ObjSceneObject,
} from './objSceneObjects'
import {
  decodeTextureRgba,
  mimodelTextureFileName,
  mimodelToObj,
  scanMiobjectDependencies,
  type MimodelPose,
  type MimodelPartPose,
} from './miobjectAssets'
import { resolveTextureSiblings, textureNamesToProbe, isRasterTextureName, ensureRgbaPngBytes, isWantedTextureOnDisk } from './decodeImage'
import { exportNamesMatch, findEntryByExportName, foldExportName, repairMojibake } from './exportText'
import { detectSlimSkinBytes, inspectPlayerSkin, skinHdNote } from './skinModel'
import { companionDropShouldAttachToSelection, type SourceDropIntent } from './sourceDropIntent'
import { useModelsHistory, snapshotNeedsProgress, type ModelsHistorySnapshot } from './useModelsHistory'
import './voxel-viewer.css'
import '../../workspace.css'

const MeshPreviewViewer = lazy(() => import('./MeshPreviewViewer'))
const VoxelSceneViewer = lazy(() => import('./VoxelSceneViewer'))
const MATERIAL_PRESETS = STATUE_MATERIAL_PRESET_META

function rigModeOf(part: {
  kind?: string
  mimodelBytes?: Uint8Array | null
  meshRigMode?: string | null
  meshBonePose?: unknown
  nativeMeshRig?: MeshBoneRig | null
  sourceLabel?: string | null
}): MeshRigMode {
  const mode = part.meshRigMode
  if (partUsesClassicPoseByDefault(part) && !isMeshBoneRigMode(mode)) {
    return 'classic'
  }
  if (mode === 'native' && part.nativeMeshRig) return 'native'
  if (mode === 'auto' || mode === 'humanoid' || mode === 'generic') return mode
  if (part.nativeMeshRig) return 'native'
  // Parts posed before shape-derived rigs existed keep the skeleton they were
  // posed with, so reopening a project doesn't wipe the posing work.
  if (meshBonePoseUsesHumanoidJoints(part.meshBonePose as MeshBonePose | null)) {
    return 'humanoid'
  }
  return 'auto'
}

function boneFitModeOf(part: {
  kind?: string
  mimodelBytes?: Uint8Array | null
  meshRigMode?: string | null
  meshBonePose?: unknown
  nativeMeshRig?: MeshBoneRig | null
}): Exclude<MeshRigMode, 'classic'> {
  const mode = rigModeOf(part)
  return mode === 'classic' ? 'auto' : mode
}

function rigOfPart(
  part: Pick<
    ScenePartLocal,
    'meshRigMode' | 'meshBonePose' | 'nativeMeshRig' | 'bytes' | 'kind' | 'mimodelBytes' | 'excludedObjects' | 'slimArms'
  >,
  objBytes = partObjBytes(part),
): MeshBoneRig | null {
  const mode = rigModeOf(part)
  if (mode === 'classic') return null
  if (part.kind === 'skin') {
    // PNG skins always use the Steve/Alex template — Shape fitting needs a mesh.
    return playerSkinHumanoidRig(part.slimArms)
  }
  return mode === 'native' ? part.nativeMeshRig ?? null : rigForObjBytes(objBytes, mode)
}

type ObjFilterablePart = {
  kind?: string
  bytes: Uint8Array
  mimodelBytes?: Uint8Array | null
  excludedObjects?: string[] | null
}

/** Parts whose OBJ text we can list objects for and rewrite. */
function partHasObjText(part: ObjFilterablePart): boolean {
  return part.kind === 'obj' && !part.mimodelBytes?.length && part.bytes.length >= 64
}

/** Objects left out of this part, whether chosen by the user or guessed. */
function excludedObjectsOf(part: ObjFilterablePart): readonly string[] {
  if (!partHasObjText(part)) return []
  return resolveExcludedObjects(part.bytes, part.excludedObjects)
}

/**
 * The part's geometry with excluded objects stripped out. Everything that reads
 * the mesh — preview, rigging, posing, convert — goes through here so a hidden
 * backdrop can't come back as voxels.
 */
function partObjBytes(part: ObjFilterablePart): Uint8Array {
  if (!partHasObjText(part)) return part.bytes
  return objGeometryBytes(part.bytes, part.excludedObjects)
}

/** True when convert cannot reuse the original on-disk OBJ (hidden objects or a pose). */
function objPartNeedsRewrite(part: ScenePartLocal): boolean {
  if (part.kind !== 'obj' || part.mimodelBytes?.length) return false
  if ((part.excludedObjects?.length ?? 0) > 0) return true
  if (
    part.meshBonePose
    && meshBonePoseIsActive(part.meshBonePose as MeshBonePose, part.nativeMeshRig ?? null)
  ) {
    return true
  }
  return Boolean(part.skinPose && poseIsActive(part.skinPose as MeshPartPose))
}

/**
 * Change which objects a part uses. Auto-sized parts get remeasured, since
 * dropping a backdrop is usually the whole reason the box was wrong.
 */
function applyExcludedObjects(
  part: ScenePartLocal,
  excluded: string[] | null,
): ScenePartLocal {
  const next: ScenePartLocal = { ...part, excludedObjects: excluded }
  return next.objSizePreset === 'auto' ? applyObjAutoSize(next) : next
}

function poseFromMiobject(bytes: Uint8Array | null | undefined): MimodelPose | null {
  if (!bytes || bytes.length === 0) return null
  try {
    const pose = extractCharacterPose(bytes)
    return { root: pose.root, parts: pose.parts }
  } catch {
    return null
  }
}
type SharedOptions = {
  disabledColorIds: number[]
  blockOverrides: Record<number, string>
  blockPack: StatueBlockPack
  disabledBlocks: string[]
  blockSubstitutions: Record<string, string>
  supportMode: GravitySupportMode
  supportBlock: string
  colourMatching: ColourMatching
  dither: DitherMode
  hue: number
  brightness: number
  contrast: number
  saturation: number
}

export default function ModelsApp({ onBack }: { onBack: () => void }) {
  const [palette, setPalette] = useState<PaletteFile | null>(null)
  const [parts, setParts] = useState<ScenePartLocal[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedLimb, setSelectedLimb] = useState<string>('right_arm')
  const [step, setStep] = useState<WorkflowStep>('sources')
  const [shared, setShared] = useState<SharedOptions>({
    disabledColorIds: defaultModelOptions.disabledColorIds,
    blockOverrides: defaultModelOptions.blockOverrides,
    blockPack: defaultModelOptions.blockPack,
    disabledBlocks: defaultModelOptions.disabledBlocks,
    blockSubstitutions: defaultModelOptions.blockSubstitutions,
    supportMode: defaultModelOptions.supportMode,
    supportBlock: defaultModelOptions.supportBlock,
    colourMatching: defaultModelOptions.colourMatching,
    dither: defaultModelOptions.dither,
    hue: defaultModelOptions.hue,
    brightness: defaultModelOptions.brightness,
    contrast: defaultModelOptions.contrast,
    saturation: defaultModelOptions.saturation,
  })
  const [result, setResult] = useState<SceneConversionResponse | null>(null)
  const [textureWarnings, setTextureWarnings] = useState<string[]>([])
  const [textureCacheEpoch, setTextureCacheEpoch] = useState(() => getTextureCacheEpoch())
  const [status, setStatus] = useState('Add an OBJ or player skin to begin')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  busyRef.current = busy
  const [dragging, setDragging] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [modelCubes, setModelCubes] = useState<ModelAppearanceCube[]>([])
  const [materialSearch, setMaterialSearch] = useState('')
  const [activePreset, setActivePreset] = useState<StatueMaterialPreset | 'custom'>('everything')
  const [replaceTarget, setReplaceTarget] = useState<BlockReplaceTarget | null>(null)
  const [previewStyle, setPreviewStyle] = useState<VoxelPreviewStyle>('textures')
  const [model3dNavigation, setModel3dNavigation] = useState<'orbit' | 'free'>('orbit')
  const [showCustomSize, setShowCustomSize] = useState(false)
  const [capePickerOpen, setCapePickerOpen] = useState(false)
  const [customUniformFit, setCustomUniformFit] = useState(true)
  const [placementDirty, setPlacementDirty] = useState(false)
  const partsRef = useRef(parts)
  partsRef.current = parts
  const mimodelRebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped when materials change so an existing build re-voxelizes in place. */
  const [materialsTick, setMaterialsTick] = useState(0)
  /** On Build tab: show source mesh even after a voxel result exists. */
  const [showSourcePreview, setShowSourcePreview] = useState(true)
  /** Extrude second skin layer (hats/jackets) into a 3D shell. */
  const [freeBend, setFreeBend] = useState(() => {
    try {
      const value = localStorage.getItem('structurelab.freeBend')
      if (value != null) return value !== '0'
      return true
    } catch {
      return true
    }
  })
  const [smoothJoints, setSmoothJoints] = useState(() => {
    try {
      const value = localStorage.getItem('structurelab.smoothJoints')
      if (value != null) return value !== '0'
      return true
    } catch {
      return true
    }
  })
  const [skinLimbBend, setSkinLimbBend] = useState(() => {
    try {
      const value = localStorage.getItem('structurelab.skinLimbBend')
      if (value != null) return value !== '0'
      return true
    } catch {
      return true
    }
  })
  const [outer3d, setOuter3d] = useState(() => {
    try {
      const value = localStorage.getItem('structurelab.outer3d')
        ?? localStorage.getItem('mc-tools.outer3d')
      if (value != null) return value !== '0'
      const legacy = localStorage.getItem('mc-tools.outerSkinLayer')
        ?? localStorage.getItem('mc-tools.buildPlayer3d')
      if (legacy != null) return legacy !== '0'
      return true
    } catch {
      return true
    }
  })
  const [loadProgress, setLoadProgress] = useState<{
    ratio: number
    label: string
    indeterminate?: boolean
  } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const skinInput = useRef<HTMLInputElement>(null)
  const companionInput = useRef<HTMLInputElement>(null)
  const runVoxelizeRef = useRef<() => Promise<boolean>>(async () => false)
  const voxelizeGenerationRef = useRef(0)
  const voxelizeInflightRef = useRef<Promise<boolean> | null>(null)
  const sharedRef = useRef(shared)
  sharedRef.current = shared
  /** Mix modes solve a whole plan per colour, so they dither themselves. */
  const ownsDithering =
    shared.colourMatching === 'structureLabMix' ||
    shared.colourMatching === 'structureLabSmooth'
  /** Keep the upload overlay up through mesh preview parse/clean. */
  const awaitPreviewOverlayRef = useRef(false)
  /** True only while waiting for a Source-tab mesh remount (not convert). */
  const sourcePreviewOverlayRef = useRef(false)
  const progressFloorRef = useRef(0)
  const historySnapshotRef = useRef<ModelsHistorySnapshot>({
    parts: [],
    selectedId: null,
    shared: {
      disabledColorIds: defaultModelOptions.disabledColorIds,
      blockOverrides: defaultModelOptions.blockOverrides,
      blockPack: defaultModelOptions.blockPack,
      disabledBlocks: defaultModelOptions.disabledBlocks,
      blockSubstitutions: defaultModelOptions.blockSubstitutions,
      supportMode: defaultModelOptions.supportMode,
      supportBlock: defaultModelOptions.supportBlock,
      colourMatching: defaultModelOptions.colourMatching,
      dither: defaultModelOptions.dither,
      hue: defaultModelOptions.hue,
      brightness: defaultModelOptions.brightness,
      contrast: defaultModelOptions.contrast,
      saturation: defaultModelOptions.saturation,
    },
    outer3d: true,
    freeBend: true,
    smoothJoints: true,
    skinLimbBend: true,
    placementDirty: false,
    step: 'sources',
    showSourcePreview: true,
  })
  historySnapshotRef.current = {
    parts,
    selectedId,
    shared,
    outer3d,
    freeBend,
    smoothJoints,
    skinLimbBend,
    placementDirty,
    step,
    showSourcePreview,
  }

  const applyHistorySnapshot = useCallback((snapshot: ModelsHistorySnapshot) => {
    startTransition(() => {
      setParts(snapshot.parts)
      setSelectedId(snapshot.selectedId)
      setShared({
        ...snapshot.shared,
        colourMatching: resolveModelColourMatching(snapshot.shared.colourMatching),
        dither: snapshot.shared.dither || 'none',
        blockPack: snapshot.shared.blockPack || 'everything',
        disabledBlocks: snapshot.shared.disabledBlocks ?? [],
        blockSubstitutions: snapshot.shared.blockSubstitutions ?? {},
        hue: snapshot.shared.hue ?? 0,
        brightness: snapshot.shared.brightness ?? 0,
        contrast: snapshot.shared.contrast ?? 0,
        saturation: snapshot.shared.saturation ?? 0,
      } as SharedOptions)
      setOuter3d(snapshot.outer3d)
      setFreeBend(snapshot.freeBend)
      setSmoothJoints(snapshot.smoothJoints)
      setSkinLimbBend(snapshot.skinLimbBend ?? true)
      setPlacementDirty(snapshot.placementDirty)
      setStep(snapshot.step)
      setShowSourcePreview(snapshot.showSourcePreview)
      setResult(null)
    })
  }, [])

  const {
    canUndo,
    canRedo,
    recordBeforeChange,
    endCoalesce,
    resetHistory,
    undo,
    redo,
  } = useModelsHistory(
    useCallback(() => historySnapshotRef.current, []),
    applyHistorySnapshot,
  )

  const runHistoryAction = useCallback(
    async (kind: 'undo' | 'redo') => {
      const live = historySnapshotRef.current
      const showProgress = snapshotNeedsProgress(live)
      if (showProgress) {
        progressFloorRef.current = 0
        setBusy(true)
        setLoadProgress({
          ratio: 0.08,
          label: kind === 'undo' ? 'Undoing…' : 'Redoing…',
        })
      }
      setStatus(kind === 'undo' ? 'Undo…' : 'Redo…')
      try {
        const ok =
          kind === 'undo'
            ? await undo((ratio, label) => {
                if (!showProgress) return
                setLoadProgress({ ratio, label })
              })
            : await redo((ratio, label) => {
                if (!showProgress) return
                setLoadProgress({ ratio, label })
              })
        if (!ok) {
          setStatus(kind === 'undo' ? 'Nothing to undo' : 'Nothing to redo')
          return
        }
        setStatus(kind === 'undo' ? 'Undo' : 'Redo')
      } finally {
        if (showProgress) {
          setLoadProgress(null)
          setBusy(false)
        }
      }
    },
    [redo, undo],
  )

  const performUndo = useCallback(() => {
    void runHistoryAction('undo')
  }, [runHistoryAction])

  const performRedo = useCallback(() => {
    void runHistoryAction('redo')
  }, [runHistoryAction])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      // Allow native undo inside free-text fields; number/range stay app-level.
      if (
        (tag === 'INPUT' && (target as HTMLInputElement).type === 'text')
        || (tag === 'INPUT' && (target as HTMLInputElement).type === 'search')
        || tag === 'TEXTAREA'
        || target?.isContentEditable
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        performUndo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        performRedo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [performRedo, performUndo])

  const selected = parts.find((part) => part.id === selectedId) ?? parts[0] ?? null

  // Keep the pose limb in sync with the selected mesh part's real object names.
  useEffect(() => {
    if (!selected || !partSupportsPoseEditing(selected)) return
    if (selected.kind === 'skin') {
      if (skinPoseLimbBase(selectedLimb) === 'cape' && !partHasCape(selected)) {
        setSelectedLimb('body')
      }
      return
    }
    if (partUsesMeshBones(selected)) {
      const rig = rigOfPart(selected)
      const ids = rig ? rig.bones.map((bone) => bone.id) : []
      if (ids.length > 0 && !ids.includes(selectedLimb)) {
        setSelectedLimb(ids.find((id) => id !== 'root') ?? ids[0]!)
      }
      return
    }
    if (selected.mimodelBytes?.length) return
    if (selected.bytes.length < 64) return
    if (selected.sourceLabel?.startsWith('Minecraft') && selected.kind === 'obj') {
      const pose = poseForPart(selected)
      if (!pose) return
      const ids = poseLimbsForCatalogEntity(pose).map((entry) => entry.id)
      if (selectedLimb === 'root') return
      if (!ids.includes(selectedLimb)) {
        setSelectedLimb(ids.find((id) => id !== 'root') ?? 'root')
      }
      return
    }
    const objBytes = partObjBytes(selected)
    const names = meshObjectNamesFromObj(objBytes)
    const followers = buildPoseFollowerMap(scanObjObjectBounds(objBytes))
    const editable = poseEditableObjectNames(names, followers)
    if (editable.length === 0) return
    if (selectedLimb === 'root') return
    if (!editable.includes(selectedLimb)) {
      const host = meshPoseHostLimbId(selectedLimb)
      setSelectedLimb(editable.includes(host) ? host : editable[0]!)
    }
  }, [selected, selectedLimb])

  const sceneObjects = useMemo(
    () => (selected && partHasObjText(selected) ? objSceneObjects(selected.bytes) : []),
    [selected],
  )

  /** `null` hands the choice back to automatic detection. */
  function setExcludedObjects(excluded: string[] | null) {
    if (!selected) return
    recordBeforeChange()
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id
          ? applyExcludedObjects(part, excluded)
          : part,
      ),
    )
    setResult(null)
    const count = excluded === null ? null : excluded.length
    setStatus(
      count === null
        ? 'Back to detected objects'
        : count === 0
          ? 'Using every object in the file'
          : `Leaving out ${count} ${count === 1 ? 'object' : 'objects'}`,
    )
  }

  const meshPreviewParts = useMemo(
    (): MeshPreviewPart[] =>
      parts.map((part) => {
        const pose = poseForPart(part)
        const bones = partUsesMeshBones(part)
        const objBytes = partObjBytes(part)
        return {
          id: part.id,
          fileName: part.fileName,
          bytes: objBytes,
          excludedObjects: excludedObjectsOf(part),
          kind: part.kind,
          sourcePath: part.sourcePath,
          sourceLabel: part.sourceLabel,
          mtlBytes: part.mtlBytes,
          textures: part.textures,
          voxBytes: part.voxBytes,
          slimArms: part.slimArms,
          showOuterLayer:
            part.skinOverlay === 'none'
              ? false
              : part.skinOverlay === 'hat'
                ? true
                : outer3d,
          skinOverlay: part.skinOverlay,
          skinLimbs: part.skinLimbs,
          capeBytes: part.capeBytes ?? null,
          capeId: part.capeId ?? null,
          capeFileName: part.capeFileName ?? null,
          pose: bones
            ? null
            : pose
              ? {
                  ...pose,
                  rigid:
                    Boolean(pose.rigid)
                    || Boolean(part.sourceLabel?.startsWith('Minecraft')),
                }
              : pose,
          jointStyle: part.skinPoseEuler === 'blockbench' ? 'blockbench' : 'mineimator',
          positionX: part.positionX,
          positionY: part.positionY,
          positionZ: part.positionZ,
          rotationX: part.rotationX ?? 0,
          rotationY: part.rotationY ?? 0,
          rotationZ: part.rotationZ ?? 0,
          width: part.width,
          height: part.height,
          length: part.length,
          fit: part.fit,
          useMeshBones: bones,
          rigMode: bones ? boneFitModeOf(part) : rigModeOf(part),
          nativeRig: part.nativeMeshRig,
          meshSkinMode: part.meshSkinMode,
          nativeWeights: excludedObjectsOf(part).length > 0 ? null : part.nativeMeshWeights,
          bonePose: bones
            ? ensureMeshBonePose(
                part.meshBonePose as MeshBonePose | null | undefined,
                rigOfPart(part, objBytes),
              )
            : null,
          meshObjectNames:
            !bones
            && part.kind === 'obj'
            && !part.mimodelBytes?.length
            && part.bytes.length >= 64
              ? (() => {
                  const names = meshObjectNamesFromObj(objBytes)
                  const followers = buildPoseFollowerMap(scanObjObjectBounds(objBytes))
                  return poseEditableObjectNames(names, followers)
                })()
              : undefined,
        }
      }),
    [parts, outer3d],
  )
  const onPreviewProgress = useCallback((ratio: number, label: string) => {
    setStatus(compactLabel(label, 72))
    // Only the viewer’s first drawn frame (or a hard fail / empty wait) closes
    // the overlay — worker “ready” labels must not dismiss it early.
    const finished =
      label === 'Preview ready'
      || label === 'Preview failed'
      || label === 'Waiting'
    if (finished) {
      awaitPreviewOverlayRef.current = false
      sourcePreviewOverlayRef.current = false
      progressFloorRef.current = 0
      setLoadProgress(null)
      return
    }
    awaitPreviewOverlayRef.current = true
    // After import the bar is already ~75%; source-only loads use the full range.
    const mapped =
      progressFloorRef.current >= 0.7
        ? 0.75 + Math.min(1, Math.max(0, ratio)) * 0.24
        : Math.min(0.99, Math.max(0.05, ratio))
    const next = Math.max(progressFloorRef.current, mapped)
    progressFloorRef.current = next
    const waitingOnGpu = /drawing preview|compiling|uploading/i.test(label)
    setLoadProgress({
      ratio: next,
      label: compactLabel(label, 40),
      indeterminate: waitingOnGpu,
    })
  }, [])

  function clearSourcePreviewOverlay() {
    sourcePreviewOverlayRef.current = false
    awaitPreviewOverlayRef.current = false
    if (busyRef.current) return
    progressFloorRef.current = 0
    setLoadProgress(null)
  }

  function revealSourcePreview() {
    const alreadyShowingMesh =
      showSourcePreview
      || !result
      || result.voxels.length === 0
      || (step !== 'build' && step !== 'export')
    setShowSourcePreview(true)
    if (alreadyShowingMesh) {
      // Viewer stays mounted, so Preview ready will never fire again.
      clearSourcePreviewOverlay()
      return
    }
    sourcePreviewOverlayRef.current = true
    awaitPreviewOverlayRef.current = true
    progressFloorRef.current = 0
    setLoadProgress({ ratio: 0.05, label: 'Loading source preview…' })
  }

  function revealVoxelPreview() {
    setShowSourcePreview(false)
    clearSourcePreviewOverlay()
  }

  useEffect(() => {
    if (!sourcePreviewOverlayRef.current) return
    const meshViewerMounted =
      parts.length > 0
      && !(
        Boolean(result?.voxels.length)
        && !showSourcePreview
        && (step === 'build' || step === 'export')
      )
    if (meshViewerMounted) return
    sourcePreviewOverlayRef.current = false
    awaitPreviewOverlayRef.current = false
    if (busyRef.current) return
    progressFloorRef.current = 0
    setLoadProgress(null)
  }, [parts.length, result, showSourcePreview, step])

  useEffect(() => {
    try {
      localStorage.setItem('structurelab.outer3d', outer3d ? '1' : '0')
      localStorage.setItem('structurelab.freeBend', freeBend ? '1' : '0')
      localStorage.setItem('structurelab.smoothJoints', smoothJoints ? '1' : '0')
      localStorage.setItem('structurelab.skinLimbBend', skinLimbBend ? '1' : '0')
    } catch {
      // ignore
    }
  }, [outer3d, freeBend, smoothJoints, skinLimbBend])

  const reloadPalette = useCallback(() => {
    loadPalette()
      .then((loaded) => {
        setPalette(loaded)
        setShared((current) => ({
          ...current,
          disabledColorIds: [
            ...new Set([
              ...current.disabledColorIds,
              ...fluidColorIds(loaded),
              ...(current.blockPack === 'everything' ? [] : poorModelColorIds(loaded)),
            ]),
          ],
        }))
      })
      .catch((error: unknown) => setStatus(statusFromError('Palette failed', error, { operation: 'load palette' })))
  }, [])

  useEffect(() => {
    if (!palette) return
    void loadModelCubes(shared.blockPack)
      .then(setModelCubes)
      .catch((error: unknown) => setStatus(statusFromError('Cube list failed', error, { operation: 'load statue cubes' })))
  }, [palette, shared.blockPack])

  const applyMinecraftVersionChange = useCallback(() => {
    // Drop in-flight voxelize results from the previous era.
    voxelizeGenerationRef.current += 1
    void ensureTextureCacheLoaded()
    setResult(null)
    setTextureWarnings([])
    setBusy(false)
    setStatus('Minecraft version changed — updating blocks…')
    void loadPalette()
      .then((loaded) => {
        setPalette(loaded)
        setShared((current) => ({
          ...current,
          blockOverrides: scrubBlockOverrides(loaded, current.blockOverrides),
          blockSubstitutions: scrubBlockSubstitutions(loaded, current.blockSubstitutions),
          supportBlock: scrubSupportBlock(loaded, current.supportBlock),
          disabledColorIds: [
            ...new Set([
              ...fluidColorIds(loaded),
              ...(current.blockPack === 'everything' ? [] : poorModelColorIds(loaded)),
              ...current.disabledColorIds.filter((id) =>
                loaded.colors.some((color) => color.id === id),
              ),
            ]),
          ],
        }))
        // Rebuild after React commits the scrubbed materials.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (historySnapshotRef.current.parts.length === 0) {
              setStatus('Add an OBJ or player skin to begin')
              return
            }
            void runVoxelizeRef.current()
          })
        })
      })
      .catch((error: unknown) => setStatus(statusFromError('Palette failed', error, { operation: 'load palette' })))
  }, [])

  useEffect(() => {
    reloadPalette()
    return subscribeMinecraftVersion(() => {
      applyMinecraftVersionChange()
    })
  }, [reloadPalette, applyMinecraftVersionChange])

  useEffect(() => {
    void ensureTextureCacheLoaded()
    return subscribeTextureCache(() => setTextureCacheEpoch(getTextureCacheEpoch()))
  }, [])

  useEffect(() => {
    if (!result) {
      setTextureWarnings([])
      return
    }
    let cancelled = false
    const blocks = [
      ...result.build.materials.map((material) => material.block),
      ...result.voxels.map((voxel) => voxel.block).filter((block): block is string => Boolean(block)),
    ]
    void findMissingBlockTextures(blocks).then((missing) => {
      if (cancelled) return
      setTextureWarnings(missing)
      if (missing.length > 0) {
        setStatus(
          `Voxelized · ${result.occupiedVoxels.toLocaleString()} blocks — ${missing.length} texture${missing.length === 1 ? '' : 's'} missing in preview`,
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [result, textureCacheEpoch])

  useEffect(() => {
    if (parts.length === 0) {
      setStep('sources')
      setResult(null)
    }
  }, [parts.length])

  /** Tauri drag-drop includes real disk paths (HTML FileList usually does not). */
  const loadFilesFromPathsRef = useRef<(paths: string[], mode?: SourceDropIntent | 'companions') => Promise<void>>(
    async () => {},
  )

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (cancelled) return
          if (event.payload.type === 'over') setDragging(true)
          if (event.payload.type === 'leave') setDragging(false)
          if (event.payload.type === 'drop') {
            setDragging(false)
            void loadFilesFromPathsRef.current(event.payload.paths)
          }
        })
      } catch {
        // Running outside Tauri (vite browser).
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  async function loadFilesFromPaths(paths: string[], mode: SourceDropIntent | 'companions' = 'models') {
    const clean = paths.filter(Boolean)
    if (clean.length === 0) return
    logDebug('[companions] load paths:', clean)
    let expanded: string[]
    try {
      expanded = await expandDroppedLocalPaths(clean)
    } catch (error) {
      logDebug('[companions] expand folders failed:', error)
      expanded = clean
    }
    if (expanded.length === 0) {
      setStatus('That folder has no models or textures we can read')
      return
    }
    const files = expanded.map((path) => fileFromPath(path))
    if (files.length === 0) {
      setStatus('Could not read the dropped files')
      return
    }
    if (mode === 'companions') await attachCompanions(files)
    else await addFiles(files, mode)
  }
  loadFilesFromPathsRef.current = loadFilesFromPaths

  /** Stage large converted OBJs to disk and drop in-memory bytes. */
  async function preferDiskForLargeObj(part: ScenePartLocal): Promise<ScenePartLocal> {
    if (part.sourcePath || part.bytes.length <= IN_MEMORY_OBJ_MAX) return part
    const path = await stageBytesToTemp(part.bytes, part.fileName)
    return { ...part, bytes: new Uint8Array(), sourcePath: path }
  }

  /** Native dialog keeps real disk paths so same-folder .mimodel / skins auto-load. */
  async function pickSourcesViaDialog(mode: 'models' | 'skins' | 'companions' = 'models') {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: mode === 'companions' ? 'Attach companions' : 'Add sources',
        filters:
          mode === 'skins'
            ? [{ name: 'Skins / miobject', extensions: ['png', 'miobject'] }]
            : mode === 'companions'
              ? [{ name: 'Companions', extensions: companionDialogExtensions() }]
              : [{
                  name: 'Models',
                  extensions: primaryDialogExtensions(),
                }],
      })
      if (!selected) return
      const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean)
      await loadFilesFromPaths(paths, mode === 'companions' ? 'companions' : mode === 'skins' ? 'skins' : 'models')
    } catch (error) {
      logDebug('[companions] dialog failed:', error)
      setStatus(statusFromError('Could not open files', error, { operation: 'open files' }))
    }
  }

  async function pickCompanionFolder() {
    try {
      const selectedPath = await openFileDialog({
        directory: true,
        multiple: true,
        title: 'Add texture folder',
      })
      if (!selectedPath) return
      const paths = (Array.isArray(selectedPath) ? selectedPath : [selectedPath]).filter(Boolean)
      await loadFilesFromPaths(paths, selected ? 'companions' : 'models')
    } catch (error) {
      logDebug('[companions] folder dialog failed:', error)
      setStatus(statusFromError('Could not open folder', error, { operation: 'open folder' }))
    }
  }

  function appendImportedParts(incoming: ScenePartLocal[]) {
    if (incoming.length === 0) return
    const current = partsRef.current
    const hadParts = current.length > 0
    if (hadParts) recordBeforeChange()
    let nextX = 0
    if (hadParts) {
      nextX = Math.max(...current.map((part) => part.positionX + part.width)) + 8
    }
    // Import-all already laid parts on a grid (varied X/Z). Shift the group
    // together so a single-add flow still spaces items in a row.
    const prelaid = incoming.some((part) => part.positionX !== 0 || part.positionZ !== 0)
    const placed = prelaid
      ? incoming.map((part) => ({ ...part, positionX: part.positionX + nextX }))
      : incoming.map((part) => {
          const positioned = { ...part, positionX: part.positionX + nextX }
          nextX += part.width + 8
          return positioned
        })
    setParts([...current, ...placed])
    setSelectedId(placed[placed.length - 1]!.id)
    setResult(null)
    setShowSourcePreview(true)
    if (!hadParts) resetHistory()
    setStatus(`Added ${compactLabel(placed.map((part) => part.name).join(', '), 64)}`)
  }

  async function addFiles(fileList: FileList | File[], intent: SourceDropIntent = 'models') {
    const files = Array.from(fileList)
    if (files.length === 0) return
    logDebug(
      '[companions] addFiles:',
      files.map((file) => `${file.name} path=${(file as File & { path?: string }).path ?? '(none)'}`),
    )

    const objFiles = files.filter((file) => detectFormat(file.name)?.id === 'obj')
    const mtlFiles = files.filter((file) => detectFormat(file.name)?.id === 'mtl')
    const miobjectFiles = files.filter((file) => detectFormat(file.name)?.id === 'miobject')
    const mimodelFiles = files.filter((file) => detectFormat(file.name)?.id === 'mimodel')
    const bbmodelFiles = files.filter((file) => detectFormat(file.name)?.id === 'bbmodel')
    const gltfFiles = files.filter((file) => detectFormat(file.name)?.id === 'gltf')
    const fbxFiles = files.filter((file) => detectFormat(file.name)?.id === 'fbx')
    const daeFiles = files.filter((file) => detectFormat(file.name)?.id === 'dae')
    const voxFiles = files.filter((file) => detectFormat(file.name)?.id === 'vox')
    const mayaFiles = files.filter((file) => detectFormat(file.name)?.id === 'maya')
    const hasMeshPrimary =
      objFiles.length > 0
      || miobjectFiles.length > 0
      || mimodelFiles.length > 0
      || bbmodelFiles.length > 0
      || gltfFiles.length > 0
      || fbxFiles.length > 0
      || daeFiles.length > 0
      || voxFiles.length > 0
      || mayaFiles.length > 0
    // PNG is a mesh texture when dropped with a model, a companion when a mesh
    // is already selected, and a player skin only when added as a skin.
    const skins = !hasMeshPrimary
      ? files.filter((file) => /\.png$/i.test(file.name))
      : []
    const textureFiles = hasMeshPrimary
      ? files.filter((file) => isTextureFileName(file.name))
      : files.filter((file) => isTextureFileName(file.name) && !/\.png$/i.test(file.name))

    if (
      companionDropShouldAttachToSelection({
        intent,
        hasMeshPrimary,
        fileNames: files.map((file) => file.name),
        selectedKind: selected?.kind === 'obj' || selected?.kind === 'skin' ? selected.kind : null,
        selectedName: selected?.name ?? selected?.fileName ?? null,
        selectedNeedsSkin: Boolean(
          selected?.kind === 'skin'
          && (selected.bytes.length === 0 || selected.miobjectBytes || selected.expectedTextureNames.length > 0),
        ),
      })
    ) {
      await attachCompanions(files)
      return
    }

    if (
      !hasMeshPrimary
      && skins.length === 0
      && (mtlFiles.length > 0 || textureFiles.length > 0)
    ) {
      if (selected?.kind === 'obj' || (selected?.kind === 'skin' && selected.expectedTextureNames.length > 0)) {
        await attachCompanions(files)
        return
      }
      setStatus('Add the .obj / .miobject first, then drop companions (.mtl, .mimodel, textures)')
      return
    }

    setLoadProgress({ ratio: 0, label: 'Starting upload…' })
    progressFloorRef.current = 0
    awaitPreviewOverlayRef.current = false
    let loadedAny = false
    try {
      const nextParts: ScenePartLocal[] = []
      const importWarnings: string[] = []
      const mtlByName = new Map<string, File>()
      for (const file of mtlFiles) mtlByName.set(basename(file.name).toLowerCase(), file)
      const mimodelByName = new Map<string, File>()
      for (const file of mimodelFiles) mimodelByName.set(basename(file.name).toLowerCase(), file)
      const texturesByName = new Map<string, File>()
      for (const file of textureFiles) {
        texturesByName.set(basename(file.name).toLowerCase(), file)
      }
      // When mesh + PNG in same drop, PNGs are textures for the mesh.
      if (hasMeshPrimary) {
        for (const file of files) {
          if (isTextureFileName(file.name)) {
            texturesByName.set(basename(file.name).toLowerCase(), file)
          }
        }
      }

      let done = 0
      const totalWork =
        objFiles.length
        + skins.length
        + miobjectFiles.length
        + mimodelFiles.length
        + bbmodelFiles.length
        + gltfFiles.length
        + fbxFiles.length
        + daeFiles.length
        + voxFiles.length
        + mayaFiles.length
        + mtlFiles.length
        + texturesByName.size

      const setImportProgress = (ratio: number, label: string) => {
        // Cap import at 0.74 so preview parse/clean can own the rest of the bar.
        const next = Math.max(progressFloorRef.current, Math.min(0.74, ratio))
        progressFloorRef.current = next
        setLoadProgress({ ratio: next, label })
      }

      const bump = async (file: File) => {
        const bytes = await readFileWithProgress(file, (ratio, label) => {
          setImportProgress((done + ratio) / Math.max(totalWork, 1), label)
        })
        done += 1
        return bytes
      }

      for (const file of objFiles) {
        const diskPath = fileSystemPath(file)
        let part: ScenePartLocal
        let deps: ReturnType<typeof scanObjDependencies>
        if (diskPath) {
          const size = await localFileSize(diskPath)
          if (size > OBJ_FULL_LOAD_MAX) {
            // Huge on-disk OBJ: keep path only so we don't OOM the WebView.
            setImportProgress(
              done / Math.max(totalWork, 1),
              `Indexing ${file.name}…`,
            )
            const head = await readLocalFileChunk(diskPath, 0, 512 * 1024)
            deps = scanObjDependencies(head)
            part = createObjPart(file.name, new Uint8Array(), { sourcePath: diskPath })
            part = {
              ...part,
              expectedMtlFileName: deps.mtlFileName,
              sourceLabel: `${file.name} · ${(size / (1024 * 1024)).toFixed(0)} MB on disk`,
            }
            done += 1
          } else {
            // Normal / large-but-workable: load for preview; keep path for convert.
            const bytes = await bump(file)
            deps = scanObjDependencies(bytes)
            part = createObjPart(file.name, bytes, { sourcePath: diskPath })
            part = {
              ...part,
              expectedMtlFileName: deps.mtlFileName,
            }
          }
        } else {
          const bytes = await bump(file)
          deps = scanObjDependencies(bytes)
          part = createObjPart(file.name, bytes)
          part = {
            ...part,
            expectedMtlFileName: deps.mtlFileName,
          }
          part = await preferDiskForLargeObj(part)
        }

        if (deps.mtlFileName) {
          const mtlFile = mtlByName.get(deps.mtlFileName.toLowerCase())
          let mtlBytes: Uint8Array | null = null
          let mtlName = deps.mtlFileName
          if (mtlFile) {
            mtlBytes = await bump(mtlFile)
            mtlName = mtlFile.name
          } else {
            // Same-folder .mtl next to a dialog/drop path (common for Blender exports).
            mtlBytes = await tryReadSiblingBytes(file, deps.mtlFileName)
          }
          if (mtlBytes && mtlBytes.length > 0) {
            const textureNames = scanMtlTextureRefs(mtlBytes)
            const textures: Record<string, Uint8Array> = {}
            for (const name of textureNames) {
              for (const alias of textureNamesToProbe(name)) {
                const key = alias.toLowerCase()
                if (textures[key] || textures[foldExportName(alias)]) continue
                const texFile = findEntryByExportName(texturesByName, alias)?.[1]
                if (texFile) {
                  textures[repairMojibake(basename(texFile.name)).normalize('NFC').toLowerCase()] = await bump(texFile)
                  continue
                }
                const fromDisk = await tryReadSiblingBytes(file, alias)
                if (fromDisk && fromDisk.length > 0) {
                  textures[repairMojibake(alias).normalize('NFC').toLowerCase()] = fromDisk
                }
              }
            }
            const prepared = await resolveTextureSiblings(textureNames, textures)
            const rewritten = rewriteMtlTextureRefs(
              mtlBytes,
              (name) => prepared.fileNameFor(name) ?? name,
            )
            part = {
              ...part,
              mtlBytes: rewritten,
              mtlFileName: mtlName,
              expectedTextureNames: scanMtlTextureRefs(rewritten),
              textures: prepared.files,
            }
          }
        }

        nextParts.push(part)
      }

      for (const file of miobjectFiles) {
        const bytes = await bump(file)
        const deps = scanMiobjectDependencies(bytes)
        // .miobject only stores basenames — load them from the same folder when present.
        const diskCompanions: Record<string, Uint8Array> = await tryReadMiobjectCompanions(file, [
          ...deps.textureFileNames,
          ...deps.modelFileNames,
        ])

        if (deps.kind === 'char') {
          let skinBytes = new Uint8Array()
          const skinName = deps.textureFileNames[0]
          if (skinName) {
            const skinFile = texturesByName.get(skinName.toLowerCase())
            if (skinFile) skinBytes = new Uint8Array(await bump(skinFile))
            else if (diskCompanions[skinName.toLowerCase()]) {
              skinBytes = new Uint8Array(diskCompanions[skinName.toLowerCase()])
              done += 1
            }
          }
          if (skinBytes.length === 0 && texturesByName.size >= 1) {
            const only = [...texturesByName.values()][0]
            skinBytes = new Uint8Array(await bump(only))
          }
          if (skinBytes.length === 0) {
            nextParts.push(
              createSkinPart(file.name, skinBytes, {
                slimArms: deps.slimArms,
                expectedTextureNames: deps.textureFileNames.length > 0
                  ? deps.textureFileNames
                  : ['skin.png'],
                sourceLabel: `${file.name} · ${deps.label} character (needs skin PNG)`,
                miobjectBytes: bytes,
              }),
            )
            continue
          }

          // Keep as skin so preview uses the real PNG texture; pose is baked at convert time.
          const pose = extractCharacterPose(bytes)
          const posedKeys = Object.keys(pose.parts).filter((key) => {
            const p = pose.parts[key]
            return (
              Math.abs(p.rot[0]) + Math.abs(p.rot[1]) + Math.abs(p.rot[2])
              + Math.abs(p.bend[0]) + Math.abs(p.bend[1]) + Math.abs(p.bend[2])
              > 0.05
            )
          })
          let slim =
            deps.slimArms
            || pose.slimArms
          let hdNote = ''
          let atlasScale = 1
          try {
            const inspected = await inspectPlayerSkin(skinBytes, skinName)
            slim = slim || inspected.slim
            atlasScale = inspected.atlas.scale
            const note = skinHdNote(inspected.atlas)
            if (note) hdNote = ` · ${note}`
          } catch {
            slim = slim || (await detectSlimSkinBytes(skinBytes, skinName))
          }
          nextParts.push(
            createSkinPart(file.name, skinBytes, {
              slimArms: slim,
              expectedTextureNames: deps.textureFileNames.length > 0
                ? deps.textureFileNames
                : [basename(file.name).replace(/\.miobject$/i, '.png')],
              sourceLabel: `${file.name} · ${deps.label}${
                posedKeys.length ? ` · posed ${posedKeys.join(', ')}` : ' · rest'
              }${hdNote}`,
              miobjectBytes: bytes,
              atlasScale,
            }),
          )
          continue
        }

        if (deps.kind === 'model') {
          const modelName = deps.modelFileNames[0]
          if (!modelName) {
            setStatus(`Mine-imator object ${file.name} has no .mimodel reference`)
            continue
          }
          let mimodelBytes: Uint8Array | null = null
          const modelFile = mimodelByName.get(modelName.toLowerCase())
          if (modelFile) {
            mimodelBytes = await bump(modelFile)
          } else if (diskCompanions[modelName.toLowerCase()]) {
            mimodelBytes = new Uint8Array(diskCompanions[modelName.toLowerCase()])
            done += 1
          }
          if (!mimodelBytes) {
            // Keep a placeholder so the user can attach the .mimodel next.
            const hasPath = Boolean((file as File & { path?: string }).path)
            if (!hasPath) {
              setStatus(
                `Needed ${modelName} next to ${file.name}, but the folder path wasn't available. Use Add models (keeps the path) or attach the .mimodel manually.`,
              )
            }
            let part = createObjPart(file.name.replace(/\.miobject$/i, '.obj'), new TextEncoder().encode('# pending mimodel\n'))
            part = {
              ...part,
              name: file.name,
              expectedMtlFileName: null,
              expectedTextureNames: [...deps.modelFileNames, ...deps.textureFileNames],
              sourceLabel: `${file.name} · needs ${modelName}`,
              miobjectBytes: bytes,
              attachedMimodelName: null,
              mimodelBytes: null,
            }
            nextParts.push(part)
            continue
          }

          const mimodelTex = mimodelTextureFileName(mimodelBytes)
          // Prefer the miobject skin resource (the skin you exported / want to use).
          // Mimodel `texture` (often alex.png) is only a Modelbench placeholder.
          const textureCandidates = [
            ...deps.textureFileNames,
            ...(mimodelTex ? [mimodelTex] : []),
          ]
          // Ensure candidates are on disk when present beside the .miobject.
          if (mimodelTex && !diskCompanions[mimodelTex.toLowerCase()]) {
            const extra = await tryReadSiblingBytes(file, mimodelTex)
            if (extra && extra.length > 0) {
              diskCompanions[mimodelTex.toLowerCase()] = extra
              done += 1
            }
          }
          let textureBytes: Uint8Array | null = null
          let textureName: string | null = null
          for (const candidate of textureCandidates) {
            const texFile = texturesByName.get(candidate.toLowerCase())
            if (texFile) {
              textureName = basename(candidate)
              textureBytes = await bump(texFile)
              break
            }
            if (diskCompanions[candidate.toLowerCase()]) {
              textureName = basename(candidate)
              textureBytes = new Uint8Array(diskCompanions[candidate.toLowerCase()])
              done += 1
              break
            }
          }
          if (!textureBytes) {
            const dropPng = [...texturesByName.entries()][0]
            if (dropPng) {
              textureName = dropPng[0]
              textureBytes = await bump(dropPng[1])
            } else {
              const diskPngs = Object.entries(diskCompanions)
                .filter(([name]) => isRasterTextureName(name))
                .sort((a, b) => b[1].length - a[1].length)
              if (diskPngs[0]) {
                textureName = diskPngs[0][0]
                textureBytes = new Uint8Array(diskPngs[0][1])
                done += 1
              }
            }
          }
          // Prefer the name the MTL will reference; keep miobject + mimodel names in the UI list.
          if (!textureName && textureCandidates[0]) textureName = basename(textureCandidates[0])

          const miPose = poseFromMiobject(bytes)
          const converted = await mimodelToObj(
            mimodelBytes,
            textureBytes,
            textureName,
            miPose,
          )
          let part = createObjPart(file.name.replace(/\.miobject$/i, '.obj'), converted.objBytes)
          // One active texture only — extras stay on disk for Change, not as companion rows.
          const textures: Record<string, Uint8Array> = {}
          if (textureName && textureBytes) {
            textures[textureName.toLowerCase()] = textureBytes
          }
          const expectedNames = [
            ...deps.modelFileNames,
            ...(textureName
              ? [textureName]
              : textureCandidates[0]
                ? [basename(textureCandidates[0])]
                : []),
          ]
          part = {
            ...part,
            name: file.name,
            mtlBytes: converted.mtlBytes,
            mtlFileName: 'model.mtl',
            expectedTextureNames: [...new Set(expectedNames)],
            textures,
            miobjectBytes: bytes,
            attachedMimodelName: modelName,
            mimodelBytes,
            skinPose: skinPoseFromMimodel(miPose),
            skinPoseEuler: 'mineimator',
            sourceLabel: textureBytes
              ? `${file.name} · ${converted.shapeCount} shapes · ${textureName}`
              : textureName
                ? `${file.name} · ${converted.shapeCount} shapes (needs ${textureName})`
                : `${file.name} · ${converted.shapeCount} shapes (needs texture)`,
          }
          part = await preferDiskForLargeObj(part)
          nextParts.push(part)
          continue
        }

        setStatus(`Unsupported Mine-imator object in ${file.name}`)
      }

      // Standalone .mimodel (no wrapping .miobject in this drop)
      if (miobjectFiles.length === 0) {
        for (const file of mimodelFiles) {
          const mimodelBytes = await bump(file)
          const mimodelTex = mimodelTextureFileName(mimodelBytes)
          let textureBytes: Uint8Array | null = null
          let textureName: string | null = mimodelTex
          if (textureName) {
            const texFile = texturesByName.get(textureName.toLowerCase())
            if (texFile) textureBytes = await bump(texFile)
          }
          if (!textureBytes && texturesByName.size >= 1) {
            const first = [...texturesByName.entries()][0]
            textureName = first[0]
            textureBytes = await bump(first[1])
          }
          const converted = await mimodelToObj(mimodelBytes, textureBytes, textureName)
          let part = createObjPart(file.name.replace(/\.mimodel$/i, '.obj'), converted.objBytes)
          const textures: Record<string, Uint8Array> = {}
          if (textureName && textureBytes) textures[textureName.toLowerCase()] = textureBytes
          part = {
            ...part,
            name: file.name,
            mtlBytes: converted.mtlBytes,
            mtlFileName: 'model.mtl',
            expectedTextureNames: [
              file.name,
              ...(textureName ? [textureName] : mimodelTex ? [mimodelTex] : []),
            ],
            textures,
            attachedMimodelName: file.name,
            mimodelBytes,
            sourceLabel: `${file.name} · ${converted.shapeCount} shapes`,
          }
          part = await preferDiskForLargeObj(part)
          nextParts.push(part)
        }
      }

      for (const file of bbmodelFiles) {
        const bbBytes = await bump(file)
        const sidecar: Record<string, Uint8Array> = {}
        for (const [name, texFile] of texturesByName) {
          sidecar[name] = await bump(texFile)
        }
        const imported = importBbmodel(bbBytes, sidecar)
        if (imported.kind === 'skin') {
          try {
            const inspected = await inspectPlayerSkin(
              imported.textureBytes,
              imported.textureFileName,
            )
            const hd = skinHdNote(inspected.atlas)
            nextParts.push(
              createSkinPart(file.name.replace(/\.bbmodel$/i, '.png'), imported.textureBytes, {
                slimArms: imported.slimArms || inspected.slim,
                sourceLabel: `${file.name} · ${imported.sourceLabel}${hd ? ` · ${hd}` : ''}`,
                skinPose: {
                  root: imported.pose.root,
                  parts: imported.pose.parts,
                },
                skinPoseEuler: 'blockbench',
                atlasScale: inspected.atlas.scale,
              }),
            )
          } catch (error) {
            importWarnings.push(error instanceof Error ? error.message : String(error))
          }
        } else {
          let part = createObjPart(file.name.replace(/\.bbmodel$/i, '.obj'), imported.objBytes)
          const textures: Record<string, Uint8Array> = {}
          if (imported.textureFileName && imported.textureBytes) {
            textures[imported.textureFileName.toLowerCase()] = imported.textureBytes
          }
          part = {
            ...part,
            name: file.name,
            mtlBytes: imported.mtlBytes,
            mtlFileName: 'model.mtl',
            expectedTextureNames:
              imported.textureFileName && !imported.textureBytes
                ? [imported.textureFileName]
                : [],
            textures,
            sourceLabel: `${file.name} · ${imported.sourceLabel}`,
          }
          part = await preferDiskForLargeObj(part)
          nextParts.push(part)
        }
      }

      for (const file of gltfFiles) {
        const gltfBytes = await bump(file)
        const already: Record<string, Uint8Array> = {}
        for (const [name, texFile] of texturesByName) {
          already[name] = await bump(texFile)
        }
        const { autoLoadGltfSiblings, importGltf } = await import('./formats/gltf')
        const siblings = await autoLoadGltfSiblings(file, gltfBytes, {
          already,
          droppedFiles: files,
          readDropped: bump,
        })
        setImportProgress(done / Math.max(totalWork, 1), `Parsing ${file.name}…`)
        const imported = await importGltf(gltfBytes, {
          fileName: file.name,
          siblings,
          onProgress: (label) => {
            setImportProgress(done / Math.max(totalWork, 1), `${file.name}: ${label}`)
          },
        })
        for (const warning of imported.warnings) {
          logDebug(`[gltf] ${file.name}: ${warning}`)
        }
        let part = createObjPart(file.name.replace(/\.(gltf|glb)$/i, '.obj'), imported.objBytes)
        part = {
          ...part,
          name: file.name,
          mtlBytes: imported.mtlBytes,
          mtlFileName: 'model.mtl',
          textures: imported.textures,
          sourceLabel: `${file.name} · ${imported.sourceLabel}`,
        }
        part = await preferDiskForLargeObj(part)
        nextParts.push(part)
      }

      for (const file of fbxFiles) {
        const fbxBytes = await bump(file)
        const { autoLoadFbxSiblings, importFbx } = await import('./formats/fbx')
        const { siblings } = await autoLoadFbxSiblings(file, fbxBytes, {
          droppedFiles: files,
          readDropped: bump,
        })
        setImportProgress(done / Math.max(totalWork, 1), `Parsing ${file.name}…`)
        const imported = await importFbx(fbxBytes, {
          fileName: file.name,
          siblings,
          sourceFile: file,
          onProgress: (label) => {
            setImportProgress(done / Math.max(totalWork, 1), `${file.name}: ${label}`)
          },
        })
        for (const warning of imported.warnings) {
          logDebug(`[fbx] ${file.name}: ${warning}`)
        }
        let part = createObjPart(file.name.replace(/\.fbx$/i, '.obj'), imported.objBytes)
        part = {
          ...part,
          name: file.name,
          mtlBytes: imported.mtlBytes,
          mtlFileName: 'model.mtl',
          textures: imported.textures,
          expectedTextureNames: imported.expectedTextureNames,
          sourceLabel: `${file.name} · ${imported.sourceLabel}`,
          fbxBytes,
          fbxMaterialTextures: imported.materialTextures ?? null,
          nativeMeshRig: imported.nativeSkin?.rig ?? null,
          nativeMeshWeights: imported.nativeSkin?.skin ?? null,
          meshRigMode: imported.nativeSkin ? 'native' : 'auto',
        }
        part = await preferDiskForLargeObj(part)
        nextParts.push(part)
      }

      for (const file of daeFiles) {
        const daeBytes = await bump(file)
        const already: Record<string, Uint8Array> = {}
        for (const [name, texFile] of texturesByName) {
          already[name] = await bump(texFile)
        }
        const { autoLoadDaeSiblings, importDae } = await import('./formats/dae')
        const siblings = await autoLoadDaeSiblings(file, daeBytes, {
          already,
          droppedFiles: files,
          readDropped: bump,
        })
        setImportProgress(done / Math.max(totalWork, 1), `Parsing ${file.name}…`)
        const imported = await importDae(daeBytes, {
          fileName: file.name,
          siblings,
          onProgress: (label) => {
            setImportProgress(done / Math.max(totalWork, 1), `${file.name}: ${label}`)
          },
        })
        for (const warning of imported.warnings) {
          logDebug(`[dae] ${file.name}: ${warning}`)
        }
        let part = createObjPart(file.name.replace(/\.dae$/i, '.obj'), imported.objBytes)
        part = {
          ...part,
          name: file.name,
          mtlBytes: imported.mtlBytes,
          mtlFileName: 'model.mtl',
          textures: imported.textures,
          expectedTextureNames: imported.expectedTextureNames,
          sourceLabel: `${file.name} · ${imported.sourceLabel}`,
          daeBytes,
          nativeMeshRig: imported.nativeSkin?.rig ?? null,
          nativeMeshWeights: imported.nativeSkin?.skin ?? null,
          meshRigMode: imported.nativeSkin ? 'native' : 'auto',
        }
        part = await preferDiskForLargeObj(part)
        nextParts.push(part)
      }

      for (const file of voxFiles) {
        const voxBytes = await bump(file)
        const fileBase = (done - 1) / Math.max(totalWork, 1)
        const fileSpan = 1 / Math.max(totalWork, 1)
        setImportProgress(fileBase + fileSpan * 0.15, `Parsing ${file.name}…`)
        const imported = await importVox(voxBytes, (ratio, label) => {
          setImportProgress(fileBase + fileSpan * (0.15 + ratio * 0.8), label)
        })
        for (const warning of imported.warnings) {
          logDebug(`[vox] ${file.name}: ${warning}`)
        }
        let part = createObjPart(file.name.replace(/\.vox$/i, '.obj'), imported.objBytes)
        part = {
          ...part,
          name: file.name,
          mtlBytes: imported.mtlBytes,
          mtlFileName: 'model.mtl',
          width: imported.size.width,
          height: imported.size.height,
          length: imported.size.length,
          fit: 'stretch',
          objSizePreset: 'custom',
          sourceLabel: `${file.name} · ${imported.sourceLabel}`,
          voxBytes,
        }
        part = await preferDiskForLargeObj(part)
        nextParts.push(part)
      }

      for (const file of mayaFiles) {
        const mayaBytes = await bump(file)
        const already: Record<string, Uint8Array> = {}
        for (const [name, texFile] of texturesByName) {
          already[name] = await bump(texFile)
        }
        const siblings = await autoLoadMayaSiblings(file, mayaBytes, {
          already,
          droppedFiles: files,
          readDropped: bump,
        })
        setImportProgress(done / Math.max(totalWork, 1), `Parsing ${file.name}…`)
        const imported = await importMaya(mayaBytes, {
          fileName: file.name,
          siblings,
          onProgress: (label) => {
            setImportProgress(done / Math.max(totalWork, 1), `${file.name}: ${label}`)
          },
        })
        for (const warning of imported.warnings) {
          logDebug(`[maya] ${file.name}: ${warning}`)
        }
        const expectedTex =
          imported.expectedTextureNames.length > 0
            ? imported.expectedTextureNames
            : Object.keys(imported.textures)
        let part = createObjPart(file.name.replace(/\.(mb|ma)$/i, '.obj'), imported.objBytes)
        part = {
          ...part,
          name: file.name,
          mtlBytes: imported.mtlBytes,
          mtlFileName: 'model.mtl',
          textures: imported.textures,
          expectedTextureNames: expectedTex,
          mayaBytes,
          sourceLabel: `${file.name} · ${imported.sourceLabel}`,
          nativeMeshRig: imported.nativeSkin?.rig ?? null,
          nativeMeshWeights: imported.nativeSkin?.skin ?? null,
          meshRigMode: imported.nativeSkin ? 'native' : 'auto',
        }
        part = await preferDiskForLargeObj(part)
        // Replace a previous import of the same Maya scene instead of stacking duplicates.
        const prior = nextParts.findIndex(
          (p) => p.name.toLowerCase() === file.name.toLowerCase() || Boolean(p.mayaBytes && p.name === file.name),
        )
        if (prior >= 0) nextParts[prior] = part
        else nextParts.push(part)
      }

      for (const file of skins) {
        const bytes = await bump(file)
        try {
          const { atlas, slim } = await inspectPlayerSkin(bytes, file.name)
          const hd = skinHdNote(atlas)
          nextParts.push(
            createSkinPart(file.name, bytes, {
              slimArms: slim,
              skinLimbs: slim ? 'slim' : 'classic',
              sourceLabel: hd ? `${hd} HD skin` : null,
              atlasScale: atlas.scale,
            }),
          )
        } catch (error) {
          importWarnings.push(error instanceof Error ? error.message : String(error))
        }
      }

      if (nextParts.length === 0) {
        setStatus(
          importWarnings.length > 0
            ? importWarnings.join(' · ')
            : `No supported files found (${supportedFormatsHint()})`,
        )
        return
      }

      loadedAny = true
      const hadParts = parts.length > 0
      if (hadParts) recordBeforeChange()
      let nextX = 0
      if (parts.length > 0) {
        nextX = Math.max(...parts.map((part) => part.positionX + part.width)) + 8
      }
      const replacedIds = new Set<string>()
      const placed: ScenePartLocal[] = []
      for (const part of nextParts) {
        const existing = parts.find(
          (p) =>
            Boolean(p.mayaBytes)
            && (p.name.toLowerCase() === part.name.toLowerCase()
              || p.fileName.toLowerCase() === part.fileName.toLowerCase()),
        )
        if (existing) {
          replacedIds.add(existing.id)
          placed.push({
            ...part,
            id: existing.id,
            positionX: existing.positionX,
            positionY: existing.positionY,
            positionZ: existing.positionZ,
            rotationX: existing.rotationX,
            rotationY: existing.rotationY,
            rotationZ: existing.rotationZ,
          })
        } else {
          placed.push({
            ...part,
            positionX: part.positionX + nextX,
          })
          nextX += part.width + 8
        }
      }
      setParts((current) => [...current.filter((p) => !replacedIds.has(p.id)), ...placed])
      setSelectedId(placed[placed.length - 1]?.id ?? null)
      setResult(null)
      setShowSourcePreview(true)
      if (!hadParts) resetHistory()
      const missingMtl = nextParts
        .filter((part) => part.kind === 'obj' && part.expectedMtlFileName && !part.mtlBytes)
        .map((part) => part.expectedMtlFileName!)
      const missingSkin = nextParts
        .filter((part) => part.kind === 'skin' && part.bytes.length === 0)
        .map((part) => part.expectedTextureNames[0] ?? 'skin.png')
      const missingModel = nextParts
        .filter((part) => part.sourceLabel?.includes('needs '))
        .map((part) => {
          const match = part.sourceLabel?.match(/needs ([^)]+)/i)
          return match?.[1] ?? 'companion file'
        })
      const missingTexture = nextParts
        .filter((part) => {
          if (part.kind !== 'obj') return false
          if (Object.keys(part.textures).length > 0) return false
          if (part.mayaBytes || part.fbxBytes || part.daeBytes) {
            return part.expectedTextureNames.some((name) => isRasterTextureName(name))
          }
          if (!part.mimodelBytes) return false
          return part.expectedTextureNames.some((name) => isRasterTextureName(name))
            || Boolean(part.sourceLabel?.includes('needs '))
        })
        .map((part) =>
          part.expectedTextureNames.find((name) => isRasterTextureName(name))
          ?? 'texture.png',
        )
      const missing = [
        ...missingMtl,
        ...missingSkin,
        ...missingModel,
        ...missingTexture,
      ].filter(Boolean)
      // Never auto-advance — stay on Sources so the user can attach missing
      // companions, then click Continue when ready.
      setStep('sources')
      if (missing.length > 0) {
        setStatus(`Needs ${[...new Set(missing)].join(', ')} — attach them, then Continue`)
      } else {
        const skipped = importWarnings.length > 0 ? ` · skipped: ${importWarnings.join('; ')}` : ''
        setStatus(
          `Loaded ${nextParts.length} source${nextParts.length === 1 ? '' : 's'} · Continue to Build when ready${skipped}`,
        )
      }
    } catch (error) {
      logDebug('[addFiles] failed:', error)
      setStatus(statusFromError('Could not open files', error, { operation: 'add files' }))
      loadedAny = false
    } finally {
      if (loadedAny) {
        // Keep the overlay up — MeshPreviewViewer parse/clean fills 75%→100%.
        awaitPreviewOverlayRef.current = true
        const next = Math.max(progressFloorRef.current, 0.75)
        progressFloorRef.current = next
        setLoadProgress({ ratio: next, label: 'Preparing preview…' })
      } else {
        awaitPreviewOverlayRef.current = false
        progressFloorRef.current = 0
        setLoadProgress(null)
      }
    }
  }

  async function attachCompanions(fileList: FileList | File[]) {
    if (!selected) return
    const files = Array.from(fileList)
    setLoadProgress({ ratio: 0, label: 'Attaching companions…' })
    try {
      if (selected.kind === 'skin') {
        const png = files.find((file) => isTextureFileName(file.name))
        if (!png) {
          setStatus('Drop the skin .png for this Mine-imator character')
          return
        }
        const skinBytes = new Uint8Array(
          await readFileWithProgress(png, (ratio, label) => {
            setLoadProgress({ ratio: ratio * 0.5, label })
          }),
        )
        let atlasNote = ''
        let slim = selected.slimArms
        let atlasScale = 1
        try {
          const inspected = await inspectPlayerSkin(skinBytes, png.name)
          slim = inspected.slim
          atlasScale = inspected.atlas.scale
          const hd = skinHdNote(inspected.atlas)
          if (hd) atlasNote = hd
        } catch (error) {
          setStatus(statusFromError('Could not read that skin', error, { operation: 'inspect player skin' }))
          return
        }
        const skinName = basename(png.name)
        const expected = selected.expectedTextureNames.length > 0
          ? selected.expectedTextureNames
          : [skinName]
        const native = slim ? nativeSlimSkinSize : nativeSkinSize
        const sizeMul = skinAtlasSizeMultiplier(atlasScale, slim)

        recordBeforeChange()
        setParts((current) =>
          current.map((part) =>
            part.id === selected.id
              ? {
                  ...part,
                  bytes: skinBytes,
                  fileName: png.name,
                  slimArms: slim,
                  skinLimbs: slim ? 'slim' : 'classic',
                  expectedTextureNames: expected.some((n) => n.toLowerCase() === skinName.toLowerCase())
                    ? expected
                    : [...expected, skinName],
                  sourceLabel: part.miobjectBytes
                    ? `${part.name} · skin attached${atlasNote ? ` · ${atlasNote}` : ''}`
                    : atlasNote
                      ? `${atlasNote} HD skin`
                      : part.sourceLabel,
                  ...(part.width === native.width
                    && part.height === native.height
                    && part.length === native.length
                    && sizeMul > 1
                    ? {
                        width: native.width * sizeMul,
                        height: native.height * sizeMul,
                        length: native.length * sizeMul,
                      }
                    : {}),
                }
              : part,
          ),
        )
        setResult(null)
        setStatus(
          `Attached skin ${png.name}${atlasNote ? ` (${atlasNote})` : ''} — continue to Build when ready`,
        )
        return
      }

      if (selected.kind !== 'obj') return

      const mimodelFile = files.find((file) => isMimodelFileName(file.name))
      const needsMimodel = Boolean(
        selected.sourceLabel?.includes('needs ')
        || selected.expectedTextureNames.some((name) => isMimodelFileName(name))
        || selected.miobjectBytes,
      )
      if (mimodelFile && needsMimodel) {
        const mimodelBytes = await readFileWithProgress(mimodelFile, (ratio, label) => {
          setLoadProgress({ ratio: ratio * 0.6, label })
        })
        const texFile = files.find((file) => isTextureFileName(file.name))
        let textureBytes: Uint8Array | null = null
        let textureName: string | null = null
        if (texFile) {
          textureName = basename(texFile.name)
          textureBytes = await readFileWithProgress(texFile, (ratio, label) => {
            setLoadProgress({ ratio: 0.6 + ratio * 0.3, label })
          })
        } else {
          const existingTex = Object.entries(selected.textures)[0]
          if (existingTex) {
            textureName = existingTex[0]
            textureBytes = existingTex[1]
          }
        }
        setLoadProgress({ ratio: 0.95, label: 'Building mesh from .mimodel…' })
        const converted = await mimodelToObj(
          mimodelBytes,
          textureBytes,
          textureName,
          poseFromMiobject(selected.miobjectBytes),
        )
        const textures: Record<string, Uint8Array> = {}
        if (textureName && textureBytes) textures[textureName.toLowerCase()] = textureBytes
        const modelName = basename(mimodelFile.name)
        const expected = [
          modelName,
          ...(textureName ? [textureName] : []),
        ]
        recordBeforeChange()
        setParts((current) =>
          current.map((part) =>
            part.id === selected.id
              ? {
                  ...part,
                  bytes: converted.objBytes,
                  mtlBytes: converted.mtlBytes,
                  mtlFileName: 'model.mtl',
                  expectedTextureNames: expected,
                  textures,
                  attachedMimodelName: modelName,
                  mimodelBytes,
                  sourceLabel: textureBytes
                    ? `${part.name} · ${converted.shapeCount} shapes · ${textureName}`
                    : `${part.name} · ${converted.shapeCount} shapes`,
                }
              : part,
          ),
        )
        setResult(null)
        setStatus(`Built mesh from ${mimodelFile.name}`)
        return
      }

      let mtlBytes = selected.mtlBytes ?? null
      let mtlFileName = selected.mtlFileName ?? null
      let expectedTextureNames = [...selected.expectedTextureNames]
      let textures = { ...selected.textures }
      let done = 0

      for (const file of files) {
        if (!/\.mtl$/i.test(file.name) && !isTextureFileName(file.name) && !isMimodelFileName(file.name)) {
          continue
        }
        if (isTextureFileName(file.name)) {
          const name = basename(file.name)
          const expectedRaster = expectedTextureNames.filter((item) => isRasterTextureName(item))
          if (
            expectedRaster.length > 0
            && files.filter((item) => isTextureFileName(item.name)).length > expectedRaster.length
            && !isWantedTextureOnDisk(name, expectedRaster)
          ) {
            continue
          }
        }
        const bytes = await readFileWithProgress(file, (ratio, label) => {
          setLoadProgress({
            ratio: (done + ratio) / Math.max(files.length, 1),
            label,
          })
        })
        done += 1
        if (/\.mtl$/i.test(file.name)) {
          mtlBytes = bytes
          mtlFileName = file.name
          for (const name of scanMtlTextureRefs(bytes)) {
            if (!expectedTextureNames.some((n) => exportNamesMatch(n, name))) {
              expectedTextureNames.push(name)
            }
          }
        } else if (isTextureFileName(file.name)) {
          const name = repairMojibake(basename(file.name)).normalize('NFC')
          // Mimodel / Mine-imator parts use a single active texture — replace, don't stack.
          if (selected.mimodelBytes && selected.mimodelBytes.length > 0) {
            textures = { [name.toLowerCase()]: bytes }
            expectedTextureNames = [
              ...expectedTextureNames.filter((n) => isMimodelFileName(n)),
              name,
            ]
          } else {
            for (const key of Object.keys(textures)) {
              if (exportNamesMatch(key, name)) delete textures[key]
            }
            textures[name.toLowerCase()] = bytes
            expectedTextureNames = expectedTextureNames.map((item) => (
              exportNamesMatch(item, name) ? name : item
            ))
            if (!expectedTextureNames.some((n) => exportNamesMatch(n, name))) {
              expectedTextureNames.push(name)
            }
            if (mtlBytes) {
              mtlBytes = rewriteMtlTextureRefs(mtlBytes, (ref) => (exportNamesMatch(ref, name) ? name : ref))
            }
          }
        }
      }

      if (selected.mimodelBytes && selected.mimodelBytes.length > 0) {
        // Active texture = the one just attached, else whatever remains.
        const texEntry = Object.entries(textures)[0]
        const textureName = texEntry?.[0] ?? null
        const textureBytes = texEntry?.[1] ?? null
        const converted = await mimodelToObj(
          selected.mimodelBytes,
          textureBytes,
          textureName,
          poseFromMiobject(selected.miobjectBytes),
        )
        // Keep textures dict to the single map_Kd name used by the MTL.
        const activeTextures: Record<string, Uint8Array> = {}
        if (textureName && textureBytes) {
          activeTextures[textureName.toLowerCase()] = textureBytes
        }
        const nextExpected = [
          ...expectedTextureNames.filter((n) => isMimodelFileName(n)),
          ...(textureName
            ? [textureName]
            : expectedTextureNames.filter((n) => isRasterTextureName(n)).slice(0, 1)),
        ]
        const decoded = textureBytes ? await decodeTextureRgba(textureBytes) : null
        recordBeforeChange()
        setParts((current) =>
          current.map((part) =>
            part.id === selected.id
              ? {
                  ...part,
                  bytes: converted.objBytes,
                  mtlBytes: converted.mtlBytes,
                  mtlFileName: 'model.mtl',
                  textures: activeTextures,
                  expectedTextureNames: [...new Set(nextExpected)],
                  sourceLabel: textureBytes
                    ? `${part.name} · ${converted.shapeCount} shapes · ${textureName}`
                    : `${part.name} · ${converted.shapeCount} shapes (needs texture)`,
                }
              : part,
          ),
        )
        setResult(null)
        setStatus(
          textureBytes
            ? decoded
              ? `Texture ${textureName} applied (${decoded.width}×${decoded.height})`
              : `Attached ${textureName}, but it could not be decoded — try another PNG`
            : `Updated companions for ${selected.name}`,
        )
        return
      } else {
        const expectedMtl =
          selected.expectedMtlFileName
          ?? (
            selected.bytes.length > 0
              ? scanObjDependencies(selected.bytes).mtlFileName
              : selected.sourcePath
                ? scanObjDependencies(await readLocalFileChunk(selected.sourcePath, 0, 512 * 1024)).mtlFileName
                : null
          )

        // COLLADA: re-run the source loader so late sidecars update materials
        // without losing the embedded native skeleton and skin weights.
        if (selected.daeBytes?.length && Object.keys(textures).length > 0) {
          setLoadProgress({ ratio: 0.85, label: 'Rebuilding COLLADA mesh with textures…' })
          const { importDae } = await import('./formats/dae')
          const imported = await importDae(selected.daeBytes, {
            fileName: selected.name,
            siblings: textures,
            onProgress: (label) => setLoadProgress({ ratio: 0.9, label }),
          })
          recordBeforeChange()
          setParts((current) =>
            current.map((part) =>
              part.id === selected.id
                ? {
                    ...part,
                    bytes: imported.objBytes,
                    mtlBytes: imported.mtlBytes,
                    mtlFileName: 'model.mtl',
                    textures: imported.textures,
                    expectedMtlFileName: 'model.mtl',
                    expectedTextureNames: imported.expectedTextureNames,
                    sourceLabel: `${part.name} · ${imported.sourceLabel}`,
                    nativeMeshRig: imported.nativeSkin?.rig ?? null,
                    nativeMeshWeights: imported.nativeSkin?.skin ?? null,
                    meshRigMode: imported.nativeSkin ? rigModeOf(part) : 'auto',
                  }
                : part,
            ),
          )
          setResult(null)
          setStatus(`Attached textures for ${selected.name}`)
          return
        }

        // FBX: re-run the source loader so late sidecars update materials
        // without losing the embedded native skeleton and skin weights.
        if (selected.fbxBytes?.length && Object.keys(textures).length > 0) {
          setLoadProgress({ ratio: 0.85, label: 'Rebuilding FBX mesh with textures…' })
          const { importFbx } = await import('./formats/fbx')
          const imported = await importFbx(selected.fbxBytes, {
            fileName: selected.name,
            siblings: textures,
            materialTextures: selected.fbxMaterialTextures ?? undefined,
            onProgress: (label) => setLoadProgress({ ratio: 0.9, label }),
          })
          recordBeforeChange()
          setParts((current) =>
            current.map((part) =>
              part.id === selected.id
                ? {
                    ...part,
                    bytes: imported.objBytes,
                    mtlBytes: imported.mtlBytes,
                    mtlFileName: 'model.mtl',
                    textures: imported.textures,
                    expectedMtlFileName: 'model.mtl',
                    expectedTextureNames: imported.expectedTextureNames,
                    sourceLabel: `${part.name} · ${imported.sourceLabel}`,
                    nativeMeshRig: imported.nativeSkin?.rig ?? null,
                    nativeMeshWeights: imported.nativeSkin?.skin ?? null,
                    meshRigMode: imported.nativeSkin ? rigModeOf(part) : 'auto',
                  }
                : part,
            ),
          )
          setResult(null)
          setStatus(`Attached textures for ${selected.name}`)
          return
        }

        // Maya: re-run import so newly attached textures land in the OBJ/MTL package.
        if (selected.mayaBytes && selected.mayaBytes.length > 0 && Object.keys(textures).length > 0) {
          setLoadProgress({ ratio: 0.85, label: 'Rebuilding Maya mesh with textures…' })
          const siblings: Record<string, Uint8Array> = {}
          for (const [name, bytes] of Object.entries(textures)) {
            siblings[name] = bytes
            siblings[name.toLowerCase()] = bytes
          }
          const imported = await importMaya(selected.mayaBytes, {
            fileName: selected.name,
            siblings,
            onProgress: (label) => setLoadProgress({ ratio: 0.9, label }),
          })
          const expectedTex =
            imported.expectedTextureNames.length > 0
              ? imported.expectedTextureNames
              : Object.keys(imported.textures)
          recordBeforeChange()
          setParts((current) =>
            current.map((part) =>
              part.id === selected.id
                ? {
                    ...part,
                    bytes: imported.objBytes,
                    mtlBytes: imported.mtlBytes,
                    mtlFileName: 'model.mtl',
                    textures: imported.textures,
                    expectedMtlFileName: 'model.mtl',
                    expectedTextureNames: [...new Set([...expectedTextureNames, ...expectedTex])],
                    sourceLabel: `${part.name} · ${imported.sourceLabel}`,
                    mayaBytes: part.mayaBytes,
                    nativeMeshRig: imported.nativeSkin?.rig ?? null,
                    nativeMeshWeights: imported.nativeSkin?.skin ?? null,
                    meshRigMode: imported.nativeSkin ? rigModeOf(part) : 'auto',
                  }
                : part,
            ),
          )
          setResult(null)
          setStatus(`Attached textures for ${selected.name}`)
          return
        }

        recordBeforeChange()
        const preparedTextures = await resolveTextureSiblings(expectedTextureNames, textures)
        setParts((current) =>
          current.map((part) =>
            part.id === selected.id
              ? {
                  ...part,
                  mtlBytes,
                  mtlFileName,
                  textures: preparedTextures.files,
                  expectedMtlFileName: expectedMtl,
                  expectedTextureNames,
                }
              : part,
          ),
        )
      }
      setResult(null)
      setStatus(
        mtlBytes
          ? `Attached materials for ${selected.name}`
          : 'Drop the .mtl file to apply colours',
      )
    } finally {
      setLoadProgress(null)
    }
  }

  async function pickSingleCompanion(
    extensions: string[],
    title: string,
  ): Promise<File | null> {
    try {
      const selectedPath = await openFileDialog({
        multiple: false,
        title,
        filters: [{ name: title, extensions }],
      })
      if (!selectedPath || Array.isArray(selectedPath)) return null
      const bytes = await readLocalFileBytes(selectedPath)
      return fileWithPath(bytes, basename(selectedPath), selectedPath)
    } catch (error) {
      logDebug('[companions] pick failed:', error)
      setStatus(statusFromError('Could not open file', error, { operation: 'attach companion' }))
      return null
    }
  }

  async function changeCompanion(kind: 'mtl' | 'mimodel' | 'texture' | 'skin', name?: string) {
    if (!selected) return
    if (kind === 'skin') {
      const file = await pickSingleCompanion(['png'], 'Choose skin PNG')
      if (file) await attachCompanions([file])
      return
    }
    if (kind === 'mtl') {
      const file = await pickSingleCompanion(['mtl'], 'Choose .mtl')
      if (file) await attachCompanions([file])
      return
    }
    if (kind === 'mimodel') {
      const file = await pickSingleCompanion(['mimodel'], 'Choose .mimodel')
      if (file) await attachCompanions([file])
      return
    }
    const file = await pickSingleCompanion(
      ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga', 'tif', 'tiff'],
      name ? `Replace ${name}` : 'Choose texture',
    )
    if (!file) return
    // Use the chosen file's real name — don't force the old basename.
    await attachCompanions([file])
  }

  function removeCompanion(kind: 'mtl' | 'mimodel' | 'texture' | 'skin', name?: string) {
    if (!selected) return
    if (kind === 'texture' && !name) return
    recordBeforeChange()
    if (kind === 'skin') {
      setParts((current) =>
        current.map((part) =>
          part.id === selected.id
            ? {
                ...part,
                bytes: new Uint8Array(),
                sourceLabel: part.miobjectBytes
                  ? `${part.name} · character (needs skin PNG)`
                  : part.sourceLabel,
              }
            : part,
        ),
      )
      setResult(null)
      setStatus('Skin removed — attach a PNG before Build')
      return
    }
    if (kind === 'mtl') {
      setParts((current) =>
        current.map((part) =>
          part.id === selected.id
            ? { ...part, mtlBytes: null, mtlFileName: null }
            : part,
        ),
      )
      setResult(null)
      setStatus('Removed .mtl')
      return
    }
    if (kind === 'mimodel') {
      const modelName =
        selected.attachedMimodelName
        ?? selected.expectedTextureNames.find((n) => isMimodelFileName(n))
        ?? 'model.mimodel'
      setParts((current) =>
        current.map((part) =>
          part.id === selected.id
            ? {
                ...part,
                bytes: new TextEncoder().encode('# pending mimodel\n'),
                mtlBytes: null,
                mtlFileName: null,
                attachedMimodelName: null,
                mimodelBytes: null,
                textures: {},
                expectedTextureNames: [
                  modelName,
                  ...part.expectedTextureNames.filter((n) => isRasterTextureName(n)).slice(0, 1),
                ],
                sourceLabel: `${part.name} · needs ${modelName}`,
              }
            : part,
        ),
      )
      setResult(null)
      setStatus(`Removed ${modelName} — attach a .mimodel again`)
      return
    }
    if (!name) return
    const key = name.toLowerCase()
    const remaining = { ...selected.textures }
    delete remaining[key]
    const neededName =
      Object.keys(remaining)[0]
      ?? selected.expectedTextureNames.find((n) => isRasterTextureName(n) && n.toLowerCase() !== key)
      ?? mimodelTextureFileName(selected.mimodelBytes ?? new Uint8Array())
      ?? 'texture.png'
    const nextExpected = [
      ...selected.expectedTextureNames.filter((n) => isMimodelFileName(n)),
      ...(Object.keys(remaining).length > 0
        ? Object.keys(remaining)
        : neededName
          ? [neededName]
          : []),
    ]
    setResult(null)
    setStatus(Object.keys(remaining).length > 0 ? `Removed ${name}` : `Removed ${name} — attach a texture when ready`)

    if (selected.mimodelBytes && selected.mimodelBytes.length > 0) {
      void (async () => {
        const texEntry = Object.entries(remaining)[0]
        const converted = await mimodelToObj(
          selected.mimodelBytes!,
          texEntry?.[1] ?? null,
          texEntry?.[0] ?? null,
          poseFromMiobject(selected.miobjectBytes),
        )
        setParts((current) =>
          current.map((part) =>
            part.id === selected.id
              ? {
                  ...part,
                  bytes: converted.objBytes,
                  mtlBytes: converted.mtlBytes,
                  mtlFileName: 'model.mtl',
                  textures: remaining,
                  expectedTextureNames: [...new Set(nextExpected)],
                  sourceLabel: texEntry
                    ? `${part.name} · ${converted.shapeCount} shapes · ${texEntry[0]}`
                    : `${part.name} · ${converted.shapeCount} shapes (needs ${neededName})`,
                }
              : part,
          ),
        )
      })()
      return
    }

    setParts((current) =>
      current.map((part) => {
        if (part.id !== selected.id) return part
        return {
          ...part,
          textures: remaining,
          expectedTextureNames: [...new Set(nextExpected)],
        }
      }),
    )
  }

  function applyCapeToSelected(cape: CapeSelection) {
    if (!selected || selected.kind !== 'skin') return
    recordBeforeChange()
    const pose = ensureSkinPose(selected)
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id
          ? {
              ...part,
              capeBytes: cape.bytes,
              capeFileName: cape.fileName,
              capeId: cape.capeId,
              skinPose: {
                ...pose,
                parts: {
                  ...pose.parts,
                  cape: pose.parts.cape ?? emptyPartPose(),
                },
              },
            }
          : part,
      ),
    )
    setResult(null)
    setSelectedLimb('cape')
    const official = cape.capeId !== 'custom' ? officialCapeById(cape.capeId) : null
    setStatus(official ? `${official.name} cape attached` : `Cape ${cape.fileName} attached`)
  }

  function removeCapeFromSelected() {
    if (!selected || selected.kind !== 'skin') return
    if (!selected.capeBytes && !selected.capeId) return
    recordBeforeChange()
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id
          ? { ...part, capeBytes: null, capeFileName: null, capeId: null }
          : part,
      ),
    )
    if (skinPoseLimbBase(selectedLimb) === 'cape') setSelectedLimb('body')
    setResult(null)
    setStatus('Cape removed')
  }

  function updateSelected<K extends keyof ScenePartLocal>(key: K, value: ScenePartLocal[K]) {
    if (!selected) return
    const coalesce =
      key === 'skinPose'
        ? 'pose'
        : key === 'width'
          || key === 'height'
          || key === 'length'
          || key === 'positionX'
          || key === 'positionY'
          || key === 'positionZ'
          || key === 'rotationX'
          || key === 'rotationY'
          || key === 'rotationZ'
          ? 'part-edit'
          : undefined
    recordBeforeChange(coalesce)
    setParts((current) =>
      current.map((part) => (part.id === selected.id ? { ...part, [key]: value } : part)),
    )
    const placementKey =
      key === 'positionX'
      || key === 'positionY'
      || key === 'positionZ'
      || key === 'rotationX'
      || key === 'rotationY'
      || key === 'rotationZ'
      || key === 'skinPose'
    if (placementKey && result) {
      setPlacementDirty(true)
      setStatus('Part moved — convert again before export')
      return
    }
    if (result) setResult(null)
  }

  function ensureSkinPose(part: ScenePartLocal): NonNullable<ScenePartLocal['skinPose']> {
    if (part.kind === 'obj' && !part.mimodelBytes?.length && part.bytes.length >= 64) {
      const objBytes = partObjBytes(part)
      const names = meshObjectNamesFromObj(objBytes)
      const followers = buildPoseFollowerMap(scanObjObjectBounds(objBytes))
      const editable = poseEditableObjectNames(names, followers)
      const existingPose = poseForPart(part)
      const existing: MeshPartPose | null = existingPose
        ? {
            root: existingPose.root,
            parts: existingPose.parts,
            pivots: part.skinPose?.pivots
              ? Object.fromEntries(
                  Object.entries(part.skinPose.pivots).map(([key, value]) => [
                    key,
                    [
                      value[0] ?? 0,
                      value[1] ?? 0,
                      value[2] ?? 0,
                    ] as [number, number, number],
                  ]),
                )
              : undefined,
            rigid: Boolean(part.skinPose?.rigid),
            poseParents: part.skinPose?.poseParents
              ? { ...part.skinPose.poseParents }
              : undefined,
            strokes: cloneMeshPoseStrokes(
              part.skinPose?.strokes?.map((stroke) => ({
                objectName: stroke.objectName,
                pivot: [
                  stroke.pivot[0] ?? 0,
                  stroke.pivot[1] ?? 0,
                  stroke.pivot[2] ?? 0,
                ] as [number, number, number],
                rot: [
                  stroke.rot[0] ?? 0,
                  stroke.rot[1] ?? 0,
                  stroke.rot[2] ?? 0,
                ] as [number, number, number],
                bend: [
                  stroke.bend[0] ?? 0,
                  stroke.bend[1] ?? 0,
                  stroke.bend[2] ?? 0,
                ] as [number, number, number],
                pos: [
                  stroke.pos[0] ?? 0,
                  stroke.pos[1] ?? 0,
                  stroke.pos[2] ?? 0,
                ] as [number, number, number],
              })),
            ),
          }
        : null
      const pose = ensureMeshPartPose(editable, existing)
      if (part.sourceLabel?.startsWith('Minecraft')) pose.rigid = true
      return pose
    }
    const existing = poseForPart(part)
    const source = existing ?? createRestSkinPose(part.slimArms)
    const parts = Object.fromEntries(
      Object.entries(source.parts).map(([key, value]) => [
        key,
        {
          pos: [...value.pos],
          rot: [...value.rot],
          bend: [...value.bend],
          scale: [...value.scale],
        },
      ]),
    )
    if (partHasCape(part) && !parts.cape) {
      parts.cape = emptyPartPose()
    }
    return {
      root: {
        pos: [...source.root.pos],
        rot: [...source.root.rot],
        bend: [...source.root.bend],
        scale: [...source.root.scale],
      },
      parts,
    }
  }

  function skinPoseToMimodelPose(
    pose: NonNullable<ScenePartLocal['skinPose']>,
  ): MimodelPose {
    const part = (value: {
      pos: number[]
      rot: number[]
      bend: number[]
      scale: number[]
    }): MimodelPartPose => ({
      pos: [value.pos[0] ?? 0, value.pos[1] ?? 0, value.pos[2] ?? 0],
      rot: [value.rot[0] ?? 0, value.rot[1] ?? 0, value.rot[2] ?? 0],
      bend: [value.bend[0] ?? 0, value.bend[1] ?? 0, value.bend[2] ?? 0],
      scale: [value.scale[0] ?? 1, value.scale[1] ?? 1, value.scale[2] ?? 1],
    })
    return {
      root: part(pose.root),
      parts: Object.fromEntries(
        Object.entries(pose.parts).map(([key, value]) => [key, part(value)]),
      ),
    }
  }

  function skinPoseFromMimodel(pose: MimodelPose | null | undefined): NonNullable<ScenePartLocal['skinPose']> | null {
    if (!pose) return null
    const copy = (value: MimodelPartPose) => ({
      pos: [...value.pos] as [number, number, number],
      rot: [...value.rot] as [number, number, number],
      bend: [...value.bend] as [number, number, number],
      scale: [...value.scale] as [number, number, number],
    })
    return {
      root: pose.root ? copy(pose.root) : emptyPartPose(),
      parts: Object.fromEntries(
        Object.entries(pose.parts).map(([key, value]) => [key, copy(value)]),
      ),
    }
  }

  async function rebuildMimodelPreview(partId: string, pose: NonNullable<ScenePartLocal['skinPose']>) {
    const part = partsRef.current.find((entry) => entry.id === partId)
    if (!part?.mimodelBytes?.length) return
    const texEntry = Object.entries(part.textures)[0]
    try {
      const converted = await mimodelToObj(
        part.mimodelBytes,
        texEntry?.[1] ?? null,
        texEntry?.[0] ?? null,
        skinPoseToMimodelPose(pose),
      )
      setParts((current) =>
        current.map((entry) =>
          entry.id === partId
            ? {
                ...entry,
                bytes: converted.objBytes,
                mtlBytes: converted.mtlBytes,
              }
            : entry,
        ),
      )
    } catch (error) {
      setStatus(statusFromError('Pose preview failed', error, { operation: 'rebuild mimodel pose preview' }))
    }
  }

  function scheduleMimodelPreviewRebuild(
    partId: string,
    pose: NonNullable<ScenePartLocal['skinPose']>,
  ) {
    if (mimodelRebuildTimer.current) clearTimeout(mimodelRebuildTimer.current)
    mimodelRebuildTimer.current = setTimeout(() => {
      void rebuildMimodelPreview(partId, pose)
    }, 160)
  }

  function commitSkinPose(
    next: NonNullable<ScenePartLocal['skinPose']>,
    euler?: ScenePartLocal['skinPoseEuler'],
  ) {
    if (!selected) return
    const partId = selected.id
    const rebuildMimodel = selected.kind === 'obj' && Boolean(selected.mimodelBytes?.length)
    setParts((current) =>
      current.map((part) =>
        part.id === partId
          ? {
              ...part,
              skinPose: next,
              // Limb editor / gizmos are Three.js XYZ ("blockbench"). Do not force
              // "mineimator" on every edit — that made voxels swing the opposite way.
              skinPoseEuler:
                euler
                ?? part.skinPoseEuler
                ?? (part.kind === 'skin' ? 'blockbench' : 'mineimator'),
            }
          : part,
      ),
    )
    setShowSourcePreview(true)
    if (rebuildMimodel) {
      scheduleMimodelPreviewRebuild(partId, next)
    }
    if (result) {
      setPlacementDirty(true)
      setStatus('Pose changed — convert again before export')
    } else {
      setResult(null)
    }
  }

  function commitMeshBonePose(next: MeshBonePose) {
    if (!selected || !partUsesMeshBones(selected)) return
    const partId = selected.id
    setParts((current) =>
      current.map((part) =>
        part.id === partId
          ? {
              ...part,
              meshBonePose: {
                root: {
                  pos: [...next.root.pos],
                  rot: [...next.root.rot],
                  bend: [...next.root.bend],
                },
                parts: Object.fromEntries(
                  Object.entries(next.parts).map(([key, value]) => [
                    key,
                    {
                      pos: [...value.pos],
                      rot: [...value.rot],
                      bend: [...value.bend],
                    },
                  ]),
                ),
              },
            }
          : part,
      ),
    )
    setShowSourcePreview(true)
    if (result) {
      setPlacementDirty(true)
      setStatus('Pose changed — convert again before export')
    } else {
      setResult(null)
    }
  }

  function updateSkinPosePart(
    limb: string,
    channel: 'pos' | 'rot' | 'bend',
    axis: 0 | 1 | 2,
    value: number,
  ) {
    if (!selected) return
    recordBeforeChange('pose')
    if (partUsesMeshBones(selected)) {
      const rig = rigOfPart(selected)
      const base = ensureMeshBonePose(
        selected.meshBonePose as MeshBonePose | null | undefined,
        rig,
      )
      const writeLimb = channel === 'bend' ? meshBoneBendTargetId(limb, rig) : limb
      if (writeLimb === 'root') {
        const root = {
          ...base.root,
          [channel]: [...base.root[channel]] as [number, number, number],
        }
        root[channel][axis] = value
        commitMeshBonePose({ ...base, root })
        return
      }
      const current = base.parts[writeLimb] ?? emptyMeshBonePartPose()
      const nextPart = {
        ...current,
        [channel]: [...current[channel]] as [number, number, number],
      }
      nextPart[channel][axis] = value
      commitMeshBonePose({
        ...base,
        parts: { ...base.parts, [writeLimb]: nextPart },
      })
      return
    }
    const poseLimb = meshPoseHostLimbId(skinPoseLimbBase(limb))
    const writeChannel = channel
    const base = ensureSkinPose(selected)
    // UI values are Three.js / Blockbench XYZ for skins; keep mineimator for .mimodel rigs.
    const euler: ScenePartLocal['skinPoseEuler'] =
      selected.kind === 'skin' ? 'blockbench' : (selected.skinPoseEuler ?? 'mineimator')
    if (poseLimb === 'root') {
      const root = {
        ...base.root,
        [writeChannel]: [...base.root[writeChannel]] as [number, number, number],
      }
      root[writeChannel][axis] = value
      commitSkinPose({ ...base, root }, euler)
      return
    }
    const current = base.parts[poseLimb] ?? {
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      bend: [0, 0, 0],
      scale: [1, 1, 1],
    }
    const nextPart = {
      ...current,
      [writeChannel]: [...current[writeChannel]] as [number, number, number],
    }
    nextPart[writeChannel][axis] = value
    commitSkinPose(
      {
        ...base,
        parts: { ...base.parts, [poseLimb]: nextPart },
      },
      euler,
    )
  }

  function updateSkinPoseVectors(
    limb: string,
    channel: 'pos' | 'rot' | 'bend',
    values: [number, number, number],
  ) {
    if (!selected) return
    recordBeforeChange('pose')
    if (partUsesMeshBones(selected)) {
      const rig = rigOfPart(selected)
      const base = ensureMeshBonePose(
        selected.meshBonePose as MeshBonePose | null | undefined,
        rig,
      )
      const writeLimb = channel === 'bend' ? meshBoneBendTargetId(limb, rig) : limb
      if (writeLimb === 'root') {
        commitMeshBonePose({
          ...base,
          root: { ...base.root, [channel]: [...values] as [number, number, number] },
        })
        return
      }
      const current = base.parts[writeLimb] ?? emptyMeshBonePartPose()
      commitMeshBonePose({
        ...base,
        parts: {
          ...base.parts,
          [writeLimb]: { ...current, [channel]: [...values] as [number, number, number] },
        },
      })
      return
    }
    const poseLimb = meshPoseHostLimbId(skinPoseLimbBase(limb))
    const writeChannel = channel
    const base = ensureSkinPose(selected)
    const euler: ScenePartLocal['skinPoseEuler'] =
      selected.kind === 'skin' ? 'blockbench' : (selected.skinPoseEuler ?? 'mineimator')
    if (poseLimb === 'root') {
      commitSkinPose(
        {
          ...base,
          root: {
            ...base.root,
            [writeChannel]: [...values] as [number, number, number],
          },
        },
        euler,
      )
      return
    }
    const current = base.parts[poseLimb] ?? {
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      bend: [0, 0, 0],
      scale: [1, 1, 1],
    }
    commitSkinPose(
      {
        ...base,
        parts: {
          ...base.parts,
          [poseLimb]: {
            ...current,
            [writeChannel]: [...values] as [number, number, number],
          },
        },
      },
      euler,
    )
  }

  function resetSkinPoseLimb(limb: string) {
    if (!selected) return
    recordBeforeChange()
    if (partUsesMeshBones(selected)) {
      const base = ensureMeshBonePose(
        selected.meshBonePose as MeshBonePose | null | undefined,
        rigOfPart(selected),
      )
      if (limb === 'root') {
        commitMeshBonePose({ ...base, root: emptyMeshBonePartPose() })
        return
      }
      commitMeshBonePose({
        ...base,
        parts: { ...base.parts, [limb]: emptyMeshBonePartPose() },
      })
      return
    }
    const base = ensureSkinPose(selected) as MeshPartPose
    const empty = emptyPartPose()
    const bendRow = skinPoseLimbIsBend(limb)
    const poseLimb = meshPoseHostLimbId(skinPoseLimbBase(limb))
    if (poseLimb === 'root') {
      if (bendRow) {
        commitSkinPose({ ...base, root: { ...base.root, bend: [...empty.bend] } }, 'blockbench')
      } else {
        commitSkinPose({ ...base, root: { ...empty } }, 'blockbench')
      }
      return
    }
    const current = base.parts[poseLimb] ?? empty
    if (bendRow) {
      commitSkinPose(
        {
          ...base,
          parts: {
            ...base.parts,
            [poseLimb]: { ...current, bend: [...empty.bend] },
          },
        },
        'blockbench',
      )
      return
    }
    const pivots = { ...(base.pivots ?? {}) }
    delete pivots[poseLimb]
    // Upper row: clear rot/pos but keep the forearm/shin bend.
    commitSkinPose(
      {
        ...base,
        parts: {
          ...base.parts,
          [poseLimb]: {
            ...empty,
            bend: [...(current.bend ?? empty.bend)],
          },
        },
        pivots: Object.keys(pivots).length > 0 ? pivots : undefined,
        strokes: (base.strokes ?? []).filter((stroke) => stroke.objectName !== poseLimb),
      },
      'blockbench',
    )
  }

  function resetSkinPoseAll() {
    if (!selected) return
    recordBeforeChange()
    if (partUsesMeshBones(selected)) {
      commitMeshBonePose(
        createRestMeshBonePose(rigOfPart(selected)),
      )
      return
    }
    if (selected.kind === 'obj' && !selected.mimodelBytes?.length && selected.bytes.length >= 64) {
      const objBytes = partObjBytes(selected)
      const names = meshObjectNamesFromObj(objBytes)
      const followers = buildPoseFollowerMap(scanObjObjectBounds(objBytes))
      const editable = poseEditableObjectNames(names, followers)
      commitSkinPose(ensureMeshPartPose(editable, null), 'blockbench')
      return
    }
    const rest = createRestSkinPose(selected.slimArms)
    commitSkinPose(
      {
        root: {
          pos: [...rest.root.pos],
          rot: [...rest.root.rot],
          bend: [...rest.root.bend],
          scale: [...rest.root.scale],
        },
        parts: Object.fromEntries(
          Object.entries(rest.parts).map(([key, value]) => [
            key,
            {
              pos: [...value.pos],
              rot: [...value.rot],
              bend: [...value.bend],
              scale: [...value.scale],
            },
          ]),
        ),
        pivots: undefined,
        strokes: undefined,
      },
      'blockbench',
    )
  }

  function updateShared<K extends keyof SharedOptions>(key: K, value: SharedOptions[K]) {
    recordBeforeChange('materials')
    setShared((current) => ({ ...current, [key]: value }))
    // Keep the current tab / preview; re-voxelize with the new materials.
    if (result) setMaterialsTick((tick) => tick + 1)
  }

  function updateSharedTune<K extends keyof SharedOptions>(key: K, value: SharedOptions[K]) {
    recordBeforeChange('materials')
    setShared((current) => ({ ...current, [key]: value }))
  }

  function commitSharedTune() {
    endCoalesce()
    if (result) setMaterialsTick((tick) => tick + 1)
  }

  function updateUv<K extends keyof ModelUvOptions>(key: K, value: ModelUvOptions[K], reconvert = false) {
    if (!selected) return
    recordBeforeChange('part-edit')
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id
          ? { ...part, uv: { ...resolveModelUv(part.uv), [key]: value } }
          : part,
      ),
    )
    if (reconvert && result) setMaterialsTick((tick) => tick + 1)
  }

  function commitUvTune() {
    endCoalesce()
    if (result) setMaterialsTick((tick) => tick + 1)
  }

  function requestMaterialReconvert() {
    if (result) setMaterialsTick((tick) => tick + 1)
  }

  function removePart(id: string) {
    const name = parts.find((part) => part.id === id)?.name ?? 'object'
    recordBeforeChange()
    setParts((current) => {
      const next = current.filter((part) => part.id !== id)
      setSelectedId((prev) => {
        if (prev !== id) return prev
        return next[0]?.id ?? null
      })
      return next
    })
    setResult(null)
    setPlacementDirty(false)
    setStatus(parts.length <= 1 ? `Removed ${name}` : `Removed ${name} (${parts.length - 1} left)`)
  }

  function removeSelected() {
    if (!selected) return
    removePart(selected.id)
  }

  function removeAllParts() {
    if (parts.length === 0) return
    const count = parts.length
    recordBeforeChange()
    setParts([])
    setSelectedId(null)
    setResult(null)
    setPlacementDirty(false)
    setStatus(count === 1 ? 'Removed 1 object' : `Removed all ${count} objects`)
  }

  function duplicateSelected() {
    if (!selected) return
    const copy: ScenePartLocal = {
      ...selected,
      id: crypto.randomUUID(),
      name: `${selected.name} copy`,
      positionX: selected.positionX + selected.width + 2,
      rotationX: selected.rotationX ?? 0,
      rotationY: selected.rotationY ?? 0,
      rotationZ: selected.rotationZ ?? 0,
      bytes: selected.bytes.slice(),
      mtlBytes: selected.mtlBytes ? selected.mtlBytes.slice() : null,
      textures: Object.fromEntries(
        Object.entries(selected.textures).map(([key, value]) => [key, value.slice()]),
      ),
      miobjectBytes: selected.miobjectBytes ? selected.miobjectBytes.slice() : null,
      mimodelBytes: selected.mimodelBytes ? selected.mimodelBytes.slice() : null,
      mayaBytes: selected.mayaBytes ? selected.mayaBytes.slice() : null,
      daeBytes: selected.daeBytes ? selected.daeBytes.slice() : null,
      fbxBytes: selected.fbxBytes ? selected.fbxBytes.slice() : null,
      fbxMaterialTextures: selected.fbxMaterialTextures
        ? { ...selected.fbxMaterialTextures }
        : null,
      voxBytes: selected.voxBytes ? selected.voxBytes.slice() : null,
      capeBytes: selected.capeBytes ? selected.capeBytes.slice() : null,
      capeFileName: selected.capeFileName ?? null,
      capeId: selected.capeId ?? null,
      skinPose: selected.skinPose ?? null,
      skinPoseEuler: selected.skinPoseEuler ?? null,
    }
    recordBeforeChange()
    setParts((current) => [...current, copy])
    setSelectedId(copy.id)
    setResult(null)
    setPlacementDirty(false)
  }

  function translatePart(partIndex: number, dx: number, dy: number, dz: number) {
    setParts((current) =>
      current.map((part, index) =>
        index === partIndex
          ? {
              ...part,
              positionX: part.positionX + dx,
              positionY: part.positionY + dy,
              positionZ: part.positionZ + dz,
            }
          : part,
      ),
    )
    // Keep the current voxel preview — only mark export placement as needing a reconvert.
    setPlacementDirty(true)
    setStatus('Part moved — convert again before export')
    endCoalesce()
  }

  const beginPoseEdit = useCallback(() => {
    endCoalesce()
    recordBeforeChange('pose')
  }, [endCoalesce, recordBeforeChange])

  const beginTranslateEdit = useCallback(() => {
    endCoalesce()
    recordBeforeChange('translate')
  }, [endCoalesce, recordBeforeChange])

  function setPosePivot(limb: string, localPoint: [number, number, number]) {
    if (!selected || !partSupportsPoseEditing(selected)) return
    recordBeforeChange('pose')
    const base = ensureSkinPose(selected) as MeshPartPose
    const prev = base.pivots?.[limb]
    if (
      prev
      && Math.hypot(
        prev[0] - localPoint[0],
        prev[1] - localPoint[1],
        prev[2] - localPoint[2],
      ) < 1e-3
    ) {
      return
    }
    const bounds = scanObjObjectBounds(partObjBytes(selected)).find(
      (entry) => entry.name === limb,
    )
    const fallbackPivot =
      bounds?.center
      ?? ([localPoint[0], localPoint[1], localPoint[2]] as [number, number, number])
    // Keep the previous bend/rotate on its joint; start fresh at the new click.
    const committed = commitLivePoseStroke(base, limb, fallbackPivot)
    commitSkinPose(
      {
        ...committed,
        pivots: {
          ...(committed.pivots ?? {}),
          [limb]: localPoint,
        },
      },
      selected.kind === 'skin' ? 'blockbench' : (selected.skinPoseEuler ?? 'mineimator'),
    )
  }

  function applyObjPreset(presetId: ObjSizePresetId) {
    if (!selected || selected.kind !== 'obj') return
    setShowCustomSize(presetId === 'custom')
    if (presetId === 'custom') {
      recordBeforeChange()
      setParts((current) =>
        current.map((part) =>
          part.id === selected.id ? { ...part, objSizePreset: 'custom' } : part,
        ),
      )
      setCustomUniformFit(selected.fit === 'fit' && selected.width === selected.height && selected.height === selected.length)
      return
    }
    setLoadProgress(
      presetId === 'auto' ? { ratio: 0.2, label: 'Measuring model for Auto max…' } : null,
    )
    // Auto scans verts — yield so the progress bar can paint first.
    window.setTimeout(() => {
      recordBeforeChange()
      setParts((current) =>
        current.map((part) => {
          if (part.id !== selected.id) return part
          if (presetId === 'auto') return applyObjAutoSize(part)
          return applyObjSizePreset(part, presetId, 'fit')
        }),
      )
      setResult(null)
      setLoadProgress(null)
      if (presetId === 'auto') {
        setStatus('Auto max size applied from mesh bounds')
      }
    }, 30)
  }

  function applySkinPreset(presetId: SkinSizePresetId) {
    if (!selected || selected.kind !== 'skin') return
    setShowCustomSize(presetId === 'custom')
    if (presetId === 'custom') {
      setCustomUniformFit(true)
      return
    }
    recordBeforeChange()
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id ? applySkinSizePreset(part, presetId) : part,
      ),
    )
    setResult(null)
  }

  function applySkinCustomAxis(axis: 'width' | 'height' | 'length', value: number) {
    if (!selected || selected.kind !== 'skin') return
    recordBeforeChange('size')
    setParts((current) =>
      current.map((part) => {
        if (part.id !== selected.id) return part
        if (!customUniformFit) {
          const next = { ...part, [axis]: value }
          const box = clampVoxelBox(next)
          return { ...next, ...box }
        }
        return applySkinLinkedAxis(part, axis, value)
      }),
    )
    setResult(null)
  }

  function applyCustomUniformSize(blocks: number) {
    if (!selected) return
    const longest = Math.max(1, Math.round(blocks))
    const sx = Math.max(1, selected.width)
    const sy = Math.max(1, selected.height)
    const sz = Math.max(1, selected.length)
    const maxS = Math.max(sx, sy, sz)
    const box = clampVoxelBox({
      width: (longest * sx) / maxS,
      height: (longest * sy) / maxS,
      length: (longest * sz) / maxS,
    })
    recordBeforeChange('size')
    setParts((current) =>
      current.map((part) =>
        part.id === selected.id
          ? {
              ...part,
              width: box.width,
              height: box.height,
              length: box.length,
              fit: 'fit',
              objSizePreset: 'custom',
            }
          : part,
      ),
    )
    setResult(null)
  }

  function applyCustomAxis(axis: 'width' | 'height' | 'length', value: number) {
    if (!selected) return
    recordBeforeChange('size')
    setParts((current) =>
      current.map((part) => {
        if (part.id !== selected.id) return part
        const next = {
          ...part,
          [axis]: value,
          fit: 'stretch' as const,
          objSizePreset: 'custom' as const,
        }
        const box = clampVoxelBox(next)
        return { ...next, ...box }
      }),
    )
    setResult(null)
  }

  async function runVoxelize(): Promise<boolean> {
    if (parts.length === 0) return false
    const missingSkin = parts.find((part) => part.kind === 'skin' && part.bytes.length === 0)
    if (missingSkin) {
      setStatus(
        `Add the skin PNG for ${missingSkin.name} before converting`,
      )
      return false
    }
    const pendingModel = parts.find((part) => part.sourceLabel?.includes('needs '))
    if (pendingModel) {
      setStatus(`Add the .mimodel for ${pendingModel.name} before converting`)
      return false
    }
    const generation = ++voxelizeGenerationRef.current
    const convertGeneration = nextConvertGeneration()
    setBusy(true)
    setStatus('Converting to voxels…')
    setLoadProgress({ ratio: 0.02, label: 'Preparing model data…' })
    const stagedPaths: string[] = []
    const work = (async (): Promise<boolean> => {
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40))
      const encodedParts = []
      const refreshedEntities: ScenePartLocal[] = []
      for (let index = 0; index < parts.length; index += 1) {
        let part = parts[index]
        const base = 0.05 + (index / Math.max(parts.length, 1)) * 0.5

        if (part.sourceLabel?.startsWith('Minecraft entity')) {
          part = await ensureCatalogEntityTextures(part)
          refreshedEntities.push(part)
        }

        // Mine-imator classic pose is applied via posed OBJ (rebuildMimodelPreview).
        // Bone-rig mode bakes meshBonePose into the mesh instead. PNG skins always
        // send skinPose to Rust (mapped from meshBonePose when Skeleton ≠ Classic).
        let skinPose: {
          root: { pos: number[]; rot: number[]; bend: number[]; scale: number[] }
          parts: Record<string, { pos: number[]; rot: number[]; bend: number[]; scale: number[] }>
          jointStyle?: 'blockbench' | 'mineimator' | null
        } | null = partUsesMeshBones(part) && part.kind !== 'skin' ? null : part.skinPose ?? null
        if (
          part.kind === 'skin'
          && partUsesMeshBones(part)
          && part.meshBonePose
          && meshBonePoseIsActive(
            part.meshBonePose as MeshBonePose,
            playerSkinHumanoidRig(part.slimArms),
          )
        ) {
          skinPose = meshBonePoseToSkinPose(
            ensureMeshBonePose(
              part.meshBonePose as MeshBonePose,
              playerSkinHumanoidRig(part.slimArms),
            ),
          )
        }
        // Editor / gizmos author Three.js XYZ. Mine-imator .miobject keyframes are GM-LH.
        // PNG / limb-editor poses always use blockbench Euler (RH XYZ). Legs stay on root.
        const isMiTimeline = Boolean(part.miobjectBytes && part.miobjectBytes.length > 0)
        const eulerMode: 'blockbench' | 'mineimator' = isMiTimeline
          ? (part.skinPoseEuler === 'blockbench' ? 'blockbench' : 'mineimator')
          : 'blockbench'
        if (skinPose && eulerMode === 'blockbench') {
          // Angles stay as authored in the Three.js / Blockbench XYZ editor.
          // Rust applies RH XYZ when jointStyle is blockbench (no sign flip).
          skinPose = {
            ...skinPose,
            jointStyle: 'blockbench',
          }
        } else if (skinPose) {
          skinPose = { ...skinPose, jointStyle: 'mineimator' }
        }
        if (
          !skinPose
          && part.kind === 'skin'
          && part.miobjectBytes
          && part.miobjectBytes.length > 0
        ) {
          try {
            const pose = extractCharacterPose(part.miobjectBytes)
            const mag = (p: { pos: number[]; rot: number[]; bend: number[] }) =>
              Math.abs(p.rot[0]) + Math.abs(p.rot[1]) + Math.abs(p.rot[2])
              + Math.abs(p.bend[0]) + Math.abs(p.bend[1]) + Math.abs(p.bend[2])
              + Math.abs(p.pos[0]) + Math.abs(p.pos[1]) + Math.abs(p.pos[2])
            if (mag(pose.root) > 0.05 || Object.values(pose.parts).some((p) => mag(p) > 0.05)) {
              skinPose = {
                // Scene placement POS is not part of the statue pose.
                root: { ...pose.root, pos: [0, 0, 0] },
                parts: pose.parts,
              }
            }
          } catch {
            // still convert as rest-pose skin
          }
        }

        let sourceBytes = part.bytes
        const convertSourcePath = part.sourcePath ?? null
        const pathOnlyObj =
          part.kind === 'obj'
          && !part.mimodelBytes?.length
          && sourceBytes.length < 64
          && Boolean(convertSourcePath)
        if (pathOnlyObj && convertSourcePath && objPartNeedsRewrite(part)) {
          setLoadProgress({
            ratio: base,
            label: fileProgressLabel('Loading', part.name),
          })
          sourceBytes = await readLocalFileBytes(convertSourcePath, (ratio) => {
            setLoadProgress({
              ratio: base + ratio * (0.25 / Math.max(parts.length, 1)),
              label: fileProgressLabel('Loading', part.name),
            })
          })
        }
        const meshPart = { ...part, bytes: sourceBytes }
        const partBytes = partObjBytes(meshPart)
        let convertBytes = partBytes
        if (
          partUsesMeshBones(meshPart)
          && part.kind !== 'skin'
          && part.meshBonePose
          && meshBonePoseIsActive(
            part.meshBonePose as MeshBonePose,
            rigOfPart(meshPart, partBytes),
          )
        ) {
          convertBytes = bakeMeshBonePose(
            partBytes,
            ensureMeshBonePose(
              part.meshBonePose as MeshBonePose,
              rigOfPart(meshPart, partBytes),
            ),
            boneFitModeOf(meshPart),
            boneFitModeOf(meshPart) === 'native' ? meshPart.nativeMeshRig : null,
            boneFitModeOf(meshPart) === 'native' ? meshPart.nativeMeshWeights : null,
            meshSkinModeOf(meshPart),
          )
        } else if (
          part.kind === 'obj'
          && !part.mimodelBytes?.length
          && !partUsesMeshBones(meshPart)
          && part.skinPose
          && poseIsActive(part.skinPose as MeshPartPose)
        ) {
          const objectNames = meshObjectNamesFromObj(partBytes)
          const followers = buildPoseFollowerMap(scanObjObjectBounds(partBytes))
          const editable = poseEditableObjectNames(objectNames, followers)
          convertBytes = bakeObjPartPose(
            partBytes,
            {
              ...ensureMeshPartPose(editable, part.skinPose as MeshPartPose),
              rigid:
                Boolean((part.skinPose as MeshPartPose).rigid)
                || Boolean(part.sourceLabel?.startsWith('Minecraft')),
            },
          )
        }
        // Inflated second-layer cubes (hat / jacket / sleeves) are hollow
        // 0.25–0.5px boxes. Voxelizing them as extra shells is the floating
        // cyan / hair geometry — strip for most mobs. Drowned / stray / sheep
        // need those shells (clothing / wool) so convert keeps them.
        if (part.sourceLabel?.startsWith('Minecraft entity')) {
          const mobId = part.fileName.replace(/\.obj$/i, '')
          if (!catalogKeepConvertOverlays(mobId)) {
            convertBytes = stripMinecraftOverlayObjects(convertBytes)
          }
        }
        let convertWidth = part.width
        let convertHeight = part.height
        let convertLength = part.length
        let convertFit = part.fit
        const isMcEntity = Boolean(part.sourceLabel?.startsWith('Minecraft entity'))
        if (isMcEntity) {
          const inner = objAxisAlignedSize(convertBytes)
          if (inner) {
            const box = catalogEntityVoxelBox(
              {
                width: convertWidth,
                height: convertHeight,
                length: convertLength,
                fit: convertFit,
              },
              inner,
            )
            convertWidth = box.width
            convertHeight = box.height
            convertLength = box.length
            convertFit = box.fit
          }
        }
        const objPoseBaked =
          part.kind === 'obj'
          && !partUsesMeshBones(part)
          && Boolean(part.skinPose)
          && poseIsActive(part.skinPose as MeshPartPose)
        // Catalog entities stay 1:1 stretch at native size. Fit letterboxing was
        // floating posed meshes and crushing thin limbs.
        if (!isMcEntity && (Boolean(skinPose) || objPoseBaked) && convertFit === 'stretch') {
          convertFit = 'fit'
        }
        {
          const box = clampVoxelBox({
            width: convertWidth,
            height: convertHeight,
            length: convertLength,
          })
          convertWidth = box.width
          convertHeight = box.height
          convertLength = box.length
        }
        const useStaging = !convertSourcePath && convertBytes.length > 256 * 1024
        // The file on disk still holds the excluded objects / rest pose, so
        // rewritten bytes have to be staged instead of the original path.
        const mustStage = convertBytes !== sourceBytes

        let dataBase64: string | undefined
        let dataPath: string | null = null
        if (convertSourcePath && !mustStage) {
          // Huge OBJs: convert reads the original file — avoid re-staging via base64 IPC.
          setLoadProgress({
            ratio: base,
            label: fileProgressLabel('Using', part.name),
          })
          dataPath = convertSourcePath
        } else if (useStaging || mustStage) {
          setLoadProgress({
            ratio: base,
            label: fileProgressLabel('Saving', part.name),
          })
          dataPath = await stageBytesToTemp(convertBytes, part.fileName, (ratio) => {
            setLoadProgress({
              ratio: base + ratio * (0.5 / Math.max(parts.length, 1)),
              label: fileProgressLabel('Saving', part.name),
            })
          })
          stagedPaths.push(dataPath)
        } else {
          setLoadProgress({ ratio: base, label: fileProgressLabel('Packing', part.name) })
          dataBase64 = await bytesToBase64Async(convertBytes)
        }

        let mtlBase64: string | null = null
        let mtlPath: string | null = null
        if (part.mtlBytes && part.mtlBytes.length > 0) {
          if (part.mtlBytes.length > 64 * 1024) {
            mtlPath = await stageBytesToTemp(part.mtlBytes, part.mtlFileName ?? 'materials.mtl')
            stagedPaths.push(mtlPath)
          } else {
            mtlBase64 = bytesToBase64(part.mtlBytes)
          }
        }

        const texturesBase64: Record<string, string> = {}
        const texturesPaths: Record<string, string> = {}
        for (const [name, bytes] of Object.entries(part.textures)) {
          const png = await ensureRgbaPngBytes(bytes)
          if (png.length > 64 * 1024) {
            const path = await stageBytesToTemp(png, name)
            stagedPaths.push(path)
            texturesPaths[name] = path
          } else {
            texturesBase64[name] = bytesToBase64(png)
          }
        }

        encodedParts.push({
          id: part.id,
          name: part.name,
          kind: part.kind,
          fileName: part.fileName,
          dataBase64,
          dataPath,
          mtlBase64,
          mtlPath,
          texturesBase64,
          texturesPaths,
          positionX: part.positionX,
          positionY: part.positionY,
          positionZ: part.positionZ,
          rotationX: part.rotationX ?? 0,
          rotationY: part.rotationY ?? 0,
          rotationZ: part.rotationZ ?? 0,
          width: convertWidth,
          height: convertHeight,
          length: convertLength,
          fit: convertFit,
          hollow: part.hollow,
          cutout: isMcEntity,
          uv: resolveModelUv(part.uv),
          slimArms: part.slimArms,
          outer3d:
            part.skinOverlay === 'none'
              ? false
              : part.skinOverlay === 'hat'
                ? true
                : outer3d,
          skinOverlay: part.skinOverlay,
          skeletonLimbs: part.skinLimbs === 'skeleton',
          skinPose,
          smoothJoints,
          capeBase64:
            part.capeBytes && part.capeBytes.length >= 64
              ? part.capeBytes.length > 256 * 1024
                ? await bytesToBase64Async(part.capeBytes)
                : bytesToBase64(part.capeBytes)
              : null,
        })
      }

      if (refreshedEntities.length > 0) {
        const byId = new Map(refreshedEntities.map((p) => [p.id, p]))
        setParts((prev) => prev.map((p) => {
          const refreshed = byId.get(p.id)
          if (!refreshed) return p
          return {
            ...p,
            bytes: refreshed.bytes,
            mtlBytes: refreshed.mtlBytes,
            mtlFileName: refreshed.mtlFileName,
            expectedMtlFileName: refreshed.expectedMtlFileName,
            textures: refreshed.textures,
            expectedTextureNames: refreshed.expectedTextureNames,
            width: refreshed.width,
            height: refreshed.height,
            length: refreshed.length,
            skinPose: refreshed.skinPose,
          }
        }))
      }

      setLoadProgress({
        ratio: 0.7,
        label: 'Building voxels…',
        indeterminate: true,
      })
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40))

      const materials = sharedRef.current
      const next = await convertScene({
        parts: encodedParts,
        disabledColorIds: materials.disabledColorIds,
        blockOverrides: materials.blockOverrides,
        blockPack: materials.blockPack,
        disabledBlocks: materials.disabledBlocks,
        blockSubstitutions: materials.blockSubstitutions,
        supportMode: materials.supportMode,
        supportBlock: materials.supportBlock,
        colourMatching: materials.colourMatching,
        dither: materials.dither,
        hue: materials.hue,
        brightness: materials.brightness,
        contrast: materials.contrast,
        saturation: materials.saturation,
      }, convertGeneration)
      if (generation !== voxelizeGenerationRef.current) return false
      setLoadProgress({ ratio: 1, label: 'Finishing…' })
      setResult(next)
      setPlacementDirty(false)
      setShowSourcePreview(false)
      // Stay on Export when reconverting materials / placement; otherwise land on Build.
      setStep((current) => (current === 'export' ? 'export' : 'build'))
      setStatus(
        next.voxels.length < next.occupiedVoxels
          ? `Voxelized · ${next.occupiedVoxels.toLocaleString()} blocks (preview shows the full shape, sampled)`
          : `Voxelized · ${next.occupiedVoxels.toLocaleString()} blocks`,
      )
      return true
    } catch (error: unknown) {
      if (generation !== voxelizeGenerationRef.current) return false
      setStatus(statusFromError('Conversion failed', error, { operation: 'convert to voxels' }))
      return false
    } finally {
      // Convert-only temps (not part.sourcePath kept for mesh preview).
      await cleanupStagedPaths(stagedPaths)
      if (generation === voxelizeGenerationRef.current) {
        setBusy(false)
        setLoadProgress(null)
      }
    }
    })()
    voxelizeInflightRef.current = work
    let current = work
    let ok = await current
    for (;;) {
      const latest = voxelizeInflightRef.current
      if (!latest || latest === current) return ok
      current = latest
      ok = await current
    }
  }
  runVoxelizeRef.current = () => runVoxelize()

  useEffect(() => {
    if (materialsTick === 0) return
    const timer = window.setTimeout(() => {
      void runVoxelizeRef.current()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [materialsTick])

  async function exportWithPlacement(format: ExportFormat) {
    if (placementDirty) {
      setStatus('Updating placement before export…')
      const ok = await runVoxelize()
      if (!ok) return
    }
    await runExport(format, setStatus, result?.build)
  }

  const selectedPartIndex = selected
    ? parts.findIndex((part) => part.id === selected.id)
    : null
  const selectedPartIndexOrNull =
    selectedPartIndex != null && selectedPartIndex >= 0 ? selectedPartIndex : null

  function cubeRgb(state: string): [number, number, number] {
    const id = cubeId(state)
    const hit = modelCubes.find((cube) => cubeId(cube.block) === id)
    return hit?.rgb ?? [128, 128, 128]
  }

  function openCubeReplace(sourceState: string) {
    const placed = shared.blockSubstitutions[sourceState]
      ?? shared.blockSubstitutions[cubeId(sourceState)]
      ?? sourceState
    setReplaceTarget({
      selectedState: placed,
      sourceState,
      enabled: !cubeIsDisabled(sourceState, shared.disabledBlocks),
      rgb: cubeRgb(sourceState),
      replaced: Boolean(
        shared.blockSubstitutions[sourceState] || shared.blockSubstitutions[cubeId(sourceState)],
      ),
    })
  }

  function toggleCube(state: string, enabled: boolean) {
    setActivePreset('custom')
    recordBeforeChange('materials')
    const id = cubeId(state)
    setShared((current) => {
      const next = current.disabledBlocks.filter((entry) => cubeId(entry) !== id)
      if (!enabled) next.push(id)
      return { ...current, disabledBlocks: next }
    })
    requestMaterialReconvert()
  }

  function replaceCube(fromState: string, toState: string) {
    setActivePreset('custom')
    recordBeforeChange('materials')
    const from = fromState.startsWith('minecraft:') ? fromState : `minecraft:${cubeId(fromState)}`
    setShared((current) => {
      const next = { ...current.blockSubstitutions }
      if (cubeId(from) === cubeId(toState)) delete next[from]
      else next[from] = toState.startsWith('minecraft:') ? toState : `minecraft:${cubeId(toState)}`
      return { ...current, blockSubstitutions: next }
    })
    requestMaterialReconvert()
  }

  function applyPreset(preset: StatueMaterialPreset) {
    if (!palette) return
    const next = applyStatueMaterialPreset(palette, preset)
    setActivePreset(preset)
    recordBeforeChange('materials')
    setShared((current) => ({
      ...current,
      disabledColorIds: next.disabledColorIds,
      blockOverrides: next.blockOverrides,
      blockPack: next.blockPack,
      disabledBlocks: next.disabledBlocks,
      blockSubstitutions: next.blockSubstitutions,
    }))
    requestMaterialReconvert()
  }

  const supportChoices = useMemo(
    () => (palette ? staircaseSupportChoices(palette) : []),
    [palette],
  )
  const cubeRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of result?.build.materials ?? []) {
      counts.set(cubeId(material.block), material.count)
    }
    const query = paletteSearch.trim().toLowerCase()
    return modelCubes
      .map((cube) => {
        const id = cubeId(cube.block)
        const placed = shared.blockSubstitutions[cube.block]
          ?? shared.blockSubstitutions[id]
          ?? cube.block
        const usedCount = counts.get(id) ?? counts.get(cubeId(placed)) ?? 0
        const category = materialCategory(cube.block)
        const haystack = `${friendlyBlockName(cube.block)} ${cube.block} ${materialCategoryLabel(category)}`.toLowerCase()
        return {
          cube,
          placed,
          usedCount,
          category,
          enabled: !cubeIsDisabled(cube.block, shared.disabledBlocks),
          visible: !query || haystack.includes(query),
        }
      })
      .filter((row) => row.visible)
      .sort((a, b) => {
        const aUsed = a.usedCount > 0 ? 1 : 0
        const bUsed = b.usedCount > 0 ? 1 : 0
        if (aUsed !== bUsed) return bUsed - aUsed
        if (a.usedCount !== b.usedCount) return b.usedCount - a.usedCount
        if (a.category !== b.category) {
          return materialCategoryLabel(a.category).localeCompare(materialCategoryLabel(b.category))
        }
        return friendlyBlockName(a.cube.block).localeCompare(friendlyBlockName(b.cube.block))
      })
  }, [modelCubes, paletteSearch, result, shared.blockSubstitutions, shared.disabledBlocks])
  const usedCubeRows = useMemo(
    () => cubeRows.filter((row) => row.usedCount > 0),
    [cubeRows],
  )
  const otherCubeGroups = useMemo(() => {
    const unused = cubeRows.filter((row) => row.usedCount === 0)
    const groups = new Map<string, typeof unused>()
    for (const row of unused) {
      const label = materialCategoryLabel(row.category)
      const list = groups.get(label) ?? []
      list.push(row)
      groups.set(label, list)
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [cubeRows])

  /** Blocks actually placed in the last convert — ordered by count, then name. */
  const usedBlocks = useMemo(() => {
    if (!result) return []
    const known = new Set(modelCubes.map((cube) => cubeId(cube.block)))
    return result.build.materials
      .slice()
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return friendlyBlockName(a.block).localeCompare(friendlyBlockName(b.block))
      })
      .map((material) => {
        const id = cubeId(material.block)
        const cube = modelCubes.find((entry) => cubeId(entry.block) === id)
        const isSupport = !cube && baseBlockId(material.block) === baseBlockId(shared.supportBlock)
        return {
          ...material,
          rgb: cube?.rgb,
          editable: known.has(id),
          isSupport,
          category: materialCategoryLabel(materialCategory(material.block)),
        }
      })
  }, [result, modelCubes, shared.supportBlock])

  const visibleUsedBlocks = useMemo(() => {
    const query = materialSearch.trim().toLowerCase()
    if (!query) return usedBlocks
    return usedBlocks.filter((row) =>
      friendlyBlockName(row.block).toLowerCase().includes(query)
      || row.block.toLowerCase().includes(query)
      || row.category.toLowerCase().includes(query),
    )
  }, [usedBlocks, materialSearch])

  const materials = usedBlocks
  const totalBlockCount = materials.reduce((sum, item) => sum + item.count, 0)

  function renderUsedBlocksList(emptyLabel: string) {
    return (
      <>
        {usedBlocks.length > 8 && (
          <div className="material-tools material-tools-search">
            <input
              type="search"
              placeholder="Filter used blocks…"
              value={materialSearch}
              onChange={(event) => setMaterialSearch(event.target.value)}
            />
          </div>
        )}
        <div className="material-list material-list-clean">
          {visibleUsedBlocks.map((row) => {
            return (
              <button
                type="button"
                className="material-row material-row-pick"
                key={row.block}
                disabled={!row.editable}
                title={
                  row.editable
                    ? 'Change this block'
                    : row.isSupport
                      ? 'Placed under gravity / carpet blocks — change under Gravity support'
                      : 'Not a statue cube in this pack'
                }
                onClick={() => {
                  if (!row.editable) return
                  openCubeReplace(row.block)
                }}
              >
                <BlockIcon block={row.block} color={row.rgb} />
                <span className="material-row-copy" title={row.block}>
                  <b>{friendlyBlockName(row.block)}</b>
                  <small>
                    {row.category}
                    {' · '}
                    {formatStacks(row.stacks, row.remainder)}
                  </small>
                </span>
                {row.editable ? (
                  <strong>{row.count.toLocaleString()}</strong>
                ) : (
                  <em>{row.isSupport ? 'Support' : 'Other'}</em>
                )}
              </button>
            )
          })}
          {visibleUsedBlocks.length === 0 && (
            <div className="material-empty">{emptyLabel}</div>
          )}
        </div>
      </>
    )
  }

  const objPreset = selected?.kind === 'obj' ? matchObjSizePreset(selected) : 'medium'
  const skinPreset = selected?.kind === 'skin' ? matchSkinSizePreset(selected) : '2x'
  const customOpen =
    showCustomSize
    || (selected?.kind === 'obj' && objPreset === 'custom')
    || (selected?.kind === 'skin' && skinPreset === 'custom')

  const viewportMode: 'empty' | 'mesh' | 'voxels' =
    result && result.voxels.length > 0 && !showSourcePreview && (step === 'build' || step === 'export')
      ? 'voxels'
      : parts.length > 0
        ? 'mesh'
        : 'empty'

  return (
    <div className="app-shell models-shell">
      <header className="topbar">
        <Button variant="soft" color="gray" size="2" className="back-button" onClick={onBack}>
          ← Tools
        </Button>
        <div className="brand-mark" aria-hidden="true">V</div>
        <div className="brand-copy">
          <strong>Models</strong>
          <span>StructureLab · sources → build → export</span>
        </div>
        <TopbarStatus status={status} busy={busy} ready={Boolean(result)} />
        <div className="topbar-history" role="group" aria-label="History">
          <Button
            type="button"
            variant="soft"
            color="gray"
            size="1"
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            onClick={performUndo}
          >
            Undo
          </Button>
          <Button
            type="button"
            variant="soft"
            color="gray"
            size="1"
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            onClick={performRedo}
          >
            Redo
          </Button>
        </div>
        <MinecraftVersionSelect />
        <Button variant="solid" size="2" onClick={() => setPaletteOpen(true)}>
          Materials
        </Button>
        <LightfallToggle className="topbar-lightfall-toggle" />
        <ThemeToggle className="topbar-theme-toggle" />
      </header>

      <nav className="workflow-steps" aria-label="Models workflow">
        {WORKFLOW_STEPS.map((item, index) => {
          const incomplete = parts.some(
            (part) =>
              (part.kind === 'skin' && part.bytes.length === 0)
              || Boolean(part.sourceLabel?.includes('needs '))
              || (
                Boolean(part.mimodelBytes)
                && Object.keys(part.textures).length === 0
                && part.expectedTextureNames.some((name) => isRasterTextureName(name))
              ),
          )
          // Build is reachable once any sources exist — user may Continue anyway.
          const reachable =
            item.id === 'sources'
            || (item.id === 'build' && parts.length > 0)
            || (item.id === 'export' && result != null)
          const active = step === item.id
          const warn = item.id === 'build' && incomplete && parts.length > 0
          return (
            <Button
              key={item.id}
              type="button"
              className="workflow-tab"
              variant={active ? 'soft' : 'ghost'}
              color={warn ? 'amber' : active ? undefined : 'gray'}
              disabled={!reachable}
              onClick={() => setStep(item.id)}
            >
              <Text size="1" weight="bold">{String(index + 1).padStart(2, '0')}</Text>
              <span className="workflow-tab-copy">
                <Text weight="medium">{item.label}</Text>
                <Text size="1" color="gray">{item.detail}</Text>
              </span>
            </Button>
          )
        })}
      </nav>

      <main className="workspace">
        <aside className="control-panel">
          {step === 'sources' && (
            <div className="sources-panel">
              <div className="sources-panel-scroll">
              <PanelTitle step="01" title="Sources" />
              <MinecraftAddDialog
                outer3d={outer3d}
                onOuter3dChange={(value) => {
                  recordBeforeChange()
                  setOuter3d(value)
                }}
                onAdd={appendImportedParts}
              />
              <DropZone
                dragging={dragging}
                onClick={() => void pickSourcesViaDialog('models')}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
                    void addFiles(event.dataTransfer.files)
                  }
                }}
              >
                <span className="ui-drop-icon">＋</span>
                <strong>Add OBJ, FBX, Mine-imator, Blockbench, or Minecraft</strong>
                <small>{supportedFormatsHint()} (+ companions)</small>
              </DropZone>
              <SwitchRow
                label="3D outer layer"
                hint="Extrude overlay pixels (hair, jacket, sleeves) like 3D Skin Layers"
                checked={outer3d}
                onChange={(value) => {
                  recordBeforeChange()
                  setOuter3d(value)
                }}
              />
              <SwitchRow
                label="Smooth pose joints"
                hint="Blend and fill elbows, knees and waist after convert so posed skins don’t split"
                checked={smoothJoints}
                onChange={(value) => {
                  recordBeforeChange()
                  setSmoothJoints(value)
                }}
              />
              <div className="source-actions">
                <Button type="button" variant="soft" onClick={() => void pickSourcesViaDialog('models')}>
                  Add models
                </Button>
              </div>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                multiple
                accept={acceptAttribute()}
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files, 'models')
                  event.target.value = ''
                }}
              />
              <input
                ref={skinInput}
                className="visually-hidden"
                type="file"
                accept=".png,.miobject,image/png,application/json"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files, 'skins')
                  event.target.value = ''
                }}
              />

              <ObjectTabStrip
                parts={parts}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                onRemove={removePart}
                onAdd={() => void pickSourcesViaDialog('models')}
              />

              {parts.length > 0 && (
                <ul className="source-object-list" aria-label="Loaded objects">
                  {parts.map((part) => (
                    <li key={part.id} className={selectedId === part.id ? 'active' : ''}>
                      <button type="button" className="source-object-select" onClick={() => setSelectedId(part.id)}>
                        <span className={`part-kind ${part.kind}`}>{partKindLabel(part)}</span>
                        <span className="source-object-name" title={part.name}>{part.name}</span>
                      </button>
                      <button
                        type="button"
                        className="source-object-remove"
                        title={`Remove ${part.name}`}
                        aria-label={`Remove ${part.name}`}
                        onClick={() => removePart(part.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selected && (
                <div className="part-toolbar">
                  <Button type="button" variant="soft" color="gray" size="1" onClick={duplicateSelected}>
                    Duplicate
                  </Button>
                  <Button type="button" variant="soft" color="red" size="1" onClick={removeSelected}>
                    Remove selected
                  </Button>
                  {parts.length > 1 && (
                    <Button type="button" variant="soft" color="red" size="1" onClick={removeAllParts}>
                      Remove all
                    </Button>
                  )}
                </div>
              )}

              {selected && (
                <div className="size-preset-heading object-settings-heading">
                  <strong>Object · {selected.name}</strong>
                  <span>Companions and source options for this tab</span>
                </div>
              )}

              {selected?.kind === 'obj' && (
                <div className="companion-panel">
                  <div className="size-preset-heading">
                    <strong>Companions</strong>
                    <span>
                      {selected.sourceLabel?.includes('needs ')
                        ? 'Attach the .mimodel (and optional texture) for this Mine-imator object'
                        : 'Auto-found files stay listed here — change or remove any of them'}
                    </span>
                  </div>
                  {(selected.attachedMimodelName
                    || selected.expectedTextureNames.some((n) => isMimodelFileName(n))
                    || selected.sourceLabel?.includes('needs ')) && (() => {
                    const modelName =
                      selected.attachedMimodelName
                      ?? selected.expectedTextureNames.find((n) => isMimodelFileName(n))
                      ?? 'model.mimodel'
                    const attached = Boolean(selected.attachedMimodelName && selected.mimodelBytes)
                    return (
                      <div className={`companion-row ${attached ? 'ready' : 'missing'}`}>
                        <span>
                          <b>Model</b>
                          <small>{modelName}</small>
                        </span>
                        <div className="companion-row-actions">
                          <em>{attached ? 'Attached' : 'Needed'}</em>
                          <Button type="button" size="1" variant="soft" color="gray" onClick={() => void changeCompanion('mimodel')}>
                            {attached ? 'Change' : 'Add'}
                          </Button>
                          {attached && (
                            <Button type="button" size="1" variant="ghost" color="red" onClick={() => removeCompanion('mimodel')}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  {(selected.mtlBytes || selected.expectedMtlFileName || selected.mtlFileName) && (
                    <div className={`companion-row ${selected.mtlBytes ? 'ready' : selected.expectedMtlFileName ? 'missing' : ''}`}>
                      <span>
                        <b>.mtl</b>
                        <small>
                          {selected.mtlFileName
                            ?? selected.expectedMtlFileName
                            ?? 'materials.mtl'}
                        </small>
                      </span>
                      <div className="companion-row-actions">
                        <em>{selected.mtlBytes ? 'Attached' : selected.expectedMtlFileName ? 'Needed' : '—'}</em>
                        <Button type="button" size="1" variant="soft" color="gray" onClick={() => void changeCompanion('mtl')}>
                          {selected.mtlBytes ? 'Change' : 'Add'}
                        </Button>
                        {selected.mtlBytes && (
                          <Button type="button" size="1" variant="ghost" color="red" onClick={() => removeCompanion('mtl')}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {(() => {
                    const attachedKeys = Object.keys(selected.textures)
                    const expectedImages = selected.expectedTextureNames.filter(
                      (n) => !isMimodelFileName(n) && isRasterTextureName(n),
                    )
                    // Mesh with no named map still needs a way to attach a late texture.
                    if (attachedKeys.length === 0 && expectedImages.length === 0) {
                      if (!(selected.mayaBytes || selected.daeBytes || selected.fbxBytes || selected.expectedMtlFileName)) return null
                    }
                    const seen = new Set<string>()
                    const uniqueNames = (names: string[]) => {
                      const out: string[] = []
                      for (const raw of names) {
                        const display = repairMojibake(basename(raw)).normalize('NFC')
                        const fold = foldExportName(display)
                        if (seen.has(fold)) continue
                        seen.add(fold)
                        out.push(display)
                      }
                      return out
                    }
                    const rows =
                      attachedKeys.length > 0
                        ? uniqueNames(attachedKeys).map((name) => ({ name, attached: true }))
                        : expectedImages.length > 0
                          ? uniqueNames(expectedImages).map((name) => ({
                              name,
                              attached: false,
                            }))
                          : [{ name: 'texture', attached: false }]
                    return rows.map(({ name, attached }) => (
                      <div key={name} className={`companion-row ${attached ? 'ready' : 'missing'}`}>
                        <span>
                          <b>Texture</b>
                          <small title={name}>{name}</small>
                        </span>
                        <div className="companion-row-actions">
                          <em>{attached ? 'Attached' : 'Needed'}</em>
                          <Button type="button" size="1" variant="soft" color="gray" onClick={() => void changeCompanion('texture', name)}>
                            {attached ? 'Change' : 'Add'}
                          </Button>
                          {attached && (
                            <Button type="button" size="1" variant="ghost" color="red" onClick={() => removeCompanion('texture', name)}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  })()}
                  <Button
                    type="button"
                    variant="surface"
                    size="3"
                    className="ui-export"
                    onClick={() => void pickSourcesViaDialog('companions')}
                  >
                    <span className="ui-export-copy">
                      <Text size="2" weight="medium">Add companions</Text>
                      <Text size="1">.mtl / .mimodel / textures — or drop a folder</Text>
                    </span>
                    <Text size="3" weight="bold">＋</Text>
                  </Button>
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    size="2"
                    onClick={() => void pickCompanionFolder()}
                  >
                    Add texture folder
                  </Button>
                  <input
                    ref={companionInput}
                    className="visually-hidden"
                    type="file"
                    multiple
                    accept=".mtl,.mimodel,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tga,.tif,.tiff,image/*,application/json"
                    onChange={(event) => {
                      if (event.target.files) void attachCompanions(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </div>
              )}

              {selected?.kind === 'skin' && (selected.miobjectBytes || selected.expectedTextureNames.length > 0) && (
                <div className="companion-panel">
                  <div className="size-preset-heading">
                    <strong>Mine-imator character</strong>
                    <span>
                      {selected.bytes.length === 0
                        ? 'Needs a skin PNG before Build'
                        : 'Skin auto-found or attached — change or remove it here'}
                    </span>
                  </div>
                  {(selected.expectedTextureNames.length > 0
                    ? selected.expectedTextureNames
                    : [selected.fileName || 'skin.png']
                  ).map((name) => {
                    const attached = selected.bytes.length > 0
                    return (
                      <div key={name} className={`companion-row ${attached ? 'ready' : 'missing'}`}>
                        <span>
                          <b>Skin</b>
                          <small>{attached ? selected.fileName || name : name}</small>
                        </span>
                        <div className="companion-row-actions">
                          <em>{attached ? 'Attached' : 'Needed'}</em>
                          <Button type="button" size="1" variant="soft" color="gray" onClick={() => void changeCompanion('skin')}>
                            {attached ? 'Change' : 'Add'}
                          </Button>
                          {attached && (
                            <Button type="button" size="1" variant="ghost" color="red" onClick={() => removeCompanion('skin')}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <Button
                    type="button"
                    variant="surface"
                    size="3"
                    className="ui-export"
                    onClick={() => void pickSourcesViaDialog('companions')}
                  >
                    <span className="ui-export-copy">
                      <Text size="2" weight="medium">Add skin PNG</Text>
                      <Text size="1">Same folder as the .miobject export</Text>
                    </span>
                    <Text size="3" weight="bold">＋</Text>
                  </Button>
                  <input
                    ref={companionInput}
                    className="visually-hidden"
                    type="file"
                    accept=".png,image/png"
                    onChange={(event) => {
                      if (event.target.files) void attachCompanions(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </div>
              )}

              {selected?.kind === 'skin' && (
                <CapeField
                  capeBytes={selected.capeBytes}
                  capeId={selected.capeId}
                  capeFileName={selected.capeFileName}
                  onAdd={() => setCapePickerOpen(true)}
                  onRemove={removeCapeFromSelected}
                />
              )}

              </div>

              {parts.length > 0 && (() => {
                const needsSkin = parts.some((part) => part.kind === 'skin' && part.bytes.length === 0)
                const needsCompanion = parts.some((part) => part.sourceLabel?.includes('needs '))
                const needsTexture = parts.some(
                  (part) =>
                    Boolean(part.mimodelBytes)
                    && Object.keys(part.textures).length === 0
                    && part.expectedTextureNames.some((name) => isRasterTextureName(name)),
                )
                const incomplete = needsSkin || needsCompanion || needsTexture
                return (
                  <div className="sources-panel-footer">
                  <ExportButton
                    title={incomplete ? 'Continue anyway' : 'Continue to Build'}
                    detail={
                      needsSkin
                        ? 'This character still needs its skin PNG'
                        : needsCompanion || needsTexture
                          ? 'Missing .mimodel / texture — you can continue and attach later'
                          : 'Preview, size, materials & convert — one place'
                    }
                    primary
                    disabled={false}
                    onClick={() => {
                      setStep('build')
                      if (incomplete) {
                        setStatus('Continued without all companions — attach textures for coloured voxels')
                      }
                    }}
                  />
                  </div>
                )
              })()}
            </div>
          )}

          {step === 'build' && !selected && parts.length > 0 && (
            <>
              <PanelTitle step="02" title="Build" />
              <p className="panel-lead">Select an object tab to edit size and convert.</p>
              <ObjectTabStrip
                parts={parts}
                selectedId={null}
                onSelect={setSelectedId}
                onRemove={removePart}
                onAdd={() => void pickSourcesViaDialog('models')}
              />
            </>
          )}

          {step === 'build' && selected && (
            <>
              <PanelTitle step="02" title="Build" />
              <p className="panel-lead">
                All objects stay in one scene. Each tab has its own size and placement.
              </p>

              <ObjectTabStrip
                parts={parts}
                selectedId={selected.id}
                onSelect={setSelectedId}
                onRemove={removePart}
                onAdd={() => void pickSourcesViaDialog('models')}
              />

              <div className="part-toolbar">
                <Button type="button" variant="soft" color="gray" size="1" onClick={duplicateSelected}>
                  Duplicate
                </Button>
                <Button type="button" variant="soft" color="red" size="1" onClick={removeSelected}>
                  Remove selected
                </Button>
                {parts.length > 1 && (
                  <Button type="button" variant="soft" color="red" size="1" onClick={removeAllParts}>
                    Remove all
                  </Button>
                )}
              </div>

              <div className="size-preset-heading object-settings-heading">
                <strong>Settings · {selected.name}</strong>
                <span>Size, hollow, and placement for this object only</span>
              </div>

              {selected.kind === 'obj' ? (
                <>
                  <div className="size-preset-heading">
                    <strong>Block size</strong>
                    <span>Presets, Auto max for large models, or Custom</span>
                  </div>
                  <PresetCards
                    value={customOpen ? 'custom' : objPreset}
                    onChange={(id) => applyObjPreset(id as typeof objPreset)}
                    options={OBJ_SIZE_PRESETS.map((preset) => ({
                      value: preset.id,
                      label: preset.label,
                      detail:
                        preset.id === 'auto'
                          ? preset.hint
                          : preset.blocks
                            ? `${preset.blocks} blocks`
                            : preset.hint,
                    }))}
                  />
                  <div className="size-readout">
                    Target box: <b>{describePartSize(selected)}</b>
                    {objPreset === 'auto' ? <span> · Auto max</span> : null}
                  </div>
                  {customOpen && (
                    <div className="custom-size-panel">
                      <div className="size-preset-heading">
                        <strong>Custom blocks</strong>
                        <span>Width · Height · Length in Minecraft blocks</span>
                      </div>
                      <CheckRow
                        checked={customUniformFit}
                        onChange={(on) => {
                          setCustomUniformFit(on)
                          if (on) {
                            applyCustomUniformSize(
                              Math.max(selected.width, selected.height, selected.length),
                            )
                          } else {
                            recordBeforeChange()
                            setParts((current) =>
                              current.map((part) =>
                                part.id === selected.id
                                  ? { ...part, fit: 'stretch', objSizePreset: 'custom' }
                                  : part,
                              ),
                            )
                            setResult(null)
                          }
                        }}
                      >
                        Scale together (one size for the longest side)
                      </CheckRow>
                      {customUniformFit ? (
                        <>
                          <AxisSlider
                            label="Size"
                            value={Math.max(selected.width, selected.height, selected.length)}
                            min={1}
                            max={MC_WORLD_HEIGHT}
                            onChange={(value) => applyCustomUniformSize(value)}
                            onEditEnd={endCoalesce}
                          />
                          <NumberField
                            label="Longest side (blocks)"
                            value={Math.max(selected.width, selected.height, selected.length)}
                            min={1}
                            onChange={(value) => applyCustomUniformSize(value)}
                            onEditEnd={endCoalesce}
                          />
                          <small className="field-hint">
                            Model keeps its shape. Height cannot exceed {MC_WORLD_HEIGHT}. Empty space is not stored; a solid statue that is too huge will error instead of closing the app.
                          </small>
                        </>
                      ) : (
                        <>
                          <div className="two-fields">
                            <NumberField
                              label="Width (X)"
                              value={selected.width}
                              min={1}
                              onChange={(value) => applyCustomAxis('width', value)}
                              onEditEnd={endCoalesce}
                            />
                            <NumberField
                              label="Height (Y)"
                              value={selected.height}
                              min={1}
                              max={MC_WORLD_HEIGHT}
                              onChange={(value) => applyCustomAxis('height', value)}
                              onEditEnd={endCoalesce}
                            />
                          </div>
                          <NumberField
                            label="Length (Z)"
                            value={selected.length}
                            min={1}
                            onChange={(value) => applyCustomAxis('length', value)}
                            onEditEnd={endCoalesce}
                          />
                          <small className="field-hint">
                            Each axis is set on its own (stretch). Height max {MC_WORLD_HEIGHT}.
                          </small>
                        </>
                      )}
                    </div>
                  )}
                  {selected.kind === 'obj' && !customOpen && (
                    <SelectField
                      label="Fit mode"
                      value={selected.fit}
                      onChange={(value) => updateSelected('fit', value as VoxelFit)}
                      options={[
                        ['fit', 'Keep proportions (fit in box)'],
                        ['stretch', 'Stretch to fill box'],
                      ]}
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="size-preset-heading">
                    <strong>Statue size</strong>
                    <span>Multiples of the native Minecraft skin proportions</span>
                  </div>
                  <PresetCards
                    value={customOpen ? 'custom' : skinPreset}
                    onChange={(id) => applySkinPreset(id as typeof skinPreset)}
                    options={SKIN_SIZE_PRESETS.map((preset) => ({
                      value: preset.id,
                      label: preset.label,
                      detail: preset.hint,
                    }))}
                  />
                  <div className="size-readout">
                    Statue size: <b>{describePartSize(selected)}</b>
                  </div>
                  {customOpen && (
                    <div className="custom-size-panel">
                      <div className="size-preset-heading">
                        <strong>Custom blocks</strong>
                        <span>Width · Height · Length in Minecraft blocks</span>
                      </div>
                      <CheckRow
                        checked={customUniformFit}
                        onChange={(on) => {
                          setCustomUniformFit(on)
                          if (on) {
                            recordBeforeChange()
                            setParts((current) =>
                              current.map((part) =>
                                part.id === selected.id
                                  ? applySkinLinkedAxis(part, 'height', part.height)
                                  : part,
                              ),
                            )
                            setResult(null)
                          }
                        }}
                      >
                        Scale together (keep player proportions)
                      </CheckRow>
                      {customUniformFit && (
                        <AxisSlider
                          label="Height"
                          value={selected.height}
                          min={1}
                          max={MC_WORLD_HEIGHT}
                          onChange={(value) => applySkinCustomAxis('height', value)}
                          onEditEnd={endCoalesce}
                        />
                      )}
                      <div className="two-fields">
                        <NumberField
                          label="Width (X)"
                          value={selected.width}
                          min={1}
                          onChange={(value) => applySkinCustomAxis('width', value)}
                          onEditEnd={endCoalesce}
                        />
                        <NumberField
                          label="Height (Y)"
                          value={selected.height}
                          min={1}
                          max={MC_WORLD_HEIGHT}
                          onChange={(value) => applySkinCustomAxis('height', value)}
                          onEditEnd={endCoalesce}
                        />
                      </div>
                      <NumberField
                        label="Length (Z)"
                        value={selected.length}
                        min={1}
                        onChange={(value) => applySkinCustomAxis('length', value)}
                        onEditEnd={endCoalesce}
                      />
                      <small className="field-hint">
                        {customUniformFit
                          ? `Native ${nativeBoxForSkin(selected).width}×${nativeBoxForSkin(selected).height}×${nativeBoxForSkin(selected).length} · drag height up to ${MC_WORLD_HEIGHT}; the others follow.`
                          : `Each axis is set on its own. Height max ${MC_WORLD_HEIGHT} (Minecraft world).`}
                      </small>
                    </div>
                  )}
                  {selected.skinLimbs !== 'skeleton' && (
                    <div className="arm-style">
                      <div className="size-preset-heading">
                        <strong>Arm model</strong>
                        <span>Classic 4px (Steve) · Slim 3px (Alex). Detected from the PNG; change here if needed.</span>
                      </div>
                      <Segmented
                        value={selected.slimArms ? 'slim' : 'classic'}
                        onChange={(next) => {
                          const slim = next === 'slim'
                          if (selected.slimArms === slim) return
                          recordBeforeChange()
                          setParts((current) =>
                            current.map((part) =>
                              part.id === selected.id ? applySkinArmStyle(part, slim) : part,
                            ),
                          )
                          setResult(null)
                        }}
                        options={[
                          { value: 'classic', label: 'Classic 4px' },
                          { value: 'slim', label: 'Slim 3px' },
                        ]}
                      />
                    </div>
                  )}
                </>
              )}
              {selected.kind === 'skin' && (
                <CapeField
                  capeBytes={selected.capeBytes}
                  capeId={selected.capeId}
                  capeFileName={selected.capeFileName}
                  onAdd={() => setCapePickerOpen(true)}
                  onRemove={removeCapeFromSelected}
                />
              )}
              <CheckRow
                checked={selected.hollow}
                onChange={(checked) => updateSelected('hollow', checked)}
              >
                Hollow shell only
              </CheckRow>

              {sceneObjects.length > 1 && (
                <SceneObjectFilter
                  objects={sceneObjects}
                  excluded={excludedObjectsOf(selected)}
                  suggested={suggestedStudioProps(selected.bytes)}
                  onChange={setExcludedObjects}
                />
              )}

              <div className="panel-divider" />
              <PanelTitle step="03" title="Placement" />
              <p className="panel-lead">Block-space position and rotation for this object in the shared scene.</p>
              <div className="two-fields">
                <NumberField
                  label="Pos X"
                  value={selected.positionX}
                  min={-256}
                  max={256}
                  onChange={(value) => updateSelected('positionX', value)}
                />
                <NumberField
                  label="Pos Y"
                  value={selected.positionY}
                  min={-256}
                  max={256}
                  onChange={(value) => updateSelected('positionY', value)}
                />
              </div>
              <NumberField
                label="Pos Z"
                value={selected.positionZ}
                min={-256}
                max={256}
                onChange={(value) => updateSelected('positionZ', value)}
              />
              <div className="two-fields">
                <NumberField
                  label="Rot X °"
                  value={selected.rotationX ?? 0}
                  min={-360}
                  max={360}
                  onChange={(value) => updateSelected('rotationX', value)}
                />
                <NumberField
                  label="Rot Y °"
                  value={selected.rotationY ?? 0}
                  min={-360}
                  max={360}
                  onChange={(value) => updateSelected('rotationY', value)}
                />
              </div>
              <NumberField
                label="Rot Z °"
                value={selected.rotationZ ?? 0}
                min={-360}
                max={360}
                onChange={(value) => updateSelected('rotationZ', value)}
              />

              {selected.kind === 'obj' && (
                <>
                  <div className="panel-divider" />
                  <PanelTitle step="03b" title="Texture UV" />
                  <p className="panel-lead">
                    Shift, scale, or flip the atlas on this mesh. Skins use Minecraft UV and
                    ignore this. Convert again to apply.
                  </p>
                  <div className="two-fields">
                    <RangeField
                      label="Offset U %"
                      value={Math.round(resolveModelUv(selected.uv).offsetU * 100)}
                      min={-100}
                      max={100}
                      onChange={(value) => updateUv('offsetU', value / 100)}
                      onEditEnd={commitUvTune}
                    />
                    <RangeField
                      label="Offset V %"
                      value={Math.round(resolveModelUv(selected.uv).offsetV * 100)}
                      min={-100}
                      max={100}
                      onChange={(value) => updateUv('offsetV', value / 100)}
                      onEditEnd={commitUvTune}
                    />
                  </div>
                  <div className="two-fields">
                    <AxisSlider
                      label="Scale U"
                      value={resolveModelUv(selected.uv).scaleU}
                      min={0.25}
                      max={4}
                      step={0.05}
                      decimals={2}
                      onChange={(value) => updateUv('scaleU', value)}
                      onEditEnd={commitUvTune}
                    />
                    <AxisSlider
                      label="Scale V"
                      value={resolveModelUv(selected.uv).scaleV}
                      min={0.25}
                      max={4}
                      step={0.05}
                      decimals={2}
                      onChange={(value) => updateUv('scaleV', value)}
                      onEditEnd={commitUvTune}
                    />
                  </div>
                  <RangeField
                    label="Rotate °"
                    value={Math.round(resolveModelUv(selected.uv).rotation)}
                    min={-180}
                    max={180}
                    onChange={(value) => updateUv('rotation', value)}
                    onEditEnd={commitUvTune}
                  />
                  <CheckRow
                    checked={resolveModelUv(selected.uv).flipU}
                    onChange={(on) => updateUv('flipU', on, true)}
                  >
                    Flip U
                  </CheckRow>
                  <CheckRow
                    checked={resolveModelUv(selected.uv).flipV}
                    onChange={(on) => updateUv('flipV', on, true)}
                  >
                    Flip V
                  </CheckRow>
                  <SelectField
                    label="Wrap"
                    value={resolveModelUv(selected.uv).wrap}
                    onChange={(value) => updateUv('wrap', value as UvWrap, true)}
                    options={[
                      ['clamp', 'Clamp (default)'],
                      ['repeat', 'Repeat'],
                    ]}
                  />
                </>
              )}

              {selected && partSupportsPoseEditing(selected) && (
                <SkinPoseEditor
                  part={selected}
                  selectedLimb={selectedLimb}
                  freeBend={freeBend}
                  onFreeBendChange={(value) => {
                    recordBeforeChange()
                    setFreeBend(value)
                  }}
                  onSelectLimb={setSelectedLimb}
                  ensurePose={(p) =>
                    partUsesMeshBones(p)
                      ? (ensureMeshBonePose(
                          p.meshBonePose as MeshBonePose | null | undefined,
                          rigOfPart(p),
                        ) as unknown as NonNullable<ScenePartLocal['skinPose']>)
                      : ensureSkinPose(p)
                  }
                  onChangePose={updateSkinPosePart}
                  onResetLimb={resetSkinPoseLimb}
                  onResetAll={resetSkinPoseAll}
                  onEditEnd={endCoalesce}
                  onChangeSkinMode={(mode) => {
                    recordBeforeChange()
                    updateSelected('meshSkinMode', mode)
                    // Stretch needs the bone rig; classic cube posing is already rigid.
                    if (mode === 'stretch' && !partUsesMeshBones(selected)) {
                      updateSelected('meshRigMode', selected.kind === 'skin' ? 'humanoid' : 'auto')
                    }
                  }}
                  onChangeRigMode={(mode) => {
                    recordBeforeChange()
                    const partId = selected.id
                    const wasBones = partUsesMeshBones(selected)
                    const nextBones = isMeshBoneRigMode(mode)
                    updateSelected('meshRigMode', mode === 'classic' ? 'classic' : mode)
                    // Mine-imator classic pose is baked into the OBJ; bone mode
                    // needs the rest mesh so LBS / bake start from bind pose.
                    if (selected.mimodelBytes?.length && wasBones !== nextBones) {
                      if (nextBones) {
                        void rebuildMimodelPreview(
                          partId,
                          createRestSkinPose(selected.slimArms) as NonNullable<
                            ScenePartLocal['skinPose']
                          >,
                        )
                      } else if (selected.skinPose) {
                        void rebuildMimodelPreview(partId, ensureSkinPose(selected))
                      }
                    }
                    if (nextBones) {
                      const rig = rigOfPart({ ...selected, meshRigMode: mode })
                      const ids = (rig?.bones ?? []).map((bone) => bone.id)
                      if (ids.length > 0 && !ids.includes(selectedLimb)) {
                        setSelectedLimb(ids.find((id) => id !== 'root') ?? ids[0]!)
                      }
                    } else if (selected.kind === 'skin') {
                      setSelectedLimb('right_arm')
                    }
                  }}
                />
              )}

              <div className="panel-divider" />
              <PanelTitle step="04" title="Scene materials" />
              <p className="panel-lead">
                Shared for the whole scene after all objects are merged.
              </p>
              <SelectField
                label="Colour matching"
                value={shared.colourMatching}
                onChange={(value) =>
                  updateShared('colourMatching', value as ColourMatching)
                }
                options={[
                  ['structureLabSmooth', 'StructureLab smooth (Oklab, default)'],
                  ['structureLabMix', 'StructureLab perceptual mix (large statues)'],
                  ['hueAwareLab', 'StructureLab hue-aware (small / detailed)'],
                  ['oklabHueGuard', 'Oklab + hue guard'],
                  ['ciede2000', 'CIEDE2000'],
                  ['rebaneMapartClassic', 'MapartCraft (map-item colours — not recommended)'],
                ]}
              />
              <div className="field-hint">
                <p>
                  Every method below matches real cube textures (wool, dirt, terracotta, …), not
                  Minecraft map-item shades. MapartCraft is listed only if you explicitly want
                  that map-art metric.
                </p>
                <ul className="field-hint-list">
                  <li>
                    <strong>Smooth</strong> — dithers the two nearest Oklab cubes (3D grain, no
                    error diffusion). Eyes stay a single cube. Not the old Facescan.
                  </li>
                  <li>
                    <strong>Perceptual mix</strong> — averages neighbouring cubes so the build can
                    show in-between tones (Bayer mix + a little error diffusion)
                  </li>
                  <li>
                    <strong>Hue-aware</strong> — Lab plus hue so the nearest colour wins, not a
                    neighbour dye in Lab space
                  </li>
                  <li>
                    <strong>Oklab + hue guard</strong> — keeps more colour on sparse packs
                  </li>
                  <li>
                    <strong>CIEDE2000</strong> — later CIE Lab formula
                  </li>
                  <li>
                    <strong>MapartCraft</strong> — the map-art metric; often worse on 3D models
                  </li>
                </ul>
              </div>
              <SelectField
                label="Dithering"
                value={ownsDithering ? 'none' : shared.dither}
                disabled={ownsDithering}
                onChange={(value) => updateShared('dither', value as DitherMode)}
                options={[
                  ['none', 'None (default)'],
                  ['floydSteinberg', 'Floyd–Steinberg'],
                  ['atkinson', 'Atkinson'],
                  ['ordered', 'Ordered 4×4'],
                ]}
              />
              <div className="field-hint">
                {ownsDithering ? (
                  <p>
                    Off while{' '}
                    <strong>
                      {shared.colourMatching === 'structureLabMix'
                        ? 'perceptual mix'
                        : 'smooth'}
                    </strong>{' '}
                    is selected
                    {shared.colourMatching === 'structureLabMix'
                      ? ' — that mode has its own dithering.'
                      : ' — two-cube Oklab mix with 3D grain; eyes stay a single cube.'}
                  </p>
                ) : (
                  <ul className="field-hint-list">
                    <li>
                      <strong>None</strong> — one nearest block per voxel (default)
                    </li>
                    <li>
                      <strong>Floyd–Steinberg</strong> — MapartCraft-style error diffusion per layer
                    </li>
                    <li>
                      <strong>Atkinson</strong> — quieter
                    </li>
                    <li>
                      <strong>Ordered</strong> — patterned Bayer
                    </li>
                  </ul>
                )}
              </div>
              <div className="panel-divider" />
              <PanelTitle step="05" title="Colour tuning" />
              <p className="panel-lead">
                Applied to voxel colours before matching. 0 is the original mesh.
              </p>
              <RangeField
                label="Hue"
                value={shared.hue}
                min={-180}
                max={180}
                onChange={(value) => updateSharedTune('hue', value)}
                onEditEnd={commitSharedTune}
              />
              <RangeField
                label="Brightness"
                value={shared.brightness}
                min={-100}
                max={100}
                onChange={(value) => updateSharedTune('brightness', value)}
                onEditEnd={commitSharedTune}
              />
              <RangeField
                label="Contrast"
                value={shared.contrast}
                min={-100}
                max={100}
                onChange={(value) => updateSharedTune('contrast', value)}
                onEditEnd={commitSharedTune}
              />
              <RangeField
                label="Saturation"
                value={shared.saturation}
                min={-100}
                max={100}
                onChange={(value) => updateSharedTune('saturation', value)}
                onEditEnd={commitSharedTune}
              />
              <div className="size-preset-heading">
                <strong>Gravity support</strong>
                <span>Off by default — statues are solid cubes, not map-art carpets</span>
              </div>
              <PresetCards
                columns="1"
                value={shared.supportMode}
                onChange={(mode) => updateShared('supportMode', mode as GravitySupportMode)}
                options={[
                  { value: 'off', label: 'Off', detail: 'Place sand / powder / carpets as-is' },
                  { value: 'matchColor', label: 'Match colour', detail: 'Solid block closest to that colour' },
                  { value: 'fixed', label: 'Fixed block', detail: 'Always the same support block' },
                ]}
              />
              {shared.supportMode === 'fixed' && (
                <SelectField
                  label="Support block"
                  value={shared.supportBlock}
                  onChange={(value) => updateShared('supportBlock', value)}
                  options={supportChoices.map((choice) => [choice.state, choice.name])}
                />
              )}
              {shared.supportMode === 'matchColor' && (
                <small className="field-hint">
                  Under each gravity block, places the closest solid (non-falling) block of a similar colour.
                </small>
              )}
              {shared.supportMode === 'off' && (
                <small className="field-hint">
                  Gravity blocks export exactly as chosen — they may fall in-game without a floor.
                </small>
              )}
              <div className="size-preset-heading">
                <strong>Block pack presets</strong>
                <span>Wool, concrete, stone, or every placeable cube</span>
              </div>
              <PresetCards
                value={activePreset}
                onChange={(id) => applyPreset(id as StatueMaterialPreset)}
                options={MATERIAL_PRESETS.map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                  detail: preset.hint,
                }))}
              />
              {activePreset === 'custom' && (
                <small className="field-hint">Custom mix — individual cubes differ from a pack preset.</small>
              )}
              <Button
                className="ui-export"
                variant="outline"
                size="3"
                disabled={!palette}
                onClick={() => setPaletteOpen(true)}
              >
                <span className="ui-export-copy">
                  <Text size="2" weight="medium">Browse statue blocks</Text>
                  <Text size="1">Turn cubes on or off, or replace a block after convert</Text>
                </span>
                <Text size="4">›</Text>
              </Button>
              {result && usedBlocks.length > 0 && (
                <>
                  <div className="material-heading">
                    <strong>Blocks in this build</strong>
                    <span>{visibleUsedBlocks.length} of {usedBlocks.length}</span>
                  </div>
                  <p className="field-hint">
                    Click a block to change it. Ordered by how many voxels use it.
                  </p>
                  {renderUsedBlocksList('No used blocks match this filter.')}
                </>
              )}

              <div className="build-primary-actions">
                <ExportButton
                  title={
                    placementDirty
                      ? 'Convert again (placement changed)'
                      : result
                        ? 'Convert again'
                        : 'Convert to voxels'
                  }
                  detail={`${parts.length} part${parts.length === 1 ? '' : 's'} · ${selected ? describePartSize(selected) : ''}`}
                  primary={!result}
                  disabled={busy || parts.length === 0}
                  onClick={() => void runVoxelize()}
                />
                {result && (
                  <ExportButton
                    title="Continue to Export"
                    detail={`${result.occupiedVoxels.toLocaleString()} voxels ready`}
                    primary
                    disabled={false}
                    onClick={() => setStep('export')}
                  />
                )}
              </div>
            </>
          )}

          {step === 'export' && (
            <>
              <PanelTitle step="06" title="Export" />
              {parts.length > 0 && (
                <ObjectTabStrip
                  parts={parts}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  onRemove={removePart}
                />
              )}
              {parts.length > 0 && (
                <div className="part-toolbar">
                  <Button type="button" variant="soft" color="red" size="1" onClick={removeSelected} disabled={!selected}>
                    Remove selected
                  </Button>
                  {parts.length > 1 && (
                    <Button type="button" variant="soft" color="red" size="1" onClick={removeAllParts}>
                      Remove all
                    </Button>
                  )}
                </div>
              )}
              <p className="panel-lead">
                {placementDirty
                  ? 'You moved a part in the viewer. Convert again (or export — it will reconvert) so the file matches.'
                  : 'Your voxel build is ready. Block swaps update the preview here automatically.'}
              </p>
              {placementDirty && (
                <ExportButton
                  title="Convert again"
                  detail="Bake new placement into the build"
                  primary
                  disabled={busy}
                  onClick={() => void runVoxelize()}
                />
              )}
              <Button type="button" variant="ghost" color="gray" onClick={() => setStep('build')}>
                ← Adjust build settings
              </Button>
              <Button
                type="button"
                variant="ghost"
                color="gray"
                onClick={() => {
                  revealSourcePreview()
                  setStep('build')
                }}
              >
                ← View original mesh
              </Button>
              {result?.build.minecraftVersion ? (
                <p className="export-version-note">
                  Saves for Minecraft {result.build.minecraftVersion}
                  {result.build.dataVersion != null ? ` · data ${result.build.dataVersion}` : ''}
                </p>
              ) : null}
              {([
                ['all', 'All formats bundle', '.zip · recommended', true],
                ['vanillaNbt', 'Vanilla structure', '.nbt', false],
                ['vanillaSplit', 'Vanilla structure pieces', '.zip · Structure Block safe', false],
                [
                  litematicExportFormat(result?.build.dataVersion ?? 0),
                  'Litematica',
                  `.litematic · v${litematicSchematicVersion(result?.build.dataVersion ?? 0)}`,
                  false,
                ],
                ['spongeV3', 'WorldEdit / FAWE', '.schem · Sponge v3', false],
              ] as [ExportFormat, string, string, boolean][]).map(([format, title, detail, primary]) => (
                <ExportButton
                  key={format}
                  title={title}
                  detail={detail}
                  primary={primary}
                  disabled={!result || busy}
                  onClick={() => void exportWithPlacement(format)}
                />
              ))}
            </>
          )}
        </aside>

        <section className="preview-stage">
          <div className="preview-toolbar">
            <div className="preview-toolbar-copy">
              <h1>
                {viewportMode === 'voxels'
                  ? 'Voxel preview'
                  : viewportMode === 'mesh'
                    ? 'Source preview'
                    : '3D viewport'}
              </h1>
              <p>
                {viewportMode === 'voxels'
                  ? model3dNavigation === 'free'
                    ? 'Free movement · click to look · WASD move · scroll to change speed · Space/Shift up-down · Esc unlock'
                    : previewStyle === 'textures'
                      ? 'In-game block face textures from your chosen materials'
                      : 'Solid colours per chosen cube — not Minecraft map shades'
                  : viewportMode === 'mesh'
                    ? model3dNavigation === 'free'
                      ? 'Free movement · click to look · WASD move · scroll to change speed · Space/Shift up-down · Esc unlock'
                      : 'Original mesh / skin — drag to orbit · right-drag to pan · scroll to zoom · orbit pivot X/Y/Z'
                    : 'Add a source to begin'}
              </p>
            </div>
            <div className="preview-toolbar-controls">
              {(viewportMode === 'voxels' || viewportMode === 'mesh') && (
                <div className="preview-actions">
                  <Segmented
                    value={model3dNavigation}
                    onChange={setModel3dNavigation}
                    options={[
                      { value: 'orbit', label: 'Orbit', title: 'Orbit around the model' },
                      { value: 'free', label: 'Free', title: 'Walk / fly through the scene' },
                    ]}
                  />
                  {model3dNavigation === 'orbit' && (
                    <span className="preview-hint">Drag to orbit · right-drag pan · orbit pivot X/Y/Z</span>
                  )}
                  {model3dNavigation === 'free' && (
                    <span className="preview-hint">Click canvas · WASD · scroll speed · Space / Shift</span>
                  )}
                </div>
              )}
              {result && result.voxels.length > 0 && (step === 'build' || step === 'export') && (
                <div className="preview-actions">
                  <Segmented
                    value={showSourcePreview ? 'source' : 'voxels'}
                    onChange={(next) => {
                      if (next === 'source') revealSourcePreview()
                      else revealVoxelPreview()
                    }}
                    options={[
                      { value: 'source', label: 'Source' },
                      { value: 'voxels', label: 'Voxels' },
                    ]}
                  />
                </div>
              )}
              {viewportMode === 'voxels' && (
                <Segmented
                  value={previewStyle}
                  onChange={setPreviewStyle}
                  options={[
                    { value: 'materials', label: 'Editor' },
                    { value: 'textures', label: 'In-game' },
                  ]}
                />
              )}
              {viewportMode === 'mesh' && parts.length > 0 && step === 'sources' && (
                <Button type="button" onClick={() => setStep('build')}>
                  Build settings →
                </Button>
              )}
              {viewportMode === 'mesh' && parts.length > 0 && step === 'build' && result && (
                <Button
                  type="button"
                  onClick={() => revealVoxelPreview()}
                >
                  Show voxels →
                </Button>
              )}
            </div>
          </div>
          <div
            className={`canvas-frame voxel-frame ${viewportMode === 'empty' ? 'empty' : ''} ${
              viewportMode === 'mesh' ? 'mesh-opaque' : ''
            } ${viewportMode === 'voxels' && result ? 'preview-has-content' : ''}`}
            onWheel={(event) => {
              if ((viewportMode === 'voxels' || viewportMode === 'mesh') && model3dNavigation === 'free') {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            {viewportMode === 'voxels' && result ? (
              <Suspense fallback={<LoadOverlay label="Loading viewer…" indeterminate />}>
                <VoxelSceneViewer
                  key={`voxels-${textureCacheEpoch}`}
                  voxels={result.voxels}
                  size={result.size}
                  previewStyle={previewStyle}
                  navigationMode={model3dNavigation}
                  selectedPartIndex={selectedPartIndexOrNull}
                  onSelectPartIndex={(partIndex) => {
                    if (partIndex == null) {
                      setSelectedId(null)
                      return
                    }
                    const part = parts[partIndex]
                    if (part) setSelectedId(part.id)
                  }}
                  onTranslatePart={translatePart}
                  onTranslateStart={beginTranslateEdit}
                  onTranslateEnd={endCoalesce}
                  onMissingTextures={(blocks) => {
                    setTextureWarnings((prev) => {
                      if (blocks.length === 0) return prev
                      return [
                        ...new Set([...prev, ...blocks.map(blockTextureWarningLabel)]),
                      ].sort()
                    })
                  }}
                />
              </Suspense>
            ) : viewportMode === 'mesh' && meshPreviewParts.length > 0 ? (
              <Suspense fallback={<LoadOverlay label="Loading viewer…" indeterminate />}>
                <MeshPreviewViewer
                  parts={meshPreviewParts}
                  navigationMode={model3dNavigation}
                  freeBend={freeBend}
                  selectedId={selected?.id ?? null}
                  selectedLimbId={selected && partSupportsPoseEditing(selected) ? selectedLimb : null}
                  onSelectPartId={setSelectedId}
                  onSelectLimbId={setSelectedLimb}
                  onLimbPoseChange={updateSkinPoseVectors}
                  onPoseEditStart={beginPoseEdit}
                  onPoseEditEnd={endCoalesce}
                  onPosePivotChange={
                    selected && partUsesMeshBones(selected) ? undefined : setPosePivot
                  }
                  onPartPlacementChange={(position, rotation) => {
                    if (!selected) return
                    beginTranslateEdit()
                    setParts((current) =>
                      current.map((part) =>
                        part.id === selected.id
                          ? {
                              ...part,
                              positionX: position[0],
                              positionY: position[1],
                              positionZ: position[2],
                              rotationX: rotation[0],
                              rotationY: rotation[1],
                              rotationZ: rotation[2],
                            }
                          : part,
                      ),
                    )
                    setPlacementDirty(true)
                  }}
                  onProgress={onPreviewProgress}
                />
              </Suspense>
            ) : (
              <div className="empty-canvas">
                <h2>Start with a source file</h2>
                <p>
                  Drop an OBJ, glTF/GLB, FBX, COLLADA .dae, MagicaVoxel .vox, Mine-imator .miobject / .mimodel,
                  Blockbench .bbmodel, Maya .mb/.ma, or Minecraft skin.
                  Then use Build for size, materials, and convert — all in one place.
                </p>
                <Button onClick={() => void pickSourcesViaDialog('models')}>Add sources</Button>
              </div>
            )}
            {(busy || loadProgress) && (
              <LoadOverlay {...overlayFromProgress(loadProgress, 'Converting to voxels…')} />
            )}
          </div>
          {viewportMode === 'voxels' && result && (
            <div className="preview-footer">
              <span>{result.occupiedVoxels.toLocaleString()} voxels</span>
              <span>{result.build.width}×{result.build.height}×{result.build.length}</span>
              <span>{result.parts.length} parts</span>
            </div>
          )}
          {viewportMode === 'mesh' && selected && (
            <div className="preview-footer">
              <span>{selected.kind.toUpperCase()}</span>
              <span title={selected.name}>{selected.name}</span>
              <span>Not voxelized</span>
            </div>
          )}
        </section>

        <aside className="output-panel">
          <PanelTitle step="07" title="Build summary" />
          {result ? (
            <>
              <div className="summary-grid">
                <div className="summary-stat"><span>Size</span><b>{result.build.width}×{result.build.height}×{result.build.length}</b></div>
                <div className="summary-stat"><span>Voxels</span><b>{result.occupiedVoxels.toLocaleString()}</b></div>
                <div className="summary-stat"><span>Blocks</span><b>{totalBlockCount.toLocaleString()}</b></div>
                <div className="summary-stat"><span>Parts</span><b>{result.parts.length}</b></div>
              </div>
              {result.build.warnings.length > 0 ? (
                <CopyableNotice title="Build notes" body={result.build.warnings.join('\n')} />
              ) : null}
              <MissingTextureWarnings blocks={textureWarnings} />
              <div className="material-heading">
                <strong>Blocks in this build</strong>
                <span>{visibleUsedBlocks.length} types</span>
              </div>
              <p className="field-hint">
                Click a row to change that block. Same list as Scene materials.
              </p>
              {renderUsedBlocksList('No used blocks match this filter.')}
            </>
          ) : (
            <div className="summary-empty">
              {parts.length === 0
                ? 'Add a source, then open Build to size and convert.'
                : step === 'build'
                  ? 'Press “Convert to voxels” when your block size looks right.'
                  : 'Open Build to preview, set size, and convert — all in one tab.'}
            </div>
          )}
        </aside>
      </main>

      <AppDialog
        open={Boolean(paletteOpen && palette)}
        onOpenChange={(open) => {
          if (!open) setPaletteOpen(false)
        }}
        eyebrow="Materials"
        title="Statue blocks"
        description="Each row is one cube texture. Models do not group blocks by Minecraft map colour."
        tools={
          <>
            <SearchField
              placeholder="Search by block name or type…"
              value={paletteSearch}
              onChange={setPaletteSearch}
            />
            {MATERIAL_PRESETS.map((preset) => (
              <ChipButton
                key={preset.id}
                active={activePreset === preset.id}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </ChipButton>
            ))}
            {activePreset === 'custom' && (
              <ChipButton active disabled>
                Custom
              </ChipButton>
            )}
          </>
        }
      >
        <div className="map-color-list">
          {usedCubeRows.length > 0 && (
            <>
              <div className="map-color-list-heading">
                Used in this build
                <span>{usedCubeRows.length}</span>
              </div>
              {usedCubeRows.map((row) => (
                <StatueCubeCard
                  key={row.cube.block}
                  block={row.placed}
                  rgb={row.cube.rgb}
                  category={materialCategoryLabel(row.category)}
                  usedCount={row.usedCount}
                  enabled={row.enabled}
                  onToggleEnabled={(enabled) => toggleCube(row.cube.block, enabled)}
                  onChange={() => openCubeReplace(row.cube.block)}
                />
              ))}
            </>
          )}
          {otherCubeGroups.map(([label, rows]) => (
            <div key={label}>
              <div className="map-color-list-heading">
                {label}
                <span>{rows.length}</span>
              </div>
              {rows.map((row) => (
                <StatueCubeCard
                  key={row.cube.block}
                  block={row.placed}
                  rgb={row.cube.rgb}
                  category={materialCategoryLabel(row.category)}
                  usedCount={row.usedCount}
                  enabled={row.enabled}
                  onToggleEnabled={(enabled) => toggleCube(row.cube.block, enabled)}
                  onChange={() => openCubeReplace(row.cube.block)}
                />
              ))}
            </div>
          ))}
          {cubeRows.length === 0 && (
            <div className="palette-empty">No blocks match this search.</div>
          )}
        </div>
      </AppDialog>

      {replaceTarget && palette && (
        <BlockReplaceDialog
          palette={palette}
          target={replaceTarget}
          statueSafe
          perCube
          cubes={modelCubes}
          onClose={() => setReplaceTarget(null)}
          onPick={(state) => {
            const from = replaceTarget.sourceState ?? replaceTarget.selectedState
            replaceCube(from, state)
            setReplaceTarget((current) =>
              current ? { ...current, selectedState: state, replaced: cubeId(from) !== cubeId(state) } : current,
            )
          }}
          onReset={() => {
            const from = replaceTarget.sourceState ?? replaceTarget.selectedState
            replaceCube(from, from)
            setReplaceTarget((current) =>
              current ? { ...current, selectedState: from, replaced: false } : current,
            )
          }}
          onToggleEnabled={() => {
            const enabled = replaceTarget.enabled
            toggleCube(replaceTarget.sourceState ?? replaceTarget.selectedState, !enabled)
            setReplaceTarget((current) =>
              current ? { ...current, enabled: !enabled } : current,
            )
          }}
        />
      )}

      <CapePickerDialog
        open={capePickerOpen}
        currentId={selected?.capeId}
        onOpenChange={setCapePickerOpen}
        onPick={applyCapeToSelected}
      />
    </div>
  )
}

function StatueCubeCard({
  block,
  rgb,
  category,
  usedCount,
  enabled,
  onToggleEnabled,
  onChange,
}: {
  block: string
  rgb: [number, number, number]
  category: string
  usedCount: number
  enabled: boolean
  onToggleEnabled: (nextEnabled: boolean) => void
  onChange: () => void
}) {
  return (
    <article className={`map-color-card ${enabled ? '' : 'is-disabled'}`}>
      <label className="map-color-card-check">
        <Checkbox
          title={enabled ? 'Skip this block' : 'Use this block'}
          checked={enabled}
          onCheckedChange={(checked) => onToggleEnabled(checked === true)}
        />
        <BlockIcon block={block} color={rgb} />
      </label>
      <div
        className="map-color-card-body map-color-card-body-pick"
        role={enabled ? 'button' : undefined}
        tabIndex={enabled ? 0 : undefined}
        title={enabled ? 'Change block' : undefined}
        onClick={() => {
          if (!enabled) return
          onChange()
        }}
        onKeyDown={(event) => {
          if (!enabled) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onChange()
          }
        }}
      >
        <div className="map-color-card-title">
          <strong>{friendlyBlockName(block)}</strong>
          {usedCount > 0 && (
            <span className="map-color-card-badge is-used">In build</span>
          )}
        </div>
        <div className="map-color-card-meta">
          {usedCount > 0
            ? `${category} · ${usedCount.toLocaleString()} in this build`
            : category}
        </div>
      </div>
      <Button type="button" variant="soft" disabled={!enabled} onClick={onChange}>
        Change
      </Button>
    </article>
  )
}

function poseForPart(part: ScenePartLocal): (CharacterPose & {
  pivots?: Record<string, [number, number, number]>
  strokes?: MeshPartPose['strokes']
  rigid?: boolean
  poseParents?: Record<string, string>
}) | null {
  if (part.skinPose) {
    return {
      slimArms: part.slimArms,
      root: {
        pos: (part.skinPose.root.pos as [number, number, number]) ?? [0, 0, 0],
        rot: (part.skinPose.root.rot as [number, number, number]) ?? [0, 0, 0],
        bend: (part.skinPose.root.bend as [number, number, number]) ?? [0, 0, 0],
        scale: (part.skinPose.root.scale as [number, number, number]) ?? [1, 1, 1],
      },
      parts: Object.fromEntries(
        Object.entries(part.skinPose.parts).map(([key, posePart]) => [
          key,
          {
            pos: (posePart.pos as [number, number, number]) ?? [0, 0, 0],
            rot: (posePart.rot as [number, number, number]) ?? [0, 0, 0],
            bend: (posePart.bend as [number, number, number]) ?? [0, 0, 0],
            scale: (posePart.scale as [number, number, number]) ?? [1, 1, 1],
          },
        ]),
      ),
      rigid:
        Boolean(part.skinPose.rigid)
        || Boolean(part.sourceLabel?.startsWith('Minecraft')),
      pivots: part.skinPose.pivots
        ? Object.fromEntries(
            Object.entries(part.skinPose.pivots).map(([key, value]) => [
              key,
              [
                value[0] ?? 0,
                value[1] ?? 0,
                value[2] ?? 0,
              ] as [number, number, number],
            ]),
          )
        : undefined,
      poseParents: part.skinPose.poseParents
        ? { ...part.skinPose.poseParents }
        : undefined,
      strokes: cloneMeshPoseStrokes(
        part.skinPose.strokes?.map((stroke) => ({
          objectName: stroke.objectName,
          pivot: [
            stroke.pivot[0] ?? 0,
            stroke.pivot[1] ?? 0,
            stroke.pivot[2] ?? 0,
          ] as [number, number, number],
          rot: [
            stroke.rot[0] ?? 0,
            stroke.rot[1] ?? 0,
            stroke.rot[2] ?? 0,
          ] as [number, number, number],
          bend: [
            stroke.bend[0] ?? 0,
            stroke.bend[1] ?? 0,
            stroke.bend[2] ?? 0,
          ] as [number, number, number],
          pos: [
            stroke.pos[0] ?? 0,
            stroke.pos[1] ?? 0,
            stroke.pos[2] ?? 0,
          ] as [number, number, number],
        })),
      ),
    }
  }
  if (!part.miobjectBytes || part.miobjectBytes.length === 0) return null
  try {
    return extractCharacterPose(part.miobjectBytes)
  } catch {
    return null
  }
}

function formatObjectSize(object: ObjSceneObject): string {
  const round = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))
  return `${round(object.size[0])} × ${round(object.size[1])} × ${round(object.size[2])}`
}

/**
 * Lets the user pick which objects inside an OBJ are actually the model.
 * Scene exports routinely bundle a studio backdrop and light planes with the
 * subject, and those get voxelised too unless they're dropped here.
 */
function SceneObjectFilter({
  objects,
  excluded,
  suggested,
  onChange,
}: {
  objects: ObjSceneObject[]
  excluded: readonly string[]
  suggested: readonly string[]
  onChange: (excluded: string[] | null) => void
}) {
  const [open, setOpen] = useState(false)
  const hidden = new Set(excluded)
  const guessed = new Set(suggested)
  const hiddenCount = objects.filter((object) => hidden.has(object.name)).length
  const matchesSuggestion =
    hiddenCount === guessed.size && objects.every((o) => hidden.has(o.name) === guessed.has(o.name))

  const toggle = (name: string) => {
    const next = new Set(hidden)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onChange([...next])
  }

  return (
    <>
      <div className="panel-divider" />
      <div className="size-preset-heading">
        <strong>Objects in file</strong>
        <span>
          {hiddenCount > 0
            ? `${objects.length - hiddenCount} of ${objects.length} used — ${hiddenCount} left out`
            : `All ${objects.length} used`}
        </span>
      </div>
      {hiddenCount > 0 && matchesSuggestion ? (
        <small className="field-hint">
          Studio backdrops, light planes and stray helpers were detected and left out
          so the model fills its box. Open the list to change that.
        </small>
      ) : null}
      <div className="scene-object-actions">
        <Button type="button" size="1" variant="soft" color="gray" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide list' : 'Show list'}
        </Button>
        <Button
          type="button"
          size="1"
          variant="soft"
          color="gray"
          disabled={hiddenCount === 0}
          onClick={() => onChange([])}
        >
          Use everything
        </Button>
        <Button
          type="button"
          size="1"
          variant="soft"
          color="gray"
          disabled={matchesSuggestion}
          onClick={() => onChange(null)}
        >
          Reset to detected
        </Button>
      </div>
      {open ? (
        <ul className="scene-object-list">
          {objects.map((object) => {
            const used = !hidden.has(object.name)
            return (
              <li key={object.name} className={used ? '' : 'excluded'}>
                <label>
                  <input
                    type="checkbox"
                    checked={used}
                    onChange={() => toggle(object.name)}
                  />
                  <span className="scene-object-name" title={object.name}>
                    {object.name}
                  </span>
                </label>
                <span className="scene-object-meta">
                  {formatObjectSize(object)}
                  {object.faceCount === 0
                    ? ' · no surface'
                    : ` · ${object.faceCount.toLocaleString()} faces`}
                  {guessed.has(object.name) ? ' · scenery' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}

function SkinPoseEditor({
  part,
  selectedLimb,
  onSelectLimb,
  freeBend = true,
  onFreeBendChange,
  ensurePose,
  onChangePose,
  onResetLimb,
  onResetAll,
  onEditEnd,
  onChangeRigMode,
  onChangeSkinMode,
}: {
  part: ScenePartLocal
  selectedLimb: string
  onSelectLimb: (limb: string) => void
  freeBend?: boolean
  onFreeBendChange?: (value: boolean) => void
  onChangeRigMode?: (mode: MeshRigMode) => void
  onChangeSkinMode?: (mode: MeshSkinMode) => void
  ensurePose: (part: ScenePartLocal) => NonNullable<ScenePartLocal['skinPose']>
  onChangePose: (
    limb: string,
    channel: 'pos' | 'rot' | 'bend',
    axis: 0 | 1 | 2,
    value: number,
  ) => void
  onResetLimb: (limb: string) => void
  onResetAll: () => void
  onEditEnd?: () => void
}) {
  const pose = ensurePose(part)
  const isSkin = part.kind === 'skin'
  const isMeshBones = partUsesMeshBones(part)
  const classicDefault = partUsesClassicPoseByDefault(part)
  const rigMode = rigModeOf(part)
  // Joints come from the rig that was actually fitted, so a chair lists its legs
  // and a dragon its tail instead of everything pretending to be a person.
  const objBytes = useMemo(() => partObjBytes(part), [part])
  const rig = useMemo(
    () => (isMeshBones ? rigOfPart(part, objBytes) : null),
    [isMeshBones, part, objBytes],
  )
  const isCatalogEntity = Boolean(part.sourceLabel?.startsWith('Minecraft')) && part.kind === 'obj'
  const cubeLimbs = useMemo(() => {
    if (isMeshBones || part.kind !== 'obj' || part.mimodelBytes?.length) return null
    if (isCatalogEntity) return null
    if (objBytes.length < 64) return null
    const names = meshObjectNamesFromObj(objBytes)
    const followers = buildPoseFollowerMap(scanObjObjectBounds(objBytes))
    return poseEditableObjectNames(names, followers)
  }, [isMeshBones, isCatalogEntity, part.kind, part.mimodelBytes, objBytes])
  const limbs = isMeshBones
    ? (rig?.bones ?? []).map((bone) => ({ id: bone.id, label: bone.label }))
    : isCatalogEntity && !isMeshBones
      ? poseLimbsForCatalogEntity(pose)
    : cubeLimbs
      ? [
          { id: 'root', label: 'Root (whole model)' },
          ...cubeLimbs.map((id) => ({
            id,
            label: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          })),
        ]
      : poseLimbsForEditor(part, pose)
  const poseLimbId = skinPoseLimbBase(selectedLimb)
  const bendFocus = !isMeshBones && skinPoseLimbIsBend(selectedLimb)
  const classicSplitLimb =
    !isMeshBones
    && !cubeLimbs
    && SKIN_BEND_LIMBS.has(poseLimbId as SkinPoseLimbId)
  const bendLimb = isMeshBones ? meshBoneBendTargetId(selectedLimb, rig) : poseLimbId
  const activeRotPos =
    poseLimbId === 'root'
      ? pose.root
      : pose.parts[poseLimbId] ?? { pos: [0, 0, 0], rot: [0, 0, 0], bend: [0, 0, 0], scale: [1, 1, 1] }
  const activeBend =
    bendLimb === 'root'
      ? pose.root
      : pose.parts[bendLimb] ?? { pos: [0, 0, 0], rot: [0, 0, 0], bend: [0, 0, 0], scale: [1, 1, 1] }
  const showBend = isCatalogEntity && !isMeshBones
    ? false
    : isMeshBones
    ? meshBoneSupportsBend(selectedLimb, rig)
    : poseLimbId !== 'root' && poseLimbId !== 'head'
  const showRotPos = isMeshBones || isSkin || isCatalogEntity || !classicSplitLimb || !bendFocus
  // Offsets are in the model's own units — a metre-scale import needs a far finer
  // slider than a Blockbench export, or every nudge overshoots the whole figure.
  const offsetStep = isMeshBones ? meshBoneOffsetStep(rig) : 0.5
  const offsetRange = isMeshBones ? meshBoneOffsetRange(rig) : 64
  const offsetDecimals = isMeshBones ? meshBoneOffsetDecimals(rig) : 1
  // Elbows/knees hinge on one axis — hide the sliders that can't move them.
  const bendHingeAxis = useMemo(() => {
    if (freeBend || !showBend) return null
    if (isMeshBones) return meshBoneHingeAxisFor(rig, selectedLimb)
    return 0
  }, [freeBend, isMeshBones, showBend, rig, selectedLimb])

  return (
    <div className="skin-pose-editor">
      <div className="size-preset-heading">
        <strong>Limb pose</strong>
        <span>
          {isMeshBones
            ? rig?.kind === 'native'
              ? part.nativeMeshWeights
                ? 'This file’s skeleton'
                : 'This file’s joints — weights solved here'
              : rig?.kind === 'generic'
              ? 'Bones follow this model’s shape — click one to rotate it'
              : isSkin
                ? 'Bone rig — maps to classic skin joints on convert'
                : 'Click a bone — Rotate joints, Bend elbows/knees'
            : isCatalogEntity
              ? 'Click a limb to rotate it · Root moves the whole model'
            : isSkin || !cubeLimbs
              ? 'Click the upper or lower part of a limb to pose that joint'
              : 'Click a spot on the body to place the joint, then Rotate / Bend / Move'}
        </span>
      </div>
      {onFreeBendChange && showBend ? (
        <CheckRow checked={freeBend} onChange={onFreeBendChange}>
          Free bend (all axes)
        </CheckRow>
      ) : null}
      {onChangeRigMode && (classicDefault || isMeshBones || part.kind === 'obj') ? (
        <div className="skin-pose-rig-mode">
          <span>Skeleton</span>
          <Segmented
            size="1"
            className="ui-segmented--dense"
            value={rigMode}
            onChange={onChangeRigMode}
            options={(
              [
                ...(classicDefault ? (['classic'] as const) : []),
                ...(part.nativeMeshRig ? (['native'] as const) : []),
                'auto',
                'humanoid',
                'generic',
              ] as const
            ).map((mode) => ({
              value: mode,
              label:
                mode === 'classic'
                  ? 'Classic'
                  : mode === 'native'
                    ? 'Native'
                    : mode === 'auto'
                      ? 'Auto'
                      : mode === 'humanoid'
                        ? 'Body'
                        : 'Shape',
              title:
                mode === 'classic'
                  ? part.sourceLabel?.startsWith('Minecraft')
                    ? 'Rotate cubes like Minecraft / Blockbench (default)'
                    : isSkin
                      ? 'Classic Minecraft skin joints (default)'
                      : 'Classic Mine-imator / limb joints (default)'
                  : mode === 'native'
                    ? 'Use the joints this model was rigged with'
                    : mode === 'auto'
                      ? isSkin
                        ? 'Use the full body bone rig (Steve/Alex template)'
                        : 'Fit a body skeleton when the model looks like a character, otherwise follow its shape'
                      : mode === 'humanoid'
                        ? isSkin
                          ? 'Full body bone rig with separate elbows and knees'
                          : 'Always fit hips, spine, arms and legs'
                        : isSkin
                          ? 'Full body bone rig (same as Body for skins)'
                          : 'Always derive bones from the model’s own shape',
            }))}
          />
        </div>
      ) : null}
      {onChangeSkinMode && (isMeshBones || classicDefault || part.kind === 'obj') ? (
        <div className="skin-pose-rig-mode">
          <span>Deform</span>
          <Segmented
            size="1"
            className="ui-segmented--dense"
            value={meshSkinModeOf(part)}
            onChange={onChangeSkinMode}
            options={[
              {
                value: 'rigid',
                label: 'Rigid',
                title: 'Minecraft / Mine-imator — cubes rotate, no stretch (default)',
              },
              {
                value: 'stretch',
                label: 'Stretch',
                title: 'Blend across joints — smooth bends that can stretch like before',
              },
            ]}
          />
        </div>
      ) : null}
      <div className="skin-pose-limbs">
        {limbs.map((entry) => (
          <ChipButton
            key={entry.id}
            className="skin-pose-limb-chip"
            active={selectedLimb === entry.id}
            title={entry.label}
            onClick={() => onSelectLimb(entry.id)}
          >
            {entry.label}
          </ChipButton>
        ))}
      </div>
      {(['rot', 'bend', 'pos'] as const).map((channel) => {
        if (channel === 'bend' && !showBend) return null
        if ((channel === 'rot' || channel === 'pos') && !showRotPos) return null
        const active = channel === 'bend' ? activeBend : activeRotPos
        return (
        <div key={channel} className="skin-pose-channel">
          <strong>
            {channel === 'rot'
              ? 'Rotate °'
              : channel === 'bend'
                ? 'Bend °'
                : 'Offset'}
          </strong>
          <div className="skin-pose-axes">
            {([0, 1, 2] as const).map((axis) => {
              if (channel === 'bend' && bendHingeAxis != null && axis !== bendHingeAxis) {
                return null
              }
              const label = axis === 0 ? 'X' : axis === 1 ? 'Y' : 'Z'
              const value = Number(active[channel][axis] ?? 0)
              const min = channel === 'pos' ? -offsetRange : -180
              const max = channel === 'pos' ? offsetRange : 180
              return (
                <AxisSlider
                  key={`${channel}-${axis}`}
                  label={label}
                  value={value}
                  min={min}
                  max={max}
                  step={channel === 'pos' ? offsetStep : 1}
                  decimals={channel === 'pos' ? offsetDecimals : 0}
                  onChange={(next) =>
                    onChangePose(
                      bendFocus ? selectedLimb : poseLimbId,
                      channel,
                      axis,
                      next,
                    )
                  }
                  onEditEnd={onEditEnd}
                />
              )
            })}
          </div>
        </div>
        )
      })}
      <div className="part-toolbar">
        <Button type="button" variant="soft" color="gray" size="1" onClick={() => onResetLimb(selectedLimb)}>
          Reset limb
        </Button>
        <Button type="button" variant="soft" color="gray" size="1" onClick={onResetAll}>
          Reset pose
        </Button>
      </div>
    </div>
  )
}

function partKindLabel(part: ScenePartLocal): string {
  if (part.kind === 'skin' && part.name.toLowerCase().endsWith('.miobject')) return 'mi'
  if (part.fbxBytes?.length) return 'fbx'
  if (part.daeBytes?.length) return 'dae'
  if (part.mayaBytes?.length) return 'maya'
  return part.kind
}

function ObjectTabStrip({
  parts,
  selectedId,
  onSelect,
  onRemove,
  onAdd,
}: {
  parts: ScenePartLocal[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onAdd?: () => void
}) {
  if (parts.length === 0) return null
  return (
    <div className="object-tabs" role="tablist" aria-label="Scene objects">
      <div className="object-tabs-scroll">
        {parts.map((part) => (
          <div
            key={part.id}
            className={`object-tab ${selectedId === part.id ? 'active' : ''}`}
            role="presentation"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedId === part.id}
              className="object-tab-main"
              onClick={() => onSelect(part.id)}
              title={part.name}
            >
              <span className={`part-kind ${part.kind}`}>{partKindLabel(part)}</span>
              <span className="object-tab-name">{part.name}</span>
            </button>
            {onRemove ? (
              <button
                type="button"
                className="object-tab-remove"
                title={`Remove ${part.name}`}
                aria-label={`Remove ${part.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(part.id)
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {onAdd ? (
        <button
          type="button"
          className="object-tab-add"
          onClick={onAdd}
          title="Add object"
          aria-label="Add object"
        >
          +
        </button>
      ) : null}
    </div>
  )
}

async function runExport(
  format: ExportFormat,
  setStatus: (status: string) => void,
  build?: { minecraftVersion?: string; dataVersion?: number },
) {
  try {
    setStatus(
      build?.minecraftVersion
        ? `Preparing Minecraft ${build.minecraftVersion} export…`
        : 'Preparing export…',
    )
    const saved = await saveExport(format, {
      minecraftVersion: build?.minecraftVersion,
      dataVersion: build?.dataVersion,
    })
    setStatus(
      saved
        ? build?.minecraftVersion
          ? `Export saved (Minecraft ${build.minecraftVersion})`
          : 'Export saved'
        : 'Export cancelled',
    )
  } catch (error) {
    setStatus(statusFromError('Export failed', error, { operation: 'export schematic' }))
  }
}
