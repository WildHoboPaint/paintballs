#!/usr/bin/env bash
# High Velocity Paintball - droplet setup (run as root on Ubuntu).
# Works whether the code arrived via `git clone` or via the zip.
set -uo pipefail
ZIP="${1:-/root/HVPB-test.zip}"
echo ">> Installing Node.js, git, unzip..."
apt-get update -y
apt-get install -y nodejs git unzip
if [ -f "$ZIP" ] && [ ! -d /opt/HVPB/.git ]; then echo ">> Unpacking zip..."; unzip -o "$ZIP" -d /opt/; fi
echo ">> Installing systemd service..."
cat >/etc/systemd/system/hvpb.service <<'UNIT'
[Unit]
Description=High Velocity Paintball server
After=network.target
[Service]
WorkingDirectory=/opt/HVPB
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now hvpb
echo ">> Installing 'hvpb-update' command..."
cat >/usr/local/bin/hvpb-update <<'U'
#!/usr/bin/env bash
cd /opt/HVPB && git pull --ff-only && systemctl restart hvpb && echo "HVPB updated & restarted."
U
chmod +x /usr/local/bin/hvpb-update
echo ">> Firewall (SSH + game port 3000)..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 3000/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true
sleep 1
systemctl --no-pager status hvpb | head -6
IP=$(curl -s ifconfig.me 2>/dev/null || echo YOUR_IP)
echo; echo "==> Done. Play at  http://$IP:3000"
echo "==> Update anytime with:  hvpb-update"
