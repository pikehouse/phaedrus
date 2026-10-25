import { useEffect } from 'react';
import { Bold, Small, layout, measure, type Face } from './pocketFont';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET LABELS — the LCD's type, outside the LCD

   The panels around the player are the app's own components, so their
   headings are DOM text. Where the LCD's bitmap face reads well (short
   headings: ROOMS, QUEUE, FAVOURITES …) the skin swaps the text for the
   face itself: each label is drawn once into a small canvas at four times
   its pixel size, and handed to CSS as a mask image in a custom property on
   <html>:

     --pk-t-<name>     url(data:image/png…), white ink on transparent
     --pk-t-<name>-w   its width in LCD pixels (unitless)
     --pk-t-<name>-h   its height in LCD pixels

   so a rule can paint it in any colour at any whole-pixel scale:

     mask: var(--pk-t-rooms) 0 0 / calc(var(--pk-t-rooms-w) * 2px) auto no-repeat;

   The properties are set while the Pocket skin is on screen and removed
   when it leaves, so no other skin ever sees them.
   ══════════════════════════════════════════════════════════════════════════ */

const SCALE = 4;

const LABELS: Record<string, [Face, string]> = {
  rooms: [Small, 'ROOMS'],
  queue: [Small, 'QUEUE'],
  crate: [Small, 'FAVOURITES'],
  search: [Small, 'SEARCH'],
  settings: [Small, 'SETTINGS'],
  volume: [Small, 'VOLUME'],
  everywhere: [Small, 'EVERYWHERE'],
  results: [Small, 'RESULTS'],
  brand: [Bold, 'Phædrus'],
  pocket: [Small, 'POCKET'],
  hold: [Small, 'HOLD'],
};

function render(face: Face, text: string): { url: string; w: number; h: number } | null {
  const w = measure(face, text);
  // Room for marks over capitals above, descenders below.
  const top = 3;
  const h = face.cap + face.desc + top;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w * SCALE);
  c.height = h * SCALE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  layout(face, text, 0, top, (x, y) => ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE));
  return { url: c.toDataURL('image/png'), w, h };
}

let made: Record<string, { url: string; w: number; h: number }> | null = null;
let users = 0;

function apply() {
  if (!made) {
    made = {};
    for (const [name, [face, text]] of Object.entries(LABELS)) {
      const r = render(face, text);
      if (r) made[name] = r;
    }
  }
  const s = document.documentElement.style;
  for (const [name, r] of Object.entries(made)) {
    s.setProperty(`--pk-t-${name}`, `url("${r.url}")`);
    s.setProperty(`--pk-t-${name}-w`, String(r.w));
    s.setProperty(`--pk-t-${name}-h`, String(r.h));
  }
}

function remove() {
  const s = document.documentElement.style;
  for (const name of Object.keys(LABELS)) {
    s.removeProperty(`--pk-t-${name}`);
    s.removeProperty(`--pk-t-${name}-w`);
    s.removeProperty(`--pk-t-${name}-h`);
  }
}

/** Publish the label images for as long as the calling component is mounted. */
export function usePocketLabels() {
  useEffect(() => {
    users++;
    apply();
    return () => {
      users--;
      if (users === 0) remove();
    };
  }, []);
}
