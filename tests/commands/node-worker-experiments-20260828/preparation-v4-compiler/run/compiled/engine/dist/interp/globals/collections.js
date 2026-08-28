import { getSandboxIterator } from "../iteration.js";
import { createSandboxClosure, createSandboxMap, createSandboxSet, isSandboxMap, isSandboxSet } from "../values.js";
const mapConstructors = new WeakSet();
const setConstructors = new WeakSet();
export function createCollectionGlobals(options) {
    const mapConstructor = createSandboxClosure({
        call: () => {
            throw new TypeError("Constructor Map requires 'new'.");
        },
        construct: ([source]) => {
            const entries = getMapEntries(source);
            if (entries instanceof Promise) {
                return entries.then((resolved) => createBudgetedMap(resolved, options.budget));
            }
            return createBudgetedMap(entries, options.budget);
        },
        name: "Map"
    });
    const setConstructor = createSandboxClosure({
        call: () => {
            throw new TypeError("Constructor Set requires 'new'.");
        },
        construct: ([source]) => {
            const values = getSetValues(source);
            if (values instanceof Promise) {
                return values.then((resolved) => createBudgetedSet(resolved, options.budget));
            }
            return createBudgetedSet(values, options.budget);
        },
        name: "Set"
    });
    mapConstructors.add(mapConstructor);
    setConstructors.add(setConstructor);
    return { Map: mapConstructor, Set: setConstructor };
}
export function isSandboxMapConstructor(value) {
    return (typeof value === "object" && value !== null && mapConstructors.has(value));
}
export function isSandboxSetConstructor(value) {
    return (typeof value === "object" && value !== null && setConstructors.has(value));
}
function getMapEntries(source) {
    if (source === undefined) {
        return [];
    }
    if (isSandboxMap(source)) {
        return [...source.entries];
    }
    if (Array.isArray(source)) {
        return validateMapEntries(source);
    }
    const iterator = getSandboxIterator(source);
    if (iterator?.generator !== true) {
        throw new TypeError("Map constructor argument must be an array of pairs or a Map.");
    }
    return collectMapEntries(iterator);
}
async function collectMapEntries(iterator) {
    const sourceEntries = [];
    while (true) {
        const result = await iterator.next();
        if (result.done)
            break;
        sourceEntries.push(result.value);
    }
    return validateMapEntries(sourceEntries);
}
function validateMapEntries(sourceEntries) {
    return sourceEntries.map((entry) => {
        if (!Array.isArray(entry)) {
            throw new TypeError("Map constructor entries must be arrays.");
        }
        return [entry[0], entry[1]];
    });
}
function getSetValues(source) {
    if (source === undefined) {
        return [];
    }
    if (isSandboxSet(source)) {
        return [...source.values];
    }
    if (typeof source === "string")
        return [...source];
    if (Array.isArray(source))
        return [...source];
    const iterator = getSandboxIterator(source);
    if (iterator?.generator === true) {
        return collectSetValues(iterator);
    }
    throw new TypeError("Set constructor argument must be an array, string, or Set.");
}
async function collectSetValues(iterator) {
    const values = [];
    while (true) {
        const result = await iterator.next();
        if (result.done)
            break;
        values.push(result.value);
    }
    return values;
}
function createBudgetedMap(entries, budget) {
    const map = createSandboxMap(entries);
    budget.allocateCollectionEntries(map.entries.size);
    return map;
}
function createBudgetedSet(values, budget) {
    budget.allocateCollectionEntries(new Set(values).size);
    return createSandboxSet(values);
}
