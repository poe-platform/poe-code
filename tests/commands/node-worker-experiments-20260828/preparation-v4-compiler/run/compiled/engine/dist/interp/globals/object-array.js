import { getSandboxIterator } from "../iteration.js";
import { allocateProducedSandboxValue, createSandboxClosure, deepCopyToSandbox, isSandboxClosure, isSandboxMap, isSandboxPromise, isSandboxRegex, isSandboxSet } from "../values.js";
export function createObjectArrayGlobals(options) {
    return {
        Object: {
            keys: createSandboxClosure({
                call: ([value]) => budgetSandboxValue(getOwnEnumerableKeys(value), options.budget),
                name: "keys"
            }),
            values: createSandboxClosure({
                call: ([value]) => budgetSandboxValue(getOwnEnumerableValues(value), options.budget),
                name: "values"
            }),
            entries: createSandboxClosure({
                call: ([value]) => budgetSandboxValue(getOwnEnumerableEntries(value), options.budget),
                name: "entries"
            }),
            hasOwn: createSandboxClosure({
                call: ([value, key]) => Reflect.apply(Object.hasOwn, Object, [value, key]),
                name: "hasOwn"
            }),
            is: createSandboxClosure({
                call: ([left, right]) => Reflect.apply(Object.is, Object, [left, right]),
                name: "is"
            }),
            fromEntries: createSandboxClosure({
                call: ([value]) => budgetSandboxValue(Reflect.apply(Object.fromEntries, Object, [value]), options.budget),
                name: "fromEntries"
            }),
            freeze: createSandboxClosure({
                call: ([value]) => {
                    if (typeof value === "object" && value !== null) {
                        Object.freeze(value);
                    }
                    return value;
                },
                name: "freeze"
            }),
            isFrozen: createSandboxClosure({
                call: ([value]) => Object.isFrozen(value),
                name: "isFrozen"
            }),
            assign: createSandboxClosure({
                call: ([target, ...sources]) => assignSandboxValues(target, sources),
                name: "assign"
            })
        },
        Array: createSandboxClosure({
            call: (args) => createArrayFromConstructorArgs(args, options.budget),
            construct: (args) => createArrayFromConstructorArgs(args, options.budget),
            name: "Array",
            properties: {
                isArray: createSandboxClosure({
                    call: ([value]) => Array.isArray(value),
                    name: "isArray"
                }),
                from: createSandboxClosure({
                    call: (args) => arrayFromSandboxValues(args, options.budget),
                    name: "from"
                }),
                of: createSandboxClosure({
                    call: (args) => budgetSandboxValue(Reflect.apply(Array.of, Array, [...args]), options.budget),
                    name: "of"
                })
            }
        }),
        String: createSandboxClosure({
            call: ([value]) => options.budget.allocateString(String(value)),
            name: "String",
            properties: {
                raw: createSandboxClosure({
                    call: (args) => stringRaw(args, options.budget),
                    name: "raw"
                }),
                fromCharCode: createSandboxClosure({
                    call: (args) => options.budget.allocateString(Reflect.apply(String.fromCharCode, String, [...args])),
                    name: "fromCharCode"
                }),
                fromCodePoint: createSandboxClosure({
                    call: (args) => options.budget.allocateString(Reflect.apply(String.fromCodePoint, String, [...args])),
                    name: "fromCodePoint"
                })
            }
        }),
        Number: createSandboxClosure({
            call: ([value]) => Number(value),
            name: "Number",
            properties: {
                isFinite: createSandboxClosure({
                    call: ([value]) => typeof value === "number" && Number.isFinite(value),
                    name: "isFinite"
                }),
                isNaN: createSandboxClosure({
                    call: ([value]) => typeof value === "number" && Number.isNaN(value),
                    name: "isNaN"
                }),
                isInteger: createSandboxClosure({
                    call: ([value]) => typeof value === "number" && Number.isInteger(value),
                    name: "isInteger"
                }),
                parseInt: createSandboxClosure({
                    call: (args) => Reflect.apply(Number.parseInt, Number, [...args]),
                    name: "parseInt"
                }),
                parseFloat: createSandboxClosure({
                    call: (args) => Reflect.apply(Number.parseFloat, Number, [...args]),
                    name: "parseFloat"
                }),
                isSafeInteger: createSandboxClosure({
                    call: ([value]) => typeof value === "number" && Number.isSafeInteger(value),
                    name: "isSafeInteger"
                }),
                MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
                MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
                EPSILON: Number.EPSILON,
                MAX_VALUE: Number.MAX_VALUE,
                MIN_VALUE: Number.MIN_VALUE
            }
        }),
        Boolean: createSandboxClosure({
            call: ([value]) => Boolean(value),
            name: "Boolean"
        })
    };
}
function assignSandboxValues(target, sources) {
    if (target === null || target === undefined) {
        throw new TypeError("Object.assign(target, ...sources) requires a non-null target.");
    }
    if (!isAssignableSandboxTarget(target)) {
        throw new TypeError("Object.assign(target, ...sources) requires an object or array target.");
    }
    for (const source of sources) {
        if (source === null || source === undefined) {
            continue;
        }
        for (const [key, value] of getOwnEnumerableEntries(source)) {
            Object.defineProperty(target, key, {
                configurable: true,
                enumerable: true,
                value,
                writable: true
            });
        }
    }
    return target;
}
function isAssignableSandboxTarget(value) {
    return (typeof value === "object" &&
        value !== null &&
        !isSandboxClosure(value) &&
        !isSandboxMap(value) &&
        !isSandboxSet(value) &&
        !isSandboxPromise(value) &&
        !isSandboxRegex(value));
}
async function arrayFromSandboxValues(args, budget) {
    const [items, mapFn] = args;
    const iterator = getSandboxIterator(items);
    const values = iterator === undefined
        ? Reflect.apply(Array.from, Array, [items])
        : await collectIteratorValues(iterator);
    if (mapFn === undefined || !isSandboxClosure(mapFn)) {
        if (mapFn !== undefined) {
            throw new TypeError("Array.from mapping callback must be a function.");
        }
        return budgetSandboxValue(values, budget);
    }
    const mappedValues = [];
    for (const [index, value] of values.entries()) {
        const result = await mapFn.call([value, index]);
        if (isSandboxPromise(result) && result.synchronousPrefix !== undefined) {
            await result.synchronousPrefix;
        }
        mappedValues.push(result);
    }
    return budgetSandboxValue(mappedValues, budget);
}
function createArrayFromConstructorArgs(args, budget) {
    if (args.length !== 1) {
        return budgetSandboxValue(Reflect.apply(Array, Array, [...args]), budget);
    }
    const [lengthOrValue] = args;
    if (typeof lengthOrValue !== "number") {
        return budgetSandboxValue([lengthOrValue], budget);
    }
    if (!Number.isInteger(lengthOrValue) || lengthOrValue < 0 || lengthOrValue > 0xffffffff) {
        throw new RangeError("Invalid array length.");
    }
    budget.allocateArrayLength(lengthOrValue);
    return new Array(lengthOrValue);
}
async function collectIteratorValues(iterator) {
    const values = [];
    while (true) {
        const result = await iterator.next();
        if (result.done)
            return values;
        values.push(result.value);
    }
}
function getOwnEnumerableKeys(value) {
    return getOwnEnumerableEntries(value).map(([key]) => key);
}
function getOwnEnumerableValues(value) {
    return getOwnEnumerableEntries(value).map(([, entryValue]) => entryValue);
}
function getOwnEnumerableEntries(value) {
    if (value === null || value === undefined) {
        throw new TypeError("Cannot convert undefined or null to object.");
    }
    if (isSandboxClosure(value) ||
        isSandboxMap(value) ||
        isSandboxSet(value) ||
        isSandboxPromise(value) ||
        isSandboxRegex(value)) {
        return [];
    }
    return Object.entries(Object(value));
}
function budgetSandboxValue(value, budget) {
    const sandboxValue = deepCopyToSandbox(value);
    return allocateProducedSandboxValue(sandboxValue, budget);
}
function stringRaw(args, budget) {
    const [template, ...substitutions] = args;
    const raw = getTemplateRawParts(template);
    let result = "";
    for (let index = 0; index < raw.length; index += 1) {
        result += String(raw[index]);
        if (index < raw.length - 1 && index < substitutions.length) {
            result += String(substitutions[index]);
        }
    }
    return budget.allocateString(result);
}
function getTemplateRawParts(template) {
    const raw = typeof template === "object" && template !== null
        ? template.raw
        : undefined;
    if (typeof template !== "object" ||
        template === null ||
        isSandboxClosure(template) ||
        isSandboxPromise(template) ||
        !Array.isArray(raw)) {
        throw new TypeError("String.raw requires a raw strings array.");
    }
    return raw;
}
