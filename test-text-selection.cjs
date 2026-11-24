'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),S=require('./text-selection.js');
const Page=require('./paper-page.js'),Layout=require('./paper-layout.js'),Bible=require('./data/bible-source.js');
const books=Bible.books.filter(b=>['JHN','2JN'].includes(b.code)),D=Layout.paginate({...Bible,books});
const index=i=>S.indexFace(D.pages[i],Page.commands(D.pages[i],i,D.books).filter(c=>c.role!=='footer-rule'));

test('V25 Acts 7:54–56 copies the complete split verse from either physical page',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),window={};
  vm.runInNewContext(fs.readFileSync(require.resolve('./v25-original-data.js'),'utf8'),{window,atob});
  const db=window.V25OriginalData,first=db.lookup('ACT','7:56'),last=first+1;
  const load=n=>{const k=Math.floor(n/32);db.installPack(k,require('./paper-pages/'+db.packs[k]));};
  load(first);load(last);
  const face=n=>S.indexFace(db.pages[n],db.get(n)[3].map((w,j)=>({...db.tags(n)[j],text:w[4],physicalInk:true}))).units;
  const left=face(first),sel=left.filter(u=>/^verse:7:5[4-6]$/.test(u.group));
  const expected='众人听见这话，就极其恼怒，向司提反咬牙切齿。但司提反被圣灵充满，定睛望天，看见神的荣耀，又看见耶稣站在神的右边，就说：“我看见天开了，人子站在神的右边。”\n( 使徒行传 7:54-56 和合本 )';
  assert.match(S.clipboardQuote(sel,'使徒行传',left),/神的右\n/);
  assert.equal(S.physicalClipboardQuote(sel,'使徒行传',left,db,first),expected);
  const right=face(last);
  assert.equal(S.physicalClipboardQuote(right.filter(u=>u.group==='verse:7:56'),'使徒行传',right,db,last),
    '就说：“我看见天开了，人子站在神的右边。”\n( 使徒行传 7:56 和合本 )');
  assert.equal(S.physicalClipboardQuote(sel.slice(0,2),'使徒行传',left,db,first),S.clipboardQuote(sel.slice(0,2),'使徒行传',left));
});

test('a wrapped verse copies the printed scripture, not superscripts, headings or other verses',()=>{
  const i=D.books.find(b=>b.code==='2JN').first,model=index(i);
  for(const [v,text] of books[1].chapters[0].verses){
    const unit=model.units.find(u=>u.group==='verse:1:'+v);
    assert.equal(unit.text,text.trim());assert.ok(unit.parts.length>0);
  }
  const cmd=Page.commands(D.pages[i],i,D.books);
  const label=cmd.findIndex(c=>c.role==='verse'&&c.text==='2');
  assert.equal(model.lookup[label][0].group,'verse:1:2');
});
test('continued verse cannot leak the following face; selected fragments reconstruct the verse',()=>{
  const book=D.books.find(b=>b.code==='JHN');
  const i=D.pages.findIndex((p,i)=>i>=book.first&&i<book.last&&p.end===D.pages[i+1].start);
  assert.ok(i>=0);const ref=D.pages[i].end,[ch,v]=ref.split(':');
  const source=books[0].chapters.find(c=>+c.chapter===+ch).verses.find(([n])=>+n===+v)[1].trim();
  const a=index(i).units.find(u=>u.group==='verse:'+ref),b=index(i+1).units.find(u=>u.group==='verse:'+ref);
  assert.ok(a.text.length<source.length&&b.text.length<source.length);assert.equal(a.text+b.text,source);
});
test('English cover: selectable individual words, interior whitespace is blank; copy is reading order',()=>{
  const front=index(0).units.filter(u=>u.group.startsWith('subtitle:'));
  assert.deepEqual(front.map(u=>u.text),['THE','OLD','TESTAMENT']);
  assert.equal(S.copyText([front[2],front[0]]),'THE TESTAMENT');
  const model=S.indexFace({cols:[]},[{role:'subtitle',text:"God's   well-being"}]);
  assert.deepEqual(model.units.map(u=>u.text),["God's",'well-being']);assert.equal(model.lookup[0][6],undefined);
});
test('marks coalesce across characters but never across the second column or the empty end of a line',()=>{
  const b=(x,line)=>({line,x,y:20,width:12,height:14});
  assert.deepEqual(S.mergeRects([b(10,'a'),b(22,'a'),b(80,'a'),b(92,'b')]).map(r=>r.width),[24,12,12]);
});

class El{
  constructor(name,doc){this.tag=name;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.handlers={};this.classList={add(){}};this.style={setProperty(){}};}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  cloneNode(){const clone=new El(this.tag,this.ownerDocument);clone.attrs={...this.attrs};return clone;}
  addEventListener(k,fn){(this.handlers[k]||=[]).push(fn);}
  appendChild(ch){this.append(ch);return ch;}
  append(...children){for(const ch of children){this.children.push(ch);ch.parent=this;}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(ch=>ch!==this);}
  insertBefore(ch,before){ch.parent=this;this.children.splice(this.children.indexOf(before),0,ch);}
  contains(node){return node===this||this.children.some(ch=>ch.contains(node));}
  closest(selector){return selector==='text[data-role]'&&this.tag==='text'?this:null;}
  querySelectorAll(selector){return this.children.filter(e=>selector==='text[data-role]'&&e.tag==='text'||selector.startsWith('.')&&e.attrs.class?.split(' ').includes(selector.slice(1)));}
  querySelector(selector){return this.children.find(e=>selector==='svg'&&e.tag==='svg'||selector==='[role=status]'&&e.attrs.role==='status'||selector.startsWith('[data-')&&selector.slice(1,-1)in e.attrs);}
  focus(){} select(){}
  getBoundingClientRect(){return this.rect||{left:0,top:0,width:130,height:30};}
}
function scene(storage){
  const writes=[],timers=new Map(),messages=[],listeners=new Map(),tabs=[];
  const win={open:(...args)=>tabs.push(args),navigator:{clipboard:{async writeText(t){writes.push(t);}}},setTimeout(fn,ms){timers.set(ms,fn);return ms;},clearTimeout(n){timers.delete(n);}};
  const doc={defaultView:win,createElement(n){return new El(n,this);},createElementNS(ns,n){return new El(n,this);}};
  win.addEventListener=(type,fn)=>listeners.set(type,fn);win.removeEventListener=type=>listeners.delete(type);
  const stage=doc.createElement('div');stage.rect={left:0,top:0,width:390,height:844};
  const papers=[0,1].map(side=>{
    const paper=doc.createElement('article'),svg=doc.createElement('svg');stage.append(paper);paper.append(svg);
    svg.rect={left:side*480,top:0,width:960,height:1408};
    svg.createSVGPoint=()=>({matrixTransform(m){return {x:(this.x-m.left)/2,y:this.y/2};}});
    svg.getScreenCTM=()=>({inverse:()=>svg.rect});
    const node=doc.createElement('text');svg.append(node);node.ownerSVGElement=svg;
    node.getCharNumAtPosition=({x,y})=>x<0||y<0||y>=12||x>=90?-1:Math.floor(x/10);
    node.getBBox=()=>({x:0,y:0,width:90,height:12});node.getExtentOfChar=j=>({x:j*10,y:0,width:10,height:12});
    return paper;
  });
  const ctrl=S.create({stage,papers,storage,getPage:side=>({page:{cols:[]},books:[],index:side}),commands:()=>[{text:'ONE TWO X',role:'subtitle'}],feedback:t=>messages.push(t)});
  const svg=side=>papers[side].querySelector('svg'),node=side=>svg(side).querySelectorAll('text[data-role]')[0];
  const hit=(side,n)=>ctrl.hit(side*480+(n+.5)*20,10,node(side));
  const bar=()=>stage.children.find(e=>e.attrs.role==='toolbar'),marks=(side=0)=>svg(side).children.filter(e=>e.tag==='g');
  return {ctrl,bar,marks,hit,timers,writes,messages,tabs,stage,svg,papers,storageEvent:key=>listeners.get('storage')?.({key})};
}
test('hit tests in transformed glyph coordinates; whitespace neither selects nor intercepts a swipe',()=>{
  const {hit,ctrl,papers}=scene();assert.equal(hit(0,1).unit.text,'ONE');assert.equal(hit(0,3),null);
  assert.equal(hit(1,5).unit.text,'TWO');assert.equal(ctrl.hit(50,500,papers[0]),null);
});
test('tap focus persists without a timer or toolbar, and moves to the latest tap',()=>{
  const {ctrl,timers,marks,hit,bar}=scene();ctrl.tap(hit(0,1));assert.equal(marks().length,1);assert.equal(ctrl.isActive(),false);assert.equal(bar(),undefined);
  assert.equal(timers.size,0);assert.match(marks()[0].attrs.class,/--focus/);
  ctrl.tap(hit(1,5));assert.equal(marks().length,0);assert.equal(marks(1).length,1);assert.match(marks(1)[0].attrs.class,/--focus/);
  ctrl.hold(hit(1,1));assert.equal(ctrl.isActive(),true);assert.equal(marks(1).length,1);assert.match(marks(1)[0].attrs.class,/--selected/);
});
test('focus survives viewport reset and an SVG repaint, but navigation reset clears it',()=>{
  const {ctrl,marks,hit,svg,papers}=scene();ctrl.tap(hit(0,1));
  const original=marks()[0],replacement=svg(1);replacement.remove();svg(0).remove();papers[0].append(replacement);
  ctrl.reset({keepFocus:true});ctrl.refresh();ctrl.refresh();
  assert.equal(marks().length,1);assert.match(marks()[0].attrs.class,/--focus/);assert.notEqual(marks()[0],original);
  ctrl.reset();ctrl.refresh();assert.equal(marks().length,0);
});
test('long press, select on current face only, toggle, copy in reading order, then exit',async()=>{
  const {ctrl,hit,bar,marks,writes,messages}=scene();
  ctrl.hold(hit(0,5));assert.equal(ctrl.isActive(),true);assert.equal(marks().length,1);
  ctrl.tap(hit(1,1));assert.equal(marks(1).length,0);assert.match(messages.at(-1),/同一页/);
  ctrl.tap(hit(0,1));assert.equal(marks().length,2);ctrl.tap(hit(0,1));assert.equal(marks().length,1);ctrl.tap(hit(0,1));
  await bar().querySelector('[data-copy]').handlers.click[0]();assert.deepEqual(writes,['ONE TWO']);
  assert.equal(bar(),undefined);assert.equal(ctrl.isActive(),false);assert.equal(marks().length,0);
});
test('exit without copy removes persistent marks and draft; empty selection cannot copy',()=>{
  const {ctrl,hit,bar,writes,marks}=scene();ctrl.hold(hit(0,5));ctrl.tap(hit(0,5));assert.equal(bar().querySelector('[data-copy]').disabled,true);
  ctrl.tap(hit(0,8));bar().querySelector('[data-exit]').handlers.click[0]();
  assert.equal(marks().length,0);assert.deepEqual(writes,[]);assert.equal(ctrl.isActive(),false);
});
test('stale face tokens cannot mark newly rendered pages',()=>{
  const {ctrl,papers,hit}=scene(),t=hit(0,1);papers[0].children=[];assert.equal(ctrl.hold(t),false);
});
test('verse quotes match the supplied Genesis examples exactly: ranges, gaps, blank, edition',()=>{
  const book=Bible.books.find(b=>b.code==='GEN'),ch=book.chapters.find(c=>+c.chapter===3);
  const u=v=>({group:'verse:3:'+v,text:ch.verses.find(([n])=>+n===v)[1],order:v});
  const a=u(10),b=u(11),c=u(12),d=u(13),all=[a,b,c,d];
  assert.equal(S.formatQuote([d,a,c],'创世记',all),a.text+'……'+c.text+d.text+'\n( 创世记 3:10,12-13 和合本 )');
  assert.equal(S.formatQuote([b,c,d],'创世记',all),b.text+c.text+d.text+'\n( 创世记 3:11-13 和合本 )');
  assert.equal(S.formatQuote([c],'创世记',all),c.text+'\n( 创世记 3:12 和合本 )');
});
test('a consecutive chapter crossing and a real omission produce unambiguous references',()=>{
  const refs=['3:35','3:36','4:1','4:2','4:3'];
  const units=refs.map((r,i)=>({group:'verse:'+r,order:i,text:String(i)}));
  assert.equal(S.formatQuote([units[1],units[2],units[3]],'约翰福音',units),'123\n( 约翰福音 3:36-4:2 和合本 )');
  assert.equal(S.formatQuote([units[0],units[2],units[4]],'约翰福音',units),'0……2……4\n( 约翰福音 3:35,4:1,3 和合本 )');
});
test('headings and English frontmatter are never attributed to a Bible verse',()=>{
  const words=index(0).units.filter(u=>u.group.startsWith('subtitle:'));
  assert.equal(S.formatQuote(words,'创世记',words),'THE OLD TESTAMENT');
  const title={group:'heading:0:1',text:'标题',order:1},verse={group:'verse:1:1',text:'经文',order:2};
  assert.equal(S.formatQuote([title,verse],'创世记',[title,verse]),'标题\n经文\n( 创世记 1:1 和合本 )');
});
test('unlabelled-on-screen tools have accessible icon names and no visible selection count',()=>{
  const s=scene();s.ctrl.hold(s.hit(0,0));const buttons=s.bar().children;
  assert.deepEqual(buttons.map(b=>b.attrs['aria-label']),['复制','网页搜索','高亮','退出']);
  assert.ok(buttons.every(b=>b.tag==='button'&&b.children[0].tag==='svg'&&!b.textContent));
});
test('one-color annotation survives exit, repeated SVG redraw and a new reader; can be removed',()=>{
  const mem=new Map(),storage={getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
  const s=scene(storage);s.ctrl.hold(s.hit(0,0));s.ctrl.tap(s.hit(0,5));s.bar().querySelector('[data-highlight]').handlers.click[0]();
  assert.equal(s.ctrl.isActive(),false);assert.equal(s.marks().length,2);assert.equal(s.marks(1).length,0);
  s.ctrl.reset();s.ctrl.refresh();s.ctrl.refresh();assert.ok(s.marks().every(e=>e.attrs.class.includes('--saved')));assert.equal(s.marks().length,2);
  const t=scene(storage);t.ctrl.refresh();assert.equal(t.marks().length,2);t.ctrl.hold(t.hit(0,0));t.ctrl.tap(t.hit(0,5));
  const remove=t.bar().querySelector('[data-highlight]');assert.equal(remove.attrs['aria-label'],'取消高亮');assert.equal(remove.attrs['aria-pressed'],'true');
  remove.handlers.click[0]();t.ctrl.refresh();assert.equal(t.marks().length,0);const reopened=scene(storage);reopened.ctrl.refresh();assert.equal(reopened.marks().length,0);
});
test('two tabs add or remove independent ink with undelivered storage events; receiving tabs redraw and keep their selection',()=>{
  const mem=new Map(),store={getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v)};
  const a=scene(store),b=scene(store),pen=s=>s.bar().querySelector('[data-highlight]'),apply=s=>pen(s).handlers.click[0]();
  a.ctrl.refresh();b.ctrl.refresh();a.ctrl.hold(a.hit(0,0));b.ctrl.hold(b.hit(0,5));apply(a);apply(b);
  const key=[...mem.keys()].find(k=>k.includes('~mark~'));a.storageEvent(key);assert.equal(a.marks().length,2);
  a.ctrl.hold(a.hit(0,0));b.ctrl.hold(b.hit(0,0));assert.equal(pen(b).attrs['aria-pressed'],'true');
  apply(a);b.storageEvent(key+':rules-3');assert.ok(b.ctrl.isActive());assert.equal(pen(b).attrs['aria-pressed'],'false');
  b.ctrl.reset();const c=scene(store);c.ctrl.refresh();assert.equal(c.marks().length,1);
});
test('old page-wide marks survive; a targeted removal overrides legacy ink without changing other marks',()=>{
  const m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)},s=scene(store),a=s.hit(0,0),b=s.hit(0,5);
  m.set(a.entry.key,JSON.stringify([a.unit.id,b.unit.id]));s.ctrl.refresh();assert.equal(s.marks().length,2);
  s.ctrl.hold(a);s.bar().querySelector('[data-highlight]').handlers.click[0]();assert.equal(s.marks().length,1);
  assert.deepEqual(JSON.parse(m.get(a.entry.key)),[a.unit.id,b.unit.id]);
  const t=scene(store);t.ctrl.refresh();assert.equal(t.marks().length,1);
});
test('mixed saved/unsaved selection fills remaining marks; unavailable store keeps session marks',()=>{
  const s=scene({getItem(){throw Error('denied');},setItem(){throw Error('quota');}});
  s.ctrl.hold(s.hit(0,1));s.bar().querySelector('[data-highlight]').handlers.click[0]();
  s.ctrl.hold(s.hit(0,1));s.ctrl.tap(s.hit(0,5));const pen=s.bar().querySelector('[data-highlight]');assert.equal(pen.attrs['aria-pressed'],'false');pen.handlers.click[0]();
  assert.equal(s.marks().length,2);assert.match(s.messages.at(-1),/仅本次阅读/);
});

test('Google provider round-trips complete selected content and question; bad inputs never navigate',()=>{
  const quote='In the beginning & light?\n( 创世记 1:1 )',question='“光”指什么？ #引文 + context';
  const url=new URL(S.buildSearchURL(quote,question));
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/search');assert.equal(url.searchParams.get('q'),quote+'\n\n'+question);
  assert.equal(S.buildSearchURL(quote,'   '),null);
  assert.equal(S.buildSearchURL(quote,question,'constructor'),null);
});
test('search snapshots selected text, does not transmit on open, cancel or during IME, and submits only once',()=>{
  const s=scene();s.ctrl.hold(s.hit(0,5));s.ctrl.tap(s.hit(0,0));
  const search=s.bar().querySelector('[data-search]');
  assert.equal(search.getAttribute('aria-expanded'),'false');
  search.handlers.click[0]();
  const form=()=>s.bar().children.find(e=>e.tag==='form');
  assert.equal(search.getAttribute('aria-expanded'),'true');
  assert.deepEqual(s.tabs,[]);
  const event={preventDefault(){}},f=form(),submit=f.handlers.submit[0];
  const input=f.children[0].children[0];
  input.value=' ';submit(event);assert.deepEqual(s.tabs,[]);
  input.value='中文？ & /';input.handlers.compositionstart[0]();submit(event);assert.deepEqual(s.tabs,[]);
  input.handlers.compositionend[0]();
  f.children[2].children[0].handlers.click[0]();assert.deepEqual(s.tabs,[]);assert.equal(form(),undefined);
  assert.equal(search.getAttribute('aria-expanded'),'false');assert.equal(s.marks().length,2);assert.equal(s.ctrl.isActive(),true);
  search.handlers.click[0]();const g=form();g.children[0].children[0].value='中文？ & /';
  s.ctrl.tap(s.hit(0,8));g.handlers.submit[0](event);g.handlers.submit[0](event);
  assert.equal(s.tabs.length,1);
  const [href,target,features]=s.tabs[0];assert.equal(target,'_blank');assert.equal(features,'noopener,noreferrer');
  assert.equal(new URL(href).searchParams.get('q'),'ONE TWO\n\n中文？ & /');
  assert.equal(s.marks().length,2);assert.equal(s.ctrl.isActive(),true);
});
test('escape from the search editor cancels before a second escape exits selection',()=>{
  const s=scene();s.ctrl.hold(s.hit(0,0));s.bar().querySelector('[data-search]').handlers.click[0]();
  const event={key:'Escape',preventDefault(){},stopPropagation(){}};
  s.bar().handlers.keydown[0](event);assert.ok(s.ctrl.isActive());assert.deepEqual(s.tabs,[]);
  s.bar().handlers.keydown[0](event);assert.equal(s.ctrl.isActive(),false);
});

test('clipboard strips Han layout spaces without touching display text, English or citation',()=>{
  const verse={order:1,group:'verse:1:1',text:'\u8d77 \u521d\u3000\u00a0\u795e\ufeff\u5275 \u9020\u3002'};
  const next={order:2,group:'verse:1:2',text:'\u5730 \u200b\u662f \u7a7a \u865b\u3002'};
  const unmodified='\u8d77 \u521d\u3000\u00a0\u795e\ufeff\u5275 \u9020\u3002\u5730 \u200b\u662f \u7a7a \u865b\u3002\n( \u5275\u4e16\u8a18 1:1-2 \u548c\u5408\u672c )';
  assert.equal(S.formatQuote([next,verse],'\u5275\u4e16\u8a18'),unmodified);
  assert.equal(S.clipboardQuote([next,verse],'\u5275\u4e16\u8a18'),'\u8d77\u521d\u795e\u5275\u9020\u3002\u5730\u662f\u7a7a\u865b\u3002\n( \u5275\u4e16\u8a18 1:1-2 \u548c\u5408\u672c )');
  const cover={order:1,group:'heading:1:1',text:'THE OLD TESTAMENT'};
  assert.equal(S.clipboardQuote([cover]),cover.text);
});
test('physical verse bands use one span despite OCR height and punctuation differences',()=>{
  const glyph=(x,y,w,h,text)=>({x,y,w,h,text,role:'body',physicalInk:true});
  const commands=[
    glyph(18,20,11,14,'\u8d77'),glyph(34,22,11,11,'\u521d'),glyph(64,19,12,14,'\u795e'),
    glyph(78,31,2,2,'\u3002'),glyph(18,40,11,14,'\u5730'),glyph(256,20,11,14,'\u7684')
  ];
  const rows=S.physicalRows(commands);
  const boxes=commands.map((c,i)=>({...c,width:c.w,height:c.h,row:rows.get(i)?.key,
    rowCenter:rows.get(i)?.center,rowHeight:rows.get(i)?.height}));
  const bands=S.verseBands(boxes);
  assert.deepEqual(bands.map(b=>[b.x,b.width]),[[18,62],[18,11],[256,11]]);
  assert.ok(bands[1].y>bands[0].y+bands[0].height);
  assert.equal(bands[0].height,bands[2].height);
});

test('Ctrl/Cmd+C uses the same clipboard text and does not intercept editing controls',()=>{
  const s=scene(),token=s.hit(0,0);
  token.unit.text='\u8d77 \u521d\u3000\u795e\u5275 \u9020';token.unit.group='verse:1:1';token.unit.word=false;
  s.ctrl.hold(token);
  const writes=[];
  const copy=s.stage.handlers.copy[0],clipboardData={setData(...entry){writes.push(entry)}};
  let cancelled=false;
  copy({target:{closest:()=>true},clipboardData,preventDefault(){cancelled=true}});
  assert.deepEqual(writes,[]);assert.equal(cancelled,false);assert.ok(s.ctrl.isActive());
  copy({target:s.stage,clipboardData,preventDefault(){cancelled=true}});
  assert.deepEqual(writes,[['text/plain','\u8d77\u521d\u795e\u5275\u9020']]);
  assert.ok(cancelled);assert.equal(s.ctrl.isActive(),false);
});

test('tap clips a single word; selected lines use the unchanged saved highlight footprint',()=>{
  const storage=new Map();storage.setItem=(k,v)=>storage.set(k,v);storage.getItem=k=>storage.get(k);
  const {ctrl,marks,hit,bar,svg}=scene(storage);
  const geometry=()=>marks()[0].children[0].attrs;
  ctrl.tap(hit(0,1));
  const [clip,overlay]=marks()[0].children;
  assert.equal(clip.tag,'clipPath');assert.equal(clip.children[0].attrs.width,'30');
  assert.equal(overlay.getAttribute('clip-path'),`url(#${clip.attrs.id})`);
  assert.equal(overlay.getAttribute('data-paper-tap-ink'),'');
  assert.equal(svg(0).querySelectorAll('text[data-role]')[0].getAttribute('data-paper-tap-ink'),null);
  ctrl.hold(hit(0,1));
  assert.match(marks()[0].attrs.class,/--selected/);
  const selected={...geometry()},line=marks()[0].children[1];
  assert.equal(line.tag,'line');assert.ok(Number(line.attrs.y1)>12);
  bar().querySelector('[data-highlight]').handlers.click[0]();
  assert.match(marks()[0].attrs.class,/--saved/);
  assert.deepEqual(geometry(),selected);
});
