/* Semantic thumb-index groups and pure physical/digital target layout.
 * Groups describe book names, never page numbers or photographed coordinates.
 * Each group has one physical carrier leaf; its members keep independent
 * navigation depths as pagination changes. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperBookIndexLayout=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDTH=36,HEIGHT=704,DIGITAL_WIDTH=480,ROW=70;
  const TOP=56,BOTTOM=648,SLOT_HEIGHT=8,FINAL_TRACK_OFFSET=20;
  const tracks=Object.freeze([
    {id:'ot-a',testament:'old',rows:11,offset:0,groups:[
      ['GEN'],['EXO'],['LEV'],['NUM'],['DEU'],['JOS'],['JDG'],['RUT'],
      ['1SA','2SA'],['1KI','2KI'],['1CH','2CH']]},
    {id:'ot-b',testament:'old',rows:12,offset:0,groups:[
      ['EZR','NEH'],['EST','JOB'],['PSA','PRO'],['ECC','SNG'],['ISA'],
      ['JER','LAM'],['EZK','DAN'],['HOS','JOL'],['AMO','OBA','JON'],
      ['MIC','NAM','HAB'],['ZEP','HAG'],['ZEC','MAL']]},
    {id:'nt-a',testament:'new',rows:11,offset:0,groups:[
      ['MAT'],['MRK'],['LUK'],['JHN'],['ACT'],['ROM'],['1CO','2CO'],
      ['GAL','EPH'],['PHP','COL'],['1TH','2TH'],['1TI','2TI']]},
    {id:'nt-b',testament:'new',rows:11,offset:FINAL_TRACK_OFFSET,groups:[
      ['TIT','PHM'],['HEB','JAS'],['1PE','2PE'],['1JN','2JN','3JN','JUD'],['REV']]}
  ].map(track=>Object.freeze({...track,groups:Object.freeze(track.groups.map(group=>Object.freeze(group)))})));
  const canonical=Object.freeze(tracks.flatMap(track=>track.groups.flat()));
  const canonicalIndex=new Map(canonical.map((code,index)=>[code,index]));
  const finite=(n,fallback=0)=>Number.isFinite(Number(n))?Number(n):fallback;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const codeOf=book=>String(book?.code||'').toUpperCase();
  function sourceCount(books){
    if(!Array.isArray(books))throw new TypeError('Index layout requires an array of books');
    return Math.max(2,...books.map(book=>Math.max(0,Math.floor(finite(book?.last,finite(book?.first))))+1));
  }
  function semanticPlan(books){
    const codes=books.map(codeOf),positions=codes.map(code=>canonicalIndex.get(code));
    const valid=positions.every((n,i)=>Number.isInteger(n)&&(i===0||n>positions[i-1]));
    if(!valid){
      // Synthetic, unknown or reordered fixtures must remain independently
      // addressable. Never silently discard a book or guess its neighbours.
      return {mode:'fallback-single',groups:books.map((book,i)=>({
        track:'fallback',trackRow:i,trackRows:Math.max(2,books.length),offset:0,
        testament:canonicalIndex.get(codeOf(book))>=39||['NT','new'].includes(book?.testament)?'new':'old',
        indices:[i],codes:[codeOf(book)]
      }))};
    }
    const byCode=new Map(codes.map((code,index)=>[code,index])),groups=[];
    for(const track of tracks)track.groups.forEach((members,trackRow)=>{
      const present=members.filter(code=>byCode.has(code));
      if(present.length)groups.push({track:track.id,trackRow,trackRows:track.rows,offset:track.offset,
        testament:track.testament,indices:present.map(code=>byCode.get(code)),codes:present});
    });
    return {mode:'semantic-tracks',groups};
  }
  function geometry(books,pageCount=sourceCount(books),totalDepth=WIDTH){
    if(!Array.isArray(books))throw new TypeError('Index layout requires an array of books');
    const count=Math.max(2,Math.floor(finite(pageCount,sourceCount(books))));
    const sheets=Math.ceil(count/2),depth=Math.max(.001,finite(totalDepth,WIDTH));
    const labelWidth=Math.min(18,depth),plan=semanticPlan(books),slots=Array(books.length),groups=[];
    for(const definition of plan.groups){
      const index=groups.length,indices=definition.indices,n=indices.length;
      const centerY=TOP+(BOTTOM-TOP)*definition.trackRow/(definition.trackRows-1)+definition.offset;
      const rowHeight=n===1?18:n===2?12:SLOT_HEIGHT;
      const radius=Math.max(13,n*rowHeight/2+1);
      indices.forEach((bookIndex,groupRow)=>{
        const book=books[bookIndex],sheet=clamp(Math.floor(finite(book?.first)/2),0,sheets-1),anchorDepth=sheet/sheets*depth;
        const label=book?.short?String(book.short):[...String(book?.name||'')].slice(0,2).join('');
        const fontSize=Math.min(10,rowHeight*.72,Math.max(.01,labelWidth-1.8)/Math.max(1,[...label].length));
        slots[bookIndex]={index:bookIndex,group:index,groupRow,track:definition.track,trackRow:definition.trackRow,
          testament:definition.testament,sheet,anchorDepth,label,fontSize,
          physical:{x:clamp(anchorDepth-labelWidth/2,0,depth-labelWidth),
            y:centerY+(groupRow-(n-1)/2)*rowHeight-rowHeight/2,width:labelWidth,height:rowHeight},
          digital:{x:23+(bookIndex%2)*221,y:91+Math.floor(bookIndex/2)*ROW,width:212,height:64}};
      });
      const members=indices.map(i=>slots[i]),first=members[0],anchors=members.map(s=>s.anchorDepth);
      const lo=Math.min(...anchors),hi=Math.max(...anchors);
      groups.push({index,first:indices[0],indices:indices.slice(),codes:definition.codes.slice(),
        track:definition.track,trackRow:definition.trackRow,testament:definition.testament,
        x:first.physical.x,y:centerY-radius,width:labelWidth,height:radius*2,
        anchorDepth:first.anchorDepth,carrierSheet:first.sheet,carrierDepth:first.anchorDepth,
        fraction:first.anchorDepth/depth,
        notch:{depth:(lo+hi)/2,y:centerY,radius,span:Math.max(.3,(hi-lo)/2/.7+.1)}});
    }
    return {groups,slots,totalDepth:depth,pageCount:count,totalSheets:sheets,mode:plan.mode,
      digitalHeight:91+Math.ceil(books.length/2)*ROW+38};
  }
  const groupBooks=(books,pageCount,totalDepth)=>geometry(books,pageCount,totalDepth).groups;
  return {WIDTH,HEIGHT,DIGITAL_WIDTH,ROW,TOP,BOTTOM,SLOT_HEIGHT,FINAL_TRACK_OFFSET,tracks,canonical,
    sourceCount,geometry,groupBooks};
});
