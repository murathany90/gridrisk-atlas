"""Rebuild compact Turkey transmission-grid layers from an OSM Power Grid Tools GeoJSON export.
Usage: python tools/build_grid_from_osm.py path/to/osm-power-grid.geojson
Only line/minor_line and substation are retained. No mock features are created.
"""
import json,sys,os
from pathlib import Path
B=(25.60,35.75,44.90,42.20)
if len(sys.argv)<2: raise SystemExit('GeoJSON path required')
src=Path(sys.argv[1]);out=Path(__file__).resolve().parents[1]/'data'
with src.open(encoding='utf-8') as f:d=json.load(f)
def rc(x):
    if isinstance(x,list):
        if len(x)>=2 and all(isinstance(v,(int,float)) for v in x[:2]):return [round(x[0],5),round(x[1],5)]+x[2:]
        return [rc(v) for v in x]
    return x
def bbox(g):
    pts=[]
    def walk(x):
        if isinstance(x,list) and len(x)>=2 and isinstance(x[0],(int,float)):pts.append(x[:2])
        elif isinstance(x,list):
            for y in x:walk(y)
    walk(g.get('coordinates',[]));return (min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)) if pts else None
def hit(bb):return bb and not(bb[2]<B[0] or bb[0]>B[2] or bb[3]<B[1] or bb[1]>B[3])
g={'400':[],'154':[],'33':[],'unknown':[]};subs=[]
for f in d.get('features',[]):
 p=f.get('properties',{});et=p.get('elementType');geom=f.get('geometry') or {};bb=p.get('bbox') or bbox(geom)
 if not hit(bb):continue
 tags=p.get('tags') or {};props={k:v for k,v in {'id':p.get('id'),'osmId':p.get('osmId'),'elementType':et,'name':p.get('name') or tags.get('name'),'operator':p.get('operator') or tags.get('operator'),'voltage':p.get('voltageRaw') or tags.get('voltage'),'voltageGroup':p.get('voltageGroup') or 'unknown','circuits':p.get('circuits') or tags.get('circuits'),'cables':p.get('cables') or tags.get('cables'),'frequency':p.get('frequency') or tags.get('frequency'),'source':'OpenStreetMap / user-provided export'}.items() if v not in (None,'',[])}
 if et in ('line','minor_line') and geom.get('type') in ('LineString','MultiLineString'):
  vg=props.get('voltageGroup','unknown');key='400' if vg in ('300-500kV','>500kV') else '154' if vg=='66-300kV' else '33' if vg in ('20-66kV','<20kV') else 'unknown';g[key].append({'type':'Feature','geometry':{'type':geom['type'],'coordinates':rc(geom['coordinates'])},'properties':props})
 elif et=='substation':
  c=p.get('center') or ([(bb[0]+bb[2])/2,(bb[1]+bb[3])/2] if bb else None)
  if c and B[0]<=c[0]<=B[2] and B[1]<=c[1]<=B[3]:subs.append({'type':'Feature','geometry':{'type':'Point','coordinates':[round(c[0],5),round(c[1],5)]},'properties':props})
meta={'source':'OpenStreetMap power-grid export supplied by user','country':'TR','bbox':B,'license':'ODbL 1.0','attribution':'© OpenStreetMap contributors'}
for key,fts in g.items():(out/f'grid_{key}.geojson').write_text(json.dumps({'type':'FeatureCollection','metadata':{**meta,'layer':key,'featureCount':len(fts)},'features':fts},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(out/'substations.geojson').write_text(json.dumps({'type':'FeatureCollection','metadata':{**meta,'layer':'substations','featureCount':len(subs)},'features':subs},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print({k:len(v) for k,v in g.items()},'substations',len(subs))
