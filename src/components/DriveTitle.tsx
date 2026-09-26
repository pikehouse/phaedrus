import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════════════════════
   THE NEON SIGN

   A bent tube, not a painted letter: the face is a stroked outline with
   almost no fill, and the glow is a drop-shadow of whatever is actually
   drawn — so it follows the tube, and when one letter dips its light dips
   with it. Each letter is its own span for exactly that reason; Archivo caps
   with tracking give up nothing to the split.
   ══════════════════════════════════════════════════════════════════════════ */

const SIZES = [64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24];
/** A one-line sign at this size or larger beats a two-line sign at any size. */
const ONE_LINE_MIN = 40;
const LINE = 1.1; // must match .drive-title line-height
const DIP_MS = 120;
const DIP_MIN_S = 45;
const DIP_MAX_S = 120;

interface Props {
  text: string;
  /** Off when nothing is on: the tube is there, but dark. */
  lit: boolean;
}

export default function DriveTitle({ text, lit }: Props) {
  const box = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState(SIZES[0]);
  const [dip, setDip] = useState<number | null>(null);
  const chars = useMemo(() => [...text], [text]);
  const reduced = useReducedMotion();

  // One line when it fits at a proper size; otherwise two lines, balanced so
  // nothing is left hanging on its own. Never an ellipsis: a sign that runs
  // out of room is bent smaller. The lockup's own height is a limit too — the
  // sign must never climb out of the sky it is hung in.
  useLayoutEffect(() => {
    const h = box.current;
    if (!h) return;
    const lockup = h.parentElement;
    const fits = (s: number, lines: number) => {
      h.style.fontSize = `${s}px`;
      if (Math.round(h.offsetHeight / (s * LINE)) > lines) return false;
      if (!lockup) return true;
      let used = 0;
      for (const c of lockup.children) {
        const cs = getComputedStyle(c);
        used += (c as HTMLElement).offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      }
      return used <= lockup.clientHeight + 1;
    };
    const fit = () => {
      let pick = SIZES.find((s) => s >= ONE_LINE_MIN && fits(s, 1));
      if (pick === undefined) pick = SIZES.find((s) => fits(s, 2));
      if (pick === undefined) pick = SIZES[SIZES.length - 1];
      h.style.fontSize = `${pick}px`;
      setSize(pick);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (lockup) ro.observe(lockup);
    // The first fit may have measured a fallback face: fit again once the web font is in.
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) fit();
    });
    document.fonts.addEventListener('loadingdone', fit);
    return () => {
      alive = false;
      ro.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    };
  }, [text]);

  // Once every minute or two, one letter loses its arc for 120 ms.
  useEffect(() => {
    if (!lit || reduced) return;
    const candidates = chars.map((c, i) => (/\S/.test(c) ? i : -1)).filter((i) => i >= 0);
    if (candidates.length === 0) return;
    let timer = 0;
    let end = 0;
    const schedule = () => {
      timer = window.setTimeout(fire, (DIP_MIN_S + Math.random() * (DIP_MAX_S - DIP_MIN_S)) * 1000);
    };
    const fire = () => {
      setDip(candidates[Math.floor(Math.random() * candidates.length)]);
      end = window.setTimeout(() => setDip(null), DIP_MS);
      schedule();
    };
    const onVisibility = () => {
      clearTimeout(timer);
      clearTimeout(end);
      setDip(null);
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) schedule();
    return () => {
      clearTimeout(timer);
      clearTimeout(end);
      document.removeEventListener('visibilitychange', onVisibility);
      setDip(null);
    };
  }, [chars, lit, reduced]);

  return (
    <h1
      ref={box}
      className={`drive-title${lit ? ' is-lit' : ''}`}
      style={{ fontSize: `${size}px` }}
      aria-label={text}
    >
      {chars.map((c, i) => (
        <span key={i} className={`drive-title-ch${i === dip ? ' is-dip' : ''}`} aria-hidden="true">
          {c}
        </span>
      ))}
    </h1>
  );
}
