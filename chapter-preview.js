/* A short, literal chapter opening from the canonical source, never a summary.
 * Returned strings are plain text; consumers must render them with textContent. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperChapterPreview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({TARGET_CODE_POINTS:40,MAX_CODE_POINTS:54,MAX_VERSES:2});
  const positiveInteger=value=>{
    if(typeof value!=='number'&&typeof value!=='string')return null;
    if(typeof value==='string'&&!/^\d+$/.test(value.trim()))return null;
    const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;
  };
  const codeOf=value=>typeof value==='string'?value.trim().toUpperCase():'';
  const normalize=text=>text.replace(/\s+/gu,' ').trim();
  function previewChapter(chapter){
    const chapterNumber=positiveInteger(chapter?.chapter);
    if(!chapterNumber||!Array.isArray(chapter?.verses))return null;
    let text='';const included=[];
    for(const verse of chapter.verses.slice(0,constants.MAX_VERSES)){
      if(!Array.isArray(verse)||typeof verse[1]!=='string')continue;
      const number=positiveInteger(verse[0]),part=normalize(verse[1]);
      if(!number||!part)continue;
      text+=part;included.push(number);
      if(Array.from(text).length>=constants.TARGET_CODE_POINTS)break;
    }
    if(!included.length)return null;
    const points=Array.from(text),truncated=points.length>constants.MAX_CODE_POINTS;
    if(truncated)text=points.slice(0,constants.MAX_CODE_POINTS-1).join('')+'…';
    // Normally the opening is verses 1–2. Never imply a missing verse if an
    // unusual source has nonconsecutive opening numbers.
    const verses=included.length===1?String(included[0]):included[1]===included[0]+1?`${included[0]}–${included[1]}`:included.join(',');
    return {text,reference:`${chapterNumber}:${verses}`,truncated};
  }
  function create(source){
    const books=new Map();
    for(const book of Array.isArray(source?.books)?source.books:[]){
      const code=codeOf(book?.code);if(!code||!Array.isArray(book?.chapters))continue;
      const chapters=new Map();
      for(const chapter of book.chapters){const number=positiveInteger(chapter?.chapter);if(number)chapters.set(number,chapter);}
      // Only source-object references are indexed; no full scripture strings
      // are copied, transformed or cached during startup.
      books.set(code,chapters);
    }
    return (bookCode,chapterNumber)=>{
      const number=positiveInteger(chapterNumber),chapter=books.get(codeOf(bookCode))?.get(number);
      return chapter?previewChapter(chapter):null;
    };
  }
  return {create,previewChapter,constants};
});
