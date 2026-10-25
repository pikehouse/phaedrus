import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET WHEEL

   The wheel is the control. Its anatomy is the first-generation one: a ring
   of four buttons (menu at the top, back and forward at the sides, play at
   the bottom) around a dished wheel that turns, around a separate centre
   button.

   Turning: a pointer pressed anywhere on the ring or the wheel and dragged
   around it turns it. The angle is accumulated move by move, each step
   wrapped into (−180°, 180°], so a full circle (or ten) is just more turning
   and there is no jump at the seam where atan2 flips sign. Every `step`
   degrees is a detent, reported as one tick (clockwise positive). Near the
   middle the angle means nothing, so moves inside the centre button's radius
   are not counted.

   Pressing: a press that never turned is a click: inside the centre button
   it selects; anywhere else on the ring or the wheel it is whichever of the
   four buttons sits in that quadrant (generous on purpose — a thumb doesn't
   hit a 1 cm arc).

   A mouse wheel or trackpad over it turns it too. Each of the five buttons is
   also a real, focusable button for the keyboard, and the wheel itself is a
   slider that arrow keys turn.
   ══════════════════════════════════════════════════════════════════════════ */

export type WheelButton = 'menu' | 'prev' | 'next' | 'play' | 'select';

/** The centre button's radius as a fraction of the whole wheel's. */
export const CENTRE_R = 0.3;
/** Where the ring of buttons begins. */
export const RING_R = 0.77;

const TURN_START = (9 * Math.PI) / 180; // a drag must turn this far to count
const DEAD_R = 0.2; // inside this, angles are noise

interface Track {
  id: number;
  zone: 'centre' | 'ring';
  last: number;
  total: number;
  acc: number;
  turning: boolean;
  button: WheelButton;
}

function compass(angle: number): WheelButton {
  // angle from atan2 with y pointing down: 0 = right, π/2 = bottom.
  const a = ((angle * 180) / Math.PI + 360) % 360;
  if (a >= 45 && a < 135) return 'play';
  if (a >= 135 && a < 225) return 'prev';
  if (a >= 225 && a < 315) return 'menu';
  return 'next';
}

const wrap = (d: number) => {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

export default function PocketWheel({
  mode,
  step,
  onTurn,
  onTurnEnd,
  onPress,
  onTouch,
  skips,
  playing,
  valueText,
  children,
}: {
  /** What turning does: the volume on Now Playing, the highlight in a menu. */
  mode: 'volume' | 'menu';
  /** Degrees per detent. */
  step: number;
  onTurn: (ticks: number) => void;
  /** The turning has stopped (for the volume's final, settled value). */
  onTurnEnd: () => void;
  onPress: (b: WheelButton) => void;
  /** Any contact at all: wakes the backlight. */
  onTouch: () => void;
  /** Back and forward do something (not on a radio station). */
  skips: boolean;
  playing: boolean;
  valueText: string;
  children?: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const turn = useRef(0); // degrees the wheel has visibly turned
  const [pressed, setPressed] = useState<WheelButton | null>(null);
  const wheelAcc = useRef(0);
  const wheelEnd = useRef<number | undefined>(undefined);

  // The latest callbacks, for the native wheel listener.
  const live = useRef({ mode, step, onTurn, onTurnEnd, onTouch });
  live.current = { mode, step, onTurn, onTurnEnd, onTouch };

  const spin = (deg: number) => {
    turn.current += deg;
    disc.current?.style.setProperty('--pk-turn', `${turn.current.toFixed(2)}deg`);
  };

  const geometry = (x: number, y: number) => {
    const r = root.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    return { angle: Math.atan2(dy, dx), radius: Math.hypot(dx, dy) / (r.width / 2) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const { angle, radius } = geometry(e.clientX, e.clientY);
    if (radius > 1.04) return;
    e.preventDefault();
    root.current!.setPointerCapture(e.pointerId);
    const zone = radius < CENTRE_R ? 'centre' : 'ring';
    const button = zone === 'centre' ? 'select' : compass(angle);
    track.current = { id: e.pointerId, zone, last: angle, total: 0, acc: 0, turning: false, button };
    setPressed(button);
    onTouch();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    const { angle, radius } = geometry(e.clientX, e.clientY);
    const d = wrap(angle - t.last);
    t.last = angle;
    if (radius < DEAD_R) return; // through the middle: no meaningful angle
    t.total += d;
    if (!t.turning && Math.abs(t.total) >= TURN_START) {
      t.turning = true;
      t.acc = t.total; // the first few degrees count too
      setPressed(null);
      spin((t.total * 180) / Math.PI);
    } else if (t.turning) {
      t.acc += d;
      spin((d * 180) / Math.PI);
    }
    if (!t.turning) return;
    const stepRad = (step * Math.PI) / 180;
    let ticks = 0;
    while (t.acc >= stepRad) {
      ticks++;
      t.acc -= stepRad;
    }
    while (t.acc <= -stepRad) {
      ticks--;
      t.acc += stepRad;
    }
    if (ticks) {
      onTurn(ticks);
      onTouch();
    }
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    track.current = null;
    setPressed(null);
    if (t.turning) onTurnEnd();
    else if (!cancelled) onPress(t.button);
  };

  // The mouse wheel and the trackpad. Native, so it can stop the page scrolling.
  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { mode: m, step: s, onTurn: turnBy, onTurnEnd: end, onTouch: touch } = live.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      // Down the list is clockwise; so is louder, which a wheel rolled up means.
      wheelAcc.current += m === 'menu' ? d : -d;
      const per = m === 'menu' ? 26 : 9; // px of scroll per detent
      let ticks = Math.trunc(wheelAcc.current / per);
      if (ticks) {
        wheelAcc.current -= ticks * per;
        const cap = m === 'menu' ? 3 : 4; // one fat notch is not a whole page
        ticks = Math.max(-cap, Math.min(cap, ticks));
        turnBy(ticks);
        spin(ticks * s);
      }
      touch();
      clearTimeout(wheelEnd.current);
      wheelEnd.current = window.setTimeout(() => {
        wheelAcc.current = 0;
        end();
      }, 260);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(wheelEnd.current);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let ticks = 0;
    switch (e.key) {
      case 'ArrowRight':
        ticks = 1;
        break;
      case 'ArrowLeft':
        ticks = -1;
        break;
      case 'ArrowDown':
        ticks = mode === 'menu' ? 1 : -1;
        break;
      case 'ArrowUp':
        ticks = mode === 'menu' ? -1 : 1;
        break;
      case 'PageDown':
        ticks = mode === 'menu' ? 6 : -10;
        break;
      case 'PageUp':
        ticks = mode === 'menu' ? -6 : 10;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onTouch();
        onPress('select');
        return;
      case 'Backspace':
        e.preventDefault();
        onTouch();
        onPress('menu');
        return;
      case 'Escape':
        if (mode === 'menu') {
          e.preventDefault();
          onTouch();
          onPress('menu');
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    onTouch();
    onTurn(mode === 'volume' ? ticks * 2 : ticks);
    spin(ticks * step);
    clearTimeout(wheelEnd.current);
    wheelEnd.current = window.setTimeout(onTurnEnd, 260);
  };

  /** Keyboard (and assistive tech) clicks; pointer clicks are the wheel's. */
  const key = (b: WheelButton) => (e: React.MouseEvent) => {
    if (e.detail !== 0) return;
    onTouch();
    onPress(b);
  };

  return (
    <div
      ref={root}
      className="pk-wheel"
      data-pressed={pressed ?? undefined}
      data-skips={skips ? undefined : 'off'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
    >
      <div
        className="pk-wheel-turn"
        role="slider"
        tabIndex={0}
        aria-label={mode === 'volume' ? 'Click wheel: turn for volume' : 'Click wheel: turn to move through the menu'}
        aria-valuemin={mode === 'volume' ? 0 : undefined}
        aria-valuemax={mode === 'volume' ? 100 : undefined}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
      >
        <div className="pk-ring" aria-hidden="true">
          <i className="pk-ring-gloss" />
          <i className="pk-seg pk-seg-menu" />
          <i className="pk-seg pk-seg-next" />
          <i className="pk-seg pk-seg-play" />
          <i className="pk-seg pk-seg-prev" />
          <i className="pk-ring-seams" />
          <span className="pk-legend pk-legend-menu">menu</span>
          <svg className="pk-legend pk-legend-prev" viewBox="0 0 20 10">
            <path d="M2 1h1.6v8H2zM11 1v8L4.2 5zM18.6 1v8L11.8 5z" />
          </svg>
          <svg className="pk-legend pk-legend-next" viewBox="0 0 20 10">
            <path d="M18 1h-1.6v8H18zM9 1v8l6.8-4zM1.4 1v8l6.8-4z" />
          </svg>
          <svg className="pk-legend pk-legend-play" viewBox="0 0 22 10">
            <path d="M2 1v8l7-4zM12.4 1h2.4v8h-2.4zM17.2 1h2.4v8h-2.4z" />
          </svg>
        </div>
        <i className="pk-gap pk-gap-outer" aria-hidden="true" />
        <div className="pk-disc" ref={disc} aria-hidden="true">
          <i className="pk-disc-turn" />
          <i className="pk-disc-dish" />
          <i className="pk-disc-gloss" />
        </div>
        <i className="pk-gap pk-gap-inner" aria-hidden="true" />
        <div className="pk-centre" aria-hidden="true">
          <i className="pk-centre-dish" />
        </div>
        {children}
      </div>

      {/* The five buttons, for keys and screen readers. Pointers go through the wheel. */}
      <button type="button" className="pk-key pk-key-menu" aria-label="Menu" onClick={key('menu')} />
      <button type="button" className="pk-key pk-key-prev" aria-label="Previous track" disabled={!skips} onClick={key('prev')} />
      <button type="button" className="pk-key pk-key-next" aria-label="Next track" disabled={!skips} onClick={key('next')} />
      <button type="button" className="pk-key pk-key-play" aria-label={playing ? 'Pause' : 'Play'} onClick={key('play')} />
      <button type="button" className="pk-key pk-key-select" aria-label="Select" onClick={key('select')} />
    </div>
  );
}
