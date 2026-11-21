/* One independent printed-page reader, with no navigation of the main desk. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25Compare=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const parse=ref=>{
    const m=/^(\d+):(\d+)(?:[-–](\d+))?$/.exec(ref||'');
    return m?{ref,ch:+m[1],lo:+m[2],hi:+(m[3]||m[2])}:null;
  };
  const ord=(ch,v)=>ch*1000+v;
  const contains=(a,b)=>a&&b&&a.ch===b.ch&&a.lo<=b.lo&&a.hi>=b.lo;
  function rangeFor(db,entries){
    if(!entries.length)return null;
    const b=db.pages[entries[0].page]?.b,book=db.books[b];
    if(!book||entries.some(e=>db.pages[e.page]?.b!==b||!parse(e.ref)))return null;
    const verses=[...new Set(entries.map(e=>e.ref))].map(parse).sort((a,b)=>a.ch-b.ch||a.lo-b.lo||a.hi-b.hi);
    const first=verses[0];let end=first;
    for(const next of verses.slice(1)){
      const same=next.ch===end.ch&&next.lo<=end.hi+1;
      const follows=next.ch===end.ch+1&&next.lo===1&&book.versePages[end.ch-1]?.length===end.hi;
      if(!same&&!follows)return null;
      if(!same||next.hi>end.hi)end=next;
    }
    const ref=first.ch+':'+first.lo, page=db.lookup(book.code,ref)??Math.min(...entries.map(e=>e.page));
    return {page,ref,bookCode:book.code,from:ord(first.ch,first.lo),to:ord(end.ch,end.hi),
      label:ref+(first.ch===end.ch&&first.lo===end.hi?'':'–'+(first.ch===end.ch?'':end.ch+':')+end.hi)};
  }
  function rowsFor(db,page,ink,clean=t=>t){
    const parts=new Map();
    db.tags(page).forEach((tag,i)=>{
      if(tag.role!=='body'||!parse(tag.ref)||!ink[i]?.[4])return;
      parts.set(tag.ref,(parts.get(tag.ref)||'')+ink[i][4]);
    });
    return [...parts].map(([ref,text])=>({ref,text:clean(text)}));
  }
  function mount({stage,db,onRead=()=>{},feedback=()=>{},clean}){
    const doc=stage.ownerDocument,win=doc.defaultView;
    function node(tag,cls,text){
      const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;
    }
    const panel=node('aside','compare-slip'),head=node('header','compare-slip__head'),name=node('button','compare-slip__title');
    const title=node('strong'),sub=node('small','compare-slip__subtitle'),scroll=node('div','compare-slip__scroll');
    const foot=node('footer','compare-slip__foot'),status=node('span','compare-slip__status');
    const btn=(cls,text,label,click)=>{
      const b=node('button',cls,text);b.type='button';b.title=label;b.setAttribute('aria-label',label);
      if(click)b.addEventListener('click',click);return b;
    };
    const previous=btn('compare-slip__page','↑ 上一页','浮窗上一页',()=>move(-1,false));
    const next=btn('compare-slip__page','下一页 ↓','浮窗下一页',()=>move(1,false));
    const minimize=btn('compare-slip__icon','−','收起经文浮窗',()=>collapse(!collapsed));
    const exit=btn('compare-slip__icon','×','关闭经文浮窗',close);
    const resize=btn('compare-slip__resize','','拖动调整浮窗大小；也可使用方向键');
    panel.id='v25-compare';panel.hidden=true;panel.setAttribute('aria-label','经文对照浮窗');
    name.type='button';name.title='拖动标题栏移动；也可使用方向键';name.append(title,sub);
    scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','浮窗经文');
    status.setAttribute('role','status');foot.append(previous,status,next);head.append(name,minimize,exit);
    // Sibling to the search slip, so the active search/navigation layers can
    // pass in front of it even inside the fixed full-screen desk.
    panel.append(head,scroll,foot,resize);stage.parentElement.append(panel);
    let state=null,page=null,request=0,rendering=false,lastTop=0,lastChapter=null,collapsed=false,lockUntil=0;
    let reading=[],drag=null,manual=null;
    const clock=()=>win.performance.now(),clamp=(n,a,b)=>Math.max(a,Math.min(n,Math.max(a,b)));
    const cssNum=(el,key,fallback)=>parseFloat(win.getComputedStyle(el).getPropertyValue(key))||fallback;
    function limits(){
      const vv=win.visualViewport, width=vv?.width??win.innerWidth,height=vv?.height??win.innerHeight;
      const rail=doc.getElementById('reading-history'),foot=rail?.getBoundingClientRect().height||40;
      const bottom=Math.min(height*.35,Math.max(10,foot)+10),gap=8;
      return {left:(vv?.offsetLeft||0)+gap,top:(vv?.offsetTop||0)+gap,
        right:(vv?.offsetLeft||0)+width-gap,bottom:(vv?.offsetTop||0)+height-bottom};
    }
    function fitRect(box){
      const lim=limits(),minW=Math.min(214,lim.right-lim.left),minH=Math.min(152,lim.bottom-lim.top);
      const w=clamp(box.width,minW,lim.right-lim.left),h=clamp(box.height,minH,lim.bottom-lim.top);
      manual={left:clamp(box.left,lim.left,lim.right-w),top:clamp(box.top,lim.top,lim.bottom-(collapsed?head.offsetHeight:h)),width:w,height:h};
      const s=panel.style;Object.assign(s,{left:manual.left+'px',top:manual.top+'px',right:'auto',bottom:'auto',width:w+'px',height:h+'px'});
    }
    function sizeFrom(handle,kind){
      handle.addEventListener('pointerdown',e=>{
        if(e.button!==0||drag)return;
        e.preventDefault();
        const box=panel.getBoundingClientRect();
        drag={id:e.pointerId,kind,x:e.clientX,y:e.clientY,box:{left:box.left,top:box.top,width:box.width,height:collapsed?(manual?.height||cssNum(panel,'--compare-height-px',260)):box.height}};
        panel.dataset.adjust=kind;
        handle.setPointerCapture(e.pointerId);handle.focus({preventScroll:true});
      });
      handle.addEventListener('pointermove',e=>{
        if(drag?.id!==e.pointerId)return;
        const {box,x,y}=drag,dx=e.clientX-x,dy=e.clientY-y,lim=limits();
        if(kind==='move')fitRect({...box,left:box.left+dx,top:box.top+dy});
        else fitRect({...box,width:Math.min(box.width+dx,lim.right-box.left),height:Math.min(box.height+dy,lim.bottom-box.top)});
      });
      function stop(e){if(drag?.id!==e.pointerId)return;drag=null;delete panel.dataset.adjust;}
      for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
      handle.addEventListener('keydown',e=>{
        const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;
        e.preventDefault();
        const b=panel.getBoundingClientRect(),step=e.shiftKey?32:12,[x,y]=d;
        fitRect({left:b.left+(kind==='move'?x*step:0),top:b.top+(kind==='move'?y*step:0),
          width:b.width+(kind==='size'?x*step:0),height:(collapsed?(manual?.height||260):b.height)+(kind==='size'?y*step:0)});
      });
    }
    sizeFrom(name,'move');sizeFrom(resize,'size');
    function reflow(){if(!panel.hidden&&manual)fitRect(manual);}
    win.addEventListener('resize',reflow);win.visualViewport?.addEventListener('resize',reflow);
    function collapse(value){
      collapsed=value;panel.toggleAttribute('data-collapsed',value);
      minimize.textContent=value?'+':'−';
      minimize.title=value?'展开经文浮窗':'收起经文浮窗';
      minimize.setAttribute('aria-label',minimize.title);minimize.setAttribute('aria-expanded',String(!value));
      if(!value){if(manual)fitRect(manual);scroll.scrollTop=lastTop;lastTop=scroll.scrollTop;}
    }
    function close(){
      request++;rendering=false;state=null;page=null;panel.hidden=true;scroll.replaceChildren();
      stage.focus({preventScroll:true});
    }
    function atEdge(direction){
      return direction>0?scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<2:scroll.scrollTop<2;
    }
    function adjacent(direction){
      if(!state||page===null)return null;
      for(let n=page+direction;n>=state.book.first&&n<=state.book.last;n+=direction){
        if(db.pages[n]?.b===state.b)return n;
      }
      return null;
    }
    function aim(item){
      if(!item||!state)return;
      const {book}=state,r=parse(item.ref);
      title.textContent=book.name+' '+item.ref;
      panel.dataset.chapter=String(r.ch);
      if(lastChapter!==r.ch){
        lastChapter=r.ch;onRead({bookCode:book.code,bookName:book.name,page,ref:item.ref});
      }
    }
    function currentRow(){
      const target=scroll.scrollTop+Math.min(30,scroll.clientHeight*.18);
      return reading.findLast(row=>row.el.offsetTop<=target)||reading[0];
    }
    function setButtons(){
      previous.disabled=rendering||adjacent(-1)===null;
      next.disabled=rendering||adjacent(1)===null;
    }
    async function show(n,{ref,back=false}={}){
      const ticket=++request;rendering=true;setButtons();status.textContent='载入中…';
      try{
        const data=db.get(n)||await db.load(n);
        if(ticket!==request)return;
        if(!data)throw Error('No page');
        const fragment=doc.createDocumentFragment();
        const rows=rowsFor(db,n,data[3],clean).map(row=>{
          const r=parse(row.ref),el=node('p','compare-slip__verse'),num=node('span','compare-slip__ref',row.ref);
          el.dataset.ref=row.ref;
          if(state.from&&ord(r.ch,r.hi)>=state.from&&ord(r.ch,r.lo)<=state.to)el.dataset.cited='';
          el.append(num,doc.createTextNode(row.text));fragment.append(el);return {...row,el};
        });
        if(!rows.length)fragment.append(node('p','compare-slip__message','本页无经文，可继续翻页。'));
        scroll.replaceChildren(fragment);page=n;reading=rows;panel.dataset.page=String(n);
        const target=ref&&rows.find(row=>contains(parse(row.ref),parse(ref)));
        scroll.scrollTop=target?Math.max(0,target.el.offsetTop-8):back?scroll.scrollHeight:0;
        lastTop=scroll.scrollTop;lockUntil=clock()+450;
        status.textContent='纸本 '+(db.pages[n].displayPage??n)+' 页';
        aim(target||currentRow());
      }catch{
        if(ticket!==request)return;
        status.textContent='载入失败';feedback('未能读取浮窗经文，可重试翻页');
        if(page===null){
          const retry=btn('compare-slip__page','重试','重新载入浮窗经文',()=>show(n,{ref,back}));
          scroll.replaceChildren(retry);
        }
      }finally{
        if(ticket===request){rendering=false;setButtons();}
      }
    }
    function move(direction,edge){
      if(rendering||collapsed||edge&&clock()<lockUntil)return;
      const n=adjacent(direction);
      if(n!==null)void show(n,{back:direction<0});
    }
    scroll.addEventListener('scroll',()=>{
      if(rendering||collapsed||!state||Math.abs(scroll.scrollTop-lastTop)<1)return;
      lastTop=scroll.scrollTop;aim(currentRow());
    },{passive:true});
    // Turn on a continued gesture at either boundary, not on a layout change
    // or a momentum scroll transferring to the main desk.
    let lastWheel=0,wheelUsed=false;
    scroll.addEventListener('wheel',e=>{
      if(e.ctrlKey||e.metaKey||!e.deltaY)return;
      const now=clock(),direction=Math.sign(e.deltaY);
      if(now-lastWheel>180)wheelUsed=false;
      lastWheel=now;
      if(atEdge(direction)&&!wheelUsed&&now>=lockUntil){wheelUsed=true;move(direction,true);}
    },{passive:true});
    let touch=null;
    scroll.addEventListener('touchstart',e=>{const t=e.touches[0];touch=e.touches.length===1?{y:t.clientY,x:t.clientX,top:atEdge(-1),bottom:atEdge(1)}:null;},{passive:true});
    scroll.addEventListener('touchend',e=>{
      const t=e.changedTouches[0],start=touch;touch=null;if(!t||!start)return;
      const dy=t.clientY-start.y;
      if(Math.abs(dy)<36||Math.abs(dy)<Math.abs(t.clientX-start.x)*1.35)return;
      if(dy<0&&start.bottom&&atEdge(1))move(1,true);
      if(dy>0&&start.top&&atEdge(-1))move(-1,true);
    },{passive:true});
    scroll.addEventListener('touchcancel',()=>{touch=null;},{passive:true});
    panel.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
      if(e.target!==scroll)return;
      const dir=e.key==='PageDown'?1:e.key==='PageUp'?-1:0;
      if(dir&&atEdge(dir)){e.preventDefault();move(dir,false);}
    });
    function open(loc){
      const b=loc.bookCode?db.books.findIndex(book=>book.code===loc.bookCode):db.pages[loc.page]?.b;
      const book=db.books[b];if(!book)return false;
      const ref=loc.ref||db.pages[loc.page]?.start;
      const n=db.pages[loc.page]?.b===b?loc.page:db.lookup(book.code,ref)??book.first;
      state={...loc,b,book};page=null;reading=[];lastChapter=null;lastTop=0;
      panel.hidden=false;delete panel.dataset.page;delete panel.dataset.chapter;
      title.textContent=book.name+(ref?' '+ref:'');sub.textContent=loc.label?'对照 · '+loc.label:'经文对照';
      scroll.replaceChildren();collapse(false);reflow();void show(n,{ref});
      scroll.focus({preventScroll:true});return true;
    }
    return {open,openSelection(entries){
      const loc=rangeFor(db,entries);
      if(!loc){feedback('浮窗需要同一书卷内相邻的经文');return false;}
      return open(loc);
    }};
  }
  return {mount,rangeFor,rowsFor};
});
