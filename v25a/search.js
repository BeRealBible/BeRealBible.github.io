/* V25a: a local verse finder. No query is sent to a server. */
(function(root){
  'use strict';
  const norm=s=>s.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
  function catalogue(source,lookup){
    const rows=[],byBook=new Map();
    for(const b of source.books){
      for(const alias of [b.code,b.short,b.name])byBook.set(norm(alias),b.code);
      for(const ch of b.chapters)for(const [n,text] of ch.verses){
        const ref=ch.chapter+':'+n,page=lookup(b.code,ref);
        if(!Number.isInteger(page)||typeof text!=='string')continue;
        rows.push({book:b.name,code:b.code,ref,page,text,key:norm(text)});
      }
    }
    return raw=>{
      const q=norm(raw);
      if(!q)return [];
      const addr=/^(.+?)(\d+)(?:章|:)(\d+)节?$/.exec(q);
      if(addr&&byBook.has(addr[1]))return rows.filter(r=>r.code===byBook.get(addr[1])&&r.ref===+addr[2]+':'+(+addr[3]));
      return rows.filter(r=>r.key.includes(q));
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={catalogue};return;}
  root.mountVerseFinder=(navigate,interrupt)=>{
    const $=id=>document.getElementById(id),dialog=$('verse-finder'),input=$('vf-input'),list=$('vf-list'),status=$('vf-status'),more=$('vf-more'),examples=$('vf-examples');
    let search,results=[],shown=0,timer;
    const trigger=document.createElement('button');trigger.className='rh-toggle';trigger.type='button';trigger.title='搜索经文（Ctrl / ⌘ + K）';trigger.setAttribute('aria-label','搜索经文');trigger.setAttribute('aria-haspopup','dialog');
    trigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>';
    document.querySelector('.rh-rail').prepend(trigger);
    function open(){
      if(document.querySelector('dialog[open]'))return;
      interrupt();dialog.showModal();input.focus();input.select();
    }
    function close(){dialog.close();root.PaperImmersion?.hideChrome();$('stage').focus({preventScroll:true});}
    trigger.onclick=open;$('vf-close').onclick=close;
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){if(dialog.open){e.preventDefault();input.focus();input.select();}else if(!document.querySelector('dialog[open]')){e.preventDefault();open();}}});
    function append(){
      for(const r of results.slice(shown,shown+24)){
        const b=document.createElement('button'),ref=document.createElement('strong'),excerpt=document.createElement('span');
        b.type='button';ref.textContent=r.book+' '+r.ref;
        const q=input.value.trim(),at=r.text.indexOf(q);
        if(at>=0&&q){const mark=document.createElement('mark');mark.textContent=q;excerpt.append(r.text.slice(0,at),mark,r.text.slice(at+q.length));}
        else excerpt.textContent=r.text;
        b.append(ref,excerpt);b.onclick=()=>{close();navigate(r.page,{bookCode:r.code,ref:r.ref,search:true});};list.append(b);
      }
      shown=Math.min(shown+24,results.length);more.hidden=shown===results.length;
    }
    function refresh(){
      clearTimeout(timer);const q=input.value.trim();examples.hidden=!!q;
      if(q&&!search)search=catalogue(root.BIBLE_SOURCE,(c,r)=>root.V25OriginalData.lookup(c,r));
      results=q?search(q):[];shown=0;list.replaceChildren();$('vf-scroll').scrollTop=0;
      status.textContent=q?(results.length?'找到 '+results.length+' 节经文':'没有找到。试试更短的词，或输入书卷、章和节。'):'可按经文内容或章节地址查找';
      append();
    }
    input.addEventListener('input',e=>{clearTimeout(timer);if(!e.isComposing)timer=setTimeout(refresh,100);});
    input.addEventListener('compositionend',()=>{clearTimeout(timer);timer=setTimeout(refresh,100);});
    $('vf-form').onsubmit=e=>{e.preventDefault();refresh();list.firstElementChild?.focus();};
    more.onclick=append;
    examples.onclick=e=>{if(e.target.tagName==='BUTTON'){input.value=e.target.textContent;refresh();input.focus();}};
    refresh();
  };
})(typeof window!=='undefined'?window:globalThis);
