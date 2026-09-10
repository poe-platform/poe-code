import { Budget, HexdumpError } from "./internal.js";

const usage = "usage: hexdump [-bcCdovx] [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n       hd      [-bcdovx]  [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]";

export interface Parsed {
  readonly files: readonly string[];
  readonly canonical: number;
  readonly verbose: boolean;
  readonly skip: number;
  readonly count: number;
}

function number(text: string, skip: boolean): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  let base = 10;
  if (skip && text[offset] === "0") {
    base = 8;
    if ((text[offset + 1] === "x" || text[offset + 1] === "X") && "0123456789abcdef".includes((text[offset + 2] ?? "!").toLowerCase())) { base = 16; offset += 2; }
  }
  let value = 0;
  for (; offset < text.length; offset++) {
    const digit = "0123456789abcdef".indexOf(text[offset]!.toLowerCase());
    if (digit < 0 || digit >= base) break;
    value = value * base + digit;
    if (!Number.isSafeInteger(value)) throw new HexdumpError(`${text}: numeric value exceeds safe integer range`);
  }
  if (negative && value !== 0) throw new HexdumpError(`${text}: bad ${skip ? "skip" : "length"} value`);
  if (skip) value *= ({ b: 512, k: 1024, m: 1_048_576 } as Record<string, number>)[text[offset] ?? ""] ?? 1;
  if (!Number.isSafeInteger(value)) throw new HexdumpError(`${text}: numeric value exceeds safe integer range`);
  return value;
}

export function parse(budget: Budget, name: string): Parsed {
  const args = budget.arguments();
  const files: string[] = [];
  let canonical = name === "hd" ? 1 : 0;
  let verbose = false, ended = false, skip = 0, count = Infinity;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (ended || argument === "-" || !argument.startsWith("-")) {
      files.push(argument);
      if (budget.context.env.POSIXLY_CORRECT !== undefined) ended = true;
      continue;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      budget.charge();
      const flag = argument[offset]!;
      if (flag === "v") verbose = true;
      else if (flag === "C") {
        if (name === "hd") throw new HexdumpError(usage, true);
        budget.check(++canonical, budget.limits.maxFormats, "format count");
      } else if (flag === "n" || flag === "s") {
        const parameter = argument.slice(offset + 1) || args[++index];
        if (parameter === undefined) throw new HexdumpError(`${name}: option requires an argument -- '${flag}'\n${usage}`, true);
        if (flag === "n") count = number(parameter, false);
        else skip = number(parameter, true);
        break;
      } else if (flag === "e" || flag === "f") throw new HexdumpError(`-${flag}: custom formats are not supported`);
      else throw new HexdumpError(`unsupported option -- '${flag}'`);
    }
  }
  return { files, canonical, verbose, skip, count };
}
