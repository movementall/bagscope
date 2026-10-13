import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Resolve symlinked / redirected folders once so every path Vite sees agrees.
const here = realpathSync.native(__dirname)
const shared = { '@shared': resolve(here, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    root: resolve(here, 'src/renderer'),
    base: './',
    plugins: [
      react(),
      {
        // The UI makes no network requests of its own; token icons are the only remote content.
        name: 'bagscope-csp',
        apply: 'build',
        transformIndexHtml: (html) =>
          html.replace(
            '<!--csp-->',
            `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; connect-src 'none'" />`
          )
      }
    ],
    resolve: { alias: { ...shared, '@': resolve(here, 'src/renderer/src') } },
    define: { global: 'globalThis' },
    build: {
      rollupOptions: {
        input: {
          index: resolve(here, 'src/renderer/index.html'),
          // Served by the local bridge server to the user's browser, where Phantom lives.
          bridge: resolve(here, 'src/renderer/bridge.html')
        }
      }
    }
  }
})
