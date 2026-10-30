'use strict';

/* global window */

function createWorkflowLoader(contract, requestJson, resolveIdentity = () => null) {
  const cache = new Map(), pending = new Map(), latest = new Map();
  let generation = 0;
  function aborted(signal) {
    if (signal && signal.aborted) { contract.fail('WORKFLOW_CANCELLED'); }
  }
  async function read(request, signal) {
    aborted(signal);
    if (requestJson) { return requestJson(request, signal); }
    const bridge = typeof window !== 'undefined' && window.__OPENYIDA_YIDA_API__;
    if (bridge?.ready && typeof bridge[request.method] === 'function'
      && (!Array.isArray(bridge.availableMethods) || bridge.availableMethods.includes(request.method))) {
      const payload = await bridge[request.method]({ appType: request.appType, ...request.params });
      if (payload && payload.success === undefined && !payload.errorCode && !payload.error?.code
        && (Array.isArray(payload) || payload.processInstanceId || Array.isArray(payload.data))) {
        return { success: true, content: payload };
      }
      return payload;
    }
    const fetcher = typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    if (!fetcher) { contract.fail('TASK_API_UNAVAILABLE'); }
    const response = await fetcher(request.path + '?' + new URLSearchParams(request.params).toString(), {
      method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' }, signal,
    });
    if (!response || !response.ok || typeof response.json !== 'function') { contract.fail('WORKFLOW_REQUEST_FAILED'); }
    try { return await response.json(); } catch { contract.fail('WORKFLOW_RESPONSE_INVALID'); }
  }
  async function inspect(input, control = {}) {
    const target = contract.options(input), identity = resolveIdentity(), epoch = generation;
    const key = JSON.stringify([identity, target]);
    aborted(control.signal);
    if (control.refresh) { cache.delete(key); }
    const previous = cache.get(key);
    if (!control.refresh && identity && previous && Date.now() - previous.at < 30000) { return previous.value; }
    if (identity && !control.signal && !control.refresh && pending.has(key)) { return pending.get(key); }
    const token = {}; latest.set(key, token);
    const work = (async () => {
      const value = contract.detail(await read(contract.request('detail', target), control.signal), target);
      let history = { state: 'not-requested', items: [], error: null };
      if (target.history) {
        try {
          history = { state: 'ready', items: contract.history(await read(contract.request('history', target), control.signal), { ...target, ...(value.formUuid ? { formUuid: value.formUuid } : {}) }), error: null };
        } catch (error) {
          if (['WORKFLOW_SCOPE_MISMATCH', 'NEED_LOGIN', 'WORKFLOW_CANCELLED'].includes(error.code)) { throw error; }
          history = { state: 'error', items: [], error: { code: error.code || 'WORKFLOW_REQUEST_FAILED' } };
        }
      }
      aborted(control.signal);
      if (epoch !== generation) { contract.fail('WORKFLOW_CANCELLED'); }
      if (resolveIdentity() !== identity) { contract.fail('WORKFLOW_IDENTITY_CHANGED'); }
      const result = contract.combine(value, history, target);
      if (identity && history.state !== 'error' && latest.get(key) === token) {
        if (cache.size >= 64) { cache.delete(cache.keys().next().value); }
        cache.set(key, { at: Date.now(), value: result });
      }
      return result;
    })();
    if (identity && !control.signal) { pending.set(key, work); }
    try { return await work; } finally {
      if (pending.get(key) === work) { pending.delete(key); }
      if (latest.get(key) === token) { latest.delete(key); }
    }
  }
  inspect.clear = () => { generation++; cache.clear(); pending.clear(); latest.clear(); };
  return inspect;
}

module.exports = { createWorkflowLoader };
