import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightStorageState } from './adapter.js';

const storageMaxNodes = 100000;
const storageMaxDepth = 64;

/** Count JSON values without allocating their graph. JSON.parse still checks syntax. */
export function parsePlaywrightStorageStateJson(source: string, maxBytes: number, options: { maxTraversalBytes?: number; maxNodes?: number; maxDepth?: number } = {}): PlaywrightStorageState {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("Invalid storage state limits");
  if (new TextEncoder().encode(source).byteLength > maxBytes) throw new PlaywrightResourceLimitError("Browser storage state byte limit exceeded");
  let nodes = 0, depth = 0;
  const whitespace = (char: string | undefined): boolean => char === ' ' || char === '\n' || char === '\r' || char === '\t';
  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (whitespace(char) || char === ',' || char === ':') { index++; continue; }
    if (char === ']' || char === '}') { depth--; index++; continue; }
    const valueDepth = depth;
    if (char === '[' || char === '{') { depth++; index++; }
    else if (char === '"') {
      index++;
      while (index < source.length) {
        const next = source[index++];
        if (next === '\\') index++;
        else if (next === '"') break;
      }
      while (whitespace(source[index])) index++;
      if (source[index] === ':') continue; // Object keys are not child values.
    } else {
      do { index++; } while (index < source.length && !whitespace(source[index]) && !',:[]{}'.includes(source[index]!));
    }
    if (++nodes > storageMaxNodes || valueDepth > storageMaxDepth) throw new PlaywrightResourceLimitError('Browser storage state structure limit exceeded');
  }
  return parsePlaywrightStorageState(JSON.parse(source), { maxBytes, ...options });
}

/** Validate the portable native storage-state format before handing it to a browser. */
export function parsePlaywrightStorageState(value: unknown, options: { maxBytes?: number; maxTraversalBytes?: number; maxNodes?: number; maxDepth?: number } = {}): PlaywrightStorageState {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxTraversalBytes = options.maxTraversalBytes ?? Math.min(Number.MAX_SAFE_INTEGER, maxBytes * 4 + 65536);
  const maxNodes = options.maxNodes ?? storageMaxNodes;
  const maxDepth = options.maxDepth ?? storageMaxDepth;
  if (![maxBytes, maxTraversalBytes, maxNodes, maxDepth].every(limit => Number.isSafeInteger(limit) && limit > 0)) throw new TypeError('Invalid storage state limits');
  const encoder = new TextEncoder();
  const checkByteLimits = () => {
    if (serializedBytes > maxBytes || traversalBytes > maxTraversalBytes) {
      throw new PlaywrightResourceLimitError('Browser storage state byte limit exceeded');
    }
  };
  let nodes = 0, serializedBytes = 0, traversalBytes = 0;
  const ancestors = new Set<object>();
  const json = (input: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > maxDepth) throw new PlaywrightResourceLimitError('Browser storage state structure limit exceeded');
    let output = input;
    if (typeof input === 'string') {
      traversalBytes += encoder.encode(input).length;
      serializedBytes += encoder.encode(JSON.stringify(input)).length;
    } else if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) {
      traversalBytes += 8;
      serializedBytes += String(input).length;
    } else if (typeof input === 'object' && input !== null) {
      if (ancestors.has(input)) throw new Error('Invalid cyclic browser storage state');
      ancestors.add(input);
      const isArray = Array.isArray(input);
      // Admit length before ownKeys or descriptor tables can amplify the array.
      if (isArray && input.length > maxNodes - nodes) throw new PlaywrightResourceLimitError('Browser storage state structure limit exceeded');
      output = isArray ? [] : {};
      const keys = Reflect.ownKeys(input);
      serializedBytes += 2;
      checkByteLimits();
      let index = 0;
      let memberCount = 0;
      for (const key of keys) {
        if (typeof key !== 'string') throw new Error('Invalid browser storage state key');
        if (isArray && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor) throw new Error('Invalid browser storage state property');
        if (!('value' in descriptor)) throw new Error('Invalid browser storage state accessor');
        if (!descriptor.enumerable || isArray && key !== String(index++)) throw new Error('Invalid browser storage state property');
        traversalBytes += encoder.encode(key).length + 4;
        if (memberCount++ > 0) serializedBytes += 1;
        if (!isArray) serializedBytes += encoder.encode(JSON.stringify(key)).length + 1;
        checkByteLimits();
        Object.defineProperty(output, key, { value: json(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      if (isArray && index !== input.length) throw new Error('Invalid browser storage state array');
      ancestors.delete(input);
    } else throw new Error('Invalid browser storage state value');
    checkByteLimits();
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
