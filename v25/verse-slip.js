/* Shared paper face for scripture previews; reading is never a navigation gesture. */
'use strict';
window.V25VerseSlip=function(host,verses,{onJump,onBack,keywords}){
  const doc=host.ownerDocument;
  const field=(tag,cls,text,parent)=>{const el=doc.createElement(tag);el.className='footnote-preview__'+cls;el.textContent=text;parent.appendChild(el);return el;};
    const fragment=doc.createDocumentFragment(),head=doc.createElement('div'),go=doc.createElement('button'),scroll=doc.createElement('div');
    head.className='citation-head';go.className='citation-jump';go.type='button';head.append(go);
    scroll.className='citation-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','引用经文及上下文');
    const groups=[];let dest;
    function aim(v){
      if(dest===v)return;dest=v;
      go.textContent='跳转 ↗ '+v.short+' '+v.ref;go.setAttribute('aria-label','跳转至'+v.short+' '+v.ref);go.title=go.getAttribute('aria-label');
    }
    for(const rows of window.V25CitationContext(verses,window.BIBLE_SOURCE)){
      const block=doc.createElement('div'),starts=[];block.className='citation-block';scroll.append(block);
      for(const v of rows){
        const row=field('p','verse','',block);row.dataset.ref=v.code+'.'+v.ref;row.toggleAttribute('data-cited',v.cited);
        const no=doc.createElement('span');no.className='verse-no';no.textContent=v.ref;row.append(no);
        if(v.cited&&keywords?.length)window.V25Words.paint(row,v.text,keywords);else row.append(doc.createTextNode(v.text));
        if(v.start)starts.push({row,v});
      }
      groups.push({block,starts});
    }
    const first=groups[0]?.starts[0];if(!first)return;
    const peek=9;aim(first.v);
    scroll.onscroll=()=>{
      const at=scroll.scrollTop+peek+1,group=groups.findLast(g=>g.block.offsetTop<=at)||groups[0];
      aim((group.starts.findLast(s=>s.row.offsetTop<=at)||group.starts[0]).v);
    };
    go.onclick=()=>onJump(dest);
    let back;
    if(onBack){
      back=doc.createElement('button');back.className='citation-back';back.type='button';
      back.textContent='↶ 返回搜索';back.onclick=onBack;head.prepend(back);
    }
    fragment.append(head,scroll);host.replaceChildren(fragment);
    return {go,back,align(){
      scroll.style.paddingBottom='';const top=Math.max(0,first.row.offsetTop-peek);
      const tail=top-(scroll.scrollHeight-scroll.clientHeight);
      if(tail>0)scroll.style.paddingBottom=tail+'px';scroll.scrollTop=top;
    }};
};
