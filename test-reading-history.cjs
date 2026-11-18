'use strict';
const assert=require('node:assert/strict'),H=require('./reading-history.js');
const loc=(page,ref='1:'+page,name='创世记',code='GEN')=>({page,ref,bookName:name,bookCode:code});
const memory=()=>{
  const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};
};
const model=storage=>H.createModel({storage,pageCount:1250});
const cases=[];
const test=(name,fn)=>cases.push([name,fn]);
test('ordinary startup and sequential reading do not invent a jump on a clean device',()=>{
  const s=memory(),m=model(s);m.start(loc(0));m.advance(loc(2));assert.deepEqual(m.list(),[]);assert.equal(s.getItem(H.KEY),null);
});
test('one active reading line advances through pages, including across books, without manufacturing rows',()=>{
  const m=model(memory()),a=m.jump(loc(2));for(let i=3;i<70;i++)m.advance(loc(i,'2:'+i,'出埃及记','EXO'));
  const [result]=m.list();assert.equal(m.list().length,1);assert.equal(result.id,a.id);assert.equal(result.page,69);assert.equal(result.bookCode,'EXO');
});
test('a distinct explicit jump forks a new trail, even within one book; returning to an exact point resumes rather than duplicates',()=>{
  const m=model(memory()),a=m.jump(loc(2)),b=m.jump(loc(40));m.advance(loc(42));
  assert.equal(m.list().length,2);assert.equal(m.jump(loc(2)).id,a.id);m.advance(loc(4));
  assert.equal(m.get(b.id).page,42);assert.equal(m.get(a.id).page,4);
  const entry=m.get(b.id);const restore=m.jump(entry,b.id);assert.equal(restore.id,b.id);assert.equal(m.current(),b.id);
  entry.page=899;assert.equal(m.get(b.id).page,42);
});
test('same page can have multiple chapter starts; reopening keeps the selected chapter even when reader reports the page’s first verse',()=>{
  const s=memory(),m=model(s),a=m.jump(loc(18,'2:1')),b=m.jump(loc(18,'3:1'));
  const reboot=model(s);reboot.start(loc(18,'2:15'));assert.equal(reboot.current(),b.id);assert.equal(reboot.get(b.id).ref,'3:1');assert.equal(reboot.get(a.id).ref,'2:1');
});
test('deleting active or all records detaches, and neither paging, stale callback nor reload can resurrect them',()=>{
  const s=memory(),m=model(s),a=m.jump(loc(7)),b=m.jump(loc(14));assert.ok(m.remove(b.id));m.advance(loc(16));assert.equal(m.list().length,1);
  const re=model(s);re.start(loc(14));re.advance(loc(17));assert.equal(re.current(),null);assert.equal(re.get(a.id).page,7);
  assert.equal(re.jump(loc(14),b.id),null);re.remove(a.id);assert.deepEqual(re.list(),[]);
  const empty=model(s);empty.start(loc(1));empty.advance(loc(3));assert.deepEqual(empty.list(),[]);
  const deliberate=empty.jump(loc(14));assert.notEqual(deliberate.id,b.id);
});
test('pin/sort, unpin, delete and undo do not navigate or steal the active reading line',()=>{
  const m=model(memory()),a=m.jump(loc(7)),b=m.jump(loc(24)),c=m.jump(loc(64));m.pin(a.id,true);
  assert.deepEqual(m.list().map(e=>e.id),[a.id,c.id,b.id]);m.remove(a.id);m.advance(loc(66));assert.ok(m.canUndo());assert.ok(m.undo());
  assert.ok(m.get(a.id).pinned);assert.equal(m.current(),c.id);m.pin(a.id,false);assert.ok(!m.get(a.id).pinned);assert.ok(!m.undo());assert.equal(m.current(),c.id);
});
test('pinned lines survive recency eviction and an old unpinned item remains available immediately after unpin/undo',()=>{
  const m=model(memory()),a=m.jump(loc(2));m.pin(a.id);for(let n=0;n<3*H.MAX_RECENT;n++)m.jump(loc(10+n));
  assert.equal(m.list().length,H.MAX_RECENT+1);assert.equal(m.list()[0].id,a.id);
  m.pin(a.id,false);assert.ok(m.get(a.id));assert.equal(m.list().length,H.MAX_RECENT);
  m.remove(a.id);m.jump(loc(512));assert.ok(m.undo());assert.ok(m.get(a.id));assert.equal(m.list().length,H.MAX_RECENT);
});
test('storage fences across two tabs prevent automatic advances from reviving another tab’s deletion',()=>{
  const s=memory(),a=model(s),v=a.jump(loc(37)),b=model(s);b.start(loc(37));b.remove(v.id);a.advance(loc(39));
  assert.deepEqual(a.list(),[]);assert.equal(a.current(),null);assert.deepEqual(model(s).list(),[]);
});
test('malformed storage and unavailable/quota-limited storage fall back to valid in-memory history',()=>{
  for(const bad of ['invalid json','null','{}',JSON.stringify({version:1,items:[{},null,{page:1250,id:'r1'}]})]){
    const s=memory();s.setItem(H.KEY,bad);const m=model(s);m.start(loc(18));assert.deepEqual(m.list(),[]);
    for(const badLoc of [{page:-1},{page:1.5},null,{page:1250}])assert.equal(m.jump(badLoc),null);
  }
  for(const s of [null,{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},{getItem(){return null;},setItem(){throw Error('quota');}}]){
    const m=model(s),e=m.jump(loc(21));m.advance(loc(23));assert.equal(m.get(e.id).page,23);m.pin(e.id,true);assert.ok(m.list()[0].pinned);
  }
});
test('edition-specific reader storage keeps history apart from other layout and ribbon data',()=>{
  const E=require('./paper-edition.js'),s=memory(),original='unchanged';
  s.setItem('paper-bible-position-v1',original);
  const a=E.storageFor(s,{pages:[]},{edition:'rules-3',pages:[],books:[]}),b=E.storageFor(s,{pages:[]},{edition:'other',pages:[],books:[]});
  model(a).jump(loc(9));assert.equal(model(a).list().length,1);assert.deepEqual(model(b).list(),[]);assert.equal(s.getItem('paper-bible-position-v1'),original);
});
test('UI emits exact history id+anchor on restore, never records a click before navigation commits',()=>{
  const listeners=new Map(),doc={documentElement:null,defaultView:{addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}};
  class Node{
    constructor(type){this.type=type;this.children=[];this.attrs={};this.events={};this.className='';this.dataset={};this.ownerDocument=doc;
      this.classList={add:()=>{},remove:()=>{}};}
    append(...n){this.children.push(...n);}
    appendChild(n){this.append(n);return n;}
    replaceChildren(...n){this.children=n;}
    setAttribute(k,v){this.attrs[k]=String(v);}
    addEventListener(k,v){this.events[k]=v;}
    focus(){this.focused=true;}
    close(){this.open=false;this.events.close?.();}
    showModal(){this.open=true;}
    closest(){return null;}
    querySelector(){return null;}
    click(){this.events.click?.({target:this});}
    find(test){if(test(this))return this;for(const c of this.children){const n=c.find(test);if(n)return n;}}
  }
  doc.createElement=k=>new Node(k);doc.documentElement=new Node('html');
  const host=new Node('section'),s=memory(),requests=[],ui=H.create({host,pageCount:120,storage:s,onNavigate:(...args)=>requests.push(args)});
  ui.start(loc(1));const a=ui.jump(loc(10,'3:1')),b=ui.jump(loc(20,'4:1'));const before=s.getItem(H.KEY);
  function act(label,start=host){const n=start.find(n=>n.attrs['aria-label']===label);assert.ok(n,label);n.click();return n;}
  act('管理阅读记录');const panel=host.find(n=>n.type==='dialog');assert.ok(ui.isOpen());act('返回 创世记 3:1',panel);
  assert.equal(ui.isOpen(),false);assert.equal(requests.length,1);assert.deepEqual(requests[0],[10,a.id,a]);assert.equal(s.getItem(H.KEY),before);
  ui.jump(loc(10,'3:1'),a.id);act('管理阅读记录');act('置顶 创世记 4:1',panel);assert.equal(ui.list()[0].id,b.id);
  act('取消置顶 创世记 4:1',panel);act('删除 创世记 4:1',panel);assert.equal(ui.list().length,1);act('撤销上一次删除',panel);assert.equal(ui.list().length,2);
  assert.equal(requests.length,1);ui.destroy();assert.equal(listeners.size,0);assert.equal(host.children.length,0);
});
for(const [name,fn] of cases){fn();console.log('PASS '+name);}
console.log(JSON.stringify({historyScenarios:cases.length}));
