'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const passages=require('./footnote-passages'),{targets}=require('./v25-footnote-targets');
const meta=JSON.parse(/const M=(.*?);\r?\n/s.exec(fs.readFileSync(path.join(__dirname,'v25-original-data.js'),'utf8'))[1]);
assert.equal(meta.sha,passages.seal);
let count=0,printedPages=0;
for(const filename of Object.values(meta.packs)){
  const sheets=JSON.parse(fs.readFileSync(path.join(__dirname,'paper-pages',filename),'utf8'));
  for(const pair of Object.values(sheets))for(const p of pair){
    if(!p)continue;
    const notes=passages.notesForPage(p[0]),boxes=targets(p,notes);
    assert.equal(boxes.length,notes.length,'all and only independently verified footer citations match original ink on '+p[0]);
    if(notes.length)printedPages++;
    for(const [i,a] of boxes.entries()){
      assert.equal(a.note,notes[i]);
      const [x,y,w,h,marker]=p[3][a.note.footerIndex];
      assert.equal(marker,a.note.marker);
      assert.ok(x>=a.x&&y>=a.y&&x+w<=a.x+a.width&&y+h<=a.y+a.height);
      assert.ok(a.y>p[2]*.90&&a.x>=0&&a.x+a.width<=p[1]&&a.y+a.height<=p[2]);
      const host=p[3][a.note.bodyIndex];
      assert.ok(host[1]+host[3]<a.y,'body is not a footnote hotspot');
      for(const b of boxes.slice(i+1)){
        assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'overlap on '+p[0]);
      }
      count++;
    }
    if(p[0]===1095){
      assert.equal(notes[0].citation,'赛53:7、8。');
      assert.ok(boxes[0].x<=60&&boxes[0].x+boxes[0].width>=251,'includes the entire printed passage, including its trailing punctuation');
      assert.equal(targets(p,[{...notes[0],citation:'赛53:7。'}]).length,0,'do not associate the wrong passage');
      assert.equal(targets(p,[{...notes[0],footerIndex:notes[0].bodyIndex}]).length,0,'do not decorate a matching number in the body');
    }
  }
}
assert.equal(count,287);assert.equal(printedPages,125);
console.log('Verified '+count+' disjoint, ink-matched footer targets on '+printedPages+' pages; body and non-notes excluded.');
