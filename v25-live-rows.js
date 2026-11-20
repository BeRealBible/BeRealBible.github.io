/* Recover existing V25 physical lines from the sealed glyph stream. No reflow. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.V25LiveRows = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const han = /^\p{Script=Han}$/u;
  const center = w => w[1] + w[3] / 2;
  const middle = w => w[0] + w[2] / 2;
  const median = a => { const b = a.slice().sort((x, y) => x - y); return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2; };

  // Input: the physical pack page[3] word tuples [x,y,w,h,text], and readTags(page).
  // Output: {rows, rowFor, gutter}; unknown tokens have null rowFor[i].
  // Each row has its original page-space anchors, actual members, and column index.
  function infer(words, tags) {
    const rowFor = Array(words.length).fill(null), anchors = [];
    const anchorsByColumn = [[], []], rows = [];
    words.forEach((w, i) => {
      if (tags[i]?.role === 'body' && w[3] >= 24 && han.test(w[4])) anchors.push(i);
    });
    const reset = [];
    for (let i = 1; i < anchors.length; i++) {
      if (center(words[anchors[i - 1]]) - center(words[anchors[i]]) > 100) reset.push(i);
    }
    if (reset.length !== 1) return {rows, rowFor, gutter: null};
    const columns = [anchors.slice(0, reset[0]), anchors.slice(reset[0])];
    const leftEnd = Math.max(...columns[0].map(i => middle(words[i])));
    const rightStart = Math.min(...columns[1].map(i => middle(words[i])));
    if (leftEnd >= rightStart) return {rows, rowFor, gutter: null};
    const gutter = (leftEnd + rightStart) / 2;
    for (let column = 0; column < columns.length; column++) {
      let r;
      for (const i of columns[column]) {
        const y = center(words[i]);
        if (!r || Math.abs(y - center(words[r.anchors[0]])) > 14) {
          const row = anchorsByColumn[column].length;
          r = {column, row, key: column + ':' + row, anchors: [], members: []};
          anchorsByColumn[column].push(r); rows.push(r);
        }
        r.anchors.push(i);
      }
    }
    for (const r of rows) {
      r.centerY = median(r.anchors.map(i => center(words[i])));
      r.first = r.anchors[0]; r.last = r.anchors.at(-1);
      r.left = Math.min(...r.anchors.map(i => words[i][0]));
      r.right = Math.max(...r.anchors.map(i => words[i][0] + words[i][2]));
      r.anchors.forEach(i => { rowFor[i] = r; });
    }
    words.forEach((w, i) => {
      const role = tags[i]?.role;
      if (rowFor[i] || (role !== 'body' && role !== 'verse' && role !== 'chapter')) return;
      const x = middle(w);
      // Do not assign visually ambiguous central content or a token closer to
      // a different row than the one bounded by its raw stream neighbours.
      if (Math.abs(x - gutter) < 2) return;
      const col = x < gutter ? 0 : 1, list = anchorsByColumn[col];
      const y = center(w);
      const bracket = list.find(r => r.first < i && i < r.last);
      if (bracket && Math.abs(y - bracket.centerY) <= 33) {
        rowFor[i] = bracket; return;
      }
      let best, distance = Infinity, second = Infinity;
      for (const r of list) {
        const delta = Math.abs(y - r.centerY);
        if (delta < distance) { second = distance; distance = delta; best = r; }
        else if (delta < second) second = delta;
      }
      if (best && distance <= 24 && second - distance >= 8) rowFor[i] = best;
    });
    rowFor.forEach((r, i) => { if (r) r.members.push(i); });
    return {rows, rowFor, gutter};
  }
  return {infer};
});
