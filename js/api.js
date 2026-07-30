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
      const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',domains:'cams_europe'}),key=`smokedetail:${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
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
      const params=new URLSearchParams({latitude:point.lat.toFixed(5),longitude:point.lon.toFixed(5),hourly:vars.join(','),past_hours:'24',forecast_hours:'96',timezone:'GMT',wind_speed_unit:'kmh'}),key=`weatherdetail:${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
      try{const {data,meta}=await U.fetchJson(`${C.openMeteoWeather}?${params}`,{signal,cacheKey:key,ttl:C.cacheTtl.weather});const idx=U.nearestTimeIndex(data.hourly?.time,targetTime),values={};for(const v of vars){const n=Number(data.hourly?.[v]?.[idx]);values[v]=Number.isFinite(n)?n:null;}report('weather',{state:'ok',latency:meta.cached?0:meta.latency,count:1,note:'Yüzey + 850/700 hPa'});return{lat:Number(data.latitude),lon:Number(data.longitude),validAt:idx>=0?data.hourly.time[idx]+'Z':null,values,units:data.hourly_units||{},source:'Open-Meteo Weather Forecast',dataType:'forecast'};}catch(e){if(e.kind!=='ABORTED')report('weather',{state:'error',note:e.kind||e.message});throw e;}
    },
    async health(signal){return this.detail({lat:39,lon:35},new Date(),signal);}
  };

  A.Geocoder={async search(name,signal){const params=new URLSearchParams({name,count:'8',language:'tr',countryCode:'TR'});try{const {data,meta}=await U.fetchJson(`${C.openMeteoGeocode}?${params}`,{signal,cacheKey:`geo:${name.toLowerCase()}`,ttl:C.cacheTtl.geocode});const results=(data.results||[]).filter(r=>U.insideRegion({lat:Number(r.latitude),lon:Number(r.longitude)}));report('geocode',{state:'ok',latency:meta.cached?0:meta.latency,count:results.length,note:'Türkiye ile sınırlandı'});return results;}catch(e){if(e.kind!=='ABORTED')report('geocode',{state:'error',note:e.kind||e.message});throw e;}}};

  A.FirmsAdapter={
    source(){return localStorage.getItem('firmsSource')||'VIIRS_NOAA21_NRT';},
    setSource(v){if(C.firmsSources.includes(v))localStorage.setItem('firmsSource',v);},
    async load(signal){const source=this.source(),bbox=U.regionBboxString(),days=2,key=C.firmsMapKey;if(!key||key==='__FIRMS_MAP_KEY__'){const e=new Error('FIRMS MAP_KEY eksik');e.kind='AUTH_REQUIRED';report('firms',{state:'warn',note:'MAP_KEY eksik'});throw e;}const url=`${C.firmsBase}/${encodeURIComponent(key)}/${source}/${bbox}/${days}`;
      try{const {data,meta}=await U.fetchText(url,{signal,cacheKey:`firms:${source}:${bbox}`,ttl:C.cacheTtl.firms}),rows=U.parseCsv(data),seen=new Set(),out=[];for(const r of rows){const lat=Number(r.latitude),lon=Number(r.longitude);if(!U.insideRegion({lat,lon}))continue;const hhmm=String(r.acq_time||'').padStart(4,'0'),iso=`${r.acq_date}T${hhmm.slice(0,2)}:${hhmm.slice(2)}:00Z`,dt=new Date(iso);if(Number.isNaN(dt.getTime()))continue;const k=`${lat.toFixed(4)}:${lon.toFixed(4)}:${iso}:${r.satellite||''}`;if(seen.has(k))continue;seen.add(k);const frp=Number(r.frp);out.push({lat,lon,detectedAt:iso,sensor:r.instrument||source,satellite:r.satellite||'',confidence:r.confidence||null,frp:Number.isFinite(frp)?frp:null,dayNight:r.daynight||null,brightTi4:U.toNum(r.bright_ti4),brightTi5:U.toNum(r.bright_ti5),scan:U.toNum(r.scan),track:U.toNum(r.track),source:'NASA FIRMS',product:source});}report('firms',{state:'ok',latency:meta.cached?0:meta.latency,count:out.length,note:`${source} · Türkiye bbox`});return out;}catch(e){if(e.kind!=='ABORTED')report('firms',{state:e.kind==='AUTH_REQUIRED'?'warn':'error',note:e.kind||e.message});throw e;}
    }
  };

  A.AtmoHubAdapter={
    async discoverCapabilities(force=true){
      if(location.protocol==='file:'){report('atmohub',{state:'warn',count:0,note:'Keşif için yerel Node sunucusu gerekli; public API doğrulanmış değil'});return{available:false,reason:'SERVER_REQUIRED'};}
      try{const url=`${C.atmoHubDiscovery}?force=${force?'1':'0'}&t=${Date.now()}`;const {data,meta}=await U.fetchJson(url,{timeout:45000,ttl:0});const verified=data?.verified||[],candidates=data?.candidates||[],available=verified.length>0;report('atmohub',{state:available?'ok':'warn',latency:meta.cached?0:meta.latency,count:available?verified.length:candidates.length,note:available?`${verified.length} doğrulanabilir public veri/servis adayı bulundu`:(candidates.length?`${candidates.length} portal/bundle adayı bulundu; henüz smoke/fire API olarak doğrulanmadı`:'Portal tarandı; doğrulanmış public smoke/fire API bulunamadı')});return{available,verified,candidates,reason:available?null:'NO_VERIFIED_PUBLIC_API',...data};}catch(e){report('atmohub',{state:'warn',count:0,note:'Portal/bundle keşfi başarısız; CAMS wildfire PM10 fallback aktif'});return{available:false,reason:e.kind||'DISCOVERY_FAILED',error:e.message||String(e)};}
    }
  };

  A.EffisAdapter={wmsUrl:C.effisWms,layer:C.effisFwiLayer,metadata(){return{source:'Copernicus EFFIS',service:'WMS',layer:C.effisFwiLayer,requiresTime:true,dataType:'forecast'};}};

  A.FirePolygonAdapter={
    async load(signal){
      const started=performance.now(),cfg=C.firePolygons;
      const cutoff=Date.now()-7*86400000; // son 7 gün
      const url=cfg.url+`?where=${encodeURIComponent(`date >= ${cutoff}`)}&outFields=date,il,konum,area_ha,impact_b,impact_p,olu_sayi&returnGeometry=true&f=geojson&outSR=4326&resultRecordCount=500`;
      let features=[];
      try{
        const {data}=await U.fetchJson(url,{signal,cacheKey:'firePolygons:current',ttl:C.cacheTtl.grid});
        if(data?.features?.length){
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
          features=data.features;
        }
      }catch(e){if(e.kind!=='ABORTED')console.warn('FirePolygon:',e.message);}
      report('firePolygon',{state:'ok',latency:Math.round(performance.now()-started),count:features.length,note:`${cfg.label} · ${cfg.source}`});
      return{type:'FeatureCollection',features};
    }
  };
})(window.AtmoApp);
