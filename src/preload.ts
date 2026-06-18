// ============================================================
// kalit-code-desktop — preload bridge
// ============================================================
// Exposes a tiny, safe API to the renderer. No Node access leaks.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kalit', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:set', patch),
  listModels: (serverUrl?: string, token?: string) => ipcRenderer.invoke('models:list', { serverUrl, token }),
  health: () => ipcRenderer.invoke('server:health'),
  send: (prompt: string) => ipcRenderer.invoke('chat:send', prompt),
  abort: () => ipcRenderer.invoke('chat:abort'),
  reset: () => ipcRenderer.invoke('chat:reset'),
  onEvent: (cb: (ev: unknown) => void) => {
    const h = (_e: unknown, ev: unknown) => cb(ev);
    ipcRenderer.on('chat:event', h);
    return () => ipcRenderer.removeListener('chat:event', h);
  },
  onDone: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('chat:done', h);
    return () => ipcRenderer.removeListener('chat:done', h);
  },
});
