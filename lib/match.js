// Answer matching for survey modes (HILO / SQUARES).
// Forgiving on accents, case, punctuation, leading articles, plurals, roman numerals and small typos.
// Works for Latin scripts and Japanese (kana / kanji): "Gojo", "Gojou", "Satoru Gojo", "五条悟" all match.

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'lo', 'un', 'una', 'the', 'a', 'an']);
const ROMAN = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16' };

function normalize(s) {
  let n = String(s || '')
    .normalize('NFKC')                       // full-width letters/digits -> ASCII, ligatures split
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip Latin accents (á -> a, ñ -> n)
    .normalize('NFC')                        // recompose kana (so が stays が, not か + dakuten)
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)) // katakana -> hiragana
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')       // keep letters/digits of every script
    .replace(/\s+/g, ' ')
    .trim();
  let words = n.split(' ');
  if (words.length > 1 && ARTICLES.has(words[0])) words = words.slice(1);
  if (words.length > 1) words = words.map(w => ROMAN[w] || w); // "Final Fantasy VII" -> "final fantasy 7"
  return words.join(' ');
}

const ASCII = /^[a-z0-9]+$/;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'le', 'les', 'des', 'du']);

// Variants of a normalized answer that should count as the same thing.
function keys(n) {
  const base = n.replace(/ /g, '');
  const out = new Set([base]);
  // "Lord of the Rings: Return of the King" == "The Lord of the Rings: The Return of the King"
  const words = n.split(' ');
  if (words.length > 1) {
    const stripped = words.filter(w => !STOP.has(w)).join('');
    if (stripped && stripped !== base) out.add(stripped);
  }
  if (ASCII.test(base)) {
    if (base.length > 4 && base.endsWith('es')) out.add(base.slice(0, -2));
    if (base.length > 3 && base.endsWith('s')) out.add(base.slice(0, -1));
    // Spanish diminutives: cafecito -> cafe, perrito -> perro, galletita -> galleta
    for (const k of [...out]) {
      let m;
      if (k.length > 6 && (m = k.match(/^(.+)(cit[oa])$/))) out.add(m[1]);
      if (k.length > 5 && (m = k.match(/^(.+)it([oa])$/))) { out.add(m[1] + m[2]); out.add(m[1]); }
    }
  }
  return [...out].filter(Boolean);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function threshold(len) {
  if (len < 5) return 0;
  if (len < 9) return 1;
  return 2;
}

// Pre-computed match keys per answer list (computed once per game, not once per guess).
const KEY_CACHE = new WeakMap();
function answerKeys(answers) {
  let k = KEY_CACHE.get(answers);
  if (!k) {
    const lists = [];
    const exact = new Map(); // key -> lowest (best-ranked) answer index
    answers.forEach((a, idx) => {
      const set = new Set();
      for (const f of [a.text, ...(a.aliases || [])]) for (const y of keys(normalize(f))) set.add(y);
      lists.push([...set]);
      for (const y of set) if (!exact.has(y)) exact.set(y, idx);
    });
    k = { lists, exact };
    KEY_CACHE.set(answers, k);
  }
  return k;
}

// answers: ranked array of {text, aliases}. Returns {idx, dist} or null.
// Exact match wins (highest-ranked answer if several share a key), otherwise the closest typo.
function matchAnswer(input, answers) {
  const n = normalize(input);
  if (!n) return null;
  const ik = keys(n);
  const { lists, exact } = answerKeys(answers);
  let best = null;
  for (const x of ik) if (exact.has(x) && (!best || exact.get(x) < best.idx)) best = { idx: exact.get(x), dist: 0 };
  if (best) return best;
  const digits = s => s.replace(/\D/g, '');
  for (let idx = 0; idx < lists.length; idx++) {
    for (const y of lists[idx]) {
      for (const x of ik) {
        const th = threshold(Math.max(x.length, y.length));
        if (!th || digits(x) !== digits(y)) continue; // typos are forgiven, but "Final Fantasy 10" is never "Final Fantasy 12"
        const d = lev(x, y, th);
        if (d <= th && (!best || d < best.dist)) best = { idx, dist: d };
      }
    }
  }
  return best;
}

// Sort a survey's answers by popularity and attach rank (ties share a rank) and percentage.
function rankSurvey(survey) {
  const arr = (survey.answers || [])
    .filter(a => a && String(a.text || '').trim())
    .map((a, i) => ({
      text: String(a.text).trim(),
      count: Number(a.count) || 0,
      aliases: Array.isArray(a.aliases) ? a.aliases : String(a.aliases || '').split(',').map(s => s.trim()).filter(Boolean),
      orig: i,
    }))
    .sort((a, b) => b.count - a.count || a.orig - b.orig);
  const total = arr.reduce((t, a) => t + a.count, 0) || 1;
  let r = 0, prev = null;
  arr.forEach((a, i) => {
    if (a.count !== prev) { r++; prev = a.count; }
    a.rank = r;
    a.idx = i;
    a.pct = Math.round((1000 * a.count) / total) / 10;
  });
  return arr;
}

module.exports = { normalize, matchAnswer, rankSurvey };
