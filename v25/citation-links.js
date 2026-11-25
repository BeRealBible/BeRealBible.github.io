/* Recognize scripture in arbitrary prose, independently of where it is read. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25CitationLinks=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const trad=Object.fromEntries([...'創記歷曆詩傳約羅馬書啟啓猶亞彌鴻該瑪賽後門節兩爾紀'].map((c,i)=>[c,[...'创记历历诗传约罗马书启启犹亚弥鸿该玛赛后门节两尔纪'][i]]));
  const english='Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Songs|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation'.split('|');
  const n='[0-9零〇一二两三四五六七八九十百]{1,3}',noMore='(?![0-9零〇一二两三四五六七八九十百])';
  const noDot=String.raw`(?![\d:]|\.\d)`,ord=String.raw`(?:第[ \t]*)?`+n,range='[-–—－～~〜至到]',sep='[、,，]|和|及';
  const join=String.raw`[ \t]*`,chapterUnit='[章篇]',verseUnit='节',hr=join+range+join,chap=ord+join+chapterUnit;
  const between=join+'(?:'+sep+')'+join,list=(ord,unit)=>ord+'(?:'+join+unit+'?'+between+ord+')+'+join+unit;
  const verseList=ord+'(?:'+join+'节?'+join+'(?:'+range+'|'+sep+')'+join+ord+')*'+join+verseUnit;
  const digits=String.raw`\d{1,3}`,cv=digits+join+':'+join+digits;
  const verseNumbers=digits+'(?:'+hr+digits+noDot+')?';
  // A comma may continue a verse list, but an ordinary prose numeral is not a verse.
  const numberTail=between+verseNumbers+String.raw`(?=[ \t]*(?:[、，,;；)）\]】。！？]|$))`;
  const colon=cv+'(?:'+hr+'(?:'+digits+join+':'+join+')?'+digits+')?(?:'+numberTail+')*';
  const chapter=chap+join+'(?:的'+join+')?'+verseList+'|'+ord+join+chapterUnit+'?'+hr+chap+'|'+list(ord,chapterUnit)+'|'+chap;
  const relative='(?:上一章|前一章|前章|下一章|后一章|后章)(?:'+join+'(?:的'+join+')?'+verseList+')?|本章'+join+'(?:的'+join+')?'+verseList;
  const numbered=String.raw`\d+`,cnum=new Map([...'零〇一二两三四五六七八九'].map((c,i)=>[c,[0,0,1,2,2,3,4,5,6,7,8,9][i]]));
  const numbers=text=>[...text.matchAll(new RegExp(n,'gu'))].map(m=>number(m[0]));
  function number(s){
    if(new RegExp('^'+numbered+'$').test(s))return Number(s);
    if(!/[十百]/u.test(s))return Number([...s].map(c=>cnum.get(c)??'').join(''));
    let cur=0,total=0;
    for(const c of s){
      if(c==='十'||c==='百'){total+=(cur||1)*(c==='十'?10:100);cur=0;}
      else cur=cnum.get(c)||0;
    }
    return total+cur;
  }
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Normalize only the scanner's view; retain exact offsets into the original
  // text (including CJK punctuation, full-width digits, and surrogate pairs).
  function normalized(text){
    let value='',start=[],end=[],i=0;
    for(const char of text){
      const s=char.normalize('NFKC').replace(/./gu,c=>trad[c]||c);
      for(let j=0;j<s.length;j++){start.push(i);end.push(i+char.length);}
      value+=s;i+=char.length;
    }
    return {value,start,end};
  }
  const sane=n=>Number.isInteger(n)&&n>0;
  const addressTrad={數:'数',師:'师',結:'结',來:'来',錄:'录',貳:'二',贰:'二',壹:'一',叁:'三',參:'三'};
  const bookKey=name=>normalized(name).value.trim().toLowerCase().replace(/[數師結來錄貳贰壹叁參]/gu,c=>addressTrad[c])
    .replace(/\s*([\p{Script=Han}])\s*/gu,'$1')
    .replace(/^列王记/u,'列王纪').replace(/^历代[记纪]/u,'历代志');
  // Spoken/typed book names belong to the explicit address input. Leave the
  // prose citation scanner conservative so an alias is not a new inline link.
  function addressNames(source,canonical){
    const names=new Map(),standard=new Map();
    const add=(name,code,to=names)=>{
      const key=bookKey(name);if(!key)return;
      if(!to.has(key))to.set(key,new Set());
      to.get(key).add(code);
    };
    for(const [name,code] of canonical){add(name,code,standard);add(name,code);}
    for(const {name,code} of source.books){
      const base=name.replace(/书$/u,'').replace(/福音$/u,'').replace(/[记纪志](?=[上下]?$)/u,'');
      add(base,code);
      if(!name.endsWith('书')){add(name+'书',code);if(base.length>=2)add(base+'书',code);}
      if(/[上下前后]$/u.test(base)){
        // Keep the division when supplied; an undivided title is a group.
        const group=base.slice(0,-1),fullStem=name.replace(/(?:[上下]|[前后]书)$/u,'');
        add(group,code);add(group+'书',code);add(fullStem,code);
        const first=/[上前]$/u.test(base),num=first?'一':'二',digit=first?'1':'2';
        // Require an explicit unit: “列王2:3” is a chapter and verse,
        // not a disguised shortcut for the second volume.
        for(const stem of new Set([group,fullStem]))for(const order of [num,digit,'第'+num,'第'+digit])
          for(const unit of ['书','卷'])add(stem+order+unit,code);
      }
      const epistle=/^约翰([一二三])书$/u.exec(name);
      if(epistle){
        const digit='一二三'.indexOf(epistle[1])+1;
        for(const suffix of [digit,'第'+digit,'第'+epistle[1]])add('约翰'+suffix+'书',code);
      }
    }
    for(const [name,code] of Object.entries({
      路德:'RUT',路德记:'RUT',哀歌:'LAM',启示:'REV',徒行传:'ACT',使徒行:'ACT',使徒:'ACT',
      哥前:'1CO',哥后:'2CO',帖撒前:'1TH',帖撒后:'2TH'
    }))if(source.books.some(book=>book.code===code))add(name,code);
    const bookChoices=name=>{const key=bookKey(name);return [...(standard.get(key)||names.get(key)||[])];};
    const bookCode=name=>{const choices=bookChoices(name);return choices.length===1?choices[0]:undefined;};
    function bookMatches(prefix){
      const key=bookKey(prefix);if(!key)return [];
      const exact=bookChoices(prefix);if(exact.length)return exact;
      const found=new Set();
      for(const [name,codes] of names)if(name.startsWith(key))for(const code of codes)found.add(code);
      return [...found];
    }
    return {bookCode,bookChoices,bookMatches};
  }
  function create(source){
    const aliases=new Map(),books=new Map();
    function alias(name,code){if(name)aliases.set(normalized(name).value.toLowerCase(),code);}
    for(const [i,b] of source.books.entries()){
      books.set(b.code,new Map(b.chapters.map(c=>[Number(c.chapter),c.verses.map(v=>Number(v[0]))])));
      for(const name of [b.name,b.short,b.code,english[i]])alias(name,b.code);
    }
    for(const [name,code] of Object.entries({
      创世纪:'GEN',何西阿:'HOS',撒母耳上:'1SA',撒母耳下:'2SA',撒母耳纪上:'1SA',撒母耳纪下:'2SA',列王上:'1KI',列王下:'2KI',
      历上:'1CH',历下:'2CH',希:'HEB',雅各:'JAS',Psalm:'PSA',Jn:'JHN',Rom:'ROM',Matt:'MAT'
    }))if(books.has(code))alias(name,code);
    const names=[...aliases.keys()].sort((a,b)=>b.length-a.length).map(esc).join('|');
    const oneChapter=[...aliases].filter(([,code])=>books.get(code).size===1).map(([key])=>key).sort((a,b)=>b.length-a.length).map(esc).join('|');
    const wrap=String.raw`[《〈]?(?<name>`+names+String.raw`)[》〉]?`;
    const token=new RegExp([
      '(?<named>'+wrap+join+String.raw`(?:\.[ \t]*)?(?<address>`+colon+noDot+'|'+chapter+'))',
      oneChapter&&'(?<single>[《〈]?(?<singleName>'+oneChapter+')[》〉]?'+join+'(?<singleAddress>'+verseList+'))',
      '(?<bare>(?<![\\d:])'+colon+noDot+')',
      '(?<chapter>(?<![\\d:])(?:'+chapter+'))',
      '(?<relative>'+relative+')',
      '(?<verse>(?<![\\d:])'+verseList+')'
    ].filter(Boolean).join('|'),'giu');
    const fullNames=[...aliases].filter(([name])=>name.length>=3).map(([name])=>name).sort((a,b)=>b.length-a.length).map(esc).join('|');
    const detached=new RegExp('('+fullNames+String.raw`)[》〉]?[ \t]*(?:的(?:相关|平行|对应|相关的)?(?:记载|经文|叙事))?[ \t]*\([ \t]*(?:参见|如|参|见)?[ \t]*$`,'iu');
    const contextJoin=/^[ \t]*(?:[、,;；/]|和|及|与|另见|参见|参|见)+[ \t]*$/u;
    const listSplit=new RegExp('(?:'+sep+')','u');
    const mixed=new RegExp('^('+ord+')'+join+chapterUnit+join+'(?:的'+join+')?('+verseList+')$','u');

    function scan(text,{code:home,chapter:homeChapter,ch=homeChapter}={}){
      if(typeof text!=='string'||!text)return [];
      ch=Number(ch);
      const {value,start,end}=normalized(text),out=[];
      const uris=[...value.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'）)\u3000，。；]+/giu)].map(m=>[m.index,m.index+m[0].length]);
      let previous=null;
      for(const m of value.matchAll(token)){
        const g=m.groups,offset=m.index,finish=offset+m[0].length,before=value.slice(Math.max(0,offset-40),offset),after=value.slice(finish);
        if(uris.some(([a,z])=>offset>=a&&offset<z))continue;
        const named=g.name||g.singleName;
        if(named&&/[a-z\d]/iu.test(named[0])&&/[a-z\d]$/iu.test(before))continue;
        let code=named?aliases.get(named.toLowerCase()):home,chapterNo=ch;
        let v=g.address||g.singleAddress||g.bare||g.chapter||g.verse||g.relative;
        const inherited=!named&&previous&&contextJoin.test(value.slice(previous.end,offset));
        if(inherited){code=previous.code;chapterNo=previous.ch;}
        if(!named&&!inherited&&(g.bare||g.chapter)){
          const hint=detached.exec(before);
          if(hint)code=aliases.get(hint[1].toLowerCase());
        }
        // “但第3章...” is normally a conjunction; “参但3:1” really is Daniel.
        if(named==='但'&&!m[0].startsWith('《')&&!/[参见如按读照自于据例《][ \t]*$/u.test(before)&&
             (/^第/u.test(v)||/^[ \t]*(?:但|却|又|则|也|仍|并|指出)/u.test(after))){
          code=home;
        }
        if(g.relative)code=home;
        if(!named&&g.bare&&(/(?:凌晨|上午|中午|下午|傍晚|晚上|比例|比分)(?:为|是)?[ \t]*$/u.test(before)||
            /^[ \t]*(?:点(?:钟|左右)?|分(?:钟|左右)?|时(?:许|左右)?)/u.test(after)))continue;
        const book=books.get(code);if(!book)continue;
        const refs=[];
        const add=(c,lo,hi=lo)=>{
          const vs=book.get(c);if(!vs?.length)return;
          const actual=lo==null?vs.slice(0,1):vs.filter(v=>v>=lo&&v<=hi);
          if(!actual.length)return;
          // Canonical editions occasionally omit a verse. Include only verses
          // present here, splitting at genuine gaps instead of guessing text.
          let a=actual[0],z=a;
          function push(){refs.push({code,ref:c+':'+a+(z===a?'':'-'+z),whole:lo==null});}
          for(const n of actual.slice(1)){if(n!==z+1){push();a=n;}z=n;}
          push();
        };
        function span(c1,v1,c2,v2){
          if(!book.has(c1)||!book.has(c2)||c2<c1||!sane(v1)||!sane(v2)||(c1===c2&&v2<v1))return;
          for(let c=c1;c<=c2;c++)add(c,c===c1?v1:1,c===c2?v2:Infinity);
          chapterNo=c2;
        }
        function verses(c,s){
          if(!sane(c))return;
          for(const part of s.split(listSplit)){
            const ns=numbers(part);
            if(ns.length&&sane(ns[0])&&ns[0]<=ns.at(-1))add(c,ns[0],ns.at(-1));
          }
        }
        if(g.relative){
          const t=/^(本章|上一章|前一章|前章|下一章|后一章|后章)/u.exec(v)[0];
          chapterNo=ch+(t==='本章'?0:/^[前上]/u.test(t)?-1:1);
          const rest=v.slice(t.length);
          if(rest.includes('节'))verses(chapterNo,rest);
          else add(chapterNo);
        }else if(g.verse||g.single){
          if(g.single)chapterNo=1;
          verses(chapterNo,v);
        }else if(v.includes(':')){
          const parts=v.split(listSplit),head=parts.shift(),ns=numbers(head);
          span(ns[0],ns[1],ns.length===4?ns[2]:ns[0],ns.at(-1));
          for(const p of parts)verses(chapterNo,p);
        }else if(mixed.test(v)){
          const [,c,vs]=mixed.exec(v);
          chapterNo=numbers(c)[0];verses(chapterNo,vs);
        }else{
          const cs=numbers(v);
          if(v.match(new RegExp(range,'u'))&&cs.length===2){
            if(book.has(cs[0])&&book.has(cs[1]))for(let c=cs[0];c<=cs[1];c++)add(c);
          }else for(const c of cs)add(c);
          chapterNo=cs.at(-1);
        }
        if(!refs.length)continue;
        const a=start[offset],z=end[finish-1];
        out.push({start:a,end:z,text:text.slice(a,z),locations:refs});
        previous={code,ch:chapterNo,end:finish};
      }
      return out;
    }
    // Shared renderer: content is always plain text unless a trusted caller
    // supplies a *text* decorator for visual styles such as Markdown emphasis.
    function append(host,text,{context,open,write}={}){
      const doc=host.ownerDocument;
      const emit=write||((node,a,z)=>node.append(doc.createTextNode(text.slice(a,z))));
      if(typeof open!=='function'){emit(host,0,text.length);return;}
      let offset=0;
      for(const ref of scan(text,context)){
        emit(host,offset,ref.start);
        const link=doc.createElement('button');
        link.type='button';link.className='scripture-cite';
        link.setAttribute('aria-label','查看经文 '+ref.text);
        link.setAttribute('aria-expanded','false');
        emit(link,ref.start,ref.end);
        link.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(ref,link);});
        host.append(link);offset=ref.end;
      }
      emit(host,offset,text.length);
    }
    return {scan,append,...addressNames(source,aliases)};
  }
  return {create};
});
