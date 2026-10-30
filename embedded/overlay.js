// Evaluated in the renderer. All UI lives inside our Shadow DOM.
((options, readinessDecision, makeGate, presentStartup) => {
  'use strict';
  const KEY = '__CODEX_NEON_BOOT_V1__';
  if (window[KEY]?.dispose) window[KEY].dispose('replaced');
  if (!options.adapter.documentProtocols.includes(location.protocol)) return;
  if (/avatar|overlay-composition|picture-in-picture/i.test(location.pathname)) return;
  const start = performance.now();
  const ownTimers = new Set();
  let host, poll, ended = false, lastReason = '';
  const telemetry = { status:'waiting', reason:'initializing', attachedAt:Date.now(), samples:0, adapter:options.adapter.id };
  const native = { host:null, phases:null, hostReady:false, awaiting:false, loading:false, failed:false };
  const observedModuleUrls=new Set();
  const gate = makeGate({stableMs:options.stableMs,decide:readinessDecision});
  const later = (fn,ms) => { const t=setTimeout(() => { ownTimers.delete(t); fn(); },ms); ownTimers.add(t); return t; };
  function visible(el) {
    if (!el || !el.isConnected || el.closest('[data-codex-neon-boot]')) return false;
    const s=getComputedStyle(el), r=el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
  }
  const query = selectors => selectors.flatMap(s => { try { return [...document.querySelectorAll(s)]; } catch { return []; } });
  const exists = selectors => query(selectors).some(visible);
  function nativeReady() {
    const signal=options.adapter.nativeReadySignal;
    if (!signal) return null;
    if (signal.kind === 'visible-selector') return exists(signal.selectors);
    if (signal.kind === 'window-boolean-path') {
      let value=window;
      for (const key of signal.path) {
        if (!value || !Object.prototype.hasOwnProperty.call(value,key)) return false;
        const d=Object.getOwnPropertyDescriptor(value,key);
        if (!d || !('value' in d)) return false; // never invoke a private getter
        value=d.value;
      }
      return value === signal.equals;
    }
    if (signal.kind === 'codex-startup-modules') {
      if (!native.loading && (!native.host || !native.phases) && !native.failed) {
        // Only reuse module resources already requested by the app itself.
        // No guessed URLs, filesystem access, source rewriting, or reach() calls.
        const urls=[...observedModuleUrls,...performance.getEntriesByType('resource').map(e=>e.name)];
        const find=name=>urls.find(raw=>{try{const u=new URL(raw); return u.protocol===location.protocol && u.host===location.host && !u.username && !u.password && u.pathname.endsWith('/assets/'+name);}catch{return false;}});
        const hostUrl=find(signal.hostBundle), phaseUrl=find(signal.phaseBundle);
        native.hostUrlFound=Boolean(hostUrl);native.phaseUrlFound=Boolean(phaseUrl);
        if(hostUrl && phaseUrl) {
          native.loading=true;
          Promise.all([import(hostUrl),import(phaseUrl)]).then(([h,p])=>{
            if(ended) return;
            native.host=h; native.phases=p;
          }).catch(()=>{native.failed=true;native.errorReason='module-import-failed';}).finally(()=>{native.loading=false;});
        }
      }
      const api=native.host?.[signal.hostExport]?.startup;
      const phases=native.phases?.[signal.phaseExport];
      if(api && typeof api.whenReady==='function' && !native.awaiting) {
        native.awaiting=true;
        Promise.resolve().then(()=>api.whenReady()).then(()=>{if(!ended) native.hostReady=true;}).catch(()=>{native.failed=true;native.errorReason='native-ready-rejected';});
      }
      const known=['bootstrap','host_ready','window_created','renderer_ready','first_content_visible','background_ready'];
      const snapshot=phases && typeof phases.getSnapshot==='function' ? phases.getSnapshot() : null;
      const phaseReady=Boolean(known.includes(snapshot) && known.includes(signal.requiredPhase) && typeof phases.hasReached==='function' && phases.hasReached(signal.requiredPhase));
      telemetry.native={hostReady:native.hostReady,backgroundReady:phaseReady,phase:known.includes(snapshot)?snapshot:null,probeFailed:native.failed,
        hostUrlFound:!!native.hostUrlFound,phaseUrlFound:!!native.phaseUrlFound,hostModuleImported:!!native.host,phaseModuleImported:!!native.phases,
        hostApiFound:!!api,phaseStoreFound:!!phases,observedModuleCount:observedModuleUrls.size};
      return !native.failed && native.hostReady && phaseReady;
    }
    return null;
  }
  function facts() {
    const a=options.adapter;
    const shells=query(a.shellSelectors).filter(visible);
    const workComposers=query(a.composerSelectors);
    // Chat uses a ProseMirror editor without the work/home composer wrapper.
    // Scope it to the reviewed main surface; settings/dialog editors do not count.
    const chatComposers=query(a.chatComposerSelectors || []).filter(el=>
      shells.some(shell=>shell.contains(el)) && !el.closest('[role="dialog"], [aria-modal="true"]'));
    const interactive=el=>visible(el) && !el.disabled && !el.readOnly &&
      !el.closest('[inert], [aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]');
    const workReady=workComposers.some(interactive), chatReady=chatComposers.some(interactive);
    return {
      documentComplete:document.readyState === 'complete',
      shell:shells.length>0 && exists(a.sidebarSelectors),
      composer:workReady || chatReady,
      composerKind:workReady?'work':chatReady?'chat':null,
      blocked:exists(a.startupBlockerSelectors), auth:exists(a.authSelectors), error:exists(a.errorSelectors), nativeReady:nativeReady()
    };
  }
  function stopObservers() {
    if(poll) clearInterval(poll);
    for (const t of ownTimers) clearTimeout(t);
    ownTimers.clear();
    document.removeEventListener('keydown',onKey,true);
  }
  function release(reason) {
    if(ended) return;
    ended=true; stopObservers();
    telemetry.status=reason === 'ready' ? 'ready' : 'released-unconfirmed'; telemetry.reason=reason;
    telemetry.elapsedMs=Math.round(performance.now()-start);
    window[KEY]={telemetry,dispose:cleanupReason=>{if(cleanupReason!=='ready')host?.remove();}};
    if(host) {
      host.dataset.exit=reason;
      if(reason === 'ready') {
        const shadow=host.shadowRoot;
        shadow.querySelector('.status').textContent='WORKSPACE READY';
        shadow.querySelector('.detail').textContent='YOUR NEXT IDEA STARTS HERE';
        shadow.querySelector('.scene').dataset.state='ready';
        const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(() => host?.remove(),reduced?120:1000);
      } else host.remove();
    }
  }
  function onKey(e) { if(e.key === 'Escape') release('user-skip'); }
  function mount() {
    if(host || ended || !document.documentElement) return;
    host=document.createElement('div'); host.dataset.codexNeonBoot='1';
    // Never hide/inert/lock the host app. Pointer events pass through except Skip.
    host.style.cssText='position:fixed;inset:0;z-index:2147483000;pointer-events:none;isolation:isolate;animation:codex-neon-failsafe 1ms 120s forwards';
    const shadow=host.attachShadow({mode:'open'});
    const cssMatch=options.markup.match(/<style>([\s\S]*?)<\/style>/);
    if(cssMatch && typeof CSSStyleSheet==='function' && 'adoptedStyleSheets' in shadow) {
      const sheet=new CSSStyleSheet(); sheet.replaceSync(cssMatch[1]);
      shadow.adoptedStyleSheets=[sheet];
      shadow.innerHTML=options.markup.replace(cssMatch[0],'');
    } else shadow.innerHTML=options.markup;
    shadow.querySelector('button').addEventListener('click',() => release('user-skip'),{once:true});
    shadow.addEventListener('animationend',e => { if(e.animationName==='neon-expire') release('css-deadline'); });
    document.documentElement.appendChild(host);
    document.addEventListener('keydown',onKey,true);
  }
  function sample() {
    if(ended) return;
    try {
      const f=facts(), d=gate(f,performance.now());
      telemetry.samples++; telemetry.reason=d.reason;
      telemetry.facts=f;
      if(native.failed) {release(native.errorReason);return;}
      if(d.state==='error' || d.state==='needs-sign-in') { release(d.reason); return; }
      if(d.stable) { release('ready'); return; }
      mount();
      if(!host) return;
      const presentation=presentStartup(f,telemetry.native);
      const visualState=JSON.stringify(presentation);
      if(visualState!==lastReason) {
        lastReason=visualState;
        const shadow=host.shadowRoot;
        shadow.querySelector('.scene').dataset.stage=presentation.stage;
        shadow.querySelector('.status').textContent=presentation.title;
        shadow.querySelector('.detail').textContent=presentation.detail;
        for(const [name,on] of Object.entries(presentation.nodes)) {
          const node=shadow.querySelector(`[data-phase-node="${name}"]`);
          if(node){node.classList.toggle('is-on',on);node.setAttribute('aria-label',name+(on?' ready':' pending'));}
        }
        shadow.querySelector('.host-value').textContent=presentation.nodes.core?'ONLINE':'CONNECTING';
        shadow.querySelector('.workspace-value').textContent=presentation.nodes.workspace?'ONLINE':'WAITING';
        telemetry.visualStage=presentation.stage;
      }
      host.shadowRoot.querySelector('.elapsed').textContent=`T + ${((performance.now()-start)/1000).toFixed(1)}s`;
    } catch { release('renderer-probe-error'); }
  }
  function observeModuleUrls(urls) {
    const signal=options.adapter.nativeReadySignal;
    if(ended || signal?.kind!=='codex-startup-modules' || !Array.isArray(urls)) return;
    for(const raw of urls.slice(0,32)) {
      try {
        const u=new URL(raw);
        if(u.protocol===location.protocol&&u.host===location.host&&!u.username&&!u.password&&
          [signal.hostBundle,signal.phaseBundle].some(name=>u.pathname.endsWith('/assets/'+name))) observedModuleUrls.add(u.href);
      }catch{}
    }
    sample();
  }
  window[KEY]={telemetry,dispose:release,sample,observeModuleUrls};
  poll=setInterval(sample,120);
  later(() => release('readiness-timeout'),options.maxWaitMs);
  sample();
})(__OPTIONS__, __DECIDE__, __GATE__, __PRESENT__);
