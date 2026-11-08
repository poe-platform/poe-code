import type { CommandContext } from "safe-bash-contracts/command";
import { Budget } from "safe-bash-regex-engine/text/budget";
import type { AdapterContext } from "safe-bash-markdown-engine";
import { MdqError } from "./options.js";
const defaultLimits = Object.freeze({ inputBytes: Infinity, outputBytes: Infinity, retainedBytes: Infinity, nodes: Infinity, references: Infinity, tableCells: Infinity, text: Infinity, entities: Infinity, entityBytes: Infinity, depth: Infinity, work: Infinity, arguments: Infinity, argumentBytes: Infinity, files: Infinity, emptyChunks: Infinity });
export type MdqLimits = typeof defaultLimits;
export type LimitOptions = { readonly [K in keyof MdqLimits]?: number };
export function admitLimits(options: LimitOptions = {}): { [K in keyof MdqLimits]: number } {
  const result = { ...defaultLimits, ...options };
  for (const [key, n] of Object.entries(result)) if (!Object.hasOwn(defaultLimits, key) || (n !== Infinity && (!Number.isSafeInteger(n) || n < 0))) throw new RangeError(`Invalid mdq limit: ${key}`);
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
