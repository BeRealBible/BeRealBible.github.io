/* Link the edition's heading references to their existing ink, never reflowing the page. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.V25Parallels=factory();
})(globalThis,function(){
  'use strict';
  const norm=s=>s.normalize('NFKC').replace(/\s/gu,'').replace(/[—–－]/gu,'-');
  function targets(page,tags,book,source){
    if(!page||!book)return [];
    const words=page[3],heads=new Map(),out=[];
    tags.forEach((t,i)=>{if(t.role==='heading'){if(!heads.has(t.ref))heads.set(t.ref,[]);heads.get(t.ref).push(i);}});
    // A mid-verse heading can be tagged as body. Require a complete match
    // of its printed title AND citations before synthesizing any hit area.
    let pageLine,starts;
    for(const ch of new Set(tags.filter(t=>t.role==='body').map(t=>Number(t.ref.split(':')[0])))){
      for(const [v,title] of book.chapters[ch-1]?.titles||[]){
        const key=ch+':'+v,m=/^([^（）()]*)[（(]([^（）()]*\d[^（）()]*)[）)]/u.exec(title);
        if(!m||heads.has(key))continue;
        if(!starts){starts=[];pageLine=words.map((w,i)=>{const s=norm(w[4]);for(let j=0;j<s.length;j++)starts.push(i);return s;}).join('');}
        const pattern=norm(m[0]),at=pageLine.indexOf(pattern);
        if(at>=0&&at===pageLine.lastIndexOf(pattern))heads.set(key,[starts[at],starts[at+pattern.length-1]]);
      }
    }
    let sourceRef;
    const rect=(cells,citation)=>{
      let row=[];
      function emit(){if(!row.length)return;const x=Math.min(...row.map(w=>w[0])),y=Math.min(...row.map(w=>w[1])),r=Math.max(...row.map(w=>w[0]+w[2])),b=Math.max(...row.map(w=>w[1]+w[3]));out.push({sourceRef,citation,x:x-1,y:y-2,width:r-x+2,height:b-y+4});row=[];}
      for(const w of cells){if(row.length&&(w[0]<row.at(-1)[0]-3||Math.abs(w[1]-row[0][1])>34))emit();row.push(w);}emit();
    };
    for(const [ref,ids] of heads){
      sourceRef=ref;const [ch,v]=ref.split(':').map(Number);
      for(const [n,title] of book.chapters[ch-1]?.titles||[]){
        const m=/[（(]([^（）()]*\d[^（）()]*)[）)]/u.exec(title);
        if(n!==v||!m)continue;
        let inherited=book;
        const parts=norm(m[1]).split(';').map(raw=>{
          const named=source.books.find(b=>raw.startsWith(b.short)&&!source.books.some(c=>c.short.length>b.short.length&&raw.startsWith(c.short)));
          if(named)inherited=named;
          let citation=named?raw:inherited.short+raw;
          const chapter=/^\d+$/.test(raw.slice(named?.short.length||0))&&inherited.chapters[Number(raw.slice(named?.short.length||0))-1];
          if(chapter)citation+=':1-'+chapter.verses.at(-1)[0];
          return {raw,citation};
        });
        // The reference numerals often have role "other". Read the sealed OCR
        // sequence in proximity to the tagged heading, including those digits.
        const lo=Math.max(0,ids[0]-3),hi=Math.min(words.length,ids.at(-1)+18);
        const chars=[],at=[];
        for(let i=lo;i<hi;i++)for(const c of norm(words[i][4])){chars.push(c);at.push(i);}
        const line=chars.join('');
        // The bound edition of Mark 10 prints Matthew 19:1–12, not 19:1–2
        // as in the semantic heading. Require the actual complete printed group.
        if(page[0]===1004&&parts[0]?.raw==='太19:1-2'&&line.includes('(太19:1-12;路16:18)'))
          parts[0]={raw:'太19:1-12',citation:'太19:1-12'};
        const pattern='('+parts.map(p=>p.raw).join(';')+')',punct=s=>s.replace(/[、,;]/g,';');
        const start=punct(line).indexOf(punct(pattern));
        if(start!==-1){
          let k=start+1;
          for(const p of parts){rect(words.slice(at[k],at[k+p.raw.length-1]+1),p.citation);k+=p.raw.length+1;}
        }else{
          // If OCR lost a dash/number, never infer a verse from the damaged
          // ink. The tagged heading still identifies a checked source title.
          const head=norm(title.slice(0,m.index)),printed=ids.map(i=>norm(words[i][4])).join('');
          if(!head||!printed.startsWith(head))continue;
          const last=ids.at(-1),tail=words[last],parens=ids.find(i=>norm(words[i][4]).includes('('));
          const close=words.findIndex((w,i)=>i>=last&&i<hi&&norm(w[4]).includes(')')&&Math.abs(w[1]-tail[1])<42);
          const cells=parens!==undefined&&close>=parens?words.slice(parens,close+1):ids.map(i=>words[i]);
          rect(cells,parts.map(p=>p.citation).join(';'));
        }
      }
    }
    return out;
  }
  return {targets};
});
