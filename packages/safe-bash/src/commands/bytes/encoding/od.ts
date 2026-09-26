import type { CommandDefinition } from "../../../contracts/index.js";
import { define, options, output, UsageError } from "../../internal.js";
import { addOffset, numeric, range, rows, sources, validatedOption } from "./shared.js";

interface Format { readonly kind: string; readonly size: number; readonly printable?: boolean }

function formats(text: string): Format[] {
  const result: Format[] = [];
  const sizeMap: Record<string, number> = { C: 1, S: 2, I: 4, L: 8, F: 4, D: 8 };
  for (let offset = 0; offset < text.length;) {
    const kind = text[offset++]!;
    let size = 1;
    if (kind !== "a" && kind !== "c") {
      if (!"doux".includes(kind) && kind !== "f") {
        throw new UsageError(`unsupported type '${text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8`);
      }
      const next = text[offset];
      if (next !== undefined && ((next >= "0" && next <= "9") || Object.hasOwn(sizeMap, next))) {
        size = sizeMap[next] ?? Number(next);
        offset++;
      } else {
        size = kind === "f" ? 8 : 4;
      }
      if (!(kind === "f" ? [4, 8] : [1, 2, 4, 8]).includes(size)) {
        throw new UsageError(`unsupported type '${text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8`);
      }
    }
    let printable = false;
    if (text[offset] === "z") { printable = true; offset++; }
    result.push({ kind, size, ...(printable ? { printable: true } : {}) });
    if (result.length > 16) throw new UsageError("at most 16 output types are supported");
  }
  if (!result.length) throw new UsageError("empty output type");
  return result;
}

function floating(value: number, size: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (Object.is(value, -0)) return "-0";
  // GNU starts normal values at FLT_DIG/DBL_DIG, increasing until they round back.
  const minimumNormal = size === 4 ? 2 ** -126 : 2 ** -1022;
  let precision = Math.abs(value) < minimumNormal ? 1 : size === 4 ? 6 : 15;
  const maximum = size === 4 ? 9 : 17;
  while (precision < maximum) {
    const parsed = Number(value.toPrecision(precision));
    if (Object.is(size === 4 ? Math.fround(parsed) : parsed, value)) break;
    precision++;
  }
  const rounded = Number(value.toPrecision(precision));
  const exponent = rounded === 0 ? 0 : Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= precision) {
    const [mantissa, power] = rounded.toExponential().split("e");
    const numericPower = Number(power);
    return `${mantissa}e${numericPower < 0 ? "-" : "+"}${String(Math.abs(numericPower)).padStart(2, "0")}`;
  }
  return String(rounded);
}

const OD_ESCAPES: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
const OD_NAMES = ["nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "nl", "vt", "ff", "cr", "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc", "fs", "gs", "rs", "us", "sp"];
const OD_HEX1_TABLE = Array.from({ length: 256 }, (_, i) => " " + i.toString(16).padStart(2, "0"));
const OD_OCT1_TABLE = Array.from({ length: 256 }, (_, i) => " " + i.toString(8).padStart(3, "0"));
const OD_ASCII_CHAR = Array.from({ length: 256 }, (_, i) => (i >= 32 && i <= 126 ? String.fromCharCode(i) : "."));

function formatRow(row: Uint8Array, format: Format, bigEndian: boolean): string {
  let text = "";
  if (format.size === 1 && (format.kind === "x" || format.kind === "o")) {
    const table = format.kind === "x" ? OD_HEX1_TABLE : OD_OCT1_TABLE;
    for (let i = 0; i < row.length; i++) text += table[row[i]!]!;
    if (format.printable) {
      let ascii = "";
      for (let i = 0; i < row.length; i++) ascii += OD_ASCII_CHAR[row[i]!]!;
      text += `  >${ascii}<`;
    }
    return text;
  }
  const escapes = OD_ESCAPES;
  const names = OD_NAMES;
  for (let offset = 0; offset < row.length; offset += format.size) {
    if (format.kind === "a") {
      const byte = row[offset]! & 127;
      text += ` ${(names[byte] ?? (byte === 127 ? "del" : String.fromCharCode(byte))).padStart(3)}`;
      continue;
    }
    if (format.kind === "f") {
      const bytes = new Uint8Array(format.size);
      bytes.set(row.subarray(offset, offset + format.size));
      const view = new DataView(bytes.buffer);
      const value = format.size === 4 ? view.getFloat32(0, !bigEndian) : view.getFloat64(0, !bigEndian);
      text += ` ${floating(value, format.size).padStart(format.size === 4 ? 15 : 24)}`;
      continue;
    }
    if (format.kind === "c") {
      const byte = row[offset]!;
      const character = escapes[byte] ?? (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : byte.toString(8).padStart(3, "0"));
      text += ` ${character.padStart(3)}`;
      continue;
    }
    let number = 0n;
    for (let index = 0; index < format.size; index++) {
      const byte = row[offset + index] ?? 0;
      const shift = bigEndian ? format.size - index - 1 : index;
      number |= BigInt(byte) << BigInt(shift * 8);
    }
    const bits = format.size * 8;
    if (format.kind === "d" && number >= 1n << BigInt(bits - 1)) number -= 1n << BigInt(bits);
    const base = format.kind === "o" ? 8 : format.kind === "x" ? 16 : 10;
    const width = format.kind === "o" ? Math.ceil(bits / 3) : format.kind === "x" ? bits / 4
      : format.kind === "d" ? (1n << BigInt(bits - 1)).toString().length + 1 : ((1n << BigInt(bits)) - 1n).toString().length;
    text += ` ${number.toString(base).padStart(width, base === 10 ? " " : "0")}`;
  }
  if (format.printable) {
    let ascii = "";
    for (const byte of row) ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
    text += `  >${ascii}<`;
  }
  return text;
}

export function createOdCommand(maxInputBytes: number): CommandDefinition {
  return define("od", async context => {
    const aliases: Record<string, string> = { a: "a", b: "o1", B: "o2", c: "c", d: "u2", D: "u4", e: "f8", f: "f4", F: "f8", h: "x2", i: "d4", I: "d8", l: "d8", L: "d8", o: "o2", O: "o4", s: "d2", x: "x2", X: "x4" };
    const rewritten: string[] = [];
    let ended = false;
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) { rewritten.push(argument); continue; }
      if (argument === "--") { ended = true; rewritten.push(argument); continue; }
      if (argument.startsWith("--")) {
        if (argument === "--strings") { rewritten.push("-S3"); continue; }
        if (argument === "--width") {
          const next = context.args[index + 1];
          if (next && [...next].every(c => c >= "0" && c <= "9")) { rewritten.push(`-w${next}`); index++; } else rewritten.push("-w32");
          continue;
        }
        rewritten.push(argument);
        if (!argument.includes("=") && ["--address-radix", "--skip-bytes", "--read-bytes", "--format", "--type", "--endian"].includes(argument)) {
          const parameter = context.args[++index];
          if (parameter === undefined) throw new UsageError(`option '${argument}' requires an argument`);
          rewritten.push(parameter);
        }
        continue;
      }
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (flag === "S") {
          let parameter = argument.slice(offset + 1);
          const next = context.args[index + 1];
          if (!parameter && next && [...next].every(character => character >= "0" && character <= "9")) {
            parameter = next;
            index++;
          }
          rewritten.push(`-S${parameter || "3"}`);
          break;
        }
        if (flag === "e" && (argument.slice(offset + 1) === "big" || argument.slice(offset + 1) === "little" || context.args[index + 1] === "big" || context.args[index + 1] === "little")) throw new UsageError("use --endian=little or --endian=big; -e is unsupported");
        if (flag === "w") {
          let parameter = argument.slice(offset + 1);
          const next = context.args[index + 1];
          if (!parameter && next && [...next].every(character => character >= "0" && character <= "9")) { parameter = next; index++; }
          rewritten.push(`-w${parameter || "32"}`);
          break;
        }
        if (aliases[flag]) rewritten.push(`-t${aliases[flag]}`);
        else if ("AjNt".includes(flag)) {
          const parameter = argument.slice(offset + 1) || context.args[++index];
          if (parameter === undefined) throw new UsageError(`option '-${flag}' requires an argument`);
          rewritten.push(`-${flag}`, parameter);
          break;
        } else rewritten.push(`-${flag}`);
      }
    }
    const parsed = options(rewritten, "vA:j:N:t:w:S:", { "address-radix": "A", "skip-bytes": "j", "read-bytes": "N", format: "t", type: "t", width: "w", endian: "endian:", "output-duplicates": "v", strings: "S" });
    const radix = validatedOption(parsed, "A", text => {
      if (!["d", "o", "x", "n"].includes(text)) throw new UsageError("address radix must be d, o, x, or n");
      return text;
    }, "o");
    const endian = validatedOption(parsed, "endian", text => {
      if (text !== "little" && text !== "big") throw new UsageError("endian must be little or big");
      return text;
    }, "little");
    const selected = (parsed.values.get("t") ?? ["o2"]).flatMap(formats);
    const width = validatedOption(parsed, "w", text => {
      const number = numeric(text);
      if (number < 1 || selected.some(format => number % format.size !== 0)) throw new UsageError("width must be positive and a multiple of each output type size");
      return number;
    }, 16);
    const skip = validatedOption(parsed, "j", text => numeric(text, true), 0);
    const count = validatedOption(parsed, "N", text => numeric(text, true), Infinity);
    const minimumStringLength = validatedOption(parsed, "S", text => {
      const number = numeric(text);
      if (number < 1) throw new UsageError("minimum string length must be positive");
      return number;
    }, 3);
    let offset = skip;
    let previous: Uint8Array | undefined;
    let suppressed = false;
    const address = (): string => radix === "n" ? "" : offset.toString(radix === "o" ? 8 : radix === "x" ? 16 : 10).padStart(radix === "x" ? 6 : 7, "0");
    if (parsed.values.has("S")) {
      let text = "";
      let length = 0;
      let start = "";
      for await (const chunk of range(sources(context, parsed.operands, maxInputBytes), skip, count)) {
        for (const byte of chunk) {
          if (byte >= 32 && byte <= 126) {
            if (!length) start = address();
            text += String.fromCharCode(byte);
            length++;
          } else {
            if (byte === 0 && length >= minimumStringLength) await output(context, `${start ? start + " " : ""}${text}\n`);
            text = "";
            length = 0;
          }
          offset = addOffset(offset, 1);
        }
      }
      return { exitCode: 0 };
    }
    const verbose = parsed.flags.has("v");
    const isBigEndian = endian === "big";
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
    for await (const row of rows(range(sources(context, parsed.operands, maxInputBytes), skip, count), width)) {
      let same = false;
      if (!verbose && previous !== undefined && previous.length === row.length) {
        same = true;
        for (let i = 0; i < row.length; i++) {
          if (previous[i] !== row[i]) { same = false; break; }
        }
      }
      if (same) {
        if (!suppressed) await writeOut("*\n");
        suppressed = true;
      } else {
        const addr = address();
        const pad = selected.length > 1 ? " ".repeat(addr.length) : "";
        for (let index = 0; index < selected.length; index++) {
          const prefix = index === 0 ? addr : pad;
          await writeOut(`${prefix}${formatRow(row, selected[index]!, isBigEndian)}\n`);
        }
        if (previous === undefined || previous.length !== row.length) previous = row.slice();
        else previous.set(row);
        suppressed = false;
      }
      offset = addOffset(offset, row.length);
    }
    if (radix !== "n") await writeOut(`${address()}\n`);
    if (outBuf) await output(context, outBuf);
    return { exitCode: 0 };
  });
}
