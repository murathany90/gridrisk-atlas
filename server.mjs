import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION='3.13.2';
const PREFERRED_PORT=Number(process.env.PORT||8890);
let ACTIVE_PORT=PREFERRED_PORT;
const FIRMS_MAP_KEY=process.env.FIRMS_MAP_KEY||'';
const COUNTRY_BOUNDS={TR:{west:25.6,south:35.75,east:44.9,north:42.2},ES:{west:-9.3,south:36,east:4.35,north:43.8},FR:{west:-5.14,south:41.36,east:9.57,north:51.1},PT:{west:-9.52,south:36.96,east:-6.18,north:42.16},IT:{west:6.62,south:35.49,east:18.52,north:47.1},GR:{west:19.373345,south:34.802874,east:29.643806,north:41.748741}};
const cache=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.md':'text/markdown; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const allowedSources=new Set(['VIIRS_NOAA21_NRT','VIIRS_NOAA20_NRT','VIIRS_SNPP_NRT','MODIS_NRT']);
const BROWSER_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36';
const tileProviders={
  satellite:{template:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',referer:'https://www.arcgis.com/'},
  osm:{template:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',referer:'https://www.openstreetmap.org/'},
  positron:{template:'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',referer:'https://carto.com/'},
  dark:{template:'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',referer:'https://carto.com/'},
  topo:{template:'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',referer:'https://opentopomap.org/'}
};
const tileCache=new Map();
function tileCacheSet(k,v){tileCache.set(k,{...v,expires:Date.now()+20*60*1000});while(tileCache.size>350)tileCache.delete(tileCache.keys().next().value);}
async function tileProxy(req,res,url){
  const m=url.pathname.match(/^\/api\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)$/i);if(!m)return send(res,404,'Unknown tile route');
  const [,provider,zs,xs,ys]=m,cfg=tileProviders[provider];if(!cfg)return send(res,404,'Unknown tile provider');const z=Number(zs),x=Number(xs),y=Number(ys);if(!Number.isInteger(z)||z<0||z>20||!Number.isInteger(x)||!Number.isInteger(y))return send(res,400,'Invalid tile');
  const target=cfg.template.replace('{z}',z).replace('{x}',x).replace('{y}',y),key=`tile:${provider}:${z}:${x}:${y}`,hit=tileCache.get(key);if(hit&&Date.now()<hit.expires){res.writeHead(200,{'Content-Type':hit.type,'Cache-Control':'public, max-age=600','X-Tile-Proxy':'cache'});return res.end(hit.data);}
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{const r=await fetch(target,{signal:ctrl.signal,headers:{'User-Agent':BROWSER_UA,'Referer':cfg.referer,'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}});if(!r.ok)return send(res,r.status,`Tile upstream HTTP ${r.status}`);const data=Buffer.from(await r.arrayBuffer()),type=r.headers.get('content-type')||'image/png';tileCacheSet(key,{data,type});res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=600','X-Tile-Proxy':'live'});res.end(data);}catch(e){send(res,502,`Tile upstream failed: ${String(e.message||e)}`);}finally{clearTimeout(timer);}
}
function send(res,status,body,type='text/plain; charset=utf-8',headers={}){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',...headers});res.end(body);}
function bboxArray(s){const a=String(s||'').split(',').map(Number);return a.length===4&&a.every(Number.isFinite)?a:null;}
function validCountryBbox(s,countryCode){const a=bboxArray(s),bounds=COUNTRY_BOUNDS[countryCode];return !!a&&!!bounds&&a[0]>=bounds.west&&a[1]>=bounds.south&&a[2]<=bounds.east&&a[3]<=bounds.north&&a[0]<a[2]&&a[1]<a[3];}
async function firmsProxy(req,res,url){
  if(!FIRMS_MAP_KEY)return send(res,401,JSON.stringify({error:'FIRMS_MAP_KEY is not set on server'}),'application/json; charset=utf-8');
  const countryCode=String(url.searchParams.get('country')||'TR').toUpperCase(),bbox=url.searchParams.get('bbox')||'',source=url.searchParams.get('source')||'VIIRS_NOAA21_NRT',days=Math.max(1,Math.min(5,Number(url.searchParams.get('days')||2)));
  if(!validCountryBbox(bbox,countryCode))return send(res,400,JSON.stringify({error:'bbox must stay inside the selected country operational extent'}),'application/json; charset=utf-8');if(!allowedSources.has(source))return send(res,400,JSON.stringify({error:'Invalid source'}),'application/json; charset=utf-8');
  const target=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(FIRMS_MAP_KEY)}/${source}/${bbox}/${days}`,key=`firms:${countryCode}:${source}:${bbox}:${days}`,hit=cache.get(key);if(hit&&Date.now()<hit.expires)return send(res,200,hit.text,'text/csv; charset=utf-8');
  for(let attempt=0;attempt<=2;attempt++){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),18000);
    try{
      const r=await fetch(target,{signal:ctrl.signal,headers:{Accept:'text/csv','User-Agent':`GridRisk-Atlas/${APP_VERSION}`}});
      if(r.status===429){const retryAfter=Number(r.headers.get('retry-after')||30);clearTimeout(timer);if(attempt<2&&retryAfter<60){await new Promise(r=>setTimeout(r,Math.min(retryAfter*1000,5000)+Math.random()*500));continue;}return send(res,429,JSON.stringify({error:'FIRMS rate limited',retryAfter}),'application/json; charset=utf-8');}
      if(!r.ok&&attempt<2&&r.status>=500){clearTimeout(timer);await new Promise(r=>setTimeout(r,750*(attempt+1)+Math.random()*500));continue;}
      const text=await r.text();if(!r.ok)return send(res,r.status,text||`FIRMS HTTP ${r.status}`);cache.set(key,{text,expires:Date.now()+7*60*1000});return send(res,200,text,'text/csv; charset=utf-8');
    }catch(e){
      clearTimeout(timer);
      if(ctrl.signal.reason==='timeout'&&attempt<2){await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
      return send(res,502,JSON.stringify({error:'FIRMS upstream failed',detail:String(e.message||e)}),'application/json; charset=utf-8');
    }finally{clearTimeout(timer);}
  }
}
async function staticFile(req,res,url){let rel=decodeURIComponent(url.pathname);if(rel==='/')rel='/index.html';const target=path.normalize(path.join(__dirname,rel));if(!target.startsWith(__dirname))return send(res,403,'Forbidden');try{const data=await fs.readFile(target),ext=path.extname(target),type=mime[ext]||'application/octet-stream',cacheControl='no-store';if((ext==='.geojson'||ext==='.js'||ext==='.css')&&String(req.headers['accept-encoding']||'').includes('gzip')&&data.length>4096){const gz=gzipSync(data);res.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Cache-Control':cacheControl,'Vary':'Accept-Encoding'});return res.end(gz);}res.writeHead(200,{'Content-Type':type,'Cache-Control':cacheControl});res.end(data);}catch(e){send(res,e.code==='ENOENT'?404:500,e.code==='ENOENT'?'Not found':'Server error');}}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/health')return send(res,200,JSON.stringify({ok:true,app:'GridRisk Atlas',version:APP_VERSION,port:ACTIVE_PORT,firmsProxy:!!FIRMS_MAP_KEY}),'application/json; charset=utf-8');if(url.pathname==='/api/firms')return firmsProxy(req,res,url);if(url.pathname.startsWith('/api/tiles/'))return tileProxy(req,res,url);return staticFile(req,res,url);});
function openBrowser(url){if(process.env.AUTO_OPEN!=='1')return;try{if(process.platform==='win32'){const c=spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore'});c.unref();}else if(process.platform==='darwin'){const c=spawn('open',[url],{detached:true,stdio:'ignore'});c.unref();}else{const c=spawn('xdg-open',[url],{detached:true,stdio:'ignore'});c.unref();}}catch(e){console.warn('Tarayıcı otomatik açılamadı:',e.message);}}
function listen(port,attempt=0){
  ACTIVE_PORT=port;
  const onListening=async()=>{
    server.off('error',onError);
    const actual=server.address()?.port||port;ACTIVE_PORT=Number(actual);
    const url=`http://127.0.0.1:${ACTIVE_PORT}/?build=${encodeURIComponent(APP_VERSION)}`;
    try{await fs.writeFile(path.join(__dirname,'.server-port'),String(ACTIVE_PORT),'utf8');}catch{}
    console.log('');console.log(`GridRisk Atlas v${APP_VERSION}`);console.log(`Site: ${url}`);console.log(`FIRMS proxy: ${FIRMS_MAP_KEY?'enabled':'disabled (MAP_KEY not set)'}`);if(ACTIVE_PORT!==PREFERRED_PORT)console.log(`Not: ${PREFERRED_PORT} kullanımdaydı; eski sunucuya karışmamak için ${ACTIVE_PORT} seçildi.`);console.log('Kapatmak için Ctrl+C.');console.log('');openBrowser(url);
  };
  const onError=err=>{
    server.off('listening',onListening);
    if(err?.code==='EADDRINUSE'&&attempt<20){console.log(`Port ${port} kullanımda; ${port+1} deneniyor…`);setTimeout(()=>listen(port+1,attempt+1),80);return;}
    console.error('Sunucu başlatılamadı:',err);process.exitCode=1;
  };
  server.once('error',onError);server.once('listening',onListening);server.listen(port,'127.0.0.1');
}
listen(PREFERRED_PORT);
