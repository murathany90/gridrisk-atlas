import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION='3.3.1';
const PREFERRED_PORT=Number(process.env.PORT||8890);
let ACTIVE_PORT=PREFERRED_PORT;
const FIRMS_MAP_KEY=process.env.FIRMS_MAP_KEY||'';
const TURKEY={west:25.60,south:35.75,east:44.90,north:42.20};
const cache=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.md':'text/markdown; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const allowedSources=new Set(['VIIRS_NOAA21_NRT','VIIRS_NOAA20_NRT','VIIRS_SNPP_NRT','MODIS_NRT']);
const BROWSER_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36';
const ALLOWED_ATHUB_HOSTS=new Set(['portal.atmohub.gr']);
const PRIVATE_IPS=[/^127\./,/^10\./,/^172\.(1[6-9]|2\d|3[01])\./,/^192\.168\./,/^169\.254\./,/^0\./,/^224\./,/^::1$/,/^fc00:/,/^fe80:/];
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
function validTurkeyBbox(s){const a=bboxArray(s);return !!a&&a[0]>=TURKEY.west&&a[1]>=TURKEY.south&&a[2]<=TURKEY.east&&a[3]<=TURKEY.north&&a[0]<a[2]&&a[1]<a[3];}
async function firmsProxy(req,res,url){
  if(!FIRMS_MAP_KEY)return send(res,401,JSON.stringify({error:'FIRMS_MAP_KEY is not set on server'}),'application/json; charset=utf-8');
  const bbox=url.searchParams.get('bbox')||'',source=url.searchParams.get('source')||'VIIRS_NOAA21_NRT',days=Math.max(1,Math.min(5,Number(url.searchParams.get('days')||2)));
  if(!validTurkeyBbox(bbox))return send(res,400,JSON.stringify({error:'bbox must stay inside the Turkey operational extent'}),'application/json; charset=utf-8');if(!allowedSources.has(source))return send(res,400,JSON.stringify({error:'Invalid source'}),'application/json; charset=utf-8');
  const target=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(FIRMS_MAP_KEY)}/${source}/${bbox}/${days}`,key=`firms:${source}:${bbox}:${days}`,hit=cache.get(key);if(hit&&Date.now()<hit.expires)return send(res,200,hit.text,'text/csv; charset=utf-8');
  for(let attempt=0;attempt<=2;attempt++){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),18000);
    try{
      const r=await fetch(target,{signal:ctrl.signal,headers:{Accept:'text/csv','User-Agent':'Turkey-Wildfire-Grid-Risk-Monitor/3.0'}});
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
function absUrl(base,src){try{return new URL(src,base).href;}catch{return null;}}
function isPrivateHost(url){
  if(PRIVATE_IPS.some(p=>p.test(url.hostname)))return true;
  if(url.hostname==='localhost'||url.hostname==='localhost.localdomain'||url.hostname==='127.0.0.1'||url.hostname==='0.0.0.0')return true;
  return false;
}
function validateUpstreamUrl(raw,allowedHosts=ALLOWED_ATHUB_HOSTS){
  let url;try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'&&url.protocol!=='http:')return null;
  if(url.username||url.password)return null;
  if(isPrivateHost(url))return null;
  if(allowedHosts&&!allowedHosts.has(url.hostname))return null;
  return url.href;
}
async function fetchLimited(url,maxBytes=5_000_000,accept='text/html,application/javascript,text/css,*/*'){
  const validated=validateUpstreamUrl(url);if(!validated)throw new Error('UPSTREAM_URL_REJECTED');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),15000);try{const r=await fetch(validated,{signal:ctrl.signal,redirect:'follow',headers:{'User-Agent':BROWSER_UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9,el;q=0.8','Referer':'https://portal.atmohub.gr/'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const ct=r.headers.get('content-type')||'',finalUrl=r.url;if(r.redirected&&finalUrl!==validated&&!validateUpstreamUrl(finalUrl,null))throw new Error('UPSTREAM_REDIRECT_REJECTED');const reader=r.body.getReader();let total=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){reader.cancel();throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');}chunks.push(value);}const txt=Buffer.concat(chunks).toString('utf-8');return{text:txt,status:r.status,contentType:ct,finalUrl};}finally{clearTimeout(timer);}}
function classifyCandidate(url){const u=String(url).toLowerCase();if(/wms|geoserver|service=wms|getmap/.test(u))return'WMS';if(/wmts|tile|\{z\}|\{x\}|\{y\}/.test(u))return'TILE';if(/smoke|wildfire|forest.?fire|fire_smoke|biomass/.test(u))return'SMOKE/FIRE';if(/\.json(?:\?|$)|geojson|\/api\//.test(u))return'DATA/API';if(/\.png|\.webp|\.jpg|\.tif|\.tiff|\.nc(?:\?|$)/.test(u))return'RASTER/FILE';return'ENDPOINT';}
function extractCandidates(text,sourceUrl){
  const found=new Map(),push=(raw)=>{if(!raw)return;let v=String(raw).trim().replaceAll('\\/','/').replace(/&amp;/g,'&');if(v.length<4||v.length>900)return;if(/^(data:|blob:|javascript:|#)/i.test(v))return;let url=null;try{if(/^https?:\/\//i.test(v))url=new URL(v).href;else if(/^\/\//.test(v))url='https:'+v;else if(/^(\/|\.\/|\.\.\/)/.test(v))url=new URL(v,sourceUrl).href;else if(/^(api|geoserver|wms|wmts|tiles?|forecast|smoke|wildfire|fire)[\/_-]/i.test(v))url=new URL(v,sourceUrl).href;}catch{}if(!url)return;if(!/^https?:\/\//i.test(url))return;const low=url.toLowerCase();if(!/(api|wms|wmts|geoserver|tile|smoke|wildfire|forest|fire|forecast|pm10|pm2|aerosol|\.json|\.geojson|\.png|\.webp|\.tif|\.tiff|\.nc)/i.test(low))return;found.set(url,{url,kind:classifyCandidate(url),source:sourceUrl});};
  for(const m of text.matchAll(/https?:\\?\/\\?\/[^"'`\s<>\\)]+/gi))push(m[0]);
  for(const m of text.matchAll(/["'`]((?:\/|\.\/|\.\.\/)[^"'`\s]{1,500})["'`]/g))push(m[1]);
  for(const m of text.matchAll(/(?:baseURL|url|endpoint|wms|wmts|tiles?|api)["'`\s:=,(]+(["'`])([^"'`]{3,600})\1/gi))push(m[2]);
  return [...found.values()];
}
async function validateAtmoHubCandidates(candidates){
  const work=candidates.slice(0,18).filter(item=>!/[{}<>]|%7B|%7D/i.test(item.url));
  const results=await Promise.all(work.map(async item=>{const url=item.url,ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),5500);try{const r=await fetch(url,{signal:ctrl.signal,redirect:'follow',headers:{'User-Agent':BROWSER_UA,'Referer':'https://portal.atmohub.gr/','Accept':'application/json,application/geo+json,text/csv,application/xml,text/xml,image/*,*/*'}});if(!r.ok)return null;const ct=String(r.headers.get('content-type')||'').toLowerCase(),cors=r.headers.get('access-control-allow-origin')||'';let kind=item.kind;if(/image\//.test(ct))return{url:r.url,status:r.status,contentType:ct,cors:!!cors,kind:kind==='ENDPOINT'?'RASTER':kind,schemaHint:false};const text=(await r.text()).slice(0,160000),jsonLike=/json|geo\+json|csv/.test(ct)||/^\s*[\[{]/.test(text),wmsLike=/xml/.test(ct)&&/WMS_Capabilities|WMT_MS_Capabilities/i.test(text),schemaHint=/smoke|wildfire|forest.?fire|pm10|aerosol|biomass/i.test(text);if(jsonLike||wmsLike||schemaHint)return{url:r.url,status:r.status,contentType:ct||'unknown',cors:!!cors,kind:wmsLike?'WMS':kind,schemaHint};return null;}catch{return null;}finally{clearTimeout(timer);}}));
  return results.filter(Boolean).slice(0,12);
}
async function atmohubDiscovery(req,res,url){
  const force=url.searchParams.get('force')==='1',key='atmohub-discovery-v32',hit=cache.get(key);if(!force&&hit&&Date.now()<hit.expires)return send(res,200,JSON.stringify(hit.data),'application/json; charset=utf-8');
  const pageUrls=['https://portal.atmohub.gr/','https://portal.atmohub.gr/mtg-true-color','https://portal.atmohub.gr/erimiki-skoni'],pages=[],assets=[],errors=[],candidateMap=new Map();
  try{
    const assetSet=new Set();
    const pageResults=await Promise.all(pageUrls.map(async page=>{try{return{page,r:await fetchLimited(page,1_500_000)}}catch(e){return{page,error:e}}}));
    for(const pr of pageResults){if(pr.error){errors.push({url:pr.page,error:String(pr.error.message||pr.error)});continue;}const r=pr.r;pages.push({url:pr.page,status:r.status,contentType:r.contentType});for(const c of extractCandidates(r.text,r.finalUrl||pr.page))candidateMap.set(c.url,c);for(const m of r.text.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)){const u=absUrl(r.finalUrl||pr.page,m[1]);if(u&&/^https?:/.test(u)&&/\.(?:js|mjs|css)(?:\?|$)/i.test(u))assetSet.add(u);}}
    const assetUrls=[...assetSet].slice(0,20),assetResults=await Promise.all(assetUrls.map(async assetUrl=>{try{return{assetUrl,r:await fetchLimited(assetUrl,6_000_000)}}catch(e){return{assetUrl,error:e}}}));
    for(const ar of assetResults){if(ar.error){errors.push({url:ar.assetUrl,error:String(ar.error.message||ar.error)});continue;}const r=ar.r;assets.push({url:ar.assetUrl,status:r.status,contentType:r.contentType});for(const c of extractCandidates(r.text,r.finalUrl||ar.assetUrl))candidateMap.set(c.url,c);}
    const candidates=[...candidateMap.values()].sort((a,b)=>{const score=x=>/SMOKE|FIRE/.test(x.kind)?0:/WMS|DATA/.test(x.kind)?1:/TILE|RASTER/.test(x.kind)?2:3;return score(a)-score(b);}).slice(0,120),verified=await validateAtmoHubCandidates(candidates);const data={portalStatus:pages.length?'reachable':'unreachable',pages,pagesScanned:pages.length,assets,assetsScanned:assets.length,candidates,verified,errors,verifiedPublicDataApi:verified.some(x=>['DATA/API','WMS','SMOKE/FIRE'].includes(x.kind)),note:verified.length?'Aday servisler HTTP/içerik düzeyinde doğrulandı; veri şeması, lisans ve kullanım koşulları ayrıca incelenmelidir.':'Portal ve bundle varlıkları tarandı; public smoke/fire veri servisi kesin olarak doğrulanmadı.'};cache.set(key,{data,expires:Date.now()+15*60*1000});return send(res,200,JSON.stringify(data),'application/json; charset=utf-8');
  }catch(e){return send(res,502,JSON.stringify({portalStatus:'unreachable',pages,assets,candidates:[],verified:[],errors:[...errors,{url:'discovery',error:String(e.message||e)}],verifiedPublicDataApi:false,error:String(e.message||e)}),'application/json; charset=utf-8');}
}
async function mtgProxy(req,res,url){
  const consumerKey=process.env.EUMETSAT_CONSUMER_KEY||'';
  const consumerSecret=process.env.EUMETSAT_CONSUMER_SECRET||'';
  if(!consumerKey||!consumerSecret){
    return send(res,501,JSON.stringify({error:'EUMETSAT credentials not configured',note:'Set EUMETSAT_CONSUMER_KEY and EUMETSAT_CONSUMER_SECRET env vars'}),'application/json; charset=utf-8');
  }
  const bbox=url.searchParams.get('bbox')||'';
  try{
    const tokenRes=await fetch('https://api.eumetsat.int/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=client_credentials&client_id=${encodeURIComponent(consumerKey)}&client_secret=${encodeURIComponent(consumerSecret)}`});
    if(!tokenRes.ok)return send(res,502,JSON.stringify({error:'EUMETSAT token request failed',detail:`HTTP ${tokenRes.status}`}),'application/json; charset=utf-8');
    const token=await tokenRes.json();
    const accessToken=token.access_token;
    if(!accessToken)return send(res,502,JSON.stringify({error:'No access_token in EUMETSAT response'}),'application/json; charset=utf-8');
    const target=`https://api.eumetsat.int/data-access/v1/products/EO:EUM:DAT:1156/collections/FIRE-PRODUCTS?format=Geometry&bbox=${encodeURIComponent(bbox)}`;
    const key=`mtg:${bbox}`,hit=cache.get(key);
    if(hit&&Date.now()<hit.expires)return send(res,200,JSON.stringify(hit.data),'application/json; charset=utf-8');
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort('timeout'),20000);
    try{
      const r=await fetch(target,{signal:ctrl.signal,headers:{'Authorization':`Bearer ${accessToken}`,'User-Agent':BROWSER_UA,'Accept':'application/json'}});
      if(!r.ok)return send(res,r.status,JSON.stringify({error:'MTG data API error',detail:`HTTP ${r.status}`}),'application/json; charset=utf-8');
      const data=await r.json();
      cache.set(key,{data,expires:Date.now()+10*60*1000});
      return send(res,200,JSON.stringify(data),'application/json; charset=utf-8');
    }finally{clearTimeout(timer);}
  }catch(e){return send(res,502,JSON.stringify({error:'MTG proxy failed',detail:String(e.message||e)}),'application/json; charset=utf-8');}
}
async function staticFile(req,res,url){let rel=decodeURIComponent(url.pathname);if(rel==='/')rel='/index.html';const target=path.normalize(path.join(__dirname,rel));if(!target.startsWith(__dirname))return send(res,403,'Forbidden');try{const data=await fs.readFile(target),ext=path.extname(target),type=mime[ext]||'application/octet-stream',cacheControl='no-store';if((ext==='.geojson'||ext==='.js'||ext==='.css')&&String(req.headers['accept-encoding']||'').includes('gzip')&&data.length>4096){const gz=gzipSync(data);res.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Cache-Control':cacheControl,'Vary':'Accept-Encoding'});return res.end(gz);}res.writeHead(200,{'Content-Type':type,'Cache-Control':cacheControl});res.end(data);}catch(e){send(res,e.code==='ENOENT'?404:500,e.code==='ENOENT'?'Not found':'Server error');}}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/health')return send(res,200,JSON.stringify({ok:true,app:'Türkiye Wildfire Grid Risk Monitor',version:APP_VERSION,port:ACTIVE_PORT,firmsProxy:!!FIRMS_MAP_KEY}),'application/json; charset=utf-8');if(url.pathname==='/api/firms')return firmsProxy(req,res,url);if(url.pathname==='/api/atmohub/discover')return atmohubDiscovery(req,res,url);if(url.pathname==='/api/mtg/active_fires')return mtgProxy(req,res,url);if(url.pathname.startsWith('/api/tiles/'))return tileProxy(req,res,url);return staticFile(req,res,url);});
function openBrowser(url){if(process.env.AUTO_OPEN!=='1')return;try{if(process.platform==='win32'){const c=spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore'});c.unref();}else if(process.platform==='darwin'){const c=spawn('open',[url],{detached:true,stdio:'ignore'});c.unref();}else{const c=spawn('xdg-open',[url],{detached:true,stdio:'ignore'});c.unref();}}catch(e){console.warn('Tarayıcı otomatik açılamadı:',e.message);}}
function listen(port,attempt=0){
  ACTIVE_PORT=port;
  const onListening=async()=>{
    server.off('error',onError);
    const actual=server.address()?.port||port;ACTIVE_PORT=Number(actual);
    const url=`http://127.0.0.1:${ACTIVE_PORT}/?build=${encodeURIComponent(APP_VERSION)}`;
    try{await fs.writeFile(path.join(__dirname,'.server-port'),String(ACTIVE_PORT),'utf8');}catch{}
    console.log('');console.log(`Türkiye Wildfire Grid Risk Monitor v${APP_VERSION}`);console.log(`Site: ${url}`);console.log(`FIRMS proxy: ${FIRMS_MAP_KEY?'enabled':'disabled (MAP_KEY not set)'}`);if(ACTIVE_PORT!==PREFERRED_PORT)console.log(`Not: ${PREFERRED_PORT} kullanımdaydı; eski sunucuya karışmamak için ${ACTIVE_PORT} seçildi.`);console.log('Kapatmak için Ctrl+C.');console.log('');openBrowser(url);
  };
  const onError=err=>{
    server.off('listening',onListening);
    if(err?.code==='EADDRINUSE'&&attempt<20){console.log(`Port ${port} kullanımda; ${port+1} deneniyor…`);setTimeout(()=>listen(port+1,attempt+1),80);return;}
    console.error('Sunucu başlatılamadı:',err);process.exitCode=1;
  };
  server.once('error',onError);server.once('listening',onListening);server.listen(port,'127.0.0.1');
}
listen(PREFERRED_PORT);
