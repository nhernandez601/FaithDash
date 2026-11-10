// The coin-gate questions (src/three/trivia.js): every question is well formed, the deck deals each one once before any
// repeat, and shuffling the choices never loses track of the right answer.
import { TRIVIA, triviaDeck } from '../src/three/trivia.js';
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('FAIL - ' + msg); } };

check(TRIVIA.length === 28, `28 questions from the quiz (got ${TRIVIA.length})`);
TRIVIA.forEach((t, i) => {
  check(typeof t.q === 'string' && t.q.length > 10, `Q${i + 1} has text`);
  check(Array.isArray(t.c) && (t.c.length === 2 || t.c.length === 4), `Q${i + 1} has 2 or 4 choices`);
  check(Number.isInteger(t.a) && t.a >= 0 && t.a < t.c.length, `Q${i + 1} answer index points at a choice`);
  check(new Set(t.c).size === t.c.length, `Q${i + 1} choices are all different`);
});
// the answer key from the quiz sheet (1-28)
const KEY = 'F B B T B T B C A F T T B T B B B B B T B B B B B T F B'.split(' ');
TRIVIA.forEach((t, i) => {
  const want = KEY[i] === 'T' ? 'True' : KEY[i] === 'F' ? 'False' : null;
  if (want) check(t.c[t.a] === want, `Q${i + 1} answer is ${want}`);
  else check(t.a === 'ABCD'.indexOf(KEY[i]), `Q${i + 1} answer is ${KEY[i]}`);
});
let seed = 7; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const deal = triviaDeck(rand), seen = new Set();
for (let k = 0; k < TRIVIA.length; k++) {
  const q = deal(); seen.add(q.q);
  const src = TRIVIA.find((t) => t.q === q.q);
  check(q.choices[q.answer] === src.c[src.a], `dealt question keeps its right answer after shuffling: ${q.q.slice(0, 40)}`);
}
check(seen.size === TRIVIA.length, 'every question is dealt once before any repeats');
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
