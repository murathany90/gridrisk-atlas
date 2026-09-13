// GridAtlas 3D v0.4 — src/ui/tree.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $, bayName, esc } from '../core/utils.js';
import { layers } from '../core/state.js';
import { get, assets, electrical, voltageLevels, voltageProfiles } from '../data/station.js';
import { on, Events } from '../core/bus.js';

// UI — tree, overview, inspector, trends and synchronized selection.
function renderTree(){
 const groups=[];for(const level of voltageLevels){groups.push({title:level===33?'33 kV OG Kapalı Şalt':level+' kV Açık Şalt',theme:voltageProfiles[level].theme,list:assets.filter(a=>a.voltageLevel===level&&a.type!=='part'&&a.kind!=='controlBuilding'&&a.kind!=='switchgearBuilding')});const family=level===400?'autotransformer':level===154?'powerTransformer':null;if(family){const trs=electrical.filter(a=>a.subtype===family);groups.push({title:family==='autotransformer'?'400/154 kV Ototrafolar':'154/33 kV Güç Trafoları',theme:voltageProfiles[level].theme,list:trs.flatMap(tr=>[tr,...assets.filter(p=>p.parent===tr.assetId)])});}}groups.push({title:'Kumanda + OG Kompleksi ve Saha',theme:'',list:assets.filter(a=>['controlBuilding','switchgearBuilding','mast'].includes(a.kind))});
 $('#asset-tree').innerHTML=groups.map(group=>{const bayNames=[...new Set(group.list.map(bayName))];return `<details class="tree-group" open><summary class="${group.theme}">${group.title} <small>${group.list.length}</small></summary>${bayNames.map((bay,i)=>`<details class="tree-bay" ${i===0?'open':''}><summary>${esc(bay)}</summary>${group.list.filter(a=>bayName(a)===bay).map(a=>`<button class="tree-item" data-asset="${a.assetId}" title="${esc(a.name+' · '+a.tag)}"><span class="asset-dot"></span><span><b>${esc(a.name)}</b><small class="mono">${esc(a.tag)}</small></span></button>`).join('')}</details>`).join('')}</details>`;}).join('');$('#asset-count').textContent=assets.length+' varlık';$('#status-assets').textContent='Varlık: '+assets.length;
}
function renderLayers(){const names={...Object.fromEntries(voltageLevels.map(k=>[voltageProfiles[k].layer,k+' kV'])),autotransformer:'Ototrafolar · 400/154 kV',powerTransformer:'Güç Trafoları · 154/33 kV',reactor:'Şönt Reaktörler',capacitor:'Şönt Kapasitör Bankları',circuitBreaker:'Kesiciler',disconnector:'Ayırıcılar',earthSwitch:'Toprak Ayırıcıları',currentTransformer:'Akım Trafoları',voltageTransformer:'Gerilim Trafoları / CVT',arrester:'Parafudrlar',busbar:'Baralar',line:'Havai Hatlar',cable:'Güç Kabloları',lineTrap:'Hat Tıkaçları',structure:'Direk, Portal ve Binalar',grounding:'Topraklama',trenches:'Kablo Kanalları',protection:'Koruma Bölgeleri',measurements:'Ölçümler'};$('#layers-section').innerHTML='<div class="eyebrow">GÖRÜNÜRLÜK</div>'+Object.entries(names).map(([k,label])=>`<label><input type="checkbox" data-layer="${k}" ${layers[k]?'checked':''}>${label}</label>`).join('');}

function syncTreeSelection({ assetId } = {}) {
  if (!assetId) return;
  const tree = $(`.tree-item[data-asset="${assetId}"]`);
  if (!tree) return;
  let p = tree.parentElement;
  while (p && p !== $('#asset-tree')) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
  tree.scrollIntoView({ block: 'nearest' });
}
on(Events.ASSET_SELECTED, syncTreeSelection);

export { renderTree, renderLayers, syncTreeSelection };
