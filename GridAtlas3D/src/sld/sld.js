// GridAtlas 3D v0.4 — src/sld/sld.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { $, esc, clamp } from '../core/utils.js';
import { get, electrical, assets, edges, bays } from '../data/station.js';

// SLD — SVG symbols generated from the same assets and edges.
const sldPositions=new Map();
function sldPosition(tag,x,y){sldPositions.set(get(tag).assetId,{x,y});}
function buildSLD(){
 sldPositions.clear();const put=(tag,x,y)=>sldPosition(tag,x,y),row=(tags,x,y,step=110)=>tags.forEach((t,i)=>put(t,x+i*step,y));
 for(const bay of bays.filter(b=>b.kind==='line')){const a=get(bay.line),hv=bay.voltage===400,y=(hv?80:760)+(bay.index-1)*(hv?122:112),code=(hv?400:150)+(bay.index-1)*10;const tags=hv?[a.terminalTower,a.portal,a.tag,'LA-'+(code+1),'CVT-'+(code+1),'LT-'+(code+1),'DS-'+(code+1),'CT-'+(code+1),bay.breaker,bay.dsA]:[a.terminalTower,a.portal,a.tag,'DS-'+(code+1),'LA-'+(code+1),'VT-'+(code+1),'CT-'+(code+1),bay.breaker,bay.dsA];row(tags,65,y,110);put(bay.dsB,hv?1135:1060,y+52);put(bay.earth,hv?730:405,y+54);}
 for(const [tag,x,y,from,to] of [['BUS-400-A',1240,300,40,632],['BUS-400-B',1340,300,40,632],['BUS-154-A',1240,1040,712,1400],['BUS-154-B',1340,1040,712,1400]]){put(tag,x,y);get(tag).sldSpan=[from-y,to-y];}
 row(['DS-490','COUPLER-400','DS-491'],825,611,140);row(['DS-290','COUPLER-154','DS-291'],825,1450,140);
 row(['DS-581','CB-581','CT-581','LA-581','REACTOR-400'],65,611,128);row(['DS-681','CB-681','CT-681','CAP-154'],65,1450,140);
 for(const tr of electrical.filter(a=>a.subtype==='autotransformer')){const n=tr.tag.endsWith('1')?0:1,y=165+n*262,hv=bays.find(b=>b.kind==='atrHV'&&b.transformer===tr.tag),lv=bays.find(b=>b.kind==='atrLV'&&b.transformer===tr.tag);row([...hv.items,tr.tag,...lv.items],1505,y,106);}
 for(const tr of electrical.filter(a=>a.subtype==='powerTransformer')){const i=Number(tr.tag.slice(-1)),bay=bays.find(b=>b.kind==='trHV'&&b.transformer===tr.tag);row([...bay.items,tr.tag,'CABLE-33-IN'+i],1510,790+(i-1)*239,116);}
 for(let i=0;i<3;i++){const letter='ABC'[i],x=70+i*745;row(['CB-33-IN'+(i+1),'VT-33-'+letter],x,1610,145);put('BUS-33-'+letter,x+300,1690);get('BUS-33-'+letter).sldSpan=[-105,105];for(let j=1;j<=2;j++){const n=i*2+j;row(['CB-33-OUT'+n,'CABLE-33-OUT'+n],x+455,1625+(j-1)*127,143);}}
 put('COUPLER-33-AB',760,1850);put('COUPLER-33-BC',1500,1850);put('CONTROL-154',2200,590);put('BUILDING-33',2200,678);
 const svg=$('#sld');svg.setAttribute('viewBox','0 0 2400 1920');svg.setAttribute('preserveAspectRatio','xMinYMin meet');let html='<text x="25" y="24" class="voltage-label">400 kV AÇIK ŞALT · 4 HAT / ÇİFT BARA</text><text x="1500" y="65" class="voltage-label">400 / 154 kV OTOTRAFOLAR</text><text x="25" y="701" class="voltage-label lv">154 kV AÇIK ŞALT · 6 HAT / ÇİFT BARA</text><text x="1500" y="730" class="voltage-label lv">154 / 33 kV GÜÇ TRAFOLARI</text><text x="25" y="1550" class="voltage-label mv">33 kV OG KAPALI ŞALT · ÜÇ BAĞIMSIZ BÖLÜM / KUPLAJLAR NORMALDE AÇIK</text>';
 const anchor=(asset,p,other)=>asset.sldSpan?{x:p.x,y:clamp(other.y,p.y+asset.sldSpan[0]+10,p.y+asset.sldSpan[1]-10)}:p;
 edges.forEach((e,i)=>{const aa=get(e.a),bb=get(e.b),ap=sldPositions.get(e.a),bp=sldPositions.get(e.b);if(!ap||!bp)return;const a=anchor(aa,ap,bp),b=anchor(bb,bp,ap);let d;
  if(aa.bay.startsWith('ATR')&&bb.tag==='BUS-154-A'){const lane=aa.bay.endsWith('1')?2325:2360;d=`M${a.x} ${a.y} H${lane} V${680+(aa.bay.endsWith('1')?0:20)} H${b.x} V${b.y}`;}
  else if(aa.tag.startsWith('CABLE-33-IN')){const n=Number(aa.tag.slice(-1)),lane=2200+n*44,y=1490+n*19;d=`M${a.x} ${a.y} H${lane} V${y} H${b.x} V${b.y}`;}
  else if(a.y===b.y)d=`M${a.x} ${a.y} H${b.x}`;
  else if(aa.sldSpan)d=`M${a.x} ${a.y} H${b.x} V${b.y}`;
  else if(bb.sldSpan)d=`M${a.x} ${a.y} H${b.x} V${b.y}`;
  else {const x=Math.abs(a.x-b.x)>500?Math.max(a.x,b.x)+40:(a.x+b.x)/2;d=`M${a.x} ${a.y} H${x} V${b.y} H${b.x}`;}
  html+=`<path d="${d}" stroke="#111b23" stroke-width="5" fill="none"/><path class="wire" data-edge="${i}" d="${d}"/>`;if(aa.sldSpan)html+=`<circle cx="${a.x}" cy="${a.y}" r="3" fill="#829f99"/>`;if(bb.sldSpan)html+=`<circle cx="${b.x}" cy="${b.y}" r="3" fill="#829f99"/>`;
 });
 for(const a of electrical.filter(a=>a.type==='line')){for(const [from,to] of [[a.terminalTower,a.portal],[a.portal,a.tag]]){const p=sldPositions.get(get(from).assetId),q=sldPositions.get(get(to).assetId);html+=`<path d="M${p.x} ${p.y} H${q.x}" stroke="#607f8b" stroke-dasharray="4 3" fill="none"/>`;}}
 for(const a of assets){const p=sldPositions.get(a.assetId);if(!p)continue;const words=a.name.split(' '),lines=[''];for(const word of words){let i=lines.length-1;if((lines[i]+' '+word).length>19&&lines.length<3)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}const symbolMarkup=a.sldSpan?`<path d="M0 ${a.sldSpan[0]}V${a.sldSpan[1]}" stroke-width="4"/>`:a.kind==='terminalTower'?'<path d="M-12 9L0 -14L12 9M-16 -3H16M-10 9H10M-5 -3L7 5M5 -3L-7 5"/>':a.kind==='portal'?'<path d="M-15 11V-10H15V11M-15 -5H15M-7 -10V2M0 -10V2M7 -10V2"/>':a.type==='structure'?'<path d="M-20 9V-9H20V9ZM-12 9V-2H-4V9M3 -3H13M3 3H13"/>':symbol(a);
  html+=`<g class="asset" data-asset="${a.assetId}" transform="translate(${p.x},${p.y})" role="button" tabindex="0"><title>${esc(a.name+' · '+a.tag)}</title><rect class="hit" x="-52" y="-24" width="104" height="88"/><g class="symbol">${symbolMarkup}${a.subtype==='autotransformer'?'<path d="M-12 10L13 -12M7 -12H13V-6"/>':''}</g><text y="-17" class="sld-tag">${esc(a.tag)}</text><text y="27" class="sld-name">${lines.map((l,i)=>`<tspan x="0" dy="${i?12:0}">${esc(l)}</tspan>`).join('')}</text></g>`;
 }svg.innerHTML=html;applySldZoom();
}
function symbol(a){
 const registry={
 circuitBreaker:'<path d="M-18 0H-7M7 0H18"/><rect x="-7" y="-7" width="14" height="14"/><path class="contact" d="M-5 0H5"/>',
 disconnector:'<path d="M-18 0H-7M7 0H18"/><circle cx="-7" r="1.4"/><circle cx="7" r="1.4"/><path class="contact" d="M-7 0H7"/>',
 earthSwitch:'<path d="M-18 0H-7M7 0H18"/><path class="contact" d="M-7 0H7"/><path d="M10 0v7m-6 0h12m-9 3h6m-4 3h2"/>',
 currentTransformer:'<path d="M-18 0H18"/><circle r="7"/>',
 voltageTransformer:'<path d="M-18 0H18M0 0v6"/><circle cy="7" r="5"/><circle cy="13" r="5"/>',
 arrester:'<path d="M-18 0H18M0 0v4"/><rect x="-4" y="4" width="8" height="10"/><path d="M0 14v4m-6 0h12"/>',
 transformer:'<path d="M-22 0H-14M14 0H22"/><circle cx="-6" r="9"/><circle cx="6" r="9"/>',
 busbar:'<path d="M0 -16V16" stroke-width="4"/><path d="M-20 0H20"/>',
 lineTrap:'<path d="M-18 0H-10q2-10 5 0q2-10 5 0q2-10 5 0q2-10 5 0h8"/>',
 line:'<path d="M-18 0H18m-30-5-6 5 6 5"/>',cable:'<path d="M-18 0H18M-7 -5v10M0 -5v10M7 -5v10"/>',
 reactor:'<path d="M-22 0H-15q3-16 7 0q3-16 7 0q3-16 7 0q3-16 7 0H22M22 0v10m-6 0h12m-9 4h6"/>',
 capacitor:'<path d="M-22 0H-5M5 0H22M-5 -12v24M5 -12v24M22 0v14m-6 0h12m-9 4h6"/>'
 };return (a.enclosure?'<rect x="-24" y="-20" width="48" height="42" stroke-dasharray="3 2" stroke-width=".7"/>':'')+(registry[a.type]||'<circle r="5"/>');
}
function updateSymbol(el,a){const contact=el.querySelector('.contact');if(contact)contact.setAttribute('d',a.state==='OPEN'||a.state==='OPENING'?'M-7 0L5 -9':'M-7 0H7');}
function applySldZoom(){const el=$('#sld'),container=$('#sld-container'),choice=$('#sld-zoom')?.value||'.75',scale=choice==='fit'?Math.min((container.clientWidth-24)/2400,(container.clientHeight-16)/1920):Number(choice);if(scale<=0)return;el.style.minWidth='0';el.style.minHeight='0';el.style.marginInline=choice==='fit'?'auto':'0';el.style.width=2400*scale+'px';el.style.height=1920*scale+'px';}

export { sldPositions, sldPosition, buildSLD, symbol, updateSymbol, applySldZoom };
