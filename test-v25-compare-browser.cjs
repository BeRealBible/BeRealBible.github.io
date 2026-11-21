'use strict';
// PLAYWRIGHT_MODULE may point to a bundled Playwright installation.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const origin='http://127.0.0.1:37129';
const type={'.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf'};
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||undefined,headless:true});
  try{
    for(const width of [1280,390]){
      const mobile=width<500,context=await browser.newContext({viewport:{width,height:840},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.protocol==='file:'&&process.env.PREVIEW_FILE&&url.pathname===pathToFileURL(process.env.PREVIEW_FILE).pathname)return route.continue();
        if(url.origin!==origin)return route.abort();
        const file=path.resolve(__dirname,'.'+decodeURIComponent(url.pathname));
        if(!file.startsWith(__dirname+path.sep))return route.abort();
        try{return await route.fulfill({status:200,body:await fs.readFile(file),contentType:type[path.extname(file)]});}
        catch{return route.fulfill({status:404,body:'not found'});}
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{
        localStorage.setItem('paper:v25:first-guide:1','seen');
        window.copyTest=[];
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copyTest.push(text)}});
      });
      const preview=process.env.PREVIEW_FILE?pathToFileURL(process.env.PREVIEW_FILE).href:origin+'/index.html';
      await page.goto(preview+'?ref=GEN.1:1&curl=off',{timeout:90000});
      await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
      const $=s=>page.locator(s),stage=$('#stage'),float=$('#v25-compare'),bar=$('.paper-selection-tools');
      const fit=async()=>{await page.evaluate(()=>document.getElementById('fit-book').click());await page.waitForTimeout(180);};
      const chrome=()=>page.evaluate(()=>PaperImmersion.showChrome());
      const touch=mobile?await context.newCDPSession(page):null;
      const send=(type,points)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      const byPage=(ref,pdf)=>page.evaluate(({ref,pdf})=>{
        for(const el of document.querySelectorAll('.paper svg[data-pdf="'+pdf+'"] text[data-role=body][data-ref="'+ref+'"]')){
          const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
          if(r.width>1&&document.elementFromPoint(x,y)===el)return {x,y};
        }
      },{ref,pdf});
      async function mark(ref,pdf,hold=false){
        await page.waitForTimeout(100);
        const p=await byPage(ref,pdf);assert.ok(p,'visible ink for '+pdf+':'+ref);
        if(!mobile){await page.mouse.move(p.x,p.y);await page.mouse.down();if(hold)await page.waitForTimeout(430);await page.mouse.up();}
        else{await send('touchStart',[p]);if(hold)await page.waitForTimeout(430);await send('touchEnd',[]);}
      }
      async function turn(right,want){await stage.focus();await page.keyboard.press(right?'ArrowRight':'ArrowLeft');await stage.waitFor();
        await page.waitForFunction(n=>Number(document.getElementById('stage').dataset.spread)===n,want);await page.waitForTimeout(100);}
      const shelf=()=>page.evaluate(()=>[...document.querySelectorAll('.rh-chip')].map(n=>({text:n.textContent,id:n.dataset.id,current:n.getAttribute('aria-current')})));
      const jump=async(q,book,ref)=>{
        await page.keyboard.press('Control+k');await $('#vf-input').fill(q);await $('#vf-list button').first().click();
        await $('#vf-preview .citation-jump').click();
        const close=$('#vf-close');if(await close.isVisible())await close.click();
        await page.waitForFunction(({book,ref})=>document.querySelector('.rh-chip[aria-current=page]')?.getAttribute('aria-label').endsWith(ref)&&document.getElementById('stage').dataset.book===book,{book,ref});
      };
      await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      await mark('1:31',9,true);await bar.waitFor();
      await turn(true,10);await bar.waitFor();assert.equal(await bar.getAttribute('data-pages'),'1');
      await mark('2:1',10);assert.equal(await bar.getAttribute('data-pages'),'2');
      await page.evaluate(()=>document.getElementById('zoom-in').click());
      await fit();assert.equal(await bar.getAttribute('data-pages'),'2');
      await turn(false,8);assert.equal(await $('.paper-ink-mark--selected').count(),1);
      await bar.locator('[data-copy]').click();await bar.waitFor({state:'detached'});
      const [quote]=await page.evaluate(()=>copyTest);
      assert.match(quote,/天地万物都造齐了。\n\( 创世记 1:31-2:1 和合本 \)/);
      assert.equal((quote.match(/神看着/g)||[]).length,1);
      console.log(width,'cross-page clipboard passed');
      await mark('1:31',9,true);await turn(true,10);await mark('2:1',10);
      await bar.locator('[data-float]').click();await float.waitFor();
      assert.equal(await float.getAttribute('data-page'),'9');assert.equal(await $('.compare-slip__verse[data-cited]').count(),1);
      await jump('创 3:1','GEN','3:1');assert.equal(await float.getAttribute('data-page'),'9');
      await chrome();const main=await stage.getAttribute('data-spread');
      assert.equal((await shelf()).filter(r=>r.text==='创 3').length,1);
      const threeId=(await shelf()).find(r=>r.text==='创 3').id;
      const area=$('.compare-slip__scroll');
      await area.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(500);
      if(mobile){
        const box=await area.boundingBox(),p={x:box.x+45,y:box.y+box.height*.72};
        await send('touchStart',[p]);await send('touchMove',[{x:p.x,y:p.y-48}]);await send('touchEnd',[]);
      }else{await area.hover();await page.mouse.wheel(0,280);}
      await page.waitForFunction(()=>document.getElementById('v25-compare').dataset.page==='10');
      await area.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="2:5"]').offsetTop;});
      await page.waitForFunction(()=>[...document.querySelectorAll('.rh-chip')].some(n=>n.textContent==='创 2'));
      assert.equal((await shelf())[0].text,'创 2');
      assert.equal((await shelf()).find(r=>r.current==='page').id,threeId);
      await $('.compare-slip__page[aria-label="浮窗下一页"]').click();
      await page.waitForFunction(()=>document.getElementById('v25-compare').dataset.page==='11');
      assert.equal(await stage.getAttribute('data-spread'),main);
      assert.equal((await shelf()).filter(r=>r.text==='创 3').length,1);assert.equal((await shelf())[0].id,threeId);
      assert.ok((await float.boundingBox()).width<(mobile?width*.81:width*.45));
      if(process.env.COMPARE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'v25-compare-'+width+'.png')});
      async function drag(handle,dx,dy){
        const pos=await handle.boundingBox(),p={x:pos.x+pos.width*.5,y:pos.y+pos.height*.5};
        if(!mobile){await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:6});await page.mouse.up();}
        else{await send('touchStart',[p]);await send('touchMove',[{x:p.x+dx,y:p.y+dy}]);await send('touchEnd',[]);}
      }
      const before=await float.boundingBox();await drag($('.compare-slip__title'),-38,mobile?-42:40);
      const moved=await float.boundingBox();assert.ok(moved.x<before.x-24&&Math.abs(moved.y-before.y)>25);
      await drag($('.compare-slip__resize'),-35,-35);
      const smaller=await float.boundingBox();assert.ok(smaller.width<moved.width-20&&smaller.height<moved.height-20);
      await $('[aria-label="收起经文浮窗"]').click();assert.ok((await float.boundingBox()).height<64);
      await $('[aria-label="展开经文浮窗"]').click();assert.equal(await float.getAttribute('data-page'),'11');
      await $('[aria-label="关闭经文浮窗"]').click();await float.waitFor({state:'hidden'});
      await chrome();
      const one=$('.rh-chip').filter({hasText:'创 1'});
      if(!mobile)await one.hover();
      else{
        const r=await one.boundingBox();await send('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await page.waitForTimeout(470);await send('touchEnd',[]);
      }
      await $('[aria-label^="在浮窗打开 创世记 1:"]').click();
      await float.waitFor();assert.equal(await float.getAttribute('data-page'),'9');assert.equal(await stage.getAttribute('data-spread'),main);
      await $('[aria-label="关闭经文浮窗"]').click();await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      await mark('2:1',10,true);await page.keyboard.press('Control+k');await bar.waitFor({state:'detached'});
      assert.equal(await $('.paper-ink-mark--selected').count(),0);assert.ok(await $('#vf-input').isVisible());
      assert.deepEqual(errors,[]);
      console.log(width,'PASS cross-page copy & zoom, non-modal floating reader, two-way history dedupe, drag & resize, minimize, search reset');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
