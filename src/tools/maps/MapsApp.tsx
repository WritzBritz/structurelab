import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, IconButton, Text } from '@radix-ui/themes'
import { convert, loadPalette, saveExport } from '../../api'
import { BlockIcon } from '../../components/BlockIcon'
import { BlockReplaceDialog, type BlockReplaceTarget } from '../../components/BlockReplaceDialog'
import MinecraftVersionSelect from '../../components/MinecraftVersionSelect'
import { LightfallToggle } from '../../components/LightfallPreference'
import { ThemeToggle } from '../../theme/AppTheme'
import { MapColorSwatch } from '../../components/MapColorSwatch'
import { MissingTextureWarnings } from '../../components/MissingTextureWarnings'
import { CopyableNotice, TopbarStatus } from '../../components/AppErrorHost'
import { statusFromError } from '../../appError'
import {
  applyMaterialPreset,
  blockChoices,
  fluidColorIds,
  friendlyBlockName,
  friendlyMapColorLabel,
  isHostAttachedColourBlock,
  isInfestedBlock,
  mapColorMatchesSearch,
  materialCategory,
  materialCategoryLabel,
  matchesMaterialSearch,
  scrubBlockOverrides,
  scrubSupportBlock,
  staircaseSupportChoices,
  type MaterialPreset,
} from '../../materials'
import { litematicExportFormat, litematicSchematicVersion, subscribeMinecraftVersion } from '../../minecraftVersion'
import {
  blockTextureWarningLabel,
  ensureTextureCacheLoaded,
  findMissingBlockTextures,
  getTextureCacheEpoch,
  subscribeTextureCache,
} from '../models/blockTextures'
import {
  autoMapGrid,
  clampMapartBlocks,
  defaultOptions,
  mapartFootprint,
  mapShadingModesAvailable,
  orientationLabel,
  type ConversionResponse,
  type ConvertOptions,
  type ExportFormat,
  type MapColor,
  type PaletteFile,
} from '../../types'
import {
  importMapImage,
  isAllowedMapImage,
  MAP_IMAGE_ACCEPT,
  MAP_IMAGE_FORMATS_HINT,
} from './imageImport'
import {
  mapsCoalesceKey,
  previewUrlFromImageBytes,
  snapshotNeedsProgress,
  useMapsHistory,
  type MapsHistorySnapshot,
} from './useMapsHistory'
import {
  AppDialog,
  CheckRow,
  ChipButton,
  DropZone,
  ExportButton,
  NumberField,
  PanelTitle,
  RangeField,
  SearchField,
  LoadOverlay,
  compactLabel,
  fileProgressLabel,
  overlayFromProgress,
  Segmented,
  SelectField,
} from '../../ui/kit'
import '../../workspace.css'

const MapArt3DViewer = lazy(() => import('./MapArt3DViewer'))
const MapArt2DViewer = lazy(() => import('./MapArt2DViewer'))

const MAX_ZOOM = 100
/** Matches the `.canvas-frame` padding, which eats into the visible area. */
const FRAME_PADDING = 18
/** Slightly past fit so the art can sit with a little empty margin around it. */
const MIN_ZOOM_FIT_FACTOR = 0.92
type PreviewView = '2d' | '3d'
/** 2D map art: map-item colours (accurate in-game map) vs block-top textures (build look). */
type Map2dStyle = 'mapColors' | 'blockTops'
type Map3dNavigation = 'orbit' | 'free'
const MATERIAL_PRESETS: [MaterialPreset, string][] = [
  ['all', 'All blocks'],
  ['carpet', 'Carpet'],
  ['wool', 'Wool'],
  ['concrete', 'Concrete'],
  ['terracotta', 'Terracotta'],
]

export default function MapsApp({ onBack }: { onBack: () => void }) {
  const [palette, setPalette] = useState<PaletteFile | null>(null)
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [options, setOptions] = useState<ConvertOptions>(defaultOptions)
  const [result, setResult] = useState<ConversionResponse | null>(null)
  const [status, setStatus] = useState('Drop an image to begin')
  const [busy, setBusy] = useState(false)
  const [loadProgress, setLoadProgress] = useState<{
    ratio: number
    label: string
    indeterminate?: boolean
  } | null>(null)
  /** True from an options change until the matching convert finishes — blocks export. */
  const [convertPending, setConvertPending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [activePreset, setActivePreset] = useState<MaterialPreset | 'custom'>('all')
  const [replaceTarget, setReplaceTarget] = useState<BlockReplaceTarget | null>(null)
  const [materialSearch, setMaterialSearch] = useState('')
  const [compare, setCompare] = useState(false)
  const [previewView, setPreviewView] = useState<PreviewView>('2d')
  const [map2dStyle, setMap2dStyle] = useState<Map2dStyle>('mapColors')
  const [map3dNavigation, setMap3dNavigation] = useState<Map3dNavigation>('orbit')
  const [zoom, setZoom] = useState(1)
  const [draggingPreview, setDraggingPreview] = useState(false)
  const [textureWarnings, setTextureWarnings] = useState<string[]>([])
  const [textureCacheEpoch, setTextureCacheEpoch] = useState(() => getTextureCacheEpoch())
  const fileInput = useRef<HTMLInputElement>(null)
  const previewFrame = useRef<HTMLDivElement>(null)
  const mapImage = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const zoomScrollAdjust = useRef<number | null>(null)
  const shouldFitNextPreview = useRef(true)
  const convertGenerationRef = useRef(0)
  const convertInflightRef = useRef(0)
  const imageBytesRef = useRef(imageBytes)
  imageBytesRef.current = imageBytes
  const panStart = useRef<{
    pointerId: number
    x: number
    y: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const historySnapshotRef = useRef<MapsHistorySnapshot>({
    options,
    activePreset,
    imageBytes,
    fileName,
  })
  historySnapshotRef.current = {
    options,
    activePreset,
    imageBytes,
    fileName,
  }

  const applyHistorySnapshot = useCallback((snapshot: MapsHistorySnapshot) => {
    startTransition(() => {
      setOptions(snapshot.options)
      setActivePreset(snapshot.activePreset)
      setFileName(snapshot.fileName)
      setImageBytes(snapshot.imageBytes)
      setSourceUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return previewUrlFromImageBytes(snapshot.imageBytes)
      })
      setResult(null)
      setTextureWarnings([])
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
    isRestoring,
  } = useMapsHistory(
    useCallback(() => historySnapshotRef.current, []),
    applyHistorySnapshot,
  )

  const runHistoryAction = useCallback(
    async (kind: 'undo' | 'redo') => {
      const live = historySnapshotRef.current
      const showProgress = snapshotNeedsProgress(live)
      if (showProgress) {
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
      if (
        (tag === 'INPUT' && (target as HTMLInputElement).type === 'text')
        || (tag === 'INPUT' && (target as HTMLInputElement).type === 'search')
        || tag === 'TEXTAREA'
        || target?.isContentEditable
      ) {
        return
      }
      // Number/range inputs keep app-level undo (same as Models).
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

  const imageFootprint = mapartFootprint(options)
  const artWidth = imageFootprint.width
  const artLength = imageFootprint.length
  // Perceptual mix dithers positionally, so the dither control does nothing.
  const mixMatching = options.colourMatching === 'structureLabMix'

  useEffect(() => {
    // Drop removed water mode if a hot reload / old session still has it.
    setOptions((current) => {
      const next = {
        ...current,
        staircaseHeightAuto: current.staircaseHeightAuto ?? false,
        colourMatching:
          (current.colourMatching as string | undefined) === 'mapartClassic' ||
          current.colourMatching == null
            ? 'structureLabMix'
            : (current.colourMatching as string) === 'structureLab'
              ? 'oklabHueGuard'
              : current.colourMatching,
      }
      return (next.mode as string) === 'water' ? { ...next, mode: 'flat' as const } : next
    })
  }, [])

  const reloadPalette = useCallback(() => {
    loadPalette()
      .then((loaded) => {
        setPalette(loaded)
        setOptions((current) => ({
          ...current,
          disabledColorIds: [
            ...new Set([...current.disabledColorIds, ...fluidColorIds(loaded)]),
          ],
        }))
      })
      .catch((error: unknown) => setStatus(statusFromError('Palette failed', error, { operation: 'load palette' })))
  }, [])

  const applyMinecraftVersionChange = useCallback(() => {
    // Invalidate any in-flight convert so it cannot restore a stale preview.
    convertGenerationRef.current += 1
    convertInflightRef.current = 0
    setBusy(false)
    setConvertPending(false)
    void ensureTextureCacheLoaded()
    setResult(null)
    setTextureWarnings([])
    setStatus('Minecraft version changed — updating blocks…')
    void loadPalette()
      .then((loaded) => {
        setPalette(loaded)
        setOptions((current) => ({
          ...current,
          blockOverrides: scrubBlockOverrides(loaded, current.blockOverrides),
          staircaseSupportBlock: scrubSupportBlock(loaded, current.staircaseSupportBlock),
          disabledColorIds: [
            ...new Set([
              ...fluidColorIds(loaded),
              ...current.disabledColorIds.filter((id) =>
                loaded.colors.some((color) => color.id === id),
              ),
            ]),
          ],
        }))
        // Convert effect updates status when an image is loaded; otherwise restore idle.
        if (!imageBytesRef.current) {
          setStatus('Drop an image to begin')
        }
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

  useEffect(
    () => () => {
      if (zoomScrollAdjust.current !== null) {
        cancelAnimationFrame(zoomScrollAdjust.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!imageBytes || !result) return
    const blocks = [
      ...(result.previewBlockPalette ?? []),
      ...(result.previewSurfacePalette ?? []),
      ...result.build.materials.map((material) => material.block),
    ]
    let cancelled = false
    void findMissingBlockTextures(blocks).then((missing) => {
      if (cancelled) return
      setTextureWarnings(missing)
      if (missing.length > 0) {
        setStatus(
          `Ready to export — ${missing.length} block texture${missing.length === 1 ? '' : 's'} missing in preview`,
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [result, textureCacheEpoch, imageBytes])

  useEffect(() => {
    if (!imageBytes) {
      setBusy(false)
      setConvertPending(false)
      return
    }
    const generation = ++convertGenerationRef.current
    setConvertPending(true)
    const timer = window.setTimeout(() => {
      if (generation !== convertGenerationRef.current) return
      convertInflightRef.current += 1
      setBusy(true)
      setStatus('Solving map colors and structure…')
      convert(imageBytes, options)
        .then((next) => {
          if (generation !== convertGenerationRef.current) return
          setResult(next)
          setTextureWarnings([])
          setStatus('Ready to export')
          // Side-effects from convert — skip while restoring history.
          if (isRestoring()) return
          setOptions((current) => {
            let nextOptions = current
            // Keep maxHeight in sync with the last Auto result so turning Auto off
            // seeds a sensible cap instead of a stale default.
            if (current.staircaseHeightAuto && current.mode === 'staircase') {
              const needed = Math.min(384, Math.max(3, next.build.height))
              if (needed !== current.maxHeight) {
                nextOptions = { ...nextOptions, maxHeight: needed }
              }
            }
            if (current.trimTransparent && current.sizeMode === 'custom') {
              const nextX = next.build.width
              const nextZ =
                current.orientation === 'floor' ? next.build.length : next.build.height
              if (
                nextX <= current.blocksX &&
                nextZ <= current.blocksZ &&
                (nextX !== current.blocksX || nextZ !== current.blocksZ)
              ) {
                nextOptions = {
                  ...nextOptions,
                  blocksX: clampMapartBlocks(nextX),
                  blocksZ: clampMapartBlocks(nextZ),
                }
              }
            }
            return nextOptions
          })
        })
        .catch((error: unknown) => {
          if (generation !== convertGenerationRef.current) return
          setStatus(statusFromError('Conversion failed', error, { operation: 'convert map art' }))
        })
        .finally(() => {
          convertInflightRef.current = Math.max(0, convertInflightRef.current - 1)
          if (convertInflightRef.current === 0) setBusy(false)
          if (generation === convertGenerationRef.current) setConvertPending(false)
        })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [imageBytes, options])

  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    },
    [sourceUrl],
  )

  useEffect(() => {
    if (!result) return
    const fit = () => {
      if (!previewFrame.current) return
      setZoomImmediately(fitZoomForFrame())
    }
    if (shouldFitNextPreview.current) {
      fit()
      shouldFitNextPreview.current = false
    } else {
      // Keep zoom inside the new size-based min when the art footprint / window changes.
      const minZoom = minZoomForArt()
      if (zoomRef.current < minZoom) setZoomImmediately(minZoom)
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [result, artWidth, artLength])

  // Re-centre when the art itself changes or the 2D/3D and compare views swap.
  // Remounting the lazy viewer is handled by CSS, so a mid-browse texture reload
  // no longer throws away where the user had scrolled to.
  useEffect(() => {
    if (!result || previewView !== '2d') return
    let alive = true
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) centerMapPreview()
      })
    })
    return () => {
      alive = false
      cancelAnimationFrame(id)
    }
  }, [result, previewView, compare, artWidth, artLength])

  async function openImage(file: File) {
    if (!isAllowedMapImage(file)) {
      setStatus(`Choose an image (${MAP_IMAGE_FORMATS_HINT})`)
      return
    }
    const hadImage = Boolean(imageBytes)
    try {
      setBusy(true)
      setStatus(fileProgressLabel('Loading', file.name))
      setTextureWarnings([])
      setResult(null)
      const imported = await importMapImage(file)
      const [mapsX, mapsY] = autoMapGrid(imported.width, imported.height)
      if (hadImage) recordBeforeChange()
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      shouldFitNextPreview.current = true
      setSourceUrl(imported.previewUrl)
      setFileName(imported.fileName)
      setResult(null)
      setOptions((current) => ({
        ...current,
        mapsX,
        mapsY,
        blocksX: clampMapartBlocks(imported.width),
        blocksZ: clampMapartBlocks(imported.height),
      }))
      setImageBytes(imported.bytes)
      if (!hadImage) resetHistory()
      setStatus(`Loaded ${compactLabel(imported.fileName, 40)} (${imported.width}×${imported.height})`)
    } catch (error) {
      setStatus(statusFromError('Could not open image', error, { operation: 'import map image' }))
    } finally {
      setBusy(false)
    }
  }

  function update<K extends keyof ConvertOptions>(key: K, value: ConvertOptions[K]) {
    recordBeforeChange(mapsCoalesceKey(key))
    setOptions((current) => ({ ...current, [key]: value }))
  }

  function toggleColor(color: MapColor) {
    recordBeforeChange()
    setActivePreset('custom')
    setOptions((current) => {
      const disabled = current.disabledColorIds.includes(color.id)
      return {
        ...current,
        disabledColorIds: disabled
          ? current.disabledColorIds.filter((id) => id !== color.id)
          : [...current.disabledColorIds, color.id],
      }
    })
  }

  function setBlockOverride(colorId: number, defaultBlock: string, nextState: string) {
    recordBeforeChange()
    setActivePreset('custom')
    setOptions((current) => {
      const next = { ...current.blockOverrides }
      if (nextState === defaultBlock) delete next[colorId]
      else next[colorId] = nextState
      return { ...current, blockOverrides: next }
    })
  }

  function applyPreset(preset: MaterialPreset) {
    if (!palette) return
    recordBeforeChange()
    const next = applyMaterialPreset(palette, preset)
    setActivePreset(preset)
    setOptions((current) => ({
      ...current,
      disabledColorIds: next.disabledColorIds,
      blockOverrides: next.blockOverrides,
    }))
  }

  const stats = result?.build
  const shadingModes = mapShadingModesAvailable(options)
  const usedColourBlocks = useMemo(() => {
    if (!palette) return []
    const counts = new Map<string, number>()
    for (const material of result?.build.materials ?? []) {
      counts.set(material.block, material.count)
    }
    const rows: {
      colorId: number
      label: string
      block: string
      rgb: [number, number, number]
      count: number | null
    }[] = []
    for (const color of palette.colors) {
      if (color.transparent) continue
      if (options.disabledColorIds.includes(color.id)) continue
      const block = options.blockOverrides[color.id] ?? color.block
      rows.push({
        colorId: color.id,
        label: friendlyMapColorLabel(color),
        block,
        rgb: color.rgb,
        count: counts.get(block) ?? null,
      })
    }
    rows.sort((a, b) => {
      const ca = a.count ?? -1
      const cb = b.count ?? -1
      if (ca !== cb) return cb - ca
      return a.label.localeCompare(b.label)
    })
    return rows
  }, [palette, options.disabledColorIds, options.blockOverrides, result])
  const visibleColourBlocks = useMemo(() => {
    const query = materialSearch.trim().toLowerCase()
    if (!query) return usedColourBlocks
    return usedColourBlocks.filter((row) =>
      friendlyBlockName(row.block).toLowerCase().includes(query)
      || row.block.toLowerCase().includes(query)
      || row.label.toLowerCase().includes(query),
    )
  }, [usedColourBlocks, materialSearch])
  const usedVisibleColourBlocks = useMemo(
    () => visibleColourBlocks.filter((row) => row.count != null),
    [visibleColourBlocks],
  )
  const otherVisibleColourBlocks = useMemo(
    () => visibleColourBlocks.filter((row) => row.count == null),
    [visibleColourBlocks],
  )
  const paletteRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of result?.build.materials ?? []) {
      counts.set(material.block, material.count)
    }
    return (palette?.colors ?? [])
      .filter((color) => !color.transparent)
      .map((color) => {
        const choices = blockChoices(color)
        const requested = options.blockOverrides[color.id] ?? color.block
        const selected = isHostAttachedColourBlock(requested) || isInfestedBlock(requested)
          ? (choices[0]?.state ?? color.block)
          : (choices.find((choice) => choice.id === requested.split('[')[0])?.state ?? requested)
        const filtered = choices.filter((choice) =>
          matchesMaterialSearch(choice, paletteSearch),
        )
        const colorMatches = mapColorMatchesSearch(color, paletteSearch)
        const usedCount = counts.get(selected) ?? 0
        return {
          color,
          selected,
          usedCount,
          visible: !paletteSearch.trim() || filtered.length > 0 || colorMatches,
        }
      })
      .filter((row) => row.visible)
      .sort((a, b) => {
        const aUsed = a.usedCount > 0 ? 1 : 0
        const bUsed = b.usedCount > 0 ? 1 : 0
        if (aUsed !== bUsed) return bUsed - aUsed
        if (a.usedCount !== b.usedCount) return b.usedCount - a.usedCount
        return friendlyMapColorLabel(a.color).localeCompare(friendlyMapColorLabel(b.color))
      })
  }, [options.blockOverrides, palette, paletteSearch, result])
  const usedPaletteRows = useMemo(
    () => paletteRows.filter((row) => row.usedCount > 0),
    [paletteRows],
  )
  const otherPaletteRows = useMemo(
    () => paletteRows.filter((row) => row.usedCount === 0),
    [paletteRows],
  )
  const supportChoices = useMemo(
    () => (palette ? staircaseSupportChoices(palette) : []),
    [palette],
  )

  function setVisibleColors(enabled: boolean) {
    recordBeforeChange()
    setActivePreset('custom')
    const visibleIds = new Set(paletteRows.map((row) => row.color.id))
    setOptions((current) => ({
      ...current,
      disabledColorIds: enabled
        ? current.disabledColorIds.filter((id) => !visibleIds.has(id))
        : [...new Set([...current.disabledColorIds, ...visibleIds])],
    }))
  }

  function fitZoomForFrame(): number {
    const frame = previewFrame.current
    if (!frame) return 1
    const availableWidth = Math.max(1, frame.clientWidth - FRAME_PADDING * 2)
    const availableHeight = Math.max(1, frame.clientHeight - FRAME_PADDING * 2)
    return Math.min(
      availableWidth / Math.max(1, artWidth),
      availableHeight / Math.max(1, artLength),
      1,
    )
  }

  /** Smallest zoom allowed — based on fitting this map/pixel art in the preview. */
  function minZoomForArt(): number {
    return Math.max(0.01, fitZoomForFrame() * MIN_ZOOM_FIT_FACTOR)
  }

  function fitPreview() {
    if (!result || !previewFrame.current) return
    setZoomImmediately(fitZoomForFrame())
  }

  function setZoomImmediately(next: number) {
    if (zoomScrollAdjust.current !== null) {
      cancelAnimationFrame(zoomScrollAdjust.current)
      zoomScrollAdjust.current = null
    }
    const clamped = Math.min(MAX_ZOOM, Math.max(minZoomForArt(), next))
    zoomRef.current = clamped
    setZoom(clamped)
    requestAnimationFrame(() => centerMapPreview())
  }

  /**
   * Park the view on the middle of the art. Art smaller than the frame is
   * centred by `margin: auto` in CSS, which survives the 2D viewer remounting;
   * this only has to centre the scroll for art that overflows.
   */
  function centerMapPreview() {
    const frame = previewFrame.current
    const image = mapImage.current
    if (!frame || !image || previewView !== '2d') return
    const z = zoomRef.current
    const imgW = artWidth * z
    const imgH = artLength * z
    image.style.width = `${imgW}px`
    const viewW = Math.max(0, frame.clientWidth - FRAME_PADDING * 2)
    const viewH = Math.max(0, frame.clientHeight - FRAME_PADDING * 2)
    frame.scrollLeft = imgW > viewW ? (imgW - viewW) / 2 : 0
    frame.scrollTop = imgH > viewH ? (imgH - viewH) / 2 : 0
  }

  function changeZoom(multiplier: number, clientX?: number, clientY?: number) {
    const frame = previewFrame.current
    const image = mapImage.current
    if (!frame || !image) return

    const current = zoomRef.current
    const minZoom = minZoomForArt()
    if (multiplier > 1 && current >= MAX_ZOOM) return
    if (multiplier < 1 && current <= minZoom) return
    const next = Math.min(MAX_ZOOM, Math.max(minZoom, current * multiplier))
    if (next === current) return

    const frameRect = frame.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    const pointerX = clientX ?? frameRect.left + frame.clientWidth / 2
    const pointerY = clientY ?? frameRect.top + frame.clientHeight / 2
    const localX = Math.min(
      artWidth,
      Math.max(0, (pointerX - imageRect.left) / current),
    )
    const localY = Math.min(
      artLength,
      Math.max(0, (pointerY - imageRect.top) / current),
    )

    zoomRef.current = next
    image.style.width = `${artWidth * next}px`
    setZoom(next)

    // Hold the point under the cursor still by scrolling. Art that fits the
    // frame has nothing to scroll and stays centred, which is what you want
    // when the whole picture is already on screen.
    const applyScroll = () => {
      const latestFrame = previewFrame.current
      const latestImage = mapImage.current
      if (!latestFrame || !latestImage) return
      const rect = latestImage.getBoundingClientRect()
      latestFrame.scrollLeft += rect.left + localX * next - pointerX
      latestFrame.scrollTop += rect.top + localY * next - pointerY
    }

    applyScroll()
    if (zoomScrollAdjust.current !== null) {
      cancelAnimationFrame(zoomScrollAdjust.current)
    }
    zoomScrollAdjust.current = requestAnimationFrame(() => {
      applyScroll()
      zoomScrollAdjust.current = requestAnimationFrame(() => {
        applyScroll()
        zoomScrollAdjust.current = null
      })
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Button variant="soft" color="gray" size="2" className="back-button" onClick={onBack}>
          ← Tools
        </Button>
        <div className="brand-mark" aria-hidden="true">M</div>
        <div className="brand-copy">
          <strong>{options.artKind === 'pixelArt' ? 'Pixel art' : 'Map art'}</strong>
          <span>StructureLab · maps</span>
        </div>
        <TopbarStatus status={status} busy={busy || convertPending} ready={Boolean(result)} />
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

      <main className="workspace">
        <aside className="control-panel">
          <PanelTitle step="01" title="Source image" />
          <DropZone
            dragging={dragging}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files[0]
              if (file) void openImage(file)
            }}
          >
            <span className="ui-drop-icon">＋</span>
            <strong title={fileName || undefined}>{fileName || 'Choose or drop an image'}</strong>
            <small>{MAP_IMAGE_FORMATS_HINT}</small>
          </DropZone>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept={MAP_IMAGE_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void openImage(file)
            }}
          />

          <div className="panel-divider" />
          <PanelTitle step="02" title="Art type" />
          <Segmented
            value={options.artKind}
            onChange={(kind) => {
              if (kind === options.artKind) return
              recordBeforeChange()
              setOptions((current) => {
                if (kind === 'pixelArt') {
                  return {
                    ...current,
                    artKind: kind,
                    mode: 'flat',
                    sizeMode: current.sizeMode === 'maps' ? 'custom' : current.sizeMode,
                    blocksX:
                      current.sizeMode === 'maps'
                        ? current.mapsX * 128
                        : current.blocksX,
                    blocksZ:
                      current.sizeMode === 'maps'
                        ? current.mapsY * 128
                        : current.blocksZ,
                  }
                }
                return {
                  ...current,
                  artKind: kind,
                  orientation: 'floor',
                }
              })
            }}
            options={[
              { value: 'mapArt', label: 'Map art' },
              { value: 'pixelArt', label: 'Pixel art' },
            ]}
          />
          <p className="field-hint">
            {options.artKind === 'mapArt' ? (
              <>
                Built for Minecraft maps — <strong>flat</strong> and <strong>staircase</strong>{' '}
                shading available.
              </>
            ) : (
              <>
                In-world pixel art — pick a facing; map shading stays off.
              </>
            )}
          </p>
          <Segmented
            size="1"
            className="ui-segmented--dense"
            value={options.orientation}
            onChange={(facing) => update('orientation', facing)}
            options={(
              [
                ['floor', 'Floor'],
                ['wallSouth', 'Wall S'],
                ['wallNorth', 'Wall N'],
                ['wallEast', 'Wall E'],
                ['wallWest', 'Wall W'],
              ] as const
            ).map(([facing, label]) => ({
              value: facing,
              label,
              disabled: options.artKind === 'mapArt' && facing !== 'floor',
              title:
                options.artKind === 'mapArt' && facing !== 'floor'
                  ? 'Map art must stay on the floor for correct map shading'
                  : orientationLabel(facing),
            }))}
          />

          <div className="panel-divider" />
          <PanelTitle step="03" title={options.artKind === 'mapArt' ? 'Map footprint' : 'Art size'} />
          <Segmented
            value={options.sizeMode}
            onChange={(mode) => {
              if (mode === options.sizeMode) return
              if (options.artKind === 'pixelArt' && mode === 'maps') return
              recordBeforeChange()
              if (mode === 'custom') {
                const footprint = mapartFootprint({ ...options, sizeMode: 'maps' })
                setOptions((current) => ({
                  ...current,
                  sizeMode: 'custom',
                  blocksX: footprint.width,
                  blocksZ: footprint.length,
                }))
              } else {
                const footprint = mapartFootprint(options)
                const [mapsX, mapsY] = autoMapGrid(footprint.width, footprint.length)
                setOptions((current) => ({
                  ...current,
                  sizeMode: 'maps',
                  mapsX,
                  mapsY,
                }))
              }
            }}
            options={[
              {
                value: 'maps',
                label: 'Map tiles',
                disabled: options.artKind === 'pixelArt',
                title:
                  options.artKind === 'pixelArt'
                    ? 'Pixel art uses an exact block size'
                    : undefined,
              },
              { value: 'custom', label: 'Custom size' },
            ]}
          />
          {options.sizeMode === 'maps' ? (
            <div className="two-fields">
              <NumberField
                label="Maps wide"
                value={options.mapsX}
                onChange={(value) => update('mapsX', value)}
                onEditEnd={endCoalesce}
              />
              <NumberField
                label="Maps tall"
                value={options.mapsY}
                onChange={(value) => update('mapsY', value)}
                onEditEnd={endCoalesce}
              />
            </div>
          ) : (
            <div className="two-fields">
              <NumberField
                label={options.orientation === 'floor' ? 'Blocks east' : 'Blocks wide'}
                value={options.blocksX}
                onChange={(value) => update('blocksX', clampMapartBlocks(value))}
                onEditEnd={endCoalesce}
              />
              <NumberField
                label={options.orientation === 'floor' ? 'Blocks south' : 'Blocks tall'}
                value={options.blocksZ}
                onChange={(value) => update('blocksZ', clampMapartBlocks(value))}
                onEditEnd={endCoalesce}
              />
            </div>
          )}
          <div className="metric-strip">
            <span>
              <b>{mapartFootprint(options).width}</b>{' '}
              {options.orientation === 'floor' ? 'east' : 'wide'}
            </span>
            <span>
              <b>{mapartFootprint(options).length}</b>{' '}
              {options.orientation === 'floor' ? 'south' : 'tall'}
            </span>
            {options.artKind === 'mapArt' && options.sizeMode === 'custom' && (
              <span>
                covers ~{Math.ceil(mapartFootprint(options).width / 128)}×
                {Math.ceil(mapartFootprint(options).length / 128)} maps
              </span>
            )}
            {options.artKind === 'pixelArt' && (
              <span>{orientationLabel(options.orientation)}</span>
            )}
          </div>
          <SelectField
            label="Fit image"
            value={options.fit}
            onChange={(value) => update('fit', value as ConvertOptions['fit'])}
            options={[
              ['stretch', 'Stretch to grid'],
              ['contain', 'Contain with padding'],
              ['cover', 'Cover and crop'],
            ]}
          />
          <CheckRow
            checked={options.trimTransparent}
            onChange={(checked) => update('trimTransparent', checked)}
            title="Crop empty transparent borders off the image before fitting it to the map or block grid. Needs real transparency (not a white/JPEG background)."
          >
            Trim transparent padding first
          </CheckRow>
          <CheckRow
            checked={options.skipTransparent}
            onChange={(checked) => update('skipTransparent', checked)}
          >
            Skip transparent pixels (leave empty)
          </CheckRow>

          <div className="panel-divider" />
          <PanelTitle step="04" title="Build method" />
          <Segmented
            value={options.mode}
            onChange={(mode) => update('mode', mode)}
            options={[
              {
                value: 'flat',
                label: 'Flat',
              },
              {
                value: 'staircase',
                label: 'Staircase',
                disabled: !shadingModes,
                title: !shadingModes
                  ? 'Staircase shading is only for map art on the floor'
                  : 'Uses block height for darker/brighter map shades — more colours than flat (carpet, wool, and other presets included)',
              },
            ]}
          />
          {!shadingModes && (
            <p className="field-hint">Pixel art uses a flat one-block-deep sheet.</p>
          )}
          <>
              {options.mode === 'staircase' && (
                <>
                  <div className="field-hint">
                    <p>
                      Uses all <strong>three map shades</strong>. Minecraft picks shade from the
                      block to the <strong>north</strong>:
                    </p>
                    <ul className="field-hint-list">
                      <li>
                        <strong>Dark</strong> — one step down
                      </li>
                      <li>
                        <strong>Normal</strong> — same height
                      </li>
                      <li>
                        <strong>Bright</strong> — one step up
                      </li>
                    </ul>
                    <p>
                      <strong>Default max</strong> 128 · <strong>Auto</strong> keeps the best
                      colour match (rebane / StructureLab / mix) and only re-plans near ~320
                      (modern world height).
                    </p>
                  </div>
                  <div className="height-setting">
                    <CheckRow
                      checked={options.staircaseHeightAuto}
                      onChange={(auto) => {
                        recordBeforeChange()
                        setOptions((current) => ({
                          ...current,
                          staircaseHeightAuto: auto,
                          maxHeight: auto
                            ? current.maxHeight
                            : Math.min(
                                384,
                                Math.max(3, stats?.height ?? current.maxHeight ?? 128),
                              ),
                        }))
                      }}
                    >
                      Auto height (best quality, soft-capped ~320)
                    </CheckRow>
                    <RangeField
                      label={
                        options.staircaseHeightAuto
                          ? 'Optimal height (read-only)'
                          : 'Maximum build height'
                      }
                      value={
                        options.staircaseHeightAuto
                          ? Math.min(384, Math.max(3, stats?.height ?? 3))
                          : options.maxHeight
                      }
                      min={3}
                      max={384}
                      disabled={options.staircaseHeightAuto}
                      onChange={(value) => update('maxHeight', value)}
                      onEditEnd={endCoalesce}
                    />
                    <div className="field-hint">
                      {options.staircaseHeightAuto ? (
                        stats ? (
                          <p>
                            Auto needs <strong>{stats.height}</strong> blocks of stairs
                            {stats.height >= 320
                              ? ' (re-planned to stay near world height).'
                              : ' for this image.'}
                          </p>
                        ) : (
                          <p>Convert once to see how tall Auto would build.</p>
                        )
                      ) : (
                        <>
                          <p>
                            <strong>128</strong> fits modern survival · max <strong>384</strong>.
                          </p>
                          <ul className="field-hint-list">
                            <li>Older worlds (pre-1.18): keep ≤256</li>
                            <li>If the art needs more, stairs are re-planned (map may shift a little)</li>
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                  <SelectField
                    label="Height layout"
                    value={options.staircaseHeightAnchor}
                    onChange={(value) =>
                      update(
                        'staircaseHeightAnchor',
                        value as ConvertOptions['staircaseHeightAnchor'],
                      )
                    }
                    options={[
                      ['floor', 'From the ground up'],
                      ['floating', 'Off (exact stairs)'],
                    ]}
                  />
                  <div className="field-hint">
                    <ul className="field-hint-list">
                      <li>
                        <strong>Ground up</strong> — north control row sits on y=0 and the
                        column only builds upward. Same blocks as the colour match; shade
                        may change so nothing digs down.
                      </li>
                      <li>
                        <strong>Off</strong> — exact staircase (best colour). Each column
                        still sits on the ground; a dip in one column will not lift the
                        rest of the map.
                      </li>
                    </ul>
                    <p>Neither fills solid pillars under the map surface.</p>
                  </div>
                  <SelectField
                    label="Staircase starts from"
                    value={options.staircaseStartEdge}
                    onChange={(value) =>
                      update(
                        'staircaseStartEdge',
                        value as ConvertOptions['staircaseStartEdge'],
                      )
                    }
                    options={[
                      ['top', 'Top of image (north)'],
                      ['bottom', 'Bottom of image (south)'],
                    ]}
                  />
                  <div className="field-hint">
                    <p>
                      Adds a <strong>control row</strong> so the first map line shades correctly.
                    </p>
                    <ul className="field-hint-list">
                      <li>
                        <strong>North (top)</strong> — matches MapartCraft
                      </li>
                      <li>
                        <strong>South (bottom)</strong> — flips dark/bright so the in-game map
                        stays valid (2D preview can look different)
                      </li>
                    </ul>
                  </div>
                </>
              )}
              <CheckRow
                checked={options.supportUnderGravity}
                onChange={(checked) => update('supportUnderGravity', checked)}
              >
                Place support{' '}
                {options.orientation === 'floor' ? 'under' : 'behind'} gravity blocks and carpets
              </CheckRow>
              {(options.mode === 'staircase' || options.supportUnderGravity) && (
                <button
                  type="button"
                  className="support-block-pick"
                  onClick={() =>
                    setReplaceTarget({
                      kind: 'support',
                      selectedState: options.staircaseSupportBlock,
                      sourceState: 'minecraft:cobblestone',
                      enabled: true,
                    })
                  }
                >
                  <span className="support-block-pick-label">Support</span>
                  <span className="support-block-pick-value">
                    <BlockIcon block={options.staircaseSupportBlock} />
                    <span>{friendlyBlockName(options.staircaseSupportBlock)}</span>
                  </span>
                  <span className="support-block-pick-action">Change</span>
                </button>
              )}
          </>
          <SelectField
            label="Colour matching"
            value={options.colourMatching}
            onChange={(value) =>
              update('colourMatching', value as ConvertOptions['colourMatching'])
            }
            options={[
              ['structureLabMix', 'StructureLab perceptual mix'],
              ['rebaneMapartClassic', 'rebane2001 MapartCraft (better colour)'],
              ['ciede2000', 'CIEDE2000'],
              ['oklabHueGuard', 'Oklab + hue guard'],
            ]}
          />
          <div className="field-hint">
            <p>How each pixel picks a map colour:</p>
            <ul className="field-hint-list">
              <li>
                <strong>Perceptual mix</strong> — matches the blended colour you see; default,
                best on carpet / small maparts
              </li>
              <li>
                <strong>MapartCraft</strong> —{' '}
                <button
                  type="button"
                  className="field-hint-link"
                  onClick={() =>
                    window.open(
                      'https://github.com/rebane2001/mapartcraft',
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  better colour
                </button>
              </li>
              <li>
                <strong>CIEDE2000</strong> — later CIE Lab formula
              </li>
              <li>
                <strong>Oklab + hue guard</strong> — keeps more colour on sparse packs
              </li>
            </ul>
          </div>
          <SelectField
            label="Dithering"
            value={mixMatching ? 'none' : options.dither}
            disabled={mixMatching}
            onChange={(value) => update('dither', value as ConvertOptions['dither'])}
            options={[
              ['none', 'None'],
              ['floydSteinberg', 'Floyd–Steinberg'],
              ['atkinson', 'Atkinson'],
              ['ordered', 'Ordered 4×4'],
            ]}
          />
          <div className="field-hint">
            {mixMatching ? (
              <p>
                Off while <strong>perceptual mix</strong> is selected — that mode has its own
                dithering.
              </p>
            ) : (
              <ul className="field-hint-list">
                <li>
                  <strong>Floyd–Steinberg</strong> — MapartCraft-style (default)
                </li>
                <li>
                  <strong>Atkinson</strong> — quieter
                </li>
                <li>
                  <strong>Ordered</strong> — patterned
                </li>
                <li>
                  <strong>None</strong> — logos / flat art
                </li>
              </ul>
            )}
          </div>

          <div className="panel-divider" />
          <PanelTitle step="05" title="Color tuning" />
          <RangeField
            label="Brightness"
            value={options.brightness}
            min={-100}
            max={100}
            onChange={(value) => update('brightness', value)}
            onEditEnd={endCoalesce}
          />
          <RangeField
            label="Contrast"
            value={options.contrast}
            min={-100}
            max={100}
            onChange={(value) => update('contrast', value)}
            onEditEnd={endCoalesce}
          />
          <RangeField
            label="Saturation"
            value={options.saturation}
            min={-100}
            max={100}
            onChange={(value) => update('saturation', value)}
            onEditEnd={endCoalesce}
          />

          <div className="panel-divider" />
          <PanelTitle step="06" title="Build materials" />
          <div className="ui-preset-grid is-wide">
            {MATERIAL_PRESETS.map(([preset, label]) => (
              <ChipButton
                key={preset}
                active={activePreset === preset}
                disabled={!palette}
                onClick={() => applyPreset(preset)}
                title="Replaces custom block picks"
              >
                {label}
              </ChipButton>
            ))}
          </div>
          {options.artKind === 'pixelArt' && activePreset === 'all' && (
            <div className="field-hint">
              <p>
                Pixel art matches <strong>every full cube</strong> in this Minecraft version
                by its real texture — not the 62 map colours. Wool / concrete / terracotta /
                carpet presets still force those families.
              </p>
            </div>
          )}
          {activePreset === 'carpet' && (
            <div className="field-hint">
              <p>
                Carpet is limited to the <strong>16 dye</strong> map colours.
              </p>
              <ul className="field-hint-list">
                <li>
                  Prefer <strong>staircase</strong> + <strong>perceptual mix</strong>
                </li>
                <li>Nudge saturation up if it still looks dull</li>
              </ul>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="3"
            className="ui-export"
            disabled={!palette}
            onClick={() => setPaletteOpen(true)}
          >
            <span className="ui-export-copy">
              <Text size="2" weight="medium">Edit colours</Text>
              <Text size="1">
                {options.artKind === 'pixelArt'
                  ? 'Disable colour families or change blocks — matching uses this version’s cubes'
                  : 'Enable shades and change their blocks'}
              </Text>
            </span>
            <Text size="4">›</Text>
          </Button>
        </aside>

        <section className="preview-stage">
          <div className="preview-toolbar">
            <div>
              <h1>{options.artKind === 'pixelArt' ? 'Pixel art' : 'Map art'}</h1>
              <p>
                {previewView === '3d'
                  ? map3dNavigation === 'free'
                    ? 'Free movement · click to look · WASD move · scroll to change speed · Space/Shift up/down · Esc unlock'
                    : 'Orbit view · drag to orbit · scroll to zoom'
                  : options.artKind === 'pixelArt'
                    ? 'Block textures · North is up'
                    : map2dStyle === 'mapColors'
                      ? 'Map-item colours (what the filled map shows in-game) · includes staircase shades'
                      : 'Block top textures (build look) · shades share the same block so height may look unchanged'}
              </p>
            </div>
            <div className="preview-actions">
              {result && (
                <Segmented
                  value={previewView}
                  onChange={(next) => {
                    setPreviewView(next)
                    if (next === '3d') setCompare(false)
                  }}
                  options={[
                    { value: '2d', label: '2D' },
                    { value: '3d', label: '3D' },
                  ]}
                />
              )}
              {result && previewView === '2d' && options.artKind === 'mapArt' && (
                <Segmented
                  value={map2dStyle}
                  onChange={setMap2dStyle}
                  options={[
                    {
                      value: 'mapColors',
                      label: 'Map colour',
                      title: 'Exact Minecraft map colours, including darker/brighter staircase shades',
                    },
                    {
                      value: 'blockTops',
                      label: 'Block tops',
                      title: 'Top face of each placed block — useful for materials, not map shading',
                    },
                  ]}
                />
              )}
              {result && previewView === '3d' && (
                <Segmented
                  value={map3dNavigation}
                  onChange={setMap3dNavigation}
                  options={[
                    { value: 'orbit', label: 'Orbit', title: 'Orbit around the build' },
                    { value: 'free', label: 'Free', title: 'Walk / fly through the build' },
                  ]}
                />
              )}
              {result && previewView === '2d' && (
                <div className="zoom-cluster" aria-label="Preview zoom controls">
                  <IconButton variant="soft" color="gray" size="1" onClick={() => changeZoom(0.8)} title="Zoom out">−</IconButton>
                  <Button variant="soft" color="gray" size="1" onClick={fitPreview} title="Fit preview">
                    {Math.round(zoom * 100)}%
                  </Button>
                  <IconButton variant="soft" color="gray" size="1" onClick={() => changeZoom(1.25)} title="Zoom in">＋</IconButton>
                  <Button variant="soft" size="1" onClick={fitPreview}>Fit</Button>
                </div>
              )}
              {previewView === '2d' && (
                <CheckRow compact checked={compare} onChange={setCompare}>
                  Source
                </CheckRow>
              )}
              {previewView === '3d' && map3dNavigation === 'orbit' && (
                <span className="preview-hint">Drag to orbit · scroll to zoom</span>
              )}
              {previewView === '3d' && map3dNavigation === 'free' && (
                <span className="preview-hint">Click canvas · WASD · scroll speed · Space / Shift</span>
              )}
            </div>
          </div>
          <div
            ref={previewFrame}
            className={`canvas-frame ${!result ? 'empty' : ''} ${
              previewView === '3d' && result ? 'voxel-frame preview-has-content' : ''
            } ${result && previewView === '2d' ? 'preview-has-content' : ''} ${
              draggingPreview && previewView === '2d' ? 'dragging' : ''
            }`}
            onWheel={(event) => {
              if (previewView === '3d' && map3dNavigation === 'free') {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              if (!result || previewView !== '2d') return
              event.preventDefault()
              if (event.deltaY === 0) return
              changeZoom(
                Math.exp(event.deltaY < 0 ? 0.18 : -0.18),
                event.clientX,
                event.clientY,
              )
            }}
            onPointerDown={(event) => {
              if (!result || previewView !== '2d' || event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              panStart.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                scrollLeft: event.currentTarget.scrollLeft,
                scrollTop: event.currentTarget.scrollTop,
              }
              setDraggingPreview(true)
            }}
            onPointerMove={(event) => {
              if (previewView !== '2d') return
              const start = panStart.current
              if (!start || start.pointerId !== event.pointerId) return
              event.currentTarget.scrollLeft =
                start.scrollLeft - (event.clientX - start.x)
              event.currentTarget.scrollTop =
                start.scrollTop - (event.clientY - start.y)
            }}
            onPointerUp={(event) => {
              if (panStart.current?.pointerId !== event.pointerId) return
              panStart.current = null
              setDraggingPreview(false)
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              panStart.current = null
              setDraggingPreview(false)
            }}
          >
            {result && previewView === '3d' ? (
              <Suspense fallback={<LoadOverlay label="Loading 3D preview…" indeterminate />}>
                <MapArt3DViewer
                  key={`map3d-${textureCacheEpoch}`}
                  previewBlockPalette={result.previewBlockPalette ?? []}
                  previewVoxels={result.previewVoxels ?? ''}
                  previewVoxelStride={result.previewVoxelStride ?? 1}
                  width={result.build.width}
                  length={result.build.length}
                  height={result.build.height}
                  mapsX={result.build.mapsX}
                  mapsY={result.build.mapsY}
                  navigationMode={map3dNavigation}
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
            ) : (
              <div className="canvas-center">
                {result && compare ? (
                  <div
                    ref={mapImage}
                    className="map-image-wrap"
                    style={
                      {
                        '--maps-x': result.build.mapsX,
                        '--maps-y': result.build.mapsY,
                        '--art-width': artWidth,
                        '--art-length': artLength,
                        width: `${artWidth * zoom}px`,
                      } as React.CSSProperties
                    }
                  >
                    <img src={sourceUrl} alt="Original source" />
                  </div>
                ) : result ? (
                  options.artKind === 'mapArt' && map2dStyle === 'mapColors' ? (
                    <div
                      ref={mapImage}
                      className="map-image-wrap"
                      style={
                        {
                          '--maps-x': result.build.mapsX,
                          '--maps-y': result.build.mapsY,
                          '--art-width': artWidth,
                          '--art-length': artLength,
                          width: `${artWidth * zoom}px`,
                        } as React.CSSProperties
                      }
                    >
                      <img
                        src={result.previewDataUrl}
                        alt="Minecraft map-item colour preview"
                      />
                      <div className="map-grid" />
                    </div>
                  ) : (
                  <Suspense
                    fallback={
                      <div
                        ref={mapImage}
                        className="map-image-wrap"
                        style={
                          {
                            '--maps-x': result.build.mapsX,
                            '--maps-y': result.build.mapsY,
                            '--art-width': artWidth,
                            '--art-length': artLength,
                            width: `${artWidth * zoom}px`,
                          } as React.CSSProperties
                        }
                      >
                        <img src={result.previewDataUrl} alt="Minecraft map-color preview" />
                        <div className="map-grid" />
                      </div>
                    }
                  >
                    <MapArt2DViewer
                      key={`map2d-${textureCacheEpoch}`}
                      ref={mapImage}
                      width={artWidth}
                      length={artLength}
                      mapsX={result.build.mapsX}
                      mapsY={result.build.mapsY}
                      zoom={zoom}
                      previewSurfacePalette={result.previewSurfacePalette ?? []}
                      previewSurfaceIndices={result.previewSurfaceIndices ?? ''}
                      previewDataUrl={result.previewDataUrl}
                    />
                  </Suspense>
                  )
                ) : (
                  <div className="empty-canvas">
                    <div className="empty-compass"><span>N</span></div>
                    <h2>Your map mosaic will appear here</h2>
                    <p>Import an image, then pick map tiles or a custom block size.</p>
                    <Button onClick={() => fileInput.current?.click()}>Import image</Button>
                  </div>
                )}
              </div>
            )}
            {(busy || loadProgress) && (
              <LoadOverlay {...overlayFromProgress(loadProgress, 'Building preview')} />
            )}
          </div>
          {result && (
            <div className="preview-footer">
              <span>Source {result.sourceWidth}×{result.sourceHeight}px</span>
              <span>
                Art {artWidth}×{artLength}
              </span>
              {stats && (
                <span title="X × Y × Z of placed blocks. Staircase length is +1 for the control row.">
                  Structure {stats.width}×{stats.height}×{stats.length}
                  {options.mode === 'staircase' ? ' (incl. control row)' : ''}
                </span>
              )}
              <span>
                {options.artKind === 'mapArt'
                  ? options.sizeMode === 'custom'
                    ? `covers ${stats?.mapsX}×${stats?.mapsY} maps`
                    : `${stats?.mapsX}×${stats?.mapsY} maps`
                  : orientationLabel(options.orientation)}
              </span>
            </div>
          )}
        </section>

        <aside className="output-panel">
          <PanelTitle step="07" title="Build summary" />
          {stats ? (
            <>
              <div className="summary-grid">
                <SummaryStat
                  label={options.sizeMode === 'custom' ? 'Covers maps' : 'Map tiles'}
                  value={`${stats.mapsX} × ${stats.mapsY}`}
                />
                <SummaryStat label="Footprint" value={`${artWidth} × ${artLength}`} />
                <SummaryStat label="Height" value={`${stats.height}`} />
                <SummaryStat
                  label="Blocks"
                  value={stats.materials
                    .reduce((sum, material) => sum + material.count, 0)
                    .toLocaleString()}
                />
              </div>
              {stats.warnings.length > 0 ? (
                <CopyableNotice title="Build notes" body={stats.warnings.join('\n')} />
              ) : null}
              <MissingTextureWarnings blocks={textureWarnings} />
            </>
          ) : (
            <div className="summary-empty">
              {imageBytes ? 'Converting…' : 'Load an image to start.'}
            </div>
          )}

          <div className="material-heading">
            <strong>Blocks in this map</strong>
            <span>
              {result
                ? `${usedVisibleColourBlocks.length} used`
                : visibleColourBlocks.length}
            </span>
          </div>
          {usedColourBlocks.length > 8 && (
            <div className="material-tools">
              <SearchField
                placeholder="Filter…"
                value={materialSearch}
                onChange={setMaterialSearch}
              />
            </div>
          )}
          <div className="material-list material-list-clean">
            {usedVisibleColourBlocks.length > 0 && (
              <>
                <div className="material-group-title">
                  Used in this build
                  <b>{usedVisibleColourBlocks.length}</b>
                </div>
                {usedVisibleColourBlocks.map((row) => (
                  <MapsColourBlockRow
                    key={row.colorId}
                    row={row}
                    onPick={() => {
                      const color = palette?.colors.find((entry) => entry.id === row.colorId)
                      if (!color) return
                      setReplaceTarget({
                        color,
                        selectedState: row.block,
                        enabled: true,
                      })
                    }}
                  />
                ))}
              </>
            )}
            {otherVisibleColourBlocks.length > 0 && (
              <>
                <div className="material-group-title">
                  {usedVisibleColourBlocks.length > 0 ? 'Other colours' : 'Colours'}
                  <b>{otherVisibleColourBlocks.length}</b>
                </div>
                {otherVisibleColourBlocks.map((row) => (
                  <MapsColourBlockRow
                    key={row.colorId}
                    row={row}
                    onPick={() => {
                      const color = palette?.colors.find((entry) => entry.id === row.colorId)
                      if (!color) return
                      setReplaceTarget({
                        color,
                        selectedState: row.block,
                        enabled: true,
                      })
                    }}
                  />
                ))}
              </>
            )}
            {visibleColourBlocks.length === 0 && (
              <div className="material-empty">
                {imageBytes
                  ? 'No colours enabled — open Edit colours.'
                  : 'Load an image to see blocks.'}
              </div>
            )}
          </div>

          <div className="export-section">
            <PanelTitle step="08" title="Export" />
            {result?.build.minecraftVersion ? (
              <p className="export-version-note">
                Saves for Minecraft {result.build.minecraftVersion}
                {result.build.dataVersion != null ? ` · data ${result.build.dataVersion}` : ''}
              </p>
            ) : null}
            <ExportButton
              title="All formats bundle"
              detail=".zip · recommended"
              primary
              disabled={!result || convertPending}
              onClick={() => void runExport('all', setStatus, result?.build)}
            />
            <ExportButton
              title="Vanilla structure"
              detail=".nbt · unsplit"
              disabled={!result || convertPending}
              onClick={() => void runExport('vanillaNbt', setStatus, result?.build)}
            />
            <ExportButton
              title="Vanilla structure pieces"
              detail=".zip · Structure Block safe"
              disabled={!result || convertPending}
              onClick={() => void runExport('vanillaSplit', setStatus, result?.build)}
            />
            <ExportButton
              title="Litematica"
              detail={`.litematic · v${litematicSchematicVersion(result?.build.dataVersion ?? 0)}`}
              disabled={!result || convertPending}
              onClick={() =>
                void runExport(
                  litematicExportFormat(result?.build.dataVersion ?? 0),
                  setStatus,
                  result?.build,
                )
              }
            />
            <ExportButton
              title="WorldEdit / FAWE"
              detail=".schem · Sponge v3"
              disabled={!result || convertPending}
              onClick={() => void runExport('spongeV3', setStatus, result?.build)}
            />
          </div>
        </aside>
      </main>

      <AppDialog
        open={Boolean(paletteOpen && palette)}
        onOpenChange={(open) => {
          if (!open) setPaletteOpen(false)
        }}
        eyebrow="Materials"
        title="Choose blocks"
        description="Each card is a map shade. Enable it, then change which block builds that colour."
        tools={
          palette ? (
            <>
              <SearchField
                placeholder="Search shade or block…"
                value={paletteSearch}
                onChange={setPaletteSearch}
              />
              <ChipButton onClick={() => setVisibleColors(true)}>Enable visible</ChipButton>
              <ChipButton onClick={() => setVisibleColors(false)}>Disable visible</ChipButton>
              <Text size="1" color="gray">
                {palette.colors.filter(
                  (color) =>
                    !color.transparent && !options.disabledColorIds.includes(color.id),
                ).length}{' '}
                enabled
              </Text>
            </>
          ) : null
        }
      >
        <div className="map-color-list">
          {usedPaletteRows.length > 0 && (
            <>
              <div className="map-color-list-heading">
                Used in this build
                <span>{usedPaletteRows.length}</span>
              </div>
              {usedPaletteRows.map((row) => (
                <MapColourCard
                  key={row.color.id}
                  color={row.color}
                  selected={row.selected}
                  usedCount={row.usedCount}
                  enabled={!options.disabledColorIds.includes(row.color.id)}
                  onToggle={() => toggleColor(row.color)}
                  onChange={() =>
                    setReplaceTarget({
                      color: row.color,
                      selectedState: row.selected,
                      enabled: !options.disabledColorIds.includes(row.color.id),
                    })
                  }
                />
              ))}
            </>
          )}
          {otherPaletteRows.length > 0 && (
            <>
              <div className="map-color-list-heading">
                {usedPaletteRows.length > 0 ? 'Other map colours' : 'Map colours'}
                <span>{otherPaletteRows.length}</span>
              </div>
              {otherPaletteRows.map((row) => (
                <MapColourCard
                  key={row.color.id}
                  color={row.color}
                  selected={row.selected}
                  usedCount={row.usedCount}
                  enabled={!options.disabledColorIds.includes(row.color.id)}
                  onToggle={() => toggleColor(row.color)}
                  onChange={() =>
                    setReplaceTarget({
                      color: row.color,
                      selectedState: row.selected,
                      enabled: !options.disabledColorIds.includes(row.color.id),
                    })
                  }
                />
              ))}
            </>
          )}
          {paletteRows.length === 0 && (
            <div className="palette-empty">No map colours match these filters.</div>
          )}
        </div>
      </AppDialog>

      {replaceTarget && palette && (
        <BlockReplaceDialog
          palette={palette}
          target={replaceTarget}
          pool={replaceTarget.kind === 'support' ? supportChoices : undefined}
          onClose={() => setReplaceTarget(null)}
          onPick={(state) => {
            if (replaceTarget.kind === 'support') {
              update('staircaseSupportBlock', state)
              setReplaceTarget(null)
              return
            }
            const color = replaceTarget.color
            if (!color) return
            setBlockOverride(color.id, color.block, state)
            setReplaceTarget(null)
          }}
          onReset={() => {
            if (replaceTarget.kind === 'support') {
              update('staircaseSupportBlock', 'minecraft:cobblestone')
              setReplaceTarget(null)
              return
            }
            const color = replaceTarget.color
            if (!color) return
            setBlockOverride(color.id, color.block, color.block)
            setReplaceTarget(null)
          }}
          onToggleEnabled={() => {
            if (replaceTarget.kind === 'support') return
            const color = replaceTarget.color
            if (!color) return
            const enabled = replaceTarget.enabled
            toggleColor(color)
            setReplaceTarget((current) =>
              current ? { ...current, enabled: !enabled } : current,
            )
          }}
        />
      )}
    </div>
  )
}

function MapsColourBlockRow({
  row,
  onPick,
}: {
  row: {
    colorId: number
    label: string
    block: string
    rgb: [number, number, number]
    count: number | null
  }
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className="material-row material-row-pick"
      onClick={onPick}
      title="Change block"
    >
      <BlockIcon block={row.block} color={row.rgb} />
      <span className="material-row-copy">
        <b>{friendlyBlockName(row.block)}</b>
        <small>{row.label}</small>
      </span>
      {row.count != null ? (
        <strong>{row.count.toLocaleString()}</strong>
      ) : (
        <em>Change</em>
      )}
    </button>
  )
}

function MapColourCard({
  color,
  selected,
  usedCount,
  enabled,
  onToggle,
  onChange,
}: {
  color: MapColor
  selected: string
  usedCount: number
  enabled: boolean
  onToggle: () => void
  onChange: () => void
}) {
  const isCustom = selected !== color.block
  const colorLabel = friendlyMapColorLabel(color)
  return (
    <article className={`map-color-card ${enabled ? '' : 'is-disabled'}`}>
      <label className="map-color-card-check">
        <Checkbox
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={`Use ${colorLabel} in the build`}
        />
        <MapColorSwatch color={color} size={32} />
      </label>
      <div className="map-color-card-body">
        <div className="map-color-card-title">
          <strong>{colorLabel}</strong>
          {usedCount > 0 && (
            <span className="map-color-card-badge is-used">In build</span>
          )}
          {isCustom && <span className="map-color-card-badge">Custom</span>}
        </div>
        <div className="map-color-card-block">
          <BlockIcon block={selected} color={color.rgb} />
          <span>{friendlyBlockName(selected)}</span>
        </div>
        <div className="map-color-card-meta">
          {usedCount > 0
            ? `${usedCount.toLocaleString()} in this build`
            : materialCategoryLabel(materialCategory(selected))}
        </div>
        <div className="trait-pills map-color-card-traits">
          {color.gravity && <span>gravity</span>}
          {color.flammable && <span>flammable</span>}
          {color.fluid && <span>fluid</span>}
          {color.needsSupport && <span>support</span>}
        </div>
      </div>
      <Button type="button" variant="soft" disabled={!enabled} onClick={onChange}>
        Change block
      </Button>
    </article>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="summary-stat"><span>{label}</span><b>{value}</b></div>
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
