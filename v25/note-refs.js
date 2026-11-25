/* Note fields require an exact address, not the looser prose-link scanner. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25NoteRefs=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const MAX=256,MAX_PLACES=10,delimiter=/[,，;；.。．\r\n]/u,ending=/[,，;；.。．]\s*$/u;
  const allowsPlaces=(next,previous=0)=>next<=MAX_PLACES||previous>MAX_PLACES&&next<=previous;
  const normalize=text=>text.normalize('NFKC').replaceAll('節','节').trim();
  const key=({code,ch,lo,hi=lo,endCh=ch})=>code+'.'+ch+(lo==null?'':':'+lo+'-'+(endCh===ch?'':endCh+':')+hi);
  const startOf=({ch,lo})=>ch*1000+lo,endOf=({ch,lo,hi=lo,endCh=ch})=>endCh*1000+hi;
  const covers=(a,b)=>a.code===b.code&&(a.lo==null||b.lo==null?key(a)===key(b):startOf(a)<=startOf(b)&&endOf(a)>=endOf(b));
  const label=(book,{ch,lo,hi=lo,endCh=ch})=>book+' '+ch+(lo==null?'章':':'+lo+
    (endCh!==ch?'–'+endCh+':'+hi:lo===hi?'':'–'+hi));
  const loc=({code,ch,lo,hi=lo})=>({code,ref:ch+':'+lo+(hi===lo?'':'-'+hi)});
  const number=String.raw`(?:\d{1,3}|[〇零一二两兩三四五六七八九十百]{1,6})`;
  const ord=String.raw`(?:第\s*)?(`+number+')';
  const nums='〇一二三四五六七八九';
  function decimal(value){
    if(!value)return undefined;
    if(/^\d+$/.test(value))return +value;
    const s=value.replace(/[零]/g,'〇').replace(/[两兩]/g,'二');
    if(!/[十百]/.test(s))return +[...s].map(c=>nums.indexOf(c)).join('');
    if(!/^(?:[一二三四五六七八九]百(?:〇[一二三四五六七八九]|[一二三四五六七八九]十[一二三四五六七八九]?)?|[一二三四五六七八九]?十[一二三四五六七八九]?)$/u.test(s))return NaN;
    const [,a,b,c]=/^(?:([一二三四五六七八九])百)?(?:([一二三四五六七八九]?)十)?〇?([一二三四五六七八九])?$/u.exec(s);
    return (a?nums.indexOf(a)*100:0)+(b===undefined?0:(b?nums.indexOf(b):1)*10)+(c?nums.indexOf(c):0);
  }
  const gap=String.raw`\s*(?:[-–—−~〜]+|至|到)\s*`;
  const verse=ord+String.raw`\s*节?`;
  const separator=String.raw`\s*(?:[:章篇]\s*|章\s*的\s*)`;
  const localAddress=new RegExp('^'+ord+'(?:'+separator+verse+'|\\s*[章篇])?$','u');
  const singleVerse=new RegExp('^'+verse+'$','u');
  const rangeSplit=new RegExp(gap,'u');
  const verseRange=new RegExp('^'+verse+'(?:'+gap+verse+')?$','u');
  const positive=n=>Number.isSafeInteger(n)&&n>=1&&n<=999;
  function encode({code,ch,lo,hi=lo,endCh=ch}){
    return lo==null?[code,ch]:endCh===ch?[code,ch,lo,hi]:[code,ch,lo,endCh,hi];
  }
  function decode(r){
    if(!Array.isArray(r)||![2,4,5].includes(r.length)||typeof r[0]!=='string'||!r.slice(1).every(positive))return null;
    const [code,ch,lo,a,b]=r;
    if(r.length===2)return {code,ch};
    if(r.length===5)return a>ch?{code,ch,lo,endCh:a,hi:b}:null;
    return a>=lo?{code,ch,lo,hi:a}:null;
  }
  const edition=/\s*(?:和合本(?:修订版)?|新译本|CUV)$/iu;
  const prose=text=>/[\p{Script=Han}]{2}/u.test(text)&&
    !/^(?:[到至章节]|[-–—~〜]|[\p{Script=Han}]{1,10}\s*\d+\s*[:：])/u.test(text.trim());
  function create({bookCode,bookMatches=()=>[],scripture}){
    function segments(ref){
      const {code,ch,lo,endCh=ch,hi=lo}=ref;
      if(endCh===ch)return [ref];
      const data=scripture.index(code);
      if(!data?.byRef.has(ch+':'+lo)||!data.byRef.has(endCh+':'+hi))return [];
      const span=data.chunks.filter(chunk=>chunk.chapter>=ch&&chunk.chapter<=endCh);
      if(span.length!==endCh-ch+1)return [];
      return span.map(({chapter,rows})=>({code,ch:chapter,lo:chapter===ch?lo:rows[0].lo,hi:chapter===endCh?hi:rows.at(-1).hi}));
    }
    function checked(code,ch,lo,hi=lo,endCh=ch){
      if(!code||!positive(ch)||!positive(endCh)||endCh<ch||lo!==undefined&&(!positive(lo)||!positive(hi)))return null;
      if(lo===undefined)return scripture.index(code)?.chunks.some(c=>c.chapter===ch)?{code,ch}:null;
      const ref={code,ch,lo,hi};
      if(endCh!==ch){ref.endCh=endCh;return segments(ref).length?ref:null;}
      if(hi<lo)return null;
      return scripture.resolve(loc(ref)).length?ref:null;
    }
    function neighbor(code,pos,step){
      const book=scripture.index(code),ch=Math.floor(pos/1000),v=pos%1000,row=book?.byRef.get(ch+':'+v);
      if(!row)return null;
      if(v+step>=row.lo&&v+step<=row.hi)return pos+step;
      const other=book.rows[row.order+step];
      return other?other.ch*1000+(step<0?other.hi:other.lo):null;
    }
    const between=(code,a,b)=>a!=null&&b!=null&&a<=b?
      checked(code,Math.floor(a/1000),a%1000,b%1000,Math.floor(b/1000)):null;
    // Group only picks made in this chooser, never re-group a saved note on
    // load. Whole chapters are named objects rather than verse ranges.
    function mergeSelection(refs,{crossChapter=true}={}){
      const unique=[...new Map(refs.map(ref=>[key(ref),ref])).values()];
      const order=ref=>scripture.index(ref.code).book.index;
      const compare=(a,b)=>order(a)-order(b)||a.ch-b.ch||(a.lo??0)-(b.lo??0);
      const whole=unique.filter(ref=>ref.lo==null),runs=[];
      for(const ref of unique.filter(ref=>ref.lo!=null).sort(compare)){
        const last=runs.at(-1),from=startOf(ref),to=endOf(ref);
        if(last?.code===ref.code){
          const end=endOf(last);
          if(from<=end||neighbor(ref.code,end,1)===from){
            if(to<=end)continue;
            const joined=(crossChapter||last.ch===Math.floor(to/1000))&&between(ref.code,startOf(last),to);
            if(joined){runs[runs.length-1]=joined;continue;}
          }
        }
        runs.push(ref);
      }
      return [...whole,...runs].sort(compare);
    }
    function subtractSelection(ref,cut){
      if(ref.code!==cut.code)return [ref];
      if(ref.lo==null||cut.lo==null)return key(ref)===key(cut)?[]:[ref];
      const a=startOf(ref),b=endOf(ref),c=startOf(cut),d=endOf(cut);
      if(b<c||d<a)return [ref];
      // Removing one highlighted verse from a span leaves the real
      // predecessor/successor as the new endpoints, even at a chapter break.
      return [c>a&&between(ref.code,a,neighbor(ref.code,c,-1)),
        d<b&&between(ref.code,neighbor(ref.code,d,1),b)].filter(Boolean);
    }
    function start(value,defaultCode){
      const text=value.trim();
      const local=defaultCode&&localAddress.exec(text);
      if(local)return {code:defaultCode,ch:decimal(local[1]),lo:decimal(local[2])};
      // Chinese book names can end in a number-looking character; resolve the
      // book prefix first, before interpreting the remaining chapter wording.
      for(let i=Math.min(text.length-1,40);i>0;i--){
        const tail=localAddress.exec(text.slice(i).trimStart());if(!tail)continue;
        const code=bookCode(text.slice(0,i).trim().replace(/^[《〈]|[》〉]$/gu,''));if(!code)continue;
        return {code,ch:decimal(tail[1]),lo:decimal(tail[2])};
      }
      return null;
    }
    function inspect(value,defaultCode){
      const raw=normalize(value).replace(/^(?:参见|参|见)\s*/u,'');
      const parts=raw.split(rangeSplit);
      const invalid={error:'经文不存在，请检查书卷、章或节。'};
      if(!parts.length||parts.length>2)return invalid;
      const first=start(parts[0],defaultCode);if(!first)return invalid;
      const {code,ch,lo}=first;
      if(parts.length===1)return {ref:checked(code,ch,lo),...invalid};
      const missing={error:'区间需要完整的起止经节，例如：王上1:53–2:3。'};
      if(lo===undefined)return missing;
      const endVerse=singleVerse.exec(parts[1]);
      const last=endVerse?{code,ch,lo:decimal(endVerse[1])}:start(parts[1],code);
      if(!last||last.lo===undefined)return missing;
      if(last.code!==code)return {error:'不支持跨书卷的区间，请把两卷分别加入。'};
      if(positive(ch)&&positive(last.ch)&&positive(lo)&&positive(last.lo)&&(last.ch<ch||last.ch===ch&&last.lo<lo)){
        return {error:'区间的起点不能晚于终点。'};
      }
      return {ref:checked(code,ch,lo,last.lo,last.ch),...invalid};
    }
    const exact=(value,defaultCode)=>inspect(value,defaultCode).ref??null;
    // The reader copies each quoted chapter with its own terminal attribution:
    // "( 列王纪上 1:15,20 和合本 )". Commas inside it are verse-list syntax.
    function citation(value){
      const parts=value.trim().replace(edition,'').split(/[,、]/u);
      const first=exact(parts.shift());
      if(!first||parts.length&&first.lo==null)return null;
      const refs=[first];
      for(const part of parts){
        const v=verseRange.exec(part.trim());
        const ref=v&&checked(first.code,first.ch,decimal(v[1]),decimal(v[2]));
        if(!ref)return null;
        refs.push(ref);
      }
      return refs;
    }
    function quoted(value){
      const refs=[];
      for(const block of value.split(/\n\s*\n/u)){
        const lines=block.trim().split(/\r?\n/u),last=lines.at(-1).trim();
        const trailer=/(?:\(([^()\n]+)\)|\[([^\[\]\n]+)\]|【([^【】\n]+)】)\s*$/u.exec(last);
        const wrapped=trailer&&(trailer[1]??trailer[2]??trailer[3]);
        const chapter=wrapped?citation(wrapped):
          lines.length>1?(lines.slice(0,-1).every(prose)&&citation(last.replace(/^[—–-]+\s*/u,''))||
            lines.slice(1).every(prose)&&citation(lines[0])):null;
        if(!chapter?.length)return null;
        refs.push(...chapter);
      }
      return refs;
    }
    function parse(value,{pasted=false,defaultCode}={}){
      const raw=normalize(value).replace(/[,;。 .]+$/u,'').trim();
      if(!raw)return [];
      const single=exact(raw,defaultCode);
      if(single)return [single];
      const chunks=raw.split(delimiter).map(s=>s.trim()).filter(Boolean);
      const list=chunks.map(part=>exact(part,defaultCode));
      if(list.every(Boolean))return list;
      if(edition.test(raw)){
        const listed=citation(raw);
        if(listed)return listed;
      }
      const quote=quoted(raw);
      if(quote)return quote;
      // Also accept pasted quotes that prefix the location on the same line.
      // Don't treat a broken range or a second typed address as quoted prose.
      if(pasted){
        const suffix=/^([\s\S]+)[—–]{1,2}\s*([^\n]{2,72})$/u.exec(raw);
        if(suffix&&prose(suffix[1])){
          const refs=citation(suffix[2]);if(refs)return refs;
        }
        const prefix=/^(.{2,72}?)\s+(?=[「“"『\p{Script=Han}])([\s\S]+)$/u.exec(raw);
        if(prefix&&prose(prefix[2])){
          const ref=exact(prefix[1]);if(ref)return [ref];
        }
      }
      return null;
    }
    function locations(ref){
      if(ref.endCh>ref.ch){
        const locations=[];
        for(const {code,ch,lo,hi} of segments(ref)){
          const byRef=scripture.index(code).byRef;
          let start=null;
          for(let v=lo;v<=hi+1;v++){
            if(v<=hi&&byRef.has(ch+':'+v)){start??=v;continue;}
            if(start!=null){locations.push(loc({code,ch,lo:start,hi:v-1}));start=null;}
          }
        }
        return locations;
      }
      if(ref.lo!=null)return [loc(ref)];
      const first=scripture.index(ref.code)?.chunks.find(c=>c.chapter===ref.ch)?.rows[0];
      return first?[{...loc(first),whole:true}]:[];
    }
    function suggest(value,{pasted=false,editing=false}={}){
      const text=normalize(value);
      if(!text)return [];
      const anchors=parse(text,{pasted});
      if(anchors?.length){
        const [ref]=anchors;
        if(!editing&&anchors.length===1&&ref.lo==null){
          const first=checked(ref.code,ref.ch,1);
          return first?[{anchors:[first],chapter:ref}]:[];
        }
        return [{anchors}];
      }
      if(editing||text.length>40)return [];
      const name=text.replace(/^[《〈]|[》〉]$/gu,'');
      if(!/\p{L}/u.test(name))return [];
      const book=bookCode(name);
      return (book?[book]:bookMatches(name).slice(0,6)).flatMap(code=>{
        const first=checked(code,1,1);
        return first?[{anchors:[first],partial:!book}]:[];
      });
    }
    function completion(value){
      if(!value.trim()||value.length>40||/[\r\n]/u.test(value))return '';
      const raw=normalize(value),name=raw.replace(/^[《〈]|[》〉]$/gu,'');
      const known=bookCode(name),partial=known?[]:bookMatches(name);
      const stamp=exact(raw),forms=[];
      if(known||partial.length===1&&name===raw){
        const book=scripture.index(known||partial[0]);
        const {ch,lo}=book?.rows[0]||{},full=book?.book.name||'';
        const tail=known?'':full.toLowerCase().startsWith(name.toLowerCase())?full.slice(name.length):null;
        if(ch&&tail!==null)forms.push(tail+(/\s$/u.test(value)&&!tail?'':' ')+ch+':'+lo);
      }
      if(stamp&&stamp.lo==null){
        const verse=scripture.index(stamp.code)?.chunks.find(c=>c.chapter===stamp.ch)?.rows[0]?.lo;
        if(verse!=null)forms.push(/[章篇]$/u.test(raw)?verse+'节':':'+verse);
      }
      if(/:$/u.test(raw)){
        const ch=exact(raw.slice(0,-1)),verse=ch?.lo==null&&scripture.index(ch?.code)?.chunks.find(c=>c.chapter===ch?.ch)?.rows[0]?.lo;
        if(verse)forms.push(String(verse));
      }
      return forms.find(suffix=>exact(value+suffix)?.lo!=null)||'';
    }
    return {exact,parse,inspect,locations,segments,suggest,completion,mergeSelection,subtractSelection};
  }
  // Keep the suggested suffix out of the native input and clipboard until
  // accepted. The mirror follows the real input's font and mobile transform.
  function bindCompletion(input,complete){
    const doc=input.ownerDocument,win=doc.defaultView,host=input.parentElement,make=()=>doc.createElement('span');
    const ghost=make(),line=make(),typed=make(),hint=make();
    ghost.className='scripture-ghost';hint.className='scripture-ghost__suffix';typed.className='scripture-ghost__typed';
    ghost.setAttribute('aria-hidden','true');ghost.hidden=true;line.append(typed,hint);ghost.append(line);host.append(ghost);
    let value='',suffix='',shift=false,composing=false;
    function render(){
      value=input.value;
      suffix=!composing&&doc.activeElement===input&&input.selectionStart===value.length&&input.selectionEnd===value.length?complete(value):'';
      ghost.hidden=!suffix;if(!suffix)return;
      const css=win.getComputedStyle(input),num=k=>parseFloat(css[k])||0;
      const top=input.tagName==='TEXTAREA'?num('paddingTop')+num('borderTopWidth'):
        (input.offsetHeight-num('lineHeight'))/2;
      Object.assign(ghost.style,{left:input.offsetLeft+'px',top:input.offsetTop+'px',width:input.offsetWidth+'px',height:input.offsetHeight+'px',
        fontFamily:css.fontFamily,fontWeight:css.fontWeight,fontSize:css.fontSize,letterSpacing:css.letterSpacing,lineHeight:css.lineHeight,
        transform:css.transform,transformOrigin:css.transformOrigin,paddingTop:top+'px',paddingLeft:(num('paddingLeft')+num('borderLeftWidth'))+'px'});
      typed.textContent=value;hint.textContent=suffix;line.style.transform='translateX('+(-input.scrollLeft)+'px)';
    }
    function accept(){
      if(!suffix||input.value!==value||input.selectionStart!==value.length||input.selectionEnd!==value.length||composing)return;
      input.value=value+suffix;input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(new win.InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:suffix}));
      render();
    }
    input.addEventListener('keydown',e=>{
      if(e.key!=='Shift'){shift=false;return;}
      if(!e.repeat)shift=!!suffix&&!e.isComposing&&!composing&&!e.ctrlKey&&!e.metaKey&&!e.altKey;
    });
    input.addEventListener('keyup',e=>{
      if(e.key!=='Shift'){render();return;}
      if(shift&&!e.isComposing&&!composing)accept();shift=false;
    });
    for(const type of ['focus','input','select','selectionchange','scroll','pointerup'])input.addEventListener(type,render);
    input.addEventListener('blur',()=>{shift=false;render();});
    input.addEventListener('compositionstart',()=>{composing=true;shift=false;render();});
    input.addEventListener('compositionend',()=>{composing=false;render();});
    hint.addEventListener('pointerdown',e=>e.preventDefault());hint.addEventListener('click',accept);
    const observer=new win.ResizeObserver(render);observer.observe(host);render.dispose=()=>observer.disconnect();
    return render;
  }
  function describe(objects,books,parser,plain){
    if(!objects.some(o=>o.endCh>o.ch))return plain(objects);
    const order=new Map(books.map((book,i)=>[book.code,{...book,i}]));
    const canonical=[...new Map(objects.filter(o=>order.has(o.code)).map(o=>[key(o),o])).values()]
      .sort((a,b)=>order.get(a.code).i-order.get(b.code).i||a.ch-b.ch||(a.lo??0)-(b.lo??0)||(a.endCh??a.ch)-(b.endCh??b.ch)||(a.hi??0)-(b.hi??0));
    const segments=canonical.map(o=>parser.segments(o));
    if(segments.some(s=>!s.length))return plain([]);
    const refs=plain(segments.flat()).objects.map(encode);
    const title=k=>canonical.map(o=>label(order.get(o.code)[k]||order.get(o.code).name,o)).join('；');
    return {objects:canonical,key:canonical.map(key).join('|'),title:title('short'),fullTitle:title('name'),refs,
      anchorObjects:canonical.map(encode)};
  }
  return {create,key,label,covers,MAX,MAX_PLACES,allowsPlaces,ending,encode,decode,describe,bindCompletion};
});
