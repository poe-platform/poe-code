import type { CommandContext } from "safe-bash-contracts/command";
import { Budget } from "safe-bash-regex-engine/text/budget";
import type { AdapterContext } from "safe-bash-markdown-engine";
import { MdqError } from "./options.js";
export const ceilings = Object.freeze({ inputBytes: 16_777_216, outputBytes: 33_554_432, retainedBytes: 268_435_456, nodes: 262_144, references: 262_144, tableCells: 262_144, text: 33_554_432, entities: 262_144, entityBytes: 8_388_608, depth: 128, work: 268_435_456, arguments: 1024, argumentBytes: 262_144, files: 128, emptyChunks: 1024 });
export type MdqLimits = typeof ceilings;
export type LimitOptions = { readonly [K in keyof MdqLimits]?: number };
export function admitLimits(options: LimitOptions = {}): { [K in keyof MdqLimits]: number } {
  const result = { ...ceilings, ...options };
  for (const [key, n] of Object.entries(result)) if (!Object.hasOwn(ceilings, key) || !Number.isSafeInteger(n) || n < 0 || n > ceilings[key as keyof MdqLimits]) throw new RangeError(`Invalid mdq limit: ${key}`);
  return result;
}
export class MdqBudget implements AdapterContext {
  readonly counts: Partial<Record<keyof MdqLimits, number>> = {};
  readonly regex: Budget;
  constructor(readonly context: CommandContext, readonly limits: ReturnType<typeof admitLimits>) {
    this.regex = new MdqRegexBudget(this);
  }
  checkpoint(units = 1): void { this.context.signal.throwIfAborted(); this.regex.step(units); }
  async cooperate(units = 1): Promise<void> { this.checkpoint(units); await this.regex.checkpoint(); }
  bound(key: keyof MdqLimits, actual: number): void {
    this.context.signal.throwIfAborted();
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > this.limits[key]) throw new MdqError(`mdq: ${key} limit exceeded\n`);
  }
  charge(key: keyof MdqLimits, units: number): void {
    const total = (this.counts[key] ?? 0) + units;
    this.bound(key, total); this.counts[key] = total;
  }
  decodeEntity(code: number): string {
    this.charge("entities", 1); this.charge("entityBytes", 4); this.charge("retainedBytes", 4);
    const replacements = [8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376];
    return String.fromCodePoint(code >= 128 && code <= 159 ? replacements[code - 128]! : code);
  }
}
class MdqRegexBudget extends Budget {
  constructor(readonly owner: MdqBudget) {
    super(owner.context, { maxSteps: Math.max(1, owner.limits.work), maxBufferBytes: Math.max(1, owner.limits.retainedBytes) });
  }
  override step(units = 1): void { this.owner.charge("work", units); super.step(units); }
}
