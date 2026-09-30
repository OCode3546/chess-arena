import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC } from '@shared/ipc';
import type { EngineStatus, WindowState } from '@shared/types';
import { isSearchRequest } from '@shared/validate';
import { NativeEngine, type NativeEngineStatus } from './engine';
import {
  addGameRecord,
  clearSavedGame,
  getHistory,
  getProfiles,
  getSavedGame,
  getSettings,
  getStartupIssues,
  initStorage,
  setProfiles,
  setSavedGame,
  setSettings,
} from './storage';
import { runSmokeTest } from './smoke';

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];
const smokeTest = process.env['CHESS_ARENA_SMOKE'] === '1';

/** External links that may be opened in the system browser. */
const EXTERNAL_ALLOW = [
  'https://stockfishchess.org/',
  'https://github.com/official-stockfish/',
  'https://github.com/lichess-org/',
  'https://github.com/nmrugg/stockfish.js',
];

if (process.env['CHESS_ARENA_USER_DATA']) {
  app.setPath('userData', process.env['CHESS_ARENA_USER_DATA']);
}

let mainWindow: BrowserWindow | null = null;
let allowClose = false;
let engine: NativeEngine | null = null;

/** Bundled Stockfish for this OS (`CHESS_ARENA_ENGINE_PATH` overrides it for testing). */
function engineBinaryPath(): string | null {
  const override = process.env['CHESS_ARENA_ENGINE_PATH'];
  if (override !== undefined) return override || null;
  const arm = process.arch === 'arm64';
  const file =
    process.platform === 'win32'
      ? `stockfish-windows-${arm ? 'arm64' : 'x86-64'}.exe`
      : process.platform === 'darwin'
        ? 'stockfish-macos'
        : `stockfish-linux-${arm ? 'arm64' : 'x86-64'}`;
  const dir = app.isPackaged
    ? join(process.resourcesPath, 'engine')
    : join(app.getAppPath(), 'resources', 'engine');
  return join(dir, file);
}

/** Fallback order for the renderer; `CHESS_ARENA_ENGINE_FALLBACKS` narrows it for testing. */
function engineFallbacks(): EngineStatus['fallbacks'] {
  const all: EngineStatus['fallbacks'] = ['wasm', 'minimax'];
  const env = process.env['CHESS_ARENA_ENGINE_FALLBACKS'];
  if (env === undefined) return all;
  const wanted = env.split(',').map((s) => s.trim());
  const picked = all.filter((b) => wanted.includes(b));
  return picked.includes('minimax') ? picked : [...picked, 'minimax'];
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

function start(): void {
  initStorage();
  engine = new NativeEngine(engineBinaryPath());
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: getSettings().theme === 'light' ? '#f4f5fb' : '#0e1018',
    title: 'Chess Arena',
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });
  mainWindow = win;
  allowClose = false;

  win.once('ready-to-show', () => {
    if (!smokeTest) win.show();
  });

  const emitState = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winStateChanged, windowState(win));
  };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(ev as 'maximize', emitState);
  }

  // Let the renderer auto-save and ask "Save & quit / Keep playing" first.
  win.on('close', (e) => {
    if (allowClose || smokeTest) return;
    const wc = win.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) return;
    e.preventDefault();
    wc.send(IPC.winCloseRequested);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  hardenWebContents(win);

  // F11 fullscreen works even when the renderer is busy.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
    if (!isDev && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
  });

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (smokeTest) void runSmokeTest(win);
}

function isAllowedExternal(url: string): boolean {
  return EXTERNAL_ALLOW.some((prefix) => url.startsWith(prefix));
}

function hardenWebContents(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const current = wc.getURL();
    const sameApp = isDev
      ? url.startsWith(process.env['ELECTRON_RENDERER_URL']!)
      : url.split('#')[0] === current.split('#')[0];
    if (!sameApp) {
      event.preventDefault();
      if (isAllowedExternal(url)) void shell.openExternal(url);
    }
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  if (!isDev) {
    wc.on('devtools-opened', () => wc.closeDevTools());
  }
}

/** Only accept IPC from our own window's main frame. */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return (
    !!mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted IPC sender');
      return fn(...(args as A));
    });
  };
  const on = (channel: string, fn: (win: BrowserWindow) => void) => {
    ipcMain.on(channel, (event) => {
      if (!trusted(event) || !mainWindow) return;
      fn(mainWindow);
    });
  };

  handle(IPC.appVersion, () => app.getVersion());
  handle(IPC.appStartupIssues, () => getStartupIssues());
  on(IPC.appQuit, (win) => win.close());

  on(IPC.winMinimize, (win) => win.minimize());
  on(IPC.winToggleMaximize, (win) => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  on(IPC.winToggleFullscreen, (win) => win.setFullScreen(!win.isFullScreen()));
  on(IPC.winClose, (win) => win.close());
  on(IPC.winConfirmClose, (win) => {
    allowClose = true;
    win.close();
  });
  handle(IPC.winGetState, () =>
    mainWindow ? windowState(mainWindow) : { maximized: false, fullscreen: false },
  );

  handle(IPC.settingsGet, () => getSettings());
  handle(IPC.settingsSet, (patch: unknown) => setSettings(patch));
  handle(IPC.savedGameGet, () => getSavedGame());
  handle(IPC.savedGameSet, (game: unknown) => setSavedGame(game));
  handle(IPC.savedGameClear, () => clearSavedGame());
  handle(IPC.profilesGet, () => getProfiles());
  handle(IPC.profilesSet, (doc: unknown) => setProfiles(doc));
  handle(IPC.historyGet, () => getHistory());
  handle(IPC.historyAdd, (record: unknown) => addGameRecord(record));

  handle(IPC.engineStart, async (): Promise<EngineStatus> => {
    const status: NativeEngineStatus = engine
      ? await engine.start()
      : { ok: false, error: 'Engine unavailable' };
    return {
      native: status.ok,
      name: status.name,
      error: status.error,
      fallbacks: engineFallbacks(),
    };
  });
  handle(IPC.engineBestMove, (req: unknown) => {
    if (!isSearchRequest(req)) throw new Error('Invalid engine request');
    if (!engine) throw new Error('Engine unavailable');
    return engine.search(req);
  });
  on(IPC.engineStop, () => engine?.stop());
}

app.on('window-all-closed', () => {
  app.quit();
});

// Never leave a Stockfish process behind.
app.on('will-quit', () => engine?.dispose());
process.on('exit', () => engine?.dispose());
