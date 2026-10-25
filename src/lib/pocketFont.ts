/* ══════════════════════════════════════════════════════════════════════════
   POCKET'S BITMAP TYPE

   Two original proportional bitmap faces for the Pocket skin's LCD, drawn
   pixel by pixel for this app in the spirit of early-2000s portable screens:
   friendly, heavy, round-shouldered, legible at arm's length.

     Bold   cap height 9, x-height 7, descender 3. Two-pixel stems, one-pixel
            bars, every bowl's corner knocked off. Titles, menus, times.
     Small  cap height 7, x-height 5, descender 2. One-pixel strokes. The
            "2 of 5" line, labels, volume figures.

   Glyphs are rows of '#' (ink) and '.' (paper), separated by spaces. A
   leading "n:" says the first row sits n rows below the cap line (so
   lowercase x-height letters start "2:" in Bold). Rows below the baseline
   are the descender. One blank column follows every glyph.

   Accented Latin letters are composed from a base glyph and a mark; a few
   ligatures (æ, œ, Æ, Œ) are built by overlapping two glyphs on a shared
   stem. Anything else folds to its nearest plain letter, or to a small box.
   ══════════════════════════════════════════════════════════════════════════ */

type Table = Record<string, string>;

/** A character by code point: combining marks and odd spaces, written legibly. */
const cc = (n: number) => String.fromCharCode(n);

const COMBINING = new RegExp(`[${cc(0x300)}-${cc(0x36f)}]`, 'g');

const BOLD: Table = {
  A: '.####. ##..## ##..## ##..## ###### ##..## ##..## ##..## ##..##',
  B: '#####. ##..## ##..## ##..## #####. ##..## ##..## ##..## #####.',
  C: '.####. ##..## ##.... ##.... ##.... ##.... ##.... ##..## .####.',
  D: '####.. ##.##. ##..## ##..## ##..## ##..## ##..## ##.##. ####..',
  E: '###### ##.... ##.... ##.... #####. ##.... ##.... ##.... ######',
  F: '###### ##.... ##.... ##.... #####. ##.... ##.... ##.... ##....',
  G: '.####. ##..## ##.... ##.... ##.### ##..## ##..## ##..## .#####',
  H: '##..## ##..## ##..## ##..## ###### ##..## ##..## ##..## ##..##',
  I: '## ## ## ## ## ## ## ## ##',
  J: '....## ....## ....## ....## ....## ....## ##..## ##..## .####.',
  K: '##..## ##..## ##.##. ####.. ###... ####.. ##.##. ##..## ##..##',
  L: '##... ##... ##... ##... ##... ##... ##... ##... #####',
  M: '##....## ###..### ######## ##.##.## ##.##.## ##....## ##....## ##....## ##....##',
  N: '##...## ###..## ####.## ##.#### ##..### ##...## ##...## ##...## ##...##',
  O: '.#####. ##...## ##...## ##...## ##...## ##...## ##...## ##...## .#####.',
  P: '#####. ##..## ##..## ##..## #####. ##.... ##.... ##.... ##....',
  Q: '.#####. ##...## ##...## ##...## ##...## ##...## ##...## ##...## .#####. ....##. .....##',
  R: '#####. ##..## ##..## ##..## #####. ##.##. ##..## ##..## ##..##',
  S: '.####. ##..## ##.... ###... .####. ...### ....## ##..## .####.',
  T: '###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##..',
  U: '##..## ##..## ##..## ##..## ##..## ##..## ##..## ##..## .####.',
  V: '##...## ##...## ##...## ##...## .##.##. .##.##. .##.##. ..###.. ...#...',
  W: '##....## ##....## ##....## ##....## ##.##.## ##.##.## ######## ###..### ##....##',
  X: '##...## ##...## .##.##. ..###.. ..###.. ..###.. .##.##. ##...## ##...##',
  Y: '##..## ##..## ##..## .####. ..##.. ..##.. ..##.. ..##.. ..##..',
  Z: '###### ....## ...##. ...##. ..##.. .##... .##... ##.... ######',

  a: '2:.####. ....## .##### ##..## ##..## ##..## .#####',
  b: '##.... ##.... #####. ##..## ##..## ##..## ##..## ##..## #####.',
  c: '2:.#### ##... ##... ##... ##... ##... .####',
  d: '....## ....## .##### ##..## ##..## ##..## ##..## ##..## .#####',
  e: '2:.####. ##..## ##..## ###### ##.... ##.... .####.',
  f: '.### ##.. #### ##.. ##.. ##.. ##.. ##.. ##..',
  g: '2:.##### ##..## ##..## ##..## ##..## ##..## .##### ....## .####.',
  h: '##.... ##.... #####. ##..## ##..## ##..## ##..## ##..## ##..##',
  i: '## .. ## ## ## ## ## ## ##',
  j: '..## .... ..## ..## ..## ..## ..## ..## ..## ..## ###.',
  k: '##.... ##.... ##..## ##.##. ####.. ###... ####.. ##.##. ##..##',
  l: '##. ##. ##. ##. ##. ##. ##. ##. .##',
  m: '2:#########. ##..##..## ##..##..## ##..##..## ##..##..## ##..##..## ##..##..##',
  n: '2:#####. ##..## ##..## ##..## ##..## ##..## ##..##',
  o: '2:.####. ##..## ##..## ##..## ##..## ##..## .####.',
  p: '2:#####. ##..## ##..## ##..## ##..## ##..## #####. ##.... ##....',
  q: '2:.##### ##..## ##..## ##..## ##..## ##..## .##### ....## ....##',
  r: '2:##.## ####. ###.. ##... ##... ##... ##...',
  s: '2:.##### ##.... ###... .####. ...### ....## #####.',
  t: '1:##.. #### ##.. ##.. ##.. ##.. ##.. .###',
  u: '2:##..## ##..## ##..## ##..## ##..## ##..## .#####',
  v: '2:##..## ##..## ##..## ##..## ##..## .####. ..##..',
  w: '2:##..##..## ##..##..## ##..##..## ##..##..## ##..##..## ##..##..## .########.',
  x: '2:##..## ##..## .####. ..##.. .####. ##..## ##..##',
  y: '2:##..## ##..## ##..## ##..## ##..## ##..## .##### ....## .####.',
  z: '2:###### ....## ...##. ..##.. .##... ##.... ######',

  '0': '.####. ##..## ##..## ##..## ##..## ##..## ##..## ##..## .####.',
  '1': '..##.. .###.. ####.. ..##.. ..##.. ..##.. ..##.. ..##.. ######',
  '2': '.####. ##..## ....## ....## ...##. ..##.. .##... ##.... ######',
  '3': '.####. ##..## ....## ....## ..###. ....## ....## ##..## .####.',
  '4': '...### ..#### .##.## ##..## ##..## ###### ....## ....## ....##',
  '5': '###### ##.... ##.... #####. ....## ....## ....## ##..## .####.',
  '6': '..###. .##... ##.... #####. ##..## ##..## ##..## ##..## .####.',
  '7': '###### ....## ....## ...##. ...##. ..##.. ..##.. ..##.. ..##..',
  '8': '.####. ##..## ##..## ##..## .####. ##..## ##..## ##..## .####.',
  '9': '.####. ##..## ##..## ##..## .##### ....## ....## ...##. .###..',

  '!': '## ## ## ## ## ## .. ## ##',
  '"': '##.## ##.##',
  '#': '1:.##.##. ####### .##.##. .##.##. ####### .##.##. .##.##.',
  $: '..##.. .####. ##..## ##.... .####. ....## ##..## .####. ..##..',
  '%': '1:##...## ##..##. ...##.. ...##.. ..##... ..##... .##..## ##...##',
  '&': '.###... ##.##.. ##.##.. .###... .###.## ##.###. ##..##. ##.###. .###.##',
  "'": '## ## ##',
  '(': '..## .##. ##.. ##.. ##.. ##.. ##.. ##.. .##. ..##',
  ')': '##.. .##. ..## ..## ..## ..## ..## ..## .##. ##..',
  '*': '1:.#..#. ..##.. ###### ..##.. .#..#.',
  '+': '2:..##.. ..##.. ###### ###### ..##.. ..##..',
  ',': '7:## ## .# #.',
  '-': '5:#####',
  '.': '7:## ##',
  '/': '....## ....## ...##. ...##. ..##.. .##... .##... ##.... ##....',
  ':': '2:## ## .. .. .. ## ##',
  ';': '2:## ## .. .. .. ## ## .# #.',
  '<': '1:...## ..##. .##.. ##... .##.. ..##. ...##',
  '=': '3:###### ...... ...... ######',
  '>': '1:##... .##.. ..##. ...## ..##. .##.. ##...',
  '?': '.####. ##..## ....## ...##. ..##.. ..##.. ...... ..##.. ..##..',
  '@': '1:.#####. ##...## ##.#### ##.#.## ##.#### ##..... .#####.',
  '[': '#### ##.. ##.. ##.. ##.. ##.. ##.. ##.. ##.. ####',
  ']': '#### ..## ..## ..## ..## ..## ..## ..## ..## ####',
  '\\': '##.... ##.... .##... .##... ..##.. ...##. ...##. ....## ....##',
  '^': '..##.. .####. ##..##',
  _: '10:######',
  '`': '##. .##',
  '{': '..## .##. .##. .##. ##.. .##. .##. .##. .##. ..##',
  '|': '## ## ## ## ## ## ## ## ## ## ##',
  '}': '##.. .##. .##. .##. ..## .##. .##. .##. .##. ##..',
  '~': '3:.###.## ##.###.',

  '’': '## ## .# #.',
  '‘': '.# #. ## ##',
  '“': '.#..# #..#. ##.## ##.##',
  '”': '##.## ##.## .#..# #..#.',
  '–': '5:######',
  '—': '5:##########',
  '…': '7:##.##.## ##.##.##',
  '·': '4:## ##',
  '•': '3:.##. #### #### .##.',
  '×': '2:##..## .####. ..##.. .####. ##..##',
  '°': '.##. #..# #..# .##.',
  '¿': '2:..##.. ..##.. ...... ..##.. .##... ##.... ##..## .####.',
  '¡': '2:## ## .. ## ## ## ## ## ##',
  ß: '.####. ##..## ##..## ##.##. ##.##. ##..## ##..## ##..## ##.##.',
  ø: '1:......# .#####. ##..### ##.#.## ##.#.## ###..## ##...## .#####. #......',
  Ø: '.#####.# ##...### ##..#.## ##..#.## ##.#..## ##.#..## ###...## ##...## #.#####.',
  ı: '2:## ## ## ## ## ## ##',

  // ── Interface symbols ────────────────────────────────────────────────────
  '▶': '1:##..... ####... ######. ####### ######. ####... ##.....',
  '⏸': '1:##.## ##.## ##.## ##.## ##.## ##.## ##.##',
  '■': '2:###### ###### ###### ###### ######',
  '›': '1:##... .##.. ..##. ...## ..##. .##.. ##...',
  '‹': '1:...## ..##. .##.. ##... .##.. ..##. ...##',
  '♪': '...##.. ...###. ...##.# ...##.# ...##.. .####.. ######. ######. .####..',
  '🔒': '..###.. .##.##. .#...#. .#...#. ####### ###.### ###.### ####### #######',
  '🔈': '1:...# ..## #### #### #### ..## ...#',
  '🔊': '......#.. ...#...#. ..##.#..# ####..#.# ####..#.# ####..#.# ..##.#..# ...#...#. ......#..',
  '●': '2:.###. ##### ##### ##### .###.',
  '✓': '2:......## .....##. ##..##.. .####... ..##....',
  '⇄': '1:....##. ######## ....##. ....... .##.... ######## .##....',
  '↻': '1:.####.# ##..### ##.#### ##..... ##....# ##...## .#####.',
};

const SMALL: Table = {
  A: '.##. #..# #..# #..# #### #..# #..#',
  B: '###. #..# #..# ###. #..# #..# ###.',
  C: '.##. #..# #... #... #... #..# .##.',
  D: '###. #..# #..# #..# #..# #..# ###.',
  E: '#### #... #... ###. #... #... ####',
  F: '#### #... #... ###. #... #... #...',
  G: '.##. #..# #... #.## #..# #..# .###',
  H: '#..# #..# #..# #### #..# #..# #..#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '...# ...# ...# ...# ...# #..# .##.',
  K: '#..# #..# #.#. ##.. #.#. #..# #..#',
  L: '#... #... #... #... #... #... ####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# ##..# #.#.# #..## #...# #...# #...#',
  O: '.##. #..# #..# #..# #..# #..# .##.',
  P: '###. #..# #..# ###. #... #... #...',
  Q: '.##. #..# #..# #..# #..# #..# .##. ...#',
  R: '###. #..# #..# ###. #.#. #..# #..#',
  S: '.### #... #... .##. ...# ...# ###.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#..# #..# #..# #..# #..# #..# .##.',
  V: '#...# #...# #...# .#.#. .#.#. .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '#### ...# ..#. ..#. .#.. #... ####',

  a: '2:.##. ...# .### #..# .###',
  b: '#... #... ###. #..# #..# #..# ###.',
  c: '2:.## #.. #.. #.. .##',
  d: '...# ...# .### #..# #..# #..# .###',
  e: '2:.##. #..# #### #... .###',
  f: '.## #.. ### #.. #.. #.. #..',
  g: '2:.### #..# #..# .### ...# .##.',
  h: '#... #... ###. #..# #..# #..# #..#',
  i: '# . # # # # #',
  j: '.# .. .# .# .# .# .# .# #.',
  k: '#... #... #..# #.#. ##.. #.#. #..#',
  l: '#. #. #. #. #. #. .#',
  m: '2:####. #.#.# #.#.# #.#.# #.#.#',
  n: '2:###. #..# #..# #..# #..#',
  o: '2:.##. #..# #..# #..# .##.',
  p: '2:###. #..# #..# #..# ###. #... #...',
  q: '2:.### #..# #..# #..# .### ...# ...#',
  r: '2:#.## ##.. #... #... #...',
  s: '2:.### #... .##. ...# ###.',
  t: '1:#.. ### #.. #.. #.. .##',
  u: '2:#..# #..# #..# #..# .###',
  v: '2:#...# #...# .#.#. .#.#. ..#..',
  w: '2:#...# #...# #.#.# #.#.# .#.#.',
  x: '2:#...# .#.#. ..#.. .#.#. #...#',
  y: '2:#..# #..# #..# #..# .### ...# .##.',
  z: '2:#### ..#. .#.. #... ####',

  '0': '.##. #..# #..# #..# #..# #..# .##.',
  '1': '.#. ##. .#. .#. .#. .#. ###',
  '2': '.##. #..# ...# ..#. .#.. #... ####',
  '3': '###. ...# ...# .##. ...# ...# ###.',
  '4': '..#. .##. #.#. #.#. #### ..#. ..#.',
  '5': '#### #... ###. ...# ...# #..# .##.',
  '6': '.##. #... #... ###. #..# #..# .##.',
  '7': '#### ...# ..#. ..#. .#.. .#.. .#..',
  '8': '.##. #..# #..# .##. #..# #..# .##.',
  '9': '.##. #..# #..# .### ...# ...# .##.',

  '!': '# # # # # . #',
  '"': '#.# #.#',
  '#': '1:.#.#. ##### .#.#. ##### .#.#.',
  $: '.#. .## #.. .#. ..# ##. .#.',
  '%': '1:##..# ##.#. ..#.. .#.## #..##',
  '&': '.#.. #.#. #.#. .#.. #.## #..# .##.',
  "'": '# #',
  '(': '.# #. #. #. #. #. .#',
  ')': '#. .# .# .# .# .# #.',
  '*': '1:#.# .#. #.#',
  '+': '2:.#. ### .#.',
  ',': '6:# # ',
  '-': '4:###',
  '.': '6:#',
  '/': '...# ...# ..#. .#.. .#.. #... #...',
  ':': '2:# . . #',
  ';': '2:.# .. .. .# #.',
  '<': '1:..# .#. #.. .#. ..#',
  '=': '2:### ... ###',
  '>': '1:#.. .#. ..# .#. #..',
  '?': '.##. #..# ...# ..#. .#.. .... .#..',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  '[': '## #. #. #. #. #. ##',
  ']': '## .# .# .# .# .# ##',
  '\\': '#... #... .#.. .#.. ..#. ...# ...#',
  '^': '.#. #.#',
  _: '8:####',
  '`': '#. .#',
  '{': '.# #. #. ## #. #. .#',
  '|': '# # # # # # # #',
  '}': '#. .# .# ## .# .# #.',
  '~': '2:.#.# #.#.',

  '’': '.# .# #.',
  '‘': '.# #. #.',
  '“': '.#.# #.#. #.#.',
  '”': '.#.# .#.# #.#.',
  '–': '4:####',
  '—': '4:######',
  '…': '6:#.#.#',
  '·': '3:#',
  '•': '2:.#. ### .#.',
  '×': '2:#.# .#. #.#',
  '°': '.#. #.# .#.',
  '¿': '2:..#. .... ..#. .#.. #... #..# .##.',
  '¡': '2:# . # # # # #',
  ß: '.##. #..# #.#. #.#. #..# #..# #.#.',
  ø: '1:...# .##. #.## #..# ##.# .##. #...',
  Ø: '.##.# #..#. #.#.# #.#.# #.#.# .#..# #.##.',
  ı: '2:# # # # #',

  '▶': '1:#... ##.. ###. ##.. #...',
  '⏸': '1:#.# #.# #.# #.# #.#',
  '■': '2:#### #### #### ####',
  '›': '1:#.. .#. ..# .#. #..',
  '‹': '1:..# .#. #.. .#. ..#',
  '♪': '..#.. ..##. ..#.# ..#.. ###.. ###..',
  '🔒': '.###. #...# #...# ##### ##.## ##.## #####',
  '🔈': '1:..# .## ### .## ..#',
  '🔊': '..#..#. .##.#.# ###.#.# .##.#.# ..#..#.',
  '●': '2:.#. ### .#.',
  '✓': '2:....# ...#. #.#.. .#...',
  '⇄': '1:...#. ##### ...#. .#... ##### .#...',
  '↻': '1:.##.# #..## #.... #...# .###.',
};

// ── Marks for composed letters ───────────────────────────────────────────────

const MARKS_BOLD: Record<string, string> = {
  [cc(0x300)]: '##. .##', // grave
  [cc(0x301)]: '.## ##.', // acute
  [cc(0x302)]: '.##. #..#', // circumflex
  [cc(0x303)]: '.##.# #.##.', // tilde
  [cc(0x308)]: '##.##', // diaeresis
  [cc(0x30a)]: '.#. #.# .#.', // ring
  [cc(0x30c)]: '#.# .#.', // caron
  [cc(0x306)]: '#..# .##.', // breve
  [cc(0x304)]: '####', // macron
  [cc(0x30b)]: '.#.# #.#.', // double acute
};

const MARKS_SMALL: Record<string, string> = {
  [cc(0x300)]: '#. .#',
  [cc(0x301)]: '.# #.',
  [cc(0x302)]: '.#. #.#',
  [cc(0x303)]: '.#.# #.#.',
  [cc(0x308)]: '#.#',
  [cc(0x30a)]: '.#. #.# .#.',
  [cc(0x30c)]: '#.# .#.',
  [cc(0x306)]: '#..# .##.',
  [cc(0x304)]: '###',
  [cc(0x30b)]: '.#.# #.#.',
};

/** Marks that hang below the baseline instead of riding above. */
const CEDILLA_BOLD = '.##. ##..';
const CEDILLA_SMALL = '.# #.';

// ── The glyph model ──────────────────────────────────────────────────────────

export interface Glyph {
  /** Columns of ink, not counting the blank column after. */
  w: number;
  /** First row, relative to the cap line (may be negative for marks on capitals). */
  top: number;
  /** Rows of bits, top to bottom. */
  rows: boolean[][];
}

export interface Face {
  id: 'bold' | 'small';
  /** Rows from the cap line to the baseline. */
  cap: number;
  /** Row where x-height letters start. */
  xTop: number;
  /** Rows below the baseline. */
  desc: number;
  /** Blank columns between glyphs. */
  spacing: number;
  /** Advance of a space. */
  space: number;
  /** Advance every digit takes in tabular figures. */
  digit: number;
  glyphs: Map<string, Glyph>;
  marks: Record<string, Glyph>;
  cedilla: Glyph;
}

function parse(spec: string): Glyph {
  let top = 0;
  let body = spec;
  const m = /^(-?\d+):/.exec(spec);
  if (m) {
    top = Number(m[1]);
    body = spec.slice(m[0].length);
  }
  const rows = body
    .trim()
    .split(/\s+/)
    .map((r) => [...r].map((c) => c === '#'));
  const w = Math.max(0, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < w) r.push(false);
  return { w, top, rows };
}

/** Two glyphs overlapped on `overlap` shared columns: æ is a + e on one stem. */
function ligature(a: Glyph, b: Glyph, overlap: number): Glyph {
  const top = Math.min(a.top, b.top);
  const bottom = Math.max(a.top + a.rows.length, b.top + b.rows.length);
  const w = a.w + b.w - overlap;
  const rows: boolean[][] = [];
  for (let y = top; y < bottom; y++) {
    const row = new Array<boolean>(w).fill(false);
    const ra = a.rows[y - a.top];
    const rb = b.rows[y - b.top];
    if (ra) ra.forEach((on, x) => (row[x] ||= on));
    if (rb) rb.forEach((on, x) => (row[x + a.w - overlap] ||= on));
    rows.push(row);
  }
  return { w, top, rows };
}

function build(id: Face['id'], table: Table, marks: Record<string, string>, cedilla: string): Face {
  const glyphs = new Map<string, Glyph>();
  for (const [ch, spec] of Object.entries(table)) glyphs.set(ch, parse(spec));
  const lap = id === 'bold' ? 2 : 1;
  glyphs.set('æ', ligature(glyphs.get('a')!, glyphs.get('e')!, lap));
  glyphs.set('Æ', ligature(glyphs.get('A')!, glyphs.get('E')!, lap));
  glyphs.set('œ', ligature(glyphs.get('o')!, glyphs.get('e')!, lap));
  glyphs.set('Œ', ligature(glyphs.get('O')!, glyphs.get('E')!, lap));
  const parsedMarks: Record<string, Glyph> = {};
  for (const [k, v] of Object.entries(marks)) parsedMarks[k] = parse(v);
  const cap = id === 'bold' ? 9 : 7;
  const digit = Math.max(...'0123456789'.split('').map((d) => glyphs.get(d)!.w));
  return {
    id,
    cap,
    xTop: 2,
    desc: id === 'bold' ? 3 : 2,
    spacing: 1,
    space: id === 'bold' ? 4 : 3,
    digit,
    glyphs,
    marks: parsedMarks,
    cedilla: parse(cedilla),
  };
}

export const Bold = build('bold', BOLD, MARKS_BOLD, CEDILLA_BOLD);
export const Small = build('small', SMALL, MARKS_SMALL, CEDILLA_SMALL);

// ── Folding: any string to glyphs the face has ───────────────────────────────

const FOLD: Record<string, string> = {
  "'": '’',
  '`': '‘',
  'ʼ': '’',
  '′': '’',
  '″': '”',
  '„': '“',
  '‚': ',',
  '«': '‹',
  '»': '›',
  '‐': '-',
  '‑': '-',
  '−': '-',
  '―': '—',
  '∙': '·',
  '⋅': '·',
  [cc(0xa0)]: ' ',
  [cc(0x2009)]: ' ',
  [cc(0x202f)]: ' ',
  '\t': ' ',
  ð: 'd',
  Ð: 'D',
  đ: 'd',
  Đ: 'D',
  þ: 'p',
  Þ: 'P',
  ł: 'l',
  Ł: 'L',
  ħ: 'h',
  Ħ: 'H',
  ŋ: 'n',
  '★': '*',
  '☆': '*',
  '♫': '♪',
  '♬': '♪',
  '♩': '♪',
  '►': '▶',
  '▸': '▶',
  '❚': '⏸',
};

const composed = new Map<string, Glyph | null>();

/** An accented letter: the base glyph, a mark centred over (or under) it. */
function compose(face: Face, ch: string): Glyph | null {
  const key = `${face.id}${ch}`;
  if (composed.has(key)) return composed.get(key)!;
  let out: Glyph | null = null;
  const nfd = ch.normalize('NFD');
  const baseCh = nfd[0];
  const marks = [...nfd.slice(1)];
  // An i or j under a mark loses its dot.
  const base =
    baseCh === 'i' && marks.length ? face.glyphs.get('ı') : baseCh === 'j' && marks.length ? face.glyphs.get('j') : face.glyphs.get(baseCh);
  if (base && marks.length) {
    let g: Glyph = { w: base.w, top: base.top, rows: base.rows.map((r) => r.slice()) };
    for (const m of marks) {
      if (m === cc(0x327) || m === cc(0x328)) {
        g = place(g, face.cedilla, face.cap); // under the baseline
        continue;
      }
      const mark = face.marks[m];
      if (!mark) continue;
      const above = g.top - mark.rows.length - 1;
      g = place(g, mark, above);
    }
    out = g;
  } else if (base) {
    out = base;
  }
  composed.set(key, out);
  return out;
}

/** Stamp `mark` onto `g` with its first row at `row`, centred. */
function place(g: Glyph, mark: Glyph, row: number): Glyph {
  const x0 = Math.floor((g.w - mark.w) / 2);
  const top = Math.min(g.top, row);
  const bottom = Math.max(g.top + g.rows.length, row + mark.rows.length);
  const w = Math.max(g.w, mark.w);
  const rows: boolean[][] = [];
  for (let y = top; y < bottom; y++) {
    const r = new Array<boolean>(w).fill(false);
    g.rows[y - g.top]?.forEach((on, x) => (r[x] ||= on));
    mark.rows[y - row]?.forEach((on, x) => {
      const xx = x + Math.max(0, x0);
      if (xx < w) r[xx] ||= on;
    });
    rows.push(r);
  }
  return { w, top, rows };
}

const BOX: Record<Face['id'], Glyph> = {
  bold: parse('1:##### #...# #...# #...# #...# #...# #####'),
  small: parse('1:### #.# #.# #.# ###'),
};

export function glyphFor(face: Face, ch: string): Glyph | null {
  if (ch === ' ') return null;
  const direct = face.glyphs.get(ch);
  if (direct) return direct;
  const folded = FOLD[ch];
  if (folded !== undefined) return folded === ' ' ? null : glyphFor(face, folded);
  const c = compose(face, ch);
  if (c) return c;
  const plain = ch.normalize('NFD').replace(COMBINING, '');
  if (plain && plain !== ch && plain.length === 1) return glyphFor(face, plain);
  if (/\s/.test(ch)) return null;
  return BOX[face.id];
}

export interface TextOpts {
  /** Every digit takes the same advance, so a ticking clock doesn't shuffle. */
  tabular?: boolean;
}

function advance(face: Face, ch: string, g: Glyph | null, opts?: TextOpts): number {
  if (!g) return face.space;
  if (opts?.tabular && ch >= '0' && ch <= '9') return face.digit + face.spacing;
  return g.w + face.spacing;
}

/** Width in pixels, without the trailing blank column. */
export function measure(face: Face, text: string, opts?: TextOpts): number {
  let w = 0;
  for (const ch of text) w += advance(face, ch, glyphFor(face, ch), opts);
  return Math.max(0, w - face.spacing);
}

/**
 * Walk the text, calling `plot` for every inked pixel. `x` is the left edge,
 * `y` the cap line. Returns the pen position after the last glyph.
 */
export function layout(
  face: Face,
  text: string,
  x: number,
  y: number,
  plot: (px: number, py: number) => void,
  opts?: TextOpts,
): number {
  let pen = x;
  for (const ch of text) {
    const g = glyphFor(face, ch);
    const adv = advance(face, ch, g, opts);
    if (g) {
      const dx = opts?.tabular && ch >= '0' && ch <= '9' ? Math.floor((face.digit - g.w) / 2) : 0;
      for (let r = 0; r < g.rows.length; r++) {
        const row = g.rows[r];
        for (let c = 0; c < row.length; c++) if (row[c]) plot(pen + dx + c, y + g.top + r);
      }
    }
    pen += adv;
  }
  return pen;
}

/** Cut a string to fit `width`, ending in an ellipsis if anything was lost. */
export function fit(face: Face, text: string, width: number): string {
  if (measure(face, text) <= width) return text;
  const chars = [...text];
  while (chars.length && measure(face, `${chars.join('').trimEnd()}…`) > width) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}
