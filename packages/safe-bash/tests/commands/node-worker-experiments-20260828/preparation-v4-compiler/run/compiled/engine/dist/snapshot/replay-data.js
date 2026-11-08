import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { createSandboxArguments, createSandboxClosure, createSandboxMap, createSandboxRegex, createSandboxSet, isSandboxArguments, isSandboxClosure, isSandboxGenerator, isSandboxMap, isSandboxPromise, isSandboxRegex, isSandboxSet } from "../interp/values.js";
import { serializeArguments } from "./arguments.js";
import { validateArgumentsProperties, validateSnapshotData } from "./validation.js";
export class MissingReplayCapabilityError extends TypeError {
}
export function encodeReplayData(value, options = {}) {
    const nodes = [];
    const seen = new WeakMap();
    const encode = (entry, depth, path) => {
        if (depth > MAX_DATA_DEPTH)
            throw new TypeError("Replay data exceeds the nesting limit.");
        if (entry === null || typeof entry === "boolean" || typeof entry === "string")
            return entry;
        if (entry === undefined)
            return { tag: "undefined" };
        if (typeof entry === "number") {
            if (Object.is(entry, -0))
                return { tag: "number", value: "-0" };
            if (Number.isFinite(entry))
                return entry;
            return {
                tag: "number",
                value: Number.isNaN(entry) ? "NaN" : entry > 0 ? "Infinity" : "-Infinity"
            };
        }
        if (isSandboxPromise(entry)) {
            const id = options.identifyPromise?.(entry, path);
            if (typeof id === "string" && id.length > 0)
                return { tag: "promise-capability", id };
        }
        let capabilityId;
        if (isSandboxClosure(entry)) {
            capabilityId = options.identifyCapability?.(entry, path);
            if (typeof capabilityId !== "string" || capabilityId.length === 0)
                throw new MissingReplayCapabilityError("A callable needs an explicit resume capability.");
            if (!options.captureCapabilityProperties)
                return { tag: "capability", id: capabilityId };
        }
        if (typeof entry !== "object" || isSandboxPromise(entry) || isSandboxGenerator(entry)) {
            throw new MissingReplayCapabilityError("A host result containing a callable or live execution state needs an explicit resume capability.");
        }
        const existing = seen.get(entry);
        if (existing !== undefined)
            return { tag: "ref", id: existing };
        const id = nodes.length;
        seen.set(entry, id);
        nodes.push(undefined);
        const child = (value, key) => encode(value, depth + 1, [...path, key]);
        if (isSandboxClosure(entry)) {
            nodes[id] = {
                kind: "capability",
                id: capabilityId,
                properties: child(entry.properties, "properties")
            };
        }
        else if (isSandboxMap(entry)) {
            nodes[id] = {
                kind: "map",
                entries: [...entry.entries].map(([key, value], index) => [
                    child(key, `key:${index}`),
                    child(value, `value:${index}`)
                ])
            };
        }
        else if (isSandboxSet(entry)) {
            nodes[id] = {
                kind: "set",
                values: [...entry.values].map((value, index) => child(value, String(index)))
            };
        }
        else if (isSandboxRegex(entry)) {
            nodes[id] = {
                kind: "regex",
                source: entry.source,
                flags: entry.flags,
                lastIndex: entry.lastIndex
            };
        }
        else if (isSandboxArguments(entry)) {
            nodes[id] = { kind: "arguments", data: serializeArguments(entry, child) };
        }
        else {
            const prototype = Object.getPrototypeOf(entry);
            if ((!Array.isArray(entry) && prototype !== null && prototype !== Object.prototype) ||
                Object.getOwnPropertySymbols(entry).length > 0) {
                throw new TypeError("Replay data contains an unsupported host object or symbol property.");
            }
            const properties = Object.create(null);
            for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
                if (!("value" in descriptor))
                    throw new TypeError(`Cannot record replay data accessor '${key}'.`);
                properties[key] = {
                    value: child(descriptor.value, key),
                    configurable: descriptor.configurable === true,
                    enumerable: descriptor.enumerable === true,
                    writable: descriptor.writable === true
                };
            }
            nodes[id] = {
                kind: Array.isArray(entry) ? "array" : "object",
                nullPrototype: prototype === null,
                extensible: Object.isExtensible(entry),
                properties
            };
        }
        return { tag: "ref", id };
    };
    return { root: encode(value, 0, []), nodes };
}
export function decodeReplayData(input, options = {}) {
    validateSnapshotData(input);
    const graph = record(input);
    const nodes = list(own(graph, "nodes"));
    const restored = new Map();
    const decode = (entry, depth = 0) => {
        if (depth > MAX_DATA_DEPTH)
            throw new TypeError("Replay data exceeds the nesting limit.");
        if (entry === null || typeof entry === "boolean" || typeof entry === "string")
            return entry;
        if (typeof entry === "number" && Number.isFinite(entry))
            return entry;
        const atom = record(entry);
        if (own(atom, "tag") === "promise-capability") {
            const id = own(atom, "id");
            if (typeof id !== "string" || id.length === 0)
                throw new TypeError("Invalid replay promise capability reference.");
            const promise = options.resolvePromise?.(id);
            if (!isSandboxPromise(promise))
                throw new TypeError(`Missing replay promise capability '${id}'.`);
            return promise;
        }
        if (own(atom, "tag") === "capability") {
            const id = own(atom, "id");
            if (typeof id !== "string" || id.length === 0)
                throw new TypeError("Invalid replay capability reference.");
            const capability = options.resolveCapability?.(id);
            if (!isSandboxClosure(capability))
                throw new TypeError(`Missing replay capability '${id}'.`);
            return capability;
        }
        if (own(atom, "tag") === "undefined")
            return undefined;
        if (atom.tag === "number") {
            switch (own(atom, "value")) {
                case "NaN":
                    return NaN;
                case "Infinity":
                    return Infinity;
                case "-Infinity":
                    return -Infinity;
                case "-0":
                    return -0;
                default:
                    throw new TypeError("Invalid replay number.");
            }
        }
        if (atom.tag !== "ref" ||
            !Number.isSafeInteger(atom.id) ||
            Number(atom.id) < 0 ||
            Number(atom.id) >= nodes.length) {
            throw new TypeError("Invalid replay data reference.");
        }
        const id = Number(atom.id);
        if (restored.has(id))
            return restored.get(id);
        const node = record(nodes[id]);
        const kind = own(node, "kind");
        const child = (value) => decode(value, depth + 1);
        if (kind === "capability") {
            const capabilityId = own(node, "id");
            if (typeof capabilityId !== "string" || capabilityId.length === 0)
                throw new TypeError("Invalid replay capability reference.");
            const capability = options.resolveCapability?.(capabilityId);
            if (!isSandboxClosure(capability))
                throw new TypeError(`Missing replay capability '${capabilityId}'.`);
            if (record(own(node, "properties")).tag === "undefined") {
                restored.set(id, capability);
                return capability;
            }
            return createSandboxClosure({
                ...capability,
                retainedValues: () => [capability],
                properties: (closure) => {
                    restored.set(id, closure);
                    const properties = child(own(node, "properties"));
                    if (properties === null ||
                        typeof properties !== "object" ||
                        Array.isArray(properties) ||
                        isSandboxClosure(properties))
                        throw new TypeError("Invalid replay capability properties.");
                    return properties;
                }
            });
        }
        if (kind === "map") {
            const result = createSandboxMap();
            restored.set(id, result);
            for (const pair of list(own(node, "entries"))) {
                const entries = list(pair);
                if (entries.length !== 2)
                    throw new TypeError("Invalid replay map entry.");
                result.entries.set(child(entries[0]), child(entries[1]));
            }
            return result;
        }
        if (kind === "set") {
            const result = createSandboxSet();
            restored.set(id, result);
            for (const value of list(own(node, "values")))
                result.values.add(child(value));
            return result;
        }
        if (kind === "regex") {
            if (typeof node.source !== "string" ||
                typeof node.flags !== "string" ||
                typeof node.lastIndex !== "number" ||
                !Number.isFinite(node.lastIndex)) {
                throw new TypeError("Invalid replay regular expression.");
            }
            const result = createSandboxRegex(node.source, node.flags, node.lastIndex);
            restored.set(id, result);
            return result;
        }
        if (kind === "arguments") {
            const data = record(own(node, "data"));
            validateArgumentsProperties(data, "arguments");
            if (data.kind !== "arguments")
                throw new TypeError("Invalid replay arguments.");
            const args = createSandboxArguments([]);
            restored.set(id, args);
            if (!data.lengthBeforeCallee)
                delete args.length;
            defineProperties(args, record(data.properties), child);
            if (data.iterator === null)
                Reflect.deleteProperty(args, Symbol.iterator);
            else
                Object.defineProperty(args, Symbol.iterator, {
                    ...record(data.iterator),
                    value: Array.prototype.values
                });
            if (!data.extensible)
                Object.preventExtensions(args);
            return args;
        }
        if (kind !== "array" && kind !== "object")
            throw new TypeError("Invalid replay data node.");
        if (typeof node.extensible !== "boolean" || typeof node.nullPrototype !== "boolean") {
            throw new TypeError("Invalid replay object metadata.");
        }
        const result = kind === "array" ? [] : Object.create(node.nullPrototype ? null : Object.prototype);
        if (kind === "array" && node.nullPrototype)
            Object.setPrototypeOf(result, null);
        restored.set(id, result);
        defineProperties(result, record(own(node, "properties")), child);
        if (!node.extensible)
            Object.preventExtensions(result);
        return result;
    };
    return decode(own(graph, "root"));
}
function defineProperties(target, properties, decode) {
    for (const [key, value] of Object.entries(properties)) {
        const descriptor = record(value);
        for (const field of Object.keys(descriptor)) {
            if (!["value", "writable", "enumerable", "configurable"].includes(field))
                throw new TypeError("Invalid replay property descriptor.");
        }
        if (typeof descriptor.configurable !== "boolean" ||
            typeof descriptor.enumerable !== "boolean" ||
            typeof descriptor.writable !== "boolean") {
            throw new TypeError("Invalid replay property flags.");
        }
        Object.defineProperty(target, key, {
            value: decode(own(descriptor, "value")),
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            writable: descriptor.writable
        });
    }
}
function record(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Expected replay data object.");
    return value;
}
function list(value) {
    if (!Array.isArray(value))
        throw new TypeError("Expected replay data array.");
    return value;
}
function own(value, key) {
    if (!Object.hasOwn(value, key))
        throw new TypeError(`Missing replay data field '${key}'.`);
    return value[key];
}
