// Read-only release gate. Run with the owner's authenticated GitHub CLI.
'use strict';
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const owner='xxmm1221',project=owner+'/paper-bible-demo',origin='https://'+owner+'.github.io';
function gh(args){return execFileSync('gh',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
(async()=>{
  assert.equal(gh(['api','user','--jq','.login']),owner,'verify using the Pages owner account');
  const sites=gh(['api','user/repos?affiliation=owner&per_page=100','--paginate','--jq','.[] | select(.has_pages) | .full_name']).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(sites,[project],'do not open private data while another repository under this owner publishes Pages');
  const site=JSON.parse(gh(['api','repos/'+project+'/pages']));
  assert.equal(site.html_url,origin+'/paper-bible-demo/');
  assert.equal(site.source?.branch,'codex/paper-bible-demo');
  assert.equal(site.source?.path,'/');
  assert.equal(site.status,'built');
  const fetchPage=pathname=>fetch(origin+pathname+(pathname.includes('?')?'&':'?')+'isolation_check='+Date.now(),
    {cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
  const old=await fetchPage('/emmaus-paper-study-demo/');
  assert.equal(old.status,404,'wait for the old Demo route to stop serving content');
  const root=await fetchPage('/');
  assert.equal(root.status,404,'the root must not serve another site');
  const reader=await fetchPage('/paper-bible-demo/?v=index-25');
  assert.equal(reader.status,200,'the original reading URL must serve without a redirect');
  assert.match(await reader.text(),/纸页\s*·\s*V25/);
  console.log('PASS isolated GitHub Pages origin; original reader responds in place; old Demo and root do not serve a site');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
