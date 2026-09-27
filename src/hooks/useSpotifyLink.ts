import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isTauri } from '../api';
import { useSonos } from '../store/useSonos';
import type { LinkSession } from '../api/types';

/** Rust keeps answering 'pending' through timeouts; give up on our own after this. */
const LINK_TIMEOUT_MS = 5 * 60 * 1000;

export type LinkPhase = 'idle' | 'waiting' | 'failed' | 'timedOut';

/**
 * One-time Spotify authorization: open the page, then wait for the household.
 * Search's link card and Settings share this, so both behave the same way.
 */
export function useSpotifyLink(anyIp: string, onLinked: () => void) {
  const say = useSonos((s) => s.say);
  const [phase, setPhase] = useState<LinkPhase>('idle');
  const session = useRef<LinkSession | null>(null);
  const startedAt = useRef(0);
  // Callers hand in a new callback every render; the poll reads the latest
  // without being torn down and rebuilt for it.
  const linked = useRef(onLinked);
  useEffect(() => {
    linked.current = onLinked;
  }, [onLinked]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    let alive = true;
    let checking = false;
    const timer = setInterval(async () => {
      const s = session.current;
      if (!s || checking) return;
      checking = true;
      try {
        const status = await api.linkPoll(anyIp, s);
        if (status === 'linked') {
          clearInterval(timer);
          // Rust has stored the token by now: finish the job even if this
          // effect was torn down while the check was out — but only once.
          if (session.current !== s) return;
          session.current = null;
          setPhase('idle');
          say('Spotify connected');
          linked.current();
        } else if (status === 'failed' && alive) {
          clearInterval(timer);
          setPhase('failed');
        } else if (status === 'pending' && alive && Date.now() - startedAt.current >= LINK_TIMEOUT_MS) {
          clearInterval(timer);
          session.current = null;
          setPhase('timedOut');
        }
      } catch {
        if (alive) {
          clearInterval(timer);
          setPhase('failed');
        }
      } finally {
        checking = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, anyIp, say]);

  const begin = useCallback(async () => {
    try {
      const s = await api.linkBegin(anyIp, 'spotify');
      session.current = s;
      startedAt.current = Date.now();
      setPhase('waiting');
      if (isTauri()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(s.url);
      } else {
        window.open(s.url, '_blank', 'noopener');
      }
    } catch {
      setPhase('failed');
    }
  }, [anyIp]);

  return { phase, begin };
}
