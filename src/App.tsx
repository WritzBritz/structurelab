import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Badge, Card, Heading, Text } from '@radix-ui/themes'
import LoadingScreen from './components/LoadingScreen'
import { LoadOverlay } from './ui/kit'
import Lightfall from './components/Lightfall'
import {
  LightfallToggle,
  useLightfallPreference,
} from './components/LightfallPreference'
import UpdateStatus from './components/UpdateStatus'
import MinecraftVersionSelect from './components/MinecraftVersionSelect'
import { ThemeToggle, useAppTheme } from './theme/AppTheme'
import { abortThemeReveal } from './theme/reveal'
import { revealAppWindow, markBackdropReady } from './boot'
import { AppErrorHost } from './components/AppErrorHost'
import './workspace.css'
import './home.css'
import './ui/kit.css'

const MapsApp = lazy(() => import('./tools/maps/MapsApp'))
const ModelsApp = lazy(() => import('./tools/models/ModelsApp'))

type ToolId = 'home' | 'maps' | 'models'

function ToolFallback() {
  return <LoadOverlay variant="page" label="Loading tool…" indeterminate />
}

function AppLightfall({ onReady }: { onReady: () => void }) {
  const { preset } = useAppTheme()
  return (
    <Lightfall
      colors={preset.lightfall}
      backgroundColor={preset.lightfallBg}
      speed={0.2}
      streakCount={1}
      streakWidth={0.5}
      streakLength={0.6}
      glow={preset.appearance === 'light' ? 0.78 : 1}
      density={preset.appearance === 'light' ? 0.64 : 0.7}
      twinkle={1}
      zoom={1.6}
      backgroundGlow={0}
      opacity={1}
      mouseInteraction={false}
      mouseStrength={0}
      mouseRadius={0.6}
      ink={preset.appearance === 'light'}
      onReady={onReady}
    />
  )
}

/** Clears tool-loading mode after the lazy chunk mounts. */
function ToolReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady])
  return null
}

export default function App() {
  const { preset } = useAppTheme()
  const { enabled: lightfallEnabled } = useLightfallPreference()
  const [booting, setBooting] = useState(true)
  const [tool, setTool] = useState<ToolId>('home')
  const [toolLoading, setToolLoading] = useState(false)
  const clearToolLoading = useCallback(() => setToolLoading(false), [])
  const onLightfallReady = useCallback(() => {
    markBackdropReady()
    void revealAppWindow()
  }, [])

  useEffect(() => {
    if (!lightfallEnabled) {
      markBackdropReady()
      void revealAppWindow()
    }
  }, [lightfallEnabled])

  const openTool = (next: Exclude<ToolId, 'home'>) => {
    abortThemeReveal()
    setToolLoading(true)
    setTool(next)
  }

  const lightfallClass = booting || toolLoading
    ? 'is-loading'
    : tool === 'home'
      ? 'is-home'
      : 'is-tool'

  let content
  if (tool === 'maps') {
    content = (
      <Suspense fallback={<ToolFallback />}>
        <MapsApp
          onBack={() => {
            abortThemeReveal()
            clearToolLoading()
            setTool('home')
          }}
        />
        <ToolReady onReady={clearToolLoading} />
      </Suspense>
    )
  } else if (tool === 'models') {
    content = (
      <Suspense fallback={<ToolFallback />}>
        <ModelsApp
          onBack={() => {
            abortThemeReveal()
            clearToolLoading()
            setTool('home')
          }}
        />
        <ToolReady onReady={clearToolLoading} />
      </Suspense>
    )
  } else {
    content = (
      <div className="home-shell">
        <header className="home-topbar">
          <div className="brand-mark" aria-hidden="true">SL</div>
          <div className="brand-copy">
            <strong>StructureLab</strong>
            <span>Map art, pixel art &amp; model tools for Minecraft</span>
          </div>
          <UpdateStatus />
          <MinecraftVersionSelect className="home-version-select" />
          <LightfallToggle className="home-lightfall-toggle" />
          <ThemeToggle className="home-theme-toggle" />
        </header>
        <main className="home-main">
          <div className="home-intro">
            <Heading size="8">Choose a tool</Heading>
            <Text color="gray" size="3">
              Build map art or turn 3D models into Minecraft structures.
            </Text>
          </div>
          <div className="home-cards">
            <Card className="home-tool-card" asChild>
              <button type="button" onClick={() => openTool('maps')}>
                <span className="home-tool-card-inner">
                  <span className="home-tool-kicker">
                    <Badge variant="soft">Maps</Badge>
                  </span>
                  <Heading size="6">Map &amp; pixel art</Heading>
                  <Text color="gray" size="2">
                    Import an image for map art or in-world pixel art, pick a facing, choose
                    blocks, and export schematics.
                  </Text>
                </span>
              </button>
            </Card>
            <Card className="home-tool-card" asChild>
              <button type="button" onClick={() => openTool('models')}>
                <span className="home-tool-card-inner">
                  <span className="home-tool-kicker">
                    <Badge variant="soft">Models</Badge>
                  </span>
                  <Heading size="6">Models</Heading>
                  <Text color="gray" size="2">
                    Import OBJ, FBX, glTF or a skin, voxelize to a block size, choose materials, and export.
                  </Text>
                </span>
              </button>
            </Card>
          </div>
        </main>
      </div>
    )
  }

  return (
    <>
      <div
        className={`app-lightfall ${lightfallClass}${lightfallEnabled ? '' : ' is-static'}`}
        style={lightfallEnabled ? undefined : { background: preset.lightfallBg }}
        aria-hidden="true"
      >
        {lightfallEnabled ? <AppLightfall onReady={onLightfallReady} /> : null}
      </div>
      <div className="app-foreground">{content}</div>
      {booting ? <LoadingScreen onDone={() => setBooting(false)} /> : null}
      <AppErrorHost />
    </>
  )
}
