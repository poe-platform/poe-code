import { byteLength } from "../byte-encoding.js";
import { writeDiagnostic } from "../escaping.js";
import { FsError, getCommandArguments, type CommandContext, type CommandDefinition, type CommandHandler, type CommandResult } from "../contracts/index.js";
import { define, escapeBytes, options, output, requireOperands, UsageError } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { pwdRequirements } from "./portable-requirements.js";
import { printfInteger } from "./printf-integer.js";
import { printfHex } from "./printf-hex.js";
import { parsePrintfFloat } from "./printf-float.js";
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
        if (arg === "--logical") { mode = "logical"; continue; }
        if (arg === "--physical") { mode = "physical"; continue; }
        for (const flag of arg.slice(1)) {
          if (flag !== "L" && flag !== "P") {
            if (!external) throw new UsageError(`invalid option '${flag}'`);
            await writeDiagnostic(context.stderr, `pwd: invalid option '${flag}'\n`, context.signal);
            return { exitCode: 1 };
          }
          mode = flag === "P" ? "physical" : "logical";
        }
      }
      if (external && ignored) await writeDiagnostic(context.stderr, "pwd: ignoring non-option arguments\n", context.signal);
      const requiredMode = external ? "physical" : mode;
      assertCommandRequirements(context, pwdRequirements, [requiredMode]);
      if (requiredMode === "physical" && context.fs.capabilitiesFor) assertCommandRequirements(context, pwdRequirements, [requiredMode],
        await context.fs.capabilitiesFor(context.cwd, { signal: context.signal }));
      let directory = requiredMode === "physical" ? await context.fs.realpath(context.cwd, { signal: context.signal }) : context.cwd;
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
    define("basename", async (context) => {
      const arguments_ = getCommandArguments(context);
      const operands: number[] = [];
      let suffix: Uint8Array | undefined;
      const parsed = options(arguments_.args, "as:z", { multiple: "a", suffix: "s", zero: "z" }, true,
        index => { operands.push(index); },
        (_key, index, offset) => { suffix = arguments_.bytes(index)!.subarray(offset); });
      const multiple = parsed.flags.has("a") || parsed.flags.has("s");
      requireOperands(parsed.operands, 1, multiple ? Infinity : 2);
      if (!multiple && operands.length === 2) suffix = arguments_.bytes(operands[1]!)!;
      for (const index of multiple ? operands : operands.slice(0, 1)) {
        const operand = arguments_.bytes(index)!;
        let end = operand.length;
        while (end > 0 && operand[end - 1] === 47) end--;
        let start = end;
        while (start > 0 && operand[start - 1] !== 47) start--;
        if (end === 0 && operand.length > 0) end = 1;
        if (suffix?.length && suffix.length < end - start) {
          let matches = true;
          for (let offset = 0; offset < suffix.length; offset++) {
            if (operand[end - suffix.length + offset] !== suffix[offset]) { matches = false; break; }
          }
          if (matches) end -= suffix.length;
        }
        const result = new Uint8Array(end - start + 1);
        result.set(operand.subarray(start, end));
        result[result.length - 1] = parsed.flags.has("z") ? 0 : 10;
        await output(context, result);
      }
      return { exitCode: 0 };
    }, 1, 1),
    define("dirname", async (context) => {
      const arguments_ = getCommandArguments(context);
      const operands: number[] = [];
      const parsed = options(arguments_.args, "z", { zero: "z" }, context.env.POSIXLY_CORRECT !== undefined, index => { operands.push(index); });
      requireOperands(parsed.operands);
      for (const index of operands) {
        const operand = arguments_.bytes(index)!;
        let end = operand.length;
        while (end > 0 && operand[end - 1] === 47) end--;
        if (end === 0 && operand.length > 0) end = 1;
        else {
          while (end > 0 && operand[end - 1] !== 47) end--;
          while (end > 1 && operand[end - 1] === 47) end--;
        }
        const result = new Uint8Array((end || 1) + 1);
        if (end) result.set(operand.subarray(0, end));
        else result[0] = 46;
        result[result.length - 1] = parsed.flags.has("z") ? 0 : 10;
        await output(context, result);
      }
      return { exitCode: 0 };
    }, 1, 1),
    printfCommand,
  ].map(command => {
    if (command.name === "echo") defaultEchoExecutors.add(command.execute);
    return { ...command, filesystemRequirements: command.name === "pwd" ? pwdRequirements : [] };
  });
}

export async function formatPrintf(context: CommandContext, shellStartedAt = (context as CommandContext & { shellStartedAt?: number }).shellStartedAt ?? Date.now()): Promise<CommandResult> {
  const incoming = getCommandArguments(context);
  const arguments_ = incoming.args[0] === "--" ? incoming.slice(1) : incoming;
  const args = arguments_.args;
  requireOperands(args);
  const format = args[0]!;
  if (format.startsWith("-") && incoming.args[0] !== "--") throw new UsageError(`invalid option '${format}'`);
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
      if (width > 1_000_000 || (precision ?? 0) > 1000) throw new UsageError("format width or precision is too large");
      const specifier = directive.specifier;
      if (/[fFeEgGaA]/u.test(specifier) && (precision ?? 0) > 100) throw new UsageError("floating-point precision is too large");
      const suppliedIndex = argument++;
      const supplied = args[suppliedIndex] ?? "";
      let text: string;
      let specialFloat: string | undefined;
      if (specifier === "T") {
        const operand = supplied.startsWith("'") || supplied.startsWith('"') ? String(quotedNumber(suppliedIndex)) : supplied;
        const parsed = printfInteger(suppliedIndex < args.length ? operand : "-1", false);
        if (parsed.error) {
          await writeDiagnostic(context.stderr, `printf: '${supplied}': ${parsed.error}\n`, context.signal);
          exitCode = 1;
        }
        const seconds = parsed.value === -1n ? BigInt(Math.floor(Date.now() / 1000))
          : parsed.value === -2n ? BigInt(Math.floor(shellStartedAt / 1000)) : parsed.value;
        const formatted = await printfTime(directive.timeFormat || "%X", seconds, context.env.TZ ?? "UTC", context.signal);
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
        let number = supplied === "" ? 0 : /^["']/u.test(supplied) ? quotedNumber(suppliedIndex) : Number(supplied);
        if (/^[+-]0[xX][0-9a-fA-F]+$/u.test(supplied.trim())) {
          number = Number(supplied.trim().slice(1)) * (supplied.trim().startsWith("-") ? -1 : 1);
        }
        if (/^[+-]?0[0-9]+$/u.test(supplied) && !/[fFeEgGaA]/u.test(specifier)) {
          if (/[89]/u.test(supplied)) number = NaN;
          else number = parseInt(supplied.replace(/^[+-]?0/u, ""), 8) * (supplied.startsWith("-") ? -1 : 1);
        }
        if ("fFeEgGaA".includes(specifier) && supplied && !supplied.startsWith("'") && !supplied.startsWith('"')) {
          const parsed = parsePrintfFloat(supplied);
          number = parsed?.value ?? NaN;
          specialFloat = parsed?.special;
          if (parsed?.error) {
            await writeDiagnostic(context.stderr, `printf: '${supplied}': ${parsed.error}\n`, context.signal);
            exitCode = 1;
          }
        }
        if ("fFeEgGaA".includes(specifier) && (!Number.isFinite(number) && specialFloat === undefined || supplied === "" && suppliedIndex < args.length)) {
          await writeDiagnostic(context.stderr, `printf: '${supplied}': invalid number\n`, context.signal);
          exitCode = 1; number = 0;
        }
        if (specialFloat !== undefined) text = specialFloat;
        else if (/[aA]/u.test(specifier)) text = (number < 0 ? "-" : "") + printfHex(number, precision, flags.includes("#"));
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
        if ((number >= 0 || specialFloat === "nan") && !negativeZero && /[difFeEgGaA]/u.test(specifier)) text = (flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + text;
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
