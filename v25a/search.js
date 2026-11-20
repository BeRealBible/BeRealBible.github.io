/* V25a: a local verse finder. No query is sent to a server. */
(function(root){
  'use strict';
  const norm=s=>s.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
  function catalogue(source,lookup){
    const rows=[],byBook=new Map();
    for(const b of source.books){
      for(const alias of [b.code,b.short,b.name])byBook.set(norm(alias),b.code);
      for(const ch of b.chapters)for(const [n,text] of ch.verses){
        const ref=ch.chapter+':'+n,page=lookup(b.code,ref);
        if(!Number.isInteger(page)||typeof text!=='string')continue;
        rows.push({book:b.name,code:b.code,ref,page,text,key:norm(text)});
      }
    }
    return raw=>{
      const q=norm(raw);
      if(!q)return [];
      const addr=/^(.+?)(\d+)(?:章|:)(\d+)节?$/.exec(q);
      if(addr&&byBook.has(addr[1]))return rows.filter(r=>r.code===byBook.get(addr[1])&&r.ref===+addr[2]+':'+(+addr[3]));
      return rows.filter(r=>r.key.includes(q));
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={catalogue};return;}
  root.mountVerseFinder=({navigate,interrupt,origin,restore,camera})=>{
    const $=id=>document.getElementById(id),panel=$('verse-finder'),tab=$('vf-tab'),input=$('vf-input'),list=$('vf-list'),scroll=$('vf-scroll'),stage=$('stage'),more=$('vf-more');
    stage.parentElement.append(panel,tab); // A sibling of the gesture surface; the book remains interactive.
    const key='paper:v25a:slip:1',clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const trigger=document.createElement('button');trigger.className='rh-toggle';trigger.type='button';trigger.title='搜索经文（Ctrl / ⌘ + K）';trigger.setAttribute('aria-label','搜索经文');
    trigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>';
    document.querySelector('.rh-rail').prepend(trigger);
    for(const el of [trigger,tab])el.setAttribute('aria-controls',panel.id);
    let mode='off',start=null,lookup,results=[],seen=new Set(),current=-1,anchor=null,q='',timer,saveTimer,geom='',wide=false;
    // Anchor a row, not raw scrollTop: wrapping and line counts vary by width.
    function remember(i){
      if(panel.hidden||!list.children.length)return;
      const top=scroll.scrollTop,bottom=top+scroll.clientHeight,rows=list.children;
      let r=rows[i??current];
      if(!r||r.offsetTop<top||r.offsetTop>=bottom){
        let lo=0,hi=rows.length-1;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].offsetTop+rows[m].offsetHeight<=top)lo=m+1;else hi=m;}r=rows[lo];
      }
      anchor={i:+r.dataset.i,dy:r.offsetTop-top};
    }
    let restoredTop=-1;
    function restoreRow(){const r=list.children[anchor?.i];if(r&&!panel.hidden){scroll.scrollTop=r.offsetTop-anchor.dy;restoredTop=scroll.scrollTop;}}
    new ResizeObserver(()=>{if(!panel.hidden)restoreRow();}).observe(list);
    function persist(){
      clearTimeout(saveTimer);
      try{if(mode==='off')sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify({mode,start,q,current,seen:[...seen],anchor,count:list.children.length}));}catch{}
    }
    function layout(){
      const c=camera();if(!c.w||!c.h)return;
      const next=c.w>=640,z=clamp(.80+.22*c.scale,.91,1.19),w=Math.min(next?306:285,(next?c.w/2-12:c.w-18)/z),
        avail=Math.min(c.h,root.visualViewport?.height||c.h),height=Math.max(145,Math.min((avail-22)/z,next?432:342)),
        show=mode==='browse'||(mode==='read'&&next),g=[next,w,height,z].join(':');
      if(!anchor&&!panel.hidden)remember();
      const hitX=mode==='read'&&next?c.inkX():null;
      const wasHidden=panel.hidden,side=(hitX!==null?hitX<c.w/2:c.side===0)?'right':'left',edge=side==='right'?c.x+960*c.scale:c.x;
      panel.hidden=!show;tab.hidden=mode==='off'||show;panel.dataset.layout=next?'wide':'narrow';
      trigger.setAttribute('aria-expanded',String(show));tab.setAttribute('aria-expanded',String(show));
      if(show){
        panel.style.width=w+'px';panel.style.maxHeight=height+'px';panel.style.transform='scale('+z+')';
        const pref=side==='right'?edge-9:edge-w*z+9;
        panel.style.left=clamp(pref,8,c.w-w*z-8)+'px';
        panel.style.top=clamp(c.y+72*c.scale,8,avail-panel.offsetHeight*z-8)+'px';
        if(g!==geom||wasHidden)restoreRow();
      }else if(!tab.hidden){
        tab.style.left=clamp(side==='right'?edge-6:edge-tab.offsetWidth+6,4,c.w-tab.offsetWidth-4)+'px';
        tab.style.top=clamp(c.y+112*c.scale,16,c.h-tab.offsetHeight-18)+'px';
      }
      geom=g;wide=next;
    }
    function setMode(next){
      if(!panel.hidden)remember();
      mode=next;layout();persist();
    }
    function open(edit=false){
      if(document.querySelector('dialog[open]'))return;
      if(mode==='off'){start=origin();edit=true;}
      interrupt();root.PaperImmersion?.hideChrome();setMode('browse');
      if(edit)input.focus({preventScroll:true});else $('vf-close').focus({preventScroll:true});
    }
    function tuck(){if(!panel.hidden){input.blur();setMode('tucked');stage.focus({preventScroll:true});}}
    trigger.onclick=()=>open();tab.onclick=()=>open();$('vf-close').onclick=tuck;
    $('vf-origin').onclick=()=>{if(start){tuck();restore(start);}};
    $('vf-end').onclick=()=>{setMode('off');start=null;input.value='';refresh(true);stage.focus({preventScroll:true});};
    stage.addEventListener('pointerdown',()=>{if(!panel.hidden)tuck();},true);
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();open(true);}
      else if(e.key==='Escape'&&!panel.hidden){e.preventDefault();tuck();}
    });
    scroll.addEventListener('scroll',()=>{if(!panel.hidden&&Math.abs(scroll.scrollTop-restoredTop)>.5){remember();restoredTop=-1;clearTimeout(saveTimer);saveTimer=setTimeout(persist,100);}});
    function decorate(b,i){b.toggleAttribute('data-seen',seen.has(i));if(i===current)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}
    function append(count=24){
      const from=list.children.length;
      for(let i=from;i<Math.min(results.length,from+count);i++){
        const r=results[i],b=document.createElement('button'),ref=document.createElement('strong'),excerpt=document.createElement('span');
        b.type='button';b.dataset.i=i;ref.textContent=r.book+' '+r.ref;
        const at=r.text.indexOf(q);
        if(at>=0&&q){const mark=document.createElement('mark');mark.textContent=q;excerpt.append(r.text.slice(0,at),mark,r.text.slice(at+q.length));}
        else excerpt.textContent=r.text;
        b.append(ref,excerpt);decorate(b,i);b.onclick=()=>{
          const prev=current;current=i;seen.add(i);if(list.children[prev])decorate(list.children[prev],prev);decorate(b,i);
          remember(i);input.blur();setMode('read');
          navigate(r.page,{bookCode:r.code,ref:r.ref,search:true});
          if(!wide)stage.focus({preventScroll:true});layout();persist();
        };list.append(b);
      }
      more.hidden=list.children.length>=results.length;
    }
    function refresh(force=false){
      clearTimeout(timer);const next=input.value.trim();if(next===q&&!force)return;
      q=next;current=-1;seen.clear();anchor=null;$('vf-examples').hidden=!!q;
      if(q&&!lookup)lookup=catalogue(root.BIBLE_SOURCE,(c,r)=>root.V25OriginalData.lookup(c,r));
      results=q?lookup(q):[];list.replaceChildren();scroll.scrollTop=0;append();
      $('vf-status').textContent=q?(results.length?'共 '+results.length+' 节 · 点一节试读':'未找到，试试更短的词或章节目次'):'按经文片语或章节目次查找';
      layout();persist();
    }
    input.addEventListener('input',e=>{clearTimeout(timer);if(!e.isComposing)timer=setTimeout(()=>refresh(),100);});
    input.addEventListener('compositionend',()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(),100);});
    $('vf-form').onsubmit=e=>{e.preventDefault();refresh();input.blur();list.firstElementChild?.focus();};
    more.onclick=()=>{append();persist();};$('vf-examples').onclick=e=>{if(e.target.tagName==='BUTTON'){input.value=e.target.textContent;refresh();}};
    // Browsing is intentional even if a previous result is still marked.
    panel.addEventListener('pointerdown',()=>{if(mode==='read')setMode('browse');});
    panel.addEventListener('wheel',()=>{if(mode==='read')setMode('browse');},{passive:true});
    panel.addEventListener('touchmove',()=>{if(mode==='read')setMode('browse');},{passive:true});
    input.addEventListener('focus',()=>{if(mode==='read')setMode('browse');});
    root.visualViewport?.addEventListener('resize',layout);
    root.addEventListener('pagehide',()=>{remember();persist();});
    let stored;try{stored=JSON.parse(sessionStorage.getItem(key));}catch{}
    refresh(true);
    if(stored?.start&&['browse','read','tucked'].includes(stored.mode)){
      start=stored.start;input.value=stored.q;refresh(true);current=stored.current;seen=new Set(stored.seen);
      append(Math.max(0,stored.count-list.children.length));Array.from(list.children).forEach(decorate);
      anchor=stored.anchor;mode=stored.mode;layout();persist();
    }
    return {layout};
  };
})(typeof window!=='undefined'?window:globalThis);
