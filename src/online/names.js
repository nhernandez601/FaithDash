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
  'erection', 'fellatio', 'cunnilingus', 'clitoris', 'genital', 'testicle', 'scrotum', 'crotch', 'jackoff', 'jerkoff',
  'masturb', 'queef', 'rimjob', 'buttplug', 'buttsex', 'nutsack', 'ballsack', 'boner', 'stripper',
  'adolf', 'heil', 'holocaust', 'auschwitz', 'reich', 'himmler', 'goebbels', 'mengele', 'mussolini', 'stalin', 'gestapo',
  'swastika', 'whitepower', 'whitepride', 'aryannation', 'binladen', 'alqaeda', 'taliban', 'jihadi',
  'dahmer', 'columbine', 'schoolshoot', 'massshoot', 'terroris', 'suicide', 'genocide',
  'satan', 'lucifer', 'antichrist', 'beelzebub', 'godisdead', 'jesussuck', 'godsuck',
];
// blocked only as a whole word
export const WORDS = [
  'ass', 'azz', 'arse', 'cum', 'semen', 'tit', 'tits', 'titty', 'anal', 'anus', 'sex', 'rape', 'raped', 'cock', 'pedo',
  'hoe', 'hoes', 'thot', 'fag', 'fags', 'homo', 'lesbo', 'dyke', 'coon', 'gook', 'spic', 'wop', 'jap', 'paki', 'beaner',
  'nig', 'nigs', 'spaz', 'prick', 'crap', 'hell', 'kys', 'wtf', 'stfu', 'nsfw', 'meth', 'weed', 'milf',
  'butt', 'butts', 'clit', 'isis', 'kkk', 'ss', 'nsdap', 'schlong', 'pecker', 'spunk', 'hooker', 'lynching',
];
// joke names that SOUND like something rude ("Hugh Jass" = huge ass, "Mike Hunt", "Ben Dover"...) and a few names that
// are inappropriate however they are spelled. Matched anywhere with spaces removed, and LOOSELY: any vowel can stand
// for any vowel, s/z are the same, c/k/q are the same, and letters may repeat ("Hugh Jas", "Seymore Butt", "Mo Lester").
// Every entry is at least 6 letters (tested): short ones match too many normal words when matched loosely.
export const JOKES = [
  'hughjass', 'hewjass', 'hughjanus', 'hughmungus', 'hughgrection', 'hugerection', 'hughgass',
  'mikehunt', 'mikeoxlong', 'mikerotch', 'mikelitoris', 'mikehawk',
  'bendover', 'eileendover', 'bentover', 'philmccracken', 'philmcrack', 'phillatio', 'connilingus',
  'seymourbutt', 'seemorebutt', 'amandahugginkiss', 'heywoodjablowme', 'haywoodjablome', 'jablowme', 'jablome',
  'jackmehoff', 'jackmeoff', 'dixienormous', 'ivanatinkle', 'harryballs',
  'hairyballs', 'opheliaballs', 'cravenmoorehead', 'clothesoff', 'tesstickle', 'moelester',
  'mcockiner', 'ballsdeep', 'suckmydick', 'eatmyshort',
  'hitler', 'heilhitler', 'siegheil', 'lucifer',
];
// number codes used by hate groups (checked on the name as typed, before numbers are read as letters)
export const CODES = ['1488', '14 88', '666', '6 6 6'];
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
// loose ("sounds like") pattern: vowels are interchangeable, s=z, c=k=q, every letter may repeat. The generator writes
// these exact patterns into the database, so both sides match the same way.
export function loosePattern(w) {
  const cls = (c) => (/[aeiouy]/.test(c) ? '[aeiouy]+' : /[sz]/.test(c) ? '[sz]+' : /[ckq]/.test(c) ? '[ckq]+' : c + '+');
  const parts = w.split('').map(cls);
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join('');
}
const RX_JOKES = JOKES.map((w) => new RegExp(loosePattern(w)));
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
  const typed = name.toLowerCase().replace(/[_.\-]/g, ' ');
  if (CODES.some((c) => typed.includes(c) || typed.replace(/ /g, '').includes(c.replace(/ /g, '')))) return true;
  const all = readings(name);
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const compact = r.replace(/[^a-z]/g, '');
    const words = r.split(/[^a-z]+/).filter(Boolean);
    words.push(compact);
    if (RX_PARTS.some((rx) => rx.test(compact))) return true;
    if (RX_JOKES.some((rx) => rx.test(compact))) return true;
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
