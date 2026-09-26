import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import ArtPanel from './ArtPanel';
import SplitFlap from './SplitFlap';
import Progress from './Progress';
import Transport from './Transport';

const SOURCE_LABEL: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify Connect',
};

interface Props {
  /** The cycling sub-head NowPlaying rotates (artist → up next → rooms → album). */
  line: string;
  /** Every line it rotates through, so the cells keep one size for all of them. */
  lines: string[];
}

/* ── The table's geometry ───────────────────────────────────────────────── */

type ColKey = 'time' | 'dest' | 'via' | 'no' | 'status';

interface Col {
  key: ColKey;
  label: string;
  cells: number;
}

const COL_GAP = 16; // px between columns, a blank module on a real board
const CELL_GAP = 2; // px between cells, as in splitflap.css
const MIN_DEST = 14;
const MAX_DEST = 24;

/**
 * Which columns a board of this width carries, and at what cell pitch. The
 * destination column takes whatever cells are left once the fixed columns
 * are set, so the table always runs edge to edge on one pitch — the way a
 * board is ordered from the factory to fit the wall it hangs on.
 */
function tableLayout(width: number, maxPitch: number): { cols: Col[]; pitch: number } {
  const plans: Omit<Col, 'label'>[][] = [
    [
      { key: 'time', cells: 5 },
      { key: 'dest', cells: 0 },
      { key: 'via', cells: 12 },
      { key: 'no', cells: 3 },
      { key: 'status', cells: 7 },
    ],
    [
      { key: 'time', cells: 5 },
      { key: 'dest', cells: 0 },
      { key: 'via', cells: 11 },
      { key: 'status', cells: 7 },
    ],
    [
      { key: 'time', cells: 5 },
      { key: 'dest', cells: 0 },
      { key: 'status', cells: 7 },
    ],
  ];
  const minPitch = 11;
  for (const [i, plan] of plans.entries()) {
    const gaps = (plan.length - 1) * COL_GAP;
    const fixed = plan.reduce((n, c) => n + c.cells, 0);
    // Largest pitch at which the destination still gets its minimum.
    const pitch = Math.min(maxPitch, Math.floor((width - gaps + CELL_GAP * plan.length) / (fixed + MIN_DEST)));
    if (pitch < 16 && i < plans.length - 1) continue; // too fine to read: shed a column
    const p = Math.max(minPitch, pitch);
    const room = Math.floor((width - gaps + CELL_GAP * plan.length) / p) - fixed;
    const dest = Math.max(MIN_DEST, Math.min(MAX_DEST, room));
    return {
      pitch: p,
      cols: plan.map((c) => ({ ...c, cells: c.key === 'dest' ? dest : c.cells, label: LABELS[c.key] })),
    };
  }
  return { pitch: minPitch, cols: [] };
}

const LABELS: Record<ColKey, string> = {
  time: 'Time',
  dest: 'Destination',
  via: 'Via',
  no: 'No.',
  status: 'Status',
};

/* ── Small hooks ────────────────────────────────────────────────────────── */

function useMedia(query: string): boolean {
  const mq = useMemo(() => window.matchMedia(query), [query]);
  return useSyncExternalStore(
    (cb) => {
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => mq.matches,
    () => false,
  );
}

/** Wall time, ticking over on the minute (and on waking from a hidden tab). */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      clearTimeout(timer);
      const t = Date.now();
      setNow(t);
      timer = window.setTimeout(arm, 60_000 - (t % 60_000) + 30);
    };
    const onVisibility = () => {
      if (!document.hidden) arm();
    };
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return now;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.floor(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* ── Text for a fixed-width column ──────────────────────────────────────── */

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A board has no room for "(2011 Remaster)"; it cuts at a word if it can. */
function clip(text: string | undefined, cells: number, name = false): string {
  if (!text) return '';
  let t = text
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = text.trim();
  if (t.length <= cells) return t;
  // Real boards abbreviate rather than chop: "A. FRANKLIN", not "ARETHA FRANK".
  const words = t.split(' ');
  if (name && words.length > 1) {
    const initials = words.slice(0, -1).map((w) => `${w[0]}.`).join(' ') + ' ' + words[words.length - 1];
    if (initials.length <= cells) return initials;
  }
  // Otherwise end on a whole word; chop mid-word only if the first word alone is too long.
  const cut = t.lastIndexOf(' ', cells);
  return cut > 0 ? t.slice(0, cut) : t.slice(0, cells);
}

const padStart = (s: string, n: number) => (s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s);

/**
 * The board skin's stage: a black Solari board screwed to the enamel wall.
 * A header strip with the room and a wall clock; the current track as the
 * lead line beside the operator's panel (the cover, which flips over like one
 * big card); and under it the departures — the next few tracks of the queue,
 * each with the time it will leave. Progress and transport hang below the
 * board, on the wall.
 */
export default function BoardStage({ line, lines }: Props) {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const queue = useSonos((s) => s.queue);
  const receivedAt = useSonos((s) => s.receivedAt);
  const now = useMinute();

  const phone = useMedia('(max-width: 759.98px)');
  const short = useMedia('(max-height: 719.98px)');
  const tall = useMedia('(min-height: 900px)');
  const [tableRef, tableWidth] = useWidth<HTMLDivElement>();

  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const radio = !!state?.isRadio;

  const title = radio ? (state?.stationName ?? track?.title ?? 'Radio') : track?.title;

  const rooms = useMemo(() => {
    if (!group) return '—';
    const others = group.members.length - 1;
    return others > 0 ? `${group.name} + ${others}` : group.name;
  }, [group]);

  const rowCount = phone || short ? 3 : 4;
  const maxPitch = phone ? 15 : short ? 18 : tall ? 22 : 20;
  const { cols, pitch } = tableLayout(tableWidth || 600, maxPitch);

  // Each departure's time: what's left of this track, then every track before it.
  const departures = useMemo(() => {
    if (idle) return [];
    if (radio) {
      // A station is one continuous service: it's on the board, it's live, it never leaves.
      const song = track?.streamContent || (track?.title !== state?.stationName ? track?.title : undefined);
      // Stations broadcast "Artist — Song"; the song is the destination, the artist the route.
      const parts = song?.split(/\s+[—–-]\s+/);
      const [via, dest] = parts && parts.length >= 2 ? [parts[0], parts.slice(1).join(' ')] : [state?.stationName, song];
      return [{ index: 0, title: dest || 'Continuous service', artist: via, time: hhmm(Date.now()), live: true }];
    }
    if (!state?.queueIndex) return [];
    const pos = livePosition({ state, receivedAt });
    let at = Date.now() + Math.max(0, (state.durationSecs || 0) - pos) * 1000;
    // Shuffled, the queue's order says nothing about what leaves next.
    let known = !!state.durationSecs && !state.playMode.startsWith('SHUFFLE');
    const out: { index: number; title: string; artist?: string; time: string; live?: boolean }[] = [];
    for (let k = 1; k <= rowCount; k++) {
      const item = queue.find((q) => q.index === state.queueIndex! + k);
      if (!item) break;
      out.push({ index: item.index, title: item.title, artist: item.artist, time: known ? hhmm(at) : '' });
      if (item.durationSecs) at += item.durationSecs * 1000;
      else known = false;
    }
    return out;
  }, [idle, radio, state, track, receivedAt, now, queue, rowCount]);

  const held = !idle && !playing;
  const shuffled = !radio && !!state?.playMode.startsWith('SHUFFLE');
  const callingAt = group?.members.map((m) => m.name).join(' · ') ?? '—';
  // When this track arrives: the wall time the current track ends.
  const due =
    !idle && !radio && state?.durationSecs
      ? hhmm(Date.now() + Math.max(0, state.durationSecs - livePosition({ state, receivedAt })) * 1000)
      : undefined;
  const plate = idle ? '' : radio ? (playing ? 'LIVE' : 'OFF') : playing ? 'NOW' : 'HELD';
  const tableVars = {
    '--flap-w': `${pitch - CELL_GAP}px`,
    '--flap-h': `${Math.round((pitch - CELL_GAP) * 1.42)}px`,
    '--flap-fs': `${Math.round((pitch - CELL_GAP) * 0.96)}px`,
    '--col-gap': `${COL_GAP}px`,
  } as React.CSSProperties;

  const position =
    state?.queueIndex && state.queueLength && !radio
      ? `${String(state.queueIndex).padStart(2, '0')} / ${String(state.queueLength).padStart(2, '0')}`
      : undefined;

  return (
    <div className={`board${held ? ' is-held' : ''}${idle ? ' is-idle' : ''}`}>
      <div className="board-housing">
        <i className="board-bolt is-tl" aria-hidden="true" />
        <i className="board-bolt is-tr" aria-hidden="true" />
        <i className="board-bolt is-bl" aria-hidden="true" />
        <i className="board-bolt is-br" aria-hidden="true" />

        <header className="board-header">
          <span className="board-sign">Departures</span>
          <span className="board-room">{rooms}</span>
          <span className="board-header-fill" aria-hidden="true" />
          {state && (
            <span className="board-source">
              {SOURCE_LABEL[state.source] ?? state.source}
              {position && <b className="num">{position}</b>}
            </span>
          )}
          <span className="board-clock" aria-label={`Time ${hhmm(now)}`}>
            <SplitFlap text={hhmm(now)} drum="digits" size="custom" cells={5} />
          </span>
        </header>

        <div className="board-lead">
          <div className="board-mount">
            <ArtPanel art={track?.art} title={title} playing={!!playing} />
          </div>

          <div className="board-lead-text">
            <div className="board-lead-top">
              <span className="board-kicker">{radio ? 'On air' : idle ? 'Service' : held ? 'Held at platform' : 'Now departing'}</span>
              <span className={`board-plate${plate === 'NOW' || plate === 'LIVE' ? ' is-signal' : ''}`}>
                <SplitFlap text={plate} size="custom" cells={plate.length || 4} />
              </span>
            </div>
            <SplitFlap
              text={idle ? 'No departures' : (title ?? '')}
              size="xl"
              className="board-title"
              tic
              fit={{ lines: 2, min: 14 }}
            />
            {!idle && line && (
              <SplitFlap text={line} size="lg" className="board-artist" fit={{ lines: 2, min: 11, to: lines }} />
            )}
            {!idle && (
              <div className="board-calling">
                <span className="board-calling-label">Calling at</span>
                <span className="board-calling-rooms">{callingAt}</span>
                {due && (
                  <>
                    <span className="board-calling-label">Arr.</span>
                    <span className="board-calling-due num">{due}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="board-table" ref={tableRef} style={tableVars}>
            <>
              <div className="board-row board-row-head" aria-hidden="true">
                {cols.map((c) => (
                  <span key={c.key} className={`board-col board-col-${c.key}`} style={{ '--cells': c.cells } as React.CSSProperties}>
                    {c.label}
                  </span>
                ))}
              </div>
              {Array.from({ length: rowCount }, (_, r) => {
                const d = departures[r];
                const status = !d
                  ? ''
                  : d.live
                    ? held
                      ? 'OFF AIR'
                      : 'LIVE'
                    : shuffled
                      ? 'TBA'
                      : held
                        ? 'DELAYED'
                        : r === 0
                          ? 'NEXT'
                          : 'ON TIME';
                const text: Record<ColKey, string> = {
                  time: d?.time ?? '',
                  dest: d ? clip(d.title, cols.find((c) => c.key === 'dest')?.cells ?? 12) : '',
                  via: d ? clip(d.artist, cols.find((c) => c.key === 'via')?.cells ?? 11, true) : '',
                  no: d && !d.live ? padStart(String(d.index), 3) : '',
                  status,
                };
                return (
                  <div
                    key={r}
                    className={`board-row${r === 0 ? ' is-next' : ''}${held && d ? ' is-delayed' : ''}${d?.live ? ' is-live' : ''}`}
                  >
                    {cols.map((c) => (
                      <span key={c.key} className={`board-col board-col-${c.key}`} style={{ '--cells': c.cells } as React.CSSProperties}>
                        <SplitFlap
                          text={text[c.key]}
                          cells={c.cells}
                          size="custom"
                          drum={c.key === 'time' || c.key === 'no' ? 'digits' : 'text'}
                        />
                      </span>
                    ))}
                  </div>
                );
              })}
            </>
        </div>
      </div>

      <div className="board-foot">
        <Progress />
        <Transport />
      </div>
    </div>
  );
}
