import { Button } from '@radix-ui/themes'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'structurelab.settings.lightfall'

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

type LightfallPreferenceValue = {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

const LightfallPreferenceContext = createContext<LightfallPreferenceValue | null>(null)

export function LightfallPreferenceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readEnabled)

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setEnabledState((current) => {
      const next = !current
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ enabled, setEnabled, toggle }),
    [enabled, setEnabled, toggle],
  )

  return (
    <LightfallPreferenceContext.Provider value={value}>
      {children}
    </LightfallPreferenceContext.Provider>
  )
}

export function useLightfallPreference(): LightfallPreferenceValue {
  const value = useContext(LightfallPreferenceContext)
  if (!value) {
    throw new Error('useLightfallPreference must be used within LightfallPreferenceProvider')
  }
  return value
}

export function LightfallToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useLightfallPreference()

  return (
    <Button
      type="button"
      variant="soft"
      size="2"
      className={className}
      aria-pressed={enabled}
      title={
        enabled
          ? 'Turn off background animation'
          : 'Turn on background animation'
      }
      onClick={toggle}
    >
      {enabled ? 'Animate' : 'Static'}
    </Button>
  )
}
