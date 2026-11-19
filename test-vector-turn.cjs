/* Real contact points, two-dimensional occlusion, reversible turns and the SVG
 * the reader mounts. Browser pixel tests cover compositor-specific regressions. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{PaperPhysics:require('./paper-physics.js')}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'paper-renderer.js'),'utf8'),context);
const R=context.window.PaperSheetRenderer;
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,'expected '+a+' ≈ '+b);
const at=(s,u,v)=>s.points.find(q=>q.u===u&&q.v===v);
function boundaryAt(mask,y){
  const b=mask.boundary,i=b.findIndex(q=>q.y>=y);
  if(i<=0)return b[i===0?0:b.length-1].x;
  const a=b[i-1],c=b[i];
  return a.x+(y-a.y)/(c.y-a.y)*(c.x-a.x);
}
let frames=0;
for(const direction of [-1,1])for(const corner of ['top','bottom']){
  const grabY=corner==='top'?87:617,radius=388,sign=corner==='top'?1:-1;
  const opts={direction,corner,grabY,radius,vertical:29*sign};
  for(let i=0;i<=50;i++){
    const progress=i/50,s=R.vectorSurface({...opts,progress}),mask=R.vectorMask(s),touch=at(s,radius,grabY);
    frames++;assert.ok(touch,'grabbed material must be a mesh vertex, not an interpolation assumption');
    near(touch.x,480+direction*radius*(1-2*progress),.00025);near(touch.y,grabY+(i===0||i===50?0:opts.vertical),.00025);
    for(const v of s.vs){const q=at(s,0,v);near(q.x,480);near(q.y,v);near(q.z,0);}
    assert.match(mask.css,/^polygon\(/);assert.doesNotMatch(mask.css,/NaN|Infinity/);
    const extent=q=>(q.x-480)*direction;
    for(const tr of s.triangles){
      const [xx,yx,xy,yy,dx,dy]=tr.m,pts=[tr.a,tr.b,tr.c];
      for(const q of pts){near(q.u*xx+q.v*xy+dx,q.x);near(q.u*yx+q.v*yy+dy,q.y);
        if(i===0||i===50){near(q.x,480+direction*(i===0?1:-1)*q.u);near(q.y,q.v);near(q.z,0);assert.equal(tr.front,i===0);}}
      // Cover vertices, edge midpoints, and interior positions of every projected
      // triangle, not just the grabbed outside edge. A returning face can extend
      // further into the destination than its nominal front edge.
      for(const [j,k,l] of [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[0,.5,.5],[.2,.35,.45]]){
        const q={x:j*tr.a.x+k*tr.b.x+l*tr.c.x,y:j*tr.a.y+k*tr.b.y+l*tr.c.y};
        if(q.y<0||q.y>704||extent(q)>480.000001)continue;
        const bx=boundaryAt(mask,q.y),blocked=direction>0?bx:480-bx;
        assert.ok(extent(q)<=blocked+1e-6,'next sheet leaks through projected ink');
      }
    }
    if(i===0||i===50)for(const y of [0,7,176,352,507,703,704]){
      near(boundaryAt(mask,y),((i===0)===(direction>0))?480:0);}
    if(i===25&&opts.vertical!==0){
      const tips=s.vs.map(v=>at(s,480,v));
      const span=Math.max(...tips.map(q=>q.x))-Math.min(...tips.map(q=>q.x));
      assert.ok(span<52,'the central turn carries the near and far edges as one coherent leaf');
    }
    if(i===6){
      const tip=at(s,480,corner==='top'?0:704),far=at(s,480,corner==='top'?704:0);
      assert.ok(tip.z>60&&extent(tip)<445,'grabbed end must visibly peel first');
      near(far.z,0);near(extent(far),480);near(far.y,far.v);
      assert.ok(Math.abs(boundaryAt(mask,100)-boundaryAt(mask,604))>40,'not a full-height vertical shutter');
    }
  }
}
class E{
  constructor(type){this.type=type;this.children=[];this.attrs={};this.dataset={};this.ownerDocument=doc;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  appendChild(el){el.remove();el.parent=this;this.children.push(el);return el;}
  append(...els){for(const e of els)this.appendChild(e);}
  replaceChildren(...els){for(const e of this.children)e.parent=null;this.children=[];this.append(...els);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}
}
const doc={createElementNS:(_ns,type)=>new E(type)};
const page=n=>'<svg><defs><linearGradient id="paper-'+n+'"/></defs><rect fill="url(#paper-'+n+')"/><text x="40" y="60" font-size="12">甲</text><text x="400" y="620" font-size="12">乙</text><text x="10" y="365" font-size="9">page '+n+'</text></svg>';
for(const dir of [-1,1]){
  const host=new E('div'),r=R.vector(host,page);r.prepare(31,32,dir);
  const [layer]=host.children,[defs,shadow,stock,group]=layer.children;
  assert.equal(layer.attrs['aria-hidden'],'true');assert.equal(host.dataset.renderer,'svg-curved-sheet');assert.equal(stock.attrs.fill,'#f8f3e4');
  for(const g of defs.children){const [base,paper]=g.children;assert.equal(base.attrs.fill,'#fffdf1');assert.equal(base.attrs.width,'480');assert.equal(base.attrs.height,'704');assert.match(paper.innerHTML,/url\(#turn-leaf-/);assert.doesNotMatch(paper.innerHTML,/id="paper-|<text\b/);}
  let previous;
  for(const progress of [0,.13,.39,.67,.29,.13,1]){
    const o={progress,radius:388,grabY:617,vertical:0,corner:'bottom'},css=r.draw(o),s=R.vectorSurface({...o,direction:dir});
    assert.equal(css,R.vectorMask(s).css);assert.equal(stock.attrs.d,shadow.attrs.d);assert.doesNotMatch(stock.attrs.d,/NaN|Infinity/);
    if(progress===.13){if(previous)assert.equal(stock.attrs.d,previous,'reversing without release should reproduce the exact surface');previous=stock.attrs.d;}
    const patches=defs.children[2],tiles=patches.children.filter(n=>n.type==='g'),clips=patches.children.filter(n=>n.type==='clipPath'),refs=new Set(tiles.map(t=>'#'+t.attrs.id));
    assert.equal(group.children.length,s.triangles.length);assert.equal(clips.length,s.triangles.length);
    const used=tiles.filter(t=>t.children[1].innerHTML.includes('甲'));assert.ok(used.length>0&&used.length<tiles.length/2,'do not repaint all glyphs for every triangle');
    for(const [idx,t] of tiles.entries()){
      const side=idx%2,mirror=(dir<0)!==(side===1);assert.equal(!!t.attrs.transform,mirror);
      assert.equal(t.children[0].attrs.href,'#'+defs.children[side].attrs.id);
    }
    for(const n of group.children){assert.match(n.attrs.transform,/^matrix\(/);assert.doesNotMatch(n.attrs.transform,/NaN|Infinity/);
      const [cut]=n.children,[ink,shade]=cut.children;assert.ok(refs.has(ink.attrs.href));assert.ok(+shade.attrs.opacity>=0&&+shade.attrs.opacity<=.151);
      assert.match(cut.attrs['clip-path'],/^url\(#turn-leaf-\d+-clip\d+\)$/);
      if(progress===0||progress===1)assert.match(ink.attrs.href,new RegExp('ink'+(progress===0?0:1)+'-'));
    }
  }
  r.hide();assert.equal(host.children.length,0);assert.equal(host.dataset.curlProgress,undefined);assert.equal(host.dataset.curlCorner,undefined);
}
// Real painter wiring with a recording graphics context: both accelerated
// branches bake two faces only once, reuse the same context across turns,
// and apply the same 2D mask as the pure SVG safety path.
for(const mode of ['webgl','canvas']){
  let contexts=0,uploads=0,draws=0,clears=0,lastVertices,writes=[];
  const props={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,TEXTURE0:10,RGBA:11};
  const gl=new Proxy({
    ...props,isContextLost:()=>false,getProgramParameter:()=>true,getShaderParameter:()=>true,getAttribLocation:()=>0,
    createProgram:()=>({}),createShader:()=>({}),createBuffer:()=>({}),createTexture:()=>({}),
    texImage2D(){uploads++;},bufferData(_target,a){lastVertices=a;},
    drawArrays(_shape,first,num){draws++;assert.equal(first,0);assert.equal(num,48*3);assert.equal(lastVertices.length,num*6);
      assert.ok(lastVertices.every(Number.isFinite));const sides=new Set();for(let i=0;i<lastVertices.length;i+=6){sides.add(lastVertices[i+4]);assert.ok(lastVertices[i+2]>=0&&lastVertices[i+2]<=1);assert.ok(lastVertices[i+3]>=0&&lastVertices[i+3]<=1);}assert.ok([...sides].every(s=>s===0||s===1));}
  },{get:(o,k)=>k in o?o[k]:(()=>{})});
  const ctx=new Proxy({drawImage(im,...args){draws++;assert.ok(im.width>0&&im.height>0);assert.equal(args.length,8);assert.ok(args.every(Number.isFinite));},clearRect(){clears++;}},
    {get:(o,k)=>k in o?o[k]:(()=>{})});
  const factory=Object.assign({},doc,{documentElement:{clientWidth:390,clientHeight:844},createElement(type){
    const c=new E(type);c.style={};c.getContext=id=>{if(id==='webgl'){contexts++;return mode==='webgl'?gl:null;}return ctx;};return c;}});
  const host=new E('div');host.ownerDocument=factory;host.getBoundingClientRect=()=>({left:-1451,top:-430,width:2880});
  const r=R.vector(host,()=>{throw Error('accelerated turn must not repaint SVG text');},(c,index,ratio)=>{assert.equal(c.width,480*ratio);assert.equal(c.height,704*ratio);writes.push(index);});
  for(let turn=0;turn<3;turn++){
    r.prepare(34,35,turn%2?-1:1);assert.equal(host.dataset.turnInk,mode);assert.equal(host.children.length,2);
    const canvas=host.children[1];assert.ok(canvas.width*canvas.height<=3510000);assert.equal(canvas.attrs['aria-hidden'],'true');
    for(const progress of [0,.2,.48,.76,1]){const opts={direction:turn%2?-1:1,corner:'bottom',grabY:617,radius:388,progress,vertical:-18};
      assert.equal(r.draw(opts),R.vectorMask(R.vectorSurface(opts)).css);}
    r.hide();assert.equal(host.children.length,0);
  }
  assert.equal(contexts,1,'one reusable context for the reader, not one per gesture');
  assert.deepEqual(writes,[34,35],'repeated/reversed turns hit the bounded texture cache');
  if(mode==='webgl'){assert.equal(uploads,6);assert.equal(draws,15,'one GPU mesh submission per frame');}
  else {assert.equal(clears,15);assert.ok(draws>30,'visible tiles painted from actual cached face textures');}
}
console.log('vector corner turn: '+frames+' frames, four corners, pinned contact/spine, slanted occlusion envelope, two real opaque SVG faces, reversible mesh and cleanup PASS');
