import { bindOtelSpan, getBoundOtelSpan } from "../observability/otel.js";
import { SandboxError } from "./budget.js";
import { observeSandboxPromise, trackSandboxPromise } from "./promise-tracker.js";
import { promiseReplayContext } from "./promise-replay.js";
import { parseRegex } from "./regex/parse.js";
import { assertSandboxDataDepth } from "../graph-depth.js";
import { copySandboxArgumentProperties, createSandboxArguments, getSandboxArgumentEntries, isSandboxArguments } from "./arguments.js";
export { createSandboxArguments, isSandboxArguments } from "./arguments.js";
const sandboxClosureBrand = Symbol("SandboxClosure");
const sandboxGeneratorBrand = Symbol("SandboxGenerator");
const sandboxMapBrand = Symbol("SandboxMap");
const sandboxPromiseBrand = Symbol("SandboxPromise");
const sandboxRegexBrand = Symbol("SandboxRegex");
const sandboxRegexPattern = Symbol("SandboxRegexPattern");
const sandboxSetBrand = Symbol("SandboxSet");
const sandboxRetainedValues = Symbol("SandboxRetainedValues");
export function createSandboxClosure(input) {
    const closure = {
        kind: "fn",
        call: input.call,
        name: input.name,
        ...(input.construct === undefined ? {} : { construct: input.construct }),
        ...(input.async === true ? { async: true } : {})
    };
    Object.defineProperty(closure, sandboxClosureBrand, {
        enumerable: false,
        value: true
    });
    if (input.properties !== undefined) {
        Object.defineProperty(closure, "properties", {
            enumerable: false,
            value: Object.freeze(typeof input.properties === "function" ? input.properties(closure) : input.properties)
        });
    }
    if (input.retainedValues !== undefined) {
        Object.defineProperty(closure, sandboxRetainedValues, {
            value: input.retainedValues
        });
    }
    return Object.freeze(closure);
}
export function createSandboxPromise(promise, metadata = {}) {
    const sandboxPromise = {
        kind: "promise",
        promise: metadata.trackReplay === false
            ? promise
            : (promiseReplayContext.getStore()?.track(promise) ?? promise)
    };
    Object.defineProperty(sandboxPromise, sandboxPromiseBrand, {
        enumerable: false,
        value: true
    });
    Object.defineProperty(sandboxPromise, Symbol.toStringTag, { value: "Promise" });
    if (metadata.span !== undefined) {
        Object.defineProperty(sandboxPromise, "span", {
            value: metadata.span
        });
    }
    if (metadata.synchronousPrefix !== undefined) {
        Object.defineProperty(sandboxPromise, "synchronousPrefix", {
            value: metadata.synchronousPrefix
        });
    }
    if (metadata.hostCall !== undefined) {
        Object.defineProperty(sandboxPromise, "hostCall", { value: metadata.hostCall });
    }
    if (metadata.hostCallJournal !== undefined) {
        Object.defineProperty(sandboxPromise, "hostCallJournal", {
            value: metadata.hostCallJournal
        });
    }
    trackSandboxPromise(sandboxPromise);
    return Object.freeze(sandboxPromise);
}
export function createSandboxGenerator(channel, metadata = undefined) {
    const generator = {
        kind: "generator",
        state: "start",
        channel,
        ...metadata
    };
    Object.defineProperty(generator, sandboxGeneratorBrand, {
        enumerable: false,
        value: true
    });
    return generator;
}
export function createSandboxMap(entries = []) {
    const map = {};
    Object.defineProperties(map, {
        kind: {
            value: "map"
        },
        entries: {
            value: new Map(entries)
        }
    });
    Object.defineProperty(map, sandboxMapBrand, {
        enumerable: false,
        value: true
    });
    return Object.freeze(map);
}
export function createSandboxSet(values = []) {
    const set = {};
    Object.defineProperties(set, {
        kind: {
            value: "set"
        },
        values: {
            value: new Set(values)
        }
    });
    Object.defineProperty(set, sandboxSetBrand, {
        enumerable: false,
        value: true
    });
    return Object.freeze(set);
}
export function createSandboxRegex(source, flags = "", lastIndex = 0) {
    const regex = { kind: "regex", source, flags, lastIndex };
    Object.defineProperties(regex, {
        [sandboxRegexBrand]: { value: true },
        [sandboxRegexPattern]: { value: parseRegex(source, flags) }
    });
    return Object.seal(regex);
}
export function getSandboxRegexPattern(regex) {
    return regex[sandboxRegexPattern];
}
export function isSandboxClosure(value) {
    return typeof value === "object" && value !== null && sandboxClosureBrand in value;
}
export function isSandboxMap(value) {
    return typeof value === "object" && value !== null && sandboxMapBrand in value;
}
export function isSandboxPromise(value) {
    return typeof value === "object" && value !== null && sandboxPromiseBrand in value;
}
export function isSandboxSet(value) {
    return typeof value === "object" && value !== null && sandboxSetBrand in value;
}
export function isSandboxGenerator(value) {
    return typeof value === "object" && value !== null && sandboxGeneratorBrand in value;
}
export function isSandboxRegex(value) {
    return typeof value === "object" && value !== null && sandboxRegexBrand in value;
}
export function deepCopyToSandbox(value) {
    return copyToSandbox(value, {
        seen: new WeakMap()
    });
}
export function cloneSandboxValue(value) {
    return copyToSandbox(value, {
        seen: new WeakMap()
    }, "<root>", true);
}
export function allocateProducedSandboxValue(value, budget) {
    allocateSandboxValue(value, budget, new WeakSet());
    return value;
}
export function measureSandboxData(values, options = {}) {
    const seen = new WeakSet();
    let usage = 0;
    const visit = (value) => {
        if (typeof value === "string") {
            usage += value.length;
            return;
        }
        if (typeof value !== "object" || value === null)
            return;
        if (seen.has(value))
            return;
        seen.add(value);
        usage += 1;
        if (Array.isArray(value)) {
            usage += value.length;
            for (const entry of value)
                visit(entry);
            return;
        }
        if (isSandboxMap(value)) {
            usage += value.entries.size;
            for (const [key, entry] of value.entries) {
                visit(key);
                visit(entry);
            }
            return;
        }
        if (isSandboxSet(value)) {
            usage += value.values.size;
            for (const entry of value.values)
                visit(entry);
            return;
        }
        if (isSandboxClosure(value)) {
            if (options.ignoreClosures)
                return;
            if (value.properties !== undefined)
                visit(value.properties);
            if (!options.ignoreClosureCaptures)
                for (const retained of value[sandboxRetainedValues]?.() ?? [])
                    visit(retained);
            return;
        }
        if (isSandboxGenerator(value)) {
            const snapshot = value.channel.snapshot();
            usage += snapshot.sent.length;
            for (const completion of snapshot.sent)
                visit(completion.value);
            return;
        }
        if (isSandboxPromise(value))
            return;
        if (isSandboxRegex(value)) {
            usage += value.source.length + value.flags.length;
            return;
        }
        const entries = isSandboxArguments(value)
            ? getSandboxArgumentEntries(value)
            : Object.entries(value);
        usage += entries.length;
        for (const [key, entry] of entries) {
            usage += key.length;
            visit(entry);
        }
    };
    for (const value of values)
        visit(value);
    return usage;
}
export function deepCopyFromSandbox(value, options = {}) {
    return copyFromSandbox(value, {
        seen: new WeakMap()
    }, "<root>", options);
}
function copyToSandbox(value, state, path = "<root>", cloneSandboxCollections = false, depth = 0) {
    assertSandboxDataDepth(depth);
    if (isSandboxPrimitive(value)) {
        return value;
    }
    if (isSandboxClosure(value) ||
        isSandboxGenerator(value) ||
        isSandboxRegex(value) ||
        isSandboxPromise(value)) {
        return value;
    }
    if (isSandboxMap(value)) {
        if (!cloneSandboxCollections)
            return value;
        const existing = state.seen.get(value);
        if (existing !== undefined)
            return existing;
        const copy = createSandboxMap();
        state.seen.set(value, copy);
        for (const [key, entry] of value.entries) {
            copy.entries.set(copyToSandbox(key, state, `${path}.<key>`, true, depth + 1), copyToSandbox(entry, state, `${path}.<value>`, true, depth + 1));
        }
        return copy;
    }
    if (isSandboxSet(value)) {
        if (!cloneSandboxCollections)
            return value;
        const existing = state.seen.get(value);
        if (existing !== undefined)
            return existing;
        const copy = createSandboxSet();
        state.seen.set(value, copy);
        for (const entry of value.values) {
            copy.values.add(copyToSandbox(entry, state, `${path}.<value>`, true, depth + 1));
        }
        return copy;
    }
    if (isHostPromise(value)) {
        const promise = Promise.resolve(value).then((resolved) => copyToSandbox(resolved, { seen: new WeakMap() }), (reason) => Promise.reject(copyToSandbox(reason, { seen: new WeakMap() })));
        const sandboxPromise = createSandboxPromise(promise);
        const span = getBoundOtelSpan(value);
        if (span !== undefined) {
            bindOtelSpan(promise, span);
            bindOtelSpan(sandboxPromise, span);
        }
        return sandboxPromise;
    }
    if (value instanceof Map) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = createSandboxMap();
        state.seen.set(value, copy);
        for (const [key, entry] of value) {
            copy.entries.set(copyToSandbox(key, state, `${path}.<key>`, cloneSandboxCollections, depth + 1), copyToSandbox(entry, state, `${path}.<value>`, cloneSandboxCollections, depth + 1));
        }
        return copy;
    }
    if (value instanceof Set) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = createSandboxSet();
        state.seen.set(value, copy);
        for (const entry of value) {
            copy.values.add(copyToSandbox(entry, state, `${path}.<value>`, cloneSandboxCollections, depth + 1));
        }
        return copy;
    }
    if (isPlainArray(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = new Array(value.length);
        state.seen.set(value, copy);
        for (const entry of getEnumerableArrayEntries(value, path)) {
            defineOwnDataProperty(copy, entry.key, copyToSandbox(entry.value, state, joinArrayPath(path, entry.key), cloneSandboxCollections, depth + 1));
        }
        return copy;
    }
    if (isSandboxArguments(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined)
            return existing;
        const copy = createSandboxArguments([]);
        state.seen.set(value, copy);
        copySandboxArgumentProperties(value, copy, (entry, key) => copyToSandbox(entry, state, joinPath(path, key), cloneSandboxCollections, depth + 1));
        return copy;
    }
    if (isPlainObject(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = createPlainObject(true);
        state.seen.set(value, copy);
        for (const entry of getEnumerableObjectEntries(value, path)) {
            defineOwnDataProperty(copy, entry.key, copyToSandbox(entry.value, state, joinPath(path, entry.key), cloneSandboxCollections, depth + 1));
        }
        return copy;
    }
    throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}
function copyFromSandbox(value, state, path = "<root>", options, depth = 0) {
    assertSandboxDataDepth(depth);
    if (isSandboxPrimitive(value)) {
        return value;
    }
    if (isSandboxClosure(value)) {
        if (options.wrapClosure === undefined) {
            throw new TypeError("Sandbox closures cannot cross into host values without an explicit wrapper.");
        }
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const wrapped = options.wrapClosure(value);
        state.seen.set(value, wrapped);
        return wrapped;
    }
    if (isSandboxPromise(value)) {
        observeSandboxPromise(value);
        return value.promise.then((resolved) => copyFromSandbox(resolved, { seen: new WeakMap() }, "<root>", options), (reason) => Promise.reject(reason instanceof SandboxError
            ? reason
            : copyFromSandbox(reason, { seen: new WeakMap() }, "<root>", options)));
    }
    if (isSandboxGenerator(value)) {
        throw new TypeError("Sandbox generators cannot cross into host values.");
    }
    if (isSandboxRegex(value)) {
        const regex = new RegExp(value.source, value.flags);
        regex.lastIndex = value.lastIndex;
        return regex;
    }
    if (isSandboxMap(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = new Map();
        state.seen.set(value, copy);
        for (const [key, entry] of value.entries) {
            copy.set(copyFromSandbox(key, state, `${path}.<key>`, options, depth + 1), copyFromSandbox(entry, state, `${path}.<value>`, options, depth + 1));
        }
        return copy;
    }
    if (isSandboxSet(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = new Set();
        state.seen.set(value, copy);
        for (const entry of value.values) {
            copy.add(copyFromSandbox(entry, state, `${path}.<value>`, options, depth + 1));
        }
        return copy;
    }
    if (isPlainArray(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = new Array(value.length);
        state.seen.set(value, copy);
        for (const entry of getEnumerableArrayEntries(value, path)) {
            defineOwnDataProperty(copy, entry.key, copyFromSandbox(entry.value, state, joinArrayPath(path, entry.key), options, depth + 1));
        }
        return copy;
    }
    if (isSandboxArguments(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined)
            return existing;
        const copy = createSandboxArguments([]);
        state.seen.set(value, copy);
        copySandboxArgumentProperties(value, copy, (entry, key) => copyFromSandbox(entry, state, joinPath(path, key), options, depth + 1));
        return copy;
    }
    if (isPlainObject(value)) {
        const existing = state.seen.get(value);
        if (existing !== undefined) {
            return existing;
        }
        const copy = createPlainObject(Object.getPrototypeOf(value) === null);
        state.seen.set(value, copy);
        for (const entry of getEnumerableObjectEntries(value, path)) {
            defineOwnDataProperty(copy, entry.key, copyFromSandbox(entry.value, state, joinPath(path, entry.key), options, depth + 1));
        }
        return copy;
    }
    throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}
function isSandboxPrimitive(value) {
    return (value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean");
}
function isHostPromise(value) {
    return value instanceof Promise;
}
function allocateSandboxValue(value, budget, seen) {
    if (typeof value === "string") {
        budget.allocateString(value);
        return;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        budget.allocateArrayLength(value.length);
        for (const entry of value) {
            allocateSandboxValue(entry, budget, seen);
        }
        return;
    }
    if (isSandboxMap(value)) {
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        budget.allocateCollectionEntries(value.entries.size);
        for (const [key, entry] of value.entries) {
            allocateSandboxValue(key, budget, seen);
            allocateSandboxValue(entry, budget, seen);
        }
        return;
    }
    if (isSandboxSet(value)) {
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        budget.allocateCollectionEntries(value.values.size);
        for (const entry of value.values) {
            allocateSandboxValue(entry, budget, seen);
        }
        return;
    }
    if (typeof value !== "object" ||
        value === null ||
        isSandboxClosure(value) ||
        isSandboxMap(value) ||
        isSandboxSet(value) ||
        isSandboxPromise(value)) {
        return;
    }
    if (seen.has(value)) {
        return;
    }
    seen.add(value);
    const entries = isSandboxArguments(value)
        ? getSandboxArgumentEntries(value).map(([, entry]) => entry)
        : Object.values(value);
    for (const entry of entries) {
        allocateSandboxValue(entry, budget, seen);
    }
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isPlainArray(value) {
    return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}
function createPlainObject(useNullPrototype) {
    return (useNullPrototype ? Object.create(null) : {});
}
function defineOwnDataProperty(target, key, value) {
    Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value
    });
}
function getEnumerableObjectEntries(value, path) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable) {
            continue;
        }
        if ("get" in descriptor || "set" in descriptor) {
            throw new TypeError(`Unsupported sandbox value at ${joinPath(path, key)}: accessor property`);
        }
        entries.push({
            key,
            value: descriptor.value
        });
    }
    return entries;
}
function getEnumerableArrayEntries(value, path) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "length" || !descriptor.enumerable) {
            continue;
        }
        if ("get" in descriptor || "set" in descriptor) {
            throw new TypeError(`Unsupported sandbox value at ${joinArrayPath(path, key)}: accessor property`);
        }
        entries.push({
            key,
            value: descriptor.value
        });
    }
    return entries;
}
function isArrayIndexKey(value) {
    if (value === "") {
        return false;
    }
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === value;
}
function describeValue(value) {
    if (typeof value === "function") {
        return "function";
    }
    if (typeof value === "bigint" || typeof value === "symbol") {
        return typeof value;
    }
    if (typeof value === "object" && value !== null) {
        return value.constructor?.name ?? "Object";
    }
    return typeof value;
}
function joinPath(path, key) {
    return path === "<root>" ? `<root>.${key}` : `${path}.${key}`;
}
function joinArrayPath(path, key) {
    return isArrayIndexKey(key) ? `${path}[${key}]` : joinPath(path, key);
}
