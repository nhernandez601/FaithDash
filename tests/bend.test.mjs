// Twists and spirals (src/three/bend.js): drawing only, but where they go matters.
// Each stage gets its set (easy 2 twists, medium +1 spiral, hard 2 + 2), all on plain road: never in or near a
// fly / gravity section, never at the very start or the finish, never overlapping. And the road maths is sane.
import { LEVEL_DEFS, getLevel } from '../src/game/levelgen.js';
import { planBends, setZones, angleAt, bendPoint, TWIST, SPIRAL } from '../src/three/bend.js';
import * as THREE from 'three';
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log('FAIL ' + msg); } };
const WANT = { easy: [2, 0], medium: [2, 1], hard: [2, 2] };
for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id), zs = planBends(lv, def.tier), tag = `L${def.id} ${def.tier}`;
  const tw = zs.filter((z) => z.kind === TWIST).length, sp = zs.filter((z) => z.kind === SPIRAL).length;
  check(tw === WANT[def.tier][0] && sp === WANT[def.tier][1], `${tag}: ${tw} twists, ${sp} spirals`);
  for (const z of zs) {
    check(z.x0 >= 45 && z.x1 <= lv.finishX - 35, `${tag}: bend ${z.x0.toFixed(0)} clear of start and finish`);
    check(!lv.sections.some((s) => z.x1 > s.x0 - 24 && z.x0 < s.x1 + 24), `${tag}: bend ${z.x0.toFixed(0)} clear of fly/gravity sections`);
  }
  for (let i = 1; i < zs.length; i++) check(zs[i].x0 >= zs[i - 1].x1 + 30, `${tag}: bends do not overlap`);
  console.log(`${tag}: ${zs.map((z) => (z.kind === SPIRAL ? 'spiral' : 'twist') + '@' + z.x0.toFixed(0)).join(', ')}`);
  // maths: flat outside, flat again at both ends, a spiral goes fully upside down half-way
  setZones(zs);
  for (const z of zs) {
    check(Math.abs(angleAt(z.x0 - 1).a) < 1e-9 && Math.abs(angleAt(z.x1 + 1).a) < 1e-9, `${tag}: flat outside bend`);
    if (z.kind === SPIRAL) {
      check(Math.abs(angleAt((z.x0 + z.x1) / 2).a - Math.PI) < 1e-6, `${tag}: spiral upside down half-way`);
      const p = bendPoint(new THREE.Vector3(0, z.pivot - 3.4, -(z.x0 + z.x1) / 2));
      check(Math.abs(p.y - (z.pivot + 3.4)) < 1e-6, `${tag}: road is above the axis half-way round`);
    }
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
