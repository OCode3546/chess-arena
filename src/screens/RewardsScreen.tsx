import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, LevelBadge, TitleTag } from '@/components/Avatar';
import { BoardSwatch, LockIcon, PieceSetPreview } from '@/components/Cosmetics';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card } from '@/components/ui';
import { XpBar } from '@/components/XpBar';
import { MAX_LEVEL } from '@/config/progression';
import {
  badgeTier,
  EFFECTS,
  FRAMES,
  rewardKey,
  rewardsAt,
  TITLES,
  type Cosmetics,
  type Reward,
  type RewardKind,
} from '@/config/rewards';
import { useActiveProfile, useCosmetics, useProfiles } from '@/store/profileStore';
import { cx } from '@/utils/format';

const KIND_LABEL: Record<RewardKind, string> = {
  board: 'Board theme',
  pieceSet: 'Piece set',
  avatar: 'Avatar',
  title: 'Title',
  frame: 'Avatar frame',
  effect: 'Effect',
};

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

function EffectIcon({ id }: { id: string }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text">
      {id === 'move-trail' ? (
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M4 20 18 6" opacity="0.35" />
          <path d="M9 15 18 6" opacity="0.65" />
          <circle cx="19" cy="5" r="2.2" fill="currentColor" />
        </svg>
      ) : (
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      )}
    </div>
  );
}

function preview(r: Reward, look: Cosmetics): ReactNode {
  switch (r.kind) {
    case 'board':
      return <BoardSwatch id={r.id} pieceSet={look.pieceSet} size={48} />;
    case 'pieceSet':
      return <PieceSetPreview id={r.id} size={48} />;
    case 'avatar':
      return <Avatar id={r.id} size={48} className="rounded-xl" />;
    case 'frame':
      return <Avatar id={look.avatarId} frame={r.id} size={48} className="rounded-xl" />;
    case 'title':
      return (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-display text-xl font-bold text-accent-text">
          “
        </div>
      );
    case 'effect':
      return <EffectIcon id={r.id} />;
  }
}

function isEquipped(r: Reward, look: Cosmetics): boolean {
  switch (r.kind) {
    case 'avatar':
      return look.avatarId === r.id;
    case 'title':
      return look.title === r.id;
    case 'effect':
      return look.effects.includes(r.id);
    default:
      return look[r.kind] === r.id;
  }
}

function RewardCard({
  reward,
  unlocked,
  look,
  canEquip,
}: {
  reward: Reward;
  unlocked: boolean;
  look: Cosmetics;
  canEquip: boolean;
}) {
  const equip = useProfiles((s) => s.equip);
  const on = unlocked && isEquipped(reward, look);
  const toggles = reward.kind === 'title' || reward.kind === 'effect';

  let action: ReactNode;
  if (!unlocked) {
    action = (
      <span className="flex items-center gap-1 text-xs font-semibold text-muted">
        <LockIcon /> Unlocks at Lv {reward.level}
      </span>
    );
  } else if (!canEquip) {
    action = null;
  } else if (toggles) {
    action = (
      <Button
        size="sm"
        variant={on ? 'primary' : 'secondary'}
        onClick={() => equip(reward.kind, reward.id, !on)}
        aria-pressed={on}
        aria-label={`${on ? 'Unequip' : 'Equip'} ${reward.name}`}
      >
        {reward.kind === 'effect' ? (on ? 'On' : 'Off') : on ? 'Equipped' : 'Equip'}
      </Button>
    );
  } else {
    action = (
      <Button
        size="sm"
        variant={on ? 'primary' : 'secondary'}
        disabled={on}
        onClick={() => equip(reward.kind, reward.id)}
        aria-label={on ? `${reward.name} equipped` : `Equip ${reward.name}`}
      >
        {on ? 'Equipped' : 'Equip'}
      </Button>
    );
  }

  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5',
        on ? 'border-accent bg-accent/10' : 'border-line bg-surface',
      )}
      data-reward={rewardKey(reward)}
      data-locked={!unlocked || undefined}
    >
      <div className={cx(!unlocked && 'opacity-40 grayscale')}>{preview(reward, look)}</div>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-sm font-semibold', !unlocked && 'text-muted')}>
          {reward.name}
        </div>
        <div className="truncate text-xs text-muted">
          {reward.kind === 'effect' ? EFFECTS[reward.id]!.description : KIND_LABEL[reward.kind]}
        </div>
      </div>
      {action}
    </div>
  );
}

function LevelRow({
  level,
  current,
  look,
  canEquip,
}: {
  level: number;
  current: number;
  look: Cosmetics;
  canEquip: boolean;
}) {
  const rewards = rewardsAt(level);
  const reached = level <= current;
  const tier = badgeTier(level);
  return (
    <li className="relative flex gap-4" data-level={level} data-reached={reached || undefined}>
      <div className="relative flex w-12 shrink-0 flex-col items-center">
        <div
          className={cx(
            'z-10 flex h-10 w-10 items-center justify-center rounded-full font-display text-sm font-bold',
            level === current
              ? 'bg-accent text-white ring-4 ring-accent/30'
              : reached
                ? 'bg-accent/20 text-accent-text'
                : 'border border-line bg-elev text-muted',
          )}
          aria-current={level === current ? 'step' : undefined}
        >
          {level}
        </div>
        {level < MAX_LEVEL && (
          <div className={cx('w-0.5 flex-1', level < current ? 'bg-accent/40' : 'bg-line')} />
        )}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        {rewards.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {rewards.map((r) => (
              <RewardCard
                key={rewardKey(r)}
                reward={r}
                unlocked={reached}
                look={look}
                canEquip={canEquip}
              />
            ))}
          </div>
        ) : (
          <div className={cx('flex h-10 items-center gap-2 text-sm', !reached && 'opacity-60')}>
            <LevelBadge level={level} />
            <span className="text-muted">
              Level badge · {tier.name} tier
              {!reached && ` · unlocks at Lv ${level}`}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

export function RewardsScreen() {
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const look = useCosmetics();
  const level = profile?.level ?? 1;
  const listRef = useRef<HTMLOListElement>(null);

  // Start the roadmap at the current level.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-level="${Math.max(1, level - 1)}"]`)
      ?.scrollIntoView({ block: 'start' });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScreenShell id="rewards" title="Rewards" subtitle="Everything you unlock from level 1 to 50">
      <Card className="flex items-center gap-5 p-5">
        <Avatar id={look.avatarId} frame={look.frame} size={72} />
        <div className="min-w-0 flex-1">
          {profile ? (
            <>
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-xl font-bold">{profile.name}</span>
                <LevelBadge level={profile.level} />
              </div>
              <TitleTag id={look.title} className="block" />
              <XpBar xp={profile.xp} className="mt-3" />
            </>
          ) : (
            <div className="flex items-center gap-3 text-sm text-muted">
              Create a profile to unlock and equip rewards.
              <Button size="sm" variant="primary" onClick={() => navigate('/profile')}>
                Create profile
              </Button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 border-l border-line pl-5">
          <BoardSwatch id={look.board} pieceSet={look.pieceSet} size={64} />
          <div className="text-xs text-muted">
            <div className="font-semibold text-fg">Equipped</div>
            <div>{TITLES[look.title ?? ''] ?? 'No title'}</div>
            <div>{FRAMES[look.frame]}</div>
            <div>
              {look.effects.length
                ? look.effects.map((e) => EFFECTS[e]!.name).join(', ')
                : 'No effects'}
            </div>
          </div>
        </div>
      </Card>

      <ol ref={listRef} className="flex flex-col" aria-label="Level rewards">
        {LEVELS.map((l) => (
          <LevelRow key={l} level={l} current={level} look={look} canEquip={!!profile} />
        ))}
      </ol>
    </ScreenShell>
  );
}
