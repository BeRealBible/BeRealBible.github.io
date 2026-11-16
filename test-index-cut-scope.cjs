/* Material cut scope is independent of glyph size and the reading camera.
 * These tests exercise real K/Leaves and the app's SVG clipping function;
 * they do not stand in for WebGL pixel or physical-device visual checks. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Depth=require('./book-depth.js'),K=require('./book-kinematics.js'),Leaves=require('./book-leaves.js');
const Material=require('./book-material.js'),Layout=require('./book-index-layout.js'),Packet=require('./book-packet.js');
const {books,pages}=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const model=Layout.geometry(books,pages.length),notches=Depth.milling(model),sheetDepth=model.totalDepth/model.totalSheets;
const mat=spread=>Material.compute(spread,pages.length,books),eps=1e-8;
let scopeChecks=0,agreementChecks=0,profileChecks=0,svgChecks=0,invarianceChecks=0,fontChecks=0,topologyChecks=0,syntheticChecks=0;
const near=(a,b,message,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} != ${b}`);
const isRev=n=>model.groups[n.group].codes.includes('REV');
const bookByCode=new Map(books.map(b=>[b.code,b]));
function expectedRange(group){
  const track=Layout.tracks.findIndex(t=>t.id===group.track);assert.ok(track>=0);
  let start=0;
  if(track>0){
    const previous=Layout.tracks[track-1],row=Math.min(group.trackRow,previous.groups.length-1);
    const first=bookByCode.get(previous.groups[row][0]);assert.ok(first);
    start=Math.floor(first.first/2)*sheetDepth;
  }
  const carrier=Math.floor(books[group.first].first/2)*sheetDepth;
  return {start,end:Math.min(model.totalDepth,carrier+sheetDepth*.5)};
}
// Keep the motivating regression first: old code must fail because its actual
// paper is cut, not merely because it lacks the new explicit range metadata.
for(const spread of [1228,1230,1244]){
  const m=mat(spread),active=[];
  for(const n of notches){
    const p=K.prepare(m,0,{notches:[n]});let affected=false;
    for(let sheet=m.leftSheets;sheet<model.totalSheets;sheet++){
      for(const fraction of [0,.5])for(const q of [-.5,0,.5]){
        const s=(sheet+fraction)*sheetDepth,value=p.edgeInset('right',s,n.y+q*n.radius);
        if(value>eps)affected=true;
        if(!isRev(n)||spread>1228)assert.equal(value,0,`${spread}: passed ${model.groups[n.group].codes.join('/')} still cuts remaining sheet ${sheet}`);
        scopeChecks++;
      }
    }
    if(affected)active.push(n.group);
  }
  if(spread===1228)assert.deepEqual(active,notches.filter(isRev).map(n=>n.group),'the first Revelation sheet retains only its own recess');
  else assert.deepEqual(active,[],'after the Revelation carrier, the remaining tail has no thumb recesses');
}
for(const n of notches){
  const group=model.groups[n.group],carrierSheet=Math.floor(books[group.first].first/2),end=(carrierSheet+1)*sheetDepth,expected=expectedRange(group);
  assert.ok(Number.isFinite(n.cutStart)&&Number.isFinite(n.cutEnd),'milled cuts declare their absolute material interval');
  assert.ok(n.cutStart>=-eps&&n.cutStart<=n.carrierDepth+eps,'a cut begins within the bound paper, no later than its carrier');
  assert.ok(n.cutEnd>n.cutStart&&n.cutEnd<=end+eps,'a cut cannot reach a sheet after its independently derived carrier');
  assert.ok(n.cutStart>=expected.start-eps,'the cut cannot start before its preceding-track material boundary');
  assert.ok(n.carrierDepth-n.cutStart<=100*sheetDepth+eps,'a cut has at most 100 real sheets of approach, never a font-sized tunnel');
  near(n.cutEnd,expected.end,'cut ends half a real sheet after its own carrier, before the next leaf');
  near(n.depth,(n.cutStart+n.cutEnd)/2,'mesh depth centre belongs to the material range, not font width');
  near(n.span,(n.cutEnd-n.cutStart)/2,'mesh support width is the actual cut interval');
  near(n.carrierDepth,carrierSheet*sheetDepth,'carrier depth still equals the real opening leaf');
  const state={notches:[n]},m=mat(0),p=K.prepare(m,0,state);
  for(let sheet=0;sheet<model.totalSheets;sheet++){
    const s=sheet*sheetDepth,afterCarrier=sheet>carrierSheet;
    for(const fraction of [0,.5])for(const q of [-.5,0,.5]){
      const depth=s+fraction*sheetDepth,y=n.y+q*n.radius,direct=K.edgeInset('right',depth,y,m,state),prepared=p.edgeInset('right',depth,y);
      near(direct,prepared,'direct and prepared cutter use identical fixed material scope');agreementChecks++;
      if(afterCarrier||depth<n.cutStart||depth>=n.cutEnd){assert.equal(direct,0,'no milling outside the absolute allowed material');scopeChecks++;}
      near(K.edgeInset('left',depth,y,m,state),direct,'side cannot change whether a fixed sheet was cut');agreementChecks++;
    }
    const profile=Leaves.edgeProfile('right',s,m,state),clip=Leaves.stripClip('right',s,0,480,m,state,profile);
    for(const v of profile.edge){near(v.inset,p.edgeInset('right',s,v.y),'printed silhouette agrees with the solid at every sampled height');profileChecks++;}
    if(afterCarrier||s<n.cutStart||s>=n.cutEnd){assert.equal(profile.max,0,'completed labels cannot leave cuts in later printed SVG pages');assert.equal(clip,'none');profileChecks++;}
    else if(profile.max>eps){assert.match(clip,/^polygon\(/,'an allowed physical recess also clips the printed leaf');profileChecks++;}
  }
  // Explicitly exercise interval boundaries; sheet starts alone can miss a
  // fractional overrun or a stale prepared-cutter range.
  for(const s of [Math.max(0,n.cutStart-1e-6),n.cutEnd,Math.min(model.totalDepth,n.cutEnd+1e-6)])
    if(s<n.cutStart||s>=n.cutEnd)for(const q of [-.5,0,.5]){
      assert.equal(p.edgeInset('right',s,n.y+q*n.radius),0);assert.equal(K.edgeInset('right',s,n.y+q*n.radius,m,state),0);scopeChecks+=2;
    }
}
// Mesh partitioning must include the same physical end caps. Correct CPU
// cuts alone are insufficient if a coarse triangle bridges across the limit.
const bands=Depth.topology(model.totalDepth,notches),knots=bands.flatMap(b=>[b.lo,b.hi]);
for(const n of notches){
  for(const boundary of [n.cutStart,n.cutEnd]){assert.ok(knots.some(s=>Math.abs(s-boundary)<1e-8),'milling topology includes each physical cut boundary');topologyChecks++;}
  for(const band of bands)if(band.lo>=n.cutEnd+1e-8||band.hi<=n.cutStart-1e-8){
    assert.ok(!band.cuts.includes(n),'an expired recess cannot own later mesh cells');topologyChecks++;
  }
}
// Exercise the real ordinary-reading SVG wrapper, without generating scripture
// glyphs: the stub Page only supplies a background; all clipping code is real.
const app=fs.readFileSync('app.js','utf8'),source=app.match(/  function svgPage\(p,index\)\{[\s\S]*?(?=\n  function paintPage)/)?.[0];
assert.ok(source,'the application still has a directly testable SVG clip wrapper');
const context={Page:{svg:()=>'<svg><defs></defs><rect width="480" height="704"/></svg>'},Material,D:{books,pages},notches,window:{PaperBookLeaves:Leaves}};
const svgPage=vm.runInNewContext('('+source+')',context);
for(let sheet=0;sheet<model.totalSheets;sheet++){
  const spread=sheet*2,m=mat(spread);
  for(const side of ['left','right']){
    const index=spread+(side==='right'?1:0);if(index>=pages.length)continue;
    const expected=Leaves.stripClip(side,m.leftDepth,0,480,m,{notches}),svg=svgPage(pages[index],index);
    if(expected==='none')assert.doesNotMatch(svg,/<clipPath\b/,'an uncut leaf cannot retain a stale SVG clipping mask');
    else{
      const actual=svg.match(/<polygon points="([^"]+)"/);assert.ok(actual,'an allowed solid cut must reach the actual ordinary SVG');
      assert.equal(actual[1],expected.slice(8,-1).replaceAll('px','').replaceAll(',',' '),'SVG uses the same material silhouette, without UI-side filtering');
    }
    svgChecks++;
  }
}
// Same absolute material point before/after moving the opening split, fanning,
// or closing: only its pose changes, never the shape of its cut.
for(const n of notches){
  const depths=[n.cutStart,(n.cutStart+n.cutEnd)/2,n.carrierDepth,n.cutEnd,Math.min(model.totalDepth,n.cutEnd+sheetDepth*.5)];
  for(const s of depths)for(const q of [-.5,0,.5]){
    const y=n.y+q*n.radius,reference=K.edgeInset('right',s,y,mat(0),{notches:[n]});
    for(const spread of [0,622,1228,1244])for(const close of [0,.5,1])for(const fan of [0,1]){
      const m=mat(spread),state={notches:[n],fanLeft:fan,fanRight:fan,edgeInspection:true},p=K.prepare(m,close,state);
      for(const side of ['left','right']){near(p.edgeInset(side,s,y),reference,'view/split/side cannot erase or invent a physical cut');invarianceChecks++;}
    }
  }
}
// Packet sampling may move a sheet into another side/section; its cut stays
// attached to its absolute material coordinate, in both directions.
for(const [from,to]of [[1182,1228],[1228,1182],[1228,1244],[1244,1228]]){
  const a=mat(from),b=mat(to),shape={notches,fanLeft:1,fanRight:1};
  for(const progress of [0,.25,.5,.75,1]){
    const packet=Packet.sample(a,b,progress,shape);
    for(let sheet=Math.min(a.leftSheets,b.leftSheets);sheet<Math.max(a.leftSheets,b.leftSheets);sheet++){
      const s=(sheet+.5)*sheetDepth,section=packet.sections.find(v=>s>=v.lo&&s<v.hi);assert.ok(section);
      for(const n of notches){const x=K.edgeInset(section.side,s,n.y,a,shape),y=K.edgeInset('right',s,n.y,b,{notches});near(x,y,'turning packets carry fixed cuts, not a screen-space filter');invarianceChecks++;}
    }
  }
}
// Presentation changes cannot allocate extra sheets to a thumb recess. The
// old glyph-width-derived span changes these ranges and must stay rejected.
for(const label of ['单','极长的书卷名称']){
  const altered={...model,slots:model.slots.map(s=>({...s,label,fontSize:s.fontSize*7,physical:{...s.physical,width:s.physical.width*4}})),viewport:{w:320,h:568,dpr:3}};
  const candidate=Depth.milling(altered);
  candidate.forEach((n,i)=>{near(n.cutStart,notches[i].cutStart,'font/viewport cannot move the first cut sheet');near(n.cutEnd,notches[i].cutEnd,'font/viewport cannot move the last cut sheet');fontChecks+=2;});
}
// Shared cutter contract, independent of the particular Bible data. Explicit
// material endpoints take precedence even if obsolete depth/span are huge.
const syntheticMaterial={totalDepth:36,leftDepth:17,rightDepth:19};
for(const n of [
  {cutStart:4,cutEnd:4.5,carrierDepth:4.4,depth:18,span:100},
  {cutStart:0,cutEnd:.025,carrierDepth:0,depth:8,span:100},
  {cutStart:35.95,cutEnd:36,carrierDepth:35.98,depth:20,span:100}
].map(n=>({...n,y:200,radius:15,inset:20,milled:true}))){
  assert.deepEqual(K.cutRange(n),[n.cutStart,n.cutEnd]);
  const state={notches:[n]},prepared=K.prepare(syntheticMaterial,.83,state);
  for(const s of [0,n.cutStart-1e-5,n.cutStart,(n.cutStart+n.carrierDepth)/2,n.carrierDepth,(n.carrierDepth+n.cutEnd)/2,n.cutEnd,n.cutEnd+1e-5,36]){
    if(s<0||s>36)continue;
    for(const q of [-1,-.7,0,.7,1]){
      const y=n.y+n.radius*q,direct=K.edgeInset('right',s,y,syntheticMaterial,state),cached=prepared.edgeInset('left',s,y);
      assert.ok(Number.isFinite(direct)&&direct>=0&&direct<=n.inset,'explicit-cut output stays finite and bounded');
      near(direct,cached,'synthetic explicit direct/cache agreement');
      if(s<n.cutStart||s>=n.cutEnd||Math.abs(q)===1)assert.equal(direct,0,'explicit endpoints and vertical extrema exclude material exactly');
      syntheticChecks++;
    }
    const profile=Leaves.edgeProfile('right',s,syntheticMaterial,state);
    if(s<n.cutStart||s>=n.cutEnd)assert.equal(profile.max,0,'explicit range overrides stale legacy width in the printed silhouette too');
  }
  assert.ok(K.edgeInset('right',n.carrierDepth,n.y,syntheticMaterial,state)>0,'the stop-page centre keeps a real recess, including the first bound leaf');
}
// A union of cavities removes the maximum available paper, not the sum, and
// one cavity cannot keep another alive after the latter reaches its stop.
const overlapping=[{cutStart:4,cutEnd:5,carrierDepth:4.8},{cutStart:4.5,cutEnd:5.5,carrierDepth:5.3}]
  .map((n,i)=>({...n,depth:0,span:100,y:240,radius:14,inset:17+i*4,milled:true}));
for(const s of [3.9,4,4.6,4.8,5,5.3,5.5,5.6])for(const q of [-.7,0,.7]){
  const y=240+14*q,individual=overlapping.map(n=>K.edgeInset('right',s,y,syntheticMaterial,{notches:[n]}));
  const combined=K.edgeInset('right',s,y,syntheticMaterial,{notches:overlapping});
  near(combined,Math.max(...individual),'overlapping material recesses form a max union');syntheticChecks++;
}
// Legacy callers which have no complete, finite range retain their historical
// symmetric shoulder formula. This is deliberately independent of cutProfile.
function legacyReference(n,s,y){
  const dy=(y-n.y)/n.radius,ds=(s-n.depth)/n.span;
  if(Math.abs(dy)>=1||Math.abs(ds)>=1)return 0;
  const vertical=Math.sqrt(1-dy*dy),flat=n.milled?.42:.7;
  const local=n.milled?ds/Math.max(.0001,vertical):ds;
  const q=Math.max(0,(Math.abs(local)-flat)/(1-flat));
  return n.inset*vertical*Math.sqrt(Math.max(0,1-q*q));
}
for(const milled of [false,true])for(const extra of [{},{cutStart:2},{cutEnd:4},{cutStart:NaN,cutEnd:4},{cutStart:'2',cutEnd:4}]){
  const n={depth:9,span:1.3,y:180,radius:13,inset:19,milled,...extra},state={notches:[n]},p=K.prepare(syntheticMaterial,1,state);
  assert.deepEqual(K.cutRange(n),[n.depth-n.span,n.depth+n.span]);
  for(const q of [-1.01,-1,-.84,-.7,-.42,0,.42,.7,.84,1,1.01])for(const v of [-1,-.6,0,.6,1]){
    const s=n.depth+n.span*q,y=n.y+n.radius*v,expected=legacyReference(n,s,y);
    near(K.edgeInset('right',s,y,syntheticMaterial,state),expected,'legacy direct cut keeps its old shoulder law');
    near(p.edgeInset('left',s,y),expected,'legacy prepared cut keeps its old shoulder law');syntheticChecks++;
  }
}
for(const [start,end]of [[5,5],[6,5]]){
  const n={cutStart:start,cutEnd:end,carrierDepth:5.5,y:220,radius:12,inset:20,depth:5,span:2};
  const p=K.prepare(syntheticMaterial,0,{notches:[n]});
  for(const s of [0,4.9,5,5.5,6,6.1,36]){
    assert.equal(K.edgeInset('right',s,220,syntheticMaterial,{notches:[n]}),0,'empty/reversed explicit material ranges cannot create holes');
    assert.equal(p.edgeInset('left',s,220),0);syntheticChecks++;
  }
}
console.log(JSON.stringify({scopeChecks,agreementChecks,profileChecks,svgChecks,invarianceChecks,fontChecks,topologyChecks,syntheticChecks,revelation:'1228: REV only; 1230/1244: no cuts'}));
