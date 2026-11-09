import os
import sys, json
import numpy as np
from scipy.io import wavfile
from scipy.interpolate import UnivariateSpline
name=sys.argv[1]
S=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audio') + os.sep
sr,y=wavfile.read(S+name+'.wav'); y=y.astype(np.float32)/32768
raw=np.array(json.load(open(S+name+'.smooth.json'))['raw']); k=np.arange(len(raw))
for sg in (0.005,0.006,0.007,0.008,0.010):
    mask=np.ones(len(raw),bool)
    for it in range(5):
        sp=UnivariateSpline(k[mask],raw[mask],k=3,s=mask.sum()*(sg**2))
        res=raw-sp(k); mask=np.abs(res)<2.5*np.std(res[mask])
    sm=sp(k); bpm=60/np.diff(sm)
    dbpm=np.abs(np.diff(bpm))
    print(name,'sigma %.3f: resid sd %.1f ms, max |res| %.0f ms, bpm %.1f..%.1f, max beat-to-beat bpm jump %.2f'%(sg,np.std(res[mask])*1000,np.abs(res[mask]).max()*1000,bpm.min(),bpm.max(),dbpm.max()))
