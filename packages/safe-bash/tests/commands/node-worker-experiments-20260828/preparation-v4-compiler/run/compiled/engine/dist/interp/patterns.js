import { isSandboxMap, isSandboxSet } from "./values.js";
export async function bindPattern(pattern, value, target, scope, context) {
    switch (pattern.type) {
        case "Identifier":
            bindIdentifier(pattern, value, target, scope);
            return { ok: true };
        case "MemberExpression":
            if ("kind" in target) {
                throw new TypeError("Destructuring declarations cannot bind to member expressions.");
            }
            return bindMemberExpression(pattern, value, scope, context);
        case "AssignmentPattern":
            return bindAssignmentPattern(pattern, value, target, scope, context);
        case "ArrayPattern":
            return bindArrayPattern(pattern, value, target, scope, context);
        case "ObjectPattern":
            return bindObjectPattern(pattern, value, target, scope, context);
        case "RestElement":
            return bindPattern(pattern.argument, value, target, scope, context);
    }
}
function bindIdentifier(pattern, value, target, scope) {
    if ("assign" in target || target.kind === "var") {
        if ("assign" in target) {
            const binding = scope.lookup(pattern.name);
            if (!binding.found) {
                throw new ReferenceError(`Cannot assign to undeclared binding '${pattern.name}'.`);
            }
            if (binding.kind === "const") {
                throw new TypeError(`Cannot assign to const '${pattern.name}'`);
            }
        }
        scope.assign(pattern.name, value);
        return;
    }
    scope.declare(pattern.name, target.kind, value);
}
async function bindAssignmentPattern(pattern, value, target, scope, context) {
    if (value !== undefined) {
        return bindPattern(pattern.left, value, target, scope, context);
    }
    const defaultValue = await context.evaluate(pattern.right);
    if (defaultValue.kind !== "normal") {
        return { ok: false, result: defaultValue };
    }
    return bindPattern(pattern.left, defaultValue.value, target, scope, context);
}
async function bindArrayPattern(pattern, value, target, scope, context) {
    const values = getArrayPatternValues(value);
    for (let index = 0; index < pattern.elements.length; index += 1) {
        const element = pattern.elements[index];
        if (element === null) {
            continue;
        }
        const elementValue = element.type === "RestElement" ? values.slice(index) : values[index];
        const binding = await bindPattern(element, elementValue, target, scope, context);
        if (!binding.ok) {
            return binding;
        }
    }
    return { ok: true };
}
async function bindObjectPattern(pattern, value, target, scope, context) {
    if (typeof value !== "object" || value === null) {
        throw new TypeError("Object destructuring declarations require a non-null object value.");
    }
    const excludedKeys = new Set();
    for (const property of pattern.properties) {
        if (property.type === "RestElement") {
            const binding = await bindPattern(property, copyObjectRestValue(value, excludedKeys), target, scope, context);
            if (!binding.ok) {
                return binding;
            }
            continue;
        }
        const key = await evaluatePatternKey(property, context);
        if (!key.ok) {
            return key;
        }
        excludedKeys.add(String(key.value));
        const binding = await bindPattern(property.value, value[key.value], target, scope, context);
        if (!binding.ok) {
            return binding;
        }
    }
    return { ok: true };
}
async function bindMemberExpression(pattern, value, scope, context) {
    const object = await context.evaluate(pattern.object);
    if (object.kind !== "normal") {
        return { ok: false, result: object };
    }
    if (object.value === null || object.value === undefined) {
        throw new TypeError("Cannot assign properties of null or undefined.");
    }
    if (!isIndexableValue(object.value)) {
        throw new TypeError("Assignment expressions require a sandbox object property.");
    }
    const property = pattern.computed
        ? await evaluateProperty(pattern.property, context)
        : { ok: true, value: getStaticPropertyName(pattern.property) };
    if (!property.ok) {
        return property;
    }
    setProperty(object.value, property.value, value);
    return { ok: true };
}
async function evaluatePatternKey(property, context) {
    return property.computed
        ? evaluateProperty(property.key, context)
        : { ok: true, value: getStaticPropertyName(property.key) };
}
async function evaluateProperty(property, context) {
    const result = await context.evaluate(property);
    if (result.kind !== "normal") {
        return { ok: false, result };
    }
    if (typeof result.value !== "string" && typeof result.value !== "number") {
        throw new TypeError("Computed property access requires a string or number key.");
    }
    return { ok: true, value: result.value };
}
function getStaticPropertyName(property) {
    if (property.type === "Identifier") {
        return property.name;
    }
    if (property.type === "StringLiteral" || property.type === "NumericLiteral") {
        return property.value;
    }
    throw new TypeError(`Unsupported static property node '${property.type}'.`);
}
function getArrayPatternValues(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === "string") {
        return Array.from(value);
    }
    if (isSandboxMap(value)) {
        return Array.from(value.entries, ([key, entry]) => [key, entry]);
    }
    if (isSandboxSet(value)) {
        return [...value.values];
    }
    if (isIterableValue(value)) {
        throw new TypeError(`Array destructuring declarations support only arrays and strings; received ${describeRuntimeValue(value)}.`);
    }
    throw new TypeError("Array destructuring declarations require an array or string iterable.");
}
function isIterableValue(value) {
    return (typeof value === "object" &&
        value !== null &&
        Symbol.iterator in value &&
        typeof value[Symbol.iterator] === "function");
}
function describeRuntimeValue(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    if (typeof value === "object")
        return value.constructor?.name ?? "Object";
    return typeof value;
}
function copyObjectRestValue(value, excludedKeys) {
    const rest = Object.create(null);
    for (const [key, entryValue] of Object.entries(value)) {
        if (!excludedKeys.has(key)) {
            defineProperty(rest, key, entryValue);
        }
    }
    return rest;
}
function isIndexableValue(value) {
    return typeof value === "object" && value !== null;
}
function setProperty(target, property, value) {
    if (Array.isArray(target)) {
        const key = String(property);
        if (key === "length" || isArrayIndexKey(key)) {
            target[key] = value;
            return;
        }
        defineProperty(target, key, value);
        return;
    }
    defineProperty(target, String(property), value);
}
function isArrayIndexKey(value) {
    if (value === "") {
        return false;
    }
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === value;
}
function defineProperty(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
    });
}
