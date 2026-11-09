import sys, json
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft, butter, sosfilt
import os
name=sys.argv[1]; BPM=float(os.environ.get('BPM','130')); P=60/BPM
S=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio') + os.sep
sr,y=wavfile.read(S+name+'L.wav'); y=y.astype(np.float32)/32768
HOP=128; NFFT=1024
f,t,Z=stft(y,fs=sr,nperseg=NFFT,noverlap=NFFT-HOP,boundary=None,padded=False)
Sx=np.abs(Z); fr=HOP/sr
def flux(lo,hi):
    b=Sx[(f>=lo)&(f<hi)]; L=np.log1p(30*b); d=np.diff(L,axis=1); d[d<0]=0
    return np.concatenate([[0],d.sum(0)])
def norm(o):
    o=o-np.convolve(o,np.ones(171)/171,mode='same'); o[o<0]=0; return o/np.percentile(o,99.7)
ol=np.clip(norm(flux(30,200)),0,1.5); om=np.clip(norm(flux(200,2500)),0,1.5); oh=np.clip(norm(flux(2500,9000)),0,1.5)
oa=np.clip(norm(flux(30,9000)),0,1.5)
dur=len(y)/sr
# ---- fit rigid-grid phase using the kick/all onset envelope
env=0.6*ol+0.4*oa
best=None
for ph in np.arange(0,P,0.001):
    ts=np.arange(ph,dur-1,P); idx=np.clip(np.round(ts/fr).astype(int),0,len(env)-1)
    # take max within +-12ms to be tolerant
    w=int(0.012/fr)
    sc=np.mean([env[max(0,i-w):i+w+1].max() for i in idx])
    if best is None or sc>best[0]: best=(sc,ph)
ph=best[1]
print(name,'grid phase (beat0) = %.3f s, score %.3f'%(ph,best[0]))
ts=np.arange(ph,dur-1,P)
# offsets of actual kick peaks from grid
offs=[]
for tb in ts:
    i0=int((tb-0.06)/fr); i1=int((tb+0.06)/fr)
    if i0<0 or i1>=len(ol): continue
    seg=ol[i0:i1]
    if seg.max()>0.5: offs.append((i0+np.argmax(seg))*fr-tb)
offs=np.array(offs)
print(name,'kick-peak offset from grid: median %.1f ms, sd %.1f ms, n=%d (of %d beats)'%(np.median(offs)*1000,offs.std()*1000,len(offs),len(ts)))
# apply the measured median bias to the phase
ph=ph+float(np.median(offs)); print(name,'beat0 after bias fix: %.3f'%ph)
nb=int((dur-ph)/P)
step=P/4
def at(o,tc,w=0.03):
    i0=max(0,int((tc-w)/fr)); i1=min(len(o),int((tc+w)/fr)+1); return float(o[i0:i1].max()) if i1>i0 else 0.0
n16=nb*4
G={k:np.zeros(n16,np.float32) for k in ('low','mid','hi')}
for i in range(n16):
    tc=ph+i*step
    G['low'][i]=at(ol,tc); G['mid'][i]=at(om,tc); G['hi'][i]=at(oh,tc)
# energy per beat
sos=butter(4,150,'low',fs=sr,output='sos'); yl=sosfilt(sos,y)
def rms(a,t0,t1):
    a0=int(max(0,t0)*sr); a1=int(t1*sr); s=a[a0:a1]; return float(np.sqrt((s**2).mean()+1e-10)) if len(s)>0 else 0.0
E=np.array([rms(y,ph+i*P,ph+(i+1)*P) for i in range(nb)]); B=np.array([rms(yl,ph+i*P,ph+(i+1)*P) for i in range(nb)])
# per-slot pattern, averaged over song: slot position within bar (16)
for nm in ('low','mid','hi'):
    L0=(nb*4//16)*16; g=G[nm][:L0].reshape(-1,16)
    print(name,nm,'avg strength by 16th slot (bar from beat0 grid):',' '.join('%.2f'%v for v in g.mean(0)))
# four possible bar alignments: use low-band strength on slot 0 compare
for p in range(4):
    g=G['low'][p*4:(nb*4-(4-p)*4+0)]
    L=(len(g)//16)*16; g=g[:L].reshape(-1,16)
    print(name,'bar phase',p,'downbeat-slot low %.2f  beat3-slot %.2f  mid@beat2/4 %.2f/%.2f  mid@beat3 %.2f'%(g[:,0].mean(),g[:,8].mean(),
          G['mid'][p*4+4:L+p*4:16][:len(g)].mean() if True else 0, G['mid'][p*4+12:L+p*4:16][:len(g)].mean(), G['mid'][p*4+8:L+p*4:16][:len(g)].mean()))
np.savez(S+name+'.feat.npz',low=G['low'],mid=G['mid'],hi=G['hi'],E=E,B=B,ph=ph,nb=nb)
print(name,'beats',nb,'duration %.2f'%dur,' E per bar(x1000):',[int(E[i:i+4].mean()*1000) for i in range(0,nb-3,4)])
