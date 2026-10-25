import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import { cycleRepeat, fromPlayMode, toggleShuffle } from '../store/playMode';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useViewport } from '../hooks/useViewport';
import { clampVol } from '../lib/format';
import NightdriveSegments, { segmentText, segmentWidth } from './NightdriveSegments';

/* ══════════════════════════════════════════════════════════════════════════
   NIGHTDRIVE

   An '80s car stereo head unit set into a brushed aluminium dash. The stage
   module reads top to bottom like the faceplate: a status line (room, queue
   position, the green ST and PLAYING lamps), the smoked display window with
   its annunciators and the 14-segment title, the art in a black bezel with
   the track beside it over a patch of vent slots, an LED ladder for the
   progress with the times in segments either side, then a tray of rubber
   keys and the clock window. The volume deck below it is its own module: a
   black knob with an orange light ring, the VOL readout, and an LED ladder
   per room.

   On a phone the same pieces stack into one module, with a small knob, the
   VOL readout and a mini clock under the keys.

   Motion (Marshall's motion study), slow and never blinking:
     · a title wider than its window glides left at about 45px/s, holds 3s
       at each end and glides back; it freezes where it is when paused or
       hidden, and with reduced motion it is simply cut at the window edge;
     · key legends warm and cool over 240ms, keys drop 2px while held;
     · ladder steps and the knob ring fill or empty over 180ms;
     · paused, the PLAYING lamp fades to 25% and the displays dim to 60%.
   ══════════════════════════════════════════════════════════════════════════ */

const SCROLL_PX_PER_SEC = 45;
const SCROLL_HOLD_SECS = 3;

const SOURCE: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify',
};

/** The disc-type annunciator: what a head unit would call this source. */
const MEDIUM: Record<string, string> = {
  queue: 'CD',
  radio: 'FM',
  linein: 'AUX',
  tv: 'TV',
  airplay: 'AIR',
  'spotify-connect': 'NET',
};

const two = (n: number) => String(n).padStart(2, '0');

/** mm:ss as four segment cells ("0100", a colon after the second). */
function cellsFor(secs: number): string {
  const t = Math.max(0, Math.floor(secs));
  const m = Math.min(99, Math.floor(t / 60));
  return `${two(m)}${two(t % 60)}`;
}

const spoken = (secs: number) => {
  const t = Math.max(0, Math.floor(secs));
  return `${Math.floor(t / 60)}:${two(t % 60)}`;
};

// ── Hooks ────────────────────────────────────────────────────────────────

/** Whether the window is out of sight. */
function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

/** Whole seconds of the playhead, ticking only while playing and visible. */
function useElapsed(playing: boolean): number {
  const receivedAt = useSonos((s) => s.receivedAt);
  const [secs, setSecs] = useState(() => Math.floor(livePosition(useSonos.getState())));

  useEffect(() => {
    const read = () => setSecs(Math.floor(livePosition(useSonos.getState())));
    read();
    if (!playing) return;
    let timer: number | undefined;
    const start = () => {
      if (timer === undefined) timer = window.setInterval(read, 250);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        read();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [receivedAt, playing]);

  return secs;
}

/** The wall clock, to the minute. Re-reads on the minute, and not at all while hidden. */
function useWallClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const d = new Date();
      setNow(d);
      timer = window.setTimeout(schedule, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) schedule();
    };
    if (!document.hidden) schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return now;
}

/** Width of an element, live. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** What's on, in the words every Nightdrive piece uses. */
function useNowPlaying() {
  const state = useSonos((s) => s.state);
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const title = state?.isRadio ? (state.stationName ?? track?.title ?? 'Radio') : track?.title;
  const artist = state?.isRadio ? track?.streamContent : track?.artist;
  const album = state?.isRadio
    ? track?.title && track.title !== state.stationName
      ? track.title
      : undefined
    : track?.album;
  const key = idle ? 'idle' : state?.isRadio ? `radio:${state.stationName ?? title}` : (track?.uri ?? `${title}|${artist}`);
  return { state, playing, idle, track, title, artist, album, key };
}

// ── Pieces ───────────────────────────────────────────────────────────────

/** Filled glyphs from the canvas: keylight shines through them. */
const GLYPH: Record<string, ReactNode> = {
  shuffle: <path d="M3 7h4l9 10h5v-2l3 3-3 3v-2h-6L6 9H3zm0 10h3l3-3.4 1.3 1.5L7 19H3zm13-8h5V7l3 3-3 3v-2h-4.2l-2.3 2.6-1.3-1.5z" />,
  prev: <path d="M5 5h2.5v14H5zm3.5 7L19 5v14z" />,
  next: <path d="M16.5 5H19v14h-2.5zM5 5l10.5 7L5 19z" />,
  playpause: <path d="M4 5l9 7-9 7zm11 0h2.6v14H15zm4.4 0H22v14h-2.6z" />,
  play: <path d="M7 5l12 7-12 7z" />,
  pause: <path d="M6 5h4v14H6zm8 0h4v14h-4z" />,
  repeat: <path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />,
  crossfade: <path d="M2 5l9.5 13H2zm20 0v13h-9.5z" />
};

function Glyph({ name, width = 22, height = 22 }: { name: string; width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={width} height={height} aria-hidden="true" focusable="false">
      {GLYPH[name]}
    </svg>
  );
}

/** A black rubber key with a backlit legend. */
function Key({
  lit = true,
  down = false,
  className,
  legend,
  children,
  ...rest
}: {
  lit?: boolean;
  down?: boolean;
  className?: string;
  legend?: string;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`nd-key${lit ? ' is-lit' : ''}${down ? ' is-down' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
      {legend && <span className="nd-legend">{legend}</span>}
    </button>
  );
}

/**
 * A row of LED steps. Lit up to the value (the top lit step a little
 * hotter), ghosts beyond it. With `onSet` it is a slider: click or drag
 * anywhere along it, and the value snaps to the steps.
 */
function Ladder({
  steps,
  value,
  onSet,
  className,
  label,
  valueNow,
  valueText,
  valueMax = 100,
  onKey,
}: {
  steps: number;
  /** 0–1 */
  value: number;
  /** Called with 0–1, snapped to a step; `final` on release. */
  onSet?: (frac: number, final: boolean) => void;
  className?: string;
  label?: string;
  valueNow?: number;
  valueText?: string;
  valueMax?: number;
  onKey?: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lit = Math.round(Math.max(0, Math.min(1, value)) * steps);

  const fracAt = (clientX: number) => {
    const el = ref.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(f * steps) / steps;
  };

  const interactive = !!onSet;
  const handlers = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          onSet(fracAt(e.clientX), false);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (dragging) onSet(fracAt(e.clientX), false);
        },
        onPointerUp: (e: React.PointerEvent) => {
          if (!dragging) return;
          setDragging(false);
          onSet(fracAt(e.clientX), true);
        },
        onPointerCancel: () => setDragging(false),
        onKeyDown: onKey,
        role: 'slider',
        tabIndex: 0,
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': valueMax,
        'aria-valuenow': valueNow,
        'aria-valuetext': valueText,
      }
    : { 'aria-hidden': true as const };

  return (
    <div ref={ref} className={`nd-ladder${interactive ? ' is-live' : ''}${className ? ` ${className}` : ''}`} {...handlers}>
      {Array.from({ length: steps }, (_, i) => (
        <i key={i} className={i < lit ? (i === lit - 1 ? 'is-on is-hot' : 'is-on') : undefined} />
      ))}
    </div>
  );
}

/**
 * The smoked display window: annunciators over the track title in segments.
 * A title too long for the window glides through it (see the header).
 */
function TitleWindow({
  text,
  height,
  cells,
  trackKey,
  playing,
  annunciators,
  className,
}: {
  text: string;
  height: number;
  cells: number;
  trackKey: string;
  playing: boolean;
  annunciators?: ReactNode;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduced = useReducedMotion();
  const hidden = useHidden();
  const glyphs = segmentText(text).length;

  // Shrink the glyphs only when the window can't hold the canvas's cell count.
  const H = width > 0 ? Math.min(height, Math.floor((width / (cells + 0.34)) * 2) / 2) : height;
  const n = Math.max(cells, glyphs);
  const overflow = width > 0 ? segmentWidth(n, H) - width : 0;
  const scrolls = overflow > 1 && !reduced;

  const strip = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);

  useEffect(() => {
    const el = strip.current;
    if (!el || !scrolls) return;
    const glide = overflow / SCROLL_PX_PER_SEC;
    const total = glide + SCROLL_HOLD_SECS;
    const hold = SCROLL_HOLD_SECS / 2 / total; // half at each end of a run; alternate doubles it
    const a = el.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: hold, easing: 'ease-in-out' },
        { transform: `translateX(${-overflow}px)`, offset: 1 - hold },
        { transform: `translateX(${-overflow}px)`, offset: 1 },
      ],
      { duration: total * 1000, iterations: Infinity, direction: 'alternate' },
    );
    anim.current = a;
    return () => {
      a.cancel();
      anim.current = null;
    };
    // A new track starts from the left again: trackKey restarts it.
  }, [scrolls, overflow, trackKey]);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    if (playing && !hidden) a.play();
    else a.pause();
  }, [playing, hidden, scrolls, overflow, trackKey]);

  return (
    <div className={`nd-window nd-title-window${className ? ` ${className}` : ''}`}>
      {annunciators}
      <div className="nd-title-clip" ref={ref}>
        <div className="nd-title-strip" ref={strip}>
          <NightdriveSegments text={text} height={H} cells={n} />
        </div>
      </div>
    </div>
  );
}

function Lamp({ playing, idle, small }: { playing: boolean; idle: boolean; small?: boolean }) {
  return (
    <span className={`nd-lamps${playing ? ' is-playing' : ''}${small ? ' is-small' : ''}`}>
      {!idle && <span className="nd-st">ST</span>}
      <span className="nd-state">
        <i aria-hidden="true" />
        {playing ? 'Playing' : idle ? 'Idle' : 'Paused'}
      </span>
    </span>
  );
}

function Art({ src, title, className }: { src?: string; title?: string; className?: string }) {
  const [broken, setBroken] = useState<string | undefined>();
  const show = !!src && broken !== src;
  return (
    <div className={`nd-art${className ? ` ${className}` : ''}`}>
      {show ? (
        <img src={src} alt={title ? `Album art for ${title}` : ''} draggable={false} onError={() => setBroken(src)} />
      ) : (
        <span className="nd-art-blank" aria-hidden="true" />
      )}
    </div>
  );
}

/** The track's progress as a ladder, with elapsed and total in segments either side. */
function Progress({ steps, timeHeight, playing }: { steps: number; timeHeight: number; playing: boolean }) {
  const state = useSonos((s) => s.state);
  const seekTo = useSonos((s) => s.seekTo);
  const elapsed = useElapsed(playing);
  const [scrub, setScrub] = useState<number | null>(null);
  if (!state) return null;

  const duration = state.durationSecs ?? 0;
  const timed = !state.isRadio && duration > 0;
  const at = scrub ?? Math.min(elapsed, timed ? duration : elapsed);

  return (
    <div className="nd-progress">
      <NightdriveSegments text={cellsFor(at)} height={timeHeight} colonAfter={[1]} label={`${spoken(at)} elapsed`} />
      {timed ? (
        <Ladder
          steps={steps}
          value={at / duration}
          label="Seek"
          valueNow={Math.round(at)}
          valueMax={Math.round(duration)}
          valueText={`${spoken(at)} of ${spoken(duration)}`}
          onSet={(f, final) => {
            if (final) {
              setScrub(null);
              void seekTo(f * duration);
            } else setScrub(f * duration);
          }}
          onKey={(e) => {
            if (e.key === 'ArrowLeft') void seekTo(at - 10);
            if (e.key === 'ArrowRight') void seekTo(at + 10);
          }}
        />
      ) : (
        <Ladder steps={steps} value={0} />
      )}
      {timed ? (
        <NightdriveSegments text={cellsFor(duration)} height={timeHeight} colonAfter={[1]} label={`${spoken(duration)} total`} />
      ) : (
        <span className="nd-ann is-lit nd-live">Live</span>
      )}
    </div>
  );
}

/** The tray of keys: SHUF · TRK · PLAY/PAUSE · TRK · XFADE · RPT (phone: the middle three). */
function KeyTray({ compact }: { compact?: boolean }) {
  const state = useSonos((s) => s.state);
  const toggle = useSonos((s) => s.toggle);
  const skipNext = useSonos((s) => s.skipNext);
  const skipPrev = useSonos((s) => s.skipPrev);
  const setPlayMode = useSonos((s) => s.setPlayMode);
  const setCrossfade = useSonos((s) => s.setCrossfade);
  if (!state) return null;

  const playing = state.state === 'PLAYING' || state.state === 'TRANSITIONING';
  const { shuffle, repeat } = fromPlayMode(state.playMode);
  const radio = state.isRadio;
  const legend = (s: string) => (compact ? undefined : s);

  return (
    <div className={`nd-tray nd-keys${compact ? ' is-compact' : ''}`}>
      {!compact && (
        <Key
          lit={shuffle && !radio}
          legend="Shuf"
          aria-pressed={shuffle}
          aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
          disabled={radio}
          onClick={() => setPlayMode(toggleShuffle(state.playMode))}
        >
          <Glyph name="shuffle" />
        </Key>
      )}
      <Key lit={!radio} legend={legend('Trk')} aria-label="Previous track" disabled={radio} onClick={() => void skipPrev()}>
        <Glyph name="prev" />
      </Key>
      <Key
        className="nd-key-play"
        down={playing}
        legend={legend('Play / Pause')}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => void toggle()}
      >
        <Glyph name="playpause" width={30} />
      </Key>
      <Key lit={!radio} legend={legend('Trk')} aria-label="Next track" disabled={radio} onClick={() => void skipNext()}>
        <Glyph name="next" />
      </Key>
      {!compact && (
        <Key
          lit={state.crossfade && !radio}
          legend="Xfade"
          aria-pressed={state.crossfade}
          aria-label={state.crossfade ? 'Crossfade on' : 'Crossfade off'}
          disabled={radio}
          onClick={() => setCrossfade(!state.crossfade)}
        >
          <Glyph name="crossfade" />
        </Key>
      )}
      {!compact && (
        <Key
          lit={repeat !== 'off' && !radio}
          legend={repeat === 'one' ? 'Rpt 1' : 'Rpt'}
          aria-label={`Repeat ${repeat}`}
          disabled={radio}
          onClick={() => setPlayMode(cycleRepeat(state.playMode))}
        >
          <Glyph name="repeat" />
        </Key>
      )}
    </div>
  );
}

/** The wall clock in its own window: CLK · AM · PM over the time. */
function Clock({ height, compact }: { height: number; compact?: boolean }) {
  const now = useWallClock();
  const h = now.getHours();
  const h12 = h % 12 || 12;
  const pm = h >= 12;
  const text = `${String(h12).padStart(2, ' ')}${two(now.getMinutes())}`;
  const label = `${h12}:${two(now.getMinutes())} ${pm ? 'PM' : 'AM'}`;
  return (
    <div className={`nd-window nd-clock${compact ? ' is-compact' : ''}`}>
      <span className="nd-anns">
        <span className="nd-ann is-lit">Clk</span>
        {!compact && <span className={`nd-ann${pm ? '' : ' is-lit'}`}>AM</span>}
        {!compact && <span className={`nd-ann${pm ? ' is-lit' : ''}`}>PM</span>}
      </span>
      <NightdriveSegments text={text} height={height} colonAfter={[1]} label={label} />
    </div>
  );
}

/**
 * The volume knob: black rubber in an orange light ring that shows the
 * level. Drag up or right to raise it, scroll, or use the arrow keys.
 */
function Knob({ className }: { className?: string }) {
  const volume = useSonos((s) => s.state?.volume ?? 0);
  const setGroupVolume = useSonos((s) => s.setGroupVolume);
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, y: 0, v: 0 });
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const valueFrom = (e: React.PointerEvent) =>
    origin.current.v + (origin.current.y - e.clientY + (e.clientX - origin.current.x)) * 0.38;

  return (
    <div
      className={`nd-knob${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--nd-level': clampVol(volume) / 100 } as CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY, v: volume };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) void setGroupVolume(valueFrom(e));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        void setGroupVolume(valueFrom(e), true);
      }}
      onPointerCancel={() => setDragging(false)}
      onWheel={(e) => {
        const step = e.deltaY < 0 ? 2 : -2;
        void setGroupVolume((useSonos.getState().state?.volume ?? volume) + step);
        clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => {
          void setGroupVolume(useSonos.getState().state?.volume ?? volume, true);
        }, 180);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') void setGroupVolume(volume + 2, true);
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') void setGroupVolume(volume - 2, true);
      }}
      role="slider"
      tabIndex={0}
      aria-label="Group volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={volume}
    >
      <span className="nd-knob-ring" aria-hidden="true" />
      <span className="nd-knob-cap" aria-hidden="true" />
      <span className="nd-knob-pointer" aria-hidden="true" />
    </div>
  );
}

/** VOL in segments. */
function VolReadout({ height, inline }: { height: number; inline?: boolean }) {
  const volume = useSonos((s) => s.state?.volume ?? 0);
  const v = String(clampVol(volume));
  return (
    <div className={`nd-window nd-vol${inline ? ' is-inline' : ''}`}>
      {inline && <span className="nd-silk">Vol</span>}
      <NightdriveSegments text={v.padStart(2, ' ')} height={height} label={`Volume ${v}`} />
    </div>
  );
}

/** One LED ladder per room in the group. The preset key mutes and unmutes the room. */
function RoomLadders({ steps, stacked }: { steps: number; stacked?: boolean }) {
  const members = useSonos((s) => s.state?.members);
  const setMemberVolume = useSonos((s) => s.setMemberVolume);
  const setMemberMute = useSonos((s) => s.setMemberMute);
  if (!members?.length) return null;

  return (
    <div className={`nd-rooms-ladders${stacked ? ' is-stacked' : ''}`}>
      <span className="nd-silk">{members.length === 1 ? 'Room' : 'Rooms in group'}</span>
      <ul>
        {members.map((m, i) => (
          <li key={m.uuid} className={m.muted ? 'is-muted' : undefined}>
            {!stacked && (
              <Key
                className="nd-preset"
                lit={!m.muted}
                aria-pressed={m.muted}
                aria-label={m.muted ? `Unmute ${m.name}` : `Mute ${m.name}`}
                onClick={() => void setMemberMute(m.uuid, !m.muted)}
              >
                {i + 1}
              </Key>
            )}
            <span className="nd-ladder-name" title={m.name}>
              {m.name}
            </span>
            <Ladder
              steps={steps}
              value={m.muted ? 0 : m.volume / 100}
              label={`${m.name} volume`}
              valueNow={m.volume}
              onSet={(f, final) => void setMemberVolume(m.uuid, f * 100, final)}
              onKey={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') void setMemberVolume(m.uuid, m.volume + 2, true);
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') void setMemberVolume(m.uuid, m.volume - 2, true);
              }}
            />
            {stacked ? (
              <button
                type="button"
                className="nd-ladder-value"
                aria-label={m.muted ? `Unmute ${m.name}` : `Mute ${m.name}`}
                aria-pressed={m.muted}
                onClick={() => void setMemberMute(m.uuid, !m.muted)}
              >
                {m.muted ? 'Mute' : m.volume}
              </button>
            ) : (
              <span className="nd-ladder-value">{m.muted ? 'Mute' : m.volume}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const VENTS = Array.from({ length: 30 }, (_, i) => i);

// ── The stage ────────────────────────────────────────────────────────────

export default function NightdriveStage() {
  const phone = useViewport() === 'phone';
  const group = useSonos((s) => s.group);
  const { state, playing, idle, track, title, artist, album, key } = useNowPlaying();
  const { shuffle, repeat } = fromPlayMode(state?.playMode ?? 'NORMAL');

  const position =
    state?.queueIndex && state.queueLength ? `${two(state.queueIndex)}/${two(state.queueLength)}` : undefined;
  const others = group ? group.members.length - 1 : 0;
  const withLine =
    group && others > 0 ? `+ ${others === 1 ? group.members[1].name : `${others} more`}` : undefined;
  const source = state ? `${SOURCE[state.source] ?? state.source}${position ? ` ${position}` : ''}` : undefined;
  const display = idle ? 'Nothing on' : (title ?? '');

  if (phone) {
    return (
      <div className={`nightdrive is-phone${playing ? ' is-playing' : ''}`}>
        <header className="nd-top">
          {source && <span className="nd-cap">{source}</span>}
          <Lamp playing={!!playing} idle={idle} small />
        </header>
        <Art className="nd-art-phone" src={track?.art} title={title} />
        <TitleWindow text={display} height={30} cells={10} trackKey={key} playing={!!playing} />
        {!idle && (
          <div className="nd-info">
            {artist && <span className="nd-artist">{artist}</span>}
            {album && <span className="nd-cap nd-album">{album}</span>}
          </div>
        )}
        <Progress steps={24} timeHeight={13} playing={!!playing} />
        <KeyTray compact />
        <div className="nd-pocket">
          <Knob className="is-pocket" />
          <span className="nd-silk">Vol</span>
          <VolReadout height={16} />
          <span className="nd-spacer" />
          <Clock height={18} compact />
        </div>
      </div>
    );
  }

  return (
    <div className={`nightdrive${playing ? ' is-playing' : ''}`}>
      <header className="nd-top">
        <span className="nd-cap nd-room">{group?.name ?? '—'}</span>
        {withLine && <span className="nd-cap">{withLine}</span>}
        {source && <span className="nd-cap">{source}</span>}
        <span className="nd-spacer" />
        <Lamp playing={!!playing} idle={idle} />
      </header>

      <TitleWindow
        text={display}
        height={44}
        cells={13}
        trackKey={key}
        playing={!!playing}
        annunciators={
          <span className="nd-anns">
            <span className={`nd-ann${idle ? '' : ' is-lit'}`}>{MEDIUM[state?.source ?? ''] ?? 'CD'}</span>
            {state?.queueIndex && !state.isRadio ? (
              <span className="nd-ann is-lit">Trk {two(state.queueIndex)}</span>
            ) : null}
            <span className={`nd-ann${repeat !== 'off' ? ' is-lit' : ''}`}>{repeat === 'one' ? 'Rpt 1' : 'Rpt'}</span>
            <span className={`nd-ann${shuffle ? ' is-lit' : ''}`}>Shuf</span>
            <span className={`nd-ann${state?.crossfade ? ' is-lit' : ''}`}>Xfade</span>
          </span>
        }
      />

      <div className="nd-head">
        <Art className="nd-art-desk" src={track?.art} title={title} />
        <div className="nd-info">
          {!idle && (
            <>
              {artist && <span className="nd-artist">{artist}</span>}
              {title && <span className="nd-title">{title}</span>}
              {album && <span className="nd-cap nd-album">{album}</span>}
            </>
          )}
          <span className="nd-spacer" />
          <div className="nd-vents" aria-hidden="true">
            {VENTS.map((i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      </div>

      <Progress steps={40} timeHeight={16} playing={!!playing} />

      <div className="nd-deck-row">
        <KeyTray />
        <Clock height={34} />
      </div>
    </div>
  );
}

/** The volume deck under the stage, its own module: knob, VOL readout, a ladder per room. */
export function NightdriveDeck() {
  const state = useSonos((s) => s.state);
  if (!state) return null;
  return (
    <section className="nd-module nd-deck" aria-label="Volume">
      <Knob className="is-deck" />
      <div className="nd-deck-vol">
        <span className="nd-silk">Vol</span>
        <VolReadout height={30} />
      </div>
      <RoomLadders steps={20} />
    </section>
  );
}

/** The phone's queue page: what's playing, small, above the list. Tapping it opens Now. */
export function NightdriveMini({ onOpen }: { onOpen: () => void }) {
  const toggle = useSonos((s) => s.toggle);
  const { state, playing, idle, track, title, artist, key } = useNowPlaying();
  const elapsed = useElapsed(!!playing);
  if (!state || idle) return null;

  const duration = state.durationSecs ?? 0;
  const frac = !state.isRadio && duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return (
    <section className={`nd-module nd-mini${playing ? ' is-playing' : ''}`} aria-label="Now playing">
      <div className="nd-mini-row">
        <button type="button" className="nd-mini-open" onClick={onOpen} aria-label={`Now playing: ${title ?? ''}`}>
          <Art className="nd-art-mini" src={track?.art} title={title} />
          <span className="nd-mini-text">
            <TitleWindow text={title ?? ''} height={18} cells={10} trackKey={key} playing={!!playing} />
            {artist && <span className="nd-cap nd-mini-artist">{artist}</span>}
          </span>
        </button>
        <Key className="nd-mini-key" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void toggle()}>
          <Glyph name={playing ? 'pause' : 'play'} width={20} height={20} />
        </Key>
      </div>
      <Ladder steps={30} value={frac} className="nd-ladder-thin" />
    </section>
  );
}

/** The phone's rooms page: the group's volume, a knob and a ladder per room. */
export function NightdriveVolume() {
  const state = useSonos((s) => s.state);
  if (!state) return null;
  return (
    <section className="nd-module nd-volume" aria-label="Group volume">
      <div className="nd-volume-dial">
        <Knob className="is-rooms" />
        <VolReadout height={16} inline />
      </div>
      <RoomLadders steps={14} stacked />
    </section>
  );
}

