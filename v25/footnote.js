/* One paper slip for printed footer notes and heading parallels. */
(() => {
  'use strict';
  const doc=document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
  if(!stage||!book||doc.getElementById('footnote-preview'))return;
  const tip=doc.createElement('aside');tip.id='footnote-preview';tip.hidden=true;
  tip.className='footnote-preview';tip.setAttribute('role','group');tip.setAttribute('aria-label','引用经文');tip.lang='zh-CN';
  doc.body.appendChild(tip);
  const selector='[data-footnote-anchor]';
  const anchorOf=node=>node?.closest?.(selector);
  const inside=(element,node)=>!!node?.nodeType&&element.contains(node);
  const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));
  let current=null,timer=0,raf=0,keyFocus=false;
  const cancel=()=>{clearTimeout(timer);timer=0;};
  function describe(button,on){
    button.setAttribute('aria-controls',tip.id);button.setAttribute('aria-expanded',String(on));
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
    const margin=3,sheet=current.closest('.paper')?.querySelector('svg[data-pdf]');
    if(!sheet)return hide();
    const bookScale=sheet.getBoundingClientRect().width/480;
    if(!bookScale)return;
    const above=rect.top-y-margin,below=y+height-margin-rect.bottom;
    const up=above>=below,roomH=Math.max(1,up?above:below);
    // Attach a corner to the same printed citation, choose the roomier side.
    const rightward=(rect.left+rect.right)/2<x+width/2;
    const px=clamp(rightward?rect.left:rect.right,x+margin,x+width-margin);
    const py=up?rect.top:rect.bottom,roomW=Math.max(1,rightward?x+width-margin-px:px-x-margin);
    const narrow=width<640,limitW=Math.min(roomW,narrow?Math.min(width*.61,222):Infinity),
      limitH=Math.min(roomH,narrow?Math.min(height*.26,158):Infinity);
    const scale=narrow?Math.min(bookScale,1.18,limitW/125,limitH/58):bookScale;
    tip.style.width='max-content';tip.style.maxWidth=Math.min(narrow?194:247,limitW/scale)+'px';
    tip.style.maxHeight=Math.min(narrow?142:285,limitH/scale)+'px';
    tip.style.transformOrigin=(rightward?'left':'right')+' '+(up?'bottom':'top');
    tip.style.transform='scale('+scale+')';
    tip.style.left=(rightward?px:px-tip.offsetWidth)+'px';tip.style.top=(up?py-tip.offsetHeight:py)+'px';

  }
  let followUntil=0;
  function frame(){
    followUntil=performance.now()+450;
    if(current&&!raf)raf=requestAnimationFrame(follow);
  }
  function follow(now){
    raf=0;if(!current)return;position();
    if(current&&now<followUntil)raf=requestAnimationFrame(follow);
  }
  window.addEventListener('v25-camera-changed',frame);
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
    const verses=api?.resolve(button.dataset.parallel||note?.citation,window.BIBLE_SOURCE);
    if(!verses?.length)return; // Unknown references must never produce guessed text.
    const slip=window.V25VerseSlip(tip,verses,{onJump:({code,ref})=>{
      hide();stage.focus({preventScroll:true});
      window.dispatchEvent(new CustomEvent('v25-read-citation',{detail:{code,ref}}));
    }});
    if(!slip)return;
    // The print compositor's normal Song body uses an 11.8-unit em.
    // Sample this sheet's actual body transforms rather than a UI font size.
    const sample=button.closest('.paper')?.querySelectorAll('svg text[data-role="body"]')||[];
    const em=[];for(const glyph of sample){if(!/^\p{Unified_Ideograph}$/u.test(glyph.textContent))continue;
      const m=glyph.transform.baseVal.getItem(0)?.matrix,sz=Number(glyph.getAttribute('font-size'))*Math.abs(m?.d);
      if(sz>0)em.push(sz);if(em.length===31)break;}
    em.sort((a,b)=>a-b);tip.style.fontSize=(.9*(em[em.length>>1]||11.8))+'px';
    current=button;tip.hidden=false;tip.scrollTop=0;
    describe(button,true);position();
    if(current){slip.align();watch(button);}
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
    else if(current&&tip.contains(e.target)){cancel();keyFocus=true;}
    else if(current&&!e.target.closest?.('.pcz-control,.zoom-tools')&&e.target!==stage)hide();
  });
  doc.addEventListener('focusout',e=>{if(current===e.target){keyFocus=false;if(!inside(tip,e.relatedTarget))scheduleHide();}});
  doc.addEventListener('click',e=>{const a=anchorOf(e.target);if(a)show(a);});
  window.V25PaperDock.onTap(stage,target=>{if(current&&!current.contains(target)&&!anchorOf(target))hide();});
  doc.addEventListener('pointerdown',e=>{if(current&&!stage.contains(e.target)&&!tip.contains(e.target)&&!e.target.closest?.('.pcz-control,.zoom-tools'))hide();},true);
  doc.addEventListener('keydown',e=>{
    if(!current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(tip.contains(doc.activeElement))current.focus({preventScroll:true});hide();return;}
    const go=tip.querySelector('.citation-jump'),scroll=tip.querySelector('.citation-scroll');
    if(e.key==='Tab'&&!e.shiftKey&&e.target===current){e.preventDefault();go.focus({preventScroll:true});return;}
    if(e.key==='Tab'&&e.shiftKey&&e.target===go){e.preventDefault();current.focus({preventScroll:true});return;}
    if((e.target===current||tip.contains(e.target))&&scroll){
      if(['ArrowLeft','ArrowRight'].includes(e.key)){e.stopPropagation();return;}
      const shifts={ArrowDown:40,ArrowUp:-40,PageDown:scroll.clientHeight*.85,PageUp:-scroll.clientHeight*.85,Home:-Infinity,End:Infinity};
      if(Object.hasOwn(shifts,e.key)){e.preventDefault();e.stopPropagation();
        scroll.scrollTop=clamp(scroll.scrollTop+shifts[e.key],0,scroll.scrollHeight-scroll.clientHeight);}
    }
  },true);
  window.addEventListener('resize',frame);window.visualViewport?.addEventListener('resize',frame);
  window.visualViewport?.addEventListener('scroll',frame);window.addEventListener('scroll',frame,true);
  window.addEventListener('blur',hide);window.addEventListener('pagehide',hide);
})();
