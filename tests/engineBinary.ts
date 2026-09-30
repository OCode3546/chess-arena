import { join } from 'node:path';

/** Path of the downloaded native Stockfish for this machine (see scripts/fetch-engine.mjs). */
export function hostEngineBinary(): string {
  const arm = process.arch === 'arm64';
  const file =
    process.platform === 'win32'
      ? `stockfish-windows-${arm ? 'arm64' : 'x86-64'}.exe`
      : process.platform === 'darwin'
        ? 'stockfish-macos'
        : `stockfish-linux-${arm ? 'arm64' : 'x86-64'}`;
  return join(__dirname, '..', 'resources', 'engine', file);
}
