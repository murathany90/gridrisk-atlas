// GridAtlas 3D v0.4 — src/features/tools.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { $, toast } from '../core/utils.js';
import { state, layers } from '../core/state.js';
import { ctx } from '../core/context.js';
import { get, rootAsset, electrical, network } from '../data/station.js';
import { renderLayers } from '../ui/tree.js';
import { refreshVisuals, selectAsset } from '../scene/selection.js';
import { focusAsset } from '../scene/scene.js';
import { updatePhaseBatches, updateWireGeometry, terminalWorld } from '../scene/wires.js';
import { visibleObject } from '../scene/visibility.js';
import { v } from '../scene/materials.js';
import { switchAnimations, finishSwitch } from './training.js';
import { replay } from './events.js';

// EXPLODED VIEW, X-RAY AND PROTECTION
function toggleExploded(forceTransformer=false){let selected=rootAsset(get(state.selected));if(!selected||forceTransformer&&selected.type!=='transformer'){selected=electrical.find(a=>a.type==='transformer');selectAsset(selected.assetId,false);}if(state.exploded&&state.explodeTarget!==selected.assetId)state.exploded=false;state.exploded=!state.exploded;state.explodeTarget=selected.assetId;refreshVisuals();if(state.exploded)focusAsset(selected.assetId);}
function explodeVector(a){const selected=get(state.explodeTarget);if(!selected||selected.type==='transformer'||selected.type==='part')return v();if(a.type==='structure'||a.type==='part'||a.type==='busbar')return v();if(a.bay===selected.bay&&a.voltageLevel===selected.voltageLevel){const peers=electrical.filter(x=>x.bay===a.bay&&x.voltageLevel===a.voltageLevel);const index=peers.indexOf(a);return v(0,index*.45,(index-(peers.length-1)/2)*3.2);}return v();}
function animateModels(dt){
 const speed=1-Math.exp(-dt*6),ease=(from,to)=>Math.abs(from-to)<.0001?to:THREE.MathUtils.lerp(from,to,speed),newSpread=ease(ctx.spreadAmount,state.spread?1.8:1),newExplode=ease(ctx.explodeAmount,state.exploded?1:0);let changed=newSpread!==ctx.spreadAmount||newExplode!==ctx.explodeAmount;const moveEquipment=newExplode!==ctx.explodeAmount;ctx.spreadAmount=newSpread;ctx.explodeAmount=newExplode;if(changed)ctx.phaseGroups.forEach(p=>{if(p.userData.busPhase)p.position.z=p.userData.baseZ*ctx.spreadAmount;else p.position.x=p.userData.baseX*ctx.spreadAmount;});
 const target=rootAsset(get(state.explodeTarget));ctx.parts.forEach(p=>{const desired=state.exploded&&target?.assetId===p.userData.parentAssetId?1:0,next=ease(p.userData.amount||0,desired);if(next!==(p.userData.amount||0)){changed=true;p.userData.amount=next;p.position.copy(p.userData.base).addScaledVector(p.userData.explode,next);}});if(moveEquipment)electrical.forEach(a=>{const g=ctx.assetGroups.get(a.assetId);g.position.copy(g.userData.base).addScaledVector(explodeVector(a),ctx.explodeAmount);});
 const paused=replay.started&&!replay.playing&&replay.time<replay.duration&&switchAnimations.length>0,contactDt=paused?0:dt*(replay.playing?replay.speed:1);for(const c of ctx.movingContacts){const a=get(c.assetId),dest=a.state==='OPEN'||a.state==='OPENING'?1:0;if(c.initialized&&c.progress===dest)continue;c.progress=Math.abs(c.progress-dest)<.0001?dest:THREE.MathUtils.lerp(c.progress,dest,1-Math.exp(-contactDt*12));if(c.kind==='cb'){c.mesh.position.z=-c.progress*c.stroke;c.mesh.position.y=c.baseY+c.progress*.2;}else if(c.kind==='es')c.mesh.rotation.x=c.closedAngle*(1-c.progress);else if(c.kind==='cubicle')c.mesh.rotation.z=c.progress*1.3;else c.mesh.rotation.x=-c.progress*Math.PI*.49;c.initialized=true;}
 for(let i=switchAnimations.length-1;i>=0;i--){const item=switchAnimations[i];item.elapsed+=contactDt;if(item.elapsed>=.72){switchAnimations.splice(i,1);finishSwitch(item);}}
 if(state.fans!==false)for(const f of network.fans||[]){const a=rootAsset(get(f.owner));if(a?.energized&&visibleObject(f.rotor)&&ctx.camera.position.distanceTo(ctx.assetGroups.get(a.assetId).position)<180)f.rotor.rotation.z+=dt*2.5;}
 if(changed){updatePhaseBatches();updateWireGeometry();if(state.selected&&ctx.selectionBox.visible)ctx.selectionBox.box.setFromObject(ctx.assetGroups.get(state.selected));}
}
function clearZone(){if(!ctx.zoneGroup)return;while(ctx.zoneGroup.children.length){const c=ctx.zoneGroup.children[0];ctx.zoneGroup.remove(c);c.geometry?.dispose();c.material?.dispose();}}
function showZone(kind){state.zone=kind;layers.protection=kind!=='none';clearZone();if(!ctx.scene||kind==='none'){renderLayers();refreshVisuals();return;}let candidates=[];
 if(kind==='transformer'){const selected=rootAsset(get(state.selected)),tr=selected?.type==='transformer'?selected:electrical.find(a=>a.type==='transformer');const neighbors=electrical.filter(a=>a.bay===tr.bay);candidates=[tr,...neighbors];}
 if(kind==='line')candidates=electrical.filter(a=>a.bay==='LINE-01'&&a.voltageLevel===400);
 if(kind==='bus')candidates=electrical.filter(a=>a.voltageLevel===(Number(state.voltage)||400)&&(a.type==='busbar'||a.type==='currentTransformer'));
 const bounds=new THREE.Box3();for(const a of candidates)bounds.union(new THREE.Box3().setFromObject(ctx.assetGroups.get(a.assetId)));bounds.expandByScalar(2);const size=bounds.getSize(v()),center=bounds.getCenter(v()),geo=new THREE.BoxGeometry(size.x,size.y,size.z),material=new THREE.MeshBasicMaterial({color:0xd5ac70,transparent:true,opacity:.09,depthWrite:false,side:THREE.DoubleSide}),volume=new THREE.Mesh(geo,material);volume.position.copy(center);ctx.zoneGroup.add(volume);const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:0xd5ac70,transparent:true,opacity:.6}));outline.position.copy(center);ctx.zoneGroup.add(outline);renderLayers();refreshVisuals();toast('Koruma kapsamı gösteriliyor · Geometrik eğitim temsili.');}
// GEOMETRIC MEASUREMENT
let measurePoints=[];
function clearMeasure(){measurePoints=[];$('#measurement').classList.add('hidden');if(ctx.measureGroup){while(ctx.measureGroup.children.length){const c=ctx.measureGroup.children[0];ctx.measureGroup.remove(c);c.geometry?.dispose();c.material?.dispose();}}}
function addMeasurePoint(point){if(measurePoints.length===2)clearMeasure();measurePoints.push(point.clone());if(ctx.measureGroup){const marker=new THREE.Mesh(new THREE.SphereGeometry(.45,10,6),new THREE.MeshBasicMaterial({color:0xe8cf8d,depthTest:false}));marker.position.copy(point);ctx.measureGroup.add(marker);}if(measurePoints.length===1){$('#measurement').innerHTML='İlk nokta seçildi. İkinci noktayı seçin.<small>Geometrik ölçüm · DEMO · Metre</small>';$('#measurement').classList.remove('hidden');return;}const distance=measurePoints[0].distanceTo(measurePoints[1]);if(ctx.measureGroup){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePoints),new THREE.LineDashedMaterial({color:0xebd6a0,depthTest:false,dashSize:.7,gapSize:.3}));line.computeLineDistances();ctx.measureGroup.add(line);}$('#measurement').innerHTML=`Mesafe <b class="mono" style="font-size:20px;margin-left:10px">${distance.toFixed(2)} m</b><small>Yalnız geometrik/demo ölçüm · Yeni ölçüm için iki nokta seçin.</small>`;$('#measurement').classList.remove('hidden');}
function clearanceDemo(){if(!ctx.scene){toast('Clearance için WebGL sahnesi gerekir.',true);return;}const a=get(state.selected)||get('CB-401'),root=a.parent?get(a.parent):a;if(!root.terminals){toast('Elektriksel ekipman seçin.');return;}clearMeasure();const p=terminalWorld(root,'in',0),q=p.clone();q.y=-.35;addMeasurePoint(p);addMeasurePoint(q);$('#measurement').innerHTML+=`<small>${root.tag} · Faz A terminali → saha zemini; tasarım güvenlik mesafesi değildir.</small>`;focusAsset(root.assetId);}

export { toggleExploded, explodeVector, animateModels, clearZone, showZone, measurePoints, clearMeasure, addMeasurePoint, clearanceDemo };
