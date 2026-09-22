import { useEffect, useRef } from 'react'
import { dismissBootSplash, revealAppWindow, runAppBoot, waitForBackdrop } from '../boot'

/**
 * Waits for real boot work, lets the home UI paint under the splash, then fades it out.
 */
export default function LoadingScreen({ onDone }: { onDone: () => void }) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    let cancelled = false

    void (async () => {
      await runAppBoot()
      if (cancelled) return

      // Don't reveal / dismiss until the Lightfall backdrop has painted (or timed out).
      await waitForBackdrop()
      if (cancelled) return
      await revealAppWindow()
      if (cancelled) return

      // Home is already mounted under the splash — wait until it has painted.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      if (cancelled) return

      await dismissBootSplash()
      if (!cancelled) onDoneRef.current()
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
