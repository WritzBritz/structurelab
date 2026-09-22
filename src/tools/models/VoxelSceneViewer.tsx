import { useCallback, useEffect, useRef, useState } from 'react'
import { Slider, Text } from '@radix-ui/themes'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneVoxel, VoxelPreviewStyle } from '../../types'
import {
  applyStaticClipPlanes,
  boundsFromBox3,
  createFreeCameraNavigation,
  formatFreeHint,
  formatOrbitHint,
  MAX_FREE_SPEED,
  MIN_FREE_SPEED,
  readStoredFreeSpeed,
  type FreeCameraNavigation,
  type PreviewNavigationMode,
  writeStoredFreeSpeed,
} from '../shared/freeCameraNavigation'
import { OrbitPivotPanel } from '../shared/OrbitPivotPanel'
import { releaseWebGLRenderer } from '../shared/webglRelease'
import { baseBlockId, blockTextureWarningLabel, loadBlockCubeFaces, type BlockFaceImage } from './blockTextures'

type Props = {
  voxels: SceneVoxel[]
  size: [number, number, number]
  previewStyle: VoxelPreviewStyle
  selectedPartIndex: number | null
  onSelectPartIndex: (partIndex: number | null) => void
  onTranslatePart: (partIndex: number, dx: number, dy: number, dz: number) => void
  onTranslateStart?: () => void
  onTranslateEnd?: () => void
  onMissingTextures?: (blocks: string[]) => void
  navigationMode?: PreviewNavigationMode
}

type MeshBucket = {
  mesh: THREE.InstancedMesh
  material: THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[]
  basePositions: THREE.Vector3[]
  partIds: number[]
  colors: THREE.Color[]
  globalIndices: number[]
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

/** Classic purple/black missing-texture tile so failures are obvious. */
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

export default function VoxelSceneViewer({
  voxels,
  size,
  previewStyle,
  selectedPartIndex,
  onSelectPartIndex,
  onTranslatePart,
  onTranslateStart,
  onTranslateEnd,
  onMissingTextures,
  navigationMode = 'orbit',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const navApiRef = useRef<FreeCameraNavigation | null>(null)
  const navigationModeRef = useRef(navigationMode)
  navigationModeRef.current = navigationMode
  const freeLockedRef = useRef(false)
  const selectedRef = useRef(selectedPartIndex)
  const onSelectRef = useRef(onSelectPartIndex)
  const onTranslateRef = useRef(onTranslatePart)
  const onTranslateStartRef = useRef(onTranslateStart)
  const onTranslateEndRef = useRef(onTranslateEnd)
  const onMissingRef = useRef(onMissingTextures)
  onMissingRef.current = onMissingTextures
  const applySelectionRef = useRef<(partIndex: number | null) => void>(() => {})
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

  useEffect(() => {
    selectedRef.current = selectedPartIndex
    // Free-cam: never re-attach the move gizmo from a selection change.
    applySelectionRef.current(
      navigationModeRef.current === 'free' ? null : selectedPartIndex,
    )
  }, [selectedPartIndex])
  useEffect(() => {
    onSelectRef.current = onSelectPartIndex
  }, [onSelectPartIndex])
  useEffect(() => {
    onTranslateRef.current = onTranslatePart
  }, [onTranslatePart])
  useEffect(() => {
    onTranslateStartRef.current = onTranslateStart
  }, [onTranslateStart])
  useEffect(() => {
    onTranslateEndRef.current = onTranslateEnd
  }, [onTranslateEnd])

  useEffect(() => {
    const host = hostRef.current
    if (!host || voxels.length === 0) return

    let disposed = false
    const disposables: Array<{ dispose: () => void }> = []
    const textures: THREE.Texture[] = []
    const buckets: MeshBucket[] = []
    const clock = new THREE.Clock()
    let needsRender = true
    const invalidate = () => {
      needsRender = true
    }

    const width = host.clientWidth || 640
    const height = Math.max(host.clientHeight, 420)
    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 4000)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: true,
    })
    renderer.setClearColor(0x151b24, 1)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.domElement.style.background = ''
    host.style.background = ''
    host.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 1.15)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4452, 0.85)
    const key = new THREE.DirectionalLight(0xffffff, 1.35)
    key.position.set(6, 14, 8)
    const fill = new THREE.DirectionalLight(0xd7e7ff, 0.55)
    fill.position.set(-8, 5, -6)
    const rim = new THREE.DirectionalLight(0xffffff, 0.4)
    rim.position.set(0, 8, -10)
    scene.add(ambient, hemi, key, fill, rim)

    const [sx, sy, sz] = size
    const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2)
    const contentBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(sx, sy, sz),
    )
    let navBounds = boundsFromBox3(contentBox)
    const sceneKey = `${sx}x${sy}x${sz}:${voxels.length}`

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    disposables.push(geometry)

    const matrix = new THREE.Matrix4()
    const scratchColor = new THREE.Color()

    function addBucket(
      count: number,
      map: THREE.Texture | THREE.Texture[] | null,
    ): MeshBucket {
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
      const mesh = new THREE.InstancedMesh(geometry, material, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      scene.add(mesh)
      const bucket: MeshBucket = {
        mesh,
        material,
        basePositions: [],
        partIds: [],
        colors: [],
        globalIndices: [],
      }
      buckets.push(bucket)
      return bucket
    }

    function fillBucket(
      bucket: MeshBucket,
      indices: number[],
      useMaterialColors: boolean,
      hasTextureMap: boolean,
    ) {
      indices.forEach((globalIndex, localIndex) => {
        const voxel = voxels[globalIndex]
        const position = new THREE.Vector3(voxel.x + 0.5, voxel.y + 0.5, voxel.z + 0.5)
        bucket.basePositions.push(position.clone())
        bucket.partIds.push(voxel.part)
        bucket.globalIndices.push(globalIndex)
        const color = useMaterialColors || !hasTextureMap
          ? new THREE.Color().setRGB(
              voxel.rgb[0] / 255,
              voxel.rgb[1] / 255,
              voxel.rgb[2] / 255,
              THREE.SRGBColorSpace,
            )
          : new THREE.Color(1, 1, 1)
        bucket.colors.push(color.clone())
        matrix.setPosition(position)
        bucket.mesh.setMatrixAt(localIndex, matrix)
        bucket.mesh.setColorAt(localIndex, color)
      })
      bucket.mesh.instanceMatrix.needsUpdate = true
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true
      bucket.mesh.computeBoundingSphere()
      invalidate()
    }

    async function buildMeshes() {
      if (previewStyle === 'materials') {
        const bucket = addBucket(voxels.length, null)
        fillBucket(
          bucket,
          voxels.map((_, index) => index),
          true,
          false,
        )
        onMissingRef.current?.([])
        return
      }

      const groups = new Map<string, number[]>()
      voxels.forEach((voxel, index) => {
        const key = voxel.block
          ? baseBlockId(voxel.block)
          : `rgb:${voxel.rgb.join(',')}`
        const list = groups.get(key)
        if (list) list.push(index)
        else groups.set(key, [index])
      })

      const missing: string[] = []
      await Promise.all(
        [...groups.entries()].map(async ([, indices]) => {
          if (disposed) return
          const sample = voxels[indices[0]]
          let texture: THREE.Texture | THREE.Texture[]
          if (sample.block) {
            const loaded = await loadBlockTexture(sample.block)
            texture = loaded.texture
            if (loaded.missing) missing.push(blockTextureWarningLabel(sample.block))
          } else {
            texture = solidTexture(sample.rgb)
          }
          if (disposed) {
            for (const entry of Array.isArray(texture) ? texture : [texture]) entry.dispose()
            return
          }
          if (Array.isArray(texture)) textures.push(...texture)
          else textures.push(texture)
          const bucket = addBucket(indices.length, texture)
          fillBucket(bucket, indices, false, Boolean(sample.block))
        }),
      )
      if (!disposed) {
        onMissingRef.current?.([...new Set(missing)].sort((a, b) => a.localeCompare(b)))
      }
    }

    const gridHelper = new THREE.GridHelper(
      Math.max(sx, sz, 8) + 4,
      Math.max(sx, sz, 8) + 4,
      0x2a3542,
      0x1a222c,
    )
    gridHelper.position.set(center.x, 0, center.z)
    scene.add(gridHelper)

    const setHint = (text: string) => {
      if (hintRef.current) hintRef.current.textContent = text
    }

    const nav = createFreeCameraNavigation({
      camera,
      canvas: renderer.domElement,
      viewerRoot: host.parentElement,
      sceneKey,
      getBounds: () => navBounds,
      navigationModeRef,
      onHint: setHint,
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

    const pivot = new THREE.Object3D()
    scene.add(pivot)
    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode('translate')
    transform.setSize(0.9)
    transform.addEventListener('dragging-changed', (event) => {
      invalidate()
      const orbitControls = nav.getOrbit()
      if (orbitControls) {
        orbitControls.enabled = !(event as unknown as { value: boolean }).value
      }
    })
    scene.add(transform.getHelper())

    let dragStart = new THREE.Vector3()
    transform.addEventListener('mouseDown', () => {
      if (navigationModeRef.current === 'free') return
      dragStart = pivot.position.clone()
      onTranslateStartRef.current?.()
      invalidate()
    })
    transform.addEventListener('objectChange', () => {
      if (navigationModeRef.current === 'free') return
      const selected = selectedRef.current
      if (selected == null) return
      applyVisualOffset(selected, pivot.position.clone().sub(dragStart))
      invalidate()
    })
    transform.addEventListener('mouseUp', () => {
      if (navigationModeRef.current === 'free') return
      const selected = selectedRef.current
      if (selected == null) return
      const delta = pivot.position.clone().sub(dragStart)
      const dx = Math.round(delta.x)
      const dy = Math.round(delta.y)
      const dz = Math.round(delta.z)
      const baked = new THREE.Vector3(dx, dy, dz)
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        for (const bucket of buckets) {
          for (let i = 0; i < bucket.basePositions.length; i += 1) {
            if (bucket.partIds[i] === selected) {
              bucket.basePositions[i].add(baked)
            }
          }
        }
      }
      applyVisualOffset(selected, new THREE.Vector3())
      pivot.position.copy(partCentroid(selected))
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        onTranslateRef.current(selected, dx, dy, dz)
      }
      onTranslateEndRef.current?.()
      invalidate()
    })

    function partCentroid(partIndex: number): THREE.Vector3 {
      const sum = new THREE.Vector3()
      let count = 0
      for (const bucket of buckets) {
        for (let i = 0; i < bucket.basePositions.length; i += 1) {
          if (bucket.partIds[i] === partIndex) {
            sum.add(bucket.basePositions[i])
            count += 1
          }
        }
      }
      if (count === 0) return center.clone()
      return sum.multiplyScalar(1 / count)
    }

    function applyVisualOffset(partIndex: number, delta: THREE.Vector3) {
      for (const bucket of buckets) {
        for (let i = 0; i < bucket.basePositions.length; i += 1) {
          const position = bucket.basePositions[i].clone()
          if (bucket.partIds[i] === partIndex) position.add(delta)
          matrix.setPosition(position)
          bucket.mesh.setMatrixAt(i, matrix)
        }
        bucket.mesh.instanceMatrix.needsUpdate = true
      }
    }

    function applySelectionStyle(partIndex: number | null) {
      for (const bucket of buckets) {
        for (let i = 0; i < bucket.colors.length; i += 1) {
          scratchColor.copy(bucket.colors[i])
          if (previewStyle === 'materials') {
            if (partIndex != null && bucket.partIds[i] !== partIndex) {
              scratchColor.multiplyScalar(0.45)
            } else if (partIndex != null && bucket.partIds[i] === partIndex) {
              scratchColor.offsetHSL(0, 0.06, 0.06)
            }
          } else if (partIndex != null && bucket.partIds[i] !== partIndex) {
            scratchColor.setRGB(0.45, 0.45, 0.45)
          } else {
            scratchColor.setRGB(1, 1, 1)
          }
          bucket.mesh.setColorAt(i, scratchColor)
        }
        if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true
      }

      if (navigationModeRef.current === 'free') {
        transform.enabled = false
        transform.detach()
        invalidate()
        return
      }
      transform.enabled = true
      if (partIndex == null) {
        transform.detach()
        invalidate()
        return
      }
      pivot.position.copy(partCentroid(partIndex))
      transform.attach(pivot)
      invalidate()
    }

    applySelectionRef.current = applySelectionStyle

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onPointerDown = (event: PointerEvent) => {
      if (navigationModeRef.current === 'free') return
      if (transform.dragging || event.button !== 0) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(
        buckets.map((bucket) => bucket.mesh),
        false,
      )
      if (hits.length === 0) return
      const hit = hits[0]
      const instanceId = hit.instanceId
      if (instanceId == null) return
      const bucket = buckets.find((entry) => entry.mesh === hit.object)
      if (!bucket) return
      onSelectRef.current(bucket.partIds[instanceId] ?? null)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const onResize = () => {
      const nextWidth = host.clientWidth || width
      const nextHeight = Math.max(host.clientHeight, 420)
      camera.aspect = nextWidth / nextHeight
      applyStaticClipPlanes(
        camera,
        navBounds.span,
        navigationModeRef.current,
        navBounds.maxFreeDist,
      )
      renderer.setSize(nextWidth, nextHeight)
      invalidate()
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(host)

    let frame = 0
    const tick = () => {
      if (disposed) return
      frame = requestAnimationFrame(tick)
      const dt = Math.min(clock.getDelta(), 0.05)
      const cameraMoved = nav.updateTick(dt)
      freeLockedRef.current = nav.isFreeLocked()
      if (!cameraMoved && !needsRender && !transform.dragging) return
      needsRender = false
      renderer.render(scene, camera)
    }
    tick()

    void buildMeshes().then(() => {
      if (disposed) return
      applySelectionStyle(selectedRef.current)
      invalidate()
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      applySelectionRef.current = () => {}
      transform.dispose()
      nav.dispose()
      navApiRef.current = null
      for (const texture of textures) texture.dispose()
      for (const item of disposables) item.dispose()
      for (const bucket of buckets) {
        scene.remove(bucket.mesh)
        bucket.mesh.dispose()
      }
      releaseWebGLRenderer(renderer)
    }
  }, [voxels, size, previewStyle, setFreeSpeedValue])

  useEffect(() => {
    navApiRef.current?.applyMode(navigationMode)
    // Detach the move gizmo when entering free-cam — otherwise a prior selection
    // still has TransformControls attached and can be dragged.
    applySelectionRef.current?.(
      navigationMode === 'free' ? null : selectedPartIndex,
    )
  }, [navigationMode, selectedPartIndex])

  useEffect(() => {
    if (navigationMode !== 'free' || !hintRef.current) return
    hintRef.current.textContent = formatFreeHint(freeSpeed, freeLockedRef.current)
  }, [freeSpeed, navigationMode])

  const textureNote =
    previewStyle === 'textures'
      ? ' · Showing Minecraft block textures'
      : ' · Showing solid cube colours'

  return (
    <div className={navigationMode === 'free' ? 'voxel-viewer map-art-3d' : 'voxel-viewer'}>
      <div className="voxel-viewer-canvas" ref={hostRef} />
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
      <div
        className={navigationMode === 'free' ? 'map-art-3d-hint' : 'voxel-viewer-hint'}
        ref={hintRef}
        aria-live="polite"
      >
        {navigationMode === 'free'
          ? formatFreeHint(freeSpeed, false)
          : `${formatOrbitHint()} · Click a block to select${textureNote}`}
      </div>
    </div>
  )
}
