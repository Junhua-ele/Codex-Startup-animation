// Use execution metadata when Chromium's resource timing buffer omits app: modules.
// This never fetches source, pauses execution, or guesses module paths.
export function matchingModuleUrl(raw, pageUrl, signal) {
  try {
    const u=new URL(raw), page=new URL(pageUrl);
    if(u.protocol!==page.protocol || u.host!==page.host || u.username || u.password) return null;
    if(![signal.hostBundle,signal.phaseBundle].some(name=>u.pathname.endsWith('/assets/'+name))) return null;
    return u.href; // query/fragment are part of the observed ESM cache identity
  } catch {return null;}
}

export async function observeExecutedModules(cdp, adapter, initialPageUrl) {
  let pageUrl=initialPageUrl, revision=0, enabled=false;
  const urls=new Set(), signal=adapter.nativeReadySignal;
  const changed=()=>{revision++;};
  if(signal?.kind!=='codex-startup-modules') return {get urls(){return [];},get revision(){return 0;},stop:async()=>{}};
  const unparsed=cdp.on('Debugger.scriptParsed',event=>{
    if(event.isModule!==true) return;
    const url=matchingModuleUrl(event.url,pageUrl,signal);
    if(url&&!urls.has(url)){urls.add(url);changed();}
  });
  const unnavigated=cdp.on('Page.frameNavigated',event=>{
    if(event.frame.parentId) return;
    pageUrl=event.frame.url;urls.clear();changed();
  });
  try {
    // Set this before enabling so debugger statements cannot suspend startup.
    await cdp.send('Debugger.setSkipAllPauses',{skip:true});
    await cdp.send('Debugger.enable');
    enabled=true;
  } catch(e) {
    unparsed();unnavigated();
    try{await cdp.send('Debugger.disable');}catch{}
    throw e;
  }
  return {
    get urls(){return [...urls];},get revision(){return revision;},
    async stop(){unparsed();unnavigated();if(enabled&&!cdp.closed){try{await cdp.send('Debugger.disable');}catch{}}}
  };
}

export async function deliverObservedModules(cdp,discovery,previousRevision) {
  if(discovery.revision===previousRevision) return previousRevision;
  const revision=discovery.revision;
  const delivered=await cdp.evaluate(`(() => {
    const receiver=window.__CODEX_NEON_BOOT_V1__?.observeModuleUrls;
    if(typeof receiver!=='function') return false;
    receiver(${JSON.stringify(discovery.urls)});
    return true;
  })()`);
  // Do not consume the update if a new document's early overlay isn't ready yet.
  return delivered?revision:previousRevision;
}
