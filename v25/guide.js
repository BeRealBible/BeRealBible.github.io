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
    const stage=document.getElementById('stage'),settings=document.getElementById('study-settings'),
      replay=document.getElementById('paper-guide-replay');
    if(!stage||!settings||!replay||document.getElementById('paper-guide'))return;
    const compact=matchMedia('(max-width: 639px)'),slip=document.createElement('aside');
    // The illustrations show the gesture even on pages with no printed references.
    const steps={
      turn:['从页边翻页','从右页外缘向左划，翻到下一页；从左页外缘向右划，翻回上一页。',
        'M4 6q7-2 14 1 7-3 14-1v20q-7-2-14 1-7-3-14-1z M18 7v20 M34 15H22m4-4-4 4 4 4'],
      history:['底栏：定位、目录、历史','轻点纸页留白，底栏就会出现。「定位」找经文，「目录」选书卷，「历史」找回读过的章。',
        'M24 21a9 9 0 1 0-13 2M7 15H3v-4 M16 9v6l4 2 M5 27h26'],
      note:['先看引用，再决定要不要跳','点页脚引用或对观经文。朱红字标出引用的经节，可上下滚读；点「在主书查看」才跳转。',
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
    // The guide yields via CSS when other tools are open. It must not take a
    // Back step or mark itself finished while that visible tool owns the UI.
    window.V25OverlayBack.register(slip,{layer:38,active:()=>!slip.hidden&&slip.getClientRects().length>0,dismiss:close});
    compact.addEventListener('change',()=>{if(step)render(step);});
    // A real page turn can stand in for the first "next"; never turn for the user.
    new MutationObserver(changes=>{
      if(step==='turn'&&changes.some(c=>c.oldValue!==stage.dataset.spread))render('history');
    }).observe(stage,{attributes:true,attributeFilter:['data-spread'],attributeOldValue:true});
    replay.hidden=false;replay.addEventListener('click',()=>{
      if(settings.open)settings.close();
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
