'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const entry=process.argv[2],origin='http://127.0.0.1:37168';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const [width,side,ref] of [[390,'right','GEN.4:1'],[320,'left','REV.21:1'],[1280,'right','GEN.4:1']]){
      const touch=width<550,ctx=await browser.newContext({viewport:{width,height:840},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
      try{
        if(!entry)await ctx.route('**/*',async route=>{
          const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
          const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
          if(!file.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        await ctx.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
        const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        const url=new URL(entry||origin);url.searchParams.set('ref',ref);
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.locator('html[data-rule-layout=ready]').waitFor({state:'attached',timeout:90000});
        await page.locator('#stage[data-v25-opening]').waitFor({state:'detached',timeout:12000});
        const stage=page.locator('#stage'),menu=page.locator('.edge-chapters:not([hidden])');
        const state=()=>stage.evaluate(el=>{
          const d=el.dataset;
          return {camera:[+d.spread,d.book,d.x,d.y,d.scale],fold:d.foldState||null,
            history:PAPER_READER_STORAGE.getItem('paper-bible-v25-compare-trails-v1')};
        });
        await stage.evaluate(async()=>{
          document.getElementById('fit-book').click();PaperImmersion.hideChrome();
          // The compositor must publish the new hit regions before CDP touches them.
          for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
        });
        const start=await state(),points=await stage.evaluate((el,side)=>{
          const match=(s,x,y)=>document.elementFromPoint(x,y)?.closest(s);
          const tabSelector=`.edge-index__group[data-side="${side}"]:not([hidden]):enabled`;
          const byRect=(nodes,owns,{rows=[.5,.4,.6,.3,.7],columns=[.5,.35,.65]}={})=>{
            for(const node of nodes){
              const r=node.getBoundingClientRect();
              for(const f of columns)for(const g of rows){
                const x=Math.round(r.left+r.width*f),y=Math.round(r.top+r.height*g);
                if(x>2&&x<innerWidth-3&&y>80&&y<innerHeight-80&&owns(node,x,y))return{x,y};
              }
            }
          };
          const band=`.edge-index__band[data-side="${side}"]`;
          const margin=document.getElementById(side+'-paper').getBoundingClientRect();
          const gap=innerWidth<550?4:7;
          const paper={x:Math.round(side==='right'?margin.right-gap:margin.left+gap),y:Math.round(margin.top+margin.height*.32)};
          if(!match('#'+side+'-paper',paper.x,paper.y)||match('.edge-index',paper.x,paper.y))throw Error('Expected a bare paper margin');
          // Use the outside end of the band, away from the tabs, so Chromium
          // is less likely to snap the touch to a nearby clickable target.
          return {band:byRect(el.querySelectorAll(band),(n,x,y)=>match(band,x,y)===n,
            {columns:side==='right'?[.92,.8,.6,.5]:[.08,.2,.4,.5],rows:[.04,.96,.08,.92,.5]}),
            tab:byRect(el.querySelectorAll(tabSelector),(n,x,y)=>match(tabSelector,x,y)===n),paper};
        },side);
        assert.ok(points.band&&points.tab,`${width}: need hit-tested ${side} band and tab`);
        const cdp=touch?await ctx.newCDPSession(page):null,send=(type,touchPoints=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
        async function drag(p,dx){
          if(touch)await send('touchStart',[p]);else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
          for(const f of [.25,.55,1]){
            const q={x:Math.round(p.x+dx*f),y:p.y};
            if(touch)await send('touchMove',[q]);else await page.mouse.move(q.x,q.y);
          }
          const during=await state();
          if(touch)await send('touchEnd');else await page.mouse.up();
          return {during,end:await state()};
        }
        const inward=side==='right'?-92:92;
        const tab=stage.locator(`.edge-index__group[data-side="${side}"]:not([hidden]):enabled`).filter({visible:true}).first();
        if(touch)await tab.tap();else await tab.click();
        await menu.waitFor({timeout:8000});
        const panel=await menu.locator('.edge-chapters__panel').boundingBox();
        const sheet={x:Math.round(panel.x+panel.width/2),y:Math.round(panel.y+panel.height/2)};
        const sheetStart=await state(),sheetDrag=await drag(sheet,inward);
        assert.deepEqual(sheetDrag.during,sheetStart,'chapter sheet does not start a turn');
        assert.deepEqual(sheetDrag.end,sheetStart,'dragging inside the sheet does not navigate');
        assert.equal(await menu.count(),1,'dragging inside the sheet does not dismiss it');
        await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
        assert.deepEqual(await state(),start,'opening and closing the sheet does not move the book');
        for(const [label,p,dx] of [['band',points.band,inward],['tab',points.tab,inward],
          ...(touch?[]:[['tab outward',points.tab,-inward],['band outward',points.band,-inward]])]){
          const {during,end}=await drag(p,dx),name=`${width} ${side} ${label}`;
          assert.deepEqual(during,start,`${name}: no page curl or camera shift during the drag`);
          assert.deepEqual(end,start,`${name}: no page, camera or history change on release`);
          assert.equal(await menu.count(),0,`${name}: dragging is not a chapter-menu tap`);
        }
        if(!touch){
          for(const [p,dx] of [[points.tab,120],[points.band,-120]]){
            await page.mouse.move(p.x,p.y);await page.mouse.wheel(dx,0);
            await page.evaluate(()=>new Promise(requestAnimationFrame));
            assert.deepEqual(await state(),start,'a trackpad swipe over the index does not turn the paper');
          }
        }
        const {during,end}=await drag(points.paper,inward);
        assert.equal(during.fold,'dragging','the real paper margin still starts a turn');
        assert.equal(end.camera[0],start.camera[0]+(side==='right'?2:-2),'the real paper margin still turns');
        assert.deepEqual(errors,[]);
        console.log(width,side,'PASS band, tab and chapter-sheet isolation; tap still opens, real paper still turns');
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
