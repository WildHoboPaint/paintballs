# Push to GitHub (WildHoboPaint/paintballs) → one-command updates

Repo: https://github.com/WildHoboPaint/paintballs  (Private)
Droplet: 143.198.126.182

---

## Step 0. Delete the leftover .git folder (one time)

A partial `.git` got created during setup — remove it first. PowerShell:
```powershell
Remove-Item -Recurse -Force "C:\Users\David\Documents\Claude\Projects\HVPB\.git"
```
(If it's not there, skip.)

---

## Step 1. Push your project (from your PC, one time)

Open **PowerShell in the project folder** and run:
```powershell
cd "C:\Users\David\Documents\Claude\Projects\HVPB"
git init
git add -A
git commit -m "High Velocity Paintball - initial commit"
git branch -M main
git remote add origin https://github.com/WildHoboPaint/paintballs.git
git push -u origin main
```
On `git push`, a GitHub login window pops up (browser) — approve it. Done; refresh
the repo page and you'll see your files.

> Prefer a GUI? GitHub Desktop → File → Add local repository → the HVPB folder →
> "create a repository" → then set the remote to the URL above and Push. The CLI
> above is the most reliable since the repo already exists.

---

## Step 2. Deploy on the droplet (one time)

The repo is **private**, so the droplet needs a read token to clone it:

1. GitHub → your avatar → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories → paintballs**
   - Permissions: **Contents → Read-only**
   - Generate, then **copy the token** (starts with `github_pat_...`).
2. On the droplet **Web Console** (root), paste (swap in your token):
```bash
apt-get update -y && apt-get install -y git
git clone https://github_pat_YOURTOKEN@github.com/WildHoboPaint/paintballs.git /opt/HVPB
bash /opt/HVPB/deploy/setup.sh
```

Play at **http://143.198.126.182:3000**

> Want to skip the token? Make the repo **Public** (repo → Settings → General →
> Danger Zone → Change visibility). Then clone with the plain URL and no token —
> the code has no secrets (passwords are hashed and live in `data/`, which is not
> committed).

---

## Step 3. The update loop (every future change)

1. I edit the code in your project folder.
2. **You push:** `git add -A && git commit -m "..." && git push`
   (or GitHub Desktop: summary → Commit → Push)
3. **On the droplet:** `hvpb-update`

`hvpb-update` pulls + restarts. Players' accounts & progress (`data/`) are untouched.
