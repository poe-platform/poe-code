import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightStorageState } from './adapter.js';

/** Validate the portable native storage-state format before handing it to a browser. */
export function parsePlaywrightStorageState(value: unknown, options: { maxBytes?: number; maxNodes?: number; maxDepth?: number } = {}): PlaywrightStorageState {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxNodes = options.maxNodes ?? 100000;
  const maxDepth = options.maxDepth ?? 64;
  if (![maxBytes, maxNodes, maxDepth].every(limit => Number.isSafeInteger(limit) && limit > 0)) throw new TypeError('Invalid storage state limits');
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const json = (input: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > maxDepth) throw new PlaywrightResourceLimitError('Browser storage state structure limit exceeded');
    let output = input;
    if (typeof input === 'string') bytes += new TextEncoder().encode(input).length;
    else if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) bytes += 8;
    else if (typeof input === 'object' && input !== null) {
      if (ancestors.has(input)) throw new Error('Invalid cyclic browser storage state');
      ancestors.add(input);
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) throw new Error('Invalid browser storage state key');
      const isArray = Array.isArray(input);
      output = isArray ? [] : {};
      let index = 0;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (isArray && key === 'length') continue;
        if (!('value' in descriptor)) throw new Error('Invalid browser storage state accessor');
        if (!descriptor.enumerable || isArray && key !== String(index++)) throw new Error('Invalid browser storage state property');
        bytes += new TextEncoder().encode(key).length + 4;
        Object.defineProperty(output, key, { value: json(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      if (isArray && index !== descriptors.length!.value) throw new Error('Invalid browser storage state array');
      ancestors.delete(input);
    } else throw new Error('Invalid browser storage state value');
    if (bytes > maxBytes) throw new PlaywrightResourceLimitError('Browser storage state byte limit exceeded');
    return output;
  };
  // Validate the same owned data that will reach the native provider. Inherited
  // properties and later caller mutations must not escape the traversal bounds.
  const normalized = json(value, 0);
  const record = (input: unknown, keys: string[]): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Invalid browser storage state object');
    return input as Record<string, unknown>;
  };
  const string = (input: unknown): void => { if (typeof input !== 'string') throw new Error('Invalid browser storage state string'); };
  const boolean = (input: unknown): void => { if (typeof input !== 'boolean') throw new Error('Invalid browser storage state boolean'); };
  const array = (input: unknown): unknown[] => { if (!Array.isArray(input)) throw new Error('Invalid browser storage state array'); return input; };
  const root = record(normalized, ['cookies', 'origins']);
  for (const input of array(root.cookies)) {
    const cookie = record(input, ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite', 'partitionKey', '_crHasCrossSiteAncestor']);
    for (const key of ['name', 'value', 'domain', 'path']) string(cookie[key]);
    if (typeof cookie.expires !== 'number' || !Number.isFinite(cookie.expires)) throw new Error('Invalid browser storage cookie expiry');
    boolean(cookie.httpOnly); boolean(cookie.secure);
    if (!['Strict', 'Lax', 'None'].includes(cookie.sameSite as string)) throw new Error('Invalid browser storage cookie sameSite');
    if (cookie.partitionKey !== undefined) string(cookie.partitionKey);
    if (cookie._crHasCrossSiteAncestor !== undefined) boolean(cookie._crHasCrossSiteAncestor);
  }
  const keyPath = (item: Record<string, unknown>): void => {
    if (item.keyPath !== undefined) string(item.keyPath);
    if (item.keyPathArray !== undefined) for (const key of array(item.keyPathArray)) string(key);
  };
  for (const input of array(root.origins)) {
    const origin = record(input, ['origin', 'localStorage', 'indexedDB']);
    string(origin.origin);
    const url = new URL(origin.origin as string);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.origin) throw new Error('Invalid browser storage origin');
    for (const input of array(origin.localStorage)) {
      const item = record(input, ['name', 'value']); string(item.name); string(item.value);
    }
    if (origin.indexedDB !== undefined) for (const input of array(origin.indexedDB)) {
      const database = record(input, ['name', 'version', 'stores']);
      string(database.name);
      if (!Number.isSafeInteger(database.version) || (database.version as number) < 1) throw new Error('Invalid browser IndexedDB version');
      for (const input of array(database.stores)) {
        const store = record(input, ['name', 'autoIncrement', 'keyPath', 'keyPathArray', 'records', 'indexes']);
        string(store.name); boolean(store.autoIncrement); keyPath(store);
        for (const input of array(store.records)) record(input, ['key', 'keyEncoded', 'value', 'valueEncoded']);
        for (const input of array(store.indexes)) {
          const index = record(input, ['name', 'keyPath', 'keyPathArray', 'multiEntry', 'unique']);
          string(index.name); keyPath(index); boolean(index.multiEntry); boolean(index.unique);
        }
      }
    }
  }
  return normalized as PlaywrightStorageState;
}
