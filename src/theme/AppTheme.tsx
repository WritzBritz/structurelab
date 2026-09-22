import {
  Theme,
  Button,
  type ThemeProps,
} from '@radix-ui/themes'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppDialog, Segmented } from '../ui/kit'
import { ColorWheel } from './ColorWheel'
import {
  applyAccentHex,
  clearAccentHex,
  lookFromHex,
  normalizeHex,
} from './color'
import { isThemeRevealRunning, originFromElement, runThemeReveal, type RevealOrigin } from './reveal'
import './theme.css'

const STORAGE_KEY = 'structurelab.theme.preset'
const CUSTOM_KEY = 'structurelab.theme.custom'
const LEGACY_KEY = 'structurelab.theme.appearance'

export type ThemePresetId =
  | 'midnight'
  | 'ember'
  | 'iris'
  | 'dusk'
  | 'moss'
  | 'carbon'
  | 'paper'
  | 'frost'
  | 'linen'
  | 'bloom'
  | 'custom'

type Appearance = NonNullable<ThemeProps['appearance']>
type AccentColor = NonNullable<ThemeProps['accentColor']>
type GrayColor = NonNullable<ThemeProps['grayColor']>

export type CustomThemeConfig = {
  appearance: Appearance
  accentHex: string
}

export type ThemePreset = {
  id: ThemePresetId
  label: string
  hint: string
  appearance: Appearance
  accentColor: AccentColor
  grayColor: GrayColor
  lightfall: string[]
  lightfallBg: string
  swatchAccent: string
  swatchPanel: string
}

type AccentLook = {
  hex: string
  darkBg: string
  lightBg: string
  darkPanel: string
  lightPanel: string
  darkFall: [string, string, string]
  lightFall: [string, string, string]
}

const ACCENT_LOOK: Record<string, AccentLook> = {
  indigo: {
    hex: '#3E63DD',
    darkBg: '#04081A',
    lightBg: '#EEF1F8',
    darkPanel: '#1B2430',
    lightPanel: '#F4F6FB',
    darkFall: ['#9DB7FF', '#3E63DD', '#1B2A4A'],
    lightFall: ['#A8BFFF', '#C9D4F0', '#E4E8F4'],
  },
  blue: {
    hex: '#0090FF',
    darkBg: '#041018',
    lightBg: '#EEF6FB',
    darkPanel: '#17222C',
    lightPanel: '#F3F8FC',
    darkFall: ['#7DD3FC', '#0090FF', '#0B3A62'],
    lightFall: ['#7DD3FC', '#B8D4EA', '#E2EEF6'],
  },
  sky: {
    hex: '#00A7E6',
    darkBg: '#061018',
    lightBg: '#F0F7FA',
    darkPanel: '#18222C',
    lightPanel: '#F4FAFC',
    darkFall: ['#7FDBFF', '#00A7E6', '#16425C'],
    lightFall: ['#9FE4FF', '#C5E6F2', '#E6F3F8'],
  },
  cyan: {
    hex: '#00A2C7',
    darkBg: '#041416',
    lightBg: '#EEF8F9',
    darkPanel: '#162428',
    lightPanel: '#F3FAFB',
    darkFall: ['#7CE7F0', '#00A2C7', '#0E4A52'],
    lightFall: ['#9AE8F0', '#C8E8EC', '#E6F4F5'],
  },
  teal: {
    hex: '#12A594',
    darkBg: '#041018',
    lightBg: '#E8EEF2',
    darkPanel: '#1B2430',
    lightPanel: '#F1F3F5',
    darkFall: ['#A6C8FF', '#12A594', '#0D3D38'],
    lightFall: ['#8ECFC6', '#B7C4FF', '#E4D4F4'],
  },
  jade: {
    hex: '#29A383',
    darkBg: '#06140E',
    lightBg: '#EEF6F2',
    darkPanel: '#18241E',
    lightPanel: '#F3F8F5',
    darkFall: ['#7DDEC8', '#29A383', '#164434'],
    lightFall: ['#8FD9C4', '#C5E6DA', '#E6F3EE'],
  },
  green: {
    hex: '#30A46C',
    darkBg: '#07140C',
    lightBg: '#F0F7F2',
    darkPanel: '#1A241C',
    lightPanel: '#F4F9F5',
    darkFall: ['#7DDEAA', '#30A46C', '#184A32'],
    lightFall: ['#97D4B0', '#C9E6D4', '#E7F3EB'],
  },
  grass: {
    hex: '#46A758',
    darkBg: '#0A1408',
    lightBg: '#F2F7EE',
    darkPanel: '#1C2418',
    lightPanel: '#F5F9F2',
    darkFall: ['#97E0A0', '#46A758', '#2A4A24'],
    lightFall: ['#A8D9AE', '#D0E6D2', '#EAF3EA'],
  },
  mint: {
    hex: '#86EAD4',
    darkBg: '#081412',
    lightBg: '#F0FAF7',
    darkPanel: '#182420',
    lightPanel: '#F4FBF8',
    darkFall: ['#86EAD4', '#3D9B8A', '#16443C'],
    lightFall: ['#9FEADB', '#C8EFE6', '#E6F7F3'],
  },
  lime: {
    hex: '#BDEE63',
    darkBg: '#101408',
    lightBg: '#F6FAEE',
    darkPanel: '#222418',
    lightPanel: '#F7FBF2',
    darkFall: ['#BDEE63', '#6B9B2A', '#3A4A14'],
    lightFall: ['#C8E88A', '#DCE6C4', '#F0F4E4'],
  },
  yellow: {
    hex: '#FFE62A',
    darkBg: '#141208',
    lightBg: '#FAF8EE',
    darkPanel: '#242218',
    lightPanel: '#FBF9F2',
    darkFall: ['#FFE62A', '#C4A000', '#4A4010'],
    lightFall: ['#F5E48A', '#E6E0C4', '#F4F1E4'],
  },
  amber: {
    hex: '#FFB224',
    darkBg: '#140804',
    lightBg: '#FAF4EE',
    darkPanel: '#2A2218',
    lightPanel: '#FBF6F0',
    darkFall: ['#FFB86B', '#E54D2E', '#7A3412'],
    lightFall: ['#FFD19A', '#E8D4C4', '#F4EBE4'],
  },
  orange: {
    hex: '#F76B15',
    darkBg: '#160A04',
    lightBg: '#FAF3EE',
    darkPanel: '#2A1E18',
    lightPanel: '#FBF6F2',
    darkFall: ['#FFA057', '#F76B15', '#6A2A0C'],
    lightFall: ['#FFB080', '#E8D0C4', '#F4EAE4'],
  },
  gold: {
    hex: '#978365',
    darkBg: '#12100C',
    lightBg: '#F7F5F0',
    darkPanel: '#242018',
    lightPanel: '#F8F6F2',
    darkFall: ['#D4C4A8', '#978365', '#4A4030'],
    lightFall: ['#D4C8B0', '#E6DFD2', '#F3EEE6'],
  },
  bronze: {
    hex: '#A18072',
    darkBg: '#140E0C',
    lightBg: '#F7F4F2',
    darkPanel: '#241C1A',
    lightPanel: '#F8F5F3',
    darkFall: ['#D2B2A4', '#A18072', '#4A342C'],
    lightFall: ['#D4C0B8', '#E6D8D2', '#F3ECE8'],
  },
  brown: {
    hex: '#AD7F58',
    darkBg: '#14100A',
    lightBg: '#F7F3EE',
    darkPanel: '#242018',
    lightPanel: '#F8F5F1',
    darkFall: ['#D4B08A', '#AD7F58', '#4A3820'],
    lightFall: ['#D4C0A8', '#E6D8C8', '#F3EDE4'],
  },
  tomato: {
    hex: '#E54D2E',
    darkBg: '#160808',
    lightBg: '#FAF1EE',
    darkPanel: '#281C1C',
    lightPanel: '#FBF5F3',
    darkFall: ['#FF977D', '#E54D2E', '#6A2014'],
    lightFall: ['#F5B0A0', '#E8D0C8', '#F4EAE6'],
  },
  red: {
    hex: '#E5484D',
    darkBg: '#160808',
    lightBg: '#FAF1F1',
    darkPanel: '#281C1C',
    lightPanel: '#FBF4F4',
    darkFall: ['#FF9592', '#E5484D', '#6A1C20'],
    lightFall: ['#F5B0B0', '#E8D0D0', '#F4E8E8'],
  },
  ruby: {
    hex: '#E54666',
    darkBg: '#16080C',
    lightBg: '#FAF1F3',
    darkPanel: '#281C20',
    lightPanel: '#FBF4F6',
    darkFall: ['#FF92AD', '#E54666', '#6A1C30'],
    lightFall: ['#F5B0C0', '#E8D0D6', '#F4E8EC'],
  },
  crimson: {
    hex: '#E93D82',
    darkBg: '#160810',
    lightBg: '#FAF1F5',
    darkPanel: '#281C22',
    lightPanel: '#FBF4F7',
    darkFall: ['#FF8FBD', '#E93D82', '#6A1840'],
    lightFall: ['#F5B0CC', '#E8D0DC', '#F4E8EE'],
  },
  pink: {
    hex: '#D6409F',
    darkBg: '#160814',
    lightBg: '#FAF1F7',
    darkPanel: '#281C26',
    lightPanel: '#FBF4F8',
    darkFall: ['#F6A3D7', '#D6409F', '#5A1848'],
    lightFall: ['#F0B4D8', '#E8D0E0', '#F4E8F0'],
  },
  plum: {
    hex: '#AB4ABA',
    darkBg: '#120814',
    lightBg: '#F7F1F8',
    darkPanel: '#241C28',
    lightPanel: '#F8F4F9',
    darkFall: ['#DFA1EA', '#AB4ABA', '#4A1854'],
    lightFall: ['#D8B4E0', '#E0D0E6', '#F0E8F4'],
  },
  purple: {
    hex: '#8E4EC6',
    darkBg: '#100818',
    lightBg: '#F6F1F9',
    darkPanel: '#221C2A',
    lightPanel: '#F7F4FA',
    darkFall: ['#C4B5FD', '#8E4EC6', '#3A1860'],
    lightFall: ['#D0B8F0', '#DCD0E8', '#F0E8F6'],
  },
  violet: {
    hex: '#6E56CF',
    darkBg: '#0C0818',
    lightBg: '#F4F1FA',
    darkPanel: '#1E1C2C',
    lightPanel: '#F6F4FB',
    darkFall: ['#B4A9F5', '#6E56CF', '#2C1868'],
    lightFall: ['#C4B8F0', '#D8D0E8', '#EEE8F4'],
  },
  iris: {
    hex: '#5B5BD6',
    darkBg: '#100818',
    lightBg: '#F2F1FA',
    darkPanel: '#241C2C',
    lightPanel: '#F5F4FB',
    darkFall: ['#C4B5FD', '#5B5BD6', '#FF9FFC'],
    lightFall: ['#C4B8F4', '#D4D0E8', '#ECE8F4'],
  },
  gray: {
    hex: '#8D99A6',
    darkBg: '#0C0E12',
    lightBg: '#F4F5F6',
    darkPanel: '#1A1E24',
    lightPanel: '#F7F8F9',
    darkFall: ['#C0C8D0', '#6B7684', '#2A3038'],
    lightFall: ['#C8CED4', '#DDE1E4', '#EEEFF1'],
  },
}

const DEFAULT_CUSTOM: CustomThemeConfig = {
  appearance: 'dark',
  accentHex: '#3E63DD',
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    hint: 'Navy studio',
    appearance: 'dark',
    accentColor: 'indigo',
    grayColor: 'slate',
    lightfall: ['#9DB7FF', '#3E63DD', '#1B2A4A'],
    lightfallBg: '#04081A',
    swatchAccent: '#3E63DD',
    swatchPanel: '#1B2430',
  },
  {
    id: 'ember',
    label: 'Ember',
    hint: 'Warm amber',
    appearance: 'dark',
    accentColor: 'amber',
    grayColor: 'sand',
    lightfall: ['#FFB86B', '#E54D2E', '#7A3412'],
    lightfallBg: '#140804',
    swatchAccent: '#FFB224',
    swatchPanel: '#2A2218',
  },
  {
    id: 'iris',
    label: 'Iris',
    hint: 'Cool violet',
    appearance: 'dark',
    accentColor: 'iris',
    grayColor: 'mauve',
    lightfall: ['#C4B5FD', '#5B5BD6', '#FF9FFC'],
    lightfallBg: '#100818',
    swatchAccent: '#9B8AFB',
    swatchPanel: '#241C2C',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    hint: 'Night sky',
    appearance: 'dark',
    accentColor: 'sky',
    grayColor: 'slate',
    lightfall: ['#7FDBFF', '#00A7E6', '#16425C'],
    lightfallBg: '#061018',
    swatchAccent: '#00A7E6',
    swatchPanel: '#18222C',
  },
  {
    id: 'moss',
    label: 'Moss',
    hint: 'Deep jade',
    appearance: 'dark',
    accentColor: 'jade',
    grayColor: 'sage',
    lightfall: ['#7DDEC8', '#29A383', '#164434'],
    lightfallBg: '#06140E',
    swatchAccent: '#29A383',
    swatchPanel: '#18241E',
  },
  {
    id: 'carbon',
    label: 'Carbon',
    hint: 'Quiet graphite',
    appearance: 'dark',
    accentColor: 'gray',
    grayColor: 'gray',
    lightfall: ['#C0C8D0', '#6B7684', '#2A3038'],
    lightfallBg: '#0C0E12',
    swatchAccent: '#8D99A6',
    swatchPanel: '#1A1E24',
  },
  {
    id: 'paper',
    label: 'Paper',
    hint: 'Light bench',
    appearance: 'light',
    accentColor: 'teal',
    grayColor: 'slate',
    lightfall: ['#1A6F68', '#3E5A9A', '#8A5A8E'],
    lightfallBg: '#D5DEE6',
    swatchAccent: '#0D9B8A',
    swatchPanel: '#E4EBEF',
  },
  {
    id: 'frost',
    label: 'Frost',
    hint: 'Icy sky',
    appearance: 'light',
    accentColor: 'sky',
    grayColor: 'slate',
    lightfall: ['#0B6F8A', '#2E7A94', '#4A90A8'],
    lightfallBg: '#D0E3EA',
    swatchAccent: '#00A7E6',
    swatchPanel: '#E2F0F4',
  },
  {
    id: 'linen',
    label: 'Linen',
    hint: 'Warm page',
    appearance: 'light',
    accentColor: 'brown',
    grayColor: 'sand',
    lightfall: ['#8A5528', '#A07040', '#C4A070'],
    lightfallBg: '#E6DCCE',
    swatchAccent: '#AD7F58',
    swatchPanel: '#F0E8DC',
  },
  {
    id: 'bloom',
    label: 'Bloom',
    hint: 'Soft rose',
    appearance: 'light',
    accentColor: 'pink',
    grayColor: 'mauve',
    lightfall: ['#A03070', '#C45A90', '#D490B0'],
    lightfallBg: '#E8D0DC',
    swatchAccent: '#D6409F',
    swatchPanel: '#F2E2EA',
  },
]

export const DARK_THEME_PRESETS = THEME_PRESETS.filter((entry) => entry.appearance === 'dark')
export const LIGHT_THEME_PRESETS = THEME_PRESETS.filter((entry) => entry.appearance === 'light')

export function customToPreset(config: CustomThemeConfig): ThemePreset {
  const appearance = config.appearance === 'light' ? 'light' : 'dark'
  const look = lookFromHex(config.accentHex, appearance)
  return {
    id: 'custom',
    label: 'Custom',
    hint: `${appearance === 'dark' ? 'Dark' : 'Light'} · ${normalizeHex(config.accentHex) ?? config.accentHex}`,
    appearance,
    accentColor: 'indigo',
    grayColor: 'slate',
    lightfall: [...look.fall],
    lightfallBg: look.bg,
    swatchAccent: look.hex,
    swatchPanel: look.panel,
  }
}

function isPresetId(value: string | null): value is ThemePresetId {
  if (!value) return false
  if (value === 'custom') return true
  return THEME_PRESETS.some((entry) => entry.id === value)
}

function readCustomConfig(): CustomThemeConfig {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return DEFAULT_CUSTOM
    const parsed = JSON.parse(raw) as Partial<CustomThemeConfig> & { accentColor?: string }
    const appearance = parsed.appearance === 'light' ? 'light' : 'dark'
    const accentHex =
      normalizeHex(parsed.accentHex) ??
      ACCENT_LOOK[String(parsed.accentColor)]?.hex ??
      DEFAULT_CUSTOM.accentHex
    return { appearance, accentHex }
  } catch {
    return DEFAULT_CUSTOM
  }
}

function writeCustomConfig(config: CustomThemeConfig) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
}

function writeSplash(preset: ThemePreset) {
  try {
    localStorage.setItem(
      'structurelab.theme.splash',
      JSON.stringify({
        bg: preset.lightfallBg,
        panel: preset.swatchPanel,
        accent: preset.swatchAccent,
        appearance: preset.appearance,
      }),
    )
  } catch {
    /* ignore */
  }
}

function readStoredPreset(): ThemePresetId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isPresetId(raw)) return raw
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light') return 'paper'
    if (legacy === 'dark') return 'midnight'
  } catch {
    /* ignore */
  }
  return 'midnight'
}

type AppThemeContextValue = {
  preset: ThemePreset
  custom: CustomThemeConfig
  setPresetId: (id: ThemePresetId, origin?: RevealOrigin) => Promise<void>
  applyCustom: (config: CustomThemeConfig, origin?: RevealOrigin) => void
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

export function useAppTheme(): AppThemeContextValue {
  const value = useContext(AppThemeContext)
  if (!value) {
    throw new Error('useAppTheme must be used within AppThemeProvider')
  }
  return value
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [presetId, setPresetIdState] = useState<ThemePresetId>(() => readStoredPreset())
  const [custom, setCustom] = useState<CustomThemeConfig>(() => readCustomConfig())
  const presetIdRef = useRef(presetId)
  presetIdRef.current = presetId

  const preset = useMemo(() => {
    if (presetId === 'custom') return customToPreset(custom)
    return THEME_PRESETS.find((entry) => entry.id === presetId) ?? THEME_PRESETS[0]
  }, [custom, presetId])

  const setPresetId = useCallback((next: ThemePresetId, origin?: RevealOrigin) => {
    if (presetIdRef.current === next) return Promise.resolve()
    return runThemeReveal(() => {
      setPresetIdState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
    }, origin)
  }, [])

  const applyCustom = useCallback((config: CustomThemeConfig, origin?: RevealOrigin) => {
    runThemeReveal(() => {
      setCustom(config)
      writeCustomConfig(config)
      setPresetIdState('custom')
      try {
        localStorage.setItem(STORAGE_KEY, 'custom')
      } catch {
        /* ignore */
      }
    }, origin)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const appearance = preset.appearance === 'light' ? 'light' : 'dark'
    root.dataset.appearance = appearance
    root.dataset.themePreset = preset.id
    root.style.colorScheme = appearance
    root.style.setProperty('--page-ground', preset.lightfallBg)
    // Boot paints html with an inline background; drop it so the paper ground wins.
    root.style.removeProperty('background')
    root.style.removeProperty('background-color')
    root.style.removeProperty('color')
    root.classList.add('radix-themes')
    root.classList.remove('light', 'dark')
    root.classList.add(appearance)
    writeSplash(preset)

    const theme = document.querySelector('.app-theme-root')
    if (theme) {
      for (const name of [
        'data-accent-color',
        'data-gray-color',
        'data-radius',
        'data-scaling',
        'data-panel-background',
      ]) {
        const value = theme.getAttribute(name)
        if (value) root.setAttribute(name, value)
      }
    }

    if (preset.id === 'custom') {
      applyAccentHex(preset.swatchAccent, appearance)
    } else {
      clearAccentHex()
    }
  }, [preset])

  const value = useMemo(
    () => ({ preset, custom, setPresetId, applyCustom }),
    [applyCustom, custom, preset, setPresetId],
  )

  return (
    <AppThemeContext.Provider value={value}>
      <Theme
        appearance={preset.appearance}
        accentColor={preset.accentColor}
        grayColor={preset.grayColor}
        radius="large"
        scaling="100%"
        panelBackground="solid"
        hasBackground={false}
        className="app-theme-root"
        style={{ minHeight: '100%', background: 'transparent' }}
      >
        {children}
      </Theme>
    </AppThemeContext.Provider>
  )
}

function positionThemeMenu(trigger: HTMLElement, menu: HTMLElement) {
  const box = trigger.getBoundingClientRect()
  menu.style.top = `${Math.round(box.bottom + 8)}px`
  menu.style.right = `${Math.round(window.innerWidth - box.right)}px`
  menu.style.left = 'auto'
}

function pointInRect(x: number, y: number, box: DOMRect | undefined | null) {
  if (!box || box.width <= 0 || box.height <= 0) return false
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

type MenuHit = {
  box: DOMRect
  themeId: ThemePresetId | null
  editCustom: boolean
}

function rememberMenuHits(menu: HTMLElement): { menuBox: DOMRect; hits: MenuHit[] } {
  const menuBox = menu.getBoundingClientRect()
  const hits: MenuHit[] = []
  for (const option of menu.querySelectorAll<HTMLElement>('.theme-option')) {
    const themeId = option.dataset.themeId
    hits.push({
      box: option.getBoundingClientRect(),
      themeId: themeId && isPresetId(themeId) ? themeId : null,
      editCustom: option.getAttribute('role') === 'menuitem',
    })
  }
  return { menuBox, hits }
}

function hitAtPoint(hits: MenuHit[], x: number, y: number) {
  return hits.find((hit) => pointInRect(x, y, hit.box)) ?? null
}

function ThemeOption({
  entry,
  checked,
  onPick,
}: {
  entry: ThemePreset
  checked: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-label={`${entry.label}, ${entry.hint}`}
      data-theme-id={entry.id}
      className={`theme-option${checked ? ' is-checked' : ''}`}
      onClick={onPick}
    >
      <span
        className="theme-swatch"
        style={{
          ['--swatch-accent' as string]: entry.swatchAccent,
          ['--swatch-panel' as string]: entry.swatchPanel,
        }}
        aria-hidden
      />
      <span className="theme-option-copy">
        {entry.label}
        <span className="theme-option-hint">{entry.hint}</span>
      </span>
    </button>
  )
}

/** Named looks plus a saved custom mix. Last choice is kept in localStorage. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preset, custom, setPresetId, applyCustom } = useAppTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<CustomThemeConfig>(custom)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBoxRef = useRef<DOMRect | null>(null)
  const menuHitsRef = useRef<MenuHit[]>([])
  const triggerBoxRef = useRef<DOMRect | null>(null)

  const customPreset = customToPreset(custom)
  const draftLook = lookFromHex(draft.accentHex, draft.appearance === 'light' ? 'light' : 'dark')
  const revealFromToggle = () => originFromElement(triggerRef.current)

  function openEditor() {
    setDraft(
      preset.id === 'custom'
        ? custom
        : {
            appearance: preset.appearance === 'light' ? 'light' : 'dark',
            accentHex: preset.swatchAccent,
          },
    )
    setEditorOpen(true)
  }

  function pickTheme(id: ThemePresetId) {
    void setPresetId(id, revealFromToggle())
  }

  useLayoutEffect(() => {
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!menu) return
    if (menuOpen) {
      try {
        if (!menu.matches(':popover-open')) menu.showPopover()
      } catch {
        /* already open */
      }
      if (trigger) {
        positionThemeMenu(trigger, menu)
        const triggerBox = trigger.getBoundingClientRect()
        if (triggerBox.width > 0 && triggerBox.height > 0) triggerBoxRef.current = triggerBox
      }
      const hits = rememberMenuHits(menu)
      if (!isThemeRevealRunning() && hits.menuBox.width > 0 && hits.menuBox.height > 0) {
        menuBoxRef.current = hits.menuBox
        menuHitsRef.current = hits.hits
      }
    } else if (menu.matches(':popover-open')) {
      menu.hidePopover()
    }
  }, [menuOpen, preset.label])

  useEffect(() => {
    if (!menuOpen) return
    const menu = menuRef.current
    const trigger = triggerRef.current
    const onPointerDown = (event: PointerEvent) => {
      const x = event.clientX
      const y = event.clientY
      const revealing = isThemeRevealRunning()
      const liveTriggerBox = trigger?.getBoundingClientRect()
      const triggerBox =
        revealing && triggerBoxRef.current
          ? triggerBoxRef.current
          : liveTriggerBox && liveTriggerBox.width > 0
            ? liveTriggerBox
            : triggerBoxRef.current
      const liveMenuBox = menu?.getBoundingClientRect()
      const menuBox =
        revealing && menuBoxRef.current
          ? menuBoxRef.current
          : liveMenuBox && liveMenuBox.width > 0
            ? liveMenuBox
            : menuBoxRef.current
      if (!revealing && triggerBox && triggerBox.width > 0) triggerBoxRef.current = triggerBox
      if (!revealing && menuBox && menuBox.width > 0) menuBoxRef.current = menuBox
      if (pointInRect(x, y, triggerBox)) return
      if (pointInRect(x, y, menuBox)) {
        const node = event.target as Node | null
        if (!revealing && menu && node && menu.contains(node)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const liveHit =
          !revealing && menu ? hitAtPoint(rememberMenuHits(menu).hits, x, y) : null
        const hit = liveHit ?? hitAtPoint(menuHitsRef.current, x, y)
        if (hit?.themeId) pickTheme(hit.themeId)
        else if (hit?.editCustom) openEditor()
        return
      }
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onResize = () => {
      if (trigger && menu) positionThemeMenu(trigger, menu)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="soft"
        size="2"
        className={`theme-toggle-btn ${className ?? ''}`.trim()}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span
          className="theme-swatch"
          style={{
            ['--swatch-accent' as string]: preset.swatchAccent,
            ['--swatch-panel' as string]: preset.swatchPanel,
          }}
          aria-hidden
        />
        {preset.label}
      </Button>
      <div
        ref={menuRef}
        id="theme-menu"
        popover="manual"
        role="menu"
        className="theme-menu"
        aria-label="Theme"
      >
        <div className="theme-menu-label">Dark</div>
        {DARK_THEME_PRESETS.map((entry) => (
          <ThemeOption
            key={entry.id}
            entry={entry}
            checked={preset.id === entry.id}
            onPick={() => pickTheme(entry.id)}
          />
        ))}
        {customPreset.appearance === 'dark' ? (
          <ThemeOption
            entry={customPreset}
            checked={preset.id === 'custom'}
            onPick={() => pickTheme('custom')}
          />
        ) : null}
        <div className="theme-menu-separator" />
        <div className="theme-menu-label">Light</div>
        {LIGHT_THEME_PRESETS.map((entry) => (
          <ThemeOption
            key={entry.id}
            entry={entry}
            checked={preset.id === entry.id}
            onPick={() => pickTheme(entry.id)}
          />
        ))}
        {customPreset.appearance === 'light' ? (
          <ThemeOption
            entry={customPreset}
            checked={preset.id === 'custom'}
            onPick={() => pickTheme('custom')}
          />
        ) : null}
        <div className="theme-menu-separator" />
        <button
          type="button"
          className="theme-option"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false)
            openEditor()
          }}
        >
          Edit custom…
        </button>
      </div>

      <AppDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title="Custom theme"
        description="Pick a light or dark base and any accent colour. This mix is remembered."
        maxWidth="420px"
        compact
      >
        <div className="theme-custom">
          <div
            className="theme-custom-preview"
            style={{
              background: draftLook.bg,
              borderColor: draftLook.panel,
              color: draft.appearance === 'dark' ? '#e9ecf2' : '#11181c',
            }}
          >
            <span
              className="theme-swatch"
              style={{
                ['--swatch-accent' as string]: draftLook.hex,
                ['--swatch-panel' as string]: draftLook.panel,
              }}
              aria-hidden
            />
            <div>
              <strong>Custom</strong>
              <span className="theme-option-hint">
                {draft.appearance === 'dark' ? 'Dark' : 'Light'} · {draft.accentHex}
              </span>
            </div>
          </div>
          <Segmented
            value={draft.appearance}
            onChange={(appearance) => setDraft((current) => ({ ...current, appearance }))}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
          <ColorWheel
            value={draft.accentHex}
            onChange={(accentHex) => setDraft((current) => ({ ...current, accentHex }))}
          />
          <Button
            type="button"
            onClick={() => {
              applyCustom(draft, revealFromToggle())
              setEditorOpen(false)
            }}
          >
            Use this theme
          </Button>
        </div>
      </AppDialog>
    </>
  )
}
