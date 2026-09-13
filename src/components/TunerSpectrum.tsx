import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import '../styles/tuner.css';

/* ══════════════════════════════════════════════════════════════════════════
   SPECTRUM ANALYZER

   There is no audio to analyze — Sonos hands us metadata, not samples. So the
   display is *synthesised*: per band, two slow sinusoids at incommensurable
   rates plus a low-passed noise term, tilted so bass runs hotter than treble,
   multiplied by a slow programme envelope and a per-beat kick. Everything is
   seeded from the track title, so a given track always "sounds" the same and
   two tracks never look alike.

   It runs on one rAF loop at ~30fps and writes classes straight onto the dot
   elements. React renders the grid once and is never told about a frame.
   ══════════════════════════════════════════════════════════════════════════ */

const FRAME_MS = 33;
const ATTACK_S = 0.45; // silence → full, when play starts
const RELEASE_S = 1.2; // full → silence, when it stops
const PEAK_FALL = 0.55; // peak-hold decay, units of full scale per second

/** Small deterministic PRNG so a title always produces the same instrument. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Props {
  /** Hash of the current track — the instrument's fingerprint. */
  seed: number;
  playing: boolean;
  bands?: number;
  rows?: number;
  className?: string;
}

export default function TunerSpectrum({
  seed,
  playing,
  bands = 14,
  rows = 12,
  className,
}: Props) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const play = useRef(playing);
  const wake = useRef<(() => void) | null>(null);

  const grid = useMemo(
    () =>
      Array.from({ length: bands }, (_, b) => (
        <span className="tsp-band" key={b}>
          {Array.from({ length: rows }, (_, r) => (
            <span className="tsp-dot" key={r} />
          ))}
        </span>
      )),
    [bands, rows],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const cols = [...el.querySelectorAll<HTMLElement>('.tsp-band')].map((c) => [
      ...c.querySelectorAll<HTMLElement>('.tsp-dot'),
    ]);
    if (cols.length === 0) return;

    const rnd = mulberry(seed || 0x9e3779b9);
    const voice = Array.from({ length: bands }, (_, b) => ({
      w1: 0.6 + rnd() * 0.9 + b * 0.05,
      w2: 1.9 + rnd() * 1.8,
      p1: rnd() * Math.PI * 2,
      p2: rnd() * Math.PI * 2,
      // A shelf, not a ramp: the bottom three bands stay hot, the top rolls off.
      tilt: 1 - 0.46 * Math.pow(b / Math.max(1, bands - 1), 0.8),
    }));
    const beat = 60 / (84 + Math.floor(rnd() * 44)); // seconds per beat
    const swell = 0.5 + rnd() * 0.35; // rad/s of the programme envelope

    const noise = new Float32Array(bands);
    const level = new Float32Array(bands);
    const peak = new Float32Array(bands);
    const litN = new Int16Array(bands);
    const peakN = new Int16Array(bands).fill(-1);
    let gain = play.current ? 1 : 0;
    let t = 0;
    let raf = 0;
    let last = 0;

    const paint = () => {
      for (let b = 0; b < bands; b++) {
        const col = cols[b];
        const n = Math.round(level[b] * rows);
        if (n !== litN[b]) {
          const lo = Math.min(litN[b], n);
          const hi = Math.max(litN[b], n);
          for (let r = lo; r < hi; r++) col[rows - 1 - r]?.classList.toggle('is-on', r < n);
          litN[b] = n;
        }
        const p = peak[b] > 0.02 ? Math.min(rows - 1, Math.max(0, Math.round(peak[b] * rows) - 1)) : -1;
        if (p !== peakN[b]) {
          if (peakN[b] >= 0) col[rows - 1 - peakN[b]]?.classList.remove('is-peak');
          if (p >= 0) col[rows - 1 - p]?.classList.add('is-peak');
          peakN[b] = p;
        }
      }
    };

    /** One 30fps update of the synthetic signal. */
    const advance = (dt: number) => {
      t += dt;
      gain = play.current
        ? Math.min(1, gain + dt / ATTACK_S)
        : Math.max(0, gain - dt / RELEASE_S);

      const env = 0.74 + 0.26 * Math.sin(t * swell + 0.7);
      const phase = (t % beat) / beat;
      const kick = Math.exp(-phase * 6);

      for (let b = 0; b < bands; b++) {
        const v = voice[b];
        noise[b] = noise[b] * 0.88 + (Math.random() - 0.5) * 0.24;
        const tone =
          0.46 + Math.sin(t * v.w1 + v.p1) * 0.34 + Math.sin(t * v.w2 + v.p2) * 0.17 + noise[b] * 0.5;
        const thump = kick * (b < bands * 0.28 ? 0.36 : b < bands * 0.55 ? 0.13 : 0.03);
        const target = Math.max(0, Math.min(1, (tone * v.tilt * env + thump) * gain));
        // Bars snap up and sag down — the ballistics of a real LED meter.
        level[b] = target > level[b] ? target : level[b] + (target - level[b]) * Math.min(1, dt * 7);
        peak[b] = level[b] > peak[b] ? level[b] : Math.max(0, peak[b] - dt * PEAK_FALL);
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
      // Nothing is moving and nothing will: give the frame budget back.
      if (!play.current && gain === 0 && peak.every((p) => p <= 0.02)) {
        level.fill(0);
        paint();
        stop();
      }
    };

    /* Paint one frame, then run if we are allowed to. The frame matters on its
       own: a hidden tab gets no rAF at all, so without it a display that was
       mounted in the background would be a dead grid the moment it is seen. */
    const nudge = () => {
      advance(0.05);
      paint();
      if (!raf && !document.hidden) raf = requestAnimationFrame(step);
    };

    if (reduced) {
      // Frozen at a low, plausible pattern — lit, but never moving.
      gain = 0.34;
      advance(0.001);
      paint();
      return () => {
        wake.current = null;
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
    };
  }, [bands, rows, seed, reduced]);

  // Play/pause only nudges the loop; it never rebuilds it, so the synthesised
  // programme keeps its phase across a pause instead of restarting.
  useEffect(() => {
    play.current = playing;
    wake.current?.();
  }, [playing]);

  return (
    <div className={`tsp${className ? ` ${className}` : ''}`} ref={host} aria-hidden="true">
      {grid}
    </div>
  );
}
