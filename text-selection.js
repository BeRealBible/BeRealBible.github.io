/* Select the ink on one physical face. The original SVG remains the only text layer. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PaperTextSelection=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const SVG='http://www.w3.org/2000/svg';

  // Source references, not line numbers: a verse may wrap or cross the gutter
  // between columns. Only commands drawn on this face are included in the copy.
  function indexFace(page,commands){
    const groups=new Map(),lookup=commands.map(()=>[]),units=[];
    let rowKey='',ref=page.start||'1:1';
    function group(key){if(!groups.has(key))groups.set(key,{key,chars:[],marks:[]});return groups.get(key);}
    commands.forEach((c,i)=>{
      const text=String(c.text||'');if(!text||c.role==='blank-mark')return;
      // A sealed paper word carries its own reviewed verse association.
      // Unknown / auxiliary printing remains selectable without a false citation.
      if(c.physicalInk){
        const key=c.ref&&['body','chapter','verse'].includes(c.role)?'verse:'+c.ref:
          c.role==='heading'&&c.ref?'heading:'+c.ref:'physical-'+c.role+':'+(c.group||i);
        const g=group(key);
        if(c.ref&&(c.role==='chapter'||c.role==='verse')){g.marks.push(i);return;}
        let offset=0;for(const ch of text){g.chars.push({ch,i,offset});offset+=ch.length;}
        return;
      }
      const row=page.cols?.[c.column]?.[c.row],key=c.column+':'+c.row;
      if(row&&key!==rowKey){ref=row.start||ref;rowKey=key;}
      const run=row?.runs?.[c.run];
      if(c.role==='verse'||c.role==='chapter'){
        if(run?.ref)ref=run.ref;
        else if(c.role==='chapter')ref=text+':1';
        else ref=ref.split(':')[0]+':'+text;
        group('verse:'+ref).marks.push(i);return;
      }
      const groupKey=c.role==='body'?'verse:'+ref:
        String(c.role).startsWith('heading')?'heading:'+key:c.role+':'+i;
      const g=group(groupKey);
      // SVGTextContentElement character offsets are UTF-16; retain both source
      // offsets and the original printable characters (including CJK spacing).
      let offset=0;for(const ch of text){g.chars.push({ch,i,offset});offset+=ch.length;}
    });
    for(const g of groups.values()){
      if(!g.chars.length)continue;
      const original=g.chars.map(p=>p.ch).join('');
      // Words on English lines are independently selectable, including internal
      // apostrophes and hyphens. Ordinary Chinese scripture is one verse.
      const pattern=/[A-Za-z]+(?:['’\-][A-Za-z]+)*|[^A-Za-z]+/gu;
      const withWords=/[A-Za-z]/.test(original);
      const slices=withWords?[...original.matchAll(pattern)].map(m=>m[0]):[original];
      let offset=0;
      for(const slice of slices){
        const count=[...slice].length,parts=g.chars.slice(offset,offset+count);offset+=count;
        const text=slice.trim();if(!text)continue;
        const unit={text,word:withWords&&/^[A-Za-z]/.test(slice),group:g.key,parts:[],order:parts[0].i+parts[0].offset/(commands[parts[0].i].text.length+1)};
        // The address describes the passage; the fingerprint prevents an
        // annotation migrating to different words if pagination is revised.
        let hash=2166136261;for(const ch of slice)hash=Math.imul(hash^ch.codePointAt(0),16777619);
        unit.id=g.key+'@'+(offset-count)+':'+(hash>>>0).toString(36);
        for(const {ch,i,offset:start} of parts){
          if(!ch.trim())continue;
          const end=start+ch.length,prior=unit.parts.at(-1);
          if(prior?.i===i&&prior.end===start)prior.end=end;else unit.parts.push({i,start,end});
          for(let n=start;n<end;n++)lookup[i][n]=unit;
        }
        units.push(unit);
        if(g.marks.length){for(const i of g.marks){const end=commands[i].text.length;
          unit.parts.push({i,start:0,end});lookup[i]=Array(end).fill(unit);
        }g.marks.length=0;}
      }
    }
    return {units,lookup};
  }
  // Presentation spaces are not part of the copied Chinese text. Keep actual
  // Latin/numeric word separators; never alter ink, annotation IDs or citations.
  const cjk=/\p{Script=Han}/u,wordEdge=/[A-Za-z0-9]/;
  function clipboardText(t){
    if(!cjk.test(t))return t;
    return t.replace(/[\s\u200B\u2060]+/gu,(gap,i,value)=>{
      const before=value[i-1],after=value[i+gap.length];
      return before&&after&&wordEdge.test(before)&&wordEdge.test(after)?' ':'';
    });
  }
  function copyText(items,textFor=u=>u.text){
    return Array.from(items).sort((a,b)=>a.order-b.order).reduce((state,unit)=>{
      const join=!state.prev?'':state.prev.word&&unit.word&&state.prev.group===unit.group?' ':'\n';
      state.text+=join+textFor(unit);state.prev=unit;return state;
    },{text:'',prev:null}).text;
  }
  function verseOf(unit){
    const m=/^verse:(\d+):(\d+)(?:[-–](\d+))?$/.exec(unit.group);
    return m?{ch:+m[1],v:+m[2],end:+(m[3]||m[2])}:null;
  }
  function formatQuote(items,bookName,faceUnits=[],textFor=u=>u.text){
    const list=Array.from(items).sort((a,b)=>a.order-b.order);
    if(!bookName||!list.some(verseOf))return copyText(list,textFor);
    const refs=[...new Set(faceUnits.slice().sort((a,b)=>a.order-b.order).filter(verseOf).map(u=>u.group))];
    const blocks=[];let passages=[],other=[];
    function scripture(){
      if(!passages.length)return;
      const spans=[];let body='',prev=null;
      for(const u of passages){
        const r=verseOf(u),same=prev?.group===u.group,p=prev&&verseOf(prev);
        // A cross-chapter boundary is only consecutive when these are
        // neighbouring verses on the actual page, not merely a chapter apart.
        const consecutive=p&&((r.ch===p.ch&&r.v===p.end+1)||
          (r.ch===p.ch+1&&r.v===1&&refs.includes(prev.group)&&refs.indexOf(u.group)===refs.indexOf(prev.group)+1));
        if(prev&&!same&&!consecutive)body+='……';
        if(same&&prev.word&&u.word)body+=' ';
        body+=textFor(u);
        if(!same){if(consecutive)spans.at(-1).end=r;else spans.push({start:r,end:r});}
        prev=u;
      }
      const address=spans.map(({start:a,end:b},i)=>{
        const begin=(i&&spans[i-1].end.ch===a.ch?'':a.ch+':')+a.v;
        return begin+(a.ch===b.ch&&a.v===b.end?'':'-'+(a.ch===b.ch?'':b.ch+':')+b.end);
      }).join(',');
      blocks.push(body+'\n( '+bookName+' '+address+' 和合本 )');passages=[];
    }
    function plain(){if(other.length){blocks.push(copyText(other,textFor));other=[];}}
    for(const u of list){if(verseOf(u)){plain();passages.push(u);}else{scripture();other.push(u);}}
    scripture();plain();return blocks.join('\n');
  }
  function clipboardQuote(items,bookName,faceUnits){
    return formatQuote(items,bookName,faceUnits,u=>clipboardText(u.text));
  }
  // Each provider owns only query construction. No network work until submit.
  const searchProviders=Object.freeze({
    google(query){const url=new URL('https://www.google.com/search');url.searchParams.set('q',query);return url.href;}
  });
  function buildSearchURL(quote,question,provider='google'){
    if(!quote?.trim()||!question?.trim()||!Object.hasOwn(searchProviders,provider))return null;
    return searchProviders[provider](quote.trim()+'\n\n'+question.trim());
  }
  function localPoint(svg,x,y){
    try{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(svg.getScreenCTM().inverse());}catch{return null;}
  }
  function mergeRects(boxes){
    const out=[];
    for(const b of boxes){
      if(!(b.width>0&&b.height>0))continue;
      const p=out.at(-1);
      if(p&&p.line===b.line&&Math.abs(p.y-b.y)<1&&Math.abs(p.height-b.height)<1&&b.x>=p.x&&b.x<=p.x+p.width+.48*p.height){
        p.width=Math.max(p.width,b.x+b.width-p.x);
      }else out.push({...b});
    }
    return out;
  }
  function median(a){return a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];}
  // The sealed OCR tags on some editions lack line metadata. Derive stable
  // row anchors from all body glyphs on the physical face, not from the
  // selected glyphs: punctuation and small verse labels are not baselines.
  function physicalRows(commands){
    const anchors=[[],[]],center=c=>c.y+c.h/2,column=c=>c.x+c.w/2<240?0:1;
    const body=commands.filter(c=>c.physicalInk&&c.role==='body'&&cjk.test(c.text)&&c.h>0&&c.w>0);
    if(!body.length)return new Map();
    const typical=median(body.map(c=>c.h));
    for(const c of body.slice().sort((a,b)=>center(a)-center(b))){
      if(c.h<typical*.62)continue;
      const rows=anchors[column(c)],last=rows.at(-1),y=center(c);
      if(last&&Math.abs(y-last.center)<=typical*.40){
        last.center=(last.center*last.n+y)/++last.n;
      }else rows.push({center:y,n:1});
    }
    const inferred=new Map();
    commands.forEach((c,i)=>{
      if(!c.physicalInk||c.role!=='body')return;
      const col=column(c),rows=anchors[col],y=center(c);
      let nearest=-1,distance=Infinity;
      for(let j=0;j<rows.length;j++){
        const d=Math.abs(y-rows[j].center);if(d<distance){distance=d;nearest=j;}
      }
      if(distance<=typical*.66)inferred.set(i,{key:'ink/'+col+'/'+nearest,center:rows[nearest].center,height:typical});
    });
    return inferred;
  }
  // Paint one even band from first to last selected ink on each physical
  // row. Gaps inside the verse (punctuation and deity spacing) belong to it.
  function verseBands(boxes){
    const rows=new Map(),unknown=[];
    for(const b of boxes){
      if(!(b.width>0&&b.height>0))continue;
      if(b.row==null){unknown.push(b);continue;}
      const row=rows.get(b.row)||[];row.push(b);rows.set(b.row,row);
    }
    return [...Array.from(rows.values(),row=>{
      const x=Math.min(...row.map(b=>b.x)),right=Math.max(...row.map(b=>b.x+b.width));
      const height=row[0].rowHeight??median(row.map(b=>b.height));
      const center=row[0].rowCenter??median(row.map(b=>b.y+b.height/2));
      return {x,y:center-height/2,width:right-x,height};
    }),...mergeRects(unknown)];
  }
  function create({stage,papers,getPage,commands,storage,feedback=()=>{}}){
    const doc=stage.ownerDocument,win=doc.defaultView,cache=new WeakMap(),session=new Map();
    let active=null,bar=null,searchForm=null,focus=null,focusMark=null,serial=0,observer=null,refreshFrame=null;
    const recordKey=(page,index,book)=>['paper-bible-highlights-v1',book?.code||page.frontmatter||'cover',index,page.start||'',page.end||''].join(':');
    // The old format is a page-wide array. Keep it as a read-only baseline;
    // independent per-passage overrides prevent two tabs from overwriting
    // unrelated edits, even when their writes land before either storage event.
    // A cheap shared flag avoids mapping every glyph on unannotated pages.
    const unitKey=(key,id)=>key+'~mark~'+id;
    function pageMarks(key){
      let legacy=[],used=false;
      try{legacy=JSON.parse(storage?.getItem(key)||'[]');used=storage?.getItem(key+'~used')==='1';}catch{}
      const baseline=new Set(Array.isArray(legacy)?legacy:[]),local=session.get(key);
      return {possible:used||!!baseline.size||!!local?.size,has(id){
        if(local?.has(id))return local.get(id);
        let v;try{v=storage?.getItem(unitKey(key,id));}catch{}
        return v==='1'||v!=='0'&&baseline.has(id);
      }};
    }
    function model(side,svg){
      const {page,index,books}=getPage(side),prior=cache.get(svg);
      if(prior?.index===index)return prior;
      const nodes=Array.from(svg.querySelectorAll('text[data-role]'));
      const list=commands(page,index,books).filter(c=>c.role!=='footer-rule');
      if(nodes.length!==list.length)return null; // Never select a stale curl face.
      const book=books[page.b],key=recordKey(page,index,book);
      const entry={svg,index,side,nodes,list,mapping:new WeakMap(),bookName:book?.name,key,...indexFace(page,list)};
      nodes.forEach((el,i)=>entry.mapping.set(el,i));cache.set(svg,entry);return entry;
    }
    function hit(x,y,target){
      // Do not snap the column, row or paper margin to its nearest verse.
      // Pointer capture is taken at the stage; use the down target when present.
      const node=target?.closest?.('text[data-role]')||doc.elementFromPoint?.(x,y)?.closest?.('text[data-role]');
      if(!node)return null;
      const side=papers.findIndex(p=>p.contains(node)),svg=node.ownerSVGElement;
      if(side<0||!svg||svg!==papers[side].querySelector('svg'))return null;
      const entry=model(side,svg),point=localPoint(svg,x,y);
      if(!entry||!point)return null;
      const i=entry.mapping.get(node);if(i===undefined)return null;
      let n;
      try{
        let probe=point;
        if(entry.list[i].physicalInk){
          // getCharNumAtPosition consumes the word's own untransformed user space,
          // not the book's 480 x 704 root nor the original PDF pixel rectangle.
          const screen=node.getScreenCTM();if(!screen)return null;
          const q=svg.createSVGPoint();q.x=x;q.y=y;probe=q.matrixTransform(screen.inverse());
        }
        n=node.getCharNumAtPosition(probe);
        if(n<0&&entry.list[i].physicalInk){
          const c=entry.list[i];
          if(point.x>=c.x&&point.x<=c.x+c.w&&point.y>=c.y&&point.y<=c.y+c.h&&entry.lookup[i]?.length&&entry.lookup[i].every(v=>v===entry.lookup[i][0]))n=0;
        }
      }catch{return null;}
      const unit=entry.lookup[i]?.[n];return unit?{entry,unit,point:{x:point.x,y:point.y}}:null;
    }
    function draw(token,mode){
      const {entry,unit}=token,svg=entry.svg,boxes=[],verse=!!verseOf(unit)&&!unit.word;
      const body=verse&&unit.parts.some(({i})=>entry.list[i].role==='body');
      if(verse&&entry.rows===undefined)entry.rows=physicalRows(entry.list);
      for(const {i,start,end} of unit.parts){
        const node=entry.nodes[i],c=entry.list[i],line=[c.column,c.row,c.y].join('/');
        if(body&&(c.role==='chapter'||c.role==='verse'))continue; // labels are not verse text
        const fallback=entry.rows?.get(i);
        const row=c.column!==''&&c.row!==''&&c.column!=null&&c.row!=null?c.column+'/'+c.row:fallback?.key;
        const rowCenter=fallback?.center,rowHeight=fallback?.height;
        let rects=[];
        try{
          if(c.physicalInk&&start===0&&end===c.text.length){
            // Use measured ink, not the much larger em-square.
            boxes.push({x:c.x,y:c.y,width:c.w,height:c.h,line,row,rowCenter,rowHeight});continue;
          }
          if(start===0&&end===c.text.length)rects=[node.getBBox()];
          else for(let j=start;j<end;j++)rects.push(node.getExtentOfChar(j));
        }catch{continue;}
        for(const r of rects){
          // The physical word transform is diagonal, including page adaptation.
          if(c.physicalInk)boxes.push({x:r.x*c.sx+c.tx,y:r.y*c.sy+c.ty,width:r.width*c.sx,height:r.height*c.sy,line,row,rowCenter,rowHeight});
          else boxes.push({x:r.x,y:r.y,width:r.width,height:r.height,line,row,rowCenter,rowHeight});
        }
      }
      const g=doc.createElementNS(SVG,'g');
      g.setAttribute('class','paper-ink-mark paper-ink-mark--'+mode);g.setAttribute('aria-hidden','true');g.setAttribute('pointer-events','none');
      for(const b of verse?verseBands(boxes):mergeRects(boxes)){
        const rect=doc.createElementNS(SVG,'rect');
        const bounds=mode==='focus' ? {
          x:b.x-.7,y:b.y-.18*b.height,width:b.width+1.4,height:1.36*b.height,rx:1.3
        } : {x:b.x-.5,y:b.y+.06*b.height,width:b.width+1,height:.90*b.height,rx:1.1};
        for(const [k,v] of Object.entries(bounds))rect.setAttribute(k,String(v));
        g.appendChild(rect);
      }
      svg.insertBefore(g,entry.nodes[0]);return g;
    }
    function refresh(){
      papers.forEach((paper,side)=>{
        const svg=paper.querySelector('svg');if(!svg)return;
        // A cancelled curl can restore a serialized SVG already containing
        // these groups. Rebuild rather than drawing a second translucent coat.
        for(const kind of ['saved','focus'])for(const g of svg.querySelectorAll('.paper-ink-mark--'+kind))g.remove();
        const {page,index,books}=getPage(side),key=recordKey(page,index,books[page.b]),saved=pageMarks(key);
        const focused=focus?.key===key;
        if(!saved.possible&&!focused)return;
        const entry=model(side,svg);if(!entry)return;
        if(saved.possible)for(const unit of entry.units)if(saved.has(unit.id))draw({entry,unit},'saved');
        if(focused){
          const unit=entry.units.find(candidate=>candidate.id===focus.unitId);
          if(unit)focusMark=draw({entry,unit},'focus');
        }
      });
    }
    function clearFocus(){focusMark?.remove();focusMark=null;focus=null;}
    function isCurrent(t){return t&&getPage(t.entry.side).index===t.entry.index&&papers[t.entry.side].querySelector('svg')===t.entry.svg;}
    function reset({keepFocus=false}={}){
      serial++;if(!keepFocus)clearFocus();if(refreshFrame!==null)win.cancelAnimationFrame(refreshFrame);refreshFrame=null;observer?.disconnect();observer=null;
      if(active){for(const mark of active.marks.values())mark.remove();active=null;}
      bar?.remove();bar=null;searchForm=null;delete stage.dataset.textSelection;
    }
    function anchorBar(){
      if(!bar||!active)return;
      if(!isCurrent(active.anchor)){reset();return;}
      const {entry,point}=active.anchor,sheet=entry.svg.getBoundingClientRect(),r=stage.getBoundingClientRect(),scale=sheet.width/480;
      if(!scale||!r.width||!r.height)return;
      const displayScale=searchForm?1:scale;
      bar.style.maxWidth=Math.max(1,(r.width-12)/displayScale)+'px';bar.style.transform='scale('+displayScale+')';
      // Extra transparent hit padding, in screen pixels, never magnifies the ink.
      bar.style.setProperty('--ink-hit-pad',Math.max(0,(40/scale-29)/2)+'px');
      const bounds=bar.getBoundingClientRect(),pad=6,gap=14*scale,px=sheet.left-r.left+point.x*scale,py=sheet.top-r.top+point.y*scale;
      const within=(v,a,b)=>Math.max(a,Math.min(v,Math.max(a,b)));
      // Use the visible selected ink, not just the last touch point. If the
      // selection is tall, prefer an available side before overlaying it.
      const rects=[...active.marks.values()].map(m=>m.getBoundingClientRect()).filter(b=>b.width&&b.height&&Number.isFinite(b.right)&&b.right>r.left&&b.left<r.left+r.width&&b.bottom>r.top&&b.top<r.top+r.height);
      const top=rects.length?Math.min(...rects.map(b=>b.top-r.top)):py;
      const bottom=rects.length?Math.max(...rects.map(b=>b.bottom-r.top)):py;
      const left=rects.length?Math.min(...rects.map(b=>b.left-r.left)):px;
      const right=rects.length?Math.max(...rects.map(b=>b.right-r.left)):px;
      const centered=within(px-bounds.width*.5,pad,r.width-bounds.width-pad);
      const upper=top-gap-bounds.height,lower=bottom+gap,maxY=r.height-bounds.height-pad;
      let x=centered,y=upper>=pad?upper:lower;
      if(upper<pad&&lower>maxY){
        if(right+gap+bounds.width<=r.width-pad){x=right+gap;y=py-bounds.height*.5;}
        else if(left-gap-bounds.width>=pad){x=left-gap-bounds.width;y=py-bounds.height*.5;}
        else y=top>r.height-bottom?pad:maxY;
      }
      bar.style.left=x+'px';bar.style.top=within(y,pad,maxY)+'px';
    }
    function schedule(){if(active&&refreshFrame===null)refreshFrame=win.requestAnimationFrame(()=>{refreshFrame=null;anchorBar();});}
    function actionLabel(b,text){b.setAttribute('aria-label',text);b.setAttribute('title',text);}
    function allSaved(){const saved=pageMarks(active.anchor.entry.key);return !!active.marks.size&&Array.from(active.marks.keys()).every(u=>saved.has(u.id));}
    function highlight(){
      if(!active?.marks.size)return;
      const key=active.anchor.entry.key,remove=bar.querySelector('[data-highlight]').getAttribute('aria-pressed')==='true';
      let durable=true;
      for(const {id} of active.marks.keys()){
        try{storage.setItem(key+'~used','1');storage.setItem(unitKey(key,id),remove?'0':'1');session.get(key)?.delete(id);}
        catch{durable=false;if(!session.has(key))session.set(key,new Map());session.get(key).set(id,!remove);}
      }
      reset();refresh();feedback((remove?'已取消高亮':'已高亮')+(durable?'':'（仅本次阅读）'));
    }
    function toggle(t){
      const m=active.marks.get(t.unit);
      if(m){m.remove();active.marks.delete(t.unit);}else active.marks.set(t.unit,draw(t,'selected'));
      active.anchor=t;syncPen();anchorBar();
    }
    function syncPen(){
      const {size}=active.marks;
      bar.querySelector('[data-copy]').disabled=!size;
      bar.querySelector('[data-search]').disabled=!size;
      const pen=bar.querySelector('[data-highlight]'),marked=allSaved();
      pen.disabled=!size;pen.setAttribute('aria-pressed',String(marked));actionLabel(pen,marked?'取消高亮':'高亮');
    }
    // Clipboard event for Ctrl/Cmd+C on the focused paper reader. Inputs
    // (including the search box and manual-copy fallback) keep normal Copy.
    function keyboardCopy(e){
      if(!active?.marks.size||!isCurrent(active.anchor)||!e.clipboardData||
        e.target?.closest?.('textarea,input,[contenteditable]'))return;
      const {entry}=active.anchor;
      try{e.clipboardData.setData('text/plain',clipboardQuote(active.marks.keys(),entry.bookName,entry.units));}
      catch{return;}
      e.preventDefault();reset();feedback('\u5df2\u590d\u5236\u9009\u4e2d\u6587\u5b57');
    }
    stage.addEventListener('copy',keyboardCopy);
    async function copy(){
      if(!active?.marks.size)return;
      const version=serial,{entry}=active.anchor,text=clipboardQuote(active.marks.keys(),entry.bookName,entry.units);
      let ok=false;
      try{if(win.navigator?.clipboard?.writeText){await win.navigator.clipboard.writeText(text);ok=true;}}catch{}
      if(version!==serial||!active)return;
      if(!ok){
        const field=doc.createElement('textarea');field.className='paper-copy-field';
        field.value=text;field.readOnly=true;field.setAttribute('aria-label','已选文字，可手动复制');
        bar.querySelector('.paper-copy-field')?.remove();bar.appendChild(field);field.focus({preventScroll:true});field.select();
        try{ok=doc.execCommand('copy');}catch{}
        if(ok)field.remove();
        else{field.classList.add('manual');feedback('浏览器未允许自动复制，请手动复制已选文字');field.focus({preventScroll:true});field.select();anchorBar();return;}
      }
      reset();feedback('已复制选中文字');
    }
    function closeSearch(){
      if(!searchForm)return;
      searchForm.remove();searchForm=null;delete bar.dataset.searchOpen;
      const search=bar.querySelector('[data-search]');
      search.setAttribute('aria-expanded','false');anchorBar();search.focus({preventScroll:true});
    }
    function openSearch(){
      if(searchForm||!active?.marks.size)return;
      const {entry}=active.anchor,quote=formatQuote(active.marks.keys(),entry.bookName,entry.units);
      if(!quote.trim())return;
      const form=doc.createElement('form'),label=doc.createElement('label'),field=doc.createElement('input');
      const note=doc.createElement('small'),actions=doc.createElement('div');
      const cancel=doc.createElement('button'),submit=doc.createElement('button');
      form.className='paper-search-form';form.setAttribute('role','search');form.setAttribute('aria-label','搜索所选经文');
      label.textContent='想问这段经文什么？';
      field.type='text';field.name='question';field.required=true;field.autocomplete='off';field.enterKeyHint='search';
      field.placeholder='输入你的问题';
      let composing=false;
      field.addEventListener('compositionstart',()=>{composing=true;});
      field.addEventListener('compositionend',()=>{composing=false;});
      note.textContent='点击搜索后，所选经文和问题会发送给 Google。';
      cancel.type='button';cancel.textContent='取消';cancel.addEventListener('click',closeSearch);
      submit.type='submit';submit.textContent='搜索';
      actions.className='paper-search-actions';actions.append(cancel,submit);
      label.appendChild(field);form.append(label,note,actions);
      form.addEventListener('submit',event=>{
        event.preventDefault();
        if(composing||searchForm!==form||!active||!isCurrent(active.anchor))return;
        const url=buildSearchURL(quote,field.value);
        if(!url){field.focus({preventScroll:true});return;}
        // Keep it synchronous with the user's submit gesture; do not pre-open
        // a tab, send a preflight, or share opener/referrer with the provider.
        win.open(url,'_blank','noopener,noreferrer');
        closeSearch();
      });
      searchForm=form;bar.dataset.searchOpen='true';
      bar.querySelector('[data-search]').setAttribute('aria-expanded','true');
      bar.appendChild(form);anchorBar();field.focus({preventScroll:true});
    }
    function initBar(){
      bar=doc.createElement('div');bar.className='paper-selection-tools';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','本页选文');
      function button(name,key,path,fn){
        const b=doc.createElement('button');b.type='button';actionLabel(b,name);b.setAttribute('data-'+key,'');
        const icon=doc.createElementNS(SVG,'svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
        const line=doc.createElementNS(SVG,'path');line.setAttribute('d',path);icon.appendChild(line);b.appendChild(icon);
        b.addEventListener('click',fn);return b;
      }
      bar.append(button('复制','copy','M8 6V4.5A1.5 1.5 0 0 1 9.5 3h9A1.5 1.5 0 0 1 20 4.5v12M5.5 7h9a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7Z',copy),
        button('搜索','search','M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',openSearch),
        button('高亮','highlight','m6 14 8-10a1.4 1.4 0 0 1 2-.2l3.2 2.6a1.4 1.4 0 0 1 .2 2L11 18Zm1.2 1-.8 2.8 1.4 1.1 2.5-1.4M4 21h10',highlight),
        button('退出','exit','m6 6 12 12m0-12L6 18',()=>{reset();stage.focus({preventScroll:true});}));
      bar.querySelector('[data-search]').setAttribute('aria-expanded','false');
      stage.appendChild(bar);
      // Toolbar events must never become paper taps, drags, wheel pans or pinches.
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','wheel'])bar.addEventListener(type,e=>e.stopPropagation());
      bar.addEventListener('keydown',e=>{
        if(searchForm)e.stopPropagation(); // Editing keys must not turn/zoom the book.
        if(e.key==='Escape'){e.stopPropagation();e.preventDefault();if(searchForm)closeSearch();else{reset();stage.focus({preventScroll:true});}}
      });
      if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(stage,{attributes:true,attributeFilter:['data-scale','data-x','data-y']});}
    }
    function sameFace(t){if(t.entry===active.anchor.entry)return true;feedback('只能选择同一页的文字；请先复制或退出');return false;}
    function tap(t){
      if(!isCurrent(t))return false;
      if(active){if(!searchForm&&sameFace(t))toggle(t);return true;}
      clearFocus();focus={key:t.entry.key,unitId:t.unit.id};focusMark=draw(t,'focus');return true;
    }
    function hold(t){
      if(!isCurrent(t))return false;
      if(active){if(!searchForm&&sameFace(t)&&!active.marks.has(t.unit))toggle(t);return true;}
      clearFocus();active={marks:new Map(),anchor:t};stage.dataset.textSelection='active';initBar();toggle(t);stage.focus({preventScroll:true});return true;
    }
    stage.addEventListener('contextmenu',e=>{
      if(e.target?.closest?.('.paper-selection-tools'))return;
      // iOS can send contextmenu before a synthetic click after a touch hold.
      if((e.pointerType!=='mouse'||active)&&hit(e.clientX,e.clientY,e.target))e.preventDefault();
    });
    let syncFrame=null;
    function changed(e){
      if(e.key!=null&&!e.key.startsWith('paper-bible-highlights-v1:'))return;
      if(syncFrame!==null)return;
      const sync=()=>{syncFrame=null;
        // A turning surface temporarily contains the *destination* SVG.
        // Normal finish/return already restores its marks after the handoff.
        if(stage.dataset.foldProgress!==undefined||stage.dataset.jumpState==='running')return;
        refresh();if(active)syncPen();
      };
      if(win.requestAnimationFrame)syncFrame=win.requestAnimationFrame(sync);else sync();
    }
    win.addEventListener?.('storage',changed);
    return {hit,tap,hold,reset,refresh,isActive:()=>!!active,destroy(){reset();stage.removeEventListener?.('copy',keyboardCopy);if(syncFrame!==null)win.cancelAnimationFrame(syncFrame);win.removeEventListener?.('storage',changed);}};
  }
  return {create,indexFace,copyText,formatQuote,clipboardQuote,buildSearchURL,mergeRects,verseBands,physicalRows};
});
