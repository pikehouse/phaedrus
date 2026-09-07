import { useSyncExternalStore } from 'react';

export type Shell = 'phone' | 'desk';

/**
 * Which shell to render. Two media queries decide — a narrow window, or a
 * touch screen that is not tablet-wide — so React only hears from this when
 * a threshold is crossed, never for every pixel of a window drag.
 */
const PHONE = ['(max-width: 759.98px)', '(pointer: coarse) and (max-width: 999.98px)'].map((q) =>
  window.matchMedia(q),
);

function subscribe(onChange: () => void) {
  for (const q of PHONE) q.addEventListener('change', onChange);
  return () => {
    for (const q of PHONE) q.removeEventListener('change', onChange);
  };
}

const read = (): Shell => (PHONE.some((q) => q.matches) ? 'phone' : 'desk');

export function useViewport(): Shell {
  return useSyncExternalStore(subscribe, read, () => 'desk');
}
