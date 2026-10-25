import { memo } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   NIGHTDRIVE · 14-SEGMENT DISPLAY

   Orange segments behind smoked glass, the unlit ones faintly visible. There
   is no segment font: every glyph is fourteen hexagonal polygons on a cell
   skewed 7°, all measured from the glyph height H (a port of
   nightdrive/make-segment-svgs.py from the design handoff).

     stroke t = .085H · cell w = .66H · advance = H · padding 2t all round
   ══════════════════════════════════════════════════════════════════════════ */

const LIT = '#FF9A3C';
const GHOST = '#FF781E';

/** Which segments each character lights. Anything missing is a blank cell. */
const GLYPHS: Record<string, string> = {
  '0': 'abcdefjk', '1': 'bcj', '2': 'abg1g2ed', '3': 'abcdg2', '4': 'fg1g2bc',
  '5': 'afg1g2cd', '6': 'afedcg1g2', '7': 'abc', '8': 'abcdefg1g2', '9': 'abcdfg1g2',
  A: 'abcefg1g2', B: 'abcdilg2', C: 'adef', D: 'abcdil', E: 'adefg1', F: 'aefg1',
  G: 'acdefg2', H: 'bcefg1g2', I: 'adil', J: 'bcde', K: 'efg1jm', L: 'def',
  M: 'bcefhj', N: 'bcefhm', O: 'abcdef', P: 'abefg1g2', Q: 'abcdefm', R: 'abefg1g2m',
  S: 'afg1g2cd', T: 'ail', U: 'bcdef', V: 'efkj', W: 'bcefkm', X: 'hjkm', Y: 'hjl',
  Z: 'ajkd', '-': 'g1g2', ' ': '',
};

const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'] as const;
type Segment = (typeof SEGMENTS)[number];

const litSet = (spec: string) => new Set(spec.match(/g[12]|[a-m]/g) ?? []);
const LIT_BY_CHAR = Object.fromEntries(Object.entries(GLYPHS).map(([c, s]) => [c, litSet(s)]));

type Pt = [number, number];

/** A segment from p1 to p2: half-width t/2, ends tapered over min(t/2, L/4). */
function hexagon(p1: Pt, p2: Pt, t: number): string {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const h = t / 2;
  const c = Math.min(h, len * 0.25);
  const p = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return [
    p(...p1),
    p(p1[0] + ux * c + nx * h, p1[1] + uy * c + ny * h),
    p(p2[0] - ux * c + nx * h, p2[1] - uy * c + ny * h),
    p(...p2),
    p(p2[0] - ux * c - nx * h, p2[1] - uy * c - ny * h),
    p(p1[0] + ux * c - nx * h, p1[1] + uy * c - ny * h),
  ].join(' ');
}

/** The fourteen polygons for one glyph height. They never change, so they are made once. */
const shapes = new Map<number, Record<Segment, string>>();
function shapesFor(H: number): Record<Segment, string> {
  const cached = shapes.get(H);
  if (cached) return cached;
  const t = H * 0.085;
  const w = H * 0.66;
  const g = t * 0.55;
  const d = t * 0.95;
  const C = w / 2;
  const M = H / 2;
  const ends: Record<Segment, [Pt, Pt]> = {
    a: [[g, 0], [w - g, 0]],
    d: [[g, H], [w - g, H]],
    f: [[0, g], [0, M - g]],
    e: [[0, M + g], [0, H - g]],
    b: [[w, g], [w, M - g]],
    c: [[w, M + g], [w, H - g]],
    g1: [[g, M], [C - g, M]],
    g2: [[C + g, M], [w - g, M]],
    i: [[C, g], [C, M - g]],
    l: [[C, M + g], [C, H - g]],
    h: [[d, d], [C - d * 0.8, M - d]],
    j: [[w - d, d], [C + d * 0.8, M - d]],
    k: [[d, H - d], [C - d * 0.8, M + d]],
    m: [[w - d, H - d], [C + d * 0.8, M + d]],
  };
  const out = {} as Record<Segment, string>;
  for (const s of SEGMENTS) out[s] = hexagon(ends[s][0], ends[s][1], t);
  shapes.set(H, out);
  return out;
}

/** Upper case, accents folded to the plain letter, anything else a blank. */
export function segmentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z -]/g, ' ');
}

/** The width an SVG of `cells` cells at glyph height `height` comes out at. */
export const segmentWidth = (cells: number, height: number) => height * (0.34 + cells);

interface Props {
  text: string;
  /** Glyph height in px. */
  height: number;
  /** Cells to draw; the text is padded with blanks. Defaults to its length. */
  cells?: number;
  /** Cell indexes that get a colon after them. */
  colonAfter?: number[];
  /** Draw the unlit segments faintly. */
  ghost?: boolean;
  /** What a screen reader hears; defaults to the text. */
  label?: string;
  className?: string;
}

function NightdriveSegments({ text, height: H, cells, colonAfter, ghost = true, label, className }: Props) {
  const chars = segmentText(text);
  const n = Math.max(cells ?? chars.length, 1);
  const t = H * 0.085;
  const w = H * 0.66;
  const pad = t * 2;
  const shape = shapesFor(H);
  const width = pad * 2 + n * H;
  const tall = H + pad * 2;

  const glyphs = [];
  for (let i = 0; i < n; i++) {
    const lit = LIT_BY_CHAR[chars[i] ?? ' '] ?? LIT_BY_CHAR[' '];
    const x = pad + i * H;
    glyphs.push(
      <g key={i} transform={`translate(${x.toFixed(2)},${pad.toFixed(2)}) skewX(-7)`}>
        {SEGMENTS.map((s) =>
          lit.has(s) ? (
            <polygon key={s} fill={LIT} points={shape[s]} />
          ) : ghost ? (
            <polygon key={s} fill={GHOST} fillOpacity={0.08} points={shape[s]} />
          ) : null,
        )}
      </g>,
    );
    if (colonAfter?.includes(i)) {
      const cx = x + w + (H - w) / 2 - H * 0.02;
      glyphs.push(
        <g key={`colon-${i}`} fill={LIT}>
          <circle cx={cx + 1} cy={pad + H * 0.3} r={t * 0.6} />
          <circle cx={cx - 1} cy={pad + H * 0.72} r={t * 0.6} />
        </g>,
      );
    }
  }

  return (
    <svg
      className={`nd-seg${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width.toFixed(1)} ${tall.toFixed(1)}`}
      width={Math.round(width)}
      height={Math.round(tall)}
      role="img"
      aria-label={label ?? text}
    >
      {glyphs}
    </svg>
  );
}

export default memo(NightdriveSegments);
