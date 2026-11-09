import os
import numpy as np, subprocess, json, sys
from scipy.signal import lfilter
G=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..') + os.sep
src=open(G+'src/audio/beatmaps.js').read()
i=src.index('export const BEATMAPS =')
m=json.loads(src[src.index('=',i)+1:].rstrip().rstrip(';'))
for name,fn in (('drop','arcade-drop.mp3'),('boss','arcade-boss-battle.mp3'),('intense','intense-section.mp3')):
    bpm=m[name]['bpm']; low=m[name]['low']; spb=60/bpm
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',G+'src/assets/music/'+fn,'-f','f32le','-ac','1','-ar','48000','-'])
    y=np.frombuffer(raw,np.float32); sr=48000
    a=np.exp(-2*np.pi*150/sr); e=np.abs(lfilter([1-a],[1,-a],y))
    ms=np.add.reduceat(e,np.arange(0,len(e),sr//1000))
    sl=[s for s,c in enumerate(low) if c in 'ef' and s*spb/4<120]
    offs=[]
    for s in sl:
        k0=int(round(s*spb/4*1000)); w=ms[k0-40:k0+160]; bi=int(np.argmax(w))-40; bv=w[bi+40]
        on=bi
        while on>-40 and ms[k0+on-1]>0.25*bv: on-=1
        offs.append(on)
    print(name,bpm,'kicks',len(sl),'median onset after slot (ms)',np.median(offs),'q1',np.percentile(offs,25),'q3',np.percentile(offs,75))
