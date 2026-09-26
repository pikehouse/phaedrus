import { useEffect, useRef, type ReactNode } from 'react';
import { mulberry } from './DeckSignal';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════════════════════
   THE COMB

   A long black window holding a dense comb of thin filaments, each lit in
   its place along the spectrum: white-hot where it stands on the base, with
   a small soft flare at the foot like a flame at its wick, taking its colour
   as it climbs and fading out towards the tip. A faint haze hangs around
   each one, so the comb reads as light in glass and not as lines on paper.

   There is no audio, so the heights are synthesised and seeded from the
   track: a few broad spectral lobes that wander, a slow sectional swell, a
   per-filament voice with gentle noise, and a very soft pulse. Filaments
   rise slowly and trickle back down each at its own rate; peak holds hang
   as small bright points and then drift. With a record loaded and stopped
   the instrument stays on: every filament keeps a low resting glow.

   Three other surfaces take their light from the same frame:
   - the spill, one pixel per filament, stretched and blurred by CSS across
     the instrument's black face above and below the window;
   - the floor, which draws a colour wash from the spill and then the comb
     itself flipped and foreshortened, at a quarter of the vertical
     resolution so that it smears into streaks, as on gloss.

   One rAF loop at ~30fps; React never hears about a frame. The loop parks
   once paused and settled at the resting glow, while the page is hidden,
   and on unmount; with reduced motion one still frame is painted.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX = 180;
const FRAME_MS = 33;
const TAU = Math.PI * 2;
const ATTACK_S = 1.8; // silence → full programme when play starts
const RELEASE_S = 1.6; // full → resting glow when it stops; the filaments then trickle
const RISE = 2.2; // 1/s, eased toward target
const PEAK_HOLD_S = 0.9;
const PEAK_FALL = 0.07; // full scale per second
const REST = 0.05; // the resting glow with a record loaded …
const REST_VARY = 0.07; // … shaped a little by the record's own lobes
const PILOT = 0.3; // with nothing on, the rest dims to this share of itself

type Rgb = [number, number, number];

const STOPS: Rgb[] = [
  [0xff, 0x5a, 0x2a],
  [0xff, 0xb1, 0x3b],
  [0x43, 0xd8, 0x6a],
  [0x1f, 0xa6, 0xb8],
  [0x6a, 0x5e, 0xe0],
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
  /** What stands on the floor: the controls sit on the gloss, over the reflection. */
  children?: ReactNode;
}

export default function PrismComb({ seed, playing, loaded, rooms, more, children }: Props) {
  const combRef = useRef<HTMLCanvasElement>(null);
  const spillRef = useRef<HTMLCanvasElement>(null);
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
    const spill = spillRef.current;
    const floor = floorRef.current;
    const ctx = comb?.getContext('2d');
    const sctx = spill?.getContext('2d');
    const fctx = floor?.getContext('2d');
    if (!comb || !spill || !floor || !ctx || !sctx || !fctx) return;

    const rnd = mulberry(seed);
    const voice = Array.from({ length: MAX }, () => ({
      w1: 0.22 + rnd() * 0.45,
      w2: 0.8 + rnd() * 0.9,
      p1: rnd() * TAU,
      p2: rnd() * TAU,
      // Neighbours never quite agree, so it reads as a comb and not a curve.
      jitter: 0.6 + rnd() * 0.52,
      fall: 0.08 + rnd() * 0.09,
      rest: rnd(),
    }));
    const lobes = Array.from({ length: 4 }, (_, k) => ({
      c: (k + 0.5) / 4 + (rnd() - 0.5) * 0.16,
      w: 0.08 + rnd() * 0.1,
      a: 0.55 + rnd() * 0.4,
      ws: 0.04 + rnd() * 0.05,
      wa: 0.05 + rnd() * 0.06,
      p: rnd() * TAU,
    }));
    const sectionW = TAU / (26 + rnd() * 22);
    const sectionP = rnd() * TAU;
    const beat = 60 / (72 + Math.floor(rnd() * 40));

    const b = bank.current;
    const { level, peak, hold, noise } = b;
    const floorOf = new Float32Array(MAX); // each filament's resting glow at full ember
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
    let hw = 0;
    let fw = 0;
    let fh = 0;
    let dot = 2;
    let xs = new Float32Array(MAX);
    let colours: Rgb[] = [];
    let tips: string[] = [];
    let spillImg: ImageData | null = null;
    let edges: CanvasGradient | string = '#000';
    const ground = document.createElement('canvas'); // grille, rails, hairline, ticks
    const lines = document.createElement('canvas'); // one full-height filament per column
    const haze = document.createElement('canvas'); // the soft light around each filament
    const flares = document.createElement('canvas'); // one foot flare per column

    const restShape = () => {
      for (let i = 0; i < n; i++) {
        const x = i / Math.max(1, n - 1);
        let s = 0;
        for (const lb of lobes) s += lb.a * Math.exp(-((x - lb.c) * (x - lb.c)) / (lb.w * lb.w * 2.2));
        floorOf[i] = REST + REST_VARY * Math.min(1, s) * (0.55 + 0.45 * voice[i].rest);
      }
    };

    const layout = (): boolean => {
      const cw = comb.clientWidth;
      const ch = comb.clientHeight;
      if (!cw || !ch) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = comb.width = Math.round(cw * dpr);
      H = comb.height = Math.round(ch * dpr);
      // Full width, a quarter of the height: the reflection smears downwards.
      floor.width = Math.max(1, Math.round(floor.clientWidth * 0.5));
      floor.height = Math.max(1, Math.round(floor.clientHeight * 0.25));

      n = cw < 430 ? Math.max(48, Math.round(cw / 5.2)) : Math.min(MAX, Math.max(120, Math.round(cw / 4.6)));
      const e = fctx.createLinearGradient(0, 0, floor.width, 0);
      e.addColorStop(0, 'rgba(0,0,0,0)');
      e.addColorStop(0.06, '#000');
      e.addColorStop(0.94, '#000');
      e.addColorStop(1, 'rgba(0,0,0,0)');
      edges = e;
      spill.width = n;
      spill.height = 1;
      spillImg = sctx.createImageData(n, 1);

      const margin = W * 0.03;
      const pitch = (W - margin * 2) / n;
      top = Math.round(6 * dpr);
      baseY = H - Math.round(9 * dpr);
      lw = Math.max(1, Math.round(1.15 * dpr));
      hw = Math.max(4, Math.round(pitch * 1.8));
      fw = Math.round(16 * dpr);
      fh = Math.round(26 * dpr);
      dot = Math.max(2, Math.round(1.6 * dpr));
      xs = Float32Array.from({ length: n }, (_, i) => margin + (i + 0.5) * pitch);
      colours = Array.from({ length: n }, (_, i) => spectrum(i / (n - 1)));
      tips = colours.map((c) => rgba(whiter(c, 0.45), 1));
      restShape();
      const maxH = baseY - top;
      const hair = Math.max(1, Math.round(dpr));

      ground.width = W;
      ground.height = H;
      const g = ground.getContext('2d')!;
      // A little depth in the glass: the window is darkest at its middle.
      const well = g.createLinearGradient(0, 0, 0, H);
      well.addColorStop(0, 'rgba(18, 17, 19, 0.9)');
      well.addColorStop(0.25, 'rgba(6, 6, 7, 0)');
      well.addColorStop(0.85, 'rgba(6, 6, 7, 0)');
      well.addColorStop(1, 'rgba(22, 20, 20, 0.7)');
      g.fillStyle = well;
      g.fillRect(0, 0, W, H);
      // The grille: a rod behind every filament, carried on past the lit span to both edges.
      g.fillStyle = 'rgba(233, 228, 222, 0.03)';
      for (let x = xs[0] - Math.ceil(xs[0] / pitch) * pitch; x < W; x += pitch) {
        g.fillRect(Math.round(x - hair / 2), top, hair, maxH);
      }
      // Light catching the top rail of the window.
      const rail = g.createLinearGradient(0, 0, W, 0);
      STOPS.forEach((c, i) => rail.addColorStop(i / (STOPS.length - 1), rgba(c, 0.14)));
      g.fillStyle = rail;
      g.fillRect(0, top - hair, W, hair);
      // The foot rail the filaments stand on.
      g.fillStyle = 'rgba(233, 228, 222, 0.08)';
      g.fillRect(0, baseY + 2 * hair, W, hair);
      // A hairline across the comb with a tick on every fourth filament, and a taller one every sixteenth.
      const y = Math.round(top + maxH * 0.3);
      g.fillStyle = 'rgba(233, 228, 222, 0.075)';
      g.fillRect(0, y, W, hair);
      for (let i = 1; i < n; i += 4) {
        const major = (i - 1) % 16 === 0;
        g.fillStyle = rgba(whiter(colours[i], 0.55), major ? 0.34 : 0.2);
        const h = (major ? 9 : 5) * hair;
        g.fillRect(Math.round(xs[i] - hair / 2), y - Math.round(h / 2), hair, h);
      }

      lines.width = n * lw;
      lines.height = maxH;
      const l = lines.getContext('2d')!;
      haze.width = n * hw;
      haze.height = maxH;
      const z = haze.getContext('2d')!;
      flares.width = n * fw;
      flares.height = fh;
      const f = flares.getContext('2d')!;
      const foot = fh * 0.78;
      for (let i = 0; i < n; i++) {
        const c = colours[i];
        // The filament: white-hot at the base, its colour through the middle, gone at the tip.
        const grad = l.createLinearGradient(0, maxH, 0, 0);
        grad.addColorStop(0, rgba(whiter(c, 0.9), 1));
        grad.addColorStop(0.07, rgba(whiter(c, 0.5), 1));
        grad.addColorStop(0.3, rgba(whiter(c, 0.14), 1));
        grad.addColorStop(0.6, rgba(c, 0.72));
        grad.addColorStop(1, rgba(c, 0));
        l.fillStyle = grad;
        l.fillRect(i * lw, 0, lw, maxH);

        // Its haze: a soft column, strongest low down.
        const hx = i * hw;
        const side = z.createLinearGradient(hx, 0, hx + hw, 0);
        side.addColorStop(0, rgba(c, 0));
        side.addColorStop(0.5, rgba(c, 1));
        side.addColorStop(1, rgba(c, 0));
        z.globalCompositeOperation = 'source-over';
        z.fillStyle = side;
        z.fillRect(hx, 0, hw, maxH);
        const fade = z.createLinearGradient(0, maxH, 0, 0);
        fade.addColorStop(0, 'rgba(0,0,0,0.5)');
        fade.addColorStop(0.3, 'rgba(0,0,0,0.22)');
        fade.addColorStop(1, 'rgba(0,0,0,0)');
        z.globalCompositeOperation = 'destination-in';
        z.fillStyle = fade;
        z.fillRect(hx, 0, hw, maxH);

        // The flare at the foot.
        const cx = i * fw + fw / 2;
        const glow = f.createRadialGradient(cx, foot, 0, cx, foot, fw / 2);
        glow.addColorStop(0, rgba(whiter(c, 0.55), 0.6));
        glow.addColorStop(0.3, rgba(whiter(c, 0.15), 0.2));
        glow.addColorStop(1, rgba(c, 0));
        f.fillStyle = glow;
        f.fillRect(i * fw, 0, fw, fh);
        // Where a filament meets the base it widens, like a flame at its wick.
        const taper = f.createLinearGradient(0, foot, 0, foot * 0.2);
        taper.addColorStop(0, rgba(whiter(c, 0.85), 0.95));
        taper.addColorStop(1, rgba(c, 0));
        f.fillStyle = taper;
        f.beginPath();
        f.moveTo(cx - 2.2 * dpr, foot);
        f.quadraticCurveTo(cx - 0.45 * dpr, foot * 0.72, cx - lw / 2, foot * 0.2);
        f.lineTo(cx + lw / 2, foot * 0.2);
        f.quadraticCurveTo(cx + 0.45 * dpr, foot * 0.72, cx + 2.2 * dpr, foot);
        f.closePath();
        f.fill();
      }
      z.globalCompositeOperation = 'source-over';
      return true;
    };

    const rest = () => PILOT + (1 - PILOT) * b.ember;

    const paint = () => {
      if (!W || !spillImg) return;
      const maxH = baseY - top;
      const r = rest();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(ground, 0, 0);

      ctx.globalCompositeOperation = 'lighter';
      // Haze first, so the filaments sit crisp inside their own light.
      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorOf[i] * r);
        const h = Math.min(maxH, v * maxH * 1.08);
        if (h < 1) continue;
        ctx.globalAlpha = Math.min(1, 0.3 + v * 1.2);
        ctx.drawImage(haze, i * hw, 0, hw, maxH, Math.round(xs[i] - hw / 2), baseY - h, hw, h);
      }
      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorOf[i] * r);
        const h = v * maxH;
        if (h < 1) continue;
        ctx.globalAlpha = 0.62 + 0.38 * Math.min(1, v * 1.8);
        ctx.drawImage(lines, i * lw, 0, lw, maxH, Math.round(xs[i] - lw / 2), baseY - h, lw, h);
      }
      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorOf[i] * r);
        if (v <= 0.002) continue;
        ctx.globalAlpha = Math.min(1, 0.28 + v * 1.3) * 0.8;
        ctx.drawImage(flares, i * fw, 0, fw, fh, Math.round(xs[i] - fw / 2), baseY - fh * 0.78, fw, fh);
      }

      // Peak holds: small bright points.
      for (let i = 0; i < n; i++) {
        const gap = peak[i] - level[i];
        if (gap <= 0.035) continue;
        ctx.globalAlpha = Math.min(1, peak[i] * 3) * Math.min(1, (gap - 0.035) * 12) * 0.6;
        ctx.fillStyle = tips[i];
        ctx.fillRect(Math.round(xs[i] - dot / 2), Math.round(baseY - peak[i] * maxH - dot / 2), dot, dot);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // The spill: one pixel per filament, as bright as it burns.
      const px = spillImg.data;
      for (let i = 0; i < n; i++) {
        const v = Math.max(level[i], floorOf[i] * r);
        const c = colours[i];
        const k = i * 4;
        px[k] = c[0];
        px[k + 1] = c[1];
        px[k + 2] = c[2];
        px[k + 3] = Math.round(255 * Math.min(1, 0.12 + v * 1.25));
      }
      sctx.putImageData(spillImg, 0, 0);

      // The floor: a wash of the spill, then the comb from its feet up,
      // flipped and foreshortened.
      const FW = floor.width;
      const FH = floor.height;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.globalCompositeOperation = 'source-over';
      fctx.globalAlpha = 1;
      fctx.clearRect(0, 0, FW, FH);
      fctx.globalAlpha = 0.22;
      fctx.drawImage(spill, 0, 0, n, 1, 0, 0, FW, FH);
      fctx.globalCompositeOperation = 'lighter';
      fctx.globalAlpha = 0.62;
      const d = Math.max(FH * 0.9, 1);
      fctx.setTransform(1, 0, 0, -1, 0, d);
      fctx.drawImage(comb, 0, top, W, baseY + Math.round(fh * 0.1) - top, 0, 0, FW, d);
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      // The gloss falls away at both ends of the instrument.
      fctx.globalCompositeOperation = 'destination-in';
      fctx.globalAlpha = 1;
      fctx.fillStyle = edges;
      fctx.fillRect(0, 0, FW, FH);
      fctx.globalCompositeOperation = 'source-over';
    };

    const advance = (dt: number) => {
      t += dt;
      b.gain = still ? 0.34 : play.current ? Math.min(1, b.gain + dt / ATTACK_S) : Math.max(0, b.gain - dt / RELEASE_S);
      const target = lit.current ? 1 : 0;
      b.ember += (target - b.ember) * Math.min(1, dt * 1.2);
      if (Math.abs(target - b.ember) < 0.01) b.ember = target;
      const r = rest();

      const section = 0.66 + 0.34 * (0.5 + 0.5 * Math.sin(t * sectionW + sectionP));
      const pulse = Math.exp(-((t % beat) / beat) * 3.2) * 0.1;

      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        const v = voice[i];
        let shape = 0.5;
        for (const lb of lobes) {
          const c = lb.c + Math.sin(t * lb.ws + lb.p) * 0.09;
          const w = lb.w * (1 + 0.3 * Math.sin(t * lb.wa + lb.p));
          shape += lb.a * Math.exp(-((x - c) * (x - c)) / (w * w));
        }
        noise[i] = noise[i] * 0.94 + (Math.random() - 0.5) * 0.08;
        const tone = 0.6 + Math.sin(t * v.w1 + v.p1) * 0.22 + Math.sin(t * v.w2 + v.p2) * 0.1 + noise[i];
        const raw = (shape * tone * section * v.jitter * 1.25 + pulse * shape) * b.gain;
        // A soft knee: loud passages crowd towards the top rather than pinning to it.
        const sung = Math.min(0.94, raw < 0.55 ? raw : 0.55 + (raw - 0.55) * 0.42);
        const goal = Math.max(floorOf[i] * r, sung);

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
      const r = rest();
      for (let i = 0; i < n; i++) {
        if (level[i] > floorOf[i] * r + 0.002 || peak[i] > level[i] + 0.004) return false;
      }
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
        const r = rest();
        for (let i = 0; i < n; i++) level[i] = peak[i] = floorOf[i] * r;
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
        <canvas className="pc-spill" ref={spillRef} />
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
      <div className="pf">
        <canvas className="pf-canvas" ref={floorRef} aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
