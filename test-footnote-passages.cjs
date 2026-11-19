'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./footnote-passages'),source=require('./data/bible-source');
const read=(...parts)=>fs.readFileSync(path.join(__dirname,...parts),'utf8');
const M=JSON.parse(/const M=(.*?);\r?\n/s.exec(read('v25-original-data.js'))[1]);
assert.equal(F.seal,M.sha,'wrong original physical edition');
const packs=new Map();
function pageAt(n){
  const k=n>>5;if(!packs.has(k))packs.set(k,JSON.parse(read('paper-pages',M.packs[k])));
  return packs.get(k)[n&~1][n%2];
}
const pages=Array.from({length:1272},(_,n)=>F.notesForPage(n));
assert.equal(pages.filter(a=>a.length).length,125);
assert(pages.slice(0,953).every(a=>!a.length));
const notes=pages.flat();assert.equal(notes.length,287);
let count=0,max=0,multiBook=0,multiChapter=0;const seen=new Set();
for(const row of pages.filter(a=>a.length)){
  assert.deepEqual(row.map(n=>n.ordinal),row.map((_,i)=>i+1));
  for(const n of row){
    assert.equal(F.byOrdinal(n.page,n.ordinal),n);
    const pg=pageAt(n.page);
    for(const k of ['footerIndex','bodyIndex'])assert.equal(pg[3][n[k]][4],n.marker);
    assert.notEqual(n.footerIndex,n.bodyIndex);
    const resolved=F.passages(n,source);assert(resolved.length,n.citation);
    count+=resolved.length;max=Math.max(max,resolved.length);
    const books=new Set(resolved.map(r=>r.code)),chapters=new Set(resolved.map(r=>r.code+'.'+r.chapter));
    if(books.size>1)multiBook++;if(chapters.size>books.size)multiChapter++;
    for(const verse of resolved){
      const book=source.books.find(b=>b.code===verse.code),c=book.chapters.find(c=>c.chapter===verse.chapter);
      assert.equal(verse.name,book.name);assert.equal(verse.text,c.verses.find(v=>v[0]===verse.verse)[1]);
      seen.add(verse.code+'.'+verse.chapter+':'+verse.verse);
    }
  }
}
assert.deepEqual([count,seen.size,max,multiBook,multiChapter],[450,318,10,29,15]);
const ids=rows=>rows.map(r=>r.code+'.'+r.chapter+':'+r.verse);
const solve=s=>ids(F.resolve(s,source));
assert.deepEqual(solve('出3:5、7。'),['EXO.3:5','EXO.3:7']);
assert.deepEqual(solve('书15:6、61；18:22。'),['JOS.15:6','JOS.15:61','JOS.18:22']);
assert.deepEqual(solve('出16:4、15；尼9:15；诗78:24；105:40。'),['EXO.16:4','EXO.16:15','NEH.9:15','PSA.78:24','PSA.105:40']);
assert.deepEqual(solve('约翰福音 ３：３６—４：２。'),['JHN.3:36','JHN.4:1','JHN.4:2']);
assert.deepEqual(solve('撒上 21:6'),['1SA.21:6']);
const acts=F.byOrdinal(1095,1);assert.equal(acts.sourceRef,'ACT.8:33');assert.equal(acts.citation,'赛53:7、8。');
assert.deepEqual(ids(F.passages(acts,source)),['ISA.53:7','ISA.53:8']);
for(const bad of ['赛53:7；某书1:1。','赛53:7、999。','赛53:9—7。','1:2','赛53:1垃圾','参见前文','赛53:7、','赛53:7；8。']){
  assert.deepEqual(solve(bad),[],bad+': reject the entire unknown reference, do not improvise');
}
assert.deepEqual(F.passages(null,source),[]);assert.deepEqual(F.passages(acts,null),[]);
assert.equal(F.byOrdinal(1095,99),null);
console.log('Verified 287 notes on 125 PDF pages, 574 original circled markers and all 450 cited verses (318 distinct).');
