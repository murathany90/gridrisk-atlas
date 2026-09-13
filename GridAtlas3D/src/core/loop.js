// GridAtlas 3D v0.4 — src/core/loop.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { state } from './state.js';
import { ctx } from './context.js';
import { $ } from './utils.js';
import { updateCamera } from '../scene/scene.js';
import { animateModels } from '../features/tools.js';
import { updateReplay } from '../features/replay.js';
import { animateFlows, updateWireVisibility } from '../scene/wires.js';
import { updateLabels } from '../ui/detail.js';
import { updateMeasurements } from '../electrical/electrical.js';
import { refreshVisuals } from '../scene/selection.js';
import { isParentVisible } from '../integration/parentBridge.js';

// APP LOOP — bounded animation step, reused geometries, limited DOM frequency.
let lastFrame=0,frameCount=0,fpsTime=0,lastMeasure=0;
function frame(now){
 if(!ctx.renderer)return;const dt=lastFrame?Math.min((now-lastFrame)/1000,.5):.016;lastFrame=now;
 if(!document.hidden&&isParentVisible()){updateCamera(dt);animateModels(dt);updateReplay(dt);animateFlows(now);updateLabels(now);ctx.renderer.render(ctx.scene,ctx.camera);frameCount++;}
 if(now-fpsTime>=1000){$('#status-fps').textContent=Math.round(frameCount*1000/(now-fpsTime))+' FPS';frameCount=0;fpsTime=now;}requestAnimationFrame(frame);
}
function tickData(){updateMeasurements();updateWireVisibility();if(state.mode==='analysis')refreshVisuals();if(!ctx.renderer)updateReplay(1);}

export { lastFrame, frameCount, fpsTime, lastMeasure, frame, tickData };
