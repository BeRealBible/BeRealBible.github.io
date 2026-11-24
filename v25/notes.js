/* Plain private notes. Never a QAP question/answer or a cloud-sync storage key. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.V25Notes=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const PREFIX='paper-bible-v25-private-notes-v1:';
  const LIMIT=100000;
  const validId=id=>typeof id==='string'&&id.length<=4096&&/^[A-Z0-9.:-]+(?:\|[A-Z0-9.:-]+)*$/.test(id);
  function enabled(location,configuredOrigin,pagesIsolationVerified){
    if(location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname))return true;
    if(location.protocol!=='https:'||location.origin!==configuredOrigin)return false;
    // The publish flag attests to origin isolation; a different path is not enough.
    if(location.hostname==='berealbible.github.io')return pagesIsolationVerified===true&&
      /^\/(?:index\.html)?$/.test(location.pathname);
    return location.hostname!=='xxmm1221.github.io'||(pagesIsolationVerified===true&&
      /^\/paper-bible-demo\/(?:index\.html)?$/.test(location.pathname));
  }
  function createStore({storage,scope,describe,createIndex}){
    const prefix=PREFIX+encodeURIComponent(scope)+':', keyFor=id=>prefix+encodeURIComponent(id);
    const drafts=new Map(), listeners=new Set();
    let snapshot=null;
    const refsFor=objects=>objects.map(o=>o.lo==null?[o.code,o.ch]:[o.code,o.ch,o.lo,o.hi]);
    const validRef=r=>Array.isArray(r)&&(r.length===2||r.length===4)&&typeof r[0]==='string'&&
      r.slice(1).every(n=>Number.isSafeInteger(n)&&n>0)&&(r.length===2||r[2]<=r[3]);
    function decode(key,value){
      try{
        const raw=JSON.parse(value);
        if(!raw||typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>LIMIT||!Array.isArray(raw.refs)||!raw.refs.every(validRef))return null;
        const desc=describe(raw.refs.map(([code,ch,lo,hi])=>lo==null?{code,ch}:{code,ch,lo,hi})),id=raw.id??desc.key;
        return desc.key&&validId(id)&&keyFor(id)===key?{id,refs:refsFor(desc.objects),label:desc.fullTitle,text:raw.text}:null;
      }catch{return null;}
    }
    function load(){
      if(snapshot)return snapshot;
      const items=new Map();
      try{for(let i=0,n=storage?.length??0;i<n;i++){
        const key=storage.key(i);if(!key?.startsWith(prefix))continue;
        const item=decode(key,storage.getItem(key));if(item)items.set(item.id,item);
      }}catch{/* Cache still retains unsaved drafts for the current reading session. */}
      for(const [id,item] of drafts)if(item)items.set(id,item);else items.delete(id);
      snapshot={items,index:null};return snapshot;
    }
    function notify(id,source){for(const listener of listeners)listener(id,source);}
    function write(desc,text,source){
      const id=desc.noteId??desc.key;
      if(!desc.key||!validId(id)||desc.objects.length>256||typeof text!=='string'||text.length>LIMIT)return false;
      const data=load(),was=data.items.get(id),key=keyFor(id);
      const item=text.trim()?{id,refs:refsFor(desc.objects),label:desc.fullTitle,text}:null;
      if(!item&&!was&&!drafts.has(id))return true;
      if(item&&was?.text===text&&JSON.stringify(was.refs)===JSON.stringify(item.refs)&&!drafts.has(id))return true;
      let durable=false;
      try{
        if(!storage)throw Error();
        if(item)storage.setItem(key,JSON.stringify({...(id===desc.key?{}:{id}),refs:item.refs,text:item.text}));else storage.removeItem(key);
        drafts.delete(id);durable=true;
      }catch{drafts.set(id,item);}
      if(item)data.items.set(id,item);else data.items.delete(id);
      data.index=null;notify(id,source);return durable;
    }
    return {get:id=>load().items.get(id),query(objects){const data=load();return (data.index??=createIndex([...data.items.values()])).query(objects);},
      write,isDurable:id=>!drafts.has(id),
      listen(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
      invalidate(key){if(key==null||key.startsWith(prefix)){snapshot=null;notify();}}};
  }
  return {enabled,createStore,LIMIT};
});
