import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { playSound } from '@/audio/sfx';
import { LevelBadge } from '@/components/Avatar';
import { achievementById } from '@/config/achievements';
import { rewardKey, rewardsAt } from '@/config/rewards';
import { levelProgress } from '@/progression/levels';
import type { PlayerAward } from '@/progression/match';
import { useSettings } from '@/store/settingsStore';
import { cx } from '@/utils/format';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Animated XP counter + bar for one profile, filling level by level. */
function AwardRow({
  a,
  animate,
  showName,
  onLevelUp,
}: {
  a: PlayerAward;
  animate: boolean;
  showName: boolean;
  onLevelUp: (level: number) => void;
}) {
  const [shown, setShown] = useState(animate ? a.before.xp : a.after.xp);
  const levelUp = useRef(onLevelUp);
  useEffect(() => {
    levelUp.current = onLevelUp;
  });

  useEffect(() => {
    const from = a.before.xp;
    const to = a.after.xp;
    if (!animate || from === to) {
      // Already showing the final value (initial state).
      if (a.levelsGained > 0) levelUp.current(a.after.level);
      return;
    }
    const duration = Math.min(2400, 900 + 450 * a.levelsGained);
    let lastLevel = a.before.level;
    let raf = 0;
    const t0 = performance.now() + 350;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / duration));
      const xp = Math.round(from + (to - from) * easeOut(t));
      setShown(xp);
      const level = levelProgress(xp).level;
      if (level > lastLevel) {
        lastLevel = level;
        levelUp.current(level);
      }
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [a, animate]);

  const p = levelProgress(shown);
  const gained = Math.min(a.award.total, shown - a.before.xp);
  const done = shown === a.after.xp;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 text-left" data-xp-award>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-semibold text-fg">{showName ? a.name : 'Experience'}</span>
        <span className="font-display text-lg font-bold text-accent-text tabular-nums">
          +{gained} XP
        </span>
      </div>
      {a.award.lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {a.award.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{l.label}</span>
              <span className={l.amount < 0 ? 'text-danger tabular-nums' : 'tabular-nums'}>
                {l.amount > 0 ? '+' : '−'}
                {Math.abs(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.award.note && <p className="mt-2 text-xs italic">{a.award.note}</p>}
      <div className="mt-3 flex items-center gap-3">
        <LevelBadge level={p.level} className="h-5 shrink-0 px-2 text-[11px]" />
        <div
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label={p.max ? 'Maximum level reached' : `Experience to level ${p.level + 1}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.fraction * 100)}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft"
            style={{ width: `${p.fraction * 100}%` }}
          />
        </div>
        <span className="w-24 shrink-0 text-right text-xs tabular-nums">
          {p.max ? 'MAX' : `${p.into} / ${p.needed}`}
        </span>
      </div>
      {done && (a.unlocks.length > 0 || a.achievements.length > 0) && (
        <motion.div
          className="mt-3 border-t border-line pt-3"
          initial={animate ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          data-unlocks
        >
          {a.unlocks.length > 0 && (
            <>
              <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                Unlocked · Lv {a.after.level}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {a.unlocks.map((r) => (
                  <li
                    key={rewardKey(r)}
                    className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-text"
                    data-unlock={rewardKey(r)}
                  >
                    {r.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.achievements.length > 0 && (
            <ul className={cx('flex flex-wrap gap-1.5', a.unlocks.length > 0 && 'mt-2')}>
              {a.achievements.map(achievementById).map(
                (def) =>
                  def && (
                    <li
                      key={def.id}
                      className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-fg"
                      title={def.description}
                      data-achievement={def.id}
                    >
                      {def.icon} {def.name}
                    </li>
                  ),
              )}
            </ul>
          )}
        </motion.div>
      )}
    </div>
  );
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  const angle = (i * 137.5 * Math.PI) / 180;
  const dist = 110 + ((i * 37) % 70);
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist * 0.75,
    rotate: (i * 53) % 360,
    color: ['var(--accent)', 'var(--accent-soft)', 'var(--warning)', 'var(--success)'][i % 4],
    delay: (i % 7) * 0.015,
  };
});

/** Burst overlay shown over the Game Over panel when a level is gained. */
function LevelUpBurst({ level, reduced }: { level: number; reduced: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-live="assertive"
      data-level-up={level}
    >
      {!reduced &&
        CONFETTI.map((c, i) => (
          <motion.span
            key={i}
            className="absolute h-2.5 w-1.5 rounded-sm"
            style={{ background: c.color }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: c.x, y: c.y + 40, opacity: 0, rotate: c.rotate + 180, scale: 1 }}
            transition={{ duration: 1.3, delay: c.delay, ease: 'easeOut' }}
          />
        ))}
      <motion.div
        className="rounded-2xl bg-accent px-6 py-3 text-center text-white shadow-[0_18px_50px_-12px_var(--accent)]"
        initial={reduced ? false : { scale: 0.5, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
      >
        <div className="text-xs font-semibold tracking-[0.25em] uppercase opacity-85">Level up</div>
        <div className="font-display text-4xl font-bold">Lv {level}</div>
        {rewardsAt(level).length > 0 && (
          <div className="mt-1 max-w-64 text-xs font-medium opacity-90">
            {rewardsAt(level)
              .map((r) => r.name)
              .join(' · ')}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** XP breakdown for every profile in the finished game, with level-up celebration. */
export function XpSummary({ awards }: { awards: PlayerAward[] }) {
  const animations = useSettings((s) => s.settings.animations);
  const reduced = !!useReducedMotion() || !animations;
  const [burst, setBurst] = useState<{ level: number; key: number } | null>(null);

  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(null), 2200);
    return () => window.clearTimeout(t);
  }, [burst]);

  if (awards.length === 0) return null;
  return (
    <>
      <div className="mt-5 flex flex-col gap-2">
        {awards.map((a) => (
          <AwardRow
            key={a.profileId}
            a={a}
            animate={!reduced}
            showName={awards.length > 1}
            onLevelUp={(level) => {
              setBurst({ level, key: Date.now() });
              playSound('levelUp');
            }}
          />
        ))}
      </div>
      <AnimatePresence>
        {burst && <LevelUpBurst key={burst.key} level={burst.level} reduced={reduced} />}
      </AnimatePresence>
    </>
  );
}
