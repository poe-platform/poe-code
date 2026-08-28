import { createSandboxClosure, getSandboxRegexPattern, isSandboxClosure, isSandboxRegex } from "../values.js";
import { matchRegexFrom } from "../regex/engine.js";
import { executeRegex, toMatchArray } from "./regex.js";
const SPLIT_STRING_MESSAGE = "String#split only supports string separator values.";
const stringMethodNames = new Set([
    "at",
    "charAt",
    "charCodeAt",
    "codePointAt",
    "concat",
    "endsWith",
    "includes",
    "indexOf",
    "lastIndexOf",
    "match",
    "matchAll",
    "normalize",
    "padEnd",
    "padStart",
    "repeat",
    "replace",
    "replaceAll",
    "slice",
    "search",
    "split",
    "startsWith",
    "substr",
    "substring",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimEnd",
    "trimStart"
]);
export function getStringMember(value, property, budget) {
    const index = getStringIndex(property);
    if (index !== undefined) {
        return value[index];
    }
    if (property === "length") {
        return value.length;
    }
    if (!isStringMethodName(property)) {
        return undefined;
    }
    return createSandboxClosure({
        name: `String#${property}`,
        call: (args) => callStringMethod(value, property, args, budget)
    });
}
function getStringIndex(property) {
    const index = typeof property === "number" ? property : Number(property);
    if (!Number.isInteger(index) || index < 0 || String(index) !== String(property)) {
        return undefined;
    }
    return index;
}
export function isStringMethodName(property) {
    return typeof property === "string" && stringMethodNames.has(property);
}
export function validateStringMethodArguments(_methodName, _args) { }
export function callStringMethod(value, methodName, args, budget, callClosure = async (closure, closureArgs) => await closure.call(closureArgs)) {
    if (methodName === "replace" || methodName === "replaceAll") {
        return callReplaceLikeMethod(value, methodName, args, budget, callClosure);
    }
    if (methodName === "split") {
        return callSplit(value, args, budget);
    }
    if (methodName === "match" || methodName === "matchAll" || methodName === "search") {
        return callMatchLikeMethod(value, methodName, args);
    }
    if (args.some(isSandboxClosure)) {
        throw new TypeError(`String#${methodName} does not support function arguments.`);
    }
    switch (methodName) {
        case "at": {
            const result = value.at(asNumber(args[0]));
            return result === undefined ? undefined : budget.allocateString(result);
        }
        case "charAt":
            return budget.allocateString(value.charAt(asNumber(args[0])));
        case "charCodeAt":
            return value.charCodeAt(asNumber(args[0]));
        case "codePointAt":
            return value.codePointAt(asNumber(args[0]));
        case "concat":
            return budget.allocateString(value.concat(...args.map(String)));
        case "endsWith":
            return value.endsWith(String(args[0]), asNumberOrUndefined(args[1]));
        case "includes":
            return value.includes(String(args[0]), asNumberOrUndefined(args[1]));
        case "indexOf":
            return value.indexOf(String(args[0]), asNumberOrUndefined(args[1]));
        case "lastIndexOf":
            return value.lastIndexOf(String(args[0]), asNumberOrUndefined(args[1]));
        case "normalize":
            return budget.allocateString(value.normalize(asStringOrUndefined(args[0])));
        case "padEnd":
            return budget.allocateString(value.padEnd(asNumber(args[0]), asStringOrUndefined(args[1])));
        case "padStart":
            return budget.allocateString(value.padStart(asNumber(args[0]), asStringOrUndefined(args[1])));
        case "repeat":
            return budget.allocateString(value.repeat(asNumber(args[0])));
        case "slice":
            return budget.allocateString(value.slice(asNumberOrUndefined(args[0]), asNumberOrUndefined(args[1])));
        case "startsWith":
            return value.startsWith(String(args[0]), asNumberOrUndefined(args[1]));
        case "substr":
            return budget.allocateString(value.substr(asNumber(args[0]), asNumberOrUndefined(args[1])));
        case "substring":
            return budget.allocateString(value.substring(asNumber(args[0]), asNumberOrUndefined(args[1])));
        case "toLowerCase":
            return budget.allocateString(value.toLowerCase());
        case "toUpperCase":
            return budget.allocateString(value.toUpperCase());
        case "trim":
            return budget.allocateString(value.trim());
        case "trimEnd":
            return budget.allocateString(value.trimEnd());
        case "trimStart":
            return budget.allocateString(value.trimStart());
    }
}
function callReplaceLikeMethod(value, methodName, args, budget, callClosure) {
    const search = args[0];
    const replacement = args[1];
    if ((!isSandboxRegex(search) && typeof search !== "string") ||
        (typeof replacement !== "string" && !isSandboxClosure(replacement))) {
        throw new TypeError(`String#${methodName} only supports string or regex search values and string or function replacements.`);
    }
    if (isSandboxRegex(search)) {
        if (methodName === "replaceAll" && !search.flags.includes("g")) {
            throw new TypeError("String#replaceAll requires a global regex.");
        }
        return replaceRegex(value, search, replacement, methodName === "replaceAll", budget, callClosure);
    }
    if (typeof replacement === "string") {
        return budget.allocateString(methodName === "replace"
            ? value.replace(search, replacement)
            : value.replaceAll(search, replacement));
    }
    return replaceWithClosure(value, search, replacement, methodName === "replaceAll", budget, callClosure);
}
async function replaceRegex(value, regex, replacement, replaceAll, budget, callClosure) {
    const matches = collectRegexMatches(regex, value, replaceAll || regex.flags.includes("g"));
    let result = "";
    let copiedThrough = 0;
    for (const match of matches) {
        result += value.slice(copiedThrough, match.index);
        result +=
            typeof replacement === "string"
                ? expandReplacement(replacement, match.text, match.captures)
                : String(await callClosure(replacement, [match.text, ...match.captures, match.index, value]));
        copiedThrough = match.index + match.text.length;
    }
    result += value.slice(copiedThrough);
    return budget.allocateString(result);
}
function expandReplacement(replacement, match, captures) {
    return replacement.replace(/\$([$&]|[1-9][0-9]?)/g, (token, part) => {
        if (part === "$")
            return "$";
        if (part === "&")
            return match;
        return captures[Number(part) - 1] ?? token;
    });
}
async function replaceWithClosure(value, searchValue, replacer, replaceAll, budget, callClosure) {
    const offsets = findReplacementOffsets(value, searchValue, replaceAll);
    let result = "";
    let copiedThrough = 0;
    for (const offset of offsets) {
        result += value.slice(copiedThrough, offset);
        result += String(await callClosure(replacer, [searchValue, offset, value]));
        copiedThrough = offset + searchValue.length;
    }
    result += value.slice(copiedThrough);
    return budget.allocateString(result);
}
function findReplacementOffsets(value, searchValue, replaceAll) {
    const firstOffset = value.indexOf(searchValue);
    if (firstOffset === -1) {
        return [];
    }
    if (!replaceAll) {
        return [firstOffset];
    }
    if (searchValue.length === 0) {
        return Array.from({ length: value.length + 1 }, (_, offset) => offset);
    }
    const offsets = [];
    let offset = firstOffset;
    while (offset !== -1) {
        offsets.push(offset);
        offset = value.indexOf(searchValue, offset + searchValue.length);
    }
    return offsets;
}
function callSplit(value, args, budget) {
    if (args.some(isSandboxClosure))
        throw new TypeError("String#split does not support function arguments.");
    if (isSandboxRegex(args[0])) {
        const limit = asNumberOrUndefined(args[1]) ?? 2 ** 32 - 1;
        const result = [];
        let copiedThrough = 0;
        let endedWithZeroWidthMatch = false;
        for (const match of collectRegexMatches(args[0], value, true)) {
            endedWithZeroWidthMatch = match.text.length === 0 && match.index === value.length;
            if (match.text.length === 0 && match.index === 0)
                continue;
            if (result.length >= limit)
                break;
            result.push(budget.allocateString(value.slice(copiedThrough, match.index)));
            for (const capture of match.captures) {
                if (result.length >= limit)
                    break;
                result.push(capture === undefined ? undefined : budget.allocateString(capture));
            }
            copiedThrough = match.index + match.text.length;
        }
        if (result.length < limit && !endedWithZeroWidthMatch)
            result.push(budget.allocateString(value.slice(copiedThrough)));
        budget.allocateArrayLength(result.length);
        return result;
    }
    if (args[0] !== undefined && typeof args[0] !== "string")
        throw new TypeError(SPLIT_STRING_MESSAGE);
    const limit = asNumberOrUndefined(args[1]);
    const result = splitString(value, args[0], limit).map((part) => budget.allocateString(part));
    budget.allocateArrayLength(result.length);
    return result;
}
function callMatchLikeMethod(value, methodName, args) {
    const regex = args[0];
    if (!isSandboxRegex(regex))
        throw new TypeError(`String#${methodName} requires a regex argument.`);
    if (methodName === "search") {
        const lastIndex = regex.lastIndex;
        regex.lastIndex = 0;
        const match = executeRegex(regex, value);
        regex.lastIndex = lastIndex;
        return match?.index ?? -1;
    }
    if (methodName === "matchAll" && !regex.flags.includes("g"))
        throw new TypeError("String#matchAll requires a global regex.");
    if (methodName === "match" && !regex.flags.includes("g"))
        return toMatchArray(executeRegex(regex, value), value);
    const matches = collectRegexMatches(regex, value, true);
    return methodName === "match"
        ? matches.map((match) => match.text)
        : matches.map((match) => toMatchArray(match, value));
}
function collectRegexMatches(regex, value, all) {
    const matches = [];
    const pattern = getSandboxRegexPattern(regex);
    let startIndex = 0;
    do {
        const match = matchRegexFrom(pattern, value, startIndex);
        if (match === null)
            break;
        matches.push(match);
        startIndex = match.index + Math.max(match.text.length, 1);
    } while (all);
    return matches;
}
function splitString(value, separator, limit) {
    const split = String.prototype.split;
    return split.call(value, separator, limit);
}
function asNumber(value) {
    return Number(value);
}
function asNumberOrUndefined(value) {
    return value === undefined ? undefined : Number(value);
}
function asStringOrUndefined(value) {
    return value === undefined ? undefined : String(value);
}
