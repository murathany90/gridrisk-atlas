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
      const n=projected.length,area=Math.max(1,size.x*size.y),spacing=Math.sqrt(area/Math.max(1,n)),radius=U.clamp(spacing*1.35,58,150);ctx.globalCompositeOperation='source-over';
      for(const {p,pt} of projected){const alpha=U.smokeAlpha(this.variable,p.value);if(alpha<=0)continue;const [r,g,b]=U.smokeColor(this.variable,p.value),gr=ctx.createRadialGradient(pt.x,pt.y,0,pt.x,pt.y,radius);gr.addColorStop(0,`rgba(${r},${g},${b},${alpha})`);gr.addColorStop(.38,`rgba(${r},${g},${b},${alpha*.72})`);gr.addColorStop(.72,`rgba(${r},${g},${b},${alpha*.30})`);gr.addColorStop(1,`rgba(${r},${g},${b},0)`);ctx.fillStyle=gr;ctx.fillRect(pt.x-radius,pt.y-radius,radius*2,radius*2);}
    }
  }

  class MapManager{
    constructor(){this.map=null;this.renderer=null;this.baseLayer=null;this.baseKey=null;this.fireLayer=null;this.fireAll=[];this.fireVisible=[];this.fireEventsVisible=[];this.currentSelectedTime=new Date();this.frpHeat=null;this.smokeLayer=null;this.airPointLayer=null;this.airData=[];this.airVariable='pm10_wildfires';this.windLayer=null;this.windData=[];this.riskLayer=null;this.riskAssetLayer=null;this.downwindLayer=null;this.windVectorLayer=null;this.gridLayers=new Map();this.fwiLayer=null;this.effisBurntAreaLayer=null;this.onPointClick=null;this.frpThreshold=50;this._renderTimer=null;this.firePolygonLayer=null;this.firePolygonMarkerLayer=null;this.footprintLayer=null;this.thermalEnvelopeLayer=null;this.evolutionLayer=null;}
    init(onPointClick){
      this.onPointClick=onPointClick;this.map=L.map('map',{zoomControl:true,minZoom:C.mapMinZoom||2,worldCopyJump:true,preferCanvas:true}).setView(C.defaultCenter,C.defaultZoom);this.renderer=L.canvas({padding:.4});
      this.map.createPane('airPane');this.map.getPane('airPane').style.zIndex=320;this.map.createPane('fwiPane');this.map.getPane('fwiPane').style.zIndex=330;this.map.createPane('gridPane');this.map.getPane('gridPane').style.zIndex=410;this.map.createPane('riskPane');this.map.getPane('riskPane').style.zIndex=445;this.map.createPane('firePane');this.map.getPane('firePane').style.zIndex=460;this.map.createPane('windPane');this.map.getPane('windPane').style.zIndex=480;
      this.setBaseMap(localStorage.getItem('baseMap')||'satellite');this.fireLayer=L.layerGroup([], {pane:'firePane'}).addTo(this.map);this.airPointLayer=L.layerGroup([], {pane:'airPane'}).addTo(this.map);this.smokeLayer=new SmokeCanvasLayer().addTo(this.map);this.windLayer=L.layerGroup([], {pane:'windPane'});this.riskLayer=L.layerGroup([], {pane:'riskPane'}).addTo(this.map);this.riskAssetLayer=L.layerGroup([], {pane:'riskPane'}).addTo(this.map);this.downwindLayer=L.layerGroup([], {pane:'riskPane'});this.windVectorLayer=L.layerGroup([], {pane:'windPane'}).addTo(this.map);      this.borderLayer=L.polygon(C.regionPolygon,{pane:'gridPane',color:'#60a5fa',weight:1.5,fill:false,dashArray:'4 4',opacity:.55,interactive:false}).addTo(this.map);this.firePolygonLayer=L.layerGroup([],{pane:'riskPane'});this.firePolygonMarkerLayer=L.layerGroup([],{pane:'riskPane'});this.footprintLayer=L.layerGroup([],{pane:'riskPane'});this.thermalEnvelopeLayer=L.layerGroup([],{pane:'firePane'});this.evolutionLayer=L.layerGroup([],{pane:'riskPane'});
      this.map.on('click',e=>{const p={lat:e.latlng.lat,lon:e.latlng.lng};if(U.insideRegion(p))this.onPointClick?.(p);else A.Events.emit('outsideDataRegion',p);});this.map.on('zoomend moveend',()=>{if(this._renderTimer)return;const t=this.currentSelectedTime;this._renderTimer=setTimeout(()=>{this._renderTimer=null;this.renderFires(t);},60);});setTimeout(()=>this.map.invalidateSize(true),60);return this.map;
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
    setFires(data,selectedTime){this.fireAll=(data||[]).filter(U.insideRegion.bind(U));this.renderFires(selectedTime);}
    renderFires(selectedTime){
      this.currentSelectedTime=new Date(selectedTime);this.fireLayer.clearLayers();if(this.frpHeat){this.map.removeLayer(this.frpHeat);this.frpHeat=null;}const end=Math.min(this.currentSelectedTime.getTime(),Date.now()+15*60e3),start=end-24*3600e3;this.fireVisible=this.fireAll.filter(f=>{const t=Date.parse(f.detectedAt);return t>=start&&t<=end;});const allEvents=U.clusterFires(this.fireVisible);this.fireEventsVisible=allEvents.filter(ev=>ev.maxFrp>=this.frpThreshold);
      if(this.zoom()<9){for(const ev of this.fireEventsVisible){const count=ev.count,radius=U.clamp(7+Math.sqrt(count)*2.2+Math.sqrt(Math.max(0,ev.maxFrp))*0.35,8,24),opacity=U.ageOpacity(ev.latestDetectedAt,new Date(end)),m=L.circleMarker([ev.lat,ev.lon],{pane:'firePane',renderer:this.renderer,radius,color:'#fff',weight:1.2,opacity,fillColor:U.frpColor(ev.maxFrp),fillOpacity:opacity*.92});m.bindTooltip(`<strong>Yangın olayı kümesi</strong><br>${count} FIRMS termal tespiti<br>Maks. FRP: ${U.round(ev.maxFrp,1)} MW<br>Son tespit: ${U.formatLocal(new Date(ev.latestDetectedAt))}<br><small>5 km / 6 saat kümelenmiş; yangın perimetresi değildir.</small>`);if(this.zoom()<7&&count>1)m.bindTooltip(m.getTooltip().getContent()+`<br><strong>● ${count}</strong>`);m.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:ev.lat,lon:ev.lon,fire:ev.representative,fireEvent:ev});});m.addTo(this.fireLayer);}}
      else{const bounds=this.map.getBounds();const inView=this.fireVisible.filter(f=>f.frp==null||f.frp>=this.frpThreshold).filter(f=>bounds.contains([f.lat,f.lon])).sort((a,b)=>Math.abs(b.frp||0)-Math.abs(a.frp||0)).slice(0,5000);for(const f of inView){const radius=U.clamp(4+Math.sqrt(Math.max(0,f.frp||0))*1.05,4,17),opacity=U.ageOpacity(f.detectedAt,new Date(end)),m=L.circleMarker([f.lat,f.lon],{pane:'firePane',renderer:this.renderer,radius,color:'#fff',weight:1,opacity,fillColor:U.frpColor(f.frp),fillOpacity:opacity*.9});m.bindTooltip(`<strong>NASA FIRMS termal tespiti</strong><br>${U.escapeHtml(f.product)}<br>FRP: ${f.frp??'—'} MW<br>${U.formatLocal(new Date(f.detectedAt))}<br><small>Hotspot = yangın perimetresi değildir.</small>`);m.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:f.lat,lon:f.lon,fire:f});});m.addTo(this.fireLayer);}}
      A.Events.emit('firesRendered',{detections:this.fireVisible.length,events:this.fireEventsVisible.length,eventsTotal:allEvents.length});
    }
    toggleFires(show){if(show){if(!this.map.hasLayer(this.fireLayer))this.fireLayer.addTo(this.map);}else this.map.removeLayer(this.fireLayer);}
    toggleHeat(show){if(!show){if(this.frpHeat)this.map.removeLayer(this.frpHeat);return;}const candidates=this.fireVisible.filter(f=>U.insideRegion(f)&&Number.isFinite(f.frp)&&f.frp>=this.frpThreshold);const vals=candidates.map(f=>f.frp).filter(Number.isFinite).sort((a,b)=>a-b);const p95Idx=Math.floor(vals.length*0.95),p95=vals.length?Math.max(1,vals[p95Idx]):1;const pts=candidates.map(f=>[f.lat,f.lon,U.clamp(Math.log1p(f.frp)/Math.log1p(p95),0,1)]);if(this.frpHeat)this.map.removeLayer(this.frpHeat);this.frpHeat=L.heatLayer(pts,{radius:24,blur:20,maxZoom:11,max:1,pane:'riskPane'}).addTo(this.map);}
    setFirePolygons(fc,show=true){
      this.firePolygonLayer.clearLayers();this.firePolygonMarkerLayer.clearLayers();
      if(this.map.hasLayer(this.firePolygonLayer))this.map.removeLayer(this.firePolygonLayer);
      if(this.map.hasLayer(this.firePolygonMarkerLayer))this.map.removeLayer(this.firePolygonMarkerLayer);
      document.querySelector('[data-legend="firePolygon"]')?.remove();
      if(!show||!fc?.features?.length)return;
      const cfg=C.firePolygons,features=fc.features.filter(f=>f.geometry?.coordinates?.length);
      for(const f of features){
        const p=f.properties||{};
        const poly=L.geoJSON(f,{pane:'riskPane',style:{color:cfg.strokeColor,weight:cfg.strokeWeight,fillColor:cfg.fillColor,fillOpacity:cfg.fillOpacity,opacity:.7},interactive:true,pointToLayer:()=>null});
        poly.eachLayer(l=>{
          l.bindTooltip((()=>{const areaKm2=p.areaHa?`${U.round(p.areaHa/100,2)} km²`:'—';return `<strong>${U.escapeHtml(p.konum||'Yangın alanı')}</strong><br>${U.escapeHtml(p.il||'')}<br>Alan: ${areaKm2} · ${p.areaHa} ha<br>Tarih: ${p.date?U.formatLocal(new Date(p.date)):'—'}<br>Etkilenen: ${p.affectedPeople} kişi / ${p.affectedBuildings} bina<br>Kayıp: ${p.fatalities}<br><small>${cfg.source}</small>`;
          })());
          l.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:e.latlng.lat,lon:e.latlng.lng,firePolygon:f});});
        });
        this.firePolygonLayer.addLayer(poly);
      }
      const centroidLayer=L.featureGroup();
      for(const f of features){
        if(!f.geometry?.coordinates?.length)continue;
        const firstRing=((f.geometry.type==='MultiPolygon'?f.geometry.coordinates[0][0]:f.geometry.coordinates[0])||[]);
        if(!firstRing.length)continue;
        const cx=firstRing.reduce((s,c)=>s+c[0],0)/firstRing.length,cy=firstRing.reduce((s,c)=>s+c[1],0)/firstRing.length,p=f.properties||{};
        L.circleMarker([cy,cx],{pane:'riskPane',radius:6,color:cfg.markerColor,weight:2,fillColor:'#fff',fillOpacity:.8,interactive:true})
          .bindTooltip(`<strong>${U.escapeHtml(p.konum||'Yangın alanı')}</strong> · ${p.areaHa||'?'} ha<br>${p.date?U.formatLocal(new Date(p.date)):''}`)
          .addTo(this.firePolygonMarkerLayer).on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:cy,lon:cx,firePolygon:f});});
        centroidLayer.addLayer(L.circleMarker([cy,cx]));
      }
      this.firePolygonLayer.addTo(this.map);
      this.firePolygonMarkerLayer.addTo(this.map);
      this.makeLegend('firePolygon','Güncel Yangın Alanları',`<div class="legendLine"><i style="background:${cfg.fillColor};opacity:${cfg.fillOpacity+0.3}"></i><span>Yanmış alan poligonları</span></div><div class="legendLine"><i style="background:${cfg.markerColor};border-radius:50%;width:8px;height:8px;display:inline-block"></i><span>Alan merkez işareti</span></div><div class="sourceNote">${cfg.source} · toplam ${features.length} alan</div>`);
    }
    toggleFirePolygons(show){
      if(show){if(!this.map.hasLayer(this.firePolygonLayer))this.firePolygonLayer.addTo(this.map);if(!this.map.hasLayer(this.firePolygonMarkerLayer))this.firePolygonMarkerLayer.addTo(this.map);}else{if(this.map.hasLayer(this.firePolygonLayer))this.map.removeLayer(this.firePolygonLayer);if(this.map.hasLayer(this.firePolygonMarkerLayer))this.map.removeLayer(this.firePolygonMarkerLayer);}
    }
    setSmoke(data,variable,showPoints=false){this.airData=data||[];this.airVariable=variable;this.smokeLayer.setData(this.airData,variable);this.airPointLayer.clearLayers();if(showPoints)this.showSmokePoints(true);this.updateSmokeLegend(variable);}
    showSmokePoints(show){this.airPointLayer.clearLayers();if(!show)return;const meta=C.smokeVariables[this.airVariable];for(const p of this.airData){if(!Number.isFinite(p.value))continue;const [r,g,b]=U.smokeColor(this.airVariable,p.value),m=L.circleMarker([p.lat,p.lon],{pane:'airPane',renderer:this.renderer,radius:3.5,stroke:true,color:'#e6edf4',weight:.45,fillColor:`rgb(${r},${g},${b})`,fillOpacity:.78});m.bindTooltip(`${meta.label}: <strong>${U.round(p.value,2)} ${p.unit||meta.unit}</strong><br>${p.validAt?U.formatLocal(new Date(p.validAt)):'—'}<br>${p.source}<br><small>Model örnekleme noktası; bilimsel çözünürlük ~11 km.</small>`);m.addTo(this.airPointLayer);}}
    clearSmoke(){this.airData=[];this.smokeLayer.setData([],'pm10_wildfires');this.airPointLayer.clearLayers();document.querySelector('[data-legend="smoke"]')?.remove();}
    makeLegend(id,title,body){const host=document.getElementById('legendStack');host.querySelector(`[data-legend="${id}"]`)?.remove();const d=document.createElement('div');d.className='legend';d.dataset.legend=id;d.innerHTML=`<div class="legendHeader"><div class="legendTitle">${title}</div><button class="legendClose" title="Lejantı kapat">×</button></div><div class="legendBody">${body}</div>`;d.querySelector('.legendClose').addEventListener('click',()=>d.remove());host.appendChild(d);return d;}
    updateSmokeLegend(variable){const meta=C.smokeVariables[variable],ranges={pm10_wildfires:['0','1','3','8','15','30+'],wildfire_share:['0','5','15','30','50','75+'],}[variable]||[];const vals=ranges.map(x=>Number.parseFloat(x)||0),colors=vals.map(v=>{const [r,g,b]=U.smokeColor(variable,v);return `rgb(${r},${g},${b})`;});this.makeLegend('smoke',`${meta.label}${meta.unit?' · '+meta.unit:''}`,`<div class="gradient" style="background:linear-gradient(90deg,${colors.join(',')})"></div><div class="legendScale">${ranges.map(x=>`<span>${x}</span>`).join('')}</div><div class="sourceNote">${meta.source} · ${meta.resolution}${meta.surface?' · yüzeye yakın':''}<br><strong>Sürekli plume görünümü görsel interpolasyondur; modelin ~11 km bilimsel çözünürlüğünü artırmaz.</strong></div>`);}
    setWind(data,level){this.windData=data||[];this.windLayer.clearLayers();for(const p of this.windData){if(!Number.isFinite(p.speed)||!Number.isFinite(p.direction))continue;const icon=L.divIcon({className:'',html:`<div class="windArrow" style="transform:rotate(${p.direction}deg)">↑</div>`,iconSize:[18,18],iconAnchor:[9,9]});const m=L.marker([p.lat,p.lon],{pane:'windPane',icon,interactive:true});m.bindTooltip(`${C.windLevels[level]?.label||level}<br>${U.round(p.speed,1)} km/h · ${Math.round(p.direction)}° ${U.cardinal(p.direction)}<br>${p.validAt?U.formatLocal(new Date(p.validAt)):'—'}`);m.addTo(this.windLayer);}}
    toggleWind(show){if(show){if(!this.map.hasLayer(this.windLayer))this.windLayer.addTo(this.map);}else if(this.map.hasLayer(this.windLayer))this.map.removeLayer(this.windLayer);}
    drawWindVector(point,direction,speed,level='10m'){this.windVectorLayer.clearLayers();if(!Number.isFinite(direction)||!Number.isFinite(speed))return;const downwind=(direction+180)%360,end=U.destination(point,downwind,U.clamp(speed*.7,12,45));L.polyline([[point.lat,point.lon],[end.lat,end.lon]],{pane:'windPane',color:'#6dd5fa',weight:3,dashArray:'8 6',opacity:.9}).addTo(this.windVectorLayer).bindTooltip(`Aşağı-rüzgâr yön göstergesi · ${C.windLevels[level]?.label||level}<br>Bu çizgi duman yörüngesi değildir.`);L.circleMarker([end.lat,end.lon],{pane:'windPane',radius:5,color:'#6dd5fa',fillColor:'#6dd5fa',fillOpacity:1}).addTo(this.windVectorLayer);}
    clearWindVector(){this.windVectorLayer.clearLayers();}
    setDownwindCorridors(analyses,show=true){
      this.downwindLayer.clearLayers();
      if(this.map.hasLayer(this.downwindLayer))this.map.removeLayer(this.downwindLayer);
      document.querySelector('[data-legend="downwind"]')?.remove();
      if(!show)return;
      let count=0;
      for(const a of analyses||[]){
        if(count>=C.downwind.maxCorridors||!a.wind||a.riskScore<35||!Number.isFinite(a.downwindDirection)||!U.insideRegion({lat:a.event.lat,lon:a.event.lon}))continue;
        const center={lat:a.event.lat,lon:a.event.lon},pts=[[center.lat,center.lon]],steps=10;
        for(let i=0;i<=steps;i++){
          const bearing=a.downwindDirection-C.downwind.halfAngleDeg+(2*C.downwind.halfAngleDeg*i/steps),p=U.destination(center,bearing,C.downwind.distanceKm);
          pts.push([p.lat,p.lon]);
        }
        pts.push([center.lat,center.lon]);
        const c=U.riskColor(a.riskBand.level),dw=a.downwindAssets||{lines:[],substations:[]};
        const poly=L.polygon(pts,{pane:'riskPane',color:c,weight:1.2,opacity:.58,fillColor:c,fillOpacity:.10,interactive:true});
        poly.bindTooltip(`Rüzgâr bazlı izleme koridoru · ${C.downwind.distanceKm} km<br>${U.round(a.wind.speed,1)} km/h · taşıma yönü ${Math.round(a.downwindDirection)}°<br>Koridorda: <strong>${dw.lines.length} hat / ${dw.substations.length} TM</strong><br><strong>Duman tahmini değildir.</strong>`);
        poly.addTo(this.downwindLayer);
        for(const x of dw.lines.slice(0,4))L.polyline([[x.feature.a.lat,x.feature.a.lon],[x.feature.b.lat,x.feature.b.lon]],{pane:'riskPane',color:'#7be6ff',weight:4,opacity:.78,dashArray:'5 4',interactive:false}).addTo(this.downwindLayer);
        for(const x of dw.substations.slice(0,4))L.circleMarker([x.feature.lat,x.feature.lon],{pane:'riskPane',radius:7,color:'#7be6ff',weight:2,fillColor:'#0a2531',fillOpacity:.75,interactive:false}).addTo(this.downwindLayer);
        count++;
      }
      if(count){
        this.downwindLayer.addTo(this.map);
        this.makeLegend('downwind','Rüzgâr Bazlı İzleme Koridoru',`<div class="legendLine"><i style="background:#7be6ff"></i><span>Koridordaki şebeke varlığı</span></div><div class="sourceNote">Yangın olayından ${C.downwind.distanceKm} km, ±${C.downwind.halfAngleDeg}° sektör. Rüzgâr alanını operasyonel tarama için kullanır; gerçek duman yörüngesi değildir.</div>`);
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
      this.makeLegend('burntArea','EFFIS Yanmış Alanlar',`<div class="sourceNote">GWIS NRT yanmış alan poligonları (VIIRS termal anomali kümelerinden türetilmiştir). Resmî yangın perimetresi olarak kullanılabilir. EFFIS / Copernicus. ${U.dateOnlyUtc(d)}</div>`);
    }
    setFootprint(events, show=true){
      this.footprintLayer.clearLayers();
      if(this.map.hasLayer(this.footprintLayer))this.map.removeLayer(this.footprintLayer);
      if(!show||!events?.length)return;
      for(const ev of events){
        if(!ev.members?.length)continue;
        for(const m of ev.members){
          const scan=m.scan||1, track=m.track||1;
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
      if(show){if(!this.map.hasLayer(this.footprintLayer))this.footprintLayer.addTo(this.map);}else{if(this.map.hasLayer(this.footprintLayer))this.map.removeLayer(this.footprintLayer);}
    }
    setThermalEnvelope(events, show=true){
      this.thermalEnvelopeLayer.clearLayers();
      if(this.map.hasLayer(this.thermalEnvelopeLayer))this.map.removeLayer(this.thermalEnvelopeLayer);
      if(!show||!events?.length)return;
      let count=0;
      for(const ev of events){
        const members=(ev.members||[]).filter(m=>Number.isFinite(m.lat)&&Number.isFinite(m.lon));
        if(members.length<2)continue;
        const validTemps=members.filter(m=>m.brightTi4!=null||m.brightTi5!=null);
        const maxTi=validTemps.reduce((mx,m)=>Math.max(mx,m.brightTi5??m.brightTi4??0),0);
        if(maxTi<=0)continue;
        const hull=U.convexHull2D(members);
        if(hull.length<3)continue;
        const hue=U.clamp(30-(maxTi-290)*2,0,30);
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
        this.makeLegend('thermal','Tahmini Termal Yayılım',`<div class="legendLine"><i style="background:hsl(30,90%,65%);opacity:0.5"></i><span>Yüksek parlama (&gt;360 K)</span></div><div class="legendLine"><i style="background:hsl(15,90%,55%);opacity:0.5"></i><span>Orta (320-360 K)</span></div><div class="legendLine"><i style="background:hsl(0,90%,45%);opacity:0.5"></i><span>Düşük (&lt;320 K)</span></div><div class="sourceNote">Uydu termal tespitlerinden türetilen yaklaşık alandır. Resmî yangın perimetresi değildir. BRIGHT_TI4/TI5 parlaklık sıcaklığına göre renklendirilmiştir. Geometri piksel boyutundan (scan×track) değil tespit konumları dışbükey zarfından hesaplanır.</div>`);
      }
    }
    toggleThermalEnvelope(show){
      if(show){if(!this.map.hasLayer(this.thermalEnvelopeLayer))this.thermalEnvelopeLayer.addTo(this.map);}else{if(this.map.hasLayer(this.thermalEnvelopeLayer))this.map.removeLayer(this.thermalEnvelopeLayer);}
    }
    setEventEvolution(events, show=true){
      this.evolutionLayer.clearLayers();
      if(this.map.hasLayer(this.evolutionLayer))this.map.removeLayer(this.evolutionLayer);
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
      if(show){if(!this.map.hasLayer(this.evolutionLayer))this.evolutionLayer.addTo(this.map);}else{if(this.map.hasLayer(this.evolutionLayer))this.map.removeLayer(this.evolutionLayer);}
    }
    substationIcon(props){const raw=String(props?.voltage||'').split(/[;,]/).map(Number).filter(Number.isFinite),max=Math.max(0,...raw);const cls=max>=300000?'tm400':max>=66000?'tm154':'tmOther';return L.divIcon({className:'tmIconWrap',html:`<span class="tmIcon ${cls}">◆</span>`,iconSize:[18,18],iconAnchor:[9,9]});}
    async setGridGroup(key,data,show){if(this.gridLayers.has(key)){const layer=this.gridLayers.get(key);if(show&&!this.map.hasLayer(layer))layer.addTo(this.map);if(!show&&this.map.hasLayer(layer))this.map.removeLayer(layer);this.updateGridLegend();return;}if(!show)return;const cfg=C.gridSources[key],trFilter=f=>{if(key==='substations'){const c=f.geometry?.coordinates;return c&&U.insideRegion({lat:c[1],lon:c[0]});}const coords=f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[];return coords.some(line=>line.some(c=>U.insideRegion({lat:c[1],lon:c[0]})));};let layer;if(key==='substations')layer=L.geoJSON(data,{filter:trFilter,pane:'gridPane',pointToLayer:(f,latlng)=>L.marker(latlng,{pane:'gridPane',icon:this.substationIcon(f.properties)}),onEachFeature:(f,l)=>{l.bindTooltip(this.gridTooltip(f.properties,true));l.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:e.latlng.lat,lon:e.latlng.lng,gridFeature:{kind:'substation',properties:f.properties,geometry:f.geometry}});});}});else layer=L.geoJSON(data,{filter:trFilter,pane:'gridPane',style:()=>({pane:'gridPane',renderer:this.renderer,color:cfg.color,weight:cfg.weight,opacity:(key==='400'?0.82:0.76)}),onEachFeature:(f,l)=>{l.bindTooltip(this.gridTooltip(f.properties,false),{sticky:true});l.on('click',e=>{L.DomEvent.stopPropagation(e);this.onPointClick?.({lat:e.latlng.lat,lon:e.latlng.lng,gridFeature:{kind:'line',group:key,properties:f.properties,geometry:f.geometry}});});}});this.gridLayers.set(key,layer);layer.addTo(this.map);this.updateGridLegend();}
    gridTooltip(p,isSub){return `<strong>${isSub?'Trafo Merkezi':'İletim Hattı'}</strong><br>${U.escapeHtml(p.name||'Adsız OSM elemanı')}<br>Gerilim: ${U.escapeHtml(p.voltage||p.voltageGroup||'bilinmiyor')}<br>${U.escapeHtml(p.operator||'Operatör bilgisi yok')}<br><small>OSM / ODbL</small>`;}
    hideAllGrid(){for(const layer of this.gridLayers.values())if(this.map.hasLayer(layer))this.map.removeLayer(layer);this.updateGridLegend();}
    updateGridLegend(){const active=[...this.gridLayers.entries()].filter(([,l])=>this.map.hasLayer(l)).map(([k])=>k);document.querySelector('[data-legend="grid"]')?.remove();if(!active.length)return;this.makeLegend('grid','İletim Şebekesi · OSM',`${active.map(k=>`<div class="legendLine"><i style="background:${C.gridSources[k].color}"></i><span>${C.gridSources[k].label}</span></div>`).join('')}<div class="sourceNote">OSM power-grid dışa aktarımı · yalnız hatlar ve trafo merkezleri. Katman varsayılan kapalıdır.</div>`);}
    setFireImpacts(analyses,show=true){this.riskLayer.clearLayers();this.riskAssetLayer.clearLayers();document.querySelector('[data-legend="risk"]')?.remove();if(!show)return;for(const a of analyses||[]){if(!a.riskBand||a.riskScore<20||!U.insideRegion({lat:a.event.lat,lon:a.event.lon}))continue;const c=U.riskColor(a.riskBand.level),r=U.clamp(7+(100-a.riskScore)*-.015+a.event.count*.25,7,15);L.circleMarker([a.event.lat,a.event.lon],{pane:'riskPane',renderer:this.renderer,radius:r,color:c,weight:a.riskScore>=75?3:2,fill:false,opacity:.95,interactive:false}).addTo(this.riskLayer);if(a.riskScore>=55){const l=a.nearest?.line,s=a.nearest?.substation;if(l){L.polyline([[l.feature.a.lat,l.feature.a.lon],[l.feature.b.lat,l.feature.b.lon]],{pane:'riskPane',color:'#fff',weight:8,opacity:.55,interactive:false}).addTo(this.riskAssetLayer);L.polyline([[l.feature.a.lat,l.feature.a.lon],[l.feature.b.lat,l.feature.b.lon]],{pane:'riskPane',color:c,weight:5,opacity:.95,interactive:false}).addTo(this.riskAssetLayer);}if(s)L.circleMarker([s.feature.lat,s.feature.lon],{pane:'riskPane',radius:9,color:'#fff',weight:3,fillColor:c,fillOpacity:.9,interactive:false}).addTo(this.riskAssetLayer);}}
      if((analyses||[]).some(x=>x.riskScore>=20))this.makeLegend('risk','Yangın–Şebeke Öncelik Skoru',`${C.riskScoreBands.map(b=>`<div class="legendLine"><i class="dot" style="background:${U.riskColor(b.level)}"></i><span>${b.min}+ · ${b.label}</span></div>`).join('')}<div class="sourceNote">Mesafe + FRP + tespit yaşı + gerilim/TM önemi; rüzgâr mevcutsa doğrultu katkısı. <strong>Arıza olasılığı veya resmî güvenlik mesafesi değildir.</strong></div>`);}
  }
  A.MapManager=MapManager;
})(window.AtmoApp);
