import { useEffect, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { averageColor } from '../lib/color';
import DriveGrid from './DriveGrid';
import DriveCover from './DriveCover';
import DriveTitle from './DriveTitle';
import DriveFilm from './DriveFilm';
import DriveWorld from './DriveWorld';
import DriveDash from './DriveDash';
import '../styles/drive.css';

const SOURCE_LABEL: Record<string, string> = {
  queue: 'Queue',
  radio: 'Radio',
  linein: 'Line In',
  tv: 'TV',
  airplay: 'AirPlay',
  'spotify-connect': 'Spotify Connect',
};

/**
 * Los Angeles from the driver's seat at two in the morning: a few stars, a
 * sky that never quite finishes its sunset, hills and a distant city along
 * the horizon, a road running out under a low sun. The cover stands on the
 * wet ground to the left; the title hangs in neon over the sun; a 1985
 * digital dash sits under the windshield. The volume knob and room faders live on
 * the faceplate below, which NowPlaying keeps for every skin.
 *
 * Transport and Progress are the app's own components — the dash restyles
 * them, none of the store logic is forked.
 */
export default function DriveStage() {
  const state = useSonos((s) => s.state);
  const group = useSonos((s) => s.group);
  const [tint, setTint] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);

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
  const position =
    state?.queueIndex && state.queueLength ? `${state.queueIndex} of ${state.queueLength}` : undefined;

  // The cover's colour leaks into the sky and the wet ground under it.
  useEffect(() => {
    let alive = true;
    const art = track?.art;
    if (!art) {
      setTint(null);
      return;
    }
    averageColor(art).then((c) => {
      if (alive) setTint(c);
    });
    return () => {
      alive = false;
    };
  }, [track?.art]);

  // CSS loops (the neon breathing) pause on this flag; the JS ones watch for themselves.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const style = (tint ? { '--tint': tint } : undefined) as React.CSSProperties | undefined;

  return (
    <div
      className={`drive${playing ? ' is-playing' : ''}${hidden ? ' is-hidden' : ''}`}
      style={style}
    >
      <div className="drive-view">
        <i className="drive-sky" aria-hidden="true" />
        <DriveWorld />
        <DriveGrid playing={!!playing} />
        <i className="drive-haze" aria-hidden="true" />
        <i className="drive-horizon" aria-hidden="true" />

        <DriveCover art={track?.art} title={title} idle={idle} />

        <div className="drive-lockup">
          <div className="drive-over">
            <span className="drive-over-room">{group?.name ?? '—'}</span>
            {state && (
              <>
                <i className="drive-over-sep" aria-hidden="true" />
                <span>{SOURCE_LABEL[state.source] ?? state.source}</span>
              </>
            )}
            {position && (
              <>
                <i className="drive-over-sep" aria-hidden="true" />
                <span className="num">{position}</span>
              </>
            )}
          </div>

          <DriveTitle text={idle ? 'Nothing on' : (title ?? '')} lit={!idle} />

          {!idle && artist && (
            <p className="drive-artist">
              <span className="drive-chrome">{artist}</span>
            </p>
          )}
          {!idle && album && <p className="drive-album">{album}</p>}
        </div>
      </div>

      <DriveDash />

      <DriveFilm playing={!!playing} />
    </div>
  );
}
