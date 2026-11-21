'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./v25/compare'),H=require('./v25/history'),S=require('./text-selection');
const Source=require('./data/bible-source'),Passages=require('./footnote-passages'),find=require('./v25/search').catalogue;
const window={};vm.runInNewContext(fs.readFileSync(require.resolve('./v25-original-data'),'utf8'),{window,atob});
const db=window.V25OriginalData;
const library=require('./v25/scripture').create(Source,{...db,get(){throw Error('Must not read print ink');}});
const load=n=>{const k=Math.floor(n/32);db.installPack(k,require('./paper-pages/'+db.packs[k]));};
const events=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const genesis=(ref,page=10)=>({bookCode:'GEN',bookName:'创世记',ref,page});
test('the canonical reader resolves by address, not print bytes or split fragments',()=>{
  const locs=[{page:10,ref:'2:1'},{page:9,ref:'1:31'},{page:10,ref:'1:31'}];
  const [a,b]=library.from(locs,true),gene=Source.books.find(b=>b.code==='GEN');
  assert.equal(library.groups([a,b]).length,1);
  assert.deepEqual([a.ref,b.ref],['1:31','2:1']);
  const first=gene.chapters[0].verses.find(([n])=>n===31)[1],second=gene.chapters[1].verses[0][1];
  assert.equal(library.quote(locs),first+'\n( 创世记 1:31 和合本 )\n\n'+second+'\n( 创世记 2:1 和合本 )');
  assert.equal(library.groups(library.from([{page:9,ref:'1:29'},{page:10,ref:'2:1'}],true)).length,2);
});
test('the reported Genesis selection uses four chapters and only two intra-chapter omissions',()=>{
  const input=['45:3','44:19','43:28','42:15','44:7','43:16','43:28'].map(ref=>({code:'GEN',ref}));
  const source=Source.books.find(b=>b.code==='GEN');
  const exact=ref=>{
    const [chapter,verse]=ref.split(':').map(Number);
    return source.chapters.find(ch=>ch.chapter===chapter).verses.find(entry=>entry[0]===verse)[1];
  };
  assert.deepEqual(library.quote(input).split('\n\n'),[
    exact('42:15')+'\n( 创世记 42:15 和合本 )',
    exact('43:16')+'...'+exact('43:28')+'\n( 创世记 43:16,28 和合本 )',
    exact('44:7')+'...'+exact('44:19')+'\n( 创世记 44:7,19 和合本 )',
    exact('45:3')+'\n( 创世记 45:3 和合本 )'
  ]);
  const locs=[{code:'GEN',ref:'1:1'},{code:'GEN',ref:'1:2'},{code:'EXO',ref:'1:1'}];
  assert.match(library.quote(locs),/\( 创世记 1:1-2 和合本 \)\n\n[^\n]+\n\( 出埃及记 1:1 和合本 \)$/);
});
test('a combined range uses its one real body; direct search by an alias finds it too',()=>{
  const a=library.resolve({code:'GEN',ref:'24:29-30'})[0];
  assert.equal(a,library.resolve({code:'GEN',ref:'24:30'})[0]);
  assert.equal(a.display,'24:29–30');
  assert.equal(library.quote([{code:'GEN',ref:'24:30'}]),a.text+'\n( 创世记 24:29-30 和合本 )');
  const search=find(Source,db.lookup,library);
  assert.equal(search('创 24:30')[0].text,a.text);
});
test('library supplies verse paragraphs, short titles and noncontiguous citation groups',()=>{
  const a=library.resolve({code:'GEN',ref:'1:1'})[0];
  assert.deepEqual(a.titles,['神的创造']);assert.equal(a.paragraph,true);
  const note=Passages.byOrdinal(958,1);
  const groups=library.groups(library.from(Passages.resolve(note.citation,Source)));
  assert.deepEqual(groups.map(g=>g[0].code),['EXO','LEV','DEU']);
  const g=library.index('GEN');
  assert.equal(g.chunks.length,50);
  assert.ok(g.chunks[1].rows.every(r=>r.ch===2&&r.code==='GEN'));
  assert.ok(new Set(g.chunks[2].rows.map(r=>r.page)).size>1,'one chapter may cover multiple printed pages');
  assert.equal(library.index('JUD').chunks.length,1);
});
test('continuous scrolling keeps neighboring chunks and evicts only the far side',()=>{
  assert.deepEqual(C.windowRange(0,0,-1,4),{lo:0,hi:0});
  assert.deepEqual(C.windowRange(0,0,1,4),{lo:0,hi:1});
  assert.deepEqual(C.windowRange(0,1,1,4),{lo:0,hi:2});
  assert.deepEqual(C.windowRange(0,2,1,4),{lo:1,hi:3});
  assert.deepEqual(C.windowRange(1,3,-1,4),{lo:0,hi:2});
  assert.deepEqual(C.windowRange(2,4,1,4),{lo:2,hi:4});
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
