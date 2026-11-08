export function setImmediate(value, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancel = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve(value);
    }, 0);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
