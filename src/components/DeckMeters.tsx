import { useEffect, useRef } from 'react';
import { useSonos } from '../store/useSonos';
import type { MemberVolume } from '../api/types';
import { mulberry, trackSeed } from './DeckSignal';

/* ══════════════════════════════════════════════════════════════════════════
   CHANNEL METERS

   One twelve-LED meter per room, sitting in that room's fader row on the
   mixer. There is no audio to meter, so the signal is synthesised the way
   TunerSpectrum does it — a shared programme envelope and beat, a voice per
   channel, low-passed noise — scaled by the room's own volume, silent when
   muted, and falling to nothing when playback stops.

   The fader rows belong to the shared faceplate, so this component draws
   nothing itself: one rAF loop at ~30fps writes `--lvl` (lit segments) and
   `--pk` (peak-hold segment) onto each row, and the skin's CSS paints the
   strip from those. React is never told about a frame.
   ══════════════════════════════════════════════════════════════════════════ */

const ROWS = 12;
const FRAME_MS = 33;
const ATTACK_S = 0.35;
const RELEASE_S = 0.9;
const PEAK_FALL = 0.6; // units of full scale per second

const NONE: MemberVolume[] = [];

export default function DeckMeters() {
  const state = useSonos((s) => s.state);
  const members = state?.members ?? NONE;
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const seed = trackSeed(state?.isRadio ? state.stationName : track?.title, track?.artist);
  // The rows are keyed by room, so a new room set means new elements.
  const roster = members.map((m) => m.uuid).join('|');

  const play = useRef(playing);
  const gains = useRef(new Float32Array(0));
  const wake = useRef<(() => void) | null>(null);

  // Volume and mute are read by the loop, never rebuilt into it: a fader
  // drag changes the level of a running meter, it does not restart the tune.
  useEffect(() => {
    gains.current = Float32Array.from(members, (m) => (m.muted ? 0 : Math.pow(m.volume / 100, 0.6)));
    wake.current?.();
  }, [members]);

  useEffect(() => {
    play.current = playing;
    wake.current?.();
  }, [playing]);

  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('.faceplate .fader')];
    const n = rows.length;
    if (n === 0) return;

    const rnd = mulberry(seed);
    const voice = Array.from({ length: n }, () => ({
      w1: 0.7 + rnd() * 0.9,
      w2: 2.1 + rnd() * 1.6,
      p1: rnd() * Math.PI * 2,
      p2: rnd() * Math.PI * 2,
    }));
    const beat = 60 / (86 + Math.floor(rnd() * 40));
    const swell = 0.45 + rnd() * 0.35;

    const noise = new Float32Array(n);
    const level = new Float32Array(n);
    const peak = new Float32Array(n);
    const litN = new Int16Array(n).fill(-1);
    const peakN = new Int16Array(n).fill(-2);
    let gain = play.current ? 1 : 0;
    let t = 0;
    let raf = 0;
    let last = 0;

    const paint = () => {
      for (let c = 0; c < n; c++) {
        const k = Math.round(level[c] * ROWS);
        if (k !== litN[c]) {
          rows[c].style.setProperty('--lvl', String(k));
          litN[c] = k;
        }
        const p = peak[c] > 0.03 ? Math.min(ROWS - 1, Math.max(0, Math.round(peak[c] * ROWS) - 1)) : -1;
        if (p !== peakN[c]) {
          rows[c].style.setProperty('--pk', String(p));
          peakN[c] = p;
        }
      }
    };

    const advance = (dt: number) => {
      t += dt;
      gain = play.current ? Math.min(1, gain + dt / ATTACK_S) : Math.max(0, gain - dt / RELEASE_S);
      const env = 0.72 + 0.28 * Math.sin(t * swell + 0.7);
      const kick = Math.exp(-((t % beat) / beat) * 7);
      for (let c = 0; c < n; c++) {
        const v = voice[c];
        noise[c] = noise[c] * 0.86 + (Math.random() - 0.5) * 0.26;
        const tone = 0.5 + Math.sin(t * v.w1 + v.p1) * 0.26 + Math.sin(t * v.w2 + v.p2) * 0.14 + noise[c] * 0.45;
        const target = Math.max(0, Math.min(1, (tone * env * 0.78 + kick * 0.36) * gain * (gains.current[c] ?? 0)));
        // Snaps up, sags down — LED meter ballistics.
        level[c] = target > level[c] ? target : level[c] + (target - level[c]) * Math.min(1, dt * 8);
        peak[c] = level[c] > peak[c] ? level[c] : Math.max(0, peak[c] - dt * PEAK_FALL);
      }
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };

    const step = (ts: number) => {
      raf = requestAnimationFrame(step);
      if (!last) {
        last = ts;
        return;
      }
      const dt = ts - last;
      if (dt < FRAME_MS) return;
      last = ts;
      advance(Math.min(0.12, dt / 1000));
      paint();
      // Nothing moving and nothing to fall: give the frame budget back.
      if (!play.current && gain === 0 && peak.every((p) => p <= 0.03)) {
        level.fill(0);
        paint();
        stop();
      }
    };

    /* One frame on its own, then the loop if allowed — a meter mounted in a
       hidden tab must not be a dead strip the moment it is seen. */
    const nudge = () => {
      advance(0.05);
      paint();
      if (!raf && !document.hidden) raf = requestAnimationFrame(step);
    };

    const clear = () => {
      for (const row of rows) {
        row.style.removeProperty('--lvl');
        row.style.removeProperty('--pk');
      }
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gain = 0.34;
      advance(0.001);
      paint();
      return () => {
        wake.current = null;
        clear();
      };
    }

    wake.current = nudge;
    const onVisibility = () => (document.hidden ? stop() : nudge());
    document.addEventListener('visibilitychange', onVisibility);
    nudge();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      wake.current = null;
      clear();
    };
  }, [seed, roster]);

  return null;
}
