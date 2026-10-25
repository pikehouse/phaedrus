import { useEffect, useRef } from 'react';
import { Bitmap, LCD_W, LCD_H } from '../lib/pocketLcd';
import { STATUS_H } from '../lib/pocketScreens';
import { localPoint } from '../lib/localPoint';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET LCD — the liquid crystal

   Takes a 160 × 128 one-bit framebuffer and paints it the way a passive
   matrix panel looks under a macro lens:

     · every pixel is a square cell, with a hairline gap between cells that
       the crystal never darkens (so dark areas show a faint light grid);
     · the off cells are a shade darker than the gaps, so the grid is just
       visible on an empty screen;
     · each dark pixel throws a soft shadow down and to the right onto the
       reflector behind the glass;
     · pixels are slow: ink arrives in ~60 ms and leaves in ~200 ms, so a
       changed screen ghosts the old one for a moment.

   It is painted straight into ImageData at the canvas's real resolution
   (devicePixelRatio aware), so no smoothing ever blurs a pixel. Nothing runs
   while the screen is still: a draw happens when the stage asks for one, or
   when the screen itself said it would next change (a clock ticking over, a
   marquee stepping), and the ghosting loop parks the moment it settles.
   The tint, the backlight and the glass are CSS layers under and over it.
   ══════════════════════════════════════════════════════════════════════════ */

const INK = { r: 0x12, g: 0x1a, b: 0x22 };
const INK_A = 0.9; // a fully dark cell
const OFF_A = 0.04; // the faint tone of an undriven cell
const SHADOW_A = 0.17; // a pixel's shadow on the reflector
const GAP_KEEP = 0.28; // how much ink survives in the gap between cells
const RISE_MS = 34; // time constant of a pixel darkening
const FALL_MS = 70; // and of one clearing (≈ 200 ms to vanish)
const SLIDE_MS = 230;

export type Paint = (b: Bitmap, now: number) => number;

export interface Slide {
  key: string;
  dir: -1 | 0 | 1;
}

class Engine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private px: Uint32Array | null = null;
  private bw = 0;
  private bh = 0;
  private cellX = new Int32Array(0);
  private cellXs = new Int32Array(0);
  private wx = new Float32Array(0);
  private cellY = new Int32Array(0);
  private cellYs = new Int32Array(0);
  private wy = new Float32Array(0);

  private target = new Bitmap();
  private next = new Bitmap();
  private from = new Bitmap();
  private shown = new Float32Array(LCD_W * LCD_H);

  private raf = 0;
  private last = 0;
  private timer: number | undefined;
  private active = false;
  private ghosts = true;
  private slideDir: -1 | 0 | 1 = 0;
  private slideStart = 0;

  paint: Paint = () => Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(LCD_W, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(LCD_H, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.bw && h === this.bh) return;
    this.bw = w;
    this.bh = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    const axis = (size: number, cells: number) => {
      const s = size / cells;
      const gap = Math.max(0.55, s * 0.12); // backing pixels of gap
      const cell = new Int32Array(size);
      const wt = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        const c = Math.min(cells - 1, Math.floor((i + 0.5) / s));
        cell[i] = c;
        // How much of this backing pixel falls in the gap at the cell's far edge.
        const edge = (c + 1) * s;
        const overlap = Math.max(0, Math.min(i + 1, edge) - Math.max(i, edge - gap));
        wt[i] = 1 - overlap * (1 - GAP_KEEP);
      }
      return { cell, wt, s };
    };
    const ax = axis(w, LCD_W);
    const ay = axis(h, LCD_H);
    this.cellX = ax.cell;
    this.wx = ax.wt;
    this.cellY = ay.cell;
    this.wy = ay.wt;
    const ox = Math.max(1, Math.round(ax.s * 0.34));
    const oy = Math.max(1, Math.round(ay.s * 0.4));
    this.cellXs = new Int32Array(w).map((_, i) => (i - ox >= 0 ? ax.cell[i - ox] : -1));
    this.cellYs = new Int32Array(h).map((_, i) => (i - oy >= 0 ? ay.cell[i - oy] : -1));
    this.blit();
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (on) this.frame();
    else this.halt();
  }

  setGhosts(on: boolean) {
    this.ghosts = on;
  }

  /** Something the screen shows has changed. */
  request(dir: -1 | 0 | 1 = 0) {
    if (dir !== 0 && this.ghosts) {
      this.from.copyFrom(this.target);
      this.slideDir = dir;
      this.slideStart = performance.now();
    }
    this.frame();
  }

  destroy() {
    this.halt();
  }

  private halt() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  private frame = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = Date.now();
    let wake: number;
    const t = performance.now() - this.slideStart;
    if (this.slideDir !== 0 && t < SLIDE_MS) {
      this.next.clear();
      this.paint(this.next, now);
      this.compose(t / SLIDE_MS);
      wake = 16;
    } else {
      this.slideDir = 0;
      this.next.clear();
      wake = this.paint(this.next, now);
      this.target.copyFrom(this.next);
    }
    this.settle();
    if (this.active && Number.isFinite(wake)) {
      this.timer = window.setTimeout(this.frame, Math.max(16, wake));
    }
  };

  /** The outgoing screen slides off, the new one in; the title bar just changes. */
  private compose(p: number) {
    const e = 1 - Math.pow(1 - Math.min(1, p), 3);
    const off = Math.round(e * LCD_W);
    const d = this.slideDir;
    const tgt = this.target.data;
    const a = this.from.data;
    const b = this.next.data;
    for (let y = 0; y < LCD_H; y++) {
      const row = y * LCD_W;
      for (let x = 0; x < LCD_W; x++) {
        if (y < STATUS_H) {
          tgt[row + x] = b[row + x];
          continue;
        }
        // Pushing in (d = 1): content moves left; backing out: right.
        const sx = d > 0 ? x + off : x - off;
        if (sx >= 0 && sx < LCD_W) tgt[row + x] = a[row + sx];
        else {
          const nx = d > 0 ? sx - LCD_W : sx + LCD_W;
          tgt[row + x] = nx >= 0 && nx < LCD_W ? b[row + nx] : 0;
        }
      }
    }
  }

  /** Start the pixels drifting toward the target, or snap if ghosts are off. */
  private settle() {
    const s = this.shown;
    const t = this.target.data;
    let differs = false;
    for (let i = 0; i < s.length; i++)
      if (Math.abs(s[i] - t[i]) > 0.003) {
        differs = true;
        break;
      }
    if (!differs) return;
    if (!this.ghosts || !this.active) {
      for (let i = 0; i < s.length; i++) s[i] = t[i];
      this.blit();
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.ghost);
  }

  private ghost = (ts: number) => {
    const dt = this.last ? Math.min(64, ts - this.last) : 16;
    this.last = ts;
    const kr = 1 - Math.exp(-dt / RISE_MS);
    const kf = 1 - Math.exp(-dt / FALL_MS);
    const s = this.shown;
    const t = this.target.data;
    let busy = false;
    for (let i = 0; i < s.length; i++) {
      const goal = t[i];
      const v = s[i];
      if (v === goal) continue;
      const nv = goal > v ? v + (goal - v) * kr : v - (v - goal) * kf;
      if (Math.abs(nv - goal) < 0.02) s[i] = goal;
      else {
        s[i] = nv;
        busy = true;
      }
    }
    this.blit();
    if (busy && this.active) this.raf = requestAnimationFrame(this.ghost);
    else {
      this.raf = 0;
      this.last = 0;
      if (!busy) return;
      for (let i = 0; i < s.length; i++) s[i] = t[i];
      this.blit();
    }
  };

  /** Paint `shown` into the canvas at full resolution. */
  private blit() {
    const px = this.px;
    const img = this.img;
    if (!px || !img) return;
    const { bw, bh, cellX, cellXs, wx, cellY, cellYs, wy, shown } = this;
    const rgb = (INK.b << 16) | (INK.g << 8) | INK.r;
    let p = 0;
    for (let y = 0; y < bh; y++) {
      const row = cellY[y] * LCD_W;
      const rowS = cellYs[y] >= 0 ? cellYs[y] * LCD_W : -1;
      const wyv = wy[y];
      for (let x = 0; x < bw; x++, p++) {
        const w = wx[x] * wyv;
        const ink = shown[row + cellX[x]];
        const a1 = (ink * INK_A + OFF_A * (1 - ink)) * w;
        const xs = cellXs[x];
        const sh = rowS >= 0 && xs >= 0 ? shown[rowS + xs] * SHADOW_A : 0;
        const a = a1 + sh * (1 - a1);
        px[p] = (((a * 255 + 0.5) | 0) << 24) | rgb;
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }
}

export default function PocketLcd({
  paint,
  slide,
  active,
  ghosts,
  onTap,
  className,
}: {
  paint: Paint;
  slide: Slide;
  active: boolean;
  ghosts: boolean;
  onTap?: (x: number, y: number) => void;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const slideKey = useRef(slide.key);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    const e = new Engine(el);
    engine.current = e;
    e.resize();
    const ro = new ResizeObserver(() => {
      e.resize();
      e.request();
    });
    ro.observe(el);
    const onDpr = () => {
      e.resize();
      e.request();
    };
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', onDpr);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', onDpr);
      e.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setGhosts(ghosts);
  }, [ghosts]);

  useEffect(() => {
    engine.current?.setActive(active);
  }, [active]);

  // Every new paint (the stage re-rendered) is a request to draw; a new
  // screen key slides.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.paint = paint;
    const moved = slide.key !== slideKey.current;
    slideKey.current = slide.key;
    e.request(moved ? slide.dir : 0);
  }, [paint, slide.key, slide.dir]);

  return (
    <canvas
      ref={canvas}
      className={className}
      aria-hidden="true"
      onPointerDown={(ev) => {
        down.current = { x: ev.clientX, y: ev.clientY };
      }}
      onPointerUp={(ev) => {
        const d = down.current;
        down.current = null;
        if (!d || !onTap || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8) return;
        const p = localPoint(ev.currentTarget, ev.clientX, ev.clientY); // tilt-proof
        onTap((p.x / p.width) * LCD_W, (p.y / p.height) * LCD_H);
      }}
    />
  );
}
