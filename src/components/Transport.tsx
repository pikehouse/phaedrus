import { useSonos } from '../store/useSonos';
import { cycleRepeat, fromPlayMode, toggleShuffle } from '../store/playMode';
import { Crossfade, Pause, Play, Next, Prev, Repeat, RepeatOne, Shuffle } from './Icons';
import '../styles/transport.css';

export default function Transport() {
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

  return (
    <div className="transport">
      <div className="transport-mods transport-mods-left">
        <button
          type="button"
          className={`mod${shuffle ? ' is-on' : ''}`}
          aria-pressed={shuffle}
          aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
          disabled={radio}
          onClick={() => setPlayMode(toggleShuffle(state.playMode))}
        >
          <Shuffle size={17} />
        </button>
      </div>

      <div className="transport-main">
        <button
          type="button"
          className="tactile tactile-sm"
          aria-label="Previous track"
          disabled={radio}
          onClick={() => void skipPrev()}
        >
          <Prev size={20} />
        </button>

        <button
          type="button"
          className={`tactile tactile-lg${playing ? ' is-playing' : ''}`}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void toggle()}
        >
          {playing ? <Pause size={26} /> : <Play size={26} className="glyph-play" />}
        </button>

        <button
          type="button"
          className="tactile tactile-sm"
          aria-label="Next track"
          disabled={radio}
          onClick={() => void skipNext()}
        >
          <Next size={20} />
        </button>
      </div>

      <div className="transport-mods transport-mods-right">
        <button
          type="button"
          className={`mod${repeat !== 'off' ? ' is-on' : ''}`}
          aria-label={`Repeat ${repeat}`}
          disabled={radio}
          onClick={() => setPlayMode(cycleRepeat(state.playMode))}
        >
          {repeat === 'one' ? <RepeatOne size={17} /> : <Repeat size={17} />}
        </button>
        <button
          type="button"
          className={`mod${state.crossfade ? ' is-on' : ''}`}
          aria-pressed={state.crossfade}
          aria-label={state.crossfade ? 'Crossfade on' : 'Crossfade off'}
          disabled={radio}
          onClick={() => setCrossfade(!state.crossfade)}
        >
          <Crossfade size={17} />
        </button>
      </div>
    </div>
  );
}
