import { create } from 'zustand';
import type { PlayAction } from '../api/types';

/** What a tap on a song, album, playlist or station does. */
export type TapAction = Extract<PlayAction, 'replace' | 'next' | 'later'>;

export interface Settings {
  tapAction: TapAction;
}

const KEY = 'phaedrus.settings';
const DEFAULTS: Settings = { tapAction: 'replace' };

function recall(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Settings>;
    const tap = v.tapAction;
    return { tapAction: tap === 'next' || tap === 'later' || tap === 'replace' ? tap : DEFAULTS.tapAction };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...recall(),
  set(patch) {
    set(patch);
    const { tapAction } = { ...get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify({ tapAction }));
    } catch {
      /* private mode: the choice lasts until the window closes */
    }
  },
}));

/** Whether the Settings sheet is up. Not persisted: it always starts closed. */
export const useSettingsPanel = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen(open) {
    set({ open });
  },
}));
