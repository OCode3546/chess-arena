// Launches the built app hidden (twice) and checks renderer isolation, routing
// and that the theme setting survives a relaunch. Run via `npm run verify:sandbox`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';

const userData = mkdtempSync(join(tmpdir(), 'chess-arena-smoke-'));

function run(action) {
  const env = {
    ...process.env,
    CHESS_ARENA_SMOKE: '1',
    CHESS_ARENA_USER_DATA: userData,
    CHESS_ARENA_SMOKE_ACTION: action,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const res = spawnSync(electron, ['.'], { env, encoding: 'utf8', timeout: 60_000 });
  const line = `${res.stdout}`.split('\n').find((l) => l.startsWith('SMOKE '));
  if (!line) {
    console.error(res.stdout, res.stderr);
    throw new Error('No smoke report');
  }
  return JSON.parse(line.slice(6));
}

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? '✔' : '✘'} ${name}`);
  if (!ok) failures.push(name);
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
    JSON.stringify(first.apiKeys) === '["app","storage","window"]',
  );
  for (const [route, ok] of Object.entries(first.routes))
    check(`route ${route} renders`, ok === true);

  const second = run('');
  check('theme persisted across relaunch (settings)', second.settingsTheme === 'light');
  check('theme applied after relaunch (DOM)', second.dataTheme === 'light');
} finally {
  rmSync(userData, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
