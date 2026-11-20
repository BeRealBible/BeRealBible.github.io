
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {infer}=require('./v25-live-rows');
const context={window:{},atob};
vm.runInNewContext(fs.readFileSync('v25-original-data.js','utf8'),context);
const data=context.window.V25OriginalData;
for(const [k,f] of Object.entries(data.packs))data.installPack(k,JSON.parse(fs.readFileSync('paper-pages/'+f)));
let pages=0,lines=0,unassigned=0;
for(let i=0;i<=data.count;i++){
 const page=data.get(i);if(!page)continue;
 const words=page[3],tags=data.tags(i);
 const {rows,rowFor,gutter}=infer(words,tags);
 pages++;lines+=rows.length;
 assert(Number.isFinite(gutter),'page '+i);
 assert.equal(rowFor.length,words.length);
 tags.forEach((t,i)=>{if(t.role==='body'&&!rowFor[i])unassigned++;});
 for(const row of rows){
  assert(row.members.length>0);
  for(const [j,idx] of row.members.entries()){
   assert.equal(rowFor[idx],row);
   if(j>0)assert(row.members[j-1]<idx,'source order changed at '+i);
  }
  assert(row.members.includes(row.last));
 }
}
assert.equal(pages,1233);
assert.equal(lines,79229);
assert.equal(unassigned,22);
console.log('Original source rows retained: '+pages+' pages, '+lines+' lines; '+unassigned+' unresolved body tokens remain unchanged');
