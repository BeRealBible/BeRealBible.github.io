/* Run against the intended release tree, never a mixed working copy.
   Stamps script/stylesheet REQUESTS, not the public HTML address or storage keys. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve(process.argv[2]||'.'),check=process.argv.includes('--check');
for(const name of process.argv.includes('--index-only')?['index.html']:['index.html','rules.html']){
  const file=path.join(dir,name),original=fs.readFileSync(file,'utf8');
  let stamped=original.replace(/((?:src|href)=")([\w./-]+\.(?:js|css))\?v=index-25(?:&h=[a-f0-9]+)?"/g,(_,pre,asset)=>{
    const payload=fs.readFileSync(path.join(dir,asset),'utf8').replace(/\r\n/g,'\n');
    const hash=crypto.createHash('sha256').update(payload).digest('hex').slice(0,12);return pre+asset+'?v=index-25&h='+hash+'"';
  });
  if(name==='index.html'&&original.includes('id="study-qa"')){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'data/study-qa.json'))).digest('hex').slice(0,12);
    stamped=stamped.replace(/(id="study-qa"[^>]*?data-revision=")[^"]+"/,(_,prefix)=>prefix+hash+'"');
  }
  if(check&&stamped!==original)throw Error(name+' has stale preview assets');
  if(!check&&stamped!==original)fs.writeFileSync(file,stamped,'utf8');
}
