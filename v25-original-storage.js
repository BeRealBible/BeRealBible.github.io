/* Keep V25 annotations on the same passage after switching from rules-3 to print pagination.
   All original keys remain intact. Never reuse a page number as a scripture address. */
(function(){
 'use strict';
 window.makeV25PhysicalStorage=function(raw,d,legacy){
  const suffix=':'+d.edition,ram=new Map(),prev=[':rules-3',':rules-2',':rules-1',''];
  const get=k=>{try{return ram.has(k)?ram.get(k):raw?.getItem(k)??null}catch{return null}};
  const write=(k,v)=>{ram.set(k,v);try{raw?.setItem(k,v);if(raw)ram.delete(k)}catch{}};
  const parse=r=>{try{return JSON.parse(r)}catch{return null}},position='paper-bible-position-v1',trail='paper-bible-reading-history-v1';
  const find=(code,ref)=>{const n=window.V25OriginalData.lookup(code,ref);return Number.isInteger(n)&&n>=1?n:null};
  const book=b=>d.books.find(v=>v.code===b||v.name===b);
  const relocate=o=>{if(!o)return null;const b=book(o.bookCode)||book(o.bookName),pg=b&&(o.ref?find(b.code,o.ref):b.first);return Number.isInteger(pg)?{...o,bookCode:b.code,bookName:b.name,page:pg}:null};
  function read(k){
   const direct=get(k+suffix);if(direct!==null)return direct;
   if(k!==position&&k!==trail)return null;
   for(const ver of prev){const old=parse(get(k+ver));if(!old)continue;
    if(k===position){let loc=relocate(old);if(!loc&&!ver&&legacy?.pages){const pg=legacy.pages[old.page??(old.spread+1)];loc=pg&&relocate({bookName:legacy.books?.[pg.b]?.name,ref:pg.start})}
     if(!loc)continue;const p={...loc,spread:loc.page&~1,edition:d.edition,explicitRef:!!loc.ref};const v=JSON.stringify(p);write(k+suffix,v);return v;
    }
    if(!Array.isArray(old.items))continue;const items=old.items.map(relocate).filter(Boolean);
    const v=JSON.stringify({...old,activeId:items.some(it=>it.id===old.activeId)?old.activeId:null,items});write(k+suffix,v);return v;
   }return null;
  }
  function migrateHighlights(){
   if(!raw||get('v25-saved-ink-migration-v2'+suffix))return;
   const groups=new Map();let count=0;try{count=raw.length}catch{return}
   const sorted=Array.from({length:count},(_,i)=>raw.key(i)).filter(k=>k?.startsWith('paper-bible-highlights-v1:')&&!k.endsWith(suffix)).sort();
   for(const key of sorted){
    const m=/^(paper-bible-highlights-v1:([A-Z0-9]{3}):(\d+):\d+:\d+(?:[-–]\d+)?:\d+:\d+(?:[-–]\d+)?)(~mark~(.+?)|~used)?(:rules-[123])?$/.exec(key);
    if(!m||m[4]==='~used')continue;
    const ver=m[6]||'',keyBase=m[1]+ver;let row=groups.get(keyBase);
    if(!row){row={book:m[2],idx:+m[3],version:ver,base:m[1],ids:new Set()};groups.set(keyBase,row)}
    if(!m[5]){const ids=parse(get(key));if(Array.isArray(ids))for(const id of ids)row.ids.add(id)}
    else if(get(key)==='1')row.ids.add(m[5]);
   }
   if(!groups.size){if(raw)write('v25-saved-ink-migration-v2'+suffix,'0');return}
   const source=window.BIBLE_SOURCE,oldRules=window.PaperLayout.paginate(source),idx=window.PaperTextSelection.indexFace;
   const norm=t=>String(t??'').normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
   let recovered=0,unmatched=0;const C=new Map();
   function nativeUnits(p){if(!C.has(p)){const page=d.pages[p],commands=window.PaperPage.commands(page,p,d.books);C.set(p,idx(page,commands.filter(c=>c.role!=='footer-rule')).units)}return C.get(p)}
   for(const r of groups.values()){
    const active=[...r.ids].filter(id=>get(r.base+'~mark~'+id+r.version)!=='0');if(!active.length)continue;
    const old=r.version?oldRules:legacy,p=old?.pages?.[r.idx];if(!p||old.books?.[p.b]?.code!==r.book){unmatched+=active.length;continue}
    const oldUnits=idx(p,window.V25LegacyPage.commands(p,r.idx,old.books).filter(c=>c.role!=='footer-rule')).units;
    for(const id of active){const u=oldUnits.find(v=>v.id===id),ref=u&&/^verse:(\d+):(\d+)/.exec(u.group);
     if(!ref){unmatched++;continue}
     const b=book(r.book),fp=find(b.code,ref[1]+':'+ref[2]);if(fp===null){unmatched++;continue}
     const rawVerse=source.books.find(b=>b.code===r.book)?.chapters[+ref[1]-1]?.verses?.find(z=>z[0]===+ref[2])?.[1];
     const whole=!!rawVerse&&norm(rawVerse)===norm(u.text), text=norm(u.text);let ok=false;
     for(let pn=Math.max(b.first,fp-1);pn<=Math.min(b.last,fp+2);pn++){
      const np=d.pages[pn];if(!np||np.b<0)continue;
      for(const nu of nativeUnits(pn)){if(nu.group!==u.group||(!whole&&!(norm(nu.text)&&text.includes(norm(nu.text)))))continue;
       const key=['paper-bible-highlights-v1',r.book,pn,np.start||'',np.end||''].join(':');
       if(get(key+'~mark~'+nu.id+suffix)===null)write(key+'~mark~'+nu.id+suffix,'1');write(key+'~used'+suffix,'1');ok=true;
      }
     }if(ok)recovered++;else unmatched++;
    }
   }
   write('v25-saved-ink-migration-v2'+suffix,JSON.stringify({recovered,unmatched,originalsPreserved:true}));
  }
  return {getItem:read,setItem:(k,v)=>write(k+suffix,String(v)),removeItem:k=>write(k+suffix,'null'),migrateHighlights};
 };
})();
