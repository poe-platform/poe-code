import { wrapCallerInjectedBindings } from "../host-bridge.js";
import { allocateProducedSandboxValue, createSandboxClosure, deepCopyFromSandbox, isSandboxClosure, isSandboxPromise } from "../values.js";
export function createConsoleJsonGlobals(options) {
    const sink = options.sink ?? console;
    return {
        JSON: {
            parse: createSandboxClosure({
                call: async ([text]) => parseJson(text, options.budget),
                name: "parse"
            }),
            stringify: createSandboxClosure({
                call: async ([value, replacer, indent]) => stringifyJson(value, replacer, indent, options.budget),
                name: "stringify"
            })
        },
        console: options.hostCalls === undefined
            ? {
                error: createSandboxClosure({
                    call: async (args) => {
                        sink.error(...args.map((value) => deepCopyFromSandbox(value)));
                        return undefined;
                    },
                    name: "error"
                }),
                log: createSandboxClosure({
                    call: async (args) => {
                        sink.log(...args.map((value) => deepCopyFromSandbox(value)));
                        return undefined;
                    },
                    name: "log"
                })
            }
            : wrapCallerInjectedBindings({
                error: (...args) => {
                    sink.error(...args);
                    return undefined;
                },
                log: (...args) => {
                    sink.log(...args);
                    return undefined;
                }
            }, {
                budget: options.budget,
                hostCalls: options.hostCalls,
                moduleId: "<console>"
            })
    };
}
function parseJson(input, budget) {
    const text = budget.allocateString(toJsonParseText(input));
    return copyJsonToSandbox(JSON.parse(text), budget);
}
async function stringifyJson(value, replacer, indent, budget) {
    if (replacer !== undefined && replacer !== null && !isSandboxClosure(replacer)) {
        throw new TypeError("JSON.stringify(value, replacer, indent) only supports function, null, or undefined replacers.");
    }
    if (indent !== undefined && typeof indent !== "number" && typeof indent !== "string") {
        throw new TypeError("JSON.stringify(value, replacer, indent) requires indent to be a string, number, or undefined.");
    }
    const holder = {};
    defineDataProperty(holder, "", value);
    const output = await stringifyProperty("", holder, {
        budget,
        gap: normalizeStringifyGap(indent),
        replacer: isSandboxClosure(replacer) ? replacer : undefined,
        stack: []
    });
    if (output === undefined) {
        return undefined;
    }
    return budget.allocateString(output);
}
function toJsonParseText(input) {
    if (Array.isArray(input)) {
        return input
            .map((entry) => (entry === null || entry === undefined ? "" : toJsonParseText(entry)))
            .join(",");
    }
    if (typeof input === "object" && input !== null) {
        return "[object Object]";
    }
    return String(input);
}
async function stringifyProperty(key, holder, state, indent = "") {
    let value = getOwnDataValue(holder, key);
    if (isStringifyContainer(value)) {
        const toJSON = getOwnDataValue(value, "toJSON");
        if (isSandboxClosure(toJSON)) {
            value = await callStringifyClosure(toJSON, [key], value, state);
        }
    }
    if (state.replacer !== undefined) {
        value = await callStringifyClosure(state.replacer, [key, toSandboxValue(value)], holder, state);
    }
    return stringifyValue(value, state, indent);
}
async function stringifyValue(value, state, indent) {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return quoteJsonString(value);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : "null";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "bigint") {
        throw new TypeError("Do not know how to serialize a BigInt.");
    }
    if (isSandboxPromise(value))
        return "{}";
    if (value === undefined || isSandboxClosure(value)) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return stringifyArray(value, state, indent);
    }
    if (isStringifyObject(value)) {
        return stringifyObject(value, state, indent);
    }
    return undefined;
}
async function stringifyArray(value, state, indent) {
    enterStringifyObject(value, state);
    try {
        const nextIndent = indent + state.gap;
        const entries = [];
        for (let index = 0; index < value.length; index += 1) {
            entries.push((await stringifyProperty(String(index), value, state, nextIndent)) ?? "null");
        }
        if (entries.length === 0) {
            return "[]";
        }
        if (state.gap === "") {
            return `[${entries.join(",")}]`;
        }
        return `[\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${indent}]`;
    }
    finally {
        leaveStringifyObject(value, state);
    }
}
async function stringifyObject(value, state, indent) {
    enterStringifyObject(value, state);
    try {
        const nextIndent = indent + state.gap;
        const entries = [];
        for (const key of Object.keys(value)) {
            const serialized = await stringifyProperty(key, value, state, nextIndent);
            if (serialized !== undefined) {
                entries.push(`${quoteJsonString(key)}:${state.gap === "" ? "" : " "}${serialized}`);
            }
        }
        if (entries.length === 0) {
            return "{}";
        }
        if (state.gap === "") {
            return `{${entries.join(",")}}`;
        }
        return `{\n${nextIndent}${entries.join(`,\n${nextIndent}`)}\n${indent}}`;
    }
    finally {
        leaveStringifyObject(value, state);
    }
}
async function callStringifyClosure(closure, args, thisValue, state) {
    const result = await closure.call(args, { stack: [], thisValue });
    if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
        await result.synchronousPrefix;
    }
    return allocateProducedSandboxValue(result, state.budget);
}
function enterStringifyObject(value, state) {
    if (state.stack.includes(value)) {
        throw new TypeError("Converting circular structure to JSON.");
    }
    state.stack.push(value);
}
function leaveStringifyObject(value, state) {
    if (state.stack.at(-1) === value) {
        state.stack.pop();
        return;
    }
    const index = state.stack.lastIndexOf(value);
    if (index >= 0) {
        state.stack.splice(index, 1);
    }
}
function normalizeStringifyGap(indent) {
    if (typeof indent === "number") {
        return " ".repeat(Math.min(10, Math.max(0, Math.trunc(indent))));
    }
    if (typeof indent === "string") {
        return indent.slice(0, 10);
    }
    return "";
}
function quoteJsonString(value) {
    return JSON.stringify(value);
}
function isStringifyContainer(value) {
    return (typeof value === "object" &&
        value !== null &&
        !isSandboxClosure(value) &&
        !isSandboxPromise(value));
}
function isStringifyObject(value) {
    return isStringifyContainer(value) && !Array.isArray(value);
}
function toSandboxValue(value) {
    if (value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        isSandboxClosure(value) ||
        isSandboxPromise(value) ||
        Array.isArray(value) ||
        isStringifyContainer(value)) {
        return value;
    }
    if (typeof value === "bigint") {
        throw new TypeError("Do not know how to serialize a BigInt.");
    }
    throw new TypeError(`JSON.stringify(value) produced an unsupported value of type ${typeof value}.`);
}
function getOwnDataValue(target, key) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) {
        return undefined;
    }
    if ("get" in descriptor || "set" in descriptor) {
        throw new TypeError(`JSON.stringify(value) cannot serialize accessor property ${key}.`);
    }
    return descriptor.value;
}
function copyJsonToSandbox(value, budget) {
    if (value === null ||
        value === undefined ||
        typeof value === "boolean" ||
        typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        return budget.allocateString(value);
    }
    if (Array.isArray(value)) {
        budget.allocateArrayLength(value.length);
        return value.map((entry) => copyJsonToSandbox(entry, budget));
    }
    if (isPlainObject(value)) {
        const copy = Object.create(null);
        for (const [key, entry] of Object.entries(value)) {
            defineDataProperty(copy, key, copyJsonToSandbox(entry, budget));
        }
        return copy;
    }
    throw new TypeError("JSON.parse(text) produced an unsupported value.");
}
function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function defineDataProperty(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
    });
}
