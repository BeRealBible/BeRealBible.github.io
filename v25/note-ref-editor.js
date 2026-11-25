/* Live address lookup, with the shared search slip for full-text search. */
(function(win){
  'use strict';
  win.V25NoteRefEditor=({doc,parser,books,editable,spansEnabled,preview,closePreview,openSearch,closeSearch,excerpt,browse,change})=>{
    const {key,label,covers,MAX_PLACES,allowsPlaces,ending,bindCompletion}=win.V25NoteRefs,names=new Map(books.map(b=>[b.code,b]));
    const limitText='每条笔记最多关联 '+MAX_PLACES+' 处经文';
    const title=(ref,short=false)=>label(names.get(ref.code)?.[short?'short':'name']||ref.code,ref);
    const make=(tag,cls,text)=>{
      const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;
    };
    const setLabel=(el,text)=>{el.setAttribute('aria-label',text);el.title=text;};
    const button=(text,cls,aria)=>{
      const el=make('button',cls,text);el.type='button';if(aria)setLabel(el,aria);return el;
    };
    const icon=(el,path)=>{
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),ink=doc.createElementNS(svg.namespaceURI,'path');
      svg.setAttribute('aria-hidden','true');svg.setAttribute('viewBox','0 0 24 24');ink.setAttribute('d',path);
      svg.append(ink);el.append(svg);
    };
    const root=make('section','study-notes__anchors'),head=make('div','study-notes__anchor-head');
    root.setAttribute('aria-label','关联经文');
    const plus=button('','study-notes__link study-notes__search-toggle','添加关联经文');
    icon(plus,'M12 5v14M5 12h14');
    const chips=make('div','study-notes__chips'),chooser=make('div','study-notes__search');
    const nonce='note-ref-'+win.crypto.randomUUID();chooser.id=nonce;
    chooser.hidden=true;plus.setAttribute('aria-controls',nonce);plus.setAttribute('aria-expanded','false');
    const tally=make('span','study-notes__tally');
    head.append(make('strong','','关联经文'),tally);root.append(head,chips,chooser);

    const field=make('div','study-notes__lookup'),input=make('textarea','study-notes__ref-input');
    input.rows=1;input.wrap='off';input.maxLength=24000;input.spellcheck=false;input.autocomplete='off';
    field.append(input);
    const paintCompletion=bindCompletion(input,parser.completion,{tapAfter:true});
    const feedback=make('p','study-notes__ref-feedback'),chipFeedback=make('p','study-notes__ref-feedback');
    feedback.id=nonce+'-feedback';
    for(const el of [feedback,chipFeedback])el.setAttribute('aria-live','polite');
    const status=make('p','study-notes__search-status');status.setAttribute('aria-live','polite');
    const output=make('div'),context=make('div','study-notes__browse-context'),special=make('div','study-notes__special'),
      results=make('div','study-notes__results'),more=button('更多结果','study-notes__link');
    results.setAttribute('role','region');results.setAttribute('aria-label','可选经文');
    output.setAttribute('role','group');output.setAttribute('aria-label','关联搜索结果');
    output.append(status,context,special,results,more);
    const footer=make('div','study-notes__pick-footer'),chosen=button('','study-notes__pick-count'),
      done=button('确定','study-notes__pick-confirm'),pickedList=make('div','study-notes__picked'),
      limit=make('span','study-notes__pick-limit',limitText);
    limit.hidden=true;limit.setAttribute('role','status');
    pickedList.id=nonce+'-picked';pickedList.hidden=true;
    chosen.setAttribute('aria-controls',pickedList.id);chosen.setAttribute('aria-expanded','false');
    chosen.setAttribute('aria-live','polite');
    footer.append(chosen,limit,done);footer.hidden=true;
    input.setAttribute('aria-describedby',feedback.id);
    chooser.append(field,feedback,output,pickedList,footer);root.append(chipFeedback);

    let refs=[],shown='',editing=null,restore=null,pasted=false,composing=false,idle=0,entered=false,
      matches=[],rendered=[],listed=0,browseTarget=null,pending=[];
    const browseStream=win.V25AddressStream.create({viewport:results,renderVerse:rowOption,onExtend:decorateResults});
    function message(text='',error=false){
      for(const el of [feedback,chipFeedback]){
        const active=el===(chooser.hidden?chipFeedback:feedback)&&!!text;
        el.textContent=active?text:'';el.toggleAttribute('data-error',active&&error);
      }
      if(error)input.setAttribute('aria-invalid','true');
      else input.removeAttribute('aria-invalid');
    }
    function clearResults(){
      matches=[];rendered=[];listed=0;browseTarget=null;browseStream.clear();context.replaceChildren();special.replaceChildren();
      results.replaceChildren();results.removeAttribute('data-browse');results.scrollTop=0;more.hidden=true;status.textContent='';refreshFooter();
    }
    function clearIdle(){win.clearTimeout(idle);idle=0;}
    function armIdle(){
      clearIdle();
      if(chooser.hidden||editing||entered||composing||pending.length)return;
      idle=win.setTimeout(()=>{
        idle=0;
        if(!chooser.hidden&&!entered&&!composing&&!input.value&&!pending.length)close(chooser.contains(doc.activeElement));
      },5000);
    }
    chooser.addEventListener('pointerdown',armIdle,{passive:true});
    chooser.addEventListener('keydown',armIdle,true);
    function freshTargets(rows){
      return parser.mergeSelection(rows.filter(row=>!refs.some(ref=>covers(ref,row))),{crossChapter:spansEnabled})
        .map(({code,ch,lo,hi,endCh})=>endCh?{code,ch,lo,hi,endCh}:{code,ch,lo,hi});
    }
    function search(){
      const query=input.value.trim();if(!query)return;
      if(refs.length>=MAX_PLACES){message(limitText,true);return;}
      clearIdle();entered=true;
      input.blur();closePreview(root);
      openSearch({owner:root,anchor:input,query,addAddress,picker:{
        has:row=>refs.some(ref=>covers(ref,row)),
        review(rows){
          const count=freshTargets(rows).length;
          return {count,error:allowsPlaces(refs.length+count,refs.length)?'':limitText};
        },
        confirm(rows){
          if(!root.isConnected||chooser.hidden||editing)return false;
          const added=freshTargets(rows);
          if(!added.length||!apply([...refs,...added]))return false;
          pending=pending.filter(ref=>!refs.some(other=>covers(other,ref)));updatePicks();
          return true;
        }
      }});
    }
    function previewButton(text,ref,cls,aria){
      const el=button(text,'scripture-cite '+cls,aria);
      el.setAttribute('aria-expanded','false');
      el.onclick=()=>preview({locations:parser.locations(ref)},{anchor:el});
      return el;
    }
    function setRefs(next){
      const stamp=next.map(key).join('|');if(stamp===shown)return;
      refs=next;shown=stamp;closePreview(chips);
      chips.replaceChildren(...refs.map(ref=>{
        const chip=make('span','study-notes__chip'),name=title(ref);
        chip.append(previewButton(title(ref,true),ref,'study-notes__ref-link','查看关联经文：'+name));
        if(editable){
          const modify=button('','study-notes__chip-control','修改关联：'+name);
          icon(modify,'m4 16-.5 4.5L8 20 19 9l-4-4L4 16Zm9-9 4 4');
          modify.onclick=()=>open(ref,modify);
          const remove=button('×','study-notes__chip-control','移除关联：'+name);
          if(refs.length===1){remove.setAttribute('aria-disabled','true');remove.title='至少保留一处关联经文';}
          remove.onclick=()=>{
            if(refs.length<=1)return;
            const at=refs.findIndex(item=>key(item)===key(ref));if(at<0)return;
            if(!apply(refs.filter((_,i)=>i!==at)))return;
            if(editing===key(ref))close();
            (chips.children[at]||chips.lastElementChild)?.firstElementChild.focus({preventScroll:true});
          };
          chip.append(modify,remove);
        }
        return chip;
      }));
      chips.append(plus);
      tally.textContent=refs.length+' / '+MAX_PLACES;
      tally.title=limitText;
      plus.toggleAttribute('data-at-limit',refs.length>=MAX_PLACES);
      updatePicks();
    }
    function apply(next){
      if(!editable||!next.length)return false;
      if(!allowsPlaces(next.length,refs.length)){message(limitText,true);return false;}
      if(!spansEnabled&&next.some(ref=>ref.endCh>ref.ch)){message('此版本的账号服务还不支持保存跨章关联。',true);return false;}
      if(!change(next)){message('未能更改关联。请检查同步状态，或缩小经文范围。',true);return false;}
      return true;
    }
    function decorateResults(){
      const existing=refs.filter(ref=>key(ref)!==editing),selectedBy=[...existing,...pending];
      for(const {anchors,el,name} of rendered){
        const used=anchors.every(ref=>existing.some(other=>covers(other,ref)));
        const selected=anchors.every(ref=>selectedBy.some(other=>covers(other,ref)));
        el.setAttribute('aria-pressed',String(selected));el.setAttribute('aria-disabled',String(used));
        el.setAttribute('aria-label',(used?'已关联：':'选择：')+name);
        if(el.classList.contains('study-notes__verse'))el.toggleAttribute('data-selected-verse',selected&&!used);
      }
    }
    function refreshFooter(){
      const count=pending.length;
      footer.hidden=chooser.hidden||(!count&&(output.hidden||!rendered.length));
      chosen.textContent=count?'已选 '+count+' 处':editing?'选一处经文':'轻点经文可多选';
      const next=refs.length-(editing?1:0)+count,over=count&&!allowsPlaces(next,refs.length);
      limit.hidden=!over;chosen.disabled=!count;done.disabled=!count||over;
      if(!count)pickedList.hidden=true;
      chosen.setAttribute('aria-expanded',String(!pickedList.hidden));
    }
    function updatePicks(){
      decorateResults();refreshFooter();
      if(pickedList.hidden)return;
      pickedList.replaceChildren(...pending.map(ref=>{
        const remove=button(title(ref,true)+' ×','study-notes__picked-item','取消选中：'+title(ref));
        remove.onclick=()=>{pending=pending.filter(other=>key(other)!==key(ref));updatePicks();(pending.length?chosen:input).focus({preventScroll:true});};
        return remove;
      }));
    }
    chosen.onclick=()=>{pickedList.hidden=!pickedList.hidden;updatePicks();};
    function stagePicks(anchors,toggle=false){
      if(editing&&anchors.length!==1){message('一次只能替换一处关联经文。',true);return;}
      const existing=refs.filter(ref=>key(ref)!==editing);
      const candidates=anchors.filter(ref=>!existing.some(other=>covers(other,ref)));
      if(!candidates.length){message('这处经文已关联。');return;}
      if(toggle&&candidates.every(ref=>pending.some(other=>covers(other,ref)))){
        for(const ref of candidates)pending=pending.flatMap(other=>parser.subtractSelection(other,ref));
      }else{
        pending=editing?candidates:parser.mergeSelection([...pending,...candidates],{crossChapter:spansEnabled});
      }
      message();updatePicks();
    }
    function confirm(){
      if(!pending.length)return;
      if(editing&&!refs.some(ref=>key(ref)===editing)){
        message('原关联已变更，请重新选择要修改的经文。',true);return;
      }
      const base=refs.filter(ref=>key(ref)!==editing),added=pending.filter(ref=>!base.some(other=>covers(other,ref)));
      if(!added.length){message('这些经文已关联。',true);return;}
      if(apply([...base,...added]))close(true);
    }
    done.onclick=confirm;
    const parsed=()=>parser.parse(input.value,{pasted});
    const suggested=()=>parser.locateOne(input.value,{pasted,editing:!!editing});
    function unique(found){
      return found.length===1&&!found[0].partial?found[0].anchors[0]:null;
    }
    function addAddress(ref){
      if(!root.isConnected||chooser.hidden||editing)return '笔记关联窗口已收起。';
      if(refs.some(other=>covers(other,ref)))return '这处经文已关联。';
      if(!apply([...refs,ref]))return feedback.textContent||'未能更改关联。';
      pending=pending.filter(candidate=>!refs.some(other=>covers(other,candidate)));
      input.value='';pasted=false;clearResults();updatePicks();message();paintCompletion();
      return '';
    }
    // A malformed address should not quietly become a text search. Ordinary
    // keywords (including ones ending in punctuation) still use text lookup.
    function looksLikeAddress(text){
      const value=text.normalize('NFKC');
      return /[0-9〇零一二两三四五六七八九十百]\s*(?::|[章篇节])/u.test(value)||
        (/^[\p{L}\s《〈]{1,22}\d{1,3}\s*$/u.test(value)&&!/[\n\r]/u.test(value));
    }
    function showInvalid(){
      const raw=input.value.trim().replace(ending,'');
      message(raw.length>160?'没有识别到出处，请补写书卷和章节。':
        /^\d{1,3}\s*[:：]/u.test(raw.normalize('NFKC'))?'请在地址前写上书名。':
        parser.inspect(raw).error,true);
    }
    function bindOption(el,anchors){
      const name=anchors.length===1?title(anchors[0]):anchors.length+' 处经文';
      el.onclick=()=>{if(el.getAttribute('aria-disabled')!=='true')stagePicks(anchors,true);};
      rendered.push({anchors,el,name});
      return name;
    }
    function option({anchors,text,shortcut}){
      const el=button('',shortcut?'study-notes__address-option':'study-notes__result');
      const name=bindOption(el,anchors);
      const copy=make('span','study-notes__result-text');
      copy.append(make('strong','study-notes__result-ref',shortcut==='chapter'?'整章':name));
      if(text)copy.append(make('span','study-notes__result-excerpt',text));
      el.append(copy);
      return el;
    }
    function rowOption(row,current=false){
      const {code,ch,lo,hi}=row;
      const target=browseTarget,anchor=current&&target?.lo===target?.hi&&target?.lo!=null?target:{code,ch,lo,hi};
      // A native button is an atomic inline box. Use an inline, keyboard-
      // accessible control so a verse can wrap and the next one flows on.
      const el=make('span','study-notes__verse'),num=make('sup','compare-slip__ref',lo===hi?String(lo):lo+'–'+hi);
      el.setAttribute('role','button');el.tabIndex=0;
      el.setAttribute('aria-description',row.text);el.dataset.ref=row.ref;
      el.toggleAttribute('data-current',current);
      num.setAttribute('aria-hidden','true');el.append(num,doc.createTextNode(row.text));
      bindOption(el,[anchor]);
      el.onkeydown=e=>{
        if(e.key!=='Enter'&&e.key!==' ')return;
        e.preventDefault();if(!e.repeat)el.click();
      };
      return el;
    }
    function appendResults(){
      for(const item of matches.slice(listed,listed+10)){
        results.append(option(item));listed++;
      }
      more.hidden=listed>=matches.length;updatePicks();
    }
    function startBrowse(anchor,chapter){
      const book=browse(anchor);
      if(!book?.rows.length||!Number.isInteger(book.at))return false;
      // Scroll to the line of the located verse while keeping its real
      // paragraph (and earlier ones) intact above that line.
      const range=anchor.lo!=null&&(anchor.hi!==anchor.lo||anchor.endCh>anchor.ch);
      browseTarget=range?null:anchor;
      if(chapter||anchor.lo==null)context.append(option({anchors:[chapter||anchor],shortcut:'chapter'}));
      if(range)special.append(option({anchors:[anchor],shortcut:'range'}));
      results.setAttribute('data-browse','');browseStream.start(book.rows,book.at);browseStream.layout();
      updatePicks();return true;
    }
    function run(){
      if(chooser.hidden||composing)return;
      clearResults();
      const raw=input.value.trim();if(!raw)return;
      const found=suggested(),only=unique(found)?found[0]:null;
      if(only&&startBrowse(only.anchors[0],only.chapter)){
        if(only.anchors[0].endCh>only.anchors[0].ch)status.textContent='经文地址 · 跨章';
        return;
      }
      matches=found.map(({anchors,partial})=>({anchors,partial,
        text:anchors.length===1?excerpt(anchors[0]):anchors.map(ref=>title(ref)).join('；')}));
      if(matches.length)status.textContent=matches.some(row=>row.anchors.some(ref=>ref.endCh>ref.ch))?'经文地址 · 跨章':
        matches.some(row=>row.partial)?'匹配书卷':'';
      appendResults();
    }
    function endInput(punctuation=false){
      const raw=input.value.trim();
      if(!raw)return;
      const found=parsed();
      if(found?.length>1){clearResults();message('请每次输入一处经文地址。',true);return;}
      // The legacy single-address punctuation/replace shortcut stages a
      // choice only; a comma is not a confirmation key in either input.
      if(found?.length===1&&(editing||punctuation||found[0].lo!=null)){run();stagePicks(found);return;}
      const ref=unique(suggested());
      if(ref){run();stagePicks([ref]);return;}
      if(editing||looksLikeAddress(raw.replace(ending,''))||raw.length>160||pasted&&/[\r\n]/u.test(raw)){
        clearResults();showInvalid();return;
      }
      run();
    }
    const isStageEnding=text=>ending.test(text)&&!/,\s*$/u.test(text.normalize('NFKC'));
    function enter(){
      if(editing){endInput();return;}
      const raw=input.value.trim();if(!raw)return;
      const candidates=suggested(),ref=unique(candidates);
      if(ref){
        const error=addAddress(ref);
        if(error)message(error,true);
        return;
      }
      if(parsed()?.length>1){message('请每次输入一处经文地址。',true);return;}
      if(candidates.length){message('请先从候选中选定经文。');return;}
      if(looksLikeAddress(raw.replace(ending,''))||pasted&&raw.length>160){showInvalid();return;}
      search();
    }
    input.addEventListener('paste',()=>{pasted=true;});
    input.addEventListener('input',e=>{
      if(input.value||e.isComposing){entered=true;clearIdle();}
      if(e.isComposing||composing)return;
      if(['insertLineBreak','insertParagraph'].includes(e.inputType)){
        input.value=input.value.replace(/\r?\n$/u,'');paintCompletion();enter();return;
      }
      message();if(!input.value.trim())pasted=false;
      if(e.inputType!=='insertFromPaste'&&e.inputType?.startsWith('insert')&&
        input.selectionEnd===input.value.length&&isStageEnding(e.data||input.value)&&isStageEnding(input.value)){
        endInput(true);return;
      }
      run();
    });
    input.addEventListener('compositionstart',()=>{composing=true;clearIdle();});
    input.addEventListener('compositionend',e=>{
      composing=false;if(input.value){entered=true;clearIdle();}else armIdle();message();
      if(isStageEnding(e.data||'')&&isStageEnding(input.value))endInput(true);else run();
    });
    const submit=e=>{if(e.isComposing||composing||e.keyCode===229)return;e.preventDefault();if(!e.repeat)enter();};
    input.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||e.isComposing||composing||e.keyCode===229)return;
      if(e.shiftKey)e.preventDefault();else submit(e);
    });
    input.addEventListener('beforeinput',e=>{if(['insertLineBreak','insertParagraph'].includes(e.inputType))submit(e);});
    chooser.addEventListener('keydown',e=>{
      if(e.key!=='Escape'||e.isComposing||composing)return;
      e.preventDefault();e.stopPropagation();
      close(true);
    });
    more.onclick=appendResults;
    function close(focus=false){
      clearIdle();closeSearch(root);closePreview(chooser);
      chooser.hidden=true;editing=null;input.value='';pasted=false;composing=false;entered=false;
      paintCompletion();
      pending=[];pickedList.hidden=true;pickedList.replaceChildren();clearResults();message();
      plus.setAttribute('aria-expanded','false');setLabel(plus,'添加关联经文');
      if(focus)(restore?.isConnected?restore:plus).focus({preventScroll:true});
      restore=null;
    }
    function open(ref=null,source=plus){
      clearIdle();entered=false;
      closeSearch(root);
      closePreview(chips);editing=ref?key(ref):null;restore=source;
      pending=[];pickedList.hidden=true;pickedList.replaceChildren();
      input.value=ref?title(ref,true):'';pasted=false;composing=false;chooser.hidden=false;message();
      input.setAttribute('aria-label',ref?'修改关联经文':'经文关键词或地址');
      plus.setAttribute('aria-expanded','true');setLabel(plus,'收起关联选择');
      input.placeholder=ref?'输入新的经文地址':'输入经文坐标或搜索关键词';
      input.setAttribute('enterkeyhint',ref?'done':'search');run();
      if(ref||!win.matchMedia('(pointer:coarse)').matches){
        input.focus({preventScroll:true});if(ref)input.select();
      }else plus.focus({preventScroll:true});
      armIdle();
    }
    plus.onclick=()=>{
      if(!chooser.hidden)close(true);
      else if(refs.length>=MAX_PLACES)message(limitText,true);
      else open();
    };
    function reset(){close();closePreview(chips);}
    plus.hidden=!editable;reset();
    return {root,setRefs,reset,dispose(){reset();paintCompletion.dispose();},suspend(){closeSearch(root);closePreview(root);}};
  };
})(window);
