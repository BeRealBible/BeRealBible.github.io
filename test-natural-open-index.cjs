/* Natural opening acceptance: decode the actual GPU uploads independently.
 * This is a geometry gate, not a replacement for the supplied-photo visual check. */
'use strict';
const assert=require('node:assert/strict');
const Depth=require('./book-depth.js'),K=require('./book-kinematics.js'),Solid=require('./book-solid.js');
const Material=require('./book-material.js'),Layout=require('./book-index-layout.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model),atlasRows=Math.ceil(notches.length/8);
const byCode=new Map(books.map((b,i)=>[b.code,i])),probe=process.argv.includes('--probe');
const samples=[[0,0],[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0]];
const near=(a,b,msg,eps=8e-5)=>assert.ok(Math.abs(a-b)<eps,msg||`${a} != ${b}`);
function fixture(){
  let draws=[],buffer;const shaders=[],attrs={},enabled=[];
  const gl=new Proxy({
    getParameter(k){return k==='MAX_VIEWPORT_DIMS'?[4096,4096]:4096;},getExtension(){return {};},
    getShaderParameter(){return true;},getProgramParameter(){return true;},createProgram(){return {};},createBuffer(){return {};},createTexture(){return {};},
    createShader(type){const s={type};shaders.push(s);return s;},shaderSource(s,source){s.source=source;},
    getAttribLocation(_p,name){return name;},vertexAttribPointer(name,size,_t,_n,stride,offset){attrs[name]={size,stride:stride/4,offset:offset/4};},
    getUniformLocation(_p,name){return name;},bufferData(_t,data){buffer=Float32Array.from(data);},
    drawArrays(_m,_s,count){assert.equal(count,buffer.length/attrs.a_pos.stride);draws.push(buffer);},
    clear(){draws=[];},enable(cap){enabled.push(cap);}
  },{get(t,k){return k in t?t[k]:/^[A-Z_]+$/.test(k)?k:()=>{};}});
  const paint=new Proxy({createLinearGradient(){return {addColorStop(){}};},measureText(text){return {width:[...text].length*24};}},{get(t,k){return k in t?t[k]:()=>{};}});
  const doc={defaultView:{devicePixelRatio:1},createElement(){return {ownerDocument:doc,style:{},dataset:{},classList:{add(){}},addEventListener(){},setAttribute(){},getContext(t){return t==='webgl'?gl:paint;}};}};
  const host={ownerDocument:doc,dataset:{},classList:{add(){}},appendChild(){}};
  const renderer=Depth.create({host,model,notches,paintPage(){}});
  assert.ok(renderer);assert.ok(enabled.includes('DEPTH_TEST'));assert.ok(!enabled.includes('CULL_FACE'),'same carrier is visible from both material faces');
  assert.match(shaders.find(s=>s.type==='FRAGMENT_SHADER').source,/gl_FrontFacing\?floorUV:uv/,'front/back print must use the correctly oriented atlas banks');
  return {renderer,draws:()=>draws,stride:attrs.a_pos.stride};
}
const f=fixture(),stride=f.stride;
let carrierChecks=0,uniqueTriangles=0,clickChecks=0,occlusionChecks=0,orientationChecks=0;
function decodeUploads(draws){
  const buckets=new Map(),perGroup=new Map(),lens=Solid.RASTER.PERSPECTIVE;
  for(const data of draws)for(let offset=0;offset<data.length;offset+=stride*3){
    const kind=data[offset+8],face=data[offset+11];
    const vertices=[0,1,2].map(i=>{
      const k=offset+i*stride;
      return {x:data[k],y:data[k+1],z:data[k+2],u:data[k+3],v:data[k+4],s:data[k+5]*model.totalDepth,backU:data[k+9],backV:data[k+10]};
    });
    const projected=vertices.map(Solid.project),[a,b,c]=projected,area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if(Math.abs(area)<1e-9)continue;
    if((kind===3||kind===4)&&((kind===4)!==(area<0)))continue;
    let group=-1,book=-1;
    if(kind===5){
      const col=Math.floor(vertices.reduce((s,p)=>s+p.u,0)/3*8),row=Math.floor(vertices.reduce((s,p)=>s+p.v,0)/3*atlasRows);
      group=row*8+col;const n=notches[group];assert.ok(n,'ink only belongs to known labels');
      const locals=vertices.map(p=>[(p.u*8*128-col*128-2)/124,(p.v*atlasRows*152-row*152-2)/148]);
      const v=locals.reduce((s,p)=>s+p[1],0)/3;
      book=n.indices[Math.max(0,Math.min(n.indices.length-1,Math.round((v-.5)*n.indices.length/.69+(n.indices.length-1)/2)))];
      for(let i=0;i<3;i++){
        near(vertices[i].s,n.carrierDepth,'front/back ink must stay on exactly one original carrier');
        near((vertices[i].backU*8*128-col*128-2)/124+locals[i][0],1,'reverse UV never mirrors readable type');
        near(vertices[i].backV,vertices[i].v);carrierChecks++;
      }
      assert.ok(face===1||face===-1,'each physical face has an explicit opposing normal');
      const key=face+'|'+locals.map(p=>p.map(v=>v.toFixed(5)).join(',')).join('|');
      if(!perGroup.has(group))perGroup.set(group,new Set());
      assert.ok(!perGroup.get(group).has(key),'the same facing material triangle must not be duplicated');perGroup.get(group).add(key);uniqueTriangles++;
    }
    if(kind>=5&&((face>.5&&area<0)||(face<-.5&&area>0)))continue;
    const tri={kind,group,book,vertices,projected,front:area<0,minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y)};
    for(let row=Math.floor(tri.minY/32);row<=Math.floor(tri.maxY/32);row++){
      if(!buckets.has(row))buckets.set(row,[]);buckets.get(row).push(tri);
    }
  }
  assert.equal(perGroup.size,39,'all original label carriers remain in the uploaded material');
  return (x,y)=>{
    const hits=[];
    for(const tri of buckets.get(Math.floor(y/32))||[]){
      if(x<tri.minX-1e-5||x>tri.maxX+1e-5||y<tri.minY-1e-5||y>tri.maxY+1e-5)continue;
      const [a,b,c]=tri.projected,det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
      const wa=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/det,wb=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/det,wc=1-wa-wb;
      if(Math.min(wa,wb,wc)<-1e-5)continue;
      const w=[wa,wb,wc].map((value,i)=>value/(1-tri.vertices[i].z/lens)),sum=w.reduce((a,b)=>a+b,0);
      const attr=key=>w.reduce((total,value,i)=>total+value*tri.vertices[i][key],0)/sum;
      hits.push({...tri,z:attr('z'),inkU:attr(tri.front?'backU':'u')});
    }
    return hits.sort((a,b)=>b.z-a.z);
  };
}
function draw(spread){
  const material=Material.compute(spread,pages.length,books),shape={notches,fanLeft:0,fanRight:0,edgeInspection:true};
  // Include the actual top paper faces even where resting SVG is used by the
  // UI. Otherwise a hidden label could be falsely accepted through a page.
  f.renderer.update({material,shape,close:0,pick:true,printed:[material.spread,material.spread+1]});
  return {material,front:decodeUploads(f.draws())};
}
function checkSlot(state,slot){
  const n=notches[slot.group],frame=f.renderer.getLabelFrame(slot.index),glyph=Depth.labelGlyph(n,slot.label);
  assert.ok(frame);const v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
  let visible=0;const blockers=[];
  for(const [dx,dy]of samples){
    const point=Solid.project(frame.point(.5+dx*glyph.width/2,v+dy*glyph.height/2)),layers=state.front(point.x,point.y);
    const target=layers.find(t=>t.kind===5&&t.book===slot.index);assert.ok(target,`${books[slot.index].code}: actual glyph has uploaded paper`);
    const blocker=layers.find(t=>!(t.kind===5&&t.book===slot.index)&&t.z>target.z+.0008);
    const hit=f.renderer.hit(point.x,point.y,0,frame.side),wrong=f.renderer.hit(point.x,point.y,0,frame.side==='left'?'right':'left');
    assert.notEqual(wrong,slot.index,'wrong-side filtering cannot reveal the other face through the book');clickChecks++;
    if(blocker){assert.notEqual(hit,slot.index,'a real nearer paper triangle prevents a through-paper click');blockers.push(blocker.kind);occlusionChecks++;}
    else{assert.equal(hit,slot.index,`${books[slot.index].code}: visible glyph must be clickable at the same geometry`);visible++;clickChecks++;}
  }
  // Independent UV interpolation verifies actual reading direction, rather
  // than only checking that the shader contains a two-sided branch.
  const uvSamples=[.35,.65].map(u=>{
    const p=Solid.project(frame.point(u,v)),ink=state.front(p.x,p.y).find(t=>t.kind===5&&t.book===slot.index);
    assert.ok(ink);return {x:p.x,u:ink.inkU};
  });
  assert.ok((uvSamples[1].x-uvSamples[0].x)*(uvSamples[1].u-uvSamples[0].u)>0,'label lettering reads left to right on either physical face');orientationChecks++;
  return {code:books[slot.index].code,group:slot.group,track:slot.track,side:frame.side,visible,blockers,
    centerX:Solid.project(frame.point(.5,v)).x};
}
const reading=[];
for(const code of ['JER','MRK']){
  const spread=books[byCode.get(code)].first&~1,state=draw(spread),slots=model.slots.map(s=>checkSlot(state,s));
  const sides={};
  for(const side of ['left','right']){
    const full=slots.filter(s=>s.side===side&&s.visible===9),tracks=[...new Set(full.map(s=>s.track))],groups=[...new Set(full.map(s=>s.group))];
    const columns=tracks.map(track=>{
      const x=[...new Map(full.filter(s=>s.track===track).map(s=>[s.group,s.centerX])).values()].sort((a,b)=>a-b);
      return {track,medianX:x[Math.floor(x.length/2)]};
    });
    const columnSpan=columns.length?Math.max(...columns.map(c=>c.medianX))-Math.min(...columns.map(c=>c.medianX)):0;
    sides[side]={full:full.map(s=>s.code),tracks,columns,columnSpan,groups:groups.length,partial:slots.filter(s=>s.side===side&&s.visible>0&&s.visible<9).map(s=>({code:s.code,visible:s.visible}))};
    if(!probe){
      assert.ok(tracks.length>=2,`${code}: natural ${side} must expose more than one directory column`);
      assert.ok(columnSpan>=13,`${code}: the complete columns must also be spatially distinct, not semantic names at the same edge`);
      assert.ok(groups.length>=13,`${code}: natural ${side} must expose two useful columns of complete labels, not token placeholders`);
    }
  }
  reading.push({code,spread,sides});
}
const crossing=[];
for(const n of notches){
  const before=Math.min(pages.length-2,n.carrierSheet*2),after=Math.min(pages.length-2,before+2),items=[];
  for(const [spread,side]of [[before,'right'],[after,'left']]){
    const state=draw(spread),values=n.indices.map(i=>checkSlot(state,model.slots[i]));
    for(const value of values){assert.equal(value.side,side,'one leaf changes ownership once at its actual page turn');if(!probe)assert.equal(value.visible,9,`${value.code}: its ${side} face must show its complete glyph immediately before/after flipping`);}
    items.push({side,complete:values.filter(v=>v.visible===9).map(v=>v.code),partial:values.filter(v=>v.visible!==9).map(v=>({code:v.code,visible:v.visible,blockers:v.blockers}))});
  }
  crossing.push({group:n.group,codes:model.groups[n.group].codes,items});
}
console.log(JSON.stringify({probe,reading,crossing,carrierChecks,uniqueTriangles,clickChecks,occlusionChecks,orientationChecks,actualUploadedTriangles:true,topPaperIncluded:true}));
