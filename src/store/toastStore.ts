import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, kind?: ToastKind, durationMs?: number): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(message, kind = 'info', durationMs = 4500) {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    window.setTimeout(() => get().dismiss(id), durationMs);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (message: string, kind?: ToastKind) =>
  useToasts.getState().push(message, kind);
