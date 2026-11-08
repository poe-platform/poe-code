import { UsageError, integer, value, type ParsedOptions } from "safe-bash-io-engine/internal";
import { defaultSortLimits, type SortLimits } from "./records.js";

export interface SortCommandsOptions {
  readonly limits?: Partial<SortLimits>;
  readonly replace?: boolean;
}

function bufferSize(text: string): number {
  const suffix = text.at(-1)!;
  const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[suffix.toUpperCase()];
  return scale === undefined ? integer(text, 1) : integer(text.slice(0, -1), 1) * scale;
}

export function resolveSortLimits(supplied: Partial<SortLimits> = {}, parsed?: ParsedOptions): SortLimits {
  const limits = { ...defaultSortLimits, ...supplied };
  const memory = parsed && value(parsed, "S");
  if (memory !== undefined) limits.memoryBytes = bufferSize(memory);
  for (const [option, key] of [["max-input-bytes", "maxInputBytes"], ["max-records", "maxRecords"], ["batch-size", "mergeFanIn"]] as const) {
    const selected = parsed && value(parsed, option);
    if (selected !== undefined) limits[key] = integer(selected, key === "mergeFanIn" ? 2 : 0);
  }
  if (!Number.isSafeInteger(limits.memoryBytes) || limits.memoryBytes < 1024 * 1024) throw new UsageError("sort memory budget must be at least 1048576 bytes");
  if (!Number.isSafeInteger(limits.mergeFanIn) || limits.mergeFanIn < 2 || limits.mergeFanIn > 32) throw new UsageError("sort merge fan-in must be between 2 and 32");
  for (const key of ["maxInputBytes", "maxRecords"] as const) {
    if (limits[key] !== Infinity && (!Number.isSafeInteger(limits[key]) || limits[key] < 0)) throw new UsageError(`invalid sort ${key}`);
  }
  return limits;
}
