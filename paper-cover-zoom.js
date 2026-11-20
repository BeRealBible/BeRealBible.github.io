/* Optional controls and a presentation-only opening; the reader owns its camera. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperCoverZoom=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function zoomLimits(scale,fit,limit){
    if(![scale,fit,limit].every(Number.isFinite)||fit<=0||limit<fit)return null;
    const max=Math.max(100,Math.floor(limit/fit*100));
    return {max,value:clamp(Math.round(scale/fit*100),100,max)};
  }
  function asScale(percent,fit,limit){
    const bounds=zoomLimits(fit,fit,limit);
    if(!bounds||!Number.isFinite(percent))return null;
    if(percent>=bounds.max&&bounds.max>100)return limit;
    return clamp(percent/100*fit,fit,limit);
  }
  const sessions=new WeakSet();
  function mount({doc,win,stage,history,onZoom}){
    if(!stage||!onZoom)return null;
    const el=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text)n.textContent=text;return n;};
    const control=el('div','pcz-control'),button=el('button','pcz-button','比例'),panel=el('div','pcz-panel');
    const heading=el('label','pcz-label','阅读比例'),value=el('output','pcz-value','100%'),range=el('input','pcz-range');
    const shelf=history?.querySelector('.rh-rail');
    if(doc.documentElement?.dataset.readerBuild==='index-25'){
      button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4m4-4h8M12 8v8"/></svg>';
      button.setAttribute('aria-label','阅读比例');button.title='阅读比例';
      heading.classList.add('immersion-sr-only');
      win.addEventListener('paper-reader-chrome-hidden',()=>show(false));
    }
    button.type='button';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','pcz-panel');
    panel.id='pcz-panel';panel.hidden=true;range.id='pcz-range';range.type='range';range.min='100';range.step='1';
    heading.htmlFor=range.id;value.setAttribute('for',range.id);
    const summary=el('div','pcz-summary');summary.append(heading,value);panel.append(summary,range);control.append(button,panel);
    if(shelf)shelf.prepend(control);
    else (stage.closest('.stage-wrap')||stage).append(control);
    function show(open,restore=false){
      panel.hidden=!open;button.setAttribute('aria-expanded',String(open));
      if(open)range.focus({preventScroll:true});else if(restore)button.focus({preventScroll:true});
    }
    button.addEventListener('click',()=>show(panel.hidden));
    range.addEventListener('input',()=>{const n=Number(range.value);if(Number.isFinite(n))onZoom(n);});
    control.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();show(false,true);}});
    control.addEventListener('focusout',event=>{if(!panel.hidden&&event.relatedTarget&&!control.contains(event.relatedTarget))show(false);});
    doc.addEventListener('pointerdown',event=>{if(!panel.hidden&&!event.composedPath().includes(control))show(false);},true);
    function sync(scale,fit,limit){
      const bounds=zoomLimits(scale,fit,limit);if(!bounds)return;
      range.max=String(bounds.max);range.value=String(bounds.value);
      value.value=bounds.value+'%';range.setAttribute('aria-valuetext',value.value);
    }
    function openOnce(){
      if(sessions.has(doc))return;
      sessions.add(doc);
      const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
      if(motion?.matches||doc.hidden)return;
      const scene=el('div','pcz-intro');
      scene.setAttribute('aria-hidden','true');
      const plate=el('div','pcz-plate'),stack=el('div','pcz-stack'),lid=el('div','pcz-lid'),face=el('div','pcz-face'),back=el('div','pcz-back');
      const imprint=el('div','pcz-imprint','圣经'),subtitle=el('div','pcz-subtitle','和合本');
      face.append(imprint,subtitle);lid.append(face,back);plate.append(stack,lid);scene.append(plate);stage.append(scene);
      let timer;
      const events=['pointerdown','keydown','wheel','touchstart'];
      const dismiss=()=>{clearTimeout(timer);events.forEach(type=>doc.removeEventListener(type,dismiss,true));doc.removeEventListener('visibilitychange',dismiss);motion?.removeEventListener?.('change',dismiss);scene.remove();};
      events.forEach(type=>doc.addEventListener(type,dismiss,{capture:true,passive:true}));
      doc.addEventListener('visibilitychange',dismiss);
      motion?.addEventListener?.('change',dismiss);
      scene.addEventListener('animationend',event=>{if(event.target===scene&&event.animationName==='pcz-reveal')dismiss();});
      timer=setTimeout(dismiss,2450);
    }
    return {sync,openOnce};
  }
  return {mount,zoomLimits,asScale};
});
