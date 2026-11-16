/* One turning interval of absolute sheet depths. The three intervals retain
 * their paper throughout the turn; reading spread is committed only at p=1. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./book-kinematics.js'):root.PaperBookKinematics);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookPacket=api;
})(typeof window!=='undefined'?window:globalThis,function(K){
  'use strict';
  const mix=(a,b,t)=>a+(b-a)*t,clamp=v=>Math.max(0,Math.min(1,v));
  const blend=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),z:mix(a.z,b.z,t)});
  function sample(from,to,progress,initialState){
    const p=clamp(progress),t=p*p*(3-2*p),s0=from.leftDepth,s1=to.leftDepth,dir=Math.sign(s1-s0);
    if(!dir)throw new RangeError('A turning packet needs at least one sheet');
    const source=dir>0?'right':'left',destination=dir>0?'left':'right';
    const a=K.prepare(from,0,initialState),b=K.prepare(to,0,{notches:initialState.notches});
    const span=Math.abs(s1-s0),low=Math.min(s0,s1),high=Math.max(s0,s1);
    function resting(side,s,u,y){
      return p===0?a.pagePoint(side,s,u,y):p===1?b.pagePoint(side,s,u,y):blend(a.pagePoint(side,s,u,y),b.pagePoint(side,s,u,y),t);
    }
    function moving(s,u,y){
      const start=a.pagePoint(source,s,u,y);
      if(p===0)return start;
      const end=b.pagePoint(destination,s,u,y);
      if(p===1)return end;
      const hingeA=a.pagePoint(source,s,0,y),hingeB=b.pagePoint(destination,s,0,y);
      const hinge=blend(hingeA,hingeB,t);
      // Layers rotate together around their own sewn roots. A travelling bend
      // leads at the free edge and dies at the spine, not a whole rigid board.
      const wave=Math.sin(Math.PI*t),theta=Math.PI*t+wave*.58*u;
      const across=mix((start.x-hingeA.x)*dir,(hingeB.x-end.x)*dir,t);
      const lift=across*Math.sin(theta)+34*Math.sin(Math.PI*u)*wave;
      const thicknessTilt=(s-(s0+s1)/2)*dir;
      return {x:hinge.x+dir*(across*Math.cos(theta)+thicknessTilt*wave*(.42+.23*u)),
        y:mix(start.y,end.y,t)+wave*12*u*(y/K.HEIGHT-.5),
        z:mix(start.z,end.z,t)+lift+thicknessTilt*(1-Math.cos(theta*2))*.32*u};
    }
    const sections=[
      {side:'left',lo:0,hi:low,point:(s,u,y)=>resting('left',s,u,y)},
      {side:'right',lo:high,hi:from.totalDepth,point:(s,u,y)=>resting('right',s,u,y)},
      {side:source,lo:low,hi:high,point:moving,moving:true}
    ];
    return {progress:p,t,span,s0,s1,dir,source,destination,sections,moving,resting};
  }
  return {sample};
});
