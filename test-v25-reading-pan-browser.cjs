'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const entry=process.argv[2],origin='http://127.0.0.1:37144',url=new URL(entry||origin);
url.searchParams.set('v','index-25');url.searchParams.set('ref','GEN.2:1');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const screens=[{width:1280,height:840},{width:390,height:840,touch:true},{width:320,height:700,touch:true},{width:390,height:840,touch:true,reduce:true}];
const near=(a,b,eps=1)=>assert.ok(Math.abs(a-b)<=eps,`${a} is not within ${eps} px of ${b}`);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const {width,height,touch=false,reduce=false} of screens){
      const ctx=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:reduce?'reduce':'no-preference'});
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
        const stage=page.locator('#stage'),button=stage.locator('#spread-start-shortcut');
        const fit=()=>stage.evaluate(()=>{document.getElementById('fit-book').click();PaperImmersion.hideChrome();});
        const zoom=()=>stage.evaluate(el=>{
          const fit=document.getElementById('fit-book'),up=document.getElementById('zoom-in');fit.click();
          while(!up.disabled&&(+el.dataset.scale*704<el.clientHeight+430||+el.dataset.scale*960<el.clientWidth+300))up.click();
          PaperImmersion.hideChrome();
        });
        const frames=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
        const pose=()=>stage.evaluate(el=>{
          const d=el.dataset;return {x:+d.x,y:+d.y,scale:+d.scale,spread:+d.spread,coasting:!!d.panCoasting,w:el.clientWidth,h:el.clientHeight};
        });
        const cdp=touch?await ctx.newCDPSession(page):null;
        const send=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
        if(touch){
          const x=Math.round(width*.35),start=Math.round(height*.65);
          const stroke=async({pause=0}={})=>{
            await zoom();const old=await pose();
            await stage.evaluate(el=>{
              window.indexWatch?.disconnect();window.indexEdits=0;
              window.indexWatch=new MutationObserver(records=>{window.indexEdits+=records.length;});
              window.indexWatch.observe(el.querySelector('#edge-index-host'),{attributes:true,childList:true,subtree:true});
            });
            await send('touchStart',[{x,y:start}]);await send('touchMove',[{x,y:start-16}]);
            await frames();near((await pose()).y,old.y-16,1);
            for(const delta of [42,70,100,126])await send('touchMove',[{x,y:start-delta}]);
            if(pause)await page.waitForTimeout(pause);
            await send('touchEnd');return old;
          };
          const assertIndexQuiet=async()=>assert.equal(await page.evaluate(()=>window.indexEdits),0,'moving the camera does not repaint the index');
          let old=await stroke();
          if(reduce){
            const end=await pose();assert.ok(!end.coasting);near(end.y,old.y-126);
            await assertIndexQuiet();
          }else{
            assert.ok((await pose()).coasting,'quick release starts a bounded coast');
            const values=await stage.evaluate(async el=>{
              const frames=[];for(let i=0;i<28;i++){await new Promise(requestAnimationFrame);frames.push(+el.dataset.y);}return frames;
            });
            assert.ok(values.filter((p,i)=>i&&Math.abs(values[i-1]-p)>.2).length>=5,'travel is spread over frames');
            assert.ok(values.every((p,i)=>i===0||p<=values[i-1]+.1),'no overshoot or bounce');
            const end=await pose();assert.ok(end.y<old.y-126-35,'a quick swipe travels farther than direct finger movement');
            assert.equal(end.spread,old.spread);assert.ok(end.y>=end.h-18-724*end.scale-1,'the glide respects the physical page limits');
            await assertIndexQuiet();
            old=await stroke({pause:140});assert.ok(!(await pose()).coasting,'letting go after a pause does not glide');
            near((await pose()).y,old.y-126);
            await stroke();assert.ok((await pose()).coasting);
            await send('touchStart',[{x,y:start}]);const stopped=await pose();assert.ok(!stopped.coasting);
            await frames();near((await pose()).y,stopped.y);await send('touchEnd');
            await zoom();const before=await pose(),right=Math.round(width*.72);
            await send('touchStart',[{x:right,y:start}]);
            for(const delta of [18,34,56,77,99])await send('touchMove',[{x:right-delta,y:start}]);
            await send('touchEnd');assert.ok((await pose()).coasting,'a horizontal pan also coasts without turning');
            await stage.locator('xpath=self::*[@data-pan-coasting]').waitFor({state:'detached'});
            const after=await pose();assert.ok(after.x<before.x-99-25);near(after.y,before.y);assert.equal(after.spread,before.spread);
          }
          await page.evaluate(()=>window.indexWatch.disconnect());
        }
        async function turn(key,change){
          const {spread}=await pose();await stage.press(key);
          await page.waitForFunction(n=>+document.getElementById('stage').dataset.spread===n,spread+change,{timeout:6000});
        }
        const containment=()=>button.evaluate(el=>{
          const r=el.getBoundingClientRect(),stage=el.parentElement.getBoundingClientRect();
          const paper=[...document.querySelectorAll('#left-paper,#right-paper')].some(node=>{
            const p=node.getBoundingClientRect();return r.left>=p.left+7&&r.right<=p.right-7&&r.top>=p.top+7&&r.bottom<=p.bottom-7;
          });
          const shelf=document.getElementById('reading-history').getBoundingClientRect(),css=getComputedStyle(el);
          return {paper,inView:r.left>=stage.left&&r.top>=stage.top&&r.right<=stage.right&&r.bottom<=stage.bottom&&
            r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
            hits:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el,
            aboveShelf:r.bottom<=shelf.top-5,color:css.backgroundColor,right:r.right,left:r.left,top:r.top,bottom:r.bottom};
        });
        async function clickReturn(side){
          const before=await pose();if(touch)await button.tap();else await button.click();
          await page.waitForFunction(()=>document.getElementById('stage').dataset.spreadStartPan==='committed');
          const after=await pose();assert.equal(after.spread,before.spread);assert.equal(after.scale,before.scale);
          if(side==='start'){near(after.x,18);near(after.y,18);}
          else {near(after.x,after.w-18-960*after.scale);near(after.y,after.h-18-704*after.scale);}
          assert.ok(!await button.isVisible());
        }
        await zoom();await turn('ArrowRight',2);await button.waitFor();
        assert.equal(await button.getAttribute('data-corner'),'lower-right');assert.match(await button.textContent(),/回左上/);
        const forward=await containment();assert.ok(forward.paper&&forward.inView&&forward.hits);
        assert.equal(forward.color,'rgba(252, 247, 233, 0.96)');
        await page.evaluate(()=>PaperImmersion.showChrome());await frames();
        const raised=await containment();assert.ok(raised.paper&&raised.inView&&raised.aboveShelf&&raised.hits);
        if(process.env.V25_PAN_SCREENSHOTS){
          const dir=process.env.V25_PAN_SCREENSHOTS;await fs.mkdir(dir,{recursive:true});
          await page.screenshot({path:path.join(dir,`${width}-return-start.png`)});
        }
        await clickReturn('start');
        await turn('ArrowLeft',-2);await button.waitFor();
        assert.equal(await button.getAttribute('data-corner'),'upper-left');assert.match(await button.textContent(),/回右下/);
        const reverse=await containment();assert.ok(reverse.paper&&reverse.inView&&reverse.hits&&reverse.top<forward.top&&reverse.left<forward.left);
        if(process.env.V25_PAN_SCREENSHOTS)await page.screenshot({path:path.join(process.env.V25_PAN_SCREENSHOTS,`${width}-return-end.png`)});
        await clickReturn('end');
        await fit();await turn('ArrowRight',2);assert.ok(!await button.isVisible(),'no shortcut is needed when the whole spread fits');
        if(touch&&!reduce){
          const fitted=await pose(),x=Math.round(fitted.x+950*fitted.scale),y=Math.round(fitted.y+351*fitted.scale);
          const drag=dx=>send('touchMove',[{x:x+dx,y}]);
          await send('touchStart',[{x,y}]);await drag(-34);await drag(-82);
          await page.waitForFunction(()=>+document.getElementById('stage').dataset.foldProgress>0);
          await drag(-44);await send('touchEnd');
          await page.waitForFunction(()=>document.getElementById('stage').dataset.foldState==='returned');
          assert.equal((await pose()).spread,fitted.spread,'a last-moment reversal returns the original leaf');
          await send('touchStart',[{x,y}]);await drag(-36);await drag(-92);await send('touchEnd');
          await page.waitForFunction(n=>+document.getElementById('stage').dataset.spread===n,fitted.spread+2,{timeout:6000});
        }
        assert.deepEqual(errors,[]);console.log(`PASS ${width} px ${touch?'touch':'mouse'}${reduce?' / reduced motion':''}: camera pan and mirrored paper-contained returns`);
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
