export function settings(options) {
    const limits = {
        maxArguments: 4096, maxArgumentBytes: 65536, maxEntries: 100000,
        maxDirectoryEntries: 10000, maxDepth: 256, maxPathBytes: 16384,
        maxMetadataBytes: 8 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024,
        maxSteps: 4 * 1024 * 1024, ...options.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1)
            throw new RangeError(`Invalid du limit: ${name}`);
    }
    return Object.freeze(limits);
}
//# sourceMappingURL=options.js.map