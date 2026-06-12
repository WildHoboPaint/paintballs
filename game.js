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
const NEW_WALLET=300, SPLAT_REWARD=15, ROUND_WIN_BONUS=120, SURVIVOR_BONUS=60;
const BUY_IN=100, SHOP_TIME=25, ROUND_TIME=120, TEAM_SIZE=5;
const MODES=['tdm','ctf','invaders'];                 // casual rounds pick one at random
const MODE_NAMES={tdm:'Team Deathmatch', ctf:'Capture the Flag', invaders:'Bot Invaders', tournament:'Tournament'};
const BOTS_PER_PLAYER=6;                               // Bot Invaders swarm size
const BOT_BONUS=10;                                    // coins per bot splatted (invaders survival reward)
const CAPTURE_TARGET=3;                                // CTF captures to win
const TOURNEY_WINS=3;                                  // best of 5
const ANTE_OPTIONS=[100,500,1000];                    // selectable buy-in amounts
const LEVELUP_BONUS=40;                 // coins per level gained

// progression
const CLASS_UNLOCK_LEVEL=10, LVL_BASE=2, LVL_STEP=1;   // splats to go L->L+1 = LVL_BASE+(L-1)*LVL_STEP
function levelInfo(xp){
  let lvl=1, acc=0;
  while(lvl<99){ const req=LVL_BASE+(lvl-1)*LVL_STEP; if(xp>=acc+req){ acc+=req; lvl++; } else break; }
  const req=LVL_BASE+(lvl-1)*LVL_STEP;
  return { level:lvl, into:xp-acc, need:req };
}

// ---- classes: base body stats + which weapons/gear they may equip ----
const CLASSES = {
  Trooper:    { hp:100, speed:185, color:'#cbd5e1', defWeapon:'pball_gun',
                weapons:['pball_gun','pball_rifle','shotgun'], gear:['mine'],
                desc:"Starter all-rounder. Everyone begins here." },
  VetTrooper: { hp:115, speed:185, color:'#7dd3fc', defWeapon:'pball_rifle',
                weapons:['pball_gun','pball_rifle','assault_rifle','grenade_launcher','shotgun'], gear:['mine','turret'],
                desc:"Seasoned trooper. Better gear access." },
  HeavyWeapons:{hp:175, speed:130, color:'#ff8c42', defWeapon:'minigun',
                weapons:['minigun','bazooka','grenade_launcher','shotgun','pball_rifle'], gear:['mine'],
                desc:"Walking tank. Minigun & bazooka, heavy armor." },
  Scout:      { hp:80,  speed:240, color:'#9b5de5', defWeapon:'auto_pistol',
                weapons:['auto_pistol','pball_gun'], gear:['jetpack','mine'],
                desc:"Fast recon. Vision gear & jetpack." },
  Infiltrator:{ hp:90,  speed:205, color:'#06d6a0', defWeapon:'blowgun',
                weapons:['blowgun','auto_pistol','pball_gun'], gear:['mine','decoy'],
                desc:"Silent stealth. Camo, blowgun, mines." },
  Sniper:     { hp:80,  speed:160, color:'#ef476f', defWeapon:'sniper_rifle',
                weapons:['sniper_rifle','pball_rifle'], gear:['mine'],
                desc:"Long-range one-shot specialist." },
  Engineer:   { hp:115, speed:170, color:'#ffd166', defWeapon:'pball_gun',
                weapons:['pball_gun','shotgun','pball_rifle'], gear:['turret','mine'],
                desc:"Builds turrets & lays mines." },
  Officer:    { hp:120, speed:185, color:'#3da9fc', defWeapon:'assault_rifle',
                weapons:['assault_rifle','auto_pistol','pball_rifle'], gear:['turret'],
                desc:"Command. Satellite vision, assault rifle." },
};
const CLASS_KEYS = Object.keys(CLASSES);

// ---- catalog (modern, flat). cost 0 = free/default. classes:'all' or list. ----
const WEAPONS = {
  pball_gun:    { name:"Paintball Gun",    cost:0,    dmg:1, fireRate:850, spread:0.05, mag:10, range:260, reload:1.6, proj:1, desc:"Short range starter — upgrade to reach further." },
  pball_rifle:  { name:"Paintball Rifle",  cost:350,  dmg:1, fireRate:650, spread:0.035,mag:12, range:420, reload:1.7, proj:1, desc:"More range and a steadier shot." },
  assault_rifle:{ name:"Assault Rifle",    cost:1000, dmg:1, fireRate:260, spread:0.06, mag:24, range:380, reload:1.9, proj:1, desc:"Rapid fire, medium range." },
  sniper_rifle: { name:"Sniper Rifle",     cost:1200, dmg:1, fireRate:1300,spread:0.004,mag:5,  range:780, reload:2.0, proj:1, scope:true, desc:"Long-range specialist, very slow." },
  minigun:      { name:"Minigun",          cost:1500, dmg:1, fireRate:130, spread:0.12, mag:80, range:340, reload:3.0, proj:1, desc:"Torrent of paint, short range." },
  bazooka:      { name:"Rocket Launcher",  cost:1500, dmg:1, fireRate:1700,spread:0.03, mag:4,  range:600, reload:2.8, proj:1, splash:110, desc:"Long-range rocket, big area splat." },
  grenade_launcher:{ name:"Grenade Launcher", cost:1300, dmg:1, fireRate:1400, spread:0.05, mag:5, range:360, reload:2.4, proj:1, splash:96, desc:"Lobbed grenade — ~6-tile splat, medium range." },
  shotgun:      { name:"Shotgun",          cost:800,  dmg:1, fireRate:900, spread:0.32, mag:6,  range:190, reload:1.9, proj:3, desc:"3-pellet spread, very short range." },
  blowgun:      { name:"Blowgun",          cost:600,  dmg:1, fireRate:750, spread:0.025,mag:10, range:360, reload:1.5, proj:1, silent:true, desc:"Silent darts, medium range." },
  auto_pistol:  { name:"Auto Pistol",      cost:500,  dmg:1, fireRate:380, spread:0.05, mag:12, range:250, reload:1.2, proj:1, desc:"Quick, light, short range." },
};
const ARMOR = {
  none:   { name:"No Armor",      cost:0,    deflect:0,    spd:1.0,  desc:"No protection — one hit ends your round." },
  light:  { name:"Light Armor",   cost:500,  deflect:0.25, spd:0.95, desc:"25% chance a paintball bounces off." },
  medium: { name:"Medium Armor",  cost:1500, deflect:0.40, spd:0.88, desc:"40% bounce chance, a bit slower." },
  heavy:  { name:"Heavy Armor",   cost:3000, deflect:0.55, spd:0.80, desc:"55% bounce chance, noticeably slower." },
};
const VISION = {
  none:    { name:"No Optics",       cost:0,    desc:"Standard sight." },
  thermal: { name:"Thermal Optics",  cost:2500, reveal:'mountain', desc:"Spot enemies hidden on mountains." },
  gamma:   { name:"Gamma Optics",    cost:2500, reveal:'forest',  desc:"See enemies hidden in forest & hills." },
  satellite:{name:"Satellite Uplink",cost:4000, reveal:'both',    desc:"See every concealed enemy." },
};
const CAMO = {
  none:     { name:"No Camo",       cost:0,   terrain:-1, desc:"No concealment bonus." },
  forest:   { name:"Forest Camo",   cost:400, terrain:FOREST, desc:"Hidden at range while in forest." },
  mountain: { name:"Mountain Camo", cost:400, terrain:MOUNT,  desc:"Hidden at range while on mountains." },
  water:    { name:"Water Camo",    cost:400, terrain:WATER,  desc:"Hidden at range while in water." },
  plains:   { name:"Plains Camo",   cost:400, terrain:PLAIN,  desc:"Hidden at range while on plains." },
};
const GADGETS = {
  none:   { name:"No Gadget",  cost:0,    desc:"Empty gadget slot." },
  mine:   { name:"Paint Mines",cost:300,  charges:2, desc:"Press G to drop. Detonates on enemies (2/round)." },
  turret: { name:"Auto Turret",cost:1200, desc:"Press G to deploy. Auto-fires at enemies (1/round)." },
  jetpack:{ name:"Jetpack",    cost:1500, passive:true, desc:"Ignore terrain slowdown (passive)." },
  decoy:  { name:"Decoy",      cost:400,  charges:2, desc:"Press G to drop a fake clone (2/round)." },
};
const AMMO = {
  normal: { name:"Standard Paint", cost:0,   speed:220, rangeMul:1.0,  pierce:false, desc:"Slow, lobbed paint." },
  fast:   { name:"Fast Paint",     cost:600, speed:380, rangeMul:1.15, pierce:false, desc:"Noticeably faster and longer." },
  ap:     { name:"Armor-Piercing", cost:900, speed:260, rangeMul:1.0,  pierce:true,  desc:"Ignores armor's bounce chance." },
};
const CATALOG = { weapon:WEAPONS, armor:ARMOR, vision:VISION, camo:CAMO, gadget:GADGETS, ammo:AMMO };
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
    this.players=new Map(); this.bots=[]; this.balls=[]; this.mines=[]; this.turrets=[]; this.decoys=[];
    this.events=[]; this.nextId=1;
    this.roundsWon={blue:0,red:0}; this.pot=0; this.mode='tdm'; this.tournament=false; this.flags=[]; this.caps={blue:0,red:0};
    this.wallets=(saved&&saved.wallets)?Object.assign({},saved.wallets):{};
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
    return !p.bot && this.ownedSet(p.key).includes(cat+':'+id); }
  serialize(){ return { wallets:this.wallets, owned:this.owned, xp:this.xp, accounts:this.accounts }; }
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
  deflectChance(p){ return (ARMOR[p.equip.armor]||ARMOR.none).deflect||0; }
  stats(p){
    const cls=CLASSES[p.cls]; const w=this.weaponOf(p); const arm=ARMOR[p.equip.armor]||ARMOR.none; const am=AMMO[p.equip.ammo]||AMMO.normal;
    const jet = p.equip.gadget==='jetpack';
    return {
      hp:1, speed:cls.speed*arm.spd*SPEED_SCALE, color:cls.color, deflect:arm.deflect||0,
      dmg:1, fireRate:w.fireRate, spread:w.spread, mag:w.mag, reload:w.reload, proj:w.proj||1,
      range:w.range*(am.rangeMul||1), splash:w.splash||0, silent:!!w.silent,
      ammoSpeed:am.speed||760, pierce:!!am.pierce, jetpack:jet,
    };
  }

  // ---- spawning ----
  teamSpawn(team){ const yr=()=>rand(120,ARENA.h-120); return team==='blue'?{x:rand(80,180),y:yr()}:{x:rand(ARENA.w-180,ARENA.w-80),y:yr()}; }
  defaultEquip(cls){ return { weapon:CLASSES[cls].defWeapon, armor:'none', vision:'none', camo:'none', gadget:'none', ammo:'normal' }; }
  newFighter(team,cls,isBot){
    const s=this.teamSpawn(team);
    const f={ id:this.nextId++, bot:!!isBot, team, cls, x:s.x,y:s.y,r:14,aim:team==='blue'?0:Math.PI,
      hp:1,maxhp:1,alive:true, ammo:0,reloading:false,reloadT:0,cool:0, kills:0,deaths:0,
      wantAnte:false, anteIn:false, zone:null, equip:this.defaultEquip(cls), mineCharges:0, decoyCharges:0, hasTurret:false,
      ammoStock:{fast:0,ap:0}, roundKills:0, anteAmt:100, ready:true, activeThisRound:false, afkRounds:0, spawnedThisRound:false,
      input:{mx:0,my:0,aim:0,fire:false,reload:false,deploy:false},
      ai:{target:null,repath:0,strafe:Math.random()<.5?1:-1,jitter:0,wander:rand(0,6.28)},
      name:isBot?BOTNAMES[(NAMEI++)%BOTNAMES.length]:'Player', key:null };
    if(isBot){ // give bots some variety/loadout
      const cw=CLASSES[cls].weapons; f.equip.weapon=cw[Math.floor(rand(0,cw.length))];
    }
    const st=this.stats(f); f.maxhp=st.hp; f.hp=st.hp; f.ammo=st.mag;
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
    if(cls && CLASSES[cls] && this.getLevel(f)>=CLASS_UNLOCK_LEVEL) f.cls=cls;
    f.equip=this.defaultEquip(f.cls);
    const st=this.stats(f); f.maxhp=st.hp; f.hp=st.hp; f.ammo=st.mag;
    if(this.phase==='active') f.alive=false;
    else { const s=this.stageRect(); f.x=s.x+s.w/2+((this.players.size%6)-2.5)*46; f.y=s.y+s.h-60; f.alive=true; f.zone=null; }
    this.players.set(f.id,f); this.rebalanceBots();
    this.emit({type:'msg',text:`${f.name} joined ${f.team.toUpperCase()} (Lv ${this.getLevel(f)}).`});
    return f.id;
  }
  removeHuman(id){ const p=this.players.get(id); if(!p) return; if(p.anteIn) this.pot=Math.max(0,this.pot-BUY_IN); this.players.delete(id); this.rebalanceBots(); }
  smallerTeam(){ let b=0,r=0; for(const p of this.players.values()) p.team==='blue'?b++:r++; return b<=r?'blue':'red'; }
  countTeam(t){ let n=0; for(const p of this.players.values()) if(p.team===t)n++; for(const b of this.bots) if(b.team===t)n++; return n; }
  aliveCount(t){ let n=0; for(const p of this.players.values()) if(p.team===t&&p.alive)n++; for(const b of this.bots) if(b.team===t&&b.alive)n++; return n; }
  rebalanceBots(){ for(const team of ['blue','red']){ let need=TEAM_SIZE-this.countTeam(team);
    while(need>0){ const ck=CLASS_KEYS[Math.floor(rand(0,CLASS_KEYS.length))]; this.bots.push(this.newFighter(team,ck,true)); need--; }
    while(need<0){ const i=this.bots.findIndex(b=>b.team===team); if(i<0)break; this.bots.splice(i,1); need++; } } }

  // ---- input / class / shop ----
  setInput(id,inp){ const p=this.players.get(id); if(!p) return;
    p.input.mx=clamp(+inp.mx||0,-1,1); p.input.my=clamp(+inp.my||0,-1,1);
    p.input.aim=+inp.aim||0; p.input.aimDist=Math.max(0,+inp.aimDist||0); p.input.fire=!!inp.fire; if(inp.reload) this.reload(p); if(inp.deploy) this.deploy(p);
    if(this.phase==='active' && (p.input.mx||p.input.my||p.input.fire)) p.activeThisRound=true; }
  setClass(id,cls){ const p=this.players.get(id); if(!p||!CLASSES[cls]) return {ok:false,msg:'bad class'};
    if(cls!=='Trooper' && this.getLevel(p)<CLASS_UNLOCK_LEVEL) return {ok:false,msg:`Unlocks at level ${CLASS_UNLOCK_LEVEL}`};
    p.cls=cls; p.equip=this.defaultEquip(cls);
    const st=this.stats(p); p.maxhp=st.hp; if(this.phase!=='active') p.hp=st.hp; p.ammo=st.mag; p.reloading=false; p.cool=0;
    return {ok:true}; }
  canEquip(p,cat,id){ const def=CATALOG[cat][id]; if(!def) return false;
    if(cat==='weapon' && !CLASSES[p.cls].weapons.includes(id)) return false;
    if(cat==='gadget' && id!=='none' && !CLASSES[p.cls].gear.includes(id)) return false;
    return true; }
  buy(id,catid){
    const p=this.players.get(id); if(!p) return {ok:false,msg:'no player'};
    const [cat,item]=String(catid).split(':'); const def=CATALOG[cat]&&CATALOG[cat][item];
    if(!def) return {ok:false,msg:'no such item'};
    // ammo is consumable, not owned permanently: standard is free, fast/AP buy limited stock
    if(cat==='ammo'){
      if(!p.ammoStock) p.ammoStock={fast:0,ap:0};
      if(item==='normal'){ p.equip.ammo='normal'; return {ok:true,money:this.getMoney(p),ammoStock:p.ammoStock,msg:'Standard paint equipped'}; }
      if(this.getMoney(p)<def.cost) return {ok:false,money:this.getMoney(p),ammoStock:p.ammoStock,msg:'not enough Paint Coins'};
      this.addMoney(p,-def.cost); p.ammoStock[item]+=(AMMO_STOCK[item]||0); p.equip.ammo=item;
      this.emit({type:'msg',text:`${p.name} bought ${def.name} (+${AMMO_STOCK[item]} rounds).`});
      return {ok:true,money:this.getMoney(p),ammoStock:p.ammoStock,msg:`Bought ${def.name}`};
    }
    if(!this.canEquip(p,cat,item)) return {ok:false,money:this.getMoney(p),msg:`${p.cls} can't use that`};
    if(this.owns(p,cat,item)) { this.equip(id,catid); return {ok:true,money:this.getMoney(p),msg:'Equipped'}; }
    if(this.getMoney(p)<def.cost) return {ok:false,money:this.getMoney(p),msg:'not enough Paint Coins'};
    this.addMoney(p,-def.cost); this.ownedSet(p.key).push(cat+':'+item);
    this.equip(id,catid);
    this.emit({type:'msg',text:`${p.name} bought ${def.name}.`});
    return {ok:true,money:this.getMoney(p),msg:`Bought ${def.name}`};
  }
  equip(id,catid){
    const p=this.players.get(id); if(!p) return {ok:false};
    const [cat,item]=String(catid).split(':'); if(!CATALOG[cat]||!CATALOG[cat][item]) return {ok:false};
    if(cat==='ammo'){ if(item!=='normal' && (!p.ammoStock||p.ammoStock[item]<=0)) return {ok:false,msg:'no stock — buy more'}; p.equip.ammo=item; return {ok:true,ammoStock:p.ammoStock}; }
    if(!this.owns(p,cat,item)) return {ok:false,msg:'not owned'};
    if(!this.canEquip(p,cat,item)) return {ok:false,msg:'cannot equip'};
    p.equip[cat]=item;
    const st=this.stats(p); p.maxhp=st.hp; if(this.phase!=='active') p.hp=Math.min(p.hp,st.hp); p.ammo=Math.min(p.ammo,st.mag);
    return {ok:true};
  }
  setAnte(id,on,amt){ const p=this.players.get(id); if(!p) return {ok:false}; p.wantAnte=!!on; if(amt!==undefined){ const a=+amt; if(ANTE_OPTIONS.includes(a)) p.anteAmt=a; } return {ok:true,wantAnte:p.wantAnte,anteAmt:p.anteAmt}; }
  setReady(id,on){ const p=this.players.get(id); if(!p) return {ok:false}; p.ready=!!on; if(p.ready) p.afkRounds=0; return {ok:true,ready:p.ready}; }
  readyCount(){ let n=0; for(const p of this.players.values()) if(p.ready!==false) n++; return n; }

  // ---- combat ----
  reload(f){ if(f.reloading||!f.alive) return; const st=this.stats(f); if(f.ammo>=st.mag) return; f.reloading=true; f.reloadT=st.reload; }
  fire(f){
    if(!f.alive||f.reloading||f.cool>0) return;
    if(f.ammo<=0){ this.reload(f); return; }
    // consumable special ammo: fast/AP draw from a limited stock, then fall back to standard
    let ammoId=f.equip.ammo;
    if(ammoId==='fast'||ammoId==='ap'){
      if(!f.ammoStock || f.ammoStock[ammoId]<=0){ const was=ammoId; f.equip.ammo='normal'; ammoId='normal';
        this.emit({type:'msg',text:`${f.name} is out of ${was==='fast'?'Fast Paint':'AP Paint'} — back to Standard.`}); }
    }
    const st=this.stats(f);
    const wdef=WEAPONS[f.equip.weapon]||WEAPONS[CLASSES[f.cls].defWeapon];
    f.cool=st.fireRate/1000; f.ammo--; f.firedT=this.clock;
    if(ammoId==='fast'||ammoId==='ap'){ f.ammoStock[ammoId]=Math.max(0,f.ammoStock[ammoId]-(st.proj||1)); }
    const pf=!!(wdef&&wdef.scope);                       // sniper rounds pass through forest
    const col=paintColor(wdef,ammoId);
    const reach=Math.min(st.range, (f.input&&f.input.aimDist>0)?f.input.aimDist:st.range);  // shoot short if you aim short
    for(let i=0;i<st.proj;i++){
      const ang=f.aim+(Math.random()-0.5)*st.spread*2;
      this.balls.push({ x:f.x+Math.cos(f.aim)*(f.r+6), y:f.y+Math.sin(f.aim)*(f.r+6), x0:f.x, y0:f.y, pforest:pf,
        vx:Math.cos(ang),vy:Math.sin(ang),speed:st.ammoSpeed, dmg:st.dmg, team:f.team, owner:f.id,
        life:reach/st.ammoSpeed, color:col, r:5, pierce:st.pierce, splash:st.splash });
    }
    if(f.ammo<=0) this.reload(f);
  }
  deploy(f){
    if(!f.alive) return; const g=f.equip.gadget;
    if(g==='mine'){ if(f.mineCharges<=0) return; f.mineCharges--; this.mines.push({id:this.nextId++,x:f.x,y:f.y,team:f.team,owner:f.id,arm:0.6,r:60}); this.emit({type:'deploy',kind:'mine',team:f.team}); }
    else if(g==='turret'){ if(f.hasTurret) return; f.hasTurret=true; this.turrets.push({id:this.nextId++,x:f.x,y:f.y,team:f.team,owner:f.id,hp:80,maxhp:80,cool:0,range:420,life:30}); this.emit({type:'deploy',kind:'turret',team:f.team}); }
    else if(g==='decoy'){ if(f.decoyCharges<=0) return; f.decoyCharges--; this.decoys.push({id:this.nextId++,x:f.x,y:f.y,team:f.team,cls:f.cls,life:12}); }
  }
  applyDamage(target,dmg,attacker,pierce){
    if(!target.alive) return;
    // One hit eliminates. Armor = chance the paintball bounces off (unless armor-piercing).
    if(!pierce && Math.random() < this.deflectChance(target)){ this.emit({type:'deflect',x:target.x,y:target.y,c:'#e6edf3'}); return; }
    target.alive=false; target.deaths++;
    if(this.mode==='ctf'){ for(const fl of this.flags) if(fl.carrier===target.id){ fl.carrier=null; fl.atHome=false; fl.dropT=20; fl.x=target.x; fl.y=target.y; } }
    this.emit({type:'splat',x:target.x,y:target.y,c:attacker?CLASSES[attacker.cls].color:'#fff'});
    const rew=(attacker&&!attacker.bot)?SPLAT_REWARD:0, xpg=(attacker&&!attacker.bot)?1:0;
    this.emit({type:'elim',byId:attacker?attacker.id:0,by:attacker?attacker.name:'?',byTeam:attacker?attacker.team:'',vtId:target.id,vt:target.name,vtTeam:target.team, rew, xp:xpg});
    if(attacker){ attacker.kills++; attacker.roundKills=(attacker.roundKills||0)+1; if(!attacker.bot){ this.addMoney(attacker,SPLAT_REWARD); this.gainXp(attacker,1); } }
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
  allAnted(){ const ps=[...this.players.values()]; return ps.length>0 && ps.every(p=>p.wantAnte && this.getMoney(p)>=p.anteAmt); }
  pickMode(){ return MODES[Math.floor(rand(0,MODES.length))]; }
  modeName(){ return this.tournament?MODE_NAMES.tournament:(MODE_NAMES[this.mode]||this.mode); }
  assignTeams(mode){ const ps=[...this.players.values()];
    if(mode==='invaders'){ for(const p of ps) p.team='blue'; }
    else { ps.forEach((p,i)=>{ p.team=(i%2===0)?'blue':'red'; }); } }
  spawnEdgeBots(n){ for(let i=0;i<n;i++){ const ck=CLASS_KEYS[Math.floor(rand(0,CLASS_KEYS.length))]; const b=this.newFighter('red',ck,true);
    const side=Math.floor(rand(0,4));
    if(side===0){ b.x=rand(60,ARENA.w-60); b.y=60; } else if(side===1){ b.x=rand(60,ARENA.w-60); b.y=ARENA.h-60; }
    else if(side===2){ b.x=60; b.y=rand(60,ARENA.h-60); } else { b.x=ARENA.w-60; b.y=rand(60,ARENA.h-60); }
    this.bots.push(b); } }
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
    this.roundNum++; this.phase='active'; this.roundTimer=ROUND_TIME; this.balls=[]; this.mines=[]; this.turrets=[]; this.decoys=[]; this.flags=[]; this.caps={blue:0,red:0};
    const newSeries = !this.tournament && this.allAnted();         // tournament begins when everyone has anted
    if(newSeries){ this.tournament=true; this.roundsWon={blue:0,red:0}; }
    this.mode = this.tournament ? 'tdm' : this.pickMode();          // tournament locks to Team Deathmatch
    const heads=Math.max(1,this.players.size);
    const sz=arenaSizeFor(this.mode==='invaders'?Math.round(heads*1.5):this.players.size); ARENA.w=sz.w; ARENA.h=sz.h;
    this.obstacles=buildObstacles(); const T=generateTerrain(); this.grid=T.grid; this.tcols=T.cols; this.trows=T.rows; this.terrainMeta={cols:T.cols,rows:T.rows,tile:TILE};
    this.emit({type:'mapchange'});
    if(!this.tournament || newSeries) this.assignTeams(this.mode);  // keep teams stable across a tournament series
    this.bots=[];
    if(this.mode==='invaders') this.spawnEdgeBots(BOTS_PER_PLAYER*heads); else if(!this.tournament) this.rebalanceBots();   // tournament is players-only
    for(const f of [...this.players.values(),...this.bots]){
      const st=this.stats(f);
      if(this.mode==='invaders' && !f.bot){ f.x=ARENA.w/2+rand(-70,70); f.y=ARENA.h/2+rand(-70,70); }      // Bot Invaders: team starts centered
      else if(!(this.mode==='invaders'&&f.bot)){ const s=this.teamSpawn(f.team); f.x=s.x; f.y=s.y; }   // edge-bots keep their edge spot
      f.aim=f.team==='blue'?0:Math.PI; f.maxhp=st.hp; f.hp=st.hp; f.alive=(f.bot?true:p_ready(f)); f.ammo=st.mag; f.reloading=false; f.cool=0; f.roundKills=0; f.activeThisRound=false; f.spawnedThisRound=(f.bot?false:p_ready(f));
      f.mineCharges=(GADGETS[f.equip.gadget]&&GADGETS[f.equip.gadget].charges)||0;
      f.decoyCharges=f.equip.gadget==='decoy'?(GADGETS.decoy.charges):0;
      f.hasTurret=false;
    }
    if(this.mode==='ctf') this.setupFlags();
    if(newSeries){ this.pot=0; for(const p of this.players.values()){ if(this.getMoney(p)>=p.anteAmt){ this.addMoney(p,-p.anteAmt); this.pot+=p.anteAmt; p.anteIn=true; } } }
    else if(!this.tournament){ this.pot=0; for(const p of this.players.values()) p.anteIn=false; }
    this.emit({type:'roundstart',round:this.roundNum,pot:this.pot,mode:this.mode,tournament:this.tournament,modeName:this.modeName()});
  }
  endRound(winner){
    this.phase='intermission'; this.phaseTimer=SHOP_TIME;
    const mode=this.mode;
    for(const p of this.players.values()){ if(!p.spawnedThisRound) continue;
      if(p.activeThisRound) p.afkRounds=0;
      else { p.afkRounds=(p.afkRounds||0)+1; if(p.afkRounds>=2 && p.ready!==false){ p.ready=false; p.afkRounds=0; this.emit({type:'afk',id:p.id,name:p.name}); this.emit({type:'msg',text:`${p.name} set to Sitting Out (inactive 2 rounds).`}); } } }
    if(mode==='invaders'){
      for(const p of this.players.values()){ const bonus=(p.roundKills||0)*BOT_BONUS+(p.alive?SURVIVOR_BONUS:0); if(bonus) this.addMoney(p,bonus); }
      this.emit({type:'msg',text: winner==='blue'?'You survived the invasion! Bonus paid per bot splatted.':'The swarm overran you — regroup.'});
    } else if(winner!=='tie'){
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
    this.placeLobby();
    this.emit({type:'roundend',winner,roundsWon:{...this.roundsWon},mode,tournament:this.tournament,seriesOver,modeName:this.modeName()});
  }
  stageRect(){ const w=Math.min(720,Math.round(ARENA.w*0.42)), h=Math.min(560,Math.round(ARENA.h*0.42)); return { x:Math.round(ARENA.w/2-w/2), y:Math.round(ARENA.h/2-h/2), w, h }; }
  stageZones(s){ s=s||this.stageRect(); const zw=Math.min(120,Math.round(s.w*0.22)), zh=Math.min(120,Math.round(s.h*0.26));
    return [ {id:'armory',name:'Armory',   x:Math.round(s.x+s.w*0.16),y:Math.round(s.y+s.h*0.30),w:zw,h:zh},
             {id:'equip', name:'Equipment',x:Math.round(s.x+s.w*0.62),y:Math.round(s.y+s.h*0.30),w:zw,h:zh} ]; }
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
  concealType(f){ const tt=this.terrainCode(f.x,f.y);
    let t = (tt===FOREST||tt===HILL)?'forest' : (tt===MOUNT)?'mountain' : 'none';
    if(t==='none'){ const cam=CAMO[f.equip?f.equip.camo:'none']; if(cam&&cam.terrain===tt&&cam.terrain!==-1) t=(tt===MOUNT)?'mountain':'forest'; }
    return t; }
  canReveal(v,type){ const vt=this.terrainCode(v.x,v.y); const vis=VISION[v.equip?v.equip.vision:'none']; const r=vis&&vis.reveal;
    if(type==='forest') return vt===MOUNT||vt===HILL||r==='forest'||r==='both';   // high ground or gamma sees forest/hills
    if(type==='mountain') return r==='mountain'||r==='both';                       // only thermal/satellite see mountain cover
    return true; }
  canSee(v,t){ if(dist2(v.x,v.y,t.x,t.y)<=PROX*PROX) return true; const ty=this.concealType(t); if(ty==='none') return true; return this.canReveal(v,ty); }
  clearShot(ax,ay,bx,by,pforest){   // can a shot reach the target without hitting blocking terrain?
    const dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy)||1, steps=Math.ceil(d/14);
    for(let i=1;i<=steps;i++){ const tt=i/steps, x=ax+dx*tt, y=ay+dy*tt;
      if((x-ax)*(x-ax)+(y-ay)*(y-ay)<625) continue;   // 25px origin grace
      const tc=this.terrainCode(x,y); if(tc===MOUNT||tc===HILL||(tc===FOREST&&!pforest)) return false; }
    return true; }

  nearestVisibleEnemy(f){ let best=null,bd=1e15; for(const o of [...this.players.values(),...this.bots]){ if(!o.alive||o.team===f.team) continue; if(!this.canSee(f,o)) continue; const d=dist2(f.x,f.y,o.x,o.y); if(d<bd){bd=d;best=o;} } return best; }
  updateAI(f,dt){
    const st=this.stats(f); const ai=f.ai; ai.repath-=dt;
    if(!ai.target||!ai.target.alive||!this.canSee(f,ai.target)||ai.repath<=0){ ai.target=this.nearestVisibleEnemy(f); ai.repath=rand(0.3,0.8); }
    let mvx=0,mvy=0; const tgt=ai.target;
    if(tgt){ const dx=tgt.x-f.x,dy=tgt.y-f.y,d=Math.hypot(dx,dy)||1; f.aim=Math.atan2(dy,dx);
      const ideal=st.range*0.6;
      if(d>st.range*0.92){ mvx+=dx/d; mvy+=dy/d; } else if(d<ideal*0.7){ mvx-=dx/d; mvy-=dy/d; }
      ai.jitter-=dt; if(ai.jitter<=0){ai.strafe*=-1; ai.jitter=rand(0.6,1.3);}
      mvx+=-dy/d*ai.strafe*0.8; mvy+=dx/d*ai.strafe*0.8;
      const pf=!!(WEAPONS[f.equip.weapon]&&WEAPONS[f.equip.weapon].scope);
      if(d<st.range && this.clearShot(f.x,f.y,tgt.x,tgt.y,pf)){ f.aim+=rand(-0.13,0.13); if(Math.random()<0.8) this.fire(f); if(f.equip.gadget==='mine'&&Math.random()<0.004) this.deploy(f); }
      else if(f.ammo<st.mag*0.25) this.reload(f);
    } else { const dir=f.team==='blue'?1:-1; mvx=dir*0.8; mvy=Math.sin(ai.wander)*0.6; ai.wander+=rand(-1,1)*dt; f.aim=dir>0?0:Math.PI; }
    const m=Math.hypot(mvx,mvy)||1; const mult=st.jetpack?1:SPEED_MULT[this.terrainCode(f.x,f.y)]; const sp=st.speed*mult*0.95;
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
      if(p.input.mx||p.input.my){ const mult=st.jetpack?1:SPEED_MULT[this.terrainCode(p.x,p.y)]; const sp=st.speed*mult; p.x+=p.input.mx/m*sp*dt; p.y+=p.input.my/m*sp*dt; }
      p.aim=p.input.aim; this.collide(p); if(p.input.fire) this.fire(p); }
    for(const b of this.bots){ if(b.alive) this.updateAI(b,dt); }
    const all=[...this.players.values(),...this.bots];
    for(const f of all){ if(f.cool>0) f.cool-=dt; if(f.reloading){ f.reloadT-=dt; if(f.reloadT<=0){ f.reloading=false; f.ammo=this.stats(f).mag; } } }
    this.updateBalls(dt); this.updateMines(); this.updateTurrets(dt); if(this.mode==='ctf') this.updateFlags(dt);
    for(let i=this.decoys.length-1;i>=0;i--){ this.decoys[i].life-=dt; if(this.decoys[i].life<=0) this.decoys.splice(i,1); }
    const ba=this.aliveCount('blue'), ra=this.aliveCount('red');
    if(this.mode==='ctf'){ let w=null;
      if(this.caps.blue>=CAPTURE_TARGET) w='blue'; else if(this.caps.red>=CAPTURE_TARGET) w='red';
      else if(this.roundTimer<=0) w=this.caps.blue>this.caps.red?'blue':this.caps.red>this.caps.blue?'red':'tie';
      if(w) this.endRound(w);
    } else if(this.mode==='invaders'){
      if(ba===0) this.endRound('red'); else if(ra===0) this.endRound('blue'); else if(this.roundTimer<=0) this.endRound('blue');
    } else { if(ba===0||ra===0||this.roundTimer<=0){ this.endRound(ba>ra?'blue':ra>ba?'red':'tie'); } }
  }
  updateBalls(dt){
    const fighters=[...this.players.values(),...this.bots];
    for(let i=this.balls.length-1;i>=0;i--){ const b=this.balls[i];
      const nx=b.x+b.vx*b.speed*dt, ny=b.y+b.vy*b.speed*dt; b.life-=dt;
      let dead=b.life<=0, hitX=nx, hitY=ny;
      if(dead) this.emit({type:'splat',x:nx,y:ny,c:b.color});   // reached max range → splat on the ground
      if(!dead) for(const o of this.obstacles){ if(nx>o.x&&nx<o.x+o.w&&ny>o.y&&ny<o.y+o.h){ dead=true; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(!dead && dist2(b.x0,b.y0,nx,ny)>625){ const tc=this.terrainCode(nx,ny);   // blocked by mountains/hills/forest (sniper passes forest)
        if(tc===MOUNT||tc===HILL||(tc===FOREST&&!b.pforest)){ dead=true; this.emit({type:'splat',x:nx,y:ny,c:b.color}); } }
      if(!dead) for(const f of fighters){ if(!f.alive||f.id===b.owner||f.team===b.team) continue;
        if(dist2(nx,ny,f.x,f.y)<(f.r+b.r)*(f.r+b.r)){ this.applyDamage(f,b.dmg,this.findById(b.owner),b.pierce); dead=true; hitX=f.x; hitY=f.y; break; } }
      if(!dead) for(const tr of this.turrets){ if(tr.team===b.team) continue; if(dist2(nx,ny,tr.x,tr.y)<(16+b.r)*(16+b.r)){ tr.hp-=b.dmg; dead=true; hitX=nx; hitY=ny; this.emit({type:'splat',x:nx,y:ny,c:b.color}); break; } }
      if(dead){ if(b.splash) this.splashDamage(hitX,hitY,b.splash,b.team,this.findById(b.owner),b.color); this.balls.splice(i,1); continue; }
      b.x=nx; b.y=ny;
    }
  }
  updateMines(){
    for(let i=this.mines.length-1;i>=0;i--){ const mn=this.mines[i];
      for(const f of [...this.players.values(),...this.bots]){ if(!f.alive||f.team===mn.team) continue;
        if(dist2(mn.x,mn.y,f.x,f.y)<=mn.r*mn.r){ this.splashDamage(mn.x,mn.y,mn.r,mn.team,this.findById(mn.owner),PAINT.splash); this.emit({type:'boom',x:mn.x,y:mn.y}); this.mines.splice(i,1); break; } }
    }
  }
  updateTurrets(dt){
    for(let i=this.turrets.length-1;i>=0;i--){ const tr=this.turrets[i]; tr.life-=dt; if(tr.cool>0) tr.cool-=dt;
      if(tr.hp<=0||tr.life<=0){ this.emit({type:'boom',x:tr.x,y:tr.y}); this.turrets.splice(i,1); continue; }
      // acquire nearest visible enemy
      let best=null,bd=tr.range*tr.range;
      for(const f of [...this.players.values(),...this.bots]){ if(!f.alive||f.team===tr.team) continue;
        const d=dist2(tr.x,tr.y,f.x,f.y); if(d<bd && this.canSee(tr,f)){ bd=d; best=f; } }
      if(best && tr.cool<=0){ tr.cool=0.25; const ang=Math.atan2(best.y-tr.y,best.x-tr.x)+(Math.random()-0.5)*0.06;
        this.balls.push({x:tr.x+Math.cos(ang)*18,y:tr.y+Math.sin(ang)*18,vx:Math.cos(ang),vy:Math.sin(ang),speed:760,dmg:12,team:tr.team,owner:tr.owner,life:tr.range/760,color:tr.team==='blue'?'#3da9fc':'#ff5470',r:5,pierce:false,splash:0}); }
    }
  }
  // turrets need an equip.vision lookup in canSee; give them a stub
  findById(id){ return this.players.get(id)||this.bots.find(b=>b.id===id)||null; }

  emit(ev){ this.events.push(ev); if(this.events.length>200) this.events.splice(0,this.events.length-200); }
  drainEvents(){ const e=this.events; this.events=[]; return e; }

  // ---- snapshot ----
  publicFighter(f){ return {id:f.id,n:f.name,tm:f.team,cls:f.cls,x:Math.round(f.x),y:Math.round(f.y),a:+f.aim.toFixed(2),hp:Math.max(0,Math.round(f.hp)),mh:f.maxhp,al:f.alive,bot:f.bot,
    cam:(f.equip&&f.equip.camo!=='none')?1:0, jet:f.equip&&f.equip.gadget==='jetpack'?1:0}; }
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
      if(friendly || f.bot || vis || recent) radar.push({x:Math.round(f.x),y:Math.round(f.y),tm:f.team,me:(me&&f.id===me.id)?1:0}); }
    const turrets=this.turrets.map(t=>({id:t.id,x:Math.round(t.x),y:Math.round(t.y),tm:t.team,hp:t.hp,mh:t.maxhp}));
    const decoys=this.decoys.map(d=>({id:d.id,x:Math.round(d.x),y:Math.round(d.y),tm:d.team,cls:d.cls}));
    let mines=[]; if(me) mines=this.mines.filter(m=>m.team===me.team).map(m=>({x:Math.round(m.x),y:Math.round(m.y)}));
    let you=null;
    if(me){ const st=this.stats(me); const li=levelInfo(this.getXp(me));
      you={ id:me.id,name:me.name,cls:me.cls,team:me.team,hp:Math.max(0,Math.round(me.hp)),maxhp:me.maxhp,alive:me.alive,
        ammo:me.ammo,mag:st.mag,reloading:me.reloading,kills:me.kills,deaths:me.deaths,money:this.getMoney(me),
        x:Math.round(me.x),y:Math.round(me.y),terrain:this.terrainCode(me.x,me.y),wantAnte:me.wantAnte,anteIn:me.anteIn,
        level:li.level, xpInto:li.into, xpNeed:li.need, unlockLevel:CLASS_UNLOCK_LEVEL, classUnlocked:li.level>=CLASS_UNLOCK_LEVEL,
        deflect:st.deflect, zone:me.zone||null, equip:me.equip, owned:this.ownedSet(me.key), mineCharges:me.mineCharges, hasTurret:me.hasTurret, gadget:me.equip.gadget, ammoStock:me.ammoStock||{fast:0,ap:0}, anteAmt:me.anteAmt||100, wantAnte:me.wantAnte, ready:me.ready!==false, spd:Math.round(st.speed*(me.equip.gadget==='jetpack'?1:(SPEED_MULT[this.terrainCode(me.x,me.y)]||1))) }; }
    let stage=null; if(lobby){ stage=this.stageRect(); stage.zones=this.stageZones(stage); }
    return { t:'state', you, fighters:out, radar, balls:this.balls.map(b=>({x:Math.round(b.x),y:Math.round(b.y),c:b.color})),
      turrets, mines, decoys, space:'arena', stage, phase:this.phase, phaseTimer:Math.max(0,Math.round(this.phaseTimer)),
      roundTime:Math.max(0,Math.round(this.roundTimer)), round:this.roundNum, roundsWon:this.roundsWon,
      alive:{blue:this.aliveCount('blue'),red:this.aliveCount('red')}, pot:this.pot, buyIn:BUY_IN,
      mode:this.mode, modeName:this.modeName(), tournament:this.tournament, caps:{...this.caps}, captureTarget:CAPTURE_TARGET, tourneyWins:TOURNEY_WINS,
      flags:this.flags.map(fl=>({team:fl.team,x:Math.round(fl.x),y:Math.round(fl.y),home:fl.atHome,carried:!!fl.carrier})), anteOptions:ANTE_OPTIONS,
      events:events||[] };
  }
}

// turrets are passed to canSee as a "viewer"; give them an equip stub so concealed/canReveal work
const _origCanSee = Game.prototype.canSee;
Game.prototype.canSee = function(v,t){ if(v && !v.equip) v.equip={vision:'none',camo:'none'}; return _origCanSee.call(this,v,t); };

module.exports = { Game, CLASSES, CLASS_KEYS, CATALOG, CATS, WEAPONS, ARMOR, VISION, CAMO, GADGETS, AMMO,
  ARENA, TILE, SPEED_MULT, LOBBY, LOBBY_ZONES, buildObstacles, levelInfo, PLAIN, FOREST, WATER, MOUNT,
  NEW_WALLET, SPLAT_REWARD, BUY_IN, ROUND_WIN_BONUS, SURVIVOR_BONUS, SHOP_TIME, ROUND_TIME, TEAM_SIZE, CLASS_UNLOCK_LEVEL };
