/* ============================================================
   HIGH VELOCITY PAINTBALL — authoritative game logic (server-side)
   Round-based elimination + terrain LOS + economy.
   Progression: everyone starts as TROOPER, earns XP by splatting,
   and unlocks class selection at level 10 (each level costs more splats).
   Modern, simple loadout: buy + equip one item per category
   (weapon / armor / vision / camo / gadget / ammo).
   Mechanics: armor damage reduction, camo + vision vs terrain,
   deployable mines & turrets, jetpack, weapon & ammo variety.
   Pure logic: no networking, no DOM. Unit-testable.
   ============================================================ */
'use strict';
const crypto = require('crypto');

const ARENA = { w: 3000, h: 2200 };   // mutated each round to scale with player count
const TILE  = 32;                     // small terrain blocks (~one player square)
const PLAIN=0, FOREST=1, WATER=2, MOUNT=3, WASTE=4, HILL=5;
const SPEED_MULT = { 0:1.0, 1:0.6, 2:0.55, 3:0.4, 4:1.0, 5:0.5 };  // waste=plains, hill between forest & mountain
const SPEED_SCALE = 0.40;        // global slowdown: deliberate, near block-by-block movement
const PROX = 150;                // how close before you're spotted regardless of cover
function arenaSizeFor(humans){ const n=Math.max(2,humans||0); return { w:Math.min(4200, 2600+n*160), h:Math.min(3200, 1900+n*120) }; }
// ---- between-round lobby (a small circular plains room ringed by mountains) ----
const LOBBY = { w: 560, h: 560 };
const LOBBY_ZONES = [
  { id:'armory', name:'Armory',    x:110, y:200, w:90, h:90 },
  { id:'equip',  name:'Equipment', x:360, y:200, w:90, h:90 },
];
const LOBBY_SPEED = 120;

// economy / rounds
const NEW_WALLET=200, SPLAT_REWARD=10, BOT_SPLAT_REWARD=5, ROUND_WIN_BONUS=60, SURVIVOR_BONUS=25;
const BUY_IN=100, SHOP_TIME=25, ROUND_TIME=120, TEAM_SIZE=5;
const MODES=['tdm','ctf','invaders'];                 // casual rounds pick one at random
const MODE_NAMES={tdm:'Team Deathmatch', ctf:'Capture the Flag', invaders:'Bot Invaders', tournament:'Tournament'};
const BOTS_PER_PLAYER=6;                               // Bot Invaders base swarm/wave
const INV_STEP=2;                                      // +bots per player each survived wave
const GOLD_BOT_CHANCE=0.02;                            // chance a TDM/CTF bot is Golden
const ENG_COST={ bot:75, pellet_turret:150, grenade_turret:250, rocket_turret:350 };   // Engineer field-store prices (cheap; reset each round)
const ENG_STORE_UP={ 2:400, 3:900 };                   // store upgrade costs (raises bot cap)
const MORTAR_SHOTS=3, MORTAR_SPLASH=130, TURRET_HP=3;
const SUPER_BOTS_PER_PLAYER=10;                        // Super Bot Invaders (golden trigger)
const FAST_SPD_MUL=1.6;                                // fast bot speed multiplier
const BOT_BONUS=10;                                    // coins per bot splatted (invaders survival reward)
const CAPTURE_TARGET=3;                                // CTF captures to win
const TOURNEY_WINS=3;                                  // best of 5
const ANTE_OPTIONS=[100,500,1000];                    // selectable buy-in amounts
const WMOD_SLOTS=2, CHIP_SLOTS=5, MAX_CAMO=2, BASE_AMMO=30, WEAPON_WT=4, BALL_SPEED=150, GOLDEN_CD=2.0;
const LAST_GASP=2.0;   // seconds you can still return fire after being hit (draw / double-splat window)
const MAXTIER=5, BOT_TIER=3, SNIPER_BLIND=160; const TIER_COST={2:600,3:1200,4:2000,5:3000};   // weapon upgrade tiers
const HEAVY_CLASSES=['VetTrooper','HeavyWeapons','Officer'];
function weightCapacity(level){ return 10 + Math.floor(level/3)*2; }   // higher cap so two guns are viable; rewards leveling
function modW(list){ let w=0; for(const m of (list||[])){ const d=WEAPON_MODS[m]; if(d) w+=d.wt||0; } return w; }
const LEVELUP_BONUS=20;                 // coins per level gained
const BUILD='hvpb-2026.06.14.54';        // bump on each change; shown in-game to verify deploys

// progression
const CLASS_UNLOCK_LEVEL=10, LVL_BASE=2, LVL_STEP=1;
const CLASS_UNLOCK={Trooper:1,Sniper:10,Infiltrator:10,Scout:10,VetTrooper:25,Engineer:35,HeavyWeapons:50,Officer:80};
function xpCum(L){ return L<=1?0:Math.round(0.5*Math.pow(L-1,2.05)); }   // total splats to REACH level L (fast early, slow later)
function levelInfo(xp){ let lvl=1; while(lvl<99 && xp>=xpCum(lvl+1)) lvl++; const base=xpCum(lvl), nxt=xpCum(lvl+1); return { level:lvl, into:xp-base, need:Math.max(1,nxt-base) }; }

// ---- classes: base body stats + which weapons/gear they may equip ----
const CLASSES = {
  Trooper:    { hp:100, speed:185, color:'#cbd5e1', defWeapon:'pball_gun',
                weapons:['pball_gun','pball_rifle','shotgun'], gear:['mine'],
                desc:"Starter all-rounder. Everyone begins here." },
  VetTrooper: { hp:115, speed:185, color:'#7dd3fc', defWeapon:'pball_rifle', ult:'laststand', ultWeapon:'pball_rifle',
                weapons:['pball_gun','pball_rifle','assault_rifle','grenade_launcher','shotgun'], gear:['mine','turret'],
                desc:"Seasoned trooper. Better gear access." },
  HeavyWeapons:{hp:175, speed:130, color:'#ff8c42', defWeapon:'minigun',
                weapons:['minigun','bazooka','grenade_launcher','shotgun','pball_rifle'], gear:['mine'],
                desc:"Walking tank. Minigun & bazooka, heavy armor." },
  Scout:      { hp:80,  speed:240, color:'#9b5de5', defWeapon:'auto_pistol', ult:'speed', ultWeapon:'pest_control',
                weapons:['pest_control','auto_pistol','pball_gun'], gear:['jetpack','mine'],
                desc:"Fast recon. Vision gear & jetpack." },
  Infiltrator:{ hp:90,  speed:205, color:'#06d6a0', defWeapon:'blowgun', ult:'invis', ultWeapon:'blowgun',
                weapons:['blowgun','auto_pistol','pball_gun'], gear:['mine','decoy'],
                desc:"Silent stealth. Camo, blowgun, mines." },
  Sniper:     { hp:80,  speed:160, color:'#ef476f', defWeapon:'sniper_rifle', ult:'evac', ultWeapon:'sniper_rifle',
                weapons:['sniper_rifle','pball_rifle'], gear:['mine'],
                desc:"Long-range one-shot specialist." },
  Engineer:   { hp:115, speed:170, color:'#ffd166', defWeapon:'pball_gun', ult:'mortar',
                weapons:['pball_gun'], gear:['turret'],
                desc:"Field commander. Build turrets (G), call in bots, man the Mortar (Space)." },
  Officer:    { hp:120, speed:185, color:'#3da9fc', defWeapon:'assault_rifle',
                weapons:['assault_rifle','auto_pistol','pball_rifle'], gear:['turret'],
                desc:"Command. Satellite vision, assault rifle." },
};
const CLASS_KEYS = Object.keys(CLASSES);

// ---- catalog (modern, flat). cost 0 = free/default. classes:'all' or list. ----
const WEAPONS = {
  pball_gun:    { name:"Paintball Gun",    cost:0,    dmg:1, fireRate:950, spread:0.05, mag:25, range:260, reload:1.6, proj:1, desc:"Short range starter — upgrade to reach further." },
  pball_rifle:  { name:"Paintball Rifle",  cost:350,  dmg:1, fireRate:680, spread:0.035,mag:25, range:420, reload:1.7, proj:1, desc:"More range and a steadier shot." },
  assault_rifle:{ name:"Assault Rifle",    cost:1000, dmg:1, fireRate:360, spread:0.06, mag:30, range:380, reload:1.9, proj:1, desc:"Rapid fire, medium range." },
  sniper_rifle: { name:"Sniper Rifle",     cost:1200, dmg:1, fireRate:1500,spread:0.004,mag:10, range:1200, pspeed:340, reload:2.0, proj:1, scope:true, desc:"Sees across the map (no terrain in the way) but blind up close. Very slow fire." },
  minigun:      { name:"Minigun",          cost:1500, dmg:1, fireRate:190, spread:0.12, mag:50, range:340, reload:3.0, proj:1, desc:"Torrent of paint, short range." },
  bazooka:      { name:"Rocket Launcher",  cost:1500, dmg:1, fireRate:2800,spread:0.03, mag:5,  range:600, reload:2.8, proj:1, splash:140, pspeed:200, desc:"Very slow to move & fire — huge area splat, blocked by terrain." },
  grenade_launcher:{ name:"Grenade Launcher", cost:1300, dmg:1, fireRate:1600, spread:0.05, mag:5, range:360, reload:2.4, proj:1, splash:48, pspeed:110, lob:true, desc:"Lobbed grenade — very slow, flies over terrain, ~3-tile splat." },
  shotgun:      { name:"Shotgun",          cost:800,  dmg:1, fireRate:1000, spread:0.32, mag:15, range:190, reload:1.9, proj:3, desc:"3-pellet spread, very short range." },
  blowgun:      { name:"Blowgun",          cost:600,  dmg:1, fireRate:450, spread:0.025,mag:20, range:360, reload:1.5, proj:1, silent:true, color:"#ff5fa2", desc:"Silent pink darts, fast and medium range." },
  auto_pistol:  { name:"Auto Pistol",      cost:500,  dmg:1, fireRate:480, spread:0.05, mag:20, range:250, reload:1.2, proj:1, desc:"Quick, light, short range." },
  pest_control: { name:"Pest Control",     cost:0,    dmg:1, fireRate:950, spread:0,    mag:999,range:66,  reload:0.1, proj:1, melee:true, desc:"Scout melee: one-square reach vs players. Auto-splats nearby bots; upgrades extend that range and boost your speed." },
};
const WEAPON_MODS = {
  magazine: { name:"Magazine",    cost:900,  wt:2, ammo:30, desc:"+30 paintballs to your round pool." },
  buckshot: { name:"Buckshot",    cost:1100, wt:2, proj:3, spreadAdd:0.26, rangeMul:0.6, fireMul:1.6, ammoMul:3, desc:"3-pellet spread; short range; slow fire; 3x ammo per shot." },
  scope:    { name:"Scope",       cost:1300, wt:2, rangeMul:1.5, fireMul:1.3, desc:"+50% range; slower fire." },
  lightning:{ name:"Lightning",   cost:1200, wt:2, fireMul:0.55, rangeMul:0.7, desc:"Much faster fire; shorter range." },
  golden:   { name:"Golden Gun",  cost:2500, wt:3, golden:true, desc:"Arm a golden bullet (F): max range + fast, one shot then reverts." },
};
const ARMOR_CHIPS = {
  light_plate: { name:"Light Plating", cost:500,  wt:3, deflect:0.08, desc:"+8% bounce chance. Anyone." },
  heavy_plate: { name:"Heavy Plating", cost:1800, wt:8, deflect:0.14, heavy:true, desc:"+14% bounce; very heavy. Vet/Heavy/Officer only." },
  ammo_pouch:  { name:"Ammo Pouch",    cost:600,  wt:2, ammo:30, desc:"+30 paintballs to your round pool." },
  camo:        { name:"Camo",          cost:800,  wt:1, camo:true, desc:"Hides you on the enemy minimap — but only while on your chosen terrain (set it in the loadout)." },
  thermal:     { name:"Thermal Optics",cost:2000, wt:3, reveal:'mountain', desc:"See through mountains (line of sight)." },
  gamma:       { name:"Gamma Optics",  cost:2000, wt:3, reveal:'forest', desc:"See through forest (line of sight)." },
  satellite:   { name:"Satellite",     cost:3500, wt:4, reveal:'both', sat:true, desc:"See enemies on the minimap (beaten by Camo)." },
};
const GADGETS = {
  none:   { name:"No Gadget",  cost:0,    desc:"Empty gadget slot." },
  mine:   { name:"Paint Mines",cost:300,  charges:2, desc:"Press G to drop. Detonates on enemies (2/round)." },
  turret: { name:"Turret Kit",cost:0, desc:"Build a turret with G (1 at a time). Engineer picks Pellet/Grenade/Rocket in the round; Vet gets a Pellet turret." },
  jetpack:{ name:"Jetpack",    cost:1500, passive:true, desc:"Ignore terrain slowdown (passive)." },
  decoy:  { name:"Decoy",      cost:400,  charges:2, desc:"Press G to drop a fake clone (2/round)." },
};
const AMMO = {
  fast: { name:"Fast Paint", cost:700, shots:75, speedMul:1.8, color:'#ef4444', desc:"Paint flies much faster, harder to dodge. Consumable (~3 clips), then rebuy." },
};
const CATALOG = { weapon:WEAPONS, wmod:WEAPON_MODS, chip:ARMOR_CHIPS, gadget:GADGETS, ammo:AMMO };
const CATS = Object.keys(CATALOG);

// special ammo is consumable: a purchase grants this many shots, then you must rebuy
const AMMO_STOCK = { fast:60, ap:40 };
// paint colors by type: normal green, fast red, AP dark blue, grenades/rockets teal
const PAINT = { normal:'#22c55e', fast:'#ef4444', ap:'#1e40af', splash:'#2dd4bf' };
function paintColor(w, ammoId){ if(w && w.splash) return PAINT.splash; return PAINT[ammoId] || PAINT.normal; }

// ---- helpers ----
const rand=(a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const dist2=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};
const p_ready=(f)=>f.ready!==false;

function buildObstacles(){ const t=40; return [
  {x:0,y:0,w:ARENA.w,h:t,wall:true},{x:0,y:ARENA.h-t,w:ARENA.w,h:t,wall:true},
  {x:0,y:0,w:t,h:ARENA.h,wall:true},{x:ARENA.w-t,y:0,w:t,h:ARENA.h,wall:true} ]; }

function generateTerrain(){
  const cols=Math.floor(ARENA.w/TILE), rows=Math.floor(ARENA.h/TILE);
  const g=Array.from({length:rows},()=>new Array(cols).fill(PLAIN));
  const half=Math.floor(cols/2);
  const blob=(cx,cy,r,type)=>{ for(let y=0;y<rows;y++) for(let x=0;x<half;x++){
    if(Math.hypot(x-cx,y-cy)<=r+(Math.random()*1.2-0.5)) g[y][x]=type; } };
  const dens=(cols*rows)/(50*38);                 // scale terrain count with map size
  const groups=[{n:Math.max(3,Math.round(6*dens)),r:[1.5,3],t:FOREST},{n:Math.max(2,Math.round(2.5*dens)),r:[1.6,2.8],t:MOUNT},{n:Math.max(3,Math.round(3*dens)),r:[1.6,2.8],t:WATER},{n:Math.max(3,Math.round(3*dens)),r:[1.6,2.8],t:HILL},{n:Math.max(3,Math.round(2.5*dens)),r:[2,3.4],t:WASTE}];
  for(const b of groups) for(let i=0;i<b.n;i++) blob(rand(3,half-2),rand(2,rows-2),rand(b.r[0],b.r[1]),b.t);   // every terrain forms several distinct sections
  for(let pass=0;pass<2;pass++) for(let y=0;y<rows;y++) for(let x=0;x<half;x++){ const t=g[y][x]; if(t===PLAIN||t===FOREST) continue;   // dissolve lone tiles into plains (areas only; forest stays scattered trees)
    let same=0; if(y>0&&g[y-1][x]===t)same++; if(y<rows-1&&g[y+1][x]===t)same++; if(x>0&&g[y][x-1]===t)same++; if(x<half-1&&g[y][x+1]===t)same++;
    if(same===0) g[y][x]=PLAIN; }
  for(let y=0;y<rows;y++) for(let x=0;x<4;x++) g[y][x]=PLAIN;          // clear spawn columns
  for(let y=0;y<rows;y++) for(let x=0;x<half;x++) g[y][cols-1-x]=g[y][x]; // mirror for fairness
  return { grid:g, cols, rows, tile:TILE };
}

function segSeg(a,b,c,d,p,q,r,s){ const d1=(r-p)*(b-q)-(s-q)*(a-p),d2=(r-p)*(d-q)-(s-q)*(c-p),d3=(c-a)*(q-b)-(d-b)*(p-a),d4=(c-a)*(s-b)-(d-b)*(r-a); return ((d1>0)!==(d2>0))&&((d3>0)!==(d4>0)); }

function walletKey(name){ const k=(name||'').toLowerCase().replace(/\s+/g,' ').trim(); return k.length?k:null; }
let NAMEI=0;
const BOTNAMES=['Vortex','Reaper','Splat','Ghost','Maverick','Nitro','Blaze','Frost','Hazard','Echo','Rogue','Viper','Comet','Dash','Surge','Onyx','Pixel','Talon'];

class Game {
  constructor(saved){
    this.obstacles=buildObstacles();
    const T=generateTerrain(); this.grid=T.grid; this.tcols=T.cols; this.trows=T.rows; this.terrainMeta={cols:T.cols,rows:T.rows,tile:TILE};
    this.players=new Map(); this.bots=[]; this.balls=[]; this.mines=[]; this.turrets=[]; this.decoys=[]; this.stores=[];
    this.events=[]; this.nextId=1;
    this.roundsWon={blue:0,red:0}; this.pot=0; this.mode='tdm'; this.tournament=false; this.flags=[]; this.caps={blue:0,red:0};
    this.invWave=1; this.invSession=false; this.superNext=false; this.superRound=false; this.doubleRewards=false; this.goldenEnded=false; this._endGrace=0;
    this.wallets=(saved&&saved.wallets)?Object.assign({},saved.wallets):{};
    this.tiers=(saved&&saved.tiers)?Object.assign({},saved.tiers):{};   // account key -> { weaponId: tier }
    this.classTiers=(saved&&saved.classTiers)?Object.assign({},saved.classTiers):{};   // account key -> { className: tier }
    this.storeLevels=(saved&&saved.storeLevels)?Object.assign({},saved.storeLevels):{};   // Engineer store level (raises bot cap)
    this.prefs=(saved&&saved.prefs)?Object.assign({},saved.prefs):{};   // account key -> { cls, equip, modeVotes } (persist across logins)
    this.waveRecord=(saved&&saved.waveRecord)?saved.waveRecord:{wave:0,name:''};   // highest Bot Invaders wave + who reached it
    this.ammoStock=(saved&&saved.ammoStock)?Object.assign({},saved.ammoStock):{};   // key -> { fast: shots } consumable special ammo
    this.lifeStats=(saved&&saved.lifeStats)?Object.assign({},saved.lifeStats):{};   // key -> { splats, psplats, shots, name } permanent leaderboard
    this.inv=(saved&&saved.inv)?Object.assign({},saved.inv):{};         // account key -> { 'wmod:scope':2, 'chip:camo':1 }
    if(!(saved&&saved.inv)){ for(const k in this.owned){ for(const s of (this.owned[k]||[])){ if(s.indexOf('wmod:')===0||s.indexOf('chip:')===0){ (this.inv[k]||(this.inv[k]={}))[s]=1; } } } }
    this.owned  =(saved&&saved.owned)  ?Object.assign({},saved.owned)  :{};   // key -> ["weapon:assault_rifle", ...]
    this.xp     =(saved&&saved.xp)     ?Object.assign({},saved.xp)     :{};   // key -> total splats
    this.accounts=(saved&&saved.accounts)?Object.assign({},saved.accounts):{};   // username key -> {salt,hash,name}
    this.phase='intermission'; this.phaseTimer=8; this.roundTimer=ROUND_TIME; this.roundNum=0; this.clock=0;
  }

  // ---- terrain ----
  terrainCode(x,y){ const tx=clamp(Math.floor(x/TILE),0,this.tcols-1),ty=clamp(Math.floor(y/TILE),0,this.trows-1); return this.grid[ty][tx]; }

  // ---- economy / progression ----
  getMoney(p){ return p.bot?0:(this.wallets[p.key]??0); }
  addMoney(p,a){ if(p.bot||!p.key) return; this.wallets[p.key]=(this.wallets[p.key]??0)+a; }
  getXp(p){ return p.bot?0:(this.xp[p.key]??0); }
  getLevel(p){ return p.bot? 99 : levelInfo(this.getXp(p)).level; }
  ownedSet(key){ return this.owned[key]||(this.owned[key]=[]); }
  owns(p,cat,id){ const def=CATALOG[cat][id]; if(def&&def.cost===0) return true;
    if(cat==='weapon'&&CLASSES[p.cls]&&CLASSES[p.cls].defWeapon===id) return true;   // class default weapon is free
    if(p.bot) return false;
    if(cat==='wmod'||cat==='chip') return (((this.inv[p.key]||{})[cat+':'+id])||0)>0;
    return this.ownedSet(p.key).includes(cat+':'+id); }
  invCount(p,catid){ return ((this.inv[p.key]||{})[catid])||0; }
  serialize(){ return { wallets:this.wallets, owned:this.owned, xp:this.xp, accounts:this.accounts, tiers:this.tiers, inv:this.inv, classTiers:this.classTiers, storeLevels:this.storeLevels, prefs:this.prefs, waveRecord:this.waveRecord, ammoStock:this.ammoStock, lifeStats:this.lifeStats }; }
  savePrefs(p){ if(!p||p.bot||!p.key) return; this.prefs[p.key]={ cls:p.cls, equip:{weapon:p.equip.weapon,wmods:(p.equip.wmods||[]).slice(),chips:(p.equip.chips||[]).slice(),gadget:p.equip.gadget,weapon2:p.equip.weapon2||null,wmods2:(p.equip.wmods2||[]).slice(),camoTerrain:(p.equip.camoTerrain==null?1:p.equip.camoTerrain)}, modeVotes:Object.assign({},p.modeVotes||{}) }; }
  restorePrefs(f){ const pr=this.prefs[f.key]; if(!pr) return;
    if(pr.cls && CLASSES[pr.cls] && this.getLevel(f)>=(CLASS_UNLOCK[pr.cls]||1)) f.cls=pr.cls;
    if(pr.modeVotes) f.modeVotes=Object.assign({},pr.modeVotes);
    f.equip=this.defaultEquip(f.cls); const e=pr.equip||{}, inv=this.inv[f.key]||{};
    if(e.weapon && CATALOG.weapon[e.weapon] && this.owns(f,'weapon',e.weapon) && this.canEquip(f,'weapon',e.weapon)) f.equip.weapon=e.weapon;
    const wc={}, wmods=[]; for(const m of (e.wmods||[])){ if(!WEAPON_MODS[m])continue; const k='wmod:'+m; wc[k]=(wc[k]||0)+1; if(wc[k]<=(inv[k]||0)&&wmods.length<WMOD_SLOTS) wmods.push(m); }
    const cc={}, chips=[]; let camo=0; for(const c of (e.chips||[])){ if(!ARMOR_CHIPS[c]||!this.canEquip(f,'chip',c))continue; const k='chip:'+c; cc[k]=(cc[k]||0)+1; if(cc[k]<=(inv[k]||0)&&chips.length<CHIP_SLOTS){ if(ARMOR_CHIPS[c].camo){ if(camo>=MAX_CAMO)continue; camo++; } chips.push(c); } }
    const gad=(e.gadget&&CATALOG.gadget[e.gadget]&&this.owns(f,'gadget',e.gadget)&&this.canEquip(f,'gadget',e.gadget))?e.gadget:'none';
    let w2=null; if(e.weapon2 && CATALOG.weapon[e.weapon2] && this.owns(f,'weapon',e.weapon2) && this.canEquip(f,'weapon',e.weapon2)) w2=e.weapon2;
    const w2c={}, wmods2=[]; if(w2) for(const m of (e.wmods2||[])){ if(!WEAPON_MODS[m])continue; const k='wmod:'+m; w2c[k]=(w2c[k]||0)+1; if(w2c[k]<=(inv[k]||0)&&wmods2.length<WMOD_SLOTS) wmods2.push(m); }
    const cap=weightCapacity(this.getLevel(f));
    const tw=()=>this.stats({cls:f.cls,equip:{weapon:f.equip.weapon,wmods,chips,gadget:gad}}).weight + (w2?(WEAPON_WT+modW(wmods2)):0);
    while(tw()>cap){ if(wmods2.length) wmods2.pop(); else if(w2){ w2=null; } else if(chips.length) chips.pop(); else if(wmods.length) wmods.pop(); else break; }
    f.equip={weapon:f.equip.weapon,wmods,chips,gadget:gad,ammo:'none',weapon2:w2,wmods2:(w2?wmods2:[]),camoTerrain:(e.camoTerrain==null?1:e.camoTerrain)};
    f.mineCharges=(GADGETS[gad]&&GADGETS[gad].charges)||0; f.decoyCharges=gad==='decoy'?GADGETS.decoy.charges:0; }
  tierOf(p,wid){ if(p.bot) return BOT_TIER; const m=this.tiers[p.key]; return (m&&m[wid])||1; }
  upgradeWeapon(id,wid){ const p=this.players.get(id); if(!p||p.bot) return {ok:false}; if(this.phase==='active' && p.alive) return {ok:false,msg:'Locked during the round.'}; if(!WEAPONS[wid]) return {ok:false,msg:'no such weapon'};
    if(!this.owns(p,'weapon',wid)) return {ok:false,money:this.getMoney(p),msg:'Unlock the weapon first'};
    const m=this.tiers[p.key]||(this.tiers[p.key]={}); const cur=m[wid]||1;
    if(cur>=MAXTIER) return {ok:false,money:this.getMoney(p),tiers:m,msg:'Already max tier'};
    const tgt=cur+1, cost=(wid==='pball_gun')?0:(TIER_COST[tgt]||9999), lvlReq=(tgt-1)*3;
    if(this.getLevel(p)<lvlReq) return {ok:false,money:this.getMoney(p),tiers:m,msg:`Reach Lv ${lvlReq} (more splats) first`};
    if(this.getMoney(p)<cost) return {ok:false,money:this.getMoney(p),tiers:m,msg:'Not enough Paint Coins'};
    this.addMoney(p,-cost); m[wid]=tgt;
    const st=this.stats(p); p.maxhp=st.hp; if(this.phase!=='active') p.ammo=Math.min(p.ammo,st.ammoPool);
    this.emit({type:'msg',text:`${p.name} upgraded ${WEAPONS[wid].name} to Tier ${tgt}!`});
    return {ok:true,money:this.getMoney(p),tiers:m,msg:`Tier ${tgt}`}; }
  registerAccount(name,pass){ const key=walletKey(name); if(!key) return {ok:false,msg:'Enter a username'};
    if((name||'').trim().length<2) return {ok:false,msg:'Username must be 2+ characters'};
    if(!pass||pass.length<4) return {ok:false,msg:'Password must be 4+ characters'};
    if(this.accounts[key]) return {ok:false,msg:'Username already taken — use Log In'};
    const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync(pass,salt,64).toString('hex');
    this.accounts[key]={salt,hash,name:name.trim().slice(0,16),created:Date.now()};
    if(this.wallets[key]===undefined) this.wallets[key]=NEW_WALLET;
    if(this.owned[key]===undefined) this.owned[key]=[];
    if(this.xp[key]===undefined) this.xp[key]=0;
    return {ok:true,key}; }
  loginAccount(name,pass){ const key=walletKey(name); if(!key) return {ok:false,msg:'Enter a username'};
    const a=this.accounts[key]; if(!a) return {ok:false,msg:'No account with that name — Create Account'};
    let ok=false; try{ const h=crypto.scryptSync(pass||'',a.salt,64).toString('hex'); ok=(h.length===a.hash.length)&&crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(a.hash,'hex')); }catch(e){ ok=false; }
    if(!ok) return {ok:false,msg:'Wrong password'};
    return {ok:true,key}; }

  // ---- effective stats ----
  weaponOf(p){ return WEAPONS[p.equip.weapon] || WEAPONS[CLASSES[p.cls].defWeapon]; }
  deflectChance(p){ let d=0; for(const c of (p.equip.chips||[])){ const cd=ARMOR_CHIPS[c]; if(cd&&cd.deflect) d+=cd.deflect; } return Math.min(0.8,d); }
  stats(p){
    const cls=CLASSES[p.cls]; const w=this.weaponOf(p);
    let fireRate=w.fireRate, range=w.range, spread=w.spread, proj=w.proj||1, mag=w.mag, reload=w.reload;
    const _T=this.tierOf(p,p.equip.weapon); fireRate*=(1+(MAXTIER-_T)*0.15); range*=(1-(MAXTIER-_T)*0.08);   // tier: faster fire + longer range as you upgrade
    let botReach=0;
    if(w.melee){ range=Math.round(1.05*TILE); fireRate=w.fireRate; botReach=(1.2+(_T-1)*0.55)*TILE; }   // Pest Control: fixed ~1-square reach vs players; upgrades grow the bot auto-splat aura
    let ammoMul=1, ammoPool=BASE_AMMO, golden=false, weight=WEAPON_WT;
    const _vet=(p.cls==='VetTrooper')?Math.min(0.4,(this.classTierOf(p)-1)*0.10):0;   // veteran: each class tier shaves mod downsides (up to -40% at T5)
    for(const m of (p.equip.wmods||[])){ const md=WEAPON_MODS[m]; if(!md) continue; weight+=md.wt||0;
      if(md.ammo) ammoPool+=md.ammo;
      if(md.rangeMul){ let rm=md.rangeMul; if(_vet>0&&rm<1) rm+=(1-rm)*_vet; range*=rm; }
      if(md.fireMul){ let fm=md.fireMul; if(_vet>0&&fm>1) fm-=(fm-1)*_vet; fireRate*=fm; }
      if(md.proj) proj=md.proj; if(md.spreadAdd){ let sa=md.spreadAdd; if(_vet>0) sa*=(1-_vet); spread+=sa; } if(md.ammoMul) ammoMul*=md.ammoMul; if(md.golden) golden=true; }
    let deflect=0, reveal=null, sat=false, camoN=0;
    for(const c of (p.equip.chips||[])){ const cd=ARMOR_CHIPS[c]; if(!cd) continue; weight+=cd.wt||0;
      if(cd.deflect) deflect+=cd.deflect; if(cd.ammo) ammoPool+=cd.ammo; if(cd.camo) camoN++; if(cd.sat) sat=true;
      if(cd.reveal){ if(cd.reveal==='both') reveal='both'; else if(reveal!=='both') reveal=cd.reveal; } }
    const jet = p.equip.gadget==='jetpack';
    const _ct=this.classTierOf(p); let _spd=cls.speed*SPEED_SCALE;
    if(p.cls==='Scout') _spd*=(1+(_ct-1)*0.10); else if(p.cls==='Infiltrator') _spd*=(1+(_ct-1)*0.07);
    if(p.ultActive==='speed') _spd*=1.5;
    if(w.melee) _spd*=(1.3+(_T-1)*0.06);   // spray can: super fast base (+30%), +6% per upgrade tier
    return { hp:1, speed:_spd, color:cls.color, deflect:Math.min(0.8,deflect),
      dmg:1, fireRate, spread, mag, reload, proj, range, splash:w.splash||0, pspeed:w.pspeed||BALL_SPEED, scope:!!w.scope, lob:!!w.lob, melee:!!w.melee, botReach,
      ammoMul, ammoPool, golden:(golden&&!w.melee), reveal, sat, camoN:Math.min(MAX_CAMO,camoN), weight, jetpack:jet };
  }

  // ---- spawning ----
  teamSpawn(team){ const yr=()=>rand(120,ARENA.h-120); return team==='blue'?{x:rand(80,180),y:yr()}:{x:rand(ARENA.w-180,ARENA.w-80),y:yr()}; }
  defaultEquip(cls){ return { weapon:CLASSES[cls].defWeapon, gadget:'none', wmods:[], chips:[], ammo:'none', weapon2:null, wmods2:[], camoTerrain:1 }; }
  newFighter(team,cls,isBot){
    const s=this.teamSpawn(team);
    const f={ id:this.nextId++, bot:!!isBot, team, cls, x:s.x,y:s.y,r:14,aim:team==='blue'?0:Math.PI,
      hp:1,maxhp:1,alive:true, ammo:0,reloading:false,reloadT:0,cool:0, downed:false,downT:0, ultReady:false,ultActive:null,ultT:0,evacT:0, lsArmed:false,lsArmedT:0,lsActive:false,lsT:0,lsRevive:3,lsBy:null, kills:0,deaths:0,
      wantAnte:false, anteIn:false, zone:null, equip:this.defaultEquip(cls), mineCharges:0, decoyCharges:0, hasTurret:false,
      goldenArmed:false, goldenCD:0, swapCD:0, mortar:false, mortarShots:0, mortarT:0, storeId:null, storeCD:0, turretType:'base', botCD:0, roundKills:0, anteAmt:100, ready:true, activeThisRound:false, afkRounds:0, spawnedThisRound:false, golden:false, fast:false, shield:0, spdMul:1, modeVotes:{},
      input:{mx:0,my:0,aim:0,fire:false,reload:false,deploy:false},
      ai:{target:null,repath:0,strafe:Math.random()<.5?1:-1,jitter:0,wander:rand(0,6.28)},
      name:isBot?BOTNAMES[(NAMEI++)%BOTNAMES.length]:'Player', key:null };
    if(isBot){ // give bots some variety/loadout
      const cw=CLASSES[cls].weapons; f.equip.weapon=cw[Math.floor(rand(0,cw.length))];
    }
    const st=this.stats(f); f.maxhp=st.hp; f.hp=st.hp; f.ammo=st.ammoPool;
    return f;
  }

  addHuman(name,cls,accountKey){
    // everyone starts Trooper unless they've unlocked & requested a class they own the right to
    const f=this.newFighter(this.smallerTeam(),'Trooper',false);
    f.name=(name&&name.trim())?name.trim().slice(0,16):('Player'+f.id);
    f.key=accountKey||walletKey(f.name)||('guest-'+f.id);
    if(this.wallets[f.key]===undefined) this.wallets[f.key]=NEW_WALLET;
    if(this.owned[f.key]===undefined)   this.owned[f.key]=[];
    if(this.xp[f.key]===undefined)      this.xp[f.key]=0;
    // honor requested class only if unlocked
    if(cls && CLASSES[cls] && this.getLevel(f)>=(CLASS_UNLOCK[cls]||1)) f.cls=cls;
    f.equip=this.defaultEquip(f.cls);
    this.restorePrefs(f);
    const st=this.stats(f); f.maxhp=st.hp; f.hp=st.hp; f.ammo=st.ammoPool;
    if(this.phase==='active') f.alive=false;
    else { const s=this.stageRect(); f.x=s.x+s.w/2+((this.players.size%6)-2.5)*46; f.y=s.y+s.h-60; f.alive=true; f.zone=null; }
    this.players.set(f.id,f); this.rebalanceBots();
    this.emit({type:'msg',text:`${f.name} joined ${f.team.toUpperCase()} (Lv ${this.getLevel(f)}).`});
    return f.id;
  }
  removeHuman(id){ const p=this.players.get(id); if(!p) return; this.savePrefs(p); if(p.anteIn) this.pot=Math.max(0,this.pot-BUY_IN); this.players.delete(id); this.rebalanceBots(); }
  smallerTeam(){ let b=0,r=0; for(const p of this.players.values()) p.team==='blue'?b++:r++; return b<=r?'blue':'red'; }
  countTeam(t){ let n=0; for(const p of this.players.values()) if(p.team===t)n++; for(const b of this.bots) if(b.team===t)n++; return n; }
  aliveCount(t){ let n=0; for(const p of this.players.values()) if(p.team===t&&p.alive)n++; for(const b of this.bots) if(b.team===t&&b.alive)n++; return n; }
  rebalanceBots(){ for(const team of ['blue','red']){ let need=TEAM_SIZE-this.countTeam(team);
    while(need>0){ const ck=CLASS_KEYS[Math.floor(rand(0,CLASS_KEYS.length))]; this.bots.push(this.newFighter(team,ck,true)); need--; }
    while(need<0){ const i=this.bots.findIndex(b=>b.team===team); if(i<0)break; this.bots.splice(i,1); need++; } } }

  // ---- input / class / shop ----
  setInput(id,inp){ const p=this.players.get(id); if(!p) return;
    p.input.mx=clamp(+inp.mx||0,-1,1); p.input.my=clamp(+inp.my||0,-1,1);
    p.input.aim=+inp.aim||0; p.input.aimDist=Math.max(0,+inp.aimDist||0); p.input.fire=!!inp.fire; p.input.reload=!!inp.reload; if(inp.armGolden) this.armGolden(p); if(inp.deploy) this.deploy(p); if(inp.ult) this.useUlt(id); if(inp.swap) this.swapWeapon(id);
    if(this.phase==='active' && (p.input.mx||p.input.my||p.input.fire)) p.activeThisRound=true; }
  setClass(id,cls){ const p=this.players.get(id); if(!p||!CLASSES[cls]) return {ok:false,msg:'bad class'};
    if(this.phase==='active' && p.alive) return {ok:false,msg:'Locked during the round. Switch in the holding area.'};
    const req=CLASS_UNLOCK[cls]||1; if(this.getLevel(p)<req) return {ok:false,msg:`${cls} unlocks at level ${req}`};
    const refund=this._refundClear(p);
    p.cls=cls; p.equip=this.defaultEquip(cls);
    const st=this.stats(p); p.maxhp=st.hp; p.hp=st.hp; p.ammo=st.ammoPool; p.cool=0;
    this.emit({type:'msg',text:`${p.name} switched to ${cls}${refund?` (+${refund} refunded)`:''}.`}); this.savePrefs(p);
    return {ok:true, money:this.getMoney(p), refund, cls:p.cls, equip:p.equip, inv:this.inv[p.key]||{}, owned:this.ownedSet(p.key)}; }
  canEquip(p,cat,id){ const def=CATALOG[cat][id]; if(!def) return false;
    if(cat==='weapon' && !CLASSES[p.cls].weapons.includes(id)) return false;
    if(cat==='gadget' && id!=='none' && !CLASSES[p.cls].gear.includes(id)) return false;
    if(cat==='chip' && def.heavy && !HEAVY_CLASSES.includes(p.cls)) return false;
    return true; }
  buy(id,catid){
    const p=this.players.get(id); if(!p) return {ok:false,msg:'no player'};
    const [cat,item]=String(catid).split(':'); const def=CATALOG[cat]&&CATALOG[cat][item];
    if(!def) return {ok:false,msg:'no such item'};
    if(!this.canEquip(p,cat,item)) return {ok:false,money:this.getMoney(p),msg:`${p.cls} can't use that`};
    if(cat==='ammo'){ if(this.getMoney(p)<def.cost) return {ok:false,money:this.getMoney(p),msg:'not enough Paint Coins'};
      this.addMoney(p,-def.cost); const s=this.ammoStock[p.key]||(this.ammoStock[p.key]={}); s[item]=(s[item]||0)+(def.shots||0);
      this.emit({type:'msg',text:`${p.name} bought ${def.name}.`}); return {ok:true,money:this.getMoney(p),ammoStock:s,msg:`Bought ${def.name} (+${def.shots})`}; }
    if(cat==='wmod'||cat==='chip'){ const cap=cat==='wmod'?WMOD_SLOTS:CHIP_SLOTS; const inv=this.inv[p.key]||(this.inv[p.key]={}); const have=inv[catid]||0;
      if(have>=cap) return {ok:false,money:this.getMoney(p),inv,msg:`Max ${cap} owned`};
      if(this.getMoney(p)<def.cost) return {ok:false,money:this.getMoney(p),inv,msg:'not enough Paint Coins'};
      this.addMoney(p,-def.cost); inv[catid]=have+1; this.emit({type:'msg',text:`${p.name} bought ${def.name}.`});
      return {ok:true,money:this.getMoney(p),inv,msg:`Bought ${def.name}`}; }
    if(this.owns(p,cat,item)) return {ok:true,money:this.getMoney(p),owned:this.ownedSet(p.key),msg:'Already owned'};
    if(this.getMoney(p)<def.cost) return {ok:false,money:this.getMoney(p),msg:'not enough Paint Coins'};
    this.addMoney(p,-def.cost); this.ownedSet(p.key).push(cat+':'+item);
    this.emit({type:'msg',text:`${p.name} bought ${def.name}.`});
    return {ok:true,money:this.getMoney(p),owned:this.ownedSet(p.key),msg:`Bought ${def.name}`};
  }
  applyLoadout(id,ld){
    const p=this.players.get(id); if(!p||!ld) return {ok:false,msg:'no player'};
    if(this.phase==='active' && p.alive) return {ok:false,msg:'Locked during the round. Change gear in the holding area.'};
    const wid=(ld.weapon&&CATALOG.weapon[ld.weapon])?ld.weapon:p.equip.weapon;
    if(!this.owns(p,'weapon',wid)||!this.canEquip(p,'weapon',wid)) return {ok:false,msg:'weapon not available'};
    const wmods=Array.isArray(ld.wmods)?ld.wmods.filter(m=>WEAPON_MODS[m]).slice(0,WMOD_SLOTS):[];
    let w2=(ld.weapon2&&ld.weapon2!=='none'&&CATALOG.weapon[ld.weapon2])?ld.weapon2:null;
    if(w2 && (!this.owns(p,'weapon',w2)||!this.canEquip(p,'weapon',w2))) return {ok:false,msg:'2nd weapon not available'};
    const wmods2=(w2&&Array.isArray(ld.wmods2))?ld.wmods2.filter(m=>WEAPON_MODS[m]).slice(0,WMOD_SLOTS):[];
    const chips=Array.isArray(ld.chips)?ld.chips.filter(c=>ARMOR_CHIPS[c]).slice(0,CHIP_SLOTS):[];
    for(const c of chips) if(!this.canEquip(p,'chip',c)) return {ok:false,msg:'chip not available'};
    if(chips.filter(c=>ARMOR_CHIPS[c].camo).length>MAX_CAMO) return {ok:false,msg:`Max ${MAX_CAMO} camo chips`};
    if(chips.filter(c=>ARMOR_CHIPS[c].reveal).length>1) return {ok:false,msg:'Only one optic (Thermal / Gamma / Satellite) at a time'};
    const need={}; for(const m of wmods) need['wmod:'+m]=(need['wmod:'+m]||0)+1; for(const m of wmods2) need['wmod:'+m]=(need['wmod:'+m]||0)+1; for(const c of chips) need['chip:'+c]=(need['chip:'+c]||0)+1;
    for(const k in need){ if(this.invCount(p,k)<need[k]) return {ok:false,msg:'Buy a copy for each socket (cost is per mod).'}; }
    const gad=(ld.gadget&&CATALOG.gadget[ld.gadget])?ld.gadget:'none';
    if(gad!=='none' && (!this.owns(p,'gadget',gad)||!this.canEquip(p,'gadget',gad))) return {ok:false,msg:'gadget not available'};
    const probe={cls:p.cls,equip:{weapon:wid,wmods,chips,gadget:gad}};
    const wt=this.stats(probe).weight + (w2?(WEAPON_WT+modW(wmods2)):0), cap=weightCapacity(this.getLevel(p));
    if(wt>cap) return {ok:false,msg:`Too heavy: ${wt}/${cap} — level up for more capacity.`,weight:wt,cap};
    const ammoSel=(ld.ammo==='fast')?'fast':'none';
    const camoTerrain=[0,1,2,3].includes(+ld.camoTerrain)?+ld.camoTerrain:(p.equip.camoTerrain==null?1:p.equip.camoTerrain);
    p.equip={weapon:wid,wmods,chips,gadget:gad,ammo:ammoSel,weapon2:w2,wmods2:(w2?wmods2:[]),camoTerrain};
    const st=this.stats(p); p.maxhp=st.hp; if(this.phase!=='active') p.hp=Math.min(p.hp,st.hp); p.ammo=Math.min(p.ammo,st.ammoPool);
    p.mineCharges=(GADGETS[gad]&&GADGETS[gad].charges)||0; p.decoyCharges=gad==='decoy'?GADGETS.decoy.charges:0;
    this.savePrefs(p);
    return {ok:true,weight:wt,cap,money:this.getMoney(p)};
  }
  _refundClear(p){ let refund=0; const inv=this.inv[p.key]||{};
    for(const k in inv){ const a=k.split(':'); const d=CATALOG[a[0]]&&CATALOG[a[0]][a[1]]; if(d) refund+=(d.cost||0)*inv[k]; }
    for(const s of (this.owned[p.key]||[])){ const a=s.split(':'); const d=CATALOG[a[0]]&&CATALOG[a[0]][a[1]]; if(d) refund+=(d.cost||0); }
    this.inv[p.key]={}; this.owned[p.key]=[]; if(refund) this.addMoney(p,refund); return refund; }
  resetLoadout(id){ const p=this.players.get(id); if(!p||p.bot) return {ok:false};
    if(this.phase==='active' && p.alive) return {ok:false,msg:'Locked during the round.'};
    let refund=this._refundClear(p);   // sell back all gear / mods / chips
    let tref=0; const wt=this.tiers[p.key]||{}; for(const wid in wt){ for(let t=2;t<=wt[wid];t++) tref+=(wid==='pball_gun'?0:(TIER_COST[t]||0)); }
    const ct=this.classTiers[p.key]||{}; for(const cn in ct){ for(let t=2;t<=ct[cn];t++) tref+=(TIER_COST[t]||0); }
    this.tiers[p.key]={}; this.classTiers[p.key]={};   // full respec: refund weapon + class upgrade tiers too (level/XP kept)
    if(tref){ this.addMoney(p,tref); refund+=tref; }
    p.equip=this.defaultEquip(p.cls);
    const st=this.stats(p); p.maxhp=st.hp; p.hp=st.hp; p.ammo=st.ammoPool; p.mineCharges=0; p.decoyCharges=0; p.hasTurret=false;
    this.emit({type:'msg',text:`${p.name} reset to default${refund?` (+${refund} refunded)`:''}.`}); this.savePrefs(p);
    return {ok:true,money:this.getMoney(p),refund,cls:p.cls,equip:p.equip,inv:this.inv[p.key]||{},owned:this.ownedSet(p.key),tiers:{},classTiers:{}}; }
  setAnte(id,on,amt){ const p=this.players.get(id); if(!p) return {ok:false}; p.wantAnte=!!on; if(amt!==undefined){ const a=+amt; if(ANTE_OPTIONS.includes(a)) p.anteAmt=a; } return {ok:true,wantAnte:p.wantAnte,anteAmt:p.anteAmt}; }
  setReady(id,on){ const p=this.players.get(id); if(!p) return {ok:false}; p.ready=!!on; if(p.ready) p.afkRounds=0; return {ok:true,ready:p.ready}; }
  readyCount(){ let n=0; for(const p of this.players.values()) if(p.ready!==false) n++; return n; }
  statBucket(p){ if(!p.key) return {splats:0,psplats:0,shots:0,name:p.name}; const b=this.lifeStats[p.key]||(this.lifeStats[p.key]={splats:0,psplats:0,shots:0,name:p.name}); b.name=p.name; return b; }
  bumpStat(p,key){ if(!p.key) return; const b=this.statBucket(p); b[key]=(b[key]||0)+1; const bc=b.byCls||(b.byCls={}); const cb=bc[p.cls]||(bc[p.cls]={splats:0,psplats:0,shots:0}); cb[key]=(cb[key]||0)+1; }
  leaderboard(){ const arr=Object.values(this.lifeStats);
    const board=(pick)=>{ const rows=arr.map(s=>({name:s.name||'?',st:pick(s)})).filter(x=>x.st);
      return { splats: rows.map(r=>({name:r.name,val:r.st.splats||0})).filter(x=>x.val>0).sort((a,b)=>b.val-a.val).slice(0,5),
               psplats: rows.map(r=>({name:r.name,val:r.st.psplats||0})).filter(x=>x.val>0).sort((a,b)=>b.val-a.val).slice(0,5),
               accuracy: rows.filter(r=>(r.st.shots||0)>=20).map(r=>({name:r.name,val:Math.round(100*(r.st.splats||0)/(r.st.shots||1))})).filter(x=>x.val>0).sort((a,b)=>b.val-a.val).slice(0,5) }; };
    const overall=board(s=>({splats:s.splats||0,psplats:s.psplats||0,shots:s.shots||0}));
    const byClass={}; for(const cls of CLASS_KEYS) byClass[cls]=board(s=>(s.byCls&&s.byCls[cls])||null);
    return { ...overall, byClass }; }
  classTierOf(p){ if(p.bot) return 1; const m=this.classTiers[p.key]; return (m&&m[p.cls])||1; }
  upgradeClass(id){ const p=this.players.get(id); if(!p||p.bot) return {ok:false}; if(this.phase==='active' && p.alive) return {ok:false,msg:'Locked during the round.'};
    if(!['Sniper','Scout','Infiltrator','VetTrooper'].includes(p.cls)) return {ok:false,msg:'No class upgrade for this class yet'};
    const m=this.classTiers[p.key]||(this.classTiers[p.key]={}); const cur=m[p.cls]||1;
    if(cur>=MAXTIER) return {ok:false,money:this.getMoney(p),classTiers:m,msg:'Max class tier'};
    const tc=cur+1, ccost=TIER_COST[tc]||9999, clvl=(tc-1)*3;
    if(this.getLevel(p)<clvl) return {ok:false,money:this.getMoney(p),classTiers:m,msg:`Reach Lv ${clvl} (more splats) first`};
    if(this.getMoney(p)<ccost) return {ok:false,money:this.getMoney(p),classTiers:m,msg:'Not enough Paint Coins'};
    this.addMoney(p,-ccost); m[p.cls]=tc; const st=this.stats(p); p.maxhp=st.hp;
    this.emit({type:'msg',text:`${p.name} upgraded ${p.cls} to Class Tier ${tc}.`});
    return {ok:true,money:this.getMoney(p),classTiers:m,msg:`Class Tier ${tc}`}; }
  devGrant(id){ const p=this.players.get(id); if(!p||!p.key) return {ok:false}; this.xp[p.key]=xpCum(99)+50; this.wallets[p.key]=(this.wallets[p.key]||0)+100000; this.emit({type:'msg',text:`${p.name} — DEV: max level + 100,000 coins.`}); return {ok:true,money:this.getMoney(p),level:99}; }
  grantGold(id){ const p=this.players.get(id); if(!p||!p.key) return {ok:false}; this.wallets[p.key]=(this.wallets[p.key]||0)+10000; return {ok:true,money:this.getMoney(p)}; }
  setModeVote(id,mode,on){ const p=this.players.get(id); if(!p||!MODES.includes(mode)) return {ok:false}; if(!p.modeVotes) p.modeVotes={}; p.modeVotes[mode]=!!on; this.savePrefs(p); return {ok:true,modes:this.modeVoteState()}; }
  modeVoteState(){ const ps=[...this.players.values()]; const counts={}; for(const m of MODES) counts[m]=0; for(const p of ps){ const mv=p.modeVotes||{}; for(const m of MODES) if(mv[m]) counts[m]++; } const n=ps.length; const disabled=MODES.filter(m=> n>0 && counts[m]*2>n); return {list:MODES.slice(),counts,disabled,players:n}; }

  // ---- combat ----
  armGolden(f){ if(!f||!f.alive) return; const st=this.stats(f); if(st.golden && (f.goldenCD||0)<=0) f.goldenArmed=true; }
  useUlt(id){ const p=this.players.get(id); if(!p||p.bot||!p.alive||this.phase!=='active') return; const C=CLASSES[p.cls]; const ult=C&&C.ult; if(!ult) return;
    if(!p.ultReady) return;   // ability works with any weapon now (independent of loadout)
    p.ultReady=false;
    if(ult==='evac'){ p.evacT=3.0; this.emit({type:'ult',k:'evac',id:p.id,x:Math.round(p.x),y:Math.round(p.y)}); }
    else if(ult==='speed'){ p.ultActive='speed'; p.ultT=10.0; this.emit({type:'ult',k:'speed',id:p.id}); }
    else if(ult==='invis'){ p.ultActive='invis'; p.ultT=10.0; this.emit({type:'ult',k:'invis',id:p.id}); }
    else if(ult==='laststand'){ const ct=this.classTierOf(p); p.lsArmed=true; p.lsArmedT=5+ct; p.lsRevive=2.5+ct*0.5; this.emit({type:'ult',k:'laststand',id:p.id}); }
    else if(ult==='mortar'){ p.mortar=true; p.mortarShots=MORTAR_SHOTS; p.mortarT=14; p.cool=0; this.emit({type:'ult',k:'mortar',id:p.id}); }
    this.emit({type:'msg',team:p.team,teamOnly:true,text:`${p.name} used ${ult==='evac'?'Emergency Evac':ult==='speed'?'Speed Boost':ult==='invis'?'Cloak':ult==='laststand'?'Last Stand':'the Mortar'}.`}); }
  evacTeleport(f){ const minD=10*TILE; let tx=f.x,ty=f.y,tries=0;
    do{ tx=rand(80,ARENA.w-80); ty=rand(80,ARENA.h-80); tries++; } while(Math.hypot(tx-f.x,ty-f.y)<minD && tries<50);
    this.emit({type:'teleport',id:f.id,fx:Math.round(f.x),fy:Math.round(f.y),tx:Math.round(tx),ty:Math.round(ty)}); f.x=tx; f.y=ty; this.collide(f); f.evacT=0; }
  autoMelee(p,st){ if(!p.alive||p.cool>0) return;
    const swing=(e)=>{ p.cool=st.fireRate/1000; p.firedT=this.clock; if(!p.bot&&p.key) this.bumpStat(p,'shots'); this.emit({type:'melee',x:Math.round(e.x),y:Math.round(e.y),a:+Math.atan2(e.y-p.y,e.x-p.x).toFixed(2),team:p.team}); this.applyDamage(e,1,p,false); };
    const tx=p.x+Math.cos(p.aim)*TILE, ty=p.y+Math.sin(p.aim)*TILE, dr=TILE*0.8;   // facing "death square": auto-fire on ANY enemy in it (players too)
    let dsq=null,db=dr*dr; for(const e of [...this.players.values(),...this.bots]){ if(!e.alive||e.team===p.team) continue; const dd=dist2(tx,ty,e.x,e.y); if(dd<db && this.clearPath(p.x,p.y,e.x,e.y)){ db=dd; dsq=e; } }
    if(dsq){ swing(dsq); return; }
    const R=st.botReach||0; if(R<=0) return; let best=null,bd=R*R;   // wider bot-clear aura (bots only)
    for(const b of this.bots){ if(!b.alive||b.team===p.team) continue; const dd=dist2(p.x,p.y,b.x,b.y); if(dd<bd && this.clearPath(p.x,p.y,b.x,b.y)){ bd=dd; best=b; } }
    if(best) swing(best); }
  startReload(f){ if(!f||!f.alive||f.reloading) return; const st=this.stats(f); if((f.clip==null?st.mag:f.clip)>=st.mag) return; const unlimited=(this.mode==='invaders')||f.bot; if(!unlimited && f.ammo<=0) return; f.reloading=true; f.reloadT=st.reload||1.5; }
  fireMortar(f){ if(f.cool>0||f.mortarShots<=0) return; f.cool=0.9; f.mortarShots--;
    const range=(f.input&&f.input.aimDist>0)?Math.max(140,f.input.aimDist):2400; const ang=f.aim;   // unlimited range — lands where you aim
    this.balls.push({x:f.x+Math.cos(ang)*22,y:f.y+Math.sin(ang)*22,x0:f.x,y0:f.y,pforest:true,lob:true,vx:Math.cos(ang),vy:Math.sin(ang),speed:160,dmg:1,team:f.team,owner:f.id,life:range/160,color:'#ffcf6a',r:9,pierce:false,splash:MORTAR_SPLASH,mortar:1});
    this.emit({type:'mortarfire',x:Math.round(f.x),y:Math.round(f.y),team:f.team});
    if(f.mortarShots<=0) f.mortar=false; }
  fire(f){
    if(!f.alive) return;
    if(f.mortar){ this.fireMortar(f); return; }
    if(f.cool>0||f.reloading) return;
    const st=this.stats(f);
    if(st.melee){ f.cool=st.fireRate/1000; f.firedT=this.clock; if(f.ultActive==='invis'){ f.ultActive=null; f.ultT=0; } if(!f.bot && f.key) this.bumpStat(f,'shots');   // Scout melee: a single "death square" in the facing direction (not all around)
      const tx=f.x+Math.cos(f.aim)*TILE, ty=f.y+Math.sin(f.aim)*TILE, R=TILE*0.8;
      this.emit({type:'melee',x:Math.round(tx),y:Math.round(ty),a:+f.aim.toFixed(2),team:f.team});
      let best=null,bd=R*R; for(const e of [...this.players.values(),...this.bots]){ if(!e.alive||e.team===f.team) continue; const dd=dist2(tx,ty,e.x,e.y); if(dd<bd && this.clearPath(f.x,f.y,e.x,e.y)){ bd=dd; best=e; } }
      if(best) this.applyDamage(best,1,f,false); return; }
    const unlimited=(this.mode==='invaders')||f.bot;
    if(!unlimited && f.ammo<=0) return;                          // dry: round pool spent (refills next round)
    if(f.clip==null) f.clip=st.mag;
    if(f.clip<=0){ this.startReload(f); return; }                // empty magazine -> reload before firing
    const wdef=WEAPONS[f.equip.weapon]||WEAPONS[CLASSES[f.cls].defWeapon];
    const useGolden = f.goldenArmed && st.golden;
    f.cool=st.fireRate/1000; f.firedT=this.clock; if(f.ultActive==='invis'){ f.ultActive=null; f.ultT=0; }
    const cost = useGolden?1:(st.ammoMul||1); if(!unlimited) f.ammo=Math.max(0,f.ammo-cost);
    f.clip=Math.max(0,f.clip-1); if(f.clip<=0) this.startReload(f);   // spend a round from the magazine; auto-reload when empty
    if(!f.bot && f.key) this.bumpStat(f,'shots');   // accuracy tracking (per trigger pull)
    let useFast=false; if(f.equip.ammo==='fast' && !f.bot && f.key && !st.splash){ const s=this.ammoStock[f.key]; if(s && (s.fast||0)>0){ s.fast--; useFast=true; } }
    let pf=st.scope, lob=st.lob, range=st.range, proj=st.proj, bspeed=st.pspeed, col=(wdef.color||paintColor(wdef,'normal')), splash=st.splash;
    if(useFast){ bspeed*=AMMO.fast.speedMul; col=AMMO.fast.color; }
    if(useGolden){ f.goldenArmed=false; f.goldenCD=GOLDEN_CD; range=wdef.range*2.5; bspeed=360; col='#ffd700'; pf=true; lob=false; proj=1; splash=0; this.emit({type:'golden',x:Math.round(f.x),y:Math.round(f.y)}); }
    const reach=Math.min(range, (f.input&&f.input.aimDist>0)?f.input.aimDist:range);  // shoot short if you aim short
    for(let i=0;i<proj;i++){
      const ang=f.aim+(Math.random()-0.5)*st.spread*2;
      this.balls.push({ x:f.x+Math.cos(f.aim)*(f.r+6), y:f.y+Math.sin(f.aim)*(f.r+6), x0:f.x, y0:f.y, pforest:pf, lob:lob,
        vx:Math.cos(ang),vy:Math.sin(ang),speed:bspeed, dmg:1, team:f.team, owner:f.id,
        life:reach/bspeed, color:col, r:5, pierce:false, splash:splash });
    }
  }
  deploy(f){
    if(!f.alive) return; const g=f.equip.gadget;
    if(g==='mine'){ if(f.mineCharges<=0) return; f.mineCharges--; this.mines.push({id:this.nextId++,x:f.x,y:f.y,team:f.team,owner:f.id,arm:1.0,r:58}); this.emit({type:'deploy',kind:'mine',team:f.team}); }
    else if(g==='turret'){
      if(f.cls==='Engineer'){ const kind=f.turretType||'base'; const costMap={base:ENG_COST.pellet_turret,grenade:ENG_COST.grenade_turret,rocket:ENG_COST.rocket_turret}; const cost=costMap[kind]||0;
        if(this.getMoney(f)<cost){ this.emit({type:'toast',to:f.id,text:`Need ${cost} coins for that turret`}); return; }
        for(let i=this.turrets.length-1;i>=0;i--) if(this.turrets[i].owner===f.id){ this.emit({type:'boom',x:this.turrets[i].x,y:this.turrets[i].y}); this.turrets.splice(i,1); }   // 1 turret at a time -> replace
        this.addMoney(f,-cost); this.spawnTurret(f,kind,f.x,f.y); this.emit({type:'deploy',kind:'turret',team:f.team}); }
      else { if(f.hasTurret) return; f.hasTurret=true; this.spawnTurret(f,'base',f.x,f.y); this.emit({type:'deploy',kind:'turret',team:f.team}); } }
    else if(g==='decoy'){ if(f.decoyCharges<=0) return; f.decoyCharges--; this.decoys.push({id:this.nextId++,x:f.x,y:f.y,team:f.team,cls:f.cls,life:12}); }
  }
  spawnTurret(owner,kind,x,y){ const range=kind==='rocket'?520:(kind==='grenade'?470:420); this.turrets.push({id:this.nextId++,x,y,team:owner.team,owner:owner.id,hp:TURRET_HP,maxhp:TURRET_HP,cool:0,range,kind}); }
  engBots(id){ let n=0; for(const b of this.bots) if(b.engOwner===id&&b.alive) n++; return n; }
  engTurrets(id){ let n=0; for(const tr of this.turrets) if(tr.owner===id) n++; return n; }
  engStoreLevel(p){ return (p.key && this.storeLevels[p.key]) || 1; }
  engTurretCap(p){ return 1; }
  setTurretType(id,kind){ const p=this.players.get(id); if(!p||p.cls!=='Engineer') return; if(['base','grenade','rocket'].includes(kind)) p.turretType=kind; }
  engBotCap(p){ return Math.min(6, this.engStoreLevel(p)*2); }
  engCaps(p){ return { maxTurrets:this.engTurretCap(p), maxBots:this.engBotCap(p), storeLevel:this.engStoreLevel(p) }; }
  spawnEngBot(p){ const pool=CLASS_KEYS.filter(c=>c!=='Engineer'); const ck=pool[Math.floor(rand(0,pool.length))]; const b=this.newFighter(p.team,ck,true); b.engOwner=p.id; b.x=p.x+rand(-42,42); b.y=p.y+rand(-42,42); b.alive=true; const st=this.stats(b); b.maxhp=st.hp; b.hp=st.hp; b.ammo=st.ammoPool; b.clip=st.mag; this.bots.push(b); }
  engbuy(id,item){ const p=this.players.get(id); if(!p||p.bot) return {ok:false,msg:'no player'};
    if(p.cls!=='Engineer') return {ok:false,msg:'Engineers only'};
    if(this.phase!=='active'||!p.alive) return {ok:false,money:this.getMoney(p),msg:'Only in-round, while alive'};
    if(item!=='bot') return {ok:false,money:this.getMoney(p),msg:'Build turrets with G; upgrade in the loadout'};
    if((p.botCD||0)>0) return {ok:false,money:this.getMoney(p),msg:`Reinforcements cooling down (${Math.ceil(p.botCD)}s)`};
    const cap=this.engBotCap(p); if(this.engBots(p.id)>=cap) return {ok:false,money:this.getMoney(p),msg:`Bot cap ${cap} — raise Store Level in your loadout`};
    const cost=ENG_COST.bot; if(this.getMoney(p)<cost) return {ok:false,money:this.getMoney(p),msg:'Not enough Paint Coins'};
    this.addMoney(p,-cost); this.spawnEngBot(p); p.botCD=3; return {ok:true,money:this.getMoney(p),msg:'Bot deployed'}; }
  upgradeStore(id){ const p=this.players.get(id); if(!p||p.bot) return {ok:false}; if(p.cls!=='Engineer') return {ok:false,msg:'Engineers only'};
    if(this.phase==='active' && p.alive) return {ok:false,msg:'Upgrade in the holding area.'};
    const cur=this.engStoreLevel(p), nl=cur+1, cost=ENG_STORE_UP[nl];
    if(!cost) return {ok:false,money:this.getMoney(p),storeLevel:cur,msg:'Store at max level'};
    if(this.getMoney(p)<cost) return {ok:false,money:this.getMoney(p),storeLevel:cur,msg:'Not enough Paint Coins'};
    this.addMoney(p,-cost); this.storeLevels[p.key]=nl; return {ok:true,money:this.getMoney(p),storeLevel:nl,msg:`Store Level ${nl} — bot cap ${Math.min(6,nl*2)}`}; }
  swapWeapon(id){ const p=this.players.get(id); if(!p||!p.alive) return; const w2=p.equip.weapon2;
    if(!w2 || w2==='none' || (p.swapCD||0)>0) return;
    const w1=p.equip.weapon, m1=(p.equip.wmods||[]).slice();
    p.equip.weapon=w2; p.equip.wmods=(p.equip.wmods2||[]).slice(); p.equip.weapon2=w1; p.equip.wmods2=m1;
    p.swapCD=0.6; p.reloading=false; p.reloadT=0; const st=this.stats(p);
    p.clip=Math.min((p.clip==null?st.mag:p.clip), st.mag); p.cool=Math.max(p.cool||0,0.4);
    this.emit({type:'swap',id:p.id,team:p.team,w:p.equip.weapon}); }
  applyDamage(target,dmg,attacker,pierce){
    if(!target.alive) return;
    // One hit eliminates. Armor = chance the paintball bounces off (unless armor-piercing).
    if(!pierce && Math.random() < this.deflectChance(target)){ this.emit({type:'deflect',x:target.x,y:target.y,c:'#e6edf3',byId:attacker?attacker.id:0,vtId:target.id}); return; }
    if(target.shield>0){ target.shield--; this.emit({type:'deflect',x:target.x,y:target.y,c:'#ffd700'}); return; }   // super-bot soaks an extra hit
    if(target.lsArmed && !target.lsActive && !target.bot){   // Vet Trooper "Last Stand": push through the splat
      target.lsArmed=false; target.lsArmedT=0; target.lsActive=true; target.lsT=target.lsRevive||3; target.lsBy=attacker||null;
      this.emit({type:'splat',x:target.x,y:target.y,c:attacker?CLASSES[attacker.cls].color:'#fff'});   // the shot DID land — show paint
      this.emit({type:'laststand',id:target.id,byId:attacker?attacker.id:0,x:Math.round(target.x),y:Math.round(target.y),team:target.team}); return; }
    this.killNow(target,attacker); }
  killNow(target,attacker){
    if(!target.alive) return; target.lsActive=false; target.lsArmed=false; target.mortar=false;
    target.alive=false; target.deaths++;
    if(this.mode==='ctf'){ for(const fl of this.flags) if(fl.carrier===target.id){ fl.carrier=null; fl.atHome=false; fl.dropT=20; fl.x=target.x; fl.y=target.y; } }
    this.emit({type:'splat',x:target.x,y:target.y,c:target.golden?'#ffd700':(attacker?CLASSES[attacker.cls].color:'#fff')});
    const mul=this.doubleRewards?2:1; const base=target.bot?BOT_SPLAT_REWARD:SPLAT_REWARD;
    const rew=(attacker&&!attacker.bot&&!this.tournament)?base*mul:0, xpg=(attacker&&!attacker.bot)?((this.tournament?2:1)*mul):0;
    this.emit({type:'elim',byId:attacker?attacker.id:0,by:attacker?attacker.name:'?',byTeam:attacker?attacker.team:'',vtId:target.id,vt:target.name,vtTeam:target.team, rew, xp:xpg});
    if(attacker){ attacker.kills++; attacker.roundKills=(attacker.roundKills||0)+1; if(!attacker.bot){ if(attacker.key){ this.bumpStat(attacker,'splats'); if(!target.bot) this.bumpStat(attacker,'psplats'); } if(rew) this.addMoney(attacker,rew); if(xpg) this.gainXp(attacker,xpg); } if(attacker.lsActive){ if(this.aliveCount(target.team)===0){ const ab=attacker.lsBy||null; attacker.lsActive=false; attacker.lsT=0; attacker.lsBy=null; this.emit({type:'lstrade',id:attacker.id,x:Math.round(attacker.x),y:Math.round(attacker.y),team:attacker.team,clinch:1}); this.killNow(attacker,ab); } else this.emit({type:'lstrade',id:attacker.id,x:Math.round(attacker.x),y:Math.round(attacker.y),team:attacker.team,clinch:0}); } }
    if(target.bot && target.golden && !this.superRound){ this.superNext=true; this.goldenEnded=true; this.emit({type:'goldenbot',by:attacker?attacker.name:'?'}); }
  }
  splashDamage(x,y,radius,team,attacker,color){
    this.emit({type:'splash',x:Math.round(x),y:Math.round(y),r:Math.round(radius),c:color||(attacker?CLASSES[attacker.cls].color:'#ffd166')});
    for(const f of [...this.players.values(),...this.bots]){ if(!f.alive||f.team===team) continue;
      if(dist2(x,y,f.x,f.y)<=radius*radius) this.applyDamage(f, 1, attacker, true); }   // explosions ignore armor
  }
  gainXp(p,n){ if(p.bot||!p.key) return; const before=levelInfo(this.getXp(p)).level; this.xp[p.key]=(this.xp[p.key]??0)+n;
    const after=levelInfo(this.getXp(p)).level;
    if(after>before){ this.addMoney(p,LEVELUP_BONUS*(after-before));
      this.emit({type:'levelup',id:p.id,name:p.name,level:after, unlocked:(before<CLASS_UNLOCK_LEVEL&&after>=CLASS_UNLOCK_LEVEL)}); } }

  // ---- modes & tournament ----
  allAnted(){ const ps=[...this.players.values()]; if(ps.length===0) return false; const amt=ps[0].anteAmt; return ps.every(p=>p.wantAnte && p.anteAmt===amt && this.getMoney(p)>=p.anteAmt); }
  pickMode(){ const dis=new Set(this.modeVoteState().disabled); let pool=MODES.filter(m=>!dis.has(m)); if(this.players.size<2) pool=pool.filter(m=>m!=='ctf'); if(!pool.length) pool=['tdm']; return pool[Math.floor(rand(0,pool.length))]; }
  modeName(){ if(this.superRound) return 'SUPER Bot Invaders'; return this.tournament?MODE_NAMES.tournament:(MODE_NAMES[this.mode]||this.mode); }
  assignTeams(mode){ const ps=[...this.players.values()];
    if(mode==='invaders'){ for(const p of ps) p.team='blue'; }
    else { ps.forEach((p,i)=>{ p.team=(i%2===0)?'blue':'red'; }); } }
  spawnEdgeBots(n){ for(let i=0;i<n;i++){ const ck=CLASS_KEYS[Math.floor(rand(0,CLASS_KEYS.length))]; const b=this.newFighter('red',ck,true);
    const side=Math.floor(rand(0,4));
    if(side===0){ b.x=rand(60,ARENA.w-60); b.y=60; } else if(side===1){ b.x=rand(60,ARENA.w-60); b.y=ARENA.h-60; }
    else if(side===2){ b.x=60; b.y=rand(60,ARENA.h-60); } else { b.x=ARENA.w-60; b.y=rand(60,ARENA.h-60); }
    this.bots.push(b); } }
  applyInvadersWave(){ const w=this.invWave;                           // mark fast / super bots, scaling with wave
    const fastFrac = w<3?0:Math.min(0.6,0.08*(w-2));
    const superFrac = (w%5===0)?Math.min(0.4,0.1*(w/5)):0;
    for(const b of this.bots){ b.golden=false; b.fast=false; b.shield=0; b.spdMul=1.2;   // invaders bots advance a bit faster so the swarm closes in
      if(Math.random()<superFrac){ b.fast=true; b.spdMul=1.8; b.shield=1; }
      else if(Math.random()<fastFrac){ b.fast=true; b.spdMul=FAST_SPD_MUL; } } }
  setupFlags(){ const by=Math.round(ARENA.h/2);
    this.flags=[ {team:'blue',homeX:90,homeY:by,x:90,y:by,carrier:null,atHome:true,dropT:0},
                 {team:'red', homeX:ARENA.w-90,homeY:by,x:ARENA.w-90,y:by,carrier:null,atHome:true,dropT:0} ];
    this.caps={blue:0,red:0}; }
  updateFlags(dt){ const all=[...this.players.values(),...this.bots];
    for(const fl of this.flags){
      if(fl.carrier){ const c=this.findById(fl.carrier);
        if(!c||!c.alive){ fl.carrier=null; fl.atHome=false; fl.dropT=20; }
        else { fl.x=c.x; fl.y=c.y; const own=this.flags.find(o=>o.team===c.team);
          if(own&&own.atHome&&dist2(c.x,c.y,own.homeX,own.homeY)<1600){ this.caps[c.team]=(this.caps[c.team]||0)+1;
            this.emit({type:'capture',team:c.team,by:c.name,caps:{...this.caps}}); this.addMoney(c,80); this.gainXp(c,2);
            fl.carrier=null; fl.atHome=true; fl.x=fl.homeX; fl.y=fl.homeY; } }
      } else if(!fl.atHome){ fl.dropT-=dt; if(fl.dropT<=0){ fl.atHome=true; fl.x=fl.homeX; fl.y=fl.homeY; this.emit({type:'flagreturn',team:fl.team}); } } }
    for(const f of all){ if(!f.alive) continue; for(const fl of this.flags){ if(fl.carrier) continue;
      if(dist2(f.x,f.y,fl.x,fl.y)>676) continue;
      if(fl.team===f.team){ if(!fl.atHome){ fl.atHome=true; fl.x=fl.homeX; fl.y=fl.homeY; this.emit({type:'flagreturn',team:fl.team}); } }
      else { fl.carrier=f.id; fl.atHome=false; this.emit({type:'flaggrab',team:fl.team,by:f.name}); } } } }

  // ---- rounds ----
  startRound(){
    this.roundNum++; this.phase='active'; this.roundTimer=ROUND_TIME; this.balls=[]; this.mines=[]; this.turrets=[]; this.decoys=[]; this.stores=[]; this.flags=[]; this.caps={blue:0,red:0};
    const newSeries = !this.tournament && this.allAnted();         // tournament begins when everyone has anted
    if(newSeries){ this.tournament=true; this.roundsWon={blue:0,red:0}; }
    this.superRound = this.superNext; this.superNext=false;        // Golden-bot kill launches a one-off Super Invaders
    this.doubleRewards = this.superRound;
    if(this.superRound) this.mode='invaders';
    else if(this.tournament) this.mode='tdm';
    else if(this.invSession) this.mode='invaders';                 // a Bot Invaders session runs until a wipe
    else this.mode = this.pickMode();
    if(this.mode==='invaders' && !this.superRound && !this.invSession){ this.invSession=true; this.invWave=1; }
    const heads=Math.max(1,this.players.size);
    const sz=arenaSizeFor(this.mode==='invaders'?Math.round(heads*1.5):this.players.size); ARENA.w=sz.w; ARENA.h=sz.h;
    this.obstacles=buildObstacles(); const T=generateTerrain(); this.grid=T.grid; this.tcols=T.cols; this.trows=T.rows; this.terrainMeta={cols:T.cols,rows:T.rows,tile:TILE};
    { const sr=this.stageRect(); const ax=Math.floor((sr.x-TILE)/TILE), bx=Math.ceil((sr.x+sr.w+TILE)/TILE), ay=Math.floor((sr.y-TILE)/TILE), by=Math.ceil((sr.y+sr.h+TILE)/TILE);
      for(let ty=Math.max(0,ay);ty<Math.min(this.trows,by);ty++) for(let tx=Math.max(0,ax);tx<Math.min(this.tcols,bx);tx++) this.grid[ty][tx]=PLAIN; }   // holding area sits on plains
    this.emit({type:'mapchange'});
    if(!this.tournament || newSeries) this.assignTeams(this.mode);
    this.bots=[];
    if(this.superRound){ this.spawnEdgeBots(SUPER_BOTS_PER_PLAYER*heads); for(const b of this.bots){ b.fast=true; b.spdMul=1.5; } }
    else if(this.mode==='invaders'){ this.spawnEdgeBots((BOTS_PER_PLAYER+(this.invWave-1)*INV_STEP)*heads); this.applyInvadersWave(); }
    else if(!this.tournament){ this.rebalanceBots(); for(const b of this.bots) b.golden=(Math.random()<GOLD_BOT_CHANCE); }   // golden bots only in TDM/CTF
    for(const f of [...this.players.values(),...this.bots]){
      const st=this.stats(f);
      if(this.mode==='invaders' && !f.bot){ f.x=ARENA.w/2+rand(-70,70); f.y=ARENA.h/2+rand(-70,70); }      // Bot Invaders: team starts centered
      else if(!(this.mode==='invaders'&&f.bot)){ const s=this.teamSpawn(f.team); f.x=s.x; f.y=s.y; }   // edge-bots keep their edge spot
      f.aim=f.team==='blue'?0:Math.PI; f.maxhp=st.hp; f.hp=st.hp; f.alive=(f.bot?true:p_ready(f)); f.ammo=(this.mode==='invaders'?99999:st.ammoPool); f.clip=st.mag; f.reloading=false; f.reloadT=0; f.downed=false; f.downT=0; f.ultReady=!f.bot; f.ultActive=null; f.ultT=0; f.evacT=0; f.lsArmed=false; f.lsArmedT=0; f.lsActive=false; f.lsT=0; f.lsBy=null; f.lsRevive=3; f.cool=0; f.goldenArmed=false; f.goldenCD=0; f.mortar=false; f.mortarShots=0; f.mortarT=0; f.storeId=null; f.storeCD=0; f.botCD=0; f.roundKills=0; f.activeThisRound=false; f.spawnedThisRound=(f.bot?false:p_ready(f));
      f.mineCharges=(GADGETS[f.equip.gadget]&&GADGETS[f.equip.gadget].charges)||0;
      f.decoyCharges=f.equip.gadget==='decoy'?(GADGETS.decoy.charges):0;
      f.hasTurret=false;
    }
    if(this.mode==='ctf') this.setupFlags();
    if(newSeries){ this.pot=0; for(const p of this.players.values()){ if(this.getMoney(p)>=p.anteAmt){ this.addMoney(p,-p.anteAmt); this.pot+=p.anteAmt; p.anteIn=true; } } }
    else if(!this.tournament){ this.pot=0; for(const p of this.players.values()) p.anteIn=false; }
    this.emit({type:'roundstart',round:this.roundNum,pot:this.pot,mode:this.mode,tournament:this.tournament,modeName:this.modeName(),superRound:this.superRound,wave:this.invSession?this.invWave:0});
  }
  endRound(winner){
    this.phase='intermission'; this.phaseTimer=SHOP_TIME;
    for(const p of this.players.values()){ p.downed=false; p.downT=0; }
    const mode=this.mode;
    for(const p of this.players.values()){ if(!p.spawnedThisRound) continue;
      if(p.activeThisRound) p.afkRounds=0;
      else { p.afkRounds=(p.afkRounds||0)+1; if(p.afkRounds>=2 && p.ready!==false){ p.ready=false; p.afkRounds=0; this.emit({type:'afk',id:p.id,name:p.name}); this.emit({type:'msg',text:`${p.name} set to Sitting Out (inactive 2 rounds).`}); } } }
    if(mode==='invaders'){
      const bmul=this.superRound?2:1, cleared=(winner==='blue');
      for(const p of this.players.values()){ const bonus=((p.roundKills||0)*BOT_BONUS+(p.alive?SURVIVOR_BONUS:0))*bmul; if(bonus) this.addMoney(p,bonus); }
      if(this.superRound){ this.superRound=false; this.doubleRewards=false; this.emit({type:'msg',text:cleared?'SUPER Invaders cleared — double rewards paid!':'Super Invaders overran you.'}); }
      else if(cleared){
        if(this.invWave>(this.waveRecord.wave||0)){ let top=null; for(const pl of this.players.values()){ if(pl.bot)continue; if(!top||(pl.kills||0)>(top.kills||0)) top=pl; } this.waveRecord={wave:this.invWave,name:top?top.name:'—'}; this.emit({type:'msg',text:`New record! Wave ${this.invWave} reached by ${this.waveRecord.name}.`}); }
        this.invWave++; this.emit({type:'msg',text:`Wave cleared! Wave ${this.invWave} incoming…`}); }
      else { this.emit({type:'msg',text:`Overrun on wave ${this.invWave} — invasion reset.`}); this.invWave=1; this.invSession=false; }
    } else if(winner!=='tie' && !this.tournament){
      for(const p of this.players.values()) if(p.team===winner){ this.addMoney(p,ROUND_WIN_BONUS); if(p.alive) this.addMoney(p,SURVIVOR_BONUS); }
    }
    let seriesOver=false;
    if(this.tournament){
      if(winner!=='tie') this.roundsWon[winner]=(this.roundsWon[winner]||0)+1;
      if(this.roundsWon.blue>=TOURNEY_WINS||this.roundsWon.red>=TOURNEY_WINS){ seriesOver=true;
        const champ=this.roundsWon.blue>this.roundsWon.red?'blue':'red';
        const winners=[...this.players.values()].filter(p=>p.team===champ);
        if(this.pot>0&&winners.length){ const share=Math.floor(this.pot/winners.length); for(const p of winners) this.addMoney(p,share); this.emit({type:'msg',text:`🏆 ${champ.toUpperCase()} win the Tournament! Pot ${this.pot} — +${share} each.`}); }
        this.tournament=false; this.pot=0; this.roundsWon={blue:0,red:0};
        for(const p of this.players.values()){ p.anteIn=false; p.wantAnte=false; }
      }
    } else { this.roundsWon={blue:0,red:0}; for(const p of this.players.values()) p.anteIn=false; this.pot=0; }
    if(this.invSession || this.superNext) this.phaseTimer=8;   // quick breather between waves / into super
    this.placeLobby();
    this.emit({type:'roundend',winner,roundsWon:{...this.roundsWon},mode,tournament:this.tournament,seriesOver,modeName:this.modeName()});
  }
  stageRect(){ const w=Math.min(440,Math.round(ARENA.w*0.30)), h=Math.min(340,Math.round(ARENA.h*0.30)); return { x:Math.round(ARENA.w/2-w/2), y:Math.round(ARENA.h/2-h/2), w, h }; }
  stageZones(s){ s=s||this.stageRect(); const zw=Math.min(120,Math.round(s.w*0.22)), zh=Math.min(120,Math.round(s.h*0.26));
    return [ {id:'armory',name:'Armory',   x:Math.round(s.x+s.w*0.16),y:Math.round(s.y+s.h*0.60),w:zw,h:zh},
             {id:'equip', name:'Equipment',x:Math.round(s.x+s.w*0.62),y:Math.round(s.y+s.h*0.60),w:zw,h:zh} ]; }
  placeLobby(){ const s=this.stageRect(); let i=0; for(const p of this.players.values()){ p.x=s.x+s.w/2+((i%6)-2.5)*46; p.y=s.y+s.h-60; p.alive=true; p.zone=null; i++; } }
  moveInLobby(p,dt){
    const s=this.stageRect(), zs=this.stageZones(s);
    const m=Math.hypot(p.input.mx,p.input.my)||1;
    if(p.input.mx||p.input.my){ p.x+=p.input.mx/m*LOBBY_SPEED*dt; p.y+=p.input.my/m*LOBBY_SPEED*dt; }
    p.x=clamp(p.x,s.x+16+p.r,s.x+s.w-16-p.r); p.y=clamp(p.y,s.y+16+p.r,s.y+s.h-16-p.r);
    p.aim=p.input.aim;
    p.zone=null; for(const z of zs){ if(p.x>z.x&&p.x<z.x+z.w&&p.y>z.y&&p.y<z.y+z.h){ p.zone=z.id; break; } }
  }

  // ---- visibility (terrain + camo + vision) ----
  // elevation: mountain(3) > hill(2) > forest/trees(1) > plains/water/wasteland(0)
  tileHeight(code){ return code===MOUNT?3 : code===HILL?2 : code===FOREST?1 : 0; }
  losClear(v,t){   // a sightline is blocked by terrain as high as (or higher than) BOTH endpoints
    const vtx=Math.floor(v.x/TILE), vty=Math.floor(v.y/TILE), ttx=Math.floor(t.x/TILE), tty=Math.floor(t.y/TILE);
    const cap=Math.max(this.tileHeight(this.terrainCode(v.x,v.y)), this.tileHeight(this.terrainCode(t.x,t.y)));
    const r=this.revealOf(v);
    const dx=t.x-v.x, dy=t.y-v.y, d=Math.hypot(dx,dy)||1, steps=Math.ceil(d/16);
    for(let i=1;i<steps;i++){ const fr=i/steps, tx=Math.floor((v.x+dx*fr)/TILE), ty=Math.floor((v.y+dy*fr)/TILE);
      if((tx===vtx&&ty===vty)||(tx===ttx&&ty===tty)) continue;     // the two players' own tiles never block
      const c=this.grid[clamp(ty,0,this.trows-1)][clamp(tx,0,this.tcols-1)], h=this.tileHeight(c);
      if(h===0) continue;
      if(r==='both') continue;                   // satellite x-rays everything (exception)
      if(c===MOUNT && r==='mountain') continue;  // thermal sees through mountains (exception)
      if(c===FOREST && r==='forest') continue;   // gamma sees through forest (exception)
      if(h>=cap) return false; }                 // taller-or-equal occluder between you both blocks the line
    return true; }
  revealOf(f){ if(!f||!f.equip||!f.equip.chips) return null; let r=null; for(const c of f.equip.chips){ const cd=ARMOR_CHIPS[c]; if(cd&&cd.reveal){ if(cd.reveal==='both') return 'both'; r=cd.reveal; } } return r; }
  hasSat(f){ return !!(f&&f.equip&&f.equip.chips&&f.equip.chips.some(c=>ARMOR_CHIPS[c]&&ARMOR_CHIPS[c].sat)); }
  isCamo(f){ if(!f||!f.equip||!f.equip.chips||!f.equip.chips.some(c=>ARMOR_CHIPS[c]&&ARMOR_CHIPS[c].camo)) return false; const ct=(f.equip.camoTerrain==null?1:f.equip.camoTerrain); return this.terrainCode(f.x,f.y)===ct; }
  canSee(v,t){
    const d2=dist2(v.x,v.y,t.x,t.y);
    if(t.ultActive==='invis' && v.team!==t.team && d2>(5*TILE)*(5*TILE)) return false;   // cloak: invisible to enemies beyond 5 squares
    const sniper=!!(v && v.equip && WEAPONS[v.equip.weapon] && WEAPONS[v.equip.weapon].scope);
    if(sniper){ const ct=(v.cls==='Sniper')?this.classTierOf(v):1; const blind=(8-ct)*TILE; if(d2<=blind*blind) return false; return this.losClear(v,t); }   // sniper: blind up close (7 tiles -> 3 by CLASS tier), unlimited far if clear
    if(d2<=PROX*PROX) return true;                              // point-blank: always seen
    return this.losClear(v,t); }                                // elevation line-of-sight (camo is minimap-only)
  clearPath(ax,ay,bx,by){   // melee line: blocked only by terrain BETWEEN you (target's own tile is fine — hit them next to terrain, just not over it)
    const dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy)||1, steps=Math.ceil(d/14), gr=TILE*0.55;
    for(let i=1;i<steps;i++){ const tt=i/steps, x=ax+dx*tt, y=ay+dy*tt;
      if(Math.hypot(x-ax,y-ay)<gr || Math.hypot(x-bx,y-by)<gr) continue;
      const tc=this.terrainCode(x,y); if(tc===MOUNT||tc===HILL||tc===FOREST) return false; }
    return true; }
  clearShot(ax,ay,bx,by,pforest){   // can a shot reach the target without hitting blocking terrain?
    const dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy)||1, steps=Math.ceil(d/14);
    for(let i=1;i<=steps;i++){ const tt=i/steps, x=ax+dx*tt, y=ay+dy*tt;
      if((x-ax)*(x-ax)+(y-ay)*(y-ay)<625) continue;   // 25px origin grace
      const tc=this.terrainCode(x,y); if(tc===MOUNT||tc===HILL||(tc===FOREST&&!pforest)) return false; }
    return true; }

  nearestVisibleEnemy(f){ let best=null,bd=1e15; for(const o of [...this.players.values(),...this.bots]){ if(!o.alive||o.team===f.team) continue; if(!this.canSee(f,o)) continue; const d=dist2(f.x,f.y,o.x,o.y); if(d<bd){bd=d;best=o;} } return best; }
  nearestEnemy(f){ let best=null,bd=1e15; for(const o of [...this.players.values(),...this.bots]){ if(!o.alive||o.team===f.team) continue; const d=dist2(f.x,f.y,o.x,o.y); if(d<bd){bd=d;best=o;} } return best; }
  updateAI(f,dt){
    const st=this.stats(f); const ai=f.ai; ai.repath-=dt;
    if(!ai.target||!ai.target.alive||ai.repath<=0){ ai.target=this.nearestEnemy(f); ai.repath=rand(0.4,0.9); }   // hunt nearest enemy even with no line of sight
    const seen=this.nearestVisibleEnemy(f);                                                                        // only shoot what you can actually see
    let mvx=0,mvy=0; const tgt=ai.target;
    if(ai.modeT==null) ai.modeT=rand(1.5,4);                           // behavior phases so the swarm doesn't just ball up
    ai.modeT-=dt;
    if(ai.modeT<=0){ if(ai.mode==='roam'){ ai.mode='hunt'; ai.modeT=rand(2,5); } else if(Math.random()<0.35){ ai.mode='roam'; ai.modeT=rand(1.0,2.5); ai.roamDir=rand(0,6.28); } else { ai.modeT=rand(1.5,4); } }
    if(tgt){ const dx=tgt.x-f.x,dy=tgt.y-f.y,d=Math.hypot(dx,dy)||1;
      f.aim=Math.atan2((seen||tgt).y-f.y,(seen||tgt).x-f.x);
      if(ai.mode==='roam'){ ai.roamDir+=rand(-1,1)*dt*1.6; mvx+=Math.cos(ai.roamDir); mvy+=Math.sin(ai.roamDir); if(d>620){ mvx+=dx/d*0.5; mvy+=dy/d*0.5; } }   // peel off / strafe away for a few seconds (drift back if too far)
      else {
        const so=ai.standoff||(ai.standoff=Math.min(rand(60,260), st.range*0.7));   // each bot holds its own engagement distance -> loose cloud, not a tight ball
        if(d>so+25){ mvx+=dx/d; mvy+=dy/d; } else if(d<so-40){ mvx-=dx/d*0.8; mvy-=dy/d*0.8; }
        ai.jitter-=dt; if(ai.jitter<=0){ ai.strafe*=-1; ai.jitter=rand(0.25,0.85); ai.strafeAmt=(Math.random()<0.4? rand(1.2,1.7) : rand(0.45,0.9)); }
        const sAmt=ai.strafeAmt||0.5; mvx+=-dy/d*ai.strafe*sAmt; mvy+=dx/d*ai.strafe*sAmt;
        ai.wander+=rand(-1,1)*dt*3.2; mvx+=Math.cos(ai.wander)*0.34; mvy+=Math.sin(ai.wander)*0.34;
      }
    } else { const cx=ARENA.w/2, cy=ARENA.h/2, dx=cx-f.x, dy=cy-f.y, d=Math.hypot(dx,dy)||1;   // nobody left -> head to center
      if(d>60){ mvx=dx/d; mvy=dy/d; } else { mvx=Math.cos(ai.wander); mvy=Math.sin(ai.wander); ai.wander+=rand(-1,1)*dt; } f.aim=Math.atan2(dy,dx); }
    if(seen){ const sdx=seen.x-f.x, sdy=seen.y-f.y, sd=Math.hypot(sdx,sdy)||1; const pf=!!(WEAPONS[f.equip.weapon]&&WEAPONS[f.equip.weapon].scope);
      if(sd<st.range && this.clearShot(f.x,f.y,seen.x,seen.y,pf)){ f.aim=Math.atan2(sdy,sdx)+rand(-0.13,0.13); if(Math.random()<0.85) this.fire(f); if(f.equip.gadget==='mine'&&Math.random()<0.004) this.deploy(f); } }
    const m=Math.hypot(mvx,mvy)||1; const mult=st.jetpack?1:SPEED_MULT[this.terrainCode(f.x,f.y)]; const sp=st.speed*mult*0.95*(f.spdMul||1);
    f.x+=mvx/m*sp*dt; f.y+=mvy/m*sp*dt; this.collide(f);
  }

  collide(e){ for(const o of this.obstacles){ const nx=clamp(e.x,o.x,o.x+o.w),ny=clamp(e.y,o.y,o.y+o.h),dx=e.x-nx,dy=e.y-ny,d=Math.hypot(dx,dy);
    if(d<e.r){ if(d===0){e.x+=e.r;continue;} const push=e.r-d; e.x+=dx/d*push; e.y+=dy/d*push; } }
    e.x=clamp(e.x,e.r,ARENA.w-e.r); e.y=clamp(e.y,e.r,ARENA.h-e.r); }

  // ---- step ----
  step(dt){
    this.clock+=dt;
    if(this.phase==='intermission'){ this.phaseTimer-=dt; for(const p of this.players.values()) this.moveInLobby(p,dt); if(this.phaseTimer<=0){ if(this.readyCount()>0) this.startRound(); else this.phaseTimer=5; } return; }
    this.roundTimer-=dt;
    for(const p of this.players.values()){ if(!p.alive) continue; const st=this.stats(p);
      const m=Math.hypot(p.input.mx,p.input.my)||1;
      if((p.input.mx||p.input.my) && !p.mortar){ const mult=st.jetpack?1:SPEED_MULT[this.terrainCode(p.x,p.y)]; const sp=st.speed*mult; p.x+=p.input.mx/m*sp*dt; p.y+=p.input.my/m*sp*dt; }
      p.aim=p.input.aim; this.collide(p); if(p.input.reload) this.startReload(p); if(p.input.fire) this.fire(p); if(st.melee) this.autoMelee(p,st); }
    for(const b of this.bots){ if(b.alive) this.updateAI(b,dt); }
    const all=[...this.players.values(),...this.bots];
    for(const f of all){ if(f.cool>0) f.cool-=dt; if(f.goldenCD>0) f.goldenCD-=dt; if(f.swapCD>0) f.swapCD-=dt; if(f.storeCD>0) f.storeCD-=dt; if(f.botCD>0) f.botCD-=dt; if(f.mortar){ f.mortarT-=dt; if(f.mortarT<=0){ f.mortar=false; f.mortarShots=0; } }
      if(f.reloading){ f.reloadT-=dt; if(f.reloadT<=0){ f.reloading=false; const rs=this.stats(f); const unl=(this.mode==='invaders')||f.bot; f.clip=unl?rs.mag:Math.min(rs.mag,Math.max(0,f.ammo)); } }
      if(f.evacT>0){ f.evacT-=dt; if(f.evacT<=0) this.evacTeleport(f); }
      if(f.ultActive){ f.ultT-=dt; if(f.ultT<=0) f.ultActive=null; }
      if(f.lsArmed){ f.lsArmedT-=dt; if(f.lsArmedT<=0) f.lsArmed=false; }
      if(f.lsActive){ f.lsT-=dt; if(f.lsT<=0){ const at=f.lsBy; f.lsBy=null; this.killNow(f,at); } } }
    this.updateBalls(dt); if(this.balls.length>600) this.balls.splice(0,this.balls.length-600); this.updateMines(dt); this.updateTurrets(dt); this.updateStores(dt); if(this.mode==='ctf') this.updateFlags(dt);
    for(let i=this.decoys.length-1;i>=0;i--){ this.decoys[i].life-=dt; if(this.decoys[i].life<=0) this.decoys.splice(i,1); }
    const ba=this.aliveCount('blue'), ra=this.aliveCount('red');
    if(this.goldenEnded){ this.goldenEnded=false; this.endRound('tie'); return; }   // Golden bot down -> jump to Super Invaders
    const pendBalls=(los)=> this.balls.some(b=>b.team===los) && (this._endGrace=(this._endGrace||0)+dt) < 2.0;   // wiped team still has paint flying -> wait for it to land (chance to trade -> draw)
    if(![...this.players.values()].some(p=>p.alive)){            // all human players out
      if(this.balls.length && (this._endGrace=(this._endGrace||0)+dt) < 2.0) return;   // let the final shots land first
      this._endGrace=0; let w; if(this.mode==='ctf') w=this.caps.blue>this.caps.red?'blue':this.caps.red>this.caps.blue?'red':'tie'; else w=ba>ra?'blue':ra>ba?'red':'tie';
      this.endRound(w); return; }
    if(this.mode==='ctf'){
      if(this.caps.blue>=CAPTURE_TARGET){ this._endGrace=0; this.endRound('blue'); }
      else if(this.caps.red>=CAPTURE_TARGET){ this._endGrace=0; this.endRound('red'); }
      else if(ba===0&&ra===0){ this._endGrace=0; this.endRound('tie'); }   // total wipe -> decide by caps
      else if(this.roundTimer<=0){ this._endGrace=0; this.endRound(this.caps.blue>this.caps.red?'blue':this.caps.red>this.caps.blue?'red':'tie'); }   // CTF is won by CAPTURES, not by wiping the enemy team
      else this._endGrace=0;
    } else if(this.mode==='invaders'){
      if(ra===0) this.endRound('blue'); else if(this.roundTimer<=0) this.endRound('blue');   // cleared OR survived the timer -> next wave
    } else {
      if(this.roundTimer<=0){ this._endGrace=0; this.endRound(ba>ra?'blue':ra>ba?'red':'tie'); }
      else if(ba===0&&ra===0){ this._endGrace=0; this.endRound('tie'); }
      else if(ba===0||ra===0){ if(!pendBalls(ba>0?'red':'blue')){ this._endGrace=0; this.endRound(ba>ra?'blue':ra>ba?'red':'tie'); } }
      else this._endGrace=0;
    }
  }
  updateBalls(dt){
    const fighters=[...this.players.values(),...this.bots];
    for(let i=this.balls.length-1;i>=0;i--){ const b=this.balls[i];
      const nx=b.x+b.vx*b.speed*dt, ny=b.y+b.vy*b.speed*dt; b.life-=dt;
      let dead=b.life<=0, hitX=nx, hitY=ny;
      if(dead) this.emit({type:'splat',x:nx,y:ny,c:b.color});   // reached max range → splat on the ground
      if(!dead) for(const o of this.obstacles){ if(nx>o.x&&nx<o.x+o.w&&ny>o.y&&ny<o.y+o.h){ dead=true; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(!dead && !b.lob && dist2(b.x0,b.y0,nx,ny)>625){ const tc=this.terrainCode(nx,ny);   // blocked by mountains/hills/forest (sniper passes forest; lobbed grenades fly over)
        if(tc===MOUNT||tc===HILL||(tc===FOREST&&!b.pforest)){ dead=true; this.emit({type:'splat',x:nx,y:ny,c:b.color}); } }
      if(!dead) for(const f of fighters){ if(!f.alive||f.id===b.owner||f.team===b.team) continue;
        if(dist2(nx,ny,f.x,f.y)<(f.r+b.r)*(f.r+b.r)){ this.applyDamage(f,b.dmg,this.findById(b.owner),b.pierce); dead=true; hitX=f.x; hitY=f.y; break; } }
      if(!dead) for(const tr of this.turrets){ if(tr.team===b.team) continue; if(dist2(nx,ny,tr.x,tr.y)<(16+b.r)*(16+b.r)){ tr.hp-=1; dead=true; hitX=nx; hitY=ny; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(!dead) for(const s of this.stores){ if(s.team===b.team) continue; if(dist2(nx,ny,s.x,s.y)<(20+b.r)*(20+b.r)){ s.hp-=1; dead=true; hitX=nx; hitY=ny; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(!dead && !b.lob) for(let mi=this.mines.length-1;mi>=0;mi--){ const mn=this.mines[mi]; if(mn.team===b.team) continue; if(dist2(nx,ny,mn.x,mn.y)<(12+b.r)*(12+b.r)){ this.mines.splice(mi,1); dead=true; hitX=nx; hitY=ny; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(dead){ if(b.splash) this.splashDamage(hitX,hitY,b.splash,b.team,this.findById(b.owner),b.color); this.balls.splice(i,1); continue; }
      b.x=nx; b.y=ny;
    }
  }
  updateMines(dt){
    for(let i=this.mines.length-1;i>=0;i--){ const mn=this.mines[i]; if(mn.arm>0){ mn.arm-=dt; continue; }
      for(const f of [...this.players.values(),...this.bots]){ if(!f.alive||f.team===mn.team) continue;
        if(dist2(mn.x,mn.y,f.x,f.y)<=mn.r*mn.r){ this.splashDamage(mn.x,mn.y,mn.r,mn.team,this.findById(mn.owner),PAINT.splash); this.emit({type:'boom',x:mn.x,y:mn.y}); this.mines.splice(i,1); break; } }
    }
  }
  updateTurrets(dt){
    for(let i=this.turrets.length-1;i>=0;i--){ const tr=this.turrets[i]; if(tr.cool>0) tr.cool-=dt;
      if(tr.hp<=0){ this.emit({type:'boom',x:tr.x,y:tr.y}); this.turrets.splice(i,1); continue; }   // no timeout: lives until splatted
      let best=null,bd=tr.range*tr.range;
      for(const f of [...this.players.values(),...this.bots]){ if(!f.alive||f.team===tr.team) continue;
        const d=dist2(tr.x,tr.y,f.x,f.y); if(d<bd && this.canSee(tr,f)){ bd=d; best=f; } }
      if(best && tr.cool<=0){ const spread=tr.kind==='rocket'?0.12:(tr.kind==='grenade'?0.16:0.20);   // imperfect aim: keep moving and you can dodge turret fire
        const ang=Math.atan2(best.y-tr.y,best.x-tr.x)+(Math.random()-0.5)*spread*2; const sx=tr.x+Math.cos(ang)*18, sy=tr.y+Math.sin(ang)*18;
        if(tr.kind==='grenade'){ tr.cool=2.0; this.balls.push({x:sx,y:sy,x0:tr.x,y0:tr.y,vx:Math.cos(ang),vy:Math.sin(ang),speed:130,dmg:1,team:tr.team,owner:tr.owner,life:tr.range/130,color:'#caa44a',r:6,pierce:false,splash:48,lob:true}); }
        else if(tr.kind==='rocket'){ tr.cool=3.4; this.balls.push({x:sx,y:sy,x0:tr.x,y0:tr.y,vx:Math.cos(ang),vy:Math.sin(ang),speed:220,dmg:1,team:tr.team,owner:tr.owner,life:tr.range/220,color:'#ff7b00',r:7,pierce:false,splash:130}); }
        else { tr.cool=1.0; this.balls.push({x:sx,y:sy,x0:tr.x,y0:tr.y,vx:Math.cos(ang),vy:Math.sin(ang),speed:760,dmg:1,team:tr.team,owner:tr.owner,life:tr.range/760,color:tr.team==='blue'?'#3da9fc':'#ff5470',r:5,pierce:false,splash:0}); } }
    }
  }
  updateStores(dt){ for(let i=this.stores.length-1;i>=0;i--){ const s=this.stores[i]; if(s.hp<=0){ this.emit({type:'boom',x:s.x,y:s.y}); const ow=this.findById(s.owner); if(ow){ ow.storeId=null; ow.storeCD=8; } this.stores.splice(i,1); } } }
  // turrets need an equip.vision lookup in canSee; give them a stub
  findById(id){ return this.players.get(id)||this.bots.find(b=>b.id===id)||null; }

  emit(ev){ this.events.push(ev); if(this.events.length>200) this.events.splice(0,this.events.length-200); }
  drainEvents(){ const e=this.events; this.events=[]; return e; }

  // ---- snapshot ----
  publicFighter(f){ return {id:f.id,n:f.name,tm:f.team,cls:f.cls,x:Math.round(f.x),y:Math.round(f.y),a:+f.aim.toFixed(2),hp:Math.max(0,Math.round(f.hp)),mh:f.maxhp,al:f.alive,bot:f.bot,
    cam:this.isCamo(f)?1:0, jet:f.equip&&f.equip.gadget==='jetpack'?1:0, gold:f.golden?1:0, fast:f.fast?1:0, sh:f.shield||0, dn:f.downed?1:0, ult:(f.ultActive||(f.evacT>0?'evac':null)), ls:f.lsActive?1:0}; }
  snapshot(id,events){
    const me=this.players.get(id); const spectate=me&&!me.alive&&this.phase==='active';
    const lobby=this.phase==='intermission';
    const out=[];
    if(lobby){ for(const p of this.players.values()) out.push(this.publicFighter(p)); }
    else for(const f of [...this.players.values(),...this.bots]){ if(!f.alive) continue;
      if(!me){ out.push(this.publicFighter(f)); continue; }
      if(f.team===me.team||f.id===me.id){ out.push(this.publicFighter(f)); continue; }
      if(spectate||this.canSee(me,f)) out.push(this.publicFighter(f)); }
    // radar (minimap): always show bots; enemy players only if visible or fired in the last 3s
    const radar=[];
    if(!lobby) for(const f of [...this.players.values(),...this.bots]){ if(!f.alive) continue;
      const friendly = me ? (f.team===me.team) : true;
      const recent = me ? ((this.clock-(f.firedT||-99))<3) : true;
      const vis = me ? this.canSee(me,f) : true;
      const sat = me ? (this.hasSat(me) && !this.isCamo(f)) : false;
      const invisFar = me && !friendly && f.ultActive==='invis' && dist2(me.x,me.y,f.x,f.y)>(5*TILE)*(5*TILE);
      if(!invisFar && (friendly || f.bot || vis || recent || sat)) radar.push({x:Math.round(f.x),y:Math.round(f.y),tm:f.team,me:(me&&f.id===me.id)?1:0}); }
    const turrets=this.turrets.map(t=>({id:t.id,x:Math.round(t.x),y:Math.round(t.y),tm:t.team,hp:t.hp,mh:t.maxhp,k:t.kind||'base'}));
    const stores=this.stores.map(s=>({id:s.id,x:Math.round(s.x),y:Math.round(s.y),tm:s.team,hp:s.hp,mh:s.maxhp,lvl:s.level,mine:(me&&s.owner===me.id)?1:0}));
    const decoys=this.decoys.map(d=>({id:d.id,x:Math.round(d.x),y:Math.round(d.y),tm:d.team,cls:d.cls}));
    let mines=[]; if(me){ const REV=(3.2*TILE)*(3.2*TILE); for(const m of this.mines){ if(m.team===me.team) mines.push({x:Math.round(m.x),y:Math.round(m.y),mine:1,armed:m.arm<=0?1:0}); else if(dist2(m.x,m.y,me.x,me.y)<=REV) mines.push({x:Math.round(m.x),y:Math.round(m.y),foe:1}); } }
    let you=null;
    if(me){ const st=this.stats(me); const li=levelInfo(this.getXp(me));
      you={ id:me.id,name:me.name,cls:me.cls,team:me.team,hp:Math.max(0,Math.round(me.hp)),maxhp:me.maxhp,alive:me.alive,downed:!!me.downed,downFrac:(me.downed?Math.max(0,Math.min(1,me.downT/LAST_GASP)):0),
        ammo:(this.mode==='invaders'?-1:me.ammo),mag:st.ammoPool,clip:(me.clip==null?st.mag:me.clip),clipMax:st.mag,melee:!!st.melee,reloading:!!me.reloading,reloadFrac:(me.reloading&&st.reload>0?Math.max(0,Math.min(1,1-me.reloadT/st.reload)):1),kills:me.kills,deaths:me.deaths,money:this.getMoney(me),
        x:Math.round(me.x),y:Math.round(me.y),terrain:this.terrainCode(me.x,me.y),wantAnte:me.wantAnte,anteIn:me.anteIn,
        level:li.level, xpInto:li.into, xpNeed:li.need, unlockLevel:CLASS_UNLOCK_LEVEL, classUnlocked:li.level>=CLASS_UNLOCK_LEVEL,
        deflect:st.deflect, zone:me.zone||null, equip:me.equip, owned:this.ownedSet(me.key), inv:this.inv[me.key]||{}, fastAmmo:((this.ammoStock[me.key]||{}).fast||0), ammoSel:(me.equip.ammo||'none'), mineCharges:me.mineCharges, hasTurret:me.hasTurret, gadget:me.equip.gadget, weight:(st.weight + (me.equip.weapon2&&me.equip.weapon2!=='none'?(WEAPON_WT+modW(me.equip.wmods2)):0)), weightCap:weightCapacity(li.level), golden:st.golden, goldenReady:(me.goldenCD||0)<=0, goldenArmed:!!me.goldenArmed, anteAmt:me.anteAmt||100, wantAnte:me.wantAnte, ready:me.ready!==false, modeVotes:me.modeVotes||{}, tiers:this.tiers[me.key]||{}, classTiers:this.classTiers[me.key]||{}, classTier:this.classTierOf(me), ult:(CLASSES[me.cls]&&CLASSES[me.cls].ult)||null, ultReady:!!me.ultReady, ultActive:me.ultActive||null, ultT:Math.max(0,me.ultT||0), evacT:Math.max(0,me.evacT||0), lsArmed:!!me.lsArmed, lsArmedT:Math.max(0,me.lsArmedT||0), lsActive:!!me.lsActive, lsT:Math.max(0,me.lsT||0), mortar:!!me.mortar, mortarShots:me.mortarShots||0, eng:(me.cls==='Engineer'?(()=>{ const sl=this.engStoreLevel(me); return { storeLevel:sl, turretType:me.turretType||'base', turrets:this.engTurrets(me.id), bots:this.engBots(me.id), maxBots:this.engBotCap(me), costs:ENG_COST, upCost:(ENG_STORE_UP[sl+1]||0), botCD:Math.max(0,Math.ceil(me.botCD||0)) }; })():null), camoTerrain:(me.equip.camoTerrain==null?1:me.equip.camoTerrain), camoActive:this.isCamo(me)?1:0, spd:Math.round(st.speed*(me.equip.gadget==='jetpack'?1:(SPEED_MULT[this.terrainCode(me.x,me.y)]||1))) }; }
    let stage=null; if(lobby){ stage=this.stageRect(); stage.zones=this.stageZones(stage); stage.record=this.waveRecord; }
    return { t:'state', you, fighters:out, radar, balls:this.balls.filter(b=>{ if(!me) return true; const R=(WEAPONS[me.equip.weapon]&&WEAPONS[me.equip.weapon].scope)?2800:1600; return ((b.x-me.x)*(b.x-me.x)+(b.y-me.y)*(b.y-me.y))<R*R; }).map(b=>({x:Math.round(b.x),y:Math.round(b.y),c:b.color})),
      turrets, mines, decoys, stores, space:'arena', stage, phase:this.phase, phaseTimer:Math.max(0,Math.round(this.phaseTimer)),
      roundTime:Math.max(0,Math.round(this.roundTimer)), round:this.roundNum, roundsWon:this.roundsWon,
      alive:{blue:this.aliveCount('blue'),red:this.aliveCount('red')}, pot:this.pot, buyIn:BUY_IN, anteState:(()=>{ const ps=[...this.players.values()]; const inP=ps.filter(p=>p.wantAnte); const amounts=[...new Set(inP.map(p=>p.anteAmt))].sort((a,b)=>a-b); return { total:ps.length, in:inP.length, amounts, ready:this.allAnted() }; })(),
      mode:this.mode, modeName:this.modeName(), tournament:this.tournament, caps:{...this.caps}, captureTarget:CAPTURE_TARGET, tourneyWins:TOURNEY_WINS, wave:this.invSession?this.invWave:0, superRound:this.superRound,
      flags:this.flags.map(fl=>({team:fl.team,x:Math.round(fl.x),y:Math.round(fl.y),home:fl.atHome,carried:!!fl.carrier})), anteOptions:ANTE_OPTIONS, modes:this.modeVoteState(),
      events:(events||[]).filter(e=>(!e.teamOnly||(me&&e.team===me.team)) && (!e.to||(me&&e.to===me.id))) };
  }
}

// turrets are passed to canSee as a "viewer"; give them an equip stub so concealed/canReveal work
const _origCanSee = Game.prototype.canSee;
Game.prototype.canSee = function(v,t){ if(v && !v.equip) v.equip={chips:[],wmods:[]}; return _origCanSee.call(this,v,t); };

module.exports = { Game, BUILD, CLASSES, CLASS_KEYS, CATALOG, CATS, WEAPONS, WEAPON_MODS, ARMOR_CHIPS, GADGETS, AMMO, weightCapacity, HEAVY_CLASSES, WMOD_SLOTS, CHIP_SLOTS, MAX_CAMO, BASE_AMMO, WEAPON_WT, BOT_SPLAT_REWARD,
  ARENA, TILE, SPEED_MULT, LOBBY, LOBBY_ZONES, buildObstacles, levelInfo, PLAIN, FOREST, WATER, MOUNT,
  NEW_WALLET, SPLAT_REWARD, BUY_IN, ROUND_WIN_BONUS, SURVIVOR_BONUS, SHOP_TIME, ROUND_TIME, TEAM_SIZE, CLASS_UNLOCK_LEVEL, CLASS_UNLOCK };
