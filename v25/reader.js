/* Text selection and blank-space swiping share a single pointer arbiter. */
(() => {
  'use strict';
  if(window.PAPER_READER_ERROR)return;
  const $=id=>document.getElementById(id),D=window.BIBLE_DATA;
  const Page=window.PaperPage,Material=window.PaperBookMaterial;
  const stage=$('stage'),book=$('book'),papers=[$('left-paper'),$('right-paper')];
  const quickDirectory=$('v25-book-directory');
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
  const TEXT_HOLD_MS=360,MOVE_SLOP=8,SWIPE_MIN=30,MAX_SCALE=3.2,PAN_PAD=18,MAX_SPREAD=Math.min(LAST_PAGE&~1,(D.pages.length-2)&~1);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let spread=0,scale=1,fitScale=1,x=0,y=0,focus='fit',view={w:0,h:0};
  let fold=null,foldFrame=0,foldDragFrame=0,holdTimer=null,feedbackTimer=null,gesture=null,chapters=null,jumpState=null;
  let finder=null,searchAnchor=null,compare=null;
  let saved=null,storage,queuedTurns=[],readingSide=1,selection=null,history=null,preciseRef=null,controllerReady=false;
  const pointers=new Map();
  const indexSurface='.edge-index__band,.edge-index__group';
  let suppressIndexClick=null, coverZoom=null, opening=null;
  let startShortcut=null,startShortcutTimer=0,startShortcutSpread=null,startPanFrame=0,startPanKind=null;
  let panPaintFrame=0,coastFrame=0;
  let columnShortcut=null,columnShortcutTimer=0,columnOffer=null,columnGeometry=null,columnReading=null;
  let watchingShortcuts=false;
  let adaptButton=null,adaptTimer=0,adaptRightEdge=null;
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
  const index=window.PaperEdgeIndex.create($('edge-index-host'),{books:D.books,pageCount:D.pages.length,onSelect:openEdgeChapters,depthScale:smoothProfile ? .70 : 1,splitLeaves:!!window.V25Opening});
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
  function advanceHistory(){const row=history?.advance(readingLocation());if(row)deskKey=row.id;}
  if(saved?.explicitRef&&saved.ref&&saved.bookName===currentBook().name&&saved.page===readingLocation().page){
    preciseRef={page:saved.page,bookCode:currentBook().code,ref:saved.ref};
  }
  if(window.PAPER_INITIAL_REF&&window.PAPER_INITIAL_REF.page===readingLocation().page)preciseRef=window.PAPER_INITIAL_REF;
  const capturePose=()=>({zoom:scale/fitScale,cx:(view.w/2-x)/scale,cy:(view.h/2-y)/scale,focus});
  function save(){
    if(!controllerReady&&window.V25Account?.usingProfile)return;
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
    const {bookCode,keywords,page}=preciseRef,[ch,v]=preciseRef.ref.split(':').map(Number);
    const matches=ref=>{const m=/^(\d+):(\d+)(?:-(\d+))?$/.exec(ref);return m&&+m[1]===ch&&+m[2]<=v&&v<=+(m[3]||m[2]);};
    const db=window.V25OriginalData,visible=new Map();
    papers.forEach((paper,side)=>{
      const n=spread+side;if(D.books[D.pages[n]?.b]?.code!==bookCode)return;
      const svg=paper.querySelector('svg[data-pdf]');if(!svg)return;
      svg.querySelector('.vf-word-layer')?.remove();
      const glyphs=new Map();svg.querySelectorAll('text[data-ref]').forEach(el=>{
        if(!matches(el.dataset.ref)||el.getAttribute('visibility')==='hidden')return;
        el.classList.add('vf-found');if(el.dataset.role==='body')glyphs.set(+el.dataset.physicalIdx,el);
      });visible.set(n,{svg,glyphs});
    });
    if(!keywords?.length)return;
    // A word may straddle columns or even leaves. Search the printed body
    // stream in reading order, then paint only its visible original glyphs.
    function run(n){
      const raw=db.get(n)?.[3];if(!raw||D.books[D.pages[n]?.b]?.code!==bookCode)return [];
      return db.tags(n).flatMap((t,i)=>t.role==='body'&&matches(t.ref)?[{n,i,text:raw[i][4]}]:[]);
    }
    let all=run(page);
    for(let n=page-1;n>=0;n--){const r=run(n);if(!r.length)break;all=r.concat(all);}
    for(let n=page+1;n<=LAST_PAGE;n++){const r=run(n);if(!r.length)break;all=all.concat(r);}
    const ranges=window.V25Words.ranges(all.map(g=>g.text).join(''),keywords);
    let offset=0,k=0;const ns='http://www.w3.org/2000/svg';
    for(const g of all){
      const lo=offset,hi=offset+=g.text.length;while(k<ranges.length&&ranges[k][1]<=lo)k++;
      const face=visible.get(g.n),el=face?.glyphs.get(g.i);if(!el)continue;
      for(let j=k;j<ranges.length&&ranges[j][0]<hi;j++){
        const a=Math.max(lo,ranges[j][0])-lo,b=Math.min(hi,ranges[j][1])-lo;
        if(!face.layer){const layer=face.layer=document.createElementNS(ns,'g');layer.setAttribute('class','vf-word-layer');layer.setAttribute('pointer-events','none');layer.setAttribute('aria-hidden','true');face.svg.insertBefore(layer,face.svg.querySelector('text'));}
        const [l,r,t,bt]=el.dataset.clip.split(' ').map(Number),rect=document.createElementNS(ns,'rect'),w=(r-l)/g.text.length;
        for(const [attr,value] of Object.entries({x:l+a*w,y:t,width:(b-a)*w,height:bt-t,rx:1}))rect.setAttribute(attr,value);
        face.layer.append(rect);
        if(a===0&&b===g.text.length)el.classList.add('vf-word');
      }
    }
  }
  function render({reusePages=false,keepFocus=false,preserveSelection=false}={}){
    if(!reusePages){
      if(!preserveSelection)selection?.reset({keepFocus});
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
  function verticalLimits(h=envelope().bottom*scale){
    const center=(view.h-h)/2;
    return h<=view.h-PAN_PAD*2?[center,center]:[view.h-PAN_PAD-h,PAN_PAD];
  }
  function constrain(){
    const e=envelope(),w=(e.right-e.left)*scale,pad=PAN_PAD;
    if(w<=view.w-pad*2)x=view.w/2-(e.left+e.right)*scale/2;
    else{
      const minX=view.w-pad-e.right*scale;
      const adapted=adaptRightEdge?.spread===spread&&adaptRightEdge.w===view.w&&adaptRightEdge.scale===scale;
      x=clamp(x,adapted?Math.min(minX,adaptRightEdge.x):minX,pad-e.left*scale);
    }
    const [minY,maxY]=verticalLimits(e.bottom*scale);y=clamp(y,minY,maxY);
  }
  function transform(panOnly=false){
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
    // A translation moves the mounted paper, its cuts and its ink together.
    // Only scale, selection of the current book or a new spread needs the index repainted.
    if(!panOnly)updateIndex();
    positionReadingShortcuts();chapters?.reposition?.();finder?.layout();window.dispatchEvent(new Event('v25-camera-changed'));
  }
  function measureFit(){const e=envelope(),margin=view.w<560?30:120;return Math.min((view.w-margin)/(e.right-e.left),(view.h-(view.w<560?38:120))/e.bottom);}
  function fit(){interrupt(true);adaptRightEdge=null;focus='fit';fitScale=measureFit();scale=fitScale;constrain();transform();save();}
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
    if(!arriving)interrupt(true);adaptRightEdge=null;focus=side;readingSide=side==='left'?0:1;render({reusePages:true});const e=envelope(),outer=side==='left'?-e.left:e.right-960;
    scale=clamp((view.w-32)/(480+outer),fitScale,MAX_SCALE);
    // A fixed double-column page must not become 7 px text on a phone. Keep
    // its outer column and compact book index readable; pan to the inner column.
    if(view.w<560)scale=Math.max(1,scale);
    x=view.w<560&&side==='right'?view.w-18-e.right*scale:16+(side==='left'?outer:-480)*scale;
    y=18;const id=positionReadingAnchor(arriving?preciseRef:null);constrain();preferReadingColumn(id);transform();save();
  }
  function zoom(next,at={x:view.w/2,y:view.h/2},textZoom=true){
    searchAnchor=null;interrupt(true);next=clamp(next,fitScale,MAX_SCALE);
    const changed=Math.abs(next-scale)>.00001;
    if(changed)adaptRightEdge=null;
    x=at.x-(at.x-x)/scale*next;y=at.y-(at.y-y)/scale*next;
    scale=next;focus=scale===fitScale?'fit':'custom';constrain();transform();save();
    if(changed&&textZoom)offerAdapt();
  }
  // The loose paper overlays live outside the stage; zoom the book, not the web page.
  window.addEventListener('v25-paper-zoom',e=>{
    const {factor,x:ax,y:ay}=e.detail||{},r=stage.getBoundingClientRect();
    if(!fold&&!jumpState&&Number.isFinite(factor)&&factor>0)zoom(scale*factor,{x:ax-r.left,y:ay-r.top},false);
  });
  function resize(){
    if(view.w===stage.clientWidth&&view.h===stage.clientHeight)return;
    if(startPanKind==='directoryPan')cancelStartPan();
    opening?.finish();
    const widthChanged=view.w!==stage.clientWidth;
    if(widthChanged)adaptRightEdge=null;
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
    if(startPanKind==='directoryPan')cancelStartPan();
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
    const kind=startPanKind;stage.dataset[kind]='cancelled';startPanKind=null;
    if(kind!=='directoryPan')save();
  }
  function cameraTarget(targetX,targetY){
    const fromX=x,fromY=y;
    x=targetX;y=targetY;constrain();const toX=x,toY=y;
    x=fromX;y=fromY;
    return {x:toX,y:toY};
  }
  function slideCamera({x:toX,y:toY},kind,onCommit){
    const fromX=x,fromY=y;
    const complete=()=>{
      startPanFrame=0;startPanKind=null;stage.dataset[kind]='committed';
      x=toX;y=toY;onCommit();
    };
    if(reduceMotion()||Math.hypot(toX-fromX,toY-fromY)<.5){complete();return;}
    const started=performance.now();
    startPanKind=kind;stage.dataset[kind]='running';
    function frame(now){
      const t=clamp((now-started)/460,0,1);
      if(t===1){complete();return;}
      const eased=(1-Math.cos(t*Math.PI))/2;
      x=fromX+(toX-fromX)*eased;y=fromY+(toY-fromY)*eased;transform(true);
      startPanFrame=requestAnimationFrame(frame);
    }
    startPanFrame=requestAnimationFrame(frame);
  }
  function panToReadingPoint(targetX,targetY,side,kind,onCommit,allowDesk=false){
    focus='custom';adaptRightEdge=allowDesk?{spread,w:view.w,scale,x:targetX}:null;hideAdapt();
    slideCamera(cameraTarget(targetX,targetY),kind,()=>{
      readingSide=side;render({reusePages:true});transform();save();advanceHistory();onCommit?.();
    });
  }
  function bindPaperAction(button,activate,dismiss){
    // A real touch tap can follow a captured swipe before the browser resumes
    // synthetic clicks. Use the short, in-bounds release and suppress its duplicate.
    let contact=null,fence=0;
    button.addEventListener('click',e=>{
      if(e.pointerType!=='touch'&&(e.detail===0||e.pointerType==='mouse'||performance.now()>fence))activate();
    });
    button.addEventListener('pointerdown',e=>{
      if(e.pointerType!=='touch'||!e.isPrimary)return;
      fence=performance.now()+700;contact={id:e.pointerId,x:e.clientX,y:e.clientY};
      try{button.setPointerCapture(e.pointerId);}catch{}
    });
    const moved=e=>contact?.id===e.pointerId&&Math.hypot(e.clientX-contact.x,e.clientY-contact.y)>8;
    button.addEventListener('pointermove',e=>{if(moved(e))contact=null;});
    button.addEventListener('pointerup',e=>{
      if(e.pointerType==='touch')fence=performance.now()+700;
      if(contact?.id!==e.pointerId)return;
      const short=!moved(e);contact=null;const r=button.getBoundingClientRect();
      if(short&&!button.hidden&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
        e.preventDefault();activate();
      }
    });
    for(const type of ['pointercancel','lostpointercapture'])button.addEventListener(type,e=>{if(contact?.id===e.pointerId)contact=null;});
    button.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss();}});
  }
  function placePaperShortcut(button,order,forward,cornerInset){
    if(!button||button.hidden)return;
    const rect=stage.getBoundingClientRect(),vv=window.visualViewport;
    const left=Math.max(rect.left,(vv?.offsetLeft||0)+8),right=Math.min(rect.right,(vv?.offsetLeft||0)+(vv?.width||innerWidth)-8);
    const top=Math.max(rect.top,(vv?.offsetTop||0)+8);
    let bottom=Math.min(rect.bottom,(vv?.offsetTop||0)+(vv?.height||innerHeight)-8);
    if(document.documentElement.dataset.readerChrome==='visible'){
      const shelf=$('reading-history')?.getBoundingClientRect();if(shelf?.height)bottom=Math.min(bottom,shelf.top-6);
    }
    const w=button.offsetWidth,h=button.offsetHeight;
    // Treat each visible paper face separately: never land over the gutter,
    // the book tabs, the reading shelf or a clipped part of a page.
    for(const side of order){
      const paper=papers[side];
      const p=paper.getBoundingClientRect(),l=Math.max(left,p.left+8),r=Math.min(right,p.right-8),t=Math.max(top,p.top+8),b=Math.min(bottom,p.bottom-8);
      if(r-l<w||b-t<h)continue;
      const inset=Math.min(cornerInset,Math.max(0,(b-t-h)*.18));
      button.style.setProperty('--return-x',((forward?r-w:l)-rect.left)+'px');
      button.style.setProperty('--return-y',((forward?b-h-inset:t+inset)-rect.top)+'px');
      button.style.visibility='';return;
    }
    button.style.visibility='hidden';
  }
  function positionReadingShortcuts(){
    if(startShortcut&&!startShortcut.hidden){
      const forward=startShortcut.dataset.corner==='lower-right';
      placePaperShortcut(startShortcut,forward?[1,0]:[0,1],forward,34);
    }
    if(columnOffer)placePaperShortcut(columnShortcut,[columnOffer.from.side,1-columnOffer.from.side],columnOffer.direction>0,6);
  }
  function watchShortcutBounds(){
    if(watchingShortcuts)return;
    watchingShortcuts=true;
    new MutationObserver(positionReadingShortcuts).observe(document.documentElement,{attributes:true,attributeFilter:['data-reader-chrome']});
    window.visualViewport?.addEventListener('resize',positionReadingShortcuts);
    window.visualViewport?.addEventListener('scroll',positionReadingShortcuts);
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
      bindPaperAction(startShortcut,()=>startShortcut.activate?.(),hideStartShortcut);
      watchShortcutBounds();
    }
    hideStartShortcut();startShortcutSpread=spread;startShortcut.hidden=false;
    startShortcut.dataset.corner=forward?'lower-right':'upper-left';
    startShortcut.textContent=forward?'↖ 回左上':'↘ 回右下';
    startShortcut.setAttribute('aria-label',forward?'回到左上角，从新跨页开始阅读':'回到上一跨页的右下角');
    startShortcut.activate=()=>{
      if(startShortcutSpread!==spread||startShortcut.hidden||fold||jumpState||!needsPan()){
        hideStartShortcut();return;
      }
      hideStartShortcut();columnReading=null;
      panToReadingPoint(targetX(),targetY(),forward?0:1,'spreadStartPan');
    };
    positionReadingShortcuts();
    startShortcutTimer=setTimeout(hideStartShortcut,4000);
  }
  // Cache actual ink extents per displayed spread, in the same physical
  // coordinates as the camera. Printed blank columns never become stops.
  function edgeLine(words,end){
    const edge=words.reduce((a,b)=>(end?b.y+b.h>a.y+a.h:b.y<a.y)?b:a);
    const mid=edge.y+edge.h/2,tolerance=Math.max(4,edge.h*.55);
    let top=edge.y,bottom=edge.y+edge.h;
    for(const word of words){
      if(Math.abs(word.y+word.h/2-mid)>tolerance)continue;
      top=Math.min(top,word.y);bottom=Math.max(bottom,word.y+word.h);
    }
    return {at:end?bottom:top,half:(bottom-top)/2};
  }
  function readingColumns(){
    if(columnGeometry?.spread===spread)return columnGeometry.columns;
    const columns=[];
    for(let side=0;side<2;side++){
      const groups=Array.from({length:2},()=>({left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity,words:[]}));
      for(const c of Page.commands?.(D.pages[spread+side],spread+side,D.books)||[]){
        if(!c.physicalInk||c.hideHatch||!['body','verse','heading','chapter'].includes(c.role)||
          ![c.x,c.y,c.w,c.h].every(Number.isFinite))continue;
        const lane=c.x+c.w/2<240?0:1,a=groups[lane],offset=side*480;
        a.left=Math.min(a.left,c.x+offset);a.right=Math.max(a.right,c.x+c.w+offset);
        a.top=Math.min(a.top,c.y);a.bottom=Math.max(a.bottom,c.y+c.h);
        if(c.role==='body')a.words.push(c);
      }
      groups.forEach(({words,...a},lane)=>{
        if(words.length)columns.push({...a,id:side*2+lane,side,first:edgeLine(words,false),last:edgeLine(words,true)});
      });
    }
    columnGeometry={spread,columns};
    return columns;
  }
  function visibleReadingLane(requireVertical=true){
    const centre=view.w/2;
    let best=null;
    for(const lane of readingColumns()){
      const left=x+lane.left*scale,right=x+lane.right*scale;
      const top=Math.max(0,y+lane.top*scale),bottom=Math.min(view.h,y+lane.bottom*scale);
      const visible=Math.min(view.w,right)-Math.max(0,left),distance=Math.abs((left+right)/2-centre);
      if(visible<=0||requireVertical&&bottom<=top)continue;
      if(!best||visible>best.visible+.5||Math.abs(visible-best.visible)<=.5&&distance<best.distance)
        best={lane,visible,distance,anchorY:clamp(view.h*.45,top,bottom)};
    }
    return best;
  }
  function hideAdapt(){
    clearTimeout(adaptTimer);adaptTimer=0;
    if(!adaptButton||adaptButton.hidden)return;
    if(document.activeElement===adaptButton)stage.focus({preventScroll:true});
    adaptButton.hidden=true;
  }
  function adaptColumn(){
    hideAdapt();
    if(fold||jumpState||pointers.size||chapters?.isOpen())return;
    const target=visibleReadingLane();if(!target)return;
    interrupt(true);
    const {lane,anchorY}=target,paperY=(anchorY-y)/scale;
    // Screen proportions, not device names: unfolded phones and horizontal
    // touch viewports benefit from a little context to the right of the lane.
    const wide=wideReading();
    const width=wide?view.w*.66:view.w-12,centre=view.w*(wide?.43:.5);
    searchAnchor=null;
    scale=clamp(width/(lane.right-lane.left),fitScale,MAX_SCALE);
    focus='custom';x=centre-(lane.left+lane.right)/2*scale;y=anchorY-paperY*scale;
    // The last lane may need desk space on the right. Allow only the extra
    // distance this explicit fit requested, at this spread, width and scale.
    adaptRightEdge=wide?{spread,w:view.w,scale,x}:null;
    constrain();preferReadingColumn(lane.id);transform();save();
  }
  const wideReading=()=>view.w>=520&&view.w>=view.h*.68;
  function offerAdapt(){
    if(!v25||!D.physical||!flatTouch||!view.w||fold||jumpState||chapters?.isOpen()||!visibleReadingLane())return;
    if(!adaptButton){
      adaptButton=document.createElement('button');adaptButton.type='button';
      adaptButton.id='fit-reading-column';adaptButton.className='spread-start-shortcut';
      adaptButton.textContent='自适应';adaptButton.hidden=true;stage.append(adaptButton);
      // The button sits on the most common starting point for a new swipe.
      // Only a still touch activates it; the stage handles drags and pinches.
      adaptButton.addEventListener('click',e=>{if(!adaptButton.hidden&&e.pointerType!=='touch')adaptColumn();});
      adaptButton.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hideAdapt();}
      });
    }
    clearTimeout(adaptTimer);adaptButton.hidden=false;adaptTimer=setTimeout(hideAdapt,2000);
  }
  const mobileClippedReading=pointerType=>v25&&D.physical&&flatTouch&&pointerType==='touch'&&focus!=='fit'&&
    (960*scale>view.w+2||704*scale>view.h+2);
  function columnSwipe(g,dx,dy,pointerType){
    if(!g.fromPaper||g.indexTarget||!dy||!mobileClippedReading(pointerType)||Math.abs(dy)<1.35*Math.abs(dx))return null;
    const columns=readingColumns();
    if(!columns.length)return null;
    const anchored=columnReading?.spread===spread&&columnReading.scale===scale&&Math.abs(columnReading.x-x)<24&&
      columns.find(c=>c.id===columnReading.id&&c.right*scale+x>8&&c.left*scale+x<view.w-8);
    const from=anchored||visibleReadingLane(false)?.lane;
    if(!from)return null;
    if(Math.min(y,g.baseY)+from.top*scale>=view.h||Math.max(y,g.baseY)+from.bottom*scale<=0)return null;
    const direction=dy<0?1:-1,line=direction>0?from.last:from.first;
    const needed=direction>0?g.baseY+line.at*scale-view.h:-(g.baseY+line.at*scale);
    // Use the real finger travel, not momentum or the physical paper clamp.
    // A short column may end well above the footer; an edge can also clamp
    // out the extra half-line before the camera itself has moved that far.
    const excess=Math.abs(dy)-Math.max(0,needed);
    if(excess<=line.half*scale)return null;
    const next=columns[columns.indexOf(from)+direction];
    // No sideways shortcut when all lanes already fit, but the terminal
    // swipe can still turn the paper (also on a page with only one ink lane).
    if(next&&(columns.at(-1).right-columns[0].left)*scale<=view.w-12)return null;
    return {direction,from,next};
  }
  function columnPose(lane,direction){
    const w=(lane.right-lane.left)*scale,wide=wideReading();
    const pad=clamp(view.w*(wide?.43:.5)-w/2,6,view.w*.33);
    return {x:pad-lane.left*scale,y:direction>0?18-lane.top*scale:view.h-18-lane.bottom*scale,wide};
  }
  function offerReverseColumn(from){
    const columns=readingColumns(),next=columns[columns.indexOf(from)-1];
    if(next)offerColumnShortcut({direction:-1,from,next});
  }
  function hideColumnShortcut(){
    clearTimeout(columnShortcutTimer);columnShortcutTimer=0;columnOffer=null;
    if(!columnShortcut||columnShortcut.hidden)return;
    if(document.activeElement===columnShortcut)stage.focus({preventScroll:true});
    columnShortcut.hidden=true;
  }
  function offerColumnShortcut({direction,from,next}){
    if(jumpState||fold||(!next&&(direction>0?spread>=MAX_SPREAD:spread<=0)))return;
    if(!columnShortcut){
      columnShortcut=document.createElement('button');columnShortcut.type='button';
      columnShortcut.id='next-column-shortcut';columnShortcut.className='spread-start-shortcut';
      columnShortcut.hidden=true;stage.append(columnShortcut);
      const activate=()=>{
        const offer=columnOffer;hideColumnShortcut();
        if(!offer||offer.spread!==spread||fold||jumpState)return;
        const {direction,next}=offer;
        window.PaperImmersion?.hideChrome();
        if(!next){turn(direction,1,'column-nav');return;}
        const target=columnPose(next,direction);
        panToReadingPoint(target.x,target.y,next.side,'columnPan',()=>{
          preferReadingColumn(next.id);
          if(direction>0)offerReverseColumn(next);
        },target.wide);
      };
      bindPaperAction(columnShortcut,activate,hideColumnShortcut);
      watchShortcutBounds();
    }
    hideStartShortcut();hideColumnShortcut();columnOffer={spread,direction,from,next};
    columnShortcut.dataset.v25ReadingDirection=direction>0?'forward':'back';
    columnShortcut.textContent=next?(direction>0?'去下一栏':'回上一栏'):(direction>0?'翻下一页':'翻上一页');
    columnShortcut.hidden=false;positionReadingShortcuts();
    columnShortcutTimer=setTimeout(hideColumnShortcut,3000);
  }
  function clearHold(){clearTimeout(holdTimer);holdTimer=null;}
  function startFold(direction,count=1,source='control',contact=null){
    if(fold||jumpState)return false;
    stopCoast();hideStartShortcut();hideColumnShortcut();hideAdapt();cancelStartPan();
    const target=clamp(spread+direction*count*2,0,MAX_SPREAD);
    if(target===spread){feedback(direction>0?'已经到最后一页':'已经到第一页');return false;}
    const side=direction>0?1:0;
    selection?.suspend();
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
    cancelAnimationFrame(foldDragFrame);foldDragFrame=0;
    renderer.hide();book.classList.remove('curl-active');papers[f.side].classList.remove('under-curl');papers[f.side].style.removeProperty('--under-sheet-clip');fold=null;
    let landed=null;
    if(commit){
      adaptRightEdge=null;preciseRef=null;columnReading=null;spread=f.target;
      readingSide=focus==='left'||(focus==='custom'&&(view.w/2-x)/scale<480)?0:1;
      if(f.source==='column-nav'){
        const lanes=readingColumns();landed=f.direction>0?lanes[0]:lanes.at(-1);
        if(landed)readingSide=landed.side;
      }
      render({preserveSelection:selection?.isActive()});fitScale=measureFit();if(focus==='fit')scale=fitScale;
      if(landed){
        const target=columnPose(landed,f.direction);focus='custom';x=target.x;y=target.y;
        if(target.wide)adaptRightEdge={spread,w:view.w,scale,x};
      }
      constrain();if(landed)preferReadingColumn(landed.id);transform();save();advanceHistory();
    }
    else{if(f.animate){papers[f.side].innerHTML=f.original;applyMaterial();updateIndex();}selection?.refresh?.();}
    stage.dataset.foldState=commit?'committed':'returned';delete stage.dataset.foldProgress;
    if(queuedTurns.length)turn(...queuedTurns.shift());
    else if(commit&&f.offerStart&&!landed)offerStartShortcut(f.direction);
  }
  function settleFold(commit=true){
    if(!fold||fold.settling)return;const f=fold;f.settling=true;f.commit=commit;
    flushFoldDrag();
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
    if(jumpState||chapters?.isOpen())return;
    clearHold();
    if(fold){if(fold.settling&&queuedTurns.length<8)queuedTurns.push([direction,count,source]);return;}
    if(startFold(direction,count,source))settleFold();
  }
  function interrupt(keepSelection=false){
    stopCoast();hideStartShortcut();hideColumnShortcut();hideAdapt();cancelStartPan();desk?.cancel();columnReading=null;
    clearHold();queuedTurns=[];if(keepSelection!==true){selection?.reset({keepFocus:true});compare?.clearSelection();}
    pointers.clear();gesture=null;stage.classList.remove('dragging','curl-dragging');
    chapters?.close();
    if(jumpState){jumpState=null;pageJump.cancel();render();stage.dataset.jumpState='cancelled';}
    if(fold)finishFold(false);
  }
  function jump(page,pose,entryId,requested,destinationKey=null){
    interrupt();adaptRightEdge=null;$('book-picker').close();
    page=clamp(page,0,LAST_PAGE);
    const target=clamp(page&~1,0,MAX_SPREAD),transaction={from:spread,target,page,pose};
    jumpState=transaction;
    const complete=()=>{
      if(jumpState!==transaction)return; // A cancelled/replaced animation cannot move the saved bookmark.
      jumpState=null;spread=target;readingSide=page&1;preciseRef=requested?.ref?{page,bookCode:requested.bookCode,ref:requested.ref,search:!!requested.search,keywords:requested.keywords}:null;render();fitScale=measureFit();
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
  const paper=window.V25OriginalData,scripture=window.V25Scripture.create(window.BIBLE_SOURCE,paper);
  const citationLinks=window.V25CitationLinks.create(window.BIBLE_SOURCE);
  const study=window.V25StudyQA?.mount({stage,paper,scripture,citationLinks,
    openWindow:options=>compare.openStudy(options),
    openCitation:(ref,options)=>compare.openCitation(ref,options),
    closeCitation:container=>compare.closeCitation(container),
    openNoteSearch:options=>finder?.openNote(options),
    closeNoteSearch:container=>finder?.closeNote(container),
    feedback,
  });
  const studyObjects=(locations,chapters)=>[...scripture.from(locations,true),...chapters];
  const openStudy=study&&((locations,chapters,focus)=>study.open(studyObjects(locations,chapters),focus));
  const hasStudy=study&&((locations,chapters)=>study.hasAny(studyObjects(locations,chapters)));
  const onWriteNote=study?.notesEnabled&&((locations,chapters,focus)=>study.open(studyObjects(locations,chapters),focus,'write'));
  compare=window.V25ScriptureWindows=window.V25Compare.mount({stage,scripture,feedback,
    onStudy:openStudy,hasStudy,onWriteNote,onHide:container=>finder?.closeNote(container),
    marks:()=>selection?.verseHighlights,onBegin:()=>selection?.reset({keepFocus:true}),
    onRead:loc=>history?.visitFloat(loc),onJump:({page,code,ref})=>{
      if(Number.isInteger(page))jump(page,null,null,{bookCode:code,ref,search:true});
    }});
  history=window.PaperReadingHistory?.create({host:$('reading-history'),storage,books:window.BIBLE_SOURCE.books,pageCount:LAST_PAGE+1,byChapter:true,
    onSettings:study&&(()=>{interrupt();study.openSettings();}),
    onDirectory:quickDirectory&&window.V25BookGroups&&openBookDirectory,
    mountFullscreen:window.PaperImmersion?.bindFullscreen,
    onFloat:loc=>{selection?.reset({keepFocus:true});compare.clearSelection();compare.open(loc);},
    onNavigate:(page,id,entry)=>jump(page,null,id,entry,id)});
  selection=window.PaperTextSelection?.create({stage,papers,storage,commands:Page.commands,feedback,crossPage:true,onFloat:compare.openSelection,onStudy:openStudy,hasStudy,onWriteNote,scripture,
    onBegin:compare.clearSelection,onMarksChange:compare.refreshHighlights,
    getPage:side=>({page:D.pages[spread+side],index:spread+side,books:D.books})});
  if(onWriteNote)window.addEventListener('paper-note-scope-changed',()=>{
    selection?.reset();compare.clearSelection();compare.closeMaterials();
  });
  if(onWriteNote)stage.addEventListener('paper-note-login-required',()=>feedback('在线笔记需要登录；这个预览尚未配置账号服务。',4500));
  const openingChoice=window.PaperEdgeChapters.openingPreference(storage);
  window.PaperEdgeChapters.mountOpeningChoice($('book-picker-opening'),openingChoice);
  function selectIndexChapter(page,requested){
    if(startPanKind==='directoryPan')cancelStartPan();
    if(openingChoice.get()==='page'){jump(page,null,null,requested);return;}
    $('book-picker').close();
    const chunks=scripture.index(requested.bookCode)?.chunks;
    const number=requested.ref?parseInt(requested.ref,10):null;
    const row=(number===null?chunks?.[0]:chunks?.find(chunk=>chunk.chapter===number))?.rows[0];
    if(!row){feedback('未找到这一章的经文');return;}
    compare.open(row);
  }
  chapters=window.PaperEdgeChapters.create(document.querySelector('.stage-wrap'),{books:D.books,onSelect:selectIndexChapter,opening:openingChoice,
    getBookFrame:bookFrame,onZoom:zoomWithChapterMenu,
    onDismiss:()=>{if(startPanKind==='directoryPan')cancelStartPan();},
    getPreview:(index,chapter)=>chapterPreview(D.books[index]?.code,chapter),
    getCurrent:()=>({bookIndex:D.books.indexOf(currentBook()),chapter:parseInt(readingLocation().ref,10)||1})});
  window.V25OverlayBack.register(chapters.element,{layer:10000,dismiss:()=>chapters.close()});
  function openEdgeChapters(i,_book,metadata={}){
    interrupt();
    chapters.open({bookIndices:metadata.bookIndices||[i],index:i,anchor:metadata.anchor});
  }
  function openBookDirectory(){
    interrupt();
    const book=currentBook(),code=book.code;
    $('v25-directory-current').textContent=book.name;
    for(const button of quickDirectory.querySelectorAll('button[data-book]')){
      if(button.dataset.book===code)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    }
    if(!quickDirectory.open)quickDirectory.showModal();
  }
  function showDirectoryCut(i){
    quickDirectory.close();interrupt();
    const cut=index.cutForBook?.(i);if(!cut)return;
    window.PaperImmersion?.hideChrome();stage.focus({preventScroll:true});
    const to=cameraTarget(view.w*(cut.side==='left'?.22:.78)-(cut.x+cut.width/2)*scale,
      view.h*.5-(cut.y+cut.height/2)*scale),dx=to.x-x,dy=to.y-y;
    const frame=bookFrame(),a=cut.anchor;
    // Choose the dock at the real cut's arrival point, even if the cut
    // initially lies offscreen, and let the existing leaf follow the camera.
    if(!chapters.open({index:i,bookIndices:cut.bookIndices,anchor:{left:a.left+dx,right:a.right+dx,top:a.top+dy,bottom:a.bottom+dy},
      arrivalFrame:{x:frame.x+dx,y:frame.y+dy,scale},deferFocus:true}))return;
    if(Math.hypot(dx,dy)>=.5)focus='custom';
    slideCamera(to,'directoryPan',()=>{transform();chapters.focus();});
  }
  if(quickDirectory&&window.V25BookGroups){
    const list=$('v25-book-directory-groups'),byCode=new Map(D.books.map((b,i)=>[b.code,{book:b,i}])),cells=[];
    const firstNew=byCode.get('MAT')?.i??39;
    for(const [groupIndex,[group,codes]] of Object.entries(window.V25BookGroups).entries()){
      const section=document.createElement('section'),description='v25-directory-category-'+groupIndex;
      section.className='v25-book-directory__group';section.setAttribute('aria-label',group);
      section.dataset.palette=String(groupIndex);
      for(const code of codes.split(' ')){
        const item=byCode.get(code);if(!item)continue;
        const button=document.createElement('button'),name=document.createElement('span');
        button.type='button';button.className='v25-book-directory__book';
        button.dataset.book=code;button.title=item.book.name;button.setAttribute('aria-label',item.book.name);
        button.setAttribute('aria-describedby',description);
        if(!section.childElementCount){
          const label=document.createElement('span');label.className='v25-book-directory__label';
          label.id=description;label.textContent=group;button.append(label);
        }
        name.className='v25-book-directory__name';
        const bits=Array.from(item.book.short);
        if(bits.length===2&&/^[上下前后一二三]$/.test(bits[1])){
          const suffix=document.createElement('span');suffix.className='v25-book-directory__suffix';suffix.textContent=bits[1];
          name.append(document.createTextNode(bits[0]),suffix);
        }else name.textContent=item.book.short;
        button.append(name);button.onclick=()=>showDirectoryCut(item.i);section.append(button);
        cells.push({button,groupIndex,testament:item.i<firstNew?'old':'new'});
      }
      list.append(section);
    }
    // Set a separate weight for cell, category and testament boundaries.
    // Every cell is one book in both orientations.
    const edge=(cell,other)=>!other?'none':other.groupIndex===cell.groupIndex?'1px solid var(--dir-inner-edge)':
      other.testament===cell.testament?'1px solid var(--dir-category-edge)':'2px solid var(--dir-testament-edge)';
    for(const [i,cell] of cells.entries())for(const cols of [6,11]){
      cell.button.style.setProperty('--north-'+cols,edge(cell,cells[i-cols]));
      cell.button.style.setProperty('--west-'+cols,edge(cell,i%cols?cells[i-1]:null));
    }
    list.addEventListener('keydown',e=>{
      const i=cells.findIndex(cell=>cell.button===e.target);if(i<0)return;
      const n=parseInt(getComputedStyle(list).getPropertyValue('--dir-columns'),10),col=i%n;
      const step={ArrowUp:-n,ArrowDown:n,ArrowLeft:col>0?-1:0,ArrowRight:col<n-1?1:0}[e.key];
      if(step===undefined)return;e.preventDefault();if(step)cells[i+step]?.button.focus();
    });
  }
  function openPicker(){
    interrupt();$('book-picker-books').hidden=false;$('book-picker-chapters').hidden=true;$('book-picker-back').hidden=true;
    $('book-picker-title').textContent='书卷与章节';$('book-picker').showModal();
  }
  function showChapters(i){
    const b=D.books[i],host=$('book-picker-chapters');host.replaceChildren();
    const add=(text,page,chapter)=>{const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>selectIndexChapter(page,{bookCode:b.code,ref:chapter?chapter+':1':null});host.appendChild(button);};
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
  function inwardDirection(bx,by){
    if(!onPaper(bx,by))return 0;
    // These distances are in paper coordinates: keep the same visible strip
    // grabbable when the paper grows. Ink, taps and outward drags stay separate.
    const margin=28;
    return bx<=margin?-1:bx>=960-margin?1:0;
  }
  function horizontalPaperEdge(bx,by){
    if(!v25||!onPaper(bx,by))return 0;
    const margin=24;
    return by<=margin?1:by>=704-margin?-1:0;
  }
  function flushPanPaint(){
    if(!panPaintFrame)return;
    cancelAnimationFrame(panPaintFrame);panPaintFrame=0;transform(true);
  }
  function panTo(px,py,batch=false){
    const oldX=x,oldY=y;x=px;y=py;constrain();
    if(Math.abs(x-oldX)<.00001&&Math.abs(y-oldY)<.00001)return false;
    searchAnchor=null;hideStartShortcut();hideColumnShortcut();focus='custom';
    if(batch){
      if(!panPaintFrame)panPaintFrame=requestAnimationFrame(()=>{panPaintFrame=0;transform(true);});
    }else if(panPaintFrame)flushPanPaint();else transform(true);
    return true;
  }
  function samplePan(g,c,e){
    if(!g.samples)return;
    const add=({x,y,t})=>{
      const last=g.samples.at(-1);
      if(last&&(t<last.t||Math.hypot(x-last.x,y-last.y)<1))return;
      g.samples.push({x,y,t});
      while(g.samples.length>2&&t-g.samples[0].t>110)g.samples.shift();
    };
    for(const p of e.getCoalescedEvents?.()||[])add({x:c.x+p.clientX-e.clientX,y:c.y+p.clientY-e.clientY,t:p.timeStamp});
    add(c);
  }
  function stopCoast(){
    flushPanPaint();if(!coastFrame)return;
    cancelAnimationFrame(coastFrame);coastFrame=0;delete stage.dataset.panCoasting;save();
  }
  function coast(g,end,done){
    if(!g.panned||!g.samples||reduceMotion())return false;
    const last=g.samples.at(-1),first=g.samples.find(p=>last.t-p.t<=100);
    if(!first||end.t-last.t>72||last.t-first.t<12)return false;
    const dt=last.t-first.t;let vx=(last.x-first.x)/dt,vy=(last.y-first.y)/dt;
    if(Math.abs(vx)>2.2*Math.abs(vy))vy=0;else if(Math.abs(vy)>2.2*Math.abs(vx))vx=0;
    const speed=Math.hypot(vx,vy);if(speed<.38)return false;
    const duration=clamp(210+speed*58,230,390),travel=duration/2.8,fromX=x,fromY=y;
    const to=cameraTarget(x+clamp(vx*travel,-view.w*.8,view.w*.8),y+clamp(vy*travel,-view.h*.85,view.h*.85));
    if(Math.hypot(to.x-x,to.y-y)<12)return false;
    const started=performance.now();stage.dataset.panCoasting='true';
    function frame(now){
      const t=clamp((now-started)/duration,0,1),p=1-(1-t)**3;
      panTo(fromX+(to.x-fromX)*p,fromY+(to.y-fromY)*p);
      if(t<1)coastFrame=requestAnimationFrame(frame);
      else{coastFrame=0;delete stage.dataset.panCoasting;done();}
    }
    coastFrame=requestAnimationFrame(frame);return true;
  }
  function revealAtVerticalEnd(dy){
    if(!v25||fold||jumpState||chapters?.isOpen()||!dy)return false;
    const [minY,maxY]=verticalLimits();
    if(maxY-minY<.5||(dy<0?y>minY+.5:y<maxY-.5))return false;
    window.PaperImmersion?.showAtReadingBoundary();return true;
  }
  function pointerDown(e){
    if(!pointers.size&&e.button<=0)stopCoast();
    let target=e.target;
    const exact=e.pointerType==='touch'?document.elementFromPoint(e.clientX,e.clientY):null;
    // The reader already handles badge taps on pointerup. Do not let the
    // browser also focus the SVG group and paint its native focus highlight.
    if(e.button===0&&target?.closest?.('[data-chapter-total]'))e.preventDefault();
    if(exact&&target?.closest?.('.paper-selection-tools[data-compact],[data-chapter-total]')){
      // A nearby button may win the browser's touch adjustment even when
      // the actual contact is on adjacent ink. Keep that tap in the book.
      if(stage.contains(exact)&&(exact.closest('text[data-role],[data-chapter-total]')||target.closest('[data-chapter-total]')))target=exact;
    }
    // Resolve touch adjustment at the border both ways: the browser can
    // snap a contact on paper or on the blank band to a nearby index button.
    if(target?.closest?.(indexSurface)&&exact?.closest('#left-paper,#right-paper'))target=exact;
    if(exact&&target?.closest?.('#fit-reading-column'))target=exact;
    const indexTarget=exact?.closest(indexSurface)||target?.closest?.(indexSurface);
    const adaptHit=e.pointerType==='touch'&&!adaptButton?.hidden&&(exact||target)?.closest?.('#fit-reading-column');
    if(jumpState||chapters?.isOpen()||e.button>0||indexTarget?.disabled||
       (!indexTarget&&!adaptHit&&target?.closest?.('button,a,input,dialog,.edge-index,.paper-selection-tools')))return;
    if(!pointers.size)suppressIndexClick=null;
    // A new touch should not be lost in the short release animation.
    if(smoothTurn&&e.pointerType==='touch'&&fold?.settling&&pointers.size===0){
      queuedTurns=[];finishFold(fold.commit);
    }
    // A still tap on the margin only toggles the shelf. Keep the return
    // shortcut alive; its CSS moves it above the revealed controls.
    hideColumnShortcut();if(!adaptHit||pointers.size)hideAdapt();cancelStartPan();clearHold();
    // Tabs and the blank band are index surfaces, not draggable pages.
    // Their contacts still count when either finger of a pinch starts there.
    const cuts=gesture?.cuts||new Set();if(indexTarget)cuts.add(indexTarget);
    pointers.set(e.pointerId,relative(e));try{(indexTarget||stage).setPointerCapture(e.pointerId);}catch{}
    if(pointers.size>1){
      const c=centroid(),initialScale=gesture?.initialScale??scale;
      hideStartShortcut();
      if(fold){queuedTurns=[];finishFold(false);}
      stage.classList.remove('curl-dragging');
      // Tabs move under the fingers as the book zooms. Keep the pinch on the
      // stage instead of whichever native button was initially pressed.
      for(const id of pointers.keys())try{stage.setPointerCapture(id);}catch{}
      const point=relative(e),fromPaper=gesture?.fromPaper||!indexTarget&&onPaper((point.x-x)/scale,(point.y-y)/scale);
      gesture={pinched:true,cuts,start:c,baseX:x,baseY:y,baseScale:scale,baseDistance:distance(),initialScale,fromPaper};return;
    }
    const start=relative(e),chapterBadge=target?.closest?.('[data-chapter-total]');
    const token=fold||indexTarget||chapterBadge||adaptHit?null:selection?.hit(e.clientX,e.clientY,target);
    const bx=(start.x-x)/scale,by=(start.y-y)/scale;
    const g=gesture={start,end:start,indexTarget,cuts,token,chapterBadge,adaptHit,wasTurning:!!fold,baseX:x,baseY:y,baseScale:scale,kind:'pending',pinched:false,
      edge:inwardDirection(bx,by),rim:horizontalPaperEdge(bx,by),leaf:bx<480?-1:1,
      fromPaper:onPaper(bx,by),
      touchFit:smoothTurn&&flatTouch&&e.pointerType==='touch'&&focus==='fit'&&onPaper(bx,by),
      contact:{radius:clamp(Math.abs(bx-480),12,480),grabY:clamp(by,0,704)},
      direction:0,trend:1,extreme:0,samples:flatTouch&&e.pointerType==='touch'&&!indexTarget&&onPaper(bx,by)?[start]:null};
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
  function flushFoldDrag(){
    cancelAnimationFrame(foldDragFrame);foldDragFrame=0;
    if(!fold?.pendingPose)return;
    const {progress,vertical}=fold.pendingPose;fold.pendingPose=null;updateFold(progress,vertical);
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
    if(fold.progress===progress&&fold.vertical===vertical&&!fold.pendingPose)return;
    if(flatTouch&&fold.animate){
      fold.pendingPose={progress,vertical};if(!foldDragFrame)foldDragFrame=requestAnimationFrame(flushFoldDrag);
    }else updateFold(progress,vertical);
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
      if(Math.abs(scale-g.initialScale)>.00001)adaptRightEdge=null;
      x=c.x-(g.start.x-g.baseX)/g.baseScale*scale;y=c.y-(g.start.y-g.baseY)/g.baseScale*scale;
      focus=scale===fitScale?'fit':'custom';constrain();transform();return;
    }
    if(g.kind==='held'||g.wasTurning)return;
    const dx=c.x-g.start.x,dy=c.y-g.start.y;
    if(g.indexTarget){if(Math.hypot(dx,dy)>MOVE_SLOP)g.kind='index-drag';return;}
    if(g.kind==='pending'&&(Math.hypot(dx,dy)>MOVE_SLOP||columnSwipe(g,dx,dy,e.pointerType))){
      hideStartShortcut();hideAdapt();clearHold();
      const fitSwipe=g.touchFit&&!g.rim&&Math.abs(dx)>=Math.abs(dy)*1.35;
      if(fitSwipe)g.edge=Math.sign(-dx);
      const rimSwipe=g.rim&&!g.token&&
        (-dx*g.leaf>=Math.abs(dy)*1.35||dy*g.rim>=Math.abs(dx)*1.35);
      if(rimSwipe&&!fitSwipe){
        g.edge=g.leaf;g.verticalTurn=dy*g.rim>=Math.abs(dx)*1.35;
      }
      const edgeSwipe=g.edge&&!g.token&&-dx*g.edge>=Math.abs(dy)*1.35;
      g.kind=fitSwipe||rimSwipe||edgeSwipe?'swipe':'pan';
      if(g.kind==='pan')stage.classList.add('dragging');
    }
    if(g.kind==='swipe')trackCurl(g,c,e);
    else if(g.kind==='pan'&&!fold){
      samplePan(g,c,e);if(panTo(g.baseX+dx,g.baseY+dy,flatTouch&&e.pointerType==='touch'))g.panned=true;
    }
  }
  function pointerUp(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    // Browsers can coalesce the last move into pointerup. The final contact,
    // especially a last-moment reversal, must decide the release, not stale ink.
    if(!cancelled)pointerMove(e);
    flushPanPaint();
    clearHold();const g=gesture;
    const end=relative(e);pointers.delete(e.pointerId);
    if(cancelled&&g)g.cancelled=true;
    if(g?.cuts.size&&(g.kind!=='pending'||g.cancelled||g.pinched))suppressIndexClick={cuts:g.cuts,until:performance.now()+700};
    if(pointers.size){
      if(g?.pinched){g.start=centroid();g.baseX=x;g.baseY=y;g.baseScale=scale;g.baseDistance=distance();g.tail=pointers.size===1;}
      return;
    }
    gesture=null;stage.classList.remove('dragging','curl-dragging');try{stage.releasePointerCapture(e.pointerId);}catch{}
    if(!g)return;
    if(g.cancelled||g.pinched||g.wasTurning){
      if(g.cancelled&&g.kind==='swipe'&&fold&&!fold.settling)settleFold(false);
      stage.dataset.lastGesture=g.cancelled?'cancelled':g.pinched?'pinch':'turning';
      if(g.pinched){
        save();
        if(!g.cancelled&&e.pointerType==='touch'&&g.fromPaper&&!g.cuts.size&&Math.abs(scale/g.initialScale-1)>=.01)offerAdapt();
      }
      return;
    }
    if(g.kind==='pending'&&g.adaptHit){
      const button=adaptButton?.getBoundingClientRect();
      if(button&&!adaptButton.hidden&&end.t-g.start.t<TEXT_HOLD_MS&&e.clientX>=button.left&&e.clientX<=button.right&&
         e.clientY>=button.top&&e.clientY<=button.bottom)adaptColumn();
      return;
    }
    if(g.kind==='pending'&&g.chapterBadge){
      const actual=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-chapter-total]');
      if(actual===g.chapterBadge&&end.t-g.start.t<TEXT_HOLD_MS)study?.openChapterBadge(actual,e.clientY);
      return;
    }
    if(g.kind==='pending'&&g.token){
      hideStartShortcut();
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
    if(v25&&g.kind==='pending'&&!g.indexTarget){
      window.dispatchEvent(new Event('paper-reader-tap'));return;
    }
    if(g.kind==='swipe'&&fold){
      const commit=releaseCurl(g,end);stage.dataset.lastGesture=commit?'swipe-turn':'swipe-return';settleFold(commit);return;
    }
    if(g.kind==='pan'){
      stage.dataset.lastGesture='pan';
      const dx=end.x-g.start.x,dy=end.y-g.start.y;
      const continuation=columnSwipe(g,dx,dy,e.pointerType);
      const done=()=>{
        if(g.panned)save();
        if((g.fromPaper||g.panned)&&Math.abs(dy)>=MOVE_SLOP&&Math.abs(dy)>=1.35*Math.abs(dx))revealAtVerticalEnd(dy);
        if(continuation){
          offerColumnShortcut(continuation);stage.dataset.lastGesture='column-end';
        }
      };
      if(!coast(g,end,done))done();
    }
  }
  // See the starting surface before native tab clicks, and ignore a click
  // synthesized after a drag or pinch on an index surface.
  stage.addEventListener('pointerdown',pointerDown,true);stage.addEventListener('pointermove',pointerMove);
  stage.addEventListener('pointerup',e=>pointerUp(e),true);stage.addEventListener('pointercancel',e=>pointerUp(e,true),true);
  stage.addEventListener('click',e=>{
    if(!fold&&!jumpState&&!chapters?.isOpen()&&e.detail===0){
      const badge=e.target?.closest?.('[data-chapter-total]');if(badge){study?.openChapterBadge(badge);return;}
    }
    if(suppressIndexClick&&e.detail!==0&&performance.now()<=suppressIndexClick.until&&suppressIndexClick.cuts.has(e.target?.closest?.(indexSurface))){
      e.preventDefault();e.stopPropagation();
    }
  },true);
  stage.addEventListener('lostpointercapture',e=>{
    // A tab or band handing off capture to the stage has not lost the pinch.
    if(e.target!==stage&&stage.hasPointerCapture?.(e.pointerId))return;
    if(pointers.has(e.pointerId))pointerUp(e,true);
  });
  window.addEventListener('blur',interrupt);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();});
  let wheelBurst=null;
  function wheelStroke(e,dx,dy){
    // Wheel has no cross-browser gesture-end event. Keep momentum in the
    // same stroke so it does not re-open a toolbar the reader just dismissed.
    const now=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now();
    if(!wheelBurst||now-wheelBurst.last>220)wheelBurst={dx:0,dy:0,axis:null,used:false};
    const b=wheelBurst;b.last=now;b.dx+=dx;b.dy+=dy;
    if(!b.axis&&Math.max(Math.abs(b.dx),Math.abs(b.dy))>=12){
      if(Math.abs(b.dx)>=1.35*Math.abs(b.dy))b.axis='horizontal';
      else if(Math.abs(b.dy)>=1.35*Math.abs(b.dx))b.axis='vertical';
    }
    if(!b.used&&b.axis==='vertical'&&Math.abs(b.dy)>=12&&Math.sign(dy)===Math.sign(b.dy)&&revealAtVerticalEnd(-dy))b.used=true;
    return b;
  }
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
      zoom(next,at,!overIndex);
      return;
    }
    e.preventDefault();if(overIndex||pointers.size){wheelBurst=null;return;}
    stopCoast();hideColumnShortcut();cancelStartPan();
    if(scale>fitScale+.00001){
      if(fold){wheelBurst=null;return;}
      if(panTo(x-dx,y-dy))save();wheelStroke(e,dx,dy);return;
    }
    if(!onPaper((at.x-x)/scale,(at.y-y)/scale))return;
    const b=wheelStroke(e,dx,dy);
    if(!b.used&&b.axis==='horizontal'&&Math.abs(b.dx)>=48){
      b.used=true;if(!fold)turn(b.dx>0?1:-1,1,'trackpad');
    }
  },{passive:false});
  stage.addEventListener('keydown',e=>{
    if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&(e.altKey||e.ctrlKey||e.metaKey))return;
    if(jumpState||chapters?.isOpen()){if(e.key==='Escape'){e.preventDefault();interrupt();}return;}
    if(!fold&&(e.key==='Enter'||e.key===' ')){
      const badge=e.target?.closest?.('[data-chapter-total]');
      if(badge){e.preventDefault();if(!e.repeat)study?.openChapterBadge(badge);return;}
    }
    if(e.target?.closest?.('button,input,dialog'))return;
    if(e.key==='ArrowRight'){e.preventDefault();turn(1);}else if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}
    else if(e.key==='Escape')interrupt();else if(e.key==='+'||e.key==='=')zoom(scale*1.2);else if(e.key==='-')zoom(scale/1.2);else if(e.key==='0')fit();
  });
  $('fit-book').onclick=fit;$('zoom-value').onclick=fit;
  for(const side of ['left','right'])$('focus-'+side).onclick=()=>{focusPage(side);advanceHistory();};
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
  // The physical boot has already awaited every book face. A late load of
  // unrelated UI fonts must not replace the prepared leaves mid-opening.
  if(!D.physical)document.fonts?.addEventListener?.('loadingdone',()=>{const n=spread;requestAnimationFrame(()=>{if(n===spread&&!fold&&!jumpState&&!gesture&&!selection?.isActive()){papers.forEach((paper,i)=>paper.innerHTML=svgPage(n+i));selection?.refresh?.();markSearchInk();}})});
  render();resize();
  if(saved?.zoom>1&&Number.isFinite(saved.centerX)&&Number.isFinite(saved.centerY)){
    scale=clamp(fitScale*saved.zoom,fitScale,MAX_SCALE);x=view.w/2-saved.centerX*scale;y=view.h/2-saved.centerY*scale;focus=saved.focus||'custom';constrain();transform();
  }
  // On a phone a single page is the useful initial reading window; whole-book
  // fit remains available, and both index bands stay reachable by pan.
  else if(view.w<560)focusPage(readingSide?'right':'left',true);
  if(!window.V25Account?.usingProfile)deskKey=history?.start(readingLocation())?.id||null;
  coverZoom=window.PaperCoverZoom?.mount({doc:document,win:window,stage,history:$('reading-history'),
    onZoom(percent){
      const next=window.PaperCoverZoom.asScale(percent,fitScale,MAX_SCALE);
      if(next===null)return;
      if(chapters?.isOpen())zoomWithChapterMenu(next/scale);else zoom(next);
    }});
  // Only this V25 shelf has labeled tools and paired find/directory entries.
  const rail=$('reading-history')?.querySelector('.rh-rail'),ratio=rail?.querySelector('.pcz-button');
  if(ratio){
    const label=document.createElement('span');label.className='rh-tool-label';label.textContent='比例';label.setAttribute('aria-hidden','true');
    ratio.append(label);rail.querySelector('.rh-directory')?.after(ratio.parentElement);
  }
  window.addEventListener('v25-read-citation',e=>{
    const {code,ref}=e.detail||{},page=window.V25OriginalData.lookup(code,ref);
    if(Number.isInteger(page))jump(page,null,null,{bookCode:code,ref,search:true});
  });
  finder=window.mountVerseFinder({scripture,citationLinks,windows:compare,
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
  // At this point the final SVG, saved ink, index and reading pose already
  // exist. Future on-page annotations belong inside these same .paper faces
  // and should be hydrated by render(), never by the opening controller.
  if(!noTurnMotion)opening=window.V25Opening?.play({stage,book,pose:{x,y,scale,...view},
    layoutZoom:flatTouch&&CSS.supports('zoom','1')});
  new ResizeObserver(resize).observe(stage);window.addEventListener('resize',resize);
  controllerReady=true;
  if(!window.V25Account?.usingProfile)save();
})();
