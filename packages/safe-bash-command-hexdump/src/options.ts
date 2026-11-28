import { parseCustom, type CustomFormat } from "./custom.js";
import { Budget, HexdumpError, type HexdumpCommandsOptions } from "./internal.js";

const usage = "usage: hexdump [-bcCdovx] [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]\n       hd      [-bcdovx]  [-e fmt] [-f fmt_file] [-n length]\n               [-s skip] [file ...]";

export type Format = "default" | "C" | "b" | "c" | "d" | "o" | "x" | "X";

const longOptions: Readonly<Record<string, string>> = {
  "--one-byte-octal": "b", "--one-byte-char": "c", "--canonical": "C",
  "--two-bytes-decimal": "d", "--two-bytes-octal": "o", "--two-bytes-hex": "x",
  "--one-byte-hex": "X", "--no-squeezing": "v",
  "--length": "n", "--skip": "s", "--format": "e", "--format-file": "f",
};

export interface Parsed {
  readonly ordered: readonly (Format | CustomFormat)[];
  readonly custom: readonly CustomFormat[];
  readonly files: readonly string[];
  readonly formats: readonly Format[];
  readonly verbose: boolean;
  readonly skip: number;
  readonly count: number;
  readonly dialect: HexdumpCommandsOptions["dialect"];
}

function number(text: string, skip: boolean, dialect: HexdumpCommandsOptions["dialect"]): number {
  let offset = 0;
  while (offset < text.length && " \t\n\r\v\f".includes(text[offset]!)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  let base = 10;
  if ((skip || dialect === "util-linux") && text[offset] === "0") {
    base = 8;
    if ((text[offset + 1] === "x" || text[offset + 1] === "X") && "0123456789abcdef".includes((text[offset + 2] ?? "!").toLowerCase())) { base = 16; offset += 2; }
  }
  let value = 0;
  const start = offset;
  for (; offset < text.length; offset++) {
    const digit = "0123456789abcdef".indexOf(text[offset]!.toLowerCase());
    if (digit < 0 || digit >= base) break;
    value = value * base + digit;
    if (!Number.isSafeInteger(value)) throw new HexdumpError(`${text}: numeric value exceeds safe integer range`);
  }
  if (negative && value !== 0) throw new HexdumpError(`${text}: bad ${skip ? "skip" : "length"} value`);
  if (dialect === "util-linux") {
    const suffix = text.slice(offset);
    let multiplier = suffix === "b" ? 512 : 1;
    if (suffix !== "" && suffix !== "b") {
      const power = "KMGTPEZY".indexOf(suffix[0] === "k" ? "K" : suffix[0]!) + 1;
      const tail = suffix.slice(1);
      if (!power || (tail !== "" && tail !== "B" && tail !== "iB")) throw new HexdumpError(`${text}: bad ${skip ? "skip" : "length"} value`);
      multiplier = (tail === "B" ? 1000 : 1024) ** power;
    }
    if (offset === start || negative) throw new HexdumpError(`${text}: bad ${skip ? "skip" : "length"} value`);
    value *= multiplier;
  } else if (skip) value *= ({ b: 512, k: 1024, m: 1_048_576 } as Record<string, number>)[text[offset] ?? ""] ?? 1;
  if (!Number.isSafeInteger(value)) throw new HexdumpError(`${text}: numeric value exceeds safe integer range`);
  return value;
}

export function parse(budget: Budget, name: string, dialect: HexdumpCommandsOptions["dialect"]): Parsed {
  const args = budget.arguments();
  const files: string[] = [];
  const custom: CustomFormat[] = [];
  const formats: Format[] = name === "hd" ? ["C"] : [];
  const ordered: (Format | CustomFormat)[] = [...formats];
  let verbose = false, ended = false, skip = 0, count = Infinity;
  for (let index = 0; index < args.length; index++) {
    let argument = args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (ended || argument === "-" || !argument.startsWith("-")) {
      files.push(argument);
      if (budget.context.env.POSIXLY_CORRECT !== undefined) ended = true;
      continue;
    }
    let longParameter: string | undefined;
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const option = equals < 0 ? argument : argument.slice(0, equals);
      const flag = Object.hasOwn(longOptions, option) ? longOptions[option] : undefined;
      if (!flag) throw new HexdumpError(`unrecognized option '${option}'`);
      if (equals >= 0) {
        if (!"nsef".includes(flag)) throw new HexdumpError(`option '${option}' does not allow an argument`);
        longParameter = argument.slice(equals + 1);
        if (longParameter === "" && (flag === "n" || flag === "s")) throw new HexdumpError(`option '${option}' requires a number`);
      }
      argument = "-" + flag;
    }
    for (let offset = 1; offset < argument.length; offset++) {
      budget.charge();
      const flag = argument[offset]!;
      if (flag === "v") verbose = true;
      else if (flag === "C" || flag === "b" || flag === "c" || flag === "d" || flag === "o" || flag === "x" || flag === "X") {
        if (name === "hd" && flag === "C") throw new HexdumpError(usage, true);
        budget.check(custom.length + formats.length + 1, budget.limits.maxFormats, "format count");
        formats.push(flag);
        ordered.push(flag);
      } else if (flag === "n" || flag === "s") {
        const parameter = longParameter ?? (argument.slice(offset + 1) || args[++index]);
        if (parameter === undefined) throw new HexdumpError(`${name}: option requires an argument -- '${flag}'\n${usage}`, true);
        if (flag === "n") count = number(parameter, false, dialect);
        else skip = number(parameter, true, dialect);
        break;
      } else if (flag === "e") {
        const parameter = longParameter ?? (argument.slice(offset + 1) || args[++index]);
        if (parameter === undefined) throw new HexdumpError("-e requires a format");
        budget.check(custom.length + formats.length + 1, budget.limits.maxFormats, "format count");
        const format = parseCustom(parameter, budget);
        custom.push(format);
        ordered.push(format);
        break;
      } else if (flag === "f") throw new HexdumpError("-f: format files are not supported");
      else throw new HexdumpError(`unsupported option -- '${flag}'`);
    }
  }
  if (ordered.length === 0) ordered.push("default");
  return { ordered, custom, files, formats: formats.length || custom.length ? formats : ["default"], verbose, skip, count, dialect };
}
