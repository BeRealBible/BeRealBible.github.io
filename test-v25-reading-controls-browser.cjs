'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const entry=process.argv[2],origin='http://127.0.0.1:37167',url=new URL(entry||origin);
const captures=process.env.V25_READING_CONTROL_SHOTS;
url.searchParams.set('ref','GEN.2:1');url.searchParams.set('curl','off');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const near=(a,b,max=1)=>assert.ok(Math.abs(a-b)<=max,`${a} is not within ${max} CSS px of ${b}`);

async function run(browser,width,height,touch,wide){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:'reduce'});
  try{
    if(!entry)await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
      const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
      if(!file.startsWith(__dirname+path.sep))return route.abort();
      try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
      catch{await route.fulfill({status:404,body:'Not found'});}
    });
    await ctx.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
    const $=selector=>page.locator(selector),stage=$('#stage'),fitButton=$('#fit-reading-column');
    const pos=()=>stage.evaluate(el=>({x:+el.dataset.x,y:+el.dataset.y,scale:+el.dataset.scale,spread:+el.dataset.spread,w:el.clientWidth,h:el.clientHeight}));
    const activate=el=>touch?el.tap():el.click();
    const chrome=()=>page.evaluate(()=>PaperImmersion.showChrome());
    const whole=()=>page.evaluate(()=>{document.getElementById('fit-book').click();PaperImmersion.hideChrome();});
    const key=await page.evaluate(()=>{
      const key=PaperReadingHistory.COMPARE_KEY;
      const items=['2:1','3:1'].map((ref,i)=>({ref,page:V25OriginalData.lookup('GEN',ref),bookCode:'GEN',bookName:'创世记',
        id:'r'+(i+1),pinned:i===0,pinOrder:i===0?1:0}));
      (window.PAPER_READER_STORAGE||window.localStorage).setItem(key,JSON.stringify({version:1,items,activeId:'r1',serial:2,pinSerial:1}));
      dispatchEvent(new StorageEvent('storage',{key}));
      return key;
    });
    const history=()=>page.evaluate(key=>(window.PAPER_READER_STORAGE||window.localStorage).getItem(key),key);
    const cdp=touch&&await ctx.newCDPSession(page);
    const shot=async name=>{if(captures)await page.screenshot({path:path.join(captures,width+'-'+name+'.png')});};
    const send=(type,touchPoints=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
    const tapPoint=async el=>{const r=await el.boundingBox();await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);};

    await chrome();
    const row=$('#reading-history .rh-item[data-id=r1]'),chip=row.locator('.rh-chip'),mark=chip.locator('.rh-pin-mark');
    const actions=row.locator('.rh-action'),pin=row.locator('.rh-pin');
    assert.equal(await actions.count(),3);
    assert.equal(await actions.filter({visible:true}).count(),0,'pinned actions are not hit targets before interaction');
    assert.equal(await mark.getAttribute('aria-hidden'),'true');
    assert.equal(await mark.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    if(touch){
      await tapPoint(mark);await row.waitFor();
      assert.equal(await row.getAttribute('data-pinned'),'true','a quick tap on the pin mark never unpins');
      await chrome();
      const r=await chip.boundingBox(),at={x:r.x+r.width/2,y:r.y+r.height/2};
      await send('touchStart',[at]);await page.waitForTimeout(485);await send('touchEnd');
      assert.equal(await row.getAttribute('data-reveal'),'touch');
      assert.equal(await row.getAttribute('data-pinned'),'true','the hold itself does not run an action');
    }else{
      await chip.hover();
      assert.equal(await row.getAttribute('data-reveal'),'mouse');
    }
    await pin.waitFor({timeout:1500});
    const actionBoxes=await row.evaluate(el=>({reveal:el.dataset.reveal,shelf:document.documentElement.dataset.readerChrome,
      items:[...el.querySelectorAll('.rh-action')].map(b=>{
        const r=b.getBoundingClientRect(),css=getComputedStyle(b);
        return {visibility:css.visibility,position:css.position,rect:r.toJSON(),
          hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className};
      })}));
    assert.equal(await actions.filter({visible:true}).count(),3,JSON.stringify(actionBoxes));
    assert.ok(await row.evaluate(el=>{
      const top=el.getBoundingClientRect().top;
      return [...el.querySelectorAll('.rh-action')].every(b=>{
        const r=b.getBoundingClientRect();
        return r.bottom<=top+.25&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      });
    }), 'all three management buttons have real hit targets above the chip');
    await shot('history');
    await activate(pin);
    assert.equal(await row.getAttribute('data-pinned'),null);
    assert.equal(await actions.filter({visible:true}).count(),0);

    // Open the same screen-sized locator at different physical book scales.
    const input=$('#vf-input'),finder=$('#verse-finder');
    const open=async()=>{await chrome();await activate($('#reading-history').getByRole('button',{name:'定位搜索框',exact:true}));await input.waitFor();};
    const metrics=()=>input.evaluate(el=>{
      const panel=el.closest('#verse-finder'),r=el.getBoundingClientRect(),pr=panel.getBoundingClientRect();
      return {text:parseFloat(getComputedStyle(el).fontSize)*r.height/el.offsetHeight,h:r.height,w:pr.width,
        hit:el===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)};
    });
    await whole();const base=await pos();await open();const small=await metrics();
    await activate(finder.getByRole('button',{name:'结束检索'}));
    const zoom=async factor=>stage.evaluate((el,factor)=>{
      const r=el.getBoundingClientRect();
      dispatchEvent(new CustomEvent('v25-paper-zoom',{detail:{factor,x:r.left+r.width/2,y:r.top+r.height/2}}));
    },factor);
    await zoom(6);assert.ok((await pos()).scale>base.scale*2);
    await open();const big=await metrics();
    near(big.text,small.text,.35);near(big.h,small.h,.75);
    assert.ok(big.w<=small.w+1&&big.hit&&small.hit,JSON.stringify({small,big}));
    await shot('locator-at-high-zoom');
    await activate(finder.getByRole('button',{name:'结束检索'}));
    if(!touch){assert.equal(await fitButton.count(),0);assert.deepEqual(errors,[]);return;}

    // Reconstruct ink lanes from the mounted spread as an independent check of
    // the camera result. More visible width wins, then proximity to the centre.
    const candidates=()=>stage.evaluate(el=>{
      const d=el.dataset,scale=+d.scale,x=+d.x,y=+d.y,w=el.clientWidth,h=el.clientHeight,spread=+d.spread;
      const lanes=[0,1,2,3].map(id=>{
        const index=spread+(id>>1),offset=(id>>1)*480;
        const ink=PaperPage.commands(BIBLE_DATA.pages[index],index,BIBLE_DATA.books).filter(c=>
          c.physicalInk&&!c.hideHatch&&['body','verse','heading','chapter'].includes(c.role)&&((c.x+c.w/2<240)?0:1)===(id&1));
        if(!ink.some(c=>c.role==='body'))return null;
        const left=Math.min(...ink.map(c=>c.x))+offset,right=Math.max(...ink.map(c=>c.x+c.w))+offset;
        const top=Math.max(0,y+Math.min(...ink.map(c=>c.y))*scale),bottom=Math.min(h,y+Math.max(...ink.map(c=>c.y+c.h))*scale);
        return {id,left,right,top,bottom,width:Math.min(w,x+right*scale)-Math.max(0,x+left*scale),distance:Math.abs(x+(left+right)/2*scale-w/2)};
      }).filter(c=>c&&c.width>0&&c.bottom>c.top);
      return lanes.sort((a,b)=>Math.abs(b.width-a.width)>.5?b.width-a.width:a.distance-b.distance);
    });
    const verifyFit=async()=>{
      await fitButton.waitFor({timeout:1800});
      const box=await fitButton.boundingBox();
      near(box.x+box.width/2,width/2);near(box.y+box.height/2,height/2);
      const before=await pos(),[target]=await candidates(),priorHistory=await history();
      assert.ok(target,'selected a visible ink lane');
      await fitButton.tap();
      assert.equal(await fitButton.isVisible(),false);
      const after=await pos(),paperWidth=target.right-target.left;
      assert.equal(after.spread,before.spread);
      assert.equal(await history(),priorHistory,'adapting does not move the active bookmark or create a trail');
      near(after.scale,Math.min(3.2,width*(wide?.72:.84)/paperWidth),.0003);
      near(after.x+(target.left+target.right)/2*after.scale,width*(wide?.43:.52),1);
      const anchor=Math.min(target.bottom,Math.max(target.top,height*.45));
      const anchored=anchor-(anchor-before.y)/before.scale*after.scale;
      if(anchored>=height-18-724*after.scale&&anchored<=18&&724*after.scale>height-36)near(after.y,anchored,1);
      return target.id;
    };
    const drag=async(dx,dy)=>{
      const start={x:Math.round(width*.58),y:Math.round(height*.57)};
      await send('touchStart',[start]);
      for(const n of [.25,.55,1])await send('touchMove',[{x:start.x+dx*n,y:start.y+dy*n}]);
      await send('touchEnd');
    };
    await whole();
    const p={x:Math.round(width*.5),y:Math.round(height*.52)},beforePinch=await pos();
    const pinch=delta=>[0,1].map(id=>({x:p.x+(id===0?-delta:delta),y:p.y,id}));
    await send('touchStart',pinch(46));await send('touchMove',pinch(68));await send('touchMove',pinch(107));await send('touchEnd');
    assert.ok((await pos()).scale>beforePinch.scale*1.5);
    assert.equal(await stage.getAttribute('data-last-gesture'),'pinch');
    await verifyFit();
    await shot('adaptive-column');
    const initial=await pos();
    await drag(0,initial.y>initial.h-18-724*initial.scale+95?-78:78);
    assert.notEqual((await pos()).y,initial.y);
    assert.ok(!await fitButton.isVisible(),'single-finger pan does not offer fit');
    const oldScale=(await pos()).scale;
    await send('touchStart',pinch(60));
    await send('touchMove',pinch(60).map(pt=>({...pt,y:pt.y+36})));await send('touchEnd');
    near((await pos()).scale,oldScale,.01);
    assert.ok(!await fitButton.isVisible(),'same-scale two-finger pan does not offer fit');
    if(wide){
      // The outermost right lane has no further leaf behind it. The camera
      // still must align left of centre without snapping back on vertical pan.
      for(let n=0;n<9&&(await candidates())[0]?.id!==3;n++)await drag(-290,0);
      assert.equal((await candidates())[0]?.id,3,'reached the outer right column');
      assert.ok(!await fitButton.isVisible());
      await send('touchStart',pinch(62));await send('touchMove',pinch(68));await send('touchEnd');
      assert.equal(await verifyFit(),3);
      const aligned=await pos();
      await drag(0,aligned.y>aligned.h-18-724*aligned.scale+95?-72:72);
      assert.notEqual((await pos()).y,aligned.y);
      near((await pos()).x,aligned.x);
    }
    await page.evaluate(()=>document.getElementById('zoom-in').click());
    await fitButton.waitFor({timeout:1500});
    const beforeSwipe=await pos(),box=await fitButton.boundingBox(),a={x:box.x+box.width/2,y:box.y+box.height/2};
    const dy=beforeSwipe.y>beforeSwipe.h-18-724*beforeSwipe.scale+95?-72:72;
    await send('touchStart',[a]);await send('touchMove',[{...a,y:a.y+dy}]);await send('touchEnd');
    assert.notEqual((await pos()).y,beforeSwipe.y,'a swipe starting on the centred button still moves the paper');
    assert.ok(!await fitButton.isVisible());
    await page.evaluate(()=>document.getElementById('zoom-out').click());
    await fitButton.waitFor({timeout:1500});await fitButton.waitFor({state:'hidden',timeout:3000});
    assert.deepEqual(errors,[]);
  }finally{await ctx.close();}
}

(async()=>{
  if(captures)await fs.mkdir(captures,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const [w,h,touch,wide] of [[1280,840,false,false],[390,844,true,false],[680,820,true,true]]){
      await run(browser,w,h,touch,wide);console.log(w,'PASS guarded history actions, readable locator, and expected touch column behaviour');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
