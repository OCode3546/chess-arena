import { ComingSoon, ScreenShell } from '@/components/ScreenShell';

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
