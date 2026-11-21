/* Printed note anchors open the same scripture reader as any other citation. */
(() => {
  'use strict';
  const doc=document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
  if(!stage||!book)return;
  const manager=()=>window.V25ScriptureWindows;
  const anchorOf=node=>node?.closest?.('[data-footnote-anchor]');
  const inside=(element,node)=>!!element&&!!node?.nodeType&&element.contains(node);
  const tip=()=>manager()?.preview.panel;
  const picker=doc.createElement('div');picker.id='v25-citation-choice';picker.hidden=true;
  picker.setAttribute('role','group');picker.setAttribute('aria-label','选择一处引用经文');
  stage.parentElement.append(picker);
  let current=null;
  const forbidden=()=>book.classList.contains('curl-active')||['running','switching'].includes(stage.dataset.jumpState)||
    !!doc.querySelector('#edge-index-host[data-edge-expanded="true"],.edge-chapters:not([hidden]),#book-picker[open]');
  function detached(button,restore){
    if(current!==button)return;
    observer.disconnect();current=null;picker.hidden=true;picker.replaceChildren();
    button.setAttribute('aria-expanded','false');
    if(restore&&button.isConnected)button.focus({preventScroll:true});
  }
  function hide(restore=false){
    if(!current)return;
    if(picker.hidden&&manager()?.preview.is('footnote'))manager().preview.close('outside',restore);
    else detached(current,restore);
  }
  const observer=new MutationObserver(()=>{if(current&&(!current.isConnected||forbidden()))hide();});
  function track(button,id){
    current=button;
    button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded','true');
    observer.observe(button.parentElement,{childList:true});
    const page=button.closest('.paper');
    if(page&&page!==button.parentElement)observer.observe(page,{childList:true});
    observer.observe(book,{attributes:true,attributeFilter:['class']});
    observer.observe(stage,{attributes:true,attributeFilter:['data-spread','data-jump-state']});
  }
  function placePicker(){
    if(!current||picker.hidden)return;
    const vv=window.visualViewport,edge=8,left=(vv?.offsetLeft||0)+edge,top=(vv?.offsetTop||0)+edge,
      right=left+(vv?.width||window.innerWidth)-edge*2,bottom=top+(vv?.height||window.innerHeight)-edge*2;
    const rect=current.getBoundingClientRect(),box=picker.getBoundingClientRect();
    const want=bottom-rect.bottom>=box.height+4||rect.top-top<box.height?rect.bottom+3:rect.top-box.height-3;
    picker.style.left=Math.max(left,Math.min(rect.left,right-box.width))+'px';
    picker.style.top=Math.max(top,Math.min(want,bottom-box.height))+'px';
  }
  function read(button,choice,keyboard){
    picker.hidden=true;picker.replaceChildren();
    if(!manager().openPreview(choice.locs,{kind:'footnote',label:'引用经文',ariaLabel:'注释经文浮窗',anchor:button,focus:keyboard,
      onClose:(_,restore)=>detached(button,restore)})){if(current===button)detached(button,false);return;}
    track(button,tip().id);
  }
  function activate(button,keyboard=false){
    if(!manager()||!button?.isConnected||button.disabled||forbidden())return;
    const api=window.PaperFootnotePassages,note=api?.byOrdinal(Number(button.dataset.notePage),Number(button.dataset.noteOrdinal));
    const parts=api?.resolveParts(button.dataset.parallel||note?.citation,window.BIBLE_SOURCE);
    const options=parts?.length?manager().choices(parts):[];
    if(!options.length)return;
    if(current===button&&(!picker.hidden||options.length===1)){hide();return;}
    hide();
    if(options.length===1){read(button,options[0],keyboard);return;}
    // Unambiguous per-reference ink targets already arrive as single options.
    // A shared paper hit area asks which citation to read before opening text.
    manager().preview.close('replace');
    for(const choice of options){
      const item=doc.createElement('button');item.type='button';item.textContent=choice.short;
      item.title=choice.label;item.setAttribute('aria-label','阅读 '+choice.label);
      item.onclick=e=>read(button,choice,e.detail===0);
      picker.append(item);
    }
    track(button,picker.id);picker.hidden=false;placePicker();
    if(keyboard)picker.firstElementChild.focus({preventScroll:true});
  }
  window.addEventListener('resize',placePicker);
  window.visualViewport?.addEventListener('resize',placePicker);
  window.addEventListener('v25-camera-changed',placePicker);
  // Both kinds are native buttons: a click, tap, Enter or Space activates.
  // Hover and merely focusing a reference never interrupt the reading desk.
  doc.addEventListener('click',e=>{const a=anchorOf(e.target);if(a)activate(a,e.detail===0);});
  doc.addEventListener('pointerdown',e=>{
    if(current&&!inside(tip(),e.target)&&!inside(picker,e.target)&&!anchorOf(e.target)&&!e.target.closest?.('.pcz-control,.zoom-tools'))hide();
  },true);
  doc.addEventListener('keydown',e=>{
    if(!current||e.target!==current&&!inside(picker,e.target))return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hide(true);return;}
    if(e.target===current&&e.key==='Tab'&&!e.shiftKey){
      e.preventDefault();if(picker.hidden)manager().preview.focus();else picker.firstElementChild.focus({preventScroll:true});
    }
  },true);
})();
