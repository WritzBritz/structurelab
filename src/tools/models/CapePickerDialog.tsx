import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Text } from '@radix-ui/themes'
import { AppDialog, SearchField, Segmented } from '../../ui/kit'
import { decodeImageRgba } from './decodeImage'
import {
  blitCapeFace,
  capeHdNote,
  capePngSize,
  fetchOfficialCape,
  inspectCapePng,
  OFFICIAL_CAPE_GROUPS,
  OFFICIAL_CAPES,
  officialCapeById,
  parseCapeAtlas,
  type OfficialCape,
  type OfficialCapeGroup,
} from './capeModel'

export type CapeSelection = {
  bytes: Uint8Array
  fileName: string
  capeId: string
}

type Props = {
  open: boolean
  currentId?: string | null
  onOpenChange: (open: boolean) => void
  onPick: (cape: CapeSelection) => void
}

export function CapeThumb({
  bytes,
  label,
}: {
  bytes: Uint8Array | null | undefined
  label?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!bytes || bytes.length < 64) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        canvas.width = 40
        canvas.height = 64
        ctx.clearRect(0, 0, 40, 64)
      }
      return
    }
    let cancelled = false
    void decodeImageRgba(bytes).then((image) => {
      if (cancelled || !canvasRef.current || !image) return
      blitCapeFace(image, canvasRef.current)
    })
    return () => {
      cancelled = true
    }
  }, [bytes])
  return (
    <span className="mc-cape-thumb" title={label}>
      <canvas ref={canvasRef} width={40} height={64} />
    </span>
  )
}

function OfficialCapeCell({
  cape,
  active,
  onPick,
}: {
  cape: OfficialCape
  active: boolean
  onPick: () => void
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void fetchOfficialCape(cape)
      .then((png) => {
        if (!cancelled) setBytes(png)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [cape])
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      onClick={() => onPick()}
      onDoubleClick={() => onPick()}
    >
      {bytes ? <CapeThumb bytes={bytes} label={cape.name} /> : (
        <span className="mc-cape-thumb mc-cape-thumb-empty">
          {failed ? '!' : '…'}
        </span>
      )}
      <span>{cape.name}</span>
    </button>
  )
}

export function CapePickerDialog({
  open,
  currentId,
  onOpenChange,
  onPick,
}: Props) {
  const [group, setGroup] = useState<OfficialCapeGroup | 'all'>('popular')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase()
    return OFFICIAL_CAPES.filter((cape) => {
      if (group !== 'all' && cape.group !== group) return false
      if (!query) return true
      return cape.name.toLowerCase().includes(query) || cape.id.includes(query)
    })
  }, [group, search])

  async function pickOfficial(cape: OfficialCape) {
    setBusy(`Loading ${cape.name}…`)
    setError(null)
    try {
      const bytes = await fetchOfficialCape(cape)
      onPick({
        bytes,
        fileName: `${cape.id}.png`,
        capeId: cape.id,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onPickedFile(file: File | undefined) {
    if (!file) return
    setBusy('Reading cape…')
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await inspectCapePng(bytes)
      onPick({
        bytes,
        fileName: file.name,
        capeId: 'custom',
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const current = currentId ? officialCapeById(currentId) : null

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cape"
      description="Official Minecraft capes hang on the selected player. Custom HD PNGs use the same 64×32 UV layout as vanilla."
      eyebrow="Player accessory"
      compact
      tools={(
        <Button
          type="button"
          variant="soft"
          color="gray"
          disabled={Boolean(busy)}
          onClick={() => fileInput.current?.click()}
        >
          Upload PNG
        </Button>
      )}
    >
      <div className="mc-library mc-cape-picker">
        <Segmented
          className="is-inline mc-cape-groups"
          size="1"
          value={group}
          onChange={(id) => setGroup(id as OfficialCapeGroup | 'all')}
          options={[
            { value: 'all', label: 'All' },
            ...OFFICIAL_CAPE_GROUPS.map((item) => ({
              value: item.id,
              label: item.label,
            })),
          ]}
        />
        <div className="mc-library-search">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Find a cape"
          />
          <Text size="1" color="gray">{shown.length} capes</Text>
        </div>
        {current && (
          <Text size="1" color="gray">Current: {current.name}</Text>
        )}
        {currentId === 'custom' && !current && (
          <Text size="1" color="gray">Current: uploaded PNG</Text>
        )}
        {error && <p className="mc-library-error">{error}</p>}
        {busy && <p className="mc-library-status">{busy}</p>}
        <div className="mc-library-grid mc-cape-grid">
          {shown.map((cape) => (
            <OfficialCapeCell
              key={cape.id}
              cape={cape}
              active={currentId === cape.id}
              onPick={() => void pickOfficial(cape)}
            />
          ))}
        </div>
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
      </div>
    </AppDialog>
  )
}

export function CapeField({
  capeBytes,
  capeId,
  capeFileName,
  onAdd,
  onRemove,
}: {
  capeBytes?: Uint8Array | null
  capeId?: string | null
  capeFileName?: string | null
  onAdd: () => void
  onRemove: () => void
}) {
  const official = capeId && capeId !== 'custom' ? officialCapeById(capeId) : null
  const size = capeBytes && capeBytes.length >= 64 ? capePngSize(capeBytes) : null
  const atlas = size ? parseCapeAtlas(size.width, size.height) : null
  const hasCape = Boolean(capeBytes && capeBytes.length >= 64)
  const title = official?.name
    ?? (capeFileName ? capeFileName.replace(/\.png$/i, '') : 'Cape')
  const hd = atlas ? capeHdNote(atlas) : null
  const detail = !hasCape
    ? 'Official gallery or a 64×32 / HD PNG'
    : hd
      ? `${hd} HD`
      : official
        ? 'Official Minecraft cape'
        : 'Custom cape'
  return (
    <div className="cape-style">
      <div className="size-preset-heading">
        <strong>Cape</strong>
        <span>Hangs on this player. Same 64×32 UV layout as vanilla, including HD scales.</span>
      </div>
      <div className={`companion-row cape-row ${hasCape ? 'ready' : 'missing'}`}>
        <CapeThumb bytes={hasCape ? capeBytes : null} label={title} />
        <span>
          <b>{hasCape ? title : 'No cape'}</b>
          <small>{detail}</small>
        </span>
        <div className="companion-row-actions">
          <Button type="button" size="1" variant="soft" color="gray" onClick={onAdd}>
            {hasCape ? 'Change' : 'Add cape'}
          </Button>
          {hasCape && (
            <Button type="button" size="1" variant="ghost" color="red" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
