/* The floating reader selects canonical verses, never line breaks or SVG ink. */
(() => {
  'use strict';
  function mount({panel,scroll,scripture,marks,current,begin,onFloat,onStudy,hasStudy,onWriteNote,active=()=>true}){
    const doc=panel.ownerDocument,win=doc.defaultView,tools=win.PaperTextSelection;
    const picked=new Map();
    let bar=null,form=null,contact=null,suppress=false,tapRow=null,focusId=null,serial=0,noticeTimer=0;
    const status=doc.createElement('div');status.className='compare-selection-status';status.setAttribute('role','status');panel.append(status);
    scroll.setAttribute('aria-keyshortcuts','Shift+Space');
    scroll.setAttribute('aria-description','长按经文开始整节选择，或按 Shift 加空格选择当前经节。');
    scroll.dataset.versePicking='';
    const verses=()=>Array.from(scroll.querySelectorAll('.compare-slip__verse'));
    const targetAt=target=>target?.closest?.(onStudy?'.compare-slip__verse,[data-study-chapter]':'.compare-slip__verse');
    const rowOf=el=>el&&scripture.resolve({code:el.dataset.verseId.split('.')[0],ref:el.dataset.ref})[0];
    function itemOf(el){
      if(!el)return null;
      if(el.dataset.studyChapter){
        const [code,ch]=el.dataset.studyChapter.split('.');
        return {id:'chapter:'+el.dataset.studyChapter,code,ch:+ch,chapter:true};
      }
      return rowOf(el);
    }
    const locs=()=>[...picked.values()].filter(row=>!row.chapter).map(({code,ref})=>({code,ref}));
    const chapterObjects=()=>[...picked.values()].filter(row=>row.chapter).map(({code,ch})=>({code,ch}));
    const focus=()=>{if(!panel.hidden&&!panel.hasAttribute('data-collapsed'))scroll.focus({preventScroll:true});};
    function tell(message,delay=2200){
      win.clearTimeout(noticeTimer);status.textContent=message;
      noticeTimer=win.setTimeout(()=>status.textContent='',delay);
    }
    function render(){
      const reader=marks()?.reader();
      for(const el of verses()){
        el.toggleAttribute('data-selected-verse',picked.has(el.dataset.verseId));
        el.toggleAttribute('data-focused-verse',!picked.size&&focusId===el.dataset.verseId);
        if(reader){const row=rowOf(el);el.toggleAttribute('data-saved-verse',!!row&&reader(row));}
      }
      for(const el of scroll.querySelectorAll('[data-study-chapter]')){
        el.toggleAttribute('data-selected-chapter',picked.has('chapter:'+el.dataset.studyChapter));
      }
      if(!bar)return;
      const hasChapter=chapterObjects().length>0;
      const pen=bar.querySelector('[data-highlight]'),saved=!!picked.size&&!hasChapter&&!!reader&&[...picked.values()].every(reader);
      pen.disabled=!reader||hasChapter;pen.setAttribute('aria-pressed',String(saved));
      for(const action of ['copy','search','float'])bar.querySelector('[data-'+action+']').disabled=hasChapter;
      if(onStudy)tools.setStudyAvailable(bar.querySelector('[data-study]'),hasStudy(locs(),chapterObjects()));
      if(onWriteNote)bar.querySelector('[data-note]').disabled=!picked.size;
      tools.actionLabel(pen,saved?'取消高亮':'高亮');
      bar.setAttribute('aria-label','浮窗经文选区，已选 '+picked.size+(hasChapter?' 项':' 节'));
    }
    function cancelContact(){
      if(contact)win.clearTimeout(contact.timeout);
      contact=null;
    }
    function reset(restore=false){
      cancelContact();serial++;picked.clear();
      const hadFocus=focusId!==null;focusId=null;
      if(bar){
        form=null;bar.remove();bar=null;delete panel.dataset.selecting;render();
        if(restore)focus();
      }else if(hadFocus)render();
    }
    function prepare(){
      if(bar)return;
      begin();
      bar=tools.makeToolbar(doc,{copy,search,highlight,float:another,note:onWriteNote&&writeNote,study:onStudy&&study,exit:()=>reset(true)},'浮窗经文选区','另开对照');
      bar.dataset.floating='';
      panel.dataset.selecting='';
      panel.insertBefore(bar,scroll);
    }
    function pick(rows,toggle=false){
      if(!rows.length||form||panel.hidden||panel.hasAttribute('data-collapsed'))return;
      prepare();focusId=null;serial++;
      bar.querySelector('.paper-copy-field')?.remove();
      for(const row of rows){
        if(toggle&&picked.has(row.id))picked.delete(row.id);
        else picked.set(row.id,row);
      }
      if(!picked.size){reset(true);return;}
      render();focus();
    }
    function quote(){
      try{return scripture.quote(locs());}catch{tell('未能读取完整经文，请重试');return '';}
    }
    async function copy(){
      if(!picked.size||chapterObjects().length||form)return;
      const text=quote(),version=serial;
      if(!text)return;
      const ok=await tools.writeText(win,text);
      if(version!==serial||!bar)return;
      if(!ok&&!tools.fallbackCopy(doc,bar,text)){tell('无法自动复制，可手动复制');return;}
      reset(true);tell('已复制经文');
    }
    function search(){
      if(form||!picked.size||chapterObjects().length)return;
      const text=quote();if(!text)return;
      const close=()=>reset(true);
      const box=tools.makeSearchForm(doc,win,text,{valid:f=>form===f,cancel:close,done:close});
      serial++;form=box.form;bar.dataset.searchOpen='true';
      bar.querySelector('[data-search]').setAttribute('aria-expanded','true');
      bar.append(form);box.field.focus({preventScroll:true});
    }
    function highlight(){
      if(chapterObjects().length)return;
      const saved=marks()?.toggle([...picked.values()]);
      if(!saved)return;
      reset(true);tell((saved.remove?'已取消高亮':'已高亮')+(saved.durable?'':'（仅本次阅读）'));
    }
    function another(){if(picked.size&&!chapterObjects().length&&onFloat(locs(),tell))reset();}
    function study(){if(picked.size&&onStudy(locs(),chapterObjects(),scroll))reset();}
    function writeNote(){if(picked.size&&onWriteNote(locs(),chapterObjects(),scroll))reset();}
    panel.addEventListener('copy',event=>{
      if(!active()||!picked.size||chapterObjects().length||form||!event.clipboardData||event.target?.closest?.('input,textarea,[contenteditable]'))return;
      const text=quote();if(!text)return;
      try{event.clipboardData.setData('text/plain',text);}catch{return;}
      event.preventDefault();reset(true);tell('已复制经文');
    });
    panel.addEventListener('keydown',event=>{
      if(!active()||event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'&&bar){
        event.preventDefault();event.stopImmediatePropagation();reset(true);
      }else if(event.target?.matches?.('[data-study-chapter]')&&(event.key==='Enter'||event.key===' ')){
        event.preventDefault();event.stopImmediatePropagation();pick([itemOf(event.target)],true);
      }else if(event.target===scroll&&event.shiftKey&&(event.code==='Space'||event.key===' ')){
        const row=current();
        if(row){event.preventDefault();event.stopImmediatePropagation();pick([row],true);}
      }
    },true);
    panel.addEventListener('pointerdown',()=>{suppress=false;tapRow=null;},true);
    panel.addEventListener('click',event=>{
      if(!active()||event.detail===0)return;
      // A touch's compatibility click may be retargeted to a nearby
      // actionable button after the toolbar has appeared under the finger.
      // Only a fresh pointerdown on the toolbar may activate that button.
      const crossed=bar&&tapRow&&bar.contains(event.target);
      if(!suppress&&!crossed)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!suppress&&crossed)pick([tapRow],true);
      suppress=false;tapRow=null;
    },true);
    scroll.addEventListener('pointerdown',event=>{
      cancelContact();
      if(!active()||event.button!==0||event.isPrimary===false||form)return;
      const el=targetAt(event.target),row=itemOf(el);if(!row)return;
      if(event.shiftKey&&event.pointerType==='mouse'){
        event.preventDefault();suppress=true;pick([row],true);return;
      }
      const press={id:event.pointerId,x:event.clientX,y:event.clientY,row,held:false,moved:false};
      contact=press;press.timeout=win.setTimeout(()=>{
        if(contact!==press||!el.isConnected)return;
        const text=win.getSelection();
        if(text?.anchorNode&&scroll.contains(text.anchorNode))text.removeAllRanges();
        // Mounting the tools changes the text viewport; release must not
        // accidentally click a freshly appeared toolbar button.
        try{scroll.setPointerCapture(press.id);}catch{}
        press.held=true;suppress=true;
        pick([row]);
      },360);
    });
    scroll.addEventListener('pointermove',event=>{
      const press=contact;
      if(press&&press.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>8){
        press.moved=true;win.clearTimeout(press.timeout);
      }
    });
    scroll.addEventListener('pointerup',event=>{
      const press=contact;
      if(press?.id!==event.pointerId)return;
      cancelContact();
      if(press.held||press.moved)suppress=true;
      else if(event.pointerType==='touch')tapRow=press.row;
      if(press.held||!press.moved||event.pointerType!=='mouse')return;
      const native=win.getSelection();
      if(!native||native.isCollapsed||!native.toString().trim()||
         !scroll.contains(native.anchorNode)||!scroll.contains(native.focusNode))return;
      const range=native.getRangeAt(0);
      const rows=verses().filter(el=>range.intersectsNode(el)).map(rowOf).filter(Boolean);
      if(rows.length){native.removeAllRanges();pick(rows);}
    });
    for(const event of ['pointercancel','pointerleave'])scroll.addEventListener(event,cancelContact);
    scroll.addEventListener('contextmenu',event=>{
      if(active()&&targetAt(event.target)&&(event.pointerType==='touch'||contact?.held||bar))event.preventDefault();
    });
    scroll.addEventListener('click',event=>{
      if(!active())return;
      const row=itemOf(targetAt(event.target));
      const pickedRow=tapRow||row;tapRow=null;
      if(bar&&pickedRow)pick([pickedRow],true);
      else if(pickedRow&&!pickedRow.chapter){focusId=pickedRow.id;render();}
    });
    return {render,reset,close(){reset();win.clearTimeout(noticeTimer);status.textContent='';}};
  }
  window.V25FloatSelection=Object.freeze({mount});
})();
