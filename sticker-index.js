/* One two-sided paper sticker per book. Labels stay DOM text at every zoom. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperStickerIndex=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({WIDTH:960,HEIGHT:704,ROWS:17,LANES:4,TAB_WIDTH:24,TAB_HEIGHT:34,COLUMN_PITCH:26,ROW_PITCH:39,TOP:23,MAX_EXTENT:104});

  // Page 1 is the recto and page 2 the verso of the same physical leaf.
  // Consequently an even opening page is already on the left of its spread.
  function carrierSheet(book){return Math.ceil(Math.max(0,Number(book.first)||0)/2);}
  function layout(books,spread=0){
    const split=Math.floor(Math.max(0,Number(spread)||0)/2);
    const minLane={left:constants.LANES,right:constants.LANES};
    const positions=books.map((book,index)=>{
      const lane=Math.floor(index/constants.ROWS),row=index%constants.ROWS;
      const side=carrierSheet(book)<=split?'left':'right';
      minLane[side]=Math.min(minLane[side],lane);
      return {index,lane,row,side,carrier:carrierSheet(book)};
    });
    // Keep the canonical row and column, but do not reserve empty columns
    // between the paper edge and the remaining stickers on either side.
    return positions.map(item=>{
      const displayLane=item.lane-minLane[item.side];
      const extent=(displayLane+1)*constants.COLUMN_PITCH;
      return {...item,displayLane,
        x:item.side==='left'?-extent:constants.WIDTH+displayLane*constants.COLUMN_PITCH+2,
        y:constants.TOP+item.row*constants.ROW_PITCH,width:constants.TAB_WIDTH,height:constants.TAB_HEIGHT,extent};
    });
  }
  function bounds(items){
    return items.reduce((result,item)=>{
      const key=item.side==='left'?'leftExtent':'rightExtent';
      result[key]=Math.max(result[key],item.extent);return result;
    },{leftExtent:0,rightExtent:0});
  }
  function create(host,{books,onSelect}={}){
    if(!host?.ownerDocument)throw new TypeError('A DOM host is required for the sticker index');
    if(!Array.isArray(books)||books.length>constants.ROWS*constants.LANES)throw new TypeError('The sticker index accepts up to 68 books');
    const doc=host.ownerDocument,root=doc.createElement('nav'),listeners=[];
    root.className='sticker-index';root.setAttribute('aria-label','贴纸书卷目录');
    let state={spread:0,scale:1,currentBook:null,turning:false},items=[],destroyed=false;
    const buttons=books.map((book,index)=>{
      const button=doc.createElement('button'),label=doc.createElement('span');
      button.type='button';button.className='sticker-index__tab';
      button.dataset.book=String(index);button.dataset.code=book.code||String(index);
      button.setAttribute('aria-label',`${book.name}，跳转到开篇`);button.title=book.name;
      label.className='sticker-index__label';label.textContent=String(book.short||book.name||'');
      label.setAttribute('aria-hidden','true');button.appendChild(label);
      const stop=event=>event.stopPropagation();
      const select=event=>{
        event.stopPropagation();
        if(!destroyed&&!state.turning&&typeof onSelect==='function')onSelect(index,book);
      };
      // Preserve native button focus and Enter/Space activation; never install a
      // competing gesture/timer or preventDefault on pointerdown.
      for(const type of ['pointerdown','pointerup','pointercancel','dblclick']){
        button.addEventListener(type,stop);listeners.push([button,type,stop]);
      }
      button.addEventListener('click',select);listeners.push([button,'click',select]);
      root.appendChild(button);return button;
    });
    host.appendChild(root);
    function update(next={}){
      if(destroyed)return bounds(items);
      state={...state,...next};
      items=layout(books,state.spread);
      const scale=Number(state.scale);
      root.style.setProperty('--sticker-scale',String(Number.isFinite(scale)&&scale>0?scale:1));
      root.dataset.turning=String(Boolean(state.turning));
      for(const item of items){
        const button=buttons[item.index],book=books[item.index];
        const current=state.currentBook===item.index||state.currentBook===book.code||state.currentBook===book||state.currentBook?.code===book.code;
        button.dataset.side=item.side;button.dataset.lane=String(item.lane);button.dataset.row=String(item.row);button.dataset.displayLane=String(item.displayLane);
        button.style.left=item.x+'px';button.style.top=item.y+'px';
        button.style.setProperty('--sticker-root',String(item.displayLane*constants.COLUMN_PITCH+3)+'px');
        button.style.zIndex=String(constants.LANES-item.displayLane);
        button.disabled=Boolean(state.turning);
        button.setAttribute('aria-disabled',String(button.disabled));
        if(current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      }
      return bounds(items);
    }
    function destroy(){
      if(destroyed)return;destroyed=true;
      for(const [node,type,listener] of listeners)node.removeEventListener(type,listener);
      root.remove();
    }
    update();
    return {update,getBounds:()=>bounds(items),destroy,element:root};
  }
  return {constants,carrierSheet,layout,create};
});
