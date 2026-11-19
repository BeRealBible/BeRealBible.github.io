/* Runs the real edge reader controller with deterministic input/timing.
 * Curl renderer, jump timing and reading-history callbacks are spies; scripture, physics and paper material are real.
 * Integration scenarios also run the real EdgeIndex and chapter-popover DOM modules.
 * This does not replace browser rendering or physical-phone acceptance tests. */
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Physics = require('./paper-physics.js');
const Gestures = require('./gesture-core.js');
const Material = require('./book-material.js');
const Page = require('./paper-page.js');
const Edges = require('./paper-edges.js');
const EdgeIndex = require('./edge-index.js');
let ruleData, bibleSource;
function currentBibleSource() {
  if (!bibleSource) {
    const sourceContext = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data/bible-source.js'), 'utf8'), sourceContext);
    bibleSource = sourceContext.window.BIBLE_SOURCE;
  }
  return bibleSource;
}
function currentRuleData() {
  if (!ruleData) ruleData = require('./paper-layout.js').paginate(currentBibleSource());
  return ruleData;
}

function fixture(startSpread = 2, options = {}) {
  let now = 0, nextId = 1, observer, edgeOptions, historyOptions, readerIndex, chapterOptions, chapterOpenState = null;
  let jumpActive = null, chapterReader;
  const timers = new Map(), elements = new Map(), events = {}, rendered = [], draws = [];
  const saved = [], edgeCalls = [], sceneCalls = [], jumpCalls = [], chapterCalls = [], previewCalls = [], previewSources = [];
  const storage = new Map(Object.entries({
    'paper-bible-position-v1': JSON.stringify({ spread: startSpread, ...(options.pose || {}) }),
    ...(options.storage || {})
  }));
  const style = () => ({ setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } });
  function listen(target, type, fn) { (target[type] ||= []).push(fn); }
  function dispatch(target, type, event = {}) {
    event.type = type; event.preventDefault ||= () => { event.defaultPrevented = true; };
    event.stopPropagation ||= () => { event.propagationStopped = true; };
    for (const fn of [...(target[type] || [])]) fn(event);
  }
  class Element {
    constructor(id, tag = 'DIV') {
      this.id = id; this.tagName = tag.toUpperCase(); this.style = style(); this.handlers = {};
      this.dataset = new Proxy({}, { set: (o, k, v) => (o[k] = String(v), true) });
      this.attributes = {}; this.children = []; this.innerHTML = ''; this.textContent = '';
      this.clientWidth = id === 'stage' ? (options.width || 980) : 65;
      this.clientHeight = id === 'stage' ? (options.height || 720) : 46;
      this.hidden = false; this.disabled = false; this.inert = false; this.open = false;
      this.classes = new Set(); this.captured = new Set(); this.value = '';
      this.classList = {
        add: (...xs) => xs.forEach(x => this.classes.add(x)),
        remove: (...xs) => xs.forEach(x => this.classes.delete(x)),
        contains: x => this.classes.has(x),
        toggle: (x, on = !this.classes.has(x)) => (on ? this.classes.add(x) : this.classes.delete(x), on)
      };
    }
    addEventListener(type, fn) { listen(this.handlers, type, fn); }
    get ownerDocument() { return doc; }
    get className() { return [...this.classes].join(' '); }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(x => x !== fn); }
    dispatchEvent(event) {
      event.target ||= this; event.currentTarget = this;
      dispatch(this.handlers, event.type, event); this['on' + event.type]?.(event);
      return !event.defaultPrevented;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    contains(child) { return child === this || this.children.some(c => c.contains?.(child)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const s = part.trim();
        if (s.startsWith('#')) return this.id === s.slice(1);
        if (s.startsWith('.')) return this.classes.has(s.slice(1));
        if (s === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
        const attr = s.match(/^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/);
        if (attr) { const v = attr[1].startsWith('data-') ? this.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(attr[1]); return v != null && (attr[2] === undefined || v === attr[2]); }
        return this.tagName.toLowerCase() === s.toLowerCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches?.(selector) ? [c] : []), ...(c.querySelectorAll?.(selector) || [])]); }
    getBoundingClientRect() {
      if (options.measureChapterPanel && this.classList.contains('edge-chapters__panel')) {
        // Deterministic content-box measurements let controller integration
        // exercise growing/shrinking menus without pretending to render CSS.
        const count = Number(this.dataset.count) || 1, preview = this.dataset.mode === 'preview';
        const columns = preview ? ((options.width || 980) < 520 ? 1 : 2) : count <= 9 ? 3 : 6;
        const naturalHeight = 112 + (this.querySelectorAll('.edge-chapters__book').length > 1 ? 32 : 0) + Math.ceil(count / columns) * (preview ? 76 : 32);
        const width = parseFloat(this.style.width) || this.clientWidth;
        const height = Math.min(naturalHeight, parseFloat(this.style.maxHeight) || naturalHeight);
        const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
        return { left, top, width, height, right: left + width, bottom: top + height };
      }
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
    }
    setPointerCapture(id) { this.captured.add(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    focus() { doc.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    scrollIntoView() {}
  }
  const buttonIds = /^(prev|next|zoom-in|zoom-out|zoom-fit|focus-left|focus-right|location-button|book-picker-close|help|help-close|about|about-close|demo-|view-)/;
  function el(id) {
    if (!elements.has(id)) elements.set(id, new Element(id, /dialog|picker$/.test(id) ? 'DIALOG' : buttonIds.test(id) ? 'BUTTON' : 'DIV'));
    return elements.get(id);
  }
  const doc = {
    getElementById: el,
    querySelector: selector => [...elements.values()].find(e => e.matches(selector)) || null,
    querySelectorAll: selector => [...elements.values()].filter(e => e.matches(selector)),
    createElement: tag => new Element('', tag),
    addEventListener: (type, fn) => listen(events, 'document:' + type, fn),
    dispatchEvent: event => dispatch(events, 'document:' + event.type, event), hidden: false
  };
  doc.body = el('body'); doc.documentElement = el('html');
  el('stage-wrap').classList.add('stage-wrap');
  el('stage-wrap').appendChild(el('stage')); el('stage').appendChild(el('book'));
  el('book').appendChild(el('book-volume'));
  for (const side of ['left', 'right']) { el('book-volume').appendChild(el(side + '-half')); el(side + '-half').appendChild(el(side + '-paper')); }
  const store = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)); saved.push({ at: now, key, value: JSON.parse(value) }); },
    removeItem: key => { storage.delete(key); saved.push({ at: now, key, removed: true }); }
  };
  class Renderer {
    static vector() { return new Renderer(); }
    constructor() { this.last = null; }
    prepare(front, back, direction, count) { rendered.push({ front, back, direction, count, at: now }); }
    draw(frame) { this.last = frame; draws.push({ ...frame, at: now }); return 'polygon(480px 0px, 480px 704px, '+(480*(1-frame.progress)).toFixed(2)+'px 704px)'; }
    hide() { this.last = null; }
  }
  let edgeBounds = { leftExtent: 52, rightExtent: 52, normalLeftExtent: 52, normalRightExtent: 52 };
  let edgeItems = [], edgeLayout, expandedSide = null, edgeState = { spread: startSpread, turning: false };
  function edgeGeometry() {
    if (options.realEdgeGeometry) {
      edgeLayout = EdgeIndex.layout(context.BIBLE_DATA.books, context.BIBLE_DATA.pages.length, edgeState.spread, expandedSide);
      edgeItems = [...edgeLayout.groups, ...edgeLayout.expandedBooks];
      edgeBounds = edgeLayout.bounds;
    } else {
      edgeBounds = { leftExtent: expandedSide === 'left' ? 240 : 52, rightExtent: expandedSide === 'right' ? 240 : 52, normalLeftExtent: 52, normalRightExtent: 52 };
    }
    return edgeBounds;
  }
  const edge = {
    update: (...args) => {
      edgeCalls.push({ type: 'update', args, at: now });
      edgeState = { ...edgeState, ...args[0] };
      if (edgeState.turning) expandedSide = null;
      return edgeGeometry();
    },
    setSpread: (...args) => edgeCalls.push({ type: 'spread', args, at: now }),
    setScale: (...args) => edgeCalls.push({ type: 'scale', args, at: now }),
    setTurning: (...args) => edgeCalls.push({ type: 'turning', args, at: now }),
    getBounds: () => edgeBounds,
    getNormalBounds: () => ({ leftExtent: edgeBounds.normalLeftExtent, rightExtent: edgeBounds.normalRightExtent }),
    setExpanded: side => {
      if (edgeState.turning) side = null;
      if (side === expandedSide) return expandedSide;
      expandedSide = side; edgeGeometry(); edgeCalls.push({ type: 'expanded', side, at: now });
      edgeOptions?.onExpand?.(side); return expandedSide;
    },
    getExpanded: () => expandedSide,
    destroy() {}
  };
  function finishJump(call = jumpActive, stale = false) {
    if (!call || (!stale && jumpActive !== call)) return;
    if (jumpActive === call) jumpActive = null;
    call.finished = (call.finished || 0) + 1; call.options.onFinish?.();
  }
  const jump = {
    start(args) {
      if (jumpActive) this.cancel();
      const call = { options: args, at: now, from: args.from, to: args.to, cancelled: false, finished: 0 };
      jumpCalls.push(call); jumpActive = call;
      if (!options.manualJump) finishJump(call);
      return true;
    },
    cancel() { const call = jumpActive; if (call) { jumpActive = null; call.cancelled = true; call.options.onCancel?.(); } },
    isActive: () => Boolean(jumpActive)
  };
  const chapters = {
    open(args) { chapterOpenState = args; chapterCalls.push({ type: 'open', args, at: now }); },
    close() { chapterOpenState = null; chapterCalls.push({ type: 'close', at: now }); },
    isOpen: () => Boolean(chapterOpenState), destroy() { chapterOpenState = null; }
  };
  const context = {
    console, document: doc, navigator: {}, performance: { now: () => now },
    PaperPhysics: Physics, PaperGestures: Gestures, PaperBookMaterial: Material, PaperPage: Page, PaperEdges: Edges,
    PaperSheetRenderer: Renderer, PaperTextSelection: options.selectionModule, PaperReadingHistory: {create(args){historyOptions=args;return options.historyModule?.create(args)||{start(){},advance(){},jump(_loc,id){return id?{id}:null;}};}}, PaperBookDesk:options.deskModule,
    PaperJump: { create: () => jump },
    BIBLE_SOURCE: options.source || currentBibleSource(),
    PaperChapterPreview: { create: source => {
      previewSources.push(source); const lookup = require('./chapter-preview.js').create(source);
      return (code, chapter) => { previewCalls.push({ code, chapter }); return lookup(code, chapter); };
    } },
    PaperEdgeChapters: { create: (host, args) => { chapterOptions = args; chapterReader = options.realChaptersDom ? require('./edge-chapters.js').create(host, args) : chapters; return chapterReader; } },
    PaperEdgeIndex: { create: (host, args) => { edgeOptions = args || host; readerIndex = options.realIndexDom ? EdgeIndex.create(host, args) : edge; return readerIndex; } },
    PaperImmersion: { setScene: value => sceneCalls.push(value), showChrome() {}, hideChrome() {} },
    localStorage: options.customStorage ? { getItem() { throw Error('wrong storage read'); }, setItem() { throw Error('wrong storage write'); } } : store,
    matchMedia: () => ({ matches: !!options.reducedMotion, addEventListener() {}, removeEventListener() {} }),
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout: (fn, ms = 0) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = nextId++; timers.set(id, { fn: () => fn(now), at: now + 16 }); return id; },
    cancelAnimationFrame: id => timers.delete(id),
    ResizeObserver: class { constructor(fn) { observer = fn; } observe() {} },
    innerWidth: options.width || 980, innerHeight: options.height || 720,
    addEventListener: (type, fn) => listen(events, type, fn),
    dispatchEvent: event => dispatch(events, event.type, event)
  };
  if (options.customStorage) context.PAPER_READER_STORAGE = store;
  if (options.initialSpread !== undefined) context.PAPER_INITIAL_SPREAD = options.initialSpread;
  if (options.initialPage !== undefined) context.PAPER_INITIAL_PAGE = options.initialPage;
  context.window = context; doc.defaultView = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bible-data.js'), 'utf8'), context);
  if (options.data) context.BIBLE_DATA = options.data;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'edge-reader.js'), 'utf8'), context, { filename: 'edge-reader.js' });
  function advance(ms) {
    const end = now + ms; let loops = 0;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++loops > 20000) throw Error('timer loop');
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  function emit(type, x, y, id = 1, pointerType = 'mouse', target = el('right-paper')) {
    const event = { type, clientX: x, clientY: y, pointerId: id, pointerType, button: 0, timeStamp: now, target };
    el('stage').dispatchEvent(event); return event;
  }
  function at(side = 'right', radius = 467, localY = 310) {
    const stage = el('stage'), scale = Number(stage.dataset.scale);
    return { x: Number(stage.dataset.x) + (480 + (side === 'right' ? radius : -radius)) * scale, y: Number(stage.dataset.y) + localY * scale, scale, radius, side };
  }
  function tap(side = 'right', duration = 1, pointerType = 'mouse', localY = 310) {
    const p = at(side, 350, localY); emit('pointerdown', p.x, p.y, 1, pointerType, el(side + '-paper')); advance(duration); emit('pointerup', p.x, p.y, 1, pointerType, el(side + '-paper')); return p;
  }
  function swipe(direction = 1, pointerType = 'touch', duration = 60) {
    const p=at(direction>0?'right':'left'); emit('pointerdown',p.x,p.y,1,pointerType);
    advance(duration); emit('pointerup',p.x-64*direction,p.y+2,1,pointerType); return p;
  }
  function hold(side = 'right', pointerType = 'mouse') {
    const p = at(side); emit('pointerdown', p.x, p.y, 1, pointerType, el(side + '-paper')); advance(160); return p;
  }
  function drag(p, progress, type = 'pointermove', pointerType = 'mouse') {
    const px = p.x - (p.side === 'right' ? 1 : -1) * progress * 2 * p.radius * p.scale;
    emit(type, px, p.y, 1, pointerType, el(p.side + '-paper'));
  }
  function click(id, extra = {}) { el(id).dispatchEvent({ type: 'click', detail: 1, ...extra }); }
  function selectBook(index, metadata) {
    assert.ok(edgeOptions, 'edge index is installed');
    if (options.realIndexDom) return readerIndex.element.querySelector(`[data-book="${index}"]`).dispatchEvent({ type: 'click' });
    if (edgeState.turning) return;
    return edgeOptions.onSelect(index, context.BIBLE_DATA.books[index], metadata || { bookIndices: [index], anchor: { left: 300, top: 250, width: 44, height: 26, right: 344, bottom: 276 } });
  }
  function chooseChapter(page) {
    assert.ok(chapterOptions, 'chapter selector is installed');
    if (options.realChaptersDom) {
      const button = chapterReader.element.querySelectorAll('.edge-chapters__chapter').find(node => Number(node.dataset.page) === page)
        || chapterReader.element.querySelectorAll('.edge-chapters__opening').find(node => Number(node.dataset.page) === page);
      assert.ok(button, 'requested real chapter button exists'); return button.dispatchEvent({ type: 'click' });
    }
    chapters.close(); return chapterOptions.onSelect(page);
  }
  return { el, advance, emit, at, tap, swipe, hold, drag, click, context, rendered, draws, saved, storage, edgeCalls, sceneCalls, jumpCalls, chapterCalls, previewCalls, previewSources,
    get now() { return now; }, get position() { return JSON.parse(storage.get('paper-bible-position-v1')); }, get edgeItems() { return edgeItems; },
    get edgeLayout() { return options.realIndexDom ? EdgeIndex.layout(context.BIBLE_DATA.books, context.BIBLE_DATA.pages.length, Number(el('stage').dataset.spread), readerIndex.getExpanded()) : edgeLayout; },
    get expandedSide() { return readerIndex.getExpanded(); }, get indexElement() { return readerIndex.element; },
    get chapterState() { return chapterOpenState; }, get chapterElement() { return chapterReader.element; }, get chaptersOpen() { return chapterReader.isOpen(); }, get chapterOptions() { return chapterOptions; }, get jumpActive() { return jump.isActive(); },
    get chapterMode() { return chapterReader.getMode(); }, setChapterMode: mode => chapterReader.setMode(mode),
    finishJump: () => finishJump(), cancelJump: () => jump.cancel(), invokeJumpFinish: index => finishJump(jumpCalls[index], true),
    invokeJumpCancel: index => jumpCalls[index].options.onCancel?.(),
    event: (type, extra = {}) => dispatch(events, type, extra), resize: () => observer?.(),
    selectBook, chooseChapter,
    goBook: index => { selectBook(index); chooseChapter(context.BIBLE_DATA.books[index].first); },
    expand: side => { assert.ok(edgeOptions, 'edge index is installed'); return readerIndex.setExpanded(side); },
    navigateDirectory:page=>chapterOptions.onSelect(page), navigateHistory:(page,id,entry)=>historyOptions.onNavigate(page,id,entry) };
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });
const spread = f => Number(f.el('stage').dataset.spread);
const state = f => f.el('stage').dataset.foldState;
function wheelAt(f,point,dx,dy,extra={}){
  const event={type:'wheel',clientX:point.x,clientY:point.y,deltaX:dx,deltaY:dy,target:f.el('right-paper'),...extra};
  f.el('stage').dispatchEvent(event);return event;
}
function assertReading(f) {
  assert.equal(f.el('stage').dataset.scene, 'reading');
  assert.ok(f.sceneCalls.every(s => s === 'reading'), 'no closing, edge-on or directory scene');
}
test('desk, two text columns, inter-column whitespace and outward edge drags never lift the opposite page',()=>{
  for(const type of ['mouse','touch'])for(const [face,radius,y,dx] of [
    ['right',105,195,-66],['right',240,480,-65],['left',310,280,65],['right',0,190,-65],
    ['right',470,-8,-65],['right',494,660,-65],['right',469,660,65],['left',470,41,-65]
  ]){
    const f=fixture(20),p=f.at(face,radius,y),source=f.el(y<0||radius>480?'stage':face+'-paper');
    f.emit('pointerdown',p.x,p.y,1,type,source);f.emit('pointermove',p.x+dx,p.y,1,type,source);
    f.emit('pointerup',p.x+dx,p.y,1,type,source);f.advance(800);
    assert.equal(spread(f),20);assert.equal(f.rendered.length,0);assert.equal(f.el('fit-book').classList.contains('active'),true);
  }
});
test('same horizontal drag pans from a glyph and from an adjacent blank in the zoomed text column',()=>{
  const word={},f=fixture(20,{selectionModule:{create:()=>({hit:(_x,_y,t)=>t===word?{}:null,isActive:()=>false,reset(){}})}});
  function drag(target){
    f.click('fit-book');f.click('zoom-in');f.click('zoom-in');
    const p=f.at('right',280,240),before=Number(f.el('stage').dataset.x);
    f.emit('pointerdown',p.x,p.y,1,'mouse',target);f.emit('pointermove',p.x-76,p.y+3,1,'mouse',target);
    f.emit('pointerup',p.x-76,p.y+3,1,'mouse',target);
    return Number(f.el('stage').dataset.x)-before;
  }
  const ink=drag(word),gap=drag(f.el('right-paper'));assert.ok(ink<-70);assert.equal(gap,ink);
  assert.equal(spread(f),20);assert.equal(f.rendered.length,0);
});
test('horizontal wheel burst flips one spread at book-fit, ignores inertia and never interprets vertical wheel as navigation',()=>{
  const f=fixture(20),p=f.at('right',310,330);
  for(let i=0;i<5;i++){wheelAt(f,p,2,32);f.advance(22);}
  f.advance(300);assert.equal(f.rendered.length,0);
  for(let i=0;i<6;i++){wheelAt(f,{x:5,y:2},33,0,{target:f.el('stage')});f.advance(18);}
  assert.equal(f.rendered.length,0,'no action in the table outside the book');
  for(let i=0;i<14;i++){wheelAt(f,p,17,2);f.advance(43);}
  f.advance(350);assert.equal(spread(f),22);assert.equal(f.rendered.length,1);
  wheelAt(f,p,-4,0,{deltaMode:1});f.advance(500);assert.equal(spread(f),20);
  assert.equal(f.el('fit-book').classList.contains('active'),true);
});
test('zoomed two-finger horizontal wheel only pans; strip and named book buttons keep Ctrl-wheel inside the reader',()=>{
  const f=fixture(20,{realIndexDom:true}),p=f.at('right',260,340),band=f.indexElement.querySelectorAll('.edge-index__band')[1],
    label=f.indexElement.querySelectorAll('.edge-index__group').find(b=>!b.hidden);
  for(const button of [band,label])assert.equal(wheelAt(f,p,0,-90,{ctrlKey:true,target:button}).defaultPrevented,true);
  assert.ok(parseInt(f.el('zoom-value').textContent)>155);
  const before=Number(f.el('stage').dataset.x);wheelAt(f,p,-20,0);f.advance(500);
  assert.notEqual(Number(f.el('stage').dataset.x),before);assert.equal(f.rendered.length,0);
  f.click('fit-book');if(!f.expandedSide)f.expand('right');
  const z=Number(f.el('stage').dataset.scale);assert.equal(wheelAt(f,p,0,-70,{ctrlKey:true,target:band}).defaultPrevented,true);
  assert.equal(f.expandedSide,'right');assert.ok(Number(f.el('stage').dataset.scale)>z);
  wheelAt(f,p,80,0,{target:band});assert.equal(f.rendered.length,0);f.expand(null);
  assert.equal(f.el('zoom-value').textContent,'100%','looking at a zoomed edge has not overwritten the reading pose');
});
test('lifting one finger after a pinch allows immediate single-finger pan without selection or a page turn',()=>{
  const f=fixture(20,{width:390,height:844}),p=f.at('right',300,300),s=f.el('stage');
  f.emit('pointerdown',p.x-40,p.y,1,'touch');f.emit('pointerdown',p.x+40,p.y,2,'touch');
  f.emit('pointermove',p.x+100,p.y+15,2,'touch');f.emit('pointerup',p.x+100,p.y+15,2,'touch');
  const before=[+s.dataset.x,+s.dataset.y,+s.dataset.scale];
  f.emit('pointermove',p.x-67,p.y-30,1,'touch');f.advance(550);f.emit('pointerup',p.x-67,p.y-30,1,'touch');
  assert.ok(Math.abs(+s.dataset.x-before[0]+27)<.03);assert.ok(Math.abs(+s.dataset.y-before[1]+30)<.03);
  assert.equal(+s.dataset.scale,before[2]);assert.equal(spread(f),20);assert.equal(f.rendered.length,0);
});
test('modified browser navigation arrows pass through without turning pages',()=>{
  const f=fixture(20);
  for(const key of ['ArrowLeft','ArrowRight']){const e={type:'keydown',key,altKey:true};f.el('stage').dispatchEvent(e);assert.ok(!e.defaultPrevented);}
  f.advance(800);assert.equal(f.rendered.length,0);assert.equal(spread(f),20);
  const e={type:'keydown',key:'ArrowRight'};f.el('stage').dispatchEvent(e);assert.ok(e.defaultPrevented);f.advance(800);assert.equal(spread(f),22);
});

for(const pointerType of ['mouse','touch'])for(const dir of [-1,1])test(pointerType+' horizontal blank swipe turns exactly one spread '+dir,()=>{
  const f=fixture(20),source=f.el(dir>0?'right-paper':'left-paper'),original=source.innerHTML;
  f.swipe(dir,pointerType);assert.equal(spread(f),20);assert.equal(f.rendered.length,1);assert.equal(f.rendered[0].direction,dir);
  assert.equal(source.classList.contains('under-curl'),true);assert.notEqual(source.innerHTML,original);
  assert.match(source.style['--under-sheet-clip'],/^polygon\(/,'uses the moving sheet’s angled occlusion mask');
  f.advance(600);assert.equal(spread(f),20+2*dir);assert.equal(source.classList.contains('under-curl'),false);assert.equal(source.style['--under-sheet-clip'],undefined);assertReading(f);
});
for(const ms of [1,40,159,360,1500])test('stationary blank contact never grabs or flips even after '+ms+'ms',()=>{
  const f=fixture(20);f.tap('right',ms);f.advance(1000);assert.equal(f.rendered.length,0);assert.equal(spread(f),20);
});
test('text taps and long holds route through hit-tested tokens, never through the blank swipe recognizer',()=>{
  const calls=[],owner={},token={id:1};let active=false;
  const f=fixture(20,{selectionModule:{create:()=>({
    hit:(_x,_y,t)=>t===owner?token:null,
    tap:t=>calls.push(['tap',t]),hold:t=>{calls.push(['hold',t]);active=true;},
    reset:()=>{active=false;},isActive:()=>active
  })}}),p=f.at();
  const event=(type,dx=0,dy=0)=>f.emit(type,p.x+dx,p.y+dy,1,'touch',owner);
  event('pointerdown');f.advance(5);event('pointerup');assert.deepEqual(calls,[['tap',token]]);
  event('pointerdown');f.advance(359);assert.equal(calls.length,1);
  f.advance(1);event('pointerup');assert.deepEqual(calls,[['tap',token],['hold',token]]);
  f.click('zoom-in');assert.equal(active,true,'resizing the SVG does not discard a selection');
  event('pointerdown');event('pointerup');assert.equal(calls.length,3);assert.equal(calls[2][0],'tap');
  f.swipe();f.click('next');f.advance(1000);assert.equal(spread(f),20);assert.equal(f.rendered.length,0,'stays on single sheet during selection');
  f.event('blur');assert.equal(active,false);
  event('pointerdown');event('pointermove',-42);f.advance(800);event('pointerup',-80);assert.equal(f.rendered.length,0);assert.equal(calls.length,3);
  event('pointerdown');f.emit('pointerdown',p.x,p.y+40,2,'touch');f.advance(600);event('pointerup');f.emit('pointerup',p.x,p.y+40,2,'touch');assert.equal(calls.length,3);
});
for(const [dir,height] of [[1,660],[-1,42]])test('corner drag follows a held pointer before release and keeps its starting height '+dir,()=>{
  const f=fixture(20),p=f.at(dir===1?'right':'left',464,height),paper=f.el(dir===1?'right-paper':'left-paper');
  const send=(kind,d=0,dy=0)=>f.emit(kind,p.x-dir*d,p.y+dy,1,'touch',paper);
  send('pointerdown');f.advance(20);send('pointermove',52,4);
  assert.equal(state(f),'dragging');assert.equal(f.rendered.length,1);assert.equal(spread(f),20);
  const a=f.draws.at(-1);assert.ok(a.progress>0);assert.ok(Math.abs(a.grabY-height)<2);assert.ok(a.radius>400);
  f.advance(450);assert.equal(f.draws.at(-1).progress,a.progress,'held corner does not travel without the finger');
  send('pointermove',120,20);const b=f.draws.at(-1);assert.ok(b.progress>a.progress);assert.notEqual(b.vertical,a.vertical);
  assert.match(paper.style['--under-sheet-clip'],/^polygon/);
  send('pointermove',14,1);assert.ok(f.draws.at(-1).progress<b.progress);f.advance(250);send('pointerup',14,1);f.advance(800);
  assert.equal(spread(f),20);assert.equal(state(f),'returned');assert.equal(paper.style['--under-sheet-clip'],undefined);
});
test('dragging back through the origin never starts an opposite turn within the original contact',()=>{
  const f=fixture(20),p=f.at('left');f.emit('pointerdown',p.x,p.y);f.emit('pointermove',p.x+40,p.y);f.emit('pointerup',p.x-65,p.y);
  f.advance(1000);assert.equal(spread(f),20);assert.equal(f.rendered.length,1);
});
for(const dir of [-1,1])test('last intentional motion towards the source cancels even past the halfway mark and after a pause '+dir,()=>{
  const f=fixture(20),p=f.at(dir>0?'right':'left',467,dir>0?652:50);
  const send=(t,dx)=>f.emit(t,p.x-dir*dx*p.scale,p.y,1,'mouse',f.el(dir>0?'right-paper':'left-paper'));
  send('pointerdown',0);f.advance(30);send('pointermove',600);f.advance(320);assert.equal(spread(f),20);
  assert.ok(f.draws.at(-1).progress>.5);send('pointermove',520);const partial=f.draws.at(-1).progress;
  f.advance(600);assert.equal(f.draws.at(-1).progress,partial);assert.equal(spread(f),20);
  send('pointerup',521);f.advance(1000);assert.equal(spread(f),20);assert.equal(state(f),'returned');assert.equal(f.rendered.length,1);
});
test('unexpanded striped edge distinguishes the index click from the page drag without swallowing named tabs',()=>{
  const f=fixture(20),stage=f.el('stage'),p=f.at('right',478,625),band=f.el('edge-band-probe');band.className='edge-index__band';
  const send=(t,dx,target=band)=>f.emit(t,p.x-dx,p.y,1,'touch',target);
  const nativeClick=()=>{const e={type:'click',target:band,detail:1};stage.dispatchEvent(e);return !e.defaultPrevented;};
  send('pointerdown',0);send('pointerup',0);assert.ok(nativeClick(),'tap can reach the native index handler');assert.equal(f.rendered.length,0);
  send('pointerdown',0);send('pointermove',55);assert.equal(state(f),'dragging');f.advance(520);assert.equal(spread(f),20);
  send('pointerup',55);assert.ok(!nativeClick(),'trailing synthetic click cannot reopen the index');f.advance(900);assert.equal(spread(f),22);
  const tab=f.el('demo-index-test');tab.className='edge-index__group';send('pointerdown',0,tab);send('pointermove',70,tab);send('pointerup',70,tab);f.advance(900);assert.equal(spread(f),22);
});
test('a deliberate short forward drag held stationary still commits on release without fling velocity',()=>{
  const f=fixture(20),p=f.at('right',467,610);f.emit('pointerdown',p.x,p.y);f.advance(350);f.emit('pointermove',p.x-60,p.y);
  f.advance(700);assert.equal(spread(f),20);assert.equal(state(f),'dragging');f.emit('pointerup',p.x-60,p.y);f.advance(800);assert.equal(spread(f),22);
});
test('a long held forward pull does not commit early and a tiny release wobble does not cancel it',()=>{
  const f=fixture(20),p=f.at('right',467,640);
  f.emit('pointerdown',p.x,p.y);f.emit('pointermove',p.x-520*p.scale,p.y-21);f.advance(900);assert.equal(state(f),'dragging');assert.equal(spread(f),20);
  f.emit('pointerup',p.x-520*p.scale+1,p.y-21);f.advance(900);assert.equal(spread(f),22);
});
test('micro swipe, reversal to origin, vertical pan and diagonal pan do not turn pages',()=>{
  const f=fixture(20,{width:390,height:844}),p=f.at();
  for(const [dx,dy] of [[-24,0],[0,-65],[-43,-43]]){
    f.emit('pointerdown',p.x,p.y);f.emit('pointerup',p.x+dx,p.y+dy);f.advance(500);
  }
  f.emit('pointerdown',p.x,p.y);f.emit('pointermove',p.x-70,p.y);f.emit('pointerup',p.x,p.y);
  f.advance(500);assert.equal(spread(f),20);assert.equal(state(f),'returned');assert.equal(f.el('right-paper').classList.contains('under-curl'),false);
});
test('cancelled pointer and lost capture cannot commit a pending swipe',()=>{
  for(const type of ['pointercancel','lostpointercapture']){
    const f=fixture(20),p=f.at();f.emit('pointerdown',p.x,p.y);f.emit('pointermove',p.x-120,p.y);
    f.el('stage').dispatchEvent({type,pointerId:1});f.advance(600);assert.equal(spread(f),20);assert.equal(f.rendered.length,1);assert.equal(state(f),'returned');
    for(const key of ['x','y','scale'])assert.ok(Number.isFinite(Number(f.el('stage').dataset[key])));
  }
});
test('second finger cancels an uncommitted swipe and pinch only changes camera',()=>{
  const f=fixture(20),p=f.at();f.emit('pointerdown',p.x,p.y,1,'touch');f.emit('pointermove',p.x-40,p.y,1,'touch');
  f.emit('pointerdown',p.x,p.y+60,2,'touch');f.emit('pointermove',p.x+100,p.y+120,2,'touch');
  f.emit('pointerup',p.x-40,p.y,1,'touch');f.emit('pointerup',p.x+100,p.y+120,2,'touch');f.advance(1200);
  assert.equal(spread(f),20);assert.equal(f.rendered.length,1);assert.equal(state(f),'returned');assert.ok(Number(f.el('stage').dataset.scale)>p.scale);
});
for(const reason of ['blur','paper-interrupt','document:visibilitychange','resize','Escape'])test(reason+' restores source and unwinds the opaque clip',()=>{
  const f=fixture(20),paper=f.el('right-paper'),original=paper.innerHTML;f.swipe();f.advance(95);
  if(reason==='document:visibilitychange')f.context.document.hidden=true;
  if(reason==='resize')f.resize();else if(reason==='Escape')f.el('stage').dispatchEvent({type:'keydown',key:'Escape'});else f.event(reason);
  f.advance(1000);assert.equal(spread(f),20);assert.equal(state(f),'returned');assert.equal(paper.innerHTML,original);assert.equal(paper.style['--under-sheet-clip'],undefined);
});
test('first and last spread reject outward swipes',()=>{
  const final=fixture().context.BIBLE_DATA.pages.length-2;
  for(const [page,dir] of [[0,-1],[final,1]]){
    const f=fixture(page);f.swipe(dir);f.advance(1000);assert.equal(spread(f),page);assert.equal(f.rendered.length,0);
  }
});
test('multiple next-button requests remain queued but gestures during a flip do not accidentally chain pages',()=>{
  const f=fixture(20);f.swipe();f.swipe();f.click('next');f.advance(2000);assert.equal(spread(f),24);assert.equal(f.rendered.length,2);
});
test('choosing an edge chapter navigates while the book stays open', () => {
  const f = fixture(20), target = f.context.BIBLE_DATA.books[65].first & ~1;
  f.goBook(65); f.advance(4000); assert.equal(spread(f), target); assertReading(f);
  assert.ok(f.edgeCalls.length);
});
for (const code of ['PHM', '2JN']) test(`${code} even-page edge keeps its own title, saved face and precise anchor after reload`, () => {
  const data = currentRuleData(), index = data.books.findIndex(book => book.code === code), selected = data.books[index], page = selected.first;
  assert.equal(page % 2, 0, 'regression requires the selected book to open on the left');
  assert.notEqual(data.pages[page + 1].b, index, 'right page belongs to the following short book');
  for (const width of [980, 390]) {
    const options = { data, width, height: 844, realEdgeGeometry: true, customStorage: true };
    const f = fixture(20, options); f.goBook(index);
    function assertSelected(reader) {
      assert.equal(spread(reader), page); assert.equal(reader.el('book-name').textContent, selected.name);
      assert.equal(reader.el('stage').dataset.book, selected.code);
      const saved = JSON.parse(reader.storage.get('paper-bible-position-v1'));
      assert.equal(saved.page, page); assert.equal(saved.spread, page); assert.equal(saved.bookName, selected.name); assert.equal(saved.ref, data.pages[page].start);
      if (width === 390) assert.equal(saved.focus, 'left', 'phone camera follows the selected left page');
      assertReading(reader);
    }
    assertSelected(f);
    const reloaded = fixture(0, { ...options, storage: Object.fromEntries(f.storage) });
    assertSelected(reloaded);
  }
});
test('explicit reference page overrides saved face as well as saved spread', () => {
  const data = currentRuleData(), phm = data.books.find(book => book.code === 'PHM').first;
  for (const page of [phm, phm + 1]) {
    const f = fixture(phm, { data, width: 390, height: 844, realEdgeGeometry: true,
      pose: { page: page ^ 1 }, initialSpread: page & ~1, initialPage: page });
    const expected = data.books[data.pages[page].b], saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
    assert.equal(f.el('book-name').textContent, expected.name); assert.equal(saved.page, page);
    assert.equal(saved.focus, page % 2 ? 'right' : 'left');
  }
});
test('left-page reading-history return preserves the exact short-book anchor', () => {
  const data = currentRuleData(), selected = data.books.find(book => book.code === 'PHM');
  const f = fixture(20, { data });
  f.navigateHistory(selected.first,'r1',{bookCode:selected.code,ref:'1:1'});
  assert.equal(f.el('book-name').textContent, selected.name); assert.equal(f.position.page, selected.first);
  assert.equal(f.position.ref,'1:1');
});
test('explicit left/right focus changes the displayed book and persisted face together', () => {
  const data = currentRuleData(), page = data.books.find(book => book.code === 'PHM').first, f = fixture(page, { data });
  for (const [side, index] of [['left', page], ['right', page + 1]]) {
    f.click('focus-' + side);
    assert.equal(f.el('book-name').textContent, data.books[data.pages[index].b].name);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, index);
  }
});
test('directory dialog interrupts active swipe without closing the physical book', () => {
  const f = fixture(20);f.swipe(); f.event('paper-directory-request'); f.advance(1500);
  assert.equal(spread(f), 20); assertReading(f); assert.equal(f.el('book-picker').open, true);
});
test('chapter picker opens all 66 books and selects a real chapter without scene changes', () => {
  const f = fixture(20); f.click('location-button');
  const books = f.el('book-picker-books'); assert.equal(books.children.length, 66);
  books.children[65].dispatchEvent({ type: 'click' });
  const chapters = f.context.BIBLE_DATA.books[65].chapters, buttons = f.el('book-picker-chapters').children;
  assert.equal(buttons.length, chapters.length + 1);
  buttons[2].dispatchEvent({ type: 'click' });
  assert.equal(spread(f), chapters[1].page & ~1); assert.equal(f.el('book-picker').open, false); assertReading(f);
});
test('tool targets are excluded from stage tap/hold recognition', () => {
  const f = fixture(), p = f.at(), button = f.context.document.createElement('button');
  f.emit('pointerdown', p.x, p.y, 1, 'mouse', button); f.advance(300); f.emit('pointerup', p.x, p.y, 1, 'mouse', button); f.advance(1200);
  assert.equal(f.rendered.length, 0); assert.equal(spread(f), 2);
});
test('settled zoom retains real SVG text and unchanged scripture glyph coordinates', () => {
  const f = fixture(20), original = ['left-paper', 'right-paper'].map(id => f.el(id).innerHTML);
  original.forEach(svg => { assert.match(svg, /^<svg/); assert.match(svg, /<text /); assert.doesNotMatch(svg, /<image|<canvas|paper-cut-/); });
  f.click('zoom-in'); f.advance(200);
  assert.deepEqual(['left-paper', 'right-paper'].map(id => f.el(id).innerHTML), original);
  assert.match(f.el('book').style.transform, /^translate\(/, 'settled paper must not force old 3D raster compositor'); assertReading(f);
});
test('390x844 phone starts at readable scale with all right edges inside viewport', () => {
  const data = currentRuleData();
  for (const start of [20, data.books[65].first - 2]) {
    const f = fixture(start, { width: 390, height: 844, data, realEdgeGeometry: true });
    function assertPhoneRight() {
      const { x, y, scale } = f.el('stage').dataset, sx = Number(x), sy = Number(y), z = Number(scale);
      assert.ok(z >= 1, 'phone text is never initially shrunk below native 1x');
      const right = f.edgeItems.filter(item => item.side === 'right');
      assert.ok(right.length > 0, 'fixture includes remaining right-side edges');
      for (const item of right) {
        const left = sx + item.x * z, top = sy + item.y * z;
        const label = item.label || data.books[item.index]?.name || 'edge group';
        assert.ok(left >= -.02 && left + item.width * z <= 390.02, `${label} must fit horizontally`);
        assert.ok(top >= -.02 && top + item.height * z <= 844.02, `${label} must fit vertically`);
      }
    }
    assertPhoneRight();
    f.click('focus-left'); f.click('focus-right'); assertPhoneRight();
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).focus, 'right');
  }
});
test('page turns use the injected storage and preserve unrelated local reading preferences', () => {
  const f = fixture(20, { customStorage: true,storage:{'user-preference':'preserve me'} }); f.swipe(); f.advance(1500);
  assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).spread, 22);
  assert.equal(f.storage.get('user-preference'),'preserve me');
});
test('saved custom reading zoom and center survive initial load', () => {
  const f = fixture(20, { pose: { zoom: 2, centerX: 600, centerY: 340, focus: 'custom' } });
  const saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
  assert.equal(saved.spread, 20); assert.equal(saved.focus, 'custom');
  assert.ok(Math.abs(saved.zoom - 2) < 1e-8); assert.ok(Math.abs(saved.centerX - 600) < 1e-8); assert.ok(Math.abs(saved.centerY - 340) < 1e-8);
});
test('explicit initial page overrides stored position and is normalized to a spread', () => {
  const f = fixture(20, { initialSpread: 101 });
  assert.equal(spread(f), 100); assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).spread, 100);
});
test('reading-history navigation restores its spread without opening an index or a page packet', () => {
  const f = fixture(20); f.navigateHistory(34,'r4',{bookCode:'GEN',ref:'40:1'}); f.advance(4000);
  assert.equal(spread(f),34);assert.equal(f.position.page,34);assert.equal(f.jumpCalls.length,0);assertReading(f);
});
test('current rules edition retains exact scripture SVG and last-book navigation', () => {
  const data = currentRuleData();
  const f = fixture(20, { data, customStorage: true });
  assert.equal(f.el('left-paper').innerHTML, Page.svg(data.pages[20], 20, data.books));
  assert.equal(f.el('right-paper').innerHTML, Page.svg(data.pages[21], 21, data.books));
  f.goBook(65); f.advance(4000);
  const target = data.books[65].first & ~1;
  assert.equal(spread(f), target); assertReading(f);
  assert.equal(f.el('right-paper').innerHTML, Page.svg(data.pages[target + 1], target + 1, data.books));
  assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).edition, data.edition);
});

function camera(f) { return ['x', 'y', 'scale'].map(key => Number(f.el('stage').dataset[key])); }
function assertCameraEqual(actual, expected) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= .02, `camera component ${index} must restore: ${value} vs ${expected[index]}`));
}
test('expanded edge restores exact custom camera and never persists its temporary view', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true, pose: { zoom: 2, centerX: 600, centerY: 340, focus: 'custom' } });
  const original = camera(f), saved = f.storage.get('paper-bible-position-v1');
  f.expand('right'); assert.equal(f.expandedSide, 'right');
  assert.notDeepEqual(camera(f), original, 'expanded edge uses its own readable camera');
  assert.equal(f.storage.get('paper-bible-position-v1'), saved, 'temporary index camera must not overwrite reading position');
  f.expand('left'); assert.equal(f.expandedSide, 'left');
  f.expand(null); assert.equal(f.expandedSide, null); assertCameraEqual(camera(f), original);
  assert.equal(f.storage.get('paper-bible-position-v1'), saved); assertReading(f);
});
for(const side of ['left','right'])test('zoomed '+side+' index pans to all four bounds, returns from its chooser, and never turns a page',()=>{
  const f=fixture(600,{width:390,height:844,data:currentRuleData(),realIndexDom:true,realChaptersDom:true}),stage=f.el('stage');
  const original=camera(f),saved=f.storage.get('paper-bible-position-v1');f.expand(side);
  const band=f.indexElement.querySelectorAll('.edge-index__band').find(b=>b.dataset.side===side),box=f.edgeLayout.bands[side];
  function rect(){const [x,y,s]=camera(f);return {left:x+box.x*s,top:y,right:x+(box.x+box.width)*s,bottom:y+704*s};}
  const center=()=>{const r=rect();return {x:(Math.max(0,r.left)+Math.min(390,r.right))/2,y:(Math.max(0,r.top)+Math.min(844,r.bottom))/2};};
  wheelAt(f,center(),0,-600,{ctrlKey:true,target:band});assert.ok(rect().bottom-rect().top>1800);
  for(const sign of [1,-1]){
    wheelAt(f,center(),sign*1e5,sign*1e5,{target:band});const r=rect();
    if(sign>0){assert.ok(Math.abs(r.right-372)<.15);assert.ok(Math.abs(r.bottom-826)<.15);}
    else{assert.ok(Math.abs(r.left-18)<.15);assert.ok(Math.abs(r.top-18)<.15);}
    assert.ok(r.right>=372&&r.left<=18.1,'horizontal pan always leaves the broad open index in view');
  }
  const nativeClick=()=>{const e={type:'click',target:band,detail:1};stage.dispatchEvent(e);if(!e.defaultPrevented)band.dispatchEvent({type:'click'});};
  for(const type of ['mouse','touch']){
    const before=camera(f),p=center();
    f.emit('pointerdown',p.x,p.y,1,type,band);f.emit('pointermove',p.x-20,p.y-70,1,type,band);
    f.emit('pointerup',p.x-20,p.y-70,1,type,band);nativeClick();
    assert.ok(Math.abs(camera(f)[0]-before[0]+20)<.1);assert.ok(Math.abs(camera(f)[1]-before[1]+70)<.1);
    assert.equal(f.expandedSide,side);assert.equal(f.rendered.length,0);assert.equal(spread(f),600);
  }
  const pose=camera(f),button=f.indexElement.querySelectorAll('.edge-index__book').find(b=>!b.hidden);
  button.dispatchEvent({type:'click'});assert.equal(f.chaptersOpen,true);
  f.chapterOptions.onZoom(.8);f.chapterElement.querySelector('.edge-chapters__close').dispatchEvent({type:'click'});
  assert.equal(f.expandedSide,side);assertCameraEqual(camera(f),pose);
  const p=center();f.emit('pointerdown',p.x,p.y,1,'touch',band);f.emit('pointerup',p.x,p.y,1,'touch',band);nativeClick();
  assert.equal(f.expandedSide,null);assertCameraEqual(camera(f),original);assert.equal(f.storage.get('paper-bible-position-v1'),saved);
  assert.equal(f.jumpCalls.length,0);
});
test('expanded edge consumes page tap, hold, pointercancel and keyboard arrows without page turns', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }); f.expand('right');
  const p = f.at(); f.emit('pointerdown', p.x, p.y); f.advance(1); f.emit('pointerup', p.x, p.y); f.advance(500);
  // Opening a side selector is not a hidden request to flip the obscured paper.
  assert.equal(spread(f), 600); assert.equal(f.rendered.length, 0);
  f.expand('right'); f.emit('pointerdown', p.x, p.y); f.advance(400); f.emit('pointercancel', p.x, p.y); f.advance(500);
  assert.equal(spread(f), 600); assert.equal(f.rendered.length, 0);
  f.expand('right');
  for (const key of ['ArrowLeft', 'ArrowRight']) f.el('stage').dispatchEvent({ type: 'keydown', key });
  f.advance(1500); assert.equal(spread(f), 600); assert.equal(f.rendered.length, 0);
});
test('Escape collapses an expanded edge and restores the reader camera', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }), original = camera(f);
  f.expand('left'); f.el('stage').dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(f.expandedSide, null); assertCameraEqual(camera(f), original); assert.equal(spread(f), 600);
});
test('turning paper disables edge expansion until the sheet has settled', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }), original = f.el('right-paper').innerHTML;
  f.swipe(); f.expand('right'); assert.equal(f.expandedSide, null); assert.equal(state(f), 'settling-forward');
  f.event('blur'); f.advance(1500);
  assert.equal(spread(f), 600); assert.equal(state(f), 'returned'); assert.equal(f.el('right-paper').innerHTML, original);
  f.expand('right');
  assert.equal(f.expandedSide, 'right'); assertReading(f);
});
test('every one of 66 books remains individually reachable in expanded edges with exact page anchors', () => {
  const data = currentRuleData(), f = fixture(600, { data, realEdgeGeometry: true });
  for (let index = 0; index < data.books.length; index++) {
    const selected = data.books[index], side = EdgeIndex.carrierSheet(selected) <= Math.floor(spread(f) / 2) ? 'left' : 'right';
    f.expand(side);
    assert.ok(f.edgeLayout.expandedBooks.some(item => item.index === index && item.side === side), selected.name + ' is individually accessible on its own carrier side');
    const before = spread(f); f.selectBook(index);
    assert.equal(f.chaptersOpen, true); assert.equal(spread(f), before, 'book label opens chapters before navigation');
    f.chooseChapter(selected.first);
    assert.equal(f.expandedSide, null); assert.equal(spread(f), selected.first & ~1);
    assert.equal(f.el('book-name').textContent, selected.name); assert.equal(f.position.page, selected.first);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, selected.first); assertReading(f);
  }
});
test('390x844 expanded edge shows every selected-side label inside the viewport', () => {
  const data = currentRuleData(), f = fixture(600, { data, width: 390, height: 844, realEdgeGeometry: true });
  for (const side of ['left', 'right']) {
    f.expand(side); const [x, y, scale] = camera(f);
    const visible = f.edgeLayout.expandedBooks.filter(item => item.side === side); assert.ok(visible.length);
    for (const item of visible) {
      const left = x + item.x * scale, top = y + item.y * scale;
      assert.ok(left >= -.02 && left + item.width * scale <= 390.02, data.books[item.index].name + ' expanded horizontal bounds');
      assert.ok(top >= -.02 && top + item.height * scale <= 844.02, data.books[item.index].name + ' expanded vertical bounds');
    }
  }
});
for (const [control, factor] of [['zoom-in', 1.3], ['zoom-out', 1 / 1.3]]) test(`${control} closes the edge and applies its factor to the reading zoom`, () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true, pose: { zoom: 2, centerX: 600, centerY: 340, focus: 'custom' } });
  f.expand('right'); f.click(control);
  const saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
  assert.equal(f.expandedSide, null); assert.ok(Math.abs(saved.zoom - 2 * factor) < 1e-8);
  assert.equal(spread(f), 600); assertReading(f);
});
test('paper-interrupt closes the edge, restores camera and leaves no stuck input mode', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }), original = camera(f);
  f.expand('right'); f.event('paper-interrupt');
  assert.equal(f.expandedSide, null); assertCameraEqual(camera(f), original);
  f.swipe(); f.advance(1500); assert.equal(spread(f), 602);
});
test('obsolete held-peek demo no longer installs a handler', () => {
  const f=fixture(600);assert.equal(f.el('demo-peek').onclick,undefined);
});
test('real edge and chapter DOM choose all 66 books then commit packets and resume page turns', () => {
  const data = currentRuleData(), f = fixture(600, { data, realIndexDom: true, realChaptersDom: true, manualJump: true, width: 390, height: 844 });
  for (let index = 0; index < data.books.length; index++) {
    const selected = data.books[index], side = EdgeIndex.carrierSheet(selected) <= Math.floor(spread(f) / 2) ? 'left' : 'right';
    const band = f.indexElement.querySelectorAll('.edge-index__band').find(button => button.dataset.side === side);
    assert.ok(!band.disabled); band.dispatchEvent({ type: 'click' }); assert.equal(f.expandedSide, side);
    const button = f.indexElement.querySelector(`[data-book="${index}"]`);
    assert.ok(!button.hidden && !button.disabled, selected.name + ' actual button is accessible');
    const before = spread(f); f.selectBook(index);
    assert.equal(f.chaptersOpen, true); assert.equal(spread(f), before); assert.equal(f.expandedSide, side);
    assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, selected.chapters.length);
    f.chooseChapter(selected.chapters[0].page);
    if ((selected.first & ~1) !== before) { assert.equal(f.jumpActive, true); assert.equal(spread(f), before); f.finishJump(); }
    assert.equal(f.expandedSide, null); assert.equal(f.el('book-name').textContent, selected.name);
    assert.equal(f.position.page, selected.first);
  }
  f.swipe(); f.advance(1500); assert.equal(spread(f), (data.books[65].first & ~1) + 2);
});
test('book index click opens anchored chapter selector without changing the page or closing the edge', () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true }), anchor = { left: 300, top: 250, right: 344, bottom: 276, width: 44, height: 26 };
  const stored = f.storage.get('paper-bible-position-v1'); f.expand('right');
  f.selectBook(55, { bookIndices: [55, 56], anchor });
  assert.equal(f.expandedSide, 'right'); assert.equal(f.chaptersOpen, true);
  assert.deepEqual(Array.from(f.chapterState.bookIndices), [55, 56]); assert.equal(f.chapterState.index, 55);
  assert.deepEqual(f.chapterState.anchor, anchor); assert.equal(spread(f), 20); assert.equal(f.jumpCalls.length, 0);
  assert.equal(f.storage.get('paper-bible-position-v1'), stored);
  const current = f.chapterOptions.getCurrent();
  assert.equal(data.books[current.bookIndex].code, f.el('stage').dataset.book); assert.ok(current.chapter >= 1);
});
test('chapter selector consumes tap, hold and arrows; Escape dismisses without navigation', () => {
  const f = fixture(20, { data: currentRuleData(), manualJump: true }), stored = f.storage.get('paper-bible-position-v1');
  f.selectBook(65); f.tap(); const p = f.hold(); f.drag(p, .8, 'pointerup');
  f.el('stage').dispatchEvent({ type: 'keydown', key: 'ArrowRight' }); f.advance(1500);
  assert.equal(f.rendered.length, 0); assert.equal(f.jumpCalls.length, 0); assert.equal(spread(f), 20);
  f.el('stage').dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(f.chaptersOpen, false); assert.equal(f.storage.get('paper-bible-position-v1'), stored);
});
test('far chapter jump keeps source metadata and storage until packet completion then commits exact face', () => {
  const data = currentRuleData(), selected = data.books.find(book => book.code === 'PHM'), index = data.books.indexOf(selected);
  const f = fixture(20, { data, width: 390, height: 844, manualJump: true }), stored = f.storage.get('paper-bible-position-v1');
  f.expand('right'); f.selectBook(index); f.chooseChapter(selected.first);
  assert.equal(f.expandedSide, null); assert.equal(f.chaptersOpen, false); assert.equal(f.jumpActive, true);
  assert.equal(f.jumpCalls.length, 1); assert.equal(f.jumpCalls[0].from, 20); assert.equal(f.jumpCalls[0].to, selected.first);
  assert.equal(spread(f), 20); assert.equal(f.storage.get('paper-bible-position-v1'), stored);
  assert.notEqual(f.position.page, selected.first); f.advance(10000);
  assert.equal(spread(f), 20, 'time alone cannot commit an unfinished packet');
  f.finishJump(); const saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
  assert.equal(f.jumpActive, false); assert.equal(spread(f), selected.first); assert.equal(saved.page, selected.first);
  assert.equal(saved.focus, 'left'); assert.equal(saved.bookName, selected.name); assert.equal(f.position.page, selected.first);
  assert.equal(f.el('left-paper').innerHTML, Page.svg(data.pages[selected.first], selected.first, data.books));
  assert.equal(f.el('stage').dataset.jumpState, 'committed');
});
test('backward packet commits the odd target page rather than losing its right-face anchor', () => {
  const data = currentRuleData(), f = fixture(1200, { data, width: 390, height: 844, manualJump: true }), target = data.books[0].first;
  assert.equal(target % 2, 1); f.navigateDirectory(target); assert.equal(spread(f), 1200);
  assert.equal(f.jumpCalls[0].from, 1200); assert.equal(f.jumpCalls[0].to, target & ~1);
  f.finishJump(); const saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
  assert.equal(saved.page, target); assert.equal(saved.focus, 'right'); assert.equal(f.el('book-name').textContent, data.books[0].name);
});
test('cancelled jump restores source SVG and cannot save target even if its old finish callback arrives', () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true });
  const stored = f.storage.get('paper-bible-position-v1'), original = ['left-paper', 'right-paper'].map(id => f.el(id).innerHTML);
  f.navigateDirectory(data.books[65].first); f.cancelJump(); f.invokeJumpFinish(0);
  assert.equal(spread(f), 20); assert.equal(f.jumpActive, false); assert.equal(f.el('stage').dataset.jumpState, 'cancelled');
  assert.equal(f.storage.get('paper-bible-position-v1'), stored);
  assert.deepEqual(['left-paper', 'right-paper'].map(id => f.el(id).innerHTML), original);
  f.swipe(); f.advance(1500); assert.equal(spread(f), 22);
});
test('new jump replaces the previous packet and ignores its stale finish and cancel callbacks', () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true }), first = data.books[65].first, second = data.books[23].first;
  const stored = f.storage.get('paper-bible-position-v1');
  f.navigateDirectory(first); f.navigateDirectory(second);
  assert.equal(f.jumpCalls.length, 2); assert.equal(f.jumpCalls[0].cancelled, true); assert.equal(f.jumpCalls[1].from, 20);
  f.invokeJumpFinish(0); f.invokeJumpCancel(0);
  assert.equal(spread(f), 20); assert.equal(f.jumpActive, true); assert.equal(f.storage.get('paper-bible-position-v1'), stored);
  f.finishJump(); assert.equal(spread(f), second & ~1); assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, second);
  f.invokeJumpFinish(0); assert.equal(spread(f), second & ~1);
});
test('pending packet excludes taps, held curls, arrows and queued ordinary page turns', () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true }), target = data.books[65].first;
  f.navigateDirectory(target); f.tap(); const p = f.hold(); f.drag(p, .8, 'pointerup');
  f.el('stage').dispatchEvent({ type: 'keydown', key: 'ArrowRight' }); f.click('next'); f.advance(1500);
  assert.equal(spread(f), 20); assert.equal(f.rendered.length, 0); assert.equal(f.jumpCalls.length, 1);
  f.finishJump(); f.advance(1500); assert.equal(spread(f), target & ~1); assert.equal(f.rendered.length, 0);
});
test('starting packet navigation interrupts an ordinary flip before committing the destination', () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true }), target = data.books[65].first;
  f.swipe(); f.navigateDirectory(target); f.advance(1500);
  assert.equal(state(f), 'returned'); assert.equal(f.jumpActive, true); assert.equal(spread(f), 20); assert.equal(f.rendered.length, 1);
  f.finishJump(); assert.equal(spread(f), target & ~1); assert.equal(f.rendered.length, 1);
});
for (const reason of ['blur', 'Escape', 'resize']) test(`${reason} cancels pending packet without persisting destination`, () => {
  const data = currentRuleData(), f = fixture(20, { data, manualJump: true }), stored = f.storage.get('paper-bible-position-v1');
  f.navigateDirectory(data.books[65].first);
  if (reason === 'Escape') f.el('stage').dispatchEvent({ type: 'keydown', key: 'Escape' });
  else if (reason === 'resize') f.resize(); else f.event(reason);
  assert.equal(f.jumpActive, false); assert.equal(spread(f), 20); assert.equal(f.storage.get('paper-bible-position-v1'), stored);
  f.invokeJumpFinish(0); assert.equal(spread(f), 20);
});
test('same-spread chapter selection updates exact face without manufacturing a packet', () => {
  const data = currentRuleData(), left = data.books.find(book => book.code === 'PHM').first, f = fixture(left, { data, manualJump: true });
  f.navigateHistory(left,'r1'); assert.equal(f.jumpCalls.length, 0); assert.equal(f.position.page, left);
  f.navigateHistory(left+1,'r4'); assert.equal(f.jumpCalls.length, 0); assert.equal(f.position.page, left + 1);
  assert.equal(f.el('book-name').textContent, data.books[data.pages[left + 1].b].name);
});
test('normal grouped edge opens all member books and lets a later member choose its chapter', () => {
  const data = currentRuleData();
  for (const code of ['PHM', '2JN']) {
    const index = data.books.findIndex(book => book.code === code), selected = data.books[index];
    const f = fixture(20, { data, realIndexDom: true, realChaptersDom: true, manualJump: true });
    const group = f.indexElement.querySelectorAll('.edge-index__group').find(button => !button.hidden && button.dataset.members?.split(',').includes(String(index)));
    assert.ok(group); group.dispatchEvent({ type: 'click' }); assert.equal(f.chaptersOpen, true); assert.equal(f.jumpCalls.length, 0);
    const memberButtons = f.chapterElement.querySelectorAll('.edge-chapters__book');
    assert.equal(memberButtons.length, group.dataset.members.split(',').length);
    memberButtons.find(button => Number(button.dataset.book) === index).dispatchEvent({ type: 'click' });
    assert.equal(f.chapterElement.dataset.book, String(index));
    f.chooseChapter(selected.chapters[0].page); assert.equal(spread(f), 20); f.finishJump();
    assert.equal(f.el('book-name').textContent, selected.name); assert.equal(f.position.page, selected.chapters[0].page);
  }
});
test('actual chapter 150 button requests its real page instead of the first page of Psalms', () => {
  const data = currentRuleData(), index = data.books.findIndex(book => book.code === 'PSA'), selected = data.books[index];
  const f = fixture(20, { data, realChaptersDom: true, manualJump: true }); f.selectBook(index);
  const button = f.chapterElement.querySelectorAll('.edge-chapters__chapter').find(node => node.dataset.chapter === '150');
  assert.ok(button); button.dispatchEvent({ type: 'click' });
  const target = selected.chapters.find(chapter => chapter.chapter === 150).page;
  assert.notEqual(target, selected.first); assert.equal(f.jumpCalls[0].to, target & ~1); assert.equal(spread(f), 20);
  f.finishJump(); assert.equal(f.position.page, target);
  assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, target);
});
test('real chapter Escape closes only the popover before a second Escape closes the expanded edge', () => {
  const data = currentRuleData(), f = fixture(20, { data, realIndexDom: true, realChaptersDom: true, manualJump: true });
  f.expand('right'); f.selectBook(65); assert.equal(f.chaptersOpen, true);
  f.event('keydown', { key: 'Escape', target: f.context.document.activeElement });
  assert.equal(f.chaptersOpen, false); assert.equal(f.expandedSide, 'right'); assert.equal(f.jumpCalls.length, 0);
  f.event('document:keydown', { key: 'Escape', target: f.context.document.activeElement });
  assert.equal(f.expandedSide, null); assert.equal(spread(f), 20);
});
function clickChapterMode(f, mode) {
  const label = mode === 'preview' ? '经文摘读' : '章号格子';
  const button = f.chapterElement.querySelectorAll('.edge-chapters__mode').find(node => node.getAttribute('aria-label') === label);
  assert.ok(button, label + ' mode button is exposed by its accessible name');
  button.dispatchEvent({ type: 'click' }); assert.equal(f.chapterMode, mode);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
}
test('zooming with the menu open scales the book around the same viewport contact and leaves the chooser open',()=>{
  const f=fixture(20,{realChaptersDom:true}),x=510,y=290;
  f.selectBook(0,{bookIndices:[0],anchor:{left:x-24,right:x,top:y,bottom:y+20,width:24,height:20}});
  function screenDock(){return [Number(f.chapterElement.dataset.anchorX),Number(f.chapterElement.dataset.anchorY)];}
  const original=screenDock(),scale0=Number(f.el('stage').dataset.scale);
  f.chapterOptions.onZoom(1.3);assert.equal(f.chaptersOpen,true);assertCameraEqual(screenDock(),original);
  assert.ok(Math.abs(Number(f.el('stage').dataset.scale)/scale0-1.3)<.001);
  f.click('zoom-out');assert.equal(f.chaptersOpen,true);assertCameraEqual(screenDock(),original);
  f.resize();assert.equal(f.chaptersOpen,true);assertCameraEqual(screenDock(),original);
});
function assertPreviewButton(f, book, entry, source = currentBibleSource()) {
  const button = f.chapterElement.querySelectorAll('.edge-chapters__chapter').find(node => Number(node.dataset.chapter) === entry.chapter);
  assert.ok(button && !button.hidden && !button.disabled, `${book.name} ${entry.chapter} stays reachable`);
  assert.equal(Number(button.dataset.page), entry.page); assert.equal(button.getAttribute('aria-label'), `${book.name} 第 ${entry.chapter} 章`);
  const expected = require('./chapter-preview.js').create(source)(book.code, entry.chapter);
  assert.ok(expected, 'real source excerpt exists');
  assert.equal(button.querySelector('.edge-chapters__preview').textContent, expected.text);
  assert.equal(button.querySelector('.edge-chapters__reference').textContent, expected.reference);
  assert.equal(button.dataset.preview, 'available');
  const raw = source.books.find(item => item.code === book.code).chapters.find(chapter => chapter.chapter === entry.chapter).verses.slice(0, 2).map(verse => verse[1]).join('');
  const clean = value => value.replace(/\s/gu, '').replace(/…$/, '');
  assert.ok(clean(raw).startsWith(clean(expected.text)), 'excerpt is a prefix of this exact source chapter, not neighboring-book text');
  return button;
}
test('chapter modes default to numbers, switch without navigation or persistence, and remain selected in this session', () => {
  const data = currentRuleData(), f = fixture(20, { data, realChaptersDom: true, manualJump: true });
  const stored = Object.fromEntries(f.storage), writes = f.saved.length; f.selectBook(0);
  assert.equal(f.chapterMode, 'numbers'); assert.equal(f.chapterElement.dataset.mode, 'numbers');
  assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, 50);
  clickChapterMode(f, 'preview'); assert.equal(f.chapterElement.dataset.mode, 'preview');
  assert.equal(spread(f), 20); assert.equal(f.jumpCalls.length, 0); assert.deepEqual(Object.fromEntries(f.storage), stored); assert.equal(f.saved.length, writes);
  f.chapterElement.querySelector('.edge-chapters__close').dispatchEvent({ type: 'click' }); assert.equal(f.chaptersOpen, false);
  f.selectBook(42); assert.equal(f.chapterMode, 'preview');
  clickChapterMode(f, 'numbers');
  f.chapterElement.querySelector('.edge-chapters__close').dispatchEvent({ type: 'click' }); f.selectBook(18);
  assert.equal(f.chapterMode, 'numbers'); assert.equal(f.jumpCalls.length, 0); assert.deepEqual(Object.fromEntries(f.storage), stored);
  const fresh = fixture(20, { data, realChaptersDom: true, manualJump: true }); fresh.selectBook(0); assert.equal(fresh.chapterMode, 'numbers', 'another reader session does not inherit a stored mode');
});
test('real preview helper receives canonical book codes even when source book order differs', () => {
  const data = currentRuleData(), source = { ...currentBibleSource(), books: [...currentBibleSource().books].reverse() };
  const f = fixture(20, { data, source, realChaptersDom: true, manualJump: true });
  for (const code of ['GEN', 'JHN', 'PHM', '2JN', 'PSA']) {
    const index = data.books.findIndex(book => book.code === code), book = data.books[index];
    const callStart = f.previewCalls.length; f.selectBook(index); clickChapterMode(f, 'preview');
    assertPreviewButton(f, book, book.chapters[0], source);
    assert.ok(f.previewCalls.slice(callStart).some(call => call.code === code && Number(call.chapter) === 1));
  }
  assert.equal(f.previewSources.length, 1); assert.equal(f.previewSources[0], source);
  assert.equal(f.jumpCalls.length, 0); assert.equal(spread(f), 20);
});
test('single-chapter short books keep one real preview and commit the exact even-page target', () => {
  const data = currentRuleData();
  for (const code of ['PHM', '2JN']) {
    const index = data.books.findIndex(book => book.code === code), book = data.books[index];
    const f = fixture(20, { data, realChaptersDom: true, manualJump: true, width: 390, height: 844 });
    f.selectBook(index); assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, 1);
    const original = f.storage.get('paper-bible-position-v1'); clickChapterMode(f, 'preview');
    const button = assertPreviewButton(f, book, book.chapters[0]); button.dispatchEvent({ type: 'click' });
    assert.equal(f.chaptersOpen, false); assert.equal(spread(f), 20); assert.equal(f.storage.get('paper-bible-position-v1'), original);
    f.finishJump(); assert.equal(f.el('book-name').textContent, book.name); assert.equal(f.position.page, book.chapters[0].page);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, book.chapters[0].page);
  }
});
test('all 150 Psalm preview chapters remain reachable and navigate to their real mapped pages', () => {
  const data = currentRuleData(), index = data.books.findIndex(book => book.code === 'PSA'), book = data.books[index];
  const f = fixture(20, { data, realChaptersDom: true, manualJump: true, width: 390, height: 844 });
  f.selectBook(index); clickChapterMode(f, 'preview');
  assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, 150);
  for (const entry of book.chapters) {
    if (!f.chaptersOpen) f.selectBook(index);
    assert.equal(f.chapterMode, 'preview');
    const button = assertPreviewButton(f, book, entry), before = spread(f); button.dispatchEvent({ type: 'click' });
    if ((entry.page & ~1) !== before) { assert.equal(spread(f), before); assert.equal(f.jumpActive, true); f.finishJump(); }
    assert.equal(f.position.page, entry.page);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, entry.page);
  }
  assert.equal(f.chaptersOpen, false);
});
test('real grouped-index metadata fixes all four menu corners through mode and book changes with zero gap', () => {
  const data = currentRuleData();
  for (const [width, height] of [[980, 720], [390, 844]]) for (const horizontal of ['left', 'right']) for (const vertical of ['top', 'bottom']) {
    const f = fixture(20, { data, realIndexDom: true, realChaptersDom: true, manualJump: true, width, height, measureChapterPanel: true });
    const labelLeft = horizontal === 'left' ? 30 : width - 54, labelTop = vertical === 'top' ? 52 : height - 78;
    const anchor = { left: labelLeft, top: labelTop, right: labelLeft + 24, bottom: labelTop + 26, width: 24, height: 26 };
    const expected = { corner: `${vertical}-${horizontal}`, x: horizontal === 'left' ? anchor.right : anchor.left, y: vertical === 'top' ? anchor.top : anchor.bottom };
    const group = f.indexElement.querySelectorAll('.edge-index__group').find(button => !button.hidden && button.dataset.members === '61,62,63,64');
    assert.ok(group, 'the printed compact John-epistles/Jude cut exists');
    group.getBoundingClientRect = () => ({ ...anchor });
    const stored = Object.fromEntries(f.storage), writes = f.saved.length;
    group.dispatchEvent({ type: 'click' });
    assert.equal(f.chaptersOpen, true); assert.equal(f.chapterElement.dataset.book, '61');
    const panel = f.chapterElement.querySelector('.edge-chapters__panel');
    function assertDock() {
      for (const node of [f.chapterElement, panel]) {
        assert.equal(node.dataset.dockCorner, expected.corner); assert.equal(Number(node.dataset.anchorX), expected.x); assert.equal(Number(node.dataset.anchorY), expected.y);
      }
      const rect = panel.getBoundingClientRect(), contactX = horizontal === 'left' ? rect.left : rect.right, contactY = vertical === 'top' ? rect.top : rect.bottom;
      assert.ok(Math.abs(contactX - expected.x) < 1e-7, 'menu horizontal contact stays exactly on the label, without a gap');
      assert.ok(Math.abs(contactY - expected.y) < 1e-7, 'menu vertical contact stays exactly on the label, without a gap');
      assert.equal(f.jumpCalls.length, 0); assert.equal(spread(f), 20);
      assert.deepEqual(Object.fromEntries(f.storage), stored); assert.equal(f.saved.length, writes);
      return rect;
    }
    const numbers = assertDock(); clickChapterMode(f, 'preview'); const preview = assertDock();
    assert.ok(numbers.width !== preview.width || numbers.height !== preview.height, 'mode switch genuinely changes the measured menu size');
    f.chapterElement.querySelectorAll('.edge-chapters__book').find(button => button.dataset.book === '62').dispatchEvent({ type: 'click' });
    assert.equal(f.chapterElement.dataset.book, '62'); assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, 1); assertDock();
    clickChapterMode(f, 'numbers'); assertDock();
    f.chapterElement.querySelectorAll('.edge-chapters__book').find(button => button.dataset.book === '61').dispatchEvent({ type: 'click' });
    assert.equal(f.chapterElement.querySelectorAll('.edge-chapters__chapter').length, 5); assertDock();
    f.event('keydown', { key: 'Escape', target: f.context.document.activeElement }); assert.equal(f.chaptersOpen, false);
    assert.deepEqual(Object.fromEntries(f.storage), stored);
  }
});
test('fixed-corner menu mode changes still block page gestures and cancel without changing reading state', () => {
  const data = currentRuleData(), f = fixture(20, { data, realIndexDom: true, realChaptersDom: true, manualJump: true, width: 390, height: 844, measureChapterPanel: true });
  const group = f.indexElement.querySelectorAll('.edge-index__group').find(button => !button.hidden && button.dataset.members === '55,56');
  assert.ok(group); group.getBoundingClientRect = () => ({ left: 336, top: 700, right: 360, bottom: 726, width: 24, height: 26 });
  const stored = Object.fromEntries(f.storage), original = camera(f); group.dispatchEvent({ type: 'click' });
  clickChapterMode(f, 'preview'); f.tap(); const p = f.hold(); f.drag(p, .8, 'pointercancel');
  f.el('stage').dispatchEvent({ type: 'keydown', key: 'ArrowRight' }); f.click('next'); f.advance(1500);
  assert.equal(f.jumpCalls.length, 0); assert.equal(f.rendered.length, 0); assert.equal(spread(f), 20);
  assert.equal(f.chapterElement.dataset.dockCorner, 'bottom-right');
  f.chapterElement.querySelector('.edge-chapters__outside').dispatchEvent({ type: 'click' });
  assert.equal(f.chaptersOpen, false); assertCameraEqual(camera(f), original); assert.deepEqual(Object.fromEntries(f.storage), stored);
  f.swipe(); f.advance(1500); assert.equal(spread(f), 22, 'reading resumes after dismissing the fixed-corner menu');
});

test('reading trails commit requested references even when a chapter starts below another on the same page',()=>{
  const calls=[]; let navigate;
  const historyModule={create(opts){navigate=opts.onNavigate;return Object.fromEntries(['start','jump','advance'].map(k=>[k,(loc,id)=>calls.push({k,...loc,id})]));}};
  const data=currentRuleData(), f=fixture(20,{data,historyModule,manualJump:true,reducedMotion:true});
  const b=data.books.find(book=>book.code==='ROM'),i=data.books.indexOf(b);
  const entry=b.chapters.find(e=>parseInt(data.pages[e.page].start)!==Number(e.chapter));
  assert.ok(entry); const ref=entry.chapter+':1';
  f.selectBook(i);f.chapterOptions.onSelect(entry.page,{bookCode:b.code,ref});
  assert.deepEqual(calls.map(c=>c.k),['start']);f.cancelJump();
  assert.deepEqual(calls.map(c=>c.k),['start']);
  f.selectBook(i);f.chapterOptions.onSelect(entry.page,{bookCode:b.code,ref});f.finishJump();
  assert.equal(calls.at(-1).ref,ref);assert.equal(calls.at(-1).page,entry.page);assert.equal(calls.at(-1).k,'jump');
  f.click('next');assert.equal(calls.at(-1).k,'advance');assert.notEqual(calls.at(-1).page,entry.page);
  navigate(entry.page,'saved-row',{bookCode:b.code,ref});f.finishJump();
  assert.equal(calls.at(-1).id,'saved-row');assert.equal(calls.at(-1).ref,ref);
});

test('reading-history returns slide by stable slot and restore the exact verse; directory jumps still turn a packet',()=>{
  const dirs=[],data=currentRuleData();let historyGo;
  const deskModule={rank:require('./book-desk.js').rank,create:()=>({start:(d,fn)=>{dirs.push(d);fn();},cancel(){}})};
  const historyModule={create(opts){historyGo=opts.onNavigate;return {start(){},advance(){},jump(loc,id){return {id:id||'r22'};}};}};
  const f=fixture(20,{data,deskModule,historyModule}),gen=data.books.find(b=>b.code==='GEN'),rom=data.books.find(b=>b.code==='ROM');
  const pg=gen.chapters.find(c=>c.chapter===3).page;
  historyGo(rom.first,'r4',{bookCode:'ROM',ref:'1:1'});
  historyGo(pg,'r1',{bookCode:'GEN',ref:'3:1'});
  historyGo(rom.first,'r4',{bookCode:'ROM',ref:'1:1'});assert.deepEqual(dirs,[1,-1,1]);
  f.navigateHistory(pg,'r1',{bookCode:gen.code,ref:'3:1'});
  assert.equal(f.position.page,pg);assert.equal(f.position.ref,'3:1');assert.deepEqual(dirs,[1,-1,1,-1]);
  assert.equal(f.el('stage').dataset.lastGesture,'book-switch');assert.equal(f.jumpCalls.length,0);
  f.navigateDirectory(rom.first);assert.equal(f.jumpCalls.length,1);assert.equal(f.el('stage').dataset.lastGesture,'directory');
});
async function run() {
  for (const { name, fn } of scenarios) { await fn(); console.log('PASS ' + name); }
  console.log(JSON.stringify({ edgeReaderScenarios: scenarios.length }));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, scenarios, run };
