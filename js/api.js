(function(A){
  const U=A.Utils,C=A.CONFIG;
  function report(id,patch){A.Events.emit('service',{id,...patch});}
  function normalizeArray(d){return Array.isArray(d)?d:[d];}
  function pkey(points){return points.map(p=>`${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';');}
  async function batches(points,size,fn){const out=[];for(let i=0;i<points.length;i+=size){const part=points.slice(i,i+size);out.push(...await fn(part,i/size));}return out;}

  A.OpenMeteoAir={
    variablesFor(v){return v==='wildfire_share'?['pm10_wildfires','pm10']:[v];},
    async grid(points,variable,targetTime,signal){
      points=points.filter(U.insideRegion.bind(U));if(!points.length)return[];const metaVar=C.smokeVariables[variable];if(!metaVar)throw new Error(`Desteklenmeyen duman değişkeni: ${variable}`);const vars=this.variablesFor(variable),started=performance.now();
      try{
        const result=await batches(points,45,async(part,bi)=>{
          const params=new URLSearchParams({latitude:part.map(p=>p.lat.toFixed(4)).join(','),longitude:part.map(p=>p.lon.toFixed(4)).join(','),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',domains:'cams_europe'});
          const key=`smoke:${variable}:${bi}:${pkey(part)}`;const {data,meta}=await U.fetchJson(`${C.openMeteoAir}?${params}`,{signal,cacheKey:key,ttl:C.cacheTtl.air});
          return normalizeArray(data).map((d,i)=>{const idx=U.nearestTimeIndex(d.hourly?.time,targetTime);let value=null;if(idx>=0){if(variable==='wildfire_share'){const wf=Number(d.hourly?.pm10_wildfires?.[idx]),tot=Number(d.hourly?.pm10?.[idx]);value=Number.isFinite(wf)&&Number.isFinite(tot)&&tot>0?U.clamp(wf/tot*100,0,100):null;}else{const n=Number(d.hourly?.[variable]?.[idx]);value=Number.isFinite(n)&&n>=0?n:null;}}return{lat:Number(d.latitude??part[i]?.lat),lon:Number(d.longitude??part[i]?.lon),validAt:idx>=0?d.hourly.time[idx]+'Z':null,value,unit:variable==='wildfire_share'?'%':d.hourly_units?.[variable]||metaVar.unit||'',variable,source:metaVar.source,model:'CAMS Europe',resolutionKm:11,dataType:variable==='wildfire_share'?'derived':'forecast',cached:meta.cached};}).filter(x=>U.insideRegion(x));
        });
        report('air',{state:'ok',latency:Math.round(performance.now()-started),count:result.filter(x=>x.value!=null).length,note:`${metaVar.label} · Türkiye grid · CAMS Europe`});return result;
      }catch(e){if(e.kind!=='ABORTED')report('air',{state:'error',note:e.kind||e.message});throw e;}
    },
    async detail(point,targetTime,signal){
      point=U.clampPoint(point);const vars=['pm10','pm10_wildfires'];
      const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',domains:'cams_europe'}),key=`smokedetail:${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
      try{const {data,meta}=await U.fetchJson(`${C.openMeteoAir}?${params}`,{signal,cacheKey:key,ttl:C.cacheTtl.air});const idx=U.nearestTimeIndex(data.hourly?.time,targetTime),values={};for(const v of vars){const n=Number(data.hourly?.[v]?.[idx]);values[v]=Number.isFinite(n)&&n>=0?n:null;}values.wildfire_share=values.pm10_wildfires!=null&&values.pm10>0?U.clamp(values.pm10_wildfires/values.pm10*100,0,100):null;const series=(data.hourly?.time||[]).map((t,i)=>{const wf=U.toNum(data.hourly?.pm10_wildfires?.[i]),tot=U.toNum(data.hourly?.pm10?.[i]);return{time:t+'Z',pm10_wildfires:wf,wildfire_share:wf!=null&&tot>0?U.clamp(wf/tot*100,0,100):null};});report('air',{state:'ok',latency:meta.cached?0:meta.latency,count:1,note:'Yangın kaynaklı PM10 nokta sorgusu'});return{lat:Number(data.latitude),lon:Number(data.longitude),validAt:idx>=0?data.hourly.time[idx]+'Z':null,values,units:data.hourly_units||{},series,source:'CAMS European Air Quality via Open-Meteo',resolutionKm:11,dataType:'forecast'};}catch(e){if(e.kind!=='ABORTED')report('air',{state:'error',note:e.kind||e.message});throw e;}
    },
    async health(signal){return this.detail({lat:39,lon:35},new Date(),signal);}
  };

  A.OpenMeteoWeather={
    async grid(points,targetTime,level='10m',signal){
      points=points.filter(U.insideRegion.bind(U));if(!points.length)return[];const m=C.windLevels[level]||C.windLevels['10m'],vars=[m.speed,m.direction];const started=performance.now();
      try{const result=await batches(points,45,async(part,bi)=>{const params=new URLSearchParams({latitude:part.map(p=>p.lat.toFixed(4)).join(','),longitude:part.map(p=>p.lon.toFixed(4)).join(','),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',wind_speed_unit:'kmh'});const {data}=await U.fetchJson(`${C.openMeteoWeather}?${params}`,{signal,cacheKey:`wind:${level}:${bi}:${pkey(part)}`,ttl:C.cacheTtl.weather});return normalizeArray(data).map((d,i)=>{const idx=U.nearestTimeIndex(d.hourly?.time,targetTime),speed=Number(d.hourly?.[m.speed]?.[idx]),direction=Number(d.hourly?.[m.direction]?.[idx]);return{lat:Number(d.latitude??part[i]?.lat),lon:Number(d.longitude??part[i]?.lon),validAt:idx>=0?d.hourly.time[idx]+'Z':null,speed:Number.isFinite(speed)?speed:null,direction:Number.isFinite(direction)?direction:null,level,label:m.label,source:'Open-Meteo Weather Forecast',dataType:'forecast'};}).filter(x=>U.insideRegion(x));});report('weather',{state:'ok',latency:Math.round(performance.now()-started),count:result.length,note:`${m.label} · Türkiye grid`});return result;}catch(e){if(e.kind!=='ABORTED')report('weather',{state:'error',note:e.kind||e.message});throw e;}
    },
    async detail(point,targetTime,signal){
      point=U.clampPoint(point);const vars=['wind_speed_10m','wind_direction_10m','wind_gusts_10m','temperature_2m','relative_humidity_2m','precipitation','wind_speed_850hPa','wind_direction_850hPa','wind_speed_700hPa','wind_direction_700hPa'];
      const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',wind_speed_unit:'kmh'}),key=`weatherdetail:${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
      try{const {data,meta}=await U.fetchJson(`${C.openMeteoWeather}?${params}`,{signal,cacheKey:key,ttl:C.cacheTtl.weather});const idx=U.nearestTimeIndex(data.hourly?.time,targetTime),values={};for(const v of vars){const n=Number(data.hourly?.[v]?.[idx]);values[v]=Number.isFinite(n)?n:null;}report('weather',{state:'ok',latency:meta.cached?0:meta.latency,count:1,note:'Yüzey + 850/700 hPa'});return{lat:Number(data.latitude),lon:Number(data.longitude),validAt:idx>=0?data.hourly.time[idx]+'Z':null,values,units:data.hourly_units||{},source:'Open-Meteo Weather Forecast',dataType:'forecast'};}catch(e){if(e.kind!=='ABORTED')report('weather',{state:'error',note:e.kind||e.message});throw e;}
    },
    async health(signal){return this.detail({lat:39,lon:35},new Date(),signal);}
  };

  A.Geocoder={async search(name,signal){const params=new URLSearchParams({name,count:'8',language:'tr',countryCode:'TR'});try{const {data,meta}=await U.fetchJson(`${C.openMeteoGeocode}?${params}`,{signal,cacheKey:`geo:${name.toLowerCase()}`,ttl:C.cacheTtl.geocode});const results=(data.results||[]).filter(r=>U.insideRegion({lat:Number(r.latitude),lon:Number(r.longitude)}));report('geocode',{state:'ok',latency:meta.cached?0:meta.latency,count:results.length,note:'Türkiye ile sınırlandı'});return results;}catch(e){if(e.kind!=='ABORTED')report('geocode',{state:'error',note:e.kind||e.message});throw e;}}};

  function parseFirmsRow(r, source, key, bbox) {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!U.insideRegion({ lat, lon })) return null;
    const hhmm = String(r.acq_time || '').padStart(4, '0');
    const iso = `${r.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    const frp = Number(r.frp);
    return {
      lat, lon,
      detectedAt: iso,
      sensor: r.instrument || source,
      satellite: r.satellite || '',
      confidence: r.confidence || null,
      frp: Number.isFinite(frp) ? frp : null,
      dayNight: r.daynight || null,
      brightTi4: U.toNum(r.bright_ti4),
      brightTi5: U.toNum(r.bright_ti5),
      scan: U.toNum(r.scan),
      track: U.toNum(r.track),
      source: 'NASA FIRMS',
      product: source
    };
  }

  const VIIRS_PRODUCTS = ['VIIRS_NOAA21_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT'];
  const MODIS_PRODUCT = 'MODIS_NRT';

  A.FirmsAdapter={
    source(){return localStorage.getItem('firmsSource')||'AUTO';},
    setSource(v){if(v==='AUTO'||C.firmsSources.includes(v))localStorage.setItem('firmsSource',v);},
    isAuto(){return this.source()==='AUTO';},
    async loadSingle(source, bbox, days, signal, key){
      const url=`${C.firmsBase}/${encodeURIComponent(key)}/${source}/${bbox}/${days}`;
      const {data,meta}=await U.fetchText(url,{signal,cacheKey:`firms:${source}:${bbox}`,ttl:C.cacheTtl.firms});
      const rows=U.parseCsv(data), out=[];
      for(const r of rows){
        const parsed = parseFirmsRow(r, source, key, bbox);
        if(parsed) out.push(parsed);
      }
      return { data: out, meta };
    },
    async loadAll(signal){
      const bbox=U.regionBboxString(), days=2, key=C.firmsMapKey;
      if(!key||key==='__FIRMS_MAP_KEY__'){const e=new Error('FIRMS MAP_KEY eksik');e.kind='AUTH_REQUIRED';report('firms',{state:'warn',note:'MAP_KEY eksik'});throw e;}
      const started=performance.now();
      const sources = VIIRS_PRODUCTS;
      const results = await Promise.allSettled(sources.map(s => {
        const ctrl = new AbortController();
        if(signal){if(signal.aborted)ctrl.abort(signal.reason);else{const h=()=>ctrl.abort(signal.reason);signal.addEventListener('abort',h,{once:true});ctrl.signal.addEventListener('abort',()=>signal.removeEventListener('abort',h));}}
        const timer = setTimeout(() => ctrl.abort('timeout'), 20000);
        const sKey = key;
        return this.loadSingle(s, bbox, days, ctrl.signal, sKey).finally(() => clearTimeout(timer));
      }));
      const all = [];
      let successCount = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          all.push(...r.value.data);
          successCount++;
        }
      }
      const deduped = U.deduplicateDetections(all);
      const full=successCount===sources.length,fail=successCount===0;
      report('firms',{
        state: full?'ok':fail?'error':'warn',
        latency: Math.round(performance.now() - started),
        count: deduped.length,
        note: `${successCount}/${sources.length} VIIRS ürünü başarılı · ${deduped.length} benzersiz tespit (${all.length} hamdan)`
      });
      return deduped;
    },
    async load(signal){
      const bbox=U.regionBboxString(), days=2, key=C.firmsMapKey;
      if(!key||key==='__FIRMS_MAP_KEY__'){const e=new Error('FIRMS MAP_KEY eksik');e.kind='AUTH_REQUIRED';report('firms',{state:'warn',note:'MAP_KEY eksik'});throw e;}
      if(this.isAuto()) return this.loadAll(signal);
      const source=this.source(), started=performance.now();
      try{
        const {data,meta}=await U.fetchText(`${C.firmsBase}/${encodeURIComponent(key)}/${source}/${bbox}/${days}`,{signal,cacheKey:`firms:${source}:${bbox}`,ttl:C.cacheTtl.firms});
        const rows=U.parseCsv(data), out=[];
        for(const r of rows){const parsed = parseFirmsRow(r, source, key, bbox); if(parsed) out.push(parsed);}
        report('firms',{state:'ok',latency:Math.round(performance.now()-started),cached:meta.cached,count:out.length,note:`${source} · Türkiye bbox`});
        return out;
      }catch(e){if(e.kind!=='ABORTED')report('firms',{state:e.kind==='AUTH_REQUIRED'?'warn':'error',note:e.kind||e.message});throw e;}
    }
  };

  A.AtmoHubAdapter={
    async discoverCapabilities(force=true){
      if(location.protocol==='file:'){report('atmohub',{state:'warn',count:0,note:'Keşif için yerel Node sunucusu gerekli; public API doğrulanmış değil'});return{available:false,reason:'SERVER_REQUIRED'};}
      try{const url=`${C.atmoHubDiscovery}?force=${force?'1':'0'}&t=${Date.now()}`;const {data,meta}=await U.fetchJson(url,{timeout:45000,ttl:0});const verified=data?.verified||[],candidates=data?.candidates||[],available=verified.length>0;report('atmohub',{state:available?'ok':'warn',latency:meta.cached?0:meta.latency,count:available?verified.length:candidates.length,note:available?`${verified.length} doğrulanabilir public veri/servis adayı bulundu`:(candidates.length?`${candidates.length} portal/bundle adayı bulundu; henüz smoke/fire API olarak doğrulanmadı`:'Portal tarandı; doğrulanmış public smoke/fire API bulunamadı')});return{available,verified,candidates,reason:available?null:'NO_VERIFIED_PUBLIC_API',...data};}catch(e){report('atmohub',{state:'warn',count:0,note:'Portal/bundle keşfi başarısız; CAMS wildfire PM10 fallback aktif'});return{available:false,reason:e.kind||'DISCOVERY_FAILED',error:e.message||String(e)};}
    }
  };

  A.EffisAdapter={wmsUrl:C.effisWms,layer:C.effisFwiLayer,metadata(){return{source:'Copernicus EFFIS',service:'WMS',layer:C.effisFwiLayer,requiresTime:true,dataType:'forecast'};}};

  A.GfwAdapter={
    sourceLabel:'Global Forest Watch — Integrated Disturbance Alerts',
    async load(signal){
      const started=performance.now();
      const key=C.gfwApiKey;
      if(!key||key==='__GFW_API_KEY__'){report('gfw',{state:'warn',note:'GFW_API_KEY eksik, GFW verisi pasif'});return[];}
      const bbox=U.regionBboxString();
      const startDate=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
      const endDate=new Date().toISOString().slice(0,10);
      try{
        const {data}=await U.fetchJson(`https://data-api.globalforestwatch.org/v2/umd_integrated_alerts/query?geometry=${encodeURIComponent(bbox)}&geometry_type=bbox&alert_confidence=high&start_date=${startDate}&end_date=${endDate}`,{
          signal,cacheKey:`gfw:${bbox}`,ttl:C.cacheTtl.grid});
        const rows=data?.data||[];
        report('gfw',{state:'ok',latency:Math.round(performance.now()-started),count:rows.length,note:'GFW Integrated Disturbance Alerts sorgusu'});
        return rows.map(r=>({lat:r.lat,lon:r.lon,detectedAt:r.alert_date||null,source:'GFW',product:'GFW_INTEGRATED_ALERT',frp:null,confidence:r.alert_confidence||'high'}));
      }catch(e){if(e.kind!=='ABORTED')report('gfw',{state:'error',note:e.kind||e.message});throw e;}
    }
  };

  A.MtgAdapter={
    sourceLabel:'Meteosat Third Generation — FCI Fire Products',
    status:'NOT_CONFIGURED',
    note:'EUMETSAT Data Store credentials sunucuda yapılandırılmamış. Server /api/mtg/active_fires → 501.',
    async load(signal){
      const started=performance.now();
      try{
        const bbox=U.regionBboxString();
        const {data}=await U.fetchJson(`/api/mtg/active_fires?bbox=${encodeURIComponent(bbox)}`,{signal,cacheKey:`mtg:${bbox}`,ttl:C.cacheTtl.firms});
        if(data?.error==='EUMETSAT credentials not configured'||data?.status==='NOT_CONFIGURED'){
          report('mtg',{state:'warn',note:'EUMETSAT credentials sunucuda yapılandırılmamış · MTG pasif'});
          return[];
        }
        const features=data?.features||[];
        const out=features.map(f=>{
          const p=f.properties||{},c=f.geometry?.coordinates||[];
          return{
            lat:c[1],lon:c[0],
            detectedAt:p.observedAt||p.acq_date||null,
            frp:Number.isFinite(p.frpMw)?p.frpMw:null,
            frpUncertaintyMw:Number.isFinite(p.frpUncertaintyMw)?p.frpUncertaintyMw:null,
            confidence:p.confidence||null,
            satellite:'MTG-I1',sensor:'FCI',
            spatialResolutionM:1000,
            processingStatus:p.processingStatus||'demonstration',
            source:'EUMETSAT MTG',product:'MTG_FCI_FRP'
          };
        }).filter(f=>U.insideRegion(f));
        report('mtg',{state:'ok',latency:Math.round(performance.now()-started),count:out.length,note:`${out.length} MTG-FCI tespit · demonstration`});
        return out;
      }catch(e){
        if(e.kind==='ABORTED')throw e;
        report('mtg',{state:'error',note:e.kind||e.message});
        return[];
      }
    }
  };

  A.FirePolygonAdapter={
    _lastGoodMap:new Map(),
    dateRange(){const ls=globalThis.localStorage;const s=ls?.getItem('firePolygonStart');const e=ls?.getItem('firePolygonEnd');if(s&&e)return{start:Number(s),end:Number(e)};return{start:C.firePolygonRange?.start||Date.now()-7*86400000,end:C.firePolygonRange?.end||Date.now()};},
    setDateRange(start,end){localStorage.setItem('firePolygonStart',start);localStorage.setItem('firePolygonEnd',end);},
    _rangeKey(r){return `${new Date(r.start).toISOString().slice(0,10)}_${new Date(r.end).toISOString().slice(0,10)}`;},
    _lastGood(r){return this._lastGoodMap.get(this._rangeKey(r||this.dateRange()))||null;},
    _setLastGood(r,fc){this._lastGoodMap.set(this._rangeKey(r),{fc,at:Date.now()});},
    async load(signal){
      const started=performance.now(),cfg=C.firePolygons;
      const range=this.dateRange();
      const rk=this._rangeKey(range);
      const cutoff=Math.min(range.start,range.end);
      const baseParams=`where=${encodeURIComponent(`date >= ${cutoff}`)}&outFields=date,il,konum,area_ha,impact_b,impact_p,olu_sayi&returnGeometry=true&f=geojson&outSR=4326`;
      let features=[],page=0,error=null,paginationComplete=true;
      const MAX_PAGES=50;
      try{
        while(page<MAX_PAGES){
          if(signal?.aborted)break;
          const url=`${cfg.url}?${baseParams}&resultRecordCount=500&resultOffset=${page*500}`;
          const {data}=await U.fetchJson(url,{signal,cacheKey:page===0?`firePolygons:${rk}`:null,ttl:C.cacheTtl.grid});
          if(!data?.features?.length)break;
          for(const f of data.features){
            const p=f.properties||{};
            f.properties={
              date:p.date?new Date(p.date).toISOString():null,
              il:p.il||'',konum:p.konum||'',
              areaHa:U.round(p.area_ha,1),
              affectedPeople:p.impact_p||0,
              affectedBuildings:p.impact_b||0,
              fatalities:p.olu_sayi||0,
              source:cfg.source
            };
            delete f.id;
          }
          if(range.end<Date.now()){
            const endMs=new Date(range.end).getTime();
            features.push(...data.features.filter(f=>{
              const d=f.properties?.date;
              return d&&new Date(d).getTime()<=endMs;
            }));
          }else{
            features.push(...data.features);
          }
          if(!data.exceededTransferLimit)break;
          page++;
        }
      }catch(e){
        if(e.kind==='ABORTED')throw e;
        paginationComplete=false;
        error=e.message||String(e);
        if(!features.length){
          const lg=this._lastGood(range);
          if(lg){
            report('firePolygon',{state:'stale',latency:Math.round(performance.now()-started),count:lg.fc.features.length,note:`${cfg.label} · son başarılı: ${lg.at?U.formatLocal(new Date(lg.at)):'—'} · aralık: ${rk} (API: ${error})`});
            return{...lg.fc,_stale:true,_error:error,_rangeKey:rk};
          }
          report('firePolygon',{state:'error',note:error});
          return{type:'FeatureCollection',features:[],_error:error,_rangeKey:rk};
        }
      }
      if(features.length&&paginationComplete){
        const fc={type:'FeatureCollection',features};
        this._setLastGood(range,fc);
      }
      const rangeNote=range.start!==Date.now()-7*86400000||range.end!==Date.now()?` · aralık: ${rk}`:'';
      const partial=paginationComplete?'':`, ${page+1} sayfadan ${page+1}. sayfada hata (kısmi veri)`;
      report('firePolygon',{state:features.length?'ok':'empty',latency:Math.round(performance.now()-started),count:features.length,note:features.length?`${cfg.label} · ${cfg.source}${rangeNote}${partial}`:(error?'API hatası, veri yok':'Son 7 günde yangın alanı yok')});
      return{type:'FeatureCollection',features,_rangeKey:rk,_partial:!paginationComplete};
    }
  };
})(window.AtmoApp);
