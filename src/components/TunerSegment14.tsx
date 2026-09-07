import { useMemo } from 'react';
import '../styles/tuner.css';

/* ══════════════════════════════════════════════════════════════════════════
   14-SEGMENT (STARBURST) GLYPHS

   A real VFD readout is not a font — it is sixteen fixed bars per cell, and
   the ones that are *off* stay faintly visible in the phosphor. That faint
   ghost is the whole tell, so every cell always draws all sixteen bars and
   only changes their fill.

   Segment names follow the usual convention:

        ─a1─ ─a2─        a1 a2  top,   split at the centre
       │ \  |  / │       f  b   upper verticals
       f  h i j  b       h  i j upper diagonals + centre post
       │   \|/   │       g1 g2  middle, split at the centre
        ─g1─ ─g2─        k  l m lower diagonals + centre post
       │   /|\   │       e  c   lower verticals
       e  k l m  c       d1 d2  bottom, split at the centre
       │ /  |  \ │
        ─d1─ ─d2─
   ══════════════════════════════════════════════════════════════════════════ */

const CELL_W = 20;
const CELL_H = 32;
const TRACK = 5.5; // space between cells
const NARROW_W = 8.5; // ':' and '.' get their own slim cell, as on real clocks
const HT = 1.35; // half the thickness of a bar

// Rails the bars are hung on.
const XL = 2.2;
const XR = 17.8;
const XM = 10;
const YT = 2.2;
const YM = 16;
const YB = 29.8;

/** A bar with mitred ends — the shape a real segment is etched as. */
function bar(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * HT;
  const uy = (dy / len) * HT;
  const nx = -uy;
  const ny = ux;
  return (
    [
      [x1 + ux + nx, y1 + uy + ny],
      [x2 - ux + nx, y2 - uy + ny],
      [x2, y2],
      [x2 - ux - nx, y2 - uy - ny],
      [x1 + ux - nx, y1 + uy - ny],
      [x1, y1],
    ] as const
  )
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

const SEG = {
  a1: bar(XL + 1.4, YT, XM - 1.2, YT),
  a2: bar(XM + 1.2, YT, XR - 1.4, YT),
  b: bar(XR, YT + 1.4, XR, YM - 1.4),
  c: bar(XR, YM + 1.4, XR, YB - 1.4),
  d1: bar(XL + 1.4, YB, XM - 1.2, YB),
  d2: bar(XM + 1.2, YB, XR - 1.4, YB),
  e: bar(XL, YM + 1.4, XL, YB - 1.4),
  f: bar(XL, YT + 1.4, XL, YM - 1.4),
  g1: bar(XL + 1.4, YM, XM - 1.6, YM),
  g2: bar(XM + 1.6, YM, XR - 1.4, YM),
  h: bar(XL + 1.9, YT + 2.1, XM - 1.9, YM - 2.1),
  i: bar(XM, YT + 1.8, XM, YM - 1.6),
  j: bar(XR - 1.9, YT + 2.1, XM + 1.9, YM - 2.1),
  k: bar(XL + 1.9, YB - 2.1, XM - 1.9, YM + 2.1),
  l: bar(XM, YM + 1.6, XM, YB - 1.8),
  m: bar(XR - 1.9, YB - 2.1, XM + 1.9, YM + 2.1),
} as const;

type SegId = keyof typeof SEG;
const ALL = Object.keys(SEG) as SegId[];

/** Which bars each character lights. Anything unmapped shows as a blank cell. */
const GLYPHS: Record<string, string> = {
  // No slashed zero: this is a clock face, and the slash reads as a starburst.
  '0': 'a1 a2 b c d1 d2 e f',
  '1': 'b c',
  '2': 'a1 a2 b g1 g2 e d1 d2',
  '3': 'a1 a2 b c d1 d2 g1 g2',
  '4': 'f b g1 g2 c',
  '5': 'a1 a2 f g1 g2 c d1 d2',
  '6': 'a1 a2 f e d1 d2 c g1 g2',
  '7': 'a1 a2 b c',
  '8': 'a1 a2 b c d1 d2 e f g1 g2',
  '9': 'a1 a2 b c f g1 g2 d1 d2',
  A: 'a1 a2 b c e f g1 g2',
  B: 'a1 a2 b c d1 d2 g2 i l',
  C: 'a1 a2 f e d1 d2',
  D: 'a1 a2 b c d1 d2 i l',
  E: 'a1 a2 f e d1 d2 g1 g2',
  F: 'a1 a2 f e g1',
  G: 'a1 a2 f e d1 d2 c g2',
  H: 'b c e f g1 g2',
  I: 'a1 a2 d1 d2 i l',
  J: 'b c d1 d2 e',
  K: 'e f g1 j m',
  L: 'f e d1 d2',
  M: 'e f b c h j',
  N: 'e f b c h m',
  O: 'a1 a2 b c d1 d2 e f',
  P: 'a1 a2 b e f g1 g2',
  Q: 'a1 a2 b c d1 d2 e f m',
  R: 'a1 a2 b e f g1 g2 m',
  S: 'a1 a2 f g1 g2 c d1 d2',
  T: 'a1 a2 i l',
  U: 'b c d1 d2 e f',
  V: 'f e k j',
  W: 'f e k m c b',
  X: 'h j k m',
  Y: 'h j l',
  Z: 'a1 a2 j k d1 d2',
  '-': 'g1 g2',
  _: 'd1 d2',
  '/': 'j k',
  '\\': 'h m',
  '+': 'g1 g2 i l',
  '*': 'g1 g2 i l h j k m',
  "'": 'i',
  '?': 'a1 a2 j g2 l',
  '=': 'g1 g2 d1 d2',
  '(': 'j m',
  ')': 'h k',
};

const LIT: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(GLYPHS).map(([c, s]) => [c, new Set(s.split(' '))]),
);

const NARROW = new Set([':', '.']);

interface Props {
  text: string;
  className?: string;
  /** What a screen reader should hear instead of the raw glyph string. */
  label?: string;
}

/**
 * One line of segment cells, drawn as a single SVG. Height comes from CSS
 * (`height: …; width: auto`); the viewBox carries the aspect ratio.
 */
export default function TunerSegment14({ text, className, label }: Props) {
  const { cells, width } = useMemo(() => {
    let x = 0;
    const out = [...text.toUpperCase()].map((c) => {
      const w = NARROW.has(c) ? NARROW_W : CELL_W;
      const cell = { c, x, w };
      x += w + TRACK;
      return cell;
    });
    return { cells: out, width: Math.max(1, x - TRACK) };
  }, [text]);

  return (
    <svg
      className={`seg14${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width.toFixed(1)} ${CELL_H}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={label ?? text}
    >
      {/* Two passes, not one class per bar: the bloom is a filter, and it has
          to fall on the lit bars only. Give the dark ones the same halo and
          the readout turns into 88:88. */}
      <g className="seg14-off">
        {cells.map(({ c, x }, i) =>
          NARROW.has(c) ? null : (
            <g key={i} transform={`translate(${x.toFixed(1)} 0)`}>
              {ALL.filter((id) => !LIT[c]?.has(id)).map((id) => (
                <polygon key={id} points={SEG[id]} />
              ))}
            </g>
          ),
        )}
      </g>
      <g className="seg14-on">
        {cells.map(({ c, x, w }, i) => (
          <g key={i} transform={`translate(${x.toFixed(1)} 0)`}>
            {NARROW.has(c)
              ? <Punct char={c} w={w} />
              : ALL.filter((id) => LIT[c]?.has(id)).map((id) => (
                  <polygon key={id} points={SEG[id]} />
                ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/** The colon and the period are discrete lamps, not bars — they are never dim. */
function Punct({ char, w }: { char: string; w: number }) {
  const cx = w / 2;
  if (char === ':') {
    return (
      <>
        <circle cx={cx} cy={11.5} r={1.7} />
        <circle cx={cx} cy={21.5} r={1.7} />
      </>
    );
  }
  return <circle cx={cx} cy={YB} r={1.7} />;
}
