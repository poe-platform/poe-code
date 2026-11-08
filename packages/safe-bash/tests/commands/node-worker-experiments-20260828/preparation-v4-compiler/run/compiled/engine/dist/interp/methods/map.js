import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure } from "../values.js";
import { assertCollectionMutable, enterCollectionCallback } from "../running-state.js";
const mapMethodNames = new Set([
    "get",
    "set",
    "has",
    "delete",
    "clear",
    "forEach",
    "keys",
    "values",
    "entries"
]);
export function isMapMethodName(value) {
    return typeof value === "string" && mapMethodNames.has(value);
}
export function getMapMember(target, property, options) {
    if (property === "size") {
        return target.entries.size;
    }
    if (!isMapMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        call: (args, context) => callMapMethod(target, property, args, options, context?.stack ?? []),
        name: property
    });
}
export async function callMapMethod(target, methodName, args, options, stack = []) {
    switch (methodName) {
        case "get":
            return target.entries.get(args[0]);
        case "set": {
            assertCollectionMutable(target);
            const nextSize = target.entries.has(args[0]) ? target.entries.size : target.entries.size + 1;
            options.budget.allocateCollectionEntries(nextSize);
            target.entries.set(args[0], args[1]);
            return target;
        }
        case "has":
            return target.entries.has(args[0]);
        case "delete":
            assertCollectionMutable(target);
            return target.entries.delete(args[0]);
        case "clear":
            assertCollectionMutable(target);
            target.entries.clear();
            return undefined;
        case "forEach": {
            const callback = args[0];
            if (!isSandboxClosure(callback)) {
                throw new TypeError("Map.prototype.forEach requires a callback function.");
            }
            const leaveCallback = enterCollectionCallback(target);
            try {
                const entries = [...target.entries];
                for (let index = 0; index < entries.length; index += 1) {
                    const [key, value] = entries[index];
                    await options.callClosure(callback, [value, key, target], stack);
                }
            }
            finally {
                leaveCallback();
            }
            return undefined;
        }
        case "keys":
            return allocateProducedSandboxValue([...target.entries.keys()], options.budget);
        case "values":
            return allocateProducedSandboxValue([...target.entries.values()], options.budget);
        case "entries":
            return allocateProducedSandboxValue([...target.entries].map(([key, value]) => [key, value]), options.budget);
    }
}
