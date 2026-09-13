import { useEffect, useRef } from 'react';
import { mulberry } from './DeckSignal';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════════════════════
   THE COMB

   A long black window holding a comb of thin filaments, each lit in its
   place along the spectrum, brightest where it stands on the base and
   fading out towards its tip, with a small soft flare at the foot. There is
   no audio, so the heights are synthesised and seeded from the track: a few
   broad spectral lobes that wander, a slow sectional swell, a per-filament
   voice with gentle noise, and a very soft pulse. Filaments rise slowly and
   trickle back down each at its own rate; peak holds hang and then drift.

   One canvas draws the frame, and the glossy floor under the instrument
   draws that same canvas again, flipped and squashed, at half resolution —
   CSS blurs and fades it. One rAF loop at ~30fps; React never hears about a
   frame. The loop parks once paused and settled, while the page is hidden,
   and on unmount; with reduced motion one low still frame is painted.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX = 96;
const FRAME_MS = 33;
const TAU = Math.PI * 2;
const ATTACK_S = 1.8; // silence → full programme when play starts
const RELEASE_S = 1.4; // full → nothing when it stops; the filaments then trickle
const RISE = 2.2; // 1/s, eased toward target
const PEAK_HOLD_S = 0.9;
const PEAK_FALL = 0.08; // full scale per second
const EMBER = 0.035; // a pilot light at each foot while a record is loaded

type Rgb = [number, number, number];

const STOPS: Rgb[] = [
  [0xff, 0x5a, 0x2a],
  [0xff, 0xb1, 0x3b],
  [0x43, 0xd8, 0x6a],
  [0x1f, 0xa6, 0xb8],
  [0x5b, 0x5b, 0xd6],
  [0xe0, 0x5a, 0xa8],
  [0xea, 0xf2, 0xff],
  [0xff, 0x7a, 0x5c],
];

function spectrum(x: number): Rgb {
  const p = Math.max(0, Math.min(1, x)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(p));
  const f = p - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const whiter = (c: Rgb, k: number): Rgb => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
const rgba = (c: Rgb, a: number) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

interface Props {
  seed: number;
  playing: boolean;
  loaded: boolean;
  rooms: number;
  more: boolean;
}

export default function PrismComb({ seed, playing, loaded, rooms, more }: Props) {
  const combRef = useRef<HTMLCanvasElement>(null);
  const floorRef = useRef<HTMLCanvasElement>(null);
  const play = useRef(playing);
  const lit = useRef(loaded);
  const wake = useRef<(() => void) | null>(null);
  const still = useReducedMotion();

  // The levels outlive the voices: a new track changes the tune, it does not
  // drop every filament to nothing first.
  const bank = useRef({
    level: new Float32Array(MAX),
    peak: new Float32Array(MAX),
    hold: new Float32Array(MAX),
    noise: new Float32Array(MAX),
    gain: playing ? 1 : 0,
    ember: loaded ? 1 : 0,
  });

  useEffect(() => {
    play.current = playing;
    lit.current = loaded;
    wake.current?.();
  }, [playing, loaded]);

  useEffect(() => {
    const comb = combRef.current;
    const floor = floorRef.current;
    const ctx = comb?.getContext('2d');
    const fctx = floor?.getContext('2d');
    if (!comb || !floor || !ctx || !fctx) return;

    const rnd = mulberry(seed);
    const voice = Array.from({ length: MAX }, () => ({
      w1: 0.22 + rnd() * 0.45,
      w2: 0.8 + rnd() * 0.9,
      p1: rnd() * TAU,
      p2: rnd() * TAU,
      // Neighbours never quite agree, so it reads as a comb and not a curve.
      jitter: 0.62 + rnd() * 0.5,
      fall: 0.09 + rnd() * 0.09,
    }));
    const lobes = Array.from({ length: 3 }, (_, k) => ({
      c: (k + 0.5) / 3 + (rnd() - 0.5) * 0.18,
      w: 0.1 + rnd() * 0.12,
      a: 0.7 + rnd() * 0.4,
      ws: 0.04 + rnd() * 0.05,
      wa: 0.05 + rnd() * 0.06,
      p: rnd() * TAU,
    }));
    const sectionW = TAU / (26 + rnd() * 22);
    const sectionP = rnd() * TAU;
    const beat = 60 / (72 + Math.floor(rnd() * 40));

    const b = bank.current;
    const { level, peak, hold, noise } = b;
    let t = rnd() * 100;
    let raf = 0;
    let last = 0;

    // Geometry in device pixels, rebuilt on resize.
    let n = MAX;
    let W = 0;
    let H = 0;
    let top = 0;
    let baseY = 0;
    let lw = 2;
    let fw = 0;
    let fh = 0;
    let xs = new Float32Array(MAX);
    let tips: string[] = [];
    const ground = document.createElement('canvas'); // grille, hairline, ticks
    const lines = document.createElement('canvas'); // one full-height filament per column
    const flares = document.createElement('canvas'); // one foot flare per column

    const layout = (): boolean => {
      const cw = comb.clientWidth;
      const ch = comb.clientHeight;
      if (!cw || !ch) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = comb.width = Math.round(cw * dpr);
      H = comb.height = Math.round(ch * dpr);
      floor.width = Math.max(1, Math.round(floor.clientWidth * 0.5));
      floor.height = Math.max(1, Math.round(floor.clientHeight * 0.5));

      n = cw < 430 ? 48 : MAX;
      const margin = W * 0.035;
      const pitch = (W - margin * 2) / n;
      top = Math.round(5 * dpr);
      baseY = H - Math.round(7 * dpr);
      lw = Math.max(2, Math.round(1.6 * dpr));
      fw = Math.round(14 * dpr);
      fh = Math.round(18 * dpr);
      xs = Float32Array.from({ length: n }, (_, i) => margin + (i + 0.5) * pitch);
      const colours = Array.from({ length: n }, (_, i) => spectrum(i / (n - 1)));
      tips = colours.map((c) => rgba(whiter(c, 0.3), 1));
      const maxH = baseY - top;
      const hair = Math.max(1, Math.round(dpr));

      ground.width = W;
      ground.height = H;
      const g = ground.getContext('2d')!;
      // The grille: a rod behind every filament, carried on past the lit span to both edges.
      g.fillStyle = 'rgba(233, 228, 222, 0.045)';
      for (let x = xs[0] - Math.ceil(xs[0] / pitch) * pitch; x < W; x += pitch) {
        g.fillRect(Math.round(x - hair / 2), top, hair, maxH);
      }
      // Light catching the top rail of the window.
      const rail = g.createLinearGradient(0, 0, W, 0);
      STOPS.forEach((c, i) => rail.addColorStop(i / (STOPS.length - 1), rgba(c, 0.1)));
      g.fillStyle = rail;
      g.fillRect(0, top - hair, W, hair);
      // The foot rail the filaments stand on.
      g.fillStyle = 'rgba(233, 228, 222, 0.05)';
      g.fillRect(0, baseY + hair, W, hair);
      // A hairline across the comb with a tick on every fourth filament.
      const y = Math.round(top + maxH * 0.35);
      g.fillStyle = 'rgba(233, 228, 222, 0.07)';
      g.fillRect(0, y, W, hair);
      for (let i = 1; i < n; i += 4) {
        g.fillStyle = rgba(whiter(colours[i], 0.5), 0.2);
        g.fillRect(Math.round(xs[i] - hair / 2), y - 2 * hair, hair, 5 * hair);
      }

      lines.width = n * lw;
      lines.height = maxH;
      const l = lines.getContext('2d')!;
      flares.width = n * fw;
      flares.height = fh;
      const f = flares.getContext('2d')!;
      const foot = fh * 0.8;
      for (let i = 0; i < n; i++) {
        const c = colours[i];
        const grad = l.createLinearGradient(0, maxH, 0, 0);
        grad.addColorStop(0, rgba(whiter(c, 0.55), 1));
        grad.addColorStop(0.1, rgba(whiter(c, 0.2), 0.92));
        grad.addColorStop(0.45, rgba(c, 0.5));
        grad.addColorStop(1, rgba(c, 0));
        l.fillStyle = grad;
        l.fillRect(i * lw, 0, lw, maxH);

        const cx = i * fw + fw / 2;
        const glow = f.createRadialGradient(cx, foot, 0, cx, foot, fw / 2);
        glow.addColorStop(0, rgba(whiter(c, 0.4), 0.45));
        glow.addColorStop(0.35, rgba(c, 0.14));
        glow.addColorStop(1, rgba(c, 0));
        f.fillStyle = glow;
        f.fillRect(i * fw, 0, fw, fh);
        // Where a filament meets the base it widens, like a flame at its wick.
        const taper = f.createLinearGradient(0, foot, 0, foot * 0.25);
        taper.addColorStop(0, rgba(whiter(c, 0.6), 0.85));
        taper.addColorStop(1, rgba(c, 0));
        f.fillStyle = taper;
        f.beginPath();
        f.moveTo(cx - 2.4 * dpr, foot);
        f.quadraticCurveTo(cx - 0.5 * dpr, foot * 0.7, cx - lw / 2, foot * 0.25);
        f.lineTo(cx + lw / 2, foot * 0.25);
        f.quadraticCurveTo(cx + 0.5 * dpr, foot * 0.7, cx + 2.4 * dpr, foot);
        f.closePath();
        f.fill();
      }
      return true;
    };

    const paint = () => {
      if (!W) return;
      const maxH = baseY - top;
      const floorLevel = b.ember * EMBER;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(ground, 0, 0);

      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorLevel);
        const h = v * maxH;
        if (h < 1) continue;
        ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, v * 1.4);
        ctx.drawImage(lines, i * lw, 0, lw, maxH, Math.round(xs[i] - lw / 2), baseY - h, lw, h);
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorLevel);
        if (v <= 0.002) continue;
        ctx.globalAlpha = Math.min(1, 0.2 + v * 1.1) * 0.55;
        ctx.drawImage(flares, i * fw, 0, fw, fh, Math.round(xs[i] - fw / 2), baseY - fh * 0.8, fw, fh);
      }
      ctx.globalCompositeOperation = 'source-over';

      const tick = Math.max(2, Math.round(lw * 0.75));
      for (let i = 0; i < n; i++) {
        if (peak[i] <= level[i] + 0.03) continue;
        ctx.globalAlpha = 0.5 * Math.min(1, peak[i] * 3);
        ctx.fillStyle = tips[i];
        ctx.fillRect(Math.round(xs[i] - lw / 2), Math.round(baseY - peak[i] * maxH), lw, tick);
      }
      ctx.globalAlpha = 1;

      // The reflection: the comb from its feet up, flipped and foreshortened.
      const FW = floor.width;
      const FH = floor.height;
      const d = baseY * (FW / W) * 0.7;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, FW, FH);
      fctx.setTransform(1, 0, 0, -1, 0, d);
      fctx.drawImage(comb, 0, 0, W, baseY, 0, 0, FW, d);
      fctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const advance = (dt: number) => {
      t += dt;
      b.gain = still ? 0.32 : play.current ? Math.min(1, b.gain + dt / ATTACK_S) : Math.max(0, b.gain - dt / RELEASE_S);
      const target = lit.current ? 1 : 0;
      b.ember += (target - b.ember) * Math.min(1, dt * 1.2);
      if (Math.abs(target - b.ember) < 0.01) b.ember = target;

      const section = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * sectionW + sectionP));
      const pulse = Math.exp(-((t % beat) / beat) * 3.2) * 0.1;

      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        const v = voice[i];
        let shape = 0.2;
        for (const lb of lobes) {
          const c = lb.c + Math.sin(t * lb.ws + lb.p) * 0.09;
          const w = lb.w * (1 + 0.3 * Math.sin(t * lb.wa + lb.p));
          shape += lb.a * Math.exp(-((x - c) * (x - c)) / (w * w));
        }
        noise[i] = noise[i] * 0.94 + (Math.random() - 0.5) * 0.08;
        const tone = 0.6 + Math.sin(t * v.w1 + v.p1) * 0.22 + Math.sin(t * v.w2 + v.p2) * 0.1 + noise[i];
        const goal = Math.max(0, Math.min(1, (shape * tone * section * v.jitter * 0.95 + pulse * shape) * b.gain));

        // A slow rise; a trickle back down, each filament at its own rate.
        if (goal > level[i]) level[i] += (goal - level[i]) * Math.min(1, dt * RISE);
        else level[i] = Math.max(goal, level[i] - dt * v.fall);

        if (level[i] >= peak[i]) {
          peak[i] = level[i];
          hold[i] = PEAK_HOLD_S;
        } else if (hold[i] > 0) {
          hold[i] -= dt;
        } else {
          peak[i] = Math.max(0, peak[i] - dt * PEAK_FALL);
        }
      }
    };

    const settled = () => {
      if (play.current || b.gain > 0 || b.ember !== (lit.current ? 1 : 0)) return false;
      for (let i = 0; i < n; i++) if (level[i] > 0.002 || peak[i] > 0.004) return false;
      return true;
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
      if (settled()) {
        level.fill(0);
        peak.fill(0);
        paint();
        stop();
      }
    };

    // One frame on its own, then the loop if allowed: a comb mounted in a
    // hidden window must not be a dead grille the moment it is seen.
    const nudge = () => {
      advance(1 / 30);
      paint();
      if (!raf && !document.hidden && !settled()) raf = requestAnimationFrame(step);
    };

    layout();
    const ro = new ResizeObserver(() => {
      if (layout()) paint();
    });
    ro.observe(comb);
    ro.observe(floor);

    if (still) {
      for (let k = 0; k < 90; k++) advance(1 / 30);
      peak.fill(0);
      paint();
      return () => ro.disconnect();
    }

    wake.current = nudge;
    const onVisibility = () => (document.hidden ? stop() : nudge());
    document.addEventListener('visibilitychange', onVisibility);
    nudge();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      wake.current = null;
    };
  }, [seed, still]);

  return (
    <>
      <div className="pc" aria-hidden="true">
        <div className="pc-window">
          <canvas className="pc-canvas" ref={combRef} />
        </div>
        <div className="pc-rail">
          <i className={`pc-led pc-led-play${playing ? ' is-on' : ''}`} />
          <span className="pc-rooms">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} className={`pc-led pc-led-room${i < rooms ? ' is-on' : ''}`} />
            ))}
          </span>
          <i className={`pc-led pc-led-more${more ? ' is-on' : ''}`} />
        </div>
      </div>
      <div className="pf" aria-hidden="true">
        <canvas className="pf-canvas" ref={floorRef} />
      </div>
    </>
  );
}
