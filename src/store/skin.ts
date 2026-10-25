import { create } from 'zustand';

export type Skin = 'hifi' | 'board' | 'tuner' | 'drive' | 'daylight' | 'deck' | 'prism' | 'putty' | 'kissa' | 'nightdrive';

export const SKINS: { id: Skin; label: string; hint: string }[] = [
  { id: 'hifi', label: 'Hi-Fi', hint: 'Late night, warm lamp, a record spinning' },
  { id: 'board', label: 'Board', hint: 'Station enamel, split-flaps, hard light' },
  { id: 'tuner', label: 'Tuner', hint: '1988 black faceplate, glowing green display' },
  { id: 'drive', label: 'Drive', hint: 'LA at 2 a.m., neon script, sodium streetlights' },
  { id: 'daylight', label: 'Daylight', hint: 'Light, quiet, modern' },
  { id: 'deck', label: 'Deck', hint: 'DJ controller, orange LEDs, red waveforms' },
  { id: 'prism', label: 'Prism', hint: 'Light through glass, a spectrum on the wall' },
  { id: 'putty', label: 'Putty', hint: 'Soft hardware, warm greys, a little grain' },
  { id: 'kissa', label: 'Kissa', hint: 'A Tokyo listening bar at 1 a.m., records and glass' },
  { id: 'nightdrive', label: 'Nightdrive', hint: "'80s car stereo, orange keylight, brushed aluminium" },
];

const KEY = 'phaedrus.skin';

function recall(): Skin {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'hifi' || v === 'board' || v === 'tuner' || v === 'drive' || v === 'daylight' || v === 'deck' || v === 'prism' || v === 'putty' || v === 'kissa' || v === 'nightdrive') return v;
  } catch {
    /* private mode — fall through to the default */
  }
  return 'hifi';
}

/** The attribute the whole stylesheet keys off. Set before first paint. */
function apply(skin: Skin) {
  document.documentElement.setAttribute('data-skin', skin);
}

interface SkinStore {
  skin: Skin;
  setSkin: (skin: Skin) => void;
}

export const useSkin = create<SkinStore>((set) => ({
  skin: recall(),
  setSkin(skin) {
    apply(skin);
    try {
      localStorage.setItem(KEY, skin);
    } catch {
      /* the choice just won't survive a restart */
    }
    set({ skin });
  },
}));

// Paint the right skin before React mounts, so there is no first-frame flash.
apply(useSkin.getState().skin);
