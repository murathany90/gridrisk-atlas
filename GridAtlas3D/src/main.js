// GridAtlas 3D v0.4 — src/main.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $, esc } from './core/utils.js';
import { config, state, diagnostics } from './core/state.js';
import { ctx } from './core/context.js';
import { assets, electrical, edges } from './data/station.js';
import { topology, updateMeasurements } from './electrical/electrical.js';
import { prepareV02UI, initUI, dialog } from './ui/controls.js';
import { renderTree, renderLayers } from './ui/tree.js';
import { buildSLD } from './sld/sld.js';
import { renderDetail, updateDetailValues, createLabels } from './ui/detail.js';
import { buildScene } from './scene/scene.js';
import { initInteraction } from './scene/interaction.js';
import { refreshVisuals } from './scene/selection.js';
import { frame, tickData } from './core/loop.js';
import { addEvent } from './features/events.js';
import { runSelfTests } from './core/diagnostics.js';
import { initParentBridge } from './integration/parentBridge.js';

topology();
updateMeasurements(true);
// APP INIT / FAILURE FALLBACK
function init(){initParentBridge();prepareV02UI();renderTree();renderLayers();buildSLD();renderDetail();initUI();try{/* three statik import edilir; yoklugu modul yuklemede hata verir */buildScene();createLabels();initInteraction();}catch(error){diagnostics.errors.push(error.message);const el=document.createElement('div');el.className='error-overlay';el.innerHTML='<h3>3D görünüm başlatılamadı</h3><p>'+esc(error.message)+'</p><p>Ekipman ağacı, ölçümler ve tek-hat şeması kullanılabilir.</p>';$('#viewport').append(el);}finally{$('#loading').style.opacity='0';setTimeout(()=>$('#loading').remove(),550);}addEvent('normal','Normal Operation · TM-01 yerel model hazır');refreshVisuals();updateDetailValues();requestAnimationFrame(frame);setInterval(tickData,1000);if(location.hash==='#verify')setTimeout(()=>{dialog('settings');runSelfTests();},1800);}
// Read-only diagnostics for reviewing the delivered single-file application.
 Object.defineProperty(window,'GridAtlasDiagnostics',{get:()=>({version:config.version,assetCount:assets.length,electricalAssets:electrical.length,edgeCount:edges.length,webgl:!!ctx.renderer,drawCalls:ctx.renderer?.info.render.calls,triangles:ctx.renderer?.info.render.triangles,errors:[...diagnostics.errors],checks:[...diagnostics.checks]})});
window.addEventListener('pagehide',()=>{if(ctx.renderer){const gs=new Set(ctx.geoCache.values()),ms=new Set(ctx.allMaterials),ts=new Set();ctx.scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>ms.add(m));});gs.forEach(g=>g.dispose());ms.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)ts.add(value);m.dispose();});ts.forEach(t=>t.dispose());ctx.renderer.dispose();ctx.resizeObserver?.disconnect();}},{once:true});
init();

export { init };
