(function(A){
  const U=A.Utils,C=A.CONFIG;
  function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
  function metadata(state){return{app:C.appName,version:C.appVersion,exportedAt:new Date().toISOString(),domain:C.regionBounds,selectedTime:state.selectedTime?.toISOString?.()||null,fireSource:'NASA FIRMS',smokeSource:'CAMS European Air Quality via Open-Meteo',weatherSource:'Open-Meteo',gridSource:'OpenStreetMap power-grid export supplied by user',gridAttribution:'© OpenStreetMap contributors / ODbL 1.0',clustering:C.fireClustering,warning:'Fire-event clusters, distance bands, downwind sectors and risk scores are operational screening aids, not official safety distances, fire perimeters, smoke trajectories or outage probabilities.'};}
  A.ExportManager={
    csv(state){
      const rows=[['eventId','latestDetectedAt','lat','lon','hotspotCount','maxFrp_MW','riskScore','riskLevel','nearestGridKm','nearestAsset','voltage','downwindAlignment','affectedLines10km','affectedSubstations10km']];
      for(const a of state.fireImpacts||[]){const l=a.nearest?.line,s=a.nearest?.substation,useLine=l&&(!s||l.distanceKm<=s.distanceKm),obj=useLine?l:s,props=useLine?l?.feature.props:s?.feature.props;rows.push([a.event.id,a.event.latestDetectedAt,a.event.lat,a.event.lon,a.event.count,U.round(a.event.maxFrp,2),a.riskScore,a.riskBand?.label||'',a.minDistanceKm!=null?U.round(a.minDistanceKm,3):'',useLine?'line':s?'substation':'',props?.voltage||props?.voltageGroup||'',a.downwindAlignment?'yes':'no',a.affectedLines?.length||0,a.affectedSubstations?.length||0]);}
      const text=rows.map(r=>r.map(U.csvEscape).join(',')).join('\r\n');U.download(`turkey_wildfire_grid_risk_${stamp()}.csv`,'text/csv;charset=utf-8','\ufeff'+text);
    },
    json(state){U.download(`turkey_wildfire_grid_risk_${stamp()}.json`,'application/json',JSON.stringify({metadata:metadata(state),fires:state.fireData||[],fireEvents:state.fireEvents||[],fireGridImpacts:state.fireImpacts||[],smokeLayer:{variable:state.smokeVariable,data:state.smokeData||[]},wildfirePm10Summary:state.wildfireSummaryData||[],wind:{level:state.windLevel,data:state.windData||[]},selectedPoint:state.selectedPoint||null},null,2));},
    geojson(state){
      const features=[];for(const e of state.fireEvents||[])features.push({type:'Feature',geometry:{type:'Point',coordinates:[e.lon,e.lat]},properties:{kind:'FIRMS_fire_event_cluster',eventId:e.id,hotspotCount:e.count,maxFrp:e.maxFrp,sumFrp:e.sumFrp,latestDetectedAt:e.latestDetectedAt,earliestDetectedAt:e.earliestDetectedAt}});for(const p of state.smokeData||[])if(Number.isFinite(p.value))features.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lon,p.lat]},properties:{kind:'model_sample',variable:p.variable,value:p.value,unit:p.unit,validAt:p.validAt,source:p.source,resolutionKm:p.resolutionKm}});U.download(`turkey_wildfire_grid_risk_${stamp()}.geojson`,'application/geo+json',JSON.stringify({type:'FeatureCollection',metadata:metadata(state),features},null,2));
    }
  };
})(window.AtmoApp);
