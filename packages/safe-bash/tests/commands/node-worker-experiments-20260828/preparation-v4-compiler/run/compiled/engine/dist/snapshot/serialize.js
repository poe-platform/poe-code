import { hashSource } from "../parse/hash.js";
import { assertSnapshotGraphDepth } from "../graph-depth.js";
import { serializeArguments } from "./arguments.js";
import { isSandboxArguments, isSandboxGenerator, isSandboxMap, isSandboxRegex, isSandboxSet } from "../interp/values.js";
export class UnsnapshotableValueError extends Error {
    path;
    constructor(path) {
        super("Cannot snapshot a generator suspended mid-iteration; drain or discard it before the await boundary.");
        this.name = "UnsnapshotableValueError";
        this.path = path;
    }
}
export function serialize(input) {
    for (const [scopeIndex, scope] of input.scopeChain.entries()) {
        for (const [name, value] of Object.entries(scope.bindings)) {
            assertSnapshotGraphDepth(value, `scopeChain[${scopeIndex}].bindings.${name}`);
        }
    }
    for (const [promiseIndex, promise] of input.pendingPromises.entries()) {
        for (const [key, value] of Object.entries(promise)) {
            if (key !== "id" && key !== "promise") {
                assertSnapshotGraphDepth(value, `pendingPromises[${promiseIndex}].${key}`);
            }
        }
    }
    const state = {
        ancestors: new WeakMap(),
        heap: Object.create(null),
        heapIds: indexHeapContainers(input),
        serializedHeapIds: new Set()
    };
    const snapshot = {
        sourceHash: hashSource(input.source),
        currentAstNodeId: input.currentAstNodeId,
        scopeChain: input.scopeChain.map((scope, index) => serializeScopeFrame(scope, `scopeChain[${index}]`, state)),
        callStack: input.callStack.map((frame) => ({ ...frame })),
        pendingPromises: input.pendingPromises.map((promise, index) => serializePendingPromise(promise, `pendingPromises[${index}]`, state)),
        moduleBindings: { ...input.moduleBindings }
    };
    if (Object.keys(state.heap).length === 0) {
        return snapshot;
    }
    return {
        ...snapshot,
        heap: state.heap
    };
}
function serializeScopeFrame(scope, path, state) {
    const bindings = Object.create(null);
    for (const [name, value] of Object.entries(scope.bindings)) {
        bindings[name] = serializeValue(value, `${path}.bindings.${name}`, state);
    }
    return scope.parentId === undefined
        ? {
            id: scope.id,
            bindings
        }
        : {
            id: scope.id,
            parentId: scope.parentId,
            bindings
        };
}
function serializePendingPromise(pendingPromise, path, state) {
    const serialized = {
        id: pendingPromise.id
    };
    for (const [key, value] of Object.entries(pendingPromise)) {
        if (key === "id" || key === "promise") {
            continue;
        }
        serialized[key] = serializeValue(value, `${path}.${key}`, state);
    }
    return serialized;
}
function serializeValue(value, path, state) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (value === undefined) {
        return {
            kind: "undefined"
        };
    }
    if (typeof value === "number") {
        if (Number.isFinite(value)) {
            return value;
        }
        return {
            kind: "number",
            value: Number.isNaN(value)
                ? "NaN"
                : value === Number.POSITIVE_INFINITY
                    ? "Infinity"
                    : "-Infinity"
        };
    }
    if (Array.isArray(value)) {
        const reference = serializeHeapReference(value, path, state);
        if (reference !== undefined) {
            return reference;
        }
        return withSerializableContainer(value, path, state, () => value.map((entry, index) => serializeValue(entry, `${path}[${index}]`, state)));
    }
    if (isRuntimeClosureValue(value)) {
        return {
            kind: "fn",
            astNodeId: value.astNodeId,
            capturedScopeId: value.capturedScopeId
        };
    }
    if (isSandboxGenerator(value)) {
        if (value.state === "done") {
            return {
                kind: "generator",
                state: "done"
            };
        }
        if (value.state === "suspended" || value.state === "running") {
            const continuation = value.channel.snapshot();
            if (continuation.yieldNodeId === undefined) {
                throw new UnsnapshotableValueError(path);
            }
            if (value.astNodeId === undefined || value.capturedScopeId === undefined) {
                throw new TypeError(`Cannot serialize generator without origin metadata at ${path}.`);
            }
            return {
                kind: "generator",
                state: "suspended",
                astNodeId: value.astNodeId,
                capturedScopeId: value.capturedScopeId,
                yieldNodeId: continuation.yieldNodeId,
                sent: serializeValue(continuation.sent, `${path}.sent`, state)
            };
        }
        if (value.astNodeId === undefined || value.capturedScopeId === undefined) {
            throw new TypeError(`Cannot serialize generator without origin metadata at ${path}.`);
        }
        return {
            kind: "generator",
            state: "start",
            astNodeId: value.astNodeId,
            capturedScopeId: value.capturedScopeId
        };
    }
    if (isRuntimePromiseValue(value)) {
        return {
            kind: "promise",
            id: value.id
        };
    }
    if (isSandboxRegex(value)) {
        return { kind: "regex", source: value.source, flags: value.flags, lastIndex: value.lastIndex };
    }
    if (isSandboxMap(value) || isSandboxSet(value)) {
        const reference = serializeHeapReference(value, path, state);
        if (reference === undefined) {
            throw new TypeError(`Cannot serialize collection without a heap reference at ${path}.`);
        }
        return reference;
    }
    if (!isPlainObject(value)) {
        throw new TypeError(`Cannot serialize host reference at ${path}.`);
    }
    const reference = serializeHeapReference(value, path, state);
    if (reference !== undefined) {
        return reference;
    }
    const serialized = Object.create(null);
    return withSerializableContainer(value, path, state, () => {
        for (const [key, entry] of Object.entries(value)) {
            serialized[key] = serializeValue(entry, `${path}.${key}`, state);
        }
        return serialized;
    });
}
function serializeHeapReference(value, path, state) {
    const id = state.heapIds.get(value);
    if (id === undefined) {
        return undefined;
    }
    if (!state.serializedHeapIds.has(id)) {
        state.serializedHeapIds.add(id);
        if (isSandboxArguments(value)) {
            state.heap[String(id)] = serializeArguments(value, (entry, key) => serializeValue(entry, `${path}.${key}`, state));
        }
        else if (isSandboxMap(value)) {
            state.heap[String(id)] = {
                kind: "map",
                entries: [...value.entries].map(([key, entry], index) => [
                    serializeValue(key, `${path}.entries[${index}][0]`, state),
                    serializeValue(entry, `${path}.entries[${index}][1]`, state)
                ])
            };
        }
        else if (isSandboxSet(value)) {
            state.heap[String(id)] = {
                kind: "set",
                values: [...value.values].map((entry, index) => serializeValue(entry, `${path}.values[${index}]`, state))
            };
        }
        else if (Array.isArray(value)) {
            state.heap[String(id)] = {
                kind: "array",
                items: value.map((entry, index) => serializeValue(entry, `${path}[${index}]`, state))
            };
        }
        else {
            const entries = Object.create(null);
            state.heap[String(id)] = {
                kind: "object",
                entries
            };
            for (const [key, entry] of Object.entries(value)) {
                entries[key] = serializeValue(entry, `${path}.${key}`, state);
            }
        }
    }
    return {
        kind: "ref",
        id
    };
}
function isRuntimeClosureValue(value) {
    return (typeof value === "object" &&
        value !== null &&
        hasOwnProperty(value, "kind") &&
        value.kind === "fn" &&
        hasOwnProperty(value, "astNodeId") &&
        typeof value.astNodeId === "number" &&
        hasOwnProperty(value, "capturedScopeId") &&
        (typeof value.capturedScopeId === "number" || typeof value.capturedScopeId === "string"));
}
function isRuntimePromiseValue(value) {
    return (typeof value === "object" &&
        value !== null &&
        hasOwnProperty(value, "kind") &&
        value.kind === "promise" &&
        hasOwnProperty(value, "id"));
}
function isPlainObject(value) {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function hasOwnProperty(value, name) {
    return Object.prototype.hasOwnProperty.call(value, name);
}
function withSerializableContainer(value, path, state, serializeContainer) {
    const ancestorPath = state.ancestors.get(value);
    if (ancestorPath !== undefined) {
        throw new TypeError(`Cannot serialize cyclic value at ${path}.`);
    }
    state.ancestors.set(value, path);
    try {
        return serializeContainer();
    }
    finally {
        state.ancestors.delete(value);
    }
}
function indexHeapContainers(input) {
    const stats = new Map();
    const ancestors = new WeakSet();
    for (const scope of input.scopeChain) {
        for (const value of Object.values(scope.bindings)) {
            collectContainerStats(value, stats, ancestors);
        }
    }
    for (const promise of input.pendingPromises) {
        for (const [key, value] of Object.entries(promise)) {
            if (key === "id" || key === "promise") {
                continue;
            }
            collectContainerStats(value, stats, ancestors);
        }
    }
    const heapIds = new WeakMap();
    let nextId = 1;
    for (const [value, stat] of stats.entries()) {
        if (stat.count > 1 ||
            stat.cyclic ||
            isSandboxArguments(value) ||
            isSandboxMap(value) ||
            isSandboxSet(value)) {
            heapIds.set(value, nextId);
            nextId += 1;
        }
    }
    return heapIds;
}
function collectContainerStats(value, stats, ancestors) {
    if (value === null ||
        typeof value !== "object" ||
        isRuntimeClosureValue(value) ||
        isRuntimePromiseValue(value) ||
        isSandboxGenerator(value)) {
        return;
    }
    if (!Array.isArray(value) &&
        !isPlainObject(value) &&
        !isSandboxMap(value) &&
        !isSandboxSet(value)) {
        return;
    }
    let stat = stats.get(value);
    if (stat === undefined) {
        stat = {
            count: 0,
            cyclic: false,
            expanded: false
        };
        stats.set(value, stat);
    }
    stat.count += 1;
    if (ancestors.has(value)) {
        stat.cyclic = true;
        return;
    }
    if (stat.expanded) {
        return;
    }
    stat.expanded = true;
    ancestors.add(value);
    const entries = isSandboxArguments(value)
        ? Object.values(Object.getOwnPropertyDescriptors(value)).flatMap((descriptor) => "value" in descriptor ? [descriptor.value] : [])
        : isSandboxMap(value)
            ? [...value.entries].flatMap(([key, entry]) => [key, entry])
            : isSandboxSet(value)
                ? [...value.values]
                : Array.isArray(value)
                    ? value
                    : Object.values(value);
    for (const entry of entries) {
        collectContainerStats(entry, stats, ancestors);
    }
    ancestors.delete(value);
}
