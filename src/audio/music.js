// Faith Dash — beat maps. Pure data helpers (no DOM, no audio), so the level generator and the tests can use them too.
//
// Both songs were time-corrected to a steady 130 BPM, so beat i is at exactly i * spb seconds from the start of the file
// and a 16th-note "slot" s is at s * spb / 4. That is what lets the game place an obstacle on a real drum hit.
import { BEATMAPS } from './beatmaps.js';

const hexVals = (s) => Uint8Array.from(s, (c) => parseInt(c, 16));
const b64 = (s) => {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

export class BeatMap {
  constructor(raw) {
    this.id = raw.id; this.title = raw.title; this.url = raw.url;
    this.bpm = raw.bpm; this.spb = 60 / raw.bpm;
    this.nBeats = raw.nBeats; this.down = raw.down; this.endBeat = raw.endBeat; this.duration = raw.duration;
    this.sections = raw.sections; this.drops = raw.drops;
    this.low = hexVals(raw.low); this.mid = hexVals(raw.mid); this.hi = hexVals(raw.hi);   // 0..15 per 16th note
    this.inten = Uint8Array.from(raw.inten, (c) => Number(c));                               // 0..9 per beat
    this.env = b64(raw.env); this.envStep = raw.envStep;                                    // [low,mid,hi] bytes per envStep
    this.envN = Math.floor(this.env.length / 3);
    this.sig = hashStr(raw.low + raw.mid + raw.inten + raw.nBeats + raw.endBeat);
  }
  // how hard the music hits on 16th-note slot s (0..1): the loudest of kick/bass, snare/lead and hats
  strength(s) {
    if (s < 0 || s >= this.low.length) return 0;
    return Math.max(this.low[s], this.mid[s] * 0.85, this.hi[s] * 0.6) / 15;
  }
  lowAt(s) { return s >= 0 && s < this.low.length ? this.low[s] / 15 : 0; }
  slotTime(s) { return (s * this.spb) / 4; }
  beatTime(i) { return i * this.spb; }
  // position inside the 4-beat bar, 0..4 (0 = the bar's first beat)
  barPos(t) { const b = t / this.spb - this.down; return ((b % 4) + 4) % 4; }
  intensityAt(t) {
    const b = Math.max(0, t / this.spb - 0.5), i = Math.floor(b), f = b - i;
    const a = this.inten[Math.min(i, this.inten.length - 1)] / 9, c = this.inten[Math.min(i + 1, this.inten.length - 1)] / 9;
    return a + (c - a) * f;
  }
  // 'intro' | 'build' | 'drop' | 'groove' | 'calm' | 'outro'
  kindAtBeat(beat) {
    let k = 'intro';
    for (const s of this.sections) { if (s.beat <= beat) k = s.kind; else break; }
    return k;
  }
  // band energies 0..1 at time t
  envAt(t, out) {
    out = out || { low: 0, mid: 0, hi: 0 };
    const x = Math.max(0, t / this.envStep), i = Math.floor(x), f = x - i;
    if (i + 1 >= this.envN) { out.low = out.mid = out.hi = 0; return out; }
    const e = this.env, o0 = i * 3, o1 = o0 + 3;
    out.low = (e[o0] + (e[o1] - e[o0]) * f) / 255;
    out.mid = (e[o0 + 1] + (e[o1 + 1] - e[o0 + 1]) * f) / 255;
    out.hi = (e[o0 + 2] + (e[o1 + 2] - e[o0 + 2]) * f) / 255;
    return out;
  }
  // a crisp "kick" pulse: jumps to the hit's strength on a strong low hit and decays quickly
  kickAt(t) {
    const s0 = Math.floor((t / this.spb) * 4);
    for (let k = 0; k < 8; k++) {
      const w = this.lowAt(s0 - k);
      if (w >= 0.45) return w * Math.exp(-(t - this.slotTime(s0 - k)) * 9);
    }
    return 0;
  }
  snareAt(t) {
    const s0 = Math.floor((t / this.spb) * 4);
    for (let k = 0; k < 6; k++) {
      const s = s0 - k;
      if (s >= 0 && s < this.mid.length && this.mid[s] / 15 >= 0.55 && this.low[s] / 15 < 0.9) return (this.mid[s] / 15) * Math.exp(-(t - this.slotTime(s)) * 11);
    }
    return 0;
  }
  // 1 right at the start of a drop, fading over about a second
  dropFlashAt(t) {
    const b = t / this.spb;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (this.drops[i] <= b) { const age = (b - this.drops[i]) * this.spb; return age < 2.2 ? Math.exp(-age * 2.6) : 0; }
    }
    return 0;
  }
  // "Colour trigger" level at time t, 0..1: 0 in calm parts, rising through a build-up, full on a drop, part-way in a
  // groove. Like the colour triggers a level editor places at fixed spots, except they come from the song's own sections.
  // Every change is blended over one beat so the colour slides instead of jumping.
  heatAt(t) {
    const beat = t / this.spb, S = this.sections;
    if (!S.length || beat < S[0].beat) return 0;
    let i = 0; while (i + 1 < S.length && S[i + 1].beat <= beat) i++;
    const end = i + 1 < S.length ? S[i + 1].beat : this.nBeats;
    const val = (k, f) => (k === 'drop' ? 1 : k === 'groove' ? 0.45 : k === 'build' ? 0.65 * f * f : 0);
    const here = val(S[i].kind, Math.min(1, (beat - S[i].beat) / Math.max(1, end - S[i].beat)));
    if (i === 0 || beat - S[i].beat >= 1) return here;
    const pe = S[i].beat, ps = S[i - 1].beat;
    const before = val(S[i - 1].kind, 1 - 1 / Math.max(1, pe - ps));
    const f = beat - S[i].beat;
    // a drop hits at once (the flash covers it); everything else glides over the beat
    return S[i].kind === 'drop' ? here : before + (here - before) * f;
  }
  // bar-line beat indices (the first beat of every bar)
  barBeats() { const out = []; for (let b = this.down; b < this.endBeat; b += 4) out.push(b); return out; }
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

const cache = {};
export function getBeatMap(id) {
  if (!cache[id]) {
    if (!BEATMAPS[id]) throw new Error('No beat map for song ' + id);
    cache[id] = new BeatMap(BEATMAPS[id]);
  }
  return cache[id];
}
export const SONG_IDS = Object.keys(BEATMAPS);

// ---------------------------------------------------------------- jump cues
// Which musical hits may become the take-off point of an obstacle, per difficulty tier.
//   easy   — every strong hit that lands ON the beat
//   medium — every on-beat hit, and strong "and" (off-beat 8th) hits
//   hard   — adds weaker 8ths and strong syncopated 16ths
export const TIERS = ['easy', 'medium', 'hard'];
export function cueCandidates(map, tier) {
  const out = [];
  const n16 = map.low.length;
  for (let s = 0; s < n16; s++) {
    const beat = s >> 2, sub = s & 3;
    if (beat >= map.endBeat - 6) break;
    const w = map.strength(s);
    const bib = (((beat - map.down) % 4) + 4) % 4;
    let ok = false;
    // v6.2: denser for every tier (easy now uses every strong on-beat hit, not just beats 1 and 3)
    if (tier === 'easy') ok = sub === 0 && w >= 0.42;
    else if (tier === 'medium') ok = (sub === 0 && w >= 0.35) || (sub === 2 && w >= 0.48);
    else ok = (sub === 0 && w >= 0.3) || (sub === 2 && w >= 0.4) || ((sub === 1 || sub === 3) && w >= 0.62);
    if (ok) out.push({ s, t: map.slotTime(s), w });
  }
  return out;
}
