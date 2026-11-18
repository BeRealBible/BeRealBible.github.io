'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),S=require('./text-selection.js');
const Page=require('./paper-page.js'),Layout=require('./paper-layout.js'),Bible=require('./data/bible-source.js');
const books=Bible.books.filter(b=>['JHN','2JN'].includes(b.code)),D=Layout.paginate({...Bible,books});
const index=i=>S.indexFace(D.pages[i],Page.commands(D.pages[i],i,D.books).filter(c=>c.role!=='footer-rule'));

test('a wrapped verse copies the printed scripture, not superscripts, headings or other verses',()=>{
  const i=D.books.find(b=>b.code==='2JN').first,model=index(i);
  for(const [v,text] of books[1].chapters[0].verses){
    const unit=model.units.find(u=>u.group==='verse:1:'+v);
    assert.equal(unit.text,text.trim());assert.ok(unit.parts.length>0);
  }
  const cmd=Page.commands(D.pages[i],i,D.books);
  const label=cmd.findIndex(c=>c.role==='verse'&&c.text==='2');
  assert.equal(model.lookup[label][0].group,'verse:1:2');
});
test('continued verse cannot leak the following face; selected fragments reconstruct the verse',()=>{
  const book=D.books.find(b=>b.code==='JHN');
  const i=D.pages.findIndex((p,i)=>i>=book.first&&i<book.last&&p.end===D.pages[i+1].start);
  assert.ok(i>=0);const ref=D.pages[i].end,[ch,v]=ref.split(':');
  const source=books[0].chapters.find(c=>+c.chapter===+ch).verses.find(([n])=>+n===+v)[1].trim();
  const a=index(i).units.find(u=>u.group==='verse:'+ref),b=index(i+1).units.find(u=>u.group==='verse:'+ref);
  assert.ok(a.text.length<source.length&&b.text.length<source.length);assert.equal(a.text+b.text,source);
});
test('English cover: selectable individual words, interior whitespace is blank; copy is reading order',()=>{
  const front=index(0).units.filter(u=>u.group.startsWith('subtitle:'));
  assert.deepEqual(front.map(u=>u.text),['THE','OLD','TESTAMENT']);
  assert.equal(S.copyText([front[2],front[0]]),'THE TESTAMENT');
  const model=S.indexFace({cols:[]},[{role:'subtitle',text:"God's   well-being"}]);
  assert.deepEqual(model.units.map(u=>u.text),["God's",'well-being']);assert.equal(model.lookup[0][6],undefined);
});
test('marks coalesce across characters but never across the second column or the empty end of a line',()=>{
  const b=(x,line)=>({line,x,y:20,width:12,height:14});
  assert.deepEqual(S.mergeRects([b(10,'a'),b(22,'a'),b(80,'a'),b(92,'b')]).map(r=>r.width),[24,12,12]);
});

class El{
  constructor(name,doc){this.tag=name;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.handlers={};this.classList={add(){}};this.style={setProperty(){}};}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){(this.handlers[k]||=[]).push(fn);}
  appendChild(ch){this.append(ch);return ch;}
  append(...children){for(const ch of children){this.children.push(ch);ch.parent=this;}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(ch=>ch!==this);}
  insertBefore(ch,before){ch.parent=this;this.children.splice(this.children.indexOf(before),0,ch);}
  contains(node){return node===this||this.children.some(ch=>ch.contains(node));}
  closest(selector){return selector==='text[data-role]'&&this.tag==='text'?this:null;}
  querySelectorAll(selector){return this.children.filter(e=>selector==='text[data-role]'&&e.tag==='text');}
  querySelector(selector){return this.children.find(e=>selector==='svg'&&e.tag==='svg'||selector==='[role=status]'&&e.attrs.role==='status'||selector==='[data-copy]'&&'data-copy'in e.attrs);}
  focus(){} select(){}
  getBoundingClientRect(){return this.rect||{left:0,top:0,width:130,height:30};}
}
function scene(){
  const writes=[],timers=new Map(),messages=[];
  const win={navigator:{clipboard:{async writeText(t){writes.push(t);}}},setTimeout(fn,ms){timers.set(ms,fn);return ms;},clearTimeout(n){timers.delete(n);}};
  const doc={defaultView:win,createElement(n){return new El(n,this);},createElementNS(ns,n){return new El(n,this);}};
  const stage=doc.createElement('div');stage.rect={left:0,top:0,width:390,height:844};
  const papers=[0,1].map(side=>{
    const paper=doc.createElement('article'),svg=doc.createElement('svg');stage.append(paper);paper.append(svg);
    svg.rect={left:side*480,top:0,width:960,height:1408};
    svg.createSVGPoint=()=>({matrixTransform(m){return {x:(this.x-m.left)/2,y:this.y/2};}});
    svg.getScreenCTM=()=>({inverse:()=>svg.rect});
    const node=doc.createElement('text');svg.append(node);node.ownerSVGElement=svg;
    node.getCharNumAtPosition=({x,y})=>x<0||y<0||y>=12||x>=90?-1:Math.floor(x/10);
    node.getBBox=()=>({x:0,y:0,width:90,height:12});node.getExtentOfChar=j=>({x:j*10,y:0,width:10,height:12});
    return paper;
  });
  const ctrl=S.create({stage,papers,getPage:side=>({page:{cols:[]},books:[],index:side}),commands:()=>[{text:'ONE TWO X',role:'subtitle'}],feedback:t=>messages.push(t)});
  const svg=side=>papers[side].querySelector('svg'),node=side=>svg(side).querySelectorAll('text[data-role]')[0];
  const hit=(side,n)=>ctrl.hit(side*480+(n+.5)*20,10,node(side));
  const bar=()=>stage.children.find(e=>e.attrs.role==='toolbar'),marks=(side=0)=>svg(side).children.filter(e=>e.tag==='g');
  return {ctrl,bar,marks,hit,timers,writes,messages,stage,svg,papers};
}
test('hit tests in transformed glyph coordinates; whitespace neither selects nor intercepts a swipe',()=>{
  const {hit,ctrl,papers}=scene();assert.equal(hit(0,1).unit.text,'ONE');assert.equal(hit(0,3),null);
  assert.equal(hit(1,5).unit.text,'TWO');assert.equal(ctrl.hit(50,500,papers[0]),null);
});
test('one tap creates only a transient ink mark; it vanishes independently after 2.7 s',()=>{
  const {ctrl,timers,marks,hit,bar}=scene();ctrl.tap(hit(0,1));assert.equal(marks().length,1);assert.equal(ctrl.isActive(),false);assert.equal(bar(),undefined);
  timers.get(2700)();assert.equal(marks().length,0);
});
test('long press, select on current face only, toggle, copy in reading order, then exit',async()=>{
  const {ctrl,hit,bar,marks,writes,messages}=scene();
  ctrl.hold(hit(0,5));assert.equal(ctrl.isActive(),true);assert.equal(marks().length,1);
  ctrl.tap(hit(1,1));assert.equal(marks(1).length,0);assert.match(messages.at(-1),/同一页/);
  ctrl.tap(hit(0,1));assert.equal(marks().length,2);ctrl.tap(hit(0,1));assert.equal(marks().length,1);ctrl.tap(hit(0,1));
  await bar().querySelector('[data-copy]').handlers.click[0]();assert.deepEqual(writes,['ONE TWO']);
  assert.equal(bar(),undefined);assert.equal(ctrl.isActive(),false);assert.equal(marks().length,0);
});
test('exit without copy removes persistent marks and draft; empty selection cannot copy',()=>{
  const {ctrl,hit,bar,writes,marks}=scene();ctrl.hold(hit(0,5));ctrl.tap(hit(0,5));assert.equal(bar().querySelector('[data-copy]').disabled,true);
  ctrl.tap(hit(0,8));bar().children.find(e=>e.textContent==='退出').handlers.click[0]();
  assert.equal(marks().length,0);assert.deepEqual(writes,[]);assert.equal(ctrl.isActive(),false);
});
test('stale face tokens cannot mark newly rendered pages',()=>{
  const {ctrl,papers,hit}=scene(),t=hit(0,1);papers[0].children=[];assert.equal(ctrl.hold(t),false);
});
