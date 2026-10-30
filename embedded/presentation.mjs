// Presentation only: never changes readiness or advances native startup phases.
export function startupPresentation(facts,native={}) {
  const nodes={interface:!!facts.shell,core:native.hostReady===true,workspace:!!(native.hostReady&&facts.composer&&native.backgroundReady&&facts.nativeReady&&!facts.blocked&&!facts.auth&&!facts.error)};
  if(!facts.documentComplete||!facts.shell) return {stage:'initializing',title:'INITIALIZING',detail:'ESTABLISHING THE INTERFACE',nodes};
  if(native.hostReady!==true) return {stage:'core',title:'CONNECTING THE CORE',detail:'WAITING FOR NATIVE SERVICES',nodes};
  if(!nodes.workspace) return {stage:'workspace',title:'PREPARING WORKSPACE',detail:'BRINGING YOUR TOOLS ONLINE',nodes};
  return {stage:'finalizing',title:'FINALIZING',detail:'CONFIRMING WORKSPACE READINESS',nodes};
}
