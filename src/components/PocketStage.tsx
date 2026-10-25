import { useEffect, useRef } from 'react';
import { useSonos } from '../store/useSonos';
import { cycleRepeat, fromPlayMode, toggleShuffle } from '../store/playMode';
import Progress from './Progress';
import PocketArt from './PocketArt';
import '../styles/pocket.css';

const SOURCE_LABEL: Record<string, string> = {
  queue: 'QUEUE',
  radio: 'RADIO',
  linein: 'LINE IN',
  tv: 'TV',
  airplay: 'AIRPLAY',
  'spotify-connect': 'SPOTIFY',
};

const two = (n: number) => String(n).padStart(2, '0');

/**
 * A handheld from 1989 that never existed: warm gray plastic, a charcoal
 * bezel round a four-shade pea-green LCD, a D-pad, two round buttons, two
 * rubber pills and a little red power lamp. The screen shows the cover in
 * dots and the track in a chunky pixel face; the buttons drive the speakers.
 *
 * The D-pad and buttons call the same store actions Transport does — a
 * handheld has no room for Transport's row — and Progress is the app's own,
 * restyled as a block bar on the LCD.
 */
export default function PocketStage() {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);

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

  const { shuffle, repeat } = fromPlayMode(state?.playMode ?? 'NORMAL');

  return (
    <div className={`pocket${playing ? ' is-playing' : ''}`}>
      <div className="pk-body">
        <i className="pk-ridges" aria-hidden="true" />

        <div className="pk-bezel">
          <div className="pk-lcd">
            <div className="pk-status">
              <span className="pk-status-room">{group?.name ?? '—'}</span>
              <span className="pk-status-src">{state ? (SOURCE_LABEL[state.source] ?? state.source.toUpperCase()) : ''}</span>
              <span className="pk-flags" aria-label="Play modes">
                <i className={shuffle ? 'is-on' : undefined} title="Shuffle">SHF</i>
                <i className={repeat !== 'off' ? 'is-on' : undefined} title="Repeat">
                  {repeat === 'one' ? 'RP1' : 'RPT'}
                </i>
                <i className={state?.crossfade ? 'is-on' : undefined} title="Crossfade">XF</i>
              </span>
              <span className="pk-state" aria-label={playing ? 'Playing' : 'Paused'}>
                {playing ? '▶' : '❚❚'}
              </span>
            </div>

            <div className="pk-main">
              <PocketArt art={track?.art} title={title} idle={idle} />

              <div className="pk-text">
                <h1 className={`pk-title${idle ? ' is-idle' : ''}`} title={title}>
                  {idle ? 'Nothing on' : title}
                </h1>
                {!idle && artist && <p className="pk-artist">{artist}</p>}
                {!idle && album && <p className="pk-album">{album}</p>}
                {state?.queueIndex && state.queueLength ? (
                  <p className="pk-track">
                    TRK {two(state.queueIndex)}/{two(state.queueLength)}
                  </p>
                ) : null}
              </div>
            </div>

            <Progress />
          </div>
        </div>

        <div className="pk-mark" aria-hidden="true">
          <i className={`pk-power${playing ? ' is-lit' : ''}`} />
          <span className="pk-power-label">POWER</span>
          <span className="pk-name">
            PHÆDRUS <b>pocket</b>
          </span>
        </div>

        <PocketControls shuffle={shuffle} />

        <i className="pk-grille" aria-hidden="true" />
      </div>
    </div>
  );
}

function PocketControls({ shuffle }: { shuffle: boolean }) {
  const state = useSonos((s) => s.state);
  const toggle = useSonos((s) => s.toggle);
  const skipNext = useSonos((s) => s.skipNext);
  const skipPrev = useSonos((s) => s.skipPrev);
  const bumpVolume = useSonos((s) => s.bumpVolume);
  const setPlayMode = useSonos((s) => s.setPlayMode);
  const setCrossfade = useSonos((s) => s.setCrossfade);

  const volUp = useRepeat(() => void bumpVolume(2));
  const volDown = useRepeat(() => void bumpVolume(-2));

  if (!state) return null;

  const playing = state.state === 'PLAYING' || state.state === 'TRANSITIONING';
  const radio = state.isRadio;
  const { repeat } = fromPlayMode(state.playMode);

  return (
    <div className="pk-controls">
      <div className="pk-dpad-wrap">
        <span className="pk-print pk-print-up">VOL +</span>
        <div className="pk-dpad" role="group" aria-label="Direction pad">
          <button type="button" className="pk-dir pk-up" aria-label="Volume up" {...volUp}>
            <i />
          </button>
          <button type="button" className="pk-dir pk-down" aria-label="Volume down" {...volDown}>
            <i />
          </button>
          <button
            type="button"
            className="pk-dir pk-left"
            aria-label="Previous track"
            disabled={radio}
            onClick={() => void skipPrev()}
          >
            <i />
          </button>
          <button
            type="button"
            className="pk-dir pk-right"
            aria-label="Next track"
            disabled={radio}
            onClick={() => void skipNext()}
          >
            <i />
          </button>
          <span className="pk-dpad-hub" aria-hidden="true" />
        </div>
        <span className="pk-print pk-print-down">VOL −</span>
        <span className="pk-print pk-print-left">PREV</span>
        <span className="pk-print pk-print-right">NEXT</span>
      </div>

      <div className="pk-pills">
        <div className="pk-pill-wrap">
          <button
            type="button"
            className={`pk-pill${repeat !== 'off' ? ' is-on' : ''}`}
            aria-label={`Repeat ${repeat}`}
            disabled={radio}
            onClick={() => setPlayMode(cycleRepeat(state.playMode))}
          />
          <span className="pk-print">{repeat === 'one' ? 'REPEAT 1' : 'REPEAT'}</span>
        </div>
        <div className="pk-pill-wrap">
          <button
            type="button"
            className={`pk-pill${state.crossfade ? ' is-on' : ''}`}
            aria-pressed={state.crossfade}
            aria-label={state.crossfade ? 'Crossfade on' : 'Crossfade off'}
            disabled={radio}
            onClick={() => setCrossfade(!state.crossfade)}
          />
          <span className="pk-print">FADE</span>
        </div>
      </div>

      <div className="pk-ab">
        <div className="pk-btn-wrap pk-b">
          <button
            type="button"
            className={`pk-btn${shuffle ? ' is-on' : ''}`}
            aria-pressed={shuffle}
            aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
            disabled={radio}
            onClick={() => setPlayMode(toggleShuffle(state.playMode))}
          >
            B
          </button>
          <span className="pk-print">SHUFFLE</span>
        </div>
        <div className="pk-btn-wrap pk-a">
          <button
            type="button"
            className={`pk-btn${playing ? ' is-on' : ''}`}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => void toggle()}
          >
            A
          </button>
          <span className="pk-print">{playing ? 'PAUSE' : 'PLAY'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Press once for one step; hold and it keeps stepping, the way a D-pad
 * scrolls a menu. Keyboard presses step once per keydown (the OS repeats).
 */
function useRepeat(step: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(step);
  latest.current = step;

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      latest.current();
      stop();
      timer.current = window.setTimeout(() => {
        timer.current = window.setInterval(() => latest.current(), 140);
      }, 380);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        latest.current();
      }
    },
  };
}
