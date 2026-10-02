import { utf8ByteLength } from "safe-bash-byte-engine";
import { yieldTurn } from "safe-bash-contracts/yield";
import { getCommandArguments, shellValueByteLength, type CommandArguments, type CommandContext } from "safe-bash-contracts";
import type { RegexExecutionOptions } from "safe-bash-regex-engine/execution/protocol";
import type { BoundedRegexProvider } from "safe-bash-regex-engine/execution/provider";
import { exprMatchCeilings } from "safe-bash-regex-engine/execution/protocol";

export interface ExprLimits {
  readonly maxArgumentBytes: number;
  readonly maxNumericDigits: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxSteps: number;
  readonly maxStringBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRegexPatternBytes: number;
  readonly maxRegexNodes: number;
  readonly maxRegexDepth: number;
  readonly maxRegexStates: number;
  readonly maxRegexAllocatedUnits: number;
}

export interface ExprCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<ExprLimits>;
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
}

export class ExprError extends Error {
  constructor(message: string, readonly exitCode: 2 | 3 = 2) { super(message); }
}

export function settings(options: ExprCommandsOptions): ExprLimits {
  const limits = {
    maxArgumentBytes: Infinity, maxNumericDigits: Infinity, maxNodes: Infinity,
    maxDepth: Infinity, maxSteps: Infinity, maxStringBytes: Infinity,
    maxOutputBytes: Infinity, maxRegexPatternBytes: Infinity, maxRegexNodes: Infinity,
    maxRegexDepth: Infinity, maxRegexStates: Infinity, maxRegexAllocatedUnits: Infinity, ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError(`Invalid expr limit: ${name}`);
  }
  return Object.freeze(limits);
}

export class Budget {
  private steps = 0;
  private checkpoint = 0;
  private readonly argv: CommandArguments;
  constructor(readonly context: CommandContext, readonly limits: ExprLimits) {
    this.argv = getCommandArguments(context);
  }
  remaining(): number { return this.limits.maxSteps - this.steps; }
  check(size: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(size) || size > maximum) throw new ExprError(`${label} limit exceeded`, 3);
  }
  charge(size = 1): void {
    this.context.signal.throwIfAborted();
    this.steps += size;
    this.check(this.steps, this.limits.maxSteps, "evaluation work");
  }
  async yield(): Promise<void> {
    this.charge();
    if (this.steps - this.checkpoint >= 4096) {
      this.checkpoint = this.steps;
      await yieldTurn();
      this.context.signal.throwIfAborted();
    }
  }
  allocation(size: number): void {
    this.check(size, this.limits.maxStringBytes, "string allocation");
    this.charge(size);
  }
  arguments(): void {
    this.check(this.context.args.length, this.limits.maxNodes * 4, "argument count");
    let total = 0;
    for (let index = 0; index < this.context.args.length; index++) {
      const argument = this.context.args[index]!;
      this.charge();
      this.check(argument.length, this.limits.maxArgumentBytes - total, "aggregate argument bytes");
      total += shellValueByteLength(this.argv.values[index]!);
      this.check(total, this.limits.maxArgumentBytes, "aggregate argument bytes");
      this.charge(argument.length);
      if (argument.includes("\0")) throw new ExprError("NUL is not supported in argv");
      for (let offset = 0; offset < argument.length; offset++) {
        const unit = argument.charCodeAt(offset);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = argument.charCodeAt(++offset);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new ExprError("argv must contain well-formed Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new ExprError("argv must contain well-formed Unicode");
      }
    }
  }
  argument(index: number): Uint8Array {
    const value = this.argv.values[index]!;
    if (typeof value === "string") return this.encode(value);
    this.allocation(shellValueByteLength(value));
    return this.argv.bytes(index)!;
  }
  encode(text: string): Uint8Array {
    this.allocation(utf8ByteLength(text));
    return new TextEncoder().encode(text);
  }
}

function effectiveLocale(context: CommandContext, category: "LC_CTYPE" | "LC_COLLATE"): string {
  return context.env.LC_ALL || context.env[category] || context.env.LANG || "C";
}

function baselineLocale(locale: string): boolean {
  return locale === "C" || locale === "POSIX" || locale === "C.UTF-8" || locale === "C.utf8";
}

function utf8LocaleName(locale: string): string | undefined {
  const separator = locale.lastIndexOf(".");
  const encoding = locale.slice(separator + 1).toLowerCase();
  if (encoding !== "utf-8" && encoding !== "utf8") return undefined;
  const name = locale.slice(0, separator);
  if (separator === -1 || name === "C") return "";
  try {
    return Intl.getCanonicalLocales(name.replaceAll("_", "-"))[0];
  } catch { return undefined; }
}

export function utf8Profile(context: CommandContext): boolean {
  const locale = effectiveLocale(context, "LC_CTYPE");
  if (locale === "C" || locale === "POSIX") return false;
  if (utf8LocaleName(locale) !== undefined) return true;
  throw new ExprError("character operations require C/POSIX or a UTF-8 locale");
}

export function stringCollator(context: CommandContext): Intl.Collator | undefined {
  const locale = effectiveLocale(context, "LC_COLLATE");
  if (baselineLocale(locale)) return undefined;
  const name = utf8LocaleName(locale);
  if (name === "") return undefined;
  if (name !== undefined && Intl.Collator.supportedLocalesOf([name]).length) {
    return new Intl.Collator(name, { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  }
  throw new ExprError("string comparison requires C/POSIX or a supported UTF-8 collation locale");
}

export function screenMatch(subject: Uint8Array, pattern: Uint8Array, budget: Budget): void {
  budget.context.signal.throwIfAborted();
  if (pattern.length > budget.limits.maxRegexPatternBytes
    || subject.length > Math.min(budget.limits.maxStringBytes, exprMatchCeilings.maxSubjectBytes)) {
    throw new ExprError("regex input bytes limit exceeded", 3);
  }
  if (baselineLocale(effectiveLocale(budget.context, "LC_CTYPE"))
    && baselineLocale(effectiveLocale(budget.context, "LC_COLLATE"))) return;
  budget.charge(pattern.length);
  for (let offset = 0; offset < pattern.length; offset++) {
    if (pattern[offset] === 92) offset++;
    else if (pattern[offset] === 91) {
      for (const category of ["LC_CTYPE", "LC_COLLATE"] as const) {
        const locale = effectiveLocale(budget.context, category);
        if (!baselineLocale(locale) && utf8LocaleName(locale) === undefined) {
          throw new ExprError("unsupported BRE: bracket expressions require C/POSIX or UTF-8 LC_CTYPE and LC_COLLATE");
        }
      }
      return;
    }
  }
}

export function nextCharacter(bytes: Uint8Array, offset: number, unicode: boolean): number {
  const first = bytes[offset]!;
  if (!unicode || first < 0xc2 || first > 0xf4) return offset + 1;
  const width = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
  if (offset + width > bytes.length) return offset + 1;
  for (let index = 1; index < width; index++) {
    const byte = bytes[offset + index]!;
    if (byte < 0x80 || byte > 0xbf) return offset + 1;
  }
  const second = bytes[offset + 1]!;
  if (first === 0xe0 && second < 0xa0 || first === 0xed && second >= 0xa0
    || first === 0xf0 && second < 0x90 || first === 0xf4 && second >= 0x90) return offset + 1;
  return offset + width;
}
