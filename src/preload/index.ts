import { contextBridge, ipcRenderer } from 'electron'

// The renderer gets exactly two capabilities: call a named backend method, and
// listen for backend events. It has no Node access and makes no network requests.
contextBridge.exposeInMainWorld('bagscope', {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('call', method, args),
  on: (listener: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown): void => listener(event)
    ipcRenderer.on('event', handler)
    return () => ipcRenderer.removeListener('event', handler)
  }
})
