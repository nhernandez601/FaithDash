// Faith Dash — DOM user interface (menus, HUD, trivia, results, leaderboard, settings).
import { S } from '../core/fsm.js';
import { audio, TRACKS } from '../audio/audio.js';
import { BACKGROUNDS } from '../render/backgrounds.js';
import { SKINS, skinById } from '../render/skins.js';
import { CanvasPen } from '../render/pen.js';
import { LEVEL_DEFS } from '../game/levelgen.js';
import { bank, DIFFS, validateQ } from '../core/bank.js';
import { lb, RANK_POLICY } from '../core/leaderboard.js';
import { esc, fmtTime, sanitizeName, validName, NAME_MAX, el } from '../core/util.js';
import { store } from '../core/storage.js';
import { art } from '../render/art.js';
import { HOWTO } from './howto.js';
import { getBeatMap, SONG_IDS } from '../audio/music.js';

const songOf = (lvl) => (lvl && lvl.song ? getBeatMap(lvl.song) : null);
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
// the Audio-delay slider row, shared by Settings and Music Select
const syncRow = () => `<div class="setting"><span>Audio delay<small>If jumps feel late against the beat, raise this (Bluetooth speakers often need +100 to +200 ms).</small></span><span class="sl"><input type="range" id="sync" min="-100" max="400" step="10" value="${audio.settings.syncMs || 0}"><b id="syncv">${audio.settings.syncMs || 0} ms</b></span></div>`;
const bindSync = (root, app) => { const r = root.querySelector('#sync'); if (r) r.addEventListener('input', (e) => { root.querySelector('#syncv').textContent = e.target.value + ' ms'; app.setAudio({ syncMs: Number(e.target.value) }); }); };

const HEART = `<svg class="heart" viewBox="0 0 32 32"><path d="M16 29S3 20.5 3 11.5C3 7 6.4 4 10.3 4c2.6 0 4.6 1.4 5.7 3.3C17.1 5.4 19.1 4 21.7 4 25.6 4 29 7 29 11.5 29 20.5 16 29 16 29z" fill="#ff3d6a" stroke="#fff" stroke-width="2"/><path d="M9 9.5c1-1.2 2.3-1.6 3.6-1.3" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".7"/></svg>`;
const LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#ff9f1a"/></linearGradient></defs><path d="M42 4h16v26h24v16H58v50H42V46H18V30h24z" fill="url(#lg)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
const LOGO_HTML = (cls = '') => `<div class="logo2 ${cls}"><img class="logo-img" src="${art.url('logo')}" alt="Faith Dash" onerror="this.parentElement.classList.add('noimg')"><span class="cross">${LOGO}</span><h1><span>FAITH</span> <span>DASH</span></h1></div>`;
const SHIELD = `<svg class="shield-ico" viewBox="0 0 64 72" aria-hidden="true"><path d="M32 3 6 13v20c0 18 11 29 26 36 15-7 26-18 26-36V13z" fill="#1f7bff" stroke="#bfe6ff" stroke-width="3.5"/><path d="M32 12 14 19v14c0 12 7 20 18 26 11-6 18-14 18-26V19z" fill="#39b6ff"/><path d="M32 22v26M21 33h22" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>`;
const STAR = (on) => `<svg class="star ${on ? 'on' : ''}" viewBox="0 0 24 24"><path d="M12 2l3 6.6 7.2.8-5.4 4.8 1.6 7.1L12 17.6 5.6 21.3l1.6-7.1L1.8 9.4 9 8.6z"/></svg>`;

const MENU_STATE = { main: S.MAIN_MENU, levels: S.LEVEL_SELECT, settings: S.SETTINGS, howto: S.TUTORIAL, leaderboard: S.GLOBAL_LEADERBOARD };

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('screens');
    this.over = document.getElementById('overlay-root');
    this.hudEl = document.getElementById('hud');
    this.toastEl = document.getElementById('toasts');
    this.cur = null; this.curName = null; this.history = [];
    this.anims = [];
    this.modal = null;
    this.hudCache = {};
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn, .card, .tab, .ans');
      if (b && !b.disabled && !b.dataset.silent) audio.sfx('click');
    });
  }

  // ------------------------------------------------------------ navigation
  go(name, props = {}) {
    const app = this.app;
    this.stopPreviewAudio();
    this.leaveCurrent();
    this.anims = [];
    const fn = this['screen_' + name];
    if (!fn) throw new Error('unknown screen ' + name);
    this.curName = name;
    const el_ = fn.call(this, props);
    el_.dataset.screen = name;
    this.root.appendChild(el_);
    this.cur = el_;
    requestAnimationFrame(() => requestAnimationFrame(() => el_.classList.add('show')));
    const st = MENU_STATE[name];
    if (st && app.fsm.state !== st) {
      if (!app.fsm.go(st, 'menu ' + name)) app.fsm.state = st;
    }
    const f = el_.querySelector('[autofocus], .btn.primary');
    if (f && !matchMedia('(pointer: coarse)').matches) setTimeout(() => f.focus({ preventScroll: true }), 120);
    return el_;
  }
  leaveCurrent() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.classList.remove('show'); c.classList.add('leaving');
    setTimeout(() => c.remove(), 320);
  }
  leaveAll() {
    this.leaveCurrent();
    this.closeModal(true);
    this.hidePause(); this.hideTrivia(); this.hideResults();
    this.stopPreviewAudio();
    this.anims = [];
  }
  escape() {
    const app = this.app;
    if (this.modal) { this.closeModal(); return; }
    if (this.curName && this.curName !== 'main' && this.curName !== 'welcome') {
      if (this.curName === 'leaderboard' && this.lbReturn) { this.closeLeaderboard(); return; }
      this.go('main');
    }
  }
  stopPreviewAudio() { if (audio.previewing) audio.stopPreview(); }
  toast(msg, secs = 3.2) {
    const t = el('div', 'toast'); t.textContent = msg; t.style.animationDuration = secs + 's';
    while (this.toastEl.children.length >= 2) this.toastEl.firstChild.remove();
    this.toastEl.appendChild(t);
    setTimeout(() => t.remove(), secs * 1000 + 100);
  }
  bigText(label) {
    if (this.bigEl) { this.bigEl.remove(); this.bigEl = null; }
    if (!label) return;
    const d = el('div', 'big-center'); d.innerHTML = `<b>${esc(label)}</b>`; d.dataset.big = label;
    this.over.appendChild(d); this.bigEl = d;
    this.bigLabel = label;
  }
  flash() {
    const f = el('div', 'flash'); this.over.appendChild(f); f.classList.add('go'); setTimeout(() => f.remove(), 600);
  }
  coinPop() {
    const f = el('div', 'flash'); f.style.background = '#ffd23a'; this.over.appendChild(f); f.classList.add('go'); setTimeout(() => f.remove(), 600);
  }
  refreshAudioIcons() { document.querySelectorAll('[data-act=mute]').forEach((b) => (b.textContent = audio.settings.muted ? '🔇' : '🔊')); }

  // ------------------------------------------------------------ small builders
  screenEl(cls = '') { const s = el('section', 'screen ' + cls); return s; }
  head(title, backAct = 'back') {
    const h = el('div', 'screen-head');
    h.innerHTML = `<button class="btn icon-btn" data-act="${backAct}" aria-label="Back">←</button><h2>${esc(title)}</h2>`;
    return h;
  }
  on(root, handlers) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const fn = handlers[b.dataset.act];
      if (fn) fn(b, e);
    });
  }
  makePreview(canvas, draw) {
    const ctx = canvas.getContext('2d');
    const pen = new CanvasPen(ctx);
    this.anims.push({ canvas, ctx, pen, draw, t: Math.random() * 3 });
  }
  tick(dt) {
    for (const a of this.anims) {
      if (!a.canvas.isConnected) continue;
      a.t += dt;
      a.draw(a.pen, a.canvas.width, a.canvas.height, a.t);
    }
    if (this.resultsAnim) this.resultsAnim(dt);
  }

  // ------------------------------------------------------------ welcome (first run username)
  screen_welcome() {
    const s = this.screenEl('scrim');
    s.innerHTML = `<div class="panel modal" style="width:min(520px,100%)">
      ${LOGO_HTML("center")}
      <h3>Choose your player name</h3>
      <label class="f">Display name (shown on the global leaderboard)<input type="text" id="nm" maxlength="${NAME_MAX}" autocomplete="off" autocapitalize="words" spellcheck="false" autofocus placeholder="e.g. FaithRunner" /></label>
      <div class="err" id="nmErr"></div>
      <p class="menu-sub">No email or password needed. You can change this any time in Settings.</p>
      <button class="btn primary" data-act="start" id="go" disabled>Let's Go!</button>
    </div>`;
    const inp = s.querySelector('#nm'), btn = s.querySelector('#go'), err = s.querySelector('#nmErr');
    const check = () => { const ok = validName(inp.value); btn.disabled = !ok; err.textContent = inp.value && !ok ? 'Please use letters or numbers.' : ''; };
    inp.addEventListener('input', check);
    const submit = () => {
      const n = sanitizeName(inp.value);
      if (!validName(n)) { err.textContent = 'Please enter a name (1–16 characters).'; return; }
      this.app.sd.username = n; this.app.persist();
      this.go(this.app.sd.tutorialDone ? 'main' : 'howto', { first: true });
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    this.on(s, { start: submit });
    return s;
  }

  // ------------------------------------------------------------ main menu
  screen_main() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    const lvl = LEVEL_DEFS.find((l) => l.id === (sd.lastLevel || 1)) || LEVEL_DEFS[0];
    const ic = (g) => `<i class="ic">${g}</i>`;
    s.innerHTML = `
      <div class="menu-corner">
        <button class="btn icon-btn ghost" data-act="mute" aria-label="Mute" data-silent="1">${audio.settings.muted ? '🔇' : '🔊'}</button>
        <button class="btn icon-btn ghost" data-act="fs" aria-label="Fullscreen" id="fsBtn">⛶</button>
      </div>
      <div class="menu-wrap side">
        ${LOGO_HTML()}
        <div class="user-chip" id="chip"><b id="who">${esc(sd.username)}</b> <button class="btn small ghost" data-act="rename" aria-label="Edit name">✎</button></div>
        <div class="menu-list">
          <button class="btn mbtn play" data-act="play">${ic('▶')}<span>Play</span></button>
          <button class="btn mbtn" data-act="levels">${ic('▦')}<span>Level Select</span></button>
          <button class="btn mbtn" data-act="music">${ic('♫')}<span>Music Select</span></button>
          <button class="btn mbtn" data-act="bg">${ic('▣')}<span>Background Select</span></button>
          <button class="btn mbtn" data-act="skins">${ic('◆')}<span>Character Skins</span></button>
          <button class="btn mbtn" data-act="leaderboard">${ic('🏆')}<span>Global Leaderboard</span></button>
          <button class="btn mbtn" data-act="howto">${ic('📖')}<span>How to Play</span></button>
          <button class="btn mbtn" data-act="stats">${ic('📊')}<span>Player Statistics</span></button>
          <button class="btn mbtn" data-act="settings">${ic('⚙')}<span>Settings</span></button>
        </div>
        <div class="menu-sub" id="sel">Level ${lvl.id}: ${esc(lvl.name)} · ♫ ${esc(songOf(lvl) ? songOf(lvl).title : TRACKS[sd.song].name)} · ${esc(BACKGROUNDS[sd.bg].name)}</div>
      </div>`;
    if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) s.querySelector('#fsBtn').remove();
    this.on(s, {
      play: () => app.startLevel(sd.lastLevel || 1),
      levels: () => this.go('levels'), music: () => this.go('music'), bg: () => this.go('background'), skins: () => this.go('skins'),
      leaderboard: () => this.openLeaderboard(), howto: () => this.go('howto'), stats: () => this.go('stats'), settings: () => this.go('settings'),
      mute: () => app.setAudio({ muted: !audio.settings.muted }),
      fs: () => this.toggleFullscreen(),
      rename: () => this.renameModal(),
    });
    return s;
  }
  toggleFullscreen() {
    const d = document, r = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
    } catch { this.toast('Fullscreen is not available on this device.'); }
  }
  renameModal() {
    const app = this.app;
    this.openModal(`<h3>Edit player name</h3>
      <label class="f">Display name<input type="text" id="nm" maxlength="${NAME_MAX}" value="${esc(app.sd.username)}" autocomplete="off" /></label>
      <div class="err" id="nmErr"></div>
      <div class="btn-row"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">Save</button></div>`, {
      cancel: () => this.closeModal(),
      save: () => {
        const v = sanitizeName(this.modal.querySelector('#nm').value);
        if (!validName(v)) { this.modal.querySelector('#nmErr').textContent = 'Please enter a name (1–16 characters).'; return; }
        app.sd.username = v; app.persist(); this.closeModal();
        const w = document.getElementById('who'); if (w) w.textContent = v;
        const n = document.getElementById('setName'); if (n) n.value = v;
        this.toast('Name saved');
      },
    });
  }

  // ------------------------------------------------------------ level select
  screen_levels() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    const notice = bank.count() === 0 ? `<div class="status-line warn" style="max-width:1000px;margin-bottom:6px">⚠ Creator setup: no approved Bible questions yet. Coins will show a setup notice until questions are added (Settings → Question Manager).</div>` : '';
    s.appendChild(this.head('Level Select'));
    if (notice) s.insertAdjacentHTML('beforeend', notice);
    // v6: Casual (3 lives + checkpoints) or Hardcore (one hit restarts the level)
    const hc = !!sd.hardcore;
    s.insertAdjacentHTML('beforeend', `<div class="modepick" role="radiogroup" aria-label="Difficulty">
      <button class="mp ${hc ? '' : 'on'}" data-act="casual" role="radio" aria-checked="${!hc}"><b>Casual</b><small>3 lives · checkpoints</small></button>
      <button class="mp ${hc ? 'on' : ''}" data-act="hardcore" role="radio" aria-checked="${hc}"><b>💀 Hardcore</b><small>one hit restarts the level</small></button>
    </div>`);
    const stars = (d) => { const b = sd.best[d.id]; const n = sd.completed[d.id] ? 3 : b ? (b.score >= 66 ? 2 : b.score >= 33 ? 1 : 0) : 0; return [0, 1, 2].map((i) => STAR(i < n)).join(''); };
    const secretRow = (d) => { const a = (sd.secrets || {})[d.id] || []; return `<span class="secrets" title="Secret coins">${Array.from({ length: d.secrets || 0 }, (_, i) => `<i class="${a[i] ? 'got' : ''}"></i>`).join('')}</span>`; };
    const cards = LEVEL_DEFS.map((d) => {
      const b = sd.best[d.id];
      return `<button class="card scene ${sd.lastLevel === d.id ? 'sel' : ''}" data-act="lvl" data-id="${d.id}">
        <canvas width="480" height="540" data-bg="${d.id - 1}"></canvas>
        <div class="scene-ov"><div class="lvl-num">${d.id}</div><div class="lvl-name">${esc(d.name.toUpperCase())}</div><div class="stars">${stars(d)}</div>
        <div class="lvl-meta">${secretRow(d)} ${(sd.hardcoreDone || {})[d.id] ? '<span class="badge bad" title="Beaten on Hardcore">💀 Hardcore clear</span>' : ''}</div>
        <div class="lvl-meta lvl-modes">${(d.zoneKinds || []).filter((k, i, a) => a.indexOf(k) === i).map((k) => `<span class="mtag ${k}">${{ ship: 'Fly', wave: 'Wave', grav: 'Gravity', shipwave: 'Fly→Wave', waveship: 'Wave→Fly' }[k] || k}</span>`).join('')}</div>
        <div class="lvl-meta"><span class="badge ${d.id === 1 ? 'ok' : d.id === 2 ? 'warn' : 'bad'}">${d.difficulty}</span> ${b ? `Best ${b.score.toFixed(1)}%` : 'Not played'}</div>${songOf(d) ? `<div class="lvl-meta" style="margin-top:4px">♫ ${esc(songOf(d).title)} · ${songOf(d).bpm} BPM</div>` : ''}</div>
      </button>`;
    }).join('');
    const wrap = el('div', 'cards scenes', cards);
    s.appendChild(wrap);
    wrap.querySelectorAll('canvas').forEach((cv) => {
      const bg = BACKGROUNDS[Number(cv.dataset.bg)];
      this.makePreview(cv, (pen, W, H, t) => { const beat = t * 2; bg.draw(pen, W, H, t, Math.exp(-5 * (beat - Math.floor(beat))), t * 3, 10, true); pen.rect(0, H * 0.86, W, H * 0.14, bg.ground, 1); pen.rect(0, H * 0.86, W, bg.grass ? 8 : 4, bg.groundTop, 1); });
    });
    const setHc = (v) => { sd.hardcore = v; app.persist(); s.querySelectorAll('.mp').forEach((b) => { const on = (b.dataset.act === 'hardcore') === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); };
    this.on(s, { back: () => this.go('main'), casual: () => setHc(false), hardcore: () => setHc(true), lvl: (b) => { sd.lastLevel = Number(b.dataset.id); app.persist(); app.startLevel(sd.lastLevel); } });
    return s;
  }

  // ------------------------------------------------------------ music select
  screen_music() {
    const app = this.app;
    const s = this.screenEl();
    s.appendChild(this.head('Music'));
    const eq = '<span class="eq"><i></i><i></i><i></i><i></i><i></i></span>';
    const cards = SONG_IDS.map((id, i) => {
      const m = getBeatMap(id), used = LEVEL_DEFS.filter((l) => l.song === id);
      return `<div class="card scene music" data-i="${i}">
        <canvas width="480" height="270" data-bg="${i}"></canvas>
        <button class="playbtn" data-act="preview" data-id="${id}" aria-label="Preview ${esc(m.title)}">▶</button>
        <div class="music-info"><h3>${esc(m.title)}</h3><p>${m.bpm} BPM · ${fmtDur(m.duration)} · ${used.length ? 'plays in ' + used.map((l) => 'Level ' + l.id).join(' & ') : 'not used in a level yet'}</p>${eq}</div>
      </div>`;
    }).join('');
    s.appendChild(el('div', 'cards', cards));
    s.querySelectorAll('canvas').forEach((cv) => {
      const bg = BACKGROUNDS[Number(cv.dataset.bg)];
      const bpm = getBeatMap(SONG_IDS[Number(cv.dataset.bg)]).bpm;
      this.makePreview(cv, (pen, W, H, t) => { const beat = t * (bpm / 60); bg.draw(pen, W, H, t, Math.exp(-5 * (beat - Math.floor(beat))), t * 3, 10, true); });
    });
    s.insertAdjacentHTML('beforeend', `<div class="panel" style="width:min(700px,100%);margin-top:12px">
      <div class="setting"><span>Every level is built on its song<small>Obstacles sit on the song's real kicks and snares, and the world pulses with the music.</small></span></div>
      <div class="setting"><span>Rhythm jump cues<small>Soft clicks and markers that show the exact moment to jump.</small></span><label class="switch"><input type="checkbox" id="cues" ${audio.settings.cues ? 'checked' : ''}><i></i></label></div>
      <div class="setting"><span>Music volume</span><input type="range" id="vol" min="0" max="100" value="${Math.round(audio.settings.music * 100)}" style="max-width:260px"></div>
      ${syncRow()}
    </div>`);
    s.querySelector('#cues').addEventListener('change', (e) => app.setAudio({ cues: e.target.checked }));
    s.querySelector('#vol').addEventListener('input', (e) => app.setAudio({ music: e.target.value / 100 }));
    bindSync(s, app);
    const resetPlay = () => s.querySelectorAll('.playbtn').forEach((x) => { x.textContent = '▶'; x.closest('.card').classList.remove('playing'); });
    this.on(s, {
      back: () => this.go('main'),
      preview: async (b) => {
        const id = b.dataset.id;
        if (audio.previewing && audio.song === id) { audio.stopPreview(); resetPlay(); return; }
        audio.unlock();
        resetPlay();
        b.textContent = '…';
        const m = getBeatMap(id);
        // start a few beats before the first drop so the preview shows off the song
        const from = Math.max(0, ((m.drops[0] || 16) - 8) * m.spb);
        const ok = await audio.previewSong(id, from, 26);
        if (ok) { b.textContent = '■'; b.closest('.card').classList.add('playing'); } else { b.textContent = '▶'; this.toast('Could not play the song on this device.'); }
      },
    });
    return s;
  }

  // ------------------------------------------------------------ background select
  screen_background() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    s.appendChild(this.head('Background Select'));
    const cards = BACKGROUNDS.map((b, i) => `<div class="card ${sd.bg === i ? 'sel' : ''}">
        <canvas width="480" height="270" data-i="${i}"></canvas>
        <h3>${esc(b.name)}</h3><p>${esc(b.blurb)}</p>
        <button class="btn small primary" data-act="pick" data-i="${i}">${sd.bg === i ? '✓ Selected' : 'Select'}</button></div>`).join('');
    s.appendChild(el('div', 'cards', cards));
    s.querySelectorAll('canvas').forEach((cv) => {
      const bg = BACKGROUNDS[Number(cv.dataset.i)];
      this.makePreview(cv, (pen, W, H, t) => { const beat = t * 2; bg.draw(pen, W, H, t, Math.exp(-5 * (beat - Math.floor(beat))), t * 3, 14, true); pen.rect(0, H * 0.82, W, H * 0.18, bg.ground, 1); pen.rect(0, H * 0.82, W, 3, bg.groundTop, 1); });
    });
    this.on(s, {
      back: () => this.go('main'),
      pick: (b) => {
        sd.bg = Number(b.dataset.i); app.persist(); audio.sfx('select');
        s.querySelectorAll('.card').forEach((c, i) => { c.classList.toggle('sel', i === sd.bg); c.querySelector('[data-act=pick]').textContent = i === sd.bg ? '✓ Selected' : 'Select'; });
      },
    });
    return s;
  }

  // ------------------------------------------------------------ skins
  screen_skins() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    s.appendChild(this.head('Character Skins'));
    const tot = sd.totals.correct;
    s.insertAdjacentHTML('beforeend', `<div class="menu-sub" style="margin-bottom:6px">Correct Bible answers so far: <b style="color:var(--gold)">${tot}</b> · Skins are cosmetic only — they never change gameplay.</div>`);
    const wrap = el('div', 'cards scroll');
    wrap.style.maxHeight = '72%';
    wrap.innerHTML = SKINS.map((k) => {
      const unlocked = sd.unlocked.includes(k.id);
      return `<div class="card ${sd.skin === k.id ? 'sel' : ''} ${unlocked ? '' : 'locked'}" data-id="${k.id}">
        <canvas width="320" height="180"></canvas>
        <h3>${esc(k.name)}</h3><p>${esc(k.blurb)}</p>
        ${unlocked ? `<button class="btn small primary" data-act="equip" data-id="${k.id}" ${sd.skin === k.id ? 'disabled' : ''}>${sd.skin === k.id ? '✓ Equipped' : 'Equip'}</button>` : `<button class="btn small" data-act="equip" data-id="${k.id}" disabled>🔒 Locked</button>`}
        ${unlocked ? '' : `<div class="lock-ov"><span>🔒<br>${k.need} Correct Answers<br><small>${Math.min(tot, k.need)} / ${k.need}</small></span></div>`}
      </div>`;
    }).join('');
    s.appendChild(wrap);
    wrap.querySelectorAll('.card').forEach((c) => {
      const skin = SKINS.find((x) => x.id === c.dataset.id);
      const cv = c.querySelector('canvas');
      this.makePreview(cv, (pen, W, H, t) => {
        pen.rect(0, 0, W, H, 0x120c35, 1); pen.rect(0, H * 0.72, W, H * 0.28, 0x2a1d63, 1); pen.rect(0, H * 0.72, W, 3, 0xd9ccff, 1);
        const cyc = (t * 0.8) % 1, hop = cyc < 0.55 ? Math.sin((cyc / 0.55) * Math.PI) * H * 0.3 : 0;
        const sz = H * 0.3;
        skin.draw(pen, W / 2, H * 0.72 - sz / 2 - hop, sz, -(cyc < 0.55 ? cyc / 0.55 : 1) * Math.PI / 2, t, true);
      });
    });
    this.on(s, {
      back: () => this.go('main'),
      equip: (b) => {
        const id = b.dataset.id;
        if (!sd.unlocked.includes(id)) { this.toast('That skin is still locked.'); return; }
        sd.skin = id; app.persist(); audio.sfx('select');
        wrap.querySelectorAll('.card').forEach((c) => {
          const on = c.dataset.id === id; c.classList.toggle('sel', on);
          const bt = c.querySelector('[data-act=equip]'); if (!c.classList.contains('locked')) { bt.disabled = on; bt.textContent = on ? '✓ Equipped' : 'Equip'; }
        });
      },
    });
    return s;
  }

  // ------------------------------------------------------------ how to play / tutorial
  screen_howto(props = {}) {
    const app = this.app;
    const s = this.screenEl();
    s.appendChild(this.head('How to Play'));
    const grid = el('div', 'howto-grid scroll', HOWTO.map((p) => `<div class="tile"><div class="ico">${p.icon}</div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join(''));
    s.appendChild(grid);
    s.insertAdjacentHTML('beforeend', `<div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="try">▶ Try a practice run</button><button class="btn ghost" data-act="done">${props.first ? 'Skip tutorial' : 'Main menu'}</button></div>`);
    this.on(s, {
      back: () => { if (props.first) { app.sd.tutorialDone = true; app.persist(); } this.go('main'); },
      done: () => { app.sd.tutorialDone = true; app.persist(); this.go('main'); },
      try: () => { app.sd.tutorialDone = true; app.persist(); app.startLevel(0, { practice: true }); },
    });
    return s;
  }

  // ------------------------------------------------------------ statistics
  screen_stats() {
    const app = this.app, sd = app.sd, tot = sd.totals;
    const s = this.screenEl();
    s.appendChild(this.head('Player Statistics'));
    const acc = tot.correct + tot.incorrect ? Math.round((tot.correct / (tot.correct + tot.incorrect)) * 100) : 0;
    const statusChip = (h) => ({ none: '<span class="badge">Not submitted</span>', pending: '<span class="badge warn">PENDING</span>', sent: '<span class="badge ok">SAVED ✓</span>', rejected: '<span class="badge bad">Rejected</span>' }[h.submit] || '');
    const body = el('div', 'panel scroll');
    body.style.cssText = 'width:min(1000px,100%);max-height:78%';
    body.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${esc(sd.username)}</b><span>Player</span></div>
        <div class="stat"><b>${tot.runs}</b><span>Runs</span></div>
        <div class="stat"><b>${fmtTime(tot.playTime)}</b><span>Time played</span></div>
        <div class="stat"><b>${Math.round(tot.distance).toLocaleString()}m</b><span>Distance</span></div>
        <div class="stat"><b>${tot.correct}</b><span>Correct answers</span></div>
        <div class="stat"><b>${tot.incorrect}</b><span>Incorrect</span></div>
        <div class="stat"><b>${acc}%</b><span>Accuracy</span></div>
        <div class="stat"><b>${sd.unlocked.length}/${SKINS.length}</b><span>Skins</span></div>
      </div>
      <h3 style="color:var(--gold);margin:14px 0 6px">Personal bests</h3>
      <table class="table-simple"><tr><th>Level</th><th>Progress</th><th>Distance</th><th>Time</th><th>✓ / ✗</th></tr>
      ${LEVEL_DEFS.map((d) => { const b = sd.best[d.id]; return `<tr><td>${d.id}. ${esc(d.name)} ${sd.completed[d.id] ? '✓' : ''}</td>${b ? `<td>${b.score.toFixed(1)}%</td><td>${b.distance.toFixed(0)}m</td><td>${fmtTime(b.time)}</td><td>${b.correct} / ${b.incorrect}</td>` : '<td colspan="4">—</td>'}</tr>`; }).join('')}
      </table>
      <h3 style="color:var(--gold);margin:14px 0 6px">Recent runs</h3>
      ${sd.history.length ? `<table class="table-simple"><tr><th>Date</th><th>Level</th><th>Progress</th><th>Time</th><th>✓/✗</th><th>Global score</th></tr>
      ${sd.history.slice(0, 12).map((h) => `<tr><td>${new Date(h.date).toLocaleDateString()}</td><td>${h.levelId}</td><td>${h.progress.toFixed(1)}%${h.completed ? ' ✓' : ''}</td><td>${fmtTime(h.time)}</td><td>${h.correct}/${h.incorrect}</td><td>${statusChip(h)}</td></tr>`).join('')}</table>` : '<p class="menu-sub">No runs yet — go play!</p>'}`;
    s.appendChild(body);
    this.on(s, { back: () => this.go('main') });
    return s;
  }

  // ------------------------------------------------------------ settings
  screen_settings() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    s.appendChild(this.head('Settings'));
    const body = el('div', 'panel scroll');
    body.style.cssText = 'width:min(760px,100%);max-height:80%';
    body.innerHTML = `
      <label class="f">Player name (public on the leaderboard)<div style="display:flex;gap:8px"><input type="text" id="setName" maxlength="${NAME_MAX}" value="${esc(sd.username)}"><button class="btn small primary" data-act="saveName">Save</button></div></label>
      <div class="err" id="nmErr"></div>
      <div class="setting"><span>Music Volume</span><span class="sl"><input type="range" id="mv" min="0" max="100" value="${Math.round(audio.settings.music * 100)}"><b id="mvp">${Math.round(audio.settings.music * 100)}%</b></span></div>
      <div class="setting"><span>Effects Volume</span><span class="sl"><input type="range" id="sv" min="0" max="100" value="${Math.round(audio.settings.sfx * 100)}"><b id="svp">${Math.round(audio.settings.sfx * 100)}%</b></span></div>
      <div class="setting"><span>Mute all audio</span><label class="switch"><input type="checkbox" id="mute" ${audio.settings.muted ? 'checked' : ''}><i></i></label></div>
      <div class="setting"><span>Rhythm jump cues<small>Clicks and markers that show the best jump moment</small></span><label class="switch"><input type="checkbox" id="cues" ${audio.settings.cues ? 'checked' : ''}><i></i></label></div>
      ${syncRow()}
      <div class="setting"><span>Render quality<small>Auto uses your screen's native sharpness (up to 4K on desktop)</small></span>
        <select id="q" style="width:auto"><option value="auto">Auto (native)</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">4K (2160p)</option></select></div>
      <div class="setting"><span>Reduced effects<small>Fewer particles and glow for older phones</small></span><label class="switch"><input type="checkbox" id="red" ${app.reduced ? 'checked' : ''}><i></i></label></div>
      <div class="setting"><span>Fullscreen</span><button class="btn small" data-act="fs">⛶ Toggle</button></div>
      <div class="setting"><span>Creator tools<small>${bank.count()} approved question${bank.count() === 1 ? '' : 's'} in the bank</small></span><button class="btn small" data-act="qm">📖 Question Manager</button></div>
      <div class="setting"><span>Global leaderboard<small>${lb.configured ? 'Connected to the online database' : 'Not connected yet (creator must add Supabase keys)'}</small></span><span class="badge ${lb.configured ? 'ok' : 'warn'}">${lb.configured ? 'ONLINE' : 'NOT CONNECTED'}</span></div>
      <div class="setting"><span>Render info<small id="rinfo"></small></span></div>
      <div class="setting"><span>Reset all progress<small>Deletes local stats, unlocks and settings on this device</small></span><button class="btn small danger" data-act="reset">Reset</button></div>`;
    body.querySelector('#q').value = sd.quality;
    s.appendChild(body);
    const ri = app.renderPx;
    if (ri) body.querySelector('#rinfo').textContent = `${ri.w}×${ri.h} px drawn, shown at ${ri.css[0]}×${ri.css[1]} CSS px @${ri.dpr}x`;
    body.querySelector('#mv').addEventListener('input', (e) => { body.querySelector('#mvp').textContent = e.target.value + '%'; app.setAudio({ music: e.target.value / 100 }); });
    body.querySelector('#sv').addEventListener('input', (e) => { body.querySelector('#svp').textContent = e.target.value + '%'; app.setAudio({ sfx: e.target.value / 100 }); });
    body.querySelector('#sv').addEventListener('change', () => audio.sfx('coin'));
    body.querySelector('#mute').addEventListener('change', (e) => app.setAudio({ muted: e.target.checked }));
    body.querySelector('#cues').addEventListener('change', (e) => app.setAudio({ cues: e.target.checked }));
    bindSync(body, app);
    body.querySelector('#q').addEventListener('change', (e) => { app.setQuality(e.target.value); const ri2 = app.renderPx; body.querySelector('#rinfo').textContent = `${ri2.w}×${ri2.h} px drawn`; });
    body.querySelector('#red').addEventListener('change', (e) => app.setReduced(e.target.checked));
    this.on(s, {
      back: () => this.go('main'),
      fs: () => this.toggleFullscreen(),
      qm: () => this.go('questions'),
      saveName: () => {
        const v = sanitizeName(body.querySelector('#setName').value);
        if (!validName(v)) { body.querySelector('#nmErr').textContent = 'Please enter a name (1–16 characters).'; return; }
        body.querySelector('#nmErr').textContent = ''; sd.username = v; app.persist(); body.querySelector('#setName').value = v; this.toast('Name saved');
      },
      reset: () => this.confirm('Reset all progress?', 'This deletes your stats, unlocked skins, settings and any scores waiting to upload on this device. Online leaderboard records are not affected.', 'Reset everything', () => {
        store.reset(); app.sd = store.data; Object.assign(audio.settings, app.sd.audio); audio.applyVolumes(); app.reduced = false; app.resize(); this.go('welcome');
      }),
    });
    return s;
  }

  // ------------------------------------------------------------ question manager (creator tool)
  screen_questions() {
    const app = this.app;
    const s = this.screenEl();
    s.appendChild(this.head('Question Manager', 'back'));
    const body = el('div', 'panel scroll');
    body.style.cssText = 'width:min(900px,100%);max-height:80%';
    s.appendChild(body);
    let editing = null; // id or 'new'
    let msg = '';
    const render = () => {
      const items = bank.all();
      body.innerHTML = `
        <p class="menu-sub" style="text-align:left">Only questions saved here are ever shown to players. Every question needs <b>exactly three</b> incorrect answers. The game shuffles the four answers and never places the correct answer in the same slot repeatedly.</p>
        <div class="btn-row" style="justify-content:flex-start;margin:8px 0">
          <button class="btn small primary" data-act="new">＋ Add question</button>
          <button class="btn small" data-act="export">⬇ Export JSON</button>
          <label class="btn small" style="display:inline-flex;align-items:center">⬆ Import JSON<input type="file" accept="application/json,.json" id="imp" hidden></label>
          <button class="btn small danger" data-act="clear" ${items.length ? '' : 'disabled'}>Delete all</button>
        </div>
        ${msg ? `<div class="status-line ${msg.startsWith('✓') ? 'ok' : 'bad'}" id="qmsg">${esc(msg)}</div>` : ''}
        ${editing ? form(editing === 'new' ? null : bank.get(editing)) : ''}
        <div class="qlist" style="margin-top:10px">${items.length ? items.map((q) => `<div class="qitem" data-id="${q.id}"><span class="badge diff-${q.difficulty}">${q.difficulty}</span><span class="qt" title="${esc(q.q)}">${esc(q.q)}</span><span class="badge">${q.levels.length ? 'L' + q.levels.join(',') : 'All levels'}</span><button class="btn small" data-act="edit" data-id="${q.id}">Edit</button><button class="btn small danger" data-act="del" data-id="${q.id}">Delete</button></div>`).join('') : '<p class="menu-sub">No questions yet. Click “Add question”.</p>'}</div>`;
      const imp = body.querySelector('#imp');
      if (imp) imp.addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const res = bank.importJSON(await f.text(), false);
        msg = res.imported ? `✓ Imported ${res.imported} question(s).${res.errors.length ? ' Skipped: ' + res.errors.join(' | ') : ''}` : 'Import failed: ' + res.errors.join(' | ');
        render();
      });
    };
    const form = (q) => `<div class="panel" style="background:rgba(255,255,255,0.05);margin-top:8px"><div class="qform">
        <label class="f full">Question<textarea id="fq">${esc(q ? q.q : '')}</textarea></label>
        <label class="f">Correct answer<input type="text" id="fc" value="${esc(q ? q.correct : '')}"></label>
        <label class="f">Scripture reference (optional)<input type="text" id="fr" value="${esc(q ? q.ref : '')}" placeholder="e.g. John 3:16"></label>
        <label class="f">Incorrect answer 1<input type="text" id="fw0" value="${esc(q ? q.wrong[0] : '')}"></label>
        <label class="f">Incorrect answer 2<input type="text" id="fw1" value="${esc(q ? q.wrong[1] : '')}"></label>
        <label class="f">Incorrect answer 3<input type="text" id="fw2" value="${esc(q ? q.wrong[2] : '')}"></label>
        <label class="f">Difficulty<select id="fd">${DIFFS.map((d) => `<option ${q && q.difficulty === d ? 'selected' : !q && d === 'medium' ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="f full">Explanation (optional)<textarea id="fe">${esc(q ? q.expl : '')}</textarea></label>
        <div class="full" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><b style="font-size:13px;color:var(--dim)">Assign to levels (none checked = all):</b>
          ${[1, 2, 3].map((n) => `<label class="chk"><input type="checkbox" class="fl" value="${n}" ${q && q.levels.includes(n) ? 'checked' : ''}>Level ${n}</label>`).join('')}</div>
        <div class="full err" id="ferr"></div>
        <div class="full btn-row"><button class="btn ghost" data-act="cancelEdit">Cancel</button><button class="btn primary" data-act="saveQ">Save question</button></div>
      </div></div>`;
    render();
    const read = () => ({
      q: body.querySelector('#fq').value, correct: body.querySelector('#fc').value, ref: body.querySelector('#fr').value, expl: body.querySelector('#fe').value,
      wrong: [0, 1, 2].map((i) => body.querySelector('#fw' + i).value), difficulty: body.querySelector('#fd').value,
      levels: [...body.querySelectorAll('.fl:checked')].map((c) => Number(c.value)),
    });
    this.on(s, {
      back: () => this.go('settings'),
      new: () => { editing = 'new'; msg = ''; render(); },
      edit: (b) => { editing = b.dataset.id; msg = ''; render(); },
      cancelEdit: () => { editing = null; render(); },
      saveQ: () => {
        const d = read();
        const res = editing === 'new' ? bank.add(d) : bank.update(editing, d);
        if (!res.ok) { body.querySelector('#ferr').textContent = res.errors.join(' '); return; }
        editing = null; msg = '✓ Question saved.'; render();
      },
      del: (b) => this.confirm('Delete this question?', 'It will no longer appear in the game.', 'Delete', () => { bank.remove(b.dataset.id); msg = '✓ Question deleted.'; render(); }),
      clear: () => this.confirm('Delete ALL questions?', 'Export first if you want a backup.', 'Delete all', () => { bank.clear(); msg = '✓ All questions deleted.'; render(); }),
      export: () => {
        const blob = new Blob([bank.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'faith-dash-questions.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        msg = `✓ Exported ${bank.count()} question(s).`; render();
      },
    });
    return s;
  }

  // ------------------------------------------------------------ modal helpers
  openModal(html, handlers) {
    this.closeModal(true);
    const wrap = el('div', 'screen scrim show'); wrap.style.zIndex = 30;
    const p = el('div', 'panel modal'); p.innerHTML = html;
    wrap.appendChild(p); this.over.appendChild(wrap);
    this.modal = wrap; this.on(wrap, handlers);
    const f = wrap.querySelector('input, .btn.primary'); if (f && !matchMedia('(pointer: coarse)').matches) setTimeout(() => f.focus(), 60);
    return wrap;
  }
  closeModal(instant) {
    if (!this.modal) return;
    const m = this.modal; this.modal = null;
    if (instant) m.remove(); else { m.classList.add('leaving'); setTimeout(() => m.remove(), 250); }
  }
  confirm(title, text, okLabel, onOk) {
    this.openModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="btn-row"><button class="btn ghost" data-act="no">Cancel</button><button class="btn danger" data-act="yes">${esc(okLabel)}</button></div>`, {
      no: () => this.closeModal(), yes: () => { this.closeModal(); onOk(); },
    });
  }

  // ------------------------------------------------------------ HUD
  showHud(run, level) {
    this.hudEl.classList.remove('hidden');
    this.hudCache = {};
    this.hudEl.innerHTML = `
      <div class="hud-top">
        <div class="hud-left"><div class="hud-lvl">${run.practice ? 'PRACTICE RUN' : `LEVEL ${level.id} – ${esc(level.name)}`}${run.hardcore ? ' <span class="hc-tag">💀 HARDCORE</span>' : ''}</div>${run.hardcore ? `<div class="hud-attempt" id="attempt">ATTEMPT ${run.attempts}</div>` : `<div class="hearts" id="hearts">${HEART.repeat(3)}</div>`}
        ${(level.secrets || []).length ? `<div class="hud-secrets" id="hsecrets">${level.secrets.map(() => '<i></i>').join('')}</div>` : ''}</div>
        <div class="hud-mid"><div class="hud-prog"><i id="progBar"></i><span class="hud-pct" id="pct">0%</span></div></div>
        <div class="hud-right"><button class="btn icon-btn" data-act="pause" aria-label="Pause" data-nojump>❚❚</button><div class="hud-stats" id="hstats"></div></div>
      </div>
      <div class="hud-beat" id="beatPips"><i></i><i></i><i></i><i></i></div>
      <div class="hud-rating" id="rating"></div>
      <div class="hud-inv" id="inv">🛡 SHIELD</div>
      <div class="hud-dj" id="dj"><b>⇧⇧ DOUBLE JUMP</b><span id="djt"></span><i id="djbar"></i></div>`;
    this.hudEl.querySelector('[data-act=pause]').addEventListener('click', () => this.app.pause());
    this.hudEl.querySelector('[data-act=pause]').addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  hideHud() { this.hudEl.classList.add('hidden'); this.hudEl.innerHTML = ''; }
  updateSecrets(run) {
    const e = this.hudEl.querySelector('#hsecrets'); if (!e) return;
    const a = run.p.secretsGot || [];
    e.querySelectorAll('i').forEach((x, i) => x.classList.toggle('got', !!a[i]));
  }
  // Beat indicator: four pips, one per beat of the bar, the current one lit and throbbing with the kick.
  updateBeat(mu, g) {
    const pips = this.hudEl.querySelector('#beatPips');
    if (!pips) return;
    const c = this.hudCache;
    if (!mu) { if (!c.pipOff) { pips.style.visibility = 'hidden'; c.pipOff = true; } return; }
    if (c.pipOff) { pips.style.visibility = ''; c.pipOff = false; }
    const bi = Math.floor(mu.barPos) % 4;
    if (c.pip !== bi) { c.pip = bi; pips.querySelectorAll('i').forEach((e, i) => e.classList.toggle('on', i === bi)); pips.classList.toggle('down', bi === 0); }
    const kq = Math.round(mu.kick * 10);
    if (c.kq !== kq) { c.kq = kq; pips.style.setProperty('--k', (kq / 10).toFixed(1)); }
  }
  // PERFECT / GREAT / GOOD / EARLY / LATE popup with the running combo
  rating(kind, combo, d) {
    const e = this.hudEl.querySelector('#rating');
    if (!e) return;
    if (!kind) { e.className = 'hud-rating'; e.textContent = ''; return; }
    const label = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', off: d < 0 ? 'EARLY' : 'LATE' }[kind];
    e.textContent = label + (combo >= 3 ? `  ×${combo}` : '');
    e.className = 'hud-rating ' + kind;
    void e.offsetWidth; // restart the pop animation
    e.classList.add('pop');
  }
  heartLost() { const h = this.hudEl.querySelectorAll('.heart'); const idx = Math.max(0, this.app.run.lives); if (h[idx]) { h[idx].classList.add('pop'); } }
  updateHud(run) {
    const c = this.hudCache;
    if (this.hudEl.classList.contains('hidden')) return;
    const pct = run.progress;
    const bar = this.hudEl.querySelector('#progBar');
    if (bar) bar.style.width = pct.toFixed(2) + '%';
    const p1 = Math.floor(pct);
    if (c.pct !== p1) { c.pct = p1; const e = this.hudEl.querySelector('#pct'); if (e) e.textContent = p1 + '%'; }
    const sk = (run.p.secretsGot || []).join('');
    if (c.sk !== sk) { c.sk = sk; this.updateSecrets(run); }
    if (run.hardcore && c.att !== run.attempts) { c.att = run.attempts; const e = this.hudEl.querySelector('#attempt'); if (e) e.textContent = 'ATTEMPT ' + run.attempts; }
    if (c.lives !== run.lives) {
      c.lives = run.lives;
      this.hudEl.querySelectorAll('.heart').forEach((h, i) => { h.classList.toggle('off', i >= run.lives); if (i < run.lives) h.classList.remove('pop'); });
    }
    const key = `${run.correct}|${run.incorrect}|${run.coinsCollected}`;
    if (c.stats !== key) {
      c.stats = key;
      const e = this.hudEl.querySelector('#hstats');
      if (e) e.innerHTML = `${esc(this.app.sd.username)}<br>✓ ${run.correct} · ✗ ${run.incorrect}<br>🪙 ${run.coinsCollected}/${run.level.coins.length}`;
    }
    const left = run.p.djUntil - run.p.t;
    const dj = left > 0 ? Math.ceil(left) : 0;
    if (c.dj !== dj) {
      c.dj = dj;
      const e = this.hudEl.querySelector('#dj'), tt = this.hudEl.querySelector('#djt');
      if (e) e.classList.toggle('on', dj > 0);
      if (tt) tt.textContent = dj + 's';
    }
    const djb = this.hudEl.querySelector('#djbar');
    if (djb && left > 0) djb.style.width = Math.min(100, (left / 15) * 100).toFixed(1) + '%';
    const inv = run.invActive && this.app.fsm.is(S.PLAYING);
    if (c.inv !== inv) { c.inv = inv; const e = this.hudEl.querySelector('#inv'); if (e) e.classList.toggle('on', inv); }
  }

  // ------------------------------------------------------------ pause
  showPause(why) {
    this.hidePause();
    const s = this.screenEl('scrim'); s.style.zIndex = 20;
    const lastWhy = why === 'hidden' || why === 'blur' ? '<p class="menu-sub">The game was paused automatically.</p>' : '';
    s.innerHTML = `<div class="panel modal"><h3>Paused</h3>${lastWhy}
      <button class="btn primary" data-act="resume">▶ Resume</button>
      <button class="btn" data-act="restart">↻ Restart level</button>
      <div class="setting" style="border:none"><span>Music</span><input type="range" id="pmv" min="0" max="100" value="${Math.round(audio.settings.music * 100)}" style="max-width:160px"></div>
      <button class="btn" data-act="mute" data-silent="1">${audio.settings.muted ? '🔇 Unmute' : '🔊 Mute'}</button>
      <button class="btn" data-act="levels">🗺 Level Select</button>
      <button class="btn ghost" data-act="menu">⌂ Main Menu</button></div>`;
    this.over.appendChild(s); this.pauseEl = s;
    requestAnimationFrame(() => s.classList.add('show'));
    s.querySelector('#pmv').addEventListener('input', (e) => this.app.setAudio({ music: e.target.value / 100 }));
    this.on(s, {
      resume: () => this.app.resume(),
      restart: () => { this.hidePause(); this.app.restart(); },
      mute: (b) => { this.app.setAudio({ muted: !audio.settings.muted }); b.textContent = audio.settings.muted ? '🔇 Unmute' : '🔊 Mute'; },
      levels: () => { this.hidePause(); this.app.quitToMenu(); this.go('levels'); },
      menu: () => this.confirm('Quit to main menu?', 'Your current run will end (it will not be submitted).', 'Quit', () => { this.hidePause(); this.app.quitToMenu(); }),
    });
  }
  hidePause() { if (this.pauseEl) { const p = this.pauseEl; this.pauseEl = null; p.classList.remove('show'); p.classList.add('leaving'); setTimeout(() => p.remove(), 300); } }

  // ------------------------------------------------------------ trivia
  showTrivia(t, run) {
    this.hideTrivia(true);
    const s = this.screenEl('scrim'); s.style.zIndex = 15;
    if (t.empty) {
      s.innerHTML = `<div class="panel setup-notice modal"><h2>🪙 Creator setup needed</h2>
        <p>This coin would show a Bible question, but <b>no approved questions have been added yet</b>, so the game will not invent any.</p>
        <p class="menu-sub">Creator: open Settings → Question Manager to add questions. No lives were gained or lost.</p>
        <button class="btn primary" data-act="ok" id="okBtn">Continue</button></div>`;
      this.on(s, { ok: () => { this.app.fsm.go(S.TRIVIA_RESULT, 'setup notice'); this.app.continueAfterTrivia(); } });
    } else {
      const q = t.question, keys = ['A', 'B', 'C', 'D'];
      s.innerHTML = `<div class="panel trivia" role="dialog" aria-label="Bible question">
        <div class="trivia-head"><span class="t-title"><i class="book">✝</i> BIBLE TRIVIA QUESTION</span><span id="tlives" aria-label="lives">${this.heartsText(run.lives)}</span></div>
        <div class="trivia-q">${esc(q.text)}</div>
        <div class="answers">${q.options.map((o, i) => `<button class="ans" data-act="ans" data-i="${i}"><span class="key">${keys[i]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div class="trivia-foot"><span class="menu-sub" id="thint">Choose an answer, review it, then press Submit.</span><button class="btn primary" data-act="submit" disabled>Submit Answer</button></div></div>`;
      this.on(s, { ans: (b) => this.app.selectAnswer(Number(b.dataset.i)), submit: () => this.app.submitAnswer() });
    }
    this.over.appendChild(s); this.triviaEl = s;
    requestAnimationFrame(() => s.classList.add('show'));
  }
  heartsText(n) { return '❤'.repeat(n) + '<span style="opacity:.3">' + '❤'.repeat(Math.max(0, 3 - n)) + '</span>'; }
  markSelected(i) {
    if (!this.triviaEl) return;
    this.triviaEl.querySelectorAll('.ans').forEach((b, k) => b.classList.toggle('sel', k === i));
    const sub = this.triviaEl.querySelector('[data-act=submit]'); if (sub) sub.disabled = false;
  }
  showTriviaResult(t, res, run) {
    const s = this.triviaEl; if (!s) return;
    const btns = s.querySelectorAll('.ans');
    btns.forEach((b, i) => {
      b.disabled = true; b.classList.remove('sel');
      if (i === res.correctIdx) b.classList.add('right');
      else if (i === res.selected) b.classList.add('wrong');
    });
    const q = t.question;
    const foot = s.querySelector('.trivia-foot');
    const lifeTxt = run.hardcore ? (res.correct ? 'Keep going!' : 'Hardcore: the level restarts') : res.correct ? (res.livesBefore >= 3 ? 'Hearts already full' : '+1 heart') : (res.gameOver ? 'No hearts left' : '−1 heart');
    s.querySelector('#tlives').innerHTML = this.heartsText(res.livesAfter);
    foot.outerHTML = `<div class="explain" id="tinfo">
        <div class="verdict ${res.correct ? 'ok' : 'bad'}"><span class="vmark">${res.correct ? '✓' : '✕'}</span> ${res.correct ? 'Correct Answer!' : 'Incorrect Answer'} <small style="font-size:.55em;opacity:.9">${lifeTxt}</small></div>
        ${res.correct ? '' : `<div>Correct answer: <b>${esc(q.options[res.correctIdx])}</b></div>`}
        ${q.ref ? `<div><b>${esc(q.ref)}</b></div>` : ''}${q.expl ? `<div>${esc(q.expl)}</div>` : ''}
      </div>
      <div class="btn-row"><button class="btn primary" data-act="cont">${res.gameOver ? 'See results' : res.restart ? 'Restart level' : 'Continue (2s Invincibility)'}</button>${res.gameOver || res.restart ? '' : SHIELD}</div>`;
    this.on(s, { cont: () => this.app.continueAfterTrivia() });
  }
  hideTrivia(instant) {
    if (!this.triviaEl) return;
    const t = this.triviaEl; this.triviaEl = null;
    if (instant) t.remove(); else { t.classList.remove('show'); t.classList.add('leaving'); setTimeout(() => t.remove(), 250); }
  }

  // ------------------------------------------------------------ results
  hideResults() { if (this.resultsEl) { this.resultsEl.remove(); this.resultsEl = null; } this.resultsAnim = null; }
  showResults(sum, kind, run, practice) {
    this.hideResults();
    this.toastEl.innerHTML = '';
    const app = this.app, sd = app.sd;
    const s = this.screenEl('scrim'); s.style.zIndex = 12;
    const win = kind === 'complete';
    if (practice) {
      s.innerHTML = `<div class="results panel"><h2 class="win">Practice complete!</h2><p>${win ? 'Nice work — you are ready for the real levels.' : 'Out of hearts — no problem, it is only practice!'}</p>
        <div class="btn-row"><button class="btn primary" data-act="play1">▶ Play Level 1</button><button class="btn" data-act="again">↻ Practice again</button><button class="btn ghost" data-act="menu">⌂ Main Menu</button></div></div>`;
      this.on(s, { play1: () => { this.hideResults(); app.startLevel(1); }, again: () => { this.hideResults(); app.restart(); }, menu: () => { this.hideResults(); app.quitToMenu(); } });
    } else {
      s.innerHTML = `<div class="results panel">
        <h2 class="${win ? 'win' : 'go'}">${win ? '★ Level Complete! ★' : 'Game Over'}</h2>
        <div class="res-name">${esc(sd.username)} · Level ${sum.levelId}: ${esc(sum.levelName)}</div>
        <div class="res-score"><span id="rs">0.0</span><small> / 100 pts</small></div>
        <div class="stat-grid">
          <div class="stat"><b>${sum.progress.toFixed(1)}%</b><span>Completion</span></div>
          <div class="stat"><b>${Math.round(sum.distance).toLocaleString()}m</b><span>Distance</span></div>
          <div class="stat"><b>${fmtTime(sum.time)}</b><span>Play time</span></div>
          <div class="stat"><b style="color:var(--ok)">${sum.correct}</b><span>Correct</span></div>
          <div class="stat"><b style="color:var(--bad)">${sum.incorrect}</b><span>Incorrect</span></div>
          ${sum.groove && sum.groove.rated ? `<div class="stat"><b style="color:var(--gold)">${sum.groove.perfect}</b><span>Perfect jumps</span></div><div class="stat"><b>${sum.groove.best}</b><span>Best combo</span></div>` : ''}
          ${sum.secretsTotal ? `<div class="stat"><b style="color:var(--gold)">${(sum.secrets || []).filter(Boolean).length}/${sum.secretsTotal}</b><span>Secret coins${win ? '' : ' (finish to keep)'}</span></div>` : ''}
          ${sum.hardcore ? `<div class="stat"><b style="color:var(--bad)">${sum.attempts}</b><span>💀 Attempts</span></div>` : ''}
        </div>
        ${win && sum.secretsNew > 0 ? `<div class="status-line ok">◆ ${sum.secretsNew} new secret coin${sum.secretsNew > 1 ? 's' : ''} saved!</div>` : ''}
        ${win && sum.hardcore ? '<div class="status-line ok">💀 Beaten on Hardcore!</div>' : ''}
        ${run.newBest ? '<div class="status-line ok">🏅 New personal best on this device!</div>' : ''}
        <div class="status-line" id="subStatus">Your score is not on the global leaderboard yet.</div>
        <div class="btn-row">
          <button class="btn primary" data-act="submit" id="subBtn">🏆 Submit High Score</button>
          <button class="btn" data-act="lb">View Global Leaderboard</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="restart">↻ Restart</button>
          ${win && sum.levelId < 3 ? '<button class="btn" data-act="next">Next Level ▶</button>' : ''}
          <button class="btn ghost" data-act="menu">⌂ Main Menu</button>
        </div></div>`;
      const rs = s.querySelector('#rs'); let shown = 0; const target = sum.score;
      this.resultsAnim = (dt) => { if (shown < target) { shown = Math.min(target, shown + Math.max(target / 1.2 * dt, 0.2)); rs.textContent = shown.toFixed(1); } else { rs.textContent = target.toFixed(1); this.resultsAnim = null; } };
      this.on(s, {
        submit: () => this.submitDialog(sum, run),
        lb: () => this.openLeaderboard(true),
        restart: () => { this.hideResults(); app.restart(); },
        next: () => { this.hideResults(); app.sd.lastLevel = sum.levelId + 1; app.startLevel(sum.levelId + 1); },
        menu: () => { this.hideResults(); app.quitToMenu(); },
      });
    }
    this.over.appendChild(s); this.resultsEl = s; this.resultsRun = run; this.resultsSum = sum;
    requestAnimationFrame(() => s.classList.add('show'));
    this.setSubStatus(sum);
  }
  setSubStatus(sum, extra) {
    const st = document.getElementById('subStatus'), btn = document.getElementById('subBtn');
    if (!st || !btn) return;
    let cls = '', txt = 'Your score is not on the global leaderboard yet.';
    if (sum.submit === 'sent') {
      const r = sum.result || {};
      cls = 'ok'; txt = `SUBMITTED ✓ — Global rank #${r.level_rank || '?'} on this level${r.overall_rank ? ` · overall #${r.overall_rank}` : ''}${r.is_personal_best === false ? ' (not a new personal best — recorded in your run history)' : ''}`;
      btn.disabled = true; btn.textContent = '✓ Score Submitted';
    } else if (sum.submit === 'pending') {
      cls = 'warn';
      txt = sum.error === 'not_configured' ? 'PENDING — saved on this device. The global leaderboard is not connected yet, so this score is NOT global. It will upload when the creator connects the online database.' : 'PENDING — saved on this device. ' + (extra || 'Could not upload yet; tap Submit to retry.');
      btn.textContent = sum.error === 'not_configured' ? '🏆 Saved (pending)' : '↻ Retry Submit';
      btn.disabled = sum.error === 'not_configured';
    } else if (sum.submit === 'rejected') { cls = 'bad'; txt = 'The server rejected this run. ' + (extra || ''); btn.disabled = true; }
    st.className = 'status-line ' + cls; st.textContent = txt;
  }
  submitDialog(sum, run) {
    const app = this.app;
    if (sum.submit === 'sent') return;
    this.openModal(`<h3>Submit High Score</h3>
      <p>Your score will appear publicly on the global leaderboard with the display name below.</p>
      <div class="stat-grid"><div class="stat"><b>${sum.score.toFixed(1)}</b><span>Score</span></div><div class="stat"><b>${Math.round(sum.distance)}m</b><span>Distance</span></div><div class="stat"><b>${sum.correct}/${sum.incorrect}</b><span>✓ / ✗</span></div></div>
      <label class="f">Public display name<input type="text" id="sn" maxlength="${NAME_MAX}" value="${esc(app.sd.username)}" autocomplete="off"></label>
      <div class="err" id="snErr"></div>
      <div class="btn-row"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" data-act="confirm" id="cf">Confirm &amp; Submit</button></div>`, {
      cancel: () => this.closeModal(),
      confirm: async () => {
        const inp = this.modal.querySelector('#sn'), err = this.modal.querySelector('#snErr'), cf = this.modal.querySelector('#cf');
        const name = sanitizeName(inp.value);
        if (!validName(name)) { err.textContent = 'Please enter a name (1–16 characters).'; return; }
        cf.disabled = true; cf.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:3px;display:inline-block;vertical-align:middle"></span> Sending…';
        app.fsm.go(S.SCORE_SUBMISSION, 'submit');
        const res = await app.submitScore(sum, name);
        this.closeModal();
        if (app.fsm.is(S.SCORE_SUBMISSION)) app.fsm.go(sum.status === 'completed' ? S.LEVEL_COMPLETE : S.GAME_OVER, 'submit done');
        if (res.ok) { audio.sfx('submit'); this.setSubStatus(sum); if (res.data) this.toast(`Global rank #${res.data.level_rank}`); else this.toast('Saved on this device'); }
        else this.setSubStatus(sum, res.error);
        if (!res.ok && !res.retry) this.toast(res.error, 5);
      },
    });
    app.fsm.go(S.SCORE_SUBMISSION, 'open dialog');
    this.modal.querySelector('[data-act=cancel]').addEventListener('click', () => { if (app.fsm.is(S.SCORE_SUBMISSION)) app.fsm.go(sum.status === 'completed' ? S.LEVEL_COMPLETE : S.GAME_OVER, 'cancel'); });
  }

  // ------------------------------------------------------------ leaderboard
  openLeaderboard(fromResults = false) {
    const app = this.app;
    this.lbReturn = null;
    if (fromResults) {
      this.lbReturn = { state: app.fsm.state };
      if (this.resultsEl) this.resultsEl.style.display = 'none';
      if (!app.fsm.go(S.GLOBAL_LEADERBOARD, 'from results')) return;
      this.leaveCurrent(); this.anims = [];
      this.curName = 'leaderboard';
      const el_ = this.screen_leaderboard(); el_.dataset.screen = 'leaderboard';
      this.root.appendChild(el_); this.cur = el_; requestAnimationFrame(() => requestAnimationFrame(() => el_.classList.add('show')));
    } else this.go('leaderboard');
  }
  closeLeaderboard() {
    const app = this.app;
    if (this.lbReturn) {
      const back = this.lbReturn.state; this.lbReturn = null;
      this.leaveCurrent(); this.curName = null;
      app.fsm.go(back, 'leaderboard back');
      if (this.resultsEl) this.resultsEl.style.display = '';
    } else this.go('main');
  }
  screen_leaderboard() {
    const app = this.app, sd = app.sd;
    const s = this.screenEl();
    const st = { scope: 'overall', sort: 'score', token: 0 };
    s.innerHTML = `<div class="lb-panel">
      <div style="display:flex;align-items:center;gap:10px"><button class="btn icon-btn" data-act="back" aria-label="Back">←</button><div class="lb-title" style="flex:1"><i class="trophy">🏆</i> GLOBAL LEADERBOARD</div><button class="btn icon-btn" data-act="refresh" aria-label="Refresh" id="rf">⟳</button></div>
      <div class="tabs" id="tabs">${[['overall', 'Overall'], ['1', 'L1 · The Beginning'], ['2', 'L2 · The Journey'], ['3', 'L3 · The Trial']].map(([k, n]) => `<button class="tab ${k === 'overall' ? 'on' : ''}" data-act="tab" data-k="${k}">${n}</button>`).join('')}</div>
      <div class="lb-tools"><label style="font-weight:700;font-size:13px;color:var(--dim)">Sort by <select id="sort"><option value="score">Highest score (official rank)</option><option value="distance">Greatest distance</option><option value="time">Fastest completion</option><option value="correct">Most correct answers</option><option value="accuracy">Highest accuracy</option></select></label></div>
      <div class="lb-table-wrap scroll" id="lbBody"></div>
      <div class="rank-note" id="lbNote">${esc(RANK_POLICY)}</div>
      <div id="lbPend"></div></div>`;
    const body = s.querySelector('#lbBody');
    const showMsg = (html) => { body.innerHTML = `<div class="lb-empty">${html}</div>`; };
    const pend = () => {
      const p = app.pendingRuns();
      s.querySelector('#lbPend').innerHTML = p.length ? `<div class="status-line warn" style="text-align:center">⏳ ${p.length} score${p.length > 1 ? 's' : ''} on this device ${lb.configured ? 'waiting to upload' : 'saved but NOT global yet'} — <button class="btn small" data-act="retry" ${lb.configured ? '' : 'disabled'}>Upload now</button></div>` : '';
    };
    const load = async () => {
      const my = ++st.token;
      s.querySelector('#rf').classList.add('spin');
      if (!lb.configured) {
        showMsg(`<div class="big">🔌</div><h3 style="margin:0;color:var(--gold)">Global leaderboard not connected</h3><p style="max-width:520px;margin:0">No online database is configured, so there are no global scores to show. Scores you submit are kept on this device as <b>PENDING</b> and will upload once the creator connects the backend (see the README → “Connect the global leaderboard”).</p>`);
        pend(); return;
      }
      showMsg('<div class="spinner"></div><div>Loading scores…</div>');
      const r = await lb.board(st.scope, st.sort, sd.playerId);
      if (my !== st.token) return;
      if (!r.ok) { showMsg(`<div class="big">⚠</div><div class="err" style="max-width:520px">${esc(r.error)}</div><button class="btn primary" data-act="refresh">Try again</button>`); pend(); return; }
      const rows = (r.data && r.data.rows) || [];
      if (!rows.length) { showMsg(`<div class="big">👑</div><h3 style="margin:0;color:var(--gold)">No scores yet</h3><p style="margin:0">Be the first name on the board!</p>`); pend(); return; }
      const showLevel = st.scope !== 'overall';
      body.innerHTML = `<table class="lb"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Distance</th><th>Time</th><th>✓</th><th>✗</th><th>${showLevel ? 'Level' : 'Levels'}</th><th>Done</th><th>Date</th></tr></thead><tbody>${rows.map((x, i) => `<tr class="in ${x.official_rank <= 3 ? 'top' + x.official_rank : ''} ${x.is_me ? 'me' : ''}" style="animation-delay:${Math.min(i, 20) * 35}ms"><td>${x.official_rank <= 3 ? ['🥇', '🥈', '🥉'][x.official_rank - 1] : '#' + x.official_rank}</td><td>${esc(x.display_name)}${x.is_me ? ' (you)' : ''}</td><td class="score">${Number(x.score).toFixed(1)}</td><td>${Math.round(x.distance).toLocaleString()}m</td><td>${fmtTime(x.active_time)}</td><td>${x.correct}</td><td>${x.incorrect}</td><td>${esc(x.level_name || '')}</td><td>${Number(x.progress).toFixed(0)}%</td><td>${x.date ? new Date(x.date).toLocaleDateString() : ''}</td></tr>`).join('')}</tbody></table>`;
      if (r.data.me && !rows.some((x) => x.is_me)) { const m = r.data.me; body.querySelector('tbody').insertAdjacentHTML('beforeend', `<tr class="you"><td>#${m.official_rank}</td><td>You (${esc(m.display_name || sd.username)})</td><td class="score">${Number(m.score).toFixed(1)}</td><td>${Math.round(m.distance || 0).toLocaleString()}m</td><td>${fmtTime(m.active_time || 0)}</td><td>${m.correct ?? ''}</td><td>${m.incorrect ?? ''}</td><td>${esc(m.level_name || '')}</td><td>${Number(m.progress || 0).toFixed(0)}%</td><td></td></tr>`); }
      s.querySelector('#lbNote').textContent = st.sort === 'score' ? RANK_POLICY : `Sorted by "${s.querySelector('#sort').selectedOptions[0].textContent}" — this only reorders the list. The Rank column always shows the official score-based rank. ` + RANK_POLICY;
      pend();
    };
    this.on(s, {
      back: () => (this.lbReturn ? this.closeLeaderboard() : this.go('main')),
      refresh: () => load(),
      tab: (b) => { st.scope = b.dataset.k; s.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b)); load(); },
      retry: async (b) => {
        b.disabled = true; let ok = 0;
        for (const rec of app.pendingRuns()) { const res = await app.submitScore(rec, rec.name || sd.username); if (res.ok) ok++; }
        this.toast(ok ? `Uploaded ${ok} score${ok > 1 ? 's' : ''}` : 'Could not upload — try again later'); load();
      },
    });
    s.querySelector('#sort').addEventListener('change', (e) => { st.sort = e.target.value; load(); });
    setTimeout(load, 50);
    return s;
  }
}
