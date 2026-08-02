(function(A){
  const U=A.Utils,C=A.CONFIG;

  class SmokeCanvasLayer extends L.Layer{
    constructor(){super();this.data=[];this.variable='pm10_wildfires';this.opacity=.8;this._bound=()=>this.redraw();}
    onAdd(map){this._map=map;this._canvas=L.DomUtil.create('canvas','leaflet-smoke-canvas');this._canvas.setAttribute('aria-hidden','true');map.getPane('airPane').appendChild(this._canvas);map.on('moveend zoomend resize',this._bound);this.redraw();}
    onRemove(map){map.off('moveend zoomend resize',this._bound);this._canvas?.remove();this._canvas=null;this._map=null;}
    setData(data,variable){this.data=(data||[]).filter(x=>Number.isFinite(x.value));this.variable=variable;this.redraw();}
    setOpacity(v){this.opacity=U.clamp(Number(v)||.8,.25,1);if(this._canvas)this._canvas.style.opacity=String(this.opacity);}
    redraw(){
      if(!this._map||!this._canvas)return;const size=this._map.getSize(),topLeft=this._map.containerPointToLayerPoint([0,0]);L.DomUtil.setPosition(this._canvas,topLeft);const dpr=window.devicePixelRatio||1;this._canvas.width=Math.max(1,size.x*dpr);this._canvas.height=Math.max(1,size.y*dpr);this._canvas.style.width=`${size.x}px`;this._canvas.style.height=`${size.y}px`;this._canvas.style.opacity=String(this.opacity);const ctx=this._canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size.x,size.y);if(!this.data.length)return;
      const projected=this.data.map(p=>({p,pt:this._map.latLngToContainerPoint([p.lat,p.lon])})).filter(x=>x.pt.x>-180&&x.pt.y>-180&&x.pt.x<size.x+180&&x.pt.y<size.y+180);if(!projected.length)return;
      const n=projected.length,area=Math.max(1,size.x*size.y),spacing=Math.sqrt(area/Math.max(1,n)),radius=U.clamp(spacing*1.55,64,170);ctx.globalCompositeOperation='source-over';
      for(const {p,pt} of projected){const alpha=U.smokeAlpha(this.variable,p.value);if(alpha<=0)continue;const [r,g,b]=U.smokeColor(this.variable,p.value),gr=ctx.createRadialGradient(pt.x,pt.y,0,pt.x,pt.y,radius);gr.addColorStop(0,`rgba(${r},${g},${b},${alpha*.9})`);gr.addColorStop(.25,`rgba(${r},${g},${b},${alpha*.72})`);gr.addColorStop(.55,`rgba(${r},${g},${b},${alpha*.38})`);gr.addColorStop(.82,`rgba(${r},${g},${b},${alpha*.12})`);gr.addColorStop(1,`rgba(${r},${g},${b},0)`);ctx.fillStyle=gr;ctx.fillRect(pt.x-radius,pt.y-radius,radius*2,radius*2);}
    }
  }

  class HexagonMarker extends L.CircleMarker{
    _updatePath(){
      const r=this._radius,p=this._point,pts=[];
      for(let i=0;i<6;i++){const a=Math.PI/3*i;pts.push(L.point(p.x+r*Math.cos(a),p.y+r*Math.sin(a)));}
      this._parts=[pts];this._renderer._updatePoly(this,true);
    }
  }

  function mtgFmt(iso){return iso?iso.slice(11,16)+' UTC':'—';}
  class MtgFrameManager{
    constructor(cfg,handlers){this.cfg=cfg;this.on=handlers||{};this.slot=(cfg.slotMinutes||10)*60*1000;this.maxBack=cfg.maxBackfillSlots??12;this.settleMs=cfg.frameSettleMs??3000;this.frameSeq=0;this.requestedFrame=null;this.lastUserTime=null;this.displayedTime=null;this.loadedTileCount=0;this.failedTileCount=0;this.backfillAttempt=0;this._settleT=null;this._probeDone=false;}
    static roundToSlot(ms,slot){return new Date(Math.floor(ms/slot)*slot);}
    latestAllowed(){return MtgFrameManager.roundToSlot(Date.now(),this.slot);}
    normalize(date){const ms=Number(date instanceof Date?date.getTime():date),s=MtgFrameManager.roundToSlot(ms,this.slot),max=this.latestAllowed();return s.getTime()>max.getTime()?max:s;}
    applyUserTime(iso){this.lastUserTime=iso;this.backfillAttempt=0;if(iso===this.requestedFrame)return null;return this._start(iso);}
    applyBackfill(iso){return this._start(iso);}
    _start(iso){if(this._settleT){clearTimeout(this._settleT);this._settleT=null;}this.frameSeq++;this.requestedFrame=iso;this.loadedTileCount=0;this.failedTileCount=0;this._probeDone=false;this.on.start?.(iso,this.frameSeq);return this.frameSeq;}
    tileLoad(seq){if(seq!==this.frameSeq)return;this.loadedTileCount++;if(this._settleT){clearTimeout(this._settleT);this._settleT=null;}if(this.loadedTileCount===1){this.displayedTime=this.requestedFrame;this.on.ok?.(this.requestedFrame,this.frameSeq);}}
    tileError(seq){if(seq!==this.frameSeq||this.loadedTileCount>0)return;this.failedTileCount++;if(this._settleT)return;this._settleT=setTimeout(()=>this._settle(),this.settleMs);}
    dispose(){if(this._settleT){clearTimeout(this._settleT);this._settleT=null;}}
    async _settle(){
      this._settleT=null;
      const seq=this.frameSeq;
      if(this.loadedTileCount>0||seq===0)return;
      if(this.backfillAttempt>=this.maxBack){this.on.exhausted?.(this.requestedFrame,this.backfillAttempt,seq);return;}
      if(!this._probeDone&&this.on.probe){
        this._probeDone=true;
        const kind=await this.on.probe(this.requestedFrame);
        if(this.frameSeq!==seq||this.loadedTileCount>0||this._settleT)return;
        if(kind==='invalid'){this.on.invalid?.(this.requestedFrame,seq);return;}
        if(kind==='network'){this.on.network?.(this.requestedFrame,seq);return;}
      }
      this.backfillAttempt++;
      const target=new Date(Date.parse(this.requestedFrame)-this.slot).toISOString();
      this.on.backfill?.(this.requestedFrame,target,this.backfillAttempt,seq);
    }
  }

  class MapManager{
    constructor(){this.map=null;this.renderer=null;this.baseLayer=null;this.baseKey=null;this.fireLayer=null;this.fireAll=[];this.fireVisible=[];this.fireEventsVisible=[];this.currentSelectedTime=new Date();this.frpHeat=null;this.smokeLayer=null;this.airData=[];this.airVariable='pm10_wildfires';this.windLayer=null;this.windData=[];this.surfaceWindData=[];this.riskLayer=null;this.riskAssetLayer=null;this.downwindLayer=null;this.windVectorLayer=null;this.gridLayers=new Map();this.gridData=new Map();this._gridViewportTimer=null;this.fwiLayer=null;this.effisBurntAreaLayer=null;this.mtgLayer=null;this._mtgFrameMgr=null;this._mtgDebounceT=null;this.mtgRequestedTime=null;this.mtgDisplayedTime=null;this.onPointClick=null;this.frpThreshold=C.frpThreshold;this._renderTimer=null;this.footprintLayer=null;this.thermalEnvelopeLayer=null;this.evolutionLayer=null;}
    init(onPointClick){
      this.onPointClick=onPointClick;      this.map=L.map('map',{zoomControl:true,minZoom:C.mapMinZoom||2,worldCopyJump:true}).setView(C.defaultCenter,C.defaultZoom);this.renderer=L.canvas({padding:.4});
      this.map.createPane('mtgPane');this.map.getPane('mtgPane').style.zIndex=240;this.map.createPane('airPane');this.map.getPane('airPane').style.zIndex=320;this.map.createPane('fwiPane');this.map.getPane('fwiPane').style.zIndex=330;this.map.createPane('gridPane');this.map.getPane('gridPane').style.zIndex=410;this.map.createPane('riskPane');this.map.getPane('riskPane').style.zIndex=445;this.map.createPane('firePane');this.map.getPane('firePane').style.zIndex=460;this.map.createPane('windPane');this.map.getPane('windPane').style.zIndex=480;
      this.setBaseMap(localStorage.getItem('baseMap')||'satellite');this.fireLayer=L.layerGroup([], {pane:'firePane'}).addTo(this.map);this.smokeLayer=new SmokeCanvasLayer().addTo(this.map);this.windLayer=L.layerGroup([], {pane:'windPane'});this.riskLayer=L.layerGroup([], {pane:'riskPane'}).addTo(this.map);this.riskAssetLayer=L.layerGroup([], {pane:'riskPane'}).addTo(this.map);this.downwindLayer=L.layerGroup([], {pane:'riskPane'});this.windVectorLayer=L.layerGroup([], {pane:'windPane'}).addTo(this.map);this.borderLayer=L.polygon(C.regionPolygon,{pane:'gridPane',color:'#60a5fa',weight:1.5,fill:false,dashArray:'4 4',opacity:.55,interactive:false}).addTo(this.map);this.footprintLayer=L.layerGroup([],{pane:'riskPane'});this.thermalEnvelopeLayer=L.layerGroup([],{pane:'firePane'});this.evolutionLayer=L.layerGroup([],{pane:'riskPane'});
      this.map.on('click',e=>{const p={lat:e.latlng.lat,lon:e.latlng.lng};if(U.insideRegion(p))this.onPointClick?.(p);else A.Events.emit('outsideDataRegion',p);});this.map.on('zoomend moveend',()=>{if(!this._renderTimer){const t=this.currentSelectedTime;this._renderTimer=setTimeout(()=>{this._renderTimer=null;this.renderFires(t);},60);}if(!this._gridViewportTimer)this._gridViewportTimer=setTimeout(()=>{this._gridViewportTimer=null;this.refreshSubstationLayer();},80);});setTimeout(()=>this.map.invalidateSize(true),60);return this.map;
    }
    setBaseMap(key,mode='auto'){
      const cfg=C.baseMaps[key]||C.baseMaps.satellite;if(this.baseLayer)this.map?.removeLayer(this.baseLayer);this.baseKey=key in C.baseMaps?key:'satellite';
      const localServer=location.protocol!=='file:'&&['127.0.0.1','localhost'].includes(location.hostname),useProxy=mode==='proxy'||(mode==='auto'&&localServer),url=useProxy?`/api/tiles/${encodeURIComponent(this.baseKey)}/{z}/{x}/{y}`:cfg.url;
      this.baseLayer=L.tileLayer(url,{maxZoom:cfg.maxZoom||19,subdomains:cfg.subdomains||'abc',attribution:cfg.attribution,updateWhenIdle:true,keepBuffer:3});let loaded=false,errors=0,fallbackDone=false;
      this.baseLayer.on('tileload',()=>{loaded=true;A.Events.emit('basemapStatus',{state:'ok',key:this.baseKey,mode:useProxy?'proxy':'direct'});});
      this.baseLayer.on('tileerror',()=>{errors++;if(loaded||fallbackDone||errors<5)return;fallbackDone=true;if(useProxy){A.Events.emit('basemapError',{key:this.baseKey,note:`${cfg.label} yerel tile proxy üzerinden yüklenemedi; doğrudan servis deneniyor.`});setTimeout(()=>this.setBaseMap(this.baseKey,'direct'),0);return;}if(this.baseKey!=='osm'){A.Events.emit('basemapError',{key:this.baseKey,note:`${cfg.label} doğrudan yüklenemedi; OpenStreetMap deneniyor.`});setTimeout(()=>this.setBaseMap('osm','direct'),0);return;}A.Events.emit('basemapError',{key:this.baseKey,note:'Harita altlık servislerine ulaşılamadı. İnternet/VPN/güvenlik duvarını ve Ayarlar → Bağlantıları Kontrol Et bölümünü kontrol edin.'});});
      this.baseLayer.addTo(this.map);this.baseLayer.bringToBack();localStorage.setItem('baseMap',this.baseKey);A.Events.emit('basemap',{key:this.baseKey,label:cfg.label,mode:useProxy?'server-proxy':'direct'});
    }
    bounds(){return this.map.getBounds();}zoom(){return this.map.getZoom();}center(){const c=this.map.getCenter();return {lat:c.lat,lon:c.lng};}
    setView(lat,lon,zoom=9){const la=Number(lat),lo=Number(lon);if(Number.isFinite(la)&&Number.isFinite(lo))this.map.setView([U.clamp(la,-85,85),lo],zoom);}
    setCountryBoundary(boundary,country,fit=true){if(this.borderLayer)this.map.removeLayer(this.borderLayer);this.borderLayer=L.geoJSON(boundary,{pane:'gridPane',style:{color:'#60a5fa',weight:1.5,fill:false,dashArray:'4 4',opacity:.7,interactive:false}}).addTo(this.map);if(fit){const bounds=this.borderLayer.getBounds();if(bounds.isValid())this.map.fitBounds(bounds,{padding:[12,12],maxZoom:country.zoom||6,animate:false});}this.map.invalidateSize();}
    resetCountry(){this.fireAll=[];this.fireVisible=[];this.fireEventsVisible=[];this.fireLayer.clearLayers();if(this.frpHeat){this.map.removeLayer(this.frpHeat);this.frpHeat=null;}if(this.borderLayer){this.map.removeLayer(this.borderLayer);this.borderLayer=null;}this.clearSmoke();this.windData=[];this.surfaceWindData=[];this.windLayer.clearLayers();this.riskLayer.clearLayers();this.riskAssetLayer.clearLayers();this.downwindLayer.clearLayers();this.windVectorLayer.clearLayers();this.footprintLayer.clearLayers();this.thermalEnvelopeLayer.clearLayers();this.evolutionLayer.clearLayers();for(const layer of this.gridLayers.values())if(this.map.hasLayer(layer))this.map.removeLayer(layer);this.gridLayers.clear();this.gridData.clear();document.querySelectorAll('#legendStack [data-legend]').forEach(x=>x.remove());}
    setFires(data,selectedTime){this.fireAll=(data||[]).filter(U.insideRegion.bind(U));this.renderFires(selectedTime);}
    renderFires(selectedTime){
      this.currentSelectedTime=new Date(selectedTime);this.fireLayer.clearLayers();if(this.frpHeat){this.map.removeLayer(this.frpHeat);this.frpHeat=null;}const end=Math.min(this.currentSelectedTime.getTime(),Date.now()+15*60e3),start=end-24*3600e3;this.fireVisible=this.fireAll.filter(f=>{const t=Date.parse(f.detectedAt);return t>=start&&t<=end;});const allEvents=U.clusterFires(this.fireVisible);this.fireEventsVisible=allEvents.filter(ev=>ev.maxFrp>=this.frpThreshold);const slider=document.getElementById('timeSlider'),reference=U.timeReference(this.currentSelectedTime,slider?Number(slider.value):0),radius=C.fireClustering.radiusKm;
      if(this.zoom()<9){for(const ev of this.fireEventsVisible){const count=ev.count,radius=U.clamp(7+Math.sqrt(count)*2.2+Math.sqrt(Math.max(0,ev.maxFrp))*0.35,8,24),opacity=U.ageOpacity(ev.latestDetectedAt,new Date(end)),m=new HexagonMarker([ev.lat,ev.lon],{pane:'firePane',renderer:this.renderer,radius,color:'#fff',weight:1.2,opacity,fillColor:U.frpColor(ev.maxFrp),fillOpacity:opacity*.92});m.bindTooltip(this.firesEventTooltip(ev,U.areaHistory(this.fireAll,ev,radius),reference));if(this.zoom()<7&&count>1)m.bindTooltip(m.getTooltip().getContent()+`<br><strong>● ${count}</strong>`);m.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:ev.lat,lon:ev.lon,fire:ev.representative,fireEvent:ev});});m.addTo(this.fireLayer);}}
      else{const bounds=this.map.getBounds();const inView=this.fireVisible.filter(f=>f.frp==null||f.frp>=this.frpThreshold).filter(f=>bounds.contains([f.lat,f.lon])).sort((a,b)=>Math.abs(b.frp||0)-Math.abs(a.frp||0)).slice(0,5000);for(const f of inView){const radius=U.clamp(4+Math.sqrt(Math.max(0,f.frp||0))*1.05,4,17),opacity=U.ageOpacity(f.detectedAt,new Date(end)),m=new HexagonMarker([f.lat,f.lon],{pane:'firePane',renderer:this.renderer,radius,color:'#fff',weight:1,opacity,fillColor:U.frpColor(f.frp),fillOpacity:opacity*.9});m.bindTooltip(this.firesDetectionTooltip(f,U.areaHistory(this.fireAll,f,radius),reference));m.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:f.lat,lon:f.lon,fire:f});});m.addTo(this.fireLayer);}}
      A.Events.emit('firesRendered',{detections:this.fireVisible.length,events:this.fireEventsVisible.length,eventsTotal:allEvents.length});
    }
    toggleFires(show){if(show){if(!this.map.hasLayer(this.fireLayer))this.fireLayer.addTo(this.map);}else this.map.removeLayer(this.fireLayer);}
    toggleHeat(show){if(!show){if(this.frpHeat)this.map.removeLayer(this.frpHeat);return;}const candidates=this.fireVisible.filter(f=>U.insideRegion(f)&&Number.isFinite(f.frp)&&f.frp>=this.frpThreshold);const vals=candidates.map(f=>f.frp).filter(Number.isFinite).sort((a,b)=>a-b);const p95Idx=Math.floor(vals.length*0.95),p95=vals.length?Math.max(1,vals[p95Idx]):1;const pts=candidates.map(f=>[f.lat,f.lon,U.clamp(Math.log1p(f.frp)/Math.log1p(p95),0,1)]);if(this.frpHeat)this.map.removeLayer(this.frpHeat);this.frpHeat=L.heatLayer(pts,{radius:24,blur:20,maxZoom:11,max:1,pane:'riskPane'}).addTo(this.map);}
    setSmoke(data,variable){this.airData=data||[];this.airVariable=variable;this.smokeLayer.setData(this.airData,variable);this.updateSmokeLegend();}
    clearSmoke(){this.airData=[];this.smokeLayer.setData([],'pm10_wildfires');document.querySelector('[data-legend="smoke"]')?.remove();}
    makeLegend(id,title,body){const host=document.getElementById('legendStack');host.querySelector(`[data-legend="${id}"]`)?.remove();const d=document.createElement('div');d.className='legend';d.dataset.legend=id;d.innerHTML=`<div class="legendHeader"><div class="legendTitle">${title}</div><button class="legendClose" title="Lejantı kapat">×</button></div><div class="legendBody">${body}</div>`;d.querySelector('.legendClose').addEventListener('click',()=>d.remove());host.appendChild(d);return d;}
    updateSmokeLegend(){const meta=C.smokeVariables.pm10_wildfires,values=[0,1,3,8,15,30],colors=values.map(v=>{const [r,g,b]=U.smokeColor('pm10_wildfires',v);return `rgb(${r},${g},${b})`;});this.makeLegend('smoke',`${meta.label} · ${meta.unit}`,`<div class="gradient" style="background:linear-gradient(90deg,${colors.join(',')})"></div><div class="smokeLegendBands"><span>Düşük<br><b>0–3</b></span><span>Orta<br><b>3–15</b></span><span>Yüksek<br><b>15+</b></span></div><div class="sourceNote">Renk yoğunluğu yüzeye yakın yangın kaynaklı PM10'u gösterir. ${meta.source} · ${meta.resolution}<br><strong>Yumuşak plume görsel interpolasyondur; bilimsel çözünürlüğü artırmaz.</strong></div>`);}
    setWind(data,level){this.windData=data||[];this.windLayer.clearLayers();const valid=this.windData.filter(p=>Number.isFinite(p.speed)&&Number.isFinite(p.direction)).sort((a,b)=>a.lat-b.lat||a.lon-b.lon),samplingStep=Math.max(1,Math.ceil(valid.length/12)),visible=valid.filter((_,i)=>i%samplingStep===0).slice(0,12);for(const p of visible){const icon=L.divIcon({className:'',html:`<div class="windArrow" style="transform:rotate(${p.direction}deg)">↑</div>`,iconSize:[18,18],iconAnchor:[9,9]});const m=L.marker([p.lat,p.lon],{pane:'windPane',icon,interactive:true});m.bindTooltip(`${C.windLevels[level]?.label||level}<br>${U.round(p.speed,1)} km/h · ${Math.round(p.direction)}° ${U.cardinal(p.direction)}<br>${p.validAt?U.formatLocal(new Date(p.validAt)):'—'}`);m.addTo(this.windLayer);}}
    toggleWind(show){if(show){if(!this.map.hasLayer(this.windLayer))this.windLayer.addTo(this.map);}else if(this.map.hasLayer(this.windLayer))this.map.removeLayer(this.windLayer);}
    drawWindVector(point,direction,speed,level='10m',validAt=null){this.windVectorLayer.clearLayers();if(!Number.isFinite(direction)||!Number.isFinite(speed))return;const downwind=(direction+180)%360,end=U.destination(point,downwind,U.clamp(speed*.7,12,45)),tooltip=`Rüzgâr yönü: ${Math.round(downwind)}° ${U.cardinal(downwind)}<br>Hız: ${U.round(speed,1)} km/h<br>Model zamanı: ${validAt?U.formatLocal(new Date(validAt)):'—'}`;L.polyline([[point.lat,point.lon],[end.lat,end.lon]],{pane:'windPane',color:'#6dd5fa',weight:3,dashArray:'8 6',opacity:.9}).addTo(this.windVectorLayer).bindTooltip(tooltip);const icon=L.divIcon({className:'windDirectionArrowWrap',html:`<span class="windDirectionArrow" style="transform:rotate(${downwind}deg)">↑</span>`,iconSize:[24,24],iconAnchor:[12,12]});L.marker([end.lat,end.lon],{pane:'windPane',icon,interactive:true}).addTo(this.windVectorLayer).bindTooltip(tooltip);}
    clearWindVector(){this.windVectorLayer.clearLayers();}
    setDownwindCorridors(analyses,show=true){
      this.downwindLayer.clearLayers();
      if(this.map.hasLayer(this.downwindLayer))this.map.removeLayer(this.downwindLayer);
      document.querySelector('[data-legend="downwind"]')?.remove();
      if(!show)return;
      let count=0;
      for(const a of analyses||[]){
        if(count>=C.downwind.maxCorridors||!a.wind||a.riskScore<35||!Number.isFinite(a.downwindDirection)||!U.insideRegion({lat:a.event.lat,lon:a.event.lon}))continue;
        const center={lat:a.event.lat,lon:a.event.lon},pts=[[center.lat,center.lon]],steps=10,maxKm=a.corridorDistanceKm||C.downwind.maxDistanceKm;
        for(let i=0;i<=steps;i++){
          const bearing=a.downwindDirection-C.downwind.halfAngleDeg+(2*C.downwind.halfAngleDeg*i/steps),p=U.destination(center,bearing,maxKm);
          pts.push([p.lat,p.lon]);
        }
        pts.push([center.lat,center.lon]);
        const c=U.riskColor(a.riskBand.level),dw=a.downwindAssets||{lines:[],substations:[]};
        const poly=L.polygon(pts,{pane:'riskPane',color:c,weight:1.2,opacity:.58,fillColor:c,fillOpacity:.10,interactive:true});
        poly.bindTooltip(`Rüzgâr bazlı izleme koridoru · ${maxKm} km (adaptif ${C.downwind.minDistanceKm}–${C.downwind.maxDistanceKm} km)<br>${U.round(a.corridorWindSpeedKmh??a.wind.speed,1)} km/h · taşıma yönü ${Math.round(a.downwindDirection)}° · Maks. FRP ${U.round(a.event.maxFrp,0)} MW<br>${a.corridorWindSource==='fallback'?'Rüzgâr hızı eksik · 15 km/h varsayımı (fallback)':'Model 10 m yüzey rüzgârı'} · Koridorda: <strong>${dw.lines.length} hat / ${dw.substations.length} TM</strong><br><small>Operasyonel taramadır; yayılım tahmini değildir.</small>`);
        poly.addTo(this.downwindLayer);
        for(const x of dw.lines.slice(0,4))L.polyline([[x.feature.a.lat,x.feature.a.lon],[x.feature.b.lat,x.feature.b.lon]],{pane:'riskPane',color:'#7be6ff',weight:4,opacity:.78,dashArray:'5 4',interactive:false}).addTo(this.downwindLayer);
        count++;
      }
      if(count){
        this.downwindLayer.addTo(this.map);
        this.makeLegend('downwind',`Rüzgâr Bazlı İzleme Koridoru · Adaptif ${C.downwind.minDistanceKm}–${C.downwind.maxDistanceKm} km`,`<div class="legendLine"><i style="background:#7be6ff"></i><span>Koridordaki şebeke varlığı (yalnız hatlar işaretlenir; TM'ler risk katmanında ≤5 km'de gösterilir)</span></div><div class="sourceNote">Olay başına adaptif mesafe: 10 m yüzey rüzgârı + maks. FRP ile ${C.downwind.minDistanceKm}–${C.downwind.maxDistanceKm} km aralığında, ±${C.downwind.halfAngleDeg}° sektör. Rüzgâr alanını operasyonel tarama için kullanır; gerçek duman yörüngesi değildir.</div>`);
      }
    }
    toggleFwi(show,date){if(!show){if(this.fwiLayer)this.map.removeLayer(this.fwiLayer);document.querySelector('[data-legend="fwi"]')?.remove();return;}if(this.fwiLayer)this.map.removeLayer(this.fwiLayer);this.fwiLayer=L.tileLayer.wms(C.effisWms,{layers:C.effisFwiLayer,format:'image/png',transparent:true,version:'1.1.1',time:U.dateOnlyUtc(date),opacity:.43,pane:'fwiPane',attribution:'EFFIS / Copernicus'});let loaded=false;this.fwiLayer.on('tileload',()=>{if(!loaded){loaded=true;A.Events.emit('service',{id:'effis',state:'ok',count:null,note:`WMS ${C.effisFwiLayer} · TIME=${U.dateOnlyUtc(date)}`});}});this.fwiLayer.on('tileerror',()=>A.Events.emit('service',{id:'effis',state:'error',note:'WMS tile yüklenemedi'}));this.fwiLayer.addTo(this.map);this.makeLegend('fwi','EFFIS Fire Weather Index',`<div class="sourceNote">EFFIS WMS renkleri · ${U.dateOnlyUtc(date)} · meteorolojik yangın tehlikesi. Sayısal FWI değeri bu WMS tile katmanından türetilmez.</div>`);}
    toggleEffisBurntArea(show,date){
      if(!show){if(this.effisBurntAreaLayer)this.map.removeLayer(this.effisBurntAreaLayer);document.querySelector('[data-legend="burntArea"]')?.remove();return;}
      if(this.effisBurntAreaLayer)this.map.removeLayer(this.effisBurntAreaLayer);
      const d=date||new Date();
      this.effisBurntAreaLayer=L.tileLayer.wms(C.effisWms,{layers:C.effisBurntAreaLayer,format:'image/png',transparent:true,version:'1.1.1',time:U.dateOnlyUtc(d),opacity:.5,pane:'riskPane',attribution:'EFFIS / Copernicus'});
      this.effisBurntAreaLayer.on('tileload',()=>A.Events.emit('service',{id:'effisBurntArea',state:'ok',note:`WMS ${C.effisBurntAreaLayer} · TIME=${U.dateOnlyUtc(d)}`}));
      this.effisBurntAreaLayer.on('tileerror',()=>A.Events.emit('service',{id:'effisBurntArea',state:'error',note:'Yanmış alan WMS tile yüklenemedi'}));
      this.effisBurntAreaLayer.addTo(this.map);
      this.makeLegend('burntArea','EFFIS Yanmış Alanlar',`<div class="sourceNote">EFFIS/GWIS NRT VIIRS-tabanlı algoritmik yanmış alan/yangın poligonu. Resmî saha perimetresi değildir. EFFIS / Copernicus. ${U.dateOnlyUtc(d)}</div>`);
    }
    latestAllowedMtgSlot(){return this._mtgFrameMgr?this._mtgFrameMgr.latestAllowed():MtgFrameManager.roundToSlot(Date.now(),(C.mtgGeoColourWms.slotMinutes||10)*60*1000);}
    roundToMtgSlot(date){const ms=Number(date instanceof Date?date.getTime():date),slot=(C.mtgGeoColourWms.slotMinutes||10)*60*1000;return MtgFrameManager.roundToSlot(ms,slot);}
    async probeMtgTime(iso){
      const wms=C.mtgGeoColourWms,bbox=wms.probeBbox||'35,26,43,46',u=`${wms.url}?SERVICE=WMS&VERSION=${wms.version}&REQUEST=GetMap&LAYERS=${wms.layer}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&BBOX=${bbox}&WIDTH=64&HEIGHT=64&CRS=EPSG:4326&TIME=${encodeURIComponent(iso)}`;
      try{
        const r=await fetch(u,{signal:AbortSignal.timeout(12000)});
        const ct=(r.headers.get('content-type')||'').toLowerCase();
        if(!r.ok)return ct.includes('text/html')||ct.includes('application/json')?'invalid':'no-frame';
        if(ct.startsWith('image/'))return'image';
        return ct.includes('text/html')||ct.includes('application/json')?'invalid':'no-frame';
      }catch(e){return'network';}
    }
    createMtgLayer(date){
      const wms=C.mtgGeoColourWms,mm=this;
      const mgr=this._mtgFrameMgr=new MtgFrameManager(wms,{
        start:(iso)=>{A.Events.emit('service',{id:'mtg',state:'loading',note:`MTG GeoColour · frame ${mtgFmt(iso)} yükleniyor`});mm.updateMtgLegend();},
        ok:(iso)=>{mm.mtgDisplayedTime=iso;A.Events.emit('service',{id:'mtg',state:'ok',count:null,note:`Bağlı · Frame: ${mtgFmt(iso)}${iso!==mgr.lastUserTime?` · İstenen: ${mtgFmt(mgr.lastUserTime)}`:''}`});mm.updateMtgLegend();},
        backfill:(req,target,n)=>{A.Events.emit('service',{id:'mtg',state:'backfill',note:`Gecikmeli frame · İstenen: ${mtgFmt(mgr.lastUserTime||req)} · ${mtgFmt(target)} deneniyor (${n}/${mgr.maxBack})`});mgr.applyBackfill(target);mm.mtgLayer.setParams({time:target});mm.updateMtgLegend();},
        exhausted:(req,n)=>{A.Events.emit('service',{id:'mtg',state:'no-frame',note:`Arşivde görüntü yok · ${mtgFmt(req)} (${n} slot tarandı)`});mm.updateMtgLegend();},
        invalid:(req)=>{A.Events.emit('service',{id:'mtg',state:'error',note:'Geçersiz WMS yanıtı · kaynak görüntü döndürmüyor'});},
        network:(req)=>{A.Events.emit('service',{id:'mtg',state:'error',note:'WMS bağlantı hatası'})},
        probe:(iso)=>mm.probeMtgTime(iso)
      });
      const iso=mgr.normalize(date).toISOString(),opacity=U.clamp(Number(localStorage.getItem('mtgOpacity'))||wms.defaultOpacity,.3,1);
      const layer=L.tileLayer.wms(wms.url,{layers:wms.layer,format:wms.format,transparent:true,version:wms.version,crs:L.CRS?L.CRS.EPSG4326:null,time:iso,opacity,pane:'mtgPane',attribution:wms.attribution});
      layer.on('tileloadstart',e=>{e.tile.dataset.frameSeq=String(mgr.frameSeq);});
      layer.on('tileload',e=>mgr.tileLoad(Number(e.tile.dataset.frameSeq)));
      layer.on('tileerror',e=>mgr.tileError(Number(e.tile.dataset.frameSeq)));
      mgr.applyUserTime(iso);
      this.mtgLayer=layer;this.mtgRequestedTime=iso;this.mtgDisplayedTime=null;
      return layer;
    }
    toggleMtg(show,date){
      if(!show){clearTimeout(this._mtgDebounceT);this._mtgFrameMgr?.dispose();if(this.mtgLayer)this.map.removeLayer(this.mtgLayer);document.querySelector('[data-legend="mtg"]')?.remove();return;}
      if(!this.mtgLayer)this.createMtgLayer(date||new Date()).addTo(this.map);
      else if(!this.map.hasLayer(this.mtgLayer))this.map.addLayer(this.mtgLayer);
      this.setMtgTime(date||new Date());
      this.makeLegend('mtg','EUMETSAT MTG-I GeoColour',this.mtgLegendBody());
    }
    setMtgTime(date){
      if(!this.mtgLayer||!this._mtgFrameMgr)return;
      const mgr=this._mtgFrameMgr,iso=mgr.normalize(this.roundToMtgSlot(date)).toISOString();
      if(iso===mgr.lastUserTime)return;
      clearTimeout(this._mtgDebounceT);
      this._mtgDebounceT=setTimeout(()=>{
        mgr.applyUserTime(iso);
        this.mtgLayer.setParams({time:iso});
        this.mtgRequestedTime=iso;
        this.updateMtgLegend();
      },200);
    }
    mtgLegendBody(){
      const mgr=this._mtgFrameMgr,req=mgr?.lastUserTime,disp=mgr?.displayedTime,lines=[`${C.mtgGeoColourWms.source} · gerçek uydu görüntüsü (model değil).`];
      if(req&&disp&&req!==disp)lines.push(`Seçilen: ${mtgFmt(req)}<br>Uydu karesi: ${mtgFmt(disp)}`);
      else if(disp)lines.push(`Uydu karesi: ${mtgFmt(disp)}`);
      else if(req)lines.push(`Seçilen: ${mtgFmt(req)} · yükleniyor`);
      if(mgr&&mgr.lastUserTime&&mgr.lastUserTime>=mgr.latestAllowed().toISOString())lines.push('Uydu görüntüsü: son mevcut gerçek frame.');
      return `<div class="sourceNote">${lines.join('<br>')}</div>`;
    }
    updateMtgLegend(){const legend=document.querySelector('[data-legend="mtg"]');if(legend)legend.querySelector('.legendBody').innerHTML=this.mtgLegendBody();}
    setFootprint(events, show=true){
      this.footprintLayer.clearLayers();
      if(this.map.hasLayer(this.footprintLayer))this.map.removeLayer(this.footprintLayer);
      document.querySelector('[data-legend="footprint"]')?.remove();
      if(!show||!events?.length)return;
      for(const ev of events){
        if(!ev.members?.length)continue;
        for(const m of ev.members){
          if(!Number.isFinite(m.scan)||!Number.isFinite(m.track)||m.scan<=0||m.track<=0)continue;
          const scan=m.scan, track=m.track;
          const kmPerLat=110.574, kmPerLon=111.32*Math.cos(m.lat*Math.PI/180);
          const halfLon=Math.max(0.0005,scan/2/kmPerLon);
          const halfLat=Math.max(0.0005,track/2/kmPerLat);
          L.rectangle([[m.lat-halfLat, m.lon-halfLon],[m.lat+halfLat, m.lon+halfLon]],{
            pane:'riskPane',color:'rgba(255,100,50,0.35)',weight:0.5,fillColor:'rgba(255,80,40,0.08)',fillOpacity:0.12,interactive:false
          }).addTo(this.footprintLayer);
        }
      }
      this.footprintLayer.addTo(this.map);
      this.makeLegend('footprint','Piksel Ayak İzi',`<div class="legendLine"><i style="background:rgba(255,80,40,0.2);border:1px solid rgba(255,100,50,0.5)"></i><span>Her tespitin VIIRS/MODIS piksel boyutu (scan×track)</span></div><div class="sourceNote">Yalnızca olay üyesi tespitler için; piksel boyutu uydu açısına göre değişir.</div>`);
    }
    toggleFootprint(show){
      if(show){if(!this.map.hasLayer(this.footprintLayer))this.footprintLayer.addTo(this.map);}else{if(this.map.hasLayer(this.footprintLayer))this.map.removeLayer(this.footprintLayer);document.querySelector('[data-legend="footprint"]')?.remove();}
    }
    setThermalEnvelope(events, show=true){
      this.thermalEnvelopeLayer.clearLayers();
      if(this.map.hasLayer(this.thermalEnvelopeLayer))this.map.removeLayer(this.thermalEnvelopeLayer);
      document.querySelector('[data-legend="thermal"]')?.remove();
      if(!show||!events?.length)return;
      let count=0;
      for(const ev of events){
        const members=(ev.members||[]).filter(m=>Number.isFinite(m.lat)&&Number.isFinite(m.lon));
        if(members.length<2)continue;
        const maxTi=members.reduce((mx,m)=>Math.max(mx,Number(m.brightTi4)||0,Number(m.brightTi5)||0),0);
        if(maxTi<=0)continue;
        const hull=U.convexHull2D(members);
        if(hull.length<3)continue;
        const hue=maxTi>360?30:maxTi>320?15:0;
        const light=U.clamp(55+(maxTi-300)*0.3,35,75);
        const coords=hull.map(p=>[p.lat,p.lon]);
        coords.push(coords[0]);
        L.polygon(coords,{
          pane:'firePane',color:`hsl(${hue},90%,${light}%)`,weight:2,fillColor:`hsl(${hue},85%,${light+8}%)`,fillOpacity:0.18,interactive:false
        }).addTo(this.thermalEnvelopeLayer);
        count++;
      }
      if(count){
        this.thermalEnvelopeLayer.addTo(this.map);
        this.makeLegend('thermal','Tahmini Termal Yayılım',`<div class="legendLine"><i style="background:hsl(0,90%,45%);opacity:0.5"></i><span>Düşük (&lt;320 K)</span></div><div class="legendLine"><i style="background:hsl(15,90%,55%);opacity:0.5"></i><span>Orta (320-360 K)</span></div><div class="legendLine"><i style="background:hsl(30,90%,65%);opacity:0.5"></i><span>Yüksek parlama (&gt;360 K)</span></div><div class="sourceNote">Uydu termal tespitlerinden türetilen yaklaşık alandır. Resmî yangın perimetresi değildir. BRIGHT_TI4/TI5 parlaklık sıcaklığına göre renklendirilmiştir. Geometri piksel boyutundan (scan×track) değil tespit konumları dışbükey zarfından hesaplanır.</div>`);
      }
    }
    toggleThermalEnvelope(show){
      if(show){if(!this.map.hasLayer(this.thermalEnvelopeLayer))this.thermalEnvelopeLayer.addTo(this.map);}else{if(this.map.hasLayer(this.thermalEnvelopeLayer))this.map.removeLayer(this.thermalEnvelopeLayer);document.querySelector('[data-legend="thermal"]')?.remove();}
    }
    setEventEvolution(events, show=true){
      this.evolutionLayer.clearLayers();
      if(this.map.hasLayer(this.evolutionLayer))this.map.removeLayer(this.evolutionLayer);
      document.querySelector('[data-legend="evolution"]')?.remove();
      if(!show||!events?.length)return;
      let count=0;
      for(const ev of events){
        if(!ev.members||ev.members.length<2)continue;
        const sorted=[...ev.members].sort((a,b)=>Date.parse(a.detectedAt)-Date.parse(b.detectedAt));
        const path=sorted.map(m=>[m.lat,m.lon]);
        if(path.length<2)continue;
        const age=U.ageHours(ev.latestDetectedAt);
        const opacity=age<=6?0.7:age<=12?0.5:0.3;
        L.polyline(path,{pane:'riskPane',color:'#ff6b35',weight:2,opacity,dashArray:'4 5',interactive:false}).addTo(this.evolutionLayer);
        const oldest=sorted[0],newest=sorted[sorted.length-1];
        L.circleMarker([oldest.lat,oldest.lon],{pane:'riskPane',radius:3,color:'#aaa',weight:1,fillColor:'#fff',fillOpacity:0.5,interactive:false}).addTo(this.evolutionLayer);
        L.circleMarker([newest.lat,newest.lon],{pane:'riskPane',radius:3,color:'#ff6b35',weight:1.5,fillColor:'#ff6b35',fillOpacity:0.8,interactive:false}).addTo(this.evolutionLayer);
        count++;
      }
      if(count){
        this.evolutionLayer.addTo(this.map);
        this.makeLegend('evolution','Olay Evrim İzi',`<div class="legendLine"><i style="background:#ff6b35;height:2px;border-top:2px dashed #ff6b35"></i><span>Zaman sıralı tespit yolu</span></div><div class="legendLine"><span>○</span><span>En eski tespit</span></div><div class="legendLine"><span>●</span><span>En yeni tespit</span></div><div class="sourceNote">Yalnızca ≥2 tespiti olan olaylar için. Çizgi yangın yayılma yönünü göstermez.</div>`);
      }
    }
    toggleEventEvolution(show){
      if(show){if(!this.map.hasLayer(this.evolutionLayer))this.evolutionLayer.addTo(this.map);}else{if(this.map.hasLayer(this.evolutionLayer))this.map.removeLayer(this.evolutionLayer);document.querySelector('[data-legend="evolution"]')?.remove();}
    }
    firesDetectionTooltip(f,history,reference){
      const out=[`<strong>NASA FIRMS termal tespiti</strong>`];
      const src=U.escapeHtml(f.product||f.source||'');if(src)out.push(src);
      if(Number.isFinite(Number(f.frp)))out.push(`FRP: ${U.round(Number(f.frp),2)} MW`);
      const h=history&&history.records?history:{count:0,first:null,last:null,window48:false};
      if(h.count===1){out.push('Bölgedeki tek uydu tespiti');}
      else{
        const first=h.first?U.formatTrShortDateTime(new Date(h.first)):null;
        const last=h.last?U.formatTrShortDateTime(new Date(h.last)):null;
        if(first)out.push(`${h.window48?'Son 48 saatte ilk uydu tespiti':'İlk uydu tespiti'}: ${first}`);
        if(last)out.push(`Son uydu tespiti: ${last}`);
      }
      const age=U.formatAgeSince(h.last||f.detectedAt,reference);
      if(age)out.push(`Son tespit yaşı: ${age}`);
      if(h.count>1)out.push(`Bölgedeki tespit: ${h.count}`);
      return out.join('<br>');
    }
    firesEventTooltip(ev,history,reference){
      const out=[`<strong>Yangın olayı kümesi</strong>`,`${ev.count} FIRMS termal tespiti`,`Maks. FRP: ${U.round(ev.maxFrp,1)} MW`];
      const h=history&&history.records?history:{count:0,first:null,last:null,window48:false};
      if(h.count===1){out.push('Bölgedeki tek uydu tespiti');}
      else{
        const first=h.first?U.formatTrShortDateTime(new Date(h.first)):null;
        const last=h.last?U.formatTrShortDateTime(new Date(h.last)):null;
        if(first)out.push(`${h.window48?'Son 48 saatte ilk uydu tespiti':'İlk uydu tespiti'}: ${first}`);
        if(last)out.push(`Son uydu tespiti: ${last}`);
      }
      const age=U.formatAgeSince(h.last||ev.latestDetectedAt,reference);
      if(age)out.push(`Son tespit yaşı: ${age}`);
      if(h.count>1)out.push(`Bölgedeki tespit: ${h.count}`);
      return out.join('<br>');
    }
    substationIcon(){return L.divIcon({className:'substationIconWrap',html:'<span class="substationSquare"></span>',iconSize:[10,10],iconAnchor:[5,5]});}
    riskSubstationIcon(){return L.divIcon({className:'substationIconWrap',html:'<span class="substationSquare substation-risk"></span>',iconSize:[10,10],iconAnchor:[5,5]});}
    substationRenderData(data){
      const country=C.activeCountryCode,bounds=this.map.getBounds().pad(.12),candidates=(data.features||[]).filter(f=>{const c=f.geometry?.coordinates;return f.properties?.countryCode===country&&c&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&U.insideRegion({lat:c[1],lon:c[0]})&&bounds.contains([c[1],c[0]]);});
      const limit=this.zoom()<7?1800:6000;if(candidates.length<=limit)return{...data,features:candidates};
      const size=this.map.getSize(),cell=Math.max(6,Math.sqrt(Math.max(1,size.x*size.y)/limit)),cells=new Map();
      for(const feature of candidates.slice().sort((a,b)=>String(a.properties?.assetId||'').localeCompare(String(b.properties?.assetId||'')))){const c=feature.geometry.coordinates,p=this.map.latLngToContainerPoint([c[1],c[0]]),key=`${Math.floor(p.x/cell)}:${Math.floor(p.y/cell)}`;if(!cells.has(key))cells.set(key,feature);}
      return{...data,features:[...cells.values()]};
    }
    refreshSubstationLayer(){const data=this.gridData.get('substations'),layer=this.gridLayers.get('substations');if(!data||!layer||!this.map.hasLayer(layer))return;this.map.removeLayer(layer);this.gridLayers.delete('substations');this.setGridGroup('substations',data,true);}
    async setGridGroup(key,data,show){
      if(data)this.gridData.set(key,data);
      if(this.gridLayers.has(key)){const layer=this.gridLayers.get(key);if(show&&!this.map.hasLayer(layer))layer.addTo(this.map);if(!show&&this.map.hasLayer(layer))this.map.removeLayer(layer);this.updateGridLegend();return;}
      if(!show||!data)return;
      const cfg=C.gridSources[key],country=C.activeCountryCode,countryFilter=f=>{if(f.properties?.countryCode!==country)return false;if(key==='substations'){const c=f.geometry?.coordinates;return c&&U.insideRegion({lat:c[1],lon:c[0]});}const coords=f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[];return coords.some(line=>line.some(c=>U.insideRegion({lat:c[1],lon:c[0]})));};
      const renderData=key==='substations'?this.substationRenderData(data):data;
      let layer;
      if(key==='substations')layer=L.geoJSON(renderData,{filter:countryFilter,pane:'gridPane',pointToLayer:(f,latlng)=>L.marker(latlng,{pane:'gridPane',icon:this.substationIcon(f.properties)}),onEachFeature:(f,l)=>{l.bindTooltip(this.gridTooltip(f.properties,true),{sticky:true});l.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:e.latlng.lat,lon:e.latlng.lng,gridFeature:{kind:'substation',properties:f.properties,geometry:f.geometry}});});}});
      else layer=L.geoJSON(renderData,{filter:countryFilter,pane:'gridPane',style:()=>({pane:'gridPane',renderer:this.renderer,color:cfg.color,weight:cfg.weight,opacity:key==='400'?.84:.78}),onEachFeature:(f,l)=>{l.bindTooltip(this.gridTooltip(f.properties,false),{sticky:true});l.on('mouseover',()=>l.setStyle({weight:cfg.weight+1,opacity:1,color:cfg.color}));l.on('mouseout',()=>l.setStyle({weight:cfg.weight,opacity:key==='400'?.84:.78,color:cfg.color}));l.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:e.latlng.lat,lon:e.latlng.lng,gridFeature:{kind:'line',group:key,properties:f.properties,geometry:f.geometry}});});}});
      this.gridLayers.set(key,layer);layer.addTo(this.map);this.updateGridLegend();
    }
    gridTooltip(p,isSub){const actual=U.formatVoltage(p.actualVoltageKv)||'Bilinmiyor',title=isSub?'Trafo Merkezi':'İletim Hattı',label=p.name||p.ref||p.displayLabel||(isSub?'Tanımsız OSM trafo merkezi':'Tanımsız OSM hattı'),rows=[`<strong>${title}</strong>`,U.escapeHtml(label)];if(!isSub)rows.push(`Şebeke sınıfı: ${U.escapeHtml(p.displayClass||`${p.gridClass} kV sınıfı`)}`);rows.push(`Gerçek OSM gerilimi: ${U.escapeHtml(actual)}`);if(p.ref)rows.push(`Referans: ${U.escapeHtml(p.ref)}`);if(p.operator)rows.push(`Operatör: ${U.escapeHtml(p.operator)}`);rows.push('<small>OpenStreetMap / ODbL 1.0</small>');return rows.join('<br>');}
    hideAllGrid(){for(const layer of this.gridLayers.values())if(this.map.hasLayer(layer))this.map.removeLayer(layer);this.updateGridLegend();}
    updateGridLegend(){const active=[...this.gridLayers.entries()].filter(([,l])=>this.map.hasLayer(l)).map(([k])=>k);document.querySelector('[data-legend="grid"]')?.remove();if(!active.length)return;this.makeLegend('grid',`İletim Şebekesi · ${A.activeCountry().nameTr}`,`${active.map(k=>`<div class="legendLine"><i style="background:${C.gridSources[k].color}"></i><span>${C.gridSources[k].label}${k==='400'?' — Kırmızı':k==='154'?' — Siyah':''}</span></div>`).join('')}<div class="sourceNote">OpenStreetMap power-grid · ODbL 1.0. Gerçek OSM gerilimi tooltipte ayrıca gösterilir.</div>`);}
    riskSubstationCandidates(analyses){const selected=new Map();for(const a of analyses||[]){const s=a.nearest?.substation,props=s?.feature?.props||{};if((a.event&&!U.insideRegion({lat:a.event.lat,lon:a.event.lon}))||(props.countryCode&&props.countryCode!==C.activeCountryCode)||!s||!Number.isFinite(s.distanceKm)||s.distanceKm>C.substationRiskDisplayDistanceKm)continue;const key=props.assetId||s.feature?.id||s.key;if(!key)continue;const old=selected.get(key);if(!old||Number(a.riskScore||0)>Number(old.riskScore||0))selected.set(key,{...a,substation:s});}return[...selected.values()];}
    setFireImpacts(analyses,show=true){this.riskLayer.clearLayers();this.riskAssetLayer.clearLayers();document.querySelector('[data-legend="risk"]')?.remove();if(!show)return;let rendered=false;for(const a of analyses||[]){if(!U.insideRegion({lat:a.event.lat,lon:a.event.lon}))continue;const c=U.riskColor(a.riskBand?.level||'watch');if(a.riskBand&&a.riskScore>=20){const r=U.clamp(7+(100-a.riskScore)*-.015+a.event.count*.25,7,15);L.circleMarker([a.event.lat,a.event.lon],{pane:'riskPane',renderer:this.renderer,radius:r,color:c,weight:a.riskScore>=75?3:2,fill:false,opacity:.95,interactive:false}).addTo(this.riskLayer);rendered=true;}if(a.riskScore>=55){const l=a.nearest?.line;if(l){L.polyline([[l.feature.a.lat,l.feature.a.lon],[l.feature.b.lat,l.feature.b.lon]],{pane:'riskPane',color:'#fff',weight:8,opacity:.55,interactive:false}).addTo(this.riskAssetLayer);L.polyline([[l.feature.a.lat,l.feature.a.lon],[l.feature.b.lat,l.feature.b.lon]],{pane:'riskPane',color:c,weight:5,opacity:.95,interactive:false}).addTo(this.riskAssetLayer);rendered=true;}}}
      for(const a of this.riskSubstationCandidates(analyses)){const s=a.substation,c=U.riskColor(a.riskBand?.level||'watch');L.marker([s.feature.lat,s.feature.lon],{pane:'riskPane',icon:this.riskSubstationIcon(),interactive:false}).addTo(this.riskAssetLayer);rendered=true;}
      if(rendered)this.makeLegend('risk','Yangın–Şebeke Öncelik Skoru',`${C.riskScoreBands.map(b=>`<div class="legendLine"><i class="dot" style="background:${U.riskColor(b.level)}"></i><span>${b.min}+ · ${b.label}</span></div>`).join('')}<div class="legendLine"><span class="substationSquare substation-risk" style="display:inline-block"></span><span>≤${C.substationRiskDisplayDistanceKm} km trafo merkezi (kare)</span></div><div class="sourceNote">Hat vurgusu 55+ risk skorunda; en yakın TM işareti ise risk skorundan bağımsız olarak en fazla ${C.substationRiskDisplayDistanceKm} km'de gösterilir. Aynı TM en yüksek riskli olaya göre tekilleştirilir. <strong>Arıza olasılığı veya resmî güvenlik mesafesi değildir.</strong></div>`);}
  }
  A.MapManager=MapManager;
  A.MtgFrameManager=MtgFrameManager;
})(window.AtmoApp);
