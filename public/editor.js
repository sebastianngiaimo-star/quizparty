/* QuizParty — question editor */
(() => {
  const main = document.getElementById('main');
  const saveBtn = document.getElementById('save');
  let D = null; // data
  let tab = 'trivia';
  let sel = { trivia: null, surveys: null };
  let filter = '';
  let dirty = false;
  let pw = '';
  try { pw = sessionStorage.getItem('qp_pw') || ''; } catch (e) {}

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + Math.random().toString(36).slice(2, 9);
  const api = (url, opt = {}) => fetch(url, { ...opt, headers: { ...(opt.headers || {}), 'x-admin-password': pw } });

  function markDirty() { dirty = true; saveBtn.classList.add('dirty'); saveBtn.textContent = 'Save*'; }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  async function load() {
    const cfg = await fetch('/api/config').then(r => r.json());
    const r = await api('/api/data');
    if (r.status === 401) return login(cfg);
    D = await r.json();
    D.settings = D.settings || {};
    renderTabs();
    render();
  }

  function login() {
    main.innerHTML = `<div class="card" id="login"><h3>Editor password</h3><input type="password" id="pw"><div style="margin-top:10px"><button class="btn primary" id="go">Enter</button></div></div>`;
    const go = () => { pw = document.getElementById('pw').value; try { sessionStorage.setItem('qp_pw', pw); } catch (e) {} load(); };
    document.getElementById('go').onclick = go;
    document.getElementById('pw').onkeydown = e => e.key === 'Enter' && go();
  }

  saveBtn.onclick = async () => {
    const r = await api('/api/data', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(D) });
    if (r.ok) { dirty = false; saveBtn.classList.remove('dirty'); saveBtn.textContent = 'Saved ✓'; setTimeout(() => (saveBtn.textContent = 'Save'), 1500); }
    else alert('Save failed (' + r.status + ')');
  };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveBtn.click(); } });

  function renderTabs() {
    const tabs = [['trivia', 'Trivia'], ['surveys', 'Surveys (HILO / SQUARES)'], ['categories', 'Categories'], ['settings', 'Settings'], ['io', 'Import / Export']];
    document.getElementById('tabs').innerHTML = tabs.map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('');
    document.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => { tab = b.dataset.tab; renderTabs(); render(); }));
  }

  const catOptions = (cur, withAll) => (withAll ? `<option value="">All categories</option>` : '') + D.categories.map(c => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('');
  const catName = id => { const c = D.categories.find(x => x.id === id); return c ? `${c.icon || ''} ${c.name}` : '(no category)'; };

  function render() {
    if (tab === 'trivia') renderTrivia();
    else if (tab === 'surveys') renderSurveys();
    else if (tab === 'categories') renderCategories();
    else if (tab === 'settings') renderSettings();
    else renderIO();
  }

  // ======================= TRIVIA =======================
  function renderTrivia() {
    const list = D.trivia.filter(q => !filter || q.category === filter);
    main.innerHTML = `<div class="layout">
      <div class="card"><div class="row"><select id="flt">${catOptions(filter, true)}</select><button class="btn primary" id="add" style="flex:none">+ New</button></div>
        <div class="list">${list.map(q => `<div class="item ${sel.trivia === q.id ? 'on' : ''}" data-id="${q.id}">
          <span>${q.media && q.media.type === 'image' ? '🖼️' : q.media && q.media.type === 'audio' ? '🎵' : q.media && q.media.type === 'video' ? '🎬' : '📝'}</span>
          <span style="flex:1">${esc(q.prompt || '(empty)')}</span><span class="tag">${esc(catName(q.category))}</span></div>`).join('') || '<div class="empty">No questions</div>'}</div></div>
      <div class="card" id="ed"></div></div>`;
    document.getElementById('flt').onchange = e => { filter = e.target.value; renderTrivia(); };
    document.getElementById('add').onclick = () => {
      const q = { id: uid('t'), category: filter || (D.categories[0] || {}).id || '', prompt: '', options: ['', '', '', ''], correct: 0 };
      D.trivia.unshift(q); sel.trivia = q.id; markDirty(); renderTrivia();
    };
    main.querySelectorAll('.item').forEach(el => (el.onclick = () => { sel.trivia = el.dataset.id; renderTrivia(); }));
    triviaForm();
  }

  function triviaForm() {
    const ed = document.getElementById('ed');
    const q = D.trivia.find(x => x.id === sel.trivia);
    if (!q) { ed.innerHTML = '<div class="empty">Select a question or create a new one</div>'; return; }
    const m = q.media || { type: 'none' };
    ed.innerHTML = `
      <div class="row"><div><label>Category</label><select id="cat">${catOptions(q.category)}</select></div>
        <div><label>Subtopic (optional)</label><input type="text" id="series" list="seriesList" value="${esc(q.sub || q.series || '')}" placeholder="e.g. Zelda, Football, Death Note"><datalist id="seriesList">${[...new Set([...D.trivia, ...D.surveys].map(x => x.sub || x.series).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div style="flex:none;width:120px"><label>Time (sec)</label><input type="number" id="time" min="5" max="120" value="${q.time || ''}" placeholder="${D.settings.classicTime || 20}"></div></div>
      <label>Question</label><input type="text" id="prompt" value="${esc(q.prompt)}">
      <label>Media</label>
      <div class="row"><select id="mtype" style="flex:none;width:140px">${['none', 'image', 'audio', 'video'].map(t => `<option ${m.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="text" id="msrc" placeholder="URL or upload a file →" value="${esc(m.src || '')}" ${m.type === 'none' ? 'disabled' : ''}>
        <input type="file" id="mfile" style="flex:none;width:210px" ${m.type === 'none' ? 'disabled' : ''} accept="image/*,audio/*,video/*"></div>
      ${m.type === 'audio' || m.type === 'video' ? `<div class="row"><div><label>Start at (sec)</label><input type="number" id="mstart" min="0" step="0.5" value="${m.start || ''}"></div><div><label>Stop at (sec, optional)</label><input type="number" id="mend" min="0" step="0.5" value="${m.end || ''}"></div></div>
        <div class="hint">Tip: for "name that tune", upload the full song and set the start/stop to play just a clip.</div>` : ''}
      <div class="preview" id="prev">${mediaPreview(m)}</div>
      <label>Answer options — select the correct one</label>
      <div id="opts">${q.options.map((o, i) => `<div class="opt-row"><input type="radio" name="corr" value="${i}" ${Number(q.correct) === i ? 'checked' : ''}><input type="text" data-opt="${i}" value="${esc(o)}"><button class="btn sm" data-del="${i}" ${q.options.length <= 2 ? 'disabled' : ''}>✕</button></div>`).join('')}</div>
      <button class="btn sm" id="addopt" ${q.options.length >= 6 ? 'disabled' : ''}>+ Option</button>
      <div style="margin-top:20px" class="row"><button class="btn danger" id="del" style="flex:none">Delete question</button><button class="btn" id="dup" style="flex:none">Duplicate</button></div>`;
    const $ = id => document.getElementById(id);
    $('cat').onchange = e => { q.category = e.target.value; markDirty(); };
    $('series').oninput = e => { const v = e.target.value.trim(); delete q.series; if (v) q.sub = v; else delete q.sub; markDirty(); };
    $('time').oninput = e => { q.time = Number(e.target.value) || undefined; markDirty(); };
    $('prompt').oninput = e => { q.prompt = e.target.value; markDirty(); const it = main.querySelector(`.item[data-id="${q.id}"] span:nth-child(2)`); if (it) it.textContent = q.prompt; };
    $('mtype').onchange = e => { const t = e.target.value; q.media = t === 'none' ? undefined : { ...(q.media || {}), type: t }; markDirty(); triviaForm(); };
    $('msrc').oninput = e => { q.media.src = e.target.value.trim(); markDirty(); $('prev').innerHTML = mediaPreview(q.media); };
    $('mfile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('prev').innerHTML = 'Uploading…';
      const src = await upload(f);
      if (src) { q.media.src = src; markDirty(); triviaForm(); } else $('prev').innerHTML = '<span class="bad">Upload failed</span>';
    };
    if ($('mstart')) $('mstart').oninput = e => { q.media.start = Number(e.target.value) || 0; markDirty(); };
    if ($('mend')) $('mend').oninput = e => { q.media.end = Number(e.target.value) || 0; markDirty(); };
    ed.querySelectorAll('[name=corr]').forEach(r => (r.onchange = () => { q.correct = Number(r.value); markDirty(); }));
    ed.querySelectorAll('[data-opt]').forEach(inp => (inp.oninput = () => { q.options[Number(inp.dataset.opt)] = inp.value; markDirty(); }));
    ed.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => {
      const i = Number(b.dataset.del); q.options.splice(i, 1);
      if (q.correct >= q.options.length || q.correct === i) q.correct = 0; else if (q.correct > i) q.correct--;
      markDirty(); triviaForm();
    }));
    $('addopt').onclick = () => { q.options.push(''); markDirty(); triviaForm(); };
    $('del').onclick = () => { if (!confirm('Delete this question?')) return; D.trivia = D.trivia.filter(x => x !== q); sel.trivia = null; markDirty(); renderTrivia(); };
    $('dup').onclick = () => { const c = JSON.parse(JSON.stringify(q)); c.id = uid('t'); D.trivia.splice(D.trivia.indexOf(q) + 1, 0, c); sel.trivia = c.id; markDirty(); renderTrivia(); };
  }

  function mediaPreview(m) {
    if (!m || !m.src) return '';
    if (m.type === 'image') return `<img src="${esc(m.src)}">`;
    if (m.type === 'audio') return `<audio src="${esc(m.src)}" controls style="width:100%;margin-top:8px"></audio>`;
    if (m.type === 'video') return `<video src="${esc(m.src)}" controls></video>`;
    return '';
  }

  async function upload(file) {
    const fd = new FormData(); fd.append('file', file);
    const r = await api('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) return null;
    return (await r.json()).src;
  }

  // ======================= SURVEYS =======================
  function ranked(s) {
    return (s.answers || []).map((a, i) => ({ ...a, i })).filter(a => (a.text || '').trim()).sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0) || a.i - b.i);
  }

  function renderSurveys() {
    const list = D.surveys.filter(q => !filter || q.category === filter);
    main.innerHTML = `<div class="layout">
      <div class="card"><div class="row"><select id="flt">${catOptions(filter, true)}</select><button class="btn primary" id="add" style="flex:none">+ New</button></div>
        <div class="list">${list.map(s => { const n = ranked(s).length; return `<div class="item ${sel.surveys === s.id ? 'on' : ''}" data-id="${s.id}">
          <span style="flex:1">${esc(s.title || s.prompt || '(empty)')}</span><span class="tag">${n} ans</span>${n < 9 ? '<span class="warn" title="SQUARES needs 9+ answers">⚠</span>' : ''}</div>`; }).join('') || '<div class="empty">No surveys</div>'}</div></div>
      <div class="card" id="ed"></div></div>`;
    document.getElementById('flt').onchange = e => { filter = e.target.value; renderSurveys(); };
    document.getElementById('add').onclick = () => {
      const s = { id: uid('s'), category: filter || (D.categories[0] || {}).id || '', title: '', prompt: '', source: '', answers: [] };
      D.surveys.unshift(s); sel.surveys = s.id; markDirty(); renderSurveys();
    };
    main.querySelectorAll('.item').forEach(el => (el.onclick = () => { sel.surveys = el.dataset.id; renderSurveys(); }));
    surveyForm();
  }

  function surveyForm() {
    const ed = document.getElementById('ed');
    const s = D.surveys.find(x => x.id === sel.surveys);
    if (!s) { ed.innerHTML = '<div class="empty">Select a survey or create a new one</div>'; return; }
    s.answers = s.answers || [];
    const total = s.answers.reduce((t, a) => t + (Number(a.count) || 0), 0) || 1;
    ed.innerHTML = `
      <div class="row"><div><label>Category</label><select id="cat">${catOptions(s.category)}</select></div><div><label>Subtopic (optional)</label><input type="text" id="series" list="seriesList" value="${esc(s.sub || s.series || '')}" placeholder="e.g. Zelda, Football, Death Note"><datalist id="seriesList">${[...new Set([...D.trivia, ...D.surveys].map(x => x.sub || x.series).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div></div>
      <label>Topic title (big on the TV, e.g. "Countries of the World")</label><input type="text" id="title" value="${esc(s.title || '')}" placeholder="e.g. The Fastest Animals">
      <label>Subtitle / question (what is ranked, e.g. "Ranked by population")</label><input type="text" id="prompt" value="${esc(s.prompt)}" placeholder="e.g. Ranked by top speed (km/h)">
      <label>Source (shown small on the TV)</label><input type="text" id="source" value="${esc(s.source || '')}" placeholder="e.g. YouGov 2024, 1,000 adults">
      <div class="row"><div><label>Unit shown next to each value (km/h, %, kg…). Start with "$" for money ($ → $2.92B, $B → $839B, $/year → $395,870/year). Leave empty for opinion surveys; write "rank" for ranking-only lists.</label><input type="text" id="unit" value="${esc(s.unit || '')}"></div></div>
      <div class="row"><div><label>HI round text (optional)</label><input type="text" id="hiText" value="${esc(s.hiText || '')}" placeholder="Name a SUPER fast animal"></div>
        <div><label>LO round text (optional)</label><input type="text" id="loText" value="${esc(s.loText || '')}" placeholder="Name the SLOWEST animal on the list"></div></div>
      <label>Answers — count can be a number of people, a percentage or any value (km/h, USD…). Aliases = other spellings / languages that should count (comma-separated).</label>
      <table><thead><tr><th>#</th><th>Answer</th><th style="width:90px">Count / %</th><th>Aliases</th><th style="width:60px">%</th><th></th></tr></thead>
      <tbody>${s.answers.map((a, i) => `<tr>
        <td class="hint">${i + 1}</td>
        <td><input type="text" data-f="text" data-i="${i}" value="${esc(a.text)}"></td>
        <td><input type="number" data-f="count" data-i="${i}" value="${a.count ?? ''}" step="any"></td>
        <td><input type="text" data-f="aliases" data-i="${i}" value="${esc((a.aliases || []).join(', '))}"></td>
        <td class="hint">${Math.round((1000 * (Number(a.count) || 0)) / total) / 10}</td>
        <td><button class="btn sm" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="addrow" style="flex:none">+ Answer</button><button class="btn sm" id="sort" style="flex:none">Sort by count</button><span class="hint">${s.answers.length} answers ${s.answers.length < 9 ? '— <span class="bad">SQUARES needs at least 9</span>' : ''}</span></div>
      <label>Bulk paste — one answer per line: <code>answer ; count ; alias1, alias2</code> (tab-separated from a spreadsheet works too)</label>
      <textarea id="bulk" placeholder="Coffee ; 38 ; espresso, latte&#10;Juice ; 21&#10;Tea ; 12"></textarea>
      <div class="row"><button class="btn sm" id="bulkAdd" style="flex:none">Add to list</button><button class="btn sm" id="bulkReplace" style="flex:none">Replace list</button></div>
      <label>Test the matching — type what a player might write</label>
      <div class="row"><input type="text" id="test" placeholder="e.g. kakaroto, 悟空, Freezer"><span id="testRes" class="hint"></span></div>
      <label>SQUARES board preview (most popular → least, left to right, top to bottom)</label>
      <div class="bands">${bandsPreview(s)}</div>
      <div style="margin-top:20px" class="row"><button class="btn danger" id="del" style="flex:none">Delete survey</button></div>`;
    const $ = id => document.getElementById(id);
    $('cat').onchange = e => { s.category = e.target.value; markDirty(); };
    $('series').oninput = e => { const v = e.target.value.trim(); delete s.series; if (v) s.sub = v; else delete s.sub; markDirty(); };
    $('prompt').oninput = e => { s.prompt = e.target.value; markDirty(); };
    $('title').oninput = e => { s.title = e.target.value; markDirty(); };
    $('source').oninput = e => { s.source = e.target.value; markDirty(); };
    ['unit', 'hiText', 'loText'].forEach(k => ($(k).oninput = e => { s[k] = e.target.value; markDirty(); }));
    ed.querySelectorAll('[data-f]').forEach(inp => (inp.oninput = () => {
      const a = s.answers[Number(inp.dataset.i)];
      const f = inp.dataset.f;
      if (f === 'count') a.count = inp.value === '' ? 0 : Number(inp.value);
      else if (f === 'aliases') a.aliases = inp.value.split(',').map(x => x.trim()).filter(Boolean);
      else a.text = inp.value;
      markDirty();
    }));
    ed.querySelectorAll('[data-f=count]').forEach(inp => (inp.onchange = () => surveyForm()));
    ed.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => { s.answers.splice(Number(b.dataset.del), 1); markDirty(); surveyForm(); }));
    $('addrow').onclick = () => { s.answers.push({ text: '', count: 0 }); markDirty(); surveyForm(); const ins = ed.querySelectorAll('[data-f=text]'); ins[ins.length - 1].focus(); };
    $('sort').onclick = () => { s.answers.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0)); markDirty(); surveyForm(); };
    $('bulkAdd').onclick = () => { s.answers.push(...parseBulk($('bulk').value)); markDirty(); surveyForm(); };
    $('bulkReplace').onclick = () => { if (!confirm('Replace all answers?')) return; s.answers = parseBulk($('bulk').value); markDirty(); surveyForm(); };
    let tt;
    $('test').oninput = e => {
      clearTimeout(tt);
      tt = setTimeout(async () => {
        const v = e.target.value.trim();
        if (!v) return ($('testRes').textContent = '');
        const r = await api('/api/test-match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: v, answers: s.answers }) }).then(r => r.json());
        $('testRes').innerHTML = r.match ? `<span class="ok">✓ matches “${esc(r.match)}” (#${r.pos} on the board${r.dist ? ', fuzzy' : ''})</span>` : '<span class="bad">✗ not on the list</span>';
      }, 250);
    };
    $('del').onclick = () => { if (!confirm('Delete this survey?')) return; D.surveys = D.surveys.filter(x => x !== s); sel.surveys = null; markDirty(); renderSurveys(); };
  }

  function bandsPreview(s) {
    const r = ranked(s);
    const n = r.length;
    if (n < 9) return '<div>Needs 9+ answers</div>';
    let out = '';
    for (let k = 0; k < 9; k++) {
      const from = Math.floor((k * n) / 9), to = Math.floor(((k + 1) * n) / 9) - 1;
      out += `<div><b>#${from + 1}${to > from ? '–' + (to + 1) : ''}</b>${r.slice(from, to + 1).map(a => esc(a.text)).join(', ')}</div>`;
    }
    return out;
  }

  function parseBulk(txt) {
    const out = [];
    for (let line of txt.split(/\r?\n/)) {
      line = line.trim();
      if (!line) continue;
      let parts;
      if (line.includes('\t')) parts = line.split('\t');
      else if (line.includes(';')) parts = line.split(';');
      else {
        const m = line.match(/^(.*?)[,\s]+(-?[\d.]+)\s*%?$/);
        parts = m ? [m[1], m[2]] : [line];
      }
      const text = (parts[0] || '').trim().replace(/^"|"$/g, '');
      if (!text) continue;
      const count = parseFloat(String(parts[1] || '0').replace('%', '').replace(',', '.')) || 0;
      const aliases = (parts[2] || '').split(',').map(x => x.trim()).filter(Boolean);
      out.push(aliases.length ? { text, count, aliases } : { text, count });
    }
    return out;
  }

  // ======================= CATEGORIES =======================
  function renderCategories() {
    main.innerHTML = `<div class="card" style="max-width:760px">
      <table><thead><tr><th style="width:70px">Icon</th><th>Name</th><th style="width:80px">Color</th><th style="width:140px">ID</th><th>Used by</th><th></th></tr></thead>
      <tbody>${D.categories.map((c, i) => {
        const used = D.trivia.filter(q => q.category === c.id).length + D.surveys.filter(q => q.category === c.id).length;
        return `<tr><td><input type="text" data-c="icon" data-i="${i}" value="${esc(c.icon || '')}"></td>
          <td><input type="text" data-c="name" data-i="${i}" value="${esc(c.name)}"></td>
          <td><input type="color" data-c="color" data-i="${i}" value="${esc(c.color || '#7c5cff')}"></td>
          <td class="hint">${esc(c.id)}</td><td class="hint">${used} items</td>
          <td><button class="btn sm" data-del="${i}" ${used ? 'disabled title="Move its questions first"' : ''}>✕</button></td></tr>`;
      }).join('')}</tbody></table>
      <button class="btn sm" id="addc" style="margin-top:10px">+ Category</button></div>`;
    main.querySelectorAll('[data-c]').forEach(inp => (inp.oninput = () => { D.categories[Number(inp.dataset.i)][inp.dataset.c] = inp.value; markDirty(); }));
    main.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => { D.categories.splice(Number(b.dataset.del), 1); markDirty(); renderCategories(); }));
    document.getElementById('addc').onclick = () => { D.categories.push({ id: uid('c'), name: 'New category', icon: '⭐', color: '#7c5cff' }); markDirty(); renderCategories(); };
  }

  // ======================= SETTINGS =======================
  function renderSettings() {
    const st = D.settings;
    main.innerHTML = `<div class="card" style="max-width:560px">
      <label>Title shown on the TV</label><input type="text" id="title" value="${esc(st.title || '')}">
      <label>Language (TV + phones)</label><select id="lang"><option value="en" ${st.lang !== 'es' ? 'selected' : ''}>English</option><option value="es" ${st.lang === 'es' ? 'selected' : ''}>Español</option></select>
      <div class="row"><div><label>Trivia time (sec)</label><input type="number" id="classicTime" value="${st.classicTime || 20}"></div>
      <div><label>HILO time (sec)</label><input type="number" id="hiloTime" value="${st.hiloTime || 35}"></div>
      <div><label>SQUARES turn (sec)</label><input type="number" id="squaresTime" value="${st.squaresTime || 30}"></div></div>
      <p class="hint">Changes apply to new games after you press Save. Phones and TV pick up the language on their next refresh.</p></div>`;
    ['title', 'lang'].forEach(k => (document.getElementById(k).oninput = e => { st[k] = e.target.value; markDirty(); }));
    ['classicTime', 'hiloTime', 'squaresTime'].forEach(k => (document.getElementById(k).oninput = e => { st[k] = Number(e.target.value) || undefined; markDirty(); }));
  }

  // ======================= IMPORT / EXPORT =======================
  function renderIO() {
    main.innerHTML = `<div class="card" style="max-width:680px">
      <h3>Export</h3><p class="hint">Downloads all categories, questions, surveys and settings as a JSON backup. (Uploaded media files stay on the server.)</p>
      <button class="btn primary" id="exp">Download backup</button>
      <h3 style="margin-top:28px">Import</h3><p class="hint">Load a backup file. This replaces everything in the editor — press Save afterwards to keep it.</p>
      <input type="file" id="imp" accept=".json,application/json"></div>`;
    document.getElementById('exp').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' }));
      a.download = 'quizparty-backup.json';
      a.click();
    };
    document.getElementById('imp').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (!Array.isArray(d.trivia) || !Array.isArray(d.surveys) || !Array.isArray(d.categories)) throw new Error('Missing trivia/surveys/categories');
        D = { settings: d.settings || {}, categories: d.categories, trivia: d.trivia, surveys: d.surveys };
        markDirty(); alert('Imported — press Save to keep it.');
      } catch (err) { alert('Invalid file: ' + err.message); }
    };
  }

  load();
})();
