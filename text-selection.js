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
  function create({stage,papers,getPage,commands,feedback=()=>{}}){
    const doc=stage.ownerDocument,win=doc.defaultView,cache=new WeakMap();
    let active=null,bar=null,brief=null,flashTimer=null,serial=0,observer=null,refreshFrame=null;
    function model(side,svg){
      const {page,index,books}=getPage(side),prior=cache.get(svg);
      if(prior?.index===index)return prior;
      const nodes=Array.from(svg.querySelectorAll('text[data-role]'));
      const list=commands(page,index,books).filter(c=>c.role!=='footer-rule');
      if(nodes.length!==list.length)return null; // Never select a stale curl face.
      const entry={svg,index,side,nodes,list,mapping:new WeakMap(),...indexFace(page,list)};
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
    function setStatus(s){if(bar)bar.querySelector('[role=status]').textContent=s;}
    function toggle(t){
      const m=active.marks.get(t.unit);
      if(m){m.remove();active.marks.delete(t.unit);}else active.marks.set(t.unit,draw(t,'selected'));
      active.anchor=t;const {size}=active.marks;
      bar.querySelector('[data-copy]').disabled=!size;
      setStatus('已选 '+size+' 处');anchorBar();
    }
    async function copy(){
      if(!active?.marks.size)return;
      const version=serial,text=copyText(active.marks.keys());
      let ok=false;
      try{if(win.navigator?.clipboard?.writeText){await win.navigator.clipboard.writeText(text);ok=true;}}catch{}
      if(version!==serial||!active)return;
      if(!ok){
        const field=doc.createElement('textarea');field.className='paper-copy-field';
        field.value=text;field.readOnly=true;field.setAttribute('aria-label','已选文字，可手动复制');
        bar.querySelector('.paper-copy-field')?.remove();bar.appendChild(field);field.focus({preventScroll:true});field.select();
        try{ok=doc.execCommand('copy');}catch{}
        if(ok)field.remove();
        else{field.classList.add('manual');setStatus('请选择并复制');field.focus({preventScroll:true});field.select();anchorBar();return;}
      }
      reset();feedback('已复制选中文字');
    }
    function initBar(){
      bar=doc.createElement('div');bar.className='paper-selection-tools';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','本页选文');
      const count=doc.createElement('span');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
      const button=(name,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',fn);return b;};
      const copyButton=button('复制',copy);copyButton.setAttribute('data-copy','');const exit=button('退出',()=>{reset();stage.focus({preventScroll:true});});
      bar.append(count,copyButton,exit);stage.appendChild(bar);
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
    return {hit,tap,hold,reset,isActive:()=>!!active};
  }
  return {create,indexFace,copyText,mergeRects,FLASH_MS};
});
