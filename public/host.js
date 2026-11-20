/* QuizParty — TV / host screen */
(() => {
  const $ = s => document.querySelector(s);
  const stage = $('#stage');
  const bar = $('#bar');
  const socket = io({ transports: ['websocket', 'polling'] });
  const { Music, SFX } = QPAudio;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let S = null;            // latest state from the server
  let offset = 0;          // server clock - local clock
  let lastKey = '';
  let lastPlayers = 0;
  let phaseTotal = 0;
  let sceneTimers = [];
  const later = (ms, fn) => sceneTimers.push(setTimeout(fn, ms));
  const mediaAudio = new Audio();
  mediaAudio.preload = 'auto';
  let mediaStop = null;
  if (store.get('qp_music') === 'off') Music.setEnabled(false);

  // ---------------- glowing squares background ----------------
  (function buildBg() {
    const grid = $('#bg .grid');
    const glows = ['rgba(255,79,139,.55)', 'rgba(34,211,238,.5)', 'rgba(255,204,0,.5)', 'rgba(155,92,255,.6)'];
    let html = '';
    for (let i = 0; i < 18 * 12; i++) html += `<i style="animation-delay:${(Math.random() * -7).toFixed(2)}s;animation-duration:${(5 + Math.random() * 6).toFixed(2)}s;--g:${glows[i % glows.length]}"></i>`;
    grid.innerHTML = html;
  })();

  // ---------------- confetti ----------------
  const confetti = (() => {
    const cv = $('#confetti'), cx = cv.getContext('2d');
    let parts = [], raf = null;
    const cols = ['#ffcc00', '#ff4f8b', '#22d3ee', '#9b5cff', '#3ee07a', '#ffffff'];
    function resize() { cv.width = innerWidth; cv.height = innerHeight; }
    addEventListener('resize', resize); resize();
    function loop() {
      cx.clearRect(0, 0, cv.width, cv.height);
      parts = parts.filter(p => p.y < cv.height + 40 && p.life-- > 0);
      for (const p of parts) {
        p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
      }
      raf = parts.length ? requestAnimationFrame(loop) : null;
    }
    return (n = 160, x = innerWidth / 2, y = innerHeight / 3) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 12;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, s: 8 + Math.random() * 10, c: cols[i % cols.length], life: 260 });
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
  })();

  // ---------------- sound unlock ----------------
  function checkUnlock() {
    QPAudio.unlock().catch(() => {}).finally(() => {
      setTimeout(() => {
        if (!QPAudio.running) {
          $('#unlockText').textContent = t('soundOn');
          $('#unlock').hidden = false;
          $('#unlockBtn').focus();
        } else applyMusic();
      }, 300);
    });
  }
  $('#unlockBtn').onclick = () => {
    QPAudio.unlock().then(() => { applyMusic(); SFX.ding(); });
    mediaAudio.play().then(() => mediaAudio.pause()).catch(() => {});
    $('#unlock').hidden = true;
  };

  // ---------------- socket ----------------
  function create() {
    socket.emit('host:create', { code: store.get('qp_code'), hostKey: store.get('qp_hostKey') }, res => {
      store.set('qp_code', res.code);
      store.set('qp_hostKey', res.hostKey);
    });
  }
  socket.on('connect', create);
  socket.on('host:state', st => {
    offset = st.now - Date.now();
    if (st.settings && st.settings.lang) LANG = st.settings.lang;
    S = st;
    render();
  });
  socket.on('host:replay', () => playMedia(true));
  socket.on('host:notice', k => toast(t(k)));
  const control = (action, data) => socket.emit('control', { action, data });

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.style.display = 'none'), 4000);
  }

  // ---------------- helpers ----------------
  const cat = id => (S.categories || []).find(c => c.id === id) || { name: id || t('all'), icon: '🎲', color: '#7c5cff' };
  const teamName = k => (k === 'A' ? t('teamA') : t('teamB'));
  const player = id => S.players.find(p => p.id === id);
  const vipName = () => (player(S.vip) || {}).name || '—';
  const av = (p, cls) => avatar(p ? p.avatar : 0, cls);

  function header(right = '') {
    const title = esc(S.settings.title || 'QuizParty');
    return `<div class="top"><div class="logo display">${title.replace(/Party$/, '<span>Party</span>')}</div><div style="display:flex;gap:1.2rem;align-items:center">${right}<div class="codebox">${t('roomCode')}<b>${S.code}</b></div></div></div>`;
  }
  const catPill = (id, topic) => { const c = cat(id); return `<span class="pill" style="background:${esc(c.color)}">${esc(c.icon || '')} ${esc(c.name)}${topic ? ' · ' + esc(topic) : ''}</span>`; };
  const timerHTML = () => `<div class="timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="prog" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><div class="num"></div></div>`;

  function leaderboard(gained, limit = 10) {
    return `<div class="lb">${S.players.slice(0, limit).map((p, i) => {
      const g = (gained && gained[p.id]) || 0;
      return `<div class="lb-row ${i === 0 ? 'first' : ''}" style="animation-delay:${i * 0.07}s">
        <span class="pos">${i + 1}</span>${av(p, 'sm')}<span>${esc(p.name)}${p.vip ? ' ⭐' : ''}</span>
        <span class="plus">${g ? '+' + g : ''}</span><span class="sc" data-from="${p.score - g}" data-to="${p.score}">${p.score - g}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function countUps() {
    const els = [...stage.querySelectorAll('.sc[data-to]')];
    const t0 = performance.now(), dur = 1400;
    let lastTick = 0;
    (function step(now) {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      els.forEach(el => { const a = +el.dataset.from, b = +el.dataset.to; el.textContent = Math.round(a + (b - a) * e); });
      if (now - lastTick > 70 && k < 1) { SFX.countUp(); lastTick = now; }
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // ---------------- media (classic trivia) ----------------
  function stopMedia() {
    mediaAudio.pause();
    if (mediaStop) { mediaAudio.removeEventListener('timeupdate', mediaStop); mediaStop = null; }
    const v = stage.querySelector('video');
    if (v) v.pause();
  }
  function playMedia(restart) {
    const g = S && S.game;
    if (!g || g.mode !== 'classic' || !g.media) return;
    const m = g.media;
    const start = Number(m.start) || 0, end = Number(m.end) || 0;
    let el;
    if (m.type === 'audio') { el = mediaAudio; if (!restart || !el.src.endsWith(m.src)) el.src = m.src; }
    else if (m.type === 'video') el = stage.querySelector('video');
    if (!el) return;
    Music.duck(true);
    if (mediaStop) el.removeEventListener('timeupdate', mediaStop);
    mediaStop = () => { if (end && el.currentTime >= end) el.pause(); };
    el.addEventListener('timeupdate', mediaStop);
    const go = () => { try { el.currentTime = start; } catch (e) {} el.play().catch(() => checkUnlock()); };
    if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
    const vis = stage.querySelector('.audio-vis');
    if (vis) { el.onplay = () => vis.classList.remove('paused'); el.onpause = () => vis.classList.add('paused'); }
  }

  // ---------------- music per phase ----------------
  const MUSIC = {
    lobby: 'lobby', menu: 'lobby', 'squares-teams': 'lobby',
    intro: 'think', 'hilo-intro': 'think', question: 'think', 'hilo-vote': 'think', 'hilo-input': 'think', 'squares-turn': 'think', 'hilo-final': 'think', 'squares-intro': 'think', 'squares-result': 'think',
    scores: 'results', final: 'results', 'squares-end': 'results', 'hilo-list': 'results',
  };
  function applyMusic() {
    if (!S) return;
    const want = MUSIC[S.phase] || null;
    const hasMedia = S.game && S.game.mode === 'classic' && S.game.media && S.game.media.type !== 'image' && ['question', 'reveal'].includes(S.phase);
    if (!want || hasMedia) Music.stop(0.3);
    else Music.play(want);
    Music.duck(S.phase === 'squares-result');
  }

  // ---------------- render ----------------
  const LIVE = ['lobby', 'menu', 'hilo-vote', 'hilo-input', 'hilo-final', 'squares-teams', 'squares-turn'];
  function render() {
    const g = S.game;
    const key = [S.phase, g ? g.mode : '', g ? g.index : '', g && g.final ? g.final.n : '', g && g.turnTeam ? g.turnTeam + g.guesser : ''].join('|');
    const changed = key !== lastKey;
    if (changed) {
      sceneTimers.forEach(clearTimeout); sceneTimers = [];
      phaseTotal = S.endsAt ? Math.max(1000, S.endsAt - (Date.now() + offset)) : 0;
      onEnterSound(S.phase);
      applyMusic();
      document.body.className = moodClass();
    }
    lastKey = key;

    if (!changed && S.phase === 'question') {
      const st = $('#status');
      if (st) st.textContent = t('answered', { n: g.answered.length, t: S.players.filter(p => p.connected).length });
      renderBar();
      return;
    }
    if (!changed && !LIVE.includes(S.phase)) { renderBar(); return; }

    const focusedId = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id;
    const fn = VIEWS[S.phase] || (() => `<div class="center">${esc(S.phase)}</div>`);
    stage.innerHTML = fn(g);
    if (changed) { stage.classList.remove('scene-in'); void stage.offsetWidth; stage.classList.add('scene-in'); }
    if (!changed) stage.querySelectorAll('*').forEach(el => { if (!el.classList.contains('bob')) el.style.animation = 'none'; });
    renderBar();
    let f = focusedId && stage.querySelector(`[data-id="${focusedId}"]`);
    if (!f) f = stage.querySelector('[data-autofocus]') || stage.querySelector('[data-nav]');
    if (f && (changed || focusedId)) f.focus();
    if (changed && ENTER[S.phase]) ENTER[S.phase](g);
    if (S.players.length > lastPlayers && ['lobby', 'menu'].includes(S.phase)) SFX.join();
    lastPlayers = S.players.length;
  }

  function moodClass() {
    const g = S.game;
    if (g && g.mode === 'hilo' && g.dir && ['hilo-intro', 'hilo-input', 'hilo-reveal'].includes(S.phase)) return 'mood-' + g.dir;
    if (g && g.mode === 'squares' && S.phase === 'squares-turn') return 'mood-' + g.turnTeam;
    return '';
  }

  function onEnterSound(phase) {
    if (['intro', 'menu', 'lobby', 'final', 'hilo-intro', 'squares-intro', 'hilo-vote'].includes(phase)) stopMedia();
    if (['intro', 'squares-intro', 'hilo-vote', 'hilo-final'].includes(phase)) SFX.whoosh();
    if (phase === 'hilo-intro') { SFX.whoosh(); setTimeout(SFX.slam, 250); }
    if (phase === 'reveal' || phase === 'hilo-final-reveal') SFX.reveal();
    if (phase === 'final' || phase === 'squares-end') SFX.fanfare();
  }

  function renderBar() {
    const btns = [];
    if (S.phase === 'lobby') btns.push(`<button class="btn" data-nav onclick="QP.c('start')">${t('start')} ▶</button>`);
    else {
      if (S.phase !== 'menu') btns.push(`<button class="btn" data-nav onclick="QP.c('next')">${t('next')} ▶</button>`);
      if (S.game && S.game.hasAudio) btns.push(`<button class="btn" data-nav onclick="QP.c('replay')">🔁 ${t('replay')}</button>`);
      btns.push(S.phase !== 'menu' ? `<button class="btn" data-nav onclick="QP.c('end')">${t('menu')}</button>` : `<button class="btn" data-nav onclick="QP.c('lobby')">${t('lobby')}</button>`);
    }
    btns.push(`<button class="btn" data-nav onclick="QP.music()">${Music.enabled ? '🎵' : '🔇'} ${t('music')}</button>`);
    bar.innerHTML = btns.join('');
  }

  // ---------------- views ----------------
  const VIEWS = {
    lobby() {
      const url = S.joinUrl.replace(/^https?:\/\//, '').replace(/\/\?code=.*$/, '');
      const ps = S.players;
      return `${header()}
        <div class="lobby">
          <div class="join-card">
            <img src="${S.qr}" alt="QR">
            <div class="join-url">${t('joinAt')}<b>${esc(url)}</b></div>
            <div class="bigcode display">${S.code}</div>
          </div>
          <div>
            <h1 class="title-xl display">${ps.length ? t('players') + ' (' + ps.length + ')' : t('waiting')}</h1>
            <div class="players-row">${ps.map((p, i) => `<span class="pchip ${p.connected ? '' : 'off'}" style="animation-delay:${i * .05}s">${av(p, 'sm bob')}${p.vip ? '⭐' : ''}${esc(p.name)}${kickBtn(p)}</span>`).join('')}</div>
            ${ps.length ? `<div class="hint">${t('vipStarts', { name: esc(vipName()) })}</div>
            <div style="margin-top:1.5rem"><button class="btn primary" data-nav data-id="start" data-autofocus onclick="QP.c('start')">${t('start')} ▶</button></div>` : ''}
          </div>
        </div>`;
    },

    menu() {
      const m = S.menu;
      const info = S.menuInfo || { categories: [], counts: { classic: {}, hilo: {}, squares: {} } };
      const counts = info.counts[m.mode] || {};
      const modes = [['classic', '❓', t('classic'), t('classicDesc')], ['hilo', '↕️', t('hilo'), t('hiloDesc')], ['squares', '#️⃣', t('squares'), t('squaresDesc')]];
      const nums = m.mode === 'squares' ? [1, 2, 3] : m.mode === 'hilo' ? [2, 4, 6] : [5, 10, 15, 20];
      const numLbl = m.mode === 'classic' ? t('questions') : m.mode === 'hilo' ? t('rounds') : t('boards');
      const cats = [{ id: '', name: t('all'), icon: '🎲' }, ...info.categories];
      return `${header()}
        <div class="menu ${(m.cats || []).length ? 'compact' : ''}">
          <div>
            <h1 class="title-xl display" style="font-size:3.2rem">${t('chooseGame')}</h1>
            <div class="modes">${modes.map(([id, ic, nm, ds]) => `
              <button class="mode ${m.mode === id ? 'sel' : ''}" data-nav data-id="mode-${id}" ${m.mode === id ? 'data-autofocus' : ''} onclick="QP.c('menu',{mode:'${id}'})">
                <div class="ic">${ic}</div><h3>${nm}</h3><p>${ds}</p></button>`).join('')}
            </div>
            <div class="opts-row"><span class="lbl">${t('category')}</span>${cats.filter(c => counts[c.id] || (m.cats || []).includes(c.id)).map(c => {
              const n = counts[c.id] || 0, on = c.id ? (m.cats || []).includes(c.id) : !(m.cats || []).length;
              return `<button class="btn ${on ? 'sel' : ''}" data-nav data-id="cat-${esc(c.id)}" ${n ? '' : 'disabled style="opacity:.35"'} onclick="QP.c('menu',{category:'${esc(c.id)}'})">${c.id ? (on ? '☑ ' : '☐ ') : ''}${esc(c.icon || '')} ${esc(c.name)} <span class="muted">${n}</span></button>`;
            }).join('')}</div>
            ${seriesRow(m, info, true)}
            <div class="opts-row"><span class="lbl">${numLbl}</span>${nums.map(n => `<button class="btn ${m.count === n ? 'sel' : ''}" data-nav data-id="n-${n}" onclick="QP.c('menu',{count:${n}})">${n}</button>`).join('')}</div>
            ${m.mode === 'squares' ? `<div class="opts-row"><span class="lbl"></span>
              <button class="btn ${m.scrambled ? 'sel' : ''}" data-nav data-id="scr" onclick="QP.c('menu',{scrambled:${!m.scrambled}})">${m.scrambled ? '☑' : '☐'} ${t('scrambled')}</button>
              <button class="btn ${m.threeStrikes ? 'sel' : ''}" data-nav data-id="ts" onclick="QP.c('menu',{threeStrikes:${!m.threeStrikes}})">${m.threeStrikes ? '☑' : '☐'} ${t('threeStrikes')}</button></div>` : ''}
            <div class="opts-row"><span class="lbl"></span><button class="btn primary" style="font-size:2rem;padding:1rem 3rem" data-nav data-id="play" onclick="QP.c('play')">${t('play')}</button><span class="muted" style="font-size:1.3rem">${t('inSelection', { n: info.selected != null ? info.selected : (counts[''] || 0) })}</span></div>
          </div>
          <div class="side"><h4>🏆 ${t('leaderboard')}</h4><div class="mini-lb">${S.players.map(p => `<div>${av(p, 'sm')}<span>${p.vip ? '⭐' : ''}${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}</div>
            <div class="hint" style="font-size:1.1rem">${t('vipStarts', { name: esc(vipName()) })}</div></div>
        </div>`;
    },

    // ----- classic trivia -----
    intro(g) {
      const c = cat(g.category);
      return `${header()}<div class="center">
        <div class="kicker">${t('questionOf', { n: g.index + 1, t: g.total })}</div>
        <div class="intro-cat display" style="color:${esc(c.color)}">${esc(c.icon || '')} ${esc(c.name)}</div>
        ${g.topic ? `<div class="intro-topic display">${esc(g.topic)}</div>` : ''}
        <div class="kicker">${t('getReady')}</div></div>`;
    },
    question(g) {
      return `${header(catPill(g.category, g.topic))}
        <div class="qhead"><span class="pill">${t('questionOf', { n: g.index + 1, t: g.total })}</span>${timerHTML()}</div>
        <div class="qprompt">${esc(g.prompt)}</div>
        <div class="qbody">${mediaHTML(g)}</div>
        ${optionsHTML(g, false)}
        <div class="status" id="status">${t('answered', { n: g.answered.length, t: S.players.filter(p => p.connected).length })}</div>`;
    },
    reveal(g) {
      const gains = S.players.filter(p => g.picks && p.id in g.picks).map(p => ({ p, pts: g.gained[p.id] || 0 })).sort((a, b) => b.pts - a.pts);
      return `${header(catPill(g.category, g.topic))}
        <div class="qprompt">${esc(g.prompt)}</div>
        <div class="qbody">${g.media && g.media.type === 'image' ? mediaHTML(g) : ''}</div>
        ${optionsHTML(g, true)}
        <div class="gains">${gains.map((x, i) => `<span class="gain ${x.pts ? '' : 'zero'}" style="animation-delay:${0.4 + i * 0.08}s">${av(x.p, 'sm')}${esc(x.p.name)} <b>${x.pts ? '+' + x.pts : '✗'}</b></span>`).join('')}</div>`;
    },

    scores(g) {
      return `${header()}<div class="center"><h1 class="title-xl display">🏆 ${t('leaderboard')}</h1>${leaderboard(g && g.gained)}</div>`;
    },

    final() {
      const top = S.players.slice(0, 3);
      const order = [1, 0, 2].filter(i => top[i]);
      const h = { 0: 16, 1: 11, 2: 8 }, col = { 0: '#ffcc00', 1: '#c9d1e0', 2: '#e0915a' };
      return `${header()}<div class="center">
        <h1 class="title-xl display">🎉 ${t('final')}</h1>
        <div class="podium">${order.map(i => `<div class="pod" style="animation-delay:${(2 - i) * 0.5}s">
          ${av(top[i], 'lg bob')}<div class="nm">${esc(top[i].name)}</div><div class="sc">${top[i].score} ${t('points')}</div>
          <div class="blk" style="height:${h[i]}rem;background:${col[i]};color:#2a1a00">${i + 1}</div></div>`).join('')}</div>
        ${S.players.length > 3 ? `<div class="players-row">${S.players.slice(3).map((p, i) => `<span class="pchip">${av(p, 'sm')}${i + 4}. ${esc(p.name)} · ${p.score}</span>`).join('')}</div>` : ''}
      </div>`;
    },

    // ----- HILO -----
    'hilo-vote'(g) {
      const max = Math.max(0, ...g.votes);
      const ps = S.players.filter(p => p.connected);
      return `${header()}
        <div class="center">
          <div style="display:flex;align-items:center;gap:2rem"><h1 class="title-xl display" style="margin:0">${t('voteTitle')}</h1>${timerHTML()}</div>
          <div class="kicker">${t('voteHint')}</div>
          <div class="vote-cards">${g.candidates.map((c, i) => `
            <div class="vote-card ${max && g.votes[i] === max ? 'lead' : ''}" style="animation-delay:${i * .12}s">
              <div class="num">${i + 1}</div><div class="cat">${esc(cat(c.category).icon || '')} ${esc(cat(c.category).name)}</div>
              <div class="q">${esc(ttl(c))}</div>${sub(c) ? `<div class="muted" style="font-size:1.1rem;margin-top:.6rem">${esc(sub(c))}</div>` : ''}
              <div class="dots">${'<span class="pill" style="padding:.2rem .7rem">🗳️</span>'.repeat(g.votes[i])}</div>
            </div>`).join('')}</div>
          <div class="players-row" style="margin-top:2rem">${ps.map(p => `<span class="pchip ${g.voted.includes(p.id) ? 'ok' : ''}">${av(p, 'sm')}${esc(p.name)}</span>`).join('')}</div>
        </div>`;
    },

    'hilo-intro'(g) {
      return `${header(catPill(g.category))}<div class="center">
        <div class="kicker">${t('roundLabel', { n: g.index + 1, t: g.total })}</div>
        <div class="dirword display ${g.dir}">${t(g.dir)}</div>
        <div class="big-prompt display" style="font-size:3.4rem;animation:sceneIn .6s .3s both">${esc(dirText(g))}</div>
        <div class="kicker" style="animation:sceneIn .6s .6s both">${esc(ttl(g))}${sub(g) ? ' · ' + esc(sub(g)) : ''}</div></div>`;
    },

    'hilo-input'(g) {
      const ps = S.players.filter(p => p.connected);
      return `${header(catPill(g.category))}
        <div class="qhead"><div><span class="dir-badge ${g.dir}">${t(g.dir)}</span><span class="muted" style="font-size:1.6rem">${esc(ttl(g))}</span></div>${timerHTML()}</div>
        <div class="center">
          <div class="big-prompt display">${esc(dirText(g))}</div>
          <div class="muted" style="font-size:1.5rem">${esc(sub(g))}${sub(g) ? ' · ' : ''}${t('answersInSurvey', { n: g.size })}</div>
          <div class="players-row" style="margin-top:2.5rem">${ps.map(p => {
            const done = g.submitted.includes(p.id);
            return `<span class="pchip ${done ? 'ok' : ''}">${av(p, done ? 'sm done' : 'sm bob')}${done ? '✓ ' : ''}${esc(p.name)}</span>`;
          }).join('')}</div>
          <div class="status">${t('submitted', { n: g.submitted.length, t: ps.length })}</div>
          ${uncoveredHTML(g)}
        </div>`;
    },

    'hilo-reveal'(g) {
      const rows = listRows(g, i => g.prev.includes(i));
      return `${header(catPill(g.category))}
        <div class="reveal-prompt"><span class="dir-badge ${g.dir}">${t(g.dir)}</span><b>${esc(ttl(g))}</b> <span style="color:var(--muted)">— ${esc(dirText(g))}</span>${g.source ? `<span class="muted">${esc(g.source)}</span>` : ''}</div>
        <div class="reveal">
          <div class="board-list ${g.dir}"><div class="rows">${rows}</div></div>
          <div class="spot" id="spot"></div>
        </div>`;
    },

    'hilo-final'(g) {
      const f = g.final;
      const ps = S.players.filter(p => p.connected);
      return `${header(catPill(g.category))}
        <div class="center">
          <div class="kicker">${t('finalRound', { n: f.n, t: f.total })}${f.double ? ' · <span style="color:var(--accent)">' + t('doublePts') + '</span>' : ''}</div>
          <div style="display:flex;align-items:center;gap:2rem"><h1 class="title-xl display" style="margin:.4rem 0">${finalTitle(f)}</h1>${timerHTML()}</div>
          <div class="kicker">${esc(ttl(g))}${sub(g) ? ' · ' + esc(sub(g)) : ''}</div>
          <div class="final-cards">
            <div class="fcard"><div class="ftext display">${esc(f.options[0].text)}</div></div>
            <div class="vs">VS</div>
            <div class="fcard" style="animation-delay:.15s"><div class="ftext display">${esc(f.options[1].text)}</div></div>
          </div>
          <div class="players-row" style="margin-top:2rem">${ps.map(p => `<span class="pchip ${f.picked.includes(p.id) ? 'ok' : ''}">${av(p, 'sm')}${esc(p.name)}</span>`).join('')}</div>
        </div>`;
    },

    'hilo-final-reveal'(g) {
      const f = g.final;
      const by = i => S.players.filter(p => f.picks[p.id] === i);
      const card = i => `<div class="fcard" data-card="${i}">
          <div class="ftext display">${esc(f.options[i].text)}</div>
          <div class="frank" style="opacity:0">#${f.options[i].rank}</div>
          <div class="muted" style="font-size:1.3rem;opacity:0" data-val>${fmtVal(f.options[i], g)}</div>
          <div class="players-row">${by(i).map(p => av(p, 'sm')).join('')}</div></div>`;
      return `${header(catPill(g.category))}
        <div class="center">
          <div class="kicker">${t('finalRound', { n: f.n, t: f.total })}${f.double ? ' · <span style="color:var(--accent)">' + t('doublePts') + '</span>' : ''} · ${esc(ttl(g))}</div>
          <h1 class="title-xl display" style="margin:.4rem 0">${finalTitle(f)}</h1>
          <div class="final-cards">${card(0)}<div class="vs">VS</div>${card(1)}</div>
        </div>`;
    },

    'hilo-list'(g) {
      const hits = new Set(g.hits || []);
      return `${header(catPill(g.category))}
        <div class="reveal-prompt"><b>${t('fullList2')}</b> · <span style="color:var(--muted)">${esc(ttl(g))}</span>${g.source ? `<span class="muted">${esc(g.source)}</span>` : ''}</div>
        <div class="board-list" style="flex:1"><div class="rows">${listRows(g, () => true, hits)}</div></div>`;
    },

    // ----- SQUARES -----
    'squares-teams'() {
      const col = k => S.players.filter(p => p.team === k).map((p, i) => `<span class="pchip" style="animation-delay:${i * .06}s">${av(p, 'sm bob')}${p.vip ? '⭐' : ''}${esc(p.name)}</span>`).join('');
      return `${header()}<div class="center">
        <h1 class="title-xl display">${t('squares')}</h1>
        <div class="teams">
          <div class="team-col A"><h3>${t('teamA')}</h3><div class="players-row">${col('A')}</div></div>
          <div class="team-col B"><h3>${t('teamB')}</h3><div class="players-row">${col('B')}</div></div>
        </div>
        <div class="hint">${t('teamsHint', { name: esc(vipName()) })}</div>
        <div style="margin-top:1rem"><button class="btn primary" data-nav data-id="cont" data-autofocus onclick="QP.c('next')">${t('continue')} ▶</button></div>
      </div>`;
    },
    'squares-intro'(g) { return squaresView(g, true); },
    'squares-turn'(g) { return squaresView(g); },
    'squares-result'(g) { return squaresView(g); },
    'squares-end'(g) { return squaresView(g); },
  };

  // Ranked list rows for HILO. Hidden answers are never sent to the TV (only their rank), so they show as blurred bars.
  function listRows(g, shown, hits) {
    // Jackbox-style: a numbered column of empty cells; only uncovered answers get text.
    return g.ranked.map((a, i) => `<div class="row ${shown(i) ? 'shown' : ''} ${hits && hits.has(i) ? 'hit' : ''}" data-i="${i}"><span class="rk">${a.rank}</span><div class="cell"><span class="tx">${a.text != null ? esc(a.text) : ''}</span><span class="vl">${a.text != null ? fmtVal(a, g) : ''}</span></div><span class="arw"></span></div>`).join('');
  }
  function uncoveredHTML(g) {
    const u = g.uncovered || [];
    if (!u.length) return '';
    return `<div class="uncovered"><div class="muted">${t('uncovered')} (${t('notOnListZero')})</div>
      <div class="ulist">${u.map(a => `<span>#${a.rank} ${esc(a.text)}</span>`).join('')}</div></div>`;
  }
  function finalTitle(f) { return t(f.ask === 'lower' ? 'finalLower' : 'finalHigher'); }

  // Kick button on a player chip: first press arms it ("Kick?"), second press within 4 s removes the player.
  let armedKick = null, armedTimer = null;
  function kickBtn(p) {
    const armed = armedKick === p.id;
    return `<button class="kick ${armed ? 'armed' : ''}" data-nav data-id="kick-${p.id}" title="${t('kick')}" onclick="QP.kick('${p.id}')">${armed ? t('kickConfirm') : '✕'}</button>`;
  }
  const kickPlayer = id => {
    if (armedKick === id) { armedKick = null; clearTimeout(armedTimer); QP.c('kick', { id }); return; }
    armedKick = id; clearTimeout(armedTimer);
    armedTimer = setTimeout(() => { armedKick = null; render(); }, 4000);
    render();
  };

  // Sub-topic rows, one per selected category: tick the ones to include (none ticked = all of that category)
  function seriesRow(m, info, tv) {
    const groups = (info.series || {})[m.mode] || [];
    const sel = m.series || [];
    const name = id => (id === '__mixed' ? t('mixedSub') : id);
    const js = v => JSON.stringify(v).replace(/'/g, '&#39;');
    return groups.map((gr, gi) => {
      const c = cat(gr.cat), none = !gr.subs.some(x => sel.includes(x.key));
      return `<div class="opts-row series-row"><span class="lbl">${esc(c.icon || '')} ${esc(c.name)}</span>
      <button class="btn ${none ? 'sel' : ''}" data-nav data-id="ser-${gi}-all" onclick='QP.c("menu",{allSeries:${js(gr.cat)}})'>${t('allSubs')}</button>
      ${gr.subs.map((x, i) => `<button class="btn ${sel.includes(x.key) ? 'sel' : ''}" data-nav data-id="ser-${gi}-${i}" onclick='QP.c("menu",{toggleSeries:${js(x.key)}})'>${sel.includes(x.key) ? '☑' : '☐'} ${esc(name(x.id))} <span class="muted">${x.n}</span></button>`).join('')}</div>`;
    }).join('');
  }

  function squaresView(g, intro) {
    const ph = S.phase;
    const last = g.last;
    const cells = g.squares.map((s, i) => {
      const range = s.from === s.to ? `#${s.from}` : `#${s.from}–${s.to}`;
      const showBest = s.best && !(ph === 'squares-result' && last && last.square === i && ['claim', 'steal', 'improve'].includes(last.kind));
      return `<div class="cell ${s.owner || ''} ${intro ? 'intro' : ''} ${g.winLine && g.winLine.includes(i) && ph !== 'squares-result' ? 'win' : ''}" data-cell="${i}" style="${intro ? `animation-delay:${0.3 + i * 0.09}s` : ''}">
        ${s.locked ? '<span class="lk">🔒</span>' : ''}
        <div class="range">${range}</div>
        ${showBest ? `<div class="ans">${esc(s.best.text)}</div>${s.from !== s.to ? `<div class="range">#${s.best.pos}</div>` : ''}` : ''}
      </div>`;
    }).join('');
    const owned = k => g.squares.filter(s => s.owner === k).length;
    const wins = k => (g.total > 1 ? ` · 🏆${g.wins[k] || 0}` : '');
    const score = `<div class="teams-score"><span class="A">${t('teamA')}: ${owned('A')} ▣${wins('A')}</span><span class="B">${t('teamB')}: ${owned('B')} ▣${wins('B')}</span></div>`;
    const stk = g.opts.threeStrikes ? `<span class="strikes">${'✗'.repeat(g.strikes)}${'·'.repeat(3 - g.strikes)}</span>` : '';
    let side = '';
    if (intro) {
      side = `<div class="turn-banner ${g.turnTeam}">${t('starts', { team: teamName(g.turnTeam) })}</div>`;
    } else if (ph === 'squares-turn') {
      const gp = player(g.guesser);
      side = `<div class="turn-banner ${g.turnTeam}">${gp ? av(gp, 'lg bob') : ''}<div class="grow">${t('guesserTurn', { name: esc(gp ? gp.name : '?') })}<small>${teamName(g.turnTeam)} ${stk}</small></div>${timerHTML()}</div>
        ${g.suggestionCount ? `<div class="muted" style="font-size:1.3rem">${t('suggestionsN', { n: g.suggestionCount })}</div>` : ''}`;
    } else if (ph === 'squares-result' && last) {
      const p = player(last.byId);
      side = `<div class="result-msg" style="border-left:.7rem solid var(--team${last.team})" id="resmsg">
        <div style="display:flex;align-items:center;gap:1rem">${p ? av(p, 'sm') : ''}<span>${last.text ? `“${esc(last.text)}”` : t('timeout')}</span></div>
        <small id="resdetail"></small></div>`;
    } else if (ph === 'squares-end') {
      side = `<div class="turn-banner ${g.winner === 'draw' ? '' : g.winner}" style="${g.winner === 'draw' ? 'background:var(--panel2)' : ''}">🏆 ${g.winner === 'draw' ? t('draw') : t('wins', { team: teamName(g.winner) })}</div>`;
      if (g.ranked) {
        const list = g.ranked.length > 45 ? g.ranked.filter((a, i) => a.used || i < 15) : g.ranked;
        side += `<div><div class="muted" style="font-size:1.2rem;margin-bottom:.4rem">${t('fullList')}</div><div class="ranked-mini">${list.map(a => { const v = fmtVal(a, g); return `<div class="${a.used ? 'u' : ''}">#${a.pos} ${esc(a.text)}${v ? ' · ' + v : ''}</div>`; }).join('')}</div></div>`;
      }
    }
    const hist = !intro && ph !== 'squares-end' && g.history.length ? `<div class="hist">${g.history.slice(ph === 'squares-result' ? 1 : 0, 8).map(h => `<div class="${h.team}"><span>${esc(h.by || '—')}: “${esc(h.text || '⏱')}”</span><b>${({ blocked: '🛡️', locked: '🔒', nochange: '=', used: '↺' }[h.kind] || '')}${h.pos ? '#' + h.pos : '✗'}</b></div>`).join('')}</div>` : '';
    return `${header(catPill(g.category))}
      <div class="sq-wrap">
        <div class="board" id="board">${cells}</div>
        <div class="sq-side">
          <div class="muted" style="font-size:1.2rem">${t('boardOf', { n: g.index + 1, t: g.total })} · ${t('answersInSurvey', { n: g.size })}${g.opts.scrambled ? ' · ' + t('scrambled') : ''}</div>
          <div class="sq-prompt display">${esc(ttl(g))}</div>${sub(g) ? `<div class="muted" style="font-size:1.3rem;margin-top:-.6rem">${esc(sub(g))}</div>` : ''}
          ${ph === 'squares-turn' || intro ? `<div style="font-size:1.35rem;color:var(--accent)">${t('squaresAsk')}</div>` : ''}
          ${score}${side}${hist}
        </div>
      </div>`;
  }

  function mediaHTML(g) {
    const m = g.media;
    if (!m || !m.src) return '';
    if (m.type === 'image') return `<div class="media"><img src="${esc(m.src)}" alt=""></div>`;
    if (m.type === 'video') return `<div class="media"><video src="${esc(m.src)}" playsinline></video></div>`;
    if (m.type === 'audio') return `<div class="audio-vis paused">${Array.from({ length: 9 }, (_, i) => `<i style="animation-delay:${-i * 0.13}s"></i>`).join('')}</div>`;
    return '';
  }
  function optionsHTML(g, reveal) {
    return `<div class="options">${g.options.map((o, i) => {
      const cls = reveal ? (i === g.correct ? 'right' : 'dim') : '';
      const who = reveal ? S.players.filter(p => g.picks && g.picks[p.id] === i) : [];
      return `<div class="opt ${cls}" style="background:${OPT_COLORS[i % 6]};animation-delay:${i * 0.07}s"><span class="shape">${SHAPES[i % 6]}</span><span>${esc(o)}</span>${reveal ? `<span class="tally">${g.tally[i]}</span>` : ''}${who.length ? `<div class="pickers">${who.map(p => `<span class="picker">${av(p, 'sm')}${esc(p.name)}</span>`).join('')}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  // ---------------- scene animations (run once when a phase starts) ----------------
  const ENTER = {
    question() { playMedia(false); },
    scores() { later(500, countUps); },
    final() { later(300, () => confetti(220)); later(1500, () => confetti(160, innerWidth * .25)); later(2300, () => confetti(160, innerWidth * .75)); },
    'hilo-reveal'(g) { hiloTimeline(g); },
    'hilo-list'() {
      const list = stage.querySelector('.board-list'), rowsEl = stage.querySelector('.rows');
      const max = Math.max(0, rowsEl.scrollHeight - list.getBoundingClientRect().height);
      const dur = Math.max(4, phaseTotal / 1000 - 3);
      later(1500, () => { rowsEl.style.transition = `transform ${dur}s linear`; rowsEl.style.transform = `translateY(${-max}px)`; });
    },
    'hilo-final-reveal'(g) {
      const f = g.final;
      SFX.drumroll(1.2);
      later(1400, () => {
        stage.querySelectorAll('.frank,[data-val]').forEach(el => (el.style.opacity = 1));
        stage.querySelector(`[data-card="${f.correct}"]`).classList.add('win');
        stage.querySelector(`[data-card="${1 - f.correct}"]`).classList.add('lose');
        SFX.ding(5);
        const card = stage.querySelector(`[data-card="${f.correct}"]`).getBoundingClientRect();
        if (Object.values(f.picks).some(v => v === f.correct)) confetti(90, card.left + card.width / 2, card.top + card.height / 2);
      });
    },
    'squares-result'(g) { squaresResultAnim(g); },
    'squares-end'(g) { later(400, () => confetti(240)); },
  };

  function hiloTimeline(g) {
    const list = stage.querySelector('.board-list');
    const rowsEl = stage.querySelector('.rows');
    const spot = $('#spot');
    const rowEls = [...stage.querySelectorAll('.row')];
    const rowH = rowEls[0] ? rowEls[0].getBoundingClientRect().height : 40;
    const viewH = list.getBoundingClientRect().height;
    const scrollTo = i => { const y = Math.max(0, Math.min(rowEls.length * rowH - viewH, i * rowH - viewH / 2 + rowH / 2)); rowsEl.style.transform = `translateY(${-y}px)`; };
    const show = i => rowEls[i] && rowEls[i].classList.add('shown'); // only the guessed answer gets uncovered
    const stale = new Set(g.stale || []);
    const maxPts = g.maxPts || 150;
    scrollTo(0);
    spot.innerHTML = `<div class="kicker">${esc(dirText(g))}</div>`;
    const order = (g.order || []).filter(id => g.subs[id]);
    order.forEach((pid, k) => {
      const T = 2500 + k * 3000;
      const p = player(pid) || { name: '?', avatar: 0 };
      const sub = g.subs[pid];
      const pts = (g.gained || {})[pid] || 0;
      later(T, () => {
        rowEls.forEach(r => r.classList.remove('focus'));
        spot.innerHTML = `${av(p, 'xl')}<div class="said">${t('said', { name: esc(p.name) })}</div><div class="word display">“${esc(sub.text)}”</div><div class="verdict" id="vd"></div><div id="pt"></div>`;
        SFX.whoosh();
      });
      if (sub.idx < 0) {
        later(T + 1200, () => { $('#vd').className = 'verdict bad'; $('#vd').textContent = t('notOnListBig'); $('#pt').innerHTML = '<div class="pts zero">0</div>'; SFX.buzz(); });
      } else if (stale.has(pid)) {
        later(T + 700, () => { scrollTo(sub.idx); rowEls[sub.idx].classList.add('focus'); });
        later(T + 1500, () => { $('#vd').className = 'verdict bad'; $('#vd').textContent = `#${g.ranked[sub.idx].rank} · ${t('alreadyUp')}`; $('#pt').innerHTML = '<div class="pts zero">0</div>'; SFX.buzz(); });
      } else {
        later(T + 700, () => { scrollTo(sub.idx); show(sub.idx); SFX.drumroll(0.9); });
        later(T + 1800, () => {
          const row = rowEls[sub.idx];
          row.classList.add('focus', 'hit');
          let who = row.querySelector('.who');
          if (!who) { who = document.createElement('span'); who.className = 'who'; row.querySelector('.cell').appendChild(who); }
          who.insertAdjacentHTML('beforeend', av(p, 'sm done'));
          const a = g.ranked[sub.idx];
          const shared = Object.values(g.subs).filter(s => s.idx === sub.idx).length > 1;
          $('#vd').className = 'verdict good';
          const v = fmtVal(a, g);
          $('#vd').textContent = `#${a.rank}${v ? ' · ' + v : ''}${shared ? ' · ' + t('shared') : ''}`;
          $('#pt').innerHTML = `<div class="pts ${pts ? '' : 'zero'}">+${pts}</div>`;
          SFX.ding(Math.round((pts / maxPts) * 12));
          if (pts >= maxPts * 0.8) confetti(60, innerWidth * .75, innerHeight * .55);
        });
      }
    });
    later(2500 + order.length * 3000 + 600, () => {
      rowEls.forEach(r => r.classList.remove('focus'));
      scrollTo(0);
      const best = order.length ? order[order.length - 1] : null;
      const bp = best && player(best);
      spot.innerHTML = bp && g.gained[best] ? `${av(bp, 'xl bob')}<div class="said">🏆</div><div class="word display">${esc(bp.name)}</div><div class="pts">+${g.gained[best]}</div>` : `<div class="kicker">—</div>`;
      if (bp && g.gained[best]) SFX.fanfare();
    });
  }

  function squaresResultAnim(g) {
    const last = g.last;
    const detail = $('#resdetail');
    if (!last) return;
    const tn = teamName(last.team);
    const sq = last.square >= 0 ? g.squares[last.square] : null;
    const params = { team: tn, owner: sq && sq.owner ? teamName(sq.owner) : '', pos: last.pos, best: sq && sq.best ? sq.best.pos : '' };
    let msg = t(last.kind === 'locked' ? 'lockedSq' : last.kind, params);
    if (last.locked) msg += ' ' + t('locked');
    if (last.struckOut) msg += ' — ' + t('struckOut');
    SFX.drumroll(0.8);
    later(900, () => {
      if (detail) detail.innerHTML = `${last.answer ? `→ <b>${esc(last.answer)}</b> (#${last.pos}) · ` : ''}${msg}`;
      const good = ['claim', 'steal', 'improve'].includes(last.kind);
      const cell = last.square >= 0 ? stage.querySelector(`[data-cell="${last.square}"]`) : null;
      if (good && cell) {
        const s = g.squares[last.square];
        cell.className = `cell ${s.owner} ${last.kind === 'steal' ? 'stolen' : 'claimed'}`;
        cell.innerHTML = `${s.locked ? '<span class="lk" style="opacity:0">🔒</span>' : ''}<div class="range">${s.from === s.to ? '#' + s.from : `#${s.from}–${s.to}`}</div><div class="ans">${esc(s.best.text)}</div>${s.from !== s.to ? `<div class="range">#${s.best.pos}</div>` : ''}`;
        last.kind === 'steal' ? SFX.steal() : SFX.claim(last.team === 'A' ? 0 : 3);
        if (last.locked) later(700, () => { const lk = cell.querySelector('.lk'); if (lk) { lk.style.opacity = 1; cell.classList.add('locked-now'); } SFX.lock(); });
      } else if (cell && ['blocked', 'nochange', 'locked'].includes(last.kind)) {
        // The answer IS on the list, it just isn't good enough for that square: the guess flies into
        // the square and bounces off, the holder's answer stays (shield for a defence, lock for locked squares).
        bounceOff(cell, last, sq);
      } else if (last.kind === 'used') {
        if (cell) cell.classList.add('target');
        $('#board').insertAdjacentHTML('beforeend', `<div class="stamp-used">${t('usedStamp')}</div>`);
        SFX.thud();
      } else {
        $('#board').insertAdjacentHTML('beforeend', '<div class="miss">✗</div>');
        SFX.buzz();
      }
      if (g.winner) later(1300, () => {
        (g.winLine || []).forEach(i => { const c = stage.querySelector(`[data-cell="${i}"]`); if (c) c.classList.add('win'); });
        SFX.fanfare(); confetti(200);
      });
    });
  }

  function bounceOff(cell, last, sq) {
    const board = $('#board');
    const el = document.createElement('div');
    el.className = `attempt ${last.team}`;
    el.innerHTML = `<div class="at-t">${esc(last.answer)}</div><div class="at-r">#${last.pos}</div>`;
    Object.assign(el.style, { left: cell.offsetLeft + 'px', top: cell.offsetTop + 'px', width: cell.offsetWidth + 'px', height: cell.offsetHeight + 'px' });
    board.appendChild(el);
    SFX.whoosh();
    later(450, () => {                       // impact
      el.classList.add('hit');
      cell.classList.add('defend');
      if (last.kind === 'nochange') { SFX.thud(); }
      else { SFX.clang(); }
      const badge = last.kind === 'locked' ? '🔒' : last.kind === 'blocked' ? '🛡️' : '';
      if (badge) cell.insertAdjacentHTML('beforeend', `<div class="shield">${badge}</div>`);
      // rank comparison chip: attempt vs the answer holding the square
      if (sq && sq.best) cell.insertAdjacentHTML('beforeend', `<div class="vs-chip"><s>#${last.pos}</s> ‹ #${sq.best.pos}</div>`);
    });
    later(1000, () => { el.classList.add('fall'); if (last.kind !== 'nochange') SFX.denied(); });
  }

  // ---------------- timer loop ----------------
  let lastSec = null;
  (function frame() {
    requestAnimationFrame(frame);
    const el = document.querySelector('.timer');
    if (!el || !S || !S.endsAt) return;
    const remain = Math.max(0, S.endsAt - (Date.now() + offset));
    const total = phaseTotal || 1000;
    const sec = Math.ceil(remain / 1000);
    el.querySelector('.num').textContent = sec;
    el.querySelector('.prog').setAttribute('stroke-dashoffset', String(276.5 * (1 - remain / total)));
    el.classList.toggle('low', sec <= 5);
    if (sec !== lastSec && sec <= 5 && sec > 0) SFX.tick();
    lastSec = sec;
  })();

  // ---------------- TV remote navigation (D-pad) ----------------
  document.addEventListener('keydown', e => {
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = dirs[e.key];
    if (!QPAudio.running) QPAudio.unlock().then(applyMusic);
    if (!d) { if (e.key === 'MediaPlayPause' || e.key === 'n') control('next'); return; }
    e.preventDefault();
    const all = [...document.querySelectorAll('[data-nav]')].filter(el => el.offsetParent !== null && !el.disabled);
    if (!all.length) return;
    const cur = document.activeElement;
    if (!all.includes(cur)) { all[0].focus(); return; }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      const along = dx * d[0] + dy * d[1];
      if (along <= 5) continue;
      const score = along + (Math.abs(dx * d[1]) + Math.abs(dy * d[0])) * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) best.focus();
  });
  document.addEventListener('click', () => { if (!QPAudio.running) QPAudio.unlock().then(applyMusic); });

  window.QP = {
    c: control,
    kick: kickPlayer,
    music() { Music.setEnabled(!Music.enabled); store.set('qp_music', Music.enabled ? 'on' : 'off'); applyMusic(); renderBar(); },
  };
  checkUnlock();
})();
