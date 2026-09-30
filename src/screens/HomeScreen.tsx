import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/app/TitleBar';
import { Avatar, LevelBadge } from '@/components/Avatar';
import { Button, ProgressBar } from '@/components/ui';
import { describeTimeControl } from '@/config/timeControls';
import { useSession } from '@/store/sessionStore';

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function NavTile({
  label,
  hint,
  to,
  icon,
}: {
  label: string;
  hint: string;
  to: string;
  icon: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <motion.button
      variants={item}
      type="button"
      onClick={() => navigate(to)}
      whileHover={{ y: -2 }}
      className="glass group flex cursor-pointer items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-surface-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-text">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </motion.button>
  );
}

const I = {
  profile: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  rewards: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  ),
  history: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 3" />
    </svg>
  ),
  settings: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  tutorial: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z" />
    </svg>
  ),
  about: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};

export function HomeScreen() {
  const navigate = useNavigate();
  const profile = useSession((s) => s.profile);
  const savedGame = useSession((s) => s.savedGame);
  const continueSavedGame = useSession((s) => s.continueSavedGame);

  const onContinue = async () => {
    if (await continueSavedGame()) navigate('/game');
  };

  return (
    <section data-screen="home" className="h-full overflow-y-auto">
      <motion.div
        className="mx-auto grid min-h-full w-full max-w-6xl grid-cols-[1.15fr_1fr] items-center gap-10 px-10 py-10"
        initial="hidden"
        animate="show"
        transition={{ staggerChildren: 0.05 }}
      >
        {/* Left: brand + primary actions */}
        <div className="flex flex-col gap-8">
          <motion.div variants={item} className="flex items-center gap-4">
            <Logo className="h-16 w-16 shadow-2xl" />
            <div>
              <h1 className="font-display text-5xl font-bold tracking-tight">Chess Arena</h1>
              <p className="mt-1 text-muted">Play a friend on this PC or challenge the computer.</p>
            </div>
          </motion.div>

          <motion.div variants={item} className="flex flex-col gap-3">
            {savedGame && (
              <Button
                variant="primary"
                size="lg"
                block
                onClick={onContinue}
                className="justify-between"
              >
                <span>Continue Game</span>
                <span className="text-sm font-medium opacity-85">
                  {savedGame.settings.players.w.name} vs {savedGame.settings.players.b.name} ·{' '}
                  {describeTimeControl(savedGame.settings.timeControl)}
                </span>
              </Button>
            )}
            <Button
              variant={savedGame ? 'secondary' : 'primary'}
              size="lg"
              block
              onClick={() => navigate('/setup?mode=pvai')}
              className="justify-between"
            >
              <span>Play vs AI</span>
              <span className="text-sm font-medium opacity-75">Six difficulty levels</span>
            </Button>
            <Button
              size="lg"
              block
              onClick={() => navigate('/setup?mode=pvp')}
              className="justify-between"
            >
              <span>Play vs Player</span>
              <span className="text-sm font-medium text-muted">Local · same PC</span>
            </Button>
          </motion.div>

          <motion.div variants={item}>
            <Button variant="ghost" onClick={() => window.chessArena.app.quit()}>
              Quit
            </Button>
          </motion.div>
        </div>

        {/* Right: player card + secondary nav */}
        <div className="flex flex-col gap-4">
          <motion.div variants={item} className="glass rounded-3xl p-6">
            <div className="flex items-center gap-4">
              <Avatar id={profile.avatarId} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-xl font-bold">{profile.name}</span>
                  <LevelBadge level={profile.level} />
                </div>
                <div className="mt-0.5 text-xs text-muted">Novice</div>
              </div>
            </div>
            <div className="mt-5 flex items-baseline justify-between text-xs">
              <span className="font-semibold text-muted">Experience</span>
              <span className="tabular-nums text-muted">
                {profile.xp} / {profile.xpToNext} XP
              </span>
            </div>
            <ProgressBar
              className="mt-2"
              value={profile.xp / profile.xpToNext}
              label="Experience to next level"
            />
          </motion.div>

          <div className="grid grid-cols-2 gap-3">
            <NavTile label="Profile" hint="Stats & achievements" to="/profile" icon={I.profile} />
            <NavTile label="Rewards" hint="Unlocks up to Lv 50" to="/rewards" icon={I.rewards} />
            <NavTile label="History" hint="Review past games" to="/history" icon={I.history} />
            <NavTile label="Settings" hint="Theme, board, sound" to="/settings" icon={I.settings} />
            <NavTile label="How to Play" hint="Rules & XP" to="/tutorial" icon={I.tutorial} />
            <NavTile label="About" hint="Version & credits" to="/about" icon={I.about} />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
