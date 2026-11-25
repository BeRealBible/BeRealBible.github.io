/* Inline note associations, using the reader's existing verse search and preview. */
(function(win){
  'use strict';
  win.V25NoteRefEditor=({doc,parser,books,editable,preview,closePreview,find,change})=>{
    const {key,label,MAX,ending}=win.V25NoteRefs, names=new Map(books.map(b=>[b.code,b]));
    const title=(ref,short=false)=>label(names.get(ref.code)?.[short?'short':'name']||ref.code,ref);
    const make=(tag,cls,text)=>{
      const node=doc.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
    };
    const button=(text,cls,aria)=>{
      const node=make('button',cls,text);node.type='button';
      if(aria){node.setAttribute('aria-label',aria);node.title=aria;}
      return node;
    };
    const icon=(node,path)=>{
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),ink=doc.createElementNS(svg.namespaceURI,'path');
      svg.setAttribute('aria-hidden','true');svg.setAttribute('viewBox','0 0 24 24');ink.setAttribute('d',path);
      svg.append(ink);node.append(svg);
    };
    const root=make('section','study-notes__anchors'),head=make('div','study-notes__anchor-head');
    root.setAttribute('aria-label','关联经文');head.append(make('strong','','关联经文'));
    const chips=make('div','study-notes__chips'),entry=make('div','study-notes__entry');
    const input=make('textarea','study-notes__ref-input');input.rows=1;input.maxLength=24000;
    input.spellcheck=false;input.autocomplete='off';input.setAttribute('enterkeyhint','done');input.setAttribute('aria-label','输入关联经文');
    const searchButton=button('搜索','study-notes__link study-notes__search-toggle','搜索经文以添加关联');
    icon(searchButton,'m16 16 4 4m-2-9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z');
    searchButton.setAttribute('aria-expanded','false');
    const cancel=button('取消修改','study-notes__link'),help=make('p','study-notes__ref-help','用逗号、分号、句号或回车确认，也可粘贴带出处的经文。');
    const feedback=make('p','study-notes__ref-feedback');feedback.setAttribute('aria-live','polite');
    const hintID='note-ref-'+win.crypto.randomUUID();help.id=hintID;feedback.id=hintID+'-result';
    input.setAttribute('aria-describedby',help.id+' '+feedback.id);
    entry.append(input,cancel);root.append(head,chips,entry,help,feedback);
    const search=make('div','study-notes__search');search.hidden=true;search.id=hintID+'-search';
    searchButton.setAttribute('aria-controls',search.id);head.append(searchButton);
    const form=make('form','study-notes__search-form'),query=make('input','study-notes__search-input');
    query.type='search';query.placeholder='输入关键词或经文位置';query.setAttribute('aria-label','搜索经文内容');
    query.setAttribute('enterkeyhint','search');query.autocomplete='off';query.maxLength=160;
    const searchClose=button('返回','study-notes__link','返回关联经文');
    form.append(query,searchClose);
    const searchStatus=make('p','study-notes__search-status');searchStatus.setAttribute('aria-live','polite');
    const results=make('div','study-notes__results'),more=button('更多结果','study-notes__link');more.hidden=true;
    search.append(form,searchStatus,results,more);root.append(search);
    let refs=[],shown='',editing=null,pasted=false,composing=false,queryComposing=false,timer=0,matches=[],searchButtons=[];
    function message(text='',error=false){
      feedback.textContent=text;feedback.toggleAttribute('data-error',error);
      if(error){input.setAttribute('aria-invalid','true');input.title=text;}
      else{input.removeAttribute('aria-invalid');input.removeAttribute('title');}
    }
    function edit(ref){
      editing=ref?key(ref):null;pasted=false;composing=false;message();
      input.placeholder=ref?'输入新的经文位置':'例如：王上1:15–20';
      input.setAttribute('aria-label',ref?'修改关联经文':'输入关联经文');
      input.value=ref?title(ref,true):'';cancel.hidden=!ref;
    }
    function previewButton(text,ref,cls){
      const name='查看关联经文：'+title(ref);
      const b=button(text,'scripture-cite '+cls,name);b.setAttribute('aria-expanded','false');
      b.onclick=()=>preview({locations:parser.locations(ref)},{anchor:b});
      return b;
    }
    function setRefs(next){
      const stamp=next.map(key).join('|');if(stamp===shown)return;
      refs=next;shown=stamp;
      closePreview(chips);
      chips.replaceChildren(...refs.map(ref=>{
        const chip=make('span','study-notes__chip'),name=title(ref);
        chip.append(previewButton(title(ref,true),ref,'study-notes__ref-link'));
        if(editable){
          const modify=button('','study-notes__chip-control','修改关联：'+name);
          icon(modify,'m4 16-.5 4.5L8 20 19 9l-4-4L4 16Zm9-9 4 4');
          modify.onclick=()=>{closeSearch();edit(ref);input.focus({preventScroll:true});input.select();};
          const remove=button('×','study-notes__chip-control','移除关联：'+name);
          // Keep the locked × discoverable for keyboard and touchscreen users.
          if(refs.length===1){
            remove.setAttribute('aria-disabled','true');remove.title='至少保留一处关联经文';
          }
          remove.onclick=()=>{
            if(refs.length<=1){message('至少保留一处关联经文。');return;}
            const at=refs.findIndex(item=>key(item)===key(ref));if(at<0)return;
            if(!apply(refs.filter((_,i)=>i!==at)))return;
            if(editing===key(ref))edit(null);
            (chips.children[at]||chips.lastElementChild)?.firstElementChild.focus({preventScroll:true});
          };
          chip.append(modify,remove);
        }
        return chip;
      }));
      decorateResults();
    }
    function apply(next){
      if(!editable||!next.length)return false;
      if(next.length>MAX){message('一条笔记最多可关联 '+MAX+' 处。',true);return false;}
      if(!change(next)){message('暂时无法更改关联，已有的关联未被删除。请检查笔记同步状态。',true);return false;}
      return true;
    }
    function confirm(){
      const found=parser.parse(input.value,{pasted});
      if(!found){message('经文不存在，请检查书卷、章或节。',true);return;}
      if(!found.length){if(!editing)edit(null);return;}
      if(editing&&found.length!==1){message('一次只能替换一处关联经文。',true);return;}
      if(editing&&!refs.some(ref=>key(ref)===editing)){
        message('原关联已变更。请取消修改，再选择要改的经文。',true);return;
      }
      const base=refs.filter(ref=>key(ref)!==editing),seen=new Set(base.map(key));
      const additions=found.filter(ref=>{const id=key(ref);if(seen.has(id))return false;seen.add(id);return true;});
      if(!additions.length){message('这处经文已关联。',true);return;}
      if(apply([...base,...additions]))edit(null);
    }
    input.addEventListener('paste',()=>{pasted=true;});
    input.addEventListener('input',e=>{
      if(e.isComposing||composing)return;
      message();
      if(!input.value.trim())pasted=false;
      if(e.inputType!=='insertFromPaste'&&e.inputType?.startsWith('insert')&&
        input.selectionEnd===input.value.length&&ending.test(e.data||input.value)&&ending.test(input.value))confirm();
    });
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('compositionend',e=>{composing=false;if(ending.test(e.data||'')&&ending.test(input.value))confirm();});
    input.addEventListener('keydown',e=>{
      if(e.isComposing||composing||e.keyCode===229)return;
      if(e.key==='Enter'){e.preventDefault();confirm();}
      if(e.key==='Escape'&&(editing||input.value)){e.stopPropagation();e.preventDefault();edit(null);}
    });
    cancel.onclick=()=>{edit(null);input.focus({preventScroll:true});};
    function decorateResults(){
      const selected=new Set(refs.map(key));
      for(const {ref,add} of searchButtons){
        const used=selected.has(key(ref));add.textContent=used?'已加入':'加入';
        add.setAttribute('aria-disabled',String(used));
        add.setAttribute('aria-label',(used?'已关联：':'加入关联：')+title(ref));
      }
    }
    function appendResults(){
      for(const {ref,text,pageLabel} of matches.slice(searchButtons.length,searchButtons.length+10)){
        const row=make('div','study-notes__result'),copy=make('div','study-notes__result-text');
        const read=previewButton(pageLabel||title(ref),ref,'study-notes__result-ref');
        const add=button('加入','study-notes__result-add');
        add.onclick=()=>{
          if(refs.some(item=>key(item)===key(ref)))return;
          if(apply([...refs,ref]))searchStatus.textContent='已加入：'+title(ref);
          else searchStatus.textContent=feedback.textContent;
        };
        copy.append(read,make('span','',text));row.append(copy,add);results.append(row);searchButtons.push({ref,add});
      }
      decorateResults();more.hidden=searchButtons.length>=matches.length;
    }
    function runSearch(){
      win.clearTimeout(timer);if(search.hidden)return;
      closePreview(results);
      const text=query.value.trim(),found=text?find(text):[];
      matches=found.map(row=>{
        const [ch,lo]=row.ref.split(':').map(Number),hi=Number(row.display?.split('–')[1])||lo;
        return {ref:row.anchor||{code:row.code,ch,lo,hi},text:row.text,pageLabel:row.book+' '+(row.display||row.ref)};
      });
      results.replaceChildren();searchButtons=[];appendResults();
      searchStatus.textContent=text?(matches.length?(found.truncated?'仅显示前 '+matches.length+' 条':matches.length+' 条结果'):'未找到经文。'):'可搜索正文里的词句，例如「爱是恒久忍耐」。';
    }
    function closeSearch(focus=false){
      if(search.hidden)return;
      win.clearTimeout(timer);closePreview(results);search.hidden=true;
      entry.hidden=!editable;help.hidden=!editable;searchButton.setAttribute('aria-expanded','false');
      if(focus)searchButton.focus({preventScroll:true});
    }
    searchButton.onclick=()=>{
      if(!search.hidden){closeSearch(true);return;}
      closePreview(chips);search.hidden=false;entry.hidden=true;help.hidden=true;
      searchButton.setAttribute('aria-expanded','true');runSearch();query.focus({preventScroll:true});
    };
    searchClose.onclick=()=>closeSearch(true);
    form.onsubmit=e=>{e.preventDefault();if(queryComposing)return;runSearch();query.blur();results.querySelector('button')?.focus();};
    query.addEventListener('compositionstart',()=>{queryComposing=true;});
    const queueSearch=()=>{win.clearTimeout(timer);timer=win.setTimeout(runSearch,130);};
    query.addEventListener('compositionend',()=>{queryComposing=false;queueSearch();});
    query.addEventListener('input',e=>{if(!queryComposing&&!e.isComposing)queueSearch();});
    search.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!queryComposing){e.preventDefault();e.stopPropagation();closeSearch(true);}});
    more.onclick=appendResults;
    function reset(){
      closeSearch();closePreview(chips);query.value='';edit(null);
    }
    entry.hidden=help.hidden=searchButton.hidden=!editable;reset();
    return {root,setRefs,reset,hasDraft:()=>!!(input.value||editing||!search.hidden),closePreview:()=>closePreview(root)};
  };
})(window);
