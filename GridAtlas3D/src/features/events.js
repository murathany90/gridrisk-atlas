// GridAtlas 3D v0.4 — src/features/events.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $, esc, time } from '../core/utils.js';
import { state } from '../core/state.js';
import { get } from '../data/station.js';

// REPLAY / EVENTS
const events=[];
let eventSequence=0;
const replay={playing:false,time:0,speed:1,step:0,duration:8,started:false};
function addEvent(level,message,tag='LINE-400-01'){if(level==='alarm'||level==='warning')state.alarmAck=false;events.unshift({id:++eventSequence,time:Date.now(),level,message,assetId:get(tag)?.assetId||get('LINE-400-01').assetId});if(events.length>150)events.pop();renderEvents();}
function renderEvents(){$('#alarm-ack').classList.toggle('hidden',!state.alarm||state.alarmAck);$('#event-count').textContent=events.length;$('#events').innerHTML=events.map(e=>`<button class="event-row ${e.level}" data-event="${e.id}" title="İlgili ekipmanı seç"><time class="mono">${time(e.time)}</time><span class="severity">${e.level==='alarm'?'! ALARM':e.level==='warning'?'! WARNING':'● EVENT'}</span><span>${esc(e.message)}</span><span class="muted mono">${get(e.assetId).tag}</span></button>`).join('');}
function ensureBottomOpen(){document.body.classList.remove('bottom-minimized');}

export { events, eventSequence, replay, addEvent, renderEvents, ensureBottomOpen };
