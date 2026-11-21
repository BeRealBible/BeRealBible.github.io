/* Printed note anchors open the same scripture reader as any other citation. */
(() => {
  'use strict';
  const doc=document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
  if(!stage||!book)return;
  const manager=()=>window.V25ScriptureWindows;
  const anchorOf=node=>node?.closest?.('[data-footnote-anchor]');
  const inside=(element,node)=>!!element&&!!node?.nodeType&&element.contains(node);
  const tip=()=>manager()?.preview.panel;
  let current=null;
  const forbidden=()=>book.classList.contains('curl-active')||['running','switching'].includes(stage.dataset.jumpState)||
    !!doc.querySelector('#edge-index-host[data-edge-expanded="true"],.edge-chapters:not([hidden]),#book-picker[open]');
  function detached(button,restore){
    if(current!==button)return;
    observer.disconnect();current=null;
    button.setAttribute('aria-expanded','false');
    if(restore&&button.isConnected)button.focus({preventScroll:true});
  }
  function hide(){
    if(current&&manager()?.preview.is('footnote'))manager().preview.close('outside');
  }
  const observer=new MutationObserver(()=>{if(current&&(!current.isConnected||forbidden()))hide();});
  function activate(button,keyboard=false){
    if(!manager()||!button?.isConnected||button.disabled||forbidden())return;
    if(current===button){hide();return;}
    const api=window.PaperFootnotePassages,note=api?.byOrdinal(Number(button.dataset.notePage),Number(button.dataset.noteOrdinal));
    const refs=api?.resolve(button.dataset.parallel||note?.citation,window.BIBLE_SOURCE);
    if(!refs?.length)return;
    if(!manager().openPreview(refs,{kind:'footnote',label:'引用经文',ariaLabel:'注释经文浮窗',anchor:button,focus:keyboard,
      onClose:(_,restore)=>detached(button,restore)}))return;
    current=button;
    button.setAttribute('aria-controls',tip().id);button.setAttribute('aria-expanded','true');
    observer.observe(button.parentElement,{childList:true});
    const page=button.closest('.paper');
    if(page&&page!==button.parentElement)observer.observe(page,{childList:true});
    observer.observe(book,{attributes:true,attributeFilter:['class']});
    observer.observe(stage,{attributes:true,attributeFilter:['data-spread','data-jump-state']});
  }
  // Both kinds are native buttons: a click, tap, Enter or Space activates.
  // Hover and merely focusing a reference never interrupt the reading desk.
  doc.addEventListener('click',e=>{const a=anchorOf(e.target);if(a)activate(a,e.detail===0);});
  doc.addEventListener('pointerdown',e=>{
    if(current&&!inside(tip(),e.target)&&!anchorOf(e.target)&&!e.target.closest?.('.pcz-control,.zoom-tools'))hide();
  },true);
  doc.addEventListener('keydown',e=>{
    if(!current||e.target!==current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide();return;}
    if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();manager().preview.focus();}
  },true);
})();
