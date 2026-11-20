/* First reading: a paper slip beside the book, never a modal over it. */
(() => {
  'use strict';
  const root=document.documentElement, key='paper:v25:first-guide:1';
  function seen(){
    for(const name of ['localStorage','sessionStorage']){
      try{if(window[name].getItem(key)==='seen')return true;}catch{}
    }
    return false;
  }
  function remember(){
    for(const name of ['localStorage','sessionStorage']){
      try{window[name].setItem(key,'seen');return;}catch{}
    }
  }
  function mount(){
    const stage=document.getElementById('stage'),panel=document.getElementById('pcz-panel');
    if(!stage||!panel||document.getElementById('paper-guide'))return;
    const compact=matchMedia('(max-width: 639px)'),slip=document.createElement('aside');
    // The illustrations show the gesture even on pages with no printed references.
    const steps={
      turn:['从页边翻页','从右页外缘向左划，翻到下一页；从左页外缘向右划，翻回上一页。',
        'M4 6q7-2 14 1 7-3 14-1v20q-7-2-14 1-7-3-14-1z M18 7v20 M34 15H22m4-4-4 4 4 4'],
      history:['轻点空白，找回读过的章','点书页没有字的地方，底部工具栏就会出现。点书卷标签回到那一章；时钟按钮可收起或展开历史。',
        'M24 21a9 9 0 1 0-13 2M7 15H3v-4 M16 9v6l4 2 M5 27h26'],
      note:['先读注释，再决定要不要跳','点页脚的经文引用，或小标题下的对观经文。浮窗里深色粗体是引用的经节，上下滑可读上下文；点「跳转 ↗」才会离开原页。',
        'M4 6h27v19H15l-6 4v-4H4z M9 12h9m-9 5h12 M22 13l5-5m-5 0h5v5'],
      column:['读到栏底，接着读下一栏','手机放大到分栏阅读时，向上划到看见页底。点「栏底 · 下一栏 ↱」，就会移到下一栏开头，不用翻页。',
        'M4 5h28v23H4z M8 10h7m-7 4h7m-7 4h7 M21 10h7m-7 4h7m-7 4h7 M12 21v3h6V11l3 2']
    };
    slip.id='paper-guide';slip.hidden=true;slip.setAttribute('aria-label','阅读指引');
    slip.innerHTML='<div class="pg-top"><span>阅读指引 <small></small></span><button type="button" data-act="skip">跳过</button></div>'+
      '<div class="pg-body" aria-live="polite" aria-atomic="true"><svg viewBox="0 0 36 32" aria-hidden="true"><path/></svg><div><strong></strong><p></p></div></div>'+
      '<div class="pg-nav"><button type="button" data-act="back">上一步</button><button type="button" data-act="next"></button></div>';
    document.body.append(slip);
    const $=s=>slip.querySelector(s),next=$('[data-act=next]'),back=$('[data-act=back]');
    const order=()=>compact.matches&&stage.dataset.paperPaint==='flat-touch'?['turn','history','note','column']:['turn','history','note'];
    let step=null;
    function render(id){
      const seq=order();step=seq.includes(id)?id:seq.at(-1);
      const i=seq.indexOf(step),[title,copy,draw]=steps[step];
      root.dataset.guideStep=step;$('small').textContent=(i+1)+' / '+seq.length;
      $('strong').textContent=title;$('p').textContent=copy;$('path').setAttribute('d',draw);
      back.disabled=i===0;next.textContent=i===seq.length-1?'开始阅读':'下一步';
      slip.hidden=false;
    }
    function close(){
      remember();delete root.dataset.guideStep;step=null;
      const restore=slip.contains(document.activeElement);slip.hidden=true;
      if(restore)stage.focus({preventScroll:true});
    }
    function move(delta){
      const seq=order(),i=seq.indexOf(step)+delta;
      if(i>=seq.length)close();else if(i>=0)render(seq[i]);
    }
    slip.addEventListener('click',e=>{
      const act=e.target.closest('button')?.dataset.act;
      if(act==='next')move(1);else if(act==='back')move(-1);else if(act==='skip')close();
    });
    slip.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    });
    compact.addEventListener('change',()=>{if(step)render(step);});
    // A real page turn can stand in for the first "next"; never turn for the user.
    new MutationObserver(changes=>{
      if(step==='turn'&&changes.some(c=>c.oldValue!==stage.dataset.spread))render('history');
    }).observe(stage,{attributes:true,attributeFilter:['data-spread'],attributeOldValue:true});
    const replay=document.createElement('button');replay.className='pg-replay';replay.type='button';replay.textContent='重看阅读指引';
    panel.append(replay);replay.addEventListener('click',()=>{
      if(!panel.hidden)document.querySelector('.pcz-button').click();
      render('turn');next.focus({preventScroll:true});
    });
    if(!seen())render('turn');
  }
  if(root.dataset.ruleLayout==='ready')mount();
  else{
    const wait=new MutationObserver(()=>{if(root.dataset.ruleLayout==='ready'){wait.disconnect();mount();}});
    wait.observe(root,{attributes:true,attributeFilter:['data-rule-layout']});
  }
})();
