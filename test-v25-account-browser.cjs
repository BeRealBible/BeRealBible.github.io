'use strict';
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const publicSite=process.env.V25_ACCOUNT_PUBLIC_SITE;
if(publicSite&&publicSite!=='https://berealbible.github.io')throw Error('Use only the verified BeRealBible origin for the public smoke test');
const origin=publicSite||'http://127.0.0.1:37134',api='https://v25-account-test.supabase.co';
const syncRPC='/rest/v1/rpc/paper_v25_sync',noteListRPC='/rest/v1/rpc/paper_v25_note_list';
const remembered='paper:v25:account:remembered:'+new URL(api).hostname;
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};
const users={alice:['27426463-0000-0000-0000-000000000001','alice@example.test'],bob:['27426463-0000-0000-0000-000000000002','bob@example.test']};
const rows=new Map(),calls=[],positions='paper-bible-position-v1',mark='paper-bible-highlights-v1:library:GEN.1:2~mark~verse';
const refreshes=new Map();let nextRefresh=0;
function mockSession(who){
  const refresh='fake-refresh-'+ ++nextRefresh;refreshes.set(refresh,who);
  return {access_token:who,refresh_token:refresh,expires_in:3600,user:{id:users[who][0],email:users[who][1]}};
}
const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'apikey,authorization,content-type','access-control-allow-methods':'POST,OPTIONS'};
const pageURL=origin+'/?v=index-25&curl=off&ref=GEN.1:1';
async function context(browser,configured,{width=1260,offline=false,storageState}={}){
  const c=await browser.newContext({viewport:{width,height:835},isMobile:width<550,hasTouch:width<550,reducedMotion:'reduce',offline,storageState});
  await c.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
  await c.route('**/*',async route=>{
    const r=route.request(),url=new URL(r.url());
    if(url.origin===api){
      if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      const auth=r.headers().authorization?.replace(/^Bearer /,''),payload=r.postDataJSON();
      calls.push({method:url.pathname,user:auth,payload});
      const respond=(json,status=200)=>route.fulfill({json,status,headers:cors});
      if(url.pathname==='/auth/v1/otp')return respond({});
      if(url.pathname==='/auth/v1/verify'){
        const who=Object.keys(users).find(k=>users[k][1]===payload.email);
        if(!who||payload.token!=='123456')return respond({code:'otp_expired'},403);
        return respond(mockSession(who));
      }
      if(url.pathname==='/auth/v1/token'){
        const who=refreshes.get(payload.refresh_token);if(!who)return respond({},403);
        refreshes.delete(payload.refresh_token);await new Promise(r=>setTimeout(r,150));
        return respond(mockSession(who));
      }
      if(url.pathname==='/auth/v1/logout')return respond({});
      if(!users[auth])return respond({},401);
      if(url.pathname===noteListRPC)return respond([]);
      if(url.pathname!==syncRPC)return respond({},404);
      const key=auth+':'+payload.edition_key;
      const next={...payload.guest_import,...rows.get(key),...payload.changes};rows.set(key,next);
      return respond(next);
    }
    if(url.protocol==='file:')return route.continue();
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/v25/account-config.js')return route.fulfill({contentType:'text/javascript',body:configured?
      `window.V25_ACCOUNT_CONFIG=${JSON.stringify({url:api,publishableKey:'sb_publishable_demo',notesOrigin:origin,pagesIsolationVerified:true})};`:
      'window.V25_ACCOUNT_CONFIG={};'});
    if(publicSite)return route.continue(); // Real release assets, only the authentication API is mocked.
    const f=path.resolve(__dirname,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!f.startsWith(__dirname+path.sep))return route.abort();
    try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
    catch{await route.fulfill({status:404,body:'Not found'});}
  });
  const page=await c.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  return {c,page,errors};
}
const ready=page=>page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
const control=(page,id)=>page.locator('#paper-account-'+id);
async function panel(page){
  await page.locator('.rh-settings').evaluate(button=>button.click());
  await control(page,'open').click();
  await control(page,'dialog').waitFor();
}
async function login(page,email,{badCode=false}={}){
  await control(page,'email').fill(email);
  await control(page,'send').locator('button[type=submit]').click();
  const code=control(page,'code'),verify=control(page,'verify').locator('button[type=submit]');
  if(badCode){
    await code.fill('000000');await verify.click();
    await page.getByText('验证码不正确或已过期。').waitFor();
  }
  await code.fill('123456');await verify.click();
  await control(page,'enable').waitFor();assert.equal(await control(page,'import').isChecked(),false);
}
async function changeProfile(page,id){
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),control(page,id).click()]);
  await ready(page);
}
async function record(page,key,value){
  return page.evaluate(([k,v])=>{
    if(v!==undefined)window.PAPER_READER_STORAGE.setItem(k,v);
    return window.PAPER_READER_STORAGE.getItem(k);
  },[key,value]);
}
async function reopenedLogin(browser){
  // A new browser context gets only persisted storage, never the previous
  // pages' sessionStorage. Verify the notes-only path, without opting in.
  const original=await context(browser,true,{width:390});
  await original.page.goto(pageURL);await ready(original.page);await panel(original.page);await login(original.page,users.alice[1]);
  const profileDisk=await original.c.storageState();await original.c.close();
  const restored=await context(browser,true,{width:390,storageState:profileDisk});
  const sibling=await restored.c.newPage(),otherErrors=[];sibling.on('pageerror',e=>otherErrors.push(e.message));
  const count=method=>calls.filter(c=>c.method===method).length;
  const verifies=count('/auth/v1/verify'),reading=count(syncRPC);
  await Promise.all([restored.page.goto(pageURL),sibling.goto(pageURL)]);await Promise.all([ready(restored.page),ready(sibling)]);
  const scope=p=>p.evaluate(()=>({notes:V25Account.notesScope,reading:V25Account.usingProfile}));
  assert.deepEqual(await scope(restored.page),{notes:new URL(api).hostname+':'+users.alice[0],reading:false});
  assert.deepEqual(await scope(sibling),await scope(restored.page));
  assert.equal(count('/auth/v1/verify'),verifies,'closing the phone page does not require a new code');
  assert.equal(count(syncRPC),reading,'remembering a login does not opt in to reading sync');
  const expire=()=>restored.page.evaluate(key=>{
    const record=JSON.parse(localStorage.getItem(key));record.session.expiry=Date.now()/1000-30;
    localStorage.setItem(key,JSON.stringify(record));
  },remembered);
  const notes=p=>p.evaluate(()=>V25Account.noteTransport(V25Account.notesScope).list());
  const renewals=count('/auth/v1/token');await expire();
  await Promise.all([notes(restored.page),notes(sibling)]);
  assert.equal(count('/auth/v1/token'),renewals+1,'simultaneous tabs serialize a rotating refresh token');

  await panel(sibling);await expire();const beforeExit=count('/auth/v1/token');
  const pending=notes(restored.page).catch(()=>null);
  for(let i=0;i<100&&count('/auth/v1/token')===beforeExit;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(count('/auth/v1/token'),beforeExit+1);
  await control(sibling,'logout').click();await sibling.getByText('已退出。',{exact:true}).waitFor();await pending;
  await restored.page.waitForFunction(()=>V25Account.notesScope===null);
  const record=await restored.page.evaluate(key=>Object.keys(JSON.parse(localStorage.getItem(key))),remembered);
  assert.deepEqual(record,['epoch'],'logout leaves no access or refresh credential');
  await restored.page.reload();await ready(restored.page);
  assert.deepEqual(await scope(restored.page),{notes:null,reading:false},'a late refresh cannot restore a logged-out session');
  assert.deepEqual([...original.errors,...restored.errors,...otherErrors],[]);await restored.c.close();
  console.log('V25 browser: persistent phone login, refresh locking, cross-tab logout and no implicit sync passed');
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    if(publicSite){await reopenedLogin(browser);return;}
    const guest=await context(browser,false);
    await guest.page.goto(pageURL);await ready(guest.page);
    assert.equal(await control(guest.page,'open').isVisible(),false);
    assert.ok(await record(guest.page,positions));assert.equal(await record(guest.page,mark,'1'),'1');
    assert.deepEqual(guest.errors,[]);await guest.c.close();
    const desktop=await context(browser,true),page=desktop.page;
    await page.goto(pageURL);await ready(page);
    const guestPos=await record(page,positions);await record(page,mark,'1');
    const cloudPos=await page.evaluate(()=>{
      const d=window.V25OriginalData,p=d.lookup('JHN','3:16');return JSON.stringify({bookName:'约翰福音',ref:'3:16',page:p,spread:p&~1,edition:d.edition,explicitRef:true});
    });
    await panel(page);await login(page,users.alice[1],{badCode:true});
    assert.equal(calls.filter(c=>c.method===syncRPC).length,0,'Signing in alone must not upload or fetch reading records');
    await changeProfile(page,'enable');
    const first=calls.find(c=>c.method===syncRPC);
    assert.deepEqual(first.payload.guest_import,{});assert.deepEqual(first.payload.changes,{});
    assert.equal(await record(page,mark),null,'Guest marks must not leak to Alice');
    await record(page,positions,cloudPos);await record(page,mark,'1');
    await panel(page);await control(page,'sync').click();await page.getByText(/已同步 ·/).waitFor();
    const cloud=()=>rows.get('alice:'+first.payload.edition_key);
    await page.waitForFunction(()=>document.querySelector('#paper-account-sync').disabled===false);
    assert.equal(cloud()[positions+':'+first.payload.edition_key],cloudPos);
    const phone=await context(browser,true,{width:390});
    await phone.page.goto(pageURL);await ready(phone.page);await panel(phone.page);await login(phone.page,users.alice[1]);
    await changeProfile(phone.page,'enable');
    assert.equal(await record(phone.page,positions),cloudPos);assert.equal(await record(phone.page,mark),'1');
    assert.match(await phone.page.locator('#book-name').textContent(),/约翰/);
    assert.ok(!phone.page.url().includes('ref='));
    await record(phone.page,mark,'0');await panel(phone.page);await control(phone.page,'sync').click();
    await phone.page.waitForFunction(()=>document.querySelector('#paper-account-sync').disabled===false);
    assert.equal(cloud()[mark+':'+first.payload.edition_key],'0');
    await control(page,'sync').click();await page.waitForFunction(()=>document.querySelector('#paper-account-sync').disabled===false);
    assert.equal(await record(page,mark),'0');
    await changeProfile(page,'logout');assert.equal(await record(page,mark),'1');assert.equal(await record(page,positions),guestPos);
    await panel(page);await login(page,users.bob[1]);
    await control(page,'import').check();await changeProfile(page,'enable');
    const bob=calls.find(c=>c.method===syncRPC&&c.user==='bob');
    assert.equal(bob.payload.guest_import[mark+':'+first.payload.edition_key],'1');
    assert.equal(bob.payload.guest_import[positions+':'+first.payload.edition_key],guestPos);
    assert.equal(cloud()[mark+':'+first.payload.edition_key],'0');
    assert.deepEqual(desktop.errors,[]);assert.deepEqual(phone.errors,[]);
    await desktop.c.close();await phone.c.close();

    await reopenedLogin(browser);
    if(process.env.PREVIEW_FILE){
      const file=await context(browser,false,{offline:true});
      await file.page.goto(pathToFileURL(path.resolve(process.env.PREVIEW_FILE)).href);await ready(file.page);
      assert.equal(await control(file.page,'open').isVisible(),false);assert.deepEqual(file.errors,[]);await file.c.close();
    }
    console.log('V25 browser: guest, OTP, consent, profile isolation, persistent phone login, refresh locking and cross-tab logout passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
