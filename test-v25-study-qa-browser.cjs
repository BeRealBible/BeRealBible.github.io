'use strict';
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const file=process.env.PREVIEW_FILE,base=process.argv[2];
if(!file&&!base)throw Error('Supply PREVIEW_FILE or a V25 URL');
const url=new URL(file?pathToFileURL(path.resolve(file)):base);
url.searchParams.set('v','index-25');url.searchParams.set('ref','2SA.3:1');url.searchParams.set('curl','off');
const takeURL=url.href;
async function run(browser,width){
  const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,
    reducedMotion:'reduce',offline:!!file});
  try{
    const page=await ctx.newPage(),errors=[],requests=[];
    const cdp=mobile?await ctx.newCDPSession(page):null;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes('/study-qa.json?'))requests.push(r.url());});
    await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
    const $=sel=>page.locator(sel),mainBar=$('#stage .paper-selection-tools'),root=$('html'),dialog=$('#study-qa');
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
    const rendered=()=>dialog.locator('#study-qa-list details').first().waitFor({timeout:15000});
    const ids=()=>dialog.locator('details').evaluateAll(nodes=>nodes.map(n=>n.dataset.qap));
    const open=async(bar=mainBar)=>{await bar.locator('[data-study]').click();await dialog.waitFor();await rendered();};
    const close=async()=>{await dialog.getByRole('button',{name:'关闭经文问答'}).click();await dialog.waitFor({state:'hidden'});};
    const settings=$('#study-settings');
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
    assert.match(await $('#study-qa-position').textContent(),/3:1/);
    assert.ok((await ids()).includes('2SA.3.1'));
    const verseCount=(await ids()).length;
    await dialog.getByRole('button',{name:'整章',exact:true}).click();
    assert.ok((await ids()).length>verseCount);
    assert.equal(await dialog.locator('details[open]').count(),0);
    for(let i=0;i<2;i++)await dialog.locator('summary').nth(i).click();
    assert.equal(await dialog.locator('details[open]').count(),2);
    await dialog.locator('.study-qa__answer:visible').nth(1).waitFor();
    assert.equal(await dialog.locator('.study-qa__answer:visible').count(),2);
    await close();
    assert.equal(requests.length,file?0:1);

    await press(body('3:1'),true);
    await press(body('4:1'));
    await open();
    assert.match(await $('#study-qa-position').textContent(),/3:1.*4:1/);
    assert.ok((await ids()).includes('2SA.3.1'));
    await close();

    await press(chapter(3),true);
    assert.ok(await mainBar.locator('[data-copy]').isDisabled(),'chapter title should not copy the first verse');
    await press($('#stage .paper text[data-role="heading"][data-ref="4:1"]'));
    await open();
    assert.match(await $('#study-qa-position').textContent(),/3章.*4章/);
    const multi=await ids();assert.equal(new Set(multi).size,multi.length);
    assert.ok(multi.some(id=>id.startsWith('2SA.3.'))&&multi.some(id=>id.startsWith('2SA.4.')));
    assert.ok(await $('#study-qa-scopes').isHidden());
    if(process.env.QAP_SCREENSHOTS){
      await dialog.locator('summary').first().click();
      await dialog.screenshot({path:path.join(process.env.QAP_SCREENSHOTS,'study-qa-'+width+'.png')});
    }
    await close();

    await configure(true);
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.equal(await marked(),'underline');
    assert.ok(await $('#stage .paper text[data-qap-mark="verse"]').count()>0);
    await page.reload({waitUntil:'domcontentloaded'});await ready();
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.equal(await marked(),'underline','mark setting survives reload');
    await configure(false);
    assert.equal(await marked(),'none');
    await press(chapter(3),true);
    await open();assert.match(await $('#study-qa-position').textContent(),/3章$/);
    await close();

    assert.ok(await page.evaluate(()=>V25ScriptureWindows.open({code:'2SA',ref:'3:1'})));
    const win=$('#v25-compare');
    const heading=win.locator('[data-study-chapter="2SA.3"]');
    await heading.waitFor();
    await heading.scrollIntoViewIfNeeded();
    await press(heading,true);await open(win.locator('.paper-selection-tools'));
    assert.ok((await ids()).includes('2SA.3.4'));
    await close();
    assert.ok(await win.isVisible(),'the QAP window does not consume or dismiss a fixed scripture window');
    assert.deepEqual(errors,[]);
    console.log(width,'PASS verse and chapter long-press, same-window expandable answers, multi-chapter, settings, fixed window');
  }finally{await ctx.close();}
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{for(const width of (process.env.QAP_WIDTHS||'1280,390').split(',').map(Number))await run(browser,width);}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
