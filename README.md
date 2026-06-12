# High Velocity Paintball — Online

A top-down, multiplayer paintball arena shooter inspired by the classic HVPB and Paintball Net.
**Round-based elimination** (last team standing wins the round), AI bots that fill empty slots, a
**Paint Coins** economy with an equipment shop **between rounds**, four terrain types that control
who can see whom, and an optional **ante** pot that the winning team splits.

> **Paint Coins are a virtual in-game currency only.** No real money is involved anywhere.

---

## What's in this folder

| File | What it is |
|------|------------|
| `server.js` | The game server. Pure Node.js, **no dependencies to install**. |
| `game.js` | The authoritative game logic (simulation, economy, tournament). |
| `public/index.html` | The browser game client (what players actually see and play). |
| `start.bat` | Double-click on Windows to start the server. |
| `start.sh` | Start script for Mac/Linux/your server. |
| `data/economy.json` | Auto-created. Stores everyone's Paint Coins + owned gear. |

You only need **Node.js** installed. Get it from <https://nodejs.org> (the "LTS" version is fine).

---

## Quick start (play on your own computer / home network)

1. Install Node.js if you don't have it: <https://nodejs.org>
2. **Windows:** double-click `start.bat`.
   **Mac/Linux:** open a terminal in this folder and run `node server.js`.
3. You'll see:
   ```
   Local:    http://localhost:3000
   Network:  http://<this-machine-ip>:3000
   ```
4. Open **http://localhost:3000** in your browser, type a name, pick a class, and Drop In.

### Letting friends join on the same Wi‑Fi / LAN
- Find this machine's local IP (Windows: run `ipconfig`, look for "IPv4 Address", e.g. `192.168.1.20`).
- Friends on the same network open `http://192.168.1.20:3000` in their browser.
- If they can't connect, allow Node.js through your firewall (Windows will usually prompt the first time).

That's a fully working **open server** for anyone who can reach that machine. For the whole internet,
deploy it to your hosting (below).

---

## Deploying to your WHM / cPanel server (internet-wide play)

Because there are **zero dependencies**, deployment is just "upload the files and start Node." Two paths:

### Path A — cPanel "Setup Node.js App" (shared cPanel or no root)
1. Upload this whole folder somewhere under your account (e.g. `~/hvpb`) via cPanel **File Manager** or FTP.
2. In cPanel open **Setup Node.js App** → **Create Application**.
   - **Application root:** the folder you uploaded (`hvpb`).
   - **Application startup file:** `server.js`.
   - **Application URL:** pick the domain/subdomain you want (e.g. `paintball.yourdomain.com`).
   - Node version: any modern one (16+).
3. Click **Create**, then **Start App**. You do **not** need to run "npm install" (no dependencies),
   but clicking it is harmless.
4. Visit your Application URL. The client auto-uses `wss://` through your domain.

> **WebSocket note:** the app needs WebSocket upgrades to pass through. Hosts running **LiteSpeed**
> (very common on cPanel) support this out of the box. If you're on Apache and the game connects but
> never starts, see the Apache note below.

### Path B — VPS / Dedicated with WHM root (most flexible)
1. Upload the folder (e.g. to `/home/youruser/hvpb`).
2. Keep it running with a process manager so it survives reboots/crashes. Easiest is **pm2**:
   ```bash
   npm install -g pm2
   cd /home/youruser/hvpb
   PORT=3000 pm2 start server.js --name hvpb
   pm2 save && pm2 startup
   ```
   (Or a systemd service — sample below.)
3. **Expose it.** Either:
   - Open port 3000 in WHM's firewall (CSF: *Firewall Allow Port* 3000) and share `http://your-server-ip:3000`, **or**
   - Reverse-proxy it behind a domain with HTTPS (recommended). Apache vhost snippet:
     ```apache
     RewriteEngine On
     RewriteCond %{HTTP:Upgrade} websocket [NC]
     RewriteCond %{HTTP:Connection} upgrade [NC]
     RewriteRule ^/?(.*) "ws://127.0.0.1:3000/$1" [P,L]
     ProxyPass        / http://127.0.0.1:3000/
     ProxyPassReverse / http://127.0.0.1:3000/
     ```
     Requires `mod_proxy`, `mod_proxy_http`, and **`mod_proxy_wstunnel`** enabled (you have root).

#### Sample systemd service (`/etc/systemd/system/hvpb.service`)
```ini
[Unit]
Description=High Velocity Paintball
After=network.target

[Service]
WorkingDirectory=/home/youruser/hvpb
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
User=youruser

[Install]
WantedBy=multi-user.target
```
Then: `sudo systemctl enable --now hvpb`.

The server honors the **`PORT`** environment variable, which is what cPanel/Passenger sets automatically.

---

## How to play

| Action | Control |
|--------|---------|
| Move | `W` `A` `S` `D` or arrow keys |
| Aim | Mouse |
| Fire | Left click (hold to keep firing) |
| Reload | `R` |
| Deploy gadget | `G` |
| Loadout / shop | `B` |

### Classes & leveling
- **Everyone starts as a Trooper.** You earn **XP from splats**; each level costs a few more splats than the last.
- At **Level 10** you unlock the 7 specialist classes — pick one in the Loadout screen (`B`):
  **Vet Trooper** (upgraded all-rounder), **Heavy Weapons** (minigun/bazooka tank), **Scout** (fast recon, vision + jetpack),
  **Infiltrator** (camo/stealth, blowgun, mines), **Sniper** (long-range rifle), **Engineer** (turrets/mines), **Officer** (assault rifle, command).
- Your level, coins, and gear are saved by name — use the same name to keep your progress.

### The round loop (dodgeball style)
- Each **round** is last-team-standing. When you're splatted, you're **out for the rest of that round**
  (you spectate) — no respawning mid-round.
- A round ends when one team is fully eliminated (or the round timer runs out — most players alive wins).
- Then there's a short **intermission / shop period** before the next round auto-starts.
- **Bots** auto-fill each team up to 5 so rounds always have targets. They make room as real players join.

### Paint Coins & the Loadout
- Earn **+15** for every splat, a **round-win bonus** for the winning team, plus a **survivor bonus** if you lived,
  and a **level-up bonus** each time you rank up.
- The **Loadout screen (`B`)** opens automatically during intermission. It's a simple tabbed shop — buy an item once
  (permanent) and click owned items to equip. One per category:
  - **Weapon** — paintball gun/rifle, assault rifle, sniper rifle, minigun, bazooka (splash), shotgun (spread), blowgun (silent), auto pistol. Each class can use a different set.
  - **Armor** — light/medium/heavy: reduces incoming paint damage, at a small speed cost.
  - **Vision** — thermal / gamma / satellite optics: spot **concealed** enemies (in forest, camo, etc.) at range.
  - **Camo** — match your terrain (forest/mountain/water/plains) to stay **hidden at range** even out in the open.
  - **Gadget** (deploy with `G`) — **mines** (detonate on enemies), **auto-turret** (Engineer/Officer), **jetpack** (ignore terrain slowdown), **decoy**.
  - **Ammo** — standard / fast (faster, longer) / armor-piercing (ignores armor).
- **Ante (optional):** toggle the ante to wager the buy-in on the next round; the **winning team's anted players split the pot**.

Coins, level, and gear are saved by name in `data/economy.json` — use the same name to keep your progress.

### Terrain (use it!)
Each tile is one of four types that changes movement speed **and** what enemies can see:

| Terrain | Speed | Visibility |
|---------|-------|------------|
| **Plains** | full | You're exposed; you can't see anyone hiding in forest or mountains |
| **Forest** | slower | You're hidden from everyone **except** players on a mountain |
| **Water** | slow | Same visibility as plains |
| **Mountain** | slowest | You can see over everything (great for snipers), and you're hidden at range |

Anyone within close range is always visible regardless of terrain. The map is mirrored so both teams get
the same cover.

---

## Tuning

Open `game.js` and edit the constants near the top to taste:
`NEW_WALLET`, `SPLAT_REWARD`, `ROUND_WIN_BONUS`, `SURVIVOR_BONUS`, `BUY_IN`, `SHOP_TIME` (intermission
length), `ROUND_TIME`, `TEAM_SIZE`, the terrain `SPEED_MULT`, and the `CLASSES` / `SHOP` tables.
Restart the server to apply.

---

## Notes & limits
- This is a LAN/-hosted authoritative server; it's tuned for a handful of players per arena (great for
  friends). It's not built for thousands of concurrent users.
- Player identity is by name only (no passwords) — fine for friends; don't treat wallets as secure.
- Paint Coins have no real-world value and cannot be purchased or cashed out.
