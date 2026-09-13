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
  Zone,
} from '../api/types';
import { clampVol } from '../lib/format';

// ─── Optimism ────────────────────────────────────────────────────────────────
// After a user acts we show the expected result immediately and ignore polled
// values for that one field until the speaker has had time to agree with us.

const OPTIMISM_MS = 1500;
type Overrides = Record<string, { value: unknown; until: number }>;

/**
 * Where a held position has got to by now. The needle kept moving after the
 * seek, so re-stamping the bare target on every poll would drag it backwards.
 */
function heldPosition(ov: Overrides['positionSecs'], next: GroupState, now = Date.now()): number {
  const since = ov.until - OPTIMISM_MS;
  const drift = next.state === 'PLAYING' ? Math.max(0, now - since) / 1000 : 0;
  return Math.min((ov.value as number) + drift, next.durationSecs || Infinity);
}

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
    } else if (key !== 'positionSecs') {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  // Last, so it advances against the transport state we are about to show.
  if (ov.positionSecs && ov.positionSecs.until > now) {
    out.positionSecs = heldPosition(ov.positionSecs, out, now);
  }
  return out;
}

function pruneOverrides(ov: Overrides): Overrides {
  const now = Date.now();
  const out: Overrides = {};
  for (const [k, v] of Object.entries(ov)) if (v.until > now) out[k] = v;
  return out;
}

// ─── One request at a time ───────────────────────────────────────────────────
// A poll never overlaps itself. Asking while one is out books a single re-run
// for when it lands, so follow-ups after an action still see fresh data.

interface Flight {
  run: () => Promise<void>;
  busy: () => boolean;
}

function flight(task: () => Promise<void>): Flight {
  let current: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const run = (): Promise<void> => {
    if (!current) {
      current = task().finally(() => {
        current = null;
      });
      return current;
    }
    if (!queued) {
      queued = current
        .catch(() => {})
        .then(() => {
          queued = null;
          return run();
        });
    }
    return queued;
  };
  return { run, busy: () => current !== null };
}

// Request sequence numbers: a reply older than the last one applied is dropped.
let stateSeq = 0;
let stateApplied = 0;
let topoSeq = 0;
let topoApplied = 0;
let queueSeq = 0;

// Consecutive failed state polls, for a quiet "still trying" at most every 10s.
const FAIL_TOAST_MS = 10000;
let stateFailingSince = 0;
let stateFailToastAt = 0;

// What the queue looked like at the last poll, to notice edits made elsewhere.
const QUEUE_STALE_MS = 15000;
let queueSig: { groupId: string; sig: string } | null = null;
let queueFetchedAt = 0;

let stateFlight: Flight;
let topoFlight: Flight;

// ─── Expected grouping ───────────────────────────────────────────────────────
// Speakers take a moment to publish a new grouping. Until they do (or ~3s
// pass), topology polls are shown with the join/leave the user asked for.

const GROUPING_MS = 3000;

interface Expectation {
  zone: Zone;
  /** The coordinator it should follow, or null to stand alone. */
  coordinatorUuid: string | null;
  until: number;
}

const expected = new Map<string, Expectation>();

function homeOf(topo: Topology, uuid: string) {
  return topo.groups.find((g) => g.members.some((m) => m.uuid === uuid));
}

function regroup(topo: Topology, e: Expectation): Topology {
  let groups = topo.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m.uuid !== e.zone.uuid) }))
    .filter((g) => g.members.length > 0);
  if (e.coordinatorUuid) {
    groups = groups.map((g) =>
      g.coordinatorUuid === e.coordinatorUuid ? { ...g, members: [...g.members, e.zone] } : g,
    );
  } else {
    groups.push({
      id: `${e.zone.uuid}:expected`,
      coordinatorUuid: e.zone.uuid,
      coordinatorIp: e.zone.ip,
      name: e.zone.name,
      members: [e.zone],
    });
  }
  return { ...topo, groups };
}

function withExpectedGrouping(topo: Topology): Topology {
  const now = Date.now();
  let out = topo;
  for (const [uuid, e] of expected) {
    const home = homeOf(topo, uuid);
    const agrees = home?.coordinatorUuid === (e.coordinatorUuid ?? uuid);
    if (e.until <= now || agrees) {
      expected.delete(uuid);
      continue;
    }
    out = regroup(out, e);
  }
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

/** Nothing of the old group's may linger once the selection moves. */
const freshGroup = (): Pick<SonosStore, 'state' | 'overrides' | 'queue' | 'queueTotal'> => ({
  state: null,
  overrides: {},
  queue: [],
  queueTotal: 0,
});

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
  /** Why the last boot/rediscover found nothing, when the backend said. */
  discoveryError: string | null;
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

  /** Run an action; on failure say so. Resolves true only when it went through. */
  const guard = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (e) {
      get().say(`${label} failed — ${errText(e)}`, 'bad');
      return false;
    }
  };

  // ─── Queue edits, one after another ──────────────────────────────────────
  // Rows are renumbered locally the moment an edit is asked for, so the next
  // click already names the right position. The speaker calls then go out in
  // order, and the list is only re-read once the last of them has landed.

  let queueChain: Promise<unknown> = Promise.resolve();
  let queueOps = 0;
  let queueEpoch = 0;

  const queueAction = (label: string, fn: () => Promise<void>, edits = true): Promise<boolean> => {
    queueOps++;
    queueSeq++; // a re-read already out predates this edit
    const epoch = queueEpoch;
    const run = queueChain.then(async () => {
      // An earlier edit failed, so the positions this one was given may be wrong.
      if (epoch !== queueEpoch) return false;
      const ok = await guard(label, fn);
      if (!ok && edits) queueEpoch++;
      return ok;
    });
    queueChain = run;
    return run.finally(() => {
      if (--queueOps === 0) void get().refreshQueue();
    });
  };

  /** Adopt a topology: re-resolve the selection and start over if it moved. */
  const adoptTopology = (topo: Topology) => {
    const { group: prev, phase } = get();
    const group = resolveSelection(topo, prev);
    // Sonos renames a group when a room joins or leaves; that is the same
    // music, so keep the state. Only a different coordinator starts over.
    const moved = group?.coordinatorUuid !== prev?.coordinatorUuid;
    set({
      topology: topo,
      group,
      phase: topo.groups.length ? 'ready' : 'nothing',
      ...(moved ? freshGroup() : {}),
      ...(topo.groups.length ? { discoveryError: null } : {}),
    });
    if (group && group.id !== prev?.id) rememberGroup(topo.householdId, group.id);
    if (group && moved) {
      void get().pollState();
      void get().refreshQueue();
    }
    // Recovered on our own after a failed boot: the crate was never filled.
    if (phase !== 'ready' && topo.groups.length) void get().refreshFavorites();
  };

  const expectGrouping = (zone: Zone | undefined, coordinatorUuid: string | null) => {
    if (!zone) return;
    const e: Expectation = { zone, coordinatorUuid, until: Date.now() + GROUPING_MS };
    expected.set(zone.uuid, e);
    const topo = get().topology;
    if (topo) adoptTopology(regroup(topo, e));
  };

  const settleGrouping = (zone: Zone | undefined, ok: boolean) => {
    if (!ok) {
      if (zone) expected.delete(zone.uuid);
      void get().refreshTopology();
      return;
    }
    const e = zone && expected.get(zone.uuid);
    if (e) e.until = Date.now() + GROUPING_MS;
    setTimeout(() => void get().refreshTopology(), 800);
    setTimeout(() => void get().refreshTopology(), 2500);
    void get().pollState();
  };

  const zoneByIp = (ip: string) =>
    get().topology?.groups.flatMap((g) => g.members).find((z) => z.ip === ip);

  stateFlight = flight(async () => {
    const group = get().group;
    if (!group) return;
    const seq = ++stateSeq;
    try {
      const fresh = await api.getGroupState(group);
      // Selection may have moved while the request was in flight.
      if (get().group?.id !== group.id) return;
      if (seq < stateApplied) return;
      stateApplied = seq;
      stateFailingSince = 0;
      stateFailToastAt = 0;

      const ov = pruneOverrides(get().overrides);
      // Once the speaker has caught up with a seek, stop holding the needle.
      if (ov.positionSecs && Math.abs(fresh.positionSecs - heldPosition(ov.positionSecs, fresh)) <= 2) {
        delete ov.positionSecs;
      }
      set({ state: applyOverrides(fresh, ov), receivedAt: Date.now(), overrides: ov });

      // Edits from the Sonos app show up as a new length or a new current track.
      const sig = `${fresh.queueLength ?? ''}|${fresh.track?.uri ?? ''}`;
      const moved = queueSig?.groupId === group.id && queueSig.sig !== sig;
      queueSig = { groupId: group.id, sig };
      if (moved || (!document.hidden && Date.now() - queueFetchedAt >= QUEUE_STALE_MS)) {
        void get().refreshQueue();
      }
    } catch {
      // Keep the last good state; a transient LAN blip is not worth shouting about.
      if (get().group?.id !== group.id) return;
      const now = Date.now();
      if (!stateFailingSince) stateFailingSince = now;
      if (now - stateFailingSince >= FAIL_TOAST_MS && now - stateFailToastAt >= FAIL_TOAST_MS) {
        stateFailToastAt = now;
        get().say(`Can't reach ${group.name} — still trying`, 'bad');
      }
    }
  });

  topoFlight = flight(async () => {
    const seq = ++topoSeq;
    try {
      const topo = withExpectedGrouping(await api.getTopology());
      if (seq < topoApplied) return;
      topoApplied = seq;
      adoptTopology(topo);
    } catch {
      /* one missed topology poll is not worth shouting about */
    }
  });

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
    discoveryError: null,
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
      set({ phase: 'booting', discoveryError: null });
      try {
        const topo = await api.getTopology();
        topoApplied = ++topoSeq;
        if (topo.groups.length === 0) {
          set({ topology: topo, phase: 'nothing' });
          return;
        }
        const group = resolveSelection(topo, null);
        set({ topology: topo, group, phase: 'ready' });
        if (group) rememberGroup(topo.householdId, group.id);
        await Promise.all([get().pollState(), get().refreshQueue(), get().refreshFavorites()]);
      } catch (e) {
        set({ phase: 'nothing', discoveryError: errText(e) });
      }
    },

    async rediscover() {
      set({ busy: true });
      get().say('Listening for speakers…');
      try {
        const topo = withExpectedGrouping(await api.discover());
        topoApplied = ++topoSeq;
        set({ discoveryError: null });
        if (topo.groups.length === 0) {
          set({ topology: topo, phase: 'nothing', busy: false });
          return;
        }
        const prev = get().group;
        const group = resolveSelection(topo, prev);
        set({
          topology: topo,
          group,
          phase: 'ready',
          busy: false,
          ...(group?.coordinatorUuid !== prev?.coordinatorUuid ? freshGroup() : {}),
        });
        if (group) rememberGroup(topo.householdId, group.id);
        get().say(`Found ${topo.groups.reduce((n, g) => n + g.members.length, 0)} rooms`);
        await Promise.all([get().pollState(), get().refreshQueue(), get().refreshFavorites()]);
      } catch (e) {
        set({ busy: false, phase: get().topology ? 'ready' : 'nothing', discoveryError: errText(e) });
        get().say(`Could not find speakers — ${errText(e)}`, 'bad');
      }
    },

    refreshTopology: () => topoFlight.run(),

    pollState: () => stateFlight.run(),

    async refreshQueue() {
      const group = get().group;
      // Mid-edit the local list is ahead of the speaker; re-read once edits land.
      if (!group || queueOps > 0) return;
      const seq = ++queueSeq;
      queueFetchedAt = Date.now();
      try {
        const page = await api.getQueue(group.coordinatorIp, 0, 1000);
        if (get().group?.id !== group.id || seq !== queueSeq || queueOps > 0) return;
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
      set({ group: g, ...freshGroup(), arranging: false });
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
      // TRANSITIONING is on its way to playing — the button shows Pause, so send Pause.
      const playing = state.state === 'PLAYING' || state.state === 'TRANSITIONING';
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
      await sendVolume(`group:${group.coordinatorIp}`, final, () => api.setGroupVolume(group.coordinatorIp, target));
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
      await sendVolume(`zone:${member.ip}`, final, () => api.setVolume(member.ip, target));
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
      // Waits its turn behind any removal, whose renumbering it was clicked against.
      await queueAction('Play', () => api.playQueueIndex(group.coordinatorIp, index), false);
      void get().pollState();
    },

    async removeFromQueue(index) {
      const { group, queue, queueTotal, state } = get();
      if (!group) return;
      set({
        queue: queue
          .filter((q) => q.index !== index)
          .map((q) => (q.index > index ? { ...q, index: q.index - 1 } : q)),
        queueTotal: Math.max(0, queueTotal - 1),
        // The current track slides up with everything after it.
        state:
          state?.queueIndex && state.queueIndex > index
            ? { ...state, queueIndex: state.queueIndex - 1 }
            : state,
      });
      await queueAction('Remove', () => api.removeFromQueue(group.coordinatorIp, index));
    },

    async clearQueue() {
      const { group } = get();
      if (!group) return;
      set({ queue: [], queueTotal: 0 });
      if (await queueAction('Clear queue', () => api.clearQueue(group.coordinatorIp))) {
        get().say('Queue cleared');
      }
    },

    async playFavorite(f, action) {
      const { group } = get();
      if (!group) return;
      const ok = await guard('Play', () => api.playFavorite(group.coordinatorIp, group.coordinatorUuid, f, action));
      if (!ok) return;
      get().say(actionWord(action, f.title, group.name));
      await Promise.all([get().pollState(), get().refreshQueue()]);
    },

    async playItem(item, action) {
      const { group } = get();
      if (!group) return;
      const ok = await guard('Play', () => api.playItem(group.coordinatorIp, group.coordinatorUuid, item, action));
      if (!ok) return;
      get().say(actionWord(action, item.title, group.name));
      await Promise.all([get().pollState(), get().refreshQueue()]);
    },

    async everywhere() {
      const { topology, group } = get();
      if (!topology || !group) return;
      // Members don't follow their coordinator, so every room is asked on its own.
      const zones = topology.groups
        .filter((g) => g.id !== group.id)
        .flatMap((g) => g.members)
        .filter((z) => !z.invisible);
      if (zones.length === 0) {
        get().say('Already playing everywhere');
        return;
      }
      set({ busy: true });
      const ok = await guard('Group rooms', async () => {
        for (const z of zones) await api.joinGroup(z.ip, group.coordinatorUuid);
      });
      set({ busy: false });
      if (ok) get().say(`Everywhere · ${group.name}`);
      // Even a partial run moved some rooms; show where they landed.
      await get().refreshTopology();
      void get().pollState();
    },

    async joinRoom(zoneIp) {
      const { group } = get();
      if (!group) return;
      const zone = zoneByIp(zoneIp);
      expectGrouping(zone, group.coordinatorUuid);
      const ok = await guard('Add room', () => api.joinGroup(zoneIp, group.coordinatorUuid));
      settleGrouping(zone, ok);
    },

    async leaveRoom(zoneIp) {
      const zone = zoneByIp(zoneIp);
      expectGrouping(zone, null);
      const ok = await guard('Remove room', () => api.leaveGroup(zoneIp));
      settleGrouping(zone, ok);
    },
  };
});

// ─── Volume send throttle ────────────────────────────────────────────────────
// Drag events fire far faster than a speaker can answer. Send at most every
// ~60ms while dragging, and always send the value the user let go on. Only one
// send per target is ever out; a newer value waits for it, and only the newest
// waits, so the last value asked for is always the last to land.

interface VolumeLane {
  last: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  waiting?: () => Promise<void>;
}

const throttles = new Map<string, VolumeLane>();

async function sendVolume(key: string, final: boolean, send: () => Promise<void>) {
  const lane = throttles.get(key) ?? { last: 0, inFlight: false };
  throttles.set(key, lane);
  clearTimeout(lane.timer);
  if (final || Date.now() - lane.last >= 60) {
    await dispatchVolume(lane, send);
    return;
  }
  lane.timer = setTimeout(() => void dispatchVolume(lane, send), 60);
}

async function dispatchVolume(lane: VolumeLane, send: () => Promise<void>) {
  lane.last = Date.now();
  if (lane.inFlight) {
    lane.waiting = send;
    return;
  }
  lane.inFlight = true;
  let next: (() => Promise<void>) | undefined = send;
  while (next) {
    lane.waiting = undefined;
    try {
      await next();
    } catch {
      /* a dropped volume packet self-corrects on the next drag or poll */
    }
    next = lane.waiting;
  }
  lane.inFlight = false;
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

  // A tick that finds its previous request still out simply skips.
  const stateLoop = () => {
    const s = useSonos.getState();
    if (s.phase === 'ready' && !stateFlight.busy()) void s.pollState();
    stateTimer = setTimeout(stateLoop, document.hidden ? 4000 : 1000);
  };

  const topoLoop = () => {
    const s = useSonos.getState();
    if (s.phase !== 'booting' && !topoFlight.busy()) void s.refreshTopology();
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
