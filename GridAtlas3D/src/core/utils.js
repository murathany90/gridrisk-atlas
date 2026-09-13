// GridAtlas 3D v0.4 — src/core/utils.js
// Faz 1: v0.3 tek dosyanin moduler karsiligi. Davranis korunur, gorsel degisiklik yok.
// CONFIG
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const PHASES=['A','B','C'];
function toast(text,error=false){const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=text;$('#toast-stack').append(el);setTimeout(()=>el.remove(),error?6500:3500);}
function time(t=Date.now()){return new Date(t).toLocaleTimeString('tr-TR',{hour12:false});}
function normalize(text){return text.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function esc(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function bayName(a){return a.bayLabel||a.bay;}
// Dugum anahtari: 'assetId:port' (topoloji, akis ve SLD senkronunda ortak kimlik).
const node = (id, p) => id + ':' + p;

export { $, $$, PHASES, toast, time, normalize, clamp, esc, bayName, node };
