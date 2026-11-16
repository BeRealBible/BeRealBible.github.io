'use strict';
const assert=require('node:assert/strict');
const S=require('./sticker-index.js');
const books=require('./paper-layout.js').paginate(require('./data/bible-source.js')).books;
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.events=new Map();this.style={setProperty:(key,value)=>{this.style[key]=value;}};}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key]??null;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  dispatch(type){const event={stopped:false,prevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}};if(!this.disabled)for(const listener of this.events.get(type)||[])listener(event);return event;}
  click(){return this.dispatch('click');}
}
function setup(){const doc={createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),selections=[];return {host,selections,index:S.create(host,{books,onSelect:(i,book)=>selections.push([i,book.code])})};}
test('all 66 canonical books have unique, complete, native DOM buttons',()=>{
  const {index}=setup(),buttons=index.element.children;
  assert.equal(buttons.length,66);assert.equal(new Set(buttons).size,66);
  buttons.forEach((button,i)=>{assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.equal(button.children[0].textContent,books[i].short);assert.ok(button.getAttribute('aria-label').includes(books[i].name));});
});
test('up to four occupied columns and seventeen fixed rows have disjoint click rectangles outside正文',()=>{
  for(const spread of [0,124,938,1216,1228,1244]){
    const items=S.layout(books,spread);
    for(const item of items){assert.ok(item.lane<4&&item.row<17);assert.ok(item.y>=0&&item.y+item.height<=704);assert.ok(item.x+item.width<=0||item.x>=960);assert.ok(item.extent<=104);}
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const a=items[i],b=items[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
    }
  }
});
test('one physical leaf carries its recto and verso sticker across the spread',()=>{
  const fixture=[{first:1},{first:2},{first:3},{first:4}];
  assert.deepEqual(fixture.map(S.carrierSheet),[1,1,2,2]);
  assert.deepEqual(S.layout(fixture,0).map(x=>x.side),['right','right','right','right']);
  assert.deepEqual(S.layout(fixture,2).map(x=>x.side),['left','left','right','right']);
  assert.deepEqual(S.layout(fixture,4).map(x=>x.side),['left','left','left','left']);
});
test('each side compacts its occupied columns against its own paper edge',()=>{
  for(const spread of [0,124,938,990,1216,1228,1244]){
    const items=S.layout(books,spread);
    for(const side of ['left','right']){
      const occupied=items.filter(item=>item.side===side);if(!occupied.length)continue;
      const canonicalStart=Math.min(...occupied.map(item=>item.lane));
      assert.equal(Math.min(...occupied.map(item=>item.displayLane)),0);
      for(const item of occupied)assert.equal(item.displayLane,item.lane-canonicalStart);
    }
  }
  const {index}=setup();index.update({spread:990});
  assert.equal(index.getBounds().rightExtent,52);
  const mark=index.element.children[40];assert.equal(mark.dataset.lane,'2');assert.equal(mark.dataset.displayLane,'0');assert.equal(mark.style['--sticker-root'],'3px');
});
test('Peter II cannot show Revelation on the left; Revelation has no future fake entries',()=>{
  const peter=books.find(b=>b.code==='2PE'),rev=books.findIndex(b=>b.code==='REV');
  assert.equal(S.layout(books,peter.first&~1)[rev].side,'right');
  const atRev=S.layout(books,books[rev].first&~1);assert.ok(atRev.every(x=>x.side==='left'));
});
test('turning pages reuses every button and leaves its canonical row/column and vertical position unchanged',()=>{
  const {index}=setup(),buttons=index.element.children.slice(),initial=S.layout(books,0);
  for(const spread of [2,124,953,1216,1228,1244,0]){
    index.update({spread});assert.equal(index.element.children.length,66);
    index.element.children.forEach((button,i)=>{assert.equal(button,buttons[i]);assert.equal(+button.dataset.row,initial[i].row);assert.equal(+button.dataset.lane,initial[i].lane);assert.equal(button.style.top,initial[i].y+'px');assert.equal(button.children[0].textContent,books[i].short);});
  }
});
test('all 66 independent click targets dispatch the matching book once',()=>{
  const {index,selections}=setup();index.element.children.forEach(button=>button.click());
  assert.deepEqual(selections,books.map((b,i)=>[i,b.code]));
});
test('pointer interception does not cancel native focus or Enter/Space button activation',()=>{
  const {index,selections}=setup(),button=index.element.children[65];
  const down=button.dispatch('pointerdown');assert.ok(down.stopped);assert.equal(down.prevented,false);
  assert.equal(button.events.has('keydown'),false);assert.equal(button.getAttribute('tabindex'),null);
  button.click();assert.deepEqual(selections,[[65,'REV']]);
});
test('turning disables selections, then restores original buttons on commit',()=>{
  const {index,selections}=setup(),button=index.element.children[65];
  index.update({turning:true});button.click();assert.equal(selections.length,0);assert.ok(button.disabled);
  index.update({turning:false,spread:1228});button.click();assert.deepEqual(selections,[[65,'REV']]);assert.equal(button.dataset.side,'left');
});
test('current book may be an index, code or book; highlighting does not change layout',()=>{
  const {index}=setup();
  for(const currentBook of [65,'REV',books[65]]){
    index.update({currentBook});assert.equal(index.element.children.filter(x=>x.getAttribute('aria-current')).length,1);assert.equal(index.element.children[65].getAttribute('aria-current'),'page');
  }
  index.update({currentBook:null});assert.equal(index.element.children.filter(x=>x.getAttribute('aria-current')).length,0);
});
test('bounds include only occupied sides and do not grow with zoom',()=>{
  const {index}=setup();assert.deepEqual(index.getBounds(),{leftExtent:0,rightExtent:104});
  index.update({spread:1216,scale:5});assert.deepEqual(index.getBounds(),{leftExtent:104,rightExtent:26});
  index.update({spread:1244,scale:.4});assert.deepEqual(index.getBounds(),{leftExtent:104,rightExtent:0});
});
test('destroy removes owned markup and handlers without touching host siblings',()=>{
  const {index,host,selections}=setup(),button=index.element.children[0],sibling=new Element('span',host.ownerDocument);host.appendChild(sibling);
  index.destroy();index.destroy();button.click();assert.equal(selections.length,0);assert.deepEqual(host.children,[sibling]);
});
console.log(`Sticker index: ${checks} checks passed (${books.length} real books).`);
