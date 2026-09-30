import { ComingSoon, ScreenShell } from '@/components/ScreenShell';

export function ProfileScreen() {
  return (
    <ScreenShell id="profile" title="Profile" subtitle="Your level, stats and achievements">
      <ComingSoon phase="Phase 5">
        Multiple local profiles, stats and achievements arrive with the XP system.
      </ComingSoon>
    </ScreenShell>
  );
}

export function RewardsScreen() {
  return (
    <ScreenShell id="rewards" title="Rewards" subtitle="Everything you unlock from level 1 to 50">
      <ComingSoon phase="Phase 6">
        The level 1–50 roadmap with boards, titles and frames arrives soon.
      </ComingSoon>
    </ScreenShell>
  );
}

export function HistoryScreen() {
  return (
    <ScreenShell id="history" title="History" subtitle="Finished games and PGN export">
      <ComingSoon phase="Phase 7">
        Game history, move-by-move review and PGN export arrive soon.
      </ComingSoon>
    </ScreenShell>
  );
}

export function TutorialScreen() {
  return (
    <ScreenShell id="tutorial" title="How to Play" subtitle="Rules, special moves and how XP works">
      <ComingSoon phase="Phase 7" />
    </ScreenShell>
  );
}
