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
  const ctx=document.createElement('canvas').getContext('2d'),metrics=new Map(),models=new Map(),paths=new Map(),none=[];
  let version=0;
  const invalidate=()=>{version++;metrics.clear();models.clear()};
  document.fonts?.addEventListener?.('loadingdone',invalidate);
  const esc=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const db=()=>root.V25OriginalData||root.OriginalPaperData;
  const physical=(p,i)=>!!db()&&((root.BIBLE_DATA?.pages===db().pages)||(root.BIBLE_DATA?.physicalOriginal===true)||(db().pages&&db().pages[i]===p)||typeof p?.pdfPage==='number');
  const font=w=>special.get(w)||(/^[①-⑫]$/.test(w)?'PaperRares':FAMILY);
  function metricsFor(word){
    let m=metrics.get(word);if(m)return m;
    ctx.font='100px '+font(word);const v=ctx.measureText(word),l=v.actualBoundingBoxLeft||0,r=v.actualBoundingBoxRight||v.width||100,a=v.actualBoundingBoxAscent||80,d=v.actualBoundingBoxDescent||0;
    m=[l,Math.max(1,l+r),a,Math.max(1,a+d)];if(metrics.size>=12000)metrics.delete(metrics.keys().next().value);metrics.set(word,m);return m;
  }
  const stock=i=>i%2?[[0,'#dcd5bf'],[.09,'#fffdf1'],[.9,'#fffef5'],[1,'#f9f6eb']]:[[0,'#f9f6eb'],[.1,'#fffef5'],[.91,'#fffdf1'],[1,'#dcd5bf']];
  function fit(w,h){const s=Math.min(W/w,H/h);return {s,ox:(W-w*s)/2,oy:(H-h*s)/2}}
  function word(w,f){
    const [x,y,width,height,text]=w,[l,iw,a,ih]=metricsFor(text),sx=width/iw*f.s,sy=height/ih*f.s,xx=f.ox+x*f.s,yy=f.oy+y*f.s;
    return {text,x:xx,y:yy,w:width*f.s,h:height*f.s,sx,sy,tx:xx+l*sx,ty:yy+a*sy,family:font(text),box:w};
  }
  function model(i){
    const store=db(),p=store.get(i);if(!p)return null;
    if(p[0]!==i)throw Error('Physical page identity mismatch: '+i);
    const tags=store.tags?.(i)||none,cached=models.get(i);if(cached&&cached.version===version&&cached.tags===tags&&cached.p===p){models.delete(i);models.set(i,cached);return cached}
    const f=fit(p[1],p[2]),words=p[3].map((w,n)=>{
      const t=tags[n]||store.metaFor?.(i,n)||{};
      return {...word(w,f),role:t.role||'other',ref:t.ref||'',group:t.group??'',column:t.column??'',row:t.row??'',physicalInk:true,index:n};
    });
    const v={version,p,tags,words,f};models.set(i,v);if(models.size>8)models.delete(models.keys().next().value);return v;
  }
  function text(c,label=false){
    const [x,y,w,h]=c.box;
    const meta=label?'':(' data-role="'+esc(c.role)+'" data-physical-idx="'+c.index+'" data-x="'+x+'" data-y="'+y+'" data-w="'+w+'" data-h="'+h+'"'+(c.ref?' data-ref="'+esc(c.ref)+'"':''));
    const clip=[Math.floor(c.x)-1,Math.ceil(c.x+c.w)+1,Math.floor(c.y)-1,Math.ceil(c.y+c.h)+1];
    return '<text'+meta+' data-clip="'+clip.join(' ')+'" transform="matrix('+[c.sx,0,0,c.sy,c.tx,c.ty].join(' ')+')" font-family="'+esc(c.family)+'" font-size="100" fill="'+ink+'" style="fill:'+ink+'">'+esc(c.text)+'</text>';
  }
  function svg(page,i,books){
    if(!physical(page,i))return old.svg(page,i,books);
    const name=page?.b>=0&&books[page.b]?books[page.b].name:'原书',v=model(i),f=v?.f||{s:1,ox:0,oy:0};
    const a=['<svg viewBox="0 0 480 704" role="img" data-pdf="'+i+'" data-scale="'+f.s+'" data-offset-x="'+f.ox+'" data-offset-y="'+f.oy+'" aria-label="'+esc(name+' · 原 PDF 第 '+i+' 页')+'">','<defs><linearGradient id="paper-'+i+'">'+stock(i).map(([o,c])=>'<stop offset="'+o+'" stop-color="'+c+'"/>').join('')+'</linearGradient></defs><rect width="480" height="704" fill="url(#paper-'+i+')"/>'];
    if(v){
      const p=v.p;for(const c of v.words)a.push(text(c));
      a.push('<g transform="matrix('+[f.s,0,0,f.s,f.ox,f.oy].join(' ')+')" fill="'+ink+'" aria-hidden="true" pointer-events="none">');
      for(const [x,y,w,h] of p[4]||[])a.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"/>');
      if(p[5])a.push('<path data-kind="book-tab" d="'+esc(p[5].d)+'"/>');
      for(const d of p[6]||[])a.push('<path data-kind="printed-margin" fill-rule="evenodd" d="'+esc(d)+'"/>');a.push('</g>');
      if(p[5]?.label?.length){a.push('<g data-kind="book-tab-label" style="user-select:none" pointer-events="none" aria-hidden="true">');for(const w of p[5].label)a.push(text(word(w,f),true));a.push('</g>')}
    }
    a.push('</svg>');return a.join('');
  }
  function path(d){let p=paths.get(d);if(!p){p=new Path2D(d);if(paths.size>160)paths.clear();paths.set(d,p)}return p}
  function paint(canvas,page,i,books,ratio=2){
    if(!physical(page,i))return old.paint(canvas,page,i,books,ratio);
    const c=canvas.getContext('2d'),v=model(i);c.save();c.setTransform(ratio,0,0,ratio,0,0);
    const grd=c.createLinearGradient(0,0,W,0);for(const [n,col] of stock(i))grd.addColorStop(n,col);
    c.fillStyle=grd;c.fillRect(0,0,W,H);c.fillStyle=ink;
    if(v){
      const {p,f}=v;function draw(t){c.save();c.transform(t.sx,0,0,t.sy,t.tx,t.ty);c.font='100px '+t.family;c.textBaseline='alphabetic';c.textAlign='left';c.fillText(t.text,0,0);c.restore()}
      for(const w of v.words)draw(w);c.save();c.transform(f.s,0,0,f.s,f.ox,f.oy);
      for(const r of p[4]||[])c.fillRect(...r);if(p[5])c.fill(path(p[5].d));for(const d of p[6]||[])c.fill(path(d),'evenodd');
      c.restore();for(const w of p[5]?.label||[])draw(word(w,f));
    }c.restore();
  }
  async function preparePhysicalFonts(indices){
    if(!document.fonts)return;
    const chars=new Set();
    for(const i of indices){const p=db()?.get(i);if(p){for(const w of p[3])for(const ch of w[4])chars.add(ch);for(const w of p[5]?.label||[])for(const ch of w[4])chars.add(ch)}}
    // The desk's following turns are synchronous. Loading only the first spread's
    // charset would measure a later rare glyph with a fallback face for one frame
    // (or the lifetime of that static spread). All webfont subsets together are
    // ~1.3 MB; settle the declared book faces once before the first interactive turn.
    const allowed=new Set(['PaperSerif','PaperRares',...special.values()]);
    const jobs=Array.from(document.fonts).filter(face=>allowed.has(face.family.replace(/["']/g,''))).map(face=>face.load());
    if(!jobs.length&&chars.size){const txt=Array.from(chars).join('');jobs.push(document.fonts.load('100px PaperSerif',txt),document.fonts.load('100px PaperRares',txt));}
    await Promise.all(jobs);invalidate();
  }
  root.PaperPage={...old,svg,paint,preparePhysicalFonts,clearPhysicalMetrics:invalidate,commands:(p,i,bs)=>physical(p,i)?(model(i)?.words||[]):old.commands(p,i,bs)};
})();
