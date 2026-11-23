import { Chess, type Move, type Square } from 'chess.js';
import { AnimatePresence, motion } from 'framer-motion';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Color } from '@shared/types';
import { boardTheme } from '@/config/boards';
import { PIECE_NAME, pieceUrl } from '@/config/pieces';
import { useGameStore } from '@/store/gameStore';
import { useCosmetics } from '@/store/profileStore';
import { useSettings } from '@/store/settingsStore';
import { cx } from '@/utils/format';
import { BoardEffects } from './BoardEffects';
import { displayPos, isLightSquare, squareAt } from './boardGeometry';
import { trackPieces, type TrackedPiece } from './pieceIds';
import { PromotionPicker } from './PromotionPicker';
import { START_FEN } from './rules';

interface DragState {
  id: string;
  from: Square;
  dx: number;
  dy: number;
  hover: Square | null;
  /** Position the drag started in; a drag is void once the position changes. */
  posKey: string;
}

interface PointerTrack {
  id: string;
  from: Square;
  posKey: string;
  startX: number;
  startY: number;
  wasSelected: boolean;
  dragging: boolean;
}

const HIGHLIGHT = {
  normal: {
    last: 'rgb(255 214 10 / 0.38)',
    selected: 'rgb(20 120 60 / 0.5)',
    hover: 'rgb(255 255 255 / 0.55)',
  },
  colorBlind: {
    last: 'rgb(56 132 255 / 0.45)',
    selected: 'rgb(255 140 0 / 0.55)',
    hover: 'rgb(255 255 255 / 0.7)',
  },
};

const PieceView = memo(function PieceView({
  piece,
  row,
  col,
  set,
  drag,
  squarePx,
  animate,
}: {
  piece: TrackedPiece;
  row: number;
  col: number;
  set: string;
  drag: DragState | null;
  squarePx: number;
  animate: boolean;
}) {
  const dragging = drag?.id === piece.id;
  const x = col + (dragging && squarePx ? drag.dx / squarePx : 0);
  const y = row + (dragging && squarePx ? drag.dy / squarePx : 0);
  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 h-[12.5%] w-[12.5%] will-change-transform"
      style={{ zIndex: dragging ? 30 : 10 }}
      initial={false}
      animate={{ x: `${x * 100}%`, y: `${y * 100}%`, scale: dragging ? 1.1 : 1, opacity: 1 }}
      exit={{ scale: 0.2, opacity: 0, transition: { duration: animate ? 0.18 : 0 } }}
      transition={
        dragging || !animate
          ? { duration: 0 }
          : { type: 'tween', ease: [0.25, 0.8, 0.3, 1], duration: 0.2 }
      }
    >
      <img
        src={pieceUrl(set, piece.color, piece.type)}
        alt=""
        draggable={false}
        className={cx(
          'h-full w-full select-none',
          dragging && 'drop-shadow-[0_10px_12px_rgb(0_0_0/0.45)]',
        )}
      />
    </motion.div>
  );
});

/** A finished game shown read-only (history review) instead of the live game. */
export interface ReviewSource {
  history: Move[];
  /** Ply shown; null = the final position. */
  ply: number | null;
  orientation: Color;
}

const NO_SQUARES: Square[] = [];

export function Board({
  interactive = true,
  review,
}: {
  interactive?: boolean;
  review?: ReviewSource;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<PointerTrack | null>(null);
  const [size, setSize] = useState(0);
  const [dragState, setDrag] = useState<DragState | null>(null);
  const [cursor, setCursor] = useState<Square>('e2');
  const [focused, setFocused] = useState(false);

  // In review the position comes from the props; the live game is ignored.
  const liveFen = useGameStore((s) => s.fen);
  const liveHistory = useGameStore((s) => s.history);
  const liveOrientation = useGameStore((s) => s.orientation);
  const liveSelected = useGameStore((s) => s.selected);
  const liveTargets = useGameStore((s) => s.legalTargets);
  const liveViewPly = useGameStore((s) => s.viewPly);
  const liveHint = useGameStore((s) => s.hint);
  const history = review ? review.history : liveHistory;
  const fen = review ? (review.history.at(-1)?.after ?? START_FEN) : liveFen;
  const orientation = review ? review.orientation : liveOrientation;
  const selected = review ? null : liveSelected;
  const legalTargets = review ? NO_SQUARES : liveTargets;
  const viewPly = review ? review.ply : liveViewPly;
  const hint = review ? null : liveHint;
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const aiTurn = useGameStore(
    (s) => s.settings?.mode === 'pvai' && s.fen.split(' ')[1] !== s.settings.humanColor,
  );
  const selectSquare = useGameStore((s) => s.selectSquare);
  const attemptMove = useGameStore((s) => s.attemptMove);
  const settings = useSettings((s) => s.settings);
  const look = useCosmetics();

  // Keep the board square and as large as the space allows.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(Math.max(0, Math.floor(Math.min(width, height) / 8) * 8));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shownHistory = useMemo(
    () => (viewPly === null ? history : history.slice(0, viewPly)),
    [history, viewPly],
  );
  const startFen = history[0]?.before ?? fen;
  const shownFen = viewPly === null ? fen : viewPly === 0 ? startFen : history[viewPly - 1]!.after;
  const pieces = useMemo(() => trackPieces(startFen, shownHistory), [startFen, shownHistory]);
  const pieceOn = useMemo(() => new Map(pieces.map((p) => [p.square, p])), [pieces]);
  const turn = shownFen.split(' ')[1] as Color;
  const lastMove = shownHistory[shownHistory.length - 1];
  const checkSquare = useMemo(() => {
    const c = new Chess(shownFen);
    return c.inCheck() ? c.findPiece({ type: 'k', color: c.turn() })[0] : undefined;
  }, [shownFen]);

  const canMove =
    interactive && !review && status === 'playing' && !paused && viewPly === null && !aiTurn;
  const squarePx = size / 8;
  const hl = settings.colorBlindHighlights ? HIGHLIGHT.colorBlind : HIGHLIGHT.normal;
  const theme = boardTheme(look.board);

  // Any in-flight drag is ignored once the position changes underneath it.
  const posKey = `${fen}|${viewPly}`;
  const drag = dragState?.posKey === posKey ? dragState : null;
  const hover = drag?.hover ?? null;

  const doMove = useCallback(
    (from: Square, to: Square) => {
      const result = attemptMove(from, to, { autoQueen: settings.autoQueen });
      if (result === 'illegal') {
        const p = pieceOn.get(to);
        selectSquare(p && p.color === turn ? to : null);
      }
    },
    [attemptMove, pieceOn, selectSquare, settings.autoQueen, turn],
  );

  /** Click / Enter semantics shared by mouse and keyboard. */
  const activate = (sq: Square) => {
    if (!canMove) return;
    if (selected && legalTargets.includes(sq)) {
      doMove(selected, sq);
      return;
    }
    const p = pieceOn.get(sq);
    selectSquare(p && p.color === turn && sq !== selected ? sq : null);
  };

  const squareFromPoint = (clientX: number, clientY: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return squareAt(row, col, orientation);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canMove) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    setCursor(sq);
    if (selected && legalTargets.includes(sq)) {
      doMove(selected, sq);
      return;
    }
    const p = pieceOn.get(sq);
    if (p && p.color === turn) {
      const wasSelected = selected === sq;
      selectSquare(sq);
      trackRef.current = {
        id: p.id,
        from: sq,
        posKey,
        startX: e.clientX,
        startY: e.clientY,
        wasSelected,
        dragging: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured; dragging still works inside the board.
      }
    } else {
      selectSquare(null);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = trackRef.current;
    if (!t || t.posKey !== posKey) return;
    const dx = e.clientX - t.startX;
    const dy = e.clientY - t.startY;
    if (!t.dragging && Math.hypot(dx, dy) < 4) return;
    t.dragging = true;
    setDrag({
      id: t.id,
      from: t.from,
      dx,
      dy,
      posKey,
      hover: squareFromPoint(e.clientX, e.clientY),
    });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const t = trackRef.current;
    trackRef.current = null;
    setDrag(null);
    if (!t || t.posKey !== posKey) return;
    if (t.dragging) {
      const target = squareFromPoint(e.clientX, e.clientY);
      if (target && target !== t.from) doMove(t.from, target);
    } else if (t.wasSelected) {
      selectSquare(null);
    }
  };

  const onPointerCancel = () => {
    trackRef.current = null;
    setDrag(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (review) return;
    const { row, col } = displayPos(cursor, orientation);
    const move = (r: number, c: number) => {
      e.preventDefault();
      setCursor(squareAt(Math.min(7, Math.max(0, r)), Math.min(7, Math.max(0, c)), orientation));
    };
    switch (e.key) {
      case 'ArrowUp':
        return move(row - 1, col);
      case 'ArrowDown':
        return move(row + 1, col);
      case 'ArrowLeft':
        return move(row, col - 1);
      case 'ArrowRight':
        return move(row, col + 1);
      case 'Enter':
      case ' ':
        e.preventDefault();
        activate(cursor);
        return;
      case 'Escape':
        if (selected) {
          e.stopPropagation();
          selectSquare(null);
        }
        return;
    }
  };

  const cursorPiece = pieceOn.get(cursor);
  const ariaStatus = lastMove
    ? `${lastMove.color === 'w' ? 'White' : 'Black'} played ${lastMove.san}. ${turn === 'w' ? 'White' : 'Black'} to move.`
    : 'White to move.';

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(row, col, orientation);
      const light = isLightSquare(sq);
      const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
      const isTarget = canMove && settings.legalMoves && legalTargets.includes(sq);
      const occupied = pieceOn.has(sq) && pieceOn.get(sq)?.id !== drag?.id;
      squares.push(
        <div
          key={sq}
          className="relative"
          style={{ background: light ? theme.light : theme.dark }}
          aria-hidden
        >
          {isLast && <div className="absolute inset-0" style={{ background: hl.last }} />}
          {selected === sq && (
            <div className="absolute inset-0" style={{ background: hl.selected }} />
          )}
          {hint && viewPly === null && (hint.from === sq || hint.to === sq) && (
            <div className="hint-square absolute inset-0" />
          )}
          {checkSquare === sq && (
            <div className="check-pulse absolute inset-0 rounded-full blur-[1px]" />
          )}
          {hover === sq && (
            <div
              className="absolute inset-0"
              style={{ boxShadow: `inset 0 0 0 4px ${hl.hover}` }}
            />
          )}
          {focused && cursor === sq && (
            <div
              className="absolute inset-0 z-20"
              style={{ boxShadow: 'inset 0 0 0 3px var(--accent-soft)' }}
            />
          )}
          <AnimatePresence>
            {isTarget && (
              <motion.div
                key="t"
                className="absolute inset-0 z-[15] flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {occupied ? (
                  <div
                    className="h-full w-full rounded-full"
                    style={{ boxShadow: 'inset 0 0 0 calc(var(--sq) * 0.08) rgb(0 0 0 / 0.28)' }}
                  />
                ) : (
                  <div className="h-[30%] w-[30%] rounded-full bg-black/25" />
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {settings.coordinates && col === 0 && (
            <span
              className="absolute top-0.5 left-1 text-[max(10px,calc(var(--sq)*0.16))] leading-none font-semibold"
              style={{ color: light ? theme.coordLight : theme.coordDark }}
            >
              {sq[1]}
            </span>
          )}
          {settings.coordinates && row === 7 && (
            <span
              className="absolute right-1 bottom-0.5 text-[max(10px,calc(var(--sq)*0.16))] leading-none font-semibold"
              style={{ color: light ? theme.coordLight : theme.coordDark }}
            >
              {sq[0]}
            </span>
          )}
        </div>,
      );
    }
  }

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center">
      <div
        ref={boardRef}
        role="application"
        // Moves played so far (tests use this; the move list is hidden in narrow windows).
        data-ply={history.length}
        data-orientation={orientation}
        data-board={look.board}
        data-piece-set={look.pieceSet}
        aria-label={
          review
            ? `Game review board, ${orientation === 'w' ? 'White' : 'Black'} at the bottom.`
            : `Chess board, ${orientation === 'w' ? 'White' : 'Black'} at the bottom. Arrow keys move the cursor, Enter selects and moves. Cursor on ${cursor}${cursorPiece ? `, ${cursorPiece.color === 'w' ? 'white' : 'black'} ${PIECE_NAME[cursorPiece.type]}` : ''}.`
        }
        tabIndex={review ? -1 : 0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(!review)}
        onBlur={() => setFocused(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          'relative touch-none overflow-hidden rounded-xl shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)] ring-1 ring-black/20 outline-none',
          canMove ? 'cursor-pointer' : 'cursor-default',
        )}
        style={{ width: size, height: size, ['--sq' as string]: `${squarePx}px` }}
      >
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">{squares}</div>
        <AnimatePresence initial={false}>
          {pieces.map((p) => {
            const { row, col } = displayPos(p.square, orientation);
            return (
              <PieceView
                key={p.id}
                piece={p}
                row={row}
                col={col}
                set={look.pieceSet}
                drag={drag?.id === p.id ? drag : null}
                squarePx={squarePx}
                animate={settings.animations}
              />
            );
          })}
        </AnimatePresence>
        <BoardEffects
          move={viewPly === null ? lastMove : undefined}
          ply={shownHistory.length}
          orientation={orientation}
          squarePx={squarePx}
          trail={settings.animations && look.effects.includes('move-trail')}
          particles={settings.animations && look.effects.includes('capture-particles')}
        />
        {!review && <PromotionPicker color={turn} pieceSet={look.pieceSet} />}
        <div className="sr-only" aria-live="polite">
          {ariaStatus}
        </div>
      </div>
    </div>
  );
}
