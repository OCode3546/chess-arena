import type { PieceSymbol, Square } from 'chess.js';
import { useMemo } from 'react';
import type { Color } from '@shared/types';
import { boardTheme } from '@/config/boards';
import { pieceUrl } from '@/config/pieces';
import { diagramTargets, type Diagram } from '@/config/tutorial';
import { useCosmetics } from '@/store/profileStore';

const FILES = 'abcdefgh';

/** A static board for teaching diagrams, drawn in the active profile's board and pieces. */
export function MiniBoard({ diagram, size = 216 }: { diagram: Diagram; size?: number }) {
  const look = useCosmetics();
  const theme = boardTheme(look.board);
  const targets = useMemo(() => diagramTargets(diagram), [diagram]);
  const rows = diagram.fen.split(' ')[0]!.split('/');

  const squares = [];
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]!) {
      const empty = Number(ch);
      const cells: (string | null)[] = empty ? Array<null>(empty).fill(null) : [ch];
      for (const piece of cells) {
        const sq = `${FILES[col]}${8 - r}` as Square;
        const light = (col + r) % 2 === 0;
        const target = targets.get(sq);
        squares.push(
          <div
            key={sq}
            className="relative"
            style={{ background: light ? theme.light : theme.dark }}
          >
            {diagram.highlight?.includes(sq) && (
              <div className="absolute inset-0" style={{ background: 'rgb(255 214 10 / 0.38)' }} />
            )}
            {diagram.from?.includes(sq) && (
              <div className="absolute inset-0" style={{ background: 'rgb(20 120 60 / 0.5)' }} />
            )}
            {diagram.check === sq && <div className="check-pulse absolute inset-0 rounded-full" />}
            {piece && (
              <img
                src={pieceUrl(
                  look.pieceSet,
                  (piece === piece.toUpperCase() ? 'w' : 'b') as Color,
                  piece.toLowerCase() as PieceSymbol,
                )}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full"
              />
            )}
            {target !== undefined && (
              <div className="absolute inset-0 flex items-center justify-center">
                {target ? (
                  <div
                    className="h-full w-full rounded-full"
                    style={{ boxShadow: `inset 0 0 0 ${size / 100}px rgb(0 0 0 / 0.3)` }}
                  />
                ) : (
                  <div className="h-[30%] w-[30%] rounded-full bg-black/25" />
                )}
              </div>
            )}
          </div>,
        );
        col++;
      }
    }
  }

  return (
    <figure className="flex shrink-0 flex-col gap-2" style={{ width: size }}>
      <div
        className="grid grid-cols-8 grid-rows-8 overflow-hidden rounded-lg shadow-lg ring-1 ring-black/20"
        style={{ width: size, height: size }}
        role="img"
        aria-label={diagram.caption}
      >
        {squares}
      </div>
      <figcaption className="text-center text-xs text-muted">{diagram.caption}</figcaption>
    </figure>
  );
}
