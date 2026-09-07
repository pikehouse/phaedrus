import { useEffect, useRef, useState } from 'react';
import '../styles/artpanel.css';

const FLIP_MS = 460;

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
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const next = art ?? '';
    if (shown.current === next) return;
    const first = shown.current === undefined;
    shown.current = next;
    setBroken(false);

    const set = (el: HTMLImageElement | null, src: string) => {
      if (!el) return;
      el.style.visibility = src ? 'visible' : 'hidden';
      if (src) el.src = src;
    };

    if (first || !leafTop.current || !leafBottom.current) {
      set(top.current, next);
      set(bottom.current, next);
      return;
    }

    const previous = bottom.current?.src ?? '';
    set(top.current, next); // revealed as the old top falls
    set(leafTopImg.current, previous);
    set(leafBottomImg.current, next);
    leafTop.current.style.opacity = '1';
    leafBottom.current.style.opacity = '1';

    const half = FLIP_MS / 2;
    leafTop.current.animate(
      [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
      { duration: half, easing: 'cubic-bezier(0.45, 0, 0.9, 0.55)', fill: 'forwards' },
    );
    const drop = leafBottom.current.animate(
      [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
      { duration: half, delay: half, easing: 'cubic-bezier(0.2, 0.85, 0.35, 1)', fill: 'forwards' },
    );
    drop.onfinish = () => {
      set(bottom.current, next);
      if (leafTop.current) leafTop.current.style.opacity = '0';
      if (leafBottom.current) leafBottom.current.style.opacity = '0';
    };
  }, [art]);

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
        <span className="artpanel-slot" aria-hidden="true" />
      </div>
      <span className="artpanel-rail" aria-hidden="true" />
    </div>
  );
}
