/* Screen-space chapter chooser. Geometry remains independent of book zoom. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdgeChapters=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:360,MARGIN:12,GAP:10,MIN_TARGET:44});
  let instance=0;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  function chapterEntries(book){
    return (Array.isArray(book?.chapters)?book.chapters:[]).filter(entry=>Number.isInteger(entry.chapter)&&entry.chapter>0&&Number.isInteger(entry.page)&&entry.page>=0)
      .map(entry=>({chapter:entry.chapter,page:entry.page})).sort((a,b)=>a.chapter-b.chapter);
  }
  function menuSize(count,mode='numbers',viewportWidth=360,viewportHeight=640,memberCount=1){
    if(mode!=='numbers'&&mode!=='preview')throw new TypeError('Chapter menu mode must be numbers or preview');
    const chapters=Math.max(0,Math.floor(finite(count))),vw=Math.max(1,finite(viewportWidth,360)),vh=Math.max(1,finite(viewportHeight,640));
    const availableWidth=Math.max(1,vw-2*constants.MARGIN);
    let width,columns;
    if(mode==='preview'){
      width=chapters<=3?340:chapters<=8?520:620;columns=chapters<=3?1:2;
      if(vw<520){width=availableWidth;columns=1;}
    }else{
      width=chapters<=3?220:chapters<=9?252:chapters<=25?304:360;
      columns=chapters<=9?3:chapters<=25?5:6;
    }
    width=Math.min(width,availableWidth);
    // Only extremely narrow screens reduce number-grid columns. Short books
    // retain their intentional empty cells rather than stretching one chapter.
    if(mode==='numbers')columns=Math.min(columns,Math.max(1,Math.floor((width-28+6)/(constants.MIN_TARGET+6))));
    return {width,columns,maxHeight:Math.max(1,Math.min(vh-48,mode==='preview'?620:500))};
  }
  function place(anchor,viewport,size){
    const vx=finite(viewport.left),vy=finite(viewport.top),vw=Math.max(1,finite(viewport.width,360)),vh=Math.max(1,finite(viewport.height,640));
    const margin=Math.min(constants.MARGIN,vw/4,vh/4),width=Math.min(finite(size.width,constants.WIDTH),vw-2*margin),height=Math.min(finite(size.height,400),vh-2*margin);
    const left=finite(anchor?.left??anchor?.x,vx+vw/2),right=finite(anchor?.right,left+finite(anchor?.width));
    const top=finite(anchor?.top??anchor?.y,vy+vh/2),preferLeft=(left+right)/2>vx+vw/2;
    const candidates=preferLeft?[left-width-constants.GAP,right+constants.GAP]:[right+constants.GAP,left-width-constants.GAP];
    const fitting=candidates.find(x=>x>=vx+margin&&x+width<=vx+vw-margin);
    return {left:clamp(fitting??candidates[0],vx+margin,vx+vw-margin-width),top:clamp(top-24,vy+margin,vy+vh-margin-height),width,height};
  }
  function create(host,{books,onSelect,getCurrent,getPreview}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,win=doc.defaultView,portal=doc.body||host,staticListeners=[],dynamicListeners=[];
    const root=doc.createElement('div');root.className='edge-chapters';root.hidden=true;
    let opened=false,destroyed=false,members=[],selected=-1,anchor=null,previousFocus=null,bookButtons=[],chapterButtons=[],mode='numbers';
    const add=(parent,tag,className)=>{const node=doc.createElement(tag);node.className=className;parent.appendChild(node);return node;};
    const listen=(target,type,fn,capture=false,list=staticListeners)=>{target.addEventListener(type,fn,capture);list.push([target,type,fn,capture]);};
    const stop=event=>event.stopPropagation();
    const outside=add(root,'button','edge-chapters__outside');outside.type='button';outside.tabIndex=-1;outside.setAttribute('aria-label','关闭章节菜单');
    const panel=add(root,'section','edge-chapters__panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    const header=add(panel,'header','edge-chapters__header'),heading=add(header,'div','edge-chapters__heading');
    const eyebrow=add(heading,'div','edge-chapters__eyebrow');eyebrow.textContent='卷内目录';
    const title=add(heading,'h2','edge-chapters__title');title.id='edge-chapters-title-'+(++instance);panel.setAttribute('aria-labelledby',title.id);
    const subtitle=add(heading,'div','edge-chapters__subtitle');subtitle.hidden=true;
    const closeButton=add(header,'button','edge-chapters__close');closeButton.type='button';closeButton.textContent='收起';closeButton.title='关闭章节菜单';closeButton.setAttribute('aria-label','关闭章节菜单');
    const bookbar=add(panel,'div','edge-chapters__books');bookbar.setAttribute('role','group');bookbar.setAttribute('aria-label','选择书卷');
    const modes=add(panel,'div','edge-chapters__modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','目录样式');
    const modeButtons=['numbers','preview'].map(value=>{
      const button=add(modes,'button','edge-chapters__mode');button.type='button';button.dataset.mode=value;
      button.textContent=value==='numbers'?'章号格子':'经文摘读';button.setAttribute('aria-label',button.textContent);
      listen(button,'click',event=>{stop(event);if(!opened||destroyed)return;setMode(value);button.focus?.({preventScroll:true});});return button;
    });
    const grid=add(panel,'div','edge-chapters__grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','选择章节');
    const footer=add(panel,'footer','edge-chapters__footer'),opening=add(footer,'button','edge-chapters__opening');opening.type='button';opening.textContent='前往卷首';
    const hint=add(footer,'span','edge-chapters__hint');hint.textContent='点纸外收起';hint.title='也可按 Esc 收起';
    for(const type of ['pointerdown','pointerup','pointercancel','click','dblclick'])listen(root,type,stop);
    listen(outside,'click',event=>{stop(event);close();});listen(closeButton,'click',event=>{stop(event);close();});
    listen(opening,'click',event=>{stop(event);if(opened&&selected>=0)choose(books[selected].first);});
    function getViewport(){
      const visual=win?.visualViewport;
      return {left:finite(visual?.offsetLeft),top:finite(visual?.offsetTop),width:finite(visual?.width,finite(win?.innerWidth,doc.documentElement?.clientWidth||360)),height:finite(visual?.height,finite(win?.innerHeight,doc.documentElement?.clientHeight||640))};
    }
    function position(){
      if(!opened||destroyed)return;
      const viewport=getViewport(),size=menuSize(chapterButtons.length,mode,viewport.width,viewport.height,members.length);
      panel.style.width=size.width+'px';panel.style.maxHeight=size.maxHeight+'px';
      for(const node of [root,panel]){
        if(node.style.setProperty)node.style.setProperty('--columns',String(size.columns));else node.style['--columns']=String(size.columns);
      }
      const rect=panel.getBoundingClientRect?.(),estimate=160+(members.length>1?54:0)+Math.ceil(chapterButtons.length/size.columns)*(mode==='preview'?126:50);
      const p=place(anchor,viewport,{width:size.width,height:Math.min(size.maxHeight,rect?.height||estimate)});
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
      eyebrow.textContent=`卷内目录 · ${entries.length} ${book.code==='PSA'?'篇':'章'}`;subtitle.hidden=true;
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
      if(!opened)previousFocus=doc.activeElement;
      members=valid;selected=members.includes(options.index)?options.index:members[0];
      anchor=options.anchor?{...options.anchor}:null;opened=true;root.hidden=false;render();position();focusChapter();return true;
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
      const focusables=[closeButton,...bookButtons,...modeButtons,...chapterButtons,opening].filter(button=>!button.hidden&&!button.disabled);
      const first=focusables[0],last=focusables[focusables.length-1],active=doc.activeElement;
      if(!focusables.includes(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();event.stopPropagation();(event.shiftKey?last:first)?.focus?.({preventScroll:true});}
    }
    // Window capture precedes the book index's document Escape handler, so one
    // Esc closes this dialog rather than also collapsing the book beneath it.
    listen(win?.addEventListener?win:doc,'keydown',keys,true);
    if(win?.addEventListener){listen(win,'resize',position);if(win.visualViewport?.addEventListener){listen(win.visualViewport,'resize',position);listen(win.visualViewport,'scroll',position);}}
    root.dataset.mode=mode;panel.dataset.mode=mode;for(const button of modeButtons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    portal.appendChild(root);
    function destroy(){
      if(destroyed)return;close();destroyed=true;removeDynamic();
      for(const [node,type,fn,capture] of staticListeners)node.removeEventListener(type,fn,capture);root.remove();
    }
    return {open,close,isOpen:()=>opened,getMode:()=>mode,setMode,destroy,element:root};
  }
  return {constants,chapterEntries,menuSize,place,create};
});
