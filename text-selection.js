/* Select the ink on one physical face. The original SVG remains the only text layer. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PaperTextSelection=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const SVG='http://www.w3.org/2000/svg';

  // Source references, not line numbers: a verse may wrap or cross the gutter
  // between columns. Selection and highlighting stay on this face.
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
  function formatQuote(items,bookName,faceUnits=[],textFor=u=>u.text,chapterBoundary){
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
          (r.ch===p.ch+1&&r.v===1&&(chapterBoundary?chapterBoundary(p):
            refs.includes(prev.group)&&refs.indexOf(u.group)===refs.indexOf(prev.group)+1)));
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
  // The reviewed ink and tags are the same source the renderer uses. Never
  // infer continuation from an adjacent page's text or substitute another edition.
  function physicalClipboardQuote(items,bookName,faceUnits,db,index){
    const local=()=>clipboardQuote(items,bookName,faceUnits),page=db?.pages[index];
    if(!page||page.b<0)return local();
    const selected=new Map(),neighbors=[];
    for(const unit of items){
      if(!verseOf(unit))continue;
      if(!selected.has(unit.group))selected.set(unit.group,[]);
      selected.get(unit.group).push(unit);
    }
    for(const step of [-1,1]){
      let groups=new Set(selected.keys());
      for(let n=index+step;groups.size&&db.pages[n]?.b===page.b;n+=step){
        const tags=db.tags(n);
        groups=new Set(tags.filter(t=>t.role==='body'&&groups.has(t.group)).map(t=>t.group));
        if(groups.size)neighbors.push({n,tags,groups});
      }
    }
    if(!neighbors.length)return local();
    const additions=new Map();
    for(const {n,tags,groups} of neighbors.sort((a,b)=>a.n-b.n)){
      const ink=db.get(n)?.[3];
      if(!ink)throw Error('Missing continuation page');
      tags.forEach((t,j)=>{
        if(t.role!=='body'||!groups.has(t.group))return;
        if(!additions.has(t.group))additions.set(t.group,['','']);
        additions.get(t.group)[n<index?0:1]+=ink[j][4];
      });
    }
    const prefix=new Map(),suffix=new Map();
    for(const [group,[before,after]] of additions){
      const units=selected.get(group).sort((a,b)=>a.order-b.order);
      prefix.set(units[0],before);suffix.set(units.at(-1),after);
    }
    return formatQuote(items,bookName,faceUnits,u=>clipboardText((prefix.get(u)||'')+u.text+(suffix.get(u)||'')));
  }
  function pagesClipboardQuote(faces,db){
    const pages=[...faces].sort((a,b)=>a.index-b.index),blocks=[];
    for(let i=0;i<pages.length;){
      const a=pages[i],physical=db?.pages[a.index]===a.page;
      if(!physical||a.page.b<0){
        blocks.push(clipboardQuote(a.selected.values(),a.bookName,a.units));i++;continue;
      }
      let j=i+1;while(j<pages.length&&db.pages[pages[j].index]===pages[j].page&&pages[j].page.b===a.page.b)j++;
      if(j===i+1){blocks.push(physicalClipboardQuote([...a.selected.values()],a.bookName,a.units,db,a.index));i=j;continue;}
      const selected=[],refs=new Map(),tagCache=new Map(),stride=1000000;
      function fragments(n){
        if(!tagCache.has(n)){
          const groups=new Map();
          db.tags(n).forEach((tag,k)=>{
            if(tag.role!=='body'||!tag.group)return;
            if(!groups.has(tag.group))groups.set(tag.group,[]);
            groups.get(tag.group).push(k);
          });
          tagCache.set(n,groups);
        }
        return tagCache.get(n);
      }
      for(const face of pages.slice(i,j))for(const u of face.selected.values()){
        selected.push({...u,order:face.index*stride+u.order});
        if(verseOf(u)){
          if(!refs.has(u.group))refs.set(u.group,new Set());
          refs.get(u.group).add(face.index);
        }
      }
      // Preserve the entire split verse, without repeating already selected ink.
      for(const [group,seeds] of refs){
        const seen=new Set(seeds);
        for(const seed of seeds)for(const step of [-1,1]){
          for(let n=seed+step;!seen.has(n)&&db.pages[n]?.b===a.page.b;n+=step){
            const indices=fragments(n).get(group);if(!indices?.length)break;
            const ink=db.get(n)?.[3];if(!ink)throw Error('Missing continuation page');
            seen.add(n);selected.push({group,order:n*stride+indices[0],text:indices.map(k=>ink[k][4]).join('')});
          }
        }
      }
      const book=db.books[a.page.b];
      blocks.push(formatQuote(selected,a.bookName,[],u=>clipboardText(u.text),p=>book.versePages[p.ch-1]?.length===p.end));
      i=j;
    }
    return blocks.filter(Boolean).join('\n');
  }
  // Each provider owns only query construction. No network work until submit.
  const searchProviders=Object.freeze({
    google(query){const url=new URL('https://www.google.com/search');url.searchParams.set('q',query);return url.href;}
  });
  function buildSearchURL(quote,question,provider='google'){
    if(!quote?.trim()||!question?.trim()||!Object.hasOwn(searchProviders,provider))return null;
    return searchProviders[provider](quote.trim()+'\n\n'+question.trim());
  }
  function actionLabel(button,text){button.setAttribute('aria-label',text);button.setAttribute('title',text);}
  function makeToolbar(doc,actions,label,floatLabel='在浮窗阅读'){
    const bar=doc.createElement('div');bar.className='paper-selection-tools';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label',label);
    const items=[
      ['复制','copy','M8 6V4.5A1.5 1.5 0 0 1 9.5 3h9A1.5 1.5 0 0 1 20 4.5v12M5.5 7h9a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7Z'],
      ['网页搜索','search','M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
      ['高亮','highlight','m6 14 8-10a1.4 1.4 0 0 1 2-.2l3.2 2.6a1.4 1.4 0 0 1 .2 2L11 18Zm1.2 1-.8 2.8 1.4 1.1 2.5-1.4M4 21h10'],
      [floatLabel,'float','M8 8h13v12H8zM16 8V4H3v12h5m8-5v4h-4'],
      ['退出','exit','m6 6 12 12m0-12L6 18']
    ];
    for(const [name,key,d] of items){
      if(!actions[key])continue;
      const b=doc.createElement('button');b.type='button';actionLabel(b,name);b.setAttribute('data-'+key,'');
      const icon=doc.createElementNS(SVG,'svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
      const line=doc.createElementNS(SVG,'path');line.setAttribute('d',d);icon.appendChild(line);b.appendChild(icon);
      if(key==='search')b.setAttribute('aria-expanded','false');
      b.addEventListener('click',actions[key]);bar.appendChild(b);
    }
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','wheel'])bar.addEventListener(type,e=>e.stopPropagation());
    return bar;
  }
  function makeSearchForm(doc,win,quote,{valid,cancel,done}){
    const form=doc.createElement('form'),label=doc.createElement('label'),field=doc.createElement('input');
    const note=doc.createElement('small'),actions=doc.createElement('div'),back=doc.createElement('button'),submit=doc.createElement('button');
    form.className='paper-search-form';form.setAttribute('role','search');form.setAttribute('aria-label','搜索所选经文');
    label.textContent='想问这段经文什么？';
    field.type='text';field.name='question';field.required=true;field.autocomplete='off';field.enterKeyHint='search';field.placeholder='输入你的问题';
    let composing=false;
    field.addEventListener('compositionstart',()=>{composing=true;});
    field.addEventListener('compositionend',()=>{composing=false;});
    note.textContent='点击搜索后，所选经文和问题会发送给 Google。';
    back.type='button';back.textContent='取消';back.addEventListener('click',cancel);
    submit.type='submit';submit.textContent='搜索';
    actions.className='paper-search-actions';actions.append(back,submit);
    label.appendChild(field);form.append(label,note,actions);
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(composing||!valid(form))return;
      const url=buildSearchURL(quote,field.value);
      if(!url){field.focus({preventScroll:true});return;}
      // Submit is the first point at which either the question or the
      // selected text can leave the page.
      win.open(url,'_blank','noopener,noreferrer');done();
    });
    return {form,field};
  }
  async function writeText(win,text){
    try{if(win.navigator?.clipboard?.writeText){await win.navigator.clipboard.writeText(text);return true;}}catch{}
    return false;
  }
  function fallbackCopy(doc,bar,text){
    const field=doc.createElement('textarea');field.className='paper-copy-field';
    field.value=text;field.readOnly=true;field.setAttribute('aria-label','已选文字，可手动复制');
    bar.querySelector('.paper-copy-field')?.remove();bar.appendChild(field);field.focus({preventScroll:true});field.select();
    let ok=false;try{ok=doc.execCommand('copy');}catch{}
    if(ok)field.remove();
    else{field.classList.add('manual');field.focus({preventScroll:true});field.select();}
    return ok;
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
  function create({stage,papers,getPage,commands,storage,feedback=()=>{},crossPage=false,onFloat,onBegin,onMarksChange,scripture}){
    const doc=stage.ownerDocument,win=doc.defaultView,cache=new WeakMap(),session=new Map(),painted=new Map();
    let active=null,bar=null,searchForm=null,focus=null,focusMark=null,serial=0,observer=null,refreshFrame=null,suspended=false;
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
      const entry={svg,index,side,nodes,list,mapping:new WeakMap(),bookName:book?.name,key,page,...indexFace(page,list)};
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
        const bounds={
          x:b.x-.7,y:b.y-.18*b.height,width:b.width+1.4,height:1.36*b.height,rx:1.3
        };
        for(const [k,v] of Object.entries(bounds))rect.setAttribute(k,String(v));
        g.appendChild(rect);
      }
      svg.insertBefore(g,entry.nodes[0]);return g;
    }
    const markKey=(index,id)=>index+'|'+id;
    function clearPaint(){for(const mark of painted.values())mark.remove();painted.clear();}
    const location=(page,u)=>({page,ref:verseOf(u)?u.group.slice(6):null});
    function verseKey(index,unit){
      const loc=location(index,unit);
      return loc.ref?scripture.resolve(loc).map(r=>r.id).join('+'):'';
    }
    function paintSelection(){
      clearPaint();
      if(!active?.count)return;
      papers.forEach((paper,side)=>{
        const svg=paper.querySelector('svg'),{index}=getPage(side);
        if(!svg||(!scripture&&!active.faces.has(index)))return;
        const entry=model(side,svg);if(!entry)return;
        const face=active.faces.get(index);
        for(const unit of entry.units){
          const selected=scripture?active.refs.has(verseKey(index,unit)):face?.selected.has(unit.id);
          if(selected)painted.set(markKey(index,unit.id),draw({entry,unit},'selected'));
        }
      });
    }
    function refresh(){
      clearPaint();
      papers.forEach((paper,side)=>{
        const svg=paper.querySelector('svg');if(!svg)return;
        // A cancelled curl can restore a serialized SVG already containing
        // these groups. Rebuild rather than drawing a second translucent coat.
        for(const kind of ['saved','focus','selected'])for(const g of svg.querySelectorAll('.paper-ink-mark--'+kind))g.remove();
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
      paintSelection();
      suspended=false;if(bar){bar.hidden=false;anchorBar();}
    }
    function clearFocus(){focusMark?.remove();focusMark=null;focus=null;}
    function isCurrent(t){return t&&getPage(t.entry.side).index===t.entry.index&&papers[t.entry.side].querySelector('svg')===t.entry.svg;}
    function reset({keepFocus=false}={}){
      serial++;if(!keepFocus)clearFocus();if(refreshFrame!==null)win.cancelAnimationFrame(refreshFrame);refreshFrame=null;observer?.disconnect();observer=null;
      clearPaint();active=null;suspended=false;
      bar?.remove();bar=null;searchForm=null;delete stage.dataset.textSelection;
    }
    function suspend(){
      if(searchForm){reset({keepFocus:true});return;}
      if(!active)return;
      suspended=true;if(bar)bar.hidden=true;
    }
    function anchorBar(){
      if(!bar||!active||suspended)return;
      const {side,index,point,svg:old}=active.anchor,r=stage.getBoundingClientRect(),svg=papers[side].querySelector('svg');
      const sheet=svg?.getBoundingClientRect(),scale=sheet?.width/480;
      if(!crossPage&&(getPage(side).index!==index||svg!==old)){reset();return;}
      if(!scale||!r.width||!r.height)return;
      const px=sheet.left-r.left+point.x*scale,py=sheet.top-r.top+point.y*scale;
      // Touch hit testing may snap a nearby verse tap to an anchored
      // toolbar button (including Exit), even outside its visible bounds.
      const touch=win.matchMedia?.('(pointer: coarse)')?.matches;
      if(crossPage&&!searchForm&&(touch||r.width<560||getPage(side).index!==index||px<0||px>r.width||py<0||py>r.height)){
        bar.dataset.docked='';bar.style.maxWidth=Math.max(1,r.width-12)+'px';
        bar.style.setProperty('--ink-hit-pad','0px');bar.style.left='50%';bar.style.top='6px';bar.style.transform='translateX(-50%)';return;
      }
      delete bar.dataset.docked;
      const displayScale=searchForm?1:scale;
      bar.style.maxWidth=Math.max(1,(r.width-12)/displayScale)+'px';bar.style.transform='scale('+displayScale+')';
      // Extra transparent hit padding, in screen pixels, never magnifies the ink.
      bar.style.setProperty('--ink-hit-pad',Math.max(0,(40/scale-29)/2)+'px');
      const bounds=bar.getBoundingClientRect(),pad=6,gap=14*scale;
      const within=(v,a,b)=>Math.max(a,Math.min(v,Math.max(a,b)));
      // Use the visible selected ink, not just the last touch point. If the
      // selection is tall, prefer an available side before overlaying it.
      const rects=[...painted.values()].map(m=>m.getBoundingClientRect()).filter(b=>b.width&&b.height&&Number.isFinite(b.right)&&b.right>r.left&&b.left<r.left+r.width&&b.bottom>r.top&&b.top<r.top+r.height);
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
    const print=scripture&&win.V25OriginalData,printedUnits=new Map();
    const fallbackTarget=row=>({key:'paper-bible-highlights-v1:library:'+row.id,id:'verse'});
    function printedPage(index,code){
      const page=print?.pages[index],book=print?.books[page?.b];
      return book?.code===code?{page,book,key:recordKey(page,index,book)}:null;
    }
    function printedTargets(index,code,id){
      const face=printedPage(index,code);
      if(!face)return [];
      let byVerse=printedUnits.get(index);
      if(!byVerse){
        byVerse=new Map();
        const list=commands(face.page,index,print.books).filter(c=>c.role!=='footer-rule');
        for(const u of indexFace(face.page,list).units){
          if(!verseOf(u))continue;
          for(const row of scripture.resolve(location(index,u))){
            if(!byVerse.has(row.id))byVerse.set(row.id,[]);
            byVerse.get(row.id).push({key:face.key,id:u.id});
          }
        }
        if(printedUnits.size>=24)printedUnits.delete(printedUnits.keys().next().value);
        printedUnits.set(index,byVerse);
      }
      return byVerse.get(id)||[];
    }
    function targetsFor(row){
      // The physical key remains the interoperable annotation store. Walk
      // both directions from the verse's first leaf for any split fragments.
      const hits=Number.isInteger(row.page)?[...printedTargets(row.page,row.code,row.id)]:[];
      if(Number.isInteger(row.page))for(const dir of [-1,1]){
        for(let n=row.page+dir;;n+=dir){
          const part=printedTargets(n,row.code,row.id);
          if(!part.length)break;
          hits.push(...part);
        }
      }
      return hits.length?hits:[fallbackTarget(row)];
    }
    function verseMarksReader(){
      const memo=new Map();
      const marks=key=>{if(!memo.has(key))memo.set(key,pageMarks(key));return memo.get(key);};
      return row=>{
        // Most pages have no marks; avoid reconstructing their print units
        // simply because a floating chapter is scrolled into view.
        const possible=Number.isInteger(row.page)&&[-1,0,1].some(offset=>{
          const p=printedPage(row.page+offset,row.code);return p&&marks(p.key).possible;
        });
        if(!possible){
          const f=fallbackTarget(row);return marks(f.key).has(f.id);
        }
        return targetsFor(row).every(({key,id})=>marks(key).has(id));
      };
    }
    function writeMarks(entries,value){
      let durable=true;
      for(const {key,id} of entries){
        try{storage.setItem(key+'~used','1');storage.setItem(unitKey(key,id),value?'1':'0');session.get(key)?.delete(id);}
        catch{durable=false;if(!session.has(key))session.set(key,new Map());session.get(key).set(id,value);}
      }
      return durable;
    }
    function changedMarks(){
      // The exposed under-sheet during a turn may be a destination face.
      // Never refresh that SVG with marks from the current spread.
      if(stage.dataset.foldProgress===undefined&&stage.dataset.jumpState!=='running'&&stage.dataset.foldState!=='dragging')refresh();
      onMarksChange?.();
    }
    const verseHighlights=scripture&&{
      reader:verseMarksReader,
      toggle(rows){
        if(!rows.length)return null;
        const remove=rows.every(verseMarksReader()),entries=new Map();
        for(const row of rows)for(const item of targetsFor(row))entries.set(item.key+'|'+item.id,item);
        const durable=writeMarks(entries.values(),!remove);changedMarks();
        return {remove,durable};
      }
    };
    function highlightEntries(){
      const result=new Map(),add=(key,id)=>result.set(key+'|'+id,{key,id});
      const db=scripture&&win.V25OriginalData;
      for(const face of active.faces.values())for(const unit of face.selected.values()){
        add(face.key,unit.id);
        if(!db)continue;
        // Keep existing print annotation IDs, including both fragments of a
        // single logical verse. They are not the source of its copied text.
        const book=db.books[face.page.b],ref=verseKey(face.index,unit);
        for(const step of [-1,1])for(let n=face.index+step;db.pages[n]?.b===face.page.b;n+=step){
          if(!db.tags(n).some(t=>t.role==='body'&&t.ref===unit.group.slice(6)))break;
          const p=db.pages[n],key=recordKey(p,n,book),list=commands(p,n,db.books).filter(c=>c.role!=='footer-rule');
          for(const u of indexFace(p,list).units)if(verseKey(n,u)===ref)add(key,u.id);
        }
      }
      return [...result.values()];
    }
    function allSaved(){return !!active.count&&(active.highlights??=highlightEntries()).every(({key,id})=>pageMarks(key).has(id));}
    function highlight(){
      if(!active?.count)return;
      const remove=allSaved();
      const durable=writeMarks(active.highlights,!remove);
      reset();changedMarks();feedback((remove?'已取消高亮':'已高亮')+(durable?'':'（仅本次阅读）'));
    }
    function toggle(t){
      serial++;
      const {index,side,key,bookName,page,units,svg}=t.entry,id=t.unit.id,k=markKey(index,id);
      const ref=scripture?verseKey(index,t.unit):null;
      if(scripture&&!ref){feedback('请选择有经文节号的正文');return;}
      const picked=ref?active.refs.get(ref):null,previous=picked||{index,id};
      const old=active.faces.get(previous.index);
      if(old?.selected.delete(previous.id)){
        const oldKey=markKey(previous.index,previous.id);
        painted.get(oldKey)?.remove();painted.delete(oldKey);active.count--;
        if(ref)active.refs.delete(ref);
        if(!old.selected.size)active.faces.delete(previous.index);
      }else{
        let face=active.faces.get(index);
        if(!face){face={index,key,bookName,page,units,selected:new Map()};active.faces.set(index,face);}
        face.selected.set(id,t.unit);active.count++;
        if(ref)active.refs.set(ref,{index,id});
        else painted.set(k,draw(t,'selected'));
      }
      if(scripture)paintSelection();
      active.highlights=null;
      active.anchor={index,side,point:t.point,...(!crossPage&&{svg})};
      bar.querySelector('.paper-copy-field')?.remove();syncPen();anchorBar();
    }
    function syncPen(){
      const size=active.count;
      bar.querySelector('[data-copy]').disabled=!size;
      bar.querySelector('[data-search]').disabled=!size;
      if(onFloat)bar.querySelector('[data-float]').disabled=!size;
      if(crossPage){
        bar.dataset.pages=String(active.faces.size);
        bar.setAttribute('aria-label',size?'经文选区，已选 '+size+' 项':'经文选区');
      }
      const pen=bar.querySelector('[data-highlight]'),marked=allSaved();
      pen.disabled=!size;pen.setAttribute('aria-pressed',String(marked));actionLabel(pen,marked?'取消高亮':'高亮');
    }
    // Clipboard event for Ctrl/Cmd+C on the focused paper reader. Inputs
    // (including the search box and manual-copy fallback) keep normal Copy.
    function selectionQuote(){
      if(scripture)return scripture.quote(pickedLocations());
      return pagesClipboardQuote(active.faces.values(),win.V25OriginalData);
    }
    function keyboardCopy(e){
      if(!active?.count||searchForm&&crossPage||suspended||!e.clipboardData||
        e.target?.closest?.('textarea,input,[contenteditable]'))return;
      let text;
      try{text=selectionQuote();}catch{e.preventDefault();feedback('未能读取完整经文，请重试');return;}
      try{e.clipboardData.setData('text/plain',text);}
      catch{return;}
      e.preventDefault();reset();feedback('\u5df2\u590d\u5236\u9009\u4e2d\u6587\u5b57');
    }
    stage.addEventListener('copy',keyboardCopy);
    async function copy(){
      if(!active?.count||suspended)return;
      const version=serial;
      let text;
      try{text=selectionQuote();}catch{feedback('未能读取完整经文，请重试');return;}
      const ok=await writeText(win,text);
      if(version!==serial||!active)return;
      if(!ok&&!fallbackCopy(doc,bar,text)){feedback('浏览器未允许自动复制，请手动复制已选文字');anchorBar();return;}
      reset();feedback('已复制选中文字');
    }
    function closeSearch(){
      if(!searchForm)return;
      if(crossPage){reset();stage.focus({preventScroll:true});return;}
      searchForm.remove();searchForm=null;delete bar.dataset.searchOpen;
      const search=bar.querySelector('[data-search]');
      search.setAttribute('aria-expanded','false');anchorBar();search.focus({preventScroll:true});
    }
    function openSearch(){
      if(searchForm||!active?.count)return;
      let quote;try{quote=selectionQuote();}catch{feedback('未能读取完整经文，请重试');return;}
      if(!quote.trim())return;
      const {form,field}=makeSearchForm(doc,win,quote,{valid:form=>searchForm===form&&!!active,cancel:closeSearch,done:closeSearch});
      searchForm=form;bar.dataset.searchOpen='true';
      if(crossPage){serial++;active.faces.clear();active.refs.clear();active.count=0;clearPaint();delete stage.dataset.textSelection;}
      bar.querySelector('[data-search]').setAttribute('aria-expanded','true');
      bar.appendChild(form);anchorBar();field.focus({preventScroll:true});
    }
    const pickedLocations=()=>[...active.faces.values()].flatMap(face=>[...face.selected.values()].map(unit=>location(face.index,unit)));
    function floatSelection(){if(active?.count&&onFloat(pickedLocations()))reset();}
    function initBar(){
      bar=makeToolbar(doc,{copy,search:openSearch,highlight,float:onFloat&&floatSelection,
        exit:()=>{reset();stage.focus({preventScroll:true});}},crossPage?'经文选区':'本页选文');
      stage.appendChild(bar);
      bar.addEventListener('keydown',e=>{
        if(searchForm)e.stopPropagation(); // Editing keys must not turn/zoom the book.
        if(e.key==='Escape'){e.stopPropagation();e.preventDefault();if(searchForm)closeSearch();else{reset();stage.focus({preventScroll:true});}}
      });
      if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(stage,{attributes:true,attributeFilter:['data-scale','data-x','data-y']});}
    }
    function sameFace(t){if(crossPage||t.entry.svg===active.anchor.svg)return true;feedback('只能选择同一页的文字；请先复制或退出');return false;}
    function tap(t){
      if(!isCurrent(t))return false;
      if(searchForm&&crossPage)reset();
      if(active){if(!searchForm&&sameFace(t))toggle(t);return true;}
      clearFocus();focus={key:t.entry.key,unitId:t.unit.id};focusMark=draw(t,'focus');return true;
    }
    function hold(t){
      if(!isCurrent(t))return false;
      if(searchForm&&crossPage)reset();
      const ref=scripture&&verseKey(t.entry.index,t.unit);
      if(scripture&&!ref){feedback('请选择有经文节号的正文');return false;}
      if(active){if(!searchForm&&sameFace(t)&&!(ref?active.refs.has(ref):active.faces.get(t.entry.index)?.selected.has(t.unit.id)))toggle(t);return true;}
      onBegin?.();clearFocus();active={faces:new Map(),refs:new Map(),count:0,anchor:null};stage.dataset.textSelection='active';initBar();toggle(t);stage.focus({preventScroll:true});return true;
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
        changedMarks();if(active)syncPen();
      };
      if(win.requestAnimationFrame)syncFrame=win.requestAnimationFrame(sync);else sync();
    }
    win.addEventListener?.('storage',changed);
    return {hit,tap,hold,reset,refresh,suspend,verseHighlights,isActive:()=>!!active&&(!crossPage||!searchForm),destroy(){reset();stage.removeEventListener?.('copy',keyboardCopy);if(syncFrame!==null)win.cancelAnimationFrame(syncFrame);win.removeEventListener?.('storage',changed);}};
  }
  return {create,indexFace,copyText,formatQuote,clipboardQuote,physicalClipboardQuote,pagesClipboardQuote,clipboardText,buildSearchURL,makeToolbar,makeSearchForm,writeText,fallbackCopy,actionLabel,mergeRects,verseBands,physicalRows};
});
