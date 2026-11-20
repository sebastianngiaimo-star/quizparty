// QuizParty server: serves the TV screen (/host), the phone controller (/), the editor (/editor)
// and runs the games over Socket.IO.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const multer = require('multer');
const { Server } = require('socket.io');
const { Room } = require('./lib/game');
const { matchAnswer, rankSurvey } = require('./lib/match');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'quiz.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.copyFileSync(path.join(__dirname, 'sample-data.json'), DATA_FILE);
let DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const getDB = () => DB;

function saveDB() {
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(DB, null, 2));
  fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'editor.html')));

app.get('/api/config', (req, res) => res.json({ lang: (DB.settings || {}).lang || 'en', title: (DB.settings || {}).title || '', auth: !!ADMIN_PASSWORD }));

function admin(req, res, next) {
  if (ADMIN_PASSWORD && req.get('x-admin-password') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'auth' });
  next();
}

app.get('/api/data', admin, (req, res) => res.json(DB));
app.put('/api/data', admin, (req, res) => {
  const d = req.body;
  if (!d || !Array.isArray(d.categories) || !Array.isArray(d.trivia) || !Array.isArray(d.surveys)) return res.status(400).json({ error: 'bad data' });
  DB = { settings: d.settings || {}, categories: d.categories, trivia: d.trivia, surveys: d.surveys };
  saveDB();
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID().slice(0, 12) + path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|audio|video)\//.test(file.mimetype)),
});
app.post('/api/upload', admin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file' });
  res.json({ src: '/media/' + req.file.filename });
});

app.post('/api/test-match', admin, (req, res) => {
  const ranked = rankSurvey({ answers: req.body.answers || [] });
  const m = matchAnswer(req.body.text, ranked);
  res.json(m ? { match: ranked[m.idx].text, pos: m.idx + 1, rank: ranked[m.idx].rank, dist: m.dist } : { match: null });
});

// ---------------- rooms ----------------
const rooms = new Map();
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  while (rooms.has(c));
  return c;
}

setInterval(() => {
  for (const [code, r] of rooms) if (Date.now() - r.lastActive > 6 * 3600 * 1000) rooms.delete(code);
}, 600000);

function originOf(socket) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const h = socket.handshake.headers;
  const proto = (h['x-forwarded-proto'] || '').split(',')[0] || 'http';
  return `${proto}://${h['x-forwarded-host'] || h.host}`;
}

io.on('connection', socket => {
  const on = socket.on.bind(socket);
  socket.on = (ev, fn) => on(ev, (...args) => { try { return fn(...args); } catch (e) { console.error('[error]', ev, e); } });
  let room = null;
  let role = null;
  let playerId = null;

  socket.on('host:create', async ({ code, hostKey } = {}, ack) => {
    let r = code && rooms.get(String(code).toUpperCase());
    if (!r || r.hostKey !== hostKey) {
      r = new Room(io, newCode(), getDB);
      rooms.set(r.code, r);
    }
    r.joinUrl = `${originOf(socket)}/?code=${r.code}`;
    r.qr = await QRCode.toDataURL(r.joinUrl, { margin: 1, width: 600, color: { dark: '#111111', light: '#ffffff' } });
    room = r;
    role = 'host';
    r.hostSockets.add(socket.id);
    if (ack) ack({ code: r.code, hostKey: r.hostKey });
    r.sync();
  });

  socket.on('player:join', ({ code, name, token } = {}, ack) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return ack && ack({ error: 'noRoom' });
    const res = r.join(name, token, socket);
    if (res.error) return ack && ack({ error: res.error });
    room = r;
    role = 'player';
    playerId = res.player.id;
    if (ack) ack({ ok: true, token: res.player.token, code: r.code });
    r.sync();
  });

  const me = () => (room && playerId ? room.players.get(playerId) : null);

  socket.on('control', ({ action, data } = {}) => {
    if (!room) return;
    const isHost = role === 'host';
    const isVip = role === 'player' && room.vip === playerId;
    if (!isHost && !isVip) {
      // Any player may switch their own team before SQUARES starts.
      if (action === 'team' && data && data.playerId === playerId) room.control('team', data);
      return;
    }
    if (action === 'kick' && !isHost && data && data.id === playerId) return; // the VIP can't kick themselves
    room.control(action, data || {}, isHost);
  });

  socket.on('answer', idx => { const p = me(); if (p) room.classicAnswer(p, idx); });
  socket.on('hilo:submit', text => { const p = me(); if (p) room.hiloSubmit(p, text); });
  socket.on('squares:guess', text => { const p = me(); if (p) room.squaresGuess(p, text); });
  socket.on('squares:suggest', text => { const p = me(); if (p) room.squaresSuggest(p, text); });
  socket.on('hilo:vote', idx => { const p = me(); if (p) room.hiloVote(p, idx); });
  socket.on('hilo:final', idx => { const p = me(); if (p) room.hiloFinalPick(p, idx); });

  socket.on('disconnect', () => {
    if (!room) return;
    if (role === 'host') room.hostSockets.delete(socket.id);
    else room.disconnect(socket.id);
  });
});

// Never let one bad event take the whole party down.
process.on('uncaughtException', err => console.error('[error]', err));
process.on('unhandledRejection', err => console.error('[error]', err));

server.listen(PORT, () => {
  console.log(`QuizParty running on http://localhost:${PORT}`);
  console.log(`  TV screen:  /host`);
  console.log(`  Editor:     /editor${ADMIN_PASSWORD ? ' (password protected)' : ''}`);
  console.log(`  Phones:     /`);
});
