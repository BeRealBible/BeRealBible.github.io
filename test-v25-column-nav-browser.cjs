'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.argv[2],origin='http://127.0.0.1:37168',url=new URL(site||origin);
url.searchParams.set('ref','GEN.4:1');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const near=(a,b,e=1)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`);

async function run(browser,width,height){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  try{
    if(!site)await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
      const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
      if(!file.startsWith(__dirname+path.sep))return route.abort();
      try{await route.fulfill({status:200,body:await fs.readFile(file),contentType:mime[path.extname(file)]});}
      catch{await route.fulfill({status:404,body:'Not found'});}
    });
    await ctx.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
    const stage=page.locator('#stage'),nav=stage.locator('#next-column-shortcut'),fit=stage.locator('#fit-reading-column');
    await stage.locator('xpath=self::*[@data-v25-opening]').waitFor({state:'detached',timeout:12000});
    const shelf=()=>page.locator('html').getAttribute('data-reader-chrome');
    const hideShelf=()=>page.evaluate(()=>PaperImmersion.hideChrome());
    const pos=()=>stage.evaluate(el=>({x:+el.dataset.x,y:+el.dataset.y,s:+el.dataset.scale,spread:+el.dataset.spread,
      w:el.clientWidth,h:el.clientHeight,foot:el.clientHeight-18-724*+el.dataset.scale}));
    const lanes=()=>stage.evaluate(el=>{
      const n=+el.dataset.spread;
      return [0,1,2,3].map(id=>{
        const i=n+(id>>1),side=(id>>1)*480;
        const ink=PaperPage.commands(BIBLE_DATA.pages[i],i,BIBLE_DATA.books).filter(c=>
          c.physicalInk&&!c.hideHatch&&['body','verse','heading','chapter'].includes(c.role)&&((c.x+c.w/2<240)?0:1)===(id&1));
        const body=ink.filter(c=>c.role==='body');if(!body.length)return null;
        const bounds={left:Math.min(...ink.map(c=>c.x))+side,right:Math.max(...ink.map(c=>c.x+c.w))+side,
          top:Math.min(...ink.map(c=>c.y)),bottom:Math.max(...ink.map(c=>c.y+c.h))};
        // Measure the physical ink, not a guessed device-wide swipe constant.
        const first=body.toSorted((a,b)=>a.y-b.y)[0],last=body.toSorted((a,b)=>(b.y+b.h)-(a.y+a.h))[0];
        bounds.first=first.y;bounds.last=last.y+last.h;
        bounds.firstMinHalf=first.h/2;bounds.lastMinHalf=last.h/2;
        return bounds;
      });
    });
    const cdp=await ctx.newCDPSession(page),send=(type,touchPoints=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
    const drag=async(dx,dy)=>{
      const a={x:width/2,y:height/2};
      await send('touchStart',[a]);
      for(const t of [.25,.55,1])await send('touchMove',[{x:a.x+dx*t,y:a.y+dy*t}]);
      await send('touchEnd');
    };
    const move=async(x,y)=>{
      for(let n=0;n<22;n++){
        const p=await pos(),dx=x-p.x,dy=y-p.y;
        if(Math.max(Math.abs(dx),Math.abs(dy))<1.5)return;
        if(Math.abs(dx)>=10)await drag(Math.max(-135,Math.min(135,dx)),0);
        else await drag(Math.abs(dx)>1.5?dx:0,Math.max(-235,Math.min(235,dy)));
        if(Math.abs(dx)<10&&Math.abs(dy)<6)return;
      }
      throw Error('Unable to position the paper for the fixture: '+JSON.stringify({x,y,pose:await pos()}));
    };
    await stage.evaluate(el=>{
      document.getElementById('fit-book').click();
      const r=el.getBoundingClientRect();
      dispatchEvent(new CustomEvent('v25-paper-zoom',{detail:{factor:1.85/(+el.dataset.scale),x:r.width/2,y:r.height/2}}));
    });
    await hideShelf();
    const initial=await pos(),book=await lanes();
    assert.ok(book.every(Boolean),'the starting spread has four consecutive printed columns');
    const [a,b,c,d]=book;
    const aim=lane=>10-lane.left*initial.s;
    // Start slightly above the last line. Bring it into view, but spend less
    // than half a line of the swipe beyond it: there is no offer yet.
    const gap=47,atEnd=height-a.last*initial.s;
    await move(aim(a),atEnd+gap);await hideShelf();
    await drag(0,-(gap+a.lastMinHalf*initial.s*.57));
    const before=await pos();
    assert.ok(before.y+a.last*before.s<height,'the last line is visible');
    assert.ok(!await nav.isVisible(),'less than half a line past the text does not offer navigation');
    assert.equal(await shelf(),'hidden');
    await drag(0,-(a.lastMinHalf*initial.s+8));
    assert.equal(await shelf(),'hidden','the text boundary is not the physical bottom of the paper');
    assert.ok(!await fit.isVisible(),'neither ordinary swipes nor overscroll offer fit');

    async function offered(label){
      await nav.waitFor({timeout:1500});assert.equal(await nav.textContent(),label);
      const box=await nav.evaluate(el=>{
        const r=el.getBoundingClientRect(),ends=[...document.querySelectorAll('#left-paper,#right-paper')].map(e=>e.getBoundingClientRect());
        const shelf=document.getElementById('reading-history').getBoundingClientRect();
        return {hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el,
          inside:ends.some(p=>r.left>=p.left+7&&r.right<=p.right-7&&r.top>=p.top+7&&r.bottom<=p.bottom-7),
          aboveShelf:r.bottom<=shelf.top-5,background:getComputedStyle(el).backgroundColor};
      });
      assert.ok(box.hit&&box.inside,JSON.stringify(box));
      assert.equal(box.background,'rgba(253, 249, 239, 0.85)');
      if(await shelf()==='visible')assert.ok(box.aboveShelf);
    }
    const landed=async(lane,direction,spread)=>{
      const p=await pos();assert.equal(p.spread,spread);near(p.s,initial.s,.0002);
      const x=p.x+(lane.left+lane.right)/2*p.s;
      assert.ok(x>width*.27&&x<width*.75,'the requested column is centred in the reading area');
      if(direction>0)assert.ok(p.y+lane.first*p.s>=0&&p.y+lane.first*p.s<height*.3,'landed at the printed beginning');
      else assert.ok(p.y+lane.last*p.s<=height+.5&&p.y+lane.last*p.s>height*.65,'landed at the printed end');
    };
    await offered('去下一栏');await nav.tap();await landed(b,1,initial.spread);
    await offered('回上一栏');await nav.tap();await landed(a,-1,initial.spread);
    await drag(0,-38);await offered('去下一栏');await nav.tap();await landed(b,1,initial.spread);

    // Move just below the first line, then test the upward threshold without
    // leaning on the immediate undo offer left by the preceding button.
    const bTop=-b.first*initial.s;
    await move((await pos()).x,bTop-gap);await hideShelf();
    await drag(0,gap+b.firstMinHalf*initial.s*.57);
    assert.ok(!await nav.isVisible(),'less than half a line above the first line is not enough');
    assert.equal(await shelf(),'hidden');
    await drag(0,b.firstMinHalf*initial.s+8);await offered('回上一栏');
    assert.equal(await shelf(),'hidden','the physical top is still off screen');
    await drag(0,220);
    assert.equal(await shelf(),'visible');near((await pos()).y,18);
    await hideShelf();

    // Walk through the second and third columns using actual gestures. At
    // the outer right the same button takes you to the next spread only.
    for(const target of [c,d]){
      const p=await pos();
      await move(p.x,height-(target===c?b:c).last*p.s-12);
      await drag(0,-45);await offered('去下一栏');await nav.tap();await landed(target,1,initial.spread);
    }
    const p=await pos();await move(p.x,p.foot+30);await hideShelf();
    await drag(0,-84);await offered('翻下一页');
    assert.equal(await shelf(),'visible');near((await pos()).y,(await pos()).foot);
    assert.equal((await pos()).spread,initial.spread,'a boundary stroke by itself does not turn the page');
    await nav.tap();const ahead=initial.spread+2;
    const newer=await lanes();await landed(newer.find(Boolean),1,ahead);
    await drag(0,45);await offered('翻上一页');
    assert.equal((await pos()).spread,ahead);
    await nav.tap();await landed(d,-1,initial.spread);
    assert.ok(!await stage.locator('#spread-start-shortcut').isVisible(),'no second jump is needed after a button turn');
    assert.deepEqual(errors,[]);
  }finally{await ctx.close();}
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const [width,height] of [[390,844],[680,820]]){
      await run(browser,width,height);console.log(width,'PASS half-line exits, true paper edges, immediate reverse, and both page turns');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
