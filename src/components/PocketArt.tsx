import { useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   THE COVER ON THE LCD

   The cover redrawn the way the handheld's screen would have to show it: a
   coarse grid of dots in four shades of green, ordered-dithered so faces
   and type still read. COLOR shows the real cover instead, and the choice
   is remembered. If the cover can't be read back (no CORS), the plain image
   is shown under a green wash rather than nothing.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY = 'phaedrus.pocket.color';
/** Dots across the screen's picture. Big enough to read, small enough to look like an LCD. */
const DOTS = 84;
/** The four shades, darkest first. Must match --lcd-3 … --lcd-0 in skin-pocket.css. */
const SHADES: [number, number, number][] = [
  [0x24, 0x36, 0x1f],
  [0x51, 0x6b, 0x40],
  [0x8e, 0xa0, 0x62],
  [0xc3, 0xcd, 0x8f],
];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function recallColor(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

interface Props {
  art?: string;
  title?: string;
  idle: boolean;
}

export default function PocketArt({ art, title, idle }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(recallColor);
  /** 'dots' once the canvas holds the dithered cover; 'wash' if it can't be read back. */
  const [mode, setMode] = useState<'dots' | 'wash' | 'none'>('none');
  const [broken, setBroken] = useState<string | undefined>();

  const show = !idle && !!art && broken !== art;

  useEffect(() => {
    setMode('none');
    if (!show || !art) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => {
      if (!alive) return;
      const c = canvas.current;
      const ctx = c?.getContext('2d', { willReadFrequently: true });
      if (!c || !ctx) return;
      try {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, DOTS, DOTS);
        const frame = ctx.getImageData(0, 0, DOTS, DOTS);
        dither(frame.data);
        ctx.putImageData(frame, 0, 0);
        setMode('dots');
      } catch {
        setMode('wash'); // tainted: the cover has no CORS headers
      }
    };
    img.onerror = () => {
      if (alive) setBroken(art);
    };
    img.src = art;
    return () => {
      alive = false;
    };
  }, [art, show]);

  const toggle = () => {
    const next = !color;
    setColor(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* the choice just won't survive a restart */
    }
  };

  return (
    <div className={`pk-art${color ? ' is-color' : ''}`}>
      <div className="pk-art-screen">
        <canvas
          ref={canvas}
          className="pk-art-dots"
          width={DOTS}
          height={DOTS}
          hidden={!show || color || mode !== 'dots'}
          aria-hidden="true"
        />
        {show && (color || mode === 'wash') && (
          <img
            className={`pk-art-img${color ? '' : ' is-wash'}`}
            src={art}
            alt=""
            draggable={false}
            onError={() => setBroken(art)}
          />
        )}
        {!show && <PocketNote />}
        <span className="pk-sr">{show ? `Cover of ${title ?? 'this record'}` : 'No cover'}</span>
      </div>
      {show && (
        <button type="button" className="pk-art-toggle" aria-pressed={color} onClick={toggle}>
          {color ? 'LCD' : 'COLOR'}
        </button>
      )}
    </div>
  );
}

/** Nothing on: a big eighth note drawn in dots. */
function PocketNote() {
  const rows = ['....##..', '....###.', '....#.##', '....#..#', '....#...', '.###....', '####....', '.##.....'];
  return (
    <svg className="pk-art-note" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
      {rows.flatMap((r, y) =>
        [...r].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null)),
      )}
    </svg>
  );
}

/**
 * Luminance, stretched to the picture's own range, then a 4×4 ordered dither
 * into four shades. Stretching first keeps a dark cover from becoming a
 * single block of the darkest green.
 */
function dither(d: Uint8ClampedArray) {
  const n = d.length / 4;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    lum[i] = v;
    hist[Math.round(v)]++;
  }
  const pick = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * q) return v;
    }
    return 255;
  };
  const lo = pick(0.02);
  const hi = Math.max(pick(0.98), lo + 24);
  for (let i = 0; i < n; i++) {
    const x = i % DOTS;
    const y = Math.floor(i / DOTS);
    const t = Math.min(1, Math.max(0, (lum[i] - lo) / (hi - lo)));
    const threshold = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
    const level = Math.min(3, Math.max(0, Math.round(t * 3 + threshold * 0.9)));
    const [r, g, b] = SHADES[level];
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
}
