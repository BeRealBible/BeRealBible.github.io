const assert=require('node:assert/strict'),source=require('./data/bible-source.js'),context=require('./v25/context.js'),resolve=require('./footnote-passages.js').resolve;
function check(citation,start,end){
 const r=context(resolve(citation,source),source).flat();
 assert.equal(r[0].ref,start);assert.equal(r.at(-1).ref,end);
 assert.deepEqual(r.filter(v=>v.cited).map(v=>v.code+v.ref),resolve(citation,source).map(v=>v.code+v.chapter+':'+v.verse));
}
check('约3:16','3:1','3:36');check('约3:1','2:1','3:36');check('约3:36','3:1','4:54');
check('约1:1','1:1','1:51');check('约21:25','21:1','21:25');check('约3:36-4:2','3:1','4:54');check('约3:2、6','3:1','3:36');
const separate=context(resolve('创1:1；路2:2',source),source);assert.equal(separate.length,2);
const {createModel}=require('./v25/history.js'),map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},mk=()=>createModel({storage,pageCount:100});
const m=mk(),loc=n=>({page:n,bookCode:'JHN',ref:n+':1'}),ids=[1,2,3,4,5].map(n=>m.jump(loc(n)).id);
const list=(model=m)=>model.list().map(e=>ids.indexOf(e.id)+1);
m.pin(ids[0]);m.pin(ids[3]);m.jump(loc(1),ids[0]);m.jump(loc(2),ids[1]);assert.deepEqual(list(),[4,1,2,5,3]);
m.jump(loc(4),ids[3]);assert.deepEqual(list(mk()),[4,1,2,5,3]);m.pin(ids[0],false);m.pin(ids[0],true);assert.deepEqual(list(),[1,4,2,5,3]);console.log('PASS context and pinned/recent ordering');
