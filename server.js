/* ============================================================
   HIGH VELOCITY PAINTBALL — multiplayer server
   Zero npm dependencies. Pure Node.js (http + crypto).
   - Serves the browser client from ./public
   - WebSocket game server (RFC6455, implemented inline)
   - Authoritative simulation via game.js at 30Hz
   - Persists the Paint Coins economy to ./data/economy.json
   Run:  node server.js     (uses PORT env var, defaults to 3000)
   ============================================================ */
'use strict';

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { Game } = require('./game.js');

const PORT = process.env.PORT || 3000;
const TICK_MS = 33;                       // ~30 Hz simulation + broadcast
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'economy.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- load saved economy ----------
let saved = null;
try { if (fs.existsSync(SAVE_FILE)) saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); }
catch (e) { console.warn('Could not read save file:', e.message); }
const game = new Game(saved);

// ---------- debounced persistence ----------
let saveTimer = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE, JSON.stringify(game.serialize()));
    } catch (e) { console.warn('Save failed:', e.message); }
  }, 2000);
}

// ============================================================
//  Static file server
// ============================================================
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json' };

const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  if (urlPath === '/health') { res.writeHead(200); return res.end('ok'); }

  // prevent path traversal
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ============================================================
//  Minimal WebSocket (RFC 6455) — no external deps
// ============================================================
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();   // Conn objects

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.playerId = null;
    this.alive = true;
    clients.add(this);

    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  send(obj) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { this.close(); }
  }
  close() {
    if (!this.alive) return;
    this.alive = false;
    clients.delete(this);
    if (this.playerId != null) { game.removeHuman(this.playerId); persist(); }
    try { this.socket.destroy(); } catch (e) {}
  }
  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // parse as many complete frames as available
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); offset = 10; }
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < offset + maskLen + len) return; // wait for more
      const opcode = this.buf[0] & 0x0f;
      let payload = this.buf.slice(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = this.buf.slice(offset, offset + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buf = this.buf.slice(offset + maskLen + len);

      if (opcode === 0x8) { this.close(); return; }            // close
      else if (opcode === 0x9) {                                // ping -> pong
        try { this.socket.write(Buffer.from([0x8a, 0])); } catch (e) {}
      } else if (opcode === 0x1) {                              // text
        try { this.handle(JSON.parse(payload.toString('utf8'))); } catch (e) {}
      }
    }
  }
  handle(msg) {
    switch (msg.t) {
      case 'join': {
        if (this.playerId != null) return;
        const auth = msg.create ? game.registerAccount(msg.name, msg.pass) : game.loginAccount(msg.name, msg.pass);
        if (!auth.ok) { this.send({ t:'authfail', msg: auth.msg }); return; }
        this.playerId = game.addHuman(msg.name, msg.cls, auth.key);
        const p = game.players.get(this.playerId);
        const G = require('./game.js');
        this.send({ t:'welcome', id:this.playerId, arena:G.ARENA,
                    obstacles:game.obstacles, classes:G.CLASSES, catalog:G.CATALOG, unlockLevel:G.CLASS_UNLOCK_LEVEL,
                    terrain:{ grid:game.grid, cols:game.tcols, rows:game.trows, tile:G.TILE },
                    lobby:{ w:G.LOBBY.w, h:G.LOBBY.h, zones:G.LOBBY_ZONES },
                    speeds:G.SPEED_MULT, name:p.name, money:game.getMoney(p), build:G.BUILD,
                    loadoutCfg:{ wmodSlots:G.WMOD_SLOTS, chipSlots:G.CHIP_SLOTS, maxCamo:G.MAX_CAMO, weaponWt:G.WEAPON_WT, baseAmmo:G.BASE_AMMO, heavyClasses:G.HEAVY_CLASSES }, classUnlock:G.CLASS_UNLOCK });
        persist();
        break;
      }
      case 'input': if (this.playerId != null) game.setInput(this.playerId, msg); break;
      case 'class': if (this.playerId != null) { const r = game.setClass(this.playerId, msg.cls); this.send({ t:'classresult', ...r }); } break;
      case 'buy': {
        if (this.playerId == null) return;
        const r = game.buy(this.playerId, msg.item);
        this.send({ t:'buyresult', ...r });
        persist();
        break;
      }
      case 'upgrade': {
        if (this.playerId == null) return;
        const r = game.upgradeWeapon(this.playerId, msg.item);
        this.send({ t:'upgraderesult', ...r });
        persist();
        break;
      }
      case 'upgradeclass': {
        if (this.playerId == null) return;
        const r = game.upgradeClass(this.playerId);
        this.send({ t:'classupresult', ...r });
        persist();
        break;
      }
      case 'loadout': {
        if (this.playerId == null) return;
        const r = game.applyLoadout(this.playerId, msg.loadout || msg);
        this.send({ t:'loadresult', ...r, money: game.getMoney(game.players.get(this.playerId)) });
        break;
      }
      case 'resetloadout': {
        if (this.playerId == null) return;
        const r = game.resetLoadout(this.playerId);
        this.send({ t:'resetresult', ...r });
        persist();
        break;
      }
      case 'ante': {
        if (this.playerId == null) return;
        const r = game.setAnte(this.playerId, !!msg.on, msg.amt);
        this.send({ t:'anteresult', ...r });
        break;
      }
      case 'ready': {
        if (this.playerId == null) return;
        const r = game.setReady(this.playerId, !!msg.on);
        this.send({ t:'readyresult', ...r });
        break;
      }
      case 'modevote': {
        if (this.playerId == null) return;
        const r = game.setModeVote(this.playerId, msg.mode, !!msg.on);
        this.send({ t:'voteresult', ...r });
        break;
      }
      case 'chat': {
        if (this.playerId == null) return;
        const now = Date.now(); if (this._lastChat && now - this._lastChat < 400) return; this._lastChat = now;
        const p = game.players.get(this.playerId); if (!p) return;
        const txt = ('' + (msg.text || '')).replace(/[\u0000-\u001f]/g, ' ').slice(0, 160).trim();
        if (!txt) return;
        if (txt.toLowerCase() === '/maxme paintgod') { const r = game.devGrant(this.playerId); this.send({ t:'buyresult', ok:true, money:r.money, msg:'DEV: max level + 100k coins' }); persist(); return; }
        const out = { t:'chat', from:p.name, team:p.team, text:txt };
        for (const c of clients) c.send(out);
        break;
      }
    }
  }
}

httpServer.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  new Conn(socket);
});

// ============================================================
//  Game loop — fixed tick, per-client snapshot
// ============================================================
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;                 // clamp after lag/pauses

  game.step(dt);
  const events = game.drainEvents();
  let walletChanged = false, mapChanged = false;
  for (const ev of events){ if (ev.type === 'elim' || ev.type === 'roundend' || ev.type === 'roundstart') walletChanged = true; if (ev.type === 'mapchange') mapChanged = true; }
  let mapMsg = null;
  if (mapChanged){ const G = require('./game.js'); mapMsg = { t:'map', arena:G.ARENA, terrain:{ grid:game.grid, cols:game.tcols, rows:game.trows, tile:G.TILE } }; }

  for (const c of clients) {
    if (c.playerId == null) continue;
    if (mapMsg) c.send(mapMsg);
    c.send(game.snapshot(c.playerId, events));
  }
  if (walletChanged) persist();
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`\n  HIGH VELOCITY PAINTBALL server running`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://<this-machine-ip>:${PORT}`);
  console.log(`  (share the Network URL with players on your LAN)\n`);
});

process.on('SIGINT', () => { try { fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(SAVE_FILE, JSON.stringify(game.serialize())); } catch(e){} process.exit(0); });
