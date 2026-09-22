import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'

export type PreviewNavigationMode = 'orbit' | 'free'

export const PREVIEW3D_FREE_SPEED_STORAGE_KEY = 'structurelab.map3d.freeSpeed'

export const DEFAULT_FREE_SPEED = 1
export const MIN_FREE_SPEED = 0.25
export const MAX_FREE_SPEED = 4

export type PreviewNavigationBounds = {
  center: THREE.Vector3
  contentBox: THREE.Box3
  span: number
  maxFreeDist: number
}

type SavedFreeCam = {
  sceneKey: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

type SavedOrbitCam = {
  sceneKey: string
  position: [number, number, number]
  target: [number, number, number]
}

let savedFreeCam: SavedFreeCam | null = null
let savedOrbitCam: SavedOrbitCam | null = null

export function clampFreeSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FREE_SPEED
  return THREE.MathUtils.clamp(value, MIN_FREE_SPEED, MAX_FREE_SPEED)
}

export function readStoredFreeSpeed(): number {
  try {
    const raw = localStorage.getItem(PREVIEW3D_FREE_SPEED_STORAGE_KEY)
    if (raw != null) return clampFreeSpeed(Number(raw))
  } catch {
    /* ignore */
  }
  return DEFAULT_FREE_SPEED
}

export function writeStoredFreeSpeed(value: number): void {
  try {
    localStorage.setItem(PREVIEW3D_FREE_SPEED_STORAGE_KEY, String(clampFreeSpeed(value)))
  } catch {
    /* ignore */
  }
}

export function freeMaxDistance(contentBox: THREE.Box3, span: number): number {
  const size = contentBox.getSize(new THREE.Vector3())
  const diagonal = size.length()
  return Math.max(span * 2.25, diagonal * 1.2, 20)
}

export function boundsFromBox3(box: THREE.Box3): PreviewNavigationBounds {
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const span = Math.max(size.x, size.y, size.z, 1)
  return {
    center,
    contentBox: box.clone(),
    span,
    maxFreeDist: freeMaxDistance(box, span),
  }
}

export function clampFreeCameraPosition(
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

export function applyStaticClipPlanes(
  camera: THREE.PerspectiveCamera,
  span: number,
  mode: PreviewNavigationMode,
  maxFreeDist: number,
): void {
  camera.near = Math.max(span / 400, 0.08)
  camera.far = mode === 'free'
    ? Math.max(maxFreeDist + span, span * 2.5, 48)
    : Math.max(span * 8, 128)
  camera.updateProjectionMatrix()
}

export function formatFreeHint(speed: number, locked: boolean): string {
  const controls = locked
    ? 'WASD move · scroll speed · Space / Shift up-down · Esc unlock'
    : 'Click to look around · WASD move · scroll speed · Space / Shift up-down · Esc unlock'
  return `Speed ${speed.toFixed(1)}x · ${controls}`
}

export function formatOrbitHint(): string {
  return 'Left-drag orbit · right-drag pan · scroll zoom'
}

export type FreeCameraNavigationOptions = {
  camera: THREE.PerspectiveCamera
  canvas: HTMLElement
  viewerRoot?: HTMLElement | null
  sceneKey: string
  getBounds: () => PreviewNavigationBounds
  navigationModeRef: { current: PreviewNavigationMode }
  onHint: (text: string) => void
  freeSpeedRef: { current: number }
  onFreeSpeedChange?: (speed: number) => void
  onActivity?: () => void
  onOrbitTargetChange?: (offset: [number, number, number], span: number) => void
}

export type FreeCameraNavigation = {
  applyMode: (mode: PreviewNavigationMode) => void
  updateTick: (dt: number) => boolean
  dispose: () => void
  getOrbit: () => OrbitControls | null
  isFreeLocked: () => boolean
  getActiveMode: () => PreviewNavigationMode | null
  placeOrbitCamera: (forceDefault?: boolean) => void
  followContent: (previous: PreviewNavigationBounds) => void
  getOrbitOffset: () => [number, number, number]
  setOrbitOffset: (x: number, y: number, z: number) => void
  recenterOrbit: () => void
}

export function createFreeCameraNavigation(
  options: FreeCameraNavigationOptions,
): FreeCameraNavigation {
  const {
    camera,
    canvas,
    viewerRoot = null,
    sceneKey,
    getBounds,
    navigationModeRef,
    onHint,
    freeSpeedRef,
    onFreeSpeedChange,
    onActivity,
    onOrbitTargetChange,
  } = options

  let orbit: OrbitControls | null = null
  let free: PointerLockControls | null = null
  let removeFreeListeners: (() => void) | null = null
  let activeMode: PreviewNavigationMode | null = null
  let freeLocked = false
  let orbitNeedsRender = false

  const signalActivity = () => {
    onActivity?.()
  }

  const move = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
  }

  const snapshotFreeCam = () => {
    if (!savedFreeCam || savedFreeCam.sceneKey !== sceneKey) {
      savedFreeCam = {
        sceneKey,
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
      }
    }
    camera.position.toArray(savedFreeCam.position)
    camera.quaternion.toArray(savedFreeCam.quaternion)
  }

  const snapshotOrbitCam = () => {
    if (!orbit) return
    if (!savedOrbitCam || savedOrbitCam.sceneKey !== sceneKey) {
      savedOrbitCam = {
        sceneKey,
        position: [0, 0, 0],
        target: [0, 0, 0],
      }
    }
    camera.position.toArray(savedOrbitCam.position)
    orbit.target.toArray(savedOrbitCam.target)
  }

  const currentOrbitOffset = (): [number, number, number] => {
    if (!orbit) return [0, 0, 0]
    const { center } = getBounds()
    return [
      orbit.target.x - center.x,
      orbit.target.y - center.y,
      orbit.target.z - center.z,
    ]
  }

  const emitOrbitOffset = () => {
    if (!orbit) return
    onOrbitTargetChange?.(currentOrbitOffset(), getBounds().span)
  }

  const applyOrbitOffset = (x: number, y: number, z: number) => {
    if (!orbit) return
    const { center } = getBounds()
    const rel = camera.position.clone().sub(orbit.target)
    orbit.target.set(center.x + x, center.y + y, center.z + z)
    camera.position.copy(orbit.target).add(rel)
    orbit.update()
    snapshotOrbitCam()
    emitOrbitOffset()
    signalActivity()
  }

  const placeOrbitCamera = (forceDefault = false) => {
    const { center, span, maxFreeDist } = getBounds()
    applyStaticClipPlanes(camera, span, 'orbit', maxFreeDist)
    if (orbit) {
      orbit.minDistance = Math.max(span * 0.008, 0.02)
      orbit.maxDistance = Math.max(span * 12, 24)
    }
    if (!forceDefault && savedOrbitCam && savedOrbitCam.sceneKey === sceneKey) {
      camera.position.fromArray(savedOrbitCam.position)
      if (orbit) {
        orbit.target.fromArray(savedOrbitCam.target)
        orbit.update()
      }
    } else {
      camera.position.set(center.x + span * 1.25, center.y + span * 0.85, center.z + span * 1.25)
      if (orbit) {
        orbit.target.copy(center)
        orbit.update()
      }
    }
    emitOrbitOffset()
  }

  const placeFreeCamera = (forceDefault = false) => {
    const { center, contentBox, span, maxFreeDist } = getBounds()
    if (!forceDefault && savedFreeCam && savedFreeCam.sceneKey === sceneKey) {
      camera.position.fromArray(savedFreeCam.position)
      clampFreeCameraPosition(camera.position, center, maxFreeDist)
      camera.quaternion.fromArray(savedFreeCam.quaternion)
    } else {
      const lift = Math.max(8, span * 0.4)
      camera.position.set(center.x, contentBox.max.y + lift, center.z)
      clampFreeCameraPosition(camera.position, center, maxFreeDist)
      camera.up.set(0, 1, 0)
      camera.lookAt(center.x, center.y, center.z)
      snapshotFreeCam()
    }
    applyStaticClipPlanes(camera, span, 'free', maxFreeDist)
  }

  const followContent = (previous: PreviewNavigationBounds) => {
    const next = getBounds()
    const mode = navigationModeRef.current
    applyStaticClipPlanes(camera, next.span, mode, next.maxFreeDist)
    if (next.contentBox.isEmpty()) {
      signalActivity()
      return
    }
    const oldSpan = Math.max(previous.span, 1e-6)
    const ratio = next.span / oldSpan
    const canScale =
      Number.isFinite(ratio)
      && ratio > 0
      && !previous.contentBox.isEmpty()
    if (!canScale) {
      if (mode === 'free') placeFreeCamera(true)
      else placeOrbitCamera(true)
      return
    }
    if (orbit) {
      const lookOffset = orbit.target.clone().sub(previous.center).multiplyScalar(ratio)
      const camOffset = camera.position.clone().sub(orbit.target).multiplyScalar(ratio)
      orbit.target.copy(next.center).add(lookOffset)
      camera.position.copy(orbit.target).add(camOffset)
      orbit.update()
      snapshotOrbitCam()
      emitOrbitOffset()
    } else {
      const offset = camera.position.clone().sub(previous.center).multiplyScalar(ratio)
      camera.position.copy(next.center).add(offset)
      if (mode === 'free') {
        clampFreeCameraPosition(camera.position, next.center, next.maxFreeDist)
      }
      snapshotFreeCam()
    }
    signalActivity()
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
    freeLocked = false
  }

  const setupOrbit = () => {
    if (free) snapshotFreeCam()
    teardownControls()
    orbit = new OrbitControls(camera, canvas)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.08
    orbit.enablePan = true
    orbit.screenSpacePanning = true
    orbit.minPolarAngle = 0
    orbit.maxPolarAngle = Math.PI
    orbit.minDistance = 0.02
    orbit.addEventListener('change', () => {
      orbitNeedsRender = true
      signalActivity()
    })
    orbit.addEventListener('end', () => {
      snapshotOrbitCam()
      emitOrbitOffset()
    })
    placeOrbitCamera(false)
    onHint(formatOrbitHint())
    canvas.style.cursor = 'grab'
    activeMode = 'orbit'
    signalActivity()
  }

  const setupFree = () => {
    if (orbit) snapshotOrbitCam()
    teardownControls()
    free = new PointerLockControls(camera, canvas)
    placeFreeCamera(false)
    freeLocked = false
    onHint(formatFreeHint(freeSpeedRef.current, false))
    canvas.style.cursor = 'pointer'

    const onClick = () => {
      if (!free?.isLocked) free?.lock()
    }
    const onLock = () => {
      freeLocked = true
      onHint(formatFreeHint(freeSpeedRef.current, true))
      canvas.style.cursor = 'none'
    }
    const onUnlock = () => {
      freeLocked = false
      snapshotFreeCam()
      onHint(formatFreeHint(freeSpeedRef.current, false))
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
      writeStoredFreeSpeed(next)
      onFreeSpeedChange?.(next)
      onHint(formatFreeHint(next, free?.isLocked ?? false))
    }

    const onFreeLook = () => {
      if (free?.isLocked) signalActivity()
    }

    canvas.addEventListener('click', onClick)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    document.addEventListener('pointermove', onFreeLook)
    free.addEventListener('lock', onLock)
    free.addEventListener('unlock', onUnlock)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    removeFreeListeners = () => {
      canvas.removeEventListener('click', onClick)
      window.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('pointermove', onFreeLook)
      free?.removeEventListener('lock', onLock)
      free?.removeEventListener('unlock', onUnlock)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    activeMode = 'free'
    signalActivity()
  }

  const applyMode = (mode: PreviewNavigationMode) => {
    if (activeMode === mode && ((mode === 'free' && free) || (mode === 'orbit' && orbit))) {
      return
    }
    if (mode === 'free') setupFree()
    else setupOrbit()
  }

  const wish = new THREE.Vector3()
  const look = new THREE.Vector3()
  const right = new THREE.Vector3()

  const updateTick = (dt: number): boolean => {
    if (orbit) {
      orbit.update()
      const moved = orbitNeedsRender
      orbitNeedsRender = false
      return moved
    }
    if (!free?.isLocked) return false
    const { center, span, maxFreeDist } = getBounds()
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
      clampFreeCameraPosition(camera.position, center, maxFreeDist)
      signalActivity()
      return true
    }
    return false
  }

  const dispose = () => {
    if (activeMode === 'free') snapshotFreeCam()
    else if (activeMode === 'orbit') snapshotOrbitCam()
    teardownControls()
    activeMode = null
  }

  return {
    applyMode,
    updateTick,
    dispose,
    getOrbit: () => orbit,
    isFreeLocked: () => freeLocked,
    getActiveMode: () => activeMode,
    placeOrbitCamera,
    followContent,
    getOrbitOffset: currentOrbitOffset,
    setOrbitOffset: applyOrbitOffset,
    recenterOrbit: () => applyOrbitOffset(0, 0, 0),
  }
}
