/* Persistent ink labels embedded in absolute-depth thumb recesses.
 * The same nodes follow fanned curved paper, closed fore-edge, and optional
 * digital directory; there is no replacement directory book or flat slab. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./book-kinematics.js'):root.PaperBookKinematics,typeof module==='object'&&module.exports?require('./book-solid.js'):root.PaperBookSolid,typeof module==='object'&&module.exports?require('./book-index-layout.js'):root.PaperBookIndexLayout);if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookIndex=api;})(typeof window!=='undefined'?window:globalThis,function(K,Solid,Layout){
  'use strict';
  const WIDTH=36,HEIGHT=704,DIGITAL_WIDTH=480,ROW=70,INK_STRIPS=6;
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,t)=>{const q=clamp((t-a)/(b-a));return q*q*(3-2*q);};
  const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const translation=(x,y,z=0)=>{const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;};
  function multiply(a,b){const r=Array(16).fill(0);for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[c*4+row]+=a[k*4+row]*b[c*4+k];return r;}
  function inverse(m){
    const a=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?m[c*4+r]:+(c-4===r)));
    for(let c=0;c<4;c++){let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
      if(Math.abs(a[pivot][c])<1e-10)throw new TypeError('Singular fore-edge matrix');
      [a[c],a[pivot]]=[a[pivot],a[c]];const div=a[c][c];for(let k=0;k<8;k++)a[c][k]/=div;
      for(let r=0;r<4;r++)if(r!==c){const factor=a[r][c];for(let k=0;k<8;k++)a[r][k]-=factor*a[c][k];}}
    return Array.from({length:16},(_,i)=>a[i%4][4+Math.floor(i/4)]);
  }
  function matrix(value,fallback){const a=Array.isArray(value)?value:typeof value==='string'?value.replace(/^matrix3d\(|\)$/g,'').split(',').map(Number):null;return a?.length===16&&a.every(Number.isFinite)?a.slice():fallback.slice();}
  const css=m=>'matrix3d('+m.map(n=>Math.abs(n)<1e-11?'0':n.toFixed(8)).join(',')+')';
  const mixMatrix=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
  function sourceCount(books){return Layout.sourceCount(books);}
  function geometry(books,pageCount=sourceCount(books),totalDepth=WIDTH){
    return Layout.geometry(books,pageCount,totalDepth);
  }
  const groupBooks=(books,pageCount,totalDepth)=>geometry(books,pageCount,totalDepth).groups;
  function layoutAt(slot,amount){const d=clamp(amount),a=slot.physical,b=slot.digital;return {x:lerp(a.x,b.x,d),y:lerp(a.y,b.y,d),width:lerp(a.width,b.width,d),height:lerp(a.height,b.height,d)};}
  // Match the coarse solid's real triangular envelope. Ink must be on its
  // visible surface, not on the analytic recess below a chord approximation.
  function facetSampler(material,close,state){
    const total=material.totalDepth,bands=Solid?.DEPTH_BANDS||5,depths=Array.from({length:bands+1},(_,i)=>total*i/bands),points=K.prepare(material,close,state);
    for(const n of state.notches){
      const scoped=Number.isFinite(n.cutStart)&&Number.isFinite(n.cutEnd);
      for(const d of scoped?[...K.cutRange(n),n.depth,n.carrierDepth]:n.span<total/bands*.4?[n.depth]:[])
        if(Number.isFinite(d))depths.push(clamp(d,0,total));
    }
    const sorted=[...new Set(depths)].sort((a,b)=>a-b),topology=[];
    for(let i=0;i<sorted.length-1;i++){
      const from=sorted[i],to=sorted[i+1],ys=[0,HEIGHT];
      for(const n of state.notches)if(K.cutRange(n)[1]>=from&&K.cutRange(n)[0]<=to)for(const q of [-1,-.8660254038,-.5,0,.5,.8660254038,1])ys.push(clamp(n.y+n.radius*q,0,HEIGHT));
      const sortedYs=[...new Set(ys)].sort((a,b)=>a-b),split=material.leftDepth;
      if(split>from+1e-8&&split<to-1e-8){topology.push({from,to:split,ys:sortedYs},{from:split,to,ys:sortedYs});}
      else topology.push({from,to,ys:sortedYs});
    }
    const sample=(side,depth,y)=>{
      const s=clamp(depth,0,total),yy=clamp(y,0,HEIGHT);
      const band=topology.find(b=>s>=b.from-1e-8&&s<=b.to+1e-8)||topology[topology.length-1];
      const from=band.from,to=band.to;
      let k=0;while(k<band.ys.length-2&&yy>band.ys[k+1])k++;
      const y0=band.ys[k],y1=band.ys[k+1],a=clamp((s-from)/(to-from)),b=clamp((yy-y0)/(y1-y0));
      const p00=points.foreedgePoint(side,from,y0),p01=points.foreedgePoint(side,from,y1),p11=points.foreedgePoint(side,to,y1),p10=points.foreedgePoint(side,to,y0);
      const vertices=b>=a?[p00,p01,p11]:[p00,p11,p10],weights=b>=a?[1-b,b-a,a]:[1-a,b,a-b];
      const p={x:0,y:0,z:0};for(let j=0;j<3;j++)for(const key of ['x','y','z'])p[key]+=vertices[j][key]*weights[j];
      if(depth!==s)p.x+=depth-s;
      if(y!==yy)p.y+=y-yy;
      return p;
    };
    // The support-plane maximum lies at a triangle/rectangle intersection
    // vertex, not necessarily at the strip corners or its midpoint.
    sample.critical=(s0,s1,y0,y1)=>{
      const out=[[s0,y0],[s1,y0],[s1,y1],[s0,y1]];
      // Ink can overhang the first/last sheet. sample() extends that sheet's
      // edge, so its intermediate vertical vertices remain support extrema,
      // even when the entire ink strip lies outside [0,totalDepth].
      for(const [a,b,band] of [[s0,Math.min(s1,0),topology[0]],[Math.max(s0,total),s1,topology.at(-1)]]){
        if(a>=b||!band)continue;
        for(const yy of band.ys)if(yy>y0&&yy<y1)out.push([a,yy],[b,yy]);
      }
      for(const band of topology){
        const a0=Math.max(s0,band.from),a1=Math.min(s1,band.to);if(a1<a0)continue;
        for(let j=0;j<band.ys.length-1;j++){
          const by0=band.ys[j],by1=band.ys[j+1],b0=Math.max(y0,by0),b1=Math.min(y1,by1);if(b1<b0)continue;
          out.push([a0,b0],[a1,b0],[a1,b1],[a0,b1]);
          for(const yy of [b0,b1]){const ss=band.from+(band.to-band.from)*(yy-by0)/(by1-by0);if(ss>a0&&ss<a1)out.push([ss,yy]);}
          for(const ss of [a0,a1]){const yy=by0+(by1-by0)*(ss-band.from)/(band.to-band.from);if(yy>b0&&yy<b1)out.push([ss,yy]);}
        }
      }
      return out;
    };
    return sample;
  }
  function inkStripMatrix(sample,side,depth,y,scale,start,width,height){
    const at=(x,v)=>sample(side,depth+x/scale,y+v),p=at(start,-height/2),q=at(start+width,-height/2),r=at(start,height/2);
    const ax={x:(q.x-p.x)/width,y:(q.y-p.y)/width,z:(q.z-p.z)/width},ay={x:(r.x-p.x)/height,y:(r.y-p.y)/height,z:(r.z-p.z)/height};
    let n={x:ax.y*ay.z-ax.z*ay.y,y:ax.z*ay.x-ax.x*ay.z,z:ax.x*ay.y-ax.y*ay.x};
    const length=Math.hypot(n.x,n.y,n.z)||1;if(n.z<0){n.x=-n.x;n.y=-n.y;n.z=-n.z;}for(const key of ['x','y','z'])n[key]/=length;
    let lift=.3;
    const critical=sample.critical?sample.critical(depth+start/scale,depth+(start+width)/scale,y-height/2,y+height/2):[];
    for(const [ss,yy]of critical){
      const dx=(ss-depth)*scale-start,dy=yy-y+height/2,exact=sample(side,ss,yy),planeZ=p.z+ax.z*dx+ay.z*dy;
      lift=Math.max(lift,exact.z-planeZ+.3);
    }
    return [ax.x,ax.y,ax.z,0,ay.x,ay.y,ay.z,0,n.x,n.y,n.z,0,p.x,p.y,p.z+lift,1];
  }
  function create(options){
    const {host,books,onSelect,onClose,onViewChange,onPan}=options;
    if(!host?.ownerDocument||!Array.isArray(books)||!books.length)throw new TypeError('Index requires a DOM host and books');
    const doc=host.ownerDocument,disposers=[];let model=geometry(books,options.pageCount),digital=0,focused=-1,scrollAnchor=0,lastView='physical',destroyed=false;
    let frame={leftMatrix:translation(480-WIDTH/2,0,480),rightMatrix:translation(480-WIDTH/2,0,480),splitDepth:0,totalDepth:WIDTH};
    let drag=null,suppressClick=false,surface=null,interactionSide='both';
    function el(tag,className,parent,text){const n=doc.createElement(tag);n.className=className;if(text!=null)n.textContent=text;if(parent)parent.appendChild(n);return n;}
    function listen(n,type,fn,opts){n.addEventListener(type,fn,opts);disposers.push(()=>n.removeEventListener(type,fn,opts));}
    function parent(n,target){if(n.parentElement!==target&&n.parent!==target)target.appendChild(n);}
    const root=el('div','pbi-root',host);root.setAttribute('role','group');root.setAttribute('aria-label','圣经书侧拇指索引');
    const panSurfaces=[el('div','pbi-pan-surface pbi-pan-left',root),el('div','pbi-pan-surface pbi-pan-right',root)];
    const recesses=model.groups.map(group=>{const node=el('div','pbi-recess-shadow',root);node.setAttribute('aria-hidden','true');node.dataset.group=String(group.index);return node;});
    panSurfaces.forEach(n=>n.setAttribute('aria-hidden','true'));
    const viewport=el('div','pbi-scroll',root),sheet=el('div','pbi-sheet',viewport);
    const buttons=books.map((book,i)=>{
      const slot=model.slots[i],button=el('button','pbi-book pbi-'+slot.testament,root);button.type='button';button.dataset.bookIndex=String(i);button.dataset.notchRow=String(slot.groupRow);button.dataset.notchGroup=String(slot.group);button.dataset.indexTrack=slot.track;button.title=book.name;button.setAttribute('aria-label','打开'+book.name);
      const fragments=[0,1].map(side=>{const fragment=el('span','pbi-fragment',button);fragment.setAttribute('aria-hidden','true');fragment.dataset.side=side?'right':'left';
        const abbr=el('span','pbi-abbr',fragment,slot.label),name=el('span','pbi-name',fragment,book.name),order=el('span','pbi-order',fragment,String(i+1).padStart(2,'0')),tick=el('span','pbi-depth-tick',fragment);return{fragment,abbr,name,order,tick};});
      const ink=Array.from({length:INK_STRIPS},()=>{const strip=el('span','pbi-ink-strip',button);strip.hidden=true;strip.setAttribute('aria-hidden','true');const abbr=el('span','pbi-strip-abbr',strip,slot.label);return{strip,abbr};});
      listen(button,'click',e=>{e.stopPropagation();if(!button.disabled&&(!suppressClick||e.detail===0))onSelect?.(i);});return{button,fragments,ink};
    });
    const heading=el('div','pbi-heading',root);heading.setAttribute('aria-hidden','true');el('span','pbi-heading-kicker',heading,'同一纸层 · 展开索引');el('strong','pbi-heading-title',heading,'按书卷找到那一页');
    const note=el('div','pbi-digital-note',sheet,'旧约墨黑 · 新约朱红　／　上下滑动查看全部书卷');note.setAttribute('aria-hidden','true');note.style.top=(model.digitalHeight-32)+'px';
    const interactionHost=options.interactionHost||host;
    const originalCursor=interactionHost.style.cursor||'';let hovered=null;
    function hoverBook(index){if(index===hovered)return;if(hovered!==null)buttons[hovered].button.classList.remove('pbi-hover');hovered=index;if(index!==null)buttons[index].button.classList.add('pbi-hover');interactionHost.style.cursor=index===null?originalCursor:'pointer';}
    // Chromium may hit the host instead of a visibly painted 3D child. Listen
    // at that ancestor, and resolve the current ink, not the tangent button
    // plane: wrapped ink strips can extend beyond that plane's screen bounds.
    function hitBook(e){
      if(!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return null;
      if(digital===0&&options.depthInk?.()){
        const found=interactionSide===null?null:options.hitTest?.(e,interactionSide)??null;
        return Number.isInteger(found)&&buttons[found]&&!buttons[found].button.disabled?found:null;
      }
      let nearest=null,distance=Infinity;
      buttons.forEach((nodes,i)=>{
        if(nodes.button.disabled)return;
        const ink=nodes.ink.filter(({strip})=>!strip.hidden).map(({strip})=>strip);
        const faces=ink.length?ink:nodes.fragments.filter(({fragment,abbr})=>fragment.style.visibility!=='hidden'&&abbr.style.visibility!=='hidden').map(({fragment})=>fragment);
        const targets=digital===1?[nodes.button]:faces;
        targets.forEach(node=>{
          const r=node.getBoundingClientRect();if(!r.width||!r.height)return;
          const dx=Math.max(r.left-e.clientX,0,e.clientX-r.right),dy=Math.max(r.top-e.clientY,0,e.clientY-r.bottom);
          if(dx>2||dy>2)return;
          const delta=Math.hypot(dx,dy)*1000+Math.hypot(e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);
          if(delta<distance){distance=delta;nearest=i;}
        });
      });
      return nearest;
    }
    function stopClick(e){e.preventDefault?.();e.stopPropagation();e.stopImmediatePropagation?.();}
    function stopPointer(e){e.stopPropagation();e.stopImmediatePropagation?.();}
    listen(interactionHost,'click',e=>{
      if(e.detail===0)return; // Native keyboard activation remains on the button.
      if(digital===1)return; // A flat, scrollable list uses normal native button clicks.
      if(suppressClick){stopClick(e);return;}
      const nearest=hitBook(e);
      if(nearest!==null){stopClick(e);hoverBook(null);onSelect?.(nearest);}
    },true);
    listen(interactionHost,'pointerdown',e=>{
      if(drag){if(e.pointerId!==drag.id){drag.cancelled=true;suppressClick=true;hoverBook(null);stopPointer(e);}return;}
      suppressClick=false;
      if(digital!==0||e.button>0)return;
      const selected=hitBook(e);
      if(selected===null&&!panSurfaces.includes(e.target))return; // Blank fan tap belongs to the reading controller.
      stopPointer(e);drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,last:e.clientY,moved:false,selected};
      try{interactionHost.setPointerCapture?.(e.pointerId);}catch{}
    },true);
    listen(interactionHost,'pointermove',e=>{
      if(!drag){hoverBook(digital===0?hitBook(e):null);return;}
      if(e.pointerId!==drag.id)return;stopPointer(e);
      if(digital!==0||drag.cancelled)return;
      const dy=e.clientY-drag.last;drag.last=e.clientY;
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>8)drag.moved=true;
      if(drag.moved){suppressClick=true;hoverBook(null);e.preventDefault?.();onPan?.(-dy);}
    },true);
    function endDrag(e,cancelled=false){
      if(!drag||e.pointerId!==drag.id)return;stopPointer(e);
      const ended=drag;drag=null;suppressClick=true;hoverBook(null);
      try{interactionHost.releasePointerCapture?.(e.pointerId);}catch{}
      if(cancelled||ended.cancelled||digital!==0||ended.moved||Math.hypot(e.clientX-ended.startX,e.clientY-ended.startY)>8)return;
      if(ended.selected!==null&&hitBook(e)===ended.selected)onSelect?.(ended.selected);
    }
    listen(interactionHost,'pointerup',e=>endDrag(e),true);listen(interactionHost,'pointercancel',e=>endDrag(e,true),true);
    listen(interactionHost,'lostpointercapture',e=>{if(drag?.id===e.pointerId){drag=null;suppressClick=true;hoverBook(null);}},true);
    listen(interactionHost,'pointerleave',()=>{if(!drag)hoverBook(null);});
    listen(interactionHost,'wheel',e=>{if(digital!==0||interactionSide===null)return;stopClick(e);onPan?.(Number(e.deltaY)||0);},{passive:false,capture:true});
    for(const type of ['dblclick','contextmenu'])listen(root,type,e=>{e.stopPropagation();e.preventDefault();});
    listen(root,'keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose?.();}});
    function notches(){return model.groups.map(group=>({...group.notch}));}
    // A label is ink at a real recess, not artwork stretched over a card.
    // The local x axis is the unit tangent through absolute paper depths:
    // fanning spreads these depths apart but cannot distort the letter shapes.
    let physicalState=null;
    function milledMatrix(slot,side,state){
      const n=state.notches[slot.group],{material,close}=surface;
      const v=.5+(slot.groupRow-(n.indices.length-1)/2)*(.69/n.indices.length);
      const dir=close>.9999||side==='right'?1:-1;
      const inspect=state.edgeInspection?K.inspectionAmount(close):0;
      const s=n.depth+n.span*dir*.90*Math.sqrt(1-(v*2-1)**2)*(1-inspect);
      const p=K.foreedgePoint(side,s,n.y+n.radius*(v*2-1),material,close,state);
      const half=n.span*(.12+inspect*.21);
      const l=K.foreedgePoint(side,s-half,n.y,material,close,state),r=K.foreedgePoint(side,s+half,n.y,material,close,state);
      const width=slot.physical.width,height=slot.physical.height;
      const xx=Math.max(.075,Math.abs(r.x-l.x)/width*2),xz=(r.z-l.z)/width*2;
      return {matrix:[xx,0,xz,0,0,1,0,0,0,0,1,0,p.x-xx*width/2,p.y-height/2,p.z-xz*width/2,1]};
    }
    function surfaceMatrix(side,depth,y,width,height){
      if(!surface||!K)return null;
      const {material,close}=surface,state=physicalState||{fanLeft:surface.fanLeft,fanRight:surface.fanRight,notches:notches()};
      const p=K.foreedgePoint(side,depth,y,material,close,state),epsilon=.015;
      // Use the layer tangent at the recess floor, not the derivative of the
      // milled scallop wall, which can turn backwards at a semicircle lip.
      const u=1-K.edgeInset(side,depth,y,material,state)/480;
      const at=s=>K.pagePoint(side,s,u,y,material,close,state);
      const lo=at(Math.max(0,depth-epsilon)),hi=at(Math.min(model.totalDepth,depth+epsilon));
      let dx=hi.x-lo.x,dz=hi.z-lo.z,length=Math.hypot(dx,dz);
      if(length<1e-7){dx=1;dz=0;length=1;}
      const xx=dx/length,xz=dz/length,nx=-xz,nz=xx;
      // The curved paper mesh is piecewise planar. Keep the thin printed
      // insert just above that approximation, inside its milled recess.
      const lift=.18+2.1*(side==='left'?surface.fanLeft:surface.fanRight)*(1-close)*(1-close);
      const m=[xx,0,xz,0,0,1,0,0,nx,0,nz,0,
        p.x-xx*width/2+nx*lift,p.y-height/2,p.z-xz*width/2+nz*lift,1];
      return {matrix:m,depthScale:length/Math.max(1e-7,Math.min(model.totalDepth,depth+epsilon)-Math.max(0,depth-epsilon)),point:p};
    }
    function paint(){
      const d=digital,w=model.totalDepth,split=clamp(frame.splitDepth,0,w),labelProgress=smooth(.25,.9,d);
      const baked=!!options.depthInk?.(),motion=baked?smooth(.18,1,d):d;
      physicalState=surface?{fanLeft:surface.fanLeft,fanRight:surface.fanRight,edgeInspection:surface.edgeInspection,notches:baked?options.inkNotches():notches()}:null;
      root.dataset.inkLayer=baked?'depth':'dom';
      root.style.setProperty('--pbi-ink-handoff',Math.min(1,d/.22).toFixed(4));
      const wrap=surface&&!baked?smooth(.62,.98,surface.close)*(1-smooth(0,.16,d)):0,facets=wrap>0?facetSampler(surface.material,surface.close,physicalState):null;
      root.style.setProperty('--pbi-digital',d.toFixed(4));root.dataset.interactionSide=String(interactionSide);root.dataset.surface=surface?'recessed':'planar';root.dataset.splitDepth=split.toFixed(6);root.dataset.totalDepth=w.toFixed(6);
      viewport.style.transform='translate3d(240px,0px,482px)';viewport.style.overflowY=d===1?'auto':'hidden';viewport.style.pointerEvents=d===1?'auto':'none';viewport.style.opacity='1';
      sheet.style.height=lerp(HEIGHT,model.digitalHeight,d)+'px';heading.style.transform='translate3d(240px,0px,482.5px)';heading.style.opacity=String(labelProgress);note.style.opacity=String(labelProgress);
      root.classList.toggle('pbi-is-digital',d===1);root.classList.toggle('pbi-is-morphing',d>0&&d<1);
      panSurfaces.forEach((surface,i)=>{surface.style.width=w+'px';surface.style.height=HEIGHT+'px';surface.style.transform=css(multiply(i?frame.rightMatrix:frame.leftMatrix,translation(0,0,.06)));surface.style.clipPath=i?`inset(0 0 0 ${split}px)`:`inset(0 ${w-split}px 0 0)`;surface.style.pointerEvents=d===0&&interactionSide==='both'?'auto':'none';});
      recesses.forEach((node,i)=>{
        const group=model.groups[i],side=group.notch.depth<split?'left':'right',geometry=surfaceMatrix(side,group.notch.depth,group.notch.y,20,group.height);
        node.hidden=baked||!geometry;node.style.opacity=String(1-d);node.style.width='20px';node.style.height=group.height+'px';
        if(geometry)node.style.transform=css(geometry.matrix);
      });
      buttons.forEach((nodes,i)=>{
        const slot=model.slots[i],group=model.groups[slot.group],a=slot.physical,b=slot.digital,box=layoutAt(slot,motion);
        // One printed group remains on one carrier leaf even when its member
        // books open on different sides. Their navigation anchors stay intact.
        const carrier=baked?group.carrierDepth:slot.anchorDepth,side=carrier+1e-8<split?0:1;
        const onSide=side?'right':'left',enabled=d>0||interactionSide==='both'||interactionSide===onSide;
        nodes.button.disabled=!enabled;nodes.button.tabIndex=enabled?0:-1;nodes.button.style.pointerEvents=enabled&&(!baked||d>0)?'auto':'none';
        const curved=surface&&baked?(options.labelFrame?.(i)||milledMatrix(slot,onSide,physicalState)):surfaceMatrix(onSide,slot.anchorDepth,a.y+a.height/2,a.width,a.height);
        const ratio=surface?(side?0:1):clamp((split-a.x)/a.width);
        const physical=curved?[curved.matrix,curved.matrix]:[frame.leftMatrix,frame.rightMatrix].map(m=>multiply(m,translation(a.x,a.y,.08)));
        const target=translation(240+b.x,b.y-scrollAnchor,482.2),matrices=physical.map(m=>mixMatrix(m,target,motion)),base=matrices[side];
        const style=nodes.button.style;style.width=box.width+'px';style.height=box.height+'px';style.transformOrigin='0 0';style.opacity='1';
        nodes.button.dataset.anchorDepth=slot.anchorDepth.toFixed(8);nodes.button.dataset.sheet=String(slot.sheet);nodes.button.dataset.paperSide=side?'right':'left';
        nodes.button.dataset.carrierDepth=group.carrierDepth.toFixed(8);nodes.button.dataset.carrierSheet=String(group.carrierSheet);
        if(d===1){parent(nodes.button,sheet);style.left=b.x+'px';style.top=b.y+'px';style.transform='none';}
        else{parent(nodes.button,root);style.left='0px';style.top='0px';style.transform=css(base);}
        const inv=d===1||surface?null:inverse(base);
        nodes.fragments.forEach((part,k)=>{
          const ps=part.fragment.style;ps.width=box.width+'px';ps.height=box.height+'px';ps.transformOrigin='0 0';ps.transform=d===1||surface?'none':css(multiply(inv,matrices[k]));
          ps.clipPath=k?`inset(0 0 0 ${ratio*100}%)`:`inset(0 ${(1-ratio)*100}% 0 0)`;
          ps.visibility=(k?ratio===1:ratio===0)?'hidden':'visible';
          part.abbr.style.visibility=wrap>0?'hidden':'visible';part.abbr.style.width=lerp(a.width,38,motion)+'px';part.abbr.style.height=lerp(a.height,35,motion)+'px';part.abbr.style.left=lerp(0,7,motion)+'px';part.abbr.style.fontSize=lerp(slot.fontSize,16,motion)+'px';
          part.name.style.opacity=String(labelProgress);part.order.style.opacity=String(labelProgress*.65);
          part.tick.style.left=(surface?.5:clamp((slot.anchorDepth-a.x)/a.width))*box.width+'px';part.tick.style.opacity=String(1-d);
        });
        const inkWidth=lerp(a.width,38,d),inkHeight=lerp(a.height,35,d),inkLeft=lerp(0,7,d),inkTop=(box.height-inkHeight)/2;
        const inkInverse=wrap>0?inverse(base):null;
        nodes.ink.forEach(({strip,abbr},j)=>{
          strip.hidden=wrap===0;
          const sw=inkWidth/INK_STRIPS;
          abbr.style.width=inkWidth+'px';abbr.style.height=inkHeight+'px';abbr.style.left=(-j*sw)+'px';abbr.style.fontSize=lerp(slot.fontSize,16,d)+'px';
          if(!wrap)return;
          strip.style.width=(sw+.025)+'px';strip.style.height=inkHeight+'px';
          const actual=inkStripMatrix(facets,onSide,slot.anchorDepth,a.y+a.height/2,curved.depthScale,j*a.width/INK_STRIPS-a.width/2,a.width/INK_STRIPS,a.height);
          for(const k of [0,1,2])actual[k]*=a.width/inkWidth;for(const k of [4,5,6])actual[k]*=a.height/inkHeight;
          const local=multiply(inkInverse,actual),flat=translation(inkLeft+j*sw,inkTop);
          strip.style.transform=css(mixMatrix(flat,local,wrap));
        });
      });
    }
    function setSurfaceFrame(next){
      if(destroyed||!next?.material)return;
      if(surface&&surface.material.leftDepth===next.material.leftDepth&&surface.material.totalDepth===next.material.totalDepth&&surface.close===clamp(next.close)&&surface.fanLeft===clamp(next.fanLeft)&&surface.fanRight===clamp(next.fanRight)&&surface.edgeInspection===!!next.edgeInspection)return;
      surface={material:next.material,close:clamp(next.close),fanLeft:clamp(next.fanLeft),fanRight:clamp(next.fanRight),edgeInspection:!!next.edgeInspection};
      frame.splitDepth=Number(next.material.leftDepth)||0;frame.totalDepth=Number(next.material.totalDepth)||WIDTH;
      if(frame.totalDepth!==model.totalDepth)model=geometry(books,next.material.pageCount||model.pageCount,frame.totalDepth);
      root.dataset.rightSheets=String(next.material.rightSheets);root.dataset.leftSheets=String(next.material.leftSheets);
      root.dataset.fanLeft=surface.fanLeft.toFixed(4);root.dataset.fanRight=surface.fanRight.toFixed(4);root.dataset.close=surface.close.toFixed(4);
      paint();
    }
    function setInteractionSide(side){const next=['left','right','both'].includes(side)?side:null;if(next===interactionSide)return;hoverBook(null);interactionSide=next;paint();}
    function setPhysicalFrame(next){
      if(destroyed)return;frame={leftMatrix:matrix(next?.leftMatrix,frame.leftMatrix),rightMatrix:matrix(next?.rightMatrix,frame.rightMatrix),splitDepth:Number.isFinite(next?.splitDepth)?next.splitDepth:frame.splitDepth,totalDepth:Number.isFinite(next?.totalDepth)?next.totalDepth:frame.totalDepth};
      if(frame.totalDepth!==model.totalDepth)model=geometry(books,model.pageCount,frame.totalDepth);paint();
    }
    function setReadingMaterial(material){
      if(!material)return;frame.splitDepth=Number(material.leftDepth)||0;
      if(material.totalDepth&&material.totalDepth!==model.totalDepth){model=geometry(books,material.pageCount||model.pageCount,material.totalDepth);frame.totalDepth=material.totalDepth;}
      root.dataset.rightSheets=String(material.rightSheets);root.dataset.leftSheets=String(material.leftSheets);paint();
    }
    function setProgress(value){root.style.setProperty('--pbi-present',clamp(value).toFixed(4));return clamp(value);}
    function setDigital(value){
      if(destroyed)return{amount:digital,view:lastView,destroyed:true};const next=clamp(value);
      if(digital===1&&next<1)scrollAnchor=viewport.scrollTop;if(digital===0&&next>0)scrollAnchor=0;
      if(next!==digital)hoverBook(null);digital=next;paint();if(digital<1||scrollAnchor>0)viewport.scrollTop=scrollAnchor*digital;
      const currentScroll=viewport.scrollTop;if(digital===0||digital===1)scrollAnchor=0;
      const view=digital===0?'physical':digital===1?'digital':'transition';if(view!==lastView){lastView=view;onViewChange?.(view);}
      return{amount:digital,view,scrollTop:currentScroll,height:lerp(HEIGHT,model.digitalHeight,digital)};
    }
    function clearFocus(){if(focused>=0){buttons[focused].button.classList.remove('pbi-focused');buttons[focused].button.removeAttribute('aria-current');}focused=-1;}
    function focusBook(index){const i=Number(index);if(!Number.isInteger(i)||i<0||i>=books.length)return null;clearFocus();focused=i;buttons[i].button.classList.add('pbi-focused');buttons[i].button.setAttribute('aria-current','true');
      const slot=model.slots[i],a=slot.physical,group=model.groups[slot.group],carrier=options.depthInk?.()?group.carrierDepth:slot.anchorDepth;
      return{index:i,group:slot.group,depth:carrier,carrierDepth:group.carrierDepth,carrierSheet:group.carrierSheet,anchorDepth:slot.anchorDepth,sheet:slot.sheet,x:480+carrier-model.totalDepth/2,y:a.y+a.height/2,width:a.width,height:a.height,left:a.x,top:a.y,name:books[i].name};}
    function destroy(){if(destroyed)return;destroyed=true;hoverBook(null);if(drag){const id=drag.id;drag=null;try{interactionHost.releasePointerCapture?.(id);}catch{}}disposers.forEach(fn=>fn());root.remove();}
    setProgress(1);setDigital(0);
    return{setReadingMaterial,setPhysicalFrame,setSurfaceFrame,setInteractionSide,getNotches:notches,setProgress,setDigital,focusBook,clearFocus,resize:()=>paint(),destroy};
  }
  return{create,geometry,groupBooks,layoutAt,facetSampler,inkStripMatrix,INK_STRIPS,WIDTH,HEIGHT,DIGITAL_WIDTH,multiply,inverse,translation,css};
});
