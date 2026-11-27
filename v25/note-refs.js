/* Note fields require an exact address, not the looser prose-link scanner. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25NoteRefs=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const MAX=256,MAX_PLACES=10,delimiter=/[,，;；.。．\r\n]/u,ending=/[,，;；.。．]\s*$/u;
  const pickEnd=/[ \t\u00a0\u3000,，、.。．;；"'“”‘’「」『』]+$/u;
  const allowsPlaces=(next,previous=0)=>next<=MAX_PLACES||previous>MAX_PLACES&&next<=previous;
  const normalize=text=>text.normalize('NFKC').replaceAll('節','节').trim();
  const key=({code,ch,lo,hi=lo,endCh=ch})=>code+'.'+ch+(lo==null?'':':'+lo+'-'+(endCh===ch?'':endCh+':')+hi);
  const startOf=({ch,lo})=>ch*1000+lo,endOf=({ch,lo,hi=lo,endCh=ch})=>endCh*1000+hi;
  const covers=(a,b)=>a.code===b.code&&(a.lo==null||b.lo==null?key(a)===key(b):startOf(a)<=startOf(b)&&endOf(a)>=endOf(b));
  const label=(book,{ch,lo,hi=lo,endCh=ch})=>book+' '+ch+(lo==null?'章':':'+lo+
    (endCh!==ch?'–'+endCh+':'+hi:lo===hi?'':'–'+hi));
  const lookupLabel=(book,{anchors:[ref],chapter,chapterEnd})=>chapterEnd>ref.ch?
    book+' '+ref.ch+'–'+chapterEnd+'章':label(book,chapter||ref);
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
  const spacedAddress=new RegExp('^('+number+')\\s+('+number+')(?:(?:\\s+|'+gap+')('+number+'))?$','u');
  const chapterSpan=new RegExp('^'+ord+'\\s*[章篇]?'+gap+ord+'\\s*[章篇]?$','u');
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
  function create({bookCode,bookChoices=()=>[],bookMatches=()=>[],scripture}){
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
      const book=scripture.index(code),ch=Math.floor(pos/1000),verse=pos%1000,row=book?.byRef.get(ch+':'+verse);
      if(!row)return null;
      if(verse+step>=row.lo&&verse+step<=row.hi)return pos+step;
      const next=book.rows[row.order+step];
      return next?next.ch*1000+(step<0?next.hi:next.lo):null;
    }
    const between=(code,from,to)=>from!=null&&to!=null&&from<=to?
      checked(code,Math.floor(from/1000),from%1000,to%1000,Math.floor(to/1000)):null;
    const inOrder=(a,b)=>scripture.index(a.code).book.index-scripture.index(b.code).book.index||
      a.ch-b.ch||(a.lo??0)-(b.lo??0);
    function mergePicks(refs,crossChapter){
      const unique=[...new Map(refs.map(ref=>[key(ref),ref])).values()].sort(inOrder);
      const whole=unique.filter(ref=>ref.lo==null),ranges=[];
      for(const ref of unique){
        if(ref.lo==null)continue;
        const last=ranges.at(-1),from=startOf(ref),to=endOf(ref);
        if(last?.code===ref.code){
          const end=endOf(last);
          if(from<=end||neighbor(ref.code,end,1)===from){
            if(to<=end)continue;
            const combined=(crossChapter||last.ch===Math.floor(to/1000))&&between(ref.code,startOf(last),to);
            if(combined){ranges[ranges.length-1]=combined;continue;}
          }
        }
        ranges.push(ref);
      }
      return [...whole,...ranges].sort(inOrder);
    }
    function subtractPick(ref,part){
      if(ref.code!==part.code)return [ref];
      if(ref.lo==null||part.lo==null)return key(ref)===key(part)?[]:[ref];
      const from=startOf(ref),to=endOf(ref),lo=startOf(part),hi=endOf(part);
      if(to<lo||hi<from)return [ref];
      return [lo>from&&between(ref.code,from,neighbor(ref.code,lo,-1)),
        hi<to&&between(ref.code,neighbor(ref.code,hi,1),to)].filter(Boolean);
    }
    function togglePick(picks,option,{crossChapter=true}={}){
      // Whole chapters remain explicit chapter objects; only staged verse
      // ranges are joined or split. Never regroup the note's saved anchors.
      const ref=decode(encode(option));
      if(!ref)return picks;
      return picks.some(item=>covers(item,ref))
        ?picks.flatMap(item=>subtractPick(item,ref)).sort(inOrder)
        :mergePicks([...picks,ref],crossChapter);
    }
    function start(value,defaultCode,resolve=bookCode){
      const text=value.trim();
      const local=defaultCode&&localAddress.exec(text);
      if(local)return {code:defaultCode,ch:decimal(local[1]),lo:decimal(local[2])};
      // Chinese book names can end in a number-looking character; resolve the
      // book prefix first, before interpreting the remaining chapter wording.
      for(let i=Math.min(text.length-1,40);i>0;i--){
        const tail=localAddress.exec(text.slice(i).trimStart());if(!tail)continue;
        const code=resolve(text.slice(0,i).trim().replace(/^[《〈]|[》〉]$/gu,''));
        if(!code||Array.isArray(code)&&!code.length)continue;
        return {code,ch:decimal(tail[1]),lo:decimal(tail[2])};
      }
      return null;
    }
    function inspect(value,defaultCode,resolve=bookCode){
      const raw=normalize(value).replace(/^(?:参见|参|见)\s*/u,'');
      const parts=raw.split(rangeSplit);
      const invalid={error:'经文不存在，请检查书卷、章或节。'};
      if(!parts.length||parts.length>2)return invalid;
      const first=start(parts[0],defaultCode,resolve);if(!first)return invalid;
      const {code,ch,lo}=first;
      if(parts.length===1)return {ref:checked(code,ch,lo),...invalid};
      const missing={error:'区间需要完整的起止经节，例如：王上1:53–2:3。'};
      if(lo===undefined)return missing;
      const endVerse=singleVerse.exec(parts[1]);
      const last=endVerse?{code,ch,lo:decimal(endVerse[1])}:start(parts[1],code,resolve);
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
      // An exact but undivided name, e.g. “列王 2:3”, can offer each
      // applicable address without granting it the status of an exact match.
      const candidate=text.replace(pickEnd,'').trim().replace(/^(?:参见|参|见)\s*/u,'');
      const possibilities=start(candidate.split(rangeSplit)[0],undefined,bookChoices)?.code;
      if(possibilities?.length>1)return possibilities.flatMap(code=>{
        const resolve=name=>bookCode(name)||(bookChoices(name).includes(code)?code:undefined);
        const ref=inspect(candidate,undefined,resolve).ref;
        return ref?[{anchors:[ref],partial:true}]:[];
      });
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
    function locateOne(value,options={}){
      const single=suggest(value,options).filter(result=>result.anchors.length===1);
      if(options.editing||single.some(result=>!result.partial))return single;
      const suffix=completion(value);
      // A completion for a unique book/chapter is a real address; a loose
      // book-name match without a valid completion is only a candidate.
      return suffix?suggest(value+suffix,options):single;
    }
    function finder(value,options={}){
      // Both live lookup fields use these quick coordinates. They do not
      // extend the grammar for persisted note objects or prose citations.
      const text=normalize(value).replace(pickEnd,'').replace(/^(?:参见|参|见)\s*/u,'');
      for(let i=Math.min(text.length-1,40);i>0;i--){
        const tail=text.slice(i).trimStart(),spaced=spacedAddress.exec(tail),
          chapters=chapterSpan.exec(tail),compact=/^[1-9]\d{1,5}$/u.test(tail);
        if(!spaced&&!chapters&&!compact)continue;
        const name=text.slice(0,i).trim().replace(/^[《〈]|[》〉]$/gu,''),
          book=bookCode(name),codes=book?[book]:bookChoices(name);
        if(!codes.length)continue;
        const result=(ref,chapterEnd,span)=>({anchors:[ref],partial:!book,addressInput:true,chapterEnd,span});
        if(spaced){
          const [ch,lo,hi]=spaced.slice(1).map(decimal);
          return codes.flatMap(code=>{
            const ref=checked(code,ch,lo,hi);
            return ref?[result(ref)]:[];
          });
        }
        if(chapters){
          const ch=decimal(chapters[1]),last=decimal(chapters[2]);
          return codes.flatMap(code=>{
            const from=checked(code,ch),to=checked(code,last);
            if(!from||!to||last<ch)return [];
            if(last===ch)return [result(from,last)];
            const chunks=scripture.index(code).chunks,
              lo=chunks.find(c=>c.chapter===ch).rows[0].lo,hi=chunks.find(c=>c.chapter===last).rows.at(-1).hi,
              span=checked(code,ch,lo,hi,last);
            return span?[result(from,last,span)]:[];
          });
        }
        // A chapter that already exists keeps its previous meaning. Otherwise
        // try every split into one chapter and one verse, and never guess spans.
        const whole=codes.map(code=>checked(code,+tail)).filter(Boolean);
        if(whole.length)return whole.map(ref=>result(ref));
        return codes.flatMap(code=>{
          const refs=[];
          for(let cut=Math.max(1,tail.length-3);cut<=Math.min(3,tail.length-1);cut++){
            if(tail[cut]==='0')continue;
            const ref=checked(code,+tail.slice(0,cut),+tail.slice(cut));
            if(ref)refs.push(result(ref));
          }
          return refs;
        });
      }
      const head=text.split(rangeSplit)[0],
        addressInput=!!(start(head,undefined,bookCode)||start(head,undefined,bookChoices));
      return locateOne(value,options).map(result=>({...result,addressInput}));
    }
    return {exact,parse,inspect,locations,segments,suggest,locateOne,finder,completion,togglePick};
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
  return {create,key,label,lookupLabel,covers,MAX,MAX_PLACES,allowsPlaces,ending,encode,decode,describe};
});
