// GridAtlas 3D v0.4 — src/scene/scene.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { state } from '../core/state.js';
import { $, toast, clamp } from '../core/utils.js';
import { electrical, assets, site, get, rootAsset, network } from '../data/station.js';
import { buildElectrical, buildStructure, siteInfrastructure } from './builders.js';
import { buildWires, flattenStaticGroups, batchStaticMeshes, instancePhaseMeshes } from './wires.js';
import { v } from './materials.js';

function buildScene(){
 ctx.canvas=$('#scene');const context=ctx.canvas.getContext('webgl2',{antialias:true,preserveDrawingBuffer:true})||ctx.canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});if(!context)throw new Error('WebGL kullanılamıyor. Tarayıcıda donanım hızlandırmayı açın ve sayfayı yeniden yükleyin. Ekipman ağacı, topoloji ve tek-hat şeması kullanılabilir.');
 ctx.renderer=new THREE.WebGLRenderer({canvas:ctx.canvas,context,antialias:true,preserveDrawingBuffer:true});ctx.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));ctx.renderer.outputColorSpace=THREE.SRGBColorSpace;ctx.renderer.toneMapping=THREE.ACESFilmicToneMapping;ctx.renderer.toneMappingExposure=1.06;ctx.renderer.shadowMap.enabled=true;ctx.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 ctx.scene=new THREE.Scene();ctx.scene.background=new THREE.Color(0x1b2833);ctx.scene.fog=new THREE.Fog(0x1b2833,1250,2700);ctx.camera=new THREE.PerspectiveCamera(39,1,.25,2800);
 ctx.scene.add(new THREE.HemisphereLight(0xd6e6ee,0x526271,1.8));const sun=new THREE.DirectionalLight(0xfff2d5,2.35);sun.position.set(-180,310,100);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-330;sun.shadow.camera.right=330;sun.shadow.camera.top=330;sun.shadow.camera.bottom=-330;sun.shadow.camera.far=1000;sun.target.position.set(site.center.x,0,site.center.z);ctx.scene.add(sun.target);sun.shadow.normalBias=.18;sun.shadow.bias=-.0003;sun.shadow.radius=3;ctx.scene.add(sun);
 ctx.structures=new THREE.Group();ctx.scene.add(ctx.structures);ctx.zoneGroup=new THREE.Group();ctx.scene.add(ctx.zoneGroup);ctx.debugGroup=new THREE.Group();ctx.scene.add(ctx.debugGroup);ctx.measureGroup=new THREE.Group();ctx.scene.add(ctx.measureGroup);
 siteInfrastructure();const infrastructure=new THREE.Group();for(const child of [...ctx.structures.children])infrastructure.add(child);ctx.structures.add(infrastructure);network.infrastructure=infrastructure;electrical.forEach(buildElectrical);assets.filter(a=>a.type==='structure').forEach(buildStructure);
 flattenStaticGroups();batchStaticMeshes(ctx.scene);instancePhaseMeshes();ctx.scene.traverse(o=>{if(o.isMesh){o.updateMatrix();o.matrixAutoUpdate=false;let root=o;while(root&&!root.userData.assetId)root=root.parent;const a=rootAsset(get(root?.userData.assetId));o.castShadow=!!a&&['transformer','reactor','capacitor'].includes(a.type)&&!o.isInstancedMesh;}});const uniquePicks=new Set();ctx.assetGroups.forEach(g=>g.traverse(o=>{if(o.isMesh&&!uniquePicks.has(o)){ctx.pickables.push(o);uniquePicks.add(o);}}));
 ctx.selectionBox=new THREE.Box3Helper(new THREE.Box3(),0x9ce5c9);ctx.hoverBox=new THREE.Box3Helper(new THREE.Box3(),0xd2dbba);ctx.selectionBox.visible=false;ctx.hoverBox.visible=false;ctx.scene.add(ctx.selectionBox,ctx.hoverBox);
 buildWires();initCamera();ctx.resizeObserver=new ResizeObserver(resize);ctx.resizeObserver.observe($('#viewport'));resize();
 ctx.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();toast('Grafik bağlamı duraklatıldı. Sayfayı yenileyerek sahneyi geri yükleyebilirsiniz.',true);});
}
function resize(){if(!ctx.renderer)return;const rect=$('#viewport').getBoundingClientRect();if(rect.width<1||rect.height<1)return;ctx.renderer.setSize(rect.width,rect.height,false);ctx.camera.aspect=rect.width/rect.height;ctx.camera.updateProjectionMatrix();}
// CAMERA — damped spherical orbit, right-drag pan and two-touch pinch.
const orbit={target:null,wantedTarget:null,radius:235,wantedRadius:235,theta:.7,wantedTheta:.7,phi:.86,wantedPhi:.86};
function initCamera(){orbit.target=v(site.center.x,3,site.center.z);orbit.wantedTarget=orbit.target.clone();cameraPreset('iso',true);}
function fitRadius(theta=.62,phi=.73){const r=$('#viewport').getBoundingClientRect(),aspect=Math.max(.5,r.width/r.height),tan=Math.tan(39*Math.PI/360),normal=v(Math.sin(phi)*Math.sin(theta),Math.cos(phi),Math.sin(phi)*Math.cos(theta)),right=v(Math.cos(theta),0,-Math.sin(theta)),up=v(-Math.cos(phi)*Math.sin(theta),Math.sin(phi),-Math.cos(phi)*Math.cos(theta));let distance=170;for(const x of [site.minX,site.maxX])for(const y of [0,48])for(const z of [site.minZ,site.maxZ]){const d=v(x-site.center.x,y-3,z-site.center.z);distance=Math.max(distance,d.dot(normal)+Math.max(Math.abs(d.dot(right))/(tan*aspect),Math.abs(d.dot(up))/tan));}return clamp(distance*1.06,210,site.maxRadius);}
function cameraPreset(kind,instant=false){
 if(!ctx.camera)return;orbit.wantedTarget.set(site.center.x,3,site.center.z);orbit.wantedRadius=fitRadius();
 const presets={iso:[.62,.73],perspective:[.37,1.05],top:[0,.025],front:[0,1.44],side:[Math.PI/2,1.36]};const p=presets[kind]||presets.iso;orbit.wantedTheta=p[0];orbit.wantedPhi=p[1];orbit.wantedRadius=fitRadius(p[0],p[1]);$('#camera-preset').value=kind;
 if(instant){orbit.target.copy(orbit.wantedTarget);orbit.radius=orbit.wantedRadius;orbit.theta=p[0];orbit.phi=p[1];updateCamera(1);}
}
function updateCamera(dt){if(!ctx.camera)return;const s=1-Math.exp(-dt*8);orbit.target.lerp(orbit.wantedTarget,s);orbit.radius=THREE.MathUtils.lerp(orbit.radius,orbit.wantedRadius,s);orbit.theta=THREE.MathUtils.lerp(orbit.theta,orbit.wantedTheta,s);orbit.phi=THREE.MathUtils.lerp(orbit.phi,orbit.wantedPhi,s);ctx.camera.position.set(orbit.radius*Math.sin(orbit.phi)*Math.sin(orbit.theta),orbit.radius*Math.cos(orbit.phi),orbit.radius*Math.sin(orbit.phi)*Math.cos(orbit.theta)).add(orbit.target);ctx.camera.position.y=Math.max(1.5,ctx.camera.position.y);ctx.camera.lookAt(orbit.target);$('#compass').style.transform=`rotate(${-orbit.theta*180/Math.PI}deg)`;}
function focusAsset(id=state.selected){const a=get(id),g=a&&ctx.assetGroups.get(a.assetId);if(!g||!ctx.camera)return;const bounds=new THREE.Box3().setFromObject(g);const center=bounds.getCenter(v()),size=bounds.getSize(v()).length();orbit.wantedTarget.copy(center);orbit.wantedRadius=clamp(size*2.05,14,site.maxRadius);orbit.wantedPhi=.94;}
function panCamera(dx,dy){if(!ctx.camera)return;const right=v().setFromMatrixColumn(ctx.camera.matrix,0),forward=v().setFromMatrixColumn(ctx.camera.matrix,2);forward.y=0;forward.normalize();const scale=orbit.radius*.0015;orbit.wantedTarget.addScaledVector(right,-dx*scale).addScaledVector(forward,-dy*scale);orbit.wantedTarget.x=clamp(orbit.wantedTarget.x,site.minX-15,site.maxX+15);orbit.wantedTarget.z=clamp(orbit.wantedTarget.z,site.minZ-15,site.maxZ+15);orbit.wantedTarget.y=clamp(orbit.wantedTarget.y,0,20);}

export { buildScene, resize, orbit, initCamera, fitRadius, cameraPreset, updateCamera, focusAsset, panCamera };
