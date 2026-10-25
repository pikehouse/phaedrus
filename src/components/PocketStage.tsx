import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { useSettingsPanel } from '../store/settings';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { cycleRepeat, fromPlayMode, toggleShuffle } from '../store/playMode';
import { clampVol } from '../lib/format';
import { dither } from '../lib/pocketArt';
import { Bitmap } from '../lib/pocketLcd';
import {
  drawMenu,
  drawNowPlaying,
  drawOverlay,
  drawStatus,
  follow,
  rowAt,
  ROWS,
  type MenuModel,
  type NowModel,
  type Overlay,
  type Row,
} from '../lib/pocketScreens';
import { usePocketLabels } from '../lib/pocketLabels';
import PocketLcd, { type Slide } from './PocketLcd';
import PocketWheel, { type WheelButton } from './PocketWheel';
import Progress from './Progress';
import Transport from './Transport';
import { useHidden } from './KissaStage';
import { version } from '../../package.json';
import '../styles/pocket.css';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET

   A white pocket music player from 2001, photographed on a dark desk with a
   macro lens: polycarbonate front, mirror-steel back catching the room, a
   grey-blue monochrome LCD, and the wheel.

   The wheel is the real control (PocketWheel). Turned on Now Playing it is
   the group's volume, and the LCD shows the volume bar; turned in a menu it
   moves the highlight. Centre selects (plays and pauses on Now Playing);
   menu goes back, or opens the menu; ⏮ ⏭ ⏯ do what they say.

   The LCD is a real little UI drawn pixel by pixel (pocketScreens), painted
   by PocketLcd. Touching anything lights its backlight; it fades back after
   nine idle seconds (or stays on, or never comes on: Settings › Backlight on
   the device itself).

   Motion — all slow, none of it while paused, hidden, or under reduced
   motion:
     · a soft highlight drifts across the glossy front once every ~40 s
       while music plays (CSS, `.is-alive` only);
     · the backlight fades in over 0.5 s and out over 2.6 s (a transition);
     · the LCD ghosts for ~200 ms when it changes and menus slide in ~230 ms
       (canvas, rAF only while settling; no slides under reduced motion);
     · long titles creep across once, then hold (no marquee under reduced
       motion; they are cut with an ellipsis instead).
   ══════════════════════════════════════════════════════════════════════════ */

type MenuId = 'root' | 'rooms' | 'queue' | 'favs' | 'settings' | 'about';
type Sheet = 'rooms' | 'queue' | 'crate' | 'volume';

interface Level {
  id: MenuId;
  sel: number;
  top: number;
  since: number;
}

interface Item {
  row: Row;
  enter?: MenuId;
  act?: () => void;
}

const TITLES: Record<MenuId, string> = {
  root: 'Phædrus',
  rooms: 'Rooms',
  queue: 'Queue',
  favs: 'Favourites',
  settings: 'Settings',
  about: 'About',
};

type Backlight = 'timer' | 'always' | 'off';
const BACKLIGHT_MS = 9000;
const PREFS = 'phaedrus.pocket';

function recallBacklight(): Backlight {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}').backlight;
    return v === 'always' || v === 'off' ? v : 'timer';
  } catch {
    return 'timer';
  }
}

function keepBacklight(b: Backlight) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ backlight: b }));
  } catch {
    /* private mode */
  }
}

const VOLUME_STEP_DEG = 5; // one point of volume per 5° turned: ~70 a turn
const MENU_STEP_DEG = 17; // a row per 17°: about 21 rows a turn
const OVERLAY_MS = 1800;

/** The earphone lead: up out of the socket, over, down past the right side
 *  and away across the desk. */
const LEAD = 'M41.5 45 C 41.5 40, 50 42, 68 42 C 100 42, 120 48, 124 90 C 128 146, 126 196, 140 220 C 152 238, 210 240, 300 236';
const LEAD_DESK = 'M134 226 C 150 244, 210 246, 300 242';
const HOLD_MS = 1400;

export function PocketDevice({ phone = false, onSheet }: { phone?: boolean; onSheet?: (s: Sheet) => void }) {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const topology = useSonos((s) => s.topology);
  const queue = useSonos((s) => s.queue);
  const queueTotal = useSonos((s) => s.queueTotal);
  const favorites = useSonos((s) => s.favorites);
  const receivedAt = useSonos((s) => s.receivedAt);
  const reduced = useReducedMotion();
  const hidden = useHidden();
  usePocketLabels();

  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const radio = !!state?.isRadio;

  // ── What the screen is showing ──────────────────────────────────────────
  const [screen, setScreen] = useState<'now' | 'menu'>('now');
  const [stack, setStack] = useState<Level[]>([{ id: 'root', sel: 0, top: 0, since: Date.now() }]);
  const [slideDir, setSlideDir] = useState<-1 | 0 | 1>(0);
  const [overlay, setOverlay] = useState<{ kind: 'volume' | 'hold'; until: number } | null>(null);
  const [hold, setHold] = useState(false);
  const [backlight, setBacklight] = useState<Backlight>(recallBacklight);
  const [lit, setLit] = useState(backlight !== 'off');
  const [artTick, setArtTick] = useState(0);
  const litTimer = useRef<number | undefined>(undefined);

  // ── The backlight ───────────────────────────────────────────────────────
  const wake = useCallback(() => {
    clearTimeout(litTimer.current);
    if (backlight === 'off') {
      setLit(false);
      return;
    }
    setLit(true);
    if (backlight === 'timer') litTimer.current = window.setTimeout(() => setLit(false), BACKLIGHT_MS);
  }, [backlight]);

  // Waking up: the light is on when the screen first appears, then settles.
  useEffect(() => {
    wake();
    return () => clearTimeout(litTimer.current);
  }, [wake]);

  // ── Track identity, for the marquee's clock ─────────────────────────────
  const title = radio ? (state?.stationName ?? track?.title ?? 'Radio') : (track?.title ?? '');
  const artist = radio ? track?.streamContent : track?.artist;
  const album = radio ? (track?.title && track.title !== state?.stationName ? track.title : undefined) : track?.album;
  const trackKey = `${title}\u0000${artist ?? ''}\u0000${album ?? ''}`;
  const since = useRef({ key: '', at: 0 });
  if (since.current.key !== trackKey) since.current = { key: trackKey, at: Date.now() };

  // ── Menus ───────────────────────────────────────────────────────────────
  const level = stack[stack.length - 1];

  const go = useCallback(
    (dir: -1 | 1, next: { screen: 'now' } | { push: MenuId; sel?: number } | { pop: true } | { menu: true }) => {
      setSlideDir(reduced ? 0 : dir);
      if ('screen' in next) {
        setScreen('now');
      } else if ('menu' in next) {
        setScreen('menu');
      } else if ('push' in next) {
        setScreen('menu');
        setStack((s) => [...s, { id: next.push, sel: next.sel ?? 0, top: follow(next.sel ?? 0, 0, 999), since: Date.now() }]);
      } else {
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
      }
    },
    [reduced],
  );

  const toNow = useCallback(() => {
    go(1, { screen: 'now' });
  }, [go]);

  const items = useMemo((): Item[] => {
    const s = useSonos.getState();
    const groups = topology?.groups ?? [];
    switch (level.id) {
      case 'root':
        return [
          { row: { label: 'Now Playing', child: true }, act: toNow },
          { row: { label: 'Rooms', child: true }, enter: 'rooms' },
          { row: { label: 'Queue', child: true }, enter: 'queue' },
          { row: { label: 'Favourites', child: true }, enter: 'favs' },
          { row: { label: 'Search…' }, act: () => s.setSearchOpen(true) },
          { row: { label: 'Settings', child: true }, enter: 'settings' },
        ];
      case 'rooms': {
        const rows: Item[] = groups.map((g) => ({
          row: {
            label: g.members.length > 1 ? `${g.name} + ${g.members.length - 1}` : g.name,
            mark: g.id === group?.id ? 'here' : undefined,
          },
          act: () => {
            s.selectGroup(g);
            toNow();
          },
        }));
        if (groups.length > 1) rows.push({ row: { label: 'Everywhere' }, act: () => void s.everywhere() });
        rows.push({
          row: { label: 'Arrange…' },
          act: () => (phone ? onSheet?.('rooms') : s.setArranging(true)),
        });
        if (phone) rows.push({ row: { label: 'Room Volumes…' }, act: () => onSheet?.('volume') });
        return rows;
      }
      case 'queue': {
        const rows: Item[] = queue.map((q) => ({
          row: { label: q.title, art: q.art, thumb: true, mark: q.index === state?.queueIndex ? 'now' : undefined },
          act: () => {
            void s.playQueueIndex(q.index);
            toNow();
          },
        }));
        if (phone && queue.length) rows.unshift({ row: { label: 'Edit Queue…' }, act: () => onSheet?.('queue') });
        return rows;
      }
      case 'favs': {
        const rows: Item[] = favorites.map((f) => ({
          row: { label: f.title, art: f.art, thumb: true, dim: !f.playable },
          act: f.playable
            ? () => {
                void s.playFavoriteTap(f);
                toNow();
              }
            : () => s.say(`${f.title} can't be played from here`),
        }));
        if (phone && favorites.length) rows.unshift({ row: { label: 'Covers…' }, act: () => onSheet?.('crate') });
        return rows;
      }
      case 'settings': {
        const mode = state?.playMode ?? 'NORMAL';
        const { shuffle, repeat } = fromPlayMode(mode);
        const off = !state || radio;
        return [
          {
            row: { label: 'Shuffle', value: shuffle ? 'On' : 'Off', dim: off },
            act: () => !off && void s.setPlayMode(toggleShuffle(mode)),
          },
          {
            row: { label: 'Repeat', value: repeat === 'off' ? 'Off' : repeat === 'one' ? 'One' : 'All', dim: off },
            act: () => !off && void s.setPlayMode(cycleRepeat(mode)),
          },
          {
            row: { label: 'Crossfade', value: state?.crossfade ? 'On' : 'Off', dim: off },
            act: () => !off && void s.setCrossfade(!state?.crossfade),
          },
          {
            row: { label: 'Backlight', value: backlight === 'timer' ? '9 Sec' : backlight === 'always' ? 'Always' : 'Off' },
            act: () => {
              const next: Backlight = backlight === 'timer' ? 'always' : backlight === 'always' ? 'off' : 'timer';
              setBacklight(next);
              keepBacklight(next);
            },
          },
          { row: { label: 'About', child: true }, enter: 'about' },
          { row: { label: 'All Settings…' }, act: () => useSettingsPanel.getState().setOpen(true) },
        ];
      }
      case 'about': {
        const rooms = groups.reduce((n, g) => n + g.members.length, 0);
        return [
          { row: { label: 'Phædrus', value: version } },
          { row: { label: 'Rooms', value: String(rooms) } },
          { row: { label: 'Groups', value: String(groups.length) } },
          { row: { label: 'Songs', value: String(queueTotal || queue.length) } },
          { row: { label: 'Favourites', value: String(favorites.length) } },
          { row: { label: 'Skin', value: 'Pocket' } },
        ];
      }
    }
  }, [level.id, topology, group?.id, queue, queueTotal, favorites, state, radio, phone, onSheet, toNow, backlight]);

  // Keep the highlight on a real row if the list shrinks under it.
  const sel = Math.min(level.sel, Math.max(0, items.length - 1));
  const top = follow(sel, level.top, items.length);

  const moveSel = useCallback(
    (ticks: number) => {
      setStack((s) => {
        const l = s[s.length - 1];
        const count = items.length;
        if (!count || l.id === 'about') return s;
        const nsel = Math.max(0, Math.min(count - 1, Math.min(l.sel, count - 1) + ticks));
        if (nsel === l.sel) return s;
        return [...s.slice(0, -1), { ...l, sel: nsel, top: follow(nsel, l.top, count), since: Date.now() }];
      });
    },
    [items.length],
  );

  const choose = useCallback(
    (index: number) => {
      const it = items[index];
      if (!it) return;
      if (it.enter) {
        const s = useSonos.getState();
        let start = 0;
        if (it.enter === 'queue') {
          const at = s.queue.findIndex((q) => q.index === s.state?.queueIndex);
          start = Math.max(0, at) + (phone && s.queue.length ? 1 : 0);
        } else if (it.enter === 'rooms') {
          start = Math.max(0, (s.topology?.groups ?? []).findIndex((g) => g.id === s.group?.id));
        }
        go(1, { push: it.enter, sel: start });
      } else {
        it.act?.();
      }
    },
    [items, go, phone],
  );

  // ── The wheel ───────────────────────────────────────────────────────────
  const setGroupVolume = useSonos((s) => s.setGroupVolume);

  const blocked = () => {
    if (!hold) return false;
    setOverlay({ kind: 'hold', until: Date.now() + HOLD_MS });
    return true;
  };

  const onTurn = (ticks: number) => {
    if (blocked()) return;
    if (screen === 'now') {
      const s = useSonos.getState().state;
      if (!s) return;
      void setGroupVolume(clampVol(s.volume + ticks));
      setOverlay({ kind: 'volume', until: Date.now() + OVERLAY_MS });
    } else {
      moveSel(ticks);
    }
  };

  const onTurnEnd = () => {
    if (hold || screen !== 'now') return;
    const s = useSonos.getState().state;
    if (s) void setGroupVolume(s.volume, true);
  };

  const onPress = (b: WheelButton) => {
    if (blocked()) return;
    const s = useSonos.getState();
    switch (b) {
      case 'menu':
        if (screen === 'now') go(-1, { menu: true });
        else if (stack.length > 1) go(-1, { pop: true });
        else toNow();
        break;
      case 'select':
        if (screen === 'now') void s.toggle();
        else choose(sel);
        break;
      case 'play':
        void s.toggle();
        break;
      case 'prev':
        if (!radio) void s.skipPrev();
        break;
      case 'next':
        if (!radio) void s.skipNext();
        break;
    }
  };

  const onTap = (_x: number, y: number) => {
    wake();
    if (blocked()) return;
    if (screen === 'now') {
      go(-1, { menu: true });
      return;
    }
    if (y < 14) {
      onPress('menu');
      return;
    }
    const idx = rowAt(y, top);
    if (idx < 0 || idx >= items.length || idx >= top + ROWS) return;
    if (level.id === 'about') return;
    setStack((st) => [...st.slice(0, -1), { ...st[st.length - 1], sel: idx, top, since: Date.now() }]);
    choose(idx);
  };

  // ── Drawing ─────────────────────────────────────────────────────────────
  const wanted = useRef(new Set<string>());
  const want = useCallback((url: string, size: number) => {
    const k = `${size}|${url}`;
    if (wanted.current.has(k)) return;
    wanted.current.add(k);
    void dither(url, size).then(() => setArtTick((n) => n + 1));
  }, []);

  const now: NowModel = {
    idle,
    title,
    artist,
    album,
    index: state?.queueIndex,
    count: state?.queueLength,
    radio,
    duration: state?.durationSecs ?? 0,
    playing: !!playing && state?.state === 'PLAYING',
    art: track?.art,
    since: since.current.at,
    elapsedAt: (t: number) => {
      if (!state) return 0;
      if (state.state !== 'PLAYING') return state.positionSecs;
      const p = state.positionSecs + (t - receivedAt) / 1000;
      return state.durationSecs ? Math.min(p, state.durationSecs) : p;
    },
  };

  const menu: MenuModel = {
    title: TITLES[level.id],
    rows: items.map((i) => i.row),
    sel,
    top,
    still: level.id === 'about',
    empty: level.id === 'queue' ? 'The queue is empty' : level.id === 'favs' ? 'No favourites yet' : undefined,
    since: level.since,
  };

  const motion = !reduced;
  const paint = (b: Bitmap, t: number): number => {
    drawStatus(b, {
      transport: idle ? 'stop' : playing ? 'play' : 'pause',
      title: screen === 'now' ? (group?.name ?? 'Now Playing') : menu.title,
      volume: state?.volume ?? 0,
      muted: !!state?.muted,
      hold,
    });
    const ov: Overlay =
      overlay && overlay.until > t
        ? overlay.kind === 'volume'
          ? { kind: 'volume', volume: state?.volume ?? 0, muted: !!state?.muted }
          : { kind: 'hold' }
        : null;
    // Under reduced motion the marquee's clock never starts.
    const ctx = { now: motion ? t : 0, want };
    let wakeIn =
      screen === 'now'
        ? drawNowPlaying(b, motion ? now : { ...now, since: Number.MAX_SAFE_INTEGER }, ov, { ...ctx, now: t })
        : drawMenu(b, motion ? menu : { ...menu, since: Number.MAX_SAFE_INTEGER }, { ...ctx, now: t });
    if (ov && overlay) wakeIn = Math.min(wakeIn, overlay.until - t + 5);
    // The hold box sits over menus too (Now Playing draws its own overlays).
    if (screen === 'menu' && ov?.kind === 'hold') drawOverlay(b, ov, Infinity);
    return wakeIn;
  };
  // Re-created when anything it reads changes; PocketLcd redraws on a new one.
  const paintCb = useMemo(() => paint, [
    screen, stack, items, overlay, hold, state, group?.name, receivedAt, artTick, idle, playing, title, motion, sel, top,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const slide: Slide = {
    key: screen === 'now' ? 'now' : stack.map((l) => l.id).join('/'),
    dir: slideDir,
  };

  const alive = !!playing && !hidden && !reduced;
  const valueText =
    screen === 'now'
      ? `Volume ${state?.volume ?? 0}`
      : `${menu.title}: ${items[sel]?.row.label ?? 'empty'}${items[sel]?.row.value ? `, ${items[sel].row.value}` : ''}`;

  return (
    <div
      className={`pk-device${lit ? ' is-lit' : ''}${playing ? ' is-playing' : ''}${alive ? ' is-alive' : ''}${hold ? ' is-hold' : ''}`}
      onPointerDown={wake}
    >
      <div className="pk-top" aria-hidden={phone ? 'true' : undefined}>
        <button
          type="button"
          className={`pk-hold${hold ? ' is-on' : ''}`}
          aria-pressed={hold}
          aria-label={hold ? 'Hold is on: the wheel is locked' : 'Hold: lock the wheel'}
          onClick={() => {
            wake();
            setHold((h) => !h);
            setOverlay(hold ? null : { kind: 'hold', until: Date.now() + HOLD_MS });
          }}
        >
          <i />
        </button>
        <i className="pk-jack" />
        {!phone && (
          <svg className="pk-lead" viewBox="0 0 300 260" aria-hidden="true">
            {/* Units are hundredths of the player's width; its top edge is y = 60. */}
            <path className="pk-lead-shadow" d={LEAD_DESK} />
            <path className="pk-lead-under" d={LEAD} />
            <path className="pk-lead-wire" d={LEAD} />
            <path className="pk-lead-shine" d={LEAD} transform="translate(-0.5 -0.4)" />
            <rect className="pk-plug" x="38.7" y="44" width="5.6" height="13" rx="1.6" />
            <rect className="pk-plug-collar" x="39.1" y="56.2" width="4.8" height="2.4" rx="0.6" />
          </svg>
        )}
        <i className="pk-port" />
      </div>
      <div className="pk-chrome" aria-hidden="true" />
      <div className="pk-face">
        <i className="pk-face-gloss" aria-hidden="true" />
        <i className="pk-face-sheen" aria-hidden="true" />
        <div className="pk-screen">
          <i className="pk-halation" aria-hidden="true" />
          <div className="pk-lcd" role="img" aria-label={lcdLabel(screen, now, menu, items, sel)}>
            <i className="pk-lcd-glass" />
            <i className="pk-lcd-light" />
            <PocketLcd className="pk-lcd-canvas" paint={paintCb} slide={slide} active={!hidden} ghosts={!reduced} onTap={onTap} />
            <i className="pk-lcd-reflect" />
          </div>
        </div>
        <PocketWheel
          mode={screen === 'now' ? 'volume' : 'menu'}
          step={screen === 'now' ? VOLUME_STEP_DEG : MENU_STEP_DEG}
          onTurn={onTurn}
          onTurnEnd={onTurnEnd}
          onPress={onPress}
          onTouch={wake}
          skips={!radio && !idle}
          playing={!!playing}
          valueText={valueText}
        />
      </div>
    </div>
  );
}

/** What the screen says, for a screen reader. */
function lcdLabel(screen: 'now' | 'menu', now: NowModel, menu: MenuModel, items: Item[], sel: number): string {
  if (screen === 'now') {
    if (now.idle) return 'Screen: nothing playing';
    return `Screen: ${now.title}${now.artist ? `, ${now.artist}` : ''}`;
  }
  return `Screen: ${menu.title} menu, ${items[sel]?.row.label ?? 'empty'} highlighted`;
}

/**
 * The desk: the player lies on it, the earphone lead runs off the top, and
 * the app's own progress bar and transport sit below it like a remote.
 */
export default function PocketStage() {
  return (
    <div className="pocket">
      <div className="pk-scene">
        <PocketDevice />
      </div>
      <div className="pk-dock">
        <Progress />
        <Transport />
      </div>
    </div>
  );
}
