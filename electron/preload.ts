import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/ipc';
import type { ChessArenaApi, UpdaterInfo, WindowState } from '@shared/types';

/** Game server address, injected at build time (electron.vite.config.ts). */
declare const __SERVER_URL__: string;
const SERVER_URL = __SERVER_URL__;

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ChessArenaApi = {
  app: {
    platform: process.platform,
    getVersion: () => ipcRenderer.invoke(IPC.appVersion),
    quit: () => ipcRenderer.send(IPC.appQuit),
    onNavigate: (cb) => subscribe<[string]>(IPC.appNavigate, cb),
    getStartupIssues: () => ipcRenderer.invoke(IPC.appStartupIssues),
    openDataFolder: () => ipcRenderer.send(IPC.appOpenDataFolder),
    getLicense: (id) => ipcRenderer.invoke(IPC.appLicense, id),
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
    getProfiles: () => ipcRenderer.invoke(IPC.profilesGet),
    setProfiles: (doc) => ipcRenderer.invoke(IPC.profilesSet, doc),
    getHistory: () => ipcRenderer.invoke(IPC.historyGet),
    addGameRecord: (record) => ipcRenderer.invoke(IPC.historyAdd, record),
    resetProgress: () => ipcRenderer.invoke(IPC.resetProgress),
  },
  dialog: {
    exportPgn: (gameId) => ipcRenderer.invoke(IPC.dialogExportPgn, gameId),
    exportData: () => ipcRenderer.invoke(IPC.dialogExportData),
    importData: () => ipcRenderer.invoke(IPC.dialogImportData),
  },
  engine: {
    start: () => ipcRenderer.invoke(IPC.engineStart),
    bestMove: (req) => ipcRenderer.invoke(IPC.engineBestMove, req),
    stop: () => ipcRenderer.send(IPC.engineStop),
  },
  online: {
    serverUrl: SERVER_URL,
    getIdentity: () => ipcRenderer.invoke(IPC.onlineIdentityGet),
    setDisplayName: (name) => ipcRenderer.invoke(IPC.onlineDisplayNameSet, name),
    getRejoin: () => ipcRenderer.invoke(IPC.onlineRejoinGet),
    setRejoin: (rejoin) => ipcRenderer.invoke(IPC.onlineRejoinSet, rejoin),
    clearRejoin: () => ipcRenderer.invoke(IPC.onlineRejoinClear),
  },
  updater: {
    getInfo: () => ipcRenderer.invoke(IPC.updaterGetInfo),
    check: () => ipcRenderer.send(IPC.updaterCheck),
    download: () => ipcRenderer.send(IPC.updaterDownload),
    install: () => ipcRenderer.send(IPC.updaterInstall),
    onChange: (cb) => subscribe<[UpdaterInfo]>(IPC.updaterChanged, cb),
  },
};

contextBridge.exposeInMainWorld('chessArena', api);
