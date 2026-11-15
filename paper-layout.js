/* Semantic text -> deterministic, viewport-independent paper pages.
 * Only reusable typographic rules live here: no verse-specific coordinates,
 * scanned line breaks, or original-edition page mapping. Source poetic lines
 * are semantic blocks; a shared indentation/wrapping rule lays them out.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperLayout=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({
    PAGE_WIDTH:480,PAGE_HEIGHT:704,CELL:12,COLUMN_CELLS:16,COLUMN_WIDTH:192,
    COLUMN_X:Object.freeze([48,264]),COLUMN_X_LEFT:Object.freeze([48,264]),COLUMN_X_RIGHT:Object.freeze([24,240]),BODY_SIZE:12,HEADING_SIZE:12,
    LINE_HEIGHT:60/41.25*12,BODY_FIRST_BASELINE:70,BOOK_HEADING_BASELINE:70+4*(60/41.25*12),
    BODY_LINES:36,OPENING_RESERVED_LINES:4,
    BOTTOM_BASELINE:70+35*(60/41.25*12),CHAPTER_SIZE:30,CHAPTER_LINES:2,CHAPTER_CELLS:3,
    // Use the bundled font's lining figures, not Georgia's descending 3/9.
    // Two chapter digits occupy three body cells; three digits get more room.
    CHAPTER_BASELINE_RISE:0,CHAPTER_DIGIT_WIDTH:.56,CHAPTER_SIDE_GAP:2.4,
    VERSE_SIZE:10.5,VERSE_RISE:3,PARAGRAPH_INDENT:2,SPACE_CELLS:.35,
    // The donor marks q, not q1/q2 levels. These are uniform print rules,
    // not fabricated source indentation levels or stored physical line ends.
    POETRY_INDENT:2,POETRY_CONTINUATION_INDENT:3,
    HEADING_GAP_LINES:1,CHAPTER_GAP_LINES:1
  });
  const CLOSED=new Set([...',.;:!?，。；：！？、）］｝〉》」』”’％%…']);
  const OPEN=new Set([...'（［｛〈《「『“‘']);
  const QUOTES=new Set([...'“”‘’「」『』']);
  const PUNCT=new Set([...'，。；：！？、（）［］｛｝〈〉《》「」『』“”‘’']);
  const FLEX=new Set([...'，；：、（）［］｛｝〈〉《》']);
  const END_BEARING=new Set([...'，。；：、）］｝〉》」』”’']);
  const EPS=1e-7;
  const ref=(chapter,verse)=>String(chapter)+':'+String(verse);
  function characterWidth(char,C=constants){
    // Glyphs retain their natural aspect ratio. Widths reserve layout slots;
    // they never become a textLength/maxWidth/horizontal scaling instruction.
    if(char===' '||char==='\t')return C.CELL*C.SPACE_CELLS;
    if(QUOTES.has(char))return C.CELL*.5;
    if(char.charCodeAt(0)<127)return C.CELL*.5;
    return C.CELL;
  }
  function boundaryAllowed(tokens,at){
    if(at<=0||at>=tokens.length)return at>0;
    const prev=tokens[at-1],next=tokens[at];
    // A verse label followed only by its 神-version prefix is still orphaned.
    // Ordinary preserved source spaces are not globally made nonbreaking.
    const orphanPrefix=/^[\s　]$/u.test(prev.text)&&tokens[at-2]?.kind==='verse';
    return prev.kind!=='verse'&&!OPEN.has(prev.text)&&!orphanPrefix&&!CLOSED.has(next.text);
  }
  function lineMeasure(tokens,start,end,C,hangingFirst=false){
    const widths=[],minimum=[];
    for(let i=start;i<end;i++){
      const t=tokens[i];let width=t.width,min=width;
      if(t.kind==='body'&&PUNCT.has(t.text)){
        // Adjacent punctuation shares its side bearings. The ink itself is
        // never scaled: opening marks are translated inside the shorter slot.
        const before=tokens[i-1]?.text,after=tokens[i+1]?.text;
        const paired=CLOSED.has(t.text)&&(CLOSED.has(after)||CLOSED.has(before)&&QUOTES.has(before));
        if(paired)width=Math.min(width,C.CELL*.5);
        // Exclamation/question marks keep a full cell at a bare line end;
        // the print sample does not squeeze them like commas and stops.
        min=FLEX.has(t.text)||i===end-1&&END_BEARING.has(t.text)?Math.min(width,C.CELL*.5):width;
      }
      if(hangingFirst&&i===start&&t.kind==='verse')width=min=0;
      widths.push(width);minimum.push(min);
    }
    return {widths,minimum,used:widths.reduce((a,b)=>a+b,0),minUsed:minimum.reduce((a,b)=>a+b,0)};
  }
  function takeLine(tokens,start,capacity,C=constants,hangingFirst=false){
    let end=start,lastFit=start;
    for(let candidate=start+1;candidate<=tokens.length;candidate++){
      const m=lineMeasure(tokens,start,candidate,C,hangingFirst);
      // Do not pack another ordinary ideograph merely because punctuation
      // could be squeezed. Use bearing compression to absorb a closing mark
      // or finish the semantic paragraph/poem; otherwise keep the full grid.
      const absorbMark=CLOSED.has(tokens[candidate-1].text)||candidate===tokens.length;
      if(m.used<=capacity+EPS||absorbMark&&m.minUsed<=capacity+EPS){
        lastFit=candidate;if(boundaryAllowed(tokens,candidate))end=candidate;
      }
      // Only the last mark can recover an extra half cell in a longer line.
      if(m.minUsed>capacity+C.CELL*.5+EPS)break;
    }
    if(end===start)end=Math.max(start+1,lastFit);
    const m=lineMeasure(tokens,start,end,C,hangingFirst);
    return {end,used:Math.min(m.used,Math.max(capacity,m.minUsed)),overflow:m.minUsed>capacity+EPS};
  }
  function token(kind,text,address,C){
    return {kind,text,ref:address,width:kind==='verse'?Math.max(.5,[...text].length*.5)*C.CELL:characterWidth(text,C)};
  }
  function blocksForBook(book,C){
    const blocks=[];
    for(const chapter of book.chapters){
      const number=chapter.chapter,titles=new Map(),paragraphs=new Set((chapter.paragraphs||[]).map(String));
      const breaks=new Map();
      for(const [field,gap] of [['paragraphBreaks',false],['stanzaBreaks',true]])for(const item of chapter[field]||[]){
        const key=String(item.verse)+':'+item.offset;
        if(!Number.isInteger(item.offset)||item.offset<0)throw new TypeError('Invalid semantic paragraph offset');
        breaks.set(key,{gap:gap||breaks.get(key)?.gap});
      }
      const rubric=chapter.superscription||'';
      if(rubric&&!String(chapter.verses[0]?.[1]).startsWith(rubric))throw new TypeError('Superscription must be an unchanged leading source slice');
      for(const [verse,text] of chapter.titles||[]){
        const k=String(verse);if(!titles.has(k))titles.set(k,[]);titles.get(k).push(String(text));
      }
      const poetry=new Map();
      const verseTexts=new Map(chapter.verses.map(([v,t])=>[String(v),String(t)]));
      for(const entry of chapter.poetry||[]){
        const key=String(entry.verse);
        if(poetry.has(key)||!verseTexts.has(key)||!Array.isArray(entry.segments)||!entry.segments.length)
          throw new TypeError('Invalid poetry entry: '+book.code+' '+number+':'+key);
        for(const segment of entry.segments){
          if(!['prose','poetry'].includes(segment.kind)||typeof segment.text!=='string'||
            segment.kind==='poetry'&&(typeof segment.line!=='string'||!segment.line))
            throw new TypeError('Invalid poetry segment: '+book.code+' '+number+':'+key);
        }
        if(entry.segments.map(s=>s.text).join('')!==verseTexts.get(key))
          throw new TypeError('Poetry structure must preserve scripture text: '+book.code+' '+number+':'+key);
        poetry.set(key,entry.segments);
      }
      let current=null,first=true;
      const flush=()=>{if(current?.tokens.length)blocks.push(current);current=null;};
      for(const [verse,raw] of chapter.verses){
        const address=ref(number,verse),heads=titles.get(String(verse));
        if(heads){flush();for(const text of heads)blocks.push({kind:'heading',text,ref:address});}
        if(paragraphs.has(String(verse)))flush();
        const segments=poetry.get(String(verse))||[{kind:'prose',text:String(raw)}];
        let markerPending=!first||String(verse)!=='1';
        let verseOffset=0;
        for(const segment of segments){
          const chars=[...segment.text],points=new Set([0,chars.length]);
          for(let at=0;at<=chars.length;at++)if(breaks.has(String(verse)+':'+(verseOffset+at)))points.add(at);
          const rubricLength=first&&rubric?[...rubric].length:0;
          if(rubricLength>verseOffset&&rubricLength<verseOffset+chars.length)points.add(rubricLength-verseOffset);
          const ordered=[...points].sort((a,b)=>a-b);
          for(let i=0;i<ordered.length-1;i++){
            const a=ordered[i],z=ordered[i+1];if(a===z)continue;
            const offset=verseOffset+a,semanticBreak=breaks.get(String(verse)+':'+offset);
            if(semanticBreak){flush();if(semanticBreak.gap)blocks.push({kind:'stanza',ref:address});}
            const text=chars.slice(a,z).join('');
            if(first&&rubric&&offset<rubricLength){
              flush();blocks.push({kind:'rubric',chapter:null,ref:address,tokens:[...text].map(ch=>token('body',ch,address,C))});
              continue;
            }
            const kind=segment.kind==='poetry'?'poetry':'body',line=kind==='poetry'?segment.line:null;
            if(current&&(current.kind!==kind||kind==='poetry'&&current.line!==line))flush();
            if(!current)current={kind,line,chapter:first?number:null,ref:address,tokens:[]};
            if(markerPending){current.tokens.push(token('verse',String(verse),address,C));markerPending=false;}
            for(const ch of text)current.tokens.push(token('body',ch,address,C));
            first=false;
          }
          verseOffset+=chars.length;
        }
        first=false;
      }
      flush();
    }
    return blocks;
  }
  function layoutRuns(tokens,start,end,indent,capacity,y,lastLine,C,hangingFirst=false){
    const metrics=lineMeasure(tokens,start,end,C,hangingFirst),widths=metrics.widths;
    const shortage=Math.max(0,metrics.used-capacity),flex=metrics.used-metrics.minUsed;
    if(shortage&&flex>0)for(let i=0;i<widths.length;i++)widths[i]-=(widths[i]-metrics.minimum[i])*Math.min(1,shortage/flex);
    const used=widths.reduce((a,b)=>a+b,0);
    const gap=lastLine||end-start<2?0:Math.max(0,(capacity-used)/(end-start-1-(hangingFirst?1:0)));
    const runs=[];let x=indent,body=null;
    for(let i=start;i<end;i++){
      const t=tokens[i],hanging=hangingFirst&&i===start&&t.kind==='verse';
      const width=widths[i-start],advance=width+(i<end-1&&!hanging?gap:0);
      if(t.kind==='body'){
        if(!body){body={kind:'body',text:'',x,width:0,size:C.BODY_SIZE,y,advances:[],offsets:[]};runs.push(body);}
        body.text+=t.text;body.advances.push(advance);body.width+=advance;
        body.offsets.push(OPEN.has(t.text)?Math.min(0,width-C.CELL):0);
      }else{
        body=null;
        runs.push({kind:'verse',text:t.text,x:hanging?indent-Math.max(C.CELL,t.width):x,width:hanging?t.width:advance,
          size:C.VERSE_SIZE,y:y-C.VERSE_RISE,ref:t.ref,hanging});
      }
      x+=advance;
    }
    return {runs,justified:gap>EPS,gap,used,x,compressed:shortage>EPS};
  }
  function headingLines(text,C){
    // A semantic title may itself contain an explicit subtitle separator.
    // Respect that source newline; it is not a transcription of printed lines.
    const result=[];
    for(const part of text.split(/\r\n|\r|\n/)){
      if(!part){result.push([]);continue;}
      const ts=[...part].map(ch=>token('body',ch,'',C));
      for(let at=0;at<ts.length;){const line=takeLine(ts,at,C.COLUMN_WIDTH,C);result.push(ts.slice(at,line.end));at=line.end;}
    }
    return result;
  }
  function chapterReserve(chapter,C){
    return Math.max(C.CHAPTER_CELLS*C.CELL,[...String(chapter)].length*C.CHAPTER_SIZE*C.CHAPTER_DIGIT_WIDTH+C.CHAPTER_SIDE_GAP);
  }
  function keepWithBodyRows(blocks,from,C){
    // Measure the first two actual scripture rows, including semantic gaps
    // between short poem lines. A fixed two-slot lookahead is insufficient
    // when a stanza break follows a one-line opening under a drop capital.
    let slots=0,bodies=0,remaining=0,reserve=0,previous='heading';
    const finish=()=>{slots+=remaining;remaining=0;};
    for(let i=from;i<blocks.length;i++){
      const b=blocks[i];
      if(b.kind==='stanza'){finish();if(previous==='body')slots++;continue;}
      if(b.kind==='heading'){finish();slots+=C.HEADING_GAP_LINES+headingLines(b.text,C).length;previous='heading';continue;}
      const rubric=b.kind==='rubric',poetry=b.kind==='poetry';
      if(b.chapter!==null){finish();if(previous==='body')slots+=C.CHAPTER_GAP_LINES;remaining=C.CHAPTER_LINES;reserve=chapterReserve(b.chapter,C);}
      for(let at=0,row=0;at<b.tokens.length;row++){
        const normal=rubric?0:(poetry?(row?C.POETRY_CONTINUATION_INDENT:C.POETRY_INDENT):(row?0:C.PARAGRAPH_INDENT))*C.CELL;
        const hanging=normal>0&&b.tokens[at].kind==='verse';
        const label=hanging?Math.max(C.CELL,b.tokens[at].width):0;
        const indent=remaining?Math.max(reserve+label,normal):normal;
        at=takeLine(b.tokens,at,C.COLUMN_WIDTH-indent,C,hanging).end;
        slots++;if(remaining)remaining--;
        if(!rubric&&++bodies>=2)return slots;
      }
      previous=rubric?'rubric':'body';
    }
    return slots;
  }
  function paginate(source,options={}){
    if(!source||!Array.isArray(source.books)||!source.books.length)throw new TypeError('A semantic Bible source is required');
    const C=Object.freeze({...constants,...options,COLUMN_X:options.COLUMN_X||constants.COLUMN_X});
    if(!(C.CELL>0&&C.LINE_HEIGHT>0&&C.COLUMN_WIDTH>C.CELL*6&&C.BOTTOM_BASELINE>C.BOOK_HEADING_BASELINE+C.LINE_HEIGHT*4))throw new RangeError('Invalid paper layout rules');
    const pages=[],books=[],warnings=[];
    const stats={books:source.books.length,chapters:0,verses:0,bodyCharacters:0,headings:0,bodyRows:0,headingRows:0,
      poetryLines:0,poetryRows:0,poetryVerses:0,poetryBooks:0};
    const poetryLineIds=new Set(),poetryBookIds=new Set();
    let page=null,column=0,y=0,bookIndex=-1,chapterSet=null,dropCap=null,testamentStart=1,testament='OT';
    const addSpecial=(name,blank=false)=>{
      pages.push({b:blank?Math.min(source.books.length-1,Math.max(0,bookIndex)):-1,title:'',frontmatter:blank?'':name,blank,
        layoutVersion:2,columnX:C.COLUMN_X,start:'',end:'',cols:[[],[]],displayPage:''});
    };
    addSpecial('旧约全书');
    function newPage(opening=false){
      page={b:bookIndex,title:opening?source.books[bookIndex].name:'',layoutVersion:2,
        columnX:options.COLUMN_X||((pages.length%2)?C.COLUMN_X_RIGHT:C.COLUMN_X_LEFT),
        start:'',end:'',cols:[[],[]],displayPage:pages.length-testamentStart+1,testament,
        opening,bodyTop:opening?C.BOOK_HEADING_BASELINE:C.BODY_FIRST_BASELINE};
      pages.push(page);column=0;y=page.bodyTop;
    }
    function nextColumn(){
      if(column===0){column=1;y=page.bodyTop;}else newPage(false);
    }
    function ensure(extra=0){if(y+extra>C.BOTTOM_BASELINE+EPS)nextColumn();}
    function previousKind(){const rows=page.cols[column];return rows.length?rows[rows.length-1].kind:null;}
    function pushRow(row){
      page.cols[column].push(row);
      if(row.kind==='body'){
        if(!page.start)page.start=row.start;page.end=row.end;
        stats.bodyRows++;
        if(row.poetry)stats.poetryRows++;
      }else stats.headingRows++;
      y+=C.LINE_HEIGHT;
    }
    // A short first poem line must not skip the next line just because the
    // drop cap is two rows high. Carry its exclusion slot across body blocks.
    function finishDropCap(){
      if(dropCap?.remaining)y+=dropCap.remaining*C.LINE_HEIGHT;
      dropCap=null;
    }
    for(bookIndex=0;bookIndex<source.books.length;bookIndex++){
      const book=source.books[bookIndex];
      if(book.code==='MAT'){
        // Each new part has a recto title leaf, a blank verso, and scripture
        // on the next recto. No particular book's printed page is hardcoded.
        if(pages.length%2===0)addSpecial('',true);
        addSpecial('新约全书');addSpecial('',true);
        testamentStart=pages.length;testament='NT';
      }
      const meta={code:book.code,name:book.name,short:book.short,first:pages.length,last:pages.length,chapters:[]};
      books.push(meta);chapterSet=new Set();dropCap=null;newPage(true);
      stats.chapters+=book.chapters.length;
      for(const ch of book.chapters){
        stats.poetryVerses+=(ch.poetry||[]).length;
        for(const [,text] of ch.verses){stats.verses++;stats.bodyCharacters+=[...String(text)].length;}
      }
      const blocks=blocksForBook(book,C);
      for(let blockIndex=0;blockIndex<blocks.length;blockIndex++){
        const block=blocks[blockIndex];
        if(block.kind==='stanza'){
          finishDropCap();if(previousKind()==='body')y+=C.LINE_HEIGHT;ensure();continue;
        }
        if(block.kind==='heading'){
          finishDropCap();
          stats.headings++;
          const lines=headingLines(block.text,C);
          let gap=previousKind()?C.HEADING_GAP_LINES*C.LINE_HEIGHT:0;
          // Keep a complete heading and at least two body rows together. If a
          // custom rule makes that impossible, fail instead of silently spill.
          // Include intervening superscriptions / consecutive headings in
          // the keep-with-next group, so their own chapter safeguard cannot
          // strand this heading at the foot of the preceding column.
          const followingRows=keepWithBodyRows(blocks,blockIndex+1,C);
          const required=(lines.length+followingRows-1)*C.LINE_HEIGHT;
          if(required>C.BOTTOM_BASELINE-C.BODY_FIRST_BASELINE)throw new RangeError('Heading too tall for one paper column');
          if(y+gap+required>C.BOTTOM_BASELINE+EPS){nextColumn();gap=0;}
          y+=gap;
          lines.forEach((ts,i)=>{
            const laid=layoutRuns(ts,0,ts.length,0,C.COLUMN_WIDTH,y,true,C);
            const run=laid.runs[0]||{text:'',x:0,width:0,advances:[],offsets:[]};
            pushRow({kind:'heading',y,start:block.ref,end:block.ref,titleStart:i===0,
              runs:[{...run,kind:'heading',size:C.HEADING_SIZE,y,weight:'bold'}]});
          });
          continue;
        }
        const isChapter=block.chapter!==null;
        const isPoetry=block.kind==='poetry',isRubric=block.kind==='rubric';
        if(isRubric){
          // A superscription belongs with its chapter, never alone at the
          // foot of a column. It is still original body text, not a new title.
          let n=0;for(let a=0;a<block.tokens.length;n++)a=takeLine(block.tokens,a,C.COLUMN_WIDTH,C).end;
          ensure((n+C.CHAPTER_LINES-1)*C.LINE_HEIGHT);
        }
        if(isPoetry){poetryLineIds.add(book.code+':'+block.line);poetryBookIds.add(book.code);}
        if(isChapter){
          finishDropCap();
          if(previousKind()==='body'&&!page.cols[column].at(-1)?.rubric)y+=C.CHAPTER_GAP_LINES*C.LINE_HEIGHT;
          ensure((C.CHAPTER_LINES-1)*C.LINE_HEIGHT);
          const reserve=chapterReserve(block.chapter,C);
          if(reserve>=C.COLUMN_WIDTH-C.CELL*2)throw new RangeError('Chapter number leaves no text width');
          dropCap={reserve,remaining:C.CHAPTER_LINES};
          if(!chapterSet.has(block.chapter)){meta.chapters.push({chapter:block.chapter,page:pages.length-1});chapterSet.add(block.chapter);}
        }
        let at=0,rowIndex=0;
        while(at<block.tokens.length){
          ensure();
          const normalIndent=isRubric?0:isPoetry?(rowIndex===0?C.POETRY_INDENT:C.POETRY_CONTINUATION_INDENT)*C.CELL:
            rowIndex===0?C.PARAGRAPH_INDENT*C.CELL:0;
          const hangingFirst=normalIndent>0&&block.tokens[at].kind==='verse';
          const labelRoom=hangingFirst?Math.max(C.CELL,block.tokens[at].width):0;
          const indent=dropCap?.remaining?Math.max(dropCap.reserve+labelRoom,normalIndent):normalIndent;
          const capacity=C.COLUMN_WIDTH-indent;
          const line=takeLine(block.tokens,at,capacity,C,hangingFirst);
          // Short final poetic lines stay ragged. A wrapped line follows the
          // same bearing compression and justification rules as print prose.
          const row=layoutRuns(block.tokens,at,line.end,indent,capacity,y,line.end===block.tokens.length,C,hangingFirst);
          if(line.overflow)warnings.push({type:'line-overflow',book:book.code,ref:block.tokens[at].ref,page:pages.length-1,column});
          if(isChapter&&rowIndex===0)row.runs.unshift({kind:'chapter',text:String(block.chapter),x:0,width:dropCap.reserve-C.CHAPTER_SIDE_GAP,
            size:C.CHAPTER_SIZE,y:y+(C.CHAPTER_LINES-1)*C.LINE_HEIGHT-C.CHAPTER_BASELINE_RISE,ref:block.ref});
          pushRow({kind:'body',y,runs:row.runs,start:block.tokens[at].ref,end:block.tokens[line.end-1].ref,
            indent,justified:row.justified,gap:row.gap,compressed:row.compressed,rubric:isRubric,
            ...(isPoetry?{poetry:true,poetryLine:block.line,poetryContinuation:rowIndex>0,poetryLast:line.end===block.tokens.length}:{})});
          if(dropCap?.remaining)dropCap.remaining--;
          at=line.end;rowIndex++;
        }
      }
      meta.last=pages.length-1;
    }
    if(pages.length%2)addSpecial('',true);
    stats.poetryLines=poetryLineIds.size;stats.poetryBooks=poetryBookIds.size;
    return {edition:source.edition||'rules-1',layoutVersion:2,books,pages,stats,warnings,
      layoutRules:C,notice:'统一规则文本试排；已有诗行按语义分行，页底引注未补齐，页码不等同纸本。'};
  }
  return {constants,characterWidth,boundaryAllowed,takeLine,headingLines,paginate};
});
