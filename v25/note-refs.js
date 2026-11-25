/* Note fields require an exact address, not the looser prose-link scanner. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25NoteRefs=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const MAX=256,delimiter=/[,，;；.。．\r\n]/u,ending=/[,，;；.。．]\s*$/u;
  const normalize=text=>text.normalize('NFKC').replaceAll('節','节').trim();
  const key=({code,ch,lo,hi=lo})=>code+'.'+ch+(lo==null?'':':'+lo+'-'+hi);
  const label=(book,{ch,lo,hi=lo})=>book+' '+ch+(lo==null?'章':':'+lo+(lo===hi?'':'–'+hi));
  const loc=({code,ch,lo,hi=lo})=>({code,ref:ch+':'+lo+(hi===lo?'':'-'+hi)});
  const range='[-–—~〜至到]';
  const verses=String.raw`(\d{1,3})\s*节?(?:\s*`+range+String.raw`\s*(\d{1,3})\s*节?)?`;
  const address=new RegExp(String.raw`^(.{1,40}?)\s*(?:第\s*)?(\d{1,3})(?:(?:\s*:\s*|\s*[章篇]\s*)(?:第\s*)?`+verses+String.raw`|\s*[章篇])?$`,'u');
  const verseRange=new RegExp('^'+verses+'$','u');
  const edition=/\s*(?:和合本(?:修订版)?|新译本|CUV)$/iu;
  const prose=text=>/[\p{Script=Han}]{2}/u.test(text)&&
    !/^(?:[到至章节]|[-–—~〜]|[\p{Script=Han}]{1,10}\s*\d+\s*[:：])/u.test(text.trim());
  function create({bookCode,scripture}){
    function checked(code,ch,lo,hi=lo){
      if(!code||!ch||lo!==undefined&&(!lo||hi<lo))return null;
      if(lo===undefined)return scripture.index(code)?.chunks.some(c=>c.chapter===ch)?{code,ch}:null;
      const ref={code,ch,lo,hi};
      return scripture.resolve(loc(ref)).length?ref:null;
    }
    function exact(value){
      const m=address.exec(normalize(value).replace(/^(?:参见|参|见)\s*/u,''));
      if(!m)return null;
      const [,book,ch,lo,hi]=m;
      return checked(bookCode(book.replace(/^[《〈]|[》〉]$/gu,'')),+ch,lo===undefined?undefined:+lo,hi===undefined?undefined:+hi);
    }
    // The reader copies each quoted chapter with its own terminal attribution:
    // "( 列王纪上 1:15,20 和合本 )". Commas inside it are verse-list syntax.
    function citation(value){
      const parts=value.trim().replace(edition,'').split(/[,、]/u);
      const first=exact(parts.shift());
      if(!first||parts.length&&first.lo==null)return null;
      const refs=[first];
      for(const part of parts){
        const v=verseRange.exec(part.trim());
        const ref=v&&checked(first.code,first.ch,+v[1],v[2]===undefined?undefined:+v[2]);
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
    function parse(value,{pasted=false}={}){
      const raw=normalize(value).replace(/[,;。 .]+$/u,'').trim();
      if(!raw)return [];
      const single=exact(raw);
      if(single)return [single];
      const chunks=raw.split(delimiter).map(s=>s.trim()).filter(Boolean);
      const list=chunks.map(exact);
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
      if(ref.lo!=null)return [loc(ref)];
      const first=scripture.index(ref.code)?.chunks.find(c=>c.chapter===ref.ch)?.rows[0];
      return first?[{...loc(first),whole:true}]:[];
    }
    return {exact,parse,locations};
  }
  return {create,key,label,MAX,ending};
});
