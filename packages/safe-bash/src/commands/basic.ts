import { pwdBuiltinHelp } from "../shell/pwd-help.js";
import { gnuInformationSync } from "safe-bash-io-engine/gnu-information";
import { byteLength, concatBytes, equalBytes } from "../byte-encoding.js";
import { writeDiagnostic } from "../escaping.js";
import { FsError, getCommandArguments, type CommandContext, type CommandDefinition, type CommandHandler, type CommandResult } from "../contracts/index.js";
import { define, escapeBytes, output, requireOperands, UsageError } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { pwdRequirements } from "./portable-requirements.js";
import { printfInteger } from "./printf-integer.js";
import { printfHex } from "./printf-hex.js";
import { parsePrintfFloat, type PrintfBinary } from "./printf-float.js";
import { printfDecimal } from "./printf-decimal.js";
import { parsePrintfDirective } from "./printf-format.js";
import { quotePrintf } from "./printf-quote.js";
import { widePrintf } from "./printf-wide.js";
import { printfTime } from "./printf-time.js";

const utf8Encoder = new TextEncoder();

export const defaultEchoExecutors = new WeakSet<CommandHandler>();

export function basicCommands(): CommandDefinition[] {
  return [
    define("true", () => ({ exitCode: 0 })),
    define("false", () => ({ exitCode: 1 })),
    define("echo", async (context) => {
      const arguments_ = getCommandArguments(context);
      const external = (context as { externalInvocation?: boolean }).externalInvocation === true;
      const posix = external && context.env.POSIXLY_CORRECT !== undefined;
      let newline = true;
      let escapes = !external && (context as { xpgEcho?: boolean }).xpgEcho === true;
      let offset = 0;
      while ((!posix || arguments_.args[0] === "-n") && /^-[neE]+$/u.test(arguments_.args[offset] ?? "")) {
        for (const flag of arguments_.args[offset]!.slice(1)) {
          if (flag === "n") newline = false;
          else escapes = flag === "e";
        }
        offset++;
      }
      if (posix) escapes = true;
      const joined = arguments_.slice(offset).join(" ");
      const text = typeof joined === "string" ? joined : arguments_.withValues([joined]).bytes(0)!;
      if (escapes) {
        const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C.UTF-8";
        const escaped = escapeBytes(text, true, external, external ? undefined : {
          utf8: locale !== "C" && locale !== "POSIX",
          missingDigit() {},
        });
        if (escaped.stop) newline = false;
        if (newline) {
          const withNewline = new Uint8Array(escaped.bytes.byteLength + 1);
          withNewline.set(escaped.bytes);
          withNewline[escaped.bytes.byteLength] = 10;
          await output(context, withNewline);
        } else {
          await output(context, escaped.bytes);
        }
      } else if (typeof text === "string") {
        await output(context, newline ? `${text}\n` : text);
      } else if (newline) {
        const withNewline = new Uint8Array(text.byteLength + 1);
        withNewline.set(text);
        withNewline[text.byteLength] = 10;
        await output(context, withNewline);
      } else {
        await output(context, text);
      }
      return { exitCode: 0 };
    }),
    define("pwd", async (context) => {
      const external = (context as { externalInvocation?: boolean }).externalInvocation === true;
      const name = context.argv0 ?? "pwd";
      let mode: "physical" | "logical" = external && context.env.POSIXLY_CORRECT === undefined ? "physical" : "logical";
      let ignored = false;
      for (let index = 0; index < context.args.length; index++) {
        const arg = context.args[index]!;
        if (arg === "--") { ignored ||= index + 1 < context.args.length; break; }
        if (!arg.startsWith("-") || arg === "-") {
          ignored = true;
          if (!external || context.env.POSIXLY_CORRECT !== undefined) break;
          continue;
        }
        if (!external && arg === "--help") {
          await output(context, pwdBuiltinHelp);
          return { exitCode: 2 };
        }
        if (external && arg.startsWith("--")) {
          const key = arg.slice(2).split("=", 1)[0]!;
          const option = ["logical", "physical", "help", "version"].find(value => key && value.startsWith(key));
          if (option && !arg.includes("=")) {
            if (option === "help" || option === "version") {
              await output(context, gnuInformationSync("pwd", [`--${option}`], true)!);
              return { exitCode: 0 };
            }
            mode = option === "physical" ? "physical" : "logical";
            continue;
          }
          const message = option ? `option '--${option}' doesn't allow an argument` : `unrecognized option '${arg}'`;
          await writeDiagnostic(context.stderr, `${name}: ${message}\nTry '${name} --help' for more information.\n`, context.signal);
          return { exitCode: 1 };
        }
        for (const flag of arg.slice(1)) {
          if (flag !== "L" && flag !== "P") {
            if (!external) throw new UsageError(`-${flag}: invalid option\npwd: usage: pwd [-LP]`);
            await writeDiagnostic(context.stderr, `${name}: invalid option -- '${flag}'\nTry '${name} --help' for more information.\n`, context.signal);
            return { exitCode: 1 };
          }
          mode = flag === "P" ? "physical" : "logical";
        }
      }
      if (external && ignored) await writeDiagnostic(context.stderr, `${name}: ignoring non-option arguments\n`, context.signal);
      const requiredMode = external ? "physical" : mode;
      assertCommandRequirements(context, pwdRequirements, [requiredMode]);
      if (requiredMode === "physical" && context.fs.capabilitiesFor) assertCommandRequirements(context, pwdRequirements, [requiredMode],
        await context.fs.capabilitiesFor(context.cwd, { signal: context.signal }));
      let directory = context.cwd;
      if (requiredMode === "physical") {
        try { directory = await context.fs.realpath(context.cwd, { signal: context.signal }); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
          const message = external ? "couldn't find directory entry in '..' with matching i-node"
            : "error retrieving current directory: getcwd: cannot access parent directories: No such file or directory";
          await writeDiagnostic(context.stderr, `${name}: ${message}\n`, context.signal);
          return { exitCode: 1 };
        }
      }
      context.signal.throwIfAborted();
      if (external && mode === "logical") {
        const logical = context.env.PWD;
        if (logical?.startsWith("/") && !logical.split("/").some(component => component === "." || component === "..")) {
          try {
            if (await context.fs.realpath(logical, { signal: context.signal }) === directory) directory = logical;
          } catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof FsError) || !["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(error.code)) throw error;
          }
        }
      }
      await output(context, `${directory}\n`);
      return { exitCode: 0 };
    }),
    define("basename", pathName, 1, 1),
    define("dirname", pathName, 1, 1),
    printfCommand,
  ].map(command => {
    if (command.name === "echo") defaultEchoExecutors.add(command.execute);
    return { ...command, filesystemRequirements: command.name === "pwd" ? pwdRequirements : [] };
  });
}

async function pathName(context: CommandContext): Promise<CommandResult> {
  const argv = getCommandArguments(context);
  const base = context.command === "basename";
  const names = base ? ["multiple", "suffix", "zero", "help", "version"] : ["zero", "help", "version"];
  const usage = async (...message: (string | Uint8Array)[]) => {
    const parts = [context.command + ": ", ...message, `\nTry '${context.command} --help' for more information.\n`];
    await output({ ...context, stdout: context.stderr }, concatBytes(parts.map(p => typeof p === "string" ? utf8Encoder.encode(p) : p)));
    return { exitCode: 1 };
  };
  const operands: number[] = [];
  let suffix: Uint8Array | undefined;
  let ended = false, multiple = false, zero = false;
  for (let i = 0; i < argv.args.length; i++) {
    const arg = argv.args[i]!;
    if (ended || arg === "-" || !arg.startsWith("-")) {
      operands.push(i);
      ended ||= base || context.env.POSIXLY_CORRECT !== undefined;
    } else if (arg === "--") {
      ended = true;
    } else if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const prefix = arg.slice(2, equals < 0 ? undefined : equals);
      if (!prefix) return usage("option '", argv.bytes(i)!, `' is ambiguous; possibilities: '--${names.join("' '--")}'`);
      const name = names.find(n => n.startsWith(prefix));
      if (!name) return usage("unrecognized option '", argv.bytes(i)!, "'");
      if (name === "suffix") {
        suffix = equals < 0 ? argv.bytes(++i) : argv.bytes(i)!.subarray(equals + 1);
        if (!suffix) return usage("option '--suffix' requires an argument");
        multiple = true;
      } else if (equals >= 0) return usage(`option '--${name}' doesn't allow an argument`);
      else if (name === "zero") zero = true;
      else if (name === "multiple") multiple = true;
      else {
        await output(context, gnuInformationSync(context.command, [`--${name}`])!);
        return { exitCode: 0 };
      }
    } else {
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (flag === "z") zero = true;
        else if (base && flag === "a") multiple = true;
        else if (base && flag === "s") {
          suffix = j + 1 < arg.length ? argv.bytes(i)!.subarray(j + 1) : argv.bytes(++i);
          if (!suffix) return usage("option requires an argument -- 's'");
          multiple = true;
          break;
        } else return usage("invalid option -- '", argv.bytes(i)!.subarray(j, j + 1), "'");
      }
    }
  }
  if (!operands.length) return usage("missing operand");
  if (base && !multiple && operands.length > 1) {
    if (operands.length > 2) {
      const { quote } = await import("safe-bash-command-fmt/quoting");
      const locale = (context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C").toLowerCase();
      return usage("extra operand " + quote(argv.bytes(operands[2]!)!, false, locale === "c.utf-8" || locale === "c.utf8"));
    }
    suffix = argv.bytes(operands.pop()!);
  }
  for (const i of operands) {
    const operand = argv.bytes(i)!;
    let start = 0, end = operand.length;
    while (end > 0 && operand[end - 1] === 47) end--;
    if (!end && operand.length) end = 1;
    else if (base) {
      start = end;
      while (start > 0 && operand[start - 1] !== 47) start--;
      if (suffix?.length && suffix.length < end - start && equalBytes(operand.subarray(end - suffix.length, end), suffix)) end -= suffix.length;
    } else {
      while (end > 0 && operand[end - 1] !== 47) end--;
      while (end > 1 && operand[end - 1] === 47) end--;
    }
    const length = !base && end === 0 ? 1 : end - start;
    const result = new Uint8Array(length + 1);
    if (!base && !end) result[0] = 46;
    else result.set(operand.subarray(start, end));
    result[length] = zero ? 0 : 10;
    await output(context, result);
  }
  return { exitCode: 0 };
}

export async function formatPrintf(context: CommandContext, shellStartedAt = (context as CommandContext & { shellStartedAt?: number }).shellStartedAt ?? Date.now(), assignCount?: (name: string, count: number) => Promise<void>): Promise<CommandResult> {
  let count = 0;
  const stdout = context.stdout;
  if (assignCount) context = { ...context, stdout: { write: async bytes => { await stdout.write(bytes); count += bytes.byteLength; } } };
  const incoming = getCommandArguments(context);
  const arguments_ = incoming.args[0] === "--" ? incoming.slice(1) : incoming;
  const args = arguments_.args;
  requireOperands(args);
  const format = args[0]!;
  if (format.startsWith("-") && format !== "-" && incoming.args[0] !== "--") throw new UsageError(`invalid option '${format}'`);
  const rawFormat = typeof arguments_.values[0] === "string" ? undefined : arguments_.bytes(0)!;
  const formatLength = rawFormat?.length ?? format.length;
  let argument = 1;
  let exitCode = 0;
  let stopped = false;
  const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C.UTF-8";
  const escapeErrors: string[] = [];
  const unicode = { utf8: locale !== "C" && locale !== "POSIX", missingDigit: (escape: string) => { escapeErrors.push(escape); } };
  const quotedNumber = (index: number): number => {
    const bytes = arguments_.bytes(index)?.subarray(1) ?? new Uint8Array();
    const first = bytes[0] ?? 0;
    if (!unicode.utf8 || first < 128) return first;
    const length = first >= 194 && first <= 223 ? 2 : first >= 224 && first <= 239 ? 3 : first >= 240 && first <= 244 ? 4 : 0;
    if (!length || bytes.length < length) return first;
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)).codePointAt(0) ?? first; }
    catch (error) { if (error instanceof TypeError) return first; throw error; }
  };
  do {
    count = 0;
    const before = argument;
    for (let offset = 0; offset < formatLength && !stopped;) {
      if (rawFormat ? rawFormat[offset] !== 37 : format[offset] !== "%") {
        const end = rawFormat ? rawFormat.indexOf(37, offset) : format.indexOf("%", offset);
        const limit = end < 0 ? formatLength : end;
        const literal = rawFormat ? rawFormat.subarray(offset, limit) : format.slice(offset, limit);
        const escaped = escapeBytes(literal, false, false, unicode, true);
        for (const escape of escapeErrors.splice(0)) await writeDiagnostic(context.stderr, `printf: missing ${escape === "x" ? "hex" : "unicode"} digit for \\${escape}\n`, context.signal);
        await output(context, escaped.bytes);
        stopped = escaped.stop;
        offset += literal.length;
        continue;
      }
      if (rawFormat ? rawFormat[offset + 1] === 37 : format[offset + 1] === "%") { await output(context, "%"); offset += 2; continue; }
      const directive = await parsePrintfDirective(rawFormat ?? format, offset, context.signal);
      offset = directive.end;
      let flags = directive.flags;
      const dynamic = async (): Promise<number> => {
        const index = argument++;
        const token = args[index] ?? "0";
        const numericOperand = token.startsWith("'") || token.startsWith('"') ? String(quotedNumber(index)) : token;
        const parsed = printfInteger(numericOperand, false);
        if (parsed.error) {
          await writeDiagnostic(context.stderr, `printf: '${token}': ${parsed.error}\n`, context.signal);
          exitCode = 1;
        }
        const number = Number(parsed.value);
        if (!Number.isSafeInteger(number)) throw new UsageError(`invalid width or precision '${token}'`);
        return number;
      };
      const suppliedWidth = directive.width === "*" ? await dynamic() : directive.width;
      if (suppliedWidth < 0) flags += "-";
      const width = Math.abs(suppliedWidth);
      const suppliedPrecision = directive.precision === "*" ? await dynamic() : directive.precision;
      const precision = suppliedPrecision !== undefined && suppliedPrecision < 0 ? undefined : suppliedPrecision;
      if (directive.warning !== undefined) {
        await writeDiagnostic(context.stderr, `printf: ${directive.warning}\n`, context.signal);
        await output(context, "%");
        continue;
      }
      if (width > 1_000_000 || (precision ?? 0) > 1000) throw new UsageError("format width or precision is too large");
      const specifier = unicode.utf8 && directive.wide && (directive.specifier === "s" || directive.specifier === "c")
        ? directive.specifier.toUpperCase() : directive.specifier;
      if (/[fFeEgGaA]/u.test(specifier) && (precision ?? 0) > 100) throw new UsageError("floating-point precision is too large");
      const suppliedIndex = argument++;
      const supplied = args[suppliedIndex] ?? "";
      let text: string;
      let specialFloat: string | undefined;
      if (specifier === "n") {
        if (supplied) await assignCount?.(supplied, count);
        continue;
      }
      if (specifier === "T") {
        const operand = supplied.startsWith("'") || supplied.startsWith('"') ? String(quotedNumber(suppliedIndex)) : supplied;
        const parsed = printfInteger(suppliedIndex < args.length ? operand : "-1", false);
        if (parsed.error) {
          if (parsed.error === "Numerical result out of range") {
            await writeDiagnostic(context.stderr, `printf: '${supplied}': ${parsed.error}\n`, context.signal);
          } else {
            const location = context as CommandContext & { scriptName?: string; diagnosticLine?: number };
            const prefix = location.scriptName === undefined && location.diagnosticLine === undefined
              ? "" : `${location.scriptName ?? "shell"}: line ${location.diagnosticLine ?? 1}: `;
            const kind = supplied.startsWith("0x") ? "hex "
              : supplied[0] === "0" && supplied.charCodeAt(1) >= 48 && supplied.charCodeAt(1) <= 57 ? "octal " : "";
            await writeDiagnostic(context.stderr, `${prefix}printf: ${supplied}: invalid ${kind}number\n`, context.signal);
          }
          exitCode = 1;
        }
        const seconds = parsed.value === -1n ? BigInt(Math.floor(Date.now() / 1000))
          : parsed.value === -2n ? BigInt(Math.floor(shellStartedAt / 1000)) : parsed.value;
        const formatted = await printfTime(directive.timeFormat || "%X", seconds, context.env, context.signal);
        const bytes = utf8Encoder.encode(formatted).subarray(0, precision);
        const padding = " ".repeat(Math.max(0, width - bytes.length));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, bytes);
        if (flags.includes("-")) await output(context, padding);
        continue;
      }
      if (specifier === "S" || specifier === "C") {
        const suppliedBytes = arguments_.bytes(suppliedIndex) ?? new Uint8Array();
        const wide = unicode.utf8 ? await widePrintf(suppliedBytes, specifier === "C", precision, context.signal)
          : specifier === "C" ? { bytes: suppliedBytes.length ? suppliedBytes.subarray(0, 1) : Uint8Array.of(0), characters: 1 }
          : { bytes: suppliedBytes.subarray(0, precision), characters: Math.min(suppliedBytes.length, precision ?? suppliedBytes.length) };
        if (!unicode.utf8 && wide.bytes.some(byte => byte >= 128)) {
          await writeDiagnostic(context.stderr, "printf: Invalid or incomplete multibyte or wide character\n", context.signal);
          return { exitCode: 1 };
        }
        const padding = " ".repeat(Math.max(0, width - wide.characters));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, wide.bytes);
        if (flags.includes("-")) await output(context, padding);
        continue;
      }
      if (specifier === "b" || specifier === "s") {
        const suppliedValue = arguments_.values[suppliedIndex] ?? "";
        const raw = specifier === "b" && typeof suppliedValue === "string" ? suppliedValue : arguments_.bytes(suppliedIndex) ?? new Uint8Array();
        const escaped = specifier === "b" ? escapeBytes(raw, true, true, unicode) : { bytes: raw as Uint8Array, stop: false };
        for (const escape of escapeErrors.splice(0)) await writeDiagnostic(context.stderr, `printf: missing ${escape === "x" ? "hex" : "unicode"} digit for \\${escape}\n`, context.signal);
        const bytes = escaped.bytes.subarray(0, precision);
        const padding = " ".repeat(Math.max(0, width - bytes.length));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, bytes);
        if (flags.includes("-")) await output(context, padding);
        stopped = escaped.stop;
        continue;
      }
      if (specifier === "c") {
        const byte = arguments_.bytes(suppliedIndex)?.subarray(0, 1);
        const padding = " ".repeat(Math.max(0, width - 1));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, byte?.length ? byte : Uint8Array.of(0));
        if (flags.includes("-")) await output(context, padding);
        continue;
      }
      if (specifier === "q" || specifier === "Q") {
        const suppliedBytes = arguments_.bytes(suppliedIndex) ?? new Uint8Array();
        const quoted = await quotePrintf(specifier === "Q" ? suppliedBytes.subarray(0, precision) : suppliedBytes,
          unicode.utf8, context.signal, flags.includes("#"));
        const bytes = specifier === "Q" ? quoted : quoted.subarray(0, precision);
        const padding = " ".repeat(Math.max(0, width - bytes.length));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, bytes);
        if (flags.includes("-")) await output(context, padding);
        continue;
      }
      else {
        let number: number | PrintfBinary = supplied === "" ? 0 : /^["']/u.test(supplied) ? quotedNumber(suppliedIndex) : Number(supplied);
        if (/^[+-]0[xX][0-9a-fA-F]+$/u.test(supplied.trim())) {
          number = Number(supplied.trim().slice(1)) * (supplied.trim().startsWith("-") ? -1 : 1);
        }
        if (/^[+-]?0[0-9]+$/u.test(supplied) && !/[fFeEgGaA]/u.test(specifier)) {
          if (/[89]/u.test(supplied)) number = NaN;
          else number = parseInt(supplied.replace(/^[+-]?0/u, ""), 8) * (supplied.startsWith("-") ? -1 : 1);
        }
        if ("fFeEgGaA".includes(specifier) && supplied && !supplied.startsWith("'") && !supplied.startsWith('"')) {
          const parsed = parsePrintfFloat(supplied);
          number = parsed?.binary ?? parsed?.value ?? NaN;
          specialFloat = parsed?.special;
          if (parsed?.error) {
            const operand = parsed.error === "Numerical result out of range" ? supplied : `'${supplied}'`;
            await writeDiagnostic(context.stderr, `printf: ${operand}: ${parsed.error}\n`, context.signal);
            exitCode = 1;
          }
        }
        if ("fFeEgGaA".includes(specifier) && (typeof number === "number" && !Number.isFinite(number) && specialFloat === undefined || supplied === "" && suppliedIndex < args.length)) {
          await writeDiagnostic(context.stderr, `printf: '${supplied}': invalid number\n`, context.signal);
          exitCode = 1; number = 0;
        }
        if (specialFloat !== undefined) text = specialFloat;
        else if (/[aA]/u.test(specifier)) text = ((typeof number === "number" ? number < 0 : number.negative) ? "-" : "") + printfHex(number, precision, flags.includes("#"));
        else if ("fFeEgG".includes(specifier)) text = printfDecimal(number, specifier, precision, flags.includes("#"));
        else {
          const radix = /[xX]/u.test(specifier) ? 16 : specifier === "o" ? 8 : 10;
          const unsigned = /[uoxX]/u.test(specifier);
          const numericOperand = supplied.startsWith("'") || supplied.startsWith('"') ? String(quotedNumber(suppliedIndex)) : supplied;
          const parsed = printfInteger(suppliedIndex < args.length ? numericOperand : "0", unsigned);
          const integral = parsed.value;
          if (parsed.error) {
            await writeDiagnostic(context.stderr, `printf: '${supplied}': ${parsed.error}\n`, context.signal);
            exitCode = 1;
          }
          number = Number(integral);
          text = integral.toString(radix);
          if (precision === 0 && integral === 0n) text = "";
          if (precision !== undefined) text = text.startsWith("-") ? `-${text.slice(1).padStart(precision, "0")}` : text.padStart(precision, "0");
          if (flags.includes("#")) {
            if (radix === 16 && integral !== 0n) text = "0x" + text;
            else if (radix === 8 && !text.startsWith("0")) text = "0" + text;
          }
        }
        const negativeZero = Object.is(number, -0) && "fFeEgGaA".includes(specifier);
        if (negativeZero) text = "-" + text;
        if (/[XFEGA]/u.test(specifier)) text = text.toUpperCase();
        if (((typeof number === "number" ? number >= 0 : !number.negative) || specialFloat === "nan") && !negativeZero && /[difFeEgGaA]/u.test(specifier)) text = (flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + text;
      }
      if (flags.includes("-")) text = text.padEnd(width, " ");
      else if (specialFloat === undefined && flags.includes("0") && /[diouxXfFeEgGaA]/u.test(specifier)
        && (precision === undefined || /[fFeEgGaA]/u.test(specifier))) {
        const prefix = /^[+ -]?(?:0[xX])|^[+ -]/u.exec(text)?.[0] ?? "";
        text = prefix + text.slice(prefix.length).padStart(Math.max(0, width - prefix.length), "0");
      } else text = text.padStart(width, " ");
      await output(context, text);
    }
    if (argument === before) break;
  } while (argument < args.length && !stopped);
  return { exitCode };
}

export const printfCommand = define("printf", formatPrintf, 1, 1);
