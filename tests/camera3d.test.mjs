// 3D camera checks (Milestone 2). Runs in Node, no browser.
// Plays every level with the prover's own inputs, then at every quarter second checks what the camera would show:
//  - the runner is on screen, and so is the track just ahead of it (you can see what's coming);
//  - the camera is never inside a solid block, and no solid block hides the runner (blocks already passed turn see-through);
//  - camera moves are smooth (no jumps between frames) and the script is in order;
//  - the easy camera (for Casual) never uses the drone, sweep or high views.
// Usage: node tests/camera3d.test.mjs
import * as THREE from 'three';
import { getLevel, LEVEL_DEFS } from '../src/game/levelgen.js';
import { proveCompletable, replayInputs } from '../src/game/bot.js';
import { PH, PW } from '../src/game/sim.js';
import { buildWorld, TRACK_W, wz, isFaded } from '../src/three/world3d.js';
import { buildCameraScript, cameraParamsAt, placeCamera, LOOKS } from '../src/three/camera3d.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS - ' + name); } catch (e) { fail++; console.log('FAIL - ' + name + '\n    ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id);
  const tag = `L${def.id}`;
  const pr = proveCompletable(lv, { margin: 0, pressEvery: 1 });
  const path = []; // the runner's position every 1/60 s
  let k = 0;
  const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
  replayInputs(lv2, pr.inputs, { onStep: (p) => { if (k++ % 2 === 0) path.push({ x: p.x, y: p.y, t: p.t }); } });
  const root = new THREE.Group();
  const world = buildWorld(lv, root);
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 400);
  const out = {};

  t(`${tag}: prover path reaches the finish (${path.length} frames)`, () => ok(pr.ok && path.length > 60 * 100, 'no full path'));

  for (const mode of ['script', 'easy']) {
    const script = buildCameraScript(lv, mode);
    t(`${tag} ${mode}: script is in time order, moves never overlap, every view exists (${script.length} cues)`, () => {
      for (let i = 0; i < script.length; i++) {
        ok(LOOKS[script[i].look], 'unknown view ' + script[i].look);
        if (i) ok(script[i].t >= script[i - 1].t + script[i - 1].blend - 1e-9, `cue ${i} at ${script[i].t.toFixed(2)} overlaps the one before`);
      }
    });
    if (mode === 'easy') t(`${tag} easy: only the behind-the-runner and wide views`, () => ok(script.every((c) => c.look === 'chase' || c.look === 'wide'), script.map((c) => c.look).join(',')));
    else t(`${tag} script: uses drone or sweep moves`, () => ok(script.some((c) => c.look !== 'chase' && c.look !== 'wide'), 'no moves'));

    const bad = { off: [], ahead: [], inside: [], hidden: [], jump: [] };
    let prevPos = null;
    for (let i = 0; i < path.length; i++) {
      const v = path[i];
      const P = cameraParamsAt(script, v.t);
      placeCamera(lv, P, v, v.t / lv.spb, out);
      const pos = out.position.clone();
      if (prevPos && pos.distanceTo(prevPos) > lv.speed / 60 + 0.6) bad.jump.push(v.t.toFixed(2));
      prevPos = pos;
      if (i % 15) continue; // the heavier checks every quarter second
      cam.fov = out.fov; cam.updateProjectionMatrix();
      cam.position.copy(out.position); cam.lookAt(out.look); cam.updateMatrixWorld(true);
      const runner = new THREE.Vector3(0, v.y + PH / 2, wz(v.x + PW / 2));
      const s = runner.clone().project(cam);
      if (!(Math.abs(s.x) < 0.9 && Math.abs(s.y) < 0.9 && s.z < 1)) bad.off.push(v.t.toFixed(2));
      const a = new THREE.Vector3(0, v.y + PH / 2, wz(v.x + 8)).project(cam);
      if (!(Math.abs(a.x) < 0.95 && Math.abs(a.y) < 0.95 && a.z < 1)) bad.ahead.push(v.t.toFixed(2));
      const cx = -out.position.z; // back to track distance
      const solidNow = world.blockers.filter((m) => !isFaded(m.userData.solid, v.x));
      for (const m of solidNow) {
        const so = m.userData.solid;
        if (Math.abs(out.position.x) <= TRACK_W / 2 && cx > so.x && cx < so.x + so.w && out.position.y > so.y0 && out.position.y < so.y1) { bad.inside.push(v.t.toFixed(2)); break; }
      }
      const dir = runner.clone().sub(out.position); const dist = dir.length(); dir.normalize();
      ray.set(out.position, dir); ray.far = dist - 0.5;
      const hit = ray.intersectObjects(solidNow, false)[0];
      if (hit) bad.hidden.push(v.t.toFixed(2) + `[x${hit.object.userData.solid.x.toFixed(0)} y${hit.object.userData.solid.y0}-${hit.object.userData.solid.y1.toFixed(1)} r${v.x.toFixed(0)},${v.y.toFixed(1)}]`);
    }
    const show = (arr) => `${arr.length} times${arr.length ? ' (first at ' + arr.slice(0, 5).join(', ') + ' s)' : ''}`;
    t(`${tag} ${mode}: runner always on screen`, () => ok(!bad.off.length, 'off screen ' + show(bad.off)));
    t(`${tag} ${mode}: the track just ahead is always on screen`, () => ok(!bad.ahead.length, 'not visible ' + show(bad.ahead)));
    t(`${tag} ${mode}: camera never inside a solid block`, () => ok(!bad.inside.length, 'inside ' + show(bad.inside)));
    t(`${tag} ${mode}: no solid block hides the runner`, () => ok(!bad.hidden.length, 'hidden ' + show(bad.hidden)));
    t(`${tag} ${mode}: camera glides (no jumps between frames)`, () => ok(!bad.jump.length, 'jumps ' + show(bad.jump)));
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
