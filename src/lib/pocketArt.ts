/* ══════════════════════════════════════════════════════════════════════════
   POCKET ART — covers dithered to one bit

   A cover is drawn small, turned to grey, given its levels (the darkest and
   brightest percent of the picture are pinned to ink and paper, so a murky
   sleeve still reads), sharpened a touch, and then Atkinson-dithered: each
   pixel passes three quarters of its error on to six neighbours and lets the
   last quarter go. Losing that quarter is what keeps the highlights clean and
   the shadows open, the look of a 1984 desktop picture.

   Results are cached per URL and size. A cover that cannot be read back (a
   tainted canvas, a 404) resolves to null and the screen draws its own
   pattern instead.
   ══════════════════════════════════════════════════════════════════════════ */

export interface Dithered {
  size: number;
  /** size × size, 1 = ink. */
  bits: Uint8Array;
}

const cache = new Map<string, Promise<Dithered | null>>();
const done = new Map<string, Dithered | null>();

const keyOf = (url: string, size: number) => `${size}|${url}`;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('art did not load'));
    img.src = url;
  });
}

/** Grey levels of the cover, cropped square and drawn at `size`. */
function greys(img: HTMLImageElement, size: number): Float32Array | null {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) return null;
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  // Two steps down, so the small one is an average and not a sample.
  const mid = document.createElement('canvas');
  const midSize = Math.min(side, size * 4);
  mid.width = mid.height = midSize;
  const mctx = mid.getContext('2d');
  if (!mctx) return null;
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(img, sx, sy, side, side, 0, 0, midSize, midSize);

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null; // tainted: the server sent no CORS header
  }
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) {
    const r = data[i * 4] / 255;
    const gg = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    g[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  }
  return g;
}

/** Pin the darkest and brightest percent, ease the midtones, sharpen. */
function tone(g: Float32Array, size: number): Float32Array {
  const sorted = Float32Array.from(g).sort();
  const lo = sorted[Math.floor(sorted.length * 0.015)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.985))];
  const span = Math.max(0.08, hi - lo);
  const t = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) {
    let v = (g[i] - lo) / span;
    v = Math.max(0, Math.min(1, v));
    // A gentle S, and a little lift: the LCD's ink is heavier than paper.
    v = v * v * (3 - 2 * v) * 0.45 + v * 0.55;
    t[i] = Math.pow(v, 0.86);
  }
  // Unsharp mask, 3 × 3, so edges survive the trip to sixty pixels.
  const s = new Float32Array(t.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          sum += t[yy * size + xx];
          n++;
        }
      const v = t[y * size + x];
      s[y * size + x] = v + (v - sum / n) * 0.7;
    }
  return s;
}

/** Bill Atkinson's dither: 6/8 of the error forward, 2/8 let go. */
export function atkinson(src: Float32Array, size: number): Uint8Array {
  const e = Float32Array.from(src);
  const out = new Uint8Array(size * size);
  const push = (x: number, y: number, err: number) => {
    if (x < 0 || x >= size || y >= size) return;
    e[y * size + x] += err;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const old = e[i];
      const paper = old >= 0.5;
      out[i] = paper ? 0 : 1;
      const err = (old - (paper ? 1 : 0)) / 8;
      push(x + 1, y, err);
      push(x + 2, y, err);
      push(x - 1, y + 1, err);
      push(x, y + 1, err);
      push(x + 1, y + 1, err);
      push(x, y + 2, err);
    }
  return out;
}

/** The dithered cover, once it has been made; undefined while it is cooking. */
export function peekDither(url: string, size: number): Dithered | null | undefined {
  const k = keyOf(url, size);
  return done.has(k) ? done.get(k)! : undefined;
}

export function dither(url: string, size: number): Promise<Dithered | null> {
  const k = keyOf(url, size);
  let p = cache.get(k);
  if (!p) {
    p = load(url)
      .then((img) => {
        const g = greys(img, size);
        if (!g) return null;
        return { size, bits: atkinson(tone(g, size), size) };
      })
      .catch(() => null)
      .then((d) => {
        done.set(k, d);
        // Keep the cache from growing without end over a long evening.
        if (done.size > 240) {
          const first = done.keys().next().value;
          if (first !== undefined) {
            done.delete(first);
            cache.delete(first);
          }
        }
        return d;
      });
    cache.set(k, p);
  }
  return p;
}
