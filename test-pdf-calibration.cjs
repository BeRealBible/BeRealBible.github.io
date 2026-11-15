/* PDF sample regressions, not a production page-position table.
 * Sources: Genesis PDF 9-11, Psalms PDF 533, Colossians PDF 1176.
 * Full-book page totals are deliberately not an optimisation target here.
 */
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const L=require('./paper-layout.js'),E=require('./paper-edition.js');
const S=require(path.resolve(__dirname,process.env.PAPER_SOURCE_PATH||'data/bible-source.js'));
const D=L.paginate(S),C=L.constants,checks=[];
const close=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} != ${b}`);
const body=r=>r.runs.filter(t=>t.kind==='body').map(t=>t.text).join('');
const withVerse=r=>r.runs.filter(t=>t.kind!=='chapter').map(t=>t.text).join('');
function check(name,fn){try{fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});}}
function bookRows(code){
  const book=D.books.find(b=>b.code===code),result=[];
  for(let p=book.first;p<=book.last;p++)D.pages[p].cols.forEach((column,ci)=>column.forEach(row=>{
    result.push({row,page:p,column:ci,slot:Math.round((row.y-C.BODY_FIRST_BASELINE)/C.LINE_HEIGHT),
      ordinal:p*C.BODY_LINES*2+ci*C.BODY_LINES+Math.round((row.y-C.BODY_FIRST_BASELINE)/C.LINE_HEIGHT)});
  }));
  return result;
}
check('normal 36-slot and opening 32-slot common grids',()=>{
  assert.equal(C.BODY_LINES,36);assert.equal(C.OPENING_RESERVED_LINES,4);
  close(C.LINE_HEIGHT/C.BODY_SIZE,60/41.25,'line pitch / body em');
  close(C.BOTTOM_BASELINE,C.BODY_FIRST_BASELINE+35*C.LINE_HEIGHT,'last normal baseline');
  close(C.BOOK_HEADING_BASELINE,C.BODY_FIRST_BASELINE+4*C.LINE_HEIGHT,'opening reserves four rows');
  assert.equal(Math.round((C.BOTTOM_BASELINE-C.BOOK_HEADING_BASELINE)/C.LINE_HEIGHT)+1,32);
});
check('16-em columns, 2-em gap, mirrored outer/inner margins',()=>{
  close(C.COLUMN_WIDTH,16*C.CELL,'column width');
  const left=C.COLUMN_X_LEFT,right=C.COLUMN_X_RIGHT;
  close(left[1]-left[0]-C.COLUMN_WIDTH,2*C.CELL,'left gutter');
  close(right[1]-right[0]-C.COLUMN_WIDTH,2*C.CELL,'right gutter');
  close(left[0],C.PAGE_WIDTH-right[1]-C.COLUMN_WIDTH,'outer margins mirror');
  close(right[0],C.PAGE_WIDTH-left[1]-C.COLUMN_WIDTH,'inner margins mirror');
  close(left[0],2*right[0],'outer margin is twice inner margin');
});
check('GEN 2:23 four consecutive physical poem rows preserve semantic lines',()=>{
  const p=E.locate(D,'GEN','2:23');assert.equal(D.pages[p].displayPage,2);
  const rows=D.pages[p].cols[1],intro=rows.find(r=>!r.poetry&&r.start==='2:23');
  assert.ok(intro,'speech introduction remains prose');assert.equal(body(intro),'那人说：');
  const poem=rows.filter(r=>r.poetry&&r.start==='2:23');
  assert.deepEqual(poem.map(body),['“这是我骨中的骨，','肉中的肉，','可以称她为女人，','因为她是从男人身上取出来的。”']);
  poem.forEach((r,i)=>close(r.y,intro.y+(i+1)*C.LINE_HEIGHT,'consecutive semantic poem rows'));
});
check('GEN 2:23 introduction matches printed page 2 right-column grid position',()=>{
  const p=E.locate(D,'GEN','2:23');assert.equal(D.pages[p].displayPage,2);
  const intro=D.pages[p].cols[1].find(r=>!r.poetry&&r.start==='2:23');
  assert.ok(intro,'speech introduction is in the right column');
  close(intro.y,C.BODY_FIRST_BASELINE+13*C.LINE_HEIGHT,'intro occupies the fourteenth normal-page slot');
});
check('GEN 3:16 first spoken poetic phrase is not wrapped unnecessarily',()=>{
  const rows=bookRows('GEN').filter(x=>x.row.poetry&&x.row.start==='3:16').map(x=>x.row);
  const phrase='“我必多多加增你怀胎的苦楚，';
  assert.ok(rows.some(r=>body(r)===phrase),'opening quote plus final comma fit using punctuation bearings, without squashing glyphs');
});
check('JOB 22:3 long poetic phrase wraps before the final question',()=>{
  const rows=bookRows('JOB').filter(x=>x.row.poetry&&x.row.start==='22:3').map(x=>x.row);
  assert.deepEqual(rows.slice(0,2).map(body),['你为人公义，岂叫全能者喜悦','呢？'],
    'ordinary final question punctuation must not over-compress a long poetic line');
});
check('COL 1:1-2 first five body rows match the printed opening sample',()=>{
  const book=D.books.find(b=>b.code==='COL');
  const rows=D.pages[book.first].cols[0].filter(r=>r.kind==='body').slice(0,5);
  assert.deepEqual(rows.map(withVerse),[
    '奉　神旨意，作基督耶稣使徒','的保罗和兄弟提摩太，2写信',
    '给歌罗西的圣徒，在基督里有忠心的','弟兄。愿恩惠、平安从　神我们的父','归与你们！'
  ]);
});
check('PSA 23 preserves the superscription before the chapter numeral',()=>{
  const rows=bookRows('PSA'),at=rows.findIndex(x=>x.row.runs.some(t=>t.kind==='chapter'&&t.text==='23'));
  assert.ok(at>0);
  const rubric=rows[at-1];assert.ok(rubric.row.rubric,'superscription has its own semantic row');
  assert.equal(body(rubric.row),'（大卫的诗。）','canonical parentheses and punctuation remain unchanged');
  assert.equal(rows[at].ordinal-rubric.ordinal,1,'rubric is immediately before the first scripture row');
});
check('PSA 23 stanza gaps before verses 4 and 5 use one common blank row',()=>{
  const rows=bookRows('PSA');
  for(const v of [4,5]){
    const at=rows.findIndex(x=>x.row.kind==='body'&&!x.row.rubric&&x.row.start===`23:${v}`);
    assert.ok(at>0);assert.equal(rows[at-1].row.end,`23:${v-1}`);
    assert.equal(rows[at].ordinal-rows[at-1].ordinal,2,`one blank row before PSA 23:${v}`);
  }
});
check('all canonical scripture characters remain byte-for-byte unchanged',()=>{
  const original=S.books.flatMap(b=>b.chapters.flatMap(c=>c.verses.map(v=>v[1]))).join('');
  const rendered=D.pages.flatMap(p=>p.cols.flatMap(c=>c.flatMap(r=>r.runs.filter(t=>t.kind==='body').map(t=>t.text)))).join('');
  assert.equal(rendered,original);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'c58c99e4d877c5fb7ce06d2312f615f6a3198e91ea3184e2b0b5c53fadde01a3');
  assert.equal([...original].length,1073197);
});
console.log(JSON.stringify({pdfCalibration:checks.every(c=>c.passed)?'passed':'failed',pagesInformationalOnly:D.pages.length,checks}));
if(checks.some(c=>!c.passed))process.exitCode=1;
