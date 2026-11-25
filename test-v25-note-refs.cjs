'use strict';
const assert=require('node:assert/strict'),source=require('./data/bible-source.js');
const {create:cite}=require('./v25/citation-links.js'),{create:read}=require('./v25/scripture.js');
const {create,key,describe:describeNote,encode,decode}=require('./v25/note-refs.js'),{describeSelection,createReferenceIndex}=require('./v25/study-qa.js');
const {createStore}=require('./v25/notes.js');
const scripture=read(source),{bookCode,bookMatches}=cite(source),parser=create({bookCode,bookMatches,scripture});
const keys=(s,options)=>parser.parse(s,options)?.map(key)??null;
const suggestions=s=>parser.suggest(s).flatMap(row=>row.anchors.map(key));
assert.deepEqual(suggestions('路'),['LUK.1:1-1']);
assert.deepEqual(suggestions('路加'),['LUK.1:1-1']);
assert.deepEqual(suggestions('创世纪'),['GEN.1:1-1']);
for(const [value,suffix,ref] of [['创世纪',' 1:1','GEN.1:1-1'],['创世','记 1:1','GEN.1:1-1'],['创世纪 ','1:1','GEN.1:1-1'],
  ['创世记 2',':1','GEN.2:1-1'],['创世记第2章','1节','GEN.2:1-1'],['路２：','1','LUK.2:1-1']]){
  assert.equal(parser.completion(value),suffix);assert.deepEqual(keys(value+suffix),[ref]);
}
for(const value of ['撒母耳','路99','路99:','路2:31','王中2:3','爱是恒久忍耐','创1:2–'])assert.equal(parser.completion(value),'',value);
const located=value=>parser.locateOne(value).map(row=>[key(row.anchors[0]),!!row.partial]);
assert.deepEqual(located('创世'),[['GEN.1:1-1',false]],'a valid incomplete book completion is a unique address');
assert.deepEqual(located('路２：'),[['LUK.2:1-1',false]]);
assert.deepEqual(located('王上1:15–20'),[['1KI.1:15-20',false]],'one continuous range counts as one address');
assert.deepEqual(located('创1:1，创1:3'),[],'a comma cannot turn the one-address locator into a batch');
assert.ok(located('撒母耳').length>1&&located('撒母耳').every(([,partial])=>partial),'ambiguous book matches are only candidates');
const locked=value=>{const result=parser.preselect(value);return result&&key(result.ref);};
assert.equal(locked('何西阿2'),null,'a displayed ghost is not a preselection');
assert.equal(parser.completion('何西阿2'),':1');
for(const end of [' ','　',',','，','。','；','"','”','」'])assert.equal(locked('何西阿2'+end),'HOS.2',end);
assert.equal(locked('“何西阿2”'),'HOS.2');
assert.equal(locked('何西阿2:1,'),'HOS.2:1-1');
assert.equal(locked('王上1:53–2:3。'),'1KI.1:53-2:3');
assert.equal(key(parser.preselect('何西阿2:1',{accepted:true}).ref),'HOS.2:1-1');
for(const input of ['创造，','何西阿2: ','何西阿99，','创1:1，创2:1。','撒母耳，'])assert.equal(locked(input),null,input);
assert.deepEqual(suggestions('《路加福音》'),['LUK.1:1-1']);
assert.deepEqual(suggestions('路2'),['LUK.2:1-1']);
assert.deepEqual(parser.suggest('路2')[0].chapter,{code:'LUK',ch:2});
assert.deepEqual(parser.suggest('路2',{editing:true})[0].anchors,[{code:'LUK',ch:2}]);
assert.deepEqual(suggestions('路2:3'),['LUK.2:3-3']);
assert.deepEqual(suggestions('路2:31'),['LUK.2:31-31']);
assert.deepEqual(suggestions('路２：３１'),['LUK.2:31-31']);
for(const value of ['2', '路2:', '路2:99', '路99', '王中2:3', '爱是恒久忍耐']){
  assert.deepEqual(suggestions(value),[],value+' never falls back to another location');
}
for(const book of source.books){
  const ch=book.chapters[0],n=ch.verses[0][0];
  for(const alias of [book.name,book.short,book.code]){
    assert.deepEqual(keys(alias+' '+ch.chapter+'：'+n+'。'),[book.code+'.'+ch.chapter+':'+n+'-'+n]);
  }
}
for(const raw of ['列王记上1:15-20','王上1：15到20节','王上1：15至20节','《列王紀上》第１章15至20節','1 Kings 1:15–20']){
  assert.deepEqual(keys(raw),['1KI.1:15-20'],raw);
}
assert.deepEqual(keys('王上1；'),['1KI.1']);
assert.deepEqual(keys('王上1:15，王上1:16; 王上2:'+'1.'),['1KI.1:15-15','1KI.1:16-16','1KI.2:1-1']);
assert.deepEqual(keys('王上1:15\n王上1:16。',{pasted:true}),['1KI.1:15-15','1KI.1:16-16']);
assert.equal(keys('王中1:15\n王上1:16。',{pasted:true}),null);
for(const raw of ['王中1:15','王上0:1','王上1:0','王上23','王上1:15-999','王上1:55','王上1:20-15','王上1:15到','王上1:15 至 999 节','王上1:15，王中1:15','创1:1, 999']){
  assert.equal(keys(raw,{pasted:true}),null,raw);
}
const copied=scripture.quote([{code:'1KI',ref:'1:15'},{code:'1KI',ref:'1:20'},{code:'JHN',ref:'3:16'}]);
assert.deepEqual(keys(copied+'。',{pasted:true}),['1KI.1:15-15','1KI.1:20-20','JHN.3:16-16']);
assert.deepEqual(keys('王上1:15 王年纪老迈。',{pasted:true}),['1KI.1:15-15']);
assert.deepEqual(keys('这里是内容。—— 王上1:15。',{pasted:true}),['1KI.1:15-15']);
assert.deepEqual(keys('这里是内容（列王记上1:15）。',{pasted:true}),['1KI.1:15-15']);
assert.equal(keys('仅有经文文字，未附出处。',{pasted:true}),null);
assert.equal(keys('内容（列王记上1:15-999）',{pasted:true}),null);
assert.deepEqual(parser.locations(parser.exact('王上1')),[{code:'1KI',ref:'1:1',whole:true}]);
const refs=parser.parse('王上1:15，王上1:16，王上1，王上1:15'),describe=(refs,separate)=>describeSelection(refs,source.books,{separate});
assert.deepEqual(describe(refs,false).objects.map(key),['1KI.1']);
assert.deepEqual(describe(refs,true).objects.map(key),['1KI.1','1KI.1:15-15','1KI.1:16-16']);
const data=new Map(),storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
const store=()=>createStore({storage,scope:'test',describe:refs=>describe(refs,true),createIndex:createReferenceIndex});
const desc={...describe(refs,true),noteId:'N:1'};
assert.ok(store().write(desc,'原来写的笔记'));
assert.deepEqual(store().get(desc.noteId).refs,[['1KI',1],['1KI',1,15,15],['1KI',1,16,16]],'separate objects survive a fresh store');
assert.equal(store().query([{code:'1KI',ch:1}]).length,1,'separate objects do not duplicate a note');
for(const raw of ['列王纪上第一章五十三节至第二章三节','王上1:53-2:3','王上１：５３～２：３','王上1章53节到王上2章3节','王上1:53 — 2:3']){
  assert.deepEqual(keys(raw+'。'),['1KI.1:53-2:3'],raw);
}
assert.deepEqual(keys('诗篇第一百零一篇'),['PSA.101']);
assert.deepEqual(keys('约壹第三章十六节'),['1JN.3:16-16']);
assert.deepEqual(keys('王上1:15～20节'),['1KI.1:15-20']);
for(const raw of ['王上2:3-1:53','王上1:54至2:3','王上1:53至2:999','王上1:53至3:0','王上1:53至王下2:3','王上1:53至第二章','王上1:53~2:','王上1:53到到2:3']){
  assert.equal(keys(raw),null,raw);
}
const span=parser.exact('1:53~2:3','1KI');
const picked=(raw,options)=>parser.mergeSelection(parser.parse(raw),options).map(key);
assert.deepEqual(picked('路2:14；路2:12；路2:13；路2:16；路2:16'),['LUK.2:12-14','LUK.2:16-16']);
assert.deepEqual(picked('路2:12-13；路2:13-14；路2'),['LUK.2','LUK.2:12-14']);
assert.deepEqual(picked('王上2:1；王上1:53'),['1KI.1:53-2:1']);
assert.deepEqual(picked('王上2:1；王上1:53',{crossChapter:false}),['1KI.1:53-53','1KI.2:1-1']);
assert.deepEqual(picked('王上22:53；王下1:1'),['1KI.22:53-53','2KI.1:1-1']);
assert.deepEqual(parser.subtractSelection(parser.exact('路2:12-14'),parser.exact('路2:13')).map(key),['LUK.2:12-12','LUK.2:14-14']);
assert.deepEqual(parser.subtractSelection(span,parser.exact('王上2:1')).map(key),['1KI.1:53-53','1KI.2:2-3']);
assert.deepEqual(encode(span),['1KI',1,53,2,3]);
assert.deepEqual(decode(encode(span)),span);
assert.deepEqual(parser.locations(span),[{code:'1KI',ref:'1:53'},{code:'1KI',ref:'2:1-3'}]);
assert.deepEqual(parser.locations(parser.exact('创世记一章三十一节~三章二节')),
  [{code:'GEN',ref:'1:31'},{code:'GEN',ref:'2:1-25'},{code:'GEN',ref:'3:1-2'}]);
const describeSpans=objects=>describeNote(objects,source.books,parser,refs=>describe(refs,true));
const grouped={...describeSpans([span,...refs]),noteId:'N:2'};
const storeSpans=()=>createStore({storage,scope:'spans',describe:describeSpans,createIndex:createReferenceIndex});
assert.ok(storeSpans().write(grouped,'跨章的笔记'));
assert.deepEqual(storeSpans().get(grouped.noteId).anchorObjects,grouped.anchorObjects);
assert.equal(storeSpans().query([{code:'1KI',ch:2,lo:2}])[0].id,grouped.noteId);
assert.equal(storeSpans().query([{code:'1KI',ch:2,lo:4}]).length,0);
console.log('PASS all 66 book aliases, exact chapters/verses, strict validation, pasted quotations and independent note anchors');
