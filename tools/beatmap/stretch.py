import sys, json, subprocess
import numpy as np
from scipy.interpolate import UnivariateSpline
import os
name=sys.argv[1]; TARGET=float(os.environ.get('BPM','130'))
S=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio') + os.sep
raw=np.array(json.load(open(S+name+'.smooth.json'))['raw']); k=np.arange(len(raw))
chosen=None
for sg in np.arange(0.007,0.0151,0.0005):
    mask=np.ones(len(raw),bool)
    for it in range(5):
        sp=UnivariateSpline(k[mask],raw[mask],k=3,s=mask.sum()*(sg**2))
        res=raw-sp(k); mask=np.abs(res)<2.5*np.std(res[mask])
    sm=sp(k); bpm=60/np.diff(sm)
    if np.abs(np.diff(bpm)).max()<0.8 and bpm.min()>TARGET-10 and bpm.max()<TARGET+10:
        chosen=(sg,sm,res[mask]); break
sg,sm,res=chosen
print(name,'sigma',sg,'resid sd %.1f ms max %.0f ms'%(res.std()*1000,np.abs(res).max()*1000))
P=60.0/TARGET
ratios=(np.diff(sm))/P   # tempo factor: input sec per output sec
print(name,'tempo factor range %.4f..%.4f  (=%.2f%%..%.2f%% speed change)'%(ratios.min(),ratios.max(),(ratios.min()-1)*100,(ratios.max()-1)*100))
lines=['0.000 rubberband tempo %.5f;'%ratios[0]]
for i in range(len(ratios)):
    lines.append('%.4f rubberband tempo %.5f;'%(sm[i],ratios[i]))
open(S+name+'.cmds.txt','w').write('\n'.join(lines)+'\n')
json.dump({'beats':sm.tolist(),'sigma':sg},open(S+name+'.final_beats.json','w'))
cmd=['ffmpeg','-y','-loglevel','error','-i',S+name+'.mp3','-vn','-af',
     'asendcmd=f=%s,rubberband=tempo=1:pitch=1:transients=crisp:phase=laminar:window=standard:pitchq=quality:smoothing=off'%(S+name+'.cmds.txt'),
     '-ar','48000','-ac','2',S+name+'.locked.wav']
print(' '.join(cmd[:6]),'...')
r=subprocess.run(cmd,capture_output=True,text=True); print(r.stdout,r.stderr[:500])
