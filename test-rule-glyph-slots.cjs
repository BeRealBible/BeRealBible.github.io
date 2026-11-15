/* Ink offsets preserve natural glyphs while independent slots drive line fitting. */
'use strict';
const assert=require('node:assert/strict');
const T=require('./paper-typography.js'),Page=require('./paper-page.js');
const books=[{name:'校准样页',code:'TST'}];
const item={kind:'body',text:'“你，。”',x:0,y:100,size:12,width:36,
  advances:[6,12,6,6,6],offsets:[-6,0,0,0,0]};
const pageFor=run=>({b:0,layoutVersion:2,columnX:[38,253],displayPage:1,start:'1:1',end:'1:1',title:'',
  cols:[[{kind:'body',y:100,runs:[run]}],[]]});
const page=pageFor(item),commands=T.layoutRuleBody(page);
assert.equal(commands.map(c=>c.text).join(''),item.text,'ink offset must not edit scripture or punctuation');
assert.deepEqual(commands.map(c=>c.x),[32,44,56,62,68]);
assert.deepEqual(commands.map(c=>c.slotX),[38,44,56,62,68]);
assert.deepEqual(commands.map(c=>c.slotWidth),item.advances);
assert.deepEqual(commands.map(c=>c.advance),item.advances);
assert.ok(commands.every(c=>c.size===12),'compressed slots must never change font size');
assert.ok(commands.every(c=>!('scaleX' in c)&&!('textLength' in c)),'no anisotropic glyph scaling');
for(let i=1;i<commands.length;i++)assert.equal(commands[i].slotX,commands[i-1].slotX+commands[i-1].slotWidth);
const legacyRun={...item};delete legacyRun.offsets;
assert.deepEqual(T.layoutRuleBody(pageFor(legacyRun)).map(c=>[c.x,c.slotX]),
  commands.map(c=>[c.slotX,c.slotX]),'older rule data defaults to zero ink offset');
const parens={...item,text:'（字）',width:24,advances:[6,12,6],offsets:[-6,0,0]};
assert.equal(T.layoutRuleBody(pageFor(parens))[0].x,32);
assert.throws(()=>T.layoutRuleBody(pageFor({...item,offsets:[]})),/offset count/);
assert.throws(()=>T.layoutRuleBody(pageFor({...item,offsets:[Infinity,0,0,0,0]})),/Invalid rule glyph ink offset/);
assert.throws(()=>T.layoutRuleBody(pageFor({...item,advances:undefined})),/require per-glyph advances/);

const shared=Page.commands(page,1,books),svg=Page.svg(page,1,books);
assert.doesNotMatch(svg,/textLength|lengthAdjust|scaleX|spacingAndGlyphs/);
const svgBody=[...svg.matchAll(/<text data-role="body" x="([^"]+)" y="([^"]+)" font-size="([^"]+)"[^>]*>([^<]*)<\/text>/g)];
assert.equal(svgBody.length,commands.length);
for(let i=0;i<commands.length;i++){
  assert.equal(Number(svgBody[i][1]),commands[i].x,'SVG consumes the shifted ink x, not slotX');
  assert.equal(Number(svgBody[i][2]),commands[i].y);
  assert.equal(Number(svgBody[i][3]),commands[i].size);
  assert.equal(svgBody[i][4],commands[i].text);
}
const calls=[],stack=[];
const ctx={font:'',fillStyle:'',textAlign:'',textBaseline:'',
  scale(x,y){assert.equal(x,y,'rasterization scale must remain isotropic');},
  createLinearGradient(){return {addColorStop(){}};},fillRect(){},
  save(){stack.push({font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline});},
  restore(){Object.assign(this,stack.pop());},
  fillText(text,x,y,maxWidth){assert.equal(maxWidth,undefined,'Canvas may not squeeze glyphs to slot width');calls.push({text,x,y,size:Number(this.font.match(/([\d.]+)px/)[1])});}
};
Page.paint({getContext:()=>ctx},page,1,books,2);
assert.equal(calls.length,shared.length);
assert.equal(stack.length,0);
shared.forEach((c,i)=>assert.deepEqual(calls[i],{text:c.text,x:c.x,y:c.y,size:c.size},'Canvas and SVG use the same shared ink coordinates'));
console.log('PASS independent ink offsets and layout slots; exact text/size; SVG/Canvas parity; no glyph squeezing');
