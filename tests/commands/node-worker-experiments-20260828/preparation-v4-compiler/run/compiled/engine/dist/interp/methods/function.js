import { createSandboxClosure } from "../values.js";
const functionMethodNames = new Set(["apply", "call"]);
export function getFunctionMember(target, property, options) {
    const propertyValue = target.properties?.[String(property)];
    if (propertyValue !== undefined || Object.hasOwn(target.properties ?? {}, String(property))) {
        return propertyValue;
    }
    if (!isFunctionMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        name: `Function#${property}`,
        call: (args, context) => callFunctionMethod(target, property, args, options, context?.stack ?? [])
    });
}
function isFunctionMethodName(property) {
    return typeof property === "string" && functionMethodNames.has(property);
}
function callFunctionMethod(target, methodName, args, options, stack) {
    const thisValue = args[0];
    if (methodName === "call") {
        return options.callClosure(target, args.slice(1), stack, thisValue);
    }
    const applyArgs = args[1];
    if (applyArgs === null || applyArgs === undefined) {
        return options.callClosure(target, [], stack, thisValue);
    }
    if (!Array.isArray(applyArgs)) {
        throw new TypeError("Function#apply requires an array or nullish arguments value.");
    }
    return options.callClosure(target, applyArgs, stack, thisValue);
}
