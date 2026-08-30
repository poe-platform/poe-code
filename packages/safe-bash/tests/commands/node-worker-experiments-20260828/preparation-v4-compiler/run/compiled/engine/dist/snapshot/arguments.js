export function serializeArguments(value, serializeValue) {
    const properties = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!("value" in descriptor)) {
            if (key !== "callee")
                throw new TypeError(`Cannot snapshot arguments accessor '${key}'.`);
            continue;
        }
        properties[key] = {
            value: serializeValue(descriptor.value, key),
            configurable: descriptor.configurable === true,
            enumerable: descriptor.enumerable === true,
            writable: descriptor.writable === true
        };
    }
    const iterator = Object.getOwnPropertyDescriptor(value, Symbol.iterator);
    if (iterator !== undefined && iterator.value !== Array.prototype.values) {
        throw new TypeError("Cannot snapshot a replaced arguments iterator.");
    }
    const names = Object.getOwnPropertyNames(value);
    return {
        kind: "arguments",
        extensible: Object.isExtensible(value),
        lengthBeforeCallee: names.includes("length") && names.indexOf("length") < names.indexOf("callee"),
        iterator: iterator === undefined
            ? null
            : {
                configurable: iterator.configurable === true,
                enumerable: iterator.enumerable === true,
                writable: iterator.writable === true
            },
        properties
    };
}
