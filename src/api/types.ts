// ─── Phaedrus API contract ────────────────────────────────────────────────────
// Shared between the React frontend and the Rust (Tauri) backend.
// Rust structs serialize to these shapes (serde rename_all = "camelCase").
// Do not change without updating src-tauri/src/sonos/model.rs.

export interface Zone {
  uuid: string;
  name: string;
  ip: string;
  /** Sonos model name, e.g. "Sonos Five", "Sonos Era 100" */
  model?: string;
  /** true for the hidden half of a stereo pair / surround — never shown in UI */
  invisible: boolean;
}

export interface Group {
  /** Sonos group id, e.g. "RINCON_xxx:123" */
  id: string;
  coordinatorUuid: string;
  coordinatorIp: string;
  /** Display name: coordinator room name, e.g. "Dining Room" */
  name: string;
  /** Visible members only, coordinator first */
  members: Zone[];
}

export interface Topology {
  householdId: string;
  groups: Group[];
  /** ms epoch */
  discoveredAt: number;
}

export type TransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT';

export type PlayMode =
  | 'NORMAL'
  | 'REPEAT_ALL'
  | 'REPEAT_ONE'
  | 'SHUFFLE_NOREPEAT'
  | 'SHUFFLE'
  | 'SHUFFLE_REPEAT_ONE';

export interface Track {
  title: string;
  artist?: string;
  album?: string;
  /** Absolute URL, ready for <img src> */
  art?: string;
  uri?: string;
  durationSecs?: number;
  /** For radio: the live "now playing" text the station broadcasts */
  streamContent?: string;
}

export interface MemberVolume {
  uuid: string;
  name: string;
  ip: string;
  volume: number;
  muted: boolean;
}

export interface GroupState {
  state: TransportState;
  track?: Track;
  positionSecs: number;
  durationSecs: number;
  /** 1-based index of the current track in the queue, if playing from the queue */
  queueIndex?: number;
  queueLength?: number;
  playMode: PlayMode;
  crossfade: boolean;
  /** true when the source is a stream (radio) rather than the queue */
  isRadio: boolean;
  /** Station / source name when isRadio */
  stationName?: string;
  /** Source kind: 'queue' | 'radio' | 'linein' | 'tv' | 'airplay' | 'spotify-connect' | 'unknown' */
  source: string;
  /** Group volume 0-100 */
  volume: number;
  muted: boolean;
  members: MemberVolume[];
  /** ms epoch when this snapshot was taken (backend clock) */
  fetchedAt: number;
}

export interface QueueItem {
  /** 1-based position in the queue */
  index: number;
  title: string;
  artist?: string;
  album?: string;
  art?: string;
  durationSecs?: number;
  uri: string;
}

export interface QueuePage {
  items: QueueItem[];
  total: number;
}

export type ItemKind = 'track' | 'album' | 'playlist' | 'artist' | 'station' | 'other';

export interface Favorite {
  id: string;
  title: string;
  /** e.g. "Album by The Brothers And Sisters", "Spotify", "Apple Music" */
  description?: string;
  art?: string;
  kind: ItemKind;
  /** false for shortcuts (e.g. artist pages) that can't be played directly */
  playable: boolean;
  /** Service label if known: 'spotify' | 'apple' | 'tunein' | 'sonos-radio' | other */
  service?: string;
  uri?: string;
  /** Opaque DIDL metadata blob; pass back to playFavorite untouched */
  metadata?: string;
}

export type ServiceId = 'apple' | 'spotify' | 'tunein';

export interface MusicService {
  id: ServiceId;
  name: string;
  /** Configured on this Sonos household (has an account) */
  available: boolean;
  /** Search is authorized (Apple + TuneIn: always when available; Spotify: after linking) */
  linked: boolean;
  /** true when the user must run the link flow to enable search */
  needsLink: boolean;
}

export interface MediaItem {
  service: ServiceId;
  kind: ItemKind;
  /** Service-native id: Spotify "spotify:track:xxx"; Apple numeric id; TuneIn "s12345" */
  id: string;
  title: string;
  /** Artist for tracks/albums, owner for playlists, location for stations */
  subtitle?: string;
  art?: string;
  durationSecs?: number;
  explicit?: boolean;
  year?: number;
  trackCount?: number;
}

export interface SearchResults {
  query: string;
  tracks: MediaItem[];
  albums: MediaItem[];
  artists: MediaItem[];
  playlists: MediaItem[];
  stations: MediaItem[];
  errors: { service: ServiceId; message: string }[];
}

/**
 * now     — play immediately (for tracks: insert after current & jump; for containers: replace queue & play)
 * next    — enqueue right after the current track
 * later   — append to end of queue
 * replace — clear the queue, enqueue, play from the start
 */
export type PlayAction = 'now' | 'next' | 'later' | 'replace';

export interface LinkSession {
  service: ServiceId;
  /** Open this in the user's browser */
  url: string;
  linkCode: string;
}

export type LinkStatus = 'pending' | 'linked' | 'failed';

export interface DiscoveryProgress {
  phase: 'ssdp' | 'sweep' | 'cached' | 'topology' | 'done' | 'failed';
  message: string;
}

// ─── The API surface ─────────────────────────────────────────────────────────

export interface SonosApi {
  /** Full network discovery (SSDP + subnet sweep). Slow-ish (1-4 s). */
  discover(): Promise<Topology>;
  /** Topology via already-known speakers; falls back to discover() if none respond. Fast. */
  getTopology(): Promise<Topology>;
  /** Everything needed to render the selected group, in one round trip. */
  getGroupState(group: Group): Promise<GroupState>;

  play(coordinatorIp: string): Promise<void>;
  pause(coordinatorIp: string): Promise<void>;
  stop(coordinatorIp: string): Promise<void>;
  next(coordinatorIp: string): Promise<void>;
  previous(coordinatorIp: string): Promise<void>;
  seek(coordinatorIp: string, secs: number): Promise<void>;
  /** Jump to a 1-based queue index and play it */
  playQueueIndex(coordinatorIp: string, index: number): Promise<void>;
  setPlayMode(coordinatorIp: string, mode: PlayMode): Promise<void>;
  setCrossfade(coordinatorIp: string, on: boolean): Promise<void>;

  setGroupVolume(coordinatorIp: string, volume: number): Promise<void>;
  setGroupMute(coordinatorIp: string, muted: boolean): Promise<void>;
  setVolume(zoneIp: string, volume: number): Promise<void>;
  setMute(zoneIp: string, muted: boolean): Promise<void>;

  getQueue(coordinatorIp: string, start?: number, count?: number): Promise<QueuePage>;
  removeFromQueue(coordinatorIp: string, index: number): Promise<void>;
  clearQueue(coordinatorIp: string): Promise<void>;
  /** Move the item at `from` so it lands at `to` (both 1-based) */
  reorderQueue(coordinatorIp: string, from: number, to: number): Promise<void>;

  getFavorites(anyIp: string): Promise<Favorite[]>;
  playFavorite(coordinatorIp: string, coordinatorUuid: string, favorite: Favorite, action: PlayAction): Promise<void>;

  /** Make zone join the group led by coordinatorUuid */
  joinGroup(zoneIp: string, coordinatorUuid: string): Promise<void>;
  /** Make zone a standalone group */
  leaveGroup(zoneIp: string): Promise<void>;

  getServices(anyIp: string): Promise<MusicService[]>;
  search(anyIp: string, query: string): Promise<SearchResults>;
  /** Albums for an artist item (Apple + Spotify) */
  artistAlbums(anyIp: string, item: MediaItem): Promise<MediaItem[]>;
  playItem(coordinatorIp: string, coordinatorUuid: string, item: MediaItem, action: PlayAction): Promise<void>;

  linkBegin(anyIp: string, service: ServiceId): Promise<LinkSession>;
  linkPoll(anyIp: string, session: LinkSession): Promise<LinkStatus>;
  unlink(anyIp: string, service: ServiceId): Promise<void>;
}
