/* QuizParty — original music + sound effects, synthesized live with WebAudio (no audio files).
 * Music: a tiny step sequencer with 12 original loops in three groups (lobby / think / results).
 * SFX: game-show style stingers (whoosh, slam, pops with rising pitch, lock clank, fanfare…). */
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master, musicBus, sfxBus, noiseBuf;

  function init() {
    if (ctx || !AC) return ctx;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const running = () => ctx && ctx.state === 'running';
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- instruments ----------
  function osc(type, freq, t, dur, vol, bus, opts = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const a = opts.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; f.Q.value = opts.q || 1; o.connect(f); node = f; }
    node.connect(g).connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, type = 'highpass', freq = 7000, bus, sweepTo) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || sfxBus); s.start(t); s.stop(t + dur + 0.05);
  }
  const kick = (t, bus) => osc('sine', 150, t, 0.28, 0.9, bus, { slideTo: 40 });
  const hat = (t, bus, v = 0.12) => noise(t, 0.05, v, 'highpass', 8000, bus);
  const snare = (t, bus) => { noise(t, 0.16, 0.35, 'bandpass', 1800, bus); osc('triangle', 190, t, 0.1, 0.25, bus); };

  // ---------- music (original loops) ----------
  // Each track: bpm, 16-step bars [chord root (MIDI), quality], drum pattern, arpeggio, optional lead.
  // Tracks are grouped (lobby / think / results); asking for a group rotates through its tracks,
  // so every round or game gets a different tune while a phase never switches tune halfway.
  const TRACKS = {
    // --- lobby / menus ---
    lobby:    { group: 'lobby', bpm: 118, bars: [[50, 'm7'], [55, '7'], [48, 'M7'], [57, 'm7']], drums: 'kick:0,4,8,12;snare:4,12;hat:2,6,10,14', arp: [0, 7, 12, 7, 16, 12, 7, 12], lead: 'A' },
    funk:     { group: 'lobby', bpm: 108, bars: [[50, 'm9'], [55, '9'], [50, 'm9'], [57, '7']], drums: 'kick:0,6,10;snare:4,12;hat:0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', arp: [0, null, 10, 12, null, 7, null, 14], arpWave: 'sawtooth', bass: 'funk', lead: 'B', swing: 0.08 },
    synthpop: { group: 'lobby', bpm: 124, bars: [[57, 'm7'], [53, 'M7'], [48, 'M7'], [55, '7']], drums: 'kick:0,4,8,12;snare:4,12;hat:2,6,10,14;open:2,6,10,14', arp: [0, 12, 7, 12, 0, 12, 7, 16], bass: 'eighths', lead: 'C' },
    bossa:    { group: 'lobby', bpm: 128, bars: [[53, 'M7'], [55, 'm7'], [52, 'm7'], [57, '7']], drums: 'kick:0,6,8,14;hat:0,2,4,6,8,10,12,14;rim:3,6,10,13', arp: [null, 7, 11, null, 7, 12, null, 16], arpWave: 'triangle', bass: 'bossa', lead: 'D' },
    // --- thinking / answering ---
    think:    { group: 'think', bpm: 96, bars: [[45, 'm7'], [41, 'M7'], [43, '7'], [40, 'm7']], drums: 'kick:0,10;hat:4,12', arp: [0, 12, 7, 12] },
    ticktock: { group: 'think', bpm: 112, bars: [[45, 'm'], [45, 'm'], [44, 'aug'], [43, 'm6']], drums: 'kick:0,8;tick:0,4,8,12;tock:2,6,10,14', arp: [0, null, 7, null, 12, null, 7, null], arpWave: 'triangle', bass: 'pulse' },
    spy:      { group: 'think', bpm: 104, bars: [[40, 'm'], [40, 'm'], [41, 'M7'], [39, 'dim']], drums: 'kick:0,7,10;snare:12;hat:2,6,10,14', arp: [0, 3, 7, 11, 7, 3, 0, null], arpWave: 'sawtooth', bass: 'walk', lead: 'E' },
    lofi:     { group: 'think', bpm: 84, bars: [[50, 'm9'], [55, '9'], [48, 'M9'], [45, 'm7']], drums: 'kick:0,7,10;snare:4,12;hat:0,2,4,6,8,10,12,14', arp: [12, null, 7, null, 10, null, 14, null], arpWave: 'triangle', swing: 0.14 },
    // --- reveals / scores ---
    results:  { group: 'results', bpm: 126, bars: [[48, 'M7'], [53, 'M7'], [55, '7'], [52, 'm7']], drums: 'kick:0,4,8,12;snare:4,12;hat:0,2,4,6,8,10,12,14', arp: [0, 4, 7, 12, 16, 12, 7, 4], lead: 'A' },
    disco:    { group: 'results', bpm: 120, bars: [[45, 'm7'], [50, '9'], [43, 'M7'], [48, 'M7']], drums: 'kick:0,4,8,12;snare:4,12;hat:0,4,8,12;open:2,6,10,14', arp: [0, 7, 12, 7, 0, 7, 12, 14], bass: 'disco', lead: 'B' },
    chip:     { group: 'results', bpm: 144, bars: [[48, 'M'], [53, 'M'], [55, 'M'], [48, 'M']], drums: 'kick:0,8;snare:4,12;hat:2,6,10,14', arp: [0, 4, 7, 12, 7, 4, 0, 4], arpWave: 'square', bass: 'eighths', lead: 'F', leadWave: 'square' },
    anthem:   { group: 'results', bpm: 112, bars: [[50, 'M'], [55, 'M'], [57, 'M'], [55, 'M']], drums: 'kick:0,8,10;snare:4,12;hat:0,2,4,6,8,10,12,14', arp: [0, 7, 12, 16, 12, 7, 12, 19], arpWave: 'sawtooth', bass: 'eighths', lead: 'G' },
  };
  const QUAL = { m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 10, 14], '9': [0, 4, 10, 14], M9: [0, 4, 11, 14], m: [0, 3, 7, 12], M: [0, 4, 7, 12], m6: [0, 3, 7, 9], aug: [0, 4, 8, 12], dim: [0, 3, 6, 9] };
  const LEADS = {
    A: [12, null, 10, null, 7, null, 10, 12, null, 15, 14, null, 12, null, 10, null],
    B: [null, null, 12, 14, null, 12, null, 10, null, null, 7, null, 10, null, 12, null],
    C: [19, null, null, 17, null, 16, null, 14, 12, null, null, null, 14, null, 16, null],
    D: [null, 16, null, 14, null, 12, null, null, 11, null, 12, null, 14, null, null, null],
    E: [null, null, 7, 6, 7, null, null, null, 15, null, 14, null, 10, null, null, null],
    F: [12, 16, 19, 24, 19, 16, 12, null, 14, 17, 21, 26, 21, 17, 14, null],
    G: [12, null, null, 14, 16, null, 19, null, 16, null, 14, null, 12, null, null, null],
  };

  let current = null, step = 0, nextTime = 0, timerId = null, enabled = true, gainNode = null;
  const lastInGroup = {}; // group -> index of the track played last time
  function parseDrums(s) { const o = {}; s.split(';').forEach(p => { const [k, v] = p.split(':'); o[k] = v.split(',').map(Number); }); return o; }
  const has = (d, k, st) => d[k] && d[k].includes(st);

  function scheduleStep(tr, s, t) {
    const bar = tr.bars[Math.floor(s / 16) % tr.bars.length];
    const st = s % 16;
    const [root, q] = bar;
    const chord = QUAL[q].map(x => root + x);
    const d = tr._drums || (tr._drums = parseDrums(tr.drums));
    if (has(d, 'kick', st)) kick(t, gainNode);
    if (has(d, 'snare', st)) snare(t, gainNode);
    if (has(d, 'hat', st)) hat(t, gainNode, st % 4 === 2 ? 0.1 : 0.06);
    if (has(d, 'open', st)) noise(t, 0.22, 0.07, 'highpass', 6500, gainNode);
    if (has(d, 'rim', st)) osc('square', 1700, t, 0.03, 0.06, gainNode, { lp: 3000 });
    if (has(d, 'tick', st)) osc('sine', 2200, t, 0.03, 0.12, gainNode);
    if (has(d, 'tock', st)) osc('sine', 1400, t, 0.03, 0.09, gainNode);
    // bass
    const b = tr.bass || 'oct';
    const bassNote = n => osc('triangle', midi(n), t, 0.22, 0.32, gainNode, { lp: 900 });
    if (b === 'oct' && st % 2 === 0) bassNote(root - 12 + (st % 8 === 6 ? 12 : 0));
    else if (b === 'eighths' && st % 2 === 0) bassNote(root - 12);
    else if (b === 'disco' && st % 2 === 0) bassNote(root - 12 + (st % 4 === 2 ? 12 : 0));
    else if (b === 'funk' && [0, 3, 6, 10, 11, 14].includes(st)) bassNote(root - 12 + ({ 3: 12, 11: 10, 14: 7 }[st] || 0));
    else if (b === 'bossa' && [0, 6, 8, 14].includes(st)) bassNote(root - 12 + (st >= 8 ? 7 : 0));
    else if (b === 'walk' && st % 4 === 0) bassNote(root - 12 + [0, 3, 5, 6][st / 4]);
    else if (b === 'pulse' && st % 4 === 0) bassNote(root - 12);
    // pad on bar start
    if (st === 0) chord.forEach((n, i) => osc('sawtooth', midi(n + 12), t, (60 / tr.bpm) * 4, 0.035, gainNode, { lp: 1400, attack: 0.25, detune: i * 4 - 6 }));
    // arpeggio pluck on 8ths
    if (st % 2 === 0) {
      const a = tr.arp[(st / 2) % tr.arp.length];
      if (a != null) osc(tr.arpWave || 'square', midi(root + 12 + a), t, 0.12, tr.arpWave === 'sawtooth' ? 0.03 : 0.045, gainNode, { lp: 2600 });
    }
    // lead melody on the second half of the loop
    if (tr.lead && Math.floor(s / 16) % 4 >= 2) {
      const l = LEADS[tr.lead][st];
      if (l != null) osc(tr.leadWave || 'triangle', midi(root + 12 + l), t, 0.2, tr.leadWave === 'square' ? 0.04 : 0.08, gainNode, { lp: 3000 });
    }
  }

  function tick() {
    if (!current || !running()) return;
    const tr = TRACKS[current];
    const stepDur = 60 / tr.bpm / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      const sw = tr.swing && step % 2 === 1 ? stepDur * tr.swing : 0; // swing: late off-beats
      scheduleStep(tr, step, nextTime + sw);
      step = (step + 1) % (16 * tr.bars.length);
      nextTime += stepDur;
    }
  }

  // "think" -> one of the think tracks (a different one each time the group comes back)
  function resolve(name) {
    if (!TRACKS[name]) return null;
    const group = TRACKS[name].group;
    if (current && TRACKS[current].group === group) return current; // keep the tune going within a phase group
    const list = Object.keys(TRACKS).filter(k => TRACKS[k].group === group);
    const i = lastInGroup[group] === undefined ? Math.floor(Math.random() * list.length) : (lastInGroup[group] + 1) % list.length;
    lastInGroup[group] = i;
    return list[i];
  }

  const Music = {
    play(name) {
      if (!init() || !TRACKS[name]) return;
      if (!enabled) { Music._wanted = name; return; }
      name = resolve(name);
      if (current === name) return;
      this.stop(0.4);
      current = name;
      gainNode = ctx.createGain(); gainNode.gain.value = 0.0001; gainNode.connect(musicBus);
      gainNode.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6);
      step = 0; nextTime = ctx.currentTime + 0.05;
      clearInterval(timerId); timerId = setInterval(tick, 40);
    },
    stop(fade = 0.5) {
      if (fade !== undefined && enabled) Music._wanted = null;
      if (!ctx) return;
      clearInterval(timerId); timerId = null;
      if (gainNode) { const g = gainNode; g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fade); setTimeout(() => g.disconnect(), fade * 1000 + 200); }
      gainNode = null; current = null;
    },
    duck(on) { if (musicBus && ctx) musicBus.gain.setTargetAtTime(on ? 0.1 : 0.32, ctx.currentTime, 0.2); },
    setEnabled(v) { enabled = v; if (!v) { const c = current; this.stop(); Music._wanted = c; } else if (Music._wanted) { const w = Music._wanted; Music._wanted = null; this.play(w); } },
    get enabled() { return enabled; },
    get current() { return current; },
  };

  // ---------- sound effects ----------
  const SFX = {
    pop(pitch = 0) { if (!running()) return; const t = ctx.currentTime; osc('triangle', midi(72 + pitch), t, 0.12, 0.3); osc('sine', midi(84 + pitch), t + 0.03, 0.1, 0.15); },
    join() { if (!running()) return; const t = ctx.currentTime; [72, 76, 79].forEach((n, i) => osc('triangle', midi(n), t + i * 0.06, 0.15, 0.25)); },
    tick() { if (!running()) return; osc('square', 1500, ctx.currentTime, 0.04, 0.06); },
    whoosh() { if (!running()) return; noise(ctx.currentTime, 0.45, 0.25, 'bandpass', 400, null, 4000); },
    slam() { if (!running()) return; const t = ctx.currentTime; osc('sine', 110, t, 0.6, 0.9, null, { slideTo: 35 }); noise(t, 0.3, 0.4, 'lowpass', 900); },
    ding(pitch = 0) { if (!running()) return; const t = ctx.currentTime; [0, 4, 7].forEach((n, i) => osc('triangle', midi(76 + pitch + n), t + i * 0.05, 0.35, 0.22)); },
    buzz() { if (!running()) return; const t = ctx.currentTime; osc('sawtooth', 110, t, 0.45, 0.25, null, { lp: 900 }); osc('sawtooth', 104, t, 0.45, 0.25, null, { lp: 900 }); },
    drumroll(dur = 1.2) { if (!running()) return; const t = ctx.currentTime; for (let i = 0; i < dur * 22; i++) noise(t + i / 22, 0.05, 0.06 + (i / (dur * 22)) * 0.18, 'bandpass', 2200); },
    reveal() { if (!running()) return; const t = ctx.currentTime; osc('sine', 60, t, 0.5, 0.6, null, { slideTo: 40 }); [64, 67, 71, 76].forEach((n, i) => osc('triangle', midi(n + 12), t + 0.05 + i * 0.07, 0.4, 0.18)); },
    lock() { if (!running()) return; const t = ctx.currentTime; osc('square', 300, t, 0.08, 0.2, null, { lp: 2000 }); noise(t, 0.12, 0.4, 'bandpass', 3000); osc('triangle', midi(88), t + 0.08, 0.5, 0.15); },
    claim(pitch = 0) { if (!running()) return; const t = ctx.currentTime; osc('sine', 90, t, 0.3, 0.6, null, { slideTo: 45 }); [0, 7, 12].forEach((n, i) => osc('square', midi(67 + pitch + n), t + i * 0.07, 0.18, 0.1, null, { lp: 3000 })); },
    steal() { if (!running()) return; const t = ctx.currentTime; noise(t, 0.35, 0.3, 'bandpass', 3000, null, 300); [79, 75, 72, 79].forEach((n, i) => osc('sawtooth', midi(n), t + 0.1 + i * 0.08, 0.16, 0.08, null, { lp: 2500 })); },
    // metal "clang" when a guess bounces off a defended square
    clang() { if (!running()) return; const t = ctx.currentTime; [523, 1187, 1663, 2490].forEach((f, i) => osc('triangle', f, t, 0.9 - i * 0.15, 0.18 / (i + 1))); noise(t, 0.08, 0.35, 'bandpass', 4500); osc('sine', 95, t, 0.25, 0.5, null, { slideTo: 60 }); },
    denied() { if (!running()) return; const t = ctx.currentTime; osc('square', midi(62), t, 0.14, 0.1, null, { lp: 1800 }); osc('square', midi(57), t + 0.16, 0.3, 0.1, null, { lp: 1800 }); },
    thud() { if (!running()) return; const t = ctx.currentTime; osc('sine', 140, t, 0.25, 0.6, null, { slideTo: 70 }); noise(t, 0.1, 0.25, 'lowpass', 600); },
    vote() { if (!running()) return; osc('triangle', midi(84), ctx.currentTime, 0.08, 0.2); },
    fanfare() { if (!running()) return; const t = ctx.currentTime; [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.52], [79, 0.64], [84, 0.8]].forEach(([n, d]) => { osc('square', midi(n), t + d, 0.3, 0.09, null, { lp: 3500 }); osc('triangle', midi(n - 12), t + d, 0.3, 0.2); }); kick(t + 0.8); },
    countUp() { if (!running()) return; osc('triangle', midi(91), ctx.currentTime, 0.03, 0.05); },
  };

  window.QPAudio = {
    init,
    unlock() { init(); return ctx ? ctx.resume() : Promise.resolve(); },
    get running() { return running(); },
    get state() { return ctx ? ctx.state : 'none'; },
    Music, SFX,
  };
})();
