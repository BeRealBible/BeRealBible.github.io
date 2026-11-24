/* Ordered, per-input sync journal. No debounce; server acknowledgements are distinct from local persistence. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.V25NoteSync=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const PREFIX='paper:v25:note-journal:',TEXT_LIMIT=100000;
  // A contiguous replacement handles insertion, paste, deletion and IME
  // without journaling a full snapshot per keystroke.
  function delta(old,next){
    let from=0,end=old.length,stop=next.length;
    while(from<end&&from<stop&&old[from]===next[from])from++;
    while(end>from&&stop>from&&old[end-1]===next[stop-1]){end--;stop--;}
    return [from,end,next.slice(from,stop)];
  }
  const apply=(text,[from,end,insert])=>text.slice(0,from)+insert+text.slice(end);
  const validEdit=e=>typeof e?.id==='string'&&Array.isArray(e.change)&&e.change.length===3&&
    Number.isSafeInteger(e.change[0])&&Number.isSafeInteger(e.change[1])&&e.change[0]>=0&&e.change[1]>=e.change[0]&&typeof e.change[2]==='string';
  function create({model,describe,storage,sessionStorage,scope,active=()=>true,transport,
    online=()=>true,id=()=>globalThis.crypto.randomUUID(),retrySoon=()=>{}}){
    let journalId;
    try{const tag='paper:v25:note-writer';journalId=sessionStorage?.getItem(tag)||id();sessionStorage?.setItem(tag,journalId);}catch{journalId=id();}
    journalId??=id();
    const storageKey=PREFIX+encodeURIComponent(scope)+':'+journalId,states=new Map(),listeners=new Set();
    const descriptor=refs=>describe(Array.isArray(refs)?refs.filter(Array.isArray).map(([code,ch,lo,hi])=>lo==null?{code,ch}:{code,ch,lo,hi}):[]);
    const refsOf=desc=>desc.objects.map(({code,ch,lo,hi})=>lo==null?[code,ch]:[code,ch,lo,hi]);
    let durable=true,refreshing=null,loaded=false;
    function persist(){
      try{
        if(!storage)throw Error();
        const journal=[...states.values()].filter(s=>s.pending.length).map(({desc,revision,base,pending,blocked})=>({refs:refsOf(desc),revision,base,pending,blocked}));
        if(journal.length)storage.setItem(storageKey,JSON.stringify(journal));else storage.removeItem(storageKey);
        durable=true;
      }catch{durable=false;}
    }
    try{
      const data=JSON.parse(storage?.getItem(storageKey)??'[]');
      for(const e of Array.isArray(data)?data:[]){
        if(typeof e.base!=='string'||e.base.length>TEXT_LIMIT||!Number.isSafeInteger(e.revision)||e.revision<0||!Array.isArray(e.pending)||!e.pending.length||!e.pending.every(validEdit))continue;
        const desc=descriptor(e.refs);if(!desc.key)continue;
        const text=e.pending.reduce((body,edit)=>apply(body,edit.change),e.base);if(text.length>TEXT_LIMIT)continue;
        states.set(desc.key,{desc,revision:e.revision,base:e.base,text,pending:e.pending,blocked:e.blocked===true,running:false,failed:false});model.write(desc,text);
      }
    }catch{/* Damaged or locked browser storage never prevents reading or sign-in. */}
    function notify(key,source){for(const listener of listeners)listener(key,source);}
    const offModel=model.listen((key,source)=>notify(key,source));
    function process(s){
      if(s.running||s.blocked||!s.pending.length||!active()||!online())return;
      s.running=true;s.failed=false;notify(s.desc.key);
      // The first request starts in this call on the input event; later edits
      // are queued individually while this particular note is in flight.
      (async()=>{
        try{
          while(active()&&online()&&s.pending.length&&!s.blocked){
            const e=s.pending[0],body=apply(s.base,e.change);
            const reply=await transport.write({noteKey:s.desc.key,refs:refsOf(s.desc),text:body,revision:s.revision,id:e.id});
            if(reply?.ok===false){
              // A refresh may not have arrived yet. Rebase only when the
              // server confirms the exact same prior text; never overwrite a
              // different edit from another reader.
              if(reply.body===s.base&&Number.isSafeInteger(reply.revision)&&reply.revision>s.revision){
                s.revision=reply.revision;persist();continue;
              }
              s.blocked=true;persist();break;
            }
            if(reply?.ok!==true||!Number.isSafeInteger(reply.revision)||reply.revision!==s.revision+1)throw Error('Invalid note acknowledgement');
            s.base=body;s.revision=reply.revision;s.pending.shift();persist();
          }
        }catch{s.failed=true;if(active())retrySoon();}
        finally{s.running=false;notify(s.desc.key);}
      })();
    }
    function resume(){for(const s of states.values())process(s);}
    function merge(remote){
      if(!Array.isArray(remote))throw Error('Invalid note collection');
      for(const r of remote){
        if(typeof r.body!=='string'||r.body.length>TEXT_LIMIT||!Number.isSafeInteger(r.revision)||r.revision<1)continue;
        const desc=descriptor(r.refs);if(!desc.key||r.note_key!==desc.key)continue;
        const old=states.get(desc.key);if(old?.pending.length||old&&old.revision>=r.revision)continue;
        states.set(desc.key,{desc,revision:r.revision,base:r.body,text:r.body,pending:[],blocked:false,running:false,failed:false});
        model.write(desc,r.body,'cloud');
      }
    }
    function refresh(){
      if(!active()||!online())return Promise.resolve(false);
      if(refreshing)return refreshing;
      refreshing=(async()=>{
        try{const data=await transport.list();if(!active())return false;merge(data);loaded=true;resume();return true;}
        catch{retrySoon();return false;}finally{refreshing=null;}
      })();return refreshing;
    }
    function write(desc,text,source,seen){
      if(!active()||!desc.key||typeof text!=='string'||text.length>TEXT_LIMIT)return false;
      let s=states.get(desc.key);
      if(!s){const base=model.get(desc.key)?.text||'';s={desc,base,text:base,revision:0,pending:[],running:false,blocked:false,failed:false};states.set(desc.key,s);}
      if(s.text!==text){
        if(seen!==undefined&&s.text!==seen)s.blocked=true;
        s.pending.push({id:id(),change:delta(s.text,text)});s.text=text;persist();
        model.write(desc,text,source);
      }
      process(s);notify(desc.key,source);return durable;
    }
    function status(key){
      const s=states.get(key),keep=durable?'已记在本机':'浏览器存储不足，请在关页前复制正文';
      if(s?.blocked)return {text:'另一设备修改了同一条笔记；当前文字没有覆盖云端。'+keep+'。',warn:true};
      if(s?.pending.length){
        if(s.running)return {text:'正在同步…'+(!durable?'（'+keep+'）':''),warn:!durable};
        return {text:keep+' · 待同步',warn:!durable||s.failed};
      }
      if(s?.revision)return {text:'已同步',warn:false};
      if(model.get(key))return {text:loaded?'此处缓存尚未得到云端确认。':'正在读取云端笔记…',warn:loaded};
      return {text:'',warn:false};
    }
    return {get:model.get,query:model.query,write,status,refresh,resume,invalidate:model.invalidate,
      body:key=>states.get(key)?.text??model.get(key)?.text??'',
      hasPending:()=>[...states.values()].some(s=>s.pending.length),
      listen(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
      dispose(){offModel();listeners.clear();}};
  }
  return {create,delta,apply};
});
