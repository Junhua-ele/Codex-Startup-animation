import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {Cdp,validateSocket,fetchDebugJson} from './cdp.mjs';
import {readinessDecision,createReadinessGate} from './readiness.mjs';
import {observeExecutedModules,deliverObservedModules} from './module-discovery.mjs';
import {startupPresentation} from './presentation.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function eligibleTarget(t,port) {
  try {
    const u=new URL(t.url);
    if(t.type!=='page' || u.protocol!=='app:' || /avatar|overlay-composition|picture-in-picture/i.test(u.pathname)) return false;
    validateSocket(t.webSocketDebuggerUrl,port,'page',t.id);
    return true;
  } catch { return false; }
}
export function buildPayload({adapter,markup,runtime,maxWaitMs=60000,stableMs=900}) {
  if(!Number.isFinite(maxWaitMs) || maxWaitMs<1000 || maxWaitMs>120000) throw new Error('Invalid startup deadline');
  const options={adapter,markup,maxWaitMs,stableMs};
  return runtime.replace('__OPTIONS__',()=>JSON.stringify(options))
    .replace('__DECIDE__',()=>readinessDecision.toString()).replace('__GATE__',()=>createReadinessGate.toString())
    .replace('__PRESENT__',()=>startupPresentation.toString());
}
export async function run(sessionFile, {maxWaitMs=60000}={}) {
  const info=JSON.parse((await readFile(sessionFile,'utf8')).replace(/^\uFEFF/,''));
  if(info.schema!==1 || !Number.isInteger(info.port) || !/^[A-Za-z0-9_-]+$/.test(info.browserId || '')) throw new Error('Invalid verified launch record');
  const [adapter,markup,runtime]=await Promise.all([
    readFile(join(here,'adapter.json'),'utf8').then(JSON.parse),readFile(join(here,'overlay.html'),'utf8'),readFile(join(here,'overlay.js'),'utf8')
  ]);
  if(!adapter.supportedVersions.includes(info.packageVersion)) throw new Error('This Codex version has no reviewed startup adapter');
  const payload=buildPayload({adapter,markup,runtime,maxWaitMs});
  const version=await fetchDebugJson(info.port,'/json/version');
  const endpoint=validateSocket(version.webSocketDebuggerUrl,info.port,'browser',info.browserId);
  const anchor=await Cdp.open(endpoint.url);
  let page,pageUrl,early,discovery,discoveryRevision=-1,exitReason='not-attached',lastReason='',stopped=false;
  const log=event=>console.log(JSON.stringify({time:new Date().toISOString(),...event}));
  const stop=()=>{stopped=true;};
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  const started=Date.now();
  try {
    // A closed identity anchor is terminal. Never reconnect to a reused port.
    while(!stopped && !anchor.closed && Date.now()-started<10000 && !page) {
      const [v,targets]=await Promise.all([fetchDebugJson(info.port,'/json/version'),fetchDebugJson(info.port,'/json/list')]);
      validateSocket(v.webSocketDebuggerUrl,info.port,'browser',info.browserId);
      if(!Array.isArray(targets)) throw new Error('Invalid page discovery result');
      const eligible=targets.filter(t=>eligibleTarget(t,info.port));
      // No guessing when multiple app pages exist. Avoid injecting a secondary tool window.
      const candidates=eligible.filter(t=>!/[?&]initialRoute=(?:%2F|\/)avatar/i.test(t.url));
      if(candidates.length===1) {
        const t=candidates[0];
        pageUrl=t.url;
        page=await Cdp.open(validateSocket(t.webSocketDebuggerUrl,info.port,'page',t.id).url);
      } else await wait(80);
    }
    if(!page) throw new Error('No unique verified Codex page became available');
    await page.send('Page.enable');
    // Do not pause targets, reload Codex, or wait for a debugger before app startup.
    const added=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:payload});
    early=added.identifier;
    // Metadata only: recover module URLs even if app: resource timings are absent.
    try{discovery=await observeExecutedModules(page,adapter,pageUrl);}
    catch{log({event:'module-discovery-unavailable'});}
    if(anchor.closed) throw new Error('Original Codex process disconnected');
    try { await page.evaluate(payload); } catch(e) { if(e.cdpCode!==-32000) throw e; }
    log({event:'attached',adapter:adapter.id,nativeSignalConfigured:Boolean(adapter.nativeReadySignal),versionMatched:true,runtimeValidated:adapter.runtimeValidated});
    while(!stopped && !anchor.closed && !page.closed && Date.now()-started<maxWaitMs+10000) {
      let state;
      try {
        if(discovery && discovery.revision!==discoveryRevision) {
          discoveryRevision=await deliverObservedModules(page,discovery,discoveryRevision);
        }
        state=await page.evaluate('window.__CODEX_NEON_BOOT_V1__?.telemetry ?? null');
      }
      catch(e) { if(e.cdpCode===-32000 && !anchor.closed && !page.closed) {await wait(150);continue;} throw e; }
      const stateKey=state && JSON.stringify([state.reason,state.native]);
      if(state && stateKey!==lastReason) {
        lastReason=stateKey;
        log({event:'startup-state',status:state.status,reason:state.reason,elapsedMs:state.elapsedMs??Date.now()-started,facts:state.facts??null,native:state.native??null});
      }
      if(state?.status==='ready' || state?.status==='released-unconfirmed') { exitReason=state.reason; break; }
      await wait(180);
    }
    if(exitReason==='not-attached') exitReason=stopped?'controller-stopped':anchor.closed?'codex-closed':'controller-timeout';
    log({event:'finished',reason:exitReason,confirmedReady:exitReason==='ready'});
    return exitReason==='ready' || exitReason==='user-skip' ? 0 : 2;
  } finally {
    if(discovery) await discovery.stop();
    if(page && !page.closed) {
      try { await page.evaluate(`window.__CODEX_NEON_BOOT_V1__?.dispose(${JSON.stringify(exitReason)})`); } catch {}
      if(early) { try { await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:early}); } catch {} }
      page.close();
    }
    anchor.close();
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const index=process.argv.indexOf('--session');
  if(index<0 || !process.argv[index+1]) { console.error('Usage: node embedded/injector.mjs --session verified-session.json'); process.exitCode=1; }
  else run(process.argv[index+1]).then(code=>{process.exitCode=code;}).catch(()=>{ console.error('Embedded startup could not attach. Codex was not modified or terminated.'); process.exitCode=1; });
}
