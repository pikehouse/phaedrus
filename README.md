# Phaedrus

A Mac Sonos controller for late nights: warm, analog, fast. Finds whatever
Sonos system is on the current Wi-Fi (nothing is hardcoded), shows rooms and
groups, now playing on a spinning record, the queue, your Sonos favorites, and a
single search box that covers Apple Music, Spotify, and TuneIn radio.

Everything talks to the speakers directly over the LAN. There is no cloud, no
account, and no developer keys to set up.

## Stack

- **Tauri v2** shell — a real Mac window with a tiny footprint
- **Rust core** (`src-tauri/src/sonos/`) — discovery, SOAP control, topology,
  DIDL metadata, music-service gateway (SMAPI), Apple catalog search
- **React 19 + TypeScript + Vite** frontend (`src/`), hand-written CSS,
  Fraunces + Karla bundled locally
- Shared API contract: `src/api/types.ts` ⇄ `src-tauri/src/sonos/model.rs`

## Run it

```bash
pnpm install
pnpm tauri dev          # dev window with hot reload
pnpm tauri build        # .app and .dmg in src-tauri/target/release/bundle/
```

Rust is required (`curl https://sh.rustup.rs -sSf | sh`). The first Rust build
takes a few minutes; after that it is incremental.

Frontend-only work (mock data, no speakers needed):

```bash
pnpm dev                # http://localhost:1420 with a fake Sonos system
```

Tests for the protocol parsers, using XML captured from a real household:

```bash
cd src-tauri && cargo test
cargo run --example probe -- "steely dan"   # read-only smoke test against your LAN
```

## How discovery works

Three sources race: IPs remembered from the last time we saw this network,
SSDP multicast/broadcast, and a TCP sweep of the local subnet on port 1400
(many mesh routers drop multicast — the sweep is what actually works on some
networks). The first speaker to answer `GetZoneGroupState` describes the whole
household, so one hit is enough. Stereo pairs and surrounds are collapsed to
their visible room. Per-network state is keyed by Sonos household id, so the
same app works at any house.

## How search works, with no setup

- **Apple Music** — Apple's public catalog search API (no key). The ids it
  returns are the ids Sonos uses, so results play through the household's own
  Apple Music account.
- **Spotify** — the Sonos music-service gateway (SMAPI), the same SOAP API the
  official app uses. It needs a one-time "Connect Spotify" in the search
  panel: Sonos gives us a sign-in link, you log in once in the browser, and a
  token is stored locally per household. No Spotify developer app.
- **TuneIn** — SMAPI, anonymous.

Playback URIs are built to match what Sonos itself writes. Account slots
(`sn`) are learned from your favorites and queue.

## Layout of the Rust core

| file | job |
| --- | --- |
| `discovery.rs` | SSDP + subnet sweep + cached IPs, first responder wins |
| `topology.rs` | ZoneGroupState → groups, coordinator first, hidden pair halves dropped |
| `soap.rs` | UPnP SOAP client, UPnP error mapping |
| `transport.rs` | AVTransport actions and the one-round-trip group snapshot |
| `rendering.rs` | volume / mute, per zone and per group |
| `content.rs` | queue and favorites via ContentDirectory |
| `didl.rs` | DIDL-Lite parse/build, art URL fixing, kind classification |
| `smapi.rs` | music-service SOAP: search, metadata, AppLink/DeviceLink linking |
| `apple.rs` | iTunes Search API |
| `items.rs` | search result / favorite → (uri, metadata) and queue choreography |
| `system.rs` | the one object the UI talks to; household prefs; search fan-out |

Local state (known IPs, learned account slots, Spotify token) lives in
`~/Library/Application Support/com.phaedrus.app/phaedrus.json`.

## Phones

The frontend is plain web. The plan for phones is for the Mac app to serve the
same interface over the LAN so any phone in the house can open it, with no App
Store or developer program involved. Tauri can also build the same code as a
native iOS app if that ever becomes worth the signing hassle.
