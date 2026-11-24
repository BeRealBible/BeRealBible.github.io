(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25Account=api.mount(root);
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const POSITION='paper-bible-position-v1', PROFILE='paper:v25:account:records:', SESSION='paper:v25:account:session:';
  const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const KIND=/^(?:paper-bible-position-v1|paper-bible-(?:v25-(?:compare-)?trails|reading-history)-v1)(?:$|:)|^paper-bible-highlights-v1:/;
  const read=(store,key)=>{try{return store?.getItem(key)??null;}catch{return null;}};
  const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  function configFor(location,config){
    if(!config||location.protocol!=='https:'&&!(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname)))return null;
    // Set the release flag only after GitHub confirms that this is the sole site on the origin.
    // The path guard selects the app entry; the separately verified origin is the privacy boundary.
    if(location.hostname==='xxmm1221.github.io'&&!(config.pagesIsolationVerified===true&&
      /^\/paper-bible-demo\/(?:index\.html)?$/.test(location.pathname)))return null;
    if(location.hostname==='berealbible.github.io'&&!(config.pagesIsolationVerified===true&&
      config.notesOrigin===location.origin&&/^\/(?:index\.html)?$/.test(location.pathname)))return null;
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)||!/^sb_publishable_[\w-]+$/.test(config.publishableKey))return null;
    return {url:config.url.replace(/\/$/,''),publishableKey:config.publishableKey,
      ...(config.noteReanchorEnabled===true?{noteReanchorEnabled:true}:{})};
  }
  function eligible(key,edition){
    return typeof key==='string'&&key.length<=240&&/^[a-zA-Z0-9:~_@.–\-]+$/.test(key)&&key.endsWith(':'+edition)&&KIND.test(key);
  }
  function values(input,edition){
    return Object.fromEntries(Object.entries(object(input)?input:{}).filter(([key,value])=>eligible(key,edition)&&typeof value==='string'&&value.length<=131072));
  }
  function createProfile(store,{prefix,id,edition,onDirty=()=>{},onChange=()=>{},onVolatile=()=>{},nonce=()=>globalThis.crypto.randomUUID()}){
    const cacheKey=PROFILE+prefix+':'+id+':'+edition;
    let volatile=null,cachedText,cached;
    function load(){
      if(volatile)return volatile;
      const serialized=read(store,cacheKey);
      if(cached&&serialized===cachedText)return cached;
      const record=parse(serialized);
      const data=values(record?.data,edition),pending=Object.fromEntries(Object.entries(object(record?.pending)?record.pending:{}).filter(([key,token])=>Object.hasOwn(data,key)&&typeof token==='string'));
      cachedText=serialized;return cached={data,pending};
    }
    function persist(record,required=false){
      try{if(!store)throw Error();const next=JSON.stringify(record);if(next!==cachedText)store.setItem(cacheKey,next);cachedText=next;cached=record;volatile=null;}
      catch{if(required)throw Error('此浏览器无法保存账户记录。同步未开启，请允许网站存储后重试。');volatile=record;onVolatile();}
    }
    function put(key,value){
      if(!eligible(key,edition)||value.length>131072)return;
      const record=load();if(record.data[key]===value)return;
      persist({data:{...record.data,[key]:value},pending:{...record.pending,[key]:nonce()}});onDirty();
    }
    function importable(){
      const guest={};
      try{for(let i=0;i<(store?.length??0);i++){
        const k=store.key(i),v=eligible(k,edition)?read(store,k):null;
        if(v!==null)guest[k]=v;
      }}catch{/* Locked browser storage has nothing to import. */}
      return values(guest,edition);
    }
    function changes(){
      const {data,pending}=load();
      return {pending:{...pending},patch:Object.fromEntries(Object.keys(pending).map(k=>[k,data[k]]))};
    }
    function receive(remote,sent={},required=false){
      if(!object(remote))throw Error('服务器未返回可识别的同步记录。');
      const old=load(),next=values(remote,edition),pending={...old.pending};
      for(const [k,token] of Object.entries(old.pending)){
        if(sent[k]!==token)next[k]=old.data[k];else delete pending[k];
      }
      persist({data:next,pending},required);
      for(const k of new Set([...Object.keys(old.data),...Object.keys(next)]))if(old.data[k]!==next[k])onChange(k);
    }
    // Other settings are still local to the device; annotation keys never fall
    // through to the guest profile, even for older pagination migrations.
    const adapter={
      getItem:k=>KIND.test(k)?load().data[k]??null:read(store,k),
      setItem(k,value){if(KIND.test(k))put(k,String(value));else store?.setItem(k,String(value));},
      get length(){return Object.keys(load().data).length;},key:i=>Object.keys(load().data)[i]??null,
    };
    return {adapter,cacheKey,importable,changes,receive};
  }
  function validSession(s){
    return object(s)&&UUID.test(s.id)&&typeof s.email==='string'&&typeof s.access==='string'&&!!s.access&&
      typeof s.refresh==='string'&&!!s.refresh&&Number.isFinite(s.expiry);
  }
  function unpack(response){
    const s={id:response?.user?.id,email:response?.user?.email,access:response?.access_token,refresh:response?.refresh_token,
      expiry:Number(response?.expires_at)||Date.now()/1000+Number(response?.expires_in)};
    if(!validSession(s))throw Error('账号服务未返回有效会话。');
    return s;
  }
  function createClient(fetch,config){
    async function request(path,{body,access}={}){
      let result;
      try{result=await fetch(config.url+path,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
        signal:AbortSignal.timeout(12000),keepalive:path.startsWith('/auth/v1/logout'),headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},
        ...(body!==undefined?{body:JSON.stringify(body)}:{})});}
      catch{throw Error('暂时连不上账号服务，请检查网络后重试。');}
      if(!result.ok){const error=Object.assign(Error('账号服务暂不可用，请稍后重试。'),{status:result.status});throw error;}
      return result.status===204?null:result.json();
    }
    return {
      send:email=>request('/auth/v1/otp',{body:{email,create_user:true}}),
      verify:async(email,token)=>unpack(await request('/auth/v1/verify',{body:{email,token,type:'email'}})),
      refresh:async s=>unpack(await request('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:s.refresh}})),
      logout:access=>request('/auth/v1/logout?scope=local',{access}),
      exchange:(access,edition,patch,imports)=>request('/rest/v1/rpc/paper_v25_sync',{access,body:{edition_key:edition,changes:patch,guest_import:imports}}),
      listNotes:access=>request('/rest/v1/rpc/paper_v25_note_list',{access,body:{}}),
      writeNote:(access,note)=>{
        if(note.changesRefs&&!config.noteReanchorEnabled)throw Error('暂时无法同步经文关联。');
        return request('/rest/v1/rpc/paper_v25_note_write'+(config.noteReanchorEnabled?'_v2':''),{access,body:{
          anchor_key:note.noteKey,anchors:note.refs,note_body:note.text,expected_revision:note.revision,mutation_id:note.id}});
      },
    };
  }
  function mount(win){
    const config=configFor(win.location,win.V25_ACCOUNT_CONFIG),doc=win.document;
    if(!config||!doc.getElementById('paper-account-open'))return null;
    const $=id=>doc.getElementById('paper-account-'+id),dialog=$('dialog');
    let sessionStore,store;try{sessionStore=win.sessionStorage;store=win.localStorage;}catch{}
    const prefix=new URL(config.url).hostname,sessionKey=SESSION+prefix;
    const record=parse(read(sessionStore,sessionKey));
    let session=validSession(record?.session)?record.session:null,enabled=!!session&&record?.enabled===true;
    let edition,profile,active=false,busy=false,refreshing=null,flight=null,timer=0,reauth=false,volatile=false;
    let email='',resendAt=0,lastSync=0,message='',notice='';
    const client=createClient(win.fetch.bind(win),config);
    const show=(id,visible)=>{$(id).hidden=!visible;};
    function render(){
      $('open').textContent=session?'账号与同步':'登录与同步';
      show('auth',!session);show('send',!session&&!email);show('verify',!session&&!!email);
      show('profile',!!session);show('consent',!!session&&!enabled);show('enabled',enabled);
      $('address').textContent=session?.email||'';$('sent').textContent=email;
      $('message').textContent=message||notice;
      for(const button of dialog.querySelectorAll('button[data-account-action]'))button.disabled=busy;
      if(enabled){$('sync').disabled=busy||reauth;$('resume').disabled=busy||!readPosition();}
      if(!session&&email)$('resend').disabled=busy||Date.now()<resendAt;
    }
    function saveSession(s,linked){
      try{if(!sessionStore)throw Error();sessionStore.setItem(sessionKey,JSON.stringify({session:s,enabled:linked}));}
      catch{throw Error('此浏览器无法保存登录会话，请允许网站存储后重试。');}
      const switched=session?.id!==s.id;
      session=s;enabled=linked;
      if(switched)win.dispatchEvent(new CustomEvent('paper-note-scope-changed'));
    }
    function makeProfile(){
      if(!session||!edition)return null;
      return createProfile(store,{prefix,id:session.id,edition,onDirty:()=>schedule(),onVolatile:()=>{volatile=true;},onChange:key=>{
        if(active)win.dispatchEvent(new CustomEvent('paper-account-data',{detail:{key}}));
      }});
    }
    function readerStorage(raw,currentEdition){
      if(!/^[a-z0-9_\-]{1,64}$/.test(currentEdition))return null;
      if(!active){edition=currentEdition;store=raw;profile=makeProfile();}
      return enabled?profile?.adapter:null;
    }
    function readPosition(){return parse(profile?.adapter.getItem(POSITION+':'+edition));}
    function cleanRoute(){
      const url=new URL(win.location.href);
      for(const k of ['ref','pdf','book','ch','resume'])url.searchParams.delete(k);
      url.hash='';return url;
    }
    function reopen(){
      const url=cleanRoute();
      if(url.href===win.location.href)win.location.reload();else win.location.replace(url.href);
    }
    async function token(){
      if(!session||reauth)throw Error('登录已失效。请退出后重新验证，未同步记录会留在本机。');
      if(session.expiry>Date.now()/1000+60)return session.access;
      if(!refreshing){
        const prior=session;
        refreshing=(async()=>{
          try{
            const next=await client.refresh(prior);
            if(session!==prior||next.id!==prior.id)throw Error('登录已切换，请重试。');
            saveSession(next,enabled);return next.access;
          }catch(e){
            if([400,401,403].includes(e.status)){
              reauth=true;throw Error('登录已失效。请退出后重新验证，未同步记录会留在本机。');
            }
            throw e;
          }finally{refreshing=null;}
        })();
      }
      return refreshing;
    }
    async function sync({activating=false,importGuest=false}={}){
      if(flight)return flight;
      if(!profile||!session||!enabled&&!activating)return;
      clearTimeout(timer);timer=0;
      const target=profile,id=session.id;
      flight=(async()=>{
        const access=await token();
        if(session?.id!==id||profile!==target)return;
        const {patch,pending}=target.changes();
        const result=await client.exchange(access,edition,patch,importGuest?target.importable():{});
        if(session?.id!==id||profile!==target)return;
        target.receive(result,pending,activating);
        lastSync=Date.now();notice=volatile?'浏览器存储受限；离线时的修改可能无法保留。':'已同步 · '+new Date(lastSync).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
      })().catch(e=>{notice=e.status===401||e.status===403?'同步未授权，请确认登录和后台配置。':e.message;throw Error(notice);})
        .finally(()=>{flight=null;if(profile===target&&enabled&&!reauth&&Object.keys(target.changes().pending).length)schedule(10000);render();});
      return flight;
    }
    function background(){if(active&&enabled&&!reauth&&!doc.hidden)sync().catch(()=>{});}
    function schedule(ms=2500){
      if(!active||!enabled||reauth)return;
      clearTimeout(timer);timer=setTimeout(background,ms);
    }
    function readerReady(){
      active=enabled&&!!profile;
      $('open').hidden=false;render();
      if(active){background();win.setInterval(background,60000);}
    }
    function perform(action){
      if(busy)return;
      busy=true;message='';render();
      Promise.resolve().then(action).catch(e=>message=e.message).finally(()=>{busy=false;render();});
    }
    async function send(address){
      try{await client.send(address);}
      catch(e){if(e.status)throw Error(e.status===429?'发送太频繁，请稍后再试。':'验证码未能发送，请检查邮箱，或稍后重试。');throw e;}
      email=address;resendAt=Date.now()+60000;message='验证码已发送，也可以检查垃圾邮件。';
      $('code').value='';render();$('code').focus();win.setTimeout(render,60100);
    }
    function openDialog(){
      $('open').closest('dialog')?.close();if(!dialog.open)dialog.showModal();render();
    }
    $('open').addEventListener('click',openDialog);
    $('close').addEventListener('click',()=>dialog.close());
    $('send').addEventListener('submit',e=>{e.preventDefault();perform(()=>send($('email').value.trim()));});
    $('verify').addEventListener('submit',e=>{
      e.preventDefault();perform(async()=>{
        let s;
        try{s=await client.verify(email,$('code').value.trim());}
        catch(e){if(e.status)throw Error(e.status===429?'验证太频繁，请稍后再试。':'验证码不正确或已过期。');throw e;}
        saveSession(s,false);profile=makeProfile();email='';$('email').value='';$('code').value='';
        $('import').checked=false;message='已登录。你可以选择是否启用云端同步。';
      });
    });
    $('resend').addEventListener('click',()=>{if(email&&Date.now()>=resendAt)perform(()=>send(email));});
    $('change').addEventListener('click',()=>{email='';$('code').value='';message='';render();$('email').focus();});
    $('enable').addEventListener('click',()=>perform(async()=>{
      if(!profile)throw Error('请先等书页载入。');
      await sync({activating:true,importGuest:$('import').checked});
      saveSession(session,true);reopen();
    }));
    $('sync').addEventListener('click',()=>perform(()=>sync()));
    $('resume').addEventListener('click',()=>perform(async()=>{await sync();if(readPosition())reopen();}));
    $('logout').addEventListener('click',()=>perform(async()=>{
      if(flight)await flight.catch(()=>{});
      const current=session,wasActive=active;if(!current)return;
      active=false;clearTimeout(timer);
      try{sessionStore.removeItem(sessionKey);}catch{throw Error('浏览器无法清除本次会话，请关闭此标签页退出。');}
      session=null;enabled=false;profile=null;reauth=false;notice='';
      win.dispatchEvent(new CustomEvent('paper-note-scope-changed'));
      Promise.resolve(client.logout(current.access)).catch(()=>{});
      if(wasActive)reopen();else{$('import').checked=false;message='已退出。';}
    }));
    win.addEventListener('online',background);
    doc.addEventListener('visibilitychange',()=>{if(Date.now()-lastSync>15000)background();});
    win.addEventListener('storage',e=>{if(active&&e.key===profile?.cacheKey)win.dispatchEvent(new CustomEvent('paper-account-data'));});
    const noteScope=()=>session?prefix+':'+session.id:null;
    async function notesCall(scope,callback){
      if(!session||noteScope()!==scope)throw Error('请先登录 BeRealBible 账号。');
      const access=await token();
      if(noteScope()!==scope)throw Error('登录账号已切换。');
      return callback(access);
    }
    return {readerStorage,readerReady,openDialog,noteReanchorEnabled:config.noteReanchorEnabled===true,get usingProfile(){return enabled&&!!profile;},get notesScope(){return noteScope();},
      noteTransport(scope){return {list:()=>notesCall(scope,client.listNotes),write:note=>notesCall(scope,access=>client.writeNote(access,note))};}};
  }
  return {configFor,createClient,createProfile,mount,eligible};
});
