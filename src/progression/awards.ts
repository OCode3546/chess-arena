import type { Difficulty } from '@shared/types';
import { DIFFICULTIES } from '@/config/difficulty';
import {
  ABANDON_BEFORE_MOVE,
  AI_BONUS,
  AI_XP,
  ASSIST_FLOOR_PCT,
  ASSIST_PENALTY_PCT,
  PVP_RULES,
  PVP_XP,
  type Outcome,
} from '@/config/progression';
import type { EndReason } from '@/game/rules';

export interface XpLine {
  label: string;
  amount: number;
}

export interface XpAward {
  /** Never negative; equals the sum of `lines`. */
  total: number;
  lines: XpLine[];
  /** Why no (or reduced) XP was given. */
  note?: string;
}

const OUTCOME_LABEL: Record<Outcome, string> = { win: 'Win', draw: 'Draw', loss: 'Loss' };

/** Results that are not decided on the board. */
const OFF_BOARD: EndReason[] = ['resignation', 'agreement', 'timeout', 'timeout-insufficient'];

/** Resigned, agreed or flagged before move 5: no legitimate result. */
export function isAbandoned(reason: EndReason, moves: number): boolean {
  return OFF_BOARD.includes(reason) && moves < ABANDON_BEFORE_MOVE;
}

const none = (note: string): XpAward => ({ total: 0, lines: [], note });

const finish = (lines: XpLine[], note?: string): XpAward => {
  const kept = lines.filter((l) => l.amount !== 0);
  const total = Math.max(
    0,
    kept.reduce((sum, l) => sum + l.amount, 0),
  );
  return note ? { total, lines: kept, note } : { total, lines: kept };
};

const pct = (base: number, percent: number) => Math.round((base * percent) / 100);

export interface AiAwardInput {
  difficulty: Difficulty;
  outcome: Outcome;
  reason: EndReason;
  /** Full moves played. */
  moves: number;
  /** The human's queen (or a promoted one) was captured. */
  queenLost: boolean;
  /** Consecutive wins before this game. */
  priorStreak: number;
  /** No win vs the computer yet today. */
  firstWinToday: boolean;
  /** Hints plus takebacks used. */
  assistsUsed: number;
}

export function aiAward(i: AiAwardInput): XpAward {
  if (isAbandoned(i.reason, i.moves)) {
    return none(`Games ended before move ${ABANDON_BEFORE_MOVE} give no XP.`);
  }
  const base = AI_XP[i.difficulty][i.outcome];
  const lines: XpLine[] = [
    { label: `${OUTCOME_LABEL[i.outcome]} vs ${DIFFICULTIES[i.difficulty].label}`, amount: base },
  ];
  if (i.outcome === 'win') {
    if (i.reason === 'checkmate') {
      lines.push({
        label: `Checkmate finish +${AI_BONUS.checkmatePct}%`,
        amount: pct(base, AI_BONUS.checkmatePct),
      });
    }
    if (i.moves < AI_BONUS.shortWinMoves) {
      lines.push({
        label: `Won in under ${AI_BONUS.shortWinMoves} moves +${AI_BONUS.shortWinPct}%`,
        amount: pct(base, AI_BONUS.shortWinPct),
      });
    }
    if (!i.queenLost) {
      lines.push({
        label: `Queen never lost +${AI_BONUS.queenIntactPct}%`,
        amount: pct(base, AI_BONUS.queenIntactPct),
      });
    }
    const streakPct = Math.min(
      AI_BONUS.streakPctCap,
      Math.max(0, i.priorStreak) * AI_BONUS.streakPctPerWin,
    );
    if (streakPct > 0) {
      lines.push({
        label: `Win streak ×${i.priorStreak + 1} +${streakPct}%`,
        amount: pct(base, streakPct),
      });
    }
    if (i.firstWinToday) {
      lines.push({ label: 'First win of the day', amount: AI_BONUS.firstWinOfDay });
    }
  }
  const assists = Math.max(0, Math.floor(i.assistsUsed));
  if (assists > 0) {
    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
    const kept = Math.max(
      Math.round(subtotal * Math.max(0, 1 - (assists * ASSIST_PENALTY_PCT) / 100)),
      pct(base, ASSIST_FLOOR_PCT),
    );
    lines.push({
      label: `${assists} hint${assists === 1 ? '' : 's'}/takeback${assists === 1 ? '' : 's'} −${ASSIST_PENALTY_PCT}% each`,
      amount: Math.min(0, kept - subtotal),
    });
  }
  return finish(lines);
}

export interface PvpAwardInput {
  outcome: Outcome;
  reason: EndReason;
  moves: number;
  /** The same profile played both sides. */
  sameProfile: boolean;
  /** Games this pairing already finished today (before this one). */
  gamesTodayBefore: number;
  /** This player's level minus the opponent's; null when the opponent is a guest. */
  levelGap: number | null;
}

export function pvpAward(i: PvpAwardInput): XpAward {
  if (i.sameProfile) return none('The same profile played both sides — no XP.');
  if (i.moves < PVP_RULES.minMoves) {
    return none(`Local games award XP once they reach move ${PVP_RULES.minMoves}.`);
  }
  const base = PVP_XP[i.outcome];
  const lines: XpLine[] = [
    { label: `Local ${OUTCOME_LABEL[i.outcome].toLowerCase()}`, amount: base },
  ];
  let amount = base;
  if (i.outcome === 'win' && i.levelGap !== null) {
    let factor = 1;
    if (i.levelGap >= PVP_RULES.levelGap) factor = PVP_RULES.higherWinnerFactor;
    else if (i.levelGap <= -PVP_RULES.levelGap) factor = PVP_RULES.lowerWinnerFactor;
    if (factor !== 1) {
      const next = Math.round(amount * factor);
      lines.push({
        label: factor < 1 ? 'Beat a much lower level ×0.5' : 'Beat a much higher level ×1.5',
        amount: next - amount,
      });
      amount = next;
    }
  }
  let note: string | undefined;
  if (i.gamesTodayBefore >= PVP_RULES.zeroAfter) {
    lines.push({ label: 'Daily limit with this opponent', amount: -amount });
    note = `After ${PVP_RULES.zeroAfter} games a day with the same opponent, XP stops until tomorrow.`;
  } else if (i.gamesTodayBefore >= PVP_RULES.halfAfter) {
    const next = Math.round(amount / 2);
    lines.push({ label: 'Many games with this opponent today ×0.5', amount: next - amount });
    note = `After ${PVP_RULES.halfAfter} games a day with the same opponent, XP is halved.`;
  }
  return finish(lines, note);
}
