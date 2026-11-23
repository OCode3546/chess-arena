// Launches the built app hidden and checks renderer isolation, routing, that the
// theme setting survives a relaunch, that the AI opponent plays on every engine
// backend (native, WASM, minimax) without leaving engine processes behind, and the
// profile → game → XP → level-up flow across relaunches, that rewards render for all
// 50 levels and equipped cosmetics apply instantly and survive a relaunch, and the
// history / review / PGN export, settings, sound, backup export → reset → import,
// How to Play and About flows, resigning against the AI and resuming an unfinished game
// after a relaunch. Online play (when the build points at a local game server): two app
// instances play a private game by invite code, pair through quick match, and one is killed
// and relaunched mid-game and rejoins.
// Run via `npm run verify:sandbox` (builds with a local game server URL; `SMOKE_KEEP_PGN=<file>`
// keeps the exported PGN), or against a packaged build with
// `SMOKE_APP=<path to the app executable> node scripts/smoke.mjs` (online checks are skipped
// when the build points at the production server). `SMOKE_ONLY=online` runs just those.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import electron from 'electron';

/** Game server the `--build` build talks to (the smoke run starts it). */
const LOCAL_SERVER_URL = 'ws://127.0.0.1:18765/ws';

if (process.argv.includes('--build')) {
  const env = { ...process.env };
  env.CHESS_ARENA_SERVER_URL ||= LOCAL_SERVER_URL;
  const r = spawnSync('npx', ['electron-vite', 'build'], {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const dirs = [];
const tempDir = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const userData = tempDir('chess-arena-smoke-');
const SMOKE_APP = process.env.SMOKE_APP ? resolve(process.env.SMOKE_APP) : undefined;
if (SMOKE_APP && !existsSync(SMOKE_APP)) throw new Error(`SMOKE_APP not found: ${SMOKE_APP}`);

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
  // SMOKE_APP=<packaged executable> runs the checks against an installed/packaged build.
  const res = SMOKE_APP
    ? spawnSync(SMOKE_APP, [], { env, encoding: 'utf8', timeout: 120_000 })
    : spawnSync(electron, ['.'], { env, encoding: 'utf8', timeout: 120_000 });
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
  const click = (sq) => {
    const board = document.querySelector('[role=application]');
    const r = board.getBoundingClientRect();
    const col = 7 - (sq.charCodeAt(0) - 97);
    const row = Number(sq[1]) - 1;
    const x = r.left + (col + 0.5) * (r.width / 8);
    const y = r.top + (row + 0.5) * (r.height / 8);
    const o = { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  // The board's data-ply (the move list is behind a tab in narrow windows, e.g. on CI).
  const moveCount = () =>
    Number(document.querySelector('[data-screen=game] [role=application]')?.dataset.ply ?? 0);
  // The board takes clicks only once React has re-rendered it as movable (slow CI machines
  // need longer), so retry until the move actually lands.
  const tryMove = async (from, to) => {
    const before = moveCount();
    for (let i = 0; i < 12; i++) {
      click(from); await sleep(120); click(to);
      if (await waitFor(() => moveCount() > before, 500)) return true;
    }
    return false;
  };
  const humanMoved = await tryMove('e7', 'e5');
  const reply = humanMoved && (await waitFor(() => moveCount() >= 3, 30000));
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

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (t) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const waitFor = async (pred, ms) => {
    for (let t = 0; t < ms; t += 100) { if (pred()) return true; await sleep(100); }
    return false;
  };
`;

// Launch 1: create a profile through the first-run dialog, then seed it with 80 XP.
const PROFILE_CREATE = `(async () => {
  ${HELPERS}
  const dialog = document.querySelector('[role=dialog]');
  const firstRun = !!dialog && dialog.textContent.includes('Welcome to Chess Arena');
  const input = dialog?.querySelector('input');
  if (input) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Smokey');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await sleep(100);
  byText('Create profile')?.click();
  await sleep(500);
  const doc = await window.chessArena.storage.getProfiles();
  const p = doc.profiles[0];
  await window.chessArena.storage.setProfiles({ ...doc, profiles: [{ ...p, xp: 80 }] });
  return { firstRun, created: doc.profiles.length === 1 && p.name === 'Smokey' };
})()`;

// Launch 2: Smokey (White) beats a guest after 10+ moves and levels up to 2.
const PROFILE_GAME = `(async () => {
  ${HELPERS}
  const noFirstRun = !document.body.textContent.includes('Welcome to Chess Arena');
  const homeShowsProfile = document.body.textContent.includes('Smokey');
  location.hash = '#/setup?mode=pvp';
  await sleep(600);
  const preview = document.querySelector('[data-xp-preview]')?.textContent ?? '';
  byText('Untimed').click();
  await sleep(100);
  byText('Start Game').click();
  await sleep(600);
  const board = document.querySelector('[role=application]');
  const click = (sq) => {
    const r = board.getBoundingClientRect();
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - Number(sq[1]);
    const o = { bubbles: true, clientX: r.left + (col + 0.5) * (r.width / 8),
      clientY: r.top + (row + 0.5) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const line = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 h2h3 h7h6 a2a4 a7a5 f1e1 f8e8 b1d2 c8e6 d2f1';
  for (const m of line.split(' ')) {
    click(m.slice(0, 2)); await sleep(60);
    click(m.slice(2)); await sleep(260);
  }
  byText('⚑ Resign').click();
  await sleep(300);
  byText('Resign as Black').click();
  const awarded = await waitFor(() => !!document.querySelector('[data-xp-award]'), 3000);
  const levelUp = await waitFor(() => !!document.querySelector('[data-level-up]'), 4000);
  const awardText = () => document.querySelector('[data-xp-award]')?.textContent ?? '';
  await waitFor(() => awardText().includes('+60 XP'), 4000);
  const award = awardText();
  return { noFirstRun, homeShowsProfile, preview, awarded, levelUp, award };
})()`;

// Launch 3: XP, level, stats and history survived the relaunch.
const PROFILE_CHECK = `(async () => {
  ${HELPERS}
  const doc = await window.chessArena.storage.getProfiles();
  const history = await window.chessArena.storage.getHistory();
  location.hash = '#/profile';
  await sleep(600);
  return {
    profile: doc.profiles[0] && { xp: doc.profiles[0].xp, level: doc.profiles[0].level,
      wins: doc.profiles[0].stats.wins },
    history: history.map((g) => ({ result: g.result, moves: g.moves, xp: Object.values(g.xpAwarded) })),
    profileScreen: document.querySelector('[data-profile-name]')?.textContent,
  };
})()`;

// Rewards, launch 1: a level-30 profile.
const REWARDS_SEED = `(async () => {
  ${HELPERS}
  const input = document.querySelector('[role=dialog] input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Rex');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(100);
  byText('Create profile').click();
  await sleep(500);
  const doc = await window.chessArena.storage.getProfiles();
  await window.chessArena.storage.setProfiles({ ...doc, profiles: [{ ...doc.profiles[0], xp: 33000 }] });
  return true;
})()`;

// Launch 2: the roadmap, then equip a few rewards from it.
const REWARDS_EQUIP = `(async () => {
  ${HELPERS}
  location.hash = '#/rewards';
  await sleep(800);
  const card = (key) => document.querySelector('[data-reward="' + key + '"]');
  const equip = (key) => card(key)?.querySelector('button')?.click();
  const levels = document.querySelectorAll('[data-level]').length;
  const reached = document.querySelectorAll('[data-reached]').length;
  const marbleLocked = !!card('board:marble')?.hasAttribute('data-locked') && !card('board:marble').querySelector('button');
  for (const key of ['board:neon', 'pieceSet:classic', 'frame:gold', 'title:rook-commander', 'effect:move-trail']) {
    equip(key);
    await sleep(80);
  }
  await sleep(300);
  const equipped = [...document.querySelectorAll('[data-reward] button[aria-pressed=true], [data-reward] button:disabled')]
    .map((b) => b.closest('[data-reward]').dataset.reward).sort();
  return { levels, reached, marbleLocked, equipped };
})()`;

// …and they show up in a game at once (board, pieces, frame, title, move trail).
const REWARDS_GAME = `(async () => {
  ${HELPERS}
  location.hash = '#/setup?mode=pvp';
  await sleep(600);
  byText('Untimed').click();
  await sleep(100);
  byText('Start Game').click();
  await sleep(700);
  const board = document.querySelector('[role=application]');
  const r = board.getBoundingClientRect();
  const click = (sq) => {
    const o = { bubbles: true, clientX: r.left + (sq.charCodeAt(0) - 96.5) * (r.width / 8),
      clientY: r.top + (8.5 - Number(sq[1])) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  click('e2'); await sleep(80); click('e4');
  const trail = await waitFor(() => !!document.querySelector('[data-effect=move-trail]'), 1000);
  return {
    board: board.dataset.board,
    pieceSet: board.dataset.pieceSet,
    frame: !!document.querySelector('[data-frame=gold]'),
    title: document.querySelector('[data-title]')?.textContent,
    trail,
  };
})()`;

// Launch 3: still equipped after a relaunch.
const REWARDS_CHECK = `(async () => {
  ${HELPERS}
  const doc = await window.chessArena.storage.getProfiles();
  location.hash = '#/settings';
  await sleep(600);
  const checked = [...document.querySelectorAll('[role=radio][aria-checked=true]')].map((b) => b.getAttribute('aria-label'));
  location.hash = '#/rewards';
  await sleep(600);
  const rewardsEquipped = !!document.querySelector('[data-reward="board:neon"] button:disabled');
  return { level: doc.profiles[0].level, equipped: doc.profiles[0].equipped, checked, rewardsEquipped };
})()`;

// Phase 7, launch 1: a profile with 3000 XP.
const P7_SEED = `(async () => {
  ${HELPERS}
  const input = document.querySelector('[role=dialog] input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Hana');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(100);
  byText('Create profile').click();
  await sleep(500);
  const doc = await window.chessArena.storage.getProfiles();
  await window.chessArena.storage.setProfiles({ ...doc, profiles: [{ ...doc.profiles[0], xp: 3000 }] });
  return true;
})()`;

// Launch 2: fool's mate in a local game (with sounds), then History, PGN export and review.
const P7_HISTORY = `(async () => {
  ${HELPERS}
  const sound = () => document.documentElement.dataset.sound;
  location.hash = '#/setup?mode=pvp';
  await sleep(600);
  byText('Untimed').click();
  await sleep(100);
  byText('Start Game').click();
  await sleep(600);
  const board = document.querySelector('[role=application]');
  const click = (sq) => {
    const r = board.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + (sq.charCodeAt(0) - 96.5) * (r.width / 8),
      clientY: r.top + (8.5 - Number(sq[1])) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const sounds = [];
  for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    click(m.slice(0, 2)); await sleep(60);
    click(m.slice(2)); await sleep(300);
    sounds.push(sound());
  }
  location.hash = '#/history';
  await waitFor(() => !!document.querySelector('[data-game]'), 3000);
  const rows = document.querySelectorAll('[data-game]');
  const rowText = rows[0]?.textContent ?? '';
  byText('PGN ↓').click();
  const pgnToast = await waitFor(() => document.body.textContent.includes('saved as'), 3000);
  byText('Review').click();
  await waitFor(() => !!document.querySelector('[data-screen=review] [role=application]'), 3000);
  await sleep(300);
  const status = () => document.querySelector('[role=application] [aria-live]')?.textContent ?? '';
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const final = status();
  key('Home'); await sleep(250);
  const start = status();
  key('ArrowRight'); await sleep(250);
  const first = status();
  const stepSound = sound();
  const moveButtons = document.querySelectorAll('[data-screen=review] ol[aria-label=Moves] button').length;
  return { sounds, rows: rows.length, rowText, pgnToast, final, start, first, stepSound, moveButtons,
    review: location.hash };
})()`;

// …then change settings, export a backup and reset all progress.
const P7_SETTINGS = `(async () => {
  ${HELPERS}
  const sw = (label) => [...document.querySelectorAll('[role=switch]')]
    .find((b) => b.closest('div').textContent.includes(label));
  location.hash = '#/settings';
  await sleep(600);
  const slider = document.querySelector('input[type=range]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '40');
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowLeft' }));
  await sleep(200);
  const previewSound = document.documentElement.dataset.sound;
  document.documentElement.dataset.sound = 'none';
  sw('Sound effects').click();
  sw('Board coordinates').click();
  sw('Launch at startup').click();
  await sleep(300);
  const settings = await window.chessArena.storage.getSettings();
  byText('Export…').click();
  const exported = await waitFor(() => document.body.textContent.includes('Backup saved as'), 3000);
  byText('Reset…').click();
  await sleep(300);
  byText('Reset progress').click();
  const resetToast = await waitFor(() => document.body.textContent.includes('Progress reset'), 3000);
  const profiles = await window.chessArena.storage.getProfiles();
  const history = await window.chessArena.storage.getHistory();
  location.hash = '#/history';
  await sleep(500);
  const emptyHistory = document.body.textContent.includes('No finished games yet');
  return { previewSound, settings, exported, resetToast, xp: profiles.profiles[0]?.xp,
    name: profiles.profiles[0]?.name, games: history.length, emptyHistory };
})()`;

// Launch 3: settings survived; importing the backup restores XP and history; sound stays off.
const P7_IMPORT = `(async () => {
  ${HELPERS}
  const before = await window.chessArena.storage.getSettings();
  const xpBefore = (await window.chessArena.storage.getProfiles()).profiles[0]?.xp;
  location.hash = '#/settings';
  await sleep(600);
  byText('Import…').click();
  await sleep(300);
  byText('Choose file…').click();
  const imported = await waitFor(() => document.body.textContent.includes('Imported 1 profile and 1 game'), 3000);
  const profiles = await window.chessArena.storage.getProfiles();
  const history = await window.chessArena.storage.getHistory();
  location.hash = '#/history';
  await waitFor(() => !!document.querySelector('[data-game]'), 3000);
  const rows = document.querySelectorAll('[data-game]').length;
  document.documentElement.dataset.sound = 'none';
  byText('Review').click();
  await sleep(600);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await sleep(200);
  const mutedSound = document.documentElement.dataset.sound;
  location.hash = '#/';
  await sleep(500);
  const homeLevel = document.querySelector('[data-app-root]').textContent.includes('Hana');
  return { before, xpBefore, imported, xp: profiles.profiles[0]?.xp, games: history.length, rows,
    mutedSound, homeLevel };
})()`;

// …and How to Play and About render their content.
const P7_PAGES = `(async () => {
  ${HELPERS}
  location.hash = '#/tutorial';
  await sleep(500);
  const tabs = [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent);
  byText('Pieces').click();
  await sleep(300);
  const pieceDiagrams = document.querySelectorAll('[data-tutorial-section=pieces] [role=img]').length;
  byText('XP & levels').click();
  await sleep(300);
  const xpTable = document.querySelector('[data-tutorial-section=xp]')?.textContent.includes('Grandmaster');
  location.hash = '#/about';
  await sleep(500);
  const version = document.querySelector('[data-version]')?.textContent;
  const changelog = !!document.querySelector('[data-changelog]')?.textContent.includes('PGN export');
  byText('View GPL-3.0 license').click();
  const license = await waitFor(() =>
    (document.querySelector('[data-license-text]')?.textContent ?? '').includes('GNU GENERAL PUBLIC LICENSE'), 3000);
  return { tabs, pieceDiagrams, xpTable, version, changelog, license };
})()`;

// Phase 8 helpers: make a profile through the first-run dialog; click squares (White at the bottom).
const P8_HELPERS = `
  ${HELPERS}
  const createProfile = async (name) => {
    // The first-run dialog appears after the splash screen, which can take a while.
    await waitFor(() => !!document.querySelector('[role=dialog] input'), 8000);
    const input = document.querySelector('[role=dialog] input');
    if (!input) return false;
    await sleep(200);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    byText('Create profile').click();
    await sleep(500);
    return true;
  };
  const click = (sq) => {
    const board = document.querySelector('[role=application]');
    const r = board.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + (sq.charCodeAt(0) - 96.5) * (r.width / 8),
      clientY: r.top + (8.5 - Number(sq[1])) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    board.dispatchEvent(new PointerEvent('pointerdown', o));
    board.dispatchEvent(new PointerEvent('pointerup', o));
  };
  // The board's data-ply (the move list is behind a tab in narrow windows, e.g. on CI).
  const moveCount = () =>
    Number(document.querySelector('[data-screen=game] [role=application]')?.dataset.ply ?? 0);
  // The board takes clicks only once React has re-rendered it as movable, so retry each
  // move until the move list grows (slow CI machines need several tries).
  const play = async (moves) => {
    for (const m of moves) {
      const before = moveCount();
      let landed = false;
      for (let i = 0; i < 12 && !landed; i++) {
        click(m.slice(0, 2)); await sleep(120); click(m.slice(2));
        landed = await waitFor(() => moveCount() > before, 500);
      }
      if (!landed) return false;
      await sleep(250);
    }
    return true;
  };
  const status = () => document.querySelector('[role=application] [aria-live]')?.textContent ?? '';
  /** Open a screen and wait until a button starting with \`text\` is there. */
  const open = async (hash, text) => {
    location.hash = hash;
    return waitFor(() => !!byText(text), 8000);
  };
  const startGame = async () => {
    byText('Start Game').click();
    return waitFor(() => !!document.querySelector('[data-screen=game] [role=application]'), 8000);
  };
`;

// Phase 8: resign against the AI; the loss is recorded. Also: dev/smoke builds don't self-update.
const P8_AI_RESIGN = `(async () => {
  ${P8_HELPERS}
  await createProfile('Rex');
  const updater = await window.chessArena.updater.getInfo();
  await open('#/setup?mode=pvai', 'Start Game');
  byText('White').click();
  byText('Easy').click();
  byText('Untimed').click();
  await sleep(100);
  await startGame();
  const replied = (await play(['e2e4'])) && (await waitFor(() => moveCount() >= 2, 30000));
  byText('⚑ Resign').click();
  await sleep(300);
  byText('Resign as White').click();
  const over = await waitFor(() => document.body.textContent.includes('wins by resignation'), 3000);
  const defeat = document.body.textContent.includes('Defeat');
  await sleep(500);
  const history = await window.chessArena.storage.getHistory();
  const h = history[0];
  return { updaterMode: updater.mode, replied, over, defeat,
    record: h && { mode: h.mode, result: h.result, reason: h.reason } };
})()`;

// Phase 8, launch 1: a timed local game left unfinished after three moves.
const P8_RESUME_START = `(async () => {
  ${P8_HELPERS}
  await createProfile('Remy');
  await open('#/setup?mode=pvp', 'Start Game');
  byText('5 + 3').click();
  await sleep(100);
  await startGame();
  await play(['e2e4', 'e7e5', 'g1f3']);
  const saved = await window.chessArena.storage.getSavedGame();
  return { fen: saved.ok ? saved.data?.fen : null };
})()`;

// Launch 2: Home offers Continue Game, which restores the position and both clocks.
const P8_RESUME_CHECK = `(async () => {
  ${P8_HELPERS}
  const formatClock = (ms) => {
    const t = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };
  // Home appears after the splash screen, which waits for the engine on slow machines.
  const offered = await waitFor(() => !!byText('Continue Game'), 8000);
  const saved = await window.chessArena.storage.getSavedGame();
  const data = saved.ok ? saved.data : null;
  byText('Continue Game')?.click();
  const opened = await waitFor(() => !!document.querySelector('[data-screen=game] [role=application]'), 8000);
  await sleep(500);
  const clock = (c) => document.querySelector('[aria-label="' + c + ' clock"]')?.textContent ?? '';
  const moves = moveCount();
  return { offered, opened, moves, fen: data?.fen,
    clocks: { w: clock('White'), b: clock('Black') },
    expected: data && { w: formatClock(data.clocks.w), b: formatClock(data.clocks.b) },
    clockStarted: data?.clockStarted };
})()`;

function stepsRun(userData, steps, extraEnv = {}) {
  const file = join(tempDir('chess-arena-steps-'), 'steps.json');
  writeFileSync(file, JSON.stringify(steps));
  return run('', {
    CHESS_ARENA_USER_DATA: userData,
    CHESS_ARENA_SMOKE_SKIP_ROUTES: '1',
    CHESS_ARENA_SMOKE_STEPS: file,
    ...extraEnv,
  }).steps;
}

function engineProcesses() {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq stockfish*'], { encoding: 'utf8' });
    return (r.stdout.match(/stockfish/gi) ?? []).length;
  }
  // Matches both the dev path (resources/engine/) and the packaged one (Resources/engine/).
  const r = spawnSync('pgrep', ['-f', 'engine/stockfish'], { encoding: 'utf8' });
  return r.stdout.trim() ? r.stdout.trim().split('\n').length : 0;
}

// ---------------------------------------------------------------------------
// Online play: two app instances driven at the same time against a local game server.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The port of a game server on this machine, or null for a remote (production) server. */
function localServerPort(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
      return null;
    }
    return Number(u.port || 80);
  } catch {
    return null;
  }
}

/** Build and start the real game server; resolves once /health answers. */
async function startGameServer(port) {
  const built = spawnSync(process.execPath, [join('server', 'build.mjs')], { stdio: 'inherit' });
  if (built.status !== 0) {
    throw new Error('Could not build the game server (run `npm ci --prefix server` first)');
  }
  const proc = spawn(process.execPath, [join('server', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return proc;
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  proc.kill();
  throw new Error('The game server did not start');
}

const ONLINE_HELPERS = `
  ${HELPERS}
  const createProfile = async (name) => {
    await waitFor(() => !!document.querySelector('[role=dialog] input'), 8000);
    const input = document.querySelector('[role=dialog] input');
    if (!input) return false;
    await sleep(200);
    setInput(input, name);
    await sleep(100);
    byText('Create profile').click();
    await sleep(500);
    return true;
  };
  const setInput = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const within = (sel, text) => [...document.querySelectorAll(sel + ' button')]
    .find((b) => b.textContent.trim().startsWith(text));
  const board = () => document.querySelector('[data-screen=game] [role=application]');
  const ply = () => Number(board()?.dataset.ply ?? -1);
  const connection = () => document.querySelector('[data-connection]')?.dataset.connection;
  const clickSq = (sq) => {
    const b = board();
    const r = b.getBoundingClientRect();
    let col = sq.charCodeAt(0) - 97;
    let row = 8 - Number(sq[1]);
    if (b.dataset.orientation === 'b') { col = 7 - col; row = 7 - row; }
    const o = { bubbles: true, clientX: r.left + (col + 0.5) * (r.width / 8),
      clientY: r.top + (row + 0.5) * (r.height / 8), button: 0, pointerId: 1, isPrimary: true };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    b.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const move = async (uci) => {
    const before = ply();
    for (let i = 0; i < 12; i++) {
      clickSq(uci.slice(0, 2)); await sleep(120); clickSq(uci.slice(2, 4));
      if (await waitFor(() => ply() > before, 500)) return true;
    }
    return false;
  };
  const goOnline = async () => {
    location.hash = '#/online';
    return waitFor(() => connection() === 'online' && !!within('[data-quick-match]', 'Find opponent'), 15000);
  };
  const resign = async () => {
    byText('⚑ Resign').click();
    await sleep(300);
    const btn = [...document.querySelectorAll('[role=dialog] button')]
      .find((b) => b.textContent.trim() === 'Resign');
    btn?.click();
    return !!btn;
  };
`;

/** The result of the finished online game, as this app saved it. */
const ONLINE_OVER = `
  const over = await waitFor(() => !!document.querySelector('[data-online-controls] [data-rematch]'), 10000);
  await sleep(600);
  const h = (await window.chessArena.storage.getHistory())[0];
  const p = (await window.chessArena.storage.getProfiles()).profiles[0];
  return { over, record: h && { mode: h.mode, result: h.result, reason: h.reason, moves: h.moves },
    games: (await window.chessArena.storage.getHistory()).length, xp: p?.xp };
`;

/** One app instance in interactive smoke mode: renderer JS goes in, results come back. */
class AppInstance {
  constructor(name, userData) {
    this.name = name;
    this.userData = userData;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
  }

  start() {
    const env = {
      ...process.env,
      CHESS_ARENA_SMOKE: '1',
      CHESS_ARENA_SMOKE_INTERACTIVE: '1',
      CHESS_ARENA_SMOKE_SKIP_ROUTES: '1',
      CHESS_ARENA_USER_DATA: this.userData,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    this.proc = SMOKE_APP ? spawn(SMOKE_APP, [], { env }) : spawn(electron, ['.'], { env });
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.exited = new Promise((r) => this.proc.once('exit', (code, signal) => r({ code, signal })));
    const lines = createInterface({ input: this.proc.stdout });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: app did not start`)), 60_000);
      lines.on('line', (line) => {
        if (line.startsWith('SMOKE-READY ')) {
          clearTimeout(timer);
          resolve(JSON.parse(line.slice(12)));
        } else if (line.startsWith('SMOKE-RESULT ')) {
          const m = JSON.parse(line.slice(13));
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(`${this.name}: ${m.error}`));
          else p.resolve(m.value);
        } else if (line.startsWith('SMOKE ')) {
          clearTimeout(timer);
          reject(new Error(`${this.name}: ${line}`));
        }
      });
      void this.exited.then(() => {
        clearTimeout(timer);
        const err = new Error(`${this.name}: the app exited`);
        reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
    });
  }

  /** Run an async function body (with the online helpers in scope) in the renderer. */
  run(body, timeoutMs = 60_000) {
    const id = this.nextId++;
    const js = `(async () => { ${ONLINE_HELPERS}\n${body}\n})()`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name}: step timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.proc.stdin.write(`${JSON.stringify({ id, js })}\n`);
    });
  }

  async quit() {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    this.proc.stdin.write(`${JSON.stringify({ quit: true })}\n`);
    const done = await Promise.race([this.exited, sleep(10_000).then(() => null)]);
    if (!done) await this.kill();
  }

  /** Like a crash or a force-quit: no goodbye to the server. */
  async kill() {
    this.proc.kill('SIGKILL');
    await this.exited;
  }
}

/** Play `moves` (UCI) alternately, White first; true once both apps show every move. */
async function playOnline(white, black, moves, startPly = 0) {
  for (let i = 0; i < moves.length; i++) {
    const n = startPly + i;
    const mover = n % 2 === 0 ? white : black;
    const ok = await mover.run(
      `await waitFor(() => ply() === ${n}, 10000); return move(${JSON.stringify(moves[i])});`,
    );
    if (!ok) return { failedAt: moves[i] };
  }
  const end = startPly + moves.length;
  const seen = await Promise.all(
    [white, black].map((app) =>
      app.run(`await waitFor(() => ply() === ${end}, 10000); return ply();`),
    ),
  );
  return seen.every((n) => n === end) || { plies: seen };
}

/** Host (White) creates a private game and the guest joins with the code. */
async function inviteGame(host, guest) {
  const code = await host.run(`
    if (!(await goOnline())) return 'not connected: ' + connection();
    within('[data-private-game]', 'White').click();
    await sleep(100);
    within('[data-private-game]', 'Create game').click();
    await waitFor(() => !!document.querySelector('[data-invite-code]'), 5000);
    return document.querySelector('[data-invite-code]')?.dataset.inviteCode ?? null;`);
  const guestSide = await guest.run(`
    if (!(await goOnline())) return 'not connected: ' + connection();
    setInput(document.querySelector('[data-join-game] input'), ${JSON.stringify(` ${String(code).toLowerCase()} `)});
    await sleep(150);
    within('[data-join-game]', 'Join game').click();
    await waitFor(() => !!board(), 8000);
    return board()?.dataset.orientation ?? null;`);
  const hostSide = await host.run(
    `await waitFor(() => !!board(), 8000); return board()?.dataset.orientation ?? null;`,
  );
  return { code, hostSide, guestSide };
}

async function onlineChecks(port) {
  const server = await startGameServer(port);
  const userA = tempDir('chess-arena-online-a-');
  const userB = tempDir('chess-arena-online-b-');
  const a = new AppInstance('A', userA);
  let b = new AppInstance('B', userB);
  try {
    await Promise.all([a.start(), b.start()]);
    const made = await Promise.all([
      a.run(`return createProfile('Alice')`),
      b.run(`return createProfile('Bob')`),
    ]);
    check('online: two apps start with their own profiles', made.every(Boolean), made);

    // (5) A private game by invite code: White mates on move 10 (online XP needs 10 moves).
    const invite = await inviteGame(a, b);
    check(
      'online: creating a private game shows an invite code',
      /^[A-Z0-9]{6}$/.test(invite.code),
      invite.code,
    );
    check(
      'online: a friend joins with the code; colours as chosen',
      invite.hostSide === 'w' && invite.guestSide === 'b',
      invite,
    );
    const mateLine =
      'a2a3 a7a6 h2h3 h7h6 a3a4 a6a5 h3h4 h6h5 a1a2 a8a7 h1h2 h8h7 e2e4 e7e5 f1c4 b8c6 d1f3 d7d6 f3f7';
    const mate = await playOnline(a, b, mateLine.split(' '));
    check('online: moves are relayed between the two apps', mate === true, mate);
    const [overA, overB] = await Promise.all([a.run(ONLINE_OVER), b.run(ONLINE_OVER)]);
    const mated = { mode: 'online', result: '1-0', reason: 'checkmate', moves: 10 };
    check(
      'online: checkmate ends the game the same way on both apps',
      overA?.over &&
        overB?.over &&
        JSON.stringify(overA.record) === JSON.stringify(mated) &&
        JSON.stringify(overB.record) === JSON.stringify(mated),
      { a: overA?.record, b: overB?.record },
    );
    check(
      'online: the winner earns XP',
      overA?.xp > 0 && overA.xp > (overB?.xp ?? 0), {
      a: overA?.xp,
      b: overB?.xp,
    });

    // (6) Quick match pairs the two apps.
    const searching = await a.run(`
      if (!(await goOnline())) return 'not connected: ' + connection();
      within('[data-quick-match]', 'Find opponent').click();
      return waitFor(() => !!document.querySelector('[data-searching]'), 5000);`);
    check('quick match: the first player waits for an opponent', searching === true, searching);
    const sideB = await b.run(`
      if (!(await goOnline())) return 'not connected: ' + connection();
      within('[data-quick-match]', 'Find opponent').click();
      await waitFor(() => !!board(), 8000);
      return board()?.dataset.orientation ?? null;`);
    const sideA = await a.run(
      `await waitFor(() => !!board(), 8000); return board()?.dataset.orientation ?? null;`,
    );
    check(
      'quick match: pairs the two apps with opposite colours',
      ['w', 'b'].includes(sideA) && ['w', 'b'].includes(sideB) && sideA !== sideB,
      { a: sideA, b: sideB },
    );
    const [qWhite, qBlack] = sideA === 'w' ? [a, b] : [b, a];
    const opening = await playOnline(qWhite, qBlack, ['e2e4', 'e7e5']);
    const resigned = opening === true && (await qBlack.run(`return resign()`));
    const [qw, qb] = await Promise.all([qWhite.run(ONLINE_OVER), qBlack.run(ONLINE_OVER)]);
    const byResignation = { mode: 'online', result: '1-0', reason: 'resignation', moves: 1 };
    check(
      'quick match: resigning ends the game for both',
      resigned === true &&
        JSON.stringify(qw?.record) === JSON.stringify(byResignation) &&
        JSON.stringify(qb?.record) === JSON.stringify(byResignation),
      { white: qw?.record, black: qb?.record },
    );

    // (7) The guest's app is killed mid-game, relaunched and rejoins.
    const again = await inviteGame(a, b);
    const start = again.hostSide === 'w' && (await playOnline(a, b, ['e2e4', 'e7e5']));
    check('rejoin: a new game is under way', start === true, { again, start });
    await b.kill();
    const away = await a.run(
      `return waitFor(() => !!document.querySelector('[data-opponent-away]'), 10000);`,
    );
    check('rejoin: the opponent sees the disconnect countdown', away === true);
    b = new AppInstance('B (relaunched)', userB);
    await b.start();
    const back = await b.run(`
      const offered = await waitFor(() => !!document.querySelector('[data-rejoin-online]'), 15000);
      document.querySelector('[data-rejoin-online]')?.click();
      const restored = await waitFor(() => ply() === 2, 15000);
      return { offered, restored, side: board()?.dataset.orientation ?? null };`);
    check(
      'rejoin: Home offers Rejoin and the game comes back',
      back?.offered === true && back?.restored === true && back?.side === 'b',
      back,
    );
    const seenBack = await a.run(
      `return waitFor(() => !document.querySelector('[data-opponent-away]'), 10000);`,
    );
    check('rejoin: the opponent sees the player return', seenBack === true);
    const after = await playOnline(a, b, ['g1f3', 'b8c6'], 2);
    check('rejoin: play continues after rejoining', after === true, after);
    const resignedAfter = await b.run(`return resign()`);
    const [ra, rb] = await Promise.all([a.run(ONLINE_OVER), b.run(ONLINE_OVER)]);
    check(
      'rejoin: the finished game is saved on both apps',
      resignedAfter === true &&
        ra?.record?.result === '1-0' &&
        rb?.record?.result === '1-0' &&
        ra?.record?.moves === 2 &&
        rb?.record?.moves === 2 &&
        rb?.games === 3,
      { a: ra?.record, b: rb?.record, bGames: rb?.games },
    );
  } catch (err) {
    check('online: scenario ran to the end', false, String(err));
    for (const app of [a, b])
      if (app.stderr) console.error(`--- ${app.name} stderr ---\n${app.stderr}`);
  } finally {
    await Promise.all([a.quit(), b.quit()]);
    server.kill();
  }
}

/** Ends the run after the online checks (`SMOKE_ONLY=online`). */
class OnlineOnly extends Error {}

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
    JSON.stringify(first.apiKeys) ===
      '["app","dialog","engine","online","storage","updater","window"]',
    first.apiKeys,
  );
  for (const [route, ok] of Object.entries(first.routes))
    check(`route ${route} renders`, ok === true);

  const onlinePort = localServerPort(first.serverUrl);
  if (onlinePort) {
    await onlineChecks(onlinePort);
  } else if (process.env.SMOKE_ONLY === 'online') {
    check('online checks need a build that points at a local server', false, first.serverUrl);
  } else {
    console.log(`- online checks skipped (the build uses ${first.serverUrl})`);
  }
  if (process.env.SMOKE_ONLY === 'online') throw new OnlineOnly();

  const second = run('');
  check('theme persisted across relaunch (settings)', second.settingsTheme === 'light');
  check('theme applied after relaunch (DOM)', second.dataTheme === 'light');

  // SMOKE_ONLY=phase7 skips the engine, progression and rewards scenarios.
  if (process.env.SMOKE_ONLY !== 'phase7') {
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

    const profileData = tempDir('chess-arena-profile-');
    const [created] = stepsRun(profileData, [{ js: PROFILE_CREATE }]);
    check('first run asks for a profile', created?.firstRun === true);
    check('profile created from the first-run dialog', created?.created === true);
    const [played] = stepsRun(profileData, [
      { shot: 'home' },
      { js: PROFILE_GAME },
      { shot: 'game-over-level-up', wait: 2500 },
      { shot: 'game-over' },
    ]);
    check(
      'profile persisted across relaunch',
      played?.homeShowsProfile === true && played?.noFirstRun,
    );
    check(
      'setup shows an XP preview',
      /Win = Smokey \+60/.test(played?.preview ?? ''),
      played?.preview,
    );
    check(
      'game over shows the XP breakdown',
      played?.awarded === true && /\+60 XP/.test(played?.award),
    );
    check('level-up celebration shown', played?.levelUp === true);
    const [after] = stepsRun(profileData, [{ js: PROFILE_CHECK }, { shot: 'profile' }]);
    check(
      'XP and level saved',
      after?.profile?.xp === 140 && after?.profile?.level === 2,
      after?.profile,
    );
    check('win counted in stats', after?.profile?.wins === 1);
    check(
      'match saved to history',
      JSON.stringify(after?.history) === JSON.stringify([{ result: '1-0', moves: 11, xp: [60] }]),
      after?.history,
    );
    check('profile screen renders', after?.profileScreen === 'Smokey');

    const rewardsData = tempDir('chess-arena-rewards-');
    stepsRun(rewardsData, [{ js: REWARDS_SEED }]);
    const [roadmap, inGame] = stepsRun(rewardsData, [
      { js: REWARDS_EQUIP },
      { shot: 'rewards' },
      { js: REWARDS_GAME },
      { shot: 'game-cosmetics' },
    ]);
    check('rewards roadmap renders all 50 levels', roadmap?.levels === 50, roadmap?.levels);
    check('levels 1–30 reached', roadmap?.reached === 30, roadmap?.reached);
    check('locked rewards cannot be equipped', roadmap?.marbleLocked === true);
    check(
      'equipping from the roadmap',
      JSON.stringify(roadmap?.equipped) ===
        JSON.stringify(
          [
            'board:neon',
            'pieceSet:classic',
            'frame:gold',
            'title:rook-commander',
            'effect:move-trail',
            'avatar:knight-indigo',
          ].sort(),
        ),
      roadmap?.equipped,
    );
    check(
      'equipped board and pieces apply in game',
      inGame?.board === 'neon' && inGame?.pieceSet === 'classic',
      inGame,
    );
    check(
      'frame and title shown in the player strip',
      inGame?.frame === true && inGame?.title === 'Rook Commander',
    );
    check('move trail effect plays', inGame?.trail === true);
    const [kept] = stepsRun(rewardsData, [{ js: REWARDS_CHECK }]);
    check(
      'equips persisted across relaunch',
      kept?.level === 30 &&
        JSON.stringify(kept?.equipped) ===
          JSON.stringify({
            board: 'neon',
            pieceSet: 'classic',
            frame: 'gold',
            effects: ['move-trail'],
            title: 'rook-commander',
          }),
      kept,
    );
    check(
      'settings and rewards reflect the equips',
      kept?.rewardsEquipped === true &&
        kept?.checked?.includes('Neon') &&
        kept?.checked?.includes('Classic'),
      kept?.checked,
    );
  }

  const p7Data = tempDir('chess-arena-p7-');
  const p7Files = tempDir('chess-arena-p7-files-');
  stepsRun(p7Data, [{ js: P7_SEED }]);
  const [hist, , sett] = stepsRun(
    p7Data,
    [
      { js: P7_HISTORY },
      { shot: 'review' },
      { js: `location.hash = '#/history'`, wait: 500, shot: 'history' },
      { js: P7_SETTINGS },
      { js: `location.hash = '#/settings'`, wait: 500, shot: 'settings' },
    ],
    { CHESS_ARENA_SMOKE_SAVE_DIR: p7Files },
  );
  check(
    'sounds play for moves and the result',
    JSON.stringify(hist?.sounds) === JSON.stringify(['move', 'move', 'move', 'win']),
    hist?.sounds,
  );
  check(
    'finished game listed in History',
    hist?.rows === 1 && /Loss/.test(hist?.rowText) && /0-1 by checkmate/.test(hist?.rowText),
    hist?.rowText,
  );
  const files = readdirSync(p7Files);
  const pgnFile = files.find((f) => f.endsWith('.pgn'));
  const pgn = pgnFile ? readFileSync(join(p7Files, pgnFile), 'utf8') : '';
  if (pgnFile && process.env.SMOKE_KEEP_PGN)
    copyFileSync(join(p7Files, pgnFile), process.env.SMOKE_KEEP_PGN);
  check('PGN exported through the save dialog', hist?.pgnToast === true && !!pgnFile, files);
  check(
    'exported PGN is complete',
    pgn.startsWith('[Event "Chess Arena local game"]') &&
      pgn.includes('[White "Hana"]') &&
      pgn.includes('[Result "0-1"]') &&
      pgn.includes('[Termination "Normal"]') &&
      pgn.trimEnd().endsWith('1. f3 e5 2. g4 Qh4# 0-1'),
    pgn,
  );
  check(
    'review opens on the final position',
    /^#\/history\//.test(hist?.review) && /Black played Qh4#/.test(hist?.final),
    hist?.final,
  );
  check('review has every move', hist?.moveButtons === 4, hist?.moveButtons);
  check(
    'review steps with the keyboard (and plays the move sound)',
    hist?.start === 'White to move.' &&
      /^White played f3\./.test(hist?.first) &&
      hist?.stepSound === 'move',
    { start: hist?.start, first: hist?.first, sound: hist?.stepSound },
  );
  check('volume change previews a sound', sett?.previewSound === 'move', sett?.previewSound);
  check(
    'settings apply and are saved',
    sett?.settings?.volume === 0.4 &&
      sett?.settings?.sound === false &&
      sett?.settings?.coordinates === false &&
      sett?.settings?.launchAtStartup === true,
    sett?.settings,
  );
  const backupFile = readdirSync(p7Files).find((f) => f.endsWith('.json'));
  check('data exported through the save dialog', sett?.exported === true && !!backupFile);
  check(
    'reset progress clears XP and history but keeps the profile',
    sett?.resetToast === true &&
      sett?.xp === 0 &&
      sett?.name === 'Hana' &&
      sett?.games === 0 &&
      sett?.emptyHistory === true,
    sett,
  );
  const [imp, pages] = stepsRun(
    p7Data,
    [{ js: P7_IMPORT }, { js: P7_PAGES }, { shot: 'about-license' }],
    { CHESS_ARENA_SMOKE_OPEN_FILE: backupFile ? join(p7Files, backupFile) : '' },
  );
  check(
    'settings and reset survive a relaunch',
    imp?.before?.volume === 0.4 && imp?.before?.sound === false && imp?.xpBefore === 0,
    { settings: imp?.before, xp: imp?.xpBefore },
  );
  check(
    'importing the backup restores XP and history',
    imp?.imported === true && imp?.xp === 3000 && imp?.games === 1 && imp?.rows === 1,
    imp,
  );
  check('no sound plays while sound is off', imp?.mutedSound === 'none', imp?.mutedSound);
  check('home shows the imported profile', imp?.homeLevel === true);
  check(
    'How to Play renders every section',
    pages?.tabs?.length === 7 && pages?.pieceDiagrams === 6 && pages?.xpTable === true,
    pages && { tabs: pages.tabs, diagrams: pages.pieceDiagrams },
  );
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  check(
    'About shows version, changelog and license texts',
    pages?.version === version && pages?.changelog === true && pages?.license === true,
    pages && { version: pages.version, changelog: pages.changelog, license: pages.license },
  );

  // Phase 8: resign vs AI, and quit/relaunch resume of an unfinished timed game.
  const [resign] = stepsRun(tempDir('chess-arena-p8-resign-'), [{ js: P8_AI_RESIGN }]);
  check('smoke/dev builds do not self-update', resign?.updaterMode === 'none', resign?.updaterMode);
  check('AI replies before the resignation', resign?.replied === true);
  check(
    'resigning vs AI ends the game as a defeat',
    resign?.over === true && resign?.defeat === true,
    resign && { over: resign.over, defeat: resign.defeat },
  );
  check(
    'the resignation is saved to history',
    resign?.record?.mode === 'pvai' &&
      resign?.record?.result === '0-1' &&
      resign?.record?.reason === 'resignation',
    resign?.record,
  );
  const resumeData = tempDir('chess-arena-p8-resume-');
  const [started] = stepsRun(resumeData, [{ js: P8_RESUME_START }]);
  const [resumed] = stepsRun(resumeData, [{ js: P8_RESUME_CHECK }, { shot: 'resumed-game' }]);
  check('unfinished game was auto-saved', !!started?.fen, started);
  check('Home offers Continue Game after relaunch', resumed?.offered === true);
  check(
    'Continue Game restores the position',
    resumed?.opened === true && resumed?.moves === 3 && resumed?.fen === started?.fen,
    resumed && { moves: resumed.moves, fen: resumed.fen },
  );
  check(
    'Continue Game restores both clocks',
    resumed?.clockStarted === true &&
      JSON.stringify(resumed?.clocks) === JSON.stringify(resumed?.expected),
    resumed && { shown: resumed.clocks, saved: resumed.expected },
  );
} catch (err) {
  if (!(err instanceof OnlineOnly)) throw err;
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
