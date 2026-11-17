/* Bounded, staggered double-sided leaves for an explicit book/chapter jump.
 * The caller supplies real page SVG and owns the static pages underneath. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperJump=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:960,HEIGHT:704,PAGE_WIDTH:480,MAX_LEAVES:9,DURATION:560,SINGLE_DURATION:620,STAGGER_SPAN:380,WATCHDOG_MIN:5000,WATCHDOG_MULTIPLIER:4});
  function plan(from,to){
    if(![from,to].every(n=>Number.isSafeInteger(n)&&n>=0&&n%2===0))throw new RangeError('PaperJump expects non-negative even spread indices');
    const distance=Math.abs(to-from)/2,direction=Math.sign(to-from);
    const count=distance?Math.min(distance,constants.MAX_LEAVES,2+Math.floor(Math.log2(distance))):0;
    const duration=count===1?constants.SINGLE_DURATION:constants.DURATION;
    const stagger=count>1?Math.max(55,constants.STAGGER_SPAN/count):0;
    const leaves=Array.from({length:count},(_,i)=>{
      const offset=count===1?0:Math.round((distance-1)*i/(count-1));
      const front=direction>0?from+1+2*offset:from-1-2*offset;
      return {index:i,front,back:front+1,delay:i*stagger,duration,fromAngle:direction>0?0:-180,toAngle:direction>0?-180:0};
    });
    return {from,to,direction,distance,count,duration,stagger,totalDuration:count?duration+(count-1)*stagger:0,leaves};
  }
  function create(host,{renderPage}={}){
    if(!host?.ownerDocument||typeof renderPage!=='function')throw new TypeError('PaperJump requires a book DOM host and renderPage(index)');
    const doc=host.ownerDocument,win=doc.defaultView||globalThis;
    let running=null;
    const report=error=>{try{win.console?.error?.('PaperJump callback failed',error);}catch{}};
    function settle(task,completed,reason){
      if(!task||task.done||running!==task)return;
      task.done=true;running=null;
      for(const id of task.timers)win.clearTimeout(id);
      task.timers.clear();
      for(const animation of task.animations){try{animation.cancel();}catch{}}
      task.layer?.remove();host.classList?.remove('paper-jump-active');
      host.dataset.jumpState=completed?'finished':'cancelled';
      host.dataset.jumpReason=reason;
      const callback=completed?task.onFinish:task.onCancel;
      if(typeof callback==='function'){
        try{callback({from:task.plan.from,to:task.plan.to,reason});}catch(error){report(error);}
      }
    }
    function cancel(){if(!running)return false;settle(running,false,'cancelled');return true;}
    function timer(task,fn,delay){
      const id=win.setTimeout(()=>{task.timers.delete(id);if(running===task&&!task.done)fn();},delay);
      task.timers.add(id);return id;
    }
    function start({from,to,onFinish,onCancel}={}){
      let p;try{p=plan(from,to);}catch{return false;}
      if(running)settle(running,false,'superseded');
      // An old onCancel callback may itself have started a replacement jump.
      if(running)return false;
      const task={plan:p,onFinish,onCancel,done:false,layer:null,animations:[],timers:new Set(),pending:p.count};
      running=task;host.classList?.add('paper-jump-active');
      Object.assign(host.dataset,{jumpState:'running',jumpFrom:String(from),jumpTo:String(to),jumpLeaves:String(p.count),jumpDirection:p.direction>0?'forward':p.direction<0?'backward':'none'});
      delete host.dataset.jumpReason;
      if(!p.count||win.matchMedia?.('(prefers-reduced-motion: reduce)').matches){settle(task,true,p.count?'reduced-motion':'same-spread');return true;}
      try{
        const layer=doc.createElement('div');layer.className='paper-jump-layer';layer.setAttribute('aria-hidden','true');
        layer.dataset.direction=p.direction>0?'forward':'backward';task.layer=layer;
        for(const leafPlan of p.leaves){
          const leaf=doc.createElement('div');leaf.className='paper-jump-leaf';
          Object.assign(leaf.dataset,{front:String(leafPlan.front),back:String(leafPlan.back),leaf:String(leafPlan.index)});
          leaf.style.transform=`rotateY(${leafPlan.fromAngle}deg)`;leaf.style.zIndex=String(20-leafPlan.index);
          for(const side of ['front','back']){
            const face=doc.createElement('div');face.className='paper-jump-face paper-jump-face--'+side;
            const html=renderPage(leafPlan[side]);if(typeof html!=='string')throw new TypeError('renderPage(index) must return page SVG markup');
            face.innerHTML=html;leaf.appendChild(face);
          }
          layer.appendChild(leaf);
        }
        host.appendChild(layer);
        if(!layer.children[0]?.animate){settle(task,true,'animation-unavailable');return true;}
        p.leaves.forEach((leafPlan,i)=>{
          const leaf=layer.children[i];
          const animation=leaf.animate([{transform:`rotateY(${leafPlan.fromAngle}deg)`},{transform:`rotateY(${leafPlan.toAngle}deg)`}],{
            duration:leafPlan.duration,delay:leafPlan.delay,easing:'cubic-bezier(.42,0,.3,1)',fill:'both'
          });
          task.animations.push(animation);
          // As each leaf crosses the spine it joins the top of the destination stack.
          timer(task,()=>{leaf.style.zIndex=String(30+i);},leafPlan.delay+leafPlan.duration*.5);
          animation.finished.then(()=>{
            if(running!==task||task.done)return;
            if(--task.pending===0)settle(task,true,'finished');
          },()=>settle(task,false,'animation-error'));
        });
        // Only recover a genuinely stalled animation. Painting up to eighteen real
        // SVG pages (or a background tab) may delay the first presentation well
        // beyond the nominal duration; finished promises own normal completion.
        timer(task,()=>settle(task,true,'animation-timeout'),Math.max(constants.WATCHDOG_MIN,p.totalDuration*constants.WATCHDOG_MULTIPLIER));
        return true;
      }catch(error){settle(task,false,'render-or-animation-error');return false;}
    }
    return {start,cancel,isActive:()=>Boolean(running)};
  }
  return {constants,plan,create};
});
