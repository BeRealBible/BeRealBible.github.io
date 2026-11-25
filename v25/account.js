(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.V25Account=api.mount(root);
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const POSITION='paper-bible-position-v1', PROFILE='paper:v25:account:records:', SESSION='paper:v25:account:session:';
  const REMEMBERED='paper:v25:account:remembered:';
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
      ...(config.noteReanchorEnabled===true?{noteReanchorEnabled:true}:{}),
      ...(config.noteReanchorEnabled===true&&config.noteSpanEnabled===true?{noteSpanEnabled:true}:{})};
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
  function rememberLogin(location,config){
    if(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname))return true;
    // A persistent refresh token is only permitted on the sole, verified
    // official origin, never on a compatibility path or arbitrary preview.
    return location.origin==='https://berealbible.github.io'&&config?.notesOrigin===location.origin&&
      config?.pagesIsolationVerified===true&&/^\/(?:index\.html)?$/.test(location.pathname);
  }
  function sessionVault({tab,local,prefix,locks,nonce}){
    const legacy=SESSION+prefix,key=REMEMBERED+prefix;
    const previous=parse(read(tab,legacy));
    if(local)try{
      const probe=key+':probe:'+nonce();local.setItem(probe,'1');local.removeItem(probe);
      // An explicit logout leaves a token-free marker, so another restored
      // legacy tab cannot silently re-import its copy of the old session.
      if(local.getItem(key)===null&&validSession(previous?.session))
        local.setItem(key,JSON.stringify({session:previous.session,enabled:previous.enabled===true,epoch:nonce()}));
      try{tab?.removeItem(legacy);}catch{/* The shared record now takes precedence. */}
    }catch{local=null;}
    const authStore=local||tab,authKey=local?key:legacy;
    return {key:authKey,shared:!!local,read:()=>parse(read(authStore,authKey)),
      put(record){if(!authStore)throw Error();authStore.setItem(authKey,JSON.stringify(record));},
      clear(){if(local)local.setItem(key,JSON.stringify({epoch:nonce()}));else tab?.removeItem(legacy);},
      lock:fn=>local&&locks?.request?locks.request(key,fn):Promise.resolve().then(fn)};
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
      listNotes:access=>request('/rest/v1/rpc/paper_v25_note_list'+(config.noteSpanEnabled?'_v2':''),{access,body:{}}),
      writeNote:(access,note)=>{
        if(note.changesRefs&&!config.noteReanchorEnabled)throw Error('暂时无法同步经文关联。');
        if(note.anchorObjects&&!config.noteSpanEnabled)throw Error('暂时无法同步跨章关联。');
        return request('/rest/v1/rpc/paper_v25_note_write'+(config.noteSpanEnabled?'_v3':config.noteReanchorEnabled?'_v2':''),{access,body:{
          anchor_key:note.noteKey,anchors:note.refs,note_body:note.text,expected_revision:note.revision,mutation_id:note.id,
          ...(config.noteSpanEnabled?{anchor_objects:note.anchorObjects??null}:{})}});
      },
    };
  }
  function mount(win){
    const config=configFor(win.location,win.V25_ACCOUNT_CONFIG),doc=win.document;
    if(!config||!doc.getElementById('paper-account-open'))return null;
    const $=id=>doc.getElementById('paper-account-'+id),dialog=$('dialog');
    let sessionStore,store;try{sessionStore=win.sessionStorage;}catch{}try{store=win.localStorage;}catch{}
    const prefix=new URL(config.url).hostname,nonce=()=>win.crypto.randomUUID();
    const vault=sessionVault({tab:sessionStore,local:rememberLogin(win.location,win.V25_ACCOUNT_CONFIG)?store:null,prefix,nonce,locks:win.navigator?.locks});
    const record=vault.read();
    let session=(!vault.shared||UUID.test(record?.epoch||''))&&validSession(record?.session)?record.session:null,enabled=!!session&&record?.enabled===true;
    let epoch=session?(record.epoch||nonce()):null;
    let edition,profile,active=false,busy=false,refreshing=null,flight=null,timer=0,reauth=false,volatile=false,detached=false;
    let email='',resendAt=0,lastSync=0,message='',notice='';
    const client=createClient(win.fetch.bind(win),config);
    const show=(id,visible)=>{$(id).hidden=!visible;};
    function render(){
      $('open').textContent=session?'账号与同步':'登录与同步';
      show('auth',!session);show('send',!session&&!email);show('verify',!session&&!!email);
      if($('remember'))show('remember',vault.shared);
      show('profile',!!session);show('consent',!!session&&!enabled);show('enabled',enabled);
      $('address').textContent=session?.email||'';$('sent').textContent=email;
      $('message').textContent=message||notice;
      for(const button of dialog.querySelectorAll('button[data-account-action]'))button.disabled=busy;
      if(enabled){$('sync').disabled=busy||reauth;$('resume').disabled=busy||!readPosition();}
      if(!session&&email)$('resend').disabled=busy||Date.now()<resendAt;
    }
    function saveSession(s,linked,stamp){
      try{vault.put({session:s,enabled:linked,epoch:stamp});}
      catch{throw Error('此浏览器无法保存登录会话，请允许网站存储后重试。');}
      const switched=epoch!==stamp||session?.id!==s.id;
      session=s;enabled=linked;epoch=stamp;reauth=false;
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
    function reconcile(){
      if(detached)return false;
      if(!vault.shared)return true;
      const saved=vault.read(),next=UUID.test(saved?.epoch||'')&&validSession(saved?.session)?saved.session:null;
      const stamp=next?saved.epoch:null,linked=!!next&&saved.enabled===true;
      if(stamp===epoch&&next?.id===session?.id&&linked===enabled){
        if(next?.refresh!==session?.refresh)reauth=false;
        session=next;return true;
      }
      // The stage has already captured its reading adapter. Never leave a
      // previous account's paper/profile on screen after another tab changes it.
      const needsReload=enabled||linked;
      active=false;clearTimeout(timer);profile=null;
      session=needsReload?null:next;enabled=false;epoch=needsReload?null:stamp;reauth=false;
      detached=needsReload;
      profile=makeProfile();email='';message='';notice='';
      win.dispatchEvent(new CustomEvent('paper-note-scope-changed'));render();
      if(needsReload)reopen();
      return false;
    }
    async function token(){
      if(!reconcile()||!session||reauth)throw Error('登录已失效。请重新验证，未同步记录会留在本机。');
      if(session.expiry>Date.now()/1000+60)return session.access;
      if(!refreshing){
        const stamp=epoch;
        refreshing=vault.lock(async()=>{
          if(!reconcile()||epoch!==stamp||!session||reauth)throw Error('登录已切换或失效，请重试。');
          if(session.expiry>Date.now()/1000+60)return session.access;
          const prior=session;
          try{
            const next=await client.refresh(prior);
            if(!reconcile()||epoch!==stamp||next.id!==prior.id)throw Error('登录已切换，请重试。');
            // If LockManager is unavailable, a neighboring tab may already
            // have saved the rotated token. Never replace its newer record.
            if(session.refresh!==prior.refresh)return session.access;
            saveSession(next,enabled,stamp);return next.access;
          }catch(e){
            if([400,401,403].includes(e.status)){
              if(!reconcile()||epoch!==stamp)throw Error('登录已切换，请重试。');
              if(session.refresh!==prior.refresh)return session.access;
              reauth=true;throw Error('登录已失效。请退出后重新验证，未同步记录会留在本机。');
            }
            throw e;
          }
        }).finally(()=>{refreshing=null;});
      }
      return refreshing;
    }
    async function sync({activating=false,importGuest=false}={}){
      if(flight)return flight;
      if(!profile||!session||!enabled&&!activating)return;
      clearTimeout(timer);timer=0;
      const target=profile,id=session.id,stamp=epoch;
      flight=(async()=>{
        const access=await token();
        if(!reconcile()||session?.id!==id||profile!==target||epoch!==stamp)return;
        const {patch,pending}=target.changes();
        const result=await client.exchange(access,edition,patch,importGuest?target.importable():{});
        if(!reconcile()||session?.id!==id||profile!==target||epoch!==stamp)return;
        target.receive(result,pending,activating);
        lastSync=Date.now();notice=volatile?'浏览器存储受限；离线时的修改可能无法保留。':'已同步 · '+new Date(lastSync).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
      })().catch(e=>{notice=e.status===401||e.status===403?'同步未授权，请确认登录和后台配置。':e.message;throw Error(notice);})
        .finally(()=>{flight=null;if(profile===target&&enabled&&!reauth&&Object.keys(target.changes().pending).length)schedule(10000);render();});
      return flight;
    }
    function background(){if(!doc.hidden&&reconcile()&&active&&enabled&&!reauth)sync().catch(()=>{});}
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
        await vault.lock(()=>{if(!detached)saveSession(s,false,nonce());});
        if(detached)return;
        profile=makeProfile();email='';$('email').value='';$('code').value='';
        $('import').checked=false;message=vault.shared?'已登录。此浏览器会保持登录；共用设备请主动退出。':'已登录。当前环境只在此标签页保持登录。';
      });
    });
    $('resend').addEventListener('click',()=>{if(email&&Date.now()>=resendAt)perform(()=>send(email));});
    $('change').addEventListener('click',()=>{email='';$('code').value='';message='';render();$('email').focus();});
    $('enable').addEventListener('click',()=>perform(async()=>{
      if(!profile)throw Error('请先等书页载入。');
      const stamp=epoch;
      await sync({activating:true,importGuest:$('import').checked});
      await vault.lock(()=>{
        if(!reconcile()||epoch!==stamp||!session)throw Error('登录已切换，请重试。');
        saveSession(session,true,stamp);reopen();
      });
    }));
    $('sync').addEventListener('click',()=>perform(()=>sync()));
    $('resume').addEventListener('click',()=>perform(async()=>{await sync();if(readPosition())reopen();}));
    $('logout').addEventListener('click',()=>perform(async()=>{
      const stamp=epoch;
      if(flight)await flight.catch(()=>{});
      await vault.lock(()=>{
        if(!reconcile()||epoch!==stamp||!session)return;
        const current=session,wasActive=active;
        try{vault.clear();}catch{throw Error('无法清除此浏览器的登录状态，请清除本网站数据后重试。');}
        active=false;clearTimeout(timer);
        session=null;enabled=false;epoch=null;profile=null;reauth=false;notice='';
        win.dispatchEvent(new CustomEvent('paper-note-scope-changed'));
        Promise.resolve(client.logout(current.access)).catch(()=>{});
        if(wasActive)reopen();else{$('import').checked=false;message='已退出。';}
      });
    }));
    win.addEventListener('online',background);
    doc.addEventListener('visibilitychange',()=>{if(Date.now()-lastSync>15000)background();});
    win.addEventListener('pageshow',()=>reconcile());
    win.addEventListener('storage',e=>{
      if(vault.shared&&(e.key===vault.key||e.key===null))reconcile();
      if(active&&e.key===profile?.cacheKey)win.dispatchEvent(new CustomEvent('paper-account-data'));
    });
    const noteScope=()=>session?prefix+':'+session.id:null;
    async function notesCall(scope,callback){
      if(!session||noteScope()!==scope)throw Error('请先登录 BeRealBible 账号。');
      const stamp=epoch,access=await token();
      if(!reconcile()||epoch!==stamp||noteScope()!==scope)throw Error('登录账号已切换。');
      return callback(access);
    }
    return {readerStorage,readerReady,openDialog,noteReanchorEnabled:config.noteReanchorEnabled===true,noteSpanEnabled:config.noteSpanEnabled===true,get usingProfile(){return enabled&&!!profile;},get notesScope(){return noteScope();},
      noteTransport(scope){return {list:()=>notesCall(scope,client.listNotes),write:note=>notesCall(scope,access=>client.writeNote(access,note))};}};
  }
  return {configFor,createClient,createProfile,mount,eligible,rememberLogin,sessionVault};
});
