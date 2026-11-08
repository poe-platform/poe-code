/** Count a provider JSON record without first allocating its serialized form. */
export function traceRecordBytes(value: unknown, maximum: number, change?: { target: object; key: PropertyKey; value: unknown; reached?: boolean }): number {
  let bytes = 0;
  const string = (text: string) => {
    bytes += 2;
    for (let index = 0; index < text.length && bytes <= maximum; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92) bytes += 2;
      else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
      else if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; } else bytes += 6;
      } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
    }
  };
  const visit = (item: unknown) => {
    if (bytes > maximum) return;
    if (item === null || item === undefined) { bytes += 4; return; }
    if (typeof item === "string") { string(item); return; }
    if (typeof item === "number" || typeof item === "boolean") { bytes += JSON.stringify(item).length; return; }
    if (item instanceof Date) { string(item.toISOString()); return; }
    if (typeof item !== "object") throw new Error("Unsupported native trace record value");
    if (change?.target === item) change.reached = true;
    bytes += 2;
    const object = item as Record<PropertyKey, unknown>;
    const get = (key: PropertyKey) => change?.target === item && change.key === key ? change.value : object[key];
    if (Array.isArray(item)) {
      let length = change?.target === item && change.key === "length" ? Number(change.value) : item.length;
      if (change?.target === item && typeof change.key === "string") {
        const index = Number(change.key);
        if (Number.isInteger(index) && index >= 0 && String(index) === change.key) length = Math.max(length, index + 1);
      }
      for (let index = 0; index < length && bytes <= maximum; index++) { if (index) bytes++; visit(get(String(index))); }
    } else {
      let count = 0;
      const member = (key: string) => {
        const child = get(key);
        if (child === undefined) return;
        if (count++) bytes++;
        string(key); bytes++; visit(child);
      };
      for (const key in item) {
        if (bytes > maximum) return;
        if (Object.hasOwn(item, key)) member(key);
      }
      if (change?.target === item && typeof change.key === "string" && !Object.hasOwn(item, change.key)) member(change.key);
    }
  };
  visit(value);
  return bytes;
}

/** The pinned HAR recorder mutates plain JSON records after request admission.
 * All subsequent references must use value, including its stored request symbol. */
export function guardTraceRecord<T extends object>(source: T, maximum: number, admit: (bytes: number) => boolean): { value: T; stop(): void } {
  // Native headers and cookies can be borrowed from browser request objects.
  // Clone only after admission so retirement never modifies those aliases.
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value);
    if (Array.isArray(value)) return value.map(copy);
    const result: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(value)) result[key] = copy(Reflect.get(value, key));
    return result;
  };
  const root = copy(source) as T;
  const clear = (value: unknown) => {
    if (!value || typeof value !== "object" || value instanceof Date) return;
    for (const key of Reflect.ownKeys(value)) {
      const child = Reflect.get(value, key);
      if (typeof child === "string") Reflect.set(value, key, "");
      else clear(child);
    }
    if (Array.isArray(value)) value.length = 0;
  };
  const proxies = new WeakMap<object, object>();
  const targets = new WeakMap<object, object>();
  let active = true;
  const wrap = (target: object): object => {
    if (target instanceof Date) return target;
    const previous = proxies.get(target);
    if (previous) return previous;
    const proxy = new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key);
        return value && typeof value === "object" ? wrap(value) : value;
      },
      set(object, key, proposed) {
        if (!active) return true;
        const value = proposed && typeof proposed === "object" ? targets.get(proposed) ?? proposed : proposed;
        const change = { target: object, key, value, reached: false };
        const bytes = traceRecordBytes(root, maximum, change);
        if (!change.reached || !admit(bytes)) return true;
        const replacement = copy(value);
        clear(Reflect.get(object, key));
        return Reflect.set(object, key, replacement);
      },
      deleteProperty(object, key) {
        if (!active) return true;
        const change = { target: object, key, value: undefined, reached: false };
        const bytes = traceRecordBytes(root, maximum, change);
        if (!change.reached || !admit(bytes)) return true;
        clear(Reflect.get(object, key));
        return Reflect.deleteProperty(object, key);
      },
    });
    proxies.set(target, proxy); targets.set(proxy, target);
    return proxy;
  };
  return {
    value: wrap(root) as T,
    stop() {
      active = false;
      clear(root);
    },
  };
}
