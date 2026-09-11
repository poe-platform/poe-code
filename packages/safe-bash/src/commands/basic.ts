import { writeDiagnostic } from "../escaping.js";
import { basename, dirname, getCommandArguments, type CommandContext, type CommandDefinition, type CommandResult } from "../contracts/index.js";
import { decoder, define, escapeBytes, options, output, requireOperands, UsageError, value } from "./internal.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { pwdRequirements } from "./portable-requirements.js";

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
  do {
    const before = argument;
    for (let offset = 0; offset < formatLength && !stopped;) {
      if (rawFormat ? rawFormat[offset] !== 37 : format[offset] !== "%") {
        const end = rawFormat ? rawFormat.indexOf(37, offset) : format.indexOf("%", offset);
        const limit = end < 0 ? formatLength : end;
        const literal = rawFormat ? rawFormat.subarray(offset, limit) : format.slice(offset, limit);
        const escaped = escapeBytes(literal);
        await output(context, escaped.bytes);
        stopped = escaped.stop;
        offset += literal.length;
        continue;
      }
      if (rawFormat ? rawFormat[offset + 1] === 37 : format[offset + 1] === "%") { await output(context, "%"); offset += 2; continue; }
      let tokenEnd = offset + 1;
      if (rawFormat) while (tokenEnd < rawFormat.length && (rawFormat[tokenEnd]! >= 48 && rawFormat[tokenEnd]! <= 57 || [32, 35, 43, 45, 46].includes(rawFormat[tokenEnd]!))) tokenEnd++;
      const fragment = rawFormat ? decoder.decode(rawFormat.subarray(offset, tokenEnd + 1)) : format.slice(offset);
      const match = /^%([-+ #0]*)(\d+)?(?:\.(\d+))?([sbqcdiouxXfFeEgG])/u.exec(fragment);
      if (!match) throw new UsageError(`invalid format near '${fragment}'`);
      offset += match[0].length;
      const flags = match[1]!;
      const width = Number(match[2] ?? 0);
      const precision = match[3] === undefined ? undefined : Number(match[3]);
      if (width > 1_000_000 || (precision ?? 0) > 1000) throw new UsageError("format width or precision is too large");
      const specifier = match[4]!;
      if (/[fFeEgG]/u.test(specifier) && (precision ?? 0) > 100) throw new UsageError("floating-point precision is too large");
      const suppliedIndex = argument++;
      const supplied = args[suppliedIndex] ?? "";
      let text: string;
      if (specifier === "b" || specifier === "s") {
        const suppliedValue = arguments_.values[suppliedIndex] ?? "";
        const raw = specifier === "b" && typeof suppliedValue === "string" ? suppliedValue : arguments_.bytes(suppliedIndex) ?? new Uint8Array();
        const escaped = specifier === "b" ? escapeBytes(raw, true, true) : { bytes: raw as Uint8Array, stop: false };
        const bytes = escaped.bytes.subarray(0, precision);
        const padding = " ".repeat(Math.max(0, width - bytes.length));
        if (!flags.includes("-")) await output(context, padding);
        await output(context, bytes);
        if (flags.includes("-")) await output(context, padding);
        stopped = escaped.stop;
        continue;
      }
      if (specifier === "q") text = supplied === "" ? "''" : supplied.replace(/[^a-zA-Z0-9_./-]/gu, character => character === "\n" ? "$'\\n'" : `\\${character}`);
      else if (specifier === "c") text = supplied ? String.fromCodePoint(supplied.codePointAt(0)!) : "\0";
      else {
        let number = supplied === "" ? 0 : /^["']/u.test(supplied) ? supplied.codePointAt(1) ?? 0 : Number(supplied);
        if (/^[+-]0[xX][0-9a-fA-F]+$/u.test(supplied.trim())) {
          number = Number(supplied.trim().slice(1)) * (supplied.trim().startsWith("-") ? -1 : 1);
        }
        if (/^[+-]?0[0-9]+$/u.test(supplied) && !/[fFeEgG]/u.test(specifier)) {
          if (/[89]/u.test(supplied)) number = NaN;
          else number = parseInt(supplied.replace(/^[+-]?0/u, ""), 8) * (supplied.startsWith("-") ? -1 : 1);
        }
        if (!Number.isFinite(number)) {
          await writeDiagnostic(context.stderr, `printf: '${supplied}': invalid number\n`, context.signal);
          exitCode = 1; number = 0;
        }
        if (/[fF]/u.test(specifier)) text = number.toFixed(precision ?? 6);
        else if (/[eE]/u.test(specifier)) text = number.toExponential(precision ?? 6).replace(/e([+-])(\d)$/u, "e$10$2");
        else if (/[gG]/u.test(specifier)) text = Number(number.toPrecision(Math.max(1, precision ?? 6))).toString();
        else {
          const radix = /[xX]/u.test(specifier) ? 16 : specifier === "o" ? 8 : 10;
          const unsigned = /[uoxX]/u.test(specifier);
          let integral: bigint;
          try {
            const token = supplied.trim();
            if (!token || /^["']/u.test(token)) integral = BigInt(Math.trunc(number));
            else {
              const magnitude = token.replace(/^[+-]/u, "");
              if (!/^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)$/u.test(magnitude)) throw new Error("invalid integer");
              integral = BigInt(/^0[0-7]+$/u.test(magnitude) ? `0o${magnitude.slice(1)}` : magnitude) * (token.startsWith("-") ? -1n : 1n);
            }
          } catch {
            integral = 0n;
            if (exitCode === 0) await writeDiagnostic(context.stderr, `printf: '${supplied}': invalid integer\n`, context.signal);
            exitCode = 1;
          }
          text = (unsigned ? BigInt.asUintN(64, integral) : integral).toString(radix);
          if (precision === 0 && integral === 0n) text = "";
          if (precision !== undefined) text = text.startsWith("-") ? `-${text.slice(1).padStart(precision, "0")}` : text.padStart(precision, "0");
          if (flags.includes("#")) {
            if (radix === 16 && integral !== 0n) text = "0x" + text;
            else if (radix === 8 && !text.startsWith("0")) text = "0" + text;
          }
        }
        if (/[XFEG]/u.test(specifier)) text = text.toUpperCase();
        if (number >= 0 && /[difFeEgG]/u.test(specifier)) text = (flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + text;
      }
      if (flags.includes("-")) text = text.padEnd(width, " ");
      else if (flags.includes("0") && /[diouxXfFeEgG]/u.test(specifier)
        && (precision === undefined || /[fFeEgG]/u.test(specifier))) {
        const prefix = /^[+ -]|^0[xX]/u.exec(text)?.[0] ?? "";
        text = prefix + text.slice(prefix.length).padStart(Math.max(0, width - prefix.length), "0");
      } else text = text.padStart(width, " ");
      await output(context, text);
    }
    if (argument === before) break;
  } while (argument < args.length && !stopped);
  return { exitCode };
}

export const printfCommand = define("printf", formatPrintf);
