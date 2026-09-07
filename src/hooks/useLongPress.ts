import { useCallback, useEffect, useRef } from 'react';

/** How far a finger may drift before a press stops being a press. */
const SLOP_PX = 10;

/**
 * A press held still for `ms` fires `onLong`. The click the browser sends
 * when that finger lifts is then already spoken for: ask `consumed()` in the
 * click handler and step aside when it says so.
 */
export function useLongPress(onLong: () => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const latest = useRef(onLong);

  useEffect(() => {
    latest.current = onLong;
  }, [onLong]);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      cancel();
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        fired.current = true;
        latest.current();
      }, ms);
    },
    [cancel, ms],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (timer.current === undefined) return;
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > SLOP_PX) cancel();
    },
    [cancel],
  );

  /** True exactly once, for the click that follows a long press. */
  const consumed = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return {
    consumed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  };
}
