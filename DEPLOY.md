# Deploying High Velocity Paintball to a DigitalOcean Droplet

Your droplet:  paintballpecker  ·  Ubuntu 24.04  ·  IP **143.198.126.182**

There are 3 steps: upload the game, run one setup command, play.

---

## 1. Upload the game zip to the droplet

From **your Windows PC**, open PowerShell and run (it'll ask for the droplet's
root password you set when creating it):

```powershell
scp "C:\Users\David\Documents\Claude\Projects\HVPB\HVPB-test.zip" root@143.198.126.182:/root/
```

No scp / prefer a GUI? Use **WinSCP** (free): connect to host `143.198.126.182`,
user `root`, drop `HVPB-test.zip` into `/root/`.

---

## 2. Set it up (one paste)

On the droplet's **Web Console** (the button on the droplet page) — or any SSH
session — paste this whole block and press Enter:

```bash
apt-get update -y && apt-get install -y nodejs unzip \
&& unzip -o /root/HVPB-test.zip -d /opt/ \
&& bash /opt/HVPB/deploy/setup.sh
```

That installs Node, unpacks the game to `/opt/HVPB`, runs it as a background
service (auto-restarts on crash/reboot), and opens the firewall for port 3000.

---

## 3. Play

Everyone opens:  **http://143.198.126.182:3000**

Create an account (username + password) and you're in. Progress (coins, levels,
accounts) is saved in `/opt/HVPB/data/economy.json` on the droplet.

---

## Updating the game later

Re-upload the new `HVPB-test.zip` (step 1), then on the droplet:

```bash
unzip -o /root/HVPB-test.zip -d /opt/ && systemctl restart hvpb
```

Your `data/economy.json` (accounts + progress) is NOT in the zip, so updates
keep everyone's saved data.

---

## Managing the server

```bash
systemctl status hvpb      # is it running?
systemctl restart hvpb     # restart
journalctl -u hvpb -n 50   # recent logs
```

---

## Important: secure logins before going public

Right now players connect over **http/ws**, so passwords are sent **unencrypted**.
That's fine for a quick test with friends, but before any real use, put it behind
**HTTPS** so logins (`wss://`) are encrypted. Easiest path:

1. Point a domain (or subdomain) at `143.198.126.182` (an `A` record).
2. Install Caddy and let it auto-issue a free TLS cert:

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/...'   # (full Caddy steps when you have a domain)
```

Tell me when you have a domain and I'll give you the exact Caddy config to
proxy `https://yourdomain → localhost:3000`.
