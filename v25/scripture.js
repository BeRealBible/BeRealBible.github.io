/* The text edition owns words and verse order. Print data supplies addresses only. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25Scripture=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const parse=ref=>{
    const m=/^(\d+):(\d+)(?:[-–](\d+))?$/.exec(ref||'');
    return m?{ch:+m[1],lo:+m[2],hi:+(m[3]||m[2])}:null;
  };
  const label=(a,b)=>a.ch+':'+a.lo+(a.ch===b.ch&&a.lo===b.hi?'':'–'+(a.ch===b.ch?'':b.ch+':')+b.hi);
  function create(source,paper){
    const books=new Map(source.books.map((book,index)=>[book.code,{...book,index}]));
    const print=new Map((paper?.books||[]).map(b=>[b.code,b]));
    const cache=new Map();
    function index(code){
      if(cache.has(code))return cache.get(code);
      const book=books.get(code);if(!book)return null;
      const printed=print.get(code),rows=[],byRef=new Map(),chunks=[];
      const aliases=new Map();
      for(const [k,end] of Object.entries(printed?.joined||{})){
        const ch=Math.floor(Number(k)/1000),lo=Number(k)%1000;
        for(let v=lo;v<=end;v++)aliases.set(ch+':'+v,{ch,lo,hi:end});
      }
      for(const chapter of book.chapters){
        const ch=Number(chapter.chapter),paras=new Set(chapter.paragraphs||[]),titles=new Map(),text=new Map(chapter.verses);
        for(const [n,t] of chapter.titles||[]){
          const ref=aliases.get(ch+':'+n)?.lo||n;
          if(!titles.has(ref))titles.set(ref,[]);
          if(t?.trim())titles.get(ref).push(t.trim());
        }
        let chunk=null;
        for(const [lo,value] of chapter.verses){
          if(typeof value!=='string'||!value.trim()||value.trim()==='-')continue;
          const ref=ch+':'+lo,join=aliases.get(ref);
          // An edition with real separately numbered bodies keeps them separate.
          const hi=join?.lo===lo&&Array.from({length:join.hi-lo},(_,i)=>text.get(lo+i+1)).every(v=>v?.trim()==='-')?join.hi:lo;
          const page=paper?.lookup?.(code,ref)??null;
          const row={code,name:book.name,short:book.short,ch,lo,hi,ref,id:code+'.'+ref,text:value,page,
            display:label({ch,lo},{ch,hi}),order:rows.length,bookOrder:book.index,titles:titles.get(lo)||[],paragraph:paras.has(lo)};
          // The window buffers canonical chapters within one book. The
          // printed page on a row is only the "show in main book" destination.
          if(!chunk){chunk={chapter:ch,index:chunks.length,rows:[]};chunks.push(chunk);}
          row.chunk=chunk.index;chunk.rows.push(row);rows.push(row);
          for(let v=lo;v<=hi;v++)byRef.set(ch+':'+v,row);
        }
      }
      const data={book,rows,byRef,chunks};cache.set(code,data);return data;
    }
    function resolve(loc){
      const code=loc?.code||loc?.bookCode||paper?.books?.[paper?.pages?.[loc?.page]?.b]?.code;
      const ref=loc?.ref||((loc?.chapter&&loc?.verse)?loc.chapter+':'+loc.verse:paper?.pages?.[loc?.page]?.start);
      const pos=parse(ref),b=index(code);if(!pos||!b)return [];
      const out=[];
      for(let n=pos.lo;n<=pos.hi;n++){
        const row=b.byRef.get(pos.ch+':'+n);if(!row)return [];
        if(out.at(-1)!==row)out.push(row);
      }
      return out;
    }
    function from(locs,sort=false){
      const list=[...new Map(locs.flatMap(loc=>resolve(loc)).map(row=>[row.id,row])).values()];
      return sort?list.sort((a,b)=>a.bookOrder-b.bookOrder||a.order-b.order):list;
    }
    function groups(rows){
      const list=[];
      for(const row of rows){
        const p=list.at(-1),last=p?.at(-1);
        if(last?.code===row.code&&last.order+1===row.order)p.push(row);
        else list.push([row]);
      }
      return list;
    }
    function pinSelection(locs){
      if(locs.some(loc=>!resolve(loc).length))return [];
      const rows=from(locs,true),first=rows[0];
      if(!first)return [];
      // All selections pin just the first continuous run in the first chapter,
      // even when a selected verse immediately follows it in the next chapter.
      const boundary=rows.findIndex((row,i)=>row.code!==first.code||row.ch!==first.ch||row.order!==first.order+i);
      return boundary<0?rows:rows.slice(0,boundary);
    }
    function quote(locs){
      const out=[];
      for(const row of from(locs,true)){
        let part=out.at(-1);
        // Adjacency across chapters still matters to the reading window,
        // but the clipboard gives each chapter its own citation block.
        if(part?.code!==row.code||part.ch!==row.ch){part={code:row.code,name:row.name,ch:row.ch,rows:[]};out.push(part);}
        part.rows.push(row);
      }
      return out.map(({name,ch,rows})=>{
        const runs=groups(rows),names=runs.map((run,i)=>{
          const a=run[0],b=run.at(-1);
          return (i?'':ch+':')+a.lo+(a.lo===b.hi?'':'-'+b.hi);
        });
        return runs.map(run=>run.map(row=>row.text).join('')).join('...')+'\n( '+name+' '+names.join(',')+' 和合本 )';
      }).join('\n\n');
    }
    return {index,resolve,from,groups,pinSelection,quote,label};
  }
  return {create,parse};
});
