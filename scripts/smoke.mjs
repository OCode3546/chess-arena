// Launches the built app hidden and checks renderer isolation, routing, that the
// theme setting survives a relaunch, and that the AI opponent plays on every engine
// backend (native, WASM, minimax) without leaving engine processes behind.
// Run via `npm run verify:sandbox`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';

const dirs = [];
const tempDir = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const userData = tempDir('chess-arena-smoke-');

function run(action, extraEnv = {}) {
  const env = {
    ...process.env,
    CHESS_ARENA_SMOKE: '1',
    CHESS_ARENA_USER_DATA: userData,
    CHESS_ARENA_SMOKE_ACTION: action,
    ...extraEnv,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const res = spawnSync(electron, ['.'], { env, encoding: 'utf8', timeout: 120_000 });
  const line = `${res.stdout}`.split('\n').find((l) => l.startsWith('SMOKE '));
  if (!line) {
    console.error(res.stdout, res.stderr);
    throw new Error('No smoke report');
  }
  return JSON.parse(line.slice(6));
}

// Renderer script: start a vs-AI game as Black, wait for the AI's opening move,
// answer e7-e5 by clicking the board, and wait for the AI's reply.
const AI_GAME = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (t) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const status = () => document.querySelector('[role=application] [aria-live]')?.textContent ?? '';
  const waitFor = async (pred, ms) => {
    for (let t = 0; t < ms; t += 100) { if (pred()) return true; await sleep(100); }
    return false;
  };
  location.hash = '#/setup?mode=pvai';
  await sleep(600);
  byText('Black').click();
  byText('Easy').click();
  byText('Untimed').click();
  await sleep(100);
  const t0 = performance.now();
  byText('Start Game').click();
  const first = await waitFor(() => status().startsWith('White played'), 30000);
  const firstMs = Math.round(performance.now() - t0);
  const board = document.querySelector('[role=application]');
  const click = (sq) => {
    const r = board.getBoundingClientRect();
    const col = 7 - (sq.charCodeAt(0) - 97);
    const row = Number(sq[1]) - 1;
    const x = r.left + (col + 0.5) * (r.width / 8);
    const y = r.top + (row + 0.5) * (r.height / 8);
    const o = { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  click('e7');
  await sleep(150);
  click('e5');
  const humanMoved = await waitFor(() => status().startsWith('Black played'), 3000);
  const reply = await waitFor(() => status().startsWith('White played'), 30000);
  const strips = document.body.textContent.includes('Computer');
  return { first, firstMs, humanMoved, reply, strips, engine: document.documentElement.dataset.engine };
})()`;

function aiRun(extraEnv) {
  const steps = join(tempDir('chess-arena-steps-'), 'steps.json');
  writeFileSync(steps, JSON.stringify([{ js: AI_GAME }]));
  return run('', {
    CHESS_ARENA_USER_DATA: tempDir('chess-arena-ai-'),
    CHESS_ARENA_SMOKE_SKIP_ROUTES: '1',
    CHESS_ARENA_SMOKE_STEPS: steps,
    ...extraEnv,
  }).steps?.[0];
}

function engineProcesses() {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq stockfish*'], { encoding: 'utf8' });
    return (r.stdout.match(/stockfish/gi) ?? []).length;
  }
  const r = spawnSync('pgrep', ['-f', 'resources/engine/stockfish'], { encoding: 'utf8' });
  return r.stdout.trim() ? r.stdout.trim().split('\n').length : 0;
}

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures.push(name);
};

const checkAiGame = (label, r, backend) => {
  check(`${label}: AI opens as White`, r?.first === true, r && { ms: r.firstMs });
  check(`${label}: human move accepted`, r?.humanMoved === true);
  check(`${label}: AI replies`, r?.reply === true);
  check(`${label}: running on ${backend}`, r?.engine === backend, r?.engine);
};

try {
  const first = run('set-theme:light');
  check('app rendered', first.appRendered === true);
  check('no require in renderer', first.require === 'undefined');
  check('no process in renderer', first.process === 'undefined');
  check('no module in renderer', first.module === 'undefined');
  check('no Buffer in renderer', first.bufferGlobal === 'undefined');
  check(
    'only the typed API is exposed',
    JSON.stringify(first.apiKeys) === '["app","engine","storage","window"]',
  );
  for (const [route, ok] of Object.entries(first.routes))
    check(`route ${route} renders`, ok === true);

  const second = run('');
  check('theme persisted across relaunch (settings)', second.settingsTheme === 'light');
  check('theme applied after relaunch (DOM)', second.dataTheme === 'light');

  const before = engineProcesses();
  const hasNative = existsSync(join('resources', 'engine'));
  if (hasNative) checkAiGame('native', aiRun({}), 'native');
  checkAiGame('engine file missing', aiRun({ CHESS_ARENA_ENGINE_PATH: '' }), 'wasm');
  checkAiGame(
    'engine + WASM unavailable',
    aiRun({ CHESS_ARENA_ENGINE_PATH: '', CHESS_ARENA_ENGINE_FALLBACKS: 'minimax' }),
    'minimax',
  );
  check('no engine process left after exit', engineProcesses() === before, {
    before,
    after: engineProcesses(),
  });
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
