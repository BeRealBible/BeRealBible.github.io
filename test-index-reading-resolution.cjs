/* Reading zoom must re-rasterize the shared paper/ink surface, not enlarge an
 * old framebuffer. Mock GL verifies uploads/camera wiring, not visual pixels. */
'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Depth=require('./book-depth.js'),Solid=require('./book-solid.js'),K=require('./book-kinematics.js');
const Layout=require('./book-index-layout.js'),Material=require('./book-material.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model),R=Solid.RASTER;
const camera=(view,scale,dx=0,dy=0)=>({scale,x:view.w/2-480*scale+dx,y:view.h/2-352*scale+dy});
let rasterChecks=0,minDensity=Infinity;
for(const view of [{w:320,h:568},{w:390,h:844},{w:430,h:932},{w:1600,h:1168}])
  for(const scale of [.5,1,2.18,3.2])for(const dpr of [1,2,3])for(const [dx,dy]of [[0,0],[-83,61],[77,-159]]){
    const frame=camera(view,scale,dx,dy),r=Depth.rasterRegion({...view,camera:frame},dpr);
    assert.ok(r.px<=4096&&r.py<=4096&&r.px*r.py<=3600000,'reading zoom respects the mobile framebuffer budget');
    const left=Math.max(-R.LEFT,-frame.x/scale),right=Math.min(R.WIDTH-R.LEFT,(view.w-frame.x)/scale);
    const top=Math.max(-R.TOP,-frame.y/scale),bottom=Math.min(R.HEIGHT-R.TOP,(view.h-frame.y)/scale);
    if(right>left&&bottom>top){
      assert.ok(r.x<=left&&r.x+r.w>=right&&r.y<=top&&r.y+r.h>=bottom,'new raster covers every visible paper point');
    }
    const density=Math.min(r.px/r.w,r.py/r.h)/scale;
    assert.ok(density>=1.24,'zoomed reading ink keeps at least native CSS density with antialiasing headroom');
    minDensity=Math.min(minDensity,density);rasterChecks++;
  }
// This is the regression contrast: at 218% a whole-book, DPR=1 framebuffer
// would magnify less than one source pixel per CSS pixel.
const old=Depth.rasterRegion(null,1);
assert.ok(old.px/old.w/2.18<.5);
// A denser framebuffer must not merely magnify an undersampled atlas. Check
// all 66 em envelopes at the maximum reading zoom and full DPR=3, even where
// the framebuffer budget would reduce actual demand. The four-line stamp is
// the limiting case; this gate fails the obsolete 2.25x atlas.
const atlas=Depth.atlasRaster(notches.length,4096),maxReadingScale=3.2,maxDpr=3;
let sourceChecks=0,minSourceSampling=Infinity;
for(const spread of [0,...['2TH','2PE'].map(code=>books.find(b=>b.code===code).first&~1),pages.length-2]){
  const material=Material.compute(spread,pages.length,books),shape={notches,fanLeft:0,fanRight:0},p=K.prepare(material,0,shape);
  for(const n of notches){
    const side=n.carrierDepth+1e-8<material.leftDepth?'left':'right';
    const frame=Depth.labelFrame(n,{side,point:(s,u,y)=>p.pagePoint(side,s,u,y)},0);
    for(const index of n.indices){
      const slot=model.slots[index],glyph=Depth.labelGlyph(n,slot.label),v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>Solid.project(frame.point(.5+x*glyph.width/2,v+y*glyph.height/2)));
      const width=Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x));
      const height=Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y));
      const ratio=Math.min(124*glyph.width*atlas.scaleX/width,148*glyph.height*atlas.scaleY/height)/(maxReadingScale*maxDpr);
      assert.ok(ratio>=1,`${spread}: ${slot.label} magnifies source ink at 320% / DPR 3 (${ratio})`);
      minSourceSampling=Math.min(minSourceSampling,ratio);sourceChecks++;
    }
  }
}
function fixture(){
  let buffer,uploads=[],clears=0;
  const uniforms={},gl=new Proxy({
    getParameter(key){return key==='MAX_VIEWPORT_DIMS'?[4096,4096]:4096;},
    getExtension(){return {};},getShaderParameter(){return true;},getProgramParameter(){return true;},
    createShader(){return {};},createProgram(){return {};},createBuffer(){return {};},createTexture(){return {};},
    getAttribLocation(_program,name){return name;},getUniformLocation(_program,name){return name;},
    uniform4f(name,...values){uniforms[name]=values;},bufferData(_type,data){buffer=Float32Array.from(data);},
    drawArrays(){uploads.push(buffer);},clear(){uploads=[];clears++;}
  },{get(target,key){return key in target?target[key]:/^[A-Z_]+$/.test(key)?key:()=>{};}});
  const paint=new Proxy({measureText(text){return {width:[...text].length*24};},createLinearGradient(){return {addColorStop(){}};}},
    {get(target,key){return key in target?target[key]:()=>{};}});
  const doc={defaultView:{devicePixelRatio:1},createElement(){return {ownerDocument:doc,style:{},dataset:{},classList:{add(){}},
    addEventListener(){},setAttribute(){},getContext(type){return type==='webgl'?gl:paint;}};}};
  const host={ownerDocument:doc,dataset:{},classList:{add(){}},appendChild(canvas){this.canvas=canvas;}};
  const renderer=Depth.create({host,model,notches,paintPage(){}});
  return {renderer,host,uniforms,clears:()=>clears,hash(){const h=createHash('sha256');for(const b of uploads)h.update(Buffer.from(b.buffer));return h.digest('hex');}};
}
const f=fixture(),m=Material.compute(books.find(b=>b.code==='2TH').first&~1,pages.length,books);
const state={material:m,shape:{notches,fanLeft:0,fanRight:0},close:0,pick:true,printed:[m.spread,m.spread+1]};
assert.ok(f.renderer.update(state));
const geometryHash=f.hash(),stats=f.renderer.getStats(),view={w:390,h:844};
let redrawChecks=0;
for(const [scale,dx,dy]of [[2.18,0,0],[3.2,0,0],[3.2,-83,61],[3.2,77,-159],[1,0,0]]){
  const fineView={...view,camera:camera(view,scale,dx,dy)},r=Depth.rasterRegion(fineView,1),before=f.clears();
  assert.ok(f.renderer.update({...state,fineView}));
  assert.equal(f.clears(),before+1,'zoom/pan triggers a fresh raster draw');
  assert.equal(f.hash(),geometryHash,'raster density cannot move ink to a new sheet or stretch its geometry');
  assert.equal(f.renderer.getStats(),stats,'camera-only updates reuse the unchanged material/hit geometry');
  assert.deepEqual(f.uniforms.u_region,[r.x,r.y,r.w,r.h]);
  assert.equal(f.host.canvas.width,r.px);assert.equal(f.host.canvas.height,r.py);
  f.renderer.update({...state,fineView});assert.equal(f.clears(),before+1,'identical frames do not redraw');
  redrawChecks++;
}
console.log(JSON.stringify({rasterChecks,redrawChecks,sourceChecks,minSourceSampling,minCssPixelDensity:minDensity,regressionDensityAt218Percent:old.px/old.w/2.18,pixelCap:3600000}));
