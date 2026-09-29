import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import type { CommandContext, CommandDefinition } from "safe-bash-contracts";
import { define, integer, options, output, requireOperands } from "safe-bash-io-engine/internal";
import { sources, validatedOption } from "./shared.js";

interface Alphabet {
  readonly symbols: string;
  readonly symbolBytes: Uint8Array;
  readonly bits: number;
  readonly quantum: number;
  readonly lengths: readonly number[];
}

function makeAlphabet(symbols: string, bits: number, quantum: number, lengths: readonly number[]): Alphabet {
  const symbolBytes = new Uint8Array(symbols.length);
  for (let i = 0; i < symbols.length; i++) symbolBytes[i] = symbols.charCodeAt(i);
  return { symbols, symbolBytes, bits, quantum, lengths };
}

const alphabets: Record<"base64" | "base32", Alphabet> = {
  base64: makeAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", 6, 4, [2, 3, 4]),
  base32: makeAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 5, 8, [2, 4, 5, 7, 8]),
};

async function encode(context: CommandContext, files: readonly string[], alphabet: Alphabet, wrap: number, maxInputBytes: number): Promise<void> {
  let carry = 0;
  let bits = 0;
  let symbols = 0;
  let column = 0;
  const symbolBytes = alphabet.symbolBytes;
  const aBits = alphabet.bits;
  const aQuantum = alphabet.quantum;
  const mask = (1 << aBits) - 1;
  const outBuf = new Uint8Array(16384);
  let outUsed = 0;
  const emitByte = (byte: number): void => {
    outBuf[outUsed++] = byte;
    symbols = (symbols + 1) % aQuantum;
    if (wrap && ++column === wrap) {
      outBuf[outUsed++] = 10;
      column = 0;
    }
  };
  for await (const chunk of sources(context, files, maxInputBytes)) {
    for (let i = 0; i < chunk.length; i++) {
      carry = (carry << 8) | chunk[i]!;
      bits += 8;
      while (bits >= aBits) {
        bits -= aBits;
        emitByte(symbolBytes[(carry >> bits) & mask]!);
      }
      carry &= (1 << bits) - 1;
      if (outUsed >= 16000) {
        await output(context, outBuf.slice(0, outUsed));
        outUsed = 0;
      }
    }
    if (outUsed > 0) {
      await output(context, outBuf.slice(0, outUsed));
      outUsed = 0;
    }
  }
  if (bits) emitByte(symbolBytes[carry << (aBits - bits)]!);
  while (symbols) emitByte(61);
  if (wrap && column) outBuf[outUsed++] = 10;
  if (outUsed > 0) await output(context, outBuf.slice(0, outUsed));
}

function decodeQuantumInto(quantum: Int16Array, qLen: number, alphabet: Alphabet, outBuf: Uint8Array, outUsed: number): { nextUsed: number; valid: boolean } {
  if (alphabet.bits === 5 && qLen < alphabet.quantum) return { nextUsed: outUsed, valid: false };
  let carry = 0;
  let bits = 0;
  let length = 0;
  while (length < qLen && quantum[length]! >= 0) {
    carry = (carry << alphabet.bits) | quantum[length++]!;
    bits += alphabet.bits;
    if (bits >= 8) {
      bits -= 8;
      outBuf[outUsed++] = (carry >> bits) & 255;
    }
    carry &= (1 << bits) - 1;
  }
  let validTail = qLen === alphabet.quantum && carry === 0 && alphabet.lengths.includes(length);
  if (validTail) {
    for (let i = length; i < qLen; i++) {
      if (quantum[i] !== -1) { validTail = false; break; }
    }
  }
  return { nextUsed: outUsed, valid: validTail };
}

async function decode(context: CommandContext, files: readonly string[], alphabet: Alphabet, ignore: boolean, maxInputBytes: number): Promise<void> {
  const lookup = new Int16Array(256).fill(-2);
  for (let index = 0; index < alphabet.symbols.length; index++) lookup[alphabet.symbols.charCodeAt(index)] = index;
  lookup[61] = -1;
  const aQuantum = alphabet.quantum;
  const quantum = new Int16Array(8);
  let qLen = 0;
  let lastByte: number | undefined;
  const outBuf = new Uint8Array(8192);
  for await (const chunk of sources(context, files, maxInputBytes)) {
    let outUsed = 0;
    let invalid = false;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;
      const symbol = lookup[byte]!;
      if (ignore && symbol === -2) continue;
      if (byte === 10) continue;
      lastByte = byte;
      quantum[qLen++] = symbol;
      if (qLen === aQuantum) {
        const res = decodeQuantumInto(quantum, qLen, alphabet, outBuf, outUsed);
        outUsed = res.nextUsed;
        qLen = 0;
        if (!res.valid) { invalid = true; break; }
        if (outUsed >= 8184) {
          await output(context, outBuf.slice(0, outUsed));
          outUsed = 0;
        }
      }
    }
    if (outUsed > 0) await output(context, outBuf.slice(0, outUsed));
    if (invalid) throw new PublicDiagnostic("invalid input");
  }
  if (qLen > 0) {
    if (lastByte !== 61) while (qLen < aQuantum) quantum[qLen++] = -1;
    const res = decodeQuantumInto(quantum, qLen, alphabet, outBuf, 0);
    if (res.nextUsed > 0) await output(context, outBuf.slice(0, res.nextUsed));
    if (!res.valid) throw new PublicDiagnostic("invalid input");
  }
}

export function createBaseCommand(name: "base64" | "base32", maxInputBytes: number): CommandDefinition {
  return define(name, async context => {
    const parsed = options(context.args, "diw:", { decode: "d", "ignore-garbage": "i", wrap: "w" });
    requireOperands(parsed.operands, 0, 1);
    const wrap = validatedOption(parsed, "w", integer, 76);
    if (parsed.flags.has("d")) await decode(context, parsed.operands, alphabets[name], parsed.flags.has("i"), maxInputBytes);
    else await encode(context, parsed.operands, alphabets[name], wrap, maxInputBytes);
    return { exitCode: 0 };
  });
}

export function evalSyncBase32(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (p: string) => Uint8Array | undefined,
): Uint8Array | undefined {
  let isDecode = false;
  let ignoreGarbage = false;
  let wrap = 76;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && (a === "-d" || a === "--decode")) { isDecode = true; continue; }
    if (!ended && (a === "-i" || a === "--ignore-garbage")) { ignoreGarbage = true; continue; }
    if (!ended && (a === "-di" || a === "-id")) { isDecode = true; ignoreGarbage = true; continue; }
    if (!ended && (a === "-w" || a === "--wrap")) {
      if (i + 1 >= opArgs.length || !/^[0-9]+$/.test(opArgs[i + 1]!)) return undefined;
      wrap = Number(opArgs[++i]!);
      continue;
    }
    if (!ended && a.startsWith("-w") && /^[0-9]+$/.test(a.slice(2))) {
      wrap = Number(a.slice(2));
      continue;
    }
    if (!ended && a.startsWith("--wrap=") && /^[0-9]+$/.test(a.slice(7))) {
      wrap = Number(a.slice(7));
      continue;
    }
    if (!ended && a.startsWith("-") && a !== "-") return undefined;
    operands.push(a);
  }
  if (operands.length > 1) return undefined;
  let sourceBytes = inBytes;
  if (operands.length === 1 && operands[0] !== "-") {
    if (!readFileSync) return undefined;
    const fb = readFileSync(operands[0]!);
    if (!fb) return undefined;
    sourceBytes = fb;
  }
  if (sourceBytes.byteLength > 16384) return undefined;
  const alphabet = alphabets.base32;
  if (!isDecode) {
    let carry = 0, bits = 0, symbols = 0, column = 0;
    const symbolBytes = alphabet.symbolBytes;
    const aBits = alphabet.bits;
    const aQuantum = alphabet.quantum;
    const mask = (1 << aBits) - 1;
    const out: number[] = [];
    const emitByte = (byte: number): void => {
      out.push(byte);
      symbols = (symbols + 1) % aQuantum;
      if (wrap && ++column === wrap) {
        out.push(10);
        column = 0;
      }
    };
    for (let i = 0; i < sourceBytes.byteLength; i++) {
      carry = (carry << 8) | sourceBytes[i]!;
      bits += 8;
      while (bits >= aBits) {
        bits -= aBits;
        emitByte(symbolBytes[(carry >> bits) & mask]!);
      }
      carry &= (1 << bits) - 1;
    }
    if (bits) emitByte(symbolBytes[carry << (aBits - bits)]!);
    while (symbols) emitByte(61);
    if (wrap && column) out.push(10);
    return Uint8Array.from(out);
  } else {
    const lookup = new Int16Array(256).fill(-2);
    for (let index = 0; index < alphabet.symbols.length; index++) lookup[alphabet.symbols.charCodeAt(index)] = index;
    lookup[61] = -1;
    const aQuantum = alphabet.quantum;
    const quantum = new Int16Array(8);
    let qLen = 0;
    let lastByte: number | undefined;
    const outBuf = new Uint8Array(sourceBytes.byteLength);
    let outUsed = 0;
    for (let i = 0; i < sourceBytes.byteLength; i++) {
      const byte = sourceBytes[i]!;
      const symbol = lookup[byte]!;
      if (ignoreGarbage && symbol === -2) continue;
      if (byte === 10) continue;
      lastByte = byte;
      quantum[qLen++] = symbol;
      if (qLen === aQuantum) {
        const res = decodeQuantumInto(quantum, qLen, alphabet, outBuf, outUsed);
        if (!res.valid) return undefined;
        outUsed = res.nextUsed;
        qLen = 0;
      }
    }
    if (qLen > 0) {
      if (lastByte !== 61) while (qLen < aQuantum) quantum[qLen++] = -1;
      const res = decodeQuantumInto(quantum, qLen, alphabet, outBuf, outUsed);
      if (!res.valid) return undefined;
      outUsed = res.nextUsed;
    }
    const sliced = outBuf.subarray(0, outUsed);
    for (let i = 0; i < sliced.byteLength; i++) {
      if (sliced[i] === 0 || sliced[i]! >= 128) return undefined;
    }
    return sliced;
  }
}
