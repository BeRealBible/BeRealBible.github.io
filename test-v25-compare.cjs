'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./v25/compare'),H=require('./v25/history'),S=require('./text-selection');
const window={};vm.runInNewContext(fs.readFileSync(require.resolve('./v25-original-data'),'utf8'),{window,atob});
const db=window.V25OriginalData;
const load=n=>{const k=Math.floor(n/32);db.installPack(k,require('./paper-pages/'+db.packs[k]));};
const events=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const genesis=(ref,page=10)=>({bookCode:'GEN',bookName:'创世记',ref,page});
test('quoted range may span pages and chapters, but it cannot skip a verse or mix books',()=>{
  const a=C.rangeFor(db,[{page:10,ref:'2:1'},{page:9,ref:'1:31'},{page:10,ref:'1:31'}]);
  assert.deepEqual({book:a.bookCode,from:a.from,to:a.to},{book:'GEN',from:1031,to:2001});
  assert.equal(C.rangeFor(db,[{page:9,ref:'1:29'},{page:10,ref:'2:1'}]),null);
  assert.equal(C.rangeFor(db,[{page:9,ref:'1:31'},{page:61,ref:'1:1'}]),null);
});
test('float renders reviewed print fragments, not headings or chapter-number glyphs',()=>{
  load(9);load(10);
  const rows=n=>C.rowsFor(db,n,db.get(n)[3],S.clipboardText);
  assert.equal(rows(9).at(-1).ref,'1:31');
  assert.equal(rows(10)[0].ref,'1:31');
  assert.equal(rows(10).find(r=>r.ref==='2:1').text,'天地万物都造齐了。');
});
test('cross-page copy stitches the selected split verse only once in canonical order',()=>{
  const first=db.lookup('ACT','7:56'),last=first+1;load(first);load(last);
  function face(index,groups){
    const page=db.pages[index],bookName=db.books[page.b].name;
    const {units}=S.indexFace(page,db.get(index)[3].map((w,j)=>({...db.tags(index)[j],text:w[4],physicalInk:true})));
    return {page,index,bookName,units,selected:new Map(units.filter(u=>groups.includes(u.group)).map(u=>[u.id,u]))};
  }
  const a=face(first,['verse:7:55','verse:7:56']),b=face(last,['verse:7:56']);
  const quote=S.pagesClipboardQuote([b,a],db);
  assert.equal(quote,S.physicalClipboardQuote([...a.selected.values()],a.bookName,a.units,db,first));
  assert.match(quote,/7:55-56/);
});
test('main and float update one chapter row and keep the main active record independent',()=>{
  const storage=events(),model=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  const one=model.start(genesis('1:1',9)); model.visitFloat(genesis('1:5',9));
  const three=model.jump(genesis('3:1'));const two=model.visitFloat(genesis('2:1'));
  assert.equal(model.current(),three.id);
  assert.deepEqual(model.list().map(r=>r.id),[two.id,three.id,one.id]);
  const overlap=model.visitFloat(genesis('3:5'));
  assert.equal(overlap.id,three.id);assert.equal(overlap.anchor.ref,'3:5');assert.equal(model.current(),three.id);
  assert.deepEqual(model.list().map(r=>r.id),[three.id,two.id,one.id]);
  const mainNext=model.advance(genesis('4:6',12));assert.equal(model.current(),mainNext.id);
  model.pin(one.id,true);model.visitFloat(genesis('2:8'));
  assert.equal(model.list()[0].id,one.id);assert.equal(model.list()[1].id,two.id);
  model.remove(three.id);model.visitFloat(genesis('3:9'));model.undo();
  assert.equal(model.list().filter(r=>r.anchor.ref.startsWith('3:')).length,1);
  assert.ok(storage.getItem(H.COMPARE_KEY));assert.equal(storage.getItem(H.KEY),null);
});
test('new branch imports old history without rewriting it and merges duplicates and pins',()=>{
  const storage=events(),old=H.createModel({storage,pageCount:1272});
  const one=old.jump(genesis('1:1',9));old.pin(one.id,true);const recent=old.jump(genesis('1:3',9));
  const before=storage.getItem(H.KEY);
  const model=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  assert.equal(model.list().length,1);assert.equal(model.list()[0].id,recent.id);assert.equal(model.list()[0].pinned,true);
  assert.equal(model.list()[0].anchor.ref,'1:3');assert.equal(storage.getItem(H.KEY),before);
});
