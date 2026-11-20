/* V25 retains its original desk, gestures and 480×704 page surface; still and
   curling faces use the same original physical ink boxes, not replaid text. */
(() => {
  'use strict';
  const root=window,old=root.PaperPage,W=480,H=704;
  if(!old)throw Error('Install the physical adapter after PaperPage');
  root.V25LegacyPage=old;
  const special=new Map([['𬸊','PaperGlyph2CE0A'],['𣎴','PaperGlyph233B4'],['𮙋','PaperGlyph2E64B']]);
  const FAMILY='"SimSun","Songti SC","Noto Serif CJK SC","PaperSerif","PaperRares",serif',ink='#29251f';
  // Raw print data deliberately remains resident for synchronous turns. Bound
  // derived layout objects separately: a WeakMap would never release models
  // while the corresponding page arrays are held by the physical repository.
  const ctx=document.createElement('canvas').getContext('2d'),metrics=new Map(),models=new Map(),none=[];
  let version=0;
  const invalidate=()=>{version++;metrics.clear();models.clear()};
  document.fonts?.addEventListener?.('loadingdone',invalidate);
  const esc=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const db=()=>root.V25OriginalData||root.OriginalPaperData;
  const physical=(p,i)=>!!db()&&((root.BIBLE_DATA?.pages===db().pages)||(root.BIBLE_DATA?.physicalOriginal===true)||(db().pages&&db().pages[i]===p)||typeof p?.pdfPage==='number');
  const HEADING_FAMILY='"PaperHeading","SimHei","Heiti SC","Noto Sans CJK SC","Microsoft YaHei","PingFang SC",sans-serif';
  const font=(w,heading)=>special.get(w)||(/^[①-⑫]$/.test(w)?'PaperRares':heading?HEADING_FAMILY:FAMILY);
  function metricsFor(word,fontSpec){
    const key=fontSpec+'\0'+word;
    let m=metrics.get(key);if(m)return m;
    ctx.font=fontSpec;const v=ctx.measureText(word),l=v.actualBoundingBoxLeft||0,r=v.actualBoundingBoxRight||v.width||100,a=v.actualBoundingBoxAscent||80,d=v.actualBoundingBoxDescent||0;
    m=[l,Math.max(1,l+r),a,Math.max(1,a+d)];if(metrics.size>=12000)metrics.delete(metrics.keys().next().value);metrics.set(key,m);return m;
  }
  // Two OCR frames are actually strokes of the hatching in the original print.
  // Whole-frame guards deliberately fail open if another edition ever reuses the index.
  const hatchResidue=(i,j,w)=>(i===959&&j===419&&w[0]===1552&&w[1]===163&&w[2]===24&&w[3]===69&&w[4]==='彡')||
    (i===1154&&j===263&&w[0]===8&&w[1]===1296&&w[2]===7&&w[3]===9&&w[4]==='，');
  // Running page numbers read directly from the reference PDF, not OCR
  // guesses. Keep the original physical rectangles and printed header.
  const proofedFolio={
    354:[346,5,805,109,39,35,'\u8a13','34'],
    355:[347,0,718,95,39,35,'\u8a13','34'],
    368:[360,6,794,113,60,36,'36C','360'],
    385:[377,529,711,99,41,35,'\u5200','77'],
    1244:[292,3,776,119,40,35,'\u56db','29']
  };
  function folioWord(store,i,n,w,t){
    const fix=proofedFolio[i];
    if(!fix||n!==fix[1]||t.role!=='other'||store.pages[i].displayPage!==fix[0]||
      store.sha!=='d0879f1d68d147f910c8f6d741ed8ebdb3f5677b057526ededc4d1620e7e7380'||
      !w.every((v,j)=>v===fix[j+2]))return w;
    return [...w.slice(0,4),fix[7]];
  }
  const stock=i=>i%2?[[0,'#dcd5bf'],[.09,'#fffdf1'],[.9,'#fffef5'],[1,'#f9f6eb']]:[[0,'#f9f6eb'],[.1,'#fffef5'],[.91,'#fffdf1'],[1,'#dcd5bf']];
  function fit(w,h){const s=Math.min(W/w,H/h);return {s,ox:(W-w*s)/2,oy:(H-h*s)/2}}
  function word(w,f,heading){
    const [x,y,width,height,text]=w,family=font(text,heading),weight=family===HEADING_FAMILY?600:400,fontSpec=(weight===600?'600 ':'')+'100px '+family;
    const [l,iw,a,ih]=metricsFor(text,fontSpec),sx=width/iw*f.s,sy=height/ih*f.s,xx=f.ox+x*f.s,yy=f.oy+y*f.s;
    return {text,x:xx,y:yy,w:width*f.s,h:height*f.s,sx,sy,tx:xx+l*sx,ty:yy+a*sy,family,weight,fontSpec,box:w};
  }
  // Page/column/row membership is taken from the release's existing ink order.
  // Ordinary Song body Han shares one isotropic em. Position, not scale,
  // absorbs fitting, and only within short runs of adjacent source slots.
  const BODY_EM=.118,HAN=/^\p{Unified_Ideograph}$/u,GAP=.30,SEMANTIC_GAP=5.5;
  function typesetBody(words,p){
    const raw=p[3];
    const rows=root.V25LiveRows?.infer(raw,words).rows||[];
    for(const row of rows){
      const list=row.members.map(j=>words[j]);
      const placed=list.map(c=>{
        if(c.role!=='body'||c.weight!==400||!HAN.test(c.text)||c.family!==FAMILY||c.hideHatch)return null;
        const [l,iw,a,ih]=metricsFor(c.text,c.fontSpec);
        return {c,l,a,w:iw*BODY_EM,h:ih*BODY_EM};
      });
      const estimates=placed.filter(Boolean).filter(z=>z.c.h>=7).map(z=>z.c.y+z.a*BODY_EM).sort((a,b)=>a-b);
      if(!estimates.length)continue;
      const baseline=estimates[estimates.length>>1];
      for(let j=0;j<list.length;){
        if(!placed[j]){j++;continue;}
        const start=j++;
        while(j<list.length&&placed[j]&&list[j].x-(list[j-1].x+list[j-1].w)<SEMANTIC_GAP)j++;
        const run=placed.slice(start,j),first=list[start],last=list[j-1],next=list[j];
        const originalRight=last.x+last.w,total=run.reduce((n,z)=>n+z.w,0);
        // Leave genuine gaps, verse markers and punctuation in their places.
        const ceiling=next?Math.min(originalRight+1.2,Math.max(originalRight,next.x-GAP)):originalRight+1.2;
        const startX=first.x,end=Math.min(ceiling,Math.max(originalRight,startX+total+GAP*(run.length-1)));
        // A compact caption, congested punctuation or ambiguous slot remains
        // in its accepted source pose rather than introducing an overlap.
        if(end-startX+1e-7<total)continue;
        const gap=run.length>1?Math.max(0,(end-startX-total)/(run.length-1)):0;
        let x=startX;
        for(const z of run){
          const c=z.c;
          c.x=x;c.y=baseline-z.a*BODY_EM;c.w=z.w;c.h=z.h;
          c.sx=c.sy=BODY_EM;c.tx=x+z.l*BODY_EM;c.ty=baseline;
          x+=z.w+gap;
        }
      }
    }
  }
  function model(i){
    const store=db(),p=store.get(i);if(!p)return null;
    if(p[0]!==i)throw Error('Physical page identity mismatch: '+i);
    const tags=store.tags?.(i)||none,cached=models.get(i);if(cached&&cached.version===version&&cached.tags===tags&&cached.p===p){models.delete(i);models.set(i,cached);return cached}
    const f=fit(p[1],p[2]),words=p[3].map((w,n)=>{
      const t=tags[n]||store.metaFor?.(i,n)||{};
      const heading=root.V25HeadingFrames?.classify(store.sha,i,n,w)??(t.role==='heading');
      return {...word(folioWord(store,i,n,w,t),f,heading),role:t.role||'other',ref:t.ref||'',group:t.group??'',column:t.column??'',row:t.row??'',physicalInk:true,index:n,hideHatch:hatchResidue(i,n,w)};
    });
    typesetBody(words,p);
    const v={version,p,tags,words,f};models.set(i,v);if(models.size>8)models.delete(models.keys().next().value);return v;
  }
  function text(c){
    const [x,y,w,h]=c.box;
    const meta=(' data-role="'+esc(c.role)+'" data-physical-idx="'+c.index+'" data-x="'+x+'" data-y="'+y+'" data-w="'+w+'" data-h="'+h+'"'+(c.ref?' data-ref="'+esc(c.ref)+'"':''));
    const clip=[Math.floor(c.x)-1,Math.ceil(c.x+c.w)+1,Math.floor(c.y)-1,Math.ceil(c.y+c.h)+1];
    return '<text'+meta+(c.hideHatch?' visibility="hidden" pointer-events="none" aria-hidden="true"':'')+' data-clip="'+clip.join(' ')+'" transform="matrix('+[c.sx,0,0,c.sy,c.tx,c.ty].join(' ')+')" font-family="'+esc(c.family)+'"'+(c.weight===600?' font-weight="600"':'')+' font-size="100" fill="'+ink+'" style="fill:'+ink+'">'+esc(c.text)+'</text>';
  }
  function svg(page,i,books){
    if(!physical(page,i))return old.svg(page,i,books);
    const name=page?.b>=0&&books[page.b]?books[page.b].name:'原书',v=model(i),f=v?.f||{s:1,ox:0,oy:0};
    const a=['<svg viewBox="0 0 480 704" role="img" data-pdf="'+i+'" data-scale="'+f.s+'" data-offset-x="'+f.ox+'" data-offset-y="'+f.oy+'" aria-label="'+esc(name+' · 原 PDF 第 '+i+' 页')+'">','<defs><linearGradient id="paper-'+i+'">'+stock(i).map(([o,c])=>'<stop offset="'+o+'" stop-color="'+c+'"/>').join('')+'</linearGradient></defs><rect width="480" height="704" fill="url(#paper-'+i+')"/>'];
    if(v){
      const p=v.p;for(const c of v.words)a.push(text(c));
      a.push('<g transform="matrix('+[f.s,0,0,f.s,f.ox,f.oy].join(' ')+')" fill="'+ink+'" aria-hidden="true" pointer-events="none">');
      for(const [x,y,w,h] of p[4]||[])a.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/>');
      a.push('</g>');
    }
    a.push('</svg>');return a.join('');
  }
  function paint(canvas,page,i,books,ratio=2){
    if(!physical(page,i))return old.paint(canvas,page,i,books,ratio);
    const c=canvas.getContext('2d'),v=model(i);c.save();c.setTransform(ratio,0,0,ratio,0,0);
    const grd=c.createLinearGradient(0,0,W,0);for(const [n,col] of stock(i))grd.addColorStop(n,col);
    c.fillStyle=grd;c.fillRect(0,0,W,H);c.fillStyle=ink;
    if(v){
      const {p,f}=v;function draw(t){c.save();c.transform(t.sx,0,0,t.sy,t.tx,t.ty);c.font=t.fontSpec;c.textBaseline='alphabetic';c.textAlign='left';c.fillText(t.text,0,0);c.restore()}
      for(const w of v.words)if(!w.hideHatch)draw(w);c.save();c.transform(f.s,0,0,f.s,f.ox,f.oy);
      for(const r of p[4]||[])c.fillRect(...r);
      c.restore();
    }c.restore();
  }
  async function preparePhysicalFonts(indices){
    if(!document.fonts)return;
    const chars=new Set();
    for(const i of indices){const p=db()?.get(i);if(p){for(const w of p[3])for(const ch of w[4])chars.add(ch)}}
    // The desk's following turns are synchronous. Loading only the first spread's
    // charset would measure a later rare glyph with a fallback face for one frame
    // (or the lifetime of that static spread). All webfont subsets together are
    // ~1.3 MB; settle the declared book faces once before the first interactive turn.
    const allowed=new Set(['PaperSerif','PaperRares','PaperHeading',...special.values()]);
    const jobs=Array.from(document.fonts).filter(face=>allowed.has(face.family.replace(/["']/g,''))).map(face=>face.load());
    if(!jobs.length&&chars.size){const txt=Array.from(chars).join('');jobs.push(document.fonts.load('100px PaperSerif',txt),document.fonts.load('100px PaperRares',txt),document.fonts.load('600 100px PaperHeading',txt));}
    await Promise.all(jobs);invalidate();
  }
  root.PaperPage={...old,svg,paint,preparePhysicalFonts,clearPhysicalMetrics:invalidate,commands:(p,i,bs)=>physical(p,i)?(model(i)?.words||[]):old.commands(p,i,bs)};
})();
