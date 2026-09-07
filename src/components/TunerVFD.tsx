import { useEffect, useMemo, useState } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import { fromPlayMode } from '../store/playMode';
import { hashString } from '../lib/hash';
import { mmss } from '../lib/format';
import TunerSegment14 from './TunerSegment14';
import TunerMarquee from './TunerMarquee';
import TunerSpectrum from './TunerSpectrum';
import '../styles/tuner.css';

export type Display = 'text' | 'spectrum' | 'image';

const SOURCE: Record<string, string> = {
  queue: 'QUEUE',
  radio: 'FM',
  linein: 'LINE',
  tv: 'TV',
  airplay: 'AIRPLAY',
  'spotify-connect': 'SPOTIFY',
};

/** "4:32" out of mmss, "04:32" on a faceplate — a readout never drops a digit. */
const pad = (s: string) => (/^\d:/.test(s) ? `0${s}` : s);
const two = (n: number | undefined) => (n == null ? '--' : String(n).padStart(2, '0'));

/**
 * Whole seconds of live position, resynced from the store rather than kept in
 * React — segments only need to change once a second, so this re-renders at
 * 1Hz however often the poller lands.
 */
function useElapsed(): number {
  const [secs, setSecs] = useState(() => Math.floor(livePosition(useSonos.getState())));
  useEffect(() => {
    const read = () => {
      const n = Math.floor(livePosition(useSonos.getState()));
      setSecs((prev) => (prev === n ? prev : n));
    };
    read();
    const t = setInterval(read, 200);
    return () => clearInterval(t);
  }, []);
  return secs;
}

/**
 * The vacuum-fluorescent display: a smoked-glass window with a segment clock
 * on the left, a programme area in the middle, an analyzer and a signal meter
 * on the right, and a strip of indicator lamps across the bottom.
 */
export default function TunerVFD({ mode }: { mode: Display }) {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const queue = useSonos((s) => s.queue);
  const elapsed = useElapsed();

  const track = state?.track;
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const loaded = !!state && state.state !== 'NO_MEDIA_PRESENT' && !!track;
  const radio = !!state?.isRadio;

  const title = radio ? state?.stationName ?? track?.title : track?.title;
  const line = useMemo(() => {
    const parts = radio
      ? [state?.stationName, track?.streamContent, track?.title]
      : [track?.title, track?.artist, track?.album];
    const seen = new Set<string>();
    const kept = parts.filter((p): p is string => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    return kept.length ? kept.join('  —  ').toUpperCase() : 'NO PROGRAMME';
  }, [radio, state?.stationName, track?.title, track?.artist, track?.album, track?.streamContent]);

  const seed = useMemo(() => hashString(`${title ?? ''}|${track?.artist ?? ''}`), [title, track?.artist]);
  const { shuffle, repeat } = fromPlayMode(state?.playMode ?? 'NORMAL');
  const rooms = group?.members.length ?? 0;
  const raw = state?.source ?? '';
  const source = SOURCE[raw] ?? (raw ? raw.toUpperCase() : 'IDLE');

  return (
    <div className="tvfd" data-mode={mode}>
      <div className="tvfd-glass">
        <div className="tvfd-inner">
          <div className="tvfd-clock">
            <TunerSegment14
              className="tvfd-clock-big"
              text={radio ? 'LIVE' : loaded ? pad(mmss(elapsed)) : '--:--'}
              label={radio ? 'Live' : `Elapsed ${mmss(elapsed)}`}
            />
            <div className="tvfd-clock-sub">
              {radio ? (
                <>
                  <span className="tvfd-tag">ON AIR</span>
                  <TunerSegment14 className="tvfd-clock-small" text={pad(mmss(elapsed))} />
                </>
              ) : (
                <>
                  <span className="tvfd-tag">TRK</span>
                  <TunerSegment14 className="tvfd-clock-small" text={two(state?.queueIndex)} />
                  <span className="tvfd-tag tvfd-tag-dim">OF</span>
                  <TunerSegment14
                    className="tvfd-clock-small tvfd-clock-dim"
                    text={two(state?.queueLength || queue.length || undefined)}
                  />
                </>
              )}
            </div>
          </div>

          <div className="tvfd-centre">
            {mode === 'text' && (
              <>
                <TunerMarquee text={line} className="tvfd-line" />
                {!radio && <Calendar length={state?.queueLength || queue.length} current={state?.queueIndex} />}
              </>
            )}
            {mode === 'spectrum' && (
              <TunerSpectrum seed={seed} playing={!!playing} bands={26} rows={18} className="tsp-wide" />
            )}
            {mode === 'image' && <Phosphor art={track?.art} title={title} />}
          </div>

          {mode !== 'spectrum' && (
            <div className="tvfd-spec">
              <TunerSpectrum seed={seed} playing={!!playing} bands={14} rows={18} />
            </div>
          )}

          <Signal volume={state?.volume ?? 0} playing={!!playing} loaded={loaded} />

          <div className="tvfd-strip">
            <span className="tvfd-source">
              {(group?.name ?? '—').toUpperCase()}
              <i className="tvfd-source-dot" />
              {source}
            </span>
            <span className="tvfd-lamps">
              <Lamp on={!!playing}>STEREO</Lamp>
              <Lamp on={loaded}>TUNED</Lamp>
              <Lamp on={queue.length > 1} tone="amber">
                MEMORY
              </Lamp>
              <Lamp on={shuffle} tone="amber">
                SHUFFLE
              </Lamp>
              <Lamp on={repeat !== 'off'} tone="amber">
                REPEAT
              </Lamp>
              <Lamp on={!!state?.crossfade} tone="amber">
                X-FADE
              </Lamp>
              <Lamp on={!!state?.muted} tone="red">
                MUTE
              </Lamp>
              <span className="tvfd-lamp-pair">
                <Lamp on={rooms >= 1}>A</Lamp>
                <Lamp on={rooms >= 2}>B</Lamp>
              </span>
            </span>
          </div>
        </div>

        <span className="tvfd-reflect" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * The music calendar every CD player of the era carried: every track on the
 * disc has a number, the ones already played go out, and the one in the
 * transport is boxed. Twenty cells, then an ellipsis — exactly where the real
 * ones gave up too.
 */
function Calendar({ length, current }: { length: number; current?: number }) {
  if (!length) return null;
  const shown = Math.min(length, 20);
  return (
    <div className="tvfd-cal" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => {
        const n = i + 1;
        const state = current == null ? 'idle' : n === current ? 'now' : n < current ? 'past' : 'next';
        return (
          <span key={n} className="tvfd-cal-n" data-state={state}>
            {two(n)}
          </span>
        );
      })}
      {length > shown && (
        <span className="tvfd-cal-n" data-state="next">
          ···
        </span>
      )}
    </div>
  );
}

/** A lamp is on or off. It never fades — that is the whole point of a lamp. */
function Lamp({
  on,
  tone = 'cyan',
  children,
}: {
  on: boolean;
  tone?: 'cyan' | 'amber' | 'red';
  children: React.ReactNode;
}) {
  return (
    <span className={`tvfd-lamp${on ? ' is-on' : ''}`} data-tone={tone}>
      {children}
    </span>
  );
}

/** Eight bars of received signal — here, how hard the group is being driven. */
function Signal({ volume, playing, loaded }: { volume: number; playing: boolean; loaded: boolean }) {
  const lit = Math.round((Math.max(0, Math.min(100, volume)) / 100) * 8);
  return (
    <div className="tvfd-signal">
      <span className="tvfd-signal-bars" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={7 - i < lit ? 'is-on' : undefined} />
        ))}
      </span>
      <span className="tvfd-tag tvfd-tag-dim">SIGNAL</span>
      <span className="tvfd-signal-mode">
        <Lamp on={playing}>ST</Lamp>
        <Lamp on={loaded && !playing}>MONO</Lamp>
      </span>
    </div>
  );
}

/**
 * A 1988 tuner had nowhere to put a cover, so the cover comes to it: the art
 * is crushed to two-ish tones, tinted to the phosphor by multiplying it onto
 * the lit colour, and cut up by a dot grid so it reads as a bitmap rather than
 * a photograph. COLOR gives it back to anyone who would rather just look.
 */
function Phosphor({ art, title }: { art?: string; title?: string }) {
  const [color, setColor] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [art]);

  if (!art || broken) {
    return (
      <div className="tvfd-image is-blank">
        <span className="tvfd-image-none">NO IMAGE</span>
      </div>
    );
  }

  return (
    <div className={`tvfd-image${color ? ' is-color' : ''}`}>
      <span className="tvfd-image-frame">
        <img
          src={art}
          alt={title ? `Cover art for ${title}` : ''}
          draggable={false}
          onError={() => setBroken(true)}
        />
        <span className="tvfd-image-grid" aria-hidden="true" />
      </span>
      <button
        type="button"
        className="tvfd-image-color"
        aria-pressed={color}
        onClick={() => setColor((c) => !c)}
      >
        Color
      </button>
    </div>
  );
}
