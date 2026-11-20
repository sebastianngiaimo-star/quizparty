#!/usr/bin/env node
// Play over the internet (Discord, friends in other houses):
//   npm run online
// Starts a free Cloudflare "quick tunnel" (no account needed) that gives the game a public
// https://….trycloudflare.com address, then starts the game server with that address in the QR code.
// cloudflared is downloaded automatically into tools/bin/ the first time (Linux / Windows).
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BIN_DIR = path.join(__dirname, 'bin');
const isWin = process.platform === 'win32';
const LOCAL_BIN = path.join(BIN_DIR, isWin ? 'cloudflared.exe' : 'cloudflared');

function inPath() {
  try { return execSync(isWin ? 'where cloudflared' : 'command -v cloudflared', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

async function download() {
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[process.arch];
  let asset;
  if (process.platform === 'linux' && arch) asset = `cloudflared-linux-${arch}`;
  else if (isWin && (arch === 'amd64' || arch === '386')) asset = `cloudflared-windows-${arch}.exe`;
  else {
    console.error('Please install cloudflared first (macOS: brew install cloudflared), then run this again.');
    process.exit(1);
  }
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  console.log(`Downloading cloudflared (one time, ~40 MB)…\n  ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_BIN, Buffer.from(await res.arrayBuffer()));
  if (!isWin) fs.chmodSync(LOCAL_BIN, 0o755);
  console.log('  saved to', LOCAL_BIN);
  return LOCAL_BIN;
}

(async () => {
  const bin = inPath() || (fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : await download());
  console.log('Opening a public tunnel…');
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let server = null;
  const stopAll = () => { try { tunnel.kill(); } catch {} try { server && server.kill(); } catch {} process.exit(0); };
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  let log = '';
  tunnel.on('close', code => {
    console.error(`\ncloudflared stopped (code ${code}). The game is no longer reachable from outside.`);
    if (!found) fs.writeSync(2, log.split('\n').slice(-6).join('\n') + '\n');
    if (server) server.kill();
    process.exit(1);
  });

  let found = false;
  const onData = buf => {
    log = (log + buf.toString()).slice(-4000);
    const m = !found && buf.toString().match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
    if (!m) return;
    found = true;
    const url = m[0];
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { stdio: 'inherit', env: { ...process.env, PORT, PUBLIC_URL: url } });
    server.on('exit', () => { tunnel.kill(); process.exit(0); });
    setTimeout(() => {
      console.log('\n================================================================');
      console.log('  The game is online!');
      console.log(`  TV / screen you share on Discord:  ${url}/host`);
      console.log(`  Friends join on their phones:      ${url}`);
      console.log('  (the QR code and room code on the TV screen use this address)');
      console.log('  The address changes every time you run this. Ctrl+C to stop.');
      console.log('================================================================\n');
    }, 1500);
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  setTimeout(() => { if (!found) console.error('Still waiting for Cloudflare… (check your internet connection)'); }, 20000);
})().catch(e => { console.error('Could not go online:', e.message); process.exit(1); });
