export type AppErrorReport = {
  title: string
  summary: string
  hint?: string
  details: string
  time: string
  operation?: string
}

type Listener = (report: AppErrorReport | null, open: boolean) => void

const listeners = new Set<Listener>()
let lastReport: AppErrorReport | null = null
let dialogOpen = false

function notify(): void {
  for (const listener of listeners) listener(lastReport, dialogOpen)
}

export function subscribeAppError(listener: Listener): () => void {
  listeners.add(listener)
  listener(lastReport, dialogOpen)
  return () => {
    listeners.delete(listener)
  }
}

export function lastAppError(): AppErrorReport | null {
  return lastReport
}

export function reopenAppError(): void {
  if (!lastReport) return
  dialogOpen = true
  notify()
}

export function dismissAppError(): void {
  dialogOpen = false
  notify()
}

export function formatErrorMessage(error: unknown): string {
  if (error == null || error === '') {
    return 'Unknown error (no message was provided)'
  }
  if (typeof error === 'string') return unwrapIpc(error.trim() || 'Unknown error')
  if (error instanceof Error) {
    const message = error.message.trim() || error.name || 'Error'
    return unwrapIpc(message)
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return unwrapIpc(record.message.trim())
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return unwrapIpc(record.error.trim())
    }
    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}' && json !== '[]') return unwrapIpc(json)
    } catch {
      // fall through
    }
    const asString = String(error)
    if (asString && asString !== '[object Object]') return unwrapIpc(asString)
    return 'Unknown error (object had no message)'
  }
  return unwrapIpc(String(error))
}

function unwrapIpc(message: string): string {
  return message.replace(/^error while running [a-z0-9_]+:\s*/i, '')
}

export function guessErrorHint(message: string): string | undefined {
  if (/out of memory|ran out of memory|convert crashed|max is|statue has \d|occupied/i.test(message)) {
    return 'Lower the size preset, enable Hollow, or convert fewer parts. Empty air is not stored, but a solid fill can still hit the 8 million block safety cap.'
  }
  if (/invalid texture|could not open|os error 2|enoent|not found|mtl/i.test(message)) {
    return 'Check that the file still exists and that companion files (.mtl, textures) are attached.'
  }
  if (/webview|ipc|invoke|command .* not found/i.test(message)) {
    return 'Restart StructureLab. If this keeps happening after a rebuild, the desktop commands are out of date.'
  }
  if (/export|permission|access is denied|readonly/i.test(message)) {
    return 'Pick a folder you can write to, or close the file if it is open in another program.'
  }
  if (/palette|minecraft version|assets are not installed/i.test(message)) {
    return 'Switch Minecraft version, or place that version’s minecraft/<id>/ folder beside the app.'
  }
  return undefined
}

function stamp(): string {
  try {
    return new Date().toISOString().replace('T', ' ').replace('Z', ' UTC')
  } catch {
    return ''
  }
}

export function buildAppError(
  title: string,
  error: unknown,
  extra?: { hint?: string; operation?: string },
): AppErrorReport {
  const message = formatErrorMessage(error)
  const hint = extra?.hint ?? guessErrorHint(message)
  const stack = error instanceof Error && error.stack ? `\n\n${error.stack}` : ''
  const raw = (() => {
    if (typeof error === 'string') return error
    if (error instanceof Error) return `${error.name}: ${error.message}${stack}`
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return String(error)
    }
  })()
  const summary = message.toLowerCase().startsWith(title.toLowerCase())
    ? message
    : `${title}: ${message}`
  const details = [
    extra?.operation ? `Operation: ${extra.operation}` : '',
    `Raw: ${raw}`,
    stack.trim() && !(raw.includes(error instanceof Error ? error.stack ?? '' : ''))
      ? error instanceof Error
        ? error.stack
        : ''
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    title,
    summary,
    hint,
    details,
    time: stamp(),
    operation: extra?.operation,
  }
}

export function formatErrorReport(report: AppErrorReport, logDir?: string): string {
  return [
    'StructureLab error',
    `Time: ${report.time}`,
    `Title: ${report.title}`,
    report.operation ? `Operation: ${report.operation}` : '',
    '',
    'What happened:',
    report.summary,
    report.hint ? `\nWhat to try:\n${report.hint}` : '',
    '',
    'Technical details:',
    report.details,
    logDir ? `\nLog folder: ${logDir}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function logLine(report: AppErrorReport): void {
  const line = `[ui-error] ${report.title}: ${report.summary}`
  console.error(line, report)
  void import('./api')
    .then(({ logDebug }) => {
      logDebug(line)
      if (report.details) logDebug(report.details.slice(0, 4000))
    })
    .catch(() => {
      // no native bridge
    })
}

/** Record an error, log it, and open the copyable dialog. Returns status-bar text. */
export function reportAppError(
  title: string,
  error: unknown,
  extra?: { hint?: string; operation?: string },
): AppErrorReport {
  const report = buildAppError(title, error, extra)
  lastReport = report
  dialogOpen = true
  logLine(report)
  notify()
  return report
}

export function statusFromError(
  title: string,
  error: unknown,
  extra?: { hint?: string; operation?: string },
): string {
  return reportAppError(title, error, extra).summary
}

const IGNORED_RENDERER =
  /resizeobserver loop|script error\.|cancelled|aborted|user cancelled|the user aborted/i

export function installRendererErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    const message = formatErrorMessage(event.error ?? event.message)
    if (IGNORED_RENDERER.test(message)) return
    reportAppError('The window hit an error', event.error ?? event.message, {
      operation: event.filename
        ? `renderer ${event.filename}:${event.lineno}:${event.colno}`
        : 'renderer',
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const message = formatErrorMessage(event.reason)
    if (IGNORED_RENDERER.test(message)) return
    reportAppError('A background task failed', event.reason, {
      operation: 'unhandled promise',
    })
  })
}
