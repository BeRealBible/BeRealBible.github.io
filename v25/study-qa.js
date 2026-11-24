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
  function mergeRanges(ranges){
    const merged=[];
    for(const [lo,hi] of ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){
      const last=merged.at(-1);
      if(last&&last[1]+1>=lo)last[1]=Math.max(last[1],hi);
      else merged.push([lo,hi]);
    }
    return merged;
  }
  // Only the union of canonical locations is needed for toolbar state and
  // paper marks. Stamp it into the entry; do not fetch the QAP text on select.
  function buildAvailability(data){
    const books={};
    for(const {refs} of data.items)for(const [code,ch,lo,hi] of refs){
      const ranges=((books[code]??={})[ch]??=[]);
      if(lo!=null)ranges.push([lo,hi]);
    }
    for(const chapters of Object.values(books))for(const ch of Object.keys(chapters)){
      chapters[ch]=mergeRanges(chapters[ch]).flat();
    }
    return {schema:1,books};
  }
  function createAvailability(data){
    if(data?.schema!==1||!data.books)throw Error('Unknown QAP availability version');
    function has(code,ch,lo,hi=lo){
      const ranges=data.books[code]?.[ch];
      if(!ranges||lo==null)return !!ranges; // An empty array means chapter-only.
      for(let n=0;n<ranges.length&&ranges[n]<=hi;n+=2)if(ranges[n+1]>=lo)return true;
      return false;
    }
    return {has,hasAny:objects=>objects.some(({code,ch,lo,hi})=>has(code,ch,lo,hi))};
  }
  // QAP and notes share both canonical location normalization and this lookup.
  // Whole-chapter anchors are distinct from verses; lookups de-duplicate by ID.
  function createReferenceIndex(items,rank=()=>0){
    const byChapter=new Map();
    for(const [order,item] of items.entries()){
      for(const r of item.refs){
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
    function query(objects){
      const hits=new Map();
      for(const obj of objects){
        const {code,ch,lo,hi=lo}=obj;
        const key=addr(code,ch),all=lo==null;
        for(const {item,ref,order} of byChapter.get(key)||[]){
          if(!all&&(ref.length!==4||!intersects(lo,hi,ref[2],ref[3])))continue;
          const score=rank(item,ref,key);
          const old=hits.get(item.id);
          if(!old||score>old.score)hits.set(item.id,{item,order,score});
        }
      }
      return [...hits.values()].sort((a,b)=>b.score-a.score||a.order-b.order).map(hit=>hit.item);
    }
    return {has,query};
  }
  function createIndex(data){
    if(data?.schema!==1||!Array.isArray(data.items))throw Error('Unknown QAP library version');
    const seen=new Set();
    for(const {id,refs,q,a} of data.items){
      if(!id||seen.has(id)||!q||!a||!refs?.length)throw Error('Incomplete QAP item');
      seen.add(id);
    }
    return createReferenceIndex(data.items,(item,ref,key)=>(item.id.startsWith(key+'.')?2:0)+(ref.length===4?1:0));
  }
  function describeSelection(next,books){
    const order=new Map(books.map((book,i)=>[book.code,{...book,i}])),groups=new Map();
    for(const {code,ch,lo,hi=lo} of next){
      if(!order.has(code))continue;
      const key=addr(code,ch);
      if(!groups.has(key))groups.set(key,{code,ch,whole:false,ranges:[]});
      const group=groups.get(key);
      if(lo==null)group.whole=true;
      else group.ranges.push([lo,hi]);
    }
    const sorted=[...groups.values()].sort((a,b)=>order.get(a.code).i-order.get(b.code).i||a.ch-b.ch);
    const objects=[],keys=[],labels=[];
    for(const {code,ch,whole,ranges} of sorted){
      let volume=labels.at(-1);
      if(volume?.code!==code){volume={code,parts:[]};labels.push(volume);}
      if(whole){
        objects.push({code,ch});keys.push(addr(code,ch));
        const last=volume.parts.at(-1);
        if(last?.end===ch-1)last.end=ch;
        else volume.parts.push({start:ch,end:ch});
        continue;
      }
      const merged=mergeRanges(ranges);
      const sections=merged.map(([lo,hi])=>{
        objects.push({code,ch,lo,hi});keys.push(addr(code,ch)+':'+lo+'-'+hi);
        return lo===hi?String(lo):lo+'–'+hi;
      });
      volume.parts.push({text:ch+':'+sections.join('、')});
    }
    const title=key=>labels.map(({code,parts})=>{
      const book=order.get(code);
      return (book[key]||book.name)+' '+parts.map(p=>p.text||(p.start===p.end?p.start:p.start+'–'+p.end)+'章').join('、');
    }).join('；');
    return {objects,key:keys.join('|'),title:title('short'),fullTitle:title('name')};
  }
  function mount({stage,paper,citationLinks,openWindow,openCitation}){
    const doc=stage.ownerDocument,win=doc.defaultView,$=id=>doc.getElementById(id);
    const template=$('study-qa'),settings=$('study-settings'),pref=$('study-marks-enabled');
    const availability=createAvailability(JSON.parse($('study-qa-availability').textContent));
    const root=doc.documentElement,marked=new WeakSet();
    const notesEnabled=!!win.V25Notes?.enabled(win.location,win.V25_ACCOUNT_CONFIG?.notesOrigin,
      win.V25_ACCOUNT_CONFIG?.pagesIsolationVerified),models=new Map();
    const describe=objects=>describeSelection(objects,paper.books),scope=()=>win.V25Account?.notesScope||null;
    let pendingWrite=null;
    const notes=()=>{
      const id=scope();if(!notesEnabled||!id||!win.V25NoteSync)return null;
      if(models.has(id))return models.get(id);
      let storage,sessionStorage,timer=0;try{storage=win.localStorage;sessionStorage=win.sessionStorage;}catch{}
      const local=win.V25Notes.createStore({storage,scope:id,describe,createIndex:createReferenceIndex});
      const model=win.V25NoteSync.create({model:local,describe,storage,sessionStorage,scope:id,
        active:()=>scope()===id,online:()=>win.navigator.onLine!==false,transport:win.V25Account.noteTransport(id),
        retrySoon(){if(!timer)timer=win.setTimeout(()=>{timer=0;if(scope()===id)model.refresh();},2500);}});
      models.set(id,model);model.refresh();return model;
    };
    if(notesEnabled){
      win.addEventListener('storage',e=>{for(const model of models.values())model.invalidate(e.key);});
      win.addEventListener('online',()=>{const model=notes();model?.resume();model?.refresh();});
      // Receive changes made in another browser without interrupting the editor.
      const pull=()=>{if(!doc.hidden)notes()?.refresh();};
      doc.addEventListener('visibilitychange',pull);
      win.addEventListener('paper-note-scope-changed',pull);
      win.addEventListener('beforeunload',e=>{if(models.get(scope())?.hasPending()){e.preventDefault();e.returnValue=true;}});
      win.setInterval(pull,5000);pull();
      $('paper-account-dialog')?.addEventListener('close',()=>{
        const pending=pendingWrite;pendingWrite=null;
        if(pending&&scope())open(pending.next,pending.restore,'write');
      });
    }
    let inventory=null,pending=null,observer=null,frame=null;
    let marking=false;
    function load(){
      if(inventory)return Promise.resolve(inventory);
      if(!pending){
        pending=(async()=>{
          const offline=win.__paperOffline;
          if(offline)return createIndex(JSON.parse(await offline.take('study-qa-data')));
          const response=await win.fetch(asset+'?v='+template.dataset.revision);
          if(!response.ok)throw Error('QAP library unavailable: '+response.status);
          return createIndex(await response.json());
        })().then(index=>inventory=index).finally(()=>pending=null);
      }
      return pending;
    }
    function inline(host,text,context){
      // Maintain the Markdown typography without hiding a reference that
      // crosses emphasis runs, e.g. "**撒下** 2:1".
      const pattern=/(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
      let end=0,plain='';
      const styles=[];
      for(const m of text.matchAll(pattern)){
        plain+=text.slice(end,m.index);
        const a=plain.length;
        plain+=m[2]||m[3]||m[4];end=m.index+m[0].length;
        styles.push({a,z:plain.length,tag:m[2]?'strong':m[3]?'em':'code'});
      }
      plain+=text.slice(end);
      function write(node,a,z){
        for(const run of styles){
          const left=Math.max(a,run.a),right=Math.min(z,run.z);
          if(right<=left)continue;
          if(left>a)node.append(doc.createTextNode(plain.slice(a,left)));
          const style=doc.createElement(run.tag);
          style.textContent=plain.slice(left,right);node.append(style);
          a=right;
        }
        if(a<z)node.append(doc.createTextNode(plain.slice(a,z)));
      }
      citationLinks.append(host,plain,{context,write,open:(ref,anchor)=>openCitation(ref,{anchor})});
    }
    function answerNode(item,context){
      const body=doc.createElement('div');body.className='study-qa__answer';
      for(const block of item.a.split(/\n\s*\n/)){
        const p=doc.createElement('p');
        inline(p,block.split('\n').map(line=>line.trim().replace(/^#{1,6}\s+/,'').replace(/^[-*]\s+/,'• ')).join('\n'),context);
        body.append(p);
      }
      return body;
    }
    function row(item){
      const el=doc.createElement('details'),summary=doc.createElement('summary');
      const [code,ch]=item.id.split('.'),context={code,ch:Number(ch)};
      el.dataset.qap=item.id;
      inline(summary,item.q,context);el.append(summary);
      el.addEventListener('toggle',()=>{if(el.open&&el.childElementCount===1)el.append(answerNode(item,context));});
      return el;
    }
    function renderQA(container,objects){
        const content=template.content.cloneNode(true);
        const status=content.querySelector('.study-qa__status'),list=content.querySelector('.study-qa__list');
        container.append(content);
        if(!availability.hasAny(objects)){status.textContent='这里暂无问答。';return;}
        function render(){
          if(!list.isConnected)return;
          const items=inventory.query(objects),frag=doc.createDocumentFragment();
          status.textContent=items.length?'':'这里暂无问答。';
          for(const item of items)frag.append(row(item));
          list.append(frag);
        }
        if(inventory)render();
        else{
          status.textContent='正在载入经文问答…';
          load().then(render,()=>{if(status.isConnected)status.textContent='问答未能载入。请关闭后重试。';});
        }
    }
    function renderMaterial(scroll,description,model,profile,initial){
      const doc=scroll.ownerDocument,make=(tag,cls,text)=>{
        const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;
      };
      const tabs=make('div','study-material__tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','经文资料');
      const owner=scroll.closest('.compare-slip').id,parts={};
      for(const [key,label] of [['notes','笔记'],['qa','问答']]){
        const button=make('button','study-material__tab',label),panel=make('div','study-material__panel');
        button.type='button';button.id=owner+'-tab-'+key;panel.id=owner+'-pane-'+key;
        button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
        panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
        button.addEventListener('click',()=>show(key));tabs.append(button);parts[key]={button,panel,top:0};
      }
      tabs.addEventListener('keydown',e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        const next=e.key==='Home'?'notes':e.key==='End'?'qa':active==='notes'?'qa':'notes';
        e.preventDefault();parts[next].button.focus({preventScroll:true});show(next);
      });
      scroll.append(tabs,parts.notes.panel,parts.qa.panel);
      const listing=make('div','study-notes__list'),compose=make('div','study-notes__editor');
      const range=make('p','study-notes__address'),field=make('textarea','study-notes__field');
      field.setAttribute('aria-label','笔记正文');field.placeholder='在这里写笔记…';field.rows=5;
      field.spellcheck=false;field.autocomplete='off';field.maxLength=win.V25Notes.LIMIT;
      const hint=make('p','study-notes__sync-hint','输入会自动同步到当前账号。');
      const status=make('p','study-notes__status');status.setAttribute('role','status');
      const done=make('button','study-notes__link','返回笔记列表');done.type='button';
      compose.append(range,field,hint,status,done);parts.notes.panel.append(compose,listing);
      let active=null,editing=null,qaRendered=false,seenText='',composing=false;
      function listNotes(){
        if(editing||active!=='notes')return;
        const matches=model?.query(description.objects)||[],frag=doc.createDocumentFragment();
        if(!model){frag.append(make('p','study-notes__empty','登录后可查看自己的云端笔记。'));listing.replaceChildren(frag);return;}
        if(!matches.length)frag.append(make('p','study-notes__empty','所选经文还没有笔记。'));
        for(const item of matches){
          const article=make('article','study-notes__item'),header=make('div','study-notes__item-head');
          const label=make('span','study-notes__address',item.label),edit=make('button','study-notes__link','编辑');edit.type='button';
          edit.setAttribute('aria-label','编辑笔记：'+item.label);
          edit.addEventListener('click',()=>startEditing(describe(item.refs.map(([code,ch,lo,hi])=>lo==null?{code,ch}:{code,ch,lo,hi})),true));
          header.append(label,edit);
          article.append(header,make('p','study-notes__text',item.text));frag.append(article);
        }
        listing.replaceChildren(frag);
      }
      function show(key){
        if(active===key)return;
        if(active)parts[active].top=scroll.scrollTop;
        active=key;
        for(const [id,{button,panel}] of Object.entries(parts)){
          button.setAttribute('aria-selected',String(key===id));button.tabIndex=key===id?0:-1;panel.hidden=key!==id;
        }
        if(key==='notes')listNotes();
        else if(!qaRendered){qaRendered=true;renderQA(parts.qa.panel,description.objects);}
        scroll.scrollTop=parts[key].top;
      }
      function statusText(){
        if(!editing)return;
        const {text,warn}=model.status(editing.key);
        status.dataset.unsaved=warn?'true':'false';if(status.textContent!==text)status.textContent=text;
      }
      function startEditing(desc,focus){
        const keep=editing?.key===desc.key;
        editing=desc;compose.hidden=false;listing.hidden=true;
        range.textContent=desc.fullTitle;
        if(!keep){field.value=seenText=model.body(desc.key);statusText();}
        show('notes');
        if(focus){field.focus({preventScroll:true});field.setSelectionRange(field.value.length,field.value.length);}
      }
      function record(e){
        if(editing&&profile===scope()&&!e.isComposing&&!composing){
          const text=field.value;model.write(editing,text,compose,seenText);seenText=text;statusText();
        }
      }
      // Candidate text is not committed. Once entered, a character, paste or
      // deletion goes immediately into the cloud journal without a debounce.
      field.addEventListener('input',record);
      field.addEventListener('compositionstart',()=>{composing=true;});
      field.addEventListener('compositionend',e=>{composing=false;record(e);});
      done.addEventListener('click',()=>{editing=null;compose.hidden=true;listing.hidden=false;listNotes();parts.notes.button.focus({preventScroll:true});});
      const off=model?.listen((key,source)=>{
        if(editing&&key===editing.key){
          if(source==='cloud'&&!composing){
            const a=field.selectionStart,z=field.selectionEnd;
            field.value=seenText=model.body(key);field.setSelectionRange(a,z);
          }
          statusText();
        }else listNotes();
      });
      compose.hidden=true;
      const request=mode=>{
        if(mode==='write')startEditing(description,true);
        else if(!active)show(availability.hasAny(description.objects)?'qa':'notes');
        else if(editing){editing=null;compose.hidden=true;listing.hidden=false;listNotes();}
      };
      request(initial);
      return {request,dispose:()=>off?.()};
    }
    function open(next,restore,mode='view'){
      const selection=describe(next),{objects,key,title,fullTitle}=selection,model=notes(),profile=scope();
      if(!key||mode==='write'&&!notesEnabled||mode!=='write'&&!availability.hasAny(objects)&&!model?.query(objects).length)return false;
      if(mode==='write'&&!model){
        if(win.V25Account?.openDialog){pendingWrite={next,restore};win.V25Account.openDialog();}
        else stage.dispatchEvent(new win.CustomEvent('paper-note-login-required',{bubbles:true}));
        return false;
      }
      let content;
      return openWindow({key,title,fullTitle,restore,material:notesEnabled,mode,focus:mode!=='write',
        render(scroll){if(!notesEnabled)renderQA(scroll,objects);else content=renderMaterial(scroll,selection,model,profile,mode);},
        onReopen(nextMode){content?.request(nextMode);},onDispose(){content?.dispose();}});
    }

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
        if(ch&&availability.has(book.code,ch))el.dataset.qapMark='chapter';
        if(role==='verse'&&availability.has(book.code,v.ch,v.lo,v.hi)){
          el.dataset.qapMark='verse';markedVerses.add(ref);
        }
        if(role==='body'&&!ink.has(ref))ink.set(ref,[el,v]);
      }
      // The first verse and a split verse may have no separate printed number
      // on this face. In that case underline only the first visible ink run.
      for(const [ref,[el,v]] of ink){
        if(!markedVerses.has(ref)&&availability.has(book.code,v.ch,v.lo,v.hi))el.dataset.qapMark='verse';
      }
    }
    function markChunk(chunk){
      if(marked.has(chunk))return;
      marked.add(chunk);
      const chapter=chunk.querySelector('[data-study-chapter]');
      if(chapter){
        const [b,c]=chapter.dataset.studyChapter.split('.');
        if(availability.has(b,+c))chapter.dataset.qapMark='chapter';
      }
      for(const el of chunk.querySelectorAll('[data-verse-id]')){
        const b=el.dataset.verseId.split('.')[0],v=parse(el.dataset.ref);
        if(v&&availability.has(b,v.ch,v.lo,v.hi))el.querySelector('sup').dataset.qapMark='verse';
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
      marking=value;root.toggleAttribute('data-study-marks',value);observer?.disconnect();
      if(frame!==null){win.cancelAnimationFrame(frame);frame=null;}
      pref.checked=value;
      if(persist)try{win.localStorage.setItem(KEY,value?'1':'0');}catch{}
      if(!value)return;
      observer??=new win.MutationObserver(scheduleMarks);
      observer.observe(stage.parentElement,{childList:true,subtree:true});
      scheduleMarks();
    }
    pref.addEventListener('change',()=>setMarking(pref.checked,{persist:true}));
    win.addEventListener('storage',e=>{if(e.key===KEY)setMarking(e.newValue==='1');});
    try{setMarking(win.localStorage.getItem(KEY)==='1');}catch{}
    return {open,notesEnabled,hasAny:objects=>availability.hasAny(objects)||!!notes()?.query(objects).length,
      openSettings(){if(!settings.open)settings.showModal();}};
  }
  return {buildAvailability,createAvailability,createReferenceIndex,createIndex,chapterOf,describeSelection,mount};
});
