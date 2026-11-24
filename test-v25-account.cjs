'use strict';
const assert=require('node:assert/strict');
const {configFor,createProfile,createClient}=require('./v25/account.js');
function memory(){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
(async()=>{
  const cfg={url:'https://example.supabase.co',publishableKey:'sb_publishable_test'};
  assert.deepEqual(configFor(new URL('https://my.github.io'),cfg),cfg);
  assert.equal(configFor(new URL('https://xxmm1221.github.io/paper-bible-demo/'),cfg),null);
  const verified={...cfg,pagesIsolationVerified:true};
  assert.deepEqual(configFor(new URL('https://xxmm1221.github.io/paper-bible-demo/?v=index-25'),verified),cfg);
  assert.deepEqual(configFor(new URL('https://xxmm1221.github.io/paper-bible-demo/index.html'),verified),cfg);
  assert.equal(configFor(new URL('https://xxmm1221.github.io/emmaus-paper-study-demo/'),verified),null);
  assert.equal(configFor(new URL('file:///offline.html'),cfg),null);
  assert.equal(configFor(new URL('https://my.github.io'),{...cfg,publishableKey:'sb_secret_no'}),null);
  assert.equal(configFor(new URL('https://my.github.io'),{...cfg,url:'https://example.supabase.co.evil.test'}),null);
  const store=memory(),suffix=':physical-821d',position='paper-bible-position-v1'+suffix,
    ink='paper-bible-highlights-v1:GEN:9:1:1–3:1:6~mark~verse:1:2@0:x1'+suffix,
    another='paper-bible-highlights-v1:GEN:9:1:1:1:6~mark~verse:1:3@0:x2'+suffix;
  store.setItem(position,'guest location');store.setItem(ink,'1');store.setItem('search-secret','never sync');
  store.setItem('paper-bible-position-v1:old','old edition');
  const changed=[],opt={prefix:'project',edition:'physical-821d',onChange:key=>changed.push(key)};
  const a=createProfile(store,{...opt,id:'A'}),b=createProfile(store,{...opt,id:'B'});
  assert.equal(a.adapter.getItem(position),null);assert.equal(a.adapter.getItem('paper-bible-position-v1:old'),null);
  assert.deepEqual(a.importable(),{[position]:'guest location',[ink]:'1'});
  a.adapter.setItem(position,'account A');a.adapter.setItem(ink,'1');
  assert.equal(b.adapter.getItem(position),null);
  assert.equal(store.getItem(position),'guest location');
  const first=a.changes();a.adapter.setItem(ink,'0'); // A write during the network request cannot be lost.
  a.receive({...first.patch,[another]:'1','search-query':'not a record'},first.pending);
  assert.deepEqual(a.changes().patch,{[ink]:'0'});assert.deepEqual(changed,[another]);
  assert.deepEqual(createProfile(store,{...opt,id:'A'}).changes().patch,{[ink]:'0'});
  assert.equal(b.adapter.getItem(another),null);
  const next=a.changes();a.receive({...first.patch,...next.patch,[another]:'1'},next.pending);
  assert.deepEqual(a.changes().patch,{});assert.equal(a.adapter.getItem(ink),'0');
  a.adapter.setItem('search-secret','keep device-only');assert.equal(store.getItem('search-secret'),'keep device-only');
  assert.deepEqual(a.changes().patch,{});
  const requests=[],client=createClient(async(url,options)=>{
    requests.push([url,options]);
    return {ok:true,json:async()=>url.endsWith('/verify')?{access_token:'demo-access',refresh_token:'demo-refresh',expires_in:3600,user:{id:'01a2cccc-0000-0000-0000-000000000000',email:'reader@example.test'}}:{}};
  },cfg);
  await client.send('reader@example.test');const s=await client.verify('reader@example.test','123456');
  await client.exchange(s.access,'physical-821d',{'a':'0'},{});
  assert.equal(requests[0][1].headers.Authorization,undefined);
  assert.equal(requests[2][1].headers.Authorization,'Bearer demo-access');
  assert.deepEqual(JSON.parse(requests[1][1].body),{email:'reader@example.test',token:'123456',type:'email'});
  assert.ok(requests.every(([,opt])=>opt.redirect==='error'&&opt.credentials==='omit'));
  console.log('Account configuration, request shape, consent scope, cache separation, and in-flight changes passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
