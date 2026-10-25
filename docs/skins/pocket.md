# Pocket: a white pocket player on a dark desk

Brief from JR: "a super high fidelity, but film-y quality" skin, an homage to
the first-generation (2001) click-wheel music players, with a monochrome
screen. The player should look photographed on film with a macro lens: white
polycarbonate, a mirror-steel back catching the room, a grey-blue LCD that
lights when you touch it. The wheel is the real control.

Files: `src/styles/skin-pocket.css` (tokens, the desk and the film, rails,
faceplate, overlays, phone), `src/styles/pocket.css` (the player),
`src/components/PocketStage.tsx` (the player and its little UI),
`src/components/PocketWheel.tsx`, `src/components/PocketLcd.tsx`,
`src/components/PocketPhone.tsx`, `src/components/PocketPanel.tsx`,
`src/lib/pocketFont.ts`, `src/lib/pocketPix.ts`,
`src/lib/pocketLcd.ts`, `src/lib/pocketScreens.ts`, `src/lib/pocketArt.ts`,
`src/lib/pocketLabels.ts`, and the textures in `src/assets/pocket/`.
Everything is scoped to `html[data-skin='pocket']`.

The skin evokes the object; it does not trace anyone's trademarks. No maker's
name or logo appears, and the LCD type is an original bitmap face drawn for
this app.

## What each panel is

| Panel | On the desk | Details |
| --- | --- | --- |
| Stage | The player, standing on a dark desk | White front with a steel rim, a smoked screen window, the wheel. The earphone lead runs out of the socket on top, over, down past the right side and away across the desk. Hold switch on the top edge (orange flag when on). |
| LCD | The player's screen | A real 160 × 128 one-bit UI: Now Playing, a menu tree, the volume bar, the hold box (see below). |
| Dock | Under the player | The app's seek bar between shuffle and repeat/crossfade. The transport's big buttons stand down: the wheel is the transport. |
| Rooms rail | A white polycarbonate module | Headings in the LCD's bitmap face, printed grey. The list sits in an inset crystal window: the room you're in is the LCD's inverse bar, the others carry a `›`. Everywhere is a white push button. |
| Right rail | A white module with the playlist screen | Queue and Favourites as a segmented white switch. The list is a big LCD: inverse bar on the playing track with `▶`, covers in grey pressed into the crystal. |
| Faceplate | A control panel from an old desktop, lying on the desk | See "The Sound window" below. |
| Search | A white sheet | The field is a strip of lit crystal with SEARCH printed on it; chips and the selected service use the inverse bar; covers stay in colour. |
| Settings | A white sheet | SETTINGS in the bitmap face, the section list in a crystal window with the inverse bar. |
| Status line | A strip of lit crystal | |
| Curtains | The desk | Booting, nothing found and the error screen print white on the dark desk; buttons are white plastic. |
| Phone | The phone is the player | See below. |

The crystal windows in the rails light together with the player's backlight
(`:has(.pk-device.is-lit)`), so touching the wheel lights all three screens.

## The LCD

- **Resolution:** 160 × 128 one-bit pixels, the panel size of the originals,
  drawn into a `Bitmap` (`pocketLcd.ts`) and painted by `PocketLcd` straight
  into `ImageData` at the canvas's real, devicePixelRatio-aware resolution.
- **Liquid crystal look:** each pixel is a square cell with a hairline gap
  (12% of the pitch, 28% of the ink survives in it), undriven cells are 4%
  darker than the gaps so the grid shows on an empty screen, and every dark
  pixel throws a 17% shadow down and right onto the reflector.
- **Tint:** unlit, grey with a green-blue cast (`#a9b2ab` → `#949e99`), a
  static mottle, darker at the edges. Lit, a cool, slightly uneven
  blue-white (`#c6def4` with a brighter centre). Ink is `#121a22` at 90%.
- **Ghosting:** pixels darken with a 34 ms time constant and clear with
  70 ms, so a changed screen ghosts the old one for about 200 ms.
- **Status bar:** ▶ or ❚❚, a lock when on hold, the room (Now Playing) or the
  menu title, and a battery filled to the group's volume (a thin cross when
  muted).
- **Now Playing:** the dithered cover (60 × 60) in a hairline frame; "n of N",
  title, artist and album beside it; a progress bar; elapsed and -remaining.
  Radio shows "Radio", Live and elapsed only, and greys the skips on the wheel.
  Long lines creep left once, one after another, and come to rest.
- **Menus:** Phædrus › Now Playing · Rooms · Queue · Favourites · Search… ·
  Settings. Rooms lists the groups (speaker on yours), Everywhere, Arrange….
  Queue lists the tracks with 14 × 14 dithered thumbnails, starting on the one
  playing; select plays it. Favourites play with the app's tap action.
  Settings holds Shuffle, Repeat, Crossfade, Backlight (9 Sec / Always / Off,
  remembered), About, and All Settings… (the app's settings). Seven rows show;
  longer lists get a scroll bar. Menus slide left and right in 230 ms.
  Tapping a row on the screen also chooses it.

### Type

Two original proportional bitmap faces in `src/lib/pocketFont.ts`, written as
glyph tables:

| Face | Cap | x-height | Descender | Strokes | Used for |
| --- | --- | --- | --- | --- | --- |
| Bold | 9 px | 7 px | 3 px | 2 px stems, 1 px bars, corners knocked off | titles, menus, clocks |
| Small | 7 px | 5 px | 2 px | 1 px | "2 of 5", labels, volume |

Both cover printable ASCII, typographic quotes and dashes, `… · • × ° ¿ ¡`,
ß, ø/Ø, and the interface symbols ▶ ❚❚ ■ › ‹ ♪ lock, two speakers, ● ✓ and
two mode arrows. Accented Latin letters are composed from a base glyph and a
mark (grave, acute, circumflex, tilde, diaeresis, ring, caron, breve, macron,
double acute, cedilla/ogonek); æ, œ, Æ and Œ are built by overlapping two
glyphs on one stem. Anything else folds to its plain letter, or a small box.
Digits can be set tabular so a clock doesn't shuffle. The same faces print
the short headings around the app, through mask images that
`pocketLabels.ts` publishes as CSS custom properties while the skin is shown.

### Dithering

`pocketArt.ts`: the cover is drawn square in two steps (4× then 1×, for a true
average), turned to grey, levels pinned at the 1.5th and 98.5th percentiles, a
gentle S-curve and a small lift, a 3 × 3 unsharp mask, then Atkinson
dithering (six neighbours get 1/8 of the error each; a quarter is let go).
Results are cached per URL and size. The image is loaded with
`crossOrigin='anonymous'` (the `art://` proxy and picsum both send CORS
headers); a tainted canvas or a failed load draws a ♪ pattern instead.

## The wheel

- **Anatomy:** a ring of four buttons (menu, ⏮, ⏭, ⏯) around a dished wheel
  that turns, around a separate centre button.
- **Turning:** press anywhere on the ring or wheel and drag around. The angle is
  accumulated move by move, each step wrapped into (−180°, 180°], so full
  circles work and nothing jumps at the atan2 seam. Moves inside 20% of the
  radius are ignored. A drag counts as turning after 9°. One volume point per
  5° on Now Playing (about 70 a turn); one row per 17° in menus. The volume
  sends `setGroupVolume(v)` per detent and `setGroupVolume(v, true)` when the
  turning stops. The wheel's surface (a scuffed, smudged texture) visibly
  turns with it.
- **Scroll wheel and trackpad:** over the wheel they turn it (9 px per volume
  point, 26 px per row, at most 3–4 detents per event); rolling up is louder,
  rolling down moves down a list.
- **Pressing:** a press that didn't turn is a click. Inside the centre button
  it selects (play/pause on Now Playing); anywhere else it's the button of
  that quadrant. Menu opens the menu, goes back, or from the top returns to
  Now Playing.
- **Keyboard:** the wheel is a focusable slider (arrows turn it, Page Up/Down
  turn it further, Enter or Space select, Backspace is menu, Escape backs out
  of a menu), and the five buttons are real, labelled, focusable buttons. The
  app's global shortcuts are untouched: they skip sliders, and the wheel is
  one.
- **Hold:** the switch on the top edge locks the wheel; touching it shows the
  hold box.
- No sounds.

## The Sound window

The volume deck under the player is a little one-bit window in the manner
of a 1990 desktop control panel (`PocketPanel`, drawn with `pocketPix.ts`):

- **Window:** black on white (`#101214` on `#fbfbf8`), a one-pixel frame and a
  hard one-pixel shadow down and right. The title bar has five pinstripes, a
  close box on the left and "Sound" in the bold bitmap face, knocked out of
  the stripes. A grow box sits in the bottom-right corner. One panel pixel is
  two CSS pixels throughout, and every part is drawn into a canvas at a whole
  number of device pixels, so nothing is smoothed.
- **In the photograph:** the grain and vignette still lie over it, the card
  casts a faint soft shadow on the desk, and the faintest scanlines and a
  vignette give it a breath of screen softness. The UI itself has no
  gradients and no soft edges.
- **Speaker volume (left):** a speaker whose sound waves grow with the group
  volume (none at 0; one, two or three), the number in the bold face, and a
  slider in the old Sound panel's manner: an outlined track filled with the
  desktop's 50% grey up to a square knob with grip lines, and eight notches
  numbered 0–7 underneath. The notches are decoration; the slider runs
  0–100 like the knob it replaces.
- **Rooms (right):** one row per room. The speaker is the mute button
  (crossed out when muted; inverted, instantly, while pressed), then the name
  in the bold face, cut with an ellipsis to the room the row can spare, then a
  slider with tick marks and the pentagon pointer thumb of the old mouse
  panels, then the number in the small face. A muted room's track loses its
  grey fill.
- **Separators:** one-pixel dotted rules.
- **Narrow stages** (under 640px wide, e.g. a 1024px window): the speaker volume
  becomes one row over the rooms.
- **Behaviour:** the same as the knob and faders it replaces:
  `setGroupVolume` / `setMemberVolume` while dragging and again with `final`
  on release, `setMemberMute`, arrows ±2 (Page Up/Down ±10 on the group), the
  mouse wheel on the group slider, the same aria labels. Focus is a
  one-pixel dotted outline. Nothing animates.
- **Type:** every label, name and number is the LCD's own bitmap face; names
  are drawn on the fly.

## Phone

Below 760 px `MobileShell` hands over to `PocketPhone`: the white front fills
the screen with a hairline of steel at the glass's edge, the LCD at the top,
the wheel under the thumb, sized by whichever runs out first, width or
height. The app's pages are reached through the player's menus: Queue › Edit
Queue…, Favourites › Covers…, Rooms › Arrange… and Room Volumes… slide the
full page up as a sheet of white plastic (Room Volumes is the Sound window,
its columns stacked); Search… and Settings open the
app's overlays. Tapping the screen on Now Playing opens the menu.

## Palette

| Token | Value | Job |
| --- | --- | --- |
| `--pk-night` | `#0b0c0d` | the desk in shadow |
| `--pk-white` | `#f3f3ef` | polycarbonate |
| `--pk-print` / `--pk-print-ink` | `#9da3a9` / `#4b5157` | grey printing on white |
| `--pk-ink` | `#1d2328` | type on white |
| `--pk-lcd` / `--pk-lcd-lit` | `#a3aca6` / `#c9def2` | crystal, unlit and lit |
| `--pk-lcd-ink` | `#1a2228` | LCD ink |
| `--pk-hi` / `--pk-hi-ink` | `#1f272d` / `#c3cec9` | the inverse highlight |
| `--pk-steel` | `#a9b0b7` | steel |
| `--ink` / `--paper` (Sound window) | `#101214` / `#fbfbf8` | the one-bit control panel |

## The film

All static: one grain plate (`grain.webp`, soft-light, 10%), a vignette, a
warm-in-the-lights, cool-in-the-shadows split tone, a dark desk under one
lamp (`desk.webp`), and the steel reflecting a blurred room (`room.webp`).
The halation round the screen only fades with the backlight. The textures in
`src/assets/pocket/` were made once by a small Python script (noise and
blurred shapes, no photographs).

## Motion, and how each motion stops

| Motion | Speed | Stops when |
| --- | --- | --- |
| Sheen across the front | one pass every ~44 s | parks where it is when paused or hidden (`.is-alive`); none under reduced motion |
| Backlight and halation | in 0.5 s, out 2.6 s, after 9 idle seconds | transitions only |
| LCD ghosting | ~200 ms per change | the rAF loop parks as soon as the pixels settle; off under reduced motion |
| Menu slides | 230 ms | a transition only; none under reduced motion |
| Marquee | 18 px a second, once per line, then holds | timers stop when hidden; none under reduced motion (lines are cut with …) |
| LCD clock | redraws once a second | only while playing and visible |
| Wheel press shading, hold switch | 0.08–0.45 s | transitions only |
| Sound window | none: a pressed speaker inverts at once | n/a |

The LCD never redraws on a timer while nothing changes: each screen says when
it next needs drawing (a second ticking over, a marquee step, an overlay
expiring) or that it can sit still. Base grain flicker and the drifting light
leak are off for this skin; the LIVE pip is steady. The rooms rail's playing
bars stand still.

## Fonts

Source Sans 3 (OFL, `@fontsource/source-sans-3`, 400/600/700, Latin and Latin
Extended) for print: humanist, of the period. The LCD's bitmap faces are code.
