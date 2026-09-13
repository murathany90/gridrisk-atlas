// GridAtlas 3D v0.4 — src/electrical/electrical.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { config, state } from '../core/state.js';
import { emit, Events } from '../core/bus.js';
import { ctx } from '../core/context.js';
import { clamp, node } from '../core/utils.js';
import { assets, edges, electrical, get, network, rootAsset, profileFor, switchTypes, voltageLevels, voltageProfiles } from '../data/station.js';

// TOPOLOGY — external terminal edges + controllable internal contacts.


function buildGraph(){
 const graph=new Map();const join=(a,b)=>{if(!graph.has(a))graph.set(a,[]);if(!graph.has(b))graph.set(b,[]);graph.get(a).push(b);graph.get(b).push(a);};
 electrical.forEach(a=>{graph.set(node(a.assetId,'in'),[]);graph.set(node(a.assetId,'out'),[]);});
 edges.forEach(e=>join(node(e.a,e.pa),node(e.b,e.pb)));
 electrical.forEach(a=>{if(!switchTypes.includes(a.type)||a.state==='CLOSED')join(node(a.assetId,'in'),node(a.assetId,'out'));});
 return graph;
}
function traverse(graph,start){const seen=new Set(),queue=[...start];for(let i=0;i<queue.length;i++){const n=queue[i];if(seen.has(n))continue;seen.add(n);for(const next of graph.get(n)||[])if(!seen.has(next))queue.push(next);}return seen;}
function topology(){
 ctx.adjacency=buildGraph();ctx.liveTerminals=traverse(ctx.adjacency,sourceNodes());electrical.forEach(a=>{a.terminalEnergized.in=ctx.liveTerminals.has(node(a.assetId,'in'));a.terminalEnergized.out=ctx.liveTerminals.has(node(a.assetId,'out'));a.energized=a.terminalEnergized.in||a.terminalEnergized.out;});assets.filter(a=>a.parent||a.linkedAsset).forEach(a=>a.energized=get(a.parent||a.linkedAsset).energized);prepareFlowNetwork();solveFlows();if(state.path)calculatePath();emit(Events.TOPOLOGY_CHANGED,{});
}
function calculatePath(){
 const selected=rootAsset(get(state.selected)),a=get(selected?.linkedAsset)||selected||get(network.sourceTag),start=node(a.assetId,'in'),roots=sourceNodes(),parents=new Map(roots.map(n=>[n,null])),queue=[...roots];for(let i=0;i<queue.length;i++){if(queue[i]===start)break;for(const n of ctx.adjacency.get(queue[i])||[])if(!parents.has(n)){parents.set(n,queue[i]);queue.push(n);}}
 state.pathIds=new Set([a.assetId]);if(a.source){for(const n of ctx.liveTerminals)state.pathIds.add(n.slice(0,n.lastIndexOf(':')));}else{let cursor=start;while(cursor&&parents.has(cursor)){state.pathIds.add(cursor.slice(0,cursor.lastIndexOf(':')));cursor=parents.get(cursor);}}
 for(const id of [...state.pathIds]){const asset=get(id);if(asset?.type==='line'){state.pathIds.add(get(asset.portal).assetId);state.pathIds.add(get(asset.terminalTower).assetId);}}
}
// ANALYSIS — coherent balanced demo data, bounded smooth random walk.
const signalSpec={voltage:{label:'Gerilim · U',short:'U',unit:'kV',digits:1},current:{label:'Akım · I',short:'I',unit:'A',digits:0},p:{label:'Aktif güç · P',short:'P',unit:'MW',digits:1},q:{label:'Reaktif güç · Q',short:'Q',unit:'Mvar',digits:1},frequency:{label:'Frekans · f',short:'f',unit:'Hz',digits:2},loading:{label:'Yüklenme',short:'Load',unit:'%',digits:1},tap:{label:'Kademe',short:'Tap',unit:'',digits:0}};
// EDGE-BASED BALANCED DEMO FLOW — not a load-flow solver or electron motion model.
// A sparse linear equivalent network shares DEMO P/Q among available sources and parallel branches.
// Open contacts are excluded. This is illustrative branch allocation, not an AC load-flow calculation.
const assetFlows=new Map();
const walk={u:411.8,lv:155.6,mv:33.2,p:482,q:80,f:50.01,loadFactor:1};
const voltageSignals={400:'u',154:'lv',33:'mv'};
function solveFlows(){
 edges.forEach(e=>{e.flowP=0;e.flowQ=0;});assetFlows.clear();const data=network.flow;if(!data?.unknown.length)return;
 const dp=new Float64Array(data.unknown.length),dq=new Float64Array(data.unknown.length);
 for(const a of electrical){if(!a.demand)continue;const i=data.index.get(node(a.assetId,'out'));if(i===undefined)continue;const f=walk.loadFactor,over=state.overload?1.9:1;dp[i]+=a.demand.p*f*over*(state.reverseFlow&&a.type==='line'?-1.4:1);dq[i]+=a.demand.q*(a.ratingMvar?1:f);}
 const p=solvePotential(dp),q=solvePotential(dq),value=(values,n)=>data.index.has(n)?values[data.index.get(n)]:0,clean=n=>Math.abs(n)<.00001?0:n;
 for(const e of edges){const a=node(e.a,e.pa),b=node(e.b,e.pb);if(!ctx.liveTerminals.has(a)||!ctx.liveTerminals.has(b))continue;const w=data.conductance(a,b);e.flowP=clean((value(p,b)-value(p,a))*w);e.flowQ=clean((value(q,b)-value(q,a))*w);}
 for(const a of electrical){const from=node(a.assetId,'in'),to=node(a.assetId,'out');if(!ctx.liveTerminals.has(from)||!ctx.liveTerminals.has(to)||switchTypes.includes(a.type)&&a.state!=='CLOSED')continue;const w=data.conductance(from,to);assetFlows.set(a.assetId,{p:clean((value(p,to)-value(p,from))*w),q:clean((value(q,to)-value(q,from))*w)});}
}
function sampleValues(asset){
 const a=rootAsset(asset),profile=profileFor(a),u=walk[voltageSignals[profile.nominal]],flow=assetFlows.get(a.assetId)||{p:0,q:0};
 const conducting=a.energized&&(!switchTypes.includes(a.type)||a.state==='CLOSED'),p=conducting?flow.p:0,q=conducting?flow.q:0,mva=Math.hypot(p,q),current=mva*1000/(Math.sqrt(3)*u);
 const loading=a.ratingMVA?mva/a.ratingMVA*100:a.ratingMvar?Math.abs(q)/a.ratingMvar*100:a.ratedCurrent?current/a.ratedCurrent*100:0;
 return{voltage:a.energized?u:0,current,p,q,frequency:walk.f,loading,tap:a.type==='transformer'?a.tap:0};
}
function updateMeasurements(initial=false){
 if(!initial){for(const level of voltageLevels){const p=voltageProfiles[level],key=voltageSignals[level];walk[key]=clamp(walk[key]+(Math.random()-.5)*p.nominal*.0006,p.minU,p.maxU);}walk.loadFactor=clamp(walk.loadFactor+(Math.random()-.5)*.0018,.95,1.05);walk.f=clamp(walk.f+(Math.random()-.5)*.002,49.98,50.03);}
 solveFlows();const now=Date.now();
 electrical.forEach(a=>{const values=sampleValues(a);Object.entries(values).forEach(([key,value])=>{
 let m=a.measurements[key];if(!m)m=a.measurements[key]={value,quality:'GOOD',time:now,history:[]};
 const quality=state.quality&&a.tag==='CVT-401'&&key==='voltage'?'STALE':state.quality&&a.tag==='ATR-1'&&key==='p'?'INVALID':state.quality&&a.tag==='VT-151'&&key==='voltage'?'SUBSTITUTED':'GOOD';
 m.quality=quality;if(quality!=='STALE'){m.value=value;m.time=now;}
 if(m.history.at(-1)?.t===now)m.history.pop();m.history.push({t:now,v:quality==='INVALID'?null:m.value,quality});m.history=m.history.filter(p=>p.t>=now-config.historySeconds*1000);
 });});
 emit(Events.MEASUREMENTS_UPDATED,{time:now});
}
function flowDirection(value){return value<0?-1:value>0?1:0;}
function flowVisual(value,kind){const magnitude=Math.abs(value),threshold=.005;return{active:magnitude>threshold,direction:flowDirection(value),count:magnitude>threshold?clamp(Math.ceil(Math.sqrt(magnitude)*(kind==='q'?.9:.65)),2,18):0,speed:clamp(.022+Math.sqrt(magnitude)*.006,.025,.17)};}
function flowText(a){return ['p','q'].map(k=>{const signal=rootAsset(a).measurements[k],value=signal?.value||0;return (signal?.quality==='INVALID'?'×':value<0?'←':value>0?'→':'·')+' '+k.toUpperCase()+' '+formatSignal(rootAsset(a),k).replace(/^[-−]/,'')+' '+(k==='p'?'MW':'Mvar');}).join(' · ');}
function formatSignal(a,key){const m=a?.measurements[key];if(!m||m.quality==='INVALID')return'—';return m.value.toFixed(signalSpec[key].digits);}
function interlock(a,target){
 const cb=get(a.relatedBreaker);if(a.type==='disconnector'&&cb?.state==='CLOSED'&&Math.hypot(...Object.values(assetFlows.get(cb.assetId)||{p:0,q:0}))>.01)return cb.tag+' KAPALI durumda. Yük altında ayırıcı manevrası engellendi. Önce kesiciyi açın.';
 if(a.type==='earthSwitch'&&target==='CLOSED'){if(a.energized||!a.interlock?.isolators.every(tag=>get(tag).state==='OPEN'))return'Hat ve bara ayırıcıları açık; topraklanacak bölge enerjisiz olmalıdır.';}
 if(target==='CLOSED'&&a.type!=='earthSwitch'){
  if(electrical.some(e=>e.type==='earthSwitch'&&e.state==='CLOSED'&&e.bay===a.bay&&e.voltageLevel===a.voltageLevel))return'Toprak ayırıcısı kapalı. Önce toprak bağlantısını ayırın.';
  const old=a.state;a.state='CLOSED';const prospective=traverse(buildGraph(),sourceNodes());a.state=old;if(electrical.some(e=>e.type==='earthSwitch'&&e.state==='CLOSED'&&prospective.has(node(e.assetId,'in'))))return'İşlem topraklanmış bölgeyi enerjilendireceği için engellendi.';
 }
 return null;
}
function trainingConfig(a){const root=rootAsset(a)||get(network.trainingTag),earth=assets.find(x=>x.type==='earthSwitch'&&x.bay===root.bay&&x.voltageLevel===root.voltageLevel);if(earth)return {breaker:get(earth.interlock.breaker),isolators:earth.interlock.isolators.map(get),earth};const breaker=root.type==='circuitBreaker'?root:get(root.hvBreaker||root.relatedBreaker)||electrical.find(x=>x.type==='circuitBreaker'&&x.bay===root.bay&&x.voltageLevel===root.voltageLevel);return {breaker,isolators:electrical.filter(x=>x.type==='disconnector'&&x.relatedBreaker===breaker?.tag),earth:null};}
function sourceNodes(){return state.sourceActive?network.sourceTags.filter(t=>!state.sourceOutages.has(t)).map(t=>node(get(t).assetId,'in')):[];}
function prepareFlowNetwork(){
 const roots=new Set(sourceNodes()),unknown=[...ctx.liveTerminals].filter(n=>!roots.has(n)),index=new Map(unknown.map((n,i)=>[n,i])),rows=unknown.map(()=>({diagonal:0,neighbors:[]}));
 const conductance=(a,b)=>a.slice(0,a.lastIndexOf(':'))===b.slice(0,b.lastIndexOf(':'))?(get(a.slice(0,a.lastIndexOf(':'))).type==='transformer'?.45:4):1;
 unknown.forEach((n,i)=>{for(const next of ctx.adjacency.get(n)||[]){const w=conductance(n,next);rows[i].diagonal+=w;if(index.has(next))rows[i].neighbors.push([index.get(next),w]);}});
 network.flow={unknown,index,rows,roots,conductance};
}
function solvePotential(rhs){
 const rows=network.flow.rows,n=rhs.length,x=new Float64Array(n),r=new Float64Array(rhs),z=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);let rz=0;
 for(let i=0;i<n;i++){z[i]=r[i]/Math.max(rows[i].diagonal,1e-12);p[i]=z[i];rz+=r[i]*z[i];}if(rz<1e-20)return x;
 const initial=rz;for(let step=0;step<Math.min(600,n*2+4);step++){let pap=0;for(let i=0;i<n;i++){let a=rows[i].diagonal*p[i];for(const [j,w] of rows[i].neighbors)a-=w*p[j];ap[i]=a;pap+=p[i]*a;}if(Math.abs(pap)<1e-24)break;const alpha=rz/pap;let nextRz=0;for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];z[i]=r[i]/rows[i].diagonal;nextRz+=r[i]*z[i];}if(nextRz<initial*1e-18)break;const beta=nextRz/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=nextRz;}return x;
}

export { buildGraph, traverse, topology, calculatePath, signalSpec, assetFlows, walk, voltageSignals, solveFlows, sampleValues, updateMeasurements, flowDirection, flowVisual, flowText, formatSignal, interlock, trainingConfig, sourceNodes, prepareFlowNetwork, solvePotential };
