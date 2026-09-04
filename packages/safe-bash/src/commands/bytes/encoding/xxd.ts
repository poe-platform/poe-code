import type { CommandContext, CommandDefinition } from "../../../contracts/index.js";
import { define, options, output, requireOperands, UsageError } from "../../internal.js";
import { addOffset, numeric, range, rows, sources, validatedOption } from "./shared.js";

function hexDigit(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

async function reversePlain(context: CommandContext, files: readonly string[], maxInputBytes: number): Promise<void> {
  let high = -1;
  for await (const chunk of sources(context, files, maxInputBytes)) {
    const pending: number[] = [];
    let invalid = false;
    for (const byte of chunk) {
      if (byte === 32 || (byte >= 9 && byte <= 13)) continue;
      const digit = hexDigit(byte);
      if (digit < 0) { invalid = true; break; }
      if (high < 0) high = digit;
      else { pending.push((high << 4) | digit); high = -1; }
    }
    if (pending.length) await output(context, Uint8Array.from(pending));
    if (invalid) throw new Error("invalid input: expected hexadecimal digits or ASCII whitespace");
  }
  if (high >= 0) throw new Error("invalid input: unmatched hexadecimal digit");
}

async function reverseNormal(context: CommandContext, files: readonly string[], columns: number, maxInputBytes: number): Promise<void> {
  let line = "";
  let offset = 0;
  const emitLine = async (): Promise<void> => {
    if (!line.trim()) { line = ""; return; }
    const match = /^([0-9a-fA-F]{1,14}):[ \t]?(.*)$/u.exec(line.replace(/\r$/u, ""));
    if (!match) throw new Error("invalid input: expected hexadecimal address and colon");
    const address = Number.parseInt(match[1]!, 16);
    if (!Number.isSafeInteger(address) || address !== offset) throw new Error("invalid input: reverse requires contiguous addresses starting at zero");
    const field = match[2]!.split(/ {2,}|\t/u, 1)[0]!;
    if (!/^(?:[0-9a-fA-F]{2})+(?: (?:[0-9a-fA-F]{2})+)*$/u.test(field)) throw new Error("invalid input: malformed hexadecimal data field");
    const digits = field.replaceAll(" ", "");
    if (digits.length > columns * 2) throw new Error("invalid input: data exceeds configured columns");
    const bytes = new Uint8Array(digits.length / 2);
    for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    offset = addOffset(offset, bytes.length);
    await output(context, bytes);
    line = "";
  };
  for await (const chunk of sources(context, files, maxInputBytes)) {
    for (const byte of chunk) {
      if (byte === 10) await emitLine();
      else {
        if (line.length >= 4096) throw new Error("invalid input: reverse line exceeds 4096 bytes");
        line += String.fromCharCode(byte);
      }
    }
  }
  if (line) await emitLine();
}

export function createXxdCommand(maxInputBytes: number): CommandDefinition {
  return define("xxd", async context => {
    const aliases: Record<string, string> = { "-ps": "-p", "-plain": "-p", "-postscript": "-p", "-revert": "-r", "-cols": "-c", "-groupsize": "-g", "-len": "-l" };
    let ended = false;
    const args = context.args.map(argument => {
      if (ended) return argument;
      if (argument === "--") ended = true;
      return aliases[argument] ?? argument;
    });
    const parsed = options(args, "prduc:g:l:s:o:");
    requireOperands(parsed.operands, 0, 2);
    if (parsed.operands[1] !== undefined && parsed.operands[1] !== "-") throw new UsageError("output-file operands are not supported; output is stdout only");
    const files = parsed.operands.slice(0, 1);
    const plain = parsed.flags.has("p");
    const reverse = parsed.flags.has("r");
    const columns = validatedOption(parsed, "c", text => {
      const number = numeric(text);
      if ((!plain && (number < 1 || number > 256)) || (plain && number > 4096)) throw new UsageError("columns must be 1..256 (plain: 0..4096)");
      return number;
    }, plain ? 30 : 16);
    const group = validatedOption(parsed, "g", text => {
      const number = numeric(text);
      if (number > 256) throw new UsageError("group size must be 0..256");
      return number;
    }, 2);
    const skip = validatedOption(parsed, "s", numeric, 0);
    const count = validatedOption(parsed, "l", numeric, Infinity);
    const displacement = validatedOption(parsed, "o", numeric, 0);
    if (reverse && ["s", "l", "o", "d"].some(flag => parsed.flags.has(flag))) throw new UsageError("reverse does not support seek, length, displacement, or decimal addresses");
    if (reverse) {
      if (plain) await reversePlain(context, files, maxInputBytes);
      else await reverseNormal(context, files, columns, maxInputBytes);
      return { exitCode: 0 };
    }
    let offset = addOffset(skip, displacement);
    const source = range(sources(context, files, maxInputBytes), skip, count);
    let any = false;
    for await (const row of rows(source, plain && !columns ? 4096 : columns)) {
      any = true;
      let data = "";
      let ascii = "";
      for (let index = 0; index < row.length; index++) {
        if (!plain && group && index && index % group === 0) data += " ";
        const byte = row[index]!;
        data += byte.toString(16).padStart(2, "0");
        ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
      }
      if (parsed.flags.has("u")) data = data.toUpperCase();
      if (plain) await output(context, data + (columns ? "\n" : ""));
      else {
        const width = columns * 2 + (group ? Math.floor((columns - 1) / group) : 0);
        const address = offset.toString(parsed.flags.has("d") ? 10 : 16).padStart(8, "0");
        await output(context, `${address}: ${data.padEnd(width)}  ${ascii}\n`);
      }
      offset = addOffset(offset, row.length);
    }
    if (plain && !columns && any) await output(context, "\n");
    return { exitCode: 0 };
  });
}
