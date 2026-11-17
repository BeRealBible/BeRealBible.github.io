/* Open-book reader with the supplied reference's compact thumb-index bands.
 * A tap acts on release; 160 ms only distinguishes a held, reversible curl. */
(() => {
  'use strict';
  if(window.PAPER_READER_ERROR)return;
  const $=id=>document.getElementById(id),D=window.BIBLE_DATA;
  const Page=window.PaperPage,Physics=window.PaperPhysics,Material=window.PaperBookMaterial;
  const stage=$('stage'),book=$('book'),papers=[$('left-paper'),$('right-paper')];
  const HOLD_MS=160,MOVE_SLOP=8,MAX_SCALE=3.2,MAX_SPREAD=(D.pages.length-2)&~1;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let spread=0,scale=1,fitScale=1,x=0,y=0,focus='fit',view={w:0,h:0};
  let fold=null,foldFrame=0,holdTimer=null,feedbackTimer=null,gesture=null,ribbons=null,chapters=null,jumpState=null;
  let saved=null,storage,queuedTurns=[],demoFrame=0,readingSide=1,edgePose=null,edgeSide=null;
  const pointers=new Map();
  try{storage=window.PAPER_READER_STORAGE||window.localStorage;saved=JSON.parse(storage?.getItem('paper-bible-position-v1')||'null');}catch{}
  if(saved&&Number.isFinite(saved.spread))spread=clamp(saved.spread&~1,0,MAX_SPREAD);
  if(saved?.page===spread)readingSide=0;
  if(Number.isInteger(window.PAPER_INITIAL_SPREAD)){spread=clamp(window.PAPER_INITIAL_SPREAD&~1,0,MAX_SPREAD);saved=null;readingSide=1;}
  if(Number.isInteger(window.PAPER_INITIAL_PAGE))readingSide=window.PAPER_INITIAL_PAGE&1;
  const svgPage=index=>Page.svg(D.pages[index],index,D.books);
  const renderer=new window.PaperSheetRenderer(book,(canvas,index,ratio)=>Page.paint(canvas,D.pages[index],index,D.books,ratio));
  const pageJump=window.PaperJump.create(book,{renderPage:svgPage});
  renderer.onContextLoss=()=>{interrupt();feedback('绘图已恢复到原页，可以继续阅读');};
  const index=window.PaperEdgeIndex.create($('edge-index-host'),{books:D.books,pageCount:D.pages.length,onSelect:openEdgeChapters,onExpand:expandEdge});
  const readingPage=()=>{
    const a=D.pages[spread+1-readingSide],b=D.pages[spread+readingSide];
    return b.b>=0&&!b.blank&&b.start?b:a.b>=0&&!a.blank&&a.start?a:b;
  };
  const currentBook=()=>D.books[Math.max(0,readingPage().b)]||D.books[0];
  const capturePose=()=>({zoom:scale/fitScale,cx:(view.w/2-x)/scale,cy:(view.h/2-y)/scale,focus});
  function save(){
    if(edgeSide)return; // Inspecting a book edge must not replace the reading view.
    const p=capturePose();
    try{storage?.setItem('paper-bible-position-v1',JSON.stringify({spread,page:spread+readingSide,zoom:p.zoom,centerX:p.cx,centerY:p.cy,focus,bookName:currentBook().name,ref:readingPage().start||'',edition:D.edition}));}catch{}
  }
  function feedback(text,delay=2200){
    clearTimeout(feedbackTimer);$('gesture-feedback').textContent=text;$('gesture-feedback').classList.remove('idle');
    if(delay)feedbackTimer=setTimeout(()=>$('gesture-feedback').classList.add('idle'),delay);
  }
  function updateIndex(){
    const e=index.update({spread,scale,currentBook:currentBook(),turning:!!fold||!!jumpState});
    book.style.setProperty('--edge-left-extent',e.normalLeftExtent+'px');
    book.style.setProperty('--edge-right-extent',e.normalRightExtent+'px');
    return e;
  }
  function closeEdge(){if(edgeSide)index.setExpanded(null);}
  function expandEdge(side){
    if(side){
      if(!edgePose)edgePose=capturePose();
      interrupt();edgeSide=side;stage.dataset.edgeExpanded=side;
      const e=index.getBounds();
      // Keep the book open. Only bring the expanded fore-edge into the window;
      // never rasterize the text or make a phone's labels miniature.
      scale=Math.min(Math.max(1,scale),(view.w-32)/224,(view.h-64)/704);
      focus='custom';
      if(side==='left')x=Math.max(x,20+e.leftExtent*scale);
      else x=Math.min(x,view.w-20-(960+e.rightExtent)*scale);
      y=clamp(y,24,Math.max(24,view.h-24-704*scale));
      transform();
    }else{
      const pose=edgePose;edgePose=null;edgeSide=null;delete stage.dataset.edgeExpanded;
      if(pose){scale=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;focus=pose.focus;}
      constrain();transform();
    }
  }
  function applyMaterial(material=Material.compute(spread,D.pages.length,D.books)){
    for(const side of ['left','right']){
      const depth=material[side+'Depth'];
      // Continuous, uncut paper edges. No repeated grooves or printed strata.
      $(side+'-paper-edges').innerHTML=window.PaperEdges.render(side,depth);
    }
  }
  function render(){
    papers.forEach((paper,i)=>paper.innerHTML=svgPage(spread+i));
    const b=currentBook(),p=readingPage(),ref=p.start||'1:1',last=p.end||ref;
    $('book-name').textContent=b.name;
    $('chapter-name').textContent=ref.split(':')[0]===last.split(':')[0]?`第 ${ref.split(':')[0]} 章`:`${ref.split(':')[0]}–${last.split(':')[0]} 章`;
    const label=q=>q.blank?'空白':q.frontmatter?'卷首':String(q.displayPage??D.pages.indexOf(q));
    $('page-label').textContent=`${label(D.pages[spread])} — ${label(D.pages[spread+1])}`;
    const progress=(spread+1)/(D.pages.length-1);
    $('progress-label').textContent=`${b.short} · 全书 ${Math.round(progress*100)}%`;
    $('read-block').style.width=progress*100+'%';$('position-pin').style.left=progress*100+'%';
    $('prev').disabled=spread===0;$('next').disabled=spread===MAX_SPREAD;
    stage.dataset.spread=String(spread);stage.dataset.book=b.code;
    applyMaterial();updateIndex();ribbons?.update();
  }
  function envelope(normal=false){
    const e=index.getBounds();
    return {left:-Math.max(16,normal?e.normalLeftExtent:e.leftExtent),right:960+Math.max(16,normal?e.normalRightExtent:e.rightExtent),bottom:724};
  }
  function constrain(){
    const e=envelope(),w=(e.right-e.left)*scale,h=e.bottom*scale,pad=18;
    if(w<=view.w-pad*2)x=view.w/2-(e.left+e.right)*scale/2;
    else x=clamp(x,view.w-pad-e.right*scale,pad-e.left*scale);
    if(h<=view.h-pad*2)y=(view.h-h)/2;
    else y=clamp(y,view.h-pad-h,pad);
  }
  function transform(){
    book.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    $('zoom-value').textContent=Math.round(scale/fitScale*100)+'%';
    $('zoom-in').disabled=scale>=MAX_SCALE;$('zoom-out').disabled=scale<=fitScale;
    stage.dataset.scale=scale.toFixed(4);stage.dataset.x=x.toFixed(2);stage.dataset.y=y.toFixed(2);
    ['fit-book','focus-left','focus-right'].forEach((id,i)=>$(id).classList.toggle('active',focus===['fit','left','right'][i]));
    const map=$('viewport-map'),mw=map.clientWidth,mh=map.clientHeight;
    const vx=clamp(-x/(960*scale),0,1),vy=clamp(-y/(704*scale),0,1);
    Object.assign($('map-window').style,{left:vx*mw+'px',top:vy*mh+'px',width:Math.min(1-vx,view.w/(960*scale))*mw+'px',height:Math.min(1-vy,view.h/(704*scale))*mh+'px'});
    map.style.opacity=scale>fitScale*1.2?'1':'0';
    $('surface-caption').style.opacity=scale>fitScale*1.2?'0':'1';
    updateIndex();ribbons?.update({scale});
  }
  function measureFit(){const e=envelope(true),margin=view.w<560?30:120;return Math.min((view.w-margin)/(e.right-e.left),(view.h-(view.w<560?38:120))/e.bottom);}
  function fit(){closeEdge();interrupt();focus='fit';fitScale=measureFit();scale=fitScale;constrain();transform();save();}
  function focusPage(side){
    closeEdge();interrupt();focus=side;readingSide=side==='left'?0:1;render();const e=envelope(),outer=side==='left'?-e.left:e.right-960;
    scale=clamp((view.w-32)/(480+outer),fitScale,MAX_SCALE);
    // A fixed double-column page must not become 7 px text on a phone. Keep
    // its outer column and compact book index readable; pan to the inner column.
    if(view.w<560)scale=Math.max(1,scale);
    x=view.w<560&&side==='right'?view.w-18-e.right*scale:16+(side==='left'?outer:-480)*scale;
    y=18;constrain();transform();save();
  }
  function zoom(next,at={x:view.w/2,y:view.h/2}){
    closeEdge();interrupt();next=clamp(next,fitScale,MAX_SCALE);
    x=at.x-(at.x-x)/scale*next;y=at.y-(at.y-y)/scale*next;
    scale=next;focus='custom';constrain();transform();save();
  }
  function resize(){
    const pose=capturePose();interrupt();view={w:stage.clientWidth,h:stage.clientHeight};
    if(!view.w||!view.h)return;fitScale=measureFit();
    if(edgeSide){expandEdge(edgeSide);return;}
    if(focus==='fit')scale=fitScale;
    else{scale=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;}
    constrain();transform();
  }
  function clearHold(){clearTimeout(holdTimer);holdTimer=null;}
  function startFold(direction,contact,count=1,source='manual'){
    if(fold||jumpState)return false;
    const target=clamp(spread+direction*count*2,0,MAX_SPREAD);
    if(target===spread){feedback(direction>0?'已经到最后一页':'已经到第一页');return false;}
    const side=direction>0?1:0;
    fold={from:spread,target,direction,side,count:Math.abs(target-spread)/2,source,
      radius:clamp(Math.abs(contact.x-480),12,476),grabY:clamp(contact.y,0,704),
      progress:0,vertical:0,velocity:0,samples:[],settling:false,original:papers[side].innerHTML};
    renderer.prepare(spread+side,direction>0?target:target+1,direction,fold.count);
    papers[side].innerHTML=svgPage(direction>0?target+1:target);
    papers[side].classList.add('under-curl');book.classList.add('curl-active');
    stage.dataset.foldState=source==='manual'?'held':'automatic';updateIndex();
    updateFold(source==='manual'?.006:0,0);return true;
  }
  function updateFold(progress,vertical,t){
    if(!fold)return;const f=fold;f.progress=clamp(progress,0,1);f.vertical=clamp(vertical,-210,210);
    if(t!==undefined){
      f.samples.push({p:f.progress,t});while(f.samples.length>2&&t-f.samples[0].t>140)f.samples.shift();
      f.velocity=(f.progress-f.samples[0].p)/Math.max(1,t-f.samples[0].t)*1000;
    }
    renderer.draw({progress:f.progress,radius:f.radius,grabY:f.grabY,vertical:f.vertical});
    stage.dataset.foldProgress=f.progress.toFixed(4);
    applyMaterial(Material.sampleTurn(f.from,f.direction,f.count,f.progress,D.pages.length,D.books));
  }
  function finishFold(commit){
    if(!fold)return;const f=fold;cancelAnimationFrame(foldFrame);foldFrame=0;
    renderer.hide();book.classList.remove('curl-active');papers[f.side].classList.remove('under-curl');fold=null;
    if(commit){spread=f.target;readingSide=focus==='left'?0:1;render();fitScale=measureFit();if(focus==='fit')scale=fitScale;constrain();transform();save();}
    else{papers[f.side].innerHTML=f.original;applyMaterial();updateIndex();}
    stage.dataset.foldState=commit?'committed':'returned';delete stage.dataset.foldProgress;
    $('touch-ring').style.display='none';$('touch-ring').classList.remove('holding');
    if(f.source==='manual')feedback(commit?'已翻页':'已放回原页');
    if(queuedTurns.length)turn(...queuedTurns.shift());
  }
  function settleFold(commit,automatic=false){
    if(!fold||fold.settling)return;const f=fold;f.settling=true;
    stage.dataset.foldState=commit?'settling-forward':'settling-back';
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){finishFold(commit);return;}
    const start=f.progress,target=commit?1:0,vertical=f.vertical,started=performance.now();
    const duration=automatic?260:Math.max(120,260*Math.abs(target-start));
    function frame(now){
      if(fold!==f)return;const t=clamp((now-started)/duration,0,1);
      updateFold(start+(target-start)*(1-Math.cos(t*Math.PI))/2,vertical*(1-t));
      if(t===1)finishFold(commit);else foldFrame=requestAnimationFrame(frame);
    }
    foldFrame=requestAnimationFrame(frame);
  }
  function turn(direction,count=1,source='tap'){
    if(edgeSide||jumpState||chapters?.isOpen())return;
    clearHold();
    if(fold){if(fold.settling&&queuedTurns.length<8)queuedTurns.push([direction,count,source]);return;}
    if(startFold(direction,{x:480+direction*392,y:360},count,source))settleFold(true,true);
  }
  function interrupt(){
    clearHold();queuedTurns=[];cancelAnimationFrame(demoFrame);demoFrame=0;
    pointers.clear();gesture=null;stage.classList.remove('dragging');
    chapters?.close();
    if(jumpState){jumpState=null;pageJump.cancel();render();stage.dataset.jumpState='cancelled';}
    if(fold)finishFold(false);
  }
  function jump(page,pose){
    closeEdge();interrupt();$('book-picker').close();
    page=clamp(page,0,D.pages.length-1);
    const target=clamp(page&~1,0,MAX_SPREAD),transaction={from:spread,target,page,pose};
    jumpState=transaction;
    const complete=()=>{
      if(jumpState!==transaction)return; // A cancelled/replaced animation cannot move the saved bookmark.
      jumpState=null;spread=target;readingSide=page&1;render();fitScale=measureFit();
      if(pose){scale=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;focus=pose.focus||'custom';}
      else if(view.w<560&&focus!=='fit'){focusPage(page%2?'right':'left');}
      else if(focus==='fit')scale=fitScale;
      constrain();transform();save();stage.dataset.lastGesture='directory';stage.dataset.jumpState='committed';
      feedback(`${currentBook().name} · ${readingPage().start||'卷首'}`);
    };
    if(target===spread){complete();return;}
    // The stationary page underneath the moving packet already belongs to the
    // destination. Reading metadata and persistence still belong to the source.
    const forward=target>spread;
    papers[forward?1:0].innerHTML=svgPage(target+(forward?1:0));
    stage.dataset.jumpState='running';stage.dataset.jumpTarget=String(target);updateIndex();
    pageJump.start({from:spread,to:target,onFinish:complete,onCancel:()=>{
      if(jumpState!==transaction)return;
      jumpState=null;render();stage.dataset.jumpState='cancelled';
    }});
  }
  chapters=window.PaperEdgeChapters.create(document.querySelector('.stage-wrap'),{books:D.books,onSelect:page=>jump(page),
    getCurrent:()=>({bookIndex:D.books.indexOf(currentBook()),chapter:parseInt(readingPage().start,10)||1})});
  function openEdgeChapters(i,_book,metadata={}){
    interrupt();
    chapters.open({bookIndices:metadata.bookIndices||[i],index:i,anchor:metadata.anchor});
  }
  ribbons=window.PaperRibbons.create({host:$('ribbon-bookmarks'),panelHost:document.querySelector('.stage-wrap'),storage,pageCount:D.pages.length,
    getCurrent:()=>({spread,page:readingPage()===D.pages[spread+1]?spread+1:spread,bookName:currentBook().name,ref:readingPage().start||'',pose:edgePose||capturePose()}),onNavigate:jump});
  ribbons.setScene(true);
  function openPicker(){
    closeEdge();interrupt();$('book-picker-books').hidden=false;$('book-picker-chapters').hidden=true;$('book-picker-back').hidden=true;
    $('book-picker-title').textContent='书卷与章节';$('book-picker').showModal();
  }
  function showChapters(i){
    const b=D.books[i],host=$('book-picker-chapters');host.replaceChildren();
    const add=(text,page)=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>jump(page);host.appendChild(button);};
    add('卷首',b.first);for(const c of b.chapters)add(`第 ${c.chapter} 章`,c.page);
    $('book-picker-title').textContent=b.name;$('book-picker-books').hidden=true;host.hidden=false;$('book-picker-back').hidden=false;
  }
  D.books.forEach((b,i)=>{const button=document.createElement('button');button.type='button';button.textContent=b.name;button.onclick=()=>showChapters(i);$('book-picker-books').appendChild(button);});
  $('book-picker-back').onclick=()=>{ $('book-picker').close();openPicker(); };
  $('book-picker-close').onclick=()=>$('book-picker').close();
  $('location-button').onclick=openPicker;
  window.addEventListener('paper-directory-request',openPicker);
  window.addEventListener('paper-ribbons-request',()=>{closeEdge();interrupt();ribbons.open(0);});
  window.addEventListener('paper-interrupt',()=>{closeEdge();interrupt();});
  const relative=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp??performance.now()};};
  const centroid=()=>{const a=[...pointers.values()];return {x:a.reduce((s,p)=>s+p.x,0)/a.length,y:a.reduce((s,p)=>s+p.y,0)/a.length,t:Math.max(...a.map(p=>p.t))};};
  const distance=()=>{const a=[...pointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);};
  function pointerDown(e){
    if(edgeSide||jumpState||chapters?.isOpen()||e.button>0||e.target?.closest?.('button,a,input,dialog,.paper-ribbons,.edge-index'))return;
    if(pointers.size===0&&demoFrame)interrupt();clearHold();
    pointers.set(e.pointerId,relative(e));try{stage.setPointerCapture(e.pointerId);}catch{}
    if(pointers.size>1){
      if(fold&&!fold.settling){queuedTurns=[];finishFold(false);}
      const c=centroid();gesture={pinched:true,start:c,baseX:x,baseY:y,baseScale:scale,baseDistance:distance()};return;
    }
    const start=relative(e),local={x:(start.x-x)/scale,y:(start.y-y)/scale};
    const g=gesture={start,end:start,side:local.x>=0&&local.x<=960&&local.y>=0&&local.y<=704?(local.x<480?-1:1):0,
      baseX:x,baseY:y,baseScale:scale,moved:false,holding:false,pinched:false};
    stage.classList.add('dragging');
    if(g.side&&!fold)holdTimer=setTimeout(()=>{
      holdTimer=null;if(gesture!==g||pointers.size!==1||g.moved||g.pinched)return;
      // A held boundary contact is consumed even if no further page exists.
      g.held=true;
      if(startFold(g.side,local,1,'manual')){
        g.holding=true;g.holdOrigin=centroid();g.holdRadius=fold.radius;
        $('touch-ring').classList.add('holding');$('touch-ring').style.display='block';
        $('touch-ring').style.left=start.x-15+'px';$('touch-ring').style.top=start.y-15+'px';
        feedback('已捏住纸页 · 拖动掀开，回拖放回',0);
      }
    },HOLD_MS);
  }
  function pointerMove(e){
    if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,relative(e));
    const g=gesture,c=centroid();g.end=c;
    if(g.pinched){
      if(pointers.size<2)return;
      scale=clamp(g.baseScale*distance()/Math.max(1,g.baseDistance),fitScale,MAX_SCALE);
      x=c.x-(g.start.x-g.baseX)/g.baseScale*scale;y=c.y-(g.start.y-g.baseY)/g.baseScale*scale;
      focus='custom';constrain();transform();return;
    }
    if(g.holding&&fold&&!fold.settling){
      updateFold(.006-(c.x-g.holdOrigin.x)*fold.direction/(g.baseScale*2*g.holdRadius),(c.y-g.holdOrigin.y)/g.baseScale,c.t);
      $('touch-ring').style.left=c.x-15+'px';$('touch-ring').style.top=c.y-15+'px';return;
    }
    const dx=c.x-g.start.x,dy=c.y-g.start.y;
    if(Math.hypot(dx,dy)>MOVE_SLOP){g.moved=true;clearHold();}
    if(g.moved&&!fold){x=g.baseX+dx;y=g.baseY+dy;focus='custom';constrain();transform();}
  }
  function pointerUp(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    // Browsers can coalesce the last move into pointerup. The final contact,
    // especially a last-moment reversal, must decide the release, not stale ink.
    if(!cancelled)pointerMove(e);
    clearHold();const g=gesture;
    const end=relative(e);pointers.delete(e.pointerId);
    if(cancelled){if(fold&&!fold.settling)settleFold(false);if(g)g.pinched=true;}
    if(pointers.size)return;
    gesture=null;stage.classList.remove('dragging');try{stage.releasePointerCapture(e.pointerId);}catch{}
    if(!g)return;
    if(g.holding&&fold&&!fold.settling){settleFold(Physics.release(fold.progress,fold.velocity,cancelled));stage.dataset.lastGesture='physical-curl';return;}
    // No minimum duration and no double-click timer. Release starts the turn.
    if(!cancelled&&!g.pinched&&!g.moved&&!g.held&&g.side&&Math.hypot(end.x-g.start.x,end.y-g.start.y)<=MOVE_SLOP){
      stage.dataset.lastGesture='tap-turn';turn(g.side);return;
    }
    stage.dataset.lastGesture=cancelled?'cancelled':g.pinched?'pinch':'pan';save();
  }
  stage.addEventListener('pointerdown',pointerDown);stage.addEventListener('pointermove',pointerMove);
  stage.addEventListener('pointerup',e=>pointerUp(e));stage.addEventListener('pointercancel',e=>pointerUp(e,true));
  stage.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))pointerUp(e,true);});
  window.addEventListener('blur',interrupt);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();});
  stage.addEventListener('wheel',e=>{
    if(edgeSide||jumpState||chapters?.isOpen()){e.preventDefault();return;}
    if(e.target?.closest?.('button,dialog'))return;e.preventDefault();if(fold||pointers.size)return;
    if(e.ctrlKey||e.metaKey)zoom(scale*Math.exp(-e.deltaY*.003),relative(e));
    else{x-=e.deltaX;y-=e.deltaY;focus='custom';constrain();transform();save();}
  },{passive:false});
  stage.addEventListener('keydown',e=>{
    if(jumpState||chapters?.isOpen()){if(e.key==='Escape'){e.preventDefault();interrupt();}return;}
    if(edgeSide){if(e.key==='Escape'){e.preventDefault();closeEdge();}return;}
    if(e.target?.closest?.('button,input,dialog'))return;
    if(e.key==='ArrowRight'){e.preventDefault();turn(1);}else if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}
    else if(e.key==='Escape')interrupt();else if(e.key==='+'||e.key==='=')zoom(scale*1.2);else if(e.key==='-')zoom(scale/1.2);else if(e.key==='0')fit();
  });
  $('fit-book').onclick=fit;$('zoom-value').onclick=fit;
  $('focus-left').onclick=()=>focusPage('left');$('focus-right').onclick=()=>focusPage('right');
  $('zoom-in').onclick=()=>{closeEdge();zoom(scale*1.3);};
  $('zoom-out').onclick=()=>{closeEdge();zoom(scale/1.3);};
  $('prev').onclick=()=>turn(-1);$('next').onclick=()=>turn(1);
  $('about-open').onclick=()=>{closeEdge();interrupt();$('about-dialog').showModal();};
  $('help-open').onclick=()=>{closeEdge();interrupt();$('help-dialog').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelector('.brand')?.addEventListener('click',e=>{e.preventDefault();fit();});
  $('demo-burst').onclick=()=>turn(1);
  $('demo-pan').onclick=()=>{focusPage('right');feedback('直接拖动平移；按住片刻再拖动，才会掀页');};
  $('demo-peek').onclick=()=>{
    closeEdge();interrupt();const direction=spread<MAX_SPREAD?1:-1;
    if(!startFold(direction,{x:480+direction*350,y:310},1,'manual'))return;
    const started=performance.now();
    function frame(now){
      const t=clamp((now-started)/1600,0,1);updateFold(.38*Math.sin(Math.PI*t)**2,-12*Math.sin(Math.PI*t));
      if(t===1){demoFrame=0;finishFold(false);feedback('掀开再放回 · 页码不变');}else demoFrame=requestAnimationFrame(frame);
    }
    demoFrame=requestAnimationFrame(frame);
  };
  stage.dataset.scene='reading';stage.dataset.holdMs=String(HOLD_MS);
  window.PaperImmersion?.setScene?.('reading');
  render();resize();
  if(saved?.zoom>1&&Number.isFinite(saved.centerX)&&Number.isFinite(saved.centerY)){
    scale=clamp(fitScale*saved.zoom,fitScale,MAX_SCALE);x=view.w/2-saved.centerX*scale;y=view.h/2-saved.centerY*scale;focus=saved.focus||'custom';constrain();transform();
  }
  // On a phone a single page is the useful initial reading window; whole-book
  // fit remains available, and both index bands stay reachable by pan.
  else if(view.w<560)focusPage(readingSide?'right':'left');
  new ResizeObserver(resize).observe(stage);window.addEventListener('resize',resize);
  save();
})();
