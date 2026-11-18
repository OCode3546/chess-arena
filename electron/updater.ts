import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import { PROJECT_LINKS, REPO } from '@shared/links';
import type { UpdateMode, UpdaterInfo, UpdateState } from '@shared/types';

const { autoUpdater } = electronUpdater;

/** First background check after launch, then every few hours while the app stays open. */
const STARTUP_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdaterDeps {
  /** The "Update automatically" setting, read fresh each time. */
  autoUpdate(): boolean;
  /** Push the new state to the renderer. */
  publish(info: UpdaterInfo): void;
  /** Called right before quitting to install, so the window may close without asking. */
  beforeInstall(): void;
}

/**
 * True when the running .app carries a Developer ID signature. macOS only installs
 * updates into signed apps, so unsigned builds fall back to "download it yourself".
 */
function isDeveloperIdSigned(): Promise<boolean> {
  // …/Chess Arena.app/Contents/MacOS/Chess Arena → …/Chess Arena.app
  const bundle = dirname(dirname(dirname(process.execPath)));
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (err, _out, stderr) => {
      resolve(!err && /Authority=Developer ID Application/.test(stderr));
    });
  });
}

export async function detectUpdateMode(): Promise<UpdateMode> {
  if (!app.isPackaged || process.env['CHESS_ARENA_SMOKE'] === '1') return 'none';
  // The portable exe has no installer to update itself with.
  if (process.env['PORTABLE_EXECUTABLE_FILE']) return 'manual';
  if (process.platform === 'darwin') return (await isDeveloperIdSigned()) ? 'auto' : 'manual';
  if (process.platform === 'linux' && !process.env['APPIMAGE']) return 'manual';
  return 'auto';
}

/** Short, friendly text for update errors; details go to the console. */
function describeError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|net::/i.test(text)) {
    return 'Could not reach the update server. Check your internet connection.';
  }
  if (/404|No published versions|Cannot find latest/i.test(text)) {
    return 'No published release was found yet.';
  }
  return 'Checking for updates failed. Try again later.';
}

/** Wraps electron-updater: GitHub Releases feed, background checks, manual fallback. */
export class Updater {
  private mode: UpdateMode = 'none';
  private state: UpdateState = { status: 'idle' };
  private userCheck = false;
  private timer: NodeJS.Timeout | null = null;
  private lastError: unknown = null;

  constructor(private readonly deps: UpdaterDeps) {}

  get info(): UpdaterInfo {
    return { mode: this.mode, state: this.state, releasesUrl: PROJECT_LINKS.releases };
  }

  async init(): Promise<void> {
    this.mode = await detectUpdateMode();
    if (this.mode === 'none') return;

    autoUpdater.setFeedURL({ provider: 'github', owner: REPO.owner, repo: REPO.name });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = this.mode === 'auto';
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'up-to-date', checkedAt: Date.now() }),
    );
    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'available', version: info.version });
      if (this.mode === 'auto' && this.deps.autoUpdate()) this.download();
    });
    autoUpdater.on('download-progress', (p) => {
      const version = 'version' in this.state ? this.state.version : '';
      this.set({ status: 'downloading', version, percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'downloaded', version: info.version }),
    );
    autoUpdater.on('error', (err) => this.fail(err));

    this.publish();
    const background = () => {
      if (this.deps.autoUpdate()) this.check(false);
    };
    setTimeout(background, STARTUP_DELAY_MS);
    this.timer = setInterval(background, CHECK_INTERVAL_MS);
  }

  /** `user` checks report errors; background checks fail silently. */
  check(user = true): void {
    if (this.mode === 'none') return;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return;
    if (this.state.status === 'checking') return;
    this.userCheck = user;
    autoUpdater.checkForUpdates().catch((err) => this.fail(err));
  }

  download(): void {
    if (this.mode !== 'auto' || this.state.status !== 'available') return;
    const { version } = this.state;
    this.set({ status: 'downloading', version, percent: 0 });
    autoUpdater.downloadUpdate().catch((err) => this.fail(err));
  }

  install(): void {
    if (this.mode !== 'auto' || this.state.status !== 'downloaded') return;
    this.deps.beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall());
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private fail(err: unknown): void {
    // electron-updater both emits 'error' and rejects the promise for the same failure.
    if (err === this.lastError) return;
    this.lastError = err;
    console.error('[updater]', err);
    // A failed download leaves the update available to retry; a failed background check is quiet.
    if (this.state.status === 'downloading') {
      this.set({ status: 'available', version: this.state.version });
      return;
    }
    this.set(
      this.userCheck ? { status: 'error', message: describeError(err) } : { status: 'idle' },
    );
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.publish();
  }

  private publish(): void {
    this.deps.publish(this.info);
  }
}
