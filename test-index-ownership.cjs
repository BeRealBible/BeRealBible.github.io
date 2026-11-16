/* Record the real renderer uploads and exercise its CPU occlusion map.
 * Mock GL is not a rasterizer: browser visual acceptance is still required. */
'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Depth=require('./book-depth.js'),K=require('./book-kinematics.js'),Solid=require('./book-solid.js');
const Material=require('./book-material.js'),Layout=require('./book-index-layout.js'),Packet=require('./book-packet.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model),rows=Math.ceil(notches.length/8);
const byCode=new Map(books.map((b,i)=>[b.code,i])),material=spread=>Material.compute(spread,pages.length,books);
const near=(a,b,m,eps=8e-5)=>assert.ok(Math.abs(a-b)<eps,m||`${a} != ${b}`);
function fixture(){
  let draws=[],buffer,id=0;
  const attributes={},shaders=[],uniforms={},enabled=[];
  const gl=new Proxy({
    getParameter(key){return key==='MAX_VIEWPORT_DIMS'?[4096,4096]:4096;},
    getExtension(){return {};},getShaderParameter(){return true;},getProgramParameter(){return true;},
    createShader(type){const shader={type};shaders.push(shader);return shader;},shaderSource(s,source){s.source=source;},
    createProgram(){return {};},createBuffer(){return {};},createTexture(){return {id:++id};},
    getAttribLocation(_p,name){return name;},vertexAttribPointer(name,size,_type,_normal,stride,offset){attributes[name]={size,stride:stride/4,offset:offset/4};},
    getUniformLocation(_p,name){return name;},uniform1f(name,v){uniforms[name]=v;},uniform4f(name,...v){uniforms[name]=v;},
    bufferData(_t,data){buffer=Float32Array.from(data);},drawArrays(_m,_s,count){assert.equal(count,buffer.length/attributes.a_pos.stride);draws.push(buffer);},
    clear(){draws=[];},enable(cap){enabled.push(cap);}
  },{get(t,k){return k in t?t[k]:/^[A-Z_]+$/.test(k)?k:()=>{};}});
  const paint=new Proxy({createLinearGradient(){return {addColorStop(){}};},measureText(text){return {width:[...text].length*24};}},
    {get(t,k){return k in t?t[k]:()=>{};}});
  const doc={defaultView:{devicePixelRatio:1},createElement(){return {ownerDocument:doc,style:{},dataset:{},classList:{add(){}},
    addEventListener(){},setAttribute(){},getContext(type){return type==='webgl'?gl:paint;}};}};
  const host={ownerDocument:doc,dataset:{},classList:{add(){}},appendChild(){}};
  const renderer=Depth.create({host,model,notches,paintPage(){}});
  assert.ok(renderer);assert.ok(enabled.includes('DEPTH_TEST'),'labels and paper share real depth testing');
  const fragment=shaders.find(s=>s.type==='FRAGMENT_SHADER').source;
  assert.ok(fragment.indexOf('paper.w>4.5')<fragment.indexOf('paper.w>2.5'),'single-leaf print uses its own material');
  assert.doesNotMatch(fragment,/shoulderAlpha|floorAlpha/,'no text can remain on a cross-sheet shoulder or floor');
  assert.match(fragment,/gl_FrontFacing\?floorUV:uv/,'one leaf reads correctly on each face, without duplicating a label');
  return {renderer,attributes,draws:()=>draws,uniforms};
}
const f=fixture(),stride=f.attributes.a_pos.stride,T=model.totalDepth;
function stableSections(m,shape,close){
  const p=K.prepare(m,close,shape);
  return ['left','right'].map(side=>({side,lo:side==='left'?0:m.leftDepth,hi:side==='left'?m.leftDepth:T,
    point:(s,u,y)=>p.pagePoint(side,s,u,y)}));
}
function draw(spread,side='left',close=0,pick=false){
  const m=material(spread),shape={notches,fanLeft:+(side==='left'),fanRight:+(side==='right'),edgeInspection:close>0};
  f.renderer.update({material:m,shape,close,pick,printed:close<1?[m.spread,m.spread+1]:null});
  return {m,shape,close,sections:stableSections(m,shape,close),draws:f.draws()};
}
function decode(data,base){
  const mean=off=>(data[base+off]+data[base+stride+off]+data[base+2*stride+off])/3;
  const col=Math.floor(mean(3)*8),row=Math.floor(mean(4)*2*rows),group=row*8+col;
  assert.ok(group>=0&&group<notches.length,'only first atlas bank holds leaf labels');
  const local=[];
  for(let j=0;j<3;j++)local.push([(data[base+j*stride+3]*8*128-col*128-2)/124,
    (data[base+j*stride+4]*2*rows*152-row*152-2)/148]);
  return {n:notches[group],local,points:[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}))};
}
let carrierVertexChecks=0,plainEdgeChecks=0,neckVertexChecks=0,sharedEdgeChecks=0;
const referenceCounts=new Map();
function checkUpload(state){
  const counts=new Map(),unique=new Map(),neckEdges=new Map(),labelEdges=[];
  const edgeKey=(a,b)=>[a,b].map(p=>[p.x,p.y,p.z].join(',')).sort().join('|');
  for(const data of state.draws)for(let base=0;base<data.length;base+=stride*3){
    const kind=data[base+8];
    if(kind===0){
      for(let j=0;j<3;j++){
        near(data[base+j*stride+3],.0001);near(data[base+j*stride+4],.0001);
        near(data[base+j*stride+9],.0001);near(data[base+j*stride+10],.0001);
        assert.equal(data[base+j*stride+11],0,'paper fibres never carry ink');
      }
      plainEdgeChecks++;continue;
    }
    if(kind===6){
      const c=data[base+5]*T,n=notches.find(n=>Math.abs(n.carrierDepth-c)<8e-5);
      assert.ok(n,'unprinted neck belongs to an actual label carrier');
      if(!neckEdges.has(n.group))neckEdges.set(n.group,new Set());
      const vertices=[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}));
      for(const [a,b]of [[0,1],[1,2],[2,0]])neckEdges.get(n.group).add(edgeKey(vertices[a],vertices[b]));
      for(let j=0;j<3;j++){
        near(data[base+j*stride+5]*T,n.carrierDepth,'neck cannot connect unrelated sheets');
        near(data[base+j*stride+3],.0001);near(data[base+j*stride+4],.0001);
        assert.equal(data[base+j*stride+11],0,'only the planar printed patch carries ink');neckVertexChecks++;
      }
      continue;
    }
    if(kind!==5)continue;
    const {n,local,points}=decode(data,base),section=Depth.labelSection(n,state.sections);
    const onNeckEdge=([u,v])=>v>=.3-1e-6&&v<=.7+1e-6&&Math.abs(u-(.5-.5*Math.sqrt(Math.max(0,1-(2*v-1)**2))))<1e-5;
    for(const [a,b]of [[0,1],[1,2],[2,0]])if(onNeckEdge(local[a])&&onNeckEdge(local[b])&&Math.abs(local[a][1]-local[b][1])>1e-6)
      labelEdges.push({group:n.group,key:edgeKey(points[a],points[b])});
    assert.ok(section,'carrier must be owned by one material section');
    assert.equal(state.sections.filter(s=>n.carrierDepth+1e-8>=s.lo&&n.carrierDepth+1e-8<s.hi).length,1);
    const frame=Depth.labelFrame(n,section,state.close?K.inspectionAmount(state.close):0);
    counts.set(n.group,(counts.get(n.group)||0)+1);
    if(!unique.has(n.group))unique.set(n.group,new Set());
    const key=local.map(p=>p.map(v=>v.toFixed(5)).join(',')).join('|');
    assert.ok(!unique.get(n.group).has(key),'the same carrier triangle cannot be copied to another side');unique.get(n.group).add(key);
    for(let j=0;j<3;j++){
      near(data[base+j*stride+5]*T,n.carrierDepth,'every ink vertex has one immutable material s');
      assert.equal(data[base+j*stride+11],1,'paper cannot move by an alpha ownership handoff');
      const col=n.group%8,row=Math.floor(n.group/8);
      const backU=(data[base+j*stride+9]*8*128-col*128-2)/124;
      const backV=(data[base+j*stride+10]*2*rows*152-row*152-2)/148;
      near(backU+local[j][0],1,'back face mirrors UV, not material depth');near(backV,local[j][1]);
      const p=frame.point(...local[j]);
      near(points[j].x,p.x,'UV u must run on the carrier leaf, not across stack depth',.0005);
      near(points[j].y,p.y,undefined,.0005);near(points[j].z,p.z,undefined,.0005);
      carrierVertexChecks++;
    }
  }
  assert.equal(counts.size,39,'39 whole leaf labels, neither dropped nor split into row owners');
  assert.equal(new Set(labelEdges.map(e=>e.group)).size,39,'every printed leaf must join its unprinted neck');
  for(const edge of labelEdges){
    assert.ok(neckEdges.get(edge.group)?.has(edge.key),'neck and ellipse must share the identical uploaded edge, without T-junctions or cracks');sharedEdgeChecks++;
  }
  for(const [group,count]of counts){
    if(!referenceCounts.has(group))referenceCounts.set(group,count);
    assert.equal(count,referenceCounts.get(group),'one label keeps complete geometry in any split/packet');
  }
}
const ownershipStates=[...new Set([0,...books.map(b=>b.first&~1),pages.length-2])];
for(const spread of ownershipStates)checkUpload(draw(spread));
for(const n of notches){
  near(n.carrierDepth,model.slots[model.groups[n.group].first].anchorDepth);
  assert.equal(n.carrierSheet,model.slots[model.groups[n.group].first].sheet);
  for(const split of [n.carrierDepth,n.carrierDepth+T/model.totalSheets]){
    const sections=[{side:'left',lo:0,hi:split},{side:'right',lo:split,hi:T}];
    assert.equal(Depth.labelSection(n,sections).side,split===n.carrierDepth?'right':'left');
  }
}
let hitChecks=0,blockedSamples=0,closedHitChecks=0,closedInkChecks=0;
function centre(slot,u=.5){
  const n=notches[slot.group],frame=f.renderer.getLabelFrame(slot.index);
  const v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
  return {...Solid.project(frame.point(u,v)),side:frame.side};
}
function checkHits(spread,side,close,codes){
  const state=draw(spread,side,close,true),found=new Set();
  for(const slot of model.slots){
    const p=centre(slot),onSide=close===1?'both':p.side;
    for(const u of [.35,.5,.65]){
      const q=centre(slot,u),hit=f.renderer.hit(q.x,q.y,0,onSide);
      if(hit===slot.index){found.add(books[slot.index].code);hitChecks++;}
      else blockedSamples++;
      if(close<1)assert.notEqual(f.renderer.hit(q.x,q.y,0,p.side==='left'?'right':'left'),slot.index,'wrong-side filter cannot revive a label');
    }
  }
  for(const code of codes)assert.ok(found.has(code),`${spread}/${side}/close=${close} loses readable clickable ${code}`);
  if(close===1){
    closedHitChecks+=found.size;
    for(const slot of model.slots){
      const n=notches[slot.group],frame=f.renderer.getLabelFrame(slot.index),glyph=Depth.labelGlyph(n,slot.label);
      const v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
      for(const [dx,dy]of [[0,0],[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0]]){
        const q=Solid.project(frame.point(.5+dx*glyph.width/2,v+dy*glyph.height/2));
        assert.equal(f.renderer.hit(q.x,q.y,0,'both'),slot.index,
          `${spread}: ${slot.label} ink at ${dx},${dy} is covered by neighbouring paper`);
        closedInkChecks++;
      }
    }
  }
  return {state,found};
}
const pe2=books[byCode.get('2PE')].first&~1,rev=books[byCode.get('REV')].first&~1;
checkHits(pe2,'left',0,['1PE','2PE']);
checkHits(pe2,'right',0,['1JN','2JN','3JN','JUD','REV']);
// In 2 Peter the Revelation carrier is still right. A grouped later target
// can be printed on a left carrier: that is NOT permission to split its ink.
let state=draw(pe2,'left',0,true);
assert.equal(f.renderer.getLabelFrame(byCode.get('REV')).side,'right');
assert.equal(f.renderer.getLabelFrame(byCode.get('2PE')).side,'left');
state=draw(books[byCode.get('2JN')].first&~1,'left',0,true);
for(const code of ['1JN','2JN','3JN','JUD'])assert.equal(f.renderer.getLabelFrame(byCode.get(code)).side,'left');
checkHits(books[byCode.get('2JN')].first&~1,'left',0,['1JN','2JN','3JN','JUD']);
for(const spread of [0,pe2,books[byCode.get('2JN')].first&~1,pages.length-2])
  checkHits(spread,'right',1,books.map(b=>b.code));
function drawPacket(from,to,progress,shape){
  const packet=Packet.sample(from,to,progress,shape);
  f.renderer.update({material:from,shape,close:0,pick:false,packet,printed:[from.spread,from.spread+1,to.spread,to.spread+1]});
  let sections=packet.sections;
  if(progress===0||progress===1){
    const split=progress===0?packet.s0:packet.s1;
    sections=['left','right'].map(side=>({side,lo:side==='left'?0:split,hi:side==='left'?split:T,
      point:(s,u,y)=>packet.resting(side,s,u,y)}));
  }
  const hash=createHash('sha256');for(const data of f.draws())hash.update(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  return {packet,sections,close:0,draws:f.draws(),digest:hash.digest('hex')};
}
const paths=[[pe2,rev],[rev,pe2],[0,rev],[rev,0],[0,books[byCode.get('ISA')].first&~1],[pages.length-2,books[byCode.get('MAT')].first&~1]];
const phases=[0,1e-4,.1,.25,.5,.75,.9,1-1e-4,1];
let reverseFrameChecks=0,endpointChecks=0;
for(const [start,end]of paths){
  const from=material(start),to=material(end),source=end>start?'right':'left';
  const shape={notches,fanLeft:+(source==='left'),fanRight:+(source==='right')},forward=new Map();
  for(const progress of phases){const s=drawPacket(from,to,progress,shape);checkUpload(s);forward.set(progress,s.digest);}
  for(const p of [0,1]){
    const turn=drawPacket(from,to,p,shape),stable=draw(p===0?start:end,p===0?source:'none');
    for(const n of notches){
      const a=Depth.labelFrame(n,Depth.labelSection(n,turn.sections),0),b=Depth.labelFrame(n,Depth.labelSection(n,stable.sections),0);
      for(const [u,v]of [[0,0],[1,0],[0,1],[.5,.5]]){
        const x=a.point(u,v),y=b.point(u,v);near(x.x,y.x,undefined,1e-8);near(x.y,y.y,undefined,1e-8);near(x.z,y.z,undefined,1e-8);endpointChecks++;
      }
    }
  }
  for(const progress of phases.slice().reverse()){
    assert.equal(drawPacket(from,to,progress,shape).digest,forward.get(progress),'cancelling retraces identical paper/ink geometry');reverseFrameChecks++;
  }
}
assert.ok(blockedSamples>0,'real paper occlusion is included; tests do not treat all projected labels as always on top');
console.log(JSON.stringify({ownershipStates:ownershipStates.length,carrierVertexChecks,plainEdgeChecks,neckVertexChecks,sharedEdgeChecks,hitChecks,blockedSamples,closedHitChecks,closedInkChecks,
  packetPaths:paths.length,endpointChecks,reverseFrameChecks,printedFacesIncluded:true}));
