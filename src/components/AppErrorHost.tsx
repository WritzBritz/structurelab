import { useEffect, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { AppDialog } from '../ui/kit'
import {
  copyText,
  dismissAppError,
  formatErrorReport,
  lastAppError,
  reopenAppError,
  subscribeAppError,
  type AppErrorReport,
} from '../appError'
import { crashLogInfo, openLogFolder } from '../api'

export function useLastAppError(): AppErrorReport | null {
  const [report, setReport] = useState<AppErrorReport | null>(() => lastAppError())
  useEffect(() => subscribeAppError((next) => setReport(next)), [])
  return report
}

export function TopbarStatus({
  status,
  busy,
  ready,
}: {
  status: string
  busy: boolean
  ready: boolean
}) {
  const report = useLastAppError()
  const isError = Boolean(report && (status === report.summary || status.startsWith(`${report.title}:`)))
  const tone = isError ? 'error' : busy ? 'working' : ready ? 'ready' : ''

  return (
    <div className={`topbar-status${isError ? ' is-error' : ''}`}>
      <span className={`status-dot ${tone}`} />
      <span className="topbar-status-text" title={status}>
        {status}
      </span>
      {isError && report ? (
        <div className="topbar-status-actions">
          <button type="button" onClick={() => reopenAppError()}>
            Details
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(formatErrorReport(report))
            }}
          >
            Copy
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function CopyableNotice({
  tone = 'warning',
  title,
  body,
}: {
  tone?: 'warning' | 'error'
  title?: string
  body: string
}) {
  const [copied, setCopied] = useState(false)
  if (!body.trim()) return null
  return (
    <div className={`app-notice is-${tone}`}>
      <div className="app-notice-main">
        {title ? <strong>{title}</strong> : null}
        <pre className="app-notice-body">{body}</pre>
      </div>
      <button
        type="button"
        className="app-notice-copy"
        onClick={() => {
          void copyText(body).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function AppErrorHost() {
  const [report, setReport] = useState<AppErrorReport | null>(() => lastAppError())
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logDir, setLogDir] = useState('')

  useEffect(() => {
    return subscribeAppError((next, isOpen) => {
      setReport(next)
      setOpen(isOpen)
      setCopied(false)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    void crashLogInfo()
      .then((info) => setLogDir(info.logDir))
      .catch(() => setLogDir(''))
  }, [open])

  const text = report ? formatErrorReport(report, logDir || undefined) : ''

  return (
    <AppDialog
      open={open && Boolean(report)}
      onOpenChange={(next) => {
        if (!next) dismissAppError()
      }}
      compact
      maxWidth="640px"
      eyebrow="Error"
      title={report?.title ?? 'Something went wrong'}
      description="This text is selectable. Copy it if you want to debug or send the report."
      tools={
        <>
          <Button
            type="button"
            size="1"
            onClick={() => {
              void copyText(text).then((ok) => {
                if (!ok) return
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy report'}
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            onClick={() => {
              void openLogFolder().catch(() => {})
            }}
          >
            Open log folder
          </Button>
        </>
      }
    >
      {report ? (
        <div className="app-error-body">
          <p className="app-error-summary">{report.summary}</p>
          {report.hint ? (
            <p className="app-error-hint">
              <strong>What to try. </strong>
              {report.hint}
            </p>
          ) : null}
          <label className="app-error-label" htmlFor="app-error-details">
            Technical details
          </label>
          <textarea
            id="app-error-details"
            className="app-error-details"
            readOnly
            spellCheck={false}
            value={text}
          />
          {logDir ? <p className="app-error-path">{logDir}</p> : null}
        </div>
      ) : null}
    </AppDialog>
  )
}
