import { useEffect, useState } from 'react';
import { ScreenShell } from '@/components/ScreenShell';
import { Card, CardTitle } from '@/components/ui';

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
      </div>
    </ScreenShell>
  );
}
