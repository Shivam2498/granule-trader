import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/api'

const api: Record<string, (...args: any[]) => Promise<any>> = {}
for (const c of CHANNELS) api[c] = (...args: any[]) => ipcRenderer.invoke(c, ...args)
contextBridge.exposeInMainWorld('api', api)
