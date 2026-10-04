import type { MediaResourceLimits } from "@poe-code/mp4-ast";

/** Normalize registration limits without evaluating the media engines. */
export function resolveFfprobeLimits(options: MediaResourceLimits | undefined) {
  const limits = { maxInputBytes: 32 * 1024 * 1024, maxOutputBytes: 1024 * 1024, ...options };
  for (const value of [limits.maxInputBytes, limits.maxOutputBytes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError("Invalid ffprobe limit");
  }
  return limits;
}
