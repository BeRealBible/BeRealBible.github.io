/* Contract checks for the index-17 flat-book shell; no browser or network needed. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const requiredIds=['stage','book','book-volume','reference-cover','left-half','right-half','left-paper','right-paper','left-paper-edges','right-paper-edges','ribbon-bookmarks','edge-index-host','location-button','book-name','chapter-name','prev','next','page-label','progress-label','read-block','position-pin','help-open','help-dialog','about-open','about-dialog','reading-tools','fit-book','focus-left','focus-right','zoom-in','zoom-out','zoom-value','viewport-map','map-window','gesture-feedback','demo-pan','demo-burst','demo-peek','touch-ring','book-picker','book-picker-title','book-picker-close','book-picker-back','book-picker-books','book-picker-chapters','reader-rule-loading','reader-version','reader-reload'];
const retainedScripts=['book-material.js','bible-data.js','data/bible-source.js','paper-layout.js','paper-edition.js','rule-reader-bootstrap.js','paper-typography.js','paper-page.js','gesture-core.js','paper-physics.js','paper-renderer.js','paper-edges.js','ribbon-bookmarks.js','immersion.js','reader-release.js'];
const retiredScripts=['app.js','book-kinematics.js','book-solid.js','book-packet.js','book-depth.js','book-leaves.js','book-scene.js','book-index-layout.js','book-index.js','sticker-reader.js','sticker-index.js'];
for(const entry of ['index.html','rules.html']){
  const html=fs.readFileSync(path.join(root,entry),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1].split('?')[0]);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,`${entry}: duplicate IDs`);
  for(const id of requiredIds)assert.ok(ids.includes(id),`${entry}: missing #${id}`);
  for(const file of [...retainedScripts,'edge-index.js','chapter-preview.js','edge-chapters.js','paper-jump.js','edge-reader.js'])assert.ok(scripts.includes(file),`${entry}: missing ${file}`);
  for(const file of retiredScripts)assert.ok(!scripts.includes(file),`${entry}: retired controller loaded: ${file}`);
  assert.ok(scripts.indexOf('edge-index.js')<scripts.indexOf('edge-reader.js'),`${entry}: edge API loads before reader`);
  for(const file of ['chapter-preview.js','edge-chapters.js','paper-jump.js'])assert.ok(scripts.indexOf(file)<scripts.indexOf('edge-reader.js'),`${entry}: ${file} loads before reader`);
  for(const file of ['edge-chapters.css','paper-jump.css'])assert.ok(html.includes(`href="${file}?v=index-17"`),`${entry}: new interaction styles loaded`);
  assert.ok(html.includes('纸质选章')&&html.includes('章号格子')&&html.includes('经文摘读')&&html.includes('连续翻过多张纸'),`${entry}: adaptive chapter menu and packet-jump instructions`);
  assert.ok(scripts.indexOf('rule-reader-bootstrap.js')<scripts.indexOf('edge-reader.js'),`${entry}: layout bootstrap loads before reader`);
  assert.ok(!/id="(?:scene-controls|index-placement|physical-index-host|view-edge|view-open|right-edge-open|left-edge-open|paper-solid|book-leaves)"/.test(html),`${entry}: old scene entry remains`);
  assert.ok(!/合书|合起书|看书侧|切口|切槽|半圆|拨开|半秒/.test(html),`${entry}: old interaction instructions remain`);
  assert.ok(!/sticker-(?:reader|index)|贴纸/.test(html),`${entry}: retired sticker presentation remains`);
  assert.ok(html.includes('点索引组')&&html.includes('点书口空白')&&html.includes('Esc 收起'),`${entry}: compact edge direct/select/close instructions`);
  assert.ok(html.includes('data-reader-build="index-17"'),`${entry}: release stamp`);
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
    if(/\.(?:js|css)$/.test(file))assert.ok(url.endsWith('?v=index-17'),`${entry}: unstamped resource ${url}`);
  }
}
const immersion=fs.readFileSync(path.join(root,'immersion.js'),'utf8');
assert.ok(immersion.includes('paper-directory-request'),'directory request API remains');
assert.ok(immersion.includes('书卷章节'),'tools expose book/chapter picker');
assert.ok(!/合起书|书侧目录/.test(immersion),'immersive menu has no retired scene action');
const css=fs.readFileSync(path.join(root,'edge-reader.css'),'utf8');
const edgeCss=fs.readFileSync(path.join(root,'paper-edges.css'),'utf8');
assert.match(edgeCss,/\.paper-edge-host\s*\{[^}]*position:absolute[^}]*overflow:visible/, 'edge hosts keep the outside paper block visible');
assert.match(edgeCss,/\.paper-edge-host\s+\.paper-edge-art\s*\{[^}]*overflow:visible/, 'root edge SVG does not crop paper outside the page viewBox');
assert.ok(css.includes('.right-half{left:480px}'),'right half has one page offset');
assert.ok(css.includes('.stage-wrap{perspective:none}'),'no extra perspective transforms on text');
assert.ok(css.includes('#edge-index-host'),'edge host has flat world placement');
assert.ok(css.includes('#4a443c,#1a1815 75%'),'reference warm dark background');
assert.ok(css.includes('linear-gradient(#33263f,#22192c)'),'reference thin purple cover');
assert.ok(css.includes('var(--edge-left-extent)')&&css.includes('var(--edge-right-extent)'),'cover follows normal index extents');
assert.ok(css.includes('clip-path:inset(703px 0 -8px 0)'),'PaperEdges contributes only the thin foot, never a duplicate side band');
assert.ok(css.includes('width:960px;height:704px')&&css.includes('.right-half{left:480px}'),'fixed-page world geometry remains unchanged');
console.log('edge shell: 2 entries, DOM contract, retained engine, retired scene removal and resources PASS');
