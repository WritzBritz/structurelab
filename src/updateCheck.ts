const GITHUB_REPO = 'WritzBritz/structurelab'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export type UpdateStatusKind = 'checking' | 'latest' | 'update' | 'unknown'

export type UpdateCheckResult = {
  kind: UpdateStatusKind
  current: string
  latest: string | null
}

export function parseVersionTag(tag: string): [number, number, number] | null {
  const cleaned = tag.trim().replace(/^v/i, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Positive if `remote` is newer than `current`. */
export function compareVersions(current: string, remote: string): number {
  const a = parseVersionTag(current)
  const b = parseVersionTag(remote)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return b[i]! - a[i]!
  }
  return 0
}

export function classifyUpdate(current: string, remoteTag: string | null): UpdateStatusKind {
  if (!remoteTag) return 'unknown'
  const delta = compareVersions(current, remoteTag)
  if (delta > 0) return 'update'
  return 'latest'
}

type GithubRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
}

export async function fetchLatestReleaseTag(): Promise<string | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(GITHUB_LATEST_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as GithubRelease
    if (body.draft || body.prerelease) return null
    const tag = body.tag_name?.trim()
    return tag && parseVersionTag(tag) ? tag : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export async function checkForAppUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const latest = await fetchLatestReleaseTag()
  return {
    kind: classifyUpdate(currentVersion, latest),
    current: currentVersion,
    latest,
  }
}
