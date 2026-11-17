'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('./edge-chapters.js');
const books=require('./paper-layout.js').paginate(require('./data/bible-source.js')).books;
const source=require('./data/bible-source.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
class Target {
  constructor(){this.events=new Map();}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
  removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
  dispatch(type,details={}){const event={stopped:false,prevented:false,immediate:false,...details,stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediate=true;this.stopped=true;},preventDefault(){this.prevented=true;}};for(const fn of this.events.get(type)||[]){fn(event);if(event.immediate)break;}return event;}
}
class Element extends Target {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.style={};}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key]??null;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  focus(){this.ownerDocument.activeElement=this;}
  click(){return this.dispatch('click',{target:this});}
  get isConnected(){return this.tagName==='BODY'||Boolean(this.parentNode?.isConnected);}
  getBoundingClientRect(){
    const width=parseFloat(this.style.width)||44,cell=parseFloat(this.style['--cell'])||44,columns=+this.style['--columns']||1,count=+this.dataset.count||1;
    const natural=this._height??(this.className==='edge-chapters__panel'?96+Math.ceil(count/columns)*(this.dataset.mode==='preview'?70:cell+2):44);
    const height=Math.min(natural,parseFloat(this.style.maxHeight)||natural),left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0;
    return {left,top,right:left+width,bottom:top+height,width,height};
  }
}
function walk(node){return [node,...node.children.flatMap(walk)];}
function find(f,name){return walk(f.menu.element).filter(node=>String(node.className||'').split(' ').includes(name));}
function setup(current={bookIndex:0,chapter:1},size={width:390,height:720},getPreview){
  const doc=new Target(),win=new Target();doc.defaultView=win;win.innerWidth=size.width;win.innerHeight=size.height;doc.createElement=tag=>new Element(tag,doc);
  doc.body=new Element('body',doc);const host=new Element('div',doc);doc.body.appendChild(host);const launcher=new Element('button',doc);doc.body.appendChild(launcher);launcher.focus();
  const selected=[],menu=C.create(host,{books,onSelect:page=>selected.push(page),getCurrent:()=>current,getPreview});
  return {doc,win,host,launcher,menu,selected};
}
const anchor={x:350,y:320,left:350,top:320,right:365,bottom:344,width:15,height:24};
function actualPreview(index,chapter){
  const book=source.books[index],record=book.chapters.find(entry=>entry.chapter===chapter),verse=record?.verses[0];
  return verse?{text:verse[1],reference:`${book.name} ${chapter}:${verse[0]}`,truncated:false}:null;
}
test('all 66 real books preserve all 1189 real chapter-to-page mappings',()=>{
  let count=0;
  books.forEach(book=>{const entries=C.chapterEntries(book);assert.deepEqual(entries,book.chapters);count+=entries.length;});assert.equal(count,1189);
});
test('opening a book never navigates, creates a body portal and highlights the actual current chapter',()=>{
  const f=setup({bookIndex:18,chapter:119});assert.equal(f.menu.isOpen(),false);
  f.menu.open({bookIndices:[18],index:18,anchor});assert.equal(f.menu.isOpen(),true);assert.equal(f.selected.length,0);assert.equal(f.menu.element.parentNode,f.doc.body);
  assert.equal(find(f,'edge-chapters__books')[0].hidden,true);assert.equal(find(f,'edge-chapters__chapter').length,150);
  const current=find(f,'edge-chapters__chapter').filter(button=>button.getAttribute('aria-current'));assert.equal(current.length,1);assert.equal(current[0].dataset.chapter,'119');assert.equal(f.doc.activeElement,current[0]);
  assert.equal(find(f,'edge-chapters__panel')[0].getAttribute('role'),'dialog');
  assert.equal(find(f,'edge-chapters__eyebrow')[0].textContent,'150 篇');assert.equal(find(f,'edge-chapters__subtitle')[0].hidden,true);
  assert.equal(find(f,'edge-chapters__close')[0].textContent,'收起');assert.equal(find(f,'edge-chapters__hint')[0].textContent,'点纸外收起');
});
test('adaptive menu sizes follow chapter counts and avoid stretching short books or overflowing viewports',()=>{
  for(const [count,width,columns] of [[1,180,1],[3,180,3],[4,180,4],[5,214,5],[6,250,6],[7,250,6],[30,250,6],[31,322,8],[70,322,8],[71,394,10],[150,394,10]]){
    assert.deepEqual(C.menuSize(count,'numbers',1000,900,1),{width,columns,maxHeight:360});
  }
  for(const [count,width,columns] of [[1,310,1],[3,310,1],[4,310,1],[8,310,1],[9,520,2],[150,520,2]]){
    assert.deepEqual(C.menuSize(count,'preview',1000,900,3),{width,columns,maxHeight:420});
  }
  assert.deepEqual(C.menuSize(150,'numbers',320,568,1),{width:264,columns:5,maxHeight:360});
  assert.deepEqual(C.menuSize(150,'numbers',390,720,1),{width:356,columns:7,maxHeight:360});
  assert.deepEqual(C.menuSize(1,'preview',390,720,1),{width:310,columns:1,maxHeight:420});
  assert.deepEqual(C.menuSize(150,'preview',320,360,1),{width:296,columns:1,maxHeight:336});
  assert.deepEqual(C.menuSize(150,'numbers',1000,900,1,{width:170,height:140}),{width:170,columns:3,maxHeight:140});
  assert.deepEqual(C.menuSize(150,'preview',1000,900,1,{width:455,height:500}),{width:310,columns:1,maxHeight:420});
  assert.deepEqual(C.menuSize(150,'preview',1000,900,1,{width:456,height:500}),{width:456,columns:2,maxHeight:420});
  for(const viewportWidth of [320,390,1000])for(const count of [1,3,5,22,50,150]){
    const size=C.menuSize(count,'numbers',viewportWidth,720),cell=viewportWidth<560?44:34;
    assert.ok(size.width-C.constants.PADDING-(size.columns*cell+(size.columns-1)*C.constants.NUMBER_GAP)>=C.constants.NUMBER_GUTTER,'number grid must reserve scrollbar width');
  }
  const f=setup();f.menu.open({bookIndices:[64],index:64,anchor});const panel=find(f,'edge-chapters__panel')[0];
  assert.equal(panel.style.width,'180px');assert.equal(panel.style.height,undefined);assert.equal(panel.style['--columns'],'1');assert.equal(panel.style['--cell'],'44px');
  for(const node of [panel,f.menu.element]){assert.equal(node.dataset.mode,'numbers');assert.equal(node.dataset.count,'1');assert.equal(node.dataset.size,'brief');}
  assert.equal(find(f,'edge-chapters__chapter').length,1);assert.equal(find(f,'number')[0].textContent,'1');
});
test('mode controls never navigate, remember the session choice across reopen and need no local storage',()=>{
  const calls=[],f=setup(undefined,{width:1000,height:900},(i,c)=>{calls.push([i,c]);return actualPreview(i,c);});
  assert.equal(f.menu.getMode(),'numbers');f.menu.open({bookIndices:[51,52],index:51,anchor});assert.equal(calls.length,0);
  const preview=find(f,'edge-chapters__mode').find(button=>button.dataset.mode==='preview');
  assert.equal(preview.tagName,'BUTTON');assert.equal(preview.type,'button');assert.equal(preview.getAttribute('aria-label'),'经文摘读');
  preview.click();assert.equal(f.menu.getMode(),'preview');assert.equal(f.selected.length,0);assert.equal(f.doc.activeElement,preview);
  assert.equal(preview.getAttribute('aria-pressed'),'true');assert.equal(find(f,'edge-chapters__panel')[0].style.width,'310px');assert.equal(find(f,'preview').length,5);
  f.menu.close();f.menu.open({bookIndices:[52],index:52,anchor});assert.equal(f.menu.getMode(),'preview');assert.equal(find(f,'preview').length,3);
  assert.equal(find(f,'edge-chapters__panel')[0].style.width,'310px');assert.equal(f.menu.setMode('numbers'),'numbers');assert.equal(find(f,'preview').length,0);assert.equal(f.selected.length,0);
  assert.throws(()=>f.menu.setMode('unknown'),TypeError);assert.throws(()=>C.menuSize(1,'unknown',390,720),TypeError);
  assert.doesNotMatch(fs.readFileSync(require.resolve('./edge-chapters.js'),'utf8'),/localStorage|sessionStorage/);
});
test('preview spans display only the injected actual verse and reference, with short accessible labels',()=>{
  const f=setup(undefined,{width:1000,height:900},actualPreview);f.menu.setMode('preview');
  for(const index of [0,18,39,65]){
    f.menu.open({bookIndices:[index],index,anchor});const chapters=find(f,'edge-chapters__chapter');
    for(const button of chapters){
      const chapter=+button.dataset.chapter,expected=actualPreview(index,chapter);
      assert.equal(button.children.find(node=>node.className.includes('edge-chapters__number')).textContent,String(chapter));
      assert.equal(button.children.find(node=>node.className.includes('edge-chapters__preview')).textContent,expected.text);
      assert.equal(button.children.find(node=>node.className.includes('edge-chapters__reference')).textContent,expected.reference);
      assert.equal(button.getAttribute('aria-label'),`${books[index].name} 第 ${chapter} 章`);assert.equal(button.dataset.truncated,'false');
    }
  }
  const markup='<strong>literal supplied text</strong>',safe=setup(undefined,undefined,()=>({text:markup,reference:'约翰福音 1:1',truncated:true}));
  safe.menu.setMode('preview');safe.menu.open({index:42});assert.equal(find(safe,'preview')[0].textContent,markup);assert.equal(find(safe,'preview')[0].children.length,0);assert.equal(find(safe,'edge-chapters__chapter')[0].dataset.truncated,'true');
});
test('missing or failed preview never fabricates scripture and keeps precise chapter navigation',()=>{
  for(const provider of [undefined,()=>null,()=>{throw Error('missing source');}]){
    const f=setup(undefined,undefined,provider);f.menu.setMode('preview');f.menu.open({index:64});
    assert.equal(find(f,'preview').length,0);assert.equal(find(f,'reference').length,0);const chapter=find(f,'edge-chapters__chapter')[0];assert.equal(chapter.dataset.preview,'unavailable');
    chapter.click();assert.deepEqual(f.selected,[books[64].chapters[0].page]);
  }
});
test('group selector contains only supplied side members and switches chapter grids without navigation',()=>{
  const f=setup();f.menu.open({bookIndices:[51,52],index:51,anchor});
  assert.equal(find(f,'edge-chapters__eyebrow')[0].textContent,'5 章');assert.equal(find(f,'edge-chapters__subtitle')[0].hidden,true);
  assert.deepEqual(find(f,'edge-chapters__book').map(button=>+button.dataset.book),[51,52]);assert.equal(find(f,'edge-chapters__chapter').length,5);
  find(f,'edge-chapters__book')[1].click();assert.equal(find(f,'edge-chapters__chapter').length,3);assert.equal(f.menu.element.dataset.book,'52');assert.equal(f.selected.length,0);
  assert.equal(find(f,'edge-chapters__title')[0].textContent,'帖撒罗尼迦后书');
  assert.equal(find(f,'edge-chapters__eyebrow')[0].textContent,'3 章');assert.equal(find(f,'edge-chapters__subtitle')[0].hidden,true);
});
test('both menu modes select every one of 1189 chapters by its exact real page and close before navigation',()=>{
  const f=setup(undefined,undefined,actualPreview);let count=0;
  for(const mode of ['numbers','preview']){f.menu.setMode(mode);for(let index=0;index<books.length;index++)for(const entry of books[index].chapters){
    f.menu.open({bookIndices:[index],index,anchor});const buttons=find(f,'edge-chapters__chapter'),button=buttons.find(node=>+node.dataset.chapter===entry.chapter);
    assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.dataset.page,String(entry.page));
    button.click();assert.equal(f.selected.at(-1),entry.page);assert.equal(f.menu.isOpen(),false);count++;
  }}
  assert.equal(count,2378);assert.equal(f.selected.length,2378);
});
test('optional opening button selects the real book opening independently of chapter mapping',()=>{
  const f=setup();f.menu.open({bookIndices:[65],index:65,anchor});
  const modes=find(f,'edge-chapters__modes')[0],opening=find(f,'edge-chapters__opening')[0],footer=find(f,'edge-chapters__footer')[0];
  assert.equal(opening.parentNode,modes);assert.equal(modes.children.at(-1),opening);assert.equal(footer.hidden,true);assert.equal(find(f,'edge-chapters__hint')[0].parentNode,footer);
  opening.click();assert.deepEqual(f.selected,[books[65].first]);assert.equal(f.menu.isOpen(),false);
});
test('fixed corner placement fits phone, landscape and desktop and honors visual viewport offsets',()=>{
  for(const viewport of [{width:320,height:568},{width:390,height:720},{width:740,height:360},{width:1440,height:900},{left:15,top:120,width:320,height:340}]){
    for(const rect of [anchor,{left:-300,top:-20,right:-280},{left:3000,top:1900,right:3020}]){
      const p=C.place(rect,viewport,{width:360,height:900}),left=viewport.left||0,top=viewport.top||0;
      assert.ok(p.left>=left&&p.top>=top);assert.ok(p.left+p.width<=left+viewport.width+1e-7);assert.ok(p.top+p.height<=top+viewport.height+1e-7);
    }
  }
  const f=setup(undefined,{width:320,height:568});f.menu.open({bookIndices:[18],index:18,anchor});const panel=find(f,'edge-chapters__panel')[0];assert.equal(panel.style.width,'264px');assert.equal(panel.style.maxHeight,'332px');
});
test('chapter controls use compact desktop cells, 44px phone cells and plain untransformed text',()=>{
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8');assert.match(css,/min-width:\s*var\(--cell,34px\);min-height:\s*var\(--cell,34px\)/);assert.match(css,/overflow-y:\s*auto/);
  for(const name of ['number','preview','reference']){const rule=css.match(new RegExp('\\.edge-chapters__'+name+'\\s*\\{([^}]+)\\}'));assert.ok(rule);assert.doesNotMatch(rule[1],/filter\s*:|transform\s*:/);}
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});for(const button of find(f,'edge-chapters__chapter')){assert.equal(button.events.has('keydown'),false);assert.ok(button.title.includes('创世记'));assert.ok(button.getAttribute('aria-label'));}
  assert.equal(find(f,'edge-chapters__panel')[0].style['--cell'],'44px');
  const desktop=setup(undefined,{width:1000,height:900});desktop.menu.open({index:18,anchor});assert.equal(find(desktop,'edge-chapters__panel')[0].style['--cell'],'34px');
});
test('all four dock corners touch the actual bookmark edge with no gap and preserve fractional coordinates',()=>{
  const viewport={width:1000,height:800};
  for(const [left,top,corner] of [[80.125,70.5,'top-left'],[880.125,70.5,'top-right'],[80.125,680.5,'bottom-left'],[880.125,680.5,'bottom-right']]){
    const a={left,top,right:left+13.25,bottom:top+24.75,width:13.25,height:24.75},dock=C.chooseDock(a,viewport);
    assert.equal(dock.corner,corner);assert.equal(dock.x,corner.endsWith('left')?a.right:a.left);assert.equal(dock.y,corner.startsWith('top')?a.top:a.bottom);assert.ok(Object.isFrozen(dock));
    for(const size of [{width:180,height:130},{width:310,height:300},{width:520,height:420}]){
      const bounds=C.dockBounds(dock,viewport),p=C.placeDock(dock,{width:Math.min(size.width,bounds.width),height:Math.min(size.height,bounds.height)});
      assert.equal(corner.endsWith('left')?p.left:p.left+p.width,dock.x);assert.equal(corner.startsWith('top')?p.top:p.top+p.height,dock.y);
    }
  }
});
test('mode, member, repeated open, natural-height and viewport changes reuse the same corner until close',()=>{
  for(const a of [{left:80.125,top:70.5,right:93.375,bottom:95.25},{left:880.125,top:70.5,right:893.375,bottom:95.25},{left:80.125,top:680.5,right:93.375,bottom:705.25},{left:880.125,top:680.5,right:893.375,bottom:705.25}]){
    const f=setup(undefined,{width:1000,height:800},actualPreview);f.menu.open({bookIndices:[64,18],index:64,anchor:a});const panel=find(f,'edge-chapters__panel')[0],dock=C.chooseDock(a,{width:1000,height:800});
    const check=()=>{
      for(const node of [panel,f.menu.element]){assert.equal(node.dataset.dockCorner,dock.corner);assert.equal(+node.dataset.anchorX,dock.x);assert.equal(+node.dataset.anchorY,dock.y);}
      const rect=panel.getBoundingClientRect();assert.equal(dock.corner.endsWith('left')?rect.left:rect.right,dock.x);assert.equal(dock.corner.startsWith('top')?rect.top:rect.bottom,dock.y);
    };
    check();f.menu.setMode('preview');check();find(f,'edge-chapters__book')[1].click();check();f.menu.setMode('numbers');check();
    f.menu.open({index:18,anchor:{left:450,top:400,right:465,bottom:424}});check();
    panel._height=180;f.win.dispatch('resize');check();f.win.innerWidth=950;f.win.innerHeight=760;f.win.dispatch('resize');check();
    const before={...panel.style};f.menu.close();assert.deepEqual(panel.style,before);assert.equal(f.selected.length,0);
    f.menu.open({index:64,anchor:{left:450,top:400,right:465,bottom:424}});assert.notEqual(panel.dataset.anchorX,String(dock.x));
  }
});
test('little corner space reduces size and enables whole-paper scrolling without relocating the hinge',()=>{
  const f=setup(undefined,{width:390,height:260},actualPreview),a={left:350.25,top:110.5,right:365.5,bottom:134.75};
  f.menu.open({index:18,anchor:a});f.menu.setMode('preview');const panel=find(f,'edge-chapters__panel')[0];
  assert.equal(panel.dataset.tight,'true');assert.equal(panel.style.maxHeight,'137.5px');assert.equal(+panel.dataset.anchorX,350.25);assert.equal(+panel.dataset.anchorY,110.5);
  const r=panel.getBoundingClientRect();assert.equal(r.right,350.25);assert.equal(r.top,110.5);assert.ok(r.bottom<=248);
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8');assert.match(css,/\.edge-chapters__panel\[data-tight="true"\]\s*\{[^}]*overflow-y:\s*auto/);
});
test('paper and immersion shade are translucent and appearance never translates the docked corner',()=>{
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8');
  const outside=css.match(/\.edge-chapters__outside\s*\{([^}]+)\}/)[1],panel=css.match(/\.edge-chapters__panel\s*\{([^}]+)\}/)[1];
  assert.match(outside,/background:\s*rgba\([^)]*,\s*\.[0-9]+\)/);assert.match(panel,/rgba\([^)]*,\s*\.[0-9]+\)/);
  assert.doesNotMatch(css,/\btransform\s*:/);assert.match(css,/@keyframes\s+directory-leaf-in\s*\{from\{opacity:0\}to\{opacity:1\}\}/);
});
test('preview grid rows keep intrinsic content height and never shrink chapter number, excerpt or reference',()=>{
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8');
  const grid=css.match(/\.edge-chapters__grid\s*\{([^}]+)\}/)[1];
  assert.match(grid,/grid-auto-rows:\s*max-content(?:;|$)/);assert.match(grid,/align-content:\s*start(?:;|$)/);
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for(const name of ['number','preview','reference']){
    assert.ok(rules.some(([,selectors,body])=>selectors.split(',').some(selector=>selector.trim()==='.edge-chapters__'+name)&&/flex:\s*none(?:;|$)/.test(body)),name+' must not flex-shrink inside a preview card');
  }
});
test('paper-ink selected states keep readable contrast, scoped hover precedence and forced-color overrides',()=>{
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8'),global=fs.readFileSync(require.resolve('./style.css'),'utf8');
  const globalSelector='button:hover:not(:disabled)';assert.ok(global.includes(globalSelector+'{color:#9b7540}'));
  // These selectors only use types, classes, attributes and simple :not();
  // :not itself contributes no specificity, but its argument does.
  const specificity=selector=>{
    const s=selector.replace(/:not\(([^)]+)\)/g,'$1');
    return [(s.match(/#[\w-]+/g)||[]).length,(s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)||[]).length,(s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g,'').match(/\b[a-z][\w-]*/g)||[]).length];
  };
  const greater=(a,b)=>a[0]>b[0]||a[0]===b[0]&&(a[1]>b[1]||a[1]===b[1]&&a[2]>b[2]);
  const rules=['.edge-chapters .edge-chapters__book[aria-pressed="true"]','.edge-chapters .edge-chapters__chapter[aria-current="page"]','.edge-chapters .edge-chapters__mode[aria-pressed="true"]'];
  const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const luminance=color=>{const rgb=color.slice(1).match(/../g).map(hex=>parseInt(hex,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
  const paper=css.match(/@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?background:\s*(#[0-9a-f]{6})/i)[1];
  for(const selector of rules){
    const rule=css.match(new RegExp(escape(selector)+'\\s*\\{([^}]+)\\}'))[1],ink=rule.match(/color:\s*(#[0-9a-f]{6})/i)[1];
    const light=Math.max(luminance(paper),luminance(ink)),dark=Math.min(luminance(paper),luminance(ink));assert.ok((light+.05)/(dark+.05)>=4.5,'paper/ink contrast');
    assert.ok(greater(specificity(selector),specificity(globalSelector)),selector+' must outrank global hover');
  }
  const forced=css.slice(css.search(/@media\s*\(forced-colors:\s*active\)/));
  for(const selector of rules)assert.ok(forced.includes(selector));assert.match(forced,/color:\s*HighlightText;background:\s*Highlight/);
});
test('Escape is intercepted at window before document and restores launcher focus',()=>{
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});const event=f.win.dispatch('keydown',{key:'Escape'});
  assert.ok(event.prevented&&event.stopped&&event.immediate);assert.equal(f.menu.isOpen(),false);assert.equal(f.doc.activeElement,f.launcher);assert.equal(f.doc.events.has('keydown'),false);
});
test('outside click closes only this menu and pointer propagation cannot reach the book',()=>{
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});const down=f.menu.element.dispatch('pointerdown');assert.equal(down.stopped,true);assert.equal(down.prevented,false);
  const click=find(f,'edge-chapters__outside')[0].click();assert.equal(click.stopped,true);assert.equal(f.menu.isOpen(),false);assert.equal(f.selected.length,0);
});
test('keyboard Tab wraps inside dialog without trapping focus after it closes',()=>{
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});const first=find(f,'edge-chapters__close')[0],last=find(f,'edge-chapters__chapter').at(-1);
  const opening=find(f,'edge-chapters__opening')[0];opening.focus();assert.equal(f.win.dispatch('keydown',{key:'Tab'}).prevented,false,'opening precedes chapters and must not wrap focus');
  last.focus();let event=f.win.dispatch('keydown',{key:'Tab'});assert.ok(event.prevented);assert.equal(f.doc.activeElement,first);
  first.focus();event=f.win.dispatch('keydown',{key:'Tab',shiftKey:true});assert.ok(event.prevented);assert.equal(f.doc.activeElement,last);
  f.menu.close();event=f.win.dispatch('keydown',{key:'Tab'});assert.equal(event.prevented,false);
});
test('mode switches preserve focused chapter and both native mode controls participate in Tab and Escape',()=>{
  const f=setup({bookIndex:0,chapter:3},undefined,actualPreview);f.menu.open({index:0,anchor});
  assert.equal(f.doc.activeElement.dataset.chapter,'3');f.menu.setMode('preview');assert.equal(f.doc.activeElement.dataset.chapter,'3');
  for(const button of find(f,'edge-chapters__mode')){
    assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.events.has('keydown'),false);
    button.focus();const tab=f.win.dispatch('keydown',{key:'Tab'});assert.equal(tab.prevented,false,'mode button must belong to the dialog focus sequence');
  }
  const escape=f.win.dispatch('keydown',{key:'Escape'});assert.ok(escape.prevented);assert.equal(f.menu.isOpen(),false);assert.equal(f.doc.activeElement,f.launcher);assert.equal(f.menu.getMode(),'preview');
});
test('invalid members are filtered, duplicate members collapse and repeated close is harmless',()=>{
  const f=setup();assert.equal(f.menu.open({bookIndices:[-1,66,NaN]}),false);assert.equal(f.menu.isOpen(),false);
  f.menu.open({bookIndices:[0,0,-1,1],index:1,anchor});assert.deepEqual(find(f,'edge-chapters__book').map(button=>+button.dataset.book),[0,1]);assert.equal(f.menu.element.dataset.book,'1');assert.equal(f.menu.close(),true);assert.equal(f.menu.close(),false);
});
test('destroy removes portal and listeners but leaves host and neighboring content intact',()=>{
  const f=setup();f.menu.open({bookIndices:[18],index:18,anchor});const stale=find(f,'edge-chapters__chapter')[0];f.menu.destroy();f.menu.destroy();stale.click();
  assert.equal(f.selected.length,0);assert.deepEqual(f.doc.body.children,[f.host,f.launcher]);assert.equal(f.win.events.get('keydown').size,0);assert.equal(f.win.events.get('resize').size,0);assert.equal(f.menu.open({index:0}),false);
});
console.log(`Edge chapters: ${checks} checks passed (66 books / 1189 chapters).`);
