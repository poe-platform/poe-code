import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./toolcraft-schema-rust.node");
export const nativeJsonSchema = Symbol("toolcraft.nativeJsonSchema");
const arrayEvery = Array.prototype.every;

// ECMAScript operations that may execute caller code stay in the caller realm.
// Validation decisions, traversal, defaults and diagnostics are owned by Rust.
const dslOperations = {
  isTrue: (value) => Number(value === true),
  truthy: (value) => Number(Boolean(value)),
  stringify: String,
  template: (value) => `${value}`,
  sameValue: Object.is,
  strictEqual: (left, right) => left === right,
  less: (left, right) => left < right,
  greater: (left, right) => left > right,
  hasOwn: Object.hasOwn,
  entries: Object.entries,
  object: () => ({}),
  array: (...values) => values,
  denseArray: (value) => Array.from({ length: value.length }),
  issue: (path, expected, received, message) => ({ path, expected, received, message }),
  success: (value) => ({ ok: true, value }),
  failure: (issues) => ({ ok: false, issues }),
  includes: (values, value) => values.includes(value),
  joinComma: (values) => values.join(", "),
  joinPipe: (values) => values.join(" | "),
  jsonStringify: JSON.stringify,
  isBuiltinEvery: (method) => method === arrayEvery,
  hasProperty: (value, key) => key in value,
  iterationLength: (value) => {
    const length = +value.length;
    return Number.isNaN(length)
      ? 0
      : Math.min(Math.max(Math.trunc(length), 0), Number.MAX_SAFE_INTEGER);
  },
  everyEqual: (method, left, right) =>
    Reflect.apply(method, left, [(value, index) => invoke(native.deepEqual, value, right[index])]),
  someEqual: (values, value) =>
    values.some((candidate) => invoke(native.deepEqual, value, candidate)),
  filterCandidates: (branches, value) =>
    branches.filter((branch) => invoke(native.hasRequiredKeys, branch, value)),
  mapFingerprints: (branches) =>
    branches.map((branch) => invoke(native.requiredFingerprint, branch)),
  iterator: function* (values) {
    // Let the host retain its iterator record, including the captured next
    // method and IteratorClose semantics. Rust drives each advancement.
    for (const value of values) yield value;
  },
  next: (iterator) => iterator.next(),
  closeIterator: (iterator) => {
    try {
      const method = iterator.return;
      if (method !== undefined && method !== null) Reflect.apply(method, iterator, []);
    } catch {
      /* IteratorClose preserves the original body exception. */
    }
  },
  getNative: (schema, symbol) => schema[symbol],
  validateOverride: (metadata, value) => metadata.validator.validate(value),
  prefixIssues: (issues, path) =>
    issues.map((issue) => ({ ...issue, path: [...path, ...issue.path] })),
  isJson: isJsonValue,
  cloneDefault: cloneDefaultValue,
  structuredCloneAttempt: (value) => {
    try {
      return [true, structuredClone(value)];
    } catch (error) {
      return [false, error];
    }
  },
  isDataCloneError: (error) => error instanceof Error && error.name === "DataCloneError",
  throwValue: (value) => {
    throw value;
  },
  compilePattern: (pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      return undefined;
    }
  },
  testPattern: (pattern, value) => pattern.test(value),
  invalidWalkResult: () => {
    const result = undefined;
    return result.present;
  },
  stackOverflow: () => {
    throw new RangeError("Maximum call stack size exceeded");
  }
};

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
    operate: (name, args) => dslOperations[name](...args),
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

export function createValidator(symbol) {
  return function validate(schema, value, options = {}) {
    return invoke(native.validate, schema, value, options.defaults ?? "optional", symbol);
  };
}

export const validate = createValidator(nativeJsonSchema);

export function isPlainRecord(value) {
  return invoke(native.isPlainRecord, value);
}
