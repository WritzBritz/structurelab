/**
 * Orbitable / free-fly 3D preview of map art from the real structure voxels
 * (supports, staircase heights included).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Slider, Text } from '@radix-ui/themes'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { releaseWebGLRenderer } from '../shared/webglRelease'
import { baseBlockId, loadBlockCubeFaces, type BlockFaceImage } from '../models/blockTextures'

export type Map3dNavigationMode = 'orbit' | 'free'

type Props = {
  previewBlockPalette: string[]
  /** Base64 packed `[x:u16][y:u16][z:u16][idx:u8]` LE records. */
  previewVoxels: string
  /** Kept for API compatibility; preview always packs every block (stride 1). */
  previewVoxelStride?: number
  width: number
  length: number
  height: number
  mapsX: number
  mapsY: number
  /** Orbit around the build, or walk/fly through it. */
  navigationMode?: Map3dNavigationMode
  /** Called when one or more block face textures failed to load. */
  onMissingTextures?: (blocks: string[]) => void
}

type BlockSize = { sx: number; sy: number; sz: number }

const FREE_SPEED_STORAGE_KEY = 'structurelab.map3d.freeSpeed'
const DEFAULT_FREE_SPEED = 1
const MIN_FREE_SPEED = 0.25
const MAX_FREE_SPEED = 4

function clampFreeSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FREE_SPEED
  return THREE.MathUtils.clamp(value, MIN_FREE_SPEED, MAX_FREE_SPEED)
}

function readStoredFreeSpeed(): number {
  try {
    const raw = localStorage.getItem(FREE_SPEED_STORAGE_KEY)
    if (raw != null) return clampFreeSpeed(Number(raw))
  } catch {
    /* ignore */
  }
  return DEFAULT_FREE_SPEED
}

/** Max free-cam radius from build center — scales with footprint so small/large maps both work. */
function freeMaxDistance(contentBox: THREE.Box3, span: number): number {
  const size = contentBox.getSize(new THREE.Vector3())
  const diagonal = size.length()
  return Math.max(span * 2.25, diagonal * 1.2, 20)
}

function clampFreeCameraPosition(
  position: THREE.Vector3,
  center: THREE.Vector3,
  maxDistance: number,
): void {
  const dx = position.x - center.x
  const dy = position.y - center.y
  const dz = position.z - center.z
  const distSq = dx * dx + dy * dy + dz * dz
  const maxSq = maxDistance * maxDistance
  if (distSq <= maxSq) return
  const scale = maxDistance / Math.sqrt(distSq)
  position.set(center.x + dx * scale, center.y + dy * scale, center.z + dz * scale)
}

/** Keep near/far tight around the focus so large flat maps don't shimmer when zoomed out. */
function applyDistanceClipPlanes(
  camera: THREE.PerspectiveCamera,
  focus: THREE.Vector3,
  span: number,
  mode: Map3dNavigationMode,
  maxFreeDist: number,
): void {
  const dist = Math.max(camera.position.distanceTo(focus), 0.01)
  const radius = Math.max(span * 0.85, 4)
  if (mode === 'orbit') {
    // Pack the depth buffer around the build — critical for flat map art from far away.
    camera.near = Math.max(0.05, Math.min(dist * 0.02, Math.max(dist - radius, dist * 0.001)))
    camera.far = Math.max(dist + radius * 1.75, camera.near + 25, radius * 3)
  } else {
    camera.near = Math.max(0.05, Math.min(dist * 0.01, 0.35))
    camera.far = Math.max(maxFreeDist + radius * 2, dist + radius * 2, 256)
  }
  camera.updateProjectionMatrix()
}

function formatFreeHint(speed: number, locked: boolean): string {
  const controls = locked
    ? 'WASD move · scroll speed · Space / Shift up-down · Esc unlock'
    : 'Click to look around · WASD move · scroll speed · Space / Shift up-down · Esc unlock'
  return `Speed ${speed.toFixed(1)}x · ${controls}`
}

type Cell = {
  x: number
  y: number
  z: number
  block: string
  size: BlockSize
}

type NavApi = {
  applyMode: (mode: Map3dNavigationMode) => void
}

type SavedFreeCam = {
  footprintKey: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

type SavedOrbitCam = {
  footprintKey: string
  position: [number, number, number]
  target: [number, number, number]
}

/** Survive remounts (texture refresh, etc.) so free/orbit views aren’t yanked back. */
let savedFreeCam: SavedFreeCam | null = null
let savedOrbitCam: SavedOrbitCam | null = null

function footprintKey(width: number, length: number, height: number, voxels: string): string {
  // v2: build is centered at origin for depth precision — invalidate old camera poses.
  return `v2:${width}x${length}x${height}:${voxels.length}:${voxels.slice(0, 32)}`
}

export default function MapArt3DViewer({
  previewBlockPalette,
  previewVoxels,
  previewVoxelStride = 1,
  width,
  length,
  height,
  mapsX,
  mapsY,
  navigationMode = 'orbit',
  onMissingTextures,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const navApiRef = useRef<NavApi | null>(null)
  const navigationModeRef = useRef(navigationMode)
  navigationModeRef.current = navigationMode
  const freeLockedRef = useRef(false)
  const stride = Math.max(1, Math.floor(previewVoxelStride) || 1)
  const onMissingRef = useRef(onMissingTextures)
  onMissingRef.current = onMissingTextures
  const [freeSpeed, setFreeSpeed] = useState(readStoredFreeSpeed)
  const freeSpeedRef = useRef(freeSpeed)
  freeSpeedRef.current = freeSpeed
  const setFreeSpeedRef = useRef<(value: number) => void>(() => {})

  const setFreeSpeedValue = useCallback((value: number) => {
    const clamped = clampFreeSpeed(value)
    freeSpeedRef.current = clamped
    setFreeSpeed(clamped)
    try {
      localStorage.setItem(FREE_SPEED_STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])
  setFreeSpeedRef.current = setFreeSpeedValue

  useEffect(() => {
    const host = hostRef.current
    if (!host || width < 1 || length < 1) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | null = null
    let frame = 0
    const disposables: Array<{ dispose: () => void }> = []
    const textures: THREE.Texture[] = []

    const track = (...items: Array<{ dispose: () => void } | null | undefined>) => {
      for (const item of items) {
        if (item) disposables.push(item)
      }
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x151b24)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000)
    const ambient = new THREE.AmbientLight(0xffffff, 0.52)
    const hemi = new THREE.HemisphereLight(0xe8eef6, 0x3a4452, 0.48)
    const sun = new THREE.DirectionalLight(0xffffff, 0.82)
    sun.position.set(0.55, 1.25, 0.4)
    const fill = new THREE.DirectionalLight(0xd7e7ff, 0.32)
    fill.position.set(-0.75, 0.45, -0.55)
    scene.add(ambient, hemi, sun, fill)

    let orbit: OrbitControls | null = null
    let free: PointerLockControls | null = null
    let removeFreeListeners: (() => void) | null = null
    const move = {
      forward: false,
      back: false,
      left: false,
      right: false,
      up: false,
      down: false,
    }
    const clock = new THREE.Clock()
    let needsRender = true
    const invalidate = () => {
      needsRender = true
    }
    let orbitNeedsRender = false
    let contentCenter = new THREE.Vector3(width / 2, Math.max(height, 1) / 2, length / 2)
    let contentBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(width, Math.max(height, 1), length),
    )
    let span = Math.max(width, height, length, 1)
    let maxFreeDist = freeMaxDistance(contentBox, span)

    const setHint = (text: string) => {
      if (hintRef.current) hintRef.current.textContent = text
    }

    const sceneKey = footprintKey(width, length, height, previewVoxels)
    let activeMode: Map3dNavigationMode | null = null

    const snapshotFreeCam = () => {
      if (!savedFreeCam || savedFreeCam.footprintKey !== sceneKey) {
        savedFreeCam = {
          footprintKey: sceneKey,
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
        }
      }
      camera.position.toArray(savedFreeCam.position)
      camera.quaternion.toArray(savedFreeCam.quaternion)
    }

    const snapshotOrbitCam = () => {
      if (!orbit) return
      if (!savedOrbitCam || savedOrbitCam.footprintKey !== sceneKey) {
        savedOrbitCam = {
          footprintKey: sceneKey,
          position: [0, 0, 0],
          target: [0, 0, 0],
        }
      }
      camera.position.toArray(savedOrbitCam.position)
      orbit.target.toArray(savedOrbitCam.target)
    }

    const placeOrbitCamera = (forceDefault = false) => {
      applyDistanceClipPlanes(camera, contentCenter, span, 'orbit', maxFreeDist)
      if (
        !forceDefault
        && savedOrbitCam
        && savedOrbitCam.footprintKey === sceneKey
      ) {
        camera.position.fromArray(savedOrbitCam.position)
        if (orbit) {
          orbit.target.fromArray(savedOrbitCam.target)
          orbit.update()
        }
      } else {
        camera.position.set(
          contentCenter.x + span * 0.9,
          contentCenter.y + span * 0.7,
          contentCenter.z + span * 0.9,
        )
        if (orbit) {
          orbit.target.copy(contentCenter)
          orbit.update()
        }
      }
      applyDistanceClipPlanes(
        camera,
        orbit?.target ?? contentCenter,
        span,
        'orbit',
        maxFreeDist,
      )
    }

    /** Middle of the build, raised, looking down — only when no saved pose. */
    const placeFreeCamera = (forceDefault = false) => {
      if (
        !forceDefault
        && savedFreeCam
        && savedFreeCam.footprintKey === sceneKey
      ) {
        camera.position.fromArray(savedFreeCam.position)
        clampFreeCameraPosition(camera.position, contentCenter, maxFreeDist)
        camera.quaternion.fromArray(savedFreeCam.quaternion)
      } else {
        const lift = Math.max(8, span * 0.4)
        camera.position.set(
          contentCenter.x,
          contentBox.max.y + lift,
          contentCenter.z,
        )
        clampFreeCameraPosition(camera.position, contentCenter, maxFreeDist)
        camera.up.set(0, 1, 0)
        camera.lookAt(contentCenter.x, contentCenter.y, contentCenter.z)
        snapshotFreeCam()
      }
      applyDistanceClipPlanes(camera, contentCenter, span, 'free', maxFreeDist)
    }

    const teardownControls = () => {
      removeFreeListeners?.()
      removeFreeListeners = null
      if (orbit) {
        orbit.dispose()
        orbit = null
      }
      if (free) {
        if (free.isLocked) free.unlock()
        free.dispose()
        free = null
      }
      move.forward = false
      move.back = false
      move.left = false
      move.right = false
      move.up = false
      move.down = false
    }

    const setupOrbit = () => {
      if (!renderer) return
      if (free) snapshotFreeCam()
      teardownControls()
      orbit = new OrbitControls(camera, renderer.domElement)
      orbit.enableDamping = true
      orbit.dampingFactor = 0.08
      orbit.maxPolarAngle = Math.PI * 0.49
      // Keep zoom inside the far clip plane so distant blocks don't pop out.
      orbit.maxDistance = Math.max(span * 28, maxFreeDist, 200)
      orbit.addEventListener('change', () => {
        orbitNeedsRender = true
        invalidate()
      })
      placeOrbitCamera(false)
      setHint('Drag to orbit · scroll to zoom')
      renderer.domElement.style.cursor = 'grab'
      activeMode = 'orbit'
      invalidate()
    }

    const setupFree = () => {
      if (!renderer) return
      if (orbit) snapshotOrbitCam()
      teardownControls()
      free = new PointerLockControls(camera, renderer.domElement)
      placeFreeCamera(false)
      freeLockedRef.current = false
      setHint(formatFreeHint(freeSpeedRef.current, false))

      const canvas = renderer.domElement
      canvas.style.cursor = 'pointer'
      const onClick = () => {
        if (!free?.isLocked) free?.lock()
      }
      const onLock = () => {
        freeLockedRef.current = true
        setHint(formatFreeHint(freeSpeedRef.current, true))
        canvas.style.cursor = 'none'
      }
      const onUnlock = () => {
        freeLockedRef.current = false
        snapshotFreeCam()
        setHint(formatFreeHint(freeSpeedRef.current, false))
        canvas.style.cursor = 'pointer'
        move.forward = false
        move.back = false
        move.left = false
        move.right = false
        move.up = false
        move.down = false
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (navigationModeRef.current !== 'free') return
        switch (event.code) {
          case 'KeyW':
          case 'ArrowUp':
            move.forward = true
            break
          case 'KeyS':
          case 'ArrowDown':
            move.back = true
            break
          case 'KeyA':
          case 'ArrowLeft':
            move.left = true
            break
          case 'KeyD':
          case 'ArrowRight':
            move.right = true
            break
          case 'Space':
            move.up = true
            event.preventDefault()
            break
          case 'ShiftLeft':
          case 'ShiftRight':
          case 'ControlLeft':
          case 'ControlRight':
            move.down = true
            break
          default:
            break
        }
      }
      const onKeyUp = (event: KeyboardEvent) => {
        switch (event.code) {
          case 'KeyW':
          case 'ArrowUp':
            move.forward = false
            break
          case 'KeyS':
          case 'ArrowDown':
            move.back = false
            break
          case 'KeyA':
          case 'ArrowLeft':
            move.left = false
            break
          case 'KeyD':
          case 'ArrowRight':
            move.right = false
            break
          case 'Space':
            move.up = false
            break
          case 'ShiftLeft':
          case 'ShiftRight':
          case 'ControlLeft':
          case 'ControlRight':
            move.down = false
            break
          default:
            break
        }
      }

      const viewerRoot = host.parentElement

      const onWheel = (event: WheelEvent) => {
        if (navigationModeRef.current !== 'free') return

        const locked = free?.isLocked ?? false
        if (!locked && !viewerRoot?.contains(event.target as Node)) return

        event.preventDefault()
        event.stopPropagation()
        if (event.deltaY === 0) return

        const step = event.shiftKey ? 0.25 : 0.1
        const delta = event.deltaY > 0 ? -step : step
        const next = clampFreeSpeed(freeSpeedRef.current + delta)
        freeSpeedRef.current = next
        setFreeSpeedRef.current(next)
        setHint(formatFreeHint(next, free?.isLocked ?? false))
      }

      canvas.addEventListener('click', onClick)
      window.addEventListener('wheel', onWheel, { capture: true, passive: false })
      free.addEventListener('lock', onLock)
      free.addEventListener('unlock', onUnlock)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      const onFreeLook = () => {
        if (free?.isLocked) invalidate()
      }
      document.addEventListener('pointermove', onFreeLook)
      removeFreeListeners = () => {
        canvas.removeEventListener('click', onClick)
        window.removeEventListener('wheel', onWheel, { capture: true })
        free?.removeEventListener('lock', onLock)
        free?.removeEventListener('unlock', onUnlock)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        document.removeEventListener('pointermove', onFreeLook)
      }
      activeMode = 'free'
      invalidate()
    }

    const applyNavigationMode = (mode: Map3dNavigationMode) => {
      // Same mode already live (e.g. effect re-run after boot) — keep camera.
      if (activeMode === mode && ((mode === 'free' && free) || (mode === 'orbit' && orbit))) {
        return
      }
      if (mode === 'free') setupFree()
      else setupOrbit()
    }
    navApiRef.current = { applyMode: applyNavigationMode }

    const boot = async () => {
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          // Large flat maps need this or blocks shimmer/flash when zoomed out.
          logarithmicDepthBuffer: true,
        })
        renderer.setClearColor(0x151b24, 1)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.NoToneMapping
        host.replaceChildren(renderer.domElement)

        const cells = decodeVoxels(previewVoxels, previewBlockPalette, stride)
        if (disposed) return

        contentBox = new THREE.Box3()
        if (cells.length > 0) {
          for (const cell of cells) {
            const hx = cell.size.sx * 0.5
            const hz = cell.size.sz * 0.5
            const y0 = cell.y + blockYOffset(cell.block, cell.size)
            contentBox.expandByPoint(
              new THREE.Vector3(cell.x - hx, y0, cell.z - hz),
            )
            contentBox.expandByPoint(
              new THREE.Vector3(cell.x + hx, y0 + cell.size.sy, cell.z + hz),
            )
          }
        } else {
          contentBox.set(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(width, Math.max(height, 1), length),
          )
        }
        // Center the build on the origin so GPU depth/float precision stays usable
        // on large maps (blocks used to sit at x/z up to hundreds of units).
        const origin = contentBox.getCenter(new THREE.Vector3())
        contentBox.translate(origin.clone().negate())
        contentCenter.set(0, 0, 0)
        const contentSize = contentBox.getSize(new THREE.Vector3())
        span = Math.max(contentSize.x, contentSize.y, contentSize.z, 1)
        maxFreeDist = freeMaxDistance(contentBox, span)

        const missing = await addTexturedBlocks(
          scene,
          cells,
          track,
          textures,
          origin,
        )
        if (disposed) return
        if (missing.length > 0) onMissingRef.current?.(missing)
        else onMissingRef.current?.([])

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(
            Math.max(contentSize.x, width) + 4,
            Math.max(contentSize.z, length) + 4,
          ),
          new THREE.MeshBasicMaterial({
            color: 0x0e131a,
            depthWrite: true,
          }),
        )
        ground.rotation.x = -Math.PI / 2
        // Keep well below block bottoms so flat map art doesn't z-fight the floor.
        ground.position.set(0, contentBox.min.y - 0.5, 0)
        track(ground.geometry, ground.material as THREE.Material)
        scene.add(ground)

        if (mapsX > 0 && mapsY > 0) {
          const grid = buildMapGrid(width, length, mapsX, mapsY, origin, contentBox.min.y)
          grid.renderOrder = -2
          track(grid.geometry, grid.material as THREE.Material)
          scene.add(grid)
        }

        applyNavigationMode(navigationModeRef.current)

        const resize = () => {
          if (!renderer || !host) return
          const w = Math.max(host.clientWidth, 1)
          const h = Math.max(host.clientHeight, 1)
          camera.aspect = w / h
          applyDistanceClipPlanes(
            camera,
            orbit?.target ?? contentCenter,
            span,
            navigationModeRef.current,
            maxFreeDist,
          )
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
          // updateStyle true so canvas CSS px match the drawing buffer aspect.
          renderer.setSize(w, h, true)
          invalidate()
        }
        resize()
        requestAnimationFrame(() => {
          if (disposed) return
          resize()
          // Don't yank free-cam back; only reframe orbit if we have no saved pose.
          if (navigationModeRef.current === 'orbit' && !savedOrbitCam) {
            placeOrbitCamera(true)
          }
        })
        const ro = new ResizeObserver(() => resize())
        ro.observe(host)

        const wish = new THREE.Vector3()
        const look = new THREE.Vector3()
        const right = new THREE.Vector3()
        const tick = () => {
          if (disposed || !renderer) return
          frame = requestAnimationFrame(tick)
          const dt = Math.min(clock.getDelta(), 0.05)
          let cameraMoved = false

          if (orbit) {
            orbitNeedsRender = false
            orbit.update()
            cameraMoved = orbitNeedsRender
          } else if (free?.isLocked) {
            const baseSpeed = Math.max(8, span * 0.45)
            const speed = baseSpeed * freeSpeedRef.current
            camera.getWorldDirection(look)
            right.crossVectors(look, camera.up).normalize()

            wish.set(0, 0, 0)
            if (move.forward) wish.add(look)
            if (move.back) wish.sub(look)
            if (move.right) wish.add(right)
            if (move.left) wish.sub(right)
            if (move.up) wish.y += 1
            if (move.down) wish.y -= 1
            if (wish.lengthSq() > 0) {
              wish.normalize().multiplyScalar(speed * dt)
              camera.position.add(wish)
              clampFreeCameraPosition(camera.position, contentCenter, maxFreeDist)
              cameraMoved = true
            }
          }

          if (!cameraMoved && !needsRender) return
          needsRender = false

          applyDistanceClipPlanes(
            camera,
            orbit?.target ?? contentCenter,
            span,
            navigationModeRef.current,
            maxFreeDist,
          )
          renderer.render(scene, camera)
        }
        tick()

        return () => {
          ro.disconnect()
        }
      } catch (err) {
        console.warn('[map-3d] preview failed', err)
        if (!disposed && host) {
          host.replaceChildren()
          const msg = document.createElement('p')
          msg.className = 'empty-canvas'
          msg.textContent = '3D preview failed to load'
          host.appendChild(msg)
        }
      }
    }

    let cleanupResize: (() => void) | undefined
    void boot().then((fn) => {
      cleanupResize = fn
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cleanupResize?.()
      if (activeMode === 'free') snapshotFreeCam()
      else if (activeMode === 'orbit') snapshotOrbitCam()
      teardownControls()
      navApiRef.current = null
      for (const texture of textures) texture.dispose()
      for (const item of disposables) item.dispose()
      releaseWebGLRenderer(renderer)
      renderer = null
      host.replaceChildren()
    }
  }, [
    previewBlockPalette,
    previewVoxels,
    stride,
    width,
    length,
    height,
    mapsX,
    mapsY,
  ])

  // Swap orbit ↔ free without rebuilding meshes / reloading textures.
  useEffect(() => {
    navApiRef.current?.applyMode(navigationMode)
  }, [navigationMode])

  useEffect(() => {
    if (navigationMode !== 'free' || !hintRef.current) return
    hintRef.current.textContent = formatFreeHint(freeSpeed, freeLockedRef.current)
  }, [freeSpeed, navigationMode])

  return (
    <div className="voxel-viewer map-art-3d">
      <div className="map-art-3d-canvas" ref={hostRef} />
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
      <div className="map-art-3d-hint" ref={hintRef} aria-live="polite" />
    </div>
  )
}

function decodeVoxels(b64: string, palette: string[], _stride: number): Cell[] {
  if (!b64 || palette.length === 0) return []
  let raw: Uint8Array
  try {
    const bin = atob(b64)
    raw = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) raw[i] = bin.charCodeAt(i)
  } catch {
    return []
  }
  const count = Math.floor(raw.length / 7)
  const cells: Cell[] = new Array(count)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const fallback = palette[0] ?? 'minecraft:stone'
  let written = 0
  for (let o = 0; o + 7 <= raw.length; o += 7) {
    const x = view.getUint16(o, true)
    const y = view.getUint16(o + 2, true)
    const z = view.getUint16(o + 4, true)
    const idx = raw[o + 6]!
    const block = palette[idx] ?? fallback
    const base = blockVisualSize(block)
    cells[written] = {
      x: x + 0.5,
      y,
      z: z + 0.5,
      block,
      size: {
        sx: base.sx,
        sy: base.sy,
        sz: base.sz,
      },
    }
    written += 1
  }
  if (written !== count) cells.length = written
  return cells
}

/** In-game heights; full 1×1 footprint so neighbours sit flush. */
function blockVisualSize(block: string): BlockSize {
  const id = baseBlockId(block)
  if (id.endsWith('_carpet') || id === 'moss_carpet') {
    return { sx: 1, sy: 1 / 16, sz: 1 }
  }
  if (id === 'snow') {
    return { sx: 1, sy: 2 / 16, sz: 1 }
  }
  if (id.endsWith('_slab')) {
    if (block.includes('type=double')) return { sx: 1, sy: 1, sz: 1 }
    return { sx: 1, sy: 0.5, sz: 1 }
  }
  if (id.endsWith('_pressure_plate')) {
    return { sx: 1, sy: 1 / 16, sz: 1 }
  }
  return { sx: 1, sy: 1, sz: 1 }
}

function blockYOffset(block: string, size: BlockSize): number {
  const id = baseBlockId(block)
  if (id.endsWith('_slab') && block.includes('type=top') && size.sy < 1) {
    return 0.5
  }
  return 0
}

async function addTexturedBlocks(
  scene: THREE.Scene,
  cells: Cell[],
  track: (...items: Array<{ dispose: () => void } | null | undefined>) => void,
  textures: THREE.Texture[],
  origin: THREE.Vector3,
): Promise<string[]> {
  const byKey = new Map<string, Cell[]>()
  for (const cell of cells) {
    const key = `${cell.block}|${cell.size.sx}|${cell.size.sy}|${cell.size.sz}`
    const list = byKey.get(key)
    if (list) list.push(cell)
    else byKey.set(key, [cell])
  }

  const matrix = new THREE.Matrix4()
  const entries = [...byKey.entries()]
  const missing: string[] = []
  // One unit cube — instance matrices carry position + non-cube scales (slabs/carpets).
  const unitGeometry = new THREE.BoxGeometry(1, 1, 1)
  track(unitGeometry)

  await Promise.all(
    entries.map(async ([, group]) => {
      const size = group[0]!.size
      const block = group[0]!.block

      const loaded = await loadBlockTexture(block)
      if (loaded.missing) missing.push(block)
      const maps = Array.isArray(loaded.texture) ? loaded.texture : [loaded.texture]
      textures.push(...maps)
      const makeMat = (map: THREE.Texture) =>
        new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map,
        })
      const material = Array.isArray(loaded.texture)
        ? loaded.texture.map(makeMat)
        : makeMat(loaded.texture)
      if (Array.isArray(material)) {
        for (const entry of material) track(entry)
      } else {
        track(material)
      }

      const mesh = new THREE.InstancedMesh(unitGeometry, material, group.length)
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3(size.sx, size.sy, size.sz)
      const position = new THREE.Vector3()
      group.forEach((cell, local) => {
        const yLift = blockYOffset(cell.block, size)
        position.set(
          cell.x - origin.x,
          cell.y + yLift + size.sy / 2 - origin.y,
          cell.z - origin.z,
        )
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(local, matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      // Bounds from instance matrices — safe to cull off-screen block groups.
      mesh.computeBoundingSphere()
      mesh.frustumCulled = true
      scene.add(mesh)
    }),
  )

  return [...new Set(missing)].sort((a, b) => a.localeCompare(b))
}

/** Classic purple/black missing-texture tile so failures are obvious (not quiet grey). */
function missingTexture(): THREE.DataTexture {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
      if (dark) {
        data[i] = 0xf8
        data[i + 1] = 0x00
        data[i + 2] = 0xf8
      } else {
        data[i] = 0x00
        data[i + 1] = 0x00
        data[i + 2] = 0x00
      }
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

function buildMapGrid(
  width: number,
  length: number,
  _mapsX: number,
  _mapsY: number,
  origin: THREE.Vector3,
  floorY: number,
): THREE.LineSegments {
  const points: THREE.Vector3[] = []
  const y = floorY + 0.008
  const step = 128
  const ox = origin.x
  const oz = origin.z
  for (let x = 0; x <= width; x += step) {
    points.push(
      new THREE.Vector3(x - ox, y, 0 - oz),
      new THREE.Vector3(x - ox, y, length - oz),
    )
  }
  if (width % step !== 0) {
    points.push(
      new THREE.Vector3(width - ox, y, 0 - oz),
      new THREE.Vector3(width - ox, y, length - oz),
    )
  }
  for (let z = 0; z <= length; z += step) {
    points.push(
      new THREE.Vector3(0 - ox, y, z - oz),
      new THREE.Vector3(width - ox, y, z - oz),
    )
  }
  if (length % step !== 0) {
    points.push(
      new THREE.Vector3(0 - ox, y, length - oz),
      new THREE.Vector3(width - ox, y, length - oz),
    )
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({
    color: 0x5b9fd4,
    transparent: true,
    opacity: 0.22,
    depthTest: true,
    depthWrite: true,
  })
  return new THREE.LineSegments(geometry, material)
}
