/* Contract checks for the index-14 flat-book shell; no browser or network needed. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const requiredIds=['stage','book','book-volume','left-half','right-half','left-paper','right-paper','left-paper-edges','right-paper-edges','ribbon-bookmarks','sticker-index-host','location-button','book-name','chapter-name','prev','next','page-label','progress-label','read-block','position-pin','help-open','help-dialog','about-open','about-dialog','reading-tools','fit-book','focus-left','focus-right','zoom-in','zoom-out','zoom-value','viewport-map','map-window','gesture-feedback','demo-pan','demo-burst','demo-peek','touch-ring','book-picker','book-picker-title','book-picker-close','book-picker-back','book-picker-books','book-picker-chapters','reader-rule-loading','reader-version','reader-reload'];
const retainedScripts=['book-material.js','bible-data.js','data/bible-source.js','paper-layout.js','paper-edition.js','rule-reader-bootstrap.js','paper-typography.js','paper-page.js','gesture-core.js','paper-physics.js','paper-renderer.js','paper-edges.js','ribbon-bookmarks.js','immersion.js','reader-release.js'];
const retiredScripts=['app.js','book-kinematics.js','book-solid.js','book-packet.js','book-depth.js','book-leaves.js','book-scene.js','book-index-layout.js','book-index.js'];
for(const entry of ['index.html','rules.html']){
  const html=fs.readFileSync(path.join(root,entry),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,`${entry}: duplicate IDs`);
  for(const id of requiredIds)assert.ok(ids.includes(id),`${entry}: missing #${id}`);
  for(const file of [...retainedScripts,'sticker-index.js','sticker-reader.js'])assert.ok(scripts.includes(file),`${entry}: missing ${file}`);
  for(const file of retiredScripts)assert.ok(!scripts.includes(file),`${entry}: retired controller loaded: ${file}`);
  assert.ok(scripts.indexOf('sticker-index.js')<scripts.indexOf('sticker-reader.js'),`${entry}: sticker API loads before reader`);
  assert.ok(scripts.indexOf('rule-reader-bootstrap.js')<scripts.indexOf('sticker-reader.js'),`${entry}: layout bootstrap loads before reader`);
  assert.ok(!/id="(?:scene-controls|index-placement|physical-index-host|view-edge|view-open|right-edge-open|left-edge-open|paper-solid|book-leaves)"/.test(html),`${entry}: old scene entry remains`);
  assert.ok(!/合书|合起书|看书侧|切口|切槽|半圆|拨开|半秒/.test(html),`${entry}: old interaction instructions remain`);
  assert.ok(html.includes('data-reader-build="index-14"'),`${entry}: release stamp`);
  assert.ok(html.includes('0.16 秒')&&html.includes('松手即响应，不等待双击'),`${entry}: fast tap and 160 ms hold instructions`);
  assert.ok(!/book-(?:index|scene|solid|leaves)\.css/.test(html),`${entry}: old scene styling loaded`);
  for(const side of ['left','right']){
    const host=html.match(new RegExp(`<div\\b[^>]*id="${side}-paper-edges"[^>]*>`))?.[0]||'';
    assert.match(host,/class="[^"]*\bpaper-edge-host\b/,`${entry}: ${side} direct-render edge host needs positioning and overflow styles`);
  }
  for(const [,url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)){
    if(/^(?:https?:|#|\.\/\?)/.test(url))continue;
    const file=url.split('?')[0];
    assert.ok(fs.existsSync(path.join(root,file)),`${entry}: referenced resource is missing: ${file}`);
    if(/\.(?:js|css)$/.test(file))assert.ok(url.endsWith('?v=index-14'),`${entry}: unstamped resource ${url}`);
  }
}
const immersion=fs.readFileSync(path.join(root,'immersion.js'),'utf8');
assert.ok(immersion.includes('paper-directory-request'),'directory request API remains');
assert.ok(immersion.includes('书卷章节'),'tools expose book/chapter picker');
assert.ok(!/合起书|书侧目录/.test(immersion),'immersive menu has no retired scene action');
const css=fs.readFileSync(path.join(root,'sticker-reader.css'),'utf8');
const edgeCss=fs.readFileSync(path.join(root,'paper-edges.css'),'utf8');
assert.match(edgeCss,/\.paper-edge-host\s*\{[^}]*position:absolute[^}]*overflow:visible/, 'edge hosts keep the outside paper block visible');
assert.match(edgeCss,/\.paper-edge-host\s+\.paper-edge-art\s*\{[^}]*overflow:visible/, 'root edge SVG does not crop paper outside the page viewBox');
assert.ok(css.includes('.right-half{left:480px}'),'right half has one page offset');
assert.ok(css.includes('.stage-wrap{perspective:none}'),'no extra perspective transforms on text');
assert.ok(css.includes('#sticker-index-host'),'sticker host has flat world placement');
console.log('sticker shell: 2 entries, DOM contract, retained engine, retired scene removal and resources PASS');
