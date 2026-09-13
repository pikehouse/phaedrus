import { useState } from 'react';
import { useSonos } from '../store/useSonos';
import Progress from './Progress';
import Transport from './Transport';
import PrismWall from './PrismWall';
import PrismComb from './PrismComb';
import { trackSeed } from './DeckSignal';
import '../styles/prism.css';

const SOURCE_LABEL: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify Connect',
};

/**
 * Light through glass: a spectrum projected on a warm dark wall with the
 * record hung in it, and below, a matte black instrument whose comb of
 * filaments glows in the same colours and reflects in the glossy floor.
 *
 * Progress and Transport are the app's own components, restyled in
 * skin-prism.css; the faceplate below is NowPlaying's.
 */
export default function PrismStage() {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);

  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const radio = !!state?.isRadio;

  const title = radio ? (state?.stationName ?? track?.title ?? 'Radio') : track?.title;
  const artist = radio ? track?.streamContent : track?.artist;
  const album = radio ? (track?.title && track.title !== state?.stationName ? track.title : undefined) : track?.album;

  // A station keeps one light for as long as it plays; every song re-seeding
  // it would make the comb restart its tune several times an hour.
  const seed = trackSeed(title, radio ? undefined : artist);

  const others = group ? group.members.length - 1 : 0;
  const where = [
    group ? (others > 0 ? `${group.name} + ${others}` : group.name) : undefined,
    state ? (SOURCE_LABEL[state.source] ?? state.source) : undefined,
    state?.queueIndex && state.queueLength && !radio ? `${state.queueIndex} of ${state.queueLength}` : undefined,
  ].filter(Boolean);

  const rooms = group?.members.length ?? state?.members.length ?? 0;
  const more = !radio && !!state?.queueIndex && !!state.queueLength && state.queueIndex < state.queueLength;

  return (
    <div className="prism">
      <PrismWall art={idle ? undefined : track?.art} seed={seed} playing={playing} idle={idle}>
        <PrismCover art={idle ? undefined : track?.art} title={title} />

        <div className="pw-lockup">
          {idle ? (
            <h1 className="pw-title is-idle">Nothing on</h1>
          ) : (
            <>
              <h1 className="pw-title" title={title}>
                {title}
              </h1>
              {artist && <p className="pw-artist">{artist}</p>}
              {album && <p className="pw-album">{album}</p>}
            </>
          )}
          {where.length > 0 && (
            <p className="pw-where num">
              {where.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </p>
          )}
        </div>
      </PrismWall>

      <PrismComb seed={seed} playing={playing} loaded={!idle} rooms={rooms} more={more} />

      <div className="prism-dash">
        <Progress />
        <Transport />
      </div>
    </div>
  );
}

/** The sleeve on the wall. With nothing on — or art that will not load — a dark square and one thin line of light. */
function PrismCover({ art, title }: { art?: string; title?: string }) {
  const [broken, setBroken] = useState<string>();
  const show = !!art && broken !== art;
  return (
    <div className={`pw-cover${show ? '' : ' is-blank'}`}>
      {show && (
        <img
          src={art}
          alt={title ? `Cover of ${title}` : ''}
          draggable={false}
          onError={() => setBroken(art)}
        />
      )}
    </div>
  );
}
