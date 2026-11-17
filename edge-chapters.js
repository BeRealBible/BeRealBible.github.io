/* Screen-space chapter chooser. Geometry remains independent of book zoom. */
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
      const cell=vw<constants.MOBILE_BREAKPOINT?constants.MIN_TARGET:constants.DESKTOP_CELL;
      columns=chapters<=8?Math.max(1,chapters):chapters<=80?8:10;
      columns=Math.min(columns,Math.max(1,Math.floor((availableWidth-constants.PADDING-constants.NUMBER_GUTTER+constants.NUMBER_GAP)/(cell+constants.NUMBER_GAP))));
      width=Math.min(availableWidth,Math.max(220,columns*cell+(columns-1)*constants.NUMBER_GAP+constants.PADDING+constants.NUMBER_GUTTER));
    }
    return {width,columns,maxHeight:Math.min(availableHeight,mode==='preview'?390:340)};
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
  function create(host,{books,onSelect,getCurrent,getPreview}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,win=doc.defaultView,portal=doc.body||host,staticListeners=[],dynamicListeners=[];
    const root=doc.createElement('div');root.className='edge-chapters';root.hidden=true;
    let opened=false,destroyed=false,members=[],selected=-1,anchor=null,dock=null,previousFocus=null,bookButtons=[],chapterButtons=[],mode='numbers';
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
    const bookbar=add(sheet,'div','edge-chapters__books');bookbar.setAttribute('role','group');bookbar.setAttribute('aria-label','选择书卷');
    const rule=add(sheet,'div','edge-chapters__rule'),eyebrow=add(rule,'span','edge-chapters__eyebrow');
    const grid=add(sheet,'div','edge-chapters__grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','选择章节');
    const footer=add(sheet,'footer','edge-chapters__footer'),opening=add(footer,'button','edge-chapters__opening');opening.type='button';opening.textContent='卷首';
    const hint=add(footer,'span','edge-chapters__hint');hint.textContent='点章码翻页';hint.title='也可按 Esc 收起';
    const corner=add(panel,'i','edge-chapters__corner');corner.setAttribute('aria-hidden','true');
    for(const type of ['pointerdown','pointerup','pointercancel','click','dblclick'])listen(root,type,stop);
    listen(outside,'click',event=>{stop(event);close();});listen(closeButton,'click',event=>{stop(event);close();});
    listen(opening,'click',event=>{stop(event);if(opened&&selected>=0)choose(books[selected].first);});
    function getViewport(){
      const visual=win?.visualViewport;
      return {left:finite(visual?.offsetLeft),top:finite(visual?.offsetTop),width:finite(visual?.width,finite(win?.innerWidth,doc.documentElement?.clientWidth||360)),height:finite(visual?.height,finite(win?.innerHeight,doc.documentElement?.clientHeight||640))};
    }
    function position(){
      if(!opened||destroyed)return;
      const viewport=getViewport(),available=dockBounds(dock,viewport),size=menuSize(chapterButtons.length,mode,viewport.width,viewport.height,members.length,available);
      panel.style.width=size.width+'px';panel.style.maxHeight=size.maxHeight+'px';
      panel.dataset.tight=String(size.maxHeight<240);
      for(const node of [root,panel]){
        node.dataset.dockCorner=dock.corner;node.dataset.anchorX=String(dock.x);node.dataset.anchorY=String(dock.y);
        for(const [key,value] of [['--columns',String(size.columns)],['--cell',(viewport.width<constants.MOBILE_BREAKPOINT?constants.MIN_TARGET:constants.DESKTOP_CELL)+'px'],['--anchor-x',dock.x+'px'],['--anchor-y',dock.y+'px']]){
          if(node.style.setProperty)node.style.setProperty(key,value);else node.style[key]=value;
        }
      }
      const cell=viewport.width<constants.MOBILE_BREAKPOINT?constants.MIN_TARGET:constants.DESKTOP_CELL;
      const rect=panel.getBoundingClientRect?.(),estimate=74+(members.length>1?20:0)+Math.ceil(chapterButtons.length/size.columns)*(mode==='preview'?(viewport.width<560?40:36):cell+1);
      const p=placeDock(dock,{width:size.width,height:Math.min(size.maxHeight,rect?.height||estimate)});
      panel.style.left=p.left+'px';panel.style.top=p.top+'px';
    }
    function removeDynamic(){for(const [node,type,fn,capture] of dynamicListeners)node.removeEventListener(type,fn,capture);dynamicListeners.length=0;}
    function clear(node){for(const child of Array.from(node.children))child.remove();}
    function focusChapter(){
      const target=chapterButtons.find(button=>button.getAttribute('aria-current')==='page')||chapterButtons[0]||opening;
      target.focus?.({preventScroll:true});target.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }
    function render(){
      removeDynamic();clear(bookbar);clear(grid);bookButtons=[];chapterButtons=[];
      const book=books[selected],entries=chapterEntries(book),current=typeof getCurrent==='function'?getCurrent()||{}:{};
      root.dataset.book=String(selected);title.textContent=book.name;
      const chapterUnit=book.code==='PSA'?'篇':'章';eyebrow.textContent=`共${entries.length}${chapterUnit}`;
      const activeChapter=Number(current.chapter),hasCurrent=current.bookIndex===selected&&entries.some(entry=>entry.chapter===activeChapter);
      currentLabel.hidden=!hasCurrent;currentLabel.textContent=hasCurrent?`读至${activeChapter}${chapterUnit}`:'';
      hint.textContent=mode==='preview'?'点摘句翻页':'点章码翻页';
      const size=entries.length<=3?'brief':entries.length<=25?'regular':'long';
      for(const node of [root,panel]){node.dataset.mode=mode;node.dataset.count=String(entries.length);node.dataset.size=size;}
      for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
      bookbar.hidden=members.length<2;
      if(members.length>1)for(const index of members){
        const button=add(bookbar,'button','edge-chapters__book');button.type='button';button.dataset.book=String(index);button.textContent=books[index].name;button.title=books[index].name;
        button.setAttribute('aria-pressed',String(index===selected));button.setAttribute('aria-label',`选择${books[index].name}`);
        listen(button,'click',event=>{stop(event);if(!opened||destroyed)return;selected=index;render();position();focusChapter();},false,dynamicListeners);bookButtons.push(button);
      }
      for(const entry of entries){
        const button=add(grid,'button','edge-chapters__chapter');button.type='button';button.dataset.book=String(selected);button.dataset.chapter=String(entry.chapter);button.dataset.page=String(entry.page);
        const number=add(button,'span','number edge-chapters__number');number.textContent=String(entry.chapter);
        button.title=`${book.name} 第 ${entry.chapter} 章`;button.setAttribute('aria-label',button.title);
        if(mode==='preview'){
          let preview=null;
          try{preview=typeof getPreview==='function'?getPreview(selected,entry.chapter):null;}catch(_){/* Missing preview never fabricates scripture or blocks chapter access. */}
          const available=typeof preview?.text==='string'&&Boolean(preview.text.trim());button.dataset.preview=available?'available':'unavailable';
          if(available){
            const excerpt=add(button,'span','preview edge-chapters__preview');excerpt.textContent=preview.text;
            const reference=add(button,'span','reference edge-chapters__reference');reference.textContent=typeof preview.reference==='string'?preview.reference:'';
            button.dataset.truncated=String(Boolean(preview.truncated));
          }
        }
        if(current.bookIndex===selected&&Number(current.chapter)===entry.chapter)button.setAttribute('aria-current','page');
        listen(button,'click',event=>{stop(event);if(opened&&!destroyed)choose(entry.page);},false,dynamicListeners);chapterButtons.push(button);
      }
      grid.scrollTop=0;opening.dataset.page=String(book.first);opening.title=book.name+'卷首';opening.setAttribute('aria-label',`前往${book.name}卷首`);
    }
    function setMode(value){
      if(value!=='numbers'&&value!=='preview')throw new TypeError('Chapter menu mode must be numbers or preview');
      if(destroyed||value===mode)return mode;
      const active=doc.activeElement,chapter=chapterButtons.includes(active)?active.dataset.chapter:null,book=bookButtons.includes(active)?active.dataset.book:null;
      mode=value;root.dataset.mode=mode;panel.dataset.mode=mode;
      for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
      if(opened){
        render();position();
        const target=chapter!==null?chapterButtons.find(button=>button.dataset.chapter===chapter):book!==null?bookButtons.find(button=>button.dataset.book===book):null;
        target?.focus?.({preventScroll:true});target?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      }
      return mode;
    }
    function choose(page){
      if(!Number.isInteger(page)||page<0)return;close();if(typeof onSelect==='function')onSelect(page);
    }
    function open(options={}){
      if(destroyed)return false;
      const requested=Array.isArray(options.bookIndices)?options.bookIndices:[options.index];
      const valid=[...new Set(requested)].filter(index=>Number.isInteger(index)&&index>=0&&index<books.length);
      if(!valid.length)return false;
      if(!opened){previousFocus=doc.activeElement;anchor=options.anchor?{...options.anchor}:null;dock=chooseDock(anchor,getViewport());}
      members=valid;selected=members.includes(options.index)?options.index:members[0];
      opened=true;root.hidden=false;render();position();focusChapter();return true;
    }
    function close(){
      if(!opened)return false;opened=false;root.hidden=true;
      const target=previousFocus;previousFocus=null;
      if(target&&target!==doc.body&&target.isConnected!==false&&!target.disabled)target.focus?.({preventScroll:true});return true;
    }
    function keys(event){
      if(!opened||destroyed)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();close();return;}
      if(event.key!=='Tab')return;
      const focusables=[...modeButtons,closeButton,...bookButtons,...chapterButtons,opening].filter(button=>!button.hidden&&!button.disabled);
      const first=focusables[0],last=focusables[focusables.length-1],active=doc.activeElement;
      if(!focusables.includes(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();event.stopPropagation();(event.shiftKey?last:first)?.focus?.({preventScroll:true});}
    }
    // Window capture precedes the book index's document Escape handler, so one
    // Esc closes this dialog rather than also collapsing the book beneath it.
    listen(win?.addEventListener?win:doc,'keydown',keys,true);
    if(win?.addEventListener){listen(win,'resize',position);if(win.visualViewport?.addEventListener){listen(win.visualViewport,'resize',position);listen(win.visualViewport,'scroll',position);}}
    const sizeObserver=typeof win?.ResizeObserver==='function'?new win.ResizeObserver(()=>position()):null;
    sizeObserver?.observe(panel);
    root.dataset.mode=mode;panel.dataset.mode=mode;for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    portal.appendChild(root);
    function destroy(){
      if(destroyed)return;close();destroyed=true;removeDynamic();
      sizeObserver?.disconnect();
      for(const [node,type,fn,capture] of staticListeners)node.removeEventListener(type,fn,capture);root.remove();
    }
    return {open,close,isOpen:()=>opened,getMode:()=>mode,setMode,destroy,element:root};
  }
  return {constants,chapterEntries,menuSize,chooseDock,dockBounds,placeDock,place,create};
});
