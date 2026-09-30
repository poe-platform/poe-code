import { writeDiagnostic } from "../escaping.js";
import { getCommandArguments, type CommandContext, type CommandDefinition, type CommandHandler, type CommandResult } from "../contracts/index.js";
import { define, escapeBytes, options, output, requireOperands, UsageError } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { pwdRequirements } from "./portable-requirements.js";
import { printfInteger } from "./printf-integer.js";
import { printfHex } from "./printf-hex.js";
import { parsePrintfFloat } from "./printf-float.js";
import { printfDecimal } from "./printf-decimal.js";
import { parsePrintfDirective } from "./printf-format.js";
import { quotePrintf } from "./printf-quote.js";

const utf8Encoder = new TextEncoder();

export const defaultEchoExecutors = new WeakSet<CommandHandler>();

export function basicCommands(): CommandDefinition[] {
  return [
    define("true", () => ({ exitCode: 0 })),
    define("false", () => ({ exitCode: 1 })),
    define("echo", async (context) => {
      const arguments_ = getCommandArguments(context);
      const posix = (context as { externalInvocation?: boolean }).externalInvocation && context.env.POSIXLY_CORRECT !== undefined;
      let newline = true;
      let escapes = false;
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
        const escaped = escapeBytes(text, true, false, (context as { externalInvocation?: boolean }).externalInvocation ? undefined : {
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
      let mode: "physical" | "logical" = (context as { externalInvocation?: boolean }).externalInvocation && context.env.POSIXLY_CORRECT === undefined ? "physical" : "logical";
      for (const arg of context.args) {
        if (arg === "--" || !arg.startsWith("-") || arg === "-") break;
        if (arg === "--logical") { mode = "logical"; continue; }
        if (arg === "--physical") { mode = "physical"; continue; }
        for (const flag of arg.slice(1)) {
          if (flag !== "L" && flag !== "P") throw new UsageError(`invalid option '${flag}'`);
          mode = flag === "P" ? "physical" : "logical";
        }
      }
      assertCommandRequirements(context, pwdRequirements, [mode]);
      if (mode === "physical" && context.fs.capabilitiesFor) assertCommandRequirements(context, pwdRequirements, [mode],
        await context.fs.capabilitiesFor(context.cwd, { signal: context.signal }));
      await output(context, `${mode === "physical" ? await context.fs.realpath(context.cwd, { signal: context.signal }) : context.cwd}\n`);
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
      const parsed = options(arguments_.args, "z", { zero: "z" }, true, index => { operands.push(index); });
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

export async function formatPrintf(context: CommandContext): Promise<CommandResult> {
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
        const escaped = escapeBytes(literal, false, false, unicode);
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
      if (specifier === "q") {
        const quoted = await quotePrintf(arguments_.bytes(suppliedIndex) ?? new Uint8Array(), unicode.utf8, context.signal);
        const bytes = quoted.subarray(0, precision);
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

const fastEchoDecoder = new TextDecoder();
export function tryFastEcho(args: readonly string[]): string | undefined {
  let newline = true;
  let escapes = false;
  let offset = 0;
  while (offset < args.length && /^-[neE]+$/u.test(args[offset]!)) {
    const flagArg = args[offset]!;
    for (let i = 1; i < flagArg.length; i++) {
      const ch = flagArg[i];
      if (ch === "n") newline = false;
      else escapes = ch === "e";
    }
    offset++;
  }
  const text = offset === 0 ? args.join(" ") : args.slice(offset).join(" ");
  if (text.includes("\0")) return undefined;
  if (!escapes) {
    return newline ? `${text}\n` : text;
  }
  // Unicode escapes depend on the command environment, which this path lacks.
  if (text.includes("\\u") || text.includes("\\U")) return undefined;
  const escaped = escapeBytes(text, true);
  for (let i = 0; i < escaped.bytes.byteLength; i++) {
    const b = escaped.bytes[i]!;
    if (b === 0 || b >= 128) return undefined;
  }
  const out = fastEchoDecoder.decode(escaped.bytes);
  return (newline && !escaped.stop) ? `${out}\n` : out;
}

export function tryFastPrintf(args: readonly string[], allowNull = false): string | undefined {
  const hasDoubleDash = args[0] === "--";
  const fmtIdx = hasDoubleDash ? 1 : 0;
  if (args.length <= fmtIdx) return undefined;
  const format = args[fmtIdx]!;
  if ((!hasDoubleDash && format.startsWith("-")) || format.length > 256) return undefined;
  let result = "";
  let argument = fmtIdx + 1;
  do {
    const before = argument;
    for (let offset = 0; offset < format.length;) {
      const ch = format.charCodeAt(offset);
      if (ch === 92) {
        const next = format.charCodeAt(offset + 1);
        if (next === 110) { result += "\n"; offset += 2; continue; }
        if (next === 116) { result += "\t"; offset += 2; continue; }
        if (next === 114) { result += "\r"; offset += 2; continue; }
        if (next === 92) { result += "\\"; offset += 2; continue; }
        if (next === 97) { result += "\x07"; offset += 2; continue; }
        if (next === 98) { result += "\b"; offset += 2; continue; }
        if (next === 102) { result += "\f"; offset += 2; continue; }
        if (next === 118) { result += "\v"; offset += 2; continue; }
        if (next === 101 || next === 69) { result += "\x1b"; offset += 2; continue; }
        if (next === 34) { result += "\""; offset += 2; continue; }
        if (next === 39) { result += "'"; offset += 2; continue; }
        if (next >= 48 && next <= 55) {
          let cur = offset + 1;
          const end = Math.min(format.length, cur + 3);
          let val = 0;
          while (cur < end && format.charCodeAt(cur) >= 48 && format.charCodeAt(cur) <= 55) {
            val = val * 8 + (format.charCodeAt(cur++) - 48);
          }
          const byte = val & 255;
          if ((!allowNull && byte === 0) || byte >= 128) return undefined;
          result += String.fromCharCode(byte);
          offset = cur;
          continue;
        }
        if (next === 120) {
          let cur = offset + 2;
          const end = Math.min(format.length, cur + 2);
          let val = 0;
          let digits = 0;
          while (cur < end) {
            const d = format.charCodeAt(cur);
            const n = d >= 48 && d <= 57 ? d - 48 : d >= 65 && d <= 70 ? d - 55 : d >= 97 && d <= 102 ? d - 87 : -1;
            if (n < 0) break;
            val = val * 16 + n;
            digits++;
            cur++;
          }
          if (digits === 0 || (!allowNull && val === 0) || val >= 128) return undefined;
          result += String.fromCharCode(val);
          offset = cur;
          continue;
        }
        return undefined;
      }
      if (ch !== 37) {
        let nextSpecial = offset + 1;
        while (nextSpecial < format.length) {
          const c = format.charCodeAt(nextSpecial);
          if (c === 37 || c === 92) break;
          nextSpecial++;
        }
        result += format.slice(offset, nextSpecial);
        offset = nextSpecial;
        continue;
      }
      const spec = format.charCodeAt(offset + 1);
      if (spec === 37) { result += "%"; offset += 2; continue; }
      let cur = offset + 1;
      let leftAlign = false;
      let zeroPad = false;
      while (cur < format.length) {
        const fc = format.charCodeAt(cur);
        if (fc === 45) { leftAlign = true; cur++; }
        else if (fc === 48) { zeroPad = true; cur++; }
        else break;
      }
      if (leftAlign) zeroPad = false;
      let width = 0;
      while (cur < format.length) {
        const dc = format.charCodeAt(cur);
        if (dc < 48 || dc > 57) break;
        width = width * 10 + (dc - 48);
        if (width > 128) return undefined;
        cur++;
      }
      let precision = -1;
      if (format.charCodeAt(cur) === 46) {
        cur++;
        precision = 0;
        while (cur < format.length) {
          const dc = format.charCodeAt(cur);
          if (dc < 48 || dc > 57) break;
          precision = precision * 10 + (dc - 48);
          if (precision > 128) return undefined;
          cur++;
        }
      }
      const conv = format.charCodeAt(cur);
      if (conv === 115 && !zeroPad) {
        const rawVal = args[argument++] ?? "";
        if (rawVal.includes("\0")) return undefined;
        let val = rawVal;
        let valByteLen = rawVal.length;
        if (precision >= 0 || width > 0) {
          let isAscii = true;
          for (let i = 0; i < rawVal.length; i++) {
            if (rawVal.charCodeAt(i) >= 128) { isAscii = false; break; }
          }
          if (isAscii) {
            if (precision >= 0 && precision < rawVal.length) {
              val = rawVal.slice(0, precision);
              valByteLen = val.length;
            }
          } else if (precision < 0) {
            valByteLen = utf8Encoder.encode(rawVal).byteLength;
          } else {
            return undefined;
          }
        }
        if (width > valByteLen) {
          const pad = " ".repeat(width - valByteLen);
          result += leftAlign ? val + pad : pad + val;
        } else {
          result += val;
        }
        offset = cur + 1;
        continue;
      }
      if (conv === 99 && !zeroPad) {
        const rawVal = args[argument++] ?? "";
        if (rawVal.length === 0) return undefined;
        const c0 = rawVal.charCodeAt(0);
        if (c0 === 0 || c0 >= 128) return undefined;
        const ch0 = rawVal[0]!;
        if (width > 1) {
          const pad = " ".repeat(width - 1);
          result += leftAlign ? ch0 + pad : pad + ch0;
        } else {
          result += ch0;
        }
        offset = cur + 1;
        continue;
      }
      if (conv === 100 || conv === 105) {
        const rawVal = args[argument++] ?? "0";
        if (rawVal.length === 0) return undefined;
        const val = rawVal;
        if (val.length > 15) return undefined;
        const first = val.charCodeAt(0);
        let start = 0;
        if (first === 45 || first === 43) {
          if (val.length === 1) return undefined;
          start = 1;
        }
        if (val.length - start > 1 && val.charCodeAt(start) === 48) return undefined;
        for (let i = start; i < val.length; i++) {
          const d = val.charCodeAt(i);
          if (d < 48 || d > 57) return undefined;
        }
        let numStr = val === "-0" ? "0" : first === 43 ? val.slice(1) : val;
        if (precision >= 0) {
          zeroPad = false;
          if (precision === 0 && numStr === "0") numStr = "";
          else if (numStr.charCodeAt(0) === 45) numStr = "-" + numStr.slice(1).padStart(precision, "0");
          else numStr = numStr.padStart(precision, "0");
        }
        if (width > numStr.length) {
          const padLen = width - numStr.length;
          if (leftAlign) {
            result += numStr + " ".repeat(padLen);
          } else if (zeroPad) {
            if (numStr.charCodeAt(0) === 45) {
              result += "-" + "0".repeat(padLen) + numStr.slice(1);
            } else {
              result += "0".repeat(padLen) + numStr;
            }
          } else {
            result += " ".repeat(padLen) + numStr;
          }
        } else {
          result += numStr;
        }
        offset = cur + 1;
        continue;
      }
      if (conv === 120 || conv === 88 || conv === 111 || conv === 117) {
        const rawVal = args[argument++] ?? "0";
        if (rawVal.length === 0) return undefined;
        const val = rawVal;
        if (val.length > 15) return undefined;
        if (val.length > 1 && val.charCodeAt(0) === 48) return undefined;
        for (let i = 0; i < val.length; i++) {
          const d = val.charCodeAt(i);
          if (d < 48 || d > 57) return undefined;
        }
        const n = Number(val);
        if (!Number.isSafeInteger(n) || n < 0) return undefined;
        let numStr = conv === 120 ? n.toString(16) : conv === 88 ? n.toString(16).toUpperCase() : conv === 111 ? n.toString(8) : String(n);
        if (precision >= 0) {
          zeroPad = false;
          numStr = precision === 0 && n === 0 ? "" : numStr.padStart(precision, "0");
        }
        if (width > numStr.length) {
          const padLen = width - numStr.length;
          if (leftAlign) {
            result += numStr + " ".repeat(padLen);
          } else if (zeroPad) {
            result += "0".repeat(padLen) + numStr;
          } else {
            result += " ".repeat(padLen) + numStr;
          }
        } else {
          result += numStr;
        }
        offset = cur + 1;
        continue;
      }
      return undefined;
    }
    if (argument <= before) break;
  } while (argument < args.length);
  return result;
}


export type FastPrintfSpecKind = "s" | "s_prec" | "c" | "d" | "u";

export function extractFastPrintfSpecifiers(format: string): readonly FastPrintfSpecKind[] | undefined {
  if (format.length > 256) return undefined;
  const specs: FastPrintfSpecKind[] = [];
  for (let offset = 0; offset < format.length;) {
    const ch = format.charCodeAt(offset);
    if (ch === 92) {
      const next = format.charCodeAt(offset + 1);
      if (
        next === 110 || next === 116 || next === 114 || next === 92 ||
        next === 97 || next === 98 || next === 102 || next === 118 ||
        next === 101 || next === 69 || next === 34 || next === 39
      ) {
        offset += 2;
        continue;
      }
      if (next >= 48 && next <= 55) {
        let cur = offset + 1;
        const end = Math.min(format.length, cur + 3);
        let val = 0;
        while (cur < end && format.charCodeAt(cur) >= 48 && format.charCodeAt(cur) <= 55) {
          val = val * 8 + (format.charCodeAt(cur++) - 48);
        }
        if ((val & 255) === 0 || (val & 255) >= 128) return undefined;
        offset = cur;
        continue;
      }
      if (next === 120) {
        let cur = offset + 2;
        const end = Math.min(format.length, cur + 2);
        let val = 0;
        let digits = 0;
        while (cur < end) {
          const d = format.charCodeAt(cur);
          const n = d >= 48 && d <= 57 ? d - 48 : d >= 65 && d <= 70 ? d - 55 : d >= 97 && d <= 102 ? d - 87 : -1;
          if (n < 0) break;
          val = val * 16 + n;
          digits++;
          cur++;
        }
        if (digits === 0 || val === 0 || val >= 128) return undefined;
        offset = cur;
        continue;
      }
      return undefined;
    }
    if (ch !== 37) {
      offset++;
      continue;
    }
    const spec = format.charCodeAt(offset + 1);
    if (spec === 37) {
      offset += 2;
      continue;
    }
    let cur = offset + 1;
    let leftAlign = false;
    let zeroPad = false;
    while (cur < format.length) {
      const fc = format.charCodeAt(cur);
      if (fc === 45) { leftAlign = true; cur++; }
      else if (fc === 48) { zeroPad = true; cur++; }
      else break;
    }
    if (leftAlign) zeroPad = false;
    let width = 0;
    while (cur < format.length) {
      const dc = format.charCodeAt(cur);
      if (dc < 48 || dc > 57) break;
      width = width * 10 + (dc - 48);
      if (width > 128) return undefined;
      cur++;
    }
    let precision = -1;
    if (format.charCodeAt(cur) === 46) {
      cur++;
      precision = 0;
      while (cur < format.length) {
        const dc = format.charCodeAt(cur);
        if (dc < 48 || dc > 57) break;
        precision = precision * 10 + (dc - 48);
        if (precision > 128) return undefined;
        cur++;
      }
    }
    const conv = format.charCodeAt(cur);
    if (conv === 115 && !zeroPad) {
      specs.push(precision < 0 ? "s" : "s_prec");
      offset = cur + 1;
      continue;
    }
    if (conv === 99 && !zeroPad) {
      specs.push("c");
      offset = cur + 1;
      continue;
    }
    if (conv === 100 || conv === 105) {
      specs.push("d");
      offset = cur + 1;
      continue;
    }
    if (conv === 120 || conv === 88 || conv === 111 || conv === 117) {
      specs.push("u");
      offset = cur + 1;
      continue;
    }
    return undefined;
  }
  return specs;
}

export const printfCommand = define("printf", formatPrintf, 1, 1);
