'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{
  const db=new PGlite();
  try{
    const userA='2eec0000-0000-0000-0000-000000000001',userB='2eec0000-0000-0000-0000-000000000002';
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      insert into auth.users values ('${userA}'), ('${userB}');`);
    const migration=fs.readFileSync(path.join(__dirname,'supabase/migrations/20261123000100_v25_account.sql'),'utf8');
    await db.exec(migration);
    await assert.rejects(db.exec(migration),{code:'42P07'}); // Never overwrite an existing installation.
    await db.exec('rollback');
    const edition='physical-821d',ink='paper-bible-highlights-v1:GEN:9:1:1–3:1:6~mark~verse:1:2@0:x1:'+edition,
      position='paper-bible-position-v1:'+edition,trail='paper-bible-v25-compare-trails-v1:'+edition;
    const rpc=async(patch={},guest={})=>(await db.query('select public.paper_v25_sync($1,$2::jsonb,$3::jsonb) as state',
      [edition,JSON.stringify(patch),JSON.stringify(guest)])).rows[0].state;
    const use=async (role,id='')=>{
      await db.exec('reset role; set role '+role);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    };
    await use('anon');await assert.rejects(rpc(),{code:'42501'});
    await assert.rejects(db.query('select * from public.paper_v25_profiles'),{code:'42501'});
    await use('authenticated',userA);assert.deepEqual(await rpc(),{});
    assert.deepEqual(await rpc({[ink]:'1',[position]:'A'}),{[ink]:'1',[position]:'A'});
    assert.deepEqual(await rpc({[ink]:'0'},{[position]:'guest',[trail]:'imported'}),{[ink]:'0',[position]:'A',[trail]:'imported'});
    await assert.rejects(rpc({'search-query':'private'}),{code:'22023'});
    await assert.rejects(rpc({'paper-bible-position-v1:wrong':'no'}),{code:'22023'});
    await use('authenticated',userB);assert.deepEqual(await rpc(),{});
    assert.deepEqual((await db.query('select * from public.paper_v25_profiles')).rows,[]);
    assert.equal((await db.query('update public.paper_v25_profiles set state=$1 where user_id=$2',['{}',userA])).affectedRows,0);
    await assert.rejects(db.query('insert into public.paper_v25_profiles(user_id,edition) values ($1,$2)',[userA,'new-edition']),{code:'42501'});
    await rpc({[position]:'B'});
    await assert.rejects(db.query('update public.paper_v25_profiles set user_id=$1',[userA]),{code:'42501'});
    assert.deepEqual(await rpc(),{[position]:'B'});
    await use('authenticated',userA);assert.deepEqual(await rpc(),{[ink]:'0',[position]:'A',[trail]:'imported'});
    console.log('Postgres migration, guest denial, per-account read/write isolation, cloud precedence, and highlight removal passed');
  }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
