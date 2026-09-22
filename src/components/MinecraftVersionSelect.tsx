import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@radix-ui/themes'
import {
  getMinecraftVersion,
  groupVersionsByFamily,
  listMinecraftVersions,
  setMinecraftVersion,
  subscribeMinecraftVersion,
  versionFamilyId,
} from '../minecraftVersion'

type Props = {
  /** Called after assets and palette caches are cleared for the new version. */
  onVersionChange?: (versionId: string) => void
  className?: string
}

export default function MinecraftVersionSelect({ onVersionChange, className }: Props) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof listMinecraftVersions>>>([])
  const [activeId, setActiveId] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [focusFamilyId, setFocusFamilyId] = useState<string | null>(null)
  /** CSS `right` for the flyout — may be negative so builds can sit to the right of eras. */
  const [flyoutRight, setFlyoutRight] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const erasRef = useRef<HTMLDivElement>(null)
  const buildsRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const refresh = useCallback(async () => {
    const [listed, current] = await Promise.all([
      listMinecraftVersions(),
      getMinecraftVersion(),
    ])
    setVersions(listed)
    setActiveId(current)
  }, [])

  useEffect(() => {
    void refresh().catch(() => {
      setError('Could not load versions')
    })
    return subscribeMinecraftVersion((versionId) => {
      setActiveId(versionId)
      void refresh()
    })
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const families = useMemo(() => groupVersionsByFamily(versions), [versions])
  const availableFamilies = useMemo(
    () => families.filter((family) => family.versions.some((entry) => entry.available)),
    [families],
  )
  const activeFamilyId = activeId ? versionFamilyId(activeId) : availableFamilies[0]?.id ?? ''
  const panelFamilyId = focusFamilyId ?? activeFamilyId
  const panelFamily =
    families.find((family) => family.id === panelFamilyId) ?? availableFamilies[0]
  const panelVersions = panelFamily?.versions ?? []
  const active = versions.find((entry) => entry.id === activeId)
    ?? panelVersions.find((entry) => entry.available)

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const root = rootRef.current
      const builds = buildsRef.current
      if (!root || !builds) return
      const rootRect = root.getBoundingClientRect()
      const buildsW = builds.offsetWidth || 168
      const gap = 6
      const margin = 8
      // Align eras with the control; let builds extend to the right of eras.
      const idealRight = -(buildsW + gap)
      const buildsRight = rootRect.right - idealRight
      const overflow = buildsRight - (window.innerWidth - margin)
      setFlyoutRight(idealRight + Math.max(0, overflow))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, panelFamilyId])

  const canPick = availableFamilies.length > 0
    && versions.filter((entry) => entry.available).length > 1
    && !busy

  async function applyVersion(nextId: string) {
    if (!nextId || nextId === activeId || busy) return
    setBusy(true)
    setError(null)
    setOpen(false)
    try {
      await setMinecraftVersion(nextId)
      setActiveId(nextId)
      onVersionChange?.(nextId)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!active && !error) return null

  const tip = active
    ? `Export and blocks for Minecraft ${active.label} · data ${active.dataVersion}`
    : 'Choose which game version to export for (blocks and schematic format)'

  return (
    <div
      ref={rootRef}
      className={`version-select ${open ? 'is-open' : ''} ${busy ? 'is-busy' : ''} ${className ?? ''}`.trim()}
    >
      <span className="version-select-label">Version</span>
      <Button
        type="button"
        variant="soft"
        color="gray"
        size="1"
        className="version-select-trigger"
        title={tip}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={!canPick && !error}
        onClick={() => {
          if (!canPick) return
          setFocusFamilyId(activeFamilyId || null)
          setOpen((value) => !value)
        }}
      >
        <span className="version-select-value">{active?.label ?? '—'}</span>
        {canPick ? <span className="version-select-caret" aria-hidden="true" /> : null}
      </Button>

      {canPick ? (
        <div
          id={menuId}
          className="version-select-flyout"
          hidden={!open}
          role="group"
          aria-label="Minecraft version"
          style={{ right: flyoutRight }}
        >
          <div
            ref={erasRef}
            className="version-select-menu version-select-eras"
            role="listbox"
            aria-label="Era"
          >
            {availableFamilies.map((family) => {
              const selected = family.id === activeFamilyId
              const focused = family.id === panelFamilyId
              return (
                <button
                  key={family.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`version-select-option ${selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`}
                  disabled={busy}
                  onMouseEnter={() => setFocusFamilyId(family.id)}
                  onFocus={() => setFocusFamilyId(family.id)}
                  onClick={() => setFocusFamilyId(family.id)}
                >
                  <span className="version-select-option-label">{family.label}</span>
                  <span className="version-select-option-chevron" aria-hidden="true" />
                </button>
              )
            })}
          </div>

          <div
            ref={buildsRef}
            className="version-select-menu version-select-builds"
            role="listbox"
            aria-label={`${panelFamily?.label ?? 'Era'} builds`}
          >
            {panelVersions.map((entry) => {
              const selected = entry.id === activeId
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`version-select-option ${selected ? 'is-selected' : ''}`}
                  disabled={!entry.available || busy}
                  onClick={() => {
                    void applyVersion(entry.id)
                  }}
                >
                  <span className="version-select-option-label">{entry.label}</span>
                  <span className="version-select-option-meta">
                    {entry.available ? `data ${entry.dataVersion}` : 'not installed'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {error ? <span className="version-select-error">{error}</span> : null}
    </div>
  )
}
