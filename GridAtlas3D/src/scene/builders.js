// GridAtlas 3D v0.4 — src/scene/builders.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import * as THREE from 'three';
import { ctx } from '../core/context.js';
import { PHASES } from '../core/utils.js';
import { get, rootAsset, profileFor, site, network } from '../data/station.js';
import { geometry, material, mesh, box, cyl, rod, insulator, base, phase, nameplate, colors, v } from './materials.js';
import { owningAsset } from './visibility.js';

// 3D EQUIPMENT FACTORIES — metre-based parametric models with explicit terminals.
function buildElectrical(a){
 const g=new THREE.Group();g.name='physical/'+a.tag;g.userData.assetId=a.assetId;g.position.set(a.x,0,a.z);g.userData.base=g.position.clone();ctx.assetGroups.set(a.assetId,g);ctx.scene.add(g);const m={steel:material(colors.steel),dark:material(colors.steelDark),porcelain:material(a.voltageLevel===400?0xa9b5ae:0x9fbcc0),base:material(colors.concrete),terminal:material(colors.terminal),tank:material(a.subtype==='autotransformer'?0x607b77:0x6f8786)};g.userData.materials=Object.values(m);const profile=profileFor(a),hv=profile.nominal===400,h=profile.equipmentHeight,s=profile.equipmentScale;a.terminals={in:[],out:[]};
 if(a.enclosure)return buildCubicle(a,g,m);if(a.type==='transformer')return buildTransformer(a,g,m);if(['reactor','capacitor'].includes(a.type))return buildShunt(a,g,m);if(a.type==='cable')return buildCable(a,g,m);if(a.type==='line')return buildLine(a,g,m);
 if(a.type==='busbar'){
  const height=profile.busHeight,spacing=profile.busSpacing;for(let i=0;i<3;i++){const p=new THREE.Group();p.position.z=(i-1)*spacing;p.userData={phase:PHASES[i],busPhase:true,baseZ:p.position.z};g.add(p);ctx.phaseGroups.push(p);rod(p,[-a.busWidth/2,height,0],[a.busWidth/2,height,0],hv?.16:.12,m.terminal);const supports=Math.ceil(a.busWidth/(hv?32:24));for(let j=0;j<=supports;j++){const x=-a.busWidth/2+a.busWidth*j/supports,sup=new THREE.Group();sup.position.x=x;p.add(sup);base(sup,2.2,2.2,m.base);for(const dx of [-.45,.45])rod(sup,[dx,.6,0],[dx,height-2.25,0],.15,m.dark);for(let yy=1;yy<height-3;yy+=2)rod(sup,[-.45,yy,0],[.45,yy+1.7,0],.07,m.dark);insulator(sup,2,.3,height-2.15,m.porcelain);box(sup,.7,.2,.4,0,height,0,m.dark);for(const dx of [-.23,.23])rod(sup,[dx,height-.1,-.26],[dx,height+.2,.26],.035,m.terminal);}a.terminals.in.push(v(-a.busWidth/2,height,(i-1)*spacing));a.terminals.out.push(v(a.busWidth/2,height,(i-1)*spacing));}return;
 }
 for(let i=0;i<3;i++){const p=phase(g,a,i);base(p,2*s,2.7*s,m.base);let y=h;
  if(a.type==='circuitBreaker'){
   box(p,.35,1.7*s,.35,0,1.2*s,0,m.dark);insulator(p,h-2.2*s,.5*s,2.2*s,m.porcelain);for(const z of [-1.15*s,1.15*s]){const barrel=cyl(p,.54*s,1.7*s,0,h+.5*s,z,m.porcelain);barrel.rotation.x=Math.PI/2;const flange=cyl(p,.62*s,.16*s,0,h+.5*s,z+(z<0?-.8:.8)*s,m.steel);flange.rotation.x=Math.PI/2;}
   y=h+.5*s;rod(p,[0,y,-2.7*s],[0,y,-1.9*s],.14*s,m.terminal);rod(p,[0,y,1.9*s],[0,y,2.7*s],.14*s,m.terminal);const contact=new THREE.Group();contact.position.set(0,y,0);p.add(contact);rod(contact,[0,0,-.42*s],[0,0,.42*s],.16*s,m.terminal);box(contact,.6*s,.25*s,.23*s,0,-.7*s,0,m.steel);ctx.movingContacts.push({assetId:a.assetId,mesh:contact,kind:'cb',baseY:y,stroke:.9*s,progress:a.state==='OPEN'?1:0});box(p,.9*s,.75*s,.75*s,.65*s,h-.5*s,0,m.dark);a.terminals.in.push(v(p.position.x,y,-2.7*s));a.terminals.out.push(v(p.position.x,y,2.7*s));
  }else if(a.type==='disconnector'){
   const sh=profile.dsHeight;y=sh;box(p,1.6*s,.2,3.8*s,0,1.65*s,0,m.steel);for(const z of [-1.4*s,1.4*s]){const sup=new THREE.Group();sup.position.z=z;p.add(sup);box(sup,.27,1.4*s,.27,0,.9*s,0,m.dark);insulator(sup,sh-1.8*s,.37*s,1.8*s,m.porcelain);box(sup,.6*s,.18,.4*s,0,sh,0,m.terminal);}const blade=new THREE.Group();blade.position.set(0,sh,-1.4*s);p.add(blade);for(const x of [-.1*s,.1*s])rod(blade,[x,0,0],[x,0,2.8*s],.065*s,m.terminal);box(blade,.4*s,.17,.4*s,0,0,2.8*s,m.steel);ctx.movingContacts.push({assetId:a.assetId,mesh:blade,kind:'ds',progress:a.state==='OPEN'?1:0});rod(p,[0,.8,-1.4*s],[0,.8,1.4*s],.085,m.dark);a.terminals.in.push(v(p.position.x,sh,-1.4*s));a.terminals.out.push(v(p.position.x,sh,1.4*s));
  }else if(a.type==='earthSwitch'){
   const sh=profile.dsHeight;y=sh;const sup=new THREE.Group();sup.position.z=-.8;p.add(sup);insulator(sup,sh-.85,.32*s,.85,m.porcelain);box(sup,.7,.2,.45,0,sh,0,m.terminal);const blade=new THREE.Group();blade.position.set(0,.65,.8);p.add(blade);const length=Math.hypot(sh-.65,1.6);rod(blade,[0,0,0],[0,0,length],.105,m.terminal);box(blade,.3,.15,.4,0,0,length,m.steel);ctx.movingContacts.push({assetId:a.assetId,mesh:blade,kind:'es',closedAngle:-Math.atan2(sh-.65,-1.6),progress:a.state==='OPEN'?1:0});rod(p,[0,.65,.8],[1,-.8,.8],.07,m.terminal);box(p,1.2,.08,1.1,0,.45,.8,m.dark);a.terminals.in.push(v(p.position.x,sh,-.8));a.terminals.out.push(v(p.position.x,.25,.8));
  }else if(a.type==='lineTrap'){
   box(p,.32,h-2,.32,0,(h-2)/2,0,m.dark);insulator(p,1.8,.4,h-2,m.porcelain);const pts=[];for(let k=0;k<=96;k++){const t=k/96;pts.push(v(Math.cos(t*Math.PI*16)*.85,h+t*2.4,Math.sin(t*Math.PI*16)*.85));}mesh(p,geometry('trap-helix:'+h,()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),96,.068,4,false)),m.steel);for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])rod(p,[Math.cos(angle)*.7,h,Math.sin(angle)*.7],[Math.cos(angle)*.7,h+2.4,Math.sin(angle)*.7],.055,m.dark);for(const yy of [h,h+2.4]){const ring=mesh(p,geometry('trap-end',()=>new THREE.TorusGeometry(.9,.09,4,16)),m.dark,0,yy,0);ring.rotation.x=Math.PI/2;}y=h+2.55;rod(p,[0,y,-.8],[0,y,.8],.12,m.terminal);
  }else if(a.type==='voltageTransformer'){
   box(p,1.6*s,1.55*s,1.5*s,0,1.05*s,0,m.dark);box(p,1.3*s,.16,1.25*s,0,1.88*s,0,m.steel);insulator(p,h-1.9*s,.47*s,1.9*s,m.porcelain);if(hv)cyl(p,.5,.2,0,h*.63,0,m.steel);cyl(p,.4*s,.24,0,h,0,m.terminal);y=h+.2;rod(p,[0,y,-.7],[0,y,.7],.09,m.terminal);box(p,.7,.5,.3,0,1.05,1*s,m.steel);
  }else if(a.type==='currentTransformer'){
   box(p,.38,1.7*s,.38,0,1.3*s,0,m.dark);insulator(p,h-2*s,.47*s,2*s,m.porcelain);const head=cyl(p,.7*s,1.12*s,0,h,0,m.steel);head.rotation.x=Math.PI/2;mesh(p,geometry('ct-ring:'+s,()=>new THREE.TorusGeometry(.49*s,.18*s,6,16)),m.dark,0,h,.57*s);y=h+.55*s;rod(p,[0,y,-1.1*s],[0,y,1.1*s],.12,m.terminal);rod(p,[.25,2,0],[.7,.8,0],.07,m.dark);
  }else{
   box(p,.28,1.35*s,.28,0,1.03*s,0,m.dark);insulator(p,h-1.8*s,.29*s,1.8*s,m.porcelain);cyl(p,.24,.2,0,h,0,m.terminal);y=h+.1;rod(p,[0,y,-.65],[0,y,.65],.09,m.terminal);rod(p,[.15,1.8*s,0],[.9,-.8,.5],.045,m.terminal);box(p,.36,.3,.2,.9,.55,.5,m.dark);
  }
  if(!a.terminals.in[i]){a.terminals.in.push(v(p.position.x,y,-.65));a.terminals.out.push(v(p.position.x,y,.65));}
  if(hv&&['arrester','voltageTransformer','circuitBreaker'].includes(a.type)){const ring=mesh(p,geometry('equipment-ring',()=>new THREE.TorusGeometry(.69,.045,4,16)),m.terminal,0,y-.25,0);ring.rotation.x=Math.PI/2;}
 }
 if(['circuitBreaker','disconnector','earthSwitch'].includes(a.type)){rod(g,[-profile.phaseSpacing,1.05,2.9],[profile.phaseSpacing,1.05,2.9],.075,m.dark);box(g,1.8*s,2*s,1*s,profile.phaseSpacing+1.8*s,1.55*s,2.6,m.dark);box(g,1.6*s,1.75*s,.05,profile.phaseSpacing+1.8*s,1.55*s,3.13,m.steel);nameplate(g,a.tag,1.5*s,.38*s,profile.phaseSpacing+1.8*s,1.9*s,3.18);}else nameplate(g,a.tag,1.45,.35,0,1.1,1.2);
}
function buildTransformer(a,g,m){if(a.subtype==='autotransformer')buildAutotransformer(a,g,m);else if(a.subtype==='powerTransformer')buildPowerTransformer(a,g,m);else throw Error('Bilinmeyen trafo ailesi: '+a.tag);}
// SUBSTATION BUILDER
function buildStructure(a){
 const g=new THREE.Group();g.name='physical/'+a.tag;g.userData.assetId=a.assetId;g.position.set(a.x,0,a.z);g.userData.base=g.position.clone();ctx.structures.add(g);ctx.assetGroups.set(a.assetId,g);const m={steel:material(0x83969d),dark:material(0x405863),base:material(0x687371),porcelain:material(0xadc3bd)};g.userData.materials=Object.values(m);
 if(a.kind==='switchgearBuilding'){buildSwitchgearBuilding(a,g,m);return;}if(a.kind==='controlBuilding'){buildControlBuilding(a,g,m);return;}
 if(a.kind==='terminalTower'){
  const p=profileFor(a),hv=a.voltageLevel===400,h=hv?36:28,w=p.phaseSpacing*3.4;latticeColumn(g,0,0,h,7.2*(hv?1:.75),1.7,m.steel);for(const dx of [-1,1])for(const dz of [-1,1])box(g,2,.8,2,dx*(hv?3.6:2.7),.3,dz*(hv?3.6:2.7),m.base);latticeBeam(g,w,h-4,0,m.steel);latticeColumn(g,0,0,h+5,1.8,.2,m.dark);
  for(let i=0;i<3;i++){const ph=phase(g,a,i),s=new THREE.Group();s.position.set(0,h-4,a.lineDirection*1);s.rotation.x=a.lineDirection*Math.PI/2;ph.add(s);insulator(s,hv?3.4:2.3,.27,0,m.porcelain);rod(ph,[0,h-4,0],[0,h-4,a.lineDirection*(hv?4.4:3.3)],.1,m.dark);}
  nameplate(g,a.tag,5.2,.95,0,8,2.5);
 }else if(a.kind==='portal'){
  const p=profileFor(a),h=p.lineHeight+3.4,w=p.phaseSpacing*3.6;for(const x of [-w/2,w/2]){base(g,2.2,2.6,m.base).position.x=x;latticeColumn(g,x,0,h,1.25,1.25,m.steel);}latticeBeam(g,w,h,0,m.steel);
  for(let i=0;i<3;i++){const ph=phase(g,a,i);insulator(ph,3.3,.27,p.lineHeight,m.porcelain);rod(ph,[0,p.lineHeight,-.7],[0,p.lineHeight,.7],.12,m.steel);}nameplate(g,a.tag,5.6,.8,0,h+.8,.64);
 }else {base(g,2.5,2.5,m.base);cyl(g,.5,30,0,15,0,m.steel,.16);rod(g,[0,30,0],[0,35,0],.065,m.dark);for(let i=0;i<3;i++)rod(g,[0,31,0],[Math.cos(i*2.1)*.8,33,Math.sin(i*2.1)*.8],.055,m.steel);}
}
function siteInfrastructure(){
 const width=site.maxX-site.minX,depth=site.maxZ-site.minZ,cx=site.center.x,cz=site.center.z;ctx.ground=box(ctx.scene,width,.6,depth,cx,-.65,cz,material(0x414f58,{roughness:1,metalness:0}));const regions=new THREE.Group();ctx.scene.add(regions);ctx.ground.userData.regions=regions;for(const r of [{x:-8,z:-64,w:360,d:205,c:0x5a5d55},{x:-8,z:125,w:360,d:116,c:0x475f70},{x:112,z:209,w:148,d:66,c:0x55576b}])box(regions,r.w,.02,r.d,r.x,-.337,r.z,material(r.c,{roughness:1,metalness:0}));
 const road=material(0x2b3e49),curb=material(0x7f8e92),mark=material(0x9baba6);for(const [x,z,w,d] of [[43,25,7,397],[-10,-32,365,7],[-10,99,365,5],[112,188,146,6],[-177,5,5,340]]){box(ctx.structures,w,.12,d,x,-.22,z,road);if(w>d){for(const side of [-1,1])box(ctx.structures,w,.18,.2,x,-.13,z+side*(d/2+.15),curb);for(let xx=x-w/2+5;xx<x+w/2;xx+=12)box(ctx.structures,4,.02,.13,xx,-.14,z,mark);}else for(let zz=z-d/2+6;zz<z+d/2;zz+=12)box(ctx.structures,.13,.02,4,x,-.14,zz,mark);}
 const fence=material(0x748b91),vertices=[[-188,-166],[185,-166],[185,241],[42,241],[42,184],[-188,184],[-188,-166]],posts=[],segments=[];for(let i=1;i<vertices.length;i++){const a=v(vertices[i-1][0],0,vertices[i-1][1]),b=v(vertices[i][0],0,vertices[i][1]),n=Math.ceil(a.distanceTo(b)/5);for(let j=0;j<=n;j++)posts.push(a.clone().lerp(b,j/n));for(const y of [.6,1.5,2.4])segments.push(v(a.x,y,a.z),v(b.x,y,b.z));}
 const batch=new THREE.InstancedMesh(geometry('site-fence-post',()=>new THREE.BoxGeometry(.14,2.7,.14)),fence,posts.length),matrix=new THREE.Matrix4();posts.forEach((p,i)=>{matrix.makeTranslation(p.x,1.1,p.z);batch.setMatrixAt(i,matrix);});ctx.structures.add(batch);ctx.structures.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments),new THREE.LineBasicMaterial({color:0x7b959b,transparent:true,opacity:.55})));
 ctx.underground=new THREE.Group();ctx.scene.add(ctx.underground);ctx.groundGrid=new THREE.Group();ctx.trenches=new THREE.Group();ctx.underground.add(ctx.groundGrid,ctx.trenches);const copper=material(0xad8f63),cover=material(0x526974,{transparent:true,opacity:.7});for(let x=-184;x<185;x+=18)rod(ctx.groundGrid,[x,-1.4,-164],[x,-1.4,238],.065,copper);for(let z=-160;z<239;z+=18)rod(ctx.groundGrid,[-184,-1.4,z],[184,-1.4,z],.065,copper);
 for(const x of [-148,-80,-12,64,108,152]){box(ctx.trenches,1.3,.65,362,x,-.9,17,cover);for(let j=0;j<3;j++)rod(ctx.trenches,[x-.3+j*.3,-.65,-164],[x-.3+j*.3,-.65,198],.07,copper);for(let z=-158;z<185;z+=8)box(ctx.structures,1.45,.06,2,x,-.29,z,curb);}box(ctx.trenches,126,.65,2,112,-.9,197,cover);box(ctx.trenches,75,.65,2,132,-.9,209,cover);
}
function buildShunt(a,g,m){
 const profile=profileFor(a);base(g,a.type==='reactor'?18:18,a.type==='reactor'?12:13,m.base);
 if(a.type==='reactor'){
  box(g,10,6.6,6,0,4,0,m.tank);box(g,10.6,.3,6.5,0,7.5,0,m.steel);
  PHASES.forEach((ph,i)=>{const p=phase(g,a,i);insulator(p,profile.insulatorHeight,.43,7.6,m.porcelain);cyl(p,.2,.3,0,12.15,0,m.terminal);a.terminals.in.push(v(p.position.x,12.3,0));a.terminals.out.push(v(p.position.x,12.3,0));});
  for(const side of [-1,1])for(let j=0;j<16;j++)box(g,.12,5,2,side*5.8,3.7,-3+j*.4,m.steel);
  const vessel=cyl(g,.75,6,0,8.7,-2.5,m.tank);vessel.rotation.z=Math.PI/2;rod(g,[-2,7.4,-1],[-2,8.7,-2.5],.15,m.dark);rod(g,[2,7.4,-1],[2,8.7,-2.5],.15,m.dark);
  box(g,1.5,1.8,1,6.8,1.5,3,m.dark);box(g,1.2,1.4,.05,6.8,1.5,3.53,m.steel);
 }else{
  PHASES.forEach((ph,i)=>{const p=phase(g,a,i);p.position.x=(i-1)*5.2;p.userData.baseX=p.position.x;const ins=new THREE.Group();p.add(ins);insulator(ins,1.1,.27,.6,m.porcelain);
   for(const x of [-1.5,1.5])box(p,.2,5.4,.2,x,3.5,0,m.dark);for(let level=0;level<3;level++){box(p,3.5,.16,4,0,1.8+level*1.65,0,m.steel);for(let j=0;j<4;j++){box(p,1.1,1.25,.72,(j%2?1:-1)*.7,2.5+level*1.65,(j<2?-1:1)*1.1,m.terminal);rod(p,[(j%2?1:-1)*.7,3.15+level*1.65,(j<2?-1:1)*1.1],[0,3.35+level*1.65,0],.04,m.steel);}}
   rod(p,[0,3,0],[0,7.4,0],.09,m.terminal);a.terminals.in.push(v(p.position.x,7.4,0));a.terminals.out.push(v(p.position.x,7.4,0));rod(p,[-1.5,1.5,0],[-1.5,-.6,0],.07,material(colors.copper));
  });
 }
 if(a.type==='reactor'){nameplate(g,a.tag+' / ŞÖNT REAKTÖR',4.2,.75,0,4.4,3.06);for(const x of [-3.7,3.7]){rod(g,[x,1,3.2],[x,7.4,3.2],.1,m.dark);for(let y=1;y<7;y+=.65)rod(g,[x-.35,y,3.3],[x+.35,y,3.3],.04,m.steel);}for(const x of [-4,0,4])cyl(g,.38,.12,x,7.76,1.5,m.dark);rod(g,[-5,.9,2.8],[-7,-1.1,4],.07,m.terminal);}
 else{for(const p of g.children.filter(o=>o.userData.phase)){for(const z of [-1.9,1.9])for(let y=1.8;y<5.2;y+=1.65){rod(p,[-1.5,y,z],[1.5,y+1.65,z],.055,m.dark);rod(p,[1.5,y,z],[-1.5,y+1.65,z],.055,m.dark);}for(let y=3.1;y<7;y+=1.65)for(const x of [-.7,.7]){cyl(p,.07,.35,x,y,-1.1,m.porcelain);rod(p,[x,y+.18,-1.1],[0,y+.3,0],.035,m.terminal);}}nameplate(g,a.tag+' / KAPASİTÖR BANKI',5,.7,0,2.6,7.03);}
 const fence=material(0x779197);for(const x of [-10,10])for(const z of [-7,0,7])box(g,.12,2,.12,x,1,z,fence);for(const y of [.6,1.3,2]){rod(g,[-10,y,-7],[10,y,-7],.035,fence);rod(g,[-10,y,7],[10,y,7],.035,fence);rod(g,[-10,y,-7],[-10,y,7],.035,fence);rod(g,[10,y,-7],[10,y,7],.035,fence);}
}
function buildCable(a,g,m){
 PHASES.forEach((ph,i)=>{const p=phase(g,a,i);rod(p,[0,1.1,-2],[0,.25,0],.13,m.dark);rod(p,[0,.25,0],[0,1.1,2],.13,m.dark);cyl(p,.21,.35,0,1.1,-2,m.terminal);cyl(p,.21,.35,0,1.1,2,m.terminal);a.terminals.in.push(v(p.position.x,1.1,-2));a.terminals.out.push(v(p.position.x,1.1,2));});
}
function buildCubicle(a,g,m){
 const shell=material(0x7995a0),door=material(0x506d7d);shell.userData.shell=true;door.userData.shell=true;g.userData.materials.push(shell,door);base(g,3.7,4,m.base);box(g,3.35,.14,3.3,0,3.85,0,shell);for(const x of [-1.65,1.65])box(g,.1,3.5,3.3,x,2,0,shell);box(g,3.3,3.5,.1,0,2,-1.6,shell);
 const role=a.cubicleRole,doorCuts=role==='meter'?[[1.25,1.65],[2.65,.9],[3.5,.48]]:role==='bus'?[[1.2,1.6],[2.9,1.5]]:[[.88,.9],[2,1.2],[3.3,.95]];for(const [y,h] of doorCuts){box(g,3.2,h,.09,0,y,1.68,door);box(g,3.25,.065,3.2,0,y-h/2,0,shell);box(g,.12,.27,.07,1.2,y,1.75,m.terminal);}for(const x of [-1.52,1.52])box(g,.12,3.5,.13,x,2,1.8,m.steel);
 const accent=material(role==='incomer'?0x7da595:role==='outgoing'?0x829cb6:role==='coupler'?0xb8a580:0xada5be);g.userData.materials.push(accent);box(g,3.1,.12,.05,0,3.72,1.78,accent);nameplate(g,a.tag,2.8,.38,0,3.39,1.79);box(g,.82,.58,.07,-.73,2.87,1.81,m.dark);for(let i=0;i<(role==='meter'?3:2);i++)cyl(g,.07,.055,.5+i*.25,2.9,1.85,accent).rotation.x=Math.PI/2;
 if(role!=='bus'){box(g,.05,.66,.05,.3,2,1.8,accent);box(g,.36,.26,.05,.3,2.03,1.82,m.terminal);}if(role==='coupler')box(g,2.1,.05,.05,0,2.4,1.81,accent);if(role==='meter')for(let i=0;i<3;i++)box(g,.48,.32,.04,-.75+i*.75,1.9,1.81,m.dark);for(let i=0;i<4;i++)box(g,1.1,.035,.04,-.5,.57+i*.1,1.8,m.dark);
 const copper=material(0xbd956c);g.userData.materials.push(copper);PHASES.forEach((ph,i)=>{const z=(i-1)*profileFor(a).busSpacing,p=new THREE.Group();p.userData={phase:ph,busPhase:true,baseZ:z};p.position.z=z;g.add(p);ctx.phaseGroups.push(p);const incoming=role==='incomer',outgoing=role==='outgoing',inlet=incoming?v(0,.65,-1.9+z):v(-1.65,3.05,z),outlet=outgoing?v(0,.65,1.9+z):v(1.65,3.05,z);a.terminals.in.push(inlet);a.terminals.out.push(outlet);
  if(a.type==='circuitBreaker'){rod(p,incoming?[0,.65,-1.9]:[-1.65,3.05,0],[-.42,2.35,0],.09,copper);rod(p,[.42,2.35,0],outgoing?[0,.65,1.9]:[1.65,3.05,0],.09,copper);cyl(p,.21,.8,0,1.7,0,m.porcelain);const contact=new THREE.Group();contact.position.set(-.42,2.35,0);p.add(contact);rod(contact,[0,0,0],[.84,0,0],.11,m.terminal);ctx.movingContacts.push({assetId:a.assetId,mesh:contact,kind:'cubicle',progress:a.state==='OPEN'?1:0,baseY:2.35});box(p,.64,.35,.7,0,1.07,0,m.dark);
  }else{rod(p,[-1.65,3.05,0],[1.65,3.05,0],.1,copper);if(role==='meter'){cyl(p,.3,1,0,1.8,0,m.porcelain);box(p,.7,.6,.65,0,1.05,0,m.dark);rod(p,[0,3.05,0],[0,2.3,0],.075,copper);}}
 });
}
function buildSwitchgearBuilding(a,g,m){buildingShell(a,g,m,78,25,6.3);for(let x=-36;x<38;x+=8){for(let y=0;y<3;y++)box(g,3,.12,.2,x,3.1+y*.33,12.7,m.dark);box(g,3.2,4.8,.13,x,2.4,12.6,m.steel);}nameplate(g,'33 kV OG KAPALI ŞALT · A / B / C',43,1.8,0,5.15,12.9);for(let x=-35;x<38;x+=5)box(g,.08,.06,24,x,.53,0,m.dark);for(const z of [-8,8])box(g,77,.05,.1,0,.54,z,m.steel);}
function enhanceOutdoor(a,g,m){
 if(a.enclosure||['busbar','line','cable','transformer','reactor','capacitor'].includes(a.type))return;
 const profile=profileFor(a),h=profile.equipmentHeight,s=profile.equipmentScale,copper=material(colors.copper);g.userData.materials.push(copper);
 PHASES.forEach((ph,i)=>{const p=ctx.phaseGroups.find(p=>p.parent===g&&p.userData.phase===ph);if(!p)return;
  if(['arrester','voltageTransformer','currentTransformer','circuitBreaker'].includes(a.type)&&profile.nominal===400){const ring=mesh(p,geometry('outdoor-corona',()=>new THREE.TorusGeometry(.66,.045,5,16)),m.terminal,0,h-.3,0);ring.rotation.x=Math.PI/2;}
  if(a.type==='arrester'){rod(p,[.18,2*s,0],[.65,-.7,0],.045,copper);box(p,.2,.18,.2,.65,.6,0,m.dark);}
  if(a.type==='currentTransformer'){const tor=mesh(p,geometry('ct-toroid',()=>new THREE.TorusGeometry(.55,.18,6,12)),m.steel,0,h,0);tor.rotation.y=Math.PI/2;}
  if(a.type==='earthSwitch'){rod(p,[.4,.5,1],[.4,profile.dsHeight,1],.075,copper);box(p,1,.07,.7,.4,.5,1,copper);}
  if(a.type==='disconnector'){rod(p,[0,1.4,-1.2*s],[0,1.4,1.2*s],.065,m.dark);}
 });
 if(['circuitBreaker','disconnector'].includes(a.type)){rod(g,[-profile.phaseSpacing,1.1,2],[profile.phaseSpacing,1.1,2],.08,m.dark);box(g,1.3,1.8,.8,profile.phaseSpacing+1.8,1.4,2,m.dark);}
}
function makePart(a,g,key,offset){const p=new THREE.Group();p.name=a.tag+'/'+key;p.userData={assetId:a.parts[key],parentAssetId:a.assetId,part:key,explode:v(...offset),base:v(),amount:0};g.add(p);ctx.parts.push(p);ctx.assetGroups.set(a.parts[key],p);return p;}
function fanAssembly(g,x,y,z,r,m){const assembly=new THREE.Group();assembly.position.set(x,y,z);assembly.rotation.y=Math.PI/2;g.add(assembly);mesh(assembly,geometry('fan-housing:'+r,()=>new THREE.TorusGeometry(r,.09,5,16)),m.dark);const rotor=new THREE.Group();assembly.add(rotor);cyl(rotor,r*.18,.16,0,0,0,m.steel).rotation.x=Math.PI/2;for(let i=0;i<4;i++){const b=box(rotor,r*1.45,r*.16,.09,0,0,0,m.steel);b.rotation.z=i*Math.PI/4;}network.fans??=[];network.fans.push({rotor,owner:owningAsset(g)});}
function transformerTank(p,w,h,d,m){
 box(p,w,h,d,0,h/2+.9,0,m.tank);box(p,w+.55,.28,d+.4,0,h+1.02,0,m.steel);box(p,w+.6,.32,d+.6,0,.65,0,m.dark);for(let x=-w/2+.5;x<w/2;x+=1.1)box(p,.12,h-.2,d+.12,x,h/2+.9,0,m.dark);
 for(const x of [-w*.28,w*.28]){cyl(p,.72,.12,x,h+1.2,0,m.dark);for(const z of [-d*.36,d*.36]){const ring=mesh(p,geometry('lifting-eye',()=>new THREE.TorusGeometry(.23,.065,4,10)),m.dark,x,h+1.38,z);ring.rotation.y=Math.PI/2;}}
 const active=material(0xb08a64);for(let i=-1;i<=1;i++){const winding=cyl(p,w*.087,h*.68,i*w*.26,h*.51+.85,0,active);winding.userData.internal=true;}p.userData.materials=[active];
 for(const x of [-w*.36,w*.36])for(const z of [-d*.35,d*.35]){box(p,1.7,.5,1.4,x,.55,z,m.dark);cyl(p,.42,.4,x,.38,z,m.steel).rotation.z=Math.PI/2;}
}
function bushingBank(a,g,m,partKey,port,level,spacing,z,deck,length,offset){
 const p=makePart(a,g,partKey,offset);for(let i=0;i<3;i++){const ph=new THREE.Group();ph.position.set((i-1)*spacing,0,z);ph.userData={phase:PHASES[i],baseX:ph.position.x};p.add(ph);ctx.phaseGroups.push(ph);cyl(ph,.46,.45,0,deck+.18,0,m.steel);insulator(ph,length,level===400?.53:.34,deck+.4,m.porcelain);cyl(ph,.17,.25,0,deck+.5+length,0,m.terminal);rod(ph,[0,deck+.58+length,-.45],[0,deck+.58+length,.45],.115,m.terminal);a.terminals[port].push(v(ph.position.x,deck+.58+length,z));if(level===400)for(const yy of [deck+length-.1,deck+.55]){const ring=mesh(ph,geometry('atr-grading',()=>new THREE.TorusGeometry(.85,.06,5,18)),m.terminal,0,yy,0);ring.rotation.x=Math.PI/2;}}
 return p;
}
function radiatorBank(g,w,h,d,m,count,reach){for(const side of [-1,1]){for(let j=0;j<count;j++){const z=-d*.44+j*d*.88/(count-1);box(g,reach,h*.76,.12,side*(w/2+reach/2+.45),h*.45+.8,z,m.steel);for(const y of [1.2,h*.8])rod(g,[side*w/2,y,z],[side*(w/2+reach),y,z],.08,m.dark);}for(const y of [1.2,h*.8])rod(g,[side*(w/2+reach*.6),y,-d*.5],[side*(w/2+reach*.6),y,d*.5],.15,m.dark);}}
function buildAutotransformer(a,g,m){
 const [w,h,d]=a.tankSize,deck=h+1.1;base(g,w+10,d+9,m.base);const tank=makePart(a,g,'TANK',[0,0,0]);transformerTank(tank,w,h,d,m);for(const z of [-d*.63,d*.63])box(tank,w+6,.25,.32,0,.55,z,m.dark);
 bushingBank(a,g,m,'HV','in',400,4.7,-d*.32,deck,5.7,[-1,4.8,-5.5]);bushingBank(a,g,m,'LV','out',154,3.1,d*.32,deck,2.85,[1,3.6,5.3]);
 const radiators=makePart(a,g,'RAD',[-5,0,0]);radiatorBank(radiators,w,h,d,m,20,2.3);const fan=makePart(a,g,'FAN',[5,0,0]);for(const side of [-1,1])for(let j=0;j<4;j++)fanAssembly(fan,side*(w/2+3),3,-d*.35+j*d*.235,.85,m);
 const cons=makePart(a,g,'CONS',[0,5.8,0]);const main=cyl(cons,1.22,11.5,0,deck+1.9,0,m.tank);main.rotation.z=Math.PI/2;for(const x of [-4,4]){rod(cons,[x,deck,0],[x,deck+1.9,0],.13,m.dark);const band=mesh(cons,geometry('atr-vessel-band',()=>new THREE.TorusGeometry(1.25,.06,4,16)),m.dark,x,deck+1.9,0);band.rotation.y=Math.PI/2;}
 rod(cons,[5,deck+1.9,0],[5,4.4,1.3],.13,m.dark);cyl(cons,.24,.8,5,4,1.3,m.porcelain);cyl(cons,.45,.14,-5.85,deck+1.9,0,m.terminal).rotation.z=Math.PI/2;
 const oltc=makePart(a,g,'OLTC',[2.4,0,5]);cyl(oltc,1.05,5.4,w*.34,3.6,d/2+1,m.tank);cyl(oltc,1.12,.2,w*.34,6.4,d/2+1,m.steel);rod(oltc,[w*.34,6.4,d/2+1],[w*.34,deck,0],.18,m.dark);
 const ctrl=makePart(a,g,'CTRL',[-2.5,0,5.5]);box(ctrl,2.3,2.5,1,-w*.34,2.1,d/2+1,m.dark);box(ctrl,2.1,2.25,.06,-w*.34,2.1,d/2+1.55,m.steel);nameplate(ctrl,a.tag+' · OTOTRAFO',2,.5,-w*.34,2.6,d/2+1.6);for(let i=0;i<5;i++)box(ctrl,.24,.12,.08,-w*.34-.7+i*.35,1.8,d/2+1.62,m.terminal);
 // Neutral bushing and grounded neutral lead distinguish the autotransformer family.
 const neutral=new THREE.Group();neutral.position.set(-w*.38,0,d*.37);tank.add(neutral);insulator(neutral,1.8,.26,deck,m.porcelain);rod(neutral,[0,deck+1.9,0],[-1.5,.35,1.3],.07,m.terminal);
}
function buildPowerTransformer(a,g,m){
 const [w,h,d]=a.tankSize,deck=h+1.1;base(g,w+7,d+7,m.base);const tank=makePart(a,g,'TANK',[0,0,0]);transformerTank(tank,w,h,d,m);bushingBank(a,g,m,'HV','in',154,2.65,-d*.24,deck,2.5,[-.6,3.5,-3.5]);
 const lv=makePart(a,g,'LV',[1.2,1,3.4]);box(lv,w*.8,2.5,1.75,0,2.2,d/2+.9,m.dark);box(lv,w*.84,.15,1.85,0,3.55,d/2+.9,m.steel);for(let i=0;i<3;i++){const p=new THREE.Group();p.position.x=(i-1)*.65;p.userData={phase:PHASES[i],baseX:p.position.x};lv.add(p);ctx.phaseGroups.push(p);const ins=new THREE.Group();ins.position.z=d/2+.8;p.add(ins);insulator(ins,.68,.19,3.6,m.porcelain);rod(p,[0,4.3,d/2+.8],[0,3.9,d/2+1.7],.16,m.terminal);rod(p,[0,3.9,d/2+1.7],[0,.9,d/2+2.2],.13,m.dark);a.terminals.out.push(v(p.position.x,.9,d/2+2.2));}
 const rad=makePart(a,g,'RAD',[-3.5,0,0]);radiatorBank(rad,w,h,d,m,12,1.6);const fan=makePart(a,g,'FAN',[3.5,0,0]);for(const side of [-1,1])for(let j=0;j<2;j++)fanAssembly(fan,side*(w/2+2),2.3,-1.5+j*2.2,.65,m);
 const cons=makePart(a,g,'CONS',[0,4.2,-.3]);const vessel=cyl(cons,.76,w*.78,0,deck+1.25,-d*.54,m.tank);vessel.rotation.z=Math.PI/2;for(const x of [-w*.26,w*.26])rod(cons,[x,deck,-d*.2],[x,deck+1.25,-d*.54],.12,m.dark);rod(cons,[2.7,deck+1.25,-d*.54],[3,3.4,-d*.4],.09,m.dark);cyl(cons,.18,.65,3,3,-d*.4,m.porcelain);
 const oltc=makePart(a,g,'OLTC',[2.2,0,2.8]);box(oltc,1.3,3.6,1.5,w*.38,2.6,d*.45,m.tank);cyl(oltc,.53,.12,w*.38,4.5,d*.45,m.steel);const ctrl=makePart(a,g,'CTRL',[-1.7,0,3.4]);box(ctrl,1.6,1.8,.8,-w*.35,1.8,d*.58,m.dark);box(ctrl,1.45,1.6,.05,-w*.35,1.8,d*.58+.43,m.steel);nameplate(ctrl,a.tag+' · GÜÇ TRAFOSU',1.4,.35,-w*.35,2.15,d*.58+.47);
}
function latticeColumn(g,cx,z,height,foot,top,m){
 const corners=[[-1,-1],[1,-1],[1,1],[-1,1]],point=(side,y)=>[cx+side[0]*(foot+(top-foot)*y/height)/2,y,z+side[1]*(foot+(top-foot)*y/height)/2];for(const c of corners)rod(g,point(c,0),point(c,height),.14,m);
 for(let y=0;y<height;y+=3){const yy=Math.min(y+3,height);for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];rod(g,point(a,y),point(b,yy),.055,m);rod(g,point(b,y),point(a,yy),.055,m);rod(g,point(a,yy),point(b,yy),.065,m);}}
}
function latticeBeam(g,width,y,z,m){for(const dy of [0,1.2])for(const dz of [-.55,.55])rod(g,[-width/2,y+dy,z+dz],[width/2,y+dy,z+dz],.11,m);for(let x=-width/2;x<width/2;x+=2){const xx=Math.min(x+2,width/2);for(const dz of [-.55,.55])rod(g,[x,y,z+dz],[xx,y+1.2,z+dz],.065,m);}}
function buildingShell(a,g,m,width,depth,height){const shell=material(0x6a8790),roof=material(0x425966);shell.userData.shell=true;roof.userData.shell=true;g.userData.materials.push(shell,roof);base(g,width+1,depth+1,m.base);box(g,width,.26,depth,0,height,0,roof);box(g,width,height,.25,0,height/2,-depth/2,shell);box(g,.25,height,depth,-width/2,height/2,0,shell);box(g,.25,height,depth,width/2,height/2,0,shell);for(let x=-width/2+2;x<width/2;x+=4){box(g,3.8,2.2,.18,x,1.1,depth/2,shell);box(g,.18,height,.25,x+1.9,height/2,depth/2,m.dark);}box(g,width,.6,.3,0,height-.4,depth/2,shell);return {shell,roof};}
function buildControlBuilding(a,g,m){
 const {shell}=buildingShell(a,g,m,42,25,8.6);const glass=material(0x426a7e,{transparent:true,opacity:.38,metalness:.1});glass.userData.shell=true;g.userData.materials.push(glass);for(let x=-17;x<=17;x+=4.2)box(g,3.8,3.4,.12,x,4,12.7,glass);
 box(g,5,5.2,.12,-13,2.6,12.8,m.dark);box(g,7,.22,4,-13,5.4,14,m.steel);for(let y=0;y<3;y++)box(g,7,.18,3-y*.7,-13,.15+y*.18,14,m.base);nameplate(g,'154 kV KUMANDA · GRIDATLAS',28,2,0,7.25,12.8);
 for(let i=0;i<8;i++){box(g,1.7,3,.7,-15+i*4.1,1.9,-7,m.dark);box(g,1.3,1.2,.06,-15+i*4.1,2.55,-6.61,m.steel);}for(let i=0;i<4;i++){box(g,3.2,.12,1.8,-9+i*6,1.4,2,m.steel);box(g,1.3,.8,.1,-9+i*6,2,1.6,m.dark);}for(const x of [-12,12])box(g,3.7,.7,2.3,x,9.1,0,m.steel);
}
function buildLine(a,g,m){
 const profile=profileFor(a),tower=get(a.terminalTower),portal=get(a.portal),hv=a.voltageLevel===400,dir=a.lineDirection,yTower=(hv?36:28)-4,towerZ=tower.z-a.z+dir*(hv?4.4:3.3),portalZ=portal.z-a.z,y=profile.lineHeight,entryZ=dir*8;
 a.leadPath=hv?[[0,yTower,towerZ],[0,y,portalZ],[0,y,entryZ]]:[[0,y,entryZ],[0,y,portalZ],[0,yTower,towerZ]];
 for(let i=0;i<3;i++){const p=phase(g,a,i),route=a.leadPath,pts=[];for(let j=0;j<route.length-1;j++){const start=v(...route[j]),end=v(...route[j+1]),sag=Math.min(2.4,start.distanceTo(end)*.045);for(let k=0;k<13;k++){const t=k/12,pt=start.clone().lerp(end,t);pt.y-=Math.sin(Math.PI*t)*sag;pts.push(pt);}}
  const key='line-lead:'+a.voltageLevel+':'+dir,curve=new THREE.CatmullRomCurve3(pts);mesh(p,geometry(key,()=>new THREE.TubeGeometry(curve,36,.065,4,false)),m.terminal);a.terminals.in.push(v(p.position.x,route[0][1],route[0][2]));a.terminals.out.push(v(p.position.x,route.at(-1)[1],route.at(-1)[2]));}
}

export { buildElectrical, buildTransformer, buildStructure, siteInfrastructure, buildShunt, buildCable, buildCubicle, buildSwitchgearBuilding, enhanceOutdoor, makePart, fanAssembly, transformerTank, bushingBank, radiatorBank, buildAutotransformer, buildPowerTransformer, latticeColumn, latticeBeam, buildingShell, buildControlBuilding, buildLine };
