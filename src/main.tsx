import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@radix-ui/themes/styles.css'
import './base.css'
import { installRendererErrorHandlers } from './appError'
import { markBackdropReady, revealAppWindow, runAppBoot } from './boot'
import { LightfallPreferenceProvider } from './components/LightfallPreference'
import { AppThemeProvider } from './theme/AppTheme'
import App from './App.tsx'

installRendererErrorHandlers()

// Start real boot as soon as the JS bundle is up — don't wait for React effects.
void runAppBoot()

// Fallback: never leave the Tauri window hidden if WebGL is slow or unavailable.
window.setTimeout(() => {
  markBackdropReady()
  void revealAppWindow()
}, 2500)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppThemeProvider>
      <LightfallPreferenceProvider>
        <App />
      </LightfallPreferenceProvider>
    </AppThemeProvider>
  </StrictMode>,
)
