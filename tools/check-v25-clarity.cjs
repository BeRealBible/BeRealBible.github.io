'use strict';
// Capture the same passage, viewport, device scale and reader zoom in two builds.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [online,offline,output]=process.argv.slice(2);
if(!online||!offline||!output)throw Error('Usage: node tools/check-v25-clarity.cjs ONLINE_URL OFFLINE_HTML OUTPUT_DIR');
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const reference='MAT.21:16';
const tools=(process.env.CLARITY_CASES||'1280:1,390:2').split(',').map(c=>c.split(':').map(Number));
async function capture(browser,url,label,width,dpr){
  const mobile=width<550;
  const context=await browser.newContext({viewport:{width,height:840},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:dpr,reducedMotion:'reduce'});
  try{
    const page=await context.newPage(),errors=[],miss=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>miss.push([new URL(r.url()).pathname,r.failure()?.errorText]));
    await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
    const u=new URL(url);u.searchParams.set('ref',reference);u.searchParams.set('curl','off');
    await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000}).catch(async e=>{
      throw Error(label+' '+JSON.stringify({state:await page.locator('html').getAttribute('data-rule-layout'),errors,miss:miss.slice(0,10)}),{cause:e});
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const {root}=await cdp.send('DOM.getDocument');
    const used=async selector=>{
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
      return nodeId?(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts:[];
    };
    const paperLocator='.paper svg text[data-role=body][data-ref="21:16"]';
    const settle=()=>page.evaluate(async()=>{
      await document.fonts.ready;
      await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));
    });
    const show=async mode=>{
      await page.evaluate(mode=>{
        PaperImmersion.hideChrome();
        const side=V25OriginalData.lookup('MAT','21:16')&1;
        document.getElementById(mode==='fit'?'fit-book':(side?'focus-right':'focus-left')).click();
      },mode);
      await settle();
      const result=await page.evaluate(selector=>{
        const stage=document.getElementById('stage'),texts=[...document.querySelectorAll(selector)];
        const q=texts.find(el=>/\p{Unified_Ideograph}/u.test(el.textContent))||texts[0],r=q.getBoundingClientRect(),css=getComputedStyle(q);
        return {spread:stage.dataset.spread,scale:stage.dataset.scale,x:stage.dataset.x,y:stage.dataset.y,dpr:devicePixelRatio,
          family:css.fontFamily,fill:css.fill,weight:css.fontWeight,w:r.width,h:r.height,transform:q.getAttribute('transform'),
          ink:texts.map(el=>[el.textContent,el.getAttribute('transform'),el.getAttribute('font-family')]),
          webFonts:[...document.fonts].map(f=>[f.family,f.status])};
      },paperLocator);
      result.platformFonts=await used(paperLocator);
      const png=await page.screenshot({path:path.join(output,label+'-'+width+'-'+mode+'.png')});
      return {...result,pixelHash:digest(png)};
    };
    const fit=await show('fit'),focus=await show('focus');
    let float;
    if(label==='offline'){
      await page.evaluate(()=>V25ScriptureWindows.open({bookCode:'MAT',ref:'21:16'}));
      await settle();
      const panel=page.locator('#v25-compare');
      const selector='#v25-compare .compare-slip__verse[data-cited]';
      float=await page.locator(selector).evaluate(el=>{
        const css=getComputedStyle(el);return {family:css.fontFamily,size:css.fontSize,color:css.color,weight:css.fontWeight};
      });
      float.platformFonts=await used(selector);
      await panel.screenshot({path:path.join(output,label+'-'+width+'-float.png')});
      await page.screenshot({path:path.join(output,label+'-'+width+'-both.png')});
    }
    return {fit,focus,float,errors,miss};
  }finally{await context.close();}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||undefined,headless:true});
  const evidence={};
  try{
    for(const [width,dpr] of tools){
      const live=await capture(browser,online,'online',width,dpr);
      const local=await capture(browser,pathToFileURL(offline).href,'offline',width,dpr);
      evidence[width]={online:live,offline:local};
      for(const mode of ['fit','focus']){
        const a=live[mode],b=local[mode];
        const sameInk=JSON.stringify(a.ink)===JSON.stringify(b.ink),sameFont=JSON.stringify(a.platformFonts)===JSON.stringify(b.platformFonts),
          sameCamera=a.scale===b.scale&&a.x===b.x&&a.y===b.y&&a.dpr===b.dpr;
        console.log(width,mode,'same screenshot:',a.pixelHash===b.pixelHash,'same glyph positions:',sameInk,
          'same actual font:',sameFont,'same camera:',sameCamera);
        if(!sameInk||!sameFont||!sameCamera||a.fill!==b.fill)process.exitCode=1;
      }
      if(live.errors.length||local.errors.length){console.log({live:live.errors,local:local.errors});process.exitCode=1;}
    }
    await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
