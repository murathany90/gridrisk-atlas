(function(A){
  const U=A.Utils,C=A.CONFIG;
  class GridRepository{
    constructor(){this.data=new Map();this.loading=new Map();this.segmentCells=new Map();this.substationCells=new Map();this.cellSize=.5;this.segmentSeq=0;this.loadedCore=false;}
    cellKey(lon,lat){return `${Math.floor(lon/this.cellSize)},${Math.floor(lat/this.cellSize)}`;}
    cellsForBbox(w,s,e,n){const out=[];for(let x=Math.floor(w/this.cellSize);x<=Math.floor(e/this.cellSize);x++)for(let y=Math.floor(s/this.cellSize);y<=Math.floor(n/this.cellSize);y++)out.push(`${x},${y}`);return out;}
    assetKey(props,prefix='line'){return `${prefix}:${props?.id||props?.osmId||props?.osm_id||props?.name||props?.sourceId||JSON.stringify([props?.voltage,props?.operator]).slice(0,120)}`;}
    loadScriptFallback(key,cfg){
      if(window.AtmoGridData?.[key])return Promise.resolve(window.AtmoGridData[key]);
      const id=`grid-fallback-${key}`;
      const existing=document.getElementById(id);
      if(existing){
        const state=existing.dataset.state||'loading';
        if(state==='loaded'){const d=window.AtmoGridData?.[key];return d?Promise.resolve(d):Promise.reject(new Error('Yerel grid scripti veri üretmedi'));}
        if(state==='error')return Promise.reject(new Error('Yerel grid scripti yüklenemedi'));
        return new Promise((resolve,reject)=>{const onLoad=()=>{const d=window.AtmoGridData?.[key];d?resolve(d):reject(new Error('Yerel grid scripti veri üretmedi'));};const onError=()=>reject(new Error('Yerel grid scripti yüklenemedi'));existing.addEventListener('load',onLoad,{once:true});existing.addEventListener('error',onError,{once:true});setTimeout(()=>{existing.removeEventListener('load',onLoad);existing.removeEventListener('error',onError);reject(new Error('Grid script timeout'));},10000);});
      }
      return new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.id=id;sc.dataset.state='loading';sc.src=cfg.file.replace(/\.geojson$/i,'.js')+`?v=${encodeURIComponent(C.appVersion)}`;const timer=setTimeout(()=>{sc.dataset.state='error';reject(new Error('Grid script timeout'));},10000);sc.onload=()=>{clearTimeout(timer);sc.dataset.state='loaded';const d=window.AtmoGridData?.[key];d?resolve(d):reject(new Error('Yerel grid scripti veri üretmedi'));};sc.onerror=()=>{clearTimeout(timer);sc.dataset.state='error';reject(new Error('Yerel grid scripti yüklenemedi'));};document.head.appendChild(sc);});
    }
    async loadGroup(key){
      if(this.data.has(key))return this.data.get(key);if(this.loading.has(key))return this.loading.get(key);const cfg=C.gridSources[key];if(!cfg)throw new Error(`Bilinmeyen grid grubu: ${key}`);
      const p=(async()=>{const t0=performance.now();try{let data,mode='HTTP GeoJSON';if(location.protocol==='file:'){data=await this.loadScriptFallback(key,cfg);mode='yerel script fallback';}else{try{const r=await fetch(`${cfg.file}?v=${encodeURIComponent(C.appVersion)}`,{cache:'no-store',headers:{Accept:'application/geo+json,application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);data=await r.json();}catch(fetchErr){data=await this.loadScriptFallback(key,cfg);mode='script fallback';}}this.data.set(key,data);this.index(key,data);A.Events.emit('service',{id:'grid',state:'ok',latency:Math.round(performance.now()-t0),count:(data.features||[]).length,note:`${cfg.label} yüklendi · ${mode} · OSM/ODbL`});return data;}catch(e){A.Events.emit('service',{id:'grid',state:'error',note:`${cfg.label}: ${e.message}`});throw e;}finally{this.loading.delete(key);}})();this.loading.set(key,p);return p;
    }
    async loadCore(){if(this.loadedCore)return;await Promise.all([this.loadGroup('400'),this.loadGroup('154'),this.loadGroup('substations')]);this.loadedCore=true;A.Events.emit('gridCoreReady',this.stats());}
    index(key,data){
      if(key==='substations'){
        for(const f of data.features||[]){const c=f.geometry?.coordinates;if(!c||!Number.isFinite(c[0])||!Number.isFinite(c[1]))continue;const props=f.properties||{},p={lon:c[0],lat:c[1],props,id:this.assetKey(props,'substation')};const ck=this.cellKey(p.lon,p.lat);if(!this.substationCells.has(ck))this.substationCells.set(ck,[]);this.substationCells.get(ck).push(p);}return;
      }
      for(const f of data.features||[]){const g=f.geometry||{},props={...(f.properties||{}),gridGroup:key},assetKey=this.assetKey(props,`line-${key}`);const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];for(const line of lines){for(let i=1;i<line.length;i++){const a={lon:Number(line[i-1][0]),lat:Number(line[i-1][1])},b={lon:Number(line[i][0]),lat:Number(line[i][1])};if(!Number.isFinite(a.lon)||!Number.isFinite(a.lat)||!Number.isFinite(b.lon)||!Number.isFinite(b.lat))continue;const seg={sid:++this.segmentSeq,a,b,props,assetKey,gridGroup:key};for(const ck of this.cellsForBbox(Math.min(a.lon,b.lon),Math.min(a.lat,b.lat),Math.max(a.lon,b.lon),Math.max(a.lat,b.lat))){if(!this.segmentCells.has(ck))this.segmentCells.set(ck,[]);this.segmentCells.get(ck).push(seg);}}}
      }
    }
    nearbyCells(point,maxKm){const latDeg=maxKm/110.574,lonDeg=maxKm/(111.32*Math.max(.25,Math.cos(point.lat*Math.PI/180)));return this.cellsForBbox(point.lon-lonDeg,point.lat-latDeg,point.lon+lonDeg,point.lat+latDeg);}
    nearest(point,maxKm=50){
      let line=null,lineD=Infinity,sub=null,subD=Infinity;const seen=new Set();
      for(const ck of this.nearbyCells(point,maxKm)){
        for(const seg of this.segmentCells.get(ck)||[]){if(seen.has(seg.sid))continue;seen.add(seg.sid);const d=U.pointSegmentKm(point,seg.a,seg.b);if(d<lineD){lineD=d;line=seg;}}
        for(const s of this.substationCells.get(ck)||[]){const d=U.haversineKm(point,{lat:s.lat,lon:s.lon});if(d<subD){subD=d;sub=s;}}
      }
      return{line:line&&lineD<=maxKm?{distanceKm:lineD,feature:line}:null,substation:sub&&subD<=maxKm?{distanceKm:subD,feature:sub}:null};
    }
    assetsWithin(point,maxKm=10){
      const lines=new Map(),substations=new Map(),seenSeg=new Set();
      for(const ck of this.nearbyCells(point,maxKm)){
        for(const seg of this.segmentCells.get(ck)||[]){if(seenSeg.has(seg.sid))continue;seenSeg.add(seg.sid);const d=U.pointSegmentKm(point,seg.a,seg.b);if(d>maxKm)continue;const old=lines.get(seg.assetKey);if(!old||d<old.distanceKm)lines.set(seg.assetKey,{key:seg.assetKey,distanceKm:d,feature:seg,point:U.segmentMidpoint(seg)});}
        for(const s of this.substationCells.get(ck)||[]){const d=U.haversineKm(point,{lat:s.lat,lon:s.lon});if(d>maxKm)continue;const old=substations.get(s.id);if(!old||d<old.distanceKm)substations.set(s.id,{key:s.id,distanceKm:d,feature:s,point:{lat:s.lat,lon:s.lon}});}
      }
      return{lines:[...lines.values()].sort((a,b)=>a.distanceKm-b.distanceKm),substations:[...substations.values()].sort((a,b)=>a.distanceKm-b.distanceKm)};
    }
    analyzeFire(fire,maxKm=25){const point={lat:fire.lat,lon:fire.lon},n=this.nearest(point,maxKm),d=Math.min(n.line?.distanceKm??Infinity,n.substation?.distanceKm??Infinity),assets=this.assetsWithin(point,Math.min(10,maxKm));return{fire,nearest:n,assets,minDistanceKm:Number.isFinite(d)?d:null,band:Number.isFinite(d)?U.impactBand(d):null};}
    assetsInSector(point,direction,maxKm=C.downwind.maxDistanceKm,halfAngle=C.downwind.halfAngleDeg){
      if(!Number.isFinite(direction))return{lines:[],substations:[]};const lines=new Map(),substations=new Map(),seenSeg=new Set();
      const inside=p=>{const d=U.haversineKm(point,p);if(d>maxKm||d<.05)return null;const bearing=U.bearingDeg(point,p),diff=U.angleDiff(direction,bearing);return diff<=halfAngle?{distanceKm:d,bearing,diff}:null;};
      for(const ck of this.nearbyCells(point,maxKm)){
        for(const seg of this.segmentCells.get(ck)||[]){if(seenSeg.has(seg.sid))continue;seenSeg.add(seg.sid);const samples=[{lat:seg.a.lat,lon:seg.a.lon},{lat:seg.b.lat,lon:seg.b.lon},U.segmentMidpoint(seg)],hits=samples.map(inside).filter(Boolean).sort((a,b)=>a.diff-b.diff||a.distanceKm-b.distanceKm);if(!hits.length)continue;const hit=hits[0],old=lines.get(seg.assetKey);if(!old||hit.distanceKm<old.distanceKm)lines.set(seg.assetKey,{key:seg.assetKey,distanceKm:hit.distanceKm,bearing:hit.bearing,feature:seg,point:U.segmentMidpoint(seg)});}
        for(const sub of this.substationCells.get(ck)||[]){const hit=inside({lat:sub.lat,lon:sub.lon});if(!hit)continue;const old=substations.get(sub.id);if(!old||hit.distanceKm<old.distanceKm)substations.set(sub.id,{key:sub.id,distanceKm:hit.distanceKm,bearing:hit.bearing,feature:sub,point:{lat:sub.lat,lon:sub.lon}});}
      }
      return{lines:[...lines.values()].sort((a,b)=>a.distanceKm-b.distanceKm),substations:[...substations.values()].sort((a,b)=>a.distanceKm-b.distanceKm)};
    }
    analyzeEvents(events,maxKm=25,referenceTime=new Date(),windData=[]){
      const out=[];
      for(const event of events||[]){
        const memberAnalyses=event.members.map(f=>this.analyzeFire(f,maxKm)),best=[...memberAnalyses].sort((a,b)=>(a.minDistanceKm??Infinity)-(b.minDistanceKm??Infinity))[0],lines=new Map(),subs=new Map();
        for(const a of memberAnalyses){for(const x of a.assets.lines)lines.set(x.key,(!lines.has(x.key)||x.distanceKm<lines.get(x.key).distanceKm)?x:lines.get(x.key));for(const x of a.assets.substations)subs.set(x.key,(!subs.has(x.key)||x.distanceKm<subs.get(x.key).distanceKm)?x:subs.get(x.key));}
        const nearest=best?.nearest||{line:null,substation:null},minDistanceKm=best?.minDistanceKm??null,band=minDistanceKm!=null?U.impactBand(minDistanceKm):null;
        const age=U.ageHours(event.latestDetectedAt,referenceTime),distanceScore=minDistanceKm==null?0:minDistanceKm<=0.5?60:minDistanceKm<=1?52:minDistanceKm<=2?44:minDistanceKm<=3?36:minDistanceKm<=5?24:0,frpScore=Math.min(18,Math.sqrt(Math.max(0,event.maxFrp||0))*2),ageScore=age<=3?15:age<=6?12:age<=12?8:age<=24?4:1;
        let assetScore=0,nearestAssetPoint=null,nearestAssetKind=null,nearestAsset=null;const l=nearest.line,s=nearest.substation;if(l&&(!s||l.distanceKm<=s.distanceKm)){nearestAsset=l;nearestAssetKind='line';nearestAssetPoint=U.segmentMidpoint(l.feature);assetScore=l.feature.gridGroup==='400'?10:7;}else if(s){nearestAsset=s;nearestAssetKind='substation';nearestAssetPoint={lat:s.feature.lat,lon:s.feature.lon};assetScore=10;}
        const nw=U.nearestPoint(event,windData),wind=nw?.point;let downwindAlignment=false,windScore=0,downwindDirection=null,downwindAssets={lines:[],substations:[]},corridorDistanceKm=null,corridorWindSpeedKmh=null,corridorWindSource='model',corridorConfidence='normal';if(wind&&Number.isFinite(wind.direction)){const hasSpeed=Number.isFinite(wind.speed),speed=hasSpeed?wind.speed:C.downwind.fallbackWindSpeedKmh;if(!hasSpeed){corridorWindSource='fallback';corridorConfidence='low';}corridorWindSpeedKmh=speed;downwindDirection=(wind.direction+180)%360;corridorDistanceKm=U.adaptiveCorridorDistanceKm(event.maxFrp,speed);downwindAssets=this.assetsInSector(event,downwindDirection,corridorDistanceKm);if(nearestAssetPoint){const bearing=U.bearingDeg(event,nearestAssetPoint),diff=U.angleDiff(downwindDirection,bearing);downwindAlignment=diff<=35;if(downwindAlignment)windScore=8;else if(diff<=60)windScore=4;}if(!downwindAlignment&&(downwindAssets.lines.length||downwindAssets.substations.length))windScore=Math.max(windScore,3);}
        const score=U.clamp(Math.round(distanceScore+frpScore+ageScore+assetScore+windScore),0,100),scoreBand=U.riskScoreBand(score);
        out.push({event,memberAnalyses,nearest,minDistanceKm,band,affectedLines:[...lines.values()],affectedSubstations:[...subs.values()],riskScore:score,riskBand:scoreBand,ageHours:age,wind,downwindDirection,downwindAlignment,downwindAssets,corridorDistanceKm,corridorWindSpeedKmh,corridorWindSource,corridorConfidence,nearestAssetKind,nearestAsset,nearestLine:nearest?.line||null,nearestSubstation:nearest?.substation||null,displayedNearestAsset:nearest?.line||null});
      }
      return out.sort((a,b)=>b.riskScore-a.riskScore||(a.minDistanceKm??Infinity)-(b.minDistanceKm??Infinity));
    }
    stats(){const counts={};for(const [k,v] of this.data)counts[k]=v.features?.length||0;return{counts,segments:this.segmentSeq,substations:[...this.substationCells.values()].reduce((n,a)=>n+a.length,0)};}
  }
  A.GridRepository=GridRepository;
})(window.AtmoApp);
