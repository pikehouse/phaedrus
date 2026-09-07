import { create } from 'zustand';

export type Skin = 'hifi' | 'board' | 'tuner';

export const SKINS: { id: Skin; label: string; hint: string }[] = [
  { id: 'hifi', label: 'Hi-Fi', hint: 'Late night, warm lamp, a record spinning' },
  { id: 'board', label: 'Board', hint: 'Station enamel, split-flaps, hard light' },
  { id: 'tuner', label: 'Tuner', hint: '1988 black faceplate, glowing green display' },
];

const KEY = 'phaedrus.skin';

function recall(): Skin {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'hifi' || v === 'board' || v === 'tuner') return v;
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
