// Per-worker wire identities preserve canonical scope equality without serializing
// opaque tokens or truncating arbitrary canonical device numbers to wasm32.
export function createReplySerializer() {
  const scopes = new Map();
  let nextDevice = 0;
  return value => JSON.stringify(value ?? null, (_key, item) => {
    if (!item || typeof item !== 'object') return item;
    const scope = item.identityScope;
    if (!(typeof scope === 'symbol' || scope !== null && typeof scope === 'object') ||
        !Number.isSafeInteger(item.dev) || item.dev < 0 ||
        !Number.isSafeInteger(item.ino) || item.ino < 0) return item;
    let devices = scopes.get(scope);
    if (!devices) { devices = new Map(); scopes.set(scope, devices); }
    let device = devices.get(item.dev);
    if (device === undefined) {
      if (nextDevice === 0x7fffffff) throw new Error('guest device identity space exhausted');
      device = ++nextDevice;
      devices.set(item.dev, device);
    }
    return { ...item, identityScope: undefined, dev: device };
  });
}
