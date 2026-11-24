'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {create,apply,delta}=require('./v25/note-sync.js'),{createStore}=require('./v25/notes.js');
const {describeSelection,createReferenceIndex}=require('./v25/study-qa.js');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const books=[{code:'GEN',name:'创世记',short:'创'}];
const describe=objects=>describeSelection(objects,books);
const desc=describe([{code:'GEN',ch:1,lo:24}]);
function memory(){
  const items=new Map();return {get length(){return items.size;},key:i=>[...items.keys()][i],getItem:k=>items.get(k)??null,
    setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
}
const wait=()=>new Promise(r=>setImmediate(r));
(async()=>{
  assert.equal(apply('思考甲尾',delta('思考甲尾','思考乙尾')),'思考乙尾');
  assert.equal(apply('甲𠀀B尾',delta('甲𠀀B尾','甲C尾')),'甲C尾');
  const storage=memory(),sessionStorage=memory(),calls=[],replies=[];
  let online=true,serial=0;
  const transport={list:async()=>[],write(note){calls.push(note);return new Promise(resolve=>replies.push(resolve));}};
  const options={scope:'test-reader',storage,describe,createIndex:createReferenceIndex};
  const client={describe,storage,sessionStorage,scope:options.scope,online:()=>online,transport,id:()=>String(++serial)};
  let sync=create({...client,model:createStore(options)});
  sync.write(desc,'一');
  assert.equal(calls[0].text,'一','first character must submit on the same input call');
  sync.write(desc,'一句');
  sync.write(desc,'一句！');
  assert.equal(calls.length,1,'preserve order while server is busy');
  assert.match(sync.status(desc.key).text,/正在同步/);
  replies.shift()({ok:true,revision:1});await wait();
  assert.equal(calls[1].text,'一句');
  replies.shift()({ok:true,revision:2});await wait();
  assert.equal(calls[2].text,'一句！');
  replies.shift()({ok:true,revision:3});await wait();
  assert.equal(sync.status(desc.key).text,'已同步');
  online=false;sync.write(desc,'一句');sync.write(desc,'一句。');
  assert.match(sync.status(desc.key).text,/待同步/);assert.ok(sync.hasPending());
  sync.dispose();sync=create({...client,model:createStore(options)});assert.equal(sync.body(desc.key),'一句。');
  online=true;sync.resume();assert.equal(calls[3].text,'一句');
  replies.shift()({ok:true,revision:4});await wait();assert.equal(calls[4].text,'一句。');
  replies.shift()({ok:true,revision:5});await wait();assert.ok(!sync.hasPending());
  sync.write(desc,'自己的修改');
  replies.shift()({ok:false,revision:6,body:'另一端的修改'});await wait();
  assert.match(sync.status(desc.key).text,/没有覆盖云端/);
  assert.equal(sync.body(desc.key),'自己的修改');
  const retained=calls.length;sync.write(desc,'保留草稿');assert.equal(calls.length,retained);
  sync.dispose();

  const moveStorage=memory(),moveSession=memory(),moveCalls=[],movingReplies=[];
  const moveOptions={...options,storage:moveStorage},destination=describe([{code:'GEN',ch:2}]),empty=describe([]),stable='N:FIRST';
  const moveClient={...client,storage:moveStorage,sessionStorage:moveSession,
    transport:{list:async()=>[],write(note){moveCalls.push(note);return new Promise(resolve=>movingReplies.push(resolve));}}};
  let moving=create({...moveClient,model:createStore(moveOptions)});
  moving.write({...desc,noteId:stable},'保留原文');
  assert.equal(moving.reanchor(stable,empty),false,'never persist a note without an anchor');
  assert.ok(moving.reanchor(stable,destination));
  assert.deepEqual(moving.query(desc.objects),[]);
  assert.equal(moving.query(destination.objects)[0].id,stable);
  assert.deepEqual(moveCalls[0].refs,[['GEN',1,24,24]],'an in-flight text mutation keeps its own original refs');
  online=false;movingReplies.shift()({ok:true,revision:1});await wait();moving.dispose();
  moving=create({...moveClient,model:createStore(moveOptions)});
  assert.deepEqual(moving.descriptor(stable).objects,destination.objects,'pending move survives reload');
  online=true;moving.resume();assert.equal(moveCalls[1].noteKey,stable);assert.deepEqual(moveCalls[1].refs,[['GEN',2]]);
  movingReplies.shift()({ok:false,revision:2,body:'保留原文',refs:[['GEN',3]]});await wait();
  assert.equal(moveCalls.length,2,'the same text on different refs must not rebase');
  assert.match(moving.status(stable).text,/没有覆盖云端/);moving.dispose();

  const db=new PGlite();
  try{
    const a='2eec0000-0000-0000-0000-000000000001',b='2eec0000-0000-0000-0000-000000000002',ids=[1,2,3].map(x=>'adad0000-0000-0000-0000-00000000000'+x);
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      insert into auth.users values ('${a}'), ('${b}');`);
    await db.exec(fs.readFileSync(path.join(__dirname,'supabase/migrations/20261124000100_v25_notes.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'supabase/migrations/20261125000100_v25_note_reanchor.sql'),'utf8'));
    const list=async()=>(await db.query('select public.paper_v25_note_list() as notes')).rows[0].notes;
    const write=async (body,rev,mutation)=>(await db.query(
      'select public.paper_v25_note_write($1,$2::jsonb,$3,$4,$5) as result',[desc.key,'[["GEN",1,24,24]]',body,rev,mutation])).rows[0].result;
    const v2=async (key,refs,body,rev,mutation)=>(await db.query(
      'select public.paper_v25_note_write_v2($1,$2::jsonb,$3,$4,$5) as result',[key,JSON.stringify(refs),body,rev,mutation])).rows[0].result;
    const role=async (name,user='')=>{
      await db.exec('reset role; set role '+name);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    };
    await role('anon');await assert.rejects(list(),{code:'42501'});await assert.rejects(write('拒绝',0,ids[0]),{code:'42501'});
    await role('authenticated',a);assert.deepEqual(await list(),[]);
    assert.deepEqual(await write('甲',0,ids[0]),{ok:true,revision:1});
    assert.deepEqual(await write('甲',0,ids[0]),{ok:true,revision:1},'retry after a lost ack is idempotent');
    assert.deepEqual(await write('甲乙',1,ids[1]),{ok:true,revision:2});
    assert.deepEqual(await write('错误地覆盖',1,ids[2]),{ok:false,revision:2,body:'甲乙'});
    await role('authenticated',b);assert.deepEqual(await list(),[]);
    assert.deepEqual(await write('另一账号',0,ids[0]),{ok:true,revision:1});
    assert.deepEqual((await list()).map(n=>n.body),['另一账号']);
    await role('authenticated',a);assert.deepEqual((await list()).map(n=>n.body),['甲乙']);
    assert.deepEqual(await write('',2,ids[2]),{ok:true,revision:3});
    assert.deepEqual((await list()).map(n=>n.body),[''],'deletion leaves a revision, not an unprotected resurrection');
    const oldRefs=[['GEN',1,24,24]],newRefs=[['GEN',2]];
    for(const refs of [[],[['GEN',2,3,2]],[['GEN',2,null,3]]])await assert.rejects(v2(stable,refs,'无效',0,ids[0]),{code:'22023'});
    assert.deepEqual(await v2(stable,oldRefs,'另写一条',0,ids[0]),{ok:true,revision:1});
    assert.deepEqual(await v2(desc.key,newRefs,'保留旧笔记身份',3,ids[1]),{ok:true,revision:4});
    assert.deepEqual(await v2(desc.key,newRefs,'保留旧笔记身份',3,ids[1]),{ok:true,revision:4},'replayed move is idempotent');
    assert.deepEqual(await v2(desc.key,oldRefs,'过期操作',3,ids[2]),{ok:false,revision:4,body:'保留旧笔记身份',refs:newRefs});
    assert.deepEqual(await write('旧网页不能把关联改回去',4,ids[2]),{ok:false,revision:4,body:'保留旧笔记身份'});
    assert.deepEqual((await list()).find(n=>n.note_key===desc.key).refs,newRefs);
    await role('authenticated',b);
    assert.deepEqual(await v2(stable,newRefs,'不能移动别人的笔记',1,ids[2]),{ok:false,revision:0,body:'',refs:null});
    await role('anon');await assert.rejects(v2(stable,newRefs,'无权写入',1,ids[2]),{code:'42501'});
  }finally{await db.close();}
  console.log('PASS immediate per-input submission, ordered acknowledgement, offline journal replay, conflict and private database roles');
})().catch(e=>{console.error(e);process.exitCode=1;});
