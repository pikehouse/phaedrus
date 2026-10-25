# Nightdrive — a new Phaedrus skin

Design: Marshall (+ Claude). Build: Claude Code. App: JR's Phaedrus (`pikehouse/phaedrus`).

The reference mockups are the Claude Design canvas **"Phaedrus · Nightdrive skin"**. Its source is in `nightdrive-canvas-screens/` in this zip: 7 boards (desktop Now Playing + Queue, desktop Now Playing + Crate, phone Now / Queue / Crate / Rooms, and an interactive Motion study). Read the `.dc.html` files as code: every colour, size and shadow is inline. `/_blob/…` URLs in them are canvas uploads; the real files are in `nightdrive/` (section 6). When this spec and the canvas disagree, the canvas wins.

---

## 1. The idea in one paragraph

An '80s car stereo head unit set into a brushed dark aluminium dash. Every panel is a matte black faceplate with a thin chrome-grey bezel. Keys are black rubber with orange backlit legends: lit when the function is on, dark amber when off. The track title, clock, times and volume read out on an orange 14-segment display behind smoked glass, with the unlit segments faintly visible. Rooms are numbered preset keys (1–6), like station presets. Levels are orange LED ladders, and the volume knob is black rubber with an orange light ring that shows the level. One mode only (it's already a night look). One accent (keylight orange) plus a green stereo/playing lamp.

---

## 2. How it fits JR's skin system

Follow the pattern in `CLAUDE.md` → *Skins*. Nothing outside the skin should change, and **don't touch other skins** (Putty included).

1. **Register it** in `src/store/skin.ts`
   - add `'nightdrive'` to the `Skin` type
   - add `{ id: 'nightdrive', label: 'Nightdrive', hint: "'80s car stereo, orange keylight, brushed aluminium" }` to `SKINS`
   - add `'nightdrive'` to the allow-list in `recall()` (Putty's first PR missed this, so the app reopened in Hi-Fi)
2. **Stylesheet**: create `src/styles/skin-nightdrive.css`, everything scoped under `[data-skin='nightdrive']`. Import it in `src/main.tsx` next to the other skins. Start by re-pointing the shared Hi-Fi tokens (section 4), then do the work tokens can't.
3. **Fonts**: bundle locally (no Google Fonts at runtime; the release CSP blocks it). Add to `src/styles/fonts.css`:
   ```css
   @import '@fontsource/michroma/400.css';
   @import '@fontsource/barlow/500.css';
   @import '@fontsource/barlow/600.css';
   @import '@fontsource/barlow-condensed/500.css';
   @import '@fontsource/barlow-condensed/600.css';
   @import '@fontsource/barlow-condensed/700.css';
   ```
   `pnpm add @fontsource/michroma @fontsource/barlow @fontsource/barlow-condensed`
4. **Texture**: save `nightdrive/alu.svg` as `src/styles/nightdrive/alu.svg`, referenced with a relative `url()` from the stylesheet (Vite bundles it, so it passes the release CSP).
5. **Segment display**: `src/components/NightdriveSegments.tsx` (section 7). The title, clock, times and volume readouts all use it. There is no segment font; it draws SVG polygons.
6. **Stage**: `src/components/NightdriveStage.tsx` and a `skin === 'nightdrive'` branch in `NowPlaying.tsx`, the same way Daylight/Tuner/Putty do. The stage layout (display window across the top, art in a bezel with info beside it, LED progress, key tray + clock) is too different from Hi-Fi for CSS alone.
7. **Phone**: below 760px the app renders `MobileShell`. Nightdrive's phone rules go in `skin-nightdrive.css` too (scoped), not in `mobile.css`.

---

## 3. Palette

| Token | Hex | Job |
|---|---|---|
| `--nd-alu` | `#2C2E31` | dash ground (mid-stop of the aluminium gradient) |
| `--nd-face` | `#111111` | faceplate modules (gradient `#171717 → #0E0E0E`) |
| `--nd-bezel` | `#2A2A29` | thin chrome-grey ring around every plate and sleeve |
| `--nd-key` | `#232323` | rubber key (gradient `#2B2B2B → #1B1B1B`) |
| `--nd-tray` | `#070707` | recessed wells behind keys, tab bar, art bezel |
| `--nd-glass` | `#0A0705` | smoked display window (radial `#1A120C → #0A0705`) |
| `--nd-text` | `#E6E1D9` | primary text |
| `--nd-silk` | `#BDB7AE` | silkscreen / secondary text |
| `--nd-silk-2` | `#8C877F` | labels, durations, artists in lists |
| `--nd-key-on` | `#FF8A2E` | lit key legend, LED ladder segment, current-track number |
| `--nd-keylight` | `#FF7A1A` | knob ring, active-room lamp, glows |
| `--nd-seg` | `#FF9A3C` | lit display segment |
| `--nd-seg-ghost` | `rgba(255,120,30,.08)` | unlit segment / unlit ladder step |
| `--nd-hot` | `#FFB160` | the top lit step of a ladder |
| `--nd-key-off` | `#7A3A10` desktop · `#A8622E` phone tabs | unlit legend (phone tabs are lighter so they stay readable) |
| `--nd-st` | `#7BD36A` | ST / PLAYING lamp |

Glow recipe: legends and LED text `text-shadow: 0 0 5px rgba(255,122,26,.7)`; icons and segment SVG `filter: drop-shadow(0 0 2.5–3px rgba(255,122,26,.8))`; ladder step `box-shadow: 0 0 5px rgba(255,122,26,.7)`.

---

## 4. Re-point JR's Hi-Fi tokens

```css
[data-skin='nightdrive'] {
  color-scheme: dark;

  --bg-deep: #24262A;
  --bg: #2C2E31;
  --bg-raised: #171717;
  --walnut: #111111;
  --walnut-light: #1B1B1B;

  --cream: #E6E1D9;
  --cream-dim: #BDB7AE;
  --cream-faint: #8C877F;
  --cream-ghost: rgba(230, 225, 217, .10);

  /* the lamp becomes keylight orange */
  --amber: #FF8A2E;
  --amber-hot: #FFB160;
  --amber-glow: rgba(255, 122, 26, .35);

  --display: 'Barlow Condensed', sans-serif;
  --face: 'Barlow', sans-serif;

  --radius: 6px;
  --lift: 0 0 0 1px #000, 0 0 0 3px #2A2A29, 0 0 0 4px #050505, 0 22px 36px -18px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.06);
  --sink: inset 0 2px 5px rgba(0,0,0,.9);
}
```
Keep JR's motion tokens (`--ease`, `--t*`) as they are.

---

## 5. Type: three voices plus the display

| Voice | Font | Where | Desktop | Phone |
|---|---|---|---|---|
| **The track playing now** | `NightdriveSegments` (section 7), not a font | Now Playing title, clock, elapsed/total, VOL | title glyph height 44px (13 cells) | 30px (10 cells); mini-player 18px |
| **Things you pick** | Barlow **500** | room names, track names in lists, crate titles, room chip, the second-line title under the artist | rooms 15px · list tracks 15px · crate 14px | rooms 16px · tracks 15px · crate 15px |
| **Everything else** | Barlow Condensed 600 (700 for numbers/LED words), UPPERCASE, tracking .12em | artists, key legends, durations, annunciators (CD · TRK 04 · RPT · LOUD), preset numbers, tab labels | artist on Now Playing 28px tracking .14em · lists 11px · durations 12px · legends 10px | artist 18px · tabs 10px |
| **Silkscreen headings** | Michroma 400, UPPERCASE, tracking .18em, 9–9.5px, `--nd-silk-2` | ROOMS, UP NEXT, ROOMS IN GROUP, VOL, CRATE | — | — |

Room names stay sentence case. Accessibility: the segment SVG gets `role="img"` and `aria-label` with the real text.

---

## 6. Brushed aluminium (the ground)

```css
[data-skin='nightdrive'] .nd-alu {
  background:
    linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,0) 30%, rgba(0,0,0,.25)),
    url('./nightdrive/alu.svg'),
    linear-gradient(165deg, #3B3D40, #2C2E31 60%, #24262A);
}
```
`nightdrive/alu.svg` (600×300, tiles horizontally):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><filter id="b" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency="0.0015 0.75" numOctaves="3" seed="9" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 -.25"/></filter><rect width="100%" height="100%" filter="url(#b)" opacity=".22"/></svg>
```
Apply it to the app background only (desktop and phone). Modules sit on it as faceplates. The texture is static, so it's fine under reduced motion.

---

## 7. `NightdriveSegments` (14-segment display)

Props: `text: string`, `cells?: number` (pad with blanks, default `text.length`), `height: number` (glyph height px), `colonAfter?: number[]` (cell indexes that get a colon after them), `ghost = true`.

Geometry (all from glyph height `H`; this is exactly what `nightdrive/make-segment-svgs.py` does, port it):
- stroke `t = H × .085`, cell width `w = H × .66`, advance `w + H × .34`, padding `2t` all round.
- Each glyph is a `<g transform="translate(x, pad) skewX(-7)">` of 14 hexagonal polygons. A segment from p1 to p2 has half-width `t/2` and tapered ends of length `min(t/2, L × .25)`.
- Segment endpoints (C = w/2, M = H/2, g = t × .55, d = t × .95):
  `a (g,0)→(w−g,0)` · `d (g,H)→(w−g,H)` · `f (0,g)→(0,M−g)` · `e (0,M+g)→(0,H−g)` · `b (w,g)→(w,M−g)` · `c (w,M+g)→(w,H−g)` · `g1 (g,M)→(C−g,M)` · `g2 (C+g,M)→(w−g,M)` · `i (C,g)→(C,M−g)` · `l (C,M+g)→(C,H−g)` · `h (d,d)→(C−.8d,M−d)` · `j (w−d,d)→(C+.8d,M−d)` · `k (d,H−d)→(C−.8d,M+d)` · `m (w−d,H−d)→(C+.8d,M+d)`
- Glyph table (the `G` dict in the script): 0–9, A–Z, `-`, space. Upper-case the text; map accents to the plain letter, anything else to a space.
- Lit segments fill `#FF9A3C` with the drop-shadow glow on the whole `<svg>`; unlit segments `#FF781E` at `fill-opacity .08` (skip them when `ghost` is false). Colon = two dots, radius `.6t`, centred in the gap after the cell, lit.
- Memoise the polygon strings per (char, height); they never change.

The rendered SVGs in `nightdrive/seg-*.svg` are reference output for checking the port.

---

## 8. Surfaces (the physical vocabulary)

| Piece | Recipe |
|---|---|
| **Faceplate module** (every panel/rail) | `background: linear-gradient(180deg, #171717, #0E0E0E); border-radius: 6px (8px phone); box-shadow: var(--lift);` |
| **Display window** | `background: radial-gradient(120% 140% at 20% 0%, #1A120C, #0A0705 60%); border-radius: 4px; box-shadow: inset 0 3px 8px rgba(0,0,0,.95), inset 0 0 0 1px rgba(255,255,255,.04), 0 1px 0 rgba(255,255,255,.06);` plus a glass sheen `::after { background: linear-gradient(165deg, rgba(255,255,255,.07), transparent 38%) }` |
| **Tray** (behind keys, tab bar) | `background: #070707; border-radius: 6–7px; padding: 6–9px; box-shadow: inset 0 2px 5px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05);` |
| **Key** | `background: linear-gradient(180deg, #2B2B2B, #1B1B1B); border-radius: 5px (6px phone); box-shadow: inset 0 1px 0 rgba(255,255,255,.10), 0 3px 0 #050505, 0 5px 8px -3px rgba(0,0,0,.9);` legend Barlow Condensed 600 10px tracking .14em under a 22px icon. Height 62px desktop transport, 54px phone transport, 56px phone tabs, 44px minimum elsewhere. Lit = `--nd-key-on` + glow; off = `--nd-key-off`, no glow. Play/pause is 2× wide. |
| **Pressed key** | `transform: translateY(2px); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 1px 0 #050505, 0 2px 4px -2px rgba(0,0,0,.9);` (the canvas shows play/pause in this state while playing) |
| **Raised row** (selected room, current queue track) | `background: linear-gradient(180deg, #262626, #1A1A1A); box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 2px 0 #050505, 0 6px 12px -6px rgba(0,0,0,.9); border-radius: 5px;` |
| **Preset key** (room number) | small key 30×28 (32×30 phone), number Barlow Condensed 700 15px: lit for rooms in the active group, off otherwise |
| **Active-room lamp** | 8px circle `#FF7A1A`, `box-shadow: 0 0 8px 1px rgba(255,122,26,.8)` |
| **LED ladder** (progress, room faders) | row of flex steps, 3px gap (2px phone), 8–10px tall, radius 1px. Lit = `#FF8A2E` + glow; the top lit step `#FFB160`; unlit = `--nd-seg-ghost` + `inset 0 0 0 1px rgba(255,120,30,.06)`. Progress: 40 steps desktop, 24 phone Now, 30 phone mini (5px). Room faders: 20 steps desktop, 14 phone. Clicking/dragging sets the value (snap to steps). |
| **Volume knob** | ring: `conic-gradient(from 225deg, #FF7A1A 0 <level×270°>, rgba(255,122,26,.10) … 270deg, transparent 270deg)` masked to a band (`radial-gradient(circle, transparent 58%, #000 59.5%, #000 66%, transparent 67.5%)`), `filter: drop-shadow(0 0 6px rgba(255,122,26,.8))`. Knob: `radial-gradient(circle at 36% 28%, #3A3A3A, #161616 55%, #0B0B0B)`, shadow `0 10px 18px -6px rgba(0,0,0,.9), inset 0 2px 1px rgba(255,255,255,.12), inset 0 -3px 6px rgba(0,0,0,.6), 0 0 0 2px #050505`; 4px orange pointer with glow. Sizes: 150px dial / 90px knob (desktop deck), 132 / 84 (phone Rooms), 60 / 38 (phone Now). |
| **Annunciators** | Barlow Condensed 700 10–11px caps in the display window: lit `#FF8A2E` + glow, off `#5A2A0C`. ST / PLAYING in `--nd-st` with a green glow. |
| **Vent slots** (decorative) | 10-column grid of 5px slots, 6×8px gap, `background: #050505; box-shadow: inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.06)`. Under the track info on desktop. |
| **Album art / sleeves** | art bezel: 7–8px `#070707` frame, `0 0 0 1px #2A2A29`; art radius 3px with a sheen `linear-gradient(160deg, rgba(255,255,255,.16), transparent 40%, rgba(0,0,0,.45))` over it. Sleeves: `0 0 0 3px #070707, 0 0 0 4px #2A2A29, 0 12px 18px -10px rgba(0,0,0,.9)`. Radio stations: smoked black sleeve, call letters Barlow Condensed 700 30–32px orange with glow, frequency below in key-off orange. |

---

## 9. Screen by screen (desktop ≥ 760px)

JR's layout stays: rooms rail 250px · stage · queue/crate rail 330px, 16px gaps on the aluminium.

- **Rooms rail**: ROOMS label + small "Arrange" key; rows = preset key + name (Barlow) + caps sub-label (group info); selected room = raised row + orange lamp. "Everywhere" key at the bottom, then "6 rooms · Rescan".
- **Stage module**: top line `DINING ROOM` (lit) `+ KITCHEN  QUEUE 04/12`, then `ST` and `● PLAYING` in green on the right. Display window across the full width: annunciators (CD · TRK 04 · RPT · SHUF · LOUD), then the segment title. Below: 236px art in its bezel; beside it the artist (caps 28px), title in Barlow 17px, album · year, and vent slots. LED progress with segment elapsed/total on either side. Bottom row: key tray (shuffle · prev · **play/pause** · next · favourite · repeat) + clock window (CLK · AM · PM annunciators, segment time).
- **Volume deck** (separate module): knob · VOL readout window · "Rooms in group" rows (preset key, name, LED ladder, value).
- **Right rail**: Queue/Crate as two keys in a tray + search key. Queue: UP NEXT label + `04 / 12 · 42 min`; rows = number (orange on current), 38px thumb, track (Barlow) / artist (caps), duration; current = raised row; played tracks at 55% opacity. Crate: filter keys (All · Albums · Playlists · Radio), two-column sleeve grid, title (Barlow) + kind label (caps).

## 10. Phone (< 760px, `MobileShell`)

- **Header**: room chip key (preset number lit + room name + `+1`) · search key · settings key, all 44px.
- **Tab bar**: a tray holding four keys (Now · Queue · Crate · Rooms), icon + 10px legend; the active tab is lit, the rest use the lighter phone off-colour.
- **Now**: one module: queue position + ST/PLAYING, 220px art in its bezel, display window with the segment title, artist + album, LED progress with times, key tray (prev · play/pause · next), then a row with a small knob, VOL readout and a mini clock.
- **Queue**: mini-player module (56px art, mini segment title, artist, pause key, thin LED progress) above the queue module.
- **Crate**: one module: filter keys, two-column sleeve grid.
- **Rooms**: preset room list module (+ "Everywhere"), then a volume module with the knob, VOL readout and stacked per-room ladders. Make sure the last ladder isn't clipped by the tab bar (let the module scroll if it must).

---

## 11. Motion (see `MotionStudy.dc.html`; JR's rules apply)

Slow and gentle, nothing strobes or blinks, everything stops when paused or the window is hidden, and `useReducedMotion` / `prefers-reduced-motion` turns it all off.

| Piece | Behaviour |
|---|---|
| **Title scroll** | Only when the title is wider than the window. Glides left at about 45px/s with an ease-in-out, holds 3s at each end, then glides back (`alternate`). Paused: freezes in place (`animation-play-state: paused`). Reduced motion: no scroll, cut at the window edge. Track change: start from the left again. |
| **Keylight** | Legend colour and glow transition over 240ms ease when a function turns on or off. Keys drop 2px while held (120ms). |
| **LED ladders + knob ring** | Steps fill or empty with a 180ms ease. Never bounce, and there's no live VU meter. The ring follows the same level. |
| **Play state** | PLAYING lamp fades to 25% over 400ms when paused, and the display windows dim to 60%. The clock colon stays solid. |

## 12. Done means

- `pnpm build` passes with zero TypeScript errors.
- `pnpm dev` (mock data) at 1440×900 and at phone width matches the canvas.
- Choosing Nightdrive, quitting and reopening keeps Nightdrive (`recall()`).
- Switching skins back and forth leaves every other skin untouched.
- A release build still loads the fonts and the aluminium texture (no Google Fonts, CSP-safe).
- Reduced motion: no scroll, no transitions.
