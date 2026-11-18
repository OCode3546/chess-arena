import { useEffect, useState } from 'react';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal } from '@/components/ui';
import { CHANGELOG } from '@/config/changelog';
import { DEVELOPER, LINKS, PROJECT_LINKS } from '@shared/links';
import type { LicenseId } from '@shared/types';

const link = 'text-accent-text underline-offset-2 hover:underline';

interface Credit {
  name: string;
  author: string;
  license: string;
  licenseId?: LicenseId;
  source?: string;
}

const CREDITS: Credit[] = [
  {
    name: 'Chess Arena (design & development)',
    author: DEVELOPER.name,
    license: 'Original work',
    source: DEVELOPER.github,
  },
  {
    name: 'Stockfish 19 (chess engine)',
    author: 'The Stockfish developers',
    license: 'GPL-3.0',
    licenseId: 'stockfish',
    source: LINKS.stockfishSource,
  },
  {
    name: 'stockfish.js (WebAssembly engine)',
    author: 'Nathan Rugg, Chess.com, Stockfish authors',
    license: 'GPL-3.0',
    licenseId: 'stockfish',
    source: LINKS.stockfishJs,
  },
  {
    name: 'chess.js (rules)',
    author: 'Jeff Hlywa',
    license: 'BSD-2-Clause',
    licenseId: 'chess-js',
    source: LINKS.chessJs,
  },
  {
    name: '“Modern” pieces (cburnett)',
    author: 'Colin M.L. Burnett, via lichess',
    license: 'GPL-2.0-or-later',
    licenseId: 'gpl-2',
    source: LINKS.cburnett,
  },
  {
    name: '“Classic” pieces (merida)',
    author: 'Armando Hernández Marroquín, via lichess',
    license: 'GPL-2.0-or-later',
    licenseId: 'gpl-2',
    source: LINKS.merida,
  },
  {
    name: 'Inter (typeface)',
    author: 'The Inter Project Authors',
    license: 'SIL OFL 1.1',
    licenseId: 'inter',
    source: LINKS.inter,
  },
  {
    name: 'Space Grotesk (typeface)',
    author: 'The Space Grotesk Project Authors',
    license: 'SIL OFL 1.1',
    licenseId: 'space-grotesk',
    source: LINKS.spaceGrotesk,
  },
  {
    name: 'Sound effects',
    author: `${DEVELOPER.name} (synthesised at runtime)`,
    license: 'Part of the app',
  },
];

const LICENSE_TITLE: Record<LicenseId, string> = {
  stockfish: 'GNU General Public License v3 (Stockfish)',
  'gpl-2': 'GNU General Public License v2 (piece sets)',
  'chess-js': 'BSD 2-Clause License (chess.js)',
  inter: 'SIL Open Font License 1.1 (Inter)',
  'space-grotesk': 'SIL Open Font License 1.1 (Space Grotesk)',
};

const External = ({ href, children }: { href: string; children: string }) => (
  <a className={link} href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export function AboutScreen() {
  const [version, setVersion] = useState('');
  const [license, setLicense] = useState<{ id: LicenseId; text: string } | null>(null);
  useEffect(() => {
    void window.chessArena.app.getVersion().then(setVersion);
  }, []);

  const showLicense = (id: LicenseId) => {
    window.chessArena.app
      .getLicense(id)
      .then((text) => setLicense({ id, text }))
      .catch((err) => {
        console.error(err);
        setLicense({
          id,
          text: 'The license file could not be opened. It ships in the LICENSES folder next to the app.',
        });
      });
  };

  return (
    <ScreenShell
      id="about"
      title="About"
      subtitle={version ? `Chess Arena v${version}` : undefined}
    >
      <div className="grid grid-cols-2 gap-4">
        <Card className="flex flex-col">
          <CardTitle>Chess Arena</CardTitle>
          <p className="mt-2 text-sm text-muted">
            A modern 2D chess game for Windows and macOS. Play a friend on the same computer or
            challenge the AI — fully offline.
          </p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Version</dt>
            <dd data-version>{version}</dd>
            <dt className="text-muted">Developer</dt>
            <dd data-developer>{DEVELOPER.name}</dd>
            <dt className="text-muted">GitHub</dt>
            <dd>
              <External href={DEVELOPER.github}>
                {DEVELOPER.github.replace('https://', '')}
              </External>
            </dd>
            {PROJECT_LINKS.website && (
              <>
                <dt className="text-muted">Website</dt>
                <dd>
                  <External href={PROJECT_LINKS.website}>{PROJECT_LINKS.website}</External>
                </dd>
              </>
            )}
            {PROJECT_LINKS.support && (
              <>
                <dt className="text-muted">Support</dt>
                <dd>
                  <External href={PROJECT_LINKS.support}>{PROJECT_LINKS.support}</External>
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <CardTitle>What’s new</CardTitle>
          <div className="mt-2 max-h-56 space-y-3 overflow-y-auto pr-1" data-changelog>
            {CHANGELOG.map((entry) => (
              <div key={entry.version}>
                <div className="text-sm font-semibold">v{entry.version}</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
                  {entry.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card className="col-span-2">
          <CardTitle>Chess engine</CardTitle>
          <p className="mt-2 text-sm text-muted">
            The computer opponent is <External href={LINKS.stockfish}>Stockfish 19</External>, free
            software under the GNU General Public License v3. The bundled binary is the unmodified
            official release; its complete source code is available at{' '}
            <External href={LINKS.stockfishSource}>
              github.com/official-stockfish/Stockfish
            </External>
            . If it cannot run, the app falls back to{' '}
            <External href={LINKS.stockfishJs}>stockfish.js</External> (WebAssembly, GPLv3) and then
            to a small built-in engine.
          </p>
          <Button size="sm" className="mt-3" onClick={() => showLicense('stockfish')}>
            View GPL-3.0 license
          </Button>
        </Card>

        <Card className="col-span-2">
          <CardTitle>Credits &amp; licenses</CardTitle>
          <table className="mt-3 w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Component</th>
                <th className="py-1 text-left font-medium">Author</th>
                <th className="py-1 text-left font-medium">License</th>
                <th className="py-1 text-right font-medium">
                  <span className="sr-only">Links</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {CREDITS.map((c) => (
                <tr key={c.name} className="border-t border-line align-middle">
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  <td className="py-2 pr-3 text-muted">{c.author}</td>
                  <td className="py-2 pr-3 text-muted">{c.license}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {c.licenseId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => showLicense(c.licenseId!)}
                        aria-label={`View license of ${c.name}`}
                      >
                        License
                      </Button>
                    )}
                    {c.source && (
                      <a
                        className={`${link} ml-2 text-xs`}
                        href={c.source}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Source of ${c.name}`}
                      >
                        Source ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            All license texts also ship in the <code>LICENSES</code> folder next to the app.
          </p>
        </Card>
      </div>

      <Modal
        open={license !== null}
        title={license ? LICENSE_TITLE[license.id] : undefined}
        onClose={() => setLicense(null)}
        className="max-w-3xl!"
        actions={
          <Button variant="primary" onClick={() => setLicense(null)} data-autofocus>
            Close
          </Button>
        }
      >
        <pre
          className="max-h-[55vh] overflow-y-auto rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg select-text"
          data-license-text
        >
          {license?.text}
        </pre>
      </Modal>
    </ScreenShell>
  );
}
