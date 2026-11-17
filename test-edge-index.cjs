'use strict';
const assert=require('node:assert/strict');
const E=require('./edge-index.js');
const data=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const books=data.books,pageCount=data.pages.length;
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
class Target {
  constructor(){this.events=new Map();}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  dispatch(type,details={}){const event={stopped:false,prevented:false,...details,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}};if(!this.disabled)for(const listener of this.events.get(type)||[])listener(event);return event;}
}
class Element extends Target {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.style={};}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key]??null;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return {x:101,y:202,left:101,top:202,right:114,bottom:226,width:13,height:24};}
  click(){return this.dispatch('click');}
}
function setup(){const doc=new Target();doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),events=[],metadata=[];
  host.style.zIndex='6';const index=E.create(host,{books,pageCount,onSelect:(i,b,meta)=>{events.push(['select',i,b.code]);metadata.push(meta);},onExpand:side=>events.push(['expand',side])});
  return {doc,host,index,events,metadata,children:index.element.children};
}
const isClass=(node,name)=>String(node.className||'').split(' ').includes(name);
const classNodes=(fixture,name)=>fixture.children.filter(node=>isClass(node,name));
const visibleBooks=fixture=>classNodes(fixture,'edge-index__book').filter(node=>!node.hidden);
const visibleGroups=fixture=>classNodes(fixture,'edge-index__group').filter(node=>!node.hidden);
test('reference groups remain exactly 23 OT plus 19 NT and partition all 66 books',()=>{
  assert.equal(E.GROUPS.filter(g=>!g.nt).length,23);assert.equal(E.GROUPS.filter(g=>g.nt).length,19);
  assert.deepEqual(E.GROUPS.flatMap(g=>g.members),Array.from({length:66},(_,i)=>i));
  assert.equal(E.GROUPS[10].label,'拉尼斯');assert.equal(E.GROUPS[39].label,'壹贰叁');
});
test('recto and verso of one physical sheet have the same side',()=>{
  assert.deepEqual([1,2,3,4].map(first=>E.carrierSheet({first})),[1,1,2,2]);
  assert.deepEqual([1,2,3,4].map(first=>E.sideOf({first},2)),['left','left','right','right']);
});
test('all actual spreads partition grouped members correctly without orphan or duplicate books',()=>{
  for(let spread=0;spread<pageCount;spread+=2){
    const geometry=E.layout(books,pageCount,spread),members=[];
    for(const group of geometry.groups){
      for(const index of group.bookIndices){assert.equal(group.side,E.sideOf(books[index],spread));members.push(index);}
      assert.ok([...group.label].length<=3,'normal label must fit the reference vertical badge');
      const band=geometry.bands[group.side];
      assert.ok(group.x>=band.x-1e-7&&group.x+group.width<=band.x+band.width+1e-7);
      assert.ok(group.y>=0&&group.y+group.height<=704);
    }
    assert.deepEqual(members.sort((a,b)=>a-b),Array.from({length:66},(_,i)=>i));
  }
});
test('a group straddling the reading page splits by members rather than following its first book',()=>{
  const groups=E.layout(books,pageCount,262).groups.filter(g=>g.groupIndex===7);
  assert.equal(groups.length,2);assert.deepEqual(groups.find(g=>g.side==='left').bookIndices,[8]);assert.deepEqual(groups.find(g=>g.side==='right').bookIndices,[9]);
  assert.equal(groups.find(g=>g.side==='left').label,'撒上');assert.equal(groups.find(g=>g.side==='right').label,'撒下');
  const john=E.layout(books,pageCount,1224).groups.filter(g=>g.groupIndex===39);
  assert.deepEqual(john.find(g=>g.side==='left').bookIndices,[61,62]);assert.deepEqual(john.find(g=>g.side==='right').bookIndices,[63]);
});
test('normal bands use real page proportions and expanded bounds never inflate normal cover bounds',()=>{
  const f=setup();f.index.update({spread:740});const before=f.index.getNormalBounds();
  assert.equal(before.leftExtent,10+42*740/pageCount);assert.equal(before.rightExtent,32);
  f.index.setExpanded('right');const b=f.index.getBounds();assert.equal(b.rightExtent,208);assert.equal(b.leftExtent,before.leftExtent);
  assert.equal(b.normalRightExtent,before.rightExtent);assert.deepEqual(f.index.getNormalBounds(),before);
});
test('every normal spread keeps original y positions with disjoint OT/NT depth tracks and a 1px clear gap',()=>{
  for(let spread=0;spread<pageCount;spread+=2){
    const geometry=E.layout(books,pageCount,spread);
    for(const side of ['left','right']){
      const items=geometry.groups.filter(item=>item.side===side),ot=items.filter(item=>!item.nt),nt=items.filter(item=>item.nt),mixed=ot.length&&nt.length;
      const band=geometry.bands[side],ratio=side==='left'?spread/pageCount:(pageCount-spread)/pageCount;
      assert.ok(Math.abs(band.width-Math.max(10+42*ratio,mixed?32:0))<1e-10);
      for(const item of items){
        const group=E.GROUPS[item.groupIndex],expectedY=(group.nt?38+28*group.row:30+26*group.row)*704/640-12;
        assert.equal(item.y,expectedY);
      }
      if(mixed){
        assert.ok(band.width>=32);
        assert.ok(Math.max(...ot.map(item=>item.x+item.width))+3<=Math.min(...nt.map(item=>item.x))+1e-7);
      }
      for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)assert.equal(E.rectanglesOverlap(items[i],items[j],1),false,`normal overlap: spread ${spread}, ${side}, groups ${items[i].groupIndex}/${items[j].groupIndex}`);
    }
  }
});
test('every actual spread expands both testaments without cross-group collision or reversed/split members',()=>{
  const spreads=Array.from({length:Math.ceil(pageCount/2)},(_,i)=>i*2);
  let crossTestamentStates=0;
  for(const spread of spreads)for(const side of ['left','right']){
    const geometry=E.layout(books,pageCount,spread,side),items=geometry.expandedBooks,band=geometry.bands[side];
    assert.equal(items.length,books.filter(book=>E.sideOf(book,spread)===side).length);
    if(items.some(item=>item.nt)&&items.some(item=>!item.nt))crossTestamentStates++;
    for(const item of items){
      assert.ok(item.x>=band.x&&item.x+item.width<=band.x+band.width);assert.ok(item.y>=0&&item.y+item.height<=704);
      assert.equal(item.side,E.sideOf(books[item.index],spread));
    }
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)assert.equal(E.rectanglesOverlap(items[i],items[j],3),false,`overlap: spread ${spread}, ${side}, ${items[i].index}/${items[j].index}`);
    for(const group of E.GROUPS){
      const members=items.filter(item=>item.groupIndex===group.index).sort((a,b)=>a.index-b.index);
      for(let i=1;i<members.length;i++){
        assert.equal(members[i].y,members[0].y,`split group row: spread ${spread}, ${side}, ${group.label}`);
        assert.equal(members[i].x-members[i-1].x,E.constants.COLUMN_PITCH,`reversed/noncontiguous group: spread ${spread}, ${side}, ${group.label}`);
      }
    }
  }
  assert.ok(crossTestamentStates>50);
});
test('normal group buttons select the first actual member on that side',()=>{
  const f=setup();f.index.update({spread:262});
  const left=visibleGroups(f).find(node=>node.dataset.group==='7'&&node.dataset.side==='left');
  const right=visibleGroups(f).find(node=>node.dataset.group==='7'&&node.dataset.side==='right');
  left.click();right.click();assert.deepEqual(f.events,[['select',8,'1SA'],['select',9,'2SA']]);
});
test('expanded selection requests a chapter menu without collapsing and reaches each of the real 66 books',()=>{
  const f=setup();f.index.update({spread:740});
  for(let i=0;i<books.length;i++){
    const side=E.sideOf(books[i],740);f.index.setExpanded(side);const button=visibleBooks(f).find(node=>+node.dataset.book===i);assert.ok(button);
    const start=f.events.length;button.click();assert.deepEqual(f.events.slice(start),[['select',i,books[i].code]]);assert.equal(f.index.getExpanded(),side);
    assert.deepEqual(f.metadata.at(-1).bookIndices,[i]);
  }
  assert.equal(f.events.filter(event=>event[0]==='select').length,66);
});
test('chapter requests carry only this side group members and a detached plain screen anchor',()=>{
  const f=setup();f.index.update({spread:262});
  const left=visibleGroups(f).find(node=>node.dataset.group==='7'&&node.dataset.side==='left');
  const right=visibleGroups(f).find(node=>node.dataset.group==='7'&&node.dataset.side==='right');
  left.click();right.click();assert.deepEqual(f.metadata.map(meta=>meta.bookIndices),[[8],[9]]);
  assert.deepEqual(f.metadata[0].anchor,{x:101,y:202,left:101,top:202,right:114,bottom:226,width:13,height:24});
  assert.equal(Object.getPrototypeOf(f.metadata[0].anchor),Object.prototype);
  f.metadata[0].bookIndices.push(65);left.click();assert.deepEqual(f.metadata.at(-1).bookIndices,[8]);
  assert.match(left.getAttribute('aria-label'),/选择章节/);assert.equal(left.getAttribute('aria-haspopup'),'dialog');
});
test('Escape belonging to the chapter dialog does not collapse the expanded book edge',()=>{
  const f=setup();f.index.setExpanded('right');
  const event=f.doc.dispatch('keydown',{key:'Escape',target:{closest:selector=>selector==='.edge-chapters'?{}:null}});
  assert.equal(f.index.getExpanded(),'right');assert.equal(event.prevented,false);
  f.doc.querySelector=()=>({});f.doc.dispatch('keydown',{key:'Escape'});assert.equal(f.index.getExpanded(),'right');
});
test('bands, group labels and individual labels are native focusable buttons with full names',()=>{
  const f=setup();f.index.setExpanded('right');
  for(const button of [...classNodes(f,'edge-index__band'),...visibleBooks(f)]){
    assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.ok(button.title);assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.events.has('keydown'),false);assert.equal(button.getAttribute('tabindex'),null);
    const down=button.dispatch('pointerdown');assert.equal(down.prevented,false);
  }
  for(const button of visibleBooks(f)){const i=+button.dataset.book;assert.ok(button.title.includes(books[i].name));assert.equal(button.textContent,books[i].short);}
  assert.equal(f.doc.activeElement,visibleBooks(f)[0]);
  f.index.setExpanded(null);for(const button of visibleGroups(f)){assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');assert.ok(button.title);}
});
test('titles and accessible names never present internal first-page offsets as printed page numbers',()=>{
  const f=setup();f.index.update({spread:1194});f.index.setExpanded('right');
  for(const button of [...classNodes(f,'edge-index__group'),...classNodes(f,'edge-index__book')]){
    assert.equal(/第\s*\d+\s*页/.test(button.title||''),false);
    assert.equal(/第\s*\d+\s*页/.test(button.getAttribute('aria-label')||''),false);
  }
});
test('blank band click expands, Escape/backdrop close, and null closure is idempotent',()=>{
  const f=setup(),right=classNodes(f,'edge-index__band').find(node=>node.dataset.side==='right');
  right.click();assert.equal(f.index.getExpanded(),'right');assert.equal(f.host.style.zIndex,'90');assert.equal(f.index.isExpanded(),true);
  const escape=f.doc.dispatch('keydown',{key:'Escape'});assert.ok(escape.stopped&&escape.prevented);assert.equal(f.index.getExpanded(),null);assert.equal(f.host.style.zIndex,'6');
  assert.equal(f.doc.activeElement,right);const count=f.events.length;f.index.setExpanded(null);assert.equal(f.events.length,count);
  right.click();classNodes(f,'edge-index__backdrop')[0].click();assert.equal(f.index.getExpanded(),null);
});
test('turn update closes and disables index without reentering onExpand',()=>{
  const f=setup();f.index.setExpanded('right');const count=f.events.length;
  f.index.update({turning:true});assert.equal(f.index.getExpanded(),null);assert.equal(f.events.length,count);
  for(const button of visibleGroups(f)){assert.ok(button.disabled);button.click();}assert.equal(f.events.length,count);
  f.index.setExpanded('right');assert.equal(f.index.getExpanded(),null);assert.equal(f.events.length,count);
  f.index.update({turning:false});assert.ok(visibleGroups(f).every(button=>!button.disabled));
});
test('current highlight follows only its actual side and updates without replacing book buttons',()=>{
  const f=setup(),original=classNodes(f,'edge-index__book').slice();f.index.update({spread:262,currentBook:'2SA'});
  const highlighted=visibleGroups(f).filter(node=>node.getAttribute('aria-current')==='page');assert.equal(highlighted.length,1);assert.equal(highlighted[0].dataset.side,'right');
  f.index.setExpanded('right');assert.equal(visibleBooks(f).filter(node=>node.getAttribute('aria-current')).length,1);
  for(const spread of [1216,0,1244]){f.index.update({spread});assert.deepEqual(classNodes(f,'edge-index__book'),original);}
});
test('destroy removes only owned markup and document listeners, restoring host stacking',()=>{
  const f=setup(),sibling=new Element('div',f.doc);f.host.appendChild(sibling);f.index.setExpanded('right');f.index.destroy();f.index.destroy();
  assert.deepEqual(f.host.children,[sibling]);assert.equal(f.host.style.zIndex,'6');assert.equal(f.doc.events.get('keydown').size,0);
});
console.log(`Edge index: ${checks} checks passed (${books.length} real books, ${pageCount} real pages).`);
