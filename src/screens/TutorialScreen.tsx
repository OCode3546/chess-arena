import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MiniBoard } from '@/components/MiniBoard';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Tabs } from '@/components/ui';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '@/config/difficulty';
import { FULLSCREEN_KEYS, MOD_KEY } from '@/utils/platform';
import {
  ABANDON_BEFORE_MOVE,
  AI_BONUS,
  AI_XP,
  ASSIST_FLOOR_PCT,
  ASSIST_PENALTY_PCT,
  MAX_LEVEL,
  PVP_RULES,
  PVP_XP,
} from '@/config/progression';
import {
  DRAW_RULES,
  ENDINGS,
  PIECE_LESSONS,
  SPECIAL_MOVES,
  START_POSITION,
  type PieceLesson,
} from '@/config/tutorial';
import { xpForLevel, xpToNext } from '@/progression/levels';

type Section = 'basics' | 'pieces' | 'special' | 'endings' | 'draws' | 'controls' | 'xp';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'pieces', label: 'Pieces' },
  { id: 'special', label: 'Special moves' },
  { id: 'endings', label: 'Check & mate' },
  { id: 'draws', label: 'Draws' },
  { id: 'controls', label: 'Controls' },
  { id: 'xp', label: 'XP & levels' },
];

function Lesson({ lesson }: { lesson: PieceLesson }) {
  return (
    <Card className="flex items-center gap-5">
      <MiniBoard diagram={lesson.diagram} size={184} />
      <div className="min-w-0 flex-1">
        <CardTitle>{lesson.name}</CardTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted">{lesson.text}</p>
      </div>
    </Card>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">
    {children}
  </kbd>
);

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-fg">{label}</span>
      <span className="text-right text-sm text-muted">{children}</span>
    </li>
  );
}

function Basics() {
  return (
    <Card className="flex items-center gap-6">
      <MiniBoard diagram={START_POSITION} size={240} />
      <div className="min-w-0 flex-1 space-y-3 text-sm leading-relaxed text-muted">
        <CardTitle className="text-fg">The aim of the game</CardTitle>
        <p>
          Chess is played by two players on a board of 8×8 squares. Each starts with sixteen pieces:
          a king, a queen, two rooks, two bishops, two knights and eight pawns.
        </p>
        <p>
          White moves first, then the players take turns, one move each. A piece captures an
          opponent’s piece by moving onto its square.
        </p>
        <p>
          You win by <b className="text-fg">checkmating</b> the opponent’s king: attacking it so
          that it has no way to escape. A game can also end in a draw.
        </p>
      </div>
    </Card>
  );
}

function Controls() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardTitle>Moving pieces</CardTitle>
        <ul className="mt-2 divide-y divide-line">
          <Row label="Move a piece">Click it, then click a square — or drag it</Row>
          <Row label="Legal moves">Dots; rings mark captures</Row>
          <Row label="Keyboard play">
            <Kbd>Tab</Kbd> to the board, arrows to move, <Kbd>Enter</Kbd> to pick
          </Row>
          <Row label="Look back">Click a move in the move list</Row>
        </ul>
      </Card>
      <Card>
        <CardTitle>Shortcuts</CardTitle>
        <ul className="mt-2 divide-y divide-line">
          <Row label="Flip the board">
            <Kbd>F</Kbd>
          </Row>
          <Row label="Pause menu">
            <Kbd>Esc</Kbd>
          </Row>
          <Row label="Take back (vs AI, if enabled)">
            <Kbd>{MOD_KEY}</Kbd> + <Kbd>Z</Kbd>
          </Row>
          <Row label="Fullscreen">
            {FULLSCREEN_KEYS.map((k, i) => (
              <span key={k}>
                {i > 0 && ' + '}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </Row>
          <Row label="Step through a reviewed game">
            <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>Home</Kbd> <Kbd>End</Kbd>
          </Row>
        </ul>
      </Card>
      <Card className="col-span-2">
        <CardTitle>Clocks, saving and history</CardTitle>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Clocks start after White’s first move; any increment is added after each move.</li>
          <li>
            Pausing stops both clocks. Running out of time loses, unless the opponent cannot mate.
          </li>
          <li>
            Games save after every move. Close the app at any time and pick up with{' '}
            <b className="text-fg">Continue Game</b>.
          </li>
          <li>
            Finished games go to <b className="text-fg">History</b>, where you can replay them and
            export them as PGN for other chess programs.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function XpGuide() {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardTitle>XP vs the computer</CardTitle>
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Difficulty</th>
              <th className="py-1 text-right font-medium">Win</th>
              <th className="py-1 text-right font-medium">Draw</th>
              <th className="py-1 text-right font-medium">Loss</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {DIFFICULTY_ORDER.map((d) => (
              <tr key={d} className="border-t border-line">
                <td className="py-1.5">{DIFFICULTIES[d].label}</td>
                <td className="py-1.5 text-right">{AI_XP[d].win}</td>
                <td className="py-1.5 text-right">{AI_XP[d].draw}</td>
                <td className="py-1.5 text-right">{AI_XP[d].loss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardTitle>Win bonuses</CardTitle>
        <ul className="mt-2 divide-y divide-line">
          <Row label="Finish with checkmate">+{AI_BONUS.checkmatePct}%</Row>
          <Row label={`Win in under ${AI_BONUS.shortWinMoves} moves`}>+{AI_BONUS.shortWinPct}%</Row>
          <Row label="Never lose your queen">+{AI_BONUS.queenIntactPct}%</Row>
          <Row label="Win streak">
            +{AI_BONUS.streakPctPerWin}% per win in a row (max +{AI_BONUS.streakPctCap}%)
          </Row>
          <Row label="First win of the day">+{AI_BONUS.firstWinOfDay} XP</Row>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Each hint or takeback costs {ASSIST_PENALTY_PCT}% of the game’s XP (you always keep at
          least {ASSIST_FLOOR_PCT}% of the base). They are not available on Expert and Grandmaster.
        </p>
      </Card>
      <Card>
        <CardTitle>XP in local games</CardTitle>
        <ul className="mt-2 divide-y divide-line">
          <Row label="Win / draw / loss">
            {PVP_XP.win} / {PVP_XP.draw} / {PVP_XP.loss} XP
          </Row>
          <Row label="Counts from">move {PVP_RULES.minMoves}, between two different profiles</Row>
          <Row label="Same opponent, same day">
            half XP after {PVP_RULES.halfAfter} games, none after {PVP_RULES.zeroAfter}
          </Row>
          <Row label={`Level gap of ${PVP_RULES.levelGap}+`}>
            higher winner ×{PVP_RULES.higherWinnerFactor}, lower winner ×
            {PVP_RULES.lowerWinnerFactor}
          </Row>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Games resigned, agreed drawn or lost on time before move {ABANDON_BEFORE_MOVE} give no XP.
        </p>
      </Card>
      <Card className="flex flex-col">
        <CardTitle>Levels and rewards</CardTitle>
        <ul className="mt-2 divide-y divide-line">
          <Row label="Levels">1 to {MAX_LEVEL}</Row>
          <Row label="Level 1 → 2">{xpToNext(1)} XP</Row>
          <Row label="Level 10 → 11">{xpToNext(10)} XP</Row>
          <Row label="Level 25 → 26">{xpToNext(25).toLocaleString()} XP</Row>
          <Row label={`Level ${MAX_LEVEL - 1} → ${MAX_LEVEL}`}>
            {xpToNext(MAX_LEVEL - 1).toLocaleString()} XP
          </Row>
          <Row label={`Total to level ${MAX_LEVEL}`}>
            {xpForLevel(MAX_LEVEL).toLocaleString()} XP
          </Row>
        </ul>
        <p className="mt-3 flex-1 text-xs text-muted">
          Levelling up unlocks boards, avatars, titles, frames and effects.
        </p>
        <Button className="mt-3 self-start" onClick={() => navigate('/rewards')}>
          See all rewards
        </Button>
      </Card>
    </div>
  );
}

export function TutorialScreen() {
  const [section, setSection] = useState<Section>('basics');
  let content: ReactNode;
  switch (section) {
    case 'basics':
      content = <Basics />;
      break;
    case 'pieces':
      content = (
        <>
          <p className="text-sm text-muted">
            Every piece except the knight is blocked by pieces in its way. Dots show where the
            highlighted piece can go; rings mark captures.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {PIECE_LESSONS.map((l) => (
              <Lesson key={l.name} lesson={l} />
            ))}
          </div>
        </>
      );
      break;
    case 'special':
      content = (
        <div className="flex flex-col gap-4">
          {SPECIAL_MOVES.map((l) => (
            <Lesson key={l.name} lesson={l} />
          ))}
        </div>
      );
      break;
    case 'endings':
      content = (
        <div className="flex flex-col gap-4">
          {ENDINGS.map((l) => (
            <Lesson key={l.name} lesson={l} />
          ))}
        </div>
      );
      break;
    case 'draws':
      content = (
        <Card>
          <CardTitle>Ways a game is drawn</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Chess Arena spots these automatically and ends the game — you never need to claim a
            draw.
          </p>
          <ul className="mt-3 divide-y divide-line">
            {DRAW_RULES.map((r) => (
              <li key={r.name} className="py-2.5">
                <div className="text-sm font-semibold">{r.name}</div>
                <div className="text-sm text-muted">{r.text}</div>
              </li>
            ))}
          </ul>
        </Card>
      );
      break;
    case 'controls':
      content = <Controls />;
      break;
    case 'xp':
      content = <XpGuide />;
      break;
  }

  return (
    <ScreenShell id="tutorial" title="How to Play" subtitle="Rules, special moves and how XP works">
      <Tabs<Section>
        label="Tutorial sections"
        items={SECTIONS}
        value={section}
        onChange={setSection}
      />
      <div className="flex flex-col gap-4" data-tutorial-section={section}>
        {content}
      </div>
    </ScreenShell>
  );
}
