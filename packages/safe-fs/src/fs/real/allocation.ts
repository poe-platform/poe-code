export function nativeAllocatedBytes(blocks: unknown, platform: string): number | undefined {
  if (platform !== "darwin" && platform !== "linux") return undefined;
  if (typeof blocks !== "number" || !Number.isSafeInteger(blocks) || blocks < 0) return undefined;
  const bytes = blocks * 512;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}
