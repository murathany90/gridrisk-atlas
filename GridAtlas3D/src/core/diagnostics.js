// GridAtlas 3D v0.4 — src/core/diagnostics.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { config, state, layers, diagnostics } from './state.js';
import { ctx } from './context.js';
import { $, $$, toast } from './utils.js';
import { assets, electrical, edges, get, defaults, searchAssets } from '../data/station.js';
import { topology, calculatePath, sampleValues, flowDirection, updateMeasurements } from '../electrical/electrical.js';
import { orbit, focusAsset } from '../scene/scene.js';
import { updateWireVisibility } from '../scene/wires.js';
import { refreshVisuals } from '../scene/selection.js';
import { renderDetail } from '../ui/detail.js';
import { replay } from '../features/events.js';
import { placementOf } from '../data/placement.js';

// DETERMINISTIC MODEL CHECKS — snapshot/restore prevents changing the user's session.
function runSelfTests(){
 if(state.switchBusy||replay.playing){toast('Kabul kontrolü için etkin manevra veya replay tamamlanmalı.',true);return [];}
 const checks=[],check=(name,ok)=>checks.push({name,ok:!!ok}),saved={...state,pathIds:new Set(state.pathIds),sourceOutages:new Set(state.sourceOutages)},states=new Map(assets.map(a=>[a.assetId,a.state])),savedLayers={...layers},cameraState=ctx.camera?{target:orbit.wantedTarget.clone(),radius:orbit.wantedRadius,theta:orbit.wantedTheta,phi:orbit.wantedPhi}:null;
 try{
  const count=(type,kv)=>electrical.filter(a=>a.type===type&&a.voltageLevel===kv).length,atrs=electrical.filter(a=>a.subtype==='autotransformer'),trs=electrical.filter(a=>a.subtype==='powerTransformer');
  check('Moduler yapi (v0.6) / paket Three.js / WebGL',!!ctx.renderer&&document.querySelectorAll('script[src^="http"],link[href^="http"],img[src^="http"]').length===0);
  check('4 adet 400 kV hat fideri',count('line',400)===4);
  check('6 adet 154 kV hat fideri',count('line',154)===6);
  check('2 adet 400/154 kV ototrafo',atrs.length===2&&atrs.every(a=>a.hvKV===400&&a.lvKV===154&&a.terminals.in.length===3&&a.terminals.out.length===3));
  check('3 adet 154/33 kV güç trafosu',trs.length===3&&trs.every(a=>a.hvKV===154&&a.lvKV===33&&a.terminals.in.length===3&&a.terminals.out.length===3));
  check('Her hat için son direk + portal',assets.filter(a=>a.kind==='terminalTower').length===10&&assets.filter(a=>a.kind==='portal').length===10&&electrical.filter(a=>a.type==='line').every(a=>get(a.terminalTower)?.linkedAsset===a.assetId&&get(a.portal)?.linkedAsset===a.assetId&&a.leadPath.length===3));
  const main=get('CONTROL-154'),og=get('BUILDING-33'),mp=placementOf(main),op=placementOf(og);check('Bitişik kumanda + 33 kV OG kompleksi',main.complexId===og.complexId&&mp.x+21===op.x-39&&mp.z===op.z&&electrical.filter(a=>a.cubicleRole==='incomer').length===3);
  check('3D / ağaç / SLD / arama entegrasyonu',assets.every(a=>{const g=ctx.assetGroups.get(a.assetId);let meshFound=false;g?.traverse(o=>{if(o.isMesh)meshFound=true;});return meshFound&&!!$('.tree-item[data-asset="'+a.assetId+'"]')&&searchAssets(a.tag).includes(a);})&&electrical.every(a=>!!$('#sld [data-asset="'+a.assetId+'"]'))&&new Set(assets.map(a=>a.assetId)).size===assets.length&&new Set(assets.map(a=>a.tag)).size===assets.length);
  assets.forEach(a=>a.state=defaults.get(a.assetId));state.sourceActive=true;state.sourceOutages=new Set();state.reverseFlow=false;state.overload=false;state.voltage='all';state.phase='all';state.isolate=null;state.path=false;state.mode='analysis';state.flowP=true;state.flowQ=true;state.powerFlow=true;Object.keys(layers).forEach(k=>layers[k]=true);topology();
  const positive=[...atrs,...trs].every(a=>sampleValues(a).p>0),reactor=get('REACTOR-400'),cap=get('CAP-154'),qOK=sampleValues(reactor).q>0&&sampleValues(cap).q<0&&sampleValues(reactor).p===0&&sampleValues(cap).p===0;
  const cb=get(get('TR-1').hvBreaker);cb.state='OPEN';topology();updateWireVisibility();const isolation=!get('BUS-33-A').energized&&get('BUS-33-B').energized&&get('BUS-33-C').energized&&get('BUS-154-A').energized&&sampleValues(cb).p===0&&sampleValues(cb).q===0;cb.state='CLOSED';get('CB-581').state='OPEN';get('CB-681').state='OPEN';topology();const shuntStops=sampleValues(reactor).q===0&&sampleValues(cap).q===0;get('CB-581').state='CLOSED';get('CB-681').state='CLOSED';topology();
  state.selected=get('ATR-2').assetId;state.path=true;calculatePath();state.xray=true;state.cutaway=true;refreshVisuals();focusAsset();const interaction=state.pathIds.has(state.selected)&&$('.tree-item.selected')?.dataset.asset===state.selected&&$('#sld .asset.selected')?.dataset.asset===state.selected&&ctx.ground.material.opacity<.2&&ctx.parts.some(p=>p.userData.parentAssetId===state.selected&&p.userData.explode.length()>0)&&orbit.wantedRadius>0;
  check('Seçim / focus / kesit / enerji yolu / P-Q izolasyonu',positive&&qOK&&isolation&&shuntStops&&interaction&&flowDirection(-20)===-1);
  check('JavaScript runtime error / rejection = 0',diagnostics.errors.length===0&&diagnostics.rejections.length===0);
 }catch(e){diagnostics.errors.push(e.message);while(checks.length<10)check('Kabul kontrolü: '+e.message,false);}
 finally{Object.assign(state,saved);Object.assign(layers,savedLayers);assets.forEach(a=>a.state=states.get(a.assetId));if(cameraState){orbit.wantedTarget.copy(cameraState.target);orbit.wantedRadius=cameraState.radius;orbit.wantedTheta=cameraState.theta;orbit.wantedPhi=cameraState.phi;}topology();updateMeasurements(true);refreshVisuals();renderDetail();}
 diagnostics.checks=checks;$('#selftest-results').textContent=checks.map(c=>(c.ok?'PASS':'FAIL')+' · '+c.name).join('\n')+'\n'+checks.filter(c=>c.ok).length+' / '+checks.length+' başarılı';updateValidationReport();return checks;
}
function stationReport(){return {version:config.version,assetCount:assets.length,electricalAssetCount:electrical.length,line400:electrical.filter(a=>a.type==='line'&&a.voltageLevel===400).length,line154:electrical.filter(a=>a.type==='line'&&a.voltageLevel===154).length,autotransformers:electrical.filter(a=>a.subtype==='autotransformer').length,powerTransformers:electrical.filter(a=>a.subtype==='powerTransformer').length,terminalTowers:assets.filter(a=>a.kind==='terminalTower').length,portals:assets.filter(a=>a.kind==='portal').length,cubicles:electrical.filter(a=>a.enclosure).length,edgeCount:edges.length,pass:diagnostics.checks.filter(c=>c.ok).length,total:diagnostics.checks.length,javaScriptErrors:diagnostics.errors.length,unhandledRejections:diagnostics.rejections.length,webgl:!!ctx.renderer,drawCalls:ctx.renderer?.info.render.calls,triangles:ctx.renderer?.info.render.triangles,sldElectrical:electrical.filter(a=>!!$('#sld [data-asset="'+a.assetId+'"]')).length,externalAssets:document.querySelectorAll('script[src^="http"],link[href^="http"],img[src^="http"]').length};}
function updateValidationReport(){if($('#validation-stats'))$('#validation-stats').textContent=JSON.stringify(stationReport(),null,2);}

export { runSelfTests, stationReport, updateValidationReport };
