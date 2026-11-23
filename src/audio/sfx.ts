import { useGameStore } from '@/store/gameStore';
import { useSettings } from '@/store/settingsStore';
import { endSound, moveSound, type SoundId } from './cues';

/**
 * Sound effects, synthesised with the Web Audio API (no sample files to license or load).
 * Each sound is a few short oscillator / filtered-noise voices scheduled on one context.
 */

type Voice = (ac: AudioContext, out: AudioNode, t: number) => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    master.connect(limiter).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function envelope(ac: AudioContext, t: number, peak: number, attack: number, end: number) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + end);
  return g;
}

/** A wooden "tock": a falling sine thump plus a band-passed click. */
function knock(ac: AudioContext, out: AudioNode, t: number, pitch = 1, gain = 1): void {
  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(230 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(95 * pitch, t + 0.08);
  osc.connect(envelope(ac, t, 0.75 * gain, 0.004, 0.12)).connect(out);
  osc.start(t);
  osc.stop(t + 0.13);

  const click = ac.createBufferSource();
  click.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2300 * pitch;
  band.Q.value = 1.3;
  click
    .connect(band)
    .connect(envelope(ac, t, 0.55 * gain, 0.002, 0.045))
    .connect(out);
  click.start(t);
  click.stop(t + 0.05);
}

function tone(
  ac: AudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  gain = 0.2,
  type: OscillatorType = 'triangle',
): void {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.connect(envelope(ac, t, gain, 0.012, dur)).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Notes in Hz. */
const N = {
  C4: 261.63,
  Eb4: 311.13,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  C7: 2093,
};

const arpeggio = (
  ac: AudioContext,
  out: AudioNode,
  t: number,
  notes: number[],
  step: number,
  dur: number,
  gain: number,
) => notes.forEach((f, i) => tone(ac, out, t + i * step, f, dur, gain));

const VOICES: Record<SoundId, Voice> = {
  move: (ac, o, t) => knock(ac, o, t),
  capture: (ac, o, t) => {
    knock(ac, o, t, 1.3, 1.1);
    knock(ac, o, t + 0.05, 0.8, 0.8);
  },
  castle: (ac, o, t) => {
    knock(ac, o, t);
    knock(ac, o, t + 0.12, 0.9);
  },
  check: (ac, o, t) => {
    knock(ac, o, t);
    tone(ac, o, t + 0.03, N.D6, 0.12, 0.16);
    tone(ac, o, t + 0.13, N.A5, 0.18, 0.16);
  },
  promote: (ac, o, t) => {
    knock(ac, o, t);
    arpeggio(ac, o, t + 0.04, [N.C5, N.E5, N.G5, N.C6], 0.06, 0.2, 0.16);
  },
  win: (ac, o, t) => {
    arpeggio(ac, o, t, [N.C5, N.E5, N.G5], 0.11, 0.3, 0.2);
    tone(ac, o, t + 0.33, N.C6, 0.8, 0.22);
    tone(ac, o, t + 0.33, N.C5, 0.8, 0.12, 'sine');
  },
  lose: (ac, o, t) => {
    tone(ac, o, t, N.G4, 0.35, 0.22, 'sine');
    tone(ac, o, t + 0.2, N.Eb4, 0.35, 0.22, 'sine');
    tone(ac, o, t + 0.4, N.C4, 0.8, 0.24, 'sine');
  },
  draw: (ac, o, t) => {
    tone(ac, o, t, N.E5, 0.3, 0.18, 'sine');
    tone(ac, o, t + 0.18, N.C5, 0.6, 0.18, 'sine');
  },
  levelUp: (ac, o, t) => {
    arpeggio(ac, o, t, [N.C6, N.E6, N.G6, N.C7], 0.07, 0.25, 0.13);
    for (const f of [N.C6, N.E6, N.G6]) tone(ac, o, t + 0.3, f, 0.9, 0.08, 'sine');
  },
};

/** Play a sound now (or after `delayMs`) if sound is on, at the volume in Settings. */
export function playSound(id: SoundId, delayMs = 0): void {
  const { sound, volume } = useSettings.getState().settings;
  if (!sound || volume <= 0) return;
  const ac = context();
  if (!ac || !master) return;
  // Squared for a more even loudness curve across the slider.
  master.gain.setValueAtTime(volume * volume, ac.currentTime);
  VOICES[id](ac, master, ac.currentTime + 0.005 + delayMs / 1000);
  document.documentElement.dataset.sound = id;
}

/** Move, capture, check… on every move of the live game, and the result sound when it ends. */
export function wireSounds(): () => void {
  return useGameStore.subscribe((s, prev) => {
    // A new or restored game replaces the history wholesale: nothing to play.
    if (s.startedAt !== prev.startedAt || s.status === 'idle') return;
    const last = s.history[s.history.length - 1];
    const moved = !!last && s.history.length === prev.history.length + 1;
    if (moved) playSound(moveSound(last));
    if (s.status === 'over' && prev.status === 'playing' && s.result) {
      const human =
        s.settings?.mode === 'pvai'
          ? (s.settings.humanColor ?? null)
          : (s.settings?.online?.color ?? null);
      playSound(endSound(s.result, human), moved ? 250 : 0);
    }
  });
}
