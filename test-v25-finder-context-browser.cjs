'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const entry=process.argv[2],origin='http://127.0.0.1:37144',url=new URL(entry||origin);
url.searchParams.set('v','index-25');url.searchParams.set('ref','GEN.2:1');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const {width,height,touch=false} of [{width:1280,height:840},{width:390,height:840,touch:true},{width:320,height:700,touch:true}]){
      const ctx=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:'reduce'});
      try{
        if(!entry)await ctx.route('**/*',async route=>{
          const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
          const filename=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
          if(!filename.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,contentType:mime[path.extname(filename)],body:await fs.readFile(filename)});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        await ctx.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        await page.locator('#stage[data-v25-opening]').waitFor({state:'detached',timeout:12000});
        const pose=()=>page.locator('#stage').evaluate(el=>['spread','x','y','scale'].map(k=>el.dataset[k]));
        const activate=locator=>touch?locator.tap():locator.click();
        const finder=page.getByRole('complementary',{name:'经文检索笺',exact:true}),input=finder.getByRole('searchbox');
        const scopes=finder.locator('#vf-scopes'),context=finder.locator('#vf-context'),scroll=finder.locator('#vf-scroll');
        await page.evaluate(()=>PaperImmersion.showChrome());
        await activate(page.getByRole('button',{name:'搜索经文',exact:true}));
        await input.waitFor();
        assert.equal(await input.inputValue(),'');
        assert.ok(!await scopes.isVisible()&&!await context.isVisible(),'opening shows neither scopes nor a passage');
        const main=await pose(),address='创世记 5:15';
        await input.fill(address);
        const target=context.getByRole('button',{name:'打开经文：创世记 5:15',exact:true});
        await target.waitFor();
        assert.equal(await target.getAttribute('data-current'),'');
        assert.ok(!await scopes.isVisible());
        const targetPosition=await target.evaluate(el=>({top:el.offsetTop-el.offsetParent.scrollTop,height:el.offsetParent.clientHeight}));
        assert.ok(targetPosition.top>=0&&targetPosition.top<=12&&targetPosition.height>60,'opens at the requested verse');
        const bounds=()=>context.evaluate(el=>{
          const rows=el.querySelectorAll('[data-address-index]');
          return {first:+rows[0].dataset.addressIndex,last:+rows[rows.length-1].dataset.addressIndex};
        });
        const initial=await bounds();
        assert.ok(await context.locator('[data-ref="5:14"]').count());
        assert.ok(await context.locator('[data-ref="5:16"]').count());
        if(process.env.V25_FINDER_SCREENSHOTS){
          const dir=process.env.V25_FINDER_SCREENSHOTS;await fs.mkdir(dir,{recursive:true});
          await page.screenshot({path:path.join(dir,`${width}-coordinate-search.png`)});
        }
        const top=()=>scroll.evaluate(el=>el.scrollTop);
        const cdp=touch?await ctx.newCDPSession(page):null;
        async function move(delta){
          const {x,y,width,height}=await scroll.boundingBox(),cx=Math.round(x+width/2),cy=Math.round(y+height/2);
          if(!touch){await page.mouse.move(cx,cy);await page.mouse.wheel(0,delta);return;}
          const send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points}),
            distance=Math.min(height*.55,Math.abs(delta))*Math.sign(delta);
          await send('touchStart',[{x:cx,y:Math.round(cy+distance/2)}]);
          for(let i=1;i<=6;i++)await send('touchMove',[{x:cx,y:Math.round(cy+distance/2-distance*i/6)}]);
          await send('touchEnd');
        }
        let previous=await top();await move(125);
        await page.waitForFunction(last=>document.querySelector('#vf-scroll').scrollTop>last+15,previous);
        previous=await top();await move(-100);
        await page.waitForFunction(last=>document.querySelector('#vf-scroll').scrollTop<last-15,previous);
        assert.deepEqual(await pose(),main,'vertical gestures leave the main spread alone');
        async function reach(edge){
          await scroll.evaluate((el,edge)=>{el.scrollTop=edge==='before'?0:el.scrollHeight;el.dispatchEvent(new Event('scroll'));},edge);
        }
        await reach('before');await reach('after');
        const expanded=await bounds();
        assert.ok(expanded.first<initial.first&&expanded.last>initial.last,'loads both sides of the original window');
        assert.ok(await context.locator('[data-ref^="4:"]').count()&&await context.locator('[data-ref^="6:"]').count(),'reading continues across chapters');
        const neighbor=context.getByRole('button',{name:'打开经文：创世记 5:16',exact:true});
        await neighbor.scrollIntoViewIfNeeded();
        const anchor=await top();
        await activate(neighbor);
        const preview=page.getByRole('complementary',{name:'搜索结果经文浮窗'});
        await preview.waitFor();
        await activate(preview.getByRole('button',{name:'返回搜索结果'}));
        await context.waitFor();
        assert.equal(await input.inputValue(),address);
        assert.ok(Math.abs(await top()-anchor)<=3,'returning keeps the passage at the same reading position');
        assert.ok(!await scopes.isVisible());assert.deepEqual(await pose(),main);
        await input.fill(address);await page.keyboard.insertText('，');
        await context.getByRole('button',{name:'打开经文：创世记 5:15',exact:true}).waitFor();
        assert.equal(await input.getAttribute('data-address-preselected'),'');
        assert.ok(!await preview.isVisible()&&!await scopes.isVisible(),'a comma preselects but does not confirm, navigate, or search');
        await input.press('Delete');
        await input.fill(address+'，创世记 6:2');
        assert.ok(!await context.isVisible()&&!await scopes.isVisible(),'the toolbar does not locate two addresses at once');
        assert.equal(await finder.locator('#vf-list button').count(),0);
        const enter=()=>touch?input.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true}))):input.press('Enter');
        const suffix=finder.locator('.scripture-ghost__suffix');
        await input.fill('何西阿2');assert.equal(await suffix.textContent(),':1');
        await enter();await scopes.waitFor();
        assert.ok(!await preview.isVisible(),'an unconfirmed association-like query still goes to keyword search');
        await input.fill('何西阿2');const unselected=await input.evaluate(el=>getComputedStyle(el).color);
        await input.press('Space');
        assert.equal(await input.getAttribute('data-address-preselected'),'');
        assert.notEqual(await input.evaluate(el=>getComputedStyle(el).color),unselected);
        assert.ok(!await suffix.isVisible()&&!await scopes.isVisible());
        assert.equal(await finder.locator('#vf-status').textContent(),'已预选整章');
        await input.press('7');assert.equal(await input.inputValue(),'何西阿2','typing cannot replace a preselection');
        if(touch){
          await input.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'deleteContentBackward',bubbles:true,cancelable:true})));
        }else await input.press('Backspace');
        assert.equal(await input.inputValue(),'何西阿2','Delete/Backspace unlocks without deleting the address');
        assert.equal(await input.getAttribute('data-address-preselected'),null);
        await suffix.waitFor();assert.equal(await suffix.textContent(),':1');
        await page.keyboard.insertText('”');await enter();
        await preview.waitFor();
        await preview.locator('[data-chapter="2"] [data-ref="2:1"]').waitFor();
        assert.equal(await preview.locator('[data-cited]').count(),0,'the whole chapter was confirmed, not the ghost verse');
        assert.deepEqual(await pose(),main,'confirming the toolbar reference keeps the main spread untouched');
        await activate(preview.getByRole('button',{name:'返回搜索结果'}));await input.waitFor();
        await input.focus();await input.press('Delete');
        await input.fill('创造');
        assert.ok(!await scopes.isVisible()&&!await context.isVisible());
        assert.equal(await finder.locator('#vf-list button').count(),0);
        await enter();
        await scopes.waitFor();
        assert.deepEqual(await scopes.getByRole('button').allTextContents(),['全书','分类','书卷']);
        await finder.locator('#vf-list button').first().waitFor();
        await activate(scopes.getByRole('button',{name:'指定书卷',exact:true}));
        await activate(finder.getByRole('group',{name:'指定书卷'}).getByRole('button',{name:'创世记',exact:true}));
        const hits=finder.locator('#vf-list button strong');
        assert.ok((await hits.count())>0&&(await hits.allTextContents()).every(s=>s.startsWith('创世记 ')));
        await input.fill('约翰福音 3:16');
        await context.getByRole('button',{name:'打开经文：约翰福音 3:16',exact:true}).waitFor();
        assert.ok(!await scopes.isVisible(),'editing goes back to coordinate mode regardless of previous scope');
        assert.deepEqual(errors,[]);
        console.log(`PASS ${width} px: keyword-only scopes, inline cross-chapter reading in both directions, and preview return`);
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
