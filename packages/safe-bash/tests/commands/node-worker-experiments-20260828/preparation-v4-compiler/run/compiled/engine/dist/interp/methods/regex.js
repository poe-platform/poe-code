import { createSandboxClosure, getSandboxRegexPattern } from "../values.js";
import { matchRegex } from "../regex/engine.js";
const regexMethodNames = new Set(["exec", "test"]);
export function isRegexMethodName(property) {
    return typeof property === "string" && regexMethodNames.has(property);
}
export function getRegexMember(target, property) {
    if (property === "source" || property === "flags" || property === "lastIndex") {
        return target[property];
    }
    if (!isRegexMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        name: `RegExp#${property}`,
        call: (args) => callRegexMethod(target, property, args)
    });
}
export function setRegexMember(target, property, value) {
    if (property !== "lastIndex") {
        throw new TypeError(`RegExp#${String(property)} is not writable.`);
    }
    target.lastIndex = Number(value);
}
export function callRegexMethod(target, methodName, args) {
    const match = executeRegex(target, String(args[0]));
    return methodName === "test" ? match !== null : toMatchArray(match, String(args[0]));
}
export function executeRegex(target, input) {
    const pattern = getSandboxRegexPattern(target);
    const match = matchRegex(pattern, input, target.lastIndex);
    if (pattern.flags.global) {
        target.lastIndex = match === null ? 0 : match.index + match.text.length;
    }
    return match;
}
export function toMatchArray(match, input) {
    if (match === null) {
        return null;
    }
    const result = [match.text, ...match.captures];
    Object.assign(result, { groups: undefined, index: match.index, input });
    return result;
}
