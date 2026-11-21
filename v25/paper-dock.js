/* Coordinates and sizes in screen CSS pixels; content dimensions in paper units. */
window.V25PaperDock=(()=>{
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function sizeScale(scale,narrow,width,height,minW,minH){
    return narrow?Math.min(scale,width/minW,height/minH):scale;
  }
  // A pinch or pan on the book is not an outside tap on a paper accessory.
  function onTap(stage,fn){
    const ids=new Set();let start;
    stage.addEventListener('pointerdown',e=>{
      ids.add(e.pointerId);start=ids.size===1&&e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId,target:e.target}:null;
    },true);
    stage.addEventListener('pointermove',e=>{if(start?.id===e.pointerId&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)start=null;},true);
    window.addEventListener('pointerup',e=>{const tap=start?.id===e.pointerId&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<=6?start:null;
      ids.delete(e.pointerId);start=null;if(tap)fn(tap.target);
    },true);
    window.addEventListener('pointercancel',e=>{ids.delete(e.pointerId);start=null;},true);
    window.addEventListener('blur',()=>{ids.clear();start=null;});
  }
  function relayZoom(factor,x,y){window.dispatchEvent(new CustomEvent('v25-paper-zoom',{detail:{factor,x,y}}));}
  const accessory=target=>target?.closest?.('#footnote-preview,#verse-finder,#vf-tab,.compare-slip:not([data-collapsed]),[data-footnote-anchor]');
  document.addEventListener('wheel',e=>{
    if(!(e.ctrlKey||e.metaKey)||!accessory(e.target)||!e.deltaY)return;
    e.preventDefault();e.stopPropagation();
    const n=accessory(e.target),r=document.getElementById('stage').getBoundingClientRect();
    const ax=n.dataset.dockX!==undefined?r.left+Number(n.dataset.dockX):e.clientX;
    const ay=n.dataset.dockY!==undefined?r.top+Number(n.dataset.dockY):e.clientY;
    relayZoom(Math.exp(-e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1)*.003),ax,ay);
  },{capture:true,passive:false});
  let pinch=null;
  const dist=t=>Math.hypot(t[1].clientX-t[0].clientX,t[1].clientY-t[0].clientY);
  document.addEventListener('touchstart',e=>{
    // Stage gestures (including footnote targets) already have their own pinch arbiter.
    if(e.touches.length===2&&accessory(e.target)&&!e.target.closest('#stage')){
      pinch=dist(e.touches);e.preventDefault();
    }
  },{capture:true,passive:false});
  document.addEventListener('touchmove',e=>{
    if(!pinch||e.touches.length!==2)return;
    const t=e.touches,next=dist(t);if(!next)return;e.preventDefault();
    relayZoom(next/pinch,(t[0].clientX+t[1].clientX)/2,(t[0].clientY+t[1].clientY)/2);pinch=next;
  },{capture:true,passive:false});
  for(const name of ['touchend','touchcancel'])document.addEventListener(name,()=>{pinch=null;},true);
  return {clamp,sizeScale,onTap};
})();
