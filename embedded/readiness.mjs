// Pure policy: no timers, DOM access or private app APIs.
export function readinessDecision(facts) {
  if (facts.error) return { state: 'error', ready: false, reason: 'startup-error-visible' };
  if (facts.auth) return { state: 'needs-sign-in', ready: false, reason: 'authentication-required' };
  if (!facts.documentComplete) return { state: 'document', ready: false, reason: 'document-loading' };
  if (!facts.shell) return { state: 'shell', ready: false, reason: 'shell-not-mounted' };
  if (facts.blocked) return { state: 'services', ready: false, reason: 'startup-blocker-visible' };
  if (!facts.composer) return { state: 'workspace', ready: false, reason: 'composer-not-interactive' };
  // An adapter must explicitly confirm the native startup boundary.
  // DOM readiness alone never claims all native services are ready.
  if (facts.nativeReady !== true) return { state: 'confirming', ready: false, reason: 'native-readiness-unconfirmed' };
  return { state: 'ready', ready: true, reason: 'native-and-interface-ready' };
}

export function createReadinessGate({ stableMs = 900, decide = readinessDecision } = {}) {
  let since = null;
  return (facts, now) => {
    const decision = decide(facts);
    if (!decision.ready) since = null;
    else if (since === null) since = now;
    return { ...decision, stable: decision.ready && now - since >= stableMs };
  };
}
