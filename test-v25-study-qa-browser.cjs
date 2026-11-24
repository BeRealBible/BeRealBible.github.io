'use strict';
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const file=process.env.PREVIEW_FILE,base=process.argv[2],localOrigin='http://127.0.0.1:37129';
const url=new URL(file?pathToFileURL(path.resolve(file)):base||localOrigin);
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp'};
url.searchParams.set('v','index-25');url.searchParams.set('ref','2SA.3:1');url.searchParams.set('curl','off');
const takeURL=url.href;
async function run(browser,width){
  const mobile=width<550,ctx=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,
    reducedMotion:'reduce',offline:!!file});
  try{
    if(!file&&!base)await ctx.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!==localOrigin)return route.abort();
      const f=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
      if(!f.startsWith(__dirname+path.sep))return route.abort();
      try{await route.fulfill({status:200,body:await fs.readFile(f),contentType:mime[path.extname(f)]});}
      catch{await route.fulfill({status:404,body:'Not found'});}
    });
    const page=await ctx.newPage(),errors=[],requests=[];
    const cdp=mobile?await ctx.newCDPSession(page):null;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes('/study-qa.json?'))requests.push(r.url());});
    await page.addInitScript(()=>{try{localStorage.setItem('paper:v25:first-guide:1','seen');}catch{}});
    const $=sel=>page.locator(sel),mainBar=$('#stage .paper-selection-tools'),root=$('html'),dialog=$('.compare-slip[data-kind=study]:not([hidden])');
    const chapter=n=>$('#stage .paper text[data-role="chapter"][data-ref="'+n+':1"]').first();
    const caption=ref=>$('#stage .paper text[data-role="heading"][data-ref="'+ref+'"]');
    const paperCue=(kind,ref)=>$('#stage .paper svg line[data-qap-cue="'+kind+'"][data-qap-ref="'+ref+'"]').first();
    const shown=cue=>cue.evaluateAll(lines=>lines.some(n=>getComputedStyle(n.parentElement).display!=='none'));
    const body=(ref)=>$('#stage .paper text[data-role="body"][data-ref="'+ref+'"]');
    const ready=()=>root.and($('html[data-rule-layout=ready]')).waitFor({state:'attached',timeout:90000});
    async function point(locator){
      return locator.evaluateAll(nodes=>{
        for(const el of nodes){
          const r=el.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
          if(r.width>1&&r.height>1&&el.contains(document.elementFromPoint(x,y)))return {x,y};
        }
        throw Error('No uncovered target ink at desired reference');
      });
    }
    async function press(locator,long=false){
      const p=await point(locator);
      if(mobile){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
        if(long)await page.waitForTimeout(510);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }else{
        await page.mouse.move(p.x,p.y);await page.mouse.down();
        if(long)await page.waitForTimeout(510);
        await page.mouse.up();
      }
    }
    const rendered=()=>dialog.locator('.study-qa__list details').first().waitFor({timeout:15000});
    const ids=()=>dialog.locator('details').evaluateAll(nodes=>nodes.map(n=>n.dataset.qap));
    const open=async(bar=mainBar)=>{await bar.locator('[data-study]').click();await dialog.waitFor();await rendered();};
    const close=async()=>{await dialog.getByRole('button',{name:/^关闭(?:问答|资料)浮窗$/}).click();await dialog.waitFor({state:'hidden'});};
    const settings=$('#study-settings');
    const citation=$('#v25-scripture-preview:not([hidden])'),owned=$('.compare-slip[data-role=fixed]:not([hidden])');
    const expanded=$('.compare-slip:not([hidden]):not([data-collapsed])'),dock=$('#v25-compare-tabs');
    const title=dialog.locator('.compare-slip__title'),qapScroll=dialog.locator('.compare-slip__scroll');
    const bodyOf=(id)=>dialog.locator('[data-qap="'+id+'"]');
    const verseTag=(id)=>citation.locator('[data-verse-id="'+id+'"]');
    async function configure(enabled){
      await page.evaluate(()=>PaperImmersion.showChrome());
      await page.getByRole('button',{name:'阅读设置',exact:true}).click();
      await settings.waitFor();
      const toggle=settings.getByRole('switch');
      if(await toggle.isChecked()!==enabled)await toggle.click();
      await settings.getByRole('button',{name:'关闭阅读设置'}).click();
      await page.evaluate(()=>PaperImmersion.hideChrome());
    }
    const chapterCue=paperCue('chapter','3:1');
    await page.goto(takeURL,{waitUntil:'domcontentloaded',timeout:90000});await ready();
    await page.evaluate(()=>document.getElementById('fit-book').click());
    await page.waitForTimeout(250);
    assert.equal(requests.length,0,'normal reading should not download QAPs');
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.ok(await shown(chapterCue),'a fresh browser shows QAP cues by default');
    assert.equal(await chapter(3).evaluate(el=>getComputedStyle(el).textDecorationLine),'none','paper numbers do not use text underlining');

    await press(body('4:1'),true);
    await mainBar.waitFor({timeout:5000});
    const studyTool=mainBar.getByRole('button',{name:/^(经文问答|查看资料)$/});
    assert.ok(await studyTool.isDisabled(),'no QAP at this verse, even though its chapter has QAPs');
    assert.ok(await mainBar.locator('[data-copy]').isEnabled());
    await studyTool.evaluate(b=>b.click()); // Native disabled activation is a no-op.
    assert.equal(await dialog.count(),0);
    await press(body('3:1'));
    assert.ok(await studyTool.isEnabled(),'one related object enables a mixed selection');
    await press(body('3:1'));
    assert.ok(await studyTool.isDisabled(),'removing the only associated object disables again');
    await mainBar.locator('[data-exit]').click();
    assert.equal(requests.length,0,'the button state never downloads QAP text');

    await press(body('3:1'),true);
    await mainBar.waitFor({timeout:5000});
    await open();
    assert.ok((await ids()).includes('2SA.3.1'));
    assert.ok(!(await ids()).includes('2SA.3.4'),'verse selection cannot broaden into a chapter');
    assert.match(await title.textContent(),/(思考问答|经文资料) 撒下 3:1/);
    assert.equal(await dialog.locator('.compare-slip__scroll h2,.study-qa__refs,#study-qa-scopes').count(),0,'no decorative labels or address lists in QAP content');
    assert.equal(await dialog.locator('.study-qa__status').textContent(),'');
    assert.equal(await dialog.locator('details[open]').count(),0);
    // A link in a folded question opens a reader, not its <details>.
    const first=bodyOf('2SA.3.1'),firstRef=first.getByRole('button',{name:/查看经文.*撒母耳记下3章1节/});
    await firstRef.click();await citation.waitFor();
    assert.equal(await first.getAttribute('open'),null);
    assert.equal(await verseTag('2SA.3:1').getAttribute('data-cited'),'');
    const previewText=citation.locator('.compare-slip__scroll');
    await previewText.press('Shift+Space');
    assert.equal(await verseTag('2SA.3:1').getAttribute('data-selected-verse'),'');
    assert.ok(await citation.locator('.paper-selection-tools [data-study]').isEnabled());
    await previewText.press('Escape');
    assert.ok(await citation.isVisible()&&await dialog.isVisible(),'leaving the selection keeps both the preview and QAP open');
    await page.keyboard.press('Escape');await citation.waitFor({state:'hidden'});
    assert.ok(await dialog.isVisible());
    assert.equal(await firstRef.getAttribute('aria-expanded'),'false');
    const second=bodyOf('2SA.3.2');
    for(const row of [first,second])await row.locator('summary').click({position:{x:13,y:19}});
    assert.equal(await dialog.locator('details[open]').count(),2);
    await dialog.locator('.study-qa__answer:visible').nth(1).waitFor();
    assert.equal(await dialog.locator('.study-qa__answer:visible').count(),2);
    // A link found in an answer can open a different book without jumping
    // the desk, replacing the QAP, or closing the answered question.
    const stand=await $('#stage').getAttribute('data-spread');
    const short=second.getByRole('button',{name:/查看经文.*申命记.*17:17/}).or(second.getByRole('button',{name:/查看经文.*申17:17/}));
    await short.first().click();await citation.waitFor();
    assert.equal(await verseTag('DEU.17:17').getAttribute('data-cited'),'');
    assert.equal(await $('#stage').getAttribute('data-spread'),stand);
    const offset=await qapScroll.evaluate(el=>el.scrollTop);
    await citation.getByRole('button',{name:'固定经文浮窗'}).click();
    await citation.waitFor({state:'hidden'});
    const pinned=$('.compare-slip[data-citation="DEU.17:17"]:not([hidden])');
    await pinned.waitFor();
    assert.ok(await dialog.isVisible());
    assert.notEqual(await second.getAttribute('open'),null);
    assert.equal(await qapScroll.evaluate(el=>el.scrollTop),offset,'pinning does not redraw or scroll QAP');
    assert.equal(await owned.count(),2,'QAP and pinned scripture share the same registry');
    await dialog.getByRole('button',{name:/^收起(?:问答|资料)浮窗$/}).click();
    assert.equal(await dialog.getAttribute('data-collapsed'),'');
    assert.equal(await dock.locator('[data-kind=study]:not([hidden])').count(),1);
    assert.ok(await pinned.isVisible());
    await title.click();
    assert.equal(await dialog.getAttribute('data-collapsed'),null);
    assert.notEqual(await second.getAttribute('open'),null);
    assert.equal(await qapScroll.evaluate(el=>el.scrollTop),offset,'restoring a paper tab preserves position');
    await close();
    await pinned.getByRole('button',{name:'关闭经文浮窗'}).click();
    assert.equal(requests.length,file?0:1);

    await press(body('3:1'),true);
    await press(body('4:1'));
    await open();
    assert.ok((await ids()).includes('2SA.3.1'));
    assert.equal(await dialog.locator('#study-qa-position').count(),0);
    await close();

    await press(chapter(3),true);
    assert.ok(await mainBar.locator('[data-copy]').isDisabled(),'chapter number should not copy the first verse');
    const selectedChapterCount=await $('#stage .paper-ink-mark--selected').count();
    await press(caption('4:1'));
    assert.equal(await $('#stage .paper-ink-mark--selected').count(),selectedChapterCount,'tapping a section caption does not add a second chapter');
    await press(chapter(4));
    await open();
    const multi=await ids();assert.equal(new Set(multi).size,multi.length);
    assert.match(await title.textContent(),/(思考问答|经文资料) 撒下 3–4章/);
    assert.ok(multi.some(id=>id.startsWith('2SA.3.'))&&multi.some(id=>id.startsWith('2SA.4.')));
    const fromAnswer=bodyOf('2SA.3.4');
    await fromAnswer.locator('summary').click({position:{x:13,y:19}});
    await fromAnswer.getByRole('button',{name:/查看经文.*申21章/}).click();
    await citation.waitFor();
    assert.equal(await citation.locator('[data-cited]').count(),0,'chapter-only link does not cite verse 1');
    assert.ok(await verseTag('DEU.21:1').count());
    await citation.getByRole('button',{name:'关闭经文浮窗'}).click();
    await citation.waitFor({state:'hidden'});
    if(process.env.QAP_SCREENSHOTS){
      await dialog.locator('summary').first().click();
      await dialog.screenshot({path:path.join(process.env.QAP_SCREENSHOTS,'study-qa-'+width+'.png')});
    }
    await close();

    await configure(true);
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.ok(await shown(chapterCue));
    const stroke=await chapterCue.evaluate(el=>[getComputedStyle(el).stroke,parseFloat(getComputedStyle(el).strokeWidth),Number(el.closest('#stage').dataset.scale)]);
    assert.match(stroke[0],/^rgba\(160, 128, 79, 0\.(?:388|39)/);
    assert.ok(stroke[1]<=1.201&&stroke[1]*stroke[2]<=.901,'the pale cue remains a fine stroke in paper and screen coordinates');
    assert.ok(await $('#stage .paper text[data-qap-mark="verse"]').count()>0);
    const requestedBeforeReload=requests.length;
    await page.reload({waitUntil:'domcontentloaded'});await ready();
    await page.waitForSelector('html[data-study-marks] .paper [data-qap-mark="chapter"]',{state:'attached'});
    assert.ok(await shown(chapterCue),'mark setting survives reload');
    assert.equal(requests.length,requestedBeforeReload,'marking also uses the lightweight location index');
    await configure(false);
    assert.ok(!(await shown(chapterCue)));
    await page.reload({waitUntil:'domcontentloaded'});await ready();
    assert.ok(!(await shown(chapterCue)),'an explicit opt-out survives returning to the reader');
    await page.evaluate(()=>document.getElementById('fit-book').click());
    await page.waitForTimeout(250);
    await press(chapter(3),true);
    await open();assert.ok((await ids()).includes('2SA.3.4'));
    await close();

    assert.ok(await page.evaluate(()=>V25ScriptureWindows.open({code:'OBA',ref:'1:1'})));
    const noQA=$('.compare-slip[data-citation="OBA.1:1"]:not([hidden])');
    await noQA.locator('.compare-slip__scroll').press('Shift+Space');
    assert.ok(await noQA.locator('[data-study]').isDisabled(),'unassociated verse in a scripture window');
    assert.ok(await noQA.locator('[data-copy]').isEnabled());
    await page.keyboard.press('Escape');
    await noQA.locator('[data-study-chapter="OBA.1"]').press('Enter');
    assert.ok(await noQA.locator('[data-study]').isDisabled(),'unassociated chapter title in a scripture window');
    await noQA.getByRole('button',{name:'关闭经文浮窗'}).click();
    await configure(true);
    assert.ok(await page.evaluate(()=>V25ScriptureWindows.open({code:'2SA',ref:'3:1'})));
    const win=$('.compare-slip[data-citation="2SA.3:1"]:not([hidden])');
    const heading=win.locator('[data-study-chapter="2SA.3"]');
    await heading.waitFor();
    await heading.scrollIntoViewIfNeeded();
    // Chapter buffering can settle a scroll on the frame after the locator.
    await page.waitForTimeout(140);
    await press(heading,true);
    assert.equal(await heading.getAttribute('data-qap-mark'),'chapter');
    const selectedChapterStyle=await heading.evaluate(el=>{const css=getComputedStyle(el);return [css.color,css.textDecorationStyle,css.textDecorationLine];});
    assert.deepEqual(selectedChapterStyle,['rgb(131, 55, 45)','solid','underline'],'selection applies warm ink without replacing the independent QAP cue');
    await open(win.locator('.paper-selection-tools'));
    assert.ok((await ids()).includes('2SA.3.4'));
    assert.ok(await win.isVisible(),'opening a QAP does not dismiss its source scripture');
    const managerOpen=(code,ref)=>page.evaluate(({code,ref})=>V25ScriptureWindows.open({code,ref}),{code,ref});
    for(const [code,ref] of [['GEN','1:1'],['EXO','2:2'],['ROM','8:1']])assert.ok(await managerOpen(code,ref));
    assert.equal(await owned.count(),5);
    assert.equal(await expanded.count(),3);
    assert.equal(await dock.locator('.compare-slip:not([hidden])').count(),2);
    const firstId=await dialog.getAttribute('id'),questionCount=(await ids()).length;
    await title.click(); // restore the QAP if it was auto-minimized
    const beforeLimit=await ids();
    assert.equal(questionCount,beforeLimit.length);
    assert.equal(await managerOpen('MAT','5:1'),false,'a sixth window cannot evict or replace any QAP/reader');
    assert.equal(await owned.count(),5);
    assert.equal(await dialog.getAttribute('id'),firstId);
    assert.match(await $('#v25-compare-limit').textContent(),/已有 5 个浮窗/);
    // A preview borrows expanded space but not one of the five slots.
    const known=bodyOf('2SA.3.4');
    await known.locator('summary').click({position:{x:13,y:19}});
    await known.getByRole('button',{name:/查看经文.*申21章/}).click();
    await citation.waitFor();
    assert.equal(await owned.count(),5);
    assert.equal(await expanded.count(),3);
    await citation.getByRole('button',{name:'固定经文浮窗'}).click();
    assert.ok(await citation.isVisible(),'failed sixth pin leaves the reference preview open');
    assert.equal(await dialog.getAttribute('data-collapsed'),null,'the originating QAP stays expanded while quoting');
    assert.notEqual(await known.getAttribute('open'),null);
    await citation.getByRole('button',{name:'关闭经文浮窗'}).click();
    assert.equal(await owned.count(),5);
    await close();
    assert.equal(await owned.count(),4);

    async function readAt(reference){
      const pilot=new URL(takeURL);
      pilot.searchParams.set('ref',reference);
      await page.goto(pilot.href,{waitUntil:'domcontentloaded',timeout:90000});
      await ready();
      // Keep the deep link's readable zoom on phones so touches hit ink.
      if(!mobile)await page.evaluate(()=>document.getElementById('fit-book').click());
      await page.waitForTimeout(250);
    }
    await readAt('1KI.7:16');
    await configure(true);
    assert.equal(await $('#stage .paper text[data-ref="7:16"][data-qap-mark="verse"]').count(),0);
    await press(body('7:16'),true);
    await mainBar.waitFor({timeout:5000});
    assert.ok(await studyTool.isDisabled(),'a later verse in a compressed range has no anchor');
    await mainBar.locator('[data-exit]').click();

    await readAt('1KI.7:15');
    await $('#stage .paper text[data-ref="7:15"][data-qap-mark="verse"]').first().waitFor({state:'attached'});
    await press(body('7:15'),true);
    await open();
    const pillars=bodyOf('1KI.7.2');
    await pillars.getByRole('button',{name:/查看经文.*7:15-22/}).click();
    await citation.waitFor();
    assert.equal(await verseTag('1KI.7:22').getAttribute('data-cited'),'','inline citations still show the whole range');
    await citation.getByRole('button',{name:'关闭经文浮窗'}).click();
    await close();

    await readAt('1KI.10:1');
    assert.equal(await chapter(10).getAttribute('data-qap-mark'),'chapter');
    await press(chapter(10),true);
    await open();
    assert.ok((await ids()).includes('1KI.10.6'),'chapter-only QAP is reachable from the chapter title');
    await close();

    await readAt('GEN.4:1');
    const cainAndAbel=caption('4:1');
    assert.match((await cainAndAbel.allTextContents()).join(''),/该隐和亚伯/);
    await chapter(4).and($('[data-qap-mark="chapter"]')).waitFor({state:'attached'});
    for(const [kind,ref] of [['chapter','4:1'],['verse','4:3']]){
      const cue=paperCue(kind,ref);await cue.waitFor({state:'attached'});assert.ok(await shown(cue));
      const placed=await cue.evaluate(el=>{
        const svg=el.ownerSVGElement,index=Number(svg.dataset.pdf),paper=V25OriginalData;
        const words=PaperPage.commands(paper.pages[index],index,paper.books),anchor=words[el.dataset.qapInk];
        const x1=+el.getAttribute('x1'),x2=+el.getAttribute('x2'),y=+el.getAttribute('y1');
        const text=svg.querySelector('text[data-physical-idx="'+el.dataset.qapInk+'"]');
        return {role:text.dataset.role,decoration:getComputedStyle(text).textDecorationLine,
          below:y-anchor.y-anchor.h,overlaps:words.some(w=>w!==anchor&&!w.hideHatch&&w.x<x2&&w.x+w.w>x1&&w.y<y&&w.y+w.h>y)};
      });
      assert.equal(placed.role,kind);assert.equal(placed.decoration,'none');
      assert.ok(placed.below>=.84&&placed.below<=1.66&&!placed.overlaps,JSON.stringify(placed));
    }
    const clean=()=>cainAndAbel.evaluateAll(all=>all.every(n=>!n.hasAttribute('data-qap-mark')&&getComputedStyle(n).textDecorationLine==='none'));
    assert.ok(await clean(),'the section heading has no cue even though the chapter has QAPs');
    await press(cainAndAbel);await press(cainAndAbel,true);
    assert.equal(await mainBar.count(),0);assert.equal(await dialog.count(),0);
    assert.equal(await $('#stage .paper text[data-paper-emphasis]').count(),0,'section headings do not enter tap or selection mode');
    await press(chapter(4),true);await open();
    assert.ok((await ids()).includes('GEN.4.1'),'chapter selection still returns a QAP attached to verses 4:3–5');
    assert.ok(await clean());await close();

    await readAt('GEN.33:1');
    const jacobCue=paperCue('chapter','33:1');await jacobCue.waitFor({state:'attached'});
    assert.ok(await shown(jacobCue),'the chapter QAP hint is independent of source horizontal ink');
    const sourceInk=await jacobCue.evaluate(n=>{
      const svg=n.ownerSVGElement,i=Number(svg.dataset.pdf),raw=V25OriginalData.get(i);
      return {exists:raw[4].some(r=>r.join(',')==='1020,1682,82,2'),
        drawn:!!svg.querySelector('rect[x="1020"][y="1682"][width="82"][height="2"]'),
        first:svg.querySelector('text[data-role="body"][data-ref="33:1"]')?.textContent};
    });
    assert.deepEqual(sourceInk,{exists:true,drawn:false,first:'雅'},'hide the raw Jacob rule without removing the source or moving verse text');

    assert.deepEqual(errors,[]);
    console.log(width,'PASS QAP windows, citations, scripture-only controls, and Genesis 4 section caption without marks');
  }finally{await ctx.close();}
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  try{for(const width of (process.env.QAP_WIDTHS||'1280,390').split(',').map(Number))await run(browser,width);}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
