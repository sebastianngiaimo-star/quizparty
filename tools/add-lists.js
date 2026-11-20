#!/usr/bin/env node
// Turns the factual ranked lists in tools/lists/ into HILO / SQUARES topics in data/quiz.json.
//   node tools/add-lists.js
// Re-running replaces the "list-…" topics, removes list topics that are no longer in index.json,
// and re-applies the titles in tools/lists/titles.json to every topic (including imported anime ones).
//
// To add a list: drop a JSON file in tools/lists/ ({ "rows": [{ "text", "count", "aliases" }] })
// and add an entry for it in tools/lists/index.json. Optional per-list flags in index.json:
//   partAliases: true   -> single name parts ("Roshi", "Ginyu") and reversed names become aliases when unambiguous
//                          ("text" = split only the display name, not the aliases/nicknames)
//   titleParts: true    -> the part after ":" / " - " becomes an alias ("Ocarina of Time"), years in (…) are dropped
//   aliasRules: "<file>" -> franchise-level variants (Japanese / Spanish / abbreviations) swapped into titles
//   names: "<file>"     -> { "<display name>": ["extra", "aliases"] }
const fs = require('fs');
const path = require('path');
const { normalize } = require('../lib/match');

const DIR = path.join(__dirname, 'lists');
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'quiz.json');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const titles = JSON.parse(fs.readFileSync(path.join(DIR, 'titles.json'), 'utf8'));
const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const readJSON = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const uniq = arr => [...new Set(arr.filter(Boolean).map(s => String(s).trim()).filter(Boolean))];

for (const c of index.categories) if (!db.categories.some(x => x.id === c.id)) db.categories.push(c);

// ---------- alias helpers ----------
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function applyRules(answers, rules) {
  const list = Object.entries(rules).filter(([k]) => !k.startsWith('_')).sort((a, b) => b[0].length - a[0].length);
  for (const a of answers) {
    const base = a.text.replace(/\s*\((19|20)\d\d\)\s*$/, '');
    for (const [key, variants] of list) {
      const re = new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(key) + '(?=$|[^\\p{L}\\p{N}])', 'iu');
      if (!re.test(base)) continue;
      for (const v of variants) {
        a.aliases.push(base.replace(re, (m, pre) => pre + v));
        if (base.toLowerCase() === key.toLowerCase()) a.aliases.push(v);
      }
    }
  }
}

function addTitleParts(answers) {
  const bases = {};
  for (const a of answers) { const k = normalize(a.text.replace(/\s*\((19|20)\d\d\)\s*$/, '')); bases[k] = (bases[k] || 0) + 1; }
  for (const a of answers) {
    const forms = [a.text, ...a.aliases];
    for (const t of forms) {
      const clean = String(t).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      a.aliases.push(clean);
      for (const part of clean.split(/\s*[:：]\s*|\s+-\s+/)) if (part.trim().length >= 3) a.aliases.push(part.trim());
    }
    // drop "(2019)" from the display name unless the year is what tells two versions apart (The Lion King 1994 / 2019)
    const base = a.text.replace(/\s*\((19|20)\d\d\)\s*$/, '').trim();
    if (bases[normalize(base)] === 1) a.text = base;
  }
}

function addPartAliases(answers, textOnly) {
  for (const a of answers) {
    const w = a.text.trim().split(/\s+/);
    if (w.length === 2) a.aliases.push(w[1] + ' ' + w[0]); // Japanese name order
  }
  const owners = new Map();
  answers.forEach((a, i) => {
    for (const form of textOnly ? [a.text] : [a.text, ...a.aliases]) {
      for (const part of String(form).split(/[\s\-·.()]+/)) {
        const k = part.toLowerCase();
        if (k.length < (/^[a-z0-9]+$/.test(k) ? 3 : 2) || ['the', 'and', 'with', 'king', 'great', 'super', 'mr', 'dr'].includes(k)) continue;
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k).add(i);
      }
    }
  });
  for (const [k, set] of owners) if (set.size === 1) answers[[...set][0]].aliases.push(k);
}

function applyNames(answers, names) {
  const byNorm = new Map(Object.entries(names).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [normalize(k), v]));
  for (const a of answers) {
    for (const f of [a.text, ...a.aliases]) {
      const extra = byNorm.get(normalize(f));
      if (extra) a.aliases.push(...extra);
    }
  }
}

// An alias that would match two different answers is dropped from all of them (so typing a
// franchise name never silently resolves to the top-ranked game); aliases equal to the row's own text are dropped too.
function dedupeAliases(answers) {
  const owner = new Map();
  answers.forEach((a, i) => owner.set(normalize(a.text), i));
  const claims = new Map(); // normalized alias -> set of row indexes using it
  answers.forEach((a, i) => {
    for (const al of uniq(a.aliases)) {
      const n = normalize(al);
      if (!n) continue;
      if (!claims.has(n)) claims.set(n, new Set());
      claims.get(n).add(i);
      if (owner.has(n) && owner.get(n) !== i) claims.get(n).add(owner.get(n));
    }
  });
  // Shared alias: dropped everywhere, unless one row is the base version of all the others
  // ("The Witcher 3: Wild Hunt" vs "… - Remastered") — then the base keeps it.
  const keepFor = new Map();
  const stem = i => normalize(answers[i].text.replace(/\s*\((19|20)\d\d\)\s*$/, ''));
  for (const [n, set] of claims) {
    if (set.size < 2) continue;
    const rows = [...set];
    let base = rows.find(r => rows.every(o => o === r || normalize(answers[o].text).startsWith(normalize(answers[r].text))));
    // Rows literally titled that way win over rows that only carry it as a part of a longer title
    // ("The Lion King (1994)" / "(2019)" vs "Mufasa: The Lion King"); among them the higher-ranked one gets it.
    if (base === undefined) {
      const titled = rows.filter(r => stem(r) === n);
      if (titled.length) base = Math.min(...titled);
    }
    keepFor.set(n, base);
  }
  let dropped = 0; // aliases removed because another answer also claims them
  answers.forEach((a, i) => {
    const self = normalize(a.text);
    const kept = [];
    const used = new Set();
    for (const al of uniq(a.aliases)) {
      const n = normalize(al);
      if (!n || n === self || used.has(n)) continue; // empty, same as the answer itself, or a spelling variant already kept
      if (keepFor.has(n) && keepFor.get(n) !== i) { dropped++; continue; }
      used.add(n);
      kept.push(al);
    }
    a.aliases = kept;
  });
  return dropped;
}

// ---------- build ----------
const keep = new Set(index.lists.map(l => l.id));
const before = db.surveys.length;
db.surveys = db.surveys.filter(s => !s.id.startsWith('list-') || keep.has(s.id));
if (before !== db.surveys.length) console.log(`• Removed ${before - db.surveys.length} retired topics`);

for (const l of index.lists) {
  const src = readJSON(l.file);
  const answers = src.rows.map(r => ({ text: String(r.text).trim(), count: r.count, aliases: uniq(r.aliases || []) }));
  if (l.aliasRules) applyRules(answers, readJSON(l.aliasRules));
  if (l.titleParts) addTitleParts(answers);
  if (l.names) applyNames(answers, readJSON(l.names));
  if (l.partAliases) addPartAliases(answers, l.partAliases === 'text');
  const dropped = dedupeAliases(answers);
  const survey = {
    id: l.id, category: l.category, prompt: l.prompt || '',
    source: l.sourceShort || src.source, unit: l.unit,
    answers: answers.map(a => ({ text: a.text, count: a.count, ...(a.aliases.length ? { aliases: a.aliases } : {}) })),
  };
  const i = db.surveys.findIndex(x => x.id === l.id);
  if (i >= 0) db.surveys[i] = survey; else db.surveys.push(survey);
  console.log(`• ${l.id}: ${answers.length} answers${dropped ? ` (${dropped} ambiguous aliases dropped)` : ''}`);
}

// Built-in trivia questions (ids "tq-…"): replaced on every run; questions you made in the editor are kept.
const triviaFile = path.join(DIR, 'trivia.json');
if (fs.existsSync(triviaFile)) {
  const tq = JSON.parse(fs.readFileSync(triviaFile, 'utf8')).questions || [];
  // the 10 easy demo questions that shipped with the app (t1–t10) are retired too, if still unedited
  const DEMO = ["Which country's flag is this?", 'Which song is this melody?', 'How many sides does a hexagon have?', 'What is the longest river in South America?', 'Which planet is known as the Red Planet?', 'How many strings does a classical guitar have?', 'In which country is Machu Picchu?', 'What is the largest ocean in the world?', 'Which instrument has 88 keys?', 'Botanically, a tomato is a…'];
  db.trivia = (db.trivia || []).filter(q => !String(q.id).startsWith('tq-') && !(/^t\d+$/.test(q.id) && DEMO.includes(q.prompt))).concat(tq);
  console.log(`• Trivia: ${tq.length} built-in questions (${db.trivia.length} total)`);
}

// Topic titles / subtitles / HI-LO wording for every known topic (lists and imported anime topics alike).
let n = 0;
for (const s of db.surveys) {
  const t = titles[s.id];
  if (!t) continue;
  Object.assign(s, { title: t.title, prompt: t.prompt, hiText: t.hiText, loText: t.loText });
  if (t.series) { s.sub = t.series; delete s.series; } // sub-topic picker grouping
  n++;
}
console.log(`• Titles applied to ${n} topics`);
fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
console.log('Saved. Restart the server to load the new topics.');
