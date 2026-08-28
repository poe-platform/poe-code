const DEFAULT_LIMITS = Object.freeze({
    maxArguments: 4096,
    maxArgumentBytes: 65536,
    maxPathEnvBytes: 65536,
    maxPathComponents: 4096,
    maxPathBytes: 16384,
    maxProbes: 65536,
    maxOutputBytes: 8388608,
});
export function settings(options) {
    for (const key of Reflect.ownKeys(options.limits ?? {})) {
        if (!Object.hasOwn(DEFAULT_LIMITS, key))
            throw new RangeError(`Unknown which limit: ${String(key)}`);
    }
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1
            || (key === "maxPathBytes" && value > Number.MAX_SAFE_INTEGER - 256)) {
            throw new RangeError(`Invalid which limit: ${key}`);
        }
    }
    return Object.freeze(limits);
}
//# sourceMappingURL=options.js.map