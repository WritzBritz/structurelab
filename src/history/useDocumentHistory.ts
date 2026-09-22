import { useCallback, useEffect, useRef, useState } from 'react'

export type HistoryProgress = (ratio: number, label: string) => void

const MAX_HISTORY_DEFAULT = 60
/** After coalesced edits stop, allow the next edit to start a fresh undo step. */
const COALESCE_IDLE_MS = 600

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function finishRestore(restoringRef: { current: boolean }) {
  // Let React commit the restored snapshot before we accept new edits into history.
  requestAnimationFrame(() => {
    queueMicrotask(() => {
      restoringRef.current = false
    })
  })
}

export type DocumentHistoryOptions<T> = {
  cloneSnapshot: (snapshot: T) => T
  /** When true (and a progress callback is passed), undo/redo yields frames + reports progress. */
  needsProgress?: (snapshot: T) => boolean
  maxHistory?: number
}

/**
 * Generic undo/redo stack used by Models and Maps so both tools behave the same.
 */
export function useDocumentHistory<T>(
  getSnapshot: () => T,
  applySnapshot: (snapshot: T) => void,
  {
    cloneSnapshot,
    needsProgress = () => false,
    maxHistory = MAX_HISTORY_DEFAULT,
  }: DocumentHistoryOptions<T>,
) {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const pastRef = useRef<T[]>([])
  const futureRef = useRef<T[]>([])
  const restoringRef = useRef(false)
  const coalesceKeyRef = useRef<string | null>(null)
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)
  const cloneRef = useRef(cloneSnapshot)
  const needsProgressRef = useRef(needsProgress)
  cloneRef.current = cloneSnapshot
  needsProgressRef.current = needsProgress

  const syncFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(futureRef.current.length > 0)
  }, [])

  const clearCoalesce = useCallback(() => {
    coalesceKeyRef.current = null
    if (coalesceTimerRef.current) {
      clearTimeout(coalesceTimerRef.current)
      coalesceTimerRef.current = null
    }
  }, [])

  /** End a coalesced undo group (e.g. slider drag released). Next edit starts a fresh step. */
  const endCoalesce = useCallback(() => {
    clearCoalesce()
  }, [clearCoalesce])

  const scheduleCoalesceIdle = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceKeyRef.current = null
      coalesceTimerRef.current = null
    }, COALESCE_IDLE_MS)
  }, [])

  /** Wipe undo/redo — use after first import so Ctrl+Z cannot return to an empty document. */
  const resetHistory = useCallback(() => {
    clearCoalesce()
    pastRef.current = []
    futureRef.current = []
    syncFlags()
  }, [clearCoalesce, syncFlags])

  /**
   * Capture current document before a mutating edit.
   * Optional key merges rapid edits (slider scrub) into one undo step.
   */
  const recordBeforeChange = useCallback(
    (coalesceKey?: string) => {
      if (restoringRef.current || busyRef.current) return
      if (coalesceKey && coalesceKeyRef.current === coalesceKey) {
        scheduleCoalesceIdle()
        return
      }
      pastRef.current.push(cloneRef.current(getSnapshot()))
      if (pastRef.current.length > maxHistory) pastRef.current.shift()
      futureRef.current = []
      if (coalesceKey) {
        coalesceKeyRef.current = coalesceKey
        scheduleCoalesceIdle()
      } else {
        clearCoalesce()
      }
      syncFlags()
    },
    [clearCoalesce, getSnapshot, maxHistory, scheduleCoalesceIdle, syncFlags],
  )

  const undo = useCallback(
    async (onProgress?: HistoryProgress): Promise<boolean> => {
      const past = pastRef.current
      if (past.length === 0 || busyRef.current) return false
      busyRef.current = true
      clearCoalesce()
      try {
        const currentLive = getSnapshot()
        const showProgress = Boolean(onProgress && needsProgressRef.current(currentLive))
        if (showProgress && onProgress) onProgress(0.12, 'Preparing undo…')
        if (showProgress) await yieldFrame()

        const current = cloneRef.current(currentLive)
        const previous = past.pop()!
        futureRef.current.push(current)

        if (showProgress && onProgress) onProgress(0.45, 'Restoring…')
        if (showProgress) await yieldFrame()

        restoringRef.current = true
        applySnapshot(previous)

        if (showProgress && onProgress) onProgress(0.82, 'Updating preview…')
        if (showProgress) await yieldFrame()

        finishRestore(restoringRef)
        syncFlags()
        if (showProgress && onProgress) onProgress(1, 'Undo complete')
        return true
      } finally {
        busyRef.current = false
      }
    },
    [applySnapshot, clearCoalesce, getSnapshot, syncFlags],
  )

  const redo = useCallback(
    async (onProgress?: HistoryProgress): Promise<boolean> => {
      const future = futureRef.current
      if (future.length === 0 || busyRef.current) return false
      busyRef.current = true
      clearCoalesce()
      try {
        const currentLive = getSnapshot()
        const showProgress = Boolean(onProgress && needsProgressRef.current(currentLive))
        if (showProgress && onProgress) onProgress(0.12, 'Preparing redo…')
        if (showProgress) await yieldFrame()

        const current = cloneRef.current(currentLive)
        const next = future.pop()!
        pastRef.current.push(current)

        if (showProgress && onProgress) onProgress(0.45, 'Restoring…')
        if (showProgress) await yieldFrame()

        restoringRef.current = true
        applySnapshot(next)

        if (showProgress && onProgress) onProgress(0.82, 'Updating preview…')
        if (showProgress) await yieldFrame()

        finishRestore(restoringRef)
        syncFlags()
        if (showProgress && onProgress) onProgress(1, 'Redo complete')
        return true
      } finally {
        busyRef.current = false
      }
    },
    [applySnapshot, clearCoalesce, getSnapshot, syncFlags],
  )

  useEffect(() => () => clearCoalesce(), [clearCoalesce])

  return {
    canUndo,
    canRedo,
    recordBeforeChange,
    endCoalesce,
    resetHistory,
    undo,
    redo,
    /** True while applying an undo/redo snapshot (skip re-recording). */
    isRestoring: () => restoringRef.current,
  }
}
