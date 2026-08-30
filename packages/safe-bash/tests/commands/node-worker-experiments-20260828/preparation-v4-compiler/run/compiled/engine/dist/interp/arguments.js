const sandboxArgumentsBrand = Symbol("SandboxArguments");
export function createSandboxArguments(values) {
    const result = (function () {
        return arguments;
    })();
    for (let index = 0; index < values.length; index += 1) {
        result[index] = values[index];
    }
    result.length = values.length;
    Object.defineProperty(result, sandboxArgumentsBrand, { value: true });
    return result;
}
export function isSandboxArguments(value) {
    return typeof value === "object" && value !== null && Object.hasOwn(value, sandboxArgumentsBrand);
}
export function getSandboxArgumentEntries(value) {
    return Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([key, descriptor]) => "value" in descriptor ? [[key, descriptor.value]] : []);
}
export function copySandboxArgumentProperties(source, target, copyValue) {
    const names = Object.getOwnPropertyNames(source);
    if (!names.includes("length") || names.indexOf("length") > names.indexOf("callee")) {
        Reflect.deleteProperty(target, "length");
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
        if (!("value" in descriptor)) {
            if (key !== "callee")
                throw new TypeError(`Cannot copy arguments accessor '${key}'.`);
            continue;
        }
        Object.defineProperty(target, key, { ...descriptor, value: copyValue(descriptor.value, key) });
    }
    const iterator = Object.getOwnPropertyDescriptor(source, Symbol.iterator);
    if (iterator === undefined) {
        Reflect.deleteProperty(target, Symbol.iterator);
    }
    else {
        if (iterator.value !== Array.prototype.values) {
            throw new TypeError("Cannot copy a replaced arguments iterator.");
        }
        Object.defineProperty(target, Symbol.iterator, iterator);
    }
    if (!Object.isExtensible(source))
        Object.preventExtensions(target);
}
