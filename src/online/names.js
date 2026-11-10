// Gamer-name filter. The SAME rules run in the database (supabase/leaderboard.sql + supabase/badwords.sql, generated from
// this file by scripts/gen-badwords-sql.mjs), so a name the game blocks is also refused by the server, and the other way.
//
// How a name is checked:
//  1. Only letters, numbers, spaces and _ . - are allowed, 3-16 characters.
//  2. CamelCase is split into words ("BigAss" -> "big ass").
//  3. Numbers that stand in for letters are decoded, in several readings:
//       0=o 1=i 2=z 3=e 4=a 5=s 6=g 7=t 8=b 9=g   (also 1=l, l=i, y=i, v=u, ph=f, q=k, ck=k)
//  4. Each reading is checked three ways:
//       PARTS: blocked anywhere, even inside other words, with spaces/dots removed; letters may be repeated
//              ("F.u.u.u.c.k" -> "fuck", "sh1t" -> "shit", "n1gg4" -> "nigga").
//       WORDS: blocked only as a whole word, because they hide inside harmless words ("ass" in "class", "cum" in
//              "document", "rape" in "grape"). Also checked with every space removed ("c u m").
//       ENDINGS: a word ending in "ass" is blocked ("dumbass", "b1g4ss") unless it is a normal word ending in
//              "ass" (class, grass, bass, compass...).

// blocked anywhere in the name
export const PARTS = [
  'fuck', 'fuk', 'fuq', 'fck', 'fcuk', 'phuk', 'motherf', 'shit', 'bitch', 'biatch', 'btch', 'cunt', 'kunt', 'twat', 'wank',
  'nigg', 'nigga', 'niger', 'negro', 'faggot', 'slut', 'whore', 'pussy', 'dick', 'penis', 'vagina', 'dildo', 'porn',
  'boob', 'jizz', 'cumshot', 'orgasm', 'blowjob', 'handjob', 'horny', 'hentai', 'sexy', 'nude', 'erotic', 'rapist',
  'molest', 'pedophil', 'paedo', 'cocksuck', 'asshole', 'arsehole', 'asshat', 'asswipe', 'assface', 'asslick', 'bastard',
  'bollock', 'douche', 'piss', 'damn', 'goddam', 'nazi', 'hitler', 'kkk', 'retard', 'kike', 'chink', 'wetback',
  'tranny', 'towelhead', 'raghead', 'killyourself', 'cocaine', 'xxx',
];
// blocked only as a whole word
export const WORDS = [
  'ass', 'azz', 'arse', 'cum', 'semen', 'tit', 'tits', 'titty', 'anal', 'anus', 'sex', 'rape', 'raped', 'cock', 'pedo',
  'hoe', 'hoes', 'thot', 'fag', 'fags', 'homo', 'lesbo', 'dyke', 'coon', 'gook', 'spic', 'wop', 'jap', 'paki', 'beaner',
  'nig', 'nigs', 'spaz', 'prick', 'crap', 'hell', 'kys', 'wtf', 'stfu', 'nsfw', 'meth', 'weed', 'milf',
];
// harmless words that end in "ass"
export const ASS_OK = [
  'bass', 'class', 'glass', 'grass', 'mass', 'pass', 'brass', 'lass', 'sass', 'crass', 'compass', 'surpass', 'embarrass',
  'harass', 'morass', 'carcass', 'amass', 'bypass', 'overpass', 'impass', 'trespass', 'cutlass',
];

const DIGITS = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };
const tr = (s, map) => s.replace(/./g, (c) => (map[c] !== undefined ? map[c] : c));
// a blocked word as a pattern where every letter may be repeated ("fuck" also matches "fuuuck", "boob" needs 2 o's
// so "bob" is fine). The database builds the exact same pattern.
export const pattern = (w) => w.split('').map((c) => c + '+').join('');
const squeeze = (s) => s.replace(/(.)\1{2,}/g, '$1$1');      // "asssss" -> "ass"
const RX_PARTS = PARTS.map((p) => new RegExp(pattern(p)));
const RX_WORDS = WORDS.map((w) => new RegExp('^' + pattern(w) + '$'));
// the different ways a name could be read (each keeps its spaces, so words can still be found)
export function readings(name) {
  const base = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_.\-]/g, ' ');
  const a = tr(base, DIGITS);
  return [
    a,
    tr(base, { ...DIGITS, 1: 'l' }),
    a.replace(/l/g, 'i').replace(/y/g, 'i'),
    a.replace(/v/g, 'u').replace(/ph/g, 'f').replace(/q/g, 'k').replace(/ck/g, 'k'),
  ];
}
// true when the name (already in the allowed character set) contains something blocked
export function isBlocked(name) {
  const all = readings(name);
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const compact = r.replace(/[^a-z]/g, '');
    const words = r.split(/[^a-z]+/).filter(Boolean);
    words.push(compact);
    if (RX_PARTS.some((rx) => rx.test(compact))) return true;
    for (const w of words) {
      if (RX_WORDS.some((rx) => rx.test(w))) return true;
      const sw = squeeze(w);
      // (only the plain number readings: the l->i reading would turn "glass" into "giass")
      if (i < 2 && sw.endsWith('ass') && !ASS_OK.some((ok) => sw.endsWith(ok))) return true;
    }
  }
  return false;
}

export function checkName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return { ok: false, error: 'At least 3 letters or numbers.' };
  if (name.length > 16) return { ok: false, error: 'At most 16 characters.' };
  if (!/^[A-Za-z0-9 _.\-]+$/.test(name)) return { ok: false, error: 'Letters, numbers, spaces, _ . - only.' };
  if (!/[A-Za-z]/.test(name)) return { ok: false, error: 'Use at least one letter.' };
  if (isBlocked(name)) return { ok: false, error: 'That name is not allowed. Please pick a different one.' };
  return { ok: true, name };
}
