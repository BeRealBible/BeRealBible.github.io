'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const file=process.env.PREVIEW_FILE,value=process.argv[2];
if(!file&&!value)throw Error('Supply PREVIEW_FILE or a V25 URL');
const url=new URL(file?pathToFileURL(path.resolve(file)):value);
url.searchParams.set('v','index-25');url.searchParams.set('ref','GEN.1:1');url.searchParams.set('curl','off');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  const cases=[
    {width:1280,height:840,mouse:true,auto:true,label:'desktop'},
    {width:620,height:840,mouse:true,auto:false,label:'narrow desktop'},
    {width:390,height:840,mouse:false,auto:false,label:'portrait phone'},
    {width:900,height:390,mouse:false,auto:false,label:'landscape touch'}
  ];
  try{
    for(const {width,height,mouse,auto,label} of cases){
      const ctx=await browser.newContext({viewport:{width,height},hasTouch:!mouse,isMobile:!mouse,
        reducedMotion:'reduce',offline:!!file});
      try{
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        const shelf=page.locator('#reading-history'),stage=page.locator('#stage'),root=page.locator('html');
        const visible=()=>root.getAttribute('data-reader-chrome');
        const hidden=()=>shelf.waitFor({state:'hidden',timeout:3000});
        const shown=()=>shelf.waitFor({state:'visible',timeout:3000});
        const camera=()=>stage.evaluate(n=>['spread','scale','x','y'].map(k=>n.dataset[k]));
        const x=16,edge=height-2,away=height-140;
        const cdp=mouse?null:await ctx.newCDPSession(page),send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
        await page.evaluate(()=>document.getElementById('fit-book').click());
        assert.equal(await visible(),'hidden');
        if(auto){
          await page.mouse.move(x,height-25);await page.mouse.wheel(0,300);
          assert.equal(await visible(),'hidden','wheel and moving near (but not into) the strip do not reveal');
          const old=await camera();
          await page.mouse.move(x,edge);await shown();
          assert.equal(await shelf.evaluate(n=>n.inert),false);
          assert.deepEqual(await camera(),old,'the bottom toolbar is an overlay, not a new reading layout');
          await page.mouse.move(x,height-26);await page.waitForTimeout(680);
          assert.equal(await visible(),'visible','it stays open when the mouse moves from the edge into the shelf');
          await shelf.getByRole('button',{name:'浏览历史'}).click();
          await page.mouse.move(x,away);
          await hidden();assert.equal(await shelf.evaluate(n=>n.inert),true);

          await page.mouse.move(x,edge);await shown();
          await page.keyboard.press('Escape');await hidden();
          await page.mouse.move(x+16,edge);
          assert.equal(await visible(),'hidden','explicit dismissal does not immediately reopen at the same edge');
          await page.mouse.move(x,away);
          await page.mouse.down();await page.mouse.move(x,edge,{steps:7});
          assert.equal(await visible(),'hidden','a drag that crosses the edge does not trigger the toolbar');
          await page.mouse.up();
          await page.mouse.move(x,away);
          await page.evaluate(()=>document.getElementById('location-button').click());
          await page.locator('#book-picker').waitFor();
          await page.mouse.move(x,edge);
          assert.equal(await visible(),'hidden','modal directory remains undisturbed');
          await page.keyboard.press('Escape');
          await page.mouse.move(x,away);await page.mouse.move(x,edge);await shown();
          await page.setViewportSize({width:620,height});await hidden();
        }else{
          // Pointer hover or a contact in the outer desk margin is not a
          // deliberate vertical scroll of the paper itself.
          await page.mouse.move(x,away);await page.mouse.move(x,edge);
          await page.waitForTimeout(140);
          assert.equal(await visible(),'hidden',label+' has no automatic edge reveal');
          if(!mouse){
            await send('touchStart',[{x,y:away}]);await send('touchMove',[{x,y:height-60}]);await send('touchMove',[{x,y:edge}]);await send('touchEnd');
            assert.equal(await visible(),'hidden','touch drag on the outer desk does not reveal the shelf');
          }
        }
        // Manual controls retain their old interaction on every form factor.
        if(mouse)await page.mouse.click(8,12);else await page.touchscreen.tap(8,12);
        await shown();
        if(mouse){await page.mouse.move(200,80);await page.waitForTimeout(600);assert.equal(await visible(),'visible');}
        if(mouse)await page.mouse.click(8,12);else await page.touchscreen.tap(8,12);
        await hidden();
        await page.setViewportSize({width,height});
        const zoomed=await stage.evaluate(el=>{
          document.getElementById('fit-book').click();
          for(let i=0;i<20&&+el.dataset.scale*724<el.clientHeight+330;i++)document.getElementById('zoom-in').click();
          return +el.dataset.scale*724-el.clientHeight;
        });
        assert.ok(zoomed>275,'test must start with real vertical scrolling space');
        const hide=async()=>{await page.evaluate(()=>PaperImmersion.hideChrome());await hidden();};
        async function scroll(d){
          const x=Math.round(width*.54),a=Math.round(height/2);
          if(mouse){await page.mouse.move(x,a);await page.mouse.wheel(0,d);}
          else{
            await send('touchStart',[{x,y:a}]);
            await send('touchMove',[{x,y:a-Math.round(d/2)}]);
            await send('touchMove',[{x,y:a-d}]);await send('touchEnd');
          }
        }
        const [spread,, ,startY]=await camera();
        await scroll(62);await page.waitForFunction(y=>+document.getElementById('stage').dataset.y<+y,startY);
        assert.equal(await visible(),'hidden','scrolling through the middle of the paper leaves the shelf hidden');
        for(let i=0;i<24&&await visible()==='hidden';i++)await scroll(Math.floor(height*.40));
        await shown();
        const bottom=await stage.evaluate(el=>({y:+el.dataset.y,min:el.clientHeight-18-724*+el.dataset.scale}));
        assert.ok(Math.abs(bottom.y-bottom.min)<1,'the shelf is revealed at the real bottom of the paper');
        assert.equal((await camera())[0],spread,'a vertical boundary does not turn the page');
        await hide();await page.waitForTimeout(250);
        for(let i=0;i<24&&await visible()==='hidden';i++)await scroll(-Math.floor(height*.40));
        await shown();
        assert.ok(Math.abs(+(await camera())[3]-18)<1,'the shelf is revealed at the real top of the paper');
        assert.equal((await camera())[0],spread);

        const full=shelf.getByRole('button',{name:'全屏阅读',exact:true});
        assert.equal(await full.getAttribute('aria-pressed'),'false');
        if(label==='desktop'){
          await full.click();
          await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
          await hidden();
          assert.equal((await camera())[0],spread,'entering fullscreen keeps the reading spread');
          await page.evaluate(()=>PaperImmersion.showChrome());await shown();
          const exit=shelf.getByRole('button',{name:'退出全屏',exact:true});
          assert.equal(await exit.getAttribute('aria-pressed'),'true');
          await exit.click();await page.waitForFunction(()=>!document.fullscreenElement);
          await full.waitFor();assert.equal(await full.getAttribute('aria-pressed'),'false');
        }
        if(label==='portrait phone'){
          await page.evaluate(()=>{
            Object.defineProperty(document,'fullscreenEnabled',{value:false});
            Object.defineProperty(document.documentElement,'webkitRequestFullscreen',{value:undefined});
          });
          const notice=page.getByText('当前浏览器不支持网页全屏，可继续正常阅读。',{exact:true});
          await full.tap();
          // The mixed raw-CDP drag and Playwright tap can drop the first
          // compatibility click, even when a pointerdown/up reached the button.
          if(!await notice.waitFor({timeout:650}).then(()=>true,()=>false))await full.tap();
          await notice.waitFor();
          assert.equal(await full.getAttribute('aria-pressed'),'false');
        }
        assert.deepEqual(errors,[]);
        console.log('PASS',label,'shelf controls, vertical boundaries and fullscreen');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
