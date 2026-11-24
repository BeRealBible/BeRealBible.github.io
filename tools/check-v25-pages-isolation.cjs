// Read-only release gate. Run with the owner's authenticated GitHub CLI.
'use strict';
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const official=process.argv.includes('--official');
const owner=official?'BeRealBible':'xxmm1221',project=owner+(official?'/BeRealBible.github.io':'/paper-bible-demo');
const origin='https://'+owner.toLowerCase()+'.github.io',entry=official?'/':'/paper-bible-demo/';
function gh(args){return execFileSync('gh',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
(async()=>{
  if(official){
    assert.equal(gh(['api','user/memberships/orgs/'+owner,'--jq','select(.state=="active")|.role']),'admin','verify using an organization owner account');
  }else assert.equal(gh(['api','user','--jq','.login']),owner,'verify using the Pages owner account');
  const repoList=official?'orgs/'+owner+'/repos?type=all&per_page=100':'user/repos?affiliation=owner&per_page=100';
  const sites=gh(['api',repoList,'--paginate','--jq','.[] | select(.has_pages) | .full_name']).toLowerCase().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(sites,[project.toLowerCase()],'do not open private data while another repository under this owner publishes Pages');
  const site=JSON.parse(gh(['api','repos/'+project+'/pages']));
  assert.equal(site.html_url,origin+entry);
  assert.equal(site.source?.branch,official?'main':'codex/paper-bible-demo');
  assert.equal(site.source?.path,'/');
  assert.equal(site.status,'built');
  const fetchPage=pathname=>fetch(origin+pathname+(pathname.includes('?')?'&':'?')+'isolation_check='+Date.now(),
    {cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
  const old=await fetchPage('/emmaus-paper-study-demo/');
  assert.equal(old.status,404,'wait for the old Demo route to stop serving content');
  if(!official)assert.equal((await fetchPage('/')).status,404,'the compatibility root must not serve another site');
  const reader=await fetchPage(official?entry:entry+'?v=index-25');
  assert.equal(reader.status,200,'the public reading URL must serve without a redirect');
  assert.match(await reader.text(),official?/<title>BeRealBible\s*·\s*纸质圣经<\/title>/:/纸页\s*·\s*V25/);
  console.log('PASS isolated GitHub Pages origin at '+origin+entry+'; the reader responds in place and the old Demo route does not host content');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
