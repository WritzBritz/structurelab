import type { MeshBoneRig, MeshBoneWeights } from './tools/models/meshBoneRig'

export type BuildMode = 'flat' | 'staircase'
export type StaircaseHeightAnchor = 'floating' | 'floor'
export type StaircaseStartEdge = 'top' | 'bottom'
export type DitherMode = 'none' | 'floydSteinberg' | 'atkinson' | 'ordered'
/** Palette distance metric — independent of dithering. */
export type ColourMatching =
  | 'hueAwareLab'
  | 'rebaneMapartClassic'
  | 'ciede2000'
  | 'oklabHueGuard'
  | 'structureLabMix'
  | 'structureLabSmooth'

const MODEL_COLOUR_MATCHING: ColourMatching[] = [
  'structureLabSmooth',
  'structureLabMix',
  'hueAwareLab',
  'oklabHueGuard',
  'ciede2000',
  'rebaneMapartClassic',
]

/** Saved sessions may still say `structureLabRealistic` (removed facescan). */
export function resolveModelColourMatching(value?: string): ColourMatching {
  if (value === 'structureLabRealistic') {
    return 'structureLabSmooth'
  }
  if (value && (MODEL_COLOUR_MATCHING as string[]).includes(value)) {
    return value as ColourMatching
  }
  return 'structureLabSmooth'
}
export type FitMode = 'stretch' | 'contain' | 'cover'
export type MapSizeMode = 'maps' | 'custom'
export type ArtKind = 'mapArt' | 'pixelArt'
export type BuildOrientation =
  | 'floor'
  | 'wallSouth'
  | 'wallNorth'
  | 'wallEast'
  | 'wallWest'
export type ExportFormat =
  | 'vanillaNbt'
  | 'vanillaSplit'
  | 'litematicV6'
  | 'litematicV7'
  | 'spongeV3'
  | 'all'

export interface ConvertOptions {
  mapsX: number
  mapsY: number
  /** `maps` uses mapsX/Y × 128; `custom` uses exact blocksX × blocksZ. */
  sizeMode: MapSizeMode
  /** East-west blocks when sizeMode is custom. */
  blocksX: number
  /** North-south blocks when sizeMode is custom. */
  blocksZ: number
  /** Map art (map item shading) vs in-world pixel art. */
  artKind: ArtKind
  /** World orientation of the finished build. */
  orientation: BuildOrientation
  mode: BuildMode
  dither: DitherMode
  /**
   * How pixels / voxels are matched to map palette shades. Independent of dithering.
   * Default for map art is `structureLabMix` (perceptual mix).
   * Default for models is `structureLabSmooth` (Oklab HyAB + pair mix, 3D ordered
   * dither, no error diffusion). Hue-aware Lab remains available for small details.
   * `ciede2000` is CIE ΔE₀₀ in standard CIE Lab.
   * `oklabHueGuard` is Oklab HyAB with a hue guard (stronger on sparse packs).
   * `rebaneMapartClassic` is MapartCraft “better colour”.
   * `structureLabMix` matches the local average a viewer sees and does its own
   * dithering, so `dither` is ignored while it is selected.
   * `structureLabSmooth` is models-only: Oklab nearest + two-cube mix when the
   * mix is closer, 3D Bayer grain, lightness outliers (eyes) stay a single cube.
   */
  colourMatching: ColourMatching
  fit: FitMode
  brightness: number
  contrast: number
  saturation: number
  maxHeight: number
  /**
   * When false (default), `maxHeight` (128) is the staircase budget — good for
   * survival worlds. Turn on for unlimited height / best MapartCraft quality.
   */
  staircaseHeightAuto: boolean
  /** Staircase: ground-up only-up from y=0, or exact stairs with each column on the ground. */
  staircaseHeightAnchor: StaircaseHeightAnchor
  /**
   * Staircase: extra control row on the image top (north) or bottom (south).
   * Auto keeps the map; a binding height cap re-solves from that edge.
   */
  staircaseStartEdge: StaircaseStartEdge
  staircaseSupportBlock: string
  supportUnderGravity: boolean
  trimTransparent: boolean
  /** Leave fully transparent pixels empty (no block) instead of filling white. */
  skipTransparent: boolean
  disabledColorIds: number[]
  blockOverrides: Record<number, string>
}

export interface MapColor {
  id: number
  name: string
  rgb: [number, number, number]
  block: string
  alternatives: string[]
  transparent?: boolean
  gravity?: boolean
  flammable?: boolean
  fluid?: boolean
  needsSupport?: boolean
}

export interface ModelAppearanceCube {
  block: string
  rgb: [number, number, number]
}

export interface PaletteFile {
  minecraftVersion: string
  dataVersion: number
  source: string
  colors: MapColor[]
}

export interface MaterialCount {
  block: string
  count: number
  stacks: number
  remainder: number
}

export interface BuildResult {
  width: number
  length: number
  height: number
  minY: number
  mapsX: number
  mapsY: number
  materials: MaterialCount[]
  warnings: string[]
  minecraftVersion?: string
  dataVersion?: number
}

export interface ConversionResponse {
  sourceWidth: number
  sourceHeight: number
  previewDataUrl: string
  /** Top-surface blocks for the textured 2D map preview. */
  previewSurfacePalette: string[]
  /** Base64 of `width * length` bytes — index into `previewSurfacePalette`. */
  previewSurfaceIndices: string
  /** Unique block states for the 3D preview. */
  previewBlockPalette: string[]
  /**
   * Base64 of packed voxels: repeating little-endian
   * `[x:u16][y:u16][z:u16][paletteIndex:u8]` (includes supports).
   */
  previewVoxels: string
  /** Preview kept every Nth column when large; draw cubes N wide so they stay flush. */
  previewVoxelStride: number
  build: BuildResult
}

export type VoxelFit = 'fit' | 'stretch'
/** How the second skin layer is applied. Mobs use `hat` (vanilla HumanoidModel). */
export type SkinOverlayMode = 'full' | 'hat' | 'none'
/** Inner limb box sizes: player 4×4, slim 3×4, skeleton 2×2. */
export type SkinLimbStyle = 'classic' | 'slim' | 'skeleton'
export type ScenePartKind = 'obj' | 'skin'
/** How Models handles sand, gravel, powder, carpets, etc. */
export type GravitySupportMode = 'off' | 'matchColor' | 'fixed'
/** Models-only cube pool. Map art never uses this. */
export type StatueBlockPack =
  | 'common'
  | 'everything'
  | 'wool'
  | 'concrete'
  | 'terracotta'
  | 'stone'
  | 'solid'
export type UvWrap = 'clamp' | 'repeat'

export interface ModelUvOptions {
  offsetU: number
  offsetV: number
  scaleU: number
  scaleV: number
  /** Degrees, clockwise around the atlas centre. */
  rotation: number
  flipU: boolean
  flipV: boolean
  wrap: UvWrap
}

export const defaultModelUv: ModelUvOptions = {
  offsetU: 0,
  offsetV: 0,
  scaleU: 1,
  scaleV: 1,
  rotation: 0,
  flipU: false,
  flipV: false,
  wrap: 'clamp',
}

export function resolveModelUv(uv?: Partial<ModelUvOptions> | null): ModelUvOptions {
  return { ...defaultModelUv, ...uv }
}

export interface ModelConvertOptions {
  width: number
  height: number
  length: number
  fit: VoxelFit
  hollow: boolean
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
  uv: ModelUvOptions
}

export interface ScenePartLocal {
  id: string
  name: string
  kind: ScenePartKind
  fileName: string
  bytes: Uint8Array
  /** Optional Wavefront material library for OBJ parts. */
  mtlBytes?: Uint8Array | null
  mtlFileName?: string | null
  /** Texture basename (lowercased) → image bytes. */
  textures: Record<string, Uint8Array>
  /** Declared mtllib name from the OBJ, if any. */
  expectedMtlFileName?: string | null
  /** Texture / .mimodel basenames referenced by the MTL / Mine-imator export. */
  expectedTextureNames: string[]
  /** Original source label (e.g. .miobject file name). */
  sourceLabel?: string | null
  /** Raw .miobject bytes when waiting on a companion skin (so pose can be rebuilt). */
  miobjectBytes?: Uint8Array | null
  /** Attached .mimodel basename (shown in the companions panel even after bake). */
  attachedMimodelName?: string | null
  /** Raw .mimodel bytes so texture changes can rebuild the mesh. */
  mimodelBytes?: Uint8Array | null
  /**
   * Pose applied at convert time (Mine-imator miobject or Blockbench skin project).
   * Prefer this when set; otherwise pose is extracted from `miobjectBytes`.
   */
  skinPose?: {
    root: { pos: number[]; rot: number[]; bend: number[]; scale: number[] }
    parts: Record<string, { pos: number[]; rot: number[]; bend: number[]; scale: number[] }>
    /** Click-to-pose joint positions in mesh space (Maya/OBJ/glTF). */
    pivots?: Record<string, number[]>
    /** Whole-cube posing for Minecraft catalog parts. */
    rigid?: boolean
    /** Child object → parent object for FK (rotating body moves head/arms). */
    poseParents?: Record<string, string>
    /** Prior regional poses kept when clicking a new joint on whole-body meshes. */
    strokes?: Array<{
      objectName: string
      pivot: number[]
      rot: number[]
      bend: number[]
      pos: number[]
    }>
  } | null
  /**
   * Euler convention for `skinPose`.
   * - `blockbench`: Three.js XYZ as shown in the limb editor / gizmos (Rust applies RH XYZ).
   * - `mineimator`: GameMaker left-handed YXZ from .miobject keyframes (Rust applies as-is).
   */
  skinPoseEuler?: 'blockbench' | 'mineimator' | null
  /**
   * Which skeleton the auto-rig fits: `humanoid` forces the anatomical template,
   * `generic` derives bones from the model's own shape, `auto` picks per mesh,
   * `classic` keeps Minecraft skin / Mine-imator joint posing (default for those).
   */
  meshRigMode?: 'classic' | 'native' | 'auto' | 'humanoid' | 'generic' | null
  /**
   * How mesh-bone posing deforms the surface.
   * - `rigid`: one bone per vertex (Minecraft / Mine-imator cubes — no stretch).
   * - `stretch`: blended skinning (smooth joints, the previous default).
   */
  meshSkinMode?: 'rigid' | 'stretch' | null
  /** Skeleton and original skin weights imported from DAE (OBJ vertex order). */
  nativeMeshRig?: MeshBoneRig | null
  nativeMeshWeights?: MeshBoneWeights | null
  /**
   * Names of `o` / `g` objects to leave out of the model — studio backdrops,
   * light planes and other set dressing that ships inside scene exports.
   * `null` / absent means "not chosen yet", so the automatic guess applies.
   */
  excludedObjects?: string[] | null
  /**
   * Auto bone pose for Maya/OBJ/glTF meshes, and optionally for skins /
   * Mine-imator when Skeleton is not Classic.
   */
  meshBonePose?: {
    root: { pos: number[]; rot: number[]; bend: number[]; scale?: number[] }
    parts: Record<string, { pos: number[]; rot: number[]; bend: number[]; scale?: number[] }>
  } | null
  positionX: number
  positionY: number
  positionZ: number
  /** Scene placement rotation in degrees (separate from skinPose limb rotations). */
  rotationX: number
  rotationY: number
  rotationZ: number
  width: number
  height: number
  length: number
  fit: VoxelFit
  hollow: boolean
  /** Atlas UV offset / scale / flip for textured meshes. */
  uv?: ModelUvOptions
  slimArms: boolean
  /** Entity overlay: players `full`, vanilla mobs `hat`, or `none`. */
  skinOverlay?: SkinOverlayMode
  /** Inner limb thickness. Skeleton uses 2×2 vanilla boxes. */
  skinLimbs?: SkinLimbStyle
  /** Optional cape PNG (64×32 or HD scale). Painted behind the player. */
  capeBytes?: Uint8Array | null
  capeFileName?: string | null
  /** Official cape id, `custom`, or null when none. */
  capeId?: string | null
  /** Tracks which OBJ size preset is active (`auto`, `medium`, `custom`, …). */
  objSizePreset?: string | null
  /** Absolute disk path when loaded from native dialog / drop — used for convert without re-staging. */
  sourcePath?: string | null
  /** Raw MagicaVoxel bytes for flicker-free surface preview (OBJ is kept for convert). */
  voxBytes?: Uint8Array | null
  /** Raw Maya `.mb`/`.ma` bytes so attaching textures can re-run atlas UV correction. */
  mayaBytes?: Uint8Array | null
  /** Raw COLLADA XML so texture attachment can rebuild materials and native skin data. */
  daeBytes?: Uint8Array | null
  /** Raw FBX so texture attachment can rebuild materials and native skin data. */
  fbxBytes?: Uint8Array | null
  /** Mesh/material name → texture file, resolved from a surrounding Unity package. */
  fbxMaterialTextures?: Record<string, string> | null
}

export interface ScenePartPayload {
  id: string
  name: string
  kind: ScenePartKind
  fileName: string
  dataBase64?: string
  dataPath?: string | null
  mtlBase64?: string | null
  mtlPath?: string | null
  texturesBase64?: Record<string, string>
  texturesPaths?: Record<string, string>
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
  hollow: boolean
  /** Honor texture alpha as cutouts instead of filling them with face colour. */
  cutout?: boolean
  uv?: ModelUvOptions
  slimArms: boolean
  /** Extrude second skin layer into a 3D shell. */
  outer3d?: boolean
  skinOverlay?: SkinOverlayMode
  skeletonLimbs?: boolean
  /** Blend and seal elbow/knee/waist voxels after posing. */
  smoothJoints?: boolean
  /** Mine-imator character pose applied in voxel space (keeps skin colours). */
  skinPose?: {
    root: { pos: number[]; rot: number[]; bend: number[]; scale: number[] }
    parts: Record<string, { pos: number[]; rot: number[]; bend: number[]; scale: number[] }>
    jointStyle?: 'blockbench' | 'mineimator' | null
  } | null
  /** Optional cape PNG as base64 (64×32 or HD). */
  capeBase64?: string | null
}

export interface SceneConvertOptions {
  parts: ScenePartPayload[]
  disabledColorIds: number[]
  blockOverrides: Record<number, string>
  blockPack?: StatueBlockPack
  disabledBlocks?: string[]
  blockSubstitutions?: Record<string, string>
  supportMode: GravitySupportMode
  supportBlock: string
  colourMatching?: ColourMatching
  dither?: DitherMode
  hue?: number
  brightness?: number
  contrast?: number
  saturation?: number
}

export interface MeshInfo {
  format: string
  vertexCount: number
  triangleCount: number
  boundsMin: [number, number, number]
  boundsMax: [number, number, number]
}

export interface ModelConversionResponse {
  mesh: MeshInfo
  previewDataUrl: string
  occupiedVoxels: number
  build: BuildResult
}

export interface ScenePartSummary {
  id: string
  name: string
  kind: ScenePartKind
  occupiedVoxels: number
  mesh: MeshInfo | null
}

export interface SceneVoxel {
  x: number
  y: number
  z: number
  rgb: [number, number, number]
  /** Chosen block state for textured 3D preview. */
  block?: string
  part: number
}

export type VoxelPreviewStyle = 'materials' | 'textures'

export interface SceneConversionResponse {
  parts: ScenePartSummary[]
  previewDataUrl: string
  occupiedVoxels: number
  build: BuildResult
  voxels: SceneVoxel[]
  size: [number, number, number]
}

export const defaultOptions: ConvertOptions = {
  mapsX: 1,
  mapsY: 1,
  sizeMode: 'maps',
  blocksX: 128,
  blocksZ: 128,
  artKind: 'mapArt',
  orientation: 'floor',
  mode: 'flat',
  dither: 'floydSteinberg',
  colourMatching: 'structureLabMix',
  fit: 'stretch',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  maxHeight: 128,
  staircaseHeightAuto: false,
  staircaseHeightAnchor: 'floor',
  staircaseStartEdge: 'top',
  staircaseSupportBlock: 'minecraft:cobblestone',
  supportUnderGravity: true,
  trimTransparent: false,
  skipTransparent: false,
  disabledColorIds: [],
  blockOverrides: {},
}

export const defaultModelOptions: ModelConvertOptions = {
  width: 64,
  height: 64,
  length: 64,
  fit: 'fit',
  hollow: false,
  disabledColorIds: [],
  blockOverrides: {},
  blockPack: 'everything',
  disabledBlocks: [],
  blockSubstitutions: {},
  supportMode: 'off',
  supportBlock: 'minecraft:cobblestone',
  colourMatching: 'structureLabSmooth',
  dither: 'none',
  hue: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  uv: { ...defaultModelUv },
}

export const defaultSkinSize = { width: 36, height: 68, length: 20 }

/** Native classic skin statue bounds including extruded second-layer margin. */
export const nativeSkinSize = { width: 18, height: 34, length: 10 }
export const nativeSlimSkinSize = { width: 16, height: 34, length: 10 }

export function createObjPart(
  fileName: string,
  bytes: Uint8Array,
  options?: { sourcePath?: string | null },
): ScenePartLocal {
  return {
    id: crypto.randomUUID(),
    name: fileName,
    kind: 'obj',
    fileName,
    bytes,
    mtlBytes: null,
    mtlFileName: null,
    textures: {},
    expectedMtlFileName: null,
    expectedTextureNames: [],
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    width: 64,
    height: 64,
    length: 64,
    fit: 'fit',
    hollow: false,
    uv: { ...defaultModelUv },
    slimArms: false,
    objSizePreset: 'medium',
    sourcePath: options?.sourcePath ?? null,
    voxBytes: null,
    mayaBytes: null,
    daeBytes: null,
    fbxBytes: null,
    fbxMaterialTextures: null,
    meshSkinMode: 'rigid',
  }
}

/** Uniform statue multiplier so one HD texel can become one voxel, capped at world height. */
export function skinAtlasSizeMultiplier(atlasScale: number, slimArms: boolean): number {
  const native = slimArms ? nativeSlimSkinSize : nativeSkinSize
  const scale = Math.max(1, Math.floor(Number.isFinite(atlasScale) ? atlasScale : 1))
  const cap = Math.max(1, Math.floor(384 / native.height))
  return Math.max(1, Math.min(scale, cap))
}

export function createSkinPart(
  fileName: string,
  bytes: Uint8Array,
  options?: {
    slimArms?: boolean
    skinOverlay?: SkinOverlayMode
    skinLimbs?: SkinLimbStyle
    expectedTextureNames?: string[]
    sourceLabel?: string | null
    miobjectBytes?: Uint8Array | null
    skinPose?: ScenePartLocal['skinPose']
    skinPoseEuler?: ScenePartLocal['skinPoseEuler']
    /** PNG pixels per vanilla UV unit (`width / 64`). HD skins default to this statue scale. */
    atlasScale?: number
  },
): ScenePartLocal {
  const slimArms = options?.slimArms ?? false
  const skinLimbs = options?.skinLimbs ?? (slimArms ? 'slim' : 'classic')
  const native = slimArms ? nativeSlimSkinSize : nativeSkinSize
  const sizeMul = skinAtlasSizeMultiplier(options?.atlasScale ?? 1, slimArms)
  const empty = () => ({
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    bend: [0, 0, 0],
    scale: [1, 1, 1],
  })
  return {
    id: crypto.randomUUID(),
    name: fileName,
    kind: 'skin',
    fileName,
    bytes,
    textures: {},
    expectedTextureNames: options?.expectedTextureNames ?? [],
    sourceLabel: options?.sourceLabel ?? null,
    miobjectBytes: options?.miobjectBytes ?? null,
    skinPose: options?.skinPose ?? {
      root: empty(),
      parts: {
        body: empty(),
        head: empty(),
        left_arm: empty(),
        right_arm: empty(),
        left_leg: empty(),
        right_leg: empty(),
        cape: empty(),
      },
    },
    skinPoseEuler: options?.skinPoseEuler ?? 'blockbench',
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    width: native.width * sizeMul,
    height: native.height * sizeMul,
    length: native.length * sizeMul,
    fit: 'fit',
    hollow: false,
    slimArms,
    skinOverlay: options?.skinOverlay,
    skinLimbs,
    capeBytes: null,
    capeFileName: null,
    capeId: null,
    meshSkinMode: 'rigid',
  }
}

export function autoMapGrid(width: number, height: number): [number, number] {
  return [Math.max(1, Math.ceil(width / 128)), Math.max(1, Math.ceil(height / 128))]
}

/** Ensure a positive whole-block span (no artificial upper cap). */
export function clampMapartBlocks(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.round(value))
}

export function mapartFootprint(options: ConvertOptions): { width: number; length: number } {
  if (options.sizeMode === 'custom') {
    return {
      width: clampMapartBlocks(options.blocksX),
      length: clampMapartBlocks(options.blocksZ),
    }
  }
  return {
    width: Math.max(1, options.mapsX) * 128,
    length: Math.max(1, options.mapsY) * 128,
  }
}

export function mapShadingModesAvailable(options: ConvertOptions): boolean {
  return options.artKind === 'mapArt'
}

export function orientationLabel(orientation: BuildOrientation): string {
  switch (orientation) {
    case 'floor':
      return 'Floor (horizontal)'
    case 'wallSouth':
      return 'Wall · faces south'
    case 'wallNorth':
      return 'Wall · faces north'
    case 'wallEast':
      return 'Wall · faces east'
    case 'wallWest':
      return 'Wall · faces west'
  }
}
