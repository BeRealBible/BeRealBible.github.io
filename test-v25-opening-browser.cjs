'use strict';
// npm install playwright; npx playwright install chromium
// Optional: PLAYWRIGHT_MODULE, BROWSER_EXE, OPENING_FRAMES, TEST_OFFLINE, or a V25 URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {shot,paperOutline,DURATION}=require('./v25/opening.js');
const boxPose={x:-1012.4,y:-220.2,scale:2.7,w:390,h:840};
const closed=shot(0,boxPose),lead=shot(225,boxPose),end=shot(DURATION,boxPose);
assert.equal(closed.coverAngle,180);assert.equal(closed.paperAngle,180);assert.equal(closed.cuts,0);
assert.ok(lead.coverAngle<180);assert.equal(lead.paperAngle,180);
assert.equal(lead.scale,closed.scale);
assert.deepEqual([end.x,end.y,end.scale,end.coverAngle,end.paperAngle,end.bend,end.cuts],[-1012.4,-220.2,2.7,0,0,0,1]);
assert.equal(paperOutline(0),'none');
assert.notEqual(paperOutline(.9),paperOutline(.9,true));
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.woff2':'font/woff2','.ttf':'font/ttf'};
const ready='#stage[data-spread]',opening='#stage[data-v25-opening]';
async function main(){
  let server,browser;
  try{
    let url=process.argv[2];
    const offline=process.env.TEST_OFFLINE;
    if(offline)url=pathToFileURL(offline).href;
    if(!url){
      server=http.createServer((req,res)=>{
        const file=path.resolve(__dirname,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
        if(!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      url='http://127.0.0.1:'+server.address().port+'/index.html?v=index-25';
    }
    browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
    for(const width of [1200,390]){
      const phone=width===390,height=840;
      const page=await browser.newPage({viewport:{width,height},hasTouch:phone,isMobile:phone,reducedMotion:'reduce',offline:!!offline});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const withRef=new URL(url);withRef.hash='JHN.3:16';
      const waitReady=()=>page.waitForFunction(()=>document.documentElement.dataset.ruleLayout==='ready',null,{timeout:90000});
      await page.goto(withRef.href);await waitReady();
      assert.equal(await page.locator(opening).count(),0,'reduced motion starts at real spread');
      await page.addInitScript(()=>{
        // Time the real (non-mocked) animation separately from the visual samples.
        const frames=window.realOpeningFrames=[];
        function frame(t){
          const running=document.querySelector('#stage[data-v25-opening]');
          if(running)frames.push(t);
          if(running||!frames.length)requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      await page.emulateMedia({reducedMotion:'no-preference'});
      const cpuRate=phone?Number(process.env.OPENING_CPU_RATE)||1:1;
      const cdp=phone?await page.context().newCDPSession(page):null;
      if(cpuRate>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
      await page.reload();await waitReady();
      await page.waitForFunction(()=>{
        const a=parseFloat(document.querySelector('#left-half').style.getPropertyValue('--v25-open-paper-angle'));
        return a<160&&a>20;
      });
      await page.locator(opening).waitFor({state:'detached'});
      const playback=await page.evaluate(()=>{
        const v=realOpeningFrames,dt=v.slice(1).map((t,i)=>t-v[i]).sort((a,b)=>a-b);
        return {frames:v.length,p95:Math.round(dt[Math.floor(.95*dt.length)]),long:dt.filter(t=>t>50).length};
      });
      console.log(`TIMING ${width}px / ${cpuRate}x CPU: ${playback.frames} frames, p95 ${playback.p95} ms, ${playback.long} intervals >50 ms`);
      assert.ok(playback.frames>=5,'the opening paints intermediate real frames');
      if(cpuRate>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
      const saved=await page.evaluate(()=>{
        const d=BIBLE_DATA,stage=document.querySelector('#stage'),spread=+stage.dataset.spread;
        for(let n=spread;n<=spread+1;n++){
          const p=d.pages[n],commands=PaperPage.commands(p,n,d.books).filter(c=>c.role!=='footer-rule');
          const unit=PaperTextSelection.indexFace(p,commands).units.find(u=>u.group.startsWith('verse:'));
          const k=['paper-bible-highlights-v1',d.books[p.b].code,n,p.start,p.end].join(':');
          PAPER_READER_STORAGE.setItem(k,JSON.stringify([unit.id]));
        }
        const position=JSON.parse(PAPER_READER_STORAGE.getItem('paper-bible-position-v1'));
        if(!position||position.ref!=='3:16')throw Error('deep link not restored');
        if(stage.dataset.paperPaint==='flat-touch'){
          // Also exercise a restored zoomed viewport rather than only page fit.
          position.zoom=4;position.centerX=770;position.centerY=350;position.focus='custom';
          PAPER_READER_STORAGE.setItem('paper-bible-position-v1',JSON.stringify(position));
        }
        return {page:position.page,ref:position.ref,spread};
      });
      await page.addInitScript(()=>{
        // Test-only clock for the opening RAF. Other reader, font and network
        // work proceeds normally. Probe real saved ink before the first shot.
        Object.defineProperty(window,'V25Opening',{configurable:true,set(api){
          Object.defineProperty(window,'V25Opening',{value:api,configurable:true});
          const play=api.play,raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame;
          api.play=opts=>{
            const selectors=['#left-paper>svg','#right-paper>svg'];
            const svg=selectors.map(sel=>opts.book.querySelector(sel));
            const marks=svg.map(node=>node.querySelector('.paper-ink-mark--saved'));
            const annotation=svg.map(node=>{
              const dot=document.createElementNS(node.namespaceURI,'circle');
              dot.setAttribute('cx',String(node.parentElement.id==='left-paper'?402:64));dot.setAttribute('cy','295');dot.setAttribute('r','7');dot.setAttribute('fill','#a44460');
              node.append(dot);return dot;
            });
            const frames=new Map(),tracks=new Set();let id=-1;
            const animate=Element.prototype.animate;
            const clockRAF=cb=>{frames.set(id,cb);return id--;},clockCAF=n=>{if(n<0)frames.delete(n);else caf.call(window,n);};
            function inClock(fn){
              window.requestAnimationFrame=clockRAF;window.cancelAnimationFrame=clockCAF;
              Element.prototype.animate=function(...args){
                const a=animate.apply(this,args);a.play=()=>{};tracks.add(a);return a;
              };
              try{return fn();}finally{
                Element.prototype.animate=animate;
                window.requestAnimationFrame=raf;window.cancelAnimationFrame=clockCAF;
              }
            }
            window.openingTest={svg,marks,annotation,selectors,tick(t){
              const entries=[...frames.values()];frames.clear();for(const cb of entries)inClock(()=>cb(t));
              for(const a of tracks)if(a.playState!=='idle')a.currentTime=Math.min(t,a.effect.getTiming().duration);
            }};
            return inClock(()=>play(opts));
          };
        }});
      });
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.goto(url);await waitReady();
      assert.equal(await page.locator(opening).getAttribute('data-v25-opening'),phone?'layout':'transform');
      const framesDir=process.env.OPENING_FRAMES;
      const sample=async(t,label)=>{
        const state=await page.evaluate(t=>{
          const book=document.querySelector('#book'),stage=document.querySelector('#stage');
          const {svg,marks,annotation,selectors,tick}=openingTest;tick(t);
          const box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
          return {cover:parseFloat(book.querySelector('.v25-front-binding').style.getPropertyValue('--v25-open-cover-angle')),
            angle:parseFloat(book.querySelector('#left-half').style.getPropertyValue('--v25-open-paper-angle')),
            pose:[stage.dataset.scale,stage.dataset.x,stage.dataset.y],
            spread:+stage.dataset.spread,unchanged:svg.every((s,i)=>s===book.querySelector(selectors[i])&&marks[i]===s.querySelector('.paper-ink-mark--saved')&&marks[i]&&s.contains(annotation[i])),
            alpha:getComputedStyle(book).opacity,rects:svg.map(box),ink:marks.map(box),annotation:annotation.map(box),
            coverBox:box(document.querySelector('.v25-front-binding')),
            paperCurve:getComputedStyle(svg[0].parentElement,'::before').clipPath,
            cutVisibility:[...document.querySelectorAll('.edge-index__leaf')].map(leaf=>getComputedStyle(leaf).visibility),
            arrow:getComputedStyle(svg[0].parentElement,'::after').display,
            grain:getComputedStyle(document.documentElement).getPropertyValue('--v25-binding-grain'),
            binding:getComputedStyle(document.querySelector('.v25-binding-title')).backgroundImage,
            guide:getComputedStyle(document.getElementById('paper-guide')).display,
            position:JSON.parse(PAPER_READER_STORAGE.getItem('paper-bible-position-v1'))};
        },t);
        if(framesDir){fs.mkdirSync(framesDir,{recursive:true});await page.screenshot({path:path.join(framesDir,`${width}-${label}.png`)});}
        assert.equal(state.alpha,'1');assert.ok(state.unchanged);assert.equal(state.spread,saved.spread);
        assert.equal(state.position.page,saved.page);assert.equal(state.position.ref,saved.ref);
        return state;
      };
      const start=await sample(0,'closed');
      assert.equal(start.angle,180);assert.equal(start.cover,180);
      assert.equal(start.guide,'none');assert.equal(start.arrow,'none');
      assert.deepEqual(start.cutVisibility,['hidden','hidden'],'closed book hides both printed cuts');
      const grainPattern=offline?/data:image\/webp;base64,/:/binding-goatskin\.webp/;
      assert.match(start.grain,grainPattern,'the grain is already decoded at the first frame');
      assert.match(start.binding,grainPattern,'the leather texture is painted on the moving binding');
      assert.equal(await page.locator('.pcz-intro').count(),0);
      const firstLift=await sample(225,'cover-first');
      assert.ok(firstLift.cover<180);assert.equal(firstLift.angle,180);
      assert.deepEqual(firstLift.rects,start.rects,'the leaves wait while the cover lifts');
      assert.notDeepEqual(firstLift.coverBox,start.coverBox);
      assert.deepEqual(firstLift.cutVisibility,['hidden','hidden']);
      const following=await sample(625,'paper-follows');
      assert.ok(following.angle>following.cover&&following.angle<180);
      const turn=await sample(923,'opening');
      assert.ok(turn.angle<90&&turn.angle>3);
      assert.match(turn.paperCurve,/^path\(/);
      assert.deepEqual(turn.cutVisibility,['visible','visible']);
      assert.notDeepEqual(turn.rects[0],start.rects[0]);
      assert.notDeepEqual(turn.ink[0],start.ink[0]);
      assert.notDeepEqual(turn.annotation[0],start.annotation[0]);
      await sample(1175,'almost-open');
      const last=await sample(DURATION,'last-frame'),rest=await sample(DURATION+17,'rest');
      assert.equal(last.angle,0);assert.equal(last.cover,0);assert.equal(last.paperCurve,'none');
      assert.deepEqual(last.cutVisibility,['visible','visible']);
      assert.equal(await page.locator(opening).count(),0);
      assert.equal(start.grain,rest.grain,'the opening did not swap the binding material');
      assert.deepEqual(last.pose,rest.pose);
      for(const [key,a] of Object.entries({rects:last.rects,ink:last.ink,annotation:last.annotation})){
        const delta=Math.max(...a.flatMap((row,i)=>row.map((v,j)=>Math.abs(v-rest[key][i][j]))));
        assert.ok(delta<.08,`handoff jumped ${key}: ${delta}px`);
      }
      await page.locator('#paper-guide').waitFor({state:'visible'});
      await page.reload();await waitReady();await page.locator(opening).waitFor();
      if(phone)await page.touchscreen.tap(width/2,height/2);else await page.mouse.click(width/2,height/2);
      assert.equal(await page.locator(opening).count(),0);
      assert.equal(await page.locator(ready).getAttribute('data-spread'),String(saved.spread));
      assert.equal(await page.locator('.paper-ink-mark--saved').count(),2);
      assert.equal(await page.locator('.text-selection-toolbar,.paper-ink-mark--focus').count(),0);
      if(!phone){
        await page.reload();await waitReady();await page.locator(opening).waitFor();
        await page.setViewportSize({width:900,height});
        await page.locator(opening).waitFor({state:'detached'});
        await page.locator('#stage').focus();await page.keyboard.press('ArrowRight');
        await page.waitForFunction(n=>+document.getElementById('stage').dataset.spread===n,saved.spread+2);
        await page.locator('.edge-index__group:not([hidden])').first().click();
        await page.locator('.edge-chapters:not([hidden])').waitFor({state:'visible'});
      }
      assert.deepEqual(errors,[]);
      await page.close();
      console.log(`PASS ${width}px: live ink and page annotations, exact final camera, skip and reduced motion`);
    }
    if(!offline){
      const page=await browser.newPage();
      await page.route('**/binding-goatskin.webp?*',r=>r.abort());
      await page.goto(url);
      await page.locator(opening).waitFor({state:'attached'});
      assert.equal(await page.locator('html').evaluate(root=>root.style.getPropertyValue('--v25-binding-grain')),'');
      assert.match(await page.locator('.v25-binding-title').evaluate(n=>getComputedStyle(n).backgroundColor),/^rgb\(/);
      await page.locator(opening).waitFor({state:'detached'});
      await page.locator(ready).waitFor();
      await page.close();
      console.log('PASS the reader opens normally if the texture request fails');
    }
  }finally{await browser?.close();server?.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
