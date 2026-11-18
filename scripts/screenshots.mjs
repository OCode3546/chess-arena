// Renders the README screenshots by driving the real app (same mechanism as the smoke suite).
// Usage: `npm run build && node scripts/screenshots.mjs` (or SMOKE_APP=<packaged executable>).
// Writes 1600×1000 PNGs to docs/screenshots/. Needs the native engine (`npm run fetch:engine`).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

const OUT = resolve('docs/screenshots');
const RAW = mkdtempSync(join(tmpdir(), 'chess-arena-shots-'));
const APP = process.env.SMOKE_APP ? resolve(process.env.SMOKE_APP) : undefined;
mkdirSync(OUT, { recursive: true });

function launch(userData, steps) {
  const file = join(userData, 'steps.json');
  writeFileSync(file, JSON.stringify(steps));
  const env = {
    ...process.env,
    CHESS_ARENA_SMOKE: '1',
    CHESS_ARENA_SMOKE_SKIP_ROUTES: '1',
    CHESS_ARENA_SMOKE_STEPS: file,
    CHESS_ARENA_SMOKE_SHOTS: RAW,
    CHESS_ARENA_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const res = APP
    ? spawnSync(APP, [], { env, encoding: 'utf8', timeout: 180_000 })
    : spawnSync(electron, ['.'], { env, encoding: 'utf8', timeout: 180_000 });
  const line = `${res.stdout}`.split('\n').find((l) => l.startsWith('SMOKE '));
  if (!line) throw new Error(`No report:\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(line.slice(6));
}

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (t) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const waitFor = async (pred, ms) => {
    for (let t = 0; t < ms; t += 100) { if (pred()) return true; await sleep(100); }
    return false;
  };
  const status = () => document.querySelector('[role=application] [aria-live]')?.textContent ?? '';
  const click = (sq) => {
    const board = document.querySelector('[role=application]');
    const r = board.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + (sq.charCodeAt(0) - 96.5) * (r.width / 8),
      clientY: r.top + (8.5 - Number(sq[1])) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
`;

/** Launch 1: a level-30 profile with the given look. */
const seed = (name, settings, equipped) => `(async () => {
  ${HELPERS}
  const input = document.querySelector('[role=dialog] input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(name)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(100);
  byText('Create profile').click();
  await sleep(500);
  const doc = await window.chessArena.storage.getProfiles();
  const p = doc.profiles[0];
  await window.chessArena.storage.setProfiles({ ...doc, profiles: [{ ...p, xp: 34500 }] });
  const after = await window.chessArena.storage.getProfiles();
  const q = after.profiles[0];
  await window.chessArena.storage.setProfiles({ ...after,
    profiles: [{ ...q, equipped: { ...q.equipped, ...${JSON.stringify(equipped)} } }] });
  await window.chessArena.storage.setSettings(${JSON.stringify(settings)});
  return true;
})()`;

/** Launch 2: an Italian-style opening against the AI, then a piece picked up to show its moves. */
const AI_GAME = `(async () => {
  ${HELPERS}
  location.hash = '#/setup?mode=pvai';
  await sleep(700);
  byText('White').click();
  byText('Medium').click();
  byText('10 + 0').click();
  await sleep(100);
  byText('Start Game').click();
  await sleep(800);
  let replies = 0;
  for (const m of ['e2e4', 'g1f3', 'f1c4', 'd2d3', 'b1c3']) {
    const before = status();
    click(m.slice(0, 2)); await sleep(80); click(m.slice(2));
    const moved = await waitFor(() => status() !== before && status().startsWith('White played'), 1500);
    if (!moved) continue;
    if (await waitFor(() => status().startsWith('Black played'), 30000)) replies++;
    await sleep(600);
  }
  await sleep(400);
  click('c1');
  await sleep(500);
  return { replies };
})()`;

const scenarios = [
  {
    name: 'dark',
    seed: seed(
      'Alex',
      { theme: 'dark', accent: 'indigo' },
      { frame: 'gold', title: 'rook-commander' },
    ),
    shots: [
      { js: `location.hash = '#/'`, wait: 900, shot: 'home' },
      { js: AI_GAME, wait: 300, shot: 'game' },
      { js: `location.hash = '#/rewards'`, wait: 1200, shot: 'rewards' },
      { js: `location.hash = '#/profile'`, wait: 900, shot: 'profile' },
    ],
  },
  {
    name: 'light',
    seed: seed(
      'Sam',
      { theme: 'light', accent: 'emerald' },
      { board: 'emerald', pieceSet: 'classic', frame: 'gold' },
    ),
    shots: [{ js: AI_GAME, wait: 300, shot: 'game-light' }],
  },
];

try {
  for (const s of scenarios) {
    const userData = mkdtempSync(join(tmpdir(), `chess-arena-shots-${s.name}-`));
    try {
      launch(userData, [{ js: s.seed }]);
      const report = launch(userData, s.shots);
      console.log(`✔ ${s.name}`, JSON.stringify(report.steps));
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  }
  for (const shot of ['home', 'game', 'rewards', 'profile', 'game-light']) {
    const out = join(OUT, `${shot}.png`);
    const r = spawnSync('sips', ['-Z', '1600', join(RAW, `${shot}.png`), '--out', out], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`Resize failed for ${shot}: ${r.stderr}`);
    console.log(`  → ${out}`);
  }
} finally {
  rmSync(RAW, { recursive: true, force: true });
}
