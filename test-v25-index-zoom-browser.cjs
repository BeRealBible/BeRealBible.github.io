'use strict';
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=new URL(process.argv[2]||'https://berealbible.github.io/');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{
    for(const width of (process.env.INDEX_ZOOM_WIDTHS||'1280,390,320').split(',').map(Number)){
      const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:840},isMobile:mobile,
        hasTouch:mobile,reducedMotion:'reduce'});
      try{
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
        // At the far end of the volume the exposed cuts are on the left.
        url.searchParams.set('ref',width===320?'REV.21:1':'GEN.4:1');
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        const stage=page.locator('#stage'),menu=page.locator('.edge-chapters:not([hidden])');
        await page.locator('html[data-rule-layout=ready]').waitFor({state:'attached',timeout:90000});
        const fit=()=>page.evaluate(()=>document.getElementById('fit-book').click());
        const scale=()=>stage.evaluate(el=>+el.dataset.scale);
        const identity=()=>stage.evaluate(el=>[el.dataset.spread,el.dataset.book]);
        const viewportScale=()=>page.evaluate(()=>visualViewport.scale);
        const hits=()=>stage.evaluate(el=>{
          const r=el.getBoundingClientRect(),{x,scale}=el.dataset,s=+scale;
          const left=r.left+Number(x),right=left+960*s;
          const all=[...el.querySelectorAll('.edge-index__group:not([hidden]):enabled')].map(tab=>{
            const b=tab.getBoundingClientRect(),ty=Math.round(b.top+b.height/2),side=tab.dataset.side;
            const lo=Math.ceil(Math.max(b.left,3)),hi=Math.floor(Math.min(b.right-1,innerWidth-3));
            if(ty<80||ty>innerHeight-80)return null;
            // Deliberately take the bit that sticks out past the page; an
            // inward drag target alone must not make this regression pass.
            const xs=Array.from({length:Math.max(0,hi-lo+1)},(_,i)=>lo+i);
            const tx=xs.find(n=>(side==='left'?n<left:n>right)&&tab.contains(document.elementFromPoint(n,ty)));
            return tx===undefined?null:{x:tx,y:ty,side,group:tab.dataset.group};
          }).filter(Boolean);
          const ink=[...el.querySelectorAll('.paper text[data-role="body"]')].map(n=>{
            const b=n.getBoundingClientRect(),x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2);
            return x>5&&x<innerWidth-5&&y>80&&y<innerHeight-80&&n.contains(document.elementFromPoint(x,y))?{x,y}:null;
          }).filter(Boolean);
          for(const a of all){
            const b=all.find(p=>p.side===a.side&&p.y-a.y>=32&&p.y-a.y<=100);
            if(!b)continue;
            const paper=ink.filter(p=>p.y-a.y>=28&&p.y-a.y<=115).sort((p,q)=>{
              const cost=z=>Math.abs(z.y-b.y)*2+Math.abs(Math.abs(z.x-a.x)-65);
              return cost(p)-cost(q);
            })[0];
            if(paper)return {a,b,paper};
          }
          throw Error('No visible protruding index tabs beside the paper: '+JSON.stringify({left,right,s,tabs:all.length,ink:ink.length}));
        });
        const tabFor=p=>stage.locator(`.edge-index__group[data-side="${p.side}"][data-group="${p.group}"]:not([hidden])`);
        await fit();const initialIdentity=await identity(),initialBrowserScale=await viewportScale();
        if(mobile){
          const cdp=await ctx.newCDPSession(page),send=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
          async function pinch(p,q){
            const initial=await scale(),dir=p.y<q.y?-1:1;
            p={x:p.x,y:p.y,id:1};q={x:q.x,y:q.y,id:2};
            await send('touchStart',[p]);await send('touchStart',[p,q]);
            for(const dy of [12,28,46])await send('touchMove',[{...p,y:p.y+dir*dy},{...q,y:q.y-dir*dy}]);
            const grown=await scale();
            for(const dy of [28,12])await send('touchMove',[{...p,y:p.y+dir*dy},{...q,y:q.y-dir*dy}]);
            const shrunk=await scale();await send('touchEnd',[{...p,y:p.y+dir*12}]);await send('touchEnd',[]);
            assert.ok(grown>initial*1.12,`pinch must zoom the book (${initial} → ${grown})`);
            assert.ok(shrunk<grown/1.12,'pinching in reduces the same book scale');
            assert.ok(shrunk>initial*1.07,'the final index scale must differ from the starting scale');
            assert.ok(!await page.locator('#fit-reading-column').isVisible(),'an index contact never offers text fitting');
            assert.equal(await menu.count(),0,'releasing on a tab must not activate its chapter menu');
            assert.deepEqual(await identity(),initialIdentity);
            assert.equal(await viewportScale(),initialBrowserScale,'do not zoom the native browser viewport');
          }
          for(const kind of ['both','index first','paper first']){
            await fit();const {a,b,paper}=await hits();
            assert.equal(a.side,width===320?'left':'right','cover both fore-edges across the phone viewports');
            try{await (kind==='both'?pinch(a,b):kind==='index first'?pinch(a,paper):pinch(paper,a));}
            catch(error){throw Error(width+' '+kind+': '+error.message,{cause:error});}
          }
          await fit();const {a}=await hits();await tabFor(a).tap();await menu.waitFor({timeout:8000});
          const panel=await menu.locator('.edge-chapters__panel').boundingBox(),initial=await scale();
          const x=Math.round(panel.x+panel.width/2),y=Math.round(panel.y+panel.height/2);
          const a0={x,y:y-16,id:1},b0={x,y:y+16,id:2};
          await send('touchStart',[a0]);await send('touchStart',[a0,b0]);
          for(const dy of [9,19,28])await send('touchMove',[{...a0,y:a0.y-dy},{...b0,y:b0.y+dy}]);
          await send('touchEnd',[]);
          assert.ok(await scale()>initial*1.12,'the open chapter sheet also zooms the same book');
          assert.equal(await menu.count(),1,'pinching the open menu does not choose a chapter or dismiss it');
          assert.ok(!await page.locator('#fit-reading-column').isVisible(),'an open chapter sheet never offers text fitting');
        }else{
          const {a,paper}=await hits();
          async function wheel(p){
            const s=await scale();await page.mouse.move(p.x,p.y);await page.keyboard.down('Control');
            try{await page.mouse.wheel(0,-120);await page.waitForFunction(s=>+document.getElementById('stage').dataset.scale>s+.02,s);}
            finally{await page.keyboard.up('Control');}
            return (await scale())/s;
          }
          const indexFactor=await wheel(a);await fit();const paperFactor=await wheel(paper);
          assert.ok(Math.abs(indexFactor-paperFactor)<.005,'index tab and scripture use the same wheel zoom curve');
          await fit();const p=(await hits()).a;await tabFor(p).click();await menu.waitFor({timeout:8000});
          const r=await menu.locator('.edge-chapters__panel').boundingBox();await wheel({x:r.x+r.width/2,y:r.y+r.height/2});
          assert.equal(await menu.count(),1,'zooming the open menu keeps it open');
          assert.deepEqual(await identity(),initialIdentity);
          assert.equal(await viewportScale(),initialBrowserScale);
        }
        assert.deepEqual(errors,[]);
        console.log(width,'PASS zoom on the actual index tab, paper, and open chapter sheet; no accidental navigation');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
