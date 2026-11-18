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
// Model ordinary native buttons: Enter/Space trigger click and click bubbles.
// Detecting a jump on pin/delete needs a real ancestor chain; calling each
// listener in isolation masks precisely that regression.
function shelf(storage=memory()){
  const listeners=new Map(),requests=[],timers=new Map();let now=0,id=0;
  function tick(ms){const end=now+ms;while(timers.size){const [n,task]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(task.at>end)break;
    now=task.at;timers.delete(n);task.fn();}now=end;}
  const clock={setTimeout(fn,ms){timers.set(++id,{at:now+ms,fn});return id;},clearTimeout(n){timers.delete(n);}};
  const doc={activeElement:null,events:{},addEventListener(k,v,capture){(this.events[k]||=[]).push({v,capture:capture===true||capture?.capture===true});},
    removeEventListener(k,v){this.events[k]=(this.events[k]||[]).filter(e=>e.v!==v);},
    defaultView:{...clock,addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}};
  class Node{
    constructor(tag){this.localName=tag;this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.events={};this.className='';this.dataset={};this.ownerDocument=doc;this.hidden=false;
      this.classList={contains:c=>this.className.split(/\s+/).includes(c),add:(...cs)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...cs])].join(' ');},
        remove:(...cs)=>{this.className=this.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ');}};}
    append(...nodes){for(const n of nodes){this.children.push(n);n.parentElement=this;}}
    appendChild(n){this.append(n);return n;}
    replaceChildren(...n){for(const ch of this.children)ch.parentElement=null;this.children=[];this.append(...n);}
    setAttribute(k,v){this.attrs[k]=String(v);}
    getAttribute(k){return this.attrs[k]??null;}
    addEventListener(k,v){(this.events[k]||=[]).push(v);}
    removeEventListener(k,v){this.events[k]=(this.events[k]||[]).filter(fn=>fn!==v);}
    focus(){const old=doc.activeElement;if(old===this)return;old?.fire('focusout',{relatedTarget:this});
      doc.activeElement=this;this.fire('focusin',{relatedTarget:old});}
    closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
    contains(n){return n===this||this.children.some(c=>c.contains(n));}
    matches(s){
      if(s.includes(','))return s.split(',').some(part=>this.matches(part.trim()));
      const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.localName!==tag)return false;
      for(const [,name] of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name))return false;
      for(const [,k,v] of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)){
        const a=k==='data-id'?this.dataset.id:this.attrs[k];if(a==null||v!==undefined&&v!==a)return false;
      }
      return !!tag||s.includes('.')||s.includes('[');
    }
    querySelector(s){
      const [head,...tail]=s.trim().split(/\s+/);
      for(const ch of this.children){
        if(ch.matches(head)){const result=tail.length?ch.querySelector(tail.join(' ')):ch;if(result)return result;}
        const found=ch.querySelector(s);if(found)return found;
      }return null;
    }
    find(test){if(test(this))return this;for(const c of this.children){const result=c.find(test);if(result)return result;}}
    fire(type,info={}){
      // Dispatch follows the original event path even if handlers re-render it.
      const path=[];for(let n=this;n;n=n.parentElement)path.push(n);
      const event={target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...info};
      for(const listener of doc.events[type]||[])if(listener.capture)listener.v(event);
      for(const n of path){event.currentTarget=n;for(const fn of n.events[type]||[])fn(event);if(event.stopped)break;}
      if(!event.stopped)for(const listener of doc.events[type]||[])if(!listener.capture)listener.v(event);
      return event;
    }
    click(info={}){assert.ok(!this.hidden&&!this.disabled);this.fire('click',info);}
    key(key){this.focus();const down=this.fire('keydown',{key});this.fire('keyup',{key});
      if(!down.defaultPrevented&&this.localName==='button'&&(key==='Enter'||key===' '))this.click();}
  }
  doc.createElement=t=>new Node(t);doc.createElementNS=(_,t)=>new Node(t);doc.documentElement=new Node('html');
  const host=new Node('section');doc.documentElement.append(host);
  const ui=H.create({host,pageCount:120,storage,onNavigate:(...args)=>requests.push(args)});
  const find=(label,base=host)=>base.find(n=>n.attrs['aria-label']===label);
  const button=(label,base)=>{const n=find(label,base);assert.ok(n,label);assert.equal(n.localName,'button');assert.ok(!n.disabled&&!n.hidden,label+' actionable inline');return n;};
  const row=id=>{const n=host.querySelector('.rh-item[data-id="'+id+'"]');assert.ok(n,id);return n;};
  return {host,ui,requests,doc,row,button,find,listeners,tick,timers};
}
const ptr=(node,type,pointerType,extra={})=>node.fire(type,{pointerType,pointerId:1,clientX:40,clientY:20,isPrimary:true,button:0,buttons:type==='pointerdown'?1:0,...extra});
const compatibilityClick=node=>node.click({detail:1,pointerType:'touch',pointerId:1});
function threeTabs(){
  const s=shelf(),entries=['3:1','4:1','5:1'].map((ref,i)=>s.ui.jump(loc((i+1)*10,ref)));
  const chip=i=>s.button('返回 创世记 '+entries[i].ref);
  const reveal=()=>entries.map(e=>s.row(e.id).dataset.reveal??null);
  return {s,entries,chip,reveal};
}
test('ordinary history rail has no manage entry or dialog; each record owns three independent native buttons',()=>{
  const s=shelf();s.ui.start(loc(1));const a=s.ui.jump(loc(10,'3:1')),b=s.ui.jump(loc(20,'4:1'));
  assert.ok(!s.find('管理阅读记录'));assert.ok(!s.host.querySelector('dialog'));assert.ok(!s.host.querySelector('.rh-manage'));
  for(const e of [a,b]){
    const r=s.row(e.id),title='创世记 '+e.ref;
    const controls=['返回 ','置顶 ','删除 '].map(p=>s.button(p+title,r));
    assert.equal(r.children.filter(c=>c.localName==='button').length,3);
    assert.ok(controls.every(c=>c.parentElement===r));assert.deepEqual(controls.map(c=>c.tabIndex??0),[0,-1,-1]);
    assert.equal(controls[1].attrs['aria-pressed'],'false');assert.equal(controls[0].dataset.id,e.id);
  }
  assert.equal(s.requests.length,0);s.ui.destroy();assert.equal(s.listeners.size,0);assert.equal(s.host.children.length,0);
});
test('inline resume emits id, page and exact anchor once; no writes before the navigation commits',()=>{
  const storage=memory(),s=shelf(storage);s.ui.start(loc(1));const a=s.ui.jump(loc(10,'3:1'));s.ui.jump(loc(20,'4:1'));
  const before=storage.getItem(H.KEY);s.button('返回 创世记 3:1').key('Enter');
  assert.deepEqual(s.requests,[[10,a.id,a]]);assert.equal(storage.getItem(H.KEY),before,'request is not a reading commit');
});
test('pin, unpin, delete and undo use independent action buttons; action clicks never bubble into a jump',()=>{
  const storage=memory(),s=shelf(storage);const a=s.ui.jump(loc(10,'3:1')),b=s.ui.jump(loc(20,'4:1'));
  const label='创世记 3:1',order=()=>s.ui.list().map(e=>e.id);
  assert.deepEqual(order(),[b.id,a.id]);assert.ok(!s.find('撤销上一次删除')||s.find('撤销上一次删除').hidden);
  s.button('置顶 '+label).key(' ');
  assert.equal(s.doc.activeElement,s.button('取消置顶 '+label));assert.equal(s.doc.activeElement.attrs['aria-pressed'],'true');
  assert.deepEqual(order(),[a.id,b.id]);assert.ok(model(storage).get(a.id).pinned);
  // A pinned tab keeps its unpin control reachable even at rest.
  s.button('取消置顶 '+label).click();
  assert.deepEqual(order(),[b.id,a.id]);assert.ok(!model(storage).get(a.id).pinned);assert.equal(s.doc.activeElement,s.button('置顶 '+label));
  s.button('置顶 '+label).click();s.button('删除 '+label).click();
  assert.deepEqual(order(),[b.id]);assert.ok(!s.find('返回 '+label));assert.equal(model(storage).get(a.id),null);
  assert.equal(s.doc.activeElement,s.button('撤销上一次删除'));s.doc.activeElement.key('Enter');
  assert.equal(s.doc.activeElement,s.button('返回 '+label));assert.deepEqual(order(),[a.id,b.id]);
  assert.ok(model(storage).get(a.id).pinned);assert.ok(!s.find('撤销上一次删除')||s.find('撤销上一次删除').hidden);
  assert.equal(s.requests.length,0);assert.equal(s.button('返回 创世记 4:1').attrs['aria-current'],'page');
});
test('removing the last active record leaves inline undo usable; undo after last-item deletion does not navigate',()=>{
  const s=shelf(),e=s.ui.jump(loc(10,'3:1'));s.button('删除 创世记 3:1').key('Enter');
  assert.deepEqual(s.ui.list(),[]);s.button('撤销上一次删除').click();assert.equal(s.ui.list()[0].id,e.id);
  assert.equal(s.button('返回 创世记 3:1').attrs['aria-current'],undefined);assert.deepEqual(s.requests,[]);
});
test('reopening the shelf reflects saved pinned and deleted records without needing any editing mode',()=>{
  const store=memory(),s=shelf(store),a=s.ui.jump(loc(10,'3:1'));s.ui.jump(loc(20,'4:1'));s.ui.jump(loc(30,'5:1'));
  s.button('置顶 创世记 3:1').click();s.button('删除 创世记 4:1').click();s.ui.destroy();
  const reopened=shelf(store);reopened.ui.start(loc(30,'5:1'));
  assert.equal(reopened.ui.list()[0].id,a.id);assert.equal(reopened.button('取消置顶 创世记 3:1').attrs['aria-pressed'],'true');
  assert.ok(!reopened.find('返回 创世记 4:1'));assert.equal(reopened.button('返回 创世记 5:1').attrs['aria-current'],'page');
  reopened.button('取消置顶 创世记 3:1').click();assert.ok(!model(store).get(a.id).pinned);assert.deepEqual(reopened.requests,[]);
});
test('nothing is exposed at rest; real mouse movement reveals only its own row and clears it on exit',()=>{
  const {chip,reveal}=threeTabs();
  assert.deepEqual(reveal(),[null,null,null]);
  ptr(chip(0),'pointerover','touch');ptr(chip(0),'pointermove','touch');assert.deepEqual(reveal(),[null,null,null],'touch-generated hover is not mouse hover');
  ptr(chip(0),'pointerover','mouse');assert.deepEqual(reveal(),['mouse',null,null]);
  ptr(chip(0),'pointerout','mouse',{relatedTarget:chip(2)});ptr(chip(2),'pointerover','mouse',{relatedTarget:chip(0)});
  assert.deepEqual(reveal(),[null,null,'mouse']);ptr(chip(2),'pointerout','mouse',{relatedTarget:null});assert.deepEqual(reveal(),[null,null,null]);
});
test('tab focus opens only one row for keyboard; pointer focus is not an instruction to leave it open',()=>{
  const {s,chip,reveal}=threeTabs();
  s.host.fire('keydown',{key:'Tab'});chip(0).focus();assert.deepEqual(reveal(),['keyboard',null,null]);
  assert.equal(s.button('置顶 创世记 3:1').tabIndex,0);assert.equal(s.button('删除 创世记 3:1').tabIndex,0);
  s.host.fire('keydown',{key:'Tab'});chip(1).focus();assert.deepEqual(reveal(),[null,'keyboard',null]);
  assert.equal(s.button('删除 创世记 3:1').tabIndex,-1);
  ptr(chip(2),'pointerdown','touch');chip(2).focus();ptr(chip(2),'pointerup','touch');
  assert.deepEqual(reveal(),[null,null,null]);
});
test('quick touch jumps directly; a still touch held for 420ms opens only that tab and consumes its compatibility click',()=>{
  const {s,chip,reveal,entries}=threeTabs();
  ptr(chip(0),'pointerdown','touch');s.tick(80);ptr(chip(0),'pointerup','touch');compatibilityClick(chip(0));
  assert.deepEqual(reveal(),[null,null,null]);assert.deepEqual(s.requests.map(x=>x[1]),[entries[0].id]);
  ptr(chip(1),'pointerdown','touch');s.tick(419);assert.deepEqual(reveal(),[null,null,null]);
  s.tick(1);assert.deepEqual(reveal(),[null,'touch',null]);
  ptr(chip(1),'pointerup','touch');compatibilityClick(chip(1));assert.equal(s.requests.length,1);assert.deepEqual(reveal(),[null,'touch',null]);
  ptr(chip(2),'pointerdown','touch');s.tick(420);ptr(chip(2),'pointerup','touch');compatibilityClick(chip(2));
  assert.deepEqual(reveal(),[null,null,'touch']);assert.equal(s.requests.length,1);
  // A long-press suppresses *one* gesture, never a later deliberate short tap.
  ptr(chip(2),'pointerdown','touch');s.tick(70);ptr(chip(2),'pointerup','touch');compatibilityClick(chip(2));
  assert.deepEqual(s.requests.map(x=>x[1]),[entries[0].id,entries[2].id]);
});
test('horizontal drift, scroll, pointer cancellation and a second finger all cancel a pending long press',()=>{
  for(const reason of ['drift','scroll','cancel','second']){
    const {s,chip,reveal}=threeTabs(),c=chip(0);ptr(c,'pointerdown','touch');s.tick(130);
    if(reason==='drift')ptr(c,'pointermove','touch',{clientX:58});
    if(reason==='scroll')s.host.querySelector('.rh-track').fire('scroll');
    if(reason==='cancel')ptr(c,'pointercancel','touch');
    if(reason==='second')ptr(chip(1),'pointerdown','touch',{pointerId:2,isPrimary:false});
    s.tick(600);assert.deepEqual(reveal(),[null,null,null],reason);ptr(c,'pointerup','touch');
    if(reason==='drift')compatibilityClick(c); // A browser can still send a click after a small sideways drag.
    assert.deepEqual(s.requests,[],reason);s.ui.destroy();
  }
});
test('long-press actions remain usable directly; pinning persists a pin, and outside tap / Escape dismiss transient actions',()=>{
  const {s,chip,reveal,entries}=threeTabs();
  const hold=i=>{const c=chip(i);ptr(c,'pointerdown','touch');s.tick(500);ptr(c,'pointerup','touch');compatibilityClick(c);};
  hold(1);s.doc.documentElement.fire('keydown',{key:'Escape'});assert.deepEqual(reveal(),[null,null,null]);
  hold(0);ptr(s.doc.documentElement,'pointerdown','touch');assert.deepEqual(reveal(),[null,null,null]);ptr(s.doc.documentElement,'pointerup','touch');
  hold(2);const pin=s.button('置顶 创世记 5:1');ptr(pin,'pointerdown','touch');ptr(pin,'pointerup','touch');compatibilityClick(pin);
  assert.equal(s.row(entries[2].id).dataset.pinned,'true');assert.equal(s.button('取消置顶 创世记 5:1').attrs['aria-pressed'],'true');
  ptr(s.doc.documentElement,'pointerdown','touch');assert.deepEqual(reveal(),[null,null,null],'pin remains, delete is hidden again on blur');
  assert.equal(s.button('取消置顶 创世记 5:1').tabIndex,0);assert.equal(s.button('删除 创世记 5:1').tabIndex,-1);
  assert.equal(s.requests.length,0);
});
test('untouched records hide both actions on every input device; a pinned record exposes only its pin until the row is revealed',()=>{
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'reading-history.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  const selectors=Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g),m=>({selectors:m[1].trim().split(',').map(s=>s.trim()),decl:m[2]}));
  const plain=selectors.filter(r=>r.selectors.includes('.rh-action'));
  const hidden=/(?:opacity\s*:\s*0\b|visibility\s*:\s*hidden)/,visible=/(?:opacity\s*:\s*1\b|visibility\s*:\s*visible)/;
  assert.ok(plain.some(r=>hidden.test(r.decl)&&/pointer-events\s*:\s*none/.test(r.decl)),'hidden baseline, including touch laptops');
  assert.ok(!plain.some(r=>visible.test(r.decl)||/pointer-events\s*:\s*auto/.test(r.decl)),'no coarse-pointer media override may expose all actions');
  const show=selectors.filter(r=>visible.test(r.decl)&&/pointer-events\s*:\s*auto/.test(r.decl)).flatMap(r=>r.selectors);
  assert.ok(show.some(s=>/\.rh-item\[data-reveal[^\]]*\]\s+\.rh-action$/.test(s)),'only interacted-with record exposes its two actions');
  assert.ok(show.some(s=>/\.rh-item\[data-pinned[^\]]*\]\s+\.rh-pin$/.test(s)),'pinned record still shows its pin at rest');
  assert.ok(!show.some(s=>/\.rh-item\[data-pinned[^\]]*\]\s+\.rh-(action|delete)$/.test(s)),'pinned record must not expose delete at rest');
  assert.ok(!show.some(s=>/\.rh-item:(hover|focus-within|has)/.test(s)),'sticky CSS hover/focus cannot reveal ghost controls on a hybrid device');
  assert.doesNotMatch(css,/\.rh-(?:manage|panel)(?:[\s,{:.#\[]|$)/);
});
for(const [name,fn] of cases){fn();console.log('PASS '+name);}
console.log(JSON.stringify({historyScenarios:cases.length}));
