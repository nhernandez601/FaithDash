// Gamer names (src/online/board.js): what is allowed, what is not. The server (supabase/leaderboard.sql) has the same rules.
import { checkName, online } from '../src/online/board.js';
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('FAIL ' + msg); } };
for (const n of ['Noe', 'abc Pilgrim 7', 'Faith_Runner', 'x.y-z', '1234567890123456', '  spaced   out  ']) check(checkName(n).ok, `"${n}" is allowed`);
for (const n of ['', 'ab', '12345678901234567', 'hi<b>', 'emoji😀x', 'a/b/c', 'FUCKer', 'Shit head']) {
  const r = checkName(n);
  check(!r.ok, `"${n}" is refused (${r.error || 'allowed!'})`);
}
check(checkName('  spaced   out  ').name === 'spaced out', 'extra spaces are tidied');
check(!checkName('n0zi n4zi nazi').ok, 'bad word with 0 for o is refused');
check(online() === false, 'not connected when no URL/key is set (scores stay on the device)');
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
