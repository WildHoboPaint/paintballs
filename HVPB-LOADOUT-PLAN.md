# HVPB — Loadout, Mods, Weight & Progression (design proposal)

This is a proposal for review. Nothing is built yet — confirm or tweak the numbers
and I'll implement it.

---

## 1. The loadout: slots

Every player has:

- **1 Weapon** — with **2 mod sockets**
- **5 Armor slots** — Head, Body, Arms, Legs, Feet — each holds **1 chip**

(You wrote "Head, Body, Legs, Pants, Shoes" — I renamed to Head/Body/Arms/Legs/Feet
so there's no Legs/Pants overlap. Easy to change.)

Total things you can carry: 2 weapon mods + 5 armor chips. Whether you *can* equip
them all is limited by **weight** (below), which is gated by **level**.

---

## 2. Weapon mods (pick up to 2; you may stack the same one twice)

| Mod | Effect | Weight |
|-----|--------|--------|
| **Magazine** (Space) | +30 paintballs to your round ammo pool | +2 |
| **Buckshot** | Fires a 3-pellet spread; −40% range, −25% fire rate, **3× ammo per shot** | +2 |
| **Scope** | +50% range, −30% fire rate | +2 |

Double-modding is allowed (e.g. two Magazines = +60 paint; two Scopes = even longer
range, even slower).

---

## 3. Armor chips (one per armor slot — up to 5)

| Chip | Effect | Weight | Notes |
|------|--------|--------|-------|
| **Light Plating** | +8% bounce chance | +3 | Anyone |
| **Heavy Plating** | +14% bounce chance | +5 | VetTrooper, HeavyWeapons, Officer only |
| **Ammo Pouch** (Space) | +30 paintballs to round pool | +2 | Anyone |
| **Camo** | Minimap stealth (see §4) | +1 | Only ONE camo counts even if you wear several |

Bounce chance from all plating adds up (replaces the old single-armor deflect). A
hit still = instant out unless it bounces; AP ammo still ignores bounce.

---

## 4. Camo = minimap/satellite stealth only

Per your note, camo **no longer affects in-world line-of-sight** (that's pure
elevation now). Instead:

- A camo'd player is **hidden from enemies' minimap/radar**.
- The **only** way to see a camo'd player on the minimap is **Satellite Uplink** optics.
- No visible marker needed.
- Only one camo chip is ever active at a time.

---

## 5. Ammo: conserve it during the round

- Ammo is **no longer unlimited per round.** You get a **round pool** of paint that
  only refills **between rounds**.
- **Default round pool = 30 shots.** Each **Magazine** mod or **Ammo Pouch** chip adds **+30**.
- Your weapon clip (mag) still controls reload cadence; reloading draws from the
  round pool. When the pool hits 0, you're dry until next round.
- Buckshot burns the pool 3× faster.

So a stock gun = 30 shots/round. Fully kitted for ammo (2 Magazine mods + a few
pouches) could be 150+ — but that's a lot of weight.

---

## 6. Weight — the core tradeoff

Everything you equip has a weight. Your total weight does two things:
1. **Slows you down:** move speed ×= `1 − 0.012 × totalWeight` (floored at 0.5).
   - e.g. weight 10 → −12% speed; weight 25 → −30%.
2. **Is capped by your level:** you can't equip past your **weight capacity**.

Base item weights: Weapon = 4 (always). Then mods/chips as in the tables above.

---

## 7. Progression: level → weight capacity

XP from splats levels you up (as today). Levels now also **raise your weight
capacity every 5 levels**, so you slowly grow into a heavier, more-modded build.

```
Weight capacity = 10 + floor(level / 5) × 2
```

| Level | Capacity | Example build that fits |
|-------|----------|--------------------------|
| 1–4   | 10 | Weapon(4) + 2 Light Plating(6) — or Weapon + 1 Magazine + 1 pouch + camo |
| 5–9   | 12 | Weapon + 1 mod + 2 chips |
| 10–14 | 14 | (Class unlock at 10) Weapon + 2 mods + 2–3 chips |
| 15–19 | 16 | Weapon + 2 mods + 4 chips |
| 20–24 | 18 | Near-full kit |
| 25–29 | 20 | Full 2 mods + 5 chips (~20 wt) |
| 30+   | +2 / 5 lvls | Comfortable headroom |

This gives a long, slow build-up: early players are light and lightly-modded; by
~level 25 you can run a fully-kitted loadout, and choosing *which* mods to fit under
your cap becomes the strategy.

---

## 8. Class / armor access (unchanged + new)

- Everyone starts Trooper; pick a class at level 10 (as today).
- **Light Plating: everyone.**
- **Heavy Plating: VetTrooper, HeavyWeapons, Officer only.**

---

## 9. Shop / how you get mods

Mods & chips are **bought with Paint Coins** in the loadout screen (same economy),
then socketed into weapon/armor slots. Re-socketing is free; buying is one-time
(owned permanently, like gear today). Ammo refills free each round.

---

## Open questions for you

1. **Slot names** — keep Head/Body/Arms/Legs/Feet, or your original wording?
2. **Numbers** — happy with the weights, the `10 + floor(L/5)×2` capacity curve,
   default 30 ammo, and the mod effects? Any you want stronger/weaker?
3. **Should weight also affect anything else** (e.g. reload speed), or just move speed + cap?

---

## 10. Economy & Progression (tuned for longevity)

Design goals: you can't buy much out of the gate; money is a steady grind; **weight
capacity (levels) gates how much you can run**, so even when you're rich you can't
wear everything; **tournaments** are the high-stakes money fountain.

### Income (casual play)
| Source | Amount |
|--------|--------|
| Splat (eliminate someone) | **+10 coins, +1 XP** |
| Round win (per player on winning team) | +60 |
| Survive the round | +25 |
| Level-up bonus | +20 × levels gained |

Bots count for splats but pay **half** (+5) so farming bots is slow — real players are the money.

### Prices (one-time unlocks, kept on your account)
| Thing | Cost |
|------|------|
| Better weapons | 400 (rifle) → 2,000 (rocket); most 800–1,500 |
| Weapon mod — Magazine | 900 |
| Weapon mod — Scope | 1,300 |
| Weapon mod — Buckshot | 1,100 |
| Chip — Light Plating | 500 |
| Chip — Heavy Plating | 1,800 |
| Chip — Ammo Pouch | 600 |
| Chip — Camo | 800 |
| Chip — Thermal / Gamma | 2,000 each |
| Chip — Satellite | 3,500 |

Starting wallet: **200** (one cheap upgrade, nothing close to a kit). A fully decked
endgame loadout ≈ **12,000–16,000 coins** — many hours of play, not a first session.

### Pacing example
At a decent ~2 splats + a win per ~2-min round ≈ ~110 coins/round ≈ ~3,000/hour.
- First better weapon or 2 light plates: ~½ hour.
- A weapon mod: ~½–1 hour each.
- Satellite / heavy multi-plate kit: many hours.

### Levels → weight capacity (the real gate)
XP only from splats. Capacity = `10 + floor(level/5) × 2`. Splats to reach each tier
(curve `req(L→L+1) = 2 + (L-1)`):

| Level | ~Total splats | Capacity | Feel |
|------|---------------|----------|------|
| 5  | ~14  | 12 | light kit |
| 10 | ~54  | 14 | class unlock; 2 mods + a few chips |
| 15 | ~120 | 16 | comfortable |
| 20 | ~210 | 18 | strong |
| 25 | ~325 | 20 | full 2 mods + 5 chips |
| 30+| ~470+| +2/5lv | headroom |

So you're **always trading off** under your cap (more bounce = slower; more paint =
slower) until levels slowly buy you the weight to run it all.

### Tournaments = the high-stakes pull
- Buy-in **$100 / $500 / $1,000** per player; starts when **everyone antes**.
- Pot = sum of all antes → **winning team splits the whole pot** (6 players × $1,000 = $6,000 to the winners). Losers forfeit their ante — real risk.
- During a tournament: **no splat/round coins** (already in) — the pot is the prize.
- Tournament splats pay **2× XP**, so it's the fastest way to level too.

This makes tournaments the main way to make (or lose) big money and to level fast,
while casual play is the steady grind.

> All of the above are single constants in code — easy to dial after playtests.

---

## 11. UPDATES from latest feedback (these override earlier sections)

### Weight = hard cap ONLY (no speed penalty)
- Carrying weight does **NOT** slow you down. It only counts against your **cap** —
  you simply can't equip past it. (Overrides §6 point 1.)
- **Heavy Plating is very heavy (weight 8)** so wearing it in all 5 slots is
  impossible until much higher levels. Revised weights:
  - Weapon 4 · Weapon mod 2–3 · Light Plating 3 · **Heavy Plating 8** · Ammo Pouch 2 · Camo 1 · Thermal/Gamma 3 · Satellite 4
- Capacity curve bumped so an all-heavy kit is reachable but very late:
  `capacity = 12 + floor(level/5) × 3`  (L1:12, L10:18, L25:27, L50:42, ~L57 for 5× heavy).

### Two new weapon mods (now 5 total; still 2 sockets, stackable)
- **Lightning** — big fire-rate boost, reduced range. (cost ~1,200, wt 2)
- **Golden Gun** — arm a single **golden bullet**: max range + fast-paint speed. After
  one shot it auto-reverts to normal; short cooldown before you can re-arm.
  (cost ~2,500, wt 3) — a key arms it; your next shot is golden.

### Golden Bot → Super Bot Invaders (special event)
- Any spawned bot has a **2% chance to be "Golden"** (gold-tinted).
- **Killing a Golden bot instantly ends the round** and launches **Super Bot Invaders**:
  **10 bots per player**, and every bot grants **double gold + double XP** when splatted.
- After the Super round resolves, normal rotation resumes.

### Bot Invaders escalation
- Each Bot Invaders round you **survive**, the next one spawns **more bots**
  (start 6/player, **+2/player per survived round**). **Lose one → resets to 6/player.**
- (Super Invaders is separate: always 10/player, double rewards.)

> Spec is now complete. Building server-side first, then the loadout UI; no deploy
> until both are done and tested together.

---

## 12. Bot Invaders = full co-op "zombies defense" mode

- **Unlimited ammo** in this mode (no round pool — survival is the point).
- **Wave escalation:** each wave you survive spawns more bots (start 6/player,
  +2/player per wave). **Wipe → resets to wave 1.** Wave count persists across the
  rotation until a loss.
- **Special bots scaling up:**
  - From ~wave 3, a growing fraction are **Fast** (≈1.6× speed).
  - **Every 5th wave**, a scaling fraction are **Super** (faster + take 2 hits), getting
    nastier each tier.
- **No Golden bots here** — Golden bots only appear in TDM/CTF; killing one there ends
  that round and launches **Super Bot Invaders** (10/player, 2× gold & XP), which is
  separate from the escalating wave count.

> Build order: (1) Bot-Invaders-zombies + Golden-bot event now (independent, shippable);
> (2) the full loadout/mod/weight/economy overhaul as a dedicated pass.
