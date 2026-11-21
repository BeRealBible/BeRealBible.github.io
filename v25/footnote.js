/* Printed note anchors open the same scripture reader as any other citation. */
(() => {
  'use strict';
  const doc=document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
  if(!stage||!book)return;
  const manager=()=>window.V25ScriptureWindows;
  const anchorOf=node=>node?.closest?.('[data-footnote-anchor]');
  const inside=(element,node)=>!!element&&!!node?.nodeType&&element.contains(node);
  const tip=()=>manager()?.preview.panel;
  let current=null,returning=null,timer=0,keyFocus=false;
  const cancel=()=>{clearTimeout(timer);timer=0;};
  const forbidden=()=>book.classList.contains('curl-active')||['running','switching'].includes(stage.dataset.jumpState)||
    !!doc.querySelector('#edge-index-host[data-edge-expanded="true"],.edge-chapters:not([hidden]),#book-picker[open]');
  function detached(button,restore){
    if(current!==button)return;
    cancel();observer.disconnect();current=null;keyFocus=false;
    button.setAttribute('aria-expanded','false');
    if(restore&&button.isConnected){
      returning=button;button.focus({preventScroll:true});returning=null;
    }
  }
  function hide(){
    if(current&&manager()?.preview.is('footnote'))manager().preview.close('outside');
  }
  const observer=new MutationObserver(()=>{if(current&&(!current.isConnected||forbidden()))hide();});
  function show(button,interactive=false){
    cancel();if(!manager()||!button?.isConnected||button.disabled||forbidden())return;
    if(current===button){if(interactive)keyFocus=true;return;}
    const api=window.PaperFootnotePassages,note=api?.byOrdinal(Number(button.dataset.notePage),Number(button.dataset.noteOrdinal));
    const refs=api?.resolve(button.dataset.parallel||note?.citation,window.BIBLE_SOURCE);
    if(!refs?.length)return;
    if(!manager().openPreview(refs,{kind:'footnote',label:'引用经文',ariaLabel:'注释经文浮窗',anchor:button,
      onClose:(_,restore)=>detached(button,restore)}))return;
    current=button;keyFocus=interactive;
    button.setAttribute('aria-controls',tip().id);button.setAttribute('aria-expanded','true');
    observer.observe(button.parentElement,{childList:true});
    const page=button.closest('.paper');
    if(page&&page!==button.parentElement)observer.observe(page,{childList:true});
    observer.observe(book,{attributes:true,attributeFilter:['class']});
    observer.observe(stage,{attributes:true,attributeFilter:['data-spread','data-jump-state']});
  }
  function scheduleHide(){cancel();timer=setTimeout(()=>{if(!keyFocus)hide();},360);}
  doc.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch'||e.buttons)return;
    const a=anchorOf(e.target);
    if(a&&a!==anchorOf(e.relatedTarget))show(a);
    else if(current&&inside(tip(),e.target))cancel();
  });
  doc.addEventListener('pointerout',e=>{
    if(!current||e.pointerType==='touch')return;
    const panel=tip();
    if((inside(current,e.target)||inside(panel,e.target))&&!inside(current,e.relatedTarget)&&!inside(panel,e.relatedTarget))scheduleHide();
  });
  doc.addEventListener('focusin',e=>{
    const a=anchorOf(e.target);
    if(a){if(a!==returning)show(a,a.matches(':focus-visible'));}
    else if(current&&inside(tip(),e.target)){cancel();keyFocus=true;}
  });
  doc.addEventListener('focusout',e=>{
    if(current&&(e.target===current||inside(tip(),e.target))&&!inside(tip(),e.relatedTarget)&&e.relatedTarget!==current){
      keyFocus=false;scheduleHide();
    }
  });
  doc.addEventListener('click',e=>{const a=anchorOf(e.target);if(a)show(a,true);});
  window.V25PaperDock.onTap(stage,target=>{if(current&&!anchorOf(target))hide();});
  doc.addEventListener('pointerdown',e=>{
    if(current&&!inside(tip(),e.target)&&!anchorOf(e.target)&&!e.target.closest?.('.pcz-control,.zoom-tools'))hide();
  },true);
  doc.addEventListener('keydown',e=>{
    if(!current||e.target!==current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide();return;}
    if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();manager().preview.focus();}
  },true);
})();
