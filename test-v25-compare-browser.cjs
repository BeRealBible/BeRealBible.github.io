'use strict';
// PLAYWRIGHT_MODULE may point to a bundled Playwright installation.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const origin='http://127.0.0.1:37129';
const entry=process.argv[2];
const type={'.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.webp':'image/webp'};
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||undefined,headless:true});
  try{
    for(const width of (process.env.TEST_WIDTHS||'1280,390').split(',').map(Number)){
      const mobile=width<500,context=await browser.newContext({viewport:{width,height:840},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
      if(!entry)await context.route('**/*',async route=>{
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
      const preview=entry||(process.env.PREVIEW_FILE?pathToFileURL(process.env.PREVIEW_FILE).href:origin+'/index.html');
      async function visit(params){
        const url=new URL(preview);
        for(const [key,value] of Object.entries({...params,curl:'off'}))url.searchParams.set(key,value);
        await page.goto(url.href,{timeout:90000});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
      }
      await visit({ref:'GEN.1:1'});
      const $=s=>page.locator(s),stage=$('#stage'),float=$('#v25-compare'),bar=$('.paper-selection-tools');
      async function compactToolbar({near}={}){
        const layout=await bar.evaluate(el=>{
          const b=el.getBoundingClientRect(),stage=el.parentElement.getBoundingClientRect();
          const ink=[...el.parentElement.querySelectorAll('.paper-ink-mark--selected')].map(m=>m.getBoundingClientRect())
            .filter(m=>m.width&&m.height&&m.right>stage.left&&m.left<stage.right&&m.bottom>stage.top&&m.top<stage.bottom);
          const keys=[...el.querySelectorAll(':scope > button')].map(n=>n.getBoundingClientRect());
          return {fitted:b.left>=stage.left&&b.right<=stage.right&&b.top>=stage.top&&b.bottom<=stage.bottom,
            docked:el.hasAttribute('data-docked'),visible:ink.length,
            singleRow:keys.length===5&&keys.every((k,i)=>k.top===keys[0].top&&k.width>=43&&k.height>=43&&
              (!i||k.left>=keys[i-1].right-.5)),gap:ink.length?Math.max(ink[0].top-b.bottom,b.top-ink[0].bottom):null};
        });
        assert.ok(layout.fitted&&layout.singleRow,JSON.stringify(layout));
        if(near)assert.ok(layout.visible&&!layout.docked&&layout.gap>=12&&layout.gap<=16,JSON.stringify(layout));
        else assert.ok(layout.visible||layout.docked,JSON.stringify(layout));
      }
      async function oneLine(panel){
        const box=await panel.locator('.compare-slip__head').evaluate(head=>{
          const title=head.querySelector('strong'),book=title.querySelector('.compare-slip__book'),ref=title.querySelector('.compare-slip__address');
          const t=title.getBoundingClientRect(),r=ref.getBoundingClientRect(),css=getComputedStyle(title);
          return {title:t.height,line:parseFloat(css.lineHeight),wrap:css.whiteSpace,bookClip:getComputedStyle(book).textOverflow,
            titleRight:t.right,refRight:r.right,head:head.getBoundingClientRect().height,ref:ref.textContent,
            descriptions:head.querySelectorAll('small').length};
        });
        assert.ok(box.ref&&box.descriptions===0&&box.title<=box.line+1&&box.head<=40&&box.refRight<=box.titleRight+1,JSON.stringify(box));
        assert.equal(box.wrap,'nowrap');assert.equal(box.bookClip,'ellipsis');
      }
      async function naturalParagraphs(panel){
        const layout=await panel.locator('.compare-slip__chunk').first().evaluate(chapter=>{
          const verses=[...chapter.querySelectorAll('[data-verse-id]')];
          return {
            paragraphs:chapter.querySelectorAll('.compare-slip__paragraph').length,verses:verses.length,
            headers:chapter.querySelectorAll('.compare-slip__chapter-title').length,
            grouped:verses.some(v=>v.nextElementSibling?.classList.contains('compare-slip__verse')),
            numbered:verses.every(v=>v.parentElement.matches('p.compare-slip__paragraph')&&
              /^\d+(?:–\d+)?$/.test(v.querySelector('sup')?.textContent)&&getComputedStyle(v).display==='inline'),
          };
        });
        assert.equal(layout.headers,1);assert.ok(layout.numbered&&layout.grouped&&layout.verses>layout.paragraphs,JSON.stringify(layout));
      }
      async function iconBar(panel,keys){
        const buttons=await panel.locator('.compare-slip__head [data-action]:not([hidden])').evaluateAll(all=>all.map(b=>({
          key:b.dataset.action,svg:!!b.querySelector('svg path'),label:b.getAttribute('aria-label'),tip:b.title,text:b.textContent.trim()
        })));
        assert.equal(await panel.locator('footer').count(),0,'no extra toolbar under the text');
        assert.deepEqual(buttons.map(b=>b.key),keys);
        assert.ok(buttons.every(b=>b.svg&&!b.text&&b.label&&b.tip===b.label),JSON.stringify(buttons));
      }
      async function paperTheme(panel){
        const look=await panel.evaluate(el=>{
          const style=s=>getComputedStyle(el.querySelector(s));
          return {material:getComputedStyle(el).backgroundImage,head:style('header').backgroundColor,
            ink:style('.compare-slip__paragraph').color,
            corner:getComputedStyle(el.querySelector('.compare-slip__resize'),'::after').clipPath};
        });
        assert.match(look.material,/data:image\/svg\+xml/);
        assert.equal(look.head,'rgba(0, 0, 0, 0)');
        assert.equal(look.ink,'rgb(41, 37, 31)');assert.match(look.corner,/^polygon/);
      }
      const transparent='rgba(0, 0, 0, 0)';
      async function citationInk(panel){
        const active=await panel.locator('.compare-slip__verse[data-cited]').first().evaluate(el=>{
          const s=getComputedStyle(el),ref=getComputedStyle(el.querySelector('sup'));
          return [s.color,ref.color,s.backgroundColor,s.backgroundImage];
        });
        assert.deepEqual(active,['rgb(138, 49, 43)','rgb(138, 49, 43)',transparent,'none']);
        assert.equal(await panel.locator('.compare-slip__verse:not([data-cited])').first().evaluate(el=>getComputedStyle(el).color),'rgb(41, 37, 31)');
      }
      async function keywordInk(mark){
        assert.deepEqual(await mark.evaluate(el=>{
          const s=getComputedStyle(el);return [s.color,s.backgroundColor,s.textDecorationLine];
        }),['rgb(101, 37, 32)',transparent,'underline']);
      }
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
      assert.equal(await $('.paper-ink-mark--selected').first().evaluate(el=>getComputedStyle(el).fill),'rgb(245, 217, 154)');
      if(mobile)await compactToolbar({near:true});
      await mark('1:29',9);await mark('1:28',9);
      await bar.locator('[data-float]').click({timeout:4500});await float.waitFor();
      assert.deepEqual(await float.locator('[data-cited]').evaluateAll(rows=>rows.map(row=>row.dataset.ref)),['1:28','1:29']);
      await oneLine(float);
      await naturalParagraphs(float);
      await iconBar(float,['jump']);
      await paperTheme(float);
      await citationInk(float);
      if(process.env.COMPARE_SCREENSHOTS)await float.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'selection-red-ink-'+width+'.png')});
      await float.locator('[aria-label="关闭经文浮窗"]').click();await float.waitFor({state:'hidden'});
      await mark('1:31',9,true);await bar.waitFor();
      await turn(true,10);await bar.waitFor();assert.equal(await bar.getAttribute('data-pages'),'1');
      if(mobile)await compactToolbar();
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
      assert.ok(await float.locator('.compare-slip__verse[data-cited][data-ref="1:31"]').count());
      assert.equal(await float.locator('[data-ref="2:1"][data-cited]').count(),0);
      assert.equal(await float.locator('[data-ref="1:31"]').count(),1);
      assert.equal(await float.locator('button').filter({hasText:/上一页|下一页|上一张|下一张/}).count(),0);
      const fixed=await float.boundingBox();
      await page.evaluate(()=>document.getElementById('zoom-in').click());
      const enlarged=await float.boundingBox();
      if(width>=800)assert.ok(enlarged.width>fixed.width*1.2&&enlarged.height>fixed.height*1.2);
      else assert.deepEqual(enlarged,fixed);
      await fit();
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
      await area.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="3:4"]').offsetTop-4;});
      await page.waitForFunction(()=>document.getElementById('v25-compare').dataset.chapter==='3',null,{timeout:5000}).catch(async e=>{
        throw Error(JSON.stringify(await area.evaluate(el=>({
          top:el.scrollTop,chapter:el.closest('aside').dataset.chapter,
          target:el.querySelector('[data-ref="3:4"]')?.offsetTop,displayed:[...el.children].map(s=>s.dataset.chapter)
        }))),{cause:e});
      });
      assert.ok(await area.locator('.compare-slip__chunk').count()<=3);
      assert.equal(await stage.getAttribute('data-spread'),main);
      assert.equal((await shelf()).filter(r=>r.text==='创 3').length,1);assert.equal((await shelf())[0].id,threeId);
      assert.ok((await float.boundingBox()).width<(mobile?width*.81:width*.45));
      if(process.env.COMPARE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'v25-compare-'+width+'.png')});
      // Reduced motion still allows a 0.01ms transition. A bounding box
      // queried in the pointer event's frame can be an intermediate size.
      const settleRect=()=>page.waitForFunction(()=>{
        const n=document.getElementById('v25-compare'),r=n.getBoundingClientRect(),z=parseFloat(n.style.zoom)||1;
        return ['top','left','width','height'].every(key=>Math.abs(r[key]-parseFloat(n.style[key])*z)<.15);
      });
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
        await settleRect();
      }
      const before=await float.boundingBox();await drag(float.locator('.compare-slip__title'),-38,mobile?-42:40);
      const moved=await float.boundingBox();assert.ok(moved.x<before.x-24&&Math.abs(moved.y-before.y)>25);
      await drag(float.locator('.compare-slip__resize'),-35,-35);
      const smaller=await float.boundingBox();assert.ok(smaller.width<moved.width-20&&smaller.height<moved.height-20,JSON.stringify({before,moved,smaller,errors}));
      await float.locator('[aria-label="收起经文浮窗"]').click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#v25-compare[data-collapsed] .compare-slip__head')).minHeight==='28px');
      const compact=await float.boundingBox();
      assert.ok(compact.width<135&&compact.height<37&&compact.width<smaller.width*.68,JSON.stringify({small:smaller,compact}));
      assert.match(await float.locator('.compare-slip__title').textContent(),/^创 3:/);
      assert.match(await float.evaluate(el=>getComputedStyle(el).backgroundColor),/^rgba\(/);
      assert.equal(await float.locator('[data-action]:visible').count(),0);
      if(process.env.COMPARE_SCREENSHOTS)await float.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'compact-scripture-'+width+'.png')});
      await float.locator('.compare-slip__title').click();assert.equal(await float.getAttribute('data-chapter'),'3');
      assert.equal(await float.getAttribute('data-collapsed'),null);
      await settleRect();
      const restored=await float.boundingBox();
      assert.ok(Math.abs(restored.width-smaller.width)<1,JSON.stringify({smaller,compact,restored}));
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
      const floatAction=$('[aria-label^="在浮窗打开 创世记 1:"]');
      assert.deepEqual(await floatAction.evaluate(el=>{
        const other=el.parentElement.querySelector('.rh-delete'),a=getComputedStyle(el),b=getComputedStyle(other);
        return [a.backgroundColor===b.backgroundColor,a.color===b.color];
      }),[true,true],'the history float action uses the same paper treatment as delete');
      await floatAction.click();
      await float.waitFor();assert.equal(await float.getAttribute('data-page'),'9');assert.equal(await stage.getAttribute('data-spread'),main);
      await oneLine(float);
      await float.locator('[aria-label="关闭经文浮窗"]').click();await page.evaluate(()=>PaperImmersion.hideChrome());await fit();
      await mark('2:1',10,true);await page.keyboard.press('Control+k');await bar.waitFor({state:'detached'});
      assert.equal(await $('.paper-ink-mark--selected').count(),0);assert.ok(await $('#vf-input').isVisible());
      await $('#vf-input').fill('创造');await $('#vf-list button mark').first().waitFor();
      await keywordInk($('#vf-list button mark').first());await $('#vf-list button').first().click();
      const note=$('#v25-scripture-preview');
      await note.waitFor();assert.equal(await note.getAttribute('data-kind'),'search');
      await oneLine(note);
      await naturalParagraphs(note);
      await iconBar(note,['back','jump','pin']);
      await paperTheme(note);
      await citationInk(note);
      await keywordInk(note.locator('p mark').first());
      if(process.env.COMPARE_SCREENSHOTS)await note.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'search-red-ink-'+width+'.png')});
      assert.ok(await note.locator('p mark').count());assert.equal(await $('#verse-finder').isVisible(),false);
      await note.locator('[aria-label="返回搜索结果"]').click();assert.ok(await $('#verse-finder').isVisible());
      assert.equal(await $('#vf-input').inputValue(),'创造');
      assert.equal(await $('#verse-finder header h2').count(),0);
      assert.equal(await $('#vf-status').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
      await $('#vf-input').fill('犹 1:1');await $('#vf-list button').filter({hasText:'犹大书 1:1'}).first().click();
      const oneChapter=note.locator('.compare-slip__scroll');
      await oneChapter.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new WheelEvent('wheel',{deltaY:300}));});
      assert.equal(await oneChapter.locator('.compare-slip__chunk').count(),1);
      assert.ok(await oneChapter.locator('[data-verse-id^="JUD."]').count());
      assert.equal(await oneChapter.locator('[data-verse-id]:not([data-verse-id^="JUD."])').count(),0);
      await note.locator('[aria-label="返回搜索结果"]').click();
      await $('#vf-close').click();
      await $('#vf-tab').waitFor();assert.match(await $('#vf-tab').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgba\(/);
      await visit({pdf:958});await fit();
      const cue=$('[data-note-page="958"][data-note-ordinal="1"]').first();
      const chooser=$('#v25-citation-choice');
      async function activationOnly(citation,popup=note){
        assert.equal(await citation.evaluate(el=>getComputedStyle(el).cursor),'pointer');
        if(mobile){await citation.tap();await popup.waitFor();return;}
        await citation.hover();await popup.waitFor({state:'hidden',timeout:2000});
        await citation.focus();assert.equal(await popup.isVisible(),false);
        await citation.press('Enter');await popup.waitFor();assert.equal(await citation.getAttribute('aria-expanded'),'true');
        await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
        assert.equal(await citation.getAttribute('aria-expanded'),'false');
        await citation.click();await popup.waitFor();
      }
      await activationOnly(cue,chooser);
      assert.equal(await note.isVisible(),false);
      assert.equal(await chooser.locator('button').count(),3);
      const initialHistory=await shelf();
      await chooser.locator('button').nth(1).click();await chooser.waitFor({state:'hidden'});
      await note.waitFor();assert.equal(await note.getAttribute('data-kind'),'footnote');
      await oneLine(note);
      await naturalParagraphs(note);
      await iconBar(note,['jump','pin']);
      await paperTheme(note);
      await citationInk(note);
      assert.match(await note.locator('.compare-slip__title').textContent(),/^利 /);
      assert.equal(await note.locator('[data-verse-id]:not([data-verse-id^="LEV."])').count(),0);
      assert.deepEqual(await shelf(),initialHistory,'preview does not add history');
      await note.locator('[aria-label="固定经文浮窗"]').click();
      await float.waitFor();assert.match(await float.locator('.compare-slip__title').textContent(),/^利 /);
      await citationInk(float);
      await note.waitFor({state:'hidden'});
      if(process.env.COMPARE_SCREENSHOTS){
        // Reproduce the Isaiah/Zechariah citation shown in the feedback.
        await visit({pdf:978});await fit();
        await activationOnly($('[data-note-page="978"][data-note-ordinal="1"]').first(),chooser);
        assert.deepEqual(await chooser.locator('button').allTextContents(),['赛 62:11','亚 9:9']);
        await chooser.locator('button').first().click();await note.waitFor();
        const content=note.locator('.compare-slip__scroll'),ref=note.locator('[data-ref="63:2"]');
        if(!await ref.count())await content.evaluate(el=>{el.scrollTop=el.scrollHeight;});
        await ref.waitFor({state:'attached'});
        await content.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="63:2"]').offsetTop-8;});
        assert.equal(await ref.locator('sup').textContent(),'2');
        await iconBar(note,['jump','pin']);
        await note.screenshot({path:path.join(process.env.COMPARE_SCREENSHOTS,'isaiah-icon-bar-'+width+'.png')});
      }
      await visit({pdf:954});await fit();
      const parallel=$('[data-note-page="954"][data-parallel]').first();
      await activationOnly(parallel);
      await citationInk(note);
      assert.equal(await note.getAttribute('data-kind'),'footnote');
      assert.equal(await stage.getAttribute('data-spread'),'954');
      // The end of Exodus and beginning of Leviticus are on different
      // spreads, so this must survive an actual desk turn, not a jump.
      await visit({ref:'EXO.40:38'});
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
      assert.match(await float.locator('.compare-slip__title').textContent(),/^出 /);
      assert.match(await float.locator('.compare-slip__title').getAttribute('aria-label'),/^出埃及记 /);
      assert.match(await float.locator('.compare-slip__title').getAttribute('title'),/40:37–38/);
      assert.equal(await float.locator('[data-cited]').count(),2);
      assert.equal(await float.locator('[data-verse-id^="LEV."]').count(),0);
      assert.equal(await stage.getAttribute('data-spread'),'102');
      // Very narrow windows keep the reference visible even for a long book name.
      await page.evaluate(()=>V25ScriptureWindows.open({bookCode:'2TH',ref:'3:16'}));
      const long=$('.compare-slip[data-citation="2TH.3:16"]:not([hidden])');
      const grip=long.locator('.compare-slip__resize');
      for(let i=0;i<7;i++)await grip.press('Shift+ArrowLeft');
      await oneLine(long);
      assert.equal(await long.locator('.compare-slip__address').textContent(),'3:16');
      assert.ok(await float.isVisible(),'opening a different passage must not replace an existing comparison');

      const owned=$('.compare-slip[data-role=fixed]:not([hidden])');
      const openWindows=$('.compare-slip:not([hidden]):not([data-collapsed])');
      const tabs=$('#v25-compare-tabs .compare-slip:not([hidden])');
      const openPin=(code,ref)=>page.evaluate(({code,ref})=>V25ScriptureWindows.open({code,ref}),{code,ref});
      const windowAt=key=>owned.and($('.compare-slip[data-citation="'+key+'"]'));
      await page.evaluate(()=>document.querySelectorAll('.compare-slip[data-role=fixed]:not([hidden]) button[aria-label="关闭经文浮窗"]').forEach(b=>b.click()));
      const addresses=[['GEN','1:8'],['EXO','2:2'],['MAT','5:3'],['JHN','3:16'],['ROM','8:1']];
      assert.ok(await openPin(...addresses[0]));
      const retained=windowAt('GEN.1:8'),retainedBody=retained.locator('.compare-slip__scroll');
      const savedTop=await retainedBody.evaluate(el=>{el.scrollTop=110;return el.scrollTop;});
      assert.ok(savedTop>0);
      for(const [i,loc] of addresses.slice(1).entries()){
        assert.ok(await openPin(...loc));assert.equal(await owned.count(),i+2);
        assert.equal(await openWindows.count(),Math.min(i+2,3));
      }
      assert.equal(await tabs.count(),2);
      assert.ok(await retained.getAttribute('data-collapsed')!==null);
      await retained.locator('.compare-slip__title').click();
      assert.equal(await openWindows.count(),3);
      assert.equal(await tabs.count(),2);
      assert.equal(await retainedBody.evaluate(el=>el.scrollTop),savedTop);
      assert.ok(await openPin(...addresses[0]),'reopening an existing passage does not consume another pinned slot');
      assert.equal(await owned.count(),5);
      const limit=$('#v25-compare-limit');
      assert.equal(await limit.textContent(),'','reaching the quota is not a warning in itself');
      const focused=await page.evaluateHandle(()=>document.activeElement);
      assert.equal(await openPin('PSA','23:1'),false);
      await limit.waitFor({state:'visible'});
      assert.match(await limit.textContent(),/已固定 5 个.*请先关闭一个/);
      assert.ok(await focused.evaluate(el=>el===document.activeElement),'the notice does not steal focus');
      await focused.dispose();
      assert.ok(await limit.evaluate(el=>{
        const r=el.getBoundingClientRect(),style=getComputedStyle(el);
        return style.pointerEvents==='none'&&style.opacity==='1'&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
      }),'the notice is in view and never intercepts clicks or taps');
      assert.equal(await owned.count(),5);
      assert.equal(await openWindows.count(),3);
      assert.equal(await page.evaluate(()=>V25ScriptureWindows.openPreview([{code:'PSA',ref:'23:1'}],
        {kind:'search',label:'搜索命中经文',focus:true,keywords:['耶和华']})),true);
      assert.equal(await openWindows.count(),3,'a temporary preview also occupies an expanded slot');
      assert.equal(await tabs.count(),3);
      assert.equal(await owned.count(),5);
      await note.locator('[aria-label="固定经文浮窗"]').click();
      assert.ok(await note.isVisible(),'an unsuccessful pin keeps the preview open');
      assert.equal(await owned.count(),5);
      await limit.waitFor({state:'visible'});
      await limit.waitFor({state:'hidden',timeout:5000});
      assert.equal(await limit.textContent(),'','the notice dismisses itself');
      await tabs.first().locator('[aria-label="关闭经文浮窗"]').click();
      assert.equal(await owned.count(),4);
      await note.locator('[aria-label="固定经文浮窗"]').click();
      await note.waitFor({state:'hidden'});
      assert.equal(await owned.count(),5);
      assert.equal(await openWindows.count(),3);
      assert.ok(await windowAt('PSA.23:1').locator('p mark').count());
      await citationInk(windowAt('PSA.23:1'));
      await keywordInk(windowAt('PSA.23:1').locator('p mark').first());
      // Keeping all five as paper tabs must not create an extra quota or
      // leave any tab overlapping another or outside the screen.
      await page.evaluate(()=>document.querySelectorAll('.compare-slip[data-role=fixed]:not([hidden]):not([data-collapsed]) button[aria-label="收起经文浮窗"]').forEach(b=>b.click()));
      assert.equal(await owned.count(),5);
      assert.equal(await openWindows.count(),0);
      assert.equal(await tabs.count(),5);
      await page.waitForFunction(()=>[...document.querySelectorAll('#v25-compare-tabs .compare-slip:not([hidden])')]
        .every(n=>getComputedStyle(n.querySelector('.compare-slip__head')).minHeight==='28px'));
      assert.ok(await tabs.evaluateAll(all=>{
        const rects=all.map(el=>el.getBoundingClientRect());
        return rects.every((r,i)=>r.width>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&
          rects.slice(i+1).every(s=>r.right<=s.left||s.right<=r.left||r.bottom<=s.top||s.bottom<=r.top));
      }));
      await tabs.last().locator('.compare-slip__title').click();
      assert.equal(await owned.count(),5);
      assert.equal(await openWindows.count(),1);
      assert.deepEqual(errors,[]);
      console.log(width,'PASS clipboard, chapter rolling window, history, search, notes, and 5 pinned / 3 expanded caps');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
