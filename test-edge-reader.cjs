/* Runs the real edge reader controller with deterministic input/timing.
 * Renderer and ribbons are spies; scripture SVG, physics and paper material are real.
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
let ruleData;
function currentRuleData() {
  if (!ruleData) {
    const sourceContext = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data/bible-source.js'), 'utf8'), sourceContext);
    ruleData = require('./paper-layout.js').paginate(sourceContext.window.BIBLE_SOURCE);
  }
  return ruleData;
}

function fixture(startSpread = 2, options = {}) {
  let now = 0, nextId = 1, observer, edgeOptions, ribbonOptions, readerIndex;
  const timers = new Map(), elements = new Map(), events = {}, rendered = [], draws = [];
  const saved = [], edgeCalls = [], ribbonCalls = [], sceneCalls = [];
  const storage = new Map(Object.entries({
    'paper-bible-position-v1': JSON.stringify({ spread: startSpread, ...(options.pose || {}) }),
    'paper-bible-ribbon-v1-0': JSON.stringify({ version: 1, page: 34, spread: 34, bookName: '创世记', ref: '40:1', pose: { zoom: 2, cx: 600, cy: 340, focus: 'custom' } }),
    'paper-bible-ribbon-v1-1': JSON.stringify({ version: 1, page: 1174, spread: 1174, bookName: '提摩太后书', ref: '1:1' }),
    ...(options.storage || {})
  }));
  const initialStorage = new Map(storage);
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
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
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
    constructor() { this.last = null; }
    prepare(front, back, direction, count) { rendered.push({ front, back, direction, count, at: now }); }
    draw(frame) { this.last = frame; draws.push({ ...frame, at: now }); }
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
  const context = {
    console, document: doc, navigator: {}, performance: { now: () => now },
    PaperPhysics: Physics, PaperGestures: Gestures, PaperBookMaterial: Material, PaperPage: Page, PaperEdges: Edges,
    PaperSheetRenderer: Renderer,
    PaperEdgeIndex: { create: (host, args) => { edgeOptions = args || host; readerIndex = options.realIndexDom ? EdgeIndex.create(host, args) : edge; return readerIndex; } },
    PaperRibbons: { create: args => { ribbonOptions = args; return { update: () => ribbonCalls.push({ type: 'update' }), setScene: (...args) => ribbonCalls.push({ type: 'scene', args }), open: slot => ribbonCalls.push({ type: 'open', slot }) }; } },
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
    addEventListener: (type, fn) => listen(events, type, fn),
    dispatchEvent: event => dispatch(events, event.type, event)
  };
  if (options.customStorage) context.PAPER_READER_STORAGE = store;
  if (options.initialSpread !== undefined) context.PAPER_INITIAL_SPREAD = options.initialSpread;
  if (options.initialPage !== undefined) context.PAPER_INITIAL_PAGE = options.initialPage;
  context.window = context; vm.createContext(context);
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
  function at(side = 'right', radius = 350, localY = 310) {
    const stage = el('stage'), scale = Number(stage.dataset.scale);
    return { x: Number(stage.dataset.x) + (480 + (side === 'right' ? radius : -radius)) * scale, y: Number(stage.dataset.y) + localY * scale, scale, radius, side };
  }
  function tap(side = 'right', duration = 1, pointerType = 'mouse', localY = 310) {
    const p = at(side, 350, localY); emit('pointerdown', p.x, p.y, 1, pointerType, el(side + '-paper')); advance(duration); emit('pointerup', p.x, p.y, 1, pointerType, el(side + '-paper')); return p;
  }
  function hold(side = 'right', pointerType = 'mouse') {
    const p = at(side); emit('pointerdown', p.x, p.y, 1, pointerType, el(side + '-paper')); advance(160); return p;
  }
  function drag(p, progress, type = 'pointermove', pointerType = 'mouse') {
    const px = p.x - (p.side === 'right' ? 1 : -1) * progress * 2 * p.radius * p.scale;
    emit(type, px, p.y, 1, pointerType, el(p.side + '-paper'));
  }
  function click(id, extra = {}) { el(id).dispatchEvent({ type: 'click', detail: 1, ...extra }); }
  return { el, advance, emit, at, tap, hold, drag, click, context, rendered, draws, saved, storage, initialStorage, edgeCalls, ribbonCalls, sceneCalls,
    get now() { return now; }, get ribbonOptions() { return ribbonOptions; }, get edgeItems() { return edgeItems; },
    get edgeLayout() { return options.realIndexDom ? EdgeIndex.layout(context.BIBLE_DATA.books, context.BIBLE_DATA.pages.length, Number(el('stage').dataset.spread), readerIndex.getExpanded()) : edgeLayout; },
    get expandedSide() { return readerIndex.getExpanded(); }, get indexElement() { return readerIndex.element; },
    event: (type, extra = {}) => dispatch(events, type, extra), resize: () => observer?.(),
    selectBook: index => {
      assert.ok(edgeOptions, 'edge index is installed');
      if (options.realIndexDom) return readerIndex.element.querySelector(`[data-book="${index}"]`).dispatchEvent({ type: 'click' });
      if (edgeState.turning) return; if (expandedSide !== null) edge.setExpanded(null); return edgeOptions.onSelect(index);
    },
    expand: side => { assert.ok(edgeOptions, 'edge index is installed'); return readerIndex.setExpanded(side); },
    navigateRibbon: (page, pose) => ribbonOptions.onNavigate(page, pose) };
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });
const spread = f => Number(f.el('stage').dataset.spread);
const state = f => f.el('stage').dataset.foldState;
function assertReading(f) {
  assert.equal(f.el('stage').dataset.scene, 'reading');
  assert.ok(f.sceneCalls.every(s => s === 'reading'), 'no closing, edge-on or directory scene');
}
function assertUnchangedBookmarks(f) {
  for (const key of ['paper-bible-ribbon-v1-0', 'paper-bible-ribbon-v1-1']) assert.equal(f.storage.get(key), f.initialStorage.get(key), key + ' must survive reader updates');
}

for (const pointerType of ['mouse', 'touch']) for (const side of ['left', 'right']) for (const duration of [1, 40]) {
  test(`${pointerType} ${side} ${duration}ms tap starts immediately on release`, () => {
    const f = fixture(20), direction = side === 'right' ? 1 : -1;
    f.tap(side, duration, pointerType);
    assert.equal(f.rendered.length, 1, 'no minimum duration or delayed double-click timer');
    assert.equal(f.rendered[0].at, duration, 'animation starts in the release dispatch');
    assert.equal(f.rendered[0].direction, direction);
    assert.equal(spread(f), 20, 'animation starts immediately, not an instant content jump');
    f.advance(1200); assert.equal(spread(f), 20 + direction * 2); assertReading(f);
  });
}
test('page-number taps are not a separate slow path', () => {
  const f = fixture(20); f.tap('right', 1, 'touch', 29);
  assert.equal(f.rendered.length, 1); f.advance(1200); assert.equal(spread(f), 22);
});
test('159ms release is a click; exactly 160ms acquires paper once', () => {
  const quick = fixture(); quick.tap('right', 159); assert.equal(quick.rendered.length, 1); assert.notEqual(state(quick), 'held');
  const held = fixture(), p = held.at(); held.emit('pointerdown', p.x, p.y); held.advance(159); assert.equal(held.rendered.length, 0);
  held.advance(1); assert.equal(state(held), 'held'); assert.equal(held.rendered.length, 1);
  held.advance(1000); assert.equal(held.rendered.length, 1, 'long hold cannot repeatedly acquire sheets');
  held.drag(p, 0, 'pointerup'); held.advance(1200); assert.equal(spread(held), 2); assert.equal(state(held), 'returned');
});
test('movement before hold deadline cancels hold and remains panning', () => {
  const f = fixture(), p = f.at(); f.emit('pointerdown', p.x, p.y); f.advance(40); f.emit('pointermove', p.x - 20, p.y - 18);
  f.advance(700); assert.equal(f.rendered.length, 0); f.emit('pointerup', p.x - 40, p.y - 35); f.advance(1200);
  assert.equal(f.rendered.length, 0); assert.equal(spread(f), 2);
});
for (const side of ['left', 'right']) test(`${side} held sheet uses correct faces and commits past midpoint`, () => {
  const f = fixture(20), p = f.hold(side), direction = side === 'right' ? 1 : -1;
  const expected = direction > 0 ? { front: 21, back: 22, direction: 1, count: 1 } : { front: 20, back: 19, direction: -1, count: 1 };
  const { at, ...actual } = f.rendered[0]; assert.deepEqual(actual, expected); assert.equal(spread(f), 20);
  f.advance(120); f.drag(p, .7); f.advance(180); f.drag(p, .7, 'pointerup'); f.advance(1400);
  assert.equal(spread(f), 20 + direction * 2); assert.equal(state(f), 'committed');
});
test('held paper can reverse after midpoint and return original vector page', () => {
  const f = fixture(), original = f.el('right-paper').innerHTML, p = f.hold();
  f.drag(p, .8); f.advance(240); f.drag(p, .7); f.advance(45); f.drag(p, .6); f.drag(p, .6, 'pointerup'); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned'); assert.equal(f.el('right-paper').innerHTML, original);
});
test('final release coordinates can complete a held curl without an intermediate move', () => {
  const f = fixture(), p = f.hold(); f.advance(180); f.drag(p, .9, 'pointerup'); f.advance(1500);
  assert.equal(spread(f), 4); assert.equal(state(f), 'committed');
});
test('final release coordinates can reverse a held curl without an intermediate move', () => {
  const f = fixture(), p = f.hold(); f.drag(p, .9); f.advance(180); f.drag(p, .1, 'pointerup'); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
});
test('pausing below midpoint dissipates old inward velocity before release', () => {
  const f = fixture(), p = f.hold(); f.drag(p, .08); f.advance(20); f.drag(p, .35); f.advance(1000); f.drag(p, .35, 'pointerup'); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
});
test('pointercancel restores a nearly completed held sheet', () => {
  const f = fixture(), original = f.el('right-paper').innerHTML, p = f.hold(); f.drag(p, .94); f.drag(p, .94, 'pointercancel'); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned'); assert.equal(f.el('right-paper').innerHTML, original);
});
test('cancel before hold has no tap or delayed turn', () => {
  const f = fixture(), p = f.at(); f.emit('pointerdown', p.x, p.y); f.advance(40); f.emit('pointercancel', p.x, p.y); f.advance(1500);
  assert.equal(f.rendered.length, 0); assert.equal(spread(f), 2);
});
test('lost pointer capture without coordinates cancels rather than committing', () => {
  const f = fixture(), p = f.hold(); f.drag(p, .9);
  f.el('stage').dispatchEvent({ type: 'lostpointercapture', pointerId: 1 }); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
  for (const key of ['x', 'y', 'scale']) assert.ok(Number.isFinite(Number(f.el('stage').dataset[key])));
});
test('Escape cancels held paper and pending taps are cleared on blur', () => {
  const f = fixture(), p = f.hold(); f.drag(p, .8);
  f.el('stage').dispatchEvent({ type: 'keydown', key: 'Escape' }); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
  f.tap(); f.tap(); f.tap(); f.advance(40); f.event('blur'); f.advance(4000);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
});
test('second finger cancels held sheet and pinch only changes camera', () => {
  const f = fixture(), p = f.hold('right', 'touch'); f.drag(p, .25, 'pointermove', 'touch');
  f.emit('pointerdown', p.x + 30, p.y + 60, 2, 'touch');
  assert.equal(state(f), 'returned');
  f.advance(30); f.emit('pointermove', p.x - 30, p.y - 40, 1, 'touch'); f.emit('pointermove', p.x + 80, p.y + 120, 2, 'touch');
  f.emit('pointerup', p.x - 30, p.y - 40, 1, 'touch'); f.emit('pointerup', p.x + 80, p.y + 120, 2, 'touch'); f.advance(1200);
  assert.equal(spread(f), 2); assert.equal(f.rendered.length, 1); assert.ok(Number(f.el('stage').dataset.scale) > p.scale);
});
test('pinch before hold cancels timer and neither finger release turns a page', () => {
  const f = fixture(), p = f.at(); f.emit('pointerdown', p.x, p.y, 1, 'touch'); f.advance(40); f.emit('pointerdown', p.x, p.y + 60, 2, 'touch');
  f.emit('pointermove', p.x - 30, p.y - 40, 1, 'touch'); f.emit('pointermove', p.x + 50, p.y + 120, 2, 'touch'); f.advance(300);
  f.emit('pointerup', p.x - 30, p.y - 40, 1, 'touch'); f.emit('pointerup', p.x + 50, p.y + 120, 2, 'touch'); f.advance(1200);
  assert.equal(f.rendered.length, 0); assert.equal(spread(f), 2);
});
for (const interruption of ['blur', 'paper-interrupt', 'document:visibilitychange']) test(`${interruption} cancels held paper without losing place`, () => {
  const f = fixture(), p = f.hold(); f.drag(p, .8);
  if (interruption === 'document:visibilitychange') f.context.document.hidden = true;
  f.event(interruption); f.advance(1200); f.drag(p, .8, 'pointerup'); f.advance(1200);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned');
});
test('resize safely cancels physical drag and preserves spread', () => {
  const f = fixture(), p = f.hold(); f.drag(p, .6); f.el('stage').clientWidth = 390; f.resize(); f.advance(1500);
  assert.equal(spread(f), 2); assert.equal(state(f), 'returned'); assertReading(f);
});
test('first/final spread bounds apply to both tap and hold', () => {
  const final = fixture().context.BIBLE_DATA.pages.length - 2;
  for (const [page, side] of [[0, 'left'], [final, 'right']]) {
    const f = fixture(page); f.tap(side); f.advance(1200); const p = f.hold(side); f.drag(p, .9, 'pointerup'); f.advance(1200);
    assert.equal(spread(f), page); assert.equal(f.rendered.length, 0);
  }
});
test('continuous taps queue every requested sheet rather than dropping input', () => {
  const f = fixture(20); f.tap(); f.advance(30); f.tap(); f.advance(30); f.tap(); f.advance(4000);
  assert.equal(spread(f), 26); assert.equal(f.rendered.length, 3); assert.ok(f.rendered.every(x => x.count === 1));
});
test('selecting a edge navigates directly while book stays open', () => {
  const f = fixture(20), target = f.context.BIBLE_DATA.books[65].first & ~1;
  f.selectBook(65); f.advance(4000); assert.equal(spread(f), target); assertReading(f);
  assert.ok(f.edgeCalls.length); assertUnchangedBookmarks(f);
});
for (const code of ['PHM', '2JN']) test(`${code} even-page edge keeps its own title, ribbon page and saved anchor after reload`, () => {
  const data = currentRuleData(), index = data.books.findIndex(book => book.code === code), selected = data.books[index], page = selected.first;
  assert.equal(page % 2, 0, 'regression requires the selected book to open on the left');
  assert.notEqual(data.pages[page + 1].b, index, 'right page belongs to the following short book');
  for (const width of [980, 390]) {
    const options = { data, width, height: 844, realEdgeGeometry: true, customStorage: true };
    const f = fixture(20, options); f.selectBook(index);
    function assertSelected(reader) {
      assert.equal(spread(reader), page); assert.equal(reader.el('book-name').textContent, selected.name);
      assert.equal(reader.el('stage').dataset.book, selected.code);
      const bookmark = reader.ribbonOptions.getCurrent();
      assert.equal(bookmark.page, page); assert.equal(bookmark.bookName, selected.name); assert.equal(bookmark.ref, data.pages[page].start);
      const saved = JSON.parse(reader.storage.get('paper-bible-position-v1'));
      assert.equal(saved.page, page); assert.equal(saved.spread, page); assert.equal(saved.bookName, selected.name); assert.equal(saved.ref, data.pages[page].start);
      if (width === 390) assert.equal(saved.focus, 'left', 'phone camera follows the selected left page');
      assertReading(reader); assertUnchangedBookmarks(reader);
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
    assert.equal(f.ribbonOptions.getCurrent().page, page); assert.equal(saved.focus, page % 2 ? 'right' : 'left');
  }
});
test('left-page ribbon navigation preserves its exact short-book anchor', () => {
  const data = currentRuleData(), selected = data.books.find(book => book.code === 'PHM');
  const f = fixture(20, { data });
  f.navigateRibbon(selected.first, { zoom: 2, cx: 250, cy: 340, focus: 'left' });
  assert.equal(f.el('book-name').textContent, selected.name); assert.equal(f.ribbonOptions.getCurrent().page, selected.first);
  assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, selected.first); assertUnchangedBookmarks(f);
});
test('explicit left/right focus changes the displayed book and persisted face together', () => {
  const data = currentRuleData(), page = data.books.find(book => book.code === 'PHM').first, f = fixture(page, { data });
  for (const [side, index] of [['left', page], ['right', page + 1]]) {
    f.click('focus-' + side);
    assert.equal(f.el('book-name').textContent, data.books[data.pages[index].b].name);
    assert.equal(f.ribbonOptions.getCurrent().page, index);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, index);
  }
});
test('directory dialog interrupts held sheet without closing the physical book', () => {
  const f = fixture(20), p = f.hold(); f.drag(p, .6); f.event('paper-directory-request'); f.advance(1500);
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
test('position persistence does not overwrite either ribbon and custom storage is respected', () => {
  const f = fixture(20, { customStorage: true }); f.tap(); f.advance(1500);
  assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).spread, 22); assertUnchangedBookmarks(f);
  assert.ok(f.ribbonOptions.storage); assert.equal(f.ribbonOptions.storage.getItem('paper-bible-ribbon-v1-0'), f.initialStorage.get('paper-bible-ribbon-v1-0'));
});
test('saved custom reading zoom and center survive initial load', () => {
  const f = fixture(20, { pose: { zoom: 2, centerX: 600, centerY: 340, focus: 'custom' } });
  const saved = JSON.parse(f.storage.get('paper-bible-position-v1'));
  assert.equal(saved.spread, 20); assert.equal(saved.focus, 'custom');
  assert.ok(Math.abs(saved.zoom - 2) < 1e-8); assert.ok(Math.abs(saved.centerX - 600) < 1e-8); assert.ok(Math.abs(saved.centerY - 340) < 1e-8);
  assertUnchangedBookmarks(f);
});
test('explicit initial page overrides stored position and is normalized to a spread', () => {
  const f = fixture(20, { initialSpread: 101 });
  assert.equal(spread(f), 100); assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).spread, 100); assertUnchangedBookmarks(f);
});
test('ribbon navigation restores its spread without entering an index scene', () => {
  const f = fixture(20); f.navigateRibbon(34, { zoom: 2, cx: 600, cy: 340, focus: 'custom' }); f.advance(4000);
  assert.equal(spread(f), 34); assertReading(f); assertUnchangedBookmarks(f);
});
test('current rules edition retains exact scripture SVG and last-book navigation', () => {
  const data = currentRuleData();
  const f = fixture(20, { data, customStorage: true });
  assert.equal(f.el('left-paper').innerHTML, Page.svg(data.pages[20], 20, data.books));
  assert.equal(f.el('right-paper').innerHTML, Page.svg(data.pages[21], 21, data.books));
  f.selectBook(65); f.advance(4000);
  const target = data.books[65].first & ~1;
  assert.equal(spread(f), target); assertReading(f); assertUnchangedBookmarks(f);
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
  assert.equal(f.storage.get('paper-bible-position-v1'), saved); assertReading(f); assertUnchangedBookmarks(f);
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
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }), original = f.el('right-paper').innerHTML, p = f.hold();
  f.drag(p, .8); f.expand('right'); assert.equal(f.expandedSide, null); assert.equal(state(f), 'held');
  f.drag(p, .8, 'pointercancel'); f.advance(1500);
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
    f.selectBook(index);
    assert.equal(f.expandedSide, null); assert.equal(spread(f), selected.first & ~1);
    assert.equal(f.el('book-name').textContent, selected.name); assert.equal(f.ribbonOptions.getCurrent().page, selected.first);
    assert.equal(JSON.parse(f.storage.get('paper-bible-position-v1')).page, selected.first); assertReading(f);
  }
  assertUnchangedBookmarks(f);
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
  f.tap(); f.advance(1500); assert.equal(spread(f), 602);
});
test('peek demo closes edge selection before drawing and reading resumes afterward', () => {
  const f = fixture(600, { data: currentRuleData(), realEdgeGeometry: true }), original = camera(f);
  f.expand('left'); f.click('demo-peek'); f.advance(2000);
  assert.equal(f.expandedSide, null); assert.equal(f.el('stage').dataset.edgeExpanded, undefined);
  assert.equal(spread(f), 600); assertCameraEqual(camera(f), original);
  f.tap(); f.advance(1500); assert.equal(spread(f), 602);
});
test('real EdgeIndex DOM and reader callbacks expand, select all 66, then resume page turns', () => {
  const data = currentRuleData(), f = fixture(600, { data, realIndexDom: true, width: 390, height: 844 });
  for (let index = 0; index < data.books.length; index++) {
    const selected = data.books[index], side = EdgeIndex.carrierSheet(selected) <= Math.floor(spread(f) / 2) ? 'left' : 'right';
    const band = f.indexElement.querySelectorAll('.edge-index__band').find(button => button.dataset.side === side);
    assert.ok(!band.disabled); band.dispatchEvent({ type: 'click' }); assert.equal(f.expandedSide, side);
    const button = f.indexElement.querySelector(`[data-book="${index}"]`);
    assert.ok(!button.hidden && !button.disabled, selected.name + ' actual button is accessible');
    f.selectBook(index);
    assert.equal(f.expandedSide, null); assert.equal(f.el('book-name').textContent, selected.name);
    assert.equal(f.ribbonOptions.getCurrent().page, selected.first);
  }
  f.tap(); f.advance(1500); assert.equal(spread(f), (data.books[65].first & ~1) + 2);
  assertUnchangedBookmarks(f);
});

async function run() {
  for (const { name, fn } of scenarios) { await fn(); console.log('PASS ' + name); }
  console.log(JSON.stringify({ edgeReaderScenarios: scenarios.length }));
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, scenarios, run };
