const assert=require('node:assert/strict');
const K=require('./book-kinematics.js'),M=require('./book-material.js'),Depth=require('./book-depth.js');
const Layout=require('./book-index-layout.js'),Packet=require('./book-packet.js'),Scene=require('./book-scene.js');
const {pages,books}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model),mat=p=>M.compute(p,pages.length,books);
const shape={notches},dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
assert.equal(notches.length,39);assert.equal(model.slots.length,66);
let outlineChecks=0;
for(const n of notches){
  const local={notches:[n]},m=mat(202),p=K.prepare(m,0,local);
  assert.ok(n.span>0&&n.radius>=13&&n.inset>=10);
  for(const y of [n.y-n.radius,n.y+n.radius])assert.ok(p.edgeInset('right',n.depth,y)<1e-5,'rounded vertical extrema');
  for(const s of [n.depth-n.span,n.depth+n.span].filter(s=>s>0&&s<36))
    assert.ok(p.edgeInset('left',s,n.y)<1e-5,'continuous side limit');
  assert.equal(p.edgeInset('right',n.depth,n.y),n.inset);
  assert.ok(p.edgeInset('right',n.depth,n.y+n.radius*.78)>n.inset*.59,'semicircular cross section');
  if(n.depth+n.span*.84<36){
    assert.ok(p.edgeInset('right',n.depth+n.span*.84,n.y)>n.inset*.55,'far wall slopes to floor');
    assert.equal(p.edgeInset('right',n.depth+n.span*.84,n.y+n.radius*.6),0,'upper corners remain uncut');
  }
  const close1=K.foreedgePoint('right',n.depth,n.y,mat(0),1,shape);
  const close2=K.foreedgePoint('left',n.depth,n.y,mat(1244),1,shape);
  assert.ok(dist(close1,close2)<1e-8,'closed solid is independent of the reading split');
  for(const i of n.indices){
    const slot=model.slots[i];assert.ok(Math.abs(slot.anchorDepth-mat(books[i].first&~1).leftDepth)<1e-10);
  }
  outlineChecks++;
}
const topology=Depth.topology(36,notches);
const knots=topology.flatMap(v=>[v.lo,v.hi]);
for(const n of notches)for(const q of [-1,-.42,0,.42,1]){
  assert.ok(knots.some(s=>Math.abs(s-Math.max(0,Math.min(36,n.depth+n.span*q)))<1e-8),'true lip and plateau boundaries are sampled');
}
// On one cut, overlap exists between the near opaque band and far inked
// slope. The shader and the hit resolver must agree on which wall is in front.
let shadowed=0,visible=0;
{
  for(const fanRight of [.42,.68,1]){
  const n={depth:16,span:1.46,y:260,radius:13,inset:11,milled:true},local={notches:[n],fanRight};
  const m=mat(0),p=K.prepare(m,0,local),tris=[];
  for(const band of Depth.topology(36,[n]))for(let j=0;j<band.ys.length-1;j++){
    const y0=band.ys[j],y1=band.ys[j+1],a=band.lo,b=band.hi;
    const points=[[a,y0],[b,y0],[b,y1],[a,y1]].map(([s,y])=>p.foreedgePoint('right',s,y));
    const ink=(a+b)/2>n.depth+n.span*.42&&(a+b)/2<n.depth+n.span&&y0>=n.y-n.radius&&y1<=n.y+n.radius;
    tris.push(...[[0,1,2],[0,2,3]].map(ids=>Depth.projectTriangle({points:ids.map(i=>points[i]),n:ink?n:null})));
  }
  for(const tri of tris.filter(t=>t.n))for(const weights of [[.2,.2,.6],[.35,.35,.3],[.65,.15,.2]]){
    const x=tri.p.reduce((a,p,i)=>a+p.x*weights[i],0),y=tri.p.reduce((a,p,i)=>a+p.y*weights[i],0);
    if(Math.abs(y-273)>24)continue;
    const hit=Depth.frontAt(tris,x,y);assert.ok(hit);
    if(hit.tri.n)visible++;else shadowed++;
  }
  }
  assert.ok(shadowed>0&&visible>0,'a real paper lip occludes some, but not all, of its own stamp');
}
const V={w:390,h:844},pose={zoom:1,cx:480,cy:352},fit=(390-66)/990;
let maxFrame=0,maxAccel=0,packets=0;
for(const [start,end] of [[0,books[18].first],[990,books[18].first],[622,books[40].first],[1200,books[65].first],[0,2],[1244,1242]]){
  const from=mat(start),to=mat(end&~1),side=to.spread>from.spread?'right':'left';
  const state={...shape,fanLeft:+(side==='left'),fanRight:+(side==='right')};
  const startPose={...pose,zoom:1.35,cx:side==='left'?270:720,cy:396};
  const top=K.pagePoint(side,from.leftDepth,1,352,from,0,state),base=K.pagePoint(side,side==='left'?0:36,1,352,from,0,state);
  const a=Packet.sample(from,to,0,state),b=Packet.sample(from,to,1,state);
  const normal=Scene.sample(0,pose,V,fit,null,0,to);
  const initial=Scene.fanFrame(Scene.sample(0,startPose,V,fit,null,0,from),1,side,top,base,290,V);
  assert.deepEqual(Scene.fanFrame(normal,1,side,top,base,290,V).x,initial.x,'camera is exactly at the selection pose at p=0');
  assert.equal(Scene.fanFrame(normal,0,side,top,base,290,V),normal,'camera returns to final reading pose without a handoff correction');
  let prev,previousStep;
  const steps=360;
  for(let i=0;i<=steps;i++){
    const progress=(1-Math.cos(i/steps*Math.PI))/2;
    const turn=Packet.sample(from,to,progress,state);
    assert.ok(Math.abs(turn.sections.reduce((t,s)=>t+s.hi-s.lo,0)-36)<1e-10,'absolute sheet intervals conserve mass');
    const inner=turn.moving(turn.s0,0,352),outer=turn.moving(turn.s1,0,352);
    assert.ok(Math.abs(inner.x-480)<=turn.span*.21+1e-8,'root stays bound to the thickness of the spine');
    assert.ok(dist(inner,outer)>turn.span*.39,'even halfway the packet does not collapse to a single leaf');
    const camera=Scene.fanFrame(normal,1-turn.t,side,top,base,290,V);
    const world=[a.s0,(a.s0+a.s1)/2,a.s1].flatMap(s=>[0,.18,.52,1].map(u=>turn.moving(s,u,372)));
    const rendered=world.map(p=>{const q=Scene.project(p);return {x:camera.x+camera.scale*q.x,y:camera.y+camera.scale*q.y};});
    if(prev){
      const step=rendered.map((p,j)=>({x:p.x-prev[j].x,y:p.y-prev[j].y}));
      for(const point of step)maxFrame=Math.max(maxFrame,dist(point,{x:0,y:0}));
      if(previousStep)step.forEach((p,j)=>{const delta=dist(p,previousStep[j]);maxAccel=Math.max(maxAccel,delta);assert.ok(delta<2.0,'a spatial step cannot spike relative to the preceding frame: '+delta);});
      if(i===1||i===steps)step.forEach(p=>assert.ok(dist(p,{x:0,y:0})<.03,'starts and ends at rest'));
      previousStep=step;
    }
    prev=rendered;
    const rewind=Packet.sample(from,to,progress,state);
    assert.deepEqual(rewind.moving(turn.s1,.72,555),turn.moving(turn.s1,.72,555),'reverse visits same geometry');
  }
  for(const s of [a.s0,(a.s0+a.s1)/2,a.s1])for(const u of [0,.25,.5,.85,1]){
    const y=342;
    assert.equal(dist(a.moving(s,u,y),K.pagePoint(a.source,s,u,y,from,0,state)),0,'first frame = original paper at same layer');
    assert.equal(dist(b.moving(s,u,y),K.pagePoint(b.destination,s,u,y,to,0,shape)),0,'last frame = destination paper at same layer');
  }
  const middle=Packet.sample(from,to,.5,state),front=middle.moving(middle.s0,.5,352);
  const p0=middle.moving(middle.s0,0,352),p1=middle.moving(middle.s0,1,352);
  assert.ok(dist(front,{x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2,z:(p0.z+p1.z)/2})>20,'packet bends between hinge and edge');
  packets++;
}
const last=mat(1244),full=mat(0),state={notches,fanRight:1};
function bandWidth(m){const a=K.pagePoint('right',m.leftDepth,1,355,m,0,state),b=K.pagePoint('right',36,1,355,m,0,state);return dist(a,b);}
assert.ok(bandWidth(last)<bandWidth(full)*.065,'last remaining recto cannot fan like a full stack');
console.log(JSON.stringify({outlineChecks,shadowed,visible,packets,maxFrame,maxAccel,maxLastSideWorldWidth:bandWidth(last),paperFaces:pages.length,slots:model.slots.length}));
