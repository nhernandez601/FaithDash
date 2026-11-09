// Smooth song clock.
//
// The browser's audio clock is exact over the long run but it moves in uneven little jumps (every 3 ms in Chrome, 10-20 ms
// in some Firefox / Safari builds, bigger on Bluetooth). Moving the game straight to that number each frame makes the
// scrolling shudder, even though nothing is "late". This clock runs on the frame timer (smooth) and is gently steered
// toward the audio clock (correct), so the picture glides at a constant speed and still stays locked to the music.
//
//   - it never runs backwards (a backwards correction only slows it down for a moment)
//   - small errors are corrected over about 1/8 s, so they are invisible
//   - a big jump (seek, respawn, resume, a long hitch) snaps straight to the audio clock
export const SNAP = 0.15;      // seconds of error that are fixed instantly instead of smoothly
export const RATE = 8;         // correction strength per second (1/RATE = time constant)

export class SmoothClock {
  constructor() { this.t = 0; this.ok = false; }
  reset(t) { this.t = t; this.ok = true; }
  // dt: seconds since the last frame (frame timer); target: where the audio clock says we are.
  update(dt, target) {
    if (!this.ok || !(dt >= 0)) { this.reset(target); return this.t; }
    const pred = this.t + dt;
    const err = target - pred;
    if (Math.abs(err) > SNAP) { this.t = target; return this.t; }
    const next = pred + err * Math.min(1, dt * RATE);
    this.t = Math.max(this.t, next);
    return this.t;
  }
}
