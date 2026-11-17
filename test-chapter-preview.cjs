'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const Preview=require('./chapter-preview.js');
const source=require('./data/bible-source.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const cp=value=>Array.from(value);
const norm=value=>value.replace(/\s+/gu,' ').trim();
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const before=hash(source);freeze(source);const lookup=Preview.create(source);
test('every one of 66 books and 1189 chapters is a literal source opening with a 54-code-point ceiling',()=>{
  assert.equal(source.books.length,66);let chapters=0,clipped=0;
  for(const book of source.books)for(const chapter of book.chapters){
    chapters++;const actual=lookup(book.code,chapter.chapter);assert.ok(actual,`${book.code} ${chapter.chapter}`);
    const opening=chapter.verses.slice(0,2).map(v=>({number:v[0],text:norm(v[1])}));
    const selected=cp(opening[0].text).length>=40?opening.slice(0,1):opening;
    const expected=selected.map(v=>v.text).join(''),points=cp(expected);
    assert.ok(cp(actual.text).length<=54);assert.equal(actual.truncated,points.length>54);
    assert.equal(actual.text,points.length>54?points.slice(0,53).join('')+'…':expected);
    const range=selected.length===1?String(selected[0].number):`${selected[0].number}–${selected[1].number}`;
    assert.equal(actual.reference,`${chapter.chapter}:${range}`);
    if(actual.truncated)clipped++;
  }
  assert.equal(chapters,1189);assert.ok(clipped>0);assert.equal(hash(source),before);
});
test('actual known source samples are found by canonical code, not book or chapter array position',()=>{
  const reversed={books:source.books.slice().reverse().map(book=>({code:book.code,chapters:book.chapters.slice().reverse()}))};
  const byCode=Preview.create(reversed);
  for(const [code,chapter]of [['GEN',1],['JHN',1],['PHM',1],['2JN',1],['PSA',150]])assert.deepEqual(byCode(code,chapter),lookup(code,chapter));
  assert.ok(lookup('GEN',1).text.startsWith('起初 神创造天地。'));assert.ok(lookup('JHN',1).text.startsWith('太初有道'));
  assert.deepEqual(lookup(' gen ','1'),lookup('GEN',1));assert.deepEqual(lookup('PSA','150'),lookup('PSA',150));
});
test('one short verse, two short verses and the 40-code-point selection boundary are precise',()=>{
  assert.deepEqual(Preview.previewChapter({chapter:1,verses:[[1,'应当欢呼。']]}),{text:'应当欢呼。',reference:'1:1',truncated:false});
  assert.deepEqual(Preview.previewChapter({chapter:3,verses:[[1,'甲。'],[2,'乙！'],[3,'不得加入。']]}),{text:'甲。乙！',reference:'3:1–2',truncated:false});
  assert.equal(Preview.previewChapter({chapter:7,verses:[[1,'甲'.repeat(40)],[2,'不应加入']]}).reference,'7:1');
  assert.equal(Preview.previewChapter({chapter:7,verses:[[1,'甲'.repeat(39)],[2,'乙']]}).reference,'7:1–2');
});
test('first-verse clipping references only that verse, second-verse clipping references both',()=>{
  const first=Preview.previewChapter({chapter:5,verses:[[1,'甲'.repeat(80)],[2,'乙'.repeat(40)]]});
  assert.deepEqual(first,{text:'甲'.repeat(53)+'…',reference:'5:1',truncated:true});
  const second=Preview.previewChapter({chapter:5,verses:[[1,'甲'.repeat(20)],[2,'乙'.repeat(80)]]});
  assert.deepEqual(second,{text:'甲'.repeat(20)+'乙'.repeat(33)+'…',reference:'5:1–2',truncated:true});
  assert.equal(Preview.previewChapter({chapter:5,verses:[[1,'甲'.repeat(54)]]}).truncated,false);
});
test('Unicode code points are not split and source punctuation plus the divine-name space are retained',()=>{
  const unicode=Preview.previewChapter({chapter:1,verses:[[1,'𠀀😀'.repeat(40)]]});
  assert.equal(cp(unicode.text).length,54);assert.equal(unicode.text,cp('𠀀😀'.repeat(40)).slice(0,53).join('')+'…');
  assert.deepEqual(Preview.previewChapter({chapter:2,verses:[[1,'  起初　　神创造天地。\n他说：“光！”\t阿们。  ']]}),{text:'起初 神创造天地。 他说：“光！” 阿们。',reference:'2:1',truncated:false});
});
test('missing or malformed content returns null and never substitutes invented scripture',()=>{
  for(const query of [['BAD',1],['GEN',0],['GEN',51],['PHM',2],['PSA',151],['GEN',1.5],['GEN','1:1'],[null,1],['GEN',true]])assert.equal(lookup(...query),null);
  for(const input of [null,{}, {chapter:1,verses:[]},{chapter:1,verses:[[1,' '],[2,'']]},{chapter:1,verses:[[1,null]]}])assert.equal(Preview.previewChapter(input),null);
  assert.equal(Preview.create(null)('GEN',1),null);
  assert.deepEqual(Preview.previewChapter({chapter:2,verses:[[1,''],[2,'真实第二节。'],[3,'不能偷取第三节。']]}),{text:'真实第二节。',reference:'2:2',truncated:false});
  assert.equal(Preview.previewChapter({chapter:2,verses:[[1,'甲。'],[3,'乙。']]}).reference,'2:1,3');
});
test('markup-like source is literal text, with no HTML parsing, stripping or invented escaping',()=>{
  const literal='<img src=x onerror=alert(1)> & <script>字</script>';
  const result=Preview.previewChapter({chapter:1,verses:[[1,literal]]});
  assert.equal(result.text,literal);assert.equal(result.reference,'1:1');
  const code=fs.readFileSync(path.join(__dirname,'chapter-preview.js'),'utf8');assert.ok(!/\.innerHTML\s*=|DOMParser|createElement/.test(code));
});
test('startup indexing does not read or copy verse text and leaves the source mutable to its owner',()=>{
  let verseReads=0;const row={chapter:4,get verses(){verseReads++;return [[1,'原始正文。']];}};
  const local={books:[{code:'TST',chapters:[row]}]},get=Preview.create(local);
  assert.equal(verseReads,0);assert.deepEqual(get('TST',4),{text:'原始正文。',reference:'4:1',truncated:false});assert.ok(verseReads>0);assert.equal(Object.isFrozen(local),false);
  assert.equal(hash(source),before);
});
test('browser UMD global produces the same result as CommonJS exports',()=>{
  const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'chapter-preview.js'),'utf8'),context);
  const actual=context.window.PaperChapterPreview.create(source)('GEN',1);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),lookup('GEN',1));
});
console.log(JSON.stringify({chapterPreviewScenarios:checks,books:66,chapters:1189,maxCodePoints:54,sourceUnchanged:hash(source)===before}));
