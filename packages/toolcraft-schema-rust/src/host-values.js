import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./toolcraft-schema-rust.node");

// Retain ECMAScript enumeration and descriptor operations in the host realm.
// This generator only exposes properties; Rust controls graph admission and DFS.
function* properties(item) {
  if (Array.isArray(item)) {
    for (let index = 0; index < item.length; index++) {
      yield Object.getOwnPropertyDescriptor(item, String(index));
    }
  } else {
    for (const key in item) {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (property !== undefined) yield property;
    }
  }
}

function descriptorParts(descriptor) {
  if (descriptor === undefined) return [0];
  return "value" in descriptor ? [1, descriptor.value] : [2];
}

function invoke(operation, value, ...args) {
  const copies = new WeakMap();
  const ancestors = new Set();
  const thrownValues = new WeakMap();
  const operations = {
    isArray: Array.isArray,
    prototype: Object.getPrototypeOf,
    isObjectPrototype: (value) => value === Object.prototype,
    keys: Object.keys,
    get: (value, key) => value[key],
    define: (target, key, value) =>
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      }),
    newArray: (source) => new Array(source.length),
    newObject: Object.create,
    copyGet: (source) => copies.get(source),
    copySet: (source, copy) => copies.set(source, copy),
    ancestorHas: (value) => ancestors.has(value),
    ancestorAdd: (value) => ancestors.add(value),
    ancestorDelete: (value) => ancestors.delete(value),
    descriptor: (value, key) => descriptorParts(Object.getOwnPropertyDescriptor(value, key)),
    properties,
    nextProperty: (iterator) => {
      const next = iterator.next();
      return next.done ? undefined : descriptorParts(next.value);
    },
    lengthExceeds: (value, remaining) => value.length > remaining
  };
  const host = Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [
      name,
      (...args) => {
        try {
          return operation(...args);
        } catch (value) {
          // napi-rs otherwise converts non-Error thrown values. Do not stringify
          // them: even their coercion hooks can throw or mutate the caller graph.
          const carrier = new Error("Schema host operation failed");
          thrownValues.set(carrier, value);
          throw carrier;
        }
      }
    ])
  );
  try {
    return operation(value, ...args, host);
  } catch (error) {
    if (thrownValues.has(error)) throw thrownValues.get(error);
    throw error;
  }
}

export function cloneDefaultValue(value) {
  return invoke(native.cloneDefaultValue, value);
}

export function isJsonValue(value, options = {}) {
  const maxNodes = options.maxNodes ?? 10_000;
  const maxDepth = options.maxDepth ?? 64;
  return invoke(native.isJsonValue, value, maxNodes, maxDepth);
}
