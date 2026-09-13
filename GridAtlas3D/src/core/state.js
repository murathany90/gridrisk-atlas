// GridAtlas 3D v0.4 — src/core/state.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
const config={version:'0.6',updateMs:1000,historySeconds:60};
const state={mode:'inspect',selected:null,hover:null,voltage:'all',phase:'all',spread:false,xray:false,exploded:false,explodeTarget:null,isolate:null,path:false,pathIds:new Set(),zone:'none',analysis:'none',powerFlow:true,flowP:true,flowQ:true,cutaway:false,reverseFlow:false,labels:true,measure:false,pan:false,sourceOutages:new Set(),sourceActive:true,quality:false,alarm:false,overload:false,alarmAck:false,terminals:false,connectivity:false,shadows:true,trend:'voltage',switchBusy:false,leftTab:'assets'};
const layers={hv:true,lv:true,mv:true,reactor:true,capacitor:true,cable:true,transformer:true,autotransformer:true,powerTransformer:true,circuitBreaker:true,disconnector:true,earthSwitch:true,currentTransformer:true,voltageTransformer:true,arrester:true,busbar:true,line:true,lineTrap:true,structure:true,grounding:false,trenches:false,protection:false,measurements:false};
const diagnostics={errors:[],rejections:[],checks:[]};
window.addEventListener('error',e=>{diagnostics.errors.push(e.message);});
window.addEventListener('unhandledrejection',e=>{diagnostics.errors.push(String(e.reason));diagnostics.rejections.push(String(e.reason));});

export { config, state, layers, diagnostics };
