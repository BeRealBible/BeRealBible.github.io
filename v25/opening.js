/* Open the live spread, not a copy or a picture of it. */
((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25Opening=api;
})(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const clamp=v=>Math.min(1,Math.max(0,v));
  const mix=(a,b,t)=>a+(b-a)*t;
  const ease=t=>t*t*(3-2*t);
  const SPINE=480,HEIGHT=704,DURATION=1510;
  const LID_START=85,LID_TRAVEL=1000,PAPER_START=252,PAPER_TRAVEL=1125;
  function shot(elapsed,{x,y,scale,w,h},layoutZoom=false){
    const c=clamp((elapsed-LID_START)/LID_TRAVEL),p=clamp((elapsed-PAPER_START)/PAPER_TRAVEL);
    const coverOpen=ease(c),paperOpen=ease(p);
    const coverAngle=180*(1-coverOpen),paperAngle=180*(1-paperOpen);
    const bend=p===1?0:Math.pow(Math.sin(p*Math.PI),1.55);
    // Actual cut positions stay fixed on each stock; their projected width
    // only starts to grow once the front cover clears the fore-edge.
    const cuts=ease(clamp((coverOpen-.15)/.77));
    const binding={coverAngle,paperAngle,bend,coverOpen,cuts,
      coverLift:21*(1-coverOpen),paperLift:9*(1-paperOpen),
      leftEdge:mix(.12,1,paperOpen),rightEdge:mix(.12,1,cuts)};
    if(elapsed>=DURATION)return {x,y,scale,...binding};
    // Begin over the closed book. As the left leaf lowers, the silhouette
    // grows leftward. Track its centre before settling on the reader's anchor.
    const centre=SPINE*(1.5-.5*Math.max(0,Math.cos(coverAngle*Math.PI/180)));
    const margin=Math.min(w<560?24:56,w*.15,h*.15);
    const wide=Math.min((w-margin*2)/532,(h-margin*2)/742,.88);
    // Hold scale through the initial separation. Touch then uses the reader's
    // usual layout zoom, rather than making a large transformed book texture.
    const approach=layoutZoom?645:415;
    const aim=ease(clamp((elapsed-approach)/(DURATION-approach)));
    const s=wide*Math.pow(scale/wide,aim);
    return {x:w/2-mix(centre,(w/2-x)/scale,aim)*s,
      y:h/2-mix(HEIGHT/2,(h/2-y)/scale,aim)*s,scale:s,...binding};
  }
  // Only the unprinted margins bend in silhouette. Both sides share the
  // same shape, while the live face carries all glyphs, saved ink and notes.
  // No DOM duplicate, readback, rasterisation, or per-frame SVG repaint call.
  function paperOutline(bend,back=false){
    if(bend<=.005)return 'none';
    const a=9*bend,f=n=>n.toFixed(2),x=n=>back?SPINE-n:n;
    return `path("M ${x(0)} ${f(a*.67)} C ${x(92)} ${f(a*2.25)} ${x(302)} ${f(a*.2)} ${x(SPINE)} 0 L ${x(SPINE)} ${HEIGHT} C ${x(317)} ${HEIGHT} ${x(105)} ${f(HEIGHT-a*1.6)} ${x(0)} ${f(HEIGHT-a*.85)} Z")`;
  }
  const paperTurn=f=>`translateZ(${f.paperLift}px) rotateY(${f.paperAngle}deg) skewY(${-1.25*f.bend}deg)`;
  const coverTurn=f=>`translateZ(${f.coverLift}px) rotateY(${f.coverAngle}deg)`;
  const indexTurn=f=>`translateX(480px) ${paperTurn(f)} translateX(-480px) scaleX(${f.leftEdge})`;
  function cameraTurn(f,pose,layoutZoom){
    const unit=layoutZoom?pose.scale:1,ox=layoutZoom?pose.x:0,oy=layoutZoom?pose.y:0;
    return `translate(${((f.x-ox)/unit).toFixed(4)}px,${((f.y-oy)/unit).toFixed(4)}px) scale(${(f.scale/unit).toFixed(7)})`;
  }
  const started=new WeakSet();
  function play({stage,book,pose,layoutZoom=false}){
    const doc=stage.ownerDocument,win=doc.defaultView;
    if(started.has(doc)||!stage.clientWidth||!stage.clientHeight||!(pose.scale>0))return;
    started.add(doc);
    const motion=win.matchMedia('(prefers-reduced-motion: reduce)');
    if(doc.hidden||motion.matches||!win.CSS.supports('transform-style','preserve-3d'))return;
    const find=selector=>book.querySelector(selector);
    const leaf=find('#left-half'),paper=find('#left-paper'),binding=find('.v25-front-binding');
    const left=find('.edge-index__leaf[data-side=left]'),right=find('.edge-index__leaf[data-side=right]');
    const back=find('#reference-cover');
    if(!leaf||!paper?.querySelector('svg[data-pdf]')||!find('#right-paper>svg[data-pdf]')||!binding||!left||!right||!back)return;
    // Touch: give the browser synchronized transform-only tracks that may run
    // on the compositor while the main thread paints the occasional paper
    // rim. The normal visual/layout zoom and paper SVGs stay in place.
    const tracks=[];
    if(layoutZoom&&typeof book.animate==='function'){
      const phase=[LID_START,PAPER_START,LID_START+LID_TRAVEL/2,PAPER_START+PAPER_TRAVEL/2,
        LID_START+LID_TRAVEL,PAPER_START+PAPER_TRAVEL,645];
      const stops=[...new Set([...Array.from({length:33},(_,i)=>DURATION*i/32),...phase])].sort((a,b)=>a-b);
      const samples=stops.map(t=>({offset:t/DURATION,frame:shot(t,pose,true)}));
      try{
        for(const [node,transform] of [[book,f=>cameraTurn(f,pose,true)],[binding,coverTurn],
          [leaf,paperTurn],[left,indexTurn],[right,f=>`scaleX(${f.cuts})`]]){
          const a=node.animate(samples.map(({offset,frame})=>({offset,transform:transform(frame)})),
            {duration:DURATION,fill:'both',easing:'linear'});
          tracks.push(a);a.pause();a.currentTime=0;
        }
      }catch{
        for(const track of tracks.splice(0))track.cancel();
      }
    }
    const pending=new Map(),readerTransform=book.style.transform;
    const set=(element,name,value)=>{
      const key='--v25-open-'+name;
      let last=pending.get(element);
      if(!last)pending.set(element,last=new Map());
      if(last.get(key)===value)return;
      element.style.setProperty(key,value);last.set(key,value);
    };
    let camera,lastTick=-1,lean=false;
    const render=elapsed=>{
      const tick=Math.floor(elapsed/(lean?50:34));
      if(tracks.length&&elapsed<DURATION&&tick===lastTick)return;
      lastTick=tick;
      const f=shot(elapsed,pose,layoutZoom);
      // Sub-pixel changes to a clipping path need not rerasterise the
      // entire text surface. Keep the hinge and camera continuous at full RAF.
      const levels=lean?5:12,rim=layoutZoom?Math.round(f.bend*levels)/levels:f.bend;
      set(binding,'cover-angle',f.coverAngle.toFixed(3)+'deg');set(binding,'cover-lift',f.coverLift.toFixed(3)+'px');
      // On touch resize the board only near edge-on, rather than laying out
      // the leather and endpaper again at every visible transform frame.
      set(binding,'cover-open',tracks.length?(f.coverAngle>=90?'0':'1'):f.coverOpen.toFixed(4));
      set(binding,'cover-z',f.coverAngle>=90?7:0);
      const paperAngle=f.paperAngle.toFixed(3)+'deg',paperLift=f.paperLift.toFixed(3)+'px',skew=(-1.25*f.bend).toFixed(3)+'deg';
      for(const plane of [leaf,left]){
        set(plane,'paper-angle',paperAngle);set(plane,'paper-lift',paperLift);set(plane,'paper-skew',skew);
      }
      set(paper,'bend',(lean?0:rim).toFixed(3));set(paper,'paper-curve',paperOutline(rim));
      set(leaf,'back-curve',paperOutline(rim,true));
      set(left,'index-trim-top',(rim*5.8).toFixed(2)+'px');set(left,'index-trim-bottom',(rim*7.6).toFixed(2)+'px');
      set(left,'left-edge',f.leftEdge.toFixed(4));set(back,'right-edge',f.rightEdge.toFixed(4));
      set(left,'left-cuts',f.paperAngle>90?'hidden':'visible');
      set(right,'right-cuts',f.cuts>0?'visible':'hidden');
      // At full closure even the fore-edge band collapses under the cover.
      set(right,'right-projected',f.cuts.toFixed(4));
      if(!tracks.length){
        const next=cameraTurn(f,pose,layoutZoom);
        if(next!==camera){book.style.transform=next;camera=next;}
      }
    };
    let frame,first,previous,active=true;
    const capture={capture:true,passive:false};
    // During the shot the book is inert to hit testing, so a tap on the
    // moving paper skips, rather than selects whatever is under it at rest.
    function onInput(event){
      if((event.type==='pointerdown'||event.type==='wheel')&&stage.contains(event.target)){
        event.preventDefault();event.stopImmediatePropagation();
      }
      finish();
    }
    function finish(){
      if(!active)return;
      active=false;win.cancelAnimationFrame(frame);
      delete stage.dataset.v25Opening;
      for(const track of tracks)track.cancel();
      book.style.transform=readerTransform;
      for(const [element,last] of pending)for(const key of last.keys())element.style.removeProperty(key);
      for(const type of ['pointerdown','keydown','wheel'])win.removeEventListener(type,onInput,true);
      doc.removeEventListener('visibilitychange',finish);motion.removeEventListener?.('change',finish);
      win.removeEventListener('pagehide',finish);
    }
    function step(now){
      if(first===undefined){
        first=now;for(const track of tracks)track.play();
      }
      const elapsed=now-first;
      // Keep the motion tracks intact on a busy touch device; economize on
      // paper-edge paint rather than making the page move in bigger jumps.
      if(layoutZoom&&!lean&&previous!==undefined&&now-previous>68&&elapsed>PAPER_START&&elapsed<DURATION-160){
        lean=true;lastTick=-1;
      }
      previous=now;
      render(elapsed);
      if(elapsed>=DURATION)for(const track of tracks)track.currentTime=DURATION;
      // Leave the exact resting camera on screen for a frame. Cleanup only
      // removes the motion styles; it doesn't paint or restore any page.
      frame=win.requestAnimationFrame(elapsed>=DURATION?finish:step);
    }
    render(0);stage.dataset.v25Opening=layoutZoom?'layout':'transform';
    for(const type of ['pointerdown','keydown','wheel'])win.addEventListener(type,onInput,capture);
    doc.addEventListener('visibilitychange',finish);motion.addEventListener?.('change',finish);
    win.addEventListener('pagehide',finish);
    frame=win.requestAnimationFrame(step);
    return {finish};
  }
  return {play,shot,paperOutline,DURATION};
});
