export const DUMP_FORMAT_VERSION = 1;
export const EXECUTION_SEMANTICS = "jobs-v1";
import { assertSnapshotGraphDepth } from "../graph-depth.js";
import { getSandboxArgumentEntries, isSandboxArguments } from "../interp/arguments.js";
import { serializeArguments } from "./arguments.js";
const SKIP_VALUE = Symbol("SafeJS.skip-dump-value");
export function serializeSafeJSSnapshot(snapshot) {
    const replayError = Object.getOwnPropertyDescriptor(snapshot, "replayError");
    if (replayError !== undefined) {
        const reason = "value" in replayError && typeof replayError.value === "string"
            ? replayError.value
            : "missing resume capability";
        throw new TypeError(`Snapshot is not replayable: ${reason}`);
    }
    for (const [key, value] of getEnumerableDataEntries(snapshot)) {
        if (key !== "version" && key !== "sourceHash" && key !== "heap") {
            assertSnapshotGraphDepth(value, key);
        }
    }
    return JSON.stringify(createDumpFile(snapshot), null, 2);
}
function createDumpFile(snapshot) {
    const state = {
        heap: {},
        heapIds: indexHeapContainers(snapshot),
        serializedHeapIds: new Set()
    };
    const dumped = {
        version: DUMP_FORMAT_VERSION,
        sourceHash: snapshot.sourceHash
    };
    for (const [key, value] of getEnumerableDataEntries(snapshot)) {
        if (key === "version" || key === "sourceHash" || key === "heap") {
            continue;
        }
        const serialized = serializeDumpValue(value, key, state);
        if (serialized !== SKIP_VALUE) {
            dumped[key] = serialized;
        }
    }
    if (Object.keys(state.heap).length > 0) {
        dumped.heap = state.heap;
    }
    return dumped;
}
function serializeDumpValue(value, path, state) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
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
    if (typeof value !== "object") {
        return SKIP_VALUE;
    }
    if (Array.isArray(value)) {
        const reference = serializeHeapReference(value, path, state);
        if (reference !== undefined) {
            return reference;
        }
        return serializeArrayItems(value, path, state);
    }
    if (!isPlainObject(value)) {
        return SKIP_VALUE;
    }
    const reference = serializeHeapReference(value, path, state);
    if (reference !== undefined) {
        return reference;
    }
    return serializeObjectEntries(value, path, state);
}
function serializeHeapReference(value, path, state) {
    const id = state.heapIds.get(value);
    if (id === undefined) {
        return undefined;
    }
    if (!state.serializedHeapIds.has(id)) {
        state.serializedHeapIds.add(id);
        if (isSandboxArguments(value)) {
            state.heap[String(id)] = serializeArguments(value, (entry, key) => {
                const serialized = serializeDumpValue(entry, `${path}.${key}`, state);
                return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
            });
        }
        else if (Array.isArray(value)) {
            state.heap[String(id)] = {
                kind: "array",
                items: serializeArrayItems(value, path, state)
            };
        }
        else {
            state.heap[String(id)] = {
                kind: "object",
                entries: serializeObjectEntries(value, path, state)
            };
        }
    }
    return {
        kind: "ref",
        id
    };
}
function serializeObjectEntries(value, path, state) {
    const serialized = {};
    for (const [key, entry] of getEnumerableDataEntries(value)) {
        const dumped = serializeDumpValue(entry, `${path}.${key}`, state);
        if (dumped !== SKIP_VALUE) {
            serialized[key] = dumped;
        }
    }
    return serialized;
}
function indexHeapContainers(snapshot) {
    const stats = new Map();
    const ancestors = new WeakSet();
    for (const [key, value] of getEnumerableDataEntries(snapshot)) {
        if (key === "version" || key === "sourceHash" || key === "heap") {
            continue;
        }
        collectContainerStats(value, stats, ancestors);
    }
    const heapIds = new WeakMap();
    let nextId = 1;
    for (const [value, stat] of stats.entries()) {
        if (stat.count > 1 || stat.cyclic || isSandboxArguments(value)) {
            heapIds.set(value, nextId);
            nextId += 1;
        }
    }
    return heapIds;
}
function collectContainerStats(value, stats, ancestors) {
    if (value === null || typeof value !== "object") {
        return;
    }
    if (!Array.isArray(value) && !isPlainObject(value)) {
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
        ? getSandboxArgumentEntries(value).map(([, entry]) => entry)
        : Array.isArray(value)
            ? getArrayDataItems(value)
            : getEnumerableDataValues(value);
    for (const entry of entries) {
        collectContainerStats(entry, stats, ancestors);
    }
    ancestors.delete(value);
}
function isPlainObject(value) {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function serializeArrayItems(value, path, state) {
    return getArrayDataItems(value).map((entry, index) => {
        const serialized = serializeDumpValue(entry, `${path}[${index}]`, state);
        return serialized === SKIP_VALUE ? { kind: "undefined" } : serialized;
    });
}
function getArrayDataItems(value) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        items.push(descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined);
    }
    return items;
}
function getEnumerableDataEntries(value) {
    const entries = [];
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable || !("value" in descriptor)) {
            continue;
        }
        entries.push([key, descriptor.value]);
    }
    return entries;
}
function getEnumerableDataValues(value) {
    return getEnumerableDataEntries(value).map(([, entry]) => entry);
}
