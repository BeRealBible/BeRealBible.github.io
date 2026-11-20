/* Accessible, non-printing hit areas for original-page footer citations only.
   The ink SVG (and the curled/canvas rendering of that ink) stays untouched. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.V25FootnoteTargets=api;api.install(root);}
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const canonical=s=>String(s).normalize('NFKC').replace(/\s/gu,'').replace(/。/g,'.').replace(/、/g,',').replace(/[—–]/g,'-');
  function targets(page,notes){
    if(!Array.isArray(page?.[3])||!notes?.length)return [];
    const words=page[3],rows=[];let row=[];
    for(const note of notes){
      const box=words[note.footerIndex];
      // One unknown anchor can change its neighbour's right boundary: fail closed.
      if(note.page!==page[0]||!box||box[4]!==note.marker)return [];
      if(row.length&&box[0]<=row[row.length-1].box[0]){rows.push(row);row=[];}
      row.push({note,box});
    }
    rows.push(row);
    const result=[];
    // Source OCR token order is column-major and occasionally interleaves
    // low-set punctuation across rows. Read actual ink boxes left-to-right
    // within each checked marker's baseline, not a slice of the token array.
    for(const r of rows)for(let i=0;i<r.length;i++){
      const {note,box:[x,y,,h]}=r[i],nextX=r[i+1]?.box[0]??page[1];
      const ink=words.filter(([a,b,w,z])=>a+w/2>=x&&a+w/2<nextX&&b+z/2>=y-6&&b+z/2<=y+h+5).sort((a,b)=>a[0]-b[0]);
      if(canonical(ink.map(cell=>cell[4]).join(''))!==canonical(note.marker+note.citation))continue;
      const l=Math.min(...ink.map(w=>w[0])),t=Math.min(...ink.map(w=>w[1]));
      const right=Math.max(...ink.map(w=>w[0]+w[2])),bottom=Math.max(...ink.map(w=>w[1]+w[3]));
      // A few source pixels of tolerance (under two page units) keep even
      // the spaces within a range hoverable, without merging adjacent notes.
      result.push({note,x:l-4,y:t-3,width:right-l+8,height:bottom-t+6});
    }
    return result;
  }
  function install(win){
    const doc=win.document,stage=doc.getElementById('stage'),book=doc.getElementById('book');
    const papers=['left-paper','right-paper'].map(id=>doc.getElementById(id));
    if(!stage||!book||papers.some(p=>!p))return;
    const hot=new WeakMap();
    const available=new WeakMap();
    const hasText=note=>{
      if(!available.has(note))available.set(note,win.PaperFootnotePassages.passages(note,win.BIBLE_SOURCE).length>0);
      return available.get(note);
    };
    function sync(){
      const db=win.V25OriginalData,passages=win.PaperFootnotePassages;
      if(!db||!passages||!win.BIBLE_SOURCE||!win.BIBLE_DATA?.physical||db.sha!==passages.seal)return;
      const locked=book.classList.contains('curl-active')||['running','switching'].includes(stage.dataset.jumpState);
      for(const [side,paper] of papers.entries()){
        const svg=paper.querySelector(':scope > svg[data-pdf]'),page=Number(svg?.dataset.pdf);
        const active=!locked&&!!svg&&stage.dataset.spread!==undefined&&page===Number(stage.dataset.spread)+side;
        const old=hot.get(paper);
        if(old?.svg===svg&&old?.active===active)continue;
        hot.set(paper,{svg,active});
        // A cancelled turn can restore a serialized old page, including its
        // buttons. Always discard those copies before decorating the new node.
        for(const hit of paper.querySelectorAll(':scope > [data-footnote-anchor]'))hit.remove();
        if(!active)continue;
        const notes=passages.notesForPage(page);
        const s=Number(svg.dataset.scale),ox=Number(svg.dataset.offsetX),oy=Number(svg.dataset.offsetY);
        if(!(s>0)||!Number.isFinite(ox)||!Number.isFinite(oy))continue;
        const fragment=doc.createDocumentFragment();
        const source=win.BIBLE_SOURCE,bookData=source.books[db.pages[page]?.b];
        const parallels=win.V25Parallels.targets(db.get(page),db.tags(page),bookData,source);
        for(const {note,citation,x,y,width,height} of [...targets(db.get(page),notes),...parallels]){
          if(note?!hasText(note):!passages.resolve(citation,source).length)continue;
          const el=doc.createElement('button');el.type='button';el.className='v25-footnote-target';
          el.dataset.footnoteAnchor='';el.dataset.notePage=String(page);
          if(note)el.dataset.noteOrdinal=String(note.ordinal);else el.dataset.parallel=citation;
          el.setAttribute('aria-label',note?'查看脚注'+note.marker+'引用的经文：'+note.citation:'查看对观经文：'+citation);
          Object.assign(el.style,{left:(ox+x*s)+'px',top:(oy+y*s)+'px',width:width*s+'px',height:height*s+'px'});
          fragment.appendChild(el);
        }
        paper.appendChild(fragment);
      }
    }
    const observer=new win.MutationObserver(sync);
    papers.forEach(p=>observer.observe(p,{childList:true}));
    observer.observe(stage,{attributes:true,attributeFilter:['data-spread','data-jump-state']});
    observer.observe(book,{attributes:true,attributeFilter:['class']});
    sync();
    return ()=>{observer.disconnect();for(const paper of papers)for(const hit of paper.querySelectorAll(':scope > [data-footnote-anchor]'))hit.remove();};
  }
  return {targets,install};
});
