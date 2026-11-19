'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('./edge-index.js');
const data=require('./paper-layout.js').paginate(require('./data/bible-source.js'));
const books=data.books,pageCount=data.pages.length;
const legacyScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'bible-data.js'),'utf8'),legacyScope);
const physicalScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'v25-original-data.js'),'utf8'),physicalScope);
const physical=physicalScope.window.V25OriginalData.meta;
assert.equal(physical.physical,true);assert.equal(physical.books.length,66);
const editions=[{name:'published physical PDF/OCR',data:physical},{name:'rule-bootstrap',data},{name:'bible-data',data:legacyScope.window.BIBLE_DATA}];
// Independent manual reading of the two reference photographs. Heights are
// mark centres divided by local page height, not copied from production JS.
const photograph=[
  ['ot-a','GEN EXO LEV NUM DEU JOS JDG RUT 1SA+2SA 1KI+2KI 1CH+2CH',
    [10.5,18.0,26.5,34.9,42.9,50.8,58.5,66.0,73.5,80.7,87.9]],
  ['ot-b','EZR+NEH EST+JOB PSA+PRO ECC+SNG ISA JER+LAM EZK+DAN HOS+JOL AMO+OBA+JON MIC+NAM+HAB ZEP+HAG ZEC+MAL',
    [7.4,14.9,22.5,30.1,38.3,45.7,53.2,60.9,68.3,76.1,83.9,92.1]],
  ['nt-a','MAT MRK LUK JHN ACT ROM 1CO+2CO GAL+EPH PHP+COL 1TH+2TH 1TI+2TI',
    [9.8,17.6,25.2,33.5,41.4,48.8,56.7,64.9,72.5,80.6,88.9]],
  ['nt-b','TIT+PHM HEB+JAS 1PE+2PE 1JN+2JN+3JN+JUD REV',[9.3,17.5,25.1,33.2,41.2]]
];
const trackOrder=photograph.map(t=>t[0]);
const centerY=item=>item.y+item.height/2;
const centerX=item=>item.x+item.width/2;
// Open-Matthew reference's native pixel coordinates: perspective and the
// unequal OT/NT volumes matter, so these are not equal-width lane centres.
const photoX={
  'ot-a':[34,41,47,49.5,53.5,57.5,60.5,63,64,68.5,75],
  'ot-b':[83,86,90,101.5,103,109,117,123.5,125,126.5,127,126.5],
  'nt-a':[829,834,836.5,840,845,850.5,852,856,857.5,860,859.5],
  'nt-b':[859,859.5,862.5,862.5,865.5]
};
const groupForBook=index=>E.GROUPS.find(g=>g.members.includes(index));
const samuelGroup=()=>groupForBook(8).index;
const splitBefore=(source,i)=>Math.max(0,2*E.carrierSheet(source[i])-2);
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('slim paper stack preserves every V25 tab at every physical spread without overlap',()=>{
  for(let page=0;page<physical.pageCount;page+=2){
    const normal=E.layout(physical.books,physical.pageCount,page),slim=E.layout(physical.books,physical.pageCount,page,.70);
    assert(slim.bands.left.width<=normal.bands.left.width&&slim.bands.right.width<=normal.bands.right.width);
    assert.deepEqual(slim.groups.map(g=>[g.groupIndex,g.bookIndices,g.y,g.width,g.height]),
      normal.groups.map(g=>[g.groupIndex,g.bookIndices,g.y,g.width,g.height]));
    for(let i=0;i<slim.groups.length;i++)for(let j=i+1;j<slim.groups.length;j++)
      assert(!E.rectanglesOverlap(slim.groups[i],slim.groups[j]));
  }
});
class Target {
  constructor(){this.events=new Map();}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  dispatch(type,details={}){const event={stopped:false,prevented:false,...details,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}};if(!this.disabled)for(const listener of this.events.get(type)||[])listener(event);return event;}
}
class Element extends Target {
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.style={};}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
  get textContent(){return (this._text||'')+this.children.map(child=>child.textContent).join('');}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  getAttribute(key){return this.attributes[key]??null;}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return {x:101,y:202,left:101,top:202,right:114,bottom:226,width:13,height:24};}
  click(){return this.dispatch('click');}
}
function setup(edition=data){const doc=new Target();doc.createElement=tag=>new Element(tag,doc);const host=new Element('div',doc),events=[],metadata=[];
  host.style.zIndex='6';const index=E.create(host,{books:edition.books,pageCount:edition.pages.length,onSelect:(i,b,meta)=>{events.push(['select',i,b.code]);metadata.push(meta);}});
  return {doc,host,index,events,metadata,children:index.element.children};
}
const isClass=(node,name)=>String(node.className||'').split(' ').includes(name);
const classNodes=(fixture,name)=>fixture.children.filter(node=>isClass(node,name));
const visibleGroups=fixture=>classNodes(fixture,'edge-index__group').filter(node=>!node.hidden);
const descendants=node=>node.children.filter(child=>!child.hidden).flatMap(child=>[child,...descendants(child)]);
const printed=node=>node.hidden?'':(node._text||'')+node.children.map(printed).join('');
const cutFor=(f,members)=>visibleGroups(f).find(button=>button.dataset.members===members.join(','));
const sharedFaces=[[8,'撒','上','下'],[10,'王','上','下'],[12,'代','上','下'],
  [45,'林','前','后'],[51,'帖','前','后'],[53,'提','前','后'],[59,'彼','前','后']];
test('shared-name paper cuts carry one stem and separate upper/lower qualifiers inside one named button',()=>{
  const f=setup(physical);
  for(const spread of [0,physical.pages.length-1]){
    f.index.update({spread});
    for(const [i,stem,top,bottom] of sharedFaces){
      const cut=cutFor(f,[i,i+1]);assert.ok(cut);assert.equal(cut.dataset.side,spread?'left':'right');
      const nodes=descendants(cut);
      for(const [part,glyph] of [['root',stem],['top',top],['bottom',bottom]]){
        const found=nodes.filter(n=>n.dataset.part===part);
        assert.equal(found.length,1,`${stem} needs a single ${part} glyph, not a vertical three-character string`);
        assert.equal(printed(found[0]).trim(),glyph);
      }
      assert.deepEqual([...printed(cut).replace(/\s/gu,'')].sort(),[stem,top,bottom].sort(),'never print the common stem twice');
      assert.equal(cut.tagName,'BUTTON');assert.ok(nodes.every(n=>n.tagName!=='BUTTON'&&n.tagName!=='A'));
      for(const book of physical.books.slice(i,i+2))assert.ok(cut.getAttribute('aria-label').includes(book.name));
      cut.click();assert.deepEqual(f.metadata.at(-1).bookIndices,[i,i+1]);
    }
  }
});
test('independent two- and three-book cuts and the John/Jude cut do not reuse the shared-stem face',()=>{
  const f=setup(physical);
  for(const [members,expected] of [[[14,15],'拉尼'],[[29,30,31],'摩俄拿'],[[47,48],'加弗'],[[55,56],'多门'],[[61,62,63,64],'约123犹']]){
    const cut=cutFor(f,members);assert.ok(cut);
    const nodes=descendants(cut);assert.ok(!nodes.some(n=>n.dataset.part==='root'),'do not infer a stem from glyph count');
    assert.equal(printed(cut).replace(/\s/gu,''),expected);
    if(members.includes(64)){
      const bands=nodes.filter(n=>n.dataset.part==='letters'||n.dataset.part==='jude');
      assert.deepEqual(bands.map(n=>printed(n).replace(/\s/gu,'')),['约123','犹'],'the three epistle numerals belong with John above the division, not to a third band');
    }else{
      assert.deepEqual(nodes.filter(n=>n.dataset.part==='row').map(printed),[...expected],'each independent book has its own horizontal band');
    }
  }
});
test('turning through each shared-name cut shows and opens only the actual half on each side; returning restores the whole face',()=>{
  const f=setup(physical),books=physical.books;
  for(const [i] of sharedFaces){
    f.index.update({spread:splitBefore(books,i+1)});
    for(const [j,side] of [[i,'left'],[i+1,'right']]){
      const button=cutFor(f,[j]);assert.ok(button);assert.equal(button.dataset.side,side);
      assert.equal(printed(button).replace(/\s/gu,''),books[j].short);
      button.click();assert.deepEqual(f.metadata.at(-1).bookIndices,[j]);
      assert.ok(!button.getAttribute('aria-label').includes(books[j===i?i+1:i].name));
    }
    f.index.update({spread:0});const full=cutFor(f,[i,i+1]);
    assert.equal(descendants(full).filter(n=>n.dataset.part==='root').length,1);
  }
});
test('the photos partition the 66 books into exactly 11 + 12 black and 11 + 5 red cuts',()=>{
  assert.equal(E.GROUPS.length,39);
  for(const [track,groups] of photograph){
    const tagged=E.GROUPS.filter(g=>g.track===track);
    assert.deepEqual(tagged.map(g=>g.members.map(i=>physical.books[i].code).join('+')),groups.split(' '));
    assert.deepEqual(tagged.map(g=>g.row),Array.from({length:tagged.length},(_,i)=>i));
    assert.ok(tagged.every(g=>g.nt===track.startsWith('nt')));
  }
  assert.deepEqual(E.GROUPS.flatMap(g=>g.members),Array.from({length:66},(_,i)=>i));
});
test('recto and verso of one physical sheet have the same side',()=>{
  assert.deepEqual([1,2,3,4].map(first=>E.carrierSheet({first})),[1,1,2,2]);
  assert.deepEqual([1,2,3,4].map(first=>E.sideOf({first},2)),['left','left','right','right']);
});
test('all physical PDF and fallback spreads partition grouped members exactly once, within the page edge',()=>{
  for(const edition of editions){
   const {books,pages}=edition.data;
   for(let spread=0;spread<pages.length;spread+=2){
    const geometry=E.layout(books,pages.length,spread),members=[];
    for(const group of geometry.groups){
      for(const index of group.bookIndices){assert.equal(group.side,E.sideOf(books[index],spread));members.push(index);}
      assert.ok(group.label,'normal cut must have a visible label');
      const band=geometry.bands[group.side];
      assert.ok(group.x>=band.x-1e-7&&group.x+group.width<=band.x+band.width+1e-7);
      assert.ok(group.y>=0&&group.y+group.height<=704);
    }
    assert.deepEqual(members.sort((a,b)=>a-b),Array.from({length:66},(_,i)=>i));
   }
  }
});
test('a group straddling the reading page splits by members rather than following its first book',()=>{
  for(const {data:{books,pages}} of editions){
    const groups=E.layout(books,pages.length,splitBefore(books,9)).groups.filter(g=>g.groupIndex===samuelGroup());
    assert.equal(groups.length,2);assert.deepEqual(groups.find(g=>g.side==='left').bookIndices,[8]);assert.deepEqual(groups.find(g=>g.side==='right').bookIndices,[9]);
    assert.equal(groups.find(g=>g.side==='left').label,'撒上');assert.equal(groups.find(g=>g.side==='right').label,'撒下');
    assert.equal(centerY(groups[0]),centerY(groups[1]),'two halves of the same cut keep its original height');
    const johnGroup=groupForBook(61),split=2*E.carrierSheet(books[61]);
    const john=E.layout(books,pages.length,split).groups.filter(g=>g.groupIndex===johnGroup.index);
    for(const side of ['left','right']){
      const expected=johnGroup.members.filter(i=>E.sideOf(books[i],split)===side);
      assert.deepEqual(john.find(g=>g.side===side)?.bookIndices??[],expected);
    }
  }
});
test('normal bands use real page proportions and blank clicks cannot change their bounds',()=>{
  const f=setup();f.index.update({spread:740});const before=f.index.getNormalBounds();
  const unopened=E.layout(books,pageCount,0).bounds,finished=E.layout(books,pageCount,pageCount-1).bounds;
  assert.ok(unopened.leftExtent<before.leftExtent&&before.leftExtent<finished.leftExtent);
  assert.ok(unopened.rightExtent>before.rightExtent&&before.rightExtent>finished.rightExtent);
  const bounds=f.index.getBounds();assert.equal(bounds.leftExtent,before.leftExtent);assert.equal(bounds.rightExtent,before.rightExtent);
  for(const band of classNodes(f,'edge-index__band'))band.click();
  assert.deepEqual(f.index.getBounds(),bounds);assert.deepEqual(f.index.getNormalBounds(),before);assert.deepEqual(f.events,[]);
});
test('all 39 cut centres match the independently measured open photo within 1.5% of page height; the short track stops beside Acts',()=>{
  const {books,pages}=physical,g=E.layout(books,pages.length,0),height=g.bands.right.height;
  for(const [track,,centres] of photograph){
    const rows=g.groups.filter(item=>item.side==='right'&&item.track===track).sort((a,b)=>a.row-b.row);
    assert.equal(rows.length,centres.length);
    rows.forEach((item,i)=>assert.ok(Math.abs(centerY(item)*100/height-centres[i])<=1.5,`${track} ${i}: height must match paper`));
  }
  const anchors=g.groups.filter(g=>g.track==='nt-a');
  for(const item of g.groups.filter(g=>g.track==='nt-b')){
    assert.ok(Math.abs(centerY(item)-centerY(anchors[item.row]))<=height*.01,'red short and long tracks line up');
  }
  const rev=g.groups.find(i=>i.bookIndices.includes(65)),acts=g.groups.find(i=>i.bookIndices.includes(43));
  assert.ok(Math.abs(centerY(rev)-centerY(acts))<=height*.01);assert.ok(centerY(rev)/height<.43);
});
test('the open-Matthew reference spread shows two black tracks on the left and both red tracks on the right',()=>{
  const {books,pages}=physical,spread=splitBefore(books,39),geometry=E.layout(books,pages.length,spread);
  const visible=(side,track)=>geometry.groups.filter(g=>g.side===side&&g.track===track).length;
  assert.deepEqual(trackOrder.map(t=>visible('left',t)),[11,12,0,0]);
  assert.deepEqual(trackOrder.map(t=>visible('right',t)),[0,0,11,5]);
  assert.ok(geometry.groups.filter(g=>g.side==='left').every(g=>!g.nt));
  assert.ok(geometry.groups.filter(g=>g.side==='right').every(g=>g.nt));
  for(const side of ['left','right']){
    const rows=geometry.groups.filter(g=>g.side===side);
    const anchor=rows.find(g=>g.row===0&&g.track.endsWith('-a'));
    for(const item of rows){
      const measured=(photoX[item.track][item.row]-photoX[anchor.track][0])/570;
      const actual=(centerX(item)-centerX(anchor))/geometry.bands[side].height;
      assert.ok(Math.abs(measured-actual)<.02,`horizontal offset of ${item.track}/${item.row}: ${actual} vs photo ${measured}`);
    }
  }
});
test('all normal spreads retain each cut height; tracks at the same height keep photographic order without occlusion',()=>{
 for(const {name,data:{books,pages}} of editions){
  const fixed=new Map(E.layout(books,pages.length,0).groups.map(g=>[g.groupIndex,centerY(g)]));
  let previous;
  for(let spread=0;spread<pages.length;spread+=2){
    const geometry=E.layout(books,pages.length,spread);
    if(previous){
      assert.ok(geometry.bands.left.width>=previous.left.width-1e-8);
      assert.ok(geometry.bands.right.width<=previous.right.width+1e-8);
    }
    previous=geometry.bands;
    for(const side of ['left','right']){
      const items=geometry.groups.filter(item=>item.side===side),band=geometry.bands[side];
      assert.ok(band.width>=10-1e-8);
      for(const item of items){
        const group=E.GROUPS[item.groupIndex];assert.equal(item.track,group.track);assert.equal(item.row,group.row);
        assert.ok(Math.abs(centerY(item)-fixed.get(item.groupIndex))<1e-7);
      }
      for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
        const a=items[i],b=items[j];
        assert.equal(E.rectanglesOverlap(a,b),false,`normal overlap: spread ${spread}, ${side}, groups ${a.groupIndex}/${b.groupIndex}`);
        if(a.track===b.track||a.y+a.height<=b.y||b.y+b.height<=a.y)continue;
        const leftFirst=trackOrder.indexOf(a.track)<trackOrder.indexOf(b.track);
        assert.ok(leftFirst?centerX(a)<centerX(b):centerX(b)<centerX(a),`${name} ${side}/${spread} track order`);
      }
    }
  }
 }
});
test('normal marks within a photographic track never reverse member depth, on either side in any edition',()=>{
  for(const edition of editions){
    const {books,pages}=edition.data;
    for(let spread=0;spread<pages.length;spread+=2){
      const geometry=E.layout(books,pages.length,spread);
      for(const side of ['left','right'])for(const track of trackOrder){
        const items=geometry.groups.filter(item=>item.side===side&&item.track===track).sort((a,b)=>a.bookIndices[0]-b.bookIndices[0]);
        for(let i=1;i<items.length;i++){
          const previous=items[i-1],current=items[i];assert.ok(current.x>=previous.x,'normal canonical order must not reverse');
          const before=Math.ceil(books[previous.bookIndices[0]].first/2),after=Math.ceil(books[current.bookIndices[0]].first/2);
          if(before===after)assert.equal(current.x,previous.x);
        }
      }
    }
  }
});
test('normal group buttons select the first actual member on that side',()=>{
  const f=setup();f.index.update({spread:splitBefore(books,9)});
  const left=visibleGroups(f).find(node=>+node.dataset.group===samuelGroup()&&node.dataset.side==='left');
  const right=visibleGroups(f).find(node=>+node.dataset.group===samuelGroup()&&node.dataset.side==='right');
  left.click();right.click();assert.deepEqual(f.events,[['select',8,'1SA'],['select',9,'2SA']]);
});
test('every book, including Jude, is represented by exactly one direct chapter-menu target at each sampled spread',()=>{
  const f=setup(physical);
  for(const spread of [0,740,splitBefore(physical.books,39),physical.pages.length-1]){
    f.index.update({spread});const members=[];
    for(const button of visibleGroups(f)){
      const ids=button.dataset.members.split(',').map(Number),before=f.events.length;
      button.click();
      assert.deepEqual(f.events.slice(before),[['select',ids[0],physical.books[ids[0]].code]]);
      assert.deepEqual(f.metadata.at(-1).bookIndices,ids);
      members.push(...ids);
    }
    assert.deepEqual(members.sort((a,b)=>a-b),Array.from({length:66},(_,i)=>i));
  }
});
test('the physical compact four-book John/Jude cut sends its exact members to the chapter selector',()=>{
  const f=setup(physical),group=groupForBook(64);
  const cut=visibleGroups(f).find(button=>+button.dataset.group===group.index&&button.dataset.side==='right');
  assert.ok(cut);cut.click();assert.deepEqual(f.metadata.at(-1).bookIndices,[61,62,63,64]);
  assert.equal(f.events.at(-1)[2],'1JN');
});
test('chapter requests carry only this side group members and a detached plain screen anchor',()=>{
  const f=setup();f.index.update({spread:splitBefore(books,9)});
  const left=visibleGroups(f).find(node=>+node.dataset.group===samuelGroup()&&node.dataset.side==='left');
  const right=visibleGroups(f).find(node=>+node.dataset.group===samuelGroup()&&node.dataset.side==='right');
  left.click();right.click();assert.deepEqual(f.metadata.map(meta=>meta.bookIndices),[[8],[9]]);
  assert.deepEqual(f.metadata[0].anchor,{x:101,y:202,left:101,top:202,right:114,bottom:226,width:13,height:24});
  assert.equal(Object.getPrototypeOf(f.metadata[0].anchor),Object.prototype);
  f.metadata[0].bookIndices.push(65);left.click();assert.deepEqual(f.metadata.at(-1).bookIndices,[8]);
  assert.match(left.getAttribute('aria-label'),/选择章节/);assert.equal(left.getAttribute('aria-haspopup'),'dialog');
});
test('blank fore-edge surfaces do not advertise or expose any alternate view',()=>{
  const f=setup(),bands=classNodes(f,'edge-index__band');assert.equal(bands.length,2);
  for(const band of bands){
    assert.equal(band.tagName,'DIV');assert.equal(band.getAttribute('aria-hidden'),'true');
    assert.equal(band.getAttribute('role'),null);assert.equal(band.getAttribute('tabindex'),null);
    assert.ok(!band.events.has('click'));assert.equal(band.dispatch('pointerdown').stopped,false);
    band.click();band.dispatch('dblclick');
  }
  assert.deepEqual(f.events,[]);assert.equal(f.host.style.zIndex,'6');
  assert.equal(f.children.filter(node=>node.tagName==='BUTTON'&&!isClass(node,'edge-index__group')).length,0);
  assert.equal(f.index.setExpanded,undefined);assert.equal(f.index.isExpanded,undefined);
  assert.equal(f.doc.dispatch('keydown',{key:'Escape'}).prevented,false);
  for(const name of ['edge-index__book','edge-index__backdrop','edge-index__caption'])assert.equal(classNodes(f,name).length,0);
});
test('only the actual cut buttons are focusable, labelled and request the chapter dialog',()=>{
  const f=setup(physical);f.index.update({spread:1194});
  for(const button of visibleGroups(f)){
    assert.equal(button.tagName,'BUTTON');assert.equal(button.type,'button');
    assert.equal(button.getAttribute('aria-haspopup'),'dialog');
    assert.equal(button.getAttribute('aria-label'),button.title);
    for(const i of button.dataset.members.split(','))assert.ok(button.title.includes(physical.books[i].name));
    assert.doesNotMatch(button.title,/展开|放大|第\s*\d+\s*页/);
    assert.equal(button.getAttribute('tabindex'),null);assert.equal(button.events.has('keydown'),false);
    assert.equal(button.dispatch('pointerdown').prevented,false);
  }
});
test('turn updates disable chapter labels while retaining the band gesture surfaces',()=>{
  const f=setup();f.index.update({turning:true});
  for(const button of visibleGroups(f)){assert.ok(button.disabled);button.click();}assert.deepEqual(f.events,[]);
  f.index.update({turning:false});assert.ok(visibleGroups(f).every(button=>!button.disabled));
});
test('current highlight follows only its physical side without replacing cut buttons',()=>{
  const f=setup(),original=classNodes(f,'edge-index__group');
  f.index.update({spread:splitBefore(books,9),currentBook:'2SA'});
  const highlighted=visibleGroups(f).filter(node=>node.getAttribute('aria-current')==='page');
  assert.equal(highlighted.length,1);assert.equal(highlighted[0].dataset.side,'right');
  for(const spread of [1216,0,1244]){
    f.index.update({spread});assert.deepEqual(classNodes(f,'edge-index__group'),original);
  }
});
test('destroy removes only owned markup and detaches native group listeners',()=>{
  const f=setup(),sibling=new Element('div',f.doc),cut=visibleGroups(f)[0];
  f.host.appendChild(sibling);f.index.destroy();f.index.destroy();
  assert.deepEqual(f.host.children,[sibling]);assert.equal(f.host.style.zIndex,'6');
  cut.click();assert.deepEqual(f.events,[]);assert.equal(cut.events.get('click').size,0);assert.equal(f.doc.events.size,0);
});
console.log(`Edge index: ${checks} checks passed (${books.length} real books, ${pageCount} real pages).`);
