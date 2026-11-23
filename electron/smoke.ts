import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { app, type BrowserWindow } from 'electron';

interface Step {
  /** Renderer-side JS (an expression or async IIFE); its value is reported. */
  js?: string;
  /** Capture the window to `<CHESS_ARENA_SMOKE_SHOTS>/<name>.png`. */
  shot?: string;
  wait?: number;
  /** Resize the window content to [width, height]. */
  size?: [number, number];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run renderer JS sent as JSON lines on stdin until `{"quit":true}` or stdin closes. */
async function serveCommands(wc: Electron.WebContents): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let cmd: { id?: unknown; js?: unknown; quit?: unknown };
    try {
      cmd = JSON.parse(line) as typeof cmd;
    } catch {
      continue;
    }
    if (cmd.quit) break;
    if (typeof cmd.js !== 'string') continue;
    let out: { id: unknown; value?: unknown; error?: string };
    try {
      out = { id: cmd.id, value: await wc.executeJavaScript(cmd.js) };
    } catch (err) {
      out = { id: cmd.id, error: String(err) };
    }
    process.stdout.write(`SMOKE-RESULT ${JSON.stringify(out)}\n`);
  }
  lines.close();
}

/**
 * `CHESS_ARENA_SMOKE=1` (dev/CI only): load the app hidden, probe the renderer's
 * isolation, optionally run scripted steps (`CHESS_ARENA_SMOKE_STEPS`, a JSON file)
 * and print the report on stdout as one `SMOKE {...}` line, then exit.
 */
export function runSmokeTest(win: BrowserWindow): void {
  const env = process.env;
  const done = (report: Record<string, unknown>, code: number) => {
    process.stdout.write(`SMOKE ${JSON.stringify(report)}\n`);
    app.exit(code);
  };
  const timer = setTimeout(() => done({ error: 'timeout' }, 1), 120_000);
  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1500);
      const wc = win.webContents;
      const report = (await wc.executeJavaScript(`(async () => {
        const api = window.chessArena;
        const action = ${JSON.stringify(env['CHESS_ARENA_SMOKE_ACTION'] ?? '')};
        if (action.startsWith('set-theme:')) await api.storage.setSettings({ theme: action.slice(10) });
        const settings = await api.storage.getSettings();
        return {
          require: typeof require,
          process: typeof process,
          module: typeof module,
          global: typeof global,
          bufferGlobal: typeof Buffer,
          apiKeys: Object.keys(api).sort(),
          serverUrl: api.online.serverUrl,
          appRendered: !!document.querySelector('[data-app-root]'),
          dataTheme: document.documentElement.dataset.theme,
          settingsTheme: settings.theme,
        };
      })()`)) as Record<string, unknown>;

      const routes: Record<string, boolean> = {};
      const routeList =
        env['CHESS_ARENA_SMOKE_SKIP_ROUTES'] === '1'
          ? []
          : [
              '#/',
              '#/setup',
              '#/game',
              '#/profile',
              '#/rewards',
              '#/history',
              '#/settings',
              '#/tutorial',
              '#/about',
            ];
      for (const route of routeList) {
        routes[route] = (await wc.executeJavaScript(`(async () => {
          location.hash = ${JSON.stringify(route)};
          await new Promise((r) => setTimeout(r, 400));
          return !!document.querySelector('[data-screen]');
        })()`)) as boolean;
      }
      report['routes'] = routes;
      await wc.executeJavaScript(`location.hash = '#/'`);
      await sleep(300);

      // Interactive: the test driver sends `{"id","js"}` lines on stdin and reads one
      // `SMOKE-RESULT {"id","value"|"error"}` line per command (used to run two apps at once).
      if (env['CHESS_ARENA_SMOKE_INTERACTIVE'] === '1') {
        clearTimeout(timer);
        process.stdout.write(`SMOKE-READY ${JSON.stringify(report)}\n`);
        await serveCommands(wc);
        app.exit(0);
        return;
      }

      const stepsFile = env['CHESS_ARENA_SMOKE_STEPS'];
      if (stepsFile) {
        const shotsDir =
          env['CHESS_ARENA_SMOKE_SHOTS'] ?? join(app.getPath('temp'), 'chess-arena-shots');
        mkdirSync(shotsDir, { recursive: true });
        const steps = JSON.parse(readFileSync(stepsFile, 'utf8')) as Step[];
        const results: unknown[] = [];
        for (const step of steps) {
          if (step.size) {
            win.setContentSize(step.size[0], step.size[1]);
            await sleep(400);
          }
          if (step.js) results.push(await wc.executeJavaScript(step.js));
          if (step.wait) await sleep(step.wait);
          if (step.shot) {
            const img = await wc.capturePage();
            writeFileSync(join(shotsDir, `${step.shot}.png`), img.toPNG());
          }
        }
        report['steps'] = results;
      }
      clearTimeout(timer);
      done(report, 0);
    } catch (err) {
      clearTimeout(timer);
      done({ error: String(err) }, 1);
    }
  });
}
