import sys, json
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft, find_peaks, butter, sosfilt

name, wav = sys.argv[1], sys.argv[2]
sr, y = wavfile.read(wav)
y = y.astype(np.float32) / 32768.0
HOP = 256            # ~11.6 ms at 22050
NFFT = 1024
f, t, Z = stft(y, fs=sr, nperseg=NFFT, noverlap=NFFT - HOP, boundary=None, padded=False)
S = np.abs(Z)
fr = HOP / sr        # seconds per frame

def flux(lo, hi):
    band = S[(f >= lo) & (f < hi)]
    L = np.log1p(30 * band)
    d = np.diff(L, axis=1)
    d[d < 0] = 0
    o = d.sum(0)
    o = np.concatenate([[0], o])
    return o

onset_all = flux(30, 8000)
onset_low = flux(30, 200)      # kick / bass
onset_mid = flux(200, 2500)    # snare / lead
onset_hi = flux(2500, 9000)    # hats

def norm(o):
    o = o - np.convolve(o, np.ones(43) / 43, mode='same')
    o[o < 0] = 0
    return o / (o.max() + 1e-9)

oa, ol, om, oh = map(norm, (onset_all, onset_low, onset_mid, onset_hi))

# ---- global tempo via autocorrelation of combined onset env
env = 0.6 * oa + 0.4 * ol
env = env - env.mean()
ac = np.correlate(env, env, 'full')[len(env) - 1:]
ac /= ac[0]
lags = np.arange(len(ac)) * fr
cands = []
for bpm in np.arange(60, 220, 0.25):
    lag = 60.0 / bpm / fr
    # sum of ac at multiples of the beat (comb)
    s = 0
    for k in (1, 2, 3, 4):
        i = lag * k
        if i + 1 < len(ac):
            a = int(i)
            s += ac[a] * (1 - (i - a)) + ac[a + 1] * (i - a)
    cands.append((bpm, s))
cands = np.array(cands)
order = np.argsort(-cands[:, 1])
top = []
for i in order:
    if all(abs(cands[i, 0] - b) > 3 for b, _ in top):
        top.append((cands[i, 0], cands[i, 1]))
    if len(top) >= 6:
        break
print(name, 'tempo candidates (bpm, score):', [(round(b, 2), round(s, 3)) for b, s in top])

# ---- refine: fit a beat grid (period + phase) maximising onset energy at beats
def grid_score(bpm, phase, o, dur):
    per = 60.0 / bpm
    ts = np.arange(phase, dur, per)
    idx = np.round(ts / fr).astype(int)
    idx = idx[idx < len(o)]
    return o[idx].mean()

dur = len(y) / sr
best = None
for bpm in np.arange(top[0][0] - 3, top[0][0] + 3, 0.02):
    for ph in np.arange(0, 60.0 / bpm, 0.004):
        sc = grid_score(bpm, ph, ol * 0.7 + oa * 0.3, dur)
        if best is None or sc > best[0]:
            best = (sc, bpm, ph)
print(name, 'best global grid: bpm=%.2f phase=%.3f score=%.3f' % (best[1], best[2], best[0]))

# ---- windowed local tempo (tempo drift / changes)
win = int(16 / fr)
hopw = int(8 / fr)
loc = []
for s0 in range(0, len(env) - win, hopw):
    seg = env[s0:s0 + win]
    a = np.correlate(seg, seg, 'full')[win - 1:]
    a /= a[0] + 1e-9
    bs = []
    for bpm in np.arange(70, 200, 0.5):
        lag = 60.0 / bpm / fr
        s = 0
        for k in (1, 2, 4):
            i = lag * k
            if i + 1 < len(a):
                j = int(i)
                s += a[j] * (1 - (i - j)) + a[j + 1] * (i - j)
        bs.append((bpm, s))
    bs = np.array(bs)
    loc.append((s0 * fr, bs[np.argmax(bs[:, 1]), 0]))
print(name, 'local tempo (t, bpm):', [(round(a), round(b, 1)) for a, b in loc])

# ---- energy sections (RMS in 2-bar chunks)
bpm, ph = best[1], best[2]
bar = 4 * 60.0 / bpm
rms = []
nb = int((dur - ph) / bar)
for b in range(nb):
    a0 = int((ph + b * bar) * sr)
    a1 = int((ph + (b + 1) * bar) * sr)
    seg = y[a0:a1]
    rms.append(float(np.sqrt((seg ** 2).mean())))
rms = np.array(rms)
print(name, 'bars:', nb, 'bar length s: %.3f' % bar)
print(name, 'rms per bar (x1000):', [int(r * 1000) for r in rms])

# low-band energy per bar (bass presence -> drops)
sos = butter(4, 150, 'low', fs=sr, output='sos')
yl = sosfilt(sos, y)
lowr = []
for b in range(nb):
    a0 = int((ph + b * bar) * sr)
    a1 = int((ph + (b + 1) * bar) * sr)
    lowr.append(float(np.sqrt((yl[a0:a1] ** 2).mean())))
print(name, 'bass rms per bar (x1000):', [int(r * 1000) for r in lowr])

# per-beat onset strengths on the best grid (to classify the beat pattern)
per = 60.0 / bpm
nbeats = int((dur - ph) / per)
def at(o, t0, w=0.04):
    i0 = max(0, int((t0 - w) / fr)); i1 = min(len(o), int((t0 + w) / fr) + 1)
    return float(o[i0:i1].max()) if i1 > i0 else 0.0

res = {
    'name': name, 'bpm': bpm, 'phase': ph, 'duration': dur, 'bar': bar,
    'rms': rms.tolist(), 'bass': lowr,
}
# sixteenth-grid strengths for each band
step = per / 4
n16 = int((dur - ph) / step)
g = {'low': [], 'mid': [], 'hi': [], 'all': []}
for i in range(n16):
    t0 = ph + i * step
    g['low'].append(at(ol, t0)); g['mid'].append(at(om, t0)); g['hi'].append(at(oh, t0)); g['all'].append(at(oa, t0))
res['grid16'] = g
res['fr'] = fr
# also raw onset peaks (for confirming off-grid hits)
pk, _ = find_peaks(oa, height=0.25, distance=int(0.06 / fr))
res['peaks'] = [round(p * fr, 3) for p in pk]
json.dump(res, open(sys.argv[3], 'w'))
