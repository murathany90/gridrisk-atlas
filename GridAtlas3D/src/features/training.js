// GridAtlas 3D v0.4 — src/features/training.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { toast } from '../core/utils.js';
import { state } from '../core/state.js';
import { ctx } from '../core/context.js';
import { get, switchTypes } from '../data/station.js';
import { topology, updateMeasurements, interlock } from '../electrical/electrical.js';
import { refreshVisuals } from '../scene/selection.js';
import { updateDetailValues, renderDetail } from '../ui/detail.js';
import { addEvent, replay } from './events.js';

// TRAINING — purely local commands and simplified interlocks.
const switchAnimations=[];
function commandSwitch(id=state.selected,force=false,targetOverride){const a=get(id);if(!a||!switchTypes.includes(a.type))return false;
 if(!force&&state.mode!=='training'){toast('Kesici ve ayırıcı kumandaları Eğitim modunda kullanılabilir.');return false;}
 if(!force&&(state.switchBusy||replay.playing)){toast('Devam eden geçişin veya replay senaryosunun bitmesini bekleyin.',true);return false;}
 const target=targetOverride||(a.state==='CLOSED'?'OPEN':'CLOSED');if(a.state===target)return true;
 const reason=force?null:interlock(a,target);if(reason){toast('İŞLEM ENGELLENDİ · '+reason,true);addEvent('warning','Interlock · '+reason,a.tag);return false;}
 if(!ctx.renderer){a.state=target;topology();updateMeasurements(true);refreshVisuals();renderDetail();addEvent('normal',a.tag+' '+target,a.tag);return true;}
 a.state=target==='OPEN'?'OPENING':'CLOSING';state.switchBusy=true;switchAnimations.push({a,target,elapsed:0});topology();updateMeasurements(true);refreshVisuals();updateDetailValues();return true;
}
function finishSwitch(item){item.a.state=item.target;state.switchBusy=switchAnimations.length>0;topology();updateMeasurements(true);refreshVisuals();updateDetailValues();addEvent('normal',item.a.tag+' '+item.target,item.a.tag);if(!replay.playing)toast(item.a.tag+' → '+item.target+' · Topoloji güncellendi.');}

export { switchAnimations, commandSwitch, finishSwitch };
