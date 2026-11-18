// Downloads the pinned official Stockfish release for a platform into
// resources/engine/ and verifies its SHA-256. Usage:
//   node scripts/fetch-engine.mjs            (host platform)
//   node scripts/fetch-engine.mjs win32 x64  (e.g. before `electron-builder --win`)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'sf_19';
const RELEASES = {
  'win32-x64': {
    asset: 'stockfish-windows-x86-64-universal.zip',
    sha256: '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7',
    inner: 'stockfish/stockfish-windows-x86-64-universal.exe',
    out: 'stockfish-windows-x86-64.exe',
  },
  'win32-arm64': {
    asset: 'stockfish-windows-arm64-universal.zip',
    sha256: '8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401',
    inner: 'stockfish/stockfish-windows-arm64-universal.exe',
    out: 'stockfish-windows-arm64.exe',
  },
  'darwin-arm64': {
    asset: 'stockfish-macos-universal.tar.gz',
    sha256: 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
    inner: 'stockfish/stockfish-macos-universal',
    out: 'stockfish-macos',
  },
  'darwin-x64': {
    asset: 'stockfish-macos-universal.tar.gz',
    sha256: 'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77',
    inner: 'stockfish/stockfish-macos-universal',
    out: 'stockfish-macos',
  },
  'linux-x64': {
    asset: 'stockfish-linux-x86-64-universal.tar.gz',
    sha256: '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f',
    inner: 'stockfish/stockfish-linux-x86-64-universal',
    out: 'stockfish-linux-x86-64',
  },
  'linux-arm64': {
    asset: 'stockfish-linux-arm64-universal.tar.gz',
    sha256: 'fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01',
    inner: 'stockfish/stockfish-linux-arm64-universal',
    out: 'stockfish-linux-arm64',
  },
};

const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? process.arch;
const release = RELEASES[`${platform}-${arch}`];
if (!release) {
  console.error(`No Stockfish build configured for ${platform}-${arch}`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = join(root, 'resources', 'engine');
const target = join(engineDir, release.out);
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log(`✔ ${release.out} already present`);
  process.exit(0);
}

const url = `https://github.com/official-stockfish/Stockfish/releases/download/${VERSION}/${release.asset}`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== release.sha256) {
  throw new Error(`SHA-256 mismatch for ${release.asset}: got ${digest}`);
}

const work = mkdtempSync(join(tmpdir(), 'chess-arena-engine-'));
try {
  const archive = join(work, release.asset);
  writeFileSync(archive, bytes);
  // bsdtar (macOS, Windows 10+) reads zip and tar.gz; GNU tar only needs tar.gz here.
  // On Windows, call System32's bsdtar explicitly: Git Bash puts GNU tar first on PATH,
  // which can't read zips and treats "C:\..." as a remote host.
  const tarBin =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const tar = spawnSync(tarBin, ['-xf', archive, '-C', work], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error('Extraction failed');
  mkdirSync(engineDir, { recursive: true });
  copyFileSync(join(work, release.inner), target);
  if (platform !== 'win32') chmodSync(target, 0o755);
  copyFileSync(join(work, 'stockfish', 'Copying.txt'), join(engineDir, 'Copying.txt'));
  console.log(`✔ Installed ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
