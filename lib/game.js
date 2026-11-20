// Room + game engine. One Room per TV. The server is the single source of truth;
// the TV (host) and phones (players) only render the state they're sent.

const crypto = require('crypto');
const MIXED = '__mixed'; // sub-topic id for items without one
const subOf = x => x.sub || x.series || MIXED;
const { matchAnswer, rankSurvey } = require('./match');

const MAX_PLAYERS = 16;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Room {
  constructor(io, code, getDB) {
    this.io = io;
    this.code = code;
    this.getDB = getDB;
    this.hostKey = crypto.randomUUID();
    this.hostSockets = new Set();
    this.players = new Map(); // id -> player
    this.vip = null;
    this.phase = 'lobby';
    this.endsAt = null;
    this.timer = null;
    this.onNext = null;
    this.game = null;
    this.joinUrl = '';
    this.qr = '';
    this.lastActive = Date.now();
    this.menu = { mode: 'classic', cats: [], count: 10, scrambled: false, threeStrikes: false, series: [] }; // cats: [] = every category; series: 'cat::sub' keys ticked (none ticked for a category = all its sub-topics)
  }

  get settings() {
    return this.getDB().settings || {};
  }

  // ---------- players ----------
  join(name, token, socket) {
    name = String(name || '').trim().slice(0, 16);
    if (token) {
      for (const p of this.players.values()) {
        if (p.token === token) {
          p.socketId = socket.id;
          p.connected = true;
          if (name) p.name = name;
          if (!this.vip) this.vip = p.id;
          return { player: p };
        }
      }
    }
    if (!name) return { error: 'name' };
    if ([...this.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return { error: 'nameTaken' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'full' };
    const p = {
      id: crypto.randomUUID().slice(0, 8),
      token: crypto.randomUUID(),
      name,
      score: 0,
      team: null,
      connected: true,
      socketId: socket.id,
      avatar: this.freeAvatar(),
    };
    this.players.set(p.id, p);
    if (!this.vip) this.vip = p.id;
    if (this.game && this.game.mode === 'squares') p.team = this.smallerTeam();
    return { player: p };
  }

  freeAvatar() {
    const taken = new Set([...this.players.values()].map(p => p.avatar));
    for (let i = 0; i < 16; i++) if (!taken.has(i)) return i;
    return Math.floor(Math.random() * 16);
  }

  disconnect(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) {
        p.connected = false;
        if (this.vip === p.id) {
          const next = [...this.players.values()].find(x => x.connected);
          if (next) this.vip = next.id;
        }
      }
    }
    this.sync();
  }

  kick(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.socketId) this.io.to(p.socketId).emit('player:kicked');
    this.players.delete(id);
    if (this.vip === id) this.vip = ([...this.players.values()].find(x => x.connected) || {}).id || null;
    this.sync();
  }

  connectedPlayers() {
    return [...this.players.values()].filter(p => p.connected);
  }

  smallerTeam() {
    const ps = [...this.players.values()];
    const a = ps.filter(p => p.team === 'A').length;
    const b = ps.filter(p => p.team === 'B').length;
    return a <= b ? 'A' : 'B';
  }

  // ---------- phase helpers ----------
  setPhase(phase, ms, next) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.onNext = next || null;
    this.endsAt = ms ? Date.now() + ms : null;
    if (ms && next) this.timer = setTimeout(() => this.advance(), ms);
    this.sync();
  }

  advance() {
    const fn = this.onNext;
    this.onNext = null;
    clearTimeout(this.timer);
    if (fn) fn();
  }

  toMenu() {
    clearTimeout(this.timer);
    this.game = null;
    this.setPhase('menu');
  }

  // ---------- controls (TV remote or VIP phone) ----------
  control(action, data = {}, fromHost = false) {
    this.lastActive = Date.now();
    switch (action) {
      case 'start':
        if (this.phase === 'lobby') this.toMenu();
        break;
      case 'menu':
        if (this.phase === 'menu') {
          const m = this.menu;
          if (['classic', 'hilo', 'squares'].includes(data.mode) && data.mode !== m.mode) {
            m.mode = data.mode;
            m.count = { classic: 10, hilo: 4, squares: 1 }[data.mode]; // sensible default per mode
          }
          // categories combine freely: tap to add/remove one; '' (= All) clears the selection
          if (typeof data.category === 'string') {
            if (!data.category) { m.cats = []; m.series = []; }
            else {
              const i = m.cats.indexOf(data.category);
              if (i >= 0) { m.cats.splice(i, 1); m.series = m.series.filter(k => !k.startsWith(data.category + '::')); }
              else m.cats.push(data.category);
            }
          }
          if (data.count) m.count = Math.max(1, Math.min(50, Number(data.count) || 10));
          if (typeof data.scrambled === 'boolean') m.scrambled = data.scrambled;
          if (typeof data.threeStrikes === 'boolean') m.threeStrikes = data.threeStrikes;
          // sub-topics ('cat::sub'): toggle one on/off; allSeries:'<cat>' clears that category's ticks (= all of it)
          if (typeof data.toggleSeries === 'string' && data.toggleSeries.includes('::')) {
            const i = m.series.indexOf(data.toggleSeries);
            if (i >= 0) m.series.splice(i, 1); else m.series.push(data.toggleSeries);
          }
          if (typeof data.allSeries === 'string') m.series = m.series.filter(k => !k.startsWith(data.allSeries + '::'));
          this.sync();
        }
        break;
      case 'play':
        if (this.phase === 'menu') this.startMode();
        break;
      case 'next':
        this.advance();
        break;
      case 'replay':
        for (const s of this.hostSockets) this.io.to(s).emit('host:replay');
        break;
      case 'end':
        if (this.phase !== 'lobby') this.toMenu();
        break;
      case 'lobby':
        this.game = null;
        this.setPhase('lobby');
        break;
      case 'resetScores':
        for (const p of this.players.values()) p.score = 0;
        this.sync();
        break;
      case 'kick': // TV or VIP, only before a game starts (lobby, game menu, team picking)
        if (['lobby', 'menu', 'squares-teams'].includes(this.phase)) this.kick(data.id);
        break;
      case 'team':
        if (this.phase === 'squares-teams' && data.playerId) {
          const p = this.players.get(data.playerId);
          if (p) { p.team = p.team === 'A' ? 'B' : 'A'; this.sync(); }
        }
        break;
    }
  }

  // Items can carry a sub-topic ("sub": "Zelda", "Football", "Death Note"…; older data used "series").
  // An item plays when its category is selected (or none is = all), and, if some of that
  // category's sub-topics are ticked, its sub-topic is one of them.
  seriesOk(x) {
    const m = this.menu, sel = (m.series || []).filter(k => k.startsWith(x.category + '::'));
    return !sel.length || sel.includes(x.category + '::' + subOf(x));
  }
  itemOk(x) {
    const cats = this.menu.cats || [];
    return (!cats.length || cats.includes(x.category)) && this.seriesOk(x);
  }

  menuInfo() {
    const db = this.getDB();
    const cats = db.categories || [];
    const count = (list, pred) => {
      const out = { '': list.filter(pred).length };
      for (const c of cats) out[c.id] = list.filter(x => x.category === c.id && pred(x)).length;
      return out;
    };
    const okQ = q => (q.options || []).filter(Boolean).length >= 2;
    const okH = s => rankSurvey(s).length >= 5;
    const okS = s => rankSurvey(s).length >= 9;
    // sub-topic lists, one group per selected category
    const seriesList = (list, pred) => (this.menu.cats || []).map(cat => {
      const n = {};
      for (const x of list) if (x.category === cat && pred(x)) n[subOf(x)] = (n[subOf(x)] || 0) + 1;
      const ord = id => ({ 'Dragon Ball': 'Dragon Ball 0', 'Dragon Ball Z': 'Dragon Ball 1', 'Dragon Ball GT': 'Dragon Ball 2', 'Dragon Ball Super': 'Dragon Ball 3' }[id] || id); // series in story order
      const subs = Object.entries(n).sort((a, b) => (a[0] === MIXED) - (b[0] === MIXED) || /^Mixed|^General/.test(a[0]) - /^Mixed|^General/.test(b[0]) || ord(a[0]).localeCompare(ord(b[0]))).map(([id, c]) => ({ id, key: cat + '::' + id, n: c }));
      return { cat, subs };
    }).filter(gr => gr.subs.length >= 2);
    return {
      categories: cats,
      counts: {
        classic: count(db.trivia || [], q => okQ(q) && this.seriesOk(q)),
        hilo: count(db.surveys || [], s => okH(s) && this.seriesOk(s)),
        squares: count(db.surveys || [], s => okS(s) && this.seriesOk(s)),
      },
      selected: ({ classic: db.trivia || [], hilo: db.surveys || [], squares: db.surveys || [] }[this.menu.mode] || []).filter(x => (this.menu.mode === 'classic' ? okQ(x) : this.menu.mode === 'hilo' ? okH(x) : okS(x)) && this.itemOk(x)).length,
      series: { classic: seriesList(db.trivia || [], okQ), hilo: seriesList(db.surveys || [], okH), squares: seriesList(db.surveys || [], okS) },
    };
  }

  startMode() {
    const m = this.menu;
    for (const p of this.players.values()) p.score = 0; // every game starts from zero
    if (m.mode === 'classic') this.startClassic(m.count);
    else if (m.mode === 'hilo') this.startHilo(m.count);
    else if (m.mode === 'squares') this.startSquares(m.count);
  }

  finishGame() {
    this.game = null;
    this.setPhase('final', null, () => this.toMenu());
  }

  // ======================= CLASSIC TRIVIA =======================
  // Scores are sized so a whole game stays under 1,000 points (3 digits):
  //   Trivia: a perfect game ≈ 900 · HILO: guessing rounds ≈ 600 + bonus 250 · SQUARES: +10 per claim/steal, +100 per board won.
  startClassic(count) {
    const db = this.getDB();
    const pool = shuffle((db.trivia || []).filter(q => this.itemOk(q) && (q.options || []).filter(Boolean).length >= 2)).slice(0, count);
    if (!pool.length) return this.notice('noQuestions');
    this.game = { mode: 'classic', qs: pool, i: -1, answers: new Map(), gained: {}, maxPts: Math.max(10, Math.round(900 / pool.length)) };
    this.classicNext();
  }

  classicNext() {
    const g = this.game;
    g.i++;
    if (g.i >= g.qs.length) return this.finishGame();
    g.answers = new Map();
    g.gained = {};
    this.setPhase('intro', 1800, () => this.classicAsk());
  }

  classicAsk() {
    const g = this.game;
    const q = g.qs[g.i];
    g.total = (Number(q.time) || this.settings.classicTime || 20) * 1000;
    g.startedAt = Date.now();
    this.setPhase('question', g.total, () => this.classicReveal());
  }

  classicAnswer(p, idx) {
    const g = this.game;
    if (this.phase !== 'question' || !g || g.mode !== 'classic' || g.answers.has(p.id)) return;
    const q = g.qs[g.i];
    idx = Number(idx);
    if (!(idx >= 0 && idx < q.options.length)) return;
    g.answers.set(p.id, { idx, t: Date.now() - g.startedAt });
    if (this.connectedPlayers().every(x => g.answers.has(x.id))) this.advance();
    else this.sync();
  }

  classicReveal() {
    const g = this.game;
    const q = g.qs[g.i];
    for (const [pid, a] of g.answers) {
      const p = this.players.get(pid);
      if (!p) continue;
      let pts = 0;
      if (a.idx === Number(q.correct)) pts = Math.round(g.maxPts / 2 + (g.maxPts / 2) * Math.max(0, 1 - a.t / g.total));
      p.score += pts;
      g.gained[pid] = pts;
    }
    this.setPhase('reveal', 6000, () => this.scoresThen(() => this.classicNext(), g.i === g.qs.length - 1));
  }

  scoresThen(fn, isLast) {
    if (isLast) return fn();
    this.setPhase('scores', 3500, fn);
  }

  // ======================= HILO (Survey Scramble rules) =======================
  // One list for the whole game, picked by vote out of 3. The list stays hidden: only answers
  // somebody actually guessed get uncovered, and they stay uncovered for the following rounds.
  //   HI rounds  -> name something as close to #1 as possible
  //   LO rounds  -> name something as close to the bottom as possible (it must be ON the list)
  //   Answers already uncovered in an earlier round score 0. Same answer this round = points split.
  //   Bonus round: head-to-heads from the same list, alternating "which is HIGHER?" / "which is LOWER?"
  //   Then the whole list is revealed.
  startHilo(count) {
    const db = this.getDB();
    const pool = shuffle((db.surveys || []).filter(s => this.itemOk(s) && rankSurvey(s).length >= 5));
    if (!pool.length) return this.notice('noSurveys');
    const rounds = Math.max(2, Math.min(count || 4, 10));
    const dirs = Array.from({ length: rounds }, (_, i) => (i < Math.ceil(rounds / 2) ? 'hi' : 'lo'));
    // candidates: 3 topics from different categories when possible
    const picked = [], cats = new Set();
    for (const sv of pool) if (picked.length < 3 && !cats.has(sv.category)) { picked.push(sv); cats.add(sv.category); }
    for (const sv of pool) if (picked.length < 3 && !picked.includes(sv)) picked.push(sv);
    this.game = {
      mode: 'hilo', dirs, rounds, i: -1, candidates: picked, votes: new Map(), maxPts: Math.round(600 / rounds),
      subs: new Map(), gained: {}, revealed: new Set(), prevRevealed: new Set(), stale: new Set(),
      finals: ['higher', 'lower', 'higher', 'lower'], finalIdx: -1, final: null,
    };
    if (picked.length === 1) return this.hiloPick();
    this.setPhase('hilo-vote', 15000, () => this.hiloPick());
  }

  hiloVote(p, idx) {
    const g = this.game;
    if (this.phase !== 'hilo-vote' || !g || g.mode !== 'hilo') return;
    idx = Number(idx);
    if (!(idx >= 0 && idx < g.candidates.length)) return;
    g.votes.set(p.id, idx);
    if (this.connectedPlayers().every(x => g.votes.has(x.id))) this.advance();
    else this.sync();
  }

  hiloPick() {
    const g = this.game;
    const tally = g.candidates.map((_, i) => [...g.votes.values()].filter(v => v === i).length);
    const max = Math.max(...tally);
    const winners = tally.map((t, i) => (t === max ? i : -1)).filter(i => i >= 0);
    g.survey = g.candidates[winners[Math.floor(Math.random() * winners.length)]];
    g.ranked = rankSurvey(g.survey);
    this.hiloNext();
  }

  hiloNext() {
    const g = this.game;
    g.i++;
    if (g.i >= g.rounds) return this.hiloFinalNext();
    g.dir = g.dirs[g.i];
    g.subs = new Map();
    g.gained = {};
    g.prevRevealed = new Set(g.revealed);
    this.setPhase('hilo-intro', 4500, () => this.setPhase('hilo-input', (this.settings.hiloTime || 35) * 1000, () => this.hiloReveal()));
  }

  hiloSubmit(p, text) {
    const g = this.game;
    if (this.phase !== 'hilo-input' || !g || g.mode !== 'hilo') return;
    text = String(text || '').trim().slice(0, 80);
    if (!text) return;
    const m = matchAnswer(text, g.ranked);
    // Not on the list: nothing is locked in — the phone says so and the player can try again until time runs out.
    if (!m) { (g.misses || (g.misses = new Map())).set(p.id, text); return this.sync(); }
    if (g.misses) g.misses.delete(p.id);
    g.subs.set(p.id, { text, idx: m.idx });
    if (this.connectedPlayers().every(x => g.subs.has(x.id))) this.advance();
    else this.sync();
  }

  hiloReveal() {
    const g = this.game;
    const maxRank = g.ranked.length ? g.ranked[g.ranked.length - 1].rank : 1;
    const sharing = {};
    g.stale = new Set();
    for (const s of g.subs.values()) if (s.idx >= 0 && !g.prevRevealed.has(s.idx)) sharing[s.idx] = (sharing[s.idx] || 0) + 1;
    for (const [pid, s] of g.subs) {
      const p = this.players.get(pid);
      if (!p) continue;
      let pts = 0;
      if (s.idx >= 0 && g.prevRevealed.has(s.idx)) g.stale.add(pid); // already uncovered in an earlier round
      else if (s.idx >= 0) {
        const r = g.ranked[s.idx].rank;
        const base = g.dir === 'hi' ? Math.round((g.maxPts * (maxRank - r + 1)) / maxRank) : Math.round((g.maxPts * r) / maxRank);
        pts = Math.round(base / sharing[s.idx]);
        g.revealed.add(s.idx);
      }
      p.score += pts;
      g.gained[pid] = pts;
    }
    // reveal order: worst first, best last (the TV animates one player at a time)
    g.order = [...g.subs.keys()].sort((a, b) => (g.gained[a] || 0) - (g.gained[b] || 0));
    const ms = 3500 + 3000 * g.order.length + 5500;
    this.setPhase('hilo-reveal', ms, () => this.setPhase('scores', 4000, () => this.hiloNext()));
  }

  // Bonus round: two answers from the same list, "which one is HIGHER?" / "which one is LOWER?"
  hiloFinalNext() {
    const g = this.game;
    g.finalIdx++;
    g.prevRevealed = new Set(g.revealed);
    if (g.finalIdx >= g.finals.length) return this.hiloFullList();
    const n = g.ranked.length;
    const used = new Set(g.final ? g.final.used : []);
    // prefer answers nobody has uncovered yet, far enough apart that it's a fair question
    const hidden = g.ranked.map((a, i) => i).filter(i => !g.revealed.has(i) && !used.has(i));
    const cand = hidden.length >= 2 ? hidden : g.ranked.map((a, i) => i).filter(i => !used.has(i));
    const gap = Math.max(1, Math.round(n * 0.04));
    let a, b, tries = 0;
    do { [a, b] = shuffle(cand).slice(0, 2); tries++; } while (tries < 60 && (a === undefined || b === undefined || Math.abs(g.ranked[a].rank - g.ranked[b].rank) < gap));
    if (a === undefined || b === undefined || g.ranked[a].rank === g.ranked[b].rank) return this.hiloFullList();
    const ask = g.finals[g.finalIdx];
    const higher = g.ranked[a].rank < g.ranked[b].rank ? 0 : 1;
    const opt = i => ({ text: g.ranked[i].text, rank: g.ranked[i].rank, pct: g.ranked[i].pct, count: g.ranked[i].count, idx: i });
    g.final = {
      ask, options: [opt(a), opt(b)], correct: ask === 'higher' ? higher : 1 - higher,
      picks: new Map(), n: g.finalIdx + 1, total: g.finals.length, used: [...used, a, b],
      pts: g.finalIdx === g.finals.length - 1 ? 100 : 50, double: g.finalIdx === g.finals.length - 1, // last one is worth double
    };
    this.setPhase('hilo-final', 12000, () => this.hiloFinalReveal());
  }

  hiloFinalPick(p, idx) {
    const g = this.game;
    if (this.phase !== 'hilo-final' || !g || g.mode !== 'hilo' || g.final.picks.has(p.id)) return;
    idx = Number(idx);
    if (idx !== 0 && idx !== 1) return;
    g.final.picks.set(p.id, idx);
    if (this.connectedPlayers().every(x => g.final.picks.has(x.id))) this.advance();
    else this.sync();
  }

  hiloFinalReveal() {
    const g = this.game;
    g.gained = {};
    for (const [pid, idx] of g.final.picks) {
      const p = this.players.get(pid);
      if (!p) continue;
      const pts = idx === g.final.correct ? g.final.pts : 0;
      p.score += pts;
      g.gained[pid] = pts;
    }
    for (const o of g.final.options) g.revealed.add(o.idx);
    this.setPhase('hilo-final-reveal', 6000, () => this.hiloFinalNext());
  }

  // End of the game: scroll through the complete list, then scores and podium.
  hiloFullList() {
    const g = this.game;
    g.final = null;
    const ms = Math.min(120000, 12000 + g.ranked.length * 250); // slow scroll so the whole list can be read
    this.setPhase('hilo-list', ms, () => this.setPhase('scores', 6000, () => this.finishGame()));
  }

  // ======================= SQUARES (Survey Scramble rules) =======================
  startSquares(count) {
    const db = this.getDB();
    const pool = shuffle((db.surveys || []).filter(s => this.itemOk(s) && rankSurvey(s).length >= 9)).slice(0, count);
    if (!pool.length) return this.notice('noSquares');
    for (const p of this.players.values()) p.team = null;
    for (const p of shuffle([...this.players.values()])) p.team = this.smallerTeam();
    this.game = { mode: 'squares', qs: pool, i: -1, wins: { A: 0, B: 0 }, rot: { A: 0, B: 0 }, opts: { scrambled: !!this.menu.scrambled, threeStrikes: !!this.menu.threeStrikes } };
    this.setPhase('squares-teams', null, () => this.squaresBoard());
  }

  // Square sizes grow down the list: the first square holds the top 2–3 answers, the last one a big chunk of the tail.
  static bandSizes(n) {
    const first = n >= 40 ? 3 : n >= 18 ? 2 : 1;
    const sum = r => (r === 1 ? 9 * first : (first * (Math.pow(r, 9) - 1)) / (r - 1));
    let lo = 1, hi = 6;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (sum(mid) < n) lo = mid; else hi = mid; }
    const sizes = Array.from({ length: 9 }, (_, k) => Math.max(1, Math.round(first * Math.pow(lo, k))));
    let diff = n - sizes.reduce((a, b) => a + b, 0);
    for (let k = 8, guard = 0; diff !== 0 && guard < 200; k = k > 0 ? k - 1 : 8, guard++) {
      if (diff > 0) { sizes[k]++; diff--; } else if (sizes[k] > 1) { sizes[k]--; diff++; }
    }
    return sizes;
  }

  squaresBoard() {
    const g = this.game;
    g.i++;
    if (g.i >= g.qs.length) return this.finishGame();
    const ranked = rankSurvey(g.qs[g.i]);
    g.ranked = ranked;
    const sizes = Room.bandSizes(ranked.length);
    const bands = [];
    let from = 0;
    for (const sz of sizes) { bands.push({ from, to: from + sz - 1 }); from += sz; }
    const order = g.opts.scrambled ? shuffle([...Array(9).keys()]) : [...Array(9).keys()];
    g.squares = order.map(b => ({ band: b, from: bands[b].from, to: bands[b].to, owner: null, best: null, locked: false }));
    g.used = new Set();
    g.turnTeam = g.i % 2 === 0 ? 'A' : 'B';
    g.strikes = 0;
    g.turns = 0;
    g.last = null;
    g.winLine = null;
    g.winner = null;
    g.history = [];
    this.setPhase('squares-intro', 5500, () => this.squaresTurn());
  }

  teamMembers(team) {
    return [...this.players.values()].filter(p => p.team === team && p.connected);
  }

  squaresTurn() {
    const g = this.game;
    g.last = null;
    const members = this.teamMembers(g.turnTeam);
    g.guesser = members.length ? members[g.rot[g.turnTeam] % members.length].id : null;
    g.rot[g.turnTeam]++;
    g.suggestions = [];
    this.setPhase('squares-turn', (this.settings.squaresTime || 30) * 1000, () => this.squaresGuess(null, null));
  }

  squaresSuggest(p, text) {
    const g = this.game;
    if (this.phase !== 'squares-turn' || !g || g.mode !== 'squares' || p.team !== g.turnTeam || p.id === g.guesser) return;
    text = String(text || '').trim().slice(0, 30);
    if (!text || g.suggestions.some(s => s.text.toLowerCase() === text.toLowerCase())) return;
    g.suggestions.push({ by: p.name, text });
    if (g.suggestions.length > 8) g.suggestions.shift();
    this.sync();
  }

  squaresGuess(p, text) {
    const g = this.game;
    if (this.phase !== 'squares-turn' || !g || g.mode !== 'squares') return;
    if (p) {
      const guesser = this.players.get(g.guesser);
      const guesserGone = !guesser || !guesser.connected;
      if (p.team !== g.turnTeam || (p.id !== g.guesser && !guesserGone)) return;
    }
    const team = g.turnTeam;
    const res = { team, by: p ? p.name : null, byId: p ? p.id : null, text: text ? String(text).trim().slice(0, 80) : null, kind: 'timeout', idx: -1, square: -1 };
    if (res.text) {
      const m = matchAnswer(res.text, g.ranked);
      if (!m) res.kind = 'miss';
      else if (g.used.has(m.idx)) { res.kind = 'used'; res.idx = m.idx; }
      else {
        g.used.add(m.idx);
        res.idx = m.idx;
        const si = g.squares.findIndex(s => m.idx >= s.from && m.idx <= s.to);
        const sq = g.squares[si];
        res.square = si;
        const isTop = m.idx === sq.from;
        if (sq.locked) res.kind = 'locked';
        else if (!sq.owner) { sq.owner = team; sq.best = m.idx; res.kind = 'claim'; }
        else if (sq.owner === team) {
          if (m.idx < sq.best) { sq.best = m.idx; res.kind = 'improve'; } else res.kind = 'nochange';
        } else if (m.idx < sq.best) { sq.owner = team; sq.best = m.idx; res.kind = 'steal'; }
        else res.kind = 'blocked';
        if (['claim', 'steal', 'improve'].includes(res.kind) && isTop) { sq.locked = true; res.locked = true; }
        if (['claim', 'steal'].includes(res.kind) && p) p.score += 10;
      }
    }
    g.last = res;
    g.turns++;
    g.history.unshift({ team, by: res.by, text: res.text, kind: res.kind, pos: res.idx >= 0 ? res.idx + 1 : null, answer: res.idx >= 0 ? g.ranked[res.idx].text : null });
    if (g.history.length > 14) g.history.pop();
    const progress = ['claim', 'steal', 'improve'].includes(res.kind);

    for (const line of LINES) {
      const o = g.squares[line[0]].owner;
      if (o && line.every(i => g.squares[i].owner === o)) { g.winLine = line; g.winner = o; break; }
    }
    const exhausted = g.used.size >= g.ranked.length || g.turns >= 40 || g.squares.every(s => s.locked);
    if (!g.winner && exhausted) {
      const a = g.squares.filter(s => s.owner === 'A').length;
      const b = g.squares.filter(s => s.owner === 'B').length;
      g.winner = a > b ? 'A' : b > a ? 'B' : 'draw';
    }
    if (g.winner) {
      g.wins[g.winner] = (g.wins[g.winner] || 0) + 1;
      for (const pl of this.players.values()) {
        if (g.winner === 'draw') pl.score += pl.team ? 50 : 0;
        else if (pl.team === g.winner) pl.score += 100;
      }
      this.setPhase('squares-result', 4500, () =>
        this.setPhase('squares-end', 15000, () => this.scoresThen(() => this.squaresBoard(), g.i === g.qs.length - 1)));
      return;
    }
    if (!g.opts.threeStrikes || progress) { g.turnTeam = team === 'A' ? 'B' : 'A'; g.strikes = 0; }
    else {
      g.strikes++;
      if (g.strikes >= 3) { g.turnTeam = team === 'A' ? 'B' : 'A'; g.strikes = 0; res.struckOut = true; }
    }
    this.setPhase('squares-result', 4500, () => this.squaresTurn());
  }

  notice(key) {
    for (const s of this.hostSockets) this.io.to(s).emit('host:notice', key);
    const vip = this.players.get(this.vip);
    if (vip) this.io.to(vip.socketId).emit('player:notice', key);
  }

  // ---------- state views ----------
  playersView() {
    return [...this.players.values()]
      .map(p => ({ id: p.id, name: p.name, score: p.score, team: p.team, connected: p.connected, vip: p.id === this.vip, avatar: p.avatar }))
      .sort((a, b) => b.score - a.score);
  }

  gameView(forHost) {
    const g = this.game;
    if (!g) return null;
    if (g.mode === 'classic') {
      const base = { mode: g.mode, index: g.i, total: g.qs.length };
      const q = g.qs[g.i];
      const reveal = this.phase === 'reveal' || this.phase === 'scores';
      const v = { ...base, category: q.category, topic: subOf(q) === MIXED ? '' : subOf(q), prompt: q.prompt, options: q.options, answered: [...g.answers.keys()] };
      if (forHost) v.media = q.media || null;
      if (reveal) {
        v.correct = Number(q.correct);
        v.gained = g.gained;
        v.picks = Object.fromEntries([...g.answers].map(([k, a]) => [k, a.idx]));
        if (forHost) v.tally = q.options.map((_, i) => [...g.answers.values()].filter(a => a.idx === i).length);
      }
      v.hasAudio = !!(q.media && (q.media.type === 'audio' || q.media.type === 'video'));
      return v;
    }
    if (g.mode === 'hilo') {
      const v = { mode: 'hilo', index: g.i, total: g.rounds, dir: g.dir, gained: g.gained, maxPts: g.maxPts };
      if (this.phase === 'hilo-vote') {
        v.candidates = g.candidates.map(s => ({ title: s.title || '', prompt: s.prompt, category: s.category }));
        v.votes = g.candidates.map((_, i) => [...g.votes.values()].filter(x => x === i).length);
        v.voted = [...g.votes.keys()];
        return v;
      }
      if (!g.survey) return v;
      const s = g.survey;
      Object.assign(v, { category: s.category, title: s.title || '', prompt: s.prompt, source: s.source || '', size: g.ranked.length, hiText: s.hiText || '', loText: s.loText || '', unit: s.unit || '' });
      const full = this.phase === 'hilo-list' || (this.phase === 'scores' && g.i >= g.rounds);
      const row = (a, i) => (full || g.revealed.has(i) ? { text: a.text, rank: a.rank, pct: a.pct, count: a.count } : { rank: a.rank });
      // uncovered answers so far (shown on the TV while players type, so nobody wastes a guess)
      v.uncovered = [...g.prevRevealed].sort((a, b) => a - b).map(i => ({ ...row(g.ranked[i], i), pos: i + 1 }));
      if (this.phase === 'hilo-final' || this.phase === 'hilo-final-reveal') {
        const f = g.final;
        v.final = { n: f.n, total: f.total, ask: f.ask, pts: f.pts, double: f.double, options: f.options.map(o => ({ text: o.text })), picked: [...f.picks.keys()] };
        if (this.phase === 'hilo-final-reveal') Object.assign(v.final, { options: f.options, correct: f.correct, picks: Object.fromEntries(f.picks) });
      } else {
        v.submitted = [...g.subs.keys()];
      }
      if (forHost && (this.phase === 'hilo-reveal' || this.phase === 'hilo-list' || this.phase === 'scores')) {
        v.ranked = g.ranked.map(row);
        v.prev = [...g.prevRevealed];
        if (this.phase === 'hilo-reveal') {
          v.subs = Object.fromEntries([...g.subs].map(([k, x]) => [k, { text: x.text, idx: x.idx }]));
          v.order = g.order;
          v.stale = [...g.stale];
        }
        if (this.phase === 'hilo-list') v.hits = [...g.revealed];
      }
      return v;
    }
    if (g.mode === 'squares') {
      const base = { mode: 'squares', index: g.i, total: g.qs.length, opts: g.opts, wins: g.wins };
      if (g.i < 0) return base;
      const s = g.qs[g.i];
      const ended = this.phase === 'squares-end' || (this.phase === 'squares-result' && g.winner);
      return {
        ...base,
        category: s.category, title: s.title || '', prompt: s.prompt, source: s.source || '', unit: s.unit || '',
        size: g.ranked.length, turnTeam: g.turnTeam, strikes: g.strikes, guesser: g.guesser,
        suggestionCount: g.suggestions ? g.suggestions.length : 0,
        squares: g.squares.map(q => ({ from: q.from + 1, to: q.to + 1, owner: q.owner, locked: q.locked, best: q.best != null ? { text: g.ranked[q.best].text, pos: q.best + 1 } : null })),
        last: g.last ? { ...g.last, answer: g.last.idx >= 0 ? g.ranked[g.last.idx].text : null, pos: g.last.idx + 1 } : null,
        history: g.history,
        winner: g.winner, winLine: g.winLine,
        ranked: ended ? g.ranked.map((a, i) => ({ text: a.text, pos: i + 1, pct: a.pct, count: a.count, used: g.used.has(i) })) : null,
      };
    }
    return null;
  }

  hostView() {
    return {
      code: this.code, joinUrl: this.joinUrl, qr: this.qr,
      phase: this.phase, endsAt: this.endsAt, now: Date.now(),
      players: this.playersView(), vip: this.vip,
      menu: this.menu, menuInfo: this.phase === 'menu' ? this.menuInfo() : null,
      categories: this.getDB().categories || [],
      game: this.gameView(true),
      settings: { title: this.settings.title || '', lang: this.settings.lang || 'en', music: this.settings.music !== false },
    };
  }

  playerView(p) {
    const g = this.game;
    const v = {
      code: this.code, phase: this.phase, endsAt: this.endsAt, now: Date.now(),
      me: { id: p.id, name: p.name, score: p.score, team: p.team, vip: p.id === this.vip, avatar: p.avatar },
      players: this.playersView(), menu: this.menu,
      menuInfo: this.phase === 'menu' && p.id === this.vip ? this.menuInfo() : null,
      categories: this.getDB().categories || [],
      game: this.gameView(false),
      lang: this.settings.lang || 'en',
    };
    if (g && g.mode === 'classic' && g.answers.has(p.id)) v.myPick = g.answers.get(p.id).idx;
    if (g && g.mode === 'hilo') {
      if (g.subs.has(p.id)) v.mySub = g.subs.get(p.id).text;
      else if (g.misses && g.misses.has(p.id) && this.phase === 'hilo-input') v.myMiss = g.misses.get(p.id);
      if (g.votes.has(p.id)) v.myVote = g.votes.get(p.id);
      if (g.final && g.final.picks.has(p.id)) v.myFinal = g.final.picks.get(p.id);
    }
    if (g && g.mode === 'squares' && this.phase === 'squares-turn' && p.team === g.turnTeam) v.suggestions = g.suggestions;
    return v;
  }

  sync() {
    this.lastActive = Date.now();
    const hv = this.hostView();
    for (const s of this.hostSockets) this.io.to(s).emit('host:state', hv);
    for (const p of this.players.values()) if (p.connected && p.socketId) this.io.to(p.socketId).emit('player:state', this.playerView(p));
  }
}

module.exports = { Room };
