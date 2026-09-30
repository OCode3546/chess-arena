/// <reference types="vite/client" />
import type { ChessArenaApi } from '@shared/types';

declare global {
  interface Window {
    chessArena: ChessArenaApi;
  }
}

export {};
