import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure } from "../values.js";
import { assertCollectionMutable, enterCollectionCallback } from "../running-state.js";
const setMethodNames = new Set([
    "add",
    "has",
    "delete",
    "clear",
    "forEach",
    "keys",
    "values",
    "entries"
]);
export function isSetMethodName(value) {
    return typeof value === "string" && setMethodNames.has(value);
}
export function getSetMember(target, property, options) {
    if (property === "size") {
        return target.values.size;
    }
    if (!isSetMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        call: (args, context) => callSetMethod(target, property, args, options, context?.stack ?? []),
        name: property
    });
}
export async function callSetMethod(target, methodName, args, options, stack = []) {
    switch (methodName) {
        case "add": {
            assertCollectionMutable(target);
            const nextSize = target.values.has(args[0]) ? target.values.size : target.values.size + 1;
            options.budget.allocateCollectionEntries(nextSize);
            target.values.add(args[0]);
            return target;
        }
        case "has":
            return target.values.has(args[0]);
        case "delete":
            assertCollectionMutable(target);
            return target.values.delete(args[0]);
        case "clear":
            assertCollectionMutable(target);
            target.values.clear();
            return undefined;
        case "forEach": {
            const callback = args[0];
            if (!isSandboxClosure(callback)) {
                throw new TypeError("Set.prototype.forEach requires a callback function.");
            }
            const leaveCallback = enterCollectionCallback(target);
            try {
                const values = [...target.values];
                for (let index = 0; index < values.length; index += 1) {
                    const value = values[index];
                    await options.callClosure(callback, [value, value, target], stack);
                }
            }
            finally {
                leaveCallback();
            }
            return undefined;
        }
        case "keys":
        case "values":
            return allocateProducedSandboxValue([...target.values], options.budget);
        case "entries":
            return allocateProducedSandboxValue([...target.values].map((value) => [value, value]), options.budget);
    }
}
