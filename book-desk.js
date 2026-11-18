/* One desk, several open copies. Snapshots include the physical book only,
   not the surrounding controls. The live DOM and reading store stay unique. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookDesk=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  // Physical positions are independent of last-opened order, pin order and page numbers.
  function rank(key){
    return /^r[1-9][0-9]*$/.test(key||'')?Number(key.slice(1)):0;
  }
  function create(stage,surface){
    const doc=stage.ownerDocument,win=doc.defaultView;let current=null;
    function end(t){
      if(current!==t)return;current=null;stage.inert=t.inert;
      delete stage.dataset.deskMotion;delete doc.documentElement.dataset.bookDesk;
    }
    function cancel(){
      const t=current;if(!t)return;end(t);
      t.transition?.skipTransition();t.animation?.cancel();
    }
    function start(direction,swap){
      cancel();
      if(!surface||win.matchMedia('(prefers-reduced-motion: reduce)').matches){swap();return;}
      const t=current={inert:stage.inert};stage.inert=true;
      doc.documentElement.dataset.bookDesk=stage.dataset.deskMotion=direction>0?'forward':'backward';
      const apply=()=>{if(current===t&&!t.swapped){t.swapped=true;swap();}};
      if(typeof doc.startViewTransition==='function'){
        try{
          t.transition=doc.startViewTransition(apply);
          t.transition.ready.catch(()=>{}); // hidden tabs / skipped transitions still run the update.
          t.transition.finished.then(()=>{apply();end(t);},()=>{apply();end(t);});return;
        }catch{/* Use the same directional movement without snapshot support. */}
      }
      if(!surface.animate){apply();end(t);return;}
      const slide=(a,b,d,easing)=>surface.animate([{transform:'translateX('+a+'%)'},{transform:'translateX('+b+'%)'}],{duration:d,easing,fill:'both'});
      t.animation=slide(0,-direction*100,130,'ease-in');
      t.animation.finished.then(()=>{if(current!==t)return;t.animation.cancel();apply();
        if(current!==t)return;t.animation=slide(direction*100,0,175,'ease-out');
        return t.animation.finished.then(()=>{if(current===t){t.animation.cancel();end(t);}});
      }).catch(()=>{if(current===t){apply();end(t);}});
    }
    return {start,cancel};
  }
  return {rank,create};
});
