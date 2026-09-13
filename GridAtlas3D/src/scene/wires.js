// GridAtlas 3D v0.4 — src/scene/wires.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { state } from '../core/state.js';
import { PHASES, node, clamp } from '../core/utils.js';
import { get, rootAsset, electrical, edges, network, profileFor, switchTypes } from '../data/station.js';
import { assetFlows, flowVisual } from '../electrical/electrical.js';
import { isAssetVisible } from './visibility.js';
import { v, geometry } from './materials.js';
import { placementOf } from '../data/placement.js';

function terminalWorld(asset,port,i,other){
 const a=rootAsset(asset),local=a.terminals[port][i].clone();
 if(a.enclosure){local.z*=ctx.spreadAmount;}else if(a.type==='busbar'){const pa=placementOf(a);local.x=clamp(other?placementOf(other).x-pa.x:0,-a.busWidth/2,a.busWidth/2);local.z*=ctx.spreadAmount;}else{local.x*=ctx.spreadAmount;if(a.type==='transformer'){const part=ctx.assetGroups.get(a.parts[port==='in'?'HV':'LV']);if(part)local.add(part.position);}}
 return ctx.assetGroups.get(a.assetId).localToWorld(local);
}
function buildWires(){
 const definitions=edges.map(e=>({edge:e,internal:false}));for(const a of electrical)if(['busbar','transformer','line','circuitBreaker','disconnector'].includes(a.type)||a.enclosure)definitions.push({edge:{a:a.assetId,b:a.assetId,pa:'in',pb:'out',internal:true,flowP:0,flowQ:0},internal:true});
 for(const d of definitions)PHASES.forEach((phase,index)=>ctx.wires.push({...d,phase,index,points:[],line:{visible:true},dots:{visible:false},qDots:{visible:false},energized:false}));
 const max=ctx.wires.length*48,geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(max*3),3));geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(max*3),3));const lines=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.85}));lines.frustumCulled=false;ctx.scene.add(lines);
 const particles=kind=>{const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ctx.wires.length*18*3),3));const points=new THREE.Points(geo,flowParticleMaterial(kind));points.frustumCulled=false;ctx.scene.add(points);return points;};network.flowBatches={lines,p:particles('p'),q:particles('q')};updateWireGeometry();
}
function updateWireGeometry(){
 if(!ctx.scene)return;ctx.scene.updateMatrixWorld(true);for(const w of ctx.wires){const a=get(w.edge.a),b=get(w.edge.b);let route;
  if(w.internal&&a.type==='line'){const group=ctx.assetGroups.get(a.assetId);route=a.leadPath.map(pt=>group.localToWorld(v((w.index-1)*profileFor(a).phaseSpacing*ctx.spreadAmount,pt[1],pt[2])));}
  else if(w.internal&&a.type==='busbar'&&!a.enclosure){const group=ctx.assetGroups.get(a.assetId),y=profileFor(a).busHeight,z=(w.index-1)*profileFor(a).busSpacing*ctx.spreadAmount;route=[group.localToWorld(v(-a.busWidth/2,y,z)),group.localToWorld(v(a.busWidth/2,y,z))];}
  else route=[terminalWorld(a,w.edge.pa,w.index,b),terminalWorld(b,w.edge.pb,w.index,a)];
  const lengths=route.slice(1).map((p,i)=>p.distanceTo(route[i])),total=lengths.reduce((a,b)=>a+b,0),cable=!w.internal&&(a.type==='cable'||b.type==='cable');w.points=[];
  for(let j=0;j<25;j++){let dist=total*j/24,seg=0;while(seg<lengths.length-1&&dist>lengths[seg]){dist-=lengths[seg];seg++;}const t=lengths[seg]>0?clamp(dist/lengths[seg],0,1):0,p=route[seg].clone().lerp(route[seg+1],t);if(cable){const floor=state.xray?-.75:.08;p.y=j<4?THREE.MathUtils.lerp(route[0].y,floor,j/4):j>20?THREE.MathUtils.lerp(floor,route.at(-1).y,(j-20)/4):floor;}else if(!w.internal||a.type==='line')p.y-=Math.sin(t*Math.PI)*Math.min(2.4,lengths[seg]*.045);w.points.push(p);}
 }updateLineBatch();if(state.terminals||state.connectivity)rebuildDebug();
}
function rebuildDebug(){
 if(!ctx.debugGroup)return;while(ctx.debugGroup.children.length){const c=ctx.debugGroup.children[0];ctx.debugGroup.remove(c);if(c.geometry&&!c.userData.shared)c.geometry.dispose();if(c.material)c.material.dispose();}
 if(state.terminals){const points=[];electrical.forEach(a=>{if(isAssetVisible(a))for(const p of ['in','out'])for(let i=0;i<3;i++)if(state.phase==='all'||PHASES[i]===state.phase)points.push(terminalWorld(a,p,i));});const geo=new THREE.BufferGeometry().setFromPoints(points);ctx.debugGroup.add(new THREE.Points(geo,new THREE.PointsMaterial({color:0xffd28b,size:1.2})));}
 if(state.connectivity){const pts=[];edges.forEach(e=>{if(isAssetVisible(get(e.a))&&isAssetVisible(get(e.b))){pts.push(terminalWorld(get(e.a),e.pa,1,get(e.b)),terminalWorld(get(e.b),e.pb,1,get(e.a)));}});ctx.debugGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0xa6cee8,dashSize:.5,gapSize:.4,transparent:true,opacity:.8})));ctx.debugGroup.children.filter(x=>x.isLine).forEach(x=>x.computeLineDistances());}
}
function flattenStaticGroups(){
 const keep=new Set([ctx.scene,ctx.structures,ctx.underground,ctx.groundGrid,ctx.trenches,ctx.zoneGroup,ctx.debugGroup,ctx.measureGroup,network.infrastructure,ctx.ground.userData.regions,...ctx.assetGroups.values(),...ctx.parts,...ctx.phaseGroups,...ctx.movingContacts.map(c=>c.mesh),...(network.fans||[]).map(f=>f.rotor)]);
 const flatten=g=>{for(const child of [...g.children]){if(!child.isGroup)continue;flatten(child);if(keep.has(child))continue;child.updateMatrix();for(const o of [...child.children]){o.applyMatrix4(child.matrix);g.add(o);}g.remove(child);}};flatten(ctx.scene);
}
function batchStaticMeshes(group){
 for(const child of [...group.children])if(child.isGroup)batchStaticMeshes(child);const buckets=new Map();for(const o of group.children){if(!o.isMesh||Array.isArray(o.material)||o.material.map)continue;const id=o.material.uuid;if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(o);}for(const meshes of buckets.values()){
  if(meshes.length<2)continue;const entries=[],im=new THREE.Matrix4();for(const o of meshes){o.updateMatrix();if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,im);entries.push({geo:o.geometry,matrix:o.matrix.clone().multiply(im)});}}else entries.push({geo:o.geometry,matrix:o.matrix.clone()});}
  const key='merged:'+entries.map(e=>e.geo.uuid+':'+e.matrix.elements.map(n=>Math.round(n*10000)/10000).join(',')).join('|');const geo=geometry(key,()=>{const ps=[],ns=[],uvs=[],idx=[];const pos=v(),norm=v(),nm=new THREE.Matrix3();for(const e of entries){const p=e.geo.attributes.position,n=e.geo.attributes.normal,uv=e.geo.attributes.uv,offset=ps.length/3;nm.getNormalMatrix(e.matrix);for(let i=0;i<p.count;i++){pos.fromBufferAttribute(p,i).applyMatrix4(e.matrix);norm.fromBufferAttribute(n,i).applyNormalMatrix(nm);ps.push(pos.x,pos.y,pos.z);ns.push(norm.x,norm.y,norm.z);uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);}if(e.geo.index)for(let i=0;i<e.geo.index.count;i++)idx.push(offset+e.geo.index.getX(i));else for(let i=0;i<p.count;i++)idx.push(offset+i);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(ns,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(idx);geo.computeBoundingSphere();return geo;});
  const merged=new THREE.Mesh(geo,meshes[0].material);merged.receiveShadow=true;let root=group;while(root&&!root.userData.assetId)root=root.parent;const a=get(root?.userData.assetId);merged.castShadow=!!a&&['transformer','reactor','capacitor'].includes(rootAsset(a).type);for(const o of meshes)group.remove(o);group.add(merged);
 }
}
function instancePhaseMeshes(){
 network.phaseBatches=[];const parents=new Map();for(const phase of ctx.phaseGroups){if(!parents.has(phase.parent))parents.set(phase.parent,[]);parents.get(phase.parent).push(phase);}
 for(const [parent,phases] of parents){const buckets=new Map();for(const phase of phases)for(const mesh of phase.children){if(!mesh.isMesh||mesh.isInstancedMesh||Array.isArray(mesh.material))continue;const key=mesh.geometry.uuid+':'+mesh.material.uuid;if(!buckets.has(key))buckets.set(key,[]);mesh.updateMatrix();buckets.get(key).push({phase,source:mesh,local:mesh.matrix.clone()});}
 for(const items of buckets.values()){if(items.length<2)continue;const first=items[0].source,batch=new THREE.InstancedMesh(first.geometry,first.material,items.length);batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;for(const item of items)item.phase.remove(item.source);parent.add(batch);network.phaseBatches.push({mesh:batch,items});}}
 updatePhaseBatches();
}
function updatePhaseBatches(){const matrix=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0);for(const batch of network.phaseBatches||[]){batch.items.forEach((item,i)=>{item.phase.updateMatrix();matrix.copy(item.phase.matrix).multiply(item.local);if(!item.phase.visible)matrix.multiply(zero);batch.mesh.setMatrixAt(i,matrix);});batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.computeBoundingSphere();}}
function flowParticleMaterial(kind){if(kind==='p')return new THREE.PointsMaterial({color:0xa9d5c4,size:3.2,sizeAttenuation:false,transparent:true,opacity:.85,depthWrite:false});const c=document.createElement('canvas');c.width=c.height=32;const ctx=c.getContext('2d');ctx.strokeStyle='#dec599';ctx.lineWidth=5;ctx.beginPath();ctx.arc(16,16,10,0,Math.PI*2);ctx.stroke();return new THREE.PointsMaterial({map:new THREE.CanvasTexture(c),color:0xe8c796,size:4.3,sizeAttenuation:false,transparent:true,opacity:.84,depthWrite:false,alphaTest:.1});}
function updateWireVisibility(){
 for(const w of ctx.wires){const a=get(w.edge.a),b=get(w.edge.b);if(w.internal){const f=assetFlows.get(a.assetId)||{p:0,q:0};w.edge.flowP=f.p;w.edge.flowQ=f.q;}w.energized=ctx.liveTerminals.has(node(a.assetId,w.edge.pa))&&ctx.liveTerminals.has(node(b.assetId,w.edge.pb))&&(!w.internal||!switchTypes.includes(a.type)||a.state==='CLOSED');const visible=isAssetVisible(a)&&isAssetVisible(b)&&(state.phase==='all'||state.phase===w.phase),path=!state.path||state.pathIds.has(a.assetId)&&state.pathIds.has(b.assetId);w.line.visible=visible&&(!w.internal||a.type==='transformer'&&(state.xray||state.exploded));const on=visible&&w.energized&&path&&state.powerFlow&&(state.mode==='analysis'||state.mode==='topology'||state.path);w.dots.visible=on&&state.flowP&&flowVisual(w.edge.flowP,'p').active;w.qDots.visible=on&&state.flowQ&&flowVisual(w.edge.flowQ,'q').active;}
 if(network.cableXray!==state.xray){network.cableXray=state.xray;updateWireGeometry();}else updateLineBatch();
}
function animateFlows(now){
 if(!network.flowBatches)return;for(const [key,kind,field] of [['flowP','p','dots'],['flowQ','q','qDots']]){const object=network.flowBatches[kind],arr=object.geometry.attributes.position.array;let count=0;for(const w of ctx.wires){if(!w[field].visible||!w.points.length)continue;const f=flowVisual(w.edge[key],kind);for(let i=0;i<f.count;i++){const t=((now*.001*f.speed*f.direction+i/f.count+(kind==='q'?.031:0))%1+1)%1,idx=t*24,j=Math.floor(idx),p=w.points[j],q=w.points[Math.min(j+1,24)],fraction=idx-j;arr[count*3]=p.x+(q.x-p.x)*fraction;arr[count*3+1]=p.y+(q.y-p.y)*fraction+(kind==='q'?.17:0);arr[count*3+2]=p.z+(q.z-p.z)*fraction;count++;}}object.geometry.setDrawRange(0,count);object.geometry.attributes.position.needsUpdate=true;object.visible=count>0;}
}
function updateLineBatch(){const batch=network.flowBatches?.lines;if(!batch)return;const pos=batch.geometry.attributes.position.array,colors=batch.geometry.attributes.color.array;let n=0;for(const w of ctx.wires){if(!w.line.visible)continue;const c=w.energized?[.49,.69,.63]:[.26,.33,.38],dim=state.path&&!state.pathIds.has(w.edge.a)?.25:1;for(let i=1;i<w.points.length;i++)for(const p of [w.points[i-1],w.points[i]]){pos[n*3]=p.x;pos[n*3+1]=p.y;pos[n*3+2]=p.z;colors[n*3]=c[0]*dim;colors[n*3+1]=c[1]*dim;colors[n*3+2]=c[2]*dim;n++;}}batch.geometry.setDrawRange(0,n);batch.geometry.attributes.position.needsUpdate=true;batch.geometry.attributes.color.needsUpdate=true;}

export { terminalWorld, buildWires, updateWireGeometry, rebuildDebug, flattenStaticGroups, batchStaticMeshes, instancePhaseMeshes, updatePhaseBatches, flowParticleMaterial, updateWireVisibility, animateFlows, updateLineBatch };
