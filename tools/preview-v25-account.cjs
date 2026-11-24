// Loopback only. Test a hosted backend without changing the public release config.
'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=37875,key='paper:v25:preview-config';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const setup=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>纸页 · 本机登录验收</title>
<style>body{max-width:34rem;margin:3rem auto;padding:0 1rem;font:16px/1.65 system-ui;color:#523629;background:#faf4e8}label{display:block;margin:1rem 0}input{display:block;box-sizing:border-box;width:100%;font:inherit;padding:.45rem}button{font:inherit;padding:.4rem 1rem}</style>
<h1>纸页 · 本机登录验收</h1><p>只填可公开的前端配置。不要填 SMTP 密钥、私钥或验证码。</p>
<form id="setup"><label for="project">Supabase 项目 URL<input id="project" type="url" required></label>
<label for="publishable">Publishable key<input id="publishable" type="password" autocomplete="off" pattern="sb_publishable_[A-Za-z0-9_\\-]+" required></label>
<button type="submit">进入纸页测试版</button></form><p id="message" role="status"></p>
<script>document.getElementById('setup').onsubmit=function(e){e.preventDefault();const url=document.getElementById('project').value.trim(),publishableKey=document.getElementById('publishable').value.trim();if(!/^https:\\/\\/[a-z0-9-]+\\.supabase\\.co\\/?$/.test(url)||!/^sb_publishable_[\\w-]+$/.test(publishableKey)){document.getElementById('message').textContent='请检查项目地址和公开键。';return;}sessionStorage.setItem('${key}',JSON.stringify({url,publishableKey}));location.replace('/?v=index-25');};</script>`;
const virtual=`try{window.V25_ACCOUNT_CONFIG=JSON.parse(sessionStorage.getItem(${JSON.stringify(key)}));}catch{}`;
const server=http.createServer(async(req,res)=>{
  const reply=(status,type,body)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:body);};
  if(!['GET','HEAD'].includes(req.method)||req.headers.host!==`127.0.0.1:${port}`)return reply(400,'text/plain','Local preview only');
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`),pathname=decodeURIComponent(url.pathname);
    if(pathname==='/account-setup')return reply(200,types['.html'],setup);
    if(pathname==='/v25/account-config.js')return reply(200,types['.js'],virtual);
    const rel=pathname==='/'?'index.html':pathname.slice(1),type=types[path.extname(rel)];
    if(!type||!/^([A-Za-z0-9_./-]+)$/.test(rel)||rel.split('/').some(p=>p.startsWith('.')))return reply(404,'text/plain','Not found');
    const file=await fs.realpath(path.join(root,rel));
    if(!file.toLowerCase().startsWith((root+path.sep).toLowerCase()))return reply(404,'text/plain','Not found');
    reply(200,type,await fs.readFile(file));
  }catch{return reply(404,'text/plain','Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`V25 loopback preview: http://127.0.0.1:${port}/account-setup`));
