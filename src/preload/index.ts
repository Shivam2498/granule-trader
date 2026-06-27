import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/api'
import { cleanIpcError } from '../shared/clean-error'

const api: Record<string, (...args: any[]) => Promise<any>> = {}
for (const c of CHANNELS)
  api[c] = (...args: any[]) => ipcRenderer.invoke(c, ...args).catch((err: unknown) => { throw new Error(cleanIpcError(err)) })
contextBridge.exposeInMainWorld('api', api)
