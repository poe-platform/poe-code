import { assertSandboxGraphDepth } from "../../graph-depth.js";
import { allocateProducedSandboxValue, cloneSandboxValue, createSandboxClosure, isSandboxClosure, isSandboxMap, isSandboxPromise, isSandboxSet } from "../values.js";
export function createMiscGlobals(options) {
    return {
        structuredClone: createSandboxClosure({
            call: ([value]) => structuredCloneSandboxValue(value, options.budget),
            name: "structuredClone"
        }),
        parseInt: createSandboxClosure({
            call: (args) => Reflect.apply(globalThis.parseInt, globalThis, [...args]),
            name: "parseInt"
        }),
        parseFloat: createSandboxClosure({
            call: (args) => Reflect.apply(globalThis.parseFloat, globalThis, [...args]),
            name: "parseFloat"
        }),
        isNaN: createSandboxClosure({
            call: ([value]) => globalThis.isNaN(value),
            name: "isNaN"
        }),
        isFinite: createSandboxClosure({
            call: ([value]) => globalThis.isFinite(value),
            name: "isFinite"
        })
    };
}
function structuredCloneSandboxValue(value, budget) {
    assertSandboxGraphDepth(value);
    const clone = cloneSandboxValue(value);
    assertStructuredCloneable(clone, new WeakSet());
    return allocateProducedSandboxValue(clone, budget);
}
function assertStructuredCloneable(value, seen) {
    if (isSandboxClosure(value) || isSandboxPromise(value)) {
        throw new TypeError("structuredClone() cannot clone closures or promises.");
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
        return;
    }
    seen.add(value);
    if (isSandboxMap(value)) {
        for (const [key, entry] of value.entries) {
            assertStructuredCloneable(key, seen);
            assertStructuredCloneable(entry, seen);
        }
        return;
    }
    if (isSandboxSet(value)) {
        for (const entry of value.values) {
            assertStructuredCloneable(entry, seen);
        }
        return;
    }
    for (const entry of Object.values(value)) {
        assertStructuredCloneable(entry, seen);
    }
}
