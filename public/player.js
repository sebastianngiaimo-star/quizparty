/* QuizParty — phone controller */
(() => {
  const app = document.getElementById('app');
  const conn = document.getElementById('conn');
  const socket = io({ transports: ['websocket', 'polling'] });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const params = new URLSearchParams(location.search);
  let S = null;
  let offset = 0;
  let joined = false;
  let lastKey = '';
  let joinErr = '';

  fetch('/api/config').then(r => r.json()).then(c => { LANG = c.lang || 'en'; if (!joined) renderJoin(); }).catch(() => {});

  // ---------------- join ----------------
  function renderJoin() {
    const code = (params.get('code') || store.get('qp_pcode') || '').toUpperCase();
    app.innerHTML = `
      <header><span class="nm">QuizParty</span></header>
      <div class="main"><div class="card">
        <div class="big-emoji">🎮</div><h1>${t('joinTitle')}</h1>
        <label>${t('code')}</label><input type="text" id="code" class="code" maxlength="4" autocomplete="off" value="${esc(code)}">
        <label>${t('name')}</label><input type="text" id="name" maxlength="16" autocomplete="off" value="${esc(store.get('qp_name') || '')}">
        <div class="err" id="err">${esc(joinErr)}</div>
        <button class="btn primary" id="go">${t('join')}</button>
      </div></div>`;
    const go = () => {
      const c = document.getElementById('code').value.trim().toUpperCase();
      const n = document.getElementById('name').value.trim();
      if (!n) return (document.getElementById('err').textContent = t('errname'));
      doJoin(c, n, store.get('qp_token_' + c));
    };
    document.getElementById('go').onclick = go;
    app.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => e.key === 'Enter' && go()));
    const nameEl = document.getElementById('name');
    if (code && !nameEl.value) nameEl.focus();
  }

  function doJoin(code, name, token) {
    socket.emit('player:join', { code, name, token }, res => {
      if (res.error) {
        joinErr = t('err' + res.error);
        joined = false;
        if (res.error === 'noRoom' || res.error === 'name') store.set('qp_token_' + code, '');
        return renderJoin();
      }
      joinErr = '';
      joined = true;
      store.set('qp_pcode', res.code);
      store.set('qp_name', name);
      store.set('qp_token_' + res.code, res.token);
      if (params.get('code')) history.replaceState(null, '', '/');
    });
  }

  socket.on('connect', () => {
    conn.style.display = 'none';
    const code = store.get('qp_pcode');
    const token = code && store.get('qp_token_' + code);
    if ((joined || (!params.get('code') || params.get('code').toUpperCase() === code)) && token) doJoin(code, store.get('qp_name'), token);
    else if (!joined) renderJoin();
  });
  socket.on('disconnect', () => { conn.textContent = t('reconnecting'); conn.style.display = 'block'; });
  socket.on('player:state', st => {
    offset = st.now - Date.now();
    LANG = st.lang || LANG;
    S = st;
    joined = true;
    render();
  });
  socket.on('player:kicked', () => {
    joined = false;
    store.set('qp_token_' + store.get('qp_pcode'), '');
    joinErr = t('kicked');
    renderJoin();
  });
  socket.on('player:notice', k => alert(t(k)));

  const c = (action, data) => socket.emit('control', { action, data });
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const teamName = k => (k === 'A' ? t('teamA') : t('teamB'));

  // ---------------- render ----------------
  function render() {
    const g = S.game;
    const me = S.me;
    const key = [S.phase, g && g.mode, g && g.index, me.team, me.vip, S.myPick, S.mySub, S.myMiss, S.myVote, S.myFinal, g && g.turnTeam, g && g.guesser, g && g.final && g.final.n, g && g.last && g.last.kind].join('|');
    const inputPhase = ['hilo-input', 'squares-turn'].includes(S.phase);
    if (key === lastKey && inputPhase) { // don't wipe what the player is typing; only refresh team suggestions
      const sg = document.getElementById('sugs');
      if (sg) sg.innerHTML = sugList();
      return;
    }
    if (key !== lastKey && ['question', 'hilo-input'].includes(S.phase)) buzz(80);
    if (key !== lastKey && S.phase === 'squares-turn' && g.turnTeam === me.team) buzz([80, 60, 80]);
    lastKey = key;
    const view = (VIEWS[S.phase] || VIEWS.wait)(g, me);
    app.innerHTML = `
      <header><span class="nm">${avatar(me.avatar)}${esc(me.name)}${me.vip ? ' ⭐' : ''}${me.team ? ` <span class="team-pill team-${me.team}" style="font-size:12px;padding:2px 8px">${teamName(me.team)}</span>` : ''}</span><span class="sc">${me.score} ${t('points')}</span></header>
      <div class="main">${view}</div>${vipPanel()}`;
    const inp = app.querySelector('input[type=text]');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') app.querySelector('[data-send]').click(); });
    }
  }

  function myRank() { return S.players.findIndex(p => p.id === S.me.id) + 1; }

  function vipPanel() {
    if (!S.me.vip || ['lobby', 'menu'].includes(S.phase)) return '';
    const g = S.game;
    return `<details class="vip"><summary>⭐ ${t('vipControls')}</summary>
      <div class="row"><button class="btn" onclick="QP.c('next')">${t('next')} ▶</button>${g && g.hasAudio ? `<button class="btn" onclick="QP.c('replay')">🔁</button>` : ''}</div>
      <div class="row"><button class="btn" onclick="QP.c('end')">${t('menu')}</button><button class="btn" onclick="if(confirm('${t('resetScores')}?'))QP.c('resetScores')">${t('resetScores')}</button></div>
    </details>`;
  }

  const timerLine = () => `<div class="timer" data-timer></div>`;

  // Sub-topics, one group per selected category: tick the ones to include (none ticked = all of that category)
  function seriesPick(m, info) {
    const groups = (info.series || {})[m.mode] || [];
    const sel = m.series || [];
    const name = id => (id === '__mixed' ? t('mixedSub') : id);
    const js = v => JSON.stringify(v).replace(/'/g, '&#39;');
    const catOf = id => (info.categories || []).find(c => c.id === id) || { name: id, icon: '' };
    return groups.map(gr => {
      const c = catOf(gr.cat), none = !gr.subs.some(x => sel.includes(x.key));
      return `<label>${esc(c.icon || '')} ${esc(c.name)} · ${t('subTopics')}</label><div class="sel-list">
      <button class="btn ${none ? 'on' : ''}" onclick='QP.c("menu",{allSeries:${js(gr.cat)}})'>${t('allSubs')}</button>
      ${gr.subs.map(x => `<button class="btn ${sel.includes(x.key) ? 'on' : ''}" onclick='QP.c("menu",{toggleSeries:${js(x.key)}})'>${esc(name(x.id))} (${x.n})</button>`).join('')}</div>`;
    }).join('');
  }

  // VIP only: everyone else in the room with a remove button (tap twice to confirm)
  let armedKick = null, armedTimer = null;
  function kickList(me) {
    const others = S.players.filter(p => p.id !== me.id);
    if (!others.length) return '';
    return `<details class="vip" ${armedKick ? 'open' : ''}><summary>${t('kickTitle')} (${others.length})</summary>
      ${others.map(p => `<div class="row" style="align-items:center;margin-top:8px"><span style="flex:1;text-align:left;display:flex;align-items:center;gap:8px">${avatar(p.avatar)} ${esc(p.name)}${p.connected ? '' : ' 💤'}</span>
        <button class="btn" style="flex:none;width:auto;padding:8px 14px;font-size:15px;${armedKick === p.id ? 'background:var(--bad)' : ''}" onclick="QP.kick('${p.id}')">${armedKick === p.id ? t('kickConfirm') : t('kick')}</button></div>`).join('')}</details>`;
  }
  function kickPlayer(id) {
    if (armedKick === id) { armedKick = null; clearTimeout(armedTimer); QP.c('kick', { id }); return; }
    armedKick = id; clearTimeout(armedTimer);
    armedTimer = setTimeout(() => { armedKick = null; render(); }, 4000);
    render();
  }

  const VIEWS = {
    wait() { return `<div class="card"><div class="big-emoji">📺</div><h2>${t('lookAtTv')}</h2></div>`; },

    lobby(g, me) {
      return `<div class="card"><div class="big-emoji">🎉</div><h1>${t('youreIn')}</h1><p class="muted">${t('lookAtTv')}</p>
        ${me.vip ? `<p>${t('youAreVip')}</p><button class="btn primary" onclick="QP.c('start')">${t('start')} ▶</button>` : `<p class="muted">${t('vipStarts', { name: esc((S.players.find(p => p.vip) || {}).name || '') })}</p>`}</div>
        ${me.vip ? kickList(me) : ''}`;
    },

    menu(g, me) {
      if (!me.vip) return `<div class="card"><div class="big-emoji">🕹️</div><h2>${t('vipChoosing')}</h2></div>${lb()}`;
      const m = S.menu;
      const info = S.menuInfo || { categories: [], counts: { classic: {}, hilo: {}, squares: {} } };
      const counts = info.counts[m.mode] || {};
      const modes = [['classic', t('classic'), t('classicDesc')], ['hilo', t('hilo'), t('hiloDesc')], ['squares', t('squares'), t('squaresDesc')]];
      const nums = m.mode === 'squares' ? [1, 2, 3] : m.mode === 'hilo' ? [2, 4, 6] : [5, 10, 15, 20];
      const cats = [{ id: '', name: t('all'), icon: '🎲' }, ...info.categories];
      return `<h2>${t('chooseGame')}</h2>
        ${modes.map(([id, nm, ds]) => `<button class="mode-btn ${m.mode === id ? 'on' : ''}" onclick="QP.c('menu',{mode:'${id}'})"><b>${nm}</b><span>${ds}</span></button>`).join('')}
        <label>${t('category')}</label>
        <div class="sel-list">${cats.filter(ct => counts[ct.id] || (m.cats || []).includes(ct.id)).map(ct => { const on = ct.id ? (m.cats || []).includes(ct.id) : !(m.cats || []).length; return `<button class="btn ${on ? 'on' : ''}" ${counts[ct.id] ? '' : 'disabled'} onclick="QP.c('menu',{category:'${esc(ct.id)}'})">${esc(ct.icon || '')} ${esc(ct.name)} (${counts[ct.id] || 0})</button>`; }).join('')}</div>
        ${seriesPick(m, info)}
        <label>${m.mode === 'classic' ? t('questions') : m.mode === 'hilo' ? t('rounds') : t('boards')}</label>
        <div class="sel-list">${nums.map(n => `<button class="btn ${m.count === n ? 'on' : ''}" onclick="QP.c('menu',{count:${n}})">${n}</button>`).join('')}</div>
        ${m.mode === 'squares' ? `<div class="sel-list" style="margin-top:10px">
          <button class="btn ${m.scrambled ? 'on' : ''}" onclick="QP.c('menu',{scrambled:${!m.scrambled}})">${t('scrambled')}</button>
          <button class="btn ${m.threeStrikes ? 'on' : ''}" onclick="QP.c('menu',{threeStrikes:${!m.threeStrikes}})">${t('threeStrikes')}</button></div>` : ''}
        <button class="btn primary" style="margin-top:12px" onclick="QP.c('play')">${t('play')}</button>
        ${kickList(me)}
        <div class="row" style="margin-top:4px"><button class="btn" onclick="QP.c('lobby')">${t('lobby')}</button><button class="btn" onclick="if(confirm('${t('resetScores')}?'))QP.c('resetScores')">${t('resetScores')}</button></div>`;
    },

    intro() { return `<div class="card"><div class="big-emoji">⏳</div><h1>${t('getReady')}</h1><p class="muted">${t('lookAtTv')}</p></div>`; },

    question(g) {
      if (S.myPick != null) return `<div class="card"><div class="big-emoji">${SHAPES[S.myPick % 6]}</div><h2>${t('lockedIn')}</h2><p class="muted">${esc(g.options[S.myPick])}</p></div>`;
      return `<div class="prompt">${g.topic ? `<div class="muted" style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${esc(g.topic)}</div>` : ''}${esc(ttl(g))}${sub(g) ? `<div class="muted" style="font-size:13px;font-weight:400">${esc(sub(g))}</div>` : ''}</div>${timerLine()}
        <div class="opts ${g.options.length === 2 ? 'n2' : ''}">${g.options.map((o, i) => `
          <button class="opt" style="background:${OPT_COLORS[i % 6]}" onclick="QP.answer(${i})"><span class="sh">${SHAPES[i % 6]}</span><span>${esc(o)}</span></button>`).join('')}</div>`;
    },

    reveal(g, me) {
      const pick = S.myPick;
      const pts = (g.gained || {})[me.id] || 0;
      if (pick == null) return `<div class="card"><div class="big-emoji">😴</div><h2>${t('noAnswer')}</h2><p class="muted">✓ ${esc(g.options[g.correct])}</p></div>`;
      const ok = pick === g.correct;
      if (ok) buzz(40); else buzz([200]);
      return `<div class="card"><div class="big-emoji">${ok ? '🎉' : '😬'}</div><div class="result ${ok ? 'good' : 'bad'}">${ok ? t('correct') : t('wrong')}</div>
        ${ok ? `<div class="pts">+${pts}</div>` : `<p class="muted">✓ ${esc(g.options[g.correct])}</p>`}</div>`;
    },

    scores() { return `<div class="card"><h2>${t('place')} #${myRank()}</h2><div class="pts">${S.me.score} ${t('points')}</div></div>${lb()}`; },

    final() { const r = myRank(); return `<div class="card"><div class="big-emoji">${['🥇', '🥈', '🥉'][r - 1] || '🎊'}</div><h1>${t('place')} #${r}</h1><div class="pts">${S.me.score} ${t('points')}</div></div>${lb()}`; },

    'hilo-intro'(g) { return `<div class="card"><span class="badge ${g.dir}" style="font-size:48px">${t(g.dir)}</span><p>${esc(dirText(g))}</p></div>`; },

    'hilo-input'(g) {
      if (S.mySub) return `<div class="card"><div class="big-emoji">✅</div><h2>${t('lockedIn')}</h2><p class="muted">“${esc(S.mySub)}”</p></div>`;
      return `<div class="card"><span class="badge ${g.dir}">${t(g.dir)}</span><p class="muted" style="margin:6px 0 0">${esc(dirText(g))}</p></div>
        <div class="prompt">${esc(ttl(g))}${sub(g) ? `<div class="muted" style="font-size:13px;font-weight:400">${esc(sub(g))}</div>` : ''}</div>${timerLine()}
        ${S.myMiss ? `<div class="miss">❌ ${t('notOnListRetry', { a: esc(S.myMiss) })}</div>` : ''}
        <input type="text" id="ans" maxlength="80" placeholder="${t('typeAnswer')}" autocomplete="off" autocapitalize="sentences">
        <button class="btn primary" data-send onclick="QP.hilo()">${t('send')}</button>`;
    },

    'hilo-vote'(g) {
      return `<h2 class="display" style="text-align:center">${t('voteTitle')}</h2>${timerLine()}
        ${g.candidates.map((c, i) => `<button class="vote-btn ${S.myVote === i ? 'on' : ''}" onclick="QP.vote(${i})"><span class="n">${i + 1}</span>${esc(ttl(c))}${sub(c) ? `<div class="muted" style="font-size:13px;font-weight:400;margin:4px 0 0 40px">${esc(sub(c))}</div>` : ''}</button>`).join('')}`;
    },
    'hilo-reveal'(g, me) {
      return `<div class="card">${avatar(me.avatar, 'lg')}<h2 style="margin-top:12px">${t('lookAtTv')} 👀</h2>${S.mySub ? `<p class="muted">${t('yourAnswer')}: “${esc(S.mySub)}”</p>` : ''}</div>`;
    },
    'hilo-final'(g) {
      const f = g.final;
      if (S.myFinal != null) return `<div class="card"><div class="big-emoji">✅</div><h2>${t('lockedIn')}</h2><p class="muted">${esc(f.options[S.myFinal].text)}</p></div>`;
      return `<div class="card"><div class="muted">${t('finalRound', { n: f.n, t: f.total })}${f.double ? ' · ' + t('doublePts') : ''}</div><h2 style="margin-top:6px">${t(f.ask === 'lower' ? 'finalLower' : 'finalHigher')}</h2><p class="muted">${esc(ttl(g))}</p></div>${timerLine()}
        <div class="fin">${f.options.map((o, i) => `<button class="btn display" style="background:${i ? 'var(--teamB)' : 'var(--accent)'};color:${i ? '#fff' : '#2a1a00'}" onclick="QP.fin(${i})">${esc(o.text)}</button>`).join('')}</div>`;
    },
    'hilo-final-reveal'(g, me) {
      const f = g.final;
      const pick = f.picks ? f.picks[me.id] : undefined;
      if (pick === undefined) return `<div class="card"><div class="big-emoji">😴</div><h2>${t('noAnswer')}</h2></div>`;
      const ok = pick === f.correct;
      return `<div class="card"><div class="big-emoji">${ok ? '🎉' : '😬'}</div><div class="result ${ok ? 'good' : 'bad'}">${ok ? t('correct') : t('wrong')}</div>${ok ? `<div class="pts">+${f.pts}</div>` : ''}<p class="muted">#${f.options[0].rank} ${esc(f.options[0].text)} · #${f.options[1].rank} ${esc(f.options[1].text)}</p></div>`;
    },

    'squares-teams'(g, me) {
      return `<div class="card"><p class="muted">${t('yourTeam')}</p><div class="team-pill" style="background:var(--team${me.team})">${teamName(me.team)}</div>
        <button class="btn" style="margin-top:16px" onclick="QP.c('team',{playerId:'${me.id}'})">${t('switchTeam')} ⇄</button></div>
        ${me.vip ? `<button class="btn primary" onclick="QP.c('next')">${t('continue')} ▶</button>` : ''}`;
    },

    'squares-intro'(g, me) {
      return `<div class="card"><div class="team-pill" style="background:var(--team${me.team})">${teamName(me.team)}</div><h2 style="margin-top:14px">${esc(ttl(g))}</h2><p class="muted">${t('starts', { team: teamName(g.turnTeam) })}</p></div>`;
    },

    'squares-turn'(g, me) {
      if (g.turnTeam !== me.team) return `<div class="card"><div class="big-emoji">🤔</div><h2>${t('otherTeamTurn')}</h2><p class="prompt">${esc(ttl(g))}</p></div>${timerLine()}`;
      const gp = S.players.find(p => p.id === g.guesser);
      const guesserGone = !gp || !gp.connected;
      if (g.guesser === me.id || guesserGone) {
        return `<div class="card team-${me.team}"><h2>${t('youGuess')}</h2><div style="font-size:13px;opacity:.85">${t('squaresAsk')}</div>${g.opts.threeStrikes ? `<div>${t('strikes')}: ${'✗'.repeat(g.strikes) || '—'}</div>` : ''}</div>
          <div class="prompt">${esc(ttl(g))}${sub(g) ? `<div class="muted" style="font-size:13px;font-weight:400">${esc(sub(g))}</div>` : ''}</div>${timerLine()}
          <input type="text" id="ans" maxlength="80" placeholder="${t('typeAnswer')}" autocomplete="off" autocapitalize="sentences">
          <button class="btn primary" data-send onclick="QP.sq()">${t('send')}</button>
          <div class="muted" style="font-size:14px">${t('teamSuggests')}</div><div class="sugs" id="sugs">${sugList()}</div>`;
      }
      return `<div class="card team-${me.team}">${gp ? avatar(gp.avatar, 'md') : ''}<h2>${t('waitGuesser', { name: esc(gp ? gp.name : '?') })}</h2></div>
        <div class="prompt">${esc(ttl(g))}${sub(g) ? `<div class="muted" style="font-size:13px;font-weight:400">${esc(sub(g))}</div>` : ''}</div>${timerLine()}
        <input type="text" id="ans" maxlength="30" placeholder="${t('suggestHint', { name: esc(gp ? gp.name : '') })}" autocomplete="off" autocapitalize="sentences">
        <button class="btn" data-send onclick="QP.sug()">💡 ${t('suggest')}</button>
        <div class="sugs" id="sugs">${sugList()}</div>`;
    },

    'squares-result'(g) {
      const l = g.last;
      if (!l) return VIEWS.wait();
      const good = ['claim', 'steal', 'improve'].includes(l.kind);
      const sq = l.square >= 0 ? g.squares[l.square] : null;
      const icon = good ? '✅' : { blocked: '🛡️', locked: '🔒', nochange: '🟰', used: '↺' }[l.kind] || '❌';
      return `<div class="card"><div class="big-emoji">${icon}</div>
        <h2>${t(l.kind === 'locked' ? 'lockedSq' : l.kind, { team: teamName(l.team), owner: sq && sq.owner ? teamName(sq.owner) : '', pos: l.pos, best: sq && sq.best ? sq.best.pos : '' })}</h2>
        ${l.text ? `<p class="muted">${esc(l.by || '')}: “${esc(l.text)}”${l.answer ? ` → ${esc(l.answer)} (#${l.pos})` : ''}</p>` : ''}</div>`;
    },

    'squares-end'(g, me) {
      const won = g.winner === me.team;
      return `<div class="card"><div class="big-emoji">${g.winner === 'draw' ? '🤝' : won ? '🏆' : '😢'}</div><h1>${g.winner === 'draw' ? t('draw') : t('wins', { team: teamName(g.winner) })}</h1></div>`;
    },
  };

  function sugList() {
    const g = S.game;
    const mine = g && g.guesser === S.me.id;
    return (S.suggestions || []).map(x => mine
      ? `<button onclick="QP.useSug(this.dataset.t)" data-t="${esc(x.text)}">💡 ${esc(x.text)} <span class="muted" style="font-size:12px">${esc(x.by)}</span></button>`
      : `<button disabled>💡 ${esc(x.text)}</button>`).join('');
  }

  function lb() {
    return `<div class="card lb" style="text-align:left">${S.players.slice(0, 10).map((p, i) => `<div class="${p.id === S.me.id ? 'me' : ''}"><span>${i + 1}. ${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}</div>`;
  }

  // timer text
  setInterval(() => {
    const el = document.querySelector('[data-timer]');
    if (!el || !S || !S.endsAt) return;
    const s = Math.max(0, Math.ceil((S.endsAt - (Date.now() + offset)) / 1000));
    el.innerHTML = `⏱ <b>${s}</b>s`;
  }, 250);

  window.QP = {
    c,
    kick: kickPlayer,
    answer(i) { buzz(30); socket.emit('answer', i); },
    hilo() { const v = document.getElementById('ans').value.trim(); if (v) socket.emit('hilo:submit', v); },
    sq() { const v = document.getElementById('ans').value.trim(); if (v) { socket.emit('squares:guess', v); document.getElementById('ans').disabled = true; } },
    sug() { const el = document.getElementById('ans'); const v = el.value.trim(); if (v) { socket.emit('squares:suggest', v); el.value = ''; el.placeholder = t('sentSuggestion'); buzz(30); } },
    useSug(v) { const el = document.getElementById('ans'); if (el) { el.value = v; el.focus(); } },
    vote(i) { buzz(30); socket.emit('hilo:vote', i); },
    fin(i) { buzz(30); socket.emit('hilo:final', i); },
  };
})();
