import './styles.css';
import { App, proveCompletable } from './app.js';
import { getLevel, __dbg, GROUND_MAX_Y } from './game/levelgen.js';
import { bank } from './core/bank.js';
import { audio } from './audio/audio.js';
import { replayInputs } from './game/bot.js';
import { step, DT } from './game/sim.js';
const app = new App();
window.__app = app;
window.__fd = { app, proveCompletable, getLevel, bank, routeLevel: __dbg.routeLevel, GROUND_MAX_Y, audio, replayInputs, step, DT }; // test hooks only
app.init();
