import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type BrowserWindowConstructorOptions,
  type FileFilter,
  type MenuItemConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { IPC } from '@shared/ipc';
import { isAllowedExternal } from '@shared/links';
import { exportPgn, pgnFileName } from '@shared/pgn';
import {
  LICENSE_IDS,
  type EngineStatus,
  type ImportResult,
  type LicenseId,
  type SaveFileResult,
  type Settings,
  type WindowState,
} from '@shared/types';
import { isSearchRequest } from '@shared/validate';
import { createBackup, readBackup } from './backup';
import { NativeEngine, type NativeEngineStatus } from './engine';
import {
  addGameRecord,
  clearSavedGame,
  getBackupData,
  getGameRecord,
  getHistory,
  getProfiles,
  getSavedGame,
  getSettings,
  getStartupIssues,
  initStorage,
  replaceAllData,
  resetProgress,
  setProfiles,
  setSavedGame,
  setSettings,
} from './storage';
import { runSmokeTest } from './smoke';
import { Updater } from './updater';

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];
const smokeTest = process.env['CHESS_ARENA_SMOKE'] === '1';
const isMac = process.platform === 'darwin';

const LICENSE_FILES: Record<LicenseId, string> = {
  stockfish: 'Stockfish-GPL-3.0.txt',
  'gpl-2': 'GPL-2.0.txt',
  'chess-js': 'chess.js-BSD-2-Clause.txt',
  inter: 'Inter-OFL-1.1.txt',
  'space-grotesk': 'SpaceGrotesk-OFL-1.1.txt',
};

/** Largest backup file accepted for import. */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

if (process.env['CHESS_ARENA_USER_DATA']) {
  app.setPath('userData', process.env['CHESS_ARENA_USER_DATA']);
}

let mainWindow: BrowserWindow | null = null;
let allowClose = false;
let engine: NativeEngine | null = null;
const updater = new Updater({
  autoUpdate: () => getSettings().autoUpdate,
  publish: (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updaterChanged, info);
    }
  },
  beforeInstall: () => {
    allowClose = true;
  },
});

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
  // Windows draws its own title bar buttons; macOS needs a real menu for Cmd+Q, copy/paste etc.
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate(macMenu()) : null);
  registerIpc();
  createWindow();
  void updater.init();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

/** Screens the main process may ask the renderer to show. */
function navigate(path: '/settings' | '/about'): void {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.webContents.send(IPC.appNavigate, path);
}

function macMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => navigate('/about') },
        {
          label: 'Check for Updates…',
          click: () => {
            navigate('/settings');
            updater.check();
          },
        },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => navigate('/settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
  ];
}

/** Native traffic lights on macOS; a frameless window with our own buttons elsewhere. */
function windowChrome(): BrowserWindowConstructorOptions {
  return isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
    : { frame: false };
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
    ...windowChrome(),
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

  // F11 fullscreen works even when the renderer is busy (macOS uses Ctrl+Cmd+F from the menu).
  win.webContents.on('before-input-event', (event, input) => {
    if (!isMac && input.type === 'keyDown' && input.key === 'F11') {
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

  on(IPC.appOpenDataFolder, () => void shell.openPath(app.getPath('userData')));
  handle(IPC.appLicense, (id: unknown) => {
    if (!(LICENSE_IDS as readonly unknown[]).includes(id)) throw new Error('Unknown license');
    return readFile(join(licensesDir(), LICENSE_FILES[id as LicenseId]), 'utf8');
  });

  handle(IPC.settingsGet, () => getSettings());
  handle(IPC.settingsSet, (patch: unknown) => {
    const next = setSettings(patch);
    applyLoginItem(next);
    return next;
  });
  handle(IPC.savedGameGet, () => getSavedGame());
  handle(IPC.savedGameSet, (game: unknown) => setSavedGame(game));
  handle(IPC.savedGameClear, () => clearSavedGame());
  handle(IPC.profilesGet, () => getProfiles());
  handle(IPC.profilesSet, (doc: unknown) => setProfiles(doc));
  handle(IPC.historyGet, () => getHistory());
  handle(IPC.historyAdd, (record: unknown) => addGameRecord(record));
  handle(IPC.resetProgress, () => resetProgress());

  handle(IPC.dialogExportPgn, async (id: unknown): Promise<SaveFileResult> => {
    if (typeof id !== 'string') throw new Error('Invalid game id');
    const record = getGameRecord(id);
    if (!record) return { status: 'error', message: 'That game is no longer in your history.' };
    const pgn = exportPgn(record);
    if (!pgn) return { status: 'error', message: 'The moves of this game could not be read.' };
    const file = await askSavePath('Export game as PGN', pgnFileName(record), [
      { name: 'PGN game', extensions: ['pgn'] },
    ]);
    return file ? writeText(file, pgn) : { status: 'canceled' };
  });

  handle(IPC.dialogExportData, async (): Promise<SaveFileResult> => {
    const backup = createBackup(getBackupData(), app.getVersion());
    const file = await askSavePath(
      'Export Chess Arena data',
      `Chess Arena backup ${backup.exportedAt.slice(0, 10)}.json`,
      [{ name: 'Chess Arena backup', extensions: ['json'] }],
    );
    return file ? writeText(file, `${JSON.stringify(backup, null, 2)}\n`) : { status: 'canceled' };
  });

  handle(IPC.dialogImportData, async (): Promise<ImportResult> => {
    const file = await askOpenPath('Import Chess Arena data', [
      { name: 'Chess Arena backup', extensions: ['json'] },
    ]);
    if (!file) return { status: 'canceled' };
    let json: unknown;
    try {
      if ((await stat(file)).size > MAX_IMPORT_BYTES) {
        return { status: 'error', message: 'That file is too large to be a Chess Arena backup.' };
      }
      json = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return { status: 'error', message: 'That file could not be read as a Chess Arena backup.' };
    }
    const backup = readBackup(json);
    if (!backup.ok) {
      return {
        status: 'error',
        message:
          backup.error === 'newer'
            ? 'This backup comes from a newer version of Chess Arena. Update the app and try again.'
            : 'That file is not a Chess Arena backup.',
      };
    }
    replaceAllData(backup.data);
    applyLoginItem(getSettings());
    return {
      status: 'imported',
      profiles: backup.data.profiles.profiles.length,
      games: backup.data.history.length,
    };
  });

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

  handle(IPC.updaterGetInfo, () => updater.info);
  on(IPC.updaterCheck, () => updater.check());
  on(IPC.updaterDownload, () => updater.download());
  on(IPC.updaterInstall, () => updater.install());
}

function licensesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'LICENSES')
    : join(app.getAppPath(), 'LICENSES');
}

/**
 * Smoke tests cannot click native dialogs: in smoke mode the Save dialog answers with a
 * file in `CHESS_ARENA_SMOKE_SAVE_DIR` and the Open dialog with `CHESS_ARENA_SMOKE_OPEN_FILE`.
 */
async function askSavePath(
  title: string,
  defaultName: string,
  filters: FileFilter[],
): Promise<string | null> {
  const smokeDir = smokeTest ? process.env['CHESS_ARENA_SMOKE_SAVE_DIR'] : undefined;
  if (smokeDir) return join(smokeDir, defaultName);
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title,
    defaultPath: join(app.getPath('documents'), defaultName),
    filters,
  });
  return res.canceled || !res.filePath ? null : res.filePath;
}

async function askOpenPath(title: string, filters: FileFilter[]): Promise<string | null> {
  if (smokeTest && process.env['CHESS_ARENA_SMOKE_OPEN_FILE'] !== undefined) {
    return process.env['CHESS_ARENA_SMOKE_OPEN_FILE'] || null;
  }
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath: app.getPath('documents'),
    filters,
    properties: ['openFile'],
  });
  return res.canceled ? null : (res.filePaths[0] ?? null);
}

async function writeText(file: string, text: string): Promise<SaveFileResult> {
  try {
    await writeFile(file, text, 'utf8');
    return { status: 'saved', fileName: basename(file) };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: 'The file could not be saved there. Try another folder.' };
  }
}

/**
 * Launch at startup. Only the installed app registers itself: a development build
 * would register the bare Electron binary. The portable exe registers its own path.
 */
function applyLoginItem(settings: Settings): void {
  if (!app.isPackaged || smokeTest) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const portable = process.env['PORTABLE_EXECUTABLE_FILE'];
  const opts = portable ? { path: portable } : {};
  if (app.getLoginItemSettings(opts).openAtLogin === settings.launchAtStartup) return;
  app.setLoginItemSettings({ ...opts, openAtLogin: settings.launchAtStartup });
}

app.on('window-all-closed', () => {
  app.quit();
});

// Never leave a Stockfish process behind.
app.on('will-quit', () => {
  updater.dispose();
  engine?.dispose();
});
process.on('exit', () => engine?.dispose());
