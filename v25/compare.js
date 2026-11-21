/* One scripture reader for comparison, search hits and printed citations. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25Compare=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const LIMIT=3,clamp=(n,a,b)=>Math.max(a,Math.min(n,Math.max(a,b)));
  function windowRange(lo,hi,direction,last){
    if(direction<0&&lo>0){lo--;hi=Math.min(hi,lo+LIMIT-1);}
    else if(direction>0&&hi<last){hi++;lo=Math.max(lo,hi-LIMIT+1);}
    return {lo,hi};
  }
  function createWindow({stage,scripture,id,role}){
    const doc=stage.ownerDocument,win=doc.defaultView;
    let config=null,stream=null,which=0,lo=0,hi=0,activeRow=null,rows=[],manual=null,adjust=null;
    let lastTop=0,lastChapter=null,collapsed=false,loadedAt=0;
    function node(tag,cls,text){
      const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;
    }
    const panel=node('aside','compare-slip'),head=node('header','compare-slip__head'),name=node('button','compare-slip__title');
    const title=node('strong'),sub=node('small','compare-slip__subtitle'),tabs=node('div','compare-slip__tabs');
    const scroll=node('div','compare-slip__scroll'),foot=node('footer','compare-slip__foot'),status=node('span','compare-slip__status');
    const btn=(cls,text,label,click)=>{
      const b=node('button',cls,text);b.type='button';b.title=label;b.setAttribute('aria-label',label);
      if(click)b.onclick=click;return b;
    };
    const minimize=btn('compare-slip__icon','−','收起经文浮窗',()=>collapse(!collapsed));
    const exit=btn('compare-slip__icon','×','关闭经文浮窗',()=>close('dismiss',true));
    const resize=btn('compare-slip__resize','','拖动调整浮窗大小；也可使用方向键');
    const back=btn('compare-slip__action','‹ 返回结果','返回搜索结果',()=>close('back',true));
    const jump=btn('compare-slip__action citation-jump','在主书查看 ↗','在主书查看',()=>{if(activeRow)config?.onJump?.(activeRow);});
    const pin=btn('compare-slip__action','固定','固定经文浮窗',()=>config?.onPin?.(currentGroup(),activeRow));
    const fork=btn('compare-slip__action','另开对照','将当前引用另开一个对照窗',()=>config?.onFork?.(currentGroup(),activeRow));
    panel.id=id;panel.dataset.role=role;panel.hidden=true;panel.setAttribute('aria-label','经文浮窗');
    name.type='button';name.title='拖动标题栏移动；也可使用方向键';name.append(title,sub);
    scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','浮窗经文');
    tabs.setAttribute('role','group');tabs.setAttribute('aria-label','引用经文位置');
    foot.append(back,jump,pin,fork,status);head.append(name,minimize,exit);
    panel.append(head,tabs,scroll,foot,resize);stage.parentElement.append(panel);
    const currentGroup=()=>config?.groups[which];
    const clock=()=>win.performance.now();
    function limits(){
      const vv=win.visualViewport,width=vv?.width??win.innerWidth,height=vv?.height??win.innerHeight;
      const rail=doc.getElementById('reading-history'),foot=rail?.getBoundingClientRect().height||40;
      return {left:(vv?.offsetLeft||0)+8,top:(vv?.offsetTop||0)+8,right:(vv?.offsetLeft||0)+width-8,
        bottom:(vv?.offsetTop||0)+height-Math.min(height*.35,Math.max(10,foot)+10)};
    }
    function fitRect(box){
      const lim=limits(),minW=Math.min(214,lim.right-lim.left),minH=Math.min(152,lim.bottom-lim.top);
      const w=clamp(box.width,minW,lim.right-lim.left),h=clamp(box.height,minH,lim.bottom-lim.top);
      const keep=!collapsed&&Math.abs(panel.getBoundingClientRect().width-w)>1?firstVisible():null;
      const offset=keep?keep.el.offsetTop-scroll.scrollTop:0;
      manual={left:clamp(box.left,lim.left,lim.right-w),top:clamp(box.top,lim.top,lim.bottom-(collapsed?head.offsetHeight:h)),width:w,height:h};
      Object.assign(panel.style,{left:manual.left+'px',top:manual.top+'px',right:'auto',bottom:'auto',width:w+'px',height:h+'px'});
      if(keep){scroll.scrollTop=keep.el.offsetTop-offset;lastTop=scroll.scrollTop;}
    }
    function shape(){
      const b=panel.getBoundingClientRect(),fallback=win.matchMedia('(max-width:639px)').matches?240:330;
      return {left:b.left,top:b.top,width:b.width,height:collapsed?(manual?.height||fallback):b.height};
    }
    function sizeFrom(handle,kind){
      handle.onpointerdown=e=>{
        if(e.button!==0||adjust)return;
        e.preventDefault();adjust={id:e.pointerId,handle,x:e.clientX,y:e.clientY,box:shape()};
        panel.dataset.adjust=kind;handle.setPointerCapture(e.pointerId);handle.focus({preventScroll:true});
      };
      handle.onpointermove=e=>{
        if(adjust?.id!==e.pointerId||adjust.handle!==handle)return;
        const {box,x,y}=adjust,dx=e.clientX-x,dy=e.clientY-y,lim=limits();
        if(kind==='move')fitRect({...box,left:box.left+dx,top:box.top+dy});
        else fitRect({...box,width:Math.min(box.width+dx,lim.right-box.left),height:Math.min(box.height+dy,lim.bottom-box.top)});
      };
      const stop=e=>{if(adjust?.id===e.pointerId&&adjust.handle===handle){adjust=null;delete panel.dataset.adjust;}};
      for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,stop);
      handle.onkeydown=e=>{
        const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;
        e.preventDefault();const b=shape(),step=e.shiftKey?32:12,x=d[0]*step,y=d[1]*step;
        fitRect({left:b.left+(kind==='move'?x:0),top:b.top+(kind==='move'?y:0),
          width:b.width+(kind==='size'?x:0),height:b.height+(kind==='size'?y:0)});
      };
    }
    sizeFrom(name,'move');sizeFrom(resize,'size');
    function reflow(){if(!panel.hidden&&manual)fitRect(manual);}
    win.addEventListener('resize',reflow);win.visualViewport?.addEventListener('resize',reflow);
    function collapse(value){
      collapsed=value;panel.toggleAttribute('data-collapsed',value);
      minimize.textContent=value?'+':'−';minimize.title=value?'展开经文浮窗':'收起经文浮窗';
      minimize.setAttribute('aria-label',minimize.title);minimize.setAttribute('aria-expanded',String(!value));
      if(!value){reflow();scroll.scrollTop=lastTop;lastTop=scroll.scrollTop;}
    }
    function close(reason='dismiss',restore=false){
      if(!config)return;
      const closed=config;config=null;panel.hidden=true;rows=[];stream=null;activeRow=null;scroll.replaceChildren();
      closed.onClose?.(reason,restore);
      if(restore&&(doc.activeElement===doc.body||panel.contains(doc.activeElement)))stage.focus({preventScroll:true});
    }
    function renderChunk(n){
      const {chapter,rows}=stream.chunks[n],section=node('section','compare-slip__chunk');
      section.dataset.chunk=String(n);section.dataset.chapter=String(chapter);
      section.append(node('h2','compare-slip__chapter-title','第 '+chapter+' 章'));
      for(const row of rows){
        for(const text of row.titles)section.append(node('h3','compare-slip__section-title',text));
        const p=node('p','compare-slip__verse'),num=node('span','compare-slip__ref',row.display);
        p.dataset.ref=row.ref;p.dataset.verseId=row.id;
        if(row.paragraph)p.dataset.paragraph='';
        const cited=config.cited.has(row.id);
        if(cited)p.dataset.cited='';
        p.append(num);
        if(cited&&config.keywords?.length)win.V25Words.paint(p,row.text,config.keywords);
        else p.append(doc.createTextNode(row.text));
        section.append(p);
      }
      return section;
    }
    function gather(){
      rows=Array.from(scroll.querySelectorAll('[data-verse-id]'),el=>({el,row:stream.byRef.get(el.dataset.ref)}));
      panel.dataset.chunkCount=String(scroll.childElementCount);
    }
    function aim(row){
      if(!row||!config)return;
      activeRow=row;title.textContent=row.name+' '+row.display;
      panel.dataset.chapter=String(row.ch);
      if(row.page!==null)panel.dataset.page=String(row.page);else delete panel.dataset.page;
      status.textContent='第 '+row.ch+' 章';
      jump.disabled=row.page===null;
      jump.setAttribute('aria-label','在主书查看 '+row.short+' '+row.display);
      const key=row.code+':'+row.ch;
      if(lastChapter!==key){lastChapter=key;config.onRead?.({bookCode:row.code,bookName:row.name,page:row.page,ref:row.ref});}
    }
    function firstVisible(){
      const y=scroll.scrollTop+1;
      return rows.find(p=>p.el.offsetTop+p.el.offsetHeight>y)||rows.at(-1);
    }
    function readScroll(){
      const y=scroll.scrollTop+Math.min(23,scroll.clientHeight*.12);
      aim((rows.findLast(p=>p.el.offsetTop<=y)||rows[0])?.row);
    }
    function atEdge(direction,gap=2){
      return direction>0?scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<=gap:scroll.scrollTop<=gap;
    }
    function extend(direction){
      if(!config||collapsed||!stream)return;
      const range=windowRange(lo,hi,direction,stream.chunks.length-1);
      if(lo===range.lo&&hi===range.hi)return;
      // Hold a visible verse at the same screen coordinate across inserts
      // and evictions. There are never more than three mounted chapters.
      const start=firstVisible(),delta=start?start.el.offsetTop-scroll.scrollTop:0;
      const oldFirst=scroll.firstElementChild,oldLast=scroll.lastElementChild;
      if(range.lo<lo){if(range.hi<hi)oldLast.remove();scroll.prepend(renderChunk(range.lo));}
      if(range.hi>hi){if(range.lo>lo)oldFirst.remove();scroll.append(renderChunk(range.hi));}
      lo=range.lo;hi=range.hi;gather();
      if(start?.el.isConnected)scroll.scrollTop=start.el.offsetTop-delta;
      lastTop=scroll.scrollTop;loadedAt=clock();
    }
    scroll.addEventListener('scroll',()=>{
      if(!config||collapsed)return;
      const top=scroll.scrollTop,delta=top-lastTop;
      if(Math.abs(delta)<.5)return;
      lastTop=top;readScroll();
      const direction=Math.sign(delta);
      if(atEdge(direction,Math.min(120,scroll.clientHeight*.45)))extend(direction);
    },{passive:true});
    scroll.addEventListener('wheel',e=>{
      if(!e.deltaY||e.ctrlKey||e.metaKey||clock()-loadedAt<55)return;
      const direction=Math.sign(e.deltaY);if(atEdge(direction))extend(direction);
    },{passive:true});
    let touch=null;
    scroll.addEventListener('touchstart',e=>{const t=e.touches[0];touch=e.touches.length===1?{y:t.clientY,x:t.clientX,top:atEdge(-1),bottom:atEdge(1)}:null;},{passive:true});
    scroll.addEventListener('touchend',e=>{
      const t=e.changedTouches[0],start=touch;touch=null;if(!t||!start||clock()-loadedAt<55)return;
      const dy=t.clientY-start.y;
      if(Math.abs(dy)<34||Math.abs(dy)<Math.abs(t.clientX-start.x)*1.35)return;
      if(dy<0&&start.bottom&&atEdge(1))extend(1);
      if(dy>0&&start.top&&atEdge(-1))extend(-1);
    },{passive:true});
    scroll.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
    panel.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close('dismiss',true);return;}
      if(e.target!==scroll)return;
      const dir=['PageDown','ArrowDown','End',' '].includes(e.key)?(e.shiftKey&&e.key===' '?-1:1):
        ['PageUp','ArrowUp','Home'].includes(e.key)?-1:0;
      if(dir&&atEdge(dir))extend(dir);
    });
    function show(whichIndex,seed){
      which=whichIndex;const selected=currentGroup(),row=seed||selected[0];
      if(!row)return;
      config.cited=new Set(selected.map(v=>v.id));
      sub.textContent=config.label||'经文';
      [...tabs.children].forEach((tab,n)=>tab.setAttribute('aria-pressed',String(n===which)));
      stream=scripture.index(row.code);lo=hi=row.chunk;
      scroll.replaceChildren(renderChunk(row.chunk));gather();
      let target=rows.find(r=>r.row.id===row.id)?.el;
      // If the requested verse is near the bottom, include some following
      // context so it can still be aligned without showing blank filler.
      if(target&&target.offsetTop-8>scroll.scrollHeight-scroll.clientHeight&&hi<stream.chunks.length-1){
        scroll.append(renderChunk(++hi));gather();
      }
      scroll.scrollTop=target?Math.max(0,target.offsetTop-8):0;
      lastTop=scroll.scrollTop;loadedAt=0;aim(row);
    }
    function open(settings){
      if(!settings.groups?.length)return false;
      close('replace');
      config=settings;lastChapter=null;lastTop=0;activeRow=null;
      panel.dataset.kind=config.kind;panel.hidden=false;
      panel.setAttribute('aria-label',config.ariaLabel||'经文对照浮窗');
      tabs.hidden=config.groups.length<2;tabs.replaceChildren();
      if(!tabs.hidden)config.groups.forEach((group,n)=>{
        const a=group[0],b=group.at(-1),text=a.short+' '+scripture.label(a,b);
        tabs.append(btn('compare-slip__tab',text,'阅读 '+a.name+' '+scripture.label(a,b),()=>show(n)));
      });
      back.hidden=!config.onBack;jump.hidden=!config.onJump;pin.hidden=!config.onPin;fork.hidden=!config.onFork;
      if(role==='preview'){manual=null;panel.removeAttribute('style');}
      collapse(false);
      if(config.anchor){
        const r=config.anchor.getBoundingClientRect(),box=shape(),lim=limits();
        const above=r.top-lim.top,below=lim.bottom-r.bottom;
        fitRect({...box,left:r.left+box.width<=lim.right?r.left:r.right-box.width,
          top:below>=above?r.bottom+3:r.top-box.height-3});
      }
      show(0,config.seed);
      if(config.focus)scroll.focus({preventScroll:true});
      return true;
    }
    return {panel,scroll,open,close,is:(kind)=>config?.kind===kind,focus:()=>scroll.focus({preventScroll:true})};
  }
  function mount({stage,scripture,onRead,feedback=()=>{},onJump}){
    const opts={stage,scripture},primary=createWindow({...opts,id:'v25-compare',role:'primary'}),
      secondary=createWindow({...opts,id:'v25-compare-alt',role:'secondary'}),
      preview=createWindow({...opts,id:'v25-scripture-preview',role:'preview'});
    const desktop=()=>stage.ownerDocument.defaultView.matchMedia('(min-width:800px)').matches;
    function display(groups,settings={},extra=false){
      const panel=extra&&desktop()&&!primary.panel.hidden?secondary:primary;
      return panel.open({kind:'compare',label:'经文对照',groups,onRead,onJump,focus:true,...settings});
    }
    function openSelection(locs){
      const resolved=locs.map(loc=>scripture.resolve(loc)),groups=scripture.groups(scripture.from(locs,true));
      if(groups.length!==1||resolved.some(r=>!r.length)){feedback('浮窗需要同一书卷内相邻的经文');return false;}
      const [a]=groups[0],b=groups[0].at(-1);
      return display(groups,{label:'对照 · '+scripture.label(a,b)});
    }
    function open(loc){
      const resolved=scripture.resolve(loc);
      if(!resolved.length){feedback('找不到此处经文');return false;}
      return display([resolved]);
    }
    function openPreview(locs,settings){
      const groups=scripture.groups(scripture.from(locs));
      if(!groups.length)return false;
      const openParallel=(group,seed)=>display([group],settings.keywords?.length?
        {seed,keywords:settings.keywords,label:'对照 · 搜索命中'}:{seed},true);
      const pin=(group,seed)=>{preview.close('pin');openParallel(group,seed);};
      return preview.open({...settings,groups,
        onPin:pin,onFork:groups.length>1&&desktop()?openParallel:null,
        onJump:settings.onJump||((row)=>{preview.close('jump');onJump?.(row);})});
    }
    return {open,openSelection,openPreview,preview};
  }
  return {mount,windowRange,LIMIT};
});
