import { writeDiagnostic } from "../escaping.js";
import { basename, dirname, getCommandArguments, type CommandContext, type CommandDefinition, type CommandResult } from "../contracts/index.js";
import { decoder, define, escapeBytes, options, output, requireOperands, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { pwdRequirements } from "./portable-requirements.js";
import { printfInteger } from "./printf-integer.js";
import { printfHex } from "./printf-hex.js";
import { parsePrintfFloat } from "./printf-float.js";
import { printfDecimal } from "./printf-decimal.js";

export function basicCommands(): CommandDefinition[] {
  return [
    define("true", () => ({ exitCode: 0 })),
    define("false", () => ({ exitCode: 1 })),
    define("echo", async (context) => {
      const arguments_ = getCommandArguments(context);
      let newline = true;
      let escapes = false;
      let offset = 0;
      while (/^-[neE]+$/u.test(arguments_.args[offset] ?? "")) {
        for (const flag of arguments_.args[offset]!.slice(1)) {
          if (flag === "n") newline = false;
          else escapes = flag === "e";
        }
        offset++;
      }
      const joined = arguments_.slice(offset).join(" ");
      const text = typeof joined === "string" ? joined : arguments_.withValues([joined]).bytes(0)!;
      if (escapes) {
        const escaped = escapeBytes(text, true);
        await output(context, escaped.bytes);
        if (escaped.stop) newline = false;
      } else await output(context, text);
      if (newline) await output(context, "\n");
      return { exitCode: 0 };
    }),
    define("pwd", async (context) => {
      const parsed = options(context.args, "LP");
      requireOperands(parsed.operands, 0, 0);
      const mode = parsed.flags.has("P") ? "physical" : "logical";
      assertCommandRequirements(context, pwdRequirements, [mode]);
      if (mode === "physical" && context.fs.capabilitiesFor) assertCommandRequirements(context, pwdRequirements, [mode],
        await context.fs.capabilitiesFor(context.cwd, { signal: context.signal }));
      await output(context, `${parsed.flags.has("P") ? await context.fs.realpath(context.cwd, { signal: context.signal }) : context.cwd}\n`);
      return { exitCode: 0 };
    }),
    define("basename", async (context) => {
      const parsed = options(context.args, "as:z", { multiple: "a", suffix: "s", zero: "z" });
      const multiple = parsed.flags.has("a") || parsed.flags.has("s");
      requireOperands(parsed.operands, 1, multiple ? Infinity : 2);
      const suffix = value(parsed, "s") ?? (multiple ? undefined : parsed.operands[1]);
      for (const operand of multiple ? parsed.operands : parsed.operands.slice(0, 1)) {
        let result = /^\/+$/u.test(operand) ? "/" : basename(operand);
        if (suffix && result !== suffix && result.endsWith(suffix)) result = result.slice(0, -suffix.length);
        await output(context, result + (parsed.flags.has("z") ? "\0" : "\n"));
      }
      return { exitCode: 0 };
    }),
    define("dirname", async (context) => {
      const parsed = options(context.args, "z", { zero: "z" });
      requireOperands(parsed.operands);
      for (const operand of parsed.operands) await output(context, dirname(operand.replace(/\/+$/u, "") || (operand.startsWith("/") ? "/" : ".")) + (parsed.flags.has("z") ? "\0" : "\n"));
      return { exitCode: 0 };
    }),
    printfCommand,
  ].map(command => ({ ...command, filesystemRequirements: command.name === "pwd" ? pwdRequirements : [] }));
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
      let tokenEnd = offset + 1;
      if (rawFormat) while (tokenEnd < rawFormat.length && (rawFormat[tokenEnd]! >= 48 && rawFormat[tokenEnd]! <= 57 || [32, 35, 42, 43, 45, 46, 104, 108, 76, 106, 122, 116].includes(rawFormat[tokenEnd]!))) tokenEnd++;
      const fragment = rawFormat ? decoder.decode(rawFormat.subarray(offset, tokenEnd + 1)) : format.slice(offset);
      const match = /^%([-+ #0]*)(\d+|\*)?(?:\.(\d*|\*))?(?:hh|ll|[hlLjzt])?([sbqcdiouxXfFeEgGaA])/u.exec(fragment);
      if (!match) throw new UsageError(`invalid format near '${fragment}'`);
      offset += match[0].length;
      let flags = match[1]!;
      const dynamic = (): number => {
        const index = argument++;
        const token = args[index] ?? "0";
        const parsed = token.startsWith("'") || token.startsWith('"') ? quotedNumber(index) : Number(token);
        if (!Number.isSafeInteger(parsed)) throw new UsageError(`invalid width or precision '${token}'`);
        return parsed;
      };
      const suppliedWidth = match[2] === "*" ? dynamic() : Number(match[2] ?? 0);
      if (suppliedWidth < 0) flags += "-";
      const width = Math.abs(suppliedWidth);
      const suppliedPrecision = match[3] === "*" ? dynamic() : match[3] === undefined ? undefined : Number(match[3]);
      const precision = suppliedPrecision !== undefined && suppliedPrecision < 0 ? undefined : suppliedPrecision;
      if (width > 1_000_000 || (precision ?? 0) > 1000) throw new UsageError("format width or precision is too large");
      const specifier = match[4]!;
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
        const bytes = arguments_.bytes(suppliedIndex) ?? new Uint8Array();
        if (bytes.some(byte => byte < 32 || byte === 127 || byte >= 128)) {
          const controls: Record<number, string> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 27: "\\E" };
          text = "$'";
          for (const byte of bytes) {
            if (controls[byte]) text += controls[byte];
            else if (byte < 32 || byte === 127 || byte >= 128) text += `\\${byte.toString(8).padStart(3, "0")}`;
            else if (byte === 39 || byte === 92) text += `\\${String.fromCharCode(byte)}`;
            else text += String.fromCharCode(byte);
          }
          text += "'";
        } else text = supplied === "" ? "''" : supplied.replace(/[^a-zA-Z0-9_./-]/gu, character => `\\${character}`);
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

export const printfCommand = define("printf", formatPrintf);
