const fs=require('node:fs'),a=require('node:assert/strict'),vm=require('node:vm');
const drawn=[],measured=[],rects=[];
const c={font:'',measureText(text){measured.push([text,this.font]);return {actualBoundingBoxLeft:1,actualBoundingBoxRight:/SimHei/.test(this.font)?49:99,actualBoundingBoxAscent:70,actualBoundingBoxDescent:5}},save(){},restore(){},setTransform(){},createLinearGradient(){return {addColorStop(){}}},fillRect(...r){rects.push(r)},transform(){},fillText(text){drawn.push([text,this.font])}};
const page=[3,480,704,[[0,0,20,20,'神'],[22,0,20,20,'神'],[44,0,20,20,'章'],[66,0,20,20,'言'],[88,0,20,20,'①']],[[0,22,42,2],[53,33,3,4]],{label:[[450,30,20,20,'頁邊標籤']]}];
const tags=[{role:'heading',ref:'GEN.1.1'},{role:'body',ref:'GEN.1.1'},{role:'chapter'},{role:'other'},{role:'heading'}];
const window={PaperPage:{svg(){return 'legacy'}},V25OriginalData:{pages:[],get:i=>i===3?page:null,tags:()=>tags}};
vm.runInNewContext(fs.readFileSync(process.argv[2]||'v25-original-render.js','utf8'),{window,document:{createElement:()=>({getContext:()=>c})}});
const api=window.PaperPage,physical={pdfPage:3},books=[];
const [heading,body,chapter,other,note]=api.commands(physical,3,books);
a.match(heading.family,/^"PaperHeading"/);a.match(body.family,/^"SimSun"/);a.equal(heading.weight,600);a.equal(body.weight,400);a.equal(chapter.family,body.family);a.equal(other.family,body.family);a.equal(note.family,'PaperRares');
a.notEqual(heading.sx,body.sx);a.equal(heading.ref,body.ref);a.equal(heading.w,body.w);a.equal(heading.h,body.h);
a.deepEqual(measured.filter(([t])=>t==='神').map(([,f])=>f),['600 100px '+heading.family,'100px '+body.family]);
const svg=api.svg(physical,3,books);
a.match(svg,/data-role="heading"[^>]*font-family="&quot;PaperHeading&quot;[^>]*font-weight="600"/);a.match(svg,/data-role="body"[^>]*font-family="&quot;SimSun&quot;/);a.doesNotMatch(svg,/font-weight="bold"/);
api.paint({getContext:()=>c},physical,3,books,1);a.deepEqual(drawn.slice(0,2),[['神','600 100px '+heading.family],['神','100px '+body.family]]);
a.doesNotMatch(svg,/x="0" y="22" width="42" height="2"/);
a.match(svg,/x="53" y="33" width="3" height="4"/);
a.deepEqual(rects,[[0,0,480,704],[53,33,3,4]],'static SVG and turning canvas retain non-horizontal ink, not source rules');
a.deepEqual(page[4],[[0,22,42,2],[53,33,3,4]],'source rectangles are preserved');
a.equal(api.svg({},99,books),'legacy');
a.doesNotMatch(svg,/book-tab-label|頁邊標籤/);a.equal(drawn.length,5);
// All reviewed overrides must point to a real frame in the unchanged edition.
const rt={window:{PaperPage:{}},atob,document:{createElement:()=>({getContext:()=>c})}};
for(const f of ['v25-original-data.js','v25-heading-frames.js','v25-original-render.js']) vm.runInNewContext(fs.readFileSync(f,'utf8'),rt);
const store=rt.window.V25OriginalData, classify=rt.window.V25HeadingFrames.classify, totals={hei:0,song:0};
for(const [k,file] of Object.entries(store.packs))store.installPack(k,JSON.parse(fs.readFileSync('paper-pages/'+file,'utf8')));
for(let i=1;i<=store.count;i++){
  const page=store.get(i);if(!page)continue;
  const tags=store.tags(i);
  page[3].forEach((w,n)=>{
    const change=classify(store.sha,i,n,w);
    if(change===undefined)return;
    a.notEqual(change,tags[n].role==='heading');
    a.equal(classify(store.sha,i,n,[w[0]+1,...w.slice(1)]),undefined);
    totals[change?'hei':'song']++;
  });
}
a.deepEqual(totals,{hei:131,song:4643+135});
const jacobPage=store.lookup('GEN','33:1'),jacobLine=[1020,1682,82,2],containsLine=p=>p[4].some(r=>r.every((v,i)=>v===jacobLine[i]));
a.ok(containsLine(store.get(jacobPage)));
a.doesNotMatch(rt.window.PaperPage.svg(store.pages[jacobPage],jacobPage,store.books),/x="1020" y="1682" width="82" height="2"/);
rects.length=0;rt.window.PaperPage.paint({getContext:()=>c},store.pages[jacobPage],jacobPage,store.books,1);
a.deepEqual(rects,[[0,0,480,704]],'Jacob underline is also absent in the turning canvas');
a.ok(containsLine(store.get(jacobPage)));
for(const [p,i,lit,expected] of [[546,5,'颂',600],[953,11,'路',400],[659,19,'新',400],[1146,367,'爱',600]]){
  const cmd=rt.window.PaperPage.commands({pdfPage:p},p,[])[i],w=store.get(p)[3][i];
  a.equal(cmd.text,lit);a.equal(cmd.weight,expected);a.equal(cmd.box,w);
  a.equal(cmd.role,store.tags(p)[i].role);a.equal(cmd.ref,store.tags(p)[i].ref);
  a.equal(classify('other edition',p,i,w),undefined);
}
for(const [p,i,expected] of [[354,5,'34'],[355,0,'34'],[368,6,'360'],[385,529,'77'],[1244,3,'29']]){
  const before=store.get(p)[3][i],cmd=rt.window.PaperPage.commands({pdfPage:p},p,[])[i];
  a.equal(cmd.text,expected);a.equal(cmd.role,'other');a.deepEqual(Array.from(cmd.box.slice(0,4)),Array.from(before.slice(0,4)));
  a.notEqual(before[4],expected);
  a.match(rt.window.PaperPage.svg({pdfPage:p},p,store.books),new RegExp('data-physical-idx="'+i+'"[^>]*>'+expected+'</text>'));
}
const provenance=JSON.parse(fs.readFileSync('fonts/paper-heading-provenance.json','utf8'));
a.equal(provenance.weight,600);
const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync('fonts/'+provenance.file)).digest('hex');
a.equal(hash,provenance.sha256);a.ok(fs.readFileSync('v25-original-fonts.css','utf8').includes('./fonts/'+provenance.file));
console.log('Physical title font checks passed, including all '+(totals.hei+totals.song)+' guarded type-only corrections');
