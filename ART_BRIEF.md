# Gnomageddon — Sprite / Art Brief (image-gen ready)

This brief is built around how the engine actually renders, so generated art drops in cleanly and looks cohesive and modern (think *Brawl Stars / Clash Royale* polish — NOT pixel art, which reads as retro).

---

## How the engine uses these sprites (read first — it constrains the art)

- Characters are drawn **small in-game (~40 px)**, so the source must be **bold, high-contrast, with a clear silhouette** that reads at thumbnail size. Fine detail disappears.
- View is **3/4 top-down** (camera slightly above and in front), character **facing screen-RIGHT**. The engine **mirrors horizontally** to face left, so:
  - Hold the weapon **forward (to the right)**.
  - **No text, no asymmetric insignia, no eyepatch-on-one-side** — anything that looks wrong mirrored.
- **Transparent background (PNG)**, subject **centered**, **same square canvas for every sprite** (recommend **512×512**), and **consistent scale across the set** (relative sizes below). Don't crop tight — keep even margins so they line up.
- **Do not bake a hard ground shadow.** The engine adds a soft contact shadow + team-colored ground ring + lighting. A faint ambient shadow under the feet is fine.
- **Team color is added in code** (a blue/red ground ring + nameplate + soft outline). So design each gnome **team-neutral**: hat and tunic in a **warm neutral (cream / tan / muted brown / grey)**, NOT blue or red. (If you'd rather bake team identity, make 2 variants per class with a blue vs red hat — but neutral + code is half the art and stays consistent.)

## Global style line (paste into every prompt)

> 3/4 top-down view, facing right, full-body chibi garden gnome, chunky readable proportions, big head + stubby body, modern stylized 3D-cartoon render with soft global lighting and a gentle top rim light, smooth clean shading, vibrant but slightly muted storybook palette, thick clean forms, crisp silhouette, centered, transparent background, no ground, no text, game character sprite, high detail at small size

## Export specs (paste into your tool / cleanup step)

- PNG, **512×512**, transparent, subject centered, ~8% margin all sides.
- One file per class, named to match the engine: `Trooper.png`, `VetTrooper.png`, `HeavyWeapons.png`, `Scout.png`, `Infiltrator.png`, `Sniper.png`, `Engineer.png`, `Officer.png` (drop into `public/sprites/`).
- Keep the **same gnome "face/body language" family** across all 8 so they look like one game.

---

## The 8 classes (each = global style line + the line below)

**Relative size guide:** Heavy = biggest/widest, Scout & Infiltrator = smallest, others = medium. Keep heads similar; vary body bulk + gear.

1. **Trooper.png** — *the everyman recruit.*
   > a cheerful rookie garden gnome soldier, classic tall pointed felt hat (cream), round white beard, simple tunic, holding a chunky toy-like paintball gun pointed right, friendly determined face

2. **VetTrooper.png** — *grizzled veteran.*
   > an older battle-worn gnome sergeant, long grey beard, weathered pointed hat with a tiny patch, a scarf and a couple of acorn "medals", holding a sturdy paintball rifle pointed right, squinting confident expression, slightly scarred

3. **HeavyWeapons.png** — *the tank.* (biggest, widest)
   > a huge burly bear-sized gnome, thick chest, dented metal pot-helmet instead of a hat, heavy shoulder pads, gripping an oversized multi-barrel paint minigun with both hands pointed right, gruff grin

4. **Scout.png** — *fast & nimble.* (small)
   > a tiny lean speedy gnome, swept-back short hat, flight goggles on the forehead, light scout vest, little satchel, holding a small rapid paint pistol pointed right, mischievous grin, dynamic light pose

5. **Infiltrator.png** — *stealth.* (small)
   > a sneaky hooded gnome in a dark leafy cloak that hides the beard, hood up over the pointed hat, holding a slim blowpipe/dart launcher raised to the right, half-shadowed sly expression

6. **Sniper.png** — *long range.*
   > a patient gnome marksman in a mossy leaf-camo ghillie cloak with twigs, a long scoped paint rifle braced and pointed right, one eye to the scope, calm focused face

7. **Engineer.png** — *the builder/commander.*
   > a tinkerer gnome inventor, welding goggles pushed up on the hat, heavy tool-belt with wrenches and bolts, oil-smudged apron, a small wrench in one hand and a basic paint pistol in the other pointed right, clever busy expression

8. **Officer.png** — *command.*
   > a proud gnome commander, fancy tricorne-style decorated hat with a feather, epaulettes and a sash, gloved hand, holding a polished assault paint-rifle pointed right, chin up authoritative expression

## Support art

- **bot sprites (optional, 2–4):** same global line, generic plain gnome grunts (cream hat, no special gear, simple paint gun) — slight variety in beard/pose. Name `gnomebot1.png`, `gnomebot2.png`, etc. (If skipped, the engine reuses class sprites for bots.)
- **turret.png** — *deployable.* `top-down 3/4 view, a quirky garden contraption turret built from a flowerpot + brass nozzle + little gears on a small tripod, neutral metal/terracotta colors, no team color, transparent background, centered` (the engine tints it by ammo type and adds the team ring).
- **Terrain tiles** (seamless, 256×256, top-down, opaque — go in `public/tiles/`, the engine already biomes them): `plains` = mowed garden lawn / grass; `forest` = dense hedge / leafy canopy (top-down); `water` = a calm garden pond; `mountain` = grey rockery stones / boulders. Keep them **darker/lower-contrast than the characters** so gnomes pop on top.
- **Projectiles**: none needed — paint blobs + splats are drawn in code (and recolor per team/ammo).

## Logo / landing (separate, can be bigger/painterly)
- **Wordmark "GNOMAGEDDON"** + a hero scene of two gnome squads (one warm-neutral, the UI will theme team color) flinging paint across a garden battlefield, contraption turrets, comedic-epic tone. 16:9 for the landing hero, plus a square 512 app/icon version (one war gnome head + paint splat).

---

### TL;DR for the generator
Chibi garden gnomes, **3/4 top-down, facing right, weapon forward**, modern 3D-cartoon polish, **team-neutral colors**, **transparent centered 512×512**, **bold silhouette that reads tiny**, no baked shadow, consistent family across all 8. Generate, background-remove, drop into `public/sprites/` with the exact filenames above.
