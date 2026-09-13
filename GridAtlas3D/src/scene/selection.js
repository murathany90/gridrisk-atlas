// GridAtlas 3D v0.4 — src/scene/selection.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { state, layers } from '../core/state.js';
import { $, $$, node } from '../core/utils.js';
import { get, rootAsset, profileFor, edges, stateText, network } from '../data/station.js';
import { calculatePath } from '../electrical/electrical.js';
import { focusAsset } from './scene.js';
import { updateSymbol } from '../sld/sld.js';
import { updateWireVisibility, rebuildDebug, updatePhaseBatches } from './wires.js';
import { updateStatus } from '../ui/detail.js';
import { emit, Events } from '../core/bus.js';

import { assetSelected, isAssetVisible } from './visibility.js';

function refreshVisuals(){
 if(ctx.scene){
  ctx.assetGroups.forEach((g,id)=>{const a=get(id),root=rootAsset(a);g.visible=isAssetVisible(a);if(a.type==='part'&&state.isolate?.scope==='asset'&&get(state.isolate.id)?.type==='part')g.visible=g.visible&&state.isolate.id===id;
   for(const m of g.userData.materials||[]){let opacity=(m.userData.baseOpacity??1)*(state.xray?.22:1);if(m.userData.shell&&(state.cutaway||state.xray))opacity=.07;if(state.path&&!state.pathIds.has(root.assetId))opacity=Math.min(opacity,.14);if(m.transparent!==(opacity<1)){m.transparent=opacity<1;m.needsUpdate=true;}m.opacity=opacity;m.depthWrite=opacity>.5;m.color.copy(m.userData.baseColor);m.emissive.set(root.energized?0x24483e:0);m.emissiveIntensity=.08;
    if(assetSelected(a)){m.emissive.set(0x48876a);m.emissiveIntensity=.3;}if(state.path&&state.pathIds.has(root.assetId)){m.emissive.set(0x73966b);m.emissiveIntensity=.28;}
    if(state.mode==='analysis'&&state.analysis!=='none'&&root.measurements.voltage){const val=state.analysis==='voltage'?Math.abs(root.measurements.voltage.value/profileFor(root).nominal-1):root.measurements.loading.value;const c=state.analysis==='voltage'?(val>.05?0xde8b73:val>.025?0xd5bb7d:0x88c8bd):(val>100?0xe78e79:val>80?0xd4a363:val>50?0xb6c599:0x8fbcbd);m.color.lerp(new THREE.Color(c),.55);}
    if(root.measurements.loading?.value>100){m.emissive.set(0x985324);m.emissiveIntensity=.3;}
   }
  });
  ctx.phaseGroups.forEach(p=>p.visible=state.phase==='all'||p.userData.phase===state.phase);updatePhaseBatches();ctx.structures.visible=layers.structure;if(network.infrastructure)network.infrastructure.visible=!state.isolate;ctx.groundGrid.visible=state.xray||layers.grounding;ctx.trenches.visible=state.xray||layers.trenches;ctx.underground.visible=ctx.groundGrid.visible||ctx.trenches.visible;
  if(ctx.ground.material.transparent!==ctx.underground.visible){ctx.ground.material.transparent=ctx.underground.visible;ctx.ground.material.needsUpdate=true;}ctx.ground.material.opacity=ctx.underground.visible?.1:1;ctx.ground.material.depthWrite=!ctx.underground.visible;ctx.ground.userData.regions.visible=!ctx.underground.visible;updateWireVisibility();
  if(ctx.selectionBox){ctx.selectionBox.visible=!!state.selected&&!!ctx.assetGroups.get(state.selected)&&isAssetVisible(get(state.selected));if(ctx.selectionBox.visible)ctx.selectionBox.box.setFromObject(ctx.assetGroups.get(state.selected));}if(state.terminals||state.connectivity)rebuildDebug();
 }
 $$('.tree-item').forEach(el=>{const a=get(el.dataset.asset);el.classList.toggle('selected',a.assetId===state.selected);el.classList.toggle('deenergized',!a.energized);el.setAttribute('aria-selected',String(a.assetId===state.selected));});
 $$('#sld .asset').forEach(el=>{const a=get(el.dataset.asset);el.classList.toggle('selected',a.assetId===state.selected||a.assetId===get(state.selected)?.parent);el.classList.toggle('live',a.energized);el.classList.toggle('open',a.state==='OPEN');el.classList.toggle('path',state.path&&state.pathIds.has(a.assetId));el.setAttribute('aria-label',a.name+' · '+a.tag+' · '+stateText(a)+(a.energized?' · Enerjili':' · Enerjisiz'));updateSymbol(el,a);});
 $$('#sld .wire[data-edge]').forEach(el=>{const e=edges[+el.dataset.edge];el.classList.toggle('live',ctx.liveTerminals.has(node(e.a,e.pa))&&ctx.liveTerminals.has(node(e.b,e.pb)));});
 $$('[data-voltage]').forEach(b=>b.classList.toggle('active',b.dataset.voltage===state.voltage));$$('[data-phase]').forEach(b=>b.classList.toggle('active',b.dataset.phase===state.phase));
 for(const [action,on] of [['energy',state.path],['xray',state.xray],['cutaway',state.cutaway],['explode-tr',state.exploded],['phase-spread',state.spread],['measure',state.measure],['labels',state.labels],['zones',state.zone!=='none']])$$(`[data-action="${action}"]`).forEach(b=>{b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
 const modes=[];if(state.isolate)modes.push('YALNIZ GÖSTER / '+get(state.isolate.id).tag);if(state.path)modes.push('ENERJİ YOLU / '+state.pathIds.size+' ekipman');if(state.xray)modes.push('X-RAY');if(state.cutaway)modes.push('KABİN KESİTİ');if(state.exploded)modes.push('PATLATILMIŞ GÖRÜNÜM');if(state.spread)modes.push('FAZLAR AYRI');if(state.zone!=='none')modes.push('KORUMA BÖLGESİ');if(state.mode==='training')modes.push('SIMULATION ONLY');$('#scene-mode').textContent=modes.join(' · ');$('#scene-mode').classList.toggle('hidden',!modes.length);updateStatus();
}
function selectAsset(id,focus=true){const a=get(id);if(!a)return;state.selected=a.assetId;state.trend=rootAsset(a).type==='transformer'?'p':'voltage';const leftBody=$('.left-body');if(leftBody)leftBody.scrollTop=0;if(state.path)calculatePath();emit(Events.ASSET_SELECTED,{assetId:a.assetId,focus});refreshVisuals();if(focus)focusAsset(a.assetId);if(innerWidth<=900){document.body.classList.add('mobile-left');document.body.classList.remove('mobile-right');}}
function clearSelection(){const leftBody=$('.left-body');if(leftBody)leftBody.scrollTop=0;state.selected=null;state.hover=null;if(ctx.hoverBox)ctx.hoverBox.visible=false;$('#tooltip').classList.add('hidden');emit(Events.ASSET_SELECTED,{assetId:null});refreshVisuals();}

export { refreshVisuals, selectAsset, clearSelection };
