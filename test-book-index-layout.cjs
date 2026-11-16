/* Pure semantic-index tests; physical touch/compositing belongs to index tests. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Layout=require('./book-index-layout.js'),Paper=require('./paper-layout.js'),Source=require('./data/bible-source.js');
const edition=Paper.paginate(Source),books=edition.books,count=edition.pages.length;
const model=Layout.geometry(books,count),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('all 66 books remain in canonical order in 39 variable-size groups',()=>{
  assert.equal(model.slots.length,66);assert.equal(model.groups.length,39);
  assert.deepEqual(model.groups.flatMap(g=>g.indices),Array.from({length:66},(_,i)=>i));
  assert.deepEqual(model.groups.flatMap(g=>g.codes),Source.books.map(b=>b.code));
  assert.equal(new Set(model.groups.flatMap(g=>g.indices)).size,66);
  assert.equal(model.groups.filter(g=>g.testament==='old').length,23);
  assert.equal(model.groups.filter(g=>g.testament==='new').length,16);
  assert.deepEqual(model.groups.filter(g=>g.codes.includes('EZR'))[0].codes,['EZR','NEH']);
  assert.deepEqual(model.groups.filter(g=>g.codes.includes('AMO'))[0].codes,['AMO','OBA','JON']);
  assert.deepEqual(model.groups.filter(g=>g.codes.includes('1JN'))[0].codes,['1JN','2JN','3JN','JUD']);
});
test('four tracks contain 11 + 12 + 11 + 5 cuts with top resets and a short final track',()=>{
  assert.deepEqual(Layout.tracks.map(t=>model.groups.filter(g=>g.track===t.id).length),[11,12,11,5]);
  for(const id of ['ot-a','ot-b','nt-a']){
    const rows=model.groups.filter(g=>g.track===id);near(rows[0].notch.y,56);near(rows.at(-1).notch.y,648);
    rows.slice(1).forEach((g,i)=>near(g.notch.y-rows[i].notch.y,(648-56)/(rows.length-1)));
  }
  const final=model.groups.filter(g=>g.track==='nt-b'),main=model.groups.filter(g=>g.track==='nt-a');
  final.forEach((g,i)=>near(g.notch.y-main[i].notch.y,Layout.FINAL_TRACK_OFFSET));
  assert.ok(final.at(-1).notch.y<Layout.HEIGHT*.46,'last five rows must not stretch to the bottom');
});
test('true sheet depth derives only from each book opening and the actual page count',()=>{
  model.slots.forEach((slot,i)=>{
    assert.equal(slot.sheet,Math.floor(books[i].first/2));
    near(slot.anchorDepth,slot.sheet/Math.ceil(count/2)*36);
    assert.equal(slot.physical.width,18);assert.ok([18,12,8].includes(slot.physical.height));
    assert.ok(slot.physical.x>=0&&slot.physical.x+slot.physical.width<=36);
    assert.ok(slot.physical.y>=0&&slot.physical.y+slot.physical.height<=704);
  });
  const group=model.groups.find(g=>g.codes.includes('EZR'));
  assert.notEqual(model.slots[group.indices[0]].anchorDepth,model.slots[group.indices[1]].anchorDepth);
});
test('39 whole stamps each have one carrier leaf independent from all 66 navigation targets',()=>{
  for(const group of model.groups){
    const first=model.slots[group.first];
    assert.equal(group.carrierSheet,first.sheet);near(group.carrierDepth,first.anchorDepth);
    assert.equal(group.carrierSheet,Math.floor(books[group.first].first/2));
    for(const i of group.indices)near(model.slots[i].anchorDepth,Math.floor(books[i].first/2)/model.totalSheets*model.totalDepth);
  }
  const group=model.groups.find(g=>g.codes.includes('1JN')),split=group.carrierDepth+model.totalDepth/model.totalSheets;
  assert.ok(group.carrierDepth<split);
  assert.ok(model.slots[group.indices.at(-1)].anchorDepth>split,'a later member can navigate across the carrier side');
  assert.ok(model.groups.find(g=>g.codes.includes('REV')).carrierDepth>split,'Revelation remains on its own later carrier');
});

test('changing pagination or paper depth updates each anchor without regrouping books',()=>{
  const shifted=books.map(b=>({...b,first:b.first+4,last:b.last+4}));
  const next=Layout.geometry(shifted,count+8,48);
  next.slots.forEach((slot,i)=>{
    assert.equal(slot.sheet,Math.floor(shifted[i].first/2));
    near(slot.anchorDepth,slot.sheet/Math.ceil((count+8)/2)*48);
    assert.deepEqual(slot.physical.y,model.slots[i].physical.y);
  });
  assert.deepEqual(next.groups.map(g=>g.codes),model.groups.map(g=>g.codes));
  next.groups.forEach(g=>{assert.equal(g.carrierSheet,next.slots[g.first].sheet);near(g.carrierDepth,next.slots[g.first].anchorDepth);});
});
test('one/two/dense groups use 18/12/8px targets inside their own recess',()=>{
  for(const group of model.groups){
    const members=group.indices.map(i=>model.slots[i]),n=members.length,height=n===1?18:n===2?12:8;
    assert.equal(group.notch.radius,Math.max(13,n*height/2+1));
    assert.ok(group.notch.span>0,'even a boundary carrier retains its real half-leaf stop');
    assert.ok(group.notch.cutStart>=0&&group.notch.cutStart<=group.carrierDepth);
    const pitch=model.totalDepth/model.totalSheets,track=Layout.tracks.findIndex(t=>t.id===group.track);
    const definition=Layout.tracks[track],row=definition.groups.findIndex(codes=>codes[0]===books[group.first].code);
    const nextCode=Layout.tracks[track+1]?.groups[Math.min(row,Layout.tracks[track+1].groups.length-1)][0]||definition.groups[row+1]?.[0];
    const nextBook=books.find(b=>b.code===nextCode),cap=nextBook?Math.floor(nextBook.first/2)*pitch:group.carrierDepth+pitch*.5;
    near(group.notch.cutEnd,Math.min(model.totalDepth,Math.max(group.carrierDepth+pitch*.5,Math.min(cap,group.carrierDepth+160*pitch))));
    assert.ok(group.notch.cutEnd>group.carrierDepth,'the physical interval exposes the reverse of the same carrier');
    assert.ok(group.notch.cutEnd-group.carrierDepth<=160*pitch+1e-8,'reverse support is counted in actual sheets, not font units');
    near(group.notch.depth,(group.notch.cutStart+group.notch.cutEnd)/2);
    near(group.notch.span,(group.notch.cutEnd-group.notch.cutStart)/2);
    members.forEach((slot,i)=>{
      assert.equal(slot.group,group.index);assert.equal(slot.groupRow,i);
      assert.equal(slot.physical.height,height);
      assert.ok(slot.physical.y>=group.notch.y-group.notch.radius);
      assert.ok(slot.physical.y+height<=group.notch.y+group.notch.radius);
      near(slot.anchorDepth,slot.sheet/model.totalSheets*model.totalDepth); // Navigation depth is not the physical cut centre.
      if(i)near(slot.physical.y-members[i-1].physical.y,height);
    });
    near((members[0].physical.y+members.at(-1).physical.y+height)/2,group.notch.y);
  }
  assert.equal(model.groups.find(g=>g.codes.includes('1JN')).notch.radius,17);
});
test('physical type sizes fit Unicode abbreviations without changing digital geometry',()=>{
  model.slots.forEach((slot,i)=>{
    assert.equal(slot.label,books[i].short||[...books[i].name].slice(0,2).join(''));
    near(slot.fontSize,Math.min(10,slot.physical.height*.72,(slot.physical.width-1.8)/[...slot.label].length));
  });
  const fixtures=Layout.geometry([
    {name:'不用这个全称',short:'𠮷',first:0},
    {name:'𠮷甲乙',first:2},
    {name:'全称',short:'三字名',first:4}
  ],6).slots;
  assert.deepEqual(fixtures.map(s=>s.label),['𠮷','𠮷甲','三字名']);
  near(fixtures[0].fontSize,10);near(fixtures[1].fontSize,8.1);near(fixtures[2].fontSize,5.4);
});
test('digital individual targets preserve the established dimensions and order',()=>{
  model.slots.forEach((slot,i)=>assert.deepEqual(slot.digital,{x:23+(i%2)*221,y:91+Math.floor(i/2)*70,width:212,height:64}));
  assert.equal(model.digitalHeight,91+33*70+38);
});
test('known partial book fixtures retain their semantic tracks and testament',()=>{
  const subset=[books[15],books[39],books[65]],small=Layout.geometry(subset,count);
  assert.deepEqual(small.groups.map(g=>g.codes),[['NEH'],['MAT'],['REV']]);
  assert.deepEqual(small.slots.map(s=>s.index),[0,1,2]);
  assert.deepEqual(small.slots.map(s=>s.testament),['old','new','new']);
  assert.deepEqual(small.slots.map(s=>s.track),['ot-b','nt-a','nt-b']);
});
test('unknown or reordered inputs use a deterministic one-book-per-group fallback',()=>{
  for(const fixture of [[{name:'A',first:0,last:1},{name:'B',first:2,last:3}],[books[39],books[0]],[books[0],books[0]]]){
    const a=Layout.geometry(fixture,4),b=Layout.geometry(fixture,4);
    assert.deepEqual(a,b);assert.equal(a.mode,'fallback-single');
    assert.equal(a.groups.length,fixture.length);assert.deepEqual(a.groups.flatMap(g=>g.indices),[0,1]);
    assert.ok(a.slots.every(s=>Number.isFinite(s.anchorDepth)&&Number.isFinite(s.physical.y)));
  }
});
test('empty/single inputs and shallow or invalid numeric dimensions remain finite',()=>{
  assert.equal(Layout.geometry([]).slots.length,0);assert.equal(Layout.geometry([]).groups.length,0);
  const single=Layout.geometry([{name:'single',first:-2,last:0}],NaN,.25);
  assert.equal(single.slots.length,1);assert.equal(single.slots[0].sheet,0);assert.equal(single.slots[0].physical.width,.25);
  assert.ok(Number.isFinite(single.slots[0].fontSize)&&single.slots[0].fontSize>0);
  const invalid=Layout.geometry([{code:'GEN',first:Infinity}],Infinity,Infinity);
  assert.ok(Number.isFinite(invalid.totalSheets)&&Number.isFinite(invalid.totalDepth));
  assert.throws(()=>Layout.geometry(null),/array of books/);
});
test('module is pure, supports browser loading, and uses no captured photographic/page coordinates',()=>{
  const frozen=books.map(b=>Object.freeze({...b}));assert.doesNotThrow(()=>Layout.geometry(Object.freeze(frozen),count));
  const context={window:{}};const script=fs.readFileSync(__dirname+'/book-index-layout.js','utf8');
  vm.runInNewContext(script,context);assert.ok(context.window.PaperBookIndexLayout);
  assert.equal(context.window.PaperBookIndexLayout.geometry(books,count).groups.length,39);
  assert.doesNotMatch(script,/10713|\.jpg|\.png|photoCenter|pdfPage|displayPage/);
  assert.deepEqual(Layout.groupBooks(books,count),model.groups);
});
console.log(`PASS ${checks} pure book-index layout checks; ${count} current runtime pages (informational only)`);
