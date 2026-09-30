// Launches the built app hidden and checks renderer isolation, routing, that the
// theme setting survives a relaunch, that the AI opponent plays on every engine
// backend (native, WASM, minimax) without leaving engine processes behind, and the
// profile → game → XP → level-up flow across relaunches, and that rewards render for all
// 50 levels and equipped cosmetics apply instantly and survive a relaunch.
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

function stepsRun(userData, steps) {
  const file = join(tempDir('chess-arena-steps-'), 'steps.json');
  writeFileSync(file, JSON.stringify(steps));
  return run('', {
    CHESS_ARENA_USER_DATA: userData,
    CHESS_ARENA_SMOKE_SKIP_ROUTES: '1',
    CHESS_ARENA_SMOKE_STEPS: file,
  }).steps;
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
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
