import { useEffect, useState } from 'react';
import type { WindowState } from '@shared/types';

export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false });
  useEffect(() => {
    const win = window.chessArena.window;
    void win.getState().then(setState);
    return win.onStateChange(setState);
  }, []);
  return state;
}
