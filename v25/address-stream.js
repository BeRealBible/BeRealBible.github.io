/* One inline, paragraph-preserving passage reader for both address inputs. */
(function(root){
  'use strict';
  function create({viewport,host=viewport,renderVerse,onExtend=()=>{}}){
    const doc=viewport.ownerDocument,make=(tag,cls,text)=>{
      const el=doc.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;
    };
    let stream=null,request=null,last=null;
    const boundary=(rows,i)=>i===0||rows[i].ch!==rows[i-1].ch||rows[i].paragraph||rows[i].titles.length>0;
    function left(rows,i){while(!boundary(rows,i))i--;return i;}
    function right(rows,i){while(i<rows.length&&!boundary(rows,i))i++;return i;}
    const element=index=>host.querySelector(`[data-address-index="${index}"]`);
    function part(lo,hi){
      const {rows,at}=stream,fragment=doc.createDocumentFragment();let paragraph;
      for(let i=lo;i<hi;i++){
        const row=rows[i];
        if(!i||rows[i-1].ch!==row.ch)fragment.append(make('h2','compare-slip__chapter-title','第 '+row.ch+' 章'));
        for(const title of row.titles)fragment.append(make('h3','compare-slip__section-title',title));
        if(!paragraph||boundary(rows,i)){paragraph=make('p','compare-slip__paragraph');fragment.append(paragraph);}
        else paragraph.append(doc.createTextNode(' '));
        const verse=renderVerse(row,i===at);verse.dataset.addressIndex=i;paragraph.append(verse);
      }
      return fragment;
    }
    function loadAround(index){
      const {rows}=stream;
      stream.lo=left(rows,Math.max(0,index-12));stream.hi=right(rows,Math.min(rows.length,index+18));
      host.replaceChildren(part(stream.lo,stream.hi));
    }
    function layout(){
      if(!request||!viewport.clientHeight)return;
      const {index,dy}=request,el=element(index);
      if(el){viewport.scrollTop=index===0&&dy==null?0:Math.max(0,el.offsetTop-(dy??5));request=null;snapshot();}
    }
    function start(rows,at){
      if(!rows?.[at])return false;
      stream={rows,at};request={index:at};last=null;loadAround(at);return true;
    }
    function snapshot(){
      if(!stream)return null;
      if(!viewport.clientHeight)return last||request;
      if(request)return request;
      const top=viewport.scrollTop,nodes=host.querySelectorAll('[data-address-index]');
      let lo=0,hi=nodes.length-1;
      while(lo<hi){const mid=(lo+hi)>>1,node=nodes[mid];if(node.offsetTop+node.offsetHeight<=top)lo=mid+1;else hi=mid;}
      const el=nodes[lo];
      return el?last={index:+el.dataset.addressIndex,dy:el.offsetTop-top}:last;
    }
    function restore(spot){
      if(!spot||!stream?.rows[spot.index])return false;
      if(spot.index<stream.lo||spot.index>=stream.hi)loadAround(spot.index);
      request=spot;layout();return true;
    }
    viewport.addEventListener('scroll',()=>{
      if(!stream||!viewport.clientHeight||request)return;
      const {lo,hi,rows}=stream,threshold=64;
      if(lo>0&&viewport.scrollTop<threshold){
        const hold=host.firstElementChild,top=hold.offsetTop;
        stream.lo=left(rows,Math.max(0,lo-20));host.prepend(part(stream.lo,lo));
        viewport.scrollTop+=hold.offsetTop-top;onExtend();
      }else if(hi<rows.length&&viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<threshold){
        stream.hi=right(rows,Math.min(rows.length,hi+20));host.append(part(hi,stream.hi));onExtend();
      }
    },{passive:true});
    return {get active(){return !!stream;},start,layout,snapshot,restore,element,
      clear(){if(stream)host.replaceChildren();stream=null;last=null;request=null;}};
  }
  root.V25AddressStream={create};
})(window);
