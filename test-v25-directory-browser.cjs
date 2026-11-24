'use strict';
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {groups}=require('./v25/search.js');
const url=new URL(process.argv[2]||'https://berealbible.github.io/');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    for(const width of (process.env.DIRECTORY_TEST_WIDTHS||'1280,390,320').split(',').map(Number)){
      const narrow=width<640,reduce=width===320,ctx=await browser.newContext({viewport:{width,height:width<350?690:840},
        isMobile:narrow,hasTouch:narrow,reducedMotion:reduce?'reduce':'no-preference'});
      try{
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
        const left=width===320,code=left?'2SA':'2CO',other=left?'1SA':'1CO',start=left?'REV.21:1':'GEN.4:1';
        url.searchParams.set('ref',start);url.searchParams.set('curl','off');
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.locator('html[data-rule-layout=ready]').waitFor({state:'attached',timeout:90000});
        const stage=page.locator('#stage'),directory=page.getByRole('dialog',{name:'目录 · 选择书卷'}),
          sheet=page.locator('.edge-chapters:not([hidden])'),trigger=page.getByRole('button',{name:'目录',exact:true});
        await stage.evaluate((el,left)=>{
          document.getElementById(left?'focus-right':'focus-left').click();
          for(let i=0;i<4;i++)document.getElementById('zoom-in').click();
          window.directoryFrames=[];
          window.addEventListener('v25-camera-changed',()=>{
            const d=el.dataset;if(d.directoryPan==='running')window.directoryFrames.push({x:+d.x,open:!!document.querySelector('.edge-chapters:not([hidden])')});
          });
        },left);
        const pose=()=>stage.evaluate(el=>[el.dataset.spread,el.dataset.book,+el.dataset.scale,+el.dataset.x,+el.dataset.y]);
        const records=()=>page.evaluate(()=>['paper-bible-position-v1','paper-bible-v25-compare-trails-v1'].map(k=>PAPER_READER_STORAGE.getItem(k)));
        const cut=book=>stage.evaluate((el,code)=>{
          const index=V25OriginalData.books.findIndex(b=>b.code===code);
          const button=[...el.querySelectorAll('.edge-index__group:not([hidden])')].find(n=>n.dataset.members.split(',').includes(String(index)));
          return button?.getBoundingClientRect().toJSON();
        },book);
        const open=async()=>{await page.evaluate(()=>PaperImmersion.showChrome());await trigger.click();await directory.waitFor();};
        const before=await pose(),saved=await records(),outside=await cut(code);
        assert.ok(left?outside.right<0:outside.left>width,'test must start with the requested bookmark outside the viewport');
        await open();
        const buttons=directory.locator('button[data-book]');assert.equal(await buttons.count(),66);
        assert.deepEqual(await directory.locator('section').evaluateAll(all=>all.map(n=>[
          n.getAttribute('aria-label'),Array.from(n.querySelectorAll('button'),b=>b.dataset.book).join(' ')
        ])),Object.entries(groups));
        assert.deepEqual(await buttons.evaluateAll(all=>all.map(b=>b.textContent)),
          await page.evaluate(codes=>codes.map(code=>V25OriginalData.books.find(b=>b.code===code).short),Object.values(groups).join(' ').split(' ')));
        assert.equal(await directory.getByRole('radio').count(),0,'the first dialog only chooses books');
        assert.deepEqual(await pose(),before);
        if(reduce){await page.keyboard.press('Escape');await directory.waitFor({state:'hidden'});assert.deepEqual(await pose(),before);await open();}
        await directory.locator('[data-book="'+code+'"]').click();await directory.waitFor({state:'hidden'});
        await sheet.waitFor();await stage.locator('xpath=self::*[@data-directory-pan="committed"]').waitFor({state:'attached'});
        const after=await pose(),landing=await cut(code),motion=await page.evaluate(()=>window.directoryFrames);
        assert.deepEqual(after.slice(0,3),before.slice(0,3),'opening a bookmark changes neither page, reading book nor zoom');
        assert.ok(Math.abs(after[3]-before[3])>30,'camera pans to the formerly clipped bookmark');
        assert.deepEqual(await records(),saved,'opening a bookmark is not a reading-history event');
        assert.equal(await sheet.locator('.edge-chapters__title').textContent(),await page.evaluate(c=>V25OriginalData.books.find(b=>b.code===c).name,code));
        assert.equal(await sheet.locator('.edge-chapters__book').count(),2,'the actual shared cut still exposes both members');
        assert.equal(await sheet.locator('.edge-chapters__book[aria-pressed=true]').evaluate(n=>V25OriginalData.books[n.dataset.book].code),code);
        assert.equal(await sheet.locator('.edge-chapters__book[aria-pressed=false]').evaluate(n=>V25OriginalData.books[n.dataset.book].code),other);
        const bounds=await sheet.locator('.edge-chapters__panel').boundingBox(),height=page.viewportSize().height;
        assert.ok(bounds.x>=-1&&bounds.y>=-1&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,'land with the chapter sheet in view');
        const [ax,ay]=await sheet.evaluate(n=>[+n.dataset.anchorX,+n.dataset.anchorY]);
        assert.ok(Math.min(Math.abs(ax-landing.left),Math.abs(ax-landing.right))<1.5&&
          Math.min(Math.abs(ay-landing.top),Math.abs(ay-landing.bottom))<1.5,'the displayed leaf is hinged to the actual printed bookmark');
        if(reduce)assert.equal(motion.length,0);
        else assert.ok(motion.length>=2&&motion.every(f=>f.open),'the open chapter leaf follows the animated camera');

        if(left){
          await sheet.locator('[data-chapter="3"]').click();await sheet.waitFor({state:'hidden'});
          await stage.locator('xpath=self::*[@data-book="2SA"]').waitFor({state:'attached'});
        }else{
          await sheet.getByRole('radio',{name:'浮窗打开'}).click();
          await sheet.locator('[data-chapter="3"]').click();await sheet.waitFor({state:'hidden'});
          await page.locator('.compare-slip[data-citation="2CO.3:1"]:not([hidden])').waitFor();
          assert.deepEqual(await pose(),after,'the chapter sheet retains the existing float-opening behavior');
        }
        assert.deepEqual(errors,[]);
        console.log(width,'PASS grouped shortcut, exact shared bookmark, camera-only landing, anchor and chapter routing');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
