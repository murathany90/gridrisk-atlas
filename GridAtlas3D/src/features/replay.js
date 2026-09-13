// GridAtlas 3D v0.4 — src/features/replay.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $, toast } from '../core/utils.js';
import { state } from '../core/state.js';
import { ctx } from '../core/context.js';
import { get, assets, defaults, bays, network } from '../data/station.js';
import { topology, updateMeasurements, calculatePath } from '../electrical/electrical.js';
import { addEvent, renderEvents, replay, ensureBottomOpen } from './events.js';
import { commandSwitch, switchAnimations } from './training.js';
import { selectAsset, refreshVisuals } from '../scene/selection.js';
import { renderDetail, updateDetailValues } from '../ui/detail.js';


function normalOperation(log=true){
 replay.playing=false;replay.time=0;replay.step=0;replay.started=false;switchAnimations.length=0;state.switchBusy=false;state.sourceActive=true;state.sourceOutages.clear();state.reverseFlow=false;state.alarm=false;state.overload=false;state.alarmAck=false;state.quality=false;$('#setting-quality').checked=false;
 assets.forEach(a=>a.state=defaults.get(a.assetId));ctx.movingContacts.forEach(m=>{m.progress=get(m.assetId).state==='OPEN'?1:0;m.initialized=false;});topology();updateMeasurements(true);refreshVisuals();renderDetail();updateReplayUI();renderEvents();if(log)addEvent('normal','Normal Operation · Yerel senaryo sıfırlandı');
}
function startReplay(){normalOperation(false);replay.started=true;replay.playing=true;ensureBottomOpen();addEvent('normal','Replay başlatıldı · Normal Operation');updateReplayUI();toast('Arıza tekrar senaryosu başladı. 3D saha ve tek-hat birlikte güncellenir.');}
const replaySteps=[
 {at:1.5,run:()=>{state.alarm=true;addEvent('alarm','400 kV Line-01 · Faz-toprak arızası','LINE-400-01');refreshVisuals();}},
 {at:3,run:()=>addEvent('alarm','Protection Trip · Hat koruması açma sinyali','CB-401')},
 {at:3.15,run:()=>commandSwitch('CB-401',true,'OPEN')},
 {at:4.3,run:()=>{state.sourceOutages.add(network.sourceTag);topology();updateMeasurements(true);refreshVisuals();updateDetailValues();addEvent('warning','Hat-01 uzak kaynak açması · diğer kaynaklar beslemeyi sürdürür','LINE-400-01');}},
 {at:5.5,run:()=>{addEvent('alarm','Hat açması kilitlendi · Alarm onayı bekleniyor','CB-401');}},
 {at:7.5,run:()=>{addEvent('normal','Replay tamamlandı · Sıfırla ile normal işletmeye dönün','CB-401');toast('Replay tamamlandı · Hat-01 açıldı, diğer üç kaynak devrede.');}}
];
function updateReplay(dt){if(!replay.playing)return;replay.time=Math.min(replay.duration,replay.time+dt*replay.speed);while(replay.step<replaySteps.length&&replay.time>=replaySteps[replay.step].at){replaySteps[replay.step].run();replay.step++;}if(replay.time>=replay.duration)replay.playing=false;updateReplayUI();}
function updateReplayUI(){$('#replay-progress').style.width=replay.time/replay.duration*100+'%';$('#replay-time').textContent='00:'+String(Math.floor(replay.time)).padStart(2,'0');$('#replay-controls [data-action="replay-play"]').textContent=replay.playing?'Ⅱ Duraklat':replay.started&&replay.time<replay.duration?'▶ Devam':'▶ Tekrar';}
function demoScenario(kind){normalOperation(false);
 if(kind==='trip'){state.alarm=true;commandSwitch('CB-401',true,'OPEN');addEvent('alarm','Hat-01 kesicisi açıldı; diğer kaynaklar devrede','CB-401');selectAsset('CB-401',false);}
 if(kind==='transfer'){for(const b of bays.filter(b=>b.kind==='line'&&b.voltage===400)){get(b.dsA).state='OPEN';get(b.dsB).state='CLOSED';}topology();updateMeasurements(true);addEvent('normal','400 kV hat fiderleri Bara-B üzerinden besleniyor; kuplaj kapalı','BUS-400-B');selectAsset('BUS-400-B',false);state.path=true;calculatePath();}
 if(kind==='alarm'){state.alarm=true;state.overload=true;updateMeasurements(true);addEvent('warning','ATR yüklenme alarmı · DEMO','ATR-1');selectAsset('ATR-1',false);}
 if(kind==='quality'){state.quality=true;$('#setting-quality').checked=true;updateMeasurements(true);addEvent('warning','Veri kalitesi: CVT-401 STALE / ATR-1 INVALID / VT-151 SUBSTITUTED','CVT-401');selectAsset('CVT-401',false);}
 if(kind==='reverse'){state.reverseFlow=true;topology();updateMeasurements(true);addEvent('normal','154 kV hatlardan 400 kV kaynaklara ters aktif güç · DEMO','LINE-154-01');}
 if(kind==='normal')addEvent('normal','Normal işletme · dört kaynak, iki ATR, üç TR devrede');refreshVisuals();renderDetail();}

export { normalOperation, startReplay, replaySteps, updateReplay, updateReplayUI, demoScenario };
