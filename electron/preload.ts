import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/ipc';
import type { ChessArenaApi, WindowState } from '@shared/types';

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ChessArenaApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.appVersion),
    quit: () => ipcRenderer.send(IPC.appQuit),
    getStartupIssues: () => ipcRenderer.invoke(IPC.appStartupIssues),
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winToggleMaximize),
    toggleFullscreen: () => ipcRenderer.send(IPC.winToggleFullscreen),
    close: () => ipcRenderer.send(IPC.winClose),
    getState: () => ipcRenderer.invoke(IPC.winGetState),
    onStateChange: (cb) => subscribe<[WindowState]>(IPC.winStateChanged, cb),
    onCloseRequested: (cb) => subscribe<[]>(IPC.winCloseRequested, cb),
    confirmClose: () => ipcRenderer.send(IPC.winConfirmClose),
  },
  storage: {
    getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
    setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    getSavedGame: () => ipcRenderer.invoke(IPC.savedGameGet),
    setSavedGame: (game) => ipcRenderer.invoke(IPC.savedGameSet, game),
    clearSavedGame: () => ipcRenderer.invoke(IPC.savedGameClear),
  },
};

contextBridge.exposeInMainWorld('chessArena', api);
