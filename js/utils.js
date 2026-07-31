(function(A){
  const cache = new Map();
  const CACHE_MAX = 250;
  const listeners = new Map();
  A.Events = {
    on(name, fn){ if(!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); return ()=>listeners.get(name)?.delete(fn); },
    emit(name,payload){ (listeners.get(name)||[]).forEach(fn=>{ try{fn(payload)}catch(e){console.error(e)} }); }
  };
  A.Cache = {
    get(key){ const v=cache.get(key); if(!v)return null; if(Date.now()>v.expires){cache.delete(key);return null;} return v.value; },
    set(key,value,ttl){ if(cache.size>=CACHE_MAX){const oldest=cache.keys().next().value;if(oldest)cache.delete(oldest);} cache.set(key,{value,expires:Date.now()+ttl}); },
    clear(prefix=''){ for(const k of [...cache.keys()]) if(!prefix||k.startsWith(prefix)) cache.delete(k); }
  };
  const C=()=>A.CONFIG;
  function rb(){ return C().regionBounds; }
  function confidenceWeight(v){
    const s=String(v??'').toLowerCase();
    if(s==='high'||s==='h')return 1;
    if(s==='nominal'||s==='n')return .75;
    if(s==='low'||s==='l')return .45;
    const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n/100)):.6;
  }
  function normalizeFireDetection(raw, defaults = {}) {
    const lat = Number(raw.lat ?? raw.latitude);
    const lon = Number(raw.lon ?? raw.longitude);
    const detectedAt = raw.detectedAt || raw.acq_date ? (
      raw.detectedAt || (() => {
        const hhmm = String(raw.acq_time || '').padStart(4, '0');
        return `${raw.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
      })()
    ) : null;
    const frp = Number(raw.frp ?? raw.FRP ?? raw.brightness);
    return {
      id: raw.id || null,
      source: raw.source || defaults.source || null,
      product: raw.product || defaults.product || null,
      satellite: raw.satellite || defaults.satellite || null,
      sensor: raw.sensor || defaults.sensor || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      detectedAt: detectedAt || null,
      frp: Number.isFinite(frp) ? frp : null,
      confidence: raw.confidence != null ? raw.confidence : null,
      dayNight: raw.dayNight || raw.daynight || null,
      brightTi4: raw.brightTi4 != null ? Number(raw.brightTi4) : null,
      brightTi5: raw.brightTi5 != null ? Number(raw.brightTi5) : null,
      scan: raw.scan != null ? Number(raw.scan) : null,
      track: raw.track != null ? Number(raw.track) : null,
      sourceUrl: raw.sourceUrl || null
    };
  }

  function detectionIdentityKey(d) {
    const p = d.product || '';
    const s = d.satellite || '';
    const t = d.detectedAt ? d.detectedAt.slice(0, 16) : '';
    const lat = d.lat != null ? Number(d.lat).toFixed(4) : '';
    const lon = d.lon != null ? Number(d.lon).toFixed(4) : '';
    return `${p}:${s}:${t}:${lat}:${lon}`;
  }

  function deduplicateDetections(detections) {
    const seen = new Map();
    const out = [];
    for (const d of detections) {
      const key = detectionIdentityKey(d);
      if (!key) continue;
      if (seen.has(key)) {
        const existing = seen.get(key);
        existing.sources = existing.sources || [existing.source];
        if (d.source && !existing.sources.includes(d.source)) existing.sources.push(d.source);
        if (d.frp != null && (existing.frp == null || d.frp > existing.frp)) existing.frp = d.frp;
        if (d.confidence != null && existing.confidence == null) existing.confidence = d.confidence;
        continue;
      }
      const copy = { ...d };
      copy.sources = [d.source];
      seen.set(key, copy);
      out.push(copy);
    }
    return out;
  }

  A.Utils = {
    clamp(v,min,max){return Math.min(max,Math.max(min,v));},
    round(v,d=2){const p=10**d;return Math.round(v*p)/p;},
    toNum(v){const n=Number(v);return Number.isFinite(n)?n:null;},
    escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));},
    formatLocal(date){return new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(date);},
    formatUtc(date){return new Intl.DateTimeFormat('tr-TR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(date);},
    dateOnlyUtc(date){return new Date(date).toISOString().slice(0,10);},
    nearestTimeIndex(times,target){if(!times?.length)return -1;const tt=new Date(target).getTime();let best=0,dist=Infinity;for(let i=0;i<times.length;i++){const raw=String(times[i]);const t=Date.parse(raw.endsWith('Z')?raw:raw+'Z');const d=Math.abs(t-tt);if(d<dist){dist=d;best=i;}}return best;},
    insideRegion(p){if(!Number.isFinite(p?.lat)||!Number.isFinite(p?.lon))return false;const b=rb();if(p.lon<b.west||p.lon>b.east||p.lat<b.south||p.lat>b.north)return false;const poly=C().regionPolygon;if(!poly?.length)return true;let inside=false;const n=poly.length;for(let i=0,j=n-1;i<n;j=i++){const xi=poly[i][1],yi=poly[i][0],xj=poly[j][1],yj=poly[j][0];if((yi>p.lat)!==(yj>p.lat)&&p.lon<(xj-xi)*(p.lat-yi)/(yj-yi)+xi)inside=!inside;}return inside;},
    clampPoint(p){const b=rb();return {lat:this.clamp(Number(p.lat),b.south,b.north),lon:this.clamp(Number(p.lon),b.west,b.east)};},
    clampBounds(bounds){const b=rb();return {west:Math.max(b.west,bounds.getWest()),south:Math.max(b.south,bounds.getSouth()),east:Math.min(b.east,bounds.getEast()),north:Math.min(b.north,bounds.getNorth())};},
    regionBboxString(){const b=rb();return [b.west,b.south,b.east,b.north].join(',');},
    bboxString(bounds){const b=this.clampBounds(bounds);if(b.east<=b.west||b.north<=b.south)return this.regionBboxString();return [b.west,b.south,b.east,b.north].map(v=>v.toFixed(4)).join(',');},
    haversineKm(a,b){const R=6371,rad=Math.PI/180;const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad,la1=a.lat*rad,la2=b.lat*rad;const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));},
    bearingDeg(a,b){const r=Math.PI/180;const y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);const x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);return (Math.atan2(y,x)/r+360)%360;},
    angleDiff(a,b){const d=Math.abs((((a-b)+540)%360)-180);return d;},
    cardinal(deg){if(!Number.isFinite(deg))return '—';return ['K','KD','D','GD','G','GB','B','KB'][Math.round(((deg%360)+360)%360/45)%8];},
    destination(point,bearingDeg,distanceKm){const R=6371,r=Math.PI/180,br=bearingDeg*r,d=distanceKm/R,lat1=point.lat*r,lon1=point.lon*r;const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));return{lat:lat2/r,lon:lon2/r};},
    pointSegmentKm(p,a,b){
      const kx=111.320*Math.cos(p.lat*Math.PI/180),ky=110.574;
      const ax=(a.lon-p.lon)*kx, ay=(a.lat-p.lat)*ky, bx=(b.lon-p.lon)*kx, by=(b.lat-p.lat)*ky;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;let t=den?-(ax*dx+ay*dy)/den:0;t=this.clamp(t,0,1);
      const x=ax+t*dx,y=ay+t*dy;return Math.hypot(x,y);
    },
    segmentMidpoint(seg){return{lat:(seg.a.lat+seg.b.lat)/2,lon:(seg.a.lon+seg.b.lon)/2};},
    impactBand(distanceKm){if(!Number.isFinite(distanceKm))return null;return C().impactBands.find(b=>distanceKm<=b.maxKm)||{maxKm:Infinity,label:'Düşük yakınlık',level:'low'};},
    riskScoreBand(score){return C().riskScoreBands.find(b=>score>=b.min)||C().riskScoreBands.at(-1);},
    ageHours(detectedAt,reference=new Date()){const a=Date.parse(detectedAt),b=new Date(reference).getTime();return Number.isFinite(a)?Math.max(0,(b-a)/3600000):24;},
    ageOpacity(detectedAt,reference){const h=this.ageHours(detectedAt,reference);return h<=3?.95:h<=12?.75:h<=24?.5:.28;},
    confidenceWeight,
    adaptiveGrid(bounds,zoom,maxPoints=220){
      const b=this.clampBounds(bounds);if(b.east<=b.west||b.north<=b.south)return[];
      const latSpan=Math.max(.01,b.north-b.south),lonSpan=Math.max(.01,b.east-b.west),ratio=Math.max(.2,lonSpan/latSpan);
      const desired=Math.min(maxPoints,zoom<=5?150:zoom<=7?190:zoom<=9?220:260);
      let rows=Math.max(3,Math.round(Math.sqrt(desired/ratio))),cols=Math.max(3,Math.round(rows*ratio));
      const maxRows=Math.max(2,Math.floor(latSpan/.10)+1),maxCols=Math.max(2,Math.floor(lonSpan/.10)+1);
      rows=Math.min(rows,maxRows);cols=Math.min(cols,maxCols);
      while(rows*cols>maxPoints){if(cols>=rows&&cols>3)cols--;else if(rows>3)rows--;else break;}
      const pts=[];for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const p={lat:b.south+latSpan*r/(rows-1),lon:b.west+lonSpan*c/(cols-1)};if(this.insideRegion(p))pts.push(p);}return pts;
    },
    convexHull2D(points){
      const arr=[...points].filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      if(arr.length<3)return arr.map(p=>({lat:p.lat,lon:p.lon}));
      const sorted=[...arr].sort((a,b)=>a.lon-b.lon||a.lat-b.lat);
      const cross=(o,a,b)=>(a.lon-o.lon)*(b.lat-o.lat)-(a.lat-o.lat)*(b.lon-o.lon);
      const lower=[],upper=[];
      for(const p of sorted){
        while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();
        lower.push(p);
      }
      for(const p of sorted.reverse()){
        while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();
        upper.push(p);
      }
      lower.pop();upper.pop();
      return lower.concat(upper).map(p=>({lat:p.lat,lon:p.lon}));
    },
    clusterFires(fires,radiusKm=C().fireClustering.radiusKm,timeHours=C().fireClustering.timeHours){
      const arr=(fires||[]).filter(f=>this.insideRegion(f)&&Number.isFinite(Date.parse(f.detectedAt)));const n=arr.length;if(!n)return[];
      const maxMs=timeHours*3600000;
      const REF_LAT=39;const kmPerDeg=111.32;const cosRef=Math.cos(REF_LAT*Math.PI/180);
      const cells=new Map();
      for(let i=0;i<n;i++){
        const f=arr[i];const xKm=f.lon*kmPerDeg*cosRef;const yKm=f.lat*kmPerDeg;const ck=`${Math.floor(xKm/radiusKm)},${Math.floor(yKm/radiusKm)}`;
        if(!cells.has(ck))cells.set(ck,[]);
        cells.get(ck).push(i);
      }
      const parent=Array.from({length:n},(_,i)=>i);
      const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
      const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
      for(const [ck,indices] of cells){
        const [cx,cy]=ck.split(',').map(Number);
        for(let a=0;a<indices.length;a++)for(let b=a+1;b<indices.length;b++){
          if(Math.abs(Date.parse(arr[indices[a]].detectedAt)-Date.parse(arr[indices[b]].detectedAt))>maxMs)continue;
          if(this.haversineKm(arr[indices[a]],arr[indices[b]])<=radiusKm)join(indices[a],indices[b]);
        }
        for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
          const nk=`${cx+di},${cy+dj}`;if(nk<=ck)continue;
          const ni=cells.get(nk);if(!ni)continue;
          for(const i of indices)for(const j of ni){
            if(Math.abs(Date.parse(arr[i].detectedAt)-Date.parse(arr[j].detectedAt))>maxMs)continue;
            if(this.haversineKm(arr[i],arr[j])<=radiusKm)join(i,j);
          }
        }
      }
      const groups=new Map();for(let i=0;i<n;i++){const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(arr[i]);}
      return [...groups.values()].map(members=>{
        const sorted=[...members].sort((a,b)=>Date.parse(a.detectedAt)-Date.parse(b.detectedAt)||(b.frp||0)-(a.frp||0));
        const representative=sorted.reduce((best,f)=>(f.frp||0)>(best.frp||0)?f:best,sorted[0]);
        const latest=sorted.reduce((last,f)=>Date.parse(f.detectedAt)>Date.parse(last.detectedAt)?f:last,sorted[0]);
        const weightSum=members.reduce((s,f)=>s+Math.max(1,Number(f.frp)||1),0),lat=members.reduce((s,f)=>s+f.lat*Math.max(1,Number(f.frp)||1),0)/weightSum,lon=members.reduce((s,f)=>s+f.lon*Math.max(1,Number(f.frp)||1),0)/weightSum;
        const dayKey=sorted[0].detectedAt.slice(0,10).replaceAll('-','');
        const clat=Math.round(lat*100)/100,clon=Math.round(lon*100)/100;
        const hash=((Math.abs(clat*1000+clon*1000)%89999)+10000).toString(36);
        const sourceBreakdown={};
        for(const m of members){const src=m.source||'unknown';sourceBreakdown[src]=(sourceBreakdown[src]||0)+1;}
        const products=[...new Set(members.map(m=>m.product).filter(Boolean))];
        const satellites=[...new Set(members.map(m=>m.satellite).filter(Boolean))];
        return{id:`fire-${dayKey}-${String(clat).replace('.','')}-${hash}`,lat,lon,members,count:members.length,representative,maxFrp:Math.max(...members.map(f=>Number(f.frp)||0)),sumFrp:members.reduce((s,f)=>s+(Number(f.frp)||0),0),latestDetectedAt:latest.detectedAt,earliestDetectedAt:sorted[0].detectedAt,confidence:Math.max(...members.map(f=>confidenceWeight(f.confidence))),sourceBreakdown,products,satellites};
      }).sort((a,b)=>Date.parse(b.latestDetectedAt)-Date.parse(a.latestDetectedAt));
    },
    nearestPoint(point,points){let best=null,dist=Infinity;for(const p of points||[]){const d=this.haversineKm(point,p);if(d<dist){dist=d;best=p;}}return best?{point:best,distanceKm:dist}:null;},
    async fetchJson(url,{signal,timeout=20000,cacheKey,ttl=0}={}){
      if(cacheKey){const c=A.Cache.get(cacheKey);if(c)return{data:c,meta:{cached:true,latency:0,status:200}};}
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),timeout);let onAbort=null;if(signal){if(signal.aborted)ctrl.abort(signal.reason);else{onAbort=()=>ctrl.abort(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}}
      const start=performance.now();try{const res=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}}),latency=Math.round(performance.now()-start);if(!res.ok){const e=new Error(`HTTP ${res.status}`);e.kind=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH_REQUIRED':'HTTP_ERROR';e.status=res.status;throw e;}const data=await res.json();if(cacheKey&&ttl)A.Cache.set(cacheKey,data,ttl);return{data,meta:{cached:false,latency,status:res.status}};}catch(e){if(e.name==='AbortError'){const x=new Error('İstek iptal edildi');x.kind=ctrl.signal.reason==='timeout'?'TIMEOUT':'ABORTED';throw x;}if(e.kind)throw e;const x=new Error(e.message);x.kind='NETWORK_OR_CORS_ERROR';throw x;}finally{clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort);}
    },
    async fetchText(url,{signal,timeout=25000,cacheKey,ttl=0}={}){
      if(cacheKey){const c=A.Cache.get(cacheKey);if(c)return{data:c,meta:{cached:true,latency:0,status:200}};}
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),timeout);let onAbort=null;if(signal){if(signal.aborted)ctrl.abort(signal.reason);else{onAbort=()=>ctrl.abort(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}}
      const start=performance.now();try{const res=await fetch(url,{signal:ctrl.signal}),latency=Math.round(performance.now()-start);if(!res.ok){const txt=await res.text().catch(()=> '');const e=new Error(`HTTP ${res.status}`);e.kind=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH_REQUIRED':'HTTP_ERROR';e.status=res.status;e.body=txt.slice(0,400);throw e;}const data=await res.text();if(cacheKey&&ttl)A.Cache.set(cacheKey,data,ttl);return{data,meta:{cached:false,latency,status:res.status}};}catch(e){if(e.name==='AbortError'){const er=new Error('İstek iptal edildi/zaman aşımı');er.kind=ctrl.signal.reason==='timeout'?'TIMEOUT':'ABORTED';throw er;}if(!e.kind)e.kind='NETWORK_OR_CORS_ERROR';throw e;}finally{clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort);}
    },
    parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(q){if(ch==='"'&&next==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}else if(ch==='"')q=true;else if(ch===','){row.push(field);field='';}else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=ch;}if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}if(rows.length<2)return[];const h=rows[0].map(x=>x.trim());return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));},
    csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;},
    download(name,type,text){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);},
    frpColor(v){const n=Number(v)||0;return n>=100?'#7f001b':n>=50?'#c51b30':n>=20?'#ef5b3d':n>=5?'#ff9f43':'#ffd166';},
    smokeColor(variable,v){const x=Number(v)||0;if(variable==='pm10_wildfires'){return x>=30?[98,0,117]:x>=15?[152,37,133]:x>=8?[203,71,119]:x>=3?[239,138,98]:x>=1?[254,204,92]:[235,238,242];}if(variable==='wildfire_share'){return x>=75?[92,27,136]:x>=50?[145,39,143]:x>=30?[200,66,126]:x>=15?[238,121,106]:x>=5?[252,183,91]:[236,240,242];}return [220,226,230];},
    smokeAlpha(variable,v){const x=Number(v)||0;if(variable==='pm10_wildfires')return x<=0?.0:this.clamp(.12+Math.log1p(x)/4,.16,.72);if(variable==='wildfire_share')return x<=0?.0:this.clamp(.10+x/145,.12,.68);return x<=.02?0:this.clamp(.10+x*.42,.12,.58);},
    riskColor(level){return({critical:'#ff1744',high:'#ff7043',medium:'#ffb020',watch:'#f7df52',low:'#8a9aaa'})[level]||'#8a9aaa';},
    normalizeFireDetection,
    detectionIdentityKey,
    deduplicateDetections
  };
})(window.AtmoApp);
