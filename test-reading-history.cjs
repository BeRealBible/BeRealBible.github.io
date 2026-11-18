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
  const listeners=new Map(),requests=[];
  const doc={activeElement:null,defaultView:{addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)}};
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
    focus(){doc.activeElement=this;}
    closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
    matches(s){
      const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.localName!==tag)return false;
      for(const [,name] of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name))return false;
      for(const [,k,v] of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)){
        const a=k==='data-id'?this.dataset.id:this.attrs[k];if(a==null||v!==undefined&&v!==a)return false;
      }
      return !!s;
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
      for(const n of path){event.currentTarget=n;for(const fn of n.events[type]||[])fn(event);if(event.stopped)break;}
      return event;
    }
    click(){assert.ok(!this.hidden&&!this.disabled);this.fire('click');}
    key(key){this.focus();const down=this.fire('keydown',{key});this.fire('keyup',{key});
      if(!down.defaultPrevented&&this.localName==='button'&&(key==='Enter'||key===' '))this.click();}
  }
  doc.createElement=t=>new Node(t);doc.createElementNS=(_,t)=>new Node(t);doc.documentElement=new Node('html');
  const host=new Node('section');doc.documentElement.append(host);
  const ui=H.create({host,pageCount:120,storage,onNavigate:(...args)=>requests.push(args)});
  const find=(label,base=host)=>base.find(n=>n.attrs['aria-label']===label);
  const button=(label,base)=>{const n=find(label,base);assert.ok(n,label);assert.equal(n.localName,'button');assert.ok(!n.disabled&&!n.hidden,label+' actionable inline');return n;};
  const row=id=>{const n=host.querySelector('.rh-item[data-id="'+id+'"]');assert.ok(n,id);return n;};
  return {host,ui,requests,doc,row,button,find,listeners};
}
test('ordinary history rail has no manage entry or dialog; each record owns three independent native buttons',()=>{
  const s=shelf();s.ui.start(loc(1));const a=s.ui.jump(loc(10,'3:1')),b=s.ui.jump(loc(20,'4:1'));
  assert.ok(!s.find('管理阅读记录'));assert.ok(!s.host.querySelector('dialog'));assert.ok(!s.host.querySelector('.rh-manage'));
  for(const e of [a,b]){
    const r=s.row(e.id),title='创世记 '+e.ref;
    const controls=['返回 ','置顶 ','删除 '].map(p=>s.button(p+title,r));
    assert.equal(r.children.filter(c=>c.localName==='button').length,3);
    assert.ok(controls.every(c=>c.parentElement===r));assert.deepEqual(controls.map(c=>c.attrs.tabindex??'0'),['0','0','0']);
    assert.equal(controls[1].attrs['aria-pressed'],'false');assert.equal(controls[0].dataset.id,e.id);
  }
  assert.equal(s.requests.length,0);s.ui.destroy();assert.equal(s.listeners.size,0);assert.equal(s.host.children.length,0);
});
test('inline resume emits id, page and exact anchor once; no writes before the navigation commits',()=>{
  const storage=memory(),s=shelf(storage);s.ui.start(loc(1));const a=s.ui.jump(loc(10,'3:1'));s.ui.jump(loc(20,'4:1'));
  const before=storage.getItem(H.KEY);s.button('返回 创世记 3:1').key('Enter');
  assert.deepEqual(s.requests,[[10,a.id,a]]);assert.equal(storage.getItem(H.KEY),before,'request is not a reading commit');
});
test('pin, unpin, delete and undo work directly by keyboard or touch; action clicks never bubble into a jump',()=>{
  const storage=memory(),s=shelf(storage);const a=s.ui.jump(loc(10,'3:1')),b=s.ui.jump(loc(20,'4:1'));
  const label='创世记 3:1',order=()=>s.ui.list().map(e=>e.id);
  assert.deepEqual(order(),[b.id,a.id]);assert.ok(!s.find('撤销上一次删除')||s.find('撤销上一次删除').hidden);
  s.button('置顶 '+label).key(' ');
  assert.equal(s.doc.activeElement,s.button('取消置顶 '+label));assert.equal(s.doc.activeElement.attrs['aria-pressed'],'true');
  assert.deepEqual(order(),[a.id,b.id]);assert.ok(model(storage).get(a.id).pinned);
  // No hover/open/focus setup on this item: the first tap is the action.
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
test('styles provide inline mouse hover, keyboard focus and a no-hover/coarse-pointer route',()=>{
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'reading-history.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.match(css,/\.rh-item:hover\b/,'hover reveals actions for one item, not the whole rail');
  const hover=css.split(/@media/).find(s=>/^\s*\(\s*hover\s*:\s*hover/.test(s)),touch=css.split(/@media/).find(s=>/^\s*[^{}]*(?:\(\s*hover\s*:\s*none\s*\)|\(\s*(?:any-)?pointer\s*:\s*coarse\s*\))/.test(s));
  assert.ok(hover&&touch,'provide both fine-pointer and no-hover/touch interactions');
  const modern=/@supports\s+selector\(:has\(:focus-visible\)\)\s*\{\s*\.rh-item:has\(:focus-visible\)\s+\.rh-action\s*\{([^}]*)\}\s*\}/;
  const fallback=/@supports\s+not\s+selector\(:has\(:focus-visible\)\)\s*\{\s*\.rh-item:focus-within\s+\.rh-action\s*\{([^}]*)\}\s*\}/;
  for(const [name,condition] of [['modern keyboard focus',modern],['legacy keyboard focus',fallback]]){
    const declarations=hover.match(condition)?.[1]||'';assert.match(declarations,/opacity\s*:\s*1/,name+' shows controls');
    assert.match(declarations,/pointer-events\s*:\s*auto/,name+' makes controls actionable');
  }
  assert.doesNotMatch(css.replace(fallback,''),/\.rh-item:focus-within\b/,'mouse-click focus must not leave the old row exposed after pointer exit on modern browsers');
  const hidden=hover.match(/\.rh-action\s*\{([^}]*)\}/)?.[1],reveal=hover.match(/\.rh-item:hover\s+\.rh-action[^{}]*\{([^}]*)\}/)?.[1];
  assert.match(hidden||'',/pointer-events\s*:\s*none/,'invisible desktop controls do not intercept clicks');
  assert.match(reveal||'',/pointer-events\s*:\s*auto/);
  const touchActions=touch.match(/\.rh-action\s*\{([^}]*)\}/)?.[1];
  assert.match(touchActions||'',/opacity\s*:\s*1/);assert.match(touchActions||'',/pointer-events\s*:\s*auto/,'first touch activates without hover emulation');
  assert.doesNotMatch(css,/\.rh-(?:manage|panel)(?:[\s,{:.#\[]|$)/,'no invisible old modal or manage button styling');
});
for(const [name,fn] of cases){fn();console.log('PASS '+name);}
console.log(JSON.stringify({historyScenarios:cases.length}));
