// Standalone demo only. No Codex APIs or debugger connection.
let demoTimers=[],demoStart;
const template=document.querySelector('.scene').cloneNode(true);
const replay=document.querySelector('.preview-replay');
function previewState(facts,native) {
  const p=previewPresentation(facts,native),scene=document.querySelector('.scene');
  if(!scene)return;
  scene.dataset.stage=p.stage;
  scene.querySelector('.status').textContent=p.title;
  scene.querySelector('.detail').textContent=p.detail;
  scene.querySelector('.host-value').textContent=p.nodes.core?'ONLINE':'CONNECTING';
  scene.querySelector('.workspace-value').textContent=p.nodes.workspace?'ONLINE':'WAITING';
  for(const [name,on] of Object.entries(p.nodes))scene.querySelector(`[data-phase-node="${name}"]`).classList.toggle('is-on',on);
}
function schedule(fn,time){demoTimers.push(setTimeout(fn,time));}
function finishDemo(){
  const scene=document.querySelector('.scene');if(!scene)return;
  scene.dataset.state='ready';scene.querySelector('.status').textContent='WORKSPACE READY';scene.querySelector('.detail').textContent='YOUR NEXT IDEA STARTS HERE';
  schedule(()=>{scene.remove();replay.hidden=false;},1000);
}
function setup(){
  for(const timer of demoTimers)clearTimeout(timer);demoTimers=[];
  document.querySelector('.scene')?.remove();document.body.appendChild(template.cloneNode(true));replay.hidden=true;
  const scene=document.querySelector('.scene'),button=scene.querySelector('button');
  button.textContent='REPLAY ↻';button.setAttribute('aria-label','Replay animation');
  scene.querySelector('footer span').textContent='ANIMATION DEMO / NOT CONNECTED TO CODEX';
  previewState({documentComplete:false,shell:false,composer:false,nativeReady:false},{});
  schedule(()=>previewState({documentComplete:true,shell:true,composer:false,nativeReady:false},{hostReady:false}),1800);
  schedule(()=>previewState({documentComplete:true,shell:true,composer:true,nativeReady:false},{hostReady:true,backgroundReady:false}),4200);
  schedule(()=>previewState({documentComplete:true,shell:true,composer:true,nativeReady:true},{hostReady:true,backgroundReady:true}),10000);
  schedule(finishDemo,11000);
}
document.addEventListener('click',e=>{if(e.target.closest('button'))setup();});
setup();
