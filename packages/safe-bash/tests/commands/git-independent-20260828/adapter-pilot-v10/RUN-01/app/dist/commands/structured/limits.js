import { setImmediate } from "node:timers/promises";
import { Decimal, isNumber, numberText } from "./numbers.js";
export const defaultJqLimits = Object.freeze({
    maxInputBytes: 64 * 1024 * 1024, maxValueBytes: 8 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024, maxSourceBytes: 64 * 1024,
    maxDepth: 128, maxAstDepth: 64, maxSteps: 1_000_000,
    maxResults: 100_000, maxCollectionSize: 100_000,
});
export class JqError extends Error {
    exitCode;
    constructor(message, exitCode = 5) {
        super(message);
        this.exitCode = exitCode;
    }
}
export class JqLimitError extends JqError {
    constructor(name) { super(`${name} limit exceeded`); }
}
export function resolveJqLimits(options = {}) {
    const limits = { ...defaultJqLimits, ...options };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`${name} must be a positive safe integer`);
    }
    if (limits.maxDepth > 256 || limits.maxAstDepth > 128)
        throw new RangeError("maxDepth must be <=256 and maxAstDepth <=128");
    return Object.freeze(limits);
}
export class Budget {
    limits;
    signal;
    steps = 0;
    nextYield = 1024;
    inputBytes = 0;
    outputBytes = 0;
    results = 0;
    inputLocation = { name: "<unknown>", line: 0, complete: true };
    constructor(limits, signal) {
        this.limits = limits;
        this.signal = signal;
    }
    step(count = 1) {
        this.signal.throwIfAborted();
        this.steps += count;
        if (this.steps > this.limits.maxSteps)
            throw new JqLimitError("maxSteps");
    }
    async tick() {
        this.step();
        if (this.steps >= this.nextYield) {
            this.nextYield = this.steps + 1024;
            await setImmediate(undefined, { signal: this.signal });
            this.signal.throwIfAborted();
        }
    }
    collection(size) {
        if (size > this.limits.maxCollectionSize)
            throw new JqLimitError("maxCollectionSize");
    }
    text(text) {
        if (text.length > this.limits.maxValueBytes || Buffer.byteLength(text) > this.limits.maxValueBytes)
            throw new JqLimitError("maxValueBytes");
    }
    value(value) {
        let bytes = 0;
        const visit = (current, depth) => {
            this.step();
            if (depth > this.limits.maxDepth)
                throw new JqLimitError("maxDepth");
            if (current !== null && typeof current === "object" && !(current instanceof Decimal)) {
                if (depth + 1 > this.limits.maxDepth)
                    throw new JqLimitError("maxDepth");
                const keys = Array.isArray(current) ? Object.keys(current) : objectKeys(current);
                this.collection(keys.length);
                bytes += 2 + Math.max(0, keys.length - 1);
                for (const key of keys) {
                    if (!Array.isArray(current)) {
                        this.text(key);
                        bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
                    }
                    if (bytes > this.limits.maxValueBytes)
                        throw new JqLimitError("maxValueBytes");
                    visit(current[key], depth + 1);
                }
            }
            else {
                if (typeof current === "string")
                    this.text(current);
                bytes += Buffer.byteLength(scalarJson(current, this));
            }
            if (bytes > this.limits.maxValueBytes)
                throw new JqLimitError("maxValueBytes");
        };
        visit(value, 0);
        return bytes;
    }
}
const keyOrders = new WeakMap();
export function object() {
    const result = Object.create(null);
    keyOrders.set(result, []);
    return result;
}
export function objectKeys(value) { return keyOrders.get(value)?.slice() ?? Object.keys(value); }
export function objectSize(value) { return keyOrders.get(value)?.length ?? Object.keys(value).length; }
export function put(value, key, item) {
    if (!Object.hasOwn(value, key))
        keyOrders.get(value)?.push(key);
    value[key] = item;
}
export function remove(value, key) {
    delete value[key];
    const keys = keyOrders.get(value);
    if (keys) {
        const index = keys.indexOf(key);
        if (index >= 0)
            keys.splice(index, 1);
    }
}
export function copyObject(...sources) {
    const result = object();
    for (const source of sources)
        if (source)
            for (const key of objectKeys(source))
                put(result, key, source[key]);
    return result;
}
export function wellFormed(text) {
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff))
                return false;
        }
        else if (code >= 0xdc00 && code <= 0xdfff)
            return false;
    }
    return true;
}
export function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Decimal); }
export function truth(value) { return value !== null && value !== false; }
export function scalarJson(value, budget) {
    if (value instanceof Decimal)
        budget.step(Math.ceil(value.text.length / 32));
    return isNumber(value) ? numberText(value) : JSON.stringify(value);
}
export async function interruptible(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
        signal.addEventListener("abort", aborted, { once: true });
        try {
            Promise.resolve(operation()).then(result => { signal.removeEventListener("abort", aborted); resolve(result); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
        }
        catch (error) {
            signal.removeEventListener("abort", aborted);
            reject(error);
        }
    });
}
//# sourceMappingURL=limits.js.map