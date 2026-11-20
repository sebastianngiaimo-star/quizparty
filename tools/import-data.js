#!/usr/bin/env node
/*
 * Pulls popularity data from free public APIs and turns it into survey questions
 * for HILO / SQUARES, merged into data/quiz.json.
 *
 *   node tools/import-data.js            # run every job in tools/sources.json
 *   node tools/import-data.js dragonball # only jobs whose id contains "dragonball"
 *   node tools/import-data.js --dry      # print what would be imported, don't write
 *
 * Sources:
 *   - AniList (https://anilist.co) — anime popularity + character favourites. Public GraphQL API, no key.
 *   - MyAnimeList via Jikan (https://jikan.moe) — top characters / anime / manga. Public REST API, no key.
 *   - OpenDota (https://www.opendota.com) — Dota 2 hero pick counts. Public REST API, no key.
 * Edit tools/sources.json to add franchises / questions. Re-running replaces the auto-imported
 * surveys (ids starting with "auto-") and leaves your own questions alone.
 */
const fs = require('fs');
const path = require('path');
const { normalize } = require('../lib/match');
// Prefer IPv4: on many Linux setups Node's fetch fails ("fetch failed") when IPv6 is broken.
require('dns').setDefaultResultOrder('ipv4first');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'quiz.json');
const SOURCES = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const TITLES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'lists', 'titles.json'), 'utf8')); } catch (e) { return {}; } })();
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const only = args.filter(a => !a.startsWith('--'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const YEAR = new Date().getFullYear();

// ---------------------------------------------------------------- AniList
let lastCall = 0;
async function anilist(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = 2200 - (Date.now() - lastCall); // stay under the public rate limit
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429) {
      const s = Number(r.headers.get('retry-after')) || 60;
      console.log(`   rate limited, waiting ${s}s…`);
      await sleep(s * 1000);
      continue;
    }
    const j = await r.json();
    if (j.errors) throw new Error('AniList: ' + j.errors.map(e => e.message).join('; '));
    return j.data;
  }
  throw new Error('AniList: too many retries');
}

const NAME = 'name { full native alternative userPreferred }';

async function franchiseCharacters(job) {
  const q = `query ($search: String, $page: Int) {
    Page(page: $page, perPage: 15) {
      pageInfo { hasNextPage }
      media(search: $search, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        id title { romaji english native } synonyms
        characters(perPage: 25, sort: FAVOURITES_DESC) { nodes { id favourites ${NAME} } }
      }
    }
  }`;
  const match = new RegExp(job.match || job.search, 'i');
  const chars = new Map();
  for (let page = 1; page <= (job.pages || 2); page++) {
    const d = await anilist(q, { search: job.search, page });
    for (const m of d.Page.media) {
      const titles = [m.title.romaji, m.title.english, ...(m.synonyms || [])].filter(Boolean).join(' | ');
      if (!match.test(titles)) continue;
      for (const c of m.characters.nodes) chars.set(c.id, c);
    }
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return [...chars.values()].map(c => ({ text: displayName(c), count: c.favourites, aliases: nameAliases(c) }));
}

async function franchiseTitles(job) {
  const q = `query ($search: String, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $search, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id popularity format title { romaji english native } synonyms }
    }
  }`;
  const match = new RegExp(job.match || job.search, 'i');
  const out = [];
  for (let page = 1; page <= (job.pages || 2); page++) {
    const d = await anilist(q, { search: job.search, page });
    for (const m of d.Page.media) {
      const titles = [m.title.romaji, m.title.english, ...(m.synonyms || [])].filter(Boolean);
      if (!titles.some(t => match.test(t))) continue;
      const main = m.title.english || m.title.romaji;
      out.push({ text: main, count: m.popularity, aliases: [...titles, m.title.native].filter(t => t && t !== main && usable(t)) });
    }
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return out;
}

// job.gender: "Female" / "Male" keeps only characters AniList tags with that gender (used for the waifu list).
async function topCharacters(job) {
  const q = `query ($page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } characters(sort: FAVOURITES_DESC) { id favourites gender ${NAME} } } }`;
  const out = [];
  const limit = job.limit || 40;
  for (let page = 1; out.length < limit && page <= 25; page++) {
    const d = await anilist(q, { page });
    for (const c of d.Page.characters) {
      if (job.gender && !(c.gender || '').toLowerCase().startsWith(job.gender.toLowerCase())) continue;
      out.push(c);
    }
    process.stdout.write('.');
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return out.map(c => ({ text: displayName(c), count: c.favourites, aliases: nameAliases(c) }));
}

async function topManga(job) {
  const q = `query ($page: Int) { Page(page: $page, perPage: 50) {
    media(type: MANGA, sort: POPULARITY_DESC, isAdult: false, format_in: [MANGA, ONE_SHOT]) { id popularity title { romaji english native } synonyms }
  } }`;
  const out = [];
  for (let page = 1; page <= Math.ceil((job.limit || 40) / 50); page++) {
    const d = await anilist(q, { page });
    for (const m of d.Page.media) {
      const main = m.title.english || m.title.romaji;
      out.push({ text: main, count: m.popularity, aliases: [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms || [])].filter(t => t && t !== main && usable(t)) });
    }
  }
  return out;
}

async function topAnime(job) {
  const q = `query ($page: Int) { Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, format_in: [TV, TV_SHORT, ONA]) {
      id popularity title { romaji english native } synonyms relations { edges { relationType } }
    } } }`;
  const out = [];
  const pages = job.pages || Math.ceil(((job.limit || 40) * 1.6) / 50);
  for (let page = 1; page <= pages; page++) {
    const d = await anilist(q, { page });
    for (const m of d.Page.media) {
      // skip sequels (anything that has a prequel), so each show appears once
      if (m.relations.edges.some(e => e.relationType === 'PREQUEL')) continue;
      const main = m.title.english || m.title.romaji;
      out.push({ text: main, count: m.popularity, aliases: [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms || [])].filter(t => t && t !== main && usable(t)) });
    }
  }
  return out;
}

// "Kyoujurou Rengoku" -> "Kyojuro Rengoku", "Gokuu Son" -> "Goku Son" (how fans actually write them)
function displayName(c) {
  const n = c.name.userPreferred || c.name.full || '';
  // only touch words that look like Japanese romaji (no l/v/q/x, no c except "ch") — leaves "Lelouch" alone
  return n.split(' ').map(w => (/[lvqx]|c(?!h)/i.test(w) ? w : w.replace(/ou(?=[^aeiou]|$)/gi, 'o').replace(/uu/gi, 'u'))).join(' ');
}

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/[^a-z0-9]/g, '');

// sources.json "names": { "<any name AniList uses>": { "show": "<name to display>", "also": ["extra", "aliases"] } }
// Used for Latin-American dub names (Kuririn -> Krilin, Frieza -> Freezer, Chi-Chi -> Milk…).
function applyNames(answers, job) {
  const table = Object.entries(job.names || {}).map(([k, v]) => [norm(k), v]);
  for (const a of answers) {
    const keys = new Set([a.text, ...a.aliases].map(norm));
    for (const [k, v] of table) {
      if (!keys.has(k)) continue;
      if (v.show && v.show !== a.text) { a.aliases.push(a.text); a.text = v.show; }
      a.aliases.push(...(v.also || []));
    }
  }
}

function nameAliases(c) {
  const set = new Set([c.name.full, ...(c.name.alternative || [])].filter(Boolean));
  for (const s of [...set]) {
    // Japanese romanization variants: Gojou -> Gojo, Kyoujurou -> Kyojuro
    const v = s.replace(/ou/gi, 'o').replace(/uu/gi, 'u').replace(/oo/gi, 'o');
    if (v !== s) set.add(v);
    // "Satoru Gojo" -> "Gojo Satoru" (Japanese name order)
    const w = s.trim().split(/\s+/);
    if (w.length === 2) set.add(w[1] + ' ' + w[0]);
  }
  if (c.name.native) set.add(c.name.native);               // 五条 悟
  return [...set].filter(usable);
}

// Latin-script or Japanese text is kept as an alias; other scripts (Chinese, Korean, Thai…) are dropped to keep lists tidy.
const usable = t => t && (/^[\x00-\u024f\s’'·:;!?.,&()\/-]+$/.test(t) || /[\u3040-\u30ff\u4e00-\u9fff]/.test(t));

// Add each single name part ("Gojo", "Tanjiro") as an alias when no other answer uses it.
function addNamePartAliases(answers) {
  const owners = new Map();
  answers.forEach((a, i) => {
    for (const form of [a.text, ...a.aliases]) {
      for (const part of String(form).split(/[\s\-·.]+/)) {
        const k = part.toLowerCase();
        if (k.length < (/^[a-z0-9]+$/.test(k) ? 3 : 2)) continue; // "五条" is a fine 2-char part, "Go" is not
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k).add(i);
      }
    }
  });
  answers.forEach((a, i) => {
    for (const [part, who] of owners) if (who.size === 1 && who.has(i)) a.aliases.push(part);
  });
}

// ---------------------------------------------------------------- MyAnimeList (Jikan)
let lastJikan = 0;
async function jikan(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = 1100 - (Date.now() - lastJikan); // Jikan allows ~3 req/s, 60/min
    if (wait > 0) await sleep(wait);
    lastJikan = Date.now();
    const r = await fetch('https://api.jikan.moe/v4' + url);
    if (r.status === 429 || r.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error('Jikan ' + r.status + ' ' + url);
    return r.json();
  }
  throw new Error('Jikan: too many retries');
}

const SEQUEL = /\b(season|part|cour)\b|\b\d+(st|nd|rd|th)\b|\b(ii|iii|iv|v)\b\s*$|-hen\b|:\s*.*\bhen\b|\b(movie|recap|ova|specials?)\b/i;
// "Demon Slayer: Kimetsu no Yaiba" -> also "Demon Slayer", "Kimetsu no Yaiba"; "Hunter x Hunter (2011)" -> "Hunter x Hunter"
function titleForms(titles) {
  const out = new Set();
  for (const t of titles.filter(Boolean)) {
    const clean = t.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    out.add(t); out.add(clean);
    for (const part of clean.split(/\s*[:：]\s*|\s+-\s+/)) if (part.length >= 3) out.add(part.trim());
  }
  return [...out].filter(Boolean);
}
const cleanTitle = t => t.replace(/\s*\((19|20)\d\d\)\s*$/, '').trim();


// job.kind: "characters" (ranked by MAL favorites) | "anime" | "manga" (ranked by members = popularity)
async function malTop(job) {
  const limit = job.limit || 300;
  const out = [];
  for (let page = 1; out.length < limit && page <= 40; page++) {
    let url;
    if (job.kind === 'characters') url = `/top/characters?page=${page}&limit=25`;
    else url = `/top/${job.kind}?filter=bypopularity&page=${page}&limit=25${job.mediaType ? '&type=' + job.mediaType : ''}`;
    const j = await jikan(url);
    for (const x of j.data) {
      if (job.kind === 'characters') {
        out.push({ text: displayName({ name: { full: x.name } }), count: x.favorites, aliases: nameAliases({ name: { full: x.name, native: x.name_kanji, alternative: x.nicknames || [] } }) });
      } else {
        // titles[] carries Japanese and (when MAL has them) Spanish titles too
        const titles = [x.title, x.title_english, x.title_japanese, ...(x.title_synonyms || []), ...((x.titles || []).filter(t => ['Default', 'Synonym', 'English', 'Japanese', 'Spanish'].includes(t.type)).map(t => t.title))].filter(usable);
        if (job.dropSequels !== false && titles.some(t => SEQUEL.test(t))) continue;
        const main = x.title_english || x.title;
        out.push({ text: main, count: x.members, aliases: [...new Set(titles)].filter(t => t !== main) });
      }
    }
    process.stdout.write('.');
    if (!j.pagination || !j.pagination.has_next_page) break;
  }
  return out;
}

// ---------------------------------------------------------------- OpenDota
async function dotaHeroes(job) {
  const r = await fetch('https://api.opendota.com/api/heroStats');
  const heroes = await r.json();
  return heroes.map(h => {
    let picks = h.pub_pick;
    if (picks == null) picks = [1, 2, 3, 4, 5, 6, 7, 8].reduce((t, k) => t + (h[`${k}_pick`] || 0), 0);
    if (job.metric === 'pro') picks = h.pro_pick || 0;
    return { text: h.localized_name, count: picks, aliases: [] };
  });
}

// An alias shared by two answers is dropped from both (unless one is the base version of the other,
// e.g. "Hunter x Hunter" vs "Hunter x Hunter (2011)"), so typing it never silently credits the higher-ranked one.
function dedupeAliases(answers) {
  const owner = new Map();
  answers.forEach((a, i) => owner.set(normalize(a.text), i));
  const claims = new Map();
  answers.forEach((a, i) => {
    for (const al of a.aliases) {
      const n = normalize(al);
      if (!n) continue;
      if (!claims.has(n)) claims.set(n, new Set());
      claims.get(n).add(i);
      if (owner.has(n) && owner.get(n) !== i) claims.get(n).add(owner.get(n));
    }
  });
  const keepFor = new Map();
  for (const [n, set] of claims) {
    if (set.size < 2) continue;
    const rows = [...set];
    keepFor.set(n, rows.find(r => rows.every(o => o === r || normalize(answers[o].text).startsWith(normalize(answers[r].text)))));
  }
  answers.forEach((a, i) => {
    const self = normalize(a.text), used = new Set();
    a.aliases = a.aliases.filter(al => {
      const n = normalize(al);
      if (!n || n === self || used.has(n) || (keepFor.has(n) && keepFor.get(n) !== i)) return false;
      used.add(n);
      return true;
    });
  });
}

// ---------------------------------------------------------------- run
const RUNNERS = { franchiseCharacters, franchiseTitles, topCharacters, topAnime, topManga, malTop, dotaHeroes };

(async () => {
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const c of SOURCES.categories || []) if (!db.categories.some(x => x.id === c.id)) db.categories.push(c);

  let changed = 0;
  for (const job of SOURCES.jobs) {
    if (only.length && !only.some(o => job.id.includes(o))) continue;
    if (job.enabled === false) continue;
    process.stdout.write(`• ${job.id} (${job.type})… `);
    try {
      let answers;
      try {
        answers = await RUNNERS[job.type](job);
      } catch (e) {
        // MyAnimeList's free API (Jikan) is sometimes down or unreachable — use AniList's equivalent ranking instead.
        if (job.type !== 'malTop' || job.fallback === false) throw e;
        const why = e.cause ? e.cause.code || e.cause.message : e.message;
        process.stdout.write(`MyAnimeList unreachable (${why}), using AniList instead… `);
        const alt = { characters: topCharacters, anime: topAnime, manga: topManga }[job.kind];
        answers = await alt(job);
        job.source = { characters: 'Most favorited characters on AniList ({year})', anime: 'Most popular anime on AniList ({year})', manga: 'Most popular manga on AniList ({year})' }[job.kind];
      }
      // merge duplicates (same display name), drop excluded, sort, trim
      const byName = new Map();
      for (const a of answers) {
        if ((job.exclude || []).some(x => norm(x) === norm(a.text))) continue;
        const k = a.text.toLowerCase();
        const prev = byName.get(k);
        if (!prev || a.count > prev.count) byName.set(k, { ...a, aliases: [...new Set([...(prev ? prev.aliases : []), ...a.aliases])] });
      }
      answers = [...byName.values()].filter(a => a.count > 0).sort((a, b) => b.count - a.count).slice(0, job.limit || 30);
      const isTitles = ['topAnime', 'topManga', 'franchiseTitles'].includes(job.type) || (job.type === 'malTop' && job.kind !== 'characters');
      if (isTitles) for (const a of answers) { a.aliases = titleForms([a.text, ...a.aliases]); a.text = cleanTitle(a.text); }
      applyNames(answers, job);
      if (['franchiseCharacters', 'topCharacters'].includes(job.type) || (job.type === 'malTop' && job.kind === 'characters')) addNamePartAliases(answers);
      dedupeAliases(answers);
      for (const a of answers) a.aliases = a.aliases.slice(0, isTitles ? 30 : 20);

      const survey = {
        id: job.surveyId || 'auto-' + job.id,
        category: job.category,
        prompt: job.prompt,
        source: (job.source || '').replace('{year}', YEAR),
        ...(TITLES[job.surveyId || 'auto-' + job.id] || {}),
        answers,
      };
      const i = db.surveys.findIndex(s => s.id === survey.id);
      if (i >= 0) db.surveys[i] = survey; else db.surveys.push(survey);
      console.log(`${answers.length} answers — top: ${answers.slice(0, 5).map(a => `${a.text} (${a.count})`).join(', ')}`);
      changed++;
    } catch (e) {
      const cause = e.cause ? ` (${e.cause.code || ''} ${e.cause.message || e.cause})` : '';
      console.log('FAILED: ' + e.message + cause);
    }
  }

  if (DRY) return console.log('\n(dry run — nothing written)');
  if (!changed) return console.log('\nNothing imported, data/quiz.json left unchanged.');
  fs.writeFileSync(DATA_FILE + '.bak', fs.readFileSync(DATA_FILE));
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  console.log(`\nSaved to ${path.relative(ROOT, DATA_FILE)} (previous version in quiz.json.bak). Restart the server to load it.`);
})();
