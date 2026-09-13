import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { averageColor } from '../lib/color';

/* ══════════════════════════════════════════════════════════════════════════
   THE WALL

   A spectrum thrown on a dark warm wall: broad soft bands, a strong set on
   the left and a fainter second set on the right, as light through a prism
   splits and overlaps. Pure CSS — each band is a soft horizontal gradient
   screened onto the wall, breathing on its own slow cycle, the whole cast
   drifting sideways over minutes.

   The cover tints it. The left and right halves of the sleeve are sampled
   and mixed a little into the bands on that side, and a vivid sleeve lifts
   the whole cast a touch, so every record throws a slightly different
   light. The mix, the lift and a per-track sideways offset are registered
   custom properties, so a new record crossfades its light instead of
   switching it.
   ══════════════════════════════════════════════════════════════════════════ */

type Rgb = [number, number, number];

interface Band {
  /** Left edge and width, in % of the wall. */
  x: number;
  w: number;
  c: string;
  /** Peak opacity. */
  a: number;
  side: 'l' | 'r';
  /** Breathing cycle and phase, in seconds. */
  d: number;
  p: number;
}

const BANDS: Band[] = [
  { x: 16, w: 12, c: '#ff5a2a', a: 0.7, side: 'l', d: 41, p: -7 },
  { x: 21.5, w: 7, c: '#ffb13b', a: 0.46, side: 'l', d: 53, p: -19 },
  { x: 26.5, w: 5.5, c: '#43d86a', a: 0.62, side: 'l', d: 47, p: -3 },
  { x: 30.5, w: 10, c: '#3a44b4', a: 0.4, side: 'l', d: 59, p: -31 },
  { x: 47.5, w: 7, c: '#b8323c', a: 0.28, side: 'r', d: 44, p: -11 },
  { x: 52.5, w: 5.5, c: '#5b5bd6', a: 0.38, side: 'r', d: 62, p: -23 },
  { x: 56.5, w: 12, c: '#1fa6b8', a: 0.54, side: 'r', d: 50, p: -37 },
  { x: 66.5, w: 6, c: '#62c08c', a: 0.22, side: 'r', d: 57, p: -5 },
  { x: 77.5, w: 9, c: '#e05aa8', a: 0.36, side: 'r', d: 48, p: -29 },
];

/** How much of the sleeve gets into the light: a grey sleeve would only wash the colours out. */
function mix(c: Rgb): string {
  const max = Math.max(...c);
  const sat = max > 0 ? (max - Math.min(...c)) / max : 0;
  return `${Math.round(Math.max(6, Math.min(26, sat * 60)))}%`;
}

interface Props {
  art?: string;
  seed: number;
  playing: boolean;
  idle: boolean;
  children: ReactNode;
}

export default function PrismWall({ art, seed, playing, idle, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.style.setProperty('--pw-shift', `${(((seed % 997) / 997) - 0.5) * 5}%`);
  }, [seed]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!art) {
      untint(el);
      return;
    }
    let live = true;
    void Promise.all([averageColor(art), sideColours(art)]).then(([avg, sides]) => {
      if (!live) return;
      const whole = parseRgb(avg);
      const l = hue(sides?.[0] ?? whole);
      const r = hue(sides?.[1] ?? whole);
      if (!whole || !l || !r) {
        untint(el);
        return;
      }
      el.style.setProperty('--pw-l', l);
      el.style.setProperty('--pw-r', r);
      el.style.setProperty('--pw-mix', mix(whole));
      el.style.setProperty('--pw-lift', String(lift(whole)));
    });
    return () => {
      live = false;
    };
  }, [art]);

  // CSS animations are cheap, but a hidden window should cost nothing at all.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onVisibility = () => el.toggleAttribute('data-hidden', document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div ref={ref} className={`pw${playing ? '' : ' is-paused'}${idle ? ' is-idle' : ''}`}>
      <div className="pw-cast" aria-hidden="true">
        <div className="pw-drift">
          {BANDS.map((b, i) => (
            <i
              key={i}
              className="pw-band"
              style={
                {
                  '--x': `${b.x}%`,
                  '--w': `${b.w}%`,
                  '--c': b.c,
                  '--a': b.a,
                  '--d': `${b.d}s`,
                  '--p': `${b.p}s`,
                  '--tint': b.side === 'l' ? 'var(--pw-l)' : 'var(--pw-r)',
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
      <div className="pw-head">{children}</div>
    </div>
  );
}

function untint(el: HTMLElement) {
  el.style.setProperty('--pw-mix', '0%');
  el.style.setProperty('--pw-lift', '1');
}

function parseRgb(css: string | null): Rgb | null {
  const m = css?.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Hue and saturation only: a dark sleeve should tint the light, not darken it. */
function hue(c: Rgb | null): string | null {
  if (!c) return null;
  const max = Math.max(...c);
  if (max < 10) return null;
  const k = 255 / max;
  return `rgb(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)})`;
}

/** A vivid, bright sleeve throws a little more light; a grey one a little less. */
function lift(c: Rgb): number {
  const max = Math.max(...c);
  const min = Math.min(...c);
  const sat = max > 0 ? (max - min) / max : 0;
  return Math.max(0.85, Math.min(1.15, 0.86 + sat * 0.2 + (max / 255) * 0.1));
}

/** The mean colour of the left and right halves of the sleeve. */
function sideColours(url: string): Promise<[Rgb, Rgb] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const n = 8;
        const canvas = document.createElement('canvas');
        canvas.width = n;
        canvas.height = n;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) return resolve(null);
        g.drawImage(img, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        const sums: Rgb[] = [
          [0, 0, 0],
          [0, 0, 0],
        ];
        for (let i = 0; i < n * n; i++) {
          const s = sums[i % n < n / 2 ? 0 : 1];
          s[0] += d[i * 4];
          s[1] += d[i * 4 + 1];
          s[2] += d[i * 4 + 2];
        }
        const half = (n * n) / 2;
        resolve([sums[0].map((v) => v / half) as Rgb, sums[1].map((v) => v / half) as Rgb]);
      } catch {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}
