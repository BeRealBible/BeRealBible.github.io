'use strict';
const assert=require('node:assert/strict');
const {buildAvailability,createAvailability,createIndex,chapterOf,paperCueLine,chapterCountBox,describeSelection,noteStarts,formatNoteCopy}=require('./v25/study-qa.js');
const fs=require('node:fs'),path=require('node:path');
const library=require('./data/study-qa.json');
const bible=require('./data/bible-source.js');
const verses=new Map(bible.books.map(b=>[b.code,new Map(b.chapters.map(c=>[c.chapter,new Set(c.verses.map(v=>v[0]))]))]));
const catalog=createIndex(library);
const embedded=JSON.parse(fs.readFileSync(path.join(__dirname,'index.html'),'utf8')
  .match(/id="study-qa-availability" type="application\/json">([^<]*)<\/script>/)[1]);
assert.deepEqual(embedded,buildAvailability(library),'the lightweight index matches the published question library');
const availability=createAvailability(embedded);
assert.equal(library.items.filter(row=>row.id.startsWith('2SA.')).length,176);
assert.ok(library.items.length>=2000);
assert.equal(library.items.filter(row=>row.id.startsWith('1KI.')&&row.primary).length,169);
for(const {id,q,a,refs,primary} of library.items){
  const [b,c]=id.split('.');
  assert.ok(primary?.length||refs.some(r=>r[0]===b&&r[1]===+c),'unreviewed QAPs retain a local fallback');
  assert.doesNotMatch(q+'\n'+a,/(?:LLM_QA_|AI 研读记录|^以下是为(?:您|你)精心)/m);
  for(const [book,ch,lo,hi] of [...refs,...(primary||[])]){
    const vv=verses.get(book)?.get(ch);
    assert.ok(vv&&((lo==null&&hi==null)||(vv.has(lo)&&vv.has(hi)&&lo<=hi)), id+' invalid coordinate');
  }
}
for(const [book,chapters] of verses)for(const [ch,vv] of chapters){
  assert.equal(availability.has(book,ch),catalog.has(book,ch),book+'.'+ch);
  assert.equal(availability.chapterCount(book,ch),catalog.query([{code:book,ch}]).length,book+'.'+ch+' distinct questions');
  for(const v of vv)assert.equal(availability.has(book,ch,v),catalog.has(book,ch,v),book+'.'+ch+':'+v);
}
const query=objects=>catalog.query(objects).map(x=>x.id);
const inChapter=(code,ch)=>({code,ch});
const one=(code,ch,lo,hi=lo)=>({code,ch,lo,hi});
assert.ok(query([one('1KI',7,15)]).includes('1KI.7.2'),'15–22 anchors to just the starting verse');
assert.ok(!query([one('1KI',7,16,22)]).includes('1KI.7.2'));
assert.ok(query([inChapter('1KI',10)]).includes('1KI.10.6'),'14–29 anchors to the chapter title');
assert.ok(!query([one('1KI',10,14,29)]).includes('1KI.10.6'));
assert.ok(query([one('1KI',16,7)]).includes('1KI.15.8'),'a cited chapter can be the only actual subject');
assert.ok(!query([inChapter('1KI',15)]).includes('1KI.15.8'));
assert.ok(!query([one('1KI',14,10,11)]).includes('1KI.16.7'),'evidence for the objection is not a primary anchor');
assert.equal(query([one('1KI',4,26),one('2CH',9,25)]).filter(id=>id==='1KI.4.5').length,1);
assert.ok(query([one('1KI',4,26)]).includes('1KI.4.5'),'a numerical comparison belongs at both passages');
assert.ok(query([one('2CH',9,25)]).includes('1KI.4.5'));
assert.ok(query([one('2SA',2,23)]).includes('2SA.3.4'),'cross-chapter narrative connection');
assert.ok(query([one('2SA',3,28)]).includes('2SA.3.4'));
assert.equal(query([one('2SA',3,28),one('2SA',2,23)]).filter(id=>id==='2SA.3.4').length,1);
assert.ok(query([inChapter('2SA',3),inChapter('2SA',4)]).some(id=>id.startsWith('2SA.4.')));
assert.ok(!query([one('2SA',3,1)]).includes('2SA.3.4'),'do not fill unselected verses');
assert.ok(query([inChapter('2SA',3)]).includes('2SA.3.4'));
assert.ok(query([one('DEU',17,17)]).includes('2SA.3.2'),'cross-book lookup');
assert.ok(query([one('2SA',14,27)]).includes('2SA.18.6'));
assert.ok(catalog.has('2SA',3)&&catalog.has('2SA',3,28));
const empty=one('2SA',4,1),withQuestion=one('2SA',3,1);
assert.ok(!availability.hasAny([empty]));
assert.ok(availability.hasAny([empty,withQuestion]));
assert.ok(availability.hasAny([inChapter('2SA',4)]));
assert.ok(!availability.hasAny([inChapter('OBA',1)]));
const startFixture=createAvailability(buildAvailability({items:[{refs:[['EXO',4,2,30],['EXO',5,13,18]]}]}));
assert.ok(startFixture.has('EXO',4,29)&&!startFixture.hasStart('EXO',4,29),'middle verses remain findable but unmarked');
assert.ok(startFixture.hasStart('EXO',4,2)&&startFixture.hasStart('EXO',5,13));
const spanFixture={anchorObjects:[['EXO',4,2,5,30],['EXO',5,13,13],['EXO',6]],refs:[['EXO',4,2,31],['EXO',5,1,30],['EXO',5,13,13],['EXO',6]]};
assert.deepEqual(noteStarts([spanFixture],'EXO',4),[2]);
assert.deepEqual(noteStarts([spanFixture],'EXO',5),[13],'a cross-chapter continuation is not a fresh cue');
assert.deepEqual(noteStarts([spanFixture],'EXO',6),[],'a whole-chapter note belongs to the chapter counter');
const {create:cite}=require('./v25/citation-links.js'),{create:scriptureFor}=require('./v25/scripture.js'),refs=require('./v25/note-refs.js');
const scripture=scriptureFor(bible),parser=refs.create({...cite(bible),scripture});
const diverse=parser.parse('诗篇119章；诗篇117:1；约3:35–4:2');
const body='第一段\n\n'+Array(110).fill('我的笔记🙂').join('');
const [bodyCopy,...quoted]=formatNoteCopy(body,diverse,{scripture,parser,label:a=>refs.label(scripture.index(a.code).book.name,a)}).split(/\n\n(?=诗篇|约翰福音)/u);
assert.equal(bodyCopy,body);
assert.equal(quoted.length,3);
for(const [i,part] of quoted.entries()){
  const anchor=diverse[i],text=[...parser.segments(anchor).flatMap(({ch,lo,hi=lo})=>scripture.index(anchor.code).chunks.find(c=>c.chapter===ch).rows
    .filter(row=>lo==null||lo<=row.hi&&hi>=row.lo)).map(row=>row.text).join('')];
  assert.equal(part.split('\n')[1],text.slice(0,50).join('')+(text.length>50?'…':''));
}
assert.deepEqual(
  [createAvailability(buildAvailability({items:[{refs:[['2SA',4]]}]})).has('2SA',4),
   createAvailability(buildAvailability({items:[{refs:[['2SA',4]]}]})).has('2SA',4,1)],
  [true,false],'chapter-only notes do not enable a verse selection'
);
assert.equal(chapterOf('heading','4:1'),null,'a section caption next to the first verse is not a chapter control');
assert.equal(chapterOf('chapter','4:1'),4);
assert.equal(chapterOf('heading','4:3'),null);
assert.equal(chapterOf('body','4:1'),null);
const digit={x:20,y:40,w:12,h:23},unrelated={x:38,y:64,w:10,h:12};
assert.deepEqual(paperCueLine(digit,[digit,unrelated]),{x1:20.8,x2:31.2,y:64.65});
assert.equal(paperCueLine(digit,[{x:20,y:64,w:12,h:10}]),null,'do not draw a cue over the next line of ink');
assert.equal(paperCueLine(digit,[{x:20,y:64.5,w:12,h:10}]).y,63.9,'use a closer cue when the gap is tight but safe');
const box=chapterCountBox(digit,[digit,unrelated]);
assert.ok(box&&box.x+box.w<digit.x,'both counts fit at the left of the chapter number');
const singleBox=chapterCountBox(digit,[digit,unrelated],1,1);
assert.ok(singleBox.h<box.h&&Math.abs(singleBox.y+singleBox.h/2-(digit.y+digit.h*.51))<1,'a single positive count is centered on the chapter number');
assert.ok(singleBox.hit.x+singleBox.hit.width<digit.x,'blank-space hit enlargement cannot swallow the chapter numeral');
assert.equal(chapterCountBox(digit,[{x:0,y:0,w:18,h:90}]),null,'an occupied gutter is not overwritten');
const selection=describeSelection([inChapter('2SA',4),one('2SA',3,6),one('2SA',3,1),one('2SA',3,2),one('2SA',4,7)],bible.books);
assert.equal(selection.title,'撒下 3:1–2、6、4章');
assert.equal(selection.fullTitle,'撒母耳记下 3:1–2、6、4章');
assert.equal(selection.key,'2SA.3:1-2|2SA.3:6-6|2SA.4');
assert.equal(describeSelection([inChapter('2SA',4),inChapter('2SA',3)],bible.books).title,'撒下 3–4章');
assert.equal(describeSelection([one('2SA',3,1)],bible.books).title,'撒下 3:1');
console.log('PASS QAP structure, canonical coordinates, non-contiguous selection, and cross-book/chapter lookup');
