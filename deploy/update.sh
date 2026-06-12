#!/usr/bin/env bash
# Pull the latest code and restart the live server.
set -e
cd /opt/HVPB
git pull --ff-only
systemctl restart hvpb
echo "HVPB updated & restarted."
