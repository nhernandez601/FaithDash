import sys, json
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

name, wav, out = sys.argv[1:4]
sr, y = wavfile.read(wav); y = y.astype(np.float32)/32768
HOP=256; NFFT=1024
f,t,Z = stft(y, fs=sr, nperseg=NFFT, noverlap=NFFT-HOP, boundary=None, padded=False)
S=np.abs(Z); fr=HOP/sr
def flux(lo,hi):
    b=S[(f>=lo)&(f<hi)]; L=np.log1p(30*b); d=np.diff(L,axis=1); d[d<0]=0
    return np.concatenate([[0],d.sum(0)])
def norm(o):
    o=o-np.convolve(o,np.ones(43)/43,mode='same'); o[o<0]=0; return o/(o.max()+1e-9)
oa=norm(flux(30,8000)); ol=norm(flux(30,220)); om=norm(flux(220,2500)); oh=norm(flux(2500,9000))
env = 0.5*oa+0.5*ol
# smooth slightly
k=np.hanning(5); k/=k.sum(); envs=np.convolve(env,k,mode='same')

def dp_track(envs, period_s, lam=100.0):
    P = period_s/fr
    n=len(envs)
    score=envs.copy(); back=-np.ones(n,int)
    lo=int(0.6*P); hi=int(1.5*P)
    for i in range(n):
        a=max(0,i-hi); b=i-lo
        if b<=a: continue
        idx=np.arange(a,b+1)
        pen=-lam*np.log((i-idx)/P)**2
        cand=score[idx]+pen
        j=np.argmax(cand)
        score[i]=envs[i]+cand[j]; back[i]=idx[j]
    # backtrace from best in last 2 seconds region
    end=np.argmax(score[-int(3/fr):])+n-int(3/fr)
    path=[end]
    while back[path[-1]]>=0: path.append(back[path[-1]])
    return np.array(path[::-1])*fr

import os
for period_bpm in (float(os.environ.get("BPM","130")),):
    beats=dp_track(envs,60/period_bpm)
    ibi=np.diff(beats)
    print(name,'beats',len(beats),'first',round(beats[0],3),'last',round(beats[-1],2))
    print(name,'IBI mean %.4f sd %.4f -> bpm %.2f'%(ibi.mean(),ibi.std(),60/ibi.mean()))
    # tempo over time in 16-beat chunks
    ch=[60/ibi[i:i+16].mean() for i in range(0,len(ibi)-16,16)]
    print(name,'bpm per 16 beats:',[round(c,1) for c in ch])
    # how far does a perfect grid of mean bpm deviate from tracked beats?
    g=beats[0]+np.arange(len(beats))*ibi.mean()
    dev=beats-g
    print(name,'deviation from rigid grid (ms): min %.0f max %.0f'%(dev.min()*1000,dev.max()*1000))
    print(name,'dev samples every 16 beats (ms):',[int(d*1000) for d in dev[::16]])
json.dump({'beats':beats.tolist(),'fr':fr},open(out,'w'))
