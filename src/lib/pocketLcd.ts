import { layout, measure, type Face, type TextOpts } from './pocketFont';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET LCD — the framebuffer

   The screen is 160 × 128 one-bit pixels, the size of the panels in the
   players the skin remembers. Everything on it is drawn into a Bitmap with
   these few primitives (no anti-aliasing anywhere: a pixel is ink or it is
   not) and handed to PocketLcd, which turns it into liquid crystal.
   ══════════════════════════════════════════════════════════════════════════ */

export const LCD_W = 160;
export const LCD_H = 128;

/** 1 = ink, 0 = paper; 2 is ink drawn at half strength (a 50% dither). */
export type Ink = 0 | 1 | 2;

interface Clip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Bitmap {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  private clip: Clip;

  constructor(w = LCD_W, h = LCD_H) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
    this.clip = { x0: 0, y0: 0, x1: w, y1: h };
  }

  clear() {
    this.data.fill(0);
  }

  copyFrom(other: Bitmap) {
    this.data.set(other.data);
  }

  equals(other: Bitmap): boolean {
    const a = this.data;
    const b = other.data;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Draw only inside the box for the duration of `fn`. */
  clipped(x: number, y: number, w: number, h: number, fn: () => void) {
    const saved = this.clip;
    this.clip = {
      x0: Math.max(saved.x0, x),
      y0: Math.max(saved.y0, y),
      x1: Math.min(saved.x1, x + w),
      y1: Math.min(saved.y1, y + h),
    };
    try {
      fn();
    } finally {
      this.clip = saved;
    }
  }

  set(x: number, y: number, v: Ink = 1) {
    x |= 0;
    y |= 0;
    const c = this.clip;
    if (x < c.x0 || y < c.y0 || x >= c.x1 || y >= c.y1) return;
    // Half ink is a checkerboard, fixed to the screen so neighbours agree.
    this.data[y * this.w + x] = v === 2 ? ((x + y) & 1 ? 0 : 1) : v;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  fill(x: number, y: number, w: number, h: number, v: Ink = 1) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
  }

  invert(x: number, y: number, w: number, h: number) {
    const c = this.clip;
    for (let yy = Math.max(y, c.y0); yy < Math.min(y + h, c.y1); yy++)
      for (let xx = Math.max(x, c.x0); xx < Math.min(x + w, c.x1); xx++) {
        const i = yy * this.w + xx;
        this.data[i] = this.data[i] ? 0 : 1;
      }
  }

  hline(x0: number, x1: number, y: number, v: Ink = 1) {
    for (let x = x0; x <= x1; x++) this.set(x, y, v);
  }

  vline(x: number, y0: number, y1: number, v: Ink = 1) {
    for (let y = y0; y <= y1; y++) this.set(x, y, v);
  }

  /** A one-pixel outline with its corners knocked off. */
  roundRect(x: number, y: number, w: number, h: number, v: Ink = 1) {
    this.hline(x + 1, x + w - 2, y, v);
    this.hline(x + 1, x + w - 2, y + h - 1, v);
    this.vline(x, y + 1, y + h - 2, v);
    this.vline(x + w - 1, y + 1, y + h - 2, v);
  }

  /** A filled box with its corners knocked off. */
  roundFill(x: number, y: number, w: number, h: number, v: Ink = 1) {
    this.fill(x, y, w, h, v);
    this.set(x, y, 0);
    this.set(x + w - 1, y, 0);
    this.set(x, y + h - 1, 0);
    this.set(x + w - 1, y + h - 1, 0);
  }

  frame(x: number, y: number, w: number, h: number, v: Ink = 1) {
    this.hline(x, x + w - 1, y, v);
    this.hline(x, x + w - 1, y + h - 1, v);
    this.vline(x, y, y + h - 1, v);
    this.vline(x + w - 1, y, y + h - 1, v);
  }

  /** Text with its cap line at y. Returns the width drawn. */
  text(face: Face, s: string, x: number, y: number, v: Ink = 1, opts?: TextOpts): number {
    layout(face, s, x, y, (px, py) => this.set(px, py, v), opts);
    return measure(face, s, opts);
  }

  /** Copy a packed 1-bit image (1 = ink) in at x, y. */
  blit(bits: Uint8Array, bw: number, bh: number, x: number, y: number) {
    for (let yy = 0; yy < bh; yy++)
      for (let xx = 0; xx < bw; xx++) this.set(x + xx, y + yy, bits[yy * bw + xx] ? 1 : 0);
  }
}
