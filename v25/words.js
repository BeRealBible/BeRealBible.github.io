/* One normalization and match definition for the index, the slip and printed ink. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.V25Words=api;
})(globalThis,function(){
  const fold=c=>c.normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
  function key(text){return Array.from(text,fold).join('');}
  function terms(raw){return raw.trim().split(/\s+/u).map(key).filter(Boolean);}
  function ordered(hay,words){
    let from=0;for(const w of words){const n=hay.indexOf(w,from);if(n<0)return false;from=n+w.length;}return words.length>0;
  }
  // UTF-16 offsets in the original, unmodified text. A verse that matched
  // the ordered query shows all visible occurrences of its keywords.
  function ranges(text,words){
    if(!words?.length)return [];
    let s='',pos=0;const offsets=[],ends=[];
    for(const c of text){const k=fold(c);s+=k;for(let j=0;j<k.length;j++){offsets.push(pos);ends.push(pos+c.length);}pos+=c.length;}
    const all=[];
    for(const w of new Set(words)){if(!w)continue;let i=-1;while((i=s.indexOf(w,i+1))>=0)all.push([offsets[i],ends[i+w.length-1]]);}
    all.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);const out=[];
    for(const r of all){const p=out.at(-1);if(p&&r[0]<p[1])p[1]=Math.max(p[1],r[1]);else out.push(r);}
    return out;
  }
  function paint(host,text,words){
    let at=0;for(const [a,b] of ranges(text,words)){host.append(text.slice(at,a));const m=host.ownerDocument.createElement('mark');m.textContent=text.slice(a,b);host.append(m);at=b;}host.append(text.slice(at));
  }
  return {key,terms,ordered,ranges,paint};
});
