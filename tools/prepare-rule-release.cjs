/* Publish only the semantic fields and font assets actually used by the reader. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),local=path.join(root,'local-data');
const source=require(path.join(local,'bible-source.js'));
const output={edition:source.edition,books:source.books.map(b=>({code:b.code,name:b.name,short:b.short,
  chapters:b.chapters.map(c=>({chapter:c.chapter,verses:c.verses,titles:c.titles,paragraphs:c.paragraphs,
    ...Object.fromEntries(['poetry','paragraphBreaks','stanzaBreaks','superscription'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]))}))}))};
const content=s=>JSON.stringify(s.books.map(b=>b.chapters.map(c=>[c.chapter,c.verses,c.titles,c.paragraphs,c.poetry,c.paragraphBreaks,c.stanzaBreaks,c.superscription])));
assert.equal(content(output),content(source),'publishing must not change any source text');
for(const b of output.books)for(const c of b.chapters){
  const verses=new Map(c.verses),seen=new Set();
  for(const field of ['paragraphBreaks','stanzaBreaks'])for(const item of c[field]||[]){
    assert.ok(verses.has(item.verse),'semantic break must have an existing verse');
    assert.ok(Number.isInteger(item.offset)&&item.offset>=0&&item.offset<[...verses.get(item.verse)].length,'semantic offset must be inside the unchanged verse');
  }
  if(c.superscription)assert.ok(c.verses[0][1].startsWith(c.superscription),'superscription must remain a canonical prefix');
  for(const p of c.poetry||[]){
    assert.ok(!seen.has(p.verse),'duplicate semantic verse');seen.add(p.verse);
    assert.equal(p.segments.map(s=>s.text).join(''),verses.get(p.verse),'poetry must partition the unchanged verse text');
    for(const s of p.segments){
      assert.ok(s.kind==='prose'||s.kind==='poetry','only semantic prose/poetry kinds are allowed');
      if(s.kind==='poetry')assert.ok(typeof s.line==='string'&&s.line.length>0,'poetry line needs a stable source identifier');
    }
  }
}
fs.mkdirSync(path.join(root,'data'),{recursive:true});
const script='/* Semantic scripture source and poetic-line boundaries; physical wrapping and pagination are computed from shared rules. */\n'+
  "(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BIBLE_SOURCE=factory();})(typeof window!=='undefined'?window:globalThis,function(){return "+JSON.stringify(output)+';});\n';
fs.writeFileSync(path.join(root,'data','bible-source.js'),script);
let css=fs.readFileSync(path.join(local,'fonts-extra.css'),'utf8');
css=css.replace(/url\(["']?([^"')]+)["']?\)/g,(_,name)=>{
  assert.equal(path.basename(name),name,'font source must be a plain filename');
  assert.match(name,/\.(?:ttf|woff2?|otf)$/);
  fs.copyFileSync(path.join(local,name),path.join(root,'fonts',name));
  return `url("fonts/${name}")`;
});
css=css.replace('../fonts/LICENSE.txt','fonts/LICENSE.txt');
fs.writeFileSync(path.join(root,'fonts-extra.css'),css);
console.log(JSON.stringify({books:output.books.length,sourceBytes:Buffer.byteLength(script),sourceSha256:crypto.createHash('sha256').update(script).digest('hex'),omitted:['referenceSegments','private provenance','local reports','source database','PDF']}));
