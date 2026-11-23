'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.json':'application/json','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};

(async()=>{
  let server,browser;
  try{
    let base=process.argv[2];
    const file=process.env.PREVIEW_FILE;
    if(file)base=pathToFileURL(path.resolve(file)).href;
    if(!base){
      server=http.createServer((req,res)=>{
        const name=path.resolve(__dirname,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
        if(!name.startsWith(__dirname+path.sep)||!fs.existsSync(name)||!fs.statSync(name).isFile()){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');
        fs.createReadStream(name).pipe(res);
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      base='http://127.0.0.1:'+server.address().port+'/index.html';
    }
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
    const sizes=(process.env.INDEX_TEST_WIDTHS||'1280,390,320').split(',').map(Number);
    for(const width of sizes){
      const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:width<350?680:840},
        isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce',offline:!!file});
      try{
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
        const addr=new URL(base);addr.searchParams.set('v','index-25');addr.searchParams.set('ref','GEN.1:1');addr.searchParams.set('curl','off');
        const ready=()=>page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        await page.goto(addr.href);await ready();
        const $=s=>page.locator(s),edge=$('.edge-chapters:not([hidden])'),picker=$('#book-picker');
        const source=()=>page.evaluate(()=>{
          const s=document.getElementById('stage').dataset;
          return [s.spread,s.x,s.y,s.scale];
        });
        const state=async(root,chosen)=>{
          const radios=root.getByRole('radio');
          assert.equal(await radios.count(),2);
          assert.deepEqual(await radios.evaluateAll(all=>all.map(b=>[b.dataset.opening,b.getAttribute('aria-checked'),b.tabIndex])),
            ['page','float'].map(mode=>[mode,String(mode===chosen),mode===chosen?0:-1]));
          assert.equal(await root.locator('input[type=radio]').count(),0);
        };
        async function openEdge(index=0){
          await page.evaluate(()=>document.getElementById('fit-book').click());
          // Pick the printed cut that owns the requested book rather than
          // depending on how the left and right cuts are split at this spread.
          const cut=$('.edge-index__group:not([hidden])[data-members]');
          const n=await cut.evaluateAll((all,i)=>all.findIndex(el=>el.dataset.members.split(',').map(Number).includes(i)),index);
          assert.ok(n>=0,'requested book cut is present');
          if(mobile)await cut.nth(n).tap();else await cut.nth(n).click();
          await edge.waitFor();return edge;
        }
        async function openFull(){
          await page.evaluate(()=>document.getElementById('location-button').click());
          await picker.waitFor();return picker;
        }
        const choose=(where,name)=>where.getByRole('radio',{name,exact:true});
        const pinned=key=>$(`.compare-slip[data-citation="${key}"]:not([hidden])`);
        const chapter=(where,n)=>where.locator('.edge-chapters__chapter[data-chapter="'+n+'"]');
        const fullChapter=n=>picker.locator('#book-picker-chapters').getByRole('button',{name:'第 '+n+' 章',exact:true});
        const selectedPosition=ref=>page.waitForFunction(expected=>{
          const p=JSON.parse(PAPER_READER_STORAGE.getItem('paper-bible-position-v1')||'null');
          return p?.ref===expected&&p?.explicitRef;
        },ref,{timeout:12000});

        await openEdge();await state(edge,'page');
        const box=await choose(edge,'全页打开').boundingBox();
        assert.ok(box.width>=23&&box.height>=23,'the controls should stay tappable even in whole-book fit');
        if(process.env.INDEX_SCREENSHOTS){
          fs.mkdirSync(process.env.INDEX_SCREENSHOTS,{recursive:true});
          await edge.locator('.edge-chapters__panel').screenshot({path:path.join(process.env.INDEX_SCREENSHOTS,'index-'+width+'-page.png')});
        }
        await chapter(edge,4).click();await edge.waitFor({state:'hidden'});await selectedPosition('4:1');
        assert.equal(await $('.compare-slip:not([hidden])').count(),0);

        await openEdge();const original=await source();
        await choose(edge,'全页打开').focus();
        await page.keyboard.press('ArrowRight');await state(edge,'float');
        assert.equal(await choose(edge,'浮窗打开').evaluate(n=>n===document.activeElement),true);
        assert.deepEqual(await source(),original,'choosing a mode cannot navigate');
        await edge.getByRole('button',{name:'经文摘读',exact:true}).click();await state(edge,'float');
        if(process.env.INDEX_SCREENSHOTS)await edge.locator('.edge-chapters__panel').screenshot({path:path.join(process.env.INDEX_SCREENSHOTS,'index-'+width+'-float.png')});
        await chapter(edge,20).click();await edge.waitFor({state:'hidden'});
        const twentieth=pinned('GEN.20:1');
        await twentieth.waitFor();
        assert.deepEqual(await source(),original,'opening the floating chapter must not change the main paper');
        assert.equal(await twentieth.locator('[data-cited] sup').textContent(),'1');
        assert.equal(await twentieth.locator('[data-cited]').evaluate(el=>el.textContent.slice(1)),
          await page.evaluate(()=>BIBLE_SOURCE.books[0].chapters.find(c=>c.chapter===20).verses[0][1]));
        assert.equal(await $('.rh-chip').filter({hasText:'创 20'}).count(),1);

        await page.reload();await ready();
        await openFull();await state(picker,'float');
        const saved=await source();
        await picker.getByRole('button',{name:'出埃及记',exact:true}).click();
        await picker.getByRole('button',{name:'卷首',exact:true}).click();await picker.waitFor({state:'hidden'});
        await pinned('EXO.1:1').waitFor();assert.deepEqual(await source(),saved);
        await openFull();await picker.getByRole('button',{name:'创世记',exact:true}).click();
        await state(picker,'float');await fullChapter(6).click();await pinned('GEN.6:1').waitFor();
        assert.deepEqual(await source(),saved);

        // A full floating shelf must refuse the sixth without silently
        // switching the index back to full-page navigation.
        await page.evaluate(()=>{
          for(const ref of ['7:1','8:1','9:1'])V25ScriptureWindows.open({code:'GEN',ref});
        });
        await openFull();await picker.getByRole('button',{name:'创世记',exact:true}).click();
        await fullChapter(10).click();await picker.waitFor({state:'hidden'});
        assert.equal(await pinned('GEN.10:1').count(),0);
        assert.equal(await $('.compare-slip[data-role=fixed]:not([hidden])').count(),5);
        const limit=$('#v25-compare-limit');
        await limit.waitFor({state:'visible'});
        assert.match(await limit.textContent(),/已有 5 个浮窗.*请先关闭一个/);
        assert.deepEqual(await source(),saved);

        await openFull();await choose(picker,'全页打开').click();await state(picker,'page');
        await picker.getByRole('button',{name:'创世记',exact:true}).click();
        await fullChapter(12).click();await selectedPosition('12:1');
        await page.reload();await ready();
        await openEdge();await state(edge,'page');
        assert.deepEqual(errors,[]);
        console.log(width,'PASS index default, exclusive icon selection, independent display style, canonical floating opening, capacity and reload persistence');
      }finally{await ctx.close();}
    }
  }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
