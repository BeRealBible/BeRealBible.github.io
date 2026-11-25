/* V25: a local verse finder. No query is sent to a server. */
(function(root){
  'use strict';
  const words=typeof module==='object'&&module.exports?require('./words.js'):root.V25Words,norm=words.key,limit=500;
  const groups=Object.freeze({
    '摩西五经':'GEN EXO LEV NUM DEU','历史书':'JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST',
    '诗歌智慧书':'JOB PSA PRO ECC SNG','大先知书':'ISA JER LAM EZK DAN','小先知书':'HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL',
    '四福音书':'MAT MRK LUK JHN','使徒行传':'ACT','保罗书信':'ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM',
    '希伯来书':'HEB','普通书信':'JAS 1PE 2PE 1JN 2JN 3JN JUD','启示录':'REV'
  });
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
    return (raw,scope="all",{keywordsOnly=false}={})=>{
      const q=norm(raw);
      if(!q)return [];
      const addr=!keywordsOnly&&/^(.+?)(\d+)(?:章|:)(\d+)节?$/.exec(q);
      const book=addr&&byBook.get(addr[1]),ref=book&&(+addr[2]+':'+(+addr[3]));
      const target=book&&(scripture?.resolve({code:book,ref})[0]?.ref||ref);
      const result=[],need=book?[]:words.terms(raw),allowed=Array.isArray(scope)?new Set(scope):null;
      for(const r of rows){
        if(allowed?!allowed.has(r.code):scope!=='all'&&scope!=='book:'+r.code&&scope!==category.get(r.code))continue;
        if(book?!(r.code===book&&r.ref===target):!words.ordered(r.key,need))continue;
        if(result.length===limit){result.truncated=true;break;}result.push(r);
      }
      result.terms=need;return result;
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={catalogue,groups};return;}
  root.V25BookGroups=groups;
  root.mountVerseFinder=({navigate,interrupt,origin,restore,camera,scripture,citationLinks,windows})=>{
    const $=id=>document.getElementById(id),panel=$('verse-finder'),tab=$('vf-tab'),input=$('vf-input'),list=$('vf-list'),scroll=$('vf-scroll'),stage=$('stage'),more=$('vf-more'),passage=$('vf-context');
    stage.parentElement.append(panel,tab); // A sibling of the gesture surface; the book remains interactive.
    const key='paper:v25:slip:1',clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const trigger=document.createElement('button');trigger.className='rh-toggle';trigger.type='button';trigger.title='搜索经文（Ctrl / ⌘ + K）';trigger.setAttribute('aria-label','搜索经文');
    trigger.append(tab.querySelector('svg').cloneNode(true));
    document.querySelector('.rh-rail').prepend(trigger);
    for(const el of [trigger,tab])el.setAttribute('aria-controls',panel.id);
    const {create,label,bindCompletion,bindPreselection}=root.V25NoteRefs;
    const addresses=create({...citationLinks,scripture});
    let mode='off',start=null,lookup,results=[],seen=new Set(),current=-1,anchor=null,q='',queryKind='locate',saveTimer,geom='',wide=false;
    const preselection=bindPreselection(input,addresses,{options:()=>({pasted:true}),
      changed:()=>{closeGroups();refresh(true,'locate');}});
    const paintCompletion=bindCompletion(input,value=>queryKind==='locate'?addresses.completion(value):'',
      {tapAfter:true,onAccept:preselection.accept});
    const restorePreselection=flag=>preselection.restore(flag?addresses.preselect(input.value,{accepted:true,pasted:true}):null);
    let scope='all',trails={},note=null,facet=null,passagePick=null;
    const contextStream=root.V25AddressStream.create({viewport:scroll,host:passage,renderVerse:verseRow});
    const scopes=$('vf-scopes'),groupButton=$('vf-group'),choices=$('vf-groups'),allButton=$('vf-all'),pickBook=$('vf-pick-book'),
      bookNames=new Map(root.BIBLE_SOURCE.books.map(b=>[b.code,b.name]));
    function closeGroups(focus=false){
      if(choices.hidden)return;
      const opener=facet==='books'?pickBook:groupButton;facet=null;
      choices.hidden=true;scroll.hidden=false;opener.setAttribute('aria-expanded','false');
      layout();restoreRow();if(focus)opener.focus({preventScroll:true});
    }
    function openFacet(type){
      if(scopes.hidden)return;
      if(!choices.hidden){const same=facet===type;closeGroups(same);if(same)return;}
      const opener=type==='books'?pickBook:groupButton;facet=type;
      choices.dataset.kind=type;choices.setAttribute('aria-label',type==='books'?'指定书卷':'书卷分类');
      const options=type==='books'?root.BIBLE_SOURCE.books.map(b=>[b.short,'book:'+b.code,b.name]):
        Object.keys(groups).map(name=>[name,name,name]);
      choices.replaceChildren(...options.map(([text,value,name])=>{
        const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',name);b.title=name;
        b.setAttribute('aria-pressed',String(value===scope));
        b.onclick=()=>{closeGroups(true);switchScope(value);};return b;
      }));
      remember();choices.hidden=false;scroll.hidden=true;opener.setAttribute('aria-expanded','true');layout();
      (choices.querySelector('[aria-pressed=true]')||choices.firstChild).focus({preventScroll:true});
    }
    groupButton.onclick=()=>openFacet('groups');
    pickBook.onclick=()=>openFacet('books');
    choices.addEventListener('keydown',e=>{
      const cols=facet==='books'?4:2,keys={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols},items=[...choices.children];
      if(Object.hasOwn(keys,e.key)){e.preventDefault();items[(items.indexOf(e.target)+keys[e.key]+items.length)%items.length].focus();}
    });
    input.addEventListener('focus',()=>closeGroups());
    function scopeUI(){
      scopes.hidden=queryKind!=='keyword'||!q;
      const local=scope.startsWith('book:'),code=local?scope.slice(5):null;
      allButton.setAttribute('aria-pressed',String(scope==='all'));
      const grouped=Object.hasOwn(groups,scope);groupButton.textContent=grouped?scope:'分类';groupButton.toggleAttribute('data-current',grouped);
      pickBook.textContent=local?(bookNames.get(code)||'书卷'):'书卷';pickBook.setAttribute('aria-label',local?'指定书卷：'+bookNames.get(code):'指定书卷');
      pickBook.toggleAttribute('data-current',local);
    }
    const trail=()=>({current,seen:[...seen],anchor,count:list.children.length,passage:contextStream.snapshot(),passagePick});
    function applyTrail(t){
      if(!t)return;
      if(contextStream.active){
        contextStream.restore(t.passage);
        if(Number.isInteger(t.passagePick))passagePick=t.passagePick;
        else if(t.current===0)passagePick=results[0].order; // Previously an exact address was the first list row.
        return;
      }
      current=results[t.current]?t.current:-1;seen=new Set((t.seen||[]).filter(i=>results[i]));append(Math.max(0,t.count-list.children.length));Array.from(list.children).forEach(decorate);
      anchor=results[t.anchor?.i]?t.anchor:null;restoreRow();
    }
    function switchScope(next){
      if(scope===next||scopes.hidden)return;
      remember();trails[scope]=trail();scope=next;mode='browse';refresh(true);applyTrail(trails[next]);scopeUI();layout();persist();
    }
    allButton.onclick=()=>{closeGroups();switchScope('all');};
    // Anchor a row, not raw scrollTop: wrapping and line counts vary by width.
    function remember(i){
      if(contextStream.active){contextStream.snapshot();return;}
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
    function restoreRow(){const r=list.children[anchor?.i];if(!contextStream.active&&r&&mode!=='preview'&&!panel.hidden&&!scroll.hidden){scroll.scrollTop=r.offsetTop-anchor.dy;restoredTop=scroll.scrollTop;restoredBox=boxKey();}}
    new ResizeObserver(()=>{if(!panel.hidden)restoreRow();}).observe(list);
    function persist(){
      clearTimeout(saveTimer);
      if(note)return;
      try{if(mode==='off')sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify({
        mode,start,q,queryKind,preselected:!!preselection.ref,scope,trails,...trail()}));}catch{}
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
      if(note){
        const top=clamp((vv?.offsetTop||0)-stage.getBoundingClientRect().top,0,c.h)+8;
        const h=Math.max(70,Math.min(480,(vv?.height||c.h)-20));
        panel.hidden=false;tab.hidden=true;panel.dataset.layout=next?'wide':'narrow';
        panel.removeAttribute('data-compact');panel.style.setProperty('--vf-density','1');
        Object.assign(panel.style,{transform:'none',left:'8px',top:top+'px',
          width:Math.min(c.w-16,next?348:290)+'px',maxHeight:h+'px'});
        contextStream.layout();wide=next;return;
      }
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
      const z=next?c.scale:Math.min(contextStream.active?Math.max(.85,c.scale):c.scale,1.15,roomW/147,roomH/120);
      const w=Math.min(next?306:233,roomW/z,next?(c.w/2-10)/z:c.w*.71/z),
        height=Math.min(next?432:(mode==='browse'&&results.length?280:242),roomH/z),
        show=mode==='browse'||(mode==='read'&&next),g=[next,w,height,z].join(':');
      if(!contextStream.active&&!anchor&&!panel.hidden)remember();
      const wasHidden=panel.hidden;
      panel.hidden=!show;tab.hidden=mode==='off'||mode==='preview'||show;panel.dataset.layout=next?'wide':'narrow';
      trigger.setAttribute('aria-expanded',String(show));tab.setAttribute('aria-expanded',String(show));
      function place(node,scale,bounded=false){
        const left=toRight?px:px-node.offsetWidth,top=down?py:py-node.offsetHeight;
        node.dataset.dockX=px;node.dataset.dockY=py;node.dataset.paperX=mount.bx;node.dataset.paperY=mount.by;
        node.style.transformOrigin=(toRight?'left':'right')+' '+(down?'top':'bottom');
        node.style.transform=scale===1?'none':'scale('+scale+')';
        node.style.left=(bounded?clamp(left,margin,c.w-margin-node.offsetWidth):left)+'px';
        node.style.top=(bounded?clamp(top,visibleTop+margin,visibleBottom-margin-node.offsetHeight):top)+'px';
      }
      if(show){
        panel.style.setProperty('--vf-density',String(Math.min(1,1.15/z)));
        panel.style.width=w+'px';panel.style.maxHeight=height+'px';panel.toggleAttribute('data-compact',height<242||w<155);place(panel,z);
        contextStream.layout();
        if(g!==geom||wasHidden)restoreRow();
      }else if(!tab.hidden){
        // A collapsed search control is a paper tab, not a miniaturized
        // result list. Keep its touch/mouse target readable at every zoom.
        place(tab,1,true);
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
      if(note){input.focus({preventScroll:true});return;}
      if(mode==='off'){start=origin();edit=true;}
      else if(mount&&trigger===document.activeElement){
        const c=camera(),hx=c.x+mount.bx*c.scale,hy=c.y+mount.by*c.scale;
        if(hx<0||hx>c.w||hy<0||hy>c.h)mount=null;
      }
      scopeUI();interrupt();root.PaperImmersion?.hideChrome();setMode('browse');
      if(edit)input.focus({preventScroll:true});else if(current>=0&&anchor?.i===current)landOnResult();else $('vf-close').focus({preventScroll:true});
    }
    function tuck(){if(!panel.hidden){input.blur();setMode('tucked');stage.focus({preventScroll:true});}}
    const dismiss=()=>note?closeNote(note.owner,true):tuck();
    trigger.onclick=()=>open();tab.onclick=()=>open();$('vf-close').onclick=dismiss;
    root.V25OverlayBack.register(panel,{
      layer:()=>document.querySelector('.compare-slip:not([hidden])')?48:31,
      // A verse preview hides the ordinary finder, but closing the verse
      // reveals that same finder as the next layer.
      active:()=>!panel.hidden||mode==='preview'&&windows.preview.is('search'),
      dismiss:()=>note?closeNote(note.owner,true,true):tuck()});
    $('vf-origin').onclick=()=>{if(start){tuck();restore(start);}};
    $('vf-end').onclick=()=>{setMode('off');start=null;scope='all';trails={};scopeUI();input.value='';preselection.clear();refresh(true,'locate');stage.focus({preventScroll:true});};
    root.V25PaperDock.onTap(stage,()=>{if(note)return;if(mode==='preview')backToResults();else if(!panel.hidden)tuck();});
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();open(true);}
    });
    scroll.addEventListener('scroll',()=>{
      if(panel.hidden)return;
      if(contextStream.active){clearTimeout(saveTimer);saveTimer=setTimeout(persist,100);return;}
      if(restoredBox&&boxKey()!==restoredBox){restoreRow();return;}
      if(wide===(stage.clientWidth>=640)&&Math.abs(scroll.scrollTop-restoredTop)>.5){remember();restoredTop=-1;clearTimeout(saveTimer);saveTimer=setTimeout(persist,100);}
    });
    function decorate(b,i){b.toggleAttribute('data-seen',seen.has(i));if(i===current)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}
    function landOnResult(focus=true){
      if(contextStream.active){
        if(!panel.hidden&&focus){
          if(preselection.ref){if(!matchMedia('(pointer:coarse)').matches)input.focus({preventScroll:true});}
          else if(Number.isInteger(passagePick))contextStream.element(passagePick)?.focus({preventScroll:true});
        }
        return;
      }
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
    function noteUI(){
      panel.toggleAttribute('data-note-search',!!note);
      panel.setAttribute('aria-label',note?'笔记经文检索笺':'经文检索笺');
      $('vf-close').title=note?'关闭检索笺':'收起检索笺';
      $('vf-close').setAttribute('aria-label',$('vf-close').title);
      panel.querySelector('.vf-foot').hidden=!!note;
    }
    function openNote(options){
      if(!options.owner?.isConnected||!options.anchor?.isConnected)return false;
      if(note)closeNote(note.owner);
      closeGroups();remember();
      const saved={mode,start,scope,mount,trails,trail:trail(),query:input.value,queryKind,preselected:!!preselection.ref};
      if(windows.preview.is('search'))windows.preview.close('screen');
      note={...options,saved};mode='browse';scope='all';mount=null;trails={};
      noteUI();scopeUI();input.value=options.query;preselection.clear();refresh(true,'keyword');
      if(input.value.trim())(list.firstElementChild||$('vf-close')).focus({preventScroll:true});
      else input.focus({preventScroll:true});
      return true;
    }
    function closeNote(owner,focus=false,fromBack=false){
      if(!note||owner&&owner!==note.owner&&!owner.contains(note.owner))return false;
      const {anchor:entry,saved}=note;
      if(windows.preview.is('note-pick'))windows.preview.close('screen');
      closeGroups();note=null;noteUI();
      mode=fromBack&&saved.mode!=='off'?'tucked':saved.mode==='preview'?'browse':saved.mode;
      start=saved.start;scope=saved.scope;mount=saved.mount;trails=saved.trails;input.value=saved.query;restorePreselection(saved.preselected);
      refresh(true,saved.queryKind);trails=saved.trails;applyTrail(saved.trail);scopeUI();layout();persist();
      if(!fromBack&&saved.mode==='preview'&&(current>=0||passagePick!=null)&&focus)resumePreview();
      else if(focus&&entry.isConnected)entry.focus({preventScroll:true});
      return true;
    }
    function resumePreview(){
      if(contextStream.active&&passagePick!=null){
        if(!contextStream.element(passagePick))contextStream.restore({index:passagePick});
        if(previewResult(passagePick,false,true))return;
      }else if(current>=0&&previewResult(current,false))return;
      setMode('browse');
    }
    function previewResult(i,focus=true,inline=false){
      const found=results[0],neighbor=inline&&found&&scripture.index(found.code)?.rows[i];
      const r=inline?(found?.order===i?found:neighbor):results[i],b=inline?contextStream.element(i):list.children[i];
      if(!r||!b)return;
      if(inline)passagePick=i;
      else{const prev=current;current=i;seen.add(i);if(list.children[prev])decorate(list.children[prev],prev);decorate(b,i);}
      if(focus){input.blur();remember(i);}
      const keywords=results.terms;
      if(note){
        const session=note;
        windows.openNotePick(r.locations||{code:r.code,ref:r.ref},{owner:session.owner,picker:session.picker,keywords,
          onClose(reason,refocus){
            if(note===session&&refocus&&reason!=='screen'&&b.isConnected)landOnResult();
          }});
        return;
      }
      const opened=windows.openPreview(r.locations||[{code:r.code,ref:r.ref}],{
        kind:'search',label:'搜索命中经文',ariaLabel:'搜索结果经文浮窗',keywords,focus,onBack:true,
        highlightRows:r.locations&&scripture.from(r.locations.filter(loc=>!loc.whole)),
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
      mode='preview';layout();persist();return true;
    }
    function verseRow(row,current){
      const el=document.createElement('span'),number=document.createElement('sup');
      el.className='vf-context__verse';el.dataset.ref=row.ref;el.tabIndex=preselection.ref?-1:0;el.setAttribute('role','button');
      el.setAttribute('aria-label','打开经文：'+row.name+' '+row.display);el.setAttribute('aria-description',row.text);
      if(preselection.ref)el.setAttribute('aria-disabled','true');
      el.toggleAttribute('data-current',current);
      number.className='compare-slip__ref';number.textContent=row.lo===row.hi?row.lo:row.lo+'–'+row.hi;
      number.setAttribute('aria-hidden','true');el.append(number,document.createTextNode(row.text));
      el.onclick=()=>{if(!preselection.ref)previewResult(row.order,true,true);};
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat)el.click();}};
      return el;
    }
    function append(count=24){
      const from=list.children.length;
      for(let i=from;i<Math.min(results.length,from+count);i++){
        const r=results[i],b=document.createElement('button'),hit=document.createElement('span'),
          ref=document.createElement('strong'),excerpt=document.createElement('span');
        b.type='button';b.dataset.i=i;ref.textContent=r.heading||(r.book+' '+(r.display||r.ref));
        words.paint(excerpt,r.text,results.terms);
        hit.className='vf-hit';hit.append(ref,document.createTextNode('　'),excerpt);
        b.append(hit);decorate(b,i);b.onclick=()=>previewResult(i);list.append(b);
      }
      more.hidden=list.children.length>=results.length;
    }
    function find(raw,within='all',options){
      if(!lookup)lookup=catalogue(root.BIBLE_SOURCE,(c,r)=>root.V25OriginalData.lookup(c,r),scripture);
      return lookup(raw,within,options);
    }
    function locate(raw,picked){
      const found=picked?[{anchors:[picked]}]:addresses.locateOne(raw,{pasted:true});
      return found.flatMap(({anchors:[ref],partial})=>{
        const locations=addresses.locations(ref),first=scripture.resolve(locations[0])[0];
        return first?[{...first,locations,heading:label(first.name,ref),partial}]:[];
      });
    }
    let renderedPick=null;
    function refresh(force=false,nextKind=queryKind){
      const next=input.value.trim(),picked=nextKind==='locate'?preselection.ref:null;
      if(next===q&&queryKind===nextKind&&picked===renderedPick&&!force)return;
      if(q!==next||queryKind!==nextKind)trails={};q=next;queryKind=nextKind;current=-1;seen.clear();anchor=null;passagePick=null;
      renderedPick=picked;
      results=q?(queryKind==='keyword'?find(q,scope,{keywordsOnly:true}):locate(q,picked)):[];
      contextStream.clear();list.replaceChildren();scroll.scrollTop=0;scopeUI();
      const located=queryKind==='locate'&&results.length===1&&!results[0].partial?results[0]:null;
      passage.hidden=!located;list.hidden=!!located;
      if(located){contextStream.start(scripture.index(located.code).rows,located.order);more.hidden=true;}
      else append();
      $('vf-status').textContent=picked?(picked.lo==null?'已预选整章':'已预选经文'):
        q&&queryKind==='keyword'?(results.truncated?'仅显示前 '+limit+' 节':results.length?results.length+' 节':'未找到经文'):'';
      paintCompletion();
      layout();persist();
    }
    let composing=false;
    const locateInput=()=>{closeGroups();refresh(false,'locate');};
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('input',e=>{if(!composing&&!e.isComposing)locateInput();});
    input.addEventListener('compositionend',()=>{composing=false;locateInput();});
    function submit(e){
      e.preventDefault();if(composing||e.isComposing||e.keyCode===229||e.repeat||!input.value.trim())return;
      const picked=preselection.ref;
      if(picked){
        if(note){
          const error=note.addAddress(picked);
          if(error)$('vf-status').textContent=error;
          else{input.value='';preselection.clear();refresh(true,'locate');input.focus({preventScroll:true});}
        }else if(results[0])previewResult(results[0].order,true,true);
        return;
      }
      closeGroups();refresh(false,'keyword');input.blur();(list.firstElementChild||$('vf-close')).focus({preventScroll:true});
    }
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey)submit(e);});
    input.addEventListener('beforeinput',e=>{if(['insertLineBreak','insertParagraph'].includes(e.inputType)&&!composing&&!e.isComposing)submit(e);});
    $('vf-form').onsubmit=submit;
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
      start=stored.start;scope=stored.scope||'all';input.value=stored.q;restorePreselection(stored.preselected);
      refresh(true,stored.queryKind==='locate'?'locate':'keyword');trails=stored.trails||{};applyTrail(stored);mode=stored.mode;scopeUI();layout();persist();
      if(mode==='preview')resumePreview();
    }
    return {layout,openNote,closeNote};
  };
})(typeof window!=='undefined'?window:globalThis);
