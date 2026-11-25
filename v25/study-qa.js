/* QAP: one study question and answer, with one or more canonical addresses. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25StudyQA=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const KEY='paper-bible-study-marks-v1';
  const SVG='http://www.w3.org/2000/svg';
  const asset='data/study-qa.json';
  const addr=(code,ch)=>code+'.'+ch;
  const parse=ref=>{
    const m=/^(\d+):(\d+)(?:[-–](\d+))?$/.exec(ref||'');
    return m?{ch:+m[1],lo:+m[2],hi:+(m[3]||m[2])}:null;
  };
  function chapterOf(role,ref){
    // A section caption can be printed next to verse 1 without being a chapter control.
    return role==='chapter'?(parse(ref)?.ch??null):null;
  }
  // Work in actual paper coordinates, not the em of a fitted SVG glyph.
  // The same number can be much larger than the text printed beneath it.
  function paperCueLine(anchor,ink){
    if(!anchor||anchor.hideHatch||!(anchor.w>0&&anchor.h>0)||![anchor.x,anchor.y,anchor.w,anchor.h].every(Number.isFinite))return null;
    const {x,y,w,h}=anchor,inset=Math.min(.8,w*.13),x1=x+inset,x2=x+w-inset,bottom=y+h;
    let underline=Math.min(bottom+1.65,703);
    for(const other of ink){
      if(other===anchor||other.hideHatch||!(other.w>0&&other.h>0))continue;
      // Skip an occupied gap instead of drawing the cue across printed ink.
      if(other.x<x2+.3&&other.x+other.w>x1-.3&&other.y+other.h>bottom)
        underline=Math.min(underline,other.y-.6);
    }
    return underline>=bottom+.85?{x1,x2,y:underline}:null;
  }
  function chapterCountBox(anchor,ink,rows=2,digits=2){
    if(!anchor||anchor.hideHatch||!(anchor.w>0&&anchor.h>0))return null;
    const right=anchor.x-2.7,center=anchor.y+anchor.h*.51;
    const other=ink.filter(o=>o!==anchor&&!o.hideHatch&&o.w>0&&o.h>0&&o.x<anchor.x&&o.x+o.w>right-52&&o.y+o.h>center-50&&o.y<center+50);
    const clear=(l,t,r,b)=>!other.some(o=>o.x+o.w>l-.55&&o.x<r+.55&&o.y+o.h>t-.55&&o.y<b+.55);
    // Use real whitespace and compact a one-row badge rather than reserving
    // a phantom row. Accommodate at most three digit widths; longer counts fit the same gutter.
    for(const size of [8.5,8,7,6,5])for(const dy of [0,-4,4,-8,8,-12,12,-16,16,-20,20]){
      const w=size*(1.12+.57*Math.min(3,digits)),h=size*(1.14*rows+.04),x=right-w,y=center+dy-h/2;
      if(x<1||y<1||y+h>703||Math.abs(dy)>Math.max(12,anchor.h*.55))continue;
      if(!clear(x,y,right,y+h))continue;
      let l=x,t=y,r=right,b=y+h;
      // Enlarge the transparent target only through blank paper. Never take
      // the real chapter numeral or neighboring ink away from text selection.
      for(let i=0;i<9;i++){
        if(l-1>=1&&clear(l-1,t,r,b))l--;
        if(r+1<=anchor.x-1&&clear(l,t,r+1,b))r++;
        if(t-1>=1&&clear(l,t-1,r,b))t--;
        if(b+1<=703&&clear(l,t,r,b+1))b++;
      }
      return {x,y,w,h,size,hit:{x:l,y:t,width:r-l,height:b-t}};
    }
    return null;
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
    const books={},chapterCounts={},starts={};
    for(const {refs} of data.items){
      const counted=new Set();
      for(const [code,ch,lo,hi] of refs){
        const ranges=((books[code]??={})[ch]??=[]),key=addr(code,ch);
        if(lo!=null){ranges.push([lo,hi]);((starts[code]??={})[ch]??=new Set()).add(lo);}
        if(!counted.has(key)){
          counted.add(key);const counts=(chapterCounts[code]??={});counts[ch]=(counts[ch]??0)+1;
        }
      }
    }
    for(const chapters of Object.values(books))for(const ch of Object.keys(chapters)){
      chapters[ch]=mergeRanges(chapters[ch]).flat();
    }
    for(const chapters of Object.values(starts))for(const ch of Object.keys(chapters))chapters[ch]=[...chapters[ch]].sort((a,b)=>a-b);
    return {schema:1,books,chapterCounts,starts};
  }
  function createAvailability(data){
    if(data?.schema!==1||!data.books)throw Error('Unknown QAP availability version');
    function has(code,ch,lo,hi=lo){
      const ranges=data.books[code]?.[ch];
      if(!ranges||lo==null)return !!ranges; // An empty array means chapter-only.
      for(let n=0;n<ranges.length&&ranges[n]<=hi;n+=2)if(ranges[n+1]>=lo)return true;
      return false;
    }
    function hasStart(code,ch,lo,hi=lo){
      if(data.starts)return !!data.starts[code]?.[ch]?.some(v=>v>=lo&&v<=hi);
      // A cached, older availability index still uses the first verse of each retained range.
      return !!data.books[code]?.[ch]?.some((v,i)=>i%2===0&&v>=lo&&v<=hi);
    }
    return {has,hasStart,chapterCount:(code,ch)=>data.chapterCounts?.[code]?.[ch]??0,
      hasAny:objects=>objects.some(({code,ch,lo,hi})=>has(code,ch,lo,hi))};
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
  // Only the ink cue is abbreviated. The saved association and its lookup
  // still cover the entire range, including any later chapters.
  function noteStarts(items,code,ch){
    const starts=new Set();
    for(const item of items)for(const ref of item.anchorObjects??item.refs){
      if(ref.length>=4&&ref[0]===code&&ref[1]===ch)starts.add(ref[2]);
    }
    return [...starts].sort((a,b)=>a-b);
  }
  function* passageRows(anchor,scripture,parser){
    const book=scripture.index(anchor.code);
    for(const {ch,lo,hi=lo} of parser.segments(anchor)){
      const rows=book?.chunks.find(chunk=>chunk.chapter===ch)?.rows;
      if(rows)yield {ch,rows:lo==null?rows:rows.filter(row=>row.lo<=hi&&row.hi>=lo)};
    }
  }
  function markdownRuns(text){
    const pattern=/(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g,styles=[];
    let end=0,plain='';
    for(const m of text.matchAll(pattern)){
      plain+=text.slice(end,m.index);
      const a=plain.length;
      plain+=m[2]||m[3]||m[4];end=m.index+m[0].length;
      styles.push({a,z:plain.length,tag:m[2]?'strong':m[3]?'em':'code'});
    }
    return {plain:plain+text.slice(end),styles};
  }
  const escapeHtml=text=>text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  function noteBodyCopy(body){
    const lines=body.split(/\r\n?|\n/).map(line=>{
      const heading=/^#{1,6}\s+(.+)$/.exec(line),quote=/^>\s?(.*)$/.exec(line);
      const {plain,styles}=markdownRuns((heading?.[1]??quote?.[1]??line).replace(/^(\s*)[-*+]\s+/,'$1• '));
      let html='',i=0;
      for(const {a,z,tag} of styles){
        html+=escapeHtml(plain.slice(i,a))+'<'+tag+'>'+escapeHtml(plain.slice(a,z))+'</'+tag+'>';i=z;
      }
      html+=escapeHtml(plain.slice(i));
      return {plain,html:heading?'<strong>'+html+'</strong>':html,quote:!!quote};
    });
    const blocks=[];
    for(const line of lines){
      const last=blocks.at(-1);
      if(last&&last.quote===line.quote)last.lines.push(line.html);
      else blocks.push({quote:line.quote,lines:[line.html]});
    }
    return {
      text:lines.map(line=>(line.quote?'> ':'')+line.plain).join('\n'),
      html:blocks.map(({quote,lines})=>quote?'<blockquote><p>'+lines.join('<br>')+'</p></blockquote>':'<p>'+lines.join('<br>')+'</p>').join('')
    };
  }
  function formatNoteCopy(body,anchors,{scripture,parser,label,maxPlaces=10}){
    const places=anchors.slice(0,maxPlaces).map(anchor=>{
      const chars=[];
      passage: for(const part of passageRows(anchor,scripture,parser))for(const row of part.rows)for(const char of row.text){
        if(chars.length===50){chars[49]='…';break passage;}
        chars.push(char);
      }
      const address=label(anchor),excerpt=chars.join('');
      const lines=excerpt?excerpt.split(/\r\n?|\n/):[];
      // Plain-only paste still separates the quote; HTML uses a semantic blockquote
      // so destinations can apply their own quote styling if they drop the color.
      return {text:[address,...lines.map(line=>'> '+line)].join('\n'),
        html:'<p><strong>'+escapeHtml(address)+'</strong></p>'+
          (lines.length?'<blockquote><p style="color:#8a312b">'+lines.map(escapeHtml).join('<br>')+'</p></blockquote>':'')};
    });
    const parts=[...(body?[noteBodyCopy(body)]:[]),...places];
    return {text:parts.map(p=>p.text).join('\n\n'),html:parts.map(p=>p.html).join('')};
  }
  async function writeNoteClipboard(win,tools,{text,html}){
    try{
      const clipboard=win.navigator.clipboard;
      if(html&&clipboard?.write&&win.ClipboardItem){
        await clipboard.write([new win.ClipboardItem({
          'text/plain':new win.Blob([text],{type:'text/plain'}),
          'text/html':new win.Blob([html],{type:'text/html'})
        })]);
        return true;
      }
    }catch{}
    return tools.writeText(win,text);
  }
  function describeSelection(next,books,{separate=false}={}){
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
        if(!separate||!ranges.length)continue;
      }
      // Notes retain each confirmed range as its own removable object.
      const merged=separate?[...new Map(ranges.map(r=>[r.join(':'),r])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]):mergeRanges(ranges);
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
  function mount({stage,paper,scripture,citationLinks,openWindow,openCitation,closeCitation,openNoteSearch,closeNoteSearch,feedback=()=>{}}){
    const doc=stage.ownerDocument,win=doc.defaultView,$=id=>doc.getElementById(id);
    const template=$('study-qa'),settings=$('study-settings'),pref=$('study-marks-enabled');
    const availability=createAvailability(JSON.parse($('study-qa-availability').textContent));
    const root=doc.documentElement,marked=new WeakMap(),countedFaces=new WeakMap(),noteCues=new Map();
    const notesEnabled=!!win.V25Notes?.enabled(win.location,win.V25_ACCOUNT_CONFIG?.notesOrigin,
      win.V25_ACCOUNT_CONFIG?.pagesIsolationVerified),models=new Map();
    const grammar=win.V25NoteRefs,parser=grammar.create({...citationLinks,scripture});
    const plain=objects=>describeSelection(objects,paper.books,{separate:true});
    const describe=objects=>grammar.describe(objects,paper.books,parser,plain),scope=()=>win.V25Account?.notesScope||null;
    let pendingWrite=null,countFrame=null,noteEpoch=0;
    function notesChanged(){noteEpoch++;noteCues.clear();scheduleMarks();scheduleCounts();}
    function cuesFor(model,code,ch){
      if(!model?.ready())return [];
      const key=addr(code,ch);
      if(!noteCues.has(key))noteCues.set(key,noteStarts(model.query([{code,ch}]),code,ch));
      return noteCues.get(key);
    }
    const notes=()=>{
      const id=scope();if(!notesEnabled||!id||!win.V25NoteSync)return null;
      if(models.has(id))return models.get(id);
      let storage,sessionStorage,timer=0;try{storage=win.localStorage;sessionStorage=win.sessionStorage;}catch{}
      const local=win.V25Notes.createStore({storage,scope:id,describe,createIndex:createReferenceIndex});
      const model=win.V25NoteSync.create({model:local,describe,storage,sessionStorage,scope:id,
        active:()=>scope()===id,online:()=>win.navigator.onLine!==false,transport:win.V25Account.noteTransport(id),
        spansEnabled:win.V25Account.noteSpanEnabled,
        retrySoon(){if(!timer)timer=win.setTimeout(()=>{timer=0;if(scope()===id)model.refresh();},2500);}});
      models.set(id,model);model.listen(notesChanged);model.refresh();return model;
    };
    if(notesEnabled){
      win.addEventListener('storage',e=>{for(const model of models.values())model.invalidate(e.key);});
      win.addEventListener('online',()=>{const model=notes();model?.resume();model?.refresh();});
      // Receive changes made in another browser without interrupting the editor.
      const pull=()=>{if(!doc.hidden)notes()?.refresh();};
      doc.addEventListener('visibilitychange',pull);
      win.addEventListener('paper-note-scope-changed',()=>{pull();notesChanged();});
      win.addEventListener('beforeunload',e=>{if(models.get(scope())?.hasPending()){e.preventDefault();e.returnValue=true;}});
      win.setInterval(pull,5000);pull();
      $('paper-account-dialog')?.addEventListener('close',()=>{
        const pending=pendingWrite;pendingWrite=null;
        if(pending&&scope())open(pending.next,pending.restore,'write');
      });
    }
    let inventory=null,pending=null,observer=null,frame=null;
    let marking=false;
    let cueScale;
    function syncCueStroke(){
      const scale=Number(stage.dataset.scale);
      if(!(scale>0)||scale===cueScale)return;
      cueScale=scale;
      // The entire paper is scaled by a CSS ancestor, which can also scale
      // SVG non-scaling strokes. Invert that zoom here and cap the page-space
      // width so even a tightly spaced mark cannot touch the next glyph.
      stage.style.setProperty('--qap-cue-width',Math.min(1.2,.9/scale)+'px');
    }
    win.addEventListener('v25-camera-changed',syncCueStroke);
    syncCueStroke();
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
      const {plain,styles}=markdownRuns(text);
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
      const header=make('div','study-material__header'),bar=make('div','study-material__bar'),tabs=make('div','study-material__tabs');
      tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','经文资料');
      const slip=scroll.closest('.compare-slip'),owner=slip.id,parts={};
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
      const addSlot=make('div','study-notes__add-slot'),add=make('button','study-notes__add','+');add.type='button';
      add.setAttribute('aria-label','新增笔记');add.title='新增笔记';
      addSlot.append(add);bar.append(addSlot,tabs);header.append(bar);scroll.append(header,parts.notes.panel,parts.qa.panel);
      const listing=make('div','study-notes__list'),compose=make('div','study-notes__editor');
      const field=make('textarea','study-notes__field');
      field.setAttribute('aria-label','笔记正文');field.placeholder='在这里写笔记…';field.rows=8;
      field.spellcheck=false;field.autocomplete='off';field.maxLength=win.V25Notes.LIMIT;
      const hint=make('p','study-notes__sync-hint','输入会自动同步到当前账号。');
      const status=make('p','study-notes__status');status.setAttribute('role','status');
      const button=(label,cls='study-notes__link')=>{const el=make('button',cls,label);el.type='button';return el;};
      const labelButton=(el,label)=>{el.setAttribute('aria-label',label);el.title=label;};
      function iconButton(label,path,cls=''){
        const el=button('','study-notes__icon '+cls),svg=doc.createElementNS(SVG,'svg'),stroke=doc.createElementNS(SVG,'path');
        labelButton(el,label);svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
        stroke.setAttribute('d',path);svg.append(stroke);el.append(svg);return el;
      }
      const noteBar=make('div','study-notes__toolbar'),actions=make('div','study-notes__view-actions'),
        manualCopy=make('div','study-notes__copy-area'),copyToast=make('span','study-notes__copy-toast');
      copyToast.setAttribute('role','status');
      actions.setAttribute('role','group');actions.setAttribute('aria-label','笔记操作');
      const back=iconButton('返回笔记列表','M19 12H5m7-7-7 7 7 7'),
        edit=iconButton('编辑笔记','M13.5 6.5l4 4M4 20h4L20 8l-4-4L4 16v4z'),
        copy=iconButton('复制笔记和引用经文','M8 8h12v12H8zM16 4H4v12','study-notes__copy'),
        trash=iconButton('删除笔记','M4 6h16m-4 0V3H8v3M6 6l1 14h10l1-14m-8 4v6m4-6v6','study-notes__trash');
      actions.append(edit,copy,trash);noteBar.append(back,actions,copyToast);header.append(noteBar,manualCopy);
      const viewer=make('article','study-notes__view');
      const viewTitle=make('h2','study-notes__view-title','笔记正文');viewTitle.tabIndex=-1;
      const viewBody=make('p','study-notes__view-text'),viewStatus=make('p','study-notes__status');
      viewStatus.setAttribute('role','status');viewStatus.dataset.unsaved='true';
      const references=make('section','study-notes__references'),passages=make('div','study-notes__passages');
      references.append(make('h3','study-notes__refs-title','引用经文'),passages);
      const deletePrompt=make('dialog','study-qa study-notes__delete-prompt'),deleteHeading=make('h3','','删除这条笔记？'),
        deleteButtons=make('div','study-notes__delete-actions'),cancelDelete=button('取消'),confirmDelete=button('确认删除','study-notes__delete-confirm');
      deleteHeading.id=owner+'-delete-title';deletePrompt.setAttribute('aria-labelledby',deleteHeading.id);cancelDelete.autofocus=true;
      deleteButtons.append(cancelDelete,confirmDelete);deletePrompt.append(deleteHeading,deleteButtons);
      viewer.append(viewTitle,viewBody,viewStatus,references,deletePrompt);
      const refEditor=win.V25NoteRefEditor({doc,parser,books:paper.books,editable:win.V25Account?.noteReanchorEnabled===true,
        spansEnabled:win.V25Account?.noteSpanEnabled===true,
        preview:openCitation,closePreview:closeCitation,openSearch:openNoteSearch,closeSearch:closeNoteSearch,excerpt:anchor=>{
          const loc=parser.locations(anchor)[0],first=scripture.resolve(loc)[0];
          return first?.text||'';
        },browse:anchor=>{
          const book=scripture.index(anchor.code);
          const first=book?.byRef.get(anchor.ch+':'+(anchor.lo??1));
          return first?{rows:book.rows,at:first.order}:null;
        },change:nextRefs=>{
          if(!editing||profile!==scope())return false;
          const next=describe(nextRefs),{noteId:id,key}=editing;
          if(!next.key||!grammar.allowsPlaces(next.objects.length,editing.objects.length)||
            next.refs?.length>grammar.MAX||((model.descriptor(id)||model.get(id))&&!model.reanchor(id,next,compose,key)))return false;
          editing={...next,noteId:id};refEditor.setRefs(editing.objects);statusText();return true;
        }});
      const notebook=make('div','study-notes__box');notebook.append(refEditor.root,field);
      compose.append(notebook,hint,status);parts.notes.panel.append(listing,viewer,compose);
      let active=null,viewing=null,editing=null,editReturn=null,listTop=0,renderedRefs=null,deleteTarget=null;
      let qaRendered=false,seenText='',composing=false,copyTimer=0;
      const idForNew=()=> 'N:'+win.crypto.randomUUID().replaceAll('-','').toUpperCase();
      const fromItem=item=>describe((item.anchorObjects||item.refs).map(grammar.decode));
      function currentDescriptor(id){
        if(!id)return null;
        const latest=model.descriptor(id);if(latest)return latest;
        const cached=model.get(id);return cached&&fromItem(cached);
      }
      const noteButton=id=>id&&[...listing.querySelectorAll('[data-note-id]')].find(el=>el.dataset.noteId===id);
      function clearCopyToast(){
        win.clearTimeout(copyTimer);copyTimer=0;copyToast.textContent='';
      }
      function showCopyToast(){
        win.clearTimeout(copyTimer);copyToast.textContent='文字已复制';
        copyTimer=win.setTimeout(clearCopyToast,1600);
      }
      function syncHeader(){
        add.hidden=active!=='notes'||listing.hidden;
        noteBar.hidden=active!=='notes'||!listing.hidden;actions.hidden=viewer.hidden;
        manualCopy.hidden=noteBar.hidden||viewer.hidden;
        if(manualCopy.hidden)clearCopyToast();
        labelButton(back,editing&&editReturn?'返回笔记详情':'返回笔记列表');
      }
      function showNoteScreen(screen){
        listing.hidden=screen!=='list';viewer.hidden=screen!=='view';compose.hidden=screen!=='edit';
        if(screen!=='view'){
          if(deletePrompt.open)deletePrompt.close();
          manualCopy.replaceChildren();
        }
        syncHeader();
      }
      const newNote=()=>{
        if(description.objects.length>grammar.MAX_PLACES){feedback('所选超过 '+grammar.MAX_PLACES+' 处，请减少后再写笔记。');return;}
        startEditing(description,idForNew());
      };
      add.addEventListener('click',()=>{
        if(add.hidden)return;
        if(model)newNote();else open(description.objects,add,'write');
      });
      function listNotes(){
        if(editing||viewing||active!=='notes')return;
        const matches=model?.query(description.objects)||[],frag=doc.createDocumentFragment();
        if(!model){frag.append(make('p','study-notes__empty','登录后可查看自己的云端笔记。'));listing.replaceChildren(frag);return;}
        const focusedId=doc.activeElement?.dataset.noteId;
        if(!matches.length)frag.append(make('p','study-notes__empty','所选经文还没有笔记。'));
        for(const item of matches){
          const article=make('article','study-notes__item'),openNote=button('','study-notes__open');
          const excerpt=item.text.trim().replace(/\s+/g,' '),name=excerpt.length>60?excerpt.slice(0,60)+'…':excerpt;
          openNote.dataset.noteId=item.id;openNote.setAttribute('aria-label','查看笔记：'+name+'，'+item.label);
          openNote.addEventListener('click',()=>startViewing(item.id));
          openNote.append(make('span','study-notes__text',item.text),make('span','study-notes__address',item.label));
          article.append(openNote);frag.append(article);
        }
        listing.replaceChildren(frag);
        if(focusedId)(noteButton(focusedId)||add).focus({preventScroll:true});
      }
      function passage(anchor){
        const card=make('div','study-notes__passage'),book=scripture.index(anchor.code);
        const cross=anchor.endCh>anchor.ch;
        card.append(make('h4','study-notes__passage-title',grammar.label(book?.book.name||anchor.code,anchor)));
        let hasText=false;
        for(const {ch,rows} of passageRows(anchor,scripture,parser)){
          if(!rows.length)continue;
          hasText=true;
          if(cross)card.append(make('h5','study-notes__passage-chapter','第 '+ch+' 章'));
          let p;
          for(const row of rows){
            if(!p||row.paragraph||row.titles.length){p=make('p','compare-slip__paragraph');card.append(p);}
            else p.append(doc.createTextNode(' '));
            const verse=make('span');verse.dataset.noteVerse=row.id;
            verse.append(make('sup','compare-slip__ref',row.lo===row.hi?String(row.lo):row.lo+'–'+row.hi),doc.createTextNode(row.text));
            p.append(verse);
          }
        }
        if(!hasText)card.append(make('p','study-notes__empty','未找到此处经文。'));
        return card;
      }
      function paintViewing(){
        const desc=currentDescriptor(viewing),body=model.body(viewing),{text,warn,removing,pending}=model.status(viewing);
        const content=body.trim()?body:'这条笔记还没有正文。';
        if(viewBody.textContent!==content)viewBody.textContent=content;
        const warning=warn||removing?text:'';
        if(viewStatus.textContent!==warning)viewStatus.textContent=warning;
        const key=desc?.key||'';
        if(renderedRefs!==key){
          renderedRefs=key;passages.replaceChildren(...(desc?.objects||[]).map(passage));references.hidden=!key;
        }
        edit.disabled=!key||!!removing;copy.disabled=!key;
        trash.disabled=!key||!body.trim()||!!pending;
        trash.title=pending?'同步完成后可删除':'删除笔记';
      }
      function startViewing(id,top=0,focus=viewTitle){
        if(profile!==scope())return;
        if(!editing&&!viewing)listTop=scroll.scrollTop;
        editing=null;editReturn=null;refEditor.reset();viewing=id;
        paintViewing();showNoteScreen('view');scroll.scrollTop=top;
        focus.focus({preventScroll:true});
      }
      function show(key){
        if(active===key)return;
        if(active)parts[active].top=scroll.scrollTop;
        if(key!=='notes')refEditor.suspend();
        active=key;
        syncHeader();
        for(const [id,{button,panel}] of Object.entries(parts)){
          button.setAttribute('aria-selected',String(key===id));button.tabIndex=key===id?0:-1;panel.hidden=key!==id;
        }
        if(key==='notes')listNotes();
        else if(!qaRendered){qaRendered=true;renderQA(parts.qa.panel,description.objects);}
        scroll.scrollTop=parts[key].top;
      }
      const swipeEvents=new win.AbortController(),signal=swipeEvents.signal;
      let swipe=null,ignoreTabClick=false;
      const tabTarget=target=>!!target.closest?.('.study-material__tabs');
      function travel(event){
        const x=event.clientX-swipe.x,y=event.clientY-swipe.y;
        if(!swipe.horizontal&&Math.hypot(x,y)>=13){
          if(Math.abs(x)<Math.abs(y)*1.35||win.performance.now()-swipe.time>420){swipe=null;return null;}
          swipe.horizontal=true;
        }
        return {x,y};
      }
      doc.addEventListener('pointerdown',event=>{
        ignoreTabClick=false;
        if(swipe&&event.pointerId!==swipe.id)swipe=null;
      },{capture:true,passive:true,signal});
      scroll.addEventListener('pointerdown',event=>{
        const target=event.target;
        if(event.pointerType!=='touch'||!event.isPrimary||!active||
          (!tabTarget(target)&&target.closest?.('button:not(.study-notes__open),[role=button],a,textarea,input,select,[contenteditable]')))return;
        swipe={id:event.pointerId,x:event.clientX,y:event.clientY,time:win.performance.now(),from:active,horizontal:false};
      },{passive:true,signal});
      scroll.addEventListener('pointermove',event=>{
        if(swipe?.id===event.pointerId)travel(event);
      },{passive:true,signal});
      scroll.addEventListener('pointerup',event=>{
        if(swipe?.id!==event.pointerId)return;
        const start=swipe,offset=travel(event);
        swipe=null;
        if(!offset||active!==start.from||Math.abs(offset.x)<48||Math.abs(offset.x)<Math.abs(offset.y)*1.5)return;
        const next=offset.x<0?'qa':'notes';
        ignoreTabClick=true;
        if(next===active)return;
        const focus=scroll.contains(doc.activeElement)&&doc.activeElement!==scroll;
        show(next);
        if(focus)parts[next].button.focus({preventScroll:true});
      },{passive:true,signal});
      scroll.addEventListener('pointercancel',event=>{if(swipe?.id===event.pointerId)swipe=null;},{passive:true,signal});
      scroll.addEventListener('click',event=>{
        if(!ignoreTabClick||!event.detail)return;
        // Suppress only a compatibility click from this swipe; a new pointer
        // down (including a quick next tap) already cleared the flag.
        ignoreTabClick=false;event.preventDefault();event.stopPropagation();
      },{capture:true,signal});
      function statusText(){
        if(!editing)return;
        const {text,warn}=model.status(editing.noteId);
        status.dataset.unsaved=warn?'true':'false';if(status.textContent!==text)status.textContent=text;
      }
      function startEditing(desc,id,fromView=false){
        if(profile!==scope())return;
        if(!editing&&!viewing&&active==='notes')listTop=scroll.scrollTop;
        editReturn=fromView?{id,top:scroll.scrollTop}:null;
        viewing=null;editing={...desc,noteId:id};showNoteScreen('edit');
        refEditor.reset();composing=false;field.value=seenText=model.body(id);statusText();
        refEditor.setRefs(desc.objects);
        show('notes');
        scroll.scrollTop=0;
        field.focus({preventScroll:true});field.setSelectionRange(field.value.length,field.value.length);
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
      function returnToList(){
        const id=viewing;
        editing=null;viewing=null;editReturn=null;refEditor.reset();showNoteScreen('list');listNotes();
        if(active==='notes')scroll.scrollTop=listTop;else parts.notes.top=listTop;
        if(active==='notes')(noteButton(id)||parts.notes.button).focus({preventScroll:true});
      }
      edit.addEventListener('click',()=>{const desc=currentDescriptor(viewing);if(desc?.key)startEditing(desc,viewing,true);});
      back.addEventListener('click',()=>{
        if(editReturn)startViewing(editReturn.id,editReturn.top,edit);
        else returnToList();
      });
      copy.addEventListener('click',async()=>{
        if(!viewing||profile!==scope())return;
        const id=viewing,desc=currentDescriptor(id),tools=win.PaperTextSelection;
        if(!desc?.key)return;
        manualCopy.replaceChildren();
        const payload=formatNoteCopy(model.body(id),desc.objects,{scripture,parser,maxPlaces:grammar.MAX_PLACES,
          label:ref=>grammar.label(scripture.index(ref.code)?.book.name||ref.code,ref)});
        const ok=await writeNoteClipboard(win,tools,payload);
        if(signal.aborted||!viewer.isConnected||active!=='notes'||viewing!==id||profile!==scope())return;
        if(ok||tools.fallbackCopy(doc,manualCopy,payload.text))showCopyToast();
        else{clearCopyToast();feedback('浏览器未允许自动复制，可手动复制已选文字');}
      });
      trash.addEventListener('click',()=>{
        if(!viewing||profile!==scope()||deletePrompt.open)return;
        const desc=currentDescriptor(viewing);if(!desc?.key)return;
        deleteTarget={desc:{...desc,noteId:viewing},body:model.body(viewing)};deletePrompt.showModal();
      });
      cancelDelete.addEventListener('click',()=>deletePrompt.close());
      deletePrompt.addEventListener('close',()=>{if(!deletePrompt.open)deleteTarget=null;});
      confirmDelete.addEventListener('click',()=>{
        const target=deleteTarget;deleteTarget=null;deletePrompt.close();
        if(!target||viewing!==target.desc.noteId||profile!==scope())return;
        if(!model.remove(target.desc,target.body,viewer))feedback('笔记已变更或仍在同步，请稍后重试。');
      });
      const off=model?.listen((key,source)=>{
        if(key&&(key===viewing||key===editing?.noteId)&&source==='removed'){
          returnToList();feedback('笔记已删除');return;
        }
        if(editing&&key===editing.noteId){
          const latest=model.descriptor(key);
          if(latest){editing=latest;refEditor.setRefs(latest.objects);}
          if(source==='cloud'&&!composing){
            const a=field.selectionStart,z=field.selectionEnd;
            field.value=seenText=model.body(key);field.setSelectionRange(a,z);
          }
          statusText();
        }else if(viewing){if(key==null||key===viewing){
          if(source==='cloud'&&!model.body(viewing).trim()&&!model.get(viewing))returnToList();
          else paintViewing();
        }}
        else listNotes();
      });
      showNoteScreen('list');
      const request=mode=>{
        // A scripture address is a shared association, never a note identity.
        if(mode==='write')newNote();
        else if(mode==='chapter-notes'||mode==='chapter-qa'){
          if(editing||viewing)returnToList();
          show(mode==='chapter-notes'?'notes':'qa');
        }
        else if(!active)show(availability.hasAny(description.objects)?'qa':'notes');
        else if(editing)returnToList();
      };
      request(initial);
      return {request,dispose(){if(deletePrompt.open)deletePrompt.close();clearCopyToast();swipeEvents.abort();refEditor.dispose();off?.();}};
    }
    function open(next,restore,mode='view'){
      // A contiguous reader selection starts as one range; only addresses
      // confirmed individually inside a note stay separate.
      const selection=describeSelection(next,paper.books),{objects,key,title,fullTitle}=selection,model=notes(),profile=scope();
      if(!key||mode==='write'&&!notesEnabled||mode!=='write'&&!availability.hasAny(objects)&&!model?.query(objects).length)return false;
      if(mode==='write'&&objects.length>grammar.MAX_PLACES){feedback('所选超过 '+grammar.MAX_PLACES+' 处，请减少后再写笔记。');return false;}
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
    function openChapterBadge(badge,clientY){
      if(!badge?.isConnected||!stage.contains(badge))return false;
      const {book,chapter}=badge.dataset;
      const rows=[...badge.querySelectorAll('[data-chapter-count]')];
      const distance=el=>{const r=el.getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-clientY);};
      const row=Number.isFinite(clientY)?rows.reduce((best,el)=>!best||distance(el)<distance(best)?el:best,null):rows[0];
      return open([{code:book,ch:+chapter}],badge,row?.dataset.chapterCount==='notes'?'chapter-notes':'chapter-qa');
    }

    function noteMarksFor(node,model,keys){
      const old=marked.get(node);
      if(old?.epoch===noteEpoch)return null;
      const chapters=old?.chapters??keys(),starts=new Map(chapters.map(([code,ch])=>[addr(code,ch),cuesFor(model,code,ch)]));
      const signature=[...starts.values()].map(list=>list.join(',')).join('|');
      marked.set(node,{epoch:noteEpoch,signature,chapters});
      return old?.signature===signature?null:starts;
    }
    const includesStart=(starts,code,{ch,lo,hi})=>starts.get(addr(code,ch))?.some(v=>v>=lo&&v<=hi);
    function markPaper(svg,model){
      const pageIndex=Number(svg.dataset.pdf),face=paper.pages[pageIndex],book=paper.books[face?.b];
      if(!book)return;
      const starts=noteMarksFor(svg,model,()=>[...new Set([...svg.querySelectorAll('text[data-ref]')]
        .map(el=>parse(el.dataset.ref)?.ch).filter(Boolean))].map(ch=>[book.code,ch]));
      if(!starts)return;
      // A restored curl face can already contain a snapshot of its cue layer.
      svg.querySelector('[data-qap-paper-cues]')?.remove();
      const layer=doc.createElementNS(SVG,'g');
      layer.setAttribute('data-qap-paper-cues','');layer.setAttribute('aria-hidden','true');layer.setAttribute('pointer-events','none');
      let layout;
      function cue(el,kind,qa=true){
        const type=qa?'qap':'note';el.setAttribute('data-'+type+'-mark',kind);
        layout??=win.PaperPage.commands(face,pageIndex,paper.books);
        const index=el.dataset.physicalIdx,box=paperCueLine(index===undefined?null:layout[index],layout);
        if(!box)return;
        const line=doc.createElementNS(SVG,'line');
        for(const [key,value] of Object.entries({x1:box.x1,x2:box.x2,y1:box.y,y2:box.y,
          ['data-'+type+'-cue']:kind,['data-'+type+'-ref']:el.dataset.ref,['data-'+type+'-ink']:index}))line.setAttribute(key,value);
        layer.append(line);
      }
      function verseCue(el,v){
        const qa=availability.hasStart(book.code,v.ch,v.lo,v.hi);
        if(!qa&&!includesStart(starts,book.code,v))return false;
        cue(el,'verse',qa);return true;
      }
      const markedVerses=new Set(),ink=new Map();
      for(const el of svg.querySelectorAll('text[data-ref]')){
        const {role,ref}=el.dataset,v=parse(ref);
        if(!v)continue;
        el.removeAttribute('data-qap-mark');el.removeAttribute('data-note-mark');
        const ch=chapterOf(role,ref);
        if(ch&&availability.has(book.code,ch))cue(el,'chapter');
        if(role==='verse'&&verseCue(el,v))markedVerses.add(ref);
        if(role==='body'&&!ink.has(ref))ink.set(ref,[el,v]);
      }
      // The first verse and a split verse may have no separate printed number
      // on this face. In that case underline only the first visible ink run.
      for(const [ref,[el,v]] of ink){
        if(!markedVerses.has(ref))verseCue(el,v);
      }
      if(layer.childElementCount)svg.append(layer);
    }
    function markChunk(chunk,model){
      const chapter=chunk.querySelector('[data-study-chapter]');
      if(chapter){
        const [b,c]=chapter.dataset.studyChapter.split('.');
        if(availability.has(b,+c))chapter.dataset.qapMark='chapter';
      }
      const starts=noteMarksFor(chunk,model,()=>{
        if(!chapter)return [];
        const [code,ch]=chapter.dataset.studyChapter.split('.');return [[code,+ch]];
      });
      if(!starts)return;
      for(const el of chunk.querySelectorAll('[data-verse-id]')){
        const b=el.dataset.verseId.split('.')[0],v=parse(el.dataset.ref),marker=el.querySelector('sup');
        if(!v||!marker)continue;
        const qa=availability.hasStart(b,v.ch,v.lo,v.hi);
        if(qa)marker.dataset.qapMark='verse';else marker.removeAttribute('data-qap-mark');
        if(!qa&&includesStart(starts,b,v))marker.dataset.noteMark='verse';else marker.removeAttribute('data-note-mark');
      }
    }
    const chapterIcons={qa:'M1 1.1h6v4.3H4L2.15 7V5.4H1z M3.35 2.65a.68.68 0 1 1 1.1.55c-.34.22-.45.34-.45.61 M4 4.65h.01',
      notes:'M1.6 .9h3.5l1.5 1.5V7h-5z M4.9 1v1.7h1.6 M2.8 4.05h2.65m-2.65 1.4h2.65'};
    function badgeNode(tag,attrs={}){
      const el=doc.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
      return el;
    }
    function countPaper(svg,model){
      let state=countedFaces.get(svg);
      if(!state){
        // A restored leaf can have been serialized with the old account's counts.
        svg.querySelector('[data-chapter-counts]')?.remove();
        const pageIndex=Number(svg.dataset.pdf),face=paper.pages[pageIndex],book=paper.books[face?.b];
        const chapters=[...svg.querySelectorAll('text[data-role="chapter"][data-ref]')];
        const ink=book&&chapters.length?win.PaperPage.commands(face,pageIndex,paper.books):[];
        const anchors=book?chapters.flatMap(el=>{
          const ch=chapterOf('chapter',el.dataset.ref),anchor=ink[el.dataset.physicalIdx];
          return ch&&anchor?[{anchor,ch,questions:availability.chapterCount(book.code,ch),stamp:null,group:null}]:[];
        }):[];
        state={book,ink,anchors,layer:badgeNode('g',{'data-chapter-counts':''})};countedFaces.set(svg,state);
      }
      const {book,ink,anchors,layer}=state;
      for(const entry of anchors){
        const {ch,questions,anchor}=entry,notes=model?.ready()?model.query([{code:book.code,ch}]).length:0;
        const stamp=questions+':'+notes;if(stamp===entry.stamp)continue;
        entry.stamp=stamp;
        const counts=[['qa',questions,'公开问答'],['notes',notes,'私人笔记']].filter(([,total])=>total>0);
        const box=counts.length&&chapterCountBox(anchor,ink,counts.length,Math.max(...counts.map(([,total])=>String(total).length)));
        if(!box){
          if(entry.group===doc.activeElement&&entry.group)stage.focus({preventScroll:true});
          entry.group?.remove();entry.group=null;continue;
        }
        const {x,y,size,hit}=box,group=entry.group??=badgeNode('g',{role:'button',tabindex:0,
          'data-chapter-total':addr(book.code,ch),'data-book':book.code,'data-chapter':ch});
        const target=badgeNode('rect',{...hit,rx:2,'data-chapter-badge-hit':'','aria-hidden':'true'});
        group.setAttribute('aria-label',`查看${book.name}第 ${ch} 章资料，`+counts.map(([,total,label])=>label+' '+total+' 条').join('，'));
        group.replaceChildren(target,...counts.map(([kind,total],i)=>{
          const top=y+i*size*1.14,value=String(total),mark=badgeNode('g',{'aria-hidden':'true'});
          const d=badgeNode('path',{d:chapterIcons[kind],transform:`translate(${x} ${top}) scale(${size/8})`});
          const number=badgeNode('text',{x:x+size*1.1,y:top+size*.83,'font-size':size,'data-chapter-count':kind});
          if(value.length>3){number.setAttribute('textLength',size*1.68);number.setAttribute('lengthAdjust','spacingAndGlyphs');}
          number.textContent=value;mark.append(d,number);return mark;
        }));
        if(group.parentNode!==layer)layer.append(group);
      }
      if(!layer.childElementCount)layer.remove();else if(layer.parentNode!==svg)svg.append(layer);
    }
    function scheduleCounts(){
      if(countFrame!=null)return;
      countFrame=win.requestAnimationFrame(()=>{
        countFrame=null;const model=notes();
        for(const svg of stage.querySelectorAll('.paper svg[data-pdf]'))countPaper(svg,model);
      });
    }
    function scheduleMarks(){
      if(!marking||frame!==null)return;
      frame=win.requestAnimationFrame(()=>{
        frame=null;if(!marking)return;
        const model=notes();
        for(const svg of stage.querySelectorAll('.paper svg[data-pdf]'))markPaper(svg,model);
        for(const chunk of doc.querySelectorAll('.compare-slip__chunk'))markChunk(chunk,model);
      });
    }
    function setMarking(value,{persist=false}={}){
      marking=value;root.toggleAttribute('data-study-marks',value);
      if(frame!==null){win.cancelAnimationFrame(frame);frame=null;}
      pref.checked=value;
      if(persist)try{win.localStorage.setItem(KEY,value?'1':'0');}catch{}
      observer??=new win.MutationObserver(()=>{scheduleMarks();scheduleCounts();});
      observer.observe(stage.parentElement,{childList:true,subtree:true});
      scheduleMarks();scheduleCounts();
    }
    pref.addEventListener('change',()=>setMarking(pref.checked,{persist:true}));
    win.addEventListener('storage',e=>{if(e.key===KEY||e.key===null)setMarking(e.newValue!=='0');});
    let markPreference=null;try{markPreference=win.localStorage.getItem(KEY);}catch{}
    setMarking(markPreference!=='0');
    return {open,openChapterBadge,notesEnabled,hasAny:objects=>availability.hasAny(objects)||!!notes()?.query(objects).length,
      openSettings(){if(!settings.open)settings.showModal();}};
  }
  return {buildAvailability,createAvailability,createReferenceIndex,createIndex,chapterOf,paperCueLine,chapterCountBox,describeSelection,noteStarts,formatNoteCopy,mount};
});
