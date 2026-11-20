/* Context stays inside each cited book. Boundaries follow actual verses, not
   chapter +/- 1: the preceding verse normally belongs to the same chapter. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.V25CitationContext=factory();
})(globalThis,function(){
  const books=new WeakMap();
  function index(b){
    if(books.has(b))return books.get(b);
    const rows=[],at=new Map(),first=new Map(),last=new Map();
    for(const c of b.chapters){
      first.set(c.chapter,rows.length);
      for(const [n,text] of c.verses){
        const ref=c.chapter+':'+n;at.set(ref,rows.length);rows.push({code:b.code,short:b.short,chapter:c.chapter,verse:n,ref,text});
      }
      last.set(c.chapter,rows.length-1);
    }
    const idx={rows,at,first,last};books.set(b,idx);return idx;
  }
  return function context(verses,source){
    const spans=[];
    for(const v of verses){
      const b=source.books.find(b=>b.code===v.code);if(!b)continue;
      const idx=index(b),i=idx.at.get(v.chapter+':'+v.verse);if(i===undefined)continue;
      const prev=spans.at(-1);
      if(prev?.idx===idx&&i===prev.end+1)prev.end=i;else spans.push({idx,start:i,end:i});
    }
    const blocks=[];
    for(const {idx,start,end} of spans){
      const r=idx.rows,lo=idx.first.get(r[Math.max(0,start-1)].chapter),hi=idx.last.get(r[Math.min(r.length-1,end+1)].chapter);
      const prev=blocks.at(-1),b=prev?.idx===idx&&lo<=prev.hi+1&&hi>=prev.lo-1?prev:{idx,lo,hi,targets:new Set(),starts:new Set()};
      if(prev!==b)blocks.push(b);b.lo=Math.min(b.lo,lo);b.hi=Math.max(b.hi,hi);
      b.starts.add(start);for(let i=start;i<=end;i++)b.targets.add(i);
    }
    return blocks.map(b=>b.idx.rows.slice(b.lo,b.hi+1).map((r,i)=>({...r,cited:b.targets.has(i+b.lo),start:b.starts.has(i+b.lo)})));
  };
});
