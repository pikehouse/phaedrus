import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import '../styles/artpanel.css';

const FLIP_MS = 460;
/** How long the slot line lingers after the panel settles before fading out. */
const SLOT_LINGER_MS = 900;

interface Props {
  art?: string;
  title?: string;
  /** Drives the running-light strip along the bottom edge. */
  playing: boolean;
}

/**
 * The board skin's answer to the record: one oversized flap. When the track
 * changes the whole panel turns over — same mechanism as a character cell,
 * just carrying a picture instead of a glyph.
 */
export default function ArtPanel({ art, title, playing }: Props) {
  const top = useRef<HTMLImageElement>(null);
  const bottom = useRef<HTMLImageElement>(null);
  const leafTop = useRef<HTMLDivElement>(null);
  const leafBottom = useRef<HTMLDivElement>(null);
  const leafTopImg = useRef<HTMLImageElement>(null);
  const leafBottomImg = useRef<HTMLImageElement>(null);
  const shown = useRef<string | undefined>(undefined);
  const slot = useRef<HTMLSpanElement>(null);
  const slotTimer = useRef<number | undefined>(undefined);
  const flip = useRef<Animation[]>([]);
  const [broken, setBroken] = useState(false);
  const reduced = useReducedMotion();

  /* The slot is the mechanism: it belongs on screen while the panel is
     turning, and gets out of the way of the artwork once it has settled. */
  const showSlot = () => {
    const el = slot.current;
    if (!el) return;
    clearTimeout(slotTimer.current);
    el.style.transition = 'none';
    el.style.opacity = '1';
    void el.offsetHeight; // commit the jump before the fade can transition
    el.style.transition = '';
  };

  const retireSlot = (delay: number) => {
    clearTimeout(slotTimer.current);
    slotTimer.current = window.setTimeout(() => {
      if (slot.current) slot.current.style.opacity = '0';
    }, delay);
  };

  /* A flip still turning when the next art lands is stopped where it is:
     left alone, its onfinish would stamp the older cover over the new flip. */
  const cancelFlip = () => {
    for (const a of flip.current) {
      a.onfinish = null;
      a.cancel();
    }
    flip.current = [];
  };

  useEffect(
    () => () => {
      clearTimeout(slotTimer.current);
      cancelFlip();
    },
    [],
  );

  useEffect(() => {
    const next = art ?? '';
    if (shown.current === next) {
      // StrictMode re-runs this effect after clearing our timer; the art is
      // already on the card, so just make sure the slot still retires.
      retireSlot(SLOT_LINGER_MS);
      return;
    }
    const first = shown.current === undefined;
    const previous = shown.current ?? '';
    shown.current = next;
    setBroken(false);

    const set = (el: HTMLImageElement | null, src: string) => {
      if (!el) return;
      el.style.visibility = src ? 'visible' : 'hidden';
      // No art must leave no cover behind on the element, either.
      if (src) el.src = src;
      else el.removeAttribute('src');
    };

    cancelFlip();

    // Reduced motion swaps the card in place rather than turning it over.
    if (first || reduced || !leafTop.current || !leafBottom.current) {
      set(top.current, next);
      set(bottom.current, next);
      if (leafTop.current) leafTop.current.style.opacity = '0';
      if (leafBottom.current) leafBottom.current.style.opacity = '0';
      showSlot();
      retireSlot(SLOT_LINGER_MS);
      return;
    }

    showSlot();
    retireSlot(FLIP_MS + SLOT_LINGER_MS);

    set(top.current, next); // revealed as the old top falls
    set(bottom.current, previous); // an interrupted flip may not have landed it yet
    set(leafTopImg.current, previous);
    set(leafBottomImg.current, next);
    leafTop.current.style.opacity = '1';
    leafBottom.current.style.opacity = '1';

    const half = FLIP_MS / 2;
    const fall = leafTop.current.animate(
      [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
      { duration: half, easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)', fill: 'forwards' },
    );
    const drop = leafBottom.current.animate(
      [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
      { duration: half, delay: half, easing: 'cubic-bezier(0.2, 0.85, 0.35, 1)', fill: 'forwards' },
    );
    flip.current = [fall, drop];
    drop.onfinish = () => {
      flip.current = [];
      set(bottom.current, next);
      if (leafTop.current) leafTop.current.style.opacity = '0';
      if (leafBottom.current) leafBottom.current.style.opacity = '0';
    };
  }, [art, reduced]);

  const blank = !art || broken;

  return (
    <div className={`artpanel${playing ? ' is-running' : ''}`}>
      <div className={`artpanel-card${blank ? ' is-blank' : ''}`}>
        <div className="artpanel-half artpanel-top">
          <img ref={top} alt="" aria-hidden="true" draggable={false} onError={() => setBroken(true)} />
        </div>
        <div className="artpanel-half artpanel-bottom">
          <img ref={bottom} alt={title ? `Cover art for ${title}` : ''} draggable={false} />
        </div>
        <div className="artpanel-leaf artpanel-leaf-top" ref={leafTop}>
          <img ref={leafTopImg} alt="" aria-hidden="true" draggable={false} />
        </div>
        <div className="artpanel-leaf artpanel-leaf-bottom" ref={leafBottom}>
          <img ref={leafBottomImg} alt="" aria-hidden="true" draggable={false} />
        </div>
        {blank && <span className="artpanel-blank-mark">PHAEDRUS</span>}
        <span className="artpanel-slot" ref={slot} aria-hidden="true" />
      </div>
      <span className="artpanel-rail" aria-hidden="true" />
    </div>
  );
}
