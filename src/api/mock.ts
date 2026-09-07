import type {
  Favorite,
  Group,
  GroupState,
  ItemKind,
  LinkSession,
  LinkStatus,
  MediaItem,
  MemberVolume,
  MusicService,
  PlayAction,
  PlayMode,
  QueueItem,
  QueuePage,
  SearchResults,
  ServiceId,
  SonosApi,
  Topology,
  Track,
  TransportState,
  Zone,
} from './types';

const art = (seed: string | number) => `https://picsum.photos/seed/${seed}/600/600`;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── The household ───────────────────────────────────────────────────────────

const zone = (uuid: string, name: string, ip: string, model: string, invisible = false): Zone => ({
  uuid,
  name,
  ip,
  model,
  invisible,
});

const ZONES: Zone[] = [
  zone('RINCON_949F3EC13D2801400', 'Dining Room', '192.168.1.21', 'Sonos Five'),
  zone('RINCON_B8E93758C1F401400', 'Kitchen', '192.168.1.22', 'Sonos Era 100'),
  zone('RINCON_347E5C9A20B801400', 'Master Bedroom', '192.168.1.23', 'Sonos One SL'),
  zone('RINCON_5CAAFD0E11A601400', 'Living Room', '192.168.1.24', 'Sonos Five'),
  // The right half of the Living Room stereo pair. Never rendered.
  zone('RINCON_5CAAFD0E11A601401', 'Living Room (R)', '192.168.1.25', 'Sonos Five', true),
  zone('RINCON_F0F6C1D34C9E01400', 'Study', '192.168.1.26', 'Sonos Era 300'),
  zone('RINCON_2C3AE83B47DD01400', 'Patio', '192.168.1.27', 'Sonos Move'),
  zone('RINCON_78289E7A0C1B01400', 'Back Porch', '192.168.1.28', 'Sonos Roam'),
];

const byIp = (ip: string) => ZONES.find((z) => z.ip === ip);

/** uuid → uuid of the coordinator it currently follows. Mutated by join/leave. */
let membership: Record<string, string> = {
  RINCON_949F3EC13D2801400: 'RINCON_949F3EC13D2801400',
  RINCON_B8E93758C1F401400: 'RINCON_949F3EC13D2801400',
  RINCON_347E5C9A20B801400: 'RINCON_949F3EC13D2801400',
  RINCON_5CAAFD0E11A601400: 'RINCON_5CAAFD0E11A601400',
  RINCON_5CAAFD0E11A601401: 'RINCON_5CAAFD0E11A601400',
  RINCON_F0F6C1D34C9E01400: 'RINCON_F0F6C1D34C9E01400',
  RINCON_2C3AE83B47DD01400: 'RINCON_2C3AE83B47DD01400',
  RINCON_78289E7A0C1B01400: 'RINCON_78289E7A0C1B01400',
};

function buildTopology(): Topology {
  const coordinators = ZONES.filter((z) => membership[z.uuid] === z.uuid && !z.invisible);
  const groups: Group[] = coordinators.map((c) => {
    const members = [
      c,
      ...ZONES.filter((z) => z.uuid !== c.uuid && membership[z.uuid] === c.uuid && !z.invisible),
    ];
    return {
      id: `${c.uuid}:${1 + (hash(c.uuid) % 400)}`,
      coordinatorUuid: c.uuid,
      coordinatorIp: c.ip,
      name: c.name,
      members,
    };
  });
  return { householdId: 'Sonos_mockhousehold7Xq2', groups, discoveredAt: discoveredAt };
}

let discoveredAt = Date.now();
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// ─── Volume state, per zone, persisted for the session ───────────────────────

const volumes: Record<string, number> = {
  RINCON_949F3EC13D2801400: 34,
  RINCON_B8E93758C1F401400: 21,
  RINCON_347E5C9A20B801400: 12,
  RINCON_5CAAFD0E11A601400: 44,
  RINCON_5CAAFD0E11A601401: 44,
  RINCON_F0F6C1D34C9E01400: 28,
  RINCON_2C3AE83B47DD01400: 55,
  RINCON_78289E7A0C1B01400: 18,
};
const mutes: Record<string, boolean> = {};

// ─── The queue ───────────────────────────────────────────────────────────────

type Seed = [title: string, artist: string, album: string, secs: number];

const QUEUE_SEED: Seed[] = [
  ['Harvest Moon', 'Neil Young', 'Harvest Moon', 305],
  ['Moon River', 'Frank Ocean', 'Moon River', 194],
  ['Cissy Strut', 'The Meters', 'The Meters', 183],
  ['A Case of You', 'Joni Mitchell', 'Blue', 261],
  ['Inner City Blues', 'Marvin Gaye', "What's Going On", 296],
  ['Feel Like Makin’ Love', 'Roberta Flack', 'Feel Like Makin’ Love', 178],
  ['Midnight at the Oasis', 'Maria Muldaur', 'Maria Muldaur', 226],
  ['Rock Steady', 'Aretha Franklin', 'Young, Gifted and Black', 199],
  ['Ventura Highway', 'America', 'Homecoming', 213],
  ['Sunlight', 'Herbie Hancock', 'Sunlight', 470],
  ['Trouble Man', 'Marvin Gaye', 'Trouble Man', 231],
  ['Tuesday Heartbreak', 'Stevie Wonder', 'Talking Book', 183],
];

let queue: QueueItem[] = QUEUE_SEED.map(([title, artist, album, durationSecs], i) => ({
  index: i + 1,
  title,
  artist,
  album,
  durationSecs,
  art: art(`lp${i + 3}`),
  uri: `x-sonos-mock:track:${i + 1}`,
}));

const reindex = () => {
  queue = queue.map((q, i) => ({ ...q, index: i + 1 }));
};

// ─── Transport, per coordinator ──────────────────────────────────────────────

interface Deck {
  state: TransportState;
  queueIndex: number;
  position: number; // secs
  since: number; // ms epoch of last position write
  playMode: PlayMode;
  crossfade: boolean;
  isRadio: boolean;
  stationName?: string;
  radioTrack?: Track;
}

const decks: Record<string, Deck> = {
  RINCON_949F3EC13D2801400: {
    state: 'PLAYING',
    queueIndex: 4,
    position: 58,
    since: Date.now(),
    playMode: 'NORMAL',
    crossfade: false,
    isRadio: false,
  },
  RINCON_5CAAFD0E11A601400: {
    state: 'PAUSED_PLAYBACK',
    queueIndex: 1,
    position: 0,
    since: Date.now(),
    playMode: 'SHUFFLE',
    crossfade: true,
    isRadio: false,
  },
  RINCON_F0F6C1D34C9E01400: {
    state: 'PLAYING',
    queueIndex: 1,
    position: 0,
    since: Date.now(),
    playMode: 'NORMAL',
    crossfade: false,
    isRadio: true,
    stationName: 'KCRW Eclectic24',
    radioTrack: {
      title: 'KCRW Eclectic24',
      art: art('radio-kcrw'),
      streamContent: 'Khruangbin — August 10',
    },
  },
};

function deckFor(ip: string): Deck {
  const z = byIp(ip);
  const uuid = z?.uuid ?? ZONES[0].uuid;
  if (!decks[uuid]) {
    decks[uuid] = {
      state: 'STOPPED',
      queueIndex: 1,
      position: 0,
      since: Date.now(),
      playMode: 'NORMAL',
      crossfade: false,
      isRadio: false,
    };
  }
  return decks[uuid];
}

/** Roll the deck forward to now, advancing tracks when one runs out. */
function tick(d: Deck) {
  const now = Date.now();
  if (d.state !== 'PLAYING') {
    d.since = now;
    return;
  }
  const elapsed = (now - d.since) / 1000;
  d.since = now;
  if (d.isRadio) {
    d.position += elapsed;
    return;
  }
  d.position += elapsed;
  let guard = 0;
  while (guard++ < 50) {
    const cur = queue[d.queueIndex - 1];
    const len = cur?.durationSecs ?? 0;
    if (!cur || d.position < len) break;
    d.position -= len;
    d.queueIndex = d.queueIndex >= queue.length ? 1 : d.queueIndex + 1;
  }
}

// ─── Favorites ───────────────────────────────────────────────────────────────

const fav = (
  id: string,
  title: string,
  description: string,
  kind: ItemKind,
  service: string,
  opts: Partial<Favorite> = {},
): Favorite => ({
  id,
  title,
  description,
  kind,
  service,
  playable: true,
  art: art(`fav-${id}`),
  uri: `x-sonos-mock:fav:${id}`,
  metadata: `<DIDL-Lite mock="${id}"/>`,
  ...opts,
});

const FAVORITES: Favorite[] = [
  fav('f1', 'Talking Book', 'Album by Stevie Wonder', 'album', 'apple'),
  fav('f2', 'Late Night Kitchen', 'Playlist · 62 songs', 'playlist', 'spotify'),
  fav('f3', 'KCRW Eclectic24', 'Santa Monica, CA', 'station', 'tunein'),
  fav('f4', 'Bitches Brew', 'Album by Miles Davis', 'album', 'spotify'),
  fav('f5', 'Aja', 'Album by Steely Dan', 'album', 'apple'),
  // No art — falls through to a typographic sleeve.
  fav('f6', 'Rumours', 'Album by Fleetwood Mac', 'album', 'apple', { art: undefined }),
  fav('f7', 'WWOZ 90.7 FM', 'New Orleans, LA', 'station', 'tunein'),
  fav('f8', 'Cortez the Killer', 'Neil Young', 'track', 'spotify'),
  // Non-playable shortcut.
  fav('f9', 'Alice Coltrane', 'Artist', 'artist', 'apple', { playable: false, art: undefined }),
  fav('f10', 'Head Hunters', 'Album by Herbie Hancock', 'album', 'spotify'),
  fav('f11', 'Sunday Morning Coffee', 'Playlist · 41 songs', 'playlist', 'apple', { art: undefined }),
  fav('f12', 'Radio Paradise Mellow', 'Paradise, CA', 'station', 'sonos-radio'),
];

// ─── Search catalog ──────────────────────────────────────────────────────────

const media = (
  service: ServiceId,
  kind: ItemKind,
  id: string,
  title: string,
  subtitle: string,
  extra: Partial<MediaItem> = {},
): MediaItem => ({
  service,
  kind,
  id,
  title,
  subtitle,
  art: art(`m-${id}`),
  ...extra,
});

const CATALOG: MediaItem[] = [
  // tracks
  media('spotify', 'track', 'spotify:track:1', 'Harvest Moon', 'Neil Young', { durationSecs: 305, year: 1992 }),
  media('apple', 'track', '1440833397', 'A Case of You', 'Joni Mitchell', { durationSecs: 261, year: 1971 }),
  media('spotify', 'track', 'spotify:track:3', 'Cortez the Killer', 'Neil Young', { durationSecs: 447, year: 1975 }),
  media('apple', 'track', '1440737010', 'Moondance', 'Van Morrison', { durationSecs: 273, year: 1970 }),
  media('spotify', 'track', 'spotify:track:5', 'Maggot Brain', 'Funkadelic', { durationSecs: 600, year: 1971 }),
  media('apple', 'track', '1442827179', 'Cissy Strut', 'The Meters', { durationSecs: 183, year: 1969 }),
  media('spotify', 'track', 'spotify:track:7', 'Moon River', 'Frank Ocean', { durationSecs: 194, year: 2018 }),
  media('apple', 'track', '1469577723', 'Inner City Blues', 'Marvin Gaye', { durationSecs: 296, year: 1971 }),
  media('spotify', 'track', 'spotify:track:9', 'Journey in Satchidananda', 'Alice Coltrane', { durationSecs: 396, year: 1971 }),
  media('apple', 'track', '1440655944', 'Ventura Highway', 'America', { durationSecs: 213, year: 1972 }),
  media('spotify', 'track', 'spotify:track:11', 'Rikki Don’t Lose That Number', 'Steely Dan', { durationSecs: 271, year: 1974 }),
  media('apple', 'track', '1440783625', 'Dreams', 'Fleetwood Mac', { durationSecs: 257, year: 1977 }),
  // albums
  media('apple', 'album', 'a-harvest', 'Harvest Moon', 'Neil Young', { year: 1992, trackCount: 10 }),
  media('spotify', 'album', 'spotify:album:blue', 'Blue', 'Joni Mitchell', { year: 1971, trackCount: 10 }),
  media('apple', 'album', 'a-aja', 'Aja', 'Steely Dan', { year: 1977, trackCount: 7 }),
  media('spotify', 'album', 'spotify:album:rumours', 'Rumours', 'Fleetwood Mac', { year: 1977, trackCount: 11 }),
  media('apple', 'album', 'a-talkingbook', 'Talking Book', 'Stevie Wonder', { year: 1972, trackCount: 10 }),
  media('spotify', 'album', 'spotify:album:brew', 'Bitches Brew', 'Miles Davis', { year: 1970, trackCount: 6 }),
  media('apple', 'album', 'a-headhunters', 'Head Hunters', 'Herbie Hancock', { year: 1973, trackCount: 4 }),
  media('spotify', 'album', 'spotify:album:satchi', 'Journey in Satchidananda', 'Alice Coltrane', { year: 1971, trackCount: 5 }),
  // artists
  media('apple', 'artist', 'ar-neil', 'Neil Young', '18 albums'),
  media('spotify', 'artist', 'spotify:artist:joni', 'Joni Mitchell', '19 albums'),
  media('apple', 'artist', 'ar-alice', 'Alice Coltrane', '12 albums'),
  media('spotify', 'artist', 'spotify:artist:steely', 'Steely Dan', '9 albums'),
  media('apple', 'artist', 'ar-marvin', 'Marvin Gaye', '24 albums'),
  // playlists
  media('spotify', 'playlist', 'spotify:playlist:latenight', 'Late Night Kitchen', 'by jr', { trackCount: 62 }),
  media('apple', 'playlist', 'p-yacht', 'Smooth Sailing ’73–’81', 'Apple Music', { trackCount: 100 }),
  media('spotify', 'playlist', 'spotify:playlist:soft', 'Soft Rock Renaissance', 'Spotify', { trackCount: 80 }),
  media('apple', 'playlist', 'p-spiritual', 'Spiritual Jazz Essentials', 'Apple Music', { trackCount: 45 }),
  // stations
  media('tunein', 'station', 's24943', 'KCRW Eclectic24', 'Santa Monica, CA'),
  media('tunein', 'station', 's31337', 'WWOZ 90.7 FM', 'New Orleans, LA'),
  media('tunein', 'station', 's20521', 'Radio Paradise Mellow Mix', 'Paradise, CA'),
  media('tunein', 'station', 's48812', 'Jazz24', 'Seattle, WA'),
  media('tunein', 'station', 's99011', 'NTS Radio 1', 'London, UK'),
];

const ARTIST_ALBUMS: Record<string, MediaItem[]> = {
  'Neil Young': [
    media('apple', 'album', 'a-ny1', 'Harvest', 'Neil Young', { year: 1972, trackCount: 10 }),
    media('apple', 'album', 'a-ny2', 'On the Beach', 'Neil Young', { year: 1974, trackCount: 8 }),
    media('apple', 'album', 'a-ny3', 'Zuma', 'Neil Young', { year: 1975, trackCount: 9 }),
    media('apple', 'album', 'a-ny4', 'Harvest Moon', 'Neil Young', { year: 1992, trackCount: 10 }),
  ],
  'Joni Mitchell': [
    media('spotify', 'album', 'a-jm1', 'Blue', 'Joni Mitchell', { year: 1971, trackCount: 10 }),
    media('spotify', 'album', 'a-jm2', 'Court and Spark', 'Joni Mitchell', { year: 1974, trackCount: 11 }),
    media('spotify', 'album', 'a-jm3', 'Hejira', 'Joni Mitchell', { year: 1976, trackCount: 9 }),
  ],
  'Alice Coltrane': [
    media('apple', 'album', 'a-ac1', 'Journey in Satchidananda', 'Alice Coltrane', { year: 1971, trackCount: 5 }),
    media('apple', 'album', 'a-ac2', 'Ptah, the El Daoud', 'Alice Coltrane', { year: 1970, trackCount: 5 }),
  ],
  'Steely Dan': [
    media('spotify', 'album', 'a-sd1', 'Aja', 'Steely Dan', { year: 1977, trackCount: 7 }),
    media('spotify', 'album', 'a-sd2', 'Pretzel Logic', 'Steely Dan', { year: 1974, trackCount: 11 }),
    media('spotify', 'album', 'a-sd3', 'Katy Lied', 'Steely Dan', { year: 1975, trackCount: 10 }),
  ],
  'Marvin Gaye': [
    media('apple', 'album', 'a-mg1', "What's Going On", 'Marvin Gaye', { year: 1971, trackCount: 9 }),
    media('apple', 'album', 'a-mg2', 'Trouble Man', 'Marvin Gaye', { year: 1972, trackCount: 13 }),
    media('apple', 'album', 'a-mg3', "Let's Get It On", 'Marvin Gaye', { year: 1973, trackCount: 8 }),
  ],
};

// ─── Spotify link dance ──────────────────────────────────────────────────────

let spotifyLinked = false;
let linkPolls = 0;

// ─── The implementation ──────────────────────────────────────────────────────

export class MockSonosApi implements SonosApi {
  async discover(): Promise<Topology> {
    await wait(900);
    discoveredAt = Date.now();
    return buildTopology();
  }

  async getTopology(): Promise<Topology> {
    await wait(120);
    return buildTopology();
  }

  async getGroupState(group: Group): Promise<GroupState> {
    await wait(40);
    const d = deckFor(group.coordinatorIp);
    tick(d);

    const members: MemberVolume[] = group.members.map((m) => ({
      uuid: m.uuid,
      name: m.name,
      ip: m.ip,
      volume: volumes[m.uuid] ?? 25,
      muted: mutes[m.uuid] ?? false,
    }));
    const groupVolume = Math.round(
      members.reduce((sum, m) => sum + m.volume, 0) / Math.max(1, members.length),
    );

    if (d.isRadio) {
      return {
        state: d.state,
        track: d.radioTrack,
        positionSecs: d.position,
        durationSecs: 0,
        playMode: d.playMode,
        crossfade: d.crossfade,
        isRadio: true,
        stationName: d.stationName,
        source: 'radio',
        volume: groupVolume,
        muted: members.every((m) => m.muted),
        members,
        fetchedAt: Date.now(),
      };
    }

    const item = queue[d.queueIndex - 1];
    const track: Track | undefined = item && {
      title: item.title,
      artist: item.artist,
      album: item.album,
      art: item.art,
      uri: item.uri,
      durationSecs: item.durationSecs,
    };
    return {
      state: queue.length === 0 ? 'NO_MEDIA_PRESENT' : d.state,
      track,
      positionSecs: d.position,
      durationSecs: item?.durationSecs ?? 0,
      queueIndex: item ? d.queueIndex : undefined,
      queueLength: queue.length,
      playMode: d.playMode,
      crossfade: d.crossfade,
      isRadio: false,
      source: 'queue',
      volume: groupVolume,
      muted: members.every((m) => m.muted),
      members,
      fetchedAt: Date.now(),
    };
  }

  async play(ip: string) {
    const d = deckFor(ip);
    tick(d);
    d.state = 'PLAYING';
    d.since = Date.now();
  }

  async pause(ip: string) {
    const d = deckFor(ip);
    tick(d);
    d.state = 'PAUSED_PLAYBACK';
  }

  async stop(ip: string) {
    const d = deckFor(ip);
    tick(d);
    d.state = 'STOPPED';
    d.position = 0;
  }

  async next(ip: string) {
    const d = deckFor(ip);
    tick(d);
    d.queueIndex = d.queueIndex >= queue.length ? 1 : d.queueIndex + 1;
    d.position = 0;
    d.since = Date.now();
  }

  async previous(ip: string) {
    const d = deckFor(ip);
    tick(d);
    // Sonos behaviour: restart the track if we're past the first few seconds.
    if (d.position > 3) d.position = 0;
    else d.queueIndex = d.queueIndex <= 1 ? queue.length : d.queueIndex - 1;
    d.position = 0;
    d.since = Date.now();
  }

  async seek(ip: string, secs: number) {
    const d = deckFor(ip);
    tick(d);
    d.position = Math.max(0, secs);
    d.since = Date.now();
  }

  async playQueueIndex(ip: string, index: number) {
    const d = deckFor(ip);
    d.isRadio = false;
    d.queueIndex = Math.max(1, Math.min(queue.length, index));
    d.position = 0;
    d.state = 'PLAYING';
    d.since = Date.now();
  }

  async setPlayMode(ip: string, mode: PlayMode) {
    deckFor(ip).playMode = mode;
  }

  async setCrossfade(ip: string, on: boolean) {
    deckFor(ip).crossfade = on;
  }

  async setGroupVolume(ip: string, volume: number) {
    const coordUuid = byIp(ip)?.uuid;
    if (!coordUuid) return;
    const group = buildTopology().groups.find((g) => g.coordinatorUuid === coordUuid);
    if (!group) return;
    const current = group.members.map((m) => volumes[m.uuid] ?? 25);
    const avg = current.reduce((a, b) => a + b, 0) / current.length;
    const delta = volume - avg;
    // Sonos scales members relative to the group average, which is why one
    // member creeping toward 0 or 100 pins the whole ratio.
    group.members.forEach((m) => {
      volumes[m.uuid] = Math.max(0, Math.min(100, Math.round((volumes[m.uuid] ?? 25) + delta)));
    });
  }

  async setGroupMute(ip: string, muted: boolean) {
    const coordUuid = byIp(ip)?.uuid;
    const group = buildTopology().groups.find((g) => g.coordinatorUuid === coordUuid);
    group?.members.forEach((m) => {
      mutes[m.uuid] = muted;
    });
  }

  async setVolume(ip: string, volume: number) {
    const z = byIp(ip);
    if (z) volumes[z.uuid] = Math.max(0, Math.min(100, Math.round(volume)));
  }

  async setMute(ip: string, muted: boolean) {
    const z = byIp(ip);
    if (z) mutes[z.uuid] = muted;
  }

  async getQueue(_ip: string, start = 0, count = 200): Promise<QueuePage> {
    await wait(60);
    return { items: queue.slice(start, start + count), total: queue.length };
  }

  async removeFromQueue(ip: string, index: number) {
    const d = deckFor(ip);
    queue = queue.filter((q) => q.index !== index);
    reindex();
    if (d.queueIndex > queue.length) d.queueIndex = Math.max(1, queue.length);
  }

  async clearQueue(ip: string) {
    queue = [];
    const d = deckFor(ip);
    d.queueIndex = 1;
    d.position = 0;
    d.state = 'STOPPED';
  }

  async reorderQueue(_ip: string, from: number, to: number) {
    const idx = queue.findIndex((q) => q.index === from);
    if (idx < 0) return;
    const [item] = queue.splice(idx, 1);
    queue.splice(Math.max(0, to - 1), 0, item);
    reindex();
  }

  async getFavorites(_ip: string): Promise<Favorite[]> {
    await wait(140);
    return FAVORITES;
  }

  async playFavorite(ip: string, _uuid: string, favorite: Favorite, action: PlayAction) {
    await wait(180);
    const d = deckFor(ip);
    if (favorite.kind === 'station') {
      d.isRadio = true;
      d.stationName = favorite.title;
      d.radioTrack = {
        title: favorite.title,
        art: favorite.art,
        streamContent: `${favorite.description ?? 'Live'} — on air`,
      };
      d.position = 0;
      d.state = 'PLAYING';
      d.since = Date.now();
      return;
    }
    const items = fabricate(favorite.title, performer(favorite.description), favorite.art, 6);
    applyToQueue(d, items, action);
  }

  async joinGroup(zoneIp: string, coordinatorUuid: string) {
    await wait(220);
    const z = byIp(zoneIp);
    if (!z) return;
    // Anyone following this zone follows its new coordinator too (stereo pairs).
    Object.keys(membership).forEach((uuid) => {
      if (membership[uuid] === z.uuid) membership[uuid] = coordinatorUuid;
    });
    membership[z.uuid] = coordinatorUuid;
  }

  async leaveGroup(zoneIp: string) {
    await wait(220);
    const z = byIp(zoneIp);
    if (!z) return;
    membership[z.uuid] = z.uuid;
    // Keep the invisible stereo half attached to its visible partner.
    ZONES.filter((o) => o.invisible && o.name.startsWith(z.name)).forEach((o) => {
      membership[o.uuid] = z.uuid;
    });
  }

  async getServices(_ip: string): Promise<MusicService[]> {
    await wait(90);
    return [
      { id: 'apple', name: 'Apple Music', available: true, linked: true, needsLink: false },
      {
        id: 'spotify',
        name: 'Spotify',
        available: true,
        linked: spotifyLinked,
        needsLink: !spotifyLinked,
      },
      { id: 'tunein', name: 'TuneIn', available: true, linked: true, needsLink: false },
    ];
  }

  async search(_ip: string, query: string): Promise<SearchResults> {
    await wait(420);
    const q = query.trim().toLowerCase();
    const hit = (m: MediaItem) =>
      m.title.toLowerCase().includes(q) || (m.subtitle ?? '').toLowerCase().includes(q);
    const pool = CATALOG.filter((m) => (spotifyLinked ? true : m.service !== 'spotify')).filter(hit);
    const of = (kind: ItemKind) => pool.filter((m) => m.kind === kind);
    return {
      query,
      tracks: of('track'),
      albums: of('album'),
      artists: of('artist'),
      playlists: of('playlist'),
      stations: of('station'),
      errors: spotifyLinked
        ? []
        : [{ service: 'spotify' as ServiceId, message: 'Spotify search is not connected' }],
    };
  }

  async artistAlbums(_ip: string, item: MediaItem): Promise<MediaItem[]> {
    await wait(280);
    return ARTIST_ALBUMS[item.title] ?? [];
  }

  async playItem(ip: string, _uuid: string, item: MediaItem, action: PlayAction) {
    await wait(160);
    const d = deckFor(ip);
    if (item.kind === 'station') {
      d.isRadio = true;
      d.stationName = item.title;
      d.radioTrack = {
        title: item.title,
        art: item.art,
        streamContent: `${item.subtitle ?? 'Live'} — on air`,
      };
      d.position = 0;
      d.state = 'PLAYING';
      d.since = Date.now();
      return;
    }
    const items =
      item.kind === 'track'
        ? [
            {
              index: 0,
              title: item.title,
              artist: item.subtitle,
              album: item.subtitle,
              art: item.art,
              durationSecs: item.durationSecs ?? 210,
              uri: `x-sonos-mock:${item.id}`,
            } as QueueItem,
          ]
        : fabricate(item.title, item.subtitle ?? 'Various', item.art, item.trackCount ?? 8);
    applyToQueue(d, items, action);
  }

  async linkBegin(_ip: string, service: ServiceId): Promise<LinkSession> {
    await wait(300);
    linkPolls = 0;
    return {
      service,
      url: 'https://example.com/phaedrus-mock-link',
      linkCode: 'MOCK-4821',
    };
  }

  async linkPoll(_ip: string, _session: LinkSession): Promise<LinkStatus> {
    await wait(120);
    linkPolls += 1;
    if (linkPolls >= 3) {
      spotifyLinked = true;
      return 'linked';
    }
    return 'pending';
  }

  async unlink(_ip: string, _service: ServiceId) {
    spotifyLinked = false;
    linkPolls = 0;
  }
}

/** "Album by Stevie Wonder" → "Stevie Wonder"; anything else is left alone. */
function performer(description?: string): string {
  const m = description?.match(/^(?:album|playlist|single|ep)\s+by\s+(.+)$/i);
  return m ? m[1] : (description?.split(' · ')[0] ?? 'Various');
}

/** Invent a plausible tracklist for an album/playlist we only know the name of. */
function fabricate(album: string, artist: string, cover: string | undefined, n: number): QueueItem[] {
  const words = ['Sundown', 'Velvet', 'Ashes', 'Harbor Lights', 'Slow Burn', 'Amber', 'Nightfall', 'Cassette', 'Weightless', 'Long Way Home', 'Static', 'Blue Hour'];
  return Array.from({ length: Math.min(n, 12) }, (_, i) => ({
    index: 0,
    title: words[(hash(album) + i) % words.length],
    artist,
    album,
    art: cover ?? art(`gen-${hash(album) + i}`),
    durationSecs: 150 + ((hash(album + i) % 180) | 0),
    uri: `x-sonos-mock:gen:${hash(album)}:${i}`,
  }));
}

function applyToQueue(d: Deck, items: QueueItem[], action: PlayAction) {
  d.isRadio = false;
  if (action === 'replace') {
    queue = items;
    reindex();
    d.queueIndex = 1;
    d.position = 0;
    d.state = 'PLAYING';
    d.since = Date.now();
    return;
  }
  if (action === 'later') {
    queue = [...queue, ...items];
    reindex();
    return;
  }
  const at = Math.max(0, d.queueIndex);
  queue = [...queue.slice(0, at), ...items, ...queue.slice(at)];
  reindex();
  if (action === 'now') {
    d.queueIndex = at + 1;
    d.position = 0;
    d.state = 'PLAYING';
    d.since = Date.now();
  }
}
