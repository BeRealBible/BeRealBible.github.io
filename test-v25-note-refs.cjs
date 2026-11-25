'use strict';
const assert=require('node:assert/strict'),source=require('./data/bible-source.js');
const {create:cite}=require('./v25/citation-links.js'),{create:read}=require('./v25/scripture.js');
const {create,key}=require('./v25/note-refs.js'),{describeSelection,createReferenceIndex}=require('./v25/study-qa.js');
const {createStore}=require('./v25/notes.js');
const scripture=read(source),parser=create({bookCode:cite(source).bookCode,scripture});
const keys=(s,options)=>parser.parse(s,options)?.map(key)??null;
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
console.log('PASS all 66 book aliases, exact chapters/verses, strict validation, pasted quotations and independent note anchors');
