'use strict';
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const file=process.env.PREVIEW_FILE,base=process.argv[2],localOrigin='http://127.0.0.1:37129';
const url=new URL(file?pathToFileURL(path.resolve(file)):base||localOrigin);
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};
url.searchParams.set('v','index-25');url.searchParams.set('ref','2SA.3:1');url.searchParams.set('curl','off');
const takeURL=url.href;
async function run(browser,width){
  const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,
    reducedMotion:'reduce',offline:!!file});
  try{
    if(!file&&!base)await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!==localOrigin)return route.abort();
      const f=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
      if(!f.startsWith(__dirname+path.sep))return route.abort();
      try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
      catch{await route.fulfill({status:404,body:'Not found'});}
    });
    const page=await ctx.newPage(),errors=[],requests=[];
    const cdp=mobile?await ctx.newCDPSession(page):null;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes('/study-qa.json?'))requests.push(r.url());});
    await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
    const $=sel=>page.locator(sel),mainBar=$('#stage .paper-selection-tools'),root=$('html'),dialog=$('.compare-slip[data-kind=study]:not([hidden])');
    const chapter=n=>$('#stage .paper text[data-role="chapter"][data-ref="'+n+':1"]').first();
    const body=(ref)=>$('#stage .paper text[data-role="body"][data-ref="'+ref+'"]');
    const ready=()=>root.and($('html[data-rule-layout=ready]')).waitFor({state:'attached',timeout:90000});
    async function point(locator){
      return locator.evaluateAll(nodes=>{
        for(const el of nodes){
          const r=el.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
          if(r.width>1&&r.height>1&&el.contains(document.elementFromPoint(x,y)))return {x,y};
        }
        throw Error('No uncovered target ink at desired reference');
      });
    }
    async function press(locator,long=false){
      const p=await point(locator);
      if(mobile){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
        if(long)await page.waitForTimeout(510);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }else{
        await page.mouse.move(p.x,p.y);await page.mouse.down();
        if(long)await page.waitForTimeout(510);
        await page.mouse.up();
      }
    }
    const rendered=()=>dialog.locator('.study-qa__list details').first().waitFor({timeout:15000});
    const ids=()=>dialog.locator('details').evaluateAll(nodes=>nodes.map(n=>n.dataset.qap));
    const open=async(bar=mainBar)=>{await bar.locator('[data-study]').click();await dialog.waitFor();await rendered();};
    const close=async()=>{await dialog.getByRole('button',{name:'关闭问答浮窗'}).click();await dialog.waitFor({state:'hidden'});};
    const settings=$('#study-settings');
    const citation=$('#v25-scripture-preview:not([hidden])'),owned=$('.compare-slip[data-role=fixed]:not([hidden])');
    const expanded=$('.compare-slip:not([hidden]):not([data-collapsed])'),dock=$('#v25-compare-tabs');
    const title=dialog.locator('.compare-slip__title'),qapScroll=dialog.locator('.compare-slip__scroll');
    const bodyOf=(id)=>dialog.locator('[data-qap="'+id+'"]');
    const verseTag=(id)=>citation.locator('[data-verse-id="'+id+'"]');
    async function configure(enabled){
      await page.evaluate(()=>PaperImmersion.showChrome());
      await page.getByRole('button',{name:'阅读设置',exact:true}).click();
      await settings.waitFor();
      const toggle=settings.getByRole('switch');
      if(await toggle.isChecked()!==enabled)await toggle.click();
      await settings.getByRole('button',{name:'关闭阅读设置'}).click();
      await page.evaluate(()=>PaperImmersion.hideChrome());
    }
    const marked=async()=>chapter(3).evaluate(el=>getComputedStyle(el).textDecorationLine);
    await page.goto(takeURL,{waitUntil:'domcontentloaded',timeout:90000});await ready();
    await page.evaluate(()=>document.getElementById('fit-book').click());
    await page.waitForTimeout(250);
    assert.equal(requests.length,0,'normal reading should not download QAPs');
    assert.equal(await marked(),'none');

    await press(body('3:1'),true);
    await mainBar.waitFor({timeout:5000});
    await open();
    assert.ok((await ids()).includes('2SA.3.1'));
    assert.ok(!(await ids()).includes('2SA.3.4'),'verse selection cannot broaden into a chapter');
    assert.match(await title.textContent(),/思考问答 撒下 3:1/);
    assert.equal(await dialog.locator('.compare-slip__scroll h2,.study-qa__refs,#study-qa-scopes').count(),0,'no decorative labels or address lists in QAP content');
    assert.equal(await dialog.locator('.study-qa__status').textContent(),'');
    assert.equal(await dialog.locator('details[open]').count(),0);
    // A link in a folded question opens a reader, not its <details>.
    const first=bodyOf('2SA.3.1'),firstRef=first.getByRole('button',{name:/查看经文.*撒母耳记下3章1节/});
    await firstRef.click();await citation.waitFor();
    assert.equal(await first.getAttribute('open'),null);
    assert.equal(await verseTag('2SA.3:1').getAttribute('data-cited'),'');
    await page.keyboard.press('Escape');await citation.waitFor({state:'hidden'});
    assert.ok(await dialog.isVisible());
    assert.equal(await firstRef.getAttribute('aria-expanded'),'false');
    const second=bodyOf('2SA.3.2');
    for(const row of [first,second])await row.locator('summary').click({position:{x:13,y:19}});
    assert.equal(await dialog.locator('details[open]').count(),2);
    await dialog.locator('.study-qa__answer:visible').nth(1).waitFor();
    assert.equal(await dialog.locator('.study-qa__answer:visible').count(),2);
    // A link found in an answer can open a different book without jumping
    // the desk, replacing the QAP, or closing the answered question.
    const stand=await $('#stage').getAttribute('data-spread');
    const short=second.getByRole('button',{name:/查看经文.*申命记.*17:17/}).or(second.getByRole('button',{name:/查看经文.*申17:17/}));
    await short.first().click();await citation.waitFor();
    assert.equal(await verseTag('DEU.17:17').getAttribute('data-cited'),'');
    assert.equal(await $('#stage').getAttribute('data-spread'),stand);
    const offset=await qapScroll.evaluate(el=>el.scrollTop);
    await citation.getByRole('button',{name:'固定经文浮窗'}).click();
    await citation.waitFor({state:'hidden'});
    const pinned=$('.compare-slip[data-citation="DEU.17:17"]:not([hidden])');
    await pinned.waitFor();
    assert.ok(await dialog.isVisible());
    assert.notEqual(await second.getAttribute('open'),null);
    assert.equal(await qapScroll.evaluate(el=>el.scrollTop),offset,'pinning does not redraw or scroll QAP');
    assert.equal(await owned.count(),2,'QAP and pinned scripture share the same registry');
    await dialog.getByRole('button',{name:'收起问答浮窗'}).click();
    assert.equal(await dialog.getAttribute('data-collapsed'),'');
    assert.equal(await dock.locator('[data-kind=study]:not([hidden])').count(),1);
    assert.ok(await pinned.isVisible());
    await title.click();
    assert.equal(await dialog.getAttribute('data-collapsed'),null);
    assert.notEqual(await second.getAttribute('open'),null);
    assert.equal(await qapScroll.evaluate(el=>el.scrollTop),offset,'restoring a paper tab preserves position');
    await close();
    await pinned.getByRole('button',{name:'关闭经文浮窗'}).click();
    assert.equal(requests.length,file?0:1);

    await press(body('3:1'),true);
    await press(body('4:1'));
    await open();
    assert.ok((await ids()).includes('2SA.3.1'));
    assert.equal(await dialog.locator('#study-qa-position').count(),0);
    await close();

    await press(chapter(3),true);
    assert.ok(await mainBar.locator('[data-copy]').isDisabled(),'chapter title should not copy the first verse');
    await press($('#stage .paper text[data-role="heading"][data-ref="4:1"]'));
    await open();
    const multi=await ids();assert.equal(new Set(multi).size,multi.length);
    assert.match(await title.textContent(),/思考问答 撒下 3–4章/);
    assert.ok(multi.some(id=>id.startsWith('2SA.3.'))&&multi.some(id=>id.startsWith('2SA.4.')));
    const fromAnswer=bodyOf('2SA.3.4');
    await fromAnswer.locator('summary').click({position:{x:13,y:19}});
    await fromAnswer.getByRole('button',{name:/查看经文.*申21章/}).click();
    await citation.waitFor();
    assert.equal(await citation.locator('[data-cited]').count(),0,'chapter-only link does not cite verse 1');
    assert.ok(await verseTag('DEU.21:1').count());
    await citation.getByRole('button',{name:'关闭经文浮窗'}).click();
    await citation.waitFor({state:'hidden'});
    if(process.env.QAP_SCREENSHOTS){
      await dialog.locator('summary').first().click();
      await dialog.screenshot({path:path.join(process.env.QAP_SCREENSHOTS,'study-qa-'+width+'.png')});
    }
    await close();

    await configure(true);
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.equal(await marked(),'underline');
    const stroke=await chapter(3).evaluate(el=>{const c=getComputedStyle(el);return [c.textDecorationColor,parseFloat(c.textDecorationThickness)/parseFloat(c.fontSize)];});
    assert.match(stroke[0],/^rgba\(160, 128, 79, 0\.25/);assert.ok(stroke[1]<.035);
    assert.ok(await $('#stage .paper text[data-qap-mark="verse"]').count()>0);
    await page.reload({waitUntil:'domcontentloaded'});await ready();
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.equal(await marked(),'underline','mark setting survives reload');
    await configure(false);
    assert.equal(await marked(),'none');
    await press(chapter(3),true);
    await open();assert.ok((await ids()).includes('2SA.3.4'));
    await close();

    assert.ok(await page.evaluate(()=>V25ScriptureWindows.open({code:'2SA',ref:'3:1'})));
    const win=$('.compare-slip[data-citation="2SA.3:1"]:not([hidden])');
    const heading=win.locator('[data-study-chapter="2SA.3"]');
    await heading.waitFor();
    await heading.scrollIntoViewIfNeeded();
    // Chapter buffering can settle a scroll on the frame after the locator.
    await page.waitForTimeout(140);
    await press(heading,true);await open(win.locator('.paper-selection-tools'));
    assert.ok((await ids()).includes('2SA.3.4'));
    assert.ok(await win.isVisible(),'opening a QAP does not dismiss its source scripture');
    const managerOpen=(code,ref)=>page.evaluate(({code,ref})=>V25ScriptureWindows.open({code,ref}),{code,ref});
    for(const [code,ref] of [['GEN','1:1'],['EXO','2:2'],['ROM','8:1']])assert.ok(await managerOpen(code,ref));
    assert.equal(await owned.count(),5);
    assert.equal(await expanded.count(),3);
    assert.equal(await dock.locator('.compare-slip:not([hidden])').count(),2);
    const firstId=await dialog.getAttribute('id'),questionCount=(await ids()).length;
    await title.click(); // restore the QAP if it was auto-minimized
    const beforeLimit=await ids();
    assert.equal(questionCount,beforeLimit.length);
    assert.equal(await managerOpen('MAT','5:1'),false,'a sixth window cannot evict or replace any QAP/reader');
    assert.equal(await owned.count(),5);
    assert.equal(await dialog.getAttribute('id'),firstId);
    assert.match(await $('#v25-compare-limit').textContent(),/已有 5 个浮窗/);
    // A preview borrows expanded space but not one of the five slots.
    const known=bodyOf('2SA.3.4');
    await known.locator('summary').click({position:{x:13,y:19}});
    await known.getByRole('button',{name:/查看经文.*申21章/}).click();
    await citation.waitFor();
    assert.equal(await owned.count(),5);
    assert.equal(await expanded.count(),3);
    await citation.getByRole('button',{name:'固定经文浮窗'}).click();
    assert.ok(await citation.isVisible(),'failed sixth pin leaves the reference preview open');
    assert.equal(await dialog.getAttribute('data-collapsed'),null,'the originating QAP stays expanded while quoting');
    assert.notEqual(await known.getAttribute('open'),null);
    await citation.getByRole('button',{name:'关闭经文浮窗'}).click();
    assert.equal(await owned.count(),5);
    await close();
    assert.equal(await owned.count(),4);
    assert.deepEqual(errors,[]);
    console.log(width,'PASS QAP pin leaves answers intact, folds/restores, mixed-five cap, citations, settings and chapter selection');
  }finally{await ctx.close();}
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{for(const width of (process.env.QAP_WIDTHS||'1280,390').split(',').map(Number))await run(browser,width);}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
