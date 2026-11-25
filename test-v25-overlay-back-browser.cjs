'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:37164',before=origin+'/before',reader=origin+'/?v=index-25&ref=GEN.2:1';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const scheme of ['escape','close-request','history']){
      const android=scheme!=='escape';
      const ctx=await browser.newContext({viewport:{width:android?390:1280,height:840},isMobile:android,hasTouch:android,reducedMotion:'reduce',
        ...(android?{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Mobile Safari/537.36 EdgA/145.0'}:{})});
      try{
        await ctx.route('**/*',async route=>{
          const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
          if(url.pathname==='/before')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>上一网页</title>'});
          const file=path.resolve(__dirname,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
          if(!file.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        await ctx.addInitScript(scheme=>{
          localStorage.setItem('paper:v25:first-guide:1','seen');
          if(scheme==='history')Object.defineProperty(window,'CloseWatcher',{configurable:true,value:undefined});
          else if(scheme==='close-request'&&typeof CloseWatcher==='function'){
            window.CloseWatcher=class extends CloseWatcher{constructor(...args){super(...args);window.activeTestWatcher=this;}};
          }
        },scheme);
        const page=await ctx.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(before);await page.goto(reader,{waitUntil:'domcontentloaded'});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        const $=selector=>page.locator(selector);
        const depth=n=>page.waitForFunction(n=>(history.state?.paperV25OverlayBack||0)===n,n);
        const escape=()=>page.keyboard.press('Escape');
        const dismiss=scheme==='escape'?escape:scheme==='history'?()=>page.goBack():()=>page.evaluate(()=>window.activeTestWatcher.requestClose());
        const study=n=>page.evaluate(n=>V25ScriptureWindows.openStudy({key:'test-'+n,title:'资料 '+n,fullTitle:'资料 '+n,
          material:true,focus:true,render(section){section.textContent='测试资料 '+n;}}),n);
        const material=n=>$(`[data-study-key="study:test-${n}"]`);
        const pinned=$('.compare-slip[data-citation="PSA.23:1"]');
        const finder=$('#verse-finder'),preview=$('#v25-scripture-preview');

        // The already-fixed scripture should survive even if it owns focus.
        assert.equal(await page.evaluate(()=>V25ScriptureWindows.open({code:'PSA',ref:'23:1'})),true);
        await pinned.waitFor();
        assert.equal(await study(1),true);await material(1).waitFor();
        await page.keyboard.press('Control+k');await finder.waitFor();
        await $('#vf-input').fill('约3:16');
        await finder.getByRole('button',{name:'打开经文：约翰福音 3:16',exact:true}).click();
        await preview.waitFor();assert.ok(!await finder.isVisible());
        await depth(android?3:0);
        // A native dialog is above the reader layer and shouldn't dismiss it.
        const help=$('#help-dialog');
        await help.evaluate(el=>el.showModal());await help.waitFor();await depth(android?4:0);
        if(scheme==='close-request')await help.evaluate(el=>el.requestClose());
        else await dismiss();
        await help.waitFor({state:'hidden'});await depth(android?3:0);assert.ok(await preview.isVisible());
        if(!android)await pinned.locator('.compare-slip__scroll').focus();
        await dismiss();await preview.waitFor({state:'hidden'});await finder.waitFor();await depth(android?2:0);
        assert.ok(await material(1).isVisible()&&await pinned.isVisible());
        assert.equal(await $('#vf-input').inputValue(),'约3:16','closing the preview restores the submitted result');
        await dismiss();await finder.waitFor({state:'hidden'});await depth(android?1:0);
        assert.ok(await material(1).isVisible(),'one Back never also dismisses the study window');
        await dismiss();await material(1).waitFor({state:'hidden'});await depth(0);
        assert.equal(page.url(),reader);assert.ok(await pinned.isVisible());

        // Two study slips are dismissed in paint order, not DOM-slot or focus
        // order. A folded study is exempt, like a pinned scripture window.
        await pinned.locator('.compare-slip__scroll').press('ArrowDown');
        assert.equal(await study(2),true);assert.equal(await study(3),true);
        await material(2).locator('.compare-slip__scroll').focus();
        await depth(android?2:0);
        await dismiss();await material(2).waitFor({state:'hidden'});await depth(android?1:0);
        assert.ok(await material(3).isVisible());
        await material(3).getByRole('button',{name:'收起资料浮窗'}).click();
        await material(3).locator('xpath=self::*[@data-collapsed]').waitFor();
        await depth(0);
        await pinned.locator('.compare-slip__scroll').press('ArrowDown');
        assert.ok(await page.evaluate(()=>V25ScriptureWindows.openPreview([{code:'MAT',ref:'5:1'}],{kind:'footnote'})));
        await preview.waitFor();await depth(android?1:0);
        await preview.getByRole('button',{name:'固定经文浮窗'}).click();
        await preview.waitFor({state:'hidden'});await depth(0);
        const newPin=$('.compare-slip[data-citation="MAT.5:1"]');await newPin.waitFor();
        if(!android){
          await escape();assert.equal(page.url(),reader);
          assert.ok(await material(3).isVisible()&&await pinned.isVisible()&&await newPin.isVisible(),'folded slips and pins survive Esc');
        }
        await page.goBack();await page.waitForURL(before);
        assert.deepEqual(errors,[]);
        console.log('PASS '+scheme+': closes one unpinned layer at a time, then leaves normal browser history');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
