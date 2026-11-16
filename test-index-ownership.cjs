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
  assert.match(fragment,/gl_FrontFacing\?floorUV:uv/,'one finite-thickness leaf reads correctly on each physical face');
  assert.match(fragment,/visibleInk>\.5&&gl_FrontFacing/,'front material face rejects its inward-facing side');
  assert.match(fragment,/visibleInk<-.5&&!gl_FrontFacing/,'back material face rejects its inward-facing side');
  const stock=fragment.match(/vec3 stock=mix\(vec3\(([^)]+)\),vec3\(([^)]+)\),clamp\(\(paper.y-\.9\)\*10.0,0.0,1.0\)\)\*paper.z/);
  assert.ok(stock,'plain and printed carrier stock use the same material-space outer-page gradient');
  for(const [bank,rgb]of [[1,[255,254,245]],[2,[249,246,235]]])
    stock[bank].split(',').map(Number).forEach((value,i)=>near(value,rgb[i]/255,'carrier colour agrees with the existing page-edge stock',1e-7));
  assert.match(fragment,/if\(paper.w>5.5\)\{gl_FragColor=vec4\(stock,1.0\);return;\}/,'unprinted return folds share that stock, not a second card colour');
  assert.match(fragment,/mix\(stock,ink.rgb,u_stamp\*ink.a\)/,'recess lighting modifies only paper, never the printed ink');
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
  const col=Math.floor(mean(3)*8),row=Math.floor(mean(4)*rows),group=row*8+col;
  assert.ok(group>=0&&group<notches.length,'single atlas bank holds exactly the real leaf labels');
  const local=[];
  for(let j=0;j<3;j++)local.push([(data[base+j*stride+3]*8*128-col*128-2)/124,
    (data[base+j*stride+4]*rows*152-row*152-2)/148]);
  assert.ok(data[base+11]===1||data[base+11]===-1,'carrier face has an explicit front/back sign');
  return {n:notches[group],face:data[base+11]===1?0:1,local,points:[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}))};
}
const faceKey=(n,face)=>n.group+':'+face;
let carrierVertexChecks=0,plainEdgeChecks=0,plainCarrierVertexChecks=0,sharedEdgeChecks=0,originalLeafJoins=0,materialColourChecks=0,colourSeamChecks=0;
let rimEdgeChecks=0,rimVertexChecks=0;
const referenceCounts=new Map();
function checkUpload(state){
  const counts=new Map(),unique=new Map(),plainEdges=new Map(),labelEdges=new Map(),patches=new Map(),expectedPlain=new Map(),lights=new Map(),colours=new Map();
  const faceEdges=new Map(),faceVertexUV=new Map(),fibreTriangles=new Map();
  const inspection=state.close?K.inspectionAmount(state.close):0;
  const edgeKey=(a,b)=>[a,b].map(p=>[p.x,p.y,p.z].join(',')).sort().join('|');
  const pointKey=p=>[p.x,p.y,p.z].map(Math.fround).join(',');
  const triangleKey=points=>points.map(pointKey).sort().join('|');
  const recordFaceEdges=(id,vertices)=>{
    if(!faceEdges.has(id))faceEdges.set(id,new Map());
    const edges=faceEdges.get(id);
    for(const [a,b]of [[0,1],[1,2],[2,0]]){
      if(pointKey(vertices[a])===pointKey(vertices[b]))continue;
      const key=edgeKey(vertices[a],vertices[b]),prior=edges.get(key);
      if(prior)prior.count++;else edges.set(key,{count:1,points:[vertices[a],vertices[b]]});
    }
  };
  const recordUV=(id,point,uv)=>{
    if(!faceVertexUV.has(id))faceVertexUV.set(id,new Map());
    faceVertexUV.get(id).set(pointKey(point),uv);
  };
  for(const n of notches)for(const face of [0,1]){
    const id=faceKey(n,face),section=Depth.labelSection(n,state.sections),patch=Depth.carrierPatch(n,section,inspection,notches,face);
    patches.set(id,patch);
    near(patch.frame.carrierDepth,n.carrierDepth,'both faces retain one immutable sheet identity');
    near(patch.frame.surfaceDepth,n.carrierDepth+face*n.sheetPitch,'front/back surface is the boundary of that same sheet',1e-9);
    const a=patch.frame.point(.49,.5),b=patch.frame.point(.51,.5);
    lights.set(id,.89+.11*Math.abs(b.x-a.x)/(Math.hypot(b.x-a.x,b.z-a.z)||1));
    const expected=new Map();
    for(const poly of patch.polygons.filter(p=>p.kind===6))for(const uv of poly.coords){
      const key=pointKey(patch.point(...uv));if(!expected.has(key))expected.set(key,[]);expected.get(key).push(uv);
    }
    expectedPlain.set(id,expected);
  }
  function checkColour(n,face,point,u,v,outward,light){
    const id=faceKey(n,face),patch=patches.get(id),leafLight=lights.get(id),protect=patch.bounds(v).protect;
    near(outward,patch.frame.rootU+u*patch.frame.width/K.WIDTH,'stock gradient follows the carrier material coordinate',1e-6);
    assert.ok(light>=leafLight*.9-1e-6&&light<=leafLight+1e-6,'the unprinted return fold receives at most 10 percent extra shade');
    near(light,leafLight*(1-.1*inspection*(1-protect)),'fold lighting follows the continuous return margin',1e-6);
    if(v>=0&&v<=1)near(light,leafLight,'printed domain has no extra return-fold darkening',1e-6);
    const key=id+'|'+pointKey(point),previous=colours.get(key);
    if(previous){assert.deepEqual([outward,light],previous,'identical carrier vertices share identical colour attributes across ink/plain seams');colourSeamChecks++;}
    else colours.set(key,[outward,light]);materialColourChecks++;
  }
  for(const data of state.draws)for(let base=0;base<data.length;base+=stride*3){
    const kind=data[base+8];
    if(kind===1){
      const vertices=[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}));
      const key=triangleKey(vertices);
      if(!fibreTriangles.has(key))fibreTriangles.set(key,[]);
      fibreTriangles.get(key).push([0,1,2].map(j=>Array.from(data.subarray(base+j*stride,base+(j+1)*stride))));
      continue;
    }
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
      assert.ok(n,'unprinted continuous margin belongs to an actual label carrier');
      assert.ok(data[base+11]===1||data[base+11]===-1,'plain carrier also has a physical front/back side');
      const face=data[base+11]===1?0:1,id=faceKey(n,face);
      if(!plainEdges.has(id))plainEdges.set(id,new Set());
      const vertices=[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}));
      recordFaceEdges(id,vertices);
      for(const [a,b]of [[0,1],[1,2],[2,0]])plainEdges.get(id).add(edgeKey(vertices[a],vertices[b]));
      for(let j=0;j<3;j++){
        near(data[base+j*stride+5]*T,n.carrierDepth,'plain margin cannot connect unrelated sheets');
        near(data[base+j*stride+3],.0001);near(data[base+j*stride+4],.0001);
        assert.equal(data[base+j*stride+11],face===0?1:-1,'all vertices preserve the same material face orientation');
        const uv=expectedPlain.get(id).get(pointKey(vertices[j]));
        assert.ok(uv,'plain carrier geometry follows its actual page cut, not a decorative backing card');
        const outward=data[base+j*stride+6],light=data[base+j*stride+7];
        const match=uv.find(([u])=>Math.abs(outward-(patches.get(id).frame.rootU+u*patches.get(id).frame.width/K.WIDTH))<1e-6);
        assert.ok(match,'plain colour attributes belong to the same material vertex');checkColour(n,face,vertices[j],...match,outward,light);
        recordUV(id,vertices[j],match);
        plainCarrierVertexChecks++;
      }
      continue;
    }
    if(kind!==5)continue;
    const {n,face,local,points}=decode(data,base),id=faceKey(n,face),section=Depth.labelSection(n,state.sections);
    recordFaceEdges(id,points);points.forEach((p,j)=>recordUV(id,p,local[j]));
    if(!labelEdges.has(id))labelEdges.set(id,new Map());
    for(const [a,b]of [[0,1],[1,2],[2,0]]){
      const key=edgeKey(points[a],points[b]),edges=labelEdges.get(id),prior=edges.get(key);
      if(prior)prior.count++;else edges.set(key,{count:1,local:[local[a],local[b]],points:[points[a],points[b]]});
    }
    assert.ok(section,'carrier must be owned by one material section');
    assert.equal(state.sections.filter(s=>n.carrierDepth+1e-8>=s.lo&&n.carrierDepth+1e-8<s.hi).length,1);
    const patch=patches.get(id);
    counts.set(id,(counts.get(id)||0)+1);
    if(!unique.has(id))unique.set(id,new Set());
    const key=local.map(p=>p.map(v=>v.toFixed(5)).join(',')).join('|');
    assert.ok(!unique.get(id).has(key),'each original sheet face has exactly one copy of each triangle, never a same-facing clone');unique.get(id).add(key);
    for(let j=0;j<3;j++){
      near(data[base+j*stride+5]*T,n.carrierDepth,'every ink vertex has one immutable material s');
      assert.equal(data[base+j*stride+11],face===0?1:-1,'face orientation cannot move by an alpha ownership handoff');
      const col=n.group%8,row=Math.floor(n.group/8);
      const backU=(data[base+j*stride+9]*8*128-col*128-2)/124;
      const backV=(data[base+j*stride+10]*rows*152-row*152-2)/148;
      near(backU+local[j][0],1,'back face mirrors UV, not material depth');near(backV,local[j][1]);
      const p=patch.point(...local[j]);
      near(points[j].x,p.x,'UV u must run on the carrier leaf, not across stack depth',.0005);
      near(points[j].y,p.y,undefined,.0005);near(points[j].z,p.z,undefined,.0005);
      checkColour(n,face,points[j],...local[j],data[base+j*stride+6],data[base+j*stride+7]);
      carrierVertexChecks++;
    }
  }
  assert.equal(counts.size,78,'39 original labelled sheets each retain their two physical faces');
  assert.equal(labelEdges.size,78,'each physical face has a complete connected ink domain');
  for(const n of notches)assert.deepEqual(unique.get(faceKey(n,0)),unique.get(faceKey(n,1)),
    'front and back print cover exactly the same original material triangles, once per face');
  // Start with the real uploaded front surface (ink AND plain margin), not
  // a count of kind-1 triangles. Every free union boundary must meet an
  // uploaded back boundary and the two exact fibre triangles closing it.
  for(const n of notches){
    const frontId=faceKey(n,0),backId=faceKey(n,1),front=patches.get(frontId),back=patches.get(backId);
    let sealed=0;
    for(const edge of faceEdges.get(frontId).values()){
      assert.ok(edge.count<=2,'carrier face union has no same-facing non-manifold duplicate');
      if(edge.count!==1)continue;
      const uv=edge.points.map(p=>faceVertexUV.get(frontId).get(pointKey(p)));
      assert.ok(uv.every(Boolean),'the uploaded free edge retains its material coordinates');
      if(uv.every(([u,v])=>Math.abs(u-front.bounds(v).start)<1e-5))continue;
      const [a,b]=edge.points,[aa,bb]=uv.map(p=>{
        const q=back.point(...p);return {x:Math.fround(q.x),y:Math.fround(q.y),z:Math.fround(q.z)};
      });
      const backEdge=faceEdges.get(backId).get(edgeKey(aa,bb));
      assert.ok(backEdge?.count===1,'front free edge has the exact corresponding uploaded back free edge');
      const choices=[[[a,b,bb],[a,bb,aa]],[[a,b,aa],[b,bb,aa]]];
      const joined=choices.find(pair=>pair.every(tri=>fibreTriangles.get(triangleKey(tri))?.length===1));
      assert.ok(joined,'the actual GPU fibre rim closes both faces with shared Float32 vertices, not a near-overlaid card');
      for(const tri of joined)for(const vertex of fibreTriangles.get(triangleKey(tri))[0]){
        assert.equal(vertex[8],1,'the rim is unprinted fibre material');
        for(const offset of [3,4,9,10])near(vertex[offset],.0001,'no atlas UV or lettering may enter a sheet rim');
        assert.ok(Math.abs(vertex[5]*T-n.carrierDepth)<8e-5||Math.abs(vertex[5]*T-(n.carrierDepth+n.sheetPitch))<8e-5,
          'the rim only joins the two boundaries of its original sheet');
        near(vertex[6],1,'rim uses plain fibre tint');near(vertex[7],.97,'rim has paper-edge lighting');rimVertexChecks++;
      }
      sealed++;rimEdgeChecks++;
    }
    assert.ok(sealed>0,'every labelled sheet has an actually closed free edge');
  }
  for(const [group,edges]of labelEdges){
    let boundary=0;
    for(const [key,edge]of edges){
      assert.ok(edge.count<=2,`${group}: carrier mesh edge has ${edge.count} incidences (duplicate/degenerate/non-manifold): ${key}`);
      if(edge.count===2)continue;boundary++;
      if(plainEdges.get(group)?.has(key)){sharedEdgeChecks++;continue;}
      // At u=0 the printed margin may join the original carrier directly,
      // without manufacturing an extra neck. Both endpoints must be the
      // unchanged material leaf; every other boundary needs an exact seam.
      assert.ok(edge.local.every(([u])=>Math.abs(u)<1e-5),`${group}: ink/plain margin must share the identical uploaded edge, without T-junctions or cracks`);
      edge.local.forEach(([,v],i)=>{
        const p=patches.get(group).frame.basePoint(0,v),q=edge.points[i];
        near(p.x,q.x,'fold root remains attached to the original leaf',.0005);near(p.y,q.y,undefined,.0005);near(p.z,q.z,undefined,.0005);
      });originalLeafJoins++;
    }
    assert.ok(boundary>=3,'a carrier has a closed material boundary');
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
let hitChecks=0,blockedSamples=0,closedHitChecks=0,closedInkChecks=0,blankPaperChecks=0,visibleUploadChecks=0,occlusionProofChecks=0,occludedCodeChecks=0;
function centre(slot,u=.5){
  const n=notches[slot.group],frame=f.renderer.getLabelFrame(slot.index);
  const v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
  return {...Solid.project(frame.point(u,v)),side:frame.side};
}
// Build an independent occlusion view from the actual Float32 GPU uploads.
// Do not use the renderer's CPU frontAt/atPixel or its hit result to decide
// which ordinary fan labels ought to be exposed. A passed carrier can now
// correctly sit behind an uncut later leaf instead of staying always on top.
function uploadedOcclusion(state){
  const buckets=new Map(),lens=Solid.RASTER.PERSPECTIVE;
  for(const data of state.draws)for(let base=0;base<data.length;base+=stride*3){
    const kind=data[base+8],points=[0,1,2].map(j=>({x:data[base+j*stride],y:data[base+j*stride+1],z:data[base+j*stride+2]}));
    const projected=points.map(Solid.project),[a,b,c]=projected;
    const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-9)continue;
    // CSS screen y points down, while WebGL front-facing winding points up.
    // Printed reading faces and both finite-thickness carrier surfaces reject
    // their inward-facing triangles, exactly as the independently read shader.
    if((kind===3||kind===4)&&((kind===4)!==(area<0)))continue;
    if(kind>=5&&(data[base+11]>0?area<0:area>0))continue;
    let book=-1,group=-1;
    if(kind===5){
      const decoded=decode(data,base),n=decoded.n;group=n.group;
      const v=decoded.local.reduce((sum,p)=>sum+p[1],0)/3;
      const row=Math.max(0,Math.min(n.indices.length-1,Math.round((v-.5)*n.indices.length/.69+(n.indices.length-1)/2)));
      book=n.indices[row];
    }
    const tri={kind,book,group,points,projected,minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y)};
    for(let row=Math.floor(tri.minY/32);row<=Math.floor(tri.maxY/32);row++){
      if(!buckets.has(row))buckets.set(row,[]);buckets.get(row).push(tri);
    }
  }
  return (x,y)=>{
    const hits=[];
    for(const tri of buckets.get(Math.floor(y/32))||[]){
      if(x<tri.minX-1e-5||x>tri.maxX+1e-5||y<tri.minY-1e-5||y>tri.maxY+1e-5)continue;
      const [a,b,c]=tri.projected,det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
      const wa=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/det;
      const wb=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/det,wc=1-wa-wb;
      if(Math.min(wa,wb,wc)<-1e-5)continue;
      const weights=[wa,wb,wc].map((w,i)=>w/(1-tri.points[i].z/lens)),sum=weights.reduce((a,b)=>a+b,0);
      const z=weights.reduce((s,w,i)=>s+w*tri.points[i].z,0)/sum;
      hits.push({...tri,z});
    }
    return hits.sort((a,b)=>b.z-a.z);
  };
}
function checkHits(spread,side,close,codes){
  const state=draw(spread,side,close,true),found=new Set(),expectedVisible=new Set(),blockedByCode=new Map();
  const uploaded=close<1?uploadedOcclusion(state):null;
  for(const slot of model.slots){
    const p=centre(slot),onSide=close===1?'both':p.side;
    for(const u of [.35,.5,.65]){
      const q=centre(slot,u),hit=f.renderer.hit(q.x,q.y,0,onSide);
      const code=books[slot.index].code;
      if(uploaded){
        const layers=uploaded(q.x,q.y),target=layers.find(t=>t.kind===5&&t.book===slot.index);
        assert.ok(target,`${spread}: ${code} has its actual uploaded ink triangle at this sample`);
        // Occlusion uses the uploaded piecewise-planar depth, not q.z from
        // the analytic curved leaf (their interiors need not be identical).
        assert.ok(Number.isFinite(target.z),'the uploaded carrier has finite interpolated depth');
        const blocker=layers.find(t=>!(t.kind===5&&t.book===slot.index)&&t.z>target.z+.0008);
        if(blocker){
          assert.notEqual(hit,slot.index,`${spread}: ${code} cannot be hit through a genuinely nearer uploaded paper face`);
          assert.ok([0,1,2,3,4,5,6].includes(blocker.kind),'occlusion evidence is real paper/cover/another printed carrier');
          assert.ok(blocker.kind!==5||blocker.book!==slot.index,'the target itself cannot be used as its own blocking proof');
          blockedByCode.set(code,(blockedByCode.get(code)||0)+1);occlusionProofChecks++;
        }else{
          expectedVisible.add(code);
          assert.equal(hit,slot.index,`${spread}: actually exposed ${code} must remain clickable`);visibleUploadChecks++;
        }
      }
      if(hit===slot.index){found.add(code);hitChecks++;}
      else blockedSamples++;
      if(close<1)assert.notEqual(f.renderer.hit(q.x,q.y,0,p.side==='left'?'right':'left'),slot.index,'wrong-side filter cannot revive a label');
    }
  }
  for(const code of codes){
    if(close===1||expectedVisible.has(code))assert.ok(found.has(code),`${spread}/${side}/close=${close} loses readable clickable ${code}`);
    else{assert.equal(blockedByCode.get(code),3,`${spread}: every non-visible ${code} centre requires independent uploaded-paper occlusion evidence`);occludedCodeChecks++;}
  }
  if(close<1)assert.ok(expectedVisible.size>0&&found.size>0,'ordinary fanning still exposes real, usable labels; an all-hidden index is not accepted');
  if(close===1){
    checkUpload(state);
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
    for(const n of notches){
      const frame=f.renderer.getLabelFrame(n.indices[0]);
      for(const [u,v]of [[.01,.01],[.99,.01],[.01,.99],[.99,.99]]){
        const q=Solid.project(frame.point(u,v));
        assert.ok(!n.indices.includes(f.renderer.hit(q.x,q.y,0,'both')),'blank carrier paper outside the ink ellipse is not a book button');
        blankPaperChecks++;
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
    for(const n of notches)for(const face of [0,1]){
      const a=Depth.labelFrame(n,Depth.labelSection(n,turn.sections),0,face),b=Depth.labelFrame(n,Depth.labelSection(n,stable.sections),0,face);
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
console.log(JSON.stringify({ownershipStates:ownershipStates.length,carrierVertexChecks,plainEdgeChecks,plainCarrierVertexChecks,sharedEdgeChecks,originalLeafJoins,materialColourChecks,colourSeamChecks,rimEdgeChecks,rimVertexChecks,hitChecks,blockedSamples,visibleUploadChecks,occlusionProofChecks,occludedCodeChecks,closedHitChecks,closedInkChecks,blankPaperChecks,
  packetPaths:paths.length,endpointChecks,reverseFrameChecks,printedFacesIncluded:true}));
