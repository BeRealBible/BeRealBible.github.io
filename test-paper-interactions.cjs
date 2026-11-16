/* Runs the actual input controller with deterministic time and a renderer spy.
 * Does not substitute for touch-device/browser rendering tests. */
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const Physics=require('./paper-physics.js'),Gestures=require('./gesture-core.js'),Material=require('./book-material.js');
let checks=0;
function fixture(startSpread=2,options={}){
  let now=0,nextId=1;const timers=new Map(),elements=new Map(),events={},saved=[],sceneWrites=[],indexCalls=[],clipCalls=[];let observer,indexOptions,ribbonOptions;const ribbonCalls=[];
  const style=()=>({setProperty(name,value){this[name]=String(value);},getPropertyValue(name){return this[name]||'';},removeProperty(name){delete this[name];}});
  function listen(target,name,fn){const before=target[name];target[name]=before?(...args)=>{before(...args);return fn(...args);}:fn;}
  class Element{
    constructor(id){this.id=id;this.style=style();this.dataset=new Proxy({},{set:(data,key,value)=>{data[key]=String(value);if(id==='stage'&&['scene','sceneProgress','digitalProgress','spread','leftSheets','rightSheets','leftDepth','rightDepth','materialSpread'].includes(key))sceneWrites.push({at:now,key,value:String(value),scene:data.scene,progress:Number(data.sceneProgress),digital:Number(data.digitalProgress),spread:data.spread});return true;}});this.innerHTML='';this.textContent='';this.handlers={};this.children=[];this.attributes={};this.clientWidth=id==='stage'?(options.width||980):65;this.clientHeight=id==='stage'?(options.height||600):46;this.hidden=false;this.disabled=false;this.inert=false;this.classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,b)=>{if(b===undefined)b=!this.classes.has(x);b?this.classes.add(x):this.classes.delete(x);return b;}};}
    addEventListener(name,fn){listen(this.handlers,name,fn);}
    removeEventListener(name,fn){if(this.handlers[name]===fn)delete this.handlers[name];}
    dispatchEvent(event){event.target||=this;event.currentTarget=this;return this.handlers[event.type]?.(event);}
    setAttribute(name,value){this[name]=value;}
    getAttribute(name){return this[name]??null;}
    removeAttribute(name){delete this[name];}
    getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight,right:this.clientWidth,bottom:this.clientHeight};}
    appendChild(child){child.parentElement=this;this.children.push(child);return child;}
    append(...children){children.forEach(child=>this.appendChild(child));}
    querySelector(selector){return el(selector);}
    querySelectorAll(){return [];}
    setPointerCapture(){}releasePointerCapture(){}hasPointerCapture(){return false;}
    focus(){doc.activeElement=this;}
    showModal(){this.open=true;}close(){this.open=false;}
  }
  const el=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const doc={getElementById:el,querySelector:s=>el(s),querySelectorAll:()=>[],createElement:tag=>new Element(tag),addEventListener:(name,fn)=>listen(events,'document:'+name,fn),dispatchEvent:e=>events['document:'+e.type]?.(e),hidden:false};
  doc.body=el('body');doc.documentElement=el('html');
  const index={getNotches:()=>[],setInteractionSide:side=>indexCalls.push({type:'interaction',side,at:now}),setSurfaceFrame:frame=>{const K=context.PaperBookKinematics,m=frame.material;indexCalls.push({type:'material',value:m,assembly:frame.close,at:now,scene:el('stage').dataset.scene,progress:Number(el('stage').dataset.sceneProgress)});indexCalls.push({type:'geometry',at:now,value:{leftMatrix:K.foreedgeMatrixValues('left',m,frame.close),rightMatrix:K.foreedgeMatrixValues('right',m,frame.close),splitDepth:m.leftDepth,totalDepth:m.totalDepth}});},setPhysicalFrame:value=>indexCalls.push({type:'geometry',value,at:now}),setReadingMaterial:(material,assembly)=>indexCalls.push({type:'material',value:material,assembly,at:now,scene:el('stage').dataset.scene,progress:Number(el('stage').dataset.sceneProgress)}),setProgress:p=>indexCalls.push({type:'progress',value:p,at:now}),setDigital:d=>indexCalls.push({type:'digital',value:d,at:now}),focusBook:i=>{indexCalls.push({type:'focus',value:i,at:now});return {x:200,y:300,width:47,height:17,index:i,...options.focusRects?.[i]};},clearFocus:()=>indexCalls.push({type:'clear',at:now}),resize:()=>indexCalls.push({type:'resize',at:now}),destroy(){}};
  const rendered=[];
  class Renderer{
    constructor(){this.last=null;}
    prepare(front,back,direction,count){rendered.push({front,back,direction,count});}
    draw(o){this.last=o;el('book').dataset.curlProgress=String(o.progress);}
    hide(){delete el('book').dataset.curlProgress;}
  }
  const context={console,document:doc,PaperPhysics:Physics,PaperGestures:Gestures,PaperBookMaterial:Material,PaperSheetRenderer:Renderer,
    PaperBookLeaves:{stripClip:(...args)=>{clipCalls.push(args);return 'none';},create:()=>({setPages(){},update:(m,close,state)=>({active:close>0||state.fanLeft>0||state.fanRight>0})})},PaperBookSolid:{create:()=>({update(){}})},PaperRibbons:{create:args=>{ribbonOptions=args;return {update(){},setScene:(reading,close)=>ribbonCalls.push({reading,close}),open:slot=>ribbonCalls.push({open:slot})};}},PaperBookIndex:{geometry:require('./book-index-layout.js').geometry,create:args=>{indexOptions=args;return index;}},PaperImmersion:{setScene(){},showChrome(){},hideChrome(){}},
    performance:{now:()=>now},navigator:{},matchMedia:()=>({matches:!!options.reducedMotion,addEventListener(){},removeEventListener(){}}),
    CustomEvent:class{constructor(type,init={}){this.type=type;this.detail=init.detail;}},Event:class{constructor(type){this.type=type;}},
    localStorage:{getItem:()=>JSON.stringify({spread:startSpread}),setItem:(key,value)=>saved.push({at:now,scene:el('stage').dataset.scene,key,value:JSON.parse(value)})},
    setTimeout:(fn,ms=0)=>{const id=nextId++;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{const id=nextId++;timers.set(id,{fn:()=>fn(now),at:now+16});return id;},cancelAnimationFrame:id=>timers.delete(id),
    ResizeObserver:class{constructor(fn){observer=fn;}observe(){}},addEventListener:(name,fn)=>listen(events,name,fn),dispatchEvent:e=>events[e.type]?.(e)};
  const depthFrames=[];
  if(options.depth){context.PaperBookPacket=require('./book-packet.js');context.PaperBookDepth={...require('./book-depth.js'),create:()=>({prepare(){},update:frame=>depthFrames.push({frame,pose:el('book').style.transform}),hit:(x,y,slop,side)=>options.indexHit?.({x,y,slop,side})??null,getStats:()=>({ms:1})})};}
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('bible-data.js','utf8'),context);vm.runInContext(fs.readFileSync('book-kinematics.js','utf8'),context);vm.runInContext(fs.readFileSync('book-scene.js','utf8'),context);vm.runInContext(fs.readFileSync('paper-typography.js','utf8'),context);vm.runInContext(fs.readFileSync('paper-page.js','utf8'),context);vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  function advance(ms){const end=now+ms;let loops=0;while(true){const upcoming=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!upcoming)break;if(++loops>10000)throw Error('timer loop');now=upcoming[1].at;timers.delete(upcoming[0]);upcoming[1].fn();}now=end;}
  // A synchronous fake clock skips Promise continuations between RAF callbacks.
  // Drain microtasks after every callback so later animation phases start at their
  // actual fake timestamp, not at the end of a large advance().
  async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
  async function advanceAsync(ms){const end=now+ms;let loops=0;await flush();while(true){const upcoming=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!upcoming)break;if(++loops>20000)throw Error('async timer loop');now=upcoming[1].at;timers.delete(upcoming[0]);upcoming[1].fn();await flush();}now=end;await flush();}
  async function untilScene(scene,timeout=8000){const deadline=now+timeout;await flush();while(el('stage').dataset.scene!==scene&&now<deadline)await advanceAsync(16);assert.equal(el('stage').dataset.scene,scene,`scene did not reach ${scene}`);}
  function emit(type,x,y,id=1){el('stage').handlers[type]({clientX:x,clientY:y,pointerId:id,timeStamp:now,button:0,preventDefault(){}});}
  function at(side='right',radius=350){const scale=Number(el('stage').dataset.scale);return {x:Number(el('stage').dataset.x)+(480+(side==='right'?radius:-radius))*scale,y:Number(el('stage').dataset.y)+310*scale,scale,radius};}
  function held(side='right',radius=350){const p=at(side,radius);emit('pointerdown',p.x,p.y);advance(380);return p;}
  function drag(p,progress,side='right',id=1){emit('pointermove',p.x-(side==='right'?1:-1)*progress*2*p.radius*p.scale,p.y,id);}
  function up(p,progress,side='right',cancel=false){emit(cancel?'pointercancel':'pointerup',p.x-(side==='right'?1:-1)*progress*2*p.radius*p.scale,p.y);advance(1500);}
  return {el,advance,advanceAsync,untilScene,emit,at,held,drag,up,rendered,depthFrames,events,saved,sceneWrites,indexCalls,clipCalls,ribbonCalls,navigateRibbon:(page,pose)=>ribbonOptions.onNavigate(page,pose),selectBook:i=>indexOptions.onSelect(i),closeIndex:()=>indexOptions.onClose(),resize:()=>observer(),context};
}
const scenarios=[];
function test(name,fn){scenarios.push({name,fn});}
// Zero-Z 3D and 2D translations have identical geometry. Compare their
// numeric camera pose at handoffs, without forcing the reading compositor
// back into the old 3D spelling merely to satisfy a string equality.
function cameraPose(transform){
  const m=transform.match(/^translate(?:3d)?\(([-\d.]+)px,([-\d.]+)px(?:,0)?\) scale\(([-\d.]+)\)$/);
  assert.ok(m,`unexpected book camera: ${transform}`);return m.slice(1).map(Number);
}
function assertDepthReadingView(f){
  const frame=f.depthFrames.at(-1).frame,stage=f.el('stage'),view=frame.fineView;
  assert.ok(view,'reading labels need a camera-scaled raster window too');
  assert.equal(view.w,stage.clientWidth);assert.equal(view.h,stage.clientHeight);
  const pose=cameraPose(f.el('book').style.transform);
  ['x','y','scale'].forEach((key,i)=>assert.ok(Math.abs(view.camera[key]-pose[i])<1e-10,
    `reading depth ${key} must match the actual SVG camera, not its last directory pose`));
  assert.equal(frame.pick,true,'natural reading labels are interactive without opening a special directory state');assert.equal(frame.printed,null);
  return frame;
}
function assertVectorReading(f,spread,svg){
  const book=f.el('book'),stage=f.el('stage');
  assert.equal(stage.dataset.scene,'reading');assert.equal(stage.dataset.spread,String(spread));
  assert.equal(f.el('body').dataset.paperScene,'reading');
  assert.equal(book.classList.contains('curl-active'),false);
  assert.equal(book.classList.contains('has-curved-leaves'),false);
  assert.match(book.style.transform,/^translate\(/,'settled zoom must not force a 3D book layer');
  const pose=cameraPose(book.style.transform);
  ['x','y','scale'].forEach((key,i)=>assert.ok(Math.abs(pose[i]-Number(stage.dataset[key]))<.006,'camera UI and exact transform agree'));
  assert.deepEqual(['left-paper','right-paper'].map(id=>f.el(id).innerHTML),svg,
    'zoom must retain the exact scripture, font sizes and SVG glyph coordinates');
  assert.equal(f.depthFrames.at(-1).frame.printed,null,'static scripture must not stay in the curved raster');
  assertDepthReadingView(f);
}
test('long press exposes true next recto while spread is unchanged; cancel restores original',()=>{
  const f=fixture(),original=f.el('right-paper').innerHTML,p=f.held();assert.equal(f.el('stage').dataset.foldState,'held');
  assert.deepEqual(f.rendered[0],{front:3,back:4,direction:1,count:1});assert.ok(f.el('right-paper').innerHTML.includes('第 5 页'));
  f.advance(180);f.drag(p,.34);f.advance(300);assert.equal(f.el('stage').dataset.spread,'2');f.up(p,.34);
  assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');assert.equal(f.el('right-paper').innerHTML,original);
});
test('release after crossing midpoint commits exactly one sheet',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.65);f.advance(200);f.up(p,.65);assert.equal(f.el('stage').dataset.spread,'4');assert.equal(f.el('stage').dataset.foldState,'committed');});
test('moving back reverses the fold and cancels even after midpoint',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.8);f.advance(240);f.drag(p,.7);f.advance(45);f.drag(p,.6);f.up(p,.6);assert.equal(f.el('stage').dataset.spread,'2');});
test('left page mirrors front/back texture selection and commit',()=>{const f=fixture(20),p=f.held('left');assert.deepEqual(f.rendered[0],{front:20,back:19,direction:-1,count:1});f.advance(300);f.drag(p,.7,'left');f.advance(200);f.up(p,.7,'left');assert.equal(f.el('stage').dataset.spread,'18');});
test('hold without movement returns without accidental double tap or turn',()=>{const f=fixture(),p=f.held();f.advance(700);f.up(p,0);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('moving before hold threshold stays panning',()=>{const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y);f.advance(120);f.emit('pointermove',p.x-20,p.y-15);f.advance(500);assert.equal(f.rendered.length,0);f.emit('pointerup',p.x-80,p.y-30);f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');});
test('pointer cancel rolls back a nearly completed sheet',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.92);f.up(p,.92,'right',true);assert.equal(f.el('stage').dataset.spread,'2');});
test('second finger immediately releases held paper before pinch',()=>{const f=fixture(),p=f.held();f.drag(p,.25);f.emit('pointerdown',p.x+50,p.y+60,2);assert.equal(f.el('stage').dataset.foldState,'returned');f.emit('pointercancel',p.x,p.y,1);f.emit('pointercancel',p.x+50,p.y+60,2);f.advance(700);assert.equal(f.el('stage').dataset.spread,'2');});
test('window blur rolls back without committing',()=>{const f=fixture(),p=f.held();f.drag(p,.8);f.events.blur();f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('resize during curl rolls back safely',()=>{const f=fixture(),p=f.held();f.drag(p,.6);f.el('stage').clientWidth=390;f.resize();f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('automatic next uses the same curved mesh and completes',()=>{const f=fixture();f.el('next').onclick();assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'settling-forward');f.advance(600);assert.equal(f.el('stage').dataset.spread,'4');});
test('rapid next buttons are queued rather than losing pages',()=>{const f=fixture();f.el('next').onclick();f.el('next').onclick();f.el('next').onclick();f.advance(1800);assert.equal(f.el('stage').dataset.spread,'8');});
test('first and final pages cannot turn beyond the book',()=>{for(const [start,side] of [[0,'left'],[1252,'right']]){const f=fixture(start),p=f.held(side);assert.equal(f.rendered.length,0);f.up(p,.8,side);assert.equal(f.el('stage').dataset.spread,String(start));}});
test('near-spine and extreme-height contact does not create NaN',()=>{const f=fixture(),p=f.held('right',14);f.advance(300);f.drag(p,.65);f.advance(200);f.up(p,.65);assert.equal(f.el('stage').dataset.spread,'4');});
test('quick single finger remains a quick turn, not a long-press mode',()=>{const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y);f.advance(80);f.emit('pointermove',p.x-70,p.y);f.advance(35);f.emit('pointerup',p.x-100,p.y);f.advance(650);assert.equal(f.el('stage').dataset.spread,'4');});
test('wrong-direction fast swipe still does not turn',()=>{const f=fixture(),p=f.at('left');f.emit('pointerdown',p.x,p.y);f.advance(80);f.emit('pointermove',p.x-70,p.y);f.advance(35);f.emit('pointerup',p.x-100,p.y);f.advance(650);assert.equal(f.el('stage').dataset.spread,'2');});
test('two-finger bursts still turn 5, 10, 20 sheets with curved transitions',()=>{
  const f=fixture();
  for(let k=0;k<3;k++){
    const p=f.at();f.emit('pointerdown',p.x,p.y,1);f.advance(2);f.emit('pointerdown',p.x,p.y+50,2);
    for(let i=1;i<=12;i++){f.advance(10);f.emit('pointermove',p.x-i*10,p.y,1);f.emit('pointermove',p.x-i*10,p.y+50,2);}
    f.emit('pointerup',p.x-120,p.y,1);f.emit('pointerup',p.x-120,p.y+50,2);f.advance(420);
  }
  assert.deepEqual(f.rendered.map(x=>x.count),[5,10,20]);assert.equal(f.el('stage').dataset.spread,'72');
});
test('changing finger spacing cancels any hold timer and only zooms',()=>{
  const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y,1);f.advance(100);f.emit('pointerdown',p.x,p.y+60,2);
  f.advance(100);f.emit('pointermove',p.x-30,p.y-30,1);f.emit('pointermove',p.x+30,p.y+100,2);f.advance(500);
  f.emit('pointerup',p.x-30,p.y-30,1);f.emit('pointerup',p.x+30,p.y+100,2);f.advance(600);
  assert.equal(f.rendered.length,0);assert.equal(f.el('stage').dataset.spread,'2');assert.ok(Number(f.el('stage').dataset.scale)>p.scale);
});
test('opening the index returns a held paper without hiding or replacing the reading stage',async()=>{
  const f=fixture(),stage=f.el('stage'),book=f.el('book'),original=f.el('right-paper').innerHTML,p=f.held();
  assert.equal(f.el('physical-index-host').inert,true,'compressed reading index must not capture input');
  f.drag(p,.55);f.el('view-edge').onclick();await f.advanceAsync(160);
  assert.equal(stage.dataset.spread,'2');assert.equal(stage.dataset.foldState,'returned');assert.equal(f.el('right-paper').innerHTML,original);
  assert.notEqual(stage.style.visibility,'hidden');assert.notEqual(stage.style.display,'none');assert.equal(stage.hidden,false);
  assert.equal(stage.dataset.scene,'closing');assert.ok(Number(stage.dataset.sceneProgress)>0&&Number(stage.dataset.sceneProgress)<1);
  await f.untilScene('edge');assert.equal(f.el('book'),book);assert.equal(stage.dataset.spread,'2');assert.ok(Math.abs(Number(stage.dataset.sceneProgress)-1)<.001);assert.equal(f.el('physical-index-host').inert,false);
  f.emit('pointerup',p.x,p.y);await f.advanceAsync(500);assert.equal(stage.dataset.spread,'2');
  f.el('scene-back').onclick();await f.advanceAsync(160);assert.equal(stage.dataset.scene,'opening');
  await f.untilScene('reading');assert.equal(stage.dataset.spread,'2');assert.equal(f.el('book'),book);assert.notEqual(stage.style.visibility,'hidden');assert.equal(f.el('physical-index-host').inert,true);
});
test('directory round trip preserves the custom reading pose and does not save scene camera values',async()=>{
  const f=fixture(),p=f.at();f.el('focus-right').onclick();const q=f.at();
  f.emit('pointerdown',q.x,q.y);f.advance(180);f.emit('pointermove',q.x-45,q.y-30);f.advance(250);f.emit('pointerup',q.x-45,q.y-30);
  const stage=f.el('stage'),pose=['scale','x','y'].map(k=>Number(stage.dataset[k])),before=f.saved.length,lastSaved=f.saved.at(-1).value;
  f.el('view-edge').onclick();await f.untilScene('edge');f.el('scene-back').onclick();await f.untilScene('reading');
  ['scale','x','y'].forEach((k,i)=>assert.ok(Math.abs(Number(stage.dataset[k])-pose[i])<.02,`reading ${k} changed`));
  assert.equal(stage.dataset.spread,'2');assert.ok(f.saved.slice(before).every(s=>s.value.spread===2));assert.ok(Number(stage.dataset.scale)>=p.scale);
  for(const entry of f.saved.slice(before))for(const key of ['zoom','centerX','centerY'])assert.ok(Math.abs(entry.value[key]-lastSaved[key])<.001,`saved scene camera as reading ${key}`);
});
test('digital index contracts to a physical focus before opening the selected book',async()=>{
  const f=fixture(),stage=f.el('stage');f.el('view-edge').onclick();await f.untilScene('edge');
  f.el('scene-digital').onclick();await f.untilScene('digital');assert.ok(Number(stage.dataset.digitalProgress)>.999);
  const target=39,targetSpread=f.context.BIBLE_DATA.books[target].first&~1,at=f.sceneWrites.length;
  f.selectBook(target);await f.advanceAsync(80);assert.equal(stage.dataset.spread,'2');
  await f.untilScene('reading');assert.equal(stage.dataset.spread,String(targetSpread));assert.ok(Number(stage.dataset.digitalProgress)<.001);
  const writes=f.sceneWrites.slice(at),states=writes.filter(s=>s.key==='scene').map(s=>s.value);
  assert.ok(states.includes('focusing'));assert.ok(states.includes('opening'));assert.ok(states.indexOf('focusing')<states.indexOf('opening'));
  assert.ok(f.indexCalls.some(s=>s.type==='focus'&&s.value===target));
  const commits=writes.filter(s=>s.key==='spread'&&s.value===String(targetSpread));assert.equal(commits.length,1);
  assert.ok(commits[0].progress>.95,'target page changed before the closed-book phase');
});
test('directory navigation cancels queued turns and rejects stale reading input',async()=>{
  const f=fixture(),stage=f.el('stage');f.el('next').onclick();f.el('next').onclick();f.el('next').onclick();
  f.advance(120);f.el('view-edge').onclick();await f.untilScene('edge');const spread=stage.dataset.spread,pose=stage.dataset.scale+':'+stage.dataset.x+':'+stage.dataset.y,count=f.rendered.length;
  stage.handlers.keydown({key:'ArrowRight',preventDefault(){}});stage.handlers.keydown({key:'+',preventDefault(){}});
  stage.handlers.wheel({deltaX:40,deltaY:80,ctrlKey:false,metaKey:false,clientX:100,clientY:100,preventDefault(){}});
  const p=f.at();f.emit('pointerdown',p.x,p.y);await f.advanceAsync(400);f.emit('pointerup',p.x-100,p.y);await f.advanceAsync(1200);
  assert.equal(stage.dataset.spread,spread);assert.equal(f.rendered.length,count);assert.equal(stage.dataset.scale+':'+stage.dataset.x+':'+stage.dataset.y,pose);
  f.el('scene-back').onclick();await f.untilScene('reading');await f.advanceAsync(1500);assert.equal(stage.dataset.spread,spread);
});
test('resizing during closing and digital navigation keeps the scene and finite camera geometry',async()=>{
  const f=fixture(),stage=f.el('stage');f.el('view-edge').onclick();await f.advanceAsync(260);
  stage.clientWidth=390;stage.clientHeight=760;f.resize();assert.equal(stage.dataset.scene,'closing');
  await f.untilScene('edge');f.el('scene-digital').onclick();await f.untilScene('digital');
  stage.clientWidth=844;stage.clientHeight=390;f.resize();await f.advanceAsync(100);
  assert.equal(stage.dataset.scene,'digital');assert.equal(stage.dataset.spread,'2');
  for(const id of ['book','book-volume','left-half','index-placement'])assert.ok(!/NaN|Infinity/.test(f.el(id).style.transform||''),`${id} has invalid geometry`);
  f.el('scene-back').onclick();await f.untilScene('reading');assert.equal(stage.dataset.spread,'2');
  ['scale','x','y'].forEach(k=>assert.ok(Number.isFinite(Number(stage.dataset[k]))));
});
test('reduced-motion navigation still completes the same semantic round trip',async()=>{
  const f=fixture(2,{reducedMotion:true});f.el('view-edge').onclick();await f.untilScene('edge');
  f.el('scene-digital').onclick();await f.untilScene('digital');f.closeIndex();await f.untilScene('reading');
  assert.equal(f.el('stage').dataset.spread,'2');assert.notEqual(f.el('stage').style.visibility,'hidden');
});
test('duplicate directory requests do not restart or leave overlapping animation owners',async()=>{
  const f=fixture(),stage=f.el('stage');f.el('view-edge').onclick();await f.advanceAsync(120);f.el('view-edge').onclick();
  await f.untilScene('edge');await f.advanceAsync(1500);assert.equal(stage.dataset.scene,'edge');assert.equal(stage.dataset.spread,'2');
  f.el('scene-back').onclick();await f.untilScene('reading');await f.advanceAsync(1500);assert.equal(stage.dataset.scene,'reading');
});
test('navigation invalidates every asynchronous demo and its late cleanup callbacks',async()=>{
  for(const id of ['demo-pan','demo-burst','demo-peek']){
    const f=fixture(),stage=f.el('stage'),demo=f.el(id).onclick();await f.advanceAsync(200);
    const page=stage.dataset.spread;f.el('view-edge').onclick();await f.untilScene('edge');await f.advanceAsync(7000);await demo;
    assert.equal(stage.dataset.scene,'edge',`${id} resumed or cancelled the new navigation`);assert.equal(stage.dataset.spread,page,`${id} changed page after navigation`);
    assert.equal(f.el('touch-ring').style.display,'none',`${id} left a stale touch marker`);
    f.el('scene-back').onclick();await f.untilScene('reading');assert.equal(stage.dataset.spread,page);
  }
});
test('returning from digital mode resets the physical-directory toggle semantics',async()=>{
  const f=fixture();f.el('view-edge').onclick();await f.untilScene('edge');f.el('scene-digital').onclick();await f.untilScene('digital');
  assert.equal(f.el('scene-digital').getAttribute('aria-pressed'),'true');
  f.el('scene-back').onclick();await f.untilScene('reading');f.el('view-edge').onclick();await f.untilScene('edge');
  assert.equal(f.el('stage').dataset.digitalProgress,'0.0000');assert.equal(f.el('scene-digital').getAttribute('aria-pressed'),'false');
  assert.ok(f.el('scene-digital').textContent.includes('展开'));
});
test('a second book selection changes the camera target continuously rather than teleporting',async()=>{
  const f=fixture(2,{focusRects:{39:{x:120,y:130},65:{x:350,y:620}}}),stage=f.el('stage');
  const camera=()=>{const m=f.el('book').style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,0\) scale\(([-\d.]+)\)/);assert.ok(m);return m.slice(1).map(Number);};
  f.el('view-edge').onclick();await f.untilScene('edge');f.selectBook(39);await f.advanceAsync(250);const before=camera();
  f.selectBook(65);await f.advanceAsync(16);const after=camera();
  assert.ok(Math.hypot(after[0]-before[0],after[1]-before[1])<20,'new focus rect caused a one-frame camera jump');
  await f.untilScene('reading');assert.equal(stage.dataset.spread,String(f.context.BIBLE_DATA.books[65].first&~1));
  const changed=f.sceneWrites.filter(s=>s.key==='spread'&&s.value!=='2');assert.equal(changed.length,1,'superseded selection committed a page');
});
test('visibility interruption invalidates the demo instead of resuming its later page turns',async()=>{
  const f=fixture(),demo=f.el('demo-burst').onclick();await f.advanceAsync(200);const spread=f.el('stage').dataset.spread;
  f.context.document.hidden=true;f.events['document:visibilitychange']();await f.advanceAsync(7000);await demo;
  assert.equal(f.el('stage').dataset.spread,spread);assert.equal(f.el('touch-ring').style.display,'none');
});
test('only a completed single tap toggles immersion while double tap and navigation cancel that intent',async()=>{
  const f=fixture();let taps=0;f.context.addEventListener('paper-reader-tap',()=>taps++);
  const tap=()=>{const p=f.at();f.emit('pointerdown',p.x,p.y);f.advance(70);f.emit('pointerup',p.x,p.y);};
  tap();f.advance(300);assert.equal(taps,0,'chrome toggled before the double-tap window ended');f.advance(100);assert.equal(taps,1);
  const scale=Number(f.el('stage').dataset.scale);tap();f.advance(120);tap();f.advance(500);
  assert.equal(taps,1,'double tap also toggled chrome');assert.ok(Number(f.el('stage').dataset.scale)>scale,'double tap lost its zoom behavior');
  tap();f.advance(100);f.el('view-edge').onclick();await f.untilScene('edge');assert.equal(taps,1,'old tap toggled chrome during navigation');
});
// The camera and cover dimensions are not allowed to masquerade as paper mass.
function materialState(f){
  const d=f.el('stage').dataset,m={};
  for(const key of ['leftSheets','rightSheets','leftDepth','rightDepth','materialSpread']){
    m[key]=Number(d[key]);assert.ok(Number.isFinite(m[key]),`missing/invalid ${key}: ${d[key]}`);
  }
  assert.ok(Math.abs(m.leftSheets+m.rightSheets-627)<.002,'paper sheets were created or lost');
  assert.ok(Math.abs(m.leftDepth+m.rightDepth-36)<.002,'paper depth was created or lost');
  return m;
}
function closeTo(actual,expected,message){assert.ok(Math.abs(actual-expected)<.002,`${message}: ${actual} != ${expected}`);}
function latestMaterial(f){return f.indexCalls.filter(c=>c.type==='material').at(-1);}
function indexWidth(f){
  assert.equal(f.el('physical-index-host').style.transform,'none','no artificial index enlargement');
  const frame=f.indexCalls.filter(c=>c.type==='geometry').at(-1).value;
  return Number(f.el('stage').dataset.leftAngle)===90?frame.totalDepth:frame.rightMatrix[0]*(frame.totalDepth-frame.splitDepth);
}

test('opening Genesis, Jude and the final spread derives both stacks from their real sheet counts',()=>{
  for(const [spread,left,right] of [[0,0,627],[1232,616,11],[1252,626,1]]){
    const f=fixture(spread),m=materialState(f),expected=Material.compute(spread,1254,f.context.BIBLE_DATA.books);
    closeTo(m.leftSheets,left,'left sheets');closeTo(m.rightSheets,right,'right sheets');
    closeTo(m.leftDepth,expected.leftDepth,'left depth');closeTo(m.rightDepth,expected.rightDepth,'right depth');
    closeTo(m.materialSpread,spread,'material spread');
    assert.ok(latestMaterial(f),'index never received the reading material');
    closeTo(latestMaterial(f).value.rightSheets,right,'index received stale paper quantity');
    closeTo(indexWidth(f),expected.rightDepth*.55,'actual right index width');
    closeTo(parseFloat(f.el('left-reading-edge').style.width),expected.leftDepth*.55,'actual left edge width');
    closeTo(Number(f.el('left-stack').dataset.paperDepth),expected.leftDepth,'left stack rendered depth');
    closeTo(Number(f.el('right-stack').dataset.paperDepth),expected.rightDepth,'right stack rendered depth');
    if(spread===0)assert.equal(f.el('left-stack').style.opacity,'0','zero-sheet side retained a paper slab');
  }
});
test('Jude leaves a subpixel right paper edge and only Jude/Revelation right-side ownership',()=>{
  const f=fixture(1232),m=materialState(f),state=latestMaterial(f).value;
  assert.ok(m.rightDepth<.7,'near-end right edge still resembles a whole book');
  assert.ok(indexWidth(f)<.4,'visible right index kept the constant full-book strip');
  assert.equal(f.el('physical-index-host').dataset.readingBooks,'JUD,REV');
  assert.equal(f.el('left-reading-edge').innerHTML,'','reading edge must not squeeze book abbreviations into a stripe');
  assert.equal(f.el('left-reading-edge').dataset.books.split(',').length,64,'passed-book ownership is retained without painting labels');
  assert.ok(m.leftDepth>35,'read pages did not accumulate on the left');
  assert.deepEqual(Array.from(state.rightBooks,b=>b.code),['JUD','REV']);
  assert.equal(state.rightBookIndices.length,2);assert.equal(state.leftBookIndices.length,64);
  assert.ok(!state.rightBookIndices.some(i=>i<39),'Old Testament labels remained on the right');
});
test('a forward held leaf continuously transfers conserved thickness without committing the reading page',()=>{
  const f=fixture(1232),before=materialState(f),saved=f.saved.length,p=f.held();
  for(const progress of [.1,.3,.55,.8]){
    f.advance(80);f.drag(p,progress);const m=materialState(f);
    assert.ok(m.leftSheets>before.leftSheets&&m.leftSheets<before.leftSheets+1);
    assert.ok(m.rightSheets<before.rightSheets&&m.rightSheets>before.rightSheets-1);
    assert.equal(f.el('stage').dataset.spread,'1232');assert.equal(f.saved.length,saved,'temporary paper pose was persisted');
  }
  f.up(p,.8,'right',true);const restored=materialState(f);
  for(const key of Object.keys(before))closeTo(restored[key],before[key],`cancel did not restore ${key}`);
  assert.equal(f.el('stage').dataset.spread,'1232');
});
test('reverse leaf motion restores thickness before cancellation and a completed back turn moves one sheet right',()=>{
  const f=fixture(1232),before=materialState(f),p=f.held();
  f.advance(100);f.drag(p,.7);const farther=materialState(f);
  f.advance(160);f.drag(p,.3);const back=materialState(f);
  assert.ok(back.rightSheets>farther.rightSheets&&back.leftSheets<farther.leftSheets,'paper thickness did not follow the finger back');
  f.up(p,.3,'right',true);closeTo(materialState(f).rightSheets,before.rightSheets,'cancelled preview');
  const q=f.held('left');f.advance(150);f.drag(q,.7,'left');const preview=materialState(f);
  assert.ok(preview.rightSheets>before.rightSheets);f.advance(200);f.up(q,.7,'left');
  const after=materialState(f);assert.equal(f.el('stage').dataset.spread,'1230');
  closeTo(after.leftSheets,615,'back-turn left sheets');closeTo(after.rightSheets,12,'back-turn right sheets');
});
test('multi-sheet quick turns and the automatic-turn queue conserve material on every sampled frame',()=>{
  const f=fixture(1160);
  for(let k=0;k<3;k++){
    const p=f.at();f.emit('pointerdown',p.x,p.y,1);f.advance(2);f.emit('pointerdown',p.x,p.y+50,2);
    for(let i=1;i<=12;i++){f.advance(10);f.emit('pointermove',p.x-i*10,p.y,1);f.emit('pointermove',p.x-i*10,p.y+50,2);}
    f.emit('pointerup',p.x-120,p.y,1);f.emit('pointerup',p.x-120,p.y+50,2);
    for(let i=0;i<7;i++){f.advance(60);materialState(f);}
  }
  assert.deepEqual(f.rendered.map(x=>x.count),[5,10,20]);
  const before=materialState(f);closeTo(before.leftSheets,615,'bundle leaves');
  f.el('next').onclick();f.el('next').onclick();
  for(let i=0;i<80;i++){f.advance(16);materialState(f);}
  closeTo(materialState(f).leftSheets,617,'queued leaf count');
});
test('opening the directory mid-curl rolls material back, and returning keeps the thin Jude edge',async()=>{
  const f=fixture(1232),before=materialState(f),p=f.held();f.advance(120);f.drag(p,.75);
  assert.ok(materialState(f).materialSpread>1232);f.el('view-edge').onclick();await f.untilScene('edge');
  const closed=materialState(f);closeTo(closed.materialSpread,1232,'cancel before closing');
  closeTo(closed.rightSheets,11,'closed-book camera must not change reading allocation');
  closeTo(Number(f.el('left-stack').dataset.paperDepth),before.leftDepth,'closed left half keeps its own paper');
  closeTo(Number(f.el('right-stack').dataset.paperDepth),before.rightDepth,'closed right half keeps its own paper');
  closeTo(indexWidth(f),36,'closed directory retains actual paper thickness');
  assert.ok(f.indexCalls.some(c=>c.type==='material'&&c.assembly>.99),'closed directory never assembled the full book');
  f.el('scene-back').onclick();await f.untilScene('reading');
  const after=materialState(f);for(const key of Object.keys(before))closeTo(after[key],before[key],`directory changed ${key}`);
  assert.ok(latestMaterial(f).assembly<.001,'reading edge did not separate from full-book directory');
  assert.ok(indexWidth(f)<.4,'directory return resurrected full-book reading edge');
});
test('selecting Jude changes material only while closed and opens with the target thin edge',async()=>{
  const f=fixture(0);f.el('view-edge').onclick();await f.untilScene('edge');const at=f.sceneWrites.length;
  f.selectBook(64);await f.advanceAsync(80);closeTo(materialState(f).rightSheets,627,'target material changed before focus');
  await f.untilScene('reading');assert.equal(f.el('stage').dataset.spread,'1232');const m=materialState(f);
  closeTo(m.leftSheets,616,'target left sheets');closeTo(m.rightSheets,11,'target right sheets');assert.ok(m.rightDepth<.7);
  const firstTarget=f.sceneWrites.slice(at).find(w=>w.key==='rightSheets'&&Number(w.value)===11);
  assert.ok(firstTarget,'target material was not applied');assert.ok(firstTarget.progress>.99,'paper allocation changed before the closed cover hid it');
  assert.deepEqual(Array.from(latestMaterial(f).value.rightBooks,b=>b.code),['JUD','REV']);
});
test('zoom and resize do not alter material quantity or resurrect the full right edge',()=>{
  const f=fixture(1232),before=materialState(f);f.el('focus-right').onclick();f.el('zoom-in').onclick();
  f.el('stage').clientWidth=390;f.el('stage').clientHeight=844;f.resize();
  const after=materialState(f);for(const key of Object.keys(before))closeTo(after[key],before[key],`viewport changed ${key}`);
});
test('a short tap fans only the chosen paper edge without closing or turning a page',async()=>{
  for(const side of ['left','right']){
    const f=fixture(920),stage=f.el('stage'),p=f.at(),px=Number(stage.dataset.x)+(side==='left'?0:960)*p.scale;
    f.emit('pointerdown',px,p.y);f.advance(90);f.emit('pointerup',px,p.y);
    assert.equal(stage.dataset.lastGesture,'edge-tap');await f.untilScene('fan');assert.equal(stage.dataset.fanSide,side);closeTo(Number(stage.dataset.sceneProgress),0,'fan must not close book');closeTo(Number(stage.dataset.fanAmount),1,'fan endpoint');
    assert.equal(stage.dataset.spread,'920');assert.equal(f.rendered.length,0);
  }
});
test('dragging from an edge pans rather than accidentally opening the index',async()=>{
  const f=fixture(920),stage=f.el('stage'),p=f.at(),px=Number(stage.dataset.x)+960*p.scale;
  f.emit('pointerdown',px,p.y);f.advance(400);f.emit('pointermove',px-24,p.y+35);f.advance(300);f.emit('pointerup',px-30,p.y+42);
  await f.advanceAsync(500);assert.equal(stage.dataset.scene,'reading');assert.equal(stage.dataset.spread,'920');assert.equal(f.rendered.length,0);
});
test('keyboard edge entry splays the chosen side without rotating rigid halves',async()=>{
  const f=fixture(920),stage=f.el('stage');f.el('left-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});
  for(let n=0;n<120;n++){
    await f.advanceAsync(16);
    const left=Number(stage.dataset.leftAngle),right=Number(stage.dataset.rightAngle);
    assert.ok(left>=0&&left<=90);closeTo(left,-right,'symmetrical hinges');assert.equal(f.el('book-volume').style.transform,'none');
    closeTo(Number(f.el('left-stack').dataset.paperDepth),Material.compute(920,1254).leftDepth,'left material stays left during closure');
  }
  await f.untilScene('fan');closeTo(Number(stage.dataset.leftAngle),0,'left remains open');closeTo(Number(stage.dataset.rightAngle),0,'right remains open');assert.equal(stage.dataset.fanSide,'left');
});
test('ribbon return uses closed-edge navigation and restores the bookmarked reading window',async()=>{
  const f=fixture(1174),stage=f.el('stage'),target=920,pose={zoom:2,cx:440,cy:380,focus:'custom'};
  f.navigateRibbon(target,pose);await f.advanceAsync(100);assert.equal(stage.dataset.spread,'1174');
  await f.untilScene('reading');assert.equal(stage.dataset.spread,String(target));
  const commits=f.sceneWrites.filter(w=>w.key==='spread'&&w.value===String(target));assert.equal(commits.length,1);assert.ok(commits[0].progress>.99);
  const saved=f.saved.at(-1).value;closeTo(saved.zoom,2,'ribbon restores zoom');closeTo(saved.centerX,440,'ribbon restores horizontal anchor');closeTo(saved.centerY,380,'ribbon restores vertical anchor');
  assert.ok(f.ribbonCalls.some(c=>c.reading===false));assert.equal(f.ribbonCalls.at(-1).reading,true);
});
test('a cancelled ribbon journey never commits its old destination later',async()=>{
  const f=fixture(1174);f.navigateRibbon(920);await f.advanceAsync(300);f.el('scene-back').onclick();await f.untilScene('reading');await f.advanceAsync(5000);
  assert.equal(f.el('stage').dataset.spread,'1174');
});
test('zoomed reading can pan the complete paper edge and both ribbon tails into view',()=>{
  const f=fixture(920),stage=f.el('stage');f.el('focus-left').onclick();const scale=Number(stage.dataset.scale),left=Material.compute(920,1254).leftDepth;
  assert.ok(Number(stage.dataset.x)-left*.55*scale>=20,'left focus crops the actual paper edge');
  stage.handlers.wheel({deltaX:-10000,deltaY:10000,ctrlKey:false,metaKey:false,clientX:100,clientY:100,preventDefault(){}});
  const x=Number(stage.dataset.x),y=Number(stage.dataset.y);
  assert.ok(x-(left*.55+2.1)*scale>=20,'left leather edge remains clipped at maximum pan');
  assert.ok(y+765*scale<stage.clientHeight,'book-bottom ribbon tips cannot be brought onscreen');
});
test('markup owns two hinged halves, physical edge controls and no front-cover scene',()=>{
  const html=fs.readFileSync('index.html','utf8');assert.match(html,/id="right-half"/);assert.match(html,/id="left-half"/);
  assert.match(html,/id="left-edge-open"/);assert.match(html,/id="right-edge-open"/);assert.match(html,/id="ribbon-bookmarks"/);
  assert.doesNotMatch(html,/class="front-cover"/);
});
test('closed selection keeps every real fore-edge point fixed and opens at the exact selected sheet',async()=>{
  const K=require('./book-kinematics.js');
  for(const start of [0,920,1232]){
    const f=fixture(start),stage=f.el('stage');f.el('view-edge').onclick();await f.untilScene('edge');
    const before=f.indexCalls.filter(c=>c.type==='geometry').at(-1).value,original=Material.compute(start,1254);
    f.selectBook(11);await f.untilScene('opening');
    const after=f.indexCalls.filter(c=>c.type==='geometry').at(-1).value,target=Material.compute(f.context.BIBLE_DATA.books[11].first&~1,1254);
    for(const key of ['leftMatrix','rightMatrix'])for(let i=0;i<16;i++)closeTo(after[key][i],before[key][i],'closed surface did not preserve world coordinate');
    for(const s of [0,3,18,32,36]){
      const a=K.foreedgePoint('left',s,420,original,1),b=K.foreedgePoint('right',s,420,target,1);
      for(const key of ['x','y','z'])closeTo(a[key],b[key],'closed material relocation');
    }
    const m=f.el('right-half').style.transform.slice(9,-1).split(',').map(Number);
    closeTo(m[12],480+target.leftDepth-18,'opening axis must start at selected absolute layer');
    assert.equal(stage.dataset.spread,String(target.spread));await f.untilScene('reading');
  }
});
test('closed cross-book selection never moves the binding or either exposed ribbon tip',async()=>{
  const K=require('./book-kinematics.js');
  for(const [start,target] of [[0,64],[1232,0],[920,11]]){
    const f=fixture(start);f.el('view-edge').onclick();await f.untilScene('edge');
    const before=f.el('ribbon-bookmarks').style.transform,beforeMatrix=before.slice(9,-1).split(',').map(Number);
    closeTo(beforeMatrix[12],480,'ribbons must attach at the fixed middle of the binding');
    f.selectBook(target);await f.untilScene('opening');
    const after=f.el('ribbon-bookmarks').style.transform,afterMatrix=after.slice(9,-1).split(',').map(Number);
    assert.equal(after,before,'closed split change moved the entire silk host');
    // Their SVG endpoints are independent of the current-page `here` flag;
    // both a fixed tip and the physical binding now retain world coordinates.
    for(const [x,y] of [[480,8],[456,733],[504,747]]){
      const a=K.transformPoint(beforeMatrix,x,y),b=K.transformPoint(afterMatrix,x,y);
      for(const axis of ['x','y','z'])closeTo(a[axis],b[axis],'closed ribbon endpoint '+axis);
    }
    assert.equal(f.el('stage').dataset.spread,String(f.context.BIBLE_DATA.books[target].first&~1));
    await f.untilScene('reading');
  }
});
test('physical-side pan moves only the camera and never changes paper split or reading storage',async()=>{
  const f=fixture(920),stage=f.el('stage');f.el('view-edge').onclick();await f.untilScene('edge');
  const split=f.indexCalls.filter(c=>c.type==='geometry').at(-1).value.splitDepth,saved=f.saved.length,before=f.el('book').style.transform;
  stage.handlers.wheel({deltaY:120,preventDefault(){}});assert.notEqual(f.el('book').style.transform,before);
  closeTo(f.indexCalls.filter(c=>c.type==='geometry').at(-1).value.splitDepth,split,'panning moved paper');
  assert.equal(stage.dataset.spread,'920');assert.equal(f.saved.length,saved);
});
test('fanned physical cut selection turns the chosen packet directly, never through a closed directory',async()=>{
  for(const [start,side,i] of [[0,'right',18],[1232,'left',11]]){
    const f=fixture(start),stage=f.el('stage');f.el(side+'-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
    const before=f.sceneWrites.length,target=f.context.BIBLE_DATA.books[i].first&~1;f.selectBook(i);
    await f.untilScene('fan-turn');assert.equal(stage.dataset.spread,String(start));
    assert.equal(f.rendered.at(-1).count,Math.abs(target-start)/2);
    await f.advanceAsync(450);assert.ok(Number(stage.dataset.fanAmount)>0&&Number(stage.dataset.fanAmount)<1);
    assert.equal(stage.dataset.spread,String(start),'preview must not commit destination early');
    await f.untilScene('reading');assert.equal(stage.dataset.spread,String(target));
    assert.ok(f.sceneWrites.slice(before).filter(w=>w.key==='sceneProgress').every(w=>Number(w.value)===0),'cut selection closed book');
    assert.equal(f.el('book').classList.contains('has-curved-leaves'),false);
  }
});
test('a later member on a left carrier retracts it and turns a real right-side packet',async()=>{
  const source=fixture().context.BIBLE_DATA.books,groupStart=source.find(b=>b.code==='1JN'),i=source.findIndex(b=>b.code==='JUD');
  const start=(groupStart.first&~1)+2,target=source[i].first&~1,f=fixture(start,{depth:true}),stage=f.el('stage');
  assert.ok(target>start);f.el('left-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
  const saveCount=f.saved.length,before=f.sceneWrites.length;f.selectBook(i);
  await f.advanceAsync(320);assert.equal(stage.dataset.fanSide,'left');assert.ok(Number(stage.dataset.fanAmount)<1);assert.equal(stage.dataset.spread,String(start));
  assert.equal(f.depthFrames.filter(x=>x.frame.packet).length,0,'no packet starts on the wrong side');
  await f.untilScene('fan-turn');assert.equal(stage.dataset.fanSide,'right');assert.equal(f.saved.length,saveCount);
  const first=f.depthFrames.find(x=>x.frame.packet).frame.packet;assert.equal(first.source,'right');assert.equal(first.s0,Material.compute(start,1254).leftDepth);assert.equal(first.s1,Material.compute(target,1254).leftDepth);
  await f.untilScene('reading');assert.equal(stage.dataset.spread,String(target));
  assert.ok(f.sceneWrites.slice(before).filter(w=>w.key==='sceneProgress').every(w=>Number(w.value)===0));
});
test('cancelling while changing carrier sides cannot start or commit the later target',async()=>{
  const source=fixture().context.BIBLE_DATA.books,start=(source.find(b=>b.code==='1JN').first&~1)+2,i=source.findIndex(b=>b.code==='JUD');
  for(const elapsed of [250,900]){
    const f=fixture(start,{depth:true}),stage=f.el('stage');f.el('left-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
    f.selectBook(i);await f.advanceAsync(elapsed);f.closeIndex();await f.untilScene('reading');await f.advanceAsync(3000);
    assert.equal(stage.dataset.spread,String(start));assert.equal(f.depthFrames.filter(x=>x.frame.packet).length,0);
  }
});
test('returning during a direct cut turn rolls back the target and restores the reading pose',async()=>{
  const f=fixture(100),stage=f.el('stage');f.el('focus-right').onclick();const before=['scale','x','y'].map(k=>stage.dataset[k]);
  f.el('right-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
  f.selectBook(18);await f.advanceAsync(550);const beforeReturn=Number(stage.dataset.fanAmount);f.el('scene-back').onclick();closeTo(Number(stage.dataset.fanAmount),beforeReturn,'return cannot jump to full fan');await f.advanceAsync(180);assert.ok(Number(stage.dataset.fanAmount)<1,'return jumped instead of reversing the held packet');await f.untilScene('reading');await f.advanceAsync(2000);
  assert.equal(stage.dataset.spread,'100');assert.deepEqual(['scale','x','y'].map(k=>stage.dataset[k]),before);
});
test('depth packet: first paint keeps the fan, no mid-turn storage and last pose equals flat reading',async()=>{
  for(const [start,side,i]of [[0,'right',39],[970,'left',18]]){
    const f=fixture(start,{depth:true}),stage=f.el('stage'),book=f.el('book');
    f.el(side+'-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
    const initialPose=book.style.transform,saveCount=f.saved.length,k=f.context.PaperBookKinematics;
    f.selectBook(i);await f.untilScene('fan-turn');
    const cuts=f.depthFrames.filter(x=>x.frame.packet);
    assert.equal(cuts[0].pose,initialPose);assert.equal(cuts[0].frame.packet.progress,0);
    assert.equal(stage.dataset.spread,String(start));
    await f.advanceAsync(700);
    assert.equal(stage.dataset.spread,String(start));assert.equal(f.saved.length,saveCount);
    const mid=f.depthFrames.at(-1).frame;
    assert.ok(mid.packet.progress>0&&mid.packet.progress<1);
    assert.equal(mid.packet.sections.reduce((t,s)=>t+s.hi-s.lo,0),36,'moving depth is not duplicated into stationary stacks');
    assert.equal(f.rendered.length,0,'index packet must not use the legacy curl projection');
    await f.untilScene('reading');
    const page=f.context.BIBLE_DATA.books[i].first&~1;
    assert.equal(stage.dataset.spread,String(page));
    const last=f.depthFrames.filter(x=>x.frame.packet).at(-1);
    assert.equal(last.frame.packet.progress,1);assert.deepEqual(cameraPose(last.pose),cameraPose(book.style.transform));
    assert.equal(last.frame.packet.s1,Material.compute(page,f.context.BIBLE_DATA.pages.length).leftDepth);
  }
});
test('depth packet: reverse settles along the same path before any page commit',async()=>{
  const f=fixture(570,{depth:true}),stage=f.el('stage'),book=f.el('book'),readPose=book.style.transform;
  f.el('right-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
  const fanned=book.style.transform;f.selectBook(39);await f.advanceAsync(800);
  const p=Number(stage.dataset.foldProgress),pose=book.style.transform;f.closeIndex();assert.equal(book.style.transform,pose);
  await f.advanceAsync(180);assert.ok(Number(stage.dataset.foldProgress)<p&&Number(stage.dataset.foldProgress)>0);
  await f.untilScene('reading');assert.equal(stage.dataset.spread,'570');assert.deepEqual(cameraPose(book.style.transform),cameraPose(readPose));
  const last=f.depthFrames.filter(x=>x.frame.packet).at(-1);assert.equal(last.frame.packet.progress,0);assert.equal(last.pose,fanned);
});
test('fan vertical browsing only moves camera and blank tap puts the same paper back',async()=>{
  const f=fixture(570,{width:390,height:844}),stage=f.el('stage');f.el('right-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
  const before=f.el('book').style.transform,count=f.saved.length;stage.handlers.wheel({deltaY:120,preventDefault(){}});
  assert.notEqual(f.el('book').style.transform,before);assert.equal(stage.dataset.spread,'570');assert.equal(f.saved.length,count);
  f.emit('pointerdown',20,300);f.advance(60);f.emit('pointerup',20,300);await f.untilScene('reading');assert.equal(stage.dataset.spread,'570');
});
test('fan digital fallback retains the same book and retracts before opening a different cut',async()=>{
  const f=fixture(570),stage=f.el('stage');f.el('left-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.untilScene('fan');
  f.el('scene-digital').onclick();await f.untilScene('digital');closeTo(Number(stage.dataset.fanAmount),0,'fan retracted into closed book');
  f.selectBook(64);await f.untilScene('reading');assert.equal(stage.dataset.spread,'1232');
});
test('an empty first-page left side cannot fabricate a fan or extra paper',async()=>{
  const f=fixture(0);f.el('left-edge-open').dispatchEvent({type:'click',detail:0,preventDefault(){}});await f.advanceAsync(1500);
  assert.equal(f.el('stage').dataset.scene,'reading');assert.equal(f.el('stage').dataset.leftSheets,'0.0000');
});
// These assertions protect the verified browser fix's controller/style
// contract. They do NOT measure text rasterization or replace 218% visual QA.
test('reading promotion override is scoped away from page curls and preserves the shared 3D lens',()=>{
  const css=fs.readFileSync('book-scene.css','utf8'),base=fs.readFileSync('style.css','utf8');
  const rule=css.match(/body\[data-paper-scene=['"]reading['"]\]\s+\.book:not\(\.curl-active\)\s*\{([^}]+)\}/);
  assert.ok(rule,'only settled reading releases the pre-promoted book layer');
  assert.match(rule[1],/^\s*will-change\s*:\s*auto\s*;?\s*$/,'do not flatten or replace the book perspective to fix text');
  assert.match(base,/\.book\{[^}]*will-change:transform/,'directory and active curls retain the existing promotion hint');
  assert.match(css,/\.book\{[^}]*transform-style:preserve-3d;perspective:1800px/);
  assert.match(css,/\.book:not\(\.has-curved-leaves\) \.paper\{[^}]*translateZ\(300px\) scale\(\.833333333333\)/,
    'retain the calibrated flat-ink depth isolation and its inverse projection');
});
test('maximum reading zoom keeps exact vector glyphs and uses a 2D camera without page changes',()=>{
  const f=fixture(1174,{width:1600,height:1168,depth:true});
  const fittedScale=cameraPose(f.el('book').style.transform)[2];
  const svg=['left-paper','right-paper'].map(id=>f.el(id).innerHTML),before=materialState(f);
  for(let i=0;i<4;i++)f.el('zoom-in').onclick();
  assert.equal(f.el('zoom-value').textContent,Math.round(3.2/fittedScale*100)+'%');assert.equal(f.el('stage').dataset.scale,'3.2000');
  assertVectorReading(f,1174,svg);assert.equal(f.rendered.length,0);
  for(const key of Object.keys(before))closeTo(materialState(f)[key],before[key],`zoom changed ${key}`);
  const highPose=cameraPose(f.el('book').style.transform);
  f.el('zoom-out').onclick();assertVectorReading(f,1174,svg);
  f.el('zoom-in').onclick();assertVectorReading(f,1174,svg);
  assert.deepEqual(cameraPose(f.el('book').style.transform),highPose,'zoom out/in at the same centre must restore the same camera');
  assert.ok(f.saved.every(s=>s.value.spread===1174),'zoom cannot persist a different opening');
});
test('reading edge zoom and pan update only the retained raster camera, not material or index geometry',()=>{
  const f=fixture(1174,{width:1600,height:1168,depth:true}),stage=f.el('stage');
  const initial=assertDepthReadingView(f),svg=['left-paper','right-paper'].map(id=>f.el(id).innerHTML);
  const geometryCalls=f.indexCalls.filter(c=>c.type==='geometry').length,frames=f.depthFrames.length;
  for(let i=0;i<4;i++)f.el('zoom-in').onclick();
  assert.equal(f.depthFrames.length,frames+4,'every zoom immediately refreshes the depth raster');
  const high=assertDepthReadingView(f);
  assert.equal(high.fineView.camera.scale,3.2);
  for(const key of ['material','shape','packet','printed','close','digital','pick','hideInk'])
    assert.equal(high[key],initial[key],`camera-only redraw cannot alter ${key}`);
  const beforePan=cameraPose(f.el('book').style.transform),beforeFrames=f.depthFrames.length;
  stage.handlers.wheel({deltaX:43,deltaY:57,preventDefault(){}});
  const panned=assertDepthReadingView(f);
  assert.equal(f.depthFrames.length,beforeFrames+1,'wheel pan refreshes the current raster tile');
  assert.notDeepEqual(cameraPose(f.el('book').style.transform).slice(0,2),beforePan.slice(0,2));
  assert.equal(panned.material,high.material);assert.equal(panned.shape,high.shape);
  assert.equal(f.indexCalls.filter(c=>c.type==='geometry').length,geometryCalls,'zoom/pan cannot rebuild index geometry');
  assert.deepEqual(['left-paper','right-paper'].map(id=>f.el(id).innerHTML),svg);
  assert.equal(stage.dataset.spread,'1174');assert.equal(f.rendered.length,0);
  stage.clientWidth=390;stage.clientHeight=844;f.resize();assertDepthReadingView(f);
  f.el('focus-right').onclick();assertDepthReadingView(f);
  f.el('fit-book').onclick();assertDepthReadingView(f);
});
test('directory selection returns to unpromoted vector zoom without changing target scripture geometry',async()=>{
  const f=fixture(1174,{width:1600,height:1168,depth:true}),book=f.el('book');
  for(let i=0;i<3;i++)f.el('zoom-in').onclick();
  const initial=['left-paper','right-paper'].map(id=>f.el(id).innerHTML);
  f.el('view-edge').onclick();await f.untilScene('edge');
  assert.equal(f.el('body').dataset.paperScene,'directory');assert.match(book.style.transform,/^translate3d\(/);
  assert.ok(book.classList.contains('has-curved-leaves'),'directory still renders physical 3D leaves');
  f.el('scene-back').onclick();await f.untilScene('reading');assertVectorReading(f,1174,initial);
  f.el('zoom-out').onclick();f.el('zoom-in').onclick();assertVectorReading(f,1174,initial);
  f.el('view-edge').onclick();await f.untilScene('edge');
  const target=52,page=f.context.BIBLE_DATA.books[target].first&~1;
  f.selectBook(target);await f.untilScene('reading');
  const expected=[page,page+1].map(i=>f.context.PaperPage.svg(f.context.BIBLE_DATA.pages[i],i,f.context.BIBLE_DATA.books));
  assertVectorReading(f,page,expected);
  for(let i=0;i<3;i++)f.el('zoom-in').onclick();assertVectorReading(f,page,expected);
});
test('ordinary turn keeps its curl surface and returns to exact vector text before renewed zoom',async()=>{
  const f=fixture(1174,{width:1600,height:1168,depth:true});
  const fittedScale=cameraPose(f.el('book').style.transform)[2];
  for(let i=0;i<4;i++)f.el('zoom-in').onclick();
  f.el('next').onclick();
  assert.ok(f.el('book').classList.contains('curl-active'),'active curl must stay outside the promotion override');
  assert.equal(f.el('body').dataset.paperScene,'reading');assert.equal(f.rendered.length,1);
  await f.advanceAsync(900);
  const page=1176,expected=[page,page+1].map(i=>f.context.PaperPage.svg(f.context.BIBLE_DATA.pages[i],i,f.context.BIBLE_DATA.books));
  assert.equal(f.el('stage').dataset.foldState,'committed');assertVectorReading(f,page,expected);
  f.el('zoom-out').onclick();assertVectorReading(f,page,expected);
  f.el('zoom-in').onclick();assertVectorReading(f,page,expected);
  assert.equal(f.el('zoom-value').textContent,Math.round(3.2/fittedScale*100)+'%');
});
function readingPoint(f,u,v=352){const [x,y,s]=cameraPose(f.el('book').style.transform);return {x:x+u*s,y:y+v*s};}
test('natural reading exposes a hand cursor and selects the hit label without entering a fan first',async()=>{
  const target=42,f=fixture(570,{depth:true,indexHit:({x,y,side})=>side==='right'&&Math.hypot(x-990,y-352)<8?target:null});
  const p=readingPoint(f,990),stage=f.el('stage'),svg=f.el('right-paper').innerHTML;
  assertDepthReadingView(f);f.emit('pointermove',p.x,p.y);
  assert.equal(stage.style.cursor,'pointer');assert.equal(stage.dataset.indexHover,f.context.BIBLE_DATA.books[target].code);
  f.emit('pointerdown',p.x,p.y);f.advance(70);f.emit('pointerup',p.x,p.y);
  assert.equal(stage.dataset.lastGesture,'index-tap');assert.equal(stage.dataset.scene,'focusing');
  assert.equal(f.el('right-paper').innerHTML,svg,'the reading page remains unchanged until navigation commits');
  assert.ok(!f.sceneWrites.some(s=>s.key==='scene'&&s.value==='fan'),'no preliminary fan mode is required to choose a visible label');
  await f.untilScene('reading');assert.equal(stage.dataset.spread,String(f.context.BIBLE_DATA.books[target].first&~1));
  assertDepthReadingView(f);assert.equal(stage.style.cursor,'');
});
test('a visible back-face label on the left is hit with left ownership and selects its original book',async()=>{
  const calls=[],target=18,f=fixture(970,{depth:true,indexHit:p=>{calls.push(p);return p.side==='left'&&Math.hypot(p.x+35,p.y-352)<8?target:null;}});
  const p=readingPoint(f,-35);f.emit('pointerdown',p.x,p.y);f.advance(60);f.emit('pointerup',p.x,p.y);
  assert.equal(f.el('stage').dataset.lastGesture,'index-tap');assert.ok(calls.every(c=>c.side==='left'));
  await f.untilScene('reading');assert.equal(f.el('stage').dataset.spread,String(f.context.BIBLE_DATA.books[target].first&~1));
});
test('moving or cancelling a label contact never navigates and retains the original reading gesture',()=>{
  for(const cancel of [false,true]){
    const f=fixture(570,{depth:true,indexHit:()=>42}),p=readingPoint(f,990),stage=f.el('stage');
    f.emit('pointerdown',p.x,p.y);f.advance(160);f.emit('pointermove',p.x-26,p.y+32);f.advance(250);
    f.emit(cancel?'pointercancel':'pointerup',p.x-45,p.y+65);f.advance(500);
    assert.equal(stage.dataset.scene,'reading');assert.equal(stage.dataset.spread,'570');
    assert.notEqual(stage.dataset.lastGesture,'index-tap');assert.equal(f.rendered.length,0);
  }
});
test('nonmatching side and occluded misses cannot activate a reading label',async()=>{
  const f=fixture(570,{depth:true,indexHit:({side})=>side==='right'?42:null}),p=readingPoint(f,-35),stage=f.el('stage');
  f.emit('pointermove',p.x,p.y);assert.notEqual(stage.style.cursor,'pointer');
  f.emit('pointerdown',p.x,p.y);f.advance(70);f.emit('pointerup',p.x,p.y);
  assert.equal(stage.dataset.lastGesture,'edge-tap');await f.untilScene('fan');
  assert.equal(stage.dataset.spread,'570');assert.equal(stage.dataset.fanSide,'left');
});
test('reading wheel and two-finger zoom remain available over the natural index',()=>{
  const f=fixture(570,{depth:true,indexHit:()=>42}),stage=f.el('stage');
  for(let i=0;i<3;i++)f.el('zoom-in').onclick();
  const before=cameraPose(f.el('book').style.transform);stage.handlers.wheel({deltaX:17,deltaY:34,preventDefault(){}});
  assert.notDeepEqual(cameraPose(f.el('book').style.transform).slice(0,2),before.slice(0,2));
  const p=readingPoint(f,990);f.emit('pointerdown',p.x,p.y);f.advance(30);f.emit('pointerdown',p.x-50,p.y+50,2);
  f.advance(90);f.emit('pointermove',p.x-60,p.y-30,1);f.emit('pointermove',p.x+20,p.y+100,2);
  f.emit('pointerup',p.x-60,p.y-30,1);f.emit('pointerup',p.x+20,p.y+100,2);f.advance(500);
  assert.equal(stage.dataset.scene,'reading');assert.equal(stage.dataset.spread,'570');assert.notEqual(stage.dataset.lastGesture,'index-tap');
});
test('whole-book fit includes both natural shoulders without altering flat scripture surfaces',()=>{
  for(const width of [390,1280])for(const spread of [0,570,970,1252]){
    const f=fixture(spread,{width,height:844,depth:true}),frame=assertDepthReadingView(f),[x,y,s]=cameraPose(f.el('book').style.transform);
    for(const side of ['left','right'])for(const yy of [0,352,704]){
      const m=frame.material,p=f.context.PaperBookScene.project(f.context.PaperBookKinematics.pagePoint(side,side==='left'?0:m.totalDepth,1,yy,m,0));
      assert.ok(x+p.x*s>=20&&x+p.x*s<=width-20,'natural base must not be clipped horizontally');
    }
    assert.equal(frame.printed,null);assert.equal(f.el('book').classList.contains('has-curved-leaves'),false);
  }
});
test('flat SVG samples the preceding leaf back on the left and current recto on the right',()=>{
  for(const spread of [0,570,970,1252]){
    const f=fixture(spread,{depth:true}),[left,right]=f.clipCalls;
    assert.equal(left[0],'left');assert.equal(right[0],'right');
    const m=right[4],pitch=m.totalDepth/m.totalSheets;
    assert.equal(left[1],Math.max(0,m.leftDepth-pitch));assert.equal(right[1],m.leftDepth);
    assert.equal(f.el('left-half').style.transform,'none');assert.equal(f.el('right-half').style.transform,'translateX(480px)');
  }
});
test('flat ink compositor isolation preserves screen pixels and leaves curl above ribbons',async()=>{
  for(const [z,s] of [[300,.833333333333],[320,.822222222222],[600,.666666666667]]){
    for(const x of [0,120,480,720,960])for(const y of [0,352,704]){
      assert.ok(Math.abs(480+(x-480)*s*1800/(1800-z)-x)<1e-6);
      assert.ok(Math.abs(352+(y-352)*s*1800/(1800-z)-y)<1e-6);
    }
  }
  const css=fs.readFileSync('book-scene.css','utf8');
  assert.match(css,/\.book\.has-curved-leaves \.paper\{opacity:0/);
  assert.match(css,/\.paper-ribbons\{transform-origin:480px 352px!important;transform:translateZ\(320px\)/);
  const f=fixture(1174);f.el('view-edge').onclick();await f.untilScene('edge');f.el('scene-back').onclick();await f.untilScene('reading');
  assert.equal(f.el('left-half').style.transform,'none');assert.equal(f.el('right-half').style.transform,'translateX(480px)');
  assert.equal(f.el('stage').dataset.spread,'1174');
});
(async()=>{
  for(const {name,fn} of scenarios){
    let watchdog;
    try{await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error(`unsettled asynchronous scenario: ${name}`)),10000);})]);}
    finally{clearTimeout(watchdog);}
    checks++;console.log('PASS '+name);
  }
  console.log(JSON.stringify({inputControllerScenarios:checks}));
})().catch(error=>{console.error(error);process.exitCode=1;});
