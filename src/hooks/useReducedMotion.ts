import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const q = window.matchMedia(QUERY);
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}

const read = () => window.matchMedia(QUERY).matches;

/**
 * Whether the OS asks for reduced motion — live, so turning the setting on
 * mid-session stills the skin without a reload.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
