import { useEffect, useMemo, useRef } from 'react';
import '../styles/splitflap.css';

/** Drums, in the order the flaps are stacked. Advancing always goes forward.
    Numeric columns get their own short drum so a 9 -> 0 tick is one flap, not
    a trip through the whole alphabet — which is how real boards are built. */
const DRUMS = {
  text: ` ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:'"!?&-+/()#@$%`,
  digits: ' 0123456789:',
} as const;

type DrumId = keyof typeof DRUMS;

const INDEXES: Record<DrumId, Map<string, number>> = {
  text: new Map([...DRUMS.text].map((c, i) => [c, i])),
  digits: new Map([...DRUMS.digits].map((c, i) => [c, i])),
};

const STEP_MS = 46; // one flap
const MAX_STEPS = 12; // cap the clatter; a full drum would take four seconds
const STAGGER_MS = 22; // per cell, left to right

type Size = 'xl' | 'lg' | 'md' | 'sm';

interface Props {
  text: string;
  size?: Size;
  /** Pad (or clip) to a fixed cell count — keeps clocks from reflowing. */
  cells?: number;
  className?: string;
  /** Which drum the cells are wound with. */
  drum?: DrumId;
  /** Skip the clatter and land immediately. */
  instant?: boolean;
}

function normalize(text: string, drum: DrumId, cells?: number): string[] {
  const index = INDEXES[drum];
  const out = [...text.toUpperCase()].map((c) => (index.has(c) ? c : c.trim() ? c : ' '));
  if (cells == null) return out;
  return out.slice(0, cells).concat(Array(Math.max(0, cells - out.length)).fill(' '));
}

/** Cells grouped into words (each trailing space rides with its word) so a
    long title breaks between words instead of mid-word, the way a real board
    with a fixed cell pitch is laid out. */
function groupWords(cells: string[]): number[][] {
  const words: number[][] = [];
  let current: number[] = [];
  cells.forEach((c, i) => {
    current.push(i);
    if (c === ' ') {
      words.push(current);
      current = [];
    }
  });
  if (current.length) words.push(current);
  return words;
}

interface Leaves {
  top: HTMLSpanElement;
  bottom: HTMLSpanElement;
  leafTop: HTMLSpanElement;
  leafBottom: HTMLSpanElement;
}

/**
 * What one cell is doing. `shown` is the character actually on the card right
 * now; `target` is where its chain is headed. Keeping both is what makes the
 * effect idempotent — a re-render with an unchanged target leaves a running
 * riffle alone instead of restarting it, so cells always converge. Restarting
 * them was what left the clock permanently chasing itself.
 */
interface CellState {
  shown: string;
  target: string;
  timer?: number;
}

export default function SplitFlap({
  text,
  size = 'md',
  cells,
  className,
  drum = 'text',
  instant,
}: Props) {
  const target = useMemo(() => normalize(text, drum, cells), [text, drum, cells]);
  const words = useMemo(() => groupWords(target), [target]);
  const rowRef = useRef<HTMLSpanElement>(null);
  const state = useRef<CellState[]>([]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flaps = [...row.querySelectorAll<HTMLSpanElement>('.flap')];
    let staggerSlot = 0;

    target.forEach((to, i) => {
      const parts = read(flaps[i]);
      if (!parts) return;

      const cell = (state.current[i] ??= { shown: ' ', target: ' ' });
      // Skip only if the card is already resting on the target, or a chain is
      // genuinely still running toward it. A chain that was cancelled (React's
      // StrictMode remount does exactly that) must be restarted, or the cell
      // stays frozen wherever the clatter happened to stop.
      if (cell.target === to && (cell.shown === to || cell.timer !== undefined)) return;

      clearTimeout(cell.timer);
      cell.target = to;

      if (cell.shown === to) {
        write(parts, to);
        return;
      }
      if (instant || reduced) {
        write(parts, to);
        cell.shown = to;
        return;
      }

      // Walk the drum forward from where the card actually is.
      const path = drumPath(cell.shown, to, drum);
      write(parts, path[0]);
      cell.shown = path[0];
      let step = 1;

      const advance = () => {
        const next = path[step++];
        flip(parts, cell.shown, next);
        cell.shown = next;
        cell.timer =
          step < path.length
            ? window.setTimeout(advance, STEP_MS)
            : window.setTimeout(() => {
                write(parts, to); // settle deterministically, not via onfinish
                cell.timer = undefined;
              }, STEP_MS);
      };
      cell.timer = window.setTimeout(advance, staggerSlot++ * STAGGER_MS);
    });

    state.current.length = target.length; // cells added or removed with the text
  }, [target, drum, instant]);

  // Only on unmount — a re-render must not cancel chains that are still landing.
  useEffect(
    () => () => {
      state.current.forEach((c) => {
        clearTimeout(c.timer);
        c.timer = undefined; // so a remount knows the chain is dead, not running
      });
    },
    [],
  );

  return (
    <span className={`flaps flaps-${size}${className ? ` ${className}` : ''}`}>
      <span className="flaps-row" ref={rowRef} aria-hidden="true">
        {words.map((word, w) => (
          <span className="flaps-word" key={w}>
            {word.map((i) => (
              <span className="flap" key={i}>
                <span className="flap-half flap-top">
                  <span className="flap-glyph" />
                </span>
                <span className="flap-half flap-bottom">
                  <span className="flap-glyph" />
                </span>
                <span className="flap-leaf flap-leaf-top">
                  <span className="flap-glyph" />
                </span>
                <span className="flap-leaf flap-leaf-bottom">
                  <span className="flap-glyph" />
                </span>
              </span>
            ))}
          </span>
        ))}
      </span>
      <span className="flaps-text">{text}</span>
    </span>
  );
}

/** Characters to pass through, inclusive of both ends. */
function drumPath(from: string, to: string, id: DrumId): string[] {
  const drum = DRUMS[id];
  const index = INDEXES[id];
  const a = index.get(from);
  const b = index.get(to);
  if (a == null || b == null) {
    // Off-drum character: clatter through a short run and land on it.
    const run = Array.from({ length: 5 }, (_, i) => drum[(i * 7 + 3) % drum.length]);
    return [...run, to];
  }
  const distance = (b - a + drum.length) % drum.length;
  const steps = Math.min(distance, MAX_STEPS);
  const start = (b - steps + drum.length) % drum.length;
  return Array.from({ length: steps + 1 }, (_, i) => drum[(start + i) % drum.length]);
}

function read(flap: HTMLSpanElement | undefined): Leaves | null {
  if (!flap) return null;
  const [top, bottom, leafTop, leafBottom] = [...flap.children] as HTMLSpanElement[];
  if (!top || !bottom || !leafTop || !leafBottom) return null;
  return { top, bottom, leafTop, leafBottom };
}

const glyph = (half: HTMLSpanElement, c: string) => {
  const g = half.firstElementChild as HTMLSpanElement | null;
  if (g) g.textContent = c === ' ' ? ' ' : c;
};

/** Cancelling (rather than letting them finish) keeps a stale onfinish from
    stamping a mid-drum character onto the bottom half after we've moved on,
    and stops finished fill:forwards animations piling up on the leaves. */
function stop(p: Leaves) {
  p.leafTop.getAnimations().forEach((a) => a.cancel());
  p.leafBottom.getAnimations().forEach((a) => a.cancel());
}

/** Settle the cell: both halves show `c`, no leaf in flight. Authoritative. */
function write(p: Leaves, c: string) {
  stop(p);
  glyph(p.top, c);
  glyph(p.bottom, c);
  p.leafTop.style.opacity = '0';
  p.leafBottom.style.opacity = '0';
}

/**
 * One flap: the old card's top half falls away revealing the new character,
 * then the new card's bottom half drops into place over the old one. Driven
 * with the Web Animations API so nothing re-renders and no classes get
 * thrashed twenty times a second.
 */
function flip(p: Leaves, from: string, to: string) {
  stop(p);
  glyph(p.top, to); // revealed as the leaf falls
  glyph(p.bottom, from); // still the old char until the bottom leaf lands
  glyph(p.leafTop, from);
  glyph(p.leafBottom, to);
  p.leafTop.style.opacity = '1';
  p.leafBottom.style.opacity = '1';

  const half = STEP_MS / 2;
  p.leafTop.animate(
    [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
    { duration: half, easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)', fill: 'forwards' },
  );
  p.leafBottom.animate(
    [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
    { duration: half, delay: half, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', fill: 'forwards' },
  );
}
