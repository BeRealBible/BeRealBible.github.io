'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.argv[2],localOrigin='http://127.0.0.1:37129';
const url=new URL(site||localOrigin);
url.searchParams.set('ref','1KI.22:30');
url.searchParams.set('curl','off');
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};

async function check(browser,width){
  const touch=width<550,ctx=await browser.newContext({viewport:{width,height:850},isMobile:touch,hasTouch:touch,reducedMotion:'reduce'});
  try{
    if(!site)await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!==localOrigin)return route.abort();
      const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
      if(!file.startsWith(__dirname+path.sep))return route.abort();
      try{await route.fulfill({status:200,body:await fs.readFile(file),contentType:mime[path.extname(file)]});}
      catch{await route.fulfill({status:404,body:'Not found'});}
    });
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
    await page.locator('html[data-rule-layout=ready]').waitFor({state:'attached',timeout:90000});
    await page.locator('#stage[data-v25-opening]').waitFor({state:'detached',timeout:12000});
    await page.evaluate(()=>document.getElementById('fit-book').click());
    // Use the accessible chapter entry on both viewports; the broader Q&A
    // browser test already exercises the badge's pointer/touch hit testing.
    await page.locator('#stage [data-chapter-total="1KI.22"]').press('Enter');
    const row='.compare-slip[data-kind=study]:not([hidden]) details[data-qap="1KI.22.3"]';
    const question=page.locator(row+' summary');
    await question.waitFor();
    assert.match(await question.textContent(),/乔装改扮/);
    await page.evaluate(()=>document.fonts.ready);
    const cdp=await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root:{nodeId:root}}=await cdp.send('DOM.getDocument');
    async function platformFonts(selector){
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root,selector});
      assert.notEqual(nodeId,0,selector);
      return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
    }
    const captures=process.env.QAP_FONT_CAPTURES;
    if(captures){
      await fs.mkdir(captures,{recursive:true});
      await question.screenshot({path:path.join(captures,`${width}-1KI22-question.png`)});
    }
    const fonts=await platformFonts(row+' summary');
    assert.ok(fonts.some(f=>f.isCustomFont&&f.postScriptName==='PaperStudySerif-Regular'),JSON.stringify(fonts));
    assert.ok(fonts.some(f=>f.isCustomFont&&f.postScriptName==='NotoSerifSC-Regular'),JSON.stringify(fonts));
    assert.ok(fonts.every(f=>f.isCustomFont),JSON.stringify(fonts));
    assert.equal(await question.evaluate(el=>getComputedStyle(el).fontWeight),'600');
    if(touch)await question.tap();
    else await question.click();
    const answer=page.locator(row+' .study-qa__answer p').first();
    await answer.waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const answerFonts=await platformFonts(row+' .study-qa__answer p');
    assert.ok(answerFonts.length&&answerFonts.every(f=>f.isCustomFont),JSON.stringify(answerFonts));
    assert.equal(await answer.evaluate(el=>getComputedStyle(el).fontWeight),'400');
    const emphasis=answer.locator('strong').first();
    assert.match(await emphasis.textContent(),/理性的割裂/);
    assert.ok(Number(await emphasis.evaluate(el=>getComputedStyle(el).fontWeight))>400);
    assert.deepEqual(errors,[]);
    console.log(width,'PASS 1 Kings 22 question and answer use web fonts; answer keeps intentional emphasis');
  }finally{await ctx.close();}
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{for(const width of (process.env.QAP_WIDTHS||'1280,390').split(',').map(Number))await check(browser,width);}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
