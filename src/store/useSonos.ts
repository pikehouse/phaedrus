import { create } from 'zustand';
import { api } from '../api';
import type {
  Favorite,
  Group,
  GroupState,
  MediaItem,
  PlayAction,
  PlayMode,
  QueueItem,
  Topology,
} from '../api/types';
import { clampVol } from '../lib/format';

// ─── Optimism ────────────────────────────────────────────────────────────────
// After a user acts we show the expected result immediately and ignore polled
// values for that one field until the speaker has had time to agree with us.

const OPTIMISM_MS = 1500;
type Overrides = Record<string, { value: unknown; until: number }>;

function applyOverrides(next: GroupState, ov: Overrides): GroupState {
  const now = Date.now();
  const live = Object.entries(ov).filter(([, v]) => v.until > now);
  if (live.length === 0) return next;
  const out: GroupState = { ...next, members: next.members.map((m) => ({ ...m })) };
  for (const [key, { value }] of live) {
    if (key.startsWith('vol:')) {
      const m = out.members.find((x) => x.uuid === key.slice(4));
      if (m) m.volume = value as number;
    } else if (key.startsWith('mute:')) {
      const m = out.members.find((x) => x.uuid === key.slice(5));
      if (m) m.muted = value as boolean;
    } else {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function pruneOverrides(ov: Overrides): Overrides {
  const now = Date.now();
  const out: Overrides = {};
  for (const [k, v] of Object.entries(ov)) if (v.until > now) out[k] = v;
  return out;
}

// ─── Selection memory ────────────────────────────────────────────────────────

const selKey = (householdId: string) => `phaedrus.group.${householdId}`;

function rememberGroup(householdId: string, groupId: string) {
  try {
    localStorage.setItem(selKey(householdId), groupId);
  } catch {
    /* private mode — selection just won't survive a restart */
  }
}

function recallGroup(householdId: string): string | null {
  try {
    return localStorage.getItem(selKey(householdId));
  } catch {
    return null;
  }
}

/**
 * Keep pointing at the same speakers across a regroup: prefer the exact group,
 * then whichever group swallowed our old coordinator, then anything at all.
 */
function resolveSelection(topo: Topology, previous: Group | null): Group | null {
  if (topo.groups.length === 0) return null;
  const remembered = previous?.id ?? recallGroup(topo.householdId);
  const exact = topo.groups.find((g) => g.id === remembered);
  if (exact) return exact;
  if (previous) {
    const byCoordinator = topo.groups.find((g) =>
      g.members.some((m) => m.uuid === previous.coordinatorUuid),
    );
    if (byCoordinator) return byCoordinator;
  }
  const rememberedCoordinator = remembered?.split(':')[0];
  if (rememberedCoordinator) {
    const byUuid = topo.groups.find((g) =>
      g.members.some((m) => m.uuid === rememberedCoordinator),
    );
    if (byUuid) return byUuid;
  }
  return topo.groups[0];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export type Phase = 'booting' | 'ready' | 'nothing';

export interface Toast {
  id: number;
  text: string;
  tone: 'normal' | 'bad';
}

interface SonosStore {
  phase: Phase;
  topology: Topology | null;
  group: Group | null;
  state: GroupState | null;
  /** Date.now() when `state` landed — the honest clock for interpolating position. */
  receivedAt: number;
  queue: QueueItem[];
  queueTotal: number;
  favorites: Favorite[];
  overrides: Overrides;
  toast: Toast | null;
  searchOpen: boolean;
  arranging: boolean;
  busy: boolean;

  boot: () => Promise<void>;
  rediscover: () => Promise<void>;
  refreshTopology: () => Promise<void>;
  pollState: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshFavorites: () => Promise<void>;
  selectGroup: (g: Group) => void;
  setSearchOpen: (open: boolean) => void;
  setArranging: (on: boolean) => void;
  say: (text: string, tone?: 'normal' | 'bad') => void;

  toggle: () => Promise<void>;
  skipNext: () => Promise<void>;
  skipPrev: () => Promise<void>;
  seekTo: (secs: number) => Promise<void>;
  nudge: (deltaSecs: number) => Promise<void>;
  setGroupVolume: (v: number, final?: boolean) => Promise<void>;
  bumpVolume: (delta: number) => Promise<void>;
  setMemberVolume: (uuid: string, v: number, final?: boolean) => Promise<void>;
  setMemberMute: (uuid: string, muted: boolean) => Promise<void>;
  setPlayMode: (mode: PlayMode) => Promise<void>;
  setCrossfade: (on: boolean) => Promise<void>;
  playQueueIndex: (index: number) => Promise<void>;
  removeFromQueue: (index: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  playFavorite: (f: Favorite, action: PlayAction) => Promise<void>;
  playItem: (item: MediaItem, action: PlayAction) => Promise<void>;
  everywhere: () => Promise<void>;
  joinRoom: (zoneIp: string) => Promise<void>;
  leaveRoom: (zoneIp: string) => Promise<void>;
}

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useSonos = create<SonosStore>((set, get) => {
  /** Show the expected value now; let the poller re-take the field in 1.5s. */
  const optimistic = (patch: Partial<GroupState>, keys: string[]) => {
    const until = Date.now() + OPTIMISM_MS;
    const ov = { ...pruneOverrides(get().overrides) };
    for (const k of keys) ov[k] = { value: (patch as Record<string, unknown>)[k], until };
    const cur = get().state;
    set({
      overrides: ov,
      state: cur ? { ...cur, ...patch } : cur,
      receivedAt: patch.positionSecs !== undefined ? Date.now() : get().receivedAt,
    });
  };

  const optimisticMember = (uuid: string, patch: { volume?: number; muted?: boolean }) => {
    const until = Date.now() + OPTIMISM_MS;
    const ov = { ...pruneOverrides(get().overrides) };
    if (patch.volume !== undefined) ov[`vol:${uuid}`] = { value: patch.volume, until };
    if (patch.muted !== undefined) ov[`mute:${uuid}`] = { value: patch.muted, until };
    const cur = get().state;
    if (cur) {
      set({
        overrides: ov,
        state: {
          ...cur,
          members: cur.members.map((m) => (m.uuid === uuid ? { ...m, ...patch } : m)),
        },
      });
    } else {
      set({ overrides: ov });
    }
  };

  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      get().say(`${label} failed — ${errText(e)}`, 'bad');
    }
  };

  return {
    phase: 'booting',
    topology: null,
    group: null,
    state: null,
    receivedAt: 0,
    queue: [],
    queueTotal: 0,
    favorites: [],
    overrides: {},
    toast: null,
    searchOpen: false,
    arranging: false,
    busy: false,

    say(text, tone = 'normal') {
      clearTimeout(toastTimer);
      set({ toast: { id: ++toastId, text, tone } });
      toastTimer = setTimeout(() => set({ toast: null }), tone === 'bad' ? 5200 : 2800);
    },

    async boot() {
      set({ phase: 'booting' });
      try {
        const topo = await api.getTopology();
        if (topo.groups.length === 0) {
          set({ topology: topo, phase: 'nothing' });
          return;
        }
        const group = resolveSelection(topo, null);
        set({ topology: topo, group, phase: 'ready' });
        if (group) rememberGroup(topo.householdId, group.id);
        await Promise.all([get().pollState(), get().refreshQueue(), get().refreshFavorites()]);
      } catch {
        set({ phase: 'nothing' });
      }
    },

    async rediscover() {
      set({ busy: true });
      get().say('Listening for speakers…');
      try {
        const topo = await api.discover();
        if (topo.groups.length === 0) {
          set({ topology: topo, phase: 'nothing', busy: false });
          return;
        }
        const group = resolveSelection(topo, get().group);
        set({ topology: topo, group, phase: 'ready', busy: false });
        if (group) rememberGroup(topo.householdId, group.id);
        get().say(`Found ${topo.groups.reduce((n, g) => n + g.members.length, 0)} rooms`);
        await Promise.all([get().pollState(), get().refreshQueue(), get().refreshFavorites()]);
      } catch (e) {
        set({ busy: false, phase: get().topology ? 'ready' : 'nothing' });
        get().say(`Could not find speakers — ${errText(e)}`, 'bad');
      }
    },

    async refreshTopology() {
      try {
        const topo = await api.getTopology();
        const prev = get().group;
        const group = resolveSelection(topo, prev);
        const changed = group?.id !== prev?.id;
        set({ topology: topo, group, phase: topo.groups.length ? 'ready' : 'nothing' });
        if (group && changed) {
          rememberGroup(topo.householdId, group.id);
          void get().refreshQueue();
        }
      } catch {
        /* one missed topology poll is not worth shouting about */
      }
    },

    async pollState() {
      const group = get().group;
      if (!group) return;
      try {
        const fresh = await api.getGroupState(group);
        // Selection may have moved while the request was in flight.
        if (get().group?.id !== group.id) return;
        const ov = pruneOverrides(get().overrides);
        set({ state: applyOverrides(fresh, ov), receivedAt: Date.now(), overrides: ov });
      } catch {
        /* transient LAN blip; the next tick will catch up */
      }
    },

    async refreshQueue() {
      const group = get().group;
      if (!group) return;
      try {
        const page = await api.getQueue(group.coordinatorIp, 0, 300);
        set({ queue: page.items, queueTotal: page.total });
      } catch {
        /* leave the last good queue on screen */
      }
    },

    async refreshFavorites() {
      const group = get().group ?? get().topology?.groups[0];
      if (!group) return;
      try {
        set({ favorites: await api.getFavorites(group.coordinatorIp) });
      } catch {
        /* crate stays as it was */
      }
    },

    selectGroup(g) {
      const topo = get().topology;
      if (topo) rememberGroup(topo.householdId, g.id);
      set({ group: g, state: null, overrides: {}, queue: [], arranging: false });
      void get().pollState();
      void get().refreshQueue();
    },

    setSearchOpen(open) {
      set({ searchOpen: open });
    },

    setArranging(on) {
      set({ arranging: on });
    },

    async toggle() {
      const { group, state } = get();
      if (!group || !state) return;
      const playing = state.state === 'PLAYING';
      optimistic({ state: playing ? 'PAUSED_PLAYBACK' : 'PLAYING' }, ['state']);
      await guard(playing ? 'Pause' : 'Play', async () => {
        if (playing) await api.pause(group.coordinatorIp);
        else await api.play(group.coordinatorIp);
      });
    },

    async skipNext() {
      const { group } = get();
      if (!group) return;
      optimistic({ positionSecs: 0, state: 'TRANSITIONING' }, ['positionSecs']);
      await guard('Skip', () => api.next(group.coordinatorIp));
      void get().pollState();
    },

    async skipPrev() {
      const { group } = get();
      if (!group) return;
      optimistic({ positionSecs: 0, state: 'TRANSITIONING' }, ['positionSecs']);
      await guard('Skip back', () => api.previous(group.coordinatorIp));
      void get().pollState();
    },

    async seekTo(secs) {
      const { group, state } = get();
      if (!group || !state) return;
      const target = Math.max(0, Math.min(state.durationSecs || Infinity, secs));
      optimistic({ positionSecs: target }, ['positionSecs']);
      await guard('Seek', () => api.seek(group.coordinatorIp, target));
    },

    async nudge(delta) {
      const { state } = get();
      if (!state || state.isRadio) return;
      await get().seekTo(livePosition(get()) + delta);
    },

    async setGroupVolume(v, final = false) {
      const { group, state } = get();
      if (!group || !state) return;
      const target = clampVol(v);
      const before = state.volume;
      const shift = target - before;
      optimistic({ volume: target }, ['volume']);
      // Members track the group knob so the faders don't jump on the next poll.
      state.members.forEach((m) => optimisticMember(m.uuid, { volume: clampVol(m.volume + shift) }));
      await sendVolume(group.coordinatorIp, target, final, () => api.setGroupVolume(group.coordinatorIp, target));
    },

    async bumpVolume(delta) {
      const s = get().state;
      if (!s) return;
      await get().setGroupVolume(s.volume + delta, true);
    },

    async setMemberVolume(uuid, v, final = false) {
      const { state } = get();
      const member = state?.members.find((m) => m.uuid === uuid);
      if (!member) return;
      const target = clampVol(v);
      optimisticMember(uuid, { volume: target });
      await sendVolume(member.ip, target, final, () => api.setVolume(member.ip, target));
    },

    async setMemberMute(uuid, muted) {
      const member = get().state?.members.find((m) => m.uuid === uuid);
      if (!member) return;
      optimisticMember(uuid, { muted });
      await guard('Mute', () => api.setMute(member.ip, muted));
    },

    async setPlayMode(mode) {
      const { group } = get();
      if (!group) return;
      optimistic({ playMode: mode }, ['playMode']);
      await guard('Play mode', () => api.setPlayMode(group.coordinatorIp, mode));
    },

    async setCrossfade(on) {
      const { group } = get();
      if (!group) return;
      optimistic({ crossfade: on }, ['crossfade']);
      await guard('Crossfade', () => api.setCrossfade(group.coordinatorIp, on));
    },

    async playQueueIndex(index) {
      const { group } = get();
      if (!group) return;
      optimistic({ queueIndex: index, positionSecs: 0, state: 'PLAYING' }, [
        'queueIndex',
        'positionSecs',
        'state',
      ]);
      await guard('Play', () => api.playQueueIndex(group.coordinatorIp, index));
      void get().pollState();
    },

    async removeFromQueue(index) {
      const { group } = get();
      if (!group) return;
      set({ queue: get().queue.filter((q) => q.index !== index) });
      await guard('Remove', () => api.removeFromQueue(group.coordinatorIp, index));
      await get().refreshQueue();
    },

    async clearQueue() {
      const { group } = get();
      if (!group) return;
      set({ queue: [], queueTotal: 0 });
      await guard('Clear queue', () => api.clearQueue(group.coordinatorIp));
      get().say('Queue cleared');
      await get().refreshQueue();
    },

    async playFavorite(f, action) {
      const { group } = get();
      if (!group) return;
      await guard('Play', () => api.playFavorite(group.coordinatorIp, group.coordinatorUuid, f, action));
      get().say(actionWord(action, f.title, group.name));
      await Promise.all([get().pollState(), get().refreshQueue()]);
    },

    async playItem(item, action) {
      const { group } = get();
      if (!group) return;
      await guard('Play', () => api.playItem(group.coordinatorIp, group.coordinatorUuid, item, action));
      get().say(actionWord(action, item.title, group.name));
      await Promise.all([get().pollState(), get().refreshQueue()]);
    },

    async everywhere() {
      const { topology, group } = get();
      if (!topology || !group) return;
      const others = topology.groups.filter((g) => g.id !== group.id);
      if (others.length === 0) {
        get().say('Already playing everywhere');
        return;
      }
      set({ busy: true });
      await guard('Group rooms', async () => {
        for (const g of others) await api.joinGroup(g.coordinatorIp, group.coordinatorUuid);
      });
      set({ busy: false });
      get().say(`Everywhere · ${group.name}`);
      await get().refreshTopology();
      void get().pollState();
    },

    async joinRoom(zoneIp) {
      const { group } = get();
      if (!group) return;
      await guard('Add room', () => api.joinGroup(zoneIp, group.coordinatorUuid));
      await get().refreshTopology();
      void get().pollState();
    },

    async leaveRoom(zoneIp) {
      await guard('Remove room', () => api.leaveGroup(zoneIp));
      await get().refreshTopology();
      void get().pollState();
    },
  };
});

// ─── Volume send throttle ────────────────────────────────────────────────────
// Drag events fire far faster than a speaker can answer. Send at most every
// ~60ms while dragging, and always send the value the user let go on.

const throttles = new Map<string, { last: number; timer?: ReturnType<typeof setTimeout> }>();

async function sendVolume(key: string, _target: number, final: boolean, send: () => Promise<void>) {
  const entry = throttles.get(key) ?? { last: 0 };
  throttles.set(key, entry);
  clearTimeout(entry.timer);
  const now = Date.now();
  if (final || now - entry.last >= 60) {
    entry.last = now;
    try {
      await send();
    } catch {
      /* a dropped volume packet self-corrects on the next drag or poll */
    }
    return;
  }
  entry.timer = setTimeout(() => {
    entry.last = Date.now();
    void send().catch(() => {});
  }, 60);
}

function actionWord(action: PlayAction, title: string, room: string) {
  switch (action) {
    case 'next':
      return `Up next · ${title}`;
    case 'later':
      return `Added to queue · ${title}`;
    default:
      return `Playing in ${room} · ${title}`;
  }
}

function errText(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'the speaker did not answer';
}

/** Where the needle actually is right now, given the last snapshot. */
export function livePosition(s: Pick<SonosStore, 'state' | 'receivedAt'>): number {
  if (!s.state) return 0;
  const base = s.state.positionSecs;
  if (s.state.state !== 'PLAYING') return base;
  const drift = (Date.now() - s.receivedAt) / 1000;
  const cap = s.state.durationSecs || Infinity;
  return Math.min(base + drift, cap);
}

// ─── Polling controller ──────────────────────────────────────────────────────

let stateTimer: ReturnType<typeof setTimeout> | undefined;
let topoTimer: ReturnType<typeof setTimeout> | undefined;

export function startPolling() {
  stopPolling();

  const stateLoop = () => {
    const s = useSonos.getState();
    if (s.phase === 'ready') void s.pollState();
    stateTimer = setTimeout(stateLoop, document.hidden ? 4000 : 1000);
  };

  const topoLoop = () => {
    const s = useSonos.getState();
    if (s.phase !== 'booting') void s.refreshTopology();
    topoTimer = setTimeout(topoLoop, document.hidden ? 20000 : 6000);
  };

  stateTimer = setTimeout(stateLoop, 1000);
  topoTimer = setTimeout(topoLoop, 6000);

  // Coming back to the window should feel instant, not "up to 4s stale".
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (document.hidden) return;
  const s = useSonos.getState();
  if (s.phase === 'ready') {
    void s.pollState();
    void s.refreshTopology();
  }
}

export function stopPolling() {
  clearTimeout(stateTimer);
  clearTimeout(topoTimer);
  document.removeEventListener('visibilitychange', onVisible);
}
