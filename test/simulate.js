const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let H = null;
const host = io(URL);
host.on('host:state', s => (H = s));
host.on('host:notice', k => console.log('NOTICE', k));
const waitPhase = async (ph, ms = 20000) => { const t0 = Date.now(); while (!(H && (Array.isArray(ph) ? ph.includes(H.phase) : H.phase === ph))) { if (Date.now() - t0 > ms) throw new Error('timeout waiting ' + ph + ' (at ' + (H && H.phase) + ')'); await sleep(30); } return H; };
(async () => {
  const { code } = await new Promise(r => host.emit('host:create', {}, r));
  console.log('room', code, H && H.joinUrl);
  const names = ['Ana', 'Beto', 'Caro', 'Dani'];
  const P = [];
  for (const n of names) {
    const s = io(URL); const p = { s, n, st: null }; s.on('player:state', x => (p.st = x));
    const res = await new Promise(r => s.emit('player:join', { code, name: n }, r)); p.token = res.token; P.push(p);
  }
  const dup = io(URL); console.log('dup name ->', (await new Promise(r => dup.emit('player:join', { code, name: 'ana' }, r))).error);
  await sleep(200);
  const vip = P.find(p => p.st.me.vip); console.log('vip', vip.n);
  const ctl = (a, d) => vip.s.emit('control', { action: a, data: d });
  ctl('start'); await waitPhase('menu');
  console.log('menu counts', JSON.stringify(H.menuInfo.counts));
  // ---- CLASSIC
  ctl('menu', { mode: 'classic', count: 3 }); await sleep(100); ctl('play');
  for (let q = 0; q < 3; q++) {
    await waitPhase('intro'); ctl('next'); await waitPhase('question');
    const g = H.game; const corr = null;
    P.forEach((p, i) => p.s.emit('answer', i % g.options.length));
    await waitPhase('reveal'); console.log(`Q${q + 1} "${g.prompt}" correct=${H.game.correct} tally=${H.game.tally} gained=${JSON.stringify(Object.values(H.game.gained))} media=${H.game.media && H.game.media.type}`);
    ctl('next'); if (q < 2) { await waitPhase('scores'); ctl('next'); }
  }
  await waitPhase('final'); console.log('final', H.players.map(p => p.name + ':' + p.score).join(' '));
  ctl('next'); await waitPhase('menu');
  // ---- HILO: vote once -> HI, HI, LO, LO on the same hidden list -> 4 higher/lower bonus questions -> full list
  ctl('menu', { mode: 'hilo', count: 4 }); await sleep(100); ctl('play');
  await waitPhase(['hilo-vote', 'hilo-intro']);
  if (H.phase === 'hilo-vote') { console.log('vote options:', H.game.candidates.map(c => c.title).join(' | ')); P.forEach((p, i) => p.s.emit('hilo:vote', i % H.game.candidates.length)); }
  let firstHit = null;
  for (let q = 0; q < 4; q++) {
    await waitPhase('hilo-intro'); ctl('next'); await waitPhase('hilo-input');
    if (q > 0 && !H.game.uncovered.length) throw new Error('uncovered answers not shown after round 1');
    const sv = require('../data/quiz.json').surveys.find(s => s.prompt === H.game.prompt && (s.title || '') === (H.game.title || ''));
    const A = sv.answers;
    const words = q === 0 ? [A[0].text, A[0].text, A[A.length - 1].text, 'zzzz'] : [firstHit, A[q + 2].text, A[A.length - 1 - q].text, 'zzzz'];
    if (q === 0) firstHit = A[0].text;
    P.forEach((p, i) => p.s.emit('hilo:submit', words[i]));
    await sleep(300);
    if (P[3].st.myMiss !== 'zzzz' || P[3].st.mySub) throw new Error('off-list answer should ask to retry');
    P[3].s.emit('hilo:submit', A[Math.floor(A.length / 2) + q].text); // second try, on the list
    await waitPhase('hilo-reveal'); const g = H.game;
    const leaked = g.ranked.filter((r, i) => r.text && !g.prev.includes(i) && !Object.values(g.subs).some(s => s.idx === i));
    if (leaked.length) throw new Error('LEAK: ' + leaked.map(r => r.text).join(', '));
    console.log(`R${q + 1} ${g.dir.toUpperCase()} "${g.title}"`, Object.entries(g.subs).map(([k, s]) => `${s.text}->${s.idx >= 0 ? '#' + g.ranked[s.idx].rank : 'X'}${g.stale.includes(k) ? '(already)' : ''}:${g.gained[k]}`).join(', '));
    if (q > 0 && g.gained[P[0].st.me.id] !== 0) throw new Error('repeated answer should score 0');
    ctl('next'); await waitPhase('scores'); ctl('next');
  }
  for (let f = 0; f < 4; f++) {
    await waitPhase('hilo-final'); const fo = H.game.final.options.map(o => o.text);
    P.forEach((p, i) => p.s.emit('hilo:final', i % 2));
    await waitPhase('hilo-final-reveal'); const F = H.game.final;
    const ok = F.ask === 'higher' ? F.options[F.correct].rank < F.options[1 - F.correct].rank : F.options[F.correct].rank > F.options[1 - F.correct].rank;
    if (!ok) throw new Error('bonus answer wrong');
    console.log(`BONUS ${F.n}/${F.total} ${F.ask}: ${F.options.map(o => o.text + '#' + o.rank).join(' vs ')} -> ${F.options[F.correct].text} (${F.pts} pts)`);
    ctl('next');
  }
  await waitPhase('hilo-list'); console.log('full list rows with text:', H.game.ranked.filter(r => r.text).length, '/', H.game.ranked.length);
  ctl('next'); await waitPhase('scores'); ctl('next');
  await waitPhase('final'); ctl('next'); await waitPhase('menu');
  // ---- SQUARES (rotating guesser + suggestions)
  ctl('menu', { mode: 'squares', count: 1, threeStrikes: true, scrambled: false }); await sleep(100); ctl('play');
  await waitPhase('squares-teams'); console.log('teams', H.players.map(p => p.name + p.team).join(' '));
  ctl('next'); await waitPhase('squares-intro'); ctl('next');
  console.log('board:', H.game.prompt, 'size', H.game.size, 'bands', H.game.squares.map(s => s.from + '-' + s.to).join(' '));
  const sv2 = require('../data/quiz.json').surveys.find(s => s.prompt === H.game.prompt && (s.title || '') === (H.game.title || ''));
  const words = sv2.answers.map(a => a.text).concat(['nope1', 'nope2']).sort(() => Math.random() - .5);
  let turns = 0;
  while (turns < 45) {
    await waitPhase(['squares-turn', 'squares-end', 'final', 'scores']);
    if (H.phase !== 'squares-turn') break;
    const team = H.game.turnTeam;
    const guesser = P.find(p => p.st.me.id === H.game.guesser);
    const mate = P.find(p => p.st.me.team === team && p !== guesser);
    const other = P.find(p => p.st.me.team !== team);
    if (other) other.s.emit('squares:guess', 'cheat'); // must be ignored
    if (mate) mate.s.emit('squares:suggest', 'idea ' + turns);
    await sleep(80);
    const w = words.shift() || 'zzz'; guesser.s.emit('squares:guess', w);
    await waitPhase('squares-result'); const l = H.game.last;
    console.log(`  ${team} ${guesser.n}${mate ? ' (sug ' + (guesser.st.suggestions || []).length + ')' : ''}: ${w} -> ${l.kind}${l.locked ? ' LOCK' : ''} sq${l.square}`);
    if (H.game.winner) console.log('WINNER', H.game.winner, H.game.winLine);
    ctl('next'); turns++;
  }
  await waitPhase('squares-end'); console.log('board owners', H.game.squares.map(s => s.owner || '-').join(''));
  ctl('next'); await waitPhase('final'); console.log('final', H.players.map(p => p.name + ':' + p.score).join(' '));
  // reconnect test
  P[2].s.disconnect(); await sleep(150); console.log('Caro connected?', H.players.find(p => p.name === 'Caro').connected);
  const s2 = io(URL); const r2 = await new Promise(r => s2.emit('player:join', { code, name: 'Caro', token: P[2].token }, r)); await sleep(150);
  console.log('rejoin', r2.ok, 'connected', H.players.find(p => p.name === 'Caro').connected, 'count', H.players.length);
  console.log('ALL OK'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message, H && H.phase); process.exit(1); });
