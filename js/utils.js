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
  function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(!a||!b)continue;const xi=Number(a[0]),yi=Number(a[1]),xj=Number(b[0]),yj=Number(b[1]);if((yi>point.lat)!==(yj>point.lat)&&point.lon<(xj-xi)*(point.lat-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
  function pointInGeometry(point,geometry){if(!geometry)return true;const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];return polygons.some(polygon=>polygon?.length&&pointInRing(point,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(point,hole)));}
  function confidenceWeight(v){
    const s=String(v??'').toLowerCase();
    if(s==='high'||s==='h')return 1;
    if(s==='nominal'||s==='n')return .75;
    if(s==='low'||s==='l')return .45;
    const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n/100)):.6;
  }
  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function strOrNull(v) {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  }
  function normalizeFireDetection(raw, defaults = {}) {
    raw = raw || {};
    const lat = numOrNull(raw.lat ?? raw.latitude);
    const lon = numOrNull(raw.lon ?? raw.longitude);
    let detectedAt = raw.detectedAt ? String(raw.detectedAt) : null;
    if (!detectedAt && raw.acq_date) {
      const hhmm = String(raw.acq_time || "").padStart(4, "0");
      detectedAt = `${raw.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
    }
    if (detectedAt && Number.isNaN(Date.parse(detectedAt))) detectedAt = null;
    const frpMw = numOrNull(raw.frpMw ?? raw.FRP ?? raw.brightness ?? raw.frp);
    const frpUncertaintyMw = numOrNull(
      raw.frpUncertaintyMw ?? raw.frp_uncertainty ?? raw.uncertainty ?? raw.FRP_UNCERTAINTY,
    );
    const brightTi4K = numOrNull(raw.brightTi4K ?? raw.bright_ti4 ?? raw.brightTi4);
    const brightTi5K = numOrNull(raw.brightTi5K ?? raw.bright_ti5 ?? raw.brightTi5);
    const brightnessTemperatureK = numOrNull(
      raw.brightnessTemperatureK ?? brightTi4K,
    );
    const confidenceRaw =
      raw.confidenceRaw ?? raw.confidence ?? raw.CONFIDENCE ?? null;
    const pixelWidthKm = numOrNull(raw.scan ?? raw.pixelWidthKm);
    const pixelHeightKm = numOrNull(raw.track ?? raw.pixelHeightKm);
    const cloudFraction = numOrNull(raw.cloudFraction ?? raw.cloud_fraction ?? raw.CLOUD_FRACTION);
    const satellite = strOrNull(raw.satellite ?? defaults.satellite);
    const sensor = strOrNull(raw.sensor ?? raw.instrument ?? defaults.sensor);
    const sourceName = strOrNull(raw.sourceName ?? raw.source ?? defaults.source);
    const product = strOrNull(raw.product ?? defaults.product);
    const sourceId = strOrNull(raw.sourceId ?? defaults.sourceId);
    const nativeId = strOrNull(raw.id ?? raw.nativeId);
    const detectionId = strOrNull(raw.detectionId ?? nativeId);
    const normalized = {
      detectionId,
      nativeId,
      sourceId,
      sourceName,
      platform: strOrNull(raw.platform ?? satellite),
      satellite,
      sensor,
      sensorFamily: strOrNull(raw.sensorFamily ?? defaults.sensorFamily),
      product,
      processingMode: strOrNull(raw.processingMode ?? raw.processing),
      detectedAt,
      receivedAt: strOrNull(raw.receivedAt ?? raw.received_at),
      lat,
      lon,
      frpMw,
      frpUncertaintyMw,
      brightnessTemperatureK,
      brightTi4K,
      brightTi5K,
      confidenceRaw,
      confidenceNormalized:
        confidenceRaw != null ? confidenceWeight(confidenceRaw) : null,
      pixelWidthKm,
      pixelHeightKm,
      effectivePixelAreaKm2:
        pixelWidthKm != null && pixelHeightKm != null
          ? pixelWidthKm * pixelHeightKm
          : null,
      cloudFraction,
      qualityFlags: strOrNull(raw.qualityFlags ?? raw.quality_flags ?? raw.QUALITY_FLAGS),
      hotspotClass: strOrNull(raw.hotspotClass ?? raw.hotspot ?? raw.HOTSPOT_CLASS),
      dayNight: strOrNull(raw.dayNight ?? raw.daynight),
      countryCode: strOrNull(raw.countryCode ?? defaults.countryCode) || C().activeCountryCode || 'TR',
      rawProperties: raw,
    };
    normalized.frp = normalized.frpMw;
    normalized.confidence = normalized.confidenceRaw;
    normalized.source = normalized.sourceName;
    normalized.id = normalized.nativeId;
    normalized.brightTi4 = normalized.brightTi4K;
    normalized.brightTi5 = normalized.brightTi5K;
    normalized.scan = normalized.pixelWidthKm;
    normalized.track = normalized.pixelHeightKm;
    normalized.sourceUrl = strOrNull(raw.sourceUrl);
    return normalized;
  }

  function detectionIdentityKey(d) {
    const c = d.countryCode || C().activeCountryCode || 'TR';
    const p = d.product || '';
    const s = d.satellite || '';
    const t = d.detectedAt ? d.detectedAt.slice(0, 16) : '';
    const lat = d.lat != null ? Number(d.lat).toFixed(4) : '';
    const lon = d.lon != null ? Number(d.lon).toFixed(4) : '';
    return `${c}:${p}:${s}:${t}:${lat}:${lon}`;
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
    formatLocal(date){return new Intl.DateTimeFormat(A.I18n?.intlLocale?.()||'tr-TR',{timeZone:A.activeCountry?.().timezone||'Europe/Istanbul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(date);},
    formatUtc(date){return new Intl.DateTimeFormat(A.I18n?.intlLocale?.()||'tr-TR',{timeZone:'UTC',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(date);},
    formatTrShortDateTime(date){const d=new Date(date);if(Number.isNaN(d.getTime()))return null;return new Intl.DateTimeFormat(A.I18n?.intlLocale?.()||'tr-TR',{timeZone:A.activeCountry?.().timezone||'Europe/Istanbul',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).format(d);},
    formatShortDateTime(date){const d=new Date(date);if(Number.isNaN(d.getTime()))return null;const locale=A.I18n?.intlLocale?.()||'tr-TR',tz=A.activeCountry?.().timezone||'Europe/Istanbul';const dtf=new Intl.DateTimeFormat(locale,{timeZone:tz,day:'2-digit',month:'short'}),ttf=new Intl.DateTimeFormat(locale,{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'});return `${dtf.format(d)}, ${ttf.format(d)}`;},
    formatCompactDateTime(date){const d=new Date(date);if(Number.isNaN(d.getTime()))return null;const locale=A.I18n?.intlLocale?.()||'tr-TR',tz=A.activeCountry?.().timezone||'Europe/Istanbul';const dtf=new Intl.DateTimeFormat(locale,{timeZone:tz,day:'2-digit',month:'short'}),ttf=new Intl.DateTimeFormat(locale,{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'});return `${dtf.format(d)} ${ttf.format(d)}`;},
    formatCompactHour(date){const d=new Date(date);if(Number.isNaN(d.getTime()))return null;return new Intl.DateTimeFormat(A.I18n?.intlLocale?.()||'tr-TR',{timeZone:A.activeCountry?.().timezone||'Europe/Istanbul',day:'2-digit',month:'short',hour:'2-digit',hour12:false,hourCycle:'h23'}).format(d);},
    formatAgeShort(iso,reference=new Date()){const a=Date.parse(iso),b=new Date(reference).getTime(),t=(key,params)=>A.I18n?.t(key,params)||'';if(!Number.isFinite(a)||!Number.isFinite(b))return null;const min=Math.max(0,Math.floor((b-a)/60000));if(min<1)return t('sparkline.ago',{age:t('duration.lessMinute')});const days=Math.floor(min/1440),hours=Math.floor((min%1440)/60),mins=min%60;let age;if(days>0)age=`${t('duration.dayShort',{count:days})}${hours>0?` ${t('duration.hourShort',{count:hours})}`:''}`;else if(hours>0)age=`${t('duration.hourShort',{count:hours})}${mins>0?` ${t('duration.minuteShort',{count:mins})}`:''}`;else age=t('duration.minuteShort',{count:mins});return t('sparkline.ago',{age});},
    sparklinePoints(detections,opts={}){
      const endMs=Number.isFinite(Number(opts.endMs))?Number(opts.endMs):Date.now();
      const minFrp=Number.isFinite(Number(opts.minFrp))?Number(opts.minFrp):5;
      const maxPoints=Number.isFinite(Number(opts.maxPoints))?Math.max(1,Math.floor(Number(opts.maxPoints))):24;
      const windowMs=48*3600e3,start=endMs-windowMs;
      const pts=(detections||[]).filter(f=>f&&Number.isFinite(Date.parse(f.detectedAt))&&Number.isFinite(Number(f.frp))&&Number(f.frp)>=minFrp).map(f=>({f,t:Date.parse(f.detectedAt)})).filter(x=>x.t>=start&&x.t<=endMs).sort((a,b)=>a.t-b.t);
      const buckets=new Array(maxPoints).fill(null);
      for(const x of pts){
        const idx=Math.min(maxPoints-1,Math.floor(((x.t-start)/windowMs)*maxPoints));
        const cur=buckets[idx];
        if(!cur||Number(x.f.frp)>Number(cur.f.frp))buckets[idx]=x;
      }
      return buckets.filter(Boolean).map(x=>x.f);
    },
    formatAgeSince(iso,reference=new Date()){const a=Date.parse(iso),b=new Date(reference).getTime(),t=(key,params)=>A.I18n?.t(key,params)||'';if(!Number.isFinite(a)||!Number.isFinite(b))return null;const min=Math.max(0,Math.floor((b-a)/60000));if(min<1)return t('duration.lessMinute');const days=Math.floor(min/1440),hours=Math.floor((min%1440)/60),mins=min%60;if(days>0)return `${t('duration.day',{count:days})}${hours>0?` ${t('duration.hour',{count:hours})}`:''}`;if(hours>0)return `${t('duration.hour',{count:hours})}${mins>0?` ${t('duration.minute',{count:mins})}`:''}`;return t('duration.minute',{count:mins});},
    timeReference(selectedTime,sliderValue=0){const sel=new Date(selectedTime).getTime(),now=Date.now();if(!Number.isFinite(sel))return new Date(now);if(Number(sliderValue)===0)return new Date(now);return new Date(Math.min(sel,now+15*60e3));},
    areaHistory(fires,center,radiusKm){
      const radius=Number.isFinite(Number(radiusKm))&&Number(radiusKm)>0?Number(radiusKm):C().fireClustering.radiusKm;
      const valid=(fires||[]).filter(f=>f&&Number.isFinite(f.lat)&&Number.isFinite(f.lon)&&Number.isFinite(Date.parse(f.detectedAt)));
      let min=Infinity;for(const r of valid){const t=Date.parse(r.detectedAt);if(t<min)min=t;}
      const near=valid.filter(x=>this.haversineKm(x,center)<=radius);
      near.sort((a,b)=>Date.parse(a.detectedAt)-Date.parse(b.detectedAt));
      const windowHours=Number.isFinite(min)?(Date.now()-min)/3600e3:null;
      return{records:near,count:near.length,first:near.length?near[0].detectedAt:null,last:near.length?near[near.length-1].detectedAt:null,windowHours,window48:windowHours!=null&&windowHours<=49};
    },
    dateOnlyUtc(date){return new Date(date).toISOString().slice(0,10);},
    nearestTimeIndex(times,target){if(!times?.length)return -1;const tt=new Date(target).getTime();let best=0,dist=Infinity;for(let i=0;i<times.length;i++){const raw=String(times[i]);const t=Date.parse(raw.endsWith('Z')?raw:raw+'Z');const d=Math.abs(t-tt);if(d<dist){dist=d;best=i;}}return best;},
    insideRegion(p){if(!Number.isFinite(p?.lat)||!Number.isFinite(p?.lon))return false;const b=rb();if(p.lon<b.west||p.lon>b.east||p.lat<b.south||p.lat>b.north)return false;if(C().regionGeometry)return pointInGeometry(p,C().regionGeometry);const poly=C().regionPolygon;if(!poly?.length)return true;return pointInRing(p,poly.map(x=>[x[1],x[0]]));},
    pointInGeometry,
    clampPoint(p){const b=rb();return {lat:this.clamp(Number(p.lat),b.south,b.north),lon:this.clamp(Number(p.lon),b.west,b.east)};},
    clampBounds(bounds){const b=rb();return {west:Math.max(b.west,bounds.getWest()),south:Math.max(b.south,bounds.getSouth()),east:Math.min(b.east,bounds.getEast()),north:Math.min(b.north,bounds.getNorth())};},
    regionBboxString(){const b=rb();return [b.west,b.south,b.east,b.north].join(',');},
    bboxString(bounds){const b=this.clampBounds(bounds);if(b.east<=b.west||b.north<=b.south)return this.regionBboxString();return [b.west,b.south,b.east,b.north].map(v=>v.toFixed(4)).join(',');},
    haversineKm(a,b){const R=6371,rad=Math.PI/180;const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad,la1=a.lat*rad,la2=b.lat*rad;const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));},
    bearingDeg(a,b){const r=Math.PI/180;const y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);const x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);return (Math.atan2(y,x)/r+360)%360;},
    angleDiff(a,b){const d=Math.abs((((a-b)+540)%360)-180);return d;},
    cardinal(deg){if(!Number.isFinite(deg))return '—';const keys=['direction.n','direction.ne','direction.e','direction.se','direction.s','direction.sw','direction.w','direction.nw'];return A.I18n?.t(keys[Math.round(((deg%360)+360)%360/45)%8])||'—';},
    destination(point,bearingDeg,distanceKm){const R=6371,r=Math.PI/180,br=bearingDeg*r,d=distanceKm/R,lat1=point.lat*r,lon1=point.lon*r;const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));return{lat:lat2/r,lon:lon2/r};},
    pointSegmentKm(p,a,b){
      const kx=111.320*Math.cos(p.lat*Math.PI/180),ky=110.574;
      const ax=(a.lon-p.lon)*kx, ay=(a.lat-p.lat)*ky, bx=(b.lon-p.lon)*kx, by=(b.lat-p.lat)*ky;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;let t=den?-(ax*dx+ay*dy)/den:0;t=this.clamp(t,0,1);
      const x=ax+t*dx,y=ay+t*dy;return Math.hypot(x,y);
    },
    pointSegmentNearestKm(p,a,b){
      const kx=111.320*Math.cos(p.lat*Math.PI/180),ky=110.574;
      const ax=(a.lon-p.lon)*kx, ay=(a.lat-p.lat)*ky, bx=(b.lon-p.lon)*kx, by=(b.lat-p.lat)*ky;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;let t=den?-(ax*dx+ay*dy)/den:0;t=this.clamp(t,0,1);
      const x=ax+t*dx,y=ay+t*dy;
      return {distanceKm:Math.hypot(x,y),lat:p.lat+y/ky,lon:p.lon+x/kx};
    },
    segmentMidpoint(seg){return{lat:(seg.a.lat+seg.b.lat)/2,lon:(seg.a.lon+seg.b.lon)/2};},
    impactBand(distanceKm){if(!Number.isFinite(distanceKm))return null;const band=C().impactBands.find(b=>distanceKm<=b.maxKm)||{maxKm:Infinity,labelKey:'proximity.low',level:'low'};return{...band,label:A.I18n?.t(band.labelKey)||band.labelKey};},
    adaptiveCorridorDistanceKm(maxFrp,windSpeedKmh){const d=C().downwind;const speed=Number.isFinite(windSpeedKmh)?windSpeedKmh:d.fallbackWindSpeedKmh;const windNorm=this.clamp((speed-d.windMinKmh)/(d.windMaxKmh-d.windMinKmh),0,1);const frp=Math.max(Number(maxFrp)||d.frpMinMw,d.frpMinMw);const frpNorm=this.clamp(Math.log(frp/d.frpMinMw)/Math.log(d.frpMaxMw/d.frpMinMw),0,1);return Math.round(this.clamp(d.minDistanceKm+(d.maxDistanceKm-d.minDistanceKm)*(d.windWeight*windNorm+d.fireWeight*frpNorm),d.minDistanceKm,d.maxDistanceKm));},
    riskScoreBand(score){const band=C().riskScoreBands.find(b=>score>=b.min)||C().riskScoreBands.at(-1);return{...band,label:A.I18n?.t(band.labelKey)||band.labelKey};},
    ageHours(detectedAt,reference=new Date()){const a=Date.parse(detectedAt),b=new Date(reference).getTime();return Number.isFinite(a)?Math.max(0,(b-a)/3600000):24;},
    ageOpacity(detectedAt,reference){const h=this.ageHours(detectedAt,reference);return h<=3?.95:h<=12?.75:h<=24?.5:.28;},
    formatVoltage(v){if(v==null||v==='')return null;const n=Number(v);if(Number.isFinite(n)&&n>0)return `${n%1===0?n:n.toFixed(2)} kV`;const nums=String(v).split(/[^0-9.]+/).map(Number).filter(x=>Number.isFinite(x)&&x>0);if(!nums.length)return null;const max=Math.max(...nums),kv=max>10000?max/1000:max;return `${kv%1===0?kv:kv.toFixed(2)} kV`;},
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
      const refLat=Number(A.activeCountry?.().center?.[0])||39;const kmPerDeg=111.32;const cosRef=Math.cos(refLat*Math.PI/180);
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
        const countryCode=C().activeCountryCode||members[0]?.countryCode||'TR';
        return{id:`${countryCode}-fire-${dayKey}-${String(clat).replace('.','')}-${hash}`,countryCode,lat,lon,members,count:members.length,representative,maxFrp:Math.max(...members.map(f=>Number(f.frp)||0)),sumFrp:members.reduce((s,f)=>s+(Number(f.frp)||0),0),latestDetectedAt:latest.detectedAt,earliestDetectedAt:sorted[0].detectedAt,confidence:Math.max(...members.map(f=>confidenceWeight(f.confidence))),sourceBreakdown,products,satellites};
      }).sort((a,b)=>Date.parse(b.latestDetectedAt)-Date.parse(a.latestDetectedAt));
    },
    nearestPoint(point,points){let best=null,dist=Infinity;for(const p of points||[]){const d=this.haversineKm(point,p);if(d<dist){dist=d;best=p;}}return best?{point:best,distanceKm:dist}:null;},
    async fetchJson(url,{signal,timeout=20000,cacheKey,ttl=0}={}){
      if(cacheKey){const c=A.Cache.get(cacheKey);if(c)return{data:c,meta:{cached:true,latency:0,status:200}};}
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),timeout);let onAbort=null;if(signal){if(signal.aborted)ctrl.abort(signal.reason);else{onAbort=()=>ctrl.abort(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}}
      const start=performance.now();try{const res=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}}),latency=Math.round(performance.now()-start);if(!res.ok){const e=new Error(`HTTP ${res.status}`);e.kind=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH_REQUIRED':'HTTP_ERROR';e.status=res.status;throw e;}const data=await res.json();if(cacheKey&&ttl)A.Cache.set(cacheKey,data,ttl);return{data,meta:{cached:false,latency,status:res.status}};}catch(e){if(e.name==='AbortError'){const x=new Error(A.I18n?.t('error.requestCancelled')||'Request cancelled');x.kind=ctrl.signal.reason==='timeout'?'TIMEOUT':'ABORTED';throw x;}if(e.kind)throw e;const x=new Error(e.message);x.kind='NETWORK_OR_CORS_ERROR';throw x;}finally{clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort);}
    },
    async fetchText(url,{signal,timeout=25000,cacheKey,ttl=0}={}){
      if(cacheKey){const c=A.Cache.get(cacheKey);if(c)return{data:c,meta:{cached:true,latency:0,status:200}};}
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),timeout);let onAbort=null;if(signal){if(signal.aborted)ctrl.abort(signal.reason);else{onAbort=()=>ctrl.abort(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}}
      const start=performance.now();try{const res=await fetch(url,{signal:ctrl.signal}),latency=Math.round(performance.now()-start);if(!res.ok){const txt=await res.text().catch(()=> '');const e=new Error(`HTTP ${res.status}`);e.kind=res.status===429?'RATE_LIMIT':res.status===401||res.status===403?'AUTH_REQUIRED':'HTTP_ERROR';e.status=res.status;e.body=txt.slice(0,400);throw e;}const data=await res.text();if(cacheKey&&ttl)A.Cache.set(cacheKey,data,ttl);return{data,meta:{cached:false,latency,status:res.status}};}catch(e){if(e.name==='AbortError'){const er=new Error(A.I18n?.t('error.requestTimeout')||'Request cancelled/timed out');er.kind=ctrl.signal.reason==='timeout'?'TIMEOUT':'ABORTED';throw er;}if(!e.kind)e.kind='NETWORK_OR_CORS_ERROR';throw e;}finally{clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort);}
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
