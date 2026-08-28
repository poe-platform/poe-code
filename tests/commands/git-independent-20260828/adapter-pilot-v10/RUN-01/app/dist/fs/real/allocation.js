export function nativeAllocatedBytes(blocks, platform) {
    if (platform !== "darwin" && platform !== "linux")
        return undefined;
    if (typeof blocks !== "number" || !Number.isSafeInteger(blocks) || blocks < 0)
        return undefined;
    const bytes = blocks * 512;
    return Number.isSafeInteger(bytes) ? bytes : undefined;
}
//# sourceMappingURL=allocation.js.map