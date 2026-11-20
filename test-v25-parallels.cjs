const assert=require('node:assert/strict'), source=require('./data/bible-source.js'),
  {targets}=require('./v25/parallels.js'), notes=require('./footnote-passages.js');
global.window={};require('./v25-original-data.js');const db=window.V25OriginalData;
const expected=new Set(),found=new Set();let rects=0;
for(const b of source.books)for(const c of b.chapters)for(const [v,title] of c.titles||[]){
  if(/[（(][^（）()]*\d/.test(title))expected.add(b.code+'.'+c.chapter+':'+v);
}
for(const [k,file] of Object.entries(db.packs)){
  db.installPack(k,require('./paper-pages/'+file));
  for(let n=32*k;n<32*k+32;n++){
    const page=db.get(n);if(!page)continue;
    const b=source.books[db.pages[n].b],hits=targets(page,db.tags(n),b,source);
    for(const {sourceRef,citation,x,y,width,height} of hits){
      assert.ok(x>=0&&y>=0&&width>0&&height>0&&x+width<=page[1]+2&&y+height<=page[2]+2);
      const verses=notes.resolve(citation,source);assert.ok(verses.length,citation);
      assert.ok(verses.every(v=>Number.isInteger(db.lookup(v.code,v.chapter+':'+v.verse))),citation);
      found.add(b.code+'.'+sourceRef);rects++;
    }
    if(n===954)assert.deepEqual(hits.filter(h=>h.sourceRef==='3:1').map(h=>h.citation),['可1:1-8','路3:1-18','约1:19-28']);
    if(n===1004)assert.ok(hits.some(h=>h.citation==='太19:1-12'));
  }
}
assert.deepEqual(found,expected);console.log('Verified',found.size,'cited headings and',rects,'clickable printed runs');
