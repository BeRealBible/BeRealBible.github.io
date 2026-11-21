/* The photographed thumb cuts open chapter selection directly. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdgeIndex=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:960,HEIGHT:704,MIN_BAND:10,GROUP_WIDTH:17,GROUP_HEIGHT:36});
  // Closed photo: membership, sequence through the block. Open Matthew photo:
  // tag centres (height as % of the local paper height; x in photo pixels).
  // Never space a short or partly turned track to fill the height.
  const NT_TOP=[9.8,17.6,25.2,33.5,41.4];
  const tracks=[
    ['ot-a',[10.5,18,26.5,34.9,42.9,50.8,58.5,66,73.5,80.7,87.9],
      [34,41,47,49.5,53.5,57.5,60.5,63,64,68.5,75],
      [['创',[0]],['出',[1]],['利',[2]],['民',[3]],['申',[4]],['书',[5]],['士',[6]],['得',[7]],['撒上下',[8,9],'shared'],['王上下',[10,11],'shared'],['代上下',[12,13],'shared']]],
    ['ot-b',[7.4,14.9,22.5,30.1,38.3,45.7,53.2,60.9,68.3,76.1,83.9,92.1],
      [83,86,90,101.5,103,109,117,123.5,125,126.5,127,126.5],
      [['拉尼',[14,15]],['斯伯',[16,17]],['诗箴',[18,19]],['传歌',[20,21]],['赛',[22]],['耶哀',[23,24]],['结但',[25,26]],['何珥',[27,28]],['摩俄拿',[29,30,31]],['弥鸿哈',[32,33,34]],['番该',[35,36]],['亚玛',[37,38]]]],
    ['nt-a',[...NT_TOP,48.8,56.7,64.9,72.5,80.6,88.9],
      [829,834,836.5,840,845,850.5,852,856,857.5,860,859.5],
      [['太',[39]],['可',[40]],['路',[41]],['约',[42]],['徒',[43]],['罗',[44]],['林前后',[45,46],'shared'],['加弗',[47,48]],['腓西',[49,50]],['帖前后',[51,52],'shared'],['提前后',[53,54],'shared']]],
    ['nt-b',NT_TOP,[859,859.5,862.5,862.5,865.5],
      [['多门',[55,56]],['来雅',[57,58]],['彼前后',[59,60],'shared'],['约壹贰叁犹',[61,62,63,64],'john-jude'],['启',[65]]]]
  ];
  const GROUPS=Object.freeze(tracks.flatMap(([track,heights,xs,labels])=>labels.map(([label,members,face],row)=>
    ({track,label,face:face||(members.length===1?'single':'stack'),members:Object.freeze(members),nt:track.startsWith('nt'),row,percent:heights[row],photoX:xs[row]})))
    .map((g,index)=>Object.freeze({...g,index})));
  const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  const carrierSheet=book=>Math.ceil(Math.max(0,Number(book.first)||0)/2);
  const sideOf=(book,spread)=>carrierSheet(book)<=Math.floor(Math.max(0,Number(spread)||0)/2)?'left':'right';
  const groupY=group=>group.percent*constants.HEIGHT/100;
  // The ink on one physical cut does not imply separate click targets. Keep
  // a shared stem to the reader's LEFT on both sides of the open book.
  function paintFace(button,item){
    const ids=item.bookIndices,key=ids.join(',');
    if(button._faceKey===key)return;
    button._faceKey=key;
    const el=button.children[0],group=GROUPS[item.groupIndex];
    const kind=ids.length===1?'single':group.face;
    el.dataset.face=kind;el.textContent='';
    const part=(name,text)=>{
      const span=el.ownerDocument.createElement('span');span.dataset.part=name;span.textContent=text;el.appendChild(span);
    };
    if(kind==='shared'){
      const [stem,top,bottom]=group.label;
      part('root',stem);part('top',top);part('bottom',bottom);
    }else if(kind==='stack'){
      // A cut like 摩 / 俄 / 拿 has three different initials, not a stem.
      for(const id of ids)part('row',group.label[group.members.indexOf(id)]);
    }else if(kind==='john-jude'){
      const numbers=ids.filter(i=>i!==64).map(i=>i-60).join('');
      part('letters','约\n'+numbers);
      if(ids.includes(64))part('jude','犹');
    }else{
      // Also used when turning a leaf separates two members of a shared cut.
      el.textContent=[...item.label].join('\n');
    }
  }
  // Normal view: calibrate projected paper thickness at each photographed cut;
  // interpolate between actual carrier leaves as sheets move across the spine.
  // A common opening cannot show the OT/NT seam thickness: join those two
  // measured axes with one tag of clearance. Do not equate camera x with mm.
  function cutDepths(books,total){
    const zoom=constants.HEIGHT/572,width=constants.GROUP_WIDTH,points=[[0,0]];
    for(const g of GROUPS){
      const book=books[g.members[0]];if(!book)continue;
      const sheet=carrierSheet(book),prev=points[points.length-1];
      const d=Math.max(prev[1],g.nt?(127-34+g.photoX-829)*zoom+width+2:(g.photoX-34)*zoom);
      if(sheet===prev[0])prev[1]=d;else points.push([sheet,d]);
    }
    const last=points[points.length-1],end=Math.ceil(total/2);
    if(end>last[0])points.push([end,last[1]+4]); // back matter beyond the final cut
    return sheet=>{
      let i=0;while(i+1<points.length&&points[i+1][0]<=sheet)i++;
      const [from,a]=points[i],next=points[i+1];
      return next?a+(next[1]-a)*clamp((sheet-from)/(next[0]-from),0,1):a;
    };
  }
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
  function layout(books,pageCount,spread=0,depthScale=1){
    const total=normalizePageCount(books,pageCount),page=clamp(Math.floor(Number(spread)||0),0,total);
    const projected=cutDepths(books,total),depth=sheet=>projected(sheet)*depthScale,split=Math.floor(page/2),at=depth(split),end=depth(Math.ceil(total/2));
    const framed=constants.GROUP_WIDTH+4;
    const normalLeft=at+(books.some(b=>sideOf(b,page)==='left')?framed:constants.MIN_BAND);
    const normalRight=end-at+(books.some(b=>sideOf(b,page)==='right')?framed:constants.MIN_BAND);
    const bands={left:{side:'left',x:-normalLeft,y:0,width:normalLeft,height:constants.HEIGHT},
      right:{side:'right',x:constants.WIDTH,y:0,width:normalRight,height:constants.HEIGHT}};
    const groups=[];
    for(const group of GROUPS){
      for(const side of ['left','right']){
        const bookIndices=group.members.filter(index=>books[index]&&sideOf(books[index],page)===side);
        if(!bookIndices.length)continue;
        const normalWidth=side==='left'?normalLeft:normalRight;
        const width=constants.GROUP_WIDTH,height=constants.GROUP_HEIGHT;
        const normalX=side==='left'?-normalWidth:constants.WIDTH;
        const label=bookIndices.length===group.members.length?group.label:bookIndices.map(index=>books[index].short).join('');
        const cut=depth(carrierSheet(books[bookIndices[0]]));
        const item={groupIndex:group.index,track:group.track,side,bookIndices,label,nt:group.nt,row:group.row,
          x:normalX+2+cut-(side==='right'?at:0),y:groupY(group)-height/2,width,height};
        groups.push(item);
      }
    }
    return {bands,groups,bounds:{leftExtent:normalLeft,rightExtent:normalRight,normalLeftExtent:normalLeft,normalRightExtent:normalRight}};
  }
  function create(host,{books,pageCount,onSelect,depthScale=1,splitLeaves=false}={}){
    if(!host?.ownerDocument||!Array.isArray(books))throw new TypeError('A DOM host and canonical books are required');
    const doc=host.ownerDocument,root=doc.createElement('nav'),listeners=[];
    root.className='edge-index';root.setAttribute('aria-label','书口书卷目录');
    let state={spread:0,scale:1,currentBook:null,turning:false},destroyed=false,geometry;
    const add=(tag,className,parent=root)=>{const el=doc.createElement(tag);el.className=className;parent.appendChild(el);return el;};
    const listen=(el,type,fn,capture=false)=>{el.addEventListener(type,fn,capture);listeners.push([el,type,fn,capture]);};
    const stop=event=>event.stopPropagation();
    const configureButton=button=>{
      button.type='button';
      for(const type of ['pointerdown','pointerup','pointercancel','dblclick'])listen(button,type,stop);
      return button;
    };
    // The unmarked paper is only a pointer surface for the reader's turn
    // gesture: it must neither receive keyboard focus nor bind a click.
    const bands={},leaves={};
    for(const side of ['left','right']){
      const leaf=leaves[side]=splitLeaves?add('div','edge-index__leaf'):root;
      if(splitLeaves)leaf.dataset.side=side;
      const band=add('div','edge-index__band',leaf);band.dataset.side=side;
      band.setAttribute('aria-hidden','true');bands[side]=band;
    }
    const groupButtons=new Map();
    for(const group of GROUPS)for(const side of ['left','right']){
      const button=configureButton(add('button','edge-index__group '+(group.nt?'edge-index__nt':'edge-index__ot'),leaves[side]));
      button.dataset.group=String(group.index);button.dataset.side=side;
      button.dataset.track=group.track;button.dataset.row=String(group.row);
      const label=doc.createElement('span');label.className='edge-index__face';label.setAttribute('aria-hidden','true');button.appendChild(label);
      listen(button,'click',event=>{
        stop(event);const item=button._edgeItem;
        if(destroyed||state.turning||button.hidden||!item)return;
        const index=item.bookIndices[0];if(typeof onSelect==='function')onSelect(index,books[index],{bookIndices:item.bookIndices.slice(),anchor:anchorRect(button)});
      });
      groupButtons.set(group.index+':'+side,button);
    }
    host.appendChild(root);
    function current(index){const value=state.currentBook,book=books[index];return value===index||value===book||Boolean(book.code&&(value===book.code||value?.code===book.code));}
    function position(el,item){el.style.left=item.x+'px';el.style.top=item.y+'px';el.style.width=item.width+'px';el.style.height=item.height+'px';}
    function markCurrent(el,yes){if(yes)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
    function paint(){
      geometry=layout(books,pageCount,state.spread,depthScale);
      root.dataset.turning=String(Boolean(state.turning));
      for(const side of ['left','right'])position(bands[side],geometry.bands[side]);
      for(const button of groupButtons.values()){button.hidden=true;button._edgeItem=null;}
      for(const item of geometry.groups){
        const button=groupButtons.get(item.groupIndex+':'+item.side);button._edgeItem=item;
        position(button,item);button.hidden=false;button.disabled=Boolean(state.turning);
        paintFace(button,item);
        button.title=item.bookIndices.map(index=>books[index].name).join(' · ')+' · 选择章节';
        button.setAttribute('aria-label',button.title);button.setAttribute('aria-haspopup','dialog');
        button.dataset.members=item.bookIndices.join(',');markCurrent(button,item.bookIndices.some(current));
      }
      return {...geometry.bounds};
    }
    function update(next={}){
      if(destroyed)return {...geometry.bounds};state={...state,...next};
      return paint();
    }
    function destroy(){
      if(destroyed)return;destroyed=true;
      for(const [el,type,fn,capture] of listeners)el.removeEventListener(type,fn,capture);
      root.remove();
    }
    paint();
    return {update,getBounds:()=>({...geometry.bounds}),getNormalBounds:()=>({leftExtent:geometry.bounds.normalLeftExtent,rightExtent:geometry.bounds.normalRightExtent}),
      destroy,element:root};
  }
  return {constants,GROUPS,carrierSheet,sideOf,rectanglesOverlap,layout,create};
});
