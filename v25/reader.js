/* Text selection and blank-space swiping share a single pointer arbiter. */
(() => {
  'use strict';
  if(window.PAPER_READER_ERROR)return;
  const $=id=>document.getElementById(id),D=window.BIBLE_DATA;
  const Page=window.PaperPage,Material=window.PaperBookMaterial;
  const stage=$('stage'),book=$('book'),papers=[$('left-paper'),$('right-paper')];
  // Touch devices can drop large composited tiles when a zoomed spread is
  // also used as a snapshot, transformed leaf or cover animation. Keep the
  // V25 touch reader in the normal paint path, including large tablets.
  const flatTouch=document.documentElement.dataset.readerBuild==='index-25'&&
    (matchMedia('(pointer: coarse)').matches||/Android/i.test(navigator.userAgent));
  if(flatTouch)stage.dataset.paperPaint='flat-touch';
  const v25=document.documentElement.dataset.readerBuild==='index-25';
  const curl=v25?new URLSearchParams(location.search).get('curl'):null;
  // The ordinary physical V25 entry includes the tested full reader. An
  // explicit no-motion route and the system's accessibility setting remain.
  const smoothProfile=v25&&(D.physical===true||curl==='smooth');
  const noTurnMotion=curl==='off';
  const smoothTurn=smoothProfile&&!noTurnMotion&&(!flatTouch||CSS.supports('zoom','1'));
  if(smoothProfile)stage.dataset.edgeProfile='slim';
  if(smoothTurn)stage.dataset.turnStyle='smooth';
  const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LAST_PAGE=D.readingLastPage??D.pages.length-1;
  const TEXT_HOLD_MS=360,MOVE_SLOP=8,SWIPE_MIN=30,MAX_SCALE=3.2,MAX_SPREAD=Math.min(LAST_PAGE&~1,(D.pages.length-2)&~1);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let spread=0,scale=1,fitScale=1,x=0,y=0,focus='fit',view={w:0,h:0};
  let fold=null,foldFrame=0,holdTimer=null,feedbackTimer=null,gesture=null,chapters=null,jumpState=null;
  let finder=null,searchAnchor=null;
  let saved=null,storage,queuedTurns=[],readingSide=1,selection=null,history=null,preciseRef=null;
  const pointers=new Map();
  let suppressBandClick=null, coverZoom=null;
  let startShortcut=null,startShortcutTimer=0,startShortcutSpread=null,startPanFrame=0,startPanKind=null;
  let columnShortcut=null,columnShortcutTimer=0,columnOffer=null,columnGeometry=null,columnReading=null;
  try{storage=window.PAPER_READER_STORAGE||window.localStorage;saved=JSON.parse(storage?.getItem('paper-bible-position-v1')||'null');}catch{}
  if(saved&&Number.isFinite(saved.spread))spread=clamp(saved.spread&~1,0,MAX_SPREAD);
  if(saved?.page===spread)readingSide=0;
  if(Number.isInteger(window.PAPER_INITIAL_SPREAD)){spread=clamp(window.PAPER_INITIAL_SPREAD&~1,0,MAX_SPREAD);saved=null;readingSide=1;}
  if(Number.isInteger(window.PAPER_INITIAL_PAGE))readingSide=window.PAPER_INITIAL_PAGE&1;
  const svgPage=index=>Page.svg(D.pages[index],index,D.books);
  const chapterPreview=window.PaperChapterPreview.create(window.BIBLE_SOURCE);
  const renderer=window.PaperSheetRenderer.vector(book,svgPage,
    (canvas,index,ratio)=>Page.paint(canvas,D.pages[index],index,D.books,ratio));
  const desk=window.PaperBookDesk?.create(stage,$('desk-surface'));let deskKey=null;
  const pageJump=window.PaperJump.create(book,{renderPage:svgPage});
  const index=window.PaperEdgeIndex.create($('edge-index-host'),{books:D.books,pageCount:D.pages.length,onSelect:openEdgeChapters,depthScale:smoothProfile ? .70 : 1});
  const readingPage=()=>{
    const a=D.pages[spread+1-readingSide],b=D.pages[spread+readingSide];
    return b.b>=0&&!b.blank&&b.start?b:a.b>=0&&!a.blank&&a.start?a:b;
  };
  const currentBook=()=>D.books[Math.max(0,readingPage().b)]||D.books[0];
  // A page may start in one chapter and contain the opening of the next.
  // Keep the requested verse while on this face; page-turn commits reset it.
  function readingLocation(){
    const p=readingPage(),b=currentBook(),page=p===D.pages[spread]?spread:spread+1;
    const ref=preciseRef?.page===page&&preciseRef.bookCode===b.code&&preciseRef.ref||p.start||'';
    return {page,bookName:b.name,bookCode:b.code,ref};
  }
  if(saved?.explicitRef&&saved.ref&&saved.bookName===currentBook().name&&saved.page===readingLocation().page){
    preciseRef={page:saved.page,bookCode:currentBook().code,ref:saved.ref};
  }
  if(window.PAPER_INITIAL_REF&&window.PAPER_INITIAL_REF.page===readingLocation().page)preciseRef=window.PAPER_INITIAL_REF;
  const capturePose=()=>({zoom:scale/fitScale,cx:(view.w/2-x)/scale,cy:(view.h/2-y)/scale,focus});
  function save(){
    const p=capturePose();
    try{storage?.setItem('paper-bible-position-v1',JSON.stringify({spread,page:Math.min(spread+readingSide,LAST_PAGE),zoom:p.zoom,centerX:p.cx,centerY:p.cy,focus,bookName:currentBook().name,ref:readingLocation().ref,explicitRef:!!preciseRef&&preciseRef.page===readingLocation().page,edition:D.edition}));}catch{}
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
  function applyMaterial(material=Material.compute(spread,D.pages.length,D.books)){
    for(const side of ['left','right']){
      const depth=material[side+'Depth'];
      // Continuous, uncut paper edges. No repeated grooves or printed strata.
      $(side+'-paper-edges').innerHTML=window.PaperEdges.render(side,depth);
    }
  }
  function markSearchInk(){
    if(!preciseRef?.search||preciseRef.page!==spread+readingSide)return;
    const [ch,v]=preciseRef.ref.split(':').map(Number);
    papers[readingSide].querySelectorAll('text[data-ref]').forEach(el=>{
      const m=/^(\d+):(\d+)(?:-(\d+))?$/.exec(el.dataset.ref);
      if(m&&+m[1]===ch&&+m[2]<=v&&v<=+(m[3]||m[2]))el.classList.add('vf-found');
    });
  }
  function render({reusePages=false,keepFocus=false}={}){
    if(!reusePages){
      selection?.reset({keepFocus});
      papers.forEach((paper,i)=>paper.innerHTML=svgPage(spread+i));
      selection?.refresh?.();markSearchInk();
    }
    const b=currentBook(),p=readingPage(),ref=readingLocation().ref||'1:1',last=preciseRef?.page===readingLocation().page?ref:p.end||ref;
    $('book-name').textContent=b.name;
    $('chapter-name').textContent=ref.split(':')[0]===last.split(':')[0]?`第 ${ref.split(':')[0]} 章`:`${ref.split(':')[0]}–${last.split(':')[0]} 章`;
    const label=q=>q.blank?'空白':q.frontmatter?'卷首':String(q.displayPage??D.pages.indexOf(q));
    $('page-label').textContent=spread+1>LAST_PAGE?label(D.pages[spread]):`${label(D.pages[spread])} — ${label(D.pages[spread+1])}`;
    const progress=(spread+1)/(D.readingLastPage==null?D.pages.length-1:MAX_SPREAD+1);
    $('progress-label').textContent=`${b.short} · 全书 ${Math.round(progress*100)}%`;
    $('read-block').style.width=progress*100+'%';$('position-pin').style.left=progress*100+'%';
    $('prev').disabled=spread===0;$('next').disabled=spread===MAX_SPREAD;
    stage.dataset.spread=String(spread);stage.dataset.book=b.code;
    if(!reusePages)applyMaterial();
    updateIndex();
  }
  function envelope(){
    const e=index.getBounds();
    return {left:-Math.max(16,e.leftExtent),right:960+Math.max(16,e.rightExtent),bottom:724};
  }
  function constrain(){
    const e=envelope(),w=(e.right-e.left)*scale,h=e.bottom*scale,pad=18;
    if(w<=view.w-pad*2)x=view.w/2-(e.left+e.right)*scale/2;
    else x=clamp(x,view.w-pad-e.right*scale,pad-e.left*scale);
    if(h<=view.h-pad*2)y=(view.h-h)/2;
    else y=clamp(y,view.h-pad-h,pad);
  }
  function transform(){
    if(flatTouch&&CSS.supports('zoom','1')){
      // CSS zoom affects the layout coordinate system, so divide offsets by
      // zoom to retain exactly the same hit-test and pan coordinates.
      book.style.zoom=String(scale);book.style.left=x/scale+'px';book.style.top=y/scale+'px';
      book.style.transform='none';
    }else book.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    if(!v25)$('zoom-value').textContent=Math.round(scale/fitScale*100)+'%';
    coverZoom?.sync(scale,fitScale,MAX_SCALE);
    $('zoom-in').disabled=scale>=MAX_SCALE;$('zoom-out').disabled=scale<=fitScale;
    stage.dataset.scale=scale.toFixed(4);stage.dataset.x=x.toFixed(2);stage.dataset.y=y.toFixed(2);
    ['fit-book','focus-left','focus-right'].forEach((id,i)=>$(id).classList.toggle('active',focus===['fit','left','right'][i]));
    $('surface-caption').style.opacity=scale>fitScale*1.2?'0':'1';
    updateIndex();chapters?.reposition?.();finder?.layout();window.dispatchEvent(new Event('v25-camera-changed'));
  }
  function measureFit(){const e=envelope(),margin=view.w<560?30:120;return Math.min((view.w-margin)/(e.right-e.left),(view.h-(view.w<560?38:120))/e.bottom);}
  function fit(){interrupt();focus='fit';fitScale=measureFit();scale=fitScale;constrain();transform();save();}
  // Paper identities identify a spread, not its chapter/verse position.
  // Use the exact destination's printed ink in the existing coordinate system.
  function positionReadingAnchor(requested){
    if(!v25||!D.physical||!requested?.ref||
      (960*scale<=view.w+2&&704*scale<=view.h+2))return null;
    const page=requested.page,side=page-spread,p=D.pages[page];
    if(side<0||side>1||D.books[p?.b]?.code!==requested.bookCode)return null;
    const match=/^(\d+):(\d+)(?:[-–]\d+)?$/.exec(requested.ref);
    if(!match)return null;
    const [,ch,ver]=match,number=+ver;
    const ink=(Page.commands?.(p,page,D.books)||[]).filter(c=>{
      if(!c.physicalInk||c.hideHatch||!['body','verse','chapter','heading'].includes(c.role)||
        ![c.x,c.y,c.w,c.h].every(Number.isFinite))return false;
      const ref=/^(\d+):(\d+)(?:[-–](\d+))?$/.exec(c.ref);
      return ref&&ref[1]===ch&&number>=+ref[2]&&number<=+(ref[3]||ref[2]);
    });
    const first=ink.find(c=>c.role!=='heading');
    if(!first)return null;
    const id=side*2+((first.x+first.w/2)<240?0:1);
    const lane=readingColumns().find(c=>c.id===id);
    const left=side*480+first.x,right=left+first.w;
    // Prefer a full reading column, but on a very large zoom the exact
    // start can be farther along its line than the window is wide.
    if(960*scale>view.w+2){
      const pad=Math.min(18,view.w*.08);
      x=Math.min(pad-(lane?.left??left)*scale,view.w-pad-right*scale);
      if(left*scale+x<pad&&first.w*scale<view.w-pad*2)x=pad-left*scale;
    }
    if(704*scale>view.h+2){
      const lead=ink.slice(0,ink.indexOf(first)).filter(c=>c.role==='heading'&&
        (c.x+c.w/2<240)===(first.x+first.w/2<240)&&first.y-c.y<=48&&c.y<=first.y);
      const top=Math.min(first.y,...lead.map(c=>c.y));
      y=Math.min(Math.min(88,view.h*.15)-top*scale,view.h-18-(first.y+first.h)*scale);
    }
    focus='custom';return id;
  }
  function preferReadingColumn(id){
    if(id!==null)columnReading={spread,id,x,scale};
  }
  function focusPage(side,arriving=false){
    if(!arriving)interrupt();focus=side;readingSide=side==='left'?0:1;render({keepFocus:true});const e=envelope(),outer=side==='left'?-e.left:e.right-960;
    scale=clamp((view.w-32)/(480+outer),fitScale,MAX_SCALE);
    // A fixed double-column page must not become 7 px text on a phone. Keep
    // its outer column and compact book index readable; pan to the inner column.
    if(view.w<560)scale=Math.max(1,scale);
    x=view.w<560&&side==='right'?view.w-18-e.right*scale:16+(side==='left'?outer:-480)*scale;
    y=18;const id=positionReadingAnchor(arriving?preciseRef:null);constrain();preferReadingColumn(id);transform();save();
  }
  function zoom(next,at={x:view.w/2,y:view.h/2}){
    searchAnchor=null;interrupt(true);next=clamp(next,fitScale,MAX_SCALE);
    x=at.x-(at.x-x)/scale*next;y=at.y-(at.y-y)/scale*next;
    scale=next;focus=scale===fitScale?'fit':'custom';constrain();transform();save();
  }
  // The loose paper overlays live outside the stage; zoom the book, not the web page.
  window.addEventListener('v25-paper-zoom',e=>{
    const {factor,x:ax,y:ay}=e.detail||{},r=stage.getBoundingClientRect();
    if(!fold&&!jumpState&&Number.isFinite(factor)&&factor>0)zoom(scale*factor,{x:ax-r.left,y:ay-r.top});
  });
  function resize(){
    if(view.w===stage.clientWidth&&view.h===stage.clientHeight)return;
    const widthChanged=view.w!==stage.clientWidth;
    const pose=capturePose(),dock=chapters?.getDock?.();
    if(!dock)interrupt(true);view={w:stage.clientWidth,h:stage.clientHeight};
    if(!view.w||!view.h)return;fitScale=measureFit();
    if(dock){
      const r=stage.getBoundingClientRect(),ax=dock.x-r.left,ay=dock.y-r.top;
      const next=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);
      x=clamp(ax,8,view.w-8)-(ax-x)*next/scale;y=clamp(ay,8,view.h-8)-(ay-y)*next/scale;
      scale=next;transform();return;
    }
    if(focus==='fit')scale=fitScale;
    else{scale=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;}
    if(widthChanged&&searchAnchor&&searchAnchor===preciseRef){
      if(view.w<640)scale=Math.max(1,scale);
      positionReadingAnchor(searchAnchor);
    }
    constrain();transform();
  }
  function zoomWithChapterMenu(factor){
    const dock=chapters?.getDock?.();if(!dock||!Number.isFinite(factor)||factor<=0)return;
    const r=stage.getBoundingClientRect(),ax=dock.x-r.left,ay=dock.y-r.top,next=clamp(scale*factor,fitScale,MAX_SCALE);
    x=ax-(ax-x)*next/scale;y=ay-(ay-y)*next/scale;scale=next;focus='custom';transform();save();
  }
  function hideStartShortcut(){
    clearTimeout(startShortcutTimer);startShortcutTimer=0;startShortcutSpread=null;
    if(!startShortcut||startShortcut.hidden)return;
    if(document.activeElement===startShortcut)stage.focus({preventScroll:true});
    startShortcut.hidden=true;
  }
  function cancelStartPan(){
    if(!startPanFrame)return;
    cancelAnimationFrame(startPanFrame);startPanFrame=0;
    stage.dataset[startPanKind]='cancelled';startPanKind=null;save();
  }
  function panToReadingPoint(targetX,targetY,side,kind,onCommit){
    const fromX=x,fromY=y;
    x=targetX;y=targetY;constrain();const toX=x,toY=y;
    x=fromX;y=fromY;
    focus='custom';
    const complete=()=>{
      startPanFrame=0;startPanKind=null;stage.dataset[kind]='committed';
      x=toX;y=toY;readingSide=side;onCommit?.();
      render({reusePages:true});transform();save();history?.advance(readingLocation());
    };
    if(reduceMotion()){complete();return;}
    const started=performance.now();
    startPanKind=kind;stage.dataset[kind]='running';
    function frame(now){
      const t=clamp((now-started)/460,0,1);
      if(t===1){complete();return;}
      const eased=(1-Math.cos(t*Math.PI))/2;
      x=fromX+(toX-fromX)*eased;y=fromY+(toY-fromY)*eased;transform();
      startPanFrame=requestAnimationFrame(frame);
    }
    startPanFrame=requestAnimationFrame(frame);
  }
  function offerStartShortcut(direction){
    const forward=direction>0,pad=18;
    const targetX=()=>forward?pad:view.w-pad-960*scale;
    const targetY=()=>forward?pad:view.h-pad-704*scale;
    const needsPan=()=>(960*scale>view.w+2&&Math.abs(x-targetX())>24)||
      (704*scale>view.h+2&&Math.abs(y-targetY())>24);
    if(!needsPan())return;
    if(!startShortcut){
      startShortcut=document.createElement('button');startShortcut.type='button';
      startShortcut.id='spread-start-shortcut';startShortcut.className='spread-start-shortcut';
      startShortcut.hidden=true;stage.append(startShortcut);
      startShortcut.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hideStartShortcut();}
      });
    }
    hideStartShortcut();startShortcutSpread=spread;startShortcut.hidden=false;
    startShortcut.textContent=forward?'↖ 回左上':'↘ 到右下';
    startShortcut.setAttribute('aria-label',forward?'从当前跨页左上角开始阅读':'回到上一跨页的右下角');
    startShortcut.onclick=()=>{
      if(startShortcutSpread!==spread||startShortcut.hidden||fold||jumpState||!needsPan()){
        hideStartShortcut();return;
      }
      hideStartShortcut();columnReading=null;
      panToReadingPoint(targetX(),targetY(),forward?0:1,'spreadStartPan');
    };
    startShortcutTimer=setTimeout(hideStartShortcut,4000);
  }
  // Cache actual ink extents per displayed spread, in the same physical
  // coordinates as the camera. Printed blank columns never become stops.
  function readingColumns(){
    if(columnGeometry?.spread===spread)return columnGeometry.columns;
    const columns=[];
    for(let side=0;side<2;side++){
      const groups=[{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,count:0},
        {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,count:0}];
      for(const c of Page.commands?.(D.pages[spread+side],spread+side,D.books)||[]){
        if(!c.physicalInk||c.hideHatch||!['body','verse','heading','chapter'].includes(c.role)||
          ![c.x,c.y,c.w,c.h].every(Number.isFinite))continue;
        const lane=c.x+c.w/2<240?0:1,a=groups[lane],offset=side*480;
        a.left=Math.min(a.left,c.x+offset);a.right=Math.max(a.right,c.x+c.w+offset);
        a.top=Math.min(a.top,c.y);a.bottom=Math.max(a.bottom,c.y+c.h);
        if(c.role==='body')a.count++;
      }
      groups.forEach((a,lane)=>{if(a.count>0)columns.push({...a,id:side*2+lane,side});});
    }
    columnGeometry={spread,columns};
    return columns;
  }
  const mobileClippedReading=pointerType=>v25&&D.physical&&flatTouch&&pointerType==='touch'&&focus!=='fit'&&
    (960*scale>view.w+2||704*scale>view.h+2);
  function mobileReadingColumn(pointerType){
    if(!mobileClippedReading(pointerType))return null;
    const columns=readingColumns();
    // If all the ink lanes fit horizontally, ordinary vertical reading
    // already exposes them together and does not need a sideways shortcut.
    if(!columns.length||(columns.at(-1).right-columns[0].left)*scale<=view.w-12)return null;
    const visible=columns.filter(c=>c.right*scale+x>16&&c.left*scale+x<view.w-16);
    if(!visible.length)return null;
    const anchored=columnReading?.spread===spread&&columnReading.scale===scale&&Math.abs(columnReading.x-x)<24&&
      visible.find(c=>c.id===columnReading.id);
    const lane=anchored||visible.reduce((a,b)=>{
      const score=c=>Math.abs(c.left*scale+x-18)+(c.right*scale+x<view.w*.25?view.w:0);
      return score(b)<score(a)?b:a;
    });
    // Seeing the last glyph is not the same as seeing the end of the paper.
    // Leave a visible strip beyond the page so a clipped line can't look final.
    const pageFoot=y+704*scale,inkFoot=y+lane.bottom*scale;
    return {next:columns[columns.indexOf(lane)+1],atBottom:pageFoot<=view.h-12&&inkFoot<=view.h-12};
  }
  function hideColumnShortcut(){
    clearTimeout(columnShortcutTimer);columnShortcutTimer=0;columnOffer=null;
    if(!columnShortcut||columnShortcut.hidden)return;
    if(document.activeElement===columnShortcut)stage.focus({preventScroll:true});
    columnShortcut.hidden=true;
  }
  function offerNextColumn(next){
    if(!next||selection?.isActive()||jumpState||fold)return;
    if(!columnShortcut){
      columnShortcut=document.createElement('button');columnShortcut.type='button';
      columnShortcut.id='next-column-shortcut';columnShortcut.className='spread-start-shortcut';
      columnShortcut.textContent='栏底 · 下一栏 ↱';columnShortcut.setAttribute('aria-label','已到本栏底部，从下一栏顶部开始阅读');
      columnShortcut.hidden=true;stage.append(columnShortcut);
      const activate=()=>{
        const offer=columnOffer;hideColumnShortcut();
        if(!offer||offer.spread!==spread||fold||jumpState||selection?.isActive())return;
        const {next}=offer;
        const targetY=18-next.top*scale;
        panToReadingPoint(18-next.left*scale,targetY,next.side,'columnPan',()=>{
          columnReading={spread,id:next.id,x,scale};
        });
      };
      columnShortcut.addEventListener('click',e=>{if(e.pointerType!=='touch'&&
        (e.detail===0||e.pointerType==='mouse'||performance.now()>touchClickFence))activate();});
      // Immediately after a pan, Chrome may dispatch touch pointer events
      // but suppress the synthetic click. Confirm the short tap directly.
      let contact=null,touchClickFence=0;
      columnShortcut.addEventListener('pointerdown',e=>{
        if(e.pointerType!=='touch'||!e.isPrimary)return;
        touchClickFence=performance.now()+700;contact={id:e.pointerId,x:e.clientX,y:e.clientY};
        try{columnShortcut.setPointerCapture(e.pointerId);}catch{}
      });
      columnShortcut.addEventListener('pointermove',e=>{
        if(contact?.id===e.pointerId&&Math.hypot(e.clientX-contact.x,e.clientY-contact.y)>8)contact=null;
      });
      columnShortcut.addEventListener('pointerup',e=>{
        if(e.pointerType==='touch')touchClickFence=performance.now()+700;
        if(contact?.id!==e.pointerId)return;
        const start=contact;contact=null;
        const r=columnShortcut.getBoundingClientRect();
        if(!columnShortcut.hidden&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<=8&&
          e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){e.preventDefault();activate();}
      });
      for(const name of ['pointercancel','lostpointercapture'])columnShortcut.addEventListener(name,e=>{
        if(contact?.id===e.pointerId)contact=null;
      });
      columnShortcut.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hideColumnShortcut();}
      });
    }
    hideStartShortcut();hideColumnShortcut();columnOffer={spread,next};
    columnShortcut.hidden=false;columnShortcutTimer=setTimeout(hideColumnShortcut,2000);
  }
  const isReadingDownStroke=(dx,dy)=>dy<0&&-dy>=Math.abs(dx)*(dx>0?.35:.8);
  function clearHold(){clearTimeout(holdTimer);holdTimer=null;}
  function startFold(direction,count=1,source='control',contact=null){
    if(fold||jumpState)return false;
    hideStartShortcut();hideColumnShortcut();cancelStartPan();
    const target=clamp(spread+direction*count*2,0,MAX_SPREAD);
    if(target===spread){feedback(direction>0?'已经到最后一页':'已经到第一页');return false;}
    const side=direction>0?1:0;
    selection?.reset({keepFocus:true});
    const grabY=contact?.grabY??628;
    const animate=!noTurnMotion&&(!flatTouch||smoothTurn)&&!reduceMotion();
    const offerStart=v25&&Math.abs(target-spread)===2;
    fold={from:spread,target,direction,side,count:Math.abs(target-spread)/2,source,offerStart,
      radius:contact?.radius??450,grabY,corner:grabY<352?'top':'bottom',vertical:0,
      progress:0,settling:false,animate,original:animate?papers[side].innerHTML:null};
    if(!animate){stage.dataset.foldState='dragging';return true;}
    renderer.prepare(spread+side,direction>0?target:target+1,direction,smoothTurn);
    papers[side].classList.add('under-curl');book.classList.add('curl-active');
    updateFold(0);
    // The opaque source leaf is already in place; only the portion uncovered
    // by its projected outer edge may paint ink from the destination page.
    papers[side].innerHTML=svgPage(direction>0?target+1:target);
    stage.dataset.foldState=contact?'dragging':'automatic';updateIndex();return true;
  }
  function updateFold(progress,vertical=0){
    if(!fold)return;const f=fold;f.progress=clamp(progress,0,1);f.vertical=clamp(vertical,-210,210);
    if(!f.animate)return;
    const covered=renderer.draw({progress:f.progress,radius:f.radius,grabY:f.grabY,vertical:f.vertical,corner:f.corner,smooth:smoothTurn});
    const mask=typeof covered==='string'?covered:f.direction>0?'inset(0 0 0 '+covered+'px)':'inset(0 '+covered+'px 0 0)';
    papers[f.side].style.setProperty('--under-sheet-clip',mask);
    stage.dataset.foldProgress=f.progress.toFixed(4);
    // A single leaf transfers a fraction of a pixel of stack thickness.
    // Keep the fixed edge SVGs intact while scrubbing; render() refreshes
    // them on commit, leaving the input frame budget for the moving sheet.
    if(f.count>1)applyMaterial(Material.sampleTurn(f.from,f.direction,f.count,f.progress,D.pages.length,D.books));
  }
  function finishFold(commit){
    if(!fold)return;const f=fold;cancelAnimationFrame(foldFrame);foldFrame=0;
    renderer.hide();book.classList.remove('curl-active');papers[f.side].classList.remove('under-curl');papers[f.side].style.removeProperty('--under-sheet-clip');fold=null;
    if(commit){preciseRef=null;spread=f.target;readingSide=focus==='left'||(focus==='custom'&&(view.w/2-x)/scale<480)?0:1;render();fitScale=measureFit();if(focus==='fit')scale=fitScale;constrain();transform();save();history?.advance(readingLocation());}
    else if(f.animate){papers[f.side].innerHTML=f.original;selection?.refresh?.();applyMaterial();updateIndex();}
    stage.dataset.foldState=commit?'committed':'returned';delete stage.dataset.foldProgress;
    if(queuedTurns.length)turn(...queuedTurns.shift());
    else if(commit&&f.offerStart)offerStartShortcut(f.direction);
  }
  function settleFold(commit=true){
    if(!fold||fold.settling)return;const f=fold;f.settling=true;f.commit=commit;
    stage.dataset.foldState=commit?'settling-forward':'settling-back';
    const start=f.progress,target=commit?1:0,vertical=f.vertical,remaining=Math.abs(target-start);
    if(!f.animate||remaining<.0001||reduceMotion()){finishFold(commit);return;}
    const started=performance.now(),duration=smoothTurn?140+125*remaining:120+180*remaining;
    function frame(now){
      if(fold!==f)return;const t=clamp((now-started)/duration,0,1);
      const eased=smoothTurn?1-(1-t)**3:(1-Math.cos(t*Math.PI))/2;
      updateFold(start+(target-start)*eased,vertical*(1-eased));
      if(t===1)finishFold(commit);else foldFrame=requestAnimationFrame(frame);
    }
    foldFrame=requestAnimationFrame(frame);
  }
  function turn(direction,count=1,source='control'){
    if(jumpState||chapters?.isOpen()||selection?.isActive())return;
    clearHold();
    if(fold){if(fold.settling&&queuedTurns.length<8)queuedTurns.push([direction,count,source]);return;}
    if(startFold(direction,count,source))settleFold();
  }
  function interrupt(keepSelection=false){
    hideStartShortcut();hideColumnShortcut();cancelStartPan();desk?.cancel();columnReading=null;
    clearHold();queuedTurns=[];if(keepSelection!==true)selection?.reset({keepFocus:true});
    pointers.clear();gesture=null;stage.classList.remove('dragging','curl-dragging');
    chapters?.close();
    if(jumpState){jumpState=null;pageJump.cancel();render();stage.dataset.jumpState='cancelled';}
    if(fold)finishFold(false);
  }
  function jump(page,pose,entryId,requested,destinationKey=null){
    interrupt();$('book-picker').close();
    page=clamp(page,0,LAST_PAGE);
    const target=clamp(page&~1,0,MAX_SPREAD),transaction={from:spread,target,page,pose};
    jumpState=transaction;
    const complete=()=>{
      if(jumpState!==transaction)return; // A cancelled/replaced animation cannot move the saved bookmark.
      jumpState=null;spread=target;readingSide=page&1;preciseRef=requested?.ref?{page,bookCode:requested.bookCode,ref:requested.ref,search:!!requested.search}:null;render();fitScale=measureFit();
      if(pose){scale=clamp(pose.zoom*fitScale,fitScale,MAX_SCALE);x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;focus=pose.focus||'custom';}
      else if(v25&&D.physical&&preciseRef&&view.w<560)scale=Math.max(1,fitScale,scale);
      else if(focus==='fit')scale=fitScale;
      const lane=pose?null:positionReadingAnchor(preciseRef);
      // For explicit front matter or unmatched source metadata, keep the
      // existing small-screen page fallback, rather than guessing a line.
      if(lane===null&&!pose&&view.w<560&&focus!=='fit')focusPage(page%2?'right':'left',true);
      constrain();preferReadingColumn(lane);transform();save();stage.dataset.lastGesture=destinationKey?'book-switch':'directory';stage.dataset.jumpState='committed';
      searchAnchor=requested?.search?preciseRef:null;
      const location=readingLocation(),row=history?.jump(location,entryId);deskKey=destinationKey||row?.id||null;
      feedback(`${location.bookName} · ${location.ref||'卷首'}`);
    };
    if(flatTouch||requested?.search){complete();return;}
    if(destinationKey){
      if(destinationKey===deskKey&&target===spread){complete();return;}
      stage.dataset.jumpState='switching';
      if(desk){const rank=window.PaperBookDesk.rank;desk.start(rank(destinationKey)>=rank(deskKey)?1:-1,complete);}
      else complete();return;
    }
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
  const bookFrame=()=>{const r=stage.getBoundingClientRect();return {x:r.left+x,y:r.top+y,scale};};
  history=window.PaperReadingHistory?.create({host:$('reading-history'),storage,books:window.BIBLE_SOURCE.books,pageCount:LAST_PAGE+1,
    onNavigate:(page,id,entry)=>jump(page,null,id,entry,id)});
  selection=window.PaperTextSelection?.create({stage,papers,storage,commands:Page.commands,feedback,
    getPage:side=>({page:D.pages[spread+side],index:spread+side,books:D.books})});
  chapters=window.PaperEdgeChapters.create(document.querySelector('.stage-wrap'),{books:D.books,onSelect:(page,requested)=>jump(page,null,null,requested),
    getBookFrame:bookFrame,onZoom:zoomWithChapterMenu,
    getPreview:(index,chapter)=>chapterPreview(D.books[index]?.code,chapter),
    getCurrent:()=>({bookIndex:D.books.indexOf(currentBook()),chapter:parseInt(readingLocation().ref,10)||1})});
  function openEdgeChapters(i,_book,metadata={}){
    interrupt();
    chapters.open({bookIndices:metadata.bookIndices||[i],index:i,anchor:metadata.anchor});
  }
  function openPicker(){
    interrupt();$('book-picker-books').hidden=false;$('book-picker-chapters').hidden=true;$('book-picker-back').hidden=true;
    $('book-picker-title').textContent='书卷与章节';$('book-picker').showModal();
  }
  function showChapters(i){
    const b=D.books[i],host=$('book-picker-chapters');host.replaceChildren();
    const add=(text,page,chapter)=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>jump(page,null,null,{bookCode:b.code,ref:chapter?chapter+':1':null});host.appendChild(button);};
    add('卷首',b.first);for(const c of b.chapters)add(`第 ${c.chapter} 章`,c.page,c.chapter);
    $('book-picker-title').textContent=b.name;$('book-picker-books').hidden=true;host.hidden=false;$('book-picker-back').hidden=false;
  }
  D.books.forEach((b,i)=>{const button=document.createElement('button');button.type='button';button.textContent=b.name;button.onclick=()=>showChapters(i);$('book-picker-books').appendChild(button);});
  $('book-picker-back').onclick=()=>{ $('book-picker').close();openPicker(); };
  $('book-picker-close').onclick=()=>$('book-picker').close();
  $('location-button').onclick=openPicker;
  window.addEventListener('paper-directory-request',openPicker);
  window.addEventListener('paper-interrupt',()=>{interrupt();});
  const relative=e=>{const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp??performance.now()};};
  const centroid=()=>{const a=[...pointers.values()];return {x:a.reduce((s,p)=>s+p.x,0)/a.length,y:a.reduce((s,p)=>s+p.y,0)/a.length,t:Math.max(...a.map(p=>p.t))};};
  const distance=()=>{const a=[...pointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);};
  const onPaper=(bx,by)=>bx>=0&&bx<=960&&by>=0&&by<=704;
  function inwardDirection(bx,by,band){
    if(band?.dataset.side==='right')return 1;
    if(band?.dataset.side==='left')return -1;
    if(!onPaper(bx,by))return 0;
    // These distances are in paper coordinates: keep the same visible strip
    // grabbable when the paper grows. Ink, taps and outward drags stay separate.
    const margin=28;
    return bx<=margin?-1:bx>=960-margin?1:0;
  }
  function horizontalPaperEdge(bx,by,band){
    if(!v25||band||!onPaper(bx,by))return 0;
    const margin=24;
    return by<=margin?1:by>=704-margin?-1:0;
  }
  function panTo(px,py){
    const oldX=x,oldY=y;x=px;y=py;constrain();
    if(Math.abs(x-oldX)<.00001&&Math.abs(y-oldY)<.00001)return false;
    searchAnchor=null;hideStartShortcut();hideColumnShortcut();focus='custom';transform();return true;
  }
  function pointerDown(e){
    const touchLabel=e.pointerType==='touch'?e.target?.closest?.('.edge-index__group'):null;
    const contact=touchLabel?relative(e):null,atEdge=contact&&inwardDirection((contact.x-x)/scale,(contact.y-y)/scale,null);
    const candidate=e.target?.closest?.('.edge-index__band')||
      (touchLabel&&atEdge===(touchLabel.dataset.side==='right'?1:-1)?touchLabel:null),
      band=candidate&&!candidate.disabled?candidate:null;
    suppressBandClick=null;
    if(jumpState||chapters?.isOpen()||e.button>0||(!band&&e.target?.closest?.('button,a,input,dialog,.edge-index,.paper-selection-tools')))return;
    // A new touch should not be lost in the short release animation.
    if(smoothTurn&&e.pointerType==='touch'&&fold?.settling&&pointers.size===0){
      queuedTurns=[];finishFold(fold.commit);
    }
    hideStartShortcut();hideColumnShortcut();cancelStartPan();clearHold();
    // A still press on blank paper does nothing; a named cut keeps its native
    // click. Transfer pointer capture to the stage only after a drag starts.
    pointers.set(e.pointerId,relative(e));try{(band||stage).setPointerCapture(e.pointerId);}catch{}
    if(pointers.size>1){
      if(fold){queuedTurns=[];finishFold(false);}
      stage.classList.remove('curl-dragging');
      const c=centroid();gesture={pinched:true,band:gesture?.band||band,start:c,baseX:x,baseY:y,baseScale:scale,baseDistance:distance()};return;
    }
    const start=relative(e),token=fold||band?null:selection?.hit(e.clientX,e.clientY,e.target);
    const bx=(start.x-x)/scale,by=(start.y-y)/scale;
    const g=gesture={start,end:start,band,token,wasTurning:!!fold,baseX:x,baseY:y,baseScale:scale,kind:'pending',pinched:false,
      edge:inwardDirection(bx,by,band),rim:horizontalPaperEdge(bx,by,band),leaf:bx<480?-1:1,
      touchFit:smoothTurn&&flatTouch&&e.pointerType==='touch'&&!band&&focus==='fit'&&onPaper(bx,by),
      contact:{radius:clamp(Math.abs(bx-480),12,480),grabY:clamp(by,0,704)},
      direction:0,trend:1,extreme:0};
    if(token&&!selection.isActive())holdTimer=setTimeout(()=>{
      holdTimer=null;if(gesture!==g||pointers.size!==1||g.kind!=='pending'||g.pinched)return;
      g.kind='held';selection.hold(token);stage.dataset.lastGesture='text-hold';
    },TEXT_HOLD_MS);
  }
  function rememberStroke(g,out){
    // Remember the latest deliberate stroke, not release-time velocity.
    // Holding still after pulling back still means return. Ignore hand jitter.
    if(g.trend>0){
      if(out>=g.extreme)g.extreme=out;
      else if(g.extreme-out>=6){g.trend=-1;g.extreme=out;}
    }else if(out<=g.extreme)g.extreme=out;
    else if(out-g.extreme>=6){g.trend=1;g.extreme=out;}
  }
  function curlTravel(g,dx,dy){
    return g.verticalTurn?g.rim*dy:-g.edge*dx;
  }
  function trackCurl(g,c,e){
    const dx=c.x-g.start.x,dy=c.y-g.start.y;
    // A contact holds one leaf until release. Going past its origin can only
    // flatten that leaf; it cannot silently pick up the opposite page.
    if(!g.direction){
      g.direction=g.edge;
      if(startFold(g.direction,1,'swipe',g.contact))stage.classList.add('curl-dragging');
    }
    if(!fold)return;
    const out=Math.max(0,curlTravel(g,dx,dy));
    // A mobile browser may batch a peak and a reversal into the same frame.
    // Read all the samples for intent, but paint just the latest position.
    for(const sample of e.getCoalescedEvents?.()||[]){
      rememberStroke(g,Math.max(0,curlTravel(g,dx+sample.clientX-e.clientX,dy+sample.clientY-e.clientY)));
    }
    rememberStroke(g,out);
    const progress=clamp(out/Math.max(1,2*fold.radius*g.baseScale),0,1),
      vertical=!g.verticalTurn&&!smoothTurn&&out?clamp((c.y-g.start.y)/g.baseScale,-210,210):0;
    if(fold.progress!==progress||fold.vertical!==vertical)updateFold(progress,vertical);
  }
  function releaseCurl(g,end){
    const out=curlTravel(g,end.x-g.start.x,end.y-g.start.y);
    // After a deliberate stroke, resting the finger never changes the intent.
    // Speed, hold duration and crossing halfway are not release requirements.
    return g.trend>0&&out>=SWIPE_MIN;
  }
  function pointerMove(e){
    if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,relative(e));
    const g=gesture,c=centroid();g.end=c;
    if(g.pinched){
      if(pointers.size===1){if(g.tail&&!g.cancelled)panTo(g.baseX+c.x-g.start.x,g.baseY+c.y-g.start.y);return;}
      searchAnchor=null;scale=clamp(g.baseScale*distance()/Math.max(1,g.baseDistance),fitScale,MAX_SCALE);
      x=c.x-(g.start.x-g.baseX)/g.baseScale*scale;y=c.y-(g.start.y-g.baseY)/g.baseScale*scale;
      focus=scale===fitScale?'fit':'custom';constrain();transform();return;
    }
    if(g.kind==='held'||g.wasTurning)return;
    const dx=c.x-g.start.x,dy=c.y-g.start.y;
    if(g.kind==='pending'&&Math.hypot(dx,dy)>MOVE_SLOP){
      clearHold();
      const fitSwipe=g.touchFit&&!g.rim&&!selection?.isActive()&&Math.abs(dx)>=Math.abs(dy)*1.35;
      if(fitSwipe)g.edge=Math.sign(-dx);
      const rimSwipe=g.rim&&!g.token&&!selection?.isActive()&&
        (-dx*g.leaf>=Math.abs(dy)*1.35||dy*g.rim>=Math.abs(dx)*1.35);
      if(rimSwipe&&!fitSwipe){
        g.edge=g.leaf;g.verticalTurn=dy*g.rim>=Math.abs(dx)*1.35;
      }
      const edgeSwipe=g.edge&&!g.token&&!selection?.isActive()&&-dx*g.edge>=Math.abs(dy)*1.35;
      g.kind=fitSwipe||rimSwipe||edgeSwipe?'swipe':'pan';
      if(g.band)try{stage.setPointerCapture(e.pointerId);}catch{}
      if(g.kind==='pan')stage.classList.add('dragging');
    }
    if(g.kind==='swipe')trackCurl(g,c,e);
    else if(g.kind==='pan'&&!fold){if(panTo(g.baseX+dx,g.baseY+dy))g.panned=true;}
  }
  function pointerUp(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    // Browsers can coalesce the last move into pointerup. The final contact,
    // especially a last-moment reversal, must decide the release, not stale ink.
    if(!cancelled)pointerMove(e);
    clearHold();const g=gesture;
    const end=relative(e);pointers.delete(e.pointerId);
    if(cancelled&&g)g.cancelled=true;
    if(g?.band&&(g.kind!=='pending'||g.cancelled||g.pinched))suppressBandClick={band:g.band,until:performance.now()+700};
    if(pointers.size){
      if(g?.pinched){g.start=centroid();g.baseX=x;g.baseY=y;g.baseScale=scale;g.baseDistance=distance();g.tail=pointers.size===1;}
      return;
    }
    gesture=null;stage.classList.remove('dragging','curl-dragging');try{stage.releasePointerCapture(e.pointerId);}catch{}
    if(!g)return;
    if(g.cancelled||g.pinched||g.wasTurning){
      if(g.cancelled&&g.kind==='swipe'&&fold&&!fold.settling)settleFold(false);
      stage.dataset.lastGesture=g.cancelled?'cancelled':g.pinched?'pinch':'turning';if(g.pinched)save();return;
    }
    if(g.kind==='pending'&&g.token){
      const t=g.token,single=!selection.isActive();
      if(selection.tap(t)&&single){
        const match=/^verse:(\d+:\d+(?:[-–]\d+)?)$/.exec(t.unit.group);
        const page=t.entry.index,b=D.books[D.pages[page]?.b];
        if(match&&b){
          readingSide=page-spread;preciseRef={page,bookCode:b.code,ref:match[1]};
          const row=history?.pickVerse({...preciseRef,bookName:b.name});if(row)deskKey=row.id;
          render({reusePages:true});save();
        }
      }
      stage.dataset.lastGesture='text-tap';return;
    }
    if(v25&&g.kind==='pending'&&!g.band&&!selection?.isActive()){
      window.dispatchEvent(new Event('paper-reader-tap'));return;
    }
    if(g.kind==='swipe'&&fold){
      const commit=releaseCurl(g,end);stage.dataset.lastGesture=commit?'swipe-turn':'swipe-return';settleFold(commit);return;
    }
    if(g.kind==='pan'){
      stage.dataset.lastGesture='pan';if(g.panned)save();
      const dx=end.x-g.start.x,dy=end.y-g.start.y;
      if(-dy>=SWIPE_MIN&&isReadingDownStroke(dx,dy)&&!selection?.isActive()){
        const column=mobileReadingColumn(e.pointerType);
        if(column?.atBottom&&column.next){offerNextColumn(column.next);stage.dataset.lastGesture='column-end';}
      }
    }
  }
  // Capture before a compact tab handles its native click; drags starting on
  // the blank fore-edge remain normal page gestures.
  stage.addEventListener('pointerdown',pointerDown,true);stage.addEventListener('pointermove',pointerMove);
  stage.addEventListener('pointerup',e=>pointerUp(e),true);stage.addEventListener('pointercancel',e=>pointerUp(e,true),true);
  stage.addEventListener('click',e=>{
    if(suppressBandClick&&e.detail!==0&&performance.now()<=suppressBandClick.until&&e.target?.closest?.('.edge-index__band,.edge-index__group')===suppressBandClick.band){
      suppressBandClick=null;e.preventDefault();e.stopPropagation();
    }
  },true);
  stage.addEventListener('lostpointercapture',e=>{
    // A band handing off capture to this stage has not lost the gesture.
    if(e.target!==stage&&stage.hasPointerCapture?.(e.pointerId))return;
    if(pointers.has(e.pointerId))pointerUp(e,true);
  });
  window.addEventListener('blur',interrupt);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();});
  let wheelBurst=null;
  stage.addEventListener('wheel',e=>{
    if(jumpState||chapters?.isOpen()){wheelBurst=null;e.preventDefault();return;}
    const overIndex=!!e.target?.closest?.('.edge-index');
    if(!overIndex&&e.target?.closest?.('button,dialog,.paper-selection-tools'))return;
    const at=relative(e),unit=e.deltaMode===1?16:e.deltaMode===2?view.h:1,
      dx=(e.deltaX||0)*unit,dy=(e.deltaY||0)*unit;
    // A trackpad pinch (or Ctrl+wheel) belongs to the same book even when
    // its focal point is a native book-index button. Never zoom the browser.
    if(e.ctrlKey||e.metaKey){
      e.preventDefault();wheelBurst=null;if(fold||pointers.size||!dy)return;
      const next=clamp(scale*Math.exp(-dy*.003),fitScale,MAX_SCALE);
      zoom(next,at);
      return;
    }
    e.preventDefault();if(pointers.size){wheelBurst=null;return;}
    hideColumnShortcut();cancelStartPan();
    if(scale>fitScale+.00001){
      wheelBurst=null;if(!fold&&panTo(x-dx,y-dy))save();return;
    }
    if(!overIndex&&!onPaper((at.x-x)/scale,(at.y-y)/scale))return;
    // Wheel events have no cross-browser gesture-end signal. Include the
    // inertia tail (even during settling) in the same single-turn burst.
    const now=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now();
    if(!wheelBurst||now-wheelBurst.last>220)wheelBurst={dx:0,dy:0,axis:null,used:false};
    const b=wheelBurst;b.last=now;b.dx+=dx;b.dy+=dy;
    if(!b.axis&&Math.max(Math.abs(b.dx),Math.abs(b.dy))>=12){
      if(Math.abs(b.dx)>=1.35*Math.abs(b.dy))b.axis='horizontal';
      else if(Math.abs(b.dy)>=1.35*Math.abs(b.dx))b.axis='vertical';
    }
    if(!b.used&&b.axis==='horizontal'&&Math.abs(b.dx)>=48){
      b.used=true;if(!fold&&!selection?.isActive())turn(b.dx>0?1:-1,1,'trackpad');
    }
  },{passive:false});
  stage.addEventListener('keydown',e=>{
    if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&(e.altKey||e.ctrlKey||e.metaKey))return;
    if(jumpState||chapters?.isOpen()){if(e.key==='Escape'){e.preventDefault();interrupt();}return;}
    if(e.target?.closest?.('button,input,dialog'))return;
    if(e.key==='ArrowRight'){e.preventDefault();turn(1);}else if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}
    else if(e.key==='Escape')interrupt();else if(e.key==='+'||e.key==='=')zoom(scale*1.2);else if(e.key==='-')zoom(scale/1.2);else if(e.key==='0')fit();
  });
  $('fit-book').onclick=fit;$('zoom-value').onclick=fit;
  for(const side of ['left','right'])$('focus-'+side).onclick=()=>{focusPage(side);history?.advance(readingLocation());};
  $('zoom-in').onclick=()=>{if(chapters?.isOpen())zoomWithChapterMenu(1.3);else zoom(scale*1.3);};
  $('zoom-out').onclick=()=>{if(chapters?.isOpen())zoomWithChapterMenu(1/1.3);else zoom(scale/1.3);};
  $('prev').onclick=()=>turn(-1);$('next').onclick=()=>turn(1);
  $('about-open').onclick=()=>{interrupt();$('about-dialog').showModal();};
  $('help-open').onclick=()=>{interrupt();$('help-dialog').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelector('.brand')?.addEventListener('click',e=>{e.preventDefault();fit();});
  $('demo-burst').onclick=()=>turn(1);
  $('demo-pan').onclick=()=>{focusPage('right');feedback('拖动正文平移；从书页外缘向书心拖动翻页');};
  stage.dataset.scene='reading';stage.dataset.textHoldMs=String(TEXT_HOLD_MS);
  window.PaperImmersion?.setScene?.('reading');
  document.fonts?.addEventListener?.('loadingdone',()=>{const n=spread;requestAnimationFrame(()=>{if(n===spread&&!fold&&!jumpState&&!gesture&&!selection?.isActive()){papers.forEach((paper,i)=>paper.innerHTML=svgPage(n+i));selection?.refresh?.();markSearchInk();}})});
  render();resize();
  if(saved?.zoom>1&&Number.isFinite(saved.centerX)&&Number.isFinite(saved.centerY)){
    scale=clamp(fitScale*saved.zoom,fitScale,MAX_SCALE);x=view.w/2-saved.centerX*scale;y=view.h/2-saved.centerY*scale;focus=saved.focus||'custom';constrain();transform();
  }
  // On a phone a single page is the useful initial reading window; whole-book
  // fit remains available, and both index bands stay reachable by pan.
  else if(view.w<560)focusPage(readingSide?'right':'left',true);
  deskKey=history?.start(readingLocation())?.id||null;
  coverZoom=window.PaperCoverZoom?.mount({doc:document,win:window,stage,history:$('reading-history'),
    onZoom(percent){
      const next=window.PaperCoverZoom.asScale(percent,fitScale,MAX_SCALE);
      if(next===null)return;
      if(chapters?.isOpen())zoomWithChapterMenu(next/scale);else zoom(next);
    }});
  window.addEventListener('v25-read-citation',e=>{
    const {code,ref}=e.detail||{},page=window.V25OriginalData.lookup(code,ref);
    if(Number.isInteger(page))jump(page,null,null,{bookCode:code,ref,search:true});
  });
  finder=window.mountVerseFinder({
    navigate:(page,requested)=>jump(page,null,null,requested),
    origin:()=>({...readingLocation(),pose:capturePose()}),
    restore:o=>jump(o.page,o.pose,null,{ref:o.ref,bookCode:o.bookCode}),
    camera:()=>({x,y,scale,w:view.w,h:view.h,side:readingSide,
      inkX:()=>{const box=papers[readingSide].querySelector('.vf-found:not([visibility=hidden])')?.getBoundingClientRect();
        return box?box.left+box.width/2-stage.getBoundingClientRect().left:null;}
    }),
    interrupt
  });
  coverZoom?.sync(scale,fitScale,MAX_SCALE);
  if(!flatTouch)coverZoom?.openOnce();
  new ResizeObserver(resize).observe(stage);window.addEventListener('resize',resize);
  save();
})();
