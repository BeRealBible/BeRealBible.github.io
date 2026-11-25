'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {pathToFileURL}=require('node:url'),path=require('node:path'),assert=require('node:assert/strict');
const file=process.env.PREVIEW_FILE,entry=process.argv[2];
if(!file&&!entry)throw Error('Supply PREVIEW_FILE or a V25 URL');
const url=new URL(file?pathToFileURL(path.resolve(file)):entry);
url.searchParams.set('v','index-25');url.searchParams.set('curl','off');url.searchParams.set('ref','MAT.21:16');
const closeTo=(a,b,t=.85)=>assert.ok(Math.abs(a-b)<=t,`${a} is not close to ${b}`);
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    for(const width of (process.env.SLIP_SCALE_WIDTHS||'1440,390').split(',').map(Number)){
      const h=width>=800?960:840,mobile=width<550,wide=width>=800;
      const ctx=await browser.newContext({viewport:{width,height:h},hasTouch:mobile,isMobile:mobile,offline:!!file,reducedMotion:'reduce'});
      try{
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
        await page.goto(url.href,{waitUntil:'domcontentloaded'});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        const settle=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
        const click=id=>page.evaluate(id=>document.getElementById(id).click(),id);
        const fit=async()=>{await click('fit-book');await settle();};
        const read=(p)=>p.evaluate(panel=>{
          const glyph=panel.querySelector('.compare-slip__verse[data-cited]'),scroll=panel.querySelector('.compare-slip__scroll');
          const r=panel.getBoundingClientRect(),title=panel.querySelector('.compare-slip__head').getBoundingClientRect();
          const text=Array.from(glyph.childNodes).find(n=>n.nodeType===3&&n.textContent.trim()),range=document.createRange();
          range.setStart(text,0);range.setEnd(text,1);
          const css=getComputedStyle(panel),body=getComputedStyle(glyph);
          return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:r.width,h:r.height,title:title.height,
            glyph:range.getBoundingClientRect().height,font:parseFloat(body.fontSize),layout:Number(panel.dataset.slipScale),
            transform:css.transform,book:Number(document.querySelector('#stage').dataset.scale),
            logicalScroll:scroll.scrollTop};
        });
        const bookZoom=async(p,factor=1.3)=>{
          assert.equal(await p.evaluate((p,f)=>{
            const r=p.getBoundingClientRect();
            return p.querySelector('.compare-slip__scroll').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-Math.log(f)/.003,
              clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));
          },factor),false,'the float zoom gesture should zoom the book, not the browser');
          await settle();
        };
        const check=(a,b)=>{
          assert.ok(b.book>a.book);
          assert.equal(b.transform,'none');
          if(wide){
            closeTo(b.layout,b.book,.001);
            const ratio=b.layout/a.layout;
            closeTo(b.w,a.w*ratio);closeTo(b.h,a.h*ratio);closeTo(b.title,a.title*ratio);
            // An actual glyph box, not just CSS font-size, grows.
            closeTo(b.glyph,a.glyph*ratio,1.8);
          }else{
            assert.equal(b.layout,1);
            for(const k of ['w','h','title','glyph'])closeTo(b[k],a[k],.15);
          }
        };
        await fit();
        assert.ok(await page.evaluate(()=>V25ScriptureWindows.open({code:'GEN',ref:'2:5'})));
        const pin=page.locator('#v25-compare'),area=pin.locator('.compare-slip__scroll');
        await area.evaluate(el=>{el.scrollTop=el.querySelector('[data-ref="2:15"]').offsetTop-18;});
        await settle();
        const a=await read(pin);await bookZoom(pin);const b=await read(pin);
        check(a,b);closeTo(b.logicalScroll,a.logicalScroll,2);
        if(process.env.SLIP_SCALE_SHOTS)await page.screenshot({path:path.join(process.env.SLIP_SCALE_SHOTS,`compare-zoom-${width}.png`)});

        await fit();
        if(wide){
          const title=pin.locator('.compare-slip__title'),grip=pin.locator('.compare-slip__resize');
          for(let n=0;n<12;n++)await title.press('Shift+ArrowLeft');
          await grip.press('Shift+ArrowLeft');await grip.press('Shift+ArrowUp');
          const manual=await read(pin);await bookZoom(pin);const resized=await read(pin);
          check(manual,resized);
          closeTo(resized.left,manual.left,1);closeTo(resized.top,manual.top,1);
          closeTo(resized.logicalScroll,manual.logicalScroll,2);
        }
        const beforeFolding=await read(pin);
        await pin.getByRole('button',{name:'收起经文浮窗',exact:true}).click();await settle();
        const paperTab=await pin.boundingBox();assert.equal(await pin.getAttribute('data-slip-scale'),'1');
        await click('zoom-in');await settle();
        const paperTab2=await pin.boundingBox();
        closeTo(paperTab2.width,paperTab.width,.1);closeTo(paperTab2.height,paperTab.height,.1);
        await pin.locator('.compare-slip__title').click();await settle();
        const restored=await read(pin);
        check(beforeFolding,restored);
        closeTo(restored.logicalScroll,beforeFolding.logicalScroll,2);
        for(let n=0;n<6;n++)await click('zoom-in');
        const limit=await read(pin);
        assert.ok(limit.left>=0&&limit.top>=0&&limit.right<=width+.2&&limit.bottom<=h+.2,JSON.stringify(limit));
        if(wide)closeTo(limit.layout,limit.book,.001);
        await pin.getByRole('button',{name:'关闭经文浮窗',exact:true}).click();

        const preview=page.locator('#v25-scripture-preview');
        for(const kind of ['footnote','search']){
          await fit();
          assert.ok(await page.evaluate(kind=>V25ScriptureWindows.openPreview([{code:'MAT',ref:'21:16'}],{kind}),kind));
          const first=await read(preview);await bookZoom(preview);check(first,await read(preview));
          await page.evaluate(()=>V25ScriptureWindows.preview.close());
        }
        await fit();
        await page.keyboard.press('Control+k');await page.locator('#vf-input').fill('光');await page.locator('#vf-input').press('Enter');
        await page.locator('#vf-list button').first().waitFor();
        await page.keyboard.press('Escape');
        const searchTab=page.locator('#vf-tab');await searchTab.waitFor();
        const searchA=await searchTab.boundingBox();await click('zoom-in');await settle();
        const searchB=await searchTab.boundingBox();
        closeTo(searchA.width,searchB.width,.1);closeTo(searchA.height,searchB.height,.1);
        assert.ok(searchB.x>=0&&searchB.y>=0&&searchB.x+searchB.width<=width&&searchB.y+searchB.height<=h);
        assert.deepEqual(errors,[]);
        console.log(width,'PASS paper scale, crisp layout, reading anchor, manual bounds, and fixed-width paper tabs');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
