// GridAtlas 3D v0.4 — src/scene/visibility.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { state, layers } from '../core/state.js';
import { get, rootAsset, assetVoltages, voltageProfiles } from '../data/station.js';

// SELECTION / VISIBILITY
function assetSelected(a){return a.assetId===state.selected||a.parent===state.selected;}
function isAssetVisible(asset){
 const a=rootAsset(asset),levels=assetVoltages(a);if(a.type==='structure'&&!layers.structure)return false;if(layers[a.type]===false||a.subtype&&layers[a.subtype]===false)return false;
 if(levels.length&&!levels.some(k=>layers[voltageProfiles[k].layer]&&(state.voltage==='all'||Number(state.voltage)===k)))return false;
 if(state.isolate){const selected=get(state.isolate.id),sr=rootAsset(selected);if(!sr)return true;if(state.isolate.scope==='asset'&&a.assetId!==sr.assetId)return false;if(state.isolate.scope==='bay'&&(a.bay!==sr.bay||a.voltageLevel!==sr.voltageLevel))return false;if(state.isolate.scope==='voltage'&&!levels.some(k=>assetVoltages(sr).includes(k)))return false;}
 return true;
}
function visibleObject(obj){let p=obj;while(p){if(!p.visible)return false;p=p.parent;}return true;}
function owningAsset(obj){let p=obj;while(p){if(p.userData.assetId)return p.userData.assetId;p=p.parent;}return null;}

export { assetSelected, isAssetVisible, visibleObject, owningAsset };
