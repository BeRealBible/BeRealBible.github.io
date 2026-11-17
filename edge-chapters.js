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
  function place(anchor,viewport,size){
    const vx=finite(viewport.left),vy=finite(viewport.top),vw=Math.max(1,finite(viewport.width,360)),vh=Math.max(1,finite(viewport.height,640));
    const margin=Math.min(constants.MARGIN,vw/4,vh/4),width=Math.min(finite(size.width,constants.WIDTH),vw-2*margin),height=Math.min(finite(size.height,400),vh-2*margin);
    const left=finite(anchor?.left??anchor?.x,vx+vw/2),right=finite(anchor?.right,left+finite(anchor?.width));
    const top=finite(anchor?.top??anchor?.y,vy+vh/2),preferLeft=(left+right)/2>vx+vw/2;
    const candidates=preferLeft?[left-width-constants.GAP,right+constants.GAP]:[right+constants.GAP,left-width-constants.GAP];
    const fitting=candidates.find(x=>x>=vx+margin&&x+width<=vx+vw-margin);
    return {left:clamp(fitting??candidates[0],vx+margin,vx+vw-margin-width),top:clamp(top-24,vy+margin,vy+vh-margin-height),width,height};
  }
  function create(host,{books,onSelect,getCurrent}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,win=doc.defaultView,portal=doc.body||host,staticListeners=[],dynamicListeners=[];
    const root=doc.createElement('div');root.className='edge-chapters';root.hidden=true;
    let opened=false,destroyed=false,members=[],selected=-1,anchor=null,previousFocus=null,bookButtons=[],chapterButtons=[];
    const add=(parent,tag,className)=>{const node=doc.createElement(tag);node.className=className;parent.appendChild(node);return node;};
    const listen=(target,type,fn,capture=false,list=staticListeners)=>{target.addEventListener(type,fn,capture);list.push([target,type,fn,capture]);};
    const stop=event=>event.stopPropagation();
    const outside=add(root,'button','edge-chapters__outside');outside.type='button';outside.tabIndex=-1;outside.setAttribute('aria-label','关闭章节菜单');
    const panel=add(root,'section','edge-chapters__panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    const header=add(panel,'header','edge-chapters__header'),heading=add(header,'div','edge-chapters__heading');
    const title=add(heading,'h2','edge-chapters__title');title.id='edge-chapters-title-'+(++instance);panel.setAttribute('aria-labelledby',title.id);
    const subtitle=add(heading,'div','edge-chapters__subtitle');
    const closeButton=add(header,'button','edge-chapters__close');closeButton.type='button';closeButton.textContent='×';closeButton.title='关闭章节菜单';closeButton.setAttribute('aria-label','关闭章节菜单');
    const bookbar=add(panel,'div','edge-chapters__books');bookbar.setAttribute('role','group');bookbar.setAttribute('aria-label','选择书卷');
    const grid=add(panel,'div','edge-chapters__grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','选择章节');
    const footer=add(panel,'footer','edge-chapters__footer'),opening=add(footer,'button','edge-chapters__opening');opening.type='button';opening.textContent='前往卷首';
    const hint=add(footer,'span','edge-chapters__hint');hint.textContent='点空白处或 Esc 收起';
    for(const type of ['pointerdown','pointerup','pointercancel','click','dblclick'])listen(root,type,stop);
    listen(outside,'click',event=>{stop(event);close();});listen(closeButton,'click',event=>{stop(event);close();});
    listen(opening,'click',event=>{stop(event);if(opened&&selected>=0)choose(books[selected].first);});
    function getViewport(){
      const visual=win?.visualViewport;
      return {left:finite(visual?.offsetLeft),top:finite(visual?.offsetTop),width:finite(visual?.width,finite(win?.innerWidth,doc.documentElement?.clientWidth||360)),height:finite(visual?.height,finite(win?.innerHeight,doc.documentElement?.clientHeight||640))};
    }
    function position(){
      if(!opened||destroyed)return;
      const viewport=getViewport(),width=Math.max(1,Math.min(constants.WIDTH,viewport.width-2*constants.MARGIN));
      panel.style.width=width+'px';panel.style.maxHeight=Math.max(1,viewport.height-2*constants.MARGIN)+'px';
      const rect=panel.getBoundingClientRect?.(),columns=Math.max(1,Math.floor((width-28+6)/50));
      const estimate=110+(members.length>1?54:0)+Math.ceil(chapterButtons.length/columns)*50;
      const p=place(anchor,viewport,{width,height:rect?.height||estimate});
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
      root.dataset.book=String(selected);title.textContent=book.name;subtitle.textContent=`共 ${entries.length} 章 · 选择章节`;
      bookbar.hidden=members.length<2;
      if(members.length>1)for(const index of members){
        const button=add(bookbar,'button','edge-chapters__book');button.type='button';button.dataset.book=String(index);button.textContent=books[index].name;button.title=books[index].name;
        button.setAttribute('aria-pressed',String(index===selected));button.setAttribute('aria-label',`选择${books[index].name}`);
        listen(button,'click',event=>{stop(event);if(!opened||destroyed)return;selected=index;render();position();focusChapter();},false,dynamicListeners);bookButtons.push(button);
      }
      for(const entry of entries){
        const button=add(grid,'button','edge-chapters__chapter');button.type='button';button.dataset.book=String(selected);button.dataset.chapter=String(entry.chapter);button.dataset.page=String(entry.page);
        button.textContent=String(entry.chapter);button.title=`${book.name} 第 ${entry.chapter} 章`;button.setAttribute('aria-label',button.title);
        if(current.bookIndex===selected&&Number(current.chapter)===entry.chapter)button.setAttribute('aria-current','page');
        listen(button,'click',event=>{stop(event);if(opened&&!destroyed)choose(entry.page);},false,dynamicListeners);chapterButtons.push(button);
      }
      grid.scrollTop=0;opening.dataset.page=String(book.first);opening.title=book.name+'卷首';opening.setAttribute('aria-label',`前往${book.name}卷首`);
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
      const focusables=[closeButton,...bookButtons,...chapterButtons,opening].filter(button=>!button.hidden&&!button.disabled);
      const first=focusables[0],last=focusables[focusables.length-1],active=doc.activeElement;
      if(!focusables.includes(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){event.preventDefault();event.stopPropagation();(event.shiftKey?last:first)?.focus?.({preventScroll:true});}
    }
    // Window capture precedes the book index's document Escape handler, so one
    // Esc closes this dialog rather than also collapsing the book beneath it.
    listen(win?.addEventListener?win:doc,'keydown',keys,true);
    if(win?.addEventListener){listen(win,'resize',position);if(win.visualViewport?.addEventListener){listen(win.visualViewport,'resize',position);listen(win.visualViewport,'scroll',position);}}
    portal.appendChild(root);
    function destroy(){
      if(destroyed)return;close();destroyed=true;removeDynamic();
      for(const [node,type,fn,capture] of staticListeners)node.removeEventListener(type,fn,capture);root.remove();
    }
    return {open,close,isOpen:()=>opened,destroy,element:root};
  }
  return {constants,chapterEntries,place,create};
});
