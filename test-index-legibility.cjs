const assert=require('node:assert/strict');
const K=require('./book-kinematics.js'),Scene=require('./book-scene.js'),Depth=require('./book-depth.js');
const Material=require('./book-material.js'),Solid=require('./book-solid.js');
const span=36+K.WIDTH*2*Math.sin(K.EDGE_SWEEP/2),pageCount=1246;
const m0=Material.compute(0,pageCount),m1=Material.compute(1244,pageCount);
const state={edgeInspection:true},dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const mid={zoom:1,cx:480,cy:352};
let viewCount=0;
for(const view of [{w:320,h:568},{w:390,h:844},{w:430,h:932},{w:1280,h:720}]){
  const camera=Scene.sample(1,mid,view,.4,null,0,m1,{inspectionBand:span});
  const closed=(s,u,y)=>K.pagePoint('right',s,u,y,m0,1,state);
  const x=s=>Scene.project(closed(s,1,352)).x*camera.scale+camera.x;
  assert.ok(x(0)>=8&&x(36)<=view.w-8,'show whole splayed paper band without horizontal crop');
  const old=Scene.sample(1,mid,view,.4,null,0,m1);
  const oldX=s=>Scene.project(K.pagePoint('right',s,1,352,m0,1)).x*old.scale+old.x;
  assert.ok(x(36)-x(0)>(oldX(36)-oldX(0))*2.8,'a magnified 36-unit strip cannot expose enough usable ink');
  for(const s of [0,4,16,21,33,36]){
    const root=closed(s,0,268),tip=closed(s,1,268);
    assert.equal(root.x,480+s-18,'same unscaled binding width');
    assert.ok(Math.abs(dist(root,tip)-480)<1e-9,'tip rotated, page not enlarged');
    assert.equal(dist(tip,K.pagePoint('left',s,1,268,m1,1,state)),0,'closed splay stays fixed across changing opening split');
    assert.equal(dist(K.pagePoint('right',s,.95,268,m0,0,state),K.pagePoint('right',s,.95,268,m0,0)),0,'normal reading and original fan unaffected');
  }
  const rgba=Depth.rasterRegion({...view,camera},3);
  assert.ok(rgba.px*rgba.py<=3600000&&rgba.px<=4096&&rgba.py<=4096,'bounded phone drawing buffer');
  const needed=[-camera.x/camera.scale,-camera.y/camera.scale,(view.w-camera.x)/camera.scale,(view.h-camera.y)/camera.scale];
  const R=Solid.RASTER;
  assert.ok(rgba.x<=Math.max(-R.LEFT,needed[0])&&rgba.y<=Math.max(-R.TOP,needed[1]));
  assert.ok(rgba.x+rgba.w>=Math.min(R.WIDTH-R.LEFT,needed[2])&&rgba.y+rgba.h>=Math.min(R.HEIGHT-R.TOP,needed[3]));
  // The region changes pixel budget, not the mathematical projection. Its
  // CSS inverse perspective makes world points coincide with DOM hit targets.
  for(const point of [closed(13,.98,258),closed(33,1,358),{x:480,y:352,z:-4}]){
    const q=Scene.project(point),p=1-R.BACK/R.PERSPECTIVE;
    const x=R.CX+(rgba.x+(q.x-rgba.x)-R.CX)*p,y=R.CY+(rgba.y+(q.y-rgba.y)-R.CY)*p;
    const again=Scene.project({x,y,z:R.BACK});
    assert.ok(Math.abs(again.x-q.x)<1e-9&&Math.abs(again.y-q.y)<1e-9);
  }
  if(view.w<600){
    assert.ok(rgba.px/rgba.w/camera.scale>2.4,'phone close-up retains a high density under the pixel cap');
    assert.ok(rgba.px/rgba.w>Depth.rasterRegion(null,3).px/Solid.RASTER.WIDTH*2.5);
  }
  viewCount++;
}
let previous=K.pagePoint('left',0,1,360,m1,.7,state);
for(let i=1;i<=300;i++){
  const next=K.pagePoint('left',0,1,360,m1,.7+i/1000,state);
  assert.ok(dist(next,previous)<2,'tip opening changes continuously into inspection');
  previous=next;
}
console.log(JSON.stringify({viewCount,closedInspectionBand:span,rasterPixelCap:3600000,closedSplitInvariant:true}));
