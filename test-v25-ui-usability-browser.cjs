'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:37166',entry=process.argv[2],shots=process.env.V25_UX_SCREENSHOTS;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const url=new URL(entry||origin);url.searchParams.set('ref','GEN.1:1');

(async()=>{
  if(shots)await fs.mkdir(shots,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const {width,height,touch=false} of [{width:1280,height:840},{width:390,height:844,touch:true},
      {width:320,height:700,touch:true},{width:844,height:390,touch:true},{width:1024,height:768,touch:true}]){
      const shortTouch=touch&&width>=640&&height<=540,compact=width<640||shortTouch;
      const ctx=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:'reduce'});
      try{
        if(touch&&compact)await ctx.addInitScript(()=>{
          const native=window.visualViewport,vv=new EventTarget();let keyboardHeight=0;
          for(const key of ['width','scale','offsetLeft','offsetTop','pageLeft','pageTop'])
            Object.defineProperty(vv,key,{get:()=>native[key]});
          Object.defineProperty(vv,'height',{get:()=>keyboardHeight||native.height});
          Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});
          window.setTestKeyboard=height=>{keyboardHeight=height;vv.dispatchEvent(new Event('resize'));};
        });
        if(!entry)await ctx.route('**/*',async route=>{
          const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
          const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
          if(!file.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        const page=await ctx.newPage(),errors=[];page.on('pageerror',err=>errors.push(err.message));
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        const $=selector=>page.locator(selector),activate=button=>touch?button.tap():button.click(),
          camera=()=>$('#stage').evaluate(node=>['spread','x','y','scale'].map(k=>node.dataset[k])),
          shot=async name=>{if(shots)await page.screenshot({path:path.join(shots,width+'-'+name+'.png')});};
        const guide=$('#paper-guide'),shelf=$('#reading-history'),settings=$('#study-settings'),
          finder=$('#verse-finder'),input=$('#vf-input'),scopes=$('#vf-scopes'),assist=$('#vf-assist'),
          submit=finder.getByRole('button',{name:'搜关键词',exact:true}),widen=finder.getByRole('button',{name:'扩到全书',exact:true});
        const reveal=async()=>{await page.evaluate(()=>PaperImmersion.showChrome());await shelf.waitFor();};
        const next=guide.getByRole('button',{name:'下一步',exact:true});
        await guide.waitFor();await activate(next);
        assert.match(await guide.locator('.pg-body').textContent(),/「定位」找经文.*「目录」选书卷.*「历史」找回/);
        await activate(next);
        assert.match(await guide.locator('.pg-body').textContent(),/朱红字.*「在主书查看」/);
        await activate(guide.getByRole('button',{name:'跳过',exact:true}));
        const pose=await camera();
        assert.ok(!await shelf.isVisible(),'labels must not make the shelf permanently visible');
        await reveal();
        const rail=await shelf.evaluate(host=>{
          const track=host.querySelector('.rh-track'),box=host.getBoundingClientRect();
          const buttons=[...host.querySelectorAll('.rh-toggle,.pcz-button')];
          return {historyWidth:track.getBoundingClientRect().width,scrolls:getComputedStyle(track).overflowX==='auto',
            tools:buttons.map(el=>{
              const r=el.getBoundingClientRect();
              const label=[...el.querySelectorAll('.rh-tool-label')].filter(n=>n.getClientRects().length).map(n=>n.textContent).join('');
              return {label,width:r.width,height:r.height,
                contained:r.left>=box.left&&r.right<=box.right&&r.top>=box.top&&r.bottom<=box.bottom,
                hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
            })};
        });
        assert.deepEqual(rail.tools.map(t=>t.label),['定位','目录','比例','历史','设置','全屏']);
        assert.ok(rail.tools.every(t=>t.width>=32&&t.height>=40&&t.contained&&t.hit),JSON.stringify(rail));
        assert.ok(rail.scrolls&&rail.historyWidth>=72,'still room to see and scroll the recent-reading chips');
        assert.deepEqual(await camera(),pose,'the larger controls are still an overlay');
        await shot('toolbar');
        await shelf.getByRole('button',{name:'定位搜索框',exact:true}).focus();
        await page.keyboard.press('Tab');
        assert.ok(await shelf.getByRole('button',{name:'目录',exact:true}).evaluate(el=>document.activeElement===el),
          'the shortcut and the directory are also adjacent in keyboard order');

        await activate(shelf.getByRole('button',{name:'阅读设置'}));
        await settings.waitFor();
        await activate(settings.getByRole('button',{name:'重看阅读指引',exact:true}));
        await guide.waitFor();assert.equal(await $('html').getAttribute('data-guide-step'),'turn');
        assert.equal(await settings.isVisible(),false);
        assert.deepEqual(await camera(),pose,'replaying the guide does not navigate');
        await activate(guide.getByRole('button',{name:'跳过',exact:true}));

        await reveal();await activate(shelf.getByRole('button',{name:'定位搜索框',exact:true}));
        await input.waitFor();await assist.waitFor();assert.match(await assist.textContent(),/约3:16/);
        assert.ok(!await submit.isVisible()&&!await scopes.isVisible());
        assert.equal(await finder.getAttribute('data-layout'),compact?'narrow':'wide');
        const field=await input.evaluate(el=>{
          const r=el.getBoundingClientRect();
          return {width:r.width,height:r.height,text:parseFloat(getComputedStyle(el).fontSize)*r.height/el.offsetHeight};
        });
        if(compact){
          assert.ok(field.height>=32&&field.width>=85&&field.text>=13.9,JSON.stringify(field));
        }
        await shot('finder-hint');
        if(touch&&compact){
          const visibleHeight=shortTouch?180:Math.floor(height*.61),
            fieldTop=()=>input.evaluate(el=>el.getBoundingClientRect().top);
          await page.evaluate(h=>window.setTestKeyboard(h),visibleHeight);
          await input.fill('创316');
          const guess=finder.getByRole('button',{name:'定位到 创世记 3:16',exact:true});
          await guess.waitFor();const before=await fieldTop();
          assert.ok(await finder.evaluate((el,h)=>{
            const r=el.getBoundingClientRect(),b=el.querySelector('.vf-address-candidate'),t=b.getBoundingClientRect(),
              x=t.x+t.width/2,y=t.y+t.height/2;
            return r.top>=0&&r.bottom<=h&&t.height>=44&&b.contains(document.elementFromPoint(x,y));
          },visibleHeight),'candidates and their real touch area stay above the simulated keyboard');
          await shot('finder-address-candidates');
          await input.fill('创3 16 17');
          await finder.getByRole('button',{name:'打开经文：创世记 3:16',exact:true}).waitFor();
          assert.equal(await fieldTop(),before,'candidate count must not shift the input while the keyboard is open');
          await shot('finder-address-context');
          await input.fill('创316');await activate(guess);
          assert.ok(!await input.evaluate(el=>el===document.activeElement),'an explicit address choice releases editing focus');
          await page.evaluate(()=>window.setTestKeyboard(0));
          await finder.getByRole('button',{name:'打开经文：创世记 3:16',exact:true}).waitFor();
          assert.ok(!await page.getByRole('complementary',{name:'搜索结果经文浮窗'}).isVisible());
          assert.deepEqual(await camera(),pose,'address choice does not move the main book');
          await input.focus();
        }
        if(shortTouch){
          await page.evaluate(()=>window.setTestKeyboard(180));
          await input.fill('创造');await submit.waitFor();
          const inset=await input.evaluate(el=>{
            const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
            return {top:r.top,bottom:r.bottom,hit:document.elementFromPoint(x,y)===el};
          });
          assert.ok(inset.top>=0&&inset.bottom<=180&&inset.hit,JSON.stringify(inset));
          await input.press('Enter');await finder.locator('#vf-list button').first().waitFor();
          await page.evaluate(()=>window.setTestKeyboard(0));
        }
        await input.fill('约3:16');
        await finder.getByRole('button',{name:'打开经文：约翰福音 3:16',exact:true}).waitFor();
        assert.ok(!await assist.isVisible()&&!await scopes.isVisible(),'direct addresses still locate without searching');

        await input.fill('创造');
        await submit.waitFor();
        assert.equal(await scopes.isVisible(),false,'typing alone never submits a keyword search');
        await shot('finder-submit');
        await activate(submit);
        await scopes.waitFor();
        const hit=finder.locator('#vf-list button').first(),status=$('#vf-status');
        await hit.waitFor();assert.ok(!await assist.isVisible());
        await activate(scopes.getByRole('button',{name:'指定书卷',exact:true}));
        await activate(finder.getByRole('group',{name:'指定书卷'}).getByRole('button',{name:'犹大书',exact:true}));
        assert.equal(await status.textContent(),'未找到经文');await widen.waitFor();
        assert.equal(await input.inputValue(),'创造');
        await shot('finder-empty');
        await activate(widen);await hit.waitFor();
        assert.equal(await scopes.getByRole('button',{name:'全书',exact:true}).getAttribute('aria-pressed'),'true');
        assert.equal(await input.inputValue(),'创造');
        await input.fill('一二三四五六七八九十从未命中的词');await input.press('Enter');
        await assist.waitFor();assert.match(await assist.textContent(),/换个短词/);assert.ok(!await widen.isVisible());
        assert.ok(await input.evaluate(node=>node===document.activeElement),'a global miss keeps the reader ready to edit');
        assert.deepEqual(await camera(),pose,'search remains a preview until the reader deliberately navigates');
        assert.deepEqual(errors,[]);
        console.log(`PASS ${width}×${height}: labels, guide and search recovery; input ${field.height.toFixed(1)}px, effective input font ${field.text.toFixed(1)}px, history ${rail.historyWidth.toFixed(0)}px`);
      }finally{await ctx.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
