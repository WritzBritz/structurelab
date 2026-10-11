import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconButton, Text } from '@radix-ui/themes'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { DatapackPattern, SceneVoxel, VoxelPreviewStyle } from '../../types'
import { Segmented } from '../../ui/kit'
import { releaseWebGLRenderer } from '../shared/webglRelease'
import {
  baseBlockId,
  loadBlockCubeFaces,
  loadBlockFaceImage,
  type BlockFaceImage,
} from './blockTextures'
import {
  orderVoxelsForDatapack,
  previewTickMs,
  totalBuildTicks,
  visibleCountAtTick,
} from './datapackOrder'

type PreviewViewMode = '2d' | '3d'

/** Browser / GPU canvas limits — keep the 2D bitmap under this on each axis. */
const MAX_2D_CANVAS_EDGE = 4096
const TEX_2D = 16

type Props = {
  voxels: SceneVoxel[]
  size: [number, number, number]
  pattern: DatapackPattern
  blocksPerTick: number
  delayTicks: number
  datapackName: string
  /** Real export block count — timeline uses this when the preview list is capped. */
  blockCount: number
}

type RevealBucket = {
  mesh: THREE.InstancedMesh
  /** Global order indices ascending — mesh instances packed in this order. */
  orderIndices: number[]
}

function solidTexture(rgb: [number, number, number]): THREE.DataTexture {
  const data = new Uint8Array([rgb[0], rgb[1], rgb[2], 255])
  const texture = new THREE.DataTexture(data, 1, 1)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function missingTexture(): THREE.DataTexture {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
      data[i] = dark ? 0xf8 : 0x00
      data[i + 1] = 0x00
      data[i + 2] = dark ? 0xf8 : 0x00
      data[i + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function faceTexture(source: BlockFaceImage): THREE.Texture {
  const texture = new THREE.Texture(source)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

async function loadBlockTexture(
  block: string,
): Promise<{ texture: THREE.Texture | THREE.Texture[]; missing: boolean }> {
  const cube = await loadBlockCubeFaces(block)
  if (!cube) return { texture: missingTexture(), missing: true }
  if (!cube.distinct) {
    return { texture: faceTexture(cube.faces[2] ?? cube.faces[0]!), missing: false }
  }
  return {
    texture: cube.faces.map((face) => faceTexture(face)),
    missing: false,
  }
}

function applyVisibleCount(buckets: RevealBucket[], visibleCount: number) {
  for (const bucket of buckets) {
    let count = 0
    for (const orderIndex of bucket.orderIndices) {
      if (orderIndex >= visibleCount) break
      count += 1
    }
    bucket.mesh.count = count
    // Count starts at 0 during build — refresh bounds so frustum culling
    // doesn't keep a degenerate sphere and hide the whole mesh.
    if (count > 0) bucket.mesh.computeBoundingSphere()
  }
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path fill="currentColor" d="M3.2 1.6v10.8L12.2 7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path fill="currentColor" d="M3 2h2.6v10H3zm5.4 0H11v10H8.4z" />
    </svg>
  )
}

function RestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        fill="currentColor"
        d="M7 1.2a5.8 5.8 0 1 0 5.5 4H10.8A4.1 4.1 0 1 1 7 2.9V5L10.2 2.4 7 0z"
      />
    </svg>
  )
}

function sampleFaceTexture(tile: BlockFaceImage, cell: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = cell
  canvas.height = cell
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const tw = 'naturalWidth' in tile ? tile.naturalWidth || tile.width : tile.width
  const th = 'naturalHeight' in tile ? tile.naturalHeight || tile.height : tile.height
  ctx.drawImage(tile, 0, 0, tw, th, 0, 0, cell, cell)
  return ctx.getImageData(0, 0, cell, cell)
}

function fill2dRect(
  dst: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
) {
  for (let y = 0; y < h; y += 1) {
    let o = ((y0 + y) * stride + x0) * 4
    for (let x = 0; x < w; x += 1) {
      dst[o] = r
      dst[o + 1] = g
      dst[o + 2] = b
      dst[o + 3] = 255
      o += 4
    }
  }
}

function blit2dNearest(
  dst: Uint8ClampedArray,
  stride: number,
  src: ImageData,
  dx: number,
  dy: number,
  cell: number,
) {
  const s = src.data
  for (let y = 0; y < cell; y += 1) {
    let di = ((dy + y) * stride + dx) * 4
    let si = y * cell * 4
    for (let x = 0; x < cell; x += 1) {
      dst[di] = s[si]!
      dst[di + 1] = s[si + 1]!
      dst[di + 2] = s[si + 2]!
      dst[di + 3] = s[si + 3]!
      di += 4
      si += 4
    }
  }
}

export function DatapackBuildPreview({
  voxels,
  size,
  pattern,
  blocksPerTick,
  delayTicks,
  datapackName,
  blockCount,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvas2dRef = useRef<HTMLCanvasElement>(null)
  const bucketsRef = useRef<RevealBucket[]>([])
  const invalidateRef = useRef<() => void>(() => {})
  const [playing, setPlaying] = useState(true)
  const [tick, setTick] = useState(0)
  const [runId, setRunId] = useState(0)
  /** 2D top-down is default — much lighter for large maparts. */
  const [viewMode, setViewMode] = useState<PreviewViewMode>('2d')
  // Default In-game textures so the preview matches placed blocks.
  const [previewStyle, setPreviewStyle] = useState<VoxelPreviewStyle>('textures')

  const blocksPerTickRef = useRef(blocksPerTick)
  const delayTicksRef = useRef(delayTicks)
  const patternRef = useRef(pattern)
  const visibleCountRef = useRef(0)
  const exportCountRef = useRef(1)
  blocksPerTickRef.current = blocksPerTick
  delayTicksRef.current = delayTicks
  patternRef.current = pattern

  const ordered = useMemo(
    () => orderVoxelsForDatapack(voxels, pattern, datapackName),
    [voxels, pattern, datapackName],
  )
  const orderedRef = useRef(ordered)
  orderedRef.current = ordered

  // Timing follows the real export size so the bar matches the settings estimate.
  const exportCount = Math.max(1, blockCount, ordered.length)
  exportCountRef.current = exportCount

  const maxTick = useMemo(() => {
    if (pattern === 'instant') return 0
    return totalBuildTicks(exportCount, blocksPerTick, delayTicks)
  }, [pattern, exportCount, blocksPerTick, delayTicks])

  const exportVisible = useMemo(() => {
    if (pattern === 'instant') return exportCount
    return visibleCountAtTick(exportCount, blocksPerTick, delayTicks, tick)
  }, [pattern, exportCount, blocksPerTick, delayTicks, tick])

  // Map export progress onto the (possibly shorter) preview instance list.
  const visibleCount = useMemo(() => {
    if (ordered.length <= 0) return 0
    if (pattern === 'instant' || exportCount <= ordered.length) {
      return Math.min(ordered.length, exportVisible)
    }
    return Math.min(
      ordered.length,
      Math.ceil((exportVisible / exportCount) * ordered.length),
    )
  }, [ordered.length, pattern, exportCount, exportVisible])
  visibleCountRef.current = visibleCount

  const tickMs = previewTickMs()

  const currentSeconds = tick / 20
  const totalSeconds = maxTick / 20
  const timelineDisabled = pattern === 'instant' || maxTick <= 0

  function restartPreview() {
    setTick(0)
    setPlaying(pattern !== 'instant')
    setRunId((n) => n + 1)
  }

  useEffect(() => {
    restartPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional reset on these inputs
  }, [pattern, blocksPerTick, delayTicks, ordered, exportCount])

  useEffect(() => {
    if (pattern === 'instant' || !playing) return
    // One game-tick per interval at real 20 TPS — duration matches in-game.
    const id = window.setInterval(() => {
      const count = exportCountRef.current
      const bpt = blocksPerTickRef.current
      const delay = delayTicksRef.current
      const end = totalBuildTicks(count, bpt, delay)
      setTick((current) => {
        if (current >= end) {
          setPlaying(false)
          return end
        }
        return current + 1
      })
    }, tickMs)
    return () => window.clearInterval(id)
  }, [pattern, playing, tickMs, runId])

  // Cache top-face tiles once per style/size — not every animation tick.
  const faceTilesRef = useRef<Map<string, ImageData | null>>(new Map())
  const faceTilesReadyRef = useRef(0)
  const [faceTilesEpoch, setFaceTilesEpoch] = useState(0)

  useEffect(() => {
    if (viewMode !== '2d' || previewStyle !== 'textures') {
      faceTilesRef.current = new Map()
      faceTilesReadyRef.current = 0
      return
    }
    let cancelled = false
    const [sx, , sz] = size
    const width = Math.max(1, Math.floor(sx))
    const length = Math.max(1, Math.floor(sz))
    const cell = Math.max(
      1,
      Math.min(TEX_2D, Math.floor(MAX_2D_CANVAS_EDGE / Math.max(width, length))),
    )

    const unique = new Set<string>()
    for (const voxel of ordered) {
      if (voxel.block) unique.add(voxel.block)
    }

    const run = async () => {
      const textures = new Map<string, ImageData | null>()
      await Promise.all(
        [...unique].map(async (block) => {
          const tile = await loadBlockFaceImage(block)
          textures.set(block, tile ? sampleFaceTexture(tile, cell) : null)
        }),
      )
      if (cancelled) return
      faceTilesRef.current = textures
      faceTilesReadyRef.current += 1
      setFaceTilesEpoch(faceTilesReadyRef.current)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [viewMode, ordered, size, previewStyle])

  // Top-down 2D reveal — cheap for large maps (no WebGL / InstancedMesh).
  useEffect(() => {
    if (viewMode !== '2d') return
    const canvas = canvas2dRef.current
    if (!canvas) return

    const [sx, , sz] = size
    const width = Math.max(1, Math.floor(sx))
    const length = Math.max(1, Math.floor(sz))
    const cell = Math.max(
      1,
      Math.min(TEX_2D, Math.floor(MAX_2D_CANVAS_EDGE / Math.max(width, length))),
    )
    if (canvas.width !== width * cell || canvas.height !== length * cell) {
      canvas.width = width * cell
      canvas.height = length * cell
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    if (!ctx) return
    ctx.imageSmoothingEnabled = false

    const topY = new Int16Array(width * length)
    const topOrder = new Int32Array(width * length)
    topY.fill(-1)
    topOrder.fill(-1)

    const limit = Math.min(visibleCount, ordered.length)
    for (let i = 0; i < limit; i += 1) {
      const voxel = ordered[i]!
      const x = Math.floor(voxel.x)
      const z = Math.floor(voxel.z)
      if (x < 0 || z < 0 || x >= width || z >= length) continue
      const key = z * width + x
      const y = Math.floor(voxel.y)
      if (y >= topY[key]!) {
        topY[key] = y
        topOrder[key] = i
      }
    }

    const out = ctx.createImageData(canvas.width, canvas.height)
    const dst = out.data
    // Clear to transparent so empty cells stay as the stage background.
    dst.fill(0)
    const textures = faceTilesRef.current
    const useTextures = previewStyle === 'textures'

    for (let z = 0; z < length; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const orderIndex = topOrder[z * width + x]!
        if (orderIndex < 0) continue
        const voxel = ordered[orderIndex]!
        const tex = useTextures && voxel.block ? textures.get(voxel.block) : null
        if (tex) {
          blit2dNearest(dst, canvas.width, tex, x * cell, z * cell, cell)
        } else {
          fill2dRect(
            dst,
            canvas.width,
            x * cell,
            z * cell,
            cell,
            cell,
            voxel.rgb[0],
            voxel.rgb[1],
            voxel.rgb[2],
          )
        }
      }
    }
    ctx.putImageData(out, 0, 0)
  }, [viewMode, ordered, size, previewStyle, visibleCount, faceTilesEpoch])

  useEffect(() => {
    if (viewMode !== '3d') {
      bucketsRef.current = []
      invalidateRef.current = () => {}
      return
    }
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let needsRender = true
    const invalidate = () => {
      needsRender = true
    }
    invalidateRef.current = invalidate

    // Host stays mounted (hidden) while 2D is active — measure after layout so
    // a 2D→3D switch doesn't init a 0×0 canvas and stick on the clear colour.
    const measure = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      return {
        width: w > 1 ? w : 480,
        height: h > 1 ? h : Math.max(host.parentElement?.clientHeight ?? 0, 320),
      }
    }
    let { width, height } = measure()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 8000)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: true,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    host.replaceChildren(renderer.domElement)

    function readCssRgb(el: Element, property: string, fallback: number): number {
      const raw = getComputedStyle(el).getPropertyValue(property).trim()
        || getComputedStyle(el).backgroundColor
      const hex = raw.match(/^#([0-9a-f]{6})$/i)
      if (hex) return Number.parseInt(hex[1]!, 16)
      const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (rgb) {
        return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3])
      }
      // Probe a temp node with the CSS variable as background.
      const probe = document.createElement('span')
      probe.style.background = `var(${property}, #151b24)`
      probe.style.display = 'none'
      document.body.appendChild(probe)
      const computed = getComputedStyle(probe).backgroundColor
      probe.remove()
      const probed = computed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (probed) {
        return (Number(probed[1]) << 16) | (Number(probed[2]) << 8) | Number(probed[3])
      }
      return fallback
    }

    const applyThemeColors = () => {
      const clear = readCssRgb(host, '--gray-2', 0x151b24)
      renderer.setClearColor(clear, 1)
      const major = readCssRgb(host, '--gray-7', 0x2a3542)
      const minor = readCssRgb(host, '--gray-5', 0x1a222c)
      const colors = gridHelper.material
      if (Array.isArray(colors)) {
        ;(colors[0] as THREE.LineBasicMaterial).color.setHex(major)
        ;(colors[1] as THREE.LineBasicMaterial).color.setHex(minor)
      }
      invalidate()
    }

    const ambient = new THREE.AmbientLight(0xffffff, 1.15)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7280, 0.85)
    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(6, 14, 8)
    const fill = new THREE.DirectionalLight(0xffffff, 0.55)
    fill.position.set(-8, 5, -6)
    scene.add(ambient, hemi, key, fill)

    const [sx, sy, sz] = size
    const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2)
    const span = Math.max(sx, sy, sz, 1)
    camera.far = Math.max(8000, span * 8)
    camera.updateProjectionMatrix()

    const gridSize = Math.max(sx, sz, 8) + 4
    const gridDivisions = Math.min(128, Math.max(8, Math.round(gridSize)))
    const gridHelper = new THREE.GridHelper(
      gridSize,
      gridDivisions,
      0x2a3542,
      0x1a222c,
    )
    gridHelper.position.set(center.x, 0, center.z)
    scene.add(gridHelper)

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const disposables: Array<{ dispose: () => void }> = [geometry]
    const textures: THREE.Texture[] = []
    const buckets: RevealBucket[] = []
    bucketsRef.current = buckets

    applyThemeColors()
    const appearanceObserver = new MutationObserver(applyThemeColors)
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appearance', 'class', 'style'],
    })
    const themePoll = window.setTimeout(applyThemeColors, 0)

    const matrix = new THREE.Matrix4()
    const scratchColor = new THREE.Color()

    function addBucket(
      count: number,
      map: THREE.Texture | THREE.Texture[] | null,
      orderIndices: number[],
      useRgbTint: boolean,
    ): RevealBucket {
      const makeMat = (face: THREE.Texture | null) =>
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map: face ?? undefined,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
      const material = Array.isArray(map)
        ? map.map((face) => makeMat(face))
        : makeMat(map)
      if (Array.isArray(material)) {
        for (const entry of material) disposables.push(entry)
      } else {
        disposables.push(material)
      }
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1))
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      orderIndices.forEach((orderIndex, localIndex) => {
        const sample = ordered[orderIndex]!
        matrix.setPosition(sample.x + 0.5, sample.y + 0.5, sample.z + 0.5)
        mesh.setMatrixAt(localIndex, matrix)
        if (useRgbTint) {
          scratchColor.setRGB(sample.rgb[0] / 255, sample.rgb[1] / 255, sample.rgb[2] / 255)
        } else {
          scratchColor.setRGB(1, 1, 1)
        }
        mesh.setColorAt(localIndex, scratchColor)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Bounds from full instance set before we hide them for the reveal.
      mesh.computeBoundingSphere()
      mesh.frustumCulled = false
      mesh.count = 0
      if (count > 0) scene.add(mesh)
      const bucket = { mesh, orderIndices }
      buckets.push(bucket)
      return bucket
    }

    async function buildMeshes() {
      if (ordered.length === 0) return

      if (previewStyle === 'materials') {
        const indices = ordered.map((_, index) => index)
        addBucket(ordered.length, null, indices, true)
        // Use live visibleCount — async rebuilds (and style switches) can finish
        // after the visibility effect already ran against empty buckets.
        applyVisibleCount(buckets, visibleCountRef.current)
        invalidate()
        return
      }

      const groups = new Map<string, number[]>()
      ordered.forEach((voxel, index) => {
        const key = voxel.block
          ? baseBlockId(voxel.block)
          : `rgb:${voxel.rgb.join(',')}`
        const list = groups.get(key)
        if (list) list.push(index)
        else groups.set(key, [index])
      })

      await Promise.all(
        [...groups.entries()].map(async ([, indices]) => {
          if (disposed) return
          // Keep reveal order within the bucket.
          indices.sort((a, b) => a - b)
          const sample = ordered[indices[0]!]!
          let texture: THREE.Texture | THREE.Texture[]
          let tintRgb = false
          if (sample.block) {
            const loaded = await loadBlockTexture(sample.block)
            texture = loaded.texture
          } else {
            texture = solidTexture(sample.rgb)
            tintRgb = true
          }
          if (disposed) {
            for (const entry of Array.isArray(texture) ? texture : [texture]) {
              entry.dispose()
            }
            return
          }
          if (Array.isArray(texture)) textures.push(...texture)
          else textures.push(texture)
          addBucket(indices.length, texture, indices, tintRgb)
        }),
      )
      if (disposed) return
      applyVisibleCount(buckets, visibleCountRef.current)
      invalidate()
    }

    void buildMeshes()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.copy(center)
    camera.position.set(
      center.x + span * 1.2,
      center.y + span * 0.85,
      center.z + span * 1.2,
    )
    controls.update()
    controls.addEventListener('change', invalidate)

    const onResize = () => {
      if (disposed) return
      const next = measure()
      width = next.width
      height = next.height
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      invalidate()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)
    // Re-measure after the host becomes visible (2D→3D toggle).
    const layoutRaf = requestAnimationFrame(() => {
      onResize()
      applyVisibleCount(buckets, visibleCountRef.current)
      invalidate()
    })

    let raf = 0
    const loop = () => {
      if (disposed) return
      raf = requestAnimationFrame(loop)
      const damp = controls.update()
      if (damp) needsRender = true
      if (!needsRender) return
      needsRender = false
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)
    invalidate()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(layoutRaf)
      window.clearTimeout(themePoll)
      appearanceObserver.disconnect()
      ro.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      bucketsRef.current = []
      for (const texture of textures) texture.dispose()
      for (const entry of disposables) entry.dispose()
      releaseWebGLRenderer(renderer)
      host.replaceChildren()
    }
  }, [viewMode, ordered, size, previewStyle])

  useEffect(() => {
    if (viewMode !== '3d') return
    applyVisibleCount(bucketsRef.current, visibleCount)
    invalidateRef.current()
  }, [viewMode, visibleCount, runId, previewStyle])

  const progress =
    pattern === 'instant' || maxTick <= 0
      ? 1
      : Math.min(1, tick / Math.max(maxTick, 1))

  const trackRef = useRef<HTMLDivElement>(null)

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (timelineDisabled) return
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const inset = 10
      const usable = Math.max(1, rect.width - inset * 2)
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - inset) / usable))
      setPlaying(false)
      setTick(Math.round(ratio * maxTick))
    },
    [timelineDisabled, maxTick],
  )

  const onTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (timelineDisabled) return
      event.preventDefault()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      seekFromClientX(event.clientX)
    },
    [timelineDisabled, seekFromClientX],
  )

  const onTrackPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (timelineDisabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      seekFromClientX(event.clientX)
    },
    [timelineDisabled, seekFromClientX],
  )

  const markCount = 9

  return (
    <div className="datapack-build-preview">
      <div className="datapack-build-preview-stage">
        {/* Keep both mounts alive so 2D↔3D toggles don't race a fresh 0×0 WebGL host. */}
        <canvas
          ref={canvas2dRef}
          className={`datapack-build-preview-2d${viewMode === '2d' ? ' is-active' : ''}`}
          aria-label="Top-down datapack placement preview"
          aria-hidden={viewMode !== '2d'}
        />
        <div
          className={`datapack-build-preview-3d-host${viewMode === '3d' ? ' is-active' : ''}`}
          ref={hostRef}
          aria-hidden={viewMode !== '3d'}
        />
      </div>
      <div className="datapack-build-preview-bar">
        <div className="datapack-build-preview-actions">
          <div className="datapack-build-preview-toggles">
            <Segmented
              size="1"
              className="ui-segmented--dense"
              value={viewMode}
              onChange={setViewMode}
              options={[
                {
                  value: '2d',
                  label: '2D',
                  title: 'Top-down preview — lighter for large maps',
                },
                {
                  value: '3d',
                  label: '3D',
                  title: 'Orbitable block preview',
                },
              ]}
            />
            <Segmented
              size="1"
              className="ui-segmented--dense"
              value={previewStyle}
              onChange={setPreviewStyle}
              options={[
                { value: 'textures', label: 'In-game', title: 'In-game block textures' },
                { value: 'materials', label: 'Colours', title: 'Solid material colours' },
              ]}
            />
          </div>
          <Text size="1" color="gray">
            {pattern === 'instant'
              ? 'Instant — full build'
              : `${visibleCount.toLocaleString()} / ${ordered.length.toLocaleString()} blocks`}
          </Text>
        </div>

        <div className={`datapack-timeline${timelineDisabled ? ' is-disabled' : ''}`}>
          <div className="datapack-timeline-transport" role="group" aria-label="Playback">
            <IconButton
              type="button"
              size="2"
              variant="soft"
              disabled={timelineDisabled}
              highContrast
              title={playing ? 'Pause' : tick >= maxTick && maxTick > 0 ? 'Play from start' : 'Play'}
              aria-label={playing ? 'Pause' : tick >= maxTick && maxTick > 0 ? 'Play from start' : 'Play'}
              onClick={() => {
                if (playing) {
                  setPlaying(false)
                  return
                }
                // Resume unless already finished — then restart from the beginning.
                if (tick >= maxTick && maxTick > 0) {
                  setTick(0)
                  setRunId((n) => n + 1)
                }
                setPlaying(true)
              }}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            <IconButton
              type="button"
              size="2"
              variant="ghost"
              color="gray"
              disabled={timelineDisabled}
              title="Restart"
              aria-label="Restart from the beginning"
              onClick={() => restartPreview()}
            >
              <RestartIcon />
            </IconButton>
          </div>

          <span className="datapack-timeline-time">
            {timelineDisabled ? '0:00' : formatClock(currentSeconds)}
          </span>

          <div
            ref={trackRef}
            className="datapack-timeline-track"
            role="slider"
            tabIndex={timelineDisabled ? -1 : 0}
            aria-valuemin={0}
            aria-valuemax={maxTick}
            aria-valuenow={tick}
            aria-valuetext={
              timelineDisabled
                ? 'Instant placement'
                : `${formatClock(currentSeconds)} of ${formatClock(totalSeconds)}`
            }
            aria-label="Build timeline"
            aria-disabled={timelineDisabled}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onKeyDown={(event) => {
              if (timelineDisabled) return
              const step = Math.max(1, Math.round(maxTick / 50))
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault()
                setPlaying(false)
                setTick((t) => Math.max(0, t - step))
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault()
                setPlaying(false)
                setTick((t) => Math.min(maxTick, t + step))
              } else if (event.key === 'Home') {
                event.preventDefault()
                setPlaying(false)
                setTick(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                setPlaying(false)
                setTick(maxTick)
              }
            }}
          >
            <div className="datapack-timeline-rail" />
            <div className="datapack-timeline-marks" aria-hidden>
              {Array.from({ length: markCount }, (_, i) => (
                <span
                  key={i}
                  className={`datapack-timeline-mark${i === 0 || i === markCount - 1 ? ' is-end' : ''}`}
                  style={{ left: `${(i / (markCount - 1)) * 100}%` }}
                />
              ))}
            </div>
            <div
              className="datapack-timeline-fill"
              style={{ width: `calc((100% - 20px) * ${progress})` }}
            />
            <div
              className="datapack-timeline-thumb"
              style={{ left: `calc(10px + (100% - 20px) * ${progress})` }}
            />
          </div>

          <span className="datapack-timeline-time is-end">
            {timelineDisabled ? '0:00' : formatClock(totalSeconds)}
          </span>
        </div>
      </div>
    </div>
  )
}
