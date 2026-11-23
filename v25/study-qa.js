/* QAP: one study question and answer, with one or more canonical addresses. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25StudyQA=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const KEY='paper-bible-study-marks-v1';
  const asset='data/study-qa.json';
  const addr=(code,ch)=>code+'.'+ch;
  const parse=ref=>{
    const m=/^(\d+):(\d+)(?:[-–](\d+))?$/.exec(ref||'');
    return m?{ch:+m[1],lo:+m[2],hi:+(m[3]||m[2])}:null;
  };
  function chapterOf(role,ref){
    const v=parse(ref);
    return v&&(role==='chapter'||role==='heading'&&v.lo===1)?v.ch:null;
  }
  const intersects=(a,z,c,d)=>a<=d&&c<=z;
  function createIndex(data){
    if(data?.schema!==1||!Array.isArray(data.items))throw Error('Unknown QAP library version');
    const byChapter=new Map(),seen=new Set();
    for(const [order,item] of data.items.entries()){
      const {id,refs,q,a}=item;
      if(!id||seen.has(id)||!q||!a||!refs?.length)throw Error('Incomplete QAP item');
      seen.add(id);
      for(const r of refs){
        const key=addr(r[0],r[1]);
        if(!byChapter.has(key))byChapter.set(key,[]);
        byChapter.get(key).push({item,ref:r,order});
      }
    }
    function has(code,ch,lo,hi=lo){
      const hits=byChapter.get(addr(code,ch));
      if(lo==null)return !!hits?.length;
      return !!hits?.some(({ref:r})=>r.length===4&&intersects(lo,hi,r[2],r[3]));
    }
    function query(objects,scope='selection'){
      const hits=new Map();
      for(const obj of objects){
        const {code,ch,lo,hi=lo}=obj;
        const key=addr(code,ch),all=scope==='chapters'||lo==null;
        for(const {item,ref,order} of byChapter.get(key)||[]){
          if(!all&&(ref.length!==4||!intersects(lo,hi,ref[2],ref[3])))continue;
          const score=(item.id.startsWith(key+'.')?2:0)+(ref.length===4?1:0);
          const old=hits.get(item.id);
          if(!old||score>old.score)hits.set(item.id,{item,order,score});
        }
      }
      return [...hits.values()].sort((a,b)=>b.score-a.score||a.order-b.order).map(hit=>hit.item);
    }
    return {has,query};
  }
  function mount({stage,paper}){
    const doc=stage.ownerDocument,win=doc.defaultView,$=id=>doc.getElementById(id);
    const dialog=$('study-qa'),settings=$('study-settings'),legend=$('study-qa-position');
    const list=$('study-qa-list'),status=$('study-qa-status'),scopes=$('study-qa-scopes'),pref=$('study-marks-enabled');
    const buttons=[...scopes.querySelectorAll('button')],scroll=$('study-qa-scroll'),notices=$('study-settings-status');
    const root=doc.documentElement,marked=new WeakSet(),names=new Map(paper.books.map(b=>[b.code,b.name]));
    let inventory=null,pending=null,objects=[],mode='selection',previousFocus=null,serial=0,observer=null,frame=null;
    let marking=false,epoch=0;
    function load(){
      if(inventory)return Promise.resolve(inventory);
      if(!pending){
        pending=(async()=>{
          const offline=win.__paperOffline;
          if(offline)return createIndex(JSON.parse(await offline.take('study-qa-data')));
          const response=await win.fetch(asset+'?v='+dialog.dataset.revision);
          if(!response.ok)throw Error('QAP library unavailable: '+response.status);
          return createIndex(await response.json());
        })().then(index=>inventory=index).finally(()=>pending=null);
      }
      return pending;
    }
    const title=(b,ch)=>(names.get(b)||b)+' '+ch;
    const label=(b,ch,a,z)=>title(b,ch)+(a==null?'章':':'+a+(z!==a?'–'+z:''));
    function selectionLabel(choices,scope){
      const chapters=new Map();
      for(const {code,ch,lo,hi=lo} of choices){
        const key=addr(code,ch);
        if(!chapters.has(key))chapters.set(key,{code,ch,full:false,ranges:[]});
        const state=chapters.get(key);
        if(lo==null||scope==='chapters')state.full=true;
        else state.ranges.push([lo,hi]);
      }
      return [...chapters.values()].map(({code,ch,full,ranges})=>{
        if(full)return label(code,ch);
        const merged=[];
        for(const r of ranges.sort((a,b)=>a[0]-b[0])){
          if(merged.length&&r[0]<=merged.at(-1)[1]+1)merged.at(-1)[1]=Math.max(r[1],merged.at(-1)[1]);
          else merged.push(r);
        }
        return title(code,ch)+':'+merged.map(([a,z])=>a===z?a:a+'–'+z).join('、');
      }).join('；');
    }
    function inline(host,text){
      // Limited Markdown: render only literal text, emphasis and inline code.
      // No imported HTML, external resources, or links are executed.
      const pattern=/(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
      let end=0;
      for(const m of text.matchAll(pattern)){
        host.append(doc.createTextNode(text.slice(end,m.index)));
        const node=doc.createElement(m[2]?'strong':m[3]?'em':'code');
        node.textContent=m[2]||m[3]||m[4];host.append(node);end=m.index+m[0].length;
      }
      host.append(doc.createTextNode(text.slice(end)));
    }
    function answerNode(item){
      const body=doc.createElement('div');body.className='study-qa__answer';
      for(const block of item.a.split(/\n\s*\n/)){
        const p=doc.createElement('p');
        inline(p,block.split('\n').map(line=>line.trim().replace(/^#{1,6}\s+/,'').replace(/^[-*]\s+/,'• ')).join('\n'));
        body.append(p);
      }
      return body;
    }
    function row(item){
      const el=doc.createElement('details'),summary=doc.createElement('summary'),trailer=doc.createElement('span');
      el.dataset.qap=item.id;
      inline(summary,item.q);
      trailer.className='study-qa__refs';
      trailer.textContent=item.refs.map(r=>label(...r)).join(' · ');
      summary.append(trailer);el.append(summary);
      el.addEventListener('toggle',()=>{if(el.open&&el.childElementCount===1)el.append(answerNode(item));});
      return el;
    }
    function render(){
      legend.textContent=selectionLabel(objects,mode);
      for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.scope===mode));
      list.replaceChildren();
      if(!inventory)return;
      const items=inventory.query(objects,mode);
      status.textContent=items.length?'共 '+items.length+' 条问答 · 点问题展开答案':
        mode==='selection'&&!scopes.hidden?'所选位置暂无问答，可切换到「整章」。':'所选章节暂无问答。';
      const frag=doc.createDocumentFragment();
      for(const item of items)frag.append(row(item));
      list.append(frag);scroll.scrollTop=0;
    }
    function open(next,restore){
      if(!next.length)return false;
      const unique=new Map(next.map(o=>[addr(o.code,o.ch)+'.'+(o.lo??'chapter')+'.'+(o.hi??o.lo??''),o]));
      objects=[...unique.values()];mode='selection';scopes.hidden=objects.every(o=>o.lo==null);
      previousFocus=restore;
      let version=++serial;
      status.textContent='正在载入经文问答…';render();
      if(!dialog.open)dialog.showModal();
      if(!inventory)load().then(()=>{if(dialog.open&&version===serial)render();},()=>{
        if(dialog.open&&version===serial)status.textContent='问答未能载入。请关闭后重试。';
      });
      return true;
    }
    for(const b of buttons)b.addEventListener('click',()=>{mode=b.dataset.scope;render();});
    dialog.addEventListener('close',()=>{
      serial++;list.replaceChildren();
      if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
      else stage.focus({preventScroll:true});
    });

    function markPaper(svg){
      if(marked.has(svg))return;
      marked.add(svg);
      const book=paper.books[paper.pages[Number(svg.dataset.pdf)]?.b];
      if(!book)return;
      const markedVerses=new Set(),ink=new Map();
      for(const el of svg.querySelectorAll('text[data-ref]')){
        const {role,ref}=el.dataset,v=parse(ref);
        if(!v)continue;
        const ch=chapterOf(role,ref);
        if(ch&&inventory.has(book.code,ch))el.dataset.qapMark='chapter';
        if(role==='verse'&&inventory.has(book.code,v.ch,v.lo,v.hi)){
          el.dataset.qapMark='verse';markedVerses.add(ref);
        }
        if(role==='body'&&!ink.has(ref))ink.set(ref,[el,v]);
      }
      // The first verse and a split verse may have no separate printed number
      // on this face. In that case underline only the first visible ink run.
      for(const [ref,[el,v]] of ink){
        if(!markedVerses.has(ref)&&inventory.has(book.code,v.ch,v.lo,v.hi))el.dataset.qapMark='verse';
      }
    }
    function markChunk(chunk){
      if(marked.has(chunk))return;
      marked.add(chunk);
      const chapter=chunk.querySelector('[data-study-chapter]');
      if(chapter){
        const [b,c]=chapter.dataset.studyChapter.split('.');
        if(inventory.has(b,+c))chapter.dataset.qapMark='chapter';
      }
      for(const el of chunk.querySelectorAll('[data-verse-id]')){
        const b=el.dataset.verseId.split('.')[0],v=parse(el.dataset.ref);
        if(v&&inventory.has(b,v.ch,v.lo,v.hi))el.querySelector('sup').dataset.qapMark='verse';
      }
    }
    function scheduleMarks(){
      if(!marking||frame!==null)return;
      frame=win.requestAnimationFrame(()=>{
        frame=null;if(!marking)return;
        for(const svg of stage.querySelectorAll('.paper svg[data-pdf]'))markPaper(svg);
        for(const chunk of doc.querySelectorAll('.compare-slip__chunk'))markChunk(chunk);
      });
    }
    function setMarking(value,{persist=false}={}){
      const version=++epoch;
      marking=false;root.removeAttribute('data-study-marks');observer?.disconnect();
      if(frame!==null){win.cancelAnimationFrame(frame);frame=null;}
      pref.checked=value;
      if(persist)try{win.localStorage.setItem(KEY,value?'1':'0');}catch{}
      notices.textContent='';
      if(!value)return;
      load().then(()=>{
        if(epoch!==version)return;
        marking=true;root.dataset.studyMarks='';
        observer??=new win.MutationObserver(scheduleMarks);
        observer.observe(stage.parentElement,{childList:true,subtree:true});
        scheduleMarks();
      },()=>{if(epoch===version)notices.textContent='问答标记未能载入，请稍后重试。';});
    }
    pref.addEventListener('change',()=>setMarking(pref.checked,{persist:true}));
    win.addEventListener('storage',e=>{if(e.key===KEY)setMarking(e.newValue==='1');});
    try{setMarking(win.localStorage.getItem(KEY)==='1');}catch{}
    return {open,openSettings(){if(!settings.open)settings.showModal();}};
  }
  return {createIndex,chapterOf,mount};
});
