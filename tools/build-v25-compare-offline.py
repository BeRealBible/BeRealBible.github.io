"""Package the V25 comparison branch as a self-contained offline HTML."""
import base64, gzip, hashlib, json, re, sys
from pathlib import Path

root=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2: raise SystemExit('Usage: python tools/build-v25-compare-offline.py OUTPUT.html')
dst=Path(sys.argv[1]).resolve()
html=(root/'index.html').read_text('utf-8')
scripts=[]; compressed=[]; fonts=set()
def path(ref):
    p=(root/ref.split('?')[0]).resolve()
    assert p.is_relative_to(root) and p.is_file(),ref
    return p
def b64(data): return base64.b64encode(data).decode('ascii')
def block(key, data):
    compressed.append('<script type="application/octet-stream" id="'+key+'">'+b64(gzip.compress(data,compresslevel=7,mtime=0))+'</script>')
def css(text):
    def inline(m):
        ref=m[2]
        if ref.startswith(('data:','#')):return m[0]
        p=path(ref);fonts.add(p.name)
        kind={'.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[p.suffix]
        return 'url("data:'+kind+';base64,'+b64(p.read_bytes())+'")'
    return re.sub(r"""url\((["']?)(.*?)\1\)""",inline,text)
def link(m):
    tag=m[0];ref=re.search(r'href="([^"]+)"',tag)[1]
    if 'rel="stylesheet"' in tag: return '<style>'+css(path(ref).read_text('utf-8'))+'</style>'
    if 'rel="preload"' in tag:
        assert ref.startswith('v25/reader.js?');return ''
    if 'rel="manifest"' in tag:return ''
    if 'rel="icon"' in tag or 'rel="apple-touch-icon"' in tag:
        p=path(ref);typ='image/svg+xml' if p.suffix=='.svg' else 'image/png'
        return tag.replace('href="'+ref+'"','href="data:'+typ+';base64,'+b64(p.read_bytes())+'"')
    raise ValueError(tag)
def script(m):
    file=m[1].split('?')[0];s=path(file).read_text('utf8')
    if file=='v25-original-boot.js':
        s,n=re.subn(r",asset=document\.querySelector\('#v25-desk-controller'\)\.getAttribute\('href'\)",'',s);assert n==1
        s,n=re.subn(r'  async function read\(k,name\).*?\n', "  async function read(k){D.installPack(k,JSON.parse(await offline.take('p'+k)));}\n",s);assert n==1
        s,n=re.subn(r'  await new Promise\(\(resolve,reject\)=>\{const script=.*?\n',"  await offline.run('controller');\n",s);assert n==1
        s=s.replace('请检查网络后重新打开','请用新版浏览器重新打开完整的 HTML 文件')
        # Capture the bootstrap, without adding offline globals to the reader.
        s='(function(offline){'+s+'})(window.__paperOffline);'
    key='js'+str(len(scripts))
    block(key,s.encode());scripts.append((key,file));return ''
html=re.sub(r'<link\b[^>]*>',link,html)
html=re.sub(r'<script\b[^>]*?\bsrc="([^"]+)"[^>]*></script>',script,html)
idx=(root/'v25-original-data.js').read_text('utf8')
meta=json.JSONDecoder().raw_decode(idx.split('const M=',1)[1])[0]
for k,f in meta['packs'].items():block('p'+k,path('paper-pages/'+f).read_bytes())
block('controller',path('v25/reader.js').read_bytes())
order=[k for k,n in scripts if n!='v25-original-boot.js']+[next(k for k,n in scripts if n=='v25-original-boot.js')]
boot=r"""
<script>
(async function(){
 'use strict';
 const note=document.querySelector('#reader-rule-loading p');
 try{
   if(typeof DecompressionStream==='undefined')throw Error('请用新版 Chrome、Edge、Firefox 或 Safari 打开此文件。');
   async function take(id){
     const n=document.getElementById(id);if(!n)throw Error('缺少内嵌资源：'+id);
     const raw=atob(n.textContent);n.remove();
     const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
     return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
   }
   async function run(id){const s=document.createElement('script');s.textContent=await take(id);document.head.append(s);s.remove();}
   window.__paperOffline={take,run};
   for(const id of ORDER)await run(id);
 }catch(e){note.textContent=e.message;document.querySelector('#reader-rule-loading').setAttribute('role','alert');console.error(e);}
})();
</script>""".replace('ORDER',json.dumps(order))
html=html.replace('<title>纸页 · V25 经文对照</title>','<title>纸质圣经 · V25 经文对照分支</title>').replace('首次打开需要载入全文和字体，请稍候。','正在从文件打开全本经文和字体，无需联网。').replace('href="./?v=index-25"', 'href=""')
html=html.replace('加载遇到问题？重新打开</a>','加载遇到问题？重新打开</a><noscript>请保存完整文件，并用允许 JavaScript 的浏览器打开。</noscript>')
assert '</body>' in html and '__paperOffline' not in html
html=html.replace('</body>','\n'+'\n'.join(compressed)+'\n'+boot+'\n</body>')
dst.write_bytes(html.encode('utf-8'))
print(dst, dst.stat().st_size, 'bytes;',len(scripts),'scripts,',len(meta['packs']),'packs,',len(fonts),'font files;',hashlib.sha256(dst.read_bytes()).hexdigest())
