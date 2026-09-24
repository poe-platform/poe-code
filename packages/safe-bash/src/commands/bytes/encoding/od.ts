import type { CommandDefinition } from "../../../contracts/index.js";
import { define, options, output, UsageError } from "../../internal.js";
import { addOffset, numeric, range, rows, sources, validatedOption } from "./shared.js";

interface Format { readonly kind: string; readonly size: number }

function formats(text: string): Format[] {
  const result: Format[] = [];
  for (let offset = 0; offset < text.length;) {
    const kind = text[offset++]!;
    let size = 1;
    if (kind !== "a" && kind !== "c") {
      size = Number(text[offset++]);
      if ((!"doux".includes(kind) && kind !== "f") || !(kind === "f" ? [4, 8] : [1, 2, 4, 8]).includes(size)) {
        throw new UsageError(`unsupported type '${text}': use a, c, f4/f8 or d/o/u/x with size 1, 2, 4, or 8`);
      }
    }
    result.push({ kind, size });
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

function formatRow(row: Uint8Array, format: Format, bigEndian: boolean): string {
  let text = "";
  const escapes: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
  const names = ["nul", "soh", "stx", "etx", "eot", "enq", "ack", "bel", "bs", "ht", "nl", "vt", "ff", "cr", "so", "si", "dle", "dc1", "dc2", "dc3", "dc4", "nak", "syn", "etb", "can", "em", "sub", "esc", "fs", "gs", "rs", "us", "sp"];
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
  return text;
}

export function createOdCommand(maxInputBytes: number): CommandDefinition {
  return define("od", async context => {
    const aliases: Record<string, string> = { a: "a", b: "o1", c: "c", d: "u2", f: "f4", i: "d4", l: "d8", o: "o2", s: "d2", x: "x2" };
    const rewritten: string[] = [];
    let ended = false;
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) { rewritten.push(argument); continue; }
      if (argument === "--") { ended = true; rewritten.push(argument); continue; }
      if (argument.startsWith("--")) {
        if (argument === "--strings") { rewritten.push("-S3"); continue; }
        rewritten.push(argument);
        if (!argument.includes("=") && ["--address-radix", "--skip-bytes", "--read-bytes", "--format", "--type", "--width", "--endian"].includes(argument)) {
          const parameter = context.args[++index];
          if (parameter === undefined) throw new UsageError(`option '${argument}' requires an argument`);
          rewritten.push(parameter);
        }
        continue;
      }
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset]!;
        if (flag === "S") {
          rewritten.push(`-S${argument.slice(offset + 1) || "3"}`);
          break;
        }
        if (flag === "e") throw new UsageError("use --endian=little or --endian=big; -e is unsupported");
        if (aliases[flag]) rewritten.push(`-t${aliases[flag]}`);
        else if ("AjNtw".includes(flag)) {
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
    if (selected.length > 16) throw new UsageError("at most 16 output types are supported");
    const width = validatedOption(parsed, "w", text => {
      const number = numeric(text);
      if (number < 1 || number > 4096 || selected.some(format => number % format.size !== 0)) throw new UsageError("width must be 1..4096 and a multiple of each output type size");
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
      const escapes: Record<number, string> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
      for await (const chunk of range(sources(context, parsed.operands, maxInputBytes), skip, count)) {
        for (const byte of chunk) {
          if (byte >= 32 && byte <= 126 || escapes[byte] !== undefined) {
            if (!length) start = address();
            text += escapes[byte] ?? String.fromCharCode(byte);
            length++;
          } else {
            if (byte === 0 && length >= minimumStringLength) await output(context, `${start} ${text}\n`);
            text = "";
            length = 0;
          }
          offset = addOffset(offset, 1);
        }
      }
      return { exitCode: 0 };
    }
    for await (const row of rows(range(sources(context, parsed.operands, maxInputBytes), skip, count), width)) {
      const same = previous?.length === row.length && row.every((byte, index) => previous![index] === byte);
      if (!parsed.flags.has("v") && same) {
        if (!suppressed) await output(context, "*\n");
        suppressed = true;
      } else {
        for (let index = 0; index < selected.length; index++) {
          const prefix = index === 0 ? address() : " ".repeat(address().length);
          await output(context, `${prefix}${formatRow(row, selected[index]!, endian === "big")}\n`);
        }
        previous = row;
        suppressed = false;
      }
      offset = addOffset(offset, row.length);
    }
    if (radix !== "n") await output(context, `${address()}\n`);
    return { exitCode: 0 };
  });
}
