/* Read-only verse previews for the printed citations. No routing or storage. */
(() => {
  'use strict';
  const doc=document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
  if(!stage||!book||doc.getElementById('footnote-preview'))return;
  const tip=doc.createElement('aside');tip.id='footnote-preview';tip.hidden=true;
  tip.className='footnote-preview';tip.setAttribute('role','tooltip');tip.lang='zh-CN';
  doc.body.appendChild(tip);
  const selector='[data-footnote-anchor]';
  const anchorOf=node=>node?.closest?.(selector);
  const inside=(element,node)=>!!node?.nodeType&&element.contains(node);
  const field=(tag,cls,text,parent)=>{const el=doc.createElement(tag);el.className='footnote-preview__'+cls;el.textContent=text;parent.appendChild(el);return el;};
  const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));
  let current=null,timer=0,raf=0,keyFocus=false;
  const cancel=()=>{clearTimeout(timer);timer=0;};
  function describe(button,on){
    const ids=(button.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);
    if(on)ids.push(tip.id);
    if(ids.length)button.setAttribute('aria-describedby',ids.join(' '));else button.removeAttribute('aria-describedby');
  }
  function hide(){
    cancel();if(!current)return;
    describe(current,false);current=null;tip.hidden=true;keyFocus=false;
    if(raf)cancelAnimationFrame(raf);raf=0;
    observer.disconnect();sizeObserver?.disconnect();
  }
  function forbidden(){
    return book.classList.contains('curl-active')||['running','switching'].includes(stage.dataset.jumpState)||
      !!doc.querySelector('#edge-index-host[data-edge-expanded="true"],.edge-chapters:not([hidden]),#book-picker[open]');
  }
  function position(){
    if(!current||!current.isConnected||current.disabled||current.hidden||forbidden())return hide();
    const rect=current.getBoundingClientRect(),v=window.visualViewport;
    const x=v?.offsetLeft||0,y=v?.offsetTop||0,width=v?.width||doc.documentElement.clientWidth,height=v?.height||doc.documentElement.clientHeight;
    if(!rect.width||!rect.height||rect.right<=x||rect.left>=x+width||rect.bottom<=y||rect.top>=y+height)return hide();
    const margin=Math.min(10,width/8,height/8),gap=4;
    tip.style.width=Math.min(360,width-2*margin)+'px';
    const above=rect.top-gap-y-margin,below=y+height-margin-rect.bottom-gap;
    const upwards=above>=below;
    tip.style.maxHeight=Math.min(420,Math.max(1,upwards?above:below))+'px';
    const box=tip.getBoundingClientRect();
    const left=clamp(rect.left,x+margin,x+width-margin-box.width);
    const top=clamp(upwards?rect.top-gap-box.height:rect.bottom+gap,y+margin,y+height-margin-box.height);
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function frame(){
    if(current&&!raf)raf=requestAnimationFrame(()=>{raf=0;position();});
  }
  const observer=new MutationObserver(()=>{
    if(current&&(!current.isConnected||forbidden()))hide();else frame();
  });
  const sizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(frame):null;
  function watch(button){
    // Do not observe the OCR text tree; a stationary paper replaces its direct
    // children on turns. Ordinary camera movement changes the book transform.
    observer.observe(button.parentElement,{childList:true});
    const paper=button.closest('.paper');
    if(paper&&paper!==button.parentElement)observer.observe(paper,{childList:true});
    observer.observe(book,{attributes:true,attributeFilter:['class','style']});
    observer.observe(stage,{attributes:true,attributeFilter:['data-jump-state','data-spread']});
    sizeObserver?.observe(tip);sizeObserver?.observe(button);
  }
  function show(button){
    cancel();if(!button||!button.isConnected||button.disabled||forbidden())return hide();
    if(current===button)return;
    hide();
    const api=window.PaperFootnotePassages,note=api?.byOrdinal(Number(button.dataset.notePage),Number(button.dataset.noteOrdinal));
    if(!note)return;
    const verses=api.passages(note,window.BIBLE_SOURCE);
    if(!verses?.length)return; // Unknown references must never produce guessed text.
    const fragment=doc.createDocumentFragment();
    field('div','citation','原注 '+(note.marker||'')+' '+note.citation,fragment);
    let section,group='';
    for(const v of verses){
      const next=v.code+'.'+v.chapter;
      if(next!==group){group=next;section=doc.createElement('section');fragment.appendChild(section);
        field('h3','heading',v.name+' '+v.chapter+(v.code==='PSA'?' 篇':' 章'),section);}
      const row=field('p','verse','',section);row.dataset.ref=next+':'+v.verse;
      field('span','number',String(v.verse),row);field('span','text',v.text,row);
    }
    current=button;tip.replaceChildren(fragment);tip.hidden=false;tip.scrollTop=0;
    describe(button,true);position();if(current)watch(button);
  }
  function scheduleHide(){cancel();timer=setTimeout(()=>{if(!keyFocus)hide();},260);}
  doc.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch'||e.buttons)return;
    const a=anchorOf(e.target);if(a&&a!==anchorOf(e.relatedTarget))show(a);
    else if(tip.contains(e.target))cancel();
  });
  doc.addEventListener('pointerout',e=>{
    if(!current||e.pointerType==='touch')return;
    if((inside(current,e.target)||inside(tip,e.target))&&!inside(current,e.relatedTarget)&&!inside(tip,e.relatedTarget))scheduleHide();
  });
  doc.addEventListener('focusin',e=>{
    const a=anchorOf(e.target);
    if(a){show(a);keyFocus=!!current&&a.matches(':focus-visible');}
    else if(current&&!tip.contains(e.target))hide();
  });
  doc.addEventListener('focusout',e=>{if(current===e.target){keyFocus=false;if(!inside(tip,e.relatedTarget))scheduleHide();}});
  doc.addEventListener('click',e=>{const a=anchorOf(e.target);if(a)show(a);});
  doc.addEventListener('pointerdown',e=>{if(current&&!current.contains(e.target)&&!tip.contains(e.target))hide();},true);
  doc.addEventListener('keydown',e=>{
    if(!current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide();return;}
    if(e.target===current&&tip.scrollHeight>tip.clientHeight+1){
      const shifts={ArrowDown:40,ArrowUp:-40,PageDown:tip.clientHeight*.85,PageUp:-tip.clientHeight*.85,Home:-Infinity,End:Infinity};
      if(Object.hasOwn(shifts,e.key)){e.preventDefault();e.stopPropagation();
        tip.scrollTop=clamp(tip.scrollTop+shifts[e.key],0,tip.scrollHeight-tip.clientHeight);}
    }
  },true);
  window.addEventListener('resize',frame);window.visualViewport?.addEventListener('resize',frame);
  window.visualViewport?.addEventListener('scroll',frame);window.addEventListener('scroll',frame,true);
  window.addEventListener('blur',hide);window.addEventListener('pagehide',hide);
})();
