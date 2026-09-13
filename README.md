# Phaedrus

A Sonos controller for the Mac and iPhone, built for late nights: warm, analog,
fast. Finds whatever Sonos system is on the current Wi-Fi (nothing is
hardcoded), shows rooms and groups, now playing on a spinning record, the
queue, your Sonos favorites, and a single search box that covers Apple Music,
Spotify, and TuneIn radio.

Everything talks to the speakers directly over the LAN. There is no cloud, no
account, and no developer keys to set up.

## Stack

- **Tauri v2** shell — a real Mac window and a native iPhone app, one codebase
- **Rust core** (`src-tauri/src/`) — discovery, SOAP control, topology, DIDL
  metadata, music-service gateway (SMAPI), Apple catalog search, album-art cache
- **React 19 + TypeScript + Vite** frontend (`src/`), hand-written CSS,
  Fraunces, Karla, Archivo and Inter bundled locally
- Shared API contract: `src/api/types.ts` ⇄ `src-tauri/src/sonos/model.rs`

Minimum OS: macOS 13.3 and iOS 16.4. The stylesheet relies on `@property`,
container queries, `color-mix()` and `:has()`, which need the system WebKit
from Safari 16.4.

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
cargo run --example probe -- "steely dan"   # smoke test against your LAN
cargo run --example probe_write             # gentle write-path test
```

`probe` is mostly read-only (discover, group state, queue, favorites, search),
but it also starts a Spotify link session with the speaker, which asks Sonos
for a sign-in link and code. It changes nothing you can hear, and its state
goes to a temp file rather than the app's own store. `probe_write` sets a
volume to its current value, then appends a track to the queue and removes it.

## Skins

The whole look switches from the skin picker; the choice is remembered per
device.

| skin | feel |
| --- | --- |
| Hi-Fi | Late night, warm lamp, a record spinning (default) |
| Board | Station enamel, split-flaps, hard light |
| Tuner | 1988 black faceplate, glowing green display |
| Drive | LA at 2 a.m., neon script, sodium streetlights |
| Daylight | Light, quiet, modern |
| Deck | DJ controller, orange LEDs, red waveforms |
| Prism | Light through glass, a spectrum on the wall (in progress) |

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

In `src-tauri/src/`:

| file | job |
| --- | --- |
| `lib.rs` | app setup, plugin registration, the `art://` scheme handler |
| `commands.rs` | Tauri command surface, thin wrappers over `SonosSystem` |
| `art.rs` | album-art cache: fetch once, keep on disk, serve on `art://` with open CORS |
| `store.rs` | JSON persistence: known IPs, learned account slots, Spotify token |

In `src-tauri/src/sonos/`:

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
| `model.rs` | wire model, mirrors `src/api/types.ts` |
| `xml.rs` | roxmltree helpers that match on local names only |
| `error.rs` | the crate's error type |

Local state (known IPs, learned account slots, Spotify token) lives in
`phaedrus.json` in the app data directory. On the Mac that is
`~/Library/Application Support/com.jrtipton.phaedrus/phaedrus.json`.

The bundle identifier was `com.phaedrus.app` until it was renamed to
`com.jrtipton.phaedrus`. Tauri warns about identifiers ending in `.app`, and the
old one could collide with someone else's app on a free signing team. Because
the data directory is named after the identifier, the app moves state over
from the old `com.phaedrus.app` directory. On iPhone the rename makes it a
different app: install the new one and delete the old one.

## Icons

`src-tauri/icon-src.png` is the source of truth for the app icon. The desktop
icons in `src-tauri/icons/` and the iPhone icon set in
`src-tauri/gen/apple/Assets.xcassets` come from it. To regenerate them, run
`pnpm tauri icon src-tauri/icon-src.png`. If that recreates
`src-tauri/icons/android/` or `src-tauri/icons/ios/`, delete them: there is no
Android target, and Xcode reads only `Assets.xcassets`.

## iPhone

The same code builds as a native iOS app (iOS 16.4 or later). The Xcode project
lives in `src-tauri/gen/apple/` (committed), and the Rust core compiles for the
`aarch64-apple-ios` target as is. On the phone, discovery uses the subnet
sweep (multicast needs an Apple-approved entitlement); it finds the household
the same way it does on a mesh network.

One-time setup on the Mac:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install cocoapods
```

Then, in Xcode ▸ Settings ▸ Accounts, sign in with your Apple ID. A free
account is enough to install on your own phone: Xcode creates a "Personal
Team" and the app runs for seven days before it needs re-installing from
Xcode. The paid developer program removes that limit and adds TestFlight.

Run on a plugged-in iPhone:

```bash
pnpm tauri ios dev --open      # opens Xcode; pick your Team under Signing, press Run
```

On first launch iOS asks to allow local network access; say yes. If the app
is "untrusted", approve it under Settings ▸ General ▸ VPN & Device
Management.

A release build for the device:

```bash
pnpm tauri ios build
```

The phone layout is a stacked shell (Now Playing, Queue, Crate, Rooms in a
bottom tab bar), portrait only. It reuses every component and every skin.

### The Xcode PATH patch

Xcode runs the "Build Rust Code" build phase with a minimal `PATH`, not your
shell's, so it can't find `pnpm`, `cargo` or `node`. When you build from Xcode
(for example by pressing Run after `--open`), the phase fails with
`pnpm: command not found`. The generated script is patched to put the usual
install locations first. It starts with:

```sh
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; pnpm tauri ios xcode-script -v ...
```

The patch lives in two places: the `preBuildScripts` entry in
`src-tauri/gen/apple/project.yml` and the `shellScript` of the "Build Rust
Code" phase in `phaedrus.xcodeproj/project.pbxproj`. Running
`pnpm tauri ios init` again re-renders both from Tauri's template and drops the
patch. After a re-init, add this before `pnpm tauri ios xcode-script` in both
files:

```sh
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH";
```

A re-init also resets the other hand edits in `gen/apple`: the 16.4 deployment
target, portrait-only iPhone orientations, the local-network usage string, the
removed `NSAllowsArbitraryLoads`, and the Podfile. Check `git diff` afterwards.
