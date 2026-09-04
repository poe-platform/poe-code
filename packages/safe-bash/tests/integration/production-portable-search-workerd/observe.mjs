// Observe the package-owned endpoint without replacing matching or retirement.
export function observeProvider(provider, onRequest) {
  const evidence = { created: 0, posted: 0, replies: 0, cancelled: 0, pending: 0, listeners: 0, retiring: 0, retired: 0 };
  return {
    evidence,
    createWorker(options) {
      const endpoint = provider.createWorker(options);
      evidence.created++;
      const pending = new Set();
      const subscriptions = new Map();
      let retirement;
      const observeMessage = value => {
        if (value?.ready === true) return;
        if (!pending.delete(value?.id)) throw new Error("duplicate or unsolicited production-provider reply");
        evidence.pending--;
        evidence.replies++;
      };
      endpoint.on("message", observeMessage);
      evidence.listeners++;
      return {
        postMessage(request) {
          if (pending.has(request.id)) throw new Error("duplicate acceptance request ID");
          pending.add(request.id);
          evidence.pending++;
          evidence.posted++;
          try { endpoint.postMessage(request); }
          catch (error) {
            pending.delete(request.id);
            evidence.pending--;
            evidence.posted--;
            throw error;
          }
          onRequest?.(request, evidence);
        },
        on(event, listener) {
          let listeners = subscriptions.get(event);
          if (!listeners) { listeners = new Set(); subscriptions.set(event, listeners); }
          if (!listeners.has(listener)) { listeners.add(listener); evidence.listeners++; }
          return endpoint.on(event, listener);
        },
        off(event, listener) {
          if (subscriptions.get(event)?.delete(listener)) evidence.listeners--;
          return endpoint.off(event, listener);
        },
        terminate() {
          if (!retirement) {
            evidence.retiring++;
            retirement = endpoint.terminate().then(value => {
              evidence.retiring--;
              evidence.retired++;
              evidence.cancelled += pending.size;
              evidence.pending -= pending.size;
              pending.clear();
              endpoint.off("message", observeMessage);
              evidence.listeners--;
              return value;
            });
          }
          return retirement;
        },
        ref() { return endpoint.ref?.(); },
        unref() { return endpoint.unref?.(); },
      };
    },
  };
}
