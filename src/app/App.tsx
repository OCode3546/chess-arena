import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { aiEngine } from '@/ai/engine';
import { Button, Modal, ToastHost } from '@/components/ui';
import { AboutScreen } from '@/screens/AboutScreen';
import { GameScreen } from '@/screens/GameScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { HistoryScreen, RewardsScreen, TutorialScreen } from '@/screens/Placeholders';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SetupScreen } from '@/screens/SetupScreen';
import { SplashScreen } from '@/screens/SplashScreen';
import { useGameStore } from '@/store/gameStore';
import { useProfiles, wireProgression } from '@/store/profileStore';
import { loadProfiles, useSession, wireGamePersistence } from '@/store/sessionStore';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { FirstRunModal } from './FirstRunModal';
import { TitleBar } from './TitleBar';

const SPLASH_MIN_MS = 700;
/** Longest the splash waits for the chess engine before showing the app anyway. */
const ENGINE_WAIT_MS = 2500;

const BACKEND_NOTICE = {
  wasm: 'Stockfish could not start on this PC — using the WebAssembly version instead.',
  minimax: 'Stockfish is unavailable — using the basic built-in engine.',
} as const;

export function App() {
  const [ready, setReady] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { theme, accent, animations } = useSettings((s) => s.settings);
  const firstRun = useProfiles((s) => s.loaded && s.profiles.length === 0);

  // Boot: settings, storage health, saved game, engine.
  useEffect(() => {
    wireGamePersistence();
    const offProgression = wireProgression();
    const started = Date.now();
    const offBackend = aiEngine.onBackendChange((backend) => {
      document.documentElement.dataset.engine = backend;
      if (backend !== 'native') toast(BACKEND_NOTICE[backend], 'warning');
    });
    const engineReady = Promise.race([
      aiEngine.warmUp().catch((err) => console.error(err)),
      new Promise((r) => window.setTimeout(r, ENGINE_WAIT_MS)),
    ]);
    void (async () => {
      try {
        await useSettings.getState().load();
        const issues = await window.chessArena.app.getStartupIssues();
        if (issues.includes('settings'))
          toast('Your settings file was damaged and has been reset.', 'warning');
        if (issues.includes('profiles'))
          toast('Your profiles file was damaged and could not be read.', 'error');
        if (issues.includes('history'))
          toast('Your game history file was damaged and has been reset.', 'warning');
        await loadProfiles();
        await useSession.getState().refreshSavedGame();
      } catch (err) {
        console.error(err);
        toast('Some saved data could not be loaded.', 'error');
      }
      await engineReady;
      window.setTimeout(() => setReady(true), Math.max(0, SPLASH_MIN_MS - (Date.now() - started)));
    })();
    return () => {
      offBackend();
      offProgression();
    };
  }, []);

  // Theme tokens live on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.motion = animations ? 'on' : 'off';
  }, [theme, accent, animations]);

  // Window close: auto-save and ask when a game is running.
  useEffect(() => {
    return window.chessArena.window.onCloseRequested(() => {
      const game = useGameStore.getState();
      if (game.status === 'playing') {
        game.persist(Date.now());
        if (!game.paused) game.setPaused(true);
        setConfirmClose(true);
      } else {
        window.chessArena.window.confirmClose();
      }
    });
  }, []);

  const saveAndQuit = () => {
    useGameStore.getState().persist();
    window.chessArena.window.confirmClose();
  };

  return (
    <MotionConfig reducedMotion={animations ? 'user' : 'always'}>
      <div data-app-root className="app-bg flex h-full flex-col text-fg">
        <TitleBar />
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait">
            {!ready ? (
              <SplashScreen key="splash" />
            ) : (
              <motion.div
                key="app"
                className="h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <HashRouter>
                  <Routes>
                    <Route path="/" element={<HomeScreen />} />
                    <Route path="/setup" element={<SetupScreen />} />
                    <Route path="/game" element={<GameScreen />} />
                    <Route path="/profile" element={<ProfileScreen />} />
                    <Route path="/rewards" element={<RewardsScreen />} />
                    <Route path="/history" element={<HistoryScreen />} />
                    <Route path="/settings" element={<SettingsScreen />} />
                    <Route path="/tutorial" element={<TutorialScreen />} />
                    <Route path="/about" element={<AboutScreen />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </HashRouter>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <ToastHost />
        <FirstRunModal open={ready && firstRun} />
        <Modal
          open={confirmClose}
          title="Quit Chess Arena?"
          onClose={() => setConfirmClose(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmClose(false)} data-autofocus>
                Keep playing
              </Button>
              <Button variant="primary" onClick={saveAndQuit}>
                Save &amp; quit
              </Button>
            </>
          }
        >
          Your game is in progress. It has been saved — you can pick it up later with{' '}
          <b>Continue Game</b>.
        </Modal>
      </div>
    </MotionConfig>
  );
}
