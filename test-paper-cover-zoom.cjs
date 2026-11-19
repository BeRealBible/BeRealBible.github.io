'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mount,zoomLimits,asScale}=require('./paper-cover-zoom.js');
class Node extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.doc=doc;this.children=[];this.attrs={};this.hidden=false;}
 append(...items){for(const n of items){n.parent=this;this.children.push(n);}}
 prepend(n){n.parent=this;this.children.unshift(n);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
 querySelector(s){const hit=this.children.find(x=>'.'+x.className===s);if(hit)return hit;for(const c of this.children){const found=c.querySelector(s);if(found)return found;}}
 setAttribute(key,val){this.attrs[key]=val;}
 getAttribute(key){return this.attrs[key];}
 focus(){this.doc.activeElement=this;}
 closest(){return null;}
 contains(n){return this.children.includes(n)||this.children.some(x=>x.contains(n));}
}
function fixture(reduce=false){
 const doc=new EventTarget();doc.createElement=tag=>new Node(tag,doc);
 const stage=doc.createElement('div'),history=doc.createElement('section'),shelf=doc.createElement('div'),map=doc.createElement('div'),body=doc.createElement('div');
 map.className='viewport-map';body.className='page';stage.append(map,body);shelf.className='rh-rail';history.append(shelf);
 const state={n:null};const win={matchMedia:()=>({matches:reduce})};
 const c=mount({doc,win,stage,history,onZoom(n){state.n=n;}});
 return {c,doc,stage,shelf,state,map,body};
}
test('range follows fit, current zoom and absolute limit',()=>{
 assert.deepEqual(zoomLimits(1.1,.4,3.2),{max:800,value:275});
 assert.equal(asScale(275,.4,3.2),1.1);assert.equal(asScale(99,.4,3.2),.4);
 assert.equal(asScale(864,.37,3.2),3.2);assert.equal(asScale(0,0,3.2),null);
});
test('scale tool precedes jump history, opens accessibly, and uses camera callback',()=>{
 const {c,doc,shelf,state}=fixture(),panel=shelf.querySelector('.pcz-panel'),button=shelf.querySelector('.pcz-button'),range=shelf.querySelector('.pcz-range');
 c.sync(.8,.4,3.2); assert.equal(range.getAttribute('aria-valuetext'),'200%');
 assert.equal(shelf.children[0].className,'pcz-control');assert.equal(panel.hidden,true);
 button.dispatchEvent(new Event('click'));assert.equal(doc.activeElement,range);assert.equal(button.getAttribute('aria-expanded'),'true');
 range.value='330';range.dispatchEvent(new Event('input'));assert.equal(state.n,330);
 const esc=new Event('keydown',{cancelable:true});Object.defineProperty(esc,'key',{value:'Escape'});shelf.children[0].dispatchEvent(esc);
 assert.equal(esc.defaultPrevented,true);assert.equal(panel.hidden,true);assert.equal(doc.activeElement,button);
});
test('opening is decorative, dismissed by input, never replays in a document',()=>{
 const {c,doc,stage,map,body}=fixture();
 c.openOnce();assert.ok(stage.querySelector('.pcz-face'));assert.ok(stage.querySelector('.pcz-stack'));
 assert.equal(stage.children[0],map);assert.equal(stage.children[1],body);
 const click=new Event('pointerdown',{cancelable:true});doc.dispatchEvent(click);
 assert.equal(click.defaultPrevented,false);assert.equal(stage.querySelector('.pcz-intro'),undefined);
 c.openOnce();assert.equal(stage.querySelector('.pcz-intro'),undefined);
});
test('reduced motion does not intercept first reading action',()=>{
 const {c,stage}=fixture(true);c.openOnce();assert.equal(stage.querySelector('.pcz-intro'),undefined);
});
