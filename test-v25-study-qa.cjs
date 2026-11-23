'use strict';
const assert=require('node:assert/strict');
const {createIndex,chapterOf,describeSelection}=require('./v25/study-qa.js');
const library=require('./data/study-qa.json');
const bible=require('./data/bible-source.js');
const verses=new Map(bible.books.map(b=>[b.code,new Map(b.chapters.map(c=>[c.chapter,new Set(c.verses.map(v=>v[0]))]))]));
const catalog=createIndex(library);
assert.equal(library.items.filter(row=>row.id.startsWith('2SA.')).length,176);
assert.ok(library.items.length>=2000);
for(const {id,q,a,refs} of library.items){
  const [b,c]=id.split('.');
  assert.ok(refs.some(r=>r[0]===b&&r[1]===+c),'every QAP has a local anchor');
  assert.doesNotMatch(q+'\n'+a,/(?:LLM_QA_|AI 研读记录|^以下是为(?:您|你)精心)/m);
  for(const [book,ch,lo,hi] of refs){
    const vv=verses.get(book)?.get(ch);
    assert.ok(vv&&((lo==null&&hi==null)||(vv.has(lo)&&vv.has(hi)&&lo<=hi)), id+' invalid coordinate');
  }
}
const query=objects=>catalog.query(objects).map(x=>x.id);
const inChapter=(code,ch)=>({code,ch});
const one=(code,ch,lo,hi=lo)=>({code,ch,lo,hi});
assert.ok(query([one('2SA',2,23)]).includes('2SA.3.4'),'cross-chapter narrative connection');
assert.ok(query([one('2SA',3,28)]).includes('2SA.3.4'));
assert.equal(query([one('2SA',3,28),one('2SA',2,23)]).filter(id=>id==='2SA.3.4').length,1);
assert.ok(query([inChapter('2SA',3),inChapter('2SA',4)]).some(id=>id.startsWith('2SA.4.')));
assert.ok(!query([one('2SA',3,1)]).includes('2SA.3.4'),'do not fill unselected verses');
assert.ok(query([inChapter('2SA',3)]).includes('2SA.3.4'));
assert.ok(query([one('DEU',17,17)]).includes('2SA.3.2'),'cross-book lookup');
assert.ok(query([one('2SA',14,27)]).includes('2SA.18.6'));
assert.ok(catalog.has('2SA',3)&&catalog.has('2SA',3,28));
assert.equal(chapterOf('heading','4:1'),4);
assert.equal(chapterOf('chapter','4:1'),4);
assert.equal(chapterOf('heading','4:3'),null);
assert.equal(chapterOf('body','4:1'),null);
const selection=describeSelection([inChapter('2SA',4),one('2SA',3,6),one('2SA',3,1),one('2SA',3,2),one('2SA',4,7)],bible.books);
assert.equal(selection.title,'撒下 3:1–2、6、4章');
assert.equal(selection.fullTitle,'撒母耳记下 3:1–2、6、4章');
assert.equal(selection.key,'2SA.3:1-2|2SA.3:6-6|2SA.4');
assert.equal(describeSelection([inChapter('2SA',4),inChapter('2SA',3)],bible.books).title,'撒下 3–4章');
assert.equal(describeSelection([one('2SA',3,1)],bible.books).title,'撒下 3:1');
console.log('PASS QAP structure, canonical coordinates, non-contiguous selection, and cross-book/chapter lookup');
