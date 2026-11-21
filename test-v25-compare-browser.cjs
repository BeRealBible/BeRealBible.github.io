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
    for(const width of (process.env.TEST_WIDTHS||'1280,390').split(',').map(Number)){
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
        await $('#v25-scripture-preview .citation-jump').click();
        const close=$('#vf-close');if(await close.isVisible())await close.click();
        await page.waitForFunction(({book,ref})=>document.querySelector('.rh-chip[aria-current=page]')?.getAttribute('aria-label').endsWith(ref)&&document.getElementById('stage').dataset.book===book,{book,ref});
      };
      await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      await mark('1:31',9,true);await bar.waitFor({timeout:4000});
      await mark('1:29',9);await mark('1:28',9);
      await bar.locator('[data-float]').click({timeout:4500});await float.waitFor();
      assert.deepEqual(await float.locator('[data-cited]').evaluateAll(rows=>rows.map(row=>row.dataset.ref)),['1:28','1:29']);
      await float.locator('[aria-label="关闭经文浮窗"]').click();await float.waitFor({state:'hidden'});
      await mark('1:31',9,true);await bar.waitFor();
      await turn(true,10);await bar.waitFor();assert.equal(await bar.getAttribute('data-pages'),'1');
      await mark('2:1',10);assert.equal(await bar.getAttribute('data-pages'),'2');
      await page.evaluate(()=>document.getElementById('zoom-in').click());
      await fit();assert.equal(await bar.getAttribute('data-pages'),'2');
      await turn(false,8);assert.equal(await $('.paper-ink-mark--selected').count(),1);
      await bar.locator('[data-copy]').click();await bar.waitFor({state:'detached'});
      const [quote]=await page.evaluate(()=>copyTest);
      const [first,second]=await page.evaluate(()=>{
        const g=BIBLE_SOURCE.books[0];return [g.chapters[0].verses.find(r=>r[0]===31)[1],g.chapters[1].verses[0][1]];
      });
      assert.equal(quote,first+'\n( 创世记 1:31 和合本 )\n\n'+second+'\n( 创世记 2:1 和合本 )');
      console.log(width,'cross-page clipboard passed');
      await mark('1:31',9,true);await turn(true,10);
      assert.equal(await $('.paper-ink-mark--selected').count(),1);
      await mark('1:31',10);assert.ok(await bar.locator('[data-copy]').isDisabled());
      await turn(false,8);await mark('1:31',9);await turn(true,10);await mark('2:1',10);
      await bar.locator('[data-float]').click();await float.waitFor();
      assert.equal(await float.getAttribute('data-page'),'9');
      assert.ok(await float.locator('p.compare-slip__verse[data-cited][data-ref="1:31"]').count());
      assert.equal(await float.locator('p[data-ref="2:1"][data-cited]').count(),0);
      assert.equal(await float.locator('p[data-ref="1:31"]').count(),1);
      assert.equal(await float.locator('button').filter({hasText:/上一页|下一页|上一张|下一张/}).count(),0);
      const fixed=await float.boundingBox();
      await page.evaluate(()=>document.getElementById('zoom-in').click());await fit();
      assert.deepEqual(await float.boundingBox(),fixed);
      await jump('创 3:1','GEN','3:1');assert.equal(await float.getAttribute('data-page'),'9');
      await chrome();const main=await stage.getAttribute('data-spread');
      assert.equal((await shelf()).filter(r=>r.text==='创 3').length,1);
      const threeId=(await shelf()).find(r=>r.text==='创 3').id;
      const area=float.locator('.compare-slip__scroll'),chapter=n=>area.locator('.compare-slip__chunk[data-chapter="'+n+'"]');
      await chapter(2).waitFor({state:'attached'});
      await area.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="2:5"]').offsetTop;});
      await page.waitForFunction(()=>[...document.querySelectorAll('.rh-chip')].some(n=>n.textContent==='创 2'));
      assert.equal((await shelf())[0].text,'创 2');
      assert.equal((await shelf()).find(r=>r.current==='page').id,threeId);
      await area.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(150);
      await chapter(3).waitFor({state:'attached'});
      assert.equal(await area.locator('.compare-slip__chunk').count(),3);
      assert.equal(await chapter(1).count(),1);
      // A continued native gesture scrolls into the appended chapter;
      // the preceding chapters stay mounted.
      if(mobile){
        const box=await area.boundingBox(),p={x:box.x+45,y:box.y+box.height*.72};
        await send('touchStart',[p]);
        for(const dy of [15,30,48]){await page.waitForTimeout(50);await send('touchMove',[{x:p.x,y:p.y-dy}]);}
        await page.waitForTimeout(150);await send('touchEnd',[]);
      }else{await area.hover();await page.mouse.wheel(0,200);}
      // Let the mobile fling settle before placing a precise test anchor.
      await page.waitForTimeout(mobile?420:90);
      await area.evaluate(el=>{el.scrollTop=el.querySelector('p[data-ref="3:4"]').offsetTop-4;});
      await page.waitForFunction(()=>document.getElementById('v25-compare').dataset.chapter==='3',null,{timeout:5000}).catch(async e=>{
        throw Error(JSON.stringify(await area.evaluate(el=>({
          top:el.scrollTop,chapter:el.closest('aside').dataset.chapter,
          target:el.querySelector('p[data-ref="3:4"]')?.offsetTop,displayed:[...el.children].map(s=>s.dataset.chapter)
        }))),{cause:e});
      });
      assert.ok(await area.locator('.compare-slip__chunk').count()<=3);
      assert.equal(await stage.getAttribute('data-spread'),main);
      assert.equal((await shelf()).filter(r=>r.text==='创 3').length,1);assert.equal((await shelf())[0].id,threeId);
      assert.ok((await float.boundingBox()).width<(mobile?width*.81:width*.45));
      if(process.env.COMPARE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'v25-compare-'+width+'.png')});
      async function drag(handle,dx,dy){
        const pos=await handle.boundingBox(),p={x:pos.x+pos.width*.5,y:pos.y+pos.height*.5};
        const target=await handle.evaluate((el,{x,y})=>el.contains(document.elementFromPoint(x,y)),p);
        assert.ok(target,'handle is reachable: '+await handle.getAttribute('class'));
        if(!mobile){
          await page.mouse.move(p.x,p.y);await page.mouse.down();assert.ok(await float.getAttribute('data-adjust'),JSON.stringify({errors,pos,p}));
          await page.mouse.move(p.x+dx,p.y+dy,{steps:6});
          assert.ok(await float.getAttribute('data-adjust'),JSON.stringify({errors,pos,p,after:await float.boundingBox()}));
          await page.mouse.up();
        }
        else{await send('touchStart',[p]);await send('touchMove',[{x:p.x+dx,y:p.y+dy}]);await send('touchEnd',[]);}
      }
      const before=await float.boundingBox();await drag(float.locator('.compare-slip__title'),-38,mobile?-42:40);
      const moved=await float.boundingBox();assert.ok(moved.x<before.x-24&&Math.abs(moved.y-before.y)>25);
      await drag(float.locator('.compare-slip__resize'),-35,-35);
      const smaller=await float.boundingBox();assert.ok(smaller.width<moved.width-20&&smaller.height<moved.height-20,JSON.stringify({before,moved,smaller,errors}));
      await float.locator('[aria-label="收起经文浮窗"]').click();assert.ok((await float.boundingBox()).height<64);
      await float.locator('[aria-label="展开经文浮窗"]').click();assert.equal(await float.getAttribute('data-chapter'),'3');
      await area.evaluate(el=>el.scrollTop=el.scrollHeight);
      await chapter(4).waitFor({state:'attached'});
      assert.equal(await area.locator('.compare-slip__chunk').count(),3);
      assert.equal(await chapter(1).count(),0);
      for(let i=0;i<3&&!await chapter(1).count();i++){await area.evaluate(el=>el.scrollTop=0);await page.waitForTimeout(120);}
      await chapter(1).waitFor({state:'attached'});
      assert.equal(await area.locator('.compare-slip__chunk').count(),3);
      await float.locator('[aria-label="关闭经文浮窗"]').click();await float.waitFor({state:'hidden'});
      await chrome();
      const one=$('.rh-chip').filter({hasText:'创 1'});
      if(!mobile)await one.hover();
      else{
        const r=await one.boundingBox();await send('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await page.waitForTimeout(470);await send('touchEnd',[]);
      }
      await $('[aria-label^="在浮窗打开 创世记 1:"]').click();
      await float.waitFor();assert.equal(await float.getAttribute('data-page'),'9');assert.equal(await stage.getAttribute('data-spread'),main);
      await float.locator('[aria-label="关闭经文浮窗"]').click();await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      await mark('2:1',10,true);await page.keyboard.press('Control+k');await bar.waitFor({state:'detached'});
      assert.equal(await $('.paper-ink-mark--selected').count(),0);assert.ok(await $('#vf-input').isVisible());
      await $('#vf-input').fill('创造');await $('#vf-list button mark').first().waitFor();await $('#vf-list button').first().click();
      const note=$('#v25-scripture-preview');
      await note.waitFor();assert.equal(await note.getAttribute('data-kind'),'search');
      assert.ok(await note.locator('p mark').count());assert.equal(await $('#verse-finder').isVisible(),false);
      await note.locator('[aria-label="返回搜索结果"]').click();assert.ok(await $('#verse-finder').isVisible());
      assert.equal(await $('#vf-input').inputValue(),'创造');
      await $('#vf-input').fill('犹 1:1');await $('#vf-list button').filter({hasText:'犹大书 1:1'}).first().click();
      const oneChapter=note.locator('.compare-slip__scroll');
      await oneChapter.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new WheelEvent('wheel',{deltaY:300}));});
      assert.equal(await oneChapter.locator('.compare-slip__chunk').count(),1);
      assert.ok(await oneChapter.locator('[data-verse-id^="JUD."]').count());
      assert.equal(await oneChapter.locator('p:not([data-verse-id^="JUD."])').count(),0);
      await note.locator('[aria-label="返回搜索结果"]').click();
      await $('#vf-close').click();
      await page.goto(preview+'?pdf=958&curl=off',{timeout:90000});
      await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});await fit();
      const cue=$('[data-note-page="958"][data-note-ordinal="1"]').first();
      if(mobile)await cue.tap();else await cue.hover();
      await note.waitFor();assert.equal(await note.getAttribute('data-kind'),'footnote');
      const refs=note.locator('.compare-slip__tab');assert.equal(await refs.count(),3);
      const initialHistory=await shelf();await refs.nth(1).click();
      assert.match(await note.locator('.compare-slip__title').textContent(),/利未记/);
      assert.deepEqual(await shelf(),initialHistory,'preview does not add history');
      if(!mobile){
        await note.locator('[aria-label="将当前引用另开一个对照窗"]').click();
        await float.waitFor();assert.match(await float.locator('.compare-slip__title').textContent(),/利未记/);
        assert.equal(await note.isVisible(),true);
      }
      // The end of Exodus and beginning of Leviticus are on different
      // spreads, so this must survive an actual desk turn, not a jump.
      await page.goto(preview+'?ref=EXO.40:38&curl=off',{timeout:90000});
      await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
      await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      async function acrossBooks(){
        await mark('40:37',101,true);await mark('40:38',101);
        await turn(true,102);await mark('1:1',102);
        assert.equal(await bar.getAttribute('data-pages'),'2');
      }
      await acrossBooks();
      await bar.locator('[data-copy]').click();await bar.waitFor({state:'detached'});
      const [fromBoth]=await page.evaluate(()=>copyTest),refsBoth=fromBoth.split('\n\n').map(block=>block.split('\n').at(-1));
      assert.deepEqual(refsBoth,['( 出埃及记 40:37-38 和合本 )','( 利未记 1:1 和合本 )']);
      await turn(false,100);await acrossBooks();
      await bar.locator('[data-float]').click();await float.waitFor();
      assert.match(await float.locator('.compare-slip__title').textContent(),/^出埃及记 /);
      assert.match(await float.locator('.compare-slip__subtitle').textContent(),/40:37–38/);
      assert.equal(await float.locator('[data-cited]').count(),2);
      assert.equal(await float.locator('[data-verse-id^="LEV."]').count(),0);
      assert.equal(await stage.getAttribute('data-spread'),'102');
      assert.deepEqual(errors,[]);
      console.log(width,'PASS chapter and book clipboard, pinned prefix, 3-chapter rolling window, history, search & notes');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
