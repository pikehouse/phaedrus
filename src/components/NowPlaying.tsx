import { useSonos } from '../store/useSonos';
import { useSkin } from '../store/skin';
import Hero from './Hero';
import ArtPanel from './ArtPanel';
import SplitFlap from './SplitFlap';
import Progress from './Progress';
import Transport from './Transport';
import VolumeKnob from './VolumeKnob';
import Faders from './Faders';
import '../styles/nowplaying.css';

const SOURCE_LABEL: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify Connect',
};

/**
 * The stage: turntable above (jacket, disc, track, transport), amplifier
 * faceplate below (volume knob, one fader per room).
 *
 * The board skin keeps that skeleton but turns the head of it on its side —
 * a departure line reads across, not down — and swaps the jacket for a flap
 * panel and the title for split-flap cells.
 */
export default function NowPlaying() {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const board = useSkin((s) => s.skin === 'board');

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
    <div className="faceplate" aria-label="Volume">
      <VolumeKnob />
      <Faders />
      <div className="faceplate-brand" aria-hidden="true">
        <i className={`faceplate-led${playing ? ' is-lit' : ''}`} />
        <span>Phædrus</span>
      </div>
    </div>
  );

  if (board) {
    return (
      <section className="stage stage-board" aria-label="Now playing">
        <div className="stage-scroll">
          <div className="stage-body">
            {over}

            <div className="board-head">
              <ArtPanel art={track?.art} title={title} playing={!!playing} />

              <div className="meta">
                <SplitFlap
                  text={idle ? 'Nothing on' : (title ?? '')}
                  size="xl"
                  className="board-title"
                />
                {secondary && <SplitFlap text={secondary} size="lg" className="board-artist" />}
                {tertiary && <p className="meta-album">{tertiary}</p>}
              </div>
            </div>

            <Progress />
            <Transport />
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
