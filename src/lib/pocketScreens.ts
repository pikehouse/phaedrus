import { Bold, Small, fit, measure, glyphFor, type Face } from './pocketFont';
import { Bitmap, LCD_W, LCD_H } from './pocketLcd';
import { peekDither, type Dithered } from './pocketArt';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET SCREENS

   Everything the little screen can show, drawn into a Bitmap. Each draw
   returns how long until it needs drawing again (a clock ticking over, a
   marquee stepping a pixel), or Infinity when it can sit still. Nothing here
   knows about React or the speakers: the stage hands in plain models.
   ══════════════════════════════════════════════════════════════════════════ */

export const STATUS_H = 14; // the title bar, rule included
export const ROW_H = 16;
export const ROWS = Math.floor((LCD_H - STATUS_H) / ROW_H); // 7
export const THUMB = 14;
export const ART = 60;

export type Transport = 'play' | 'pause' | 'stop';

export interface StatusModel {
  transport: Transport;
  title: string;
  volume: number;
  muted: boolean;
  hold: boolean;
}

export interface NowModel {
  idle: boolean;
  title: string;
  artist?: string;
  album?: string;
  index?: number;
  count?: number;
  radio: boolean;
  /** Seconds into the track at a given moment. */
  elapsedAt: (now: number) => number;
  duration: number;
  playing: boolean;
  art?: string;
  /** When this track came on, for the marquee's timing. */
  since: number;
}

export interface Row {
  label: string;
  /** Right-aligned value, as in "Shuffle   Off". */
  value?: string;
  child?: boolean;
  /** ▶ on the track that is playing, the speaker on the room you're in. */
  mark?: 'now' | 'here';
  dim?: boolean;
  /** Cover for a small thumbnail. */
  art?: string;
  /** Rows with art leave room for it even before it arrives. */
  thumb?: boolean;
}

export interface MenuModel {
  title: string;
  rows: Row[];
  sel: number;
  top: number;
  /** A list to read, not to choose from: no highlight. */
  still?: boolean;
  empty?: string;
  /** When the highlight last moved, for its marquee. */
  since: number;
}

export type Overlay =
  | { kind: 'volume'; volume: number; muted: boolean }
  | { kind: 'hold' }
  | null;

const W = LCD_W;
const H = LCD_H;

const clock = (secs: number) => {
  const t = Math.max(0, Math.floor(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// ── Marquee ──────────────────────────────────────────────────────────────────

const MARQUEE_WAIT = 1600; // ms before a long line starts to move
const MARQUEE_SPEED = 18; // px a second: slow, the way the real ones crept
const MARQUEE_GAP = 28; // px of paper before the line comes round again
const MARQUEE_REST = 900; // ms between one line finishing and the next starting

interface Slot {
  start: number;
  dur: number;
}

/** When each overflowing line takes its turn: one after another, once each. */
function schedule(overflows: number[], since: number): Slot[] {
  let t = since + MARQUEE_WAIT;
  return overflows.map((travel) => {
    if (travel <= 0) return { start: 0, dur: 0 };
    const dur = (travel / MARQUEE_SPEED) * 1000;
    const slot = { start: t, dur };
    t += dur + MARQUEE_REST;
    return slot;
  });
}

/**
 * A line of text in a box. Too long, it creeps left once all the way round
 * and comes to rest where it began; then it holds. Returns ms until the next
 * pixel step, or Infinity.
 */
function marquee(
  b: Bitmap,
  face: Face,
  text: string,
  x: number,
  y: number,
  width: number,
  slot: Slot | null,
  now: number,
  v: 0 | 1 = 1,
  align: 'left' | 'center' = 'left',
): number {
  const tw = measure(face, text);
  const top = y - 3; // room for marks over capitals
  const tall = face.cap + face.desc + 4;
  if (tw <= width || !slot || slot.dur <= 0) {
    const shown = tw <= width ? text : fit(face, text, width);
    const sx = align === 'center' ? x + Math.floor((width - measure(face, shown)) / 2) : x;
    b.clipped(x, top, width, tall, () => b.text(face, shown, sx, y, v));
    return Infinity;
  }
  const travel = tw + MARQUEE_GAP;
  let off = 0;
  let wake = Infinity;
  if (now < slot.start) {
    wake = slot.start - now;
  } else if (now < slot.start + slot.dur) {
    off = Math.floor(((now - slot.start) / 1000) * MARQUEE_SPEED);
    wake = Math.max(16, 1000 / MARQUEE_SPEED - ((now - slot.start) % (1000 / MARQUEE_SPEED)));
  }
  b.clipped(x, top, width, tall, () => {
    if (off === 0 && now < slot.start) {
      b.text(face, fit(face, text, width), x, y, v);
      return;
    }
    if (off >= travel || now >= slot.start + slot.dur) {
      b.text(face, fit(face, text, width), x, y, v);
      return;
    }
    b.text(face, text, x - off, y, v);
    b.text(face, text, x - off + travel, y, v);
  });
  return wake;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function glyph(b: Bitmap, face: Face, ch: string, x: number, y: number, v: 0 | 1 = 1) {
  b.text(face, ch, x, y, v);
}

/** A glyph at twice the size, every pixel a 2 × 2 block. */
function bigGlyph(b: Bitmap, face: Face, ch: string, x: number, y: number, scale = 2) {
  const g = glyphFor(face, ch);
  if (!g) return;
  g.rows.forEach((row, r) =>
    row.forEach((on, c) => {
      if (on) b.fill(x + c * scale, y + (g.top + r) * scale, scale, scale, 1);
    }),
  );
}

/** The battery in the corner, filled to the group's volume. */
function battery(b: Bitmap, x: number, y: number, volume: number, muted: boolean) {
  b.roundRect(x, y, 15, 8);
  b.vline(x + 15, y + 2, y + 5);
  b.vline(x + 16, y + 2, y + 5);
  if (muted) {
    // A thin cross: the cell is there, nothing is coming out.
    for (let i = 0; i < 4; i++) {
      b.set(x + 5 + i, y + 2 + i);
      b.set(x + 8 - i, y + 2 + i);
    }
    return;
  }
  const fill = Math.round((Math.max(0, Math.min(100, volume)) / 100) * 11);
  if (fill > 0) b.fill(x + 2, y + 2, fill, 4);
}

export function drawStatus(b: Bitmap, s: StatusModel) {
  let left = 3;
  if (s.transport === 'play') {
    glyph(b, Bold, '▶', left, 1);
    left += 9;
  } else if (s.transport === 'pause') {
    glyph(b, Bold, '⏸', left, 1);
    left += 8;
  }
  if (s.hold) {
    glyph(b, Bold, '🔒', left, 1);
    left += 9;
  }
  battery(b, W - 20, 3, s.volume, s.muted);

  const room = { x0: Math.max(left + 2, 14), x1: W - 24 };
  const span = room.x1 - room.x0;
  const title = fit(Bold, s.title, span);
  const tw = measure(Bold, title);
  // Centred on the screen when it can be, inside its room when it can't.
  let x = Math.floor((W - tw) / 2);
  x = Math.max(room.x0, Math.min(room.x1 - tw, x));
  b.clipped(room.x0 - 1, 0, span + 2, STATUS_H - 1, () => b.text(Bold, title, x, 1));
  b.hline(0, W - 1, STATUS_H - 1);
}

/** The ♪ pattern a cover falls back to when it can't be read. */
function notePaper(b: Bitmap, x: number, y: number, size: number) {
  b.clipped(x, y, size, size, () => {
    for (let r = 0, yy = y + 1; yy < y + size; r++, yy += 10)
      for (let xx = x + (r % 2 ? 6 : 1); xx < x + size; xx += 12) b.text(Small, '♪', xx, yy, 1);
  });
  const c = Math.floor(size / 2);
  b.fill(x + c - 11, y + c - 11, 22, 22, 0);
  b.roundRect(x + c - 11, y + c - 11, 22, 22);
  bigGlyph(b, Bold, '♪', x + c - 7, y + c - 9, 2);
}

/** A cover as it is while it cooks: a soft grey square. */
function waitingArt(b: Bitmap, x: number, y: number, size: number) {
  for (let yy = 0; yy < size; yy++)
    for (let xx = 0; xx < size; xx++) if (((xx >> 1) + (yy >> 1)) % 4 === 0 && (xx + yy) % 2 === 0) b.set(x + xx, y + yy);
}

function drawArt(b: Bitmap, url: string | undefined, x: number, y: number, size: number, wanted: (u: string, s: number) => void) {
  if (!url) {
    notePaper(b, x, y, size);
    return;
  }
  const d: Dithered | null | undefined = peekDither(url, size);
  if (d === undefined) {
    wanted(url, size);
    waitingArt(b, x, y, size);
  } else if (d === null) {
    notePaper(b, x, y, size);
  } else {
    b.blit(d.bits, d.size, d.size, x, y);
  }
}

function progress(b: Bitmap, x: number, y: number, w: number, frac: number) {
  b.roundRect(x, y, w, 8);
  const inner = w - 4;
  const fill = Math.round(Math.max(0, Math.min(1, frac)) * inner);
  if (fill > 0) b.fill(x + 2, y + 2, fill, 4);
  // A faint track for the part still to come.
  for (let xx = x + 2 + fill; xx < x + w - 2; xx++) if (xx % 2 === 0) b.set(xx, y + 4);
}

// ── Now Playing ──────────────────────────────────────────────────────────────

export interface Ctx {
  now: number;
  /** Ask for a cover to be dithered; the stage redraws when it arrives. */
  want: (url: string, size: number) => void;
}

export function drawNowPlaying(b: Bitmap, m: NowModel, overlay: Overlay, ctx: Ctx): number {
  const { now } = ctx;
  let wake = Infinity;

  if (m.idle) {
    const t1 = 'Phædrus';
    b.text(Bold, t1, Math.floor((W - measure(Bold, t1)) / 2), 30);
    bigGlyph(b, Bold, '♪', W / 2 - 7, 46, 2);
    const t2 = 'Nothing playing';
    b.text(Small, t2, Math.floor((W - measure(Small, t2)) / 2), 80);
    const t3 = 'Press menu to browse';
    b.text(Small, t3, Math.floor((W - measure(Small, t3)) / 2), 92);
    return drawOverlay(b, overlay, wake);
  }

  // The cover, in a hairline frame.
  const ax = 3;
  const ay = 19;
  b.frame(ax, ay, ART + 2, ART + 2);
  drawArt(b, m.art, ax + 1, ay + 1, ART, ctx.want);

  // The words, to its right.
  const tx = ax + ART + 7;
  const tw = W - tx - 3;
  if (m.radio) {
    b.text(Small, 'Radio', tx, 20);
  } else if (m.index && m.count) {
    b.text(Small, `${m.index} of ${m.count}`, tx, 20);
  }
  const lines = [m.title, m.artist ?? '', m.album ?? ''];
  const slots = schedule(
    lines.map((l) => (l && measure(Bold, l) > tw ? measure(Bold, l) + MARQUEE_GAP : 0)),
    m.since,
  );
  wake = Math.min(wake, marquee(b, Bold, lines[0], tx, 32, tw, slots[0], now));
  if (lines[1]) wake = Math.min(wake, marquee(b, Bold, lines[1], tx, 47, tw, slots[1], now));
  if (lines[2]) wake = Math.min(wake, marquee(b, Bold, lines[2], tx, 62, tw, slots[2], now));

  // Progress and the clocks.
  const secs = m.elapsedAt(now);
  if (m.playing) {
    const frac = secs - Math.floor(secs);
    wake = Math.min(wake, Math.max(40, (1 - frac) * 1000 + 8));
  }
  if (m.radio) {
    b.text(Small, '● Live', 3, 95);
    for (let xx = 36; xx < W - 40; xx += 3) b.set(xx, 98);
    const c = clock(secs);
    b.text(Bold, c, W - 3 - measure(Bold, c, { tabular: true }), 92, 1, { tabular: true });
  } else {
    const d = m.duration;
    progress(b, 3, 90, W - 6, d > 0 ? secs / d : 0);
    const e = clock(Math.min(secs, d || secs));
    b.text(Bold, e, 3, 104, 1, { tabular: true });
    if (d > 0) {
      const r = `-${clock(Math.max(0, d - secs))}`;
      b.text(Bold, r, W - 3 - measure(Bold, r, { tabular: true }), 104, 1, { tabular: true });
    }
  }

  return drawOverlay(b, overlay, wake);
}

export function drawOverlay(b: Bitmap, overlay: Overlay, wake: number): number {
  if (!overlay) return wake;
  if (overlay.kind === 'volume') {
    // The volume bar takes the place of the progress bar, as it always did.
    b.fill(0, 84, W, H - 84, 0);
    b.hline(0, W - 1, 84);
    b.text(Bold, '🔈', 4, 93);
    b.text(Bold, '🔊', W - 13, 93);
    const x = 14;
    const w = W - 32;
    b.roundRect(x, 93, w, 10);
    const inner = w - 4;
    const fill = overlay.muted ? 0 : Math.round((overlay.volume / 100) * inner);
    if (fill > 0) b.fill(x + 2, 95, fill, 6);
    for (let i = 1; i < 10; i++) {
      const tx = x + 2 + Math.round((inner * i) / 10);
      b.set(tx, 105);
      if (i === 5) b.set(tx, 106);
    }
    const label = overlay.muted ? 'Muted' : `Volume ${overlay.volume}`;
    b.text(Small, label, Math.floor((W - measure(Small, label)) / 2), 111);
    return wake;
  }
  // Hold: a lock in a box, and a word.
  const bw = 58;
  const bh = 50;
  const x = Math.floor((W - bw) / 2);
  const y = Math.floor((H + STATUS_H - bh) / 2);
  b.fill(x - 2, y - 2, bw + 4, bh + 4, 0);
  b.roundRect(x, y, bw, bh);
  b.roundRect(x + 1, y + 1, bw - 2, bh - 2);
  bigGlyph(b, Bold, '🔒', x + bw / 2 - 7, y + 8, 2);
  const t = 'Hold';
  b.text(Small, t, x + Math.floor((bw - measure(Small, t)) / 2), y + 36);
  return wake;
}

// ── Menus ────────────────────────────────────────────────────────────────────

export function drawMenu(b: Bitmap, m: MenuModel, ctx: Ctx): number {
  const { now } = ctx;
  let wake = Infinity;
  const scroll = m.rows.length > ROWS;
  const rowW = scroll ? W - 7 : W;

  if (m.rows.length === 0) {
    const t = m.empty ?? 'Nothing here';
    b.text(Small, t, Math.floor((W - measure(Small, t)) / 2), STATUS_H + 40);
    return wake;
  }

  for (let i = 0; i < ROWS; i++) {
    const idx = m.top + i;
    const row = m.rows[idx];
    if (!row) break;
    const y = STATUS_H + i * ROW_H;
    const selected = !m.still && idx === m.sel;
    if (selected) b.fill(0, y, rowW, ROW_H, 1);
    const v: 0 | 1 = selected ? 0 : 1;

    let x = 4;
    if (row.thumb) {
      if (row.art) {
        const d = peekDither(row.art, THUMB);
        if (d === undefined) {
          ctx.want(row.art, THUMB);
          b.roundRect(3, y + 1, THUMB, THUMB, v);
        } else if (d === null) {
          b.roundRect(3, y + 1, THUMB, THUMB, v);
          b.text(Small, '♪', 7, y + 4, v);
        } else {
          // On the highlight the thumbnail sits in a paper frame.
          if (selected) b.fill(0, y, THUMB + 5, ROW_H, 0);
          b.blit(d.bits, THUMB, THUMB, 3, y + 1);
        }
      } else {
        b.roundRect(3, y + 1, THUMB, THUMB, v);
        b.text(Small, '♪', 7, y + 4, v);
      }
      x = THUMB + 7;
    }

    let right = rowW - 3;
    if (row.child) {
      b.text(Bold, '›', right - 5, y + 4, v);
      right -= 9;
    }
    if (row.mark === 'now') {
      b.text(Small, '▶', right - 4, y + 5, v);
      right -= 8;
    } else if (row.mark === 'here') {
      b.text(Bold, '🔈', right - 4, y + 4, v);
      right -= 9;
    }
    if (row.value) {
      const vw = measure(Bold, row.value);
      b.text(Bold, row.value, right - vw, y + 4, v);
      right -= vw + 6;
    }

    const width = right - x;
    const ink: 0 | 1 = v;
    if (row.dim && !selected) {
      // Half-tone text: the row is there, but it won't play.
      b.clipped(x, y, width, ROW_H, () => {
        b.text(Bold, fit(Bold, row.label, width), x, y + 4, 1);
        for (let yy = y; yy < y + ROW_H; yy++)
          for (let xx = x; xx < x + width; xx++) if ((xx + yy) % 2) b.set(xx, yy, 0);
      });
    } else if (selected) {
      const tw = measure(Bold, row.label);
      const slot = tw > width ? schedule([tw + MARQUEE_GAP], m.since)[0] : null;
      wake = Math.min(wake, marquee(b, Bold, row.label, x, y + 4, width, slot, now, ink));
    } else {
      b.clipped(x, y, width, ROW_H, () => b.text(Bold, fit(Bold, row.label, width), x, y + 4, ink));
    }
  }

  if (scroll) {
    const x = W - 6;
    const top = STATUS_H + 1;
    const h = H - top - 1;
    b.frame(x, top, 6, h);
    const thumbH = Math.max(6, Math.round((h - 4) * (ROWS / m.rows.length)));
    const maxTop = m.rows.length - ROWS;
    const ty = top + 2 + Math.round(((h - 4 - thumbH) * m.top) / Math.max(1, maxTop));
    b.fill(x + 2, ty, 2, thumbH);
  }
  return wake;
}

/** Keep the highlight in view: the list moves only when the bar would leave it. */
export function follow(sel: number, top: number, count: number): number {
  if (count <= ROWS) return 0;
  if (sel < top) return sel;
  if (sel >= top + ROWS) return sel - ROWS + 1;
  return Math.max(0, Math.min(top, count - ROWS));
}

/** Which row a tap at LCD y lands on, or -1. */
export function rowAt(y: number, top: number): number {
  if (y < STATUS_H) return -1;
  return top + Math.floor((y - STATUS_H) / ROW_H);
}
