// GridAtlas 3D v0.4 — src/data/station.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
import { normalize } from '../core/utils.js';

// DATA MODEL — assetId is the key shared by the topology, SLD, tree and meshes.
const assets=[], byId=new Map(), byTag=new Map(), edges=[];
const typeNames={line:'Havai Hat',arrester:'Parafudr',voltageTransformer:'Gerilim Trafosu',lineTrap:'Hat Tıkacı',disconnector:'Ayırıcı',earthSwitch:'Toprak Ayırıcısı',currentTransformer:'Akım Trafosu',circuitBreaker:'Kesici',busbar:'Bara',transformer:'Güç Trafosu',structure:'Saha Yapısı',part:'Trafo Bileşeni',reactor:'Şönt Reaktör',capacitor:'Şönt Kapasitör Bankı',cable:'Güç Kablosu'};
function add(tag,type,voltage,bay,x,z,extra={}){
 const prefix=['transformer','part'].includes(type)?'TR':voltage>0?String(voltage):'SITE';
 const assetId='TM01.'+prefix+'.'+bay.replace(/[^A-Z0-9]/g,'')+'.'+tag.replace(/[^A-Z0-9]/g,'');
 const a={assetId,tag,type,equipmentType:typeNames[type],name:typeNames[type],voltageLevel:voltage,bay,state:['circuitBreaker','disconnector'].includes(type)?'CLOSED':type==='earthSwitch'?'OPEN':'IN SERVICE',connections:[],x,z,measurements:{},energized:false,terminalEnergized:{in:false,out:false},...extra};
 assets.push(a);byId.set(assetId,a);byTag.set(tag,a);return a;
}
const get=key=>byId.get(key)||byTag.get(key);
function link(ta,tb,pa='out',pb='in'){const a=get(ta),b=get(tb);edges.push({id:'EDGE-'+(edges.length+1),a:a.assetId,b:b.assetId,pa,pb,flowP:0,flowQ:0});if(!a.connections.includes(b.assetId))a.connections.push(b.assetId);if(!b.connections.includes(a.assetId))b.connections.push(a.assetId);}
function chain(tags){for(let i=1;i<tags.length;i++)link(tags[i-1],tags[i]);}
// VOLTAGE PROFILES — no default electrical voltage is permitted.
const voltageProfiles={
 400:{nominal:400,phaseSpacing:5.3,busSpacing:3.1,busHeight:12.8,lineHeight:17,insulatorHeight:4.5,equipmentHeight:6.8,equipmentScale:1,dsHeight:4.7,theme:'hv',color:0xe4b779,layer:'hv',demoU:411.8,minU:408,maxU:416,ratedCurrent:3150},
 154:{nominal:154,phaseSpacing:3.1,busSpacing:2.1,busHeight:8.3,lineHeight:11,insulatorHeight:2.74,equipmentHeight:4.4,equipmentScale:.72,dsHeight:3.2,theme:'lv',color:0x83b9df,layer:'lv',demoU:155.6,minU:151,maxU:158,ratedCurrent:2500},
 33:{nominal:33,phaseSpacing:.58,busSpacing:.42,busHeight:3.05,lineHeight:1.1,insulatorHeight:.65,equipmentHeight:1.7,equipmentScale:.3,dsHeight:1.35,theme:'mv',color:0xbba4df,layer:'mv',demoU:33.2,minU:32,maxU:34.5,ratedCurrent:1600}
};
const voltageLevels=Object.keys(voltageProfiles).map(Number).sort((a,b)=>b-a);
const site={minX:-192,maxX:192,minZ:-220,maxZ:244,center:{x:0,z:12},maxRadius:1300,fenceMinZ:-166,fenceMaxZ:182};
const network={sourceTag:'LINE-400-01',sourceTags:[],trainingTag:'ES-401'};
const bays=[],transformerFamilies={autotransformer:{name:'Ototrafo',english:'Autotransformer'},powerTransformer:{name:'Güç Trafosu',english:'Power Transformer'}};
function rootAsset(a){return a?.parent?get(a.parent):a;}
function profileFor(asset,port='in'){const a=rootAsset(asset),level=a.type==='transformer'?(port==='out'?a.lvKV:a.hvKV):a.voltageLevel,p=voltageProfiles[level];if(!p)throw Error('Gerilim profili yok: '+a.tag);return p;}
function assetVoltages(a){a=rootAsset(a);return a.type==='transformer'?[a.hvKV,a.lvKV]:a.voltageLevel?[a.voltageLevel]:[];}
function voltageText(a){return assetVoltages(a).join(' / ')||'Saha';}
function stateText(a){return({CLOSED:'KAPALI',OPEN:'AÇIK',OPENING:'AÇILIYOR',CLOSING:'KAPANIYOR','IN SERVICE':'SERVİSTE'})[a.state]||a.state;}
function displayName(a){return a.name;}
function searchAssets(query){const q=normalize(query);return assets.filter(a=>normalize([a.name,a.tag,a.assetId,a.type,a.subtype,a.equipmentType,a.bayLabel,a.bay,voltageText(a)+' kV',a.kind==='terminalTower'?'terminal tower son direk':a.kind==='portal'?'gantry hat portalı':'',a.enclosure?'OG kapalı şalt hücre metal clad':'',a.type==='transformer'?'trafo transformer '+transformerFamilies[a.subtype].english:''].join(' ')).includes(q));}
function registerTransformer(a){
 a.name=a.hvKV+'/'+a.lvKV+' kV '+transformerFamilies[a.subtype].name;a.equipmentType=transformerFamilies[a.subtype].english+' / '+transformerFamilies[a.subtype].name;a.rating='DEMO · '+a.ratingMVA+' MVA';a.ratingSource='DEMO — tesis anma değeri değildir';a.parts={};
 for(const [key,name] of [['TANK','Ana Tank ve Aktif Kısım'],['HV',a.hvKV+' kV Buşingler'],['LV',a.lvKV===33?'33 kV Kablo Kutusu':a.lvKV+' kV Buşingler'],['RAD','Radyatör Bankaları'],['CONS','Konservatör'],['FAN','Soğutma Fanları'],['OLTC','Yük Altında Kademe Değiştirici'],['CTRL','Yerel Kontrol Kabini']]){const p=add(a.tag+'.'+key,'part',0,a.bay,a.x,a.z,{name,parent:a.assetId,partKey:key,bayLabel:a.tag+' Bileşenleri'});a.parts[key]=p.assetId;}
}
function registerBay(key,voltage,x,items,label){const bay={key,voltage,x,items:[],label};for(const item of items){const [tag,type,z,dx=0,extra={}]=item;const a=add(tag,type,voltage,key,x+dx,z,{bayLabel:label,ratedCurrent:voltageProfiles[voltage].ratedCurrent,ratingSource:'DEMO',...extra});bay.items.push(a.tag);}bays.push(bay);return bay;}
function createLineBay(voltage,index,x){
 const hv=voltage===400,n=String(index).padStart(2,'0'),line='LINE-'+voltage+'-'+n,key='LINE-'+n,code=hv?400+(index-1)*10:150+(index-1)*10,dsLine='DS-'+(code+1),dsA='DS-'+(code+2),dsB='DS-'+(code+3),cb='CB-'+(code+1),es='ES-'+(code+1),label=voltage+' kV Hat Fideri '+index;
 const items=hv?[[line,'line',-151],['LA-'+(code+1),'arrester',-131],['CVT-'+(code+1),'voltageTransformer',-122],['LT-'+(code+1),'lineTrap',-113],[dsLine,'disconnector',-103],['CT-'+(code+1),'currentTransformer',-92],[cb,'circuitBreaker',-82],[dsA,'disconnector',-68],[dsB,'disconnector',-66,14,{state:'OPEN'}],[es,'earthSwitch',-103,-15]]:[[dsA,'disconnector',110],[dsB,'disconnector',109,10,{state:'OPEN'}],[cb,'circuitBreaker',120],['CT-'+(code+1),'currentTransformer',130],['VT-'+(code+1),'voltageTransformer',140],['LA-'+(code+1),'arrester',150],[dsLine,'disconnector',160],[line,'line',174],[es,'earthSwitch',160,-10]];
 const bay=registerBay(key,voltage,x,items,label);bay.kind='line';bay.index=index;bay.line=line;bay.dsA=dsA;bay.dsB=dsB;bay.breaker=cb;
 const a=get(line);a.name=voltage+' kV Havai Hat';a.bayLabel=label;a.source=hv;a.terminalTower='TOWER-'+voltage+'-'+n;a.portal='PORTAL-'+voltage+'-'+n;a.lineDirection=hv?1:-1;a.worldLabel=true;
 if(hv){network.sourceTags.push(line);chain([line,'LA-'+(code+1),'CVT-'+(code+1),'LT-'+(code+1),dsLine,'CT-'+(code+1),cb,dsA,'BUS-400-A']);link(cb,dsB);link(dsB,'BUS-400-B');link(dsLine,es);}
 else {a.demand={p:[92,80,68,58,75,55][index-1],q:[17,13,11,9,15,8][index-1]};chain(['BUS-154-A',dsA,cb,'CT-'+(code+1),'VT-'+(code+1),'LA-'+(code+1),dsLine,line]);link('BUS-154-B',dsB);link(dsB,cb);link(dsLine,es,'out','in');}
 get(es).relatedBreaker=cb;get(es).interlock={breaker:cb,isolators:[dsLine,dsA,dsB]};bay.earth=es;
 for(const tag of [dsLine,dsA,dsB])get(tag).relatedBreaker=cb;
 add(a.terminalTower,'structure',voltage,key,x,hv?-198:220,{name:voltage+' kV Son Direk',kind:'terminalTower',linkedAsset:a.assetId,bayLabel:label,lineDirection:a.lineDirection,worldLabel:false});
 add(a.portal,'structure',voltage,key,x,hv?-149:175,{name:voltage+' kV Hat Portalı',kind:'portal',linkedAsset:a.assetId,bayLabel:label,lineDirection:a.lineDirection});
 return bay;
}
function createAutotransformer400_154(index,x){
 const tag='ATR-'+index,key=tag,code=500+index*10;
 const hv=registerBay(key,400,x,[['DS-'+code,'disconnector',-25],['CB-'+code,'circuitBreaker',-13],['CT-'+code,'currentTransformer',-2],['LA-'+code,'arrester',9]],tag+' · 400 kV Fideri');hv.kind='atrHV';hv.transformer=tag;
 const tr=add(tag,'transformer',0,key,x,32,{subtype:'autotransformer',hvKV:400,lvKV:154,ratingMVA:400,tap:11,design:'autotransformer',tankSize:[14.4,7.8,8.6],worldLabel:true,bayLabel:tag+' · Ototrafo'});registerTransformer(tr);
 const lv=registerBay(key,154,x,[['CB-'+(code+1),'circuitBreaker',53],['CT-'+(code+1),'currentTransformer',64],['DS-'+(code+1),'disconnector',74]],tag+' · 154 kV Fideri');lv.kind='atrLV';lv.transformer=tag;
 tr.hvBreaker='CB-'+code;tr.lvBreaker='CB-'+(code+1);get('DS-'+code).relatedBreaker=tr.hvBreaker;get('DS-'+(code+1)).relatedBreaker=tr.lvBreaker;
 chain(['BUS-400-A',...hv.items,tag,...lv.items,'BUS-154-A']);return tr;
}
function createPowerTransformer154_33(index,x){
 const tag='TR-'+index,code=600+index*10,key=tag,bay=registerBay(key,154,x,[['DS-'+code,'disconnector',110],['CB-'+code,'circuitBreaker',121],['CT-'+code,'currentTransformer',132],['LA-'+code,'arrester',142]],tag+' · 154 kV Fideri');bay.kind='trHV';bay.transformer=tag;
 const tr=add(tag,'transformer',0,key,x,158,{subtype:'powerTransformer',hvKV:154,lvKV:33,ratingMVA:90,tap:7+index-1,design:'powerTransformer',tankSize:[7.8,5.1,5.8],worldLabel:true,bayLabel:tag+' · Güç Trafosu'});registerTransformer(tr);tr.hvBreaker='CB-'+code;get('DS-'+code).relatedBreaker=tr.hvBreaker;
 const cable=add('CABLE-33-IN'+index,'cable',33,'INCOMER-'+index,x,183,{name:'33 kV '+tag+' Giriş Kablosu',bayLabel:tag+' Giriş Fideri',ratedCurrent:2000});chain(['BUS-154-A',...bay.items,tag,cable.tag]);return tr;
}
function createIndoorComplex(){
 const cells=[];for(let section=0;section<3;section++){
  const letter='ABC'[section],i=section+1,roleBay='SECTION-'+letter;
  cells.push(['CB-33-IN'+i,'circuitBreaker','TR-'+i+' Giriş Hücresi','incomer',roleBay],['VT-33-'+letter,'voltageTransformer','Ölçü Hücresi '+letter,'meter',roleBay],['BUS-33-'+letter,'busbar','Bara-'+letter+' Hücresi','bus',roleBay]);
  for(let j=1;j<=2;j++){const n=section*2+j;cells.push(['CB-33-OUT'+n,'circuitBreaker','Fider-'+n+' Çıkış Hücresi','outgoing',roleBay]);}
  if(section<2)cells.push(['COUPLER-33-'+letter+'ABC'[section+1],'circuitBreaker','Bara '+letter+'–'+'ABC'[section+1]+' Kuplaj Hücresi','coupler','COUPLER']);
 }
 cells.forEach(([tag,type,name,role,bay],i)=>add(tag,type,33,bay,98+i*4.1,208,{name:'33 kV '+name,bayLabel:bay==='COUPLER'?'Bara Kuplajları':'33 kV Bölüm '+bay.slice(-1),enclosure:'metalClad',cubicleRole:role,phaseAxis:'z',ratedCurrent:role==='outgoing'?1250:2000,ratingSource:'DEMO',state:role==='coupler'?'OPEN':type==='circuitBreaker'?'CLOSED':'IN SERVICE',worldLabel:role==='bus'}));
 for(let i=1;i<=3;i++){const letter='ABC'[i-1],tr=get('TR-'+i);tr.lvBreaker='CB-33-IN'+i;chain(['CABLE-33-IN'+i,tr.lvBreaker,'VT-33-'+letter,'BUS-33-'+letter]);for(let j=1;j<=2;j++){const n=(i-1)*2+j,cb=get('CB-33-OUT'+n),c=add('CABLE-33-OUT'+n,'cable',33,'SECTION-'+letter,cb.x,233,{name:'33 kV Fider-'+n+' Çıkış Kablosu',bayLabel:'33 kV Bölüm '+letter,ratedCurrent:1250,demand:{p:[16,12,20,14,18,10][n-1],q:[6,4,7,5,6,4][n-1]}});chain(['BUS-33-'+letter,cb.tag,c.tag]);}}
 chain(['BUS-33-A','COUPLER-33-AB','BUS-33-B','COUPLER-33-BC','BUS-33-C']);
 add('CONTROL-154','structure',154,'COMPLEX',72,208,{name:'154 kV Kumanda Binası',kind:'controlBuilding',complexId:'CONTROL-OG-01',bayLabel:'Kumanda + OG Kompleksi',worldLabel:true});
 add('BUILDING-33','structure',33,'COMPLEX',132,208,{name:'33 kV OG Kapalı Şalt Ek Bloğu',kind:'switchgearBuilding',complexId:'CONTROL-OG-01',bayLabel:'Kumanda + OG Kompleksi',worldLabel:true});
}
function createStation(){
 for(const level of [400,154])for(const letter of ['A','B'])add('BUS-'+level+'-'+letter,'busbar',level,'BUS',-12,level===400?(letter==='A'?-54:-39):(letter==='A'?85:97),{name:level+' kV Bara-'+letter,busWidth:346,bayLabel:'Çift Bara',worldLabel:true});
 for(let i=1;i<=4;i++)createLineBay(400,i,[-132,-68,-4,60][i-1]);for(let i=1;i<=6;i++)createLineBay(154,i,[-148,-114,-80,-46,-12,22][i-1]);
 for(const level of [400,154]){const hv=level===400,x=-178,baseZ=hv?-54:85,code=level===400?490:290,b=registerBay('COUPLER',level,x,[['DS-'+code,'disconnector',baseZ+2],['COUPLER-'+level,'circuitBreaker',baseZ+7],['DS-'+(code+1),'disconnector',baseZ+12]],level+' kV Bara Kuplajı');b.kind='coupler';chain(['BUS-'+level+'-A',...b.items,'BUS-'+level+'-B']);for(const t of [b.items[0],b.items[2]])get(t).relatedBreaker='COUPLER-'+level;}
 createAutotransformer400_154(1,-72);createAutotransformer400_154(2,22);
 [64,108,152].forEach((x,i)=>createPowerTransformer154_33(i+1,x));
 const re=registerBay('REACTOR-01',400,146,[['DS-581','disconnector',-25],['CB-581','circuitBreaker',-14],['CT-581','currentTransformer',-3],['LA-581','arrester',8]],'400 kV Şönt Reaktör Fideri');re.kind='reactor';get('DS-581').relatedBreaker='CB-581';
 add('REACTOR-400','reactor',400,re.key,146,31,{name:'400 kV Şönt Reaktör',bayLabel:re.label,ratingMvar:90,ratingSource:'DEMO',demand:{p:0,q:90},worldLabel:true});chain(['BUS-400-A',...re.items,'REACTOR-400']);
 const cap=registerBay('CAP-01',154,-140,[['DS-681','disconnector',48],['CB-681','circuitBreaker',39],['CT-681','currentTransformer',30]],'154 kV Şönt Kapasitör Bankı Fideri');cap.kind='capacitor';get('DS-681').relatedBreaker='CB-681';
 add('CAP-154','capacitor',154,cap.key,-140,14,{name:'154 kV Şönt Kapasitör Bankı',bayLabel:cap.label,ratingMvar:65,ratingSource:'DEMO',demand:{p:0,q:-65},worldLabel:true});chain(['BUS-154-A',...cap.items,'CAP-154']);
 createIndoorComplex();for(const [i,x,z] of [[1,-185,-156],[2,183,-155],[3,-186,175],[4,184,176]])add('MAST-0'+i,'structure',0,'SITE',x,z,{name:'Yıldırımdan Koruma Direği',kind:'mast',bayLabel:'Yıldırımdan Koruma'});
 for(const a of assets){if(a.type==='voltageTransformer'&&!a.enclosure)a.name=a.tag.startsWith('CVT')?'Kapasitif Gerilim Trafosu':'Gerilim Trafosu';a.ratingSource??='DEMO';if(a.voltageLevel&&a.type!=='structure')a.ratedCurrent??=voltageProfiles[a.voltageLevel].ratedCurrent;}
}
createStation();
const electrical=assets.filter(a=>!['structure','part'].includes(a.type));
const switchTypes=['circuitBreaker','disconnector','earthSwitch'];
const defaults=new Map(assets.map(a=>[a.assetId,a.state]));

export { assets, byId, byTag, edges, typeNames, add, get, link, chain, voltageProfiles, voltageLevels, site, network, bays, transformerFamilies, rootAsset, profileFor, assetVoltages, voltageText, stateText, displayName, searchAssets, registerTransformer, registerBay, createLineBay, createAutotransformer400_154, createPowerTransformer154_33, createIndoorComplex, createStation, electrical, switchTypes, defaults };
