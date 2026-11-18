/* Check both sides of the actual vector leaf, including its zoom-independent
 * occlusion envelope. This is not a substitute for live mobile paint testing. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{PaperPhysics:require('./paper-physics.js')}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'paper-renderer.js'),'utf8'),context);
const R=context.window.PaperSheetRenderer;
class E{
  constructor(type){this.type=type;this.children=[];this.attrs={};this.dataset={};this.ownerDocument=doc;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  appendChild(el){el.remove();el.parent=this;this.children.push(el);return el;}
  append(...els){for(const e of els)this.appendChild(e);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);this.parent=null;}
}
const doc={createElementNS:(_ns,type)=>new E(type)};
for(const dir of [-1,1]){
  const host=new E('div'),r=R.vector(host,n=>'<svg viewBox="0 0 480 704"><defs><linearGradient id="paper-'+n+'"/></defs><rect fill="url(#paper-'+n+')"/><text>page '+n+'</text></svg>');
  r.prepare(31,32,dir);const [layer]=host.children,[defs,shadow,stock,group]=layer.children;
  assert.equal(host.dataset.renderer,'svg-curved-sheet');assert.equal(layer.attrs['aria-hidden'],'true');assert.equal(stock.attrs.fill,'#f8f3e4');
  const ids=defs.children.map(g=>g.attrs.id);
  for(const [i,g] of defs.children.entries()){
    const [paper,ink]=g.children;assert.equal(paper.attrs.fill,'#fffdf1');assert.equal(paper.attrs.width,'480');assert.equal(paper.attrs.height,'704');
    assert.match(ink.innerHTML,new RegExp('page '+(31+i)));assert.doesNotMatch(ink.innerHTML,/id="paper-/,'stationary and animated leaves do not share paint IDs');
  }
  let previous=481;
  for(let i=0;i<=100;i++){
    const opts={progress:i/100,radius:392,grabY:352,vertical:0},covered=r.draw(opts),s=R.strips({...opts,direction:dir});
    assert.ok(covered>=0&&covered<=480&&covered<=previous+.000001);previous=covered;
    if(i===0||i===100)assert.equal(covered,i===0?480:0);
    assert.equal(stock.attrs.d,shadow.attrs.d);assert.ok(!/NaN|Infinity/.test(stock.attrs.d));
    for(const band of group.children){
      const [slice]=band.children,[use]=slice.children;assert.ok(ids.some(id=>use.attrs.href==='#'+id));
      assert.ok(!/NaN|Infinity/.test(band.attrs.transform));if(i===0||i===100)assert.equal(use.attrs.href,'#'+ids[i===0?0:1]);
    }
    // The left/right page text mask covers every projected strip on the source
    // half, including folds with both faces visible at once; units are book px.
    for(const {x} of s.points)assert.ok((x-480)*dir<=covered+.000001);
  }
  r.hide();assert.equal(host.children.length,0);assert.equal(host.dataset.curlProgress,undefined);
}
console.log('vector turn: both faces, 202 frames, opaque stock, clip geometry, private gradients and cleanup PASS');
