import os
import sys, json
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft
from scipy.interpolate import UnivariateSpline

name = sys.argv[1]
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio') + os.sep
sr, y = wavfile.read(S + name + '.wav'); y = y.astype(np.float32)/32768
HOP=128; NFFT=1024
f,t,Z = stft(y, fs=sr, nperseg=NFFT, noverlap=NFFT-HOP, boundary=None, padded=False)
Sx=np.abs(Z); fr=HOP/sr
def flux(lo,hi):
    b=Sx[(f>=lo)&(f<hi)]; L=np.log1p(30*b); d=np.diff(L,axis=1); d[d<0]=0
    return np.concatenate([[0],d.sum(0)])
def norm(o):
    o=o-np.convolve(o,np.ones(85)/85,mode='same'); o[o<0]=0; return o/(o.max()+1e-9)
ol=norm(flux(30,220)); oa=norm(flux(30,8000))
env=0.5*ol+0.5*oa
k=np.hanning(9); k/=k.sum(); envs=np.convolve(env,k,mode='same')

beats=np.array(json.load(open(S+name+'.beats.json'))['beats'])
# refine each beat to the local onset-envelope peak (+-35 ms) w/ parabolic interpolation
ref=[]
for b in beats:
    c=int(round(b/fr)); w=int(0.035/fr)
    a=max(1,c-w); z=min(len(envs)-2,c+w)
    j=a+int(np.argmax(envs[a:z+1]))
    y0,y1,y2=envs[j-1],envs[j],envs[j+1]
    den=(y0-2*y1+y2)
    off=0.5*(y0-y2)/den if abs(den)>1e-9 else 0
    ref.append((j+off)*fr)
ref=np.array(ref)
kidx=np.arange(len(ref))
# robust smoothing spline: iterate rejecting outliers
mask=np.ones(len(ref),bool)
for it in range(4):
    sp=UnivariateSpline(kidx[mask],ref[mask],k=3,s=mask.sum()*(0.004**2))
    res=ref-sp(kidx)
    mask=np.abs(res)<3*np.std(res[mask])
print(name,'refined-vs-spline residual sd (ms): %.1f  outliers: %d'%(np.std(res[mask])*1000,(~mask).sum()))
smooth=sp(kidx)
ibi=np.diff(smooth); print(name,'spline bpm: start %.2f mid %.2f end %.2f  min %.2f max %.2f'%(60/ibi[:8].mean(),60/ibi[len(ibi)//2-4:len(ibi)//2+4].mean(),60/ibi[-12:-4].mean(),60/ibi.max(),60/ibi.min()))

# is the lock on the kick (beat) or on the off-beat?  compare onset strength at beat vs half-way
def val(tm):
    i=np.clip(np.round(np.array(tm)/fr).astype(int),0,len(ol)-1); return ol[i]
mid=(smooth[:-1]+smooth[1:])/2
print(name,'bass onset @beat %.3f  @offbeat %.3f  @beat+quarter %.3f'%(val(smooth).mean(),val(mid).mean(),val(smooth+0.25*np.append(ibi,ibi[-1])).mean()))

# downbeat: which of the 4 phases gets the most bass/energy-jump
bt=smooth
bar_score=[]
def band_rms(t0,t1):
    a=int(t0*sr); b=int(t1*sr); seg=y[a:b]; return float(np.sqrt((seg**2).mean()+1e-12))
for ph in range(4):
    sc=0; n=0
    for i in range(ph+4, len(bt)-8, 4):
        before=band_rms(bt[i-4],bt[i]); after=band_rms(bt[i],bt[i+4])
        sc+=np.log((after+1e-4)/(before+1e-4)); n+=1
    bar_score.append(sc/n)
# energy-jump score is signed; use abs of step too
bar_abs=[]
for ph in range(4):
    sc=0;n=0
    for i in range(ph+4,len(bt)-8,4):
        sc+=abs(np.log((band_rms(bt[i],bt[i+4])+1e-4)/(band_rms(bt[i-4],bt[i])+1e-4)));n+=1
    bar_abs.append(sc/n)
print(name,'downbeat phase scores (abs energy step per phase):',[round(x,3) for x in bar_abs], '-> phase',int(np.argmax(bar_abs)))
json.dump({'beats':smooth.tolist(),'raw':ref.tolist(),'downPhase':int(np.argmax(bar_abs))},open(S+name+'.smooth.json','w'))
