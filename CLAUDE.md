# Phaedrus — notes for Claude Code

Phaedrus is a Sonos controller for the Mac (Tauri v2: a Rust core in `src-tauri/`, a
React 19 + TypeScript + Vite frontend in `src/`). The person you're helping may not be a
programmer. Do the setup and building for them, explain in plain words, and ask before
anything that installs system software.

## First-time setup on a Mac

Check each; install only what's missing, and say what you're installing:

1. Xcode command line tools: `xcode-select -p` (install with `xcode-select --install`).
2. Homebrew: `brew --version` (https://brew.sh).
3. Node and pnpm: `brew install node pnpm`.
4. Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`, then
   `source "$HOME/.cargo/env"` in each new shell. Add the Intel target for universal
   builds: `rustup target add x86_64-apple-darwin`.
5. In the repo: `pnpm install`.

## Running it

- **Just the interface, fake speakers** (fastest way to see changes): `pnpm dev`, then
  open http://localhost:1420. It runs on mock data (`src/api/mock.ts`).
- **The real app against real speakers:** `pnpm tauri dev`. The first Rust build takes a
  few minutes. Run it in the person's own terminal window (or `open -a Terminal` a script),
  not as a background task of your session: long-running processes started from a
  Claude session can be killed by its memory watchdog.
- On first launch macOS asks to allow finding devices on the local network. It must be
  allowed, or no speakers are found.

## Building an app to install

```bash
source "$HOME/.cargo/env"
pnpm tauri build --target universal-apple-darwin --bundles app
```

The app lands in `src-tauri/target/universal-apple-darwin/release/bundle/macos/Phaedrus.app`.
Copy it to `/Applications`. To make a DMG for someone else, don't use `--bundles dmg`
(its script drives Finder through AppleScript and fails from a non-interactive shell);
build the app as above, then:

```bash
S=$(mktemp -d) && ditto src-tauri/target/universal-apple-darwin/release/bundle/macos/Phaedrus.app "$S/Phaedrus.app" \
  && ln -s /Applications "$S/Applications" \
  && hdiutil create -volname Phaedrus -srcfolder "$S" -ov -format UDZO -fs HFS+ Phaedrus.dmg
```

The app is ad-hoc signed (`signingIdentity: "-"` in `tauri.conf.json`), not notarized, so
on another Mac the first open needs System Settings → Privacy & Security → Open Anyway.

## Checks before calling a change done

- `pnpm build` (runs `tsc` then Vite) must pass with zero TypeScript errors.
- `cd src-tauri && cargo test` and `cargo clippy --all-targets` (no new warnings).
- The Content-Security-Policy in `tauri.conf.json` only applies to release builds, not
  `pnpm tauri dev`. After touching how images, fonts or network requests load, check a
  release build.
- Don't send commands to real speakers while testing unless the person asks; music may be
  playing. Read-only calls are fine.

## How it's put together

- The frontend talks to Rust through `src/api/tauri.ts`. The contract types in
  `src/api/types.ts` mirror `src-tauri/src/sonos/model.rs`; change both together.
- The Rust core (`src-tauri/src/sonos/`) finds speakers (SSDP plus a subnet sweep), speaks
  UPnP/SOAP to them, and searches music services (Apple's public catalog API, Spotify and
  TuneIn through Sonos's music-service gateway). The README has a module-by-module table.
- Skins: `src/store/skin.ts` lists them. Each skin owns `src/styles/skin-<name>.css` (scoped
  under `html[data-skin='<name>']`), usually a stage component (`src/components/<Name>Stage.tsx`)
  and a branch in `src/components/NowPlaying.tsx`. Base stylesheets (`tokens.css`,
  `rooms.css`, `queue.css`, …) are shared by every skin; prefer skin-scoped overrides.
- Phones: below 760px wide the app renders `MobileShell` with rules in `src/styles/mobile.css`.
- Settings live in `src/store/settings.ts` (persisted in localStorage); the Spotify link
  token is stored in the macOS Keychain by the Rust side.
- The iOS project in `src-tauri/gen/apple/` exists but iOS is on hold.

## Taste the owner has asked for

Slow, gentle motion (the record turns about once every five seconds); restrained glow;
nothing that strobes or snaps; animation loops that stop when paused, hidden, or when the
system asks for reduced motion (`src/hooks/useReducedMotion.ts`).
