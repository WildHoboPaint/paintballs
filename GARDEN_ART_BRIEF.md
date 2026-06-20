# Gnomageddon — Garden Map & Invaders Art Brief

The map layout is now garden-shaped in code (pond, hedge beds, rockery, raised beds, lawn paths). These art swaps make it *look* like a garden. Two kinds of art here: **terrain tiles** (seamless textures, no transparency) and the **invader pests** (green-screen sprite sheet, like the gnomes).

---

## A) Terrain tiles  (drop into `public/tiles/`)

**Format for ALL tiles:** top-down (straight down), **seamless / tileable**, **256×256 PNG, opaque** (no transparency, no characters, no props). Keep them a touch **darker and lower-contrast than the gnomes** so the characters pop on top. Each terrain can have up to 3 variants (`name.png`, `name2.png`, `name3.png`) — the engine randomly mixes them; 1 is fine, 3 looks richer.

Global line to paste: `seamless tileable top-down garden ground texture, flat overhead view, soft even lighting, modern stylized game art, no shadows from objects, no characters`

| File(s) | What it is | Prompt add-on |
|---|---|---|
| `grass.png` (+2,+3) | **Lawn** (the main walkable ground) | freshly mown green lawn with subtle mower stripes and tiny clover, healthy vibrant grass |
| `water.png` (+2,+3) | **Garden pond** | clear shallow garden pond water, gentle ripples, hints of pebbles below the surface, calm |
| `mountain.png` (+2,+3) | **Rockery** (cover, high ground) | clustered grey garden rockery stones and pebbles, mossy edges, packed rock garden |
| `wasteland.png` (+2,+3) | **Soil / dirt bed** | dark tilled garden soil, fine bark-mulch texture, a few small stones |
| `hill.png` (+2,+3) | **Raised bed / mound** | raised garden bed soil mound edged with low timber, slightly lighter than flat soil |
| `tree.png` | **Bush overlay** (scattered + hedge beds) — **THIS ONE is transparent** | a single round leafy garden shrub/bush seen from 3/4 top-down, lush green, transparent background, centered, no ground |

Note: "forest" in-engine = lawn + this `tree.png` bush on top, so a good bushy `tree.png` is what sells the hedges.

---

## B) Invader pests  (green-screen sheet → I cut, like the gnomes)

These replace the enemy bots in **Bot Invaders** mode — the garden is being overrun by pests. Same look discipline as the gnomes so they sit in the same world.

**Format:** one image, **4×2 grid (or a row), flat bright chroma-green (#00b140) background**, each pest **3/4 top-down, facing RIGHT**, **same modern 3D-cartoon style/lighting as the gnome squad**, centered with even spacing, bold readable silhouette, menacing-but-cute, slightly grubby/villainous palette (browns, sickly greens, chitinous black, wasp yellow).

Pests (6–8): 1) big armored **beetle**, 2) **wasp/hornet** (low hover), 3) **slug**, 4) **snail** (shell), 5) fat **caterpillar/grub**, 6) **spider**, 7) **stink bug**, 8) **fire ant**. Each roughly chest-high to a gnome (the engine scales them).

> Prompt: a 4×2 grid sprite sheet of cartoon garden PEST monsters in one consistent modern 3D-cartoon style, 3/4 top-down view each facing right, on a flat solid bright chroma-green (#00b140) background, even spacing, menacing-but-cute, grubby villain palette: armored beetle, hovering wasp, slug, shelled snail, fat grub, spider, stink bug, fire ant. Bold readable silhouettes, no text.

Send me that sheet and I'll cut/center/name them and wire them in as the invaders (so Bot Invaders becomes "defend the garden from the swarm").

---

## C) Props (optional, later — nice-to-have polish)
Green-screen, top-down 3/4, transparent after cut: low **wooden picket-fence** segment, a **garden shed**, a **wheelbarrow**, a **watering can**, **terracotta pots**, a classic **lawn-gnome statue**, **stepping stones**. We can scatter these as non-blocking decals once the core tiles + pests are in.

### Order I'd do it in
1. `grass.png` + `tree.png` (lawn + bush) — biggest visual change for two files.
2. `water.png`, `mountain.png`, `hill.png`, `wasteland.png`.
3. Pest sheet → invaders.
4. Props.
