import { exprMatchCeilings } from "../regex-execution/protocol.js";
export class ExprError extends Error {
    exitCode;
    constructor(message, exitCode = 2) {
        super(message);
        this.exitCode = exitCode;
    }
}
export function settings(options) {
    const limits = {
        maxArgumentBytes: 65_536, maxNumericDigits: 1024, maxNodes: 4096,
        maxDepth: 128, maxSteps: 8_000_000, maxStringBytes: 65_536,
        maxOutputBytes: 65_537, maxRegexPatternBytes: 8192, maxRegexNodes: 4096,
        maxRegexDepth: 64, maxRegexStates: 16_384, maxRegexAllocatedUnits: 1_000_000, ...options.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid expr limit: ${name}`);
    }
    if (limits.maxDepth > 256)
        throw new RangeError("expr maxDepth must not exceed 256");
    for (const [key, maximum] of [
        ["maxRegexPatternBytes", exprMatchCeilings.maxPatternBytes], ["maxRegexNodes", exprMatchCeilings.maxNodes],
        ["maxRegexDepth", exprMatchCeilings.maxDepth], ["maxRegexStates", exprMatchCeilings.maxStates],
        ["maxRegexAllocatedUnits", exprMatchCeilings.maxAllocatedUnits],
    ])
        if (limits[key] > maximum)
            throw new RangeError(`expr ${key} exceeds worker ceiling ${maximum}`);
    return Object.freeze(limits);
}
export class Budget {
    context;
    limits;
    steps = 0;
    checkpoint = 0;
    constructor(context, limits) {
        this.context = context;
        this.limits = limits;
    }
    remaining() { return this.limits.maxSteps - this.steps; }
    check(size, maximum, label) {
        if (!Number.isSafeInteger(size) || size > maximum)
            throw new ExprError(`${label} limit exceeded`, 3);
    }
    charge(size = 1) {
        this.context.signal.throwIfAborted();
        this.steps += size;
        this.check(this.steps, this.limits.maxSteps, "evaluation work");
    }
    async yield() {
        this.charge();
        if (this.steps - this.checkpoint >= 4096) {
            this.checkpoint = this.steps;
            await new Promise(resolve => setImmediate(resolve));
            this.context.signal.throwIfAborted();
        }
    }
    allocation(size) {
        this.check(size, this.limits.maxStringBytes, "string allocation");
        this.charge(size);
    }
    arguments() {
        this.check(this.context.args.length, this.limits.maxNodes * 4, "argument count");
        let total = 0;
        for (const argument of this.context.args) {
            this.charge();
            this.check(argument.length, this.limits.maxArgumentBytes - total, "aggregate argument bytes");
            total += Buffer.byteLength(argument);
            this.check(total, this.limits.maxArgumentBytes, "aggregate argument bytes");
            this.charge(argument.length);
            if (argument.includes("\0"))
                throw new ExprError("NUL is not supported in argv");
            for (let offset = 0; offset < argument.length; offset++) {
                const unit = argument.charCodeAt(offset);
                if (unit >= 0xd800 && unit <= 0xdbff) {
                    const next = argument.charCodeAt(++offset);
                    if (!(next >= 0xdc00 && next <= 0xdfff))
                        throw new ExprError("argv must contain well-formed Unicode");
                }
                else if (unit >= 0xdc00 && unit <= 0xdfff)
                    throw new ExprError("argv must contain well-formed Unicode");
            }
        }
    }
    encode(text) {
        this.allocation(Buffer.byteLength(text));
        return new TextEncoder().encode(text);
    }
}
function effectiveLocale(context, category) {
    return context.env.LC_ALL || context.env[category] || context.env.LANG || "C";
}
function baselineLocale(locale) {
    return locale === "C" || locale === "POSIX" || locale === "C.UTF-8" || locale === "C.utf8";
}
export function utf8Profile(context) {
    const locale = effectiveLocale(context, "LC_CTYPE");
    if (locale === "C" || locale === "POSIX")
        return false;
    if (locale === "C.UTF-8" || locale === "C.utf8" || locale === "en_US.UTF-8")
        return true;
    throw new ExprError("character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding");
}
export function requireByteCollation(context) {
    if (!baselineLocale(effectiveLocale(context, "LC_COLLATE"))) {
        throw new ExprError("string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation");
    }
}
export function screenMatch(subject, pattern, budget) {
    budget.context.signal.throwIfAborted();
    if (pattern.length > budget.limits.maxRegexPatternBytes
        || subject.length > Math.min(budget.limits.maxStringBytes, exprMatchCeilings.maxSubjectBytes)) {
        throw new ExprError("regex input bytes limit exceeded", 3);
    }
    if (baselineLocale(effectiveLocale(budget.context, "LC_CTYPE"))
        && baselineLocale(effectiveLocale(budget.context, "LC_COLLATE")))
        return;
    budget.charge(pattern.length);
    for (let offset = 0; offset < pattern.length; offset++) {
        if (pattern[offset] === 92)
            offset++;
        else if (pattern[offset] === 91) {
            throw new ExprError("unsupported BRE: bracket expressions require C/POSIX or C.UTF-8/C.utf8 LC_CTYPE and LC_COLLATE");
        }
    }
}
export function nextCharacter(bytes, offset, unicode) {
    const first = bytes[offset];
    if (!unicode || first < 0xc2 || first > 0xf4)
        return offset + 1;
    const width = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    if (offset + width > bytes.length)
        return offset + 1;
    for (let index = 1; index < width; index++) {
        const byte = bytes[offset + index];
        if (byte < 0x80 || byte > 0xbf)
            return offset + 1;
    }
    const second = bytes[offset + 1];
    if (first === 0xe0 && second < 0xa0 || first === 0xed && second >= 0xa0
        || first === 0xf0 && second < 0x90 || first === 0xf4 && second >= 0x90)
        return offset + 1;
    return offset + width;
}
//# sourceMappingURL=internal.js.map