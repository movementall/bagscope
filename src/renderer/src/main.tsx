import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import './styles.css'
import { Component, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { inkFor } from './lib/format'
import { boot, useStore } from './lib/store'
import { MiniView } from './views/Extras'

/** A rendering bug shows a recoverable message instead of a blank window. Data is untouched. */
class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <h3>Bagscope hit a display error</h3>
        <p>Your wallets and settings are safe. Reloading the window usually fixes it.</p>
        <p className="mono faint selectable">{this.state.error.message}</p>
        <button className="btn primary" onClick={() => void window.bagscope.call('window.reload')}>Reload</button>
      </div>
    )
  }
}

/** The mini window loads the same bundle with #mini and renders only the compact view. */
function Mini() {
  const settings = useStore((s) => s.state?.settings)
  useEffect(() => void boot(), [])
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-ink', inkFor(settings.accent))
  }, [settings])
  return <MiniView />
}

createRoot(document.getElementById('root')!).render(<CrashGuard>{location.hash === '#mini' ? <Mini /> : <App />}</CrashGuard>)
