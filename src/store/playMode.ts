import type { PlayMode } from '../api/types';

export type Repeat = 'off' | 'all' | 'one';

/** The 2x3 truth table behind Sonos's six flat PlayMode strings. */
const TABLE: Record<'off' | 'on', Record<Repeat, PlayMode>> = {
  off: { off: 'NORMAL', all: 'REPEAT_ALL', one: 'REPEAT_ONE' },
  on: { off: 'SHUFFLE_NOREPEAT', all: 'SHUFFLE', one: 'SHUFFLE_REPEAT_ONE' },
};

export function toPlayMode(shuffle: boolean, repeat: Repeat): PlayMode {
  return TABLE[shuffle ? 'on' : 'off'][repeat];
}

/** Takes any string: a mode we don't know reads as plain, never a crash. */
export function fromPlayMode(mode: string): { shuffle: boolean; repeat: Repeat } {
  switch (mode) {
    case 'NORMAL':
      return { shuffle: false, repeat: 'off' };
    case 'REPEAT_ALL':
      return { shuffle: false, repeat: 'all' };
    case 'REPEAT_ONE':
      return { shuffle: false, repeat: 'one' };
    case 'SHUFFLE_NOREPEAT':
      return { shuffle: true, repeat: 'off' };
    case 'SHUFFLE':
      // Sonos's "SHUFFLE" means shuffle + repeat all. It is not shuffle alone.
      return { shuffle: true, repeat: 'all' };
    case 'SHUFFLE_REPEAT_ONE':
      return { shuffle: true, repeat: 'one' };
    default:
      return { shuffle: false, repeat: 'off' };
  }
}

export function toggleShuffle(mode: PlayMode): PlayMode {
  const { shuffle, repeat } = fromPlayMode(mode);
  return toPlayMode(!shuffle, repeat);
}

/** off → all → one → off */
export function cycleRepeat(mode: PlayMode): PlayMode {
  const { shuffle, repeat } = fromPlayMode(mode);
  const next: Repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
  return toPlayMode(shuffle, next);
}
