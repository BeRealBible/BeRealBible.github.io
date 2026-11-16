/* The labels are ink on 39 individual leaves, not stamps along a stack.
 * Font-em envelopes and raster budgets are conservative, not mobile visual QA. */
'use strict';
const assert=require('node:assert/strict');
const K=require('./book-kinematics.js'),Scene=require('./book-scene.js');
const Depth=require('./book-depth.js'),Layout=require('./book-index-layout.js');
const Material=require('./book-material.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),before=JSON.stringify(model);
const notches=Depth.milling(model),material=Material.compute(0,pages.length,books);
const shape={notches,edgeInspection:true},prepared=K.prepare(material,1,shape);

const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-8,message||`${a} != ${b}`);
assert.equal(model.slots.length,66);assert.equal(notches.length,39);
assert.equal(JSON.stringify(model),before,'milling cannot move semantic targets');
const fullAtlas=Depth.atlasRaster(notches.length,4096);
assert.ok(fullAtlas.scaleX>=3&&fullAtlas.scaleY>=3,'reading zoom keeps a dense 3x ink source');
assert.ok(fullAtlas.width*fullAtlas.height<2304*3420,'single-bank 3x ink costs less memory than the obsolete two-bank 2.25x atlas');
for(const count of [0,1,8,9,39,66])for(const limit of [512,1024,2048,3072,4096,8192]){
  const a=Depth.atlasRaster(count,limit),rows=Math.max(1,Math.ceil(count/8));
  assert.ok(Number.isInteger(a.width)&&Number.isInteger(a.height));
  assert.ok(a.width>0&&a.height>0&&a.width<=limit&&a.height<=limit);
  near(a.scaleX,a.width/(8*128));near(a.scaleY,a.height/(rows*152));
}
const section={side:'right',lo:0,hi:model.totalDepth,point:(s,u,y)=>prepared.pagePoint('right',s,u,y)};
const envelopes=notches.flatMap(n=>n.indices.map((index,j)=>{
  const slot=model.slots[index],glyph=Depth.labelGlyph(n,slot.label);
  const frame=Depth.labelFrame(n,section,1),v=.5+(j-(n.indices.length-1)/2)*.69/n.indices.length;
  const chars=[...slot.label].length;
  near(glyph.width*n.labelWidth/chars,glyph.height*n.labelHeight,'each em is square in leaf units: no anisotropic compensation');
  assert.ok(glyph.width>0&&glyph.width<1&&glyph.height>0&&glyph.height<1);
  assert.ok(v-glyph.height/2>0&&v+glyph.height/2<1,'glyph must stay on its single paper leaf');
  for(const u of [.5-glyph.width/2,.5+glyph.width/2])for(const vv of [v-glyph.height/2,v+glyph.height/2]){
    assert.ok((2*u-1)**2+(2*vv-1)**2<1,'glyph em envelope fits the physical ellipse');
    const {rx,ry}=Depth.labelInkEllipse;
    assert.ok(((u-.5)/rx)**2+((vv-.5)/ry)**2<.99,
      `${slot.label}: atlas clipping cuts a glyph corner even though the paper mesh is large enough`);
  }
  near(slot.anchorDepth,Math.floor(books[index].first/2)/model.totalSheets*model.totalDepth,'66 navigation targets keep true openings');
  near(n.carrierDepth,model.slots[model.groups[slot.group].first].anchorDepth,'one group uses its first leaf, not notch centre');
  return {n,index,label:slot.label,chars,glyph,v,frame};
}));
const inspectionPoints=[prepared.pagePoint('right',0,1,352),prepared.pagePoint('right',model.totalDepth,1,352),
  ...envelopes.flatMap(e=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>e.frame.point(.5+x*e.glyph.width/2,e.v+y*e.glyph.height/2)))];
const inspectionView=Scene.inspectionFraming(inspectionPoints);
const summaries=[];
for(const view of [{w:320,h:568},{w:390,h:844},{w:430,h:932},{w:1280,h:720}]){
  const camera=Scene.sample(1,{zoom:1,cx:480,cy:352},view,.4,null,0,material,inspectionView);
  const raster=Depth.rasterRegion({...view,camera},3);
  const densityX=raster.px/raster.w/camera.scale,densityY=raster.py/raster.h/camera.scale;
  const boxes=envelopes.map(e=>{
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{
      const p=Scene.project(e.frame.point(.5+x*e.glyph.width/2,e.v+y*e.glyph.height/2));
      return {x:p.x*camera.scale+camera.x,y:p.y*camera.scale+camera.y};
    });
    const x0=Math.min(...corners.map(p=>p.x)),x1=Math.max(...corners.map(p=>p.x));
    const y0=Math.min(...corners.map(p=>p.y)),y1=Math.max(...corners.map(p=>p.y));
    const width=x1-x0,height=y1-y0,charWidth=width/e.chars,aspect=charWidth/height;
    assert.ok(charWidth>=11,`${view.w}: ${e.label} is squeezed to ${charWidth} CSS px per character`);
    assert.ok(height>=13,`${view.w}: ${e.label} is only ${height} CSS px high`);
    assert.ok(aspect>=.70,`${view.w}: ${e.label} is excessively condensed (${aspect})`);
    assert.ok(x0>=0&&x1<=view.w,`${view.w}: ${e.label} extends outside viewport`);
    const sourceX=124*e.glyph.width*fullAtlas.scaleX,sourceY=148*e.glyph.height*fullAtlas.scaleY;
    const sourceRatio=Math.min(sourceX/(width*densityX),sourceY/(height*densityY));
    assert.ok(sourceRatio>=1,`${view.w}: ${e.label} magnifies source ink (${sourceRatio})`);
    return {...e,x0,x1,y0,y1,charWidth,height,aspect,sourceRatio};
  });
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oy=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
    assert.ok(ox<=0||oy<=0,`${view.w}: ${a.label} and ${b.label} ink envelopes overlap`);
  }
  summaries.push({width:view.w,height:view.h,minCharacterWidth:Math.min(...boxes.map(b=>b.charWidth)),
    minGlyphHeight:Math.min(...boxes.map(b=>b.height)),minAspect:Math.min(...boxes.map(b=>b.aspect)),
    minSourceSampling:Math.min(...boxes.map(b=>b.sourceRatio))});
}
console.log(JSON.stringify({bookCount:envelopes.length,carrierCount:notches.length,atlas:fullAtlas,views:summaries}));
