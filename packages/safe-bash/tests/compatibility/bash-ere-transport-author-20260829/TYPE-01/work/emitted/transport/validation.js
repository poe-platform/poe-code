import { types as utilTypes } from "node:util";
import { EreProfileLimitError, EreUnsupportedError } from "../errors.js";
import { deriveEreLimits } from "../limits.js";
import { add, integer, multiply, TransportAccounting } from "./accounting.js";
import { EreTransportError, EreTransportProfileLimitError, operation, profile, resources } from "./protocol.js";
function fail() { throw new EreTransportError("PROTOCOL", "invalid ERE transport frame"); }
export function record(value, keys, visit) {
    visit(1 + keys.length);
    if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value))
        return fail();
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length)
        return fail();
    for (let index = 0; index < keys.length; index++) {
        if (actual[index] !== keys[index])
            return fail();
        const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]);
        if (!descriptor || !Object.hasOwn(descriptor, "value"))
            return fail();
    }
    return value;
}
function array(value, maximum, visit, overLimit = fail) {
    visit(1);
    if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || !Array.isArray(value))
        return fail();
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !Object.hasOwn(length, "value"))
        return fail();
    integer(length.value);
    if (length.value > maximum)
        return overLimit();
    visit(length.value);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length.value + 1 || keys[keys.length - 1] !== "length")
        return fail();
    for (let index = 0; index < length.value; index++) {
        if (keys[index] !== String(index))
            return fail();
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value"))
            return fail();
    }
    return value;
}
function ascii(value, cap, visit) {
    if (typeof value !== "string" || value.length > cap)
        return fail();
    for (let offset = 0; offset < value.length; offset++) {
        visit(1);
        if (value.charCodeAt(offset) === 0 || value.charCodeAt(offset) > 127)
            return fail();
    }
    return value;
}
export function usage(value, allowance, visit) {
    const fields = record(value, resources, visit);
    for (const key of resources) {
        integer(fields[key]);
        if (fields[key] > allowance[key])
            return fail();
    }
    return fields;
}
export function inspectInput(value, limits, transport, signal) {
    const visit = (amount) => { if (signal?.aborted)
        throw signal.reason; transport.visit(amount); };
    const input = record(value, ["pattern", "subject"], visit);
    if (typeof input.subject !== "string")
        return fail();
    if (input.subject.length > limits.subjectBytes)
        throw new EreProfileLimitError("subjectBytes", limits.subjectBytes);
    const maximum = Math.max(0, Math.floor((Math.floor(transport.available / 2) - 47 - input.subject.length) / 4));
    const fragments = array(input.pattern, maximum, visit, () => { throw new EreTransportProfileLimitError("transportStorage", transport.storageLimit); });
    let bytes = 0;
    for (const item of fragments) {
        const fragment = record(item, ["text", "literal"], visit);
        if (typeof fragment.text !== "string" || typeof fragment.literal !== "boolean")
            return fail();
        if (fragment.text.length > limits.patternBytes - bytes)
            throw new EreProfileLimitError("patternBytes", limits.patternBytes);
        for (let offset = 0; offset < fragment.text.length; offset++) {
            visit(1);
            if (fragment.text.charCodeAt(offset) === 0 || fragment.text.charCodeAt(offset) > 127)
                throw new EreUnsupportedError("transport requires non-NUL ASCII", bytes + offset);
        }
        bytes += fragment.text.length;
    }
    for (let offset = 0; offset < input.subject.length; offset++) {
        visit(1);
        if (input.subject.charCodeAt(offset) === 0 || input.subject.charCodeAt(offset) > 127)
            throw new EreUnsupportedError("transport requires non-NUL ASCII subject", offset);
    }
    const units = add(add(47, multiply(fragments.length, 4)), add(bytes, input.subject.length));
    if (multiply(units, 2) > transport.available)
        throw new EreTransportProfileLimitError("transportStorage", transport.storageLimit);
    return { input: value, patternBytes: bytes, units };
}
export function copyInput(inspected, transport) {
    transport.visit(inspected.units);
    const pattern = inspected.input.pattern.map(fragment => Object.freeze({ text: fragment.text, literal: fragment.literal }));
    return Object.freeze({ pattern: Object.freeze(pattern), subject: inspected.input.subject });
}
export function validateRequest(value) {
    let work = 0;
    const visit = (amount) => { work = add(work, amount); if (work > 50_000_000)
        fail(); };
    const frame = record(value, ["version", "operation", "id", "grantId", "profile", "bounds", "allowance", "pattern", "subject"], visit);
    if (frame.version !== 1 || frame.operation !== operation || frame.profile !== profile)
        return fail();
    integer(frame.id);
    integer(frame.grantId);
    if (frame.id === 0 || frame.grantId === 0)
        return fail();
    const bounds = record(frame.bounds, ["maxExpansionBytes", "maxExpansionFields"], visit);
    integer(bounds.maxExpansionBytes);
    integer(bounds.maxExpansionFields);
    const limits = deriveEreLimits({ maxExpansionBytes: bounds.maxExpansionBytes, maxExpansionFields: bounds.maxExpansionFields });
    usage(frame.allowance, limits, visit);
    const fragments = array(frame.pattern, Math.floor(limits.allocationUnits / 8), visit);
    let bytes = 0;
    for (const item of fragments) {
        const fragment = record(item, ["text", "literal"], visit);
        const text = ascii(fragment.text, limits.patternBytes - bytes, visit);
        if (typeof fragment.literal !== "boolean")
            return fail();
        bytes += text.length;
    }
    const subject = ascii(frame.subject, limits.subjectBytes, visit);
    if (multiply(add(add(47, multiply(fragments.length, 4)), add(bytes, subject.length)), 2) > limits.allocationUnits)
        return fail();
    return value;
}
export function validateReply(value, request, visit) {
    if (value === null || typeof value !== "object" || utilTypes.isProxy(value))
        return fail();
    const kind = Object.getOwnPropertyDescriptor(value, "kind");
    if (!kind || !Object.hasOwn(kind, "value"))
        return fail();
    const keys = kind.value === "result" ? ["version", "operation", "id", "grantId", "kind", "result", "usage"] : ["version", "operation", "id", "grantId", "kind", "category", "resource", "offset", "usage"];
    const frame = record(value, keys, visit);
    if (frame.version !== 1 || frame.operation !== operation || frame.id !== request.id || frame.grantId !== request.grantId)
        return fail();
    const spent = usage(frame.usage, request.allowance, visit);
    visit(operation.length);
    if (frame.kind === "failure") {
        if (frame.category !== "syntax" && frame.category !== "unsupported" && frame.category !== "profile-limit")
            return fail();
        if (frame.category === "profile-limit") {
            if (!resources.includes(frame.resource) || frame.offset !== null)
                return fail();
        }
        else {
            if (frame.resource !== null)
                return fail();
            if (frame.offset !== null) {
                integer(frame.offset);
                if (frame.offset > request.allowance.patternBytes)
                    return fail();
            }
        }
        const units = 34 + frame.category.length + (typeof frame.resource === "string" ? frame.resource.length : 0);
        visit(7 + frame.category.length + (typeof frame.resource === "string" ? frame.resource.length : 0));
        return { reply: value, replyUnits: units, resultUnits: 0 };
    }
    if (frame.kind !== "result")
        return fail();
    const result = record(frame.result, ["matched", "groupCount", "spans", "steps", "allocatedUnits"], visit);
    if (typeof result.matched !== "boolean")
        return fail();
    integer(result.groupCount);
    integer(result.steps);
    integer(result.allocatedUnits);
    if (result.groupCount > 32 || result.steps !== spent.work || result.allocatedUnits !== spent.allocationUnits)
        return fail();
    const spans = array(result.spans, 33, visit);
    if (spans.length !== result.groupCount + 1)
        return fail();
    let participating = 0;
    let captureBytes = 0;
    let overall = null;
    for (let index = 0; index < spans.length; index++) {
        const item = spans[index];
        if (item === null) {
            if (index === 0 && result.matched)
                return fail();
            continue;
        }
        if (!result.matched)
            return fail();
        const span = record(item, ["start", "end"], visit);
        integer(span.start);
        integer(span.end);
        if (span.start > span.end || span.end > request.subject.length)
            return fail();
        if (index === 0)
            overall = span;
        else if (!overall || span.start < overall.start || span.end > overall.end)
            return fail();
        captureBytes = add(captureBytes, span.end - span.start);
        participating++;
    }
    if (result.matched ? spent.captureSlots !== spans.length || spent.captureBytes !== captureBytes : spent.captureSlots !== 0 || spent.captureBytes !== 0)
        return fail();
    const resultUnits = 7 + spans.length + 3 * participating;
    visit(6);
    return { reply: value, replyUnits: 31 + resultUnits, resultUnits };
}
export function copyReplyResult(reply) {
    const value = reply.result;
    return Object.freeze({ matched: value.matched, groupCount: value.groupCount, spans: Object.freeze(value.spans.map(span => span === null ? null : Object.freeze({ start: span.start, end: span.end }))), steps: value.steps, allocatedUnits: value.allocatedUnits });
}
