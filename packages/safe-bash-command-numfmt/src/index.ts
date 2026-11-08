import { emitPadded } from "./padding.js";
import { binary, add, multiply, divide, absolute, negate, compare, power, round, fixed, general, BINARY_10, BINARY_1000, BINARY_1024, signedMaximum, type Binary, type Rounding } from "./numeric.js";
import { blank, digit, byteText, textBytes, utf8Size, quote, NumfmtDiagnostic } from "./presentation.js";
import { decimal, fields, unit, unitPrefixes } from "./selection.js";
import { FsError, getCommandArguments, readBytes, writeBytes, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { yieldTurn } from "safe-bash-contracts/yield";
import { PublicDiagnostic, publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
const encoder = new TextEncoder();
import { RecordBuffer } from "./record-buffer.js";


const helpText = [
  "Usage: numfmt [OPTION]... [NUMBER]...",
  "Reformat NUMBER(s), or the numbers from standard input if none are specified.",
  "",
  "Mandatory arguments to long options are mandatory for short options too.",
  "      --debug          print warnings about invalid input",
  "  -d, --delimiter=X    use X instead of whitespace for field delimiter",
  "      --field=FIELDS   replace the numbers in these input fields (default=1)",
  "                         see FIELDS below",
  "      --format=FORMAT  use printf style floating-point FORMAT;",
  "                         see FORMAT below for details",
  "      --from=UNIT      auto-scale input numbers to UNITs; default is 'none';",
  "                         see UNIT below",
  "      --from-unit=N    specify the input unit size (instead of the default 1)",
  "      --grouping       use locale-defined grouping of digits, e.g. 1,000,000",
  "                         (which means it has no effect in the C/POSIX locale)",
  "      --header[=N]     print (without converting) the first N header lines;",
  "                         N defaults to 1 if not specified",
  "      --invalid=MODE   failure mode for invalid numbers: MODE can be:",
  "                         abort (default), fail, warn, ignore",
  "      --padding=N      pad the output to N characters; positive N will",
  "                         right-align; negative N will left-align;",
  "                         padding is ignored if the output is wider than N;",
  "                         the default is to automatically pad if a whitespace",
  "                         is found",
  "      --round=METHOD   use METHOD for rounding when scaling; METHOD can be:",
  "                         up, down, from-zero (default), towards-zero, nearest",
  "      --suffix=SUFFIX  add SUFFIX to output numbers, and accept optional",
  "                         SUFFIX in input numbers",
  "      --unit-separator=SEP  insert SEP between number and unit on output,",
  "                         and accept optional SEP in input numbers",
  "      --to=UNIT        auto-scale output numbers to UNITs; see UNIT below",
  "      --to-unit=N      the output unit size (instead of the default 1)",
  "  -z, --zero-terminated    line delimiter is NUL, not newline",
  "      --help     display this help and exit",
  "      --version  output version information and exit",
  "",
  "UNIT options:",
  "  none       no auto-scaling is done; suffixes will trigger an error",
  "  auto       accept optional single/two letter suffix:",
  "               1K = 1000,",
  "               1Ki = 1024,",
  "               1M = 1000000,",
  "               1Mi = 1048576,",
  "  si         accept optional single letter suffix:",
  "               1K = 1000,",
  "               1M = 1000000,",
  "               ...",
  "  iec        accept optional single letter suffix:",
  "               1K = 1024,",
  "               1M = 1048576,",
  "               ...",
  "  iec-i      accept optional two-letter suffix:",
  "               1Ki = 1024,",
  "               1Mi = 1048576,",
  "               ...",
  "",
  "FIELDS supports cut(1) style field ranges:",
  "  N    N'th field, counted from 1",
  "  N-   from N'th field, to end of line",
  "  N-M  from N'th to M'th field (inclusive)",
  "  -M   from first to M'th field (inclusive)",
  "  -    all fields",
  "Multiple fields/ranges can be separated with commas",
  "",
  "FORMAT must be suitable for printing one floating-point argument '%f'.",
  "Optional quote (%'f) will enable --grouping (if supported by current locale).",
  "Optional width value (%10f) will pad output. Optional zero (%010f) width",
  "will zero pad the number. Optional negative values (%-10f) will left align.",
  "Optional precision (%.1f) will override the input determined precision.",
  "",
  "Exit status is 0 if all input numbers were successfully converted.",
  "By default, numfmt will stop at the first conversion error with exit status 2.",
  "With --invalid='fail' a warning is printed for each conversion error",
  "and the exit status is 2.  With --invalid='warn' each conversion error is",
  "diagnosed, but the exit status is 0.  With --invalid='ignore' conversion",
  "errors are not diagnosed and the exit status is 0.",
  "",
  "Examples:",
  "  $ numfmt --to=si 1000",
  "            -> \"1.0K\"",
  "  $ numfmt --to=iec 2048",
  "           -> \"2.0K\"",
  "  $ numfmt --to=iec-i 4096",
  "           -> \"4.0Ki\"",
  "  $ echo 1K | numfmt --from=si",
  "           -> \"1000\"",
  "  $ echo 1K | numfmt --from=iec",
  "           -> \"1024\"",
  "  $ df -B1 | numfmt --header --field 2-4 --to=si",
  "  $ ls -l  | numfmt --header --field 5 --to=iec",
  "  $ ls -lh | numfmt --header --field 5 --from=iec --padding=10",
  "  $ ls -lh | numfmt --header --field 5 --from=iec --format %10f",
  "",
  "GNU coreutils online help: <https://www.gnu.org/software/coreutils/>",
  "Report numfmt translation bugs to <https://translationproject.org/team/>",
  "Full documentation at: <https://www.gnu.org/software/coreutils/numfmt>",
  "or available locally via: info '(coreutils) numfmt invocation'",
  "",
].join("\n");

const scales = ["none", "auto", "si", "iec", "iec-i"] as const;
type Scale = typeof scales[number];
type Invalid = "abort" | "fail" | "warn" | "ignore";
interface Settings {
  from: Scale;
  to: Scale;
  fromUnit: bigint;
  toUnit: bigint;
  rounding: Rounding;
  invalid: Invalid;
  padding: bigint;
  left: boolean;
  zeroPadding: bigint;
  precision: bigint | undefined;
  grouping: boolean;
  delimiter: string | undefined;
  separator: string;
  suffix: string;
  unitSeparator?: string;
  header: bigint;
  fields: [bigint, bigint][] | undefined;
  format: string | undefined;
  prefix: string;
  postfix: string;
  debug: boolean;
  developer: boolean;
  unicode: boolean;
  thousands: boolean;
  localeValid: boolean;
  operands: string[];
  information?: string;
}

function parse(context: CommandContext, limits: NumfmtLimits): Settings {
  const locale = context.env.LC_ALL || context.env.LC_MESSAGES || context.env.LANG || "C";
  const numericLocale = context.env.LC_ALL || context.env.LC_NUMERIC || context.env.LANG || "C";
  const settings: Settings = { from: "none", to: "none", fromUnit: 1n, toUnit: 1n, rounding: "from-zero", invalid: "abort", padding: 0n, left: false, zeroPadding: 0n, precision: undefined, grouping: false, delimiter: undefined, separator: "\n", suffix: "", header: 0n, fields: undefined, format: undefined, prefix: "", postfix: "", debug: false, developer: false, unicode: locale.toLowerCase().includes("utf"), thousands: numericLocale.toLowerCase().startsWith("en_us."), localeValid: ["c", "posix", "c.utf-8", "c.utf8", "en_us.utf8", "en_us.utf-8"].includes(locale.toLowerCase()), operands: [] };
  if (context.args.length > limits.maxArguments) throw new PublicDiagnostic("argument limit exceeded");
  let bytes = 0;
  for (const argument of context.args) {
    if (argument.length > limits.maxArgumentBytes - bytes) throw new PublicDiagnostic("argument limit exceeded");
    bytes += context.argumentValues === undefined ? utf8Size(argument) : argument.length;
    if (bytes > limits.maxArgumentBytes) throw new PublicDiagnostic("argument limit exceeded");
  }
  const argumentsCarrier = getCommandArguments(context);
  bytes = 0;
  for (const value of argumentsCarrier.values) { bytes += typeof value === "string" ? utf8Size(value) : shellValueByteLength(value); if (bytes > limits.maxArgumentBytes) throw new PublicDiagnostic("argument limit exceeded"); }
  const args = argumentsCarrier.values.map((value, index) => byteText(typeof value === "string" ? encoder.encode(value) : argumentsCarrier.bytes(index)!));
  const options: Readonly<Record<string, number>> = { from: 1, "from-unit": 1, to: 1, "to-unit": 1, round: 1, padding: 1, suffix: 1, "unit-separator": 1, grouping: 0, delimiter: 1, field: 1, debug: 0, "-debug": 0, header: 2, format: 1, invalid: 1, "zero-terminated": 0, help: 0, version: 0 };
  const match = (name: string, value: string, choices: readonly string[]): string => {
    const matches = choices.filter(choice => choice.startsWith(value));
    if (choices.includes(value)) return value;
    if (matches.length === 1) return matches[0]!;
    throw new NumfmtDiagnostic(`${matches.length ? "ambiguous" : "invalid"} argument ${quote(value, settings.unicode)} for ${quote(`--${name}`, settings.unicode)}`, 1, true, `Valid arguments are:\n${choices.map(choice => `  - ${quote(choice, settings.unicode)}\n`).join("")}`);
  };
  const apply = (name: string, value?: string): void => {
    if (name === "from") settings.from = match(name, value!, scales) as Scale;
    else if (name === "to") settings.to = match(name, value!, scales.filter(scale => scale !== "auto")) as Scale;
    else if (name === "round") settings.rounding = match(name, value!, ["up", "down", "from-zero", "towards-zero", "nearest"]) as Rounding;
    else if (name === "invalid") settings.invalid = match(name, value!, ["abort", "fail", "warn", "ignore"]) as Invalid;
    else if (name === "from-unit") settings.fromUnit = unit(value!, settings.unicode);
    else if (name === "to-unit") settings.toUnit = unit(value!, settings.unicode);
    else if (name === "padding" || name === "header") {
      const parsed = decimal(value ?? "1");
      if (!parsed.found || parsed.end !== (value ?? "1").length || parsed.overflow || parsed.value === 0n || (name === "header" ? parsed.value < 0n : parsed.value > signedMaximum || parsed.value < -signedMaximum - 1n)) throw new NumfmtDiagnostic(`invalid ${name} value ${quote(value!, settings.unicode)}`);
      if (name === "header") settings.header = parsed.value;
      else { settings.left = parsed.value < 0n; settings.padding = parsed.value < 0n ? -parsed.value : parsed.value; }
    } else if (name === "delimiter") {
      if (value!.length > 1) throw new NumfmtDiagnostic("the delimiter must be a single character");
      settings.delimiter = value || "\0";
    } else if (name === "field") {
      if (settings.fields) throw new NumfmtDiagnostic("multiple field specifications");
      settings.fields = fields(value!, settings.unicode, limits.maxFieldRanges);
    } else if (name === "suffix") settings.suffix = value!;
    else if (name === "unit-separator") settings.unitSeparator = value!;
    else if (name === "format") settings.format = value!;
    else if (name === "grouping") settings.grouping = true;
    else if (name === "debug" || name === "-debug") { settings.debug = true; if (name === "-debug") settings.developer = true; }
    else if (name === "zero-terminated") settings.separator = "\0";
    else settings.information = name;
  };
  let stopped = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || argument === "-" || !argument.startsWith("-")) { settings.operands.push(argument); if (context.env.POSIXLY_CORRECT !== undefined) stopped = true; }
    else if (argument === "--") stopped = true;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(options).filter(option => option.startsWith(name));
      const selected = Object.hasOwn(options, name) ? name : matches.length === 1 ? matches[0] : undefined;
      if (!selected) throw new NumfmtDiagnostic(matches.length > 1 ? `option '${argument}' is ambiguous; possibilities: ${matches.map(option => `'--${option}'`).join(" ")}` : `unrecognized option '${argument}'`, 1, true);
      if (!options[selected] && equals >= 0) throw new NumfmtDiagnostic(`option '--${selected}' doesn't allow an argument`, 1, true);
      const value = equals >= 0 ? argument.slice(equals + 1) : options[selected] === 1 ? args[++index] : undefined;
      if (options[selected] === 1 && value === undefined) throw new NumfmtDiagnostic(`option '--${selected}' requires an argument`, 1, true);
      apply(selected, value);
    } else for (let offset = 1; offset < argument.length; offset++) {
      const option = argument[offset]!;
      if (option === "z") apply("zero-terminated");
      else if (option === "d") {
        const value = offset + 1 < argument.length ? argument.slice(offset + 1) : args[++index];
        if (value === undefined) throw new NumfmtDiagnostic("option requires an argument -- 'd'", 1, true);
        apply("delimiter", value);
        break;
      } else throw new NumfmtDiagnostic(`invalid option -- '${option}'`, 1, true);
    }
    if (settings.information) break;
  }
  return settings;
}

class Converter {
  invalid = false;
  private autoPadding = false;
  private work = 0;
  private signalAborted: boolean;
  private readonly pollSignal: boolean;
  constructor(readonly settings: Settings, private limits: NumfmtLimits, private context: CommandContext, private output: { readonly remaining: number; emit(text: string, error?: boolean): void | Promise<void> }) {
    this.signalAborted = context.signal.aborted;
    this.pollSignal = Object.prototype.hasOwnProperty.call(context.signal, "aborted");
    if (!this.signalAborted && !this.pollSignal) {
      context.signal.addEventListener("abort", () => { this.signalAborted = true; }, { once: true });
    }
  }

  canTickSync(maxTicks: number): boolean {
    if (this.pollSignal ? this.context.signal.aborted : this.signalAborted) return false;
    if (this.work + maxTicks > this.limits.maxWork) return false;
    if ((this.work % 1024) + maxTicks < 1024) return true;
    return false;
  }

  tick(amount = 1): void | Promise<void> {
    this.work += amount;
    if (this.work > this.limits.maxWork) throw new PublicDiagnostic("numfmt work limit exceeded");
    if (this.work % 1024 < amount) {
      return yieldTurn(this.context.signal);
    }
    if (this.pollSignal ? this.context.signal.aborted : this.signalAborted) this.context.signal.throwIfAborted();
  }

  async warning(message: string): Promise<void> { await this.output.emit(`numfmt: ${message}\n`, true); }

  async failure(message: string): Promise<false> {
    this.invalid = true;
    if (this.settings.invalid === "abort") throw new NumfmtDiagnostic(message, 2);
    if (this.settings.invalid !== "ignore") await this.warning(message);
    return false;
  }

  async initialize(): Promise<void> {
    const settings = this.settings;
    if (settings.format !== undefined && settings.grouping) throw new NumfmtDiagnostic("--grouping cannot be combined with --format");
    if (settings.debug && !settings.localeValid) await this.warning("failed to set locale");
    if (settings.debug && settings.from === "none" && settings.to === "none" && !settings.grouping && !settings.padding && settings.format === undefined) await this.warning("no conversion option specified");
    if (settings.format !== undefined) await this.parseFormat(settings.format);
    if (settings.debug && settings.unitSeparator !== undefined && settings.delimiter === undefined) await this.warning("field delimiters have higher precedence than unit separators");
    if (settings.grouping) {
      if (settings.to !== "none") throw new NumfmtDiagnostic("grouping cannot be combined with --to");
      if (settings.debug && !settings.thousands) await this.warning("grouping has no effect in this locale");
    }
    this.autoPadding = !settings.padding && settings.delimiter === undefined;
    if (settings.debug && settings.header && settings.operands.length) await this.warning("--header ignored with command-line input");
  }

  private async parseFormat(text: string): Promise<void> {
    const settings = this.settings;
    const quoted = quote(text, settings.unicode);
    let offset = 0;
    let prefix = 0;
    while (!(text[offset] === "%" && text[offset + 1] !== "%")) {
      if (text[offset] === undefined) throw new NumfmtDiagnostic(`format ${quoted} has no % directive`);
      offset += text[offset] === "%" ? 2 : 1;
      prefix++;
    }
    offset++;
    let zero = false;
    while (true) {
      if (text[offset] === " ") offset++;
      else if (text[offset] === "'") { settings.grouping = true; offset++; }
      else if (text[offset] === "0") { zero = true; offset++; }
      else break;
    }
    const width = decimal(text, offset);
    if (width.overflow || width.value > signedMaximum || width.value < -signedMaximum - 1n) throw new NumfmtDiagnostic(`invalid format ${quoted} (width overflow)`);
    if (width.found && width.value !== 0n) {
      if (settings.debug && settings.padding && !(zero && width.value > 0n)) await this.warning("--format padding overriding --padding");
      if (width.value < 0n) { settings.padding = -width.value; settings.left = true; }
      else if (zero) settings.zeroPadding = width.value;
      else { settings.padding = width.value; settings.left = false; }
    }
    offset = width.end;
    if (text[offset] === undefined) throw new NumfmtDiagnostic(`format ${quoted} ends in %`);
    if (text[offset] === ".") {
      offset++;
      const precision = decimal(text, offset);
      if (precision.overflow || precision.value > signedMaximum || precision.value < 0n || blank(text[offset]) || text[offset] === "+") throw new NumfmtDiagnostic(`invalid precision in format ${quoted}`);
      settings.precision = precision.value;
      offset = precision.end;
    }
    if (text[offset] !== "f") throw new NumfmtDiagnostic(`invalid format ${quoted}, directive must be %[0]['][-][N][.][N]f`);
    const suffix = ++offset;
    while (offset < text.length) {
      if (text[offset] === "%" && text[offset + 1] !== "%") throw new NumfmtDiagnostic(`format ${quoted} has too many % directives`);
      offset += text[offset] === "%" ? 2 : 1;
    }
    settings.prefix = text.slice(0, prefix);
    settings.postfix = text.slice(suffix);
    if (settings.developer) await this.output.emit(`format String:\n  input: ${quoted}\n  grouping: ${settings.grouping ? "yes" : "no"}\n  padding width: ${settings.padding}\n  alignment: ${settings.left ? "Left" : "Right"}\n  prefix: ${quote(settings.prefix, settings.unicode)}\n  suffix: ${quote(settings.postfix, settings.unicode)}\n`, true);
  }

  private async number(text: string, backing: Uint8Array, start: number): Promise<{ value: Binary; precision: number } | false> {
    const settings = this.settings;
    let cachedQuoted: string | undefined;
    const getQuoted = (): string => cachedQuoted ??= quote(text, settings.unicode);
    if (settings.developer) await this.output.emit(`simple_strtod_human:\n  input string: ${getQuoted()}\n  locale decimal-point: ${quote(".", settings.unicode)}\n  MAX_UNSCALED_DIGITS: 18\n`, true);
    let offset = 0;
    let loss = false;
    let error = "";
    const integral = async (): Promise<{ value: Binary; negative: boolean }> => {
      const negative = text[offset] === "-";
      if (negative) offset++;
      const start = offset;
      let exactAcc = 0n;
      let value: Binary | undefined;
      let digits = 0;
      while (digit(text[offset])) {
        const d = text.charCodeAt(offset) - 48;
        if (exactAcc !== 0n || value !== undefined || d !== 0) digits++;
        if (digits > 18) loss = true;
        if (digits > 33) { error = "overflow"; break; }
        if (digits <= 18) {
          exactAcc = exactAcc * 10n + BigInt(d);
        } else {
          value ??= binary(exactAcc);
          value = add(multiply(value, binary(10n)), binary(BigInt(d)));
        }
        offset++;
        const t = this.tick();
        if (t) await t;
      }
      const finalValue = value ?? binary(exactAcc);
      if (offset === start && text[offset] !== ".") error = "number";
      return { value: negative ? negate(finalValue) : finalValue, negative };
    };
    const main = await integral();
    let value = main.value;
    let precision = 0;
    if (!error && text[offset] === ".") {
      const start = ++offset;
      const fraction = await integral();
      precision = offset - start;
      if (fraction.negative) error = "number";
      if (!error) {
        const part = divide(fraction.value, power(10, precision));
        value = add(value, main.negative ? negate(part) : part);
      }
    }
    if (error) return this.failure(error === "overflow" ? `value too large to be converted: ${getQuoted()}` : `invalid number: ${getQuoted()}`);
    if (settings.developer) await this.output.emit(`  parsed numeric value: ${fixed(value, 6)}\n  input precision = ${precision}\n`, true);
    let exponent = 0;
    let base = settings.from === "iec" || settings.from === "iec-i" ? 1024 : 1000;
    if (offset < text.length) {
      if (settings.unitSeparator !== undefined && text.startsWith(settings.unitSeparator, offset)) offset += settings.unitSeparator.length;
      else while (blank(text[offset])) offset++;
      if (offset < text.length || settings.unitSeparator === undefined) {
        const suffix = text[offset] === "k" ? "K" : text[offset];
        if (suffix !== undefined && !unitPrefixes.includes(suffix)) return this.failure(`invalid suffix in input: ${getQuoted()}`);
        if (settings.from === "none") return this.failure(`rejecting suffix in input: ${getQuoted()} (consider using --from)`);
        exponent = suffix === undefined ? 0 : unitPrefixes.indexOf(suffix) + 1;
        offset++;
        if (settings.from === "auto" && backing[start + offset] === 105) {
          base = 1024; offset++;
          if (settings.developer) await this.output.emit("  Auto-scaling, found 'i', switching to base 1024\n", true);
        }
        precision = 0;
      }
    }
    if (settings.from === "iec-i") {
      if (backing[start + offset] !== 105) return this.failure(`missing 'i' suffix in input: ${getQuoted()} (e.g Ki/Mi/Gi)`);
      offset++;
    }
    const multiplier = power(base, exponent);
    value = multiply(value, multiplier);
    if (settings.developer) await this.output.emit(`  suffix power=${base}^${exponent} = ${fixed(multiplier, 6)}\n  returning value: ${fixed(value, 6)} (${general(value, true)})\n`, true);
    let tail = text.slice(offset);
    if (offset > text.length && backing[start + offset]) {
      if (settings.invalid === "ignore") return this.failure("");
      const tailStart = start + offset;
      let tailEnd = tailStart;
      while (tailEnd < backing.length && backing[tailEnd]) {
        tailEnd++;
        if ((tailEnd - tailStart) % 4096 === 0) { const t = this.tick(4096); if (t) await t; }
      }
      { const t = this.tick((tailEnd - tailStart) % 4096); if (t) await t; }
      tail = byteText(backing.subarray(tailStart, tailEnd));
    }
    if (tail) return this.failure(`invalid suffix in input ${getQuoted()}: ${quote(tail, settings.unicode)}`);
    if (loss && settings.debug) await this.warning(`large input value ${getQuoted()}: possible precision loss`);
    if (settings.fromUnit !== 1n || settings.toUnit !== 1n) value = divide(multiply(value, binary(settings.fromUnit)), binary(settings.toUnit));
    return { value, precision };
  }

  private async human(value: Binary, inputPrecision: number): Promise<string | false> {
    const settings = this.settings;
    const precision = settings.precision ?? BigInt(inputPrecision);
    let decimalPower = 0;
    let reduced = absolute(value);
    while (compare(reduced, BINARY_10) >= 0) { reduced = divide(reduced, BINARY_10); decimalPower++; }
    if (settings.to === "none" && BigInt(decimalPower) + precision > 18n) return this.failure(precision ? `value/precision too large to be printed: '${general(value)}/${precision}' (consider using --to)` : `value too large to be printed: '${general(value)}' (consider using --to)`);
    if (decimalPower > 32) return this.failure(`value too large to be printed: '${general(value)}' (cannot handle values > 999Q)`);
    if (settings.developer) await this.output.emit("double_to_human:\n", true);
    let rendered: string;
    let powerIndex = 0;
    let printedValue = value;
    if (settings.to === "none") {
      const factor = power(10, Number(precision));
      printedValue = divide(round(multiply(value, factor), settings.rounding), factor);
      rendered = fixed(printedValue, Number(precision), settings.grouping && settings.thousands);
      if (settings.developer) await this.output.emit(`  no scaling, returning ${settings.grouping ? "(grouped) " : ""}value: ${rendered}\n`, true);
    } else {
      const base = settings.to === "si" ? 1000 : 1024;
      const baseBinary = base === 1000 ? BINARY_1000 : BINARY_1024;
      while (compare(absolute(printedValue), baseBinary) >= 0) { printedValue = divide(printedValue, baseBinary); powerIndex++; }
      if (settings.developer) await this.output.emit(`  scaled value to ${fixed(printedValue, 6)} * ${base} ^ ${powerIndex}\n`, true);
      const adjustment = settings.precision === undefined ? compare(absolute(printedValue), BINARY_10) < 0 ? 1 : 0 : Number(settings.precision < BigInt(powerIndex * 3) ? settings.precision : BigInt(powerIndex * 3));
      const factor = power(10, adjustment);
      printedValue = divide(round(multiply(printedValue, factor), settings.rounding), factor);
      if (compare(absolute(printedValue), baseBinary) >= 0) { printedValue = divide(printedValue, baseBinary); powerIndex++; }
      if (settings.developer) await this.output.emit(`  after rounding, value=${fixed(printedValue, 6)} * ${base} ^ ${powerIndex}\n`, true);
      let outputPrecision = settings.precision === undefined ? (printedValue.coefficient !== 0n && compare(absolute(printedValue), BINARY_10) < 0 && powerIndex > 0 ? 1n : 0n) : BigInt.asIntN(32, settings.precision);
      if (outputPrecision < 0n) outputPrecision = 6n;
      if (outputPrecision > 126n) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
      rendered = fixed(printedValue, Number(outputPrecision));
    }
    if (settings.zeroPadding > 0n) {
      if (settings.zeroPadding > 127n) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
      const negative = rendered.startsWith("-");
      rendered = (negative ? "-" : "") + (negative ? rendered.slice(1) : rendered).padStart(Number(settings.zeroPadding) - Number(negative), "0");
    }
    if (settings.to !== "none" && powerIndex) {
      rendered += (settings.unitSeparator ?? "") + (settings.to === "si" && powerIndex === 1 ? "k" : unitPrefixes[powerIndex - 1] ?? "(error)");
    }
    if (rendered.length >= (settings.to === "none" ? 128 : 127)) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
    if (settings.to === "iec-i" && powerIndex) rendered += "i";
    if (settings.developer && settings.to !== "none") await this.output.emit(`  returning value: ${quote(rendered, settings.unicode)}\n`, true);
    rendered += settings.suffix.slice(0, 127 - rendered.length);
    if (settings.developer) await this.output.emit(`formatting output:\n  value: ${fixed(value, 6)}\n  humanized: ${quote(rendered, settings.unicode)}\n`, true);
    if (settings.padding > BigInt(rendered.length)) {
      if (settings.padding > this.output.remaining - settings.prefix.length - settings.postfix.length) throw new PublicDiagnostic("numfmt output limit exceeded");
    }
    return rendered;
  }

  private trySimpleLineSync(line: string, newline: boolean): false | true | Promise<void> {
    const settings = this.settings;
    if (
      settings.developer ||
      settings.suffix ||
      settings.padding > 128n ||
      settings.zeroPadding > 0n ||
      settings.grouping ||
      settings.format !== undefined ||
      settings.from !== "none" ||
      settings.fromUnit !== 1n ||
      settings.toUnit !== 1n ||
      (settings.to !== "iec" && settings.to !== "iec-i" && settings.to !== "si" && settings.to !== "none") ||
      line.indexOf("\0") >= 0 ||
      !this.canTickSync((line.length * 2 + 16) * ((settings.fields?.length ?? 0) + 1))
    ) {
      return false;
    }
    const savedWork = this.work;
    const savedPadding = settings.padding;
    const bail = (): false => {
      this.work = savedWork;
      settings.padding = savedPadding;
      return false;
    };
    const onlyFirstField = settings.fields === undefined || (settings.fields.length === 1 && settings.fields[0]![0] === 1n && settings.fields[0]![1] === 1n);
    let start = 0;
    let field = 0n;
    let lineOut = "";
    while (true) {
      field++;
      let end = start;
      if (settings.delimiter !== undefined) {
        while (end < line.length && line[end] !== settings.delimiter) end++;
      } else {
        while (blank(line[end]) || line[end] === "\n") end++;
        while (end < line.length && !blank(line[end]) && line[end] !== "\n") end++;
      }
      const t = this.tick((settings.fields?.length ?? 0) + 1);
      if (t) return bail();
      const selected = onlyFirstField ? field === 1n : settings.fields!.some(([low, high]) => low <= field && field <= high);
      const text = line.slice(start, end);
      if (selected) {
        let skipped = 0;
        while (blank(text[skipped])) skipped++;
        const numPart = skipped === 0 ? text : text.slice(skipped);
        if (!numPart || numPart.length > 18) return bail();
        let idx = 0;
        const neg = numPart[0] === "-";
        if (neg) idx++;
        if (idx >= numPart.length) return bail();
        let val = 0n;
        for (; idx < numPart.length; idx++) {
          const c = numPart.charCodeAt(idx) - 48;
          if (c < 0 || c > 9) return bail();
          val = val * 10n + BigInt(c);
        }
        if (this.tick(numPart.length - (neg ? 1 : 0))) return bail();
        if (neg) val = -val;
        // Use human() only if it would not need developer output
        const binVal = binary(val);
        let printedValue = binVal;
        const base = settings.to === "iec" || settings.to === "iec-i" ? 1024 : 1000;
        const baseBinary = base === 1024 ? BINARY_1024 : BINARY_1000;
        let powerIndex = 0;
        if (settings.to !== "none") {
          while (compare(absolute(printedValue), baseBinary) >= 0 && powerIndex < unitPrefixes.length) {
            printedValue = base === 1024 && printedValue.coefficient !== 0n ? { ...printedValue, exponent: printedValue.exponent - 10 } : divide(printedValue, baseBinary);
            powerIndex++;
          }
          const adjustment = settings.precision === undefined ? (compare(absolute(printedValue), BINARY_10) < 0 ? 1 : 0) : Number(settings.precision < BigInt(powerIndex * 3) ? settings.precision : BigInt(powerIndex * 3));
          const factor = power(10, adjustment);
          printedValue = adjustment === 0 ? round(printedValue, settings.rounding) : divide(round(multiply(printedValue, factor), settings.rounding), factor);
          if (compare(absolute(printedValue), baseBinary) >= 0) {
            printedValue = base === 1024 && printedValue.coefficient !== 0n ? { ...printedValue, exponent: printedValue.exponent - 10 } : divide(printedValue, baseBinary);
            powerIndex++;
          }
          const outputPrecision = settings.precision === undefined ? (printedValue.coefficient !== 0n && compare(absolute(printedValue), BINARY_10) < 0 && powerIndex > 0 ? 1n : 0n) : BigInt.asIntN(32, settings.precision);
          if (outputPrecision < 0n || outputPrecision > 126n) return bail();
          let rendered = fixed(printedValue, Number(outputPrecision));
          if (powerIndex) {
            rendered += (settings.unitSeparator ?? "") + (settings.to === "si" && powerIndex === 1 ? "k" : unitPrefixes[powerIndex - 1] ?? "(error)");
            if (settings.to === "iec-i") rendered += "i";
          }
          if (rendered.length >= 127) return bail();
          const padTarget = this.autoPadding ? (skipped > 0 || field > 1n ? text.length : 0) : Number(settings.padding);
          if (this.autoPadding) settings.padding = BigInt(padTarget);
          const padLen = Math.max(0, padTarget - rendered.length);
          const padded = padLen > 0 ? (settings.left ? rendered + " ".repeat(padLen) : " ".repeat(padLen) + rendered) : rendered;
          lineOut += settings.prefix + padded + settings.postfix;
        } else {
          const outPrec = settings.precision === undefined ? 0 : Number(settings.precision);
          if (outPrec < 0 || outPrec > 126) return bail();
          const rendered = fixed(round(printedValue, settings.rounding), outPrec);
          if (rendered.length >= 128) return bail();
          const padTarget = this.autoPadding ? (skipped > 0 || field > 1n ? text.length : 0) : Number(settings.padding);
          if (this.autoPadding) settings.padding = BigInt(padTarget);
          const padLen = Math.max(0, padTarget - rendered.length);
          const padded = padLen > 0 ? (settings.left ? rendered + " ".repeat(padLen) : " ".repeat(padLen) + rendered) : rendered;
          lineOut += settings.prefix + padded + settings.postfix;
        }
      } else {
        lineOut += text;
      }
      if (end >= line.length) break;
      lineOut += settings.delimiter ?? " ";
      start = end + 1;
    }
    if (newline) lineOut += settings.separator;
    const em = this.output.emit(lineOut);
    return em ?? true;
  }

  line(line: string, newline: boolean, backing?: Uint8Array): void | Promise<void> {
    const simple = this.trySimpleLineSync(line, newline);
    if (simple !== false) return simple === true ? undefined : simple;
    return this.lineSlow(line, newline, backing ?? textBytes(line + "\0"));
  }

  private async lineSlow(line: string, newline: boolean, backing = textBytes(line + "\0")): Promise<void> {
    const settings = this.settings;
    const nul = line.indexOf("\0");
    if (nul >= 0) line = line.slice(0, nul);
    let start = 0;
    let field = 0n;
    while (true) {
      field++;
      let end = start;
      if (settings.delimiter !== undefined) { while (end < line.length && line[end] !== settings.delimiter) end++; }
      else {
        while (blank(line[end]) || line[end] === "\n") end++;
        while (end < line.length && !blank(line[end]) && line[end] !== "\n") end++;
      }
      backing[end] = 0;
      let text = line.slice(start, end);
      { const t = this.tick((settings.fields?.length ?? 0) + 1); if (t) await t; }
      if (settings.fields ? settings.fields.some(([low, high]) => low <= field && field <= high) : field === 1n) {
        if (settings.suffix && text.length > settings.suffix.length) {
          if (text.endsWith(settings.suffix)) { text = text.slice(0, -settings.suffix.length); backing[start + text.length] = 0; if (settings.developer) await this.output.emit(`trimming suffix ${quote(settings.suffix, settings.unicode)}\n`, true); }
          else if (settings.developer) await this.output.emit("no valid suffix found\n", true);
        }
        let skipped = 0;
        while (blank(text[skipped])) skipped++;
        if (this.autoPadding) {
          settings.padding = skipped > 0 || field > 1n ? BigInt(text.length) : 0n;
          if (settings.developer) await this.output.emit(`setting Auto-Padding to ${settings.padding} characters\n`, true);
        }
        const parsed = await this.number(text.slice(skipped), backing, start + skipped);
        const converted = parsed && await this.human(parsed.value, parsed.precision);
        if (converted === false) await this.output.emit(text);
        else {
          if (settings.developer && settings.padding > BigInt(converted.length)) {
            await this.output.emit(settings.unicode ? "  After padding: \xe2\x80\x98" : "  After padding: '", true);
            await emitPadded(this.settings, this.output, converted, true);
            await this.output.emit(settings.unicode ? "\xe2\x80\x99\n" : "'\n", true);
          }
          await this.output.emit(settings.prefix);
          await emitPadded(this.settings, this.output, converted);
          await this.output.emit(settings.postfix);
        }
      } else await this.output.emit(text);
      if (end >= line.length) break;
      await this.output.emit(settings.delimiter ?? " ");
      start = end + 1;
    }
    if (newline) await this.output.emit(settings.separator);
  }
}

export function numfmtCommand(options: NumfmtCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "numfmt", filesystemRequirements: [{ id: "stdin", description: "Format operands or standard input", capabilities: [] }], async execute(context) {
    context.signal.throwIfAborted();
    const controller = new AbortController();
    const local = { ...context, signal: AbortSignal.any([context.signal, controller.signal]) };
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let reader: AsyncIterator<Uint8Array> | undefined;
    let finished = false;
    let retirement: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    let stdout: OutputOperation | undefined;
    let stderr: OutputOperation | undefined;
    let outputBytes = 0;
    let errorBytes = 0;
    let pendingStdout = "";
    const outputLimit = new PublicDiagnostic("numfmt output limit exceeded");
    const output = {
      get remaining() { return limits.maxOutputBytes - outputBytes; },
      async flush(): Promise<void> {
        if (!pendingStdout.length) return;
        const chunk = pendingStdout;
        pendingStdout = "";
        const destination = stdout?.output ?? context.stdout;
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          await writeBytes(destination, textBytes(chunk.slice(offset, offset + 65536)), local.signal);
        }
      },
      emit(text: string, error = false): void | Promise<void> {
        if (!text && !error) return;
        const total = error ? errorBytes : outputBytes;
        if (text.length > limits.maxOutputBytes - total) throw outputLimit;
        if (!error) {
          outputBytes += text.length;
          pendingStdout += text;
          if (pendingStdout.length >= 16384) return output.flush();
          return;
        }
        return (async () => {
          if (pendingStdout.length) await output.flush();
          errorBytes += text.length;
          const destination = stderr?.output ?? context.stderr;
          for (let offset = 0; offset < text.length; offset += 65536) await writeBytes(destination, textBytes(text.slice(offset, offset + 65536)), local.signal);
        })();
      },
    };
    const retire = (): Promise<void> => retirement ??= Promise.resolve().then(async () => { if (!finished) await iterator?.return?.(); });
    const close = (): Promise<void> => {
      closing ??= Promise.resolve().then(async () => {
        controller.abort(new FsError("EPIPE", { message: "numfmt input closed" }));
        const results = await Promise.allSettled([retire(), reader?.return?.(), stdout?.close(), stderr?.close()]);
        for (const result of results) if (result.status === "rejected") throw result.reason;
      });
      return closing;
    };
    context.registerCleanup?.(close);
    let outcome: { exitCode: number } | { error: unknown };
    try {
      stdout = createOutputOperation(local, context.stdout);
      stderr = createOutputOperation(local, context.stderr);
      const settings = parse(context, limits);
      const converter = new Converter(settings, limits, local, output);
      if (settings.information) {
        await output.emit(settings.information === "version" ? "numfmt (virtual-bash)\n" : helpText);
        outcome = { exitCode: 0 };
      } else {
        await converter.initialize();
        if (settings.operands.length) {
          for (const operand of settings.operands) await converter.line(operand, true);
        } else {
          local.signal.throwIfAborted();
          iterator = context.stdin[Symbol.asyncIterator]();
          reader = readBytes({ [Symbol.asyncIterator]: () => ({ next: async () => { const result = await iterator!.next(); if (result.done) finished = true; return result; }, return: async () => { await retire(); return { done: true, value: undefined }; } }) }, local.signal)[Symbol.asyncIterator]();
          const record = new RecordBuffer(limits.maxRecordBytes);
          let received = 0;
          let empty = 0;
          let readFailure: string | undefined;
          let backing: Uint8Array = new Uint8Array(0);
          const process = (bytes: Uint8Array, terminated: boolean): void | Promise<void> => {
            const initialized = bytes.length + (terminated ? 2 : 1);
            if (backing.length < initialized) backing = new Uint8Array(initialized);
            backing.set(bytes);
            backing[bytes.length] = terminated ? settings.separator.charCodeAt(0) : 0;
            if (terminated) backing[bytes.length + 1] = 0;
            const line = byteText(bytes);
            if (settings.header) {
              settings.header--;
              const header = line + (terminated ? settings.separator : "");
              const nul = header.indexOf("\0");
              return output.emit(nul < 0 ? header : header.slice(0, nul));
            }
            backing[bytes.length] = 0;
            if (terminated || backing.length <= initialized) {
              const simple = converter["trySimpleLineSync"](line, terminated);
              if (simple !== false) return simple === true ? undefined : simple;
            }
            return converter["lineSlow"](line, terminated, backing);
          };
          while (true) {
            { const t = converter.tick(); if (t) await t; }
            let item: IteratorResult<Uint8Array>;
            try { item = await reader.next(); }
            catch (error) {
              local.signal.throwIfAborted();
              const messages: Readonly<Record<string, string>> = { EISDIR: "Is a directory", EIO: "Input/output error", EBADF: "Bad file descriptor", EACCES: "Permission denied", EFBIG: "File too large" };
              if (!(error instanceof FsError) || !messages[error.code]) throw error;
              readFailure = messages[error.code];
              break;
            }
            if (item.done) break;
            if (item.value.length > limits.maxSingleChunkBytes || item.value.length > limits.maxInputBytes - received) throw new PublicDiagnostic("byte command input limit exceeded");
            received += item.value.length;
            context.inputBudget?.check(received);
            if (!item.value.length && ++empty > limits.maxEmptyChunks) throw new PublicDiagnostic("empty input chunk limit exceeded");
            const chunk = new Uint8Array(item.value);
            const sepByte = settings.separator.charCodeAt(0);
            let start = 0;
            while (start < chunk.length) {
              const offset = chunk.indexOf(sepByte, start);
              if (offset < 0) {
                const rem = chunk.length - start;
                if (rem >= 4096) { const t = converter.tick(rem >> 12); if (t) await t; }
                break;
              }
              { const t = converter.tick(); if (t) await t; }
              if (offset - start > record.capacity - record.size) throw new PublicDiagnostic("line buffer limit exceeded");
              { const pr = process(record.finish(undefined, chunk, start, offset), true); if (pr) await pr; }
              start = offset + 1;
            }
            if (chunk.length - start > record.capacity - record.size) throw new PublicDiagnostic("line buffer limit exceeded");
            record.append(chunk, start);
            if (pendingStdout.length) await output.flush();
          }
          if (record.size) await process(record.finish(), false);
          if (readFailure) await converter.warning(`error reading input: ${readFailure}`);
        }
        if (settings.debug && converter.invalid) await converter.warning("failed to convert some of the input numbers");
        await output.flush();
        outcome = { exitCode: converter.invalid && settings.invalid === "fail" ? 2 : 0 };
      }
      await output.flush();
    } catch (error) {
      try {
        context.signal.throwIfAborted();
        await output.flush();
        if (error instanceof NumfmtDiagnostic) {
          const text = `numfmt: ${error.message}\n${error.extra}${error.help ? "Try 'numfmt --help' for more information.\n" : ""}`;
          await output.emit(text, true);
          outcome = { exitCode: error.status };
        } else if (error instanceof PublicDiagnostic) {
          await output.emit(byteText(encoder.encode(`${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`)), true);
          outcome = { exitCode: 1 };
        }
        else outcome = { error };
      } catch (failure) { outcome = failure === outputLimit ? { exitCode: 1 } : { error: failure }; }
    }
    try { await close(); } catch (error) { if (!("error" in outcome)) outcome = { error }; }
    context.signal.throwIfAborted();
    if ("error" in outcome) throw outcome.error;
    return outcome;
  } };
}

import { commandRuntimeIdentity, type VirtualShellPlugin } from "safe-bash-contracts";

export interface NumfmtLimits {
  readonly maxRecordBytes: number;
  readonly maxWork: number;
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxFieldRanges: number;
  readonly maxEmptyChunks: number;
  readonly maxSingleChunkBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export interface NumfmtCommandsOptions {
  readonly replace?: boolean | undefined;
  readonly maxRecordBytes?: number | undefined;
  readonly limits?: Partial<NumfmtLimits> | undefined;
}

export type NumfmtOptions = NumfmtCommandsOptions;

export function settings(options: NumfmtCommandsOptions = {}): NumfmtLimits {
  const limits: NumfmtLimits = {
    maxRecordBytes: options.limits?.maxRecordBytes ?? options.maxRecordBytes ?? Infinity,
    maxWork: options.limits?.maxWork ?? Infinity,
    maxArguments: options.limits?.maxArguments ?? Infinity,
    maxArgumentBytes: options.limits?.maxArgumentBytes ?? Infinity,
    maxFieldRanges: options.limits?.maxFieldRanges ?? Infinity,
    maxEmptyChunks: options.limits?.maxEmptyChunks ?? Infinity,
    maxSingleChunkBytes: options.limits?.maxSingleChunkBytes ?? Infinity,
    maxInputBytes: options.limits?.maxInputBytes ?? Infinity,
    maxOutputBytes: options.limits?.maxOutputBytes ?? Infinity,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RangeError(`${name} must be a positive safe integer or Infinity`);
    }
  }
  return limits;
}

export function createNumfmtCommand(options: NumfmtCommandsOptions = {}): CommandDefinition {
  return { ...numfmtCommand(options), runtimeIdentity: commandRuntimeIdentity };
}

export function createNumfmtCommands(options: NumfmtCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createNumfmtCommand(options)]);
}

export function numfmtCommands(options: NumfmtCommandsOptions = {}): VirtualShellPlugin {
  const commands = createNumfmtCommands(options);
  return {
    name: "numfmt-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) {
            throw new Error(`Command already registered: ${command.name}`);
          }
        }
      }
      for (const command of commands) {
        host.commands.register(command, { replace: options.replace ?? false });
      }
    },
  };
}
