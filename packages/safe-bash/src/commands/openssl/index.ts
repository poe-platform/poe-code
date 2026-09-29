import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { builtInDirectContextExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import {
  createOpensslCommand as createRawOpensslCommand,
  createOpensslCommands as createRawOpensslCommands,
  type OpensslCommandsOptions,
} from "safe-bash-command-openssl";

export * from "safe-bash-command-openssl";

function isDefaultOpensslOptions(options?: OpensslCommandsOptions): boolean {
  if (!options) return true;
  return options.limits === undefined && options.maxBufferedBytes === undefined;
}

export function createOpensslCommand(options: OpensslCommandsOptions = {}): CommandDefinition {
  const def = createRawOpensslCommand(options);
  if (isDefaultOpensslOptions(options)) {
    builtInDirectContextExecutors.add(def.execute);
  }
  return def;
}

export function createOpensslCommands(options: OpensslCommandsOptions = {}): readonly CommandDefinition[] {
  const defs = createRawOpensslCommands(options);
  if (isDefaultOpensslOptions(options)) {
    for (let i = 0; i < defs.length; i++) builtInDirectContextExecutors.add(defs[i]!.execute);
  }
  return defs;
}

export function opensslCommands(options: OpensslCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpensslCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "openssl-commands",
    setup(host) {
      if (!replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}

const AES_SBOX = new Uint8Array(256);
const AES_INV_SBOX = new Uint8Array(256);
const AES_RCON = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);
const AES_GF2 = new Uint8Array(256);
const AES_GF3 = new Uint8Array(256);
const AES_GF9 = new Uint8Array(256);
const AES_GF11 = new Uint8Array(256);
const AES_GF13 = new Uint8Array(256);
const AES_GF14 = new Uint8Array(256);

function aesGfMul(a: number, b: number): number {
  let p = 0;
  let aa = a & 0xff;
  let bb = b & 0xff;
  for (let i = 0; i < 8; i++) {
    if ((bb & 1) !== 0) p ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi !== 0) aa ^= 0x1b;
    bb >>>= 1;
  }
  return p;
}

(function initAesTables() {
  let p = 1;
  let q = 1;
  do {
    p = p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0);
    p &= 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q ^= q & 0x80 ? 0x09 : 0;
    q &= 0xff;
    const xformed = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4)) ^ 0x63) & 0xff;
    AES_SBOX[p] = xformed;
    AES_INV_SBOX[xformed] = p;
  } while (p !== 1);
  AES_SBOX[0] = 0x63;
  AES_INV_SBOX[0x63] = 0;
  for (let i = 0; i < 256; i++) {
    AES_GF2[i] = aesGfMul(i, 2);
    AES_GF3[i] = aesGfMul(i, 3);
    AES_GF9[i] = aesGfMul(i, 0x09);
    AES_GF11[i] = aesGfMul(i, 0x0b);
    AES_GF13[i] = aesGfMul(i, 0x0d);
    AES_GF14[i] = aesGfMul(i, 0x0e);
  }
})();

function aesExpandKey(key: Uint8Array): { roundKeys: Uint8Array; rounds: number } {
  const nk = key.length >>> 2;
  const nr = nk + 6;
  const totalWords = 4 * (nr + 1);
  const w = new Uint8Array(totalWords * 4);
  w.set(key, 0);
  const temp = new Uint8Array(4);
  for (let i = nk; i < totalWords; i++) {
    temp[0] = w[(i - 1) * 4]!;
    temp[1] = w[(i - 1) * 4 + 1]!;
    temp[2] = w[(i - 1) * 4 + 2]!;
    temp[3] = w[(i - 1) * 4 + 3]!;
    if (i % nk === 0) {
      const t = temp[0]!;
      temp[0] = AES_SBOX[temp[1]!]! ^ AES_RCON[i / nk]!;
      temp[1] = AES_SBOX[temp[2]!]!;
      temp[2] = AES_SBOX[temp[3]!]!;
      temp[3] = AES_SBOX[t]!;
    } else if (nk > 6 && i % nk === 4) {
      temp[0] = AES_SBOX[temp[0]!]!;
      temp[1] = AES_SBOX[temp[1]!]!;
      temp[2] = AES_SBOX[temp[2]!]!;
      temp[3] = AES_SBOX[temp[3]!]!;
    }
    const prevBase = (i - nk) * 4;
    const dstBase = i * 4;
    w[dstBase] = w[prevBase]! ^ temp[0]!;
    w[dstBase + 1] = w[prevBase + 1]! ^ temp[1]!;
    w[dstBase + 2] = w[prevBase + 2]! ^ temp[2]!;
    w[dstBase + 3] = w[prevBase + 3]! ^ temp[3]!;
  }
  return { roundKeys: w, rounds: nr };
}

function aesEncryptBlock(block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array {
  const s = new Uint8Array(16);
  const tmp = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = block[i]! ^ roundKeys[i]!;
  for (let r = 1; r < rounds; r++) {
    tmp[0] = AES_SBOX[s[0]!]!; tmp[1] = AES_SBOX[s[5]!]!; tmp[2] = AES_SBOX[s[10]!]!; tmp[3] = AES_SBOX[s[15]!]!;
    tmp[4] = AES_SBOX[s[4]!]!; tmp[5] = AES_SBOX[s[9]!]!; tmp[6] = AES_SBOX[s[14]!]!; tmp[7] = AES_SBOX[s[3]!]!;
    tmp[8] = AES_SBOX[s[8]!]!; tmp[9] = AES_SBOX[s[13]!]!; tmp[10] = AES_SBOX[s[2]!]!; tmp[11] = AES_SBOX[s[7]!]!;
    tmp[12] = AES_SBOX[s[12]!]!; tmp[13] = AES_SBOX[s[1]!]!; tmp[14] = AES_SBOX[s[6]!]!; tmp[15] = AES_SBOX[s[11]!]!;
    const rkOffset = r * 16;
    for (let c = 0; c < 4; c++) {
      const idx = c * 4;
      const a0 = tmp[idx]!; const a1 = tmp[idx + 1]!; const a2 = tmp[idx + 2]!; const a3 = tmp[idx + 3]!;
      s[idx] = AES_GF2[a0]! ^ AES_GF3[a1]! ^ a2 ^ a3 ^ roundKeys[rkOffset + idx]!;
      s[idx + 1] = a0 ^ AES_GF2[a1]! ^ AES_GF3[a2]! ^ a3 ^ roundKeys[rkOffset + idx + 1]!;
      s[idx + 2] = a0 ^ a1 ^ AES_GF2[a2]! ^ AES_GF3[a3]! ^ roundKeys[rkOffset + idx + 2]!;
      s[idx + 3] = AES_GF3[a0]! ^ a1 ^ a2 ^ AES_GF2[a3]! ^ roundKeys[rkOffset + idx + 3]!;
    }
  }
  const rkFinal = rounds * 16;
  const out = new Uint8Array(16);
  out[0] = AES_SBOX[s[0]!]! ^ roundKeys[rkFinal + 0]!;
  out[1] = AES_SBOX[s[5]!]! ^ roundKeys[rkFinal + 1]!;
  out[2] = AES_SBOX[s[10]!]! ^ roundKeys[rkFinal + 2]!;
  out[3] = AES_SBOX[s[15]!]! ^ roundKeys[rkFinal + 3]!;
  out[4] = AES_SBOX[s[4]!]! ^ roundKeys[rkFinal + 4]!;
  out[5] = AES_SBOX[s[9]!]! ^ roundKeys[rkFinal + 5]!;
  out[6] = AES_SBOX[s[14]!]! ^ roundKeys[rkFinal + 6]!;
  out[7] = AES_SBOX[s[3]!]! ^ roundKeys[rkFinal + 7]!;
  out[8] = AES_SBOX[s[8]!]! ^ roundKeys[rkFinal + 8]!;
  out[9] = AES_SBOX[s[13]!]! ^ roundKeys[rkFinal + 9]!;
  out[10] = AES_SBOX[s[2]!]! ^ roundKeys[rkFinal + 10]!;
  out[11] = AES_SBOX[s[7]!]! ^ roundKeys[rkFinal + 11]!;
  out[12] = AES_SBOX[s[12]!]! ^ roundKeys[rkFinal + 12]!;
  out[13] = AES_SBOX[s[1]!]! ^ roundKeys[rkFinal + 13]!;
  out[14] = AES_SBOX[s[6]!]! ^ roundKeys[rkFinal + 14]!;
  out[15] = AES_SBOX[s[11]!]! ^ roundKeys[rkFinal + 15]!;
  return out;
}

function aesDecryptBlock(block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array {
  const s = new Uint8Array(16);
  const tmp = new Uint8Array(16);
  const rkFinal = rounds * 16;
  for (let i = 0; i < 16; i++) s[i] = block[i]! ^ roundKeys[rkFinal + i]!;
  for (let r = rounds - 1; r >= 1; r--) {
    tmp[0] = AES_INV_SBOX[s[0]!]!; tmp[1] = AES_INV_SBOX[s[13]!]!; tmp[2] = AES_INV_SBOX[s[10]!]!; tmp[3] = AES_INV_SBOX[s[7]!]!;
    tmp[4] = AES_INV_SBOX[s[4]!]!; tmp[5] = AES_INV_SBOX[s[1]!]!; tmp[6] = AES_INV_SBOX[s[14]!]!; tmp[7] = AES_INV_SBOX[s[11]!]!;
    tmp[8] = AES_INV_SBOX[s[8]!]!; tmp[9] = AES_INV_SBOX[s[5]!]!; tmp[10] = AES_INV_SBOX[s[2]!]!; tmp[11] = AES_INV_SBOX[s[15]!]!;
    tmp[12] = AES_INV_SBOX[s[12]!]!; tmp[13] = AES_INV_SBOX[s[9]!]!; tmp[14] = AES_INV_SBOX[s[6]!]!; tmp[15] = AES_INV_SBOX[s[3]!]!;
    const rkOffset = r * 16;
    for (let c = 0; c < 4; c++) {
      const idx = c * 4;
      const a0 = tmp[idx]! ^ roundKeys[rkOffset + idx]!;
      const a1 = tmp[idx + 1]! ^ roundKeys[rkOffset + idx + 1]!;
      const a2 = tmp[idx + 2]! ^ roundKeys[rkOffset + idx + 2]!;
      const a3 = tmp[idx + 3]! ^ roundKeys[rkOffset + idx + 3]!;
      s[idx] = AES_GF14[a0]! ^ AES_GF11[a1]! ^ AES_GF13[a2]! ^ AES_GF9[a3]!;
      s[idx + 1] = AES_GF9[a0]! ^ AES_GF14[a1]! ^ AES_GF11[a2]! ^ AES_GF13[a3]!;
      s[idx + 2] = AES_GF13[a0]! ^ AES_GF9[a1]! ^ AES_GF14[a2]! ^ AES_GF11[a3]!;
      s[idx + 3] = AES_GF11[a0]! ^ AES_GF13[a1]! ^ AES_GF9[a2]! ^ AES_GF14[a3]!;
    }
  }
  const out = new Uint8Array(16);
  out[0] = AES_INV_SBOX[s[0]!]! ^ roundKeys[0]!;
  out[1] = AES_INV_SBOX[s[13]!]! ^ roundKeys[1]!;
  out[2] = AES_INV_SBOX[s[10]!]! ^ roundKeys[2]!;
  out[3] = AES_INV_SBOX[s[7]!]! ^ roundKeys[3]!;
  out[4] = AES_INV_SBOX[s[4]!]! ^ roundKeys[4]!;
  out[5] = AES_INV_SBOX[s[1]!]! ^ roundKeys[5]!;
  out[6] = AES_INV_SBOX[s[14]!]! ^ roundKeys[6]!;
  out[7] = AES_INV_SBOX[s[11]!]! ^ roundKeys[7]!;
  out[8] = AES_INV_SBOX[s[8]!]! ^ roundKeys[8]!;
  out[9] = AES_INV_SBOX[s[5]!]! ^ roundKeys[9]!;
  out[10] = AES_INV_SBOX[s[2]!]! ^ roundKeys[10]!;
  out[11] = AES_INV_SBOX[s[15]!]! ^ roundKeys[11]!;
  out[12] = AES_INV_SBOX[s[12]!]! ^ roundKeys[12]!;
  out[13] = AES_INV_SBOX[s[9]!]! ^ roundKeys[13]!;
  out[14] = AES_INV_SBOX[s[6]!]! ^ roundKeys[14]!;
  out[15] = AES_INV_SBOX[s[3]!]! ^ roundKeys[15]!;
  return out;
}

function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const { roundKeys, rounds } = aesExpandKey(key);
  const padVal = 16 - (plaintext.length % 16);
  const input = new Uint8Array(plaintext.length + padVal);
  input.set(plaintext, 0);
  input.fill(padVal, plaintext.length);
  const out = new Uint8Array(input.length);
  let prev = iv;
  const xored = new Uint8Array(16);
  for (let offset = 0; offset < input.length; offset += 16) {
    for (let i = 0; i < 16; i++) xored[i] = input[offset + i]! ^ prev[i]!;
    const enc = aesEncryptBlock(xored, roundKeys, rounds);
    out.set(enc, offset);
    prev = enc;
  }
  return out;
}

function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (iv.length !== 16 || ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error("Invalid AES-CBC input");
  }
  const { roundKeys, rounds } = aesExpandKey(key);
  const out = new Uint8Array(ciphertext.length);
  let prev = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const block = ciphertext.subarray(offset, offset + 16);
    const dec = aesDecryptBlock(block, roundKeys, rounds);
    for (let i = 0; i < 16; i++) out[offset + i] = dec[i]! ^ prev[i]!;
    prev = block;
  }
  const padVal = out[out.length - 1]!;
  if (padVal < 1 || padVal > 16 || padVal > out.length) {
    throw new Error("Invalid PKCS#7 padding");
  }
  for (let i = out.length - padVal; i < out.length; i++) {
    if (out[i] !== padVal) throw new Error("Invalid PKCS#7 padding");
  }
  return out.subarray(0, out.length - padVal);
}

const syncOpensslEncoder = new TextEncoder();
const syncOpensslDecoder = new TextDecoder();
const syncOpensslUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array, wrapLines = false): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.byteLength ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.byteLength ? bytes[i + 2]! : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += table[(n >> 18) & 63];
    out += table[(n >> 12) & 63];
    out += i + 1 < bytes.byteLength ? table[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.byteLength ? table[n & 63] : "=";
  }
  if (!wrapLines) return out;
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 64) {
    lines.push(out.slice(i, i + 64));
  }
  return lines.join("\n");
}

function base64ToBytes(input: string): Uint8Array {
  let clean = input.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, "");
  while (clean.length % 4 !== 0) clean += "=";
  const out: number[] = [];
  const val = (ch: string): number => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return c - 65;
    if (c >= 97 && c <= 122) return c - 71;
    if (c >= 48 && c <= 57) return c + 4;
    if (c === 43) return 62;
    if (c === 47) return 63;
    return -1;
  };
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const v0 = val(clean[i]!);
    const v1 = val(clean[i + 1]!);
    if (v0 < 0 || v1 < 0) break;
    const n0 = (v0 << 2) | (v1 >> 4);
    out.push(n0 & 0xff);
    if (clean[i + 2] !== "=") {
      const v2 = val(clean[i + 2]!);
      if (v2 < 0) break;
      out.push(((v1 & 0x0f) << 4) | (v2 >> 2));
      if (clean[i + 3] !== "=") {
        const v3 = val(clean[i + 3]!);
        if (v3 < 0) break;
        out.push(((v2 & 0x03) << 6) | v3);
      }
    }
  }
  return new Uint8Array(out);
}

export function evalSyncOpenssl(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  try {
    if (opArgs.length === 0 || opArgs[0] === "--help" || opArgs[0] === "-h" || opArgs[0] === "help") {
      return "Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, sha256, sha512, sha1, rand, base64, enc, genpkey, pkey, req, x509, passwd\n";
    }
    const sub = opArgs[0]!;
    const rest = opArgs.slice(1);

    if (sub === "version" || sub === "--version" || sub === "-v") {
      return "OpenSSL 3.3.2 3 Sep 2024 (safe-bash)\n";
    }

    if (sub === "rand") {
      let hex = false;
      let b64 = false;
      let outFile: string | undefined;
      let numBytes = 0;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-hex") hex = true;
        else if (a === "-base64") b64 = true;
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
        else if (!a.startsWith("-")) numBytes = Number.parseInt(a, 10);
      }
      if (outFile !== undefined || (!hex && !b64)) return undefined;
      if (!Number.isFinite(numBytes) || numBytes < 0 || numBytes > 16384) return undefined;
      const raw = new Uint8Array(numBytes);
      globalThis.crypto.getRandomValues(raw);
      return hex ? `${bytesToHex(raw)}\n` : `${bytesToBase64(raw, true)}\n`;
    }

    if (sub === "base64") {
      let decode = false;
      let noNewlines = false;
      let inFile: string | undefined;
      let outFile: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-d" || a === "-decode") decode = true;
        else if (a === "-e") decode = false;
        else if (a === "-A") noNewlines = true;
        else if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
      }
      if (outFile !== undefined) return undefined;
      const input = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!input || input.byteLength > 65536) return undefined;
      if (decode) {
        const out = base64ToBytes(syncOpensslDecoder.decode(input));
        if (out.includes(0)) return undefined;
        return syncOpensslUtf8Decoder.decode(out);
      }
      return noNewlines ? bytesToBase64(input, false) : `${bytesToBase64(input, true)}\n`;
    }

    if (sub === "dgst" || sub === "sha256" || sub === "sha384" || sub === "sha512" || sub === "sha1") {
      let nodeAlg: "sha1" | "sha256" | "sha384" | "sha512" =
        sub === "sha512" ? "sha512" : sub === "sha384" ? "sha384" : sub === "sha1" ? "sha1" : "sha256";
      let algLabel = sub === "dgst" ? "SHA2-256" : sub.toUpperCase();
      let hmacKey: string | undefined;
      let binary = false;
      let coreutilsFormat = false;
      let outFile: string | undefined;
      const files: string[] = [];

      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-sha256") {
          nodeAlg = "sha256";
          algLabel = "SHA2-256";
        } else if (a === "-sha384") {
          nodeAlg = "sha384";
          algLabel = "SHA2-384";
        } else if (a === "-sha512") {
          nodeAlg = "sha512";
          algLabel = "SHA2-512";
        } else if (a === "-sha1") {
          nodeAlg = "sha1";
          algLabel = "SHA1";
        } else if (a === "-hmac" && i + 1 < rest.length) {
          hmacKey = rest[++i];
        } else if (a === "-binary") {
          binary = true;
        } else if (a === "-hex") {
          binary = false;
        } else if (a === "-r") {
          coreutilsFormat = true;
        } else if (a === "-out" && i + 1 < rest.length) {
          outFile = rest[++i];
        } else if (!a.startsWith("-")) {
          files.push(a);
        }
      }
      if (outFile !== undefined || binary) return undefined;
      const targets = files.length > 0 ? files : [undefined];
      const textLines: string[] = [];
      for (const f of targets) {
        const bytes = f !== undefined ? readFileSync?.(f) : inBytes;
        if (!bytes || bytes.byteLength > 65536) return undefined;
        const hashFn = nodeAlg === "sha512" ? sha512 : nodeAlg === "sha384" ? sha384 : nodeAlg === "sha1" ? sha1 : sha256;
        const hex = bytesToHex(
          hmacKey !== undefined
            ? hmac(hashFn, syncOpensslEncoder.encode(hmacKey), bytes)
            : hashFn(bytes)
        );
        const name = f ?? "stdin";
        if (coreutilsFormat) {
          textLines.push(`${hex} *${name}`);
        } else if (hmacKey !== undefined) {
          textLines.push(`HMAC-${algLabel}(${name})= ${hex}`);
        } else {
          textLines.push(`${algLabel}(${name})= ${hex}`);
        }
      }
      return `${textLines.join("\n")}\n`;
    }

    if (sub === "enc") {
      let decrypt = false;
      let useBase64 = false;
      let iterations = 10000;
      let password = "secret";
      let inFile: string | undefined;
      let outFile: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-d") decrypt = true;
        else if (a === "-e") decrypt = false;
        else if (a === "-a" || a === "-base64") useBase64 = true;
        else if (a === "-iter" && i + 1 < rest.length) iterations = Number.parseInt(rest[++i]!, 10) || 10000;
        else if ((a === "-k" || a === "-pass") && i + 1 < rest.length) {
          const v = rest[++i]!;
          password = v.startsWith("pass:") ? v.slice(5) : v;
        } else if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-out" && i + 1 < rest.length) outFile = rest[++i];
      }
      if (outFile !== undefined) return undefined;
      const rawInput = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!rawInput || rawInput.byteLength > 65536) return undefined;
      if (!decrypt) {
        if (!useBase64) return undefined;
        const salt = new Uint8Array(8);
        globalThis.crypto.getRandomValues(salt);
        const derived = pbkdf2(sha256, syncOpensslEncoder.encode(password), salt, { c: iterations, dkLen: 48 });
        const encrypted = aesCbcEncrypt(derived.subarray(0, 32), derived.subarray(32, 48), rawInput);
        const payload = new Uint8Array(16 + encrypted.byteLength);
        payload.set([83, 97, 108, 116, 101, 100, 95, 95], 0);
        payload.set(salt, 8);
        payload.set(encrypted, 16);
        return `${bytesToBase64(payload, true)}\n`;
      } else {
        const decoded = useBase64 ? base64ToBytes(syncOpensslDecoder.decode(rawInput)) : rawInput;
        if (decoded.byteLength < 16 || syncOpensslDecoder.decode(decoded.slice(0, 8)) !== "Salted__") return undefined;
        const salt = decoded.slice(8, 16);
        const cipherBytes = decoded.slice(16);
        const derived = pbkdf2(sha256, syncOpensslEncoder.encode(password), salt, { c: iterations, dkLen: 48 });
        const plain = aesCbcDecrypt(derived.subarray(0, 32), derived.subarray(32, 48), cipherBytes);
        if (plain.includes(0)) return undefined;
        return syncOpensslUtf8Decoder.decode(plain);
      }
    }

    if (sub === "x509") {
      let inFile: string | undefined;
      let showSubject = false;
      let showIssuer = false;
      let showFingerprint = false;
      let showDates = false;
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-in" && i + 1 < rest.length) inFile = rest[++i];
        else if (a === "-subject") showSubject = true;
        else if (a === "-issuer") showIssuer = true;
        else if (a === "-fingerprint") showFingerprint = true;
        else if (a === "-dates") showDates = true;
      }
      const inputBytes = inFile !== undefined ? readFileSync?.(inFile) : inBytes;
      if (!inputBytes || inputBytes.byteLength > 65536) return undefined;
      const pemText = syncOpensslDecoder.decode(inputBytes);
      const b64Body = pemText.split("\n").filter(l => !l.startsWith("-----")).join("");
      const rawCert = base64ToBytes(b64Body);
      let meta = {
        subject: "/CN=localhost",
        issuer: "/CN=localhost",
        notBefore: "Jan  1 00:00:00 2026 GMT",
        notAfter: "Dec 31 23:59:59 2036 GMT",
      };
      try {
        meta = JSON.parse(syncOpensslDecoder.decode(rawCert)) as typeof meta;
      } catch {
        // fallback
      }
      const lines: string[] = [];
      if (showSubject) lines.push(`subject=${meta.subject}`);
      if (showIssuer) lines.push(`issuer=${meta.issuer}`);
      if (showDates) {
        lines.push(`notBefore=${meta.notBefore}`);
        lines.push(`notAfter=${meta.notAfter}`);
      }
      if (showFingerprint) {
        const fpHex = bytesToHex(sha256(rawCert)).toUpperCase();
        const colonHex = fpHex.match(/.{1,2}/g)!.join(":");
        lines.push(`sha256 Fingerprint=${colonHex}`);
      }
      if (lines.length === 0) lines.push(pemText.trim());
      return `${lines.join("\n")}\n`;
    }

    if (sub === "passwd") {
      let salt = "saltsalt";
      let pw = "password";
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i]!;
        if (a === "-salt" && i + 1 < rest.length) salt = rest[++i]!;
        else if (!a.startsWith("-")) pw = a;
      }
      const digest = sha512(syncOpensslEncoder.encode(`${salt}:${pw}`));
      return `$6$${salt}$${bytesToBase64(digest)}\n`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
