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
// Ink belongs to the original curved leaf while reading, and to that same
// leaf's rigid folded margin while inspecting. Neither basis may cross sheets.
let planarChecks=0,originalLeafChecks=0,transitionChecks=0,closedLabelChecks=0,cutContinuityChecks=0;
for(const n of notches){
  for(const close of [0,.5,.8,1])for(const split of [0,1216,1244]){
    const m=mat(split),p=K.prepare(m,close,{notches,fanLeft:1,fanRight:1,edgeInspection:true});
    const side=n.carrierDepth+1e-8<m.leftDepth?'left':'right',samples=[];
    const section={side,point:(s,u,y)=>{samples.push(s);return p.pagePoint(side,s,u,y);}};
    const inspection=K.inspectionAmount(close),frame=Depth.labelFrame(n,section,inspection);
    const o=frame.point(0,0),x=frame.point(1,0),y=frame.point(0,1);
    if(inspection===1){
      assert.ok(Math.abs(dist(o,x)-n.labelWidth)<1e-8,'inspection folds the leaf, never stretches ink width');
      assert.ok(Math.abs(dist(o,y)-n.labelHeight)<1e-8,'inspection preserves ink height');
    }
    for(const [u,v]of [[.2,.3],[.8,.9],[.5,.5],[1,1]]){
      const q=frame.point(u,v),base=section.point(n.carrierDepth,frame.rootU+u*frame.width/K.WIDTH,n.y+(v-.5)*frame.height);
      if(inspection===0){
        assert.ok(dist(q,base)<1e-8,'ordinary reading ink is exactly on the existing curved carrier, not a floating tangent plane');originalLeafChecks++;
      }else if(inspection===1){
        const expected={x:o.x+u*(x.x-o.x)+v*(y.x-o.x),y:o.y+u*(x.y-o.y)+v*(y.y-o.y),z:o.z+u*(x.z-o.z)+v*(y.z-o.z)};
        assert.ok(dist(q,expected)<1e-8,'closed inspection ink is one plane, never a paper-stack curve');planarChecks++;
      }else{
        const a=frame.matrix,rigid={x:a[12]+a[0]*frame.width*u+a[4]*frame.height*v,
          y:a[13]+a[1]*frame.width*u+a[5]*frame.height*v,z:a[14]+a[2]*frame.width*u+a[6]*frame.height*v};
        const expected=Object.fromEntries(['x','y','z'].map(k=>[k,base[k]+(rigid[k]-base[k])*inspection]));
        assert.ok(dist(q,expected)<1e-8,'folding continuously interpolates the same carrier and its ink');transitionChecks++;
      }
    }
    assert.ok(samples.length>0&&samples.every(s=>s===n.carrierDepth),'the label basis never crosses material sheets');
    const patch=Depth.carrierPatch(n,section,inspection,notches);
    for(const v of [patch.rows[0],patch.rows.at(-1)]){
      const b=patch.bounds(v);assert.ok(Math.abs(b.end-b.start)<1e-7,'carrier repair tapers to the true cut extremum, not a rectangular card');cutContinuityChecks++;
    }
    for(const v of [0,.25,.5,.75,1]){
      assert.ok(dist(patch.point(0,v),frame.basePoint(0,v))<1e-8,'fold root stays attached to the exact original page');
      if(inspection===1)for(const u of [.1,.5,.9])assert.ok(dist(patch.point(u,v),frame.point(u,v))<1e-8,'paper repair does not bend the closed glyph domain');
      cutContinuityChecks++;
    }
  }
  const a=K.prepare(mat(0),1,{notches,edgeInspection:true}),b=K.prepare(mat(1244),1,{notches,edgeInspection:true});
  const left=Depth.labelFrame(n,{side:'left',point:(s,u,y)=>b.pagePoint('left',s,u,y)},1);
  const right=Depth.labelFrame(n,{side:'right',point:(s,u,y)=>a.pagePoint('right',s,u,y)},1);
  for(const [u,v]of [[0,0],[1,0],[0,1],[1,1],[.5,.5]]){
    assert.ok(dist(left.point(u,v),right.point(u,v))<1e-8,'a closed label cannot move with reading split');closedLabelChecks++;
  }
}
// Real white paper lips still occlude the single-leaf patch perimeter. The
// label does not bypass the shared depth test or sit on a floating top layer.
let shadowed=0,visible=0;
for(const index of [8,13,25,37])for(const fanRight of [.42,.68,1]){
  const n=notches[index],local={notches:[n],fanRight},m=mat(0),p=K.prepare(m,0,local),tris=[];
  for(const band of Depth.topology(36,[n]))for(let j=0;j<band.ys.length-1;j++){
    const points=[[band.lo,band.ys[j]],[band.hi,band.ys[j]],[band.hi,band.ys[j+1]],[band.lo,band.ys[j+1]]]
      .map(([s,y])=>p.foreedgePoint('right',s,y));
    tris.push(...[[0,1,2],[0,2,3]].map(ids=>Depth.projectTriangle({points:ids.map(i=>points[i]),n:null})));
  }
  const patch=Depth.carrierPatch(n,{side:'right',lo:0,hi:36,point:(s,u,y)=>p.pagePoint('right',s,u,y)},0,[n]),leaf=[];
  for(const poly of patch.polygons)for(let j=1;j<poly.coords.length-1;j++){
    const coords=[poly.coords[0],poly.coords[j],poly.coords[j+1]];
    const tri=Depth.projectTriangle({points:coords.map(uv=>patch.point(...uv)),meta:poly.kind===5?coords:null,n:poly.kind===5?n:null});
    if(poly.kind===5)leaf.push(tri);tris.push(tri);
  }
  for(const tri of leaf)for(const weights of [[.05,.45,.5],[.2,.2,.6],[.35,.35,.3],[.65,.15,.2]]){
    const x=tri.p.reduce((a,p,i)=>a+p.x*weights[i],0),y=tri.p.reduce((a,p,i)=>a+p.y*weights[i],0);
    const hit=Depth.frontAt(tris,x,y);assert.ok(hit);
    if(hit.tri.n)visible++;else shadowed++;
  }
}
assert.ok(shadowed>0&&visible>0,'paper lips hide the patch perimeter without hiding the entire label');
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
console.log(JSON.stringify({outlineChecks,planarChecks,originalLeafChecks,transitionChecks,closedLabelChecks,cutContinuityChecks,shadowed,visible,packets,maxFrame,maxAccel,maxLastSideWorldWidth:bandWidth(last),paperFaces:pages.length,slots:model.slots.length}));
