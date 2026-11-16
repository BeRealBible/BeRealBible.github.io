/* Exercise the actual depth renderer's uploaded ink masks and CPU hit map.
 * The fake GL records data; it does not claim to rasterize text or replace UI QA. */
'use strict';
const assert=require('node:assert/strict');
const Depth=require('./book-depth.js'),K=require('./book-kinematics.js'),Solid=require('./book-solid.js');
const Material=require('./book-material.js'),Layout=require('./book-index-layout.js');
const Packet=require('./book-packet.js'),{createHash}=require('node:crypto');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model);
const byCode=new Map(books.map((b,i)=>[b.code,i])),rows=Math.ceil(notches.length/8);
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-6,m||`${a} != ${b}`);

function fixture(){
  let draws=[],buffer=null,id=0;
  const attributes={},shaders=[],uniforms={};
  const gl=new Proxy({
    getParameter(key){return key==='MAX_VIEWPORT_DIMS'?[4096,4096]:4096;},
    getExtension(){return {};},getShaderParameter(){return true;},getProgramParameter(){return true;},
    createShader(type){const shader={type};shaders.push(shader);return shader;},
    shaderSource(shader,source){shader.source=source;},
    createProgram(){return {};},createBuffer(){return {};},createTexture(){return {id:++id};},
    getAttribLocation(_program,name){return name;},
    vertexAttribPointer(name,size,_type,_normal,stride,offset){attributes[name]={size,stride:stride/4,offset:offset/4};},
    getUniformLocation(_program,name){return name;},
    uniform1f(name,value){uniforms[name]=value;},
    uniform4f(name,...value){uniforms[name]=value;},
    bufferData(_target,data){buffer=Float32Array.from(data);},
    drawArrays(_mode,_start,count){assert.equal(count,buffer.length/attributes.a_pos.stride);draws.push(buffer);},
    clear(){draws=[];}
  },{get(target,key){if(key in target)return target[key];return /^[A-Z_]+$/.test(key)?key:()=>{};}});
  const paint=new Proxy({createLinearGradient(){return {addColorStop(){}};},measureText(text){return {width:[...text].length*24};}},
    {get(target,key){return key in target?target[key]:()=>{};}});
  const doc={defaultView:{devicePixelRatio:1},createElement(){return {ownerDocument:doc,style:{},dataset:{},
    classList:{add(){}},addEventListener(){},setAttribute(){},getContext(type){return type==='webgl'?gl:paint;}};}};
  const host={ownerDocument:doc,dataset:{},classList:{add(){}},appendChild(){}};
  const renderer=Depth.create({host,model,notches,paintPage(){}});
  assert.ok(renderer,'real Depth.create must initialize under the GL recorder');
  assert.deepEqual(attributes.a_ink,{size:1,stride:12,offset:11});
  assert.ok(shaders.some(s=>/visibleInk=a_ink/.test(s.source)),'uploaded visibility must reach the vertex shader');
  const fragment=shaders.find(s=>s.type==='FRAGMENT_SHADER').source;
  assert.match(fragment,/shoulderAlpha=[^;]*visibleInk/);
  assert.match(fragment,/floorAlpha=[^;]*visibleInk/,'the inspected floor cannot bypass ownership');
  return {renderer,attributes,draws:()=>draws,uniforms};
}
const f=fixture(),stride=f.attributes.a_pos.stride;
function material(spread){return Material.compute(spread,pages.length,books);}
function draw(spread,side='left',close=0,pick=false){
  const m=material(spread),shape={notches,fanLeft:+(side==='left'),fanRight:+(side==='right'),edgeInspection:close>0};
  f.renderer.update({material:m,shape,close,pick,printed:[m.spread,m.spread+1]});
  const sections=[{side:'left',lo:0,hi:m.leftDepth},{side:'right',lo:m.leftDepth,hi:m.totalDepth}].filter(s=>s.hi>s.lo);
  return {m,shape,close,sections,edges:sections.map((section,i)=>({section,data:f.draws()[i]}))};
}
function inkTriangles(data){
  const out=[];
  for(let base=0;base<data.length;base+=stride*3){
    const mean=offset=>(data[base+offset]+data[base+stride+offset]+data[base+2*stride+offset])/3;
    const fu=mean(9)*8*128,fv=mean(10)*2*rows*152;
    const column=Math.floor(fu/128),row=Math.floor(fv/152)-rows,g=row*8+column;
    if(g<0||g>=notches.length)continue;
    const n=notches[g],v=(fv-(row+rows)*152-2)/148,printedRow=Depth.labelRow(n,v);
    const slot=model.slots[n.indices[printedRow]],mask=data[base+11],kind=data[base+8];
    for(let vertex=1;vertex<3;vertex++)near(data[base+vertex*stride+11],mask,'a triangle cannot blend two owners');
    for(let vertex=0;vertex<3;vertex++){
      const vv=(data[base+vertex*stride+10]*2*rows*152-(row+rows)*152-2)/148;
      assert.equal(Depth.labelRow(n,vv*.99+v*.01),printedRow,'one triangle spans names on opposite sides of a group boundary');
    }
    const point={x:mean(0),y:mean(1),z:mean(2)};
    out.push({slot,n,v,mask,kind,point,
      u:(mean(3)*8*128-column*128-2)/124,
      shoulderV:(mean(4)*2*rows*152-row*152-2)/148});
  }
  return out;
}
const ownershipStates=[...new Set([0,...books.map(b=>b.first&~1),pages.length-2])];
let masks=0;
for(const spread of ownershipStates){
  const state=draw(spread);
  for(const {section,data}of state.edges)for(const tri of inkTriangles(data)){
    const expected=(tri.slot.anchorDepth+1e-8<state.m.leftDepth?'left':'right')===section.side?1:0;
    assert.equal(tri.mask,expected,`${books[tri.slot.index].code} has ink on the wrong ${section.side} stack at ${spread}`);
    near(Depth.sectionInk(tri.slot,section,0),expected);
    masks++;
  }
}

// Exactly at an opening, the name belongs to the right stack. On the next
// sheet it belongs to the left. Never move the physical opening to its cut's
// broadened/clamped decorative centre.
let boundaryChecks=0;
for(const slot of model.slots){
  const split=slot.anchorDepth,left={lo:0,hi:split},right={lo:split,hi:model.totalDepth};
  assert.equal(Depth.sectionInk(slot,left,0),0);assert.equal(Depth.sectionInk(slot,right,0),1);
  assert.equal(Depth.sectionInk(slot,{lo:0,hi:split+model.totalDepth/model.totalSheets},0),1);
  for(const close of [0,.5,.7,.85,1]){
    assert.equal(Depth.sectionInk(slot,right,close),1);
    near(Depth.sectionInk(slot,left,close),K.inspectionAmount(close));
  }
  boundaryChecks++;
}

let closedHitChecks=0;
for(const spread of [0,books[byCode.get('2PE')].first&~1,books[byCode.get('2JN')].first&~1,pages.length-2]){
  const state=draw(spread,'right',1,true),found=new Set();
  for(const {data}of state.edges)for(const tri of inkTriangles(data)){
    assert.equal(tri.mask,1,'closed directory must retain the complete stamp at any split');
  }
  const prepared=K.prepare(state.m,1,state.shape);
  for(const slot of model.slots){
    const n=notches[slot.group],center=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
    const p=Solid.project(prepared.foreedgePoint('right',n.depth,n.y+n.radius*(2*center-1)));
    if(f.renderer.hit(p.x,p.y,0,'both')===slot.index){found.add(slot.index);closedHitChecks++;}
  }
  assert.equal(found.size,66,`closed split ${spread} lost individual book hits: ${books.filter((_,i)=>!found.has(i)).map(b=>b.code)}`);
}

// Include printed-leaf occlusion, not just isolated edge triangles. Sampling
// centres of actual uploaded triangles also catches CPU/GPU stride mismatch.
let hitChecks=0;
function checkFan(spread,side,codes){
  const state=draw(spread,side,0,true),edge=state.edges.find(e=>e.section.side===side);
  const tris=inkTriangles(edge.data),found=new Set();
  for(const tri of tris){
    const code=books[tri.slot.index].code;
    if(!codes.includes(code))continue;
    const active=tri.kind>.05&&(tri.kind<.15||tri.kind>.25&&tri.kind<.35);
    if(!active)continue;
    const center=.5+(tri.slot.groupRow-(tri.n.indices.length-1)/2)*.69/tri.n.indices.length;
    if(tri.u<.30||tri.u>.94||Math.abs(tri.shoulderV-center)>.22/tri.n.indices.length)continue;
    const p=Solid.project(tri.point);
    const hit=f.renderer.hit(p.x,p.y,0,side);
    if(tri.mask===0){
      assert.notEqual(hit,tri.slot.index,`${code} is still clickable on its wrong stack`);
      const nearHit=f.renderer.hit(p.x,p.y,6,side);
      if(nearHit!==null)assert.equal(model.slots[nearHit].anchorDepth+1e-8<state.m.leftDepth?'left':'right',side,
        'pointer slop cannot restore a masked wrong-side book');
      hitChecks++;
    }else if(hit===tri.slot.index){
      assert.equal(f.renderer.hit(p.x,p.y,6,side),tri.slot.index,'slop cannot redirect a direct correct hit');
      found.add(code);hitChecks++;
    }
  }
  return {state,found};
}
const pe2=books[byCode.get('2PE')].first&~1;
const future=['2PE','1JN','2JN','3JN','JUD','REV'];
const left=checkFan(pe2,'left',future);
assert.equal(left.found.size,0,'PE2 left stack cannot advertise its current/future openings');
const right=checkFan(pe2,'right',future);
for(const code of future)assert.ok(right.found.has(code),`PE2 right stack lost its visible/clickable ${code} label`);
for(const code of ['2PE','1JN','2JN','JUD','REV']){
  const split=books[byCode.get(code)].first&~1;
  const group=notches[model.slots[byCode.get(code)].group];
  for(const side of ['left','right']){
    const wanted=group.indices.filter(i=>(model.slots[i].anchorDepth+1e-8<material(split).leftDepth?'left':'right')===side)
      .map(i=>books[i].code);
    if(!wanted.length)continue;
    const result=checkFan(split,side,wanted);
    for(const name of wanted)assert.ok(result.found.has(name),`${code} split loses ${name} on ${side}`);
  }
}

// A broad stamp straddles the temporary moving/resting mesh split. Capturing
// the real upload at both ends catches a one-frame erase that pure stable
// ownership tests cannot see. The transition must retrace during cancellation.
function halfMasks(state){
  const result=new Map();
  for(const {section,data}of state.edges)for(const tri of inkTriangles(data)){
    const key=section.side+'|'+tri.slot.index;
    if(result.has(key))near(result.get(key),tri.mask,'one stable half has inconsistent masks for one name');
    result.set(key,tri.mask);
  }
  return result;
}
function drawPacket(from,to,progress,shape){
  const packet=Packet.sample(from,to,progress,shape);
  f.renderer.update({material:from,shape,close:0,pick:false,packet,
    printed:[from.spread,from.spread+1,to.spread,to.spread+1]});
  let sections=packet.sections;
  if(progress===0||progress===1){
    const split=progress===0?from.leftDepth:to.leftDepth;
    sections=[{side:'left',lo:0,hi:split},{side:'right',lo:split,hi:from.totalDepth}];
  }
  sections=sections.filter(s=>s.hi-s.lo>1e-8);
  const edges=sections.map((section,i)=>({section,data:f.draws()[i]}));
  const hash=createHash('sha256');
  for(const data of f.draws())hash.update(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  return {packet,edges,digest:hash.digest('hex')};
}
const rev=books[byCode.get('REV')].first&~1;
const paths=[[pe2,rev],[rev,pe2],[0,rev],[rev,0],[0,books[byCode.get('ISA')].first&~1],
  [pages.length-2,books[byCode.get('MAT')].first&~1]];
const epsilon=1e-4,phases=[0,epsilon,.1,.25,.5,.75,.9,1-epsilon,1];
let packetMaskChecks=0,endpointChecks=0,reverseFrameChecks=0,maxEndpointChange=0;
for(const [start,end]of paths){
  const from=material(start),to=material(end),source=end>start?'right':'left';
  const shape={notches,fanLeft:+(source==='left'),fanRight:+(source==='right')};
  const before=halfMasks(draw(start,source)),after=halfMasks(draw(end,'none'));
  const forward=new Map();
  for(const progress of phases){
    const state=drawPacket(from,to,progress,shape),{packet}=state;
    forward.set(progress,state.digest);
    for(const {section,data}of state.edges)for(const tri of inkTriangles(data)){
      const fromKey=section.side+'|'+tri.slot.index;
      const toKey=(section.moving?packet.destination:section.side)+'|'+tri.slot.index;
      let expected;
      if(progress===0){assert.ok(before.has(fromKey));expected=before.get(fromKey);}
      else if(progress===1){assert.ok(after.has(toKey));expected=after.get(toKey);}
      else{
        assert.ok(before.has(fromKey)&&after.has(toKey),'moving cut must exist on its source and destination paper');
        expected=before.get(fromKey)*(1-packet.t)+after.get(toKey)*packet.t;
      }
      near(tri.mask,expected,`${start}->${end} at ${progress}: ${books[tri.slot.index].code} jumps at a packet partition`);
      if(progress===epsilon||progress===1-epsilon){
        const reference=progress===epsilon?before.get(fromKey):after.get(toKey);
        const delta=Math.abs(tri.mask-reference);
        assert.ok(delta<1e-6,`instant ink loss at ${start}->${end} endpoint: ${delta}`);
        maxEndpointChange=Math.max(maxEndpointChange,delta);endpointChecks++;
      }
      packetMaskChecks++;
    }
  }
  // Revisit the same progress values in descending order: this is the same
  // path a cancelled turn follows, not a fresh turn with swapped endpoints.
  for(const progress of phases.slice().reverse()){
    const state=drawPacket(from,to,progress,shape);
    assert.equal(state.digest,forward.get(progress),`${start}->${end} rewind at ${progress} changes uploaded paper/ink`);
    reverseFrameChecks++;
  }
}
console.log(JSON.stringify({ownershipStates:ownershipStates.length,uploadedMaskChecks:masks,boundaryChecks,hitChecks,closedHitChecks,
  pe2RightVisible:[...right.found],printedFacesIncluded:true,packetPaths:paths.length,packetMaskChecks,endpointChecks,
  maxEndpointChange,reverseFrameChecks}));
