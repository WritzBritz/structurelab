import { useMemo, useRef, useState } from 'react'
import { Button, Text } from '@radix-ui/themes'
import { SnowGolemPumpkinMobThumb } from '../../components/SnowGolemPumpkinMobThumb'
import { createSkinPart, type ScenePartLocal, type SkinLimbStyle, type SkinOverlayMode } from '../../types'
import { createZombieArmPose } from './characterPose'
import { entityModelToPart } from './entityCubesToObj'
import { catalogEyesOverlayPath } from './entityCatalogFixes'
import { EyesLayerMobThumb } from './eyesLayerThumb'
import { ComposedHeadThumb, PlayerHeadThumb } from './composedHeadThumb'
import { headPreviewVars, needsComposedHeadThumb } from './mobHeadPreview'
import {
  ALL_MOBS,
  PLAYER_PRESETS,
  expandTexturePaths,
  fetchPlayerPresetTexture,
  loadMobVisual,
  mobEntityTextureFileName,
  type PlayerPresetId,
  mobPreviewUrl,
  playerPreviewUrl,
  type CatalogKind,
} from './minecraftCatalog'
import { applySkinSizePreset } from './modelsPresets'
import { downloadVanillaTextureObjects, toMojangAssetKey } from '../../minecraftAssets'
import { ensureRgbaPngBytes } from './decodeImage'
import { inspectPlayerSkin, skinHdNote } from './skinModel'
import { AppDialog, CheckRow, SearchField, Segmented } from '../../ui/kit'

type Props = {
  outer3d: boolean
  onOuter3dChange: (value: boolean) => void
  onAdd: (parts: ScenePartLocal[]) => void
}

type Selected =
  | { kind: 'player'; id: PlayerPresetId }
  | { kind: 'player-custom' }
  | { kind: 'mob'; id: string }
  | { kind: 'mob-custom' }

export function MinecraftAddDialog({
  outer3d,
  onOuter3dChange,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CatalogKind>('players')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Selected>({ kind: 'player', id: 'steve' })
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needVanillaPack, setNeedVanillaPack] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const shownMobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return ALL_MOBS
    return ALL_MOBS.filter(
      (mob) => mob.name.toLowerCase().includes(query) || mob.id.includes(query),
    )
  }, [search])

  const preview = describeSelection(selected)

  async function addSkin(
    name: string,
    bytes: Uint8Array,
    slim: boolean,
    overlay: SkinOverlayMode = 'full',
    limbs: SkinLimbStyle = slim ? 'slim' : 'classic',
    pose: 'idle' | 'zombie' = 'idle',
    hdNote?: string | null,
    atlasScale = 1,
  ) {
    if (bytes.length < 64) throw new Error(`Skin PNG for ${name} was empty`)
    const zombie = pose === 'zombie' ? createZombieArmPose(slim) : null
    let part = createSkinPart(`${name}.png`, bytes, {
      slimArms: slim,
      skinOverlay: overlay,
      skinLimbs: limbs,
      sourceLabel: `Minecraft · ${name}${hdNote ? ` · ${hdNote}` : ''}`,
      skinPose: zombie
        ? { root: zombie.root, parts: zombie.parts }
        : undefined,
      atlasScale,
    })
    // Bundled Steve/Alex stay 1× native. HD uploads keep 1 voxel per HD texel.
    if (atlasScale <= 1) {
      part = applySkinSizePreset(part, '1x')
    }
    onAdd([part])
    setStatus(
      `Added ${name} (${slim ? 'slim' : 'classic'} arms · ${overlay === 'hat' ? 'hat overlay' : 'player overlay'}${hdNote ? ` · ${hdNote}` : ''})`,
    )
  }

  async function addMob(mob: (typeof ALL_MOBS)[number]) {
    const visual = await loadMobVisual(mob)
    if (!visual) {
      setNeedVanillaPack(true)
      throw new Error(`No vanilla cube model or texture for ${mob.name}. Download vanilla textures to install it.`)
    }
    const png = await ensureRgbaPngBytes(visual.bytes)
    const part = await entityModelToPart(
      visual.model,
      mobEntityTextureFileName(mob),
      png,
      mob.name,
      visual.extraTextures,
    )
    const extra =
      mob.id === 'snow_golem_pumpkin' && !visual.extraTextures?.pumpkin_face
        ? ' — pumpkin block textures missing (run npm run sync:assets)'
        : ''
    return { part, note: extra }
  }

  async function addCurrent() {
    setBusy('Adding…')
    setError(null)
    setNeedVanillaPack(false)
    try {
      if (selected.kind === 'player') {
        const preset = PLAYER_PRESETS.find((item) => item.id === selected.id)
        if (!preset) return
        const bytes = await fetchPlayerPresetTexture(preset)
        if (!bytes) {
          if (!preset.fallbackUrl) setNeedVanillaPack(true)
          throw new Error(
            preset.fallbackUrl
              ? `Could not load ${preset.name}. Check your network connection.`
              : `No local texture for ${preset.name}. Download vanilla textures to install it.`,
          )
        }
        const png = await ensureRgbaPngBytes(bytes)
        const slim = preset.slim
        await addSkin(preset.name, png, slim, 'full', slim ? 'slim' : 'classic')
        return
      }
      if (selected.kind === 'player-custom' || selected.kind === 'mob-custom') {
        fileInput.current?.click()
        return
      }
      if (selected.kind === 'mob') {
        const mob = ALL_MOBS.find((item) => item.id === selected.id)
        if (!mob) return
        const { part, note } = await addMob(mob)
        onAdd([part])
        setStatus(`Added ${mob.name} (${part.sourceLabel ?? 'vanilla cubes'})${note}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function importAllMobs() {
    setBusy('Importing catalog…')
    setError(null)
    setNeedVanillaPack(false)
    const parts: ScenePartLocal[] = []
    const skipped: string[] = []
    const columns = 10
    let column = 0
    let x = 0
    let z = 0
    let rowDepth = 0
    try {
      for (let index = 0; index < ALL_MOBS.length; index += 1) {
        const mob = ALL_MOBS[index]!
        setStatus(`Importing ${index + 1}/${ALL_MOBS.length}: ${mob.name}`)
        try {
          const { part } = await addMob(mob)
          if (column >= columns) {
            column = 0
            z += rowDepth + 6
            x = 0
            rowDepth = 0
          }
          parts.push({ ...part, positionX: x, positionZ: z })
          x += Math.max(part.width, 4) + 6
          rowDepth = Math.max(rowDepth, part.length)
          column += 1
        } catch (err) {
          skipped.push(mob.name)
          if (err instanceof Error && err.message.includes('vanilla textures')) {
            setNeedVanillaPack(true)
          }
        }
      }
      if (parts.length === 0) {
        throw new Error('No catalog mobs could be imported. Download vanilla textures first.')
      }
      onAdd(parts)
      const miss = skipped.length
        ? ` Skipped ${skipped.length}: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}.`
        : ''
      setStatus(`Imported ${parts.length} mobs in a ${columns}-wide grid for checking.${miss}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  function missingAssetKeys(): string[] {
    if (selected.kind === 'player') {
      const preset = PLAYER_PRESETS.find((item) => item.id === selected.id)
      return preset ? expandTexturePaths(preset.texturePaths).map(toMojangAssetKey) : []
    }
    if (selected.kind === 'mob') {
      const mob = ALL_MOBS.find((item) => item.id === selected.id)
      return mob ? expandTexturePaths(mob.texturePaths).map(toMojangAssetKey) : []
    }
    return []
  }

  async function downloadVanillaPack() {
    setBusy('Downloading vanilla textures…')
    setError(null)
    try {
      const result = await downloadVanillaTextureObjects(missingAssetKeys())
      setStatus(`Downloaded ${result.entityCount + result.blockCount} texture file(s)`)
      setNeedVanillaPack(false)
      await addCurrent()
    } catch (err) {
      setNeedVanillaPack(true)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onPickedFile(file: File | undefined) {
    if (!file) return
    setBusy('Reading skin…')
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const png = await ensureRgbaPngBytes(bytes)
      const { atlas, slim } = await inspectPlayerSkin(png, file.name)
      await addSkin(
        file.name.replace(/\.png$/i, '') || 'Custom skin',
        png,
        slim,
        'full',
        slim ? 'slim' : 'classic',
        'idle',
        skinHdNote(atlas),
        atlas.scale,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const library = (
        <>
          <Segmented
            className="is-inline"
            value={tab}
            onChange={(id) => {
              setTab(id)
              setSearch('')
              setError(null)
              if (id === 'players') setSelected({ kind: 'player', id: 'steve' })
              else setSelected({ kind: 'mob', id: ALL_MOBS[0]!.id })
            }}
            options={[
              { value: 'players', label: 'Players' },
              { value: 'mobs', label: 'Mobs' },
            ]}
          />

          <div className="mc-library-preview">
            <SelectionThumb selected={selected} />
            <div className="mc-library-preview-copy">
              <strong>{preview.title}</strong>
              <small>{preview.hint}</small>
            </div>
          </div>

          {tab === 'players' && (
            <CheckRow checked={outer3d} onChange={onOuter3dChange}>
              3D outer layer
            </CheckRow>
          )}

          {tab === 'mobs' && (
            <div className="mc-library-search">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Find a mob"
              />
              <Text size="1" color="gray">{shownMobs.length} mobs</Text>
            </div>
          )}

          {error && <p className="mc-library-error">{error}</p>}
          {needVanillaPack && (
            <Button
              type="button"
              color="amber"
              variant="soft"
              disabled={Boolean(busy)}
              onClick={() => void downloadVanillaPack()}
            >
              {busy?.startsWith('Downloading') ? 'Downloading…' : 'Download vanilla textures'}
            </Button>
          )}
          {status && !error && <p className="mc-library-status">{status}</p>}

          {tab === 'players' && (
            <div className="mc-library-grid">
              {PLAYER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={selected.kind === 'player' && selected.id === preset.id ? 'active' : ''}
                  onClick={() => setSelected({ kind: 'player', id: preset.id })}
                  onDoubleClick={() => void addCurrent()}
                >
                  <span className="mc-library-skin">
                    <PlayerHeadThumb src={playerPreviewUrl(preset)} />
                  </span>
                  {preset.name}
                </button>
              ))}
              <button
                type="button"
                className={selected.kind === 'player-custom' ? 'active' : ''}
                onClick={() => {
                  setSelected({ kind: 'player-custom' })
                  fileInput.current?.click()
                }}
              >
                <span className="mc-library-upload">PNG</span>
                Custom
              </button>
            </div>
          )}

          {tab === 'mobs' && (
            <div className="mc-library-grid">
              {shownMobs.map((mob) => (
                <button
                  key={mob.id}
                  type="button"
                  className={selected.kind === 'mob' && selected.id === mob.id ? 'active' : ''}
                  onClick={() => setSelected({ kind: 'mob', id: mob.id })}
                  onDoubleClick={() => void addCurrent()}
                >
                  <span className="mc-library-skin" style={headPreviewVars(mob.id)}>
                    <MobCatalogThumb mob={mob} />
                  </span>
                  {mob.name}
                </button>
              ))}
              <button
                type="button"
                className={selected.kind === 'mob-custom' ? 'active' : ''}
                onClick={() => {
                  setSelected({ kind: 'mob-custom' })
                  fileInput.current?.click()
                }}
              >
                <span className="mc-library-upload">PNG</span>
                Custom
              </button>
            </div>
          )}

          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".png,image/png"
            onChange={(event) => {
              void onPickedFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </>
  )

  return (
    <>
      <Button
        type="button"
        variant="surface"
        size="3"
        className="ui-drop-zone mc-library-open"
        onClick={() => setOpen(true)}
      >
        <span className="ui-drop-icon">▦</span>
        <strong>Minecraft library</strong>
        <small>Players and mobs — full catalog</small>
      </Button>
      <AppDialog
        open={open}
        onOpenChange={setOpen}
        eyebrow="Catalog"
        title="Minecraft library"
        description="Players and mobs — not limited by export version"
        tools={(
          <>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void addCurrent()}
            >
              {busy ? 'Adding…' : 'Add to scene'}
            </Button>
            {tab === 'mobs' ? (
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={Boolean(busy)}
                title="Import every catalog mob in a grid"
                onClick={() => void importAllMobs()}
              >
                {busy ? 'Importing…' : 'Import all'}
              </Button>
            ) : null}
          </>
        )}
      >
        {library}
      </AppDialog>
    </>
  )
}

function MobCatalogThumb({ mob }: { mob: (typeof ALL_MOBS)[number] }) {
  if (mob.id === 'snow_golem_pumpkin') {
    return <SnowGolemPumpkinMobThumb />
  }
  if (needsComposedHeadThumb(mob.id)) {
    return <ComposedHeadThumb mob={mob} />
  }
  if (catalogEyesOverlayPath(mob.id)) {
    return <EyesLayerMobThumb mob={mob} />
  }
  return <img src={mobPreviewUrl(mob)} alt="" />
}

function describeSelection(selected: Selected): { title: string; hint: string } {
  if (selected.kind === 'player') {
    const preset = PLAYER_PRESETS.find((item) => item.id === selected.id)
    return { title: preset?.name ?? 'Player', hint: preset?.hint ?? 'Default skin' }
  }
  if (selected.kind === 'player-custom') {
    return { title: 'Custom skin', hint: '64×64, 64×32, or any HD scale of that layout (up to 8192×8192) — slim arms are read from the PNG' }
  }
  if (selected.kind === 'mob-custom') {
    return { title: 'Custom mob', hint: 'PNG using player UVs — 64×64 or HD (same layout)' }
  }
  const mob = ALL_MOBS.find((item) => item.id === selected.id)
  return { title: mob?.name ?? 'Mob', hint: mob?.slim ? 'Slim arms' : 'Classic arms' }
}

function SelectionThumb({ selected }: { selected: Selected }) {
  if (selected.kind === 'player') {
    const preset = PLAYER_PRESETS.find((item) => item.id === selected.id)
    return (
      <span className="mc-library-skin large">
        {preset ? <PlayerHeadThumb src={playerPreviewUrl(preset)} /> : null}
      </span>
    )
  }
  if (selected.kind === 'mob') {
    const mob = ALL_MOBS.find((item) => item.id === selected.id)
    return (
      <span className="mc-library-skin large" style={mob ? headPreviewVars(mob.id) : undefined}>
        {mob ? <MobCatalogThumb mob={mob} /> : null}
      </span>
    )
  }
  return <span className="mc-library-upload">PNG</span>
}
