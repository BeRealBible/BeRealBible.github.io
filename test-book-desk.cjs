'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),Desk=require('./book-desk.js');
const micro=()=>new Promise(f=>setImmediate(f));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({native=true,reduce=false}={}){
 const calls=[],animations=[],doc={documentElement:{dataset:{}},defaultView:{matchMedia:()=>({matches:reduce})}};
 if(native)doc.startViewTransition=update=>{const done=deferred(),t={update,done,ready:Promise.resolve(),finished:done.promise,skipTransition:()=>done.resolve()};calls.push(t);return t;};
 const stage={ownerDocument:doc,inert:false,dataset:{}},surface={animate(frames){const done=deferred(),a={frames,done,finished:done.promise,cancel:()=>done.reject()};animations.push(a);return a;}};
 return {desk:Desk.create(stage,surface),stage,root:doc.documentElement,calls,animations};
}
test('desk order follows stable trail identity, never target chapter or last-use order',()=>{
 assert.deepEqual(['r20','r1','r4'].sort((a,b)=>Desk.rank(a)-Desk.rank(b)),['r1','r4','r20']);
});
test('native snapshot switches once; a stale/cancelled capture cannot switch pages or unlock a newer slide',async()=>{
 const f=fixture(),seen=[];f.desk.start(1,()=>seen.push('a'));const a=f.calls[0];f.desk.start(-1,()=>seen.push('b'));a.update();await micro();
 assert.deepEqual(seen,[]);assert.equal(f.stage.inert,true);assert.equal(f.root.dataset.bookDesk,'backward');
 const b=f.calls[1];b.update();assert.deepEqual(seen,['b']);b.done.resolve();await micro();
 assert.deepEqual(seen,['b']);assert.equal(f.stage.inert,false);assert.equal(f.root.dataset.bookDesk,undefined);
});
test('fallback moves the whole outgoing book to one side and the incoming book from the opposite side',async()=>{
 const f=fixture({native:false});let seen=0;f.desk.start(-1,()=>seen++);assert.equal(seen,0);
 const a=f.animations[0];assert.equal(a.frames[1].transform,'translateX(100%)');a.done.resolve();await micro();assert.equal(seen,1);
 const b=f.animations[1];assert.equal(b.frames[0].transform,'translateX(-100%)');b.done.resolve();await micro();assert.equal(f.stage.inert,false);
});
test('reduced-motion returns directly, without snapshots, slides or pointer locks',()=>{
 const f=fixture({reduce:true});let seen=0;f.desk.start(1,()=>seen++);assert.equal(seen,1);assert.equal(f.calls.length,0);assert.equal(f.stage.inert,false);
});
