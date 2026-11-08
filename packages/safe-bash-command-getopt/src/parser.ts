import { Budget, GetoptError } from "./internal.js";
import type { Writer } from "./io.js";

export interface LongOption { readonly name: string; readonly argument: 0 | 1 | 2; readonly code?: string; }
export type ParsedOption =
  | { readonly kind: "short"; readonly option: string; readonly argument: string | undefined }
  | { readonly kind: "long"; readonly option: LongOption; readonly argument: string | undefined }
  | { readonly kind: "operand"; readonly argument: string | undefined }
  | { readonly kind: "error" };

export async function findShort(specification: string, option: string, start: number, budget: Budget): Promise<number> {
  for (let offset = start; offset < specification.length; offset++) {
    await budget.step();
    if (specification[offset] === option) return offset;
  }
  return -1;
}

export async function addLongOptions(value: string, options: LongOption[], budget: Budget): Promise<void> {
  budget.schema(value.length);
  let start = 0;
  for (let offset = 0; offset <= value.length; offset++) {
    await budget.step();
    const code = value.charCodeAt(offset);
    if (offset !== value.length && code !== 44 && code !== 32 && code !== 9 && code !== 10) continue;
    if (offset > start) {
      let end = offset;
      let argument: 0 | 1 | 2 = 0;
      if (value[end - 1] === ":") { argument = 1; end--; if (end > start && value[end - 1] === ":") { argument = 2; end--; } }
      if (end === start) throw new GetoptError("empty long option after -l or --long argument", 2, true);
      budget.check(options.length + 1, budget.limits.maxLongOptions, "long option count");
      budget.retain((end - start) * 2 + 64);
      options.push({ name: value.slice(start, end), argument });
    }
    start = offset + 1;
  }
}

export class Parser {
  index = 0;
  private offset = 0;
  private ended = false;
  readonly operands: string[] = [];
  private readonly start: number;
  private readonly order: "require" | "return" | "permute";
  private readonly silent: boolean;
  constructor(readonly args: readonly string[], readonly specification: string, readonly options: readonly LongOption[],
    readonly alternative: boolean, posix: boolean, quiet: boolean, readonly name: string, readonly budget: Budget,
    readonly writer: Writer) {
    this.start = specification[0] === "+" || specification[0] === "-" ? 1 : 0;
    this.order = specification[0] === "-" ? "return" : specification[0] === "+" || posix ? "require" : "permute";
    this.silent = quiet || specification[this.start] === ":";
  }
  private async error(parts: readonly string[]): Promise<ParsedOption> {
    if (!this.silent) await this.writer.send([this.name, ...parts], true);
    return { kind: "error" };
  }
  private async long(value: string, prefix: string, fallback: boolean): Promise<ParsedOption | null> {
    let end = 0;
    while (end < value.length && value[end] !== "=") { await this.budget.step(); end++; }
    const lease = this.options.length * 64 + 128;
    this.budget.retain(lease);
    try {
      const matches: LongOption[] = [];
      let exact: LongOption | undefined;
      for (const option of this.options) {
        await this.budget.step();
        let matched = option.name.length >= end;
        for (let offset = 0; matched && offset < end; offset++) {
          await this.budget.step();
          if (option.name[offset] !== value[offset]) matched = false;
        }
        if (!matched) continue;
        if (option.name.length === end) { exact = option; break; }
        matches.push(option);
      }
      if (!exact && matches.length > 1) {
        this.index++; this.offset = 0;
        if (!this.silent) {
          const parts = [this.name, ": option '", prefix, value, "' is ambiguous; possibilities:"];
          for (const option of matches) parts.push(" '", prefix, option.name, "'");
          parts.push("\n");
          await this.writer.send(parts, true);
        }
        return { kind: "error" };
      }
      const option = exact ?? matches[0];
      if (!option) {
        if (fallback && await findShort(this.specification, value[0] ?? "", this.start, this.budget) >= 0) return null;
        this.index++; this.offset = 0;
        return await this.error([": unrecognized option '", prefix, value, "'\n"]);
      }
      this.index++; this.offset = 0;
      let argument: string | undefined;
      if (end < value.length) {
        if (!option.argument) return await this.error([": option '", prefix, option.name, "' doesn't allow an argument\n"]);
        argument = value.slice(end + 1);
      } else if (option.argument === 1) {
        if (this.index === this.args.length) return await this.error([": option '", prefix, option.name, "' requires an argument\n"]);
        argument = this.args[this.index++];
      }
      return { kind: "long", option, argument };
    } finally { this.budget.retain(-lease); }
  }
  async next(): Promise<ParsedOption | undefined> {
    await this.budget.step();
    if (this.ended) return undefined;
    if (!this.offset) {
      while (this.index < this.args.length) {
        await this.budget.step();
        const argument = this.args[this.index]!;
        if (argument === "--") { this.index++; this.ended = true; return undefined; }
        if (argument.length > 1 && argument[0] === "-") break;
        if (this.order === "require") { this.ended = true; return undefined; }
        this.index++;
        if (this.order === "return") return { kind: "operand", argument };
        this.budget.retain(8);
        this.operands.push(argument);
      }
      if (this.index === this.args.length) { this.ended = true; return undefined; }
      const argument = this.args[this.index]!;
      if (argument[1] === "-") return (await this.long(argument.slice(2), "--", false))!;
      if (this.alternative && (argument.length > 2 || await findShort(this.specification, argument[1]!, this.start, this.budget) < 0)) {
        const result = await this.long(argument.slice(1), "-", true);
        if (result) return result;
      }
      this.offset = 1;
    }
    const current = this.args[this.index]!;
    const option = current[this.offset++]!;
    if (this.offset === current.length) { this.offset = 0; this.index++; }
    const found = await findShort(this.specification, option, this.start, this.budget);
    if (found < 0 || option === ":" || option === ";") return this.error([": invalid option -- '", option, "'\n"]);
    if (option === "W" && this.specification[found + 1] === ";") {
      if (!this.offset && this.index === this.args.length) return this.error([": option requires an argument -- 'W'\n"]);
      const value = this.offset ? current.slice(this.offset) : this.args[this.index]!;
      return (await this.long(value, "-W ", false))!;
    }
    let argument: string | undefined;
    if (this.specification[found + 1] === ":") {
      if (this.offset) { argument = current.slice(this.offset); this.index++; }
      else if (this.specification[found + 2] !== ":") {
        if (this.index === this.args.length) return this.error([": option requires an argument -- '", option, "'\n"]);
        argument = this.args[this.index++];
      }
      this.offset = 0;
    }
    if (option === "?") return { kind: "error" };
    if (option === "\x01") return { kind: "operand", argument };
    if (option === "\xff") {
      this.budget.retain(-this.operands.length * 8);
      this.operands.length = 0;
      this.ended = true;
      return undefined;
    }
    return { kind: "short", option, argument };
  }
}
