'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {pathToFileURL}=require('node:url'),path=require('node:path'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),origin='http://127.0.0.1:37129';
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.webp':'image/webp','.png':'image/png'};
const file=process.env.PREVIEW_FILE,source=process.argv[2];
const url=new URL(file?pathToFileURL(path.resolve(file)):source||origin);
url.searchParams.set('v','index-25');url.searchParams.set('ref','ACT.7:56');url.searchParams.set('curl','off');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    for(const width of (process.env.FLOAT_TEST_WIDTHS||'1280,390').split(',').map(Number)){
      const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:840},isMobile:mobile,hasTouch:mobile,
        reducedMotion:'reduce',offline:!!file});
      try{
        if(!file&&!source)await ctx.route('**/*',async route=>{
          const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
          const f=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
          if(!f.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{
          try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}
          window.copyTest=[];window.searchTest=[];
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copyTest.push(text)}});
          window.open=(...args)=>{window.searchTest.push(args);return null;};
        });
        const ready=()=>page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        await page.goto(url.href);await ready();
        const $=s=>page.locator(s),stage=$('#stage');
        const take=(key)=>$(`.compare-slip[data-citation="${key}"]:not([hidden])`);
        const open=async(code,ref)=>{
          assert.ok(await page.evaluate(({code,ref})=>V25ScriptureWindows.open({code,ref}),{code,ref}));
          const pane=take(code+'.'+ref);await pane.waitFor();return pane;
        };
        const verse=(p,ref)=>p.locator('.compare-slip__verse[data-ref="'+ref+'"]');
        const tools=p=>p.locator('.paper-selection-tools');
        const cdp=mobile?await ctx.newCDPSession(page):null;
        async function point(row){
          await row.scrollIntoViewIfNeeded();
          return row.evaluate(n=>{
            const view=n.closest('.compare-slip__scroll').getBoundingClientRect();
            for(const r of n.getClientRects()){
              const y=(Math.max(r.top,view.top)+Math.min(r.bottom,view.bottom))/2,x=(r.left+r.right)/2;
              if(r.width>6&&r.top<view.bottom-3&&r.bottom>view.top+3&&n.contains(document.elementFromPoint(x,y)))return {x,y};
            }
            throw Error('Verse is clipped or covered: '+n.dataset.ref);
          });
        }
        async function input(p,ref,long=false){
          const q=await point(verse(p,ref));
          if(mobile){
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[q]});
            if(long)await page.waitForTimeout(430);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          }else{
            await page.mouse.move(q.x,q.y);await page.mouse.down();
            if(long)await page.waitForTimeout(430);
            await page.mouse.up();
          }
        }
        const selected=p=>p.locator('[data-selected-verse]').evaluateAll(nodes=>nodes.map(n=>n.dataset.ref));
        const task=(p,what)=>tools(p).locator('[data-'+what+']');
        const position=()=>stage.evaluate(n=>['spread','scale','x','y'].map(k=>n.dataset[k]));
        async function actMarks(){
          return page.evaluate(()=>{
            const db=V25OriginalData,start=db.lookup('ACT','7:56');
            return [start,start+1].map(n=>{
              const p=db.pages[n],b=db.books[p.b],list=PaperPage.commands(p,n,db.books).filter(c=>c.role!=='footer-rule');
              const key=['paper-bible-highlights-v1',b.code,n,p.start,p.end].join(':');
              return PaperTextSelection.indexFace(p,list).units.filter(u=>u.group==='verse:7:56')
                .map(u=>PAPER_READER_STORAGE.getItem(key+'~mark~'+u.id));
            });
          });
        }

        let act=await open('ACT','7:56');
        const main=await position();
        await input(act,'7:56');assert.equal(await tools(act).count(),0,'plain taps do not enter selection');
        const color=loc=>loc.evaluate(n=>getComputedStyle(n).backgroundColor);
        await act.locator('[data-focused-verse=""]').waitFor({timeout:3500});
        assert.equal(await color(verse(act,'7:56')),'rgb(233, 189, 168)');
        await input(act,'7:56',true);await tools(act).waitFor();
        assert.deepEqual(await selected(act),['7:56']);
        assert.ok(await task(act,'study').isDisabled(),'no QAP at Acts 7:56');
        assert.ok(await task(act,'copy').isEnabled(),'other actions stay available');
        const hasNotes=await task(act,'note').count()===1;
        assert.deepEqual(await tools(act).locator('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),
          ['复制','网页搜索','高亮','另开对照',...(hasNotes?['写笔记','查看资料']:['经文问答']),'退出']);
        assert.ok(await tools(act).locator(':scope > button').evaluateAll(nodes=>
          nodes.every(n=>n.getBoundingClientRect().top===nodes[0].getBoundingClientRect().top)));
        assert.deepEqual(await position(),main);
        assert.equal(await color(verse(act,'7:56')),'rgb(231, 182, 122)');
        if(process.env.FLOAT_SELECTION_SHOTS)await act.screenshot({path:path.join(process.env.FLOAT_SELECTION_SHOTS,`float-selection-${width}.png`)});
        await task(act,'copy').click();await tools(act).waitFor({state:'detached'});
        assert.deepEqual(await page.evaluate(()=>copyTest),['就说：“我看见天开了，人子站在　神的右边。”\n( 使徒行传 7:56 和合本 )']);
        await input(act,'7:56',true);await task(act,'highlight').click();
        assert.equal(await verse(act,'7:56').getAttribute('data-saved-verse'),'');
        assert.equal(await color(verse(act,'7:56')),'rgb(245, 217, 154)');
        const saved=await actMarks();assert.ok(saved.every(parts=>parts.length&&parts.every(x=>x==='1')),JSON.stringify(saved));
        assert.ok(await $('.paper-ink-mark--saved').count(),'main sheet refreshes without a navigation');
        await page.reload();await ready();act=await open('ACT','7:56');
        assert.equal(await verse(act,'7:56').getAttribute('data-saved-verse'),'');
        await input(act,'7:56',true);
        assert.equal(await task(act,'highlight').getAttribute('aria-label'),'取消高亮');
        await task(act,'highlight').click();
        assert.equal(await verse(act,'7:56').getAttribute('data-saved-verse'),null);
        assert.ok((await actMarks()).every(parts=>parts.length&&parts.every(x=>x==='0')));
        assert.equal(await $('.paper-ink-mark--saved').count(),0);
        await act.locator('[aria-label="关闭经文浮窗"]').click();

        const gen=await open('GEN','1:30'),scroller=gen.locator('.compare-slip__scroll');
        if(!mobile){
          const from=await point(verse(gen,'1:30')),to=await point(verse(gen,'1:31'));
          await page.mouse.move(from.x,from.y);await page.mouse.down();
          await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();
          await tools(gen).waitFor();
          assert.deepEqual(await selected(gen),['1:30','1:31'],'desktop drag selects complete intersected verses');
          await page.keyboard.press('Escape');await tools(gen).waitFor({state:'detached'});
          assert.ok(await gen.isVisible(),'Escape exits selection before it can close the fixed window');
        }
        await input(gen,'1:30',true);
        assert.deepEqual(await selected(gen),['1:30'],'long press near the end of the chapter');
        await input(gen,'1:31');
        assert.deepEqual(await selected(gen),['1:30','1:31'],'tap adds a nearby verse');
        await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new WheelEvent('wheel',{deltaY:240}));});
        await verse(gen,'2:1').waitFor({state:'attached'});
        assert.equal(await tools(gen).count(),1,'chapter rolling must retain the toolbar');
        await input(gen,'2:1');
        assert.deepEqual(await selected(gen).then(v=>v.sort()),['1:30','1:31','2:1']);
        await page.evaluate(()=>document.getElementById('zoom-in').click());
        assert.deepEqual((await selected(gen)).sort(),['1:30','1:31','2:1']);
        await task(gen,'copy').click();await tools(gen).waitFor({state:'detached'});
        const copied=await page.evaluate(()=>copyTest[0]);
        assert.deepEqual(copied.split('\n\n').map(b=>b.split('\n').at(-1)),['( 创世记 1:30-31 和合本 )','( 创世记 2:1 和合本 )']);

        await input(gen,'2:1',true);await task(gen,'search').click();
        assert.match(await tools(gen).textContent(),/发送给 Google/);
        assert.deepEqual(await page.evaluate(()=>searchTest),[]);
        await tools(gen).locator('input').fill('这一节讲了什么？');
        await tools(gen).getByRole('button',{name:'搜索',exact:true}).click();
        const [[searchURL,target,flags]]=await page.evaluate(()=>searchTest);
        const parsed=new URL(searchURL);
        assert.equal(parsed.origin,'https://www.google.com');assert.equal(target,'_blank');assert.equal(flags,'noopener,noreferrer');
        assert.match(parsed.searchParams.get('q'),/创世记 2:1 和合本[\s\S]*这一节讲了什么？/);
        await tools(gen).waitFor({state:'detached'});
        await input(gen,'2:1',true);await task(gen,'float').click();await tools(gen).waitFor({state:'detached'});
        const alt=take('GEN.2:1');await alt.waitFor();
        assert.equal(await $('.compare-slip[data-role=fixed]:not([hidden])').count(),2);
        await input(alt,'2:1',true);await task(alt,'float').click();await tools(alt).waitFor({state:'detached'});
        assert.equal(await $('.compare-slip[data-role=fixed]:not([hidden])').count(),2,'an identical comparison does not consume a slot');
        await input(alt,'2:1',true);
        await alt.locator('[aria-label="收起经文浮窗"]').click();
        await tools(alt).waitFor({state:'detached'});
        assert.equal(await alt.getAttribute('data-collapsed'),'');
        assert.equal(await alt.locator('[data-selected-verse]').count(),0);
        const preview=$('#v25-scripture-preview');
        await page.evaluate(()=>V25ScriptureWindows.openPreview([{code:'PSA',ref:'23:1'}],{kind:'footnote',focus:true}));
        assert.equal(await preview.locator('.compare-slip__scroll').getAttribute('data-verse-picking'),'');
        await input(preview,'23:1',true);await tools(preview).waitFor();
        assert.deepEqual(await selected(preview),['23:1']);
        await task(preview,'copy').click();await tools(preview).waitFor({state:'detached'});
        assert.ok(await preview.isVisible(),'copying does not pin or close the preview');
        assert.match(await page.evaluate(()=>copyTest.at(-1)),/诗篇 23:1/);
        await preview.locator('.compare-slip__scroll').press('Shift+Space');await tools(preview).waitFor();
        await preview.locator('.compare-slip__scroll').press('Escape');
        assert.ok(await preview.isVisible());
        await page.evaluate(()=>V25ScriptureWindows.preview.close());
        await open('EXO','1:1');await open('MAT','5:1');const rom=await open('ROM','8:1');
        await input(rom,'8:2',true);await task(rom,'float').click();
        assert.equal(await $('.compare-slip[data-role=fixed]:not([hidden])').count(),5);
        assert.equal(await take('ROM.8:2').count(),0);
        assert.deepEqual(await selected(rom),['8:2'],'a refused sixth window retains the selection');
        const limit=$('#v25-compare-limit');
        await limit.waitFor({state:'visible'});
        assert.match(await limit.textContent(),/已有 5 个浮窗.*请先关闭一个/);
        assert.deepEqual(errors,[]);
        console.log(width,'PASS fixed-verse selection, split-vs physical highlight sync, reload, copy/search, multi-chapter selection, and another window');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
