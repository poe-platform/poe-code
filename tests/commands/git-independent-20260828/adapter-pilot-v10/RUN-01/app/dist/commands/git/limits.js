export const GIT_LIMITS = Object.freeze({
    maxArgumentBytes: 65536, maxPathBytes: 4096, maxReadBytes: 67108864,
    maxInflatedBytes: 134217728, maxObjectBytes: 8388608, maxWorkingFileBytes: 8388608,
    maxIndexBytes: 16777216, maxMetadataBytes: 1048576, maxResidentBytes: 67108864,
    maxEntries: 20000, maxObjects: 32768, maxCommits: 2000, maxDepth: 128,
    maxRefDepth: 16, maxDeltaDepth: 32, maxSteps: 32000000, maxDiffCells: 1000000,
    maxLines: 200000, maxOutputBytes: 16777216, maxDiagnosticBytes: 65536,
    maxChunkBytes: 65536, maxChunks: 32768, maxPacks: 8, maxPackBytes: 33554432,
});
export class GitFailure extends Error {
    status;
    constructor(message, status = 128) {
        super(message);
        this.status = status;
    }
}
export class ConsumerClosed extends Error {
}
export function demand(condition, message) {
    if (!condition)
        throw new GitFailure(message);
}
export function settings(options) {
    if (!options || typeof options !== "object")
        throw new TypeError("Invalid Git options");
    let replace = false;
    let discoveryBoundary = "/";
    for (const key of Reflect.ownKeys(options)) {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (!("value" in descriptor))
            throw new TypeError("Git options require own data properties");
        if (key === "replace" && typeof descriptor.value === "boolean")
            replace = descriptor.value;
        else if (key === "discoveryBoundary" && typeof descriptor.value === "string")
            discoveryBoundary = descriptor.value;
        else
            throw new TypeError(`Invalid Git option: ${String(key)}`);
    }
    if (!discoveryBoundary.startsWith("/") || discoveryBoundary.includes("\0") || Buffer.byteLength(discoveryBoundary) > GIT_LIMITS.maxPathBytes)
        throw new TypeError("Invalid Git discoveryBoundary");
    return { replace, discoveryBoundary };
}
//# sourceMappingURL=limits.js.map