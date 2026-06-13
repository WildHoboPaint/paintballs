/* Self-test — runs on YOUR machine against the real game files.
   Double-click test.bat (or run: node selftest.js) and paste me the output. */
'use strict';
let pass=0, fail=0;
const ok=(n,c)=>{ if(c){pass++;console.log('  PASS  '+n);} else {fail++;console.log('  FAIL  '+n);} };

let G;
try { G = require('./game.js'); console.log('game.js loaded OK'); }
catch(e){ console.error('\n*** game.js FAILED TO LOAD ***\n'+e.stack+'\n'); process.exit(1); }

const { Game, LOBBY, levelInfo, CLASS_UNLOCK_LEVEL } = G;

console.log('\n[client script]');
try {
  const fs=require('fs'), cp=require('child_process'), os=require('os'), path=require('path');
  const h=fs.readFileSync(__dirname+'/public/index.html','utf8');
  const a=h.indexOf('<script>')+8, b=h.indexOf('</script>',a);
  const tmp=path.join(os.tmpdir(),'hvpb_client_check.js'); fs.writeFileSync(tmp, h.slice(a,b));
  cp.execFileSync(process.execPath,['--check',tmp]);
  ok('public/index.html script compiles', true);
} catch(e){ ok('public/index.html script compiles', false); console.log('   client error: '+(e.stderr?e.stderr.toString().split('\n').slice(0,3).join(' '):e.message)); }

console.log('\n[staging area]');
const g = new Game();
ok('starts in intermission', g.phase==='intermission');
const aId = g.addHuman('Tester','Sniper');
const A = g.players.get(aId);
ok('new player starts as Trooper (class locked < L10)', A.cls==='Trooper');
let s = g.snapshot(aId, []);
ok('intermission shows the in-map staging area', !!s.stage);
ok('player spawns inside the staging area', !!s.stage && A.x>=s.stage.x && A.x<=s.stage.x+s.stage.w && A.y>=s.stage.y && A.y<=s.stage.y+s.stage.h);
ok('snapshot reports arena space (staging is in-map)', s.space==='arena');
ok('snapshot exposes your store zone field', 'zone' in s.you);
ok('snapshot has radar (minimap data)', Array.isArray(s.radar));

console.log('\n[combat: one hit = out, armor = bounce]');
g.phaseTimer=0.001; g.step(0.01);                  // start a round
ok('round started (active)', g.phase==='active');
ok('snapshot now arena space', g.snapshot(aId,[]).space==='arena');
const foe = [...g.players.values(),...g.bots].find(f=>f.team!==A.team && f.alive);
foe.equip={weapon:foe.equip.weapon,wmods:[],chips:[],gadget:'none'}; foe.alive=true;
g.applyDamage(foe,1,A,false);
ok('one unarmored hit eliminates', foe.alive===false);
ok('plating stacks bounce (2x light = 16%)', Math.abs(g.deflectChance({equip:{chips:['light_plate','light_plate']}})-0.16)<1e-9);

console.log('\n[progression]');
ok('level 1 at 0 XP', levelInfo(0).level===1);
ok('class selection unlocks at level '+CLASS_UNLOCK_LEVEL, levelInfo(0).level<CLASS_UNLOCK_LEVEL);

console.log('\n[tuning]');
ok('terrain tiles are small (<=36px)', G.TILE<=36);
ok('basic gun range is short (<=300)', G.WEAPONS.pball_gun.range<=300);
ok('rifle out-ranges the basic gun', G.WEAPONS.pball_rifle.range>G.WEAPONS.pball_gun.range);
ok('default round ammo pool = 30', G.BASE_AMMO===30);
ok('Magazine mod adds +30 ammo', G.WEAPON_MODS.magazine.ammo===30);
ok('Golden Gun mod exists', !!G.WEAPON_MODS.golden && !!G.WEAPON_MODS.golden.golden);
ok('Heavy Plating is very heavy (>=8)', G.ARMOR_CHIPS.heavy_plate.wt>=8);
ok('weight capacity grows with level', G.weightCapacity(25) > G.weightCapacity(1));
ok('grenade launcher exists with splash', !!(G.WEAPONS.grenade_launcher && G.WEAPONS.grenade_launcher.splash>=40));
ok('rocket launcher has big splash', G.WEAPONS.bazooka.splash>=90);
ok('bots respect terrain (clearShot present)', typeof g.clearShot==='function');

console.log('\n[stability: 600 ticks]');
let threw=null;
try{ const g2=new Game(); g2.addHuman('A','Trooper'); g2.addHuman('B','Trooper'); for(let i=0;i<600;i++) g2.step(0.05); }
catch(e){ threw=e; }
ok('no crashes over 600 simulated ticks', threw===null);
if(threw) console.log('   -> '+threw.message);

console.log('\n==== '+pass+' passed, '+fail+' failed ====');
console.log(fail? '\nSomething is off — paste this whole output to Claude.' : '\nAll good. Safe to restart the server and play.');
process.exit(fail?1:0);
