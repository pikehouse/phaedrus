import { layout, measure, type Face, type TextOpts } from './pocketFont';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET PIX — one-bit drawing for the control panel

   The volume panel under the player is a little window from a 1990 desktop:
   black on white, one pixel at a time. Each part of it (a label, an icon, a
   slider) is drawn into a Pix — transparent, black or white per pixel — and
   painted into a canvas at a whole-number scale, so nothing is ever smoothed.
   The icons here are drawn for this app.
   ══════════════════════════════════════════════════════════════════════════ */

export const CLEAR = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Px = typeof CLEAR | typeof BLACK | typeof WHITE;

export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.data = new Uint8Array(this.w * this.h);
  }

  set(x: number, y: number, v: Px = BLACK) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = v;
  }

  fill(x: number, y: number, w: number, h: number, v: Px = BLACK) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, v);
  }

  /** The desktop's 50% grey: alternate pixels, fixed to the grid. */
  dither(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, (xx + yy) & 1 ? WHITE : BLACK);
  }

  hline(x0: number, x1: number, y: number, v: Px = BLACK) {
    for (let x = x0; x <= x1; x++) this.set(x, y, v);
  }

  vline(x: number, y0: number, y1: number, v: Px = BLACK) {
    for (let y = y0; y <= y1; y++) this.set(x, y, v);
  }

  frame(x: number, y: number, w: number, h: number, v: Px = BLACK) {
    this.hline(x, x + w - 1, y, v);
    this.hline(x, x + w - 1, y + h - 1, v);
    this.vline(x, y, y + h - 1, v);
    this.vline(x + w - 1, y, y + h - 1, v);
  }

  text(face: Face, s: string, x: number, y: number, v: Px = BLACK, opts?: TextOpts): number {
    layout(face, s, x, y, (px, py) => this.set(px, py, v), opts);
    return measure(face, s, opts);
  }

  /** Rows of '#' and '.', stamped at x, y. */
  stamp(rows: string[], x: number, y: number, v: Px = BLACK) {
    rows.forEach((row, r) => [...row].forEach((c, i) => c === '#' && this.set(x + i, y + r, v)));
  }
}

/** Paint a Pix into a canvas, `scale` CSS pixels to each of its pixels. */
export function paint(canvas: HTMLCanvasElement, p: Pix, scale: number, ink = '#101214', paper = '#fbfbf8') {
  const k = Math.max(1, Math.round(scale * (window.devicePixelRatio || 1)));
  const w = p.w * k;
  const h = p.h * k;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${p.w * scale}px`;
  canvas.style.height = `${p.h * scale}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  const hex = (c: string) => {
    const n = parseInt(c.slice(1), 16);
    return 0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
  };
  const black = hex(ink);
  const white = hex(paper);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const v = p.data[y * p.w + x];
      if (!v) continue;
      const c = v === BLACK ? black : white;
      for (let yy = y * k; yy < y * k + k; yy++) px.fill(c, yy * w + x * k, yy * w + x * k + k);
    }
  ctx.putImageData(img, 0, 0);
}

// ── Icons ────────────────────────────────────────────────────────────────────

/** The speaker: a cone facing right, 7 × 13, centred on row 6. */
const CONE = [
  '.....#.',
  '....##.',
  '...#.#.',
  '..#..#.',
  '##...#.',
  '#....#.',
  '#....#.',
  '#....#.',
  '##...#.',
  '..#..#.',
  '...#.#.',
  '....##.',
  '.....#.',
];

/**
 * A speaker with up to three sound waves (0–3), or crossed out when muted.
 * 17 × 13.
 */
export function speaker(p: Pix, x: number, y: number, waves: number, muted: boolean, v: Px = BLACK) {
  p.stamp(CONE, x, y, v);
  if (muted) {
    for (let i = 0; i < 7; i++) {
      p.set(x + 9 + i, y + 3 + i, v);
      p.set(x + 15 - i, y + 3 + i, v);
    }
    return;
  }
  // Three arcs, each taller than the last.
  const arcs = [
    ['#.', '.#', '.#', '.#', '#.'],
    ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
    ['##..', '..#.', '...#', '...#', '...#', '...#', '...#', '..#.', '##..'],
  ];
  for (let i = 0; i < Math.min(3, waves); i++) {
    const a = arcs[i];
    p.stamp(a, x + 8 + i * 3, y + 6 - Math.floor(a.length / 2), v);
  }
}

/** How many waves a volume earns: none at zero, three near the top. */
export const wavesFor = (volume: number) => (volume <= 0 ? 0 : volume < 34 ? 1 : volume < 67 ? 2 : 3);

/** The pointer thumb of the old mouse-speed sliders: a pentagon pointing down. 9 × 12. */
export function pointer(p: Pix, cx: number, y: number) {
  const rows = [
    '#########',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '#.......#',
    '.#.....#.',
    '..#...#..',
    '...#.#...',
    '....#....',
  ];
  const x = cx - 4;
  rows.forEach((row, r) => {
    const a = row.indexOf('#');
    const b = row.lastIndexOf('#');
    for (let i = a; i <= b; i++) p.set(x + i, y + r, row[i] === '#' ? BLACK : WHITE);
  });
}

/** A square slider knob with grip lines, the volume control's. 9 × 13. */
export function knob(p: Pix, cx: number, y: number) {
  const x = cx - 4;
  p.fill(x, y, 9, 13, WHITE);
  p.frame(x, y, 9, 13);
  p.set(x, y, CLEAR);
  p.set(x + 8, y, CLEAR);
  p.set(x, y + 12, CLEAR);
  p.set(x + 8, y + 12, CLEAR);
  for (let i = 0; i < 3; i++) p.vline(x + 2 + i * 2, y + 3, y + 9);
  // a pixel of shadow on the right and below, as the buttons had
  p.vline(x + 9, y + 1, y + 12);
  p.hline(x + 1, x + 8, y + 13);
}
