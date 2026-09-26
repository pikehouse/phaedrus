import { useMemo } from 'react';
import { useSonos } from '../store/useSonos';
import Transport from './Transport';
import DeckWave from './DeckWave';
import DeckJog from './DeckJog';
import DeckPads from './DeckPads';
import DeckMeters from './DeckMeters';
import { trackSeed, useLivePosition } from './DeckSignal';
import '../styles/deck.css';

/**
 * A DJ controller seen from the booth, built as two anodised plates with a
 * recessed seam between them: the display plate carries the two strips (the
 * playing track on A, the next one cued on B); the performance plate carries
 * the jog wheel with the cover in its centre display, and the transport and
 * a 4×2 block of hot-cue pads beside it. The volume knob and room faders live on the faceplate below,
 * which NowPlaying keeps for every skin — here it is the mixer section,
 * and DeckMeters drives a channel meter in each of its fader rows.
 *
 * Transport is the app's own component: the skin restyles it into rubber
 * and orange LEDs and draws the silkscreen under each key in CSS, so none
 * of the store logic is forked.
 */
export default function DeckStage() {
  const group = useSonos((s) => s.group);
  const state = useSonos((s) => s.state);
  const queue = useSonos((s) => s.queue);
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';

  // Deck B: whatever is loaded after the playing track. Radio has no queue.
  const next = useMemo(() => {
    if (!state?.queueIndex || state.isRadio) return undefined;
    return queue.find((q) => q.index === state.queueIndex! + 1);
  }, [queue, state?.queueIndex, state?.isRadio]);

  return (
    <div className={`deck${playing ? ' is-playing' : ''}`}>
      {/* The display plate: badge row and the two strips of smoked glass. */}
      <section className="deck-plate deck-plate-display" aria-label="Decks">
        <header className="deck-head">
          <span className="deck-model deck-silk">
            <b>DDJ-33</b>
            <span className="deck-model-legend">2-deck controller · 4-channel mixer</span>
          </span>
          <span className="deck-lamps" aria-hidden="true">
            <span className={`deck-lamp${group ? ' is-on' : ''}`}>
              <i />
              Power
            </span>
            <span className={`deck-lamp${playing ? ' is-on' : ''}`}>
              <i />
              Master
            </span>
          </span>
          <span className="deck-brand" aria-hidden="true">
            PHÆDRUS
          </span>
        </header>

        <div className="deck-strips">
          <DeckA />
          <DeckWave
            deck="B"
            title={next?.title}
            artist={next?.artist}
            seed={trackSeed(next?.title, next?.artist)}
            duration={next?.durationSecs}
          />
        </div>
      </section>

      {/* The performance plate: jog, transport and pads. */}
      <section className="deck-plate deck-plate-perf" aria-label="Deck A">
        <span className="deck-silk deck-legend" aria-hidden="true">
          Deck <b>A</b>
        </span>
        <div className="deck-row">
          <DeckJog />
          <div className="deck-controls">
            <div className="deck-transport">
              <Transport />
            </div>
            <DeckPads />
          </div>
        </div>
      </section>

      <DeckMeters />
    </div>
  );
}

/** The playing deck: its own 10fps clock, so the rest of the panel is not redrawn with it. */
function DeckA() {
  const state = useSonos((s) => s.state);
  const receivedAt = useSonos((s) => s.receivedAt);
  const seekTo = useSonos((s) => s.seekTo);
  const live = useLivePosition(receivedAt);

  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const radio = !!state?.isRadio;
  const title = radio ? (state.stationName ?? track?.title ?? 'Radio') : track?.title;
  const artist = radio ? track?.streamContent : track?.artist;

  return (
    <DeckWave
      deck="A"
      title={idle ? undefined : title}
      artist={idle ? undefined : artist}
      seed={trackSeed(title, artist)}
      position={idle ? undefined : live}
      duration={state?.durationSecs ?? 0}
      live={radio}
      onSeek={(secs) => void seekTo(secs)}
    />
  );
}
