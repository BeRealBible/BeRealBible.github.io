/* One close request, one visible unpinned layer. */
(() => {
  'use strict';
  const win=window,doc=win.document,h=win.history;
  const android=/Android/i.test(win.navigator.userAgent)||win.navigator.userAgentData?.platform==='Android';
  const key='paperV25OverlayBack',legacy='paperV25NoteBack',entries=new Set(),dialogOrder=new WeakMap();
  const readDepth=()=>Number.isSafeInteger(h.state?.[key])&&h.state[key]>0?h.state[key]:h.state?.[legacy]===true?1:0;
  let sequence=0,watcher=null,queued=false,depth=readDepth(),cleanup=null,gesture=0,needsGesture=false,dormant=false;

  function stack(){
    const dialogs=[...doc.querySelectorAll('dialog[open]')].sort((a,b)=>(dialogOrder.get(a)||0)-(dialogOrder.get(b)||0));
    const layers=dialogs.map((dialog,i)=>({scope:i+1,level:-1,dialog,dismiss(){
      if(dialog.requestClose)dialog.requestClose();else dialog.close();
    }}));
    for(const entry of entries){
      const {el,layer,active,dismiss,order}=entry;
      if(!el.isConnected||!active())continue;
      layers.push({scope:dialogs.findLastIndex(d=>d.contains(el))+1,
        level:typeof layer==='function'?layer():layer,order:order?.()||0,dismiss});
    }
    return layers.sort((a,b)=>a.scope-b.scope||a.level-b.level||(a.order||0)-(b.order||0));
  }
  function dismiss(item){if(item){item.dismiss();schedule();}}
  win.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||e.keyCode===229)return;
    const item=stack().at(-1);if(!item)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!e.repeat)dismiss(item);
  },true);

  function sync(){
    queued=false;if(!android)return;
    const layers=stack(),top=layers.at(-1);
    // Native dialogs already watch close requests. Never let a watcher for
    // a background slip take their request instead.
    if(!top||top.dialog){watcher?.destroy();watcher=null;}
    else if(!watcher&&typeof win.CloseWatcher==='function')try{
      const active=watcher=new win.CloseWatcher();
      active.addEventListener('close',()=>{
        if(watcher!==active)return;
        watcher=null;dismiss(stack().at(-1));
      },{once:true});
    }catch{}

    if(cleanup)return;
    depth=readDepth();
    if(!layers.length&&dormant)return;
    if(layers.length)dormant=false;
    if(depth>layers.length){
      // Explicit close, fold or pin must not leave invisible Back steps.
      cleanup={gesture};
      try{h.go(layers.length-depth);}catch{cleanup=null;}
    }else if(depth<layers.length&&!needsGesture&&win.navigator.userActivation?.hasBeenActive!==false){
      // Reserve one step per layer before a browser-history Back. Chromium
      // may skip entries newly pushed after Back without another activation.
      try{
        while(depth<layers.length){
          h.pushState({...h.state,[key]:depth+1},'');depth++;
        }
      }catch{}
    }
  }
  function schedule(){
    if(!android||queued)return;
    queued=true;win.queueMicrotask(sync);
  }
  if(android){
    win.addEventListener('popstate',()=>{
      const previous=depth;depth=readDepth();
      if(cleanup){
        needsGesture=gesture===cleanup.gesture;cleanup=null;schedule();return;
      }
      needsGesture=true;
      const layers=stack();
      if(previous>depth){
        if(layers.length)dismiss(layers.at(-1));
        else if(dormant){dormant=false;h.go(-depth-1);return;}
      }else if(depth>previous&&!layers.length){
        // Forward into an old guard does not reopen a dismissed overlay.
        dormant=true;
      }
      schedule();
    });
    for(const event of ['pointerup','click','keyup'])win.addEventListener(event,e=>{
      if(e.isTrusted){gesture++;needsGesture=false;schedule();}
    },{capture:true,passive:true});
    win.addEventListener('pageshow',schedule);
  }
  new win.MutationObserver(changes=>{
    let changed=false;
    for(const {target} of changes)if(target.localName==='dialog'){
      if(target.open)dialogOrder.set(target,++sequence);
      changed=true;
    }
    if(changed)schedule();
  }).observe(doc.documentElement,{subtree:true,attributes:true,attributeFilter:['open']});

  win.V25OverlayBack={register(el,{dismiss,layer,order,active=()=>!el.hidden}){
    entries.add({el,dismiss,layer,order,active});
    if(android)new win.MutationObserver(changes=>{
      if(changes.some(change=>change.oldValue!==el.getAttribute(change.attributeName)))schedule();
    }).observe(el,{attributes:true,attributeOldValue:true,attributeFilter:['hidden','data-kind','data-collapsed']});
    schedule();
  },sync:schedule};
})();
