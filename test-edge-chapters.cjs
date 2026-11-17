'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('./edge-chapters.js');
const books=require('./paper-layout.js').paginate(require('./data/bible-source.js')).books;
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
  getBoundingClientRect(){const width=parseFloat(this.style.width)||44,height=Math.min(380,parseFloat(this.style.maxHeight)||380),left=parseFloat(this.style.left)||0,top=parseFloat(this.style.top)||0;return {left,top,right:left+width,bottom:top+height,width,height};}
}
function walk(node){return [node,...node.children.flatMap(walk)];}
function find(f,name){return walk(f.menu.element).filter(node=>String(node.className||'').split(' ').includes(name));}
function setup(current={bookIndex:0,chapter:1},size={width:390,height:720}){
  const doc=new Target(),win=new Target();doc.defaultView=win;win.innerWidth=size.width;win.innerHeight=size.height;doc.createElement=tag=>new Element(tag,doc);
  doc.body=new Element('body',doc);const host=new Element('div',doc);doc.body.appendChild(host);const launcher=new Element('button',doc);doc.body.appendChild(launcher);launcher.focus();
  const selected=[],menu=C.create(host,{books,onSelect:page=>selected.push(page),getCurrent:()=>current});
  return {doc,win,host,launcher,menu,selected};
}
const anchor={x:350,y:320,left:350,top:320,right:365,bottom:344,width:15,height:24};
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
});
test('group selector contains only supplied side members and switches chapter grids without navigation',()=>{
  const f=setup();f.menu.open({bookIndices:[51,52],index:51,anchor});
  assert.deepEqual(find(f,'edge-chapters__book').map(button=>+button.dataset.book),[51,52]);assert.equal(find(f,'edge-chapters__chapter').length,5);
  find(f,'edge-chapters__book')[1].click();assert.equal(find(f,'edge-chapters__chapter').length,3);assert.equal(f.menu.element.dataset.book,'52');assert.equal(f.selected.length,0);
  assert.equal(find(f,'edge-chapters__title')[0].textContent,'帖撒罗尼迦后书');
});
test('every one of 1189 chapter buttons selects its exact real page and closes before navigation',()=>{
  const f=setup();let count=0;
  for(let index=0;index<books.length;index++)for(const entry of books[index].chapters){
    f.menu.open({bookIndices:[index],index,anchor});const buttons=find(f,'edge-chapters__chapter'),button=buttons.find(node=>+node.dataset.chapter===entry.chapter);
    assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.dataset.page,String(entry.page));
    button.click();assert.equal(f.selected.at(-1),entry.page);assert.equal(f.menu.isOpen(),false);count++;
  }
  assert.equal(count,1189);assert.equal(f.selected.length,1189);
});
test('optional opening button selects the real book opening independently of chapter mapping',()=>{
  const f=setup();f.menu.open({bookIndices:[65],index:65,anchor});find(f,'edge-chapters__opening')[0].click();assert.deepEqual(f.selected,[books[65].first]);assert.equal(f.menu.isOpen(),false);
});
test('viewport placement fits phone, landscape and desktop and honors visual viewport offsets',()=>{
  for(const viewport of [{width:320,height:568},{width:390,height:720},{width:740,height:360},{width:1440,height:900},{left:15,top:120,width:320,height:340}]){
    for(const rect of [anchor,{left:-300,top:-20,right:-280},{left:3000,top:1900,right:3020}]){
      const p=C.place(rect,viewport,{width:360,height:900}),left=viewport.left||0,top=viewport.top||0;
      assert.ok(p.left>=left+12&&p.top>=top+12);assert.ok(p.left+p.width<=left+viewport.width-12+1e-7);assert.ok(p.top+p.height<=top+viewport.height-12+1e-7);
    }
  }
  const f=setup(undefined,{width:320,height:568});f.menu.open({bookIndices:[18],index:18,anchor});const panel=find(f,'edge-chapters__panel')[0];assert.equal(panel.style.width,'296px');assert.equal(panel.style.maxHeight,'544px');
});
test('all chapter controls retain large native targets and plain untransformed text',()=>{
  const css=fs.readFileSync(require.resolve('./edge-chapters.css'),'utf8');assert.match(css,/min-width:44px;min-height:44px/);assert.match(css,/overflow-y:auto/);assert.match(css,/backdrop-filter:blur/);assert.doesNotMatch(css,/(?<!backdrop-)filter\s*:|transform\s*:/);
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});for(const button of find(f,'edge-chapters__chapter')){assert.equal(button.events.has('keydown'),false);assert.ok(button.title.includes('创世记'));assert.ok(button.getAttribute('aria-label'));}
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
  const f=setup();f.menu.open({bookIndices:[0],index:0,anchor});const first=find(f,'edge-chapters__close')[0],last=find(f,'edge-chapters__opening')[0];
  last.focus();let event=f.win.dispatch('keydown',{key:'Tab'});assert.ok(event.prevented);assert.equal(f.doc.activeElement,first);
  first.focus();event=f.win.dispatch('keydown',{key:'Tab',shiftKey:true});assert.ok(event.prevented);assert.equal(f.doc.activeElement,last);
  f.menu.close();event=f.win.dispatch('keydown',{key:'Tab'});assert.equal(event.prevented,false);
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
