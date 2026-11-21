/* V25: a local verse finder. No query is sent to a server. */
(function(root){
  'use strict';
  const words=typeof module==='object'&&module.exports?require('./words.js'):root.V25Words,norm=words.key,limit=500;
  const groups={
    '摩西五经':'GEN EXO LEV NUM DEU','历史书':'JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST',
    '诗歌智慧书':'JOB PSA PRO ECC SNG','大先知书':'ISA JER LAM EZK DAN','小先知书':'HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL',
    '四福音书':'MAT MRK LUK JHN','使徒行传':'ACT','保罗书信':'ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM',
    '希伯来书':'HEB','普通书信':'JAS 1PE 2PE 1JN 2JN 3JN JUD','启示录':'REV'
  };
  const category=new Map(Object.entries(groups).flatMap(([group,codes])=>codes.split(' ').map(code=>[code,group])));
  function catalogue(source,lookup,scripture){
    const rows=[],byBook=new Map();
    for(const b of source.books){
      for(const alias of [b.code,b.short,b.name])byBook.set(norm(alias),b.code);
      if(scripture){
        for(const r of scripture.index(b.code).rows)rows.push({book:b.name,code:b.code,ref:r.ref,page:r.page,text:r.text,key:norm(r.text),display:r.display});
        continue;
      }
      for(const ch of b.chapters)for(const [n,text] of ch.verses){
        const ref=ch.chapter+':'+n,page=lookup(b.code,ref);
        if(!Number.isInteger(page)||typeof text!=='string')continue;
        rows.push({book:b.name,code:b.code,ref,page,text,key:norm(text)});
      }
    }
    return (raw,scope="all")=>{
      const q=norm(raw);
      if(!q)return [];
      const addr=/^(.+?)(\d+)(?:章|:)(\d+)节?$/.exec(q);
      const book=addr&&byBook.get(addr[1]),ref=book&&(+addr[2]+':'+(+addr[3]));
      const target=book&&(scripture?.resolve({code:book,ref})[0]?.ref||ref);
      const result=[],need=book?[]:words.terms(raw);
      for(const r of rows){
        if(scope!=='all'&&scope!=='book:'+r.code&&scope!==category.get(r.code))continue;
        if(book?!(r.code===book&&r.ref===target):!words.ordered(r.key,need))continue;
        if(result.length===limit){result.truncated=true;break;}result.push(r);
      }
      result.terms=need;return result;
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={catalogue,groups};return;}
  root.mountVerseFinder=({navigate,interrupt,origin,restore,camera,scripture,windows})=>{
    const $=id=>document.getElementById(id),panel=$('verse-finder'),tab=$('vf-tab'),input=$('vf-input'),list=$('vf-list'),scroll=$('vf-scroll'),stage=$('stage'),more=$('vf-more');
    stage.parentElement.append(panel,tab); // A sibling of the gesture surface; the book remains interactive.
    const key='paper:v25:slip:1',clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const trigger=document.createElement('button');trigger.className='rh-toggle';trigger.type='button';trigger.title='搜索经文（Ctrl / ⌘ + K）';trigger.setAttribute('aria-label','搜索经文');
    trigger.append(tab.querySelector('svg').cloneNode(true));
    document.querySelector('.rh-rail').prepend(trigger);
    for(const el of [trigger,tab])el.setAttribute('aria-controls',panel.id);
    let mode='off',start=null,lookup,results=[],seen=new Set(),current=-1,anchor=null,q='',timer,saveTimer,geom='',wide=false;
    let scope='all',trails={};
    const groupButton=$('vf-group'),choices=$('vf-groups'),allButton=$('vf-all'),bookButton=$('vf-book'),bookNames=new Map(root.BIBLE_SOURCE.books.map(b=>[b.code,b.name]));
    for(const name of Object.keys(groups)){
      const b=document.createElement('button');b.type='button';b.textContent=name;
      b.onclick=()=>{closeGroups(true);switchScope(name);};choices.append(b);
    }
    function closeGroups(focus=false){
      if(choices.hidden)return;
      choices.hidden=true;scroll.hidden=false;groupButton.setAttribute('aria-expanded','false');
      layout();restoreRow();if(focus)groupButton.focus({preventScroll:true});
    }
    groupButton.onclick=()=>{
      if(!choices.hidden){closeGroups(true);return;}
      remember();choices.hidden=false;scroll.hidden=true;groupButton.setAttribute('aria-expanded','true');layout();
      (choices.querySelector('[aria-pressed=true]')||choices.firstChild).focus({preventScroll:true});
    };
    choices.addEventListener('keydown',e=>{
      const keys={ArrowRight:1,ArrowLeft:-1,ArrowDown:2,ArrowUp:-2},items=[...choices.children];
      if(Object.hasOwn(keys,e.key)){e.preventDefault();items[(items.indexOf(e.target)+keys[e.key]+items.length)%items.length].focus();}
    });
    input.addEventListener('focus',()=>closeGroups());
    function scopeUI(){
      const local=scope.startsWith('book:'),code=local?scope.slice(5):origin().bookCode;
      allButton.setAttribute('aria-pressed',String(scope==='all'));bookButton.setAttribute('aria-pressed',String(local));
      bookButton.textContent=local?(bookNames.get(code)||'本卷'):'本卷';
      bookButton.title='只搜'+(bookNames.get(code)||'当前书卷');bookButton.setAttribute('aria-label',bookButton.title);
      const grouped=Object.hasOwn(groups,scope);groupButton.textContent=grouped?scope:'分类';groupButton.toggleAttribute('data-current',grouped);
      for(const b of choices.children)b.setAttribute('aria-pressed',String(b.textContent===scope));
    }
    const trail=()=>({current,seen:[...seen],anchor,count:list.children.length});
    function applyTrail(t){
      if(!t)return;
      current=results[t.current]?t.current:-1;seen=new Set((t.seen||[]).filter(i=>results[i]));append(Math.max(0,t.count-list.children.length));Array.from(list.children).forEach(decorate);
      anchor=results[t.anchor?.i]?t.anchor:null;restoreRow();
    }
    function switchScope(next){
      if(q!==input.value.trim())refresh();
      if(scope===next)return;
      remember();trails[scope]=trail();scope=next;mode='browse';refresh(true);applyTrail(trails[next]);scopeUI();layout();persist();
    }
    allButton.onclick=()=>{closeGroups();switchScope('all');};
    bookButton.onclick=()=>{closeGroups();switchScope('book:'+origin().bookCode);};
    // Anchor a row, not raw scrollTop: wrapping and line counts vary by width.
    function remember(i){
      if(mode==='preview'||panel.hidden||scroll.hidden||!list.children.length)return;
      const top=scroll.scrollTop,bottom=top+scroll.clientHeight,rows=list.children;
      let r=rows[i??current];
      if(!r||r.offsetTop<top||r.offsetTop>=bottom){
        let lo=0,hi=rows.length-1;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].offsetTop+rows[m].offsetHeight<=top)lo=m+1;else hi=m;}r=rows[lo];
      }
      anchor={i:+r.dataset.i,dy:r.offsetTop-top};
    }
    let restoredTop=-1,restoredBox="";
    const boxKey=()=>[scroll.clientWidth,scroll.clientHeight,list.offsetHeight].join("/");
    function restoreRow(){const r=list.children[anchor?.i];if(r&&mode!=='preview'&&!panel.hidden&&!scroll.hidden){scroll.scrollTop=r.offsetTop-anchor.dy;restoredTop=scroll.scrollTop;restoredBox=boxKey();}}
    new ResizeObserver(()=>{if(!panel.hidden)restoreRow();}).observe(list);
    function persist(){
      clearTimeout(saveTimer);
      try{if(mode==='off')sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify({mode,start,q,scope,trails,...trail()}));}catch{}
    }
    let mount=null;
    function layout(){
      const c=camera();if(!c.w||!c.h)return;
      const next=c.w>=640,vv=root.visualViewport,margin=4,
        side=c.side===0?'right':'left',right=side==='right',
        rawX=c.x+(right?960:0)*c.scale,rawY=c.y+72*c.scale;
      // On mobile the IME may resize just the visual viewport, resize the
      // stage itself, or pan the visual viewport to the focused field.
      const stageTop=next?0:stage.getBoundingClientRect().top,
        visibleTop=next?0:clamp((vv?.offsetTop||0)-stageTop,0,c.h),
        visibleBottom=next?Math.min(c.h,vv?.height||c.h):
          clamp(vv?vv.offsetTop+vv.height-stageTop:c.h,visibleTop,c.h),
        avail=visibleBottom-visibleTop;
      if(avail<=2*margin)return;
      if(mode==='off')mount=null;
      else if(!mount||mount.side!==side||mount.wide!==next){
        // Pick a point on visible paper once. Store it in book units, never
        // re-pin an open desktop slip to the viewport while the camera moves.
        const onSheet=(raw,base,size,limit)=>clamp((clamp(raw,margin,limit-margin)-base)/c.scale,0,size);
        mount={side,wide:next,bx:onSheet(rawX,c.x,960,c.w),by:onSheet(rawY-visibleTop,c.y-visibleTop,704,avail)};
      }
      const hx=c.x+(mount?.bx??(right?960:0))*c.scale,hy=c.y+(mount?.by??72)*c.scale;
      const px=next?hx:clamp(hx,margin,c.w-margin),py=next?hy:clamp(hy,visibleTop+margin,visibleBottom-margin);
      const roomRight=c.w-margin-px,roomLeft=px-margin;
      const toRight=roomRight>=roomLeft,below=visibleBottom-margin-py,above=py-visibleTop-margin;
      const down=below>=above,roomW=Math.max(1,toRight?roomRight:roomLeft),roomH=Math.max(1,down?below:above);
      const z=next?c.scale:Math.min(c.scale,1.15,roomW/147,roomH/120);
      const w=Math.min(next?306:233,roomW/z,next?(c.w/2-10)/z:c.w*.71/z),
        height=Math.min(next?432:(mode==='browse'&&results.length?280:242),roomH/z),
        show=mode==='browse'||(mode==='read'&&next),g=[next,w,height,z].join(':');
      if(!anchor&&!panel.hidden)remember();
      const wasHidden=panel.hidden;
      panel.hidden=!show;tab.hidden=mode==='off'||mode==='preview'||show;panel.dataset.layout=next?'wide':'narrow';
      trigger.setAttribute('aria-expanded',String(show));tab.setAttribute('aria-expanded',String(show));
      function place(node,scale){
        node.dataset.dockX=px;node.dataset.dockY=py;node.dataset.paperX=mount.bx;node.dataset.paperY=mount.by;
        node.style.transformOrigin=(toRight?'left':'right')+' '+(down?'top':'bottom');
        node.style.transform='scale('+scale+')';
        node.style.left=(toRight?px:px-node.offsetWidth)+'px';
        node.style.top=(down?py:py-node.offsetHeight)+'px';
      }
      if(show){
        panel.style.width=w+'px';panel.style.maxHeight=height+'px';panel.toggleAttribute('data-compact',height<242||w<155);place(panel,z);
        if(g!==geom||wasHidden)restoreRow();
      }else if(!tab.hidden){
        place(tab,root.V25PaperDock.sizeScale(c.scale,!next,roomW,roomH,tab.offsetWidth,tab.offsetHeight));
      }
      geom=g;wide=next;
    }
    function setMode(next){
      if(next!=='browse')closeGroups();
      if(!panel.hidden)remember();
      mode=next;
      if(next!=='preview'&&windows.preview.is('search'))windows.preview.close('screen');
      layout();persist();
    }
    function open(edit=false){
      if(document.querySelector('dialog[open]'))return;
      if(mode==='off'){start=origin();edit=true;}
      else if(mount&&trigger===document.activeElement){
        const c=camera(),hx=c.x+mount.bx*c.scale,hy=c.y+mount.by*c.scale;
        if(hx<0||hx>c.w||hy<0||hy>c.h)mount=null;
      }
      scopeUI();interrupt();root.PaperImmersion?.hideChrome();setMode('browse');
      if(edit)input.focus({preventScroll:true});else if(current>=0&&anchor?.i===current)landOnResult();else $('vf-close').focus({preventScroll:true});
    }
    function tuck(){if(!panel.hidden){input.blur();setMode('tucked');stage.focus({preventScroll:true});}}
    trigger.onclick=()=>open();tab.onclick=()=>open();$('vf-close').onclick=tuck;
    $('vf-origin').onclick=()=>{if(start){tuck();restore(start);}};
    $('vf-end').onclick=()=>{setMode('off');start=null;scope='all';trails={};scopeUI();input.value='';refresh(true);stage.focus({preventScroll:true});};
    root.V25PaperDock.onTap(stage,()=>{if(mode==='preview')backToResults();else if(!panel.hidden)tuck();});
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();open(true);}
      else if(e.key==='Escape'&&!panel.hidden){e.preventDefault();if(mode==='preview')backToResults();else if(!choices.hidden)closeGroups(true);else tuck();}
    });
    scroll.addEventListener('scroll',()=>{if(!panel.hidden&&restoredBox&&boxKey()!==restoredBox){restoreRow();return;}if(!panel.hidden&&wide===(stage.clientWidth>=640)&&Math.abs(scroll.scrollTop-restoredTop)>.5){remember();restoredTop=-1;clearTimeout(saveTimer);saveTimer=setTimeout(persist,100);}});
    function decorate(b,i){b.toggleAttribute('data-seen',seen.has(i));if(i===current)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}
    function landOnResult(focus=true){
      const b=list.children[current];if(!b||panel.hidden)return;
      restoreRow();
      if(b.offsetTop+b.offsetHeight<=scroll.scrollTop||b.offsetTop>=scroll.scrollTop+scroll.clientHeight){
        scroll.scrollTop=b.offsetTop;remember(current);
      }
      if(focus)b.focus({preventScroll:true});
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
        b.animate([{backgroundColor:'#e7c894',boxShadow:'inset 3px 0 #906634'},{backgroundColor:'#dfcda84a',boxShadow:'inset 2px 0 #9b7447'}],{duration:650,easing:'ease-out'});
      }
    }
    function backToResults(){setMode('browse');landOnResult();persist();}
    function previewResult(i,focus=true){
      const r=results[i],b=list.children[i];if(!r||!b)return;
      const prev=current;current=i;seen.add(i);if(list.children[prev])decorate(list.children[prev],prev);decorate(b,i);
      if(focus){input.blur();remember(i);}
      const keywords=results.terms;
      const opened=windows.openPreview([{code:r.code,ref:r.ref}],{
        kind:'search',label:'搜索命中经文',ariaLabel:'搜索结果经文浮窗',keywords,focus,onBack:true,
        onClose:reason=>{
          if(mode!=='preview'||reason==='screen')return;
          if(reason==='back'||reason==='dismiss')backToResults();
          else setMode(reason==='pin'?'tucked':'browse');
        },
        onJump:loc=>{
          if(!Number.isInteger(loc.page))return;
          setMode('read');navigate(loc.page,{bookCode:loc.code,ref:loc.ref,search:true,keywords});
          layout();if(wide)landOnResult(false);stage.focus({preventScroll:true});persist();
        }
      });
      if(!opened)return;
      mode='preview';layout();persist();
    }
    function append(count=24){
      const from=list.children.length;
      for(let i=from;i<Math.min(results.length,from+count);i++){
        const r=results[i],b=document.createElement('button'),ref=document.createElement('strong'),excerpt=document.createElement('span');
        b.type='button';b.dataset.i=i;ref.textContent=r.book+' '+(r.display||r.ref);
        words.paint(excerpt,r.text,results.terms);
        b.append(ref,excerpt);decorate(b,i);b.onclick=()=>previewResult(i);list.append(b);
      }
      more.hidden=list.children.length>=results.length;
    }
    function refresh(force=false){
      clearTimeout(timer);const next=input.value.trim();if(next===q&&!force)return;
      if(q!==next)trails={};q=next;current=-1;seen.clear();anchor=null;
      if(q&&!lookup)lookup=catalogue(root.BIBLE_SOURCE,(c,r)=>root.V25OriginalData.lookup(c,r),scripture);
      results=q?lookup(q,scope):[];list.replaceChildren();scroll.scrollTop=0;append();
      $('vf-status').textContent=q?(results.truncated?'仅显示前 '+limit+' 节':results.length?results.length+' 节':'未找到经文'):'';
      layout();persist();
    }
    input.addEventListener('input',e=>{clearTimeout(timer);if(!e.isComposing)timer=setTimeout(()=>refresh(),100);});
    input.addEventListener('compositionend',()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(),100);});
    $('vf-form').onsubmit=e=>{e.preventDefault();refresh();input.blur();list.firstElementChild?.focus();};
    more.onclick=()=>{append();persist();};
    // Browsing is intentional even if a previous result is still marked.
    panel.addEventListener('pointerdown',()=>{if(mode==='read')setMode('browse');});
    panel.addEventListener('wheel',()=>{if(mode==='read')setMode('browse');},{passive:true});
    panel.addEventListener('touchmove',()=>{if(mode==='read')setMode('browse');},{passive:true});
    input.addEventListener('focus',()=>{if(mode==='read')setMode('browse');});
    root.visualViewport?.addEventListener('resize',layout);
    root.visualViewport?.addEventListener('scroll',layout,{passive:true});
    root.addEventListener('pagehide',()=>{remember();persist();});
    let stored;try{stored=JSON.parse(sessionStorage.getItem(key));}catch{}
    refresh(true);
    if(stored?.start&&['browse','preview','read','tucked'].includes(stored.mode)){
      start=stored.start;scope=stored.scope||'all';input.value=stored.q;refresh(true);trails=stored.trails||{};applyTrail(stored);mode=stored.mode;scopeUI();layout();persist();
      if(mode==='preview'){if(current>=0)previewResult(current,false);else setMode('browse');}
    }
    return {layout};
  };
})(typeof window!=='undefined'?window:globalThis);
