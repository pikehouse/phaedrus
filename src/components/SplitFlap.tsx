import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import '../styles/splitflap.css';

/** Drums, in the order the flaps are stacked. Advancing always goes forward.
    Numeric columns get their own short drum so a 9 -> 0 tick is one flap, not
    a trip through the whole alphabet — which is how real boards are built. */
const DRUMS = {
  text: ` ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:'"!?&-+/()#@$%·`,
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

/* A real board every so often re-seats a flap that didn't quite catch: one
   card turns over and lands on the character it was already showing. Rare
   enough to read as mechanism rather than noise. Set TIC to false to disable. */
const TIC = true;
const TIC_MIN_MS = 40_000;
const TIC_MAX_MS = 90_000;

/** `custom` sets no cell size of its own, so --flap-w/-h/-fs inherit from
    whatever the row sits in (the board's departure table sizes its grid). */
type Size = 'xl' | 'lg' | 'md' | 'sm' | 'custom';

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
  /** Let this row occasionally re-seat one of its flaps while it sits idle. */
  tic?: boolean;
  /**
   * Shrink cells (never grow them) so the text wraps into at most `lines`
   * rows without a word running past the column. `to` sizes against several
   * texts at once, so a cycling line keeps one cell size for all of them.
   */
  fit?: { lines: number; min: number; to?: string[] };
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
  /** The DOM node this state last painted; a word re-split remounts cells. */
  node?: HTMLSpanElement;
}

export default function SplitFlap({
  text,
  size = 'md',
  cells,
  className,
  drum = 'text',
  instant,
  tic,
  fit,
}: Props) {
  const reduced = useReducedMotion();
  const target = useMemo(() => normalize(text, drum, cells), [text, drum, cells]);
  const words = useMemo(() => groupWords(target), [target]);
  const rowRef = useRef<HTMLSpanElement>(null);
  const state = useRef<CellState[]>([]);
  const rootRef = useRef<HTMLSpanElement>(null);

  const fitTexts = fit ? (fit.to?.length ? fit.to : [text]) : null;
  const fitKey = fit && fitTexts ? `${fit.lines}|${fit.min}|${fitTexts.join('\u0001')}` : '';

  useLayoutEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!fit || !fitTexts || !root || !host) return;
    const { lines, min } = fit;
    const layouts = fitTexts.map((t) => groupWords(normalize(t, drum, cells)).map((w) => w.length));
    let lastWidth = -1;

    const apply = () => {
      const width = host.clientWidth;
      if (width === lastWidth || width === 0) return;
      lastWidth = width;
      root.style.removeProperty('--flap-w');
      root.style.removeProperty('--flap-h');
      root.style.removeProperty('--flap-fs');
      const probe = root.querySelector<HTMLElement>('.flap');
      const row = root.querySelector<HTMLElement>('.flaps-row');
      if (!probe || !row || !probe.offsetWidth) return;
      const baseW = probe.offsetWidth;
      const baseH = probe.offsetHeight;
      const glyphEl = probe.querySelector<HTMLElement>('.flap-glyph');
      const baseFs = glyphEl ? parseFloat(getComputedStyle(glyphEl).fontSize) || baseW : baseW;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const w = fitCell(layouts, width, gap, baseW, lines, min);
      if (w >= baseW) return;
      root.style.setProperty('--flap-w', `${w}px`);
      root.style.setProperty('--flap-h', `${(w * baseH) / baseW}px`);
      root.style.setProperty('--flap-fs', `${(w * baseFs) / baseW}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
    // fitKey captures fit and the texts; the rest are the normalize inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, drum, cells]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const flaps = [...row.querySelectorAll<HTMLSpanElement>('.flap')];
    let staggerSlot = 0;

    target.forEach((to, i) => {
      const parts = read(flaps[i]);
      if (!parts) return;

      const cell = (state.current[i] ??= { shown: ' ', target: ' ' });
      // When the word breaks shift, React remounts this cell with empty glyphs.
      // Paint what it was showing and drop any chain still writing to the old node.
      if (cell.node !== flaps[i]) {
        if (cell.node) {
          clearTimeout(cell.timer);
          cell.timer = undefined;
          write(parts, cell.shown);
        }
        cell.node = flaps[i];
      }
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
      if (instant) {
        write(parts, to);
        cell.shown = to;
        return;
      }
      if (reduced) {
        // The information still turns over; the clatter doesn't.
        flip(parts, cell.shown, to);
        cell.shown = to;
        cell.timer = window.setTimeout(() => {
          write(parts, to);
          cell.timer = undefined;
        }, STEP_MS);
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
  }, [target, drum, instant, reduced]);

  useEffect(() => {
    if (!tic || !TIC) return;
    if (reduced) return;

    let timer: number | undefined;

    const schedule = () => {
      if (document.hidden) return; // nothing to see, nothing to run
      timer = window.setTimeout(fire, TIC_MIN_MS + Math.random() * (TIC_MAX_MS - TIC_MIN_MS));
    };

    const fire = () => {
      timer = undefined;
      const row = rowRef.current;
      if (row && !document.hidden) {
        // Only cells that are settled on a visible character are candidates.
        const idle = [...row.querySelectorAll<HTMLSpanElement>('.flap')]
          .map((el, i) => ({ el, cell: state.current[i] }))
          .filter((c) => c.cell && c.cell.timer === undefined && c.cell.shown !== ' ');
        const pick = idle[Math.floor(Math.random() * idle.length)];
        const parts = pick && read(pick.el);
        if (pick?.cell && parts) {
          const c = pick.cell.shown;
          const cell = pick.cell;
          flip(parts, c, c); // over and back onto the same character
          cell.timer = window.setTimeout(() => {
            write(parts, c);
            cell.timer = undefined;
          }, STEP_MS);
        }
      }
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        schedule();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced, tic]);

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
    <span className={`flaps flaps-${size}${className ? ` ${className}` : ''}`} ref={rootRef}>
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

/** Rows a greedy word wrap needs at `perRow` cells, or Infinity if a word can't fit. */
function rowsFor(words: number[], perRow: number): number {
  let rows = 1;
  let used = 0;
  for (const n of words) {
    if (n > perRow) return Infinity;
    if (used + n <= perRow) used += n;
    else {
      rows++;
      used = n;
    }
  }
  return rows;
}

/** Largest cell width (px, at most `base`) at which every layout fits. */
function fitCell(layouts: number[][], width: number, gap: number, base: number, lines: number, min: number): number {
  const fits = (w: number) => {
    const perRow = Math.floor((width + gap) / (w + gap));
    return layouts.every((words) => rowsFor(words, perRow) <= lines);
  };
  if (fits(base)) return base;
  for (let w = Math.floor(base) - 1; w > min; w--) if (fits(w)) return w;
  return min;
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
