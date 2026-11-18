/* Select the ink on one physical face. The original SVG remains the only text layer. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PaperTextSelection=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const SVG='http://www.w3.org/2000/svg',FLASH_MS=2700;

  // Source references, not line numbers: a verse may wrap or cross the gutter
  // between columns. Only commands drawn on this face are included in the copy.
  function indexFace(page,commands){
    const groups=new Map(),lookup=commands.map(()=>[]),units=[];
    let rowKey='',ref=page.start||'1:1';
    function group(key){if(!groups.has(key))groups.set(key,{key,chars:[],marks:[]});return groups.get(key);}
    commands.forEach((c,i)=>{
      const text=String(c.text||'');if(!text||c.role==='blank-mark')return;
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
  function copyText(items){
    return Array.from(items).sort((a,b)=>a.order-b.order).reduce((state,unit)=>{
      const join=!state.prev?'':state.prev.word&&unit.word&&state.prev.group===unit.group?' ':'\n';
      state.text+=join+unit.text;state.prev=unit;return state;
    },{text:'',prev:null}).text;
  }
  function verseOf(unit){
    const m=/^verse:(\d+):(\d+)(?:[-–](\d+))?$/.exec(unit.group);
    return m?{ch:+m[1],v:+m[2],end:+(m[3]||m[2])}:null;
  }
  function formatQuote(items,bookName,faceUnits=[]){
    const list=Array.from(items).sort((a,b)=>a.order-b.order);
    if(!bookName||!list.some(verseOf))return copyText(list);
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
        body+=u.text;
        if(!same){if(consecutive)spans.at(-1).end=r;else spans.push({start:r,end:r});}
        prev=u;
      }
      const address=spans.map(({start:a,end:b},i)=>{
        const begin=(i&&spans[i-1].end.ch===a.ch?'':a.ch+':')+a.v;
        return begin+(a.ch===b.ch&&a.v===b.end?'':'-'+(a.ch===b.ch?'':b.ch+':')+b.end);
      }).join(',');
      blocks.push(body+'\n( '+bookName+' '+address+' 和合本 )');passages=[];
    }
    function plain(){if(other.length){blocks.push(copyText(other));other=[];}}
    for(const u of list){if(verseOf(u)){plain();passages.push(u);}else{scripture();other.push(u);}}
    scripture();plain();return blocks.join('\n');
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
  function create({stage,papers,getPage,commands,storage,feedback=()=>{}}){
    const doc=stage.ownerDocument,win=doc.defaultView,cache=new WeakMap(),records=new Map();
    let active=null,bar=null,brief=null,flashTimer=null,serial=0,observer=null,refreshFrame=null;
    const recordKey=(page,index,book)=>['paper-bible-highlights-v1',book?.code||page.frontmatter||'cover',index,page.start||'',page.end||''].join(':');
    function savedFor(key){
      if(records.has(key))return records.get(key);
      let ids;try{ids=JSON.parse(storage?.getItem(key)||'[]');}catch{}
      const set=new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]);records.set(key,set);return set;
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
      let n;try{n=node.getCharNumAtPosition(point);}catch{return null;}
      const unit=entry.lookup[i]?.[n];return unit?{entry,unit,point:{x:point.x,y:point.y}}:null;
    }
    function draw(token,mode){
      const {entry,unit}=token,svg=entry.svg,boxes=[];
      for(const {i,start,end} of unit.parts){
        const node=entry.nodes[i],c=entry.list[i],line=[c.column,c.row,c.y].join('/');
        let rects=[];
        try{
          if(start===0&&end===c.text.length)rects=[node.getBBox()];
          else for(let j=start;j<end;j++)rects.push(node.getExtentOfChar(j));
        }catch{continue;}
        for(const r of rects)boxes.push({x:r.x,y:r.y,width:r.width,height:r.height,line});
      }
      const g=doc.createElementNS(SVG,'g');
      g.setAttribute('class','paper-ink-mark paper-ink-mark--'+mode);g.setAttribute('aria-hidden','true');g.setAttribute('pointer-events','none');
      for(const b of mergeRects(boxes)){
        const rect=doc.createElementNS(SVG,'rect');
        for(const [k,v] of Object.entries({x:b.x-.5,y:b.y+.06*b.height,width:b.width+1,height:.90*b.height,rx:1.1}))rect.setAttribute(k,String(v));
        g.appendChild(rect);
      }
      svg.insertBefore(g,entry.nodes[0]);return g;
    }
    function refresh(){
      papers.forEach((paper,side)=>{
        const svg=paper.querySelector('svg');if(!svg)return;
        // A cancelled curl can restore a serialized SVG already containing
        // these groups. Rebuild rather than drawing a second translucent coat.
        for(const g of svg.querySelectorAll('.paper-ink-mark--saved'))g.remove();
        const {page,index,books}=getPage(side),saved=savedFor(recordKey(page,index,books[page.b]));
        if(!saved.size)return;
        const entry=model(side,svg);if(!entry)return;
        for(const unit of entry.units)if(saved.has(unit.id))draw({entry,unit},'saved');
      });
    }
    function clearBrief(){if(flashTimer!==null)win.clearTimeout(flashTimer);flashTimer=null;brief?.remove();brief=null;}
    function isCurrent(t){return t&&getPage(t.entry.side).index===t.entry.index&&papers[t.entry.side].querySelector('svg')===t.entry.svg;}
    function reset(){
      serial++;clearBrief();if(refreshFrame!==null)win.cancelAnimationFrame(refreshFrame);refreshFrame=null;observer?.disconnect();observer=null;
      if(active){for(const mark of active.marks.values())mark.remove();active=null;}
      bar?.remove();bar=null;delete stage.dataset.textSelection;
    }
    function anchorBar(){
      if(!bar||!active)return;
      if(!isCurrent(active.anchor)){reset();return;}
      const {entry,point}=active.anchor,sheet=entry.svg.getBoundingClientRect(),r=stage.getBoundingClientRect(),scale=sheet.width/480;
      if(!scale||!r.width||!r.height)return;
      bar.style.maxWidth=Math.max(1,(r.width-12)/scale)+'px';bar.style.transform='scale('+scale+')';
      // Extra transparent hit padding, in screen pixels, never magnifies the ink.
      bar.style.setProperty('--ink-hit-pad',Math.max(0,(40/scale-29)/2)+'px');
      const bounds=bar.getBoundingClientRect(),pad=6,gap=14*scale,px=sheet.left-r.left+point.x*scale,py=sheet.top-r.top+point.y*scale;
      const within=(v,a,b)=>Math.max(a,Math.min(v,Math.max(a,b)));
      bar.style.left=within(px-bounds.width*.5,pad,r.width-bounds.width-pad)+'px';
      const upper=py-gap-bounds.height;
      bar.style.top=within(upper>=pad?upper:py+gap,pad,r.height-bounds.height-pad)+'px';
    }
    function schedule(){if(active&&refreshFrame===null)refreshFrame=win.requestAnimationFrame(()=>{refreshFrame=null;anchorBar();});}
    function actionLabel(b,text){b.setAttribute('aria-label',text);b.setAttribute('title',text);}
    function allSaved(){const saved=savedFor(active.anchor.entry.key);return !!active.marks.size&&Array.from(active.marks.keys()).every(u=>saved.has(u.id));}
    function highlight(){
      if(!active?.marks.size)return;
      const key=active.anchor.entry.key,ids=savedFor(key),remove=allSaved();
      for(const unit of active.marks.keys())if(remove)ids.delete(unit.id);else ids.add(unit.id);
      let durable=true;try{if(!storage)durable=false;else if(!ids.size&&storage.removeItem)storage.removeItem(key);
        else storage.setItem(key,JSON.stringify([...ids]));}catch{durable=false;}
      reset();refresh();feedback((remove?'已取消高亮':'已高亮')+(durable?'':'（仅本次阅读）'));
    }
    function toggle(t){
      const m=active.marks.get(t.unit);
      if(m){m.remove();active.marks.delete(t.unit);}else active.marks.set(t.unit,draw(t,'selected'));
      active.anchor=t;const {size}=active.marks;
      bar.querySelector('[data-copy]').disabled=!size;
      const pen=bar.querySelector('[data-highlight]'),marked=allSaved();
      pen.disabled=!size;pen.setAttribute('aria-pressed',String(marked));actionLabel(pen,marked?'取消高亮':'高亮');anchorBar();
    }
    async function copy(){
      if(!active?.marks.size)return;
      const version=serial,{entry}=active.anchor,text=formatQuote(active.marks.keys(),entry.bookName,entry.units);
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
    function initBar(){
      bar=doc.createElement('div');bar.className='paper-selection-tools';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','本页选文');
      function button(name,key,path,fn){
        const b=doc.createElement('button');b.type='button';actionLabel(b,name);b.setAttribute('data-'+key,'');
        const icon=doc.createElementNS(SVG,'svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
        const line=doc.createElementNS(SVG,'path');line.setAttribute('d',path);icon.appendChild(line);b.appendChild(icon);
        b.addEventListener('click',fn);return b;
      }
      bar.append(button('复制','copy','M8 6V4.5A1.5 1.5 0 0 1 9.5 3h9A1.5 1.5 0 0 1 20 4.5v12M5.5 7h9a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7Z',copy),
        button('高亮','highlight','m6 14 8-10a1.4 1.4 0 0 1 2-.2l3.2 2.6a1.4 1.4 0 0 1 .2 2L11 18Zm1.2 1-.8 2.8 1.4 1.1 2.5-1.4M4 21h10',highlight),
        button('退出','exit','m6 6 12 12m0-12L6 18',()=>{reset();stage.focus({preventScroll:true});}));
      stage.appendChild(bar);
      // Toolbar events must never become paper taps, drags, wheel pans or pinches.
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','wheel'])bar.addEventListener(type,e=>e.stopPropagation());
      bar.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();reset();stage.focus({preventScroll:true});}});
      if(win.MutationObserver){observer=new win.MutationObserver(schedule);observer.observe(stage,{attributes:true,attributeFilter:['data-scale','data-x','data-y']});}
    }
    function sameFace(t){if(t.entry===active.anchor.entry)return true;feedback('只能选择同一页的文字；请先复制或退出');return false;}
    function tap(t){
      if(!isCurrent(t))return false;
      if(active){if(sameFace(t))toggle(t);return true;}
      clearBrief();brief=draw(t,'brief');flashTimer=win.setTimeout(clearBrief,FLASH_MS);return true;
    }
    function hold(t){
      if(!isCurrent(t))return false;
      if(active){if(sameFace(t)&&!active.marks.has(t.unit))toggle(t);return true;}
      clearBrief();active={marks:new Map(),anchor:t};stage.dataset.textSelection='active';initBar();toggle(t);return true;
    }
    stage.addEventListener('contextmenu',e=>{
      if(e.target?.closest?.('.paper-selection-tools'))return;
      // iOS can send contextmenu before a synthetic click after a touch hold.
      if((e.pointerType!=='mouse'||active)&&hit(e.clientX,e.clientY,e.target))e.preventDefault();
    });
    return {hit,tap,hold,reset,refresh,isActive:()=>!!active};
  }
  return {create,indexFace,copyText,formatQuote,mergeRects,FLASH_MS};
});
