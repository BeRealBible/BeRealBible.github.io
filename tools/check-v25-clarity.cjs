'use strict';
// npm install playwright pngjs; npx playwright install chromium
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const playwright=require.resolve(process.env.PLAYWRIGHT_MODULE||'playwright');
const {chromium}=require(playwright),{PNG}=createRequire(playwright)('pngjs');
const [before,after,output]=process.argv.slice(2);
if(!before||!after||!output)throw Error('Usage: node tools/check-v25-clarity.cjs BASELINE_URL_OR_HTML CANDIDATE_URL_OR_HTML OUTPUT_DIR');
const urlOf=value=>/^https?:\/\//i.test(value)?value:pathToFileURL(path.resolve(value)).href;
const location=process.env.CLARITY_REF||'MAT.21:16',[code,ref]=location.split('.');
const cases=(process.env.CLARITY_CASES||'1280:1,390:2,390:3').split(',').map(c=>c.split(':').map(Number));
const opening='.stage[data-v25-opening],.pcz-intro';
const still=page=>page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));
});
const rounded=n=>Number(n.toFixed(3));
function inkDelta(a,b,boxes,dpr){
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let total=0,high=0,sum=0,inkA=0,inkB=0;
  for(const [x,y,w,h] of boxes){
    for(let row=Math.ceil(y*dpr);row<Math.floor((y+h)*dpr);row++){
      for(let col=Math.ceil(x*dpr);col<Math.floor((x+w)*dpr);col++){
        const i=(row*a.width+col)*4,g1=a.data[i+1],g2=b.data[i+1];
        // Ignore blank pixels. Changes of one or two levels from compositing
        // are fine; softened strokes, offsets and missing ink are not.
        if(Math.min(g1,g2)>222)continue;
        const diff=Math.abs(g1-g2);total++;sum+=diff;high+=diff>12;
        inkA+=Math.max(0,235-g1);inkB+=Math.max(0,235-g2);
      }
    }
  }
  assert.ok(total>300,'the sampled rectangles must contain text');
  return {samples:total,mean:rounded(sum/total),strong:rounded(100*high/total),
    inkChange:rounded(100*Math.abs(inkB-inkA)/inkA)};
}
async function capture(browser,url,label,width,dpr){
  const mobile=width<550,isFile=url.startsWith('file:');
  const prefix=path.join(output,`${label}-${width}-dpr${dpr}`);
  const context=await browser.newContext({viewport:{width,height:840},isMobile:mobile,hasTouch:mobile,
    deviceScaleFactor:dpr,reducedMotion:'no-preference',offline:isFile});
  try{
    const page=await context.newPage(),errors=[],miss=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',r=>miss.push([new URL(r.url()).pathname,r.failure()?.errorText]));
    await page.addInitScript(()=>{
      try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}
      const seen=window.clarityOpening={started:false,ended:false};
      const monitor=new MutationObserver(()=>{
        if(document.querySelector('.stage[data-v25-opening],.pcz-intro'))seen.started=true;
        else if(seen.started){seen.ended=true;monitor.disconnect();}
      });
      monitor.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-v25-opening']});
    });
    const u=new URL(url);u.searchParams.set('ref',location);u.searchParams.delete('curl');
    await page.goto(u.href,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000}).catch(async e=>{
      throw Error(label+' '+JSON.stringify({state:await page.locator('html').getAttribute('data-rule-layout'),errors,miss:miss.slice(0,10)}),{cause:e});
    });
    await page.locator(opening).waitFor({state:'detached',timeout:15000});
    await still(page);
    const intro=await page.evaluate(()=>window.clarityOpening);
    const release=await page.evaluate(()=>({
      reader:document.getElementById('v25-desk-controller')?.getAttribute('href')||null,
      edition:document.documentElement.dataset.physicalEdition,hasOpening:!!window.V25Opening
    }));
    if(release.hasOpening)assert.ok(intro.started&&intro.ended,'normal-motion validation must observe the real opening');
    const cdp=await context.newCDPSession(page);
    await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const {root}=await cdp.send('DOM.getDocument');
    const used=async selector=>{
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
      return nodeId?(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts:[];
    };
    const paperLocator=`.paper svg text[data-role=body][data-ref="${ref}"]`;
    const states={},png={};
    for(const mode of ['initial','fit','focus','zoom']){
      await page.evaluate(({mode,code,ref})=>{
        PaperImmersion.hideChrome();
        const side=V25OriginalData.lookup(code,ref)&1;
        const action={fit:'fit-book',focus:side?'focus-right':'focus-left',zoom:'zoom-in'}[mode];
        if(action)document.getElementById(action).click();
      },{mode,code,ref});
      await still(page);
      const state=await page.evaluate(selector=>{
        const stage=document.getElementById('stage'),texts=[...document.querySelectorAll(selector)];
        const q=texts.find(el=>/\p{Unified_Ideograph}/u.test(el.textContent))||texts[0];
        if(!q)throw Error('requested passage was not rendered');
        const bounds=stage.getBoundingClientRect(),box=[];
        for(const face of stage.querySelectorAll('.paper>svg[data-pdf]')){
          const r=face.getBoundingClientRect();
          const left=Math.max(r.left+r.width*.09,bounds.left+12,0),right=Math.min(r.right-r.width*.09,bounds.right-12,innerWidth);
          const top=Math.max(r.top+r.height*.13,bounds.top+12,0),bottom=Math.min(r.bottom-r.height*.15,bounds.bottom-12,innerHeight);
          if(right-left>22&&bottom-top>34)box.push([left,top,right-left,bottom-top]);
        }
        return {spread:stage.dataset.spread,scale:stage.dataset.scale,x:stage.dataset.x,y:stage.dataset.y,dpr:devicePixelRatio,
          fill:getComputedStyle(q).fill,box,
          ink:texts.map(el=>[el.textContent,el.getAttribute('transform'),el.getAttribute('font-family')])};
      },paperLocator);
      state.platformFonts=await used(paperLocator);
      assert.ok(state.platformFonts.length,'the platform must report the actual paper font');
      states[mode]=state;
      png[mode]=PNG.sync.read(await page.screenshot({path:`${prefix}-${mode}.png`}));
    }
    let float;
    if(await page.evaluate(()=>!!window.V25ScriptureWindows)){
      assert.equal(await page.evaluate(({code,ref})=>V25ScriptureWindows.open({bookCode:code,ref}),{code,ref}),true);
      await page.mouse.move(0,0);
      await still(page);
      const panel=page.locator('#v25-compare'),selector='#v25-compare .compare-slip__verse[data-cited]';
      const measures=()=>page.locator(selector).evaluate(el=>{
        const css=getComputedStyle(el),panel=el.closest('aside'),panelCSS=getComputedStyle(panel);
        const box=panel.getBoundingClientRect(),z=parseFloat(panelCSS.zoom)||1;
        return {family:css.fontFamily,size:parseFloat(css.fontSize),color:css.color,weight:css.fontWeight,
          transform:panelCSS.transform,filter:panelCSS.filter,opacity:panelCSS.opacity,
          layoutScale:z,renderedFont:parseFloat(css.fontSize)*z,bookScale:Number(document.querySelector('#stage').dataset.scale),
          followsPaper:panel.hasAttribute('data-slip-scale'),box:{width:box.width,height:box.height}};
      });
      float=await measures();
      float.platformFonts=await used(selector);
      assert.ok(float.platformFonts.some(f=>f.glyphCount>3),'the actual floating text font must be loaded');
      assert.ok(float.size>=14&&float.transform==='none'&&float.filter==='none'&&float.opacity==='1',
        'the floating text stays opaque at readable size and is not transform-scaled or filtered');
      const first=await panel.screenshot({path:`${prefix}-float.png`});
      await page.evaluate(()=>document.getElementById('fit-book').click());
      await still(page);
      const second=await panel.screenshot({path:`${prefix}-float-after-main-zoom.png`});
      float.afterFit=await measures();
      if(float.followsPaper&&width>=800){
        for(const s of [float,float.afterFit]){
          assert.ok(Math.abs(s.layoutScale-Math.max(.88,s.bookScale))<.002,
            'wide floating text must be typeset at the actual paper scale');
          assert.equal(s.transform,'none');
          assert.ok(s.renderedFont>=13);
        }
        assert.ok(float.box.width>float.afterFit.box.width&&float.box.height>float.afterFit.box.height,
          'the wide window must grow with the book, within the viewport');
      }else{
        const a=PNG.sync.read(first),b=PNG.sync.read(second);
        // Decorative folds and shadows can reveal the newly positioned desk;
        // only compare the opaque text area on builds/windows with fixed size.
        float.zoomDelta=inkDelta(a,b,[[10,44,a.width/dpr-26,a.height/dpr-58]],dpr);
        assert.ok(float.zoomDelta.mean<=.2&&float.zoomDelta.strong===0,
          'narrow floating scripture stays independent of book zoom');
      }
      await page.screenshot({path:`${prefix}-both.png`});
    }
    return {states,png,float,errors,miss,intro,release};
  }finally{await context.close();}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE||undefined,headless:true}),evidence={};
  try{
    for(const [width,dpr] of cases){
      const a=await capture(browser,urlOf(before),'baseline',width,dpr);
      const b=await capture(browser,urlOf(after),'candidate',width,dpr),deltas={};
      for(const mode of Object.keys(a.states)){
        const x=a.states[mode],y=b.states[mode];
        const sameInk=JSON.stringify(x.ink)===JSON.stringify(y.ink),sameFont=JSON.stringify(x.platformFonts)===JSON.stringify(y.platformFonts),
          sameCamera=['spread','scale','x','y','dpr'].every(k=>x[k]===y[k]);
        const delta=deltas[mode]=inkDelta(a.png[mode],b.png[mode],x.box,dpr);
        console.log(width,dpr,mode,JSON.stringify({sameInk,sameFont,sameCamera,...delta}));
        // Large changes to dark pixels require investigation even if the SVG
        // and computed styles are identical (e.g. a blurred GPU layer).
        if(!sameInk||!sameFont||!sameCamera||x.fill!==y.fill||delta.mean>2||delta.strong>2||delta.inkChange>2)process.exitCode=1;
      }
      delete a.png;delete b.png;
      evidence[`${width}:${dpr}`]={baseline:a,candidate:b,deltas};
      if(a.errors.length||b.errors.length){console.log({baseline:a.errors,candidate:b.errors});process.exitCode=1;}
    }
    await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify({reference:location,cases:evidence},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
