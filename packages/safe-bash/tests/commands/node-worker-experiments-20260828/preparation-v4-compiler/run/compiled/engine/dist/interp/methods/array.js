import { createSandboxClosure, isSandboxClosure, isSandboxMap, isSandboxPromise, isSandboxSet } from "../values.js";
import { assertCollectionMutable, enterCollectionCallback } from "../running-state.js";
const arrayMethodNames = new Set([
    "map",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
    "every",
    "reduce",
    "reduceRight",
    "forEach",
    "flatMap",
    "flat",
    "includes",
    "indexOf",
    "lastIndexOf",
    "join",
    "slice",
    "concat",
    "splice",
    "fill",
    "copyWithin",
    "at",
    "sort",
    "reverse",
    "toSorted",
    "toReversed",
    "toSpliced",
    "with",
    "push",
    "pop",
    "shift",
    "unshift"
]);
export function getArrayMember(value, property, options) {
    const index = getArrayIndex(property);
    if (index !== undefined) {
        return Object.hasOwn(value, index) ? value[index] : undefined;
    }
    if (property === "length") {
        return value.length;
    }
    if (isArrayMethodName(property)) {
        return createSandboxClosure({
            name: `Array#${property}`,
            call: (args, context) => callArrayMethod(value, property, args, options, context?.stack ?? [])
        });
    }
    return undefined;
}
function getArrayIndex(property) {
    const index = typeof property === "number" ? property : Number(property);
    if (!Number.isSafeInteger(index) ||
        index < 0 ||
        index >= 2 ** 32 - 1 ||
        String(index) !== String(property)) {
        return undefined;
    }
    return index;
}
export function isArrayMethodName(property) {
    return typeof property === "string" && arrayMethodNames.has(property);
}
export async function callArrayMethod(value, methodName, args, options, stack = []) {
    if (isMutatingArrayMethod(methodName)) {
        assertCollectionMutable(value);
    }
    if (isCallbackArrayMethod(methodName)) {
        const leaveCallback = enterCollectionCallback(value);
        try {
            return await callArrayMethodUnlocked(value, methodName, args, options, stack);
        }
        finally {
            leaveCallback();
        }
    }
    return callArrayMethodUnlocked(value, methodName, args, options, stack);
}
async function callArrayMethodUnlocked(value, methodName, args, options, stack) {
    switch (methodName) {
        case "map":
            return budgetProducedValue(await mapArray(value, getRequiredCallback(methodName, args[0]), options, stack), options.budget);
        case "filter":
            return budgetProducedValue(await filterArray(value, getRequiredCallback(methodName, args[0]), options, stack), options.budget);
        case "find":
            return budgetProducedValue(await findInArray(value, getRequiredCallback(methodName, args[0]), options, stack), options.budget);
        case "findIndex":
            return await findIndexInArray(value, getRequiredCallback(methodName, args[0]), options, stack);
        case "findLast":
            return budgetProducedValue(await findLastInArray(value, getRequiredCallback(methodName, args[0]), options, stack), options.budget);
        case "findLastIndex":
            return await findLastIndexInArray(value, getRequiredCallback(methodName, args[0]), options, stack);
        case "some":
            return await someInArray(value, getRequiredCallback(methodName, args[0]), options, stack);
        case "every":
            return await everyInArray(value, getRequiredCallback(methodName, args[0]), options, stack);
        case "reduce":
            return budgetProducedValue(await reduceArray(value, getRequiredCallback(methodName, args[0]), args.length > 1, args[1], options, stack), options.budget);
        case "reduceRight":
            return budgetProducedValue(await reduceRightArray(value, getRequiredCallback(methodName, args[0]), args.length > 1, args[1], options, stack), options.budget);
        case "forEach":
            await forEachArray(value, getRequiredCallback(methodName, args[0]), options, stack);
            return undefined;
        case "flatMap":
            return budgetProducedValue(await flatMapArray(value, getRequiredCallback(methodName, args[0]), options, stack), options.budget);
        case "flat":
            return budgetProducedValue(flattenArray(value, toIntegerOrInfinity(args[0] ?? 1), options.budget), options.budget);
        case "includes":
            return Reflect.apply(Array.prototype.includes, value, [...args]);
        case "indexOf":
            return Reflect.apply(Array.prototype.indexOf, value, [...args]);
        case "lastIndexOf":
            return Reflect.apply(Array.prototype.lastIndexOf, value, [...args]);
        case "join":
            return options.budget.allocateString(Reflect.apply(Array.prototype.join, value, [...args]));
        case "slice":
            return budgetProducedValue(Reflect.apply(Array.prototype.slice, value, [...args]), options.budget);
        case "concat":
            return budgetProducedValue(Reflect.apply(Array.prototype.concat, value, [...args]), options.budget);
        case "splice": {
            const removed = Reflect.apply(Array.prototype.splice, value, [...args]);
            budgetProducedValue(removed, options.budget);
            budgetProducedValue(value, options.budget);
            return removed;
        }
        case "fill":
            Reflect.apply(Array.prototype.fill, value, [...args]);
            budgetProducedValue(value, options.budget);
            return value;
        case "copyWithin":
            Reflect.apply(Array.prototype.copyWithin, value, [...args]);
            budgetProducedValue(value, options.budget);
            return value;
        case "at":
            return budgetProducedValue(Reflect.apply(Array.prototype.at, value, [...args]), options.budget);
        case "sort":
            if (args[0] === undefined) {
                value.sort();
                budgetProducedValue(value, options.budget);
                return value;
            }
            await sortArray(value, getRequiredCallback(methodName, args[0]), options, stack);
            budgetProducedValue(value, options.budget);
            return value;
        case "reverse":
            value.reverse();
            budgetProducedValue(value, options.budget);
            return value;
        case "toSorted": {
            const result = Array.from(value);
            if (args[0] === undefined) {
                result.sort();
            }
            else {
                await sortArray(result, getRequiredCallback(methodName, args[0]), options, stack);
            }
            return budgetProducedValue(result, options.budget);
        }
        case "toReversed": {
            const result = Array.from(value);
            result.reverse();
            return budgetProducedValue(result, options.budget);
        }
        case "toSpliced": {
            const result = Array.from(value);
            Reflect.apply(Array.prototype.splice, result, [...args]);
            return budgetProducedValue(result, options.budget);
        }
        case "with": {
            const result = Array.from(value);
            const index = toIntegerOrInfinity(args[0]);
            const actualIndex = index < 0 ? result.length + index : index;
            if (actualIndex < 0 || actualIndex >= result.length) {
                throw new RangeError("Invalid index");
            }
            result[actualIndex] = args[1];
            return budgetProducedValue(result, options.budget);
        }
        case "push": {
            appendArrayValues(value, args);
            const nextLength = value.length;
            budgetProducedValue(value, options.budget);
            return nextLength;
        }
        case "pop":
            return budgetProducedValue(value.pop(), options.budget);
        case "shift":
            return budgetProducedValue(value.shift(), options.budget);
        case "unshift": {
            prependArrayValues(value, args);
            const nextLength = value.length;
            budgetProducedValue(value, options.budget);
            return nextLength;
        }
    }
}
function appendArrayValues(target, values) {
    for (const value of values) {
        target.push(value);
    }
}
function prependArrayValues(target, values) {
    const originalLength = target.length;
    target.length = originalLength + values.length;
    for (let index = originalLength - 1; index >= 0; index -= 1) {
        const targetIndex = index + values.length;
        if (Object.hasOwn(target, index)) {
            target[targetIndex] = target[index];
        }
        else {
            delete target[targetIndex];
        }
    }
    for (let index = 0; index < values.length; index += 1) {
        target[index] = values[index];
    }
}
function isCallbackArrayMethod(methodName) {
    return (methodName === "map" ||
        methodName === "filter" ||
        methodName === "find" ||
        methodName === "findIndex" ||
        methodName === "findLast" ||
        methodName === "findLastIndex" ||
        methodName === "some" ||
        methodName === "every" ||
        methodName === "reduce" ||
        methodName === "reduceRight" ||
        methodName === "forEach" ||
        methodName === "flatMap" ||
        methodName === "sort");
}
function isMutatingArrayMethod(methodName) {
    return (methodName === "splice" ||
        methodName === "fill" ||
        methodName === "copyWithin" ||
        methodName === "sort" ||
        methodName === "reverse" ||
        methodName === "push" ||
        methodName === "pop" ||
        methodName === "shift" ||
        methodName === "unshift");
}
function getRequiredCallback(methodName, value) {
    if (!isSandboxClosure(value)) {
        throw new TypeError(`Array#${methodName} requires a sandbox closure callback.`);
    }
    return value;
}
async function mapArray(value, callback, options, stack) {
    const length = value.length;
    const result = new Array(length);
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        result[index] = await callArrayCallback(callback, value[index], index, value, options, stack);
    }
    return result;
}
async function filterArray(value, callback, options, stack) {
    const length = value.length;
    const result = [];
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        if (await callArrayCallback(callback, value[index], index, value, options, stack)) {
            result.push(value[index]);
        }
    }
    return result;
}
async function findInArray(value, callback, options, stack) {
    const index = await findIndexInArray(value, callback, options, stack);
    return index < 0 ? undefined : value[index];
}
async function findIndexInArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
        const entry = index in value ? value[index] : undefined;
        if (await callArrayCallback(callback, entry, index, value, options, stack)) {
            return index;
        }
    }
    return -1;
}
async function findLastInArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = length - 1; index >= 0; index -= 1) {
        const entry = index in value ? value[index] : undefined;
        if (await callArrayCallback(callback, entry, index, value, options, stack)) {
            return entry;
        }
    }
    return undefined;
}
async function findLastIndexInArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = length - 1; index >= 0; index -= 1) {
        const entry = index in value ? value[index] : undefined;
        if (await callArrayCallback(callback, entry, index, value, options, stack)) {
            return index;
        }
    }
    return -1;
}
async function someInArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        if (await callArrayCallback(callback, value[index], index, value, options, stack)) {
            return true;
        }
    }
    return false;
}
async function everyInArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        if (!(await callArrayCallback(callback, value[index], index, value, options, stack))) {
            return false;
        }
    }
    return true;
}
async function reduceArray(value, callback, hasInitialValue, initialValue, options, stack) {
    const length = value.length;
    const start = findNextDefinedIndex(value, 0, 1, length);
    if (hasInitialValue) {
        return reduceFromLeft(value, callback, initialValue, start, length, options, stack);
    }
    if (start < 0) {
        throw new TypeError("Reduce of empty array with no initial value.");
    }
    return reduceFromLeft(value, callback, value[start], start + 1, length, options, stack);
}
async function reduceRightArray(value, callback, hasInitialValue, initialValue, options, stack) {
    const length = value.length;
    const start = findNextDefinedIndex(value, length - 1, -1, length);
    if (hasInitialValue) {
        return reduceFromRight(value, callback, initialValue, start, length, options, stack);
    }
    if (start < 0) {
        throw new TypeError("Reduce of empty array with no initial value.");
    }
    return reduceFromRight(value, callback, value[start], start - 1, length, options, stack);
}
async function reduceFromLeft(value, callback, accumulator, startIndex, length, options, stack) {
    let current = accumulator;
    for (let index = startIndex; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        current = await options.callClosure(callback, [current, value[index], index, value], stack);
    }
    return current;
}
async function reduceFromRight(value, callback, accumulator, startIndex, length, options, stack) {
    let current = accumulator;
    for (let index = Math.min(startIndex, length - 1); index >= 0; index -= 1) {
        if (!(index in value)) {
            continue;
        }
        current = await options.callClosure(callback, [current, value[index], index, value], stack);
    }
    return current;
}
async function forEachArray(value, callback, options, stack) {
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        await callArrayCallback(callback, value[index], index, value, options, stack);
    }
}
async function flatMapArray(value, callback, options, stack) {
    const length = value.length;
    const result = [];
    for (let index = 0; index < length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        const mapped = await callArrayCallback(callback, value[index], index, value, options, stack);
        if (Array.isArray(mapped)) {
            for (let mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
                if (!(mappedIndex in mapped)) {
                    continue;
                }
                result.push(mapped[mappedIndex]);
                options.budget.allocateArrayLength(result.length);
            }
            continue;
        }
        result.push(mapped);
        options.budget.allocateArrayLength(result.length);
    }
    return result;
}
function flattenArray(value, depth, budget) {
    const result = [];
    appendFlattenedEntries(value, depth, result, budget);
    return result;
}
function appendFlattenedEntries(value, depth, result, budget) {
    for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        const entry = value[index];
        if (depth > 0 && Array.isArray(entry)) {
            appendFlattenedEntries(entry, depth - 1, result, budget);
            continue;
        }
        result.push(entry);
        budget.allocateArrayLength(result.length);
    }
}
async function sortArray(value, comparator, options, stack) {
    const definedValues = [];
    let undefinedCount = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
            continue;
        }
        const entry = value[index];
        if (entry === undefined) {
            undefinedCount += 1;
            continue;
        }
        definedValues.push(entry);
    }
    for (let index = 1; index < definedValues.length; index += 1) {
        const entry = definedValues[index];
        let cursor = index - 1;
        while (cursor >= 0 &&
            (await compareEntries(definedValues[cursor], entry, comparator, options, stack)) > 0) {
            definedValues[cursor + 1] = definedValues[cursor];
            cursor -= 1;
        }
        definedValues[cursor + 1] = entry;
    }
    for (let index = 0; index < definedValues.length; index += 1) {
        value[index] = definedValues[index];
    }
    for (let index = 0; index < undefinedCount; index += 1) {
        value[definedValues.length + index] = undefined;
    }
    for (let index = definedValues.length + undefinedCount; index < value.length; index += 1) {
        delete value[index];
    }
}
async function compareEntries(left, right, comparator, options, stack) {
    const result = Number(await options.callClosure(comparator, [left, right], stack));
    return Number.isNaN(result) ? 0 : result;
}
async function callArrayCallback(callback, value, index, array, options, stack) {
    return options.callClosure(callback, [value, index, array], stack);
}
function findNextDefinedIndex(value, startIndex, direction, length) {
    for (let index = startIndex; direction > 0 ? index < length : index >= 0; index += direction) {
        if (index in value) {
            return index;
        }
    }
    return -1;
}
function budgetProducedValue(value, budget) {
    allocateProducedValue(value, budget, new WeakSet());
    return value;
}
function allocateProducedValue(value, budget, seen) {
    if (typeof value === "string") {
        budget.allocateString(value);
        return;
    }
    if (Array.isArray(value)) {
        budget.allocateArrayLength(value.length);
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        for (const entry of value) {
            allocateProducedValue(entry, budget, seen);
        }
        return;
    }
    if (isSandboxMap(value)) {
        budget.allocateCollectionEntries(value.entries.size);
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        for (const [key, entry] of value.entries) {
            allocateProducedValue(key, budget, seen);
            allocateProducedValue(entry, budget, seen);
        }
        return;
    }
    if (isSandboxSet(value)) {
        budget.allocateCollectionEntries(value.values.size);
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        for (const entry of value.values) {
            allocateProducedValue(entry, budget, seen);
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
    for (const entry of Object.values(value)) {
        allocateProducedValue(entry, budget, seen);
    }
}
function toIntegerOrInfinity(value) {
    const number = Number(value);
    if (Number.isNaN(number) || Object.is(number, 0) || Object.is(number, -0)) {
        return 0;
    }
    if (!Number.isFinite(number)) {
        return number;
    }
    return Math.trunc(number);
}
