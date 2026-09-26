import { useEffect, useMemo, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { useSkin } from '../store/skin';
import Hero from './Hero';
import HifiMeters from './HifiMeters';
import BoardStage from './BoardStage';
import Progress from './Progress';
import Transport from './Transport';
import VolumeKnob from './VolumeKnob';
import Faders from './Faders';
import TunerStage from './TunerStage';
import DriveStage from './DriveStage';
import DaylightStage from './DaylightStage';
import DeckStage from './DeckStage';
import PrismStage from './PrismStage';
import '../styles/nowplaying.css';

/** How long each line of the board's cycling sub-head holds before it turns. */
const CYCLE_MS = 14_000;

const SOURCE_LABEL: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify Connect',
};

/**
 * A departure board is never quite still: the sub-head rotates through what
 * else is worth knowing. Timers stop while the tab is hidden, and the whole
 * thing is inert in the hi-fi skin.
 */
function useCyclingLine(lines: string[], enabled: boolean): string {
  const [step, setStep] = useState(0);
  const key = lines.join('\u0000');

  useEffect(() => setStep(0), [key]); // a new track starts on the artist again

  useEffect(() => {
    if (!enabled || lines.length < 2) return;
    let timer: number | undefined;

    const start = () => {
      timer = window.setInterval(() => setStep((n) => n + 1), CYCLE_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (timer === undefined) start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, key, lines.length]);

  return lines.length ? lines[step % lines.length] : '';
}

/**
 * The stage: turntable above (jacket, disc, track, transport), amplifier
 * faceplate below (volume knob, one fader per room).
 *
 * The board skin keeps that skeleton but turns the head of it on its side —
 * a departure line reads across, not down — and swaps the jacket for a flap
 * panel and the title for split-flap cells.
 *
 * The tuner skin keeps only the faceplate: everything above it becomes one
 * black front panel with a vacuum-fluorescent display across it.
 */
export default function NowPlaying() {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const skin = useSkin((s) => s.skin);
  const board = skin === 'board';

  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;

  const title = state?.isRadio ? state.stationName ?? track?.title ?? 'Radio' : track?.title;
  const secondary = state?.isRadio ? track?.streamContent : track?.artist;
  const tertiary = state?.isRadio
    ? track?.title && track.title !== state.stationName
      ? track.title
      : undefined
    : track?.album;

  const position =
    state?.queueIndex && state.queueLength ? `${state.queueIndex} of ${state.queueLength}` : undefined;

  const queue = useSonos((s) => s.queue);
  const upNext = useMemo(() => {
    if (!state?.queueIndex || state.isRadio) return undefined;
    return queue.find((q) => q.index === state.queueIndex! + 1)?.title;
  }, [queue, state?.queueIndex, state?.isRadio]);

  const rooms = useMemo(() => {
    if (!group) return undefined;
    const others = group.members.length - 1;
    return others > 0 ? `${group.name} + ${others} MORE` : group.name;
  }, [group]);

  const boardLines = useMemo(() => {
    const lines: string[] = [];
    if (secondary) lines.push(secondary);
    if (upNext) lines.push(`UP NEXT · ${upNext}`);
    if (rooms) lines.push(`PLAYING IN · ${rooms}`);
    if (tertiary) lines.push(tertiary);
    return lines;
  }, [secondary, upNext, rooms, tertiary]);

  const boardLine = useCyclingLine(boardLines, board);

  const over = (
    <div className="meta-over">
      <span className="meta-room">{group?.name ?? '—'}</span>
      {state && (
        <>
          <span className="meta-sep" aria-hidden="true" />
          <span>{SOURCE_LABEL[state.source] ?? state.source}</span>
        </>
      )}
      {position && (
        <>
          <span className="meta-sep" aria-hidden="true" />
          <span className="num">{position}</span>
        </>
      )}
    </div>
  );

  const faceplate = (
    <div className="faceplate" role="group" aria-label="Volume">
      <VolumeKnob />
      <Faders />
      {skin === 'hifi' && <HifiMeters playing={!!playing} />}
      <div className="faceplate-brand" aria-hidden="true">
        <i className={`faceplate-led${playing ? ' is-lit' : ''}`} />
        <span>Phædrus</span>
      </div>
    </div>
  );

  if (skin === 'tuner') {
    return (
      <section className="stage stage-tuner" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <TunerStage />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  if (skin === 'drive') {
    return (
      <section className="stage stage-drive" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <DriveStage />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  if (skin === 'daylight') {
    return (
      <section className="stage stage-daylight" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <DaylightStage />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  if (skin === 'deck') {
    return (
      <section className="stage stage-deck" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <DeckStage />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  if (skin === 'prism') {
    return (
      <section className="stage stage-prism" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <PrismStage />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  if (board) {
    return (
      <section className="stage stage-board" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            <BoardStage line={boardLine} lines={boardLines} />
          </div>
        </div>

        {faceplate}
      </section>
    );
  }

  return (
    <section className="stage" aria-label="Now playing">
      <div className="stage-scroll">
        <div className="stage-body">
          <Hero art={track?.art} playing={!!playing} loaded={!idle} title={title} />

          <div className="meta">
            {over}

            {idle ? (
              <h1 className="meta-title meta-title-idle">Nothing on</h1>
            ) : (
              <>
                <h1 className="meta-title" title={title}>
                  {title}
                </h1>
                {secondary && <p className="meta-artist">{secondary}</p>}
                {tertiary && <p className="meta-album">{tertiary}</p>}
              </>
            )}
          </div>

          <Progress />
          <Transport />
        </div>
      </div>

      {faceplate}
    </section>
  );
}
