import {parseGameConfig,createBattle,availableLevels,availableUnits} from './model.mjs';
import {loadProgress,saveProgress as storeProgress} from './progress.mjs';
import {createBattlePresentation} from './presentation.mjs';
import {createBattleAudio} from './audio.mjs';

const $=id=>document.getElementById(id);
const canvas=$('battlefield'),ctx=canvas.getContext('2d');
const WIDTH=1024,HEIGHT=620,GRID={x:96,y:68,width:832,height:480,cols:8,rows:5};
const CELL_W=GRID.width/GRID.cols,CELL_H=GRID.height/GRID.rows;
const NUMERALS=['壹','贰','叁','肆','伍'];
const ROLE_NAMES={1:'聚灵 · 后勤',2:'远射 · 单体',3:'坚守 · 前排',4:'横扫 · 群攻',5:'谋略 · 减速'};
const ROLE_DESCRIPTIONS={1:'持续生产灵气, 不攻击. 可被敌人摧毁, 请放在后排.',2:'攻击本路前方的单个敌人. 放在前排英雄身后持续输出.',3:'以高生命挡住敌人, 近距离攻击. 为后排争取时间.',4:'横扫本路前方近距离的敌人. 注意射程, 需要靠近敌阵.',5:'远程攻击并减缓敌人移动. 配合其他英雄集火强敌.'};
const images=new Map(),previews=new Map();
const terrain=document.createElement('canvas');terrain.width=WIDTH;terrain.height=HEIGHT;
let config,workspace,project,runtime,battle,presentation,sound,timing,selectedUnitId=null,removeMode=false,hover=null,paused=false,lastTime=null,selectedLevelId=null,completed=[];
let saveWritable=true,ready=false,finished=false,toastUntil=0;
let newlyUnlocked=[];

function toast(message){$('toast').textContent=message;$('toast').hidden=false;toastUntil=performance.now()+2700;}
function warnStorage(message){$('save-warning').textContent=message;$('save-warning').hidden=false;}
function warnAudio(message){$('audio-warning').textContent=message;$('audio-warning').hidden=false;}
function updateAudio(){$('audio-toggle').textContent=sound?.enabled?'音效: 开':'音效: 关';$('audio-toggle').setAttribute('aria-pressed',String(Boolean(sound?.enabled)));}
const clock=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const availableLevel=level=>availableLevels(config,completed).some(item=>item.id===level.id);
const availableUnit=unit=>availableUnits(config,completed).some(item=>item.id===unit.id);
const unitType=id=>config.units.find(unit=>unit.id===id);
const enemyType=id=>config.enemies.find(enemy=>enemy.id===id);
const levelType=id=>config.levels.find(level=>level.id===id);
const screenX=x=>GRID.x+x*CELL_W;
const screenY=lane=>GRID.y+(lane+.5)*CELL_H;

function unitDescription(unit) {
  const stats=unit.role===1?`每 ${unit.production_interval} 秒产 ${unit.production} 灵气, 生命 ${unit.hp}.`:`伤害 ${unit.damage}, 间隔 ${unit.interval} 秒, 射程 ${unit.range} 格, 生命 ${unit.hp}.`;
  const slow=unit.role===5?` 敌人移速降至 ${Math.round(unit.slow_factor*100)}%, 持续 ${unit.slow_duration} 秒.`:'';
  const critical=unit.role!==1&&unit.crit_chance_percent?` 暴击率 ${unit.crit_chance_percent}%, 暴击伤害 ${unit.damage*2}.`:'';
  return `${unit.name} · ${stats}${critical}${slow} ${ROLE_DESCRIPTIONS[unit.role]}`;
}

function readProgress() {
  const progress=loadProgress(project.id,config.levels);
  completed=progress.completed;saveWritable=progress.canSave;if(progress.warning)warnStorage(progress.warning);
}
function saveProgress() {
  if(!saveWritable)return;
  if(!storeProgress(project.id,completed)){saveWritable=false;warnStorage('浏览器未能保存通关进度. 你仍可继续游戏, 但关闭页面后本次新增进度会丢失.');}
}

async function loadImage(path,size,url) {
  if(images.has(path))return;
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`无法读取资源: ${path}`);
  const bytes=new Uint8Array(await response.arrayBuffer()),signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<24||!signature.every((value,index)=>bytes[index]===value))throw new Error(`资源不是有效 PNG: ${path}`);
  const blob=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  try {
    const image=new Image();image.src=blob;await image.decode();
    if(image.naturalWidth!==size||image.naturalHeight!==size)throw new Error(`资源尺寸应为 ${size} x ${size}: ${path}`);
    images.set(path,image);
  }finally{URL.revokeObjectURL(blob);}
}

function paintTerrain() {
  const p=terrain.getContext('2d');
  const ground=p.createLinearGradient(0,0,0,HEIGHT);ground.addColorStop(0,'#6a816a');ground.addColorStop(1,'#455f45');p.fillStyle=ground;p.fillRect(0,0,WIDTH,HEIGHT);
  p.fillStyle='#4d6b58';p.beginPath();p.moveTo(0,58);p.lineTo(70,23);p.lineTo(135,41);p.lineTo(239,11);p.lineTo(336,43);p.lineTo(417,20);p.lineTo(520,47);p.lineTo(643,9);p.lineTo(749,38);p.lineTo(859,18);p.lineTo(1024,48);p.lineTo(1024,68);p.lineTo(0,68);p.fill();
  p.fillStyle='#243f32';p.fillRect(78,57,865,503);p.fillStyle='#adad7b';p.fillRect(85,61,852,495);
  for(let lane=0;lane<GRID.rows;lane++)for(let col=0;col<GRID.cols;col++) {
    const x=GRID.x+col*CELL_W,y=GRID.y+lane*CELL_H;
    p.fillStyle=(lane+col)%2?'#bdc491':'#b2bd87';p.fillRect(x,y,CELL_W-2,CELL_H-2);
    p.fillStyle='#dee0ae29';p.fillRect(x+3,y+3,CELL_W-8,2);
    p.fillStyle='#63835026';
    for(let i=0;i<6;i++){const dx=(col*19+lane*31+i*17)%90+5,dy=(lane*23+col*7+i*11)%78+7;p.fillRect(x+dx,y+dy,2+(i%2),2);}
  }
  // 城墙与进军道路属于场景, 英雄动作仍完全由共享运行时负责.
  p.fillStyle='#c3bea0';p.fillRect(12,57,64,503);p.strokeStyle='#7c8167';p.lineWidth=1;
  for(let row=0;row<24;row++){const y=62+row*21;p.beginPath();p.moveTo(12,y);p.lineTo(76,y);p.stroke();p.beginPath();p.moveTo(row%2?27:48,y);p.lineTo(row%2?27:48,y+21);p.stroke();}
  for(let lane=0;lane<GRID.rows;lane++) {
    const cy=screenY(lane);p.fillStyle='#314d3d';p.fillRect(26,cy-26,37,60);p.beginPath();p.arc(44.5,cy-26,18.5,Math.PI,0);p.fill();p.fillStyle='#9b5638';p.fillRect(31,cy-23,27,54);p.strokeStyle='#5d422f';p.lineWidth=2;p.strokeRect(31,cy-23,27,54);p.beginPath();p.moveTo(44.5,cy-23);p.lineTo(44.5,cy+31);p.stroke();
    p.fillStyle='#ddc180';p.font='13px KaiTi,serif';p.textAlign='center';p.fillText(NUMERALS[lane],44,cy+4);
  }
  p.fillStyle='#ded8b8';for(let i=0;i<4;i++)p.fillRect(9+i*19,43,12,21);
  p.fillStyle='#a44832';p.beginPath();p.moveTo(42,9);p.lineTo(78,12);p.lineTo(68,23);p.lineTo(78,32);p.lineTo(42,29);p.closePath();p.fill();p.strokeStyle='#e0d3a4';p.lineWidth=3;p.beginPath();p.moveTo(42,8);p.lineTo(42,45);p.stroke();
  p.fillStyle='#9c9f79';p.fillRect(949,62,65,495);p.fillStyle='#777e60';for(let i=0;i<20;i++){p.beginPath();p.ellipse(958+(i*17)%48,78+i*23,5,2,0,0,Math.PI*2);p.fill();}
  p.fillStyle='#334f3c';p.fillRect(0,564,WIDTH,56);p.fillStyle='#b8c3a0';p.textAlign='left';p.font='11px "Microsoft YaHei",sans-serif';p.fillText('城门在后, 寸土不让.',28,591);p.textAlign='right';p.fillStyle='#8fa583';p.fillText('聚灵蓄势  /  前排阻敌  /  后排制胜',990,591);
  p.fillStyle='#d3d4ad';p.textAlign='center';p.font='11px "Microsoft YaHei",sans-serif';for(let col=0;col<8;col++)p.fillText(String(col+1),screenX(col+.5),48);
}

function drawHealth(x,y,value,max,isEnemy,slow) {
  ctx.fillStyle='#203d31cc';ctx.fillRect(x-26,y,52,5);ctx.fillStyle=isEnemy?(slow?'#70c2c6':'#c77e59'):'#4f9261';ctx.fillRect(x-25,y+1,50*Math.max(0,value/max),3);
}
function drawEntity(entry) {
  const {entity,motion}=entry,isEnemy=entity.isEnemy;
  const type=isEnemy?enemyType(entity.enemyId):unitType(entity.unitId),x=screenX(entity.x),y=screenY(entity.lane);
  const death=entry.deadAt===null?0:Math.min(1,(presentation.time-entry.deadAt)/.25);
  ctx.save();ctx.globalAlpha=1-death;
  ctx.fillStyle='#203e3028';ctx.beginPath();ctx.ellipse(x,y+29,isEnemy?24:27,9,0,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(x+death*entry.deathDirection*12,y+death*5);ctx.rotate(death*entry.deathDirection*.28);ctx.scale(1-death*.25,1-death*.25);ctx.translate(-51,-51);ctx.scale(102/256,102/256);
  runtime.drawHero(ctx,{head:images.get(type.icon),weapon:type.weapon?images.get(type.weapon):null},motion.snapshot());ctx.restore();
  const slowed=isEnemy&&entity.slowUntil>battle.state.elapsed;
  if(slowed&&!death){ctx.strokeStyle='#b8f3eb';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y+27,30,10,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#e4fffa';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText('缓',x,y-34);}
  if(entry.deadAt===null)drawHealth(x,y+37,entity.hp,entity.maxHp,isEnemy,slowed);
  ctx.restore();
}
function drawHover() {
  if(!hover||!battle||battle.state.status!=='running'||paused)return;
  const {lane,col}=hover,x=GRID.x+col*CELL_W,y=GRID.y+lane*CELL_H,occupied=battle.state.units.some(unit=>unit.lane===lane&&unit.col===col);
  const type=unitType(selectedUnitId);
  if(type&&!removeMode&&!occupied) {
    const end=Math.min(8,col+.5+type.range);ctx.fillStyle='#f4e39c48';ctx.fillRect(screenX(col+.5),y+3,(end-col-.5)*CELL_W,CELL_H-8);
    if(type.role!==1){ctx.strokeStyle='#e9e0a290';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(screenX(end),y+5);ctx.lineTo(screenX(end),y+CELL_H-7);ctx.stroke();ctx.setLineDash([]);}
    ctx.save();ctx.globalAlpha=.5;
    if(type.role===1)ctx.drawImage(images.get(type.icon),x+14,y+9,76,76);
    else{ctx.translate(x+CELL_W/2-51,y+CELL_H/2-51);ctx.scale(102/256,102/256);runtime.drawHero(ctx,{head:images.get(type.icon),weapon:type.weapon?images.get(type.weapon):null},previews.get(type.id));}
    ctx.restore();
  }
  ctx.fillStyle=removeMode?'#b341343b':occupied?'#ae593a35':'#f5e7ad38';ctx.fillRect(x+2,y+2,CELL_W-6,CELL_H-6);ctx.strokeStyle=removeMode?'#b14333':occupied?'#a86040':'#f5e6a7';ctx.lineWidth=2;ctx.strokeRect(x+2,y+2,CELL_W-6,CELL_H-6);
}
function drawEffects() {
  if(!presentation)return;
  for(const effect of presentation.effects) {
    const t=Math.max(0,Math.min(1,(presentation.time-effect.time)/effect.duration));ctx.save();ctx.globalAlpha=1-t;
    const color=effect.critical?'#ffbd52':effect.style==='cast'?'#c6fff1':'#fff4cf';
    if(effect.type==='projectile') {
      const target=presentation.entities.get(effect.targetId)?.entity;
      const x1=screenX(effect.fromX)+25,x2=screenX(target?.x??effect.toX),y=screenY(effect.lane)-6,x=x1+(x2-x1)*t;
      ctx.globalAlpha=1;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=effect.style==='cast'?4:2;
      ctx.beginPath();ctx.moveTo(x-21,y);ctx.lineTo(x,y);ctx.stroke();
      if(effect.style==='cast'){ctx.shadowColor=color;ctx.shadowBlur=9;ctx.beginPath();ctx.arc(x,y,effect.critical?7:5,0,Math.PI*2);ctx.fill();}
      else{ctx.beginPath();ctx.moveTo(x+5,y);ctx.lineTo(x-3,y-4);ctx.lineTo(x-3,y+4);ctx.closePath();ctx.fill();}
    }else if(effect.type==='slash') {
      const x1=screenX(effect.fromX),y=screenY(effect.lane)-5;
      ctx.strokeStyle=effect.source?.isEnemy?'#efaa88':color;ctx.lineWidth=effect.style==='slash'?7:3;
      if(effect.style==='slash') {
        const ids=effect.targetIds||[effect.targetId];
        for(const id of ids){const x=screenX(presentation.entities.get(id)?.entity.x??effect.toX);ctx.beginPath();ctx.arc(x,y,22+t*18,-1.2,1.1);ctx.stroke();}
      }else{const x2=screenX(effect.toX);ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.beginPath();ctx.arc(x2,y,9+t*6,-1,1);ctx.stroke();}
    }else if(effect.type==='produce') {
      const x=screenX(effect.x),y=screenY(effect.lane)-25-t*20;ctx.fillStyle='#fff0b1';ctx.font='bold 17px Georgia,serif';ctx.textAlign='center';ctx.fillText('+'+effect.amount,x,y);
    }else if(effect.type==='hit') {
      ctx.strokeStyle=effect.critical?'#ffc04d':effect.armored?'#e8f5ff':'#fff9d3';ctx.lineWidth=effect.critical?3:2;
      const x=screenX(effect.x),y=screenY(effect.lane),count=effect.critical?7:4;
      for(let n=0;n<count;n++){const angle=n*Math.PI*2/count+.5;ctx.beginPath();ctx.moveTo(x+Math.cos(angle)*(9+t*16),y+Math.sin(angle)*(9+t*16));ctx.lineTo(x+Math.cos(angle)*(19+t*24),y+Math.sin(angle)*(19+t*24));ctx.stroke();}
    }else if(effect.type==='damage') {
      let x=screenX(effect.x)+effect.offset;const y=screenY(effect.lane)-38-30*(1-(1-t)**2);
      ctx.globalAlpha=t<.6?1:(1-t)/.4;ctx.textAlign=effect.offset<0?'right':'left';ctx.font=`bold ${effect.critical?24:17}px "Microsoft YaHei",sans-serif`;
      const text=effect.critical?'暴击 '+effect.amount:String(effect.amount);
      // 同一目标左右展开, 避免普通数字被较长的暴击标签盖住; 出生点附近也不裁字.
      const width=ctx.measureText(text).width;
      x=Math.max(4+(effect.offset<0?width:0),Math.min(WIDTH-4-(effect.offset>0?width:0),x));
      ctx.strokeStyle='#273b32';ctx.lineWidth=3;ctx.strokeText(text,x,y);ctx.fillStyle=effect.critical?'#ffbd52':'#fff4d2';ctx.fillText(text,x,y);
    }
    else if(effect.type==='leak'){ctx.fillStyle='#b5413555';ctx.fillRect(12,GRID.y+effect.lane*CELL_H,72,CELL_H);}
    ctx.restore();
  }
}
function render() {
  ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(terrain,0,0);if(!battle)return;
  drawHover();
  for(const entry of presentation.entities.values())drawEntity(entry);
  drawEffects();
}

function renderCards() {
  $('unit-cards').replaceChildren();
  config.units.forEach((unit,index)=>{
    const button=document.createElement('button');button.type='button';button.className='unit-card';button.dataset.unitId=String(unit.id);button.setAttribute('aria-pressed','false');
    const key=document.createElement('span');key.className='unit-key';key.textContent=String(index+1);button.append(key);
    const thumb=document.createElement('canvas');thumb.width=thumb.height=128;button.append(thumb);
    const name=document.createElement('span');name.className='unit-name';name.textContent=unit.name;button.append(name);
    const role=document.createElement('span');role.className='unit-role';role.textContent=ROLE_NAMES[unit.role];button.append(role);
    const cost=document.createElement('span');cost.className='unit-cost';
    if(availableUnit(unit)){const amount=document.createElement('strong');amount.textContent=String(unit.cost);cost.append(amount,document.createTextNode('灵气'));}
    else cost.textContent=`第 ${config.levels.findIndex(level=>level.id===unit.unlock_level)+1} 关通关解锁`;
    button.append(cost);button.title=unitDescription(unit);button.disabled=!availableUnit(unit);button.classList.toggle('locked',!availableUnit(unit));
    button.addEventListener('click',()=>selectUnit(unit.id));$('unit-cards').append(button);
    const preview=thumb.getContext('2d');
    if(unit.role===1)preview.drawImage(images.get(unit.icon),4,4,120,120);
    else{const motion=runtime.createHeroMotion(workspace.heroMotion);motion.setAction('walk-right');motion.setAction('idle');previews.set(unit.id,motion.snapshot());preview.scale(.5,.5);runtime.drawHero(preview,{head:images.get(unit.icon),weapon:unit.weapon?images.get(unit.weapon):null},previews.get(unit.id));}
  });
  updateCards();
}
function updateCards() {
  for(const button of $('unit-cards').querySelectorAll('[data-unit-id]')) {
    const unit=unitType(Number(button.dataset.unitId));
    button.classList.toggle('selected',!removeMode&&selectedUnitId===unit.id);button.setAttribute('aria-pressed',String(!removeMode&&selectedUnitId===unit.id));
    button.classList.toggle('unaffordable',Boolean(battle&&battle.state.energy<unit.cost));
  }
}
function selectUnit(id) {
  const unit=unitType(id);if(!unit||!availableUnit(unit))return;
  selectedUnitId=id;removeMode=false;$('remove-mode').setAttribute('aria-pressed','false');
  $('selection-description').textContent=unitDescription(unit);updateCards();
  if(battle&&battle.state.energy<unit.cost)toast(`灵气不足, 召唤${unit.name}需要 ${unit.cost} 灵气.`);
}
function toggleRemove() {
  if(!battle||battle.state.status!=='running')return;
  removeMode=!removeMode;selectedUnitId=null;$('remove-mode').setAttribute('aria-pressed',String(removeMode));
  $('selection-description').textContent=removeMode?'点击己方单位撤除, 不返还灵气. 再次点击撤除按钮可取消.':'点击一张英灵牌, 查看能力与部署费用.';updateCards();
}
function clearSelection() {selectedUnitId=null;removeMode=false;$('remove-mode').setAttribute('aria-pressed','false');$('selection-description').textContent='点击一张英灵牌, 查看能力与部署费用.';updateCards();}
function updateHud() {
  if(!battle)return;
  const state=battle.state;$('energy-value').textContent=String(Math.floor(state.energy));$('gate-value').textContent=String(state.gateHp);
  $('wave-value').textContent=`${state.spawned} / ${state.totalSpawns}`;$('wave-progress').max=Math.max(1,state.totalSpawns);$('wave-progress').value=state.spawned;$('battle-time').textContent=clock(state.elapsed);updateCards();
  if(state.spawned===state.totalSpawns&&state.status==='running')$('battle-instruction').textContent='敌军已全部出场, 消灭场上剩余敌人即可过关.';
}
function setPause(value) {
  if(!battle||finished)return;
  paused=value;lastTime=null;$('pause').textContent=paused?'继续':'暂停';$('stage-cover').hidden=!paused;
  if(paused)sound?.stop();else if(sound)void sound.enableFromGesture();
  if(paused){$('cover-title').textContent='暂歇片刻, 再整旗鼓';$('cover-copy').textContent='战场已暂停, 英灵与敌军都在等待你的号令.';$('cover-action').textContent='继续守关';}
}
function openLevels() {
  if(!ready)return;
  if(battle&&!finished)setPause(true);
  selectedLevelId=battle?.state.levelId||config.levels.find(level=>availableLevel(level)&&!completed.includes(level.id))?.id||config.levels[0].id;
  renderLevels();if(!$('level-dialog').open)$('level-dialog').showModal();
}
function renderLevels() {
  $('level-list').replaceChildren();
  config.levels.forEach((level,index)=>{
    const button=document.createElement('button');button.type='button';button.className='level-card';button.disabled=!availableLevel(level);button.classList.toggle('selected',level.id===selectedLevelId);button.setAttribute('aria-pressed',String(level.id===selectedLevelId));
    for(const [className,text] of [['level-number',NUMERALS[index]||String(index+1)],['level-duration',`约 ${Math.round(level.duration/60)} 分钟`],['level-name',level.name],['level-description',level.description],['level-state',completed.includes(level.id)?'已通关 · 可再战':availableLevel(level)?'待出征':'通关前一关解锁']]){const span=document.createElement('span');span.className=className;span.textContent=text;button.append(span);}
    button.addEventListener('click',()=>{selectedLevelId=level.id;renderLevels();});$('level-list').append(button);
  });
}
function startLevel(id) {
  const level=levelType(id);if(!level||!availableLevel(level)){toast('请先通关前一关.');return;}
  try{battle=createBattle(config,id,completed,{timing});}catch(error){toast(error.message);return;}
  sound.stop();void sound.enableFromGesture();
  newlyUnlocked=[];
  presentation=createBattlePresentation({runtime,heroMotion:workspace.heroMotion,config,onSound:event=>sound.play(event),onBattleEnd:recordVictory});
  finished=false;paused=false;lastTime=null;hover=null;clearSelection();
  for(const dialog of [$('level-dialog'),$('result-dialog')])if(dialog.open)dialog.close();
  $('stage-cover').hidden=true;$('pause').textContent='暂停';$('pause').disabled=false;$('restart').disabled=false;$('remove-mode').disabled=false;
  $('mission-label').textContent=`三国篇 · 第 ${config.levels.indexOf(level)+1} 关`;$('mission-number').textContent=NUMERALS[config.levels.indexOf(level)]||'关';$('mission-title').textContent=level.name;
  $('battle-instruction').textContent=level.description;renderCards();updateHud();canvas.focus();toast('先布下聚灵阵积攒灵气, 再安排黄忠与张飞守住来敌路线.');
}
function recordVictory(state) {
  // 逻辑胜利立即落存档; 玩家在视觉收尾时重开或关闭页面不能丢失已取得的进度.
  if(state.status==='won'&&!completed.includes(state.levelId)){completed.push(state.levelId);for(const unit of config.units)if(unit.unlock_level===state.levelId)newlyUnlocked.push(unit.name);saveProgress();renderCards();}
}
function finishBattle() {
  if(finished)return;finished=true;sound.stop();const state=battle.state,won=state.status==='won',newUnits=newlyUnlocked;
  $('pause').disabled=true;$('remove-mode').disabled=true;$('result-dialog').classList.toggle('lost',!won);
  $('result-eyebrow').textContent=won?'捷报传来 · 城关无恙':'整军再起 · 来日再战';$('result-mark').textContent=won?'胜':'守';$('result-title').textContent=won?'守关大捷':'城门失守';
  const last=config.levels.at(-1).id===state.levelId;
  $('result-copy').textContent=won?(last?'三关皆定, 英灵齐聚. 可以重返任意关卡, 试试新的布阵.':'敌军已退. 带上新的战术, 继续守住下一道关口.'):'试着提前发展灵气, 用张飞挡住敌人, 为黄忠争取输出时间.';
  $('result-stats').replaceChildren();for(const [label,value] of [['守关用时',clock(state.elapsed)],['城门耐久',`${state.gateHp} / 3`]]){const span=document.createElement('span'),strong=document.createElement('strong');span.textContent=label;strong.textContent=value;span.append(strong);$('result-stats').append(span);}
  $('result-unlock').textContent=newUnits.length?'新英灵已解锁: '+newUnits.join(', ')+(saveWritable?'':' (本次未能保存, 仅当前页面有效)'):won?'关卡进度'+(saveWritable?'已保存至当前浏览器.':'暂存于当前页面.'):'撤除不返还灵气, 每一次部署都需要权衡.';
  $('result-primary').textContent=won?(last?'再战本关':'下一关 →'):'重新守关';$('result-dialog').showModal();
}

function frame(now) {
  const delta=lastTime===null?0:Math.min(.1,Math.max(0,(now-lastTime)/1000));lastTime=now;
  if(ready&&battle&&!paused&&!document.hidden&&!finished) {
    try {
      const events=battle.state.status==='running'?battle.advance(delta):[];
      presentation.advance(delta,battle.state,events);updateHud();
      if(events.some(event=>event.type==='leak'))toast(`敌军突破防线, 城门还剩 ${battle.state.gateHp} 点耐久.`);
      if(battle.state.status!=='running'){$('remove-mode').disabled=true;if(presentation.settled)finishBattle();}
    }catch(error){setPause(true);toast('战斗已暂停: '+error.message);}
  }
  if(now>toastUntil)$('toast').hidden=true;
  render();requestAnimationFrame(frame);
}
function locateCell(event) {
  const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*WIDTH/rect.width,y=(event.clientY-rect.top)*HEIGHT/rect.height;
  if(x<GRID.x||x>=GRID.x+GRID.width||y<GRID.y||y>=GRID.y+GRID.height)return null;
  return {col:Math.floor((x-GRID.x)/CELL_W),lane:Math.floor((y-GRID.y)/CELL_H)};
}
function placeAt(cell) {
  if(!battle||battle.state.status!=='running'||paused||!cell)return;
  try {
    if(removeMode){battle.remove(cell.lane,cell.col);toast('单位已撤除, 灵气不返还.');}
    else if(selectedUnitId!==null)battle.deploy(selectedUnitId,cell.lane,cell.col);
    else{toast('先选择左侧的英灵牌, 再点击空格部署.');return;}
    presentation.advance(0,battle.state);updateHud();render();
  }catch(error){toast(error.message);}
}

canvas.addEventListener('pointermove',event=>{hover=locateCell(event);});canvas.addEventListener('pointerleave',()=>{hover=null;});canvas.addEventListener('click',event=>{canvas.focus();placeAt(locateCell(event));});
canvas.addEventListener('contextmenu',event=>{event.preventDefault();if(ready)clearSelection();});
$('remove-mode').addEventListener('click',toggleRemove);$('pause').addEventListener('click',()=>setPause(!paused));$('restart').addEventListener('click',()=>battle&&startLevel(battle.state.levelId));$('choose-level').addEventListener('click',openLevels);
$('cover-action').addEventListener('click',()=>battle&&!finished?setPause(false):openLevels());$('level-close').addEventListener('click',()=>$('level-dialog').close());$('start-level').addEventListener('click',()=>startLevel(selectedLevelId));
$('result-levels').addEventListener('click',()=>{$('result-dialog').close();openLevels();});
$('result-primary').addEventListener('click',()=>{const index=config.levels.findIndex(level=>level.id===battle.state.levelId),next=battle.state.status==='won'?config.levels[index+1]:null;startLevel(next?.id||battle.state.levelId);});
$('reload').addEventListener('click',()=>location.reload());
$('audio-toggle').addEventListener('click',()=>{if(!sound)return;sound.setEnabled(!sound.enabled);updateAudio();if(sound.enabled)void sound.enableFromGesture();});
document.addEventListener('visibilitychange',()=>{lastTime=null;if(document.hidden){sound?.stop();if(battle&&!finished)setPause(true);}});
document.addEventListener('keydown',event=>{
  if(!ready||$('level-dialog').open||$('result-dialog').open||event.ctrlKey||event.metaKey||event.altKey||['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
  if(/^[1-5]$/.test(event.key)){const unit=config.units[Number(event.key)-1];if(unit)selectUnit(unit.id);}
  else if(event.code==='Space'){event.preventDefault();setPause(!paused);}
  else if(event.key.toLowerCase()==='d')toggleRemove();
  else if(event.key==='Escape')clearSelection();
  else if(event.target===canvas&&event.key.startsWith('Arrow')){event.preventDefault();hover??={lane:2,col:2};const [dx,dy]={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];hover={col:Math.max(0,Math.min(7,hover.col+dx)),lane:Math.max(0,Math.min(4,hover.lane+dy))};}
  else if(event.target===canvas&&event.key==='Enter'){event.preventDefault();placeAt(hover);}
});

async function load() {
  try {
    const params=new URLSearchParams(location.search),local=params.has('project'),projectId=params.get('project');
    if(local&&!/^[a-z][a-z0-9_-]{0,63}$/.test(projectId||''))throw new Error('项目标识无效, 请从资产编辑器的测试按钮进入.');
    const base=local?'/api/projects/'+encodeURIComponent(projectId):null;
    const response=await fetch(local?base+'/workspace':'./workspace.json',{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'无法读取已保存的游戏配置');
    project=data.project;if(!project||typeof project.name!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(project.id)||(local&&project.id!==projectId))throw new Error('游戏配置的项目标识不一致');
    workspace=data.workspace;config=parseGameConfig(workspace);runtime=await import(local?'/editor/hero-runtime.mjs':'./hero-runtime.mjs');runtime.normalizeHeroMotion(workspace.heroMotion);timing=runtime.createAttackTiming(workspace.heroMotion);
    sound=createBattleAudio(project.id,{onWarning:warnAudio});updateAudio();$('audio-toggle').disabled=false;
    const resource=path=>local?base+'/images?file='+encodeURIComponent(path):'./assets/'+path.split('/').map(encodeURIComponent).join('/');
    const required=new Map();for(const unit of config.units){required.set(unit.icon,unit.role===1?128:256);if(unit.weapon)required.set(unit.weapon,128);}for(const enemy of config.enemies)required.set(enemy.icon,256);
    await Promise.all([...required].map(([path,size])=>loadImage(path,size,resource(path))));
    readProgress();ready=true;
    document.title=project.name+' · 三国守关';$('game-title').textContent=project.name;$('choose-level').disabled=false;$('cover-action').disabled=false;$('cover-action').textContent='选择关卡 · 出征';renderCards();openLevels();
  }catch(error){$('load-error').hidden=false;$('load-error-message').textContent=error.message;$('cover-title').textContent='战场尚未整备';$('cover-copy').textContent='请检查上方提示, 修正项目配置或资源后重新读取.';$('cover-action').textContent='等待整备';$('unit-cards').textContent='配置或资源读取失败';}
}
paintTerrain();render();requestAnimationFrame(frame);await load();
