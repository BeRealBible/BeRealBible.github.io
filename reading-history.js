/* Each deliberate jump starts (or resumes) a trail. Only committed turns
 * advance its endpoint; ordinary viewing, zoom and speculative animations do not. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperReadingHistory=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const KEY='paper-bible-reading-history-v1',MAX_RECENT=24;
  const clean=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
  const copy=e=>e?{...e}:null;
  function location(v,pageCount){
    if(!v||!Number.isSafeInteger(v.page)||v.page<0||v.page>=pageCount)return null;
    const bookName=clean(v.bookName,60),bookCode=clean(v.bookCode,12),ref=clean(v.ref,32);
    return {page:v.page,bookName,bookCode,ref};
  }
  const same=(a,b)=>a.page===b.page&&a.ref===b.ref&&(a.bookCode&&b.bookCode?a.bookCode===b.bookCode:a.bookName===b.bookName);
  const validId=id=>typeof id==='string'&&/^r[0-9]+$/.test(id)&&Number.isSafeInteger(Number(id.slice(1)));
  const fresh=()=>({version:1,activeId:null,serial:0,items:[]});
  function decode(raw,pageCount){
    let data;try{data=JSON.parse(raw);}catch{return fresh();}
    if(data?.version!==1||!Array.isArray(data.items))return fresh();
    const s=fresh(),seen=new Set();
    for(const item of data.items){
      const loc=location(item,pageCount);if(!loc||!validId(item.id)||seen.has(item.id))continue;
      seen.add(item.id);s.items.push({...loc,id:item.id,pinned:item.pinned===true});
      s.serial=Math.max(s.serial,Number(item.id.slice(1)));
    }
    if(Number.isSafeInteger(data.serial)&&data.serial>=s.serial)s.serial=data.serial;
    if(seen.has(data.activeId))s.activeId=data.activeId;
    return s;
  }
  function createModel({storage,pageCount}){
    let raw=null,state=fresh(),current=null,removed=null;
    const find=id=>state.items.find(e=>e.id===id);
    function pull(){
      let next;try{next=storage?.getItem(KEY)??null;}catch{return;}
      if(next===raw)return;
      raw=next;state=decode(next,pageCount);
      if(current&&!find(current))current=null;
    }
    function save(){
      const encoded=JSON.stringify(state);if(encoded===raw)return;
      try{if(storage?.setItem){storage.setItem(KEY,encoded);raw=encoded;}}catch{/* private/locked stores still work for this session */}
    }
    function touch(e){state.items=[e,...state.items.filter(other=>other.id!==e.id)];}
    function trim(keep){
      const retained=new Set([current,keep].filter(id=>{const e=find(id);return e&&!e.pinned;}));
      for(const e of state.items)if(!e.pinned&&retained.size<MAX_RECENT)retained.add(e.id);
      state.items=state.items.filter(e=>e.pinned||retained.has(e.id));
    }
    function list(){pull();return [...state.items.filter(e=>e.pinned),...state.items.filter(e=>!e.pinned)].map(copy);}
    pull();
    function start(loc){
      pull();loc=location(loc,pageCount);if(!loc)return;
      // Refreshes often supply the first verse on a physical page, not the
      // selected chapter on that page. Do not overwrite its more exact anchor.
      const active=find(state.activeId);
      current=active?(active.page===loc.page?active.id:state.items.find(e=>same(e,loc))?.id||null):null;
      return copy(find(current));
    }
    function advance(loc){
      pull();loc=location(loc,pageCount);const e=find(current);if(!e||!loc)return null;
      if(same(e,loc)&&state.activeId===current)return copy(e);
      Object.assign(e,loc);state.activeId=e.id;touch(e);save();return copy(e);
    }
    function jump(loc,requestedId){
      pull();loc=location(loc,pageCount);if(!loc)return null;
      let e;
      if(requestedId!=null){
        e=find(requestedId);
        // Removing a line while its page-turn animation is pending must not
        // recreate it, or start moving the line that we just navigated away from.
        if(!e){current=null;state.activeId=null;save();return null;}
      }else e=state.items.find(record=>same(record,loc));
      if(!e){e={...loc,id:'r'+(++state.serial),pinned:false};}
      else Object.assign(e,loc);
      current=state.activeId=e.id;touch(e);trim();save();return copy(e);
    }
    function pin(id,on){
      pull();const e=find(id);if(!e)return false;
      e.pinned=on===undefined?!e.pinned:!!on;trim(id);save();return true;
    }
    function remove(id){
      pull();const index=state.items.findIndex(e=>e.id===id);if(index<0)return false;
      const [e]=state.items.splice(index,1);
      removed={entry:copy(e),index};if(current===id)current=null;
      if(state.activeId===id)state.activeId=null;
      save();return true;
    }
    function undo(){
      pull();if(!removed)return false;const {entry,index}=removed;removed=null;
      if(find(entry.id))return false;
      state.items.splice(Math.min(index,state.items.length),0,entry);trim(entry.id);save();
      return true; // Restore the record, not the reading position.
    }
    return {start,advance,jump,list,pin,remove,undo,get:id=>{pull();return copy(find(id));},
      current:()=>{pull();return current;},canUndo:()=>Boolean(removed)};
  }
  function label(e){return (e.bookName||e.bookCode||'书页')+(e.ref?' '+e.ref:(!e.bookName&&!e.bookCode?' '+(e.page+1):''));}
  function create({host,storage,pageCount,onNavigate}){
    if(!host?.ownerDocument||typeof onNavigate!=='function')throw TypeError('History needs a shelf host and navigation callback');
    const doc=host.ownerDocument,model=createModel({storage,pageCount}),win=doc.defaultView;
    const shell=host.closest('.reader');
    const el=(tag,cls,txt)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(txt)n.textContent=txt;return n;};
    const button=(cls,txt,title,fn)=>{const b=el('button',cls,txt);b.type='button';b.setAttribute('aria-label',title);b.title=title;b.addEventListener('click',fn);return b;};
    const shelf=el('div','rh-rail'),caption=el('span','rh-caption','最近跳转'),track=el('div','rh-track');
    track.setAttribute('role','group');track.setAttribute('aria-label','最近阅读位置');
    const status=el('span','rh-sr');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    let controls=new Map(),removedId=null;
    const undoButton=button('rh-undo','撤销','撤销上一次删除',()=>{
      const id=removedId;removedId=null;const ok=model.undo();render();
      if(ok){status.textContent='已恢复记录';focusControl(id,'chip');}
    });
    shelf.append(caption,track,undoButton,status);
    host.append(shelf);shell?.classList.add('has-history-shelf');doc.documentElement.classList.add('paper-history-on');
    function navigate(id){
      const e=model.get(id);if(!e){render();return;}
      onNavigate(e.page,e.id,e);
    }
    function focusControl(id,action){
      const ctl=controls.get(id)?.[action];if(!ctl)return;
      ctl.focus({preventScroll:true});
      // Scroll this track only, not the stage or the document. Include both
      // action slots even for the end item when focus moves after reordering.
      const box=controls.get(id).item.getBoundingClientRect?.(),viewport=track.getBoundingClientRect?.();
      if(!box||!viewport)return;
      if(box.right>viewport.right)track.scrollLeft+=box.right-viewport.right+2;
      else if(box.left<viewport.left)track.scrollLeft+=box.left-viewport.left-2;
    }
    function render(){
      const items=model.list(),active=model.current(),scroll=track.scrollLeft;
      const prev=doc.activeElement;let restore=null;
      if(prev)for(const [id,row] of controls)for(const key of ['chip','pin','del'])if(prev===row[key])restore=[id,key];
      track.replaceChildren();controls=new Map();
      if(!items.length)track.appendChild(el('span','rh-empty','暂无记录'));
      for(const e of items){
        const name=label(e),item=el('div','rh-item');item.dataset.id=e.id;
        item.setAttribute('role','group');item.setAttribute('aria-label',name);
        const chip=button('rh-chip',name,'返回 '+name,()=>navigate(e.id));chip.dataset.id=e.id;
        if(e.pinned){item.dataset.pinned='true';chip.title='已置顶 · '+name;}
        if(e.id===active){item.dataset.current='true';chip.setAttribute('aria-current','page');}
        const pin=button('rh-action rh-pin','',(e.pinned?'取消置顶 ':'置顶 ')+name,()=>{
          if(!model.pin(e.id,!e.pinned)){render();return;}
          status.textContent=(e.pinned?'已取消置顶 ':'已置顶 ')+name;render();focusControl(e.id,'pin');
        });
        // Icons are fixed local markup, never interpolated scripture/storage.
        pin.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g transform="rotate(32 8 8)"><path class="rh-pin-head" d="M5 2.1h6l-1 1.4v3.2l1.8 2H4.2l1.8-2V3.5z"/><path d="M8 8.9v5.2"/></g></svg>';
        pin.setAttribute('aria-pressed',String(e.pinned));
        const del=button('rh-action rh-delete','','删除 '+name,()=>{
          if(model.remove(e.id)){
            removedId=e.id;status.textContent='已删除 '+name+'，可撤销';render();undoButton.focus({preventScroll:true});
          }
        });
        del.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4.3 4.3 7.4 7.4m0-7.4-7.4 7.4"/></svg>';
        item.append(chip,pin,del);track.appendChild(item);controls.set(e.id,{item,chip,pin,del});
      }
      track.scrollLeft=scroll;undoButton.hidden=!model.canUndo();
      if(restore)focusControl(...restore);
    }
    const sync=e=>{if(!e.key||e.key===KEY||e.key.startsWith(KEY+':'))render();};
    win?.addEventListener('storage',sync);render();
    const apply=(name,...args)=>{const result=model[name](...args);render();return result;};
    return {start:loc=>apply('start',loc),advance:loc=>apply('advance',loc),jump:(loc,id)=>apply('jump',loc,id),
      list:model.list,element:host,
      destroy(){win?.removeEventListener('storage',sync);host.replaceChildren();controls.clear();shell?.classList.remove('has-history-shelf');doc.documentElement.classList.remove('paper-history-on');}};
  }
  return {KEY,MAX_RECENT,createModel,create,label};
});
