import { Budget, CsplitError, pathText } from "./internal.js";

export interface Options {
  prefix: string;
  suffix?: string;
  digits: number;
  keep: boolean;
  elide: boolean;
  quiet: boolean;
  suppress: boolean;
  information?: "help" | "version";
  operands: string[];
}

export function integer(value: string, signed = false): bigint | undefined {
  let offset = 0;
  while (offset < value.length && " \t\n\r\v\f".includes(value[offset]!)) offset++;
  const negative = value[offset] === "-";
  if (negative && !signed) return undefined;
  if (negative || value[offset] === "+") offset++;
  const start = offset;
  let result = 0n;
  const maximum = signed ? negative ? 9_223_372_036_854_775_808n : 9_223_372_036_854_775_807n : 18_446_744_073_709_551_615n;
  for (; offset < value.length; offset++) {
    const digit = value.charCodeAt(offset) - 48;
    if (digit < 0 || digit > 9) return undefined;
    result = result * 10n + BigInt(digit);
    if (result > maximum) return undefined;
  }
  return offset === start ? undefined : negative ? -result : result;
}

export function parseOptions(args: readonly string[], budget: Budget): Options {
  const parsed: Options = { prefix: "xx", digits: 2, keep: false, elide: false, quiet: false, suppress: false, operands: [] };
  const long: Readonly<Record<string, string>> = {
    prefix: "f", "suffix-format": "b", "keep-files": "k", "elide-empty-files": "z",
    digits: "n", quiet: "q", silent: "s", "suppress-matched": "suppress", help: "help", version: "version",
  };
  let ended = false;
  const apply = (key: string, value?: string): void => {
    if (key === "f") parsed.prefix = value!;
    else if (key === "b") parsed.suffix = value!;
    else if (key === "k") parsed.keep = true;
    else if (key === "z") parsed.elide = true;
    else if (key === "q" || key === "s") parsed.quiet = true;
    else if (key === "suppress") parsed.suppress = true;
    else if (key === "n") {
      const count = integer(value!, true);
      if (count === undefined || count < 0n || count > 2_147_483_647n) throw new CsplitError(`invalid number: ${budget.quote(value!)}`);
      budget.check(Number(count), budget.limits.maxPathBytes, "suffix width");
      parsed.digits = Number(count);
    } else parsed.information = key as "help" | "version";
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    budget.charge();
    if (ended || argument === "-" || !argument.startsWith("-")) {
      parsed.operands.push(argument);
      if (Object.hasOwn(budget.context.env, "POSIXLY_CORRECT")) ended = true;
    } else if (argument === "--") ended = true;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const candidates = Object.keys(long).filter(key => key.startsWith(name));
      if (!Object.hasOwn(long, name) && candidates.length > 1) throw new CsplitError(`option ${budget.quote(argument)} is ambiguous; possibilities: ${candidates.map(key => budget.quote(`--${key}`)).join(" ")}`, true);
      const selected = Object.hasOwn(long, name) ? name : candidates[0];
      if (!selected) throw new CsplitError(`unrecognized option ${budget.quote(argument)}`, true);
      const key = long[selected]!;
      let value: string | undefined;
      if ("fbn".includes(key) && key.length === 1) {
        value = equals < 0 ? args[++index] : argument.slice(equals + 1);
        if (value === undefined) throw new CsplitError(`option '--${selected}' requires an argument`, true);
      } else if (equals >= 0) throw new CsplitError(`option '--${selected}' doesn't allow an argument`, true);
      apply(key, value);
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const key = argument[offset]!;
        if (!"fbknsqz".includes(key)) throw new CsplitError(`invalid option -- ${budget.quote(key)}`, true);
        let value: string | undefined;
        if ("fbn".includes(key)) {
          value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) throw new CsplitError(`option requires an argument -- ${budget.quote(key)}`, true);
          offset = argument.length;
        }
        apply(key, value);
      }
    }
    if (parsed.information) return parsed;
  }
  if (parsed.operands.length < 2) throw new CsplitError(parsed.operands.length ? `missing operand after ${budget.quote(args.at(-1)!)}` : "missing operand", true);
  budget.check(parsed.prefix.length, budget.limits.maxPathBytes, "prefix bytes");
  pathText(parsed.prefix);
  return parsed;
}

export function suffixFormatter(options: Options, budget: Budget): (index: number) => string {
  if (options.suffix === undefined) return index => String(index).padStart(options.digits, "0");
  const format = options.suffix;
  let before = "", after = "";
  let conversion: { width: number; precision?: number; flags: string; type: string } | undefined;
  for (let offset = 0; offset < format.length; offset++) {
    const character = format[offset]!;
    if (character !== "%" || format[offset + 1] === "%") {
      if (character === "%") offset++;
      if (conversion) after += character; else before += character;
      continue;
    }
    if (conversion) throw new CsplitError("too many % conversion specifications in suffix");
    let flags = "";
    offset++;
    while (offset < format.length && "-0'#".includes(format[offset]!)) flags += format[offset++]!;
    let width = 0;
    while (offset < format.length && format[offset]! >= "0" && format[offset]! <= "9") {
      width = width * 10 + Number(format[offset++]);
      budget.check(width, budget.limits.maxPathBytes, "suffix width");
    }
    let precision: number | undefined;
    if (format[offset] === ".") {
      precision = 0; offset++;
      while (offset < format.length && format[offset]! >= "0" && format[offset]! <= "9") {
        precision = precision * 10 + Number(format[offset++]);
        budget.check(precision, budget.limits.maxPathBytes, "suffix precision");
      }
    }
    const type = format[offset];
    if (type === undefined) throw new CsplitError("missing conversion specifier in suffix");
    if (!"diuoxX".includes(type)) throw new CsplitError(`invalid conversion specifier in suffix: ${type >= " " && type <= "~" ? type : `\\${type.charCodeAt(0).toString(8).padStart(3, "0")}`}`);
    const invalid = "diu".includes(type) ? flags.includes("#") ? "#" : "" : flags.includes("'") ? "'" : "";
    if (invalid) throw new CsplitError(`invalid flags in conversion specification: %${invalid}${type}`);
    conversion = { width, flags, type, ...(precision === undefined ? {} : { precision }) };
  }
  if (!conversion) throw new CsplitError("missing % conversion specification in suffix");
  const { width, precision, flags, type } = conversion;
  budget.check(options.prefix.length + before.length + after.length + Math.max(width, precision ?? 0, 10) + 2, budget.limits.maxPathBytes, "output filename bytes");
  return index => {
    let number = index === 0 && precision === 0 ? "" : index.toString(type === "o" ? 8 : type === "x" || type === "X" ? 16 : 10);
    if (type === "X") number = number.toUpperCase();
    number = number.padStart(precision ?? 0, "0");
    let prefix = "";
    if (flags.includes("#")) {
      if (type === "o" && !number.startsWith("0")) prefix = "0";
      else if ((type === "x" || type === "X") && index !== 0) prefix = type === "X" ? "0X" : "0x";
    }
    if (flags.includes("0") && !flags.includes("-") && precision === undefined) number = number.padStart(Math.max(0, width - prefix.length), "0");
    let rendered = prefix + number;
    rendered = flags.includes("-") ? rendered.padEnd(width) : rendered.padStart(width);
    return before + rendered + after;
  };
}
