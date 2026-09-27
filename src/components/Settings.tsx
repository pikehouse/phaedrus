import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from '../api';
import { useSonos } from '../store/useSonos';
import { useSettings, useSettingsPanel, type TapAction } from '../store/settings';
import { SKINS, useSkin, type Skin } from '../store/skin';
import { useSpotifyLink } from '../hooks/useSpotifyLink';
import { agoLabel, plural } from '../lib/format';
import { Close, Radar } from './Icons';
import type { MusicService, Zone } from '../api/types';
import { version } from '../../package.json';
import '../styles/settings.css';

const SECTIONS = [
  { id: 'playback', label: 'Playback' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'music', label: 'Music' },
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** How long a destructive button stays armed for its second click. */
const ARMED_MS = 3200;

/**
 * Everything Phaedrus can be told once and remember. Every control applies
 * the moment it is touched; there is nothing to save.
 */
export default function Settings() {
  const open = useSettingsPanel((s) => s.open);
  if (!open) return null;
  return <SettingsSheet />;
}

function SettingsSheet() {
  const setOpen = useSettingsPanel((s) => s.setOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>('playback');

  // Focus the first control on the way in; hand focus back on the way out.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useSonos.getState().searchOpen) return; // search's own escape
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // Keep Tab inside the sheet while it is up.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // The section list follows the reading position.
  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      setActive(SECTIONS[SECTIONS.length - 1].id);
      return;
    }
    let current: SectionId = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const el = document.getElementById(`set-${s.id}`);
      if (el && el.offsetTop - body.offsetTop - body.scrollTop <= 48) current = s.id;
    }
    setActive(current);
  };

  const jump = (id: SectionId) => {
    const body = bodyRef.current;
    const el = document.getElementById(`set-${id}`);
    if (!body || !el) return;
    setActive(id);
    body.scrollTo({ top: el.offsetTop - body.offsetTop - 8, behavior: 'smooth' });
  };

  return (
    <div className="settings-scrim" role="presentation">
      <button type="button" className="settings-dismiss" aria-label="Close settings" tabIndex={-1} onClick={close} />
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={trap}
      >
        <header className="settings-head">
          <h2 id="settings-title" className="settings-title">
            Settings
          </h2>
          <span className="label settings-note">Changes apply as you make them</span>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={close}>
            <Close size={18} />
          </button>
        </header>

        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`settings-navbtn${active === s.id ? ' is-on' : ''}`}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => jump(s.id)}
            >
              <span className="settings-navnum num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="settings-navlabel">{s.label}</span>
            </button>
          ))}
        </nav>

        <div ref={bodyRef} className="settings-body scroll" onScroll={onScroll}>
          <Playback />
          <Appearance />
          <Music />
          <Home />
          <About />
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, kicker, children }: { id: SectionId; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section id={`set-${id}`} className={`set-section is-${id}`} aria-labelledby={`set-${id}-h`}>
      <header className="set-section-head">
        <span className="label set-kicker">{kicker}</span>
        <h3 id={`set-${id}-h`} className="set-heading">
          {title}
        </h3>
      </header>
      {children}
    </section>
  );
}

/** A button that asks once before it does something that cannot be undone. */
function useArmed() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, setArmed] as const;
}

// ── Playback ─────────────────────────────────────────────────────────────────

const TAP_OPTIONS: { id: TapAction; title: string; note: string; cells: ('old' | 'new' | 'gone')[] }[] = [
  { id: 'replace', title: 'Play now and replace the queue', note: 'Start fresh. What was queued is cleared.', cells: ['new', 'new', 'new', 'gone', 'gone'] },
  { id: 'next', title: 'Play next', note: 'Slips in after the song that is playing.', cells: ['old', 'new', 'old', 'old', 'old'] },
  { id: 'later', title: 'Add to the end of the queue', note: 'Waits its turn behind everything else.', cells: ['old', 'old', 'old', 'old', 'new'] },
];

function Playback() {
  const tapAction = useSettings((s) => s.tapAction);
  const setSettings = useSettings((s) => s.set);
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const setCrossfade = useSonos((s) => s.setCrossfade);
  const clearQueue = useSonos((s) => s.clearQueue);
  const queueLen = useSonos((s) => s.queueTotal || s.queue.length);
  const [armed, setArmed] = useArmed();
  const optRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = TAP_OPTIONS.findIndex((o) => o.id === tapAction);
    let j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % TAP_OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + TAP_OPTIONS.length - 1) % TAP_OPTIONS.length;
    else return;
    e.preventDefault();
    e.stopPropagation();
    setSettings({ tapAction: TAP_OPTIONS[j].id });
    optRefs.current[j]?.focus();
  };

  const roomName = group?.name ?? 'this room';

  return (
    <Section id="playback" title="Playback" kicker="01">
      <div className="set-block">
        <p className="set-q" id="set-tap-q">
          When I tap a song, album or playlist
        </p>
        <div className="tapseg" role="radiogroup" aria-labelledby="set-tap-q" onKeyDown={onKey}>
          {TAP_OPTIONS.map((o, i) => {
            const on = tapAction === o.id;
            return (
              <button
                key={o.id}
                ref={(el) => {
                  optRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-autofocus={on ? '' : undefined}
                className={`tapseg-opt${on ? ' is-on' : ''}`}
                onClick={() => setSettings({ tapAction: o.id })}
              >
                <span className="tapq" aria-hidden="true">
                  {o.cells.map((c, k) => (
                    <i key={k} className={`tapq-cell is-${c}${k === 0 ? ' is-cur' : ''}`} />
                  ))}
                </span>
                <span className="tapseg-title">{o.title}</span>
                <span className="tapseg-note">{o.note}</span>
              </button>
            );
          })}
        </div>
        <p className="set-fine">Every row in search still has its own “next” and “add” buttons.</p>
      </div>

      <div className="set-row">
        <div className="set-row-text">
          <span className="set-row-title">Crossfade</span>
          <span className="set-row-sub">
            Blend one song into the next. Applies to <em>{roomName}</em>.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!state?.crossfade}
          aria-label={`Crossfade in ${roomName}`}
          className={`switch${state?.crossfade ? ' is-on' : ''}`}
          disabled={!state}
          onClick={() => void setCrossfade(!state?.crossfade)}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      <div className="set-row">
        <div className="set-row-text">
          <span className="set-row-title">Clear the queue</span>
          <span className="set-row-sub">
            {queueLen > 0 ? `${plural(queueLen, 'track')} waiting in ${roomName}.` : `Nothing queued in ${roomName}.`}
          </span>
        </div>
        <button
          type="button"
          className={`set-btn${armed ? ' is-armed' : ''}`}
          disabled={queueLen === 0}
          onClick={() => {
            if (armed) {
              setArmed(false);
              void clearQueue();
            } else {
              setArmed(true);
            }
          }}
        >
          {armed ? 'Sure? Clear it' : 'Clear queue'}
        </button>
      </div>
    </Section>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────

/** Each skin's own ground, ink and light, for the cards. A skin's tokens only
 *  exist while it is worn, so the preview carries its own. */
const LOOK: Record<Skin, { ground: string; ink: string; font: CSSProperties; strip: string[] }> = {
  hifi: {
    ground: 'radial-gradient(90% 90% at 30% 10%, #4d3122, #1f120d 70%)',
    ink: '#f2e4c9',
    font: { fontFamily: "'Fraunces Variable', Georgia, serif", fontVariationSettings: "'SOFT' 100, 'WONK' 1, 'opsz' 144", fontStyle: 'italic' },
    strip: ['#1f120d', '#3b2418', '#f2e4c9', '#e29a4a', '#6b1f2a'],
  },
  board: {
    ground: '#eeebe3',
    ink: '#16181c',
    font: { fontFamily: "'Archivo Variable', Arial, sans-serif", fontVariationSettings: "'wdth' 72, 'wght' 800" },
    strip: ['#eeebe3', '#f8f6f1', '#27292d', '#16181c', '#c8102e'],
  },
  tuner: {
    ground: 'radial-gradient(120% 140% at 28% -18%, #0b2327, #06171a 44%, #030d0e)',
    ink: '#8dfff0',
    font: { fontFamily: "'Archivo Variable', Arial, sans-serif", fontVariationSettings: "'wdth' 62, 'wght' 500", textShadow: '0 0 6px rgba(120,255,235,0.55)' },
    strip: ['#111214', '#191b1e', '#d9dcdf', '#8dfff0', '#ffb347'],
  },
  drive: {
    ground: 'linear-gradient(180deg, #07060f 0%, #171235 62%, #2c1054 100%)',
    ink: '#ff2d95',
    font: { fontFamily: "'Archivo Variable', Arial, sans-serif", fontVariationSettings: "'wdth' 100, 'wght' 700", fontStyle: 'italic', textShadow: '0 0 8px rgba(255,45,149,0.6)' },
    strip: ['#07060f', '#171235', '#ff2d95', '#2de2ff', '#ffb347'],
  },
  daylight: {
    ground: '#ffffff',
    ink: '#111318',
    font: { fontFamily: "'Inter Variable', -apple-system, sans-serif", fontWeight: 700, letterSpacing: '-0.04em' },
    strip: ['#f4f5f7', '#ffffff', '#e5e7eb', '#6b7280', '#111318'],
  },
  deck: {
    ground: 'linear-gradient(180deg, #15171b, #0b0c0e)',
    ink: '#ff9f1c',
    font: { fontFamily: "'Archivo Variable', Arial, sans-serif", fontVariationSettings: "'wdth' 125, 'wght' 800", textShadow: '0 0 6px rgba(255,159,28,0.4)' },
    strip: ['#0b0c0e', '#15171b', '#eef0f3', '#ff9f1c', '#ff4d5a'],
  },
  prism: {
    ground: 'radial-gradient(80% 70% at 50% 20%, #1a120d, #0a0807 75%)',
    ink: '#eaf2ff',
    font: { fontFamily: "'Inter Variable', 'Helvetica Neue', sans-serif", fontWeight: 200, letterSpacing: '-0.02em' },
    strip: [
      '#0a0807',
      '#1a120d',
      '#e9e4de',
      'linear-gradient(90deg, #ff5a2a, #ffb13b, #43d86a, #1fa6b8, #5b5bd6, #e05aa8)',
      '#ff7a5c',
    ],
  },
};

function Appearance() {
  const skin = useSkin((s) => s.skin);
  const setSkin = useSkin((s) => s.setSkin);
  return (
    <Section id="appearance" title="Appearance" kicker="02">
      <div className="skincards" role="radiogroup" aria-label="Skin">
        {SKINS.map((s) => {
          const on = skin === s.id;
          const look = LOOK[s.id];
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`skincard${on ? ' is-on' : ''}`}
              onClick={() => setSkin(s.id)}
            >
              <span className="skincard-face" style={{ background: look.ground, color: look.ink }} aria-hidden="true">
                <span className="skincard-aa" style={look.font}>
                  Aa
                </span>
                <span className="skincard-strip">
                  {look.strip.map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </span>
              </span>
              <span className="skincard-text">
                <span className="skincard-label">
                  {s.label}
                  {on && <span className="skincard-on"> · in use</span>}
                </span>
                <span className="skincard-hint">{s.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ── Music ────────────────────────────────────────────────────────────────────

function useAnyIp() {
  return useSonos((s) => s.group?.coordinatorIp ?? s.topology?.groups[0]?.coordinatorIp ?? '');
}

function Music() {
  const anyIp = useAnyIp();
  const say = useSonos((s) => s.say);
  const [services, setServices] = useState<MusicService[] | null>(null);
  const [armed, setArmed] = useArmed();
  const [unlinking, setUnlinking] = useState(false);

  const refresh = useCallback(() => {
    if (!anyIp) return;
    api
      .getServices(anyIp)
      .then(setServices)
      .catch(() => setServices([]));
  }, [anyIp]);
  useEffect(refresh, [refresh]);

  /** Say the new state at once; the household's answer follows. */
  const mark = useCallback(
    (linked: boolean) => {
      setServices((prev) =>
        prev ? prev.map((s) => (s.id === 'spotify' ? { ...s, linked, needsLink: !linked } : s)) : prev,
      );
      refresh();
    },
    [refresh],
  );
  const onLinked = useCallback(() => mark(true), [mark]);
  const { phase, begin } = useSpotifyLink(anyIp, onLinked);

  const disconnect = async () => {
    setArmed(false);
    setUnlinking(true);
    try {
      await api.unlink(anyIp, 'spotify');
      say('Spotify disconnected');
      mark(false);
    } catch {
      say('Could not disconnect Spotify', 'bad');
      refresh();
    } finally {
      setUnlinking(false);
    }
  };

  const spotify = services?.find((s) => s.id === 'spotify');

  let spotifyStatus: string;
  let spotifyTone: 'on' | 'off' | 'wait' = 'off';
  if (!services) spotifyStatus = 'Checking…';
  else if (!spotify || !spotify.available) spotifyStatus = 'Not set up on this Sonos system — add it in the Sonos app first.';
  else if (spotify.linked) {
    spotifyStatus = 'Connected. Search includes Spotify.';
    spotifyTone = 'on';
  } else if (phase === 'waiting') {
    spotifyStatus = 'Waiting for you to sign in…';
    spotifyTone = 'wait';
  } else if (phase === 'failed') spotifyStatus = 'That did not go through.';
  else if (phase === 'timedOut') spotifyStatus = 'That took too long — try again.';
  else spotifyStatus = 'Not connected. Search leaves Spotify out.';

  let spotifyAction: React.ReactNode = null;
  if (spotify?.available && spotify.linked) {
    spotifyAction = (
      <button
        type="button"
        className={`set-btn${armed ? ' is-armed' : ''}`}
        disabled={unlinking}
        onClick={() => (armed ? void disconnect() : setArmed(true))}
      >
        {unlinking ? 'Disconnecting…' : armed ? 'Sure? Disconnect' : 'Disconnect'}
      </button>
    );
  } else if (spotify?.available && phase === 'waiting') {
    spotifyAction = (
      <span className="linkcard-wait" aria-live="polite">
        <span className="linkcard-dot" aria-hidden="true" />
      </span>
    );
  } else if (spotify?.available) {
    spotifyAction = (
      <button type="button" className="linkcard-btn" onClick={() => void begin()}>
        {phase === 'failed' || phase === 'timedOut' ? 'Try again' : 'Connect'}
      </button>
    );
  }

  return (
    <Section id="music" title="Music" kicker="03">
      <ul className="svc-list">
        <ServiceRow name="Apple Music" tone="on" status="Always on — no sign-in needed." />
        <ServiceRow name="Spotify" tone={spotifyTone} status={spotifyStatus} action={spotifyAction} />
        <ServiceRow name="TuneIn" tone="on" status="Always on — radio from everywhere." />
      </ul>
      <p className="set-fine">Search asks every connected service at once.</p>
    </Section>
  );
}

function ServiceRow({
  name,
  status,
  tone,
  action,
}: {
  name: string;
  status: string;
  tone: 'on' | 'off' | 'wait';
  action?: React.ReactNode;
}) {
  return (
    <li className="set-row svc-row">
      <span className={`svc-lamp is-${tone}`} aria-hidden="true" />
      <div className="set-row-text">
        <span className="set-row-title">{name}</span>
        <span className="set-row-sub" aria-live="polite">
          {status}
        </span>
      </div>
      {action}
    </li>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────

function Home() {
  const topology = useSonos((s) => s.topology);
  const busy = useSonos((s) => s.busy);
  const rediscover = useSonos((s) => s.rediscover);

  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const rooms: Zone[] = (topology?.groups ?? [])
    .flatMap((g) => g.members)
    .filter((z) => !z.invisible)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Section id="home" title="Home" kicker="04">
      <div className="set-row home-head">
        <div className="set-row-text">
          <span className="set-row-title">{topology ? plural(rooms.length, 'room') : 'Looking…'}</span>
          <span className="set-row-sub">
            {topology ? `Found ${agoLabel(topology.discoveredAt)} on this network` : 'Listening for speakers'}
          </span>
        </div>
        <button type="button" className="set-btn" onClick={() => void rediscover()} disabled={busy}>
          <Radar size={13} className={busy ? 'is-spinning' : undefined} />
          {busy ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      <ul className="home-rooms">
        {rooms.map((z) => (
          <li key={z.uuid} className="home-room">
            <span className="home-room-name">{z.name}</span>
            <span className="home-room-model">{z.model ?? 'Sonos'}</span>
            <span className="home-room-ip">{z.ip}</span>
          </li>
        ))}
      </ul>

      {topology?.householdId && (
        <p className="home-hh">
          <span className="label">Household</span> <span className="home-room-ip">{topology.householdId}</span>
        </p>
      )}
      <p className="set-fine">
        Phaedrus remembers every house it has seen, so it picks the right one by itself on each Wi-Fi, along with the
        room you last played in there.
      </p>
    </Section>
  );
}

// ── About ────────────────────────────────────────────────────────────────────

const KEYS: { keys: string[]; what: string }[] = [
  { keys: ['Space'], what: 'Play or pause' },
  { keys: ['←', '→'], what: 'Skip back or ahead 10 seconds' },
  { keys: ['↑', '↓'], what: 'Volume up or down' },
  { keys: ['⌘', 'K'], what: 'Search' },
  { keys: ['⌘', ','], what: 'Settings' },
  { keys: ['Esc'], what: 'Close whatever is open' },
];

function About() {
  return (
    <Section id="about" title="About" kicker="05">
      <div className="about-mark">
        <span className="about-name">Phaedrus</span>
        <span className="about-ver num">v{version}</span>
      </div>
      <p className="about-line">A record player for a house full of Sonos.</p>

      <h4 className="label about-sub">Keyboard</h4>
      <dl className="keys">
        {KEYS.map((k) => (
          <div key={k.what} className="keys-row">
            <dt>
              {k.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{k.what}</dd>
          </div>
        ))}
      </dl>

      <p className="about-credits">
        Built with Tauri and React. Set in Fraunces, Karla, Archivo and Inter. Talks to your speakers directly, over
        your own network.
      </p>
    </Section>
  );
}
