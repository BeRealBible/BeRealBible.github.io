/* Ordered, per-input sync journal. No debounce; server acknowledgements are distinct from local persistence. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./note-refs.js'):root.V25NoteRefs);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25NoteSync=api;
})(typeof window==='undefined'?globalThis:window,function(grammar){
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
  const removing=s=>s?.pending[0]?.remove===true;
  function create({model,describe,storage,sessionStorage,scope,active=()=>true,transport,
    online=()=>true,id=()=>globalThis.crypto.randomUUID(),retrySoon=()=>{},spansEnabled=false}){
    let journalId;
    try{const tag='paper:v25:note-writer';journalId=sessionStorage?.getItem(tag)||id();sessionStorage?.setItem(tag,journalId);}catch{journalId=id();}
    journalId??=id();
    const legacyKey=PREFIX+encodeURIComponent(scope)+':'+journalId,linksKey=legacyKey+':links',
      storageKey=spansEnabled?legacyKey+':spans':linksKey,states=new Map(),listeners=new Set();
    const descriptor=refs=>{
      const objects=Array.isArray(refs)?refs.map(grammar.decode):[];
      return describe(objects.every(Boolean)?objects:[]);
    };
    const refsOf=desc=>desc.objects.map(grammar.encode);
    const validId=key=>typeof key==='string'&&key.length<=4096&&/^[A-Z0-9.:-]+(?:\|[A-Z0-9.:-]+)*$/.test(key);
    const validDesc=desc=>desc.key&&desc.objects.length<=256&&!(desc.refs?.length>256);
    const identified=(desc,noteId)=>({...desc,noteId});
    let durable=true,refreshing=null,loaded=false;
    function persist(){
      try{
        if(!storage)throw Error();
        const journal=[...states.values()].filter(s=>s.pending.length).map(({baseDesc,revision,base,pending,blocked})=>({noteId:baseDesc.noteId,refs:refsOf(baseDesc),revision,base,pending,blocked}));
        if(journal.length)storage.setItem(storageKey,JSON.stringify(journal));
        storage.removeItem(legacyKey);
        if(spansEnabled)storage.removeItem(linksKey);
        if(!journal.length)storage.removeItem(storageKey);
        durable=true;
      }catch{durable=false;}
    }
    try{
      const data=JSON.parse(storage?.getItem(storageKey)??storage?.getItem(linksKey)??storage?.getItem(legacyKey)??'[]');
      for(const e of Array.isArray(data)?data:[]){
        if(typeof e.base!=='string'||e.base.length>TEXT_LIMIT||!Number.isSafeInteger(e.revision)||e.revision<0||!Array.isArray(e.pending)||!e.pending.length||!e.pending.every(validEdit))continue;
        if(e.pending.some(edit=>edit.remove!==undefined)&&
          !(removing(e)&&e.pending.length===1&&!e.pending[0].refs&&e.base.trim()&&
            e.pending[0].change[0]===0&&e.pending[0].change[1]===e.base.length&&e.pending[0].change[2]===''))continue;
        const initial=descriptor(e.refs),key=e.noteId??initial.key;
        if(!validDesc(initial)||!validId(key)||e.pending.some(edit=>edit.refs!==undefined&&!validDesc(descriptor(edit.refs))))continue;
        const baseDesc=identified(initial,key),last=e.pending.findLast(edit=>edit.refs!==undefined);
        const desc=last?identified(descriptor(last.refs),key):baseDesc;
        const text=removing(e)?e.base:e.pending.reduce((body,edit)=>apply(body,edit.change),e.base);if(text.length>TEXT_LIMIT)continue;
        states.set(key,{desc,baseDesc,revision:e.revision,base:e.base,text,pending:e.pending,blocked:e.blocked===true,running:false,failed:false});model.write(desc,text);
      }
    }catch{/* Damaged or locked browser storage never prevents reading or sign-in. */}
    function notify(key,source){for(const listener of listeners)listener(key,source);}
    const offModel=model.listen((key,source)=>notify(key,source));
    function process(s){
      if(s.running||s.blocked||!s.pending.length||!active()||!online())return;
      const key=s.desc.noteId;
      s.running=true;s.failed=false;notify(key);
      // The first request starts in this call on the input event; later edits
      // are queued individually while this particular note is in flight.
      (async()=>{
        try{
          while(active()&&online()&&s.pending.length&&!s.blocked){
            const e=s.pending[0],body=apply(s.base,e.change),target=e.refs?identified(descriptor(e.refs),key):s.baseDesc;
            const reply=await transport.write({noteKey:key,refs:target.refs??refsOf(target),anchorObjects:target.anchorObjects,text:body,revision:s.revision,id:e.id,
              changesRefs:!!e.refs});
            if(reply?.ok===false){
              // A refresh may not have arrived yet. Rebase only when the
              // server confirms the exact same prior text; never overwrite a
              // different edit from another reader.
              const sameRefs=reply.refs===undefined?!e.refs&&key===s.baseDesc.key:descriptor(reply.anchor_objects??reply.refs).key===s.baseDesc.key;
              if(reply.body===s.base&&sameRefs&&Number.isSafeInteger(reply.revision)&&reply.revision>s.revision){
                s.revision=reply.revision;persist();continue;
              }
              if(e.remove){
                // A removal is conditional on the note shown at confirmation.
                // Restore editing and pull the new note rather than hiding it.
                s.pending.shift();s.removeRejected=true;persist();refresh();break;
              }
              s.blocked=true;persist();break;
            }
            if(reply?.ok!==true||!Number.isSafeInteger(reply.revision)||reply.revision!==s.revision+1)throw Error('Invalid note acknowledgement');
            s.base=body;s.baseDesc=target;s.revision=reply.revision;s.pending.shift();persist();
            if(e.remove){s.text='';model.write(target,'','removed');}
          }
        }catch{s.failed=true;if(active())retrySoon();}
        finally{s.running=false;notify(key);}
      })();
    }
    function resume(){for(const s of states.values())process(s);}
    function merge(remote){
      if(!Array.isArray(remote))throw Error('Invalid note collection');
      for(const r of remote){
        if(typeof r.body!=='string'||r.body.length>TEXT_LIMIT||!Number.isSafeInteger(r.revision)||r.revision<1)continue;
        const desc=identified(descriptor(r.anchor_objects??r.refs),r.note_key),key=desc.noteId;
        if(!validDesc(desc)||!validId(key))continue;
        const old=states.get(key);if(old?.pending.length||old&&old.revision>=r.revision)continue;
        states.set(key,{desc,baseDesc:desc,revision:r.revision,base:r.body,text:r.body,pending:[],blocked:false,running:false,failed:false,
          removeRejected:!!r.body.trim()&&old?.removeRejected});
        model.write(desc,r.body,'cloud');
      }
    }
    function refresh(){
      if(!active()||!online())return Promise.resolve(false);
      if(refreshing)return refreshing;
      refreshing=(async()=>{
        try{const data=await transport.list();if(!active())return false;merge(data);if(!loaded){loaded=true;notify();}resume();return true;}
        catch{retrySoon();return false;}finally{refreshing=null;}
      })();return refreshing;
    }
    function init(desc,key){
      if(states.has(key))return states.get(key);
      const cached=model.get(key),base=cached?.text||'',start=identified(cached?descriptor(cached.anchorObjects??cached.refs):desc,key);
      const s={desc:start,baseDesc:start,base,text:base,revision:0,pending:[],running:false,blocked:false,failed:false};states.set(key,s);return s;
    }
    function write(desc,text,source,seen){
      const key=desc.noteId??desc.key;
      if(!active()||!validDesc(desc)||!validId(key)||typeof text!=='string'||text.length>TEXT_LIMIT)return false;
      const s=init(desc,key);
      if(removing(s))return false;
      if(s.text!==text){
        s.removeRejected=false;
        if(seen!==undefined&&s.text!==seen)s.blocked=true;
        s.pending.push({id:id(),change:delta(s.text,text)});s.text=text;persist();
        model.write(s.desc,text,source);
      }
      process(s);notify(key,source);return durable;
    }
    function reanchor(key,next,source,expected){
      if(!active()||!validId(key)||!validDesc(next))return false;
      const cached=model.get(key),s=states.get(key)??(cached?init(descriptor(cached.anchorObjects??cached.refs),key):null);
      if(!s||s.blocked||removing(s)||(expected!==undefined&&s.desc.key!==expected))return false;
      if(next.key===s.desc.key)return true;
      s.desc=identified(next,key);
      s.pending.push({id:id(),change:[0,0,''],refs:refsOf(next)});persist();
      model.write(s.desc,s.text,source);process(s);notify(key,source);return true;
    }
    function remove(desc,seen,source){
      const key=desc.noteId??desc.key;
      if(!active()||!validId(key)||!validDesc(desc)||!model.get(key))return false;
      const s=init(desc,key);
      if(s.blocked||s.pending.length||!s.text.trim()||s.text!==seen||s.desc.key!==desc.key)return false;
      // Existing RPCs accept an empty body as a revisioned deletion; keep
      // the visible note intact until its own deletion is acknowledged.
      s.removeRejected=false;
      s.pending.push({id:id(),change:[0,s.text.length,''],remove:true});
      persist();process(s);notify(key,source);return true;
    }
    function status(key){
      const s=states.get(key),keep=durable?'已记在本机':'浏览器存储不足，请在关页前复制正文';
      if(removing(s))return {text:s.running?'正在删除…':(durable?'等待同步删除':'未能保存删除请求，请保持此页打开'),warn:!durable||s.failed,removing:true,pending:true};
      if(s?.blocked)return {text:'另一设备修改了同一条笔记；当前文字没有覆盖云端。'+keep+'。',warn:true,pending:true};
      if(s?.pending.length){
        if(s.running)return {text:'正在同步…'+(!durable?'（'+keep+'）':''),warn:!durable,pending:true};
        return {text:keep+' · 待同步',warn:!durable||s.failed,pending:true};
      }
      if(s?.removeRejected)return {text:'这条笔记在另一设备已变更，本次未删除。',warn:true};
      if(s?.revision)return {text:'已同步',warn:false};
      if(model.get(key))return {text:loaded?'此处缓存尚未得到云端确认。':'正在读取云端笔记…',warn:loaded};
      return {text:'',warn:false};
    }
    return {get:model.get,query:model.query,write,remove,reanchor,status,refresh,resume,invalidate:model.invalidate,
      descriptor:key=>states.get(key)?.desc,ready:()=>loaded,
      body:key=>states.get(key)?.text??model.get(key)?.text??'',
      hasPending:()=>[...states.values()].some(s=>s.pending.length),
      listen(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
      dispose(){offModel();listeners.clear();}};
  }
  return {create,delta,apply};
});
