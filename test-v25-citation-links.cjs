'use strict';
const assert=require('node:assert/strict'),source=require('./data/bible-source.js');
const {create}=require('./v25/citation-links.js'),reader=create(source);
const fixture={code:'2SA',chapter:3};
const refs=(text,context=fixture)=>reader.scan(text,context).flatMap(x=>x.locations.map(l=>l.code+'.'+l.ref+(l.whole?'章':'')));
for(const b of source.books){
  const [first]=b.chapters,ref=first.chapter+':'+first.verses[0][0];
  for(const n of [b.name,b.short,b.code]){
    assert.deepEqual(refs(n+' '+ref,{}),[b.code+'.'+ref],n+' must resolve without QAP data or context');
  }
}
assert.deepEqual(refs('见《撒母耳記上》２８：６及第7节。'),['1SA.28:6','1SA.28:7']);
assert.deepEqual(refs('撒下2:15–17；3:1'),['2SA.2:15-17','2SA.3:1']);
assert.deepEqual(refs('《哥林多後書》第五章十七至十八節',{}),['2CO.5:17-18']);
assert.deepEqual(refs('依次看第2章、第4章和第6章'),['2SA.2:1章','2SA.4:1章','2SA.6:1章']);
assert.deepEqual(refs('约翰福音第3至4章和罗马书（8:28）'),['JHN.3:1章','JHN.4:1章','ROM.8:28']);
assert.deepEqual(refs('参创1:31—2:3及约7:53—8:11'),['GEN.1:31','GEN.2:1-3','JHN.8:1-11']);
assert.deepEqual(refs('2:1、5、10–12'),['2SA.2:1','2SA.2:5','2SA.2:10-12']);
assert.deepEqual(refs('創1:1；下一章和第5节。'),['GEN.1:1','2SA.4:1章','2SA.4:5']);
assert.deepEqual(refs('本章第7节；上一章第23節'),['2SA.3:7','2SA.2:23']);
assert.deepEqual(refs('诗篇第23篇；门6节；见 2 Samuel 9:7'),['PSA.23:1章','PHM.1:6','2SA.9:7']);
assert.deepEqual(refs('晚上8:30见。上午10:30到11点。比例为3:1。https://example.org/3:1 及第999章。'),[]);
assert.deepEqual(refs('前面已说过，但第4章则不同；参但7:13。'),['2SA.4:1章','DAN.7:13']);
assert.deepEqual(refs('😀请读《馬太福音》5:3。',{}),['MAT.5:3']);
const text='😀请读《馬太福音》5:3，还有**原文**。';
const [hit]=reader.scan(text);
assert.equal(text.slice(hit.start,hit.end),'《馬太福音》5:3');
assert.deepEqual(refs('无书卷上下文的 3:16',{}),[]);
console.log('PASS independent citation lexer: 66 books, names/aliases, local context, ranges and exclusions');
