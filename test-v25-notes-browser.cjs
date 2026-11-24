'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.V25_NOTES_TEST_ORIGIN||'http://127.0.0.1:37136',api='https://v25-note-test.supabase.co';
const target=origin+'/?v=index-25&curl=off&ref=2SA.3:1',enableLinks=process.env.V25_NOTES_LEGACY_API!=='1';
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};
const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'apikey,authorization,content-type','access-control-allow-methods':'POST,OPTIONS'};
const accounts={a:{id:'27426463-0000-0000-0000-000000000001',email:'a@example.test'},b:{id:'27426463-0000-0000-0000-000000000002',email:'b@example.test'}};
const cloud=new Map(),writes=[];
let releaseSend,hold=new Promise(r=>{releaseSend=r;});
async function visit(browser,width){
  const mobile=width<550;
  const ctx=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
  await ctx.addInitScript(mobile=>{
    localStorage.setItem('paper:v25:first-guide:1','seen');
    if(!mobile)return;
    const native=window.visualViewport,viewport=new EventTarget();let override=null;
    for(const key of ['width','height','offsetLeft','offsetTop','scale','pageLeft','pageTop'])
      Object.defineProperty(viewport,key,{get:()=>override?.[key]??native[key]});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
    window.testKeyboard=value=>{override=value;viewport.dispatchEvent(new Event('resize'));};
  },mobile);
  await ctx.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());
    if(u.origin===api){
      if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      const respond=(json,status=200)=>route.fulfill({json,status,headers:cors}),args=r.postDataJSON(),who=r.headers().authorization?.slice(7);
      if(u.pathname==='/auth/v1/otp')return respond({});
      if(u.pathname==='/auth/v1/verify'){
        const token=Object.keys(accounts).find(k=>accounts[k].email===args.email);
        if(!token||args.token!=='123456')return respond({},403);
        return respond({access_token:token,refresh_token:token,expires_in:3600,user:accounts[token]});
      }
      if(!accounts[who])return respond({},401);
      if(u.pathname.endsWith('/paper_v25_note_list'))return respond([...cloud.values()].filter(row=>row.owner===who));
      if(u.pathname.endsWith('/paper_v25_note_write'+(enableLinks?'_v2':''))){
        writes.push({who,...args});
        if(writes.length===1)await hold;
        const key=who+':'+args.anchor_key,old=cloud.get(key);
        if((old?.revision||0)!==args.expected_revision)return respond({ok:false,revision:old?.revision||0,body:old?.body||'',refs:old?.refs??null});
        const revision=args.expected_revision+1;
        cloud.set(key,{owner:who,note_key:args.anchor_key,refs:args.anchors,body:args.note_body,revision});
        return respond({ok:true,revision});
      }
      return respond({},404);
    }
    if(u.origin!==origin)return route.abort();
    if(u.pathname==='/v25/account-config.js')return route.fulfill({contentType:'text/javascript',body:
      `window.V25_ACCOUNT_CONFIG=${JSON.stringify({url:api,publishableKey:'sb_publishable_demo',notesOrigin:origin,pagesIsolationVerified:true,noteReanchorEnabled:enableLinks})};`});
    const f=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if(!f.startsWith(__dirname+path.sep))return route.abort();
    try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
    catch{await route.fulfill({status:404,body:'Not found'});}
  });
  const page=await ctx.newPage(),err=[],qaRequests=[];
  page.on('pageerror',e=>err.push(e.message));
  page.on('request',r=>{if(r.url().includes('/study-qa.json?'))qaRequests.push(r.url());});
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
  assert.equal(new URL(page.url()).origin,origin,'login and notes stay at this reading site');
  await page.evaluate(()=>document.getElementById('fit-book').click());
  await page.waitForTimeout(300); // Let transforms and the hit-test surface settle.
  const cdp=mobile?await ctx.newCDPSession(page):null;
  async function select(ref,long=true){
    const p=await page.locator('#stage .paper text[data-role="body"][data-ref="'+ref+'"]').evaluateAll(nodes=>{
      for(const el of nodes){const r=el.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;if(r.width>1&&el.contains(document.elementFromPoint(x,y)))return {x,y};}
      throw Error('No visible verse text');
    });
    if(cdp){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
      if(long)await page.waitForTimeout(515);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await page.mouse.move(p.x,p.y);await page.mouse.down();if(long)await page.waitForTimeout(515);await page.mouse.up();
    }
    const bar=page.locator('#stage .paper-selection-tools');await bar.waitFor();return bar;
  }
  async function login(id){
    const control=name=>page.locator('#paper-account-'+name);
    await control('email').fill(accounts[id].email);
    await control('send').locator('button[type=submit]').click();
    await control('code').fill('123456');await control('verify').locator('button[type=submit]').click();
    await control('enable').waitFor();await control('close').click();
  }
  return {ctx,page,select,login,err,qaRequests,dialog:page.locator('.compare-slip[data-kind=study]:not([hidden])')};
}
async function until(cond){for(let i=0;i<100;i++){if(cond())return;await new Promise(r=>setTimeout(r,30));}assert.ok(cond(),'timed out waiting for request');}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    const desk=await visit(browser,1280),bar=await desk.select('4:1');
    const count=(reader,ch,kind)=>reader.page.locator(`#stage [data-chapter-total="2SA.${ch}"] [data-chapter-count="${kind}"]`).first();
    await count(desk,4,'qa').waitFor();assert.equal(await count(desk,4,'qa').textContent(),'6');
    assert.equal(await count(desk,4,'notes').textContent(),'—');
    assert.ok(await bar.locator('[data-study]').isDisabled());
    await bar.getByRole('button',{name:'写笔记'}).click();await desk.login('a');
    const edit=desk.dialog.getByRole('textbox',{name:'笔记正文'}),status=desk.dialog.getByRole('status');
    await edit.waitFor();assert.ok(await edit.evaluate(el=>el===document.activeElement));
    assert.equal(await desk.dialog.getByRole('button',{name:'保存',exact:true}).count(),0);
    assert.equal(writes.length,0,'do not create a cloud record just by opening the editor');
    await desk.page.keyboard.insertText('a');
    await until(()=>writes.length===1);
    await status.getByText(/正在同步/).waitFor();
    for(const key of ['b','c'])await desk.page.keyboard.insertText(key);
    assert.deepEqual(writes.map(x=>x.note_body),['a']);assert.equal(cloud.size,0);
    releaseSend();await status.getByText('已同步',{exact:true}).waitFor();
    assert.deepEqual(writes.map(x=>x.note_body),['a','ab','abc']);
    assert.equal(new Set(writes.map(x=>x.mutation_id)).size,3);
    await edit.press('Backspace');await status.getByText('已同步',{exact:true}).waitFor();
    assert.deepEqual(writes.map(x=>x.note_body),['a','ab','abc','ab']);
    await edit.dispatchEvent('compositionstart',{data:''});
    await edit.evaluate(el=>{el.value='ab候';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    assert.equal(writes.length,4);
    await edit.evaluate(el=>{el.value='ab笔';el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'笔'}));});
    await status.getByText('已同步',{exact:true}).waitFor();
    assert.deepEqual(writes.map(x=>x.note_body),['a','ab','abc','ab','ab笔']);
    assert.deepEqual(writes[0].anchors,[['2SA',4,1,1]]);
    assert.deepEqual(desk.qaRequests,[],'writing a note does not load the QAP collection');
    await desk.dialog.getByRole('button',{name:'返回笔记列表'}).click();
    assert.equal(await desk.dialog.locator('.study-notes__text').textContent(),'ab笔');
    const phone=await visit(browser,390),phoneBar=await phone.select('4:1');
    await phoneBar.getByRole('button',{name:'写笔记'}).tap();await phone.login('a');
    const field=phone.dialog.getByRole('textbox',{name:'笔记正文'});await field.waitFor();
    await phone.page.waitForFunction(()=>document.querySelector('.study-notes__field')?.value==='ab笔');
    const before=await phone.dialog.boundingBox();
    assert.ok(before.height>=400,'the initial material window has room to write');
    assert.ok((await field.boundingBox()).height>=215,'the initial editor displays roughly eight lines');
    assert.ok((await phone.dialog.getByRole('tablist').boundingBox()).height<=32,'tabs leave room for text');
    await field.evaluate(el=>{
      el.focus({preventScroll:true});el.value=Array(24).fill('测试软键盘下编辑内容').join('\n');
      el.setSelectionRange(el.value.length,el.value.length);el.scrollTop=el.scrollHeight;
      window.testKeyboard({height:252,offsetTop:27});
    });
    await phone.dialog.locator('xpath=self::*[@data-note-keyboard]').waitFor();
    const lifted=await phone.dialog.boundingBox();
    assert.ok(lifted.y<before.y-70&&Math.abs(lifted.height-before.height)<1,'keyboard lifts rather than shrinks the window');
    assert.ok((await field.boundingBox()).y+(await field.boundingBox()).height>27+252,'keyboard may cover the lower part of the editor');
    const caretView=()=>field.evaluate(el=>{
      const css=getComputedStyle(el),r=el.getBoundingClientRect(),lines=el.value.slice(0,el.selectionEnd).split('\n').length;
      return {bottom:r.top+el.clientTop+parseFloat(css.paddingTop)+lines*parseFloat(css.lineHeight)-el.scrollTop,
        top:r.top,lines,height:r.height,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
        padding:css.paddingBottom};
    });
    await phone.page.waitForTimeout(160);
    const end=await caretView();assert.ok(end.bottom<27+252-4,'the last visible text line and caret clear the keyboard: '+JSON.stringify(end));
    await field.evaluate(el=>{el.setSelectionRange(0,0);el.dispatchEvent(new Event('selectionchange',{bubbles:true}));});
    await phone.page.waitForTimeout(160);
    const start=await caretView();assert.ok(start.scrollTop<=10&&start.bottom<27+252-4,'moving the caret up keeps the new line visible: '+JSON.stringify(start));
    await phone.page.evaluate(()=>window.testKeyboard(null));
    await phone.dialog.locator('xpath=self::*[@data-note-keyboard]').waitFor({state:'detached'});
    const returned=await phone.dialog.boundingBox();
    assert.ok(Math.abs(returned.y-before.y)<1&&Math.abs(returned.height-before.height)<1,'dismissing the keyboard restores normal geometry');
    assert.equal(await field.evaluate(el=>el.style.getPropertyValue('--note-keyboard-inset')),'');
    assert.equal(writes.length,5,'viewport tracking must not write notes');
    await phone.dialog.getByRole('button',{name:'关闭资料浮窗'}).tap();
    const readBar=await phone.select('4:1');await readBar.getByRole('button',{name:'查看资料'}).tap();
    assert.equal(await phone.dialog.getByRole('tab',{name:'笔记'}).getAttribute('aria-selected'),'true');
    assert.equal(await phone.dialog.locator('.study-notes__text').textContent(),'ab笔');
    assert.ok(!(await field.isVisible()));
    const other=await visit(browser,1280),otherBar=await other.select('4:1');
    await otherBar.getByRole('button',{name:'写笔记'}).click();await other.login('b');
    const otherField=other.dialog.getByRole('textbox',{name:'笔记正文'});await otherField.waitFor();assert.equal(await otherField.inputValue(),'');
    await other.dialog.getByRole('button',{name:'返回笔记列表'}).click();
    await other.dialog.getByText('所选经文还没有笔记。').waitFor();
    assert.ok(!(await other.dialog.getByText('ab笔',{exact:true}).isVisible()));
    const original=writes[0].anchor_key,add=desk.dialog.getByRole('button',{name:'新增笔记'});
    assert.equal(await desk.dialog.locator('.study-notes__list > :first-child').getAttribute('aria-label'),'新增笔记');
    await add.click();assert.equal(await edit.inputValue(),'');assert.equal(writes.length,5);
    await edit.fill('另一条独立笔记');await status.getByText('已同步',{exact:true}).waitFor();
    const second=writes.at(-1).anchor_key;assert.notEqual(second,original);
    assert.deepEqual(writes.at(-1).anchors,[['2SA',4,1,1]]);
    await desk.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='2');
    if(!enableLinks){
      assert.equal(await desk.dialog.getByRole('button',{name:'修改关联'}).count(),0);
      await desk.dialog.getByRole('button',{name:'返回笔记列表'}).click();
      assert.equal(await desk.dialog.locator('.study-notes__text').count(),2);
      assert.deepEqual([...desk.err,...phone.err,...other.err],[]);
      console.log('PASS new notes and chapter totals over the existing production RPC, with move controls disabled');return;
    }
    await desk.dialog.getByRole('button',{name:'修改关联'}).click();
    await desk.dialog.getByRole('button',{name:/移除关联/}).click();
    assert.ok(await desk.dialog.getByRole('button',{name:'保存关联'}).isDisabled());
    await desk.dialog.getByRole('combobox',{name:'章',exact:true}).selectOption('3');
    await desk.dialog.getByRole('button',{name:'添加关联'}).click();
    await desk.dialog.getByRole('button',{name:'保存关联'}).click();
    await status.getByText('已同步',{exact:true}).waitFor();
    assert.equal(writes.at(-1).anchor_key,second);assert.deepEqual(writes.at(-1).anchors,[['2SA',3]]);
    assert.equal(writes.at(-1).note_body,'另一条独立笔记');assert.equal(cloud.size,2);
    await desk.dialog.getByRole('button',{name:'返回笔记列表'}).click();
    assert.equal(await desk.dialog.locator('.study-notes__text').textContent(),'ab笔');
    await desk.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='1');
    assert.equal(await count(other,4,'notes').textContent(),'0');
    assert.deepEqual([...desk.err,...phone.err,...other.err],[]);
    console.log('PASS note editor, chapter counters, new and moved notes, keyboard layout, per-input sync, and account isolation');
  }finally{releaseSend();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
