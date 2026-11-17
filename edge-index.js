/* Narrow paper fore-edge indexes, following the supplied Opus reference.
 * Grouped normal labels and individually accessible expanded books use DOM text.
 * Real page numbers/carrier leaves, never reference-demo fake scripture, drive it. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdgeIndex=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:960,HEIGHT:704,MIN_BAND:10,DEPTH_BAND:42,MIXED_MIN_BAND:32,TRACK_GAP:3,EXPANDED:208,
    GROUP_WIDTH:13,GROUP_HEIGHT:24,BOOK_WIDTH:28,BOOK_HEIGHT:18,DEPTH_INSET:10,VERTICAL_INSET:10,COLLISION_GAP:2});
  const OTG=[['创',[0]],['出',[1]],['利',[2]],['民',[3]],['申',[4]],['书',[5]],['士得',[6,7]],['撒',[8,9]],['王',[10,11]],['代',[12,13]],['拉尼斯',[14,15,16]],['伯',[17]],['诗',[18]],['箴',[19]],['传歌',[20,21]],['赛',[22]],['耶哀',[23,24]],['结',[25]],['但',[26]],['何珥摩',[27,28,29]],['俄拿弥',[30,31,32]],['鸿哈番',[33,34,35]],['该亚玛',[36,37,38]]];
  const NTG=[['太',[39]],['可',[40]],['路',[41]],['约',[42]],['徒',[43]],['罗',[44]],['林前',[45]],['林后',[46]],['加弗',[47,48]],['腓西',[49,50]],['帖',[51,52]],['提',[53,54]],['多门',[55,56]],['来',[57]],['雅',[58]],['彼',[59,60]],['壹贰叁',[61,62,63]],['犹',[64]],['启',[65]]];
  const GROUPS=Object.freeze([...OTG.map(([label,members],row)=>({label,members,nt:false,row})),
    ...NTG.map(([label,members],row)=>({label,members,nt:true,row}))].map((group,index)=>Object.freeze({...group,index,members:Object.freeze(group.members)})));
  const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  const carrierSheet=book=>Math.ceil(Math.max(0,Number(book.first)||0)/2);
  const sideOf=(book,spread)=>carrierSheet(book)<=Math.floor(Math.max(0,Number(spread)||0)/2)?'left':'right';
  const groupY=group=>(group.nt?38+28*group.row:30+26*group.row)*constants.HEIGHT/640;
  function rectanglesOverlap(a,b,padding=0){
    return a.x<b.x+b.width+padding&&b.x<a.x+a.width+padding&&a.y<b.y+b.height+padding&&b.y<a.y+a.height+padding;
  }
  function anchorRect(element){
    const rect=element.getBoundingClientRect?.()||{},number=value=>Number.isFinite(Number(value))?Number(value):0;
    const left=number(rect.left??rect.x),top=number(rect.top??rect.y),width=number(rect.width),height=number(rect.height);
    return {x:left,y:top,left,top,right:number(rect.right??left+width),bottom:number(rect.bottom??top+height),width,height};
  }
  function normalizePageCount(books,pageCount){
    const inferred=books.reduce((max,book)=>Math.max(max,Number(book.last)||Number(book.first)||0),0)+1;
    return Math.max(1,Number.isFinite(Number(pageCount))?Number(pageCount):inferred);
  }
  function depthRatio(first,side,spread,total){
    const carrier=carrierSheet({first}),split=Math.floor(spread/2),sheets=Math.ceil(total/2);
    // The two faces of one physical leaf have one depth. Both fore-edges read
    // left-to-right in canonical order: cover -> current page on the left,
    // current page -> back cover on the right. Never mirror the left stack.
    return side==='left'?clamp((carrier-1)/Math.max(1,split-1),0,1):
      clamp((carrier-split-1)/Math.max(1,sheets-split-1),0,1);
  }
  function expandedLayout(entries,band,spread,total){
    if(!entries.length)return [];
    const width=constants.BOOK_WIDTH,height=constants.BOOK_HEIGHT,gap=constants.COLLISION_GAP;
    const inset=constants.DEPTH_INSET,top=constants.VERTICAL_INSET,bottom=constants.HEIGHT-top-height;
    // X is physical data, not a layout hint. Nothing in the collision solver
    // can snap it to columns, reorder it, or separate labels on one carrier.
    const items=entries.map(entry=>{
      const ratio=depthRatio(entry.first,entry.side,spread,total);
      return {...entry,carrier:carrierSheet({first:entry.first}),depthRatio:ratio,
        x:band.x+inset+ratio*(band.width-2*inset-width),width,height};
    }).sort((a,b)=>a.x-b.x||a.index-b.index);
    // Equal-width horizontal intervals form an interval graph. Its maximum
    // concurrent count is the exact number of disjoint vertical lanes needed.
    let first=0,laneCount=1;
    for(let i=0;i<items.length;i++){
      while(first<i&&items[first].x+width+gap<=items[i].x)first++;
      laneCount=Math.max(laneCount,i-first+1);
    }
    if(laneCount*height+(laneCount-1)*gap>constants.HEIGHT-2*top)
      throw new RangeError('Physical fore-edge depths require more vertical space; horizontal depth cannot be rearranged');
    // The clique bound proves feasibility; use ALL available vertical lanes
    // when choosing the nearest original group Y. Restricting the candidates
    // to the minimum lane count would unnecessarily jump labels up and down.
    const slots=Math.floor((constants.HEIGHT-2*top+gap)/(height+gap));
    const ys=Array.from({length:slots},(_,i)=>top+i*(height+gap));
    const occupiedUntil=Array(slots).fill(-Infinity);
    for(const item of items){
      const desired=clamp(item.originalY-height/2,top,bottom);
      let lane=-1,distance=Infinity;
      for(let i=0;i<slots;i++)if(occupiedUntil[i]<=item.x){
        const next=Math.abs(ys[i]-desired);
        if(next<distance){lane=i;distance=next;}
      }
      if(lane<0)throw new RangeError('Physical fore-edge interval allocation failed');
      item.y=laneCount===1?desired:ys[lane];item.lane=lane;
      occupiedUntil[lane]=item.x+width+gap;
    }
    return items.sort((a,b)=>a.index-b.index);
  }
  function layout(books,pageCount,spread=0,expanded=null){
    const total=normalizePageCount(books,pageCount),page=clamp(Math.floor(Number(spread)||0),0,total);
    const testaments={left:0,right:0};
    books.forEach((book,index)=>{testaments[sideOf(book,page)]|=index>=39?2:1;});
    // Independent OT/NT tracks preserve the reference's original y anchors
    // without letting its two row systems collide in a thin mixed book edge.
    const mixed=side=>testaments[side]===3;
    const normalLeft=Math.max(constants.MIN_BAND+constants.DEPTH_BAND*page/total,mixed('left')?constants.MIXED_MIN_BAND:0);
    const normalRight=Math.max(constants.MIN_BAND+constants.DEPTH_BAND*(total-page)/total,mixed('right')?constants.MIXED_MIN_BAND:0);
    const widths={left:expanded==='left'?constants.EXPANDED:normalLeft,right:expanded==='right'?constants.EXPANDED:normalRight};
    const bands={left:{side:'left',x:-widths.left,y:0,width:widths.left,height:constants.HEIGHT,normalWidth:normalLeft},
      right:{side:'right',x:constants.WIDTH,y:0,width:widths.right,height:constants.HEIGHT,normalWidth:normalRight}};
    const groups=[],entries=[];
    for(const group of GROUPS){
      for(const side of ['left','right']){
        const bookIndices=group.members.filter(index=>books[index]&&sideOf(books[index],page)===side);
        if(!bookIndices.length)continue;
        const normalWidth=side==='left'?normalLeft:normalRight;
        const trackWidth=mixed(side)?(normalWidth-2-constants.TRACK_GAP)/2:normalWidth-2;
        const width=Math.min(constants.GROUP_WIDTH,trackWidth),height=constants.GROUP_HEIGHT;
        const ratio=depthRatio(Number(books[bookIndices[0]].first)||0,side,page,total);
        const normalX=side==='left'?-normalWidth:constants.WIDTH;
        const trackX=normalX+1+(mixed(side)&&group.nt?trackWidth+constants.TRACK_GAP:0);
        const label=bookIndices.length===group.members.length?group.label:bookIndices.map(index=>
          group.label==='壹贰叁'?['壹','贰','叁'][index-61]:books[index].short).join('');
        const item={groupIndex:group.index,side,bookIndices,label,nt:group.nt,row:group.row,
          x:trackX+ratio*Math.max(0,trackWidth-width),y:groupY(group)-height/2,width,height};
        groups.push(item);
        if(expanded===side)for(const index of bookIndices)entries.push({index,side,groupIndex:group.index,nt:group.nt,
          originalY:groupY(group),first:Number(books[index].first)||0});
      }
    }
    return {bands,groups,expandedBooks:expanded?expandedLayout(entries,bands[expanded],page,total):[],
      bounds:{leftExtent:widths.left,rightExtent:widths.right,normalLeftExtent:normalLeft,normalRightExtent:normalRight}};
  }
  function create(host,{books,pageCount,onSelect,onExpand}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,root=doc.createElement('nav'),listeners=[],initialZ=host.style.zIndex||'';
    root.className='edge-index';root.setAttribute('aria-label','书口书卷目录');
    let state={spread:0,scale:1,currentBook:null,turning:false},expanded=null,destroyed=false,geometry;
    const add=(tag,className)=>{const el=doc.createElement(tag);el.className=className;root.appendChild(el);return el;};
    const listen=(el,type,fn,capture=false)=>{el.addEventListener(type,fn,capture);listeners.push([el,type,fn,capture]);};
    const stop=event=>event.stopPropagation();
    const configureButton=button=>{
      button.type='button';
      for(const type of ['pointerdown','pointerup','pointercancel','dblclick'])listen(button,type,stop);
      return button;
    };
    const dim=configureButton(add('button','edge-index__backdrop'));
    dim.tabIndex=-1;dim.setAttribute('aria-label','收起书口目录');
    const bandButtons={};
    for(const side of ['left','right']){
      const button=configureButton(add('button','edge-index__band'));button.dataset.side=side;
      listen(button,'click',event=>{stop(event);if(!state.turning)setExpanded(expanded===side?null:side);});
      bandButtons[side]=button;
    }
    const groupButtons=new Map();
    for(const group of GROUPS)for(const side of ['left','right']){
      const button=configureButton(add('button','edge-index__group '+(group.nt?'edge-index__nt':'edge-index__ot')));
      button.dataset.group=String(group.index);button.dataset.side=side;
      const label=doc.createElement('span');label.setAttribute('aria-hidden','true');button.appendChild(label);
      listen(button,'click',event=>{
        stop(event);const item=button._edgeItem;
        if(destroyed||state.turning||expanded||button.hidden||!item)return;
        const index=item.bookIndices[0];if(typeof onSelect==='function')onSelect(index,books[index],{bookIndices:item.bookIndices.slice(),anchor:anchorRect(button)});
      });
      groupButtons.set(group.index+':'+side,button);
    }
    const bookButtons=books.map((book,index)=>{
      const button=configureButton(add('button','edge-index__book '+(index>=39?'edge-index__nt':'edge-index__ot')));
      button.dataset.book=String(index);button.dataset.code=book.code||String(index);
      button.textContent=String(book.short||book.name);button.title=`${book.name} · 选择章节`;
      button.setAttribute('aria-label',`${book.name}，选择章节`);button.setAttribute('aria-haspopup','dialog');
      listen(button,'click',event=>{
        stop(event);if(destroyed||state.turning||!expanded||button.hidden)return;
        if(typeof onSelect==='function')onSelect(index,book,{bookIndices:[index],anchor:anchorRect(button)});
      });return button;
    });
    const caption=add('div','edge-index__caption');caption.setAttribute('role','status');caption.setAttribute('aria-live','polite');
    listen(dim,'click',event=>{stop(event);setExpanded(null);});
    listen(doc,'keydown',event=>{
      if(event.target?.closest?.('.edge-chapters')||doc.querySelector?.('.edge-chapters:not([hidden])'))return;
      if(expanded&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(null);}
    },true);
    host.appendChild(root);
    function current(index){const value=state.currentBook,book=books[index];return value===index||value===book||Boolean(book.code&&(value===book.code||value?.code===book.code));}
    function position(el,item){el.style.left=item.x+'px';el.style.top=item.y+'px';el.style.width=item.width+'px';el.style.height=item.height+'px';}
    function markCurrent(el,yes){if(yes)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
    function paint(){
      geometry=layout(books,pageCount,state.spread,expanded);
      host.style.zIndex=expanded?'90':initialZ;host.dataset.edgeExpanded=String(Boolean(expanded));
      root.dataset.expanded=expanded||'';root.dataset.turning=String(Boolean(state.turning));
      dim.hidden=!expanded;dim.disabled=Boolean(state.turning);
      for(const side of ['left','right']){
        const button=bandButtons[side],isOpen=expanded===side;
        position(button,geometry.bands[side]);button.dataset.expanded=String(isOpen);
        button.disabled=Boolean(state.turning||expanded&&!isOpen);
        button.setAttribute('aria-expanded',String(isOpen));
        button.setAttribute('aria-label',`${isOpen?'收起':'展开'}${side==='left'?'左':'右'}侧书口目录`);button.title=button.getAttribute('aria-label');
      }
      for(const button of groupButtons.values()){button.hidden=true;button._edgeItem=null;}
      for(const item of geometry.groups){
        const button=groupButtons.get(item.groupIndex+':'+item.side);button._edgeItem=item;
        position(button,item);button.hidden=expanded===item.side;button.disabled=Boolean(state.turning||expanded);
        button.children[0].textContent=item.label;
        const count=[...item.label].length,fontSize=Math.min(item.width-2,count>2?7.3:count>1?9.5:10.5);
        button.style.fontSize=fontSize+'px';
        button.title=item.bookIndices.map(index=>books[index].name).join(' · ')+' · 选择章节';
        button.setAttribute('aria-label',button.title+'，书口空白处可展开逐卷选择');button.setAttribute('aria-haspopup','dialog');
        button.dataset.members=item.bookIndices.join(',');markCurrent(button,item.bookIndices.some(current));
      }
      for(const button of bookButtons){button.hidden=true;button.disabled=Boolean(state.turning);}
      for(const item of geometry.expandedBooks){
        const button=bookButtons[item.index];position(button,item);button.hidden=false;button.dataset.side=item.side;
        button.dataset.carrier=String(item.carrier);button.dataset.depthRatio=String(item.depthRatio);
        markCurrent(button,current(item.index));
      }
      caption.hidden=!expanded;
      if(expanded){caption.style.left=geometry.bands[expanded].x+'px';caption.textContent=`${expanded==='left'?'左侧':'右侧'}书口 · ${geometry.expandedBooks.length} 卷 · 点击选章 · Esc 收起`;}
      return {...geometry.bounds};
    }
    function update(next={}){
      if(destroyed)return {...geometry.bounds};state={...state,...next};
      // A controller's turn update must not synchronously re-enter that same
      // controller through onExpand. Returned bounds already reflect closure.
      if(state.turning)expanded=null;
      return paint();
    }
    function setExpanded(side){
      if(destroyed)return null;
      if(side!==null&&side!=='left'&&side!=='right')throw new TypeError('Expanded side must be left, right, or null');
      if(state.turning)side=null;
      if(side===expanded)return expanded;
      const previous=expanded;expanded=side;paint();
      if(typeof onExpand==='function')onExpand(expanded);
      const target=expanded?bookButtons.find(button=>!button.hidden):bandButtons[previous];
      target?.focus?.({preventScroll:true});return expanded;
    }
    function destroy(){
      if(destroyed)return;destroyed=true;
      for(const [el,type,fn,capture] of listeners)el.removeEventListener(type,fn,capture);
      root.remove();host.style.zIndex=initialZ;delete host.dataset.edgeExpanded;
    }
    paint();
    return {update,getBounds:()=>({...geometry.bounds}),getNormalBounds:()=>({leftExtent:geometry.bounds.normalLeftExtent,rightExtent:geometry.bounds.normalRightExtent}),
      setExpanded,isExpanded:()=>Boolean(expanded),getExpanded:()=>expanded,destroy,element:root};
  }
  return {constants,GROUPS,carrierSheet,sideOf,rectanglesOverlap,layout,create};
});
