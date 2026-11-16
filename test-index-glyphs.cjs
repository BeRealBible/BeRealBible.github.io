/* Project the actual edition's inspection ink, not just its backing canvas.
 * These are conservative font-em envelopes, not a substitute for mobile visual QA. */
'use strict';
const assert=require('node:assert/strict');
const K=require('./book-kinematics.js'),Scene=require('./book-scene.js');
const Depth=require('./book-depth.js'),Layout=require('./book-index-layout.js');
const Material=require('./book-material.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),before=JSON.stringify(model);
const notches=Depth.milling(model),material=Material.compute(0,pages.length,books);
const shape={notches,edgeInspection:true},prepared=K.prepare(material,1,shape);
const inspectionBand=model.totalDepth+K.WIDTH*2*Math.sin(K.EDGE_SWEEP/2);
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-8,message||`${a} != ${b}`);
assert.equal(model.slots.length,66);assert.equal(notches.length,39);
assert.equal(JSON.stringify(model),before,'milling must not mutate semantic layout or absolute opening anchors');

// Both source variants share normalized UVs; down-limiting a source texture
// must not move the glyphs or exceed the older device's texture capability.
const fullAtlas=Depth.atlasRaster(notches.length,4096);
assert.ok(fullAtlas.width<=4096&&fullAtlas.height<=4096);
assert.ok(fullAtlas.scaleX>2&&fullAtlas.scaleY>2,'dense phone ink needs more than the old 2x source budget');
for(const count of [0,1,8,9,39,66])for(const limit of [512,1024,2048,3072,4096,8192]){
  const atlas=Depth.atlasRaster(count,limit),rows=Math.max(1,Math.ceil(count/8));
  assert.ok(Number.isInteger(atlas.width)&&Number.isInteger(atlas.height));
  assert.ok(atlas.width>0&&atlas.height>0&&atlas.width<=limit&&atlas.height<=limit);
  near(atlas.scaleX,atlas.width/(8*128));near(atlas.scaleY,atlas.height/(2*rows*152));
  for(const u of [0,.12,.5,.88,1]){
    const logical=2+u*124;
    near(logical*atlas.scaleX/atlas.width,logical/(8*128),'source cap must preserve horizontal UV placement');
    near((2+u*148)*atlas.scaleY/atlas.height,(2+u*148)/(2*rows*152),'source cap must preserve vertical UV placement');
  }
}

const envelopes=notches.flatMap(n=>n.indices.map((index,j)=>{
  const slot=model.slots[index],glyph=Depth.inspectionGlyph(n,slot.label);
  const v=.5+(j-(n.indices.length-1)/2)*(.69/n.indices.length);
  const y=n.y+n.radius*(2*v-1),dx=n.span*2.1*glyph.width/2,dy=n.radius*glyph.height;
  assert.ok(glyph.width>0&&glyph.width<1&&glyph.height>0&&glyph.height<1);
  assert.ok(dx<n.span&&Math.abs(y-n.y)+dy<n.radius,'ink stays inside its own physical cut extent');
  near(slot.anchorDepth,Math.floor(books[index].first/2)/model.totalSheets*model.totalDepth,'each book retains its true sheet opening');
  return {n,index,label:slot.label,chars:[...slot.label].length,glyph,v,y,dx,dy};
}));

const summaries=[];
for(const view of [{w:320,h:568},{w:390,h:844},{w:430,h:932},{w:1280,h:720}]){
  const camera=Scene.sample(1,{zoom:1,cx:480,cy:352},view,.4,null,0,material,{inspectionBand});
  const raster=Depth.rasterRegion({...view,camera},3);
  const densityX=raster.px/raster.w/camera.scale,densityY=raster.py/raster.h/camera.scale;
  const project=(s,y)=>{
    const p=Scene.project(prepared.foreedgePoint('right',s,y));
    return {x:p.x*camera.scale+camera.x,y:p.y*camera.scale+camera.y};
  };
  const boxes=envelopes.map(e=>{
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(e.n.depth+x*e.dx,e.y+y*e.dy));
    const x0=Math.min(...corners.map(p=>p.x)),x1=Math.max(...corners.map(p=>p.x));
    const y0=Math.min(...corners.map(p=>p.y)),y1=Math.max(...corners.map(p=>p.y));
    const width=x1-x0,height=y1-y0,charWidth=width/e.chars,aspect=charWidth/height;
    // Two-character and four-book cuts used to pass framebuffer tests while
    // squeezing each character to 5.9-7.4 CSS px. Guard that failure directly.
    assert.ok(charWidth>=11,`${view.w}: ${e.label} is squeezed to ${charWidth} CSS px per character`);
    assert.ok(height>=13,`${view.w}: ${e.label} is only ${height} CSS px high`);
    assert.ok(aspect>=.70,`${view.w}: ${e.label} is excessively condensed (${aspect})`);
    assert.ok(x0>=0&&x1<=view.w,`${view.w}: ${e.label} extends outside the horizontal viewport`);
    const sourceX=124*e.glyph.width*fullAtlas.scaleX,sourceY=148*e.glyph.height*fullAtlas.scaleY;
    const sourceRatio=Math.min(sourceX/(width*densityX),sourceY/(height*densityY));
    assert.ok(sourceRatio>=1,`${view.w}: ${e.label} still magnifies its source glyph (${sourceRatio})`);
    return {...e,x0,x1,y0,y1,charWidth,height,aspect,sourceRatio};
  });
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    const overlapX=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),overlapY=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
    assert.ok(overlapX<=0||overlapY<=0,`${view.w}: ${a.label} and ${b.label} ink envelopes overlap`);
  }
  summaries.push({width:view.w,height:view.h,minCharacterWidth:Math.min(...boxes.map(b=>b.charWidth)),
    minGlyphHeight:Math.min(...boxes.map(b=>b.height)),minAspect:Math.min(...boxes.map(b=>b.aspect)),
    minSourceSampling:Math.min(...boxes.map(b=>b.sourceRatio))});
}

// Widened recesses may touch at their paper rims, but another cut must never
// take over an ink centre. Reconstruct the same depth-tested tessellation and
// confirm the existing .69/count centre mapping still picks all 66 books.
const buckets=new Map();
for(const band of Depth.topology(model.totalDepth,notches))for(let j=0;j<band.cuts.length;j++){
  const n=band.cuts[j],coords=[[band.lo,band.ys[j]],[band.hi,band.ys[j]],
    [band.hi,band.ys[j+1]],[band.lo,band.ys[j+1]]];
  const points=coords.map(([s,y])=>prepared.foreedgePoint('right',s,y));
  for(const ids of [[0,1,2],[0,2,3]]){
    const tri=Depth.projectTriangle({points:ids.map(i=>points[i]),n,
      meta:n?ids.map(i=>[0,(coords[i][1]-(n.y-n.radius))/(2*n.radius)]):null});
    for(let y=Math.floor(tri.bounds[1]/32);y<=Math.floor(tri.bounds[3]/32);y++){
      if(!buckets.has(y))buckets.set(y,[]);buckets.get(y).push(tri);
    }
  }
}
let ownerChecks=0;
for(const e of envelopes)for(const [x,y]of [[0,0],[-.8,-.8],[.8,-.8],[-.8,.8],[.8,.8]]){
  const p=Scene.project(prepared.foreedgePoint('right',e.n.depth+x*e.dx,e.y+y*e.dy));
  const front=Depth.frontAt(buckets.get(Math.floor(p.y/32))||[],p.x,p.y);
  assert.equal(front?.tri.n?.group,e.n.group,`${e.label}: neighbouring recess or paper hides the ink interior`);
  const count=e.n.indices.length,j=Math.max(0,Math.min(count-1,Math.round((front.v-.5)*count/.69+(count-1)/2)));
  assert.equal(e.n.indices[j],e.index,`${e.label}: printed position no longer resolves to its own book`);
  ownerChecks++;
}
console.log(JSON.stringify({bookCount:envelopes.length,notchCount:notches.length,ownerChecks,atlas:fullAtlas,views:summaries}));
