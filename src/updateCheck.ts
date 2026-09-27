const GITHUB_REPO = 'WritzBritz/structurelab'
/** Releases list — `/releases/latest` 404s when every GitHub release is a prerelease. */
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`

export type UpdateStatusKind = 'checking' | 'latest' | 'update' | 'unknown'

export type UpdateCheckResult = {
  kind: UpdateStatusKind
  current: string
  latest: string | null
}

export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  /** Semver prerelease identifiers (`beta`, `1`, …). Empty = release build. */
  prerelease: string[]
}

/** Parse `v0.9.1-beta`, `0.9.1-beta.2`, `0.9.1`, etc. */
export function parseVersionTag(tag: string): ParsedVersion | null {
  const cleaned = tag.trim().replace(/^v/i, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!match) return null
  const prerelease = match[4]
    ? match[4].split('.').filter((part) => part.length > 0)
    : []
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

function comparePrereleasePart(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Number(a) - Number(b)
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver ordering. Positive if `remote` is newer than `current`.
 * Release builds sort above prereleases with the same core (`0.9.1` > `0.9.1-beta`).
 */
export function compareVersions(current: string, remote: string): number {
  const a = parseVersionTag(current)
  const b = parseVersionTag(remote)
  if (!a || !b) return 0
  if (a.major !== b.major) return b.major - a.major
  if (a.minor !== b.minor) return b.minor - a.minor
  if (a.patch !== b.patch) return b.patch - a.patch

  const aPre = a.prerelease
  const bPre = b.prerelease
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return -1 // current release is newer/equal vs remote pre
  if (bPre.length === 0) return 1 // remote release is newer than current pre
  const n = Math.max(aPre.length, bPre.length)
  for (let i = 0; i < n; i++) {
    if (i >= aPre.length) return 1
    if (i >= bPre.length) return -1
    // Part compare is a−b; negate so positive still means remote is newer.
    const delta = comparePrereleasePart(bPre[i]!, aPre[i]!)
    if (delta !== 0) return delta
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
  published_at?: string
}

function isPrereleaseVersion(version: string): boolean {
  const parsed = parseVersionTag(version)
  return Boolean(parsed && parsed.prerelease.length > 0)
}

/**
 * Choose the newest release that applies to this install.
 * Beta builds track prereleases + stables; stable builds only track non-prerelease tags
 * so a stable user is not offered a `-beta` build.
 */
export function pickRelevantReleaseTag(
  currentVersion: string,
  releases: GithubRelease[],
): string | null {
  const allowPrerelease = isPrereleaseVersion(currentVersion)
  let best: string | null = null
  for (const release of releases) {
    if (release.draft) continue
    if (release.prerelease && !allowPrerelease) continue
    const tag = release.tag_name?.trim()
    if (!tag || !parseVersionTag(tag)) continue
    if (!best || compareVersions(best, tag) > 0) best = tag
  }
  return best
}

export async function fetchLatestReleaseTag(currentVersion: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as GithubRelease[]
    if (!Array.isArray(body)) return null
    return pickRelevantReleaseTag(currentVersion, body)
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export async function checkForAppUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const latest = await fetchLatestReleaseTag(currentVersion)
  return {
    kind: classifyUpdate(currentVersion, latest),
    current: currentVersion,
    latest,
  }
}
