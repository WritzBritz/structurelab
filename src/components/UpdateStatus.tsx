import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import {
  checkForAppUpdate,
  GITHUB_RELEASES_URL,
  type UpdateStatusKind,
} from '../updateCheck'

function versionLabel(value: string): string {
  return value.startsWith('v') ? value : `v${value}`
}

function dotClass(kind: UpdateStatusKind): string {
  if (kind === 'checking') return 'working'
  if (kind === 'latest') return 'ready'
  if (kind === 'update') return 'update'
  return ''
}

function statusText(kind: UpdateStatusKind, current: string, latest: string | null): string {
  const version = current ? versionLabel(current) : ''
  if (kind === 'checking') return 'Checking…'
  if (kind === 'update') return latest ? `Update · ${versionLabel(latest)}` : 'Update'
  if (kind === 'unknown') return version || 'Offline'
  return version || 'Up to date'
}

export default function UpdateStatus() {
  const [kind, setKind] = useState<UpdateStatusKind>('checking')
  const [current, setCurrent] = useState('')
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const version = await getVersion().catch(() => '')
      if (!version) {
        if (cancelled) return
        setKind('unknown')
        return
      }
      const result = await checkForAppUpdate(version)
      if (cancelled) return
      setKind(result.kind)
      setCurrent(result.current)
      setLatest(result.latest)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const currentLabel = current ? versionLabel(current) : null
  const latestLabel = latest ? versionLabel(latest) : null
  const title =
    kind === 'update' && latestLabel
      ? `You have ${currentLabel}. ${latestLabel} is on GitHub.`
      : kind === 'latest'
        ? `Up to date (${currentLabel})`
        : kind === 'unknown'
          ? 'Could not reach GitHub Releases (offline or private repo).'
          : 'Checking GitHub Releases…'

  const className = `topbar-status update-status update-status-${kind}`
  const inner = (
    <>
      <span className={`status-dot ${dotClass(kind)}`} aria-hidden="true" />
      <span>{statusText(kind, current, latest)}</span>
    </>
  )

  if (kind === 'update') {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={() => window.open(GITHUB_RELEASES_URL, '_blank', 'noopener')}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={className} title={title}>
      {inner}
    </div>
  )
}
