// ============================================================
// kalit-code-desktop — preload bridge
// ============================================================
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kalit', {
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:set', patch),
  listModels: (serverUrl?: string, token?: string) => ipcRenderer.invoke('models:list', { serverUrl, token }),
  health: (serverUrl?: string) => ipcRenderer.invoke('server:health', { serverUrl }),

  // conversations
  listConvs: () => ipcRenderer.invoke('conv:list'),
  getConv: (id: string) => ipcRenderer.invoke('conv:get', id),
  newConv: () => ipcRenderer.invoke('conv:new'),
  deleteConv: (id: string) => ipcRenderer.invoke('conv:delete', id),
  renameConv: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title),
  setConvModel: (id: string, model: string) => ipcRenderer.invoke('conv:setModel', id, model),

  // chat
  send: (convId: string, prompt: string) => ipcRenderer.invoke('chat:send', convId, prompt),
  abort: () => ipcRenderer.invoke('chat:abort'),

  // streaming events
  onEvent: (cb: (msg: { convId: string; ev: unknown }) => void) => {
    const h = (_e: unknown, msg: { convId: string; ev: unknown }) => cb(msg);
    ipcRenderer.on('chat:event', h);
    return () => ipcRenderer.removeListener('chat:event', h);
  },
  onDone: (cb: (msg: { convId: string; title: string; contextPercent: number }) => void) => {
    const h = (_e: unknown, msg: { convId: string; title: string; contextPercent: number }) => cb(msg);
    ipcRenderer.on('chat:done', h);
    return () => ipcRenderer.removeListener('chat:done', h);
  },
});
