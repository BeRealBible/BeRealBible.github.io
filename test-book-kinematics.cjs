/* Physical continuity, rather than an opacity/scale imitation of closure. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const K=require('./book-kinematics.js'),M=require('./book-material.js'),Packet=require('./book-packet.js');
let checks=0;
const check=(v,message)=>{assert.ok(v,message);checks++;};
const near=(a,b,message,epsilon=1e-8)=>check(Math.abs(a-b)<=epsilon,`${message}: ${a} != ${b}`);
function pointNear(a,b,message,epsilon=1e-8){for(const axis of ['x','y','z'])near(a[axis],b[axis],message+' '+axis,epsilon);}
const materials=[0,2,304,626,920,1174,1232,1252].map(s=>M.compute(s,1254));

// The whole physical object, not merely its active paper face, is invariant
// when the closed split is changed from Genesis to Jude or any other leaf.
for(let i=0;i<=72;i++)for(const u of [0,.13,.5,.87,1])for(const y of [0,352,704]){
  const s=36*i/72,expected={x:480+s-18,y,z:480*u};
  for(const material of materials){
    const side=s<material.leftDepth?'left':'right';
    pointNear(K.pagePoint(side,s,u,y,material,1),expected,'closed absolute sheet position');
    if(u===1)pointNear(K.foreedgePoint(side,s,y,material,1),expected,'closed fore-edge position');
  }
}
for(const material of materials){
  const open=K.frame(material,0),closed=K.frame(material,1);
  near(open.hingeX,480,'open split is at the reading spine');
  near(closed.hingeX,480+material.leftDepth-18,'selected layer is the closed opening seam');
  near(closed.cosine,0,'complete closure reaches exact 90 degrees');near(closed.sine,1,'complete closure reaches exact sine');
  near(closed.A,1,'closed depth is not enlarged');near(closed.B,0,'closed leaves have no foot shear');near(closed.C,0,'closed fore-edge is flush');
  pointNear(K.foreedgePoint('left',0,0,material,1),{x:462,y:0,z:480},'closed first leaf');
  pointNear(K.foreedgePoint('right',36,704,material,1),{x:498,y:704,z:480},'closed final leaf');
  for(const side of ['left','right'])for(const close of [0,.001,.2,.5,.85,.999,1]){
    const interval=K.layerInterval(side,material),top=K.topMatrixValues(side,material,close),edge=K.foreedgeMatrixValues(side,material,close);
    check(top.length===16&&edge.length===16,'CSS matrices are 4x4');
    check(top.every(Number.isFinite)&&edge.every(Number.isFinite),'all matrix entries are finite');
    check(/^matrix3d\([-\d.,]+\)$/.test(K.topMatrix(side,material,close)),'top CSS serialisation');
    check(/^matrix3d\([-\d.,]+\)$/.test(K.foreedgeMatrix(side,material,close)),'edge CSS serialisation');
    for(const x of [0,240,480])for(const y of [0,704]){
      const u=side==='left'?1-x/480:x/480;
      if(close===0||close===1)pointNear(K.transformPoint(top,x,y),K.pagePoint(side,material.leftDepth,u,y,material,close),'rigid endpoints and paper model coincide');
    }
    // This legacy affine matrix is only an envelope. The natural shoulder
    // and fan are non-affine in depth; visible paper samples pagePoint.
    // At full closure the real edge becomes affine and must coincide exactly.
    if(close===1)for(const s of [interval[0],(interval[0]+interval[1])/2,interval[1]])for(const y of [0,352,704])
      pointNear(K.transformPoint(edge,s,y),K.foreedgePoint(side,s,y,material,close),'closed envelope and absolute sheet model coincide');
    const mesh=K.bottomMesh(side,material,close,24);
    if(interval[0]===interval[1])check(mesh.length===0,'zero paper depth has no foot face');
    else{
      check(mesh.length===24,'foot uses a deterministic mesh');
      for(let i=0;i<mesh.length;i++){
        const strip=mesh[i];
        check(strip.vertices.every(p=>Object.values(p).every(Number.isFinite)),'foot vertices finite');
        if(i){pointNear(strip.vertices[0],mesh[i-1].vertices[1],'adjacent foot first boundary');pointNear(strip.vertices[3],mesh[i-1].vertices[2],'adjacent foot second boundary');}
        for(const triangle of strip.triangles){
          const m=K.triangleMatrixValues(...triangle);
          pointNear(K.transformPoint(m,0,0),triangle[0],'triangle origin');
          pointNear(K.transformPoint(m,1,0),triangle[1],'triangle x');
          pointNear(K.transformPoint(m,0,1),triangle[2],'triangle y');
        }
      }
      pointNear(mesh.at(-1).vertices[1],K.foreedgePoint(side,interval[0],704,material,close),'foot joins fore-edge first corner');
      pointNear(mesh.at(-1).vertices[2],K.foreedgePoint(side,interval[1],704,material,close),'foot joins fore-edge second corner');
    }
  }
}

// Natural opening exposes the actual paper margins on both sides without
// moving, scaling, or bowing the split text sheet. The maximum shoulder is
// reached at the base; the camera can safely frame those two physical edges.
let naturalChecks=0;
check(K.NATURAL_SHOULDER===82,'natural shoulder has an explicit world-space design width');
for(const material of materials)for(const side of ['left','right']){
  const direction=side==='left'?-1:1;
  const amount=side==='left'?material.leftDepth:material.rightDepth;
  const outer=side==='left'?0:material.totalDepth;
  for(const u of [0,.25,.5,.72,.85,1])for(const y of [0,352,704]){
    pointNear(K.pagePoint(side,material.leftDepth,u,y,material,0),
      {x:K.WIDTH+direction*K.WIDTH*u,y,z:0},'natural split text stays exactly flat');
    naturalChecks++;
  }
  for(const u of [.73,.85,1]){
    let lastX=-1e-9,lastZ=1e-9;
    for(let i=0;i<=1000;i++){
      const d=amount*i/1000,s=material.leftDepth+direction*d;
      const p=K.pagePoint(side,s,u,352,material,0);
      const outward=direction*(p.x-(K.WIDTH+direction*K.WIDTH*u));
      check(outward>=lastX-1e-9,'natural shoulder is monotone outward toward base');
      check(p.z<=lastZ+1e-9,'deeper natural sheets cannot cross shallower paper');
      check(p.z<=1e-9,'natural shoulder cannot pierce the reading text sheet');
      lastX=outward;lastZ=p.z;naturalChecks++;
    }
  }
  const base=K.pagePoint(side,outer,1,352,material,0);
  const capacity=Math.min(1,amount/(material.totalDepth*.16));
  near(direction*(base.x-(K.WIDTH+direction*K.WIDTH)),
    .55*amount+K.NATURAL_SHOULDER*capacity,'base shoulder is the measured outer envelope');
  near(base.z,-amount,'natural base retains physical paper depth');
  for(const fan of [0,.25,.7,1])pointNear(K.pagePoint(side,outer,1,352,material,0,{fanLeft:fan,fanRight:fan}),
    base,'fan keeps the bottom of the natural shoulder fixed');
}
// Tiny tails stay tiny: shoulder width is linear in physical paper amount,
// not a constant open-book band applied even to one remaining sheet.
for(const total of [.1,1,36,72])for(const fraction of [0,.001,.01,.04,.08,.16,.5,1]){
  const amount=total*fraction;
  for(const side of ['left','right']){
    const material={totalDepth:total,leftDepth:side==='left'?amount:total-amount};
    const outer=side==='left'?0:total,direction=side==='left'?-1:1;
    const p=K.pagePoint(side,outer,1,352,material,0);
    const shoulder=direction*(p.x-(K.WIDTH+direction*K.WIDTH))-.55*amount;
    near(shoulder,K.NATURAL_SHOULDER*Math.min(1,fraction/.16),'thin natural shoulder uses linear capacity');
    naturalChecks++;
  }
}
// A packet uses this same baseline at both ends. Changing spread must not
// replace the natural stack with the former flat stack at the last frame.
for(const [a,b]of [[materials[1],materials[4]],[materials[6],materials[2]]]){
  const shape={fanLeft:.6,fanRight:.4,notches:[]};
  for(const progress of [0,1]){
    const packet=Packet.sample(a,b,progress,shape),target=progress?b:a,state=progress?{notches:[]}:shape;
    for(const side of ['left','right'])for(const s of [0,9,18,27,36])for(const u of [0,.5,.72,.9,1]){
      pointNear(packet.resting(side,s,u,352),K.pagePoint(side,s,u,352,target,0,state),'natural packet resting endpoint');
      naturalChecks++;
    }
    for(const s of [packet.sections[2].lo,packet.sections[2].hi])for(const u of [.5,.85,1]){
      const side=progress?packet.destination:packet.source;
      pointNear(packet.moving(s,u,352),K.pagePoint(side,s,u,352,target,0,state),'natural packet moving endpoint');
      naturalChecks++;
    }
  }
}

// Fine sampling detects geometry jumps, mirrored vertices and nondeterministic
// return paths. No renderer may skip the intervening world-space positions.
let largestStep=0;
for(const material of materials)for(const side of ['left','right']){
  const interval=K.layerInterval(side,material),s=(interval[0]+interval[1])/2;
  let previous=K.foreedgePoint(side,s,352,material,0);
  for(let i=0;i<=2000;i++){
    const close=i/2000,p=K.foreedgePoint(side,s,352,material,close);
    check(Object.values(p).every(Number.isFinite),'continuous point is finite');
    const delta=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);largestStep=Math.max(largestStep,delta);
    check(delta<.5,'fore-edge trajectory has no frame discontinuity');
    pointNear(p,K.foreedgePoint(side,s,352,material,1-(1-close)),'closing and reverse opening share the same path');
    previous=p;
  }
}

// No hidden special case at the last fraction of closure: the derivative
// approaches the endpoint from the same physical equation.
for(const material of materials)for(const side of ['left','right']){
  const interval=K.layerInterval(side,material),s=(interval[0]+interval[1])/2;
  const a=K.foreedgePoint(side,s,352,material,1-2e-6),b=K.foreedgePoint(side,s,352,material,1-1e-6),c=K.foreedgePoint(side,s,352,material,1);
  for(const axis of ['x','y','z'])near((c[axis]-b[axis])/1e-6,(b[axis]-a[axis])/1e-6,'endpoint derivative '+axis,.003);
}

// Every curved text strip joins the same material surface at both boundaries.
const notches=[{depth:4,y:34,radius:13,span:1.8},{depth:18,y:344,radius:13,span:1.2},{depth:35,y:644,radius:13,span:1.2}];
for(const material of materials)for(const side of ['left','right'])for(const close of [0,.2,.5,.8,1])for(const amount of [0,.3,1]){
  const state={fanLeft:amount,fanRight:amount,notches};
  for(let i=0;i<24;i++){
    const u0=i/24,u1=(i+1)/24,m=K.surfaceStripMatrixValues(side,material.leftDepth,u0,u1,material,close,state);
    check(m.every(Number.isFinite),'curved strip matrix finite');
    pointNear(K.transformPoint(m,0,0),K.pagePoint(side,material.leftDepth,u0,0,material,close,state),'strip origin on curved page');
    pointNear(K.transformPoint(m,20,704),K.pagePoint(side,material.leftDepth,u1,704,material,close,state),'strip endpoint on curved page');
  }
  for(const n of notches)for(const depth of [n.depth-n.span,n.depth,n.depth+n.span]){
    const inset=K.edgeInset(side,depth,n.y,material,state);
    check(inset>=0&&inset<=26,'milled inset remains bounded');
    pointNear(K.foreedgePoint(side,depth,n.y,material,close,state),K.pagePoint(side,depth,1-inset/480,n.y,material,close,state),'milled edge shares the cut paper boundary');
  }
}
for(const material of materials){
  for(const side of ['left','right']){
    if((side==='left'?material.leftDepth:material.rightDepth)<1e-8)continue;
    const depth=material.leftDepth,outer=side==='left'?0:36,state={fanLeft:1,fanRight:1};
    const a=K.pagePoint(side,depth,1,0,material,0),b=K.pagePoint(side,depth,1,0,material,0,state);
    const amount=side==='left'?material.leftDepth:material.rightDepth;
    near(Math.abs(a.x-b.x),K.FAN_SWEEP*K.fanCapacity(amount,36),'top leaf motion is proportionate to the side’s remaining paper');
    pointNear(K.pagePoint(side,outer,1,0,material,0),K.pagePoint(side,outer,1,0,material,0,state),'bottom leaf stays put while upper sheets fan');
    const middle=K.pagePoint(side,depth,.5,0,material,.5),p0=K.pagePoint(side,depth,0,0,material,.5),p1=K.pagePoint(side,depth,1,0,material,.5);
    check(Math.hypot(middle.x-(p0.x+p1.x)/2,middle.z-(p0.z+p1.z)/2)>50,'closing page is visibly bowed, not a rigid board');
  }
}
// A thin tail cannot fan as if it contained a thick stack. A sublinear power
// (for example ratio^.57) magnifies a few sheets into an artificial white tooth.
let thinTailChecks=0,max32SheetPull=0;
for(const total of [.1,1,36,72]){
  let previous=0;
  for(let i=0;i<=160;i++){
    const amount=total*i/160,capacity=K.fanCapacity(amount,total),linear=Math.min(1,amount/(total*.48));
    check(Number.isFinite(capacity)&&capacity>=0&&capacity<=1,'capacity stays within physical bounds');
    check(capacity<=linear+1e-12,'thin paper capacity cannot exceed a linear share');
    check(capacity>=previous,'more paper cannot reduce fan capacity');previous=capacity;thinTailChecks++;
  }
  near(K.fanCapacity(0,total),0,'empty side cannot fan');
}
near(K.fanCapacity(1,0),0,'zero total paper cannot fan');
for(const count of [1,2,5,15,32])for(const side of ['left','right']){
  const totalSheets=627,spread=side==='left'?count*2:(totalSheets-count)*2;
  const material=M.compute(spread,totalSheets*2),amount=side==='left'?material.leftDepth:material.rightDepth;
  const linear=Math.min(1,amount/(material.totalDepth*.48));
  const state={fanLeft:1,fanRight:1},depth=material.leftDepth,outer=side==='left'?0:material.totalDepth;
  const flat=K.pagePoint(side,depth,1,352,material,0),fan=K.pagePoint(side,depth,1,352,material,0,state);
  const pull=Math.abs(fan.x-flat.x),lift=Math.abs(fan.z-flat.z);
  check(pull<=K.FAN_SWEEP*linear+1e-8,`${count}-sheet ${side} tail does not overdraw inward`);
  check(lift<=62*linear+1e-8,`${count}-sheet ${side} tail does not over-lift`);
  pointNear(K.pagePoint(side,outer,1,352,material,0,state),K.pagePoint(side,outer,1,352,material,0),
    'thin stack stays joined to its unmoving bottom leaf');
  if(count===32)max32SheetPull=Math.max(max32SheetPull,pull);
  thinTailChecks++;
}
// Prepared evaluators must be an exact optimisation, not another geometry.
for(const material of materials)for(const close of [0,.2,.5,.8,1]){
  const state={fanLeft:.72,fanRight:.41,notches},prepared=K.prepare(material,close,state);
  for(const side of ['left','right'])for(const depth of [0,4,17,18,35,36])for(const y of [0,21,28,34,39,344,644,704]){
    assert.deepEqual(prepared.foreedgePoint(side,depth,y),K.foreedgePoint(side,depth,y,material,close,state));checks++;
    near(prepared.edgeInset(side,depth,y),K.edgeInset(side,depth,y,material,state),'prepared cut matches original',0);
    for(const u of [0,.25,.5,.75,1]){assert.deepEqual(prepared.pagePoint(side,depth,u,y),K.pagePoint(side,depth,u,y,material,close,state));checks++;}
  }
}
for(const n of notches)for(const s of [n.depth-.3,n.depth,n.depth+.3]){
  let first;
  for(const material of materials){
    const side=s<material.leftDepth?'left':'right',p=K.foreedgePoint(side,s,n.y,material,1,{fanLeft:1,fanRight:1,notches});
    if(first)pointNear(p,first,'closed recess stays fixed across distant split changes');first=p;
  }
}

check(K.frame({leftDepth:Infinity,rightDepth:NaN},NaN).close===0,'bad time degrades to the open endpoint');
check(K.frame({totalDepth:0,leftDepth:4},2).totalDepth===0,'explicit zero paper remains zero');
assert.throws(()=>K.topMatrix('front',materials[0],0),TypeError);checks++;
assert.throws(()=>K.matrixCSS([1,2]),TypeError);checks++;
const browser={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/book-kinematics.js','utf8'),browser);
for(const side of ['left','right'])near(browser.window.PaperBookKinematics.foreedgePoint(side,12,140,materials[3],.46).x,K.foreedgePoint(side,12,140,materials[3],.46).x,'browser and Node exports agree');
console.log(JSON.stringify({bookKinematicsChecks:checks,naturalChecks,largestStep,thinTailChecks,max32SheetPull,closedDepth:36,closedSplitInvariant:true,closureDegrees:90,geometry:'bilateral natural paper shoulders, curved depth-dependent leaves, inward fanning, absolute milled recesses'}));
