'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:37165',entry=process.argv[2];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const url=new URL(entry||origin);
url.searchParams.set('ref','GEN.1:1');
const seenKey='paper:v25:first-guide:1';

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    const ctx=await browser.newContext({viewport:{width:1280,height:840},reducedMotion:'reduce'});
    try{
      if(!entry) await ctx.route('**/*',async route=>{
        const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
        const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
        if(!file.startsWith(__dirname+path.sep))return route.abort();
        try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
        catch{await route.fulfill({status:404,body:'Not found'});}
      });
      const page=await ctx.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url.href,{waitUntil:'domcontentloaded'});
      await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
      const guide=page.locator('#paper-guide'),finder=page.locator('#verse-finder'),
        zoom=page.locator('#pcz-panel'),zoomButton=page.locator('.pcz-button'),
        stage=page.locator('#stage');
      const ready=()=>guide.waitFor({state:'visible',timeout:5000});
      const seen=()=>page.evaluate(key=>localStorage.getItem(key),seenKey);
      await ready();
      assert.equal(await seen(),null);
      await page.keyboard.press('Control+k');
      await finder.waitFor();
      assert.equal(await guide.isVisible(),false,'the reading guide yields to the search slip');
      await page.keyboard.press('Escape');
      assert.equal(await finder.isVisible(),false,'one Esc closes the visible search slip, not the concealed guide');
      await ready();
      assert.equal(await seen(),null,'temporarily concealing the guide must not finish it');
      await page.evaluate(()=>PaperImmersion.showChrome());
      await zoomButton.waitFor();
      await zoomButton.focus();
      await page.keyboard.press('Enter');
      await zoom.waitFor();
      assert.equal(await guide.isVisible(),false,'the guide also yields to the zoom control');
      await page.keyboard.press('Escape');
      assert.equal(await zoom.isVisible(),false,'one Esc closes the visible zoom control');
      assert.equal(await zoomButton.evaluate(el=>el===document.activeElement),true);
      await ready();
      await guide.getByRole('button',{name:'下一步'}).focus();
      await page.keyboard.press('Escape');
      await guide.waitFor({state:'hidden'});
      assert.equal(await seen(),'seen','dismissing the visible guide still completes it');
      assert.equal(await stage.evaluate(el=>el===document.activeElement),true);
      assert.deepEqual(errors,[]);
      console.log('PASS: only the visible search/zoom layer consumes Esc; the visible guide can still be dismissed');
    }finally{await ctx.close();}
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
