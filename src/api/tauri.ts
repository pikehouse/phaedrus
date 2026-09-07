import { invoke } from '@tauri-apps/api/core';
import type {
  Favorite, Group, GroupState, LinkSession, LinkStatus, MediaItem, MusicService, PlayAction, PlayMode,
  QueuePage, SearchResults, ServiceId, SonosApi, Topology,
} from './types';

/**
 * Route every image through the Rust art cache (see src-tauri/src/art.rs).
 * The speaker's own art proxy is slow and single-file; the cache is neither,
 * and it answers with CORS headers so the ambient glow can sample real covers.
 */
export const artUrl = (url?: string) =>
  url && /^https?:\/\//.test(url) ? `art://localhost/?u=${encodeURIComponent(url)}` : url;

const withArt = <T extends { art?: string }>(x: T): T => (x.art ? { ...x, art: artUrl(x.art) } : x);

/** Tauri IPC implementation of the contract. Arg keys are camelCase; Rust receives snake_case. */
export class TauriSonosApi implements SonosApi {
  discover() { return invoke<Topology>('discover'); }
  getTopology() { return invoke<Topology>('get_topology'); }
  async getGroupState(group: Group) {
    const s = await invoke<GroupState>('get_group_state', {
      coordinatorIp: group.coordinatorIp,
      members: group.members.map((m) => ({ uuid: m.uuid, name: m.name, ip: m.ip })),
    });
    return s.track ? { ...s, track: withArt(s.track) } : s;
  }
  play(coordinatorIp: string) { return invoke<void>('play', { ip: coordinatorIp }); }
  pause(coordinatorIp: string) { return invoke<void>('pause', { ip: coordinatorIp }); }
  stop(coordinatorIp: string) { return invoke<void>('stop', { ip: coordinatorIp }); }
  next(coordinatorIp: string) { return invoke<void>('next_track', { ip: coordinatorIp }); }
  previous(coordinatorIp: string) { return invoke<void>('previous_track', { ip: coordinatorIp }); }
  seek(coordinatorIp: string, secs: number) { return invoke<void>('seek', { ip: coordinatorIp, secs: Math.round(secs) }); }
  playQueueIndex(coordinatorIp: string, index: number) { return invoke<void>('play_queue_index', { ip: coordinatorIp, index }); }
  setPlayMode(coordinatorIp: string, mode: PlayMode) { return invoke<void>('set_play_mode', { ip: coordinatorIp, mode }); }
  setCrossfade(coordinatorIp: string, on: boolean) { return invoke<void>('set_crossfade', { ip: coordinatorIp, on }); }
  setGroupVolume(coordinatorIp: string, volume: number) { return invoke<void>('set_group_volume', { ip: coordinatorIp, volume: clamp(volume) }); }
  setGroupMute(coordinatorIp: string, muted: boolean) { return invoke<void>('set_group_mute', { ip: coordinatorIp, muted }); }
  setVolume(zoneIp: string, volume: number) { return invoke<void>('set_volume', { ip: zoneIp, volume: clamp(volume) }); }
  setMute(zoneIp: string, muted: boolean) { return invoke<void>('set_mute', { ip: zoneIp, muted }); }
  async getQueue(coordinatorIp: string, start = 0, count = 200) {
    const q = await invoke<QueuePage>('get_queue', { ip: coordinatorIp, start, count });
    return { ...q, items: q.items.map(withArt) };
  }
  removeFromQueue(coordinatorIp: string, index: number) { return invoke<void>('remove_from_queue', { ip: coordinatorIp, index }); }
  clearQueue(coordinatorIp: string) { return invoke<void>('clear_queue', { ip: coordinatorIp }); }
  reorderQueue(coordinatorIp: string, from: number, to: number) { return invoke<void>('reorder_queue', { ip: coordinatorIp, from, to }); }
  async getFavorites(anyIp: string) {
    return (await invoke<Favorite[]>('get_favorites', { ip: anyIp })).map(withArt);
  }
  playFavorite(coordinatorIp: string, coordinatorUuid: string, favorite: Favorite, action: PlayAction) {
    return invoke<void>('play_favorite', { ip: coordinatorIp, coordinatorUuid, favorite: stripArt(favorite), action });
  }
  joinGroup(zoneIp: string, coordinatorUuid: string) { return invoke<void>('join_group', { ip: zoneIp, coordinatorUuid }); }
  leaveGroup(zoneIp: string) { return invoke<void>('leave_group', { ip: zoneIp }); }
  getServices(anyIp: string) { return invoke<MusicService[]>('get_services', { ip: anyIp }); }
  async search(anyIp: string, query: string) {
    const r = await invoke<SearchResults>('search', { ip: anyIp, query });
    return {
      ...r,
      tracks: r.tracks.map(withArt),
      albums: r.albums.map(withArt),
      artists: r.artists.map(withArt),
      playlists: r.playlists.map(withArt),
      stations: r.stations.map(withArt),
    };
  }
  async artistAlbums(anyIp: string, item: MediaItem) {
    return (await invoke<MediaItem[]>('artist_albums', { ip: anyIp, item: stripArt(item) })).map(withArt);
  }
  playItem(coordinatorIp: string, coordinatorUuid: string, item: MediaItem, action: PlayAction) {
    return invoke<void>('play_item', { ip: coordinatorIp, coordinatorUuid, item: stripArt(item), action });
  }
  linkBegin(anyIp: string, service: ServiceId) { return invoke<LinkSession>('link_begin', { ip: anyIp, service }); }
  linkPoll(anyIp: string, session: LinkSession) { return invoke<LinkStatus>('link_poll', { ip: anyIp, session }); }
  unlink(anyIp: string, service: ServiceId) { return invoke<void>('unlink', { ip: anyIp, service }); }
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Objects going back to Rust carry the original art url, not the art:// one. */
const stripArt = <T extends { art?: string }>(x: T): T => {
  if (!x.art || !x.art.startsWith('art://')) return x;
  const u = new URL(x.art).searchParams.get('u');
  return { ...x, art: u ?? undefined };
};

/** True when running inside the Tauri webview (vs. plain browser dev / phone web mode). */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
