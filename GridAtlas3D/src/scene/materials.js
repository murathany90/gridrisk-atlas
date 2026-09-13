// GridAtlas 3D v0.4 — src/scene/materials.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { state } from '../core/state.js';
import { PHASES } from '../core/utils.js';
import { profileFor, network } from '../data/station.js';

// MATERIALS / SCENE STATE


const colors={steel:0x87999f,steelDark:0x475e6c,porcelain:0xb9b6a4,porcelainLV:0xa7bec2,concrete:0x626c6c,tank:0x748d88,copper:0xaa9970,terminal:0xc4cdd0};
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
function geometry(key,factory){if(!ctx.geoCache.has(key))ctx.geoCache.set(key,factory());return ctx.geoCache.get(key);}
function material(color,opts={}){const m=new THREE.MeshStandardMaterial({color,roughness:.74,metalness:.3,...opts});m.userData.baseColor=m.color.clone();m.userData.baseOpacity=m.opacity;ctx.allMaterials.add(m);return m;}
function mesh(parent,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=state.shadows;m.receiveShadow=true;parent.add(m);return m;}
function box(g,w,h,d,x,y,z,m){const o=mesh(g,geometry('box',()=>new THREE.BoxGeometry(1,1,1)),m,x,y,z);o.scale.set(w,h,d);return o;}
function cyl(g,r,h,x,y,z,m,rTop=r){return mesh(g,geometry(`cyl:${r}:${h}:${rTop}`,()=>new THREE.CylinderGeometry(rTop,r,h,10)),m,x,y,z);}
function rod(g,from,to,r,mat){const a=Array.isArray(from)?v(...from):from,b=Array.isArray(to)?v(...to):to;const d=b.clone().sub(a);const o=mesh(g,geometry('rod',()=>new THREE.CylinderGeometry(1,1,1,6)),mat);o.position.copy(a).add(b).multiplyScalar(.5);o.scale.set(r,d.length(),r);o.quaternion.setFromUnitVectors(v(0,1,0),d.normalize());return o;}
function insulator(g,height,r,y,mat){cyl(g,r*.58,height,0,y+height/2,0,mat);const count=Math.round(height*4),geo=geometry(`rib:${r}`,()=>new THREE.CylinderGeometry(r*.88,r,.105,10));const rings=new THREE.InstancedMesh(geo,mat,count);const matrix=new THREE.Matrix4();for(let i=0;i<count;i++){matrix.makeTranslation(0,y+(i+.5)*height/count,0);rings.setMatrixAt(i,matrix);}rings.castShadow=false;g.add(rings);return rings;}
function base(g,w,d,mat){return box(g,w,.65,d,0,.15,0,mat);}
function phase(g,a,index){const p=new THREE.Group();const spacing=profileFor(a).phaseSpacing;p.position.x=(index-1)*spacing;p.userData.baseX=p.position.x;p.userData.phase=PHASES[index];p.userData.assetId=a.assetId;g.add(p);ctx.phaseGroups.push(p);return p;}
function nameplate(g,text,w,h,x,y,z,color='#bbd2cc'){
 const key='plate:'+text;let texture=network.textures?.get(key);if(!network.textures)network.textures=new Map();if(!texture){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#1b2b33';ctx.fillRect(0,0,512,128);ctx.strokeStyle='#809ba1';ctx.strokeRect(5,5,502,118);ctx.fillStyle=color;ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,79,478);texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;network.textures.set(key,texture);}const p=new THREE.Mesh(geometry('nameplate-plane',()=>new THREE.PlaneGeometry(1,1)),new THREE.MeshBasicMaterial({map:texture}));p.position.set(x,y,z);p.scale.set(w,h,1);g.add(p);return p;
}

export { colors, v, geometry, material, mesh, box, cyl, rod, insulator, base, phase, nameplate };
