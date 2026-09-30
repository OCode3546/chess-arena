import { useEffect, useState } from 'react';
import { ScreenShell } from '@/components/ScreenShell';
import { Card, CardTitle } from '@/components/ui';

const link = 'text-accent-soft underline-offset-2 hover:underline';

export function AboutScreen() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.chessArena.app.getVersion().then(setVersion);
  }, []);

  return (
    <ScreenShell
      id="about"
      title="About"
      subtitle={version ? `Chess Arena v${version}` : undefined}
    >
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardTitle>Chess Arena</CardTitle>
          <p className="mt-2 text-sm text-muted">
            A modern 2D chess game for Windows. Play a friend on the same PC or challenge the
            computer — fully offline.
          </p>
        </Card>
        <Card>
          <CardTitle>Credits</CardTitle>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            <li>Chess rules: chess.js (BSD-2-Clause)</li>
            <li>“Modern” pieces: Colin M.L. Burnett (GPLv2+), via lichess</li>
            <li>“Classic” pieces: Armando Hernández Marroquín (GPLv2+), via lichess</li>
            <li>Fonts: Inter, Space Grotesk (SIL OFL 1.1)</li>
          </ul>
        </Card>
        <Card className="col-span-2">
          <CardTitle>Chess engine</CardTitle>
          <p className="mt-2 text-sm text-muted">
            The computer opponent is{' '}
            <a className={link} href="https://stockfishchess.org/" target="_blank" rel="noreferrer">
              Stockfish 19
            </a>
            , free software under the GNU General Public License v3 (see{' '}
            <code>LICENSES/Stockfish-GPL-3.0.txt</code> next to the app). The bundled binary is the
            unmodified official release; its source code is available at{' '}
            <a
              className={link}
              href="https://github.com/official-stockfish/Stockfish/tree/sf_19"
              target="_blank"
              rel="noreferrer"
            >
              github.com/official-stockfish/Stockfish
            </a>
            . If it cannot run, the app falls back to{' '}
            <a
              className={link}
              href="https://github.com/nmrugg/stockfish.js"
              target="_blank"
              rel="noreferrer"
            >
              stockfish.js
            </a>{' '}
            (WebAssembly, GPLv3) and then to a small built-in engine.
          </p>
        </Card>
      </div>
    </ScreenShell>
  );
}
