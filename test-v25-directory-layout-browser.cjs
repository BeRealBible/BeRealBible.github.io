'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {groups}=require('./v25/search.js');
const entry=process.argv[2],origin='http://127.0.0.1:37167',shots=process.env.V25_DIRECTORY_SCREENSHOTS;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const fixtures=[
  {width:1280,height:840,touch:false},{width:1024,height:768,touch:true},
  {width:390,height:844,touch:true},{width:320,height:690,touch:true},
  {width:844,height:390,touch:true},{width:320,height:460,touch:true,scroll:true}
];
const url=new URL(entry||origin);url.searchParams.set('ref','GEN.4:1');

(async()=>{
  if(shots)await fs.mkdir(shots,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE});
  try{
    for(const {width,height,touch,scroll=false} of fixtures){
      const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
      try{
        await context.addInitScript(()=>localStorage.setItem('paper:v25:first-guide:1','seen'));
        if(!entry)await context.route('**/*',async route=>{
          const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
          const file=path.resolve(__dirname,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
          if(!file.startsWith(__dirname+path.sep))return route.abort();
          try{await route.fulfill({status:200,contentType:mime[path.extname(file)],body:await fs.readFile(file)});}
          catch{await route.fulfill({status:404,body:'Not found'});}
        });
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
        await page.waitForSelector('html[data-rule-layout=ready]',{state:'attached',timeout:90000});
        const state=()=>page.evaluate(()=>{
          const d=document.getElementById('stage').dataset;
          return {camera:[d.spread,d.book,d.x,d.y,d.scale],history:PAPER_READER_STORAGE.getItem('paper-bible-v25-compare-trails-v1')};
        });
        const before=await state(),activate=el=>touch?el.tap():el.click(),dialog=page.locator('#v25-book-directory'),
          content=dialog.locator('.v25-book-directory__scroll');
        await page.evaluate(()=>PaperImmersion.showChrome());
        await activate(page.getByRole('button',{name:'目录',exact:true}));
        await dialog.waitFor();
        assert.deepEqual(await state(),before,'merely opening the directory does not move or bookmark a page');
        const metric=await dialog.evaluate(el=>{
          const content=el.querySelector('.v25-book-directory__scroll'),sc=content.getBoundingClientRect(),
            grid=content.querySelector('#v25-book-directory-groups'),
            book=[...el.querySelectorAll('button[data-book]')],rect=el.getBoundingClientRect();
          const canHit=n=>{
            const p=n.getBoundingClientRect(),cx=p.x+p.width/2,cy=p.y+p.height/2;
            return p.top>=sc.top-.7&&p.bottom<=sc.bottom+.7&&p.left>=sc.left-.7&&p.right<=sc.right+.7&&
              n.contains(document.elementFromPoint(cx,cy));
          };
          const cells=book.map(b=>b.getBoundingClientRect()),rows=[...new Set(cells.map(r=>r.top))];
          const name=b=>el.querySelector('[data-book="'+b+'"] .v25-book-directory__name');
          const groupInfo=[...el.querySelectorAll('section[aria-label]')].map(n=>{
            const tag=n.querySelector('.v25-book-directory__label');
            return {name:n.getAttribute('aria-label'),tag:tag?.textContent,
              wash:getComputedStyle(n).getPropertyValue('--dir-wash').trim(),
              linked:!!tag&&[...n.querySelectorAll('button[data-book]')].every(b=>b.getAttribute('aria-describedby')===tag.id)};
          });
          return {size:[Math.round(rect.width),Math.round(rect.height)],
            content:[content.clientWidth,content.scrollWidth,content.clientHeight,content.scrollHeight],
            books:book.length,visible:book.filter(canHit).length,
            minW:Math.min(...cells.map(r=>r.width)),minH:Math.min(...cells.map(r=>r.height)),
            rowCounts:rows.map(y=>cells.filter(r=>r.top===y).length),
            packed:cells.every((r,i)=>i===0||cells[i-1].top!==r.top||Math.abs(cells[i-1].right-r.left)<.5),
            columns:Number(getComputedStyle(grid).getPropertyValue('--dir-columns')),
            categoryLabels:groupInfo,namesRatio:name('1KI').getBoundingClientRect().width/name('GEN').getBoundingClientRect().width,
            groups:[...el.querySelectorAll('section[aria-label]')].map(n=>[n.getAttribute('aria-label'),
              [...n.querySelectorAll('button[data-book]')].map(b=>b.dataset.book).join(' ')]),
            fullWords:book.every(b=>{
              const tag=b.querySelector('.v25-book-directory__label'),g=b.querySelector('.v25-book-directory__name');
              const r=g.getBoundingClientRect(),cell=b.getBoundingClientRect();
              return r.left>=cell.left&&r.right<=cell.right&&r.bottom<=cell.bottom&&b.getAttribute('aria-label')&&
                (!tag||(tag.scrollWidth<=tag.clientWidth+1&&tag.getBoundingClientRect().bottom<=r.top+.5));
            }),
            current:[...el.querySelectorAll('[aria-current=true]')].map(n=>n.dataset.book)};
        });
        assert.equal(metric.books,66);
        assert.equal(await dialog.locator('#v25-directory-current').textContent(),'创世记');
        assert.deepEqual(metric.groups,Object.entries(groups),'the printed order and all search categories match');
        assert.deepEqual(metric.current,['GEN'],'mark only the chapter’s current book');
        assert.ok(metric.fullWords&&metric.content[1]<=metric.content[0]+1,JSON.stringify(metric));
        assert.ok(metric.minW>=44&&metric.minH>=39,JSON.stringify(metric));
        assert.ok(metric.namesRatio>=1.30&&metric.namesRatio<=1.52,'two-character label ratio '+metric.namesRatio);
        assert.equal(metric.columns,width>=660?11:6);
        assert.deepEqual(metric.rowCounts,Array(66/metric.columns).fill(metric.columns));
        assert.ok(metric.packed,'neighboring cells touch with no unused track');
        assert.ok(metric.categoryLabels.every(g=>g.name===g.tag&&g.linked));
        assert.equal(new Set(metric.categoryLabels.map(g=>g.wash)).size,11);
        if(scroll){
          assert.ok(metric.visible<66&&metric.content[3]>metric.content[2],'short viewport only uses normal vertical scrolling');
          await content.evaluate(el=>el.scrollTop=el.scrollHeight);
          const last=dialog.locator('[data-book="REV"]');
          assert.ok(await last.evaluate(el=>{
            const p=el.getBoundingClientRect();return document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)===el;
          }),'the last book is actually reachable at the end of the short page');
          await content.evaluate(el=>el.scrollTop=0);
        }else{
          assert.equal(metric.visible,66,JSON.stringify(metric));
          assert.ok(metric.content[3]<=metric.content[2]+1,'the entire index fits without scrolling');
        }
        if(shots)await page.screenshot({path:path.join(shots,`directory-${width}x${height}.png`)});
        if(!touch){
          await dialog.locator('[data-book="GEN"]').focus();
          await page.keyboard.press('ArrowDown');
          assert.ok(await dialog.locator('[data-book="2KI"]').evaluate(el=>el===document.activeElement),'move one visible row down');
          await page.emulateMedia({forcedColors:'active'});
          const rule=code=>dialog.locator('[data-book="'+code+'"]').evaluate(el=>getComputedStyle(el,'::before').borderLeftColor);
          assert.notEqual(await rule('JOS'),await rule('DEU'),'category boundaries survive without colored backgrounds');
          await page.emulateMedia({forcedColors:'none'});
        }
        if(touch)await activate(dialog.getByRole('button',{name:'关闭目录',exact:true}));
        else await page.keyboard.press('Escape');
        await dialog.waitFor({state:'hidden'});assert.deepEqual(await state(),before);
        if(width===320&&!scroll){
          // The small suffix is typography; each name must still target the
          // intended member of the shared printed bookmark.
          const sheet=page.locator('.edge-chapters:not([hidden])');
          for(const [code,name] of [['1KI','列王纪上'],['2KI','列王纪下']]){
            await page.evaluate(()=>PaperImmersion.showChrome());
            await activate(page.getByRole('button',{name:'目录',exact:true}));
            await activate(dialog.getByRole('button',{name,exact:true}));
            await sheet.waitFor();
            assert.equal(await sheet.locator('.edge-chapters__title').textContent(),name);
            assert.equal(await sheet.locator('.edge-chapters__book[aria-pressed=true]').evaluate(el=>V25OriginalData.books[el.dataset.book].code),code);
            const after=await state();
            assert.deepEqual(after.camera.slice(0,2),before.camera.slice(0,2));
            assert.equal(after.history,before.history,'choosing a book only opens its chapter sheet');
            await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
          }
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS ${width}×${height}: ${metric.columns}×${66/metric.columns}, ${metric.visible}/66 above fold, panel ${metric.size.join('×')}, content ${metric.content[3]}px, smallest target ${metric.minW.toFixed(1)}×${metric.minH.toFixed(1)}px, suffix ratio ${metric.namesRatio.toFixed(2)}`);
      }finally{await context.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
