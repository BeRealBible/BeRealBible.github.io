/* A chapter leaf measured in book units, hinged to a bookmark in the fixed portal. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdgeChapters=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:360,MARGIN:12,MIN_TARGET:28,DESKTOP_CELL:24,MOBILE_BREAKPOINT:560,PADDING:38,NUMBER_GAP:1,NUMBER_GUTTER:10,PREVIEW_GAP:12});
  let instance=0;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  function chapterEntries(book){
    return (Array.isArray(book?.chapters)?book.chapters:[]).filter(entry=>Number.isInteger(entry.chapter)&&entry.chapter>0&&Number.isInteger(entry.page)&&entry.page>=0)
      .map(entry=>({chapter:entry.chapter,page:entry.page})).sort((a,b)=>a.chapter-b.chapter);
  }
  function menuSize(count,mode='numbers',viewportWidth=360,viewportHeight=640,memberCount=1,available={}){
    if(mode!=='numbers'&&mode!=='preview')throw new TypeError('Chapter menu mode must be numbers or preview');
    const chapters=Math.max(0,Math.floor(finite(count))),vw=Math.max(1,finite(viewportWidth,360)),vh=Math.max(1,finite(viewportHeight,640));
    const availableWidth=Math.max(1,Math.min(vw-2*constants.MARGIN,finite(available.width,Infinity)));
    const availableHeight=Math.max(1,Math.min(vh-2*constants.MARGIN,finite(available.height,Infinity)));
    let width,columns;
    if(mode==='preview'){
      columns=chapters<=8?1:2;
      if(availableWidth<410)columns=1;
      width=Math.min(columns===1?274:460,availableWidth);
    }else{
      const cell=(available.mobile??(vw<constants.MOBILE_BREAKPOINT))?constants.MIN_TARGET:constants.DESKTOP_CELL;
      columns=chapters<=8?Math.max(1,chapters):chapters<=80?8:10;
      columns=Math.min(columns,Math.max(1,Math.floor((availableWidth-constants.PADDING-constants.NUMBER_GUTTER+constants.NUMBER_GAP)/(cell+constants.NUMBER_GAP))));
      width=Math.min(availableWidth,Math.max(220,columns*cell+(columns-1)*constants.NUMBER_GAP+constants.PADDING+constants.NUMBER_GUTTER));
    }
    // A shared cut can hold several books. Let its continuous list use the
    // available space, without making a short directory taller than its content.
    return {width,columns,maxHeight:memberCount>1?availableHeight:Math.min(availableHeight,mode==='preview'?390:340)};
  }
  function viewportRect(viewport={}){
    const left=finite(viewport.left),top=finite(viewport.top),width=Math.max(1,finite(viewport.width,360)),height=Math.max(1,finite(viewport.height,640));
    return {left,top,width,height,right:left+width,bottom:top+height};
  }
  function chooseDock(anchor,viewport){
    const v=viewportRect(viewport),rawLeft=finite(anchor?.left??anchor?.x,v.left+v.width/2),rawTop=finite(anchor?.top??anchor?.y,v.top+v.height/2);
    // A partially clipped target may touch the viewport boundary. Clip once at
    // opening, never move the chosen contact point to accommodate a later mode.
    const left=clamp(rawLeft,v.left,v.right),right=clamp(finite(anchor?.right,rawLeft+finite(anchor?.width)),v.left,v.right);
    const top=clamp(rawTop,v.top,v.bottom),bottom=clamp(finite(anchor?.bottom,rawTop+finite(anchor?.height)),v.top,v.bottom);
    const towardRight=(left+right)/2<=v.left+v.width/2,down=v.bottom-top>=bottom-v.top;
    return Object.freeze({x:towardRight?right:left,y:down?top:bottom,corner:(down?'top-':'bottom-')+(towardRight?'left':'right')});
  }
  function dockBounds(dock,viewport){
    const v=viewportRect(viewport),margin=Math.min(constants.MARGIN,v.width/4,v.height/4);
    return {width:Math.max(1,dock.corner.endsWith('left')?v.right-margin-dock.x:dock.x-v.left-margin),
      height:Math.max(1,dock.corner.startsWith('top')?v.bottom-margin-dock.y:dock.y-v.top-margin)};
  }
  function placeDock(dock,size){
    const width=Math.max(1,finite(size.width,1)),height=Math.max(1,finite(size.height,1));
    return {left:dock.corner.endsWith('left')?dock.x:dock.x-width,top:dock.corner.startsWith('top')?dock.y:dock.y-height,width,height};
  }
  function place(anchor,viewport,size){
    const dock=chooseDock(anchor,viewport),available=dockBounds(dock,viewport);
    return placeDock(dock,{width:Math.min(available.width,size.width),height:Math.min(available.height,size.height)});
  }
  function create(host,{books,onSelect,getCurrent,getPreview,getBookFrame,onZoom,onDismiss}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,win=doc.defaultView,portal=doc.body||host,staticListeners=[],dynamicListeners=[];
    const root=doc.createElement('div');root.className='edge-chapters';root.hidden=true;
    let opened=false,destroyed=false,members=[],selected=-1,hinge=null,openedFrame=null,dock=null,previousFocus=null,contentButtons=[],chapterButtons=[],sectionCounts=[],mode='numbers';
    const add=(parent,tag,className)=>{const node=doc.createElement(tag);node.className=className;parent.appendChild(node);return node;};
    const listen=(target,type,fn,capture=false,list=staticListeners)=>{target.addEventListener(type,fn,capture);list.push([target,type,fn,capture]);};
    const stop=event=>event.stopPropagation();
    const outside=add(root,'button','edge-chapters__outside');outside.type='button';outside.tabIndex=-1;outside.setAttribute('aria-label','关闭章节菜单');
    const panel=add(root,'section','edge-chapters__panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    const modes=add(panel,'div','edge-chapters__modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','目录样式');
    const modeButtons=['numbers','preview'].map(value=>{
      const button=add(modes,'button','edge-chapters__mode');button.type='button';button.dataset.mode=value;
      button.textContent=value==='numbers'?'章码':'摘句';button.setAttribute('aria-label',value==='numbers'?'章号格子':'经文摘读');
      listen(button,'click',event=>{stop(event);if(!opened||destroyed)return;setMode(value);button.focus?.({preventScroll:true});});return button;
    });
    const closeButton=add(panel,'button','edge-chapters__close');closeButton.type='button';closeButton.textContent='收';closeButton.title='关闭章节菜单';closeButton.setAttribute('aria-label','关闭章节菜单');
    const sheet=add(panel,'div','edge-chapters__sheet');
    const header=add(sheet,'header','edge-chapters__header'),kicker=add(header,'div','edge-chapters__kicker');kicker.textContent='卷内目次';
    const heading=add(header,'div','edge-chapters__heading'),title=add(heading,'h2','edge-chapters__title');title.id='edge-chapters-title-'+(++instance);panel.setAttribute('aria-labelledby',title.id);
    const currentLabel=add(heading,'span','edge-chapters__current');currentLabel.hidden=true;
    const rule=add(sheet,'div','edge-chapters__rule'),eyebrow=add(rule,'span','edge-chapters__eyebrow');
    const grid=add(sheet,'div','edge-chapters__grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','选择章节');
    const footer=add(sheet,'footer','edge-chapters__footer'),opening=add(footer,'button','edge-chapters__opening');opening.type='button';opening.textContent='卷首';
    const hint=add(footer,'span','edge-chapters__hint');hint.textContent='点章码翻页';hint.title='也可按 Esc 收起';
    const corner=add(panel,'i','edge-chapters__corner');corner.setAttribute('aria-hidden','true');
    for(const type of ['pointerdown','pointerup','pointercancel','click','dblclick'])listen(root,type,stop);
    listen(outside,'click',event=>{stop(event);close();});listen(closeButton,'click',event=>{stop(event);close();});
    listen(opening,'click',event=>{stop(event);if(opened&&members.length===1)choose(selected,books[selected].first);});
    function getViewport(){
      const visual=win?.visualViewport;
      return {left:finite(visual?.offsetLeft),top:finite(visual?.offsetTop),width:finite(visual?.width,finite(win?.innerWidth,doc.documentElement?.clientWidth||360)),height:finite(visual?.height,finite(win?.innerHeight,doc.documentElement?.clientHeight||640))};
    }
    function bookFrame(){
      const f=getBookFrame?.();
      return {x:finite(f?.x),y:finite(f?.y),scale:finite(f?.scale)>0?Number(f.scale):1};
    }
    let layoutKey='';
    const scrollPort=()=>panel.dataset.tight==='true'?sheet:grid;
    // A pixel offset has no meaning when columns wrap or the scroll owner
    // switches from the list to the whole sheet. Keep an actual chapter.
    function visibleChapter(){
      const scroller=scrollPort();
      if(!chapterButtons.length||!(scroller.scrollTop>1))return null;
      const view=scroller.getBoundingClientRect();
      if(!view.height)return null;
      // Sample within the viewport, not its clipped first row. This same line
      // is used after reflow so successive pinch steps do not drift.
      const line=view.top+view.height*.25;
      let lo=0,hi=chapterButtons.length;
      while(lo<hi){const m=(lo+hi)>>1;if(chapterButtons[m].getBoundingClientRect().bottom<=line)lo=m+1;else hi=m;}
      const button=chapterButtons[lo];if(!button)return null;
      const row=button.getBoundingClientRect();if(row.top>=view.bottom)return null;
      return {book:button.dataset.book,chapter:button.dataset.chapter,part:clamp((line-row.top)/Math.max(1,row.height),.03,.97)};
    }
    function restoreChapter(mark,scale){
      if(!mark)return;
      const button=chapterButtons.find(b=>b.dataset.book===mark.book&&b.dataset.chapter===mark.chapter);if(!button)return;
      const scroller=scrollPort(),view=scroller.getBoundingClientRect(),row=button.getBoundingClientRect();
      // The DOM reports rects in screen pixels, but scrollTop in book units.
      if(view.height&&row.height)scroller.scrollTop+=(row.top+mark.part*row.height-view.top-view.height*.25)/scale;
    }
    function position(){layout();}
    function layout(savedChapter){
      if(!opened||destroyed)return;
      const f=bookFrame(),s=f.scale,known=openedFrame,ratio=s/known.scale,viewport=getViewport();
      // Reproject the original point on the physical bookmark; never choose a new
      // corner in response to zoom, pan, mode changes, or the chapter count.
      dock={corner:hinge.corner,x:hinge.x+(f.x-known.x)+(hinge.x-known.x)*(ratio-1),y:hinge.y+(f.y-known.y)+(hinge.y-known.y)*(ratio-1)};
      const available=dockBounds(dock,viewport),mobile=viewport.width<constants.MOBILE_BREAKPOINT;
      const size=menuSize(chapterButtons.length,mode,viewport.width/s,viewport.height/s,members.length,{width:available.width/s,height:available.height/s,mobile});
      const key=[selected,mode,s,size.width,size.maxHeight,size.columns,mobile].join('/');
      const mark=savedChapter||(layoutKey&&layoutKey!==key?visibleChapter():null);
      panel.style.width=size.width*s+'px';panel.style.maxHeight=size.maxHeight*s+'px';sheet.style.maxHeight=size.maxHeight+'px';
      panel.dataset.tight=String(size.maxHeight<240);
      panel.dataset.narrow=String(size.width<180);
      for(const node of [root,panel]){
        node.dataset.dockCorner=dock.corner;node.dataset.anchorX=String(dock.x);node.dataset.anchorY=String(dock.y);node.dataset.bookScale=String(s);
        for(const [key,value] of [['--book-scale',String(s)],['--columns',String(size.columns)],['--cell',(mobile?constants.MIN_TARGET:constants.DESKTOP_CELL)+'px'],['--anchor-x',dock.x+'px'],['--anchor-y',dock.y+'px']]){
          if(node.style.setProperty)node.style.setProperty(key,value);else node.style[key]=value;
        }
      }
      const cell=viewport.width<constants.MOBILE_BREAKPOINT?constants.MIN_TARGET:constants.DESKTOP_CELL;
      const rows=sectionCounts.reduce((n,count)=>n+Math.ceil(count/size.columns),0);
      const rect=panel.getBoundingClientRect?.(),estimate=74+(members.length>1?members.length*26:0)+rows*(mode==='preview'?(mobile?40:36):cell+1);
      const p=placeDock(dock,{width:size.width*s,height:Math.min(size.maxHeight*s,rect?.height||estimate*s)});
      panel.style.left=p.left+'px';panel.style.top=p.top+'px';
      layoutKey=key;restoreChapter(mark,s);
    }
    function removeDynamic(){for(const [node,type,fn,capture] of dynamicListeners)node.removeEventListener(type,fn,capture);dynamicListeners.length=0;}
    function clear(node){for(const child of Array.from(node.children))child.remove();}
    function focusChapter(){
      const target=chapterButtons.find(button=>button.getAttribute('aria-current')==='page')||chapterButtons[0]||contentButtons[0]||opening;
      target.focus?.({preventScroll:true});target.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }
    function openingTarget(button,index){
      const book=books[index];button.type='button';button.textContent='卷首';button.dataset.book=String(index);
      button.dataset.page=String(book.first);button.title=book.name+'卷首';button.setAttribute('aria-label',`前往${book.name}卷首`);
    }
    function renderEntries(list,index,entries,current){
      const book=books[index];
      for(const entry of entries){
        const button=add(list,'button','edge-chapters__chapter');button.type='button';button.dataset.book=String(index);button.dataset.chapter=String(entry.chapter);button.dataset.page=String(entry.page);
        const number=add(button,'span','number edge-chapters__number');number.textContent=String(entry.chapter);
        button.title=`${book.name} 第 ${entry.chapter} 章`;button.setAttribute('aria-label',button.title);
        if(mode==='preview'){
          let preview=null;
          try{preview=typeof getPreview==='function'?getPreview(index,entry.chapter):null;}catch(_){/* Missing preview never fabricates scripture or blocks chapter access. */}
          const available=typeof preview?.text==='string'&&Boolean(preview.text.trim());button.dataset.preview=available?'available':'unavailable';
          if(available){
            const excerpt=add(button,'span','preview edge-chapters__preview');excerpt.textContent=preview.text;
            const reference=add(button,'span','reference edge-chapters__reference');reference.textContent=typeof preview.reference==='string'?preview.reference:'';
            button.dataset.truncated=String(Boolean(preview.truncated));
          }
        }
        if(current.bookIndex===index&&Number(current.chapter)===entry.chapter)button.setAttribute('aria-current','page');
        listen(button,'click',event=>{stop(event);if(opened&&!destroyed)choose(index,entry.page,entry.chapter);},false,dynamicListeners);
        chapterButtons.push(button);contentButtons.push(button);
      }
    }
    function render(){
      removeDynamic();clear(grid);contentButtons=[];chapterButtons=[];
      const grouped=members.length>1,current=getCurrent?.()||{};
      const sections=members.map(index=>({index,book:books[index],entries:chapterEntries(books[index])}));
      sectionCounts=sections.map(s=>s.entries.length);
      const count=sectionCounts.reduce((n,c)=>n+c,0),first=sections[0],unit=first.book.code==='PSA'?'篇':'章';
      root.dataset.book=String(selected);title.textContent=grouped?'合签目录':first.book.name;
      kicker.textContent=grouped?'书口目次':'卷内目次';eyebrow.textContent=grouped?`${members.length}卷`:`共${count}${unit}`;
      const active=Number(current.chapter),hasCurrent=!grouped&&current.bookIndex===first.index&&first.entries.some(e=>e.chapter===active);
      currentLabel.hidden=!hasCurrent;currentLabel.textContent=hasCurrent?`读至${active}${unit}`:'';
      hint.textContent=mode==='preview'?'点摘句翻页':'点章码翻页';
      const size=count<=3?'brief':count<=25?'regular':'long';
      for(const node of [root,panel]){node.dataset.mode=mode;node.dataset.count=String(count);node.dataset.size=size;node.dataset.grouped=String(grouped);}
      for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
      opening.hidden=grouped;if(!grouped)openingTarget(opening,first.index);
      for(const {index,book,entries} of sections){
        let list=grid;
        if(grouped){
          const section=add(grid,'section','edge-chapters__section');section.dataset.book=String(index);
          const head=add(section,'div','edge-chapters__section-head'),name=add(head,'h3','edge-chapters__book-title');
          name.textContent=book.name;name.id=title.id+'-book-'+index;section.setAttribute('aria-labelledby',name.id);
          const badge=add(head,'span','edge-chapters__section-count');badge.textContent=`共${entries.length}${book.code==='PSA'?'篇':'章'}`;
          const start=add(head,'button','edge-chapters__opening');openingTarget(start,index);contentButtons.push(start);
          listen(start,'click',event=>{stop(event);if(opened&&!destroyed)choose(index,book.first);},false,dynamicListeners);
          list=add(section,'div','edge-chapters__list');
        }
        renderEntries(list,index,entries,current);
      }
      layoutKey='';sheet.scrollTop=0;grid.scrollTop=0;
    }
    function setMode(value){
      if(value!=='numbers'&&value!=='preview')throw new TypeError('Chapter menu mode must be numbers or preview');
      if(destroyed||value===mode)return mode;
      const mark=opened?visibleChapter():null,active=doc.activeElement;
      const key=contentButtons.includes(active)?{book:active.dataset.book,chapter:active.dataset.chapter}:null;
      mode=value;root.dataset.mode=mode;panel.dataset.mode=mode;
      for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
      if(opened){
        render();layout(mark);
        const target=key&&contentButtons.find(button=>button.dataset.book===key.book&&button.dataset.chapter===key.chapter);
        target?.focus?.({preventScroll:true});if(!mark)target?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      }
      return mode;
    }
    function choose(index,page,chapter){
      if(!Number.isInteger(page)||page<0)return;const book=books[index];close('select');if(typeof onSelect==='function')onSelect(page,{bookCode:book.code,ref:chapter?chapter+':1':null});
    }
    function open(options={}){
      if(destroyed)return false;
      const requested=Array.isArray(options.bookIndices)?options.bookIndices:[options.index];
      const valid=[...new Set(requested)].filter(index=>Number.isInteger(index)&&index>=0&&index<books.length).sort((a,b)=>a-b);
      if(!valid.length)return false;
      if(!opened){previousFocus=doc.activeElement;hinge=chooseDock(options.anchor,getViewport());openedFrame=bookFrame();}
      members=valid;selected=members.includes(options.index)?options.index:members[0];
      opened=true;root.hidden=false;render();position();focusChapter();return true;
    }
    function close(reason='dismiss'){
      if(!opened)return false;opened=false;root.hidden=true;contacts.clear();pinchDistance=0;ignorePinchClick=false;
      const target=previousFocus;previousFocus=null;
      if(reason==='dismiss')onDismiss?.({...openedFrame});
      if(target&&target!==doc.body&&target.isConnected!==false&&!target.disabled)target.focus?.({preventScroll:true});return true;
    }
    function keys(event){
      if(!opened||destroyed)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();close();return;}
      if(onZoom&&!event.ctrlKey&&!event.metaKey&&['+','=','-'].includes(event.key)){
        event.preventDefault();event.stopPropagation();onZoom(event.key==='-'?1/1.2:1.2);return;
      }
      if(event.key!=='Tab')return;
      const focusables=[...modeButtons,closeButton,...contentButtons,opening].filter(button=>!button.hidden&&!button.disabled);
      const first=focusables[0],last=focusables[focusables.length-1],active=doc.activeElement;
      if(!focusables.includes(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();event.stopPropagation();(event.shiftKey?last:first)?.focus?.({preventScroll:true});}
    }
    // Window capture precedes the book index's document Escape handler, so one
    // Esc closes this dialog rather than also collapsing the book beneath it.
    listen(win?.addEventListener?win:doc,'keydown',keys,true);
    // The modal covers the stage. Forward only genuine zoom here, leaving an
    // ordinary wheel / one-finger vertical scroll to the list of chapters.
    const contacts=new Map();let pinchDistance=0,ignorePinchClick=false;
    if(typeof onZoom==='function'){
      listen(root,'wheel',e=>{
        if(!opened||!(e.ctrlKey||e.metaKey))return;
        e.preventDefault();e.stopPropagation();const delta=finite(e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?getViewport().height:1);
        onZoom(Math.exp(clamp(-delta*.003,-2,2)));
      },{passive:false});
      const distance=()=>{const [a,b]=contacts.values();return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
      listen(root,'pointerdown',e=>{
        if(!opened)return;
        if(!contacts.size)ignorePinchClick=false;
        if(e.pointerType!=='touch')return;
        contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});pinchDistance=distance();
        if(contacts.size>=2)ignorePinchClick=true;
      },true);
      listen(root,'pointermove',e=>{
        if(!opened||!contacts.has(e.pointerId))return;
        contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(contacts.size!==2)return;
        const old=pinchDistance;pinchDistance=distance();
        if(old>2&&pinchDistance>2){e.preventDefault();e.stopPropagation();onZoom(pinchDistance/old);}
      });
      const release=e=>{contacts.delete(e.pointerId);pinchDistance=distance();};
      for(const type of ['pointerup','pointercancel'])listen(root,type,release,true);
      // Suppress native two-finger browser zoom/scroll without consuming a
      // single-finger chapter scroll or the OS's ordinary accessibility zoom.
      for(const type of ['touchstart','touchmove'])listen(root,type,e=>{if(opened&&e.touches.length>1)e.preventDefault();},{passive:false});
      listen(root,'click',e=>{if(ignorePinchClick&&e.detail!==0){ignorePinchClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    }
    if(win?.addEventListener){listen(win,'resize',position);if(win.visualViewport?.addEventListener){listen(win.visualViewport,'resize',position);listen(win.visualViewport,'scroll',position);}}
    const sizeObserver=typeof win?.ResizeObserver==='function'?new win.ResizeObserver(()=>position()):null;
    sizeObserver?.observe(panel);
    root.dataset.mode=mode;panel.dataset.mode=mode;for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    portal.appendChild(root);
    function destroy(){
      if(destroyed)return;close('destroy');destroyed=true;removeDynamic();
      sizeObserver?.disconnect();
      for(const [node,type,fn,capture] of staticListeners)node.removeEventListener(type,fn,capture);root.remove();
    }
    return {open,close,isOpen:()=>opened,getMode:()=>mode,setMode,reposition:position,getDock:()=>opened?{...dock}:null,destroy,element:root};
  }
  return {constants,chapterEntries,menuSize,chooseDock,dockBounds,placeDock,place,create};
});
