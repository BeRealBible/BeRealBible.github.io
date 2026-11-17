'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Jump=require('./paper-jump.js');
let checks=0;
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture({reduced=false,animation=true,throwAnimate=0,renderError=false,renderPage:providedRender}={}){
  const timers=new Map(),animations=[],rendered=[],errors=[];let nextTimer=0,now=0;
  const win={console:{error:(...args)=>errors.push(args)},matchMedia:()=>({matches:reduced}),
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.attributes={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    appendChild(child){child.parentNode=this;this.children.push(child);return child;}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
    setAttribute(k,v){this.attributes[k]=String(v);}
    animate(frames,options){
      if(throwAnimate&&animations.length+1===throwAnimate)throw new Error('mock animation creation failed');
      const a={frames,options,cancelled:false};a.finished=new Promise((resolve,reject)=>{a.resolve=resolve;a.reject=reject;});
      a.cancel=()=>{a.cancelled=true;a.reject(new Error('cancelled'));};animations.push(a);return a;
    }
  }
  if(!animation)delete Element.prototype.animate;
  const doc={defaultView:win,createElement:tag=>new Element(tag)};
  const host=new Element('div'),paper=new Element('article');paper.innerHTML='authoritative static page';host.appendChild(paper);
  const jump=Jump.create(host,{renderPage:index=>{rendered.push(index);if(renderError&&rendered.length===3)throw new Error('mock SVG failure');return providedRender?providedRender(index):`<svg data-real-page="${index}"><text>${index}</text></svg>`;}});
  function advance(ms){now+=ms;for(const [id,item]of [...timers].sort((a,b)=>a[1].at-b[1].at))if(item.at<=now&&timers.has(id)){timers.delete(id);item.fn();}}
  return {host,paper,jump,timers,animations,rendered,errors,advance};
}
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
  await test('plan uses one nearby leaf, bounded staggered distant leaves and exact final faces',()=>{
    for(let from=0;from<=120;from+=2)for(let to=0;to<=120;to+=2){
      const p=Jump.plan(from,to),distance=Math.abs(to-from)/2;
      assert.equal(p.count,distance?Math.min(distance,9,2+Math.floor(Math.log2(distance))):0);
      if(!distance){assert.equal(p.totalDuration,0);continue;}
      assert.ok(p.count<=9);assert.equal(p.leaves[0].delay,0);
      const first=p.leaves[0],last=p.leaves.at(-1);
      assert.equal(first.front,to>from?from+1:from-1);assert.equal(first.back,first.front+1);
      assert.equal(last.front,to>from?to-1:to+1);assert.equal(last.back,to>from?to:to+2);
      for(const leaf of p.leaves){assert.equal(leaf.back,leaf.front+1);assert.ok(leaf.front>=0);assert.ok(leaf.front%2===1);assert.equal(leaf.fromAngle,to>from?0:-180);assert.equal(leaf.toAngle,to>from?-180:0);}
      assert.equal(new Set(p.leaves.map(leaf=>leaf.front)).size,p.count);
      if(p.count>1)for(let i=1;i<p.count;i++){assert.ok(p.leaves[i].delay>p.leaves[i-1].delay);assert.ok((p.leaves[i].front-p.leaves[i-1].front)*p.direction>0);}
    }
    for(const pair of [[-2,0],[0,3],[NaN,2],[0,Infinity]])assert.throws(()=>Jump.plan(...pair),RangeError);
    assert.equal(Jump.plan(0,1244).count,9);
  });
  await test('same spread and reduced motion finish synchronously without constructing faces',()=>{
    for(const [options,to]of [[{},0],[{reduced:true},100]]){
      const f=fixture(options);let finished=0,cancelled=0;
      assert.equal(f.jump.start({from:0,to,onFinish:()=>finished++,onCancel:()=>cancelled++}),true);
      assert.equal(finished,1);assert.equal(cancelled,0);assert.equal(f.jump.isActive(),false);assert.equal(f.rendered.length,0);assert.deepEqual(f.host.children,[f.paper]);assert.equal(f.timers.size,0);
      assert.equal(f.jump.cancel(),false);assert.equal(finished,1);
    }
  });
  await test('real page callback supplies every double-sided face and static pages are untouched',async()=>{
    const f=fixture();let finished=0,cancelled=0;const p=Jump.plan(0,1244);
    assert.equal(f.jump.start({from:0,to:1244,onFinish:()=>finished++,onCancel:()=>cancelled++}),true);
    assert.equal(f.jump.isActive(),true);assert.equal(f.host.dataset.jumpLeaves,'9');assert.equal(f.host.dataset.jumpDirection,'forward');
    const layer=f.host.children[1];assert.equal(layer.children.length,9);assert.equal(layer.attributes['aria-hidden'],'true');
    assert.deepEqual(f.rendered,p.leaves.flatMap(leaf=>[leaf.front,leaf.back]));
    for(let i=0;i<9;i++){const leaf=layer.children[i];assert.equal(leaf.children.length,2);assert.ok(leaf.children[0].innerHTML.includes(`data-real-page="${p.leaves[i].front}"`));assert.ok(leaf.children[1].innerHTML.includes(`data-real-page="${p.leaves[i].back}"`));assert.equal(f.animations[i].options.delay,p.leaves[i].delay);}
    f.advance(281);assert.equal(layer.children[0].style.zIndex,'30');
    for(const a of f.animations)a.resolve();await flush();
    assert.equal(finished,1);assert.equal(cancelled,0);assert.equal(f.jump.isActive(),false);assert.deepEqual(f.host.children,[f.paper]);assert.equal(f.paper.innerHTML,'authoritative static page');assert.equal(f.timers.size,0);assert.equal(f.host.classes.has('paper-jump-active'),false);
    f.advance(10000);await flush();assert.equal(finished,1);
  });
  await test('reverse jump starts with the correct verso and ends with the destination recto',async()=>{
    const f=fixture();let finished=0;f.jump.start({from:100,to:0,onFinish:()=>finished++});
    assert.equal(f.rendered[0],99);assert.equal(f.rendered[1],100);assert.deepEqual(f.rendered.slice(-2),[1,2]);
    for(const a of f.animations){assert.deepEqual(a.frames,[{transform:'rotateY(-180deg)'},{transform:'rotateY(0deg)'}]);a.resolve();}await flush();assert.equal(finished,1);
  });
  await test('cancel removes only its layer, cancels every timer/animation and notifies exactly once',async()=>{
    const f=fixture();let finished=0,cancelled=0;f.jump.start({from:10,to:100,onFinish:()=>finished++,onCancel:()=>cancelled++});
    assert.equal(f.jump.cancel(),true);assert.equal(f.jump.cancel(),false);await flush();
    assert.equal(cancelled,1);assert.equal(finished,0);assert.equal(f.timers.size,0);assert.ok(f.animations.every(a=>a.cancelled));assert.deepEqual(f.host.children,[f.paper]);assert.equal(f.host.dataset.jumpState,'cancelled');
    for(const a of f.animations)a.resolve();f.advance(10000);await flush();assert.equal(cancelled,1);assert.equal(finished,0);
  });
  await test('replacement jump cancels the old operation and ignores stale animation callbacks',async()=>{
    const f=fixture();let oldCancel=0,newFinish=0;
    f.jump.start({from:0,to:20,onCancel:()=>oldCancel++});const old=f.animations.slice();
    f.jump.start({from:0,to:2,onFinish:()=>newFinish++});assert.equal(oldCancel,1);assert.equal(f.host.children.length,2);
    for(const a of old)a.resolve();await flush();assert.equal(f.jump.isActive(),true);assert.equal(newFinish,0);
    f.animations.at(-1).resolve();await flush();assert.equal(newFinish,1);assert.equal(oldCancel,1);
  });
  await test('invalid requests do not cancel an otherwise valid in-flight jump',()=>{
    const f=fixture();f.jump.start({from:0,to:2});assert.equal(f.jump.start({from:0,to:3}),false);assert.equal(f.jump.isActive(),true);f.jump.cancel();
  });
  await test('render failure, animation construction failure and finished rejection cleanly cancel',async()=>{
    for(const options of [{renderError:true},{throwAnimate:2},{}]){
      const f=fixture(options);let cancelled=0,finished=0;
      const result=f.jump.start({from:0,to:100,onCancel:()=>cancelled++,onFinish:()=>finished++});
      if(!Object.keys(options).length){assert.equal(result,true);f.animations[0].reject(new Error('GPU/platform failure'));await flush();}else assert.equal(result,false);
      await flush();assert.equal(cancelled,1);assert.equal(finished,0);assert.equal(f.jump.isActive(),false);assert.equal(f.timers.size,0);assert.deepEqual(f.host.children,[f.paper]);assert.ok(f.animations.every(a=>a.cancelled));
    }
  });
  await test('unavailable animations and a stalled finished promise cannot strand the book',async()=>{
    const a=fixture({animation:false});let first=0;a.jump.start({from:0,to:20,onFinish:()=>first++});assert.equal(first,1);assert.equal(a.jump.isActive(),false);
    const b=fixture();let second=0;b.jump.start({from:0,to:100,onFinish:()=>second++});
    const p=Jump.plan(0,100),deadline=Math.max(5000,p.totalDuration*4);
    b.advance(p.totalDuration+181);await flush();assert.equal(second,0);assert.equal(b.jump.isActive(),true,'nominal duration plus a short paint delay must not cut off real SVG leaves');
    b.advance(deadline-p.totalDuration-182);await flush();assert.equal(second,0);assert.equal(b.jump.isActive(),true);
    b.advance(1);await flush();assert.equal(second,1);assert.equal(b.jump.isActive(),false);assert.equal(b.timers.size,0);assert.deepEqual(b.host.children,[b.paper]);assert.equal(b.host.dataset.jumpReason,'animation-timeout');
  });
  await test('late first paint can still finish normally before the conservative watchdog',async()=>{
    const f=fixture();let finished=0;f.jump.start({from:0,to:1244,onFinish:()=>finished++});
    f.advance(3200);assert.equal(f.jump.isActive(),true);assert.equal(finished,0);
    for(const a of f.animations)a.resolve();await flush();assert.equal(finished,1);assert.equal(f.host.dataset.jumpReason,'finished');assert.equal(f.timers.size,0);
    f.advance(10000);await flush();assert.equal(finished,1);assert.equal(f.host.dataset.jumpReason,'finished');
  });
  await test('completion callback failure leaves the reader clean and is reported once',async()=>{
    const f=fixture();f.jump.start({from:0,to:2,onFinish:()=>{throw new Error('caller callback');}});f.animations[0].resolve();await flush();assert.equal(f.jump.isActive(),false);assert.equal(f.errors.length,1);assert.deepEqual(f.host.children,[f.paper]);
  });
  await test('CSS keeps local perspective, spine binding, two nonmirrored faces and passive input',()=>{
    const css=fs.readFileSync(path.join(__dirname,'paper-jump.css'),'utf8');
    assert.match(css,/\.paper-jump-layer\{[^}]*perspective:2400px[^}]*transform-style:preserve-3d/);
    assert.match(css,/\.paper-jump-leaf\{[^}]*left:480px[^}]*transform-origin:0 50%[^}]*transform-style:preserve-3d/);
    assert.match(css,/backface-visibility:hidden/);assert.match(css,/\.paper-jump-face--back\{transform:rotateY\(180deg\)\}/);
    assert.ok(!/scaleX\(-1\)|filter:|opacity:/.test(css));assert.ok((css.match(/pointer-events:none/g)||[]).length>=3);assert.match(css,/prefers-reduced-motion/);
  });
  const realData=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
  const Page=require('./paper-page.js');
  await test('all 388129 pairs of actual 1246-page spreads stay in range at every distance',()=>{
    assert.equal(realData.pages.length,1246);
    const max=(realData.pages.length-2)&~1;let pairs=0;
    for(let from=0;from<=max;from+=2)for(let to=0;to<=max;to+=2){
      const p=Jump.plan(from,to);pairs++;
      if(from===to){assert.equal(p.count,0);continue;}
      const seen=new Set(),forward=to>from;
      for(const leaf of p.leaves){
        if(leaf.front<1||leaf.back>=realData.pages.length||leaf.back!==leaf.front+1||seen.has(leaf.front)||seen.has(leaf.back))throw new Error(`Invalid face boundary in ${from} -> ${to}`);
        seen.add(leaf.front);seen.add(leaf.back);
      }
      const staticPages=forward?[from,to+1]:[to,from+1];
      if(staticPages.some(index=>seen.has(index)))throw new Error(`Moving page duplicates a static SVG in ${from} -> ${to}`);
      assert.equal(p.leaves.at(-1).front,forward?to-1:to+1);
      assert.equal(p.leaves.at(-1).back,forward?to:to+2);
    }
    assert.equal(pairs,388129);
  });
  await test('real PaperPage SVG defs IDs remain unique across up to 18 faces and two underlying pages',()=>{
    const renderPage=index=>Page.svg(realData.pages[index],index,realData.books);
    for(const [from,to]of [[0,1244],[1244,0],[904,1174],[1174,904],[0,2],[2,0]]){
      const f=fixture({renderPage});f.jump.start({from,to});
      const layer=f.host.children[1],html=layer.children.flatMap(leaf=>leaf.children.map(face=>face.innerHTML));
      for(const index of to>from?[from,to+1]:[to,from+1])html.push(renderPage(index));
      const ids=html.flatMap(svg=>[...svg.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
      assert.equal(ids.length,Jump.plan(from,to).count*2+2);assert.equal(new Set(ids).size,ids.length);
      for(const svg of html){const ownIds=new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));for(const [,reference]of svg.matchAll(/url\(#([^)]*)\)/g))assert.ok(ownIds.has(reference));}
      assert.ok(html.every(svg=>svg.includes('viewBox="0 0 480 704"')));f.jump.cancel();
    }
  });
  console.log(JSON.stringify({paperJumpScenarios:checks,maxLeaves:Jump.constants.MAX_LEAVES,realPageCallback:true,staticPagesUntouched:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
