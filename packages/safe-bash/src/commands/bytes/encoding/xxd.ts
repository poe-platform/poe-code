import { PublicDiagnostic } from "../../../diagnostics.js";
import type { CommandContext, CommandDefinition } from "../../../contracts/index.js";
import { define, options, output, requireOperands, UsageError } from "../../internal.js";
import { addOffset, numeric, range, rows, sources, validatedOption } from "./shared.js";

const HEX_LOWER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const HEX_UPPER = HEX_LOWER.map(s => s.toUpperCase());
const BIN_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(2).padStart(8, "0"));
const ASCII_CHAR = Array.from({ length: 256 }, (_, i) => (i >= 32 && i <= 126 ? String.fromCharCode(i) : "."));

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
    for (const byte of chunk) {
      if (byte === 32 || (byte >= 9 && byte <= 13)) continue;
      const digit = hexDigit(byte);
      if (digit < 0) { high = -1; continue; }
      if (high < 0) high = digit;
      else { pending.push((high << 4) | digit); high = -1; }
    }
    if (pending.length) await output(context, Uint8Array.from(pending));
  }
}

async function reverseNormal(context: CommandContext, files: readonly string[], columns: number, maxInputBytes: number): Promise<void> {
  let line = "";
  let offset = 0;
  const outBuf = new Uint8Array(8192);
  let outUsed = 0;
  let flushedFirst = false;
  const flushOut = async () => {
    if (outUsed > 0) {
      flushedFirst = true;
      const chunk = outBuf.slice(0, outUsed);
      outUsed = 0;
      await output(context, chunk);
    }
  };
  const emitLine = async (): Promise<void> => {
    if (!line.trim()) { line = ""; return; }
    const colon = line.indexOf(":");
    if (colon < 1 || colon > 14) throw new PublicDiagnostic("invalid input: expected hexadecimal address and colon");
    let address = 0;
    for (let index = 0; index < colon; index++) {
      const digit = hexDigit(line.charCodeAt(index));
      if (digit < 0) throw new PublicDiagnostic("invalid input: expected hexadecimal address and colon");
      address = address * 16 + digit;
    }
    if (!Number.isSafeInteger(address) || address !== offset) throw new PublicDiagnostic("invalid input: reverse requires contiguous addresses starting at zero");
    const pending: number[] = [];
    let high = -1;
    let spaces = 0;
    for (let index = colon + 1; index < line.length; index++) {
      const byte = line.charCodeAt(index);
      if (byte === 32 || byte === 9 || byte === 13) {
        spaces++;
        if (pending.length && spaces >= 2) break;
        continue;
      }
      const digit = hexDigit(byte);
      if (digit < 0) break;
      spaces = 0;
      if (high < 0) high = digit;
      else {
        pending.push((high << 4) | digit);
        high = -1;
        if (pending.length === columns) break;
      }
    }
    if (!pending.length) throw new PublicDiagnostic("invalid input: malformed hexadecimal data field");
    offset = addOffset(offset, pending.length);
    if (outUsed + pending.length > outBuf.length) await flushOut();
    for (let i = 0; i < pending.length; i++) outBuf[outUsed++] = pending[i]!;
    if (!flushedFirst || outUsed >= outBuf.length) await flushOut();
    line = "";
  };
  for await (const chunk of sources(context, files, maxInputBytes)) {
    for (const byte of chunk) {
      if (byte === 10) await emitLine();
      else {
        line += String.fromCharCode(byte);
      }
    }
  }
  if (line) await emitLine();
  await flushOut();
}

export function createXxdCommand(maxInputBytes: number): CommandDefinition {
  return define("xxd", async context => {
    const aliases: Record<string, string> = { "-ps": "-p", "-plain": "-p", "-postscript": "-p", "-revert": "-r", "-cols": "-c", "-groupsize": "-g", "-len": "-l", "-bits": "-b", "-include": "-i", "-name": "-n" };
    let ended = false;
    const args = context.args.map(argument => {
      if (ended) return argument;
      if (argument === "--") ended = true;
      return aliases[argument] ?? argument;
    });
    const parsed = options(args, "prdubiec:g:l:s:o:n:");
    requireOperands(parsed.operands, 0, 2);
    if (parsed.operands[1] !== undefined && parsed.operands[1] !== "-") throw new UsageError("output-file operands are not supported; output is stdout only");
    const files = parsed.operands.slice(0, 1);
    const plain = parsed.flags.has("p");
    const reverse = parsed.flags.has("r");
    const binary = parsed.flags.has("b");
    const include = parsed.flags.has("i");
    const littleEndian = parsed.flags.has("e");
    if ((plain && (binary || include || littleEndian)) || (littleEndian && (binary || include)) || (binary && include)) throw new UsageError("incompatible display modes");
    if (reverse && (binary || include || littleEndian)) throw new UsageError("cannot revert this type of hexdump");
    const columns = validatedOption(parsed, "c", text => {
      const number = numeric(text);
      if (!plain && number < 1) throw new UsageError("columns must be positive (plain: nonnegative)");
      return number;
    }, plain ? 30 : include ? 12 : binary ? 6 : 16);
    const group = validatedOption(parsed, "g", text => {
      const number = numeric(text);
      return number;
    }, littleEndian ? 4 : binary ? 1 : 2);
    if (littleEndian && group && !Number.isInteger(Math.log2(group))) throw new UsageError("number of octets per group must be a power of 2 with -e");
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
    let includeLength = 0;
    let includeRow = "";
    const includeName = parsed.values.get("n")?.at(-1) ?? (files[0] !== "-" ? files[0] : undefined);
    let identifier = "";
    if (includeName !== undefined) {
      for (const character of includeName) {
        const code = character.charCodeAt(0);
        identifier += (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ? character : "_";
      }
      if (identifier[0] && identifier[0] >= "0" && identifier[0] <= "9") identifier = "__" + identifier;
    }
    const upper = parsed.flags.has("u");
    const hexTable = upper ? HEX_UPPER : HEX_LOWER;
    const byteTable = binary ? BIN_TABLE : hexTable;
    const decimalAddress = parsed.flags.has("d");
    const octets = Math.min(group || columns, columns);
    const width = littleEndian
      ? Math.ceil(columns / octets) * (octets * 2 + 1) - 1
      : columns * (binary ? 8 : 2) + (group ? Math.floor((columns - 1) / group) : 0);
    let outBuf = "";
    let flushedFirst = false;
    const writeOut = async (text: string) => {
      outBuf += text;
      if (!flushedFirst || outBuf.length >= 8192) {
        flushedFirst = true;
        const chunk = outBuf;
        outBuf = "";
        await output(context, chunk);
      }
    };
    if (include && includeName !== undefined) await writeOut(`unsigned char ${identifier}[] = {\n`);
    for await (const row of rows(source, plain && !columns ? 4096 : columns)) {
      any = true;
      if (include) {
        if (includeRow) await writeOut(includeRow + ",\n");
        const includePrefix = upper ? "0X" : "0x";
        includeRow = "  " + Array.from(row, byte => includePrefix + hexTable[byte]!).join(", ");
        includeLength = addOffset(includeLength, row.length);
        continue;
      }
      let data = "";
      let ascii = "";
      for (let index = 0; index < row.length; index++) {
        if (!plain && !littleEndian && group && index && index % group === 0) data += " ";
        const byte = row[index]!;
        if (!littleEndian) data += byteTable[byte]!;
        if (!plain) ascii += ASCII_CHAR[byte]!;
      }
      if (littleEndian) {
        for (let start = 0; start < row.length; start += octets) {
          if (start) data += " ";
          for (let index = start + octets - 1; index >= start; index--) {
            data += index < row.length ? hexTable[row[index]!]! : "  ";
          }
        }
      }
      if (plain) await writeOut(data + (columns ? "\n" : ""));
      else {
        const address = offset.toString(decimalAddress ? 10 : 16).padStart(8, "0");
        await writeOut(`${address}: ${data.padEnd(width)}  ${ascii}\n`);
      }
      offset = addOffset(offset, row.length);
    }
    if (include) {
      if (includeRow) await writeOut(includeRow + "\n");
      if (includeName !== undefined) await writeOut(`};\nunsigned int ${identifier}_len = ${includeLength};\n`);
    }
    if (plain && !columns && any) await writeOut("\n");
    if (outBuf) await output(context, outBuf);
    return { exitCode: 0 };
  });
}
