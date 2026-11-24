/* The paper supplies the content; the original V25 controller still owns the desk. */
(async()=>{
 'use strict';
 const root=document.documentElement,loading=document.querySelector('#reader-rule-loading'),note=loading.querySelector('p');
 const D=window.V25OriginalData,q=new URL(location.href),old=window.BIBLE_DATA,asset=document.querySelector('#v25-desk-controller').getAttribute('href');
 // Decode the optional leather grain while paper data and fonts load. If it
 // misses the first shot, use matte colour throughout; never pop in late or
 // make the reader wait on decoration.
 const grainURL=document.getElementById('v25-binding-grain')?.href;
 let grainReady=false;
 if(grainURL){
  const grain=new Image();
  if(!grain.decode)grain.onload=()=>{grainReady=true;};
  grain.src=grainURL;
  grain.decode?.().then(()=>{grainReady=true;},()=>{});
 }
 const start=performance.now();
 try{
  const parts=Object.entries(D.packs);let at=0,done=0;
  async function read(k,name){let last;for(let i=0;i<3;i++){try{const r=await fetch('./paper-pages/'+name);if(!r.ok)throw Error('HTTP '+r.status);D.installPack(k,await r.json());return}catch(e){last=e;if(i!==2)await new Promise(ok=>setTimeout(ok,450*(i+1)))}}throw last}
  async function worker(){for(;;){const i=at++;if(i>=parts.length)break;await read(...parts[i]);note.textContent='正在打开纸本经文（'+(++done)+' / '+parts.length+'）。'}}
  await Promise.all(Array.from({length:6},worker));
  const meta=D.finalize(),end=D.books.at(-1)?.last;
  // Stop navigation at the last printed scripture, preserving both leaf faces
  // and the original full paper stock for the desk renderer.
  if(Number.isInteger(end)&&end>0&&end<=D.count&&meta.pages.slice(end+1).every(p=>p.blank&&p.b<0))meta.readingLastPage=end;
  let raw;try{raw=localStorage}catch{}
  let accountStorage;try{accountStorage=window.V25Account?.readerStorage(raw,meta.edition);}catch{/* Guest reading must not depend on the account service. */}
  const storage=window.makeV25PhysicalStorage(accountStorage||raw,meta,old);
  window.PAPER_READER_STORAGE=storage;storage.migrateHighlights();storage.migrateNoteHighlightIds();
  const hash=q.hash.slice(1),pv=q.searchParams.get('pdf'),ref=q.searchParams.get('ref'),book=q.searchParams.get('book'),ch=q.searchParams.get('ch');
  function route(key){if(!key)return null;if(/^\d{1,4}$/.test(key)){const p=+key;return p>0&&p<=D.count?{p:Math.min(p,meta.readingLastPage??D.count)}:null}
   const a=/^([A-Z0-9]{3})\.(\d+)(?::(\d+))?$/.exec(key);if(!a)return null;
   const b=D.books.find(b=>b.code===a[1]),r=a[2]+':'+(a[3]||1),p=a[3]?D.lookup(a[1],r):b?.chapters.find(c=>c.chapter===+a[2])?.page;
   return Number.isInteger(p)?{p,code:a[1],ref:r}:null}
  let dest=route(hash)||route(ref)||route(pv);
  if(!dest&&book){const b=D.books.find(b=>b.name===book||b.code===book);if(b)dest=route(b.code+'.'+(Number(ch)||1))}
  if(!dest&&q.searchParams.get('resume')==='paper'){try{dest=route(raw?.getItem('paper-bible:physical:reading:v1'))}catch{}}
  let saved;try{saved=JSON.parse(storage.getItem('paper-bible-position-v1'))}catch{}
  if(!dest&&!saved)dest=route('GEN.1');
  if(dest){window.PAPER_INITIAL_PAGE=dest.p;window.PAPER_INITIAL_SPREAD=dest.p&~1;if(dest.code)window.PAPER_INITIAL_REF={bookCode:dest.code,page:dest.p,ref:dest.ref}}
  const sp=(dest?.p??saved?.page??saved?.spread??9)&~1;
  window.BIBLE_DATA=meta;
  await window.PaperPage.preparePhysicalFonts([sp,sp+1]);
  if(grainReady)root.style.setProperty('--v25-binding-grain',`url(${JSON.stringify(grainURL)})`);
  note.textContent='正在打开 V25 书桌…';
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=asset;script.onload=resolve;script.onerror=()=>reject(Error('V25 书桌未载入'));document.head.append(script)});
  if(!document.querySelector('#stage[data-spread] .paper svg[data-pdf]'))throw Error('V25 书桌未就绪');
  window.PAPER_RULE_LAYOUT={edition:meta.edition,pages:meta.pages.length,durationMs:performance.now()-start};
  root.dataset.ruleLayout='ready';root.dataset.physicalEdition=D.sha;
  try{window.V25Account?.readerReady();}catch{/* An unavailable account must not close the book. */}
 }catch(e){root.dataset.ruleLayout='unavailable';loading.setAttribute('role','alert');note.textContent='纸本经文未能载入，请检查网络后重新打开。不会改用旧版分页。';console.error('V25 原纸阅读器',e)}
})();
