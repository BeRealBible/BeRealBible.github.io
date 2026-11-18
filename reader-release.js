/* The test reader has one permanent public address. Only its assets are fingerprinted. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else api.init(root.document,root.location);
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const VERSION='index-25';
  function refreshURL(href){
    const url=new URL(href);url.searchParams.set('v',VERSION);url.searchParams.delete('_refresh');return url.href;
  }
  function init(document,location){
    const link=document.getElementById('reader-reload');
    if(!link)return;
    link.href=refreshURL(location.href);
    link.addEventListener('click',e=>{
      if(e.button>0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
      e.preventDefault();const same=refreshURL(location.href);
      if(location.href===same)location.reload();else location.replace(same);
    });
  }
  return {VERSION,refreshURL,init};
});
