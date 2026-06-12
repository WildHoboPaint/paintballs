# Art assets — drop your tile/store images here (public/tiles/)

The game auto-loads these. Any file you don't provide falls back to the built-in
(programmer-art) drawing, so you can add them one at a time. Re-render is automatic.

Filenames must be **lowercase, exactly as listed**.

---

## 1) Terrain ground tiles

- **Format:** PNG, **square, 64×64 px** (128×128 also fine — sharper, larger files)
- **Opaque** (no transparency needed — these are full ground tiles)
- **Seamless / tileable:** edges should match so a field of them shows no grid seams.
  *(If you can't make them seamless, tell me — I'll add per-tile rotation/jitter to hide repetition.)*

| File | Terrain | Notes |
|------|---------|-------|
| `grass.png`     | Plains    | Base green ground |
| `forest.png`    | Forest    | Trees on grass (the clustered look) — conceals players |
| `water.png`     | Water     | Slows movement |
| `mountain.png`  | Mountain  | Rock — also used for the lobby border |
| `hill.png`      | Hills     | Raised ground (see over forest, not mountains) |
| `wasteland.png` | Wasteland | Dry/dead patch — cosmetic, plays like plains |

**Optional variety:** add `grass2.png`, `grass3.png`, `forest2.png`, etc. (same size).
I'll randomly mix variants per tile so the map doesn't look repetitive.

---

## 2) Store buildings (the two shops in the lobby)

- **Format:** PNG with **transparent background**, **256×256 px**
- Top-down or 3/4 view of a small building/stall

| File | Store |
|------|-------|
| `armory.png`     | Armory — weapons & ammo |
| `equipment.png`  | Equipment — armor, optics, camo, gadgets |

---

## 3) Optional extras (nice to have, add anytime)

- `tent.png` — spawn-camp tent, transparent, ~128×128 (decoration at team bases)
- `flag_blue.png` / `flag_red.png` — transparent, ~96×96 (for the future Capture-the-Flag mode)
- `dirt.png` / `path.png` — extra ground variety, 64×64 seamless

---

### Tips
- The player avatar is ~one tile (≈40 px) on screen, so a 64×64 source tile looks crisp.
- Drop files in, then hard-refresh the browser (Ctrl+F5). No restart needed for art-only changes.
- Sprites (characters) live in `public/sprites/`; tiles live here in `public/tiles/`.
