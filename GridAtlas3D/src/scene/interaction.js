// GridAtlas 3D v0.4 — src/scene/interaction.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { state } from '../core/state.js';
import { $, esc, bayName, clamp } from '../core/utils.js';
import { get, voltageText, stateText, site } from '../data/station.js';
import { flowText } from '../electrical/electrical.js';
import { orbit, panCamera } from './scene.js';
import { selectAsset, clearSelection } from './selection.js';
import { addMeasurePoint } from '../features/tools.js';
import { owningAsset, visibleObject } from './visibility.js';

// INTERACTION
let raycaster,mouse,pointerDown=null,pointers=new Map(),touchDistance=0,touchCenter=null,hoverTime=0;
function castAt(x,y,includeGround=false){const r=ctx.canvas.getBoundingClientRect();mouse.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);raycaster.setFromCamera(mouse,ctx.camera);return raycaster.intersectObjects(includeGround?[...ctx.pickables,ctx.ground]:ctx.pickables,false).find(hit=>visibleObject(hit.object)&&!((state.cutaway||state.xray)&&hit.object.material?.userData.shell));}
function initInteraction(){
 raycaster=new THREE.Raycaster();mouse=new THREE.Vector2();ctx.canvas.addEventListener('contextmenu',e=>e.preventDefault());
 ctx.canvas.addEventListener('pointerdown',e=>{ctx.canvas.focus({preventScroll:true});ctx.canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});pointerDown={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,button:e.button,moved:false};if(pointers.size===2){const p=[...pointers.values()];touchDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);touchCenter={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};}});
 ctx.canvas.addEventListener('pointermove',e=>{
  if(pointers.has(e.pointerId)){pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const p=[...pointers.values()],d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),c={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};orbit.wantedRadius=clamp(orbit.wantedRadius*(touchDistance/Math.max(1,d)),12,site.maxRadius);if(touchCenter)panCamera(c.x-touchCenter.x,c.y-touchCenter.y);touchDistance=d;touchCenter=c;pointerDown.moved=true;return;}
   if(pointerDown){const dx=e.clientX-pointerDown.lastX,dy=e.clientY-pointerDown.lastY;pointerDown.moved ||= Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>4;if(state.pan||pointerDown.button===2||e.shiftKey)panCamera(dx,dy);else {orbit.wantedTheta-=dx*.005;orbit.wantedPhi=clamp(orbit.wantedPhi-dy*.004,.025,1.49);}pointerDown.lastX=e.clientX;pointerDown.lastY=e.clientY;$('#tooltip').classList.add('hidden');}return;
  }
  if(performance.now()-hoverTime<65)return;hoverTime=performance.now();const hit=castAt(e.clientX,e.clientY);state.hover=hit?owningAsset(hit.object):null;ctx.canvas.style.cursor=state.measure?'crosshair':state.hover?'pointer':'grab';ctx.hoverBox.visible=!!state.hover&&state.hover!==state.selected;
  if(state.hover){const a=get(state.hover),root=a.parent?get(a.parent):a;ctx.hoverBox.box.setFromObject(ctx.assetGroups.get(a.assetId));const r=ctx.canvas.getBoundingClientRect();$('#tooltip').innerHTML=`<b>${esc(a.name)}</b><br><span class="mono">${esc(a.tag)}</span><br><span class="muted">${voltageText(a)} kV · ${esc(bayName(a))}</span><br>${stateText(root)} · ${root.energized?'ENERJİLİ':'ENERJİSİZ'}<br>${root.measurements.voltage?flowText(root):'Saha yapısı'}<br><span class="muted">${root.measurements.current?.quality||'DEMO'}</span>`;$('#tooltip').style.left=clamp(e.clientX-r.left+14,8,r.width-220)+'px';$('#tooltip').style.top=clamp(e.clientY-r.top+16,95,r.height-160)+'px';$('#tooltip').classList.remove('hidden');}else $('#tooltip').classList.add('hidden');
 });
 ctx.canvas.addEventListener('pointerup',e=>{const wasMulti=pointers.size>1;pointers.delete(e.pointerId);if(pointerDown&&!pointerDown.moved&&!wasMulti&&e.button===0){const hit=castAt(e.clientX,e.clientY,state.measure);if(state.measure&&hit)addMeasurePoint(hit.point);else if(hit){const id=owningAsset(hit.object);if(id)selectAsset(id,false);}else clearSelection();}pointerDown=null;touchCenter=null;});
 ctx.canvas.addEventListener('pointercancel',()=>{pointers.clear();pointerDown=null;touchCenter=null;});ctx.canvas.addEventListener('pointerleave',()=>{$('#tooltip').classList.add('hidden');ctx.hoverBox.visible=false;});
 ctx.canvas.addEventListener('wheel',e=>{e.preventDefault();orbit.wantedRadius=clamp(orbit.wantedRadius*Math.exp(e.deltaY*.001),12,site.maxRadius);},{passive:false});ctx.canvas.addEventListener('dblclick',e=>{if(state.measure)return;const hit=castAt(e.clientX,e.clientY);if(hit)selectAsset(owningAsset(hit.object),true);});
}

export { raycaster, mouse, pointerDown, pointers, touchDistance, touchCenter, hoverTime, castAt, initInteraction };
