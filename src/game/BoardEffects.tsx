import type { Move, Square } from 'chess.js';
import { AnimatePresence, motion } from 'framer-motion';
import type { Color } from '@shared/types';
import { displayPos } from './boardGeometry';

const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2 + (i % 2) * 0.2;
  const dist = 0.55 + ((i * 7) % 5) * 0.08;
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, big: i % 3 === 0 };
});

/** Square the captured piece stood on (differs from `to` for en passant). */
function capturedOn(m: Move): Square {
  return m.flags.includes('e') ? (`${m.to[0]}${m.from[1]}` as Square) : m.to;
}

/**
 * Cosmetic overlays for the latest move: a fading streak along its path (move trail) and a
 * spark burst where a piece was captured (capture particles). Keyed by ply so each move
 * plays once; nothing replays when the board first mounts.
 */
export function BoardEffects({
  move,
  ply,
  orientation,
  squarePx,
  trail,
  particles,
}: {
  move: Move | undefined;
  ply: number;
  orientation: Color;
  squarePx: number;
  trail: boolean;
  particles: boolean;
}) {
  const from = move && displayPos(move.from, orientation);
  const to = move && displayPos(move.to, orientation);
  const hit = move?.captured ? displayPos(capturedOn(move), orientation) : undefined;
  return (
    <>
      <AnimatePresence initial={false}>
        {trail && from && to && (
          <motion.svg
            key={ply}
            className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
            viewBox="0 0 8 8"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeIn' }}
            aria-hidden
            data-effect="move-trail"
          >
            <motion.line
              x1={from.col + 0.5}
              y1={from.row + 0.5}
              x2={to.col + 0.5}
              y2={to.row + 0.5}
              stroke="var(--accent-soft)"
              strokeWidth={0.2}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ filter: 'drop-shadow(0 0 0.12px var(--accent))' }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {particles && hit && (
          <motion.div
            key={ply}
            className="pointer-events-none absolute z-[25] h-[12.5%] w-[12.5%]"
            style={{ left: `${hit.col * 12.5}%`, top: `${hit.row * 12.5}%` }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.55 }}
            aria-hidden
            data-effect="capture-particles"
          >
            {SPARKS.map((s, i) => {
              const size = squarePx * (s.big ? 0.14 : 0.09);
              return (
                <motion.span
                  key={i}
                  className="absolute top-1/2 left-1/2 rounded-full"
                  style={{
                    width: size,
                    height: size,
                    marginLeft: -size / 2,
                    marginTop: -size / 2,
                    background: i % 2 ? 'var(--warning)' : 'var(--accent-soft)',
                    boxShadow: '0 0 6px var(--accent-soft)',
                  }}
                  initial={{ x: 0, y: 0, scale: 1 }}
                  animate={{ x: s.x * squarePx, y: s.y * squarePx, scale: 0.2 }}
                  transition={{ duration: 0.75, ease: 'easeOut' }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
