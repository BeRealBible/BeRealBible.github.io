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
        const finder=page.getByRole('complementary',{name:'定位搜索框',exact:true}),input=finder.getByRole('searchbox',{name:'定位搜索框'});
        const trigger=page.getByRole('button',{name:'定位搜索框',exact:true}),
          clear=finder.getByRole('button',{name:'清空输入',exact:true}),
          end=finder.getByRole('button',{name:'结束检索',exact:true});
        const scopes=finder.locator('#vf-scopes'),context=finder.locator('#vf-context'),scroll=finder.locator('#vf-scroll');
        await page.evaluate(()=>PaperImmersion.showChrome());
        await activate(trigger);
        await input.waitFor();
        assert.equal(await input.inputValue(),'');
        assert.ok(!await scopes.isVisible()&&!await context.isVisible(),'opening shows neither scopes nor a passage');
        assert.ok(!await clear.isVisible()&&!await finder.locator('#vf-close').isVisible()&&await end.isVisible());
        const main=await pose(),address='创世记 5:15';
        const candidatePreview=page.getByRole('complementary',{name:'搜索结果经文浮窗'}),
          candidate=finder.locator('#vf-list button strong'),addressBack=finder.getByRole('button',{name:'返回候选'});
        await input.fill('创316');
        assert.deepEqual(await candidate.allTextContents(),['创世记 3:16','创世记 31:6']);
        const guess=finder.getByRole('button',{name:'定位到 创世记 31:6',exact:true});
        if(touch){
          assert.ok(await guess.evaluate(el=>{
            const r=el.getBoundingClientRect(),p=el.closest('#verse-finder').getBoundingClientRect();
            return r.height>=44&&p.width>=window.innerWidth-12&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
          }),'both phone candidates have a full, unscaled touch target');
          await activate(guess);
          assert.ok(await input.evaluate(el=>document.activeElement!==el),'selecting a candidate releases the mobile keyboard');
        }else{
          await input.press('Enter');
          assert.ok(!await context.isVisible()&&!await scopes.isVisible(),'no candidate is selected by an unqualified Enter');
          await input.press('ArrowDown');await input.press('ArrowDown');await input.press('Enter');
        }
        const chosen=context.locator('[data-ref="31:6"]'),nearby=context.locator('[data-ref="31:7"]');
        await chosen.waitFor();
        assert.equal(await input.inputValue(),'创316');
        assert.ok(!await candidatePreview.isVisible()&&!await scopes.isVisible());
        assert.equal(await chosen.getAttribute('data-current'),'');
        await activate(nearby);await candidatePreview.waitFor();
        await candidatePreview.locator('[data-verse-id="GEN.31:7"][data-cited]').waitFor();
        assert.deepEqual(await pose(),main,'neither address choice nor the inline verse changes the main book');
        await activate(candidatePreview.getByRole('button',{name:'返回搜索结果'}));
        await chosen.waitFor();
        await activate(addressBack);
        assert.deepEqual(await candidate.allTextContents(),['创世记 3:16','创世记 31:6']);

        for(const [typed,ref,heading] of [
          ['创3 16','3:16','创世记 3:16'],['创3 16 17','3:16','创世记 3:16–17'],
          ['创3132','31:32','创世记 31:32'],['创31-32','31:1','创世记 31–32章'],['创31','31:1','创世记 31章']
        ]){
          await input.fill(typed);
          await context.locator('[data-ref="'+ref+'"]').waitFor();
          assert.equal(await finder.locator('#vf-status').textContent(),heading);
          assert.ok(!await addressBack.isVisible()&&!await candidatePreview.isVisible()&&!await scopes.isVisible(),typed);
          if(typed==='创3 16 17'){
            assert.equal(await context.locator('[data-ref="3:17"]').getAttribute('data-current'),'');
            await activate(context.locator('[data-ref="3:16"]'));await candidatePreview.waitFor();
            await candidatePreview.locator('[data-verse-id="GEN.3:16"][data-cited]').waitFor();
            assert.equal(await candidatePreview.locator('[data-verse-id="GEN.3:17"][data-cited]').count(),0,'clicking an individual verse opens only that verse as cited');
            await activate(candidatePreview.getByRole('button',{name:'返回搜索结果'}));
          }
        }
        for(const [spoken,standard] of [
          ['箴言书3:5','箴言 3:5'],['马太5:3','马太福音 5:3'],['路德1:16','路得记 1:16'],['列王上3:9','列王纪上 3:9']
        ]){
          await input.fill(spoken);
          await context.getByRole('button',{name:'打开经文：'+standard,exact:true}).waitFor();
        }
        await input.fill('列王2:3');
        assert.deepEqual(await candidate.allTextContents(),['列王纪上 2:3','列王纪下 2:3']);
        await input.press('Space');assert.equal(await input.inputValue(),'列王2:3 ');
        await activate(finder.getByRole('button',{name:'定位到 列王纪下 2:3',exact:true}));
        const selectedKing=context.getByRole('button',{name:'打开经文：列王纪下 2:3',exact:true});
        await selectedKing.waitFor();assert.ok(!await candidatePreview.isVisible());
        await activate(selectedKing);
        await candidatePreview.waitFor();
        await candidatePreview.locator('[data-verse-id="2KI.2:3"][data-cited]').waitFor();
        assert.match(await candidatePreview.locator('.compare-slip__title').getAttribute('aria-label'),/列王纪下/);
        await activate(candidatePreview.getByRole('button',{name:'返回搜索结果'}));
        assert.deepEqual(await pose(),main);
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
        assert.equal(await input.inputValue(),address+'，');
        assert.ok(await input.isEditable()&&!await preview.isVisible()&&!await scopes.isVisible(),'a trailing comma simply stays in the query');
        await input.fill(address+'，创世记 6:2');
        assert.ok(!await context.isVisible()&&!await scopes.isVisible(),'the toolbar does not locate two addresses at once');
        assert.equal(await finder.locator('#vf-list button').count(),0);
        const enter=()=>touch?input.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true}))):input.press('Enter');
        await input.fill('何西阿2');
        const firstVerse=context.getByRole('button',{name:'打开经文：何西阿书 2:1',exact:true});
        await firstVerse.waitFor();
        assert.equal(await input.inputValue(),'何西阿2');
        assert.equal(await finder.locator('.scripture-ghost').count(),0);
        await input.press('Space');
        assert.equal(await input.inputValue(),'何西阿2 ');
        await activate(firstVerse);
        await preview.waitFor();
        await preview.locator('[data-verse-id="HOS.2:1"][data-cited]').waitFor();
        assert.equal(await preview.getByRole('button',{name:'确定插入',exact:true}).count(),0,'toolbar opens an ordinary reading window');
        assert.deepEqual(await pose(),main,'opening a toolbar result keeps the main spread untouched');
        await activate(preview.getByRole('button',{name:'返回搜索结果'}));await input.waitFor();
        assert.equal(await input.inputValue(),'何西阿2 ');
        await input.focus();await enter();
        assert.ok(await context.isVisible()&&!await preview.isVisible()&&!await scopes.isVisible(),'Enter on a coordinate keeps the contextual reader without opening a window');
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
        await activate(finder.locator('#vf-list button').first());await preview.waitFor();
        assert.equal(await preview.getByRole('button',{name:'确定插入',exact:true}).count(),0,'keyword hits open the same ordinary reading window');
        await activate(preview.getByRole('button',{name:'返回搜索结果'}));await input.waitFor();
        assert.equal(await input.inputValue(),'创造');
        assert.ok(await clear.evaluate(el=>{
          const shell=el.closest('.vf-field'),field=shell.getBoundingClientRect(),tap=el.getBoundingClientRect(),
            glyph=el.querySelector('svg').getBoundingClientRect(),entry=shell.querySelector('input');
          const overlap=entry.getBoundingClientRect().right-tap.left;
          return getComputedStyle(shell).boxShadow!=='none'&&getComputedStyle(entry).outlineStyle==='none'&&
            tap.width>=22&&glyph.width>=10&&tap.right<=field.right+1&&overlap<1&&
            el.contains(document.elementFromPoint(tap.x+tap.width/2,tap.y+tap.height/2));
        }),'the enlarged clear button has its own usable hit box inside the field');
        await activate(clear);
        assert.equal(await input.inputValue(),'');
        assert.ok(await input.evaluate(el=>el===document.activeElement),'clear keeps the input ready to type again');
        assert.ok(await finder.isVisible()&&!await clear.isVisible()&&!await scopes.isVisible());
        assert.equal(await hits.count(),0,'clear also removes keyword results');
        assert.deepEqual(await pose(),main);
        await input.fill('约翰福音 3:16');
        await context.getByRole('button',{name:'打开经文：约翰福音 3:16',exact:true}).waitFor();
        assert.ok(!await scopes.isVisible(),'editing goes back to coordinate mode regardless of previous scope');
        await activate(end);
        await finder.waitFor({state:'hidden'});
        assert.ok(!await page.locator('#vf-tab').isVisible(),'ending the search leaves no tucked result');
        await page.evaluate(()=>PaperImmersion.showChrome());
        await activate(trigger);await input.waitFor();
        assert.equal(await input.inputValue(),'','ending resets the next search');
        if(!touch){
          // Exercise a newly mounted search on a spread whose visible side
          // stays the same throughout this vertical drag.
          await activate(end);
          const reopened=new URL(url);reopened.searchParams.set('ref','GEN.1:1');
          await page.goto(reopened.href,{waitUntil:'domcontentloaded',timeout:90000});
          await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
          await page.keyboard.press('Control+k');await input.waitFor();
          await input.fill(address);
          const paperPoint=await finder.evaluate(el=>[+el.dataset.paperX,+el.dataset.paperY]);
          await input.press('Escape');await finder.waitFor({state:'hidden'});
          await page.evaluate(()=>{for(let n=0;n<15;n++)document.getElementById('zoom-in').click();});
          for(let n=0;n<3;n++){
            await page.mouse.move(500,710);await page.mouse.down();
            await page.mouse.move(500,100,{steps:7});await page.mouse.up();
          }
          const moved=await pose();
          assert.ok(+moved[3]+paperPoint[1]*+moved[2]<0,'the original search paper anchor really moved off screen');
          await page.keyboard.press('Control+k');await input.waitFor();
          assert.equal(await input.inputValue(),address,'reopening keeps the search query');
          assert.ok(await input.evaluate(el=>{
            const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
            return el===document.activeElement&&document.elementFromPoint(x,y)===el;
          }),'reopening with the shortcut focuses an input that is actually on screen');
          assert.deepEqual(await pose(),moved,'repositioning the search does not move the book');
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS ${width} px: keyword-only scopes, inline cross-chapter reading in both directions, and preview return`);
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
