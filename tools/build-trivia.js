#!/usr/bin/env node
// Builds tools/lists/trivia.json from per-subtopic source files:
//   node tools/build-trivia.js <folder with SLUG.json files>
// Each source file is an array of { q, a, w: [3 wrong], d: "easy"|"medium"|"hard", src }.
// The slug decides the category and subtopic (see MAP). Options are shuffled with a fixed seed.
const fs = require('fs');
const path = require('path');
const MAP = {
  'peru-football': ['peru', 'Football'], 'peru-politics': ['peru', 'Politics'], 'peru-food': ['peru', 'Food & cuisine'],
  'peru-geography': ['peru', 'Geography'], 'peru-music': ['peru', 'Music'], 'peru-celebrities': ['peru', 'Celebrities'], 'peru-history': ['peru', 'History'], 'peru-history-20c': ['peru', 'History'],
  'anime-death-note': ['anime', 'Death Note'], 'anime-fma': ['anime', 'Fullmetal Alchemist'], 'anime-db': ['anime', 'Dragon Ball'], 'anime-dbz': ['anime', 'Dragon Ball Z'], 'anime-dbgt': ['anime', 'Dragon Ball GT'], 'anime-dbs': ['anime', 'Dragon Ball Super'],
  'anime-jojo': ['anime', "JoJo's Bizarre Adventure"], 'anime-rezero': ['anime', 'Re:Zero'], 'anime-apothecary': ['anime', 'The Apothecary Diaries'], 'anime-mixed': ['anime', 'Mixed anime'], 'anime-aot': ['anime', 'Attack on Titan'],
  'games-oot': ['videojuegos', 'Zelda: Ocarina of Time'], 'games-wc3': ['videojuegos', 'Warcraft III'], 'games-wow-forever': ['videojuegos', 'WoW: Forever'],
  'games-nintendo': ['videojuegos', 'Nintendo'], 'games-starcraft': ['videojuegos', 'StarCraft'], 'games-dota': ['videojuegos', 'Dota 2'], 'games-general': ['videojuegos', 'General gaming'],
  'general-science': ['general', 'Science'], 'general-geography': ['general', 'World geography'], 'general-history': ['general', 'World history'],
};
const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-trivia.js <folder>'); process.exit(1); }
let seed = 20261109;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const out = [], seen = new Set(), report = [];
for (const [slug, [category, sub]] of Object.entries(MAP)) {
  const f = path.join(dir, slug + '.json');
  if (!fs.existsSync(f)) { report.push(`${slug}: missing`); continue; }
  let rows;
  try { rows = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { report.push(`${slug}: INVALID JSON (${e.message})`); continue; }
  let ok = 0, bad = 0;
  rows.forEach((r, i) => {
    const opts = [r.a, ...(r.w || [])].map(x => String(x || '').trim());
    const problem = !r.q || opts.length !== 4 || opts.some(o => !o) || new Set(opts.map(norm)).size !== 4 || seen.has(norm(r.q));
    if (problem) { bad++; return; }
    seen.add(norm(r.q));
    for (let k = 3; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]]; }
    out.push({ id: `tq-${slug}-${String(i + 1).padStart(3, '0')}`, category, sub: r.sub || sub, prompt: String(r.q).trim(), options: opts, correct: opts.indexOf(String(r.a).trim()), time: 25, ...(r.d ? { level: r.d } : {}), ...(r.src ? { source: r.src } : {}) });
    ok++;
  });
  report.push(`${slug}: ${ok}${bad ? ` (${bad} rejected)` : ''}`);
}
const file = path.join(__dirname, 'lists', 'trivia.json');
fs.writeFileSync(file, JSON.stringify({ _note: 'Research-verified trivia (ids tq-…), merged into data/quiz.json by tools/add-lists.js. Built by tools/build-trivia.js.', questions: out }, null, 1));
console.log(report.join('\n'));
console.log(`Total: ${out.length} questions -> ${file}`);
