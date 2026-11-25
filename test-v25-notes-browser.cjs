'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.V25_NOTES_TEST_ORIGIN||'http://127.0.0.1:37136',api='https://v25-note-test.supabase.co';
const liveAssets=process.env.V25_NOTES_LIVE_ASSETS==='1';
const previous=origin+'/v25-test-back-previous';
const target=origin+'/?v=index-25&curl=off',enableLinks=process.env.V25_NOTES_LEGACY_API!=='1';
const enableSpans=enableLinks&&process.env.V25_NOTES_NO_SPANS!=='1';
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};
const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'apikey,authorization,content-type','access-control-allow-methods':'POST,OPTIONS'};
const accounts={a:{id:'27426463-0000-0000-0000-000000000001',email:'a@example.test'},b:{id:'27426463-0000-0000-0000-000000000002',email:'b@example.test'}};
const cloud=new Map(),writes=[];
const shots=process.env.V25_NOTES_SCREENSHOTS;
async function snapshot(reader,name){
  if(!shots)return;
  await fs.mkdir(shots,{recursive:true});
  await reader.page.screenshot({path:path.join(shots,name+'.png')});
}
let releaseSend,hold=new Promise(r=>{releaseSend=r;});
async function visit(browser,width,holdNotes,ref='2SA.3:1'){
  const mobile=width<550;
  const ctx=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',
    ...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Mobile Safari/537.36 EdgA/145.0'}:{})});
  await ctx.addInitScript(mobile=>{
    localStorage.setItem('paper:v25:first-guide:1','seen');
    const systemClipboard=navigator.clipboard;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      async write(items){
        if(window.denyRichNoteCopy)throw new DOMException('Rich clipboard blocked','NotAllowedError');
        assertClipboardShape(items);
        if(window.testNativeNoteClipboard)await systemClipboard.write(items);
        window.copiedNoteRich=Object.fromEntries(await Promise.all(items[0].types.map(async type=>[type,await (await items[0].getType(type)).text()])));
      },
      async writeText(text){window.copiedNotePlain=text;},
      readNative:()=>systemClipboard.read()
    }});
    function assertClipboardShape(items){
      if(items.length!==1||!(items[0] instanceof ClipboardItem))throw new TypeError('expected one ClipboardItem');
    }
    if(!mobile)return;
    if(typeof window.CloseWatcher==='function')window.CloseWatcher=class extends window.CloseWatcher{
      constructor(...args){super(...args);window.lastReaderCloseWatcher=this;}
    };
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
      if(u.pathname.endsWith('/paper_v25_note_list'+(enableSpans?'_v2':''))){
        await holdNotes;
        return respond([...cloud.values()].filter(row=>row.owner===who));
      }
      if(u.pathname.endsWith('/paper_v25_note_write'+(enableSpans?'_v3':enableLinks?'_v2':''))){
        writes.push({who,...args});
        if(writes.length===1)await hold;
        const key=who+':'+args.anchor_key,old=cloud.get(key);
        if((old?.revision||0)!==args.expected_revision)return respond({ok:false,revision:old?.revision||0,body:old?.body||'',refs:old?.refs??null});
        const revision=args.expected_revision+1;
        cloud.set(key,{owner:who,note_key:args.anchor_key,refs:args.anchors,anchor_objects:args.anchor_objects??null,body:args.note_body,revision});
        return respond({ok:true,revision});
      }
      return respond({},404);
    }
    if(u.origin!==origin)return route.abort();
    if(u.href===previous)return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Previous page for Back test</title>'});
    if(u.pathname==='/v25/account-config.js')return route.fulfill({contentType:'text/javascript',body:
      `window.V25_ACCOUNT_CONFIG=${JSON.stringify({url:api,publishableKey:'sb_publishable_demo',notesOrigin:origin,pagesIsolationVerified:true,noteReanchorEnabled:enableLinks,noteSpanEnabled:enableSpans})};`});
    if(liveAssets)return route.continue(); // Still use the intercepted fake account service, never real notes.
    const f=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if(!f.startsWith(__dirname+path.sep))return route.abort();
    try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
    catch{await route.fulfill({status:404,body:'Not found'});}
  });
  const page=await ctx.newPage(),err=[],qaRequests=[];
  page.on('pageerror',e=>err.push(e.message));
  page.on('request',r=>{if(r.url().includes('/study-qa.json?'))qaRequests.push(r.url());});
  if(mobile)await page.goto(previous);
  await page.goto(target+'&ref='+encodeURIComponent(ref),{waitUntil:'domcontentloaded',timeout:90000});
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
  async function swipe(el,dx,dy,fingers=1){
    const {x,y,width,height}=await el.boundingBox();
    const start={x:x+width*(dx<0?.77:.23),y:y+Math.min(height/2,30)};
    const points=t=>[0,1].slice(0,fingers).map(i=>({x:start.x+dx*t,y:start.y+dy*t+i*12}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(0)});
    for(const t of [.25,.5,.75,1])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(t)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  return {ctx,page,select,login,swipe,err,qaRequests,dialog:page.locator('.compare-slip[data-kind=study]:not([hidden])')};
}
async function until(cond){for(let i=0;i<100;i++){if(cond())return;await new Promise(r=>setTimeout(r,30));}assert.ok(cond(),'timed out waiting for request');}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    const desk=await visit(browser,1280),bar=await desk.select('4:1');
    const count=(reader,ch,kind)=>reader.page.locator(`#stage [data-chapter-total="2SA.${ch}"] [data-chapter-count="${kind}"]`).first();
    await count(desk,4,'qa').waitFor();assert.equal(await count(desk,4,'qa').textContent(),'6');
    assert.equal(await count(desk,4,'notes').count(),0,'guests get no placeholder');
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
    const returnToNotes=reader=>reader.dialog.getByRole('button',{name:'返回笔记列表'});
    const addNote=reader=>reader.dialog.getByRole('button',{name:'新增笔记',exact:true});
    const noteButton=(reader,body)=>reader.dialog.locator('.study-notes__item').filter({hasText:body}).getByRole('button',{name:/查看笔记：/});
    const readNote=reader=>reader.dialog.locator('.study-notes__view');
    const editNote=reader=>readNote(reader).getByRole('button',{name:'编辑笔记',exact:true});
    const finishEdit=reader=>reader.dialog.getByRole('button',{name:'完成编辑',exact:true});
    const closeMaterials=reader=>reader.dialog.getByRole('button',{name:'关闭资料浮窗'});
    const writeFromVerse=async reader=>(await reader.select('4:1')).getByRole('button',{name:'写笔记'}).click();
    await closeMaterials(desk).click();
    await writeFromVerse(desk);
    assert.equal(await edit.inputValue(),'','one cached note must not turn create into edit');
    assert.equal(await desk.dialog.getByRole('button',{name:'查看关联经文：撒母耳记下 4:1',exact:true}).count(),1);
    assert.equal(writes.length,5,'an empty new draft does not overwrite or add a note');
    await returnToNotes(desk).click();
    assert.equal(await desk.dialog.locator('.study-notes__text').textContent(),'ab笔');
    let releasePhone;
    const phoneNotes=new Promise(resolve=>{releasePhone=resolve;});
    const phone=await visit(browser,Number(process.env.V25_NOTES_MOBILE_WIDTH)||390,phoneNotes),phoneBar=await phone.select('4:1');
    await phoneBar.getByRole('button',{name:'写笔记'}).tap();await phone.login('a');
    const field=phone.dialog.getByRole('textbox',{name:'笔记正文'});await field.waitFor();
    try{
      assert.equal(await field.inputValue(),'');
      assert.equal(await count(phone,4,'notes').count(),0,'loading account notes does not leave a placeholder');
    }finally{releasePhone();}
    await phone.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='1');
    assert.equal(await field.inputValue(),'','late cloud notes must not take over a new draft');
    const before=await phone.dialog.boundingBox();
    await snapshot(phone,'phone-note');
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
    if(enableLinks){
      const query=phone.dialog.getByRole('textbox',{name:'经文关键词或地址'});
      assert.ok(!await query.isVisible(),'the note opens with verified links and plus only');
      const phonePlus=phone.dialog.getByRole('button',{name:'添加关联经文',exact:true});
      assert.ok(await phonePlus.evaluate(el=>el.previousElementSibling?.classList.contains('study-notes__chip')),'plus follows the last association');
      await phonePlus.tap();
      assert.ok(await query.isVisible(),'one visible input');
      assert.equal(await query.getAttribute('placeholder'),'输入经文坐标或搜索关键词');
      assert.equal(await query.getAttribute('enterkeyhint'),'search');
      assert.equal(await phone.dialog.getByRole('button',{name:'按关键词搜索',exact:true}).count(),0);
      await query.waitFor({state:'hidden',timeout:7000});
      await phonePlus.waitFor();
      await phonePlus.tap();
      assert.ok(!await phone.dialog.getByRole('button',{name:/搜索范围/}).isVisible(),'range is not an address control');
      assert.equal(await phone.dialog.locator('.study-notes__search textarea').count(),1);
      await snapshot(phone,'phone-open');
      await query.tap();
      await phone.page.evaluate(()=>window.testKeyboard({height:252,offsetTop:27}));
      await phone.dialog.locator('xpath=self::*[@data-note-keyboard]').waitFor();
      const rect=await query.boundingBox();
      assert.ok(rect.y+rect.height<=279,'the shared input clears the keyboard');
      await phone.page.evaluate(()=>window.testKeyboard(null));
      const pick=(name)=>phone.dialog.getByRole('button',{name:'选择：'+name,exact:true});
      const region=phone.dialog.getByRole('region',{name:'可选经文'});
      await query.fill('创世纪');await pick('创世记 1:1').waitFor();
      const ghost=phone.dialog.locator('.study-notes__lookup .scripture-ghost__suffix');
      await ghost.waitFor();assert.equal(await ghost.textContent(),' 1:1');assert.equal(await query.inputValue(),'创世纪');
      assert.ok(await ghost.evaluate(el=>getComputedStyle(el).color!==getComputedStyle(el.closest('.study-notes__lookup').querySelector('textarea')).color));
      await snapshot(phone,'phone-address-completion');
      await ghost.tap();assert.equal(await query.inputValue(),'创世纪 1:1','tap the suggestion without a Shift key');
      assert.equal(await phone.dialog.getByRole('button',{name:/已选 \d/}).count(),0,'accepting the suffix is not a pick');
      await query.fill('路');await pick('路加福音 1:1').waitFor();
      await query.press('2');await pick('路加福音 2:1').waitFor();
      await pick('路加福音 2章').waitFor();
      await phone.page.keyboard.insertText(':');
      await pick('路加福音 2:1').waitFor();assert.equal(await ghost.textContent(),'1','a typed colon suggests the first valid verse');
      await query.press('3');await pick('路加福音 2:3').waitFor();
      await query.press('1');await pick('路加福音 2:31').waitFor();
      await query.fill('路2:99');
      assert.equal(await region.locator('[role=button],button').count(),0,'an absent verse has no fallback');
      await query.fill('路2:13');
      const verse13=pick('路加福音 2:13'),verse12=pick('路加福音 2:12'),verse14=pick('路加福音 2:14');
      const verseTop=el=>el.getClientRects()[0].top-el.closest('[data-browse]').getBoundingClientRect().top;
      const pickedCount=n=>phone.dialog.getByRole('button',{name:'已选 '+n+' 处',exact:true});
      await verse13.waitFor();
      assert.ok(await verse13.evaluate(el=>el.tagName==='SPAN'&&getComputedStyle(el).display==='inline'&&
        el.parentElement.tagName==='P'&&el.previousElementSibling?.dataset.ref==='2:12'&&el.nextElementSibling?.dataset.ref==='2:14'),
      'neighboring verses flow inline in their actual paragraph');
      assert.ok(await pick('路加福音 2:15').evaluate(el=>el.parentElement.firstElementChild===el),'the next actual paragraph starts at verse 15');
      assert.ok(Math.abs(await verse13.evaluate(verseTop))<12,'the typed verse line is positioned at the top');
      assert.ok(await verse12.evaluate(verseTop)<0,'verse 12 starts above the target');
      await region.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="2:12"]').offsetTop-5;});
      assert.ok(Math.abs(await verse12.evaluate(verseTop))<12,'the preceding verse can be scrolled into view');
      await verse12.tap();assert.equal(await verse12.getAttribute('aria-pressed'),'true');
      await verse13.tap();assert.equal(await verse13.getAttribute('aria-pressed'),'true');
      await pickedCount(1).waitFor();
      await verse14.tap();await pickedCount(1).waitFor();
      await verse13.tap();assert.equal(await verse13.getAttribute('aria-pressed'),'false','tapping the middle verse again splits the run');
      await pickedCount(2).waitFor();
      await verse13.tap();await pickedCount(1).waitFor();
      assert.equal(writes.length,5,'tapping verses stages them without saving');
      await query.fill('拔示巴进入内室见王');
      assert.equal(await phone.dialog.locator('.study-notes__result').count(),0,'typing words does not search by default');
      const finder=phone.page.getByRole('complementary',{name:'笔记经文检索笺'}),chooseBook=finder.getByRole('group',{name:'指定书卷'});
      assert.ok(!await finder.isVisible());
      await query.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true})));
      assert.equal(await finder.getByRole('searchbox').inputValue(),'拔示巴进入内室见王');
      await finder.getByRole('button',{name:'指定书卷',exact:true}).tap();
      await chooseBook.getByRole('button',{name:'列王纪上',exact:true}).tap();
      assert.ok(!await chooseBook.isVisible(),'selecting a book closes only the scope picker');
      await finder.getByRole('button',{name:/列王纪上 1:15/}).tap();
      const reader=phone.page.getByRole('complementary',{name:'选取关联经文浮窗'});
      const hit=reader.getByRole('button',{name:'选择：列王纪上 1:15',exact:true});
      await hit.tap();assert.equal(await hit.getAttribute('aria-pressed'),'true');
      assert.ok(await reader.getByRole('button',{name:'确定加入笔记'}).isEnabled());
      await snapshot(phone,'phone-keyword-verse');
      await reader.getByRole('button',{name:'返回搜索结果'}).tap();
      assert.ok(await finder.isVisible(),'return from the reader reveals the same search');
      await finder.getByRole('button',{name:'关闭检索笺'}).tap();
      assert.equal(await query.inputValue(),'拔示巴进入内室见王');
      await query.fill('王上1：15到20节');
      await pick('列王纪上 1:15–20').waitFor();
      await phone.page.evaluate(()=>window.testKeyboard({height:252,offsetTop:27}));
      await phone.dialog.locator('xpath=self::*[@data-note-keyboard]').waitFor();
      const searchRect=await query.boundingBox();
      assert.ok(searchRect.y+searchRect.height<=279,'the search input clears the keyboard');
      await phone.page.evaluate(()=>window.testKeyboard(null));
      await snapshot(phone,'phone-search');
      const tabs=phone.dialog.getByRole('tablist'),tab=name=>tabs.getByRole('tab',{name,exact:true});
      const assertTab=async name=>assert.equal(await tab(name).getAttribute('aria-selected'),'true');
      await phone.swipe(query,-65,0);await assertTab('笔记');
      await phone.swipe(tabs,3,-65);await assertTab('笔记');
      await phone.swipe(tabs,-75,2,2);await assertTab('笔记');
      await phone.swipe(tabs,-75,2);await assertTab('问答');
      await phone.swipe(tabs,-75,1);await assertTab('问答'); // No wrapping at the right-hand tab.
      await phone.swipe(tabs,75,1);await assertTab('笔记');
      assert.equal(await query.inputValue(),'王上1：15到20节','swipe preserves the uncommitted association');
      await pick('列王纪上 1:15–20').waitFor();
      await pickedCount(1).waitFor();
      const collapse=phone.dialog.getByRole('button',{name:'收起关联选择',exact:true});
      await collapse.tap();
      // CDP's first compatibility tap after raw touch moves can be lost.
      // Reproduced with the app's swipe listeners removed as well.
      if(!await query.waitFor({state:'hidden',timeout:600}).then(()=>true,()=>false))await collapse.tap();
      await query.waitFor({state:'hidden',timeout:2500});
    }
    assert.equal(writes.length,5,'viewport tracking must not write notes');
    await returnToNotes(phone).tap();
    assert.equal(await phone.dialog.locator('.study-notes__text').textContent(),'ab笔');
    assert.ok(await addNote(phone).isVisible(),'returning from write always shows a plus');
    assert.equal(await phone.dialog.getByRole('button',{name:'编辑笔记',exact:true}).count(),0,'editing is not offered in the list');
    await noteButton(phone,'ab笔').tap();
    await readNote(phone).getByRole('heading',{name:'引用经文'}).waitFor();
    assert.equal(await readNote(phone).locator('.study-notes__view-text').textContent(),'ab笔');
    assert.ok(await readNote(phone).locator('[data-note-verse="2SA.4:1"]').isVisible(),'the entire cited verse is immediately visible');
    assert.ok(await readNote(phone).evaluate(el=>{
      const pane=el.closest('.compare-slip__scroll');
      return pane.scrollWidth<=pane.clientWidth+1&&el.querySelector('.study-notes__view-text').getBoundingClientRect().bottom<
        el.querySelector('.study-notes__references').getBoundingClientRect().top;
    }),'the narrow view keeps the note above the verses without horizontal overflow');
    assert.ok(!await field.isVisible());
    assert.equal(await addNote(phone).count(),0,'the plus belongs to the list, not the detail');
    assert.ok(await phone.page.evaluate(()=>document.activeElement.tagName!=='TEXTAREA'),'reading a note never raises the keyboard');
    assert.equal(writes.length,5,'opening the detail is read-only');
    await snapshot(phone,'mobile-note-detail');
    await returnToNotes(phone).tap();
    assert.ok(await noteButton(phone,'ab笔').evaluate(el=>el===document.activeElement));
    assert.ok(await addNote(phone).isVisible(),'returning from the detail shows the same plus');
    await noteButton(phone,'ab笔').tap();
    await editNote(phone).tap();
    assert.equal(await field.inputValue(),'ab笔','only Edit in the detail opens the editor');
    assert.ok(await field.evaluate(el=>el===document.activeElement));
    assert.equal(writes.length,5,'opening an existing note does not write anything');
    await finishEdit(phone).tap();
    assert.ok(await readNote(phone).isVisible());assert.ok(!await field.isVisible());
    await closeMaterials(phone).tap();
    const readBar=await phone.select('4:1');await readBar.getByRole('button',{name:'查看资料'}).tap();
    assert.equal(await phone.dialog.getByRole('tab',{name:'笔记'}).getAttribute('aria-selected'),'true');
    assert.equal(await phone.dialog.locator('.study-notes__text').textContent(),'ab笔');
    assert.ok(!(await field.isVisible()));
    assert.ok(await addNote(phone).isVisible(),'opening a note-only selection directly shows the plus');
    const other=await visit(browser,1280),otherBar=await other.select('3:1');
    await otherBar.getByRole('button',{name:'查看资料'}).click();
    const otherTab=name=>other.dialog.getByRole('tab',{name,exact:true});
    assert.equal(await otherTab('问答').getAttribute('aria-selected'),'true');
    assert.equal(await addNote(other).count(),0,'no note creation button on the Q&A tab');
    await otherTab('笔记').click();
    await other.dialog.getByText('登录后可查看自己的云端笔记。').waitFor();
    await addNote(other).click();await other.login('b');
    const otherField=other.dialog.getByRole('textbox',{name:'笔记正文'});await otherField.waitFor();assert.equal(await otherField.inputValue(),'');
    const otherAnchor=other.dialog.getByRole('button',{name:'查看关联经文：撒母耳记下 3:1',exact:true});
    assert.ok(await otherAnchor.isVisible(),'creation after login still uses the selected passage');
    await returnToNotes(other).click();
    await other.dialog.getByText('所选经文还没有笔记。').waitFor();
    await otherTab('问答').click();await otherTab('笔记').click();
    assert.ok(await addNote(other).isVisible(),'a signed-in empty list entered from Q&A has the plus');
    await addNote(other).click();assert.equal(await otherField.inputValue(),'');
    assert.ok(await otherAnchor.isVisible());assert.equal(await addNote(other).count(),0,'only the association control stays in the editor');
    await returnToNotes(other).click();
    assert.ok(!(await other.dialog.getByText('ab笔',{exact:true}).isVisible()));
    const original=writes[0].anchor_key,add=addNote(desk);
    assert.equal(await desk.dialog.locator('.study-material__bar').getByRole('button',{name:'新增笔记'}).count(),1);
    await add.click();assert.equal(await edit.inputValue(),'');assert.equal(writes.length,5);
    await edit.fill('另一条独立笔记');await status.getByText('已同步',{exact:true}).waitFor();
    const second=writes.at(-1).anchor_key;assert.notEqual(second,original);
    assert.deepEqual(writes.at(-1).anchors,[['2SA',4,1,1]]);
    await desk.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='2');
    await closeMaterials(desk).click();
    await writeFromVerse(desk);await edit.waitFor({timeout:2500});
    assert.equal(await edit.inputValue(),'','multiple notes must not turn create into a list');
    await returnToNotes(desk).click();
    assert.deepEqual((await desk.dialog.locator('.study-notes__text').allTextContents()).sort(),['ab笔','另一条独立笔记'].sort());
    await noteButton(desk,'另一条独立笔记').press('Enter');
    assert.ok(await readNote(desk).getByRole('heading',{name:'笔记正文'}).evaluate(el=>el===document.activeElement));
    await editNote(desk).click();
    assert.equal(await edit.inputValue(),'另一条独立笔记');
    assert.equal(cloud.get('a:'+original).body,'ab笔');
    if(!enableLinks){
      assert.equal(await desk.dialog.getByRole('button',{name:/修改关联：/}).count(),0);
      await finishEdit(desk).click();await returnToNotes(desk).click();
      assert.equal(await desk.dialog.locator('.study-notes__text').count(),2);
      assert.deepEqual([...desk.err,...phone.err,...other.err],[]);
      console.log('PASS new notes and chapter totals over the existing production RPC, with move controls disabled');return;
    }
    const refInput=desk.dialog.getByRole('textbox',{name:'经文关键词或地址'});
    const remove=name=>desk.dialog.getByRole('button',{name:'移除关联：'+name,exact:true});
    const chip=name=>desk.dialog.getByRole('button',{name:'查看关联经文：'+name,exact:true});
    const pick=name=>desk.dialog.getByRole('button',{name:'选择：'+name,exact:true});
    const plus=desk.dialog.getByRole('button',{name:'添加关联经文',exact:true});
    const done=desk.dialog.getByRole('button',{name:'确定',exact:true});
    const stamp=()=>status.getByText('已同步',{exact:true}).waitFor();
    const typeRef=async(value,punct)=>{await refInput.fill(value);await desk.page.keyboard.insertText(punct);};
    assert.equal(await refInput.count(),0);
    assert.ok(await remove('撒母耳记下 4:1').isDisabled());
    await remove('撒母耳记下 4:1').evaluate(el=>el.click());
    assert.equal(await chip('撒母耳记下 4:1').count(),1,'last link cannot be removed even on a forced click');
    await plus.click();
    await refInput.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await new Promise(resolve=>setTimeout(resolve,5200));
    assert.ok(await refInput.isVisible(),'blank Chinese IME composition does not time out');
    await refInput.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    const beforeBad=writes.length;
    await typeRef('王中1:15','；');
    await desk.dialog.getByText(/经文不存在/).waitFor();
    assert.equal(await refInput.getAttribute('aria-invalid'),'true');assert.equal(writes.length,beforeBad);
    assert.equal(await refInput.inputValue(),'王中1:15；');
    await refInput.fill('王上1:15');assert.ok(await done.isDisabled());
    await typeRef('王上1:15','，');
    await refInput.fill('王上1:16');await pick('列王纪上 1:16').click();
    await desk.dialog.getByRole('button',{name:'已选 1 处',exact:true}).waitFor();
    await refInput.fill('王上1:18');await pick('列王纪上 1:18').press('Space');
    await desk.dialog.getByRole('button',{name:'已选 2 处',exact:true}).waitFor();
    assert.equal(writes.length,beforeBad);assert.equal(await chip('列王纪上 1:15').count(),0);
    await done.click();await stamp();
    assert.equal(writes.length,beforeBad+1,'the chosen verses save together');
    assert.deepEqual(writes.at(-1).anchors,[['2SA',4,1,1],['1KI',1,15,16],['1KI',1,18,18]],'adjacent verses form one range, without bridging a gap');
    await chip('列王纪上 1:15–16').click();
    const preview=desk.page.getByRole('complementary',{name:'引用经文浮窗'});
    await preview.getByText(/拔示巴进入内室见王/).first().waitFor();
    await preview.getByRole('button',{name:'关闭经文浮窗'}).click();
    await snapshot(desk,'desktop-note');
    await plus.click();
    await refInput.evaluate(el=>{
      el.dispatchEvent(new Event('paste',{bubbles:true}));
      el.value='哈拿回答说：“主啊，不是这样。”\n( 撒母耳记上 1:15 和合本 )';
      el.setSelectionRange(el.value.length,el.value.length);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
    });
    const beforePaste=writes.length;assert.equal(await chip('撒母耳记上 1:15').count(),0);
    await refInput.focus();await desk.page.keyboard.insertText('。');
    await desk.dialog.getByRole('button',{name:'已选 1 处',exact:true}).waitFor();
    assert.equal(writes.length,beforePaste);
    await done.click();await stamp();
    assert.equal(writes.length,beforePaste+1);assert.equal(await refInput.count(),0);
    assert.equal(await edit.inputValue(),'另一条独立笔记');
    const ordinaryFinder=desk.page.getByRole('complementary',{name:'经文检索笺',exact:true});
    await desk.page.evaluate(()=>PaperImmersion.showChrome());
    await desk.page.getByRole('button',{name:'搜索经文',exact:true}).click();
    const ordinaryQuery=ordinaryFinder.getByRole('searchbox'),ordinarySuffix=ordinaryFinder.locator('.scripture-ghost__suffix');
    await ordinaryQuery.fill('创世纪');await ordinaryFinder.getByRole('button',{name:'打开经文：创世记 1:1',exact:true}).waitFor();
    assert.equal(await ordinarySuffix.textContent(),' 1:1');assert.equal(await ordinaryQuery.inputValue(),'创世纪');
    await snapshot(desk,'desktop-address-completion');
    await ordinaryQuery.press('Shift+ArrowLeft');assert.equal(await ordinaryQuery.inputValue(),'创世纪','Shift used as a modifier does not accept');
    await ordinaryQuery.press('End');await ordinaryQuery.press('Shift');assert.equal(await ordinaryQuery.inputValue(),'创世纪 1:1');
    await ordinaryQuery.fill('创世记 2');assert.equal(await ordinarySuffix.textContent(),':1');
    await ordinaryQuery.press('Shift');assert.equal(await ordinaryQuery.inputValue(),'创世记 2:1');
    await ordinaryQuery.fill('耶和华是我的牧者');
    assert.equal(await ordinaryFinder.locator('#vf-list button').count(),0,'typing words never searches the whole Bible');
    await ordinaryQuery.dispatchEvent('compositionstart',{data:'未确认'});
    await ordinaryQuery.press('Enter');assert.equal(await ordinaryFinder.locator('#vf-list button').count(),0,'IME confirmation is not search');
    await ordinaryQuery.dispatchEvent('compositionend',{data:'耶和华是我的牧者'});
    await ordinaryQuery.press('Enter');await ordinaryFinder.getByRole('button',{name:/诗篇 23:1/}).waitFor();
    await ordinaryQuery.fill('普通检索留在原处');await ordinaryQuery.press('Enter');
    await ordinaryFinder.getByRole('button',{name:'收起检索笺'}).click();
    await plus.click();
    const finder=desk.page.getByRole('complementary',{name:'笔记经文检索笺'}),
      searchQuery=finder.getByRole('searchbox'),cats=finder.getByRole('group',{name:'书卷分类'}),
      reader=desk.page.getByRole('complementary',{name:'选取关联经文浮窗'}),
      readerConfirm=reader.getByRole('button',{name:'确定加入笔记'});
    await refInput.fill('爱是恒久忍耐');
    assert.equal(await desk.dialog.locator('.study-notes__result').count(),0);
    await refInput.press('Enter');
    await finder.getByRole('button',{name:'分类',exact:true}).click();
    await cats.getByRole('button',{name:'四福音书',exact:true}).click();
    await finder.getByText('未找到经文',{exact:true}).waitFor();
    await finder.getByRole('button',{name:'四福音书',exact:true}).click();
    await cats.getByRole('button',{name:'保罗书信',exact:true}).click();
    const beforeSearch=writes.length;
    assert.equal(await searchQuery.inputValue(),'爱是恒久忍耐','scope changes preserve the query');
    await finder.getByRole('button',{name:/哥林多前书 13:4/}).click();
    await reader.waitFor();assert.ok(await readerConfirm.isDisabled(),'opening a hit is not a selection');
    assert.equal(writes.length,beforeSearch);
    await reader.getByRole('button',{name:'选择：哥林多前书 13:4',exact:true}).click();
    assert.equal(writes.length,beforeSearch);
    await readerConfirm.click();await stamp();
    assert.equal(writes.length,beforeSearch+1);assert.equal(await chip('哥林多前书 13:4').count(),1);
    assert.ok(await finder.isVisible());
    assert.equal(await searchQuery.inputValue(),'爱是恒久忍耐','confirmation leaves the same finder in place');
    await finder.getByRole('button',{name:'全书',exact:true}).click();
    await searchQuery.fill('耶和华是我的牧者');
    assert.equal(await finder.locator('#vf-list button').count(),0);
    await searchQuery.press('Enter');
    await finder.getByRole('button',{name:/诗篇 23:1/}).click();
    await reader.getByRole('button',{name:'选择：诗篇 23:1',exact:true}).click();
    await readerConfirm.click();await stamp();
    assert.equal(await chip('诗篇 23:1').count(),1,'one finder session adds from successive reader windows');
    assert.equal(writes.length,beforeSearch+2);
    await finder.getByRole('button',{name:'关闭检索笺'}).click();
    await desk.page.keyboard.press('Control+k');
    assert.equal(await ordinaryFinder.getByRole('searchbox').inputValue(),'普通检索留在原处','note lookup does not replace the ordinary search session');
    await ordinaryFinder.getByRole('button',{name:'收起检索笺'}).click();
    if(enableSpans){
      await refInput.fill('王上1:53~2:3');
      await pick('列王纪上 1:53–2:3').waitFor();
      await desk.dialog.getByText('经文地址 · 跨章',{exact:true}).waitFor();
      assert.equal(await chip('列王纪上 1:53–2:3').count(),0,'a valid suggestion is not yet attached');
      await typeRef('列王纪上第一章五十三节至第二章三节','；');
      await desk.dialog.getByRole('button',{name:'已选 1 处',exact:true}).waitFor();
      assert.equal(writes.length,beforeSearch+2);
      await done.click();await stamp();
      assert.deepEqual(writes.at(-1).anchor_objects.find(r=>r.length===5),['1KI',1,53,2,3]);
      assert.deepEqual(writes.at(-1).anchors.filter(r=>r[0]==='1KI'&&(r[2]===53||r[1]===2)),[['1KI',1,53,53],['1KI',2,1,3]]);
      await chip('列王纪上 1:53–2:3').click();
      await preview.locator('[data-cited][data-ref="2:1"]').waitFor({state:'attached',timeout:2500});
      await preview.getByRole('button',{name:'关闭经文浮窗'}).click();
    }else await desk.dialog.getByRole('button',{name:'收起关联选择',exact:true}).click();
    if(enableSpans){
      const saved=await visit(browser,1280),bar=await saved.select('4:1');
      await bar.getByRole('button',{name:'写笔记'}).click();await saved.login('a');
      await returnToNotes(saved).click();
      await noteButton(saved,'另一条独立笔记').click();
      const view=readNote(saved),span=view.locator('.study-notes__passage').filter({has:saved.page.getByRole('heading',{name:'列王纪上 1:53–2:3',exact:true})});
      assert.deepEqual(await span.locator('[data-note-verse]').evaluateAll(els=>els.map(el=>el.dataset.noteVerse)),['1KI.1:53','1KI.2:1','1KI.2:2','1KI.2:3']);
      assert.equal(await span.locator('details,button').count(),0,'cross-chapter verse text is not behind a control');
      assert.equal(await view.locator('.study-notes__passage').count(),7,'all saved associations are expanded together');
      await editNote(saved).click();
      assert.equal(await saved.dialog.getByRole('button',{name:'查看关联经文：列王纪上 1:53–2:3',exact:true}).count(),1,'fresh account cache reconstructs one span');
      assert.deepEqual(saved.err,[]);await saved.ctx.close();
      await remove('列王纪上 1:53–2:3').click();await stamp();
      assert.equal(writes.at(-1).anchor_objects,null,'removing one span removes its grouping and all projections');
      assert.ok(!writes.at(-1).anchors.some(r=>r[0]==='1KI'&&(r[2]===53||r[1]===2)));
    }
    await plus.click();await typeRef('诗篇1章','；');await done.click();await stamp();
    const literal='另一条独立笔记\n\n读到这里，想到**信心**也需要在日常的小事上操练。\n<em>原样保留</em>';
    await edit.fill(literal);await stamp();
    const beforeReading=writes.length;
    const copy=desk.dialog.getByRole('button',{name:'复制笔记和引用经文',exact:true});
    assert.ok(await copy.evaluate(el=>el.previousElementSibling?.textContent==='完成编辑'));
    if(process.env.V25_NOTES_NATIVE_CLIPBOARD==='1'){
      await desk.ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin});
      await desk.page.evaluate(()=>{window.testNativeNoteClipboard=true;});
    }
    await copy.click();
    await desk.page.waitForFunction(()=>window.copiedNoteRich);
    const {'text/plain':copied,'text/html':html}=await desk.page.evaluate(()=>window.copiedNoteRich);
    assert.ok(copied.startsWith(literal.replace('**信心**','信心')+'\n\n'),'copy preserves the whole note above quotations');
    const expectedPsalm=await desk.page.evaluate(()=>[...BIBLE_SOURCE.books.find(b=>b.code==='PSA').chapters[0].verses.map(([,text])=>text).join('')].slice(0,49).join('')+'…');
    assert.equal(copied.match(/诗篇 1章\n([^\n]+)/u)?.[1],expectedPsalm);
    const shortVerse=await desk.page.evaluate(()=>BIBLE_SOURCE.books.find(b=>b.code==='PSA').chapters[22].verses[0][1]);
    assert.equal(copied.match(/诗篇 23:1\n([^\n]+)/u)?.[1],shortVerse);
    assert.match(html,/<strong>信心<\/strong>/);
    assert.ok(html.includes('&lt;em&gt;原样保留&lt;/em&gt;')&&!html.includes('<em>原样保留</em>'));
    const htmlPsalm=async source=>desk.page.evaluate(source=>{
      const parsed=new DOMParser().parseFromString(source,'text/html');
      const label=[...parsed.querySelectorAll('strong')].find(el=>el.textContent==='诗篇 1章');
      const quote=label?.parentElement.nextElementSibling;
      return quote?.matches('blockquote')?quote.textContent:null;
    },source);
    assert.equal(await htmlPsalm(html),expectedPsalm,'the rich payload puts the excerpt in a quote under the bold reference');
    if(process.env.V25_NOTES_NATIVE_CLIPBOARD==='1'){
      const native=await desk.page.evaluate(async()=>{
        const [item]=await navigator.clipboard.readNative();
        return Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await (await item.getType(type)).text()])));
      });
      assert.equal(native['text/plain'].replace(/\r\n/g,'\n'),copied);
      assert.equal(await htmlPsalm(native['text/html']),expectedPsalm,'the browser clipboard round-trip retains both reference and quote');
    }
    await desk.page.evaluate(()=>{window.denyRichNoteCopy=true;});
    await copy.click();
    await desk.page.waitForFunction(()=>window.copiedNotePlain);
    assert.equal(await desk.page.evaluate(()=>window.copiedNotePlain),copied,'blocked rich copy falls back to the same readable text');
    assert.equal(writes.length,beforeReading,'copy does not write');
    await finishEdit(desk).click();
    const showNote=readNote(desk),psalm=showNote.locator('.study-notes__passage').filter({has:desk.page.getByRole('heading',{name:'诗篇 1章',exact:true})});
    assert.equal(await showNote.locator('.study-notes__view-text').textContent(),literal);
    assert.equal(await showNote.locator('.study-notes__view-text em').count(),0,'saved notes remain plain text');
    assert.ok(await showNote.evaluate(el=>el.querySelector('.study-notes__view-text').compareDocumentPosition(el.querySelector('.study-notes__references'))&Node.DOCUMENT_POSITION_FOLLOWING));
    assert.deepEqual(await psalm.locator('[data-note-verse]').evaluateAll(els=>els.map(el=>[el.dataset.noteVerse,el.lastChild.textContent])),await desk.page.evaluate(()=>
      BIBLE_SOURCE.books.find(b=>b.code==='PSA').chapters.find(c=>Number(c.chapter)===1).verses.map(([n,text])=>['PSA.1:'+n,text])));
    await snapshot(desk,'desktop-note-detail');
    const lastVerse=psalm.locator('[data-note-verse="PSA.1:6"]');
    await lastVerse.scrollIntoViewIfNeeded();
    assert.ok(await lastVerse.evaluate(el=>{
      const pane=el.closest('.compare-slip__scroll'),r=el.getBoundingClientRect(),p=pane.getBoundingClientRect();
      return pane.scrollTop>0&&r.top>=p.top&&r.bottom<=p.bottom+1;
    }),'the end of a long passage is reachable by scrolling the detail, without expanding anything');
    assert.equal(await writes.length,beforeReading);
    await editNote(desk).click();
    await edit.fill('另一条独立笔记');await stamp();
    await remove('诗篇 1章').click();await stamp();
    await desk.dialog.getByRole('button',{name:'修改关联：撒母耳记下 4:1',exact:true}).click();
    const modify=desk.dialog.getByRole('textbox',{name:'修改关联经文'});
    const beforeEdit=writes.length;
    await modify.fill('撒下3:99');await desk.page.keyboard.insertText('.');
    assert.equal(await modify.getAttribute('aria-invalid'),'true');assert.equal(writes.length,beforeEdit);
    assert.equal(await chip('撒母耳记下 4:1').count(),1,'invalid replacements leave the verified address alone');
    await modify.press('Escape');assert.equal(await chip('撒母耳记下 4:1').count(),1);assert.equal(writes.length,beforeEdit);
    await desk.dialog.getByRole('button',{name:'修改关联：撒母耳记下 4:1',exact:true}).click();
    await modify.fill('撒下3');await modify.press('Enter');
    assert.equal(writes.length,beforeEdit);
    await done.click();await stamp();
    assert.deepEqual(writes.at(-1).anchors.find(r=>r[0]==='2SA'),['2SA',3]);
    for(const name of ['列王纪上 1:15–16','列王纪上 1:18','撒母耳记上 1:15','哥林多前书 13:4','诗篇 23:1']){
      await remove(name).click();await stamp();
    }
    assert.ok(await remove('撒母耳记下 3章').isDisabled());
    await status.getByText('已同步',{exact:true}).waitFor();
    assert.equal(writes.at(-1).anchor_key,second);assert.deepEqual(writes.at(-1).anchors,[['2SA',3]]);
    assert.equal(writes.at(-1).note_body,'另一条独立笔记');assert.equal(cloud.size,2);
    const Genesis=n=>Array.from({length:n},(_,i)=>'创'+(i+1)).join(';');
    await plus.click();const beforeLimit=writes.length;
    await typeRef(Genesis(10),'；');
    await desk.dialog.getByText('每条笔记最多关联 10 处经文',{exact:true}).filter({visible:true}).waitFor();
    assert.ok(await done.isDisabled());assert.equal(writes.length,beforeLimit);
    await desk.dialog.getByRole('button',{name:'收起关联选择',exact:true}).click();
    await plus.click();await typeRef(Genesis(9),'；');await done.click();await stamp();
    assert.equal(writes.at(-1).anchors.length,10);
    await plus.click();assert.equal(await refInput.count(),0,'the plus cannot add an eleventh association');
    for(let n=1;n<=9;n++){await remove('创世记 '+n+'章').click();await stamp();}
    await finishEdit(desk).click();await returnToNotes(desk).click();
    assert.equal(await desk.dialog.locator('.study-notes__text').textContent(),'ab笔');
    await desk.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='1');
    assert.equal(await count(other,4,'notes').count(),0,'a confirmed zero is not drawn');
    await closeMaterials(phone).tap();
    const chapterBadge=phone.page.locator('#stage [data-chapter-total="2SA.4"]');
    await chapterBadge.waitFor();
    await phone.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await phone.page.waitForFunction(()=>document.querySelector('#stage [data-chapter-total="2SA.4"] [data-chapter-count="notes"]')?.textContent==='1');
    assert.deepEqual(await chapterBadge.locator('[data-chapter-count]').allTextContents(),['6','1']);
    const badgeNotes=await chapterBadge.locator('[data-chapter-count="notes"]').boundingBox();
    await phone.page.touchscreen.tap(badgeNotes.x+badgeNotes.width/2,badgeNotes.y+badgeNotes.height/2);
    const noteTab=phone.dialog.getByRole('tab',{name:'笔记',exact:true}),qaTab=phone.dialog.getByRole('tab',{name:'问答',exact:true});
    await noteTab.waitFor();assert.equal(await noteTab.getAttribute('aria-selected'),'true');
    assert.deepEqual(await phone.dialog.getByRole('tab').allTextContents(),['笔记','问答']);
    assert.ok(await addNote(phone).evaluate(el=>el.getBoundingClientRect().right<=el.closest('.study-material__bar').querySelector('[role=tab]').getBoundingClientRect().left+.5),'the plus is just before Notes');
    await phone.swipe(noteButton(phone,'ab笔'),-65,1);
    assert.equal(await qaTab.getAttribute('aria-selected'),'true','swipe from a note row to Q&A');
    await phone.dialog.locator('.study-qa__list details').first().waitFor();
    assert.equal(await phone.dialog.locator('.study-qa__list details').count(),6);
    assert.equal(await addNote(phone).count(),0,'the plus is not a Q&A action');
    await phone.swipe(phone.dialog.locator('.study-qa__list summary').first(),65,0);
    assert.equal(await noteTab.getAttribute('aria-selected'),'true','swipe from a question row back to Notes');
    await phone.page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await noteTab.evaluate(el=>getComputedStyle(el).borderBottomColor),'rgb(137, 92, 68)','the visible underline follows Notes');
    await snapshot(phone,'mobile-chapter-overview');
    const chapterNote=noteButton(phone,'ab笔');await chapterNote.tap();
    // Chromium may drop the first compatibility click after a raw CDP swipe.
    if(!await readNote(phone).waitFor({timeout:650}).then(()=>true,()=>false))await chapterNote.tap();
    await readNote(phone).waitFor();
    const readingURL=phone.page.url();
    await phone.page.waitForFunction(()=>history.state?.paperV25NoteBack===true);
    await phone.page.goBack();await phone.dialog.waitFor({state:'hidden'});
    assert.equal(phone.page.url(),readingURL,'browser history Back only closes the open note');
    await (await phone.select('4:1')).getByRole('button',{name:'查看资料'}).tap();
    for(let i=0;i<16;i++){
      const id='N:'+String(100+i).padStart(32,'0');
      cloud.set('a:'+id,{owner:'a',note_key:id,refs:[['2SA',4,1,1]],body:'测试笔记 '+i,revision:1});
    }
    await phone.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await noteButton(phone,'测试笔记 15').waitFor();
    const mobileAdd=addNote(phone),initialY=(await mobileAdd.boundingBox()).y;
    const noteScroll=phone.dialog.locator('.compare-slip__scroll');
    assert.ok(await noteScroll.evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop>0;}),'the note list can scroll');
    const pinned=await mobileAdd.boundingBox();
    assert.ok(Math.abs(initialY-pinned.y)<1&&pinned.height<=34,'plus stays on the compact top row while scrolling');
    await snapshot(phone,'mobile-note-list-add');
    const beforeBlank=writes.length;
    await mobileAdd.tap();assert.equal(await field.inputValue(),'');assert.equal(writes.length,beforeBlank);
    if(await phone.page.evaluate(()=>typeof window.lastReaderCloseWatcher?.requestClose==='function')){
      await phone.page.evaluate(()=>window.lastReaderCloseWatcher.requestClose());
      await phone.dialog.waitFor({state:'hidden'});
      assert.equal(phone.page.url(),readingURL,'native CloseWatcher closes only the note window');
    }else await closeMaterials(phone).tap();
    await phone.page.waitForFunction(()=>!history.state?.paperV25NoteBack);
    await phone.page.goBack();await phone.page.waitForURL(previous);

    const exodus=await visit(browser,1280,null,'EXO.4:1'),exoBadge=exodus.page.locator('#stage [data-chapter-total="EXO.4"]');
    assert.equal(await exodus.page.locator('#stage').getAttribute('data-book'),'EXO');
    await exodus.page.locator('#stage text[data-role="chapter"][data-ref="4:1"]').waitFor();
    assert.equal(await exoBadge.count(),0,'the chapter with no known material draws no badge or target');
    const sampleNote={owner:'b',note_key:'N:77777777777777777777777777777777',refs:[['EXO',4,2,10],['EXO',4,12,12]],body:'出埃及记第 4 章的范围笔记',revision:1};
    cloud.set('b:'+sampleNote.note_key,sampleNote);
    await exodus.page.evaluate(()=>V25Account.openDialog());await exodus.login('b');
    await exoBadge.waitFor();
    assert.deepEqual(await exoBadge.locator('[data-chapter-count]').allTextContents(),['1'],'only the positive note item exists; both references count once');
    const noteCue=(ref)=>exodus.page.locator(`#stage [data-note-mark="verse"][data-ref="${ref}"]`);
    await noteCue('4:2').first().waitFor({state:'attached'});
    assert.equal(await noteCue('4:3').count(),0,'a later verse in the linked range is not marked');
    await noteCue('4:12').first().waitFor({state:'attached'});
    await exoBadge.click();
    assert.equal(await exodus.dialog.getByRole('tab',{name:'笔记'}).getAttribute('aria-selected'),'true');
    await noteButton(exodus,sampleNote.body).waitFor();
    await closeMaterials(exodus).click();
    cloud.set('b:'+sampleNote.note_key,{...sampleNote,body:'',revision:2});
    await exodus.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await exoBadge.waitFor({state:'detached'});
    assert.deepEqual(exodus.err,[]);await exodus.ctx.close();
    assert.deepEqual([...desk.err,...phone.err,...other.err],[]);
    console.log('PASS persistent list creation from Q&A, guest sign-in and long lists; read-only detail, explicit edit, formatted copy with plain fallback, address editing, keyboard layout, ordered sync, and account isolation');
  }finally{releaseSend();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
