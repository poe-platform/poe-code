export const defaults = Object.freeze({
    requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2,
    maxQueuedRequests: 64, maxQueuedBytes: 128 * 1024 * 1024,
    idleTimeoutMs: 100, workerOldGenerationMb: 128, workerStackMb: 4,
});
export class RegexExecutionError extends Error {
    code;
    constructor(code, message) {
        super(code === "MATCH" ? message : `regex ${code}: ${message}`);
        this.code = code;
        this.name = "RegexExecutionError";
    }
}
export const exprMatchCeilings = Object.freeze({
    maxPatternBytes: 65_536, maxSubjectBytes: 1_048_576, maxNodes: 8192,
    maxDepth: 128, maxSteps: 50_000_000, maxStates: 65_536, maxAllocatedUnits: 4_000_000,
});
export class ExprMatchError extends Error {
    category;
    constructor(category, message) {
        super(message);
        this.category = category;
    }
}
function exactObject(value, keys) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validateExprInput(descriptor, rows, signal) {
    signal.throwIfAborted();
    const invalid = () => { throw new RegexExecutionError("PROTOCOL", "invalid expr request"); };
    if (!exactObject(descriptor, ["kind", "pattern", "profile", "limits"]) || descriptor.kind !== "expr-match"
        || !(descriptor.pattern instanceof Uint8Array) || !["byte", "utf8-scalar"].includes(descriptor.profile))
        invalid();
    const keys = Object.keys(exprMatchCeilings);
    if (!exactObject(descriptor.limits, keys))
        invalid();
    for (const key of keys) {
        if (!Number.isSafeInteger(descriptor.limits[key]) || descriptor.limits[key] < 1 || descriptor.limits[key] > exprMatchCeilings[key])
            invalid();
    }
    if (!Array.isArray(rows) || rows.length !== 1)
        invalid();
    const row = rows[0];
    if (!exactObject(row, ["bytes", "all", "terminated"]) || !(row.bytes instanceof Uint8Array) || row.all !== false || row.terminated !== false)
        invalid();
    if (descriptor.pattern.length > descriptor.limits.maxPatternBytes || row.bytes.length > descriptor.limits.maxSubjectBytes) {
        throw new ExprMatchError("limit", "regex input bytes limit exceeded");
    }
}
export function validateExprRequest(value) {
    if (!exactObject(value, ["id", "descriptor", "rows"]) || !Number.isSafeInteger(value.id) || value.id < 1) {
        throw new RegexExecutionError("PROTOCOL", "invalid expr request identity");
    }
    validateExprInput(value.descriptor, value.rows, new AbortController().signal);
}
export function validateExprReply(value, id, descriptor, subject, signal) {
    signal.throwIfAborted();
    const invalid = () => { throw new RegexExecutionError("PROTOCOL", "invalid expr reply"); };
    if (!value || typeof value !== "object")
        return invalid();
    const reply = value;
    if (reply.id !== id || reply.operation !== "expr-match")
        return invalid();
    if ("error" in reply) {
        if (!exactObject(reply, ["id", "operation", "error", "category"]) || typeof reply.error !== "string"
            || reply.error.length > 512 || !["syntax", "unsupported", "limit"].includes(reply.category))
            return invalid();
        throw new ExprMatchError(reply.category, reply.error);
    }
    if (!exactObject(reply, ["id", "operation", "result"]))
        return invalid();
    const result = reply.result;
    if (!exactObject(result, ["offsetUnit", "matched", "hasCapture", "overall", "capture", "steps"])
        || result.offsetUnit !== "byte" || typeof result.matched !== "boolean" || typeof result.hasCapture !== "boolean"
        || !Number.isSafeInteger(result.steps) || result.steps < 1 || result.steps > descriptor.limits.maxSteps)
        return invalid();
    const span = (value) => {
        if (value === null)
            return null;
        if (!exactObject(value, ["start", "end"]) || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end))
            return invalid();
        const start = value.start, end = value.end;
        if (start < 0 || end < start || end > subject.length)
            return invalid();
        if (descriptor.profile === "utf8-scalar") {
            for (const offset of [start, end])
                if (offset < subject.length && subject[offset] >= 0x80 && subject[offset] <= 0xbf)
                    return invalid();
        }
        return { start, end };
    };
    const overall = span(result.overall), capture = span(result.capture);
    if (result.matched !== (overall !== null) || overall && overall.start !== 0
        || capture && (!result.hasCapture || !overall || capture.start < overall.start || capture.end > overall.end))
        return invalid();
    return { offsetUnit: "byte", matched: result.matched, hasCapture: result.hasCapture, overall, capture, steps: result.steps };
}
export function policy(options) {
    const result = { ...defaults, ...options };
    for (const key of Object.keys(defaults)) {
        const minimum = key === "maxQueuedRequests" || key === "maxQueuedBytes" ? 0 : 1;
        if (!Number.isSafeInteger(result[key]) || result[key] < minimum)
            throw new RangeError(`regex ${key} must be a safe integer >= ${minimum}`);
    }
    for (const key of ["requestTimeoutMs", "startupTimeoutMs", "idleTimeoutMs"]) {
        if (result[key] > 2147483647)
            throw new RangeError(`regex ${key} exceeds the Node timer range`);
    }
    return Object.freeze(result);
}
export function inputBytes(descriptor, rows, signal) {
    let total = 128 + (descriptor.kind === "glob" ? descriptor.globOptions.length * 32 : 0);
    for (const pattern of descriptor.patterns) {
        signal.throwIfAborted();
        total += 16 + pattern.length * 2;
        if (!Number.isSafeInteger(total))
            throw new RegexExecutionError("QUEUE_EXHAUSTED", "input accounting overflow");
    }
    for (const row of rows) {
        signal.throwIfAborted();
        total += 32 + row.bytes.byteLength;
        if (!Number.isSafeInteger(total))
            throw new RegexExecutionError("QUEUE_EXHAUSTED", "input accounting overflow");
    }
    return total;
}
export function validateReply(value, id, rows, signal) {
    signal.throwIfAborted();
    const reply = value;
    if (!reply || typeof reply !== "object" || reply.id !== id)
        throw new RegexExecutionError("PROTOCOL", "invalid reply identity");
    if ("error" in reply) {
        if (typeof reply.error !== "string")
            throw new RegexExecutionError("PROTOCOL", "invalid error reply");
        throw new RegexExecutionError("MATCH", reply.error);
    }
    if (!("results" in reply) || !Array.isArray(reply.results) || reply.results.length !== rows.length)
        throw new RegexExecutionError("PROTOCOL", "invalid reply rows");
    return reply.results.map((ranges, index) => {
        signal.throwIfAborted();
        if (!(ranges instanceof Float64Array) || ranges.length % 2)
            throw new RegexExecutionError("PROTOCOL", "invalid match ranges");
        const result = [];
        const row = rows[index];
        if (!row.all && ranges.length > 2)
            throw new RegexExecutionError("PROTOCOL", "unexpected multiple matches");
        for (let offset = 0; offset < ranges.length; offset += 2) {
            signal.throwIfAborted();
            const start = ranges[offset];
            const end = ranges[offset + 1];
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > row.bytes.length || start < (result.at(-1)?.start ?? 0))
                throw new RegexExecutionError("PROTOCOL", "invalid match bounds");
            result.push({ start, end });
        }
        return result;
    });
}
//# sourceMappingURL=protocol.js.map