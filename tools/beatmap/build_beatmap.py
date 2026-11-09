import sys, json, base64, subprocess, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio') + os.sep
GAME = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..') + os.sep
BPM = 130.0
P = 60 / BPM
SONGS = {
    'drop': dict(title='Arcade Drop', down=1, file='arcade-drop.mp3', delta=0.040),
    'boss': dict(title='Arcade Boss Battle', down=2, file='arcade-boss-battle.mp3', delta=0.046),
    'intense': dict(title='Intense Section', down=2, file='intense-section.mp3', delta=0.053, bpm=147.0),
}
os.makedirs(GAME + 'src/assets/music', exist_ok=True)

def q(a, hi, n=15):
    return np.clip(np.round(a / hi * n), 0, n).astype(int)

def hexs(a):
    return ''.join('0123456789abcdef'[int(v)] for v in a)

out = {}
for name, meta in SONGS.items():
    d = np.load(S + name + '.feat.npz')
    ph = float(d['ph']); nb = int(d['nb']); E = d['E']; B = d['B']
    ph0 = ph; ph = ph + meta['delta']   # measured: the tracked beat grid leads the audible kick by ~40 ms, so trim a little more
    p = meta['down']
    low, mid, hi = d['low'], d['mid'], d['hi']
    # ---- trim the locked audio so that beat 0 is at t = 0, encode to mp3
    mp3 = GAME + 'src/assets/music/' + meta['file']
    r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '%.4f' % ph, '-i', S + name + '.locked.wav',
                        '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '48000', '-map_metadata', '-1', mp3], capture_output=True, text=True)
    if r.returncode: print(r.stderr)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).decode().strip())

    # ---- per-bar intensity
    nbar = (nb - p) // 4
    Eb = np.array([E[p + 4 * j:p + 4 * j + 4].mean() for j in range(nbar)])
    Bb = np.array([B[p + 4 * j:p + 4 * j + 4].mean() for j in range(nbar)])
    En = Eb / np.percentile(Eb, 90); Bn = Bb / np.percentile(Bb, 90)
    kind = []
    for j in range(nbar):
        if En[j] >= 0.80 and Bn[j] >= 0.70: kind.append('drop')
        elif En[j] >= 0.62 and Bn[j] >= 0.40: kind.append('groove')
        else: kind.append('calm')
    # end of the playable level: first bar after the last bar with real energy
    last = max(j for j in range(nbar) if En[j] >= 0.6)
    endBeat = p + 4 * (last + 1)
    # build-ups: calm bars immediately before a drop bar
    bars = []
    for j in range(nbar):
        k = kind[j]
        if k == 'calm':
            nxt = kind[j + 1] if j + 1 < nbar else ''
            nxt2 = kind[j + 2] if j + 2 < nbar else ''
            if nxt == 'drop' or (nxt2 == 'drop' and nxt == 'calm'): k = 'build'
        bars.append(k)
    # intro / outro
    first_non = next((j for j, k in enumerate(bars) if k in ('drop', 'groove')), 0)
    for j in range(first_non):
        if bars[j] in ('calm', 'build'): bars[j] = 'intro' if bars[j] == 'calm' else 'build'
    for j in range(last + 1, nbar): bars[j] = 'outro'
    # continuous intensity per beat (smoothed bar-ish value)
    En_b = E / np.percentile(Eb, 90); Bn_b = B / np.percentile(Bb, 90)
    inten = np.clip(0.55 * En_b + 0.45 * Bn_b, 0, 1.2)
    k5 = np.ones(5) / 5
    inten = np.convolve(np.pad(inten, 2, mode='edge'), k5, mode='valid')[:nb]
    inten_q = q(np.clip(inten, 0, 1), 1.0, 9)

    # ---- slot strengths (16ths): quantise to 0..15
    n16 = nb * 4
    ql, qm, qh = q(low[:n16], 1.0), q(mid[:n16], 1.0), q(hi[:n16], 1.0)

    # ---- 25 Hz band envelope for the music-reactive visuals
    sr, y = wavfile.read(S + name + 'L.wav'); y = y.astype(np.float32) / 32768
    HOP = 441; NFFT = 2048   # at 22050 Hz: 20 ms hop -> 50 Hz; we keep 25 Hz by averaging pairs
    f, t, Z = stft(y, fs=sr, nperseg=NFFT, noverlap=NFFT - HOP, boundary=None, padded=False)
    M = np.abs(Z) ** 2
    def band(lo_, hi_):
        return np.sqrt(M[(f >= lo_) & (f < hi_)].sum(0))
    bl, bm, bh = band(30, 200), band(200, 2500), band(2500, 9000)
    # align: t[0] is the centre of the first window; shift so index i <-> ph + i*0.02
    t0 = t - ph
    env = []
    step = 0.04
    nst = int((dur) / step) + 1
    for arr in (bl, bm, bh):
        arr = arr / np.percentile(arr, 99)
        v = np.interp(np.arange(nst) * step, t0, arr)
        env.append(np.clip(v, 0, 1.2) / 1.2)
    envq = (np.stack(env, 1) * 255).astype(np.uint8)       # [nst][3]
    envb64 = base64.b64encode(envq.tobytes()).decode()

    # sections as runs
    secs = []
    for j, k in enumerate(bars):
        if not secs or secs[-1]['kind'] != k:
            secs.append({'beat': p + 4 * j, 'kind': k})
    drops = [s['beat'] for s in secs if s['kind'] == 'drop']
    out[name] = dict(
        id=name, title=meta['title'], url=meta['file'], bpm=meta.get('bpm', BPM), nBeats=nb, down=p, endBeat=int(endBeat),
        duration=round(dur, 3), sections=secs, drops=drops,
        inten=hexs(inten_q), low=hexs(ql), mid=hexs(qm), hi=hexs(qh), envStep=step, env=envb64,
    )
    print(name, 'beats', nb, 'endBeat', endBeat, 'dur %.2f' % dur, 'secs', [(s['beat'], s['kind']) for s in secs])

js = '// AUTO-GENERATED by tools/build_beatmap.py from the two songs — do not edit by hand.\n' \
     '// Every song was time-corrected to a steady tempo (bpm field), so beat i is at exactly i * (60/bpm) seconds.\n' \
     '// low/mid/hi: one hex digit (0-f) per 16th note = how hard the kick+bass / snare+lead / hats hit on that slot.\n' \
     '// inten: one digit (0-9) per beat = how intense the music is. env: base64 bytes, [low,mid,hi] every envStep seconds.\n' \
     'export const BEATMAPS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
open(GAME + 'src/audio/beatmaps.js', 'w').write(js)
print('wrote beatmaps.js', len(js) // 1024, 'KB')
for fn in os.listdir(GAME + 'src/assets/music'):
    print(fn, os.path.getsize(GAME + 'src/assets/music/' + fn) // 1024, 'KB')
